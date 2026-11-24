/* Нодония — задания с автопроверкой. check(sim) вызывается симулятором в ходе эксперимента. */
(function (G) {
  'use strict';
  const ND = G.ND, tpl = id => () => ND.reg.templates.find(t => t.id === id).build();
  const up = s => s.nodes.filter(n => n.up);
  const inv = (s, p) => { const P = ND.reg.protocols[p]; return P.invariants ? P.invariants(s).every(i => i.ok) : true; };
  const lost = s => { const m = ND.reg.protocols.streamlog.metrics(s).find(x => /потеряно/.test(x.label)); return m ? +m.value : -1; };
  const T = (id, proto, level, title, text, scheme, goals, hints) => ND.reg.tasks.push({ id, title, proto, level, text, scheme, goals: goals.map(g => ({ t: g[0], w: g[1], check: g[2] })), hints });

  T('t-raft-failover', 'raft', 1, 'Raft: переживите отказ лидера', 'Кластер из 5 узлов выбрал лидера. Остановите лидера (на узле кнопка «Отказ» или команда <code>crash nX</code>) и дождитесь, пока кластер выберет нового.',
    () => ND.reg.protocols.raft.defaultScheme(),
    [['Был хотя бы один лидер', 1, s => Object.keys(s.G_raft ? s.G_raft.leaders : {}).length >= 1], ['Лидер был сменён: выбраны лидеры минимум двух разных термов', 2, s => Object.keys(s.G_raft ? s.G_raft.leaders : {}).length >= 2], ['Сейчас есть живой лидер и хотя бы один узел остановлен', 2, s => up(s).some(n => n.st.role === 'leader') && s.nodes.some(n => !n.up)]],
    ['Узел с ролью leader выделен цветом. Новые выборы начнутся после тайм-аута 150–300 мс (параметры electionMin/Max).', 'Нужно подождать 1–2 секунды виртуального времени: нажмите ▶ или команда <code>run 5</code>.']);
  T('t-raft-commit', 'raft', 1, 'Raft: зафиксируйте запись на большинстве', 'Отправьте команду <code>put</code> лидеру (действие «put» с ключом и значением). Дождитесь, чтобы запись попала в журнал и была зафиксирована (commit) минимум на трёх из пяти узлов.',
    () => ND.reg.protocols.raft.defaultScheme(),
    [['В журнале есть команда SET', 1, s => s.nodes.some(n => n.st.log.some(e => e.cmd && e.cmd.op === 'set'))], ['Запись зафиксирована (commit) минимум на 3 узлах', 3, s => s.nodes.filter(n => n.st.log.some((e, i) => e.cmd && e.cmd.op === 'set' && n.st.commit > i)).length >= 3], ['Нарушений инвариантов нет', 1, s => !s.violations.length]],
    ['Если лидера ещё нет, сначала запустите симуляцию на пару секунд.', 'Команда в консоли: <code>do put key=x value=1</code>.']);
  T('t-raft-heal', 'raft', 2, 'Raft: раздел сети и слияние', 'Разделите кластер на части 3 | 2 (команда <code>partition n1,n2,n3 | n4,n5</code> или кнопка раздела), подождите, затем восстановите связь (<code>heal</code>). В итоге все живые узлы должны оказаться в одном терме с единственным лидером.',
    () => ND.reg.protocols.raft.defaultScheme(),
    [['Терм вырос минимум до 2 (были выборы после раздела)', 1, s => Math.max(...s.nodes.map(n => n.st.term)) >= 2], ['Нет расхождения: все живые узлы в одном терме', 2, s => new Set(up(s).map(n => n.st.term)).size === 1], ['Ровно один лидер', 2, s => up(s).filter(n => n.st.role === 'leader').length === 1], ['Каналы восстановлены', 1, s => s.links.every(l => l.up)]],
    ['Меньшая часть (2 узла) не может выбрать лидера: ей нужно 3 голоса.', 'Если лидер был в меньшинстве, после слияния он узнает больший терм и уйдёт в follower.']);
  T('t-gossip-cheap', 'gossip', 2, 'Gossip: дошло до всех, но дёшево', 'Запустите слух (действие «rumor») и добейтесь, чтобы его узнали все 8 узлов, потратив не более 90 сообщений. Меняйте fanout, интервал и режим.',
    () => ND.reg.protocols.gossip.defaultScheme(),
    [['Слух r1 известен всем живым узлам', 3, s => s.G_gossip && up(s).every(n => n.st.known.r1 !== undefined)], ['Отправлено не более 90 сообщений', 3, s => s.stats.sent <= 90 && s.G_gossip && s.G_gossip.cnt >= 1]],
    ['Больше fanout — быстрее, но больше сообщений. Режим anti-entropy тратит трафик постоянно, rumor-mongering — пока слух «горячий».', 'Параметр stopAfter определяет, когда узел перестаёт распространять слух.']);
  T('t-paxos-livelock', 'paxos', 2, 'Paxos: победите дуэль пропоузеров', 'Два пропоузера одновременно предлагают разные значения и мешают друг другу. Включите случайную паузу (randomBackoff) и добейтесь, чтобы значение выбрали и узнали минимум 3 узла. Мало включить случайную паузу: у неё должен быть разброс (retryMin ≠ retryMax). Предложения: <code>do propose node=n1 value=A</code>, затем почти сразу <code>do propose node=n2 value=B</code>.',
    tpl('paxos-duel'), [['Решение известно минимум 3 узлам', 3, s => s.nodes.filter(n => n.st.decided !== null).length >= 3], ['Выбрано ровно одно значение', 2, s => s.G_paxos && s.G_paxos.chosen.length === 1], ['randomBackoff включён и retryMax заметно больше retryMin', 1, s => !!s.params.randomBackoff && s.params.retryMax >= s.params.retryMin + 300]],
    ['Параметры в левой панели «Протокол»: randomBackoff = вкл, retryMax, например, 1500. Затем <code>run 40</code>.', 'Случайность нужна, чтобы пропоузеры «разошлись» по времени.']);
  T('t-pbft-break', 'pbft', 3, 'PBFT: нарушьте безопасность', 'Сделайте двуличными (equivocate) двух из четырёх узлов (f=1, значит допущение нарушено) и отправьте запрос. Добейтесь нарушения инварианта безопасности.',
    () => ND.reg.protocols.pbft.defaultScheme(), [['Двое узлов — византийские', 1, s => s.nodes.filter(n => n.cfg && n.cfg.byz && n.cfg.byz !== 'none').length >= 2], ['Инвариант нарушен (честные узлы исполнили разные значения)', 4, s => s.violations.length > 0]],
    ['В панели узла выберите «Поведение узла» → двуличный; лучше n1 (лидер) и n2.', 'Запрос: <code>do request value=tx1</code>, затем <code>run 20</code>. Если не вышло с первой попытки, попробуйте другой seed (командой <code>seed 7</code>).']);
  T('t-quorum-strict', 'quorum', 2, 'Кворум: без устаревших чтений', 'N=3. Подберите R и W так, чтобы чтения не были устаревшими (R+W>N), при этом и R, и W не превышали 2 (иначе один упавший узел блокирует операции). Сделайте запись и несколько чтений.',
    tpl('q-weak'), [['R+W > N', 2, s => s.params.R + s.params.W > Math.min(s.params.N, s.nodes.length)], ['R ≤ 2 и W ≤ 2', 1, s => s.params.R <= 2 && s.params.W <= 2], ['Запись подтверждена, прочитано минимум 2 раза', 2, s => s.G_quorum && s.G_quorum.wOk >= 1 && s.G_quorum.reads >= 2], ['Устаревших чтений нет', 2, s => s.G_quorum && s.G_quorum.stale === 0]],
    ['Единственный вариант при N=3 и ограничении ≤2: R=2, W=2.', 'Действия: <code>do write node=n1 key=k value=A</code>, затем несколько <code>do read node=n4 key=k</code>.']);
  T('t-2pc-block', 'twopc', 2, '2PC: добейтесь блокировки', 'Поймайте двухфазную фиксацию в опасный момент: координатор падает после PREPARE, и участники остаются в неопределённости. Зафиксируйте хотя бы один случай блокировки.',
    () => ND.reg.protocols.twopc.defaultScheme(), [['Зафиксирован случай блокировки', 4, s => s.G_twopc && s.G_twopc.blocked >= 1], ['Режим 2PC', 1, s => s.params.mode === '2pc']],
    ['В панели координатора (n1) выберите «Отказ координатора: после PREPARE». Затем <code>do begin</code> и <code>run 10</code>.']);
  T('t-3pc-fix', 'twopc', 3, '3PC: тот же отказ без блокировки', 'Повторите отказ координатора после PREPARE, но в режиме 3PC. Участники должны завершить транзакцию сами, без блокировки.',
    tpl('twopc-block'), [['Включён режим 3PC', 2, s => s.params.mode === '3pc'], ['Участники завершили транзакцию сами (commit/abort), блокировок нет', 4, s => s.G_twopc && s.G_twopc.blocked === 0 && up(s).length >= 2 && up(s).filter(n => n.id !== 'n1').every(n => n.st.s === 'aborted' || n.st.s === 'committed')]],
    ['Параметр «Режим» → 3pc, затем <code>reset</code>, <code>do begin</code>, <code>run 15</code>.', 'Подсказка: 3PC добавляет фазу PRE-COMMIT; следите, чтобы termination-протокол был включён.']);
  T('t-pow-doublespend', 'pow', 3, 'PoW: выполните двойную трату', 'У узла n1 около 62% хэшрейта. Отправьте платёж, сразу запустите атаку и добейтесь, чтобы тайная цепь заменила честную.',
    tpl('pow-51'), [['Платёж отправлен', 1, s => s.G_pow && s.G_pow.txCount >= 1], ['Двойная трата удалась', 4, s => s.G_pow && s.G_pow.ds >= 1]],
    ['<code>do tx node=n2 id=pay1</code>, затем <code>do attack_start node=n1 tx=pay1</code>, затем <code>run 600</code>.', 'Если атака провалилась (dsFail), попробуйте другой seed.']);
  T('t-pos-slash', 'pos', 2, 'PoS: накажите двойное голосование', 'Заставьте валидатора проголосовать дважды за один слот и добейтесь, чтобы его залог был урезан (slashing).',
    tpl('pos-slash'), [['Зафиксировано двойное голосование', 2, s => s.G_pos && s.G_pos.slashEvents >= 1], ['Минимум один валидатор наказан', 2, s => s.G_pos && Object.keys(s.G_pos.slashed).length >= 1]],
    ['Голосование начинается с эпохи 1: сначала <code>run 40</code>. Потом действие «Двойное голосование (атака)» на любом узле и ещё <code>run 20</code>.']);
  T('t-svc-burst', 'services', 2, 'Монолит: переживите всплеск нагрузки', 'Запустите «Всплеск нагрузки ×3» на 10 секунд и измените конфигурацию приложения (воркеры, очередь) так, чтобы за весь эксперимент не было ни одной ошибки.',
    tpl('svc-monolith'), [['Всплеск запущен и закончился', 2, s => s.G_svc && s.G_svc.burst && s.now > s.G_svc.burst.until], ['Ни одной ошибки у клиента', 4, s => s.G_svc && s.G_svc.failed === 0 && s.G_svc.sent > 100]],
    ['Ёмкость = воркеры ÷ время обслуживания. Увеличьте workers у «Приложения».', 'Другой путь: увеличить очередь qmax, но задержка вырастет.']);
  T('t-svc-cascade', 'services', 3, 'Каскадный отказ: остановите retry storm', 'Сервис замедлился в 3 раза, а клиент ретраит каждый запрос. Измените политики (число ретраев, circuit breaker), чтобы нагрузка не росла лавиной.',
    tpl('svc-cascade'), [['Сервис замедлен', 1, s => s.nodes.some(n => n.kind === 'service' && n.cfg.slow > 1)], ['Ретраев не более 1', 2, s => s.params.retries <= 1 || s.params.breaker], ['Circuit breaker включён и сработал', 3, s => s.params.breaker && s.G_svc && s.G_svc.trips >= 1], ['Эксперимент идёт не менее 30 секунд', 1, s => s.now >= 30000]],
    ['Действие «Замедлить узел» ×3 на сервисе; затем параметр breaker.', 'Также jitter и backoff сглаживают повторы.']);
  T('t-log-acks', 'streamlog', 2, 'Лог: сохраните подтверждённые записи', 'Лидер партиции падает сразу после подтверждения. Выберите настройки, при которых ни одна подтверждённая запись не теряется.',
    tpl('sl-acks1'), [['acks = all', 2, s => s.params.acks === 'all' || s.params.acks === -1], ['Отказ узла произошёл', 1, s => s.nodes.some(n => !n.up)], ['Подтверждено минимум 5 записей и все инварианты выполнены', 3, s => s.G_sl && s.G_sl.acked.length >= 5 && lost(s) === 0]],
    ['Параметр acks → all. Затем crash на брокере-лидере.']);
  T('t-crdt-fix', 'crdt', 2, 'CRDT: починим расходящийся счётчик', 'Наивный счётчик теряет приращения при слиянии. Переключите тип данных на G-Counter, внесите приращения на разных репликах во время раздела и покажите, что после слияния значения совпали.',
    tpl('crdt-naive'), [['Тип данных не «наивный»', 2, s => s.params.mode !== 'naivecounter'], ['Выполнено минимум 6 операций', 1, s => s.G_crdt && s.G_crdt.ops >= 6], ['Все живые реплики сошлись', 3, s => { const m = ND.reg.protocols.crdt.metrics(s); return String(m[0].value).includes('✔'); }]],
    ['Параметр «Тип данных» → gcounter. Затем <code>partition n1,n2 | n3,n4</code>, <code>do inc node=n1</code>, <code>do inc node=n3</code>, <code>heal</code>, <code>run 10</code>.']);
  T('t-bully-failover', 'bully', 1, 'Bully: смена лидера', 'Остановите узел с наибольшим номером (он лидер) и дождитесь, пока выберут нового — следующего по старшинству.',
    () => ND.reg.protocols.bully.defaultScheme(), [['Остановлен хотя бы один узел', 1, s => s.nodes.some(n => !n.up)], ['Лидер среди живых единственный и все с ним согласны', 3, s => { const L = up(s).filter(n => n.st.leader === n.id); return L.length === 1 && up(s).every(n => n.st.leader === L[0].id); }], ['Новый лидер — не прежний старший узел', 2, s => { const L = up(s).filter(n => n.st.leader === n.id); return L.length === 1 && s.nodes.some(n => !n.up && n.id > L[0].id); }]],
    ['Лидер — узел с наибольшим id. Команда: <code>crash n5</code>, затем <code>run 10</code>.']);
  T('t-fd-tune', 'failure', 2, 'Детектор отказов: ноль ложных тревог', 'В «дрожащей» сети тайм-аут срабатывает ложно. Настройте детектор (таймаут или phi), чтобы не было ложных срабатываний, но настоящий отказ всё равно обнаруживался.',
    tpl('fd-jitter'), [['Реальный отказ произошёл и обнаружен', 2, s => s.nodes.some(n => !n.up) && s.G_fd && [].concat(...Object.values(s.G_fd.detect)).length > 0], ['Ложных срабатываний нет за 60 с', 4, s => s.now >= 60000 && s.G_fd && s.G_fd.falsePos === 0]],
    ['Увеличьте timeoutMs или переключитесь на режим phi.', 'Чем больше таймаут, тем дольше обнаруживается реальный отказ — это неустранимый компромисс.']);
})(typeof window !== 'undefined' ? window : globalThis);
