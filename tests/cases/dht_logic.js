const { load, CORE } = require('../load.js');
const C = load([...CORE, 'scripts/ui/ws-hashring.js']); const ND = C.ND; const dht = ND.dht;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
// консистентное кольцо
const keys = dht.keysList(5000); const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const r = dht.ring(); names.forEach(n => r.add(n, 64)); const r2 = r.clone(); r2.add('K', 64);
const mv = dht.moved(keys, k => r.owner(k), k => r2.owner(k)) / keys.length; ok(mv > 0.05 && mv < 0.15, 'кольцо: при 10→11 узлах переезжает ≈1/11: ' + mv.toFixed(3));
const mm = dht.moved(keys, k => dht.modOwner(names, k), k => dht.modOwner(names.concat('K'), k)) / keys.length; ok(mm > 0.8, 'mod-N: переезжает почти всё: ' + mm.toFixed(3));
const cv1 = dht.cv(dht.load((() => { const q = dht.ring(); names.forEach(n => q.add(n, 1)); return q; })(), keys)), cv256 = dht.cv(dht.load((() => { const q = dht.ring(); names.forEach(n => q.add(n, 256)); return q; })(), keys));
ok(cv256 < cv1 / 2 && cv256 < 0.15, 'vnodes выравнивают: cv(1)=' + cv1.toFixed(2) + ' cv(256)=' + cv256.toFixed(2));
const reps = r.replicas('x', 3); ok(reps.length === 3 && new Set(reps).size === 3 && reps[0] === r.owner('x'), 'реплики различны, первая = владелец');
ok(dht.ring().owner('x') === null, 'пустое кольцо');
// chord
const ch = dht.chordMake(8, [3, 20, 45, 77, 100, 130, 160, 190, 222, 250]); let bad = 0, hops = 0, n = 0, mx = 0;
for (const f of ch.ids()) for (let k = 0; k < 256; k++) { const x = ch.rawLookup(f, k); n++; hops += x.hops; mx = Math.max(mx, x.hops); if (!x.ok || x.owner !== ch.trueSucc(k)) bad++; }
ok(bad === 0, 'chord: все ключи найдены верно со всех узлов'); ok(mx <= 8, 'chord: максимум хопов ≤ m (' + mx + ')');
const ids = []; let x = 7; const big = dht.chord(10); const s = new Set(); while (s.size < 64) { x = (x * 73 + 41) % 1024; s.add(x); } big.addInitial([...s]);
let t = 0, c2 = 0; for (const f of big.ids()) for (let k = 0; k < 1024; k += 13) { t += big.rawLookup(f, k).hops; c2++; } const avg = t / c2; ok(avg > 1.5 && avg < 4.5, 'chord N=64: среднее хопов ' + avg.toFixed(2) + ' ≈ ½log₂N=3');
// join/leave/stabilize
const j = dht.chordMake(6, [1, 8, 14, 21, 32, 38, 42, 48, 51, 56]); j.join(25); ok(!j.consistent(), 'chord: после join до stabilize кольцо не согласовано'); for (let i = 0; i < 6; i++) j.stabilize(); ok(j.consistent(), 'chord: stabilize восстанавливает кольцо'); j.fixAll(); ok(j.fingerOk() === 1, 'chord: fix_fingers чинит пальцы');
let okAll = true; for (const f of j.ids()) for (let k = 0; k < 64; k++) if (j.rawLookup(f, k).owner !== j.trueSucc(k)) okAll = false; ok(okAll, 'chord: поиск верен после join');
j.leave(32); for (let i = 0; i < 8; i++) j.stabilize(); ok(j.consistent(), 'chord: после отказа узла stabilize чинит succ'); j.fixAll();
okAll = true; for (const f of j.ids()) for (let k = 0; k < 64; k++) if (j.rawLookup(f, k).owner !== j.trueSucc(k)) okAll = false; ok(okAll, 'chord: поиск верен после отказа');
// kademlia
let seed = 5; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }; const kid = new Set(); while (kid.size < 60) kid.add(Math.floor(rnd() * 1024));
const K = dht.kadMake(10, [...kid], 4, 3, rnd); let hit = 0, tot = 0, rounds = 0; for (let i = 0; i < 80; i++) { const from = K.ids()[i % 60], target = Math.floor(rnd() * 1024), r1 = K.lookup(from, target, false), real = K.trueClosest(target, 4); tot++; rounds += r1.nRounds; if (r1.closest[0] === real[0]) hit++; }
ok(hit / tot >= 0.95, 'kademlia: найден ближайший узел в ' + hit + '/' + tot); ok(rounds / tot < 7, 'kademlia: среднее раундов ' + (rounds / tot).toFixed(2));
console.log(fails ? 'FAILS: ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
