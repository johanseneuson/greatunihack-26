const $ = s => document.querySelector(s);
const gbp = n => (n < 0 ? '-£' : '£') + Math.abs(n).toFixed(2);
const history = [];
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { } } };
const RTL = ['العربية', 'Urdu (اردو)'];

// ---- settings / accessibility ----
const root = document.documentElement;
function applySettings() {
  root.classList.toggle('big', $('#big').checked);
  root.classList.toggle('contrast', $('#contrast').checked);
  const lang = $('#lang').value;
  document.body.dir = RTL.includes(lang) ? 'rtl' : 'ltr';
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
function sourcesEl(sources, mode) {
  const w = document.createElement('div');
  const det = document.createElement('details'); det.className = 'src';
  det.innerHTML = '<summary>Where this came from</summary>';
  const ol = document.createElement('ol');
  sources.forEach(s => { const li = document.createElement('li'); li.value = s.n; li.textContent = `${s.title} (${s.kind === 'knowledge' ? 'guidance' : s.kind === 'profile' ? 'your profile' : 'your account'})`; ol.append(li); });
  det.append(ol); w.append(det);
  const b = document.createElement('div'); b.className = 'badge';
  b.textContent = mode === 'llm' ? 'AI answer using your data' : 'Basic answer (AI not connected)';
  w.append(b); return w;
}
async function ask(q) {
  q = q.trim(); if (!q) return;
  bubble('me', q); history.push({ role: 'user', content: q });
  $('#msg').value = ''; $('#send').disabled = true;
  const t = document.createElement('div'); t.className = 'msg bot typing'; t.setAttribute('aria-label', 'Finance Buddy is typing'); t.innerHTML = '<i></i><i></i><i></i>';
  $('#log').append(t); t.scrollIntoView({ block: 'end' });
  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: history, language: $('#lang').value, plain: $('#plain').checked }) });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    history.push({ role: 'assistant', content: j.reply });
    t.remove(); bubble('bot', j.reply, sourcesEl(j.sources, j.mode));
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
async function init() {
  try {
    const { snapshot: s, insights } = await (await fetch('/api/insights')).json();
    $('#bal').textContent = gbp(s.balance); $('#sav').textContent = gbp(s.savingsPot);
    $('#od').textContent = s.balance < 0 ? `In overdraft (limit ${gbp(s.overdraftLimit)})` : `Overdraft limit ${gbp(s.overdraftLimit)}`;
    const cards = $('#cards');
    insights.forEach(i => {
      const c = document.createElement('div'); c.className = 'card ' + i.level;
      const h = document.createElement('h3'); h.textContent = i.title;
      const p = document.createElement('p'); p.textContent = i.body;
      const b = document.createElement('button'); b.textContent = 'Help me with this'; b.onclick = () => { ask(i.ask); $('#chat').scrollIntoView({ behavior: 'smooth' }); };
      c.append(h, p, b); cards.append(c);
    });
  } catch { $('#cards').textContent = 'Could not load your insights.'; }
  const hello = 'Hi Maya, I am your Finance Buddy. I can see your account and your bills, so I can give advice that fits your life. What would you like help with?';
  bubble('bot', hello);
  ['Can I afford £30 this week?', 'Where does my money go?', 'Help me save £500', 'What help can I get?'].forEach(q => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = q; b.onclick = () => ask(q); $('#chips').append(b);
  });
}
init();
