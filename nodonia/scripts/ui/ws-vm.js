/* Нодония — «НодаVM»: редактор ассемблера, газ, откат, пошаговый отладчик, готовые контракты. */
(function (G) {
  'use strict';
  const ND = G.ND, ui = ND.ui, h = ui.h, esc = ND.esc;
  let state = null;
  ui.registerWorkspace({
    id: 'vm', title: 'Смарт-контракты и газ (VM)', group: 'Блокчейн', order: 50, short: 'Учебная стековая VM: пишите контракты, считайте газ, ловите откат и уязвимости.',
    mount(root) {
      const EX = ND.vm.examples; let world, ex = EX[0], runRes = null, step = 0;
      if (!state) state = { src: EX[0].src, exId: EX[0].id };
      const page = h('div', { class: 'page' }); root.append(page);
      const sel = h('select', { class: 'inp', onchange: () => { ex = EX.find(e => e.id === sel.value); state.src = ex.src; state.exId = ex.id; ta.value = ex.src; deploy(true); renderCalls(); } }, EX.map(e => h('option', { value: e.id, text: e.title, selected: e.id === state.exId })));
      ex = EX.find(e => e.id === state.exId) || EX[0];
      const ta = h('textarea', { class: 'inp', rows: 18, spellcheck: 'false', style: 'font-size:12.5px;tab-size:2', oninput: () => { state.src = ta.value; } }, state.src);
      const err = h('div'), desc = h('div', { class: 'callout' }), calls = h('div'), out = h('div'), tr = h('div'), stor = h('div');
      const from = h('select', { class: 'inp' }, ['alice', 'bob', 'carol', 'dave', 'erin', 'mallory'].map(a => h('option', { value: a, text: a }))), val = h('input', { class: 'inp', type: 'number', value: 0, min: 0, style: 'width:90px' }), args = h('input', { class: 'inp', value: '', placeholder: 'аргументы через пробел: 1 @bob 30', style: 'width:220px' }), gas = h('input', { class: 'inp', type: 'number', value: 100000, min: 10, style: 'width:100px' });
      function newWorld() { world = new ND.vm.World(); for (const a of ['alice', 'bob', 'carol', 'dave', 'erin', 'mallory', 'bank']) world.fund(a, 1000); }
      function deploy(quiet) {
        newWorld(); err.innerHTML = ''; const r = world.deploy('contract', ta.value);
        if (ex.id === 'attacker') { /* атакующему нужен банк */ }
        if (!r.ok) { err.innerHTML = '<div class="callout bad"><b>Ошибки ассемблера:</b><br>' + r.errors.map(e => 'строка ' + e.line + ': ' + esc(e.msg)).join('<br>') + '</div>'; return false; }
        if (ex.id === 'bank' || ex.id === 'attacker') { const bank = EX.find(e => e.id === 'bank'), att = EX.find(e => e.id === 'attacker'); world.deploy('bank', ex.id === 'bank' ? ta.value : bank.src); world.deploy('mallory', ex.id === 'attacker' ? ta.value : att.src); world.deploy('contract', ta.value); }
        if (!quiet) ui.toast('Контракт развёрнут, мир сброшен (у каждого по 1000)', 'ok'); runRes = null; renderRes(); return true;
      }
      function parseArgs() { return args.value.trim() ? args.value.trim().split(/\s+/).map(x => /^-?\d+$/.test(x) ? x : x) : []; }
      function run(c) {
        if (!world || !world.code.contract) { if (!deploy(true)) return; }
        const to = ex.id === 'attacker' ? 'mallory' : (ex.id === 'bank' ? 'bank' : 'contract');
        const x = world.start({ from: c.from, to: ex.id === 'bank' || ex.id === 'attacker' ? to : 'contract', value: c.value || 0, args: c.args || [], gasLimit: +gas.value || 100000, wantStack: true });
        for (;;) { const n = x.gen.next(); if (n.done) break; }
        runRes = x.result(); step = Math.max(0, runRes.trace.length - 1); renderRes();
      }
      function renderCalls() {
        desc.innerHTML = '<b>' + esc(ex.title) + '.</b> ' + esc(ex.desc || '');
        calls.innerHTML = ''; (ex.calls || []).forEach(c => calls.append(h('button', { class: 'btn sm', style: 'margin:2px', text: c.label, onclick: () => run(c) })));
      }
      function renderRes() {
        if (!runRes) { out.innerHTML = '<p class="mt">Вызовите контракт: готовыми кнопками выше или вручную.</p>'; tr.innerHTML = ''; stor.innerHTML = ''; return; }
        const r = runRes;
        out.innerHTML = '<div class="callout ' + (r.ok ? '' : 'bad') + '"><b>' + (r.ok ? '✔ Успех' : '✘ Откат: ' + esc(r.error)) + '</b> · газ израсходован: <b>' + r.gasUsed + '</b> · шагов: ' + r.steps + (r.ok && r.ret != null ? ' · возвращено: <b class="mono">' + String(r.ret) + '</b>' : '') + (r.logs.length ? '<br>журнал: ' + r.logs.map(l => '<span class="pill">' + esc(typeof l === 'object' ? JSON.stringify(l, (k, v) => typeof v === 'bigint' ? String(v) : v) : l) + '</span>').join(' ') : '') + '</div>' + (r.ok ? '' : '<p class="mt sm">При откате состояние (хранилище и балансы) возвращается как до вызова, но газ уже потрачен.</p>');
        const T = r.trace; if (!T.length) { tr.innerHTML = ''; } else {
          const e = T[Math.min(step, T.length - 1)];
          tr.innerHTML = '<h3>Отладчик: шаг ' + (step + 1) + ' из ' + T.length + '</h3><div class="row"><button class="btn sm" id="pv">◀</button><input type="range" id="sl" min="0" max="' + (T.length - 1) + '" value="' + step + '" style="flex:1;min-width:160px"><button class="btn sm" id="nx">▶</button></div><div class="card" style="margin-top:8px"><div class="mono"><b>' + esc(e.op) + '</b> ' + esc(e.arg == null ? '' : e.arg) + ' &nbsp;<span class="mt">строка ' + e.line + ', pc=' + e.pc + ', газ осталось ' + e.gas + ', стоимость ' + e.cost + '</span></div><div class="mono" style="margin-top:6px">стек (до операции, дно → вершина): ' + (e.stack && e.stack.length ? e.stack.map(v => '<span class="pill">' + esc(v.length > 14 ? v.slice(0, 6) + '…' : v) + '</span>').join(' ') : '<span class="mt">пуст</span>') + '</div></div>'
            + '<details style="margin-top:8px"><summary>Вся трасса</summary><div style="max-height:220px;overflow:auto"><table class="tbl mono"><tr><th>#</th><th>строка</th><th>операция</th><th>газ</th></tr>' + T.slice(0, 400).map((t, i) => '<tr' + (i === step ? ' class="hl"' : '') + '><td>' + (i + 1) + '</td><td>' + t.line + '</td><td>' + esc(t.op + ' ' + (t.arg == null ? '' : t.arg)) + '</td><td>' + t.cost + '</td></tr>').join('') + '</table></div></details>';
          tr.querySelector('#pv').onclick = () => { step = Math.max(0, step - 1); renderRes(); }; tr.querySelector('#nx').onclick = () => { step = Math.min(T.length - 1, step + 1); renderRes(); }; tr.querySelector('#sl').oninput = ev => { step = +ev.target.value; renderRes(); };
        }
        const accts = ['contract', 'bank', 'mallory'].filter(a => world.code[a]);
        stor.innerHTML = '<h3>Состояние мира</h3>' + accts.map(a => { const m = world.store[a]; return '<div class="mono sm"><b>' + a + '</b> баланс ' + String(world.balance(a)) + ' · хранилище: ' + (m && m.size ? Array.from(m.entries()).map(([k, v]) => esc(k) + '→' + String(v)).join(', ') : '∅') + '</div>'; }).join('') + '<div class="mono sm mt">балансы: ' + ['alice', 'bob', 'carol', 'dave', 'erin', 'mallory'].map(a => a + '=' + String(world.balance(a))).join(', ') + '</div>';
      }
      page.append(h('h2', { text: 'Смарт-контракты и газ' }), h('p', { class: 'mt', style: 'max-width:820px', html: 'Контракт — это программа, которую исполняют все узлы одинаково. Каждая операция стоит <b>газ</b>: так сеть защищается от бесконечных циклов и платных вычислений «бесплатно». Если газ кончился или сработал <code>REVERT</code>, <b>все изменения откатываются</b>. Попробуйте «Токен с багом» и «Банк (уязвимый)».' }),
        h('div', { class: 'grid2' },
          h('div', null, h('div', { class: 'row', style: 'margin-bottom:6px' }, h('label', { class: 'fld row' }, 'Пример:', sel), h('button', { class: 'btn pri', text: 'Развернуть', onclick: () => deploy(false) })), ta, err, h('details', { style: 'margin-top:8px' }, h('summary', { text: 'Справочник операций' }), h('table', { class: 'tbl mono sm', html: '<tr><th>код</th><th>арг.</th><th>газ</th><th>смысл</th></tr>' + Object.keys(ND.vm.OPS).map(k => '<tr><td>' + k + '</td><td>' + esc(ND.vm.OPS[k][0] || '') + '</td><td>' + ND.vm.OPS[k][1] + '</td><td>' + esc(ND.vm.OPS[k][2]) + '</td></tr>').join('') }))),
          h('div', null, desc, h('h3', { text: 'Вызов' }), calls, h('div', { class: 'row', style: 'margin-top:8px' }, h('label', { class: 'fld' }, 'От', from), h('label', { class: 'fld' }, 'Сумма', val), h('label', { class: 'fld' }, 'Аргументы', args), h('label', { class: 'fld' }, 'Лимит газа', gas), h('button', { class: 'btn pri', style: 'align-self:end', text: 'Вызвать', onclick: () => run({ from: from.value, value: +val.value, args: parseArgs() }) })), out, tr, stor)));
      deploy(true); renderCalls(); renderRes();
      return {};
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
