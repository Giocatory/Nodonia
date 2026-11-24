const { load, CORE, manifest } = require('../load.js'); const C = load([...CORE, 'scripts/core/ecdsa.js', ...manifest(['proto']), 'scripts/ui/ws-arch.js', 'scripts/content/templates.js', ...['labs-proto', 'labs-chain', 'labs-chain2', 'labs-arch', 'labs-dht'].map(x => 'scripts/content/' + x + '.js')]); const R = C.ND.reg;
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f++; };
ok(R.labs.length >= 24, 'лабораторных ' + R.labs.length); ok(new Set(R.labs.map(l => l.id)).size === R.labs.length, 'id уникальны');
const WS = ['hash', 'chain', 'wallet', 'merkle', 'hashring', 'vm', 'attack', 'arch'];
for (const l of R.labs) { const bad = []; if (l.template && !R.templates.find(t => t.id === l.template)) bad.push('нет шаблона ' + l.template); if (l.proto && !R.protocols[l.proto]) bad.push('нет протокола ' + l.proto); if (l.ws && !WS.includes(l.ws)) bad.push('нет ws ' + l.ws); if (!(l.steps.length >= 3 && l.questions.length >= 1 && l.theory && l.goal)) bad.push('неполная'); ok(!bad.length, l.id + ' ' + bad.join()); }
process.exit(f);
