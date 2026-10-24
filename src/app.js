import { getUser, login, signup, logout, handleAuthCallback, requestPasswordRecovery, updateUser, refreshSession } from '@netlify/identity';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const TYPE = { Grass: 'grass', Fire: 'fire', Water: 'water', Lightning: 'lightning', Psychic: 'psychic', Fighting: 'fighting', Darkness: 'darkness', Metal: 'metal', Fairy: 'fairy', Dragon: 'dragon', Colorless: 'colorless' };
const RAR = { C: 'Comum', U: 'Incomum', R: 'Rara', RH: 'Rara holo', 'Holo Rare': 'Rara holo', RR: 'Dupla rara', UR: 'Ultra rara', IR: 'Ilustração rara', SIR: 'Ilustração especial rara', HR: 'Hiper rara', SR: 'Secreta', ACE: 'ACE SPEC', SH: 'Brilhante', SUR: 'Brilhante ultra rara', Promo: 'Promo' };
const shortBrl = v => v >= 100 ? brl(v).replace(/,\d\d$/, '') : brl(v);
const brl = v => v == null ? '' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const S = { mineSort: 'valor', mineFilter: 'all', mineQ: '', photoBust: {}, trades: [], user: null, series: [], sets: [], setById: {}, cards: {}, owned: {}, view: 'home', from: 'home', setId: null, filter: 'all', q: '', gq: '', showAllSeries: {}, prices: {}, fx: null };

function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
function setSync(t) { $('#syncState').textContent = t ? '· ' + t : ''; }
const REV = '~r'; const baseNo = k => String(k).replace(/~r$/, ''); const isRev = k => /~r$/.test(k);
const qtyOf = (id, no) => { const o = S.owned[id] || {}; return (o[no] || 0) + (o[no + REV] || 0); };
const haveTxt = (id, no) => { const o = S.owned[id] || {}, n = o[no] || 0, r = o[no + REV] || 0; return r ? (n ? `${n} normal + ${r} ✨ brilhante` : `${r} ✨ brilhante`) : String(n); };
function ownedCount(id) { const o = S.owned[id]; if (!o) return { u: 0, c: 0, r: 0 }; const seen = new Set(); let c = 0, r = 0; for (const k in o) { const q = o[k]; if (q > 0) { seen.add(baseNo(k)); c += q; if (q > 1) r += q - 1; } } return { u: seen.size, c, r }; }
function totals() { let u = 0, c = 0, r = 0, st = 0; for (const id in S.owned) { const x = ownedCount(id); u += x.u; c += x.c; r += x.r; if (x.u) st++; } return { u, c, r, st }; }

