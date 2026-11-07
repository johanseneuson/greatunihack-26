// Finance Buddy web app. Talks to the FastAPI backend on the same origin (/api/users/{id}/...).
const $ = s => document.querySelector(s);
const gbp = n => (n < 0 ? '-£' : '£') + Math.abs(n).toFixed(2);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { } } };
const RTL = ['العربية', 'Urdu (اردو)'];
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
let history = [], uid = store.get('fb_who') || '2', firstName = '';
const api = p => `/api/users/${uid}${p}`;

// ---- settings / accessibility ----
const root = document.documentElement;
function applySettings() {
  root.classList.toggle('big', $('#big').checked);
  root.classList.toggle('contrast', $('#contrast').checked);
  document.body.dir = RTL.includes($('#lang').value) ? 'rtl' : 'ltr';
  ['lang', 'plain', 'big', 'contrast'].forEach(k => store.set('fb_' + k, k === 'lang' ? $('#lang').value : $('#' + k).checked));
}
['lang', 'plain', 'big', 'contrast'].forEach(k => {
  const saved = store.get('fb_' + k), el = $('#' + k);
  if (saved !== null) { if (k === 'lang') el.value = saved; else el.checked = saved === 'true'; }
  el.addEventListener('change', applySettings);
});
applySettings();
$('#settingsBtn').onclick = () => {
  const s = $('#settings'); s.hidden = !s.hidden; $('#settingsBtn').setAttribute('aria-expanded', String(!s.hidden));
};
$('#who').value = uid;
$('#who').onchange = () => { uid = $('#who').value; store.set('fb_who', uid); history = []; $('#log').innerHTML = ''; $('#chips').innerHTML = ''; loadHome().then(firstRun); if (!$('#money').hidden) loadMoney(); };

// ---- chat ----
function bubble(role, text, extra) {
  const d = document.createElement('div'); d.className = 'msg ' + role; d.textContent = text;
  if (extra) d.append(extra);
  $('#log').append(d); d.scrollIntoView({ block: 'end', behavior: 'smooth' });
  return d;
}
// A proposed action from the coach. Nothing happens until the user taps Confirm; the server re-checks it first.
function actionCard(a) {
  const d = document.createElement('div'); d.className = 'msg bot action';
  const p = document.createElement('p'); p.textContent = a.label;
  const row = document.createElement('div'); row.className = 'arow';
  const yes = document.createElement('button'); yes.className = 'primary'; yes.textContent = 'Confirm';
  const no = document.createElement('button'); no.className = 'ghost'; no.textContent = 'No thanks';
  no.onclick = () => { d.remove(); history.push({ role: 'user', content: '[I declined: ' + a.label + ']' }); };
  yes.onclick = async () => {
    yes.disabled = no.disabled = true;
    const r = await post(api('/actions'), { action: a.action }), j = await r.json();
    d.remove();
    bubble('bot', (j.ok ? '✓ ' : '') + j.message);
    history.push({ role: 'user', content: '[I ' + (j.ok ? 'confirmed and it was done' : 'tried but it failed') + ': ' + a.label + ']' });
    loadHome(); if (!$('#money').hidden) loadMoney();
  };
  row.append(yes, no); d.append(p, row);
  $('#log').append(d); d.scrollIntoView({ block: 'end', behavior: 'smooth' });
}
function sourcesEl(sources, mode, grounded) {
  const w = document.createElement('div');
  const det = document.createElement('details'); det.className = 'src';
  det.innerHTML = '<summary>What I looked at</summary>';
  const ol = document.createElement('ol');
  sources.forEach(s => { const li = document.createElement('li'); li.value = s.n; li.textContent = `${s.title} (${s.kind === 'knowledge' ? 'guidance' : s.kind === 'profile' ? 'your profile' : 'your account'})`; ol.append(li); });
  det.append(ol); w.append(det);
  const b = document.createElement('div'); b.className = 'badge';
  b.textContent = mode !== 'llm' ? 'Basic answer (AI not connected)' : grounded === false ? 'Numbers could not be verified, so I kept it to facts' : 'AI answer. Figures checked against your data';
  w.append(b); return w;
}
async function ask(q) {
  q = q.trim(); if (!q) return;
  showTab('coach');
  bubble('me', q); history.push({ role: 'user', content: q });
  $('#msg').value = ''; $('#send').disabled = true;
  const t = document.createElement('div'); t.className = 'msg bot typing'; t.setAttribute('aria-label', 'Finance Buddy is typing'); t.innerHTML = '<i></i><i></i><i></i>';
  $('#log').append(t); t.scrollIntoView({ block: 'end' });
  try {
    const r = await post(api('/chat'), { messages: history.slice(-20), language: $('#lang').value, plain: $('#plain').checked });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    history.push({ role: 'assistant', content: j.reply });
    t.remove(); bubble('bot', j.reply, sourcesEl(j.sources, j.mode, j.grounded));
    (j.actions || []).forEach(a => actionCard(a));
  } catch {
    t.remove(); bubble('bot', 'Sorry, I could not reach the server. Please try again.');
    history.pop();
  } finally { $('#send').disabled = false; }
}
$('#form').addEventListener('submit', e => { e.preventDefault(); ask($('#msg').value); });

