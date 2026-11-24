/* Протокол: сеть Proof-of-Work. Узлы-майнеры, вероятностный майнинг (пуассоновский процесс), flooding блоков по P2P-каналам,
   правило самой тяжёлой цепи, сироты, реорганизации, синхронизация, стратегии selfish mining и двойной траты. */
(function (G) {
  'use strict';
  const ND = G.ND;
  const GEN = { id: 'genesis', parent: null, height: 0, miner: '—', t: 0, txs: [], cw: 0 };
  function gl(sim) { return sim.G_pow || (sim.G_pow = { all: {}, total: 1, mined: 0, reorgs: 0, maxReorg: 0, reverts: 0, revertedTx: {}, ds: 0, dsFail: 0, txCount: 0, nonce: 0, divSince: null, badParent: false, pub: {} }); }
  const strat = ctx => { const s = ctx.cfg.strategy; return s === 'selfish' || s === 'doublespend' ? s : 'honest'; };
  const hrOf = n => { const v = n.cfg.hashrate; return v == null ? 1 : Math.max(0, +v || 0); };
  const par = (st, b) => b.parent === null ? null : st.blocks[b.parent];
  const mkTip = st => st.blocks[st.tip];

  function schedMine(ctx) {
    const g = gl(ctx.sim), h = hrOf(ctx.node), st = ctx.st; ctx.cancel('mine'); st.deadline = 0;
    if (h <= 0 || !ctx.node.up) return;
    const d = ctx.rng.exp(ctx.params.blockInterval * g.total / h); ctx.timer('mine', d); st.deadline = ctx.now + d; st.tTotal = d;
  }
  function chainMap(st, tipId) { // txid → высота блока, и список блоков лучшей цепи
    const m = {}; let b = st.blocks[tipId]; while (b && b.id !== 'genesis') { for (const t of b.txs) m[t] = b.height; b = par(st, b); } return m;
  }
  function setTip(ctx, b) {
    const st = ctx.st, g = gl(ctx.sim), old = mkTip(st); st.tip = b.id;
    if (old && b.parent !== old.id) { // реорганизация
      let x = old, y = b; while (x.height > y.height) x = par(st, x); while (y.height > x.height && y.parent) y = par(st, y);
      let a2 = old, b2 = b; while (a2.height > b2.height) a2 = par(st, a2); while (b2.height > a2.height) b2 = par(st, b2);
      while (a2.id !== b2.id) { a2 = par(st, a2); b2 = par(st, b2); }
      const depth = old.height - a2.height;
      if (depth > 0) { g.reorgs++; st.reorgs++; g.maxReorg = Math.max(g.maxReorg, depth); ctx.mark('РЕОРГАНИЗАЦИЯ: откат ' + depth + ' бл., переход на ветвь ' + b.id.slice(0, 6) + ' (h=' + b.height + ')', 'c-orange'); }
    }
    reconcile(ctx);
  }
  function reconcile(ctx) {
    const st = ctx.st, g = gl(ctx.sim); if (!g.txCount) return;
    const cm = chainMap(st, st.tip), conf = ctx.params.confirmations, tip = mkTip(st);
    for (const id in st.conf) if (cm[id] === undefined) { delete st.conf[id]; g.reverts++; if (!g.revertedTx[id]) { g.revertedTx[id] = ctx.now; ctx.mark('⚠ подтверждённая транзакция ' + id + ' ОТКАТИЛАСЬ (была на глубине ≥ ' + conf + ')', 'c-red'); } }
    for (const id in cm) if (tip.height - cm[id] + 1 >= conf && !st.conf[id]) st.conf[id] = 1;
    st.cm = cm;
  }
  function pending(ctx) {
    const st = ctx.st, skip = st.attack ? { [st.attack.tx]: 1 } : {}, inPriv = {};
    for (const id of st.priv) for (const t of st.blocks[id].txs) inPriv[t] = 1;
    return Object.keys(st.txs).filter(id => (!st.cm || st.cm[id] === undefined) && !inPriv[id] && !skip[id]).sort((a, b) => st.txs[a].t - st.txs[b].t || (a < b ? -1 : 1)).slice(0, 10);
  }
  function addBlock(ctx, b, from) {
    const st = ctx.st; if (st.blocks[b.id]) return false;
    if (b.parent !== null && !st.blocks[b.parent]) {
      (st.orphans[b.parent] = st.orphans[b.parent] || []).push(b); st.orphanN++; ctx.log('блок-сирота ' + b.id.slice(0, 6) + ': родитель ' + b.parent.slice(0, 6) + ' неизвестен — запрашиваю цепь у ' + from);
      reqChain(ctx, from); return false;
    }
    st.blocks[b.id] = b; st.nb++;
    if (b.cw > mkTip(st).cw) setTip(ctx, b);
    const kids = st.orphans[b.id]; if (kids) { delete st.orphans[b.id]; for (const k of kids) addBlock(ctx, k, from); }
    return true;
  }
  function reqChain(ctx, to) { const st = ctx.st; if (!to || (st.lastSync[to] != null && ctx.now - st.lastSync[to] < 3000)) return; st.lastSync[to] = ctx.now; ctx.send(to, 'getchain', { h: mkTip(st).height }); }
  function mineParent(ctx) { const st = ctx.st; if (st.tie && st.tieBlock) return st.tieBlock; if (st.priv.length) return st.priv[st.priv.length - 1]; return st.tip; }
  function publish(ctx, ids) {
    const st = ctx.st, g = gl(ctx.sim);
    for (const id of ids) { const b = st.blocks[id]; g.pub[id] = 1; ctx.sendNeighbors('block', { b }); if (b.cw > mkTip(st).cw) setTip(ctx, b); }
  }
  function selfishOnPublic(ctx) {
    const st = ctx.st; if (!st.priv.length) { st.tie = false; st.tieBlock = null; return; }
    const baseH = st.blocks[st.privBase].height, privH = baseH + st.priv.length, pubH = mkTip(st).height, lead = privH - pubH;
    if (lead < 0) { ctx.mark('selfish: честная цепь обогнала тайную — ' + st.priv.length + ' бл. потеряно', 'c-red'); st.priv = []; st.tie = false; st.tieBlock = null; }
    else if (lead <= 1) { const ids = st.priv.slice(); st.priv = []; publish(ctx, ids); if (lead === 0) { st.tie = true; st.tieBlock = ids[ids.length - 1]; ctx.mark('selfish: публикую блок — гонка ничья (state 0\')', 'c-red'); } else { st.tie = false; ctx.mark('selfish: раскрываю тайную цепь (' + ids.length + ' бл.) — честные блоки вытеснены', 'c-red'); } }
    else { const k = Math.max(1, pubH - baseH), ids = st.priv.slice(0, k); st.privBase = ids[ids.length - 1]; st.priv = st.priv.slice(k); publish(ctx, ids); ctx.mark('selfish: раскрываю ' + ids.length + ' бл., отрыв сохраняется (' + st.priv.length + ')', 'c-red'); }
  }
  function attackCheck(ctx) {
    const st = ctx.st, a = st.attack, g = gl(ctx.sim); if (!a) return;
    const baseH = st.blocks[st.privBase].height, privH = baseH + st.priv.length, tip = mkTip(st), pubH = tip.height, conf = ctx.params.confirmations;
    const confirmed = a.tx ? (st.cm && st.cm[a.tx] !== undefined && pubH - st.cm[a.tx] + 1 >= conf) : pubH - baseH >= conf;
    if (confirmed && privH > pubH) { const ids = st.priv.slice(); st.priv = []; st.attack = null; g.ds++; ctx.mark('ДВОЙНАЯ ТРАТА: публикую тайную цепь длиной ' + privH + ' > ' + pubH, 'c-red'); publish(ctx, ids); }
    else if (pubH - privH >= ctx.params.giveUp) { ctx.mark('атака провалена: честная цепь ушла вперёд на ' + (pubH - privH), 'c-gray'); st.priv = []; st.attack = null; g.dsFail++; }
  }
  function mineBlock(ctx) {
    const st = ctx.st, g = gl(ctx.sim), s = strat(ctx), pid = mineParent(ctx), p = st.blocks[pid];
    const txs = pending(ctx); const nonce = ++g.nonce * 7919 + ctx.rng.int(0, 1e6);
    const b = { id: ND.sha256(pid + p.height + ctx.id + nonce).slice(0, 10), parent: pid, height: p.height + 1, miner: ctx.id, t: ctx.now, txs, cw: p.cw + 1 };
    g.all[b.id] = { id: b.id, miner: ctx.id, h: b.height, t: ctx.now }; g.mined++; st.mined++; st.blocks[b.id] = b; st.nb++;
    const privMode = (s === 'selfish') || (s === 'doublespend' && st.attack);
    if (!privMode) { setTip(ctx, b); g.pub[b.id] = 1; ctx.mark('нашёл блок #' + b.height + ' (' + b.id.slice(0, 6) + ')', 'c-green'); ctx.sendNeighbors('block', { b }); }
    else if (s === 'selfish' && st.tie) { st.tie = false; st.tieBlock = null; ctx.mark('selfish: нашёл блок в ничьей — публикую, выигрываю гонку', 'c-red'); st.blocks[b.id] = b; publish(ctx, [b.id]); }
    else { if (!st.priv.length) st.privBase = pid; st.priv.push(b.id); ctx.mark('нашёл блок #' + b.height + ' ТАЙНО (тайная цепь: ' + st.priv.length + ')', 'c-red'); if (s === 'doublespend') attackCheck(ctx); }
  }

  ND.registerProtocol({
    id: 'pow', title: 'PoW-сеть (форки и реорганизации)', group: 'Блокчейн', order: 20, short: 'Майнеры, форки, самая тяжёлая цепь, реорганизации; 51% и selfish mining.',
    desc: '<p>Каждый узел — полный узел и майнер с долей <b>хэшрейта</b>. Найти блок — случайное событие (пуассоновский процесс): среднее время до блока в сети — <b>blockInterval</b>, а у узла с долей <i>p</i> оно в 1/<i>p</i> раз длиннее. Нашёл блок — разослал соседям; сосед проверил, добавил, переслал дальше (flooding). Пока блок летит по сети, другой майнер может найти <b>свой</b> блок на той же высоте — возникает <b>форк</b>. Правило <b>самой тяжёлой цепи</b> разрешает его при следующем блоке: проигравший блок становится <b>устаревшим (stale/orphan)</b>, а узлы делают <b>реорганизацию</b>.</p><p>Чем медленнее сеть относительно блочного интервала, тем больше форков. Узел с настройкой стратегии <b>selfish</b> прячет блоки, а <b>doublespend</b> тайно строит цепь и подменяет подтверждённую транзакцию. Попробуйте: <code>do tx node=n2 id=pay1</code>.</p>',
    legend: [{ c: 'c-blue', t: 'честный майнер' }, { c: 'c-red', t: 'атакующий' }, { c: 'c-teal', t: 'узел без майнинга' }, { c: 'c-gray', t: 'отключён' }],
    params: [
      { id: 'blockInterval', label: 'Блочный интервал, мс (ускоренный масштаб)', type: 'number', def: 20000, min: 1000, max: 600000, hint: 'среднее время между блоками во всей сети. В Bitcoin 600 с; здесь масштаб сжат, чтобы форки были видны за минуты' },
      { id: 'confirmations', label: 'Подтверждений (глубина)', type: 'number', def: 3, min: 1, max: 12, hint: 'на какой глубине транзакция считается подтверждённой' },
      { id: 'giveUp', label: 'Атакующий сдаётся при отставании', type: 'number', def: 8, min: 2, max: 50, hint: 'если честная цепь опередила тайную на столько блоков, атака прекращается' },
    ],
    nodeCfg: [
      { id: 'hashrate', label: 'Хэшрейт (доля)', type: 'number', def: 1, min: 0, max: 1000, hint: 'относительная вычислительная мощность; 0 — узел только проверяет и пересылает блоки. Сложность фиксирована', },
      { id: 'strategy', label: 'Стратегия', type: 'select', def: 'honest', options: [{ v: 'honest', t: 'honest — честный' }, { v: 'selfish', t: 'selfish — эгоистичный майнинг' }, { v: 'doublespend', t: 'doublespend — двойная трата' }], hint: 'honest публикует блоки сразу; selfish прячет их; doublespend строит тайную цепь после команды attack_start' },
    ],
    actions: [
      { id: 'tx', label: 'Отправить транзакцию', args: [{ id: 'node', label: 'С узла', type: 'node' }, { id: 'id', label: 'Идентификатор', type: 'text', def: 'pay1' }], run(sim, a) { const n = sim.byId[a.node || sim.nodes[0].id], g = gl(sim); if (!n || !n.up) return { text: 'узел недоступен' }; const id = String(a.id || 'tx' + (g.txCount + 1)).replace(/[^\w-]/g, '').slice(0, 10) || 'tx'; if (n.st.txs[id]) return { text: 'транзакция ' + id + ' уже существует' }; g.txCount++; const tx = { id, from: n.id, t: sim.now }; n.st.txs[id] = tx; reconcile(sim.ctx(n)); sim.ctx(n).sendNeighbors('tx', { tx }); return { text: 'транзакция ' + id + ' создана на ' + n.name + ' и рассылается по сети' }; } },
      { id: 'attack_start', label: 'Начать двойную трату', args: [{ id: 'node', label: 'Атакующий', type: 'node' }, { id: 'tx', label: 'Транзакция-жертва (id)', type: 'text', def: 'pay1' }], run(sim, a) { const n = sim.byId[a.node || sim.nodes[0].id]; if (!n || !n.up) return { text: 'узел недоступен' }; const ctx = sim.ctx(n), st = n.st; n.cfg.strategy = 'doublespend'; if (st.priv.length) publish(ctx, st.priv.splice(0)); st.attack = { tx: String(a.tx || 'pay1').slice(0, 10), t: sim.now }; st.privBase = st.tip; st.priv = []; ctx.mark('начинает ТАЙНУЮ цепь от блока #' + mkTip(st).height + '; цель — отменить транзакцию ' + st.attack.tx, 'c-red'); schedMine(ctx); return { text: n.name + ' майнит секретную ветвь, исключая транзакцию ' + st.attack.tx }; } },
    ],
    init(node, sim) { gl(sim); return { blocks: { genesis: GEN }, tip: 'genesis', orphans: {}, orphanN: 0, nb: 0, txs: {}, conf: {}, cm: {}, priv: [], privBase: 'genesis', tie: false, tieBlock: null, attack: null, mined: 0, reorgs: 0, deadline: 0, tTotal: 0, lastSync: {} }; },
    onStart(ctx) { const g = gl(ctx.sim); g.total = ctx.sim.nodes.reduce((a, n) => a + hrOf(n), 0) || 1; schedMine(ctx); ctx.timer('announce', ctx.rng.int(1, ctx.params.blockInterval / 2)); },
    onRecover(ctx) { const st = ctx.st; st.priv = []; st.tie = false; st.attack = null; schedMine(ctx); ctx.timer('announce', 200); for (const p of ctx.neighbors) reqChain(ctx, p); ctx.mark('вернулся в сеть: запрашивает недостающие блоки', 'c-blue'); },
    onCfg(ctx, key) {
      const st = ctx.st; if (key === 'hashrate') schedMine(ctx);
      if (key === 'strategy' && strat(ctx) === 'honest' && st.priv.length) { publish(ctx, st.priv.splice(0)); st.tie = false; st.attack = null; schedMine(ctx); }
    },
    onTimer(ctx, name) {
      const st = ctx.st, g = gl(ctx.sim);
      if (name === 'mine') { mineBlock(ctx); schedMine(ctx); }
      else if (name === 'announce') {
        const t = mkTip(st); ctx.sendNeighbors('status', { id: t.id, cw: t.cw }); ctx.timer('announce', ctx.params.blockInterval / 2 + ctx.rng.int(0, 500));
        const hs = []; for (const comp of ctx.sim.components()) { const hn = comp.map(id => ctx.sim.byId[id]).filter(n => n.up && (n.cfg.strategy || 'honest') === 'honest'); if (hn.length > 1) { const h = hn.map(n => mkTip(n.st).height); if (Math.max(...h) !== Math.min(...h)) hs.push(1); } }
        if (hs.length) { if (g.divSince == null) g.divSince = ctx.now; } else g.divSince = null;
      }
    },
    onMessage(ctx, m) {
      const st = ctx.st, b = m.body, s = strat(ctx);
      if (m.type === 'block') {
        const before = st.tip, ok = addBlock(ctx, b.b, m.from);
        if (ok) {
          ctx.sendNeighbors('block', { b: b.b }, m.from);
          if (st.tip !== before) { if (s === 'selfish') selfishOnPublic(ctx); else if (s === 'doublespend') attackCheck(ctx); schedMine(ctx); }
        }
      } else if (m.type === 'tx') {
        if (!st.txs[b.tx.id]) { gl(ctx.sim); st.txs[b.tx.id] = b.tx; reconcile(ctx); ctx.sendNeighbors('tx', { tx: b.tx }, m.from); }
      } else if (m.type === 'status') {
        if (b.cw > mkTip(st).cw && !st.blocks[b.id]) reqChain(ctx, m.from);
      } else if (m.type === 'getchain') {
        const chain = []; let x = mkTip(st); while (x && x.id !== 'genesis') { chain.push(x); x = par(st, x); } chain.reverse();
        if (chain.length) ctx.send(m.from, 'chain', { blocks: chain });
      } else if (m.type === 'chain') {
        const before = st.tip; let n = 0; for (const x of b.blocks) if (addBlock(ctx, x, m.from)) n++;
        if (n) ctx.log('синхронизация с ' + m.from + ': получено блоков ' + n);
        if (st.tip !== before) { if (s === 'selfish') selfishOnPublic(ctx); else if (s === 'doublespend') attackCheck(ctx); schedMine(ctx); }
      }
    },
    describe(m) {
      const b = m.body;
      switch (m.type) {
        case 'block': return m.from + ' → ' + m.to + ': новый блок #' + b.b.height + ' ' + b.b.id.slice(0, 6) + ' (майнер ' + b.b.miner + (b.b.txs.length ? ', транзакций ' + b.b.txs.length : '') + ')';
        case 'tx': return m.from + ' → ' + m.to + ': транзакция ' + b.tx.id + ' (в пул ожидания)';
        case 'status': return m.from + ' → ' + m.to + ': моя вершина ' + b.id.slice(0, 6) + ' (вес ' + b.cw + ')';
        case 'getchain': return m.from + ' → ' + m.to + ': запрос цепи (у меня высота ' + b.h + ')';
        case 'chain': return m.from + ' → ' + m.to + ': ответ — ' + b.blocks.length + ' блоков цепи';
      } return m.type;
    },
    label(m) { return { block: m.body.b ? '▣ #' + m.body.b.height : 'блок', tx: 'tx', status: '', getchain: 'sync?', chain: 'цепь' }[m.type] || m.type; },
    badge(n, sim) { const g = gl(sim), s = n.st, h = Math.round(100 * hrOf(n) / g.total); return 'h=' + mkTip(s).height + ' · ' + h + '%' + (s.priv.length ? ' +' + s.priv.length + '🔒' : ''); },
    nodeClass(n) { if (!n.up) return 'c-gray'; const s = n.cfg.strategy; if (s === 'selfish' || s === 'doublespend') return 'c-red'; return hrOf(n) > 0 ? 'c-blue' : 'c-teal'; },
    ring(n, sim) { const s = n.st; if (!n.up || !s.deadline || s.deadline <= sim.now) return null; return { frac: Math.min(1, (s.deadline - sim.now) / s.tTotal), label: 'до блока' }; },
    inspector(n, sim) {
      const s = n.st, g = gl(sim), tip = mkTip(s), chain = []; let x = tip; while (x && chain.length < 12) { chain.push(x); x = par(s, x); }
      const onMain = {}; let y = tip; while (y) { onMain[y.id] = 1; y = par(s, y); }
      const forks = Object.keys(s.blocks).filter(id => !onMain[id] && id !== 'genesis').length;
      let h = '<dl class="kv"><dt>стратегия</dt><dd>' + ND.esc(n.cfg.strategy || 'honest') + '</dd><dt>хэшрейт</dt><dd>' + hrOf(n) + ' (' + Math.round(100 * hrOf(n) / g.total) + '%)</dd><dt>вершина</dt><dd class="mono">' + tip.id.slice(0, 8) + ' (h=' + tip.height + ')</dd><dt>блоков знает</dt><dd>' + (s.nb + 1) + ' (вне главной цепи: ' + forks + ')</dd><dt>намайнил сам</dt><dd>' + s.mined + '</dd><dt>реорганизаций</dt><dd>' + s.reorgs + '</dd><dt>сирот ждёт</dt><dd>' + Object.keys(s.orphans).length + '</dd></dl>';
      if (s.priv.length || s.attack) h += '<div class="callout bad"><b>Тайная цепь:</b> ' + s.priv.length + ' бл.' + (s.attack ? ' · цель: отменить ' + ND.esc(s.attack.tx) : '') + (s.tie ? ' · ничья' : '') + '</div>';
      h += '<h4>Главная цепь (последние)</h4><div class="logrow">' + chain.map(b => '<span class="le cm" title="' + b.id + ' майнер ' + b.miner + '"><i>#' + b.height + '</i><b>' + b.id.slice(0, 4) + '</b><u>' + b.miner + (b.txs.length ? ' ⚑' + b.txs.length : '') + '</u></span>').join('') + '</div>';
      const tx = Object.keys(s.txs); if (tx.length) h += '<h4>Транзакции</h4>' + tx.map(id => { const hh = s.cm[id]; return '<div class="sm mono">' + ND.esc(id) + ': ' + (hh === undefined ? '<span class="warn">ожидает (в пуле)</span>' : 'в блоке #' + hh + ', глубина ' + (tip.height - hh + 1) + (s.conf[id] ? ' <span class="ok">✔ подтверждена</span>' : '')) + '</div>'; }).join('');
      return h;
    },
    metrics(sim) {
      const g = gl(sim), up = sim.nodes.filter(n => n.up); if (!up.length) return [];
      const best = up.reduce((a, n) => mkTip(n.st).cw > mkTip(a.st).cw ? n : a, up[0]), chain = []; let x = mkTip(best.st); const bm = {}; while (x && x.id !== 'genesis') { chain.push(x); x = par(best.st, x); }
      const mainN = chain.length, stale = Math.max(0, g.mined - mainN), per = {}; chain.forEach(b => per[b.miner] = (per[b.miner] || 0) + 1);
      const sh = sim.nodes.filter(n => hrOf(n) > 0).map(n => n.name + ': ' + Math.round(100 * (per[n.id] || 0) / Math.max(1, mainN)) + '% блоков / ' + Math.round(100 * hrOf(n) / g.total) + '% хэшрейта').join('; ');
      return [{ label: 'высота лучшей цепи', value: mainN }, { label: 'блоков найдено / устарело', value: g.mined + ' / ' + stale + ' (' + (g.mined ? Math.round(100 * stale / g.mined) : 0) + '%)' }, { label: 'средний интервал', value: mainN ? ND.fmtT(chain[0].t / mainN) : '—' }, { label: 'реорганизаций узлов (макс. глубина)', value: g.reorgs + ' (' + g.maxReorg + ')' }, { label: 'откатов подтверждённых транзакций', value: Object.keys(g.revertedTx).length }, { label: 'успешных двойных трат / провалов', value: g.ds + ' / ' + g.dsFail }, { label: 'доля блоков vs хэшрейта', value: sh }];
    },
    invariants(sim) {
      const g = gl(sim), grace = 4 * (sim.params.blockInterval || 20000) + 20000;
      return [
        { id: 'parent', ok: !g.badParent, text: 'Каждый принятый блок имеет известного родителя (сироты ждут родителя вне дерева)' },
        { id: 'sync', ok: g.divSince == null || sim.now - g.divSince <= grace, text: 'Честные узлы одной связной части сети сходятся к одной высоте (допустимо краткое расхождение, пока блоки в пути)' },
      ];
    },
    defaultScheme() { return mk({}); },
  });

  function mk(o) {
    const hr = o.hr || [1, 1, 1, 1, 1, 1], n = hr.length;
    return ND.makeScheme({ proto: 'pow', n, topo: o.topo || 'mesh', lat: o.lat || 1500, jit: o.jit == null ? 1000 : o.jit, seed: o.seed || 7, title: o.title || 'PoW: 6 майнеров', notes: o.notes || '', params: o.params, cfgs: hr.map((h, i) => Object.assign({ hashrate: h }, o.strat && o.strat[i] ? { strategy: o.strat[i] } : {})), names: o.names });
  }
  const T = (id, title, desc, build) => ND.reg.templates.push({ id, proto: 'pow', title, desc, build });
  T('pow-honest', 'Честная сеть', 'Шесть равных майнеров; редкие форки. Запустите ▶ и наблюдайте блоки, затем смотрите «Метрики».', () => mk({ title: 'PoW: честная сеть', notes: 'Равные майнеры, задержка ~2 с при блоке 20 с.' }));
  T('pow-slow', 'Медленная сеть → много форков', 'Задержка 8±5 с при блоке 20 с: форки и реорганизации почти постоянно.', () => mk({ lat: 8000, jit: 5000, title: 'PoW: медленная сеть', notes: 'Задержка сопоставима с блочным интервалом.' }));
  T('pow-51', 'Атака 51%: двойная трата', 'n1 держит ~62% хэшрейта. Команды: do tx node=n2 id=pay1 → do attack_start node=n1 tx=pay1 (лучше сразу перед платежом), затем run 600.', () => mk({ hr: [8, 1, 1, 1, 1, 1], strat: { 0: 'doublespend' }, title: 'PoW: атака 51%', seed: 11, notes: 'Сначала attack_start (тайная ветвь от текущей вершины), потом tx — транзакция попадёт только в честную ветвь. После 3 подтверждений атакующий публикует более длинную цепь.' }));
  T('pow-selfish', 'Selfish mining (33%)', 'n1 прячет блоки при 33% хэшрейта. Запустите run 3000 и сравните долю блоков n1 с долей хэшрейта.', () => mk({ hr: [2.5, 1, 1, 1, 1, 1], strat: { 0: 'selfish' }, title: 'PoW: selfish mining', seed: 5, params: { blockInterval: 10000 }, lat: 1200, jit: 800, notes: 'Порог прибыльности при γ=0 равен 1/3. Нужна длинная выборка: run 3000.' }));
  T('pow-catchup', 'Майнер догоняет цепь', 'Остановите n6 (crash n6), пусть сеть уйдёт вперёд (run 120), затем recover n6 — он запросит недостающие блоки.', () => mk({ title: 'PoW: синхронизация нового узла', notes: 'crash n6 → run 120 → recover n6.' }));
  ND.powMk = mk;
})(typeof window !== 'undefined' ? window : globalThis);
