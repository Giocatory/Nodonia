/* Протокол: CRDT — репликация без координации. Состояния сливаются (merge), поэтому реплики сходятся при любом порядке доставки. */
(function (G) {
  'use strict';
  const ND = G.ND;
  const MODES = [['gcounter', 'G-Counter (только рост)'], ['pncounter', 'PN-Counter (рост и убыль)'], ['lwwreg', 'LWW-Register (последняя запись побеждает)'], ['orset', 'OR-Set (множество: добавить/удалить)'], ['naivecounter', '✗ Наивный счётчик (берём максимум)'], ['naiveset', '✗ Наивное множество (последнее состояние)']];
  const gl = sim => sim.G_crdt || (sim.G_crdt = { ops: 0, lost: 0 });
  const empty = mode => ({ gcounter: { p: {} }, pncounter: { p: {}, n: {} }, lwwreg: { v: null, ts: 0, by: '' }, orset: { add: {}, rem: [] }, naivecounter: { c: 0 }, naiveset: { s: [] } }[mode]);
  const sumv = o => Object.values(o).reduce((a, b) => a + b, 0);
  function value(st, mode) {
    const d = st.d; switch (mode) { case 'gcounter': return sumv(d.p); case 'pncounter': return sumv(d.p) - sumv(d.n); case 'lwwreg': return d.v == null ? '∅' : d.v; case 'naivecounter': return d.c;
      case 'orset': return Object.keys(d.add).filter(e => d.add[e].some(t => !d.rem.includes(t))).sort().join(',') || '∅'; case 'naiveset': return d.s.slice().sort().join(',') || '∅'; }
  }
  function merge(mode, a, b) { // a, b — состояния; возвращает новое (не изменяя аргументы)
    const r = ND.clone(a);
    const maxm = (x, y) => { for (const k in y) x[k] = Math.max(x[k] || 0, y[k]); };
    if (mode === 'gcounter') maxm(r.p, b.p); else if (mode === 'pncounter') { maxm(r.p, b.p); maxm(r.n, b.n); }
    else if (mode === 'lwwreg') { if (b.ts > r.ts || (b.ts === r.ts && b.by > r.by)) return ND.clone(b); }
    else if (mode === 'orset') { for (const e in b.add) { r.add[e] = Array.from(new Set((r.add[e] || []).concat(b.add[e]))); } r.rem = Array.from(new Set(r.rem.concat(b.rem))); }
    else if (mode === 'naivecounter') r.c = Math.max(r.c, b.c); else if (mode === 'naiveset') return ND.clone(b);
    return r;
  }
  ND.crdtMerge = merge;
  function op(sim, a, kind) {
    const n = sim.byId[a.node || sim.nodes[0].id]; if (!n || !n.up) return { text: 'узел недоступен' };
    const mode = sim.params.mode, st = n.st, d = st.d, g = gl(sim), id = ++g.ops; st.seen.push(id); const ctx = sim.ctx(n);
    if (kind === 'inc') { const k = ND.num(a.by, 1, 1, 1000); if (mode === 'gcounter' || mode === 'pncounter') d.p[n.id] = (d.p[n.id] || 0) + k; else if (mode === 'naivecounter') d.c += k; else return { text: 'inc не применим в режиме ' + mode }; }
    else if (kind === 'dec') { const k = ND.num(a.by, 1, 1, 1000); if (mode === 'pncounter') d.n[n.id] = (d.n[n.id] || 0) + k; else if (mode === 'naivecounter') d.c -= k; else return { text: 'dec работает в pncounter (в G-Counter убывать нельзя — в этом смысл структуры)' }; }
    else if (kind === 'set') { if (mode !== 'lwwreg') return { text: 'set — для lwwreg' }; st.d = d.v === undefined ? d : d; d.v = String(a.value == null ? '' : a.value).slice(0, 12); d.ts = Math.round(sim.now + (n.cfg.skew || 0)); d.by = n.id; }
    else if (kind === 'add') { const e = String(a.elem || 'x').slice(0, 10); if (mode === 'orset') (d.add[e] = d.add[e] || []).push(n.id + '#' + id); else if (mode === 'naiveset') { if (!d.s.includes(e)) d.s.push(e); } else return { text: 'add — для множеств' }; }
    else if (kind === 'remove') { const e = String(a.elem || 'x').slice(0, 10); if (mode === 'orset') { d.rem.push(...(d.add[e] || []).filter(t => !d.rem.includes(t))); } else if (mode === 'naiveset') d.s = d.s.filter(x => x !== e); else return { text: 'remove — для множеств' }; }
    ctx.mark('локально изменил состояние (операция #' + id + ') → значение ' + value(st, mode), 'c-teal');
    return { text: n.name + ': ' + kind + ' применено локально; значение ' + value(st, mode) };
  }
  ND.registerProtocol({
    id: 'crdt', title: 'CRDT (сходимость без координатора)', group: 'Транзакции и репликация', order: 30,
    short: 'Реплики принимают изменения независимо, а потом сливают состояния — и всегда приходят к одному результату.',
    desc: '<p><b>CRDT</b> (conflict-free replicated data type) — структура данных, у которой операция слияния <code>merge</code> <b>коммутативна, ассоциативна и идемпотентна</b>. Тогда неважно, в каком порядке и сколько раз дошли обновления: все реплики сходятся (<b>strong eventual consistency</b>). Узлы пишут локально даже при разделе сети (доступность), а после восстановления связи состояния сливаются.</p><p>Сравните режимы: <b>G-Counter</b> хранит по слоту на узел и не теряет приращений; «наивный счётчик» (берём максимум) теряет их; <b>LWW</b> зависит от часов (поле «сдвиг часов» у узла покажет потерю записи); в <b>OR-Set</b> «добавить» побеждает конкурирующее «удалить» только для тех добавлений, которые удаляющий не видел.</p>',
    legend: [{ c: 'c-green', t: 'значение как у большинства' }, { c: 'c-orange', t: 'расходится' }, { c: 'c-gray', t: 'отказал' }],
    params: [{ id: 'mode', label: 'Тип данных', type: 'select', def: 'gcounter', options: MODES.map(m => ({ v: m[0], t: m[1] })), hint: 'какую структуру реплицируем' }, { id: 'syncMs', label: 'Период обмена состояниями, мс', type: 'number', def: 1500, min: 100, max: 20000, hint: 'как часто узел отправляет своё состояние случайному соседу (anti-entropy)' }],
    nodeCfg: [{ id: 'skew', label: 'Сдвиг часов узла, мс (для LWW)', type: 'number', def: 0, min: -600000, max: 600000, hint: 'на сколько часы узла спешат (+) или отстают (−)' }],
    actions: [
      { id: 'inc', label: 'Увеличить счётчик', args: [{ id: 'node', label: 'Узел', type: 'node' }, { id: 'by', label: 'На сколько', type: 'number', def: 1 }], run: (s, a) => op(s, a, 'inc') },
      { id: 'dec', label: 'Уменьшить счётчик', args: [{ id: 'node', label: 'Узел', type: 'node' }, { id: 'by', label: 'На сколько', type: 'number', def: 1 }], run: (s, a) => op(s, a, 'dec') },
      { id: 'set', label: 'Записать значение (LWW)', args: [{ id: 'node', label: 'Узел', type: 'node' }, { id: 'value', label: 'Значение', type: 'text', def: 'A' }], run: (s, a) => op(s, a, 'set') },
      { id: 'add', label: 'Добавить элемент', args: [{ id: 'node', label: 'Узел', type: 'node' }, { id: 'elem', label: 'Элемент', type: 'text', def: 'x' }], run: (s, a) => op(s, a, 'add') },
      { id: 'remove', label: 'Удалить элемент', args: [{ id: 'node', label: 'Узел', type: 'node' }, { id: 'elem', label: 'Элемент', type: 'text', def: 'x' }], run: (s, a) => op(s, a, 'remove') },
    ],
    init(n, sim) { return { d: empty(sim.params.mode), seen: [] }; },
    onParam(sim, key) { if (key === 'mode') sim.nodes.forEach(n => { n.st = { d: empty(sim.params.mode), seen: [] }; }); },
    onStart(ctx) { ctx.timer('sync', ctx.rng.int(1, ctx.params.syncMs)); },
    onRecover(ctx) { ctx.timer('sync', ctx.rng.int(1, ctx.params.syncMs)); },
    onTimer(ctx, name) { if (name !== 'sync') return; const nb = ctx.neighbors; if (nb.length) ctx.send(ctx.rng.pick(nb), 'state', { d: ctx.st.d, seen: ctx.st.seen, mode: ctx.params.mode }); ctx.timer('sync', ctx.params.syncMs); },
    onMessage(ctx, m) {
      const st = ctx.st, mode = ctx.params.mode, before = JSON.stringify(st.d); if (m.body.mode !== mode) return; /* состояние другого типа данных (параметр сменили на лету) */
      st.d = merge(mode, st.d, m.body.d); st.seen = Array.from(new Set(st.seen.concat(m.body.seen))).sort((a, b) => a - b);
      if (JSON.stringify(st.d) !== before) ctx.mark('слил состояние от ' + m.from + ' → значение ' + value(st, mode), 'c-teal');
    },
    describe(m) { return m.from + ' → ' + m.to + ': передаёт своё состояние для слияния (merge)'; },
    label() { return 'state'; },
    badge(n, sim) { return '= ' + value(n.st, sim.params.mode); },
    nodeClass(n, sim) { if (!n.up) return 'c-gray'; const vs = sim.nodes.filter(x => x.up).map(x => String(value(x.st, sim.params.mode))), cnt = {}; vs.forEach(v => cnt[v] = (cnt[v] || 0) + 1); const top = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0]; return String(value(n.st, sim.params.mode)) === top ? 'c-green' : 'c-orange'; },
    inspector(n, sim) { return '<p><b>Значение:</b> <span class="mono">' + ND.esc(value(n.st, sim.params.mode)) + '</span></p><h4>Внутреннее состояние</h4><pre class="mono sm" style="white-space:pre-wrap">' + ND.esc(JSON.stringify(n.st.d)) + '</pre><p class="mt sm">Учтено операций: ' + n.st.seen.length + ' (' + n.st.seen.join(', ') + ')</p>'; },
    metrics(sim) { const vs = sim.nodes.filter(n => n.up).map(n => String(value(n.st, sim.params.mode))), u = Array.from(new Set(vs)); return [{ label: 'различных значений у живых узлов', value: u.length + (u.length === 1 ? ' — сошлись ✔' : ' — расходятся') }, { label: 'значения', value: u.join(' | ') }, { label: 'операций выполнено', value: gl(sim).ops }]; },
    invariants(sim) { const mode = sim.params.mode; let ok = true; const by = {}; for (const n of sim.nodes) { const k = n.st.seen.join(','), v = String(value(n.st, mode)); if (by[k] !== undefined && by[k] !== v) ok = false; by[k] = v; } return [{ id: 'sec', ok, text: 'Strong eventual consistency: узлы, учёт которых включает одни и те же операции, имеют одно и то же значение' }]; },
    defaultScheme() { return ND.makeScheme({ proto: 'crdt', n: 4, topo: 'full', lat: 400, jit: 100, title: 'CRDT: 4 реплики' }); },
  });
  const T = (id, title, desc, p, extra) => ND.reg.templates.push({ id, proto: 'crdt', title, desc, build: () => ND.makeScheme(Object.assign({ proto: 'crdt', n: 4, topo: 'full', lat: 400, jit: 100, params: p, title }, extra || {})) });
  T('crdt-gc', 'G-Counter: раздел и слияние', 'partition n1,n2 | n3,n4; do inc node=n1 by=5; do inc node=n3 by=7; run 6; heal all; run 8 — все получат 12.', { mode: 'gcounter' });
  T('crdt-naive', '✗ Наивный счётчик теряет приращения', 'То же, но режим «наивный счётчик»: после слияния получится 7, а не 12 — потеряно 5.', { mode: 'naivecounter' });
  T('crdt-lww', 'LWW и сдвиг часов', 'У n2 часы отстают на минуту (cfg skew). do set node=n1 value=A; run 2; do set node=n2 value=B — «побеждает» A, хотя B записано позже.', { mode: 'lwwreg' }, { cfgs: [{}, { skew: -60000 }, {}, {}] });
  T('crdt-orset', 'OR-Set: добавление против удаления', 'partition n1,n2 | n3,n4; do add node=n1 elem=x; run 4; heal all; run 5; затем в разделе: do remove node=n1 elem=x и do add node=n3 elem=x — добавление выживет.', { mode: 'orset' });
})(typeof window !== 'undefined' ? window : globalThis);
