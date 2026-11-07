// Retrieval: builds a corpus from the database (profile, account summaries, past transactions, subscriptions, upcoming schedule,
// planned expenses) plus a curated knowledge base, and ranks with BM25. The corpus is rebuilt on every query (it is small),
// so edits made in the Expenses tab are visible to the assistant immediately.
// To upgrade: replace `search` with an embedding model; callers don't change.
const fs = require('fs'), path = require('path');
const F = require('./finance');
const { gbp } = F;
const dow = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
const dd = d => d + " (" + dow(d) + ")";

const STOP = new Set('a an the and or of to in on for is are was were be been it my me i you your we our with at by from that this what how can do does did if so as but not no about have has had will would should could into than then there their they them its'.split(' '));
const stem = w => w.replace(/(ing|ed|es|s)$/, '');
const tok = s => (s.toLowerCase().match(/[a-z0-9£]+/g) || []).filter(w => !STOP.has(w)).map(stem);

const KB = (() => {
  const out = [], dir = path.join(__dirname, 'data', 'knowledge');
  fs.readdirSync(dir).filter(f => f.endsWith('.md')).forEach(f =>
    fs.readFileSync(path.join(dir, f), 'utf8').split(/^# /m).filter(Boolean).forEach(sec => {
      const [title, ...rest] = sec.split('\n');
      out.push({ title: title.trim(), text: rest.join('\n').trim() });
    }));
  return out;
})();

function buildCorpus() {
  const docs = [];
  const add = (source, kind, title, text) => docs.push({ id: docs.length + 1, source, kind, title, text });
  const p = F.profile, s = F.snapshot();
  add('profile', 'profile', 'About the user',
    Object.entries(p).filter(([k]) => k !== 'goals').map(([k, v]) => `${k}: ${v}`).join('\n') + '\ngoals: ' + p.goals.join('; '));
  add('account', 'account', 'Current account position',
    `As of ${dd(s.asOf)}: current account balance ${gbp(s.balance)}. Arranged overdraft limit ${gbp(s.overdraftLimit)}. Savings pot ${gbp(s.savingsPot)}. Lowest balance in the last 60 days was ${gbp(s.minBal)}; the account was overdrawn on ${s.daysInOverdraft} transactions. Overdraft interest paid in the last two months: ${gbp(s.feesTotal)}.`);
  add('account', 'account', 'Income',
    `Last month's income was ${gbp(s.octIncome)} (weekly wages paid on Fridays). Lowest normal week ${gbp(s.lowWeek)}, average week ${gbp(s.avgWeek)}. Pay varies with shifts, so budget from the lowest week. Next paydays: ${s.nextFridays.join(', ')}.`);
  add('account', 'account', 'Last month spending by category',
    `Total spent last month (${s.lastMonth}) ${gbp(s.octSpend)}. ` + Object.entries(s.octCats).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${gbp(v)}`).join(', ') + '.');
  add('account', 'account', 'Cashflow projection and payday',
    `Next payday is ${dd(s.nextFridays[0])}, in ${s.daysToPay} days. Bills leaving before then: ${gbp(s.billsBeforePay)}. Estimated food and travel before payday: ${gbp(s.dailyEssentials * s.daysToPay)}. Estimated lowest balance before payday: ${gbp(s.lowPoint)}. ` +
    `Cautious projection for the next 14 days: start ${gbp(s.balance)}, minus bills and planned costs ${gbp(s.billsNext14)}, minus about ${gbp(s.dailyEssentials)} a day on groceries and transport, plus two pay weeks at the lowest normal week (${gbp(s.expectedPay)}) gives about ${gbp(s.projected14)}.`);
  const subs = F.subscriptions();
  add('account', 'account', 'Subscriptions and recurring bills',
    subs.map(r => `${r.merchant} (${r.type}${r.essential ? ', essential' : ''}) ${gbp(r.amount)} monthly on day ${r.day_of_month}, ${r.active ? 'active' : 'PAUSED'}${r.note ? '. Note: ' + r.note : ''}`).join('\n') +
    `\nActive subscriptions cost ${gbp(s.subsMonthly)} a month.`);
  add('account', 'account', 'Upcoming expenses and subscriptions (next 45 days)',
    s.upcoming.map(u => `${dd(u.date)} (in ${u.inDays} days) ${u.name} ${gbp(u.amount)} [${u.kind}${u.essential ? ', essential' : ''}]`).join('\n'));
  const pl = F.planned();
  if (pl.length) add('account', 'account', 'Planned one-off expenses', pl.map(x => `${dd(x.date)} ${x.description} ${gbp(x.amount)}${x.essential ? ' (essential)' : ''}`).join('; '));
  const groups = {};
  F.transactions().reverse().forEach(t => { const k = t.date.slice(0, 7) + ' ' + t.category; (groups[k] = groups[k] || []).push(t); });
  Object.entries(groups).forEach(([k, list]) =>
    add('transactions', 'transactions', `Past transactions: ${k}`, list.map(t => `${t.date} ${t.merchant} ${gbp(t.amount)}`).join('; ')));
  KB.forEach(k => add('knowledge', 'knowledge', k.title, k.text));
  docs.forEach(d => { d.tokens = tok(d.title + ' ' + d.title + ' ' + d.text); d.len = d.tokens.length; });
  return docs;
}

function search(query, k = 5) {
  const docs = buildCorpus(), N = docs.length;
  const avg = docs.reduce((a, d) => a + d.len, 0) / N, df = {};
  docs.forEach(d => new Set(d.tokens).forEach(t => (df[t] = (df[t] || 0) + 1)));
  const q = tok(query);
  const scored = docs
    .map(d => {
      const tf = {};
      d.tokens.forEach(t => (tf[t] = (tf[t] || 0) + 1));
      let sc = 0;
      q.forEach(t => {
        if (!tf[t]) return;
        const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
        sc += (idf * (tf[t] * 2.2)) / (tf[t] + 1.2 * (0.25 + (0.75 * d.len) / avg));
      });
      return { d, sc };
    })
    .filter(x => x.sc > 0)
    .sort((a, b) => b.sc - a.sc);
  const picked = scored.slice(0, k).map(x => x.d);
  const core = docs.filter(d => d.kind === "profile" || (d.kind === "account" && /position|subscriptions|Upcoming|Planned|projection/.test(d.title)));
  return [...core, ...picked.filter(d => !core.includes(d))].slice(0, core.length + k);
}
module.exports = { search };
