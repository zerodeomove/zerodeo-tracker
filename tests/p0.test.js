// Tes perubahan keamanan (P0): secret, jalur GET/POST, proxy, ID kegiatan. Jalankan: node tests/p0.test.js   (tanpa dependensi)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
let n = 0;
const ok = (m) => { n++; console.log('ok  ' + m); };

// ---------------- Apps Script (Code.gs + Marketing.gs) dengan Google API palsu ----------------
function loadAppsScript(props, extra) {
  const store = Object.assign({}, props);
  const cacheStore = {};
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cacheStore[k] || null, put: (k, v) => { cacheStore[k] = v; }, remove: (k) => { delete cacheStore[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: { getUuid: () => require('crypto').randomUUID() },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) },
    console,
  };
  Object.assign(ctx, extra || {});
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'Marketing.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'Code.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'Hub.gs'), 'utf8'), ctx);
  return { ctx, store };
}
const parse = (out) => JSON.parse(out.text);

// ---- isAuthorized_ / safeEqual_
{
  const { ctx } = loadAppsScript({});
  assert.strictEqual(ctx.isAuthorized_('apa-saja'), false); ok('SHARED_SECRET kosong -> semua ditolak (tertutup bawaan)');
  assert.strictEqual(ctx.isAuthorized_(''), false); ok('SHARED_SECRET kosong + secret kosong -> tetap ditolak');
}
{
  const { ctx } = loadAppsScript({ SHARED_SECRET: 'rahasia-panjang-123' });
  assert.strictEqual(ctx.isAuthorized_('rahasia-panjang-123'), true); ok('secret benar -> diterima');
  assert.strictEqual(ctx.isAuthorized_('rahasia-panjang-124'), false); ok('secret beda satu karakter -> ditolak');
  assert.strictEqual(ctx.isAuthorized_('rahasia-panjang-12'), false); ok('secret lebih pendek -> ditolak');
  assert.strictEqual(ctx.isAuthorized_('rahasia-panjang-1234'), false); ok('secret lebih panjang -> ditolak');
  assert.strictEqual(ctx.isAuthorized_(undefined), false); ok('tanpa secret -> ditolak');
  assert.strictEqual(ctx.isAuthorized_(null), false);
}

// ---- doGet / doPost
{
  const { ctx } = loadAppsScript({ SHARED_SECRET: 's3cret' });
  assert.strictEqual(parse(ctx.doGet({ parameter: {} })).error, 'unauthorized'); ok('GET tanpa secret -> unauthorized');
  assert.strictEqual(parse(ctx.doGet({ parameter: { secret: 'salah' } })).error, 'unauthorized'); ok('GET secret salah -> unauthorized');
  assert.strictEqual(parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'get_data' }) } })).error, 'unauthorized'); ok('POST get_data tanpa secret -> unauthorized');
  assert.strictEqual(parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'update_status', secret: 'salah' }) } })).error, 'unauthorized'); ok('POST aksi tulis dengan secret salah -> unauthorized');
}
{
  // jalur baca: dengan secret benar, serveData_ dipanggil (payload diganti agar tak perlu Sheet)
  const { ctx } = loadAppsScript({ SHARED_SECRET: 's3cret' });
  vm.runInContext("buildPayload_ = function () { return { ok_data: true }; };", ctx);
  const r1 = parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'get_data', secret: 's3cret' }) } }));
  assert.strictEqual(r1.ok_data, true); ok('POST get_data dengan secret benar -> data');
  const r2 = parse(ctx.doGet({ parameter: { secret: 's3cret' } }));
  assert.strictEqual(r2.ok_data, true); ok('GET dengan secret benar masih jalan (masa transisi)');
}
{
  const { ctx } = loadAppsScript({ SHARED_SECRET: 's3cret', BLOCK_GET: '1' });
  vm.runInContext("buildPayload_ = function () { return { ok_data: true }; };", ctx);
  assert.strictEqual(parse(ctx.doGet({ parameter: { secret: 's3cret' } })).error, 'unauthorized'); ok('BLOCK_GET=1 -> GET ditutup walau secret benar');
  assert.strictEqual(parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'get_data', secret: 's3cret' }) } })).ok_data, true); ok('BLOCK_GET=1 -> POST get_data tetap jalan');
}

