// SQLite database (Node's built-in node:sqlite, no install). File: backend/data/finance.db (git-ignored, auto-created and seeded).
//   transactions      - past money in/out (the bank feed)
//   recurring         - bills, subscriptions, debt and transfers that repeat monthly (past AND future)
//   planned_expenses  - known one-off future costs (dentist, train ticket, gifts...)
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'data');
const db = new DatabaseSync(path.join(dir, 'finance.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, merchant TEXT NOT NULL, category TEXT NOT NULL,
  amount REAL NOT NULL, balance REAL NOT NULL);
CREATE INDEX IF NOT EXISTS tx_date ON transactions(date);
CREATE TABLE IF NOT EXISTS recurring (
  id INTEGER PRIMARY KEY, merchant TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('bill','subscription','debt','transfer','rent')),
  category TEXT NOT NULL, amount REAL NOT NULL, day_of_month INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, essential INTEGER NOT NULL DEFAULT 0, note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS planned_expenses (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
  amount REAL NOT NULL, essential INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`);

const count = t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;

if (count('transactions') === 0) {
  const bank = JSON.parse(fs.readFileSync(path.join(dir, 'transactions.json'), 'utf8'));
  const ins = db.prepare('INSERT INTO transactions (id,date,merchant,category,amount,balance) VALUES (?,?,?,?,?,?)');
  db.exec('BEGIN');
  bank.transactions.forEach(t => ins.run(t.id, t.date, t.merchant, t.category, t.amount, t.balance));
  db.exec('COMMIT');
  const meta = db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)');
  meta.run('asOf', bank.asOf); meta.run('arrangedOverdraft', String(bank.arrangedOverdraft)); meta.run('savingsPot', String(bank.savingsPot));
}
if (count('recurring') === 0) {
  const r = db.prepare('INSERT INTO recurring (merchant,type,category,amount,day_of_month,essential,note) VALUES (?,?,?,?,?,?,?)');
  [
    ['Rent - Flat 4', 'rent', 'rent', -520, 1, 1, 'Shared flat, paid on the 1st'],
    ['Octopus Energy', 'bill', 'bills', -48, 3, 1, 'Energy. Cheaper in summer'],
    ['Giffgaff mobile', 'bill', 'bills', -16, 12, 1, 'Phone'],
    ['Broadband', 'bill', 'bills', -22, 18, 1, 'Home internet'],
    ['Spotify', 'subscription', 'subscriptions', -11, 9, 0, 'Used most days'],
    ['Netflix', 'subscription', 'subscriptions', -10.99, 20, 0, 'Used a few times a month'],
    ['PureGym', 'subscription', 'subscriptions', -19.99, 25, 0, 'Not used in the last 2 months'],
    ['Klarna', 'debt', 'debt', -35, 14, 1, 'Buy-now-pay-later plan, about £210 left'],
    ['Money transfer - family', 'transfer', 'remittance', -40, 28, 1, 'Sent to family abroad each month']
  ].forEach(x => r.run(...x));
}
if (count('planned_expenses') === 0) {
  const p = db.prepare('INSERT INTO planned_expenses (date,description,category,amount,essential) VALUES (?,?,?,?,?)');
  [
    ['2026-11-19', 'Dentist check-up', 'health', -26.8, 1],
    ['2026-11-22', 'Friend\'s birthday present', 'shopping', -25, 0],
    ['2026-12-06', 'Train ticket home for Christmas', 'transport', -62, 1],
    ['2026-12-20', 'Christmas gifts', 'shopping', -40, 0]
  ].forEach(x => p.run(...x));
}

module.exports = {
  db,
  all: (sql, ...a) => db.prepare(sql).all(...a).map(r => ({ ...r })),
  get: (sql, ...a) => { const r = db.prepare(sql).get(...a); return r && { ...r }; },
  run: (sql, ...a) => db.prepare(sql).run(...a),
  meta: k => db.prepare('SELECT value FROM meta WHERE key=?').get(k)?.value
};
