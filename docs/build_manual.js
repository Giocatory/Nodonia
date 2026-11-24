/* Генератор пособия: NODE_PATH=<global npm> node docs/build_manual.js  → docs/Пособие_Нодония.docx */
const fs = require('fs'), path = require('path');
const D = require('docx');
const { load, CORE, manifest } = require('../tests/load.js');
const fsl = fs.readdirSync(path.join(__dirname, '../nodonia/scripts/content')).filter(f => f.endsWith('.js')).sort();
const ordered = ['templates.js', ...fsl.filter(f => f !== 'templates.js')];
const C = load([...CORE, 'scripts/core/ecdsa.js', ...manifest(['proto']), 'scripts/ui/ws-attack.js', 'scripts/ui/ws-arch.js', ...ordered.map(f => 'scripts/content/' + f)]);
const ND = C.ND, R = ND.reg, THEORY = require('./manual_theory.js');
const FONT = 'Calibri', MONO = 'Consolas', ACC = '3B5BDB';
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
/* inline HTML → TextRun[] */
function runs(html, base = {}) {
  const out = []; let b = false, sup = false, code = false, i = false; const re = /<(\/?)(b|strong|sup|code|kbd|i|em|br)\s*\/?>|([^<]+)/g; let m;
  html = String(html).replace(/<a [^>]*>|<\/a>/g, '');
  while ((m = re.exec(html))) {
    if (m[3] !== undefined) { const t = unesc(m[3]); if (t) out.push(new D.TextRun(Object.assign({ text: t, bold: b || base.bold, superScript: sup, italics: i || base.italics, font: code ? MONO : (base.font || FONT), size: code ? 20 : base.size, color: code ? '1F3A93' : base.color, shading: code ? { type: D.ShadingType.CLEAR, fill: 'EEF1FB' } : undefined }))); }
    else { const close = !!m[1], t = m[2]; if (t === 'b' || t === 'strong') b = !close; else if (t === 'sup') sup = !close; else if (t === 'code' || t === 'kbd') code = !close; else if (t === 'i' || t === 'em') i = !close; else if (t === 'br') out.push(new D.TextRun({ break: 1 })); }
  }
  return out;
}
const P = (html, o = {}) => new D.Paragraph(Object.assign({ children: runs(html, o.run), spacing: { after: 120, line: 300 }, alignment: o.center ? D.AlignmentType.CENTER : D.AlignmentType.JUSTIFIED }, o.p || {}));
const heads = []; const H = (t, level) => { if (level !== D.HeadingLevel.HEADING_3) heads.push([level === D.HeadingLevel.HEADING_1 ? 1 : 2, t]); return new D.Paragraph({ heading: level, children: [new D.TextRun({ text: t })], keepNext: true }); };
const H1 = t => { heads.push([1, t]); return new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new D.TextRun({ text: t })] }); };
const H2 = t => H(t, D.HeadingLevel.HEADING_2), H3 = t => H(t, D.HeadingLevel.HEADING_3);
const bullet = (html, lvl = 0) => new D.Paragraph({ children: runs(html), numbering: { reference: 'bul', level: lvl }, spacing: { after: 60, line: 288 } });
let numRef = 0; const numberings = [];
function numbered(items) { const ref = 'num' + (++numRef); numberings.push({ reference: ref, levels: [{ level: 0, format: D.LevelFormat.DECIMAL, text: '%1.', alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] }); return items.map(h => new D.Paragraph({ children: runs(h), numbering: { reference: ref, level: 0 }, spacing: { after: 70, line: 288 } })); }
/* блочный HTML (p/ul/ol) → Paragraph[] */
function blocks(html) {
  const out = []; const re = /<(p|ul|ol)>([\s\S]*?)<\/\1>|([^<][^<]*)/g; let m;
  while ((m = re.exec(html || ''))) {
    if (m[3] !== undefined) { if (m[3].trim()) out.push(P(m[3].trim())); continue; }
    if (m[1] === 'p') out.push(P(m[2])); else { const items = [...m[2].matchAll(/<li>([\s\S]*?)<\/li>/g)].map(x => x[1]); if (m[1] === 'ul') items.forEach(x => out.push(bullet(x))); else out.push(...numbered(items)); }
  }
  return out;
}
const border = { style: D.BorderStyle.SINGLE, size: 4, color: 'C9D1E8' }, borders = { top: border, bottom: border, left: border, right: border };
function table(head, rows, widths) {
  const total = 9360, w = widths || head.map(() => Math.floor(total / head.length));
  const cell = (t, i, hd) => new D.TableCell({ borders, width: { size: w[i], type: D.WidthType.DXA }, shading: hd ? { type: D.ShadingType.CLEAR, fill: 'E8EDFB' } : undefined, margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new D.Paragraph({ children: runs(String(t), { bold: hd, size: 20 }), spacing: { after: 0 } })] });
  return new D.Table({ width: { size: w.reduce((a, b) => a + b, 0), type: D.WidthType.DXA }, columnWidths: w, rows: [new D.TableRow({ tableHeader: true, children: head.map((t, i) => cell(t, i, true)) }), ...rows.map(r => new D.TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, i)) }))] });
}
const box = (title, items, fill = 'F3F6FF') => new D.Table({ width: { size: 9360, type: D.WidthType.DXA }, columnWidths: [9360], rows: [new D.TableRow({ children: [new D.TableCell({ borders: { top: border, bottom: border, right: border, left: { style: D.BorderStyle.SINGLE, size: 24, color: ACC } }, width: { size: 9360, type: D.WidthType.DXA }, shading: { type: D.ShadingType.CLEAR, fill }, margins: { top: 100, bottom: 100, left: 160, right: 160 }, children: [new D.Paragraph({ children: [new D.TextRun({ text: title, bold: true, color: ACC })], spacing: { after: 60 } }), ...items.map(x => new D.Paragraph({ children: runs('• ' + x), spacing: { after: 40, line: 276 } }))] })] })] });
const gap = () => new D.Paragraph({ children: [], spacing: { after: 120 } });
const LV = { 1: 'базовый', 2: 'средний', 3: 'продвинутый' };
const ch = []; // содержимое

