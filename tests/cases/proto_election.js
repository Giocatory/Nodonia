const { load, CORE } = require('../load.js');
const C = load([...CORE, 'scripts/proto/election.js']); const ND = C.ND;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
for (const pid of ['bully', 'ring']) {
  let sim = ND.newSim(ND.reg.protocols[pid].defaultScheme()); sim.start(); sim.runUntil(15000);
  let L = sim.nodes.filter(n => n.st.leader === n.id); const top = sim.nodes[sim.nodes.length - 1].id;
  ok(L.length === 1 && L[0].id === top, pid + ': лидер — старший узел ' + top + ', есть ' + L.map(n => n.id));
  ok(sim.nodes.every(n => n.st.leader === top), pid + ': все знают лидера');
  sim.act('crash', { node: top }); sim.runUntil(sim.now + 20000);
  const second = sim.nodes[sim.nodes.length - 2].id; L = sim.nodes.filter(n => n.up && n.st.leader === n.id);
  ok(L.length === 1 && L[0].id === second, pid + ': после отказа лидер ' + second + ' (есть ' + L.map(n => n.id) + ')');
  sim.act('recover', { node: top }); sim.runUntil(sim.now + 20000);
  ok(sim.nodes.every(n => n.st.leader === top), pid + ': старший вернул лидерство: ' + sim.nodes.map(n => n.st.leader));
  ok(sim.invariants().every(x => x.ok) && !sim.violations.length, pid + ': инварианты');
  // раздел
  sim = ND.newSim(ND.reg.protocols[pid].defaultScheme()); sim.start(); sim.runUntil(12000);
  const ids = sim.nodes.map(n => n.id), h = ids.length >> 1; sim.act('partition', { groups: [ids.slice(0, h), ids.slice(h)] }); sim.runUntil(sim.now + 25000);
  ok(sim.nodes.filter(n => n.up && n.st.leader === n.id).length === 2, pid + ': в разделённой сети два лидера (split-brain)');
  ok(!sim.violations.length, pid + ': split-brain в разных частях не считается нарушением');
  sim.act('healall', {}); sim.runUntil(sim.now + 25000);
  ok(sim.nodes.filter(n => n.up && n.st.leader === n.id).length === 1, pid + ': после слияния один лидер');
  const r = ND.Sim.replay(ND.cleanScheme(sim.scheme), sim.hist, sim.evCount); ok(JSON.stringify(r.nodes.map(n => n.st)) === JSON.stringify(sim.nodes.map(n => n.st)), pid + ': replay');
  let err = 0; for (let s = 1; s <= 30; s++) { try { const sc = ND.makeScheme({ proto: pid, n: 3 + s % 5, topo: pid === 'ring' ? 'ring' : 'full', lat: 100 + s * 10, jit: 50, loss: 0.1, seed: s }); const x = ND.newSim(sc); x.start(); x.runUntil(5000); x.act('crash', { node: 'n2' }); x.runUntil(15000); x.act('recover', { node: 'n2' }); x.runUntil(30000); } catch (e) { err++; console.log(e.stack); } }
  ok(err === 0, pid + ': 30 seed без исключений');
}
// кольцо: сообщения подменяются приоритетом
let sim = ND.newSim(ND.reg.protocols.ring.defaultScheme()); sim.start(); sim.runUntil(30000); ok(sim.stats.byType.ELECTION > 0 && sim.stats.byType.ELECTED > 0, 'ring: сообщения ELECTION/ELECTED');
console.log(fails ? 'FAILS: ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
