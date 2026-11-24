/* Протокол: Raft — консенсус на реплицируемом журнале (выбор лидера, репликация, коммит, безопасность). */
(function (G) {
  'use strict';
  const ND = G.ND;
  const lastIdx = st => st.log.length, lastTerm = st => st.log.length ? st.log[st.log.length - 1].term : 0, termAt = (st, i) => i <= 0 ? 0 : (st.log[i - 1] ? st.log[i - 1].term : -1);
  const maj = sim => Math.floor(sim.nodes.length / 2) + 1;
  const cmdText = c => !c ? '' : c.op === 'noop' ? 'no-op' : c.op === 'set' ? c.k + '=' + c.v : c.op === 'del' ? 'del ' + c.k : JSON.stringify(c);
  function gl(sim) { return sim.G_raft || (sim.G_raft = { leaders: {}, committed: {}, applied: {}, elections: 0, bad: {}, maxTerm: 0 }); }

  function resetElection(ctx) {
    const p = ctx.params, d = ctx.rng.int(p.electionMin, Math.max(p.electionMin, p.electionMax));
    ctx.timer('election', d); ctx.st.deadline = ctx.now + d; ctx.st.tTotal = d;
  }
  function toFollower(ctx, term, why) {
    const st = ctx.st, was = st.role;
    if (term > st.term) { st.term = term; st.votedFor = null; }
    if (was !== 'follower') { st.role = 'follower'; ctx.cancel('heartbeat'); ctx.mark('становится ФОЛЛОВЕРОМ (терм ' + st.term + (why ? ', ' + why : '') + ')', 'c-blue'); if (was === 'leader' || !ctx.hasTimer('election')) resetElection(ctx); }
  }
  function startElection(ctx) {
    const st = ctx.st; st.term++; st.role = 'candidate'; st.votedFor = ctx.id; st.votes = [ctx.id]; st.leader = null;
    gl(ctx.sim).maxTerm = Math.max(gl(ctx.sim).maxTerm, st.term);
    resetElection(ctx);
    ctx.mark('становится КАНДИДАТОМ: терм ' + st.term + ', просит голоса', 'c-orange');
    if (st.votes.length >= maj(ctx.sim)) return becomeLeader(ctx);
    ctx.bcast('RV', { term: st.term, lastIdx: lastIdx(st), lastTerm: lastTerm(st) });
  }
  function startPre(ctx) {
    const st = ctx.st; st.pre = [ctx.id]; resetElection(ctx);
    ctx.mark('пред-выборы (PreVote): проверяет, дадут ли голоса за терм ' + (st.term + 1), 'c-orange');
    if (st.pre.length >= maj(ctx.sim)) return startElection(ctx);
    ctx.bcast('PV', { term: st.term + 1, lastIdx: lastIdx(st), lastTerm: lastTerm(st) });
  }
  function becomeLeader(ctx) {
    const st = ctx.st, g = gl(ctx.sim); st.role = 'leader'; st.leader = ctx.id; st.next = {}; st.match = {}; st.ack = {};
    for (const p of ctx.peers) { st.next[p] = lastIdx(st) + 1; st.match[p] = 0; st.ack[p] = ctx.now; }
    ctx.cancel('election'); st.deadline = 0;
    g.elections++;
    if (g.leaders[st.term] && g.leaders[st.term] !== ctx.id) g.bad.election = true; else g.leaders[st.term] = ctx.id;
    for (const i in g.committed) { const c = g.committed[i]; if (termAt(st, +i) !== c.term) { g.bad.complete = true; ctx.log('⚠ у нового лидера нет закоммиченной записи #' + i, 'bad'); } }
    ctx.mark('становится ЛИДЕРОМ терма ' + st.term, 'c-gold');
    st.log.push({ term: st.term, cmd: { op: 'noop' } });
    broadcastAppend(ctx); ctx.timer('heartbeat', ctx.params.heartbeat);
  }
  function sendAppend(ctx, p) {
    const st = ctx.st, ni = st.next[p], prev = ni - 1, ents = st.log.slice(prev, prev + ctx.params.batch);
    ctx.send(p, 'AE', { term: st.term, prevIdx: prev, prevTerm: termAt(st, prev), entries: ents, commit: st.commit });
  }
  function broadcastAppend(ctx) { for (const p of ctx.peers) sendAppend(ctx, p); }
  function apply(ctx) {
    const st = ctx.st, g = gl(ctx.sim);
    while (st.applied < st.commit) {
      st.applied++; const e = st.log[st.applied - 1], c = e.cmd;
      if (c.op === 'set') st.sm[c.k] = c.v; else if (c.op === 'del') delete st.sm[c.k];
      const key = e.term + ':' + JSON.stringify(c), prev = g.applied[st.applied];
      if (prev === undefined) g.applied[st.applied] = key; else if (prev !== key) { g.bad.sm = true; ctx.log('⚠ расхождение: на индексе ' + st.applied + ' разные команды', 'bad'); }
    }
  }
  function advanceCommit(ctx) {
    const st = ctx.st, g = gl(ctx.sim);
    for (let n = lastIdx(st); n > st.commit; n--) {
      if (st.log[n - 1].term !== st.term) break;
      let c = 1; for (const p of ctx.peers) if (st.match[p] >= n) c++;
      if (c >= maj(ctx.sim)) { markCommitted(ctx, st.commit + 1, n); st.commit = n; ctx.mark('коммитит записи до индекса ' + n + ' (подтвердило ' + c + ' из ' + ctx.sim.nodes.length + ')', 'c-green'); apply(ctx); break; }
    }
  }
  function markCommitted(ctx, from, to) { const st = ctx.st, g = gl(ctx.sim); for (let i = from; i <= to; i++) { const e = st.log[i - 1]; const ex = g.committed[i]; if (!ex) g.committed[i] = { term: e.term, cmd: JSON.stringify(e.cmd) }; else if (ex.term !== e.term) g.bad.sm = true; } }
  function upToDate(st, m) { return m.lastTerm > lastTerm(st) || (m.lastTerm === lastTerm(st) && m.lastIdx >= lastIdx(st)); }

  function submit(sim, id, cmd, hops) {
    const n = sim.byId[id]; if (!n || !n.up) return { text: 'узел ' + id + ' недоступен — клиент не получил ответа (повторите запрос другому узлу)' };
    const st = n.st;
    if (st.role === 'leader') { st.log.push({ term: st.term, cmd }); const ctx = sim.ctx(n); ctx.mark('лидер принял команду клиента «' + cmdText(cmd) + '» → запись #' + lastIdx(st), 'c-gold'); broadcastAppend(ctx); if (!sim.nodes.length || sim.nodes.length === 1) advanceCommit(ctx); return { text: 'команда принята лидером ' + n.name + ' как запись #' + lastIdx(st) + '; клиенту ответят после коммита' }; }
    if (st.leader && st.leader !== id && (hops || 0) < 2) return submit(sim, st.leader, cmd, (hops || 0) + 1);
    return { text: n.name + ' не лидер и не знает лидера — клиент должен повторить запрос позже' };
  }

  ND.registerProtocol({
    id: 'raft', title: 'Raft (консенсус)', group: 'Консенсус', short: 'Выбор лидера и репликация журнала: команды применяются в одном порядке на всех узлах, пока жив большинство.',
    desc: '<p><b>Raft</b> делает из нескольких серверов один надёжный «отказоустойчивый компьютер». Время делится на <b>сроки (term)</b>. В каждом сроке не более одного <b>лидера</b>. Лидер принимает команды клиентов, дописывает их в журнал и рассылает <code>AppendEntries</code>; запись считается <b>закоммиченной</b>, когда её сохранило <b>большинство</b>. Если лидер молчит дольше случайного <b>election timeout</b>, фолловер становится кандидатом и собирает голоса (<code>RequestVote</code>).</p><p>Попробуйте: отказ лидера; раздел сети 2|3; «Принять команду» на фолловере; включите «unsafeVote», чтобы увидеть, какое правило защищает закоммиченные данные.</p>',
    legend: [{ c: 'c-gold', t: 'лидер' }, { c: 'c-orange', t: 'кандидат' }, { c: 'c-blue', t: 'фолловер' }, { c: 'c-gray', t: 'отказал' }],
    params: [
      { id: 'electionMin', label: 'Election timeout, мин мс', type: 'number', def: 1500, min: 200, max: 30000, hint: 'нижняя граница случайного таймера выборов' },
      { id: 'electionMax', label: 'Election timeout, макс мс', type: 'number', def: 3000, min: 200, max: 60000, hint: 'верхняя граница; разброс нужен, чтобы кандидаты не стартовали одновременно' },
      { id: 'heartbeat', label: 'Heartbeat, мс', type: 'number', def: 500, min: 50, max: 10000, hint: 'период пульса лидера (должен быть заметно меньше election timeout)' },
      { id: 'batch', label: 'Записей в одном AppendEntries', type: 'number', def: 8, min: 1, max: 100, hint: 'размер пакета репликации' },
      { id: 'preVote', label: 'PreVote (пред-выборы)', type: 'bool', def: false, hint: 'узел сначала проверяет, выиграет ли выборы, и не раздувает term при изоляции' },
      { id: 'checkQuorum', label: 'CheckQuorum', type: 'bool', def: false, hint: 'лидер уходит в отставку, если потерял связь с большинством' },
      { id: 'unsafeVote', label: '⚠ unsafeVote (сломать правило голосования)', type: 'bool', def: false, hint: 'голосовать за кандидата без проверки, что его журнал не отстаёт: нарушает безопасность' },
    ],
    actions: [
      { id: 'put', label: 'Записать ключ (SET)', args: [{ id: 'node', label: 'Узел', type: 'node' }, { id: 'key', label: 'Ключ', type: 'text', def: 'x' }, { id: 'value', label: 'Значение', type: 'text', def: '1' }], run(sim, a) { const key = String(a.key || 'x').slice(0, 12), value = String(a.value == null ? '' : a.value).slice(0, 12); return submit(sim, a.node || sim.nodes[0].id, { op: 'set', k: key, v: value }); } },
      { id: 'del', label: 'Удалить ключ (DEL)', args: [{ id: 'node', label: 'Узел', type: 'node' }, { id: 'key', label: 'Ключ', type: 'text', def: 'x' }], run(sim, a) { return submit(sim, a.node || sim.nodes[0].id, { op: 'del', k: String(a.key || 'x').slice(0, 12) }); } },
      { id: 'get', label: 'Прочитать ключ (GET с узла)', args: [{ id: 'node', label: 'Узел', type: 'node' }, { id: 'key', label: 'Ключ', type: 'text', def: 'x' }], run(sim, a) { const n = sim.byId[a.node || sim.nodes[0].id]; if (!n || !n.up) return { text: 'узел недоступен' }; const k = String(a.key || 'x'); return { text: 'GET ' + k + ' с узла ' + n.name + ' (' + n.st.role + ', терм ' + n.st.term + ') → ' + (n.st.sm[k] === undefined ? '∅ (нет значения)' : n.st.sm[k]) + (n.st.role === 'leader' && !simQuorum(sim, n) ? '  ⚠ узел считает себя лидером, но связи с большинством нет — чтение может быть устаревшим' : '') }; } },
    ],
    init(n) { return { role: 'follower', term: 0, votedFor: null, log: [], commit: 0, applied: 0, sm: {}, leader: null, votes: [], next: {}, match: {}, ack: {}, deadline: 0, tTotal: 0, pre: [], heard: -1e9 }; },
    onStart(ctx) { resetElection(ctx); },
    onCrash(ctx) { const st = ctx.st; st.role = 'follower'; st.leader = null; st.commit = 0; st.applied = 0; st.sm = {}; st.next = {}; st.match = {}; st.votes = []; st.pre = []; st.deadline = 0; },
    onRecover(ctx) { resetElection(ctx); },
    onTimer(ctx, name) {
      const st = ctx.st;
      if (name === 'election') { if (st.role === 'leader') return; if (ctx.params.preVote) startPre(ctx); else startElection(ctx); }
      else if (name === 'heartbeat') {
        if (st.role !== 'leader') return;
        if (ctx.params.checkQuorum) { let c = 1; for (const p of ctx.peers) if (ctx.now - st.ack[p] <= ctx.params.electionMax) c++; if (c < maj(ctx.sim)) { ctx.mark('CheckQuorum: нет связи с большинством — лидер уходит в отставку', 'c-blue'); st.role = 'follower'; st.leader = null; resetElection(ctx); return; } }
        broadcastAppend(ctx); ctx.timer('heartbeat', ctx.params.heartbeat);
      }
    },
    onMessage(ctx, m) {
      const st = ctx.st, b = m.body, g = gl(ctx.sim);
      if (m.type === 'RV') {
        if (b.term < st.term) return ctx.send(m.from, 'RVR', { term: st.term, granted: false });
        if (b.term > st.term) toFollower(ctx, b.term, 'увидел больший терм');
        const ok = (st.votedFor === null || st.votedFor === m.from) && (ctx.params.unsafeVote || upToDate(st, b));
        if (ok) { st.votedFor = m.from; resetElection(ctx); ctx.mark('голосует за ' + m.from + ' в терме ' + st.term, 'c-blue'); }
        ctx.send(m.from, 'RVR', { term: st.term, granted: !!ok, why: ok ? '' : (st.votedFor !== null && st.votedFor !== m.from ? 'уже голосовал' : 'журнал кандидата отстаёт') });
      } else if (m.type === 'RVR') {
        if (b.term > st.term) return toFollower(ctx, b.term, 'увидел больший терм');
        if (st.role === 'candidate' && b.term === st.term && b.granted && !st.votes.includes(m.from)) { st.votes.push(m.from); ctx.log('получил голос от ' + m.from + ' (' + st.votes.length + '/' + maj(ctx.sim) + ')'); if (st.votes.length >= maj(ctx.sim)) becomeLeader(ctx); }
      } else if (m.type === 'PV') {
        const recent = ctx.now - st.heard < ctx.params.electionMin, ok = b.term > st.term && upToDate(st, b) && !recent && st.role !== 'leader';
        ctx.send(m.from, 'PVR', { term: st.term, granted: !!ok });
      } else if (m.type === 'PVR') {
        if (b.term > st.term) return toFollower(ctx, b.term, 'увидел больший терм');
        if (st.role !== 'leader' && b.granted && !st.pre.includes(m.from)) { st.pre.push(m.from); if (st.pre.length >= maj(ctx.sim)) { st.pre = []; startElection(ctx); } }
      } else if (m.type === 'AE') {
        if (b.term < st.term) return ctx.send(m.from, 'AER', { term: st.term, success: false, stale: true });
        if (b.term > st.term || st.role !== 'follower') toFollower(ctx, b.term, 'признал лидера ' + m.from);
        st.leader = m.from; st.heard = ctx.now; resetElection(ctx);
        if (b.prevIdx > 0 && termAt(st, b.prevIdx) !== b.prevTerm) {
          const ci = Math.min(lastIdx(st) + 1, b.prevIdx); ctx.log('отклоняет AppendEntries: нет записи #' + b.prevIdx + ' терма ' + b.prevTerm);
          return ctx.send(m.from, 'AER', { term: st.term, success: false, conflict: Math.max(1, Math.min(ci, lastIdx(st) + 1)) });
        }
        let i = b.prevIdx;
        for (const e of b.entries) { i++; if (st.log[i - 1] && st.log[i - 1].term !== e.term) { ctx.mark('обрезает журнал с #' + i + ' (конфликт термов)', 'c-orange'); st.log.length = i - 1; } if (!st.log[i - 1]) st.log.push(e); }
        const lastNew = b.prevIdx + b.entries.length;
        if (b.commit > st.commit) { const nc = Math.min(b.commit, lastNew); if (nc > st.commit) { markCommitted(ctx, st.commit + 1, nc); st.commit = nc; apply(ctx); } }
        ctx.send(m.from, 'AER', { term: st.term, success: true, match: lastNew });
      } else if (m.type === 'AER') {
        if (b.term > st.term) return toFollower(ctx, b.term, 'увидел больший терм');
        if (st.role !== 'leader' || b.term !== st.term) return;
        st.ack[m.from] = ctx.now;
        if (b.success) { if (b.match > st.match[m.from]) st.match[m.from] = b.match; st.next[m.from] = st.match[m.from] + 1; advanceCommit(ctx); if (st.next[m.from] <= lastIdx(st)) sendAppend(ctx, m.from); }
        else if (!b.stale) { st.next[m.from] = Math.max(1, Math.min(st.next[m.from] - 1, b.conflict || 1)); sendAppend(ctx, m.from); }
      }
    },
    describe(m, sim) {
      const b = m.body;
      switch (m.type) {
        case 'RV': return m.from + ' → ' + m.to + ': RequestVote — «проголосуйте за меня в терме ' + b.term + '» (мой журнал: #' + b.lastIdx + ', терм ' + b.lastTerm + ')';
        case 'RVR': return m.from + ' → ' + m.to + ': ' + (b.granted ? 'ГОЛОС ЗА' : 'ОТКАЗ' + (b.why ? ' (' + b.why + ')' : '')) + ' (мой терм ' + b.term + ')';
        case 'PV': return m.from + ' → ' + m.to + ': PreVote — «пойдёте ли вы за меня в терме ' + b.term + '?» (пробное, терм не растёт)';
        case 'PVR': return m.from + ' → ' + m.to + ': PreVote ' + (b.granted ? 'ДА' : 'НЕТ');
        case 'AE': return b.entries.length ? m.from + ' → ' + m.to + ': AppendEntries — записи #' + (b.prevIdx + 1) + '…#' + (b.prevIdx + b.entries.length) + ' (терм ' + b.term + ', commit ' + b.commit + ')' : m.from + ' → ' + m.to + ': heartbeat лидера (терм ' + b.term + ', commit ' + b.commit + ', prev #' + b.prevIdx + ')';
        case 'AER': return m.from + ' → ' + m.to + ': ' + (b.success ? 'записи сохранены до #' + b.match : (b.stale ? 'устаревший лидер: мой терм ' + b.term + ' больше' : 'журнал расходится — откатите nextIndex до #' + b.conflict));
      } return m.type;
    },
    label(m) { return { RV: 'RequestVote', RVR: m.body.granted ? 'голос +' : 'голос −', PV: 'PreVote', PVR: 'PreVote ' + (m.body.granted ? '+' : '−'), AE: m.body.entries.length ? 'Append' : '♥', AER: m.body.success ? 'ok' : 'отказ' }[m.type] || m.type; },
    badge(n) { const s = n.st; return { leader: 'Л', candidate: 'К', follower: 'Ф' }[s.role] + ' т' + s.term + ' #' + s.log.length; },
    nodeClass(n) { return !n.up ? 'c-gray' : { leader: 'c-gold', candidate: 'c-orange', follower: 'c-blue' }[n.st.role]; },
    ring(n, sim) { if (!n.up || n.st.role === 'leader' || !n.st.deadline) return null; return { frac: Math.max(0, Math.min(1, (n.st.deadline - sim.now) / n.st.tTotal)), label: 'до выборов' }; },
    inspector(n, sim) {
      const s = n.st; let h = '<p><b>Роль:</b> ' + { leader: 'лидер', candidate: 'кандидат', follower: 'фолловер' }[s.role] + ' · <b>терм</b> ' + s.term + ' · <b>голос отдан:</b> ' + (s.votedFor || '—') + ' · <b>лидер:</b> ' + (s.leader || '?') + '</p><p><b>commitIndex</b> ' + s.commit + ' · <b>applied</b> ' + s.applied + '</p>';
      h += '<h4>Журнал</h4><div class="logrow">' + (s.log.length ? s.log.map((e, i) => '<span class="le ' + (i + 1 <= s.commit ? 'cm' : '') + '" title="индекс ' + (i + 1) + ', терм ' + e.term + '"><i>' + (i + 1) + '</i><b>' + cmdText(e.cmd) + '</b><u>т' + e.term + '</u></span>').join('') : '<span class="mt">пуст</span>') + '</div><p class="mt">зелёные — закоммичены (на этом узле)</p>';
      h += '<h4>Состояние (key-value)</h4><div class="mono">' + (Object.keys(s.sm).length ? Object.keys(s.sm).map(k => ND.esc(k) + ' = ' + ND.esc(s.sm[k])).join('<br>') : '<span class="mt">пусто</span>') + '</div>';
      if (s.role === 'leader') h += '<h4>nextIndex / matchIndex</h4><table class="tbl"><tr><th>узел</th><th>next</th><th>match</th></tr>' + Object.keys(s.next).map(p => '<tr><td>' + p + '</td><td>' + s.next[p] + '</td><td>' + s.match[p] + '</td></tr>').join('') + '</table>';
      return h;
    },
    metrics(sim) { const g = gl(sim), L = sim.nodes.filter(n => n.up && n.st.role === 'leader'); return [{ label: 'лидеры сейчас', value: L.length ? L.map(n => n.name + ' (т' + n.st.term + ')').join(', ') : 'нет' }, { label: 'максимальный терм', value: Math.max(...sim.nodes.map(n => n.st.term)) }, { label: 'выборов выиграно', value: g.elections }, { label: 'сообщений', value: sim.stats.sent }]; },
    invariants(sim) {
      const g = gl(sim); let lm = true;
      for (let i = 0; i < sim.nodes.length && lm; i++) for (let j = i + 1; j < sim.nodes.length && lm; j++) {
        const A = sim.nodes[i].st.log, B = sim.nodes[j].st.log, L = Math.min(A.length, B.length);
        for (let k = L - 1; k >= 0; k--) if (A[k].term === B[k].term) { for (let q = 0; q <= k; q++) if (A[q].term !== B[q].term || JSON.stringify(A[q].cmd) !== JSON.stringify(B[q].cmd)) { lm = false; break; } break; }
      }
      return [
        { id: 'election', ok: !g.bad.election, text: 'Election Safety: в каждом терме не более одного лидера' },
        { id: 'logmatch', ok: lm, text: 'Log Matching: если два журнала содержат запись с тем же индексом и термом, журналы совпадают до неё' },
        { id: 'complete', ok: !g.bad.complete, text: 'Leader Completeness: каждый новый лидер содержит все закоммиченные записи' },
        { id: 'sm', ok: !g.bad.sm, text: 'State Machine Safety: на одном индексе никогда не применяются разные команды' },
      ];
    },
    defaultScheme() { return ND.makeScheme({ proto: 'raft', n: 5, topo: 'full', lat: 200, jit: 40, title: 'Raft: кластер из 5 узлов' }); },
  });
  function simQuorum(sim, n) { const c = sim.reachable(n.id); return c.size >= maj(sim); }
})(typeof window !== 'undefined' ? window : globalThis);