// ---- ensureKegiatanIds_ dengan Sheet palsu
function fakeSheet(items, ids, ctxRef) {
  const sheet = {
    header: '',
    getLastRow: () => 4 + items.length,
    setColumnWidth() {},
    getRange(row, col, nr, nc) {
      const c = ctxRef.COL;
      const r = {
        getValues: () => (col === c.ITEM ? items.map((x) => [x]) : ids.map((x) => [x])),
        setValues: (v) => { assert.strictEqual(col, c.ID); v.forEach((row2, i) => { ids[i] = row2[0]; }); return r; },
        getValue: () => sheet.header,
        setValue: (v) => { sheet.header = v; return r; },
      };
      ['setFontWeight', 'setFontColor', 'setBackground', 'setHorizontalAlignment', 'setVerticalAlignment', 'setWrap'].forEach((f) => { r[f] = () => r; });
      return r;
    },
  };
  return sheet;
}
{
  const items = ['A', 'B', '', 'D', 'E'];
  const ids = ['k-lama1', '', '', '', 'k-lama5'];
  const holder = {};
  const { ctx } = loadAppsScript({}, {});
  holder.COL = vm.runInContext('COL', ctx);
  const sheet = fakeSheet(items, ids, holder);
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) };
  const made = ctx.ensureKegiatanIds_();
  assert.strictEqual(made, 2); ok('ensureKegiatanIds_: hanya baris berisi item tanpa ID yang diisi (2 baris)');
  assert.strictEqual(ids[0], 'k-lama1'); assert.strictEqual(ids[4], 'k-lama5'); ok('ID yang sudah ada tidak berubah');
  assert.strictEqual(ids[2], ''); ok('baris kosong (tanpa item) tidak diberi ID');
  assert(/^k-[0-9a-f]{10}$/.test(ids[1]) && /^k-[0-9a-f]{10}$/.test(ids[3])); ok('format ID: k-<10 heks>');
  assert.notStrictEqual(ids[1], ids[3]); ok('ID unik antar baris');
  assert.strictEqual(sheet.header, 'ID'); ok('header kolom ID dibuat');
  assert.strictEqual(ctx.ensureKegiatanIds_(), 0); ok('dipanggil ulang -> tidak membuat apa pun (idempoten)');
}

// ---------------- Proxy Vercel dengan fetch palsu ----------------
const proxy = require(path.join(root, 'api', 'proxy.js'));
function mkRes() {
  const r = { code: 200, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
async function callProxy(req, env, fetchImpl) {
  const saved = {}; ['TEAM_CODE', 'APPS_SCRIPT_URL', 'SHARED_SECRET'].forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
  Object.assign(process.env, env);
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return fetchImpl ? fetchImpl(url, opts) : { text: async () => '{"ok":true}' }; };
  const res = mkRes();
  await proxy(Object.assign({ headers: {}, method: 'GET', url: '/api/proxy', query: {} }, req), res);
  ['TEAM_CODE', 'APPS_SCRIPT_URL', 'SHARED_SECRET'].forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  return { res, calls };
}
const ENV = { TEAM_CODE: 'kode-tim-panjang', APPS_SCRIPT_URL: 'https://script.google.com/macros/s/ABC/exec', SHARED_SECRET: 'sec-123' };

(async () => {
  let r = await callProxy({}, { TEAM_CODE: ENV.TEAM_CODE, APPS_SCRIPT_URL: ENV.APPS_SCRIPT_URL });
  assert.strictEqual(r.res.code, 500); assert.strictEqual(r.calls.length, 0); ok('proxy tanpa SHARED_SECRET -> 500, tidak memanggil Apps Script');

  r = await callProxy({ headers: { 'x-team-code': 'salah' } }, ENV);
  assert.strictEqual(r.res.code, 401); assert.strictEqual(r.calls.length, 0); ok('kode tim salah -> 401, tidak memanggil Apps Script');

  r = await callProxy({ headers: { 'x-team-code': ENV.TEAM_CODE }, method: 'GET', query: {} }, ENV);
  assert.strictEqual(r.calls.length, 1);
  assert.strictEqual(r.calls[0].url, ENV.APPS_SCRIPT_URL); ok('GET -> URL Apps Script tanpa query apa pun (secret tidak di URL)');
  assert.strictEqual(r.calls[0].opts.method, 'POST'); ok('GET dari browser diteruskan sebagai POST');
  const b1 = JSON.parse(r.calls[0].opts.body);
  assert.deepStrictEqual(b1, { action: 'get_data', fresh: false, secret: ENV.SHARED_SECRET, hub: null }); ok('body: get_data + secret di body (jalur kode tim: tanpa identitas)');

  r = await callProxy({ headers: { 'x-team-code': ENV.TEAM_CODE }, method: 'GET', query: { fresh: '1', secret: 'dari-browser', action: 'x' } }, ENV);
  const b2 = JSON.parse(r.calls[0].opts.body);
  assert.strictEqual(b2.fresh, true); assert.strictEqual(b2.secret, ENV.SHARED_SECRET); assert.strictEqual(b2.action, 'get_data'); ok('fresh=1 diteruskan; parameter lain dari browser diabaikan');

  r = await callProxy({ headers: { 'x-team-code': ENV.TEAM_CODE }, method: 'POST', body: { action: 'add_dana', secret: 'palsu', x: 1 } }, ENV);
  const b3 = JSON.parse(r.calls[0].opts.body);
  assert.strictEqual(b3.secret, ENV.SHARED_SECRET); assert.strictEqual(b3.x, 1); ok('POST: secret dari browser ditimpa secret server, isi lain diteruskan');

  r = await callProxy({ headers: { 'x-team-code': ENV.TEAM_CODE }, method: 'DELETE' }, ENV);
  assert.strictEqual(r.res.code, 405); ok('method lain -> 405');

  console.log('\n' + n + ' pemeriksaan lolos');
})().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
