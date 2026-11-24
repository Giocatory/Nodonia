const { load, CORE } = require('../load.js');
const C = load([...CORE, 'scripts/proto/paxos.js']); const ND = C.ND;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const P = ND.reg.protocols.paxos;
let sim = ND.newSim(P.defaultScheme()); sim.start(); sim.act('client', { id: 'propose', args: { node: 'n1', value: 'A' } }); sim.runUntil(8000);
ok(sim.nodes.every(n => n.st.decided === 'A'), 'paxos: все узнали A');
ok(sim.invariants().every(x => x.ok), 'paxos: инварианты');
// два пропоузера: решение одно
let all = true, dead = 0;
for (let seed = 1; seed <= 30; seed++) { const s = ND.newSim(ND.makeScheme({ proto: 'paxos', n: 5, topo: 'full', lat: 200, jit: 120, loss: 0.05, seed })); s.start(); s.act('client', { id: 'propose', args: { node: 'n1', value: 'A' } }); s.runUntil(s.now + 100); s.act('client', { id: 'propose', args: { node: 'n3', value: 'B' } }); s.runUntil(80000);
  const d = s.nodes.map(n => n.st.decided).filter(v => v !== null); if (new Set(d).size > 1 || s.violations.length) all = false; if (!d.length) dead++; }
ok(all, 'paxos: 30 seed двух пропоузеров — всегда не более одного решения'); ok(dead <= 3, 'paxos: решение достигается почти всегда (без решения ' + dead + '/30)');
// отказ меньшинства
sim = ND.newSim(ND.makeScheme({ proto: 'paxos', n: 5, topo: 'full', lat: 200 })); sim.start(); sim.act('crash', { node: 'n4' }); sim.act('crash', { node: 'n5' }); sim.act('client', { id: 'propose', args: { node: 'n1', value: 'X' } }); sim.runUntil(10000);
ok(sim.nodes.filter(n => n.up).every(n => n.st.decided === 'X'), 'paxos: 3 из 5 живых достаточно');
sim.act('crash', { node: 'n3' }); sim = ND.newSim(ND.makeScheme({ proto: 'paxos', n: 5, topo: 'full', lat: 200 })); sim.start(); ['n3', 'n4', 'n5'].forEach(i => sim.act('crash', { node: i })); sim.act('client', { id: 'propose', args: { node: 'n1', value: 'X' } }); sim.runUntil(20000);
ok(sim.nodes.every(n => n.st.decided === null), 'paxos: без большинства решения нет');
// дуэль: livelock
const duel = ND.reg.templates.find(t => t.id === 'paxos-duel').build(); sim = ND.newSim(duel); sim.start(); sim.act('client', { id: 'propose', args: { node: 'n1', value: 'A' } }); sim.runUntil(sim.now + 100); sim.act('client', { id: 'propose', args: { node: 'n2', value: 'B' } }); sim.runUntil(60000);
const nd = sim.nodes.filter(n => n.st.decided !== null).length; console.log('duel: решили', nd, 'раундов', sim.G_paxos.rounds);
ok(nd === 0 && sim.G_paxos.rounds > 20, 'paxos: дуэль без случайной паузы → livelock (нет решения, много раундов)');
sim = ND.newSim(ND.cleanScheme(Object.assign(duel, { params: { randomBackoff: true, retryMin: 350, retryMax: 1500 } }))); sim.start(); sim.act('client', { id: 'propose', args: { node: 'n1', value: 'A' } }); sim.runUntil(sim.now + 100); sim.act('client', { id: 'propose', args: { node: 'n2', value: 'B' } }); sim.runUntil(60000);
ok(sim.nodes.some(n => n.st.decided !== null), 'paxos: случайная пауза выводит из livelock');
// unsafe
let viol = 0, safeV = 0; for (let seed = 1; seed <= 40; seed++) for (const unsafe of [true, false]) { const s = ND.newSim(ND.makeScheme({ proto: 'paxos', n: 5, topo: 'full', lat: 200, jit: 40, seed, params: { unsafeProposer: unsafe } })); s.start(); s.act('crash', { node: 'n2' }); s.act('crash', { node: 'n3' }); s.act('client', { id: 'propose', args: { node: 'n1', value: 'A' } }); s.runUntil(6000); s.act('recover', { node: 'n2' }); s.act('recover', { node: 'n3' }); s.act('client', { id: 'propose', args: { node: 'n2', value: 'B' } }); s.runUntil(40000); if (s.violations.length) { if (unsafe) viol++; else safeV++; } }
ok(viol > 30, 'paxos: unsafeProposer нарушает согласие (' + viol + '/40)'); ok(safeV === 0, 'paxos: обычный пропоузер не нарушает согласие');
const r = ND.Sim.replay(ND.cleanScheme(sim.scheme), sim.hist, sim.evCount); ok(JSON.stringify(r.nodes.map(n => n.st)) === JSON.stringify(sim.nodes.map(n => n.st)), 'paxos: replay');
console.log(fails ? 'FAILS: ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
