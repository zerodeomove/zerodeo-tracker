// Tes SSO Hub: token, identitas, approve tanpa PIN, PIC sebagai ID, tim, titik merah, log.
// Jalankan: node tests/sso.test.js   (tanpa dependensi)
const assert = require('assert');
const path = require('path');
const vm = require('vm');
const { makeEnv, makeSheet, hubToken } = require('./fake-google');
const proxy = require(path.join(__dirname, '..', 'api', 'proxy.js'));

let n = 0;
const ok = (m) => { n++; console.log('ok  ' + m); };
const SECRET = 'rahasia-zerodeo-yang-panjang-0123456789';
const SHARED = 'shared-secret-panjang-abcdef';

// ---------- lingkungan dengan tab kegiatan ----------
const H = 4;                                  // baris header tab kegiatan (HEADER_ROW)
function kegiatanRow(o) {                     // 20 kolom: lihat COL di Code.gs
  const r = new Array(20).fill('');
  r[4] = o.item || 'Item'; r[8] = o.pic === undefined ? '' : o.pic; r[9] = o.estimasi || 1000000; r[10] = o.status || 'Draft';
  r[16] = o.nota || ''; r[17] = o.catatan || ''; r[19] = o.id === undefined ? '' : o.id;
  return r;
}
function freshEnv(rows) {
  const env = makeEnv({ SHARED_SECRET: SHARED, SECRET_ZERODEO: SECRET });
  const header = ['No', 'Tanggal Dicatat', 'Deadline Kegiatan', 'Project/Brand', 'Item Kegiatan', 'Kategori', 'Tipe', 'Jalur', 'PIC', 'Estimasi (Rp)', 'Status',
    'PIC Transaksi', 'Nominal Transfer (Rp)', 'Tgl Transfer', 'Actual (Rp)', 'Selisih (Rp)', 'Nota/Bukti', 'Catatan', 'Dana', 'ID'];
  const data = [[], [], [], header].concat(rows.map(kegiatanRow));
  env.sheets.kegiatan = makeSheet('kegiatan', data);
  return env;
}
const timRows = (list) => [['id', 'nama', 'peran', 'disinkron']].concat(list.map((t) => [t[0], t[1], t[2], 'x']));
const TIM = [['lenno', 'Lenno', 'admin'], ['ricko', 'Ricko', 'admin'], ['yanuar', 'Yanuar', 'anggota'], ['christina', 'Christina', 'anggota'], ['lemon', 'Lemon', 'approver']];
function withTim(env, list) { env.sheets.Tim = makeSheet('Tim', timRows(list || TIM)); }
function post(env, body) { return JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ secret: SHARED }, body)) } }).text); }
const as = (uid, peran) => ({ hub: { uid, peran } });
const setWho = (env, who) => { env.ctx.CURRENT_WHO_ = who; vm.runInContext('CURRENT_WHO_ = ' + JSON.stringify(who), env.ctx); };

/* ================= token ================= */
{
  const env = freshEnv([]);
  const tok = hubToken(SECRET, { uid: 'lemon', peran: 'approver' });
  const c = env.ctx.verifyHubToken_(tok);
  assert.strictEqual(c.uid, 'lemon'); assert.strictEqual(c.peran, 'approver'); ok('Apps Script memverifikasi token yang diterbitkan Hub (format sama)');
  assert.throws(() => env.ctx.verifyHubToken_(hubToken('rahasia-lain-yang-juga-panjang-9999', { uid: 'lemon', peran: 'approver' })), /Token tidak valid/); ok('token dengan rahasia lain ditolak');
  assert.throws(() => env.ctx.verifyHubToken_(hubToken(SECRET, { uid: 'lemon', peran: 'approver', app: 'depot' })), /Token tidak valid/); ok('token untuk app lain (depot) ditolak');
  assert.throws(() => env.ctx.verifyHubToken_(hubToken(SECRET, { uid: 'lemon', peran: 'approver' }, Date.now() - 13 * 3600 * 1000)), /Token tidak valid/); ok('token kedaluwarsa ditolak');
  const [p, s] = tok.split('.');
  const forged = Buffer.from(JSON.stringify(Object.assign(JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()), { peran: 'admin' }))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_') + '.' + s;
  assert.throws(() => env.ctx.verifyHubToken_(forged), /Token tidak valid/); ok('peran diubah di dalam token -> ditolak');
  const mine = env.ctx.makeHubToken_('zerodeo-service', 'service', 300);
  assert.strictEqual(env.ctx.verifyHubToken_(mine).peran, 'service'); ok('token servis buatan Apps Script terverifikasi');
  // proxy (Node) dan Apps Script sepakat
  assert.deepStrictEqual(proxy.verifyHubToken(tok, SECRET), { uid: 'lemon', peran: 'approver' }); ok('proxy (Node) memverifikasi token yang sama');
  assert.strictEqual(proxy.verifyHubToken(tok, 'salah'), null); assert.strictEqual(proxy.verifyHubToken(forged, SECRET), null); ok('proxy menolak rahasia salah dan token yang dipalsukan');
  assert.strictEqual(proxy.verifyHubToken(hubToken(SECRET, { uid: 'hub-service', peran: 'service' }), SECRET), null); ok('proxy menolak token servis dari browser');
  assert.strictEqual(proxy.verifyHubToken(hubToken(SECRET, { uid: 'lemon', peran: 'approver', app: 'depot' }), SECRET), null); ok('proxy menolak token app lain');
  assert.strictEqual(proxy.verifyHubToken(hubToken(SECRET, { uid: 'lemon', peran: 'approver' }, Date.now() - 13 * 3600 * 1000), SECRET), null); ok('proxy menolak token kedaluwarsa');
  assert.strictEqual(proxy.verifyHubToken(hubToken(SECRET, { uid: 'x', peran: 'bos' }), SECRET), null); ok('proxy menolak peran yang tidak dikenal');
}