// ---- voice input (optional, where the browser supports it) ----
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SR) {
  const mic = $('#mic'); mic.hidden = false;
  const codes = { 'English': 'en-GB', 'Español': 'es-ES', 'Polski': 'pl-PL', 'Português': 'pt-PT', 'Français': 'fr-FR', 'العربية': 'ar-SA', 'Română': 'ro-RO', 'Bengali (বাংলা)': 'bn-BD', 'Urdu (اردو)': 'ur-PK' };
  mic.onclick = () => {
    const rec = new SR(); rec.lang = codes[$('#lang').value] || 'en-GB';
    mic.textContent = '…';
    rec.onresult = e => { $('#msg').value = e.results[0][0].transcript; };
    rec.onend = () => { mic.textContent = '🎤'; if ($('#msg').value) $('#msg').focus(); };
    rec.onerror = () => { mic.textContent = '🎤'; };
    rec.start();
  };
}

// ---- home: balance, safe-to-spend and early warnings from the backend's analytics ----
const LEVEL = { critical: 'warn', warning: 'warn', info: 'tip', positive: 'goal' };
async function loadHome() {
  try {
    const d = await (await fetch(api('/insights/dashboard'))).json();
    const o = d.overview; firstName = o.user.name.split(' ')[0];
    $('#bal').textContent = gbp(o.balance);
    const s = d.budget && d.budget.safe_to_spend;
    $('#sav').textContent = s ? gbp(s.today) : '–';
    $('#od').textContent = d.resilience ? `Resilience ${d.resilience.score}/100 · ${d.resilience.label}` : '';
    const cards = $('#cards'); cards.innerHTML = '';
    (d.warnings || []).slice(0, 6).forEach(w => {
      const c = document.createElement('div'); c.className = 'card ' + (LEVEL[w.severity] || 'tip');
      const h = document.createElement('h3'); h.textContent = w.title;
      const p = document.createElement('p'); p.textContent = w.message + (w.upside ? ' ' + w.upside : '');
      const b = document.createElement('button'); b.textContent = 'Help me with this';
      b.onclick = () => { ask(`Help me with this: ${w.title}`); $('#chat').scrollIntoView({ behavior: 'smooth' }); };
      c.append(h, p, b); cards.append(c);
    });
  } catch { $('#cards').textContent = 'Could not load your insights.'; }
}
function firstRun() {
  bubble('bot', `Hi ${firstName || 'there'}, I am your Finance Buddy. I can see your account, your bills and what is coming up, so I can give advice that fits your life. What would you like help with?`);
  ['Can I afford £30 this week?', 'Where does my money go?', 'Which subscriptions could I cut?', 'What help can I get?'].forEach(q => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = q; b.onclick = () => ask(q); $('#chips').append(b);
  });
}

