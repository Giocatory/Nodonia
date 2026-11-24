/* Нодония — ядро: общие утилиты, ГПСЧ, куча, реестры. Только ванильный JS, без зависимостей. */
(function (G) {
  'use strict';
  const ND = G.ND = G.ND || {};
  ND.version = '1.0.0';
  ND.reg = { protocols: {}, workspaces: [], labs: [], tasks: [], templates: [], quiz: [], glossary: [], exams: [], help: [], manual: [] };
  ND.registerProtocol = p => (ND.reg.protocols[p.id] = p);

  ND.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  ND.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  ND.num = (v, d, a, b) => { v = typeof v === 'string' ? parseFloat(v) : v; if (typeof v !== 'number' || !isFinite(v)) return d; return a == null ? v : ND.clamp(v, a, b); };
  ND.clone = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
  ND.fmtT = ms => ms < 1000 ? (Math.round(ms * 10) / 10) + ' мс' : (Math.round(ms / 10) / 100) + ' с';
  ND.pad = (s, n, c) => String(s).padStart(n, c || '0');
  ND.short = (h, n) => { h = String(h); n = n || 8; return h.length > n * 2 + 1 ? h.slice(0, n) + '…' + h.slice(-4) : h; };

  /* ---- ГПСЧ mulberry32: полностью детерминирован, состояние — одно число ---- */
  class RNG {
    constructor(seed) { this.s = (seed >>> 0) || 1; }
    float() { let t = (this.s += 0x6D2B79F5) >>> 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    int(a, b) { return a + Math.floor(this.float() * (b - a + 1)); }       // включительно
    chance(p) { return p > 0 && this.float() < p; }
    pick(arr) { return arr[Math.floor(this.float() * arr.length)]; }
    exp(mean) { return -Math.log(1 - this.float()) * mean; }              // экспоненциальное распределение
    normal(m, sd) { const u = 1 - this.float(), v = this.float(); return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
    shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.float() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  }
  ND.RNG = RNG;

  /* ---- двоичная куча ---- */
  class Heap {
    constructor(cmp) { this.a = []; this.cmp = cmp; }
    get size() { return this.a.length; }
    peek() { return this.a[0]; }
    push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.cmp(a[i], a[p]) < 0) { [a[i], a[p]] = [a[p], a[i]]; i = p; } else break; } }
    pop() { const a = this.a; if (!a.length) return undefined; const top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && this.cmp(a[l], a[m]) < 0) m = l; if (r < a.length && this.cmp(a[r], a[m]) < 0) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top; }
    toArray() { return this.a.slice().sort(this.cmp); }
  }
  ND.Heap = Heap;

  /* ---- SHA-256 (синхронный, учебный: нужен и в симуляции, и в хэш-лаборатории) ---- */
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  ND.utf8 = s => { if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s); const o = []; s = unescape(encodeURIComponent(s)); for (let i = 0; i < s.length; i++) o.push(s.charCodeAt(i)); return Uint8Array.from(o); };
  ND.hex = b => { let s = ''; for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; };
  ND.unhex = h => { const o = new Uint8Array(h.length >> 1); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; };
  ND.sha256b = function (data) {
    if (typeof data === 'string') data = ND.utf8(data);
    const l = data.length, nb = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(nb);
    m.set(data); m[l] = 0x80;
    const dv = new DataView(m.buffer); dv.setUint32(nb - 8, Math.floor(l / 0x20000000)); dv.setUint32(nb - 4, (l << 3) >>> 0);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), w = new Uint32Array(64);
    for (let o = 0; o < nb; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = (w[i - 16] + (((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)) + w[i - 7] + (((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10))) >>> 0; }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new Uint8Array(32), ov = new DataView(out.buffer); for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
    return out;
  };
  ND.sha256 = s => ND.hex(ND.sha256b(s));
  ND.sha256d = s => ND.hex(ND.sha256b(ND.sha256b(s)));           // двойной SHA-256, как в Bitcoin
  ND.hash32 = s => { const b = ND.sha256b(s); return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0; }; // 32-битная позиция для хэш-кольца
  ND.leadingZeroBits = hex => { let n = 0; for (let i = 0; i < hex.length; i++) { const v = parseInt(hex[i], 16); if (v === 0) { n += 4; continue; } n += Math.clz32(v) - 28; break; } return n; };
})(typeof window !== 'undefined' ? window : globalThis);