/* --- титул --- */
const title = [
  new D.Paragraph({ spacing: { before: 2600 }, alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: 'НОДОНИЯ', bold: true, size: 96, color: ACC, font: FONT })] }),
  new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 200 }, children: [new D.TextRun({ text: 'Распределённые системы и блокчейн', size: 40, font: FONT })] }),
  new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 100 }, children: [new D.TextRun({ text: 'Учебно-методическое пособие по работе в симуляторе', size: 30, color: '555555', font: FONT })] }),
  new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 1400 }, children: [new D.TextRun({ text: 'Теория · Лабораторные работы · Задания с автопроверкой · Контроль знаний · Глоссарий', size: 24, font: FONT })] }),
  new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 2600 }, children: [new D.TextRun({ text: 'Автор: Giocatory · github.com/Giocatory', size: 22, font: FONT })] }),
  new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: 'Лицензия GNU AGPL-3.0-or-later · 2026', size: 22, color: '555555', font: FONT })] }),
];
let PAGES = {}; try { PAGES = JSON.parse(fs.readFileSync(path.join(__dirname, 'toc_pages.json'), 'utf8')); } catch (e) {}
const mkToc = () => [new D.Paragraph({ pageBreakBefore: true, children: [new D.TextRun({ text: 'Содержание', bold: true, size: 36, color: ACC })], spacing: { after: 200 } }), ...heads.map(([l, t], i) => new D.Paragraph({ tabStops: [{ type: D.TabStopType.RIGHT, position: 9300, leader: D.LeaderType.DOT }], indent: { left: l === 1 ? 0 : 360 }, spacing: { after: l === 1 ? 60 : 20, before: l === 1 ? 100 : 0 }, children: [new D.TextRun({ text: t, bold: l === 1, size: l === 1 ? 22 : 20 }), new D.TextRun({ text: '\t' + (PAGES[i] || '0'), size: 20 })] }))];

