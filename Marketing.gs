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
                'Strategi', 'PIC Pencatat', 'Dicatat Pada', 'Kegiatan']
};
// Kolom "Kegiatan" di hasil_event: ID kegiatan Budgeting yang membiayai event itu (dipisah koma), supaya biaya per orang hadir
// dan per order bisa dihitung. Diisi peran selain marketing (peran marketing tidak melihat kegiatan dan uang).
var MKT_MAKS_KEGIATAN = 10;
var MKT_DATE_COLS = { strategi: [6, 7], hasil_event: [2] };
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

function mkt_readList_(name, headerName) {
  return mkt_readTab_(name).map(function (o) { return mkt_text_(o[headerName], 60); }).filter(Boolean);
}

function mkt_getData() {
  mkt_ensureTabs_();
  return {
    strategi: mkt_readTab_('strategi'),
    lane: mkt_readList_('lane', 'Lane'),
    channel: mkt_readList_('channel', 'Channel'),
    hasil_event: mkt_readTab_('hasil_event')
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
  var known = { add_strategi: 1, update_strategi_status: 1, add_hasil_event: 1, update_hasil_event_kegiatan: 1 };
  if (!data || !known[data.action]) return null;
  mkt_ensureTabs_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'Server sedang sibuk, coba lagi sebentar.' };
  try {
    if (data.action === 'add_strategi') return mkt_addStrategi_(data);
    if (data.action === 'update_strategi_status') return mkt_updateStatus_(data);
    if (data.action === 'update_hasil_event_kegiatan') return mkt_updateEventKegiatan_(data);
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