// ---- tabs ----
function showTab(name) {
  const coach = name === 'coach';
  $('#coach').hidden = !coach; $('#money').hidden = coach; $('#form').hidden = !coach;
  $('#t-coach').setAttribute('aria-selected', String(coach)); $('#t-money').setAttribute('aria-selected', String(!coach));
  if (!coach) loadMoney();
}
$('#t-coach').onclick = () => showTab('coach');
$('#t-money').onclick = () => showTab('money');

// ---- expenses & subscriptions (past and future; the coach reads the same data) ----
let view = 'upcoming', moneyData = null;
const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
document.querySelectorAll('.seg button').forEach(b => b.onclick = () => {
  view = b.dataset.v;
  document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  renderMoney();
});
async function loadMoney() { moneyData = await (await fetch(api('/expenses'))).json(); renderMoney(); }
function itemHtml(name, detail, amt, extra = '', off = false) {
  return `<div class="item${off ? ' off' : ''}"><span class="n">${esc(name)}</span><span class="a${amt > 0 ? ' pos' : ''}">${gbp(amt)}</span><span class="d">${esc(detail)}</span>${extra}</div>`;
}
function renderMoney() {
  if (!moneyData) return;
  let h = '';
  $('#addForm').hidden = view !== 'upcoming';
  if (view === 'upcoming') {
    const out = moneyData.upcoming.filter(u => u.in_days <= 30 && u.amount < 0).reduce((a, u) => a + u.amount, 0);
    h += `<div class="sum">Next 30 days: ${gbp(-out)} going out</div>`;
    moneyData.upcoming.forEach(u => {
      const del = u.planned_id ? `<div class="act"><button data-del="${u.planned_id}" aria-label="Remove ${esc(u.name)}">Remove</button></div>` : '';
      h += itemHtml(u.name, `${fmtDate(u.date)} · in ${u.in_days} days · ${u.kind}${u.essential ? ' · essential' : ''}`, u.amount, del);
    });
    if (!moneyData.upcoming.length) h += '<p class="fine">Nothing scheduled yet.</p>';
  } else if (view === 'subs') {
    const act = moneyData.subscriptions.filter(r => !r.paused), mo = act.reduce((a, r) => a + r.amount, 0);
    h += `<div class="sum">Active subscriptions and bills: ${gbp(mo)} a typical period (paused ones excluded)</div>`;
    moneyData.subscriptions.forEach(r => {
      const btn = r.essential ? '' : `<div class="act"><button data-sub="${r.series_id}" data-pause="${r.paused ? 0 : 1}">${r.paused ? 'Switch back on' : 'Pause / cancel'}</button></div>`;
      h += itemHtml(r.name, `${r.period} · next ${fmtDate(r.next_date)} · ${r.kind}${r.paused ? ' · PAUSED' : ''}`, -r.amount, btn, r.paused);
    });
    if (!moneyData.subscriptions.length) h += '<p class="fine">No recurring payments detected yet.</p>';
  } else {
    let last = '';
    moneyData.past.forEach(t => {
      const m = new Date(t.date + 'T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      if (m !== last) { h += `<div class="mh">${m}</div>`; last = m; }
      h += itemHtml(t.name, `${fmtDate(t.date)} · ${t.category}`, t.amount);
    });
  }
  const l = $('#mlist'); l.innerHTML = h;
  const run = async action => { await post(api('/actions'), { action }); loadMoney(); loadHome(); };
  l.querySelectorAll('[data-del]').forEach(b => b.onclick = () => run({ type: 'remove_planned_expense', planned_id: +b.dataset.del }));
  l.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => run({ type: b.dataset.pause === '1' ? 'pause_subscription' : 'resume_subscription', series_id: b.dataset.sub }));
}
$('#addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const r = await (await post(api('/actions'), { action: { type: 'add_planned_expense', description: $('#aDesc').value, amount: +$('#aAmt').value, date: $('#aDate').value, essential: $('#aEss').checked } })).json();
  if (r.ok) { e.target.reset(); $('#aErr').textContent = ''; loadMoney(); loadHome(); }
  else $('#aErr').textContent = r.message;
});

loadHome().then(firstRun);
