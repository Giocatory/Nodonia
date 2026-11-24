/* Протокол: двухфазная (2PC) и трёхфазная (3PC) фиксация распределённой транзакции. Координатор — первый узел. */
(function (G) {
  'use strict';
  const ND = G.ND;
  const isCoord = (sim, id) => sim.nodes[0].id === id;
  const parts = sim => sim.nodes.slice(1).map(n => n.id);
  const gl = sim => sim.G_twopc || (sim.G_twopc = { tx: 0, commits: 0, aborts: 0, blocked: 0, history: [] });
  const SN = { init: 'ожидает', wait: 'сбор голосов', ready: 'готов (неопределённость)', precommit: 'PRE-COMMIT', committed: 'ЗАФИКСИРОВАЛ', aborted: 'ОТКАТИЛ' };

  function decide(ctx, d, why) {
    const st = ctx.st, g = gl(ctx.sim); if (st.s === 'committed' || st.s === 'aborted') return;
    st.s = d === 'commit' ? 'committed' : 'aborted'; st.blocked = false; ctx.cancel('decision'); ctx.cancel('votes'); ctx.cancel('term'); ctx.cancel('acks');
    ctx.mark((d === 'commit' ? 'ФИКСИРУЕТ (commit)' : 'ОТКАТЫВАЕТ (abort)') + (why ? ': ' + why : ''), d === 'commit' ? 'c-green' : 'c-red');
    if (isCoord(ctx.sim, ctx.id)) { if (d === 'commit') g.commits++; else g.aborts++; }
  }
  function coordDecide(ctx, d, why) {
    const st = ctx.st; if (st.s === 'committed' || st.s === 'aborted') return;
    decide(ctx, d, why);
    const targets = parts(ctx.sim), fail = ctx.cfg.failAt;
    if (d === 'commit' && fail === 'after_decision') { ctx.send(targets[0], 'COMMIT', { tx: st.tx }); ctx.mark('сообщил решение только ' + targets[0] + ' и отказал', 'c-red'); return crash(ctx); }
    for (const p of targets) ctx.send(p, d === 'commit' ? 'COMMIT' : 'ABORT', { tx: st.tx });
  }
  function crash(ctx) { ctx.sim.applyAct('crash', { node: ctx.id }, true); }
  function startTerm(ctx) {
    const st = ctx.st; st.states = {}; st.states[ctx.id] = st.s; st.blocked = false;
    for (const p of parts(ctx.sim)) if (p !== ctx.id) ctx.send(p, 'STATEQ', { tx: st.tx });
    ctx.send(ctx.sim.nodes[0].id, 'STATEQ', { tx: st.tx });
    ctx.timer('term', ctx.params.timeout);
    ctx.mark('координатор молчит → протокол завершения: опрашивает коллег о состоянии', 'c-orange');
  }
  function evalTerm(ctx) {
    const st = ctx.st, v = Object.values(st.states), mode = ctx.params.mode;
    if (v.includes('committed')) return decide(ctx, 'commit', 'коллега уже зафиксировал');
    if (v.includes('aborted')) return decide(ctx, 'abort', 'коллега уже откатил');
    if (v.includes('init') || v.includes('wait')) return decide(ctx, 'abort', 'кто-то ещё не голосовал «да» — фиксации быть не могло');
    if (mode === '3pc') { if (v.includes('precommit')) { st.s = 'precommit'; return decide(ctx, 'commit', 'кто-то получил PRE-COMMIT — всё голосовали «да»'); } return decide(ctx, 'abort', 'никто не получил PRE-COMMIT — фиксировать ещё не начинали'); }
    if (!st.blocked) { st.blocked = true; gl(ctx.sim).blocked++; ctx.mark('ЗАБЛОКИРОВАН: все живые в состоянии «готов», координатор недоступен — решения нет', 'c-gold'); }
    ctx.timer('term', ctx.params.timeout * 2); st.states = { [ctx.id]: st.s }; for (const p of parts(ctx.sim)) if (p !== ctx.id) ctx.send(p, 'STATEQ', { tx: st.tx }); ctx.send(ctx.sim.nodes[0].id, 'STATEQ', { tx: st.tx });
  }

  ND.registerProtocol({
    id: 'twopc', title: '2PC / 3PC (атомарная фиксация)', group: 'Транзакции и репликация', order: 10,
    short: 'Все участники транзакции фиксируют результат или все откатывают: двухфазная и трёхфазная фиксация, блокировка при отказе координатора.',
    desc: '<p><b>Двухфазная фиксация (2PC)</b> делает транзакцию над несколькими узлами атомарной. <b>Фаза 1 (голосование)</b>: координатор (первый узел) шлёт <code>PREPARE</code>, участники отвечают «да» (и входят в состояние <i>готов</i>: обещают выполнить commit, если скажут) или «нет». <b>Фаза 2</b>: если все «да» — <code>COMMIT</code>, иначе <code>ABORT</code>.</p><p>Слабое место — <b>блокировка</b>: участник в состоянии «готов» не знает решения, пока не услышит координатора. Если координатор отказал после PREPARE, а коллеги тоже «готовы», решить безопасно нельзя — все ждут. <b>3PC</b> добавляет фазу <code>PRE-COMMIT</code>: по состояниям живых участников можно безопасно решить без координатора — но только при отказах узлов; при разделе сети 3PC может нарушить атомарность.</p><p>Попробуйте: у координатора (n1) поставьте «Отказ после PREPARE» и выполните <code>do begin</code>; затем переключите режим на 3PC; у участника поставьте голос «нет».</p>',
    legend: [{ c: 'c-blue', t: 'ожидает' }, { c: 'c-orange', t: 'готов / голосование' }, { c: 'c-purple', t: 'pre-commit' }, { c: 'c-green', t: 'зафиксировал' }, { c: 'c-red', t: 'откатил' }, { c: 'c-gold', t: 'заблокирован' }, { c: 'c-gray', t: 'отказал' }],
    params: [
      { id: 'mode', label: 'Режим', type: 'select', def: '2pc', options: [{ v: '2pc', t: '2PC (двухфазный)' }, { v: '3pc', t: '3PC (трёхфазный)' }], hint: '3PC добавляет фазу PRE-COMMIT и не блокируется при отказе координатора (если сеть не разделена)' },
      { id: 'timeout', label: 'Таймаут ожидания, мс', type: 'number', def: 2500, min: 200, max: 60000, hint: 'сколько ждать голосов / решения координатора, прежде чем действовать самостоятельно' },
      { id: 'termination', label: 'Протокол завершения', type: 'bool', def: true, hint: 'участники опрашивают друг друга о состоянии, когда координатор молчит' },
    ],
    nodeCfg(n) { return n && n.id === 'n1' ? [{ id: 'failAt', label: 'Отказ координатора', type: 'select', def: 'none', options: [{ v: 'none', t: 'не отказывает' }, { v: 'after_prepare', t: 'после PREPARE (до решения)' }, { v: 'after_decision', t: 'после решения (сообщил одному)' }], hint: 'моделирует аварию именно в опасный момент' }] : [{ id: 'vote', label: 'Голос участника', type: 'select', def: 'yes', options: [{ v: 'yes', t: 'да' }, { v: 'no', t: 'нет' }], hint: '«нет» — участник не может выполнить свою часть транзакции' }]; },
    actions: [{ id: 'begin', label: 'Начать транзакцию (координатор)', args: [], run(sim) { const c = sim.nodes[0]; if (!c.up) return { text: 'координатор недоступен' }; const st = c.st; if (st.s !== 'init' && st.s !== 'committed' && st.s !== 'aborted') return { text: 'предыдущая транзакция ещё не завершена' }; const g = gl(sim); g.tx++; for (const n of sim.nodes) { const s = n.st; s.tx = g.tx; s.s = 'init'; s.blocked = false; s.states = {}; s.acks = []; s.votes = {}; n.timers = n.up ? {} : n.timers; } const ctx = sim.ctx(c); st.s = 'wait'; ctx.mark('координатор начинает транзакцию #' + g.tx + ': рассылает PREPARE', 'c-orange'); for (const p of parts(sim)) ctx.send(p, 'PREPARE', { tx: g.tx }); ctx.timer('votes', ctx.params.timeout); if (c.cfg.failAt === 'after_prepare') { ctx.mark('координатор отказал сразу после PREPARE', 'c-red'); crash(ctx); } return { text: 'транзакция #' + g.tx + ' запущена' }; } }],
    init() { return { s: 'init', tx: 0, votes: {}, acks: [], states: {}, blocked: false }; },
    onStart() { },
    onCrash(ctx) { ctx.st.states = {}; },
    onRecover(ctx) { const st = ctx.st; if (isCoord(ctx.sim, ctx.id)) { if (st.s === 'wait' || st.s === 'precommit') coordDecide(ctx, 'abort', 'после восстановления решения в журнале нет — откат (presumed abort)'); else if (st.s === 'committed' || st.s === 'aborted') for (const p of parts(ctx.sim)) ctx.send(p, st.s === 'committed' ? 'COMMIT' : 'ABORT', { tx: st.tx }); } else if (st.s === 'ready' || st.s === 'precommit') { if (ctx.params.termination) startTerm(ctx); else ctx.timer('decision', ctx.params.timeout); } },
    onTimer(ctx, name) {
      const st = ctx.st, coord = isCoord(ctx.sim, ctx.id);
      if (name === 'votes' && coord && st.s === 'wait') coordDecide(ctx, 'abort', 'не все проголосовали вовремя');
      else if (name === 'acks' && coord && st.s === 'precommit') coordDecide(ctx, 'commit', 'PRE-COMMIT подтверждён (оставшиеся узнают при восстановлении)');
      else if (name === 'decision' && !coord && (st.s === 'ready' || st.s === 'precommit')) { if (ctx.params.termination) startTerm(ctx); else { if (!st.blocked) { st.blocked = true; gl(ctx.sim).blocked++; ctx.mark('ЗАБЛОКИРОВАН: ждёт координатора (протокол завершения выключен)', 'c-gold'); } ctx.timer('decision', ctx.params.timeout * 2); } }
      else if (name === 'term' && !coord && (st.s === 'ready' || st.s === 'precommit')) evalTerm(ctx);
    },
    onMessage(ctx, m) {
      const st = ctx.st, b = m.body, sim = ctx.sim, P = ctx.params;
      if (m.type === 'PREPARE') {
        st.tx = b.tx; if (ctx.cfg.vote === 'no') { st.s = 'aborted'; ctx.mark('голосует «нет» и откатывает у себя', 'c-red'); return ctx.send(m.from, 'VOTE', { tx: b.tx, yes: false }); }
        st.s = 'ready'; ctx.mark('голосует «да» → «готов» (обещал выполнить commit)', 'c-orange'); ctx.send(m.from, 'VOTE', { tx: b.tx, yes: true }); ctx.timer('decision', P.timeout * 2);
      } else if (m.type === 'VOTE') {
        if (st.s !== 'wait' || b.tx !== st.tx) return; st.votes[m.from] = b.yes;
        if (!b.yes) return coordDecide(ctx, 'abort', m.from + ' проголосовал «нет»');
        if (Object.values(st.votes).filter(Boolean).length === parts(sim).length) {
          ctx.cancel('votes');
          if (P.mode === '3pc') { st.s = 'precommit'; st.acks = []; ctx.mark('все «да» → рассылает PRE-COMMIT', 'c-purple'); for (const p of parts(sim)) ctx.send(p, 'PRECOMMIT', { tx: st.tx }); ctx.timer('acks', P.timeout); if (ctx.cfg.failAt === 'after_prepare') { crash(ctx); } }
          else coordDecide(ctx, 'commit', 'все участники проголосовали «да»');
        }
      } else if (m.type === 'PRECOMMIT') { if (st.s === 'ready') { st.s = 'precommit'; ctx.mark('получил PRE-COMMIT: все голосовали «да»', 'c-purple'); ctx.cancel('decision'); ctx.timer('decision', P.timeout * 2); } ctx.send(m.from, 'PACK', { tx: b.tx }); }
      else if (m.type === 'PACK') { if (st.s === 'precommit' && !st.acks.includes(m.from)) { st.acks.push(m.from); if (st.acks.length === parts(sim).length) coordDecide(ctx, 'commit', 'PRE-COMMIT подтвердили все'); } }
      else if (m.type === 'COMMIT') { if (st.s === 'ready' || st.s === 'precommit' || st.s === 'init') decide(ctx, 'commit', 'получил решение координатора'); ctx.send(m.from, 'ACK', { tx: b.tx }); }
      else if (m.type === 'ABORT') { if (st.s !== 'committed') decide(ctx, 'abort', 'получил решение координатора'); ctx.send(m.from, 'ACK', { tx: b.tx }); }
      else if (m.type === 'STATEQ') ctx.send(m.from, 'STATE', { tx: b.tx, s: st.s });
      else if (m.type === 'STATE') { if (st.states) st.states[m.from] = b.s; }
    },
    describe(m) {
      const b = m.body, x = m.from + ' → ' + m.to + ': ';
      return { PREPARE: x + 'PREPARE — «можете зафиксировать транзакцию #' + b.tx + '?»', VOTE: x + 'голос ' + (b.yes ? '«ДА»' : '«НЕТ»'), PRECOMMIT: x + 'PRE-COMMIT — «все согласны, готовьтесь фиксировать»', PACK: x + 'подтверждение PRE-COMMIT', COMMIT: x + 'COMMIT — зафиксировать', ABORT: x + 'ABORT — откатить', ACK: x + 'подтверждение решения', STATEQ: x + 'в каком вы состоянии? (протокол завершения)', STATE: x + 'моё состояние: ' + (SN[b.s] || b.s) }[m.type] || m.type;
    },
    label(m) { return { VOTE: m.body.yes ? 'да' : 'нет', STATEQ: 'state?', STATE: m.body.s, PREPARE: 'PREPARE' }[m.type] || m.type; },
    badge(n, sim) { const s = n.st; return (isCoord(sim, n.id) ? 'К · ' : 'У · ') + (s.blocked ? 'ЗАБЛОКИРОВАН' : (SN[s.s] || s.s)); },
    nodeClass(n) { const s = n.st; return !n.up ? 'c-gray' : s.blocked ? 'c-gold' : { init: 'c-blue', wait: 'c-orange', ready: 'c-orange', precommit: 'c-purple', committed: 'c-green', aborted: 'c-red' }[s.s]; },
    inspector(n, sim) {
      const s = n.st; let h = '<dl class="kv"><dt>роль</dt><dd>' + (isCoord(sim, n.id) ? 'координатор' : 'участник') + '</dd><dt>транзакция</dt><dd>#' + s.tx + '</dd><dt>состояние</dt><dd><b>' + (SN[s.s] || s.s) + '</b>' + (s.blocked ? ' — <span class="warn">заблокирован</span>' : '') + '</dd>' + (isCoord(sim, n.id) ? '<dt>голоса</dt><dd>' + (Object.keys(s.votes).map(k => k + ':' + (s.votes[k] ? 'да' : 'нет')).join(', ') || '—') + '</dd>' : '<dt>ответы коллег</dt><dd>' + (Object.keys(s.states || {}).map(k => k + ':' + s.states[k]).join(', ') || '—') + '</dd>') + '</dl>';
      return h + '<p class="mt sm">В состоянии «готов» участник уже не вправе откатить сам: он обещал коммит. Поэтому и возникает неопределённость.</p>';
    },
    metrics(sim) { const g = gl(sim); return [{ label: 'транзакций', value: g.tx }, { label: 'зафиксировано', value: g.commits }, { label: 'откачено', value: g.aborts }, { label: 'случаев блокировки', value: g.blocked }]; },
    invariants(sim) { const ss = sim.nodes.map(n => n.st.s); const c = ss.includes('committed'), a = ss.includes('aborted'); return [{ id: 'atomic', ok: !(c && a), text: 'Атомарность: нет узлов, зафиксировавших транзакцию, одновременно с узлами, откатившими её' }]; },
    defaultScheme() { return ND.makeScheme({ proto: 'twopc', n: 4, topo: 'star', lat: 250, names: ['Коорд.', 'Уч. 1', 'Уч. 2', 'Уч. 3'], title: '2PC: координатор и 3 участника' }); },
  });
  const mk = (title, o) => () => { const s = ND.makeScheme(Object.assign({ proto: 'twopc', n: 4, topo: 'full', lat: 250, names: ['Коорд.', 'Уч. 1', 'Уч. 2', 'Уч. 3'], title }, o)); return s; };
  ND.reg.templates.push(
    { id: 'twopc-ok', proto: 'twopc', title: '2PC: все согласны', desc: 'Выполните: do begin, run 6 — транзакция фиксируется на всех.', build: mk('2PC: успех', {}) },
    { id: 'twopc-no', proto: 'twopc', title: '2PC: один участник против', desc: 'У n3 голос «нет»: do begin — все откатываются.', build: mk('2PC: один «нет»', { cfgs: [{}, {}, { vote: 'no' }, {}] }) },
    { id: 'twopc-block', proto: 'twopc', title: '2PC: отказ координатора → блокировка', desc: 'Координатор отказывает после PREPARE: do begin, run 15 — участники в состоянии «готов» заблокированы. Переключите param mode 3pc (и reset) — решение находится.', build: mk('2PC: блокировка', { cfgs: [{ failAt: 'after_prepare' }] }) },
    { id: 'twopc-3pc', proto: 'twopc', title: '3PC: отказ координатора без блокировки', desc: 'Режим 3PC, координатор отказывает сразу после PREPARE: участники опрашивают друг друга и сами приходят к откату, не блокируясь (в отличие от 2PC).', build: mk('3PC: без блокировки', { params: { mode: '3pc' }, cfgs: [{ failAt: 'after_prepare' }] }) },
    { id: 'twopc-3pc-split', proto: 'twopc', title: '3PC: раздел сети ломает атомарность', desc: 'Режим 3PC, 5 узлов. Выполните: do begin, run 0.7, partition n1,n2 | n3,n4,n5, run 30 — группы решают по-разному (смотрите инварианты).', build: mk('3PC + раздел', { n: 5, params: { mode: '3pc', timeout: 2000 }, names: ['Коорд.', 'Уч. 1', 'Уч. 2', 'Уч. 3', 'Уч. 4'] }) },
    { id: 'twopc-split', proto: 'twopc', title: 'Решение сообщено одному (отказ после решения)', desc: 'Координатор сообщил commit только Уч.1 и отказал: остальные узнают решение через протокол завершения.', build: mk('2PC: частичная рассылка', { cfgs: [{ failAt: 'after_decision' }] }) });
})(typeof window !== 'undefined' ? window : globalThis);
