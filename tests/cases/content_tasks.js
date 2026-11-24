const { load, CORE, manifest } = require('../load.js');
const C = load([...CORE, 'scripts/core/ecdsa.js', ...manifest(['proto']), 'scripts/ui/ws-attack.js', 'scripts/content/tasks.js']); const ND = C.ND;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const task = id => ND.reg.tasks.find(t => t.id === id);
const mk = (id, seed) => { const t = task(id), sc = t.scheme(); if (seed) sc.seed = seed; const s = ND.newSim(ND.cleanScheme(sc)); s.start(); return { t, s }; };
const res = (t, s) => t.goals.map(g => { try { return !!g.check(s); } catch (e) { return 'ERR ' + e.message; } });
const act = (s, id, args) => s.act('client', { id, args });
ok(ND.reg.tasks.length >= 16, 'заданий: ' + ND.reg.tasks.length);
// 1) без действий ни одно задание не выполнено целиком, и проверки не бросают исключений
for (const t of ND.reg.tasks) { const { s } = mk(t.id); s.runUntil(3000); const r = res(t, s); ok(!r.some(x => typeof x === 'string') && !r.every(x => x === true), t.id + ': не решено «само» и без ошибок проверки ' + JSON.stringify(r)); }
// 2) решения
const solve = (id, f, secs, seeds) => { let best = null; for (const seed of seeds || [1, 2, 3, 4, 5, 6, 7, 8]) { const { t, s } = mk(id, seed); f(s); s.runUntil(s.now + (secs || 20) * 1000); const r = res(t, s); if (!best || r.filter(x => x === true).length > best.filter(x => x === true).length) best = r; if (r.every(x => x === true)) return { done: true, r }; } return { done: false, r: best }; };
const chk = (id, f, secs, seeds) => { const o = solve(id, f, secs, seeds); ok(o.done, id + ' решается: ' + JSON.stringify(o.r)); };
const leader = s => s.nodes.find(n => n.up && n.st.role === 'leader');
chk('t-raft-failover', s => { s.runUntil(3000); s.act('crash', { node: leader(s).id }); }, 6);
chk('t-raft-commit', s => { s.runUntil(3000); act(s, 'put', { node: leader(s).id, key: 'x', value: '1' }); }, 4);
chk('t-raft-heal', s => { s.runUntil(3000); s.act('partition', { groups: [['n1', 'n2', 'n3'], ['n4', 'n5']] }); s.runUntil(s.now + 4000); s.act('healall', {}); }, 6);
chk('t-gossip-cheap', s => { s.act('setparam', { key: 'fanout', value: 2 }); act(s, 'rumor', { node: 'n1', text: 'hello' }); }, 20);
chk('t-paxos-livelock', s => { act(s, 'propose', { node: 'n1', value: 'A' }); s.runUntil(s.now + 100); act(s, 'propose', { node: 'n2', value: 'B' }); s.runUntil(s.now + 3000); s.act('setparam', { key: 'randomBackoff', value: true }); s.act('setparam', { key: 'retryMax', value: 1500 }); }, 40);
chk('t-pbft-break', s => { s.act('setcfg', { node: 'n1', key: 'byz', value: 'equivocate' }); s.act('setcfg', { node: 'n2', key: 'byz', value: 'equivocate' }); act(s, 'request', { value: 'tx1' }); }, 20, Array.from({ length: 20 }, (_, i) => i + 1));
chk('t-quorum-strict', s => { s.act('setparam', { key: 'R', value: 2 }); s.act('setparam', { key: 'W', value: 2 }); act(s, 'write', { node: 'n1', key: 'k', value: 'A' }); s.runUntil(s.now + 3000); act(s, 'read', { node: 'n4', key: 'k' }); act(s, 'read', { node: 'n5', key: 'k' }); }, 6);
chk('t-2pc-block', s => { s.act('setcfg', { node: 'n1', key: 'failAt', value: 'after_prepare' }); act(s, 'begin', {}); }, 20);
chk('t-3pc-fix', s => { s.act('setparam', { key: 'mode', value: '3pc' }); act(s, 'begin', {}); }, 30);
chk('t-pow-doublespend', s => { act(s, 'tx', { node: 'n2', id: 'pay1' }); act(s, 'attack_start', { node: 'n1', tx: 'pay1' }); }, 900, Array.from({ length: 12 }, (_, i) => i + 1));
chk('t-pos-slash', s => { s.runUntil(s.now + 40000); act(s, 'equivocate', { node: 'n1' }); }, 20);
chk('t-svc-burst', s => { s.act('setcfg', { node: 'n2', key: 'workers', value: 12 }); s.act('setcfg', { node: 'n2', key: 'qmax', value: 200 }); act(s, 'burst', { mult: 3, sec: 10 }); }, 25);
chk('t-svc-cascade', s => { s.act('setparam', { key: 'breaker', value: true }); s.act('setparam', { key: 'retries', value: 1 }); const sv = s.nodes.find(n => n.kind === 'service'); act(s, 'slowdown', { node: sv.id, factor: 3 }); }, 40);
chk('t-log-acks', s => { s.act('setparam', { key: 'acks', value: 'all' }); s.runUntil(4000); for (let i = 0; i < 6; i++) { act(s, 'produce', { node: 'n4', key: 'k' + i, value: 'v' }); s.runUntil(s.now + 300); } s.runUntil(s.now + 4000); s.act('crash', { node: 'n1' }); }, 10);
chk('t-crdt-fix', s => { s.act('setparam', { key: 'mode', value: 'gcounter' }); s.act('partition', { groups: [['n1', 'n2'], ['n3', 'n4']] }); for (let i = 0; i < 3; i++) { act(s, 'inc', { node: 'n1' }); act(s, 'inc', { node: 'n3' }); } s.runUntil(s.now + 3000); s.act('healall', {}); }, 15);
chk('t-bully-failover', s => { s.runUntil(2000); s.act('crash', { node: 'n5' }); }, 15);
chk('t-fd-tune', s => { s.act('setparam', { key: 'mode', value: 'phi' }); s.runUntil(1000); s.act('crash', { node: 'n5' }); }, 70);
console.log(fails ? 'FAILS ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
