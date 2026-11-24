/* Нодония — дерево Меркла: построение, доказательство включения (SPV), обнаружение подмены. */
(function (G) {
  'use strict';
  const ND = G.ND, ui = ND.ui, h = ui.h, esc = ND.esc, NS = 'http://www.w3.org/2000/svg';
  ui.registerWorkspace({
    id: 'merkle', title: 'Дерево Меркла и SPV', group: 'Блокчейн', order: 20, short: 'Корень Меркла, доказательство включения транзакции без скачивания блока.',
    mount(root) {
      const page = h('div', { class: 'page' }); root.append(page);
      let items = ['Алиса→Боб 5', 'Боб→Карл 2', 'Карл→Дина 1', 'Дина→Алиса 3', 'Ева→Боб 7'], sel = 0, tampered = null, dbl = true;
      const ta = h('textarea', { class: 'inp', rows: 8, spellcheck: 'false' }, items.join('\n')), box = h('div', { class: 'chartbox', style: 'overflow:auto' }), info = h('div');
      ta.addEventListener('input', () => { items = ta.value.split('\n').filter(x => x.trim() !== '').slice(0, 32); if (!items.length) items = ['—']; sel = Math.min(sel, items.length - 1); tampered = null; draw(); });
      const chk = h('input', { type: 'checkbox', checked: true, onchange: () => { dbl = chk.checked; draw(); } });
      page.append(h('h2', { text: 'Дерево Меркла и доказательство включения' }), h('p', { class: 'mt', style: 'max-width:780px', html: 'Транзакции блока хэшируются попарно вверх до одного <b>корня</b>, который лежит в заголовке блока. Лёгкий клиент (SPV) хранит только заголовки: чтобы убедиться, что транзакция в блоке, ему достаточно <b>log₂ N хэшей-соседей</b> — это «доказательство Меркла».' }),
        h('div', { class: 'grid2' }, h('div', null, h('label', { class: 'fld' }, 'Листья (по строке на транзакцию, до 32)', ta), h('label', { class: 'chk' }, chk, ' двойной SHA-256, как в Bitcoin'), h('div', { class: 'row' }, h('button', { class: 'btn', text: 'Подменить выбранный лист', onclick: () => { tampered = tampered === sel ? null : sel; draw(); } }), h('button', { class: 'btn', text: '+ транзакция', onclick: () => { if (items.length < 32) { items.push('Тест→Тест ' + (items.length + 1)); ta.value = items.join('\n'); draw(); } } }))), info), box);
      function draw() {
        const o = { dbl }, real = items, shown = items.map((x, i) => i === tampered ? x + ' (ПОДМЕНА)' : x);
        const T = ND.merkle.build(shown, o), R = ND.merkle.build(real, o), P = ND.merkle.proof(real, sel, o), vr = ND.merkle.verify(shown[sel], P, R.root, o);
        const onPath = new Set(); let idx = sel; for (let l = 0; l < T.levels.length; l++) { onPath.add(l + ':' + idx); idx >>= 1; }
        const sib = new Set(P.map(p => p.level + ':' + p.idx));
        const L = T.levels, W = Math.max(520, L[0].length * 74 + 20), H = L.length * 62 + 20; let g = '';
        const pos = (l, i) => { const n = L[0].length, span = (W - 20) / Math.max(n, 1) * Math.pow(2, l); return [10 + span * (i + .5), H - 40 - l * 62]; };
        for (let l = 1; l < L.length; l++) for (let i = 0; i < L[l].length; i++) for (const c of [2 * i, 2 * i + 1]) { const ci = Math.min(c, L[l - 1].length - 1), a = pos(l, i), b = pos(l - 1, ci); const hot = onPath.has(l + ':' + i) && onPath.has((l - 1) + ':' + ci); g += '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" stroke="' + (hot ? 'var(--ac)' : 'var(--bd)') + '" stroke-width="' + (hot ? 2.5 : 1.5) + '"/>'; }
        for (let l = 0; l < L.length; l++) for (let i = 0; i < L[l].length; i++) {
          const [x, y] = pos(l, i), isRoot = l === L.length - 1, path = onPath.has(l + ':' + i), sb = sib.has(l + ':' + i), bad = l > 0 ? L[l][i] !== R.levels[l][i] : L[0][i] !== R.levels[0][i];
          const fill = bad ? 'var(--er)' : path ? 'var(--ac)' : sb ? 'var(--gold)' : 'var(--pn2)', tc = (bad || path) ? '#fff' : 'var(--tx)';
          g += '<g' + (l === 0 ? ' data-i="' + i + '" style="cursor:pointer"' : '') + '><rect x="' + (x - 31) + '" y="' + (y - 14) + '" width="62" height="28" rx="6" fill="' + fill + '" stroke="var(--bd)"/><text x="' + x + '" y="' + (y + 4) + '" text-anchor="middle" font-size="10" font-family="var(--mono)" fill="' + tc + '">' + (L[l][i].slice(0, 8)) + '</text><title>' + esc(L[l][i]) + (l === 0 ? '\n' + esc(shown[i] || '') : '') + '</title></g>';
          if (l === 0) g += '<text x="' + x + '" y="' + (y + 30) + '" text-anchor="middle" font-size="10" fill="' + (i === sel ? 'var(--ac)' : 'var(--mt)') + '" font-weight="' + (i === sel ? 800 : 400) + '">tx' + i + '</text>';
          if (isRoot) g += '<text x="' + x + '" y="' + (y - 20) + '" text-anchor="middle" font-size="11" font-weight="800" fill="var(--tx)">корень</text>';
        }
        box.innerHTML = '<svg width="' + W + '" height="' + (H + 20) + '" viewBox="0 -14 ' + W + ' ' + (H + 20) + '">' + g + '</svg>';
        box.querySelectorAll('g[data-i]').forEach(e => e.addEventListener('click', () => { sel = +e.dataset.i; draw(); }));
        info.innerHTML = '<div class="card"><h3 style="margin-top:0">Корень из заголовка блока</h3><div class="hash">' + R.root + '</div><h3>Доказательство для tx' + sel + ' (' + P.length + ' хэшей из ' + (R.levels[0].length) + ' листьев)</h3>' + ui.table(['уровень', 'сосед', 'хэш'], P.map(p => [p.level, p.side === 'L' ? 'слева' : 'справа', '<span class="hash">' + p.hash.slice(0, 16) + '…</span>'])) + '<p>Проверка: <b>' + esc(shown[sel]) + '</b> → ' + (vr.ok ? '<span class="ok"><b>✔ входит в блок</b></span>' : '<span class="bad"><b>✘ НЕ входит: пересчитанный корень ' + vr.hash.slice(0, 12) + '… ≠ корень заголовка</b></span>') + '</p><p class="mt sm">Жёлтые узлы — хэши-соседи из доказательства, синие — путь пересчёта, красные — расхождение с настоящим деревом. Клик по листу выбирает транзакцию.</p><p class="mt sm">Без дерева потребовалось бы скачать все ' + R.levels[0].length + ' транзакций; с деревом — ' + P.length + ' хэшей. Для 4000 транзакций это всего 12 хэшей (384 байта).</p></div>';
      }
      draw();
      return {};
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
