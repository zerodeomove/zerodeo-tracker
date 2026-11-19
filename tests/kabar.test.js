// Tes kabar Telegram langsung (Hub.gs kabarSesudah_): pengajuan / keputusan / transfer kegiatan dan seeding dikirim ke Hub (kabarApp).
// Jalankan: node tests/kabar.test.js
const assert = require('assert');
const { makeEnv, makeSheet, hubToken } = require('./fake-google');
let n = 0; const ok = (m) => { n++; console.log('ok  ' + m); };
const SECRET = 'rahasia-zerodeo-yang-panjang-0123456789', SHARED = 'shared-secret-panjang-abcdef';
const e = makeEnv({ SHARED_SECRET: SHARED, SECRET_ZERODEO: SECRET, HUB_URL: 'https://script.google.com/macros/s/HUB/exec' });
e.sheets.kegiatan = makeSheet('kegiatan', [[], [], [], ['No', 'Tanggal Dicatat', 'Deadline Kegiatan', 'Project/Brand', 'Item Kegiatan', 'Kategori', 'Tipe', 'Jalur', 'PIC', 'Estimasi (Rp)', 'Status', 'PIC Transaksi', 'Nominal Transfer (Rp)', 'Tgl Transfer', 'Actual (Rp)', 'Selisih (Rp)', 'Nota/Bukti', 'Catatan', 'Dana', 'ID']]);
e.sheets.Tim = makeSheet('Tim', [['id', 'nama', 'peran', 'disinkron'], ['lenno', 'Lenno', 'admin', 'x'], ['yanuar', 'Yanuar', 'anggota', 'x'], ['lemon', 'Lemon', 'approver', 'x'], ['ricko', 'Ricko', 'approver', 'x'], ['vendor', 'Vendor', 'marketing', 'x']]);
e.props.TIM_SYNC_AT = String(Date.now());
// stub Sheets yang tidak ada di fake (dropdown, format)
e.ctx.SpreadsheetApp.newDataValidation = () => { const v = { requireValueInList: () => v, setAllowInvalid: () => v, build: () => ({}) }; return v; };
Object.values(e.sheets).forEach((sh) => { sh.getMaxRows = sh.getMaxRows || (() => 1000); });
const rangeAsli = e.sheets.kegiatan.getRange; e.sheets.kegiatan.getRange = function () { const r = rangeAsli.apply(this, arguments); ['setDataValidation', 'setNumberFormat', 'setNumberFormats'].forEach((f) => { if (!r[f]) r[f] = () => r; }); return r; };
const kabar = [];
e.ctx.UrlFetchApp = { fetch: (url, o) => { const b = JSON.parse(o.payload); if (b.action === 'kabarApp') kabar.push(b); return { getContentText: () => JSON.stringify({ ok: true, terkirim: 1 }) }; } };
const postMentah = (body, uid, peran) => JSON.parse(e.ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ secret: SHARED, hub: { uid, peran } }, body)) } }).text);
// web: simpan dulu (kabar hanya antre), lalu "kirim_kabar" di belakang seperti yang dilakukan app.js
const post = (body, uid, peran) => { const n0 = kabar.length; const r = postMentah(body, uid, peran); assert.strictEqual(kabar.length, n0, 'simpanan web tidak boleh menunggu kabar'); postMentah({ action: 'kirim_kabar' }, uid, peran); return r; };
const svc = (body) => JSON.parse(e.ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ token: hubToken(SECRET, { uid: 'hub-service', peran: 'service' }) }, body)) } }).text);
const botAksi = (uid, peran, aksi) => svc({ action: 'bot_aksi', for_uid: uid, for_peran: peran, aksi });

