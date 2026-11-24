/* Нодония — кошельки (учебные): ключ ECDSA secp256k1, адрес, подпись и проверка. */
(function (G) {
  'use strict';
  const ND = G.ND, E = ND.ecdsa;
  ND.wallet = {
    /** создать кошелёк из seed-фразы (детерминированно) либо из приватного ключа hex */
    create(name, seed, priv) {
      priv = priv || E.privFromSeed(seed == null ? name : seed); const pub = E.publicKey(priv, true);
      return { name, priv, pub, addr: E.address(pub) };
    },
    /** подпись произвольного хэша/идентификатора (hex 64) → {r,s} */
    signId(id, w) { return E.signHash(id, w.priv); },
    verifyId(id, sig, pub) { return E.verifyHash(id, sig, pub); },
    signMessage(msg, w) { return E.sign(msg, w.priv); },
    verifyMessage(msg, sig, pub) { return E.verify(msg, sig, pub); },
    short(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
