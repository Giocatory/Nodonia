/* Нодония — практика: лабораторные, задания с автопроверкой, тест, экзамен, глоссарий. */
(function (G) {
  'use strict';
  const ND = G.ND, ui = ND.ui, h = ui.h, esc = ND.esc, R = ND.reg;
  const res = () => ui.store.get('results', {}) || {}, setRes = (id, v) => { const r = res(); r[id] = v; ui.store.set('results', r); };
  const LV = { 1: 'базовый', 2: 'средний', 3: 'продвинутый' };
  const protoTitle = id => (R.protocols[id] && R.protocols[id].title) || id;
  const shuffle = (a, rng) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function openLab(l) {
    if (l.template) { const t = R.templates.find(x => x.id === l.template); if (t) { ui.open('p:' + t.proto, { scheme: t.build() }); return; } }
    if (l.ws) { ui.open('w:' + l.ws); return; }
    if (l.proto) ui.open('p:' + l.proto);
  }

  /* ---------- лабораторные ---------- */
  ui.registerWorkspace({
    id: 'labs', title: 'Лабораторные работы', group: 'Практика', order: 1, short: 'Пошаговые работы с теорией, действиями в симуляторе и вопросами для самопроверки.',
    mount(root, opts) {
      const page = h('div', { class: 'page' }); root.append(page);
      const list = () => {
        page.innerHTML = ''; const done = res(), groups = {};
        R.labs.forEach(l => { const g = l.group || 'Прочее'; (groups[g] = groups[g] || []).push(l); });
        page.append(h('h2', { text: 'Лабораторные работы' }), h('p', { class: 'mt', style: 'max-width:760px', text: 'Каждая работа: цель, краткая теория, шаги в симуляторе и вопросы. Отметка «сделано» хранится в вашем браузере. Выполнено: ' + R.labs.filter(l => done['lab:' + l.id]).length + ' из ' + R.labs.length + '.' }));
        const order = ui.GROUP_ORDER.concat(Object.keys(groups).filter(g => !ui.GROUP_ORDER.includes(g)));
        order.filter(g => groups[g]).forEach(g => {
          page.append(h('h3', { text: g })); const grid = h('div', { class: 'grid2' });
          groups[g].forEach(l => grid.append(h('div', { class: 'card', style: 'cursor:pointer', onclick: () => show(l) }, h('div', { class: 'mt', text: (LV[l.level] || '') + ' · ' + (l.time || 20) + ' мин' }), h('h3', { style: 'margin:2px 0 6px', text: (done['lab:' + l.id] ? '✔ ' : '') + l.title }), h('p', { class: 'mt', text: l.goal || '' }))));
          page.append(grid);
        });
      };
      function show(l) {
        page.innerHTML = ''; const done = res();
        const chk = h('input', { type: 'checkbox', onchange: () => setRes('lab:' + l.id, chk.checked ? { done: true, t: Date.now() } : null) }); chk.checked = !!done['lab:' + l.id];
        page.append(h('a', { href: '#', text: '← все работы', onclick: e => { e.preventDefault(); list(); } }), h('h2', { text: l.title }), h('div', { class: 'mt', text: (LV[l.level] || '') + ' · ~' + (l.time || 20) + ' мин · ' + protoTitle(l.proto || l.ws) }),
          h('div', { class: 'callout', html: '<b>Цель.</b> ' + esc(l.goal || '') }), h('h3', { text: 'Теория' }), h('div', { html: l.theory || '' }),
          h('div', { class: 'row', style: 'margin:12px 0' }, h('button', { class: 'btn pri', text: 'Открыть стенд', onclick: () => openLab(l) })),
          h('h3', { text: 'Ход работы' }), h('ol', null, ...(l.steps || []).map(s => h('li', { html: s }))), h('h3', { text: 'Вопросы для самопроверки' }),
          ...(l.questions || []).map(q => { const [qq, aa] = Array.isArray(q) ? q : [q.q, q.a]; return h('details', { class: 'card' }, h('summary', { html: esc(qq) }), h('p', { html: aa })); }),
          h('label', { class: 'chk', style: 'margin-top:14px' }, chk, ' Работа выполнена'));
      }
      const first = opts && opts.lab && R.labs.find(l => l.id === opts.lab); first ? show(first) : list(); return {};
    },
  });

  /* ---------- задания с автопроверкой ---------- */
  ui.registerWorkspace({
    id: 'tasks', title: 'Задания с автопроверкой', group: 'Практика', order: 2, short: 'Соберите или почините систему; симулятор сам проверяет, достигнуты ли цели.',
    mount(root) {
      const page = h('div', { class: 'page' }); root.append(page); const done = res();
      page.append(h('h2', { text: 'Задания с автопроверкой' }), h('p', { class: 'mt', style: 'max-width:760px', text: 'Задание открывает симулятор с готовой схемой. Во вкладке «Задание» — цели; галочки появляются сами, когда условие выполнено в вашем эксперименте. Выполнено: ' + R.tasks.filter(t => done[t.id] && done[t.id].done).length + ' из ' + R.tasks.length + '.' }));
      const grid = h('div', { class: 'grid2' });
      R.tasks.forEach(t => { const d = done[t.id]; grid.append(h('div', { class: 'card', style: 'cursor:pointer', onclick: () => ui.open('p:' + t.proto, { scheme: t.scheme(), task: t }) }, h('div', { class: 'mt', text: protoTitle(t.proto) + ' · ' + (LV[t.level] || '') }), h('h3', { style: 'margin:2px 0 6px', text: (d && d.done ? '✔ ' : '') + t.title }), h('p', { class: 'mt', html: t.text }))); });
      page.append(grid); return {};
    },
  });

  /* ---------- тест и экзамен ---------- */
  function runQuiz(box, qs, o) {
    let i = 0, score = 0, t0 = Date.now(); const per = {}, wrong = [];
    const next = () => {
      box.innerHTML = ''; if (i >= qs.length) return fin(); const q = qs[i];
      const order = shuffle([0, 1, 2, 3].slice(0, q.a.length), Math.random), fb = h('div'); let answered = false;
      box.append(h('div', { class: 'mt', text: 'Вопрос ' + (i + 1) + ' из ' + qs.length + ' · ' + q.topic }), h('h3', { html: esc(q.q) }),
        ...order.map(k => { const b = h('button', { class: 'btn', style: 'display:block;width:100%;text-align:left;margin:6px 0', html: esc(q.a[k]), onclick: () => {
          if (answered) return; answered = true; const okk = k === q.c; per[q.topic] = per[q.topic] || [0, 0]; per[q.topic][1]++; if (okk) { score++; per[q.topic][0]++; } else wrong.push(q);
          b.style.outline = '2px solid ' + (okk ? 'var(--ok)' : 'var(--er)'); fb.innerHTML = '<div class="callout ' + (okk ? '' : 'bad') + '"><b>' + (okk ? 'Верно.' : 'Неверно.') + '</b> ' + (okk ? '' : 'Правильный ответ: «' + esc(q.a[q.c]) + '». ') + esc(q.why || '') + '</div>';
          fb.append(h('button', { class: 'btn', text: i + 1 < qs.length ? 'Дальше' : 'Результат', onclick: () => { i++; next(); } })); } }); return b; }), fb);
    };
    const fin = () => {
      const pct = Math.round(100 * score / qs.length), sec = Math.round((Date.now() - t0) / 1000); box.innerHTML = '';
      box.append(h('h2', { text: 'Результат: ' + score + ' из ' + qs.length + ' (' + pct + '%)' }), h('p', { class: 'mt', text: 'Время: ' + Math.floor(sec / 60) + ' мин ' + sec % 60 + ' с' }),
        ui.table(['Тема', 'Верно'], Object.keys(per).map(k => [k, per[k][0] + ' из ' + per[k][1]])));
      if (wrong.length) box.append(h('h3', { text: 'Разберите ошибки' }), ...wrong.map(q => h('div', { class: 'card' }, h('b', { html: esc(q.q) }), h('p', { html: 'Ответ: ' + esc(q.a[q.c]) + '. ' + esc(q.why || '') }))));
      if (o.onDone) o.onDone(pct, per);
      box.append(h('div', { class: 'row' }, h('button', { class: 'btn', text: 'Ещё раз', onclick: () => o.again() }), h('button', { class: 'btn', text: 'Печать результата', onclick: () => window.print() })));
    };
    next();
  }
  ui.registerWorkspace({
    id: 'quiz', title: 'Тест по теории', group: 'Практика', order: 3, short: 'Вопросы с мгновенным разбором: консенсус, блокчейн, архитектуры.',
    mount(root) {
      const page = h('div', { class: 'page' }), box = h('div'); root.append(page);
      const topics = [...new Set(R.quiz.map(q => q.topic))], sel = h('select', { class: 'inp' }, h('option', { value: '', text: 'Все темы' }), ...topics.map(t => h('option', { value: t, text: t }))), cnt = h('select', { class: 'inp' }, ...[10, 20, 40].map(n => h('option', { value: n, text: n + ' вопросов' })));
      const start = () => { const pool = R.quiz.filter(q => !sel.value || q.topic === sel.value); runQuiz(box, shuffle(pool, Math.random).slice(0, +cnt.value), { again: start, onDone: p => { const r = res(); const b = (r.quizBest || {}).pct || 0; if (p > b) setRes('quizBest', { pct: p, t: Date.now() }); } }); };
      page.append(h('h2', { text: 'Тест по теории' }), h('p', { class: 'mt', text: 'В банке ' + R.quiz.length + ' вопросов. После каждого ответа показывается разбор.' }), h('div', { class: 'row' }, sel, cnt, h('button', { class: 'btn pri', text: 'Начать', onclick: start })), box); return {};
    },
  });
  ui.registerWorkspace({
    id: 'exam', title: 'Экзамен', group: 'Практика', order: 4, short: 'Итоговая проверка: 25 случайных вопросов из всех тем, оценка и разбор.',
    mount(root) {
      const page = h('div', { class: 'page' }), box = h('div'); root.append(page); const name = h('input', { class: 'inp', placeholder: 'Фамилия, группа', style: 'max-width:280px', value: ui.store.get('examName', '') });
      const start = () => { ui.store.set('examName', name.value); const topics = [...new Set(R.quiz.map(q => q.topic))], pick = []; const pool = {}; topics.forEach(t => pool[t] = shuffle(R.quiz.filter(q => q.topic === t), Math.random));
        while (pick.length < Math.min(25, R.quiz.length) && topics.some(t => pool[t].length)) topics.forEach(t => { if (pick.length < 25 && pool[t].length) pick.push(pool[t].pop()); });
        runQuiz(box, shuffle(pick, Math.random), { again: start, onDone: p => { const grade = p >= 85 ? '5' : p >= 70 ? '4' : p >= 50 ? '3' : '2'; setRes('exam', { pct: p, grade, t: Date.now() }); box.prepend(h('div', { class: 'callout' }, h('b', { text: (name.value || 'Студент') + ': оценка ' + grade + ' (' + p + '%) · ' + new Date().toLocaleDateString('ru-RU') }))); } }); };
      const last = res().exam; page.append(h('h2', { text: 'Экзамен' }), h('p', { class: 'mt', style: 'max-width:700px', text: '25 вопросов по всем темам поровну. Критерии: 85% и выше — «5», 70% — «4», 50% — «3». Подсказок нет, но после ответа показывается разбор.' + (last ? ' Последний результат: ' + last.pct + '% (оценка ' + last.grade + ').' : '') }), h('div', { class: 'row' }, name, h('button', { class: 'btn pri', text: 'Начать экзамен', onclick: start })), box); return {};
    },
  });

  /* ---------- глоссарий ---------- */
  ui.registerWorkspace({
    id: 'glossary', title: 'Глоссарий', group: 'Практика', order: 5, short: 'Термины распределённых систем и блокчейна, по алфавиту, с поиском.',
    mount(root) {
      const page = h('div', { class: 'page' }), list = h('div'), inp = h('input', { class: 'inp', placeholder: 'Поиск термина…', style: 'max-width:320px' }); root.append(page);
      const draw = () => { list.innerHTML = ''; const q = inp.value.toLowerCase(); R.glossary.slice().sort((a, b) => a.term.localeCompare(b.term, 'ru')).filter(g => !q || (g.term + ' ' + g.def).toLowerCase().includes(q)).forEach(g => list.append(h('div', { class: 'card' }, h('b', { text: g.term }), h('p', { html: g.def })))); if (!list.children.length) list.append(h('p', { class: 'mt', text: 'Ничего не найдено' })); };
      inp.addEventListener('input', draw); page.append(h('h2', { text: 'Глоссарий (' + R.glossary.length + ')' }), inp, list); draw(); return {};
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
