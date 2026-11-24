/* Нодония — рабочая область «Кластер»: холст со схемой, анимация сообщений, панели, консоль, журнал, диаграмма.
   Одна область обслуживает все протоколы, зарегистрированные через ND.registerProtocol. */
(function (G) {
  'use strict';
  const ND = G.ND, ui = ND.ui, h = ui.h, esc = ND.esc, NS = 'http://www.w3.org/2000/svg';
  const R = 28, SPEEDS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 50, 200];
  const MSG_COLORS = ['#6366f1', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#ec4899', '#22c55e'];

  class Cluster {
    constructor(root, opts) {
      this.root = root; this.opts = opts || {}; this.pid = this.opts.proto; this.def = ND.reg.protocols[this.pid];
      this.mode = 'sel'; this.sel = null; this.undo = []; this.redo = []; this.playing = false; this.speed = ui.store.get('speed', 1); this.viewT = 0;
      this.pan = { x: 0, y: 0, z: 1 }; this.tab = 'node'; this.dockTab = 'console'; this.lastLogShown = 0; this.cmdHist = []; this.hi = 0; this.typeColor = {}; this.msgLabels = ui.store.get('msglabels', true); this.linkLabels = ui.store.get('linklabels', true);
      this.task = this.opts.task || null; this.dirtyNotes = false; this.destroyed = false;
      let sc = ui.pendingScheme && ui.pendingScheme.proto === this.pid ? ui.pendingScheme : null; ui.pendingScheme = null;
      if (this.opts.scheme) sc = this.opts.scheme;
      if (!sc) { const saved = ui.store.get('scheme.' + this.pid); if (saved) sc = saved; }
      this.scheme = ND.cleanScheme(sc || this.def.defaultScheme()); if (this.scheme.proto !== this.pid) this.scheme = ND.cleanScheme(this.def.defaultScheme());
      const hist = this.scheme.hist; delete this.scheme.hist;
      this.base = ND.clone(this.scheme); this.sim = null; this.newSim(hist);
      this.build(); this.fit(); this.rebuildSvg(); this.refreshAll(true);
      this.last = performance.now(); this.raf = requestAnimationFrame(t => this.frame(t));
      if (this.opts.welcome !== false && !ui.store.get('seen.' + this.pid)) { ui.store.set('seen.' + this.pid, 1); this.say('Нажмите ▶ «Пуск» и наблюдайте. Правая кнопка на узле — отказ и действия клиента; «Шаг» выполняет одно событие и объясняет его здесь.'); }
    }

    /* ---------- симуляция ---------- */
    newSim(hist) {
      this.base = ND.clone(this.scheme); this.base.seed = this.scheme.seed;
      this.sim = hist && hist.length ? ND.Sim.replay(ND.cleanScheme(this.base), hist, undefined) : new ND.Sim(ND.cleanScheme(this.base));
      if (!this.sim.started) this.sim.start();
      this.viewT = this.sim.now; this.lastLogShown = 0; this.liveSig = {};
      if (this.logBody) { this.logBody.innerHTML = ''; }
      this.save();
    }
    resetSim() { this.playing = false; this.newSim(); this.rebuildSvg(); this.refreshAll(true); this.say('Симуляция начата заново (seed ' + this.scheme.seed + ').'); this.syncPlay(); }
    newSeed() { this.scheme.seed = Math.floor(1 + Math.random() * 99999); this.resetSim(); ui.toast('Новый seed: ' + this.scheme.seed); }
    save() { try { const s = ND.clone(this.scheme); ui.store.set('scheme.' + this.pid, s); } catch (e) { } }
    snapshot() { return JSON.stringify(this.scheme); }
    /** структурная правка схемы: undo, пересборка и перезапуск */
    edit(fn, quiet) {
      this.undo.push(this.snapshot()); if (this.undo.length > 80) this.undo.shift(); this.redo = [];
      fn(this.scheme); this.scheme = ND.cleanScheme(this.scheme); delete this.scheme.hist;
      const was = this.sim.evCount > 0; this.playing = false; this.newSim(); this.rebuildSvg(); this.refreshAll(true); this.syncPlay();
      if (was && !quiet) this.say('Схема изменена — симуляция начата заново.');
    }
    doUndo() { if (!this.undo.length) return; this.redo.push(this.snapshot()); this.scheme = JSON.parse(this.undo.pop()); this.restore(); }
    doRedo() { if (!this.redo.length) return; this.undo.push(this.snapshot()); this.scheme = JSON.parse(this.redo.pop()); this.restore(); }
    restore() { this.sel = null; this.playing = false; this.newSim(); this.rebuildSvg(); this.refreshAll(true); this.syncPlay(); }
    nodeObj(id) { return this.scheme.nodes.find(n => n.id === id); }
    load(scheme, hist) {
      const sc = ND.cleanScheme(scheme); if (sc.proto !== this.pid) { ui.pendingScheme = sc; ui.open('p:' + sc.proto); return; }
      this.undo.push(this.snapshot()); this.scheme = sc; const hs = sc.hist; delete this.scheme.hist; this.playing = false; this.sel = null; this.newSim(hist || hs); this.fit(); this.rebuildSvg(); this.refreshAll(true); this.syncPlay();
    }

    /* ---------- каркас интерфейса ---------- */
    build() {
      const r = this.root; r.innerHTML = '';
      const T = this.tb = h('div', { class: 'toolbar' });
      this.mbtn = {};
      const mb = (m, t, tip) => this.mbtn[m] = h('button', { class: 'btn' + (m === this.mode ? ' on' : ''), title: tip, text: t, onclick: () => this.setMode(m) });
      const kinds = this.def.nodeKinds || [];
      this.kindSel = kinds.length > 1 ? h('select', { class: 'inp', title: 'Тип нового узла' }, kinds.map(k => h('option', { value: k.id, text: k.label }))) : null;
      this.btnPlay = h('button', { class: 'btn pri', title: 'Пуск / пауза (Пробел)', onclick: () => this.toggle() });
      this.speedSel = h('select', { class: 'inp', title: 'Скорость: во сколько раз время симуляции быстрее реального', onchange: () => { this.speed = +this.speedSel.value; ui.store.set('speed', this.speed); } }, SPEEDS.map(s => h('option', { value: s, text: '×' + s, selected: s === this.speed })));
      this.clock = h('span', { class: 'mono sm', style: 'min-width:170px' });
      const tpl = ND.reg.templates.filter(t => t.proto === this.pid);
      const tplSel = h('select', { class: 'inp', title: 'Готовые схемы и сценарии', onchange: () => { const t = tpl.find(x => x.id === tplSel.value); tplSel.value = ''; if (t) this.useTemplate(t); } }, h('option', { value: '', text: 'Шаблоны…' }), tpl.map(t => h('option', { value: t.id, text: t.title })));
      T.append(...[mb('sel', 'Выбор', 'Выбирать и двигать узлы'), mb('add', '+ Узел', 'Щёлкните по пустому месту, чтобы добавить узел'), this.kindSel, mb('link', 'Канал', 'Щёлкните два узла, чтобы соединить их'), mb('del', 'Удалить', 'Щёлкните узел или канал'), h('span', { class: 'sep' }),
        this.btnPlay, h('button', { class: 'btn', title: 'Шаг назад (←)', text: '◀', onclick: () => this.stepBack() }), h('button', { class: 'btn', title: 'Одно событие вперёд (→)', text: 'Шаг ▶', onclick: () => this.stepFwd() }), h('button', { class: 'btn', title: 'Начать заново (R)', text: '⟲', onclick: () => this.resetSim() }), this.speedSel, this.clock,
        h('span', { class: 'sp' }), tpl.length ? tplSel : null,
        h('button', { class: 'btn', title: 'Показать всю схему', text: '⤢', onclick: () => { this.fit(); this.applyPan(); } })].filter(Boolean));
      const split = h('div', { class: 'split' });
      this.explain = h('div', { class: 'explain' }, h('b', { text: 'Что происходит' }), this.explainTx = h('span', { class: 'mt', text: '' }));
      this.svg = document.createElementNS(NS, 'svg'); this.svg.id = 'cv'; this.svg.setAttribute('class', 'm-' + this.mode); this.svg.setAttribute('tabindex', '0'); this.svg.setAttribute('role', 'img'); this.svg.setAttribute('aria-label', 'Схема кластера');
      this.vp = document.createElementNS(NS, 'g'); this.gl = document.createElementNS(NS, 'g'); this.gf = document.createElementNS(NS, 'g'); this.gn = document.createElementNS(NS, 'g'); this.gr = document.createElementNS(NS, 'g');
      this.vp.append(this.gl, this.gr, this.gf, this.gn); this.svg.append(this.vp);
      const legend = h('div', { class: 'legend' }, (this.def.legend || []).map(l => h('span', null, h('i', { class: l.c, style: 'background:var(--' + ({ 'c-gold': 'gold', 'c-orange': 'orange', 'c-blue': 'blue', 'c-green': 'green', 'c-gray': 'gray', 'c-purple': 'purple', 'c-red': 'red', 'c-teal': 'teal', 'c-pink': 'pink' }[l.c] || 'gray') + ')' }), l.t)));
      const zoom = h('div', { class: 'zoom' }, h('button', { class: 'btn sm', text: '−', 'aria-label': 'Уменьшить', onclick: () => this.zoomBy(0.8) }), h('button', { class: 'btn sm', text: '+', 'aria-label': 'Увеличить', onclick: () => this.zoomBy(1.25) }),
        h('button', { class: 'btn sm', text: 'подписи', title: 'Показать/скрыть подписи сообщений и каналов', onclick: () => { this.msgLabels = !this.msgLabels; this.linkLabels = this.msgLabels; ui.store.set('msglabels', this.msgLabels); this.rebuildSvg(); } }));
      const stage = h('div', { class: 'stage' }, this.explain, this.svg, legend, zoom);
      this.side = h('div', { class: 'side' }); this.buildSide();
      split.append(stage, this.side);
      this.dock = h('div', { class: 'dock' }); this.buildDock();
      r.append(T, split, this.dock);
      this.bindCanvas();
      if (this.task) this.tab = 'task', this.refreshSideTabs();
    }
    setMode(m) { this.mode = m; this.linkFrom = null; for (const k in this.mbtn) this.mbtn[k].classList.toggle('on', k === m); this.svg.setAttribute('class', 'm-' + m); this.drawRubber(); }
    say(t) { this.explainTx.className = ''; this.explainTx.textContent = t; }

    /* ---------- боковая панель ---------- */
    buildSide() {
      this.side.innerHTML = '';
      this.tabsEl = h('div', { class: 'tabs' }); this.tabBody = h('div', { class: 'tabc' });
      this.side.append(this.tabsEl, this.tabBody); this.refreshSideTabs();
    }
    refreshSideTabs() {
      const tabs = [['node', this.sel && this.sel.t === 'link' ? 'Канал' : 'Узел'], ['proto', 'Протокол'], ['scheme', 'Схема']]; if (this.task) tabs.unshift(['task', 'Задание']);
      this.tabsEl.innerHTML = ''; tabs.forEach(([k, t]) => this.tabsEl.append(h('button', { class: this.tab === k ? 'on' : '', text: t, onclick: () => { this.tab = k; this.refreshSideTabs(); } })));
      this.renderSide(true);
    }
    renderSide(force) {
      const b = this.tabBody, sim = this.sim; let sig;
      if (this.tab === 'node') {
        if (this.sel && this.sel.t === 'node' && !sim.byId[this.sel.id]) this.sel = null;
        const n = this.sel && this.sel.t === 'node' ? sim.byId[this.sel.id] : null;
        const lk = this.sel && this.sel.t === 'link' ? sim.linkById[this.sel.id] : null;
        if (n) {
          const inspSig = this.safe(() => this.def.inspector ? this.def.inspector(n, sim) : '');
          sig = 'n|' + n.id + '|' + n.up + '|' + n.name;
          if (force || sig !== this.sideSig) { this.sideSig = sig; this.buildNodePanel(n); }
          const insp = this.tabBody.querySelector('#insp'); if (insp && insp.dataset.s !== inspSig) { insp.dataset.s = inspSig; insp.innerHTML = inspSig; }
        } else if (lk) {
          sig = 'l|' + lk.id + '|' + lk.up; if (force || sig !== this.sideSig) { this.sideSig = sig; this.buildLinkPanel(lk); }
        } else { sig = 'none'; if (force || sig !== this.sideSig) { this.sideSig = sig; b.innerHTML = ''; b.append(h('p', { class: 'mt', html: 'Выберите узел или канал на схеме: здесь появятся его настройки, внутреннее состояние и действия. <br><br><b>Правая кнопка</b> на узле — быстрые действия (отказ, действия клиента).' }), h('h4', { text: 'Действия клиента' }), this.actionsPanel(null)); } }
      } else if (this.tab === 'proto') { if (force) this.buildProtoPanel(); }
      else if (this.tab === 'scheme') { if (force) this.buildSchemePanel(); }
      else if (this.tab === 'task') { if (force || this.task) this.renderTask(force); }
    }
    safe(f) { try { return f(); } catch (e) { return '<p class="bad">ошибка отображения: ' + esc(e.message) + '</p>'; } }
    buildNodePanel(n) {
      const b = this.tabBody; b.innerHTML = ''; const sim = this.sim, sn = this.nodeObj(n.id);
      b.append(h('h3', { html: esc(n.name) + ' <span class="badge ' + (n.up ? 'ok' : 'bad') + '">' + (n.up ? 'работает' : 'отказал') + '</span>' }));
      b.append(h('label', { class: 'fld' }, 'Имя', h('input', { class: 'inp', value: n.name, maxlength: 24, onchange: e => { const v = e.target.value.trim().slice(0, 24) || n.id; n.name = v; if (sn) sn.name = v; this.save(); this.rebuildSvg(); this.renderSide(true); } })));
      b.append(h('div', { class: 'row', style: 'margin:6px 0' }, h('button', { class: 'btn ' + (n.up ? 'dng' : 'pri'), text: n.up ? '⏻ Отказ узла' : '⏻ Восстановить', onclick: () => { this.act(n.up ? 'crash' : 'recover', { node: n.id }); } })));
      const decl = typeof this.def.nodeCfg === 'function' ? this.def.nodeCfg(n) : this.def.nodeCfg;
      if (decl && decl.length) { b.append(h('h4', { text: 'Настройки узла' })); for (const f of decl) b.append(ui.field(f, n.cfg[f.id] != null ? n.cfg[f.id] : f.def, v => this.setCfg(n.id, f.id, v), sim.nodes)); }
      b.append(h('h4', { text: 'Состояние' }), h('div', { id: 'insp' }), h('h4', { text: 'Действия клиента' }), this.actionsPanel(n.id));
      this.sideSig = this.sideSig; const insp = b.querySelector('#insp'); const s = this.safe(() => this.def.inspector ? this.def.inspector(n, sim) : ''); insp.dataset.s = s; insp.innerHTML = s;
    }
    buildLinkPanel(l) {
      const b = this.tabBody; b.innerHTML = ''; const sl = this.scheme.links.find(x => (x.a === l.a && x.b === l.b) || (x.a === l.b && x.b === l.a));
      b.append(h('h3', { html: 'Канал ' + esc(this.sim.byId[l.a].name) + ' — ' + esc(this.sim.byId[l.b].name) + ' <span class="badge ' + (l.up ? 'ok' : 'bad') + '">' + (l.up ? 'работает' : 'оборван') + '</span>' }));
      const F = [{ id: 'lat', label: 'Задержка, мс', type: 'number', def: 150, min: 1, max: 60000, hint: 'время прохождения сообщения по каналу в одну сторону' }, { id: 'jit', label: 'Джиттер, мс', type: 'number', def: 0, min: 0, max: 60000, hint: 'случайная добавка к задержке; из-за неё сообщения могут обгонять друг друга' }, { id: 'loss', label: 'Потери (0…1)', type: 'number', def: 0, min: 0, max: 1, step: 0.01, hint: 'вероятность потерять сообщение' }, { id: 'dup', label: 'Дубликаты (0…1)', type: 'number', def: 0, min: 0, max: 1, step: 0.01, hint: 'вероятность доставить сообщение дважды' }];
      for (const f of F) b.append(ui.field(f, l[f.id], v => { this.act('setlink', { a: l.a, b: l.b, [f.id]: v }); if (sl) sl[f.id] = v; this.save(); this.rebuildSvg(); }));
      b.append(h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn ' + (l.up ? 'dng' : 'pri'), text: l.up ? '✂ Оборвать канал' : 'Восстановить канал', onclick: () => this.act(l.up ? 'cut' : 'heal', { a: l.a, b: l.b }) }), h('button', { class: 'btn', text: 'Удалить канал', onclick: () => this.deleteLink(l.id) })));
      b.append(h('p', { class: 'mt sm', html: 'Если прямого канала нет, сообщение идёт по кратчайшему пути через другие работающие узлы (как маршрутизация в IP-сети). Если пути нет — сообщение теряется.' }));
    }
    actionsPanel(nodeId) {
      const box = h('div'); const acts = this.def.actions || [];
      if (!acts.length) { box.append(h('p', { class: 'mt sm', text: 'У этого протокола нет клиентских действий.' })); return box; }
      for (const a of acts) {
        const vals = {}; (a.args || []).forEach(f => vals[f.id] = f.type === 'node' ? (nodeId || this.sim.nodes[0].id) : f.def);
        const d = h('details', { class: 'card', style: 'padding:6px 10px;margin:6px 0' }, h('summary', { style: 'cursor:pointer;font-weight:600', text: a.label }));
        (a.args || []).forEach(f => d.append(ui.field(f, vals[f.id], v => vals[f.id] = v, this.sim.nodes)));
        d.append(h('button', { class: 'btn pri sm', text: 'Выполнить', onclick: () => this.doAction(a.id, vals) }));
        if (nodeId || acts.length === 1) d.open = true; box.append(d);
      }
      return box;
    }
    doAction(id, args) { this.act('client', { id, args: ND.clone(args) }); const last = this.sim.log.slice(-4).reverse().find(e => e.k === 'note' || e.k === 'client'); if (last) this.say(last.text); }
    buildProtoPanel() {
      const b = this.tabBody; b.innerHTML = ''; b.append(h('h3', { text: this.def.title }), h('div', { html: this.def.desc || '' }));
      if (this.def.params && this.def.params.length) { b.append(h('h4', { text: 'Параметры протокола' })); for (const p of this.def.params) b.append(ui.field(p, this.sim.params[p.id], v => this.setParam(p.id, v), this.sim.nodes)); }
      b.append(h('h4', { text: 'Цвета узлов' }), h('div', { class: 'row' }, (this.def.legend || []).map(l => h('span', { class: 'badge' }, l.t))));
      const labs = ND.reg.labs.filter(l => l.proto === this.pid || l.ws === this.pid);
      if (labs.length) { b.append(h('h4', { text: 'Лабораторные по теме' })); labs.forEach(l => b.append(h('div', null, h('a', { href: '#', text: l.title, onclick: e => { e.preventDefault(); ui.open('w:labs', { lab: l.id }); } })))); }
    }
    buildSchemePanel() {
      const b = this.tabBody; b.innerHTML = ''; const s = this.scheme;
      b.append(h('h3', { text: 'Схема' }), ui.field({ id: 'title', label: 'Название', type: 'text', max: 80 }, s.title, v => { s.title = v.slice(0, 80); this.save(); }),
        ui.field({ id: 'seed', label: 'Seed (воспроизводимость)', type: 'number', def: 1, min: 1, max: 2147483647, step: 1, hint: 'зерно генератора случайных чисел: одинаковые схема и seed дают одинаковый ход событий' }, s.seed, v => { s.seed = Math.floor(v); this.resetSim(); }),
        h('label', { class: 'fld' }, 'Заметки', h('textarea', { class: 'inp', rows: 4, maxlength: 600, onchange: e => { s.notes = e.target.value.slice(0, 600); this.save(); } }, s.notes)));
      b.append(h('div', { class: 'row' }, h('button', { class: 'btn', text: 'Все каналы между всеми', title: 'Полносвязная сеть', onclick: () => this.rewire('full') }), h('button', { class: 'btn', text: 'Кольцо', onclick: () => this.rewire('ring') }), h('button', { class: 'btn', text: 'Звезда', onclick: () => this.rewire('star') }), h('button', { class: 'btn', text: 'Расставить по кругу', onclick: () => this.edit(sc => { const p = ND.layout.circle(sc.nodes.length, 380, 250, Math.min(230, 60 + sc.nodes.length * 22)); sc.nodes.forEach((n, i) => { n.x = p[i][0]; n.y = p[i][1]; }); }, true) })));
      b.append(h('h4', { text: 'Размер кластера' }), h('div', { class: 'row' }, h('button', { class: 'btn', text: '− узел', onclick: () => this.resize(-1) }), h('span', { class: 'mono', text: s.nodes.length + ' узл., ' + s.links.length + ' кан.' }), h('button', { class: 'btn', text: '+ узел', onclick: () => this.resize(1) })));
      b.append(h('h4', { text: 'Задержка всех каналов' }), h('div', { class: 'row' }, [20, 100, 300, 800].map(v => h('button', { class: 'btn sm', text: v + ' мс', onclick: () => this.edit(sc => sc.links.forEach(l => l.lat = v)) }))));
    }
    rewire(t) { this.edit(sc => { const ids = sc.nodes.map(n => n.id), lat = sc.links[0] ? sc.links[0].lat : 150, ls = []; if (t === 'full') for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) ls.push([i, j]); else if (t === 'ring') ids.forEach((_, i) => { if (ids.length > 2 || i === 0) ls.push([i, (i + 1) % ids.length]); }); else ids.forEach((_, i) => i && ls.push([0, i])); sc.links = ls.map(p => ({ a: ids[p[0]], b: ids[p[1]], lat, jit: 0, loss: 0 })); }); }
    resize(d) {
      this.edit(sc => {
        if (d > 0 && sc.nodes.length < 20) { let k = sc.nodes.length + 1; while (sc.nodes.some(n => n.id === 'n' + k)) k++; const id = 'n' + k, ang = sc.nodes.length; sc.nodes.push({ id, name: 'N' + k, x: 380 + 200 * Math.cos(ang), y: 250 + 200 * Math.sin(ang), kind: this.kindSel ? this.kindSel.value : undefined, cfg: {} }); const lat = sc.links[0] ? sc.links[0].lat : 150; for (const n of sc.nodes) if (n.id !== id) sc.links.push({ a: id, b: n.id, lat, jit: 0, loss: 0 }); }
        else if (d < 0 && sc.nodes.length > 2) { const id = sc.nodes[sc.nodes.length - 1].id; sc.nodes.pop(); sc.links = sc.links.filter(l => l.a !== id && l.b !== id); }
        const p = ND.layout.circle(sc.nodes.length, 380, 250, Math.min(230, 60 + sc.nodes.length * 22)); sc.nodes.forEach((n, i) => { n.x = p[i][0]; n.y = p[i][1]; });
      }); this.renderSide(true);
    }
    setCfg(id, key, v) { const n = this.sim.byId[id], sn = this.nodeObj(id); if (sn) sn.cfg[key] = v; if (this.sim.evCount === 0) { n.cfg[key] = v; this.base.nodes.find(x => x.id === id).cfg[key] = v; this.save(); } else this.act('setcfg', { node: id, key, value: v }); this.save(); }
    setParam(key, v) { this.scheme.params[key] = v; if (this.sim.evCount === 0) { this.sim.params[key] = v; this.base.params[key] = v; } else this.act('setparam', { key, value: v }); this.save(); }
    act(kind, args) { this.sim.act(kind, args); this.afterAct(); }
    afterAct() { this.refreshAll(true); const e = this.sim.log[this.sim.log.length - 1]; if (e && e.text) this.say(e.text); }

    /* ---------- нижняя панель ---------- */
    buildDock() {
      const d = this.dock; d.innerHTML = '';
      const tabs = h('div', { class: 'tabs' }); this.dtabs = {};
      [['console', 'Консоль'], ['log', 'Журнал'], ['tl', 'Диаграмма'], ['state', 'Инварианты и метрики']].forEach(([k, t]) => tabs.append(this.dtabs[k] = h('button', { class: k === this.dockTab ? 'on' : '', text: t, onclick: () => this.setDock(k) })));
      tabs.append(h('span', { class: 'sp' }), h('button', { class: 'btn sm', text: '▁', title: 'Свернуть панель', onclick: () => { d.classList.toggle('min'); } }), h('button', { class: 'btn sm', text: '⬍', title: 'Выше / ниже', onclick: () => { d.classList.remove('min'); d.classList.toggle('big'); } }));
      const dkc = h('div', { class: 'dkc' }); this.dk = {};
      // консоль
      this.out = h('pre'); this.inp = h('input', { autocomplete: 'off', spellcheck: 'false', placeholder: 'help — список команд; например: crash n1, partition n1,n2 | n3,n4,n5, run 5', 'aria-label': 'Командная строка' });
      this.dk.console = h('div', { class: 'term' }, this.out, h('div', { class: 'pr' }, h('span', { text: '›' }), this.inp));
      this.inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { const v = this.inp.value; this.inp.value = ''; this.runCmd(v); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); if (this.cmdHist.length) { this.hi = Math.max(0, this.hi - 1); this.inp.value = this.cmdHist[this.hi] || ''; } }
        else if (e.key === 'ArrowDown') { e.preventDefault(); this.hi = Math.min(this.cmdHist.length, this.hi + 1); this.inp.value = this.cmdHist[this.hi] || ''; }
        e.stopPropagation();
      });
      this.printLine('Консоль кластера. Введите help. Все действия записываются и воспроизводятся.', 'hd');
      // журнал
      this.filt = { send: false, recv: true, drop: true, mark: true, timer: false, note: true, fault: true };
      const bar = h('div', { class: 'dkbar' }, h('span', { class: 'mt', text: 'Показывать:' }), [['send', 'отправка'], ['recv', 'доставка'], ['drop', 'потери'], ['mark', 'события'], ['timer', 'таймеры'], ['note', 'заметки'], ['fault', 'отказы']].map(([k, t]) => h('label', null, h('input', { type: 'checkbox', checked: this.filt[k], onchange: e => { this.filt[k] = e.target.checked; this.lastLogShown = 0; this.logBody.innerHTML = ''; this.drawLog(); } }), ' ' + t)));
      this.logBody = h('div', { class: 'logt', role: 'log' }); this.dk.log = h('div', { class: 'dkc', style: 'display:flex;flex-direction:column;flex:1;min-height:0' }, bar, this.logBody);
      // диаграмма
      this.dk.tl = h('div', { class: 'dkc', style: 'display:flex;flex-direction:column;flex:1;min-height:0' }); this.timeline = ui.Timeline(this.dk.tl, () => this.sim);
      this.dk.state = h('div', { class: 'metrics' });
      for (const k in this.dk) { this.dk[k].style.display = k === this.dockTab ? '' : 'none'; dkc.append(this.dk[k]); }
      dkc.classList.add('dkc'); d.append(tabs, dkc);
    }
    setDock(k) { this.dockTab = k; this.dock.classList.remove('min'); for (const x in this.dk) this.dk[x].style.display = x === k ? '' : 'none'; for (const x in this.dtabs) this.dtabs[x].classList.toggle('on', x === k); this.refreshDock(true); if (k === 'console') this.inp.focus(); }
    printLine(t, c) { const l = h('div', { class: c || '', text: t }); this.out.append(l); while (this.out.childNodes.length > 400) this.out.firstChild.remove(); this.out.scrollTop = this.out.scrollHeight; }
    runCmd(line) {
      if (!line.trim()) return; this.cmdHist.push(line); this.hi = this.cmdHist.length; this.printLine('› ' + line, 'cmd');
      const self = this, sess = { get sim() { return self.sim; }, reset() { self.resetSim(); }, seed(v) { self.scheme.seed = v; self.resetSim(); } };
      const before = this.sim; const res = ND.console.exec(sess, line);
      for (const o of res) { if (o.clear) { this.out.innerHTML = ''; continue; } this.printLine(o.t, o.c); }
      if (this.sim === before) this.refreshAll(true);
      this.dock.classList.remove('min');
    }
    drawLog() {
      const sim = this.sim, lg = sim.log; let from = Math.max(this.lastLogShown, sim.logBase) - sim.logBase; if (this.lastLogShown < sim.logBase) { this.logBody.innerHTML = ''; }
      const fr = document.createDocumentFragment(); let n = 0;
      const map = { send: 'send', recv: 'recv', drop: 'drop', mark: 'mark', timer: 'timer', note: 'note', client: 'note', crash: 'fault', recover: 'fault', cut: 'fault', heal: 'fault' };
      for (let i = from; i < lg.length; i++) { const e = lg[i]; if (!this.filt[map[e.k] || 'note']) continue; if (lg.length - i > 400 && this.lastLogShown === 0) continue;
        fr.append(h('div', { class: 'lr k-' + e.k + (e.cls === 'bad' ? ' bad' : '') }, h('span', { class: 'tm', text: (e.t / 1000).toFixed(3) }), h('span', { class: 'ic', text: { send: '→', recv: '✓', drop: '✗', mark: '◆', timer: '⏱', crash: '⏻', recover: '⏻', cut: '✂', heal: '⚡', client: '👤' }[e.k] || '·' }), h('span', { text: e.text || e.k }))); n++; }
      this.lastLogShown = sim.logBase + lg.length;
      if (n) { const near = this.logBody.scrollHeight - this.logBody.scrollTop - this.logBody.clientHeight < 60; this.logBody.append(fr); while (this.logBody.childNodes.length > 700) this.logBody.firstChild.remove(); if (near || n > 50) this.logBody.scrollTop = this.logBody.scrollHeight; }
    }
    drawState() {
      const sim = this.sim, b = this.dk.state; let h1 = '<div><h4 style="margin-top:0">Инварианты безопасности</h4>';
      const inv = sim.invariants(); h1 += inv.length ? inv.map(x => '<div class="inv"><i class="' + (x.ok ? 'ok' : 'bad') + '">' + (x.ok ? '✔' : '✘') + '</i><span>' + esc(x.text) + '</span></div>').join('') : '<p class="mt">Для этого протокола нет автоматических проверок безопасности.</p>';
      if (sim.violations.length) h1 += '<p class="bad"><b>Зафиксировано нарушений: ' + sim.violations.length + '</b> (первое на ' + ND.fmtT(sim.violations[0].t) + ')</p>';
      h1 += '</div><div><h4 style="margin-top:0">Метрики</h4>';
      const ms = this.def.metrics ? this.safe(() => this.def.metrics(sim)) : []; h1 += '<dl class="kv"><dt>время</dt><dd>' + ND.fmtT(sim.now) + '</dd><dt>событий</dt><dd>' + sim.evCount + '</dd><dt>узлов работает</dt><dd>' + sim.nodes.filter(n => n.up).length + ' из ' + sim.nodes.length + '</dd><dt>сообщения</dt><dd>' + sim.stats.sent + ' отпр. / ' + sim.stats.delivered + ' дост. / ' + sim.stats.dropped + ' потеряно</dd>' + (Array.isArray(ms) ? ms.map(m => '<dt>' + esc(m.label) + '</dt><dd>' + esc(m.value) + '</dd>').join('') : '') + '</dl>';
      const bt = Object.entries(sim.stats.byType).sort((a, b) => b[1] - a[1]).slice(0, 8); if (bt.length) h1 += '<h4>Сообщения по типам</h4>' + bt.map(([k, v]) => '<div class="sm">' + esc(k) + ' <b>' + v + '</b></div>').join('');
      b.innerHTML = h1 + '</div>';
    }
    refreshDock(force) {
      if (this.dockTab === 'log') this.drawLog(); else if (this.dockTab === 'tl') this.timeline.draw(force); else if (this.dockTab === 'state') this.drawState();
    }

    /* ---------- холст ---------- */
    fit() {
      const ns = this.scheme.nodes; if (!ns.length) { this.pan = { x: 0, y: 0, z: 1 }; return; }
      const xs = ns.map(n => n.x), ys = ns.map(n => n.y), x0 = Math.min(...xs) - 70, x1 = Math.max(...xs) + 70, y0 = Math.min(...ys) - 70, y1 = Math.max(...ys) + 90;
      const W = this.svg.clientWidth || 700, H = this.svg.clientHeight || 400, z = Math.min(1.4, Math.max(.3, Math.min(W / (x1 - x0), H / (y1 - y0))));
      this.pan = { z, x: W / 2 - (x0 + x1) / 2 * z, y: H / 2 - (y0 + y1) / 2 * z };
    }
    applyPan() { this.vp.setAttribute('transform', 'translate(' + this.pan.x + ',' + this.pan.y + ') scale(' + this.pan.z + ')'); }
    zoomBy(k, cx, cy) { const W = this.svg.clientWidth, H = this.svg.clientHeight; cx = cx == null ? W / 2 : cx; cy = cy == null ? H / 2 : cy; const p = this.pan, z = Math.max(.2, Math.min(3, p.z * k)); p.x = cx - (cx - p.x) * z / p.z; p.y = cy - (cy - p.y) * z / p.z; p.z = z; this.applyPan(); }
    world(e) { const r = this.svg.getBoundingClientRect(); return { x: (e.clientX - r.left - this.pan.x) / this.pan.z, y: (e.clientY - r.top - this.pan.y) / this.pan.z }; }
    el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.append(e); return e; }
    rebuildSvg() {
      this.gl.innerHTML = ''; this.gn.innerHTML = ''; this.gf.innerHTML = ''; this.gr.innerHTML = ''; this.nEl = {}; this.lEl = {}; this.pool = []; this.liveSig = {}; this.applyPan();
      const sim = this.sim;
      for (const l of sim.links) {
        const A = sim.byId[l.a], B = sim.byId[l.b], g = this.el('g', { class: 'lk', 'data-id': l.id }, this.gl);
        this.el('line', { class: 'hit', 'data-l': l.id }, g); const ln = this.el('line', {}, g); const tx = this.el('text', {}, g); if (!this.linkLabels) tx.style.display = 'none';
        this.lEl[l.id] = { g, ln, tx, hit: g.firstChild }; this.placeLink(l);
      }
      for (const n of sim.nodes) {
        const g = this.el('g', { class: 'nd', 'data-id': n.id, transform: 'translate(' + n.x + ',' + n.y + ')' }, this.gn);
        this.el('circle', { class: 'sel', r: R + 9 }, g); const ring = this.el('circle', { class: 'ring', r: R + 5, 'stroke-dasharray': '0 999' }, g); this.el('circle', { class: 'body', r: R }, g);
        const ic = this.el('g', { class: 'ico', transform: 'translate(-15,-15) scale(1.25)' }, g); ic.innerHTML = ui.ICONS[n.kind] || ui.ICONS.node;
        this.el('path', { class: 'x', d: 'M-12 -12L12 12M12 -12L-12 12' }, g);
        const nm = this.el('text', { class: 'nm', y: R + 18 }, g), bg = this.el('text', { class: 'bg', y: R + 32 }, g);
        const tt = this.el('title', {}, g); this.nEl[n.id] = { g, nm, bg, ring, tt, circ: 2 * Math.PI * (R + 5) };
      }
      this.updateNodes(true); this.updateLinks();
    }
    placeLink(l) { const A = this.sim.byId[l.a], B = this.sim.byId[l.b], e = this.lEl[l.id]; for (const el of [e.ln, e.hit]) { el.setAttribute('x1', A.x); el.setAttribute('y1', A.y); el.setAttribute('x2', B.x); el.setAttribute('y2', B.y); } e.tx.setAttribute('x', (A.x + B.x) / 2); e.tx.setAttribute('y', (A.y + B.y) / 2 - 4); }
    updateLinks() { for (const l of this.sim.links) { const e = this.lEl[l.id]; if (!e) continue; e.g.setAttribute('class', 'lk' + (l.up ? '' : ' cut') + (this.sel && this.sel.t === 'link' && this.sel.id === l.id ? ' sel' : '')); const t = l.lat + ' мс' + (l.loss ? ' · ' + Math.round(l.loss * 100) + '%' : ''); if (e.tx.textContent !== t) e.tx.textContent = t; } }
    updateNodes(force) {
      const sim = this.sim;
      for (const n of sim.nodes) {
        const e = this.nEl[n.id]; if (!e) continue; let cls = 'c-gray', bad = '';
        try { cls = this.def.nodeClass ? this.def.nodeClass(n, sim) : (n.up ? 'c-blue' : 'c-gray'); bad = this.def.badge ? this.def.badge(n, sim) : ''; } catch (x) { bad = ''; }
        const ring = n.up && this.def.ring ? this.safe0(() => this.def.ring(n, sim)) : null, sel = this.sel && this.sel.t === 'node' && this.sel.id === n.id;
        const sig = cls + '|' + bad + '|' + n.up + '|' + sel + '|' + n.name;
        if (force || sig !== e.sig) { e.sig = sig; e.g.setAttribute('class', 'nd ' + cls + (n.up ? '' : ' down') + (sel ? ' sel-on' : '')); e.nm.textContent = n.name; e.bg.textContent = bad; e.tt.textContent = n.name + (bad ? ' — ' + bad : '') + (n.up ? '' : ' (отказал)'); }
        if (ring) { const v = Math.round(ring.frac * e.circ * 10) / 10; if (v !== e.rv) { e.rv = v; e.ring.setAttribute('stroke-dasharray', v + ' 999'); } if (e.ringOff) { e.ringOff = false; e.ring.style.display = ''; } } else if (!e.ringOff) { e.ringOff = true; e.ring.style.display = 'none'; }
      }
    }
    safe0(f) { try { return f(); } catch (e) { return null; } }
    typeCol(t) { if (!this.typeColor[t]) this.typeColor[t] = MSG_COLORS[Object.keys(this.typeColor).length % MSG_COLORS.length]; return this.typeColor[t]; }
    drawFlights() {
      const sim = this.sim, T = this.viewT; let k = 0; const many = sim.flights.size > 60;
      for (const m of sim.flights.values()) {
        if (m.sent > T) continue; const end = m.lost ? m.lostAt : m.arrive; if (T > end + 1) continue;
        let x, y, hop = m.hops.find(h2 => T >= h2.t0 && T <= h2.t1) || m.hops[m.hops.length - 1]; if (!hop) { const n = sim.byId[m.from]; x = n.x; y = n.y; } else { const A = sim.byId[hop.a], B = sim.byId[hop.b], f = Math.max(0, Math.min(1, (T - hop.t0) / (hop.t1 - hop.t0 || 1))); x = A.x + (B.x - A.x) * f; y = A.y + (B.y - A.y) * f; }
        let p = this.pool[k]; if (!p) { const g = this.el('g', { class: 'fl' }, this.gf); p = { g, c: this.el('circle', { r: 6 }, g), t: this.el('text', { y: -10 }, g) }; this.pool.push(p); }
        p.g.style.display = ''; p.g.setAttribute('transform', 'translate(' + x + ',' + y + ')'); p.g.setAttribute('class', 'fl' + (m.lost ? ' lost' : '')); p.c.setAttribute('fill', this.typeCol(m.type)); const lb = this.msgLabels && !many ? sim.label(m) : ''; if (p.t.textContent !== lb) p.t.textContent = lb; k++;
      }
      for (; k < this.pool.length; k++) if (this.pool[k].g.style.display !== 'none') this.pool[k].g.style.display = 'none';
    }
    drawRubber() { this.gr.innerHTML = ''; if (this.mode === 'link' && this.linkFrom && this.mouse) { const n = this.sim.byId[this.linkFrom]; this.el('line', { x1: n.x, y1: n.y, x2: this.mouse.x, y2: this.mouse.y, stroke: 'var(--ac)', 'stroke-width': 2.5, 'stroke-dasharray': '6 4' }, this.gr); } }

    bindCanvas() {
      const svg = this.svg; let drag = null, panning = null, moved = false;
      svg.addEventListener('pointerdown', e => {
        if (e.button === 2) return; svg.focus({ preventScroll: true }); moved = false;
        const nd = e.target.closest('.nd'), lk = e.target.closest('.lk'), w = this.world(e);
        if (nd) {
          const id = nd.dataset.id;
          if (this.mode === 'sel') { const n = this.sim.byId[id]; drag = { id, dx: n.x - w.x, dy: n.y - w.y }; svg.setPointerCapture(e.pointerId); }
          else if (this.mode === 'link') { if (!this.linkFrom) { this.linkFrom = id; this.say('Выберите второй узел для канала.'); } else if (this.linkFrom !== id) { const a = this.linkFrom; this.linkFrom = null; const lat = (this.scheme.links[0] && this.scheme.links[0].lat) || 150; this.edit(sc => sc.links.push({ a, b: id, lat, jit: 0, loss: 0 })); } this.drawRubber(); }
          else if (this.mode === 'del') this.deleteNode(id);
        } else if (lk) { const id = lk.dataset.id; if (this.mode === 'del') this.deleteLink(id); else { this.select({ t: 'link', id }); } }
        else {
          if (this.mode === 'add') { const kind = this.kindSel ? this.kindSel.value : (this.def.nodeKinds && this.def.nodeKinds[0] ? this.def.nodeKinds[0].id : undefined); this.edit(sc => { let k = sc.nodes.length + 1; while (sc.nodes.some(n => n.id === 'n' + k)) k++; sc.nodes.push({ id: 'n' + k, name: 'N' + k, x: Math.round(w.x), y: Math.round(w.y), kind, cfg: {} }); if (sc.nodes.length > 1) { const near = sc.nodes.slice(0, -1).sort((a, b) => Math.hypot(a.x - w.x, a.y - w.y) - Math.hypot(b.x - w.x, b.y - w.y)).slice(0, 2); near.forEach(nn => sc.links.push({ a: 'n' + k, b: nn.id, lat: (sc.links[0] && sc.links[0].lat) || 150, jit: 0, loss: 0 })); } }); }
          else { panning = { x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y, sel: true }; svg.setPointerCapture(e.pointerId); }
        }
      });
      svg.addEventListener('pointermove', e => {
        const w = this.world(e); this.mouse = w;
        if (drag) { moved = true; const n = this.sim.byId[drag.id], sn = this.nodeObj(drag.id), bn = this.base.nodes.find(x => x.id === drag.id); n.x = sn.x = bn.x = Math.round(w.x + drag.dx); n.y = sn.y = bn.y = Math.round(w.y + drag.dy); this.nEl[drag.id].g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')'); for (const l of this.sim.links) if (l.a === drag.id || l.b === drag.id) this.placeLink(l); }
        else if (panning) { if (Math.abs(e.clientX - panning.x) + Math.abs(e.clientY - panning.y) > 3) moved = true; this.pan.x = panning.px + e.clientX - panning.x; this.pan.y = panning.py + e.clientY - panning.y; this.applyPan(); }
        else if (this.linkFrom) this.drawRubber();
      });
      const up = e => {
        if (drag) { if (!moved) this.select({ t: 'node', id: drag.id }); else this.save(); drag = null; }
        else if (panning) { if (!moved && panning.sel) this.select(null); panning = null; }
      };
      svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
      svg.addEventListener('wheel', e => { e.preventDefault(); const r = svg.getBoundingClientRect(); this.zoomBy(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
      svg.addEventListener('contextmenu', e => { e.preventDefault(); const nd = e.target.closest('.nd'); if (nd) this.ctxMenu(nd.dataset.id, e.clientX, e.clientY); });
      svg.addEventListener('keydown', e => { if (e.key === 'Escape') { this.linkFrom = null; this.setMode('sel'); } });
    }
    select(s) { this.sel = s; if (s && this.tab !== 'node' && this.tab !== 'task') { this.tab = 'node'; } this.refreshSideTabs(); this.updateNodes(true); this.updateLinks(); }
    ctxMenu(id, x, y) {
      document.querySelectorAll('.ctxm').forEach(m => m.remove()); const n = this.sim.byId[id]; this.select({ t: 'node', id });
      const m = h('div', { class: 'ctxm', style: 'left:' + x + 'px;top:' + y + 'px' }, h('button', { text: n.up ? '⏻ Отказ узла ' + n.name : '⏻ Восстановить ' + n.name, onclick: () => { m.remove(); this.act(n.up ? 'crash' : 'recover', { node: id }); } }));
      for (const a of this.def.actions || []) m.append(h('button', { text: '👤 ' + a.label + '…', onclick: () => { m.remove(); this.tab = 'node'; this.refreshSideTabs(); const d = [...this.tabBody.querySelectorAll('details')].find(q => q.textContent.startsWith(a.label)); if (d) { d.open = true; d.scrollIntoView({ block: 'center' }); } } }));
      m.append(h('button', { text: 'Удалить узел', onclick: () => { m.remove(); this.deleteNode(id); } }));
      document.body.append(m); setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
    }
    deleteNode(id) { if (this.scheme.nodes.length <= 2) return ui.toast('В кластере должно остаться не меньше двух узлов', 'bad'); if (this.sel && this.sel.id === id) this.sel = null; this.edit(sc => { sc.nodes = sc.nodes.filter(n => n.id !== id); sc.links = sc.links.filter(l => l.a !== id && l.b !== id); }); }
    deleteLink(lid) { const l = this.sim.linkById[lid]; if (!l) return; this.sel = null; this.edit(sc => { sc.links = sc.links.filter(x => !((x.a === l.a && x.b === l.b) || (x.a === l.b && x.b === l.a))); }); }
    deleteSel() { if (!this.sel) return; if (this.sel.t === 'node') this.deleteNode(this.sel.id); else this.deleteLink(this.sel.id); }

    /* ---------- шаги и цикл ---------- */
    syncPlay() { this.btnPlay.textContent = this.playing ? '⏸ Пауза' : '▶ Пуск'; this.btnPlay.classList.toggle('on', this.playing); }
    toggle() { this.playing = !this.playing; this.last = performance.now(); this.syncPlay(); }
    stepFwd() { this.playing = false; this.syncPlay(); const t0 = this.sim.now, r = this.sim.step(); if (!r) { this.say('Очередь событий пуста: ничего не происходит. Создайте воздействие (действие клиента, отказ узла).'); return; } this.viewT = Math.min(this.viewT, r.t); const ev = r.logs.filter(l => l.k !== 'send').map(l => l.text); this.say('Событие ' + this.sim.evCount + ' · t = ' + (r.t / 1000).toFixed(3) + ' с: ' + (ev.join(' ▸ ') || r.logs.map(l => l.text).join(' ▸ '))); this.refreshAll(true); }
    stepBack() {
      this.playing = false; this.syncPlay(); const ev = this.sim.evCount; if (ev <= 0) return this.say('Это самое начало симуляции.');
      const hist = this.sim.hist.slice(); this.sim = ND.Sim.replay(ND.cleanScheme(this.base), hist, ev - 1); this.viewT = this.sim.now; this.lastLogShown = 0; this.logBody.innerHTML = '';
      const e = this.sim.log.filter(l => l.k !== 'send').slice(-1)[0]; this.say('Шаг назад: событие ' + this.sim.evCount + (e ? ' · ' + e.text : '')); this.refreshAll(true);
    }
    frame(ts) {
      if (this.destroyed) return; this.raf = requestAnimationFrame(t => this.frame(t));
      const dt = Math.min(100, ts - this.last); this.last = ts; const sim = this.sim;
      if (this.playing) { sim.runUntil(sim.now + dt * this.speed, 4000); this.viewT = sim.now; }
      else if (this.viewT < sim.now) this.viewT = Math.min(sim.now, this.viewT + Math.max(15, (sim.now - this.viewT) * 0.12) * (dt / 16));
      this.drawFlights(); this.updateNodes(false);
      if (this.nFrames = (this.nFrames || 0) + 1, this.nFrames % 4 === 0 || !this.playing) this.tick(ts);
    }
    tick(ts) {
      const sim = this.sim; this.clock.textContent = 't = ' + (sim.now / 1000).toFixed(3) + ' с · событий ' + sim.evCount;
      if (sim.log.length + sim.logBase !== this.lastLogN) { this.lastLogN = sim.log.length + sim.logBase; if (this.playing) { const e = [...sim.log].reverse().find(l => l.k === 'mark' || l.k === 'drop' || l.k === 'crash' || l.k === 'recover' || l.k === 'cut' || l.k === 'heal' || l.k === 'client'); if (e && e !== this.lastSay && ts - (this.sayT || 0) > 400) { this.lastSay = e; this.sayT = ts; this.say('t = ' + (e.t / 1000).toFixed(2) + ' с: ' + e.text); } } }
      if (ts - (this.slowT || 0) > (this.playing ? 300 : 150)) { this.slowT = ts; this.renderSide(false); this.refreshDock(false); if (this.task) this.checkTask(false); this.updateLinks(); }
    }
    refreshAll(force) { this.updateNodes(true); this.updateLinks(); this.renderSide(force); this.refreshDock(true); this.tick(performance.now()); if (this.task) this.checkTask(false); }

    /* ---------- задания ---------- */
    renderTask(force) {
      const t = this.task, b = this.tabBody; if (!t) return;
      if (force || !this.taskBuilt) { this.taskBuilt = true; b.innerHTML = ''; b.append(h('h3', { text: t.title }), h('div', { html: t.text || '' }), h('h4', { text: 'Цели (проверяются автоматически)' }), this.goalsBox = h('div'), h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn pri', text: 'Зачесть задание', onclick: () => this.checkTask(true) }), h('button', { class: 'btn', text: 'Подсказка', onclick: () => { this.hintN = (this.hintN || 0) + 1; ui.toast((t.hints || ['Подсказок нет'])[Math.min(this.hintN - 1, (t.hints || [1]).length - 1)], '', 8000); } }), h('button', { class: 'btn', text: 'К списку', onclick: () => ui.open('w:tasks') })), this.taskRes = h('div', { class: 'sm', style: 'margin-top:8px' })); this.goalSig = ''; }
      this.checkTask(false);
    }
    checkTask(commit) {
      const t = this.task; if (!t || !this.goalsBox) return; const sim = this.sim; let res = [];
      for (const g of t.goals) { let ok = false; try { ok = !!g.check(sim, this); } catch (e) { ok = false; } res.push({ t: g.t, ok, w: g.w || 1 }); }
      const sig = res.map(r => +r.ok).join('') + '|' + (sim.violations.length ? 1 : 0); if (sig !== this.goalSig) { this.goalSig = sig; this.goalsBox.innerHTML = res.map(r => '<div class="inv"><i class="' + (r.ok ? 'ok' : 'mt') + '">' + (r.ok ? '✔' : '○') + '</i><span>' + esc(r.t) + '</span></div>').join(''); }
      if (res.length && res.every(r => r.ok) && !this.taskDone) { this.taskDone = true; const r = ui.store.get('results', {}); r[t.id] = { done: true, t: Date.now(), score: 100 }; ui.store.set('results', r); ui.toast('Задание выполнено! ✔', 'ok'); }
      if (commit) { const got = res.reduce((a, r) => a + (r.ok ? r.w : 0), 0), tot = res.reduce((a, r) => a + r.w, 0), sc = Math.round(100 * got / tot); this.taskRes.innerHTML = 'Результат: <b>' + sc + '%</b> (' + got + ' из ' + tot + ')'; const r = ui.store.get('results', {}); if (!r[t.id] || (r[t.id].score || 0) < sc) { r[t.id] = { done: sc === 100, t: Date.now(), score: sc }; ui.store.set('results', r); } }
    }

    /* ---------- файлы и шаблоны ---------- */
    useTemplate(t) { const sc = t.build(); this.edit(s => { Object.assign(s, ND.cleanScheme(sc)); }, true); this.fit(); this.applyPan(); this.say('Загружен шаблон «' + t.title + '». ' + (t.desc || '')); if (t.script) { /* сценарий: набор консольных команд */ } this.refreshAll(true); }
    newScheme() { this.load(this.def.defaultScheme()); }
    saveFile() { const o = ND.clone(this.base); o.hist = ND.clone(this.sim.hist); ui.download('nodonia-' + this.pid + '.json', JSON.stringify(o, null, 1), 'application/json'); }
    openFile() { ui.pickFile('.json,application/json', txt => { try { const o = JSON.parse(txt); if (!o || o.app !== 'nodonia') throw new Error('это не файл Нодонии'); this.load(o); ui.toast('Схема загружена', 'ok'); } catch (e) { ui.toast('Не удалось открыть: ' + e.message, 'bad'); } }); }
    exportLog() { const rows = [['время_мс', 'тип', 'узел', 'текст']].concat(this.sim.log.map(e => [Math.round(e.t * 1000) / 1000, e.k, e.n || e.from || '', e.text || ''])); ui.download('nodonia-journal.csv', '﻿' + ui.csv(rows), 'text/csv;charset=utf-8'); }
    exportSvg() {
      const clone = this.svg.cloneNode(true); const css = ':root{--tx:#16202c;--mt:#5b6a7b;--pn:#fff;--cv:#f7f9fc;--gold:#f59e0b;--orange:#f97316;--blue:#3b82f6;--green:#22c55e;--gray:#94a3b8;--purple:#8b5cf6;--red:#ef4444;--teal:#14b8a6;--pink:#ec4899;--ac:#4f46e5;--ac2:#0d9488;--er:#dc2626}' + [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch (e) { return []; } }).filter(r => r.cssText && /^\.(nd|lk|fl)/.test(r.selectorText || '')).map(r => r.cssText).join('\n');
      clone.setAttribute('xmlns', NS); clone.setAttribute('width', this.svg.clientWidth); clone.setAttribute('height', this.svg.clientHeight); clone.style.background = '#f7f9fc'; const st = document.createElementNS(NS, 'style'); st.textContent = css; clone.prepend(st);
      ui.download('nodonia-' + this.pid + '.svg', '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone), 'image/svg+xml');
    }
    shareLink() { try { const s = ND.clone(this.scheme); delete s.hist; const b = btoa(unescape(encodeURIComponent(JSON.stringify(s)))); const url = location.href.split('#')[0] + '#s=' + b; if (url.length > 8000) return ui.toast('Схема слишком большая для ссылки — сохраните файл', 'bad'); navigator.clipboard.writeText(url).then(() => ui.toast('Ссылка скопирована', 'ok'), () => prompt('Скопируйте ссылку:', url)); } catch (e) { ui.toast('Не удалось создать ссылку', 'bad'); } }

    destroy() { this.destroyed = true; cancelAnimationFrame(this.raf); this.save(); }
  }

  ui.decodeShare = function (hash) { try { const m = /^#?s=(.+)$/.exec(hash); if (!m) return null; return ND.cleanScheme(JSON.parse(decodeURIComponent(escape(atob(m[1]))))); } catch (e) { return null; } };

  ui.registerWorkspace({
    id: 'cluster', title: 'Кластер', hidden: true,
    mount(root, opts) {
      const c = new Cluster(root, opts);
      const api = {
        inst: c, toggle: () => c.toggle(), stepFwd: () => c.stepFwd(), stepBack: () => c.stepBack(), resetSim: () => c.resetSim(), newSeed: () => c.newSeed(),
        undo: () => c.doUndo(), redo: () => c.doRedo(), deleteSel: () => c.deleteSel(), newScheme: () => c.newScheme(), saveFile: () => c.saveFile(), openFile: () => c.openFile(),
        exportLog: () => c.exportLog(), exportSvg: () => c.exportSvg(), shareLink: () => c.shareLink(), unmount: () => c.destroy(),
        getSim: () => c.sim, getScheme: () => c.scheme, load: (s, h2) => c.load(s, h2),
      };
      return api;
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