/* --- предисловие --- */
ch.push(H1('Предисловие'),
  P('Распределённые системы лежат в основе почти всего, чем мы пользуемся: интернет-магазинов, мессенджеров, банковских систем, облачных хранилищ, а также блокчейнов и криптовалют. Они работают на множестве машин, соединённых ненадёжной сетью, и главная их особенность — отказы здесь норма, а не исключение. Понять, как такие системы договариваются о едином решении, как они реплицируют данные и что происходит в момент сбоя, по текстам и слайдам почти невозможно: нужно увидеть и «сломать» их своими руками.'),
  P('Для этого создана <b>Нодония</b> — симулятор, работающий целиком в браузере на обычных HTML, CSS и JavaScript, без сервера, установки и регистрации. В нём узлы обмениваются сообщениями по сети с задержками и потерями; вы можете останавливать узлы, рвать каналы, делить сеть на части, отправлять запросы и наблюдать, как реагируют Raft, Paxos, PBFT, gossip, CRDT, двухфазная фиксация, сети Proof of Work и Proof of Stake, смарт-контракты и архитектуры сервисов. Время в симуляторе виртуальное и детерминированное: любой эксперимент можно повторить с тем же результатом или перемотать назад.'),
  H2('Для кого и как пользоваться пособием'),
  P('Пособие рассчитано на студентов колледжей и вузов (информационная безопасность, системное и сетевое администрирование, программирование, информационные системы), преподавателей и инженеров, которым нужно освежить или упорядочить знания о распределённых системах.'),
  ...[`<b>Часть I «Работа с симулятором»</b> — устройство интерфейса, консоль, сбои, инварианты, файлы. Прочитайте её первой.`, `<b>Часть II «Теория»</b> — ${THEORY.length} глав: от часов Лэмпорта и консенсуса до PoW, смарт-контрактов и архитектурных паттернов. Каждая глава заканчивается ключевыми мыслями и ссылками на лабораторные.`, `<b>Часть III «Практикум»</b> — ${R.labs.length} лабораторных работ с целью, теорией, шагами и вопросами для самопроверки.`, `<b>Часть IV «Задания с автопроверкой»</b> — ${R.tasks.length} задач, где симулятор сам проверяет результат.`, `<b>Часть V «Контроль знаний»</b> — ${R.quiz.length} тестовых вопросов с ключом и критерии экзамена.`, '<b>Приложения</b> — команды консоли, шаблоны схем, каталог архитектурных паттернов, глоссарий и литература.'].map(bullet),
  H2('Рекомендуемая последовательность'),
  P('Для первого знакомства достаточно пройти лабораторные в порядке номеров: основы → консенсус → данные и репликация → блокчейн → архитектуры. Каждая работа занимает 25–45 минут. Для курса из 36–72 часов преподаватель может комбинировать: теоретическую главу, соответствующую лабораторную работу, затем задание с автопроверкой и тест. Итоговую аттестацию удобно проводить через раздел «Экзамен».'),
  box('Важное предупреждение', ['Нодония — учебная модель. Протоколы упрощены (нет диска, сжатия журналов, реальных размеров сетей), а криптография работает в браузере и <b>не предназначена для защиты реальных данных и средств</b>.', 'Названия технологий (Raft, Paxos, Bitcoin, Ethereum, Kafka, Cassandra и другие) принадлежат их владельцам и используются только для описания идей.'], 'FFF8E6'));

/* --- Часть I --- */
ch.push(H1('Часть I. Работа с симулятором'));
for (const h of R.help) { ch.push(H2(h.title), ...blocks(h.html)); }
ch.push(H2('Что вы увидите в левой колонке'), P('Разделы сгруппированы по темам: «Основы», «Распространение и согласование», «Консенсус», «Транзакции и репликация», «Данные и маршрутизация», «Блокчейн», «Архитектуры» и «Практика». В группе «Практика» находятся лабораторные работы, задания, тест, экзамен и глоссарий.'));
const groups = {}; Object.values(R.protocols).forEach(p => (groups[p.group] = groups[p.group] || []).push(p));
ch.push(table(['Протокол или модель', 'Группа', 'Кратко'], Object.values(R.protocols).sort((a, b) => ND.ui ? 0 : 0).map(p => [p.title, p.group, p.short]), [2700, 2200, 4460]));

/* --- Часть II --- */
ch.push(H1('Часть II. Теория'));
THEORY.forEach((c, i) => {
  ch.push(H2((i + 1) + '. ' + c.t)); c.p.forEach(x => ch.push(P(x))); ch.push(gap(), box('Ключевые мысли', c.k));
  const labs = (c.lab || []).map(id => R.labs.find(l => l.id === id)).filter(Boolean); if (labs.length) ch.push(gap(), P('<b>Лабораторные по теме:</b> ' + labs.map(l => '«' + l.title + '»').join('; ') + '.'));
});

