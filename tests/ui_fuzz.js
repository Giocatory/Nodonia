/* Клик-фаззинг: в каждом разделе нажать все видимые кнопки, переключить все select, ввести значения в поля; собрать ошибки. */
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const url = 'file://' + path.resolve(__dirname, '../nodonia/index.html');
  const b = await chromium.launch(); const errs = [];
  const sizes = [{ width: 1440, height: 900 }, { width: 390, height: 800 }];
  for (const vp of sizes) {
    const pg = await b.newPage({ viewport: vp });
    pg.on('pageerror', e => errs.push(vp.width + ' PAGEERR ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(vp.width + ' CONSOLE ' + m.text()); });
    pg.on('dialog', d => d.dismiss().catch(() => {}));
    await pg.goto(url); await pg.waitForTimeout(300);
    const keys = await pg.$$eval('#rail button', bs => bs.map(b => b.dataset.k));
    for (const k of keys) {
      await pg.evaluate(k => ND.ui.open(k), k); await pg.waitForTimeout(150);
      for (let round = 0; round < 2; round++) {
        const n = await pg.evaluate(() => document.querySelectorAll('main button, #main button, .ws button, .stage button').length);
        const cnt = Math.min(n, 60);
        for (let i = 0; i < cnt; i++) {
          try {
            const bad = await pg.evaluate(i => { const bs = [...document.querySelectorAll('main button, #main button, .ws button, .stage button')]; const el = bs[i]; if (!el || el.disabled || /удал|очист|сброс.*всё/i.test(el.textContent)) return 1; if (el.closest('#rail')) return 1; el.click(); return 0; }, i);
            if (!bad) await pg.waitForTimeout(15);
          } catch (e) { errs.push(vp.width + ' ' + k + ' click#' + i + ' ' + e.message.slice(0, 100)); }
        }
        await pg.evaluate(() => { for (const s of document.querySelectorAll('main select, .ws select, .stage select')) { const o = [...s.options]; if (o.length) { s.selectedIndex = Math.floor(Math.random() * o.length); s.dispatchEvent(new Event('change', { bubbles: true })); } } for (const i of document.querySelectorAll('main input[type=range], .ws input[type=range]')) { i.value = i.min; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); i.value = i.max; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); } for (const i of document.querySelectorAll('main input[type=text], main input:not([type]), main textarea, .ws input[type=text], .ws textarea')) { for (const v of ['', 'abc', '0', '-1', '99999999999', '😀', '<b>x</b>']) { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); } } });
        await pg.waitForTimeout(100);
      }
      const ov = await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      if (ov && vp.width < 500) errs.push(vp.width + ' ' + k + ' горизонтальный скролл страницы');
    }
    await pg.close();
  }
  console.log(errs.length ? [...new Set(errs)].slice(0, 40).join('\n') : 'БЕЗ ОШИБОК'); await b.close(); process.exit(errs.length ? 1 : 0);
})();
