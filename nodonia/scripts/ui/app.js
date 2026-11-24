/* Нодония — оболочка: меню, левая навигация, рабочие области, темы, справка, горячие клавиши. */
(function (G) {
  'use strict';
  const ND = G.ND, ui = ND.ui, h = ui.h, esc = ND.esc;
  ui.GROUP_ORDER = ['Основы', 'Распространение и согласование', 'Консенсус', 'Транзакции и репликация', 'Данные и маршрутизация', 'Блокчейн', 'Архитектуры', 'Практика'];
  const spaces = {};
  ui.registerWorkspace = def => { spaces[def.id] = def; ND.reg.workspaces.push(def); return def; };
  ui.cur = null; ui.curKey = null;

  /* ---------- каталог: протоколы кластера + прочие области ---------- */
  ui.catalog = function () {
    const items = [];
    for (const id in ND.reg.protocols) { const p = ND.reg.protocols[id]; items.push({ key: 'p:' + id, title: p.title, group: p.group || 'Основы', short: p.short || '', order: p.order || 50, kind: 'кластер' }); }
    for (const id in spaces) { const w = spaces[id]; if (w.hidden) continue; items.push({ key: 'w:' + id, title: w.title, group: w.group || 'Основы', short: w.short || '', order: w.order || 50, kind: w.group === 'Практика' ? 'практика' : 'лаборатория' }); }
    items.sort((a, b) => ui.GROUP_ORDER.indexOf(a.group) - ui.GROUP_ORDER.indexOf(b.group) || a.order - b.order || a.title.localeCompare(b.title, 'ru'));
    return items;
  };
  function buildRail() {
    const rail = ui.$('#rail'); rail.innerHTML = '';
    rail.append(h('button', { 'data-k': 'w:home', onclick: () => ui.open('w:home') }, h('i'), 'Начало'));
    let g = null;
    for (const it of ui.catalog()) {
      if (it.group !== g) { g = it.group; rail.append(h('h5', { text: g })); }
      rail.append(h('button', { 'data-k': it.key, title: it.short, onclick: () => ui.open(it.key) }, h('i'), it.title));
    }
  }
  function markRail() { ui.$$('#rail button').forEach(b => b.classList.toggle('on', b.dataset.k === ui.curKey)); }

  /** открыть область: 'p:raft' (протокол в кластере) или 'w:id' (рабочая область); opts передаются в mount */
  ui.open = function (key, opts) {
    const root = ui.$('#ws');
    if (ui.cur && ui.cur.unmount) { try { ui.cur.unmount(); } catch (e) { console.error(e); } }
    ui.cur = null; root.innerHTML = ''; ui.curKey = key;
    let def, o = Object.assign({}, opts);
    if (key.startsWith('p:')) { def = spaces.cluster; o.proto = key.slice(2); } else def = spaces[key.slice(2)];
    if (!def) { key = 'w:home'; ui.curKey = key; def = spaces.home; }
    document.title = (key.startsWith('p:') ? ND.reg.protocols[o.proto].title : def.title) + ' — Нодония';
    try { ui.cur = def.mount(root, o) || {}; } catch (e) { console.error(e); root.append(h('div', { class: 'page' }, h('div', { class: 'callout bad', text: 'Ошибка при открытии раздела: ' + e.message }))); }
    ui.cur.key = key; markRail();
    try { history.replaceState(null, '', '#' + key.replace(':', '=')); } catch (e) { }
    ui.store.set('last', key);
    document.body.classList.remove('rail-open');
    ui.$('#ws').scrollTop = 0;
  };
  ui.reopen = () => ui.open(ui.curKey);

  /* ---------- темы ---------- */
  function setTheme(t) { if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); if (t) ui.store.set('theme', t); }
  ui.toggleTheme = () => { const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); setTheme(cur === 'dark' ? 'light' : 'dark'); };

  /* ---------- меню ---------- */
  const call = (name, ...a) => { if (ui.cur && ui.cur[name]) return ui.cur[name](...a); ui.toast('Это действие недоступно в текущем разделе'); };
  const MENUS = () => [
    ['Файл', [
      ['Новая схема', () => call('newScheme'), ''], ['Открыть схему или сеанс…', () => call('openFile'), 'Ctrl+O'], ['Сохранить схему и сеанс…', () => call('saveFile'), 'Ctrl+S'], '-',
      ['Журнал событий (CSV)', () => call('exportLog')], ['Снимок схемы (SVG)', () => call('exportSvg')], ['Скопировать ссылку на схему', () => call('shareLink')], '-',
      ['Сбросить все сохранённые данные…', async () => { if (await ui.confirm('Удалить сохранённые схемы, результаты заданий и настройки из этого браузера?', 'Удалить')) { Object.keys(localStorage).filter(k => k.startsWith('nd.')).forEach(k => localStorage.removeItem(k)); location.reload(); } }],
    ]],
    ['Правка', [['Отменить', () => call('undo'), 'Ctrl+Z'], ['Вернуть', () => call('redo'), 'Ctrl+Y'], ['Удалить выбранное', () => call('deleteSel'), 'Del']]],
    ['Симуляция', [['Пуск / пауза', () => call('toggle'), 'Пробел'], ['Шаг вперёд', () => call('stepFwd'), '→'], ['Шаг назад', () => call('stepBack'), '←'], ['Начать заново', () => call('resetSim'), 'R'], '-', ['Перемешать seed (другой «случай»)', () => call('newSeed')]]],
    ['Практика', [['Лабораторные работы', () => ui.open('w:labs')], ['Задания с автопроверкой', () => ui.open('w:tasks')], ['Экзамен', () => ui.open('w:exam')], ['Тест по теории', () => ui.open('w:quiz')], ['Глоссарий', () => ui.open('w:glossary')]]],
    ['Справка', [['Инструкция', () => ui.showHelp(), 'F1'], ['Горячие клавиши', () => ui.showKeys()], ['Подсказки «?» вкл/выкл', () => { document.body.classList.toggle('nohelp'); ui.store.set('nohelp', document.body.classList.contains('nohelp')); }], ['Светлая / тёмная тема', () => ui.toggleTheme()], '-', ['О программе', () => ui.showAbout()]]],
  ];
  function buildTop() {
    const top = ui.$('#top'); top.innerHTML = '';
    top.append(h('button', { id: 'burger', class: 'ib', 'aria-label': 'Разделы', text: '☰', onclick: () => document.body.classList.toggle('rail-open') }));
    top.append(h('a', { class: 'logo', href: '#w=home', onclick: e => { e.preventDefault(); ui.open('w:home'); }, html: '<svg viewBox="0 0 32 32"><g stroke="#8b93ff" stroke-width="2" fill="none"><path d="M16 5 6 11v10l10 6 10-6V11z"/><path d="M6 11l10 6 10-6M16 17v10"/></g><g fill="#2dd4bf"><circle cx="16" cy="5" r="3"/><circle cx="6" cy="11" r="2.4"/><circle cx="26" cy="11" r="2.4"/><circle cx="6" cy="21" r="2.4"/><circle cx="26" cy="21" r="2.4"/><circle cx="16" cy="27" r="3"/></g></svg><span>Нодония</span>' }));
    for (const [title, items] of MENUS()) {
      const dd = h('div', { class: 'dd' });
      for (const it of items) dd.append(it === '-' ? h('hr') : h('button', { onclick: () => { close(); it[1](); } }, h('span', { text: it[0] }), it[2] ? h('kbd', { text: it[2] }) : null));
      const m = h('div', { class: 'menu' }, h('button', { text: title, 'aria-haspopup': 'true', onclick: e => { e.stopPropagation(); const o = m.classList.contains('open'); close(); if (!o) m.classList.add('open'); } }), dd);
      top.append(m);
    }
    top.append(h('span', { class: 'sp' }));
    top.append(h('button', { class: 'ib', title: 'Подсказки «?»', 'aria-label': 'Подсказки', html: '?', onclick: () => { document.body.classList.toggle('nohelp'); ui.store.set('nohelp', document.body.classList.contains('nohelp')); } }));
    top.append(h('button', { class: 'ib', title: 'Тема', 'aria-label': 'Сменить тему', html: '◐', onclick: () => ui.toggleTheme() }));
    function close() { ui.$$('.menu.open').forEach(x => x.classList.remove('open')); }
    document.addEventListener('click', close);
  }

  /* ---------- справка ---------- */
  ui.showHelp = function (id) {
    const secs = ND.reg.help; if (!secs.length) return ui.toast('Справка не загружена');
    const body = h('div', { style: 'display:grid;grid-template-columns:200px 1fr;gap:16px' });
    const nav = h('div', { style: 'border-right:1px solid var(--bd);padding-right:10px' }), cont = h('div');
    const show = s => { cont.innerHTML = '<h2 style="margin-top:0">' + esc(s.title) + '</h2>' + s.html; ui.$$('button', nav).forEach(b => b.classList.toggle('on', b.dataset.id === s.id)); };
    secs.forEach(s => nav.append(h('button', { class: 'btn sm', 'data-id': s.id, style: 'display:block;width:100%;margin:3px 0;text-align:left', text: s.title, onclick: () => show(s) })));
    body.append(nav, cont); show(secs.find(s => s.id === id) || secs[0]);
    ui.modal({ title: 'Инструкция', body, size: 'wide' });
  };
  ui.showKeys = () => ui.modal({ title: 'Горячие клавиши', body: ui.table(['Клавиша', 'Действие'], [['Пробел', 'пуск / пауза симуляции'], ['→ / ←', 'шаг вперёд / назад (на одно событие)'], ['R', 'начать симуляцию заново'], ['Ctrl+Z / Ctrl+Y', 'отменить / вернуть правку схемы'], ['Del', 'удалить выбранный узел или канал'], ['Ctrl+S / Ctrl+O', 'сохранить / открыть схему'], ['F1', 'инструкция'], ['Esc', 'закрыть окно, отменить режим'], ['Правая кнопка на узле', 'отказ, восстановление, действия клиента']]) });
  ui.showAbout = () => ui.modal({ title: 'О программе', body: '<p><b>Нодония</b> — открытый учебный симулятор распределённых систем и блокчейна. Версия ' + ND.version + '.</p><p>Всё работает в вашем браузере: без сервера, регистрации и сборки. Сеансы воспроизводимы: одинаковая схема и seed дают одинаковый ход событий.</p><p class="mt">Лицензия AGPL-3.0-or-later. Модели учебные: они показывают принципы, а не заменяют промышленные реализации (в частности, криптография здесь — для обучения, не для защиты реальных средств).</p>' });

  /* ---------- начальная страница ---------- */
  ui.registerWorkspace({
    id: 'home', title: 'Начало', group: '', hidden: true,
    mount(root) {
      const items = ui.catalog().filter(i => i.group !== 'Практика'), groups = {};
      items.forEach(i => (groups[i.group] = groups[i.group] || []).push(i));
      const page = h('div', { class: 'page' });
      page.append(h('h2', { text: 'Нодония: как устроены распределённые системы и блокчейн' }),
        h('p', { class: 'mt', style: 'max-width:760px', html: 'Лаборатория в браузере. Соберите кластер, запустите протокол, оборвите связь, остановите узел — и увидите, <b>почему</b> система ведёт себя именно так. Каждый прогон воспроизводим: можно шагать по событиям, отматывать назад и объяснять результат.' }));
      page.append(h('div', { class: 'row', style: 'margin:12px 0 18px' },
        h('button', { class: 'btn pri', text: '▶ Начать с Raft', onclick: () => ui.open('p:raft') }),
        h('button', { class: 'btn', text: 'Лабораторные работы', onclick: () => ui.open('w:labs') }),
        h('button', { class: 'btn', text: 'Задания с автопроверкой', onclick: () => ui.open('w:tasks') }),
        h('button', { class: 'btn', text: 'Инструкция', onclick: () => ui.showHelp() })));
      for (const g of ui.GROUP_ORDER) if (groups[g]) {
        page.append(h('h3', { text: g }));
        page.append(h('div', { class: 'cols' }, groups[g].map(i => h('div', { class: 'card', style: 'cursor:pointer', tabindex: 0, role: 'button', onclick: () => ui.open(i.key), onkeydown: e => { if (e.key === 'Enter') ui.open(i.key); } }, h('b', { text: i.title }), h('div', { class: 'mt sm', style: 'margin-top:4px', text: i.short })))));
      }
      root.append(page); return {};
    },
  });

  /* ---------- запуск ---------- */
  ui.boot = function () {
    if (ui.store.get('theme')) setTheme(ui.store.get('theme'));
    if (ui.store.get('nohelp')) document.body.classList.add('nohelp');
    buildTop(); buildRail();
    document.addEventListener('keydown', e => {
      const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === 'F1') { e.preventDefault(); ui.showHelp(); return; }
      if ((e.ctrlKey || e.metaKey) && !typing) {
        const k = e.key.toLowerCase();
        if (k === 'z') { e.preventDefault(); call('undo'); } else if (k === 'y') { e.preventDefault(); call('redo'); } else if (k === 's') { e.preventDefault(); call('saveFile'); } else if (k === 'o') { e.preventDefault(); call('openFile'); }
        return;
      }
      if (typing || e.altKey) return;
      if (e.key === ' ') { if (ui.cur && ui.cur.toggle) { e.preventDefault(); ui.cur.toggle(); } }
      else if (e.key === 'ArrowRight') { if (ui.cur && ui.cur.stepFwd) { e.preventDefault(); ui.cur.stepFwd(); } }
      else if (e.key === 'ArrowLeft') { if (ui.cur && ui.cur.stepBack) { e.preventDefault(); ui.cur.stepBack(); } }
      else if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') { if (ui.cur && ui.cur.resetSim) ui.cur.resetSim(); }
      else if (e.key === 'Delete') { if (ui.cur && ui.cur.deleteSel) ui.cur.deleteSel(); }
    });
    let key = null; const hs = location.hash.replace(/^#/, '');
    if (/^[pw]=[A-Za-z0-9_-]+$/.test(hs)) key = hs.replace('=', ':');
    else if (/^s=/.test(hs)) { const sc = ui.decodeShare ? ui.decodeShare(hs) : null; if (sc) { ui.pendingScheme = sc; key = 'p:' + sc.proto; } }
    if (!key) key = ui.store.get('last', null) || 'w:home';
    const ok = k => k.startsWith('p:') ? !!ND.reg.protocols[k.slice(2)] : !!spaces[k.slice(2)];
    ui.open(ok(key) ? key : 'w:home');
    addEventListener('hashchange', () => { const m = /^#([pw])=([A-Za-z0-9_-]+)$/.exec(location.hash); if (m && ok(m[1] + ':' + m[2]) && ui.curKey !== m[1] + ':' + m[2]) ui.open(m[1] + ':' + m[2]); });
  };
  document.addEventListener('DOMContentLoaded', () => { if (document.getElementById('ws')) ui.boot(); });
})(typeof window !== 'undefined' ? window : globalThis);