/* --- Часть III --- */
ch.push(H1('Часть III. Практикум'));
ch.push(P('Каждая работа устроена одинаково: цель, краткая теория, ход работы (шаги в симуляторе) и вопросы для самопроверки с ответами. В конце — рекомендации по оформлению отчёта. Команды в консоли указаны в формате <code>команда</code>; идентификаторы узлов (n1, n2…) подставляйте свои.'));
const order = ND.ui && ND.ui.GROUP_ORDER ? ND.ui.GROUP_ORDER : ['Основы', 'Распространение и согласование', 'Консенсус', 'Транзакции и репликация', 'Данные и маршрутизация', 'Блокчейн', 'Архитектуры', 'Практика'];
const lg = {}; R.labs.forEach(l => (lg[l.group] = lg[l.group] || []).push(l)); let ln = 0; const labIdx = [];
[...order, ...Object.keys(lg).filter(g => !order.includes(g))].filter((g, i, a) => lg[g] && a.indexOf(g) === i).forEach(g => {
  ch.push(H2(g));
  lg[g].forEach(l => {
    ln++; labIdx.push([ln, l.title, LV[l.level], (l.time || 20) + ' мин']);
    ch.push(H3('Лабораторная работа №' + ln + '. ' + l.title), P('<i>Уровень: ' + (LV[l.level] || '') + ' · время: ~' + (l.time || 20) + ' мин · раздел симулятора: ' + (R.protocols[l.proto] ? R.protocols[l.proto].title : (l.ws ? 'рабочая область «' + l.ws + '»' : '')) + (l.template ? ' · шаблон: ' + (R.templates.find(t => t.id === l.template) || { title: l.template }).title : '') + '</i>'),
      box('Цель', [l.goal]), gap(), P('<b>Теоретические сведения</b>'), ...blocks(l.theory), P('<b>Ход работы</b>', { p: { keepNext: true } }), ...numbered(l.steps), P('<b>Вопросы для самопроверки</b>', { p: { keepNext: true } }),
      ...l.questions.flatMap((q, k) => [new D.Paragraph({ children: [new D.TextRun({ text: (k + 1) + '. ', bold: true }), ...runs(q[0])], spacing: { after: 40 }, keepNext: true }), new D.Paragraph({ children: [new D.TextRun({ text: 'Ответ: ', italics: true, color: '2F7D4F', bold: true }), ...runs(q[1], { italics: true })], indent: { left: 360 }, spacing: { after: 100 } })]),
      P('<b>Отчёт:</b> опишите ход эксперимента (параметры, seed, действия), приведите наблюдения (скриншот диаграммы или журнала) и сформулируйте вывод: какое свойство алгоритма вы проверили и чем оно обеспечивается.'));
  });
});
ch.push(H2('Сводная таблица лабораторных'), table(['№', 'Название', 'Уровень', 'Время'], labIdx, [700, 5660, 1700, 1300]));

/* --- Часть IV --- */
ch.push(H1('Часть IV. Задания с автопроверкой'));
ch.push(P('Задание открывает симулятор с готовой схемой; во вкладке «Задание» отображаются цели. Они отмечаются автоматически, когда условие выполнено в вашем эксперименте. Если задание не решается, воспользуйтесь подсказками; если цель не отмечается — проверьте, что вы сделали <b>сброс</b> после смены параметров, и что симуляция идёт (кнопка ▶ или команда <code>run</code>). Результаты хранятся в браузере.'));
R.tasks.forEach((t, i) => {
  ch.push(H3((i + 1) + '. ' + t.title), P('<i>Протокол: ' + ((R.protocols[t.proto] || {}).title || t.proto) + ' · уровень: ' + LV[t.level] + '</i>'), P(t.text), P('<b>Цели (проверяются автоматически):</b>', { p: { keepNext: true } }), ...t.goals.map(g => bullet(g.t + ' <i>(вес ' + g.w + ')</i>')), P('<b>Подсказки:</b>', { p: { keepNext: true } }), ...t.hints.map(h => bullet(h)));
});

