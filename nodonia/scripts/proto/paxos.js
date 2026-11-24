/* Протокол: Single-decree Paxos (Synod). Каждый узел — акцептор и ученик; пропоузером становится узел, получивший «предложить значение». */
(function (G) {
  'use strict';
  const ND = G.ND;
  const maj = sim => Math.floor(sim.nodes.length / 2) + 1;
  const idx = (sim, id) => sim.nodes.findIndex(n => n.id === id);
  const gl = sim => sim.G_paxos || (sim.G_paxos = { proposed: [], acc: {}, chosen: [], rounds: 0, nacks: 0 });

  function startRound(ctx) {
    const st = ctx.st, sim = ctx.sim, g = gl(sim);
    if (st.decided !== null || st.want === null) return;
    st.round++; g.rounds++; const n = st.round * 100 + idx(sim, ctx.id) + 1;
    st.prop = { n, v: st.want, phase: 1, promises: [], bestN: 0, bestV: null };
    ctx.mark('пропоузер: фаза 1 (PREPARE) с номером ' + n + ' для значения «' + st.want + '»', 'c-orange');
    for (const x of sim.nodes) ctx.send(x.id, 'PREPARE', { n });
    const p = ctx.params, d = p.randomBackoff ? ctx.rng.int(p.retryMin, Math.max(p.retryMin, p.retryMax)) : p.retryMin;
    ctx.timer('retry', d);
  }

  ND.registerProtocol({
    id: 'paxos', title: 'Paxos (одно решение)', group: 'Консенсус', order: 11,
    short: 'Два раунда «обещание → принятие»: узлы выбирают ровно одно значение, даже если пропоузеров несколько.',
    desc: '<p><b>Paxos</b> решает задачу консенсуса: большинство узлов должно прийти к <i>одному</i> значению, пока работает хотя бы большинство. <b>Фаза 1</b>: пропоузер шлёт <code>PREPARE(n)</code>; акцептор, получив n больше обещанного, обещает не принимать меньшие номера и сообщает уже принятое значение (<code>PROMISE</code>). <b>Фаза 2</b>: получив обещания большинства, пропоузер шлёт <code>ACCEPT(n, v)</code> — со значением, <b>уже принятым ранее</b> (с наибольшим номером), если оно было, иначе со своим.</p><p>Значение «выбрано», когда его приняло большинство акцепторов. Именно правило «возьми принятое значение» защищает безопасность. Если пропоузеры постоянно перебивают друг друга (дуэль), прогресса нет — это <b>livelock</b>; лечится случайной паузой перед повтором.</p><p>Попробуйте: «Предложить значение» на двух узлах почти одновременно; отключите «случайную паузу» и сократите повтор; включите ⚠ unsafeProposer и найдите нарушение.</p>',
    legend: [{ c: 'c-green', t: 'узнал решение' }, { c: 'c-orange', t: 'ведёт раунд' }, { c: 'c-purple', t: 'принял значение' }, { c: 'c-blue', t: 'ничего не принимал' }, { c: 'c-gray', t: 'отказал' }],
    params: [
      { id: 'randomBackoff', label: 'Случайная пауза перед повтором', type: 'bool', def: true, hint: 'без неё два пропоузера могут бесконечно перебивать друг друга (livelock)' },
      { id: 'retryMin', label: 'Повтор раунда, мин мс', type: 'number', def: 3000, min: 100, max: 60000, hint: 'через сколько пропоузер начнёт новый раунд, если решения нет' },
      { id: 'retryMax', label: 'Повтор раунда, макс мс', type: 'number', def: 6000, min: 100, max: 60000, hint: 'верхняя граница случайной паузы' },
      { id: 'unsafeProposer', label: '⚠ unsafeProposer (игнорировать принятое)', type: 'bool', def: false, hint: 'пропоузер всегда предлагает своё значение, не учитывая PROMISE с уже принятым — ломает безопасность' },
    ],
    actions: [{ id: 'propose', label: 'Предложить значение', args: [{ id: 'node', label: 'Пропоузер', type: 'node' }, { id: 'value', label: 'Значение', type: 'text', def: 'A' }], run(sim, a) { const n = sim.byId[a.node || sim.nodes[0].id]; if (!n || !n.up) return { text: 'узел недоступен' }; const v = String(a.value == null || a.value === '' ? 'A' : a.value).slice(0, 10); n.st.want = v; const g = gl(sim); if (!g.proposed.includes(v)) g.proposed.push(v); startRound(sim.ctx(n)); return { text: n.name + ' предлагает «' + v + '»' }; } }],
    init() { return { promised: 0, accN: 0, accV: null, want: null, round: 0, prop: null, decided: null, learned: {} }; },
    onStart() { },
    onCrash(ctx) { ctx.st.prop = null; },
    onRecover(ctx) { if (ctx.st.want !== null && ctx.st.decided === null) ctx.timer('retry', 500); },
    onTimer(ctx, name) { if (name === 'retry' && ctx.st.decided === null && ctx.st.want !== null) startRound(ctx); },
    onMessage(ctx, m) {
      const st = ctx.st, sim = ctx.sim, b = m.body, g = gl(sim);
      if (m.type === 'PREPARE') {
        if (b.n > st.promised) { st.promised = b.n; ctx.send(m.from, 'PROMISE', { n: b.n, accN: st.accN, accV: st.accV }); }
        else ctx.send(m.from, 'NACK', { n: b.n, promised: st.promised });
      } else if (m.type === 'PROMISE') {
        const p = st.prop; if (!p || p.n !== b.n || p.phase !== 1 || p.promises.includes(m.from)) return;
        p.promises.push(m.from); if (b.accN > p.bestN) { p.bestN = b.accN; p.bestV = b.accV; }
        if (p.promises.length >= maj(sim)) {
          p.phase = 2; const adopt = !ctx.params.unsafeProposer && p.bestV !== null; p.v = adopt ? p.bestV : st.want;
          ctx.mark('получил ' + p.promises.length + ' обещаний → фаза 2 (ACCEPT ' + p.n + ', «' + p.v + '»)' + (adopt ? ' — берёт ранее принятое значение' : ''), 'c-orange');
          for (const x of sim.nodes) ctx.send(x.id, 'ACCEPT', { n: p.n, v: p.v });
        }
      } else if (m.type === 'ACCEPT') {
        if (b.n >= st.promised) {
          st.promised = b.n; st.accN = b.n; st.accV = b.v; ctx.mark('принимает значение «' + b.v + '» (номер ' + b.n + ')', 'c-purple');
          const key = b.n + '|' + b.v; const set = g.acc[key] = g.acc[key] || []; if (!set.includes(ctx.id)) set.push(ctx.id); if (set.length >= maj(sim) && !g.chosen.includes(b.v)) g.chosen.push(b.v);
          for (const x of sim.nodes) ctx.send(x.id, 'ACCEPTED', { n: b.n, v: b.v });
        } else ctx.send(m.from, 'NACK', { n: b.n, promised: st.promised });
      } else if (m.type === 'ACCEPTED') {
        const key = b.n + '|' + b.v, L = st.learned[key] = st.learned[key] || []; if (!L.includes(m.from)) L.push(m.from);
        if (L.length >= maj(sim) && st.decided === null) { st.decided = b.v; st.prop = null; ctx.cancel('retry'); ctx.mark('узнаёт РЕШЕНИЕ: «' + b.v + '» (его приняло большинство)', 'c-green'); }
      } else if (m.type === 'NACK') {
        g.nacks++; if (st.prop && st.prop.n === b.n) { st.round = Math.max(st.round, Math.floor(b.promised / 100)); ctx.log('получил NACK: уже обещано ' + b.promised + ' — раунд сорван'); st.prop = null; }
      }
    },
    describe(m) {
      const b = m.body; return { PREPARE: m.from + ' → ' + m.to + ': PREPARE(' + b.n + ') — «обещайте не принимать номера меньше ' + b.n + '»', PROMISE: m.from + ' → ' + m.to + ': PROMISE(' + b.n + ') — обещаю; уже принято: ' + (b.accV === null ? 'ничего' : '«' + b.accV + '» под номером ' + b.accN), ACCEPT: m.from + ' → ' + m.to + ': ACCEPT(' + b.n + ', «' + b.v + '») — «примите значение»', ACCEPTED: m.from + ' → ' + m.to + ': ACCEPTED(' + b.n + ', «' + b.v + '») — «я принял»', NACK: m.from + ' → ' + m.to + ': NACK — отказ: уже обещан номер ' + b.promised }[m.type] || m.type;
    },
    label(m) { return m.type === 'PREPARE' ? 'PREP ' + m.body.n : m.type === 'ACCEPT' ? 'ACC ' + m.body.v : m.type === 'ACCEPTED' ? 'ok ' + m.body.v : m.type; },
    badge(n) { const s = n.st; return s.decided !== null ? '✔ «' + s.decided + '»' : s.accV !== null ? 'принято ' + s.accV + '@' + s.accN : 'обещ. ' + s.promised; },
    nodeClass(n) { const s = n.st; return !n.up ? 'c-gray' : s.decided !== null ? 'c-green' : s.prop ? 'c-orange' : s.accV !== null ? 'c-purple' : 'c-blue'; },
    inspector(n) {
      const s = n.st; let h = '<h4>Акцептор</h4><dl class="kv"><dt>обещал (promised)</dt><dd>' + s.promised + '</dd><dt>принял (accN, accV)</dt><dd>' + (s.accV === null ? '—' : s.accN + ', «' + ND.esc(s.accV) + '»') + '</dd></dl><h4>Пропоузер</h4>';
      h += s.want === null ? '<p class="mt">Не предлагал значений.</p>' : '<dl class="kv"><dt>хочет</dt><dd>«' + ND.esc(s.want) + '»</dd><dt>раунд</dt><dd>' + s.round + '</dd>' + (s.prop ? '<dt>номер / фаза</dt><dd>' + s.prop.n + ' / ' + s.prop.phase + '</dd><dt>обещаний</dt><dd>' + s.prop.promises.join(', ') + '</dd><dt>вынужденное значение</dt><dd>' + (s.prop.bestV === null ? 'нет' : '«' + ND.esc(s.prop.bestV) + '»') + '</dd>' : '') + '</dl>';
      return h + '<h4>Ученик</h4><p>Решение: ' + (s.decided === null ? '<span class="mt">ещё нет</span>' : '<b class="ok">«' + ND.esc(s.decided) + '»</b>') + '</p>';
    },
    metrics(sim) { const g = gl(sim); return [{ label: 'выбрано значение', value: g.chosen.length ? g.chosen.map(v => '«' + v + '»').join(', ') : 'нет' }, { label: 'раундов начато', value: g.rounds }, { label: 'NACK', value: g.nacks }, { label: 'узнали решение', value: sim.nodes.filter(n => n.st.decided !== null).length + ' из ' + sim.nodes.length }]; },
    invariants(sim) {
      const g = gl(sim), dec = sim.nodes.map(n => n.st.decided).filter(v => v !== null);
      return [
        { id: 'agree', ok: g.chosen.length <= 1 && dec.every(v => v === dec[0]), text: 'Согласие: выбрано не более одного значения, все решения совпадают' },
        { id: 'valid', ok: g.chosen.every(v => g.proposed.includes(v)) && dec.every(v => g.proposed.includes(v)), text: 'Валидность: выбрано только то, что кто-то предложил' },
      ];
    },
    defaultScheme() { return ND.makeScheme({ proto: 'paxos', n: 5, topo: 'full', lat: 200, jit: 60, title: 'Paxos: 5 узлов' }); },
  });
  ND.reg.templates.push(
    { id: 'paxos-5', proto: 'paxos', title: 'Paxos: 5 узлов', desc: 'Выполните: do propose node=n1 value=A — решение за несколько сообщений.', build: () => ND.makeScheme({ proto: 'paxos', n: 5, topo: 'full', lat: 200, jit: 60, title: 'Paxos: 5 узлов' }) },
    { id: 'paxos-duel', proto: 'paxos', title: 'Paxos: дуэль пропоузеров (livelock)', desc: 'Короткий повтор без случайной паузы. Выполните: do propose node=n1 value=A, run 0.1, do propose node=n2 value=B, run 40. Затем включите «случайную паузу».', build: () => ND.makeScheme({ proto: 'paxos', n: 5, topo: 'full', lat: 200, jit: 0, params: { randomBackoff: false, retryMin: 350, retryMax: 350 }, title: 'Paxos: дуэль' }) },
    { id: 'paxos-unsafe', proto: 'paxos', title: 'Paxos: сломанный пропоузер', desc: 'Включено unsafeProposer. Предложите A на n1, дождитесь решения, затем предложите B на n2 при потере связи с частью узлов — см. инварианты.', build: () => ND.makeScheme({ proto: 'paxos', n: 5, topo: 'full', lat: 200, jit: 40, params: { unsafeProposer: true }, title: 'Paxos: unsafeProposer' }) },
    { id: 'paxos-3', proto: 'paxos', title: 'Paxos: 3 узла, отказ одного', desc: 'Отключите один узел и предложите значение — большинство (2 из 3) достаточно.', build: () => ND.makeScheme({ proto: 'paxos', n: 3, topo: 'full', lat: 250, title: 'Paxos: 3 узла' }) });
})(typeof window !== 'undefined' ? window : globalThis);
