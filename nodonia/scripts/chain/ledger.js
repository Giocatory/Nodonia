/* Нодония — учёт: модели UTXO и счетов, mempool, блоки с реальным PoW, цепочка с форками и реорганизацией.
   Без DOM и без «текущего времени»: полностью детерминировано. Криптография учебная. */
(function (G) {
  'use strict';
  const ND = G.ND, E = ND.ecdsa, sha = ND.sha256d;
  const L = ND.ledger = {};
  const isInt = v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1e15;
  const ZERO = '0'.repeat(64);
  const bad = (code, err) => ({ ok: false, code, err });

  /* =============== модель UTXO =============== */
  const U = L.utxo = {
    model: 'utxo',
    txId(tx) { return sha((tx.ins || []).map(i => i.txid + ':' + i.vout).join(',') + '|' + (tx.outs || []).map(o => o.addr + ':' + o.amt).join(',') + '|' + (tx.memo || '')); },
    coinbase(addr, amt, height) { const tx = { ins: [], outs: [{ addr, amt }], memo: 'coinbase:' + height, coinbase: true }; tx.id = U.txId(tx); return tx; },
    newState(alloc) { const s = { u: {} }; let i = 0; for (const a in alloc || {}) { s.u['genesis:' + (i++)] = { addr: a, amt: alloc[a] }; } return s; },
    /** проверка транзакции относительно состояния → {ok, fee} либо {ok:false, code, err} */
    validate(tx, state, o) {
      o = o || {};
      if (!tx || !Array.isArray(tx.ins) || !Array.isArray(tx.outs) || !tx.outs.length) return bad('format', 'неверная структура транзакции');
      if (tx.coinbase) return o.allowCoinbase ? { ok: true, fee: 0 } : bad('coinbase', 'coinbase-транзакция допустима только первой в блоке');
      if (!tx.ins.length) return bad('format', 'у транзакции нет входов');
      if (tx.id !== U.txId(tx)) return bad('id', 'идентификатор не соответствует содержимому — транзакцию изменили после подписи');
      let sum = 0, out = 0; const seen = {};
      for (const i of tx.ins) {
        const k = i.txid + ':' + i.vout;
        if (seen[k]) return bad('dupin', 'один и тот же вход использован дважды'); seen[k] = 1;
        const u = state.u[k];
        if (!u) return bad('missing', 'вход ' + String(i.txid).slice(0, 8) + '…:' + i.vout + ' не существует или уже потрачен (двойная трата)');
        if (!i.pub || !i.sig) return bad('nosig', 'вход не подписан');
        let addr; try { addr = E.address(i.pub); } catch (e) { return bad('pub', 'неверный публичный ключ'); }
        if (addr !== u.addr) return bad('owner', 'публичный ключ не соответствует владельцу выхода (чужая монета)');
        if (!E.verifyHash(tx.id, i.sig, i.pub)) return bad('sig', 'неверная подпись');
        sum += u.amt;
      }
      for (const o2 of tx.outs) { if (!isInt(o2.amt) || o2.amt <= 0 || typeof o2.addr !== 'string') return bad('amount', 'сумма выхода должна быть целой и положительной'); out += o2.amt; }
      if (out > sum) return bad('overspend', 'выходы (' + out + ') больше входов (' + sum + ')');
      return { ok: true, fee: sum - out };
    },
    apply(tx, state) { for (const i of tx.ins) delete state.u[i.txid + ':' + i.vout]; tx.outs.forEach((o, n) => { state.u[tx.id + ':' + n] = { addr: o.addr, amt: o.amt }; }); },
    balance(state, addr) { let s = 0; for (const k in state.u) if (state.u[k].addr === addr) s += state.u[k].amt; return s; },
    list(state, addr) { return Object.keys(state.u).filter(k => state.u[k].addr === addr).map(k => { const p = k.split(':'); return { txid: p[0], vout: +p[1], key: k, amt: state.u[k].amt }; }); },
    /** собрать и подписать платёж; exclude — множество уже занятых входов (например из mempool) */
    pay(state, w, to, amt, fee, o) {
      o = o || {}; const ex = o.exclude || {}; const mine = U.list(state, w.addr).filter(x => !ex[x.key]).sort((a, b) => b.amt - a.amt || (a.key < b.key ? -1 : 1));
      const need = amt + (fee || 0); let got = 0; const ins = [];
      for (const u of mine) { if (got >= need) break; ins.push({ txid: u.txid, vout: u.vout }); got += u.amt; }
      if (got < need) throw new Error('недостаточно средств: нужно ' + need + ', доступно ' + got);
      const outs = [{ addr: to, amt }]; if (got > need) outs.push({ addr: w.addr, amt: got - need });
      const tx = { ins, outs, memo: o.memo || '' }; tx.id = U.txId(tx); const sig = ND.wallet.signId(tx.id, w); tx.ins = ins.map(i => ({ txid: i.txid, vout: i.vout, pub: w.pub, sig })); return tx;
    },
  };

  /* =============== модель счетов =============== */
  const A = L.account = {
    model: 'account',
    txId(tx) { return sha([tx.from, tx.to, tx.amt, tx.fee, tx.nonce, tx.data || ''].join('|')); },
    newState(alloc) { return { bal: Object.assign({}, alloc || {}), nonce: {} }; },
    make(w, to, amt, fee, nonce, data) { const tx = { from: w.addr, pub: w.pub, to, amt, fee, nonce, data: data || '' }; tx.id = A.txId(tx); tx.sig = ND.wallet.signId(tx.id, w); return tx; },
    validate(tx, state, o) {
      o = o || {};
      if (!tx || typeof tx.from !== 'string' || typeof tx.to !== 'string' || !isInt(tx.amt) || !isInt(tx.fee) || !isInt(tx.nonce)) return bad('format', 'неверная структура транзакции');
      if (tx.id !== A.txId(tx)) return bad('id', 'идентификатор не соответствует содержимому — транзакцию изменили после подписи');
      let addr; try { addr = E.address(tx.pub); } catch (e) { return bad('pub', 'неверный публичный ключ'); }
      if (addr !== tx.from) return bad('owner', 'публичный ключ не соответствует адресу отправителя');
      if (!tx.sig || !E.verifyHash(tx.id, tx.sig, tx.pub)) return bad('sig', 'неверная подпись');
      const n = state.nonce[tx.from] || 0;
      if (o.minNonce ? tx.nonce < n : tx.nonce !== n) return bad('nonce', 'неверный nonce: ожидается ' + n + ', получен ' + tx.nonce + (tx.nonce < n ? ' (повтор: транзакция уже была выполнена)' : ' (пропуск)'));
      if ((state.bal[tx.from] || 0) < tx.amt + tx.fee) return bad('balance', 'недостаточно средств: баланс ' + (state.bal[tx.from] || 0) + ', нужно ' + (tx.amt + tx.fee));
      return { ok: true, fee: tx.fee };
    },
    apply(tx, state) { state.bal[tx.from] -= tx.amt + tx.fee; state.bal[tx.to] = (state.bal[tx.to] || 0) + tx.amt; state.nonce[tx.from] = (state.nonce[tx.from] || 0) + 1; },
    balance(state, addr) { return state.bal[addr] || 0; },
  };
  L.models = { utxo: U, account: A };

  /* =============== блок =============== */
  L.hashBlock = b => sha([b.prev, b.merkle, b.time, b.bits, b.nonce, b.miner].join('|'));
  L.blockMerkle = txs => ND.merkle.root(txs.map(t => t.id), { dbl: true });
  L.workOf = bits => Math.pow(2, bits);
  L.powOk = (hash, bits) => ND.leadingZeroBits(hash) >= bits;
  /** перебор nonce порцией: true, если найден. Меняет b.nonce и b.hash */
  L.mineChunk = function (b, tries) { for (let i = 0; i < tries; i++) { b.hash = L.hashBlock(b); if (L.powOk(b.hash, b.bits)) return true; b.nonce++; } return false; };
  L.mine = function (b, maxTries) { const n0 = b.nonce; const ok = L.mineChunk(b, maxTries || 1e7); return { found: ok, tries: b.nonce - n0 + (ok ? 1 : 0) }; };

  /* =============== цепочка =============== */
  class Chain {
    /** o: {model:'utxo'|'account', bits, reward, alloc:{адрес:сумма}} */
    constructor(o) {
      o = o || {}; this.model = o.model === 'account' ? 'account' : 'utxo'; this.M = L.models[this.model]; this.bits = ND.num(o.bits, 12, 0, 40); this.reward = ND.num(o.reward, 50, 0, 1e9); this.alloc = Object.assign({}, o.alloc);
      this.recs = {}; this.orphans = [];
      const g = { height: 0, prev: ZERO, time: 0, bits: 0, nonce: 0, miner: 'genesis', txs: [] }; g.merkle = L.blockMerkle(g.txs); g.hash = L.hashBlock(g);
      const st = this.M.newState(this.alloc); this.recs[g.hash] = { b: g, parent: null, work: 0, height: 0, state: st, fees: 0 };
      this.genesis = g; this.tip = g.hash; this.recent = [];
    }
    get tipRec() { return this.recs[this.tip]; }
    get height() { return this.tipRec.height; }
    get state() { return this.tipRec.state; }
    balanceOf(addr, hash) { return this.M.balance((hash ? this.recs[hash] : this.tipRec).state, addr); }
    utxosOf(addr) { return this.model === 'utxo' ? U.list(this.state, addr) : []; }
    path(hash) { const out = []; let r = this.recs[hash || this.tip]; while (r) { out.push(r.b); r = r.parent ? this.recs[r.parent] : null; } return out.reverse(); }
    mainBlocks() { return this.path(); }
    /** блок, в котором лежит транзакция в основной цепи → {block, confirmations} */
    findTx(id) { const p = this.path(); for (const b of p) if (b.txs.some(t => t.id === id)) return { block: b, height: b.height, confirmations: this.height - b.height + 1 }; return null; }
    /** построить непромайненный блок на вершине (или на parent); невалидные транзакции пропускаются */
    template(minerAddr, txs, o) {
      o = o || {}; const prec = this.recs[o.parent || this.tip], st = JSON.parse(JSON.stringify(prec.state)), height = prec.height + 1, use = []; let fees = 0; const skipped = [];
      for (const tx of txs || []) { const v = this.M.validate(tx, st, { minNonce: false }); if (v.ok) { this.M.apply(tx, st); fees += v.fee; use.push(tx); } else skipped.push({ tx, err: v.err }); }
      const all = this.model === 'utxo' ? [U.coinbase(minerAddr, this.reward + fees, height)].concat(use) : use;
      const b = { height, prev: prec.b.hash, time: o.time != null ? o.time : prec.b.time + 600, bits: this.bits, nonce: 0, miner: minerAddr, txs: all };
      b.merkle = L.blockMerkle(all); b.hash = L.hashBlock(b); b.skipped = skipped; b.fees = fees; return b;
    }
    /** полная проверка блока относительно родителя → {ok, state, fees} либо {ok:false, err} */
    validateBlock(b, prec) {
      if (!b || !Array.isArray(b.txs)) return bad('format', 'неверная структура блока');
      if (b.prev !== prec.b.hash) return bad('prev', 'prev не совпадает с хэшем родителя');
      if (b.height !== prec.height + 1) return bad('height', 'неверная высота блока');
      if (b.bits !== this.bits) return bad('bits', 'сложность блока не равна сложности сети (' + this.bits + ')');
      if (b.hash !== L.hashBlock(b)) return bad('hash', 'хэш блока не соответствует его заголовку');
      if (!L.powOk(b.hash, b.bits)) return bad('pow', 'недостаточно работы: нужно ' + b.bits + ' нулевых бит, у блока ' + ND.leadingZeroBits(b.hash));
      if (b.merkle !== L.blockMerkle(b.txs)) return bad('merkle', 'корень Меркла не соответствует транзакциям');
      const st = JSON.parse(JSON.stringify(prec.state)); let fees = 0; const ids = {};
      for (let i = 0; i < b.txs.length; i++) {
        const tx = b.txs[i]; if (ids[tx.id]) return bad('dup', 'транзакция повторяется в блоке'); ids[tx.id] = 1;
        if (this.model === 'utxo' && i === 0) { if (!tx.coinbase || tx.ins.length || tx.id !== U.txId(tx)) return bad('coinbase', 'первой должна быть корректная coinbase-транзакция'); continue; }
        const v = this.M.validate(tx, st, {}); if (!v.ok) return bad('tx', 'транзакция ' + String(tx.id).slice(0, 8) + '…: ' + v.err); this.M.apply(tx, st); fees += v.fee;
      }
      if (this.model === 'utxo') {
        if (!b.txs.length) return bad('coinbase', 'в блоке нет coinbase'); const cb = b.txs[0], tot = cb.outs.reduce((s, o) => s + o.amt, 0);
        if (tot > this.reward + fees) return bad('reward', 'coinbase выдаёт ' + tot + ', а допустимо ' + (this.reward + fees)); U.apply(cb, st);
      } else if (this.reward + fees > 0) st.bal[b.miner] = (st.bal[b.miner] || 0) + this.reward + fees;
      return { ok: true, state: st, fees };
    }
    /** добавить блок: status = extended | reorg | sidechain | orphan | known | invalid */
    addBlock(b) {
      if (b && this.recs[b.hash]) return { ok: false, status: 'known', err: 'блок уже известен' };
      const prec = b && this.recs[b.prev]; if (!prec) return { ok: false, status: 'orphan', err: 'неизвестный родительский блок (сирота)' };
      const v = this.validateBlock(b, prec); if (!v.ok) return { ok: false, status: 'invalid', err: v.err, code: v.code };
      const rec = { b, parent: b.prev, work: prec.work + L.workOf(b.bits), height: b.height, state: v.state, fees: v.fees }; this.recs[b.hash] = rec;
      const old = this.tip;
      if (rec.work > this.tipRec.work) {
        this.tip = b.hash;
        if (b.prev === old) return { ok: true, status: 'extended' };
        // реорганизация: найти общего предка
        const oldPath = this.path(old), newPath = this.path(b.hash); let i = 0; while (i < oldPath.length && i < newPath.length && oldPath[i].hash === newPath[i].hash) i++;
        return { ok: true, status: 'reorg', depth: oldPath.length - i, dropped: oldPath.slice(i), added: newPath.slice(i), fork: oldPath[i - 1] };
      }
      return { ok: true, status: 'sidechain' };
    }
    tips() { const hasChild = {}; for (const h in this.recs) if (this.recs[h].parent) hasChild[this.recs[h].parent] = 1; return Object.keys(this.recs).filter(h => !hasChild[h]).map(h => this.recs[h]); }
    totalWork() { return this.tipRec.work; }
  }
  L.Chain = Chain;

  /* =============== mempool =============== */
  class Mempool {
    constructor(chain) { this.chain = chain; this.txs = []; this.log = []; }
    spentKeys() { const s = {}; for (const t of this.txs) if (t.ins) for (const i of t.ins) s[i.txid + ':' + i.vout] = t.id; return s; }
    /** → {ok} либо {ok:false, err, conflict?} */
    add(tx) {
      const c = this.chain, M = c.M;
      if (tx && this.txs.some(t => t.id === tx.id)) return { ok: false, err: 'транзакция уже в mempool' };
      const v = M.validate(tx, c.state, { minNonce: true }); if (!v.ok) return { ok: false, err: v.err, code: v.code };
      if (c.model === 'utxo') { const sp = this.spentKeys(); for (const i of tx.ins) if (sp[i.txid + ':' + i.vout]) return { ok: false, err: 'конфликт: вход уже потрачен транзакцией ' + sp[i.txid + ':' + i.vout].slice(0, 8) + '… из mempool (двойная трата)', code: 'conflict', conflict: sp[i.txid + ':' + i.vout] }; }
      else { const dup = this.txs.find(t => t.from === tx.from && t.nonce === tx.nonce); if (dup) return { ok: false, err: 'в mempool уже есть транзакция этого отправителя с nonce ' + tx.nonce + ' (замена — только с большей комиссией)', code: 'conflict', conflict: dup.id }; }
      this.txs.push(tx); return { ok: true, fee: v.fee };
    }
    fee(tx) { if (tx.fee != null) return tx.fee; let s = 0; const st = this.chain.state; for (const i of tx.ins) { const u = st.u[i.txid + ':' + i.vout]; if (u) s += u.amt; } return s - tx.outs.reduce((a, o) => a + o.amt, 0); }
    /** выбор транзакций для блока: по убыванию комиссии с проверкой на промежуточном состоянии */
    select(max) {
      const c = this.chain, st = JSON.parse(JSON.stringify(c.state)), left = this.txs.slice().sort((a, b) => this.fee(b) - this.fee(a) || (a.id < b.id ? -1 : 1)), pick = [];
      let prog = true; while (prog && pick.length < (max || 1e9)) { prog = false; for (let i = 0; i < left.length && pick.length < (max || 1e9); i++) { const v = c.M.validate(left[i], st, {}); if (v.ok) { c.M.apply(left[i], st); pick.push(left[i]); left.splice(i, 1); i--; prog = true; } } }
      return pick;
    }
    /** после нового блока убрать включённые и ставшие недействительными */
    clean() { const c = this.chain, keep = []; const incl = {}; for (const b of c.path()) for (const t of b.txs) incl[t.id] = 1; for (const t of this.txs) { if (incl[t.id]) continue; if (c.M.validate(t, c.state, { minNonce: true }).ok) keep.push(t); } const removed = this.txs.length - keep.length; this.txs = keep; return removed; }
    remove(id) { this.txs = this.txs.filter(t => t.id !== id); }
  }
  L.Mempool = Mempool;
})(typeof window !== 'undefined' ? window : globalThis);
