/* Нодония — схема: создание, очистка при импорте, раскладки. Импорт всегда проходит через cleanScheme. */
(function (G) {
  'use strict';
  const ND = G.ND;
  const MAX_NODES = 64, MAX_LINKS = 600, MAX_HIST = 3000;

  const safeId = (s, d) => { s = String(s == null ? '' : s).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12); return s || d; };
  const safeStr = (s, n, d) => { s = typeof s === 'string' ? s : (typeof s === 'number' ? String(s) : ''); s = s.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n); return s || d || ''; };

  function cleanCfg(c, decl) {
    const out = {}; if (!c || typeof c !== 'object' || Array.isArray(c)) return out;
    const keys = Object.keys(c).slice(0, 40);
    for (const k of keys) {
      if (!/^[A-Za-z0-9_]{1,24}$/.test(k) || k === '__proto__') continue;
      const v = c[k], d = decl && decl.find(x => x.id === k);
      if (typeof v === 'boolean') out[k] = v;
      else if (typeof v === 'number' && isFinite(v)) out[k] = d && d.min != null ? ND.clamp(v, d.min, d.max) : ND.clamp(v, -1e9, 1e9);
      else if (typeof v === 'string') out[k] = v.slice(0, 60);
    }
    return out;
  }

  /** Привести произвольный объект к допустимой схеме. Никогда не бросает исключений. */
  ND.cleanScheme = function (o) {
    const d = ND.reg.protocols;
    if (!o || typeof o !== 'object' || Array.isArray(o)) o = {};
    let proto = typeof o.proto === 'string' && d[o.proto] ? o.proto : (d.gossip ? 'gossip' : Object.keys(d)[0]);
    const pd = d[proto] || {};
    const s = { app: 'nodonia', v: 1, proto, title: safeStr(o.title, 80, ''), notes: safeStr(o.notes, 600, ''), seed: Math.floor(ND.num(o.seed, 1, 1, 2147483647)), params: {}, nodes: [], links: [] };
    for (const p of pd.params || []) { const v = o.params && typeof o.params === 'object' ? o.params[p.id] : undefined; s.params[p.id] = p.type === 'bool' ? (typeof v === 'boolean' ? v : p.def) : (p.type === 'select' ? (p.options.some(x => (x.v != null ? x.v : x) === v) ? v : p.def) : ND.num(v, p.def, p.min != null ? p.min : -1e9, p.max != null ? p.max : 1e9)); }
    const seen = {}; const nodes = Array.isArray(o.nodes) ? o.nodes.slice(0, MAX_NODES) : [];
    const kinds = (pd.nodeKinds || []).map(k => k.id);
    nodes.forEach((n, i) => {
      if (!n || typeof n !== 'object') return;
      let id = safeId(n.id, 'n' + (i + 1)); while (seen[id]) id += 'x'; seen[id] = 1;
      const decl = typeof pd.nodeCfg === 'function' ? pd.nodeCfg({ kind: n.kind }) : pd.nodeCfg;
      s.nodes.push({ id, name: safeStr(n.name, 24, id.toUpperCase()), x: Math.round(ND.num(n.x, 100 + i * 60, -3000, 3000)), y: Math.round(ND.num(n.y, 100, -3000, 3000)), kind: kinds.includes(n.kind) ? n.kind : (kinds[0] || 'node'), cfg: cleanCfg(n.cfg, decl) });
    });
    const pairs = {}; const links = Array.isArray(o.links) ? o.links.slice(0, MAX_LINKS * 2) : [];
    for (const l of links) {
      if (s.links.length >= MAX_LINKS) break; if (!l || typeof l !== 'object') continue;
      const a = safeId(l.a, ''), b = safeId(l.b, ''); if (!seen[a] || !seen[b] || a === b) continue;
      const key = a < b ? a + '|' + b : b + '|' + a; if (pairs[key]) continue; pairs[key] = 1;
      s.links.push({ id: 'l' + (s.links.length + 1), a, b, lat: Math.round(ND.num(l.lat, 150, 1, 60000)), jit: Math.round(ND.num(l.jit, 0, 0, 60000)), loss: ND.num(l.loss, 0, 0, 1), dup: ND.num(l.dup, 0, 0, 1), up: l.up !== false });
    }
    if (Array.isArray(o.hist)) {
      s.hist = [];
      for (const h of o.hist.slice(0, MAX_HIST)) {
        if (!h || typeof h !== 'object' || typeof h.kind !== 'string' || !/^[a-z]{2,12}$/.test(h.kind)) continue;
        let args = {}; try { args = JSON.parse(JSON.stringify(h.args || {})); } catch (e) { continue; }
        if (JSON.stringify(args).length > 4000) continue;
        s.hist.push({ ev: Math.floor(ND.num(h.ev, 0, 0, 1e9)), t: ND.num(h.t, 0, 0, 1e12), kind: h.kind, args });
      }
    }
    return s;
  };

  /* ---- раскладки и готовые топологии ---- */
  ND.layout = {
    circle(n, cx, cy, r, a0) { a0 = a0 == null ? -Math.PI / 2 : a0; return Array.from({ length: n }, (_, i) => [Math.round(cx + r * Math.cos(a0 + 2 * Math.PI * i / n)), Math.round(cy + r * Math.sin(a0 + 2 * Math.PI * i / n))]); },
    grid(n, cols, x0, y0, dx, dy) { return Array.from({ length: n }, (_, i) => [x0 + (i % cols) * dx, y0 + Math.floor(i / cols) * dy]); },
  };
  /** opts: {proto, n, topo:'full'|'ring'|'star'|'line'|'none'|'mesh', lat, jit, loss, names, cfg, kind, seed, params, title} */
  ND.makeScheme = function (o) {
    const n = o.n || 5, pos = o.pos || ND.layout.circle(n, 380, 250, Math.min(210, 60 + n * 22));
    const nodes = Array.from({ length: n }, (_, i) => ({ id: 'n' + (i + 1), name: o.names ? o.names[i] : 'N' + (i + 1), x: pos[i][0], y: pos[i][1], kind: o.kinds ? o.kinds[i] : (o.kind || undefined), cfg: Object.assign({}, o.cfg, o.cfgs ? o.cfgs[i] : null) }));
    const links = []; const add = (i, j) => links.push({ a: nodes[i].id, b: nodes[j].id, lat: o.lat || 150, jit: o.jit || 0, loss: o.loss || 0 });
    const t = o.topo || 'full';
    if (t === 'full') for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) add(i, j);
    else if (t === 'ring') for (let i = 0; i < n; i++) add(i, (i + 1) % n);
    else if (t === 'star') for (let i = 1; i < n; i++) add(0, i);
    else if (t === 'line') for (let i = 0; i + 1 < n; i++) add(i, i + 1);
    else if (t === 'mesh') { for (let i = 0; i < n; i++) add(i, (i + 1) % n); for (let i = 0; i < n; i++) if (n > 4) add(i, (i + 2) % n); }
    else if (Array.isArray(t)) t.forEach(p => add(p[0], p[1]));
    return ND.cleanScheme({ proto: o.proto, title: o.title, notes: o.notes, seed: o.seed || 1, params: o.params, nodes, links: ND.dedupe(links), hist: undefined });
  };
  ND.dedupe = ls => { const s = {}; return ls.filter(l => { const k = l.a < l.b ? l.a + l.b : l.b + l.a; if (s[k]) return false; s[k] = 1; return true; }); };
  ND.newSim = scheme => new ND.Sim(ND.cleanScheme(scheme));
})(typeof window !== 'undefined' ? window : globalThis);
