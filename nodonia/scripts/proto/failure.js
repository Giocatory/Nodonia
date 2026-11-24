/* Протокол: детектор отказов — heartbeat+timeout и phi-accrual. Показывает ложные срабатывания при джиттере и потерях. */
(function (G) {
  'use strict';
  const ND = G.ND, esc = ND.esc;
  const gl = sim => sim.G_fd || (sim.G_fd = { falsePos: 0, detect: {}, crashT: {}, flaps: 0 });
  function phi(st, p, now, warm) { const iv = st.iv[p]; if (!iv || iv.length < 3) return (warm && now - st.last[p] > warm) ? 30 : 0; /* мало статистики: запасной таймаут */ const m = iv.reduce((a, b) => a + b, 0) / iv.length, sd = Math.max(m * 0.1, Math.sqrt(iv.reduce((a, b) => a + (b - m) * (b - m), 0) / iv.length)), t = now - st.last[p], y = (t - m) / sd, e = Math.exp(-y * (1.5976 + 0.070566 * y * y)), pl = t > m ? e / (1 + e) : 1 - 1 / (1 + e); return Math.min(30, -Math.log10(Math.max(pl, 1e-30))); }
  function suspected(ctx, p) { const st = ctx.st; return ctx.params.mode === 'phi' ? phi(st, p, ctx.now, ctx.params.timeoutMs * 2) > ctx.params.phiThr : ctx.now - st.last[p] > ctx.params.timeoutMs; }
  ND.registerProtocol({
    id: 'failure', title: 'Детектор отказов (heartbeat, phi)', group: 'Основы', order: 20,
    short: 'Как узнать, что сосед умер, если «молчит» может и медленная сеть: таймаут против phi-accrual.',
    desc: '<p>В асинхронной сети нельзя отличить <b>упавший</b> узел от <b>медленного</b> (это суть невозможности идеального детектора отказов). Поэтому детекторы дают лишь <b>подозрения</b>. Каждый узел шлёт <b>heartbeat</b> всем; получатель подозревает отправителя, если тишина длится дольше <b>таймаута</b> — либо, в режиме <b>phi-accrual</b> (Cassandra, Akka), если вероятность такой тишины по статистике прежних интервалов слишком мала (phi выше порога).</p><p>Компромисс: короткий таймаут — быстрое обнаружение, но <b>ложные срабатывания</b> при джиттере и потерях; длинный — меньше ложных, но медленнее обнаружение. Остановите узел и посмотрите время обнаружения; затем увеличьте джиттер на каналах.</p>',
    legend: [{ c: 'c-green', t: 'никто не подозревает' }, { c: 'c-orange', t: 'подозревают некоторые' }, { c: 'c-red', t: 'подозревают все' }, { c: 'c-gray', t: 'отказал' }],
    params: [{ id: 'mode', label: 'Детектор', type: 'select', def: 'timeout', options: [{ v: 'timeout', t: 'фиксированный таймаут' }, { v: 'phi', t: 'phi-accrual' }], hint: 'как принимается решение о подозрении' }, { id: 'hbMs', label: 'Период heartbeat, мс', type: 'number', def: 500, min: 50, max: 10000, hint: 'как часто узлы шлют «я жив»' }, { id: 'timeoutMs', label: 'Таймаут, мс', type: 'number', def: 1800, min: 100, max: 60000, hint: 'для режима «таймаут»: после какой тишины подозревать' }, { id: 'phiThr', label: 'Порог phi', type: 'number', def: 8, min: 1, max: 30, hint: 'для режима phi: чем выше, тем меньше ложных срабатываний и тем медленнее обнаружение' }],
    actions: [],
    init(n, sim) { return { last: {}, iv: {}, sus: {} }; },
    onStart(ctx) { for (const p of ctx.peers) { ctx.st.last[p] = 0; ctx.st.iv[p] = []; ctx.st.sus[p] = false; } ctx.timer('hb', ctx.rng.int(1, ctx.params.hbMs)); ctx.timer('chk', ctx.params.hbMs); },
    onRecover(ctx) { for (const p of ctx.peers) { ctx.st.last[p] = ctx.now; ctx.st.iv[p] = []; ctx.st.sus[p] = false; } ctx.timer('hb', ctx.params.hbMs); ctx.timer('chk', ctx.params.hbMs); },
    onCrash(ctx) { gl(ctx.sim).crashT[ctx.id] = ctx.now; },
    onTimer(ctx, name) {
      const st = ctx.st, g = gl(ctx.sim);
      if (name === 'hb') { ctx.bcast('hb', {}); ctx.timer('hb', ctx.params.hbMs); }
      else if (name === 'chk') {
        for (const p of ctx.peers) { const s = suspected(ctx, p), was = st.sus[p], real = ctx.sim.byId[p].up;
          if (s && !was) { st.sus[p] = true; if (real) { g.falsePos++; ctx.mark('ЛОЖНОЕ подозрение: ' + p + ' жив, но молчит ' + Math.round(ctx.now - st.last[p]) + ' мс', 'c-orange'); } else { const d = ctx.now - (g.crashT[p] || 0); (g.detect[p] = g.detect[p] || []).push(Math.round(d)); ctx.mark('обнаружил отказ ' + p + ' через ' + Math.round(d) + ' мс после падения', 'c-red'); } }
          else if (!s && was) { st.sus[p] = false; g.flaps++; ctx.mark('снял подозрение с ' + p, 'c-green'); } }
        ctx.timer('chk', Math.max(50, ctx.params.hbMs / 2));
      }
    },
    onMessage(ctx, m) { const st = ctx.st; if (st.last[m.from] > 0) { st.iv[m.from].push(ctx.now - st.last[m.from]); if (st.iv[m.from].length > 30) st.iv[m.from].shift(); } st.last[m.from] = ctx.now; },
    describe(m) { return m.from + ' → ' + m.to + ': heartbeat «я жив»'; },
    label() { return '♥'; },
    badge(n, sim) { const s = sim.nodes.filter(x => x.id !== n.id && x.st.sus && x.st.sus[n.id]).length; return s ? 'подозревают: ' + s : 'ок'; },
    nodeClass(n, sim) { if (!n.up) return 'c-gray'; const o = sim.nodes.filter(x => x.id !== n.id && x.up), s = o.filter(x => x.st.sus[n.id]).length; return s === 0 ? 'c-green' : s >= o.length ? 'c-red' : 'c-orange'; },
    inspector(n, sim) { return '<h4>Взгляд узла на соседей</h4><table class="tbl"><tr><th>сосед</th><th>тишина, мс</th><th>phi</th><th>подозрение</th><th>на самом деле</th></tr>' + sim.nodes.filter(x => x.id !== n.id).map(x => '<tr><td>' + x.id + '</td><td>' + Math.round(sim.now - n.st.last[x.id]) + '</td><td>' + phi(n.st, x.id, sim.now).toFixed(1) + '</td><td>' + (n.st.sus[x.id] ? '<b class="bad">да</b>' : 'нет') + '</td><td>' + (x.up ? 'жив' : '<b>упал</b>') + '</td></tr>').join('') + '</table>'; },
    metrics(sim) { const g = gl(sim), all = [].concat(...Object.values(g.detect)), avg = all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : null; return [{ label: 'ложных срабатываний', value: g.falsePos }, { label: 'среднее время обнаружения', value: avg == null ? '—' : avg + ' мс' }, { label: 'снятий подозрения', value: g.flaps }]; },
    defaultScheme() { return ND.makeScheme({ proto: 'failure', n: 5, topo: 'full', lat: 150, jit: 50, title: 'Детектор отказов: 5 узлов' }); },
  });
  const T = (id, title, desc, p, o) => ND.reg.templates.push({ id, proto: 'failure', title, desc, build: () => ND.makeScheme(Object.assign({ proto: 'failure', n: 5, topo: 'full', lat: 150, jit: 50, params: p, title }, o)) });
  T('fd-stable', 'Стабильная сеть', 'crash n3 — все обнаруживают отказ примерно за таймаут.', {});
  T('fd-jitter', 'Дрожащая сеть: ложные срабатывания', 'Джиттер 1500 мс и потери: короткий таймаут даёт ложные подозрения. Увеличьте таймаут или переключитесь на phi.', { timeoutMs: 1200 }, { jit: 1500, loss: 0.1 });
  T('fd-phi', 'phi-accrual в той же сети', 'Тот же джиттер, но режим phi с порогом 8 — меньше ложных срабатываний.', { mode: 'phi' }, { jit: 1500, loss: 0.1 });
})(typeof window !== 'undefined' ? window : globalThis);
