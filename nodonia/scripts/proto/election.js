/* Протоколы выбора лидера: Bully (задира) и Chang–Roberts (кольцо). */
(function (G) {
  'use strict';
  const ND = G.ND;
  const idx = (sim, id) => sim.nodes.indexOf(sim.byId[id]);
  const rank = (sim, id) => { const n = sim.byId[id], i = idx(sim, id); return ((n.cfg.prio > 0 ? n.cfg.prio : i + 1) * 100) + i; };
  const gl = (sim, k) => sim['G_' + k] || (sim['G_' + k] = { elections: 0, wins: 0 });
  const nodeCfg = [{ id: 'prio', label: 'Приоритет (0 — по номеру узла)', type: 'number', def: 0, min: 0, max: 99, hint: 'чем выше приоритет, тем охотнее узел становится лидером' }];

  function common(kind) {
    return {
      group: 'Консенсус', nodeCfg,
      legend: [{ c: 'c-gold', t: 'лидер' }, { c: 'c-orange', t: 'идут выборы' }, { c: 'c-blue', t: 'ведомый' }, { c: 'c-gray', t: 'отказал' }],
      init() { return { leader: null, since: 0, electing: false, gotOk: false, part: false, pend: null, deadline: 0, tTotal: 0 }; },
      onStart(ctx) { watch(ctx, true); },
      onRecover(ctx) { ctx.st.leader = null; ctx.st.part = false; watch(ctx, false); startElection(ctx, kind); },
      onCrash(ctx) { const st = ctx.st; st.leader = null; st.electing = false; st.gotOk = false; st.part = false; st.pend = null; st.deadline = 0; },
      badge(n) { const s = n.st; return (s.leader === n.id ? 'ЛИДЕР' : s.electing ? 'выборы…' : 'лидер: ' + (s.leader ? ND.reg.protocolsSim ? s.leader : s.leader : '?')); },
      nodeClass(n) { return !n.up ? 'c-gray' : n.st.leader === n.id ? 'c-gold' : (n.st.electing || n.st.part) ? 'c-orange' : 'c-blue'; },
      ring(n, sim) { if (!n.up || n.st.leader === n.id || !n.st.deadline) return null; return { frac: Math.max(0, Math.min(1, (n.st.deadline - sim.now) / n.st.tTotal)) }; },
      inspector(n, sim) { const s = n.st; return '<p><b>Приоритет:</b> ' + rank(sim, n.id) + ' · <b>известный лидер:</b> ' + (s.leader || '—') + (s.electing ? ' · <span class="warn">участвует в выборах</span>' : '') + (s.part ? ' · участник кольца' : '') + '</p>'; },
      metrics(sim) { const L = sim.nodes.filter(n => n.up && n.st.leader === n.id); return [{ label: 'лидеры', value: L.length ? L.map(n => n.name).join(', ') : 'нет' }, { label: 'выборов проведено', value: gl(sim, kind).elections }, { label: 'побед', value: gl(sim, kind).wins }, { label: 'сообщений', value: sim.stats.sent }]; },
      invariants(sim) {
        let ok = true; const comps = sim.components();
        for (const c of comps) { const L = c.filter(id => { const n = sim.byId[id]; return n.st.leader === id && sim.now - n.st.since > 3500; }); if (L.length > 1) ok = false; }
        return [{ id: 'one', ok, text: 'Не более одного устойчивого лидера в каждой связной части сети' }];
      },
      actions: [{ id: 'elect', label: 'Запустить выборы на узле', args: [{ id: 'node', label: 'Узел', type: 'node' }], run(sim, a) { const n = sim.byId[a.node || sim.nodes[0].id]; if (!n.up) return { text: 'узел отказал' }; startElection(sim.ctx(n), kind); return { text: n.name + ' инициировал выборы' }; } }],
    };
  }
  function watch(ctx, first) { const p = ctx.params, d = first ? ctx.rng.int(Math.floor(p.watch / 4), Math.floor(p.watch / 2)) : p.watch + ctx.rng.int(0, 300); ctx.timer('watch', d); ctx.st.deadline = ctx.now + d; ctx.st.tTotal = d; }
  function startElection(ctx, kind) { return kind === 'bully' ? bullyStart(ctx) : ringStart(ctx); }
  const params = [
    { id: 'watch', label: 'Таймаут ожидания лидера, мс', type: 'number', def: 2500, min: 500, max: 20000, hint: 'если пульс лидера не слышен столько времени, узел начинает выборы' },
    { id: 'hb', label: 'Пульс лидера, мс', type: 'number', def: 800, min: 100, max: 5000, hint: 'период рассылки heartbeat лидером' },
    { id: 'okWait', label: 'Ожидание ответа/ACK, мс', type: 'number', def: 1000, min: 200, max: 10000, hint: 'сколько ждать ответа OK (bully) или подтверждения соседа (ring)' },
  ];

  /* ---------------- Bully ---------------- */
  function higher(ctx) { return ctx.peers.filter(p => rank(ctx.sim, p) > rank(ctx.sim, ctx.id)); }
  function bullyStart(ctx) {
    const st = ctx.st; if (st.electing) return; st.electing = true; st.gotOk = false; st.leader = null; gl(ctx.sim, 'bully').elections++;
    ctx.mark('начинает выборы (bully)', 'c-orange'); const hi = higher(ctx);
    if (!hi.length) return bullyWin(ctx);
    for (const p of hi) ctx.send(p, 'ELECT', {}); ctx.timer('okwait', ctx.params.okWait);
  }
  function bullyWin(ctx) {
    const st = ctx.st; st.electing = false; st.leader = ctx.id; st.since = ctx.now; st.deadline = 0; gl(ctx.sim, 'bully').wins++; ctx.cancel('watch'); ctx.cancel('okwait'); ctx.cancel('coordwait');
    ctx.mark('становится ЛИДЕРОМ (старших живых нет)', 'c-gold'); ctx.bcast('COORD', {}); ctx.timer('hb', ctx.params.hb);
  }
  const bully = Object.assign(common('bully'), {
    id: 'bully', title: 'Bully (алгоритм задиры)', short: 'Лидер — живой узел с наибольшим приоритетом: младшие уступают старшим.', order: 20,
    desc: '<p><b>Алгоритм задиры</b> (Гарсиа-Молина): лидер — работающий процесс с наивысшим приоритетом. Заметив, что лидера нет, узел шлёт <code>ELECT</code> всем <i>старшим</i>. Если никто не ответил <code>OK</code> — он «задира» и объявляет себя лидером (<code>COORD</code>). Если ответил старший — младший ждёт: старший проведёт выборы сам.</p><p>Минус: при отказе и возврате самого старшего узла выборы проходят снова, а число сообщений порядка O(N²). Плюс: простота и быстрая сходимость.</p><p>Попробуйте: отказ лидера; возврат старшего узла (он сразу «отнимает» лидерство); раздел сети — в каждой части появится свой лидер (split-brain).</p>',
    params,
    onTimer(ctx, name) {
      const st = ctx.st;
      if (name === 'watch') { if (st.leader !== ctx.id) bullyStart(ctx); }
      else if (name === 'okwait') { if (st.electing && !st.gotOk) bullyWin(ctx); }
      else if (name === 'coordwait') { if (st.electing) { st.electing = false; ctx.log('COORD так и не пришёл — выборы заново'); bullyStart(ctx); } }
      else if (name === 'hb') { if (st.leader === ctx.id) { ctx.bcast('HB', {}); ctx.timer('hb', ctx.params.hb); } }
    },
    onMessage(ctx, m) {
      const st = ctx.st, sim = ctx.sim;
      if (m.type === 'ELECT') { ctx.send(m.from, 'OK', {}); if (!st.electing) { if (st.leader === ctx.id) { st.leader = null; } bullyStart(ctx); } }
      else if (m.type === 'OK') { st.gotOk = true; ctx.cancel('okwait'); ctx.timer('coordwait', ctx.params.okWait * 3); }
      else if (m.type === 'COORD') {
        if (st.leader === ctx.id && rank(sim, m.from) < rank(sim, ctx.id)) { ctx.send(m.from, 'COORD', {}); return; }
        if (st.leader === ctx.id) ctx.mark('уступает лидерство узлу ' + m.from, 'c-blue');
        st.leader = m.from; st.since = ctx.now; st.electing = false; ctx.cancel('hb'); ctx.cancel('okwait'); ctx.cancel('coordwait'); watch(ctx);
      } else if (m.type === 'HB') {
        if (st.leader === ctx.id) { if (rank(sim, m.from) > rank(sim, ctx.id)) { st.leader = m.from; st.since = ctx.now; ctx.cancel('hb'); ctx.mark('услышал пульс старшего лидера ' + m.from + ' — уступает', 'c-blue'); watch(ctx); } else ctx.send(m.from, 'COORD', {}); }
        else if (!st.leader || m.from === st.leader || rank(sim, m.from) > rank(sim, st.leader)) { if (st.leader !== m.from) st.since = ctx.now; st.leader = m.from; st.electing = false; watch(ctx); }
      }
    },
    describe(m) { return { ELECT: m.from + ' → ' + m.to + ': ELECT — «вы старше меня, вы живы?»', OK: m.from + ' → ' + m.to + ': OK — «я жив и старше, выборы теперь мои»', COORD: m.from + ' → ' + m.to + ': COORD — «я новый лидер»', HB: m.from + ' → ' + m.to + ': пульс лидера' }[m.type] || m.type; },
    label(m) { return m.type === 'HB' ? '♥' : m.type; },
    defaultScheme() { return ND.makeScheme({ proto: 'bully', n: 5, topo: 'full', lat: 200, jit: 30, title: 'Bully: 5 узлов' }); },
  });
  ND.registerProtocol(bully);

  /* ---------------- Ring (Chang–Roberts) ---------------- */
  function succ(ctx, off) { const L = ctx.sim.nodes, i = idx(ctx.sim, ctx.id); return L[(i + off) % L.length].id; }
  function fwd(ctx, type, body, off) {
    const st = ctx.st, N = ctx.sim.nodes.length; off = off || 1; if (off >= N) { st.pend = null; return; }
    const to = succ(ctx, off); st.pend = { type, body, off }; ctx.send(to, type, body); ctx.timer('ackwait', ctx.params.okWait);
  }
  function ringStart(ctx) {
    const st = ctx.st; if (st.part) return; st.part = true; st.electing = true; st.leader = null; gl(ctx.sim, 'ring').elections++;
    ctx.mark('инициирует выборы по кольцу, кладёт в сообщение свой приоритет', 'c-orange'); fwd(ctx, 'ELECTION', { cand: ctx.id });
  }
  const ring = Object.assign(common('ring'), {
    id: 'ring', title: 'Кольцо (Chang–Roberts)', short: 'Сообщение с приоритетами обходит кольцо; побеждает максимальный приоритет, O(N log N) в среднем.', order: 21,
    desc: '<p><b>Chang–Roberts</b>: узлы образуют логическое кольцо (порядок N1→N2→…→N1). Инициатор отправляет соседу сообщение <code>ELECTION(id)</code>. Получатель пересылает его дальше, если приоритет в сообщении выше, <b>подменяет</b> на свой, если он выше (и ещё не участвовал), и <b>гасит</b> сообщение иначе. Когда сообщение с твоим id вернулось — ты лидер и рассылаешь по кольцу <code>ELECTED</code>.</p><p>Каждая пересылка подтверждается <code>ACK</code>; если сосед не ответил, сообщение уходит следующему (так кольцо «залечивает» отказ узла). Сравните число сообщений с Bully на схеме из 8 узлов.</p>',
    params,
    onTimer(ctx, name) {
      const st = ctx.st;
      if (name === 'watch') { if (st.leader !== ctx.id) { st.part = false; ringStart(ctx); } }
      else if (name === 'ackwait') { if (st.pend) { ctx.log('сосед не ответил — сообщение уходит дальше по кольцу'); fwd(ctx, st.pend.type, st.pend.body, st.pend.off + 1); } }
      else if (name === 'hb') { if (st.leader === ctx.id) { ctx.bcast('HB', {}); ctx.timer('hb', ctx.params.hb); } }
    },
    onMessage(ctx, m) {
      const st = ctx.st, sim = ctx.sim, b = m.body;
      if (m.type === 'ELECTION' || m.type === 'ELECTED') ctx.send(m.from, 'ACK', {});
      if (m.type === 'ACK') { st.pend = null; ctx.cancel('ackwait'); }
      else if (m.type === 'ELECTION') {
        const mine = rank(sim, ctx.id), c = rank(sim, b.cand);
        if (b.cand === ctx.id) { st.part = false; st.electing = false; st.leader = ctx.id; st.since = ctx.now; st.deadline = 0; gl(sim, 'ring').wins++; ctx.cancel('watch'); ctx.mark('сообщение вернулось с его id — он ЛИДЕР', 'c-gold'); fwd(ctx, 'ELECTED', { leader: ctx.id }); ctx.timer('hb', ctx.params.hb); }
        else if (c > mine) { st.part = true; st.electing = true; fwd(ctx, 'ELECTION', b); }
        else if (!st.part) { st.part = true; st.electing = true; ctx.log('подменяет кандидата на себя (приоритет выше)'); fwd(ctx, 'ELECTION', { cand: ctx.id }); }
        else ctx.log('гасит сообщение кандидата ' + b.cand + ' (уже участвует с большим приоритетом)');
      } else if (m.type === 'ELECTED') {
        if (b.leader === ctx.id) return; st.leader = b.leader; st.since = ctx.now; st.part = false; st.electing = false; ctx.cancel('hb'); watch(ctx); fwd(ctx, 'ELECTED', b);
      } else if (m.type === 'HB') {
        if (st.leader === ctx.id) { if (rank(sim, m.from) > rank(sim, ctx.id)) { st.leader = m.from; st.since = ctx.now; ctx.cancel('hb'); watch(ctx); ctx.mark('услышал пульс старшего лидера — уступает', 'c-blue'); } }
        else { if (st.leader !== m.from) st.since = ctx.now; st.leader = m.from; st.electing = false; st.part = false; watch(ctx); }
      }
    },
    describe(m) { const b = m.body; return { ELECTION: m.from + ' → ' + m.to + ': ELECTION — в сообщении кандидат ' + (b && b.cand) + ' (идёт по кольцу)', ELECTED: m.from + ' → ' + m.to + ': ELECTED — лидер ' + (b && b.leader), ACK: m.from + ' → ' + m.to + ': ACK — получил, передаю дальше', HB: m.from + ' → ' + m.to + ': пульс лидера' }[m.type] || m.type; },
    label(m) { return m.type === 'HB' ? '♥' : m.type === 'ELECTION' ? 'ELECT ' + m.body.cand : m.type; },
    defaultScheme() { return ND.makeScheme({ proto: 'ring', n: 6, topo: 'ring', lat: 220, jit: 20, title: 'Кольцо: 6 узлов' }); },
  });
  ND.registerProtocol(ring);

  ND.reg.templates.push(
    { id: 'bully-8', proto: 'bully', title: 'Bully: 8 узлов, полная сеть', desc: 'Остановите лидера (N8) и посчитайте сообщения (вкладка «Инварианты и метрики»).', build: () => ND.makeScheme({ proto: 'bully', n: 8, topo: 'full', lat: 150, title: 'Bully: 8 узлов' }) },
    { id: 'bully-split', proto: 'bully', title: 'Bully: 6 узлов, два зала', desc: 'Выполните: partition n1,n2,n3 | n4,n5,n6 — в каждой части свой лидер; затем heal all.', build: () => ND.makeScheme({ proto: 'bully', n: 6, topo: 'full', lat: 180, title: 'Bully: раздел сети' }) },
    { id: 'ring-8', proto: 'ring', title: 'Кольцо: 8 узлов', desc: 'Сравните число сообщений с Bully; остановите узел внутри кольца и запустите выборы на соседнем.', build: () => ND.makeScheme({ proto: 'ring', n: 8, topo: 'ring', lat: 200, title: 'Кольцо: 8 узлов' }) },
    { id: 'ring-prio', proto: 'ring', title: 'Кольцо: свои приоритеты', desc: 'У N2 приоритет 50: он должен победить независимо от порядка в кольце.', build: () => ND.makeScheme({ proto: 'ring', n: 6, topo: 'ring', lat: 200, cfgs: [{}, { prio: 50 }, {}, {}, {}, {}], title: 'Кольцо: приоритет N2' }) });
})(typeof window !== 'undefined' ? window : globalThis);
