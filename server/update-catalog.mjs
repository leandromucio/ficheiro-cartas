// Atualiza o catálogo de cartas (TCGdex) em DATA_DIR/catalog — o servidor prefere essa pasta à cópia da imagem.
// Uso (dentro do container):  node update-catalog.mjs            → busca coleções novas/alteradas e grava
//                             node update-catalog.mjs --check a,b → reconstrói as coleções a,b e compara, sem gravar
// Regra do catálogo original: lista de coleções em INGLÊS, sem o TCG Pocket (série tcgp) e sem jumbo/rc/sp/wp;
// nome em português quando existe (coleção sem versão PT: traduz pelo nome da mesma carta em outra coleção); raridade/categoria/tipo/variante vêm da carta em inglês.
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const DATA = process.env.DATA_DIR || '/data';
const OUT = path.join(DATA, 'catalog');
const BASE = await fs.stat(path.join(OUT, 'sets.json')).then(() => OUT, () => path.join(ROOT, 'public', 'data'));
const API = 'https://api.tcgdex.net/v2';
const SKIP_SETS = new Set(['jumbo', 'rc', 'sp', 'wp']), SKIP_SERIES = new Set(['tcgp']);
const RECENT_DAYS = 120; // coleções recentes são refeitas: ganham tradução e cartas novas depois do lançamento
const RAR = { Common: 'C', Uncommon: 'U', Rare: 'R', 'Rare Holo': 'RH', 'Double rare': 'RR', 'Ultra Rare': 'UR', 'Illustration rare': 'IR',
  'Special illustration rare': 'SIR', 'Hyper rare': 'HR', 'Secret Rare': 'SR', 'ACE SPEC Rare': 'ACE', 'Shiny rare': 'SH', 'Shiny Ultra Rare': 'SUR', None: '' };
const CAT = { Pokemon: 'P', 'Pokémon': 'P', Trainer: 'T', Energy: 'E' };

async function get(url, optional) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (r.status === 404 && optional) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (i === 3) throw new Error(url + ': ' + e.message); await new Promise(r => setTimeout(r, 2000 * (i + 1))); }
  }
}
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

// Conservador com o que ja existe (prev): nunca perde traducao, nunca tira carta, nao aceita total zerado.
// A API as vezes publica a colecao em PT com traducao incompleta ou some com uma carta.
async function buildSet(id, prev) {
  const en = await get(`${API}/en/sets/${encodeURIComponent(id)}`);
  const pt = await get(`${API}/pt/sets/${encodeURIComponent(id)}`, true);
  const ptName = new Map((pt && pt.cards || []).map(c => [c.localId, c.name]));
  const old = new Map(((prev && prev.cards) || []).map(c => [c[0], c]));
  const cards = await pool(en.cards || [], 4, async c => {
    const d = await get(`${API}/en/cards/${encodeURIComponent(en.id + '-' + c.localId)}`);
    const o = old.get(c.localId), nEn = d.name || c.name;
    const nPt = ptName.get(c.localId) || (o && o[2] ? o[1] : undefined) || (pt ? undefined : EN2PT.get(nEn)); // colecao sem versao PT: nome da mesma carta em outra colecao
    const rar = d.rarity == null ? '' : (RAR[d.rarity] ?? d.rarity);
    const rev = d.variants ? (d.variants.reverse ? 1 : 0) : o ? o[6] : 2; // 2 = API nao informa (app trata como 'pode ter brilhante')
    return [c.localId, nPt || nEn, nPt && nPt !== nEn ? nEn : 0, rar, CAT[d.category] || '', (d.types && d.types[0]) || '', rev];
  });
  const seen = new Set(cards.map(c => c[0])); for (const c of old.values()) if (!seen.has(c[0])) cards.push(c); // carta que a API tirou continua
  const p = prev && prev.set;
  const set = { id: en.id, s: en.serie.id, n: (pt && pt.name) || en.name, en: en.name, d: en.releaseDate || (p && p.d), o: en.cardCount.official || (p && p.o) || cards.length, t: cards.length, a: (en.abbreviation && en.abbreviation.official) || (p && p.a) || '' };
  return { set, cards, serie: en.serie, ptSerie: pt && pt.serie };
}

const base = JSON.parse(await fs.readFile(path.join(BASE, 'sets.json'), 'utf8'));
const byId = new Map(base.sets.map(s => [s.id, s]));
// dicionario ingles -> portugues montado com o proprio catalogo (cartas que ja tem as duas versoes do nome)
const EN2PT = new Map();
for (const f of await fs.readdir(path.join(BASE, 's'))) for (const cs of Object.values(JSON.parse(await fs.readFile(path.join(BASE, 's', f), 'utf8')))) for (const c of cs) if (c[2] && !EN2PT.has(c[2])) EN2PT.set(c[2], c[1]);
const files = new Map(); const loadFile = async sid => { if (!files.has(sid)) files.set(sid, JSON.parse(await fs.readFile(path.join(BASE, 's', sid + '.json'), 'utf8').catch(() => '{}'))); return files.get(sid); };
const check = process.argv.indexOf('--check');

