const { load, CORE } = require('../load.js');
const C = load([...CORE, 'scripts/proto/streamlog.js']); const ND = C.ND;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const T = id => ND.newSim(ND.reg.templates.find(t => t.id === id).build());
const lostOf = s => ND.reg.protocols.streamlog.metrics(s).find(m => m.label.includes('потеряно')).value;
function scen(id, seed) { const s = T(id); if (seed) s.scheme.seed = seed; s.start(); for (let i = 0; i < 6; i++) { s.act('client', { id: 'produce', args: { node: 'n4', key: 'k' + i, value: 'm' + i } }); s.runUntil(s.now + 60); } s.act('crash', { node: 'n1' }); s.act('crash', { node: 'n2' }); s.runUntil(s.now + 20000); return s; }
let s = T('sl-acksall'); s.start(); for (let i = 0; i < 6; i++) { s.act('client', { id: 'produce', args: { node: 'n4', key: 'k' + i, value: 'm' + i } }); s.runUntil(s.now + 100); } s.runUntil(s.now + 5000);
ok(s.G_sl.acked.length === 6, 'streamlog: acks=all — все 6 подтверждены (' + s.G_sl.acked.length + ')');
const ids = new Set(s.G_sl.consumed.map(c => c.id)); ok(ids.size === 6, 'streamlog: потребители прочитали все 6 (' + ids.size + ')');
let lossAll = 0, lossOne = 0; for (let seed = 1; seed <= 12; seed++) { lossOne += lostOf(scen('sl-acks1', seed)); lossAll += lostOf(scen('sl-acksall', seed)); }
ok(lossOne > 0, 'streamlog: acks=1 + отказ лидера теряет подтверждённое (' + lossOne + ')'); ok(lossAll === 0, 'streamlog: acks=all не теряет (' + lossAll + ')');
s = T('sl-rebalance'); s.start(); for (let i = 0; i < 6; i++) { s.act('client', { id: 'produce', args: { node: 'n4', key: 'k' + i, value: 'm' + i } }); s.runUntil(s.now + 100); } s.runUntil(s.now + 3000); const reb = s.G_sl.rebalances; s.act('crash', { node: 'n5' }); s.runUntil(s.now + 15000);
ok(s.G_sl.rebalances > reb, 'streamlog: ребалансировка после отказа потребителя'); ok(s.nodes[5].st.assigned.length === 3, 'streamlog: все партиции перешли оставшемуся потребителю');
const r = ND.Sim.replay(ND.cleanScheme(s.scheme), s.hist, s.evCount); ok(JSON.stringify(r.nodes.map(n => n.st)) === JSON.stringify(s.nodes.map(n => n.st)), 'streamlog: replay');
console.log(fails ? 'FAILS ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
