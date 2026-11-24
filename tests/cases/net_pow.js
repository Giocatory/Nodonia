const { load, CORE } = require('../load.js');
const C = load([...CORE, 'scripts/proto/pow.js']); const ND = C.ND;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const mk = (o) => ND.newSim(ND.powMk(o));
function stale(sim) { const g = sim.G_pow; const up = sim.nodes.filter(n => n.up); const best = up.reduce((a, n) => n.st.blocks[n.st.tip].cw > a.st.blocks[a.st.tip].cw ? n : a, up[0]); return { s: (g.mined - best.st.blocks[best.st.tip].height) / g.mined, g, best }; }
// 1. сходимость
let s = mk({ seed: 3 }); s.start(); s.runUntil(600000);
let tips = s.nodes.map(n => n.st.blocks[n.st.tip].height); ok(Math.max(...tips) - Math.min(...tips) <= 1, 'pow: высоты сходятся ' + tips);
ok(s.G_pow.mined > 15, 'pow: блоков найдено ' + s.G_pow.mined);
ok(s.invariants().every(x => x.ok), 'pow: инварианты');
// 2. stale растёт с задержкой
let lo = 0, hi = 0; for (let seed = 1; seed <= 6; seed++) { const a = mk({ seed, lat: 500, jit: 200 }); a.start(); a.runUntil(900000); lo += stale(a).s; const b = mk({ seed, lat: 8000, jit: 4000 }); b.start(); b.runUntil(900000); hi += stale(b).s; }
ok(hi > lo * 1.8, 'pow: stale rate растёт с задержкой: ' + (lo / 6).toFixed(3) + ' → ' + (hi / 6).toFixed(3));
const slow = mk({ lat: 8000, jit: 4000, seed: 2 }); slow.start(); slow.runUntil(900000); ok(slow.G_pow.reorgs > 5, 'pow: реорганизации при медленной сети: ' + slow.G_pow.reorgs);
// 3. двойная трата 60%
let succ = 0; for (let seed = 1; seed <= 8; seed++) { const a = mk({ hr: [8, 1, 1, 1, 1, 1], strat: { 0: 'doublespend' }, seed }); a.start(); a.act('client', { id: 'attack_start', args: { node: 'n1', tx: 'pay1' } }); a.act('client', { id: 'tx', args: { node: 'n2', id: 'pay1' } }); a.runUntil(900000); if (Object.keys(a.G_pow.revertedTx).includes('pay1') && a.G_pow.ds >= 1) succ++; }
ok(succ >= 6, 'pow: 60% реально откатывает подтверждённую транзакцию: ' + succ + '/8');
// без атаки с теми же весами — нет откатов
let norev = 0; for (let seed = 1; seed <= 4; seed++) { const a = mk({ seed }); a.start(); a.act('client', { id: 'tx', args: { node: 'n2', id: 'pay1' } }); a.runUntil(400000); if (!Object.keys(a.G_pow.revertedTx).length) norev++; }
ok(norev >= 3, 'pow: без атаки подтверждённые транзакции не откатываются: ' + norev + '/4');
// 4. selfish 40%
let sh = 0, hs = 0, cnt = 0; for (let seed = 1; seed <= 12; seed++) { const a = mk({ hr: [4, 1.5, 1.5, 1.5, 1.5], strat: { 0: 'selfish' }, seed, params: { blockInterval: 10000 }, lat: 800, jit: 400 }); a.start(); a.runUntil(2400000); const r = stale(a); const best = r.best; let x = best.st.blocks[best.st.tip], mine = 0, tot = 0; while (x.id !== 'genesis') { tot++; if (x.miner === 'n1') mine++; x = best.st.blocks[x.parent]; } if (tot > 50) { sh += mine / tot; cnt++; } }
ok(cnt >= 10 && sh / cnt > 0.40 + 0.02, 'pow: selfish 40% получает долю блоков ' + (sh / cnt).toFixed(3) + ' > 0.40');
// 5. догон
s = mk({ seed: 4 }); s.start(); s.act('crash', { node: 'n6' }); s.runUntil(300000); const h0 = s.byId.n6.st.blocks[s.byId.n6.st.tip].height; s.act('recover', { node: 'n6' }); s.runUntil(s.now + 60000);
const hs2 = s.nodes.map(n => n.st.blocks[n.st.tip].height); ok(hs2[5] >= Math.max(...hs2) - 1 && hs2[5] > h0 + 5, 'pow: n6 догнал цепь ' + h0 + ' → ' + hs2[5]);
// 6. replay
s = mk({ seed: 9, lat: 5000 }); s.start(); s.act('client', { id: 'tx', args: { node: 'n1', id: 'a1' } }); s.runUntil(120000); s.act('crash', { node: 'n3' }); s.runUntil(300000);
const r2 = ND.Sim.replay(ND.cleanScheme(s.scheme), s.hist, s.evCount); ok(r2.evCount === s.evCount && JSON.stringify(r2.nodes.map(n => n.st)) === JSON.stringify(s.nodes.map(n => n.st)), 'pow: replay детерминирован');
// 7. 30 случайных seed без исключений и нарушений
let bad = 0; for (let seed = 100; seed < 130; seed++) { try { const a = mk({ seed, lat: 300 + (seed % 7) * 1500, hr: [1 + seed % 3, 1, 1, 2, 1, 1], strat: seed % 4 === 0 ? { 0: 'selfish' } : {} }); a.start(); a.act('client', { id: 'tx', args: { node: 'n2', id: 'x' + seed } }); a.runUntil(200000); if (seed % 5 === 0) a.act('partition', { groups: [['n1', 'n2', 'n3'], ['n4', 'n5', 'n6']] }); a.runUntil(400000); if (seed % 5 === 0) a.act('healall', {}); a.runUntil(600000); if (a.violations.length) bad++; } catch (e) { bad++; console.log(e.stack); } }
ok(bad === 0, 'pow: 30 случайных прогонов без исключений и нарушений (' + bad + ')');
console.log(fails ? 'FAILS: ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