/* ================= identitas & decider ================= */
{
  const env = freshEnv([]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(env.ctx.normalizeWho_({ uid: 'lemon', peran: 'approver' }))), { uid: 'lemon', peran: 'approver' });
  assert.strictEqual(env.ctx.normalizeWho_({ uid: 'lemon', peran: 'raja' }), null);
  assert.strictEqual(env.ctx.normalizeWho_({ uid: 'LEMON!', peran: 'approver' }), null);
  assert.strictEqual(env.ctx.normalizeWho_(null), null); assert.strictEqual(env.ctx.normalizeWho_('lemon'), null); ok('normalizeWho_: hanya bentuk yang benar yang diterima');
  setWho(env, null); assert(/Masuk lewat Hub/.test(env.ctx.checkDecider_())); ok('tanpa identitas -> tidak boleh memutuskan');
  setWho(env, { uid: 'yanuar', peran: 'anggota' }); assert(/approver atau admin/.test(env.ctx.checkDecider_())); ok('anggota -> tidak boleh memutuskan');
  setWho(env, { uid: 'lemon', peran: 'approver' }); assert.strictEqual(env.ctx.checkDecider_(), ''); ok('approver -> boleh');
  setWho(env, { uid: 'lenno', peran: 'admin' }); assert.strictEqual(env.ctx.checkDecider_(), ''); ok('admin -> boleh (cadangan)');
}

/* ================= PIC sebagai ID ================= */
{
  const env = freshEnv([]);
  assert.strictEqual(env.ctx.normalizePic_('Ricko'), 'ricko'); ok('tanpa tab Tim: cadangan mengenali nama lama (Ricko -> ricko)');
  assert.strictEqual(env.ctx.normalizePic_('lemon'), ''); ok('tanpa tab Tim: orang baru belum dikenal');
  withTim(env);
  env.ctx.TIM_MEMO_ = null; vm.runInContext('TIM_MEMO_ = null', env.ctx);
  assert.strictEqual(env.ctx.normalizePic_('Lemon'), 'lemon'); assert.strictEqual(env.ctx.normalizePic_('  RICKO '), 'ricko'); assert.strictEqual(env.ctx.normalizePic_('christina'), 'christina'); ok('dengan tab Tim: nama atau ID, huruf besar/kecil bebas, menjadi ID');
  assert.strictEqual(env.ctx.normalizePic_('hantu'), ''); assert.strictEqual(env.ctx.isKnownPic_(''), false); ok('PIC tidak dikenal atau kosong -> tidak valid');
  assert.deepStrictEqual(Array.from(env.ctx.resolvePicIds_('Ricko, yanuar, ricko, hantu')), ['ricko', 'yanuar']); ok('beberapa PIC: unik, yang tidak dikenal dibuang');
  assert.strictEqual(env.ctx.picNama_('lemon'), 'Lemon'); assert.strictEqual(env.ctx.picNama_('hantu'), 'hantu'); ok('picNama_: ID -> nama');
  assert.deepStrictEqual(Array.from(env.ctx.picIdList_()), ['lenno', 'ricko', 'yanuar', 'christina', 'lemon']); ok('picIdList_ mengikuti tab Tim');
}

/* ================= approve tanpa PIN ================= */
function setupApprove() {
  const env = freshEnv([
    { item: 'Sewa rak', status: 'Diajukan', pic: 'ricko', id: 'k-aaaaaaaaaa' },
    { item: 'Kegiatan Lemon', status: 'Diajukan', pic: 'lemon', id: 'k-bbbbbbbbbb' },
    { item: 'Nama lama', status: 'Diajukan', pic: 'Lenno', id: 'k-cccccccccc' },      // PIC lama berupa nama
    { item: 'Sudah jalan', status: 'Approved', pic: 'yanuar', id: 'k-dddddddddd' },
    { item: 'Draft Yanuar', status: 'Draft', pic: 'yanuar', id: 'k-ffffffffff' },
    { item: 'Dua PIC', status: 'Draft', pic: 'yanuar,christina', id: 'k-gggggggggg' },
  ]);
  withTim(env);
  return env;
}
const rowOf = (i) => H + 1 + i;
{
  let env = setupApprove();
  let r = post(env, { action: 'update_status', row: rowOf(0), status: 'Approved' });
  assert.strictEqual(r.ok, false); assert(/Masuk lewat Hub/.test(r.error)); ok('approve tanpa identitas (jalur kode tim) -> ditolak');
  r = post(env, Object.assign({ action: 'update_status', row: rowOf(0), status: 'Approved' }, as('yanuar', 'anggota')));
  assert(/approver atau admin/.test(r.error)); ok('approve oleh anggota -> ditolak');
  r = post(env, Object.assign({ action: 'update_status', row: rowOf(0), status: 'Approved', pin: '1234' }, as('lemon', 'approver')));
  assert.strictEqual(r.ok, true); assert.strictEqual(env.sheets.kegiatan.rows[rowOf(0) - 1][10], 'Approved'); ok('approve oleh approver -> berhasil, tanpa PIN');
  assert(/Approved oleh Lemon/.test(env.sheets.kegiatan.rows[rowOf(0) - 1][17])); ok('catatan kegiatan menyebut nama pemutus (bukan "Lemon" tetap)');

  env = setupApprove();
  r = post(env, Object.assign({ action: 'update_status', row: rowOf(1), status: 'Approved' }, as('lemon', 'approver')));
  assert(/tidak boleh memutuskan kegiatanmu sendiri/.test(r.error)); ok('approver tidak boleh meng-approve kegiatannya sendiri');
  r = post(env, Object.assign({ action: 'update_status', row: rowOf(1), status: 'Approved' }, as('ricko', 'admin')));
  assert.strictEqual(r.ok, true); ok('kegiatan Lemon (approver) di-approve admin Ricko');
  r = post(env, Object.assign({ action: 'update_status', row: rowOf(0), status: 'Approved' }, as('lenno', 'admin')));
  assert(/Admin hanya memutuskan kegiatan milik approver/.test(r.error)); assert.strictEqual(env.sheets.kegiatan.rows[rowOf(0) - 1][10], 'Diajukan'); ok('admin TIDAK boleh meng-approve kegiatan orang lain (bukan milik approver)');
  r = post(env, Object.assign({ action: 'update_status', row: rowOf(0), status: 'Ditolak' }, as('lenno', 'admin')));
  assert(/Admin hanya memutuskan/.test(r.error)); ok('admin juga tidak boleh me-reject kegiatan orang lain');
  r = post(env, Object.assign({ action: 'update_status', row: rowOf(2), status: 'Approved' }, as('lemon', 'approver')));
  assert.strictEqual(r.ok, true); ok('approver boleh memutuskan kegiatan siapa pun (termasuk PIC lama berupa nama)');
  env = setupApprove();
  r = post(env, Object.assign({ action: 'update_status', row: rowOf(2), status: 'Approved' }, as('lenno', 'admin')));
  assert(/kegiatanmu sendiri/.test(r.error)); ok('PIC lama berupa nama ("Lenno") tetap dikenali sebagai miliknya');
  r = post(env, Object.assign({ action: 'update_status', row: rowOf(3), status: 'Approved' }, as('lemon', 'approver')));
  assert(/bukan "Diajukan" lagi/.test(r.error)); ok('status bukan Diajukan -> ditolak');
  r = post(env, Object.assign({ action: 'update_status', row: rowOf(0), status: 'Selesai' }, as('lemon', 'approver')));
  assert(/Status tidak dikenali/.test(r.error)); ok('status di luar Approved/Ditolak/Revisi -> ditolak');
  r = post(env, Object.assign({ action: 'update_status', row: rowOf(0), status: 'Ditolak' }, as('lemon', 'approver')));
  assert.strictEqual(r.ok, true); assert.strictEqual(env.sheets.kegiatan.rows[rowOf(0) - 1][10], 'Ditolak'); ok('reject oleh approver -> berhasil');
}

