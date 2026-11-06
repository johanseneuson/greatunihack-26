// Resource sources. Every source is free and works without an API key.
// Each returns [{ title, url, desc, meta }].

const UA = 'greatunihack-resource-finder';
const GH_TOKEN = process.env.GITHUB_TOKEN;

async function getJSON(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return res.text();
}

const decode = (s = '') =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
   .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));

const trim = (s = '', n = 220) => {
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

const ago = (iso) => {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso)) / 864e5);
  if (days < 1) return 'today';
  if (days < 31) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

const words = (q) => q.split(/\s+/).filter(Boolean);

// Retry with fewer words when a multi-word query returns nothing.
async function withFallback(q, fn) {
  const w = words(q);
  const attempts = [w.join(' ')];
  if (w.length > 2) attempts.push(w.slice(0, 2).join(' '));
  if (w.length > 1) attempts.push(w[0]);
  for (const a of attempts) {
    const r = await fn(a);
    if (r.length) return r;
  }
  return [];
}

const ghHeaders = () => ({
  Accept: 'application/vnd.github+json',
  ...(GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {}),
});

const ghRepos = (data) =>
  (data.items || []).map((r) => ({
    title: r.full_name,
    url: r.html_url,
    desc: trim(r.description || ''),
    meta: [`★ ${r.stargazers_count.toLocaleString()}`, r.language, `updated ${ago(r.pushed_at)}`].filter(Boolean).join(' · '),
  }));

