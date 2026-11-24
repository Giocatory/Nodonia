/* Нодония — дерево Меркла. Нечётное число узлов на уровне: последний хэш дублируется (правило Bitcoin). */
(function (G) {
  'use strict';
  const ND = G.ND;
  const M = ND.merkle = {
    /** хэш: dbl=true — двойной SHA-256 (как в Bitcoin), иначе одинарный */
    h(bytes, dbl) { const a = ND.sha256b(bytes); return ND.hex(dbl ? ND.sha256b(a) : a); },
    leaf(item, o) { return M.h(ND.utf8(String(item)), o && o.dbl); },
    pair(l, r, o) { const a = ND.unhex(l), b = ND.unhex(r), c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return M.h(c, o && o.dbl); },
    /** items — строки (данные листьев). Возвращает {levels:[[хэши листьев],…,[корень]], root, odd:[индексы уровней, где дублировали]} */
    build(items, o) {
      o = o || {}; if (!items.length) return { levels: [[M.h(new Uint8Array(0), o.dbl)]], root: M.h(new Uint8Array(0), o.dbl), odd: [] };
      let lv = items.map(x => M.leaf(x, o)); const levels = [lv], odd = [];
      while (lv.length > 1) { if (lv.length % 2) { odd.push(levels.length - 1); lv = lv.concat([lv[lv.length - 1]]); } const nx = []; for (let i = 0; i < lv.length; i += 2) nx.push(M.pair(lv[i], lv[i + 1], o)); levels.push(nx); lv = nx; }
      return { levels, root: lv[0], odd };
    },
    root(items, o) { return M.build(items, o).root; },
    /** доказательство включения листа index: массив {hash, side:'L'|'R'} (сторона, где лежит сосед) */
    proof(items, index, o) {
      const t = M.build(items, o), pr = []; let i = index; if (index < 0 || index >= items.length) throw new Error('нет такого листа');
      for (let l = 0; l < t.levels.length - 1; l++) { let lv = t.levels[l]; if (lv.length % 2) lv = lv.concat([lv[lv.length - 1]]); const sib = i ^ 1; pr.push({ hash: lv[sib], side: sib < i ? 'L' : 'R', level: l, idx: sib }); i >>= 1; }
      return pr;
    },
    /** проверка: лист (данные), доказательство, корень → true/false; trace — подробный ход */
    verify(item, proof, root, o) {
      let h = M.leaf(item, o); const trace = [{ step: 'лист', hash: h }];
      for (const p of proof) { h = p.side === 'L' ? M.pair(p.hash, h, o) : M.pair(h, p.hash, o); trace.push({ step: 'с соседом ' + (p.side === 'L' ? 'слева' : 'справа'), hash: h }); }
      return { ok: h === root, hash: h, trace };
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