/* ================= kepemilikan longgar: orang yang belum tersinkron ================= */
{
  // tab Tim belum ada: cadangan tidak memuat Lemon, tapi kegiatan "lemon" tetap dianggap miliknya
  const env = freshEnv([{ item: 'Kegiatan Lemon', status: 'Diajukan', pic: 'lemon', id: 'k-eeeeeeeeee' }]);
  let r = post(env, Object.assign({ action: 'update_status', row: rowOf(0), status: 'Approved' }, as('lemon', 'approver')));
  assert(/kegiatanmu sendiri/.test(r.error)); assert.strictEqual(env.sheets.kegiatan.rows[rowOf(0) - 1][10], 'Diajukan'); ok('tab Tim belum tersinkron: Lemon tetap tidak bisa meng-approve kegiatannya sendiri');
  r = post(env, Object.assign({ action: 'update_status', row: rowOf(0), status: 'Approved' }, as('lenno', 'admin')));
  assert(/Admin hanya memutuskan/.test(r.error)); ok('Tim belum tersinkron: admin belum bisa memutuskan (belum tahu Lemon approver)');
  withTim(env);
  r = post(env, Object.assign({ action: 'update_status', row: rowOf(0), status: 'Approved' }, as('lenno', 'admin')));
  assert.strictEqual(r.ok, true); ok('setelah Tim tersinkron: admin bisa memutuskan kegiatan Lemon');
  assert.deepStrictEqual(Array.from(env.ctx.ownerIds_('Lemon, ricko , LEMON')), ['lemon', 'ricko']); ok('ownerIds_: huruf kecil, unik, nilai yang belum dikenal tetap dihitung');
  const rows2 = [{ ID: 'k9', Status: 'Ditransfer', PIC: 'lemon', 'Nota/Bukti': '' }];
  assert.deepStrictEqual(Array.from(env.ctx.pendingKeysFor_(rows2, 'lemon', 'approver', [{ id: 'ricko', nama: 'Ricko', peran: 'admin' }])), ['z:lengkapi:k9']); ok('titik merah: kegiatan milik orang yang belum tersinkron tetap sampai ke pemiliknya');
}

/* ================= keamanan doPost ================= */
{
  const env = setupApprove();
  let out = JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify({ action: 'update_status', row: rowOf(0), status: 'Approved', secret: 'salah', hub: { uid: 'lemon', peran: 'approver' } }) } }).text);
  assert.strictEqual(out.error, 'unauthorized'); assert.strictEqual(env.sheets.kegiatan.rows[rowOf(0) - 1][10], 'Diajukan'); ok('mengaku approver tanpa SHARED_SECRET yang benar -> ditolak dan tidak ada yang berubah');
  out = post(env, Object.assign({ action: 'update_status', row: rowOf(0), status: 'Approved' }, { hub: { uid: 'lemon', peran: 'dewa' } }));
  assert(/Masuk lewat Hub/.test(out.error)); ok('peran palsu di body.hub dianggap tanpa identitas');
  // identitas tidak bocor antar request
  post(env, Object.assign({ action: 'update_status', row: rowOf(0), status: 'Approved' }, as('lemon', 'approver')));
  const out2 = post(env, { action: 'update_status', row: rowOf(1), status: 'Approved' });
  assert(/Masuk lewat Hub/.test(out2.error)); ok('identitas satu request tidak terbawa ke request berikutnya');
}

