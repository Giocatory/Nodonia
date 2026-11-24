const { load, CORE } = require('../load.js');
const C = load([...CORE, 'scripts/proto/pbft.js']); const ND = C.ND;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const T = id => ND.reg.templates.find(t => t.id === id).build();
const run = (id, reqs, t, seed) => { const sc = T(id); if (seed) sc.seed = seed; const s = ND.newSim(sc); s.start(); for (const r of reqs) { s.act('client', { id: 'request', args: { value: r } }); s.runUntil(s.now + 300); } s.runUntil(s.now + t); return s; };
const ex = s => s.nodes.map(n => n.st.executed.join('>')).join(' | ');
let s = run('pbft-4', ['tx1', 'tx2'], 8000); ok(s.nodes.every(n => n.st.executed.join() === 'tx1,tx2'), 'pbft: 4 честных выполнили tx1,tx2: ' + ex(s)); ok(s.G_pbft.confirmed.length === 2, 'pbft: клиент получил f+1 ответов');
s = run('pbft-silent-leader', ['tx1'], 40000); ok(s.nodes.slice(1).every(n => n.st.executed.join() === 'tx1'), 'pbft: молчащий лидер → смена вида, запрос выполнен: ' + ex(s)); ok(s.G_pbft.viewChanges > 0, 'pbft: была смена вида'); ok(s.nodes[1].st.view >= 1, 'pbft: вид вырос');
s = run('pbft-liar', ['tx1', 'tx2'], 10000); ok(s.nodes.filter(n => !n.cfg.byz || n.cfg.byz === 'none').every(n => n.st.executed.join() === 'tx1,tx2'), 'pbft: один лжец не мешает: ' + ex(s));
let bad = 0; for (let seed = 1; seed <= 30; seed++) { const q = run('pbft-equiv', ['tx1'], 40000, seed); if (q.violations.length) bad++; }
ok(bad === 0, 'pbft: двуличный лидер при f=1 — безопасность держится на 30 seed (нарушений ' + bad + ')');
let broken = 0; for (let seed = 1; seed <= 30; seed++) { const q = run('pbft-break', ['tx1'], 30000, seed); if (q.violations.length) broken++; }
console.log('f+1 предателей: нарушений безопасности', broken, '/ 30'); ok(broken > 0, 'pbft: при f+1 предателях безопасность можно сломать');
s = run('pbft-7', ['a', 'b', 'c'], 20000); const hon = s.nodes.filter(n => !n.cfg.byz || n.cfg.byz === 'none'); ok(hon.every(n => n.st.executed.join() === 'a,b,c'), 'pbft: 7 узлов, 2 предателя: ' + ex(s));
for (let seed = 1; seed <= 30; seed++) { const q = ND.newSim(ND.makeScheme({ proto: 'pbft', n: 4, topo: 'full', lat: 200, jit: 150, loss: 0.1, seed })); q.start(); q.act('client', { id: 'request', args: { value: 'z' } }); q.runUntil(30000); if (q.violations.length) ok(false, 'seed ' + seed + ' нарушение'); }
const r = ND.Sim.replay(ND.cleanScheme(s.scheme), s.hist, s.evCount); ok(JSON.stringify(r.nodes.map(n => n.st)) === JSON.stringify(s.nodes.map(n => n.st)), 'pbft: replay');
console.log(fails ? 'FAILS: ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
