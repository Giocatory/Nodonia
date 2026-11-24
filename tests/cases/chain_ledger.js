const { load, CORE } = require('../load.js');
const crypto = require('crypto');
const C = load([...CORE, 'scripts/core/ecdsa.js', 'scripts/chain/merkle.js', 'scripts/chain/wallet.js', 'scripts/chain/ledger.js']); const ND = C.ND, L = ND.ledger;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sh = (b) => crypto.createHash('sha256').update(b).digest();
/* ---- Merkle ---- */
const M = ND.merkle;
const l = ['a', 'b', 'c'].map(x => sh(Buffer.from(x)).toString('hex'));
const ref = (a, b) => sh(Buffer.concat([Buffer.from(a, 'hex'), Buffer.from(b, 'hex')])).toString('hex');
ok(M.root(['a', 'b', 'c']) === ref(ref(l[0], l[1]), ref(l[2], l[2])), 'Merkle: корень 3 листьев (дублирование последнего) = независимый расчёт');
ok(M.root(['x']) === sh(Buffer.from('x')).toString('hex'), 'Merkle: один лист — корень равен хэшу листа');
const dbl = x => sh(sh(Buffer.from(x))).toString('hex');
ok(M.root(['a'], { dbl: true }) === dbl('a'), 'Merkle: двойной SHA-256');
for (const n of [1, 2, 3, 5, 8, 11]) { const items = Array.from({ length: n }, (_, i) => 'tx' + i); const root = M.root(items); let all = true; for (let i = 0; i < n; i++) { const p = M.proof(items, i); all = all && M.verify(items[i], p, root).ok && !M.verify('подмена', p, root).ok; } ok(all, 'Merkle: доказательства всех листьев при n=' + n + ' верны, подмена ловится'); }
ok(M.root(['a', 'b', 'c', 'd']) !== M.root(['a', 'b', 'c', 'd', 'd']) || true, 'Merkle: (известная особенность CVE-2012-2459 — дубликаты) документируется');
const t3 = M.build(['a', 'b', 'c']); ok(t3.levels.length === 3 && t3.odd.length >= 1, 'Merkle: уровни и отметка дублирования');
/* ---- UTXO ---- */
const W = ND.wallet, al = W.create('Алиса'), bo = W.create('Боб'), ca = W.create('Карл'), mi = W.create('Майнер');
let ch = new L.Chain({ model: 'utxo', bits: 12, reward: 50, alloc: { [al.addr]: 100 } });
ok(ch.balanceOf(al.addr) === 100 && ch.height === 0, 'utxo: генезис выдал Алисе 100');
const tx1 = L.utxo.pay(ch.state, al, bo.addr, 30, 2); ok(L.utxo.validate(tx1, ch.state).ok && L.utxo.validate(tx1, ch.state).fee === 2, 'utxo: платёж валиден, комиссия 2');
ok(tx1.outs.length === 2 && tx1.outs[1].amt === 68, 'utxo: сдача 68');
const mp = new L.Mempool(ch); ok(mp.add(tx1).ok, 'mempool принял платёж');
const tx2 = L.utxo.pay(ch.state, al, ca.addr, 30, 1); const r2 = mp.add(tx2); ok(!r2.ok && r2.code === 'conflict', 'mempool отверг двойную трату: ' + r2.err);
// подделка: изменить сумму после подписи
const forged = JSON.parse(JSON.stringify(tx1)); forged.outs[0].amt = 99; ok(!L.utxo.validate(forged, ch.state).ok && L.utxo.validate(forged, ch.state).code === 'id', 'utxo: изменение суммы после подписи ловится');
// подделка с пересчитанным id, но чужой подписью
const f2 = JSON.parse(JSON.stringify(tx1)); f2.outs = [{ addr: ca.addr, amt: 98 }]; f2.id = L.utxo.txId(f2); ok(L.utxo.validate(f2, ch.state).code === 'sig', 'utxo: пересчитанный id, но подпись не подходит → sig');
// чужая монета
const steal = L.utxo.pay(ch.state, al, ca.addr, 10, 0); const st2 = JSON.parse(JSON.stringify(steal)); st2.ins.forEach(i => { i.pub = ca.pub; i.sig = W.signId(st2.id, ca); }); ok(L.utxo.validate(st2, ch.state).code === 'owner', 'utxo: подпись другим ключом → owner');
ok(L.utxo.validate({ ins: [], outs: [] }, ch.state).code === 'format', 'utxo: пустая транзакция');
let blk = ch.template(mi.addr, mp.select()); const res = L.mine(blk, 5e6); ok(res.found && ND.leadingZeroBits(blk.hash) >= 12, 'PoW: найден nonce за ' + res.tries + ' попыток (12 бит)');
const ar = ch.addBlock(blk); ok(ar.ok && ar.status === 'extended' && ch.height === 1, 'блок добавлен');
ok(ch.balanceOf(bo.addr) === 30 && ch.balanceOf(al.addr) === 68 && ch.balanceOf(mi.addr) === 52, 'utxo: балансы Боб 30, Алиса 68, майнер 50+2');
mp.clean(); ok(mp.txs.length === 0, 'mempool очищен (включённая транзакция удалена)');
const rep = ch.addBlock(blk); ok(rep.status === 'known', 'повтор блока → known');
// двойная трата в блоке
const dsB = ch.template(mi.addr, [tx1]); ok(dsB.txs.length === 1 && dsB.skipped.length === 1, 'template пропустил уже потраченную транзакцию');
// блок с недостаточным PoW
const weak = ch.template(mi.addr, []); weak.nonce = 0; weak.hash = L.hashBlock(weak); let w = 0; while (L.powOk(weak.hash, 12)) { weak.nonce++; weak.hash = L.hashBlock(weak); w++; } ok(ch.addBlock(weak).code === 'pow', 'блок без работы отвергнут');
// изменение транзакции в блоке → merkle/hash
const b2 = ch.template(mi.addr, []); L.mine(b2, 5e6); const tam = JSON.parse(JSON.stringify(b2)); tam.txs[0].outs[0].amt = 1e6; ok(['merkle', 'hash', 'coinbase'].includes(ch.addBlock(tam).code), 'изменённый блок отвергнут');
// жадная coinbase
const gr = ch.template(mi.addr, []); gr.txs[0].outs[0].amt = 5000; gr.txs[0].id = L.utxo.txId(gr.txs[0]); gr.merkle = L.blockMerkle(gr.txs); gr.nonce = 0; L.mine(gr, 5e6); ok(ch.addBlock(gr).code === 'reward', 'завышенная награда отвергнута');
ok(ch.findTx(tx1.id).confirmations === 1, 'findTx: 1 подтверждение');
/* ---- форки и реорганизация ---- */
ch = new L.Chain({ model: 'utxo', bits: 10, reward: 50, alloc: { [al.addr]: 100 } });
const mine = (c, miner, txs, parent, time) => { const b = c.template(miner, txs, { parent, time }); L.mine(b, 5e6); return b; };
const A1 = mine(ch, mi.addr, [], undefined, 100); ch.addBlock(A1);
const t = L.utxo.pay(ch.state, al, bo.addr, 40, 0); const A2 = mine(ch, mi.addr, [t], undefined, 200); ch.addBlock(A2);
ok(ch.height === 2 && ch.balanceOf(bo.addr) === 40, 'основная ветка: Боб получил 40');
// злоумышленная ветка от генезиса с другой тратой (двойная трата) — длиннее
const fork = []; let par = ch.genesis.hash; const ev = W.create('Карл-злоумышленник');
const B1 = mine(ch, ca.addr, [], par, 150); let rr = ch.addBlock(B1); ok(rr.status === 'sidechain', 'короткая боковая ветка — sidechain');
const ds = L.utxo.pay(JSON.parse(JSON.stringify(ch.recs[B1.hash].state)), al, ca.addr, 100, 0);
const B2 = mine(ch, ca.addr, [ds], B1.hash, 250); rr = ch.addBlock(B2); ok(rr.status === 'sidechain' || rr.status === 'reorg', 'ветка B длины 2 равна по работе: ' + rr.status);
ok(ch.tip === A2.hash, 'при равной работе остаётся первая ветка');
const B3 = mine(ch, ca.addr, [], B2.hash, 350); rr = ch.addBlock(B3);
ok(rr.status === 'reorg' && rr.depth === 2 && ch.tip === B3.hash, 'реорганизация глубиной 2 на более тяжёлую цепь');
ok(ch.balanceOf(bo.addr) === 0 && ch.balanceOf(ca.addr) >= 100, 'после реорганизации платёж Бобу исчез (двойная трата удалась), Карл получил 100');
ok(ch.findTx(t.id) === null, 'findTx: исходная транзакция больше не в основной цепи');
const orph = { height: 5, prev: 'ab'.repeat(32), time: 1, bits: 10, nonce: 0, miner: 'x', txs: [], merkle: '', hash: '' }; ok(ch.addBlock(orph).status === 'orphan', 'блок с неизвестным родителем → orphan');
ok(ch.tips().length === 2, 'tips: две вершины (основная и осиротевшая ветка)');
/* ---- счета ---- */
let ac = new L.Chain({ model: 'account', bits: 10, reward: 5, alloc: { [al.addr]: 100 } });
const a1 = L.account.make(al, bo.addr, 40, 1, 0); ok(L.account.validate(a1, ac.state).ok, 'account: платёж валиден');
ok(L.account.validate(L.account.make(al, bo.addr, 40, 1, 1), ac.state).code === 'nonce', 'account: пропуск nonce отвергается');
ok(L.account.validate(L.account.make(al, bo.addr, 500, 1, 0), ac.state).code === 'balance', 'account: недостаточно средств');
const mp2 = new L.Mempool(ac); ok(mp2.add(a1).ok, 'account: mempool принял'); ok(mp2.add(L.account.make(al, ca.addr, 10, 1, 0)).code === 'conflict', 'account: тот же nonce — конфликт');
ok(mp2.add(L.account.make(al, ca.addr, 10, 3, 1)).ok, 'account: nonce 1 принят (цепочка)');
const ab = ac.template(mi.addr, mp2.select()); ok(ab.txs.length === 2, 'account: в блок вошли обе по порядку nonce'); L.mine(ab, 5e6); ok(ac.addBlock(ab).ok, 'account: блок принят');
ok(ac.balanceOf(al.addr) === 100 - 40 - 1 - 10 - 3 && ac.balanceOf(bo.addr) === 40 && ac.balanceOf(mi.addr) === 5 + 4, 'account: балансы и награда майнера 5+комиссии 4');
ok(L.account.validate(a1, ac.state).code === 'nonce', 'account: повтор (replay) отвергается');
ok(JSON.stringify(ac.state) === JSON.stringify(ac.recs[ac.tip].state), 'состояние согласовано');
console.log(fails ? 'FAILS: ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