/* ================= ubah/batalkan: PIC, admin, approver ================= */
{
  const env = setupApprove();
  const st = (i) => env.sheets.kegiatan.rows[rowOf(i) - 1][10];
  let r = post(env, Object.assign({ action: 'cancel_kegiatan', row: rowOf(3), alasan: 'salah' }, as('yanuar', 'anggota')));
  assert(/approver atau admin/.test(r.error)); assert.strictEqual(st(3), 'Approved'); ok('PIC sendiri pun tidak bisa membatalkan kegiatan yang sudah Approved');
  r = post(env, Object.assign({ action: 'edit_kegiatan', row: rowOf(3), estimasi: 2000000 }, as('yanuar', 'anggota')));
  assert(/approver atau admin/.test(r.error)); ok('PIC sendiri tidak bisa mengedit kegiatan yang sudah Approved');
  r = post(env, Object.assign({ action: 'edit_kegiatan', row: rowOf(3), estimasi: 2000000 }, as('lemon', 'approver')));
  assert.strictEqual(r.ok, true); ok('approver bisa mengedit kegiatan Approved');
  r = post(env, Object.assign({ action: 'edit_kegiatan', row: rowOf(3), estimasi: 2100000 }, as('ricko', 'admin')));
  assert.strictEqual(r.ok, true); ok('admin bisa mengedit kegiatan Approved');

  // belum diputuskan: PIC-nya, admin, approver
  r = post(env, Object.assign({ action: 'edit_kegiatan', row: rowOf(0), estimasi: 1500000 }, as('yanuar', 'anggota')));
  assert(/Hanya PIC kegiatan ini, admin, atau approver/.test(r.error)); ok('anggota BUKAN PIC tidak bisa mengedit kegiatan orang lain (Diajukan milik Ricko)');
  r = post(env, Object.assign({ action: 'cancel_kegiatan', row: rowOf(0), alasan: 'iseng' }, as('yanuar', 'anggota')));
  assert(/Hanya PIC kegiatan ini/.test(r.error)); assert.strictEqual(st(0), 'Diajukan'); ok('anggota BUKAN PIC tidak bisa membatalkan kegiatan orang lain');
  r = post(env, Object.assign({ action: 'edit_kegiatan', row: rowOf(4), estimasi: 900000 }, as('christina', 'anggota')));
  assert(/Hanya PIC kegiatan ini/.test(r.error)); ok('Christina tidak bisa mengedit Draft milik Yanuar');
  r = post(env, Object.assign({ action: 'edit_kegiatan', row: rowOf(4), estimasi: 900000 }, as('yanuar', 'anggota')));
  assert.strictEqual(r.ok, true); ok('PIC (Yanuar) bisa mengedit kegiatannya sendiri yang belum diputuskan');
  r = post(env, Object.assign({ action: 'cancel_kegiatan', row: rowOf(4), alasan: 'batal' }, as('yanuar', 'anggota')));
  assert.strictEqual(r.ok, true); assert.strictEqual(st(4), 'Dibatalkan'); ok('PIC bisa membatalkan kegiatannya sendiri');
  r = post(env, Object.assign({ action: 'restore_kegiatan', row: rowOf(4) }, as('christina', 'anggota')));
  assert(/Hanya PIC kegiatan ini/.test(r.error)); assert.strictEqual(st(4), 'Dibatalkan'); ok('bukan PIC tidak bisa memulihkan');
  r = post(env, Object.assign({ action: 'restore_kegiatan', row: rowOf(4) }, as('yanuar', 'anggota')));
  assert.strictEqual(r.ok, true); assert.strictEqual(st(4), 'Draft'); ok('PIC bisa memulihkan kegiatannya sendiri');
  r = post(env, Object.assign({ action: 'edit_kegiatan', row: rowOf(4), estimasi: 800000 }, as('ricko', 'admin')));
  assert.strictEqual(r.ok, true); ok('admin bisa mengedit kegiatan anggota yang belum diputuskan');
  r = post(env, Object.assign({ action: 'edit_kegiatan', row: rowOf(4), estimasi: 700000 }, as('lemon', 'approver')));
  assert.strictEqual(r.ok, true); ok('approver bisa mengedit kegiatan anggota yang belum diputuskan');
  r = post(env, Object.assign({ action: 'edit_kegiatan', row: rowOf(5), estimasi: 500000 }, as('christina', 'anggota')));
  assert.strictEqual(r.ok, true); r = post(env, Object.assign({ action: 'edit_kegiatan', row: rowOf(5), estimasi: 400000 }, as('yanuar', 'anggota')));
  assert.strictEqual(r.ok, true); ok('dua PIC: masing-masing boleh mengedit');
  r = post(env, Object.assign({ action: 'edit_kegiatan', row: rowOf(5), estimasi: 300000 }, as('ricko', 'admin')));
  assert.strictEqual(r.ok, true);
  r = post(env, { action: 'edit_kegiatan', row: rowOf(4), estimasi: 100 });
  assert(/Masuk lewat Hub/.test(r.error)); ok('tanpa identitas (kode tim lama): tidak bisa mengedit');
  r = post(env, Object.assign({ action: 'edit_kegiatan', row: rowOf(1), pic: 'Christina' }, as('ricko', 'admin')));
  assert.strictEqual(r.ok, true); assert.strictEqual(env.sheets.kegiatan.rows[rowOf(1) - 1][8], 'christina'); ok('edit PIC memakai nama menyimpan ID ("christina")');
  r = post(env, Object.assign({ action: 'edit_kegiatan', row: rowOf(1), pic: 'hantu' }, as('ricko', 'admin')));
  assert(/PIC tidak dikenali/.test(r.error)); ok('PIC yang tidak dikenal ditolak');
}

/* ================= tanpa PIN: tidak ada sisa ================= */
{
  const env = setupApprove();
  assert.strictEqual(typeof env.ctx.checkPin_, 'undefined'); assert.strictEqual(typeof env.ctx.gantiPinLemon, 'undefined'); assert.strictEqual(typeof env.ctx.getApprovalPin, 'undefined'); ok('fungsi PIN (checkPin_, gantiPinLemon, getApprovalPin) sudah tidak ada');
}