// kegiatan diajukan -> approver (bukan pengaju); admin tidak (kegiatan bukan milik approver)
let r = botAksi('yanuar', 'anggota', { jenis: 'ajukan_kegiatan', item: 'Sewa <rak>', kategori: 'Promosi', tipe: 'Opex', pic: 'yanuar', estimasi: 1200000, status: 'Diajukan' });
assert.strictEqual(r.ok, true, r.error);
assert.strictEqual(kabar.length, 1); let k = kabar[0];
assert.strictEqual(k.kabar, 'perlu_acc'); assert.deepStrictEqual(k.ke.sort(), ['lemon', 'ricko']); assert.strictEqual(k.data.jenis, 'kegiatan'); assert.strictEqual(k.data.judul, 'Sewa <rak>'); assert.strictEqual(k.data.estimasi, 1200000); assert.strictEqual(k.data.oleh, 'Yanuar');
assert(k.token && k.app === 'zerodeo'); ok('kegiatan diajukan: kabar perlu_acc ke approver (bukan pengaju, admin tidak), lewat token servis zerodeo');
const idK = k.data.id;
const row = e.sheets.kegiatan.rows.findIndex((x) => x[19] === idK) + 1;
kabar.length = 0;
r = post({ action: 'update_status', row, status: 'Revisi' }, 'lemon', 'approver');
assert.strictEqual(r.ok, true, r.error); assert.strictEqual(kabar.length, 1); assert.strictEqual(kabar[0].kabar, 'diputuskan'); assert.deepStrictEqual(kabar[0].ke, ['yanuar']); assert.strictEqual(kabar[0].data.status, 'Revisi'); ok('kegiatan diputuskan: kabar ke PIC');
e.sheets.kegiatan.rows[row - 1][10] = 'Approved'; kabar.length = 0;
r = post({ action: 'mark_transferred', row, nominalTransfer: 1200000, picTransaksi: 'lemon', keterangan: 'Lunas' }, 'lemon', 'approver');
assert.strictEqual(r.ok, true, r.error); assert.strictEqual(kabar.length, 1); assert.strictEqual(kabar[0].kabar, 'ditransfer'); assert.deepStrictEqual(kabar[0].ke, ['yanuar']); assert.strictEqual(kabar[0].data.nominal, 1200000); ok('kegiatan ditransfer: kabar ke PIC');
// kegiatan milik approver -> approver lain + admin
kabar.length = 0;
botAksi('lemon', 'approver', { jenis: 'ajukan_kegiatan', item: 'Sound', kategori: 'Event', tipe: 'Opex', pic: 'lemon', estimasi: 500000, status: 'Diajukan' });
assert.deepStrictEqual(kabar[0].ke.sort(), ['lenno', 'ricko']); ok('kegiatan milik approver: kabar ke approver lain + admin');
// seeding
kabar.length = 0;
r = post({ action: 'add_seeding', nama: 'Seeding Rico', produk: 'Paket', sampel: [{ varian: 'Vital Fresh', qty: 10 }], platform: ['TikTok', 'Instagram'], kreator: '@a\n@b' }, 'vendor', 'marketing');
assert.strictEqual(r.ok, true, r.error); k = kabar[0];
assert.strictEqual(k.kabar, 'perlu_acc'); assert.deepStrictEqual(k.ke.sort(), ['lemon', 'lenno', 'ricko']); assert.strictEqual(k.data.jenis, 'seeding'); assert.strictEqual(k.data.kreator, 2); assert.strictEqual(k.data.total_pcs, 10); assert(/Vital Fresh ×10/.test(k.data.sampel)); ok('seeding diajukan: kabar ke approver + admin, dengan jumlah kreator & sampel');
kabar.length = 0;
r = post({ action: 'putuskan_seeding', id: r.id, status: 'Approved' }, 'ricko', 'approver');
assert.strictEqual(r.ok, true, r.error); assert.strictEqual(kabar[0].kabar, 'diputuskan'); assert.deepStrictEqual(kabar[0].ke, ['vendor']); ok('seeding di-acc: kabar ke pengaju');
// gagal kirim tidak menggagalkan aksi; aksi gagal tidak mengirim kabar
e.ctx.UrlFetchApp = { fetch: () => { throw new Error('Hub mati'); } };
r = botAksi('yanuar', 'anggota', { jenis: 'ajukan_kegiatan', item: 'Banner', kategori: 'Promosi', tipe: 'Opex', pic: 'yanuar', estimasi: 100000, status: 'Diajukan' });
assert.strictEqual(r.ok, true); ok('Hub tidak terjangkau: pengajuan tetap tersimpan');
e.ctx.UrlFetchApp = { fetch: (url, o) => { kabar.push(JSON.parse(o.payload)); return { getContentText: () => '{}' }; } }; kabar.length = 0;
r = post({ action: 'update_status', row, status: 'Approved' }, 'lemon', 'approver');
assert.strictEqual(r.ok, false); assert.strictEqual(kabar.length, 0); ok('aksi ditolak: tidak ada kabar');
// bot ringkasan: item yang perlu diputuskan membawa tanggal (untuk pengingat "sudah N hari menunggu" dari Hub)
const rk = svc({ action: 'bot_baca', for_uid: 'ricko', for_peran: 'approver', q: { jenis: 'ringkasan' } }).hasil.item;
assert(rk.some((x) => x.jenis === 'approve' && /^\d{4}-\d{2}-\d{2}$/.test(x.sejak)), JSON.stringify(rk)); ok('bot ringkasan: item approve membawa tanggal "sejak"');
console.log('\n' + n + ' tes lolos');