/* ---------- catalog ---------- */
const serieReq = {};
function loadSerie(sid) { return serieReq[sid] ||= fetch('/data/s/' + sid + '.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(d => { Object.assign(S.cards, d); }).catch(e => { delete serieReq[sid]; throw e; }); }
async function loadCards(id) { if (S.cards[id]) return S.cards[id]; await loadSerie(S.setById[id].s); return S.cards[id] || []; }
let allP = null, allLoaded = false;
function loadAll() { return allP ||= Promise.all(S.series.map(se => loadSerie(se.id).catch(() => { }))).then(() => { allLoaded = true; if (S.view === 'search') renderResults(); }); }

/* ---------- api ---------- */
async function api(path, opts = {}) {
  try { await refreshSession(); } catch { }
  const r = await fetch(path, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (r.status === 401) { S.user = null; renderAuth('login', 'Sua sessão expirou. Entre de novo.'); throw new Error('login'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || ('Erro ' + r.status)), { status: r.status, detail: j.detail, upstream: j.status });
  return j;
}

/* ---------- persistence ---------- */
const cacheKey = () => 'fichario-owned-' + (S.user && S.user.id);
function localSave() { try { localStorage.setItem(cacheKey(), JSON.stringify(S.owned)); } catch { } }
let saveT = null, saving = false, dirty = false;
function scheduleSave() { localSave(); setSync('Salvando…'); clearTimeout(saveT); saveT = setTimeout(flush, 1200); }
async function flush() {
  saveT = null;
  if (saving) { dirty = true; return; }
  saving = true; dirty = false;
  const clean = {}; for (const id in S.owned) { const o = {}; for (const k in S.owned[id]) if (S.owned[id][k] > 0) o[k] = S.owned[id][k]; if (Object.keys(o).length) clean[id] = o; }
  try { await api('/api/collection', { method: 'PUT', body: JSON.stringify({ owned: clean, trades: S.tradesLoaded ? S.trades : undefined }) }); setSync('Salvo'); }
  catch (e) { if (e.message !== 'login') setSync('Não salvou. Vou tentar de novo.'); dirty = true; setTimeout(() => { if (dirty && !saveT) flush(); }, 5000); }
  saving = false; if (dirty && !saveT) flush();
}
window.addEventListener('beforeunload', e => { if (saveT || saving) { flush(); e.preventDefault(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveT) { clearTimeout(saveT); flush(); } });

async function loadCollection() {
  try { const v = localStorage.getItem(cacheKey()); if (v) S.owned = JSON.parse(v) || {}; } catch { }
  render();
  try { const j = await api('/api/collection'); S.owned = j.owned || {}; S.trades = Array.isArray(j.trades) ? j.trades : []; S.tradesLoaded = true; localSave(); setSync('Sincronizado'); render(); }
  catch (e) { if (e.message !== 'login') setSync('Sem conexão, mostrando cópia local'); }
}

/* ---------- prices ---------- */
const PRICE_TTL = 86_400_000; const PRICE_VER = 2;
try { const p = JSON.parse(localStorage.getItem('fichario-prices') || '{}'); if (p.v === PRICE_VER) { S.prices = p.prices || {}; S.fx = p.fx || null; } } catch { }
function savePrices() { try { localStorage.setItem('fichario-prices', JSON.stringify({ v: PRICE_VER, prices: S.prices, fx: S.fx })); } catch { } }
function priceBrl(pid, rev) { const p = S.prices[pid]; if (!p || !S.fx) return null; const usd = rev && p.usdR ? p.usdR : p.usd, eur = rev && p.eurR ? p.eurR : p.eur; if (usd && S.fx.usdBrl) return usd * S.fx.usdBrl; if (eur && S.fx.eurBrl) return eur * S.fx.eurBrl; return null; }
const inflight = new Set();
async function ensurePrices(pids, onDone) {
  const need = pids.filter(id => !inflight.has(id) && !(S.prices[id] && Date.now() - S.prices[id].t < PRICE_TTL));
  if (!need.length) return;
  need.forEach(id => inflight.add(id));
  for (let i = 0; i < need.length; i += 60) {
    const chunk = need.slice(i, i + 60);
    try {
      const j = await api('/api/prices', { method: 'POST', body: JSON.stringify({ ids: chunk }) });
      for (const id of chunk) S.prices[id] = j.prices[id] ? { ...j.prices[id], t: Date.now() } : { usd: null, eur: null, t: Date.now() };
      if (j.fx && j.fx.usdBrl) S.fx = j.fx;
      savePrices(); onDone && onDone();
    } catch { }
    chunk.forEach(id => inflight.delete(id));
  }
}

/* ---------- actions ---------- */
function setQty(setId, no, q) { if (!S.owned[setId]) S.owned[setId] = {}; if (q <= 0) delete S.owned[setId][no]; else S.owned[setId][no] = Math.min(q, 99); if (!Object.keys(S.owned[setId]).length) delete S.owned[setId]; scheduleSave(); }
function bump(setId, no, d) { const cur = (S.owned[setId] && S.owned[setId][no]) || 0; setQty(setId, no, cur + d); }

/* ---------- auth screens ---------- */
function renderAuth(mode, msg, isErr) {
  $('#topbar').hidden = true; $('#tabs').hidden = true; $('#foot').hidden = true;
  const m = msg ? `<div class="msg ${isErr ? 'err' : ''}">${esc(msg)}</div>` : '';
  let h = `<section class="auth"><h1>Fichário de Cartas</h1>`;
  if (mode === 'reset') {
    h += `<p>Escolha uma nova senha.</p>${m}<form id="resetForm" class="auth" style="margin:0"><label>Nova senha<input id="newPass" type="password" minlength="6" required autocomplete="new-password"></label><button class="btn">Salvar senha</button></form>`;
  } else {
    const isUp = mode === 'signup';
    h += `<p>${isUp ? 'Crie sua conta para guardar a coleção na nuvem.' : 'Entre para ver sua coleção de cartas Pokémon.'}</p>${m}
    <form id="authForm" class="auth" style="margin:0" data-mode="${mode}">
      <label>Email<input id="email" type="email" required autocomplete="email"></label>
      <label>Senha<input id="pass" type="password" minlength="6" required autocomplete="${isUp ? 'new-password' : 'current-password'}"></label>
      ${isUp ? '<label>Código de convite <small>(se pediram)</small><input id="invite" type="text" autocomplete="off"></label>' : ''}
      <button class="btn">${isUp ? 'Criar conta' : 'Entrar'}</button>
    </form>
    <div class="row"><button class="link" data-auth="${isUp ? 'login' : 'signup'}">${isUp ? 'Já tenho conta' : 'Criar conta'}</button>${isUp ? '' : '<button class="link" id="forgotBtn">Esqueci a senha</button>'}</div>`;
  }
  $('#main').innerHTML = h + '</section>';
}
function authError(e) {
  const t = String(e && (e.message || e)).toLowerCase();
  if (t.includes('invalid') || t.includes('credentials') || t.includes('password')) return 'Email ou senha incorretos.';
  if (t.includes('confirm')) return 'Confirme seu email antes de entrar. Procure a mensagem da Netlify na caixa de entrada.';
  if (t.includes('already') || t.includes('registered')) return 'Esse email já tem conta. Use "Entrar".';
  if (t.includes('identity') || t.includes('404')) return 'O login ainda não foi ativado neste site.';
  return 'Não deu certo: ' + (e && e.message || 'erro desconhecido');
}
async function enterApp(user) {
  S.user = user;
  $('#topbar').hidden = false; $('#tabs').hidden = false; $('#foot').hidden = false;
  $('#who').textContent = user.name || (user.email || '').split('@')[0];
  S.view = 'home';
  await loadCollection();
}

/* ---------- views ---------- */
function go(view, extra) { Object.assign(S, { view }, extra || {}); document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === (view === 'set' ? S.from : view) ? 'page' : 'false')); render(); window.scrollTo(0, 0); }

function setRow(s) {
  const x = ownedCount(s.id), pct = s.t ? Math.round(x.u / s.t * 100) : 0;
  return `<button class="setrow" data-set="${esc(s.id)}"><span class="nm">${esc(s.n)}</span><span class="ct"><b>${x.u}</b>/${s.t}</span><span class="meta">${esc(s.a || s.id.toUpperCase())} · ${s.d ? s.d.slice(0, 4) : ''}${s.n !== s.en && s.en ? ' · ' + esc(s.en) : ''}</span><span class="bar"><i class="${pct >= 100 ? 'full' : ''}" style="width:${pct}%"></i></span></button>`;
}
function renderHome() {
  const t = totals();
  const cv = collectionValue();
  let h = `<div class="stats">
    <button class="stat" data-go="mine"><b>${t.u}</b><span>Cartas diferentes</span><i>${t.c} cópias no total</i></button>
    <button class="stat" data-go="trade"><b>${t.r}</b><span>Repetidas</span><i>para trocar →</i></button>
    <button class="stat" data-go="mine"><b>${t.st}</b><span>Coleções</span><i>iniciadas</i></button>
    <button class="stat" data-go="mine"><b id="homeVal">${cv.v ? shortBrl(cv.v) : (t.u ? '…' : 'R$ 0')}</b><span>Valor estimado</span><i>ver detalhes →</i></button>
  </div>`;
  if (t.u) ensurePrices(ownedPids(), () => { const el = $('#homeVal'); if (el && S.view === 'home') { const v = collectionValue().v; el.textContent = shortBrl(v); } });
  for (const se of S.series) {
    const list = S.sets.filter(s => s.s === se.id); if (!list.length) continue;
    list.sort((a, b) => (ownedCount(b.id).u > 0) - (ownedCount(a.id).u > 0)); // sets you collect come first
    const started = list.filter(s => ownedCount(s.id).u > 0).length;
    const show = S.showAllSeries[se.id] ? list : list.slice(0, 4);
    h += `<h2>${esc(se.name)}<small>${list.length} coleções${started ? ' · ' + started + ' iniciadas' : ''}</small></h2><div class="sets">${show.map(setRow).join('')}</div>`;
    if (list.length > 4) h += `<button class="more" data-more="${esc(se.id)}">${S.showAllSeries[se.id] ? 'Mostrar menos' : 'Ver todas as ' + list.length}</button>`;
  }
  return h;
}

function imgUrl(setId, no, lang) { const s = S.setById[setId]; return `https://assets.tcgdex.net/${lang}/${s.s}/${setId}/${encodeURIComponent(no)}/low.webp`; }
function priceLinks(setId, c) {
  const s = S.setById[setId] || {}; const en = c[2] || c[1];
  const ed = s.a ? '&ed=' + encodeURIComponent(s.a) : '';
  return {
    liga: 'https://www.ligapokemon.com.br/?view=cards/search&card=' + encodeURIComponent(c[1]) + ed,
    tcg: 'https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=' + encodeURIComponent(en + (s.en ? ' ' + s.en : ''))
  };
}
function cardTile(setId, c, showSet, mode, rev) {
  const [no, name, , rar, cat, type] = c;
  const o = S.owned[setId] || {}; const qN = o[no] || 0, qR = o[no + REV] || 0, qAll = qN + qR;
  // Linha Brilhante so aparece quando ha copia brilhante (o scan e quem cataloga a versao reverse)
  const hasRev = c[6] !== 0 && qR > 0;
  const key = no + (rev ? REV : ''); const qThis = o[key] || 0;
  const tc = cat === 'T' ? 'var(--t-trainer)' : cat === 'E' ? 'var(--t-energy)' : `var(--t-${TYPE[type] || 'colorless'})`;
  const s = S.setById[setId]; const pid = setId + '-' + no; const L = priceLinks(setId, c);
  const dim = mode === 'view' ? false : mode === 'in' ? (qAll > 0 && !(TR.get[setId + '|' + key])) : (!qAll && !mode);
  const photoKey = setId + '|' + no;
  const img = S.photoBust[photoKey] ? `<img class="thumb" alt="" data-k="${esc(photoKey)}" src="/api/photo?k=${encodeURIComponent(photoKey)}&v=${S.photoBust[photoKey]}" data-ph="${esc(name)}">` : `<img class="thumb" loading="lazy" decoding="async" alt="" src="${imgUrl(setId, no, 'pt')}" data-fb="${imgUrl(setId, no, 'en')}" data-fb2="/api/photo?k=${encodeURIComponent(photoKey)}&c=2" data-ph="${esc(name)}" data-k="${esc(photoKey)}">`;
  const tapAttr = mode === 'view' ? 'data-noop="1"' : `data-${mode === 'in' ? 'tin' : mode === 'out' ? 'tout' : 'add'}="${esc(setId)}|${esc(mode ? key : no)}"`;
  const label = `<span class="no">${esc(no)}${s && /^\d+$/.test(no) ? '/' + s.o : ''}${showSet ? ' · ' + esc(s.a || s.id) : ''}</span><span class="cn">${esc(name)}</span>${showSet === 'name' && s ? `<span class="sn">${esc(s.n)}</span>` : ''}<span class="rr">${esc(RAR[rar] || rar || (cat === 'T' ? 'Treinador' : cat === 'E' ? 'Energia' : ''))}${mode && rev ? ' · ✨ Brilhante' : ''}</span>`;
  const qtyBtns = k => { const q = o[k] || 0; return `${q ? `<button data-sub="${esc(setId)}|${esc(k)}" aria-label="Tirar uma">−</button><b class="${q > 1 ? 'rep' : ''}">${q}</b>` : ''}<button class="plus" data-add="${esc(setId)}|${esc(k)}" aria-label="Somar uma">+</button>`; };
  const revRow = !mode && hasRev ? `<span class="revrow"><span class="rl">✨ Brilhante</span><span class="val" data-pid="${esc(pid)}" data-rev="1">${priceText(pid, true)}</span><span class="rq">${qtyBtns(no + REV)}</span></span>` : '';
  return `<div class="card ${dim ? 'miss' : ''} ${mode === 'in' && !qAll ? 'want' : ''}" style="--tc:${tc}"><span class="stripe"></span>
  ${img}${tradeBadge(setId, no, qAll, mode)}<button class="tap" ${tapAttr} aria-label="${mode === 'in' ? 'Receber' : mode === 'out' ? 'Dar' : 'Adicionar'} ${esc(name)}">${label}</button>
  <span class="px">${!mode && hasRev ? '<span class="rl">Normal</span>' : ''}<span class="val" data-pid="${esc(pid)}" data-rev="${mode && rev ? 1 : 0}">${priceText(pid, mode && rev)}</span><a href="${L.liga}" target="_blank" rel="noopener">Liga</a><a href="${L.tcg}" target="_blank" rel="noopener">TCGplayer</a></span>
  ${revRow}
  ${mode === 'view' ? '' : mode ? tradeQty(setId, key, mode) : `<span class="qty">${qtyBtns(no)}</span>`}</div>`;
}
// foto propria (servida por /api/photo) ganha o botao de girar
document.addEventListener('load', e => {
  const t = e.target; if (t.tagName !== 'IMG' || !t.classList.contains('thumb') || !t.dataset.k || !/\/api\/photo\?/.test(t.currentSrc || t.src)) return;
  const card = t.closest('.card'); if (!card || card.querySelector('.rot')) return;
  const b = document.createElement('button'); b.className = 'rot'; b.dataset.rot = t.dataset.k; b.setAttribute('aria-label', 'Girar foto'); b.textContent = '↻'; card.appendChild(b);
}, true);
async function rotatePhoto(key) {
  try { const r = await fetch('/api/photo?k=' + encodeURIComponent(key) + '&v=' + Date.now(), { credentials: 'same-origin' }); if (!r.ok) throw 0; await savePhoto(key, await r.blob(), null, true, 90); render(); }
  catch { toast('Não consegui girar a foto'); }
}
document.addEventListener('error', e => {
  const t = e.target; if (t.tagName !== 'IMG' || !t.classList.contains('thumb')) return;
  if (t.dataset.fb) { t.src = t.dataset.fb; t.dataset.fb = ''; return; }
  if (t.dataset.fb2) { t.src = t.dataset.fb2; t.dataset.fb2 = ''; return; }
  const ph = document.createElement('div'); ph.className = 'thumb ph'; ph.innerHTML = `<span>${esc(t.dataset.ph || '')}</span><small>sem imagem no catálogo</small>${t.dataset.k ? `<button class="snap" data-snap="${esc(t.dataset.k)}">📷 Tirar foto</button>` : ''}`;
  t.closest('.card') && t.closest('.card').classList.add('noimg'); t.replaceWith(ph);
}, true);
function priceText(pid, rev) { const v = priceBrl(pid, rev); if (v != null) return brl(v); const p = S.prices[pid]; return p && !p.usd && !p.eur ? 'sem preço' : ''; }
function refreshPriceLabels() { document.querySelectorAll('.val[data-pid]').forEach(el => { el.textContent = priceText(el.dataset.pid, el.dataset.rev === '1'); }); }

function renderSet() {
  const s = S.setById[S.setId]; const cards = S.cards[S.setId];
  if (!cards) return '<p class="empty">Carregando cartas…</p>';
  const x = ownedCount(s.id), pct = s.t ? Math.round(x.u / s.t * 100) : 0; const o = S.owned[s.id] || {};
  const nOf = no => (o[no] || 0) + (o[no + REV] || 0); const repOf = no => (o[no] || 0) > 1 || (o[no + REV] || 0) > 1;
  const cnt = { all: cards.length, have: cards.filter(c => nOf(c[0]) > 0).length }; cnt.miss = cnt.all - cnt.have; cnt.rep = cards.filter(c => repOf(c[0])).length;
  const q = norm(S.q);
  const list = cards.filter(c => { const n = nOf(c[0]); if (S.filter === 'have' && !n) return false; if (S.filter === 'miss' && n) return false; if (S.filter === 'rep' && !repOf(c[0])) return false; if (q && !norm(c[1]).includes(q) && !norm(c[2] || '').includes(q) && c[0] !== S.q.trim()) return false; return true; });
  const setVal = () => { let v = 0; for (const c of cards) { const pid = s.id + '-' + c[0]; v += (priceBrl(pid) || 0) * (o[c[0]] || 0) + (priceBrl(pid, true) || 0) * (o[c[0] + REV] || 0); } return v; }; let val = setVal();
  const chip = (k, l) => `<button class="chip" data-filter="${k}" aria-pressed="${S.filter === k}">${l}<span class="n">${cnt[k]}</span></button>`;
  ensurePrices(cards.map(c => s.id + '-' + c[0]), () => { if (S.view === 'set' && S.setId === s.id) { refreshPriceLabels(); const el = $('#setval'); if (el) { const v2 = setVal(); el.textContent = v2 ? 'Valor das suas: ' + brl(v2) : ''; } } });
  return `<div class="sethead"><div class="line1"><span>${esc(S.series.find(z => z.id === s.s)?.name || '')} · ${esc(s.a || s.id)} · ${esc(s.d)}</span><span>${s.o} oficiais</span></div><div><span class="big">${x.u}/${s.t}</span> <span class="sync">${pct}% completo${x.r ? ' · ' + x.r + ' repetidas' : ''}</span></div><div class="bar"><i class="${pct >= 100 ? 'full' : ''}" style="width:${pct}%"></i></div><div class="sync" id="setval">${val ? 'Valor das suas: ' + brl(val) : ''}</div></div>
  <div class="chips">${chip('all', 'Todas')}${chip('have', 'Tenho')}${chip('miss', 'Faltam')}${chip('rep', 'Repetidas')}</div>
  <input class="search" id="setq" type="search" placeholder="Filtrar por nome ou número" value="${esc(S.q)}" autocomplete="off">
  <p class="sync" style="margin:0 0 8px">Toque no nome para somar uma carta. Use − para tirar. Preço de mercado convertido para real.</p>
  ${list.length ? `<div class="grid">${list.map(c => cardTile(s.id, c)).join('')}</div>` : '<p class="empty">Nenhuma carta neste filtro.</p>'}`;
}

function renderSearch() { return `<input class="search" id="gq" type="search" placeholder="Nome (Charizard) ou número (045/198)" value="${esc(S.gq)}" autocomplete="off"><div id="results"></div>`; }
function renderResults() {
  const box = $('#results'); if (!box) return;
  const raw = S.gq.trim(); if (raw.length < 2) { box.innerHTML = '<p class="empty">Digite o nome do Pokémon ou o número impresso no canto da carta.</p>'; return; }
  if (!allLoaded) { box.innerHTML = '<p class="empty">Carregando o catálogo completo…</p>'; loadAll(); return; }
  const m = raw.match(/^0*(\d+)\s*\/\s*0*(\d+)$/); const q = norm(raw); const out = [];
  outer: for (const s of S.sets) { const cs = S.cards[s.id]; if (!cs) continue; for (const c of cs) { let hit; if (m) hit = String(parseInt(c[0], 10)) === m[1] && s.o === +m[2]; else if (/^\d+$/.test(raw)) hit = false; else hit = norm(c[1]).includes(q) || (c[2] && norm(c[2]).includes(q)); if (hit) out.push([s.id, c]); if (out.length >= 120) break outer; } }
  box.innerHTML = out.length ? `<p class="sync" style="margin:0 0 8px">${out.length >= 120 ? 'Primeiras 120' : out.length} cartas, das coleções mais novas para as mais antigas.</p><div class="grid">${out.map(([id, c]) => cardTile(id, c, true)).join('')}</div>` : `<p class="empty">Nada encontrado para “${esc(raw)}”.${/^\d+$/.test(raw) ? ' Digite no formato 045/198.' : ''}</p>`;
  ensurePrices(out.map(([id, c]) => id + '-' + c[0]), refreshPriceLabels);
}

function ownedPids() { const a = new Set(); for (const id in S.owned) for (const k in S.owned[id]) if (S.owned[id][k] > 0) a.add(id + '-' + baseNo(k)); return [...a]; }
function collectionValue() { let v = 0, priced = 0, n = 0; for (const id in S.owned) for (const k in S.owned[id]) { const q = S.owned[id][k]; if (q > 0) { n++; const p = priceBrl(id + '-' + baseNo(k), isRev(k)); if (p) { v += p * q; priced++; } } } return { v, priced, n }; }
function renderMine() {
  const keys = ownedPids();
  if (!keys.length) return `<div class="panel"><p>Você ainda não marcou nenhuma carta. Abra uma coleção em <b>Coleções</b>, use <b>Escanear</b>, ou importe um backup.</p><button class="btn" data-tab="home">Ver coleções</button><button class="btn ghost" data-go="backup">Importar backup (CSV)</button></div>`;
  const cv = collectionValue(); const t = totals();
  ensurePrices(keys, () => { if (S.view !== 'mine') return; const el = $('#cval'); if (el) el.innerHTML = valueHtml(collectionValue()); if (S.mineSort === 'valor') fillMine(); else refreshPriceLabels(); });
  const chip = (k, v, l) => `<button class="chip" data-${k}="${v}" aria-pressed="${(k === 'msort' ? S.mineSort : S.mineFilter) === v}">${l}</button>`;
  return `<div class="value" id="cval">${valueHtml(cv)}</div>
  <div class="chips">${chip('mfilter', 'all', 'Todas · ' + t.u)}${chip('mfilter', 'rep', 'Repetidas · ' + myRepeats().length)}</div>
  <div class="chips"><span class="sync" style="align-self:center">Ordenar:</span>${chip('msort', 'valor', 'Maior valor')}${chip('msort', 'colecao', 'Coleção')}${chip('msort', 'nome', 'Nome')}</div>
  <input class="search" id="mineq" type="search" placeholder="Filtrar suas cartas" value="${esc(S.mineQ)}" autocomplete="off">
  <div id="mineGrid" class="grid"><p class="empty">Carregando suas cartas…</p></div>
  <button class="btn ghost" data-go="backup" style="width:100%;margin-top:18px">Backup e importação (CSV)</button>`;
}
function splitPid(pid) { for (const id in S.owned) if (pid.startsWith(id + '-') && S.owned[id][pid.slice(id.length + 1)] != null) return [id, pid.slice(id.length + 1)]; const i = pid.lastIndexOf('-'); return [pid.slice(0, i), pid.slice(i + 1)]; }
async function fillMine() {
  if (!$('#mineGrid')) return;
  const ids = Object.keys(S.owned).filter(id => S.setById[id]);
  await Promise.all([...new Set(ids.map(id => S.setById[id].s))].map(sid => loadSerie(sid).catch(() => { })));
  let items = [];
  for (const id of ids) { const done = new Set(); for (const k in S.owned[id]) { const no = baseNo(k); if (done.has(no) || !(qtyOf(id, no) > 0)) continue; done.add(no); const c = (S.cards[id] || []).find(x => x[0] === no); if (c) { const o = S.owned[id]; items.push({ id, c, q: qtyOf(id, no), rep: (o[no] || 0) > 1 || (o[no + REV] || 0) > 1, v: Math.max(priceBrl(id + '-' + no) || 0, (o[no + REV] ? priceBrl(id + '-' + no, true) : 0) || 0), s: S.setById[id] }); } } }
  if (S.mineFilter === 'rep') items = items.filter(x => x.rep);
  const q = norm(S.mineQ.trim()); if (q) items = items.filter(x => norm(x.c[1]).includes(q) || norm(x.c[2] || '').includes(q) || norm(x.s.n).includes(q) || norm(x.s.en || '').includes(q));
  const col = new Intl.Collator('pt-BR', { numeric: true });
  if (S.mineSort === 'valor') items.sort((a, b) => b.v - a.v || col.compare(a.c[1], b.c[1]));
  else if (S.mineSort === 'nome') items.sort((a, b) => col.compare(a.c[1], b.c[1]));
  else items.sort((a, b) => (b.s.d || '').localeCompare(a.s.d || '') || col.compare(a.c[0], b.c[0]));
  const el = $('#mineGrid'); if (!el) return;
  el.innerHTML = items.length ? items.map(x => cardTile(x.id, x.c, 'name')).join('') : '<p class="empty">Nenhuma carta neste filtro.</p>';
}
function valueHtml(cv) { return `<span class="sub">Valor estimado da coleção</span><span class="big">${brl(cv.v)}</span><span class="sub">${cv.priced} de ${cv.n} cartas com preço${cv.priced < cv.n ? ' (buscando o resto…)' : ''}. Base: TCGplayer (US$) ou Cardmarket (€)${S.fx && S.fx.usdBrl ? ', dólar a ' + brl(S.fx.usdBrl) : ''}. Mercado brasileiro pode variar.</span>`; }
async function fillReps() {
  if (!$('#reps')) return; const items = [];
  for (const s of S.sets) { const o = S.owned[s.id]; if (!o || !Object.keys(o).some(k => o[k] > 1)) continue; const cs = await loadCards(s.id); cs.filter(c => o[c[0]] > 1).forEach(c => items.push([s.id, c])); }
  if ($('#reps')) $('#reps').innerHTML = `<div class="grid">${items.map(([id, c]) => cardTile(id, c, true)).join('')}</div>`;
}

/* ---------- scan ---------- */
window.__SC = null; setTimeout(() => { window.__SC = SC; });
const SC = { warn: [], busy: false, img: null, found: null, err: '', ctl: null };
function renderScan() {
  let h = `<div class="panel"><b>Escanear por foto</b><p>Para cadastrar muitas cartas: arrume 4 a 9 cartas na mesa (em grade, números visíveis), fotografe, repita, e depois escolha <b>todas as fotos de uma vez</b> na galeria.</p>
  <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="camBtn" ${SC.busy ? 'disabled' : ''}>Tirar foto</button><button class="btn ghost" id="galBtn" ${SC.busy ? 'disabled' : ''}>Escolher fotos da galeria</button>${SC.busy ? '<button class="btn ghost" id="stopBtn">Parar</button>' : ''}</div></div>`;
  if (SC.batch) h += `<div class="banner"><b>Foto ${SC.batch.i} de ${SC.batch.n}</b> · ${SC.found ? SC.found.length : 0} cartas lidas até agora</div>`;
  else if (SC.img) h += `<div class="scanimg"><img src="${SC.img}" alt="Foto enviada"></div>`;
  if (SC.busy && !SC.batch) h += `<p class="empty">Lendo as cartas da foto…</p>`;
  if (SC.err) h += `<div class="banner">${esc(SC.err)}</div>`;
  if (SC.warn && SC.warn.length) h += `<div class="banner">${SC.warn.map(esc).join('<br>')}</div>`;
  if (SC.found) {
    if (!SC.found.length && !SC.busy) h += `<p class="empty">Não encontrei cartas. Tente mais perto, com o número legível.</p>`;
    const pending = SC.found.filter(f => f.cands.length && !f.added);
    const doubt = pending.filter(f => f.conf < 7).length;
    if (pending.length > 1 && !SC.busy) h += `<button class="btn" id="addAllBtn" style="width:100%;margin-bottom:6px">Adicionar as ${pending.length} cartas à coleção</button>${doubt ? `<p class="sync" style="margin:0 0 10px">${doubt} marcada(s) com <b style="color:var(--warn)">confira</b>: o número não foi lido, então a versão pode estar errada. Use "Outra versão?" se precisar.</p>` : ''}`;
    const single = SC.found.length === 1;
    h += `<div class="grid">${SC.found.map((f, i) => scanResultTile(f, i, single)).join('')}</div>`;
    setTimeout(() => ensurePrices(SC.found.filter(f => f.cands.length).map(f => f.cands[0][0] + '-' + f.cands[0][1][0]), refreshPriceLabels));
  }
  return h;
}
function scanResultTile(f, i, single) {
  const r = f.read;
  if (!f.cands.length) return `<div class="candwrap"><span class="tag" style="color:var(--muted)">Não encontrada</span><div class="card miss"><span class="stripe"></span><span class="tap"><span class="cn">${esc(r.name || 'Ilegível')}</span><span class="rr">${esc([r.number && (r.number + (r.total ? '/' + r.total : '')), r.set_code].filter(Boolean).join(' · '))}${r.language && !/^(en|pt|es|fr|de|it)/i.test(r.language) ? ' · idioma ' + esc(r.language) + ' fora do catálogo' : ''}</span></span></div></div>`;
  const [id, c] = f.cands[0]; const have = qtyOf(id, c[0]);
  const alts = f.cands.slice(1).map(([i2, c2]) => `<option value="${esc(i2 + '|' + c2[0])}">${esc((S.setById[i2].a || i2) + ' ' + c2[0] + ' · ' + c2[1])}</option>`).join('');
  const fin = f.read.finish === 'reverse' && c[6] !== 0 ? '<span class="tag" style="color:var(--accent)">✨ Lida como brilhante</span>' : '';
  const tag = fin + (f.added ? '<span class="tag">✓ Adicionada</span>' : f.conf < 7 ? '<span class="tag" style="color:var(--warn)">Confira a versão</span>' : have ? `<span class="tag" style="color:var(--warn)">Você já tem ${haveTxt(id, c[0])}</span>` : '<span class="tag">Nova</span>');
  const lido = `<span class="lido">Lido: ${esc([r.name, r.number && (r.number + (r.total ? '/' + r.total : '')), r.set_code].filter(Boolean).join(' · ') || '—')}</span>`;
  return `<div class="candwrap">${tag}${lido}${cardTile(id, c, 'name')}${alts ? `<select class="altsel" data-salt="${i}"><option value="">Outra versão?</option>${alts}</select>` : ''}${single ? `<button class="usephoto" data-usephoto="${esc(id + '|' + c[0])}">Usar minha foto como imagem</button>` : ''}</div>`;
}
const scanKey = (f, c) => c[0] + (f.read.finish === 'reverse' && c[6] !== 0 ? REV : '');
const numKey = v => { v = String(v || '').toUpperCase().replace(/\s/g, ''); const m = v.match(/^([A-Z]*)0*(\d+)([A-Z]*)$/); return m ? m[1] + m[2] + m[3] : v; };
const isSpecialSet = s => /^(30th|tk-|fut2020|cel25cc)/.test(s.id) || /p$/.test(s.id) || ['mc', 'tk', 'misc'].includes(s.s);
function buildCtx(found) {
  const w = {};
  for (const f of found || []) if (f.cands && f.cands.length && f.conf >= 7) { const id = f.cands[0][0]; w[id] = (w[id] || 0) + 1; }
  for (const id in S.owned) if (Object.keys(S.owned[id]).length) w[id] = (w[id] || 0) + 0.5;
  return w;
}
function matchCard(r, ctx) {
  const nk = numKey(r.number), total = parseInt(r.total, 10), code = String(r.set_code || '').toUpperCase(), nm = norm(r.name || '');
  const nameOf = c => [norm(c[1]), norm(c[2] || '')];
  const nameHitOf = c => !!nm && nameOf(c).some(n => n && (n === nm || (nm.length >= 4 && n.length >= 4 && (n.includes(nm) || nm.includes(n)))));
  const isEnergy = /energ/.test(nm);
  const scored = [];
  for (const s of S.sets) {
    const cs = S.cards[s.id]; if (!cs) continue;
    const codeHit = !!code && (s.a || '').toUpperCase() === code; const totHit = !!total && s.o === total;
    const cw = ctx ? Math.min(ctx[s.id] || 0, 3) : 0; const special = isSpecialSet(s);
    for (const c of cs) {
      const numHit = !!nk && numKey(c[0]) === nk; const nameHit = nameHitOf(c);
      if (nm && !nameHit) {
        // energies and trainers are printed with names that differ from the catalog: trust set code + number
        if (!(numHit && codeHit && (isEnergy || c[4] === 'E' || c[4] === 'T'))) continue;
      }
      let sc = (numHit ? 3 : 0) + (codeHit ? 3 : 0) + (totHit ? 2 : 0) + (nameHit ? 4 : 1) + (nameOf(c).includes(nm) ? 0.5 : 0);
      if (nameHit && !numHit && !codeHit && !totHit) sc = 1 + (nameOf(c).includes(nm) ? 0.5 : 0) + cw - (special ? 0.8 : 0) + (s.d ? Number(s.d.slice(0, 4)) / 10000 : 0);
      else sc += cw * 0.3;
      if (sc > 0) scored.push([sc, s.id, c]);
    }
  }
  scored.sort((a, b) => b[0] - a[0]);
  const out = scored.slice(0, 4).map(x => [x[1], x[2]]); out.conf = scored.length ? scored[0][0] : 0; return out;
}
function encode(bmp, sx, sy, sw, sh, side, maxChars) {
  let q = 0.82, out = '';
  for (let i = 0; i < 8; i++) {
    const k = Math.min(1, side / Math.max(sw, sh));
    const cv = document.createElement('canvas'); cv.width = Math.round(sw * k); cv.height = Math.round(sh * k);
    cv.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    out = cv.toDataURL('image/jpeg', q);
    if (out.length <= maxChars) break;
    side = Math.round(side * 0.85); q = Math.max(0.6, q - 0.04);
  }
  return out;
}
// full photo + a zoomed strip of the bottom, where the collector number and set code are printed
async function prepImage(file, budget) {
  const bmp = await createImageBitmap(file); const W = bmp.width, H = bmp.height;
  const full = encode(bmp, 0, 0, W, H, 1600, Math.round(budget * 0.7));
  const top = Math.round(H * 0.70);
  const strip = encode(bmp, 0, top, W, H - top, 1400, Math.round(budget * 0.3));
  return [full, strip];
}
async function callScan(imgs, T, mode) { return api('/api/scan', { method: 'POST', body: JSON.stringify({ images: imgs, mode }), signal: T.ctl.signal }); }
// second pass for multi-card photos: crop the bottom edge of every card, stack them, and read the numbers
async function readNumbers(file, cards, T) {
  const boxed = cards.map((c, i) => ({ c, i, b: Array.isArray(c.box) && c.box.length === 4 ? c.box.map(Number) : null })).filter(x => x.b && x.b.every(v => v >= 0 && v <= 1.05) && x.b[2] > x.b[0] && x.b[3] > x.b[1]);
  if (!boxed.length) return;
  let bmp; try { bmp = await createImageBitmap(file); } catch (e) { throw new Error('foto não abriu: ' + (e && e.message)); }
  const W = bmp.width, H = bmp.height;
  const SW = 760, LBL = 54, strips = [];
  for (const x of boxed) {
    const [l, t, r, b] = x.b; const cw = (r - l) * W, ch = (b - t) * H;
    const sx = Math.max(0, l * W - cw * 0.03), sw = Math.min(W - sx, cw * 1.06);
    const sy = Math.max(0, t * H + ch * 0.84), sh = Math.min(H - sy, ch * 0.2);
    strips.push({ x, sx, sy, sw, sh, h: Math.round(sh * (SW - LBL) / sw) });
  }
  const total = strips.reduce((a, s) => a + s.h + 6, 0);
  const encodeStack = (scale, q) => {
    const cv = document.createElement('canvas'); cv.width = Math.round(SW * scale); cv.height = Math.round(total * scale);
    const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height); g.scale(scale, scale);
    let y = 0;
    strips.forEach((s, k) => { g.drawImage(bmp, s.sx, s.sy, s.sw, s.sh, LBL, y, SW - LBL, s.h); g.fillStyle = '#fff'; g.fillRect(0, y, LBL - 4, s.h); g.fillStyle = '#000'; g.font = 'bold 30px sans-serif'; g.textBaseline = 'middle'; g.fillText(String(k + 1), 10, y + s.h / 2); y += s.h + 6; });
    return cv.toDataURL('image/jpeg', q);
  };
  let img = encodeStack(1, 0.82);
  for (let k = 0; img.length > 200000 && k < 6; k++) img = encodeStack(0.85 ** (k + 1), 0.72);
  let j;
  try { j = await callScan([img], T, 'numbers'); }
  catch (e) { if (e.status === 502 && /size|limit|large/i.test(e.detail || '')) j = await callScan([encodeStack(0.6, 0.7)], T, 'numbers'); else throw e; }
  for (const r of (j.cards || [])) {
    const s = strips[Number(r.i) - 1]; if (!s) continue; const card = s.x.c;
    if (r.number) { card.number = String(r.number); card.total = String(r.total || ''); }
    if (r.set_code) card.set_code = String(r.set_code);
    if (r.finish === 'reverse' || r.finish === 'normal') card.finish = r.finish;
  }
}
async function runScan(file, T = SC, view = 'scan', append = false) {
  const SC = T;
  let imgs;
  try { imgs = await prepImage(file, 260000); } catch { SC.err = 'Não consegui abrir essa imagem. Tente outra foto.'; render(); return; }
  SC.img = imgs[0]; SC.busy = true; if (!append) { SC.err = ''; SC.found = null; if (SC === window.__SC) SC.warn = []; } render();
  const allReady = loadAll();
  SC.ctl = new AbortController();
  try {
    let j;
    try { j = await callScan(imgs, SC); }
    catch (e1) {
      if (e1.status === 502 && /size|limit|large/i.test(e1.detail || '')) {
        try { j = await callScan(await prepImage(file, 140000), SC); }
        catch (e2) { if (e2.status === 502 && /size|limit|large/i.test(e2.detail || '')) j = await callScan(await prepImage(file, 80000), SC); else throw e2; }
      }
      else throw e1;
    }
    if ((j.cards || []).length > 1) { try { await readNumbers(file, j.cards, SC); } catch (e) { if (e.name === 'AbortError') throw e; SC.warn = (SC.warn || []).concat('Foto ' + (SC.photoNo || 1) + ': não consegui ler os números (' + String(e && (e.detail || e.message) || e).slice(0, 120) + '). As versões foram escolhidas pela coleção mais provável.'); } }
    await allReady;
    const got = (j.cards || []).map(r => { const read = { name: String(r.name || ''), number: String(r.number || ''), total: String(r.total || ''), set_code: String(r.set_code || ''), language: String(r.language || ''), finish: String(r.finish || '') }; const cands = matchCard(read); return { read, cands, conf: cands.conf || 0, photo: SC.photoNo || 1, file, box: (j.cards || []).length > 1 && Array.isArray(r.box) ? r.box : null }; });
    const ctx = buildCtx((append ? (SC.found || []) : []).concat(got));
    for (const f of got) if (f.conf < 7) { const c2 = matchCard(f.read, ctx); f.cands = c2; f.conf = c2.conf || 0; }
    SC.found = append ? (SC.found || []).concat(got) : got;
  } catch (e) {
    if (e.name === 'AbortError') { }
    else if (e.message === 'login') return;
    else if (e.status === 503) SC.err = 'A leitura por IA ainda não está ativa neste site.';
    else if (e.status === 429) SC.err = 'Muitos scans seguidos. Espere um pouco.';
    else SC.err = 'Não consegui ler a foto agora. Tente de novo.' + (e.detail ? ' (detalhe: ' + (e.upstream || '') + ' ' + e.detail + ')' : '');
  }
  SC.busy = false; SC.ctl = null; if (S.view === view) render();
}
async function runBatch(files) {
  SC.found = []; SC.err = ''; SC.warn = []; SC.batch = { n: files.length, i: 0, stop: false };
  for (let i = 0; i < files.length && !SC.batch.stop; i++) { SC.batch.i = i + 1; SC.photoNo = i + 1; await runScan(files[i], SC, 'scan', true); }
  SC.batch = null; if (S.view === 'scan') render();
}


// rot: undefined = automatico (foto deitada gira 90 anti-horario, celular de lado), 90 = girar 90 horario (botao)
async function savePhoto(key, src, box, quiet, rot) {
  try {
    const bmp = await createImageBitmap(src instanceof Blob ? src : await (await fetch(src)).blob(), { imageOrientation: 'from-image' });
    let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
    if (box && box.length === 4) { const [l, t, r, b] = box.map(Number); const pw = (r - l) * bmp.width * 0.02, phh = (b - t) * bmp.height * 0.02; sx = Math.max(0, l * bmp.width - pw); sy = Math.max(0, t * bmp.height - phh); sw = Math.min(bmp.width - sx, (r - l) * bmp.width + 2 * pw); sh = Math.min(bmp.height - sy, (b - t) * bmp.height + 2 * phh); }
    const cw = rot === 90, turn = cw || (rot === undefined && !box && sw > sh * 1.1);
    const k = Math.min(1, 480 / (turn ? sw : sh)); const w = Math.round(sw * k), h = Math.round(sh * k);
    const cv = document.createElement('canvas'); cv.width = turn ? h : w; cv.height = turn ? w : h; const g = cv.getContext('2d');
    if (turn && cw) { g.translate(cv.width, 0); g.rotate(Math.PI / 2); } else if (turn) { g.translate(0, cv.height); g.rotate(-Math.PI / 2); }
    g.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
    let q = 0.82, url = cv.toDataURL('image/jpeg', q); while (url.length > 250000 && q > 0.4) { q -= 0.1; url = cv.toDataURL('image/jpeg', q); }
    await api('/api/photo', { method: 'PUT', body: JSON.stringify({ k: key, image: url }) });
    S.photoBust[key] = Date.now(); if (!quiet) { toast('Foto salva como imagem da carta'); render(); }
    return true;
  } catch { if (!quiet) toast('Não consegui salvar a foto'); return false; }
}
// after a scan, store a cropped photo for every added card the catalog has no image for
async function autoPhotos(list) {
  let n = 0;
  for (const f of list) {
    if (!f.file || !f.cands.length) continue; const [id, c] = f.cands[0]; const key = id + '|' + c[0];
    if (S.photoBust[key] || !(await hasNoImage(id, c[0]))) continue;
    if (await savePhoto(key, f.file, f.box, true)) n++;
  }
  if (n) { toast(n + ' foto(s) salvas para cartas sem imagem'); render(); }
}
const imgCheck = {};
function hasNoImage(id, no) {
  const k = id + '|' + no; if (k in imgCheck) return imgCheck[k];
  return imgCheck[k] = new Promise(res => { let i = 0; const urls = [imgUrl(id, no, 'pt'), imgUrl(id, no, 'en')]; const im = new Image(); im.onload = () => res(false); im.onerror = () => { if (++i < urls.length) im.src = urls[i]; else res(true); }; im.src = urls[0]; });
}
/* ---------- trades ---------- */
const TR = { give: {}, get: {}, found: null, img: null, busy: false, err: '', ctl: null, q: '', confirm: false, step: 'friend', scanFor: 'friend' };
const TM = { found: null, img: null, busy: false, err: '', ctl: null };
const splitKey = k => { const i = k.lastIndexOf('|'); return [k.slice(0, i), k.slice(i + 1)]; };
const cardByKey = k => { const [id, no] = splitKey(k); const c = (S.cards[id] || []).find(x => x[0] === baseNo(no)); return c ? [id, c, isRev(no)] : null; };
function rerenderKeep() { const y = window.scrollY; if (S.view === 'trade') { render(); } else render(); window.scrollTo(0, y); }
function tradeBadge(setId, no, q, mode) {
  if (mode !== 'in') return '';
  return q > 0 ? `<span class="tb have">Você tem ${q}</span>` : `<span class="tb need">Não tenho</span>`;
}
function tradeQty(setId, no, mode) {
  const k = setId + '|' + no; /* no may carry the ~r suffix */ const n = mode === 'in' ? TR.get[k] : TR.give[k];
  if (!n) return '';
  return `<span class="qty"><button data-${mode === 'in' ? 'tin-sub' : 'tout-sub'}="${esc(k)}" aria-label="Tirar uma">−</button><b class="${mode === 'in' ? '' : 'rep'}">${mode === 'in' ? '+' : '−'}${n}</b></span>`;
}
function sideValue(map) { let v = 0, missing = 0; for (const k in map) { const [id, no] = splitKey(k); const p = priceBrl(id + '-' + baseNo(no), isRev(no)); if (p) v += p * map[k]; else missing++; } return { v, missing }; }
function myRepeats() { const out = []; for (const s of S.sets) { const o = S.owned[s.id]; if (!o) continue; for (const no in o) if (o[no] > 1) out.push([s.id, no]); } return out; }
function renderTrade() {
  const g = sideValue(TR.give), r = sideValue(TR.get); const bal = r.v - g.v;
  const nG = count(TR.give), nR = count(TR.get);
  let h = '';
  if (nG || nR) h += `<div class="tradebar"><div><span class="sub">Você dá</span><b>${nG} · ${brl(g.v)}</b></div><div><span class="sub">Você recebe</span><b>${nR} · ${brl(r.v)}</b></div><div><span class="sub">Saldo</span><b class="${bal > 0.5 ? 'pos' : bal < -0.5 ? 'neg' : ''}">${bal >= 0 ? '+' : ''}${brl(bal)}</b></div></div>`;
  const st = TR.step; const stepCls = k => st === k ? 'on' : '';
  h += `<div class="steps"><button class="${stepCls('friend')}" data-tstep="friend">1 · Carta do amigo</button><button class="${stepCls('mine')}" data-tstep="mine">2 · Sua carta</button><button class="${stepCls('review')}" data-tstep="review">3 · Confirmar</button></div>`;

  if (st === 'friend') {
    h += `<div class="panel"><b>Escaneie a carta do seu amigo</b><p>Eu digo se você já tem e pergunto se quer trocar. Pode ser uma carta ou uma página do fichário dele.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="trCam" ${TR.busy ? 'disabled' : ''}>Tirar foto</button><button class="btn ghost" id="trGal" ${TR.busy ? 'disabled' : ''}>Da galeria</button>${TR.busy ? '<button class="btn ghost" id="trStop">Parar</button>' : ''}</div>
    <input class="search" id="trq" type="search" placeholder="Ou busque pelo nome ou 045/198" value="${esc(TR.q)}" autocomplete="off" style="margin:0"></div><div id="trSearch"></div>`;
    if (TR.busy) h += `<p class="empty">Lendo a carta do amigo…</p>`;
    if (TR.err) h += `<div class="banner">${esc(TR.err)}</div>`;
    if (TR.found) {
      const open = TR.found.filter(f => !f.decided);
      if (!TR.found.length) h += `<p class="empty">Não encontrei cartas na foto.</p>`;
      else if (!open.length) h += `<p class="sync">Todas as cartas desta foto já foram respondidas.</p>`;
      h += `<div class="grid">${TR.found.map((f, i) => f.decided ? '' : friendTile(f, i)).join('')}</div>`;
      setTimeout(() => ensurePrices(TR.found.filter(f => f.cands.length).map(f => f.cands[0][0] + '-' + f.cands[0][1][0]), refreshPriceLabels));
    }
    if (nR) h += `<button class="btn" data-tstep="mine" style="width:100%;margin-top:14px">Próximo: escolher a carta que você dá →</button>`;
  }

  if (st === 'mine') {
    const want = Object.keys(TR.get).map(cardByKey).filter(Boolean);
    if (want.length) h += `<p class="sync" style="margin:0 0 8px">Você quer: <b>${esc(want.map(([, c]) => c[1]).join(', '))}</b></p>`;
    h += `<div class="panel"><b>Escaneie a sua carta repetida</b><p>Eu confiro quantas você tem e separo para dar. Se preferir, escolha na lista das suas repetidas logo abaixo.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="tmCam" ${TM.busy ? 'disabled' : ''}>Tirar foto da minha carta</button><button class="btn ghost" id="tmGal" ${TM.busy ? 'disabled' : ''}>Da galeria</button>${TM.busy ? '<button class="btn ghost" id="tmStop">Parar</button>' : ''}</div></div>`;
    if (TM.busy) h += `<p class="empty">Lendo a sua carta…</p>`;
    if (TM.err) h += `<div class="banner">${esc(TM.err)}</div>`;
    if (TM.found) {
      h += `<div class="grid">${TM.found.map((f, i) => f.decided ? '' : myTile(f, i)).join('')}</div>`;
      setTimeout(() => ensurePrices(TM.found.filter(f => f.cands.length).map(f => f.cands[0][0] + '-' + f.cands[0][1][0]), refreshPriceLabels));
    }
    const reps = myRepeats();
    h += `<h2>Ou escolha nas suas repetidas<small>${reps.length ? 'toque para dar' : 'nenhuma ainda'}</small></h2>`;
    h += reps.length ? `<div id="trReps" class="grid"><p class="empty">Carregando…</p></div>` : `<p class="sync">Quando você tiver 2 ou mais cópias de uma carta, ela aparece aqui.</p>`;
    if (nG || nR) h += `<button class="btn" data-tstep="review" style="width:100%;margin-top:14px">Revisar a troca →</button>`;
    setTimeout(fillTradeReps);
  }

  if (st === 'review') {
    if (!nG && !nR) h += `<div class="panel"><p>Nenhuma carta na troca ainda.</p><button class="btn" data-tstep="friend">Escanear a carta do amigo</button></div>`;
    else {
      const getKeys = Object.keys(TR.get), giveKeys = Object.keys(TR.give);
      h += `<h2>Você recebe<small>${nR} carta(s)</small></h2>${getKeys.length ? `<div class="grid">${getKeys.map(cardByKey).filter(Boolean).map(([id, c, r]) => cardTile(id, c, 'name', 'in', r)).join('')}</div>` : '<p class="sync">Nada.</p>'}`;
      h += `<h2>Você dá<small>${nG} carta(s)</small></h2>${giveKeys.length ? `<div class="grid">${giveKeys.map(cardByKey).filter(Boolean).map(([id, c, r]) => cardTile(id, c, 'name', 'out', r)).join('')}</div>` : '<p class="sync">Nada. Toque em "2 · Sua carta" para escolher.</p>'}`;
      if (g.missing || r.missing) h += `<p class="sync">${g.missing + r.missing} carta(s) sem preço de mercado ficam fora do saldo.</p>`;
      if (TR.confirm) h += `<div class="panel" style="margin-top:14px"><b>Confirmar a troca?</b><p>Dou baixa em ${nG} carta(s) da sua coleção e somo ${nR} carta(s) do amigo. Fica registrado no histórico.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="trApply">Confirmar troca</button><button class="btn ghost" id="trCancelDone">Voltar</button></div></div>`;
      else h += `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn" id="trDone" style="flex:1">Concluir troca</button><button class="btn ghost" data-tstep="friend">+ Mais cartas</button><button class="btn ghost" id="trReset">Cancelar</button></div>`;
    }
  }

  if (S.trades.length) {
    h += `<h2>Histórico<small>${S.trades.length} troca(s)</small></h2><div class="sets">${S.trades.slice().reverse().slice(0, 20).map(tr => `<div class="setrow" style="cursor:default"><span class="nm">${new Date(tr.t).toLocaleDateString('pt-BR')} · deu ${count(tr.give)} · recebeu ${count(tr.get)}</span><span class="ct">${tr.vGet != null ? (tr.vGet - tr.vGive >= 0 ? '+' : '') + brl(tr.vGet - tr.vGive) : ''}</span><span class="meta">Recebeu: ${esc(listNames(tr.get, 3))} · Deu: ${esc(listNames(tr.give, 3))}</span></div>`).join('')}</div>`;
  }
  return h;
}
function altSelect(f, i, which) {
  const alts = f.cands.slice(1).map(([i2, c2]) => `<option value="${esc(i2 + '|' + c2[0])}">${esc((S.setById[i2].a || i2) + ' ' + c2[0] + ' · ' + c2[1])}</option>`).join('');
  return alts ? `<select class="altsel" data-talt="${which}:${i}"><option value="">Outra versão?</option>${alts}</select>` : '';
}
function friendTile(f, i) {
  if (!f.cands.length) return `<div class="candwrap"><span class="tag" style="color:var(--muted)">Não encontrada</span><div class="card miss"><span class="stripe"></span><span class="tap"><span class="cn">${esc(f.read.name || 'Ilegível')}</span><span class="rr">Procure pelo nome na busca acima</span></span></div></div>`;
  const [id, c] = f.cands[0]; const have = qtyOf(id, c[0]); const rv = isRev(scanKey(f, c));
  const verdict = have ? `<div class="verdict have">Você já tem ${haveTxt(id, c[0])}</div>` : `<div class="verdict need">Você NÃO tem esta carta</div>`;
  return `<div class="candwrap">${verdict}${cardTile(id, c, 'name', 'view', rv)}${altSelect(f, i, 'TR')}
    <div class="ask"><span>Quer trocar?</span><button class="btn" data-want="${i}">Sim</button><button class="btn ghost" data-skip="${i}">Não</button></div></div>`;
}
function myTile(f, i) {
  if (!f.cands.length) return `<div class="candwrap"><span class="tag" style="color:var(--muted)">Não encontrada</span><div class="card miss"><span class="stripe"></span><span class="tap"><span class="cn">${esc(f.read.name || 'Ilegível')}</span><span class="rr">Escolha na lista das repetidas</span></span></div></div>`;
  const [id, c] = f.cands[0]; const sk = scanKey(f, c); const have = (S.owned[id] || {})[sk] || 0; const giving = TR.give[id + '|' + sk] || 0;
  const info = have >= 2 ? `<div class="verdict have">Você tem ${have} · fica com ${have - giving - 1}</div>` : have === 1 ? `<div class="verdict warn">Você só tem 1: não é repetida</div>` : `<div class="verdict warn">Não está no seu fichário</div>`;
  return `<div class="candwrap">${info}${cardTile(id, c, 'name', 'view', isRev(sk))}${altSelect(f, i, 'TM')}
    <div class="ask"><button class="btn" data-givescan="${i}" style="flex:1">Dar esta carta</button></div></div>`;
}
const count = m => Object.values(m || {}).reduce((a, b) => a + b, 0);
function listNames(m, n) { const ks = Object.keys(m || {}); const names = ks.slice(0, n).map(k => { const x = cardByKey(k); return x ? x[1][1] : k; }); return (names.join(', ') || '—') + (ks.length > n ? ' +' + (ks.length - n) : ''); }
function candTile(f) {
  const [id, c] = f.cands[0];
  const alts = f.cands.slice(1).map(([i2, c2]) => `<option value="${esc(i2 + '|' + c2[0])}">${esc((S.setById[i2].a || i2) + ' ' + c2[0] + ' · ' + c2[1])}</option>`).join('');
  return `<div class="candwrap">${cardTile(id, c, true, 'in')}${alts ? `<select class="altsel" data-alt="${esc(f.read.name + '|' + f.read.number)}"><option value="">Outra versão?</option>${alts}</select>` : ''}</div>`;
}
async function fillTradeReps() {
  const box = $('#trReps'); if (!box) return;
  const reps = myRepeats(); await Promise.all([...new Set(reps.map(([id]) => S.setById[id].s))].map(sid => loadSerie(sid).catch(() => { })));
  const items = reps.map(([id, k]) => { const c = (S.cards[id] || []).find(x => x[0] === baseNo(k)); return c ? [id, c, isRev(k)] : null; }).filter(Boolean);
  if ($('#trReps')) $('#trReps').innerHTML = items.map(([id, c, r]) => cardTile(id, c, 'name', 'out', r)).join('');
  ensurePrices(items.map(([id, c]) => id + '-' + c[0]), refreshPriceLabels);
}
async function renderTradeSearch() {
  const box = $('#trSearch'); if (!box) return;
  const raw = TR.q.trim(); if (raw.length < 2) { box.innerHTML = ''; return; }
  box.innerHTML = '<p class="empty">Buscando…</p>'; await loadAll(); if (!$('#trSearch')) return;
  const m = raw.match(/^0*(\d+)\s*\/\s*0*(\d+)$/); const q = norm(raw); const out = [];
  outer: for (const s of S.sets) { for (const c of (S.cards[s.id] || [])) { const hit = m ? (String(parseInt(c[0], 10)) === m[1] && s.o === +m[2]) : (norm(c[1]).includes(q) || (c[2] && norm(c[2]).includes(q))); if (hit) out.push([s.id, c]); if (out.length >= 40) break outer; } }
  $('#trSearch').innerHTML = out.length ? `<div class="grid" style="margin-bottom:12px">${out.map(([id, c]) => cardTile(id, c, true, 'in')).join('')}</div>` : `<p class="empty">Nada encontrado.</p>`;
  ensurePrices(out.map(([id, c]) => id + '-' + c[0]), refreshPriceLabels);
}
document.addEventListener('change', e => {
  if (e.target.dataset && e.target.dataset.talt && e.target.value) {
    const [which, idx] = e.target.dataset.talt.split(':'); const f = (which === 'TM' ? TM : TR).found[+idx];
    const [id, no] = splitKey(e.target.value); const i = f.cands.findIndex(([i2, c2]) => i2 === id && c2[0] === no);
    if (i > 0) { const [x] = f.cands.splice(i, 1); f.cands.unshift(x); } render(); return;
  }
  if (e.target.dataset && e.target.dataset.salt != null && e.target.value) { const f = SC.found[+e.target.dataset.salt]; const [id, no] = splitKey(e.target.value); const i = f.cands.findIndex(([i2, c2]) => i2 === id && c2[0] === no); if (i > 0) { const [x] = f.cands.splice(i, 1); f.cands.unshift(x); f.conf = 10; } render(); return; }
  if (e.target.classList && e.target.classList.contains('altsel') && e.target.value) {
    const key = e.target.dataset.alt; const f = TR.found && TR.found.find(x => x.read.name + '|' + x.read.number === key); if (!f) return;
    const [id, no] = splitKey(e.target.value); const i = f.cands.findIndex(([i2, c2]) => i2 === id && c2[0] === no);
    if (i > 0) { const [x] = f.cands.splice(i, 1); f.cands.unshift(x); } render();
  }
});
function applyTrade() {
  const g = sideValue(TR.give), r = sideValue(TR.get);
  for (const k in TR.give) { const [id, no] = splitKey(k); const have = (S.owned[id] && S.owned[id][no]) || 0; setQty(id, no, have - TR.give[k]); }
  for (const k in TR.get) { const [id, no] = splitKey(k); const have = (S.owned[id] && S.owned[id][no]) || 0; setQty(id, no, have + TR.get[k]); }
  S.trades.push({ t: Date.now(), give: { ...TR.give }, get: { ...TR.get }, vGive: Math.round(g.v * 100) / 100, vGet: Math.round(r.v * 100) / 100 });
  if (S.trades.length > 300) S.trades = S.trades.slice(-300);
  scheduleSave();
  TR.give = {}; TR.get = {}; TR.found = null; TR.img = null; TR.confirm = false; TR.q = ''; TR.step = 'friend'; TM.found = null;
  toast('Troca registrada'); render(); window.scrollTo(0, 0);
}

/* ---------- owner settings (self-hosted) ---------- */
async function fillOwner(msg, err) {
  const box = $('#ownerPanel'); if (!box) return;
  let st; try { st = await api('/api/settings'); } catch { box.hidden = true; return; }
  box.innerHTML = `<b>Configuração do dono</b>
  <p>Scan por foto: ${st.hasKey ? '<b style="color:var(--good)">ativo</b> · chave ' + esc(st.keyHint) : '<b style="color:var(--warn)">desativado</b> · cole a chave da API da Anthropic'}</p>
  <form id="keyForm" style="display:grid;gap:8px"><input id="akey" type="password" placeholder="sk-ant-..." autocomplete="off" style="border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:var(--r);padding:11px;font:inherit;font-size:16px"><button class="btn">${st.hasKey ? 'Trocar chave' : 'Salvar chave'}</button></form>
  ${msg ? `<div class="msg ${err ? 'err' : ''}">${esc(msg)}</div>` : ''}
  ${st.invite ? `<p>Código de convite para a família: <b style="font-family:var(--f-mono)">${esc(st.invite)}</b></p>` : ''}`;
}
document.addEventListener('submit', async e => {
  if (e.target.id !== 'keyForm') return; e.preventDefault();
  const k = $('#akey').value.trim(); const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Testando a chave…';
  try { await api('/api/settings', { method: 'POST', body: JSON.stringify({ anthropicKey: k }) }); fillOwner('Chave salva. O scan já está ativo.'); }
  catch (er) { fillOwner(er.message, true); }
});
/* ---------- backup ---------- */
function renderBackup() {
  const t = totals();
  return `<div class="panel"><b>Onde fica salvo</b><p>Sua coleção fica salva na sua conta (${esc(S.user && S.user.email)}). Entre com o mesmo email em qualquer aparelho e ela aparece igual.</p></div>
  ${S.user && S.user.owner ? `<div class="panel" id="ownerPanel"><b>Configuração do dono</b><p>Carregando…</p></div>` : ''}
  <div class="panel"><b>Exportar coleção</b><p>Gera uma planilha (CSV) com ${t.u} cartas e as quantidades.</p><button class="btn" id="exportBtn">Exportar CSV</button></div>
  <div class="panel"><b>Importar coleção</b><p>Restaura um CSV exportado daqui ou da versão anterior do Fichário (a que rodava dentro do Claude). As quantidades do arquivo substituem as atuais das mesmas cartas.</p><button class="btn ghost" id="importBtn">Escolher arquivo CSV</button></div>`;
}
async function exportCsv() {
  const rows = [['colecao_id', 'colecao', 'numero', 'variante', 'nome', 'raridade', 'quantidade', 'preco_estimado_brl']];
  for (const s of S.sets) { const o = S.owned[s.id]; if (!o || !Object.keys(o).length) continue; const cs = await loadCards(s.id); for (const c of cs) for (const rv of [false, true]) { const k = c[0] + (rv ? REV : ''); if (o[k] > 0) { const v = priceBrl(s.id + '-' + c[0], rv); rows.push([s.id, s.n, c[0], rv ? 'brilhante' : 'normal', c[1], RAR[c[3]] || c[3], o[k], v ? v.toFixed(2) : '']); } } }
  const csv = '﻿' + rows.map(r => r.map(v => { v = String(v); return /[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const file = new File([blob], 'fichario-cartas-' + new Date().toISOString().slice(0, 10) + '.csv', { type: 'text/csv' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Backup do Fichário' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function parseCsv(text) { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < text.length; i++) { const ch = text[i]; if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = ''; } else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (ch !== '\r') cur += ch; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; }
async function importCsv(file) {
  const rows = parseCsv((await file.text()).replace(/^﻿/, '')); const head = rows.shift() || [];
  const iS = head.indexOf('colecao_id'), iN = head.indexOf('numero'), iQ = head.indexOf('quantidade'), iV = head.indexOf('variante');
  if (iS < 0 || iN < 0 || iQ < 0) { toast('Arquivo não reconhecido. Use um CSV exportado do Fichário.'); return; }
  let n = 0;
  for (const r of rows) { const id = r[iS], no = r[iN] && r[iN] + (iV >= 0 && /brilh|rev/i.test(r[iV] || '') ? REV : ''), q = parseInt(r[iQ], 10); if (!S.setById[id] || !no || isNaN(q)) continue; if (!S.owned[id]) S.owned[id] = {}; if (q > 0) S.owned[id][no] = Math.min(q, 99); else delete S.owned[id][no]; n++; }
  scheduleSave(); toast(n + ' cartas importadas'); render();
}

function render() {
  if (!S.user) return;
  const main = $('#main'); $('#back').hidden = !(S.view === 'set' || S.view === 'backup');
  if (S.view === 'set') { $('#title').textContent = S.setById[S.setId]?.n || ''; main.innerHTML = renderSet(); }
  else if (S.view === 'search') { $('#title').textContent = 'Buscar carta'; if (!$('#gq')) main.innerHTML = renderSearch(); renderResults(); }
  else if (S.view === 'scan') { $('#title').textContent = 'Escanear'; main.innerHTML = renderScan(); }
  else if (S.view === 'mine') { $('#title').textContent = 'Minhas cartas'; main.innerHTML = renderMine(); fillMine(); }
  else if (S.view === 'backup') { $('#title').textContent = 'Backup'; main.innerHTML = renderBackup(); fillOwner(); }
  else if (S.view === 'trade') { $('#title').textContent = 'Trocas'; main.innerHTML = renderTrade(); }
  else { $('#title').textContent = 'Fichário de Cartas'; main.innerHTML = renderHome(); }
}

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.auth) { renderAuth(t.dataset.auth); return; }
  if (t.id === 'forgotBtn') { const em = $('#email').value.trim(); if (!em) { renderAuth('login', 'Digite seu email no campo acima e toque de novo em "Esqueci a senha".', true); return; } try { await requestPasswordRecovery(em); renderAuth('login', 'Enviamos um link para ' + em + '. Abra pelo celular para criar a nova senha.'); } catch (err) { renderAuth('login', authError(err), true); } return; }
  if (t.id === 'logoutBtn') { if (saveT) { clearTimeout(saveT); await flush(); } try { await logout(); } catch { } S.user = null; S.owned = {}; renderAuth('login', 'Você saiu.'); return; }
  if (!S.user) return;
  if (t.dataset.tab) { go(t.dataset.tab); return; }
  if (t.id === 'back') { go(S.view === 'backup' ? 'mine' : (S.from || 'home')); return; }
  if (t.dataset.set) { const id = t.dataset.set; S.from = S.view === 'set' ? S.from : S.view; go('set', { setId: id, filter: 'all', q: '' }); if (!S.cards[id]) { await loadCards(id); render(); } return; }
  if (t.dataset.more) { S.showAllSeries[t.dataset.more] = !S.showAllSeries[t.dataset.more]; render(); return; }
  if (t.dataset.filter) { S.filter = t.dataset.filter; render(); return; }
    if (t.dataset.add && S.view === 'scan' && SC.found) { const f = SC.found.find(x => x.cands.length && x.cands[0][0] + '|' + x.cands[0][1][0] === t.dataset.add.replace(/~r$/, '') && !x.added); if (f) { f.added = true; autoPhotos([f]); } }
  if (t.dataset.add || t.dataset.sub) { const [id, no] = (t.dataset.add || t.dataset.sub).split('|'); bump(id, no, t.dataset.add ? 1 : -1); const y = window.scrollY; if (S.view === 'search') renderResults(); else render(); window.scrollTo(0, y); return; }
  if (t.dataset.usephoto) { const f = SC.found && SC.found.find(x => x.cands.length && x.cands[0][0] + '|' + x.cands[0][1][0] === t.dataset.usephoto); if (f && f.file) savePhoto(t.dataset.usephoto, f.file, f.box); return; }
  if (t.dataset.rot) { rotatePhoto(t.dataset.rot); return; }
  if (t.dataset.snap) { S.snapKey = t.dataset.snap; $('#snapFile').click(); return; }
  if (t.dataset.msort) { S.mineSort = t.dataset.msort; render(); return; }
  if (t.dataset.mfilter) { S.mineFilter = t.dataset.mfilter; render(); return; }
  if (t.dataset.go) { go(t.dataset.go); return; }
  if (t.dataset.tin) { const k = t.dataset.tin; TR.get[k] = (TR.get[k] || 0) + 1; if (TR.step === 'friend') { TR.step = 'mine'; TR.q = ''; TM.found = null; toast('Agora escaneie a sua carta para dar'); render(); window.scrollTo(0, 0); return; } rerenderKeep(); return; }
  if (t.dataset.tinSub) { const k = t.dataset.tinSub; if (TR.get[k] > 1) TR.get[k]--; else delete TR.get[k]; rerenderKeep(); return; }
  if (t.dataset.tout) { const k = t.dataset.tout; const [id, no] = splitKey(k); const have = (S.owned[id] && S.owned[id][no]) || 0; if ((TR.give[k] || 0) < have) { TR.give[k] = (TR.give[k] || 0) + 1; if (TR.step === 'mine') { TR.step = 'review'; render(); window.scrollTo(0, 0); return; } } else toast('Você só tem ' + have); rerenderKeep(); return; }
  if (t.dataset.toutSub) { const k = t.dataset.toutSub; if (TR.give[k] > 1) TR.give[k]--; else delete TR.give[k]; rerenderKeep(); return; }
  if (t.dataset.tstep) { TR.step = t.dataset.tstep; TR.confirm = false; render(); window.scrollTo(0, 0); return; }
  if (t.dataset.want != null) { const f = TR.found[+t.dataset.want]; const [id, c] = f.cands[0]; const k = id + '|' + scanKey(f, c); TR.get[k] = (TR.get[k] || 0) + 1; f.decided = true; TR.step = 'mine'; TM.found = null; TM.err = ''; toast('Agora escaneie a sua carta para dar'); render(); window.scrollTo(0, 0); return; }
  if (t.dataset.skip != null) { TR.found[+t.dataset.skip].decided = true; render(); return; }
  if (t.dataset.givescan != null) { const f = TM.found[+t.dataset.givescan]; const [id, c] = f.cands[0]; const k = id + '|' + scanKey(f, c); TR.give[k] = (TR.give[k] || 0) + 1; f.decided = true; TR.step = 'review'; render(); window.scrollTo(0, 0); return; }
  if (t.id === 'tmCam') { TR.scanFor = 'mine'; $('#camFile').click(); return; }
  if (t.id === 'tmGal') { TR.scanFor = 'mine'; $('#galFile').click(); return; }
  if (t.id === 'tmStop') { TM.ctl && TM.ctl.abort(); return; }
  if (t.id === 'trCam') { TR.scanFor = 'friend'; $('#camFile').click(); return; }
  if (t.id === 'trGal') { TR.scanFor = 'friend'; $('#galFile').click(); return; }
  if (t.id === 'trStop') { TR.ctl && TR.ctl.abort(); return; }
  if (t.id === 'trClear') { TR.found = null; TR.img = null; TR.err = ''; render(); return; }
  if (t.id === 'trDone') { TR.confirm = true; render(); return; }
  if (t.id === 'trCancelDone') { TR.confirm = false; render(); return; }
  if (t.id === 'trApply') { applyTrade(); return; }
  if (t.id === 'trReset') { TR.give = {}; TR.get = {}; TR.found = null; TR.img = null; TR.confirm = false; TR.step = 'friend'; TM.found = null; render(); return; }
  if (t.id === 'camBtn') { $('#camFile').click(); return; }
  if (t.id === 'galBtn') { $('#galFile').click(); return; }
  if (t.id === 'stopBtn') { if (SC.batch) SC.batch.stop = true; SC.ctl && SC.ctl.abort(); return; }
  if (t.id === 'addAllBtn') { let n = 0; const just = []; SC.found.forEach(f => { if (f.cands.length && !f.added) { const [id, c] = f.cands[0]; bump(id, scanKey(f, c), 1); f.added = true; n++; just.push(f); } }); toast(n + ' cartas adicionadas'); render(); autoPhotos(just); return; }
  if (t.id === 'exportBtn') { exportCsv(); return; }
  if (t.id === 'importBtn') { $('#importFile').click(); return; }
});
document.addEventListener('submit', async e => {
  e.preventDefault();
  if (e.target.id === 'authForm') {
    const mode = e.target.dataset.mode, email = $('#email').value.trim(), pass = $('#pass').value;
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      if (mode === 'signup') { const u = await signup(email, pass, { invite: ($('#invite') || {}).value || '' }); if (u && u.confirmedAt) await enterApp(await login(email, pass)); else renderAuth('login', 'Conta criada. Enviamos um email de confirmação para ' + email + '. Confirme e depois entre.'); }
      else await enterApp(await login(email, pass));
    } catch (err) { renderAuth(mode, authError(err), true); }
  }
  if (e.target.id === 'resetForm') {
    try { await updateUser({ password: $('#newPass').value }); toast('Senha atualizada'); await enterApp(await getUser()); } catch (err) { renderAuth('reset', authError(err), true); }
  }
});
let qT;
document.addEventListener('input', e => {
  if (e.target.id === 'setq') { S.q = e.target.value; clearTimeout(qT); qT = setTimeout(() => { const pos = e.target.selectionStart; render(); const el = $('#setq'); el.focus(); try { el.setSelectionRange(pos, pos); } catch { } }, 200); }
  if (e.target.id === 'mineq') { S.mineQ = e.target.value; clearTimeout(qT); qT = setTimeout(fillMine, 200); }
  if (e.target.id === 'trq') { TR.q = e.target.value; clearTimeout(qT); qT = setTimeout(renderTradeSearch, 250); }
  if (e.target.id === 'gq') { S.gq = e.target.value; clearTimeout(qT); qT = setTimeout(renderResults, 250); }
});
$('#snapFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f && S.snapKey) savePhoto(S.snapKey, f); });
$('#importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importCsv(f); e.target.value = ''; });
['#camFile', '#galFile'].forEach(sel => $(sel).addEventListener('change', e => { const files = [...e.target.files].slice(0, 40); const f = files[0]; e.target.value = ''; if (!f) return; if (S.view === 'trade') { const T = TR.scanFor === 'mine' ? TM : TR; if (!T.busy) runScan(f, T, 'trade'); } else if (!SC.busy) { if (files.length > 1) runBatch(files); else runScan(f); } }));

/* ---------- boot ---------- */
(async () => {
  try { const d = await (await fetch('/data/sets.json')).json(); S.series = d.series; S.sets = d.sets; S.sets.forEach(s => S.setById[s.id] = s); }
  catch { $('#main').innerHTML = '<p class="empty">Não consegui carregar o catálogo. Recarregue a página.</p>'; return; }
  try {
    const cb = await handleAuthCallback();
    if (cb && cb.type === 'recovery') { S.user = cb.user; renderAuth('reset'); return; }
    if (cb && cb.type === 'confirmation') toast('Email confirmado');
  } catch (e) { renderAuth('login', 'O link expirou ou já foi usado. Entre ou peça um novo.', true); return; }
  let u = null; try { u = await getUser(); } catch { }
  if (u) enterApp(u); else renderAuth('login');
})();
