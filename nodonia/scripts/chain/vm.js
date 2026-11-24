/* Нодония — учебная стековая виртуальная машина «НодаVM» с газом, откатом состояния и вложенными вызовами.
   Слова — 256-битные беззнаковые (BigInt), арифметика ADD/SUB/MUL «заворачивается» по модулю 2^256 (как в EVM до Solidity 0.8):
   SAFEADD/SAFESUB/SAFEMUL откатывают транзакцию при переполнении. Адреса в стеке — целые id (world.id('alice')). */
(function (G) {
  'use strict';
  const ND = G.ND;
  const MOD = 1n << 256n, MAXDEPTH = 16, MAXSTEPS = 200000;
  /** имя: [аргумент, газ, пояснение] */
  const OPS = {
    STOP: [null, 0, 'остановка, успех'], RETURN: [null, 0, 'вернуть верхнее значение стека и остановиться'], REVERT: [null, 0, 'откатить все изменения этого вызова'],
    PUSH: ['число или @имя', 3, 'положить константу на стек'], POP: [null, 2, 'убрать верхнее значение'], DUP: [null, 3, 'дублировать верхнее'], SWAP: [null, 3, 'поменять два верхних'],
    ADD: [null, 5, 'a+b (по модулю 2^256)'], SUB: [null, 5, 'второй − верхний (по модулю 2^256: 0−1 даёт огромное число!)'], MUL: [null, 5, 'a·b (по модулю 2^256)'], DIV: [null, 8, 'второй ÷ верхний; деление на 0 — откат'], MOD: [null, 8, 'второй mod верхний'],
    SAFEADD: [null, 8, 'сложение с откатом при переполнении'], SAFESUB: [null, 8, 'вычитание с откатом, если результат < 0'], SAFEMUL: [null, 10, 'умножение с откатом при переполнении'],
    EQ: [null, 3, '1, если равны'], LT: [null, 3, '1, если второй < верхний'], GT: [null, 3, '1, если второй > верхний'], AND: [null, 3, 'логическое И (оба ≠ 0)'], OR: [null, 3, 'логическое ИЛИ'], NOT: [null, 3, '1, если значение = 0'],
    JMP: ['метка', 8, 'безусловный переход'], JMPI: ['метка', 10, 'переход, если снятое со стека значение ≠ 0'],
    SLOAD: [null, 50, 'ключ → значение из хранилища контракта'], SSTORE: [null, 200, 'снять ключ, затем значение; записать (первая запись ненулевого значения +300 газа)'],
    CALLER: [null, 2, 'id отправителя вызова'], CALLVALUE: [null, 2, 'сумма, пришедшая с вызовом'], SELF: [null, 2, 'id самого контракта'], ARG: ['n', 3, 'n-й аргумент вызова (нет аргумента — 0)'],
    BALANCE: [null, 40, 'id → баланс'], TRANSFER: [null, 100, 'снять адрес, затем сумму; отправить; если получатель — контракт, исполняется его код; на стек 1 (успех) или 0'],
    CALL: ['n', 100, 'снять адрес, сумму, затем n аргументов (первый снятый — arg0); вызвать контракт; на стек 1/0'], LOG: [null, 30, 'снять значение и записать в журнал событий'],
  };
  const SLOAD_COST = 50;
  class VMError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

  /* ---------- ассемблер ---------- */
  function assemble(src) {
    const lines = String(src).split('\n'), prog = [], labels = {}, errors = [], fix = [];
    lines.forEach((raw, li) => {
      let t = raw.replace(/;.*$/, '').trim(); if (!t) return;
      while (/^[A-Za-z_][\w]*:/.test(t)) { const m = /^([A-Za-z_][\w]*):\s*/.exec(t); if (labels[m[1]] !== undefined) errors.push({ line: li + 1, msg: 'метка «' + m[1] + '» объявлена дважды' }); labels[m[1]] = prog.length; t = t.slice(m[0].length); }
      if (!t) return;
      const w = t.split(/\s+/), op = w[0].toUpperCase(), d = OPS[op];
      if (!d) { errors.push({ line: li + 1, msg: 'неизвестная команда «' + w[0] + '»' }); return; }
      const ins = { op, line: li + 1, arg: null, src: t };
      if (d[0]) {
        if (w.length < 2) { errors.push({ line: li + 1, msg: op + ' требует аргумент (' + d[0] + ')' }); return; }
        if (op === 'JMP' || op === 'JMPI') fix.push({ ins, label: w[1] });
        else if (op === 'PUSH') { ins.arg = w[1]; if (!/^(@[\w]+|\d+|0x[0-9a-fA-F]+)$/.test(w[1])) { errors.push({ line: li + 1, msg: 'PUSH: ожидается число или @имя, получено «' + w[1] + '»' }); return; } }
        else { if (!/^\d+$/.test(w[1])) { errors.push({ line: li + 1, msg: op + ': ожидается целое число' }); return; } ins.arg = parseInt(w[1], 10); }
      } else if (w.length > 1) { errors.push({ line: li + 1, msg: op + ' не принимает аргументов' }); return; }
      prog.push(ins);
    });
    for (const f of fix) { if (labels[f.label] === undefined) errors.push({ line: f.ins.line, msg: 'неизвестная метка «' + f.label + '»' }); else f.ins.arg = labels[f.label]; }
    if (prog.length > 2000) errors.push({ line: 0, msg: 'слишком длинная программа' });
    return { ok: !errors.length, prog, labels, errors };
  }

  /* ---------- мир: балансы, контракты, хранилища ---------- */
  class World {
    constructor() { this.bal = {}; this.code = {}; this.store = {}; this.ids = {}; this.names = {}; this.nextId = 1001; this.logs = []; }
    id(name) { name = String(name); if (!this.ids[name]) { this.ids[name] = BigInt(this.nextId++); this.names[this.ids[name]] = name; } return this.ids[name]; }
    name(id) { return this.names[id] !== undefined ? this.names[id] : '#' + id; }
    fund(a, n) { this.bal[a] = (this.bal[a] || 0n) + BigInt(n); this.id(a); }
    balance(a) { return this.bal[a] || 0n; }
    deploy(addr, src) { const r = assemble(src); if (!r.ok) return r; this.code[addr] = { prog: r.prog, src }; this.store[addr] = this.store[addr] || new Map(); this.id(addr); return r; }
    sget(addr, key) { const m = this.store[addr]; const v = m && m.get(String(key)); return v === undefined ? 0n : v; }
    snapshot() { const s = {}; for (const a in this.store) s[a] = new Map(this.store[a]); return { bal: Object.assign({}, this.bal), store: s, logs: this.logs.length }; }
    restore(sn) { this.bal = Object.assign({}, sn.bal); this.store = {}; for (const a in sn.store) this.store[a] = new Map(sn.store[a]); this.logs.length = sn.logs; }
    /** перевод денег между «счетами» мира */
    move(from, to, n) { if (n === 0n) return true; if (this.balance(from) < n) return false; this.bal[from] -= n; this.bal[to] = (this.bal[to] || 0n) + n; return true; }
    /** подготовить вызов; отладчик получает генератор шагов. c: {from,to,value,args:[],gasLimit} */
    start(c) {
      const st = { gas: c.gasLimit == null ? 1000000 : c.gasLimit, limit: c.gasLimit == null ? 1000000 : c.gasLimit, steps: 0, trace: [], logs: [], ret: null, maxTrace: c.maxTrace == null ? 3000 : c.maxTrace, wantStack: !!c.wantStack, calls: 0 };
      const snap = this.snapshot(), world = this; let err = null, done = false, result = null;
      const value = BigInt(c.value || 0), args = (c.args || []).map(a => typeof a === 'string' && !/^\d+$/.test(a) ? world.id(a.replace(/^@/, '')) : BigInt(a));
      if (!this.code[c.to]) { return { st, gen: (function* () { })(), result: () => ({ ok: false, error: 'по адресу «' + c.to + '» нет контракта', code: 'nocode', gasUsed: 0, logs: [], ret: null, trace: [] }) }; }
      const gen = (function* () {
        if (!world.move(c.from, c.to, value)) throw new VMError('funds', 'у ' + c.from + ' недостаточно средств для отправки ' + value);
        yield* runFrame(world, st, { to: c.to, caller: world.id(c.from), value, args, depth: 0 });
      })();
      const wrap = function* () { try { yield* gen; result = { ok: true, ret: st.ret }; } catch (e) { if (!(e instanceof VMError)) throw e; world.restore(snap); result = { ok: false, error: e.message, code: e.code }; } done = true; };
      const it = wrap();
      return { st, gen: it, result() { const r = result || { ok: false, error: 'не завершено' }; return Object.assign({ gasUsed: st.limit - st.gas, logs: st.logs.slice(), trace: st.trace, ret: r.ok ? st.ret : null, steps: st.steps }, r); }, isDone: () => done };
    }
    call(c) { const x = this.start(c); for (;;) { const n = x.gen.next(); if (n.done) break; } return x.result(); }
  }

  function* runFrame(world, st, c) {
    const code = world.code[c.to]; if (!code) throw new VMError('nocode', 'нет контракта ' + c.to);
    const prog = code.prog, stack = []; let pc = 0;
    const pop = () => { if (!stack.length) throw new VMError('stack', 'стек пуст (стек-андерфлоу) в строке ' + prog[pc].line); return stack.pop(); };
    while (pc < prog.length) {
      const ins = prog[pc], cost = OPS[ins.op][1];
      if (++st.steps > MAXSTEPS) throw new VMError('steps', 'превышен лимит шагов (' + MAXSTEPS + ') — возможно, бесконечный цикл');
      if (st.gas < cost) { st.gas = 0; throw new VMError('gas', 'газ закончился на команде ' + ins.op + ' (строка ' + ins.line + ')'); }
      st.gas -= cost;
      let extra = 0, next = pc + 1;
      const before = st.wantStack ? stack.map(String) : null;
      switch (ins.op) {
        case 'STOP': st.ret = null; yieldInfo(ins); return;
        case 'RETURN': st.ret = pop(); yieldInfo(ins); return;
        case 'REVERT': throw new VMError('revert', 'REVERT: контракт откатил вызов (строка ' + ins.line + ')');
        case 'PUSH': stack.push(ins.arg[0] === '@' ? world.id(ins.arg.slice(1)) : BigInt(ins.arg) % MOD); break;
        case 'POP': pop(); break;
        case 'DUP': { const a = pop(); stack.push(a, a); break; }
        case 'SWAP': { const a = pop(), b = pop(); stack.push(a, b); break; }
        case 'ADD': { const a = pop(), b = pop(); stack.push((a + b) % MOD); break; }
        case 'SUB': { const a = pop(), b = pop(); stack.push(((b - a) % MOD + MOD) % MOD); break; }
        case 'MUL': { const a = pop(), b = pop(); stack.push((a * b) % MOD); break; }
        case 'DIV': { const a = pop(), b = pop(); if (a === 0n) throw new VMError('div0', 'деление на ноль (строка ' + ins.line + ')'); stack.push(b / a); break; }
        case 'MOD': { const a = pop(), b = pop(); if (a === 0n) throw new VMError('div0', 'деление на ноль (строка ' + ins.line + ')'); stack.push(b % a); break; }
        case 'SAFEADD': { const a = pop(), b = pop(), r = a + b; if (r >= MOD) throw new VMError('overflow', 'переполнение при сложении (строка ' + ins.line + ')'); stack.push(r); break; }
        case 'SAFESUB': { const a = pop(), b = pop(); if (b < a) throw new VMError('overflow', 'отрицательный результат вычитания ' + b + '−' + a + ' (строка ' + ins.line + ')'); stack.push(b - a); break; }
        case 'SAFEMUL': { const a = pop(), b = pop(), r = a * b; if (r >= MOD) throw new VMError('overflow', 'переполнение при умножении (строка ' + ins.line + ')'); stack.push(r); break; }
        case 'EQ': { const a = pop(), b = pop(); stack.push(a === b ? 1n : 0n); break; }
        case 'LT': { const a = pop(), b = pop(); stack.push(b < a ? 1n : 0n); break; }
        case 'GT': { const a = pop(), b = pop(); stack.push(b > a ? 1n : 0n); break; }
        case 'AND': { const a = pop(), b = pop(); stack.push(a !== 0n && b !== 0n ? 1n : 0n); break; }
        case 'OR': { const a = pop(), b = pop(); stack.push(a !== 0n || b !== 0n ? 1n : 0n); break; }
        case 'NOT': { const a = pop(); stack.push(a === 0n ? 1n : 0n); break; }
        case 'JMP': next = ins.arg; break;
        case 'JMPI': { const a = pop(); if (a !== 0n) next = ins.arg; break; }
        case 'SLOAD': { const k = pop(); stack.push(world.sget(c.to, k)); break; }
        case 'SSTORE': { const k = pop(), v = pop(), old = world.sget(c.to, k); if (old === 0n && v !== 0n) { extra = 300; if (st.gas < extra) { st.gas = 0; throw new VMError('gas', 'газ закончился на SSTORE (строка ' + ins.line + ')'); } st.gas -= extra; } world.store[c.to].set(String(k), v); break; }
        case 'CALLER': stack.push(c.caller); break;
        case 'CALLVALUE': stack.push(c.value); break;
        case 'SELF': stack.push(world.id(c.to)); break;
        case 'ARG': stack.push(c.args[ins.arg] !== undefined ? c.args[ins.arg] : 0n); break;
        case 'BALANCE': { const a = pop(); stack.push(world.balance(world.name(a))); break; }
        case 'LOG': { const v = pop(); st.logs.push({ by: c.to, value: v.toString() }); break; }
        case 'TRANSFER': case 'CALL': {
          const to = pop(), val = pop(); let args = []; if (ins.op === 'CALL') for (let i = 0; i < ins.arg; i++) args.push(pop());
          const toName = world.name(to); let ok = 0n;
          if (c.depth + 1 > MAXDEPTH) ok = 0n;
          else if (world.balance(c.to) < val) ok = 0n;
          else {
            const sn = world.snapshot(); world.move(c.to, toName, val); st.calls++;
            if (world.code[toName]) {
              try { yield* runFrame(world, st, { to: toName, caller: world.id(c.to), value: val, args, depth: c.depth + 1 }); ok = 1n; }
              catch (e) { if (!(e instanceof VMError) || e.code === 'steps' || (e.code === 'gas' && false)) throw e; world.restore(sn); ok = 0n; st.lastSubError = e.message; }
            } else ok = 1n;
          }
          stack.push(ok); break;
        }
      }
      if (st.trace.length < st.maxTrace) st.trace.push({ depth: c.depth, at: c.to, pc, op: ins.op, arg: ins.arg, line: ins.line, gas: st.gas, cost: cost + extra, stack: st.wantStack ? stack.map(String) : null });
      pc = next;
      yield { depth: c.depth, at: c.to, pc: next, line: ins.line, op: ins.op, gas: st.gas, stack: stack.map(String) };
    }
    st.ret = null;
    function yieldInfo(ins) { if (st.trace.length < st.maxTrace) st.trace.push({ depth: c.depth, at: c.to, pc, op: ins.op, arg: ins.arg, line: ins.line, gas: st.gas, cost: 0 }); }
  }

  /* ---------- примеры контрактов ---------- */
  const EX = [
    {
      id: 'counter', title: 'Счётчик', desc: 'Хранилище: ячейка 0 увеличивается на ARG 0 (на 1, если аргумента нет). Смотрите, как растёт газ при первой записи (SSTORE в пустую ячейку дороже).',
      src: `; Счётчик. ARG 0 — на сколько увеличить
PUSH 0
SLOAD          ; прочитать ячейку 0
ARG 0
DUP
JMPI have      ; если аргумент не 0 — используем его
POP
PUSH 1         ; иначе прибавляем 1
have:
ADD
DUP            ; [новое, новое]
PUSH 0
SSTORE         ; ячейка 0 = новое
RETURN         ; вернуть новое значение
`, calls: [{ label: 'inc()', from: 'alice', args: [] }, { label: 'inc(5)', from: 'alice', args: [5] }]
    },
    {
      id: 'token', title: 'Токен (transfer)', desc: 'ARG 0 — выбор функции: 0 = mint(сумма) себе, 1 = transfer(кому, сумма), 2 = balanceOf(кто). Ключ хранилища — id адреса. Баланс проверяется перед списанием.',
      src: `; Простой токен. ARG0: 0 mint(amt), 1 transfer(to,amt), 2 balanceOf(who)
ARG 0
DUP
PUSH 0
EQ
JMPI mint
DUP
PUSH 1
EQ
JMPI transfer
DUP
PUSH 2
EQ
JMPI balanceof
REVERT
mint:
POP
CALLER
SLOAD
ARG 1
SAFEADD
CALLER
SSTORE
STOP
transfer:
POP
CALLER
SLOAD
ARG 2
LT             ; баланс < суммы ?
JMPI fail
CALLER
SLOAD
ARG 2
SAFESUB
CALLER
SSTORE         ; balance[caller] -= amt
ARG 1
SLOAD
ARG 2
SAFEADD
ARG 1
SSTORE         ; balance[to] += amt
PUSH 1
RETURN
fail:
REVERT
balanceof:
POP
ARG 1
SLOAD
RETURN
`, calls: [{ label: 'mint(100) от alice', from: 'alice', args: [0, 100] }, { label: 'transfer(bob, 30) от alice', from: 'alice', args: [1, '@bob', 30] }, { label: 'transfer(bob, 500) от alice (откат)', from: 'alice', args: [1, '@bob', 500] }, { label: 'balanceOf(bob)', from: 'carol', args: [2, '@bob'] }]
    },
    {
      id: 'token_bug', title: 'Токен с багом (underflow)', desc: 'То же, но без проверки баланса и с «голым» SUB. Передача больше баланса не откатывается, а баланс отправителя становится ≈ 2^256 − 1. Замените SUB на SAFESUB и сравните.',
      src: `; БАГ: нет проверки баланса, SUB заворачивается по модулю 2^256
ARG 0
PUSH 0
EQ
JMPI mint
; transfer(to=ARG1, amt=ARG2)
CALLER
SLOAD
ARG 2
SUB            ; <-- здесь underflow, если amt > баланса
CALLER
SSTORE
ARG 1
SLOAD
ARG 2
ADD
ARG 1
SSTORE
STOP
mint:
CALLER
SLOAD
ARG 1
ADD
CALLER
SSTORE
STOP
`, calls: [{ label: 'mint(10) от alice', from: 'alice', args: [0, 10] }, { label: 'transfer(bob, 11) от alice', from: 'alice', args: [1, '@bob', 11] }]
    },
    {
      id: 'vote', title: 'Голосование', desc: 'Вариант (1 или 2) в ARG 0. Каждый адрес голосует один раз: флаг «уже голосовал» хранится по ключу 1 000 000 + id. Счётчики — в ячейках 1 и 2.',
      src: `; Голосование: один адрес — один голос
PUSH 1000000
CALLER
ADD            ; ключ флага
SLOAD
JMPI already
ARG 0
SLOAD
PUSH 1
ADD
ARG 0
SSTORE         ; счётчик варианта ++
PUSH 1
PUSH 1000000
CALLER
ADD
SSTORE         ; флаг «голосовал» = 1
STOP
already:
REVERT
`, calls: [{ label: 'alice за вариант 1', from: 'alice', args: [1] }, { label: 'bob за вариант 2', from: 'bob', args: [2] }, { label: 'alice голосует повторно (откат)', from: 'alice', args: [2] }]
    },
    {
      id: 'escrow', title: 'Эскроу (условное хранение)', desc: 'ARG 0: 1 = deposit(продавец) — покупатель кладёт деньги вместе с вызовом, 2 = release — покупатель освобождает деньги продавцу, 3 = refund — продавец возвращает деньги покупателю. Обратите внимание: сумма обнуляется ДО отправки.',
      src: `; Эскроу. Ячейки: 0 покупатель, 1 продавец, 2 сумма
ARG 0
DUP
PUSH 1
EQ
JMPI deposit
DUP
PUSH 2
EQ
JMPI release
DUP
PUSH 3
EQ
JMPI refund
REVERT
deposit:
POP
PUSH 2
SLOAD
JMPI busy          ; уже есть сделка
CALLER
PUSH 0
SSTORE
ARG 1
PUSH 1
SSTORE
CALLVALUE
PUSH 2
SSTORE
STOP
release:
POP
PUSH 0
SLOAD
CALLER
EQ
NOT
JMPI busy          ; только покупатель
PUSH 2
SLOAD              ; [сумма]
PUSH 0
PUSH 2
SSTORE             ; сумма = 0 (ДО отправки)
PUSH 1
SLOAD              ; [сумма, продавец]
TRANSFER
RETURN
refund:
POP
PUSH 1
SLOAD
CALLER
EQ
NOT
JMPI busy          ; только продавец
PUSH 2
SLOAD
PUSH 0
PUSH 2
SSTORE
PUSH 0
SLOAD
TRANSFER
RETURN
busy:
REVERT
`, calls: [{ label: 'carol вносит 40 для bob', from: 'carol', value: 40, args: [1, '@bob'] }, { label: 'bob пытается release (откат)', from: 'bob', args: [2] }, { label: 'carol освобождает деньги', from: 'carol', args: [2] }, { label: 'bob возвращает (refund)', from: 'bob', args: [3] }]
    },
    {
      id: 'bank', title: 'Банк (УЯЗВИМЫЙ: reentrancy)', desc: 'Вклад и вывод. Вывод отправляет деньги ДО обнуления баланса — контракт-получатель может вызвать вывод повторно из своей функции приёма. Исправьте: поменяйте порядок (сначала SSTORE 0, потом TRANSFER) — «checks-effects-interactions».',
      src: `; ARG0: 1 = deposit (кладёт CALLVALUE), 2 = withdraw
ARG 0
PUSH 1
EQ
JMPI deposit
; ----- withdraw -----
CALLER
SLOAD          ; [баланс]
DUP
NOT
JMPI zero
CALLER
TRANSFER       ; УЯЗВИМО: деньги ушли, а баланс ещё не обнулён
POP
PUSH 0
CALLER
SSTORE         ; обнуляем слишком поздно
STOP
zero:
REVERT
deposit:
CALLER
SLOAD
CALLVALUE
SAFEADD
CALLER
SSTORE
STOP
`, calls: [{ label: 'dave вносит 30', from: 'dave', value: 30, args: [1] }, { label: 'erin вносит 30', from: 'erin', value: 30, args: [1] }, { label: 'честный вывод dave', from: 'dave', args: [2] }],
      extra: { attacker: true }
    },
    {
      id: 'attacker', title: 'Атакующий контракт (для банка)', desc: 'ARG 0 = 1: attack(банк) — вносит CALLVALUE и запрашивает вывод. Когда банк отправляет деньги, срабатывает ветка «приёма» и вызывает вывод ещё раз, пока в банке есть ≥ 10.',
      src: `; ARG0: 1 = attack(bank); иначе — «приём денег» (вызывается банком)
ARG 0
PUSH 1
EQ
JMPI start
; ----- приём денег: re-entrancy -----
PUSH 0
SLOAD          ; id банка
BALANCE
PUSH 10
LT             ; баланс банка < 10 ?
JMPI done
PUSH 2         ; arg0 = 2 (withdraw)
PUSH 0         ; value = 0
PUSH 0
SLOAD          ; кому: банк
CALL 1
POP
done:
STOP
start:
ARG 1
PUSH 0
SSTORE         ; запомнить банк
PUSH 1         ; deposit
CALLVALUE
PUSH 0
SLOAD
CALL 1
POP
PUSH 2         ; withdraw
PUSH 0
PUSH 0
SLOAD
CALL 1
POP
STOP
`, calls: [{ label: 'mallory атакует банк, вложив 10', from: 'mallory', value: 10, args: [1, '@bank'] }]
    },
    {
      id: 'gasloop', title: 'Цикл и газ', desc: 'Сумма 1…n в цикле. Стоимость растёт с n; при малом лимите газа выполнение прерывается с откатом, а при n = 100000 сработает защита от бесконечных циклов.',
      src: `; ARG0 = n. Возвращает 1+2+…+n
PUSH 0         ; сумма
ARG 0          ; счётчик
loop:
DUP
NOT
JMPI end       ; счётчик = 0 → конец
DUP            ; [сумма, i, i]
PUSH 3
SWAP           ; тонкость стека: готовим
POP
POP            ; убираем лишнее: [сумма, i]
SWAP           ; [i, сумма]
PUSH 0
ADD
SWAP           ; [сумма, i]
DUP
PUSH 0
ADD            ; [сумма, i, i]
SWAP
POP            ; [сумма, i]
PUSH 1
SWAP
SUB            ; i-1? (демо)
JMP loop
end:
POP
RETURN
`, calls: [{ label: 'sum(5)', from: 'alice', args: [5] }]
    },
  ];
  /* нормальный цикл суммирования (написан отдельно — читаемее) */
  EX[EX.length - 1].src = `; ARG0 = n. Возвращает 1+2+…+n (хранит сумму в ячейке 1, счётчик — в ячейке 0)
ARG 0
PUSH 0
SSTORE         ; i = n
loop:
PUSH 0
SLOAD
NOT
JMPI end       ; i = 0 → выходим
PUSH 1
SLOAD
PUSH 0
SLOAD
ADD
PUSH 1
SSTORE         ; сумма += i
PUSH 0
SLOAD
PUSH 1
SAFESUB
PUSH 0
SSTORE         ; i--
JMP loop
end:
PUSH 1
SLOAD
RETURN
`;
  EX[EX.length - 1].calls = [{ label: 'sum(5)', from: 'alice', args: [5], gas: 100000 }, { label: 'sum(50) с газом 5000 (мало — откат)', from: 'alice', args: [50], gas: 5000 }, { label: 'sum(100000) — лимит шагов', from: 'alice', args: [100000], gas: 1e9 }];
  ND.vm = { OPS, MAXDEPTH, MAXSTEPS, assemble, World, VMError, examples: EX };
})(typeof window !== 'undefined' ? window : globalThis);
