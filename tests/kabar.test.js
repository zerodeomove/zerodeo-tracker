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
const kabar = [], sinkron = [];
let tugasHub = [];
e.ctx.UrlFetchApp = { fetch: (url, o) => { const b = JSON.parse(o.payload); if (b.action === 'kabarApp') kabar.push(b); if (b.action === 'sinkronTugas') sinkron.push(...b.items);
  if (b.action === 'tugasUntukApp') return { getContentText: () => JSON.stringify({ ok: true, tugas: tugasHub }) };
  return { getContentText: () => JSON.stringify({ ok: true, terkirim: 1 }) }; } };
const postMentah = (body, uid, peran) => JSON.parse(e.ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ secret: SHARED, hub: { uid, peran } }, body)) } }).text);
// web: simpan dulu (kabar hanya antre), lalu "kirim_kabar" di belakang seperti yang dilakukan app.js
const post = (body, uid, peran) => { const n0 = kabar.length; const r = postMentah(body, uid, peran); assert.strictEqual(kabar.length, n0, 'simpanan web tidak boleh menunggu kabar'); postMentah({ action: 'kirim_kabar' }, uid, peran); return r; };
const svc = (body) => JSON.parse(e.ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ token: hubToken(SECRET, { uid: 'hub-service', peran: 'service' }) }, body)) } }).text);
let ba;
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
// sinkron ke Tracker: strategi & seeding -> item untuk Hub (sinkronTugas)
const tolak = [];
e.ctx.UrlFetchApp = { fetch: (url, o) => { const b = JSON.parse(o.payload); if (b.action === 'sinkronTugas') sinkron.push(...b.items); if (b.action === 'tugasUntukApp') return { getContentText: () => JSON.stringify({ ok: true, tugas: tugasHub }) };
  if (b.action === 'tolakTugasApp') { tolak.push(b.tugas_id); return { getContentText: () => JSON.stringify({ ok: true, judul: 'Briefing' }) }; } return { getContentText: () => '{"ok":true}' }; } };
