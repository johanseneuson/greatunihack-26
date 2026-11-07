const http = require('http'), fs = require('fs'), path = require('path');
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
} catch { /* no .env: offline mode */ }
const F = require('./finance'), { chat } = require('./llm');
const WEB = path.join(__dirname, '..', 'frontend');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type + '; charset=utf-8' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/profile') return send(res, 200, F.profile);
    if (url.pathname === '/api/insights') return send(res, 200, F.insights());
    if (url.pathname === '/api/transactions') return send(res, 200, F.tx.slice(-(+url.searchParams.get('limit') || 30)).reverse());
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      let body = '';
      for await (const c of req) { body += c; if (body.length > 20000) return send(res, 413, { error: 'too large' }); }
      const { messages, language, plain } = JSON.parse(body || '{}');
      if (!Array.isArray(messages) || !messages.length) return send(res, 400, { error: 'messages required' });
      return send(res, 200, await chat({ messages, language, plain }));
    }
    const file = path.normalize(path.join(WEB, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (e) { console.error(e); send(res, 500, { error: 'server error' }); }
}).listen(process.env.PORT || 3000, () =>
  console.log('Finance Buddy on http://localhost:' + (process.env.PORT || 3000), process.env.ANTHROPIC_API_KEY ? '(LLM on)' : '(offline mode: no ANTHROPIC_API_KEY)'));
