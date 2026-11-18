// Tes jalur baca ringkas untuk Budget WBA di Hub (bot_baca jenis transfer_global). Jalankan: node tests/global.test.js
const assert = require('assert');
const { makeEnv, makeSheet, hubToken } = require('./fake-google');
let n = 0; const ok = (m) => { n++; console.log('ok  ' + m); };
const SECRET = 'rahasia-zerodeo-yang-panjang-0123456789';
const HEADER = ['No', 'Tanggal Dicatat', 'Deadline Kegiatan', 'Project/Brand', 'Item Kegiatan', 'Kategori', 'Tipe', 'Jalur', 'PIC', 'Estimasi (Rp)', 'Status',
  'PIC Transaksi', 'Nominal Transfer (Rp)', 'Tgl Transfer', 'Actual (Rp)', 'Selisih (Rp)', 'Nota/Bukti', 'Catatan', 'Dana', 'ID'];
const row = (o) => { const r = new Array(20).fill(''); r[1] = o.tgl || '2026-11-02'; r[3] = 'Zerodeo'; r[4] = o.item; r[8] = 'yanuar'; r[9] = o.est; r[10] = o.status; r[12] = o.tf || ''; r[13] = o.tgltf || ''; r[18] = o.dana || ''; r[19] = o.id; return r; };
const e = makeEnv({ SECRET_ZERODEO: SECRET });
e.sheets.kegiatan = makeSheet('kegiatan', [[], [], [], HEADER].concat([
  { item: 'Stiker', est: 10000000, status: 'Approved', tf: 5000000, id: 'k-1' },
  { item: 'Sound lama', est: 2000000, status: 'Selesai', tf: 2000000, tgltf: '2026-11-05', id: 'k-2' },
  { item: 'Dari dana', est: 300000, status: 'Ditransfer', dana: 'Modal Nov', id: 'k-3' },
  { item: 'Baru diajukan', est: 750000, status: 'Diajukan', id: 'k-4' },
  { item: 'Batal', est: 9000000, status: 'Dibatalkan', tf: 9000000, tgltf: '2026-11-05', id: 'k-5' },
].map(row)));
e.sheets.transfer = makeSheet('transfer', [['Dicatat', 'ID Kegiatan', 'Item Kegiatan', 'Keterangan', 'Nominal (Rp)', 'Tgl Transfer', 'PIC Transaksi', 'Oleh', 'Bukti Transfer'], ['', 'k-1', 'Stiker', 'DP', 5000000, '2026-11-10', 'lenno', 'lenno', '']]);
e.sheets.dana = makeSheet('dana', [['Nama Dana', 'Nominal (Rp)', 'Tgl Transfer'], ['Modal Nov', 3000000, '2026-10-30']]);
e.sheets.Tim = makeSheet('Tim', [['id', 'nama', 'peran'], ['lenno', 'Lenno', 'admin'], ['yanuar', 'Yanuar', 'anggota']]);
const baca = (peran, q) => JSON.parse(e.ctx.doPost({ postData: { contents: JSON.stringify({ action: 'bot_baca', token: hubToken(SECRET, { uid: 'hub-service', peran: 'service' }), for_uid: 'lenno', for_peran: peran, q }) } }).text);
const r = baca('admin', { jenis: 'transfer_global', bulan: '2026-11' });
assert.strictEqual(r.ok, true, r.error);
const h = r.hasil;
assert.deepStrictEqual(h.keluar.map((t) => t.kunci), ['zd:t:k-1:0', 'zd:k:k-2', 'zd:d:Modal Nov']); ok('keluar: transfer bertahap (per transfer), data lama tanpa riwayat, dan dana bulk; kegiatan dari dana & Dibatalkan tidak dobel');
assert.strictEqual(h.rekap.ditransfer, 7000000); ok('ditransfer bulan ini = transfer bertanggal November (dana Oktober tidak ikut)');
assert.strictEqual(h.rekap.rencana, 13050000); assert.strictEqual(h.rekap.sisa_pelunasan, 5000000); assert.strictEqual(h.rekap.menunggu_approve, 1); ok('rekap: rencana, sisa pelunasan, menunggu approve');
assert(!JSON.stringify(h).includes('yanuar')); ok('ringkas: tanpa PIC / detail kegiatan');
assert.strictEqual(baca('marketing', { jenis: 'transfer_global' }).ok, false); ok('peran marketing ditolak (tanpa angka uang)');
console.log('\n' + n + ' tes lolos');
