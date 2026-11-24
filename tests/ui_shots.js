/* Скриншоты для лендинга и пособия: node tests/ui_shots.js */
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs'); const out = path.resolve(__dirname, '../assets/screens/raw'); fs.mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1600, height: 957 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); await pg.goto('file://' + path.resolve(__dirname, '../nodonia/index.html')); await pg.waitForTimeout(400);
  const shot = async n => { await pg.waitForTimeout(500); await pg.screenshot({ path: out + '/' + n + '.png' }); };
  const run = (key, tplId, sec, tab) => pg.evaluate(async ([key, tplId, sec, tab]) => { const t = ND.reg.templates.find(x => x.id === tplId); ND.ui.open(key, t ? { scheme: t.build() } : {}); await new Promise(r => setTimeout(r, 300)); const s = ND.ui.cur.getSim(); s.runUntil(sec * 1000); if (tab) [...document.querySelectorAll('button,.tab,[role=tab],a')].find(e => e.textContent.trim() === tab && e.offsetParent)?.click(); }, [key, tplId, sec, tab]);
  await run('p:raft', 'raft-5', 6); await pg.evaluate(() => ND.ui.cur.getSim().act('crash', { node: [...ND.ui.cur.getSim().nodes].find(n => n.st.role === 'leader').id })); await pg.evaluate(() => ND.ui.cur.getSim().runUntil(ND.ui.cur.getSim().now + 3000)); await shot('raft');
  await run('p:raft', 'raft-5', 8, 'Диаграмма'); await shot('raft-diagram');
  await run('p:pbft', 'pbft-break', 0); await pg.evaluate(() => { const s = ND.ui.cur.getSim(); s.act('client', { id: 'request', args: { value: 'tx1' } }); s.runUntil(s.now + 20000); }); await shot('pbft', 'Инварианты и метрики');
  await run('p:pow', 'pow-51', 0); await pg.evaluate(() => { const s = ND.ui.cur.getSim(); s.act('client', { id: 'tx', args: { node: 'n2', id: 'pay1' } }); s.act('client', { id: 'attack_start', args: { node: 'n1', tx: 'pay1' } }); s.runUntil(s.now + 400000); }); await shot('pow');
  await run('p:services', 'svc-cascade', 0); await pg.evaluate(() => { const s = ND.ui.cur.getSim(); s.runUntil(5000); s.act('client', { id: 'slowdown', args: { node: s.nodes.find(n => n.kind === 'service').id, factor: 3 } }); s.runUntil(s.now + 30000); }); await shot('services');
  await run('p:gossip', 'gossip-8', 0); await pg.evaluate(() => { const s = ND.ui.cur.getSim(); s.act('client', { id: 'rumor', args: { node: 'n1', value: 'hello' } }); s.runUntil(s.now + 3500); }); await shot('gossip');
  for (const k of ['vm', 'merkle', 'hashring', 'attack', 'chain', 'wallet']) { await pg.evaluate(k => ND.ui.open('w:' + k), k); await shot(k); }
  await pg.evaluate(() => ND.ui.open('w:vm')); await pg.waitForTimeout(200); await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Развернуть'); b && b.click(); }); await shot('vm2');
  await pg.evaluate(() => ND.ui.open('w:arch')); await shot('arch');
  await pg.evaluate(() => ND.ui.open('w:labs', { lab: 'lab-raft-election' })); await shot('lab');
  await pg.evaluate(() => ND.ui.open('w:tasks')); await shot('tasks');
  await pg.evaluate(() => { const t = ND.reg.tasks.find(x => x.id === 't-raft-failover'); ND.ui.open('p:raft', { scheme: t.scheme(), task: t }); }); await pg.waitForTimeout(300); await pg.evaluate(() => { const s = ND.ui.cur.getSim(); s.runUntil(3000); s.act('crash', { node: s.nodes.find(n => n.st.role === 'leader').id }); s.runUntil(s.now + 4000); }); await shot('task');
  await pg.waitForTimeout(6000); await pg.evaluate(() => { document.documentElement.dataset.theme = 'dark'; try { ND.ui.setTheme && ND.ui.setTheme('dark'); } catch (e) {} ND.ui.open('p:raft', { scheme: ND.reg.templates.find(x => x.id === 'raft-5').build() }); }); await pg.evaluate(() => ND.ui.cur.getSim().runUntil(7000)); await shot('dark');
  console.log(errs.length ? errs.join('\n') : 'OK'); await b.close();
})();
