/**
 * Marketing.gs — modul marketing Zerodeo (FILE TERPISAH dari Code.gs)
 * ---------------------------------------------------------------------
 * Di project Apps Script: tombol "+" di sebelah Files -> Script -> beri nama
 * "Marketing" -> paste seluruh isi file ini. Code.gs tidak perlu ditimpa,
 * cukup 3 hook kecil (lihat bagian HOOK di bawah).
 *
 * Tab Sheet (strategi, lane, channel, hasil_event) dibuat OTOMATIS saat
 * pertama kali dipanggil, lengkap dengan isi awal lane/channel. Tidak ada
 * langkah setup manual.
 *
 * Header tab marketing ada di baris 1 dan data ditambah lewat appendRow,
 * jadi tidak ada batas 60 baris seperti tab kegiatan.
 *
 * ===== HOOK yang perlu ditambah di Code.gs (3 tempat) =====
 *
 * 1) doGet(e) — paling atas:
 *      if (!isAuthorized_(e && e.parameter && e.parameter.secret)) {
 *        return jsonResponse({ ok: false, error: 'unauthorized' });
 *      }
 *    lalu sebelum `return jsonResponse(payload)`:
 *      var m = mkt_getData();
 *      payload.strategi = m.strategi;
 *      payload.lane = m.lane;
 *      payload.channel = m.channel;
 *      payload.hasil_event = m.hasil_event;
 *
 * 2) doPost(e) — setelah `var data = JSON.parse(e.postData.contents);`:
 *      if (!isAuthorized_(data.secret)) {
 *        return jsonResponse({ ok: false, error: 'unauthorized' });
 *      }
 *      var mres = mkt_handlePost(data);
 *      if (mres) return jsonResponse(mres);
 *
 * (Pengecekan PIN approve sudah tidak ada: peran approver/admin dari token Hub, lihat Hub.gs.)
 *
 * ===== KUNCI (Project Settings -> Script Properties) =====
 *   SHARED_SECRET : string acak panjang, sama persis dengan env Vercel.
 *                   WAJIB diisi: kalau kosong, semua panggilan ditolak (tertutup bawaan).
 *   BLOCK_GET     : isi 1 untuk mematikan jalur GET (pembacaan data lewat URL).
 *                   Isi setelah proxy Vercel versi POST terpasang.
 *   NOTA_FOLDER_ID: ID folder Drive tempat foto nota (tidak ditulis di kode).
 *   SECRET_ZERODEO, HUB_URL : lihat Hub.gs.
 */

var MKT_TABS = {
  strategi: ['ID', 'Nama Strategi', 'Lane', 'Pesan Inti', 'Channel', 'Mulai', 'Selesai', 'PIC', 'Status', 'Dicatat Pada'],
  lane: ['Lane'],
  channel: ['Channel'],
  hasil_event: ['ID', 'Tanggal Event', 'Nama Event', 'Channel', 'Nama Komunitas', 'Kode Voucher',
                'Hadir', 'Coba Produk', 'Tanya Beli Di Mana', 'Order via Kode', 'Konten UGC',
                'Strategi', 'PIC Pencatat', 'Dicatat Pada', 'Kegiatan'],
  // Seeding: satu batch (diajukan tim, di-acc approver/admin) berisi daftar kreator yang dikirimi sampel
  seeding: ['ID', 'Nama Batch', 'Produk', 'Lane', 'Platform', 'Estimasi (Rp)', 'Batas Posting (hari)', 'Status', 'PIC', 'Diajukan Oleh',
            'Diputuskan Oleh', 'Catatan', 'Dicatat Pada', 'Kegiatan', 'Strategi'],
  seeding_kreator: ['ID', 'Batch', 'Nama', 'Akun', 'Platform', 'Status', 'Tgl Kirim', 'Tgl Terima', 'Tgl Posting', 'Link Konten', 'Views', 'Catatan', 'Diubah']
};
var SEED_STATUS = ['Diajukan', 'Revisi', 'Approved', 'Ditolak', 'Jalan', 'Selesai'];
var KREATOR_STATUS = ['Rencana', 'Dikirim', 'Diterima', 'Posting', 'Tidak posting'];
var SEED_MAKS_KREATOR = 100;
var SEED_BATAS_BAWAAN = 7;   // hari sejak sampel diterima sebelum PIC diingatkan
// Kolom "Kegiatan" di hasil_event: ID kegiatan Budgeting yang membiayai event itu (dipisah koma), supaya biaya per orang hadir
// dan per order bisa dihitung. Diisi peran selain marketing (peran marketing tidak melihat kegiatan dan uang).
var MKT_MAKS_KEGIATAN = 10;
var MKT_DATE_COLS = { strategi: [6, 7], hasil_event: [2], seeding_kreator: [7, 8, 9] };
var MKT_SEED_LANE = ['Crystal Glow', 'Daily Active', 'Vital Fresh'];
var MKT_SEED_CHANNEL = ['Shopee', 'TikTok Shop', 'TikTok', 'Instagram',
                         'Komunitas Olahraga', 'Komunitas Vespa', 'Komunitas Barber', 'Komunitas Motor'];
