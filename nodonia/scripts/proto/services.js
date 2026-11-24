/* Протокол «Поток запросов» (services): архитектура как граф сервисов. Клиенты создают нагрузку, балансировщики,
   сервисы, кэши, очереди и БД обрабатывают запросы с очередями, таймаутами, ретраями и предохранителями.
   Направление «вниз по потоку» определяется рангом типа узла: клиент < CDN < балансировщик < сервис(уровень) < очередь < кэш < БД. */
(function (G) {
  'use strict';
  const ND = G.ND;
  const RANK = n => ({ client: 0, cdn: 1, lb: 2, service: 3 + Math.min(2, Math.max(0, (n.cfg && n.cfg.tier) | 0)), queue: 3.5, cache: 5.5, db: 6 })[n.kind] ?? 3;
  const KINDS = [{ id: 'client', label: 'Клиент (нагрузка)' }, { id: 'lb', label: 'Балансировщик' }, { id: 'service', label: 'Сервис' }, { id: 'cache', label: 'Кэш' }, { id: 'db', label: 'База данных' }, { id: 'queue', label: 'Очередь' }, { id: 'cdn', label: 'CDN' }];
  const NAMES = { req: 'запрос', res: 'ответ', job: 'задание', ack: 'подтверждение' };
  const isCache = n => n.kind === 'cache' || n.kind === 'cdn';
  function g(sim) { return sim.G_svc || (sim.G_svc = { rid: 0, oid: 0, sent: 0, ok: 0, failed: 0, retries: 0, fail: {}, lat: [], series: [], burst: null, lastOk: 0, lastFail: 0, lastSent: 0, dbHits: 0, cacheHit: 0, cacheMiss: 0, trips: 0, async: 0, jobsDone: 0, dropped: 0 }); }
  const downs = (ctx) => { const me = RANK(ctx.node); return ctx.neighbors.filter(id => { const o = ctx.sim.byId[id]; return o && RANK(o) > me; }); };
  const cfgv = (ctx, k, d) => ctx.cfg[k] != null ? ctx.cfg[k] : d;
  const svcTime = ctx => { const m = cfgv(ctx, 'svcTime', ctx.node.kind === 'db' ? 20 : ctx.node.kind === 'cache' || ctx.node.kind === 'cdn' ? 2 : 50) * (cfgv(ctx, 'slow', 1)); return Math.max(1, m * (0.6 + 0.8 * ctx.rng.float())); };
  const workers = ctx => Math.max(1, cfgv(ctx, 'workers', ctx.node.kind === 'db' ? 8 : ctx.node.kind === 'cache' || ctx.node.kind === 'cdn' ? 64 : 4) | 0);
  const qmax = ctx => Math.max(0, cfgv(ctx, 'qmax', ctx.node.kind === 'db' ? 100 : 50) | 0);

  /* ---- предохранитель/здоровье цели ---- */
  function brOn(ctx) { return ctx.node.kind === 'lb' ? !!ctx.params.lbHealth || !!ctx.params.breaker : !!ctx.params.breaker; }
  function brOpen(ctx, to) { if (!brOn(ctx)) return false; const b = ctx.st.br[to]; if (!b || !b.open) return false; if (ctx.now >= b.until) { if (!b.half) { b.half = true; ctx.log('полуоткрытый предохранитель к ' + to + ': пробный запрос'); return false; } return true; } return true; }
  function brRec(ctx, to, ok) {
    if (!brOn(ctx)) return; const b = ctx.st.br[to] || (ctx.st.br[to] = { f: 0, open: false, until: 0, half: false });
    if (ok) { if (b.open) ctx.mark('предохранитель к ' + to + ' закрылся (успех)', 'c-green'); b.f = 0; b.open = false; b.half = false; return; }
    b.f++; const lim = ctx.node.kind === 'lb' && !ctx.params.breaker ? 3 : ctx.params.breakerFails;
    if (b.half || b.f >= lim) { if (!b.open || b.half) { ctx.mark('предохранитель к ' + to + ' ОТКРЫТ на ' + ctx.params.breakerMs + ' мс (' + b.f + ' подряд отказов)', 'c-red'); ctx.sim.G_svc.trips++; } b.open = true; b.half = false; b.until = ctx.now + ctx.params.breakerMs; }
  }
  function pick(ctx, targets, key) {
    const st = ctx.st, pol = cfgv(ctx, 'policy', 'rr'); if (!targets.length) return null;
    const ok = targets.filter(t => !brOpen(ctx, t)); const T = ok.length ? ok : null; if (!T) return null;
    if (pol === 'hash') { const all = targets.slice().sort(); return all[ND.hash32(String(key)) % all.length]; }
    if (pol === 'random') return T[ctx.rng.int(0, T.length - 1)];
    if (pol === 'least') { let b = T[0], bn = 1e9; for (const t of T) { const c = Object.values(st.pend).filter(p => p.to === t).length; if (c < bn) { bn = c; b = t; } } return b; }
    st.rr = (st.rr || 0) + 1; return T[st.rr % T.length];
  }
  const reply = (ctx, to, id, ok, err, extra) => ctx.send(to, 'res', Object.assign({ id, ok, err: err || '' }, extra));

  /* ---- пересылка вниз ---- */
  function forward(ctx, job, targets) {
    const st = ctx.st, to = pick(ctx, targets, job.key);
    if (!to) { reply(ctx, job.from, job.id, false, 'breaker'); return; }
    st.pend[job.id] = { up: job.from, to, t: ctx.now, key: job.key, group: job.group };
    ctx.send(to, 'req', { id: job.id, key: job.key });
    ctx.timer('to' + job.id, ctx.params.hopTimeout);
  }

  /* ---- работа узла ---- */
  function admit(ctx, job) {
    const st = ctx.st;
    if (st.busy < workers(ctx)) start(ctx, job);
    else if (st.q.length < qmax(ctx)) st.q.push(job);
    else { st.rej++; reply(ctx, job.from, job.id, false, 'queue_full'); }
  }
  function start(ctx, job) { ctx.st.busy++; ctx.st.work[job.id] = job; ctx.timer('w' + job.id, svcTime(ctx)); }
  function finish(ctx, id) {
    const st = ctx.st, job = st.work[id]; if (!job) return; delete st.work[id]; st.busy--; st.served++;
    after(ctx, job);
    while (st.busy < workers(ctx) && st.q.length) start(ctx, st.q.shift());
  }
  function after(ctx, job) {
    const n = ctx.node, sim = ctx.sim, G_ = g(sim);
    if (job.job) { // асинхронное задание из очереди
      if (ctx.rng.chance(cfgv(ctx, 'failRate', 0))) { ctx.send(job.from, 'ack', { id: job.id, ok: false }); return; }
      G_.jobsDone++; const ds = downs(ctx).filter(t => sim.byId[t].kind === 'db'); if (ds.length) { /* запись в БД без ожидания */ ctx.send(ds[0], 'job', { id: job.id }); }
      ctx.send(job.from, 'ack', { id: job.id, ok: true }); return;
    }
    if (ctx.rng.chance(cfgv(ctx, 'failRate', 0))) return reply(ctx, job.from, job.id, false, 'error');
    if (n.kind === 'db') { G_.dbHits++; return reply(ctx, job.from, job.id, true, ''); }
    const ds = downs(ctx);
    if (isCache(n)) {
      const now = ctx.now, e = st(ctx).keys[job.key];
      if (e !== undefined && e > now) { G_.cacheHit++; ctx.st.hits++; return reply(ctx, job.from, job.id, true, '', { hit: true }); }
      G_.cacheMiss++; ctx.st.miss++;
      if (!ds.length) return reply(ctx, job.from, job.id, true, '');
      if (ctx.params.coalesce) { const w = ctx.st.waiting[job.key]; if (w) { w.push(job); return; } ctx.st.waiting[job.key] = [job]; job = Object.assign({}, job, { group: job.key }); }
      return forward(ctx, job, ds);
    }
    // сервис
    const q = ds.filter(t => sim.byId[t].kind === 'queue');
    if (q.length) { const to = pick(ctx, q, job.key); if (to) { ctx.send(to, 'job', { id: job.id, key: job.key }); G_.async++; } return reply(ctx, job.from, job.id, true, '', { async: true }); }
    if (!ds.length) return reply(ctx, job.from, job.id, true, '');
    forward(ctx, job, ds);
  }
  const st = ctx => ctx.st;

  /* ---- клиент ---- */
  function clientRate(ctx) { const G_ = g(ctx.sim), b = G_.burst; return Math.max(0.01, cfgv(ctx, 'rps', 8) * (b && ctx.now < b.until ? b.mult : 1)); }
  function scheduleGen(ctx) { ctx.timer('gen', ctx.rng.exp(1000 / clientRate(ctx))); }
  function attempt(ctx, o) {
    const st = ctx.st, G_ = g(ctx.sim), ds = downs(ctx), to = pick(ctx, ds, o.key);
    const id = ++G_.rid; G_.sent++; st.sent++;
    if (!to) { handleFail(ctx, { orig: o.orig, n: o.n, key: o.key, t0: o.t0 }, 'breaker', null); return; }
    st.pend[id] = { orig: o.orig, n: o.n, key: o.key, t0: o.t0, to };
    ctx.send(to, 'req', { id, key: o.key }); ctx.timer('to' + id, ctx.params.timeout);
  }
  function handleFail(ctx, p, reason, to) {
    const st = ctx.st, G_ = g(ctx.sim); if (to) brRec(ctx, to, false);
    if (p.n <= ctx.params.retries) {
      let d = ctx.params.backoff * Math.pow(2, p.n - 1); if (ctx.params.jitter) d = ctx.rng.float() * d;
      G_.retries++; st.retry[p.orig] = { orig: p.orig, n: p.n + 1, key: p.key, t0: p.t0 }; ctx.timer('rt' + p.orig, Math.max(1, d));
    } else { G_.failed++; st.fail++; G_.fail[reason] = (G_.fail[reason] || 0) + 1; }
  }
  function pct(arr, p) { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
  function sample(ctx) {
    const G_ = g(ctx.sim), now = ctx.now; G_.lat = G_.lat.filter(x => x[0] > now - 10000); const L = G_.lat.map(x => x[1]);
    G_.series.push({ t: Math.round(now / 1000), rps: G_.sent - G_.lastSent, ok: G_.ok - G_.lastOk, fail: G_.failed - G_.lastFail, p50: Math.round(pct(L, .5)), p95: Math.round(pct(L, .95)), p99: Math.round(pct(L, .99)) });
    G_.lastSent = G_.sent; G_.lastOk = G_.ok; G_.lastFail = G_.failed; if (G_.series.length > 300) G_.series.shift(); ctx.timer('samp', 1000);
  }
  const firstClient = sim => sim.nodes.find(n => n.kind === 'client');

  function mk(o) {
    o = o || {}; const kinds = o.kinds, n = kinds.length, pos = o.pos || ND.layout.circle(n, 380, 250, 200);
    const nodes = kinds.map((k, i) => { const c = Object.assign({}, (o.cfg || {})[i]); return { id: 'n' + (i + 1), name: (o.names || [])[i] || ({ client: 'Клиент', lb: 'LB', service: 'Сервис', cache: 'Кэш', db: 'БД', queue: 'Очередь', cdn: 'CDN' }[k] + (kinds.filter((x, j) => x === k && j < i).length ? ' ' + (kinds.filter((x, j) => x === k && j <= i).length) : '')), x: pos[i][0], y: pos[i][1], kind: k, cfg: c }; });
    const links = (o.links || []).map(p => ({ a: 'n' + (p[0] + 1), b: 'n' + (p[1] + 1), lat: p[2] || o.lat || 30 }));
    return ND.cleanScheme({ proto: 'services', title: o.title, notes: o.notes, seed: o.seed || 1, params: o.params, nodes, links });
  }

  const P = ND.registerProtocol({
    id: 'services', title: 'Поток запросов (архитектуры)', group: 'Архитектуры', order: 10,
    short: 'Клиенты, балансировщики, сервисы, кэши, очереди и БД: смотрим, как система переживает нагрузку, сбои и ретраи.',
    desc: '<p>Схема — это <b>архитектура</b>: стрелки запроса идут слева направо по рангу узлов (клиент → CDN → балансировщик → сервис → очередь → кэш → БД). Клиенты создают пуассоновский поток запросов; у каждого узла есть <b>воркеры</b>, <b>время обслуживания</b> и <b>очередь</b>. Когда очередь заполнена, узел отвергает запрос (<i>backpressure</i>), а клиент ждёт ответа до <b>таймаута</b> и может <b>повторить</b> запрос.</p><p>Включайте <b>ретраи</b>, <b>circuit breaker</b>, <b>single-flight</b> у кэша, меняйте политику балансировки и нажимайте «Всплеск нагрузки». На вкладке «Инварианты и метрики» — RPS, ошибки и задержки p50/p95/p99 за последние 10 с; у клиента в панели узла — график по секундам.</p><p class="mt sm">Цвет узла: зелёный — загрузка &lt; 50 %, золотой — &lt; 80 %, оранжевый — до насыщения, красный — очередь полна или отказы.</p>',
    legend: [{ c: 'c-green', t: 'свободен' }, { c: 'c-gold', t: 'нагружен' }, { c: 'c-orange', t: 'почти насыщен' }, { c: 'c-red', t: 'насыщен' }, { c: 'c-gray', t: 'отказал' }],
    nodeKinds: KINDS,
    nodeCfg(n) {
      const k = n.kind;
      const pol = { id: 'policy', label: 'Политика выбора', type: 'select', def: 'rr', options: [{ v: 'rr', t: 'round-robin' }, { v: 'least', t: 'least-connections' }, { v: 'hash', t: 'хэш по ключу' }, { v: 'random', t: 'случайно' }], hint: 'как узел выбирает, к какому из нижестоящих узлов отправить запрос' };
      const w = { id: 'workers', label: 'Воркеры (параллелизм)', type: 'number', def: k === 'db' ? 8 : 4, min: 1, max: 256, hint: 'сколько запросов узел обрабатывает одновременно' }, t = { id: 'svcTime', label: 'Время обслуживания, мс', type: 'number', def: k === 'db' ? 20 : 50, min: 1, max: 20000, hint: 'среднее время обработки одного запроса' }, q = { id: 'qmax', label: 'Очередь, макс.', type: 'number', def: 50, min: 0, max: 100000, hint: 'сколько запросов может ждать; сверх этого — отказ queue_full (backpressure)' }, fr = { id: 'failRate', label: 'Доля ошибок (0…1)', type: 'number', def: 0, min: 0, max: 1, step: 0.01, hint: 'вероятность вернуть ошибку 5xx' }, sl = { id: 'slow', label: 'Замедление ×', type: 'number', def: 1, min: 0.1, max: 100, step: 0.1, hint: 'множитель времени обслуживания: имитация деградации' };
      if (k === 'client') return [{ id: 'rps', label: 'Запросов в секунду', type: 'number', def: 8, min: 0.1, max: 2000, hint: 'средняя интенсивность пуассоновского потока' }, { id: 'keys', label: 'Число разных ключей', type: 'number', def: 100, min: 1, max: 100000, hint: 'сколько разных объектов запрашивают' }, { id: 'skew', label: 'Перекос популярности', type: 'number', def: 1, min: 1, max: 8, step: 0.5, hint: '1 — все ключи равновероятны; больше — несколько «горячих» ключей' }, pol];
      if (k === 'lb') return [pol];
      if (k === 'service') return [w, t, q, fr, sl, pol, { id: 'tier', label: 'Уровень цепочки (0,1,2)', type: 'number', def: 0, min: 0, max: 2, step: 1, hint: 'запрос идёт от меньшего уровня к большему: так задаётся цепочка сервисов' }];
      if (k === 'db') return [w, t, q, fr, sl];
      if (k === 'cache' || k === 'cdn') return [{ id: 'maxKeys', label: 'Ёмкость, ключей', type: 'number', def: 50, min: 1, max: 100000, hint: 'при переполнении вытесняется самый старый ключ' }, t];
      if (k === 'queue') return [{ id: 'qmax', label: 'Ёмкость очереди', type: 'number', def: 1000, min: 1, max: 1000000 }, { id: 'prefetch', label: 'Заданий на потребителя', type: 'number', def: 4, min: 1, max: 100, hint: 'сколько заданий одновременно отдано одному потребителю' }];
      return [];
    },
    params: [
      { id: 'timeout', label: 'Таймаут клиента, мс', type: 'number', def: 2000, min: 50, max: 60000, hint: 'сколько клиент ждёт ответа' },
      { id: 'hopTimeout', label: 'Таймаут между узлами, мс', type: 'number', def: 1500, min: 50, max: 60000, hint: 'сколько узел ждёт ответа от нижестоящего; должен быть меньше таймаута клиента' },
      { id: 'retries', label: 'Повторов у клиента', type: 'number', def: 0, min: 0, max: 8, hint: 'ретраи при ошибке или таймауте' },
      { id: 'backoff', label: 'Базовая пауза ретрая, мс', type: 'number', def: 200, min: 1, max: 30000, hint: 'экспоненциальная: пауза удваивается с каждой попыткой' },
      { id: 'jitter', label: 'Jitter у ретраев', type: 'bool', def: false, hint: 'случайная доля паузы: клиенты не повторяют запросы синхронно' },
      { id: 'breaker', label: 'Circuit breaker', type: 'bool', def: false, hint: 'после нескольких отказов подряд узел перестаёт обращаться к цели на время охлаждения' },
      { id: 'breakerFails', label: 'Отказов до размыкания', type: 'number', def: 5, min: 1, max: 100 },
      { id: 'breakerMs', label: 'Охлаждение предохранителя, мс', type: 'number', def: 3000, min: 100, max: 60000 },
      { id: 'lbHealth', label: 'Проверка здоровья в LB', type: 'bool', def: true, hint: 'балансировщик исключает бэкенд после 3 отказов подряд' },
      { id: 'coalesce', label: 'Single-flight в кэше', type: 'bool', def: false, hint: 'при промахе только один запрос идёт в БД, остальные ждут (защита от cache stampede)' },
      { id: 'cacheTtl', label: 'TTL кэша, мс', type: 'number', def: 5000, min: 100, max: 600000 },
    ],
    actions: [
      { id: 'burst', label: 'Всплеск нагрузки', args: [{ id: 'mult', label: 'Во сколько раз', type: 'number', def: 3, min: 1, max: 50 }, { id: 'sec', label: 'На сколько секунд', type: 'number', def: 10, min: 1, max: 300 }], run(sim, a) { const G_ = g(sim); G_.burst = { mult: +a.mult || 3, until: sim.now + (+a.sec || 10) * 1000 }; return { text: 'нагрузка ×' + G_.burst.mult + ' до t = ' + ND.fmtT(G_.burst.until) }; } },
      { id: 'slowdown', label: 'Замедлить узел', args: [{ id: 'node', label: 'Узел', type: 'node' }, { id: 'factor', label: 'Во сколько раз', type: 'number', def: 5, min: 0.1, max: 100 }], run(sim, a) { const n = sim.byId[a.node]; if (!n) return { text: 'нет узла' }; n.cfg.slow = +a.factor || 1; return { text: n.name + ' замедлен в ' + n.cfg.slow + ' раз' }; } },
      { id: 'faulty', label: 'Включить долю ошибок на узле', args: [{ id: 'node', label: 'Узел', type: 'node' }, { id: 'rate', label: 'Доля (0…1)', type: 'number', def: 0.5, min: 0, max: 1 }], run(sim, a) { const n = sim.byId[a.node]; if (!n) return { text: 'нет узла' }; n.cfg.failRate = ND.clamp(+a.rate || 0, 0, 1); return { text: n.name + ': доля ошибок ' + n.cfg.failRate }; } },
    ],
    init(n, sim) { g(sim); return { busy: 0, q: [], work: {}, pend: {}, br: {}, rr: 0, served: 0, rej: 0, sent: 0, fail: 0, hits: 0, miss: 0, keys: {}, order: [], waiting: {}, retry: {}, depth: 0, inflight: {}, dispatched: 0, dropped: 0, got: 0 }; },
    onStart(ctx) { if (ctx.node.kind === 'client') { scheduleGen(ctx); if (firstClient(ctx.sim) === ctx.node) ctx.timer('samp', 1000); } },
    onCrash(ctx) { const st = ctx.st; Object.assign(st, { busy: 0, q: [], work: {}, pend: {}, br: {}, waiting: {}, retry: {}, inflight: {} }); },
    onRecover(ctx) { if (ctx.node.kind === 'client') { scheduleGen(ctx); if (firstClient(ctx.sim) === ctx.node) ctx.timer('samp', 1000); } else if (ctx.node.kind === 'cache' || ctx.node.kind === 'cdn') { ctx.st.keys = {}; ctx.st.order = []; } },
    onTimer(ctx, name) {
      const st = ctx.st, k = ctx.node.kind, G_ = g(ctx.sim);
      if (name === 'gen') {
        const key = 'k' + Math.floor(cfgv(ctx, 'keys', 100) * Math.pow(ctx.rng.float(), cfgv(ctx, 'skew', 1)));
        const orig = ++G_.oid; attempt(ctx, { orig, n: 1, key, t0: ctx.now }); scheduleGen(ctx);
      } else if (name === 'samp') sample(ctx);
      else if (name.startsWith('rt')) { const r = st.retry[+name.slice(2)]; if (r) { delete st.retry[r.orig]; attempt(ctx, r); } }
      else if (name.startsWith('w')) finish(ctx, name.slice(1));
      else if (name.startsWith('to')) {
        const id = name.slice(2), p = st.pend[id]; if (!p) return; delete st.pend[id];
        if (k === 'client') { ctx.log('таймаут запроса #' + id + ' (' + ctx.params.timeout + ' мс)'); handleFail(ctx, p, 'timeout', p.to); }
        else { brRec(ctx, p.to, false); ctx.log('таймаут ответа от ' + p.to + ' по запросу #' + id); failUp(ctx, p, id, 'timeout'); }
      } else if (name === 'disp') dispatch(ctx);
    },
    onMessage(ctx, m) {
      const st = ctx.st, k = ctx.node.kind, G_ = g(ctx.sim), b = m.body;
      if (m.type === 'req') {
        if (k === 'lb' || (k === 'cdn' && false)) { forward(ctx, { id: b.id, from: m.from, key: b.key }, downs(ctx)); return; }
        admit(ctx, { id: b.id, from: m.from, key: b.key });
      } else if (m.type === 'res') {
        if (k === 'client') {
          const p = st.pend[b.id]; if (!p) return; delete st.pend[b.id]; ctx.cancel('to' + b.id);
          if (b.ok) { brRec(ctx, p.to, true); const lat = ctx.now - p.t0; G_.ok++; st.ok = (st.ok || 0) + 1; G_.lat.push([ctx.now, lat]); } else handleFail(ctx, p, b.err || 'error', b.err === 'queue_full' ? null : p.to);
          return;
        }
        const p = st.pend[b.id]; if (!p) return; delete st.pend[b.id]; ctx.cancel('to' + b.id); brRec(ctx, p.to, !!b.ok || b.err === 'queue_full' && false);
        if (isCache(ctx.node) && b.ok) { const kk = p.key; if (st.keys[kk] === undefined) { st.order.push(kk); const mx = cfgv(ctx, 'maxKeys', 50); while (st.order.length > mx) delete st.keys[st.order.shift()]; } st.keys[kk] = ctx.now + ctx.params.cacheTtl; }
        if (p.group !== undefined && isCache(ctx.node)) { const w = st.waiting[p.group] || []; delete st.waiting[p.group]; for (const j of w) reply(ctx, j.from, j.id, b.ok, b.err); return; }
        reply(ctx, p.up, b.id, b.ok, b.err, b.hit ? { hit: true } : undefined);
      } else if (m.type === 'job') {
        if (k === 'queue') { if (st.q.length >= cfgv(ctx, 'qmax', 1000)) { st.dropped++; G_.dropped++; ctx.log('очередь переполнена: задание #' + b.id + ' потеряно'); return; } st.q.push({ id: b.id, key: b.key }); dispatch(ctx); }
        else if (k === 'db') { G_.dbHits++; } else admit(ctx, { id: b.id, from: m.from, key: b.key, job: true });
      } else if (m.type === 'ack') { if (k === 'queue') { st.inflight[m.from] = Math.max(0, (st.inflight[m.from] || 1) - 1); dispatch(ctx); } }
    },
    describe(m, sim) {
      const b = m.body, a = sim.byId[m.from] ? sim.byId[m.from].name : m.from, c = sim.byId[m.to] ? sim.byId[m.to].name : m.to;
      if (m.type === 'req') return a + ' → ' + c + ': запрос #' + b.id + ' (ключ ' + b.key + ')';
      if (m.type === 'res') return a + ' → ' + c + ': ответ на #' + b.id + ' — ' + (b.ok ? 'успех' + (b.hit ? ' (из кэша)' : '') + (b.async ? ' (принято асинхронно)' : '') : 'ОШИБКА «' + b.err + '»');
      if (m.type === 'job') return a + ' → ' + c + ': задание #' + b.id + (sim.byId[m.to] && sim.byId[m.to].kind === 'queue' ? ' поставлено в очередь' : ' на обработку');
      return a + ' → ' + c + ': ' + (b.ok ? 'задание #' + b.id + ' выполнено' : 'задание #' + b.id + ' провалено');
    },
    label(m) { return m.type === 'req' ? '#' + m.body.id : m.type === 'res' ? (m.body.ok ? 'ok' : m.body.err) : m.type; },
    badge(n) { const s = n.st; if (!s) return ''; if (n.kind === 'client') return (n.cfg.rps || 8) + ' rps · ok ' + (s.ok || 0) + ' ✗' + s.fail; if (n.kind === 'queue') return 'глубина ' + s.q.length; if (n.kind === 'lb') return Object.keys(s.pend).length + ' в пути'; if (isCache(n)) return 'hit ' + (s.hits + s.miss ? Math.round(100 * s.hits / (s.hits + s.miss)) : 0) + '%'; return s.busy + '/' + Math.max(1, n.cfg.workers || (n.kind === 'db' ? 8 : 4)) + ' оч ' + s.q.length; },
    nodeClass(n) {
      if (!n.up) return 'c-gray'; const s = n.st; if (n.kind === 'client') return 'c-teal'; if (n.kind === 'lb') return 'c-purple'; if (n.kind === 'queue') { const f = s.q.length / (n.cfg.qmax || 1000); return f > .9 ? 'c-red' : f > .5 ? 'c-orange' : f > .1 ? 'c-gold' : 'c-green'; }
      if (isCache(n)) return 'c-blue'; const w = n.cfg.workers || (n.kind === 'db' ? 8 : 4), qm = n.cfg.qmax != null ? n.cfg.qmax : (n.kind === 'db' ? 100 : 50), l = (s.busy + s.q.length) / w;
      if (s.q.length >= qm && qm > 0 || (s.rej > 0 && s.q.length > qm * .8)) return 'c-red'; return l < .5 ? 'c-green' : l < .8 ? 'c-gold' : l < 1 ? 'c-orange' : 'c-red';
    },
    inspector(n, sim) {
      const s = n.st, G_ = g(sim); let h = '<dl class="kv"><dt>тип</dt><dd>' + ND.esc((KINDS.find(x => x.id === n.kind) || {}).label) + '</dd><dt>ранг</dt><dd>' + RANK(n) + '</dd>';
      if (n.kind === 'client') h += '<dt>отправлено</dt><dd>' + s.sent + '</dd><dt>успешно</dt><dd>' + (s.ok || 0) + '</dd><dt>ошибок</dt><dd>' + s.fail + '</dd><dt>ждут ответа</dt><dd>' + Object.keys(s.pend).length + '</dd>';
      else if (n.kind === 'queue') h += '<dt>в очереди</dt><dd>' + s.q.length + '</dd><dt>выдано</dt><dd>' + s.dispatched + '</dd><dt>потеряно</dt><dd>' + s.dropped + '</dd>';
      else if (n.kind === 'lb') h += '<dt>в пути</dt><dd>' + Object.keys(s.pend).length + '</dd>';
      else h += '<dt>занято воркеров</dt><dd>' + s.busy + '</dd><dt>в очереди</dt><dd>' + s.q.length + '</dd><dt>обслужено</dt><dd>' + s.served + '</dd><dt>отвергнуто (queue_full)</dt><dd>' + s.rej + '</dd>' + (isCache(n) ? '<dt>попаданий / промахов</dt><dd>' + s.hits + ' / ' + s.miss + '</dd><dt>ключей в кэше</dt><dd>' + Object.keys(s.keys).length + '</dd>' : '');
      h += '</dl>';
      const open = Object.keys(s.br).filter(t => s.br[t].open); if (open.length) h += '<p class="bad">Предохранитель разомкнут к: ' + open.join(', ') + '</p>';
      if (n.kind === 'client' && ND.ui && ND.ui.chart && G_.series.length > 2) { const ser = G_.series.slice(-60); h += '<h4>Задержка, мс (по секундам)</h4>' + ND.ui.chart({ w: 300, h: 170, series: [{ name: 'p50', pts: ser.map(x => [x.t, x.p50]) }, { name: 'p99', pts: ser.map(x => [x.t, x.p99]), color: 'var(--red)' }], xl: 'с', yl: 'мс' }) + '<h4>Запросы в секунду</h4>' + ND.ui.chart({ w: 300, h: 150, series: [{ name: 'успех', pts: ser.map(x => [x.t, x.ok]), color: 'var(--green)' }, { name: 'ошибки', pts: ser.map(x => [x.t, x.fail]), color: 'var(--red)' }] }); }
      return h;
    },
    metrics(sim) {
      const G_ = g(sim), L = G_.lat.filter(x => x[0] > sim.now - 10000).map(x => x[1]), ser = G_.series.slice(-5), rps = ser.length ? Math.round(ser.reduce((a, x) => a + x.ok, 0) / ser.length * 10) / 10 : 0;
      const tot = G_.ok + G_.failed, o = [{ label: 'успешных/с (посл. 5 с)', value: rps }, { label: 'запросов всего', value: tot }, { label: 'доля ошибок', value: tot ? Math.round(1000 * G_.failed / tot) / 10 + ' %' : '0 %' }, { label: 'задержка p50 / p95 / p99 (10 с)', value: Math.round(pct(L, .5)) + ' / ' + Math.round(pct(L, .95)) + ' / ' + Math.round(pct(L, .99)) + ' мс' }, { label: 'ретраев', value: G_.retries }, { label: 'размыканий предохранителя', value: G_.trips }, { label: 'обращений к БД', value: G_.dbHits }];
      if (G_.cacheHit + G_.cacheMiss) o.push({ label: 'hit ratio кэша', value: Math.round(100 * G_.cacheHit / (G_.cacheHit + G_.cacheMiss)) + ' %' });
      if (G_.async) o.push({ label: 'асинхронных заданий выполнено', value: G_.jobsDone + ' из ' + G_.async });
      const fl = Object.entries(G_.fail); if (fl.length) o.push({ label: 'причины ошибок', value: fl.map(([k, v]) => k + ':' + v).join(', ') });
      return o;
    },
    invariants(sim) {
      const sat = sim.nodes.filter(n => n.up && n.kind !== 'client' && n.kind !== 'lb' && n.st && n.st.q.length >= Math.max(1, (n.cfg.qmax != null ? n.cfg.qmax : n.kind === 'queue' ? 1000 : n.kind === 'db' ? 100 : 50)) * .9);
      return [{ id: 'sat', ok: !sat.length, text: 'Очереди не насыщены' + (sat.length ? ' (насыщены: ' + sat.map(n => n.name).join(', ') + ')' : '') }];
    },
    defaultScheme() { return ND.reg.templates.find(t => t.id === 'svc-threetier').build(); },
  });
  function failUp(ctx, p, id, err) { if (p.group !== undefined && isCache(ctx.node)) { const w = ctx.st.waiting[p.group] || []; delete ctx.st.waiting[p.group]; for (const j of w) reply(ctx, j.from, j.id, false, err); } else reply(ctx, p.up, id, false, err); }
  function dispatch(ctx) {
    const st = ctx.st, cons = downs(ctx).filter(t => ctx.sim.byId[t].kind === 'service' || ctx.sim.byId[t].kind === 'db'); if (!cons.length) return; const pf = cfgv(ctx, 'prefetch', 4);
    let guard = 0; while (st.q.length && guard++ < 500) { const c = cons.filter(t => (st.inflight[t] || 0) < pf).sort((a, b) => (st.inflight[a] || 0) - (st.inflight[b] || 0))[0]; if (!c) break; const j = st.q.shift(); st.inflight[c] = (st.inflight[c] || 0) + 1; st.dispatched++; ctx.send(c, 'job', { id: j.id, key: j.key }); }
  }

  /* ---- шаблоны ---- */
  const T = (id, title, desc, build) => ND.reg.templates.push({ id, proto: 'services', title, desc, build });
  const row = (n, x0, y, dx) => Array.from({ length: n }, (_, i) => [x0 + i * dx, y]);
  T('svc-monolith', 'Монолит: клиент → приложение → БД', 'Один сервис и одна БД. Нажмите «Всплеск нагрузки ×3»: приложение (2 воркера × 100 мс = 20 запр/с) насыщается, растут очередь и p99. Масштабировать можно только вертикально.', () => mk({ title: 'Монолит', kinds: ['client', 'service', 'db'], names: ['Клиент', 'Приложение', 'БД'], pos: [[120, 250], [380, 250], [640, 250]], cfg: [{ rps: 10 }, { workers: 2, svcTime: 100 }, { workers: 8, svcTime: 15 }], links: [[0, 1], [1, 2]] }));
  T('svc-threetier', 'Трёхзвенка: LB → 2 сервиса → БД', 'Балансировщик делит нагрузку между двумя серверами приложения. Выполните «crash» одного сервиса: LB (с проверкой здоровья) исключит его после нескольких таймаутов. Отключите lbHealth, чтобы увидеть, как запросы теряются.', () => mk({ title: 'Трёхзвенная архитектура', kinds: ['client', 'lb', 'service', 'service', 'db'], names: ['Клиент', 'LB', 'App 1', 'App 2', 'БД'], pos: [[80, 250], [250, 250], [450, 150], [450, 350], [650, 250]], cfg: [{ rps: 14 }, {}, { workers: 2, svcTime: 100 }, { workers: 2, svcTime: 100 }, { workers: 8, svcTime: 15 }], links: [[0, 1], [1, 2], [1, 3], [2, 4], [3, 4]] }));
  T('svc-microservices', 'Микросервисы с API-gateway', 'Шлюз → «Заказы» (уровень 0) → «Склад» (уровень 1) → БД. Замедлите «Склад» (действие «Замедлить узел» ×5): задержка и очередь растут вверх по цепочке — каскад. Включите circuit breaker, чтобы «Заказы» быстро отвечали ошибкой.', () => mk({ title: 'Микросервисы', kinds: ['client', 'lb', 'service', 'service', 'db'], names: ['Клиент', 'Gateway', 'Заказы', 'Склад', 'БД'], pos: [[80, 250], [250, 250], [440, 250], [620, 250], [790, 250]], cfg: [{ rps: 12 }, {}, { workers: 4, svcTime: 60, tier: 0 }, { workers: 4, svcTime: 60, tier: 1 }, { workers: 8, svcTime: 15 }], links: [[0, 1], [1, 2], [2, 3], [3, 4]] }));
  T('svc-cache', 'Кэш перед БД (cache-aside)', 'Медленная БД (4 воркера × 80 мс = 50 запр/с) и кэш. Клиент создаёт популярные ключи (перекос 3). Смотрите hit ratio и нагрузку на БД; сбросьте кэш отказом (crash/recover кэша): БД получит всплеск промахов. Включите single-flight, чтобы смягчить stampede.', () => mk({ title: 'Cache-aside', kinds: ['client', 'service', 'cache', 'db'], names: ['Клиент', 'Сервис', 'Кэш', 'БД'], pos: [[100, 250], [330, 250], [560, 250], [780, 250]], cfg: [{ rps: 40, keys: 200, skew: 3 }, { workers: 16, svcTime: 20 }, { maxKeys: 80 }, { workers: 4, svcTime: 80 }], links: [[0, 1], [1, 2], [2, 3]], params: { cacheTtl: 8000 } }));
  T('svc-queue', 'Очередь для сглаживания пиков', 'API мгновенно принимает запрос, кладёт задание в очередь и отвечает; воркеры разбирают очередь в своём темпе. «Всплеск ×5»: ошибок нет, а глубина очереди временно растёт и затем рассасывается.', () => mk({ title: 'Асинхронная обработка', kinds: ['client', 'lb', 'service', 'queue', 'service', 'service', 'db'], names: ['Клиент', 'LB', 'API', 'Очередь', 'Воркер 1', 'Воркер 2', 'БД'], pos: [[70, 250], [210, 250], [350, 250], [490, 250], [640, 160], [640, 340], [800, 250]], cfg: [{ rps: 12 }, {}, { workers: 8, svcTime: 20 }, { qmax: 2000, prefetch: 4 }, { workers: 4, svcTime: 150, tier: 1 }, { workers: 4, svcTime: 150, tier: 1 }, {}], links: [[0, 1], [1, 2], [2, 3], [3, 4], [3, 5], [4, 6], [5, 6]] }));
  T('svc-shards', 'Шардированная БД (LB по ключу)', 'Балансировщик с политикой «хэш по ключу» направляет каждый ключ на свой шард. Добавьте перекос (skew 4): один шард перегружен — «горячий шард». Отключите шард: недоступна лишь его часть ключей.', () => mk({ title: 'Шардирование', kinds: ['client', 'lb', 'db', 'db', 'db'], names: ['Клиент', 'Router', 'Шард A', 'Шард B', 'Шард C'], pos: [[100, 250], [300, 250], [560, 120], [560, 250], [560, 380]], cfg: [{ rps: 30, keys: 300, skew: 1 }, { policy: 'hash' }, { workers: 4, svcTime: 100 }, { workers: 4, svcTime: 100 }, { workers: 4, svcTime: 100 }], links: [[0, 1], [1, 2], [1, 3], [1, 4]] }));
  T('svc-cascade', 'Каскадный отказ и retry storm', 'Сервис едва справляется (≈20 запр/с). Нажмите «Замедлить узел» ×3 на «Сервисе» и повышайте ретраи до 3 (параметр retries): повторы удваивают нагрузку, система не восстанавливается даже после снятия замедления. Затем включите circuit breaker, jitter и сократите число ретраев.', () => mk({ title: 'Retry storm', kinds: ['client', 'service', 'db'], names: ['Клиент', 'Сервис', 'БД'], pos: [[120, 250], [400, 250], [680, 250]], cfg: [{ rps: 15 }, { workers: 4, svcTime: 150, qmax: 40 }, { workers: 8, svcTime: 15 }], links: [[0, 1], [1, 2]], params: { retries: 3, backoff: 100, timeout: 1500, hopTimeout: 1200 } }));
  P.mk = mk;
})(typeof window !== 'undefined' ? window : globalThis);
