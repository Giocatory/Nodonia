const { load, CORE } = require('../load.js'); const crypto = require('crypto');
const C = load([...CORE, 'scripts/chain/merkle.js']); const ND = C.ND, M = ND.merkle;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sh = b => crypto.createHash('sha256').update(b).digest();
ok(M.root([]) === sh(Buffer.alloc(0)).toString('hex'), 'merkle: пустое дерево = хэш пустой строки');
const hx = s => sh(Buffer.from(s)).toString('hex');
ok(M.leaf('abc') === hx('abc'), 'merkle: хэш листа = SHA-256 данных');
const pair = (a, b) => sh(Buffer.concat([Buffer.from(a, 'hex'), Buffer.from(b, 'hex')])).toString('hex');
ok(M.root(['a', 'b', 'c', 'd']) === pair(pair(hx('a'), hx('b')), pair(hx('c'), hx('d'))), 'merkle: корень 4 листьев совпадает с независимым расчётом');
let all = true, tamper = true;
for (let n = 1; n <= 20; n++) { const it = Array.from({ length: n }, (_, i) => 'tx' + i), root = M.root(it); for (let i = 0; i < n; i++) { const p = M.proof(it, i); if (!M.verify(it[i], p, root).ok) all = false; if (M.verify(it[i] + '!', p, root).ok) tamper = false; if (M.verify(it[i], p, M.root(it.map((x, j) => j === i ? x + '!' : x))).ok) tamper = false; } }
ok(all, 'merkle: доказательства всех листьев при n=1…20 верны'); ok(tamper, 'merkle: подмена листа или корня ловится');
ok(M.proof(Array.from({ length: 8 }, (_, i) => '' + i), 3).length === 3, 'merkle: длина доказательства для 8 листьев = 3 (log2 n)');
ok(M.proof(Array.from({ length: 1000 }, (_, i) => '' + i), 500).length === 10, 'merkle: для 1000 листьев 10 хэшей — логарифмический размер');
let thr = false; try { M.proof(['a'], 5); } catch (e) { thr = true; } ok(thr, 'merkle: proof несуществующего листа бросает ошибку');
ok(M.root(['a', 'b'], { dbl: true }) !== M.root(['a', 'b']), 'merkle: sha256d отличается от sha256');
const t = M.build(['a', 'b', 'c', 'd', 'e']); ok(t.levels.length === 4 && t.odd.length === 2 || t.odd.length >= 1, 'merkle: отмечены уровни с дублированием, levels=' + t.levels.length + ' odd=' + t.odd.join(','));
console.log(fails ? 'FAILS: ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
