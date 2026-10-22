// OpenSubtitles API reverse proxy (Vercel)
//
//   https://<your-domain>/api/v1/...   ->  https://api.opensubtitles.com/api/v1/...
//   https://<your-domain>/dl/...       ->  https://dl.opensubtitles.org/...   (vercel.json rewrite)
//
// Auth is passed through: the client sends its own `Api-Key` header and/or
// `Authorization: Bearer <jwt from /api/v1/login>`. Nothing is stored here.

const UPSTREAM = 'https://api.opensubtitles.com';
const DL_HOST = 'https://dl.opensubtitles.org';
const PUBLIC_BASE = (process.env.PUBLIC_BASE || '').replace(/\/+$/, '');

const TTL = 10 * 60 * 1000;
const MAX_CACHE = 500;
const cache = new Map();

const FORWARD_HEADERS = [
  'api-key',
  'authorization',
  'accept',
  'accept-language',
  'content-type',
  'content-language',
];

// req.url is the original request path (e.g. /api/v1/subtitles?imdb_id=tt0137523)
function upstreamPath(rawUrl) {
  let path = rawUrl || '/';
  path = path.split('?')[0];
  if (path.startsWith('/api/os.js')) path = path.slice('/api/os.js'.length);
  if (!path.startsWith('/')) path = '/' + path;
  return path || '/';
}

function upstreamQuery(rawUrl) {
  const idx = (rawUrl || '').indexOf('?');
  return idx === -1 ? '' : rawUrl.slice(idx);
}

// Rewrite subtitle download links so they go through our own /dl/ rewrite.
function rewriteLinks(value) {
  if (!PUBLIC_BASE || value == null) return value;
  const text = JSON.stringify(value)
    .split(DL_HOST).join(PUBLIC_BASE)
    .split('https:\\/\\/dl.opensubtitles.org').join(PUBLIC_BASE.replace(/\//g, '\\/'));
  return JSON.parse(text);
}

function trimCache() {
  if (cache.size <= MAX_CACHE) return;
  const entries = [...cache.entries()].sort((a, b) => a[1].exp - b[1].exp);
  entries.slice(0, cache.size - MAX_CACHE).forEach(([k]) => cache.delete(k));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const path = upstreamPath(req.url);
  const search = upstreamQuery(req.url);
  const isGet = req.method === 'GET';
  const cacheKey = path + search;

  if (isGet && cache.has(cacheKey)) {
    const hit = cache.get(cacheKey);
    if (Date.now() < hit.exp) {
      res.setHeader('x-proxy-cache', 'HIT');
      res.status(hit.status).setHeader('content-type', hit.type).send(hit.body);
      return;
    }
    cache.delete(cacheKey);
  }

  const headers = {
    'User-Agent':
      process.env.OS_UA ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json',
  };
  for (const h of FORWARD_HEADERS) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }

  let body;
  if (!isGet && req.method !== 'HEAD') {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  }

  try {
    const upstream = await fetch(UPSTREAM + path + search, {
      method: req.method,
      headers,
      body,
      redirect: 'follow',
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get('content-type') || 'application/octet-stream';

    let out = buf;
    if (type.includes('application/json') && buf.length) {
      try {
        const json = rewriteLinks(JSON.parse(buf.toString('utf8')));
        out = Buffer.from(JSON.stringify(json), 'utf8');
        if (isGet && upstream.status === 200) {
          trimCache();
          cache.set(cacheKey, { body: out, type, status: upstream.status, exp: Date.now() + TTL });
        }
      } catch {
        /* not valid JSON - pass through untouched */
      }
    }

    res.setHeader('x-proxy-cache', 'MISS');
    res.status(upstream.status).setHeader('content-type', type).send(out);
  } catch (err) {
    res.status(502).json({
      error: 'upstream_error',
      message: err && err.message ? err.message : String(err),
    });
  }
};
