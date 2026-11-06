// Track Resource Finder — vanilla JS frontend.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let state = { tracks: [], pins: {}, notes: {}, sources: {}, generalKit: [] };
let currentId = ls.get('currentTrack', null);
let enabledSources = ls.get('sources', null);
const results = {}; // trackId -> source -> { status, items, error, q, cached }

// ---------- keyword extraction ----------
const STOP = new Set(`a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just let me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours
  challenge challenges track tracks build building create creating solution solutions team teams using use used prize prizes best innovative innovation project projects app apps application applications help helps people way ways new make making hack hackathon judged judging criteria sponsor sponsored award submit submission participants should must want looking idea ideas impact impactful design develop developing tool tools based like etc e.g ie one two any every well better world`.split(/\s+/));

function suggestQuery(text, max = 4) {
  const tokens = (text || '').toLowerCase().replace(/[^a-z0-9+#.\- ]/g, ' ').split(/\s+/)
    .map((t) => t.replace(/^[.\-]+|[.\-]+$/g, ''))
    .filter((t) => t.length > 2 && !STOP.has(t) && !/^\d+$/.test(t));
  const freq = new Map();
  tokens.forEach((t, i) => { const f = freq.get(t); freq.set(t, f ? { n: f.n + 1, i: f.i } : { n: 1, i }); });
  return [...freq.entries()].sort((a, b) => b[1].n - a[1].n || a[1].i - b[1].i).slice(0, max).map(([t]) => t).join(' ');
}

// ---------- api ----------
async function api(path, opts = {}) {
  const res = await fetch(`/api/${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

async function refresh() {
  const s = await api('state');
  state = s;
  if (!enabledSources) enabledSources = Object.keys(s.sources);
  $('#gh-warning').hidden = s.githubToken;
  if (!state.tracks.some((t) => t.id === currentId)) currentId = state.tracks[0]?.id ?? null;
}

const current = () => state.tracks.find((t) => t.id === currentId);
const queryFor = (t) => (t.query || '').trim() || suggestQuery(`${t.name} ${t.description}`) || t.name;

// ---------- sidebar ----------
function renderSidebar() {
  const f = $('#filter').value.toLowerCase();
  const list = state.tracks.filter((t) => !f || `${t.name} ${t.description}`.toLowerCase().includes(f));
  const custom = list.filter((t) => !t.preset), presets = list.filter((t) => t.preset);
  const item = (t) => {
    const pins = state.pins[t.id]?.length || 0;
    return `<div class="track-item ${t.id === currentId ? 'active' : ''}" data-id="${t.id}">
      <span class="name" title="${esc(t.name)}">${esc(t.name)}</span>
      ${pins ? `<span class="badge pin" title="Pinned resources">📌 ${pins}</span>` : ''}
    </div>`;
  };
  $('#track-list').innerHTML =
    (custom.length ? `<div class="section-label">Hackathon tracks</div>${custom.map(item).join('')}` : '') +
    (presets.length ? `<div class="section-label">Common track library</div>${presets.map(item).join('')}` : '');
}

// ---------- main ----------
function renderMain() {
  const t = current();
  const main = $('#main');
  if (!t) { main.innerHTML = `<div class="empty">Pick a track on the left, or add the real ones when they're announced.</div>`; return; }
  const q = queryFor(t);
  main.innerHTML = `
    <div class="track-head">
      <input class="track-title" id="title" value="${esc(t.name)}" />
      <button class="ghost small danger" id="del">Delete track</button>
    </div>
    <details class="desc" ${t.preset ? '' : 'open'}>
      <summary class="muted">Track description</summary>
      <textarea id="description" rows="4" placeholder="Paste the brief here…">${esc(t.description || '')}</textarea>
    </details>

    <form class="search-bar" id="search">
      <input id="q" value="${esc(q)}" placeholder="Search keywords" />
      <button type="button" class="ghost" id="suggest" title="Regenerate keywords from description">✨ Suggest</button>
      <button class="primary">Fetch resources</button>
    </form>
    <div class="chips">
      ${Object.entries(state.sources).map(([k, s]) => `
        <label class="chip" title="${esc(s.hint)}"><input type="checkbox" value="${k}" ${enabledSources.includes(k) ? 'checked' : ''}/>${esc(s.label)}</label>`).join('')}
    </div>

    <section class="panel pins" id="pins"></section>

    ${t.links?.length ? `<section class="panel"><div class="panel-head"><h3>Curated starting points</h3></div>
      <div class="links">${t.links.map(linkCard).join('')}</div></section>` : ''}

    <div class="results" id="results"></div>

    <section class="panel" style="margin-top:16px">
      <div class="panel-head"><h3>Team notes</h3><span class="muted" id="notes-status"></span></div>
      <textarea class="notes" id="notes" placeholder="Idea, stack decision, who does what…">${esc(state.notes[t.id] || '')}</textarea>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>General hackathon kit</h3></div>
      <div class="links">${state.generalKit.map(linkCard).join('')}</div>
    </section>`;
  renderPins();
  renderResults();
  bindMain(t);
}

const linkCard = (l) => `<div class="link">
  <a class="t" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>
  <span class="d">${esc(l.desc || '')}</span>
  <button class="pin-btn small ${isPinned(l.url) ? 'on' : ''}" style="position:absolute;top:6px;right:6px" data-pin='${esc(JSON.stringify({ ...l, source: 'curated' }))}' title="Pin for the team">📌</button>
</div>`;

const isPinned = (url) => (state.pins[currentId] || []).some((p) => p.url === url);

function renderPins() {
  const el = $('#pins'); if (!el) return;
  const pins = state.pins[currentId] || [];
  el.innerHTML = `<div class="panel-head"><h3>📌 Team shortlist <span class="muted">(${pins.length})</span></h3>
    <div class="actions">${pins.length ? `<button class="small" id="export">Copy as Markdown</button>` : ''}</div></div>
    ${pins.length ? `<ul style="list-style:none;padding:0;margin:0">${pins.map((p) => `
      <li class="res"><div class="body">
        <a class="t" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>
        ${p.desc ? `<div class="d">${esc(p.desc)}</div>` : ''}
        <div class="by">${esc(state.sources[p.source]?.label || p.source || '')}${p.by ? ` · pinned by ${esc(p.by)}` : ''}</div>
      </div><button class="pin-btn small on" data-unpin="${esc(p.url)}" title="Unpin">✕</button></li>`).join('')}</ul>`
    : `<div class="status">Pin the good stuff from the results below so the whole team sees it.</div>`}`;
  $('#export')?.addEventListener('click', () => {
    const t = current();
    const md = `## ${t.name}\n\n` + pins.map((p) => `- [${p.title}](${p.url})${p.desc ? ` — ${p.desc}` : ''}`).join('\n');
    navigator.clipboard.writeText(md).then(() => toast('Copied Markdown'), () => toast('Clipboard blocked'));
  });
}

function renderResults() {
  const el = $('#results'); if (!el) return;
  const r = results[currentId] || {};
  const keys = enabledSources.filter((k) => state.sources[k]);
  if (!Object.keys(r).length) { el.innerHTML = `<div class="status" style="grid-column:1/-1">Hit <b>Fetch resources</b> to search ${keys.length} sources.</div>`; return; }
  el.innerHTML = keys.filter((k) => r[k]).map((k) => {
    const s = r[k], src = state.sources[k];
    let body;
    if (s.status === 'loading') body = `<div class="status"><span class="spinner"></span>Searching…</div>`;
    else if (s.status === 'error') body = `<div class="status err">⚠ ${esc(s.error)} <button class="small" data-retry="${k}">Retry</button></div>`;
    else if (!s.items.length) body = `<div class="status">No results for “${esc(s.q)}”. Try fewer / broader keywords.</div>`;
    else body = `<ul>${s.items.map((it) => `
      <li class="res"><div class="body">
        <a class="t" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
        ${it.desc ? `<div class="d">${esc(it.desc)}</div>` : ''}
        ${it.meta ? `<div class="m">${esc(it.meta)}</div>` : ''}
      </div><button class="pin-btn small ${isPinned(it.url) ? 'on' : ''}" data-pin='${esc(JSON.stringify({ ...it, source: k }))}' title="Pin for the team">📌</button></li>`).join('')}</ul>`;
    return `<section class="panel"><div class="panel-head"><h3>${esc(src.label)} <span class="muted">${s.items?.length ?? ''}</span></h3>
      <span class="muted" style="font-size:11px">${esc(src.hint)}${s.cached ? ' · cached' : ''}</span></div>${body}</section>`;
  }).join('');
}

// ---------- fetching ----------
async function fetchSource(trackId, source, q) {
  results[trackId] ||= {};
  results[trackId][source] = { status: 'loading', q };
  if (trackId === currentId) renderResults();
  try {
    const { results: items, cached } = await api(`search?source=${source}&q=${encodeURIComponent(q)}`);
    results[trackId][source] = { status: 'ok', items, q, cached };
  } catch (e) {
    results[trackId][source] = { status: 'error', error: e.message, q };
  }
  if (trackId === currentId) renderResults();
}

function fetchAll(track, q = queryFor(track)) {
  results[track.id] = {};
  return Promise.all(enabledSources.map((k) => fetchSource(track.id, k, q)));
}

// ---------- events ----------
function bindMain(t) {
  let saveTimer;
  const patch = (body) => api(`tracks/${t.id}`, { method: 'PATCH', body }).then((u) => Object.assign(t, u));

  $('#title').addEventListener('change', async (e) => { await patch({ name: e.target.value }); renderSidebar(); });
  $('#description').addEventListener('change', (e) => patch({ description: e.target.value }));
  $('#suggest').addEventListener('click', () => {
    $('#q').value = suggestQuery(`${t.name} ${$('#description').value}`) || t.name;
  });
  $('#search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#q').value.trim();
    if (!q) return;
    if (q !== t.query) patch({ query: q });
    fetchAll(t, q);
  });
  $('.chips').addEventListener('change', () => {
    enabledSources = [...document.querySelectorAll('.chips input:checked')].map((i) => i.value);
    ls.set('sources', enabledSources);
    renderResults();
  });
  $('#del').addEventListener('click', async () => {
    if (!confirm(`Delete “${t.name}” and its pins & notes for everyone?`)) return;
    await api(`tracks/${t.id}`, { method: 'DELETE' });
    await refresh(); renderSidebar(); renderMain();
  });
  $('#notes').addEventListener('input', (e) => {
    $('#notes-status').textContent = 'saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await api(`notes/${t.id}`, { method: 'PUT', body: { text: e.target.value } });
      state.notes[t.id] = e.target.value;
      $('#notes-status').textContent = 'saved';
    }, 600);
  });
}

