/* Протокол: кворумная репликация в стиле Dynamo — N реплик, запись ждёт W подтверждений, чтение — R ответов. */
(function (G) {
  'use strict';
  const ND = G.ND;
  const gl = sim => sim.G_quorum || (sim.G_quorum = { latest: {}, reads: 0, stale: 0, wOk: 0, wFail: 0, rFail: 0, repairs: 0, ops: 0, log: [] });
  const gtv = (a, b) => !b ? true : (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]));
  const pref = (sim, key) => { const N = Math.min(sim.params.N, sim.nodes.length), h = ND.hash32(key) % sim.nodes.length, out = []; for (let i = 0; i < N; i++) out.push(sim.nodes[(h + i) % sim.nodes.length].id); return out; };
  function finish(ctx, op, ok, text, val) {
    const g = gl(ctx.sim), st = ctx.st; delete st.ops[op.id]; ctx.cancel('op' + op.id);
    g.log.push({ t: ctx.now, type: op.type, key: op.key, ok, val });
    ctx.mark(text, ok ? 'c-green' : 'c-red');
  }
  ND.registerProtocol({
    id: 'quorum', title: 'Кворумы N/R/W (Dynamo)', group: 'Транзакции и репликация', order: 20,
    short: 'Реплики без лидера: запись ждёт W подтверждений, чтение — R ответов; при R+W>N чтение видит последнюю запись.',
    desc: '<p>Ключ хранится на <b>N репликах</b>. Любой узел может быть <b>координатором</b>: запись считается успешной, когда ответили <b>W</b> реплик, чтение — когда ответили <b>R</b>, и берётся значение с самой новой версией. Если <b>R + W &gt; N</b>, множества опрошенных реплик пересекаются, поэтому чтение видит последнюю успешную запись (строгий кворум). При R + W ≤ N возможны <b>устаревшие чтения</b>.</p><p>Включите «Read repair» — координатор подновит отставшие реплики. Разделите сеть: сторона без кворума не сможет писать (теряет доступность — это CAP). Попробуйте N=3, W=1, R=1 и разрыв сети.</p>',
    legend: [{ c: 'c-green', t: 'реплика работает' }, { c: 'c-orange', t: 'не хватает связи' }, { c: 'c-gray', t: 'отказал' }],
    params: [
      { id: 'N', label: 'N — число реплик ключа', type: 'number', def: 3, min: 1, max: 7, hint: 'сколько узлов хранят каждый ключ (следующие N узлов от хэша ключа)' },
      { id: 'W', label: 'W — кворум записи', type: 'number', def: 2, min: 1, max: 7, hint: 'сколько подтверждений нужно для успешной записи' },
      { id: 'R', label: 'R — кворум чтения', type: 'number', def: 2, min: 1, max: 7, hint: 'сколько ответов нужно для чтения' },
      { id: 'readRepair', label: 'Read repair', type: 'bool', def: false, hint: 'после чтения координатор отправляет свежую версию отставшим репликам' },
      { id: 'timeout', label: 'Таймаут операции, мс', type: 'number', def: 2500, min: 200, max: 30000, hint: 'через сколько операция считается проваленной' },
    ],
    actions: [
      { id: 'write', label: 'Записать (координатор — выбранный узел)', args: [{ id: 'node', label: 'Координатор', type: 'node' }, { id: 'key', label: 'Ключ', type: 'text', def: 'k' }, { id: 'value', label: 'Значение', type: 'text', def: 'v1' }], run(sim, a) { return start(sim, a, 'write'); } },
      { id: 'read', label: 'Прочитать (координатор — выбранный узел)', args: [{ id: 'node', label: 'Координатор', type: 'node' }, { id: 'key', label: 'Ключ', type: 'text', def: 'k' }], run(sim, a) { return start(sim, a, 'read'); } },
    ],
    init() { return { data: {}, ops: {}, seq: 0 }; },
    onStart() { },
    onTimer(ctx, name) { const m = /^op(\d+)$/.exec(name); if (!m) return; const op = ctx.st.ops[m[1]]; if (!op) return; const g = gl(ctx.sim); if (op.type === 'write') { g.wFail++; finish(ctx, op, false, 'ЗАПИСЬ «' + op.key + '» ПРОВАЛЕНА: получено ' + op.acks.length + ' из W=' + ctx.params.W + ' подтверждений (таймаут)'); } else { g.rFail++; finish(ctx, op, false, 'ЧТЕНИЕ «' + op.key + '» ПРОВАЛЕНО: получено ' + op.rep.length + ' из R=' + ctx.params.R + ' ответов (таймаут)'); } },
    onMessage(ctx, m) {
      const st = ctx.st, b = m.body, g = gl(ctx.sim);
      if (m.type === 'W') { const cur = st.data[b.key]; if (!cur || gtv(b.ver, cur.ver)) st.data[b.key] = { v: b.val, ver: b.ver }; ctx.send(m.from, 'WA', { op: b.op }); }
      else if (m.type === 'WA') { const op = st.ops[b.op]; if (!op || op.acks.includes(m.from)) return; op.acks.push(m.from); if (op.acks.length >= ctx.params.W) { g.wOk++; g.latest[op.key] = { val: op.val, ver: op.ver, t: ctx.now }; finish(ctx, op, true, 'ЗАПИСЬ «' + op.key + '» = ' + op.val + ' подтверждена (' + op.acks.length + ' из W=' + ctx.params.W + ')'); } }
      else if (m.type === 'R') { const cur = st.data[b.key]; ctx.send(m.from, 'RA', { op: b.op, val: cur ? cur.v : null, ver: cur ? cur.ver : null }); }
      else if (m.type === 'RA') {
        const op = st.ops[b.op]; if (!op) { return; } op.rep.push({ from: m.from, val: b.val, ver: b.ver });
        if (op.rep.length >= ctx.params.R) {
          let best = null; for (const r of op.rep) if (r.ver && (!best || gtv(r.ver, best.ver))) best = r;
          const lat = g.latest[op.key]; g.reads++; const stale = lat && (!best || gtv(lat.ver, best.ver));
          if (stale) { g.stale++; if (ctx.params.R + ctx.params.W > ctx.params.N) g.bad = true; }
          if (ctx.params.readRepair && best) for (const r of op.rep) if (!r.ver || gtv(best.ver, r.ver)) { g.repairs++; ctx.send(r.from, 'W', { op: 0, key: op.key, val: best.val, ver: best.ver }); }
          finish(ctx, op, true, 'ЧТЕНИЕ «' + op.key + '» → ' + (best ? best.val : '∅') + (stale ? '  ⚠ УСТАРЕВШЕЕ: последняя успешная запись была «' + lat.val + '»' : ''), best ? best.val : null);
        }
      }
    },
    describe(m) { const b = m.body; return { W: () => m.from + ' → ' + m.to + ': записать «' + b.key + '» = ' + b.val + ' (версия ' + b.ver.join('.') + ')', WA: () => m.from + ' → ' + m.to + ': запись сохранена', R: () => m.from + ' → ' + m.to + ': прочитать «' + b.key + '»', RA: () => m.from + ' → ' + m.to + ': моё значение ' + (b.val == null ? '∅' : '«' + b.val + '» (версия ' + b.ver.join('.') + ')') }[m.type](); },
    label(m) { return { W: 'W:' + m.body.val, WA: 'ack', R: 'R', RA: m.body.val == null ? '∅' : m.body.val }[m.type]; },
    badge(n) { return Object.keys(n.st.data).length + ' ключ.'; },
    nodeClass(n, sim) { if (!n.up) return 'c-gray'; return sim.reachable(n.id).size < Math.max(sim.params.W, sim.params.R) ? 'c-orange' : 'c-green'; },
    inspector(n, sim) { const ks = Object.keys(n.st.data); return '<h4>Хранимые ключи</h4>' + (ks.length ? '<table class="tbl"><tr><th>ключ</th><th>значение</th><th>версия</th></tr>' + ks.map(k => '<tr><td>' + ND.esc(k) + '</td><td>' + ND.esc(n.st.data[k].v) + '</td><td>' + n.st.data[k].ver.join('.') + '</td></tr>').join('') + '</table>' : '<p class="mt">пусто</p>') + '<p class="mt sm">Реплики ключа «k»: ' + pref(sim, 'k').join(', ') + '</p>'; },
    metrics(sim) { const g = gl(sim), N = Math.min(sim.params.N, sim.nodes.length); return [{ label: 'R + W > N ?', value: (sim.params.R + sim.params.W) + ' ' + (sim.params.R + sim.params.W > N ? '>' : '≤') + ' ' + N + (sim.params.R + sim.params.W > N ? ' (строгий кворум)' : ' (возможны устаревшие чтения)') }, { label: 'записей ок / провал', value: g.wOk + ' / ' + g.wFail }, { label: 'чтений / устаревших', value: g.reads + ' / ' + g.stale }, { label: 'чтений провалено', value: g.rFail }, { label: 'read repair отправлено', value: g.repairs }]; },
    invariants(sim) { const g = gl(sim), N = Math.min(sim.params.N, sim.nodes.length); return [{ id: 'quorum', ok: !g.bad, text: 'Если R + W > N, чтение после успешной записи не возвращает устаревшее значение (' + (sim.params.R + sim.params.W > N ? 'условие выполнено' : 'условие НЕ выполнено — гарантии нет') + ')' }]; },
    defaultScheme() { return ND.makeScheme({ proto: 'quorum', n: 5, topo: 'full', lat: 250, jit: 60, title: 'Quorum: 5 узлов, N=3 R=2 W=2' }); },
  });
  function start(sim, a, type) {
    const n = sim.byId[a.node || sim.nodes[0].id]; if (!n || !n.up) return { text: 'узел-координатор недоступен' };
    const key = String(a.key || 'k').slice(0, 12), ctx = sim.ctx(n), st = n.st, id = ++st.seq + '' + n.id.replace(/\D/g, ''), g = gl(sim); g.ops++;
    const op = { id, type, key, acks: [], rep: [] }; st.ops[id] = op; const P = pref(sim, key);
    if (type === 'write') { const cur = st.data[key], ver = [(cur ? cur.ver[0] : (g.latest[key] ? g.latest[key].ver[0] : 0)) + 1, n.id]; op.val = String(a.value == null ? '' : a.value).slice(0, 12); op.ver = ver; for (const p of P) ctx.send(p, 'W', { op: id, key, val: op.val, ver }); }
    else for (const p of P) ctx.send(p, 'R', { op: id, key });
    ctx.timer('op' + id, sim.params.timeout);
    return { text: (type === 'write' ? 'запись' : 'чтение') + ' «' + key + '» через координатора ' + n.name + ': реплики ' + P.join(', ') };
  }
  ND.registerTemplate = ND.registerTemplate || (t => ND.reg.templates.push(t));
  ND.registerTemplate({ id: 'q-strict', proto: 'quorum', title: 'N=3, R=2, W=2 — строгий кворум', desc: 'do write node=n1 key=k value=A, затем do read node=n4 key=k — чтение всегда видит A.', build: () => ND.makeScheme({ proto: 'quorum', n: 5, topo: 'full', lat: 250, jit: 60, params: { N: 3, R: 2, W: 2 }, title: 'Quorum N3 R2 W2' }) });
  ND.registerTemplate({ id: 'q-weak', proto: 'quorum', title: 'N=3, R=1, W=1 — быстро, но устаревшие чтения', desc: 'Запишите значение и сразу читайте через другого координатора: do write node=n1 key=k value=A; run 0.3; do read node=n3 key=k — получите «∅» или старое.', build: () => ND.makeScheme({ proto: 'quorum', n: 5, topo: 'full', lat: 250, jit: 60, params: { N: 3, R: 1, W: 1 }, title: 'Quorum N3 R1 W1' }) });
  ND.registerTemplate({ id: 'q-part', proto: 'quorum', title: 'Раздел сети 3|2 при N=3, W=2', desc: 'partition n1,n2,n3 | n4,n5; пишите с узла из меньшей группы — запись провалится (потеря доступности ради согласованности).', build: () => ND.makeScheme({ proto: 'quorum', n: 5, topo: 'full', lat: 250, jit: 60, params: { N: 3, R: 2, W: 2, readRepair: true }, title: 'Quorum: раздел' }) });
})(typeof window !== 'undefined' ? window : globalThis);
