// Fichário de Cartas — self-hosted server. Zero dependencies: Node 22 built-ins only.
// Env: PORT (3077), DATA_DIR (/data), SECRET (cookie signing), ANTHROPIC_API_KEY (scan), INVITE_CODE (optional).
import http from 'node:http';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR || '/data';
const PORT = Number(process.env.PORT || 3077);
const SECRET = process.env.SECRET || '';
let AKEY = process.env.ANTHROPIC_API_KEY || '';
const INVITE = process.env.INVITE_CODE || '';
const MODELS = (process.env.SCAN_MODELS || 'claude-sonnet-5-5,claude-sonnet-4-5').split(',');
const DAY = 86_400_000;
if (!SECRET || SECRET.length < 16) { console.error('SECRET env var missing (min 16 chars)'); process.exit(1); }

/* ---------- storage ---------- */
const p = (...a) => path.join(DATA, ...a);
async function readJSON(f, dflt = null) { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return dflt; } }
async function writeJSON(f, v) { await fs.mkdir(path.dirname(f), { recursive: true }); const tmp = f + '.' + process.pid + '.tmp'; await fs.writeFile(tmp, JSON.stringify(v)); await fs.rename(tmp, f); }
let usersCache = null;
async function users() { return usersCache ||= await readJSON(p('users.json'), {}); }
async function saveUsers(u) { usersCache = u; await writeJSON(p('users.json'), u); }

/* ---------- auth ---------- */
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
const checkPw = (pw, h) => { const [salt, hex] = String(h).split(':'); if (!salt || !hex) return false; const a = Buffer.from(hex, 'hex'), b = crypto.scryptSync(pw, salt, 64); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const sign = v => v + '.' + crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
const unsign = s => { const i = String(s).lastIndexOf('.'); if (i < 0) return null; const v = s.slice(0, i); return sign(v) === s ? v : null; };
const COOKIE = 'fsid';
function cookieOf(req) { const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + COOKIE + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : null; }
function setSession(res, uid) {
  const v = sign(uid + '|' + (Date.now() + 180 * DAY));
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(v)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${180 * 86400}`);
}
function clearSession(res) { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`); }
async function currentUser(req) {
  const v = unsign(cookieOf(req) || ''); if (!v) return null;
  const [uid, exp] = v.split('|'); if (!uid || Number(exp) < Date.now()) return null;
  const u = (await users())[uid]; return u ? { id: uid, ...u } : null;
}
const pub = u => ({ id: u.id, email: u.email, name: u.name || '', confirmedAt: u.created, owner: !!u.owner });
const attempts = new Map();
function rateLimited(key, max = 10, win = 15 * 60_000) {
  const now = Date.now(); const a = (attempts.get(key) || []).filter(t => now - t < win); a.push(now); attempts.set(key, a); return a.length > max;
}

/* ---------- http helpers ---------- */
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isBuf ? body : JSON.stringify(body));
}
async function body(req, limit = 1_000_000) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error('grande demais'), { status: 413 }); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname); if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  let f = path.normalize(path.join(PUBLIC, rel)); if (!f.startsWith(PUBLIC)) return send(res, 403, { error: 'proibido' });
  // catalogo atualizado pelo update-catalog.mjs (DATA_DIR/catalog) tem prioridade sobre a copia da imagem
  if (rel.startsWith('/data/')) { const c = path.normalize(path.join(DATA, 'catalog', rel.slice(6))); if (c.startsWith(path.join(DATA, 'catalog')) && await fs.stat(c).then(x => x.isFile(), () => false)) f = c; }
  try {
    const st = await fs.stat(f); if (!st.isFile()) throw 0;
    const cache = rel.startsWith('/data/') ? 'public, max-age=3600' : rel === '/index.html' || rel === '/app.js' ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache });
    fss.createReadStream(f).pipe(res);
  } catch { send(res, 404, { error: 'não encontrado' }); }
}

/* ---------- collection ---------- */
const validOwned = o => o && typeof o === 'object' && !Array.isArray(o) && Object.values(o).every(set => set && typeof set === 'object' && !Array.isArray(set) && Object.values(set).every(q => typeof q === 'number' && q >= 0 && q <= 999));
async function collection(req, res, u) {
  const f = p('users', u.id, 'collection.json');
  if (req.method === 'GET') { const d = await readJSON(f, {}); return send(res, 200, { owned: d.owned || {}, trades: d.trades || [], updated: d.updated || 0 }); }
  if (req.method === 'PUT') {
    const b = await body(req, 3_000_000); if (!validOwned(b.owned)) return send(res, 400, { error: 'formato inválido' });
    const prev = Array.isArray(b.trades) ? null : await readJSON(f, {});
    const updated = Date.now(); await writeJSON(f, { owned: b.owned, trades: Array.isArray(b.trades) ? b.trades.slice(-300) : (prev.trades || []), updated });
    return send(res, 200, { ok: true, updated });
  }
  send(res, 405, { error: 'método' });
}

