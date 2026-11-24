/* Нодония — набор интерфейсных помощников (ND.ui): элементы, окна, уведомления, хранилище, диаграммы.
   Все рабочие области используют только его — это единый «UI-kit». */
(function (G) {
  'use strict';
  const ND = G.ND, esc = ND.esc;
  const ui = ND.ui = ND.ui || {};

  /** h('div',{class:'x',onclick:fn,html:'…',text:'…',style:'…','data-a':1},child,…) */
  ui.h = function (tag, props, ...kids) {
    const svgTags = /^(svg|g|path|circle|rect|line|text|polyline|polygon|defs|marker|title|tspan|ellipse)$/;
    const e = svgTags.test(tag) ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k]; if (v == null || v === false) continue;
      if (k === 'class') e.setAttribute('class', v); else if (k === 'html') e.innerHTML = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'value' && 'value' in e) e.value = v; else if (k === 'checked') e.checked = !!v; else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  };
  ui.$ = (s, r) => (r || document).querySelector(s);
  ui.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  ui.tip = t => '<span class="q" tabindex="0" data-tip="' + esc(t) + '">?</span>';

  /* ---- хранилище (localStorage с защитой) ---- */
  ui.store = {
    get(k, d) { try { const v = localStorage.getItem('nd.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('nd.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem('nd.' + k); } catch (e) { } },
  };

  /* ---- уведомления ---- */
  ui.toast = function (text, kind, ms) {
    let box = document.getElementById('toasts'); if (!box) return;
    const t = ui.h('div', { class: 'toast ' + (kind || ''), text }); box.append(t);
    setTimeout(() => t.remove(), ms || 3500);
  };

  /* ---- модальные окна: modal({title, body:(Element|string html), size:'wide'|'xw', buttons:[{t,pri,cb}]}) ---- */
  ui.modal = function (o) {
    const host = document.getElementById('modals');
    const body = ui.h('div', { class: 'mb' }); if (typeof o.body === 'string') body.innerHTML = o.body; else if (o.body) body.append(o.body);
    const ov = ui.h('div', { class: 'ov', onmousedown: e => { if (e.target === ov && !o.sticky) close(); } });
    const dlg = ui.h('div', { class: 'mdl ' + (o.size || ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || '' },
      ui.h('header', null, ui.h('span', { text: o.title || '' }), ui.h('button', { 'aria-label': 'Закрыть', text: '×', onclick: () => close() })), body);
    if (o.buttons) dlg.append(ui.h('footer', null, o.buttons.map(b => ui.h('button', { class: 'btn' + (b.pri ? ' pri' : ''), text: b.t, onclick: () => { if (!b.cb || b.cb(api) !== false) close(); } }))));
    ov.append(dlg); host.append(ov);
    const onKey = e => { if (e.key === 'Escape' && host.lastElementChild === ov) close(); };
    document.addEventListener('keydown', onKey);
    function close() { document.removeEventListener('keydown', onKey); ov.remove(); if (o.onclose) o.onclose(); }
    const api = { el: dlg, body, close };
    const f = dlg.querySelector('input,textarea,select,button.btn'); if (f && o.focus) f.focus();
    return api;
  };
  ui.confirm = (text, yes) => new Promise(res => ui.modal({ title: 'Подтверждение', body: '<p>' + esc(text) + '</p>', buttons: [{ t: 'Отмена', cb: () => res(false) }, { t: yes || 'Да', pri: true, cb: () => res(true) }], onclose: () => res(false) }));
  ui.prompt = (title, def, ok) => new Promise(res => {
    const i = ui.h('input', { class: 'inp', value: def || '', style: 'width:100%' }); let done = false;
    ui.modal({ title, body: i, focus: true, buttons: [{ t: 'Отмена', cb: () => { done = true; res(null); } }, { t: ok || 'OK', pri: true, cb: () => { done = true; res(i.value); } }], onclose: () => { if (!done) res(null); } });
    i.addEventListener('keydown', e => { if (e.key === 'Enter') { const b = [...document.querySelectorAll('.mdl footer .btn.pri')].pop(); b && b.click(); } }); setTimeout(() => i.select(), 30);
  });

  /* ---- файлы ---- */
  ui.download = function (name, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'text/plain;charset=utf-8' });
    const a = ui.h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  ui.pickFile = function (accept, cb) {
    const i = ui.h('input', { type: 'file', accept: accept || '', style: 'display:none' });
    i.addEventListener('change', () => { const f = i.files[0]; if (!f) return; if (f.size > 5e6) { ui.toast('Файл больше 5 МБ — отклонён', 'bad'); return; } const r = new FileReader(); r.onload = () => cb(String(r.result), f.name); r.readAsText(f); i.remove(); });
    document.body.append(i); i.click();
  };
  ui.csv = rows => rows.map(r => r.map(c => { c = String(c == null ? '' : c); return /[",;\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(';')).join('\r\n');

  /* ---- форма из описания полей [{id,label,type:'number'|'text'|'bool'|'select'|'node',def,min,max,options,hint}] ---- */
  ui.field = function (f, val, onchange, nodes) {
    const hint = f.hint ? ui.tip(f.hint) : '';
    if (f.type === 'bool') { const i = ui.h('input', { type: 'checkbox', checked: !!val, onchange: () => onchange(i.checked) }); const l = ui.h('label', { class: 'chk' }, i, ui.h('span', { html: esc(f.label) + hint })); return l; }
    let i;
    if (f.type === 'select' || f.type === 'node') {
      const opts = f.type === 'node' ? (nodes || []).map(n => ({ v: n.id, t: n.name })) : f.options.map(o => typeof o === 'object' ? o : { v: o, t: String(o) });
      i = ui.h('select', { class: 'inp' }, opts.map(o => ui.h('option', { value: o.v, text: o.t, selected: String(o.v) === String(val) })));
      i.addEventListener('change', () => { const o = opts.find(x => String(x.v) === i.value); onchange(o ? o.v : i.value); });
    } else if (f.type === 'number') {
      i = ui.h('input', { class: 'inp', type: 'number', value: val, min: f.min, max: f.max, step: f.step || 'any' });
      i.addEventListener('change', () => { let v = parseFloat(i.value); if (!isFinite(v)) v = f.def; if (f.min != null) v = Math.max(f.min, v); if (f.max != null) v = Math.min(f.max, v); i.value = v; onchange(v); });
    } else { i = ui.h('input', { class: 'inp', type: 'text', value: val == null ? '' : val, maxlength: f.max || 60 }); i.addEventListener('change', () => onchange(i.value)); }
    return ui.h('label', { class: 'fld' }, ui.h('span', { html: esc(f.label) + hint }), i);
  };

  /* ---- таблица из массивов ---- */
  ui.table = (head, rows, cls) => '<table class="tbl ' + (cls || '') + '"><tr>' + head.map(h => '<th>' + h + '</th>').join('') + '</tr>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</table>';

  /* ---- иконки узлов (24×24, штрихи) ---- */
  const ICONS = {
    node: '<rect x="4" y="5" width="16" height="6" rx="1.5"/><rect x="4" y="13" width="16" height="6" rx="1.5"/><path d="M7.5 8h.01M7.5 16h.01"/>',
    server: '<rect x="4" y="5" width="16" height="6" rx="1.5"/><rect x="4" y="13" width="16" height="6" rx="1.5"/><path d="M7.5 8h.01M7.5 16h.01"/>',
    client: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M9 20h6M12 16v4"/>',
    db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
    lb: '<circle cx="12" cy="6" r="2.5"/><circle cx="5.5" cy="18" r="2.5"/><circle cx="12" cy="18" r="2.5"/><circle cx="18.5" cy="18" r="2.5"/><path d="M12 8.5v7M11 8l-5 8M13 8l5 8"/>',
    cache: '<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>',
    queue: '<rect x="3" y="8" width="5" height="8" rx="1"/><rect x="9.5" y="8" width="5" height="8" rx="1"/><rect x="16" y="8" width="5" height="8" rx="1"/>',
    miner: '<path d="m14 4 6 6M5 20l9-9M10 5l3-1 7 7-1 3"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14.5h2"/>',
    validator: '<path d="M12 3 5 6v6c0 4.4 3 7.3 7 9 4-1.7 7-4.6 7-9V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9.5 4 4 0 0 1 17 18z"/>',
    service: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-4 3.5-6 7-6s6.2 2 7 6"/>',
    cdn: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 3.5 3 13.5 0 17M12 3.5c-3 3.5-3 13.5 0 17"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  };
  ui.ICONS = ICONS;
  ui.icon = (kind, size, cls) => '<svg viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) + '" class="' + (cls || 'ico') + '">' + (ICONS[kind] || ICONS.node) + '</svg>';

  /* ---- простая SVG-диаграмма: lineChart({el, series:[{name,color,pts:[[x,y]],dash}], w,h, xl,yl, xmin,xmax,ymin,ymax, bars}) ---- */
  ui.chart = function (o) {
    const W = o.w || 560, H = o.h || 260, m = { l: 48, r: 14, t: 12, b: 36 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    let xs = [], ys = []; o.series.forEach(s => s.pts.forEach(p => { xs.push(p[0]); ys.push(p[1]); }));
    const x0 = o.xmin != null ? o.xmin : Math.min(...xs, 0), x1 = o.xmax != null ? o.xmax : Math.max(...xs, 1), y0 = o.ymin != null ? o.ymin : Math.min(0, ...ys), y1 = o.ymax != null ? o.ymax : Math.max(...ys, 1e-9) * 1.05;
    const X = v => m.l + (x1 === x0 ? 0 : (v - x0) / (x1 - x0)) * pw, Y = v => m.t + ph - (y1 === y0 ? 0 : (v - y0) / (y1 - y0)) * ph;
    const nice = (a, b, n) => { const st = (b - a) / n, p = Math.pow(10, Math.floor(Math.log10(st || 1))), r = st / p, s = (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * p; const out = []; for (let v = Math.ceil(a / s) * s; v <= b + 1e-9; v += s) out.push(+v.toPrecision(10)); return out; };
    let g = '';
    for (const v of nice(y0, y1, 5)) g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="var(--bd)"/><text x="' + (m.l - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end" font-size="11" fill="var(--mt)">' + (o.yf ? o.yf(v) : v) + '</text>';
    for (const v of nice(x0, x1, 6)) g += '<line x1="' + X(v) + '" x2="' + X(v) + '" y1="' + m.t + '" y2="' + (m.t + ph) + '" stroke="var(--bd)" stroke-opacity=".5"/><text x="' + X(v) + '" y="' + (H - m.b + 15) + '" text-anchor="middle" font-size="11" fill="var(--mt)">' + (o.xf ? o.xf(v) : v) + '</text>';
    o.series.forEach((s, i) => {
      const col = s.color || ['var(--ac)', 'var(--ac2)', 'var(--gold)', 'var(--red)', 'var(--purple)'][i % 5];
      if (o.bars) { const bw = Math.max(2, pw / (s.pts.length + 1) * .7); s.pts.forEach(p => { g += '<rect x="' + (X(p[0]) - bw / 2) + '" y="' + Y(p[1]) + '" width="' + bw + '" height="' + Math.max(0, Y(y0) - Y(p[1])) + '" fill="' + col + '" opacity=".85"><title>' + esc(p[0] + ': ' + p[1]) + '</title></rect>'; }); }
      else { g += '<polyline fill="none" stroke="' + col + '" stroke-width="2.2" ' + (s.dash ? 'stroke-dasharray="6 4"' : '') + ' points="' + s.pts.map(p => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ') + '"/>'; if (s.dots) s.pts.forEach(p => g += '<circle cx="' + X(p[0]) + '" cy="' + Y(p[1]) + '" r="3" fill="' + col + '"><title>' + esc(p[0] + ': ' + p[1]) + '</title></circle>'); }
    });
    const lg = o.series.filter(s => s.name).map((s, i) => '<g transform="translate(' + (m.l + 8 + i * 130) + ',' + (m.t + 8) + ')"><rect width="14" height="4" y="4" fill="' + (s.color || ['var(--ac)', 'var(--ac2)', 'var(--gold)', 'var(--red)', 'var(--purple)'][o.series.indexOf(s) % 5]) + '"/><text x="19" y="10" font-size="11" fill="var(--tx)">' + esc(s.name) + '</text></g>').join('');
    const ax = (o.xl ? '<text x="' + (m.l + pw / 2) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="11" fill="var(--mt)">' + esc(o.xl) + '</text>' : '') + (o.yl ? '<text transform="translate(12,' + (m.t + ph / 2) + ') rotate(-90)" text-anchor="middle" font-size="11" fill="var(--mt)">' + esc(o.yl) + '</text>' : '');
    const svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px" role="img" aria-label="' + esc(o.title || 'график') + '">' + g + lg + ax + '</svg>';
    if (o.el) o.el.innerHTML = svg; return svg;
  };

  /* ---- форматирование ---- */
  ui.pct = v => (Math.round(v * 1000) / 10) + '%';
  ui.hashHtml = (hex, zeros) => { hex = String(hex); const z = zeros || 0; return '<span class="hash"><span class="z">' + esc(hex.slice(0, z)) + '</span>' + esc(hex.slice(z)) + '</span>'; };
})(typeof window !== 'undefined' ? window : globalThis);
