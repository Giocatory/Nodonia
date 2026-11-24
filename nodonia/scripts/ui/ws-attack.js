/* Нодония — расчёты безопасности блокчейна: двойная трата, selfish mining, форки, эмиссия и сложность. Чистая математика — в ND.attackMath. */
(function (G) {
  'use strict';
  const ND = G.ND;
  /* ---------------- математика (без DOM) ---------------- */
  const M = ND.attackMath = {
    /** вероятность, что атакующий с долей q догонит цепь после z подтверждений (Накамото, 2008) */
    nakamoto(q, z) { const p = 1 - q; if (q >= p) return 1; const lam = z * (q / p); let s = 1, f = 1; for (let k = 0; k <= z; k++) { if (k > 0) f *= k; const poi = Math.exp(-lam) * Math.pow(lam, k) / f; s -= poi * (1 - Math.pow(q / p, z - k)); } return Math.max(0, s); },
    /** Монте-Карло: гонка цепей */
    simDouble(q, z, runs, rng) {
      let win = 0; for (let r = 0; r < runs; r++) { let hon = 0, att = 0; while (hon < z) { if (rng.chance(q)) att++; else hon++; } let d = z - att, steps = 0; while (d > 0 && steps < 400) { d += rng.chance(q) ? -1 : 1; steps++; } if (d <= 0) win++; }
      return win / runs;
    },
    /** доля блоков selfish-пула по формуле Эйяля–Сирера */
    selfishFormula(a, g) { const num = a * Math.pow(1 - a, 2) * (4 * a + g * (1 - 2 * a)) - Math.pow(a, 3), den = 1 - a * (1 + (2 - a) * a); return num / den; },
    selfishThreshold(g) { return (1 - g) / (3 - 2 * g); },
    /** Монте-Карло автомата Эйяля–Сирера: относительная доля пула в итоговой цепи */
    selfishSim(a, g, steps, rng) {
      let L = 0, race = false, pool = 0, hon = 0;
      for (let i = 0; i < steps; i++) {
        const pf = rng.chance(a);
        if (race) { if (pf) { pool += 2; } else if (rng.chance(g)) { pool += 1; hon += 1; } else { hon += 2; } race = false; L = 0; continue; }
        if (L === 0) { if (pf) L = 1; else hon++; }
        else if (L === 1) { if (pf) L = 2; else race = true; }
        else if (L === 2) { if (pf) L = 3; else { pool += 2; L = 0; } }
        else { if (pf) L++; else { pool += 1; L--; } }
      }
      pool += L; return pool / Math.max(1, pool + hon);
    },
    /** вероятность устаревшего блока при задержке распространения d и интервале T */
    staleProb(d, T) { return 1 - Math.exp(-d / T); },
    staleSim(d, T, n, rng) { let t = 0, stale = 0, prev = null; for (let i = 0; i < n; i++) { t += rng.exp(T); if (prev !== null && t - prev < d) stale++; prev = t; } return stale / n; },
    /** суммарная эмиссия после n блоков (награда reward, халвинг каждые H блоков) */
    supply(n, reward, H) { let s = 0, r = reward, left = n; while (left > 0 && r > 1e-8) { const k = Math.min(left, H); s += k * r; left -= k; r /= 2; } return s; },
    /** подстройка сложности: хэшрейт задаётся функцией hr(day); возвращает [[день, интервал блока (мин)], ...] */
    difficulty(opts, rng) {
      const win = opts.window, T = opts.target, out = []; let diff = opts.hr(0) * T, t = 0, blocks = 0, winStart = 0, curDay = 0, sum = 0, cnt = 0, hrN = 0;
      while (t < opts.days * 86400) { const hr = opts.hr(t / 86400), dt = rng.exp(diff / hr); t += dt; blocks++; sum += dt; cnt++; hrN = hr; if (blocks % win === 0) { const actual = t - winStart, ratio = Math.min(4, Math.max(0.25, (win * T) / actual)); diff *= ratio; winStart = t; } const day = Math.floor(t / 86400); if (day !== curDay) { if (cnt) out.push([curDay, sum / cnt / 60, hrN, diff / T]); curDay = day; sum = 0; cnt = 0; } }
      return out;
    },
  };

  /* ---------------- интерфейс ---------------- */
  if (!ND.ui || !ND.ui.registerWorkspace) return;
  const ui = ND.ui, h = ui.h, esc = ND.esc;
  let tab = 'double';
  const num = (id, label, v, min, max, step, hint) => ({ id, label, v, min, max, step, hint });
  ui.registerWorkspace({
    id: 'attack', title: 'Атаки и экономика сети', group: 'Блокчейн', order: 70, short: 'Двойная трата, selfish mining, форки, халвинг и сложность — с формулами и Монте-Карло.',
    mount(root) {
      const page = h('div', { class: 'page' }); root.append(page);
      const tabs = h('div', { class: 'tabs', style: 'margin-bottom:12px' }), body = h('div');
      const T = [['double', 'Двойная трата'], ['selfish', 'Selfish mining'], ['fork', 'Форки и задержка'], ['emit', 'Эмиссия и халвинг'], ['diff', 'Подстройка сложности']];
      page.append(h('h2', { text: 'Безопасность и экономика блокчейна' }), tabs, body);
      function show(k) { tab = k; tabs.innerHTML = ''; T.forEach(([id, t]) => tabs.append(h('button', { class: id === tab ? 'on' : '', text: t, onclick: () => show(id) }))); body.innerHTML = ''; PAGES[k](body); }
      function form(box, fields, run, text) {
        const vals = {}, f = h('div', { class: 'row', style: 'align-items:end;margin:10px 0' });
        fields.forEach(x => { vals[x.id] = x.v; f.append(ui.field({ id: x.id, label: x.label, type: 'number', def: x.v, min: x.min, max: x.max, step: x.step, hint: x.hint }, x.v, v => vals[x.id] = v)); });
        const out = h('div'); f.append(h('button', { class: 'btn pri', text: 'Пересчитать', onclick: () => run(vals, out) })); box.append(h('p', { class: 'mt', style: 'max-width:860px', html: text }), f, out); run(vals, out);
      }
      const PAGES = {
        double(box) {
          form(box, [num('q', 'Доля хэшрейта атакующего q', 0.3, 0.01, 0.49, 0.01, 'какую долю мощности сети контролирует атакующий'), num('zmax', 'Подтверждений до', 12, 1, 30, 1, 'до какого числа подтверждений строить график'), num('runs', 'Прогонов Монте-Карло', 2000, 200, 20000, 100, 'чем больше, тем гладче')], (v, out) => {
            const f = [], s = []; for (let z = 0; z <= v.zmax; z++) f.push([z, M.nakamoto(v.q, z)]); out.innerHTML = '<p class="mt">Считаю симуляцию…</p>'; const rng = new ND.RNG(11); let z = 1; const loop = () => { const t0 = Date.now(); while (z <= v.zmax && Date.now() - t0 < 25) { s.push([z, M.simDouble(v.q, z, v.runs, rng)]); z++; } if (z <= v.zmax) { setTimeout(loop, 0); } else draw(); }; const draw = () => { out.innerHTML = '<div class="chartbox">' + ui.chart({ series: [{ name: 'формула Накамото', pts: f }, { name: 'Монте-Карло', pts: s, dots: true, dash: true }], xl: 'подтверждений z', yl: 'P(успех атаки)', ymax: 1, ymin: 0, xf: x => x, yf: y => ui.pct(y), title: 'Вероятность двойной траты' }) + '</div><p class="mt sm">При q = ' + ui.pct(v.q) + ' и z = 6 вероятность успеха ≈ <b>' + ui.pct(M.nakamoto(v.q, 6)) + '</b>. Чтобы риск был ниже 0,1%, магазину нужно ждать <b>' + (() => { for (let k = 0; k < 200; k++) if (M.nakamoto(v.q, k) < 0.001) return k; return '>200'; })() + '</b> подтверждений.</p>'; }; setTimeout(loop, 0);
          }, '<b>Двойная трата</b>: атакующий платит магазину, а потом втайне строит цепь, где этой оплаты нет, и публикует её, когда она длиннее. Вероятность догнать честную цепь после z подтверждений падает экспоненциально с z, пока q &lt; 50%. При q ≥ 50% успех гарантирован (атака 51%).');
        },
        selfish(box) {
          form(box, [num('g', 'γ — доля честных, пошедших за пулом при ничьей', 0.5, 0, 1, 0.1, '0 — сеть всегда верит честным; 1 — всегда верит пулу'), num('steps', 'Блоков на точку (МК)', 20000, 2000, 200000, 2000, 'длина симуляции')], (v, out) => {
            const pts = [], sim = [], diag = []; const rng = new ND.RNG(5); for (let a = 0.05; a <= 0.451; a += 0.025) { pts.push([+a.toFixed(3), M.selfishFormula(a, v.g)]); sim.push([+a.toFixed(3), M.selfishSim(a, v.g, v.steps, rng)]); diag.push([+a.toFixed(3), a]); }
            out.innerHTML = '<div class="chartbox">' + ui.chart({ series: [{ name: 'честный майнинг (y = x)', pts: diag, dash: true, color: 'var(--mt)' }, { name: 'selfish: формула', pts }, { name: 'selfish: симуляция', pts: sim, dots: true, color: 'var(--red)' }], xl: 'доля хэшрейта пула α', yl: 'доля награды', xf: x => ui.pct(x), yf: y => ui.pct(y), ymin: 0, title: 'Selfish mining' }) + '</div><p class="mt sm">Порог прибыльности при γ = ' + v.g + ': <b>α &gt; ' + ui.pct(M.selfishThreshold(v.g)) + '</b>. Выше линии y = x выгоднее скрывать блоки, чем играть честно.</p>';
          }, '<b>Selfish mining</b> (Эйяль и Сирер): пул прячет найденные блоки и раскрывает их в нужный момент, заставляя честных майнеров тратить мощность на проигравшие ветви. Награда пула становится больше его доли хэшрейта.');
        },
        fork(box) {
          form(box, [num('T', 'Интервал блока T, с', 600, 1, 3600, 1, 'целевое время между блоками'), num('dmax', 'Задержка до, с', 30, 1, 300, 1, 'максимальное время распространения блока'), num('n', 'Блоков на точку (МК)', 20000, 1000, 200000, 1000, '')], (v, out) => {
            const f = [], s = [], rng = new ND.RNG(3); for (let i = 1; i <= 24; i++) { const d = v.dmax * i / 24; f.push([+d.toFixed(2), M.staleProb(d, v.T)]); s.push([+d.toFixed(2), M.staleSim(d, v.T, v.n, rng)]); }
            out.innerHTML = '<div class="chartbox">' + ui.chart({ series: [{ name: 'формула 1−e^(−Δ/T)', pts: f }, { name: 'симуляция', pts: s, dots: true, color: 'var(--red)', dash: true }], xl: 'задержка распространения Δ, с', yl: 'доля устаревших блоков', xf: x => x, yf: y => ui.pct(y), ymin: 0, title: 'Устаревшие блоки' }) + '</div><p class="mt sm">При T = ' + v.T + ' с и Δ = 10 с доля устаревших ≈ <b>' + ui.pct(M.staleProb(10, v.T)) + '</b>. Поэтому сети с быстрыми блоками (секунды) требуют иных правил (GHOST, DAG) или страдают от форков.</p>';
          }, 'Если два майнера находят блок, пока первый блок ещё распространяется, возникает <b>форк</b>, и один из блоков становится устаревшим (stale/orphan). Чем больше задержка Δ относительно интервала блока T, тем чаще форки и тем слабее безопасность (мощность тратится впустую).');
        },
        emit(box) {
          form(box, [num('r', 'Начальная награда', 50, 1, 1000, 1, 'в монетах за блок'), num('H', 'Блоков между халвингами', 210000, 1000, 1000000, 1000, 'как часто награда уменьшается вдвое'), num('years', 'Лет', 40, 4, 140, 4, 'горизонт графика при 10-минутных блоках')], (v, out) => {
            const per = 52560, pts = [], rew = []; for (let y = 0; y <= v.years; y += 1) { pts.push([y, M.supply(y * per, v.r, v.H)]); rew.push([y, v.r / Math.pow(2, Math.floor(y * per / v.H))]); }
            out.innerHTML = '<div class="grid2"><div class="chartbox">' + ui.chart({ series: [{ name: 'выпущено', pts }], xl: 'год', yl: 'монет', yf: y => (y / 1e6).toFixed(1) + ' млн', title: 'Эмиссия' }) + '</div><div class="chartbox">' + ui.chart({ series: [{ name: 'награда за блок', pts: rew, color: 'var(--ac2)' }], xl: 'год', yl: 'монет за блок', title: 'Награда' }) + '</div></div><p class="mt sm">Предел эмиссии: <b>' + (v.r * v.H * 2).toLocaleString('ru') + '</b> монет (сумма геометрической прогрессии: награда × период × 2). Когда награда исчезнет, майнеры будут жить на комиссиях — вопрос устойчивости безопасности.</p>';
          }, '<b>Эмиссия</b> в стиле Bitcoin: награда за блок вдвое уменьшается каждые 210 000 блоков (≈ 4 года), поэтому общее предложение стремится к пределу.');
        },
        diff(box) {
          form(box, [num('win', 'Окно подстройки, блоков', 2016, 20, 5000, 1, 'как часто пересчитывается сложность'), num('drop', 'Падение хэшрейта на 30-й день, %', 50, 0, 90, 5, 'внезапный уход майнеров'), num('days', 'Дней', 90, 30, 365, 10, '')], (v, out) => {
            const rng = new ND.RNG(9); const r = M.difficulty({ window: v.win, target: 600, days: v.days, hr: d => (d < 30 ? 100 : 100 * (1 - v.drop / 100)) }, rng); const pts = r.map(x => [x[0], x[1]]), hr = r.map(x => [x[0], x[2]]), df = r.map(x => [x[0], x[3]]);
            out.innerHTML = '<div class="grid2"><div class="chartbox">' + ui.chart({ series: [{ name: 'интервал блока, мин', pts }], xl: 'день', yl: 'минут', ymin: 0, title: 'Интервал блоков' }) + '</div><div class="chartbox">' + ui.chart({ series: [{ name: 'хэшрейт', pts: hr, color: 'var(--ac2)' }, { name: 'сложность (в ед. хэшрейта)', pts: df, color: 'var(--gold)' }], xl: 'день', yl: 'условные единицы', ymin: 0, title: 'Хэшрейт и сложность' }) + '</div></div><p class="mt sm">После ухода майнеров блоки замедляются, пока не завершится окно подстройки; затем сложность падает и интервал возвращается к 10 минутам.</p>';
          }, '<b>Подстройка сложности</b> удерживает среднее время блока постоянным при любом хэшрейте: каждые N блоков сложность умножается на отношение целевого времени к фактическому (с ограничением ×4).');
        },
      };
      show(tab); return {};
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
