/* Нодония — сравнение протоколов на одном сценарии. Движок (ND.compare) не зависит от DOM и тестируется в Node.
   Один и тот же кластер из N узлов, одна и та же сеть, один и тот же seed и один и тот же запрос клиента —
   разные протоколы. Измеряем, за сколько виртуального времени и ценой скольких сообщений решение принято. */
(function (G) {
  'use strict';
  const ND = G.ND;
  const WARM = 8000;           // прогрев: лидер Raft избран, система «спокойна»
  const STEP = 25;             // шаг наблюдения, мс виртуального времени

  /* Адаптеры: как отправить запрос и как узнать, что узел «принял решение».
     primary(sim) — узел, который играет главную роль; retry — имеет ли смысл повтор запроса другому узлу. */
  const ADAPT = {
    raft: { label: 'Raft', proto: 'raft', retry: true, params: () => ({}),
      primary: sim => { const l = sim.nodes.find(n => n.up && n.st.role === 'leader'); return l ? l.id : sim.nodes[0].id; },
      submit: (sim, to) => sim.act('client', { id: 'put', args: { node: to, key: 'cmp', value: 'v' } }),
      decided: n => !!(n.st.sm && n.st.sm.cmp === 'v') },
    paxos: { label: 'Paxos', proto: 'paxos', retry: true, params: () => ({}),
      primary: sim => sim.nodes[0].id,
      submit: (sim, to) => sim.act('client', { id: 'propose', args: { node: to, value: 'A' } }),
      decided: n => n.st.decided !== null && n.st.decided !== undefined },
    pbft: { label: 'PBFT', proto: 'pbft', retry: false, params: () => ({}),
      primary: sim => sim.nodes[0].id,
      submit: sim => sim.act('client', { id: 'request', args: { value: 'tx1' } }),
      decided: n => !!(n.st.executed && n.st.executed.length >= 1) },
    twopc: { label: '2PC', proto: 'twopc', retry: false, params: () => ({ mode: '2pc' }),
      primary: sim => sim.nodes[0].id,
      submit: sim => sim.act('client', { id: 'begin', args: {} }),
      decided: n => n.st.s === 'committed', aborted: n => n.st.s === 'aborted', blocked: n => !!n.st.blocked },
    threepc: { label: '3PC', proto: 'twopc', retry: false, params: () => ({ mode: '3pc' }),
      primary: sim => sim.nodes[0].id,
      submit: sim => sim.act('client', { id: 'begin', args: {} }),
      decided: n => n.st.s === 'committed', aborted: n => n.st.s === 'aborted', blocked: n => !!n.st.blocked },
    quorum: { label: 'Кворумная запись', proto: 'quorum', retry: true, params: n => ({ N: Math.min(7, n), W: Math.floor(Math.min(7, n) / 2) + 1, R: Math.floor(Math.min(7, n) / 2) + 1 }),
      primary: sim => sim.nodes[0].id,
      submit: (sim, to) => sim.act('client', { id: 'write', args: { node: to, key: 'cmp', value: 'v' } }),
      decided: (n, sim) => !!(n.st.data && n.st.data.cmp && sim.G_quorum && sim.G_quorum.wOk > 0) },  // решение = клиент получил W подтверждений
  };

  /* Сценарии: сеть + отказы. at — момент отказа относительно запроса (доля задержки канала). */
  const SCENARIOS = {
    ok: { title: 'Здоровая сеть', text: 'Локальная сеть: 40±10 мс, без потерь, все узлы работают.', net: { lat: 40, jit: 10, loss: 0 } },
    lossy: { title: 'Потери сообщений 10%', text: 'Сеть теряет каждое десятое сообщение. Протоколы без повторной отправки зависят от таймаутов.', net: { lat: 40, jit: 10, loss: 0.1 } },
    wan: { title: 'Глобальная сеть (WAN)', text: 'Задержка 150±60 мс и 3% потерь — между дата-центрами разных континентов.', net: { lat: 150, jit: 60, loss: 0.03 } },
    crashPrimary: { title: 'Отказ главного узла сразу после запроса', text: 'Лидер (координатор, пропоузер) отказывает через 0,6 задержки канала: сообщения успели уйти, но ответы — нет.', net: { lat: 40, jit: 10, loss: 0 }, crash: 'primary' },
    crashMinor: { title: 'Отказ меньшинства узлов', text: 'Перед запросом отказывают k рядовых узлов (не главный). Хватит ли оставшегося большинства?', net: { lat: 40, jit: 10, loss: 0 }, crash: 'minor' },
    partition: { title: 'Раздел сети: большинство и меньшинство', text: 'Сеть делится на две части; главный узел — в большинстве. Меньшинство отрезано.', net: { lat: 40, jit: 10, loss: 0 }, part: 'major' },
    isolate: { title: 'Главный узел отрезан от всех', text: 'Лидер (координатор) изолирован сразу при запросе: остальные живы и связаны друг с другом.', net: { lat: 40, jit: 10, loss: 0 }, part: 'isolate' },
  };

  const med = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  /** Один прогон: протокол × сценарий × seed. */
  function runOne(pid, o) {
    const A = ADAPT[pid], SC = SCENARIOS[o.scenario], n = o.n, seed = o.seed, horizon = (o.horizon || 30) * 1000;
    const scheme = ND.makeScheme({ proto: A.proto, n, topo: 'full', lat: SC.net.lat, jit: SC.net.jit, loss: SC.net.loss, seed, params: A.params(n), title: A.label + ': ' + SC.title });
    const sim = ND.newSim(scheme); sim.start();
    // прогрев — в здоровой сети: сценарий начинается с запроса клиента
    const savedLoss = scheme.links.map(l => l.loss); for (const l of sim.links) l.loss = 0;
    sim.runUntil(WARM); for (let i = 0; i < sim.links.length; i++) sim.links[i].loss = savedLoss[i];
    const t0 = sim.now, sent0 = sim.stats.sent, primary = A.primary(sim), ids = sim.nodes.map(x => x.id);
    const quorum = Math.floor(n / 2) + 1, k = Math.max(1, o.k || 1);
    const faults = [];
    if (SC.crash === 'minor') { const victims = ids.filter(id => id !== primary).slice(-k); victims.forEach(id => sim.act('crash', { node: id })); }
    if (SC.part === 'major') { const m = Math.floor(n / 2) + 1, grpA = [primary, ...ids.filter(id => id !== primary).slice(0, m - 1)], grpB = ids.filter(id => !grpA.includes(id)); sim.act('partition', { groups: [grpA, grpB] }); }
    if (SC.part === 'isolate') sim.act('partition', { groups: [[primary], ids.filter(id => id !== primary)] });
    A.submit(sim, primary);
    if (SC.crash === 'primary') faults.push({ at: t0 + Math.round(0.6 * SC.net.lat), run: () => sim.act('crash', { node: primary }) });
    if (o.retry && A.retry && (SC.crash === 'primary' || SC.part === 'isolate')) faults.push({ at: t0 + (o.retryMs || 6000), run: () => { const to = ids.find(id => id !== primary && sim.byId[id].up); if (to) A.submit(sim, to); } });
    faults.sort((a, b) => a.at - b.at);
    let tFirst = null, tQ = null, tAll = null, msgsQ = null, upAtEnd = 0;
    const end = t0 + horizon;
    while (sim.now < end) {
      const nxt = Math.min(end, sim.now + STEP);
      while (faults.length && faults[0].at <= nxt) { const f = faults.shift(); sim.runUntil(f.at); f.run(); }
      sim.runUntil(nxt);
      const up = sim.nodes.filter(x => x.up), dec = up.filter(x => A.decided(x, sim)).length;
      if (tFirst === null && dec >= 1) tFirst = sim.now - t0;
      if (tQ === null && dec >= quorum) { tQ = sim.now - t0; msgsQ = sim.stats.sent - sent0; }
      if (tAll === null && dec >= up.length && up.length) { tAll = sim.now - t0; }
      if (tAll !== null && tQ !== null) break;
    }
    const viol = sim.invariants().filter(x => !x.ok).map(x => x.text);
    const decided = tQ !== null, upN = sim.nodes.filter(x => x.up);
    const outcome = decided ? 'commit' : (A.aborted && upN.some(x => A.aborted(x)) ? 'abort' : (A.blocked && upN.some(x => A.blocked(x)) ? 'blocked' : 'none'));
    return { pid, seed, tFirst, tQ, tAll, msgsQ, msgsAll: sim.stats.sent - sent0, viol, decided, outcome, primary };
  }

  /** Сводка: протоколы × seeds → медианы, доля успеха, нарушения безопасности. */
  function compare(o) {
    const o2 = Object.assign({ n: 5, scenario: 'ok', seeds: 5, horizon: 30, k: 1, retry: false, retryMs: 6000, protos: Object.keys(ADAPT) }, o || {});
    const rows = [];
    for (const pid of o2.protos) {
      const runs = []; for (let s = 1; s <= o2.seeds; s++) runs.push(runOne(pid, Object.assign({}, o2, { seed: s })));
      const ok = runs.filter(r => r.decided);
      rows.push({ pid, label: ADAPT[pid].label, runs, ok: ok.length, total: runs.length, tFirst: med(runs.filter(r => r.tFirst !== null).map(r => r.tFirst)), tQ: med(ok.map(r => r.tQ)), tAll: med(runs.filter(r => r.tAll !== null).map(r => r.tAll)), msgs: med(ok.map(r => r.msgsQ)), msgsAll: med(runs.map(r => r.msgsAll)), abort: runs.filter(r => r.outcome === 'abort').length, blocked: runs.filter(r => r.outcome === 'blocked').length, unsafe: runs.filter(r => r.viol.length).length, viol: [...new Set([].concat(...runs.map(r => r.viol)))] });
    }
    return { opts: o2, rows };
  }

  /** Рецепт для консоли симулятора: то же самое руками. */
  function recipe(pid, o) {
    const A = ADAPT[pid], SC = SCENARIOS[o.scenario], n = o.n, L = [];
    const ids = Array.from({ length: n }, (_, i) => 'n' + (i + 1)), m = Math.floor(n / 2) + 1;
    const req = { raft: 'do put node=<лидер> key=cmp value=v', paxos: 'do propose node=n1 value=A', pbft: 'do request value=tx1', twopc: 'do begin', threepc: 'do begin', quorum: 'do write node=n1 key=cmp value=v' }[pid];
    L.push('run 8   # прогрев: у Raft появится лидер');
    if (SC.crash === 'minor') L.push('crash ' + ids.slice(-Math.max(1, o.k || 1)).join(' '));
    if (SC.part === 'major') L.push('partition ' + ids.slice(0, m).join(',') + ' | ' + ids.slice(m).join(','));
    if (SC.part === 'isolate') L.push('partition n1 | ' + ids.slice(1).join(','));
    L.push(req);
    if (SC.crash === 'primary') L.push('at ' + (0.6 * SC.net.lat / 1000).toFixed(3) + ' crash n1');
    L.push('run 30', 'status', 'inv');
    return L;
  }

  ND.compare = { ADAPT, SCENARIOS, runOne, compare, recipe };

  /* ---------------- пояснения: почему результат именно такой ---------------- */
  const NOTES = {
    ok: {
      raft: 'Лидер фиксирует запись после ответа большинства (1 RTT), фолловеры узнают о фиксации со следующим пульсом — поэтому у «большинства» время больше, чем у «первого».',
      paxos: 'Два круга «Prepare/Promise» и «Accept/Accepted» — 2 RTT и больше сообщений: пропоузер каждый раз спрашивает всех.',
      pbft: 'Три фазы (pre-prepare, prepare, commit) и обмен «все со всеми» — O(n²) сообщений: плата за защиту от лжецов.',
      twopc: 'Один круг голосования и один круг решения: мало сообщений, но нужны ответы ВСЕХ участников.',
      threepc: 'Дополнительная фаза PRE-COMMIT: ещё один круг сообщений ради отсутствия блокировки.',
      quorum: 'Нет порядка и выбора лидера: запись просто уходит репликам, клиенту хватает W подтверждений. Дёшево, но это не консенсус.',
    },
    lossy: {
      raft: 'Лидер повторяет AppendEntries каждый пульс, потерянные сообщения восстанавливаются сами.',
      paxos: 'Достаточно ответов большинства, а пропоузер повторяет раунд по таймеру — потери почти незаметны.',
      pbft: 'Кворум 2f+1 из n перекрывает потери части сообщений; при тяжёлых потерях сработает смена вида.',
      twopc: 'Нет повторных отправок: потеряно любое из ~16 сообщений — по таймауту координатор откатывает транзакцию.',
      threepc: 'Как и 2PC: потеря голоса — откат по таймауту, но участники не блокируются.',
      quorum: 'Если потеряно слишком много подтверждений, запись по таймауту объявляется проваленной — клиент должен повторить.',
    },
    wan: {
      raft: 'Задержка линейно растёт: 1 RTT до фиксации. Выборы лидера дороже — таймауты нужно увеличивать под WAN.',
      paxos: '2 RTT: Paxos в WAN платит вдвое больше Raft с уже избранным лидером.',
      pbft: '3 фазы по задержке канала плюс разброс — самая медленная из «честных» схем.',
      twopc: 'Ждёт самый медленный канал из всех участников (хвост задержек), а потери откатывают транзакцию.',
      threepc: 'Лишняя фаза — лишняя задержка; потери откатывают транзакцию.',
      quorum: 'Ждёт только быстрейшие W ответов — один медленный узел не мешает.',
    },
    crashPrimary: {
      raft: 'Запись уже у фолловеров, но не зафиксирована. После таймаута выборов новый лидер фиксирует её — клиент ждёт ~2 с, данные не потеряны.',
      paxos: 'Единственный пропоузер отказал, а другого никто не запускал: решения нет, пока клиент не повторит запрос на другом узле (включите «повтор»).',
      pbft: 'Pre-prepare успел уйти; остальные узлы завершают фазы без лидера — запрос выполнен. При потере лидера до рассылки сработала бы смена вида.',
      twopc: 'Классическая блокировка 2PC: участники проголосовали «да» и не знают решения — ждут возвращения координатора.',
      threepc: 'Участники, не получив PRE-COMMIT, сами откатывают транзакцию: блокировки нет, но и коммита нет.',
      quorum: 'Координатор отказал до подтверждения — клиент не получил ответа (данные могли записаться). Нужно повторить запрос на другом узле.',
    },
    crashMinor: {
      raft: 'Большинство живо — лидер продолжает работать как ни в чём не бывало.',
      paxos: 'Достаточно ответов большинства: отказ меньшинства не мешает.',
      pbft: 'При k ≤ f отказ узлов не мешает: кворум 2f+1 по-прежнему собирается.',
      twopc: 'Один недоступный участник не отвечает на PREPARE — транзакция откатывается. 2PC требует единогласия.',
      threepc: 'То же, что у 2PC: единогласие обязательно, отказавший участник = откат.',
      quorum: 'W подтверждений из оставшихся узлов достаточно (при W ≤ числа живых реплик).',
    },
    partition: {
      raft: 'Лидер с большинством продолжает работать; меньшинство не может выбрать лидера (но шумит попытками выборов).',
      paxos: 'Раунд завершается на большинстве; меньшинство не решает ничего — безопасность сохраняется.',
      pbft: 'Нужно 2f+1 узлов в одной части; при n=4 группа из 3 узлов работает, меньшая — нет.',
      twopc: 'Участники по ту сторону раздела не ответят — откат. Атомарность сохранена ценой доступности.',
      threepc: 'Откат, как и в 2PC; но при другом моменте раздела 3PC может нарушить атомарность (см. лабораторную).',
      quorum: 'W подтверждений есть в большинстве — запись проходит, но реплики меньшинства устареют.',
    },
    isolate: {
      raft: 'Лидер потерял связь: запись лежит только у него и не фиксируется. Большинство выберет нового лидера, но клиент должен повторить запрос (включите «повтор»).',
      paxos: 'Пропоузер не достучался до большинства, решения нет. Повтор запроса на другом узле решает задачу.',
      pbft: 'Реплики не получили pre-prepare, срабатывает смена вида (view change) — новый лидер, запрос выполнен через таймаут.',
      twopc: 'Координатор не дозвонился до участников — откат по таймауту.',
      threepc: 'Откат по таймауту, как у 2PC.',
      quorum: 'Координатор не набирает W подтверждений — запись проваливается; повтор на другом узле проходит.',
    },
  };
  const SELECT = [['Лидерная репликация', 'Raft / Paxos / Multi-Paxos', 'доверяете всем узлам, нужен порядок команд и переживание f из 2f+1 отказов'], ['Византийская устойчивость', 'PBFT', 'узлы могут лгать, сеть закрытая, узлов десятки (O(n²) сообщений)'], ['Атомарная фиксация', '2PC / 3PC / Saga', 'надо применить транзакцию на нескольких ресурсах или откатить'], ['Кворумная репликация', 'W+R>N', 'нужна высокая доступность и нет жёсткой потребности в порядке — Dynamo-подобные хранилища']];

  /* ---------------- интерфейс ---------------- */
  if (!ND.ui || !ND.ui.registerWorkspace) return;
  const ui = ND.ui, h = ui.h, esc = ND.esc, K = ND.compare;
  const fmt = v => v == null ? '—' : v >= 1000 ? (v / 1000).toFixed(2).replace('.', ',') + ' с' : Math.round(v) + ' мс';
  let S = { scenario: 'crashPrimary', n: 5, seeds: 5, horizon: 30, k: 1, retry: false, retryMs: 6000, off: {} };
  ui.registerWorkspace({
    id: 'compare', title: 'Сравнение протоколов', group: 'Практика', order: 0, short: 'Один сценарий — шесть протоколов: Raft, Paxos, PBFT, 2PC, 3PC и кворумная запись; задержка, сообщения, отказоустойчивость.',
    mount(root) {
      const page = h('div', { class: 'page' }); root.append(page);
      const bar = h('div', { class: 'row', style: 'align-items:end;margin:10px 0;flex-wrap:wrap' }), out = h('div');
      const sc = Object.keys(K.SCENARIOS).map(k => ({ v: k, t: K.SCENARIOS[k].title }));
      const desc = h('p', { class: 'mt', style: 'max-width:860px' });
      const upd = () => { desc.innerHTML = '<b>Сценарий.</b> ' + esc(K.SCENARIOS[S.scenario].text); };
      bar.append(ui.field({ id: 'sc', label: 'Сценарий', type: 'select', options: sc }, S.scenario, v => { S.scenario = v; upd(); }),
        ui.field({ id: 'n', label: 'Узлов N', type: 'select', options: [4, 5, 7], hint: 'одинаковое число узлов для всех протоколов (PBFT требует N ≥ 4)' }, S.n, v => S.n = +v),
        ui.field({ id: 'k', label: 'Отказов k', type: 'number', def: 1, min: 1, max: 3, step: 1, hint: 'для сценария «Отказ меньшинства»: сколько рядовых узлов отказывает' }, S.k, v => S.k = v),
        ui.field({ id: 'seeds', label: 'Прогонов (seed)', type: 'number', def: 5, min: 1, max: 20, step: 1, hint: 'каждый прогон — свой seed ГПСЧ; в таблице медианы по прогонам' }, S.seeds, v => S.seeds = v),
        ui.field({ id: 'hz', label: 'Горизонт, с', type: 'number', def: 30, min: 5, max: 120, step: 5, hint: 'сколько виртуальных секунд ждать решения' }, S.horizon, v => S.horizon = v),
        ui.field({ id: 'retry', label: 'Клиент повторяет запрос на другом узле через 6 с', type: 'bool', hint: 'работает для Raft, Paxos и кворумной записи; PBFT и 2PC/3PC повтор не нужен или невозможен' }, S.retry, v => S.retry = v),
        h('button', { class: 'btn pri', text: '▶ Сравнить', onclick: () => run() }));
      const chips = h('div', { class: 'row', style: 'margin:4px 0 10px;flex-wrap:wrap' });
      Object.keys(K.ADAPT).forEach(pid => chips.append(ui.field({ id: pid, label: K.ADAPT[pid].label, type: 'bool' }, !S.off[pid], v => S.off[pid] = !v)));
      page.append(h('h2', { text: 'Сравнение протоколов на одном сценарии' }),
        h('p', { class: 'mt', style: 'max-width:860px', html: 'Одна и та же сеть, один и тот же seed и один и тот же запрос клиента — разные протоколы. Время — <b>виртуальное</b>, считается детерминированно. «Первое решение» — когда клиент узнаёт результат (у Raft — фиксация на лидере); «у большинства» — когда решение известно большинству узлов; сообщения считаются до этого момента.' }),
        bar, chips, desc, out); upd();
      function cell(r) {
        if (r.ok === r.total) return '<span class="ok">✔ ' + r.ok + '/' + r.total + '</span>';
        const parts = []; if (r.ok) parts.push('✔ ' + r.ok); if (r.abort) parts.push('↩ откат ' + r.abort); if (r.blocked) parts.push('⛔ блок ' + r.blocked); const none = r.total - r.ok - r.abort - r.blocked; if (none > 0) parts.push('✘ нет ' + none);
        return '<span class="' + (r.ok ? 'warn' : 'bad') + '">' + parts.join(' · ') + '</span>';
      }
      function bars(rows, key, label, fmtf) {
        const vals = rows.map(r => r[key]).filter(v => v != null), mx = Math.max(1, ...vals), best = vals.length ? Math.min(...vals) : null;
        return '<div class="card" style="min-width:280px;flex:1"><b>' + label + '</b>' + rows.map(r => '<div style="display:flex;align-items:center;gap:8px;margin:5px 0"><span style="width:118px;font-size:12px">' + esc(r.label) + '</span><div style="flex:1;background:var(--pn2);border-radius:4px;height:14px"><div style="height:14px;border-radius:4px;width:' + (r[key] == null ? 0 : Math.max(2, 100 * r[key] / mx)) + '%;background:' + (r[key] != null && r[key] === best ? 'var(--ok)' : 'var(--ac)') + '"></div></div><span style="width:64px;text-align:right;font-size:12px">' + (r[key] == null ? '—' : fmtf(r[key])) + '</span></div>').join('') + '</div>';
      }
      function run() {
        const protos = Object.keys(K.ADAPT).filter(p => !S.off[p]); if (!protos.length) { out.innerHTML = '<p class="bad">Выберите хотя бы один протокол.</p>'; return; }
        out.innerHTML = '<p class="mt">Считаю…</p>';
        setTimeout(() => {
          const res = K.compare({ scenario: S.scenario, n: S.n, seeds: S.seeds, horizon: S.horizon, k: S.k, retry: S.retry, retryMs: S.retryMs, protos }), rows = res.rows;
          const rowsH = rows.map(r => ['<b>' + esc(r.label) + '</b>', cell(r), fmt(r.tFirst), fmt(r.tQ), fmt(r.tAll), r.msgs == null ? '—' : Math.round(r.msgs), r.unsafe ? '<span class="bad">⚠ нарушена (' + r.unsafe + ')</span>' : '<span class="ok">✔</span>']);
          let html = ui.table(['Протокол', 'Решено в прогонах', 'Первое решение', 'У большинства', 'У всех живых', 'Сообщений до решения', 'Безопасность'], rowsH);
          html += '<div class="row" style="margin:12px 0;align-items:stretch;flex-wrap:wrap">' + bars(rows, 'tFirst', 'Время до первого решения', fmt) + bars(rows, 'msgs', 'Сообщений до решения', v => Math.round(v)) + '</div>';
          html += '<h3>Что видно в этом сценарии</h3><ul>' + rows.map(r => '<li><b>' + esc(r.label) + '.</b> ' + esc((NOTES[S.scenario] || {})[r.pid] || '') + '</li>').join('') + '</ul>';
          const win = rows.filter(r => r.ok === r.total && r.tFirst != null).sort((a, b) => a.tFirst - b.tFirst)[0], cheap = rows.filter(r => r.ok === r.total && r.msgs != null).sort((a, b) => a.msgs - b.msgs)[0], fail = rows.filter(r => r.ok < r.total);
          html += '<div class="callout"><b>Итог.</b> ' + (win ? 'Быстрее всех (среди стабильно решивших): <b>' + esc(win.label) + '</b> (' + fmt(win.tFirst) + '). ' : 'Ни один протокол не решил запрос во всех прогонах. ') + (cheap ? 'Меньше всего сообщений: <b>' + esc(cheap.label) + '</b> (' + Math.round(cheap.msgs) + '). ' : '') + (fail.length ? 'Не справились стабильно: ' + fail.map(r => esc(r.label)).join(', ') + '. ' : 'Все справились.') + ' Быстрее — не значит лучше: смотрите, какие гарантии даёт протокол (порядок, атомарность, защита от лжецов).</div>';
          html += '<h3>Повторить руками в симуляторе</h3><div class="cols">' + rows.map(r => { const rec = K.recipe(r.pid, res.opts); return '<div class="card"><b>' + esc(r.label) + '</b><pre style="white-space:pre-wrap;font-size:12px;margin:6px 0">' + esc(rec.join('\n')) + '</pre><button class="btn sm" data-open="' + r.pid + '">Открыть в симуляторе</button> <button class="btn sm" data-copy="' + r.pid + '">Копировать</button></div>'; }).join('') + '</div>';
          html += '<h3>Какой подход выбрать</h3>' + ui.table(['Задача', 'Протоколы', 'Когда подходит'], SELECT.map(x => x.map(esc)));
          out.innerHTML = html;
          out.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const pid = b.dataset.open, A = K.ADAPT[pid], SC = K.SCENARIOS[S.scenario]; ui.open('p:' + A.proto, { scheme: ND.makeScheme({ proto: A.proto, n: S.n, topo: 'full', lat: SC.net.lat, jit: SC.net.jit, loss: SC.net.loss, seed: 1, params: A.params(S.n), title: A.label + ': ' + SC.title }) }); });
          out.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { const t = K.recipe(b.dataset.copy, res.opts).join('\n'); const bad = () => { b.textContent = 'Выделите и скопируйте вручную'; }; try { navigator.clipboard.writeText(t).then(() => { b.textContent = 'Скопировано ✔'; }, bad); } catch (e) { bad(); } });
        }, 20);
      }
      run();
      return {};
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
