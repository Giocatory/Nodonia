const { load, CORE } = require('../load.js');
const C = load([...CORE, 'scripts/proto/twopc.js']); const ND = C.ND;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const T = id => ND.reg.templates.find(t => t.id === id).build();
const st = s => s.nodes.map(n => n.st.s).join(',');
let s = ND.newSim(T('twopc-ok')); s.start(); s.act('client', { id: 'begin', args: {} }); s.runUntil(8000);
ok(s.nodes.every(n => n.st.s === 'committed'), '2pc: успех — все committed: ' + st(s)); ok(s.invariants().every(x => x.ok), '2pc: атомарность');
s = ND.newSim(T('twopc-no')); s.start(); s.act('client', { id: 'begin', args: {} }); s.runUntil(8000);
ok(s.nodes.every(n => n.st.s === 'aborted'), '2pc: один «нет» → все aborted: ' + st(s));
s = ND.newSim(T('twopc-block')); s.start(); s.act('client', { id: 'begin', args: {} }); s.runUntil(30000);
ok(!s.nodes[0].up && s.nodes.slice(1).every(n => n.st.s === 'ready' && n.st.blocked), '2pc: отказ координатора → участники заблокированы: ' + st(s)); ok(s.invariants().every(x => x.ok), '2pc: при блокировке атомарность не нарушена');
s.act('recover', { node: 'n1' }); s.runUntil(s.now + 10000); ok(s.nodes.every(n => n.st.s === 'aborted'), '2pc: после восстановления координатора — abort: ' + st(s));
s = ND.newSim(ND.cleanScheme(Object.assign(T('twopc-block'), { params: { mode: '3pc' } }))); s.start(); s.act('client', { id: 'begin', args: {} }); s.runUntil(30000);
ok(s.nodes.slice(1).every(n => n.st.s === 'aborted'), '3pc: без блокировки, решение найдено: ' + st(s));
s = ND.newSim(T('twopc-split')); s.start(); s.act('client', { id: 'begin', args: {} }); s.runUntil(30000);
ok(s.nodes.slice(1).every(n => n.st.s === 'committed'), '2pc: частичная рассылка → остальные узнают commit: ' + st(s)); ok(s.invariants().every(x => x.ok), '2pc: атомарность при частичной рассылке');
// 3PC + раздел: нарушение атомарности
s = ND.newSim(ND.makeScheme({ proto: 'twopc', n: 5, topo: 'full', lat: 250, params: { mode: '3pc', timeout: 2000 } })); s.start(); s.act('client', { id: 'begin', args: {} }); s.runUntil(s.now + 700);
s.act('partition', { groups: [['n1', 'n2'], ['n3', 'n4', 'n5']] }); s.runUntil(s.now + 30000);
console.log('3pc split:', st(s), 'violations', s.violations.length);
for (let seed = 1; seed <= 30; seed++) { const q = ND.newSim(ND.makeScheme({ proto: 'twopc', n: 5, topo: 'full', lat: 250, jit: 100, loss: 0.05, seed })); q.start(); q.act('client', { id: 'begin', args: {} }); q.runUntil(20000); if (q.violations.length) ok(false, '2pc: seed ' + seed + ' нарушил атомарность'); }
const r = ND.Sim.replay(ND.cleanScheme(s.scheme), s.hist, s.evCount); ok(JSON.stringify(r.nodes.map(n => n.st)) === JSON.stringify(s.nodes.map(n => n.st)), '2pc: replay');
console.log(fails ? 'FAILS: ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
