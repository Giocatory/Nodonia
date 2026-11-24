const { load, CORE, manifest } = require('../load.js');
const C = load([...CORE, 'scripts/core/ecdsa.js', ...manifest(['proto']), 'scripts/ui/ws-compare.js']); const K = C.ND.compare;
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f++; };
const R = (sc, o) => { const r = K.compare(Object.assign({ scenario: sc, n: 5, seeds: 4 }, o || {})); const m = {}; r.rows.forEach(x => m[x.pid] = x); return m; };
ok(Object.keys(K.ADAPT).length === 6 && Object.keys(K.SCENARIOS).length === 7, '6 протоколов × 7 сценариев');
// детерминизм
const a = JSON.stringify(K.runOne('raft', { n: 5, scenario: 'wan', seed: 3 })), b = JSON.stringify(K.runOne('raft', { n: 5, scenario: 'wan', seed: 3 })); ok(a === b, 'один seed — тот же результат');
// здоровая сеть: все решают, безопасность цела, у кворумной записи меньше всего сообщений
let m = R('ok'); ok(Object.values(m).every(x => x.ok === x.total && !x.unsafe), 'ok: все решили, безопасность цела');
ok(m.quorum.msgs <= Math.min(...Object.values(m).map(x => x.msgs)), 'ok: меньше всего сообщений у кворумной записи'); ok(m.pbft.msgs > m.raft.msgs && m.pbft.msgs > m.twopc.msgs, 'ok: PBFT дороже Raft и 2PC по сообщениям');
ok(m.threepc.msgs > m.twopc.msgs && m.threepc.tFirst > m.twopc.tFirst, 'ok: 3PC дороже 2PC и по сообщениям, и по времени');
// отказ лидера: 2PC блокируется, 3PC откатывает, PBFT и Raft решают, Paxos без повтора — нет
m = R('crashPrimary'); ok(m.twopc.blocked === m.twopc.total && m.twopc.ok === 0, 'отказ главного: 2PC блокируется'); ok(m.threepc.abort === m.threepc.total && m.threepc.blocked === 0, 'отказ главного: 3PC откатывает без блокировки');
ok(m.raft.ok === m.raft.total && m.raft.tFirst > 1000, 'отказ главного: Raft решает после выборов (>1 с)'); ok(m.pbft.ok === m.pbft.total, 'отказ главного: PBFT решает'); ok(m.paxos.ok === 0, 'отказ главного: Paxos без повтора решения не получает');
m = R('crashPrimary', { retry: true }); ok(m.paxos.ok === m.paxos.total && m.quorum.ok === m.quorum.total, 'повтор запроса: Paxos и кворумная запись решают');
// отказ меньшинства / раздел
m = R('crashMinor'); ok(m.raft.ok === 4 && m.paxos.ok === 4 && m.pbft.ok === 4 && m.quorum.ok === 4 && m.twopc.ok === 0 && m.twopc.abort === 4, 'меньшинство отказало: все, кроме 2PC/3PC, решают; 2PC откатывает');
m = R('partition'); ok(m.raft.ok === 4 && m.paxos.ok === 4 && m.twopc.ok === 0 && Object.values(m).every(x => !x.unsafe), 'раздел: большинство решает, 2PC откатывает, безопасность цела');
m = R('isolate'); ok(m.raft.ok === 0 && m.pbft.ok === 4 && m.pbft.tQ > 3000, 'изоляция лидера: Raft без повтора ждёт, PBFT меняет вид (>3 с)');
m = R('lossy'); ok(m.raft.ok === 4 && m.paxos.ok === 4 && m.twopc.ok < 4, 'потери 10%: Raft и Paxos справляются, 2PC часто откатывается');
// рецепты — валидные команды консоли
for (const sc of Object.keys(K.SCENARIOS)) for (const pid of Object.keys(K.ADAPT)) { const A = K.ADAPT[pid], SC = K.SCENARIOS[sc]; const sch = C.ND.makeScheme({ proto: A.proto, n: 5, topo: 'full', lat: SC.net.lat, jit: SC.net.jit, loss: SC.net.loss, seed: 1, params: A.params(5) }); const s = { sim: C.ND.newSim(sch), reset() { this.sim = C.ND.newSim(sch); this.sim.start(); } }; s.sim.start();
  const bad = []; for (const line of K.recipe(pid, { scenario: sc, n: 5, k: 1 })) { const l = line.replace(/\s*#.*$/, '').replace('<лидер>', 'n1'); const out = C.ND.console.exec(s, l); if (out.some(x => x.c === 'bad')) bad.push(l + ' → ' + out.find(x => x.c === 'bad').t); }
  if (bad.length) ok(false, 'рецепт ' + pid + '/' + sc + ': ' + bad.join('; ')); }
ok(true, 'рецепты выполняются консолью');
process.exit(f);
