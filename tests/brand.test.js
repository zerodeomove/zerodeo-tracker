// Tes Budget WBA: brand per kegiatan, Pengaturan Brand, akses per brand, approver per brand, sumber dana, rekap, bot.
// Jalankan: node tests/brand.test.js   (tanpa dependensi)
const assert = require('assert');
const { makeEnv, makeSheet, hubToken } = require('./fake-google');

let n = 0;
const ok = (m) => { n++; console.log('ok  ' + m); };
const SECRET = 'rahasia-zerodeo-yang-panjang-0123456789';
const SHARED = 'shared-secret-panjang-abcdef';
const H = 4;
const HEADER = ['No', 'Tanggal Dicatat', 'Deadline Kegiatan', 'Project/Brand', 'Item Kegiatan', 'Kategori', 'Tipe', 'Jalur', 'PIC', 'Estimasi (Rp)', 'Status',
  'PIC Transaksi', 'Nominal Transfer (Rp)', 'Tgl Transfer', 'Actual (Rp)', 'Selisih (Rp)', 'Nota/Bukti', 'Catatan', 'Dana', 'ID'];
function row(o) {
  const r = new Array(20).fill('');
  r[1] = o.tgl || '2026-11-05'; r[3] = o.brand === undefined ? 'Zerodeo' : o.brand; r[4] = o.item; r[5] = 'Lain-lain'; r[6] = 'Opex'; r[7] = o.jalur || 'Pengajuan';
  r[8] = o.pic || 'yanuar'; r[9] = o.est || 1000000; r[10] = o.status || 'Diajukan'; r[12] = o.tf || ''; r[13] = o.tgltf || ''; r[16] = o.nota || ''; r[19] = o.id;
  return r;
}
const TIM = [['lenno', 'Lenno', 'admin'], ['yanuar', 'Yanuar', 'anggota'], ['dini', 'Dini', 'anggota'], ['lemon', 'Lemon', 'approver'], ['vendor', 'Vendor', 'marketing']];
function env(rows) {
  const e = makeEnv({ SHARED_SECRET: SHARED, SECRET_ZERODEO: SECRET });
  e.sheets.kegiatan = makeSheet('kegiatan', [[], [], [], HEADER].concat(rows.map(row)));
  e.sheets.Tim = makeSheet('Tim', [['id', 'nama', 'peran', 'disinkron']].concat(TIM.map((t) => t.concat('x'))));
  return e;
}
const post = (e, body, uid, peran) => JSON.parse(e.ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ secret: SHARED }, uid ? { hub: { uid, peran } } : {}, body)) } }).text);
const svc = (e, body) => JSON.parse(e.ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ token: hubToken(SECRET, { uid: 'hub-service', peran: 'service' }) }, body)) } }).text);
const ROWS = [
  { item: 'Stiker Zerodeo', id: 'k-z1', brand: 'Zerodeo', pic: 'yanuar' },
  { item: 'Banner Depot', id: 'k-d1', brand: 'Depot', pic: 'dini' },
  { item: 'Lama tanpa brand', id: 'k-z2', brand: '', pic: 'yanuar', status: 'Selesai', tf: 500000, tgltf: '2026-11-03' },
];
const PENGATURAN = [
  { nama: 'Zerodeo', anggota: [], approver: [], sumber: ['Rekening BCA WBA', 'Kantong Jago Marketing'] },
  { nama: 'Depot', anggota: ['dini'], approver: ['lenno'], sumber: ['Kas Toko Depot'] },
  { nama: 'Retail Online', anggota: [], approver: [], sumber: [] },
  { nama: 'Kimia Kita', anggota: [], approver: [], sumber: [] },
];

