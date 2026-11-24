/* Протокол: эпидемическая рассылка (gossip). Работает по прямым каналам (overlay-сеть): соседи = узлы, связанные кабелем. */
(function (G) {
  'use strict';
  const ND = G.ND;
  const P = ND.registerProtocol({
    id: 'gossip', title: 'Gossip (эпидемическая рассылка)', group: 'Распространение и согласование', short: 'Слух расходится от узла к узлу, как эпидемия: быстро, надёжно и без координатора.',
    desc: '<p>Каждый узел периодически выбирает случайных <b>соседей</b> и обменивается с ними новостями. Режимы: <b>push</b> (рассказываю свои слухи), <b>pull</b> (спрашиваю, что нового), <b>push-pull</b> (обмен сводками — anti-entropy), <b>flood</b> (переслать всем соседям сразу, как в P2P-сетях блокчейна). За O(log N) раундов слух доходит до всех, а отказ любого узла почти не мешает.</p><p>Нажмите «Новый слух» у любого узла и наблюдайте, как растёт доля узлов, знающих слух. Оборвите каналы или остановите узлы и посмотрите на устойчивость.</p>',
    legend: [{ c: 'c-green', t: 'знает все слухи' }, { c: 'c-blue', t: 'знает не всё' }, { c: 'c-gray', t: 'отказал' }],
    params: [
      { id: 'mode', label: 'Режим', type: 'select', def: 'push', options: [{ v: 'push', t: 'push (рассказать)' }, { v: 'pull', t: 'pull (спросить)' }, { v: 'pushpull', t: 'push-pull (обмен сводками)' }, { v: 'flood', t: 'flood (переслать всем)' }], hint: 'как узлы обмениваются слухами' },
      { id: 'fanout', label: 'Fanout (соседей за раунд)', type: 'number', def: 1, min: 1, max: 8, hint: 'сколько случайных соседей выбирается за один раунд' },
      { id: 'interval', label: 'Раунд, мс', type: 'number', def: 1000, min: 100, max: 20000, hint: 'период таймера gossip' },
      { id: 'stopAfter', label: 'Остыть после k «уже знаю»', type: 'number', def: 3, min: 1, max: 20, hint: 'в режиме push слух перестаёт рассылаться после k ответов «я это уже знал» (модель SIR)' },
    ],
    actions: [
      { id: 'rumor', label: 'Новый слух', args: [{ id: 'node', label: 'Узел', type: 'node' }, { id: 'value', label: 'Текст', type: 'text', def: 'слух' }], run(sim, a) { const n = sim.byId[a.node || sim.nodes[0].id]; if (!n || !n.up) return { text: 'узел недоступен' }; const id = 'r' + (++sim.G_gossip.cnt); learn(sim.ctx(n), id, String(a.value || id).slice(0, 20), null, true); return { text: 'у узла ' + n.name + ' появился слух ' + id }; } },
    ],
    init(node, sim) { sim.G_gossip = sim.G_gossip || { cnt: 0, born: {} }; return { known: {}, hot: {}, got: {} }; },
    onStart(ctx) { if (ctx.params.mode !== 'flood') ctx.timer('gossip', ctx.rng.int(1, ctx.params.interval)); },
    onRecover(ctx) { if (ctx.params.mode !== 'flood') ctx.timer('gossip', ctx.rng.int(1, ctx.params.interval)); },
    onTimer(ctx, name) {
      if (name !== 'gossip') return;
      const st = ctx.st, nb = ctx.neighbors.slice(), k = Math.min(ctx.params.fanout, nb.length), mode = ctx.params.mode;
      const pick = ctx.rng.shuffle(nb).slice(0, k);
      for (const to of pick) {
        if (mode === 'push') { const ids = Object.keys(st.hot); if (ids.length) ctx.send(to, 'push', { rum: ids.map(i => [i, st.known[i]]) }); }
        else if (mode === 'pull') ctx.send(to, 'pull', { ids: Object.keys(st.known) });
        else if (mode === 'pushpull') ctx.send(to, 'digest', { ids: Object.keys(st.known) });
      }
      ctx.timer('gossip', ctx.params.interval);
    },
    onMessage(ctx, m) {
      const st = ctx.st, b = m.body;
      if (m.type === 'push' || m.type === 'flood' || m.type === 'delta') {
        const was = [];
        for (const [id, v] of b.rum) { if (st.known[id] === undefined) learn(ctx, id, v, m.from, false); else was.push(id); }
        if (m.type === 'push' && was.length) ctx.send(m.from, 'ack', { known: was });
        if (m.type === 'delta' && b.want && b.want.length) ctx.send(m.from, 'delta2', { rum: b.want.filter(i => st.known[i] !== undefined).map(i => [i, st.known[i]]) });
      } else if (m.type === 'delta2') { for (const [id, v] of b.rum) if (st.known[id] === undefined) learn(ctx, id, v, m.from, false); }
      else if (m.type === 'ack') { for (const id of b.known) if (st.hot[id] !== undefined && ++st.hot[id] >= ctx.params.stopAfter) { delete st.hot[id]; ctx.log('слух ' + id + ' «остыл» на ' + ctx.name + ' (получено ' + ctx.params.stopAfter + ' ответов «уже знаю»)'); } }
      else if (m.type === 'pull') { const give = Object.keys(st.known).filter(i => !b.ids.includes(i)); if (give.length) ctx.send(m.from, 'delta', { rum: give.map(i => [i, st.known[i]]) }); }
      else if (m.type === 'digest') { const give = Object.keys(st.known).filter(i => !b.ids.includes(i)), want = b.ids.filter(i => st.known[i] === undefined); if (give.length || want.length) ctx.send(m.from, 'delta', { rum: give.map(i => [i, st.known[i]]), want }); }
    },
    describe(m) {
      const b = m.body;
      switch (m.type) {
        case 'push': return m.from + ' рассказывает ' + m.to + ' слухи: ' + b.rum.map(r => r[0]).join(', ');
        case 'flood': return m.from + ' пересылает ' + m.to + ' слухи: ' + b.rum.map(r => r[0]).join(', ');
        case 'pull': return m.from + ' спрашивает ' + m.to + ': «что нового?» (знаю ' + b.ids.length + ' слухов)';
        case 'digest': return m.from + ' посылает ' + m.to + ' сводку (' + b.ids.length + ' слухов) для сверки';
        case 'delta': return m.from + ' отвечает ' + m.to + ': присылает недостающие слухи' + (b.want && b.want.length ? ' и просит ' + b.want.join(', ') : '');
        case 'delta2': return m.from + ' досылает ' + m.to + ' запрошенные слухи';
        case 'ack': return m.to + ' узнаёт от ' + m.from + ': «это я уже знал» (' + b.known.join(', ') + ')';
      } return m.type;
    },
    label(m) { return m.type; },
    badge(n) { return Object.keys(n.st ? n.st.known : {}).length + ' слух.'; },
    nodeClass(n, sim) { if (!n.up) return 'c-gray'; const tot = sim.G_gossip ? sim.G_gossip.cnt : 0; return tot && n.st && Object.keys(n.st.known).length >= tot ? 'c-green' : 'c-blue'; },
    inspector(n) { const ks = Object.keys(n.st.known); return '<h4>Известные слухи</h4>' + (ks.length ? '<table class="tbl"><tr><th>id</th><th>текст</th><th>получен</th><th>горячий</th></tr>' + ks.map(k => '<tr><td>' + k + '</td><td>' + ND.esc(n.st.known[k]) + '</td><td>' + (n.st.got[k] != null ? ND.fmtT(n.st.got[k]) : '') + '</td><td>' + (n.st.hot[k] !== undefined ? 'да (' + n.st.hot[k] + ')' : '—') + '</td></tr>').join('') + '</table>' : '<p class="mt">Пока ничего. Создайте слух кнопкой «Новый слух».</p>'); },
    metrics(sim) {
      const g = sim.G_gossip || { cnt: 0 }, up = sim.nodes.filter(n => n.up), out = [];
      for (let i = 1; i <= g.cnt && i <= 6; i++) { const id = 'r' + i, have = up.filter(n => n.st.known[id] !== undefined).length; out.push({ label: 'слух ' + id, value: have + ' из ' + up.length + ' (' + Math.round(100 * have / Math.max(1, up.length)) + '%)' }); }
      out.push({ label: 'сообщений отправлено', value: sim.stats.sent }); return out;
    },
    defaultScheme() { return ND.makeScheme({ proto: 'gossip', n: 8, topo: 'mesh', lat: 300, title: 'Gossip: 8 узлов' }); },
  });
  function learn(ctx, id, v, from, origin) {
    const st = ctx.st; st.known[id] = v; st.got[id] = ctx.now; st.hot[id] = 0;
    const g = ctx.sim.G_gossip; if (origin && g.born[id] == null) g.born[id] = ctx.now;
    ctx.mark((origin ? 'создал слух ' : 'узнал слух ') + id, 'c-green');
    if (ctx.params.mode === 'flood') for (const nb of ctx.neighbors) if (nb !== from) ctx.send(nb, 'flood', { rum: [[id, v]] });
  }
  P.learn = learn;
})(typeof window !== 'undefined' ? window : globalThis);