var MKT_STATUS = ['Ide', 'Jalan', 'Selesai'];
// PIC marketing = anggota tim (ID dari tab Tim, lihat Hub.gs).

// ============================================================
// KEAMANAN
// ============================================================
function isAuthorized_(secret) {
  var expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  // Tertutup secara bawaan: kalau SHARED_SECRET belum diisi, semua panggilan ditolak
  // (bukan dibuka). Isi dulu Script Property SHARED_SECRET sebelum deploy versi ini.
  if (!expected) return false;
  return safeEqual_(secret, expected);
}

// Perbandingan teks yang waktunya tidak bergantung pada seberapa banyak karakter yang cocok.
function safeEqual_(a, b) {
  a = String(a === undefined || a === null ? '' : a);
  b = String(b === undefined || b === null ? '' : b);
  var diff = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// ============================================================
// HELPER
// ============================================================
function mkt_text_(v, max) {
  return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200);
}

// Cegah teks yang diawali = + - @ dibaca Sheets sebagai formula.
function mkt_safe_(v) {
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return ' ' + v;
  return v;
}

function mkt_append_(sheet, arr) {
  sheet.appendRow(arr.map(mkt_safe_));
}

function mkt_cleanLabel_(s) {
  return mkt_text_(String(s === null || s === undefined ? '' : s).replace(/,/g, ' '), 60);
}

function mkt_parseDate_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function mkt_int_(v) {
  var n = Math.round(Number(v));
  return (isFinite(n) && n > 0) ? n : 0;
}

// ============================================================
// TAB OTOMATIS
// ============================================================
function mkt_ensureTabs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(MKT_TABS).forEach(function (name) {
    var ada = ss.getSheetByName(name);
    if (ada) {
      // tab lama: judul kolom baru (mis. "Kegiatan") ditambahkan di ujung kanan, data lama tidak disentuh
      var lastCol = Math.max(ada.getLastColumn(), 1);
      var punya = ada.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
      var kurang = MKT_TABS[name].filter(function (h) { return punya.indexOf(h) === -1; });
      if (kurang.length) {
        var mulai = punya.filter(function (h) { return h; }).length + 1;
        ada.getRange(1, mulai, 1, kurang.length).setValues([kurang]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F4E5F');
      }
      return;
    }
    var sheet = ss.insertSheet(name);
    var headers = MKT_TABS[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F4E5F');
    sheet.setFrozenRows(1);
    (MKT_DATE_COLS[name] || []).forEach(function (col) {
      sheet.getRange(2, col, 500, 1).setNumberFormat('dd-mmm-yy');
    });
    var seed = name === 'lane' ? MKT_SEED_LANE : (name === 'channel' ? MKT_SEED_CHANNEL : null);
    if (seed) {
      sheet.getRange(2, 1, seed.length, 1).setValues(seed.map(function (s) { return [s]; }));
    }
  });
}

function mkt_readTab_(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var tz = Session.getScriptTimeZone();
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var obj = {}, has = false;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      var v = values[r][c];
      if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      if (v === '' || v === null) { v = null; } else { has = true; }
      obj[headers[c]] = v;
    }
    if (has) { obj._row = r + 1; out.push(obj); }
  }
  return out;
}

// ---------- pengingat untuk PIC strategi (titik merah Hub + kotak di tab Marketing) ----------
// Aturan yang sama ada di marketing.js (pengingatMkt) untuk kotak di halaman; Hub memakai kunci dari sini.
//   z:mkt-selesai:<id> — strategimu berstatus Jalan padahal tanggal Selesai sudah lewat
//   z:mkt-hasil:<id>   — strategi event milikmu sudah selesai >= 2 hari tapi belum ada satu pun hasil event
// "Strategi event" = salah satu channel-nya diawali "Komunitas" atau pernah dipakai di hasil_event.
var MKT_HARI_HASIL = 2;
function mkt_tglStr_(ms) { return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function mkt_pengingatKeys_(uid, tim, nowMs) {
  var now = nowMs === undefined ? Date.now() : nowMs;
  var hariIni = mkt_tglStr_(now), batasHasil = mkt_tglStr_(now - MKT_HARI_HASIL * 86400000);
  var strategi = mkt_readTab_('strategi'), events = mkt_readTab_('hasil_event');
  var chEvent = {}, punyaHasil = {};
  events.forEach(function (e) {
    String(e['Channel'] || '').split(',').forEach(function (c) { c = c.trim().toLowerCase(); if (c) chEvent[c] = 1; });
    var s = String(e['Strategi'] || '').trim().toLowerCase(); if (s) punyaHasil[s] = 1;
  });
  var keys = [];
  strategi.forEach(function (r) {
    var id = String(r['ID'] || '').trim(), selesai = String(r['Selesai'] || ''), status = String(r['Status'] || '');
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(selesai)) return;
    if (ownerIds_(r['PIC'], tim).indexOf(uid) === -1) return;
    if (status === 'Jalan' && selesai < hariIni) keys.push('z:mkt-selesai:' + id);
    var isEvent = String(r['Channel'] || '').split(',').some(function (c) { c = c.trim().toLowerCase(); return c && (c.indexOf('komunitas') === 0 || chEvent[c]); });
    if (status !== 'Ide' && isEvent && selesai <= batasHasil && !punyaHasil[String(r['Nama Strategi'] || '').trim().toLowerCase()]) keys.push('z:mkt-hasil:' + id);
  });
  return keys;
}

