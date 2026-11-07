// Retrieval: builds a corpus from (1) the user's profile, (2) their transaction data (summaries + raw rows),
// (3) a curated knowledge base. Scores with BM25. Swap `search` for an embedding model later; callers don't change.
const fs = require('fs'), path = require('path');
const F = require('./finance');
const { gbp } = F;

const STOP = new Set('a an the and or of to in on for is are was were be been it my me i you your we our with at by from that this what how can do does did if so as but not no about have has had will would should could into than then there their they them its'.split(' '));
const stem = w => w.replace(/(ing|ed|es|s)$/, '');
const tok = s => (s.toLowerCase().match(/[a-z0-9£]+/g) || []).filter(w => !STOP.has(w)).map(stem);

function buildCorpus() {
  const docs = [];
  const add = (source, kind, title, text) => docs.push({ id: docs.length + 1, source, kind, title, text });
  const p = F.profile, s = F.snapshot();
  add('profile', 'profile', 'About the user',
    Object.entries(p).filter(([k]) => k !== 'goals').map(([k, v]) => `${k}: ${v}`).join('\n') + '\ngoals: ' + p.goals.join('; '));
  add('account', 'account', 'Current account position',
    `As of ${s.asOf}: current account balance ${gbp(s.balance)}. Arranged overdraft limit ${gbp(s.overdraftLimit)}. Savings pot ${gbp(s.savingsPot)}. Lowest balance in the last 60 days was ${gbp(s.minBal)}; the account was overdrawn on ${s.daysInOverdraft} transactions. Overdraft interest paid in the last two months: ${gbp(s.feesTotal)}.`);
  add('account', 'account', 'Income',
    `October income was ${gbp(s.octIncome)} (weekly wages paid on Fridays). Lowest normal week ${gbp(s.lowWeek)}, average week ${gbp(s.avgWeek)}. Pay varies with shifts, so budget from the lowest week. Next paydays: ${s.nextFridays.join(', ')}.`);
  add('account', 'account', 'October spending by category',
    `Total spent in October ${gbp(s.octSpend)}. ` + Object.entries(s.octCats).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${gbp(v)}`).join(', ') + '.');
  add('account', 'account', 'Upcoming bills in the next 14 days',
    s.next14.length ? s.next14.map(u => `${u.merchant} ${gbp(-u.amount)} due ${u.due} (in ${u.inDays} days)`).join('; ') + `. Total ${gbp(s.billsNext14)}.` : 'No known bills in the next 14 days.');
  add('account', 'account', 'All recurring bills and subscriptions',
    s.upcoming.map(u => `${u.merchant} (${u.category}) ${gbp(-u.amount)} monthly around day ${u.due.slice(8)}`).join('; ') + '.');
  add('account', 'account', 'Cashflow projection and payday',
    `Next payday is ${s.nextFridays[0]}, in ${s.daysToPay} days. Bills leaving before then: ${gbp(s.billsBeforePay)}. Estimated food and travel before payday: ${gbp(s.dailyEssentials * s.daysToPay)}. Estimated lowest balance before payday: ${gbp(s.lowPoint)}. ` +
    `Cautious projection for the next 14 days: start ${gbp(s.balance)}, minus bills ${gbp(s.billsNext14)}, minus about ${gbp(s.dailyEssentials)} a day on groceries and transport, plus two pay weeks at the lowest normal week (${gbp(s.expectedPay)}) gives about ${gbp(s.projected14)}.`);
  const groups = {};
  F.tx.forEach(t => { const k = t.date.slice(0, 7) + ' ' + t.category; (groups[k] = groups[k] || []).push(t); });
  Object.entries(groups).forEach(([k, list]) =>
    add('transactions', 'transactions', `Transactions: ${k}`, list.map(t => `${t.date} ${t.merchant} ${gbp(t.amount)}`).join('; ')));
  const dir = path.join(__dirname, 'data', 'knowledge');
  fs.readdirSync(dir).filter(f => f.endsWith('.md')).forEach(f => {
    fs.readFileSync(path.join(dir, f), 'utf8').split(/^# /m).filter(Boolean).forEach(sec => {
      const [title, ...rest] = sec.split('\n');
      add('knowledge', 'knowledge', title.trim(), rest.join('\n').trim());
    });
  });
  docs.forEach(d => { d.tokens = tok(d.title + ' ' + d.title + ' ' + d.text); d.len = d.tokens.length; });
  return docs;
}

const docs = buildCorpus();
const avg = docs.reduce((a, d) => a + d.len, 0) / docs.length;
const df = {};
docs.forEach(d => new Set(d.tokens).forEach(t => (df[t] = (df[t] || 0) + 1)));

function search(query, k = 5) {
  const q = tok(query), N = docs.length;
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
  [docs[1], docs[0]].forEach(d => { if (!picked.includes(d)) picked.unshift(d); }); // always ground in who/where the user is
  return picked.slice(0, k + 2);
}
module.exports = { search, docs };
