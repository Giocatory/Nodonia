const { load, CORE } = require('../load.js');
const C = load([...CORE, 'scripts/proto/clocks.js', 'scripts/proto/failure.js']); const ND = C.ND;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const T = id => ND.newSim(ND.reg.templates.find(t => t.id === id).build());
let s = T('clk-basic'); s.start(); s.runUntil(60000); const E = s.G_clocks.ev;
ok(E.length > 30, 'clocks: события создаются (' + E.length + ')');
// свойство Лампорта: если a→b по векторным, то L(a)<L(b)
const le = (a, b) => Object.keys(a).every(k => a[k] <= (b[k] || 0)); let viol = 0, conc = 0, falsePairs = 0;
for (let i = 0; i < E.length; i++) for (let j = 0; j < E.length; j++) if (i !== j) { const a = E[i], b = E[j]; if (le(a.V, b.V) && !le(b.V, a.V) && !(a.L < b.L)) viol++; if (i < j && !le(a.V, b.V) && !le(b.V, a.V)) { conc++; if (a.L !== b.L) falsePairs++; } }
ok(viol === 0, 'clocks: a→b ⇒ L(a)<L(b) (нарушений ' + viol + ')'); ok(conc > 0 && falsePairs > 0, 'clocks: есть конкурентные пары, которые Лампорт «упорядочивает» (' + conc + '/' + falsePairs + ')');
// HLC: причинность сохраняется
let hv = 0; s = T('clk-skew'); s.start(); s.runUntil(60000); const H = s.G_clocks.ev; for (const a of H) for (const b of H) if (a !== b && le(a.V, b.V) && !le(b.V, a.V) && !(a.h.l < b.h.l || (a.h.l === b.h.l && a.h.c < b.h.c))) hv++;
ok(hv === 0, 'hlc: причинность сохраняется при сдвиге часов (нарушений ' + hv + ')');
s.act('client', { id: 'compare', args: { a: 1, b: 2 } }); ok(true, 'clocks: compare без ошибок');
// детектор отказов
s = T('fd-stable'); s.start(); s.runUntil(10000); s.act('crash', { node: 'n3' }); s.runUntil(s.now + 15000);
const d = s.G_fd.detect.n3 || []; ok(d.length === 4, 'fd: отказ n3 обнаружили все 4 (' + d.length + ')'); ok(d.every(x => x >= 800 && x < 6000), 'fd: время обнаружения ~ таймаут (' + d.join(',') + ')'); ok(s.G_fd.falsePos === 0, 'fd: в стабильной сети нет ложных срабатываний');
const fp = id => { let t = 0; for (let seed = 1; seed <= 10; seed++) { const q = ND.newSim(Object.assign(ND.reg.templates.find(x => x.id === id).build(), { seed })); q.start(); q.runUntil(60000); t += q.G_fd.falsePos; } return t; };
const a = fp('fd-jitter'), b = fp('fd-phi'); ok(a > 0, 'fd: при джиттере таймаут даёт ложные срабатывания (' + a + ')'); ok(b < a, 'fd: phi-accrual даёт меньше ложных (' + b + ' < ' + a + ')');
const r = ND.Sim.replay(ND.cleanScheme(s.scheme), s.hist, s.evCount); ok(JSON.stringify(r.nodes.map(n => n.st)) === JSON.stringify(s.nodes.map(n => n.st)), 'fd: replay');
console.log(fails ? 'FAILS ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
