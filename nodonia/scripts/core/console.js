/* Нодония — консоль управления кластером (без DOM, поэтому тестируется в Node).
   exec(sess, строка) → массив строк вывода [{t: текст, c: класс}]. sess = { sim, reset(), seed(n) } */
(function (G) {
  'use strict';
  const ND = G.ND;
  const out = (t, c) => ({ t, c: c || '' });

  const HELP = {
    help: ['help [команда]', 'справка по командам'],
    nodes: ['nodes', 'список узлов и их состояние'],
    links: ['links', 'список каналов (задержка, джиттер, потери)'],
    status: ['status', 'время, число событий, сообщения, нарушения инвариантов'],
    state: ['state N', 'внутреннее состояние узла N (JSON)'],
    crash: ['crash N…', 'отказ узла: он перестаёт отвечать, таймеры сбрасываются'],
    recover: ['recover N…', 'восстановление узла'],
    cut: ['cut A B', 'оборвать канал между A и B'],
    heal: ['heal [A B | all]', 'восстановить канал; без аргументов — все каналы'],
    partition: ['partition A,B | C,D', 'разделить сеть на группы: оборвать все каналы между группами'],
    link: ['link A B lat=200 jit=30 loss=0.1 dup=0.05', 'изменить свойства канала'],
    cfg: ['cfg N ключ значение', 'настройка узла (например hashrate, stake, byz)'],
    param: ['param ключ значение', 'параметр протокола'],
    actions: ['actions', 'список клиентских действий протокола'],
    do: ['do действие ключ=значение …', 'выполнить клиентское действие (например: do put node=n1 value=42)'],
    run: ['run СЕК', 'выполнить симуляцию на СЕК виртуальных секунд'],
    step: ['step [K]', 'выполнить K событий (по умолчанию 1)'],
    at: ['at СЕК команда…', 'запланировать crash/recover/cut/heal/partition/do через СЕК секунд'],
    log: ['log [K]', 'последние K записей журнала'],
    inv: ['inv', 'проверить инварианты безопасности протокола'],
    reset: ['reset', 'начать симуляцию заново (схема и seed сохраняются)'],
    seed: ['seed N', 'сменить seed ГПСЧ и начать заново'],
    clear: ['clear', 'очистить консоль'],
  };

  function node(sim, ref) {
    if (!ref) return null; const r = ref.toLowerCase();
    return sim.nodes.find(n => n.id.toLowerCase() === r || n.name.toLowerCase() === r) || null;
  }
  function kv(args) { const o = {}, rest = []; for (const a of args) { const m = /^([A-Za-z_][\w]*)=(.*)$/.exec(a); if (m) { const v = m[2]; o[m[1]] = v !== '' && !isNaN(v) ? +v : (v === 'true' ? true : v === 'false' ? false : v); } else rest.push(a); } return { o, rest }; }

  ND.fmtLog = function (e) {
    const t = (e.t / 1000).toFixed(3).padStart(8) + ' с';
    return t + '  ' + (e.text || e.k);
  };

  /** разобрать команду, пригодную для записи в историю: вернуть {kind,args} либо {err} */
  function parseAct(sim, w) {
    const c = w[0];
    if (c === 'crash' || c === 'recover') {
      const ns = w.slice(1).map(r => node(sim, r)); if (!ns.length || ns.some(x => !x)) return { err: 'неизвестный узел: ' + w.slice(1).join(' ') };
      return { list: ns.map(n => ({ kind: c, args: { node: n.id } })) };
    }
    if (c === 'cut' || c === 'heal') {
      if (c === 'heal' && (w.length < 2 || w[1] === 'all')) return { list: [{ kind: 'healall', args: {} }] };
      const a = node(sim, w[1]), b = node(sim, w[2]); if (!a || !b) return { err: 'синтаксис: ' + c + ' A B' };
      if (!sim.linkBetween(a.id, b.id)) return { err: 'между ' + a.name + ' и ' + b.name + ' нет канала' };
      return { list: [{ kind: c, args: { a: a.id, b: b.id } }] };
    }
    if (c === 'partition') {
      const groups = w.slice(1).join(' ').split('|').map(g => g.split(/[,\s]+/).filter(Boolean).map(r => node(sim, r)));
      if (groups.length < 2 || groups.some(g => !g.length || g.some(x => !x))) return { err: 'синтаксис: partition A,B | C,D' };
      return { list: [{ kind: 'partition', args: { groups: groups.map(g => g.map(n => n.id)) } }] };
    }
    if (c === 'do') {
      const ac = (sim.def.actions || []).find(a => a.id === w[1]); if (!ac) return { err: 'нет такого действия; список: actions' };
      const { o } = kv(w.slice(2)); if (o.node) { const n = node(sim, String(o.node)); if (!n) return { err: 'неизвестный узел ' + o.node }; o.node = n.id; }
      return { list: [{ kind: 'client', args: { id: ac.id, args: o } }] };
    }
    return { err: 'эту команду нельзя отложить' };
  }

  ND.console = {
    HELP,
    exec(sess, line) {
      const sim = sess.sim; line = String(line || '').trim(); if (!line) return [];
      const w = line.split(/\s+/), c = w[0].toLowerCase(); w[0] = c; const o = [];
      try {
        switch (c) {
          case 'help': case '?': {
            if (w[1] && HELP[w[1]]) { o.push(out(HELP[w[1]][0], 'cmd')); o.push(out('  ' + HELP[w[1]][1])); break; }
            o.push(out('Команды (в скобках — аргументы). Для протокола «' + sim.def.title + '» доступны ещё клиентские действия: actions', 'hd'));
            for (const k in HELP) o.push(out('  ' + HELP[k][0].padEnd(40) + HELP[k][1]));
            break; }
          case 'nodes': for (const n of sim.nodes) o.push(out((n.up ? '●' : '○') + ' ' + n.id.padEnd(5) + n.name.padEnd(10) + (n.up ? 'работает' : 'ОТКАЗАЛ') + '  ' + (sim.def.badge ? sim.def.badge(n, sim) : ''), n.up ? '' : 'bad')); break;
          case 'links': for (const l of sim.links) o.push(out((l.up ? '─' : '╳') + ' ' + l.a + '—' + l.b + '  задержка ' + l.lat + ' мс, джиттер ' + l.jit + ', потери ' + Math.round(l.loss * 100) + '%, дубли ' + Math.round(l.dup * 100) + '%' + (l.up ? '' : '  [ОБОРВАН]'), l.up ? '' : 'bad')); break;
          case 'status': { const s = sim.summary(); o.push(out('время ' + ND.fmtT(s.t) + ', событий ' + s.ev + ', живых узлов ' + s.up + '/' + s.n)); o.push(out('сообщений: отправлено ' + s.stats.sent + ', доставлено ' + s.stats.delivered + ', потеряно ' + s.stats.dropped)); o.push(out('нарушений инвариантов: ' + s.violations, s.violations ? 'bad' : 'ok')); if (sim.def.metrics) for (const m of sim.def.metrics(sim)) o.push(out('  ' + m.label + ': ' + m.value)); break; }
          case 'state': { const n = node(sim, w[1]); if (!n) { o.push(out('синтаксис: state N', 'bad')); break; } o.push(out(JSON.stringify(n.st, (k, v) => typeof v === 'bigint' ? v.toString() : v, 1).slice(0, 4000))); break; }
          case 'crash': case 'recover': case 'cut': case 'heal': case 'partition': case 'do': {
            const p = parseAct(sim, w); if (p.err) { o.push(out(p.err, 'bad')); break; }
            for (const a of p.list) sim.act(a.kind, a.args);
            o.push(out('ok', 'ok')); break; }
          case 'link': {
            const a = node(sim, w[1]), b = node(sim, w[2]); if (!a || !b || !sim.linkBetween(a.id, b.id)) { o.push(out('синтаксис: link A B lat=… jit=… loss=… dup=…', 'bad')); break; }
            const { o: k } = kv(w.slice(3)); sim.act('setlink', { a: a.id, b: b.id, lat: k.lat, jit: k.jit, loss: k.loss, dup: k.dup }); o.push(out('ok', 'ok')); break; }
          case 'cfg': { const n = node(sim, w[1]); if (!n || !w[2] || w[3] === undefined) { o.push(out('синтаксис: cfg N ключ значение', 'bad')); break; } let v = w.slice(3).join(' '); v = v !== '' && !isNaN(v) ? +v : (v === 'true' ? true : v === 'false' ? false : v); sim.act('setcfg', { node: n.id, key: w[2], value: v }); o.push(out('ok', 'ok')); break; }
          case 'param': { if (!w[1] || w[2] === undefined) { o.push(out('синтаксис: param ключ значение; параметры: ' + (sim.def.params || []).map(p => p.id).join(', '), 'bad')); break; } if (!(sim.def.params || []).some(p => p.id === w[1])) { o.push(out('нет такого параметра', 'bad')); break; } let v = w[2]; v = !isNaN(v) ? +v : (v === 'true' ? true : v === 'false' ? false : v); sim.act('setparam', { key: w[1], value: v }); o.push(out('ok', 'ok')); break; }
          case 'actions': for (const a of sim.def.actions || []) o.push(out('  do ' + a.id.padEnd(14) + ' ' + a.label + (a.args ? '  [' + a.args.map(x => x.id + '=…').join(' ') + ']' : ''))); if (!(sim.def.actions || []).length) o.push(out('у этого протокола нет клиентских действий')); break;
          case 'run': { const s = parseFloat(w[1]); if (!(s > 0) || s > 36000) { o.push(out('синтаксис: run СЕК (0…36000)', 'bad')); break; } const n = sim.runUntil(sim.now + s * 1000, 200000); o.push(out('выполнено событий: ' + n + ', время ' + ND.fmtT(sim.now))); break; }
          case 'step': { const k = Math.max(1, Math.min(5000, parseInt(w[1] || '1', 10) || 1)); let n = 0; while (n < k) { const r = sim.step(); if (!r) break; n++; if (k === 1) for (const e of r.logs) o.push(out(ND.fmtLog(e), e.cls)); } o.push(out('выполнено событий: ' + n + (n < k ? ' (очередь пуста)' : ''))); break; }
          case 'at': { const s = parseFloat(w[1]); if (!(s >= 0) || w.length < 3) { o.push(out('синтаксис: at СЕК команда', 'bad')); break; } const p = parseAct(sim, w.slice(2).map((x, i) => i ? x : x.toLowerCase())); if (p.err) { o.push(out(p.err, 'bad')); break; } for (const a of p.list) sim.act('at', { delay: s * 1000, action: a }); o.push(out('запланировано на t = ' + ND.fmtT(sim.now + s * 1000), 'ok')); break; }
          case 'log': { const k = Math.max(1, Math.min(300, parseInt(w[1] || '20', 10) || 20)); for (const e of sim.log.slice(-k)) o.push(out(ND.fmtLog(e), e.cls)); break; }
          case 'inv': { const r = sim.invariants(); if (!r.length) o.push(out('у протокола нет проверяемых инвариантов')); for (const x of r) o.push(out((x.ok ? '✔ ' : '✘ ') + x.text, x.ok ? 'ok' : 'bad')); break; }
          case 'reset': if (sess.reset) { sess.reset(); o.push(out('симуляция начата заново', 'ok')); } break;
          case 'seed': { const v = parseInt(w[1], 10); if (!(v > 0)) { o.push(out('синтаксис: seed N (N ≥ 1)', 'bad')); break; } if (sess.seed) { sess.seed(v); o.push(out('seed = ' + v + ', симуляция начата заново', 'ok')); } break; }
          case 'clear': o.push({ clear: true }); break;
          default: o.push(out('неизвестная команда «' + c + '». Введите help', 'bad'));
        }
      } catch (e) { o.push(out('ошибка: ' + (e && e.message), 'bad')); }
      return o;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
