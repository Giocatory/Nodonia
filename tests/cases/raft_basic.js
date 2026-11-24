const { load, CORE } = require('../load.js');
const C = load([...CORE, 'scripts/proto/gossip.js', 'scripts/proto/raft.js']); const ND = C.ND;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
// Raft: выбор лидера
let sim = ND.newSim(ND.reg.protocols.raft.defaultScheme()); sim.start();
sim.runUntil(10000);
let L = sim.nodes.filter(n => n.st.role === 'leader'); ok(L.length === 1, 'raft: ровно один лидер, есть ' + L.length);
ok(sim.invariants().every(x => x.ok), 'raft: инварианты');
sim.act('client', { id: 'put', args: { node: 'n3', key: 'x', value: '5' } }); sim.runUntil(sim.now + 3000);
ok(sim.nodes.every(n => n.st.sm.x === '5'), 'raft: x=5 применён на всех: ' + sim.nodes.map(n => n.st.sm.x));
// отказ лидера
const lid = L[0].id; sim.act('crash', { node: lid }); sim.runUntil(sim.now + 12000);
L = sim.nodes.filter(n => n.up && n.st.role === 'leader'); ok(L.length === 1 && L[0].id !== lid, 'raft: новый лидер после отказа');
sim.act('client', { id: 'put', args: { node: L[0].id, key: 'y', value: '7' } }); sim.runUntil(sim.now + 3000);
ok(sim.nodes.filter(n => n.up).every(n => n.st.sm.y === '7'), 'raft: y=7 у живых');
sim.act('recover', { node: lid }); sim.runUntil(sim.now + 6000);
ok(sim.byId[lid].st.sm.y === '7' && sim.byId[lid].st.sm.x === '5', 'raft: восстановленный узел догнал журнал');
ok(sim.invariants().every(x => x.ok) && !sim.violations.length, 'raft: инварианты после отказов');
// раздел 2|3
sim = ND.newSim(ND.reg.protocols.raft.defaultScheme()); sim.start(); sim.runUntil(8000);
sim.act('partition', { groups: [['n1', 'n2'], ['n3', 'n4', 'n5']] }); sim.runUntil(sim.now + 15000);
const maj = sim.nodes.filter(n => ['n3', 'n4', 'n5'].includes(n.id) && n.st.role === 'leader');
ok(maj.length === 1, 'raft: лидер в большинстве ' + maj.length);
sim.act('client', { id: 'put', args: { node: 'n1', key: 'k', value: 'old' } }); sim.runUntil(sim.now + 2000);
sim.act('client', { id: 'put', args: { node: maj[0].id, key: 'k', value: 'new' } }); sim.runUntil(sim.now + 3000);
ok(['n3', 'n4', 'n5'].every(i => sim.byId[i].st.sm.k === 'new'), 'raft: большинство применило new');
sim.act('healall', {}); sim.runUntil(sim.now + 8000);
ok(sim.nodes.every(n => n.st.sm.k === 'new'), 'raft: после слияния все new: ' + sim.nodes.map(n => n.st.sm.k));
ok(!sim.violations.length, 'raft: нет нарушений после раздела');
// воспроизводимость
const a = ND.Sim.replay(ND.cleanScheme(sim.scheme), sim.hist, sim.evCount);
ok(a.evCount === sim.evCount && JSON.stringify(a.nodes.map(n => n.st)) === JSON.stringify(sim.nodes.map(n => n.st)), 'raft: replay даёт то же состояние');
const b = ND.Sim.replay(ND.cleanScheme(sim.scheme), sim.hist, 50); ok(b.evCount === 50, 'raft: replay до события 50');
// unsafeVote: тест на нарушение (подбор seed)
let bad = 0; for (let seed = 1; seed <= 40 && !bad; seed++) {
  const sc = ND.makeScheme({ proto: 'raft', n: 5, topo: 'full', lat: 150, jit: 60, seed, params: { unsafeVote: true } }); const s = ND.newSim(sc); s.start();
  s.runUntil(6000); const l = s.nodes.find(n => n.st.role === 'leader'); if (!l) continue;
  s.act('partition', { groups: [[l.id], s.nodes.filter(n => n.id !== l.id).map(n => n.id)] });
  s.act('client', { id: 'put', args: { node: l.id, key: 'a', value: '1' } }); s.runUntil(s.now + 20000);
  s.act('healall', {}); s.runUntil(s.now + 20000); if (s.violations.length) bad = seed;
}
console.log('unsafeVote нарушение на seed', bad);
// gossip
sim = ND.newSim(ND.reg.protocols.gossip.defaultScheme()); sim.start(); sim.act('client', { id: 'rumor', args: { node: 'n1', value: 'hi' } }); sim.runUntil(60000);
ok(sim.nodes.every(n => n.st.known.r1 === 'hi'), 'gossip: слух дошёл до всех');
for (const mode of ['pull', 'pushpull', 'flood']) { sim = ND.newSim(ND.cleanScheme(Object.assign(ND.reg.protocols.gossip.defaultScheme(), { params: { mode } }))); sim.start(); sim.act('client', { id: 'rumor', args: { node: 'n2', value: 'z' } }); sim.runUntil(60000); ok(sim.nodes.every(n => n.st.known.r1 === 'z'), 'gossip ' + mode + ': охват 100%'); }
// консоль
sim = ND.newSim(ND.reg.protocols.raft.defaultScheme()); const sess = { sim, reset() { }, seed() { } };
let o = ND.console.exec(sess, 'run 6'); o = ND.console.exec(sess, 'nodes'); ok(o.length === 5, 'консоль: nodes');
o = ND.console.exec(sess, 'do put node=n1 key=a value=1'); ok(o[0].t === 'ok', 'консоль: do put');
o = ND.console.exec(sess, 'at 1 crash n2'); ok(o[0].c === 'ok', 'консоль: at'); ND.console.exec(sess, 'run 3'); ok(!sim.byId.n2.up, 'консоль: at crash сработал');
o = ND.console.exec(sess, 'partition n1,n2 | n3,n4,n5'); ok(o[0].t === 'ok', 'консоль: partition');
o = ND.console.exec(sess, 'bogus'); ok(o[0].c === 'bad', 'консоль: неизвестная команда');
console.log(fails ? 'FAILS: ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
