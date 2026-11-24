/* Нодония — кошельки, подписи ECDSA, транзакции, mempool и майнинг блока (UTXO и счета). */
(function (G) {
  'use strict';
  const ND = G.ND, ui = ND.ui, h = ui.h, esc = ND.esc, L = ND.ledger;
  const short = a => ND.wallet.short(a);
  ui.registerWorkspace({
    id: 'wallet', title: 'Кошельки и транзакции', group: 'Блокчейн', order: 40, short: 'Ключи ECDSA, подпись, UTXO против счетов, mempool, двойная трата, майнинг.',
    mount(root) {
      const names = ['Алиса', 'Боб', 'Карл', 'Майнер']; const W = names.map(n => ND.wallet.create(n)), byAddr = a => W.find(w => w.addr === a);
      let model = 'utxo', bits = 10, chain, pool, draft = null, logs = [], mining = null, showPriv = false, selW = 0;
      const page = h('div', { class: 'page' }); root.append(page);
      const say = (t, k) => { logs.unshift({ t, k }); if (logs.length > 30) logs.pop(); };
      function world() { if (mining) { mining.c = true; mining = null; } const alloc = { [W[0].addr]: 100, [W[1].addr]: 20 }; chain = new L.Chain({ model, bits, reward: 50, alloc }); pool = new L.Mempool(chain); draft = null; logs = []; say('Новый мир (' + (model === 'utxo' ? 'UTXO' : 'счета') + '): у Алисы 100, у Боба 20, сложность ' + bits + ' бит.'); }
      const nm = a => { const w = byAddr(a); return w ? w.name : short(a); };
      const from = h('select', { class: 'inp' }, names.slice(0, 3).map((n, i) => h('option', { value: i, text: n }))), to = h('select', { class: 'inp' }, names.map((n, i) => h('option', { value: i, text: n, selected: i === 1 }))), amt = h('input', { class: 'inp', type: 'number', min: 1, value: 30, style: 'width:90px' }), fee = h('input', { class: 'inp', type: 'number', min: 0, value: 2, style: 'width:70px' });
      function build(fi, ti, a, f, o) {
        const w = W[fi], t = W[ti];
        if (model === 'utxo') return L.utxo.pay(chain.state, w, t.addr, a, f, { exclude: (o && o.noExclude) ? {} : pool.spentKeys() });
        const n = (chain.state.nonce[w.addr] || 0) + (o && o.noExclude ? 0 : pool.txs.filter(x => x.from === w.addr).length); return L.account.make(w, t.addr, a, f, n);
      }
      function mk() { try { draft = build(+from.value, +to.value, Math.max(1, Math.floor(+amt.value) || 1), Math.max(0, Math.floor(+fee.value) || 0)); say('Создана и подписана транзакция ' + draft.id.slice(0, 10) + '… (' + nm(model === 'utxo' ? W[+from.value].addr : draft.from) + ' → ' + nm(W[+to.value].addr) + ').', 'ok'); } catch (e) { draft = null; say('Не удалось создать: ' + e.message, 'bad'); } draw(); }
      function tryAdd(tx, what) { const r = pool.add(tx); say((what || 'В mempool') + ': ' + (r.ok ? 'принято ✔' : 'ОТКЛОНЕНО ✘ — ' + r.err), r.ok ? 'ok' : 'bad'); draw(); return r; }
      const clone = o => JSON.parse(JSON.stringify(o));
      function sigOk(tx) { try { if (model === 'utxo') return tx.ins.length && tx.ins.every(i => ND.wallet.verifyId(tx.id, i.sig, i.pub)); return ND.wallet.verifyId(tx.id, tx.sig, tx.pub); } catch (e) { return false; } }
      function forge(kind) {
        if (!draft) return say('Сначала создайте транзакцию.', 'bad'), draw();
        const t = clone(draft);
        if (kind === 'amount') { if (model === 'utxo') t.outs[0].amt += 50; else t.amt += 50; tryAdd(t, 'Подделка суммы после подписи'); }
        else if (kind === 'sig') { const o = W[3]; if (model === 'utxo') { t.ins.forEach(i => { i.pub = o.pub; i.sig = ND.wallet.signId(t.id, o); }); } else { t.pub = o.pub; t.sig = ND.wallet.signId(t.id, o); } tryAdd(t, 'Подпись чужим ключом (Майнер выдаёт себя за владельца)'); }
        else if (kind === 'double') { const r1 = pool.txs.find(x => x.id === draft.id) ? null : null; try { const t2 = build(+from.value, (+to.value + 1) % 4, Math.max(1, Math.floor(+amt.value) || 1), Math.max(0, Math.floor(+fee.value) || 0), { noExclude: true }); say('Вторая транзакция на те же средства (двойная трата) → ' + nm(W[(+to.value + 1) % 4].addr), 'warn'); tryAdd(t2, 'Двойная трата'); } catch (e) { say(e.message, 'bad'); draw(); } }
      }
      function mine() {
        if (mining) return; let blk; try { blk = chain.template(W[3].addr, pool.select()); } catch (e) { return say('Ошибка: ' + e.message, 'bad'), draw(); }
        const ctl = mining = { c: false, tries: 0 }; say('Майнер собирает блок #' + blk.height + ' из ' + (blk.txs.length) + ' транзакций и ищет nonce (' + bits + ' бит)…');
        const step = () => { if (ctl.c) return; const end = performance.now() + 25; let found = false; while (performance.now() < end) { if (L.mineChunk(blk, 400)) { found = true; break; } ctl.tries += 400; } if (!found) { setTimeout(step, 0); return; } mining = null; const r = chain.addBlock(blk); say('Блок #' + blk.height + ' найден (nonce ' + blk.nonce + ', ≈' + (ctl.tries + blk.nonce % 400) + ' попыток): ' + r.status + (r.ok ? ' ✔' : ' — ' + r.err), r.ok ? 'ok' : 'bad'); pool.clean(); draw(); };
        draw(); step();
      }
      function draw() {
        page.innerHTML = '';
        const tb = h('div', { class: 'toolbar', style: 'border:1px solid var(--bd);border-radius:10px;margin-bottom:12px' },
          h('label', { class: 'row' }, 'Модель', h('select', { class: 'inp', onchange: e => { model = e.target.value; world(); draw(); } }, h('option', { value: 'utxo', text: 'UTXO (как Bitcoin)', selected: model === 'utxo' }), h('option', { value: 'account', text: 'Счета (как Ethereum)', selected: model === 'account' }))),
          h('label', { class: 'row' }, 'Сложность', h('select', { class: 'inp', onchange: e => { bits = +e.target.value; world(); draw(); } }, [6, 8, 10, 12, 14, 16].map(b => h('option', { value: b, text: b + ' бит', selected: b === bits })))),
          h('button', { class: 'btn', text: '⟲ Новый мир', onclick: () => { world(); draw(); } }), h('label', { class: 'chk', style: 'margin:0' }, h('input', { type: 'checkbox', checked: showPriv, onchange: e => { showPriv = e.target.checked; draw(); } }), ' показать приватные ключи'));
        page.append(h('h2', { text: 'Кошельки, подписи и транзакции' }), h('p', { class: 'mt', style: 'max-width:800px', html: 'Владение монетами — это <b>умение подписать</b> транзакцию закрытым ключом (ECDSA, кривая secp256k1). Сеть проверяет подпись открытым ключом, баланс и отсутствие двойной траты. Криптография здесь учебная: ключи выводятся из имён для воспроизводимости — <b>не используйте их для реальных средств</b>.' }), tb);
        // кошельки
        const wt = h('table', { class: 'tbl big' }, h('tr', null, ['Кошелёк', 'Адрес', 'Открытый ключ', showPriv ? 'Закрытый ключ' : null, 'Баланс', model === 'account' ? 'nonce' : 'UTXO'].filter(Boolean).map(x => h('th', { text: x }))));
        W.forEach((w, i) => wt.append(h('tr', { class: i === selW ? 'hl' : '', style: 'cursor:pointer', onclick: () => { selW = i; draw(); } }, h('td', { html: '<b>' + w.name + '</b>' }), h('td', { class: 'mono', text: short(w.addr) }), h('td', { class: 'mono', text: w.pub.slice(0, 14) + '…' }), showPriv ? h('td', { class: 'mono', text: w.priv.slice(0, 12) + '…' }) : null, h('td', { html: '<b>' + chain.balanceOf(w.addr) + '</b>' }), h('td', { text: model === 'account' ? String(chain.state.nonce[w.addr] || 0) : chain.utxosOf(w.addr).length + ' шт: ' + chain.utxosOf(w.addr).map(u => u.amt).join(', ') }))));
        // форма
        const form = h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: '1. Создать и подписать транзакцию' }), h('div', { class: 'row' }, 'От', from, 'кому', to, 'сумма', amt, 'комиссия', fee, h('button', { class: 'btn pri', text: '✍ Подписать', onclick: mk })));
        if (draft) {
          const ok = sigOk(draft); form.append(h('div', { style: 'margin-top:10px' }, h('div', { class: 'row' }, h('b', { text: 'Транзакция ' + draft.id.slice(0, 12) + '…' }), h('span', { class: 'badge ' + (ok ? 'ok' : 'bad'), text: ok ? '✔ подпись верна' : '✘ подпись неверна' })), h('pre', { class: 'mono', style: 'max-height:150px;overflow:auto;background:var(--pn2);border:1px solid var(--bd);border-radius:8px;padding:8px;font-size:11px;white-space:pre-wrap;word-break:break-all' }, JSON.stringify(draft, (k, v) => typeof v === 'string' && v.length > 40 ? v.slice(0, 16) + '…' + v.slice(-6) : v, 1)),
            h('div', { class: 'row' }, h('button', { class: 'btn pri', text: '→ В mempool', onclick: () => tryAdd(draft) }), h('span', { class: 'mt sm', text: 'Атаки:' }), h('button', { class: 'btn sm', text: 'подделать сумму', onclick: () => forge('amount') }), h('button', { class: 'btn sm', text: 'чужая подпись', onclick: () => forge('sig') }), h('button', { class: 'btn sm', text: 'двойная трата', onclick: () => forge('double') }))));
        }
        // mempool + майнинг
        const mp = h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: '2. Mempool и майнинг' }), pool.txs.length ? h('div', { html: ui.table(['id', 'кто → кому', 'комиссия'], pool.txs.map(t => { const fr = model === 'utxo' ? nm(addrOf(t.ins[0])) : nm(t.from), tos = model === 'utxo' ? nm(t.outs[0].addr) : nm(t.to); return ['<span class="mono">' + t.id.slice(0, 10) + '…</span>', fr + ' → ' + tos, pool.fee(t)]; })) }) : h('p', { class: 'mt', text: 'Mempool пуст — это очередь непромайненных транзакций.' }),
          h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn pri', text: mining ? '⛏ майнится…' : '⛏ Майнить блок (Майнер)', disabled: !!mining, onclick: mine }), h('span', { class: 'mt sm', text: 'награда 50 + комиссии; выбираются транзакции с большей комиссией' })));
        function addrOf(i) { return ND.ecdsa.address(i.pub); }
        const chainBox = h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: '3. Цепочка' }), h('div', { html: ui.table(['#', 'майнер', 'транзакций', 'хэш', 'подтверждений'], chain.path().slice().reverse().map(b => [b.height, b.height ? nm(b.miner) : 'генезис', b.txs.length, '<span class="mono">' + b.hash.slice(0, 12) + '…</span>', chain.height - b.height + 1])) }));
        const lg = h('div', { class: 'card' }, h('h3', { style: 'margin-top:0', text: 'Журнал' }), logs.map(l => h('div', { class: 'sm ' + (l.k === 'bad' ? 'bad' : l.k === 'ok' ? 'ok' : l.k === 'warn' ? 'warn' : ''), text: '• ' + l.t })));
        page.append(wt, h('div', { class: 'cols', style: 'margin-top:12px' }, form, mp), h('div', { class: 'cols', style: 'margin-top:12px' }, chainBox, lg), h('div', { class: 'callout', style: 'margin-top:12px', html: model === 'utxo' ? '<b>UTXO:</b> монет «на счёте» нет — есть непотраченные выходы. Транзакция тратит выходы целиком и создаёт новые (платёж + <i>сдача</i> себе). Двойная трата — попытка потратить один выход дважды.' : '<b>Счета:</b> баланс — число в состоянии, у отправителя растёт <code>nonce</code>. Повторить транзакцию нельзя (nonce уже использован), двойная трата — две транзакции с одним nonce.' }));
      }
      world(); draw();
      return { unmount() { if (mining) mining.c = true; } };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