function mkt_readList_(name, headerName) {
  return mkt_readTab_(name).map(function (o) { return mkt_text_(o[headerName], 60); }).filter(Boolean);
}

function mkt_getData() {
  mkt_ensureTabs_();
  return {
    strategi: mkt_readTab_('strategi'),
    lane: mkt_readList_('lane', 'Lane'),
    channel: mkt_readList_('channel', 'Channel'),
    hasil_event: mkt_readTab_('hasil_event'),
    seeding: mkt_readTab_('seeding'),
    seeding_kreator: mkt_readTab_('seeding_kreator')
  };
}

// Samakan label dengan daftar yang sudah ada (abaikan huruf besar/kecil dan
// spasi berlebih). Label yang benar-benar baru ditambah ke tab daftar.
function mkt_resolveLabels_(tabName, labels) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
  var headerName = tabName === 'lane' ? 'Lane' : 'Channel';
  var map = {};
  mkt_readList_(tabName, headerName).forEach(function (e) { map[e.toLowerCase()] = e; });
  var result = [], seen = {};
  (labels || []).forEach(function (raw) {
    var clean = mkt_cleanLabel_(raw);
    if (!clean) return;
    var k = clean.toLowerCase();
    var canon = map[k];
    if (!canon) { mkt_append_(sheet, [clean]); map[k] = clean; canon = clean; }
    if (!seen[k]) { seen[k] = 1; result.push(canon); }
  });
  return result;
}

// ============================================================
// POST — mengembalikan objek hasil, atau null kalau bukan aksi marketing
// ============================================================
function mkt_handlePost(data) {
  var known = { add_strategi: 1, update_strategi_status: 1, add_hasil_event: 1, update_hasil_event_kegiatan: 1,
    add_seeding: 1, putuskan_seeding: 1, update_seeding: 1, add_kreator: 1, update_kreator: 1 };
  if (!data || !known[data.action]) return null;
  mkt_ensureTabs_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'Server sedang sibuk, coba lagi sebentar.' };
  try {
    if (data.action === 'add_strategi') return mkt_addStrategi_(data);
    if (data.action === 'update_strategi_status') return mkt_updateStatus_(data);
    if (data.action === 'update_hasil_event_kegiatan') return mkt_updateEventKegiatan_(data);
    if (data.action === 'add_seeding') return seed_add_(data);
    if (data.action === 'putuskan_seeding') return seed_putuskan_(data);
    if (data.action === 'update_seeding') return seed_update_(data);
    if (data.action === 'add_kreator') return seed_addKreator_(data);
    if (data.action === 'update_kreator') return seed_updateKreator_(data);
    return mkt_addHasilEvent_(data);
  } finally {
    lock.releaseLock();
  }
}

function mkt_addStrategi_(d) {
  var nama = mkt_text_(d.nama, 120);
  var pesan = mkt_text_(d.pesan, 500);
  if (!nama) return { ok: false, error: 'Nama strategi wajib diisi.' };
  if (!pesan) return { ok: false, error: 'Pesan inti wajib diisi.' };
  var laneIn = Array.isArray(d.lane) ? d.lane : [];
  var chIn = Array.isArray(d.channel) ? d.channel : [];
  if (!laneIn.length) return { ok: false, error: 'Pilih minimal satu lane.' };
  if (!chIn.length) return { ok: false, error: 'Pilih minimal satu channel.' };
  var mulai = mkt_parseDate_(d.mulai);
  if (!mulai) return { ok: false, error: 'Tanggal mulai wajib diisi.' };
  var selesai = '';
  if (d.selesai) {
    selesai = mkt_parseDate_(d.selesai);
    if (!selesai) return { ok: false, error: 'Tanggal selesai tidak valid.' };
    if (selesai < mulai) return { ok: false, error: 'Tanggal selesai tidak boleh sebelum tanggal mulai.' };
  }
  if (!isKnownPic_(d.pic)) return { ok: false, error: 'PIC tidak dikenali.' };
  var status = d.status || 'Ide';
  if (MKT_STATUS.indexOf(status) === -1) return { ok: false, error: 'Status tidak dikenali.' };

  var lane = mkt_resolveLabels_('lane', laneIn);
  var channel = mkt_resolveLabels_('channel', chIn);
  if (!lane.length || !channel.length) return { ok: false, error: 'Lane/channel tidak valid.' };

  var id = 'S' + new Date().getTime().toString(36);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('strategi');
  mkt_append_(sheet, [id, nama, lane.join(', '), pesan, channel.join(', '), mulai, selesai, normalizePic_(d.pic), status, new Date()]);
  return { ok: true, id: id, lane: lane, channel: channel };
}