// Delegated: pin / unpin / retry work everywhere inside main.
$('#main').addEventListener('click', async (e) => {
  const pin = e.target.closest('[data-pin]');
  const unpin = e.target.closest('[data-unpin]');
  const retry = e.target.closest('[data-retry]');
  if (pin) {
    const item = JSON.parse(pin.dataset.pin);
    if (isPinned(item.url)) {
      state.pins[currentId] = await api(`pins/${currentId}?url=${encodeURIComponent(item.url)}`, { method: 'DELETE' });
    } else {
      state.pins[currentId] = await api(`pins/${currentId}`, { method: 'POST', body: { ...item, by: $('#who').value } });
      toast('Pinned for the team');
    }
  } else if (unpin) {
    state.pins[currentId] = await api(`pins/${currentId}?url=${encodeURIComponent(unpin.dataset.unpin)}`, { method: 'DELETE' });
  } else if (retry) {
    const k = retry.dataset.retry;
    return fetchSource(currentId, k, results[currentId][k].q);
  } else return;
  renderPins(); renderResults(); renderSidebar();
  document.querySelectorAll('.links [data-pin]').forEach((b) => b.classList.toggle('on', isPinned(JSON.parse(b.dataset.pin).url)));
});

$('#track-list').addEventListener('click', (e) => {
  const item = e.target.closest('.track-item');
  if (!item) return;
  currentId = item.dataset.id; ls.set('currentTrack', currentId);
  renderSidebar(); renderMain();
  window.scrollTo(0, 0);
});
$('#filter').addEventListener('input', renderSidebar);

