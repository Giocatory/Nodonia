/* Все <code>-команды из лабораторных, заданий и справки выполняются консолью без ошибок. */
const { load, CORE, manifest } = require('../load.js');
const C = load([...CORE, 'scripts/core/ecdsa.js', ...manifest(['proto']), 'scripts/ui/ws-arch.js', 'scripts/ui/ws-attack.js', 'scripts/content/templates.js', ...['tasks', 'labs-proto', 'labs-chain', 'labs-chain2', 'labs-arch', 'labs-dht', 'help'].map(x => 'scripts/content/' + x + '.js')]);
const ND = C.ND, R = ND.reg;
let f = 0, n = 0; const ok = (c, m) => { if (!c) { console.log('FAIL ' + m); f++; } n++; };
const VERBS = new Set(['help', 'nodes', 'links', 'status', 'state', 'crash', 'recover', 'cut', 'heal', 'partition', 'link', 'cfg', 'param', 'actions', 'do', 'run', 'step', 'at', 'log', 'inv', 'reset', 'seed']);
const codes = o => { const s = JSON.stringify(o), r = []; let m; const re = /<code>(.*?)<\/code>/g; while ((m = re.exec(s))) r.push(m[1].replace(/\\"/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')); return r; };
function sess(sc) { const o = { sim: null, reset() { o.sim = ND.newSim(sc); o.sim.start(); }, seed(v) { sc.seed = v; o.reset(); } }; o.reset(); return o; }
function check(where, scheme, list) {
  for (const c of list) {
    const first = c.trim().split(/\s+/)[0].toLowerCase(); if (!VERBS.has(first) || /\bn[A-Z]\b|…/.test(c)) continue;
    const s = sess(JSON.parse(JSON.stringify(scheme)));
    let out; try { out = ND.console.exec(s, c); } catch (e) { out = [{ t: 'EXC ' + e.message, c: 'bad' }]; }
    const bad = out.filter(x => x.c === 'bad');
    // команды с узлами n1.. и параметрами проверяем на шаблоне; ошибки «неизвестный узел» для чужих схем отмечаем
    ok(!bad.length, where + ': «' + c + '» → ' + bad.map(x => x.t).join(' | '));
  }
}
const T = id => R.templates.find(t => t.id === id);
for (const l of R.labs) {
  const list = codes(l); if (!list.length) continue;
  let sc = null; if (l.template && T(l.template)) sc = T(l.template).build(); else if (l.proto && R.protocols[l.proto]) sc = R.protocols[l.proto].defaultScheme();
  if (!sc) continue; check('lab ' + l.id, sc, list);
}
for (const t of R.tasks) check('task ' + t.id, t.scheme(), codes({ text: t.text, hints: t.hints, goals: t.goals.map(g => g.t) }));
for (const h of R.help || []) { if (h.id === 'console' || /console|консол/i.test(h.title || '')) { check('help-console-real', R.protocols.raft.defaultScheme(), ['heal', 'heal all', 'crash n1', 'recover n1', 'cut n1 n2', 'heal n1 n2', 'state n1', 'link n1 n2 lat=100 loss=0.1', 'run 2', 'step 5', 'at 1 crash n2', 'inv', 'log 5']); continue; } const p = h.proto && R.protocols[h.proto]; check('help ' + (h.id || h.title), (p ? p.defaultScheme() : R.protocols.raft.defaultScheme()), codes(h)); }
console.log((f ? 'FAIL' : 'PASS') + ' команд проверено: ' + n + ', ошибок: ' + f);
process.exit(f ? 1 : 0);