/* ================= titik merah (pending) ================= */
{
  const tim = TIM.map((t) => ({ id: t[0], nama: t[1], peran: t[2] }));
  const env = freshEnv([]);
  const row = (o) => ({ ID: o.id, Status: o.status, PIC: o.pic, 'Nota/Bukti': o.nota || '' });
  const rows = [
    row({ id: 'k1', status: 'Diajukan', pic: 'ricko' }),
    row({ id: 'k2', status: 'Diajukan', pic: 'lemon' }),
    row({ id: 'k3', status: 'Ditransfer', pic: 'ricko' }),
    row({ id: 'k4', status: 'Selesai', pic: 'ricko', nota: '' }),
    row({ id: 'k5', status: 'Selesai', pic: 'ricko', nota: 'https://drive.google.com/x' }),
    row({ id: 'k6', status: 'Dibatalkan', pic: 'ricko' }),
    row({ id: '', status: 'Diajukan', pic: 'ricko' }),
    row({ id: 'k7', status: 'Approved', pic: 'ricko' }),
  ];
  const k = (uid, peran) => Array.from(env.ctx.pendingKeysFor_(rows, uid, peran, tim)).sort();
  assert.deepStrictEqual(k('lemon', 'approver'), ['z:approve:k1']); ok('Lemon (approver): hanya pengajuan orang lain (bukan miliknya)');
  assert.deepStrictEqual(k('lenno', 'admin'), ['z:approve:k2']); ok('Lenno (admin): hanya pengajuan milik approver (yang tidak bisa diputuskan sendiri oleh Lemon)');
  assert.deepStrictEqual(k('ricko', 'admin'), ['z:approve:k2', 'z:lengkapi:k3', 'z:nota:k4']); ok('Ricko: lengkapi + nota untuk miliknya, dan pengajuan Lemon sebagai admin');
  assert.deepStrictEqual(k('yanuar', 'anggota'), []); ok('anggota tanpa kegiatan sendiri: tidak ada titik');
  assert.strictEqual(k('ricko', 'admin').some((x) => x.includes('k5') || x.includes('k6') || x.includes('k7')), false); ok('nota sudah ada, dibatalkan, atau Approved belum ditransfer -> tidak ada titik');
  assert.strictEqual(k('lemon', 'approver').some((x) => x.endsWith(':')), false); ok('baris tanpa ID dilewati');
}
{
  const env = setupApprove();
  const call = (body) => JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  const svc = env.ctx.makeHubToken_('hub-service', 'service', 300);
  let r = call({ action: 'pending', token: svc, for_uid: 'lemon', for_peran: 'approver' });
  assert.strictEqual(r.ok, true); assert.deepStrictEqual(Array.from(r.keys), ['z:approve:k-aaaaaaaaaa', 'z:approve:k-cccccccccc']); ok('pending dengan token servis Hub -> kunci untuk Lemon (tanpa SHARED_SECRET)');
  assert.strictEqual(call({ action: 'pending', for_uid: 'lemon', for_peran: 'approver' }).error, 'unauthorized'); ok('pending tanpa token -> ditolak');
  assert.strictEqual(call({ action: 'pending', token: hubToken(SECRET, { uid: 'lemon', peran: 'approver' }), for_uid: 'lemon', for_peran: 'approver' }).error, 'unauthorized'); ok('pending dengan token pengguna (bukan servis) -> ditolak');
  assert.strictEqual(call({ action: 'pending', token: hubToken(SECRET, { uid: 'orang-lain', peran: 'service' }), for_uid: 'lemon', for_peran: 'approver' }).error, 'unauthorized'); ok('pending dengan token servis dari uid lain -> ditolak');
  assert.strictEqual(call({ action: 'pending', token: hubToken('rahasia-lain-yang-juga-panjang-9999', { uid: 'hub-service', peran: 'service' }), for_uid: 'lemon' }).error, 'unauthorized'); ok('pending dengan token servis berrahasia lain -> ditolak');
  assert.strictEqual(call({ action: 'update_status', token: svc, row: rowOf(0), status: 'Approved' }).error, 'unauthorized'); ok('token servis tidak membuka aksi lain (hanya pending)');
  assert(/tidak valid/.test(call({ action: 'pending', token: svc, for_uid: 'BAD UID' }).error)); ok('for_uid yang bentuknya salah -> ditolak');
}

/* ================= sinkron tim dari Hub ================= */
{
  const env = freshEnv([]);
  env.props.HUB_URL = 'https://hub.test/exec';
  let sent = null, reply;
  env.ctx.UrlFetchApp = { fetch: (url, opts) => { sent = { url, opts, body: JSON.parse(opts.payload) }; return { getContentText: () => JSON.stringify(reply) }; } };
  reply = { ok: true, users: [{ id: 'lemon', nama: 'Lemon', peran: 'approver' }, { id: 'ricko', nama: 'Ricko', peran: 'admin' }, { id: 'BAD ID', nama: 'X' }] };
  assert.strictEqual(env.ctx.syncTimDariHub(), 2); ok('sinkron tim: 2 anggota valid tersimpan (yang ID-nya rusak dibuang)');
  assert.strictEqual(sent.url, 'https://hub.test/exec'); assert.strictEqual(sent.body.action, 'usersForApp'); assert.strictEqual(sent.body.app, 'zerodeo'); ok('sinkron tim: memanggil action usersForApp untuk zerodeo');
  const c = require('./fake-google'); // verifikasi token servis yang dikirim
  assert.strictEqual(env.ctx.verifyHubToken_(sent.body.token).peran, 'service'); ok('sinkron tim: membawa token servis bertanda tangan SECRET_ZERODEO');
  assert.deepStrictEqual(env.sheets.Tim.rows.slice(1).map((r) => r.slice(0, 3)), [['lemon', 'Lemon', 'approver'], ['ricko', 'Ricko', 'admin']]); ok('tab Tim terisi sesuai Hub');
  reply = { ok: true, users: [] };
  assert.throws(() => env.ctx.syncTimDariHub(), /tidak mengembalikan anggota/); assert.strictEqual(env.sheets.Tim.rows.length, 3); ok('Hub menjawab daftar kosong -> tab Tim tidak dihapus');
  reply = { ok: false, error: 'unauthorized' };
  assert.throws(() => env.ctx.syncTimDariHub(), /unauthorized/); assert.strictEqual(env.sheets.Tim.rows.length, 3); ok('Hub menolak -> galat jelas, tab Tim tidak berubah');
  env.props.HUB_URL = '';
  assert.throws(() => env.ctx.syncTimDariHub(), /HUB_URL/); ok('HUB_URL belum diisi -> pesan jelas');
}
{
  // sinkron otomatis hanya saat tab Tim kosong, dan tidak lebih sering dari 10 menit
  const env = freshEnv([]);
  env.props.HUB_URL = 'https://hub.test/exec';
  let calls = 0;
  env.ctx.UrlFetchApp = { fetch: () => { calls++; return { getContentText: () => JSON.stringify({ ok: true, users: [{ id: 'lemon', nama: 'Lemon', peran: 'approver' }] }) }; } };
  env.ctx.maybeSyncTim_(); assert.strictEqual(calls, 1); ok('tab Tim kosong -> sinkron otomatis sekali');
  env.ctx.maybeSyncTim_(); assert.strictEqual(calls, 1); ok('sudah terisi -> tidak sinkron lagi');
  const env2 = freshEnv([]); env2.props.HUB_URL = 'https://hub.test/exec'; let c2 = 0;
  env2.ctx.UrlFetchApp = { fetch: () => { c2++; return { getContentText: () => JSON.stringify({ ok: false }) }; } };
  try { env2.ctx.maybeSyncTim_(); } catch (e) { /* galat dari Hub */ }
  env2.ctx.maybeSyncTim_(); assert.strictEqual(c2, 1); ok('gagal sinkron -> tidak dicoba lagi sampai 10 menit (tidak membebani Hub)');
}

