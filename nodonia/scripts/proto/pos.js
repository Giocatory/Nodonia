/* Протокол: Proof-of-Stake со слотами и эпохами (упрощённый «Ethereum-подобный»): случайный предлагающий пропорционально стейку,
   FFG-голоса за контрольные точки эпох, justified → finalized при 2/3 стейка, slashing за двойное голосование, утечка неактивности. */
(function (G) {
  'use strict';
  const ND = G.ND;
  const GEN = { id: 'genesis', parent: null, slot: 0, proposer: '—' };
  const gl = sim => sim.G_pos || (sim.G_pos = { produced: 0, maxSlot: 0, slashed: {}, slashEvents: 0, leaked: 0, finTimes: {} });
  const blk = (st, id) => st.blocks[id];
  const par = (st, b) => b && b.parent ? st.blocks[b.parent] : null;
  const total = st => { let t = 0; for (const id in st.stakes) if (!st.slashed[id]) t += st.stakes[id]; return t; };
  const idxOf = (sim, id) => sim.nodes.findIndex(n => n.id === id);
  const epochOf = (ctx, slot) => Math.floor(slot / ctx.params.epochSlots);

  /** контрольная точка эпохи ep на цепи с вершиной headId: последний блок со слотом ≤ ep·E */
  function cpOf(st, headId, ep, E) { let b = blk(st, headId); const lim = ep * E; while (b && b.slot > lim) b = par(st, b); return b ? b.id : 'genesis'; }
  function extendsFin(st, b) {
    const fid = st.fin[st.finEp], f = blk(st, fid); if (!f) return true; let x = b;
    while (x) { if (x.id === fid) return true; if (x.slot < f.slot) return false; x = par(st, x); } return false;
  }
  function recomputeHead(st) {
    let best = blk(st, st.fin[st.finEp]) || GEN;
    for (const id in st.blocks) { const b = st.blocks[id]; if (extendsFin(st, b) && (b.slot > best.slot || (b.slot === best.slot && b.id < best.id))) best = b; }
    st.head = best.id;
  }
  function proposerOf(ctx, slot) {
    const st = ctx.st, ids = ctx.sim.nodes.map(n => n.id); let tot = 0; for (const id of ids) tot += st.snap[id] || 0;
    if (tot <= 0) return null;
    const r = parseInt(ND.sha256('pos:' + ctx.sim.seed + ':' + slot).slice(0, 8), 16) / 4294967296 * tot; let acc = 0;
    for (const id of ids) { acc += st.snap[id] || 0; if (r < acc) return id; } return ids[ids.length - 1];
  }

  function addBlock(ctx, b, from) {
    const st = ctx.st; if (st.blocks[b.id]) return false;
    if (b.parent !== null && !st.blocks[b.parent]) { (st.orphans[b.parent] = st.orphans[b.parent] || []).push(b); if (from) ctx.send(from, 'sync', {}); return false; }
    st.blocks[b.id] = b; const h = blk(st, st.head);
    if (extendsFin(st, b) && (b.slot > h.slot || (b.slot === h.slot && b.id < h.id))) {
      if (b.parent !== h.id) ctx.mark('смена вершины: ветвь ' + b.id.slice(0, 5) + ' (слот ' + b.slot + ') тяжелее', 'c-orange');
      st.head = b.id;
    }
    const kids = st.orphans[b.id]; if (kids) { delete st.orphans[b.id]; for (const k of kids) addBlock(ctx, k, from); }
    return true;
  }

  function slashOn(ctx, v, ep, a, b, fromMsg) {
    const st = ctx.st, g = gl(ctx.sim); if (st.slashed[v]) return;
    st.slashed[v] = 1; const before = st.stakes[v]; st.stakes[v] = before * (1 - ctx.params.slashPercent / 100);
    if (!g.slashed[v]) { g.slashed[v] = { t: ctx.now, lost: before - st.stakes[v] }; g.slashEvents++; }
    ctx.mark('SLASHING: ' + v + ' проголосовал дважды за эпоху ' + ep + ' (' + String(a).slice(0, 4) + ' и ' + String(b).slice(0, 4) + ') — стейк ' + Math.round(before) + ' → ' + Math.round(st.stakes[v]), 'c-red');
    if (!fromMsg) ctx.sendNeighbors('slash', { v, ep, a, b });
    evalFFG(ctx);
  }

  function evalFFG(ctx) {
    const st = ctx.st, tot = total(st); if (tot <= 0) return;
    const eps = Object.keys(st.votes).map(Number).sort((a, b) => a - b);
    for (const ep of eps) {
      const cnt = {}, fin = {};
      for (const v in st.votes[ep]) { if (st.slashed[v]) continue; const x = st.votes[ep][v]; if (st.just[x.sep] !== x.sid) continue; const w = st.stakes[v] || 0; cnt[x.tid] = (cnt[x.tid] || 0) + w; if (x.sep === ep - 1) fin[x.tid + '|' + x.sid] = (fin[x.tid + '|' + x.sid] || 0) + w; }
      for (const tid in cnt) if (cnt[tid] * 3 >= 2 * tot - 1e-9 && st.just[ep] === undefined) { st.just[ep] = tid; if (ep > st.maxJust) st.maxJust = ep; ctx.mark('эпоха ' + ep + ' ОБОСНОВАНА (justified): ≥ 2/3 стейка проголосовало за контрольную точку ' + tid.slice(0, 5), 'c-teal'); }
      for (const k in fin) { const [tid, sid] = k.split('|'); if (fin[k] * 3 >= 2 * tot - 1e-9 && st.just[ep] === tid && st.fin[ep - 1] === undefined && st.just[ep - 1] === sid) { st.fin[ep - 1] = sid; if (ep - 1 > st.finEp) { st.finEp = ep - 1; gl(ctx.sim).finTimes[ep - 1] = gl(ctx.sim).finTimes[ep - 1] || ctx.now; ctx.mark('эпоха ' + (ep - 1) + ' ФИНАЛИЗИРОВАНА — блоки до неё необратимы', 'c-green'); recomputeHead(st); } } }
    }
  }
  function handleVote(ctx, v, ep, tid, sep, sid) {
    const st = ctx.st, key = v + ':' + ep + ':' + tid; if (st.seen[key]) return false; st.seen[key] = 1;
    if (st.slashed[v]) return false;
    const vs = st.votes[ep] || (st.votes[ep] = {}), prev = vs[v];
    if (prev && prev.tid !== tid) { slashOn(ctx, v, ep, prev.tid, tid, false); return true; }
    if (!prev) vs[v] = { tid, sep, sid };
    evalFFG(ctx); return true;
  }

  function epochStart(ctx, ep) {
    const st = ctx.st, g = gl(ctx.sim), p = ctx.params, pe = ep - 1;
    if (pe >= 1 && pe - st.finEp > p.leakAfter) {
      let n = 0; for (const id in st.stakes) if (!st.slashed[id] && !(st.votes[pe] && st.votes[pe][id])) { st.stakes[id] *= (1 - p.leakPct / 100); n++; }
      if (n) { g.leaked++; ctx.log('утечка неактивности: финальность отстаёт на ' + (pe - st.finEp) + ' эпох — ' + n + ' неголосовавших теряют ' + p.leakPct + '% стейка', 'warn'); }
    }
    st.snap = {}; for (const id in st.stakes) if (!st.slashed[id]) st.snap[id] = st.stakes[id];
    for (const e of Object.keys(st.votes)) if (+e < ep - 8) delete st.votes[e];
    if (Object.keys(st.seen).length > 3000) st.seen = {};
  }
  function produce(ctx, slot) {
    const st = ctx.st, g = gl(ctx.sim), p = blk(st, st.head);
    const b = { id: ND.sha256(p.id + ':' + slot + ':' + ctx.id).slice(0, 10), parent: p.id, slot, proposer: ctx.id };
    g.produced++; st.blocks[b.id] = b; st.head = b.id; ctx.mark('предлагает блок слота ' + slot + ' (' + b.id.slice(0, 5) + ')', 'c-gold'); ctx.sendNeighbors('blk', { b });
  }
  function castVote(ctx, forceFork) {
    const st = ctx.st, E = ctx.params.epochSlots, ep = epochOf(ctx, st.slot); if (ep < 1 || st.slashed[ctx.id]) return;
    if (!forceFork && st.lastVote >= ep) return;
    const tid = cpOf(st, st.head, ep, E), sep = st.maxJust, sid = st.just[sep];
    st.lastVote = ep; ctx.mark('голосует за контрольную точку эпохи ' + ep + ' (' + tid.slice(0, 5) + ')', 'c-blue');
    if (handleVote(ctx, ctx.id, ep, tid, sep, sid)) ctx.sendNeighbors('att', { v: ctx.id, ep, tid, sep, sid });
    return { ep, tid, sep, sid };
  }

  ND.registerProtocol({
    id: 'pos', title: 'PoS: слоты, финальность, slashing', group: 'Блокчейн', order: 30, short: 'Предлагающий по стейку, голосование 2/3, финализация эпох, штрафы за двойное голосование.',
    desc: '<p>В <b>Proof-of-Stake</b> право предложить блок получают <b>валидаторы</b> пропорционально <b>стейку</b> (залогу). Время делится на <b>слоты</b>, слоты — на <b>эпохи</b>. Для каждого слота случайность (RANDAO в упрощении — хэш от seed и номера слота) выбирает предлагающего; он рассылает блок, а остальные валидаторы по разу за эпоху голосуют за <b>контрольную точку</b> (checkpoint) эпохи.</p><p>Если за точку проголосовали ≥ 2/3 стейка — она <b>обоснована (justified)</b>; когда следующая эпоха тоже обоснована и ссылается на неё, предыдущая становится <b>финализированной</b>: откатить её можно только ценой потери ≥ 1/3 стейка (<b>accountable safety</b>). Голос за две разные точки одной эпохи доказуем и карается <b>slashing</b>. Если офлайн более 1/3 стейка, финальность останавливается, а <b>утечка неактивности</b> постепенно сжигает стейк отсутствующих, пока онлайн не наберёт 2/3.</p><p>Попробуйте: <code>crash n4 n5</code> → <code>run 150</code>; <code>do equivocate node=n3</code>.</p>',
    legend: [{ c: 'c-gold', t: 'предлагает блок в этом слоте' }, { c: 'c-green', t: 'валидатор, финальность идёт' }, { c: 'c-orange', t: 'финальность отстаёт' }, { c: 'c-red', t: 'срезан (slashed)' }, { c: 'c-gray', t: 'офлайн' }],
    params: [
      { id: 'slotMs', label: 'Слот, мс', type: 'number', def: 2000, min: 200, max: 60000, hint: 'длительность слота: раз в слот один валидатор может предложить блок' },
      { id: 'epochSlots', label: 'Слотов в эпохе', type: 'number', def: 6, min: 2, max: 32, hint: 'в Ethereum — 32; здесь меньше, чтобы эпохи были быстрыми' },
      { id: 'slashPercent', label: 'Штраф slashing, %', type: 'number', def: 50, min: 1, max: 100, hint: 'доля стейка, сжигаемая за доказанное двойное голосование' },
      { id: 'leakAfter', label: 'Утечка после отставания, эпох', type: 'number', def: 3, min: 1, max: 20, hint: 'через сколько эпох без финальности начинается утечка неактивности' },
      { id: 'leakPct', label: 'Утечка за эпоху, %', type: 'number', def: 10, min: 1, max: 50, hint: 'сколько стейка теряет невзошедший (не голосовавший) валидатор за каждую эпоху утечки' },
    ],
    nodeCfg: [{ id: 'stake', label: 'Стейк', type: 'number', def: 32, min: 1, max: 100000, hint: 'залог валидатора; определяет шанс предложить блок и вес голоса' }],
    actions: [
      { id: 'equivocate', label: 'Двойное голосование (атака)', args: [{ id: 'node', label: 'Валидатор', type: 'node' }], run(sim, a) { const n = sim.byId[a.node || sim.nodes[0].id]; if (!n || !n.up) return { text: 'узел недоступен' }; const ctx = sim.ctx(n), st = n.st; if (ctx.params.epochSlots && epochOf(ctx, st.slot) < 1) return { text: 'подождите первую эпоху: голосование начинается с эпохи 1' }; const r = castVote(ctx, true) || {}; if (!r.ep) return { text: 'узел уже срезан' }; const evil = ND.sha256('evil' + r.ep + n.id).slice(0, 10); ctx.mark('ДВОЙНОЕ ГОЛОСОВАНИЕ: второй голос за эпоху ' + r.ep + ' за другую точку (' + evil.slice(0, 5) + ')', 'c-red'); if (handleVote(ctx, n.id, r.ep, evil, r.sep, r.sid)) ctx.sendNeighbors('att', { v: n.id, ep: r.ep, tid: evil, sep: r.sep, sid: r.sid }); return { text: n.name + ' отправил два конфликтующих голоса за эпоху ' + r.ep }; } },
    ],
    init(node, sim) { gl(sim); const stakes = {}; for (const n of sim.nodes) stakes[n.id] = n.cfg.stake == null ? 32 : Math.max(1, +n.cfg.stake || 32); const snap = Object.assign({}, stakes); return { blocks: { genesis: GEN }, head: 'genesis', orphans: {}, stakes, snap, slashed: {}, votes: {}, seen: {}, just: { 0: 'genesis' }, fin: { 0: 'genesis' }, maxJust: 0, finEp: 0, slot: 0, curProp: null, lastVote: 0, syncing: false }; },
    onStart(ctx) { ctx.timer('slot', ctx.params.slotMs); },
    onRecover(ctx) { const st = ctx.st; st.syncing = true; const sm = ctx.params.slotMs; ctx.timer('slot', (Math.floor(ctx.now / sm) + 1) * sm - ctx.now); ctx.timer('syncoff', 4000); ctx.sendNeighbors('sync', {}); ctx.mark('вернулся в сеть: синхронизируется', 'c-blue'); },
    onCfg(ctx, key) { if (key === 'stake') for (const n of ctx.sim.nodes) { n.st.stakes[ctx.id] = Math.max(1, +ctx.cfg.stake || 1); if (n.st.snap) n.st.snap[ctx.id] = n.st.stakes[ctx.id]; } },
    onTimer(ctx, name) {
      const st = ctx.st, p = ctx.params, g = gl(ctx.sim);
      if (name === 'syncoff') { st.syncing = false; return; }
      if (name === 'slot') {
        const slot = Math.round(ctx.now / p.slotMs); st.slot = slot; g.maxSlot = Math.max(g.maxSlot, slot);
        if (slot % p.epochSlots === 0) epochStart(ctx, slot / p.epochSlots);
        const prop = proposerOf(ctx, slot); st.curProp = prop; if (prop === ctx.id && !st.slashed[ctx.id]) produce(ctx, slot);
        ctx.timer('att', p.slotMs / 3); ctx.timer('slot', (slot + 1) * p.slotMs - ctx.now);
      } else if (name === 'att') {
        const E = p.epochSlots, i = idxOf(ctx.sim, ctx.id); if (st.slot % E === i % E) castVote(ctx, false);
        else if (epochOf(ctx, st.slot) > st.lastVote && st.slot % E === E - 1) castVote(ctx, false); // догоняющий голос в конце эпохи
      }
    },
    onMessage(ctx, m) {
      const st = ctx.st, b = m.body;
      if (m.type === 'blk') { if (addBlock(ctx, b.b, m.from)) ctx.sendNeighbors('blk', { b: b.b }, m.from); }
      else if (m.type === 'att') { if (handleVote(ctx, b.v, b.ep, b.tid, b.sep, b.sid)) ctx.sendNeighbors('att', b, m.from); }
      else if (m.type === 'slash') { if (!st.slashed[b.v]) { slashOn(ctx, b.v, b.ep, b.a, b.b, true); ctx.sendNeighbors('slash', b, m.from); } }
      else if (m.type === 'sync') {
        const chain = []; let x = blk(st, st.head); while (x && x.id !== 'genesis') { chain.push(x); x = par(st, x); } chain.reverse();
        ctx.send(m.from, 'chain', { blocks: chain, just: st.just, fin: st.fin, finEp: st.finEp, maxJust: st.maxJust, stakes: st.stakes, slashed: st.slashed });
      } else if (m.type === 'chain') {
        let n = 0; for (const x of b.blocks) if (addBlock(ctx, x, null)) n++;
        for (const e in b.just) if (st.just[e] === undefined) st.just[e] = b.just[e]; for (const e in b.fin) if (st.fin[e] === undefined) st.fin[e] = b.fin[e];
        if (b.finEp > st.finEp) st.finEp = b.finEp; if (b.maxJust > st.maxJust) st.maxJust = b.maxJust;
        if (st.syncing) { st.stakes = ND.clone(b.stakes); st.slashed = ND.clone(b.slashed); st.snap = {}; for (const id in st.stakes) if (!st.slashed[id]) st.snap[id] = st.stakes[id]; }
        recomputeHead(st); if (n) ctx.log('синхронизация с ' + m.from + ': получено блоков ' + n);
      }
    },
    describe(m) {
      const b = m.body;
      switch (m.type) {
        case 'blk': return m.from + ' → ' + m.to + ': блок слота ' + b.b.slot + ' ' + b.b.id.slice(0, 5) + ' (предложил ' + b.b.proposer + ')';
        case 'att': return m.from + ' → ' + m.to + ': голос валидатора ' + b.v + ' за контрольную точку эпохи ' + b.ep + ' (' + String(b.tid).slice(0, 5) + '), источник — эпоха ' + b.sep;
        case 'slash': return m.from + ' → ' + m.to + ': доказательство двойного голосования ' + b.v + ' (эпоха ' + b.ep + ')';
        case 'sync': return m.from + ' → ' + m.to + ': запрос цепи (синхронизация)';
        case 'chain': return m.from + ' → ' + m.to + ': ответ — ' + b.blocks.length + ' блоков, финальная эпоха ' + b.finEp;
      } return m.type;
    },
    label(m) { return { blk: m.body.b ? '▣ s' + m.body.b.slot : 'блок', att: 'голос', slash: 'slash!', sync: 'sync?', chain: 'цепь' }[m.type] || m.type; },
    badge(n) { const s = n.st; return 'ст.' + Math.round(s.stakes[n.id]) + ' · F' + s.finEp; },
    nodeClass(n, sim) { const s = n.st; if (!n.up) return 'c-gray'; if (s.slashed[n.id]) return 'c-red'; const cur = s.curProp; if (cur === n.id && s.slot > 0 && sim.now - s.slot * sim.params.slotMs < sim.params.slotMs * 0.9) return 'c-gold'; return s.finEp >= Math.floor(s.slot / sim.params.epochSlots) - 2 ? 'c-green' : 'c-orange'; },
    ring(n, sim) { if (!n.up) return null; const sm = sim.params.slotMs; return { frac: Math.max(0, Math.min(1, ((Math.floor(sim.now / sm) + 1) * sm - sim.now) / sm)), label: 'до слота' }; },
    inspector(n, sim) {
      const s = n.st, chain = []; let x = blk(s, s.head); while (x && chain.length < 10) { chain.push(x); x = par(s, x); }
      const tot = total(s), ep = Math.floor(s.slot / sim.params.epochSlots);
      let h = '<dl class="kv"><dt>слот / эпоха</dt><dd>' + s.slot + ' / ' + ep + '</dd><dt>вершина</dt><dd class="mono">' + s.head.slice(0, 8) + ' (слот ' + blk(s, s.head).slot + ')</dd><dt>обоснована</dt><dd>эпоха ' + s.maxJust + '</dd><dt>финализирована</dt><dd><b>эпоха ' + s.finEp + '</b></dd><dt>мой стейк</dt><dd>' + (Math.round(s.stakes[n.id] * 10) / 10) + (s.slashed[n.id] ? ' <span class="bad">срезан</span>' : '') + '</dd></dl>';
      h += '<h4>Последние блоки</h4><div class="logrow">' + chain.map(b => '<span class="le cm" title="' + b.id + '"><i>s' + b.slot + '</i><b>' + b.id.slice(0, 4) + '</b><u>' + b.proposer + '</u></span>').join('') + '</div>';
      h += '<h4>Стейк валидаторов (' + Math.round(tot) + ')</h4><table class="tbl"><tr><th>валидатор</th><th>стейк</th><th>доля</th><th>статус</th></tr>' + sim.nodes.map(v => '<tr><td>' + ND.esc(v.name) + '</td><td>' + (Math.round(s.stakes[v.id] * 10) / 10) + '</td><td>' + (s.slashed[v.id] ? '—' : Math.round(100 * s.stakes[v.id] / (tot || 1)) + '%') + '</td><td>' + (s.slashed[v.id] ? '<span class="bad">срезан</span>' : v.up ? 'онлайн' : '<span class="warn">офлайн</span>') + '</td></tr>').join('') + '</table>';
      const vs = s.votes[ep] || {}; h += '<p class="mt sm">голосов за эпоху ' + ep + ' получено: ' + Object.keys(vs).length + ' из ' + sim.nodes.length + '</p>';
      return h;
    },
    metrics(sim) {
      const g = gl(sim), up = sim.nodes.filter(n => n.up); if (!up.length) return [];
      const st0 = up[0].st, tot = Object.values(st0.stakes).reduce((a, b) => a + b, 0), on = up.reduce((a, n) => a + (n.st.slashed[n.id] ? 0 : st0.stakes[n.id]), 0);
      const fin = Math.max(...up.map(n => n.st.finEp)), just = Math.max(...up.map(n => n.st.maxJust)), ep = Math.floor(g.maxSlot / sim.params.epochSlots);
      return [{ label: 'слот / эпоха', value: g.maxSlot + ' / ' + ep }, { label: 'обоснована / финализирована', value: just + ' / ' + fin }, { label: 'отставание финальности', value: Math.max(0, ep - fin) + ' эп.' }, { label: 'стейка онлайн', value: Math.round(100 * on / (tot || 1)) + '% (нужно ≥ 67% для финальности)' }, { label: 'блоков / пропущено слотов', value: g.produced + ' / ' + Math.max(0, g.maxSlot - g.produced) }, { label: 'срезано валидаторов', value: g.slashEvents }, { label: 'эпох утечки неактивности', value: g.leaked }];
    },
    invariants(sim) {
      let conflict = false, off = false; const ref = {};
      for (const n of sim.nodes) { for (const e in n.st.fin) { if (ref[e] !== undefined && ref[e] !== n.st.fin[e]) conflict = true; ref[e] = n.st.fin[e]; }
        const f = n.st.blocks[n.st.fin[n.st.finEp]]; if (f) { let x = n.st.blocks[n.st.head], ok = false; while (x) { if (x.id === f.id) { ok = true; break; } x = par(n.st, x); } if (!ok) off = true; } }
      return [
        { id: 'safety', ok: !conflict, text: 'Accountable safety: нет двух конфликтующих финализированных контрольных точек (иначе ≥ 1/3 стейка доказуемо виновны)' },
        { id: 'headfin', ok: !off, text: 'Вершина цепи каждого узла содержит его последнюю финализированную точку (финализированное не откатывается)' },
      ];
    },
    defaultScheme() { return mk({}); },
  });

  function mk(o) {
    const st = o.stakes || [32, 32, 32, 32, 32, 32, 32];
    return ND.makeScheme({ proto: 'pos', n: st.length, topo: 'mesh', lat: o.lat || 200, jit: 60, seed: o.seed || 11, title: o.title || 'PoS: 7 валидаторов', notes: o.notes || '', params: o.params, cfgs: st.map(s => ({ stake: s })) });
  }
  const T = (id, title, desc, build) => ND.reg.templates.push({ id, proto: 'pos', title, desc, build });
  T('pos-normal', 'Нормальная работа', '7 равных валидаторов. Запустите ▶: блоки в каждом слоте, эпохи обосновываются и финализируются с отставанием в одну эпоху.', () => mk({}));
  T('pos-weighted', 'Неравные стейки', 'Предлагающие выбираются пропорционально стейку: у n1 ровно половина. Выполните run 120 и сравните число блоков (журнал, метрики).', () => mk({ stakes: [96, 24, 24, 16, 16, 8, 8], title: 'PoS: неравные стейки' }));
  T('pos-offline40', 'Отказ 40% стейка: финальность стоит', '5 равных валидаторов. Команда: crash n4 n5 (остаётся 60% < 2/3). Затем run 150: финальность встанет, потом утечка неактивности вернёт её.', () => mk({ stakes: [32, 32, 32, 32, 32], title: 'PoS: 5 валидаторов (отказ 40%)' }));
  T('pos-offline20', 'Отказ 20% стейка: финальность идёт', '5 валидаторов; crash n5 — остаётся 80% ≥ 2/3, финализация продолжается, пропущены только слоты n5.', () => mk({ stakes: [32, 32, 32, 32, 32], title: 'PoS: 5 валидаторов (отказ 20%)' }));
  T('pos-slash', 'Двойное голосование и slashing', 'Дождитесь эпохи 2 (run 40), затем do equivocate node=n3. Конфликтующие голоса встретятся в сети, n3 будет срезан.', () => mk({ title: 'PoS: slashing' }));
  ND.posMk = mk;
})(typeof window !== 'undefined' ? window : globalThis);
