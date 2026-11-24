/* Снимки экранов: node ui_shot.js out.png ключ [мс] [js-код после открытия] */
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errs = []; pg.on('pageerror', e => errs.push('PAGEERR ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await pg.goto('file://' + path.resolve(__dirname, '../nodonia/index.html')); await pg.waitForTimeout(300);
  await pg.evaluate(k => ND.ui.open(k), process.argv[3]); await pg.waitForTimeout(400);
  if (process.argv[5]) { await pg.evaluate(process.argv[5]); }
  await pg.waitForTimeout(+process.argv[4] || 500); await pg.screenshot({ path: process.argv[2] });
  console.log(errs.length ? errs.join('\n') : 'ok'); await b.close();
})();