{
  // sinkron otomatis: anggota baru di Hub, dan paling lama tiap 30 menit
  const env = freshEnv([]);
  env.props.HUB_URL = 'https://hub.test/exec'; env.props.SECRET_ZERODEO = SECRET;
  let calls = 0, users = [{ id: 'lemon', nama: 'Lemon', peran: 'approver' }];
  env.ctx.UrlFetchApp = { fetch: () => { calls++; return { getContentText: () => JSON.stringify({ ok: true, users }) }; } };
  env.ctx.maybeSyncTim_(); assert.strictEqual(calls, 1);
  env.ctx.maybeSyncTim_(); assert.strictEqual(calls, 1); ok('tab Tim terisi dan baru disinkron: tidak sinkron lagi');
  users = [{ id: 'lemon', nama: 'Lemon', peran: 'approver' }, { id: 'baru', nama: 'Baru', peran: 'anggota' }];
  setWho(env, { uid: 'baru', peran: 'anggota' });
  delete env.cache['tim_try'];
  env.ctx.maybeSyncTim_(); assert.strictEqual(calls, 2);
  assert.deepStrictEqual(env.sheets.Tim.rows.slice(1).map((r) => r[0]), ['lemon', 'baru']); ok('anggota baru di Hub membuka Zerodeo -> tab Tim langsung disinkron otomatis (tanpa pemicu harian)');
  setWho(env, { uid: 'baru', peran: 'anggota' });
  env.ctx.maybeSyncTim_(); assert.strictEqual(calls, 2); ok('sudah dikenal dan masih segar -> tidak sinkron');
  delete env.cache['tim_fresh']; delete env.cache['tim_try'];
  env.ctx.maybeSyncTim_(); assert.strictEqual(calls, 3); ok('lewat 30 menit -> sinkron lagi sendiri');
  env.ctx.UrlFetchApp = { fetch: () => { throw new Error('Hub mati'); } };
  delete env.cache['tim_fresh']; delete env.cache['tim_try'];
  assert.doesNotThrow(() => env.ctx.maybeSyncTim_()); assert.strictEqual(env.sheets.Tim.rows.length, 3); ok('Hub mati -> tidak melempar galat, tab Tim lama tetap dipakai');
  let n = 0; env.ctx.UrlFetchApp = { fetch: () => { n++; throw new Error('Hub mati'); } };
  env.ctx.maybeSyncTim_(); env.ctx.maybeSyncTim_(); env.ctx.maybeSyncTim_(); assert(n <= 1); ok('Hub mati -> tidak dicoba berulang-ulang (maks sekali per 2 menit)');
}
{
  // lewat doPost: pengguna baru yang token-nya sah memicu sinkron sebelum data dilayani
  const env = freshEnv([]);
  env.props.HUB_URL = 'https://hub.test/exec';
  let calls = 0;
  env.ctx.UrlFetchApp = { fetch: () => { calls++; return { getContentText: () => JSON.stringify({ ok: true, users: [{ id: 'lemon', nama: 'Lemon', peran: 'approver' }] }) }; } };
  post(env, Object.assign({ action: 'get_data' }, as('lemon', 'approver')));   // isi respons tidak diperiksa di sini (Sheet tiruan minim); yang diuji: sinkron terjadi sebelum data dilayani
  assert(calls >= 1); assert(env.sheets.Tim && env.sheets.Tim.rows.length === 2); ok('doPost get_data: tab Tim terisi otomatis dari Hub');
}

