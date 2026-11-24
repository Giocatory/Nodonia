/* Протокол: PBFT — практическая византийская отказоустойчивость (n ≥ 3f+1): pre-prepare → prepare → commit, смена вида. */
(function (G) {
  'use strict';
  const ND = G.ND;
  const N = sim => sim.nodes.length, F = sim => Math.floor((N(sim) - 1) / 3), Q = sim => 2 * F(sim) + 1;
  const primaryId = (sim, v) => sim.nodes[v % N(sim)].id;
  const dg = v => ND.sha256(String(v)).slice(0, 6);
  const gl = sim => sim.G_pbft || (sim.G_pbft = { pp: {}, replies: {}, requests: [], viewChanges: 0, confirmed: [] });
  const byz = n => n.cfg.byz && n.cfg.byz !== 'none';
  const honest = sim => sim.nodes.filter(n => !byz(n));

  function entry(st, seq, view) { let e = st.log[seq]; if (!e || e.view < view) e = st.log[seq] = { view, val: null, d: null, prep: {}, com: {}, prepared: false, committed: false, sentCommit: false, executed: false }; return e; }
  function startVcTimer(ctx) { if (!ctx.hasTimer('vc')) ctx.timer('vc', ctx.params.viewTimeout * (ctx.st.vcBackoff || 1)); }
  function propose(ctx, val) {
    const st = ctx.st, sim = ctx.sim, g = gl(sim), seq = ++st.nextSeq, v = st.view, d = dg(val), mode = ctx.cfg.byz;
    if (mode === 'equivocate') {
      const bs = sim.nodes.filter(n => n.id !== ctx.id), half = Math.ceil(bs.length / 2);
      bs.forEach((n, i) => { const x = i < half ? val : val + '′'; (g.pp[n.id] = g.pp[n.id] || {})[seq] = dg(x); ctx.send(n.id, 'PP', { v, seq, val: x }); });
      bs.forEach((n, i) => { const dd = g.pp[n.id][seq]; ctx.send(n.id, 'PR', { v, seq, d: dd }); ctx.send(n.id, 'CM', { v, seq, d: dd }); });
      ctx.mark('византийский лидер рассылает РАЗНЫЕ значения разным узлам (seq ' + seq + ')', 'c-red'); return;
    }
    ctx.mark('лидер вида ' + v + ' присваивает запросу «' + val + '» номер ' + seq + ' (PRE-PREPARE)', 'c-gold');
    const e = entry(st, seq, v); e.val = val; e.d = d; for (const n of sim.nodes) if (n.id !== ctx.id) ctx.send(n.id, 'PP', { v, seq, val });
  }
  function onPP(ctx, from, b) {
    const st = ctx.st, sim = ctx.sim;
    if (b.v > st.view) { (st.fut = st.fut || []).push({ from, b }); if (st.fut.length > 50) st.fut.shift(); return; }
    if (b.v !== st.view || from !== primaryId(sim, b.v)) return;
    const e0 = st.log[b.seq]; if (e0 && e0.view === b.v && e0.d && e0.d !== dg(b.val)) { ctx.log('отвергает PRE-PREPARE: на номере ' + b.seq + ' уже другое значение'); return; }
    const e = entry(st, b.seq, b.v); if (e.d) return; e.val = b.val; e.d = dg(b.val); delete st.pend[dg(b.val)] && 0;
    ctx.mark('принял PRE-PREPARE: номер ' + b.seq + ', «' + b.val + '»; рассылает PREPARE', 'c-blue');
    e.prep[ctx.id] = e.d; sendAll(ctx, 'PR', { v: b.v, seq: b.seq, d: e.d }); check(ctx, b.seq);
  }
  function sendAll(ctx, type, body) {
    const sim = ctx.sim, g = gl(sim), mode = ctx.cfg.byz;
    for (const n of sim.nodes) if (n.id !== ctx.id) {
      let bb = body;
      if (mode === 'wrong') bb = Object.assign({}, body, { d: 'bad' + ctx.rng.int(100, 999) });
      else if (mode === 'equivocate' && g.pp[n.id] && g.pp[n.id][body.seq]) bb = Object.assign({}, body, { d: g.pp[n.id][body.seq] });
      ctx.send(n.id, type, bb);
    }
  }
  function check(ctx, seq) {
    const st = ctx.st, sim = ctx.sim, e = st.log[seq]; if (!e || !e.d) return;
    const cnt = (m) => Object.values(m).filter(d => d === e.d).length;
    if (!e.prepared && cnt(e.prep) >= 2 * F(sim) + (primaryId(sim, e.view) === ctx.id ? 0 : 0) && cnt(e.prep) >= Math.max(1, 2 * F(sim))) { e.prepared = true; ctx.mark('PREPARED: номер ' + seq + ' подтверждён 2f узлами → рассылает COMMIT', 'c-purple'); e.com[ctx.id] = e.d; e.sentCommit = true; sendAll(ctx, 'CM', { v: e.view, seq, d: e.d }); }
    if (e.prepared && !e.committed && cnt(e.com) >= Q(sim)) { e.committed = true; ctx.mark('COMMITTED: номер ' + seq + ' (2f+1 = ' + Q(sim) + ' подтверждений)', 'c-green'); execute(ctx); }
  }
  function execute(ctx) {
    const st = ctx.st, g = gl(ctx.sim);
    for (;;) {
      const e = st.log[st.lastExec + 1]; if (!e || !e.committed || e.executed) break;
      e.executed = true; st.lastExec++; st.executed.push(e.val); const d = dg(e.val); delete st.pend[d]; st.done[d] = 1;
      ctx.mark('ВЫПОЛНЯЕТ запрос #' + st.lastExec + ': «' + e.val + '» → ответ клиенту', 'c-green');
      const r = g.replies[d] = g.replies[d] || []; if (!r.includes(ctx.id)) r.push(ctx.id);
      const hon = r.filter(id => !byz(ctx.sim.byId[id])).length; if (hon >= F(ctx.sim) + 1 && !g.confirmed.includes(d)) g.confirmed.push(d);
    }
    if (!Object.keys(st.pend).length) { ctx.cancel('vc'); st.vcBackoff = 1; }
  }
  function startVC(ctx, nv) {
    const st = ctx.st, sim = ctx.sim; if (nv <= st.view || st.vcSent[nv]) return; st.vcSent[nv] = 1; st.inVC = nv;
    const prepared = []; for (const s in st.log) if (st.log[s].prepared) prepared.push({ seq: +s, val: st.log[s].val, view: st.log[s].view });
    ctx.mark('таймаут: лидер не справляется → требует СМЕНУ ВИДА на ' + nv, 'c-orange'); gl(sim).viewChanges++;
    (st.vcs[nv] = st.vcs[nv] || {})[ctx.id] = prepared; sendAll(ctx, 'VC', { nv, prepared });
    st.vcBackoff = (st.vcBackoff || 1) * 2; ctx.cancel('vc'); ctx.timer('vc', ctx.params.viewTimeout * st.vcBackoff); st.vcTarget = nv;
    tryNewView(ctx, nv);
  }
  function tryNewView(ctx, nv) {
    const st = ctx.st, sim = ctx.sim, vs = st.vcs[nv] || {}; if (Object.keys(vs).length < Q(sim) || primaryId(sim, nv) !== ctx.id || st.view >= nv || byz(ctx.node)) return;
    const best = {}; for (const id in vs) for (const p of vs[id]) if (!best[p.seq] || best[p.seq].view < p.view) best[p.seq] = p;
    const O = Object.keys(best).map(s => ({ seq: +s, val: best[s].val })).sort((a, b) => a.seq - b.seq);
    st.view = nv; st.inVC = 0; st.nextSeq = Math.max(st.nextSeq, ...O.map(o => o.seq), 0);
    ctx.mark('новый лидер вида ' + nv + ': собрал ' + Object.keys(vs).length + ' запросов смены вида; рассылает NEW-VIEW (' + O.length + ' записей переносится)', 'c-gold');
    for (const n of sim.nodes) if (n.id !== ctx.id) ctx.send(n.id, 'NV', { nv, O });
    for (const o of O) { const e = entry(st, o.seq, nv); if (e.executed) continue; e.val = o.val; e.d = dg(o.val); e.prep = { [ctx.id]: e.d }; }
    for (const d in st.pend) if (!O.some(o => dg(o.val) === d)) propose(ctx, st.pend[d]);
    ctx.cancel('vc'); if (Object.keys(st.pend).length) startVcTimer(ctx);
  }

  ND.registerProtocol({
    id: 'pbft', title: 'PBFT (византийский консенсус)', group: 'Консенсус', order: 12,
    short: 'Консенсус, устойчивый к злонамеренным узлам: при n ≥ 3f+1 честное большинство побеждает f предателей.',
    desc: '<p><b>PBFT</b> защищает от <i>византийских</i> отказов: узел может не просто молчать, но лгать и действовать согласованно с другими предателями. Условие: <b>n ≥ 3f + 1</b>, где f — число злонамеренных. Три фазы: <code>PRE-PREPARE</code> (лидер присваивает запросу номер), <code>PREPARE</code> (узлы подтверждают, что видели то же самое; нужно 2f подтверждений), <code>COMMIT</code> (2f+1 голосов — результат можно выполнять). Любые два кворума по 2f+1 пересекаются хотя бы в одном <b>честном</b> узле — отсюда безопасность.</p><p>Если лидер молчит или лжёт, узлы по таймеру требуют <b>смену вида (view change)</b> и выбирают нового лидера, перенося уже подготовленные запросы. Клиент принимает результат, когда получил <b>f+1 одинаковых ответов</b>.</p><p>Попробуйте: назначьте узлу «молчит» или «обманщик» (cfg.byz); сделайте лидером предателя и отправьте запрос; затем увеличьте число предателей до f+1 и сравните инварианты.</p>',
    legend: [{ c: 'c-gold', t: 'лидер вида' }, { c: 'c-blue', t: 'честный узел' }, { c: 'c-orange', t: 'смена вида' }, { c: 'c-green', t: 'выполнил запрос' }, { c: 'c-red', t: 'византийский' }, { c: 'c-gray', t: 'отказал' }],
    params: [{ id: 'viewTimeout', label: 'Таймаут смены вида, мс', type: 'number', def: 4000, min: 500, max: 60000, hint: 'сколько узел ждёт выполнения запроса, прежде чем потребовать нового лидера' }],
    nodeCfg: [{ id: 'byz', label: 'Поведение узла', type: 'select', def: 'none', options: [{ v: 'none', t: 'честный' }, { v: 'silent', t: 'молчит (игнорирует всё)' }, { v: 'wrong', t: 'лжёт (неверные дайджесты)' }, { v: 'equivocate', t: 'двуличный (разное разным)' }], hint: 'византийское поведение: узел нарушает протокол' }],
    actions: [{ id: 'request', label: 'Запрос клиента', args: [{ id: 'value', label: 'Операция', type: 'text', def: 'tx1' }], run(sim, a) { const v = String(a.value == null || a.value === '' ? 'tx' : a.value).slice(0, 12), g = gl(sim); g.requests.push(v); for (const n of sim.nodes) if (n.up) deliverReq(sim, n, v); return { text: 'клиент рассылает запрос «' + v + '» всем узлам' }; } }],
    init() { return { view: 0, nextSeq: 0, lastExec: 0, log: {}, executed: [], pend: {}, done: {}, vcs: {}, vcSent: {}, inVC: 0, vcBackoff: 1, vcTarget: 0 }; },
    onStart() { },
    onCrash(ctx) { ctx.st.pend = {}; },
    onTimer(ctx, name) { if (name === 'vc' && !byz(ctx.node) && Object.keys(ctx.st.pend).length) startVC(ctx, Math.max(ctx.st.view, ctx.st.vcTarget) + 1); },
    onMessage(ctx, m) {
      const st = ctx.st, sim = ctx.sim, b = m.body, mode = ctx.cfg.byz; if (mode === 'silent') return;
      if (m.type === 'PP') { if (mode === 'none' || !mode) onPP(ctx, m.from, b); else if (mode === 'equivocate') { const e = entry(st, b.seq, b.v); (gl(sim).pp[ctx.id] = gl(sim).pp[ctx.id] || {})[b.seq] = dg(b.val); const g2 = gl(sim); if (!g2.pp[ctx.id]['s' + b.seq]) { g2.pp[ctx.id]['s' + b.seq] = 1; if (!g2.pp[b.from_]) {} sendAll(ctx, 'PR', { v: b.v, seq: b.seq, d: dg(b.val) }); sendAll(ctx, 'CM', { v: b.v, seq: b.seq, d: dg(b.val) }); ctx.mark('предатель подтверждает КАЖДОМУ узлу то значение, которое тот получил от лидера', 'c-red'); } } }
      else if (m.type === 'PR') { if (mode && mode !== 'none') return; const e = entry(st, b.seq, b.v); if (e.view === b.v) { e.prep[m.from] = b.d; check(ctx, b.seq); } }
      else if (m.type === 'CM') { if (mode && mode !== 'none') return; const e = entry(st, b.seq, b.v); if (e.view === b.v) { e.com[m.from] = b.d; check(ctx, b.seq); } }
      else if (m.type === 'VC') {
        if (mode && mode !== 'none') return; (st.vcs[b.nv] = st.vcs[b.nv] || {})[m.from] = b.prepared;
        if (Object.keys(st.vcs[b.nv]).length >= F(sim) + 1 && b.nv > st.view && !st.vcSent[b.nv]) startVC(ctx, b.nv); else tryNewView(ctx, b.nv);
      } else if (m.type === 'NV') {
        if (mode && mode !== 'none') return; if (b.nv <= st.view || m.from !== primaryId(sim, b.nv)) return;
        st.view = b.nv; st.inVC = 0; ctx.mark('принял NEW-VIEW: вид ' + b.nv + ', лидер ' + m.from, 'c-blue'); ctx.cancel('vc'); { const fu = (st.fut || []).filter(x => x.b.v === b.nv); st.fut = (st.fut || []).filter(x => x.b.v > b.nv); fu.forEach(x => onPP(ctx, x.from, x.b)); }
        for (const o of b.O) { if (st.log[o.seq] && st.log[o.seq].executed) continue; const e = entry(st, o.seq, b.nv); e.val = o.val; e.d = dg(o.val); e.prep[ctx.id] = e.d; sendAll(ctx, 'PR', { v: b.nv, seq: o.seq, d: e.d }); check(ctx, o.seq); }
        st.nextSeq = Math.max(st.nextSeq, ...b.O.map(o => o.seq), 0); if (Object.keys(st.pend).length) startVcTimer(ctx);
      }
    },
    describe(m) {
      const b = m.body, x = m.from + ' → ' + m.to + ': ';
      return { PP: x + 'PRE-PREPARE (вид ' + b.v + ', № ' + b.seq + ', «' + b.val + '»)', PR: x + 'PREPARE (№ ' + b.seq + ', дайджест ' + b.d + ')', CM: x + 'COMMIT (№ ' + b.seq + ', дайджест ' + b.d + ')', VC: x + 'VIEW-CHANGE → вид ' + b.nv + ' (несу ' + b.prepared.length + ' подготовленных записей)', NV: x + 'NEW-VIEW: вид ' + b.nv + ', перенос ' + b.O.length + ' записей' }[m.type] || m.type;
    },
    label(m) { return { PP: 'PRE-PREP', PR: 'PREP', CM: 'COMMIT', VC: 'VIEW-CHG', NV: 'NEW-VIEW' }[m.type] || m.type; },
    badge(n, sim) { const s = n.st; return 'в' + s.view + ' · вып ' + s.lastExec + (byz(n) ? ' · ' + n.cfg.byz : ''); },
    nodeClass(n, sim) { const s = n.st; return !n.up ? 'c-gray' : byz(n) ? 'c-red' : s.inVC ? 'c-orange' : primaryId(sim, s.view) === n.id ? 'c-gold' : 'c-blue'; },
    inspector(n, sim) {
      const s = n.st; let h = '<dl class="kv"><dt>вид (view)</dt><dd>' + s.view + ' (лидер ' + sim.byId[primaryId(sim, s.view)].name + ')</dd><dt>выполнено</dt><dd>' + s.lastExec + '</dd><dt>ожидает</dt><dd>' + (Object.values(s.pend).map(ND.esc).join(', ') || '—') + '</dd></dl>';
      const ks = Object.keys(s.log).sort((a, b) => a - b); h += '<h4>Журнал</h4>' + (ks.length ? '<table class="tbl"><tr><th>№</th><th>вид</th><th>значение</th><th>prep</th><th>comm</th><th>статус</th></tr>' + ks.map(k => { const e = s.log[k], d = e.d; return '<tr><td>' + k + '</td><td>' + e.view + '</td><td>' + ND.esc(e.val) + '</td><td>' + Object.values(e.prep).filter(x => x === d).length + '/' + 2 * F(sim) + '</td><td>' + Object.values(e.com).filter(x => x === d).length + '/' + Q(sim) + '</td><td>' + (e.executed ? 'выполнен' : e.committed ? 'committed' : e.prepared ? 'prepared' : 'ждёт') + '</td></tr>'; }).join('') + '</table>' : '<p class="mt">пусто</p>');
      return h + '<p class="mt sm">Выполненные: ' + (s.executed.map(ND.esc).join(' → ') || '—') + '</p>';
    },
    metrics(sim) { const g = gl(sim), b = sim.nodes.filter(byz).length; return [{ label: 'допущение: византийских ≤ f', value: b + ' из допустимых ' + F(sim) + (b <= F(sim) ? ' ✔' : ' ✘ — гарантий нет') }, { label: 'кворум 2f+1', value: Q(sim) }, { label: 'смен вида', value: g.viewChanges }, { label: 'ответ клиенту получен (f+1)', value: g.confirmed.length + ' из ' + g.requests.length }]; },
    invariants(sim) {
      const hs = honest(sim); let ok = true;
      for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) { const A = hs[i].st.executed, B = hs[j].st.executed, L = Math.min(A.length, B.length); for (let k = 0; k < L; k++) if (A[k] !== B[k]) ok = false; }
      return [{ id: 'safety', ok, text: 'Безопасность: честные узлы выполняют запросы в одном и том же порядке (журналы совместимы)' }];
    },
    defaultScheme() { return ND.makeScheme({ proto: 'pbft', n: 4, topo: 'full', lat: 200, jit: 40, title: 'PBFT: 4 узла (f = 1)' }); },
  });
  function deliverReq(sim, n, v) {
    const ctx = sim.ctx(n), st = n.st, mode = n.cfg.byz; if (mode === 'silent') return; const d = dg(v); if (st.done[d]) return;
    st.pend[d] = v; if (mode && mode !== 'none' && mode !== 'equivocate') return;
    if (primaryId(sim, st.view) === n.id) { if (mode === 'equivocate' || !Object.values(st.log).some(e => e.d === d && e.view === st.view)) propose(ctx, v); }
    if (mode !== 'equivocate') startVcTimer(ctx);
  }
  const mk = (title, o) => () => ND.makeScheme(Object.assign({ proto: 'pbft', n: 4, topo: 'full', lat: 200, jit: 40, title }, o));
  ND.reg.templates.push(
    { id: 'pbft-4', proto: 'pbft', title: 'PBFT: 4 честных узла', desc: 'do request value=tx1, run 6 — три фазы и ответ клиенту.', build: mk('PBFT: 4 узла', {}) },
    { id: 'pbft-silent-leader', proto: 'pbft', title: 'PBFT: лидер молчит → смена вида', desc: 'n1 (лидер вида 0) молчит. do request value=tx1, run 30 — узлы по таймеру меняют вид, новый лидер n2 выполняет запрос.', build: mk('PBFT: молчащий лидер', { cfgs: [{ byz: 'silent' }] }) },
    { id: 'pbft-liar', proto: 'pbft', title: 'PBFT: 1 обманщик из 4 (в пределах f)', desc: 'n3 лжёт в PREPARE/COMMIT. Запрос всё равно выполняется честными узлами.', build: mk('PBFT: один лжец', { cfgs: [{}, {}, { byz: 'wrong' }, {}] }) },
    { id: 'pbft-equiv', proto: 'pbft', title: 'PBFT: двуличный лидер (f=1)', desc: 'n1 рассылает разные значения. Безопасность сохраняется (возможна смена вида).', build: mk('PBFT: двуличный лидер', { cfgs: [{ byz: 'equivocate' }] }) },
    { id: 'pbft-break', proto: 'pbft', title: 'PBFT: два предателя из 4 — безопасность рушится', desc: 'n1 и n2 двуличные при f=1. do request value=tx1, run 20 — смотрите инварианты.', build: mk('PBFT: f+1 предателей', { cfgs: [{ byz: 'equivocate' }, { byz: 'equivocate' }] }) },
    { id: 'pbft-7', proto: 'pbft', title: 'PBFT: 7 узлов, 2 предателя (f = 2)', desc: 'Кластер из 7 переживает двух византийских узлов.', build: mk('PBFT: 7 узлов', { n: 7, cfgs: [{}, { byz: 'wrong' }, {}, { byz: 'silent' }, {}, {}, {}] }) });
})(typeof window !== 'undefined' ? window : globalThis);
