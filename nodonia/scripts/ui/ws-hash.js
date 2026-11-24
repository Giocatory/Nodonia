/* Нодония — лаборатория SHA-256: лавинный эффект, поиск nonce (proof-of-work), парадокс дней рождения. */
(function (G) {
  'use strict';
  const ND = G.ND, ui = ND.ui, h = ui.h, esc = ND.esc;
  const toBits = hex => { let s = ''; for (const c of hex) s += ND.pad(parseInt(c, 16).toString(2), 4); return s; };
  function flipBit(str, i) { const b = ND.utf8(str).slice(); const k = i % (b.length * 8); b[k >> 3] ^= 1 << (7 - (k & 7)); let s = ''; try { s = new TextDecoder('utf-8', { fatal: false }).decode(b); } catch (e) { s = str; } return { s, bytes: b }; }
  function grid(a, b) {
    let cells = '', diff = 0; for (let i = 0; i < 256; i++) { const d = a[i] !== b[i]; if (d) diff++; cells += '<i class="' + (d ? 'd' : '') + '" title="бит ' + i + ': ' + a[i] + ' → ' + b[i] + '"></i>'; }
    return { html: '<div class="wsh-grid">' + cells + '</div>', diff };
  }
  ui.registerWorkspace({
    id: 'hash', title: 'Хэш-функции SHA-256', group: 'Блокчейн', order: 10, short: 'Лавинный эффект, необратимость, поиск nonce и парадокс дней рождения.',
    mount(root) {
      let stop = null;
      const style = h('style', { html: '.wsh-grid{display:grid;grid-template-columns:repeat(32,1fr);gap:2px;max-width:560px;margin:8px 0}.wsh-grid i{aspect-ratio:1;background:var(--pn2);border:1px solid var(--bd);border-radius:2px}.wsh-grid i.d{background:var(--er);border-color:var(--er)}.wsh-hex{font:13px var(--mono);word-break:break-all;background:var(--pn2);border:1px solid var(--bd);border-radius:8px;padding:8px 10px}.wsh-hex .z{color:var(--ok);font-weight:800}.wsh-hex .dd{background:color-mix(in srgb,var(--er) 30%,transparent)}' });
      const page = h('div', { class: 'page' }); root.append(style, page);
      page.append(h('h2', { text: 'Хэш-функции: SHA-256 «в лупу»' }), h('p', { class: 'mt', style: 'max-width:780px', html: 'Хэш превращает данные любой длины в «отпечаток» из 256 бит. Он <b>детерминирован</b> (одни данные — один хэш), <b>лавинный</b> (бит на входе меняет половину бит на выходе) и <b>односторонний</b> (по хэшу данные не восстановить — только перебор). На этом держатся блокчейн, подписи и деревья Меркла.' }));

      /* --- 1. лавинный эффект --- */
      const inA = h('textarea', { class: 'inp', rows: 2 }, 'Нодония'), inB = h('textarea', { class: 'inp', rows: 2 }, 'нодония');
      const hexA = h('div', { class: 'wsh-hex' }), hexB = h('div', { class: 'wsh-hex' }), gridBox = h('div'), stat = h('div', { class: 'callout' });
      const lenInfo = h('div', { class: 'mt sm' });
      function upd() {
        const a = ND.sha256(inA.value), b = ND.sha256(inB.value), ba = toBits(a), bb = toBits(b), g = grid(ba, bb);
        let ha = '', hb = ''; for (let i = 0; i < 64; i++) { ha += '<span class="' + (a[i] !== b[i] ? 'dd' : '') + '">' + a[i] + '</span>'; hb += '<span class="' + (a[i] !== b[i] ? 'dd' : '') + '">' + b[i] + '</span>'; }
        hexA.innerHTML = ha; hexB.innerHTML = hb; gridBox.innerHTML = g.html;
        stat.innerHTML = 'Отличается <b>' + g.diff + ' из 256 бит</b> (' + Math.round(g.diff / 2.56) + '%). Для хорошей хэш-функции ожидаемо ≈ 128 (50%) — даже если входы отличаются одним символом или одним битом.';
        lenInfo.textContent = 'Вход A: ' + ND.utf8(inA.value).length + ' байт, вход B: ' + ND.utf8(inB.value).length + ' байт → хэш всегда 32 байта (64 hex-символа).';
      }
      inA.addEventListener('input', upd); inB.addEventListener('input', upd);
      page.append(h('div', { class: 'card' }, h('h3', { text: '1. Лавинный эффект' }),
        h('div', { class: 'grid2' }, h('label', { class: 'fld' }, 'Данные A', inA), h('label', { class: 'fld' }, 'Данные B', inB)),
        h('div', { class: 'row' }, h('button', { class: 'btn', text: 'B = A с одним изменённым битом', onclick: () => { inB.value = flipBit(inA.value, Math.floor(Math.random() * 8 * Math.max(1, ND.utf8(inA.value).length))).s; upd(); } }), h('button', { class: 'btn', text: 'B = A + «.»', onclick: () => { inB.value = inA.value + '.'; upd(); } }), h('button', { class: 'btn', text: 'B = A', onclick: () => { inB.value = inA.value; upd(); } })),
        lenInfo, h('h4', { text: 'SHA-256(A)' }), hexA, h('h4', { text: 'SHA-256(B)' }), hexB, h('h4', { html: 'Различающиеся биты (красные) ' + ui.tip('каждая клетка — один из 256 бит хэша') }), gridBox, stat));

      /* --- 2. поиск nonce --- */
      const pData = h('input', { class: 'inp', value: 'Блок #1: Алиса → Боб 5' }), pBits = h('select', { class: 'inp' }, [8, 12, 16, 18, 20, 22, 24].map(b => h('option', { value: b, text: b + ' бит (≈ ' + (2 ** b).toLocaleString('ru') + ' попыток)', selected: b === 16 })));
      const pOut = h('div', { class: 'wsh-hex', style: 'min-height:46px' }), pStat = h('div', { class: 'mt sm' }), pBar = h('div', { class: 'prog' }, h('i', { style: 'width:0' }));
      const pGo = h('button', { class: 'btn pri', text: '⛏ Искать nonce', onclick: () => { if (stop) return stopMine(); startMine(); } });
      function stopMine() { if (stop) { stop.cancel = true; stop = null; } pGo.textContent = '⛏ Искать nonce'; }
      function startMine() {
        const bits = +pBits.value, data = pData.value, ctl = { cancel: false }; stop = ctl; pGo.textContent = '■ Стоп'; let nonce = 0; const t0 = performance.now(), expect = 2 ** bits;
        const tick = () => {
          if (ctl.cancel) return; const end = performance.now() + 25;
          while (performance.now() < end) { const hx = ND.sha256(data + '|' + nonce); if (ND.leadingZeroBits(hx) >= bits) { pOut.innerHTML = 'nonce = <b>' + nonce + '</b><br>' + ui.hashHtml(hx, Math.floor(bits / 4)) + '<br><span class="mt">хэш начинается с ' + ND.leadingZeroBits(hx) + ' нулевых бит</span>'; const dt = (performance.now() - t0) / 1000; pStat.textContent = 'Найдено за ' + (nonce + 1).toLocaleString('ru') + ' попыток, ' + dt.toFixed(2) + ' с (' + Math.round((nonce + 1) / Math.max(dt, 1e-3)).toLocaleString('ru') + ' хэш/с). Ожидалось ≈ ' + expect.toLocaleString('ru') + '. Проверка — один хэш; поиск — тысячи: это и есть «работа».'; pBar.firstChild.style.width = '100%'; stopMine(); return; } nonce++; }
          const dt = (performance.now() - t0) / 1000; pStat.textContent = 'Перебрано ' + nonce.toLocaleString('ru') + ' (' + Math.round(nonce / Math.max(dt, 1e-3)).toLocaleString('ru') + ' хэш/с)…'; pBar.firstChild.style.width = Math.min(99, 100 * (1 - Math.exp(-nonce / expect))) + '%'; pOut.textContent = 'ищем…'; setTimeout(tick, 0);
        };
        tick();
      }
      page.append(h('div', { class: 'card', style: 'margin-top:14px' }, h('h3', { text: '2. Proof-of-work: поиск nonce' }), h('p', { class: 'mt sm', html: 'Нужно подобрать число <code>nonce</code>, чтобы SHA-256(данные|nonce) начинался с заданного числа нулевых <b>бит</b>. Каждый дополнительный бит удваивает среднее число попыток — так сеть регулирует сложность.' }),
        h('div', { class: 'row' }, h('label', { class: 'fld row', style: 'flex:2' }, 'Данные', pData), h('label', { class: 'fld row', style: 'flex:1' }, 'Сложность', pBits), pGo), pBar, pOut, pStat));

      /* --- 3. день рождения --- */
      const bBits = h('select', { class: 'inp' }, [16, 20, 24, 28, 32].map(b => h('option', { value: b, text: b + ' бит', selected: b === 24 }))), bOut = h('div', { class: 'callout' }, 'Нажмите «Искать коллизию».');
      let bStop = null;
      const bGo = h('button', { class: 'btn pri', text: 'Искать коллизию', onclick: () => {
        if (bStop) { bStop.c = true; bStop = null; bGo.textContent = 'Искать коллизию'; return; }
        const bits = +bBits.value, mask = bits === 32 ? 0xffffffff : (2 ** bits) - 1, seen = new Map(), ctl = { c: false }; bStop = ctl; bGo.textContent = '■ Стоп'; let i = 0; const t0 = performance.now();
        const tick = () => { if (ctl.c) return; const end = performance.now() + 25; while (performance.now() < end) { const s = 'сообщение-' + i, v = ND.hash32(s) >>> 0, k = bits === 32 ? v : v >>> (32 - bits); if (seen.has(k)) { const o = seen.get(k); bOut.innerHTML = 'Коллизия за <b>' + (i + 1).toLocaleString('ru') + '</b> попыток: <code>' + esc(o) + '</code> и <code>' + esc(s) + '</code> дают одинаковые первые ' + bits + ' бит хэша (<code>' + ND.pad(k.toString(16), Math.ceil(bits / 4)) + '</code>).<br>Теория: ≈ √(π/2 · 2<sup>' + bits + '</sup>) ≈ ' + Math.round(Math.sqrt(Math.PI / 2 * 2 ** bits)).toLocaleString('ru') + ' — не 2<sup>' + bits + '</sup>! Для полного SHA-256 это ≈ 2<sup>128</sup> — недостижимо; но 32-битная «контрольная сумма» ломается мгновенно.'; bStop = null; bGo.textContent = 'Искать коллизию'; return; } seen.set(k, s); i++; }
          bOut.textContent = 'Перебрано ' + i.toLocaleString('ru') + ' сообщений…'; setTimeout(tick, 0); };
        tick(); } });
      page.append(h('div', { class: 'card', style: 'margin-top:14px' }, h('h3', { text: '3. Парадокс дней рождения: коллизии' }), h('p', { class: 'mt sm', html: 'Найти <i>любые два</i> входа с одинаковым (укороченным) хэшем намного проще, чем подобрать вход под <i>заданный</i> хэш. Поэтому для безопасности от коллизий нужен хэш вдвое длиннее.' }), h('div', { class: 'row' }, h('label', { class: 'fld row' }, 'Длина хэша', bBits), bGo), bOut));
      upd();
      return { unmount() { stopMine(); if (bStop) bStop.c = true; } };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