/* ================= peran marketing (videografer, vendor) ================= */
{
  const env = setupApprove();
  env.ctx.cachePut_(JSON.stringify({ kegiatan: [{ 'Item Kegiatan': 'RAHASIA-UANG' }], dana: [], plafon_fixed: [] }));   // cache bersama berisi data uang
  const mk = as('vendor', 'marketing');
  const g = post(env, Object.assign({ action: 'get_data' }, mk));
  const txt = JSON.stringify(g);
  assert.strictEqual(g.marketing_only, true);
  ['strategi', 'lane', 'channel', 'hasil_event', 'tim'].forEach((k) => assert(Array.isArray(g[k]), k));
  ['kegiatan', 'plafon_fixed', 'dana', 'kategori'].forEach((k) => assert(!(k in g), 'tidak boleh ada ' + k));
  assert(!/RAHASIA-UANG|Sewa rak|Kegiatan Lemon|Sudah jalan/.test(txt)); ok('marketing: get_data hanya berisi modul Marketing + tim (tidak ada kegiatan, dana, plafon, kategori)');
  assert(!/Estimasi|Nominal|Actual|nota/i.test(txt)); ok('marketing: tidak ada kolom uang sama sekali di jawaban');
  const norm = post(env, Object.assign({ action: 'get_data' }, as('ricko', 'anggota')));
  assert(/RAHASIA-UANG/.test(JSON.stringify(norm))); ok('anggota biasa tetap menerima data lengkap (cache tidak diganggu)');
  const before = JSON.stringify(env.sheets.kegiatan.rows);
  [{ action: 'update_status', row: rowOf(0), status: 'Approved' }, { action: 'mark_transferred', row: rowOf(3) }, { action: 'complete_kegiatan', row: rowOf(3) },
    { action: 'add_kegiatan', item: 'X', estimasi: 1000, pic: 'ricko' }, { action: 'add_dana', nama: 'D', nominal: 1000 }, { action: 'edit_kegiatan', row: rowOf(0), item: 'diubah' }]
    .forEach((a) => { const r = post(env, Object.assign(a, mk)); assert.strictEqual(r.ok, false); assert(/hanya boleh memakai modul Marketing/.test(r.error), a.action + ': ' + r.error); });
  assert.strictEqual(JSON.stringify(env.sheets.kegiatan.rows), before); ok('marketing: semua aksi uang/kegiatan ditolak server dan Sheet kegiatan tidak berubah');
  const s = post(env, Object.assign({ action: 'add_strategi', nama: 'Video peluncuran', pesan: 'Pesan inti', lane: ['Crystal Glow'], channel: ['TikTok'], mulai: '2030-01-01', pic: 'ricko' }, mk));
  assert.strictEqual(s.ok, true, s.error); ok('marketing: boleh mencatat strategi');
  const e = post(env, Object.assign({ action: 'add_hasil_event', nama: 'Event X', tanggal: '2030-01-02', channel: 'TikTok', pic: 'ricko', hadir: 10 }, mk));
  assert.strictEqual(e.ok, true, e.error); ok('marketing: boleh mencatat hasil event');
  const after = post(env, Object.assign({ action: 'get_data' }, mk));
  assert(after.strategi.length >= 1 && after.hasil_event.length >= 1); ok('marketing: catatan barunya terlihat');
  // titik merah: marketing tidak punya
  assert.deepStrictEqual(Array.from(env.ctx.pendingKeysFor_(env.ctx.sheetToObjects(env.sheets.kegiatan), 'ricko', 'marketing', env.ctx.readTim_())), []); ok('marketing: tidak ada titik merah uang');
  // proxy menerima token peran marketing
  const tok = hubToken(SECRET, { uid: 'vendor', peran: 'marketing' });
  assert.deepStrictEqual(proxy.verifyHubToken(tok, SECRET), { uid: 'vendor', peran: 'marketing' }); ok('proxy: token peran marketing diterima');
}

/* ================= log aktivitas ================= */
{
  const env = setupApprove();
  post(env, Object.assign({ action: 'update_status', row: rowOf(0), status: 'Approved', pin: '9999' }, as('lemon', 'approver')));
  const log = env.sheets.log_aktivitas;
  assert(log && log.rows.length === 2); ok('aksi berhasil -> tab log_aktivitas dibuat dan diisi');
  assert.strictEqual(log.protectedWarn, true); ok('tab log diberi peringatan saat diedit');
  const [, who, peran, aksi, id, rincian] = log.rows[1];
  assert.strictEqual(who, 'lemon'); assert.strictEqual(peran, 'approver'); assert.strictEqual(aksi, 'update_status'); assert.strictEqual(id, 'k-aaaaaaaaaa'); ok('log mencatat siapa, peran, aksi, dan ID kegiatan');
  assert(/"status":"Approved"/.test(rincian) && !/9999|secret|hub/.test(rincian)); ok('rincian log memuat status, tidak memuat PIN/secret/identitas');
  post(env, Object.assign({ action: 'update_status', row: rowOf(1), status: 'Approved' }, as('lemon', 'approver')));   // ditolak (milik sendiri)
  assert.strictEqual(log.rows.length, 2); ok('aksi yang ditolak tidak dicatat sebagai berhasil');
  post(env, { action: 'cancel_kegiatan', row: rowOf(0), alasan: 'x' });   // tanpa identitas, sudah Approved -> ditolak
  assert.strictEqual(log.rows.length, 2);
  const tolak = post(env, { action: 'cancel_kegiatan', row: rowOf(2), alasan: 'salah ketik' });   // Diajukan, jalur tanpa identitas -> sekarang ditolak
  assert(/Masuk lewat Hub/.test(tolak.error)); assert.strictEqual(log.rows.length, 2); ok('jalur kode tim lama (tanpa identitas) tidak bisa membatalkan lagi, dan tidak dicatat');
  post(env, Object.assign({ action: 'cancel_kegiatan', row: rowOf(2), alasan: 'salah ketik' }, as('ricko', 'admin')));
  assert.strictEqual(log.rows[2][1], 'ricko'); assert.strictEqual(log.rows[2][2], 'admin'); ok('pembatalan oleh admin dicatat lengkap dengan siapa dan perannya');
  env.sheets.kegiatan.rows[rowOf(3) - 1][10] = 'Ditransfer';
  const before = log.rows.length;
  const done = post(env, Object.assign({ action: 'complete_kegiatan', row: rowOf(3), actual: 900000 }, as('yanuar', 'anggota')));
  assert.strictEqual(done.ok, true); assert.strictEqual(log.rows.length, before + 1);
  assert.strictEqual(log.rows[log.rows.length - 1][3], 'complete_kegiatan'); assert.strictEqual(log.rows[log.rows.length - 1][2], 'anggota'); ok('aksi lain (complete_kegiatan) juga dicatat, dengan peran pelaku');
  const big = 'x'.repeat(5000);
  const sum = env.ctx.logSummary_({ action: 'x', status: 'Approved', item: big, pic: 'ricko', photoBase64: big, pin: '1234', secret: 'rahasia', hub: { uid: 'lemon' }, rows: [1, 2, 3] });
  assert(sum.length <= 300); assert(!/photoBase64|pin|secret|hub|1234|rahasia/.test(sum)); assert(/"baris":3/.test(sum)); ok('ringkasan log: dibatasi 300 karakter, tanpa foto/PIN/secret/identitas, memuat jumlah baris');
}
{
  // gagal mencatat log tidak boleh menggagalkan aksi
  const env = setupApprove();
  env.ctx.ensureLogTab_ = () => { throw new Error('log rusak'); };
  const r = post(env, Object.assign({ action: 'update_status', row: rowOf(0), status: 'Approved' }, as('lemon', 'approver')));
  assert.strictEqual(r.ok, true); ok('log gagal ditulis -> aksinya tetap berhasil');
}