/* ---------- photos ---------- */
const okKey = k => !!k && /^[\w.\-]{1,40}\|[\w.\-~]{1,20}$/.test(k);
const photoFile = (uid, k) => p('users', uid, 'photos', k.replace('|', '__') + '.jpg');
async function photo(req, res, u, url) {
  if (req.method === 'GET') {
    const k = url.searchParams.get('k'); if (!okKey(k)) return send(res, 400, { error: 'chave' });
    // no-cache + ETag: foto regravada (girada/trocada) aparece na hora; sem mudanca responde 304
    try {
      const f = photoFile(u.id, k); const st = await fs.stat(f); const tag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
      if (req.headers['if-none-match'] === tag) { res.writeHead(304, { ETag: tag, 'Cache-Control': 'private, no-cache' }); return res.end(); }
      return send(res, 200, await fs.readFile(f), { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-cache', ETag: tag });
    }
    catch { return send(res, 404, { error: 'sem foto' }, { 'Cache-Control': 'private, max-age=60' }); }
  }
  if (req.method === 'PUT') {
    const b = await body(req, 400_000); const m = /^data:image\/jpeg;base64,(.+)$/.exec(b.image || '');
    if (!okKey(b.k) || !m) return send(res, 400, { error: 'inválido' });
    const buf = Buffer.from(m[1], 'base64'); if (buf.length > 200_000) return send(res, 413, { error: 'grande demais' });
    const f = photoFile(u.id, b.k); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, buf);
    return send(res, 200, { ok: true });
  }
  send(res, 405, { error: 'método' });
}

/* ---------- prices ---------- */
function pick(card) {
  const tp = card?.pricing?.tcgplayer || {}, cm = card?.pricing?.cardmarket || {};
  let usd = null, variant = null;
  for (const v of ['normal', 'holofoil', 'holo', 'reverse-holofoil', 'reverse']) { const x = tp[v]; const m = x && (x.marketPrice ?? x.midPrice); if (typeof m === 'number' && m > 0) { usd = m; variant = v; break; } }
  const e = cm.trend ?? cm.avg ?? cm['trend-holo'] ?? cm['avg-holo'];
  const rp = tp['reverse-holofoil'] || tp['reverse']; const ur = rp && (rp.marketPrice ?? rp.midPrice); const er = cm['trend-holo'] ?? cm['avg-holo'];
  const num = v => typeof v === 'number' && v > 0 ? v : null;
  return { usd, eur: num(e), usdR: num(ur), eurR: num(er), variant, img: card?.image ?? null, t: Date.now() };
}
async function fetchCard(id) {
  for (const lang of ['en', 'pt']) {
    const r = await fetch(`https://api.tcgdex.net/v2/${lang}/cards/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(12_000) }).catch(() => null);
    if (r && r.ok) return pick(await r.json());
  }
  return null;
}
async function fx() {
  const f = p('prices', '_fx.json'); const c = await readJSON(f);
  if (c && Date.now() - c.t < DAY / 2) return c;
  const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(8_000) }).catch(() => null);
  if (r && r.ok) { const j = await r.json(); const brl = j?.rates?.BRL, eur = j?.rates?.EUR; if (brl && eur) { const v = { usdBrl: brl, eurBrl: brl / eur, t: Date.now() }; await writeJSON(f, v); return v; } }
  return c || { usdBrl: null, eurBrl: null, t: 0 };
}
async function prices(req, res) {
  const b = await body(req, 50_000);
  const ids = Array.isArray(b.ids) ? b.ids.filter(x => typeof x === 'string' && /^[\w.\-]{2,40}$/.test(x)).slice(0, 60) : [];
  const out = {}, todo = [];
  await Promise.all(ids.map(async id => { const c = await readJSON(p('prices', id + '.json')); if (c && Date.now() - c.t < DAY) out[id] = c; else todo.push(id); }));
  let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (i < todo.length) { const id = todo[i++]; const v = await fetchCard(id); out[id] = v; if (v) await writeJSON(p('prices', id + '.json'), v); } }));
  send(res, 200, { prices: out, fx: await fx() });
}

/* ---------- scan ---------- */
const PROMPT = `The image shows one or more Pokémon TCG cards (possibly a binder page). For EACH card you can see, read the text printed on it.
Reply with only a JSON array, one object per card, in reading order (left to right, top to bottom):
[{"name":"Charizard ex","number":"125","total":"197","set_code":"OBF","language":"en","finish":"normal","box":[0.05,0.02,0.33,0.31]}]
Rules:
- "number" and "total": the collector number at the bottom of the card, e.g. "125/197" gives number "125", total "197". For codes like "TG05/TG30" or "SVP 044" keep the letters ("TG05", total "TG30"; "044", set_code "SVP"). Use "" when not readable.
- "set_code": the 2-4 letter set abbreviation printed near the number (e.g. "SVI", "PAL", "OBF", "MEW"), "" if none is printed.
- "name": the card name exactly as printed, including suffixes like ex, V, VMAX, GX.
- "box": where the card is in image 1, as fractions of the image width/height: [left, top, right, bottom].
- "finish": "reverse" or "normal". Reverse holo cards have a shiny/holographic foil surface OUTSIDE the artwork (text box and borders) and their small rarity symbol next to the collector number is printed BLACK with a white outline (it can look hollow, like ○). Normal cards have a matte text box and the rarity symbol is a solid WHITE or light shape (●). The rarity-symbol color is the most reliable cue; use the foil shine to confirm.
- "language": two-letter code of the card's printed language (en, pt, ja, ...).
- The card name is the most reliable field; read it carefully, letter by letter. Cards may be printed in Portuguese; Pokémon names are the same in every language.
- Count the cards first and return exactly one object per card.
- Do not guess values you cannot read: an empty string is better than a wrong number or set code. Return [] if no card is visible.`;
const NUM_PROMPT = `This image is a vertical stack of strips. Each strip is the enlarged bottom edge of one Pokémon TCG card, and starts with a white label holding its index (1, 2, 3...).
For each strip, read the collector number printed on the card (e.g. "092/132", "TG05/TG30", "SVP 044") and the 2-4 letter set code printed next to it (e.g. "MEG", "PFL", "PAL"); old cards may have no set code.
Also report "finish": "reverse" if the small rarity symbol next to the number is BLACK with a white outline (hollow-looking) or the strip surface is shiny foil, "normal" if the symbol is solid white/light on a matte surface, "" if unsure.
Reply with only a JSON array: [{"i":1,"number":"092","total":"132","set_code":"MEG","finish":"normal"}]. Use "" for anything you cannot read; never guess.`;
async function scan(req, res, u) {
  if (!AKEY) return send(res, 503, { error: 'IA indisponível neste servidor (falta ANTHROPIC_API_KEY)' });
  if (rateLimited('scan:' + u.id, 120, 60 * 60_000)) return send(res, 429, { error: 'muitos scans' });
  const b = await body(req, 8_000_000);
  const list = (Array.isArray(b.images) ? b.images : [b.image]).filter(Boolean).slice(0, 2);
  const imgs = list.map(d => { const m = /^data:(image\/(jpeg|png|webp));base64,/.exec(d); return m ? { media: m[1], data: d.slice(m[0].length) } : null; });
  if (!imgs.length || imgs.some(x => !x)) return send(res, 400, { error: 'imagem inválida' });
  const text = b.mode === 'numbers' ? NUM_PROMPT : (imgs.length > 1 ? 'Image 1 is the whole photo. Image 2 is an enlarged crop of the bottom 30% of the same photo (useful for the collector number when the photo shows a single card; ignore it for multi-card photos).\n\n' : '') + PROMPT;
  let last = null;
  for (const model of MODELS) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(90_000),
      headers: { 'x-api-key': AKEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'user', content: [...imgs.map(x => ({ type: 'image', source: { type: 'base64', media_type: x.media, data: x.data } })), { type: 'text', text }] }] }),
    }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }));
    if (r.ok) {
      const j = await r.json(); const out = (j.content || []).map(c => c.type === 'text' ? c.text : '').join('');
      const m = out.match(/\[[\s\S]*\]/); let cards = []; try { cards = m ? JSON.parse(m[0]) : []; } catch { }
      return send(res, 200, { cards: Array.isArray(cards) ? cards.slice(0, 12) : [], model });
    }
    last = { status: r.status, detail: (await r.text()).slice(0, 300) };
    if (r.status !== 404 && r.status !== 400) break;
  }
  console.error('scan failed', last);
  send(res, 502, { error: 'falha ao ler a foto', status: last?.status ?? null, detail: last?.detail || '' });
}

/* ---------- auth routes ---------- */
const emailOk = e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 200;
async function auth(req, res, route) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  if (route === 'me') { const u = await currentUser(req); return send(res, u ? 200 : 401, u ? { user: pub(u) } : { error: 'login' }); }
  if (req.method !== 'POST') return send(res, 405, { error: 'método' });
  if (route === 'logout') { clearSession(res); return send(res, 200, { ok: true }); }
  const b = await body(req, 10_000);
  if (route === 'login') {
    if (rateLimited('login:' + ip)) return send(res, 429, { error: 'Muitas tentativas. Espere 15 minutos.' });
    const email = String(b.email || '').trim().toLowerCase(); const all = await users();
    const id = Object.keys(all).find(k => all[k].email === email);
    if (!id || !checkPw(String(b.password || ''), all[id].pw)) return send(res, 401, { error: 'invalid credentials' });
    setSession(res, id); return send(res, 200, { user: pub({ id, ...all[id] }) });
  }
  if (route === 'signup') {
    if (rateLimited('signup:' + ip, 5)) return send(res, 429, { error: 'Muitas tentativas. Espere 15 minutos.' });
    const email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
    if (!emailOk(email)) return send(res, 400, { error: 'Email inválido.' });
    if (pw.length < 6) return send(res, 400, { error: 'A senha precisa de pelo menos 6 caracteres.' });
    const all = await users(); const first = Object.keys(all).length === 0;
    if (!first && !(INVITE && String(b.invite || '').trim() === INVITE)) return send(res, 403, { error: 'Cadastro fechado. Peça o código de convite ao dono do Fichário.' });
    if (Object.values(all).some(u => u.email === email)) return send(res, 409, { error: 'already registered' });
    const id = crypto.randomUUID(); all[id] = { email, pw: hashPw(pw), created: new Date().toISOString(), owner: first }; await saveUsers(all);
    setSession(res, id); return send(res, 200, { user: pub({ id, ...all[id] }) });
  }
  if (route === 'password') {
    const u = await currentUser(req); if (!u) return send(res, 401, { error: 'login' });
    const pw = String(b.password || ''); if (pw.length < 6) return send(res, 400, { error: 'A senha precisa de pelo menos 6 caracteres.' });
    const all = await users(); all[u.id].pw = hashPw(pw); await saveUsers(all); return send(res, 200, { user: pub(u) });
  }
  send(res, 404, { error: 'rota' });
}

/* ---------- owner settings ---------- */
async function settings(req, res, u) {
  if (!u.owner) return send(res, 403, { error: 'só o dono' });
  if (req.method === 'GET') return send(res, 200, { hasKey: !!AKEY, keyHint: AKEY ? AKEY.slice(0, 10) + '…' + AKEY.slice(-4) : '', invite: INVITE });
  if (req.method === 'POST') {
    const b = await body(req, 10_000); const k = String(b.anthropicKey || '').trim();
    if (k && !/^sk-ant-[\w-]{20,}$/.test(k)) return send(res, 400, { error: 'Chave inválida: deve começar com sk-ant-' });
    if (k) {
      const t = await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
      if (t && t.status === 401) return send(res, 400, { error: 'A Anthropic recusou essa chave (401). Confira se copiou inteira.' });
    }
    AKEY = k; await writeJSON(p('settings.json'), { anthropicKey: k }); try { await fs.chmod(p('settings.json'), 0o600); } catch { }
    return send(res, 200, { hasKey: !!AKEY, keyHint: AKEY ? AKEY.slice(0, 10) + '…' + AKEY.slice(-4) : '' });
  }
  send(res, 405, { error: 'método' });
}

/* ---------- router ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/auth/')) return await auth(req, res, url.pathname.slice(10));
    if (url.pathname === '/api/prices' && req.method === 'POST') return await prices(req, res);
    if (url.pathname.startsWith('/api/')) {
      const u = await currentUser(req); if (!u) return send(res, 401, { error: 'login' });
      if (url.pathname === '/api/collection') return await collection(req, res, u);
      if (url.pathname === '/api/photo') return await photo(req, res, u, url);
      if (url.pathname === '/api/settings') return await settings(req, res, u);
      if (url.pathname === '/api/scan' && req.method === 'POST') return await scan(req, res, u);
      return send(res, 404, { error: 'rota' });
    }
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });
    return await serveStatic(req, res, url);
  } catch (e) { console.error(e); if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'erro interno' }); }
});

/* ---------- CLI: node server.mjs reset-password email newpass ---------- */
if (process.argv[2] === 'reset-password') {
  const [email, pw] = [String(process.argv[3] || '').toLowerCase(), process.argv[4]];
  const all = await users(); const id = Object.keys(all).find(k => all[k].email === email);
  if (!id || !pw || pw.length < 6) { console.error('uso: reset-password <email> <senha-nova (6+)>'); process.exit(1); }
  all[id].pw = hashPw(pw); await saveUsers(all); console.log('senha trocada para', email); process.exit(0);
} else if (process.argv[2] === 'list-users') {
  const all = await users(); for (const k in all) console.log(all[k].email, all[k].created, all[k].owner ? '(dono)' : ''); process.exit(0);
} else {
  await fs.mkdir(DATA, { recursive: true });
  if (!AKEY) { const st = await readJSON(p('settings.json'), {}); if (st && st.anthropicKey) AKEY = st.anthropicKey; }
  server.listen(PORT, () => console.log('Fichário ouvindo na porta', PORT));
}
