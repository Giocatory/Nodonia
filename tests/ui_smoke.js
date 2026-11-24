/* Playwright: открыть симулятор, пройти по всем разделам, собрать ошибки консоли. */
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const url = 'file://' + path.resolve(__dirname, '../nodonia/index.html');
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push('PAGEERR ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await pg.goto(url); await pg.waitForTimeout(400);
  const keys = await pg.$$eval('#rail button', bs => bs.map(b => b.dataset.k));
  console.log('разделов:', keys.length);
  for (const k of keys) { await pg.evaluate(k => ND.ui.open(k), k); await pg.waitForTimeout(250); if (/^p:/.test(k)) { await pg.keyboard.press('Space'); await pg.waitForTimeout(500); await pg.keyboard.press('Space'); } }
  console.log(errs.length ? errs.slice(0, 20).join('\n') : 'БЕЗ ОШИБОК');
  if (process.argv[2]) { await pg.evaluate(k => ND.ui.open(k), process.argv[3] || 'p:raft'); await pg.waitForTimeout(300); await pg.keyboard.press('Space'); await pg.waitForTimeout(+process.argv[4] || 5000); await pg.screenshot({ path: process.argv[2] }); }
  await b.close(); process.exit(errs.length ? 1 : 0);
})();