/* --- Часть V --- */
ch.push(H1('Часть V. Контроль знаний'));
ch.push(H2('Тест по теории'), P('Раздел «Тест» симулятора выдаёт случайные вопросы из банка с мгновенным разбором ошибок. Ниже — весь банк с ключом: его удобно использовать для печатных контрольных работ. Варианты ответов в симуляторе перемешиваются, а в пособии расположены в фиксированном порядке.'));
const topics = [...new Set(R.quiz.map(q => q.topic))]; let qn = 0; const key = [];
topics.forEach(tp => {
  ch.push(H3(tp));
  R.quiz.filter(q => q.topic === tp).forEach(q => {
    qn++; const pos = qn % 4, opts = [...q.a.slice(1)]; opts.splice(pos, 0, q.a[0]); key.push([qn, 'АБВГ'[pos]]);
    ch.push(new D.Paragraph({ children: [new D.TextRun({ text: qn + '. ', bold: true }), ...runs(q.q, { bold: true })], spacing: { before: 100, after: 40 }, keepNext: true, keepLines: true }), ...opts.map((o, k) => new D.Paragraph({ children: [new D.TextRun({ text: 'АБВГ'[k] + ') ' }), ...runs(o)], indent: { left: 400 }, spacing: { after: 20 }, keepNext: k < 3, keepLines: true })));
  });
});
ch.push(H2('Ключ к тесту'));
const cols = 8, kr = []; for (let i = 0; i < key.length; i += cols) kr.push(key.slice(i, i + cols).map(x => x[0] + '—' + x[1]).concat(Array(cols).fill('')).slice(0, cols));
ch.push(table(Array(cols).fill('Ответы'), kr, Array(cols).fill(1170)));
ch.push(H2('Пояснения к ответам'));
let en = 0; R.quiz.forEach(q => { en++; ch.push(new D.Paragraph({ children: [new D.TextRun({ text: en + '. ', bold: true }), ...runs(q.why || '', { size: 21 })], spacing: { after: 40, line: 264 } })); });
ch.push(H2('Экзамен'), P('Раздел «Экзамен» формирует билет из 25 случайных вопросов, поровну по темам. Критерии оценки: <b>85% и выше — «5»</b>, <b>70–84% — «4»</b>, <b>50–69% — «3»</b>, ниже 50% — «2». Результат хранится в браузере студента; преподаватель может попросить показать экран с итогом либо распечатать страницу результата. Для расширенной аттестации сочетайте экзамен с практическими заданиями из части IV (например, задания уровня 3 оцениваются отдельно).'));