{ // bawaan: 4 brand tanpa tab, semua terlihat
  const e = env(ROWS);
  const d = post(e, { action: 'get_data' }, 'yanuar', 'anggota');
  assert.deepStrictEqual(d.brand.map((b) => b.nama), ['Zerodeo', 'Depot', 'Retail Online', 'Kimia Kita']); ok('tanpa tab brand: 4 brand bawaan dikirim ke dashboard');
  assert.strictEqual(d.kegiatan.length, 3); ok('belum ada brand yang dibatasi: semua kegiatan terlihat (perilaku lama)');
  let r = post(e, { action: 'simpan_brand', brand: PENGATURAN }, 'yanuar', 'anggota');
  assert.strictEqual(r.ok, false); assert(/Hanya admin/.test(r.error)); ok('Pengaturan Brand: anggota ditolak');
  r = post(e, { action: 'simpan_brand', brand: PENGATURAN }, 'lemon', 'approver');
  assert.strictEqual(r.ok, false); ok('Pengaturan Brand: approver juga ditolak (khusus admin)');
  r = post(e, { action: 'simpan_brand', brand: PENGATURAN.concat([{ nama: 'X', anggota: ['siapa'] }]) }, 'lenno', 'admin');
  assert.strictEqual(r.ok, false); assert(/tidak ada di daftar tim/.test(r.error)); ok('anggota yang tidak ada di tim ditolak');
  r = post(e, { action: 'simpan_brand', brand: PENGATURAN.slice(0, 1).concat(PENGATURAN.slice(2)) }, 'lenno', 'admin');
  assert.strictEqual(r.ok, false); assert(/Depot masih punya kegiatan/.test(r.error)); ok('brand yang masih punya kegiatan tidak bisa dihapus');
  r = post(e, { action: 'simpan_brand', brand: PENGATURAN.concat([{ nama: 'depot' }]) }, 'lenno', 'admin');
  assert.strictEqual(r.ok, false); assert(/dobel/.test(r.error)); ok('nama brand dobel ditolak');
  r = post(e, { action: 'simpan_brand', brand: PENGATURAN }, 'lenno', 'admin');
  assert.strictEqual(r.ok, true); assert.strictEqual(e.sheets.brand.rows[2][0], 'Depot'); assert.strictEqual(e.sheets.brand.rows[2][1], 'dini'); ok('admin menyimpan Pengaturan Brand ke tab "brand"');

  // akses per brand
  let dy = post(e, { action: 'get_data' }, 'yanuar', 'anggota');
  assert.deepStrictEqual(dy.kegiatan.map((k) => k.ID).sort(), ['k-z1', 'k-z2']); ok('Yanuar (bukan anggota Depot) tidak melihat kegiatan Depot');
  const dd = post(e, { action: 'get_data' }, 'dini', 'anggota');
  assert.deepStrictEqual(dd.kegiatan.map((k) => k.ID).sort(), ['k-d1', 'k-z1', 'k-z2']); ok('Dini melihat Depot + Zerodeo (anggota Zerodeo kosong = semua)');
  const dl = post(e, { action: 'get_data' }, 'lenno', 'admin');
  assert.strictEqual(dl.kegiatan.length, 3); ok('admin melihat semua brand');
  r = post(e, { action: 'cancel_kegiatan', row: H + 2 }, 'yanuar', 'anggota');
  assert.strictEqual(r.ok, false); assert(/brand Depot/.test(r.error)); ok('aksi pada baris Depot oleh yang tidak pegang Depot ditolak');

  // ajukan
  r = post(e, { item: 'Banner promo', brand: 'Depot', kategori: 'Lain-lain', tipe: 'Opex', jalur: 'Pengajuan', pic: 'yanuar', estimasi: 500000, status: 'Diajukan' }, 'yanuar', 'anggota');
  assert.strictEqual(r.ok, false); assert(/tidak memegang brand Depot/.test(r.error)); ok('ajukan ke brand yang tidak dipegang ditolak');
  r = post(e, { item: 'Banner promo', brand: 'depot', kategori: 'Lain-lain', tipe: 'Opex', jalur: 'Pengajuan', pic: 'dini', estimasi: 500000, status: 'Diajukan' }, 'dini', 'anggota');
  assert.strictEqual(r.ok, true); assert.strictEqual(r.brand, 'Depot'); assert.strictEqual(e.sheets.kegiatan.rows[r.row - 1][3], 'Depot'); ok('ajukan ke Depot tersimpan di kolom Project/Brand (nama resmi)');
  const rowBanner = r.row;
  r = post(e, { item: 'X', brand: 'Toko Lain', kategori: 'Lain-lain', tipe: 'Opex', pic: 'dini', estimasi: 1 }, 'dini', 'anggota');
  assert.strictEqual(r.ok, false); assert(/tidak dikenal/.test(r.error)); ok('brand tidak dikenal ditolak, disebut pilihannya');
  r = post(e, { item: 'Tanpa brand', kategori: 'Lain-lain', tipe: 'Opex', pic: 'yanuar', estimasi: 1000 }, 'yanuar', 'anggota');
  assert.strictEqual(r.brand, 'Zerodeo'); ok('tanpa brand (dashboard / bot lama) = Zerodeo');

  // approve per brand
  r = post(e, { action: 'update_status', row: rowBanner, status: 'Approved' }, 'lemon', 'approver');
  assert.strictEqual(r.ok, false); ok('Lemon (approver Hub) tidak memutuskan Depot: approver Depot = Lenno');
  r = post(e, { action: 'update_status', row: H + 1, status: 'Approved' }, 'lemon', 'approver');
  assert.strictEqual(r.ok, true); ok('Lemon tetap memutuskan Zerodeo (approver brand kosong = peran approver Hub)');
  r = post(e, { action: 'update_status', row: rowBanner, status: 'Approved' }, 'lenno', 'admin');
  assert.strictEqual(r.ok, true); ok('Lenno (approver Depot) meng-approve kegiatan Depot');
  // titik merah
  const e2 = env(ROWS);
  post(e2, { action: 'simpan_brand', brand: PENGATURAN }, 'lenno', 'admin');
  const keysLemon = svc(e2, { action: 'pending', for_uid: 'lemon', for_peran: 'approver' }).keys;
  const keysLenno = svc(e2, { action: 'pending', for_uid: 'lenno', for_peran: 'admin' }).keys;
  assert(keysLemon.includes('z:approve:k-z1') && !keysLemon.includes('z:approve:k-d1')); ok('titik merah approve: Lemon hanya Zerodeo');
  assert(keysLenno.includes('z:approve:k-d1') && !keysLenno.includes('z:approve:k-z1')); ok('titik merah approve: Lenno untuk Depot (bukan Zerodeo milik anggota)');

  // sumber dana saat transfer
  r = post(e, { action: 'mark_transferred', row: rowBanner, nominalTransfer: 500000, picTransaksi: 'lenno', keterangan: 'Lunas', sumberDana: 'Rekening BCA WBA' }, 'lenno', 'admin');
  assert.strictEqual(r.ok, false); assert(/tidak ada di brand Depot/.test(r.error) && /Kas Toko Depot/.test(r.error)); ok('sumber dana di luar brand ditolak, disebut pilihannya');
  r = post(e, { action: 'mark_transferred', row: rowBanner, nominalTransfer: 500000, picTransaksi: 'lenno', keterangan: 'Lunas', sumberDana: 'kas toko depot', tglTransfer: '2026-11-18' }, 'lenno', 'admin');
  assert.strictEqual(r.ok, true); assert.strictEqual(r.sumber_dana, 'Kas Toko Depot'); assert.strictEqual(e.sheets.transfer.rows[1][9], 'Kas Toko Depot'); ok('"Dibayar dari" tersimpan di tab transfer (kolom Dibayar Dari)');
  const d2 = post(e, { action: 'get_data', fresh: true }, 'lenno', 'admin');
  assert.strictEqual(d2.transfer['k-z1'], undefined); assert.strictEqual(d2.transfer[e.sheets.kegiatan.rows[rowBanner - 1][19]][0].sumber, 'Kas Toko Depot'); ok('riwayat transfer di dashboard membawa sumber dana');

  // ganti nama brand: kegiatan ikut
  r = post(e, { action: 'simpan_brand', brand: PENGATURAN.map((b) => b.nama === 'Depot' ? Object.assign({}, b, { nama: 'Depot Kimia', lama: 'Depot' }) : b) }, 'lenno', 'admin');
  assert.strictEqual(r.ok, true); assert.strictEqual(r.diganti, 2); assert.strictEqual(e.sheets.kegiatan.rows[H + 1][3], 'Depot Kimia'); ok('ganti nama brand: kegiatannya ikut diganti');

  // bot
  const bz = svc(e, { action: 'bot_baca', for_uid: 'yanuar', for_peran: 'anggota', q: { jenis: 'kegiatan', termasuk_selesai: true } }).hasil;
  assert(bz.data.every((k) => k.brand === 'Zerodeo')); ok('bot baca kegiatan: Yanuar hanya brand yang dia pegang, ada field brand');
  const bb = svc(e, { action: 'bot_baca', for_uid: 'dini', for_peran: 'anggota', q: { jenis: 'brand' } }).hasil;
  const dep = bb.find((b) => b.brand === 'Depot Kimia');
  assert(dep && dep.approver[0] === 'Lenno' && dep.sumber_dana[0] === 'Kas Toko Depot'); ok('bot baca brand: approver + sumber dana per brand');
  const rk = svc(e, { action: 'bot_baca', for_uid: 'lenno', for_peran: 'admin', q: { jenis: 'rekap', bulan: '2026-11' } }).hasil;
  assert.strictEqual(rk.ditransfer, 1000000); assert.strictEqual(rk.per_sumber['Kas Toko Depot'], 500000); assert.strictEqual(rk.per_sumber['(belum diisi)'], 500000);
  assert.strictEqual(rk.per_brand['Depot Kimia'].ditransfer, 500000); assert.strictEqual(rk.per_brand['Zerodeo'].ditransfer, 500000); ok('bot rekap bulan: ditransfer per brand dan per sumber dana (data lama = belum diisi)');
  const rkd = svc(e, { action: 'bot_baca', for_uid: 'lenno', for_peran: 'admin', q: { jenis: 'rekap', bulan: '2026-11', brand: 'depot kimia' } }).hasil;
  assert.strictEqual(rkd.ditransfer, 500000); assert.strictEqual(rkd.brand, 'Depot Kimia'); ok('bot rekap satu brand');
  const ry = svc(e, { action: 'bot_baca', for_uid: 'yanuar', for_peran: 'anggota', q: { jenis: 'rekap', bulan: '2026-11' } }).hasil;
  assert.strictEqual(ry.per_brand['Depot Kimia'], undefined); ok('bot rekap: angka brand yang tidak dipegang tidak ikut');
  let ba = svc(e, { action: 'bot_aksi', for_uid: 'dini', for_peran: 'anggota', aksi: { jenis: 'ajukan_kegiatan', brand: 'Depot Kimia', item: 'Rak', kategori: 'Lain-lain', tipe: 'Capex', pic: 'dini', estimasi: 300000 } });
  assert.strictEqual(ba.ok, true); assert.strictEqual(ba.brand, 'Depot Kimia'); ok('bot ajukan ke brand Depot Kimia');
  ba = svc(e, { action: 'bot_aksi', for_uid: 'lenno', for_peran: 'admin', aksi: { jenis: 'tandai_transfer', id: 'k-z1', nominal: 1000000, pic_transaksi: 'lenno', sumber_dana: 'Kantong Jago Marketing' } });
  assert.strictEqual(ba.ok, true); assert.strictEqual(ba.sumber_dana, 'Kantong Jago Marketing'); ok('bot catat transfer dengan sumber dana');
  const log = e.sheets.log_aktivitas.rows;
  assert(/Kantong Jago/.test(log[log.length - 1][5])); ok('log aktivitas mencatat sumber dana');
}
console.log('\n' + n + ' tes lolos');
