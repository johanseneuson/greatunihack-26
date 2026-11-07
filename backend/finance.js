// Deterministic maths over the user's data (read from SQLite). The LLM is given these numbers; it should not invent its own.
const fs = require('fs'), path = require('path');
const D = require('./db');
const profile = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'profile.json'), 'utf8'));
const gbp = n => (n < 0 ? '-£' : '£') + Math.abs(n).toFixed(2);
const sum = a => a.reduce((x, t) => x + t.amount, 0);
const asOf = () => D.meta('asOf');
const DAY = 864e5;
const isoDate = d => d.toISOString().slice(0, 10);

const transactions = (limit = 1e6) => D.all('SELECT * FROM transactions ORDER BY date DESC, id DESC LIMIT ?', limit);
const subscriptions = () => D.all('SELECT * FROM recurring ORDER BY ABS(amount) DESC');
const planned = () => D.all('SELECT * FROM planned_expenses ORDER BY date');

function byCategory(list) {
  const m = {};
  list.filter(t => t.amount < 0).forEach(t => (m[t.category] = (m[t.category] || 0) + -t.amount));
  return m;
}

// Every future outflow in the next `days` days: active recurring items + planned one-offs.
function schedule(days = 45) {
  const today = new Date(asOf() + 'T12:00:00Z'), items = [];
  D.all('SELECT * FROM recurring WHERE active=1').forEach(r => {
    for (let m = 0; m < 3; m++) {
      const due = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + m, Math.min(r.day_of_month, 28), 12));
      const inDays = Math.round((due - today) / DAY);
      if (inDays > 0 && inDays <= days) items.push({ kind: r.type, name: r.merchant, category: r.category, amount: r.amount, date: isoDate(due), inDays, essential: !!r.essential });
    }
  });
  planned().forEach(p => {
    const inDays = Math.round((new Date(p.date + 'T12:00:00Z') - today) / DAY);
    if (inDays > 0 && inDays <= days) items.push({ kind: 'planned', id: p.id, name: p.description, category: p.category, amount: p.amount, date: p.date, inDays, essential: !!p.essential });
  });
  return items.sort((a, b) => a.inDays - b.inDays);
}

function snapshot() {
  const tx = transactions();
  const balance = tx[0].balance;
  const overdraftLimit = +D.meta('arrangedOverdraft'), savingsPot = +D.meta('savingsPot');
  const today = new Date(asOf() + 'T12:00:00Z');
  const lastMonth = isoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))).slice(0, 7);
  const full = tx.filter(t => t.date.startsWith(lastMonth));
  const income = sum(full.filter(t => t.amount > 0)), spend = -sum(full.filter(t => t.amount < 0));
  const cats = byCategory(full);
  const weeklyPay = tx.filter(t => t.category === 'income').map(t => t.amount);
  const lowWeek = Math.min(...weeklyPay), avgWeek = weeklyPay.reduce((a, b) => a + b, 0) / weeklyPay.length;
  const subsActive = D.all("SELECT * FROM recurring WHERE type='subscription' AND active=1");
  const fees = -sum(tx.filter(t => t.category === 'fees'));
  const minBal = Math.min(...tx.map(t => t.balance)), daysInOverdraft = tx.filter(t => t.balance < 0).length;
  const upcoming = schedule(45);
  const next14 = upcoming.filter(u => u.inDays <= 14);
  const nextFridays = [0, 1].map(i => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7 || 7) + i * 7);
    return isoDate(d);
  });
  const expectedPay = lowWeek * 2;
  const billsNext14 = -sum(next14);
  const dailyEssentials = ((cats.groceries || 0) + (cats.transport || 0)) / 31;
  const daysToPay = Math.round((new Date(nextFridays[0] + 'T12:00:00Z') - today) / DAY);
  const billsBeforePay = -sum(upcoming.filter(u => u.inDays <= daysToPay));
  const lowPoint = balance - billsBeforePay - dailyEssentials * daysToPay;
  const projected14 = balance - billsNext14 - dailyEssentials * 14 + expectedPay;
  return {
    asOf: asOf(), balance, overdraftLimit, savingsPot, lastMonth, octIncome: income, octSpend: spend, octCats: cats, lowWeek, avgWeek,
    subsActive, subsMonthly: -sum(subsActive), feesTotal: fees, daysInOverdraft, minBal,
    upcoming, next14, billsNext14, daysToPay, billsBeforePay, lowPoint, nextFridays, dailyEssentials, expectedPay, projected14
  };
}

function insights() {
  const s = snapshot(), out = [];
  if (s.lowPoint < 50)
    out.push({ id: 'shortfall', level: 'warn', title: 'Very tight until payday',
      body: `Payday is in ${s.daysToPay} days (${s.nextFridays[0]}). Before then about ${gbp(s.billsBeforePay)} of bills leave your account, plus roughly ${gbp(s.dailyEssentials * s.daysToPay)} for food and travel. With ${gbp(s.balance)} now, you could drop to about ${gbp(s.lowPoint)}. That leaves almost no room for a surprise.`,
      ask: 'How do I get through to payday?' });
  if (s.balance < 0)
    out.push({ id: 'overdraft', level: 'warn', title: 'You are in your overdraft',
      body: `You are ${gbp(s.balance)} against a ${gbp(s.overdraftLimit)} limit. Overdraft interest has cost you ${gbp(s.feesTotal)} in the last two months.`,
      ask: 'How do I stop using my overdraft?' });
  const unused = s.subsActive.find(x => /not used/i.test(x.note));
  if (unused)
    out.push({ id: 'subs', level: 'tip', title: 'Subscriptions: ' + gbp(s.subsMonthly) + ' a month',
      body: `That is ${gbp(s.subsMonthly * 12)} a year. ${unused.merchant} (${gbp(-unused.amount)}/month) looks unused; pausing it would help your buffer.`,
      ask: 'Which subscriptions should I cut?' });
  const bigSoon = s.upcoming.filter(u => u.kind === 'planned' && u.inDays <= 30);
  if (bigSoon.length)
    out.push({ id: 'planned', level: 'tip', title: 'Coming up: ' + bigSoon.map(b => b.name).join(', '),
      body: 'You have planned costs of ' + gbp(-sum(bigSoon)) + ' in the next month on top of your usual bills. Worth setting money aside now.',
      ask: 'How should I prepare for my upcoming expenses?' });
  out.push({ id: 'buffer', level: 'goal', title: 'Goal: £500 emergency buffer',
    body: `You have ${gbp(s.savingsPot)} saved, ${Math.round((s.savingsPot / 500) * 100)}% of the way. Saving £10 each payday gets you there in about ${Math.ceil((500 - s.savingsPot) / 10)} weeks.`,
    ask: 'Make me a plan to reach £500.' });
  out.push({ id: 'benefits', level: 'tip', title: 'Worth checking: extra support',
    body: 'With variable weekly pay you might be able to get Universal Credit top-ups and Help to Save. Checking is free and confidential.',
    ask: 'Could I be eligible for Universal Credit?' });
  return { snapshot: { balance: s.balance, overdraftLimit: s.overdraftLimit, savingsPot: s.savingsPot, octIncome: s.octIncome, octSpend: s.octSpend, upcoming: s.next14 }, insights: out };
}

module.exports = { profile, snapshot, insights, schedule, transactions, subscriptions, planned, gbp, byCategory, sum, asOf };