const who = $('#who');
who.value = ls.get('who', '');
who.addEventListener('change', () => ls.set('who', who.value));

async function addTrack({ name, description, query }) {
  const t = await api('tracks', { method: 'POST', body: { name, description, query: query || suggestQuery(`${name} ${description}`) } });
  state.tracks.unshift(t);
  return t;
}

$('#btn-add').addEventListener('click', () => { $('#form-add').reset(); $('#dlg-add').showModal(); });
$('#dlg-add').addEventListener('close', async () => {
  if ($('#dlg-add').returnValue !== 'ok') return;
  const f = new FormData($('#form-add'));
  const t = await addTrack(Object.fromEntries(f));
  currentId = t.id; ls.set('currentTrack', currentId);
  renderSidebar(); renderMain(); fetchAll(t);
});

$('#btn-bulk').addEventListener('click', () => { $('#form-bulk').reset(); $('#dlg-bulk').showModal(); });
$('#dlg-bulk').addEventListener('close', async () => {
  if ($('#dlg-bulk').returnValue !== 'ok') return;
  const f = new FormData($('#form-bulk'));
  const blocks = String(f.get('text')).split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (!blocks.length) return;
  const added = [];
  for (const b of blocks.reverse()) {
    const [name, ...rest] = b.split('\n');
    added.unshift(await addTrack({ name: name.replace(/^[#*\-\s]+/, '').trim(), description: rest.join('\n').trim() }));
  }
  currentId = added[0].id; ls.set('currentTrack', currentId);
  renderSidebar(); renderMain();
  toast(`Added ${added.length} track${added.length > 1 ? 's' : ''}`);
  if (f.get('fetch')) for (const t of added) await fetchAll(t); // sequential to go easy on rate limits
});

// Pick up teammates' pins / tracks when you come back to the tab.
window.addEventListener('focus', async () => {
  if (document.querySelector('dialog[open]') || document.activeElement?.matches('textarea, input')) return;
  await refresh(); renderSidebar(); renderPins(); renderResults();
});

await refresh();
renderSidebar();
renderMain();