/* --- Приложения --- */
ch.push(H1('Приложение А. Команды консоли'));
const cmds = [['help', 'список команд'], ['nodes', 'список узлов и их состояние'], ['links', 'список каналов'], ['status', 'краткое состояние симуляции и метрики'], ['state nX', 'внутреннее состояние узла'], ['crash nX', 'остановить узел'], ['recover nX', 'запустить узел'], ['cut nA nB', 'оборвать канал'], ['heal [nA nB]', 'восстановить канал (без аргументов — все)'], ['partition n1,n2 | n3,n4', 'разделить сеть на группы'], ['link nA nB lat=… jit=… loss=…', 'изменить параметры канала'], ['cfg nX ключ значение', 'настройка узла'], ['param ключ значение', 'параметр протокола'], ['actions', 'действия клиента протокола'], ['do действие арг=знач', 'выполнить действие клиента'], ['run СЕК', 'продвинуть время'], ['step', 'выполнить одно событие'], ['at СЕК команда', 'запланировать команду'], ['log', 'журнал событий'], ['inv', 'проверка инвариантов'], ['reset', 'сбросить симуляцию'], ['seed N', 'сменить seed']];
ch.push(P('Команды чувствительны к порядку аргументов. Все они записываются в историю, поэтому «шаг назад» и воспроизведение работают и для консольных действий.'), table(['Команда', 'Что делает'], cmds, [3600, 5760]));
ch.push(H1('Приложение Б. Шаблоны схем'));
ch.push(P('Шаблоны выбираются в списке «Шаблоны…» на панели инструментов рабочей области протокола.'), table(['Протокол', 'Шаблон', 'Описание'], R.templates.map(t => [(R.protocols[t.proto] || {}).title || t.proto, t.title, t.desc || '']), [2300, 2760, 4300]));
ch.push(H1('Приложение В. Каталог архитектурных паттернов'));
ND.arch.patterns.forEach(p => { ch.push(H3(p.n + ' (' + p.c + ')'), P('<b>Проблема.</b> ' + p.p), P('<b>Идея.</b> ' + p.i), P('<b>Плюсы.</b> ' + p.pr), P('<b>Цена.</b> ' + p.co), P('<b>Подходит:</b> ' + p.use + ' <b>Не подходит:</b> ' + p.no)); });
ch.push(H1('Приложение Г. Глоссарий'));
R.glossary.slice().sort((a, b) => a.term.localeCompare(b.term, 'ru')).forEach(g => ch.push(new D.Paragraph({ children: [new D.TextRun({ text: g.term + '. ', bold: true, color: ACC }), ...runs(g.def)], spacing: { after: 80, line: 276 } })));
ch.push(H1('Приложение Д. Рекомендуемая литература'));
['Lamport L. Time, Clocks, and the Ordering of Events in a Distributed System // Communications of the ACM, 1978.', 'Fischer M., Lynch N., Paterson M. Impossibility of Distributed Consensus with One Faulty Process // Journal of the ACM, 1985.', 'Lamport L. Paxos Made Simple, 2001.', 'Ongaro D., Ousterhout J. In Search of an Understandable Consensus Algorithm (Raft), 2014.', 'Castro M., Liskov B. Practical Byzantine Fault Tolerance, 1999.', 'DeCandia G. et al. Dynamo: Amazon’s Highly Available Key-value Store, 2007.', 'Shapiro M. et al. Conflict-free Replicated Data Types, 2011.', 'Hayashibara N. et al. The φ Accrual Failure Detector, 2004.', 'Karger D. et al. Consistent Hashing and Random Trees, 1997.', 'Stoica I. et al. Chord: A Scalable Peer-to-peer Lookup Service for Internet Applications, 2001.', 'Maymounkov P., Mazières D. Kademlia: A Peer-to-peer Information System Based on the XOR Metric, 2002.', 'Nakamoto S. Bitcoin: A Peer-to-Peer Electronic Cash System, 2008.', 'Eyal I., Sirer E. G. Majority is not Enough: Bitcoin Mining is Vulnerable, 2013.', 'Rosenfeld M. Analysis of Hashrate-Based Double Spending, 2014.', 'Kleppmann M. Designing Data-Intensive Applications. O’Reilly, 2017.', 'Tanenbaum A., van Steen M. Distributed Systems: Principles and Paradigms.'].forEach(x => ch.push(bullet(x)));

const doc = new D.Document({
  creator: 'Giocatory', title: 'Нодония: пособие', description: 'Учебно-методическое пособие по распределённым системам и блокчейну',
  styles: { default: { document: { run: { font: FONT, size: 22 } } }, paragraphStyles: [
    { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 40, bold: true, font: FONT, color: ACC }, paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 } },
    { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: true, font: FONT, color: '1F2A5C' }, paragraph: { spacing: { before: 320, after: 140 }, outlineLevel: 1 } },
    { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 25, bold: true, font: FONT, color: '33415C' }, paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 2 } } ] },
  numbering: { config: [{ reference: 'bul', levels: [{ level: 0, format: D.LevelFormat.BULLET, text: '•', alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }, { level: 1, format: D.LevelFormat.BULLET, text: '–', alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 1000, hanging: 270 } } } }] }, ...numberings] },
  
  sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1417 } }, titlePage: true },
    footers: { default: new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: 'Нодония · ', color: '888888', size: 18 }), new D.TextRun({ children: [D.PageNumber.CURRENT], color: '888888', size: 18 })] })] }), first: new D.Footer({ children: [] }) },
    children: [...title, ...mkToc(), ...ch] }],
});
fs.writeFileSync(path.join(__dirname, 'toc_heads.json'), JSON.stringify(heads));
D.Packer.toBuffer(doc).then(b => { fs.writeFileSync(path.join(__dirname, 'Пособие_Нодония.docx'), b); console.log('OK', (b.length / 1024).toFixed(0) + ' КБ'); });
