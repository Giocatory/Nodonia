/* Нодония — ECDSA на кривой secp256k1 (BigInt). УЧЕБНАЯ реализация: не защищена от атак по времени,
   не предназначена для защиты реальных средств. Подпись детерминированная (RFC 6979), low-S. */
(function (G) {
  'use strict';
  const ND = G.ND;
  const P = 2n ** 256n - 2n ** 32n - 977n;
  const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
  const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
  const mod = (a, m) => { const r = a % (m || P); return r >= 0n ? r : r + (m || P); };
  function pow(b, e, m) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
  function inv(a, m) { m = m || P; let [r0, r1] = [mod(a, m), m], [s0, s1] = [1n, 0n]; while (r1 !== 0n) { const q = r0 / r1;[r0, r1] = [r1, r0 - q * r1];[s0, s1] = [s1, s0 - q * s1]; } if (r0 !== 1n) throw new Error('нет обратного элемента'); return mod(s0, m); }
  // Якобиевы координаты: [X,Y,Z], бесконечность — Z=0
  const INF = [0n, 1n, 0n];
  function dbl(p) { const [X, Y, Z] = p; if (Z === 0n || Y === 0n) return INF; const S = 4n * X * Y * Y % P, M = 3n * X * X % P, X2 = mod(M * M - 2n * S), Y2 = mod(M * (S - X2) - 8n * Y * Y * Y * Y), Z2 = 2n * Y * Z % P; return [X2, Y2, Z2]; }
  function add(p, q) {
    if (p[2] === 0n) return q; if (q[2] === 0n) return p;
    const [X1, Y1, Z1] = p, [X2, Y2, Z2] = q, Z1s = Z1 * Z1 % P, Z2s = Z2 * Z2 % P, U1 = X1 * Z2s % P, U2 = X2 * Z1s % P, S1 = Y1 * Z2s * Z2 % P, S2 = Y2 * Z1s * Z1 % P;
    if (U1 === U2) return S1 === S2 ? dbl(p) : INF;
    const H = mod(U2 - U1), R = mod(S2 - S1), H2 = H * H % P, H3 = H * H2 % P, V = U1 * H2 % P, X3 = mod(R * R - H3 - 2n * V), Y3 = mod(R * (V - X3) - S1 * H3), Z3 = H * Z1 * Z2 % P;
    return [X3, Y3, Z3];
  }
  function mul(k, pt) { let r = INF, q = pt; k = mod(k, N); while (k > 0n) { if (k & 1n) r = add(r, q); q = dbl(q); k >>= 1n; } return r; }
  function aff(p) { if (p[2] === 0n) return null; const zi = inv(p[2]), z2 = zi * zi % P; return [p[0] * z2 % P, p[1] * z2 * zi % P]; }
  const Gj = [GX, GY, 1n];
  const hex32 = n => n.toString(16).padStart(64, '0');
  const big = h => BigInt('0x' + (h || '0'));
  const onCurve = (x, y) => mod(y * y - x * x * x - 7n) === 0n;

  /* HMAC-SHA256 */
  function hmac(key, data) {
    if (key.length > 64) key = ND.sha256b(key);
    const k = new Uint8Array(64); k.set(key); const ip = new Uint8Array(64 + data.length), op = new Uint8Array(96);
    for (let i = 0; i < 64; i++) { ip[i] = k[i] ^ 0x36; op[i] = k[i] ^ 0x5c; } ip.set(data, 64); op.set(ND.sha256b(ip), 64); return ND.sha256b(op);
  }
  const cat = (...a) => { const l = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(l); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  function rfc6979k(h1hex, privBig) {
    const x = ND.unhex(hex32(privBig)), h1 = ND.unhex(hex32(mod(big(h1hex), N)));
    let V = new Uint8Array(32).fill(1), K = new Uint8Array(32);
    K = hmac(K, cat(V, Uint8Array.of(0), x, h1)); V = hmac(K, V);
    K = hmac(K, cat(V, Uint8Array.of(1), x, h1)); V = hmac(K, V);
    for (;;) { V = hmac(K, V); const k = big(ND.hex(V)); if (k >= 1n && k < N) return k; K = hmac(K, cat(V, Uint8Array.of(0))); V = hmac(K, V); }
  }

  const E = ND.ecdsa = {
    P, N, G: [GX, GY],
    hmacSha256: (k, d) => ND.hex(hmac(typeof k === 'string' ? ND.utf8(k) : k, typeof d === 'string' ? ND.utf8(d) : d)),
    /** приватный ключ (hex, 64 символа) из seed-фразы: SHA-256 с «растяжкой» до допустимого диапазона */
    privFromSeed(seed) { let h = ND.sha256('nodonia:' + seed), k = big(h); let i = 0; while (k < 1n || k >= N) k = big(ND.sha256(h + (++i))); return hex32(k); },
    validPriv(h) { try { if (!/^[0-9a-fA-F]{1,64}$/.test(h)) return false; const k = big(h); return k >= 1n && k < N; } catch (e) { return false; } },
    /** публичный ключ: compressed=true → 66 hex (02/03 + x), иначе 130 hex (04 + x + y) */
    publicKey(privHex, compressed) {
      if (!E.validPriv(privHex)) throw new Error('недопустимый приватный ключ');
      const [x, y] = aff(mul(big(privHex), Gj)); return compressed === false ? '04' + hex32(x) + hex32(y) : (y & 1n ? '03' : '02') + hex32(x);
    },
    /** разжать публичный ключ → [x,y] (BigInt) либо бросить ошибку, если точка не на кривой */
    decodePub(hex) {
      hex = String(hex); if (/^04[0-9a-f]{128}$/i.test(hex)) { const x = big(hex.slice(2, 66)), y = big(hex.slice(66)); if (!onCurve(x, y)) throw new Error('точка не лежит на кривой'); return [x, y]; }
      if (/^0[23][0-9a-f]{64}$/i.test(hex)) { const x = big(hex.slice(2)); let y = pow(mod(x * x * x + 7n), (P + 1n) / 4n, P); if (mod(y * y) !== mod(x * x * x + 7n)) throw new Error('x не соответствует точке кривой'); if ((y & 1n) !== (hex[1] === '3' ? 1n : 0n)) y = P - y; return [x, y]; }
      throw new Error('неверный формат публичного ключа');
    },
    address(pubHex) { return '0x' + ND.sha256(ND.unhex(pubHex)).slice(-40); },
    /** подпись хэша сообщения (hex 64) → {r,s} (hex) */
    signHash(hashHex, privHex) {
      if (!/^[0-9a-f]{64}$/i.test(hashHex)) throw new Error('хэш должен быть 64 hex-символа');
      const d = big(privHex), z = big(hashHex);
      for (let attempt = 0; ; attempt++) {
        const k = rfc6979k(attempt ? ND.sha256(hashHex + attempt) : hashHex, d), R = aff(mul(k, Gj)), r = mod(R[0], N); if (r === 0n) continue;
        let s = mod(inv(k, N) * (z + r * d), N); if (s === 0n) continue; if (s > N / 2n) s = N - s; // low-S
        return { r: hex32(r), s: hex32(s) };
      }
    },
    /** подпись текста: хэш = SHA-256(текст) */
    sign(msg, privHex) { return E.signHash(ND.sha256(msg), privHex); },
    verifyHash(hashHex, sig, pubHex) {
      try {
        if (!sig || !/^[0-9a-f]{64}$/i.test(sig.r || '') || !/^[0-9a-f]{64}$/i.test(sig.s || '') || !/^[0-9a-f]{64}$/i.test(hashHex)) return false;
        const r = big(sig.r), s = big(sig.s), z = big(hashHex); if (r < 1n || r >= N || s < 1n || s >= N) return false;
        const [qx, qy] = E.decodePub(pubHex), w = inv(s, N), u1 = mod(z * w, N), u2 = mod(r * w, N);
        const pt = aff(add(mul(u1, Gj), mul(u2, [qx, qy, 1n]))); return !!pt && mod(pt[0], N) === r;
      } catch (e) { return false; }
    },
    verify(msg, sig, pubHex) { return E.verifyHash(ND.sha256(msg), sig, pubHex); },
    /** новый случайный приватный ключ из ГПСЧ rng (ND.RNG) — детерминированно, для демонстраций */
    randomPriv(rng) { let h = ''; for (let i = 0; i < 8; i++) h += ND.pad(rng.int(0, 0xffffffff).toString(16), 8); let k = big(h) % (N - 1n) + 1n; return hex32(k); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