function mkt_updateStatus_(d) {
  if (MKT_STATUS.indexOf(d.status) === -1) return { ok: false, error: 'Status tidak dikenali.' };
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('strategi');
  var last = sheet.getLastRow();
  if (last < 2) return { ok: false, error: 'Belum ada strategi.' };
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(d.id)) {
      sheet.getRange(i + 2, 9).setValue(d.status);
      return { ok: true, id: d.id, status: d.status };
    }
  }
  return { ok: false, error: 'Strategi tidak ditemukan.' };
}

function mkt_addHasilEvent_(d) {
  var nama = mkt_text_(d.nama, 120);
  if (!nama) return { ok: false, error: 'Nama event wajib diisi.' };
  var tanggal = mkt_parseDate_(d.tanggal);
  if (!tanggal) return { ok: false, error: 'Tanggal event wajib diisi.' };
  if (!mkt_cleanLabel_(d.channel)) return { ok: false, error: 'Channel wajib diisi.' };
  if (!isKnownPic_(d.pic)) return { ok: false, error: 'PIC tidak dikenali.' };

  // peran marketing tidak melihat kegiatan Budgeting, jadi tidak bisa menautkannya (diabaikan, bukan ditolak)
  var keg = '';
  if (!isMarketingOnly_() && Array.isArray(d.kegiatan) && d.kegiatan.length) {
    var r = mkt_cekKegiatan_(d.kegiatan);
    if (r.error) return { ok: false, error: r.error };
    keg = r.ids.join(', ');
  }

  var channel = mkt_resolveLabels_('channel', [d.channel])[0];
  var id = 'E' + new Date().getTime().toString(36);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('hasil_event');
  var baris = [
    id, tanggal, nama, channel,
    mkt_text_(d.komunitas, 80), mkt_text_(d.kode, 60),
    mkt_int_(d.hadir), mkt_int_(d.coba), mkt_int_(d.tanya), mkt_int_(d.order), mkt_int_(d.ugc),
    mkt_text_(d.strategi, 120), normalizePic_(d.pic), new Date()
  ];
  // kolom Kegiatan sesuai posisi judulnya di Sheet (tab lama bisa punya kolom tambahan)
  var kol = mkt_kolom_(sheet, 'Kegiatan');
  while (baris.length < kol - 1) baris.push('');
  baris[kol - 1] = keg;
  mkt_append_(sheet, baris);
  return { ok: true, id: id, kegiatan: keg };
}

function mkt_kolom_(sheet, judul) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var h = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (x) { return String(x).trim(); });
  var i = h.indexOf(judul);
  return i >= 0 ? i + 1 : MKT_TABS.hasil_event.indexOf(judul) + 1;
}

// ID kegiatan harus ada di tab kegiatan. Hasil: { ids } atau { error }.
function mkt_cekKegiatan_(ids) {
  var bersih = [];
  (ids || []).forEach(function (x) { x = mkt_text_(x, 40); if (x && bersih.indexOf(x) === -1) bersih.push(x); });
  if (bersih.length > MKT_MAKS_KEGIATAN) return { error: 'Maksimal ' + MKT_MAKS_KEGIATAN + ' kegiatan per event.' };
  if (!bersih.length) return { ids: [] };
  var ada = {};
  sheetToObjects(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('kegiatan')).forEach(function (k) { if (k.ID) ada[String(k.ID)] = true; });
  var asing = bersih.filter(function (x) { return !ada[x]; });
  if (asing.length) return { error: 'Kegiatan tidak ditemukan: ' + asing.join(', ') + '. Muat ulang dashboard lalu coba lagi.' };
  return { ids: bersih };
}

