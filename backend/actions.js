// Actions the coach can PROPOSE. Nothing runs until the user taps Confirm in the UI, and the server re-validates every
// action against the database at that point (the model's wording is never trusted, labels are built from DB rows).
const D = require('./db');
const { gbp, asOf } = require('./finance');

const TOOLS = [
  { name: 'pause_subscription', description: 'Propose pausing/cancelling a NON-essential recurring payment (subscription). Use the id from the context. Never for essential items such as rent, energy, phone, debt or transfers.', input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
  { name: 'resume_subscription', description: 'Propose switching a paused recurring payment back on.', input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
  { name: 'remove_planned_expense', description: 'Propose removing a planned one-off future expense. Use the id from the context.', input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
  { name: 'add_planned_expense', description: 'Propose adding a planned future one-off expense that the user explicitly told you about, with an exact amount and date (YYYY-MM-DD). Never invent values.', input_schema: { type: 'object', properties: { description: { type: 'string' }, amount: { type: 'number', description: 'positive pounds' }, date: { type: 'string' }, essential: { type: 'boolean' } }, required: ['description', 'amount', 'date'] } }
];

// Returns { ok, label, run } or { ok:false, error }.
function check(a) {
  const rec = () => D.get('SELECT * FROM recurring WHERE id=?', Number(a.id));
  switch (a && a.type) {
    case 'pause_subscription': {
      const r = rec(); if (!r) return { ok: false, error: 'I could not find that payment.' };
      if (r.essential) return { ok: false, error: `${r.merchant} is an essential payment, so I can't cancel it here. Contact the provider, or free help like Citizens Advice, if you are struggling to pay it.` };
      if (!r.active) return { ok: false, error: `${r.merchant} is already paused.` };
      return { ok: true, label: `Pause ${r.merchant} (${gbp(-r.amount)} a month)`, run: () => { D.run('UPDATE recurring SET active=0 WHERE id=?', r.id); return `Paused ${r.merchant}. It will no longer count in your upcoming payments.`; } };
    }
    case 'resume_subscription': {
      const r = rec(); if (!r) return { ok: false, error: 'I could not find that payment.' };
      if (r.active) return { ok: false, error: `${r.merchant} is already active.` };
      return { ok: true, label: `Switch ${r.merchant} back on (${gbp(-r.amount)} a month)`, run: () => { D.run('UPDATE recurring SET active=1 WHERE id=?', r.id); return `${r.merchant} is back on.`; } };
    }
    case 'remove_planned_expense': {
      const p = D.get('SELECT * FROM planned_expenses WHERE id=?', Number(a.id)); if (!p) return { ok: false, error: 'I could not find that planned expense.' };
      return { ok: true, label: `Remove planned expense: ${p.description} (${gbp(-p.amount)}, ${p.date})`, run: () => { D.run('DELETE FROM planned_expenses WHERE id=?', p.id); return `Removed ${p.description}.`; } };
    }
    case 'add_planned_expense': {
      const amt = Math.abs(Number(a.amount)), date = String(a.date || ''), desc = String(a.description || '').trim().slice(0, 80);
      if (!desc || !(amt > 0) || amt > 100000 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date))) return { ok: false, error: 'I need a clear description, amount and date to add that.' };
      if (date <= asOf()) return { ok: false, error: 'That date is not in the future.' };
      return { ok: true, label: `Add planned expense: ${desc} (${gbp(amt)}, ${date})`, run: () => { D.run('INSERT INTO planned_expenses (date,description,category,amount,essential) VALUES (?,?,?,?,?)', date, desc, 'other', -amt, a.essential ? 1 : 0); return `Added ${desc} on ${date}.`; } };
    }
    default: return { ok: false, error: 'Unknown action.' };
  }
}
// Turn model tool calls into UI proposals (safe, DB-derived labels) and plain-language refusals.
function propose(toolUses) {
  const actions = [], notes = [];
  toolUses.forEach(t => {
    const a = { type: t.name, ...t.input }, c = check(a);
    if (c.ok) actions.push({ action: a, label: c.label }); else notes.push(c.error);
  });
  return { actions, notes };
}
function execute(a) { const c = check(a); return c.ok ? { ok: true, message: c.run() } : { ok: false, message: c.error }; }
module.exports = { TOOLS, propose, execute };
