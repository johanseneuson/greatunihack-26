// Generates deterministic demo transactions for the demo user (Maya). Run: npm run seed
const fs = require('fs'), path = require('path');
let s = 42; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
const between = (a, b) => Math.round((a + rnd() * (b - a)) * 100) / 100;
const pick = a => a[Math.floor(rnd() * a.length)];
const end = new Date('2026-11-07T12:00:00Z'), start = new Date('2026-09-08T12:00:00Z');
const tx = []; const add = (d, merchant, category, amount) => tx.push({ date: d.toISOString().slice(0, 10), merchant, category, amount: Math.round(amount * 100) / 100 });
for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
  const day = d.getUTCDate(), dow = d.getUTCDay(), c = new Date(d);
  if (dow === 5) add(c, 'Weekly wages - Highstreet Retail Ltd', 'income', between(150, 260));
  if (day === 1) add(c, 'Rent - Flat 4', 'rent', -520);
  if (day === 3) add(c, 'Octopus Energy', 'bills', -48);
  if (day === 12) add(c, 'Giffgaff mobile', 'bills', -16);
  if (day === 18) add(c, 'Broadband', 'bills', -22);
  if (day === 9) add(c, 'Spotify', 'subscriptions', -11);
  if (day === 20) add(c, 'Netflix', 'subscriptions', -10.99);
  if (day === 25) add(c, 'PureGym', 'subscriptions', -19.99);
  if (day === 14) add(c, 'Klarna', 'debt', -35);
  if (day === 28) add(c, 'Money transfer - family', 'remittance', -40);
  if (day === 30 || (day === 28 && d.getUTCMonth() === 1)) add(c, 'Overdraft interest', 'fees', -between(5.5, 7.5));
  if (rnd() < 0.62) add(c, pick(['Bus - TfGM', 'Tram - Metrolink', 'Bus - TfGM']), 'transport', -between(2.5, 6.5));
  if ((dow === 1 || dow === 4 || dow === 6) && rnd() < 0.85) add(c, pick(['Tesco', 'Aldi', 'Lidl', 'Co-op']), 'groceries', -between(8, 31));
  if (rnd() < 0.2) add(c, pick(['Greggs', 'Nando\'s', 'Pret', 'Deliveroo', 'Costa']), 'eating out', -between(4, 17));
  if (rnd() < 0.07) add(c, pick(['Primark', 'ASOS', 'Amazon', 'Boots']), 'shopping', -between(12, 48));
}
tx.sort((a, b) => a.date.localeCompare(b.date));
const net = tx.reduce((a, t) => a + t.amount, 0);
const opening = Math.round((96.4 - net) * 100) / 100;
let bal = opening; tx.forEach((t, i) => { bal = Math.round((bal + t.amount) * 100) / 100; t.id = i + 1; t.balance = bal; });
fs.writeFileSync(path.join(__dirname, 'transactions.json'), JSON.stringify({ asOf: '2026-11-07', currency: 'GBP', arrangedOverdraft: 250, savingsPot: 140, transactions: tx }, null, 1));
console.log(tx.length, 'transactions; closing balance', bal, 'opening', opening);