sinkron.length = 0;
r = post({ action: 'add_strategi', nama: 'Run club Desember', pesan: 'Lari bareng', lane: ['Vital Fresh'], channel: ['Komunitas Lari'], mulai: '2026-12-01', selesai: '2026-12-20', pic: 'yanuar', status: 'Ide', tugas_id: 't-abc' }, 'yanuar', 'anggota');
assert.strictEqual(r.ok, true, r.error);
let si = sinkron.find((x) => x.jenis === 'strategi');
assert(si && si.judul === 'Run club Desember' && si.pic === 'yanuar' && si.mulai === '2026-12-01' && si.deadline === '2026-12-20' && si.status === 'Ide' && si.kalender === true && si.tugas_id === 't-abc', JSON.stringify(si)); ok('strategi baru -> dikirim ke Tracker (kalender nyala bawaan, tautan ke tugas Tracker asal)');
sinkron.length = 0;
post({ action: 'update_strategi_status', id: r.id, status: 'Jalan' }, 'yanuar', 'anggota');
assert(sinkron.length === 1 && sinkron[0].status === 'Jalan' && sinkron[0].tugas_id === ''); ok('status strategi berubah -> ikut ke Tracker');
sinkron.length = 0;
r = post({ action: 'add_seeding', nama: 'Seeding Kalender', pic: 'yanuar', batas: 7, kreator: '@x' }, 'yanuar', 'anggota');
si = sinkron.find((x) => x.jenis === 'seeding');
assert(si && si.judul === 'Seeding: Seeding Kalender' && si.kalender === false && si.status === 'Diajukan' && /^\d{4}-\d{2}-\d{2}$/.test(si.deadline), JSON.stringify(si)); ok('seeding -> tugas Tracker tanpa kalender (bawaan), tenggat = kirim sampel + batas posting');
sinkron.length = 0;
post({ action: 'update_seeding', id: r.id, kalender: true }, 'yanuar', 'anggota');
assert(sinkron[0] && sinkron[0].kalender === true); ok('seeding dimasukkan ke Kalender Tim lewat ubah');
// tanggal strategi: dari web Zerodeo dan dari Tracker (lewat bot_aksi tanggal_strategi) -> tugas Tracker ikut
const idSt = e.sheets.strategi.rows.find((x) => x[1] === 'Run club Desember')[0];
sinkron.length = 0;
r = post({ action: 'update_strategi_tanggal', id: idSt, mulai: '2026-12-05', selesai: '2026-12-27' }, 'yanuar', 'anggota');
assert.strictEqual(r.ok, true, r.error); assert(sinkron[0] && sinkron[0].mulai === '2026-12-05' && sinkron[0].deadline === '2026-12-27'); ok('ubah tanggal strategi di Zerodeo -> tugas Tracker ikut');
r = post({ action: 'update_strategi_tanggal', id: idSt, mulai: '2026-12-10', selesai: '2026-12-01' }, 'yanuar', 'anggota');
assert.strictEqual(r.ok, false); ok('selesai sebelum mulai: ditolak');
ba = svc({ action: 'bot_aksi', for_uid: 'lenno', for_peran: 'admin', aksi: { jenis: 'tanggal_strategi', id: idSt, selesai: '2026-12-30' } });
assert.strictEqual(ba.ok, true, ba.error); const rowSt = e.sheets.strategi.rows.find((x) => x[0] === idSt);
assert.strictEqual(e.ctx.zTgl_(rowSt[6]), '2026-12-30'); assert.strictEqual(e.ctx.zTgl_(rowSt[5]), '2026-12-05'); ok('dari Tracker (bot_aksi tanggal_strategi): tanggal selesai berubah, mulai tetap');
tugasHub = [{ id: 't-1', judul: 'Briefing', pic: ['yanuar'], mulai: '2026-12-01', deadline: '2026-12-02', status: 'To do' }];
const tt = postMentah({ action: 'tugas_tracker' }, 'vendor', 'marketing');
assert(tt.ok && tt.tugas.length === 1 && tt.tugas[0].judul === 'Briefing'); ok('tugas Tracker project Zerodeo terbaca di Zerodeo (juga untuk peran marketing)');
// sinkron semua (sekali jalan): yang lama tanpa pilihan kalender -> tidak masuk kalender
const hS = e.sheets.strategi.rows[0];
const lamaRow = new Array(hS.length).fill(''); lamaRow[hS.indexOf('ID')] = 'S-lama'; lamaRow[hS.indexOf('Nama Strategi')] = 'Strategi lama'; lamaRow[hS.indexOf('Mulai')] = '2026-10-01'; lamaRow[hS.indexOf('PIC')] = 'yanuar'; lamaRow[hS.indexOf('Status')] = 'Jalan';
e.sheets.strategi.rows.push(lamaRow);
r = post({ action: 'sinkron_semua' }, 'yanuar', 'anggota');
assert.strictEqual(r.ok, false); ok('sinkron semua: anggota ditolak (approver / admin saja)');
sinkron.length = 0;
r = postMentah({ action: 'sinkron_semua' }, 'lemon', 'approver');
assert.strictEqual(r.ok, true, r.error);
const sl = sinkron.find((x) => x.id === 'S-lama');
assert(sl && sl.kalender === false && sl.status === 'Jalan', JSON.stringify(sl)); assert.strictEqual(e.sheets.strategi.rows.find((x) => x[0] === 'S-lama')[hS.indexOf('Kalender')], 'tidak');
assert(sinkron.some((x) => x.jenis === 'seeding') && !sinkron.some((x) => x.status === 'Selesai')); ok('sinkron semua: strategi & seeding aktif terkirim; yang lama tidak masuk kalender (ditandai "tidak"), yang Selesai dilewati');
sinkron.length = 0;
r = post({ action: 'update_strategi_tanggal', id: 'S-lama', kalender: true }, 'yanuar', 'anggota');
assert.strictEqual(r.ok, true, r.error); assert(sinkron[0] && sinkron[0].kalender === true && sinkron[0].mulai === '2026-10-01'); ok('strategi lama dimasukkan ke Kalender Tim belakangan (tanggal tetap)');
r = postMentah({ action: 'tolak_tugas_tracker', id: 't-1' }, 'vendor', 'marketing');
assert(r.ok && tolak[0] === 't-1' && /tidak ditampilkan lagi/.test(r.message)); ok('✕ tugas Tracker di Marketing: siapa pun boleh (termasuk peran marketing), diteruskan ke Hub');
// strategi: PIC lebih dari satu, ubah isi strategi (web & bot), Tracker ikut
sinkron.length = 0;
r = post({ action: 'add_strategi', nama: 'Strategi duo', pesan: 'Dua PIC', lane: ['Vital Fresh'], channel: ['TikTok'], mulai: '2026-12-02', pic: ['yanuar', 'ricko'], status: 'Ide' }, 'yanuar', 'anggota');
assert.strictEqual(r.ok, true, r.error);
const rowDuo = e.sheets.strategi.rows.find((x) => x[0] === r.id), hS2 = e.sheets.strategi.rows[0];
assert.strictEqual(rowDuo[hS2.indexOf('PIC')], 'yanuar, ricko'); assert.strictEqual(sinkron.find((x) => x.id === r.id).pic, 'yanuar,ricko'); ok('strategi dengan 2 PIC tersimpan, keduanya dapat tugas Tracker');
sinkron.length = 0;
let r2 = post({ action: 'update_strategi', id: r.id, nama: 'Strategi duo (revisi)', pesan: 'Pesan baru', lane: ['Vital Fresh'], channel: ['TikTok', 'Instagram'], mulai: '2026-12-03', selesai: '2026-12-10', pic: ['ricko'], status: 'Jalan', kalender: true }, 'yanuar', 'anggota');
assert.strictEqual(r2.ok, true, r2.error);
const rowDuo2 = e.sheets.strategi.rows.find((x) => x[0] === r.id);
assert.strictEqual(rowDuo2[hS2.indexOf('Nama Strategi')], 'Strategi duo (revisi)'); assert.strictEqual(rowDuo2[hS2.indexOf('PIC')], 'ricko'); assert.strictEqual(rowDuo2[hS2.indexOf('Channel')], 'TikTok, Instagram');
const sd2 = sinkron.find((x) => x.id === r.id); assert(sd2 && sd2.judul === 'Strategi duo (revisi)' && sd2.pic === 'ricko' && sd2.deadline === '2026-12-10' && sd2.kalender === true); ok('ubah strategi (nama, pesan, channel, tanggal, PIC, status, kalender) + tugas Tracker ikut');
r2 = post({ action: 'update_strategi', id: r.id, pic: [] }, 'yanuar', 'anggota'); assert.strictEqual(r2.ok, false); ok('ubah strategi tanpa PIC ditolak');
ba = svc({ action: 'bot_aksi', for_uid: 'lenno', for_peran: 'admin', aksi: { jenis: 'ubah_strategi', id: r.id, pesan: 'Lewat bot', pic: 'yanuar, ricko' } });
assert.strictEqual(ba.ok, true, ba.error); assert.strictEqual(e.sheets.strategi.rows.find((x) => x[0] === r.id)[hS2.indexOf('PIC')], 'yanuar, ricko'); ok('bot: ubah strategi (PIC banyak)');
r2 = post({ action: 'add_seeding', nama: 'Seeding dua PIC', pic: ['yanuar', 'lemon'], kreator: '@q' }, 'yanuar', 'anggota');
assert.strictEqual(r2.ok, true, r2.error); assert.strictEqual(e.sheets.seeding.rows.find((x) => x[0] === r2.id)[8], 'yanuar, lemon'); ok('seeding dengan 2 PIC');
console.log('\n' + n + ' tes lolos');