// Hubungkan (atau lepas) kegiatan Budgeting ke hasil event yang sudah tercatat. Bukan untuk peran marketing.
function mkt_updateEventKegiatan_(d) {
  if (isMarketingOnly_()) return { ok: false, error: 'Peran marketing tidak bisa menautkan kegiatan Budgeting.' };
  var r = mkt_cekKegiatan_(Array.isArray(d.kegiatan) ? d.kegiatan : []);
  if (r.error) return { ok: false, error: r.error };
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('hasil_event');
  var last = sheet.getLastRow();
  if (last < 2) return { ok: false, error: 'Belum ada hasil event.' };
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(d.id)) {
      sheet.getRange(i + 2, mkt_kolom_(sheet, 'Kegiatan')).setValue(r.ids.join(', '));
      return { ok: true, id: d.id, kegiatan: r.ids.join(', ') };
    }
  }
  return { ok: false, error: 'Hasil event tidak ditemukan.' };
}


// ============================================================
// SEEDING — bagi sampel ke kreator supaya bikin konten.
// Alur: tim mengajukan batch (Diajukan) -> approver / admin Zerodeo meng-acc (bukan pengajunya sendiri) -> sampel dikirim
// ke tiap kreator (Dikirim -> Diterima -> Posting / Tidak posting) -> batch Selesai. Biaya: Estimasi batch, atau kegiatan
// Budgeting yang ditautkan (peran marketing tidak melihat uang).
// ============================================================
function seed_rows_(tab) { return mkt_readTab_(tab); }
function seed_cari_(id) { return seed_rows_('seeding').filter(function (b) { return String(b['ID']) === String(id || '').trim(); })[0] || null; }
function seed_sheet_(tab) { mkt_ensureTabs_(); return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab); }
function seed_set_(tab, row, judul, nilai) { var sh = seed_sheet_(tab); sh.getRange(row, MKT_TABS[tab].indexOf(judul) + 1).setValue(mkt_safe_(nilai)); }
function seed_milik_(b) {
  if (!CURRENT_WHO_) return false;
  return ownerIds_(b['PIC']).indexOf(CURRENT_WHO_.uid) !== -1 || String(b['Diajukan Oleh'] || '') === CURRENT_WHO_.uid;
}
function seed_akun_(v) { return mkt_text_(v, 60).replace(/^@+/, '').toLowerCase(); }
// daftar kreator dari array {nama, akun, platform} atau teks "@akun - platform - nama" (satu per baris / dipisah koma)
function seed_parseKreator_(list) {
  var arr = Array.isArray(list) ? list : String(list || '').split(/\n|;/);
  var out = [];
  arr.forEach(function (x) {
    var o = x && typeof x === 'object' ? x : null;
    if (!o) {
      var bag = String(x || '').split(/\s+-\s+|\s*\|\s*/).map(function (t) { return t.trim(); }).filter(Boolean);
      if (!bag.length) return;
      o = { akun: bag[0], platform: bag[1] || '', nama: bag[2] || '' };
    }
    var akun = seed_akun_(o.akun || o.nama), nama = mkt_text_(o.nama || '', 80);
    if (!akun && !nama) return;
    out.push({ akun: akun, nama: nama, platform: mkt_cleanLabel_(o.platform || '') });
  });
  return out;
}
function seed_tambahKreator_(batchId, list, defPlatform) {
  var sh = seed_sheet_('seeding_kreator');
  var ada = {};
  seed_rows_('seeding_kreator').forEach(function (k) { if (String(k['Batch']) === batchId) ada[seed_akun_(k['Akun'] || k['Nama'])] = 1; });
  var baru = 0, lewat = [];
  list.forEach(function (k, i) {
    var kunci = k.akun || k.nama.toLowerCase();
    if (ada[kunci]) { lewat.push(k.akun || k.nama); return; }
    ada[kunci] = 1; baru++;
    mkt_append_(sh, ['K' + new Date().getTime().toString(36) + i, batchId, k.nama, k.akun, k.platform || defPlatform || '', 'Rencana', '', '', '', '', '', '', new Date()]);
  });
  return { baru: baru, dobel: lewat };
}

