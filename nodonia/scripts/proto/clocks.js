/* Протокол: логическое время — часы Лампорта, векторные часы, гибридные логические часы (HLC). */
(function (G) {
  'use strict';
  const ND = G.ND, esc = ND.esc;
  const gl = sim => sim.G_clocks || (sim.G_clocks = { ev: [], id: 0 });
  const vle = (a, b) => Object.keys(a).every(k => a[k] <= (b[k] || 0));
  const rel = (a, b) => { const ab = vle(a.V, b.V), ba = vle(b.V, a.V); return ab && ba ? 'равны' : ab ? 'a → b (a произошло раньше b)' : ba ? 'b → a (b произошло раньше a)' : 'a ‖ b (конкурентны)'; };
  const vtxt = V => '[' + Object.keys(V).sort().map(k => k + ':' + V[k]).join(' ') + ']';
  function tick(ctx, kind, recv) {
    const st = ctx.st, g = gl(ctx.sim), pt = Math.round(ctx.now + (ctx.cfg.skew || 0));
    if (recv) { st.L = Math.max(st.L, recv.L) + 1; for (const k in recv.V) st.V[k] = Math.max(st.V[k] || 0, recv.V[k]); st.V[ctx.id] = (st.V[ctx.id] || 0) + 1; const l = Math.max(st.h.l, recv.h.l, pt); st.h = { l, c: l === st.h.l && l === recv.h.l ? Math.max(st.h.c, recv.h.c) + 1 : l === st.h.l ? st.h.c + 1 : l === recv.h.l ? recv.h.c + 1 : 0 }; }
    else { st.L++; st.V[ctx.id] = (st.V[ctx.id] || 0) + 1; const l = Math.max(st.h.l, pt); st.h = { l, c: l === st.h.l ? st.h.c + 1 : 0 }; }
    const e = { id: ++g.id, node: ctx.id, kind, t: ctx.now, L: st.L, V: Object.assign({}, st.V), h: Object.assign({}, st.h) }; g.ev.push(e); st.evs.push(e.id);
    ctx.mark(({ local: 'локальное событие', send: 'отправка', recv: 'получение' }[kind]) + ' #' + e.id + ' · L=' + e.L + ' · V=' + vtxt(e.V) + ' · HLC=' + e.h.l + '.' + e.h.c, 'c-purple'); return e;
  }
  function doSend(sim, from, to) { const n = sim.byId[from]; if (!n || !n.up || !sim.byId[to] || from === to) return; const ctx = sim.ctx(n), e = tick(ctx, 'send'); ctx.send(to, 'm', { eid: e.id, L: e.L, V: e.V, h: e.h }); }
  ND.registerProtocol({
    id: 'clocks', title: 'Логические часы (Lamport, векторные, HLC)', group: 'Основы', order: 10,
    short: 'Как упорядочить события без общих часов: «произошло раньше», конкурентность и гибридное время.',
    desc: '<p>В распределённой системе нет единых часов, а физические часы расходятся. <b>Часы Лампорта</b> дают числовую метку: если A → B (A могло повлиять на B), то L(A) &lt; L(B), но обратное неверно — по меткам нельзя отличить причинность от совпадения. <b>Векторные часы</b> хранят счётчик на каждый узел и точно определяют: A → B, B → A или <b>A ‖ B (конкурентны)</b>. <b>HLC</b> (hybrid logical clock) сочетает физическое время и логический счётчик: метки близки к реальному времени и сохраняют причинность даже при сдвиге часов.</p><p>Включите автогенерацию событий, затем сравните два события в «Протокол → Сравнить события» или командой <code>do compare a=3 b=7</code>. Задайте узлу сдвиг часов и посмотрите на HLC.</p>',
    legend: [{ c: 'c-purple', t: 'узел' }, { c: 'c-gray', t: 'отказал' }],
    params: [{ id: 'auto', label: 'Автогенерация событий', type: 'bool', def: true, hint: 'узлы сами случайно создают события и шлют сообщения' }, { id: 'genMs', label: 'Средний интервал событий, мс', type: 'number', def: 2500, min: 200, max: 20000, hint: 'как часто узел выполняет событие' }],
    nodeCfg: [{ id: 'skew', label: 'Сдвиг физических часов, мс', type: 'number', def: 0, min: -3600000, max: 3600000, hint: 'используется в HLC' }],
    actions: [
      { id: 'event', label: 'Локальное событие', args: [{ id: 'node', label: 'Узел', type: 'node' }], run(sim, a) { const n = sim.byId[a.node]; if (n && n.up) tick(sim.ctx(n), 'local'); return { text: 'локальное событие' }; } },
      { id: 'send', label: 'Отправить сообщение', args: [{ id: 'node', label: 'От', type: 'node' }, { id: 'to', label: 'Кому', type: 'node' }], run(sim, a) { doSend(sim, a.node, a.to); return { text: 'сообщение отправлено ' + a.node + ' → ' + a.to }; } },
      { id: 'compare', label: 'Сравнить события (номера)', args: [{ id: 'a', label: 'Событие a', type: 'number', def: 1 }, { id: 'b', label: 'Событие b', type: 'number', def: 2 }], run(sim, a) { const E = gl(sim).ev, x = E[a.a - 1], y = E[a.b - 1]; if (!x || !y) return { text: 'нет таких событий (всего ' + E.length + ')' }; return { text: '#' + x.id + ' L=' + x.L + ' V=' + vtxt(x.V) + '  vs  #' + y.id + ' L=' + y.L + ' V=' + vtxt(y.V) + ' → по векторным часам: ' + rel(x, y) + '; по Лампорту: ' + (x.L < y.L ? 'a раньше' : x.L > y.L ? 'b раньше' : 'равны') }; } },
    ],
    init(n, sim) { return { L: 0, V: {}, h: { l: 0, c: 0 }, evs: [] }; },
    onStart(ctx) { if (ctx.params.auto) ctx.timer('gen', ctx.rng.int(200, ctx.params.genMs * 2)); },
    onRecover(ctx) { if (ctx.params.auto) ctx.timer('gen', ctx.rng.int(200, ctx.params.genMs * 2)); },
    onTimer(ctx, name) { if (name !== 'gen') return; if (ctx.params.auto) { if (ctx.rng.chance(0.35)) tick(ctx, 'local'); else doSend(ctx.sim, ctx.id, ctx.rng.pick(ctx.peers)); ctx.timer('gen', ctx.rng.int(Math.round(ctx.params.genMs / 2), Math.round(ctx.params.genMs * 1.5))); } },
    onMessage(ctx, m) { tick(ctx, 'recv', m.body); },
    describe(m) { return m.from + ' → ' + m.to + ': сообщение с метками L=' + m.body.L + ', V=' + vtxt(m.body.V) + ', HLC=' + m.body.h.l + '.' + m.body.h.c; },
    label(m) { return 'L' + m.body.L; },
    badge(n) { return 'L=' + n.st.L; },
    nodeClass(n) { return n.up ? 'c-purple' : 'c-gray'; },
    inspector(n, sim) {
      const E = gl(sim).ev; let h = '<p><b>Lamport:</b> ' + n.st.L + '<br><b>Вектор:</b> <span class="mono">' + vtxt(n.st.V) + '</span><br><b>HLC:</b> <span class="mono">' + n.st.h.l + '.' + n.st.h.c + '</span></p><h4>События узла</h4>';
      h += '<table class="tbl"><tr><th>#</th><th>вид</th><th>L</th><th>вектор</th></tr>' + n.st.evs.slice(-14).map(id => { const e = E[id - 1]; return '<tr><td>' + e.id + '</td><td>' + { local: 'лок.', send: 'отпр.', recv: 'получ.' }[e.kind] + '</td><td>' + e.L + '</td><td class="mono">' + vtxt(e.V) + '</td></tr>'; }).join('') + '</table>'; return h;
    },
    metrics(sim) {
      const E = gl(sim).ev.slice(-150); let conc = 0, fals = 0, hb = 0;
      for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) { const a = E[i], b = E[j], ab = vle(a.V, b.V), ba = vle(b.V, a.V); if (!ab && !ba) { conc++; if (a.L !== b.L) fals++; } else hb++; }
      return [{ label: 'событий всего', value: gl(sim).ev.length }, { label: 'пар «произошло-раньше» (из последних 150)', value: hb }, { label: 'конкурентных пар', value: conc }, { label: 'из них Лампорт «упорядочил» ложно', value: fals + ' (метки разные, хотя события независимы)' }];
    },
    defaultScheme() { return ND.makeScheme({ proto: 'clocks', n: 4, topo: 'full', lat: 500, jit: 300, title: 'Логические часы: 4 узла' }); },
  });
  ND.reg.templates.push({ id: 'clk-basic', proto: 'clocks', title: 'Четыре узла, автогенерация', desc: 'Запустите, затем do compare a=3 b=5 — найдите пару конкурентных событий.', build: () => ND.makeScheme({ proto: 'clocks', n: 4, topo: 'full', lat: 500, jit: 300, title: 'Clocks' }) });
  ND.reg.templates.push({ id: 'clk-skew', proto: 'clocks', title: 'HLC при сдвиге часов узла', desc: 'У N3 часы спешат на 10 минут: сравните L и HLC — HLC подтягивает остальных, сохраняя причинность.', build: () => ND.makeScheme({ proto: 'clocks', n: 4, topo: 'full', lat: 500, jit: 300, cfgs: [{}, {}, { skew: 600000 }, {}], title: 'HLC и сдвиг часов' }) });
})(typeof window !== 'undefined' ? window : globalThis);
