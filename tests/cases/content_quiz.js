const { load, CORE } = require('../load.js'); const C = load([...CORE, 'scripts/content/quiz.js', 'scripts/content/glossary.js']); const R = C.ND.reg;
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f++; };
ok(R.quiz.length >= 100, 'вопросов ' + R.quiz.length); ok(R.quiz.every(q => new Set(q.a).size === 4 && q.a[q.c] && q.why), 'у всех 4 разных ответа и разбор');
ok(new Set(R.quiz.map(q => q.q)).size === R.quiz.length, 'без дублей'); ok(new Set(R.glossary.map(g => g.term)).size === R.glossary.length && R.glossary.length >= 100, 'глоссарий без дублей: ' + R.glossary.length);
process.exit(f);
