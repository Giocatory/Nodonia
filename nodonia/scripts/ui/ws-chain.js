/* Нодония — цепочка блоков: заголовок, корень Меркла, nonce, proof-of-work, неизменяемость. */
(function (G) {
  'use strict';
  const ND = G.ND, ui = ND.ui, h = ui.h, esc = ND.esc;
  const hdr = b => ND.sha256d([b.n, b.prev, ND.merkle.root(b.txs.split('\n').filter(x => x.trim()), { dbl: true }), b.nonce].join('|'));
  ui.registerWorkspace({
    id: 'chain', title: 'Цепочка блоков', group: 'Блокчейн', order: 30, short: 'Блоки, хэши, nonce и PoW: почему нельзя тихо переписать историю.',
    mount(root) {
      const ZERO = '0'.repeat(64); let bits = 12, blocks = [], busy = null;
      const page = h('div', { class: 'page' }); root.append(page);
      const seed = [['Алиса → Боб 5\nБоб → Карл 2', 1], ['Карл → Дина 1\nДина → Алиса 3', 2], ['Ева → Боб 7', 3], ['Боб → Алиса 1\nАлиса → Ева 4\nКарл → Боб 2', 4]];
      function reset() { blocks = seed.map(([t], i) => ({ n: i + 1, prev: ZERO, txs: t, nonce: 0 })); blocks.forEach(b => b.mined = false); }
      function ok(i) { const b = blocks[i], hx = hdr(b); return ND.leadingZeroBits(hx) >= bits && b.prev === (i ? hdr(blocks[i - 1]) : ZERO); }
      function link() { blocks.forEach((b, i) => { b.prev = i ? hdr(blocks[i - 1]) : ZERO; }); }
      const sel = h('select', { class: 'inp', onchange: () => { bits = +sel.value; draw(); } }, [0, 8, 12, 16, 18, 20].map(b => h('option', { value: b, text: b + ' бит' + (b ? ' (≈ ' + (2 ** b).toLocaleString('ru') + ' попыток)' : ' (без работы)'), selected: b === bits })));
      const msg = h('div', { class: 'callout' }), row = h('div', { class: 'chain' });
      function mineFrom(i0, done, only) {
        if (busy) return; const ctl = busy = { c: false }; let i = i0;
        const step = () => {
          if (ctl.c) { busy = null; return; }
          const end = performance.now() + 25;
          while (i < blocks.length && performance.now() < end) { const b = blocks[i]; b.prev = i ? hdr(blocks[i - 1]) : ZERO; if (ND.leadingZeroBits(hdr(b)) >= bits) { i++; if (only) { i = blocks.length; } continue; } b.nonce++; }
          if (i >= blocks.length) { busy = null; draw(); if (done) done(); return; }
          draw(); setTimeout(step, 0);
        };
        step();
      }
      function draw(mining) {
        row.innerHTML = ''; let firstBad = -1; blocks.forEach((b, i) => { if (firstBad < 0 && !ok(i)) firstBad = i; });
        blocks.forEach((b, i) => {
          const hx = hdr(b), valid = ok(i), mr = ND.merkle.root(b.txs.split('\n').filter(x => x.trim()), { dbl: true });
          const ta = h('textarea', { class: 'inp', rows: 3, spellcheck: 'false', 'aria-label': 'Транзакции блока ' + b.n }); ta.value = b.txs;
          ta.addEventListener('input', () => { b.txs = ta.value; const pos = ta.selectionStart; draw(); const nt = row.querySelectorAll('textarea')[i]; if (nt) { nt.focus(); nt.setSelectionRange(pos, pos); } });
          row.append(h('div', { class: 'blk ' + (valid ? 'valid' : 'invalid') },
            h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', { text: 'Блок #' + b.n }), h('span', { class: 'badge ' + (valid ? 'ok' : 'bad'), text: valid ? '✔ действителен' : '✘ недействителен' })),
            h('label', { class: 'fld' }, 'Транзакции', ta), h('div', { class: 'sm mt' }, 'Корень Меркла'), h('div', { class: 'hash', text: mr.slice(0, 24) + '…' }),
            h('div', { class: 'sm mt', style: 'margin-top:6px' }, 'Хэш предыдущего (prev)'), h('div', { class: 'hash', style: b.prev !== (i ? hdr(blocks[i - 1]) : ZERO) ? 'color:var(--er)' : '' }, (b.prev === ZERO ? '0000…0000' : b.prev.slice(0, 24) + '…')),
            h('div', { class: 'row', style: 'margin-top:6px' }, h('span', { class: 'sm mt', text: 'nonce' }), h('input', { class: 'inp', type: 'number', min: 0, value: b.nonce, style: 'width:110px', onchange: e => { b.nonce = Math.max(0, parseInt(e.target.value, 10) || 0); draw(); } })),
            h('div', { class: 'sm mt', style: 'margin-top:6px' }, 'Хэш блока (нужно ' + bits + ' нулевых бит; сейчас ' + ND.leadingZeroBits(hx) + ')'), h('div', { class: 'hash', html: ui.hashHtml(hx, Math.floor(ND.leadingZeroBits(hx) / 4)).replace(/class="hash"/, 'class="hash" style="word-break:break-all"') }),
            h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn pri sm', text: '⛏ Майнить', disabled: !!busy, onclick: () => { mineFrom(i, () => { }, true); draw(); } }))), i < blocks.length - 1 ? h('div', { class: 'arrow', text: '→' }) : null);
        });
        const bad = blocks.findIndex((_, i) => !ok(i));
        msg.className = 'callout' + (bad < 0 ? '' : ' warn');
        msg.innerHTML = bad < 0 ? '<b>Цепочка целиком действительна.</b> Каждый блок содержит хэш предыдущего и доказательство работы (хэш с ' + bits + ' нулевыми битами). Измените любую транзакцию — и увидите, как рушится всё после неё.' : '<b>Цепочка нарушена начиная с блока #' + blocks[bad].n + '.</b> Чтобы «исправить» историю, нужно заново найти nonce для этого блока <i>и для каждого следующего</i> — а честная сеть за это время ушла вперёд. Это и есть неизменяемость: стоимость подделки растёт с глубиной. ' + (busy ? '<br>⛏ идёт майнинг…' : '');
        if (mining != null) { /* прогресс */ }
      }
      reset(); link(); // изначально сложность 12: промайним при открытии
      page.append(h('h2', { text: 'Цепочка блоков: неизменяемость на практике' }), h('p', { class: 'mt', style: 'max-width:780px', html: 'Заголовок блока = номер, хэш предыдущего блока, корень Меркла транзакций и <code>nonce</code>. Хэш заголовка должен начинаться с нужного числа нулевых бит. <b>Попробуйте:</b> нажмите «Майнить всё», затем измените любую транзакцию в середине цепочки.' }),
        h('div', { class: 'toolbar', style: 'border:1px solid var(--bd);border-radius:10px;margin-bottom:10px' }, h('label', { class: 'row' }, 'Сложность', sel),
          h('button', { class: 'btn pri', text: '⛏ Майнить всё', disabled: false, onclick: () => { link(); mineFrom(0, () => ui.toast('Цепочка перемайнена', 'ok')); draw(); } }),
          h('button', { class: 'btn', text: '■ Стоп', onclick: () => { if (busy) { busy.c = true; busy = null; draw(); } } }),
          h('button', { class: 'btn', text: '⟲ Начать заново', onclick: () => { if (busy) busy.c = true; busy = null; reset(); link(); draw(); } }),
          h('button', { class: 'btn', text: '+ блок', onclick: () => { if (blocks.length < 8) { blocks.push({ n: blocks.length + 1, prev: hdr(blocks[blocks.length - 1]), txs: 'Новая транзакция ' + (blocks.length + 1), nonce: 0 }); draw(); } } }),
          h('span', { class: 'sp' }), h('span', { class: 'mt sm', text: 'Среднее число попыток на блок: ' + '≈ 2^сложность' })), msg, row,
        h('div', { class: 'card', style: 'margin-top:12px' }, h('h3', { text: 'Что здесь происходит' }), h('ul', null, h('li', { html: '<b>Связь блоков.</b> prev — хэш предыдущего заголовка. Изменили блок — изменился его хэш — не совпал prev следующего.' }), h('li', { html: '<b>Работа.</b> Подобрать nonce так, чтобы хэш был «маленьким» — только перебором. Проверить — один хэш.' }), h('li', { html: '<b>Корень Меркла.</b> Заголовок не хранит транзакции, только их общий отпечаток.' }), h('li', { html: '<b>Гонка.</b> Переписывая блок #2 из 4, атакующий должен пересчитать #2, #3, #4 — а сеть тем временем добавляет новые блоки.' }))));
      // начальное майнинг при открытии
      link(); mineFrom(0, () => draw()); draw();
      return { unmount() { if (busy) busy.c = true; busy = null; } };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
