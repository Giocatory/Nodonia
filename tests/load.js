/* Загрузчик скриптов симулятора в Node (без DOM): общий для тестов. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = process.env.ND_ROOT || path.join(__dirname, '..', 'nodonia');
function load(files) {
  const ctx = { console, Math, JSON, Date, Object, Array, String, Number, Set, Map, Uint8Array, Uint32Array, DataView, BigInt, TextEncoder, setTimeout, clearTimeout, Error, isFinite, isNaN, parseInt, parseFloat, Symbol, Promise, RegExp, Boolean, unescape, encodeURIComponent, decodeURIComponent, Infinity, NaN, undefined, Float64Array, Int32Array, ArrayBuffer, WeakMap };
  ctx.globalThis = ctx; ctx.window = undefined; vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
function manifest(dirs) { // все .js по каталогам в порядке имён
  const out = []; for (const d of dirs) { const p = path.join(root, 'scripts', d); if (!fs.existsSync(p)) continue; for (const f of fs.readdirSync(p).sort()) if (f.endsWith('.js')) out.push('scripts/' + d + '/' + f); } return out;
}
const CORE = ['scripts/core/util.js', 'scripts/core/sim.js', 'scripts/core/scheme.js', 'scripts/core/console.js'];
module.exports = { load, manifest, CORE, root };
