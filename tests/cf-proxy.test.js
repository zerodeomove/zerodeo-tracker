// Tes proxy versi Cloudflare Pages (functions/api/proxy.js), setara dengan tes proxy Vercel di sso.test.js.
// Jalankan: node tests/cf-proxy.test.js   (tanpa dependensi; butuh Node 18+ untuk Request/Response/crypto.subtle)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { hubToken } = require('./fake-google');

let n = 0;
const ok = (m) => { n++; console.log('ok  ' + m); };
const SECRET = 'rahasia-zerodeo-yang-panjang-0123456789';
const SHARED = 'shared-secret-panjang-abcdef';
const URLX = 'https://script.google.com/macros/s/ABC/exec';
const BASE = { APPS_SCRIPT_URL: URLX, SHARED_SECRET: SHARED, SECRET_ZERODEO: SECRET };

(async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'api', 'proxy.js'), 'utf8');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

  async function call(init, env, upstream) {
    const calls = [];
    global.fetch = async (url, opts) => { calls.push({ url, opts }); return { text: async () => (upstream === undefined ? '{"ok":true}' : upstream) }; };
    const method = init.method || 'GET';
    const req = new Request('https://zerodeo.pages.dev/api/proxy' + (init.query || ''), {
      method, headers: init.headers || {}, body: method === 'POST' ? (typeof init.body === 'string' ? init.body : JSON.stringify(init.body)) : undefined
    });
    const res = await mod.onRequest({ request: req, env });
    return { res, status: res.status, body: await res.json(), calls };
  }

  // ----- verifikasi token (setara api/proxy.js)
  const tok = hubToken(SECRET, { uid: 'lemon', peran: 'approver' });
  assert.deepStrictEqual(await mod.verifyHubToken(tok, SECRET), { uid: 'lemon', peran: 'approver' }); ok('Cloudflare memverifikasi token Hub yang sama dengan Apps Script');
  assert.strictEqual(await mod.verifyHubToken(tok, 'salah'), null); ok('rahasia salah ditolak');
  assert.strictEqual(await mod.verifyHubToken(tok.slice(0, -3) + 'abc', SECRET), null); ok('tanda tangan dipalsukan ditolak');
  assert.strictEqual(await mod.verifyHubToken(hubToken(SECRET, { uid: 'hub-service', peran: 'service' }), SECRET), null); ok('token servis dari browser ditolak');
  assert.strictEqual(await mod.verifyHubToken(hubToken(SECRET, { uid: 'lemon', peran: 'approver', app: 'depot' }), SECRET), null); ok('token app lain ditolak');
  assert.strictEqual(await mod.verifyHubToken(hubToken(SECRET, { uid: 'lemon', peran: 'approver' }, Date.now() - 13 * 3600 * 1000), SECRET), null); ok('token kedaluwarsa ditolak');
  assert.strictEqual(await mod.verifyHubToken(hubToken(SECRET, { uid: 'x', peran: 'bos' }), SECRET), null); ok('peran tidak dikenal ditolak');
  assert.deepStrictEqual(await mod.verifyHubToken(hubToken(SECRET, { uid: 'vendor', peran: 'marketing' }), SECRET), { uid: 'vendor', peran: 'marketing' }); ok('peran marketing diterima');
  assert.strictEqual(await mod.verifyHubToken('', SECRET), null); assert.strictEqual(await mod.verifyHubToken('a.b.c', SECRET), null); ok('token kosong atau bentuk salah ditolak');

  // ----- alur permintaan
  let r = await call({ method: 'POST', headers: { 'x-hub-token': tok }, body: { action: 'update_status', row: 5, status: 'Approved', hub: { uid: 'penyusup', peran: 'approver' }, secret: 'palsu' } }, BASE);
  let b = JSON.parse(r.calls[0].opts.body);
  assert.strictEqual(r.status, 200); assert.deepStrictEqual(b.hub, { uid: 'lemon', peran: 'approver' }); assert.strictEqual(b.secret, SHARED);
  assert.strictEqual(r.calls[0].url, URLX); assert.strictEqual(r.calls[0].opts.method, 'POST'); ok('token sah: identitas dari token diteruskan, "hub" dan "secret" kiriman browser ditimpa');
  assert.strictEqual(r.res.headers.get('cache-control'), 'no-store'); ok('respons tidak boleh di-cache (no-store)');

  r = await call({ method: 'GET', query: '?fresh=1', headers: { 'x-hub-token': tok } }, BASE);
  b = JSON.parse(r.calls[0].opts.body);
  assert.deepStrictEqual(b, { action: 'get_data', fresh: true, secret: SHARED, hub: { uid: 'lemon', peran: 'approver' } }); ok('GET dengan token menjadi get_data yang membawa identitas');
  r = await call({ method: 'GET', headers: { 'x-hub-token': tok } }, BASE);
  assert.strictEqual(JSON.parse(r.calls[0].opts.body).fresh, false); ok('GET tanpa fresh=1: fresh false');

  r = await call({ method: 'GET', headers: { 'x-hub-token': tok.slice(0, -3) + 'abc' } }, BASE);
  assert.strictEqual(r.status, 401); assert.strictEqual(r.body.code, 'LOGIN_HUB'); assert.strictEqual(r.calls.length, 0); ok('token rusak: 401 LOGIN_HUB, Apps Script tidak dipanggil');
  r = await call({ method: 'GET', headers: { 'x-hub-token': hubToken(SECRET, { uid: 'lemon', peran: 'approver' }, Date.now() - 13 * 3600 * 1000) } }, BASE);
  assert.strictEqual(r.status, 401); assert.strictEqual(r.calls.length, 0); ok('token kedaluwarsa: 401');
  r = await call({ method: 'GET' }, BASE);
  assert.strictEqual(r.status, 401); assert.strictEqual(r.body.code, 'LOGIN_HUB'); assert.strictEqual(r.calls.length, 0); ok('tanpa token dan tanpa TEAM_CODE: 401 "Masuk lewat Hub"');
  r = await call({ method: 'GET', headers: { 'x-team-code': 'apa-saja' } }, BASE);
  assert.strictEqual(r.status, 401); ok('kode tim kiriman tidak diterima kalau TEAM_CODE tidak diisi');

  const WITH_CODE = Object.assign({ TEAM_CODE: 'kode-lama-panjang' }, BASE);
  r = await call({ method: 'POST', headers: { 'x-team-code': 'kode-lama-panjang' }, body: { action: 'add_dana' } }, WITH_CODE);
  assert.strictEqual(JSON.parse(r.calls[0].opts.body).hub, null); ok('masa transisi (TEAM_CODE ada): boleh, tapi tanpa identitas');
  r = await call({ method: 'GET', headers: { 'x-team-code': 'salah' } }, WITH_CODE);
  assert.strictEqual(r.status, 401); ok('masa transisi, kode tim salah: 401');
  r = await call({ method: 'POST', headers: { 'x-hub-token': tok, 'x-team-code': 'kode-lama-panjang' }, body: { action: 'update_status' } }, WITH_CODE);
  assert.deepStrictEqual(JSON.parse(r.calls[0].opts.body).hub, { uid: 'lemon', peran: 'approver' }); ok('token Hub didahulukan atas kode tim');
  r = await call({ method: 'GET', headers: { 'x-hub-token': 'ngawur', 'x-team-code': 'kode-lama-panjang' } }, WITH_CODE);
  assert.strictEqual(r.status, 401); ok('token Hub salah tidak bisa "turun" ke kode tim');

  r = await call({ method: 'GET', headers: { 'x-hub-token': tok } }, { APPS_SCRIPT_URL: URLX, SHARED_SECRET: SHARED });
  assert.strictEqual(r.status, 500); assert.strictEqual(r.calls.length, 0); assert(/SECRET_ZERODEO/.test(r.body.error) && !/APPS_SCRIPT_URL/.test(r.body.error)); ok('tanpa SECRET_ZERODEO dan tanpa TEAM_CODE: 500 dan pesan menyebut variabel yang kurang');
  r = await call({ method: 'GET', headers: { 'x-hub-token': tok } }, { SECRET_ZERODEO: SECRET });
  assert.strictEqual(r.status, 500); assert(/APPS_SCRIPT_URL, SHARED_SECRET/.test(r.body.error)); assert(!/rahasia-zerodeo/.test(r.body.error)); ok('tanpa APPS_SCRIPT_URL / SHARED_SECRET: 500, hanya nama variabel yang disebut (bukan nilainya)');

  r = await call({ method: 'POST', headers: { 'x-hub-token': tok }, body: 'bukan json' }, BASE);
  assert.strictEqual(r.status, 400); assert.strictEqual(r.calls.length, 0); ok('body bukan JSON: 400');
  r = await call({ method: 'POST', headers: { 'x-hub-token': tok }, body: '[1,2]' }, BASE);
  assert.strictEqual(r.status, 400); ok('body berupa array: 400');
  r = await call({ method: 'PUT', headers: { 'x-hub-token': tok }, body: {} }, BASE);
  assert.strictEqual(r.status, 405); ok('method lain: 405');
  r = await call({ method: 'GET', headers: { 'x-hub-token': tok } }, BASE, '<html>login google</html>');
  assert.strictEqual(r.status, 502); ok('Apps Script menjawab bukan JSON: 502 dengan petunjuk');
  global.fetch = async () => { throw new Error('jaringan putus'); };
  const res = await mod.onRequest({ request: new Request('https://x/api/proxy', { headers: { 'x-hub-token': tok } }), env: BASE });
  assert.strictEqual(res.status, 502); assert(/jaringan putus/.test((await res.json()).error)); ok('Apps Script tidak terjangkau: 502');

  // ----- worker.js: /api/proxy ke proxy, selain itu ke file statis
  const wsrc = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8').replace("'./functions/api/proxy.js'", JSON.stringify('data:text/javascript;base64,' + Buffer.from(src).toString('base64')));
  const worker = (await import('data:text/javascript;base64,' + Buffer.from(wsrc).toString('base64'))).default;
  let asset = null;
  const wenv = Object.assign({ ASSETS: { fetch: async (rq) => { asset = new URL(rq.url).pathname; return new Response('statis'); } } }, BASE);
  global.fetch = async () => ({ text: async () => '{"ok":true}' });
  let wr = await worker.fetch(new Request('https://z.pages.dev/api/proxy', { headers: { 'x-hub-token': tok } }), wenv);
  assert.strictEqual(wr.status, 200); assert.strictEqual(asset, null); ok('worker: /api/proxy dijalankan oleh proxy');
  wr = await worker.fetch(new Request('https://z.pages.dev/index.html'), wenv);
  assert.strictEqual(await wr.text(), 'statis'); assert.strictEqual(asset, '/index.html'); ok('worker: path lain diserahkan ke file statis');
  wr = await worker.fetch(new Request('https://z.pages.dev/api/proxy'), wenv);
  assert.strictEqual(wr.status, 401); ok('worker: tanpa token tetap 401');

  console.log('\n' + n + ' pemeriksaan lolos');
})().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