// Cached copy of the public-apis catalogue (parsed from its README).
let publicApis = null;
async function loadPublicApis() {
  if (publicApis) return publicApis;
  const md = await getText('https://raw.githubusercontent.com/public-apis/public-apis/master/README.md');
  const out = [];
  let category = '';
  for (const line of md.split('\n')) {
    const h = line.match(/^###\s+(.+)/);
    if (h) { category = h[1].trim(); continue; }
    const m = line.match(/^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|/);
    if (m && category) {
      out.push({
        name: m[1].trim(), url: m[2].trim(), desc: m[3].trim(), category,
        auth: m[4].replace(/`/g, '').trim(), https: m[5].trim(), cors: m[6].trim(),
      });
    }
  }
  publicApis = out;
  return out;
}

export const SOURCES = {
  github: {
    label: 'GitHub repos',
    hint: 'Starter code, libraries, prior art',
    async search(q) {
      return withFallback(q, async (a) =>
        ghRepos(await getJSON(`https://api.github.com/search/repositories?q=${encodeURIComponent(a)}&sort=stars&order=desc&per_page=10`, ghHeaders())));
    },
  },

  awesome: {
    label: 'Awesome lists',
    hint: 'Curated link collections on GitHub',
    async search(q) {
      const w = words(q);
      const tries = [w.slice(0, 2).join(' '), w[0]].filter((v, i, arr) => v && arr.indexOf(v) === i);
      for (const t of tries) {
        const r = ghRepos(await getJSON(`https://api.github.com/search/repositories?q=${encodeURIComponent(`awesome ${t} in:name,description`)}&sort=stars&order=desc&per_page=8`, ghHeaders()));
        if (r.length) return r;
      }
      return [];
    },
  },

  publicapis: {
    label: 'Public APIs',
    hint: 'Free APIs from the public-apis catalogue',
    async search(q) {
      const apis = await loadPublicApis();
      const terms = words(q.toLowerCase());
      return apis
        .map((a) => {
          const hay = `${a.name} ${a.desc} ${a.category}`.toLowerCase();
          const score = terms.reduce((s, t) => s + (hay.includes(t) ? (a.category.toLowerCase().includes(t) ? 2 : 1) : 0), 0);
          return { a, score };
        })
        .filter((x) => x.score > 0)
        .sort((x, y) => y.score - x.score || (x.a.auth === 'No' ? -1 : 1))
        .slice(0, 15)
        .map(({ a }) => ({
          title: a.name,
          url: a.url,
          desc: a.desc,
          meta: [a.category, a.auth && a.auth !== 'No' ? `auth: ${a.auth}` : 'no auth', a.cors === 'Yes' ? 'CORS ✓' : ''].filter(Boolean).join(' · '),
        }));
    },
  },

  hfmodels: {
    label: 'HF models',
    hint: 'Pretrained models on Hugging Face',
    async search(q) {
      return withFallback(q, async (a) =>
        (await getJSON(`https://huggingface.co/api/models?search=${encodeURIComponent(a)}&sort=downloads&direction=-1&limit=10`)).map((m) => ({
          title: m.id,
          url: `https://huggingface.co/${m.id}`,
          desc: m.pipeline_tag ? `Task: ${m.pipeline_tag}` : '',
          meta: [`↓ ${(m.downloads || 0).toLocaleString()}`, `♥ ${m.likes || 0}`, m.library_name].filter(Boolean).join(' · '),
        })));
    },
  },

  hfdatasets: {
    label: 'HF datasets',
    hint: 'Datasets on Hugging Face',
    async search(q) {
      return withFallback(q, async (a) =>
        (await getJSON(`https://huggingface.co/api/datasets?search=${encodeURIComponent(a)}&sort=downloads&direction=-1&limit=10`)).map((d) => ({
          title: d.id,
          url: `https://huggingface.co/datasets/${d.id}`,
          desc: trim(d.description || ''),
          meta: [`↓ ${(d.downloads || 0).toLocaleString()}`, `♥ ${d.likes || 0}`].join(' · '),
        })));
    },
  },

  arxiv: {
    label: 'arXiv papers',
    hint: 'Research papers (newest relevant first)',
    async search(q) {
      return withFallback(q, async (a) => {
        const sq = words(a).slice(0, 4).map((t) => `all:${encodeURIComponent(t)}`).join('+AND+');
        const xml = await getText(`https://export.arxiv.org/api/query?search_query=${sq}&sortBy=relevance&max_results=10`);
        return xml.split('<entry>').slice(1).map((e) => {
          const tag = (t) => decode((e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '');
          return {
            title: trim(tag('title'), 160),
            url: tag('id').trim().replace('http://', 'https://'),
            desc: trim(tag('summary')),
            meta: tag('published').slice(0, 10),
          };
        });
      });
    },
  },

  npm: {
    label: 'npm packages',
    hint: 'JavaScript / TypeScript packages',
    async search(q) {
      return withFallback(q, async (a) =>
        ((await getJSON(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(a)}&size=10`)).objects || []).map(({ package: p }) => ({
          title: p.name,
          url: p.links?.npm || `https://www.npmjs.com/package/${p.name}`,
          desc: trim(p.description || ''),
          meta: [`v${p.version}`, p.date ? `published ${ago(p.date)}` : ''].filter(Boolean).join(' · '),
        })));
    },
  },

  stackoverflow: {
    label: 'Stack Overflow',
    hint: 'Top-voted Q&A',
    async search(q) {
      return withFallback(q, async (a) =>
        ((await getJSON(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(a)}&site=stackoverflow&pagesize=10&accepted=True`)).items || []).map((i) => ({
          title: decode(i.title),
          url: i.link,
          desc: (i.tags || []).join(', '),
          meta: [`▲ ${i.score}`, `${i.answer_count} answers`].join(' · '),
        })));
    },
  },

  hn: {
    label: 'Hacker News',
    hint: 'Discussions, launches, write-ups',
    async search(q) {
      return withFallback(q, async (a) =>
        ((await getJSON(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(a)}&tags=story&hitsPerPage=10`)).hits || []).map((h) => ({
          title: h.title,
          url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
          desc: h.url ? `Discussion: https://news.ycombinator.com/item?id=${h.objectID}` : '',
          meta: [`${h.points} pts`, `${h.num_comments} comments`, ago(h.created_at)].join(' · '),
        })));
    },
  },
};
