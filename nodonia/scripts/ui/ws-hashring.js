/* Нодония — «Хэш-кольцо и DHT»: консистентное хэширование, Chord, Kademlia.
   Логика (ND.dht.*) не зависит от DOM и тестируется в Node; интерфейс — ниже, в mount(). */
(function (G) {
  'use strict';
  const ND = G.ND, dht = ND.dht = ND.dht || {};
  const M32 = 4294967296;

  /* ================= консистентное хэширование ================= */
  dht.ring = function (vnodes) {
    const r = { vn: vnodes || 16, nodes: {}, pts: [] };
    r.rebuild = () => { r.pts = []; for (const n in r.nodes) for (let i = 0; i < r.nodes[n]; i++) r.pts.push({ pos: ND.hash32(n + '#' + i), node: n, v: i }); r.pts.sort((a, b) => a.pos - b.pos || (a.node < b.node ? -1 : 1)); };
    r.add = (n, vn) => { r.nodes[n] = vn || r.vn; r.rebuild(); };
    r.remove = n => { delete r.nodes[n]; r.rebuild(); };
    r.names = () => Object.keys(r.nodes);
    r.idx = pos => { let lo = 0, hi = r.pts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (r.pts[m].pos < pos) lo = m + 1; else hi = m; } return lo % r.pts.length; };
    r.owner = key => r.pts.length ? r.pts[r.idx(ND.hash32(key))].node : null;
    r.replicas = (key, N) => { const out = []; if (!r.pts.length) return out; let i = r.idx(ND.hash32(key)); for (let c = 0; c < r.pts.length && out.length < Math.min(N, r.names().length); c++, i = (i + 1) % r.pts.length) if (!out.includes(r.pts[i].node)) out.push(r.pts[i].node); return out; };
    r.clone = () => { const c = dht.ring(r.vn); c.nodes = Object.assign({}, r.nodes); c.rebuild(); return c; };
    return r;
  };
  dht.modOwner = (names, key) => { const s = names.slice().sort(); return s.length ? s[ND.hash32(key) % s.length] : null; };
  dht.keysList = n => Array.from({ length: n }, (_, i) => 'key-' + i);
  /** сколько ключей сменили владельца */
  dht.moved = (keys, ownerA, ownerB) => keys.reduce((a, k) => a + (ownerA(k) !== ownerB(k) ? 1 : 0), 0);
  dht.load = (ring, keys) => { const c = {}; ring.names().forEach(n => c[n] = 0); keys.forEach(k => { c[ring.owner(k)]++; }); return c; };
  dht.cv = c => { const v = Object.values(c), m = v.reduce((a, b) => a + b, 0) / (v.length || 1); if (!m) return 0; return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length) / m; };

  /* ================= Chord ================= */
  const inOC = (x, a, b, S) => a === b ? true : (a < b ? x > a && x <= b : x > a || x <= b);       // (a, b]
  const inOO = (x, a, b) => a === b ? true : (a < b ? x > a && x < b : x > a || x < b);              // (a, b)
  dht.chord = function (m) {
    const c = { m, S: Math.pow(2, m), n: {} };
    c.ids = () => Object.keys(c.n).map(Number).sort((a, b) => a - b);
    c.trueSucc = k => { const ids = c.ids(); k = ((k % c.S) + c.S) % c.S; return ids.find(i => i >= k) !== undefined ? ids.find(i => i >= k) : ids[0]; };
    c.rawLookup = (from, key, cap) => {   // итеративный find_successor по указателям (могут быть устаревшими)
      key = ((key % c.S) + c.S) % c.S; let cur = from; const path = [cur]; cap = cap || 8 * c.m + 40;
      for (let guard = 0; guard < cap; guard++) {
        const nd = c.n[cur]; if (!nd) break;
        if (inOC(key, cur, nd.succ, c.S)) { if (nd.succ !== cur || path[path.length - 1] !== cur) path.push(nd.succ); return { owner: nd.succ, path, hops: path.length - 1, key, ok: true }; }
        let next = nd.succ;
        for (let i = c.m - 1; i >= 0; i--) { const f = nd.fingers[i]; if (f != null && c.n[f] && f !== cur && inOO(f, cur, key)) { next = f; break; } }
        if (next === cur) break; cur = next; path.push(cur);
      }
      return { owner: null, path, hops: path.length - 1, key, ok: false };
    };
    c.fix = id => { const nd = c.n[id]; for (let i = 0; i < c.m; i++) { const r = c.rawLookup(id, (id + Math.pow(2, i)) % c.S); nd.fingers[i] = r.ok ? r.owner : nd.succ; } };
    /** идеальное состояние: все указатели корректны */
    c.rebuildAll = () => { const ids = c.ids(); ids.forEach((id, i) => { c.n[id].succ = ids[(i + 1) % ids.length]; c.n[id].pred = ids[(i - 1 + ids.length) % ids.length]; for (let k = 0; k < c.m; k++) c.n[id].fingers[k] = c.trueSucc(id + Math.pow(2, k)); }); };
    c.addInitial = ids => { ids.forEach(id => c.n[id] = { id, succ: id, pred: id, fingers: Array(c.m).fill(id) }); c.rebuildAll(); };
    /** вход узла: находит преемника поиском через известный узел; пальцы строит себе, чужие устаревают до stabilize */
    c.join = (id, via) => {
      if (c.n[id] !== undefined || id < 0 || id >= c.S) return false;
      const ids = c.ids(); if (!ids.length) { c.n[id] = { id, succ: id, pred: id, fingers: Array(c.m).fill(id) }; return true; }
      via = via != null && c.n[via] ? via : ids[0]; const r = c.rawLookup(via, id);
      c.n[id] = { id, succ: r.owner, pred: null, fingers: Array(c.m).fill(r.owner) }; return true;
    };
    c.leave = id => { const nd = c.n[id]; if (!nd) return false; delete c.n[id]; return true; };          // «тихий» отказ: другие узнают при stabilize
    /** один раунд stabilize+notify (+ ремонт неживых указателей) */
    c.stabilize = () => {
      for (const id of c.ids()) {
        const nd = c.n[id]; if (!c.n[nd.succ]) { const alive = c.ids(); nd.succ = alive.find(i => i > id) !== undefined ? alive.find(i => i > id) : alive[0]; }
        const x = c.n[nd.succ].pred; if (x != null && c.n[x] && x !== id && inOO(x, id, nd.succ)) nd.succ = x;
        const s = c.n[nd.succ]; if (s.pred == null || !c.n[s.pred] || inOO(id, s.pred, nd.succ) || s.pred === nd.succ) s.pred = id;
      }
    };
    c.fixAll = () => c.ids().forEach(id => c.fix(id));
    c.consistent = () => { const ids = c.ids(); return ids.every((id, i) => c.n[id].succ === ids[(i + 1) % ids.length]); };
    c.fingerOk = () => { let ok = 0, all = 0; c.ids().forEach(id => { for (let k = 0; k < c.m; k++) { all++; if (c.n[id].fingers[k] === c.trueSucc(id + Math.pow(2, k))) ok++; } }); return all ? ok / all : 1; };
    return c;
  };
  dht.chordMake = (m, ids) => { const c = dht.chord(m); c.addInitial(ids); return c; };

  /* ================= Kademlia ================= */
  const bitlen = x => x === 0 ? 0 : 32 - Math.clz32(x);
  dht.kademlia = function (bits, k, alpha) {
    const K = { bits, k: k || 3, alpha: alpha || 3, n: {} };
    K.ids = () => Object.keys(K.n).map(Number).sort((a, b) => a - b);
    K.bucketOf = (me, other) => bitlen(me ^ other) - 1;
    K.learn = (me, other) => {                                    // обновление корзины: свежий — в хвост; полная корзина — старый остаётся
      if (me === other || !K.n[me]) return; const b = K.bucketOf(me, other), bk = K.n[me].b[b] = K.n[me].b[b] || [];
      const i = bk.indexOf(other); if (i >= 0) { bk.splice(i, 1); bk.push(other); return; } if (bk.length < K.k) bk.push(other);
    };
    K.closestKnown = (id, target, cnt) => { const all = []; for (const b in K.n[id].b) all.push(...K.n[id].b[b]); all.push(id); return all.sort((a, b) => (a ^ target) - (b ^ target)).slice(0, cnt); };
    K.trueClosest = (target, cnt) => K.ids().sort((a, b) => (a ^ target) - (b ^ target)).slice(0, cnt || K.k);
    K.lookup = (from, target, learn) => {
      let short = K.closestKnown(from, target, K.k); const queried = new Set([from]), rounds = []; let guard = 0;
      for (; guard < 20; guard++) {
        const cand = short.filter(x => !queried.has(x)).slice(0, K.alpha); if (!cand.length) break;
        const got = [];
        for (const q of cand) { queried.add(q); if (!K.n[q]) continue; const resp = K.closestKnown(q, target, K.k); got.push({ q, resp }); if (learn !== false) { K.learn(q, from); K.learn(from, q); resp.forEach(x => K.learn(from, x)); } }
        const set = new Set(short); got.forEach(g => g.resp.forEach(x => { if (K.n[x]) set.add(x); }));
        short = [...set].sort((a, b) => (a ^ target) - (b ^ target)).slice(0, K.k);
        rounds.push({ asked: cand, short: short.slice() });
      }
      return { closest: short, rounds, nRounds: rounds.length, queried: queried.size - 1, target };
    };
    K.join = (id, boot) => { if (K.n[id]) return false; K.n[id] = { id, b: {} }; if (boot != null && K.n[boot]) { K.learn(id, boot); K.learn(boot, id); K.lookup(id, id); } return true; };
    K.refresh = rnd => { for (const id of K.ids()) for (let b = 0; b < K.bits; b++) { const t = (id ^ (1 << b)) ^ (rnd ? Math.floor(rnd() * (1 << b)) : 0); K.lookup(id, t); } };
    K.leave = id => { delete K.n[id]; for (const o in K.n) for (const b in K.n[o].b) K.n[o].b[b] = K.n[o].b[b].filter(x => x !== id); };
    return K;
  };
  dht.kadMake = (bits, ids, k, alpha, rnd) => { const K = dht.kademlia(bits, k, alpha); ids.forEach((id, i) => K.join(id, i ? ids[0] : null)); K.refresh(rnd); K.refresh(rnd); return K; };

  /* ================= интерфейс ================= */
  if (!ND.ui || !ND.ui.registerWorkspace) return;
  const ui = ND.ui, h = ui.h, esc = ND.esc, NS = 'http://www.w3.org/2000/svg';
  const COLORS = ['#6366f1', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#ec4899', '#22c55e', '#f97316', '#64748b', '#a3e635', '#e879f9'];
  const CSS = '.wsd-tabs{display:flex;gap:6px;margin:0 0 12px}.wsd-svg{width:100%;max-width:520px;height:auto;background:var(--cv);border:1px solid var(--bd);border-radius:12px}.wsd-lg{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.wsd-lg span{display:inline-flex;gap:5px;align-items:center;font-size:12px;border:1px solid var(--bd);border-radius:99px;padding:1px 8px;cursor:pointer}.wsd-lg i{width:10px;height:10px;border-radius:50%;display:inline-block}.wsd-lg b.x{color:var(--er);margin-left:3px}.wsd-pt{cursor:pointer}';
  const svgEl = (t, a, p) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (p) p.append(e); return e; };
  const col = i => COLORS[i % COLORS.length];

  function mountRing(box, S) {
    const st = S.ring = S.ring || { ring: null, names: ['A', 'B', 'C', 'D'], vn: 8, N: 3, keys: 2000, sample: 60, hist: [], q: 'user:42', next: 5 };
    if (!st.ring) { st.ring = dht.ring(); st.names.forEach(n => st.ring.add(n, st.vn)); }
    const out = h('div');
    box.append(out);
    function colOf(n) { return col(st.names.indexOf(n)); }
    function draw() {
      out.innerHTML = ''; const ring = st.ring, keys = dht.keysList(st.keys);
      const left = h('div'), right = h('div');
      // SVG кольцо
      const svg = svgEl('svg', { viewBox: '0 0 400 400', class: 'wsd-svg' }); svgEl('circle', { cx: 200, cy: 200, r: 150, fill: 'none', stroke: 'var(--bd)', 'stroke-width': 2 }, svg);
      const P = pos => { const a = pos / M32 * 2 * Math.PI - Math.PI / 2; return [200 + 150 * Math.cos(a), 200 + 150 * Math.sin(a)]; };
      const q = st.q, qPos = ND.hash32(q), qOwner = ring.owner(q), reps = ring.replicas(q, st.N);
      for (let i = 0; i < Math.min(st.sample, keys.length); i++) { const p = P(ND.hash32(keys[i])), o = ring.owner(keys[i]); svgEl('circle', { cx: p[0] * 1 + (p[0] - 200) * 0.09, cy: p[1] + (p[1] - 200) * 0.09, r: 2.2, fill: colOf(o), opacity: .55 }, svg); }
      ring.pts.forEach(pt => { const p = P(pt.pos), c = svgEl('circle', { cx: p[0], cy: p[1], r: ring.pts.length > 120 ? 3 : 5, fill: colOf(pt.node), stroke: 'var(--pn)', 'stroke-width': 1.5, class: 'wsd-pt' }, svg); svgEl('title', {}, c).textContent = pt.node + ' (vnode ' + pt.v + '), позиция ' + pt.pos; });
      const kp = P(qPos); svgEl('path', { d: 'M' + kp[0] + ' ' + (kp[1] - 9) + 'l7 9-7 9-7-9z', fill: 'var(--tx)' }, svg); const kt = svgEl('text', { x: 200, y: 196, 'text-anchor': 'middle', 'font-size': 13, fill: 'var(--tx)', 'font-weight': 700 }, svg); kt.textContent = 'ключ «' + q + '»'; const k2 = svgEl('text', { x: 200, y: 214, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--mt)' }, svg); k2.textContent = 'владелец: ' + qOwner + ' · реплики: ' + reps.join(', ');
      // стрелка к владельцу: ближайшая по часовой точка
      const idx = ring.idx(qPos), op = P(ring.pts[idx].pos); svgEl('line', { x1: kp[0], y1: kp[1], x2: op[0], y2: op[1], stroke: 'var(--tx)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, svg);
      left.append(svg, h('div', { class: 'mt sm', html: 'Ключ идёт <b>по часовой стрелке</b> до первой точки узла (vnode). Мелкие точки внутри кольца — ключи, цвет = владелец. Всего ключей в эксперименте: ' + st.keys + '.' }));
      // легенда + управление
      const lg = h('div', { class: 'wsd-lg' }); st.names.forEach(n => lg.append(h('span', { title: 'Удалить узел ' + n }, h('i', { style: 'background:' + colOf(n) }), n, h('b', { class: 'x', text: '×', onclick: () => removeNode(n) }))));
      const load = dht.load(ring, keys), cvv = dht.cv(load), mx = Math.max(...Object.values(load), 1);
      const hist = h('div'); st.names.forEach(n => hist.append(h('div', { class: 'row', style: 'gap:6px;margin:2px 0;flex-wrap:nowrap' }, h('span', { style: 'width:30px', text: n }), h('div', { class: 'prog', style: 'flex:1' }, h('i', { style: 'width:' + (100 * load[n] / mx) + '%;background:' + colOf(n) })), h('span', { class: 'mono sm', style: 'width:90px', text: load[n] + ' (' + Math.round(100 * load[n] / st.keys * 10) / 10 + '%)' }))));
      const ctl = h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: 'Кольцо' }), lg,
        h('div', { class: 'row' }, h('button', { class: 'btn pri', text: '+ Добавить узел', onclick: addNode }), h('button', { class: 'btn', text: 'Сбросить', onclick: () => { st.ring = null; st.names = ['A', 'B', 'C', 'D']; st.hist = []; st.next = 5; mountRing.redo(); } })),
        ui.field({ id: 'vn', label: 'Виртуальных узлов на сервер (vnodes)', type: 'number', def: 8, min: 1, max: 256, step: 1, hint: 'чем больше точек у сервера, тем равномернее нагрузка, но тем больше таблица маршрутизации' }, st.vn, v => { st.vn = Math.round(v); st.ring = dht.ring(); st.names.forEach(n => st.ring.add(n, st.vn)); st.hist = []; draw(); }),
        ui.field({ id: 'N', label: 'Фактор репликации N (копий ключа)', type: 'number', def: 3, min: 1, max: 8, step: 1, hint: 'реплики — следующие N различных серверов по кольцу' }, st.N, v => { st.N = Math.round(v); draw(); }),
        ui.field({ id: 'keys', label: 'Ключей в эксперименте', type: 'number', def: 2000, min: 100, max: 20000, step: 100 }, st.keys, v => { st.keys = Math.round(v); st.hist = []; draw(); }),
        ui.field({ id: 'q', label: 'Найти владельца ключа', type: 'text', def: 'user:42' }, st.q, v => { st.q = v || 'user:42'; draw(); }));
      const tbl = '<table class="tbl"><tr><th>операция</th><th>переехало (кольцо)</th><th>переехало (hash mod N)</th></tr>' + (st.hist.length ? st.hist.map(r => '<tr><td>' + esc(r.op) + '</td><td><b>' + r.ring + '</b> (' + ui.pct(r.ring / st.keys) + ')</td><td>' + r.mod + ' (' + ui.pct(r.mod / st.keys) + ')</td></tr>').join('') : '<tr><td colspan="3" class="mt">Добавьте или удалите узел — увидите, сколько ключей придётся переносить.</td></tr>') + '</table>';
      const cvbox = h('div', { class: 'chartbox' }); right.append(ctl, h('div', { class: 'card', style: 'margin-top:12px' }, h('h3', { style: 'margin-top:0', text: 'Нагрузка по узлам' }), hist, h('p', { class: 'sm', html: 'Коэффициент вариации (разброс нагрузки): <b>' + (Math.round(cvv * 1000) / 10) + '%</b>. Идеал — 0%.' })), h('div', { class: 'card', style: 'margin-top:12px' }, h('h3', { style: 'margin-top:0', text: 'Сколько ключей переезжает' }), h('div', { html: tbl })), h('div', { class: 'card', style: 'margin-top:12px' }, h('h3', { style: 'margin-top:0', text: 'Разброс нагрузки и число vnodes' }), cvbox, h('p', { class: 'mt sm', text: 'Для текущего числа серверов: чем больше виртуальных узлов, тем меньше коэффициент вариации (≈ 1/√vnodes).' })));
      out.append(h('div', { class: 'cols', style: 'grid-template-columns:minmax(300px,520px) minmax(320px,1fr);align-items:start' }, left, right));
      const pts = [1, 2, 4, 8, 16, 32, 64, 128, 256].map(v => { const r = dht.ring(v); st.names.forEach(n => r.add(n, v)); return [Math.log2(v), Math.round(dht.cv(dht.load(r, dht.keysList(5000))) * 1000) / 10]; });
      ui.chart({ el: cvbox, series: [{ name: 'разброс, %', pts, dots: true }], w: 500, h: 220, xl: 'log₂(vnodes)', yl: 'CV, %', ymin: 0 });
    }
    function addNode() { const before = st.ring.clone(), names = st.names.slice(); const n = String.fromCharCode(65 + (st.next - 1) % 26) + (st.next > 26 ? Math.floor((st.next - 1) / 26) : ''); st.next++; st.names.push(n); st.ring.add(n, st.vn); record('+ узел ' + n, before, names); draw(); }
    function removeNode(n) { if (st.names.length <= 2) return ui.toast('Нужно хотя бы два узла', 'bad'); const before = st.ring.clone(), names = st.names.slice(); st.names = st.names.filter(x => x !== n); st.ring.remove(n); record('− узел ' + n, before, names); draw(); }
    function record(op, before, names) { const keys = dht.keysList(st.keys), after = st.ring, nn = st.names; st.hist.unshift({ op, ring: dht.moved(keys, k => before.owner(k), k => after.owner(k)), mod: dht.moved(keys, k => dht.modOwner(names, k), k => dht.modOwner(nn, k)) }); st.hist = st.hist.slice(0, 8); }
    mountRing.redo = draw; draw();
  }

  /* ---------- Chord ---------- */
  function mountChord(box, S) {
    const st = S.chord = S.chord || { m: 6, c: null, sel: null, from: null, key: 37, trace: null, step: 0 };
    if (!st.c) { st.c = dht.chordMake(st.m, [1, 8, 14, 21, 32, 38, 42, 48, 51, 56]); st.sel = 8; st.from = 8; }
    const c = st.c, out = h('div'); box.append(out);
    function draw() {
      out.innerHTML = ''; const ids = c.ids(); if (!ids.includes(st.sel)) st.sel = ids[0]; if (!ids.includes(st.from)) st.from = ids[0];
      const svg = svgEl('svg', { viewBox: '0 0 400 400', class: 'wsd-svg' }); svgEl('circle', { cx: 200, cy: 200, r: 150, fill: 'none', stroke: 'var(--bd)', 'stroke-width': 2 }, svg);
      const P = (id, r) => { const a = id / c.S * 2 * Math.PI - Math.PI / 2; return [200 + (r || 150) * Math.cos(a), 200 + (r || 150) * Math.sin(a)]; };
      for (let i = 0; i < c.S; i++) { const a = P(i, 144), b = P(i, 156); svgEl('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: 'var(--bd)' }, svg); }
      const tr = st.trace; const vis = tr ? tr.path.slice(0, st.step + 1) : [];
      for (let i = 0; i + 1 < vis.length; i++) { const a = P(vis[i]), b = P(vis[i + 1]); svgEl('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: 'var(--ac)', 'stroke-width': 3 }, svg); }
      if (st.sel != null && c.n[st.sel]) c.n[st.sel].fingers.forEach((f, i) => { if (c.n[f]) { const a = P(st.sel), b = P(f); svgEl('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: 'var(--gold)', 'stroke-width': 1, 'stroke-dasharray': '3 3' }, svg); } });
      ids.forEach((id, i) => { const p = P(id), g = svgEl('g', { class: 'wsd-pt' }, svg); g.addEventListener('click', () => { st.sel = id; draw(); }); svgEl('circle', { cx: p[0], cy: p[1], r: 12, fill: vis.includes(id) ? 'var(--ac)' : (id === st.sel ? 'var(--gold)' : 'var(--teal)'), stroke: 'var(--pn)', 'stroke-width': 2 }, g); const t = svgEl('text', { x: p[0], y: p[1] + 4, 'text-anchor': 'middle', 'font-size': 11, fill: '#fff', 'font-weight': 700, 'pointer-events': 'none' }, g); t.textContent = id; });
      if (tr) { const kp = P(tr.key, 172); svgEl('path', { d: 'M' + kp[0] + ' ' + (kp[1] - 8) + 'l6 8-6 8-6-8z', fill: 'var(--red)' }, svg); const t = svgEl('text', { x: kp[0], y: kp[1] - 12, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--red)' }, svg); t.textContent = 'ключ ' + tr.key; }
      const nd = c.n[st.sel];
      const ftab = ui.table(['i', 'старт = n + 2^i', 'палец (преемник)', 'верно?'], nd.fingers.map((f, i) => { const s = (st.sel + Math.pow(2, i)) % c.S, ok = f === c.trueSucc(s); return [i, s, '<b>' + f + '</b>', ok ? '<span class="ok">✔</span>' : '<span class="bad">устарел (верно ' + c.trueSucc(s) + ')</span>']; }), '');
      const info = h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: 'Узел ' + st.sel + ': таблица пальцев' }), h('div', { class: 'sm mt', html: 'преемник: <b>' + nd.succ + '</b> · предшественник: <b>' + (nd.pred == null ? '?' : nd.pred) + '</b>' }), h('div', { html: ftab }));
      const fromSel = h('select', { class: 'inp', onchange: e => { st.from = +e.target.value; } }, ids.map(i => h('option', { value: i, text: 'с узла ' + i, selected: i === st.from })));
      const key = h('input', { class: 'inp', type: 'number', min: 0, max: c.S - 1, value: st.key, style: 'width:80px', onchange: e => { st.key = Math.max(0, Math.min(c.S - 1, +e.target.value | 0)); } });
      const run = () => { st.trace = c.rawLookup(st.from, st.key); st.step = 0; draw(); };
      const addId = h('input', { class: 'inp', type: 'number', min: 0, max: c.S - 1, placeholder: 'id', style: 'width:70px' });
      const ctl = h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: 'Поиск ключа' }), h('div', { class: 'row' }, fromSel, 'ключ:', key, h('button', { class: 'btn pri', text: 'Найти', onclick: run }), h('button', { class: 'btn', text: 'Шаг ▶', onclick: () => { if (!st.trace) run(); else { st.step = Math.min(st.trace.path.length - 1, st.step + 1); draw(); } } }), h('button', { class: 'btn', text: 'Показать всё', onclick: () => { if (!st.trace) run(); st.step = st.trace.path.length - 1; draw(); } })),
        tr ? h('p', { html: 'Путь: <b>' + tr.path.slice(0, st.step + 1).join(' → ') + '</b>' + (st.step >= tr.path.length - 1 ? (tr.ok ? ' · владелец ключа ' + tr.key + ' — узел <b>' + tr.owner + '</b>, хопов: <b>' + tr.hops + '</b>' + (tr.owner === c.trueSucc(tr.key) ? '' : ' <span class="bad">(но истинный владелец ' + c.trueSucc(tr.key) + ' — указатели устарели!)</span>') : ' <span class="bad">поиск не завершился (кольцо повреждено)</span>') : '') }) : h('p', { class: 'mt sm', text: 'Каждый шаг — прыжок к ближайшему пальцу, который не «перепрыгивает» ключ: расстояние сокращается минимум вдвое.' }));
      const membership = h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: 'Вход, выход, stabilize' }), h('div', { class: 'row' }, addId, h('button', { class: 'btn', text: '+ Войти', onclick: () => { let v = addId.value === '' ? Math.floor(Math.random() * c.S) : +addId.value; if (!c.join(v)) return ui.toast('Идентификатор занят или вне диапазона', 'bad'); st.sel = v; st.trace = null; draw(); } }), h('button', { class: 'btn dng', text: '− Отказ выбранного', onclick: () => { if (ids.length <= 3) return ui.toast('Оставьте хотя бы 3 узла', 'bad'); c.leave(st.sel); st.trace = null; draw(); } })),
        h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', text: 'stabilize (1 раунд)', onclick: () => { c.stabilize(); draw(); } }), h('button', { class: 'btn', text: 'fix_fingers', onclick: () => { c.fixAll(); draw(); } }), h('button', { class: 'btn', text: 'Идеальное состояние', onclick: () => { c.rebuildAll(); draw(); } })),
        h('p', { class: 'sm', html: 'Кольцо согласовано: <b class="' + (c.consistent() ? 'ok' : 'bad') + '">' + (c.consistent() ? 'да' : 'нет') + '</b> · верных пальцев: <b>' + ui.pct(c.fingerOk()) + '</b>. После входа/отказа сначала запустите <code>stabilize</code> несколько раз (чинит преемников), затем <code>fix_fingers</code> (чинит пальцы).' }));
      const cbox = h('div', { class: 'chartbox' }), stat = h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: 'Хопы растут как O(log N)' }), cbox, h('div', { class: 'row' }, h('button', { class: 'btn', text: 'Измерить для текущей сети', onclick: () => { let tot = 0, n = 0, mx = 0; for (const f of ids) for (let k = 0; k < c.S; k += 3) { const r = c.rawLookup(f, k); if (r.ok) { tot += r.hops; n++; mx = Math.max(mx, r.hops); } } ui.toast('Среднее хопов: ' + (tot / n).toFixed(2) + ', максимум: ' + mx + ', log₂N = ' + Math.log2(ids.length).toFixed(2)); } })));
      const pts = [], ref = []; for (const N of [4, 8, 16, 32, 64, 128, 256]) { const mm = 10, cc = dht.chord(mm), s = new Set(); let x = 7; while (s.size < N) { x = (x * 73 + 41) % cc.S; s.add(x); } cc.addInitial([...s]); let tot = 0, n = 0; for (const f of cc.ids().slice(0, 40)) for (let k = 0; k < cc.S; k += 37) { tot += cc.rawLookup(f, k).hops; n++; } pts.push([Math.log2(N), Math.round(tot / n * 100) / 100]); ref.push([Math.log2(N), Math.round(Math.log2(N) / 2 * 100) / 100]); }
      ui.chart({ el: cbox, series: [{ name: 'среднее число хопов', pts, dots: true }, { name: '½·log₂N', pts: ref, dash: true }], w: 480, h: 210, xl: 'log₂N (число узлов)', yl: 'хопов', ymin: 0 });
      out.append(h('div', { class: 'cols', style: 'grid-template-columns:minmax(300px,520px) minmax(320px,1fr);align-items:start' }, h('div', null, svg, h('p', { class: 'mt sm', text: 'Круг из ' + c.S + ' идентификаторов (m = ' + c.m + ' бит). Кликните узел, чтобы увидеть его пальцы (жёлтые пунктиры). Красный ромб — искомый ключ.' })), h('div', null, ctl, h('div', { style: 'height:12px' }), info, h('div', { style: 'height:12px' }), membership, h('div', { style: 'height:12px' }), stat)));
    }
    draw();
  }

  /* ---------- Kademlia ---------- */
  function mountKad(box, S) {
    const st = S.kad = S.kad || { bits: 8, k: 3, alpha: 3, K: null, from: null, target: 200, res: null, step: 0, sel: null };
    const mk = () => { let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }; const ids = new Set(); while (ids.size < 24) ids.add(Math.floor(rnd() * (1 << st.bits))); st.K = dht.kadMake(st.bits, [...ids], st.k, st.alpha, rnd); st.from = st.K.ids()[0]; st.sel = st.from; st.res = null; };
    if (!st.K) mk();
    const out = h('div'); box.append(out);
    const bin = x => x.toString(2).padStart(st.bits, '0');
    function draw() {
      out.innerHTML = ''; const K = st.K, ids = K.ids(); if (!K.n[st.from]) st.from = ids[0]; if (!K.n[st.sel]) st.sel = ids[0];
      const fromSel = h('select', { class: 'inp', onchange: e => { st.from = +e.target.value; st.res = null; } }, ids.map(i => h('option', { value: i, text: i + ' (' + bin(i) + ')', selected: i === st.from })));
      const tgt = h('input', { class: 'inp', type: 'number', min: 0, max: (1 << st.bits) - 1, value: st.target, style: 'width:90px', onchange: e => { st.target = Math.max(0, Math.min((1 << st.bits) - 1, +e.target.value | 0)); st.res = null; draw(); } });
      const r = st.res, shown = r ? r.rounds.slice(0, st.step) : [];
      const run = () => { st.res = K.lookup(st.from, st.target, false); st.step = 0; draw(); };
      const real = K.trueClosest(st.target, K.k);
      const ctl = h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: 'Итеративный поиск ' + st.k + ' ближайших' }), h('div', { class: 'row' }, fromSel, 'цель (id):', tgt, h('button', { class: 'btn pri', text: 'Найти', onclick: () => { run(); st.step = st.res.rounds.length; draw(); } }), h('button', { class: 'btn', text: 'Раунд ▶', onclick: () => { if (!st.res) run(); st.step = Math.min(st.res.rounds.length, st.step + 1); draw(); } })),
        h('p', { class: 'sm mt', html: 'Цель в двоичном виде: <code>' + bin(st.target) + '</code>. «Расстояние» = XOR идентификаторов: чем длиннее общий префикс, тем ближе.' }),
        r ? h('div', { html: ui.table(['раунд', 'опрошены (α=' + st.alpha + ')', 'ближайшие k на данный момент (расстояние XOR)'], shown.map((x, i) => [i + 1, x.asked.join(', '), x.short.map(s => s + ' (' + (s ^ st.target) + ')').join(', ')])) + (st.step >= r.rounds.length ? '<p>Найдено: <b>' + r.closest.join(', ') + '</b> за <b>' + r.nRounds + '</b> раунд(ов), опрошено узлов: ' + r.queried + ' из ' + ids.length + '. Истинные ближайшие: ' + real.join(', ') + ' — ' + (JSON.stringify(real) === JSON.stringify(r.closest) ? '<span class="ok">совпало ✔</span>' : '<span class="bad">отличается (корзины неполны)</span>') + '</p>' : '') }) : h('p', { class: 'mt sm', text: 'Нажмите «Найти» или двигайтесь по раундам.' }));
      const selSel = h('select', { class: 'inp', onchange: e => { st.sel = +e.target.value; draw(); } }, ids.map(i => h('option', { value: i, text: 'узел ' + i + ' (' + bin(i) + ')', selected: i === st.sel })));
      const nd = K.n[st.sel]; const rows = []; for (let b = st.bits - 1; b >= 0; b--) { const bk = nd.b[b] || []; rows.push(['<code>' + b + '</code>', 'расстояние ∈ [' + (1 << b) + ', ' + ((1 << (b + 1)) - 1) + ']', bk.length ? bk.join(', ') : '<span class="mt">—</span>', bk.length + '/' + st.k]); }
      const kb = h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: 'k-корзины' }), selSel, h('div', { html: ui.table(['корзина', 'диапазон XOR', 'контакты', 'заполнено'], rows) }), h('p', { class: 'sm mt', text: 'Корзина i хранит до k контактов, чей XOR-расстояние с узлом лежит в [2^i, 2^(i+1)). Далёких узлов мало знаем, близких — много: поэтому поиск сходится за O(log N) раундов.' }));
      const par = h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: 'Параметры сети' }), ui.field({ id: 'k', label: 'k — размер корзины и число результатов', type: 'number', def: 3, min: 1, max: 8, step: 1 }, st.k, v => { st.k = Math.round(v); mk(); draw(); }), ui.field({ id: 'a', label: 'α — параллельных запросов за раунд', type: 'number', def: 3, min: 1, max: 6, step: 1, hint: 'больше α — меньше раундов, но больше сетевых запросов' }, st.alpha, v => { st.alpha = Math.round(v); mk(); draw(); }), h('div', { class: 'row' }, h('button', { class: 'btn', text: 'Пересоздать сеть', onclick: () => { mk(); draw(); } }), h('button', { class: 'btn dng', text: 'Отказ узла ' + st.sel, onclick: () => { if (ids.length <= 6) return; K.leave(st.sel); st.res = null; draw(); } }), h('button', { class: 'btn', text: 'refresh корзин', onclick: () => { K.refresh(); draw(); } })), h('p', { class: 'sm mt', text: 'Сеть: ' + ids.length + ' узлов, ' + st.bits + '-битные идентификаторы.' }));
      out.append(h('div', { class: 'cols', style: 'grid-template-columns:repeat(auto-fit,minmax(340px,1fr));align-items:start' }, h('div', null, ctl, h('div', { style: 'height:12px' }), par), kb));
    }
    draw();
  }

  ui.registerWorkspace({
    id: 'hashring', title: 'Хэш-кольцо и DHT', group: 'Данные и маршрутизация', order: 10, short: 'Консистентное хэширование с vnodes, Chord и Kademlia: как найти, на каком сервере лежат данные.',
    mount(root, opts) {
      const S = ND.dhtState = ND.dhtState || {}; const mode = (opts && opts.mode) || S.mode || 'ring';
      const page = h('div', { class: 'page' }); const tabs = h('div', { class: 'wsd-tabs' }), body = h('div');
      page.append(h('style', { text: CSS }), h('h2', { text: 'Хэш-кольцо и DHT' }), h('p', { class: 'mt', style: 'max-width:820px', html: 'Как распределить данные по серверам так, чтобы добавление узла не перемешивало всё? И как найти нужный узел без центрального каталога? Три приёма — от практики баз данных до P2P-сетей.' }), tabs, body);
      const show = m => { S.mode = m; body.innerHTML = ''; [...tabs.children].forEach(b => b.classList.toggle('on', b.dataset.m === m)); ({ ring: mountRing, chord: mountChord, kad: mountKad })[m](body, S); };
      [['ring', 'Консистентное хэширование'], ['chord', 'Chord'], ['kad', 'Kademlia']].forEach(([m, t]) => tabs.append(h('button', { class: 'btn', 'data-m': m, text: t, onclick: () => show(m) })));
      root.append(page); show(mode); return {};
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
