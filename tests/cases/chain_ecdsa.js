const { load, CORE } = require('../load.js');
const crypto = require('crypto');
const C = load([...CORE, 'scripts/core/ecdsa.js']); const ND = C.ND, E = ND.ecdsa;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
ok(E.publicKey('01', false).slice(2, 66) === '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'priv=1 → pub = G (x)');
ok(E.publicKey('01', true) === '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'сжатый G');
ok(E.publicKey('02').slice(2) === 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5', 'priv=2 → 2G (известная x)');
// известный публичный ключ для priv = 0xe9873d79c6d87dc0fb6a5778633389f4453213303da61f20bd67fc233aa33262 (из тестов Bitcoin)
ok(E.publicKey('e9873d79c6d87dc0fb6a5778633389f4453213303da61f20bd67fc233aa33262', true) === '02588d202afcc1ee4ab5254c7847ec25b9a135bbda0f2bc69ee1a714749fd77dc9', 'известная пара из Bitcoin-тестов');
// сверка с node:crypto для нескольких случайных ключей
for (let i = 0; i < 5; i++) { const ecdh = crypto.createECDH('secp256k1'); ecdh.generateKeys(); const priv = ecdh.getPrivateKey('hex').padStart(64, '0'); ok(E.publicKey(priv, false) === ecdh.getPublicKey('hex', 'uncompressed'), 'pub совпал с node:crypto #' + i); ok(E.publicKey(priv, true) === ecdh.getPublicKey('hex', 'compressed'), 'сжатый pub #' + i); }
// HMAC
ok(E.hmacSha256('key', 'The quick brown fox jumps over the lazy dog') === 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8', 'HMAC-SHA256 тест-вектор');
// RFC 6979 для secp256k1: приватный ключ 1, сообщение "Satoshi Nakamoto" (известный вектор Bitcoin-библиотек)
const sig = E.sign('Satoshi Nakamoto', '01');
ok(sig.r === '934b1ea10a4b3c1757e2b0c017d0b6143ce3c9a7e6a4a49860d7a6ab210ee3d8' && sig.s === '2442ce9d2b916064108014783e923ec36b49743e2ffa1c4496f01a512aafd9e5', 'RFC6979 вектор (key=1, «Satoshi Nakamoto»)');
const priv = E.privFromSeed('alice'), pub = E.publicKey(priv, true), h = ND.sha256('перевод 5 монет');
const s2 = E.signHash(h, priv);
ok(E.verifyHash(h, s2, pub), 'подпись проверяется');
ok(E.verifyHash(ND.sha256('перевод 6 монет'), s2, pub) === false, 'подделка сообщения не проходит');
ok(E.verifyHash(h, s2, E.publicKey(E.privFromSeed('bob'), true)) === false, 'чужой ключ не проходит');
ok(E.verifyHash(h, { r: s2.r, s: s2.s.replace(/.$/, x => x === '0' ? '1' : '0') }, pub) === false, 'испорченная s не проходит');
ok(BigInt('0x' + s2.s) <= E.N / 2n, 'low-S');
ok(JSON.stringify(E.signHash(h, priv)) === JSON.stringify(s2), 'подпись детерминирована');
// проверка node:crypto подписи нашего ключа
const k = crypto.createECDH('secp256k1'); k.setPrivateKey(priv, 'hex');
const pemKey = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('3056301006072a8648ce3d020106052b8104000a034200', 'hex'), Buffer.from(E.publicKey(priv, false), 'hex')]), format: 'der', type: 'spki' });
const der = (r, s) => { const t = x => { let b = Buffer.from(x, 'hex'); while (b[0] === 0 && b.length > 1) b = b.slice(1); if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); return Buffer.concat([Buffer.from([2, b.length]), b]); }; const rr = t(r), ss = t(s); return Buffer.concat([Buffer.from([0x30, rr.length + ss.length]), rr, ss]); };
const sm = E.sign('перевод 5 монет', priv); ok(crypto.verify('sha256', Buffer.from('перевод 5 монет'), { key: pemKey, dsaEncoding: 'der' }, der(sm.r, sm.s)), 'подпись проверяется независимой реализацией node:crypto');
ok(!crypto.verify('sha256', Buffer.from('перевод 6 монет'), { key: pemKey, dsaEncoding: 'der' }, der(sm.r, sm.s)), 'node:crypto тоже отвергает подделку');
ok(E.decodePub(E.publicKey(priv, true)).toString() === E.decodePub(E.publicKey(priv, false)).toString(), 'разжатие pub');
ok(/^0x[0-9a-f]{40}$/.test(E.address(pub)), 'адрес 0x+40hex');
let threw = false; try { E.publicKey('0'); } catch (e) { threw = true; } ok(threw, 'priv=0 отвергается');
ok(E.verifyHash(h, s2, '02' + '00'.repeat(32)) === false, 'мусорный pub не роняет');
const t0 = Date.now(); for (let i = 0; i < 5; i++) { const sg = E.signHash(h, priv); E.verifyHash(h, sg, pub); } console.log('sign+verify ×5 за', Date.now() - t0, 'мс');
console.log(fails ? 'FAILS: ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