/* ================= payload ================= */
{
  const env = setupApprove();
  vm.runInContext("sheetToObjects = function () { return []; }; getKategoriList = function () { return []; }; getDanaData_ = function () { return []; }; mkt_getData = function () { return {}; };", env.ctx);
  const p = env.ctx.buildPayload_();
  assert(Array.isArray(p.tim) && p.tim.length === 5 && p.tim[0].id === 'lenno'); ok('payload dashboard membawa daftar tim (id, nama, peran)');
  assert.strictEqual(p.versi, '2026-10-18 aturan-peran'); ok('versi kode ikut naik');
  const appJs = require('fs').readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
  assert.strictEqual(/const EXPECTED_VERSI = '([^']+)'/.exec(appJs)[1], p.versi); ok('EXPECTED_VERSI di app.js sama dengan KODE_VERSI di Code.gs (tidak ada banner versi palsu)');
}

/* ================= proxy: masuk lewat token Hub ================= */
function mkRes() {
  const r = { code: 200, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; };
  return r;
}
async function callProxy(req, env) {
  const keys = ['TEAM_CODE', 'APPS_SCRIPT_URL', 'SHARED_SECRET', 'SECRET_ZERODEO'];
  const saved = {}; keys.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
  Object.assign(process.env, env);
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { text: async () => '{"ok":true}' }; };
  const res = mkRes();
  await proxy(Object.assign({ headers: {}, method: 'GET', url: '/api/proxy', query: {} }, req), res);
  keys.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  return { res, calls };
}
const PENV = { APPS_SCRIPT_URL: 'https://script.google.com/macros/s/ABC/exec', SHARED_SECRET: SHARED, SECRET_ZERODEO: SECRET };

(async () => {
  const tok = hubToken(SECRET, { uid: 'lemon', peran: 'approver' });
  let r = await callProxy({ headers: { 'x-hub-token': tok }, method: 'POST', body: { action: 'update_status', row: 5, status: 'Approved', hub: { uid: 'penyusup', peran: 'approver' }, secret: 'palsu' } }, PENV);
  let b = JSON.parse(r.calls[0].opts.body);
  assert.deepStrictEqual(b.hub, { uid: 'lemon', peran: 'approver' }); assert.strictEqual(b.secret, SHARED); ok('proxy: token sah -> identitas dari token diteruskan; "hub" dan "secret" kiriman browser ditimpa');
  r = await callProxy({ headers: { 'x-hub-token': tok }, method: 'GET', query: { fresh: '1' } }, PENV);
  b = JSON.parse(r.calls[0].opts.body);
  assert.deepStrictEqual(b, { action: 'get_data', fresh: true, secret: SHARED, hub: { uid: 'lemon', peran: 'approver' } }); ok('proxy: GET dengan token -> get_data membawa identitas');

  r = await callProxy({ headers: { 'x-hub-token': tok.slice(0, -3) + 'abc' }, method: 'GET' }, PENV);
  assert.strictEqual(r.res.code, 401); assert.strictEqual(r.res.body.code, 'LOGIN_HUB'); assert.strictEqual(r.calls.length, 0); ok('proxy: token rusak -> 401 LOGIN_HUB, Apps Script tidak dipanggil');
  r = await callProxy({ headers: { 'x-hub-token': hubToken(SECRET, { uid: 'lemon', peran: 'approver' }, Date.now() - 13 * 3600 * 1000) }, method: 'GET' }, PENV);
  assert.strictEqual(r.res.code, 401); assert.strictEqual(r.calls.length, 0); ok('proxy: token kedaluwarsa -> 401');
  r = await callProxy({ headers: {}, method: 'GET' }, PENV);
  assert.strictEqual(r.res.code, 401); assert.strictEqual(r.res.body.code, 'LOGIN_HUB'); assert.strictEqual(r.calls.length, 0); ok('proxy: tanpa token dan tanpa TEAM_CODE -> 401 "Masuk lewat Hub"');
  r = await callProxy({ headers: { 'x-team-code': 'apa-saja' }, method: 'GET' }, PENV);
  assert.strictEqual(r.res.code, 401); ok('proxy: kode tim kiriman tidak diterima kalau TEAM_CODE sudah dihapus dari env');

  r = await callProxy({ headers: { 'x-team-code': 'kode-lama-panjang' }, method: 'POST', body: { action: 'add_dana' } }, Object.assign({ TEAM_CODE: 'kode-lama-panjang' }, PENV));
  b = JSON.parse(r.calls[0].opts.body);
  assert.strictEqual(b.hub, null); ok('proxy: masa transisi (TEAM_CODE masih ada) -> boleh, tapi tanpa identitas');
  r = await callProxy({ headers: { 'x-team-code': 'salah', 'x-hub-token': '' }, method: 'GET' }, Object.assign({ TEAM_CODE: 'kode-lama-panjang' }, PENV));
  assert.strictEqual(r.res.code, 401); ok('proxy: masa transisi, kode tim salah -> 401');
  r = await callProxy({ headers: { 'x-hub-token': tok, 'x-team-code': 'kode-lama-panjang' }, method: 'POST', body: { action: 'update_status' } }, Object.assign({ TEAM_CODE: 'kode-lama-panjang' }, PENV));
  assert.deepStrictEqual(JSON.parse(r.calls[0].opts.body).hub, { uid: 'lemon', peran: 'approver' }); ok('proxy: token Hub didahulukan atas kode tim');
  r = await callProxy({ headers: { 'x-hub-token': 'ngawur', 'x-team-code': 'kode-lama-panjang' }, method: 'GET' }, Object.assign({ TEAM_CODE: 'kode-lama-panjang' }, PENV));
  assert.strictEqual(r.res.code, 401); ok('proxy: token Hub salah tidak bisa "turun" ke kode tim');
  r = await callProxy({ headers: { 'x-hub-token': tok }, method: 'GET' }, { APPS_SCRIPT_URL: PENV.APPS_SCRIPT_URL, SHARED_SECRET: SHARED });
  assert.strictEqual(r.res.code, 500); assert.strictEqual(r.calls.length, 0); ok('proxy: tanpa SECRET_ZERODEO dan tanpa TEAM_CODE -> 500 (salah konfigurasi)');

  console.log('\n' + n + ' pemeriksaan lolos');
})().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });

