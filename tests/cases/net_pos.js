const { load, CORE } = require('../load.js');
const C = load([...CORE, 'scripts/proto/pos.js']); const ND = C.ND;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const mk = o => ND.newSim(ND.posMk(o || {}));
const fin = s => Math.max(...s.nodes.filter(n => n.up).map(n => n.st.finEp));
// 1. нормальная работа
let s = mk(); s.start(); s.runUntil(150000);
ok(fin(s) >= 8, 'pos: финализация идёт, эпоха ' + fin(s));
ok(s.G_pos.produced >= s.G_pos.maxSlot - 1, 'pos: почти каждый слот имеет блок ' + s.G_pos.produced + '/' + s.G_pos.maxSlot);
ok(s.invariants().every(x => x.ok) && !s.violations.length, 'pos: инварианты');
ok(new Set(s.nodes.map(n => n.st.finEp)).size <= 2, 'pos: узлы согласны по финальной эпохе');
// 2. 20% офлайн — финальность идёт
s = mk({ stakes: [32, 32, 32, 32, 32] }); s.start(); s.act('crash', { node: 'n5' }); s.runUntil(150000);
ok(fin(s) >= 6, 'pos: при отказе 20% финальность идёт (эпоха ' + fin(s) + ')');
// 3. 40% офлайн — стоп, затем утечка
s = mk({ stakes: [32, 32, 32, 32, 32], params: { leakAfter: 3, leakPct: 10 } }); s.start(); s.runUntil(60000); const f0 = fin(s);
s.act('crash', { node: 'n4' }); s.act('crash', { node: 'n5' }); s.runUntil(s.now + 50000); const f1 = fin(s);
ok(f1 <= f0 + 1, 'pos: при отказе 40% финальность останавливается (' + f0 + ' → ' + f1 + ')');
s.runUntil(s.now + 400000); const f2 = fin(s);
ok(s.G_pos.leaked > 0, 'pos: сработала утечка неактивности (' + s.G_pos.leaked + ')');
ok(f2 > f1 + 2, 'pos: утечка восстановила финальность (' + f1 + ' → ' + f2 + ')');
ok(s.byId.n1.st.stakes.n4 < 32, 'pos: стейк отсутствующих сжёгся: ' + s.byId.n1.st.stakes.n4.toFixed(1));
ok(!s.violations.length, 'pos: без нарушений после остановки финальности');
// 4. slashing
s = mk(); s.start(); s.runUntil(45000); s.act('client', { id: 'equivocate', args: { node: 'n3' } }); s.runUntil(s.now + 20000);
ok(s.nodes.every(n => n.st.slashed.n3 === 1), 'pos: все узлы срезали n3');
ok(s.byId.n1.st.stakes.n3 === 16, 'pos: стейк n3 уменьшен вдвое (' + s.byId.n1.st.stakes.n3 + ')');
s.runUntil(s.now + 100000); ok(fin(s) >= 8 && !s.violations.length, 'pos: после slashing сеть продолжает финализировать');
// 5. восстановление
s = mk(); s.start(); s.act('crash', { node: 'n2' }); s.runUntil(80000); s.act('recover', { node: 'n2' }); s.runUntil(s.now + 40000);
ok(s.byId.n2.st.finEp >= fin(s) - 1, 'pos: n2 догнал финальность ' + s.byId.n2.st.finEp + '/' + fin(s));
// 6. replay
s = mk({ seed: 5 }); s.start(); s.runUntil(40000); s.act('client', { id: 'equivocate', args: { node: 'n2' } }); s.runUntil(90000);
const r = ND.Sim.replay(ND.cleanScheme(s.scheme), s.hist, s.evCount); ok(r.evCount === s.evCount && JSON.stringify(r.nodes.map(n => n.st)) === JSON.stringify(s.nodes.map(n => n.st)), 'pos: replay детерминирован');
// 7. случайные прогоны
let bad = 0; for (let seed = 200; seed < 230; seed++) { try { const a = mk({ seed, stakes: [10 + seed % 5 * 10, 20, 30, 15, 25, 5].slice(0, 4 + seed % 3), lat: 100 + seed % 4 * 300 }); a.start(); a.runUntil(60000); if (seed % 3 === 0) a.act('crash', { node: 'n2' }); if (seed % 4 === 0) a.act('client', { id: 'equivocate', args: { node: 'n1' } }); if (seed % 5 === 0) a.act('partition', { groups: [['n1', 'n2'], a.nodes.slice(2).map(n => n.id)] }); a.runUntil(200000); if (seed % 5 === 0) a.act('healall', {}); a.runUntil(300000); if (a.violations.length) { bad++; console.log('violation', seed, a.violations[0].text); } } catch (e) { bad++; console.log(e.stack); } }
ok(bad === 0, 'pos: 30 случайных прогонов без исключений и нарушений (' + bad + ')');
console.log(fails ? 'FAILS: ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