function seed_add_(d) {
  if (!CURRENT_WHO_) return { ok: false, error: 'Masuk lewat Hub dulu supaya kami tahu siapa kamu.' };
  var nama = mkt_text_(d.nama, 120);
  if (!nama) return { ok: false, error: 'Nama batch seeding wajib diisi (mis. "Seeding Vital Fresh Desember").' };
  var kreator = seed_parseKreator_(d.kreator);
  if (kreator.length > SEED_MAKS_KREATOR) return { ok: false, error: 'Maksimal ' + SEED_MAKS_KREATOR + ' kreator per batch.' };
  var pic = d.pic ? normalizePic_(d.pic) : CURRENT_WHO_.uid;
  if (!pic) return { ok: false, error: 'PIC tidak dikenali.' };
  var lane = d.lane ? mkt_resolveLabels_('lane', [d.lane])[0] || '' : '';
  var platform = mkt_cleanLabel_(d.platform || '');
  var batas = mkt_int_(d.batas) || SEED_BATAS_BAWAAN;
  var est = isMarketingOnly_() ? '' : (Math.round(Number(d.estimasi)) || '');
  var id = 'SD' + new Date().getTime().toString(36);
  mkt_append_(seed_sheet_('seeding'), [id, nama, mkt_text_(d.produk, 120), lane, platform, est, batas, 'Diajukan', pic, CURRENT_WHO_.uid, '', mkt_text_(d.catatan, 500), new Date(), '', mkt_text_(d.strategi, 120)]);
  var t = seed_tambahKreator_(id, kreator, platform);
  return { ok: true, id: id, kreator: t.baru, message: 'Seeding "' + nama + '" diajukan (' + t.baru + ' kreator). Menunggu acc approver / admin Zerodeo.' };
}

function seed_putuskan_(d) {
  var b = seed_cari_(d.id);
  if (!b) return { ok: false, error: 'Batch seeding tidak ditemukan.' };
  if (!whoCanDecide_()) return { ok: false, error: 'Yang meng-acc seeding adalah approver atau admin Zerodeo.' };
  if (seed_milik_(b)) return { ok: false, error: 'Kamu tidak boleh meng-acc seeding yang kamu ajukan / pegang sendiri. Minta approver lain.' };
  if (b['Status'] !== 'Diajukan') return { ok: false, error: 'Seeding ini statusnya "' + b['Status'] + '", bukan Diajukan lagi.' };
  var st = { approved: 'Approved', approve: 'Approved', ditolak: 'Ditolak', tolak: 'Ditolak', revisi: 'Revisi' }[String(d.status || '').toLowerCase()];
  if (!st) return { ok: false, error: 'Keputusan harus Approved, Ditolak, atau Revisi.' };
  seed_set_('seeding', b._row, 'Status', st);
  seed_set_('seeding', b._row, 'Diputuskan Oleh', CURRENT_WHO_.uid);
  var alasan = mkt_text_(d.alasan, 200);
  var cat = String(b['Catatan'] || ''), stamp = st + ' oleh ' + picNama_(CURRENT_WHO_.uid) + (alasan ? ': ' + alasan : '') + ' (' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yy') + ')';
  seed_set_('seeding', b._row, 'Catatan', cat ? cat + ' | ' + stamp : stamp);
  return { ok: true, id: b['ID'], status: st, message: 'Seeding "' + b['Nama Batch'] + '" ' + { Approved: 'di-acc', Ditolak: 'ditolak', Revisi: 'diminta revisi' }[st] + (alasan ? ' (' + alasan + ')' : '') + '.' };
}

// ubah batch: status Selesai / Jalan, ajukan lagi setelah Revisi, tautkan kegiatan Budgeting, ubah estimasi / batas / catatan
function seed_update_(d) {
  var b = seed_cari_(d.id);
  if (!b) return { ok: false, error: 'Batch seeding tidak ditemukan.' };
  if (!(seed_milik_(b) || whoCanDecide_())) return { ok: false, error: 'Hanya PIC / pengaju seeding, approver, atau admin yang boleh mengubahnya.' };
  var pesan = [];
  if (d.status) {
    var boleh = { Selesai: ['Approved', 'Jalan'], Jalan: ['Approved', 'Selesai'], Diajukan: ['Revisi'] }[d.status];
    if (!boleh) return { ok: false, error: 'Status tidak dikenali.' };
    if (boleh.indexOf(b['Status']) === -1) return { ok: false, error: 'Dari "' + b['Status'] + '" tidak bisa langsung jadi "' + d.status + '".' };
    seed_set_('seeding', b._row, 'Status', d.status); pesan.push('status ' + d.status);
  }
  if (d.kegiatan !== undefined) {
    if (isMarketingOnly_()) return { ok: false, error: 'Peran marketing tidak bisa menautkan kegiatan Budgeting.' };
    var r = mkt_cekKegiatan_(Array.isArray(d.kegiatan) ? d.kegiatan : []);
    if (r.error) return { ok: false, error: r.error };
    seed_set_('seeding', b._row, 'Kegiatan', r.ids.join(', ')); pesan.push('kegiatan ditautkan');
  }
  if (d.estimasi !== undefined && !isMarketingOnly_()) { seed_set_('seeding', b._row, 'Estimasi (Rp)', Math.round(Number(d.estimasi)) || ''); pesan.push('estimasi'); }
  if (d.batas !== undefined) { seed_set_('seeding', b._row, 'Batas Posting (hari)', mkt_int_(d.batas) || SEED_BATAS_BAWAAN); pesan.push('batas posting'); }
  if (d.catatan !== undefined) { seed_set_('seeding', b._row, 'Catatan', mkt_text_(d.catatan, 500)); pesan.push('catatan'); }
  return { ok: true, id: b['ID'], message: 'Seeding "' + b['Nama Batch'] + '" diperbarui' + (pesan.length ? ': ' + pesan.join(', ') : '') + '.' };
}

