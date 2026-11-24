/* Нодония — шаблоны схем для Raft и Gossip (остальные протоколы регистрируют свои сами). */
(function (G) {
  'use strict';
  const ND = G.ND, M = o => () => ND.makeScheme(o);
  ND.reg.templates.push(
    { id: 'raft-3', proto: 'raft', title: 'Raft: 3 узла', desc: 'Минимальный кластер: терпит отказ одного узла.', build: M({ proto: 'raft', n: 3, topo: 'full', lat: 40, jit: 15, title: 'Raft: 3 узла' }) },
    { id: 'raft-5', proto: 'raft', title: 'Raft: 5 узлов', desc: 'Стандартный кластер: терпит отказ двух узлов.', build: M({ proto: 'raft', n: 5, topo: 'full', lat: 40, jit: 15, title: 'Raft: 5 узлов' }) },
    { id: 'raft-wan', proto: 'raft', title: 'Raft: 5 узлов, медленная сеть (WAN)', desc: 'Задержки 150±60 мс и потери 3%: выборы и фиксация заметно медленнее.', build: M({ proto: 'raft', n: 5, topo: 'full', lat: 150, jit: 60, loss: 0.03, title: 'Raft: WAN' }) },
    { id: 'raft-7', proto: 'raft', title: 'Raft: 7 узлов', desc: 'Терпит отказ трёх узлов, но каждая запись идёт дольше.', build: M({ proto: 'raft', n: 7, topo: 'full', lat: 40, jit: 15, title: 'Raft: 7 узлов' }) },
    { id: 'gossip-8', proto: 'gossip', title: 'Gossip: 8 узлов, полная связность', desc: 'do rumor node=n1 value=hello, run 15 — слух расходится за несколько раундов.', build: M({ proto: 'gossip', n: 8, topo: 'full', lat: 80, jit: 30, title: 'Gossip: 8 узлов' }) },
    { id: 'gossip-ring', proto: 'gossip', title: 'Gossip: кольцо из 12 узлов', desc: 'Только соседи по кольцу: слух идёт медленно, зато видно волну.', build: M({ proto: 'gossip', n: 12, topo: 'ring', lat: 80, jit: 30, title: 'Gossip: кольцо' }) },
    { id: 'gossip-lossy', proto: 'gossip', title: 'Gossip: 10 узлов, 30% потерь', desc: 'Даже при больших потерях слух доходит: избыточность спасает.', build: M({ proto: 'gossip', n: 10, topo: 'full', lat: 80, jit: 30, loss: 0.3, title: 'Gossip: потери' }) });
})(typeof window !== 'undefined' ? window : globalThis);
