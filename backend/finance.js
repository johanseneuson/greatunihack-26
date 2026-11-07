// Deterministic maths over the user's data. The LLM is given these numbers; it should not invent its own.
const fs = require('fs'), path = require('path');
const load = f => JSON.parse(fs.readFileSync(path.join(__dirname, 'data', f), 'utf8'));
const profile = load('profile.json');
const bank = load('transactions.json');
const tx = bank.transactions;
const gbp = n => (n < 0 ? '-£' : '£') + Math.abs(n).toFixed(2);
const sum = a => a.reduce((x, t) => x + t.amount, 0);
const month = t => t.date.slice(0, 7);

function byCategory(list) {
  const m = {};
  list.filter(t => t.amount < 0).forEach(t => (m[t.category] = (m[t.category] || 0) + -t.amount));
  return m;
}

function snapshot() {
  const balance = tx[tx.length - 1].balance;
  const full = tx.filter(t => month(t) === '2026-10');
  const income = sum(full.filter(t => t.amount > 0));
  const spend = -sum(full.filter(t => t.amount < 0));
  const cats = byCategory(full);
  const weeklyPay = tx.filter(t => t.category === 'income').map(t => t.amount);
  const lowWeek = Math.min(...weeklyPay);
  const avgWeek = weeklyPay.reduce((a, b) => a + b, 0) / weeklyPay.length;
  const subs = tx.filter(t => t.category === 'subscriptions' && month(t) === '2026-10');
  const fees = -sum(tx.filter(t => t.category === 'fees'));
  const od = tx.filter(t => t.balance < 0);
  const minBal = Math.min(...tx.map(t => t.balance));
  const today = new Date(bank.asOf + 'T12:00:00Z');
  const recurring = [
    ...new Map(
      tx
        .filter(t => ['rent', 'bills', 'subscriptions', 'debt', 'remittance'].includes(t.category) && month(t) === '2026-10')
        .map(t => [t.merchant, t])
    ).values()
  ];
  const upcoming = recurring
    .map(r => {
      const dom = +r.date.slice(8);
      let due = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), dom, 12));
      if (due <= today) due = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, dom, 12));
      return { merchant: r.merchant, category: r.category, amount: r.amount, due: due.toISOString().slice(0, 10), inDays: Math.round((due - today) / 864e5) };
    })
    .sort((a, b) => a.inDays - b.inDays);
  const next14 = upcoming.filter(u => u.inDays <= 14);
  const nextFridays = [0, 1].map(i => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7 || 7) + i * 7);
    return d.toISOString().slice(0, 10);
  });
  const expectedPay = lowWeek * 2; // cautious: lowest normal week x2
  const billsNext14 = -sum(next14);
  const dailyEssentials = ((cats.groceries || 0) + (cats.transport || 0)) / 31;
  const daysToPay = Math.round((new Date(nextFridays[0] + 'T12:00:00Z') - today) / 864e5);
  const billsBeforePay = -sum(upcoming.filter(u => u.inDays <= daysToPay));
  const lowPoint = balance - billsBeforePay - dailyEssentials * daysToPay;
  const projected14 = balance - billsNext14 - dailyEssentials * 14 + expectedPay;
  return {
    asOf: bank.asOf, balance, overdraftLimit: bank.arrangedOverdraft, savingsPot: bank.savingsPot,
    octIncome: income, octSpend: spend, octCats: cats, lowWeek, avgWeek,
    subsMonthly: -sum(subs), subs, feesTotal: fees, daysInOverdraft: od.length, minBal,
    upcoming, next14, billsNext14, daysToPay, billsBeforePay, lowPoint, nextFridays, dailyEssentials, expectedPay, projected14
  };
}

function insights() {
  const s = snapshot();
  const out = [];
  if (s.lowPoint < 50)
    out.push({
      id: 'shortfall', level: 'warn', title: 'Very tight until payday',
      body: `Payday is in ${s.daysToPay} days (${s.nextFridays[0]}). Before then about ${gbp(s.billsBeforePay)} of bills leave your account, plus roughly ${gbp(s.dailyEssentials * s.daysToPay)} for food and travel. With ${gbp(s.balance)} now, you could drop to about ${gbp(s.lowPoint)}. That leaves almost no room for a surprise.`,
      ask: 'How do I get through to payday?'
    });
  if (s.balance < 0)
    out.push({
      id: 'overdraft', level: 'warn', title: 'You are in your overdraft',
      body: `You are ${gbp(s.balance)} against a ${gbp(s.overdraftLimit)} limit. Overdraft interest has cost you ${gbp(s.feesTotal)} in the last two months.`,
      ask: 'How do I stop using my overdraft?'
    });
  const unused = s.subs.find(x => /gym/i.test(x.merchant));
  if (unused)
    out.push({
      id: 'subs', level: 'tip', title: 'Subscriptions: ' + gbp(s.subsMonthly) + ' a month',
      body: `That is ${gbp(s.subsMonthly * 12)} a year. If you are not using ${unused.merchant} (${gbp(-unused.amount)}/month), pausing it would help your buffer.`,
      ask: 'Which subscriptions should I cut?'
    });
  out.push({
    id: 'buffer', level: 'goal', title: 'Goal: £500 emergency buffer',
    body: `You have ${gbp(s.savingsPot)} saved, ${Math.round((s.savingsPot / 500) * 100)}% of the way. Saving £10 each payday gets you there in about ${Math.ceil((500 - s.savingsPot) / 10)} weeks.`,
    ask: 'Make me a plan to reach £500.'
  });
  out.push({
    id: 'benefits', level: 'tip', title: 'Worth checking: extra support',
    body: 'With variable weekly pay you might be able to get Universal Credit top-ups and Help to Save. Checking is free and confidential.',
    ask: 'Could I be eligible for Universal Credit?'
  });
  return {
    snapshot: { balance: s.balance, overdraftLimit: s.overdraftLimit, savingsPot: s.savingsPot, octIncome: s.octIncome, octSpend: s.octSpend, upcoming: s.next14 },
    insights: out
  };
}

module.exports = { profile, bank, tx, snapshot, insights, gbp, byCategory, sum, month };