function seed_addKreator_(d) {
  var b = seed_cari_(d.batch || d.id);
  if (!b) return { ok: false, error: 'Batch seeding tidak ditemukan.' };
  if (['Ditolak', 'Selesai'].indexOf(b['Status']) !== -1) return { ok: false, error: 'Seeding ini sudah ' + b['Status'] + '.' };
  var list = seed_parseKreator_(d.kreator);
  if (!list.length) return { ok: false, error: 'Daftar kreatornya kosong.' };
  var t = seed_tambahKreator_(b['ID'], list, b['Platform']);
  return { ok: true, id: b['ID'], kreator: t.baru, message: t.baru + ' kreator ditambahkan ke "' + b['Nama Batch'] + '"' + (t.dobel.length ? ' (sudah ada: ' + t.dobel.join(', ') + ')' : '') + '.' };
}

// status kreator: Dikirim (tgl kirim), Diterima (tgl terima), Posting (link + views), Tidak posting. Hanya setelah batch di-acc.
function seed_updateKreator_(d) {
  var semua = seed_rows_('seeding_kreator'), k = null;
  if (d.id) k = semua.filter(function (x) { return String(x['ID']) === String(d.id); })[0];
  else {
    var b0 = seed_cari_(d.batch);
    if (!b0) return { ok: false, error: 'Batch seeding tidak ditemukan.' };
    var cari = seed_akun_(d.akun || d.nama);
    var cocok = semua.filter(function (x) { return String(x['Batch']) === b0['ID'] && (seed_akun_(x['Akun']) === cari || String(x['Nama'] || '').toLowerCase() === cari); });
    if (cocok.length > 1) return { ok: false, error: 'Ada beberapa kreator "' + cari + '". Sebut akunnya.' };
    k = cocok[0];
  }
  if (!k) return { ok: false, error: 'Kreator tidak ditemukan di batch itu.' };
  var b = seed_cari_(k['Batch']);
  if (!b) return { ok: false, error: 'Batch seeding tidak ditemukan.' };
  if (['Diajukan', 'Revisi', 'Ditolak'].indexOf(b['Status']) !== -1) return { ok: false, error: 'Seeding "' + b['Nama Batch'] + '" belum di-acc (status ' + b['Status'] + '). Sampel dikirim setelah di-acc approver / admin.' };
  var st = d.status ? KREATOR_STATUS.filter(function (x) { return x.toLowerCase() === String(d.status).toLowerCase(); })[0] : '';
  if (d.status && !st) return { ok: false, error: 'Status kreator: ' + KREATOR_STATUS.join(' / ') + '.' };
  var tgl = d.tanggal ? mkt_parseDate_(d.tanggal) : new Date();
  if (!tgl) return { ok: false, error: 'Tanggal tidak valid.' };
  if (st) {
    seed_set_('seeding_kreator', k._row, 'Status', st);
    if (st === 'Dikirim') seed_set_('seeding_kreator', k._row, 'Tgl Kirim', tgl);
    if (st === 'Diterima') { seed_set_('seeding_kreator', k._row, 'Tgl Terima', tgl); if (!k['Tgl Kirim']) seed_set_('seeding_kreator', k._row, 'Tgl Kirim', tgl); }
    if (st === 'Posting') seed_set_('seeding_kreator', k._row, 'Tgl Posting', tgl);
    if (b['Status'] === 'Approved' && st !== 'Rencana') seed_set_('seeding', b._row, 'Status', 'Jalan');
  }
  if (d.link) {
    if (!/^https?:\/\/\S+$/i.test(String(d.link))) return { ok: false, error: 'Link konten harus diawali http:// atau https://' };
    seed_set_('seeding_kreator', k._row, 'Link Konten', String(d.link).slice(0, 300));
    if (!st && k['Status'] !== 'Posting') { seed_set_('seeding_kreator', k._row, 'Status', 'Posting'); seed_set_('seeding_kreator', k._row, 'Tgl Posting', tgl); st = 'Posting'; }
  }
  if (d.views !== undefined && d.views !== '') seed_set_('seeding_kreator', k._row, 'Views', mkt_int_(d.views));
  if (d.catatan !== undefined) seed_set_('seeding_kreator', k._row, 'Catatan', mkt_text_(d.catatan, 200));
  seed_set_('seeding_kreator', k._row, 'Diubah', new Date());
  var siapa = k['Akun'] ? '@' + seed_akun_(k['Akun']) : k['Nama'];
  return { ok: true, id: k['ID'], message: siapa + (st ? ': ' + st : ' diperbarui') + (d.link ? ' (link konten tersimpan)' : '') + ' · ' + b['Nama Batch'] };
}

