const { load, CORE } = require('../load.js');
const C = load([...CORE, 'scripts/proto/quorum.js']); const ND = C.ND;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const mk = (p, seed, jit) => { const s = ND.newSim(ND.makeScheme({ proto: 'quorum', n: 5, topo: 'full', lat: 250, jit: jit || 60, params: p, seed })); s.start(); return s; };
let stale = 0, strictStale = 0;
for (let seed = 1; seed <= 40; seed++) {
  for (const [R, W] of [[1, 1], [2, 2]]) {
    const s = mk({ N: 3, R, W }, seed, 900); s.act('client', { id: 'write', args: { node: 'n1', key: 'k', value: 'A' } }); s.runUntil(s.now + 3000);
    s.act('client', { id: 'write', args: { node: 'n2', key: 'k', value: 'B' } }); s.runWhile(q => q.G_quorum.wOk >= 2, s.now + 9000); s.runUntil(s.now + 1);
    s.act('client', { id: 'read', args: { node: 'n4', key: 'k' } }); s.runUntil(s.now + 4000);
    if (R === 1) stale += s.G_quorum.stale; else strictStale += s.G_quorum.stale;
    if (R === 2 && s.violations.length) strictStale += 100;
  }
}
ok(strictStale === 0, 'quorum: при R+W>N устаревших чтений нет');
ok(stale > 0, 'quorum: при R=W=1 бывают устаревшие чтения (' + stale + ')');
let s = mk({ N: 3, R: 2, W: 2 }, 1); s.act('partition', { groups: [['n1', 'n2', 'n3'], ['n4', 'n5']] });
const P = ['n1', 'n2', 'n3', 'n4', 'n5']; s.act('client', { id: 'write', args: { node: 'n4', key: 'k', value: 'X' } }); s.runUntil(s.now + 5000);
ok(s.G_quorum.wFail === 1 && s.G_quorum.wOk === 0, 'quorum: в меньшей части запись проваливается');
for (let seed = 1; seed <= 30; seed++) { const q = mk({ N: 3, R: 1, W: 2, readRepair: true }, seed); q.act('client', { id: 'write', args: { node: 'n1', key: 'a', value: '1' } }); q.runUntil(3000); q.act('client', { id: 'read', args: { node: 'n2', key: 'a' } }); q.runUntil(6000); }
ok(true, 'quorum: 30 seed без исключений');
const a = ND.Sim.replay(ND.cleanScheme(s.scheme), s.hist, s.evCount); ok(JSON.stringify(a.nodes.map(n => n.st)) === JSON.stringify(s.nodes.map(n => n.st)), 'quorum: replay');
console.log(fails ? 'FAILS ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
