/* Нодония — диаграмма «время–узлы» (space-time diagram): жизнь кластера по журналу событий. */
(function (G) {
  'use strict';
  const ND = G.ND, ui = ND.ui, esc = ND.esc;
  ui.Timeline = function (box, getSim) {
    let win = 20000, follow = true, showTimers = false, last = '';
    const bar = ui.h('div', { class: 'dkbar' });
    const sel = ui.h('select', { class: 'inp', onchange: () => { win = +sel.value; draw(true); } }, [[5000, '5 с'], [10000, '10 с'], [20000, '20 с'], [60000, '1 мин'], [300000, '5 мин'], [1e12, 'всё время']].map(o => ui.h('option', { value: o[0], text: o[1], selected: o[0] === win })));
    const fol = ui.h('input', { type: 'checkbox', checked: true, onchange: () => { follow = fol.checked; draw(true); } });
    const tm = ui.h('input', { type: 'checkbox', onchange: () => { showTimers = tm.checked; draw(true); } });
    bar.append(ui.h('span', { class: 'mt', text: 'Окно:' }), sel, ui.h('label', null, fol, ' следить за временем'), ui.h('label', null, tm, ' таймеры'),
      ui.h('span', { class: 'mt', html: '— стрелки: сообщения; <b style="color:var(--blue)">синие</b> доставлены, <b style="color:var(--er)">красные</b> потеряны, серые в пути; ◆ — важные события; красная полоса — узел отказал' }));
    const wrap = ui.h('div', { class: 'tlwrap' });
    box.append(bar, wrap);
    function draw(force) {
      const sim = getSim(); if (!sim) return;
      const W = Math.max(600, wrap.clientWidth || 800), laneH = Math.max(34, Math.min(60, ((wrap.clientHeight || 200) - 30) / Math.max(1, sim.nodes.length))), m = { l: 70, r: 14, t: 18 }, H = m.t + laneH * sim.nodes.length + 8;
      const sig = sim.evCount + '|' + win + '|' + follow + '|' + showTimers + '|' + W + '|' + sim.nodes.length + '|' + Math.floor(sim.now / (follow ? 100 : 1e9));
      if (!force && sig === last) return; last = sig;
      let t1 = sim.now, t0 = Math.max(0, t1 - win); if (!follow) { t1 = Math.max(sim.now, 1000); t0 = 0; if (win < 1e11) { t0 = Math.max(0, t1 - win); } }
      if (win >= 1e11) { t0 = 0; t1 = Math.max(sim.now, 1000); }
      const pw = W - m.l - m.r, X = t => m.l + (t - t0) / (t1 - t0 || 1) * pw, lane = {}; sim.nodes.forEach((n, i) => lane[n.id] = m.t + laneH * i + laneH / 2);
      let g = '';
      sim.nodes.forEach(n => g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + lane[n.id] + '" y2="' + lane[n.id] + '" stroke="var(--bd)" stroke-dasharray="2 4"/><text x="' + (m.l - 8) + '" y="' + (lane[n.id] + 4) + '" text-anchor="end" font-size="12" font-weight="700" fill="var(--tx)">' + esc(n.name) + '</text>');
      const step = [100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000, 300000].find(s => (t1 - t0) / s <= 12) || 600000;
      for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) g += '<line x1="' + X(t) + '" x2="' + X(t) + '" y1="' + m.t + '" y2="' + (H - 8) + '" stroke="var(--bd)" stroke-opacity=".6"/><text x="' + X(t) + '" y="11" text-anchor="middle" font-size="10" fill="var(--mt)">' + (t / 1000) + ' с</text>';
      const log = sim.log, sends = [], fin = {}, crashes = {}, marks = [], other = [];
      for (let i = log.length - 1; i >= 0; i--) { const e = log[i]; if (e.t < t0 - 5000 && e.k !== 'send') { if (e.t < t0 - 60000) break; continue; }
        if (e.k === 'recv' || e.k === 'drop') { if (e.mid != null) fin[e.mid] = e; } }
      let cnt = 0;
      for (const e of log) {
        if (e.k === 'send' && e.arrive >= t0 && e.t <= t1) { if (cnt++ < 900) sends.push(e); }
        else if (e.k === 'mark' && e.t >= t0 && e.t <= t1) marks.push(e);
        else if (e.k === 'timer' && showTimers && e.t >= t0 && e.t <= t1) other.push(e);
        else if (e.k === 'crash') (crashes[e.n] = crashes[e.n] || []).push({ a: e.t, b: null });
        else if (e.k === 'recover' && crashes[e.n]) { const c = crashes[e.n][crashes[e.n].length - 1]; if (c && c.b == null) c.b = e.t; }
        else if ((e.k === 'cut' || e.k === 'heal') && e.t >= t0 && e.t <= t1) other.push(e);
      }
      for (const id in crashes) for (const c of crashes[id]) { const a = Math.max(c.a, t0), b = Math.min(c.b == null ? t1 : c.b, t1); if (b > a && lane[id] != null) g += '<rect x="' + X(a) + '" y="' + (lane[id] - 9) + '" width="' + Math.max(2, X(b) - X(a)) + '" height="18" fill="var(--er)" opacity=".25"><title>' + esc(id) + ' отказал</title></rect>'; }
      for (const e of other) { if (e.k === 'timer') g += '<circle cx="' + X(e.t) + '" cy="' + lane[e.n] + '" r="2" fill="var(--mt)"><title>' + esc(e.text) + '</title></circle>'; else g += '<line x1="' + X(e.t) + '" x2="' + X(e.t) + '" y1="' + m.t + '" y2="' + (H - 8) + '" stroke="' + (e.k === 'cut' ? 'var(--er)' : 'var(--ok)') + '" stroke-dasharray="5 4"><title>' + esc(e.text) + '</title></line>'; }
      for (const e of sends) {
        const f = fin[e.mid], ya = lane[e.from], yb = lane[e.to]; if (ya == null || yb == null) continue;
        let xb = X(e.arrive), col = 'var(--mt)', dash = '4 3';
        if (f && f.k === 'recv') { col = 'var(--blue)'; dash = ''; } else if (f && f.k === 'drop') { col = 'var(--er)'; dash = ''; const fr = Math.max(0.05, Math.min(1, (f.t - e.t) / ((e.arrive - e.t) || 1))); xb = X(e.t + (e.arrive - e.t) * fr); }
        else if (e.arrive <= sim.now) { col = 'var(--mt)'; }
        const yb2 = f && f.k === 'drop' ? ya + (yb - ya) * Math.min(1, Math.max(0.05, (f.t - e.t) / ((e.arrive - e.t) || 1))) : yb;
        g += '<g><title>' + esc('t=' + (e.t / 1000).toFixed(2) + ' с → ' + (e.arrive / 1000).toFixed(2) + ' с: ' + (e.text || e.type) + (f && f.k === 'drop' ? ' — ПОТЕРЯНО' : '')) + '</title><line x1="' + X(e.t) + '" y1="' + ya + '" x2="' + xb + '" y2="' + yb2 + '" stroke="' + col + '" stroke-width="1.6" ' + (dash ? 'stroke-dasharray="' + dash + '"' : '') + '/>' + (f && f.k === 'drop' ? '<path d="M' + (xb - 4) + ' ' + (yb2 - 4) + 'l8 8m0-8l-8 8" stroke="var(--er)" stroke-width="2"/>' : '<circle cx="' + xb + '" cy="' + yb2 + '" r="2.4" fill="' + col + '"/>') + '</g>';
      }
      for (const e of marks) if (lane[e.n] != null) g += '<g><title>' + esc('t=' + (e.t / 1000).toFixed(2) + ' с · ' + e.n + ': ' + e.text) + '</title><path d="M' + X(e.t) + ' ' + (lane[e.n] - 7) + 'l6 7-6 7-6-7z" fill="var(--' + ({ 'c-gold': 'gold', 'c-orange': 'orange', 'c-green': 'green', 'c-blue': 'blue', 'c-red': 'red', 'c-purple': 'purple' }[e.cls] || 'gold') + ')" stroke="var(--pn)"/></g>';
      g += '<line x1="' + X(sim.now) + '" x2="' + X(sim.now) + '" y1="' + m.t + '" y2="' + (H - 8) + '" stroke="var(--ac)" stroke-width="1.5"/>';
      wrap.innerHTML = '<svg width="' + W + '" height="' + H + '" role="img" aria-label="Диаграмма времени и сообщений">' + g + '</svg>';
      if (follow) wrap.scrollTop = 0;
    }
    return { draw, el: box };
  };
})(typeof window !== 'undefined' ? window : globalThis);
