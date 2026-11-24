/* Запуск всех тестов: node tests/run_all.js */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const dir = path.join(__dirname, 'cases'); let bad = 0, n = 0;
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js')).sort()) {
  const r = cp.spawnSync('node', [path.join(dir, f)], { encoding: 'utf8', cwd: __dirname }); n++;
  const out = (r.stdout || '') + (r.stderr || ''), fails = (out.match(/^FAIL /gm) || []).length, passes = (out.match(/^PASS /gm) || []).length;
  console.log((r.status === 0 && !fails ? 'OK   ' : 'FAIL ') + f.padEnd(24) + passes + ' проверок' + (fails ? ', провалено ' + fails : ''));
  if (r.status !== 0 || fails) { bad++; console.log(out.split('\n').filter(l => /^FAIL|Error/.test(l)).slice(0, 5).join('\n')); }
}
console.log(bad ? 'ПРОВАЛЕНО файлов: ' + bad : 'ВСЕ ' + n + ' НАБОРОВ ПРОШЛИ'); process.exit(bad ? 1 : 0);
