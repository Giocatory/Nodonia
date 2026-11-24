/* Нодония — ядро: детерминированный дискретно-событийный симулятор распределённой системы.
   Время виртуальное (мс). Всё случайное берётся из sim.rng, поэтому прогон воспроизводим по seed + журналу действий. */
(function (G) {
  'use strict';
  const ND = G.ND;
  const LOG_CAP = 30000;

  class Sim {
    /** scheme — очищенная схема (см. ND.cleanScheme). */
    constructor(scheme) {
      this.scheme = scheme;
      this.def = ND.reg.protocols[scheme.proto];
      if (!this.def) throw new Error('Неизвестный протокол: ' + scheme.proto);
      this.seed = scheme.seed | 0 || 1;
      this.params = {};
      for (const p of this.def.params || []) this.params[p.id] = p.def;
      Object.assign(this.params, scheme.params || {});
      this._init();
    }
    _init() {
      this.rng = new ND.RNG(this.seed);
      this.now = 0; this.seq = 0; this.evCount = 0; this.mid = 0; this.tid = 0;
      this.heap = new ND.Heap((a, b) => a.t - b.t || a.s - b.s);
      this.nodes = []; this.byId = {}; this.links = []; this.linkById = {};
      this.log = []; this.logBase = 0; this.hist = [];
      this.stats = { sent: 0, delivered: 0, dropped: 0, byType: {} };
      this.flights = new Map();            // mid -> сообщение, пока оно «в полёте»
      this.violations = [];                // нарушения инвариантов
      this._topo = 0; this._routes = new Map();
      this.started = false; this.invOn = true;
      for (const n of this.scheme.nodes) this._addNode(n);
      for (const l of this.scheme.links) this._addLink(l);
    }
    _addNode(n) {
      const node = { id: n.id, name: n.name || n.id, x: n.x, y: n.y, kind: n.kind || 'node', cfg: Object.assign({}, n.cfg), up: true, timers: {}, st: null, crashes: 0 };
      this.nodes.push(node); this.byId[node.id] = node; return node;
    }
    _addLink(l) {
      const id = l.id || ('l' + (this.links.length + 1));
      const link = { id, a: l.a, b: l.b, lat: l.lat, jit: l.jit || 0, loss: l.loss || 0, dup: l.dup || 0, up: l.up !== false };
      this.links.push(link); this.linkById[id] = link; this._topo++; return link;
    }

    /* ---------- контекст для обработчиков протокола ---------- */
    ctx(node) {
      const sim = this;
      return {
        sim, node, id: node.id, name: node.name, st: node.st, cfg: node.cfg, params: sim.params, rng: sim.rng,
        get now() { return sim.now; },
        peers: sim.nodes.filter(n => n.id !== node.id).map(n => n.id),
        neighbors: sim.neighborsOf(node.id),
        send: (to, type, body) => sim.send(node.id, to, type, body),
        bcast: (type, body) => { for (const n of sim.nodes) if (n.id !== node.id) sim.send(node.id, n.id, type, body); },
        sendNeighbors: (type, body, except) => { for (const nb of sim.neighborsOf(node.id)) if (nb !== except) sim.send(node.id, nb, type, body); },
        timer: (name, ms) => sim.setTimer(node, name, ms),
        cancel: name => sim.cancelTimer(node, name),
        hasTimer: name => node.timers[name] != null,
        log: (text, cls) => sim._push({ k: 'note', n: node.id, text, cls }),
        mark: (text, cls) => sim._push({ k: 'mark', n: node.id, text, cls }),
      };
    }
    neighborsOf(id) {
      const out = [];
      for (const l of this.links) if (l.up) { if (l.a === id) out.push(l.b); else if (l.b === id) out.push(l.a); }
      return out.filter(x => this.byId[x] && this.byId[x].up);
    }

    /* ---------- запуск ---------- */
    start() {
      if (this.started) return; this.started = true;
      for (const n of this.nodes) { n.st = this.def.init ? this.def.init(n, this) : {}; }
      this._push({ k: 'note', text: 'Симуляция начата: протокол «' + this.def.title + '», узлов ' + this.nodes.length + ', seed ' + this.seed });
      for (const n of this.nodes) if (this.def.onStart) this.def.onStart(this.ctx(n));
      this._checkInv(true);
    }

    /* ---------- журнал ---------- */
    _push(e) {
      e.t = e.t == null ? this.now : e.t; e.i = this.logBase + this.log.length; e.ev = this.evCount;
      this.log.push(e);
      if (this.log.length > LOG_CAP) { this.log.splice(0, 5000); this.logBase += 5000; }
      return e;
    }

    /* ---------- маршрутизация ---------- */
    route(a, b) {
      const key = a + '>' + b, c = this._routes.get(key);
      if (c && c.v === this._topo) return c.p;
      const A = this.byId[a], B = this.byId[b]; let path = null;
      if (A && B && A.up && B.up) {
        if (a === b) path = [a];
        else {
          const dist = { [a]: 0 }, prev = {}, done = {}, adj = {};
          for (const l of this.links) if (l.up) { (adj[l.a] = adj[l.a] || []).push([l.b, l.lat, l]); (adj[l.b] = adj[l.b] || []).push([l.a, l.lat, l]); }
          for (;;) {
            let u = null, du = Infinity; for (const k in dist) if (!done[k] && dist[k] < du) { u = k; du = dist[k]; }
            if (u === null) break; done[u] = 1; if (u === b) break;
            if (u !== a && !this.byId[u].up) continue;       // упавший узел не пересылает
            for (const [v, w, l] of adj[u] || []) { if (!this.byId[v].up && v !== b) continue; if (dist[v] === undefined || du + w < dist[v]) { dist[v] = du + w; prev[v] = [u, l]; } }
          }
          if (dist[b] !== undefined) { path = [b]; let c2 = b; while (c2 !== a) { c2 = prev[c2][0]; path.unshift(c2); } }
        }
      }
      this._routes.set(key, { v: this._topo, p: path });
      return path;
    }
    _killFlights(l) { for (const m of this.flights.values()) if (!m.cutBy && m.hops.some(h => h.link === l.id && h.t1 > this.now)) m.cutBy = l.a + '—' + l.b; }
    linkBetween(a, b) { for (const l of this.links) if ((l.a === a && l.b === b) || (l.a === b && l.b === a)) return l; return null; }
    reachable(a) { const s = new Set([a]); const q = [a]; while (q.length) { const u = q.shift(); for (const v of this.neighborsOf(u)) if (!s.has(v)) { s.add(v); q.push(v); } } return s; }
    /** компоненты связности среди живых узлов */
    components() { const seen = new Set(), out = []; for (const n of this.nodes) if (n.up && !seen.has(n.id)) { const c = [...this.reachable(n.id)]; c.forEach(x => seen.add(x)); out.push(c); } return out; }

    /* ---------- отправка и доставка ---------- */
    send(from, to, type, body) {
      const src = this.byId[from]; if (!src || !src.up || !this.byId[to]) return null;
      this.stats.sent++; this.stats.byType[type] = (this.stats.byType[type] || 0) + 1;
      const mid = ++this.mid, path = this.route(from, to);
      const msg = { id: mid, from, to, type, body: body === undefined ? {} : ND.clone(body), sent: this.now, arrive: this.now, path: path || [from], hops: [], lost: false };
      if (!path) { this._push({ k: 'drop', mid, from, to, type, text: 'нет маршрута ' + from + ' → ' + to + ' (сеть разделена или узел недоступен)', reason: 'route' }); this.stats.dropped++; return mid; }
      let t = 0, lostAt = null;
      if (path.length === 1) t = 1;        // локальная доставка (петля)
      for (let i = 0; i + 1 < path.length; i++) {
        const l = this.linkBetween(path[i], path[i + 1]), d = Math.max(1, l.lat + (l.jit ? this.rng.float() * l.jit : 0));
        msg.hops.push({ a: path[i], b: path[i + 1], t0: this.now + t, t1: this.now + t + d, link: l.id });
        if (lostAt === null && this.rng.chance(l.loss)) lostAt = { t: this.now + t + d * 0.5, hop: i };
        t += d;
      }
      msg.arrive = this.now + t;
      this._push({ k: 'send', mid, from, to, type, arrive: msg.arrive, path, body: msg.body, text: this._describe(msg) });
      this.flights.set(mid, msg);
      if (lostAt) { msg.lost = true; msg.lostAt = lostAt.t; this._sched(lostAt.t, { kind: 'lose', msg }); }
      else {
        this._sched(msg.arrive, { kind: 'deliver', msg });
        const dupHop = path.length > 1 ? this.linkBetween(path[0], path[1]) : null;
        if (dupHop && this.rng.chance(dupHop.dup)) { const m2 = Object.assign({}, msg, { id: ++this.mid, dupOf: mid, arrive: msg.arrive + 5 + this.rng.float() * 40 }); this.flights.set(m2.id, m2); this._push({ k: 'note', n: from, text: 'канал продублировал сообщение #' + mid + ' (дубликат #' + m2.id + ')', cls: 'warn' }); this._sched(m2.arrive, { kind: 'deliver', msg: m2 }); }
      }
      return mid;
    }
    _describe(msg) { try { return this.def.describe ? this.def.describe(msg, this) : msg.type; } catch (e) { return msg.type; } }
    label(msg) { try { return this.def.label ? this.def.label(msg) : msg.type; } catch (e) { return msg.type; } }

    _sched(t, ev) { ev.t = t; ev.s = ++this.seq; this.heap.push(ev); return ev; }
    setTimer(node, name, ms) {
      const id = ++this.tid; node.timers[name] = id;
      this._sched(this.now + Math.max(0, ms), { kind: 'timer', node: node.id, name, id });
    }
    cancelTimer(node, name) { delete node.timers[name]; }
    /** отложенное действие (для консольной команды at и сценариев отказов) */
    scheduleAct(delay, kind, args) { this._sched(this.now + Math.max(0, delay), { kind: 'act', act: { kind, args } }); }

    /* ---------- шаги ---------- */
    peekTime() { // время ближайшего живого события
      for (;;) { const e = this.heap.peek(); if (!e) return null; if (e.kind === 'timer' && this.byId[e.node].timers[e.name] !== e.id) { this.heap.pop(); continue; } return e.t; }
    }
    /** выполнить одно видимое событие; вернёт {t, logs, ev} либо null, если событий нет */
    step() {
      if (!this.started) this.start();
      if (this.peekTime() === null) return null;
      const e = this.heap.pop(), mark = this.logBase + this.log.length;
      this.now = Math.max(this.now, e.t); this.evCount++;
      this._apply(e);
      this._checkInv(false);
      return { t: this.now, ev: e, logs: this.log.slice(Math.max(0, mark - this.logBase)) };
    }
    _apply(e) {
      if (e.kind === 'deliver') {
        const m = e.msg; this.flights.delete(m.id); const dst = this.byId[m.to];
        if (!dst || !dst.up) { this.stats.dropped++; this._push({ k: 'drop', mid: m.id, from: m.from, to: m.to, type: m.type, text: 'узел ' + m.to + ' недоступен — сообщение «' + this.label(m) + '» потеряно', reason: 'down' }); return; }
        if (m.cutBy) { this.stats.dropped++; this._push({ k: 'drop', mid: m.id, from: m.from, to: m.to, type: m.type, text: 'канал ' + m.cutBy + ' оборвался, пока сообщение «' + this.label(m) + '» было в пути', reason: 'cut' }); return; }
        this.stats.delivered++;
        this._push({ k: 'recv', mid: m.id, from: m.from, to: m.to, type: m.type, text: this._describe(m), sent: m.sent });
        if (this.def.onMessage) this.def.onMessage(this.ctx(dst), m);
      } else if (e.kind === 'lose') {
        const m = e.msg; this.flights.delete(m.id); this.stats.dropped++;
        this._push({ k: 'drop', mid: m.id, from: m.from, to: m.to, type: m.type, text: 'сообщение «' + this.label(m) + '» (' + m.from + ' → ' + m.to + ') потеряно в сети', reason: 'loss' });
      } else if (e.kind === 'timer') {
        const n = this.byId[e.node]; if (!n.up) return; delete n.timers[e.name];
        this._push({ k: 'timer', n: n.id, text: 'сработал таймер «' + e.name + '» на ' + n.name, name: e.name });
        if (this.def.onTimer) this.def.onTimer(this.ctx(n), e.name);
      } else if (e.kind === 'act') {
        this.applyAct(e.act.kind, e.act.args, true);
      } else if (e.kind === 'call') { e.fn(); }
    }
    /** выполнить события до момента t (виртуальное время) */
    runUntil(t, maxEv) {
      if (!this.started) this.start(); maxEv = maxEv || 20000; let n = 0;
      for (;;) { const pt = this.peekTime(); if (pt === null || pt > t || n >= maxEv) break; this.step(); n++; }
      if (n < maxEv) this.now = Math.max(this.now, t);
      return n;
    }
    runEvents(k) { let n = 0; while (n < k && this.step()) n++; return n; }
    /** выполнять, пока cond(sim) не станет истиной или не выйдет лимит */
    runWhile(cond, maxT, maxEv) { maxEv = maxEv || 50000; let n = 0; while (!cond(this) && n < maxEv) { const pt = this.peekTime(); if (pt === null || pt > maxT) break; this.step(); n++; } return cond(this); }

    /* ---------- инварианты ---------- */
    _checkInv(force) {
      if (!this.invOn || !this.def.invariants) return;
      if (!force && this.nodes.length > 12 && this.evCount % 10) return;
      let r; try { r = this.def.invariants(this); } catch (e) { return; }
      for (const x of r) if (!x.ok && !this.violations.find(v => v.id === x.id)) { this.violations.push({ id: x.id, text: x.text, t: this.now, ev: this.evCount }); this._push({ k: 'note', text: '⚠ НАРУШЕНИЕ ИНВАРИАНТА: ' + x.text, cls: 'bad' }); }
    }
    invariants() { return this.def.invariants ? this.def.invariants(this) : []; }

    /* ---------- действия пользователя (записываются в журнал для воспроизведения) ---------- */
    act(kind, args) {
      if (!this.started) this.start();
      this.hist.push({ ev: this.evCount, t: this.now, kind, args: ND.clone(args || {}) });
      return this.applyAct(kind, args || {}, false);
    }
    applyAct(kind, a, scheduled) {
      const n = a.node ? this.byId[a.node] : null;
      switch (kind) {
        case 'crash': if (n && n.up) { n.up = false; n.crashes++; n.timers = {}; this._topo++; this._push({ k: 'crash', n: n.id, text: 'узел ' + n.name + ' ОТКАЗАЛ (crash)', cls: 'bad' }); if (this.def.onCrash) this.def.onCrash(this.ctx(n)); } break;
        case 'recover': if (n && !n.up) { n.up = true; this._topo++; this._push({ k: 'recover', n: n.id, text: 'узел ' + n.name + ' восстановлен', cls: 'ok' }); if (this.def.onRecover) this.def.onRecover(this.ctx(n)); } break;
        case 'cut': { const l = this.linkBetween(a.a, a.b); if (l && l.up) { l.up = false; this._killFlights(l); this._topo++; this._push({ k: 'cut', text: 'канал ' + l.a + '—' + l.b + ' оборван', cls: 'bad' }); } break; }
        case 'heal': { const l = this.linkBetween(a.a, a.b); if (l && !l.up) { l.up = true; this._topo++; this._push({ k: 'heal', text: 'канал ' + l.a + '—' + l.b + ' восстановлен', cls: 'ok' }); } break; }
        case 'partition': { // groups: [[ids],[ids]] — рвём все каналы между группами
          const gi = {}; (a.groups || []).forEach((g, i) => g.forEach(id => gi[id] = i));
          let c = 0; for (const l of this.links) if (l.up && gi[l.a] !== undefined && gi[l.b] !== undefined && gi[l.a] !== gi[l.b]) { l.up = false; this._killFlights(l); c++; }
          this._topo++; this._push({ k: 'cut', text: 'СЕТЬ РАЗДЕЛЕНА на группы ' + (a.groups || []).map(g => '{' + g.join(',') + '}').join(' | ') + ' (оборвано каналов: ' + c + ')', cls: 'bad' }); break; }
        case 'healall': { let c = 0; for (const l of this.links) if (!l.up) { l.up = true; c++; } this._topo++; this._push({ k: 'heal', text: 'все каналы восстановлены (' + c + ')', cls: 'ok' }); break; }
        case 'setlink': { const l = this.linkBetween(a.a, a.b); if (l) { for (const k of ['lat', 'jit', 'loss', 'dup']) if (a[k] != null) l[k] = ND.num(a[k], l[k], 0, k === 'loss' || k === 'dup' ? 1 : 60000); this._topo++; this._push({ k: 'note', text: 'канал ' + l.a + '—' + l.b + ': задержка ' + l.lat + ' мс, джиттер ' + l.jit + ', потери ' + Math.round(l.loss * 100) + '%' }); } break; }
        case 'setcfg': if (n) { n.cfg[a.key] = a.value; this._push({ k: 'note', n: n.id, text: 'настройка ' + n.name + '.' + a.key + ' = ' + a.value }); if (this.def.onCfg) this.def.onCfg(this.ctx(n), a.key); } break;
        case 'setparam': this.params[a.key] = a.value; this._push({ k: 'note', text: 'параметр ' + a.key + ' = ' + a.value }); if (this.def.onParam) this.def.onParam(this, a.key); break;
        case 'client': { const ac = (this.def.actions || []).find(x => x.id === a.id); if (ac) { this._push({ k: 'client', n: (a.args && a.args.node) || null, text: 'клиент: ' + ac.label + (a.args ? ' ' + JSON.stringify(a.args) : '') }); const r = ac.run(this, a.args || {}); if (r && r.text) this._push({ k: 'note', text: r.text }); } break; }
        case 'at': this.scheduleAct(a.delay, a.action.kind, a.action.args); this._push({ k: 'note', text: 'запланировано через ' + ND.fmtT(a.delay) + ': ' + a.action.kind }); break;
        case 'note': this._push({ k: 'note', text: a.text }); break;
      }
      this._topo++; this._routes.clear();
      if (!scheduled) this._checkInv(true);
    }

    /* ---------- прочее ---------- */
    count() { return this.evCount; }
    stateOf(id) { const n = this.byId[id]; return n ? n.st : null; }
    summary() { return { t: this.now, ev: this.evCount, up: this.nodes.filter(n => n.up).length, n: this.nodes.length, stats: this.stats, violations: this.violations.length }; }

    /** Воспроизвести схему и журнал действий до события №ev (шаг назад, загрузка сеанса). */
    static replay(scheme, hist, ev) {
      const s = new Sim(scheme); s.start();
      const h = (hist || []).slice().sort((a, b) => a.ev - b.ev); let i = 0;
      const lim = ev == null ? Infinity : ev;
      for (;;) {
        while (i < h.length && h[i].ev <= s.evCount && h[i].ev <= lim) { const x = h[i++]; s.now = Math.max(s.now, x.t || 0); s.act(x.kind, x.args); }
        if (s.evCount >= lim || !s.step()) break;
      }
      while (i < h.length && h[i].ev <= lim) { const x = h[i++]; s.now = Math.max(s.now, x.t || 0); s.act(x.kind, x.args); }
      return s;
    }
  }
  ND.Sim = Sim;
})(typeof window !== 'undefined' ? window : globalThis);