if (check > 0) { // validação: reconstrói e compara com o que está salvo
  const ids = (process.argv[check + 1] || '').split(',').filter(Boolean); let diffs = 0;
  for (const id of ids) {
    const old = byId.get(id); const oldCards = (await loadFile(old.s))[id];
    const { set, cards } = await buildSet(id, { set: old, cards: oldCards });
    for (const k of Object.keys(old)) if (old[k] !== set[k]) { diffs++; console.log(id, 'set.' + k, JSON.stringify(old[k]), '->', JSON.stringify(set[k])); }
    if (cards.length !== oldCards.length) { diffs++; console.log(id, 'qtd cartas', oldCards.length, '->', cards.length); }
    const om = new Map(oldCards.map(c => [c[0], c]));
    for (const c of cards) { const o = om.get(c[0]); if (!o) { diffs++; console.log(id, 'carta nova', c); continue; } if (JSON.stringify(o) !== JSON.stringify(c)) { diffs++; console.log(id, JSON.stringify(o), '->', JSON.stringify(c)); } }
    console.log(id, cards.length, 'cartas conferidas');
  }
  console.log(diffs ? `${diffs} diferença(s)` : 'idêntico ao catálogo salvo'); process.exit(0);
}

const list = await get(`${API}/en/sets`);
const today = Date.now();
const recent = s => s.d && (today - Date.parse(s.d)) / 864e5 <= RECENT_DAYS;
const todo = [];
for (const s of list) {
  if (SKIP_SETS.has(s.id)) continue;
  const cur = byId.get(s.id);
  if (!cur) { todo.push(s.id); continue; } // nova (a série tcgp é filtrada depois de buscar o detalhe)
  if (recent(cur) || (s.cardCount && (s.cardCount.total !== cur.t || s.cardCount.official !== cur.o))) todo.push(s.id);
}
const series = new Map(base.series.map(x => [x.id, x]));
let added = 0, updated = 0; const failed = [];
for (const id of todo) {
  const cur = byId.get(id); let r; try { r = await buildSet(id, cur && { set: cur, cards: (await loadFile(cur.s))[id] }); } catch (e) { failed.push(id + ' (' + e.message.slice(0, 80) + ')'); continue; } // falhou: mantém a versão antiga
  if (SKIP_SERIES.has(r.set.s) || !r.cards.length || !r.set.d) continue;
  if (!series.has(r.set.s)) series.set(r.set.s, { id: r.set.s, name: (r.ptSerie && r.ptSerie.name) || r.serie.name, d: r.set.d });
  (await loadFile(r.set.s))[id] = r.cards;
  if (byId.has(id)) { Object.assign(byId.get(id), r.set); updated++; }
  else { // encaixa na série pela data, mantendo a ordem existente
    const i = base.sets.findIndex(x => x.s === r.set.s && x.d <= r.set.d); const j = i >= 0 ? i : base.sets.findLastIndex(x => x.s === r.set.s) + 1 || base.sets.length;
    base.sets.splice(j, 0, r.set); byId.set(id, r.set); added++;
  }
}
for (const x of series.values()) x.d = base.sets.filter(s => s.s === x.id).reduce((m, s) => s.d > m ? s.d : m, '');
base.series = [...series.values()].filter(x => x.d).sort((a, b) => b.d.localeCompare(a.d));

// grava tudo numa pasta nova e troca de uma vez (o app nunca vê catálogo pela metade)
const tmp = OUT + '.tmp'; await fs.rm(tmp, { recursive: true, force: true }); await fs.mkdir(path.join(tmp, 's'), { recursive: true });
for (const f of await fs.readdir(path.join(BASE, 's'))) await fs.copyFile(path.join(BASE, 's', f), path.join(tmp, 's', f));
for (const [sid, d] of files) await fs.writeFile(path.join(tmp, 's', sid + '.json'), JSON.stringify(d));
await fs.writeFile(path.join(tmp, 'sets.json'), JSON.stringify(base));
const old = OUT + '.old'; await fs.rm(old, { recursive: true, force: true });
await fs.rename(OUT, old).catch(() => { }); await fs.rename(tmp, OUT); await fs.rm(old, { recursive: true, force: true });
const nCards = (await Promise.all([...new Set(base.sets.map(s => s.s))].map(loadFile))).reduce((n, f) => n + Object.values(f).reduce((m, c) => m + c.length, 0), 0);
console.log(JSON.stringify({ quando: new Date().toISOString(), conferidas: todo.length, novas: added, atualizadas: updated, falhas: failed, colecoes: base.sets.length, cartas: nCards }));
if (failed.length) process.exitCode = 1;
