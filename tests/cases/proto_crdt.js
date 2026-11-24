const { load, CORE } = require('../load.js');
const C = load([...CORE, 'scripts/proto/crdt.js']); const ND = C.ND;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const T = id => ND.newSim(ND.reg.templates.find(t => t.id === id).build());
const vals = s => s.nodes.map(n => ND.reg.protocols.crdt.badge(n, s)).join(' ');
function scenario(id) { const s = T(id); s.start(); s.act('partition', { groups: [['n1', 'n2'], ['n3', 'n4']] }); s.act('client', { id: 'inc', args: { node: 'n1', by: 5 } }); s.act('client', { id: 'inc', args: { node: 'n3', by: 7 } }); s.runUntil(6000); s.act('healall', {}); s.runUntil(20000); return s; }
let s = scenario('crdt-gc'); ok(s.nodes.every(n => ND.reg.protocols.crdt.badge(n, s) === '= 12'), 'g-counter: после слияния все = 12 (' + vals(s) + ')'); ok(!s.violations.length, 'g-counter: SEC держится');
s = scenario('crdt-naive'); ok(s.nodes.every(n => ND.reg.protocols.crdt.badge(n, s) === '= 7'), 'наивный: потеряно приращение, все = 7 (' + vals(s) + ')');
s = T('crdt-lww'); s.start(); s.act('client', { id: 'set', args: { node: 'n1', value: 'A' } }); s.runUntil(3000); s.act('client', { id: 'set', args: { node: 'n2', value: 'B' } }); s.runUntil(20000);
ok(s.nodes.every(n => n.st.d.v === 'A'), 'lww: из-за сдвига часов побеждает старая запись A');
s = T('crdt-orset'); s.start(); s.act('partition', { groups: [['n1', 'n2'], ['n3', 'n4']] }); s.act('client', { id: 'add', args: { node: 'n1', elem: 'x' } }); s.runUntil(4000); s.act('healall', {}); s.runUntil(14000);
s.act('partition', { groups: [['n1', 'n2'], ['n3', 'n4']] }); s.act('client', { id: 'remove', args: { node: 'n1', elem: 'x' } }); s.act('client', { id: 'add', args: { node: 'n3', elem: 'x' } }); s.runUntil(s.now + 4000); s.act('healall', {}); s.runUntil(s.now + 14000);
ok(s.nodes.every(n => ND.reg.protocols.crdt.badge(n, s) === '= x'), 'or-set: добавление выжило (' + vals(s) + ')');
// свойства merge на случайных состояниях
const rng = new ND.RNG(7); let comm = true, idem = true, assoc = true;
for (const mode of ['gcounter', 'pncounter', 'orset', 'lwwreg']) for (let i = 0; i < 200; i++) {
  const mk = () => { const d = { gcounter: { p: {} }, pncounter: { p: {}, n: {} }, orset: { add: {}, rem: [] }, lwwreg: { v: 'a', ts: 0, by: '' } }[mode]; const k = ['n1', 'n2', 'n3'][rng.int(0, 2)]; if (mode === 'gcounter') d.p[k] = rng.int(0, 9); else if (mode === 'pncounter') { d.p[k] = rng.int(0, 9); d.n[k] = rng.int(0, 5); } else if (mode === 'orset') { d.add['x'] = [k + '#' + rng.int(1, 4)]; if (rng.chance(.5)) d.rem = [k + '#' + rng.int(1, 4)]; } else { d.ts = rng.int(0, 5); d.by = k; d.v = 'v' + d.ts + k; } return d; };
  const a = mk(), b = mk(), c = mk(), J = JSON.stringify, M = (x, y) => J(ND.crdtMerge(mode, x, y)), canon = v => Array.isArray(v) ? v.map(canon).sort((x, y) => J(x) < J(y) ? -1 : 1) : (v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v), srt = o => J(canon(JSON.parse(o)));
  if (srt(M(a, b)) !== srt(M(b, a))) comm = false; if (srt(M(a, a)) !== srt(J(a))) idem = false; if (srt(J(ND.crdtMerge(mode, ND.crdtMerge(mode, a, b), c))) !== srt(J(ND.crdtMerge(mode, a, ND.crdtMerge(mode, b, c))))) assoc = false;
}
ok(comm && idem && assoc, 'merge: коммутативность, идемпотентность, ассоциативность (' + [comm, idem, assoc] + ')');
console.log(fails ? 'FAILS ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