// Ringkasan per batch (dipakai bot dan pengingat): jumlah per status kreator + biaya per konten.
function seed_ringkas_(b, kreator, uang) {
  var ks = kreator.filter(function (k) { return String(k['Batch']) === String(b['ID']); });
  var n = {}; KREATOR_STATUS.forEach(function (s) { n[s] = 0; });
  ks.forEach(function (k) { n[k['Status'] || 'Rencana'] = (n[k['Status'] || 'Rencana'] || 0) + 1; });
  var o = { id: b['ID'], nama: b['Nama Batch'], produk: b['Produk'] || '', lane: b['Lane'] || '', platform: b['Platform'] || '', status: b['Status'],
    pic: resolvePicIds_(b['PIC']).map(picNama_).join(', '), diajukan_oleh: picNama_(String(b['Diajukan Oleh'] || '')), kreator: ks.length,
    dikirim: n['Dikirim'] + n['Diterima'] + n['Posting'] + n['Tidak posting'], diterima: n['Diterima'] + n['Posting'] + n['Tidak posting'], posting: n['Posting'], tidak_posting: n['Tidak posting'],
    views: ks.reduce(function (a, k) { return a + (Number(k['Views']) || 0); }, 0) };
  if (uang) {
    var biaya = Number(b['Estimasi (Rp)']) || 0, perkiraan = true;
    var ids = String(b['Kegiatan'] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (ids.length) {
      var byId = {}; sheetToObjects(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('kegiatan')).forEach(function (k) { byId[String(k.ID)] = k; });
      biaya = 0; perkiraan = false;
      ids.forEach(function (id) { var k = byId[id]; if (!k || k['Status'] === 'Dibatalkan') return; var a = Number(k['Actual (Rp)']) || 0; if (a > 0) biaya += a; else { biaya += Number(k['Estimasi (Rp)']) || 0; perkiraan = true; } });
    }
    o.biaya = biaya; o.biaya_perkiraan = perkiraan;
    if (o.posting) o.biaya_per_konten = Math.round(biaya / o.posting);
  }
  return o;
}

// Kunci titik merah / pengingat seeding:
//   z:seed-acc:<id>  — seeding Diajukan, kamu approver / admin (bukan pengajunya)
//   z:seed-post:<id> — seeding milikmu: ada kreator yang sudah terima sampel > batas hari tapi belum posting
function seed_keys_(uid, peran, tim, nowMs) {
  var now = nowMs === undefined ? Date.now() : nowMs, keys = [];
  var kreator = seed_rows_('seeding_kreator');
  seed_rows_('seeding').forEach(function (b) {
    var id = String(b['ID'] || ''); if (!id) return;
    var milik = ownerIds_(b['PIC'], tim).indexOf(uid) !== -1 || String(b['Diajukan Oleh'] || '') === uid;
    if (b['Status'] === 'Diajukan' && !milik && (peran === 'approver' || peran === 'admin')) keys.push('z:seed-acc:' + id);
    if (milik && ['Approved', 'Jalan'].indexOf(b['Status']) !== -1) {
      var batas = (mkt_int_(b['Batas Posting (hari)']) || SEED_BATAS_BAWAAN) * 86400000;
      var telat = kreator.some(function (k) {
        if (String(k['Batch']) !== id || k['Status'] !== 'Diterima') return false;
        var t = mkt_parseDate_(k['Tgl Terima']); return t && now - t.getTime() > batas;
      });
      if (telat) keys.push('z:seed-post:' + id);
    }
  });
  return keys;
}
function seed_tindakan_(uid, peran, tim) {
  var byId = {}; seed_rows_('seeding').forEach(function (b) { byId[String(b['ID'])] = b; });
  var kreator = seed_rows_('seeding_kreator');
  return seed_keys_(uid, peran, tim).map(function (key) {
    var p = key.split(':'), b = byId[p[2]]; if (!b) return null;
    if (p[1] === 'seed-acc') return { jenis: 'seed-acc', id: p[2], judul: String(b['Nama Batch']), teks: 'Seeding "' + b['Nama Batch'] + '" (' + kreator.filter(function (k) { return String(k['Batch']) === p[2]; }).length + ' kreator): perlu di-acc' };
    var n = kreator.filter(function (k) { return String(k['Batch']) === p[2] && k['Status'] === 'Diterima'; }).length;
    return { jenis: 'seed-post', id: p[2], judul: String(b['Nama Batch']), teks: 'Seeding "' + b['Nama Batch'] + '": ' + n + ' kreator sudah terima sampel tapi belum posting, perlu diingatkan' };
  }).filter(Boolean);
}
