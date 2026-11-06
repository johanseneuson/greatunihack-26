// Zero-dependency server: static frontend + search proxy + shared team store.
import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { SOURCES } from './lib/sources.js';
import { PRESETS, GENERAL_KIT } from './lib/presets.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STORE = path.join(DATA_DIR, 'store.json');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const CACHE_TTL = 60 * 60 * 1000;

// ---------- store (tracks, pins, notes) ----------
let store;
async function loadStore() {
  if (existsSync(STORE)) {
    store = JSON.parse(await readFile(STORE, 'utf8'));
  } else {
    store = {
      tracks: PRESETS.map((p) => ({ ...p, preset: true })),
      pins: {},
      notes: {},
    };
    await saveStore();
  }
}
let saving = Promise.resolve();
function saveStore() {
  saving = saving.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = STORE + '.tmp';
    await writeFile(tmp, JSON.stringify(store, null, 2));
    await rename(tmp, STORE);
  });
  return saving;
}

// ---------- search cache ----------
const cache = new Map();
async function search(source, q) {
  const key = `${source}:${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) return { results: hit.results, cached: true };
  const results = await SOURCES[source].search(q);
  cache.set(key, { t: Date.now(), results });
  return { results, cached: false };
}

// ---------- http helpers ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 1e6) throw new Error('Body too large');
  }
  return data ? JSON.parse(data) : {};
}

const clean = (s, n = 5000) => String(s ?? '').slice(0, n);

// ---------- routes ----------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const [resource, id] = parts;
  const m = req.method;

  if (resource === 'state' && m === 'GET') {
    return send(res, 200, { ...store, generalKit: GENERAL_KIT, sources: Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, { label: v.label, hint: v.hint }])), githubToken: Boolean(process.env.GITHUB_TOKEN) });
  }

  if (resource === 'search' && m === 'GET') {
    const source = url.searchParams.get('source');
    const q = clean(url.searchParams.get('q'), 200).trim();
    if (!SOURCES[source]) return send(res, 400, { error: `Unknown source "${source}"` });
    if (!q) return send(res, 400, { error: 'Empty query' });
    try {
      return send(res, 200, await search(source, q));
    } catch (e) {
      const msg = /403|429/.test(e.message) && source.match(/github|awesome/)
        ? `${e.message} — GitHub rate limit hit. Set GITHUB_TOKEN in .env for 30 req/min.`
        : e.message;
      return send(res, 502, { error: msg });
    }
  }

  if (resource === 'tracks') {
    if (m === 'POST') {
      const b = await readBody(req);
      const track = {
        id: randomUUID().slice(0, 8),
        name: clean(b.name, 120) || 'Untitled track',
        description: clean(b.description),
        query: clean(b.query, 200),
        links: [],
        createdAt: new Date().toISOString(),
      };
      store.tracks.unshift(track);
      await saveStore();
      return send(res, 201, track);
    }
    const track = store.tracks.find((t) => t.id === id);
    if (!track) return send(res, 404, { error: 'Track not found' });
    if (m === 'PATCH') {
      const b = await readBody(req);
      for (const k of ['name', 'description', 'query']) if (k in b) track[k] = clean(b[k], k === 'description' ? 5000 : 200);
      await saveStore();
      return send(res, 200, track);
    }
    if (m === 'DELETE') {
      store.tracks = store.tracks.filter((t) => t.id !== id);
      delete store.pins[id];
      delete store.notes[id];
      await saveStore();
      return send(res, 200, { ok: true });
    }
  }

  if (resource === 'pins') {
    const list = (store.pins[id] ||= []);
    if (m === 'POST') {
      const b = await readBody(req);
      if (!b.url) return send(res, 400, { error: 'url required' });
      if (!list.some((p) => p.url === b.url)) {
        list.unshift({ title: clean(b.title, 200), url: clean(b.url, 1000), desc: clean(b.desc, 400), source: clean(b.source, 40), by: clean(b.by, 40), at: new Date().toISOString() });
        await saveStore();
      }
      return send(res, 200, list);
    }
    if (m === 'DELETE') {
      const target = url.searchParams.get('url');
      store.pins[id] = list.filter((p) => p.url !== target);
      await saveStore();
      return send(res, 200, store.pins[id]);
    }
  }

  if (resource === 'notes' && m === 'PUT') {
    const b = await readBody(req);
    store.notes[id] = clean(b.text, 50000);
    await saveStore();
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Not found' });
}

async function serveStatic(req, res, url) {
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (!p || p === '.') p = 'index.html';
  const file = path.join(PUBLIC, p);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

await loadStore();
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}).listen(PORT, HOST, () => {
  console.log(`Resource finder running at http://localhost:${PORT}`);
  console.log(process.env.GITHUB_TOKEN ? 'GitHub token: set' : 'GitHub token: not set (search limited to 10 req/min — add GITHUB_TOKEN to .env)');
});
