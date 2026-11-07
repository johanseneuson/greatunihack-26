const $ = s => document.querySelector(s);
const gbp = n => (n < 0 ? '-£' : '£') + Math.abs(n).toFixed(2);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const history = [];
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { } } };
const RTL = ['العربية', 'Urdu (اردو)'];
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

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
    const r = await post('/api/actions', { action: a.action }), j = await r.json();
    d.remove();
    bubble('bot', (r.ok ? '✓ ' : '') + j.message);
    history.push({ role: 'user', content: '[I confirmed and it was done: ' + a.label + ']' });
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
    const r = await post('/api/chat', { messages: history, language: $('#lang').value, plain: $('#plain').checked });
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

// ---- home data ----
async function loadHome() {
  try {
    const { snapshot: s, insights } = await (await fetch('/api/insights')).json();
    $('#bal').textContent = gbp(s.balance); $('#sav').textContent = gbp(s.savingsPot);
    $('#od').textContent = s.balance < 0 ? `In overdraft (limit ${gbp(s.overdraftLimit)})` : `Overdraft limit ${gbp(s.overdraftLimit)}`;
    const cards = $('#cards'); cards.innerHTML = '';
    insights.forEach(i => {
      const c = document.createElement('div'); c.className = 'card ' + i.level;
      const h = document.createElement('h3'); h.textContent = i.title;
      const p = document.createElement('p'); p.textContent = i.body;
      const b = document.createElement('button'); b.textContent = 'Help me with this';
      b.onclick = () => { ask(i.ask); $('#chat').scrollIntoView({ behavior: 'smooth' }); };
      c.append(h, p, b); cards.append(c);
    });
  } catch { $('#cards').textContent = 'Could not load your insights.'; }
}
function firstRun() {
  bubble('bot', 'Hi Maya, I am your Finance Buddy. I can see your account, your bills and what is coming up, so I can give advice that fits your life. What would you like help with?');
  ['Can I afford £30 this week?', 'Where does my money go?', 'Help me save £500', 'What help can I get?'].forEach(q => {
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

// ---- expenses & subscriptions (past and future; the coach reads the same database) ----
let view = 'upcoming', moneyData = null;
const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
document.querySelectorAll('.seg button').forEach(b => b.onclick = () => {
  view = b.dataset.v;
  document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  renderMoney();
});
async function loadMoney() { moneyData = await (await fetch('/api/expenses')).json(); renderMoney(); }
function itemHtml(name, detail, amt, extra = '', off = false) {
  return `<div class="item${off ? ' off' : ''}"><span class="n">${esc(name)}</span><span class="a${amt > 0 ? ' pos' : ''}">${gbp(amt)}</span><span class="d">${esc(detail)}</span>${extra}</div>`;
}
function renderMoney() {
  if (!moneyData) return;
  let h = '';
  $('#addForm').hidden = view !== 'upcoming';
  if (view === 'upcoming') {
    const tot = moneyData.upcoming.filter(u => u.inDays <= 30).reduce((a, u) => a + u.amount, 0);
    h += `<div class="sum">Next 30 days: ${gbp(-tot)} going out</div>`;
    moneyData.upcoming.forEach(u => {
      const del = u.kind === 'planned' ? `<div class="act"><button data-del="${u.id}" aria-label="Remove ${esc(u.name)}">Remove</button></div>` : '';
      h += itemHtml(u.name, `${fmtDate(u.date)} · in ${u.inDays} days · ${u.kind}${u.essential ? ' · essential' : ''}`, u.amount, del);
    });
  } else if (view === 'subs') {
    const act = moneyData.subscriptions.filter(r => r.active), mo = act.reduce((a, r) => a + r.amount, 0);
    h += `<div class="sum">Active: ${gbp(-mo)} a month (${gbp(-mo * 12)} a year)</div>`;
    moneyData.subscriptions.forEach(r => {
      const btn = r.essential ? '' : `<div class="act"><button data-sub="${r.id}" data-active="${r.active ? 0 : 1}">${r.active ? 'Pause / cancel' : 'Switch back on'}</button></div>`;
      h += itemHtml(r.merchant, `Day ${r.day_of_month} monthly · ${r.type}${r.essential ? ' · essential' : ''}${r.note ? ' · ' + r.note : ''}${r.active ? '' : ' · PAUSED'}`, r.amount, btn, !r.active);
    });
  } else {
    let last = '';
    moneyData.past.forEach(t => {
      const m = new Date(t.date + 'T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      if (m !== last) { h += `<div class="mh">${m}</div>`; last = m; }
      h += itemHtml(t.merchant, `${fmtDate(t.date)} · ${t.category}`, t.amount);
    });
  }
  const l = $('#mlist'); l.innerHTML = h;
  l.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await fetch('/api/planned/' + b.dataset.del, { method: 'DELETE' }); loadMoney(); loadHome(); });
  l.querySelectorAll('[data-sub]').forEach(b => b.onclick = async () => { await post(`/api/recurring/${b.dataset.sub}/active`, { active: b.dataset.active === '1' }); loadMoney(); loadHome(); });
}
$('#addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const r = await post('/api/planned', { description: $('#aDesc').value, amount: $('#aAmt').value, date: $('#aDate').value, essential: $('#aEss').checked });
  if (r.ok) { e.target.reset(); $('#aErr').textContent = ''; loadMoney(); loadHome(); }
  else $('#aErr').textContent = 'Please check the details and try again.';
});

loadHome(); firstRun();
