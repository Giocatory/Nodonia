const { load, CORE } = require('../load.js');
const C = load([...CORE, 'scripts/proto/services.js']); const ND = C.ND;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const T = ND.reg.templates.filter(t => t.proto === 'services'); ok(T.length >= 7, 'шаблонов архитектур: ' + T.length);
const run = (sch, sec, f) => { const s = ND.newSim(sch); s.start(); if (f) f(s); s.runUntil(sec * 1000); return s; };
for (const t of T) { let s, err = null; try { s = run(t.build(), 20); } catch (e) { err = e; } ok(!err && s.G_svc.ok > 0 && !s.violations.length, t.id + ': работает (ok=' + (s && s.G_svc.ok) + ', fail=' + (s && s.G_svc.failed) + ')' + (err ? ' ' + err.stack : '')); }
const tpl = id => ND.reg.templates.find(t => t.id === id).build();
// монолит: всплеск → отказы/рост задержки
const a = run(tpl('svc-monolith'), 20), b = run(tpl('svc-monolith'), 20, s => s.act('client', { id: 'burst', args: { mult: 6, sec: 15 } }));
ok(b.G_svc.failed > a.G_svc.failed || b.G_svc.lat.length && Math.max(...b.G_svc.lat.map(x => x[1])) > Math.max(...a.G_svc.lat.map(x => x[1])), 'монолит: всплеск ухудшает отказы/задержку (' + a.G_svc.failed + ' → ' + b.G_svc.failed + ')');
// трёхзвенка: падение одного сервиса — LB исключает, ошибок мало
const sch = tpl('svc-threetier'); const svc = sch.nodes.filter(n => n.kind === 'service')[0].id;
const c = run(sch, 30, s => { s.runUntil(5000); s.act('crash', { node: svc }); }); const tot = c.G_svc.ok + c.G_svc.failed;
ok(c.G_svc.ok / tot > 0.7, 'трёхзвенка: после падения сервиса доля успеха ' + (100 * c.G_svc.ok / tot).toFixed(0) + ' %');
// кэш: hit ratio > 0
const d = run(tpl('svc-cache'), 30); ok(d.G_svc.cacheHit > 0, 'кэш: попадания ' + d.G_svc.cacheHit + ' / промахи ' + d.G_svc.cacheMiss);
// детерминизм
const e1 = run(tpl('svc-cascade'), 25), e2 = run(tpl('svc-cascade'), 25); ok(JSON.stringify(e1.G_svc.series) === JSON.stringify(e2.G_svc.series), 'детерминизм серий');
// каскад: ретраи усиливают нагрузку, breaker помогает
const casc = (p) => { const sc = tpl('svc-cascade'); Object.assign(sc.params, p); const sv = sc.nodes.find(n => n.kind === 'service').id; return run(sc, 40, s => { s.runUntil(5000); s.act('client', { id: 'slowdown', args: { node: sv, factor: 3 } }); }); };
const r0 = casc({ retries: 0 }), r3 = casc({ retries: 3 }), br = casc({ retries: 3, breaker: true });
ok(r3.G_svc.sent > r0.G_svc.sent && r3.G_svc.retries > 0, 'ретраи увеличивают число запросов: ' + r0.G_svc.sent + ' → ' + r3.G_svc.sent);
console.log('  breaker trips', br.G_svc.trips, 'fail', br.G_svc.failed, 'vs', r3.G_svc.failed);
ok(br.G_svc.trips > 0, 'circuit breaker срабатывает');
// очередь
const q = run(tpl('svc-queue'), 20, s => s.act('client', { id: 'burst', args: { mult: 5, sec: 10 } })); ok(q.G_svc.async > 0 && q.G_svc.jobsDone > 0, 'очередь: асинхронно ' + q.G_svc.async + ', выполнено ' + q.G_svc.jobsDone);
console.log(fails ? 'FAILS ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
