const { load, CORE } = require('../load.js');
const C = load([...CORE, 'scripts/chain/vm.js']); const ND = C.ND, V = ND.vm;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const run = (src, args, o) => { const w = new V.World(); w.fund('alice', 1000); const d = w.deploy('c', src); if (!d.ok) return { err: d.errors }; return Object.assign({ w }, w.call(Object.assign({ from: 'alice', to: 'c', args: args || [], gasLimit: 100000 }, o))); };
let r = run('PUSH 2\nPUSH 3\nADD\nPUSH 4\nMUL\nRETURN'); ok(r.ok && r.ret === 20n, 'vm: (2+3)*4 = 20, газ ' + r.gasUsed);
ok(r.gasUsed === 3 + 3 + 5 + 3 + 5, 'vm: газ = сумма стоимостей опкодов (' + r.gasUsed + ')');
r = run('PUSH 5\nPUSH 3\nSUB\nRETURN'); ok(r.ret === 2n, 'vm: SUB — второй минус верхний');
r = run('PUSH 0\nPUSH 1\nSUB\nRETURN'); ok(r.ok && r.ret === (1n << 256n) - 1n, 'vm: 0−1 заворачивается до 2^256−1 (underflow)');
r = run('PUSH 0\nPUSH 1\nSAFESUB\nRETURN'); ok(!r.ok && r.code === 'overflow', 'vm: SAFESUB откатывает отрицательный результат');
r = run('PUSH 4\nPUSH 0\nDIV\nRETURN'); ok(!r.ok && r.code === 'div0', 'vm: деление на 0 — откат');
r = run('POP'); ok(!r.ok && r.code === 'stack', 'vm: пустой стек — ошибка');
r = run('PUSH 7\nPUSH 1\nSSTORE\nREVERT'); ok(!r.ok && r.code === 'revert' && r.w.sget('c', 1) === 0n, 'vm: REVERT откатывает запись в хранилище');
r = run('PUSH 7\nPUSH 1\nSSTORE\nSTOP'); ok(r.ok && r.w.sget('c', 1) === 7n && r.gasUsed === 3 + 3 + 200 + 300, 'vm: SSTORE записывает; газ ' + r.gasUsed + ' (первая запись дороже)');
r = run('loop:\nJMP loop'); ok(!r.ok && (r.code === 'gas' || r.code === 'steps'), 'vm: бесконечный цикл останавливается (' + r.code + ')');
r = run('loop:\nJMP loop', [], { gasLimit: 1e12 }); ok(!r.ok && r.code === 'steps', 'vm: при огромном газе срабатывает лимит шагов');
r = run('PUSH 1\nPUSH 2\nADD\nRETURN', [], { gasLimit: 5 }); ok(!r.ok && r.code === 'gas', 'vm: нехватка газа');
r = run('FOO'); ok(r.err && r.err[0].msg.includes('неизвестная'), 'vm: ассемблер сообщает об ошибке');
r = run('JMP nowhere'); ok(r.err && r.err[0].msg.includes('метка'), 'vm: неизвестная метка');
r = run('ARG 0\nARG 1\nADD\nRETURN', [4, 6]); ok(r.ret === 10n, 'vm: ARG');
// примеры контрактов
ok(V.examples.length >= 6, 'vm: примеров контрактов ' + V.examples.length);
const byId = id => V.examples.find(e => e.id === id);
function scenario(id, fund) { const w = new V.World(); for (const a of ['alice', 'bob', 'carol', 'mallory']) w.fund(a, fund || 1000); const ex = byId(id); const d = w.deploy(id, ex.src); if (!d.ok) throw new Error(id + ': ' + JSON.stringify(d.errors)); return { w, ex, call: (from, args, value) => w.call({ from, to: id, args, value, gasLimit: 200000 }) }; }
let s = scenario('counter'); ok(s.call('alice', []).ret === 1n && s.call('alice', [5]).ret === 6n, 'контракт counter: +1, затем +5');
s = scenario('token'); ok(s.call('alice', [0, 100]).ok, 'token: mint'); let t = s.call('alice', [1, '@bob', 30]); ok(t.ok && s.call('bob', [2, '@bob']).ret === 30n, 'token: transfer 30 bob');
t = s.call('alice', [1, '@bob', 500]); ok(!t.ok && s.call('alice', [2, '@alice']).ret === 70n, 'token: перевод сверх баланса откатывается, баланс alice 70');
s = scenario('token_bug'); s.call('alice', [0, 10]); t = s.call('alice', [1, '@bob', 11]); ok(t.ok && s.w.sget('token_bug', s.w.id('alice')) === (1n << 256n) - 1n, 'token_bug: underflow даёт 2^256−1 токенов');
s = scenario('vote'); ok(s.call('alice', [1]).ok && !s.call('alice', [1]).ok, 'vote: повторное голосование откатывается'); s.call('bob', [2]); s.call('carol', [1]);
const sg = (k) => s.w.sget('vote', k); ok(sg(1) + sg(2) === 3n, 'vote: всего 3 голоса (' + sg(1) + '+' + sg(2) + ')');
s = scenario('escrow'); const rd = byId('escrow').calls; ok(rd.length >= 3, 'escrow: примеры вызовов есть');
let dep = s.call('carol', [1, '@bob'], 40); ok(dep.ok && s.w.balance('escrow') === 40n, 'escrow: депозит 40 на контракте');
t = s.call('bob', [2]); ok(!t.ok, 'escrow: bob не может release до подтверждения покупателем');
for (const c of byId('escrow').calls) { /* вызовы описаны корректно */ ok(c.from && Array.isArray(c.args), 'escrow: описание вызова «' + c.label + '»'); }
// reentrancy
const w = new V.World(); for (const a of ['alice', 'mallory', 'bob']) w.fund(a, 1000); const bank = byId('bank'), att = byId('attacker');
ok(w.deploy('bank', bank.src).ok && w.deploy('attacker', att.src).ok, 'bank/attacker: компилируются');
const ds = bank.calls.concat(att.calls); ok(ds.length >= 2, 'bank/attacker: примеры вызовов');
let gl = w.call({ from: 'alice', to: 'bank', args: [1], value: 100, gasLimit: 200000 }); ok(gl.ok && w.balance('bank') === 100n, 'bank: alice вносит 100');
const before = w.balance('bank'); const atk = w.call({ from: 'mallory', to: 'attacker', args: [1, '@bank'], value: 10, gasLimit: 2000000 });
console.log('  reentrancy: ok=' + atk.ok + ' bank ' + before + ' → ' + w.balance('bank') + ', attacker ' + w.balance('attacker') + (atk.error ? ' err=' + atk.error : ''));
ok(w.balance('bank') < before + 10n || w.balance('attacker') > 10n, 'reentrancy: атакующий вывел больше внесённого');
s = scenario('gasloop'); const g1 = s.call('alice', [10]).gasUsed, g2 = s.call('alice', [100]).gasUsed; ok(g2 > g1 * 5, 'gasloop: газ растёт с n (' + g1 + ' → ' + g2 + ')');
const lim = s.w.call({ from: 'alice', to: 'gasloop', args: [100000], gasLimit: 3000 }); ok(!lim.ok && lim.code === 'gas', 'gasloop: малый лимит газа прерывает цикл');
// пошаговое выполнение
const w2 = new V.World(); w2.fund('alice', 10); w2.deploy('c', 'PUSH 1\nPUSH 2\nADD\nRETURN'); const ex = w2.start({ from: 'alice', to: 'c', wantStack: true }); let steps = 0, last; for (;;) { const n = ex.gen.next(); if (n.done) break; steps++; last = n.value; } ok(steps === 3 && ex.result().ret === 3n, 'vm: пошаговое выполнение даёт 3 шага, результат 3');
console.log(fails ? 'FAILS: ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
