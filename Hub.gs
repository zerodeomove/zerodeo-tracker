/**
 * Hub.gs — identitas dari Hub Pinggiran (login sekali), daftar tim, aturan approve, titik merah, dan log aktivitas.
 * File TERPISAH di project Apps Script ini (seperti Marketing.gs): Code.gs dan Marketing.gs memanggil fungsi di sini.
 *
 * ===== Script Properties (Project Settings -> Script Properties) =====
 *   SECRET_ZERODEO : kunci tanda tangan token dari Hub. Nilainya SAMA PERSIS dengan SECRET_ZERODEO di Script Properties Hub
 *                    dan env SECRET_ZERODEO di Vercel. Jangan masuk repo/chat.
 *   HUB_URL        : URL web app Apps Script Hub (berakhiran /exec), untuk menyinkron daftar tim ke tab "Tim".
 *
 * ===== Cara kerja =====
 * - Proxy Vercel memverifikasi token pengguna (HMAC) lalu mengirim identitas yang sudah terverifikasi ke sini di
 *   body["hub"] = {uid, peran}, bersama SHARED_SECRET. Apps Script mempercayai "hub" hanya karena SHARED_SECRET benar.
 * - Hub memanggil action "pending" (titik merah) dengan token servis bertanda tangan SECRET_ZERODEO, tanpa SHARED_SECRET.
 * - Peran: anggota, admin, approver. approver/admin boleh memutuskan (approve/reject) dan mengubah kegiatan yang uangnya
 *   sudah diputuskan; tidak ada yang boleh memutuskan kegiatannya sendiri.
 */

var HUB_APP = 'zerodeo';
var PERAN_ZERODEO = ['anggota', 'admin', 'approver', 'marketing'];
var TIM_TAB = 'Tim';
var TIM_HEADERS = ['id', 'nama', 'peran', 'disinkron'];
var LOG_TAB = 'log_aktivitas';
var LOG_HEADERS = ['Waktu', 'User', 'Peran', 'Aksi', 'ID Kegiatan', 'Rincian'];

// Identitas pemanggil untuk request yang sedang berjalan: {uid, peran}, atau null (jalur kode tim lama, tanpa identitas).
var CURRENT_WHO_ = null;

// Peran "marketing" (videografer, vendor): hanya modul Marketing. Tidak menerima data uang sama sekali dan tidak boleh aksi uang.
function isMarketingOnly_() {
  return !!CURRENT_WHO_ && CURRENT_WHO_.peran === 'marketing';
}
var TIM_MEMO_ = null;

// Cadangan sebelum tab "Tim" pernah disinkron dari Hub (ID = nama huruf kecil).
var LEGACY_TIM_ = [
  { id: 'lenno', nama: 'Lenno', peran: '' }, { id: 'ricko', nama: 'Ricko', peran: '' },
  { id: 'yanuar', nama: 'Yanuar', peran: '' }, { id: 'christina', nama: 'Christina', peran: '' }
];

// ============================================================
// TOKEN HUB (HMAC-SHA256). Format sama dengan hub-backend/Code.gs di repo juanda-hub:
//   base64url(JSON{uid,app,peran,iat,exp}) + "." + base64url(HMAC_SHA256(payloadB64, SECRET_ZERODEO))
// ============================================================
function hubSecret_() {
  return PropertiesService.getScriptProperties().getProperty('SECRET_ZERODEO') || '';
}

function hmacB64_(payload, secret) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret));
}

function makeHubToken_(uid, peran, ttlSec, nowMs) {
  var now = Math.floor((nowMs === undefined ? Date.now() : nowMs) / 1000);
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify({ uid: uid, app: HUB_APP, peran: peran, iat: now, exp: now + ttlSec }));
  return payload + '.' + hmacB64_(payload, hubSecret_());
}

// Melempar Error kalau token tidak sah: tanda tangan salah, bukan untuk app ini, atau kedaluwarsa.
function verifyHubToken_(token, nowMs) {
  var secret = hubSecret_();
  var parts = String(token || '').split('.');
  if (!secret || parts.length !== 2 || !safeEqual_(hmacB64_(parts[0], secret), parts[1])) throw new Error('Token tidak valid.');
  var d;
  try { d = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); } catch (e) { throw new Error('Token tidak valid.'); }
  var now = Math.floor((nowMs === undefined ? Date.now() : nowMs) / 1000);
  if (!d || !d.uid || d.app !== HUB_APP || !(d.exp > now) || !(d.iat <= now + 60)) throw new Error('Token tidak valid.');
  return d;
}

// Identitas yang dikirim proxy -> {uid, peran} yang bentuknya benar, atau null.
function normalizeWho_(h) {
  if (!h || typeof h !== 'object') return null;
  var uid = String(h.uid || '');
  if (!/^[a-z0-9_-]{2,30}$/.test(uid) || PERAN_ZERODEO.indexOf(h.peran) === -1) return null;
  return { uid: uid, peran: h.peran };
}

// ============================================================
// ATURAN: siapa boleh memutuskan / mengubah kegiatan yang uangnya sudah diputuskan
// ============================================================
function whoCanDecide_() {
  return !!CURRENT_WHO_ && (CURRENT_WHO_.peran === 'approver' || CURRENT_WHO_.peran === 'admin');
}

// '' kalau boleh, selain itu pesan galat. (Pengganti checkPin_: tidak ada lagi PIN bersama.)
function checkDecider_() {
  if (!CURRENT_WHO_) return 'Masuk lewat Hub dulu supaya kami tahu siapa kamu.';
  if (!whoCanDecide_()) return 'Hanya approver atau admin Zerodeo yang boleh melakukan ini.';
  return '';
}

// Peran approver di tab Tim (disinkron dari Hub).
function isApproverId_(id) {
  return readTim_().some(function (t) { return t.id === id && t.peran === 'approver'; });
}

// Siapa boleh memutuskan (approve/reject) satu kegiatan. '' kalau boleh, selain itu pesan galat.
//   - tidak ada yang memutuskan kegiatannya sendiri
//   - approver: kegiatan siapa pun
//   - admin: hanya kegiatan milik approver (supaya kegiatan approver tetap ada yang memutuskan)
function checkCanDecideRow_(picValue) {
  if (!CURRENT_WHO_) return 'Masuk lewat Hub dulu supaya kami tahu siapa kamu.';
  var owners = ownerIds_(picValue);
  if (owners.indexOf(CURRENT_WHO_.uid) !== -1) return 'Kamu tidak boleh memutuskan kegiatanmu sendiri. Minta approver lain.';
  if (CURRENT_WHO_.peran === 'approver') return '';
  if (CURRENT_WHO_.peran === 'admin') {
    if (owners.some(isApproverId_)) return '';
    return 'Admin hanya memutuskan kegiatan milik approver. Kegiatan ini diputuskan oleh approver.';
  }
  return 'Hanya approver (atau admin untuk kegiatan milik approver) yang boleh memutuskan.';
}

// Siapa boleh mengubah, membatalkan, atau memulihkan satu kegiatan. '' kalau boleh, selain itu pesan galat.
//   - uangnya sudah diputuskan (Approved/Ditransfer/Selesai): hanya approver atau admin
//   - selain itu: PIC kegiatan itu, atau approver/admin
function checkCanEditRow_(picValue, status) {
  if (!CURRENT_WHO_) return 'Masuk lewat Hub dulu supaya kami tahu siapa kamu.';
  if (whoCanDecide_()) return '';
  if (STATUS_KEPUTUSAN.indexOf(status) !== -1) return 'Uang kegiatan ini sudah diputuskan. Hanya approver atau admin yang boleh mengubahnya.';
  if (ownerIds_(picValue).indexOf(CURRENT_WHO_.uid) !== -1) return '';
  return 'Hanya PIC kegiatan ini, admin, atau approver yang boleh mengubahnya.';
}

// ============================================================
// TIM (daftar orang, disinkron dari Hub ke tab "Tim"). PIC disimpan sebagai ID, ditampilkan sebagai nama.
// ============================================================
// Isi tab Tim apa adanya (kosong kalau tab belum ada / belum disinkron). Dipakai untuk memeriksa akses terkini.
function timTabRows_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TIM_TAB);
  var out = [];
  if (sheet && sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues().forEach(function (r) {
      var id = String(r[0] || '').trim().toLowerCase();
      var nama = String(r[1] || '').trim();
      if (id && nama) out.push({ id: id, nama: nama, peran: String(r[2] || '').trim() });
    });
  }
  return out;
}

function readTim_() {
  if (TIM_MEMO_) return TIM_MEMO_;
  var out = timTabRows_();
  TIM_MEMO_ = out.length ? out : LEGACY_TIM_.slice();
  return TIM_MEMO_;
}

// Token Hub berlaku sampai 12 jam, jadi akses yang dicabut di Hub belum tentu berhenti dengan sendirinya. Tab Tim
// (disinkron dari Hub: hanya user aktif yang punya akses Zerodeo) dipakai sebagai sumber terkini: orang yang
// sudah tidak ada di sana ditolak, dan perannya mengikuti tab Tim, bukan token. Selama tab Tim masih kosong
// (belum pernah sinkron) tidak ada yang diubah. Mengembalikan pesan galat, atau '' kalau boleh.
function enforceTimAccess_() {
  if (!CURRENT_WHO_) return '';
  var rows = timTabRows_();
  if (!rows.length) return '';
  var uid = String(CURRENT_WHO_.uid || '').toLowerCase();
  var hit = rows.filter(function (t) { return t.id === uid; })[0];
  if (!hit) return 'unauthorized';
  if (PERAN_ZERODEO.indexOf(hit.peran) !== -1) CURRENT_WHO_.peran = hit.peran;
  return '';
}

// Nilai PIC (ID atau nama, huruf besar/kecil bebas) -> ID, atau '' kalau tidak dikenal. Menerima data lama yang berisi nama.
function normalizePic_(v, tim) {
  var s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  if (!s) return '';
  tim = tim || readTim_();
  for (var i = 0; i < tim.length; i++) {
    if (tim[i].id === s || tim[i].nama.toLowerCase() === s) return tim[i].id;
  }
  return '';
}

function isKnownPic_(v) { return normalizePic_(v) !== ''; }

// Isi sel PIC (satu atau beberapa, dipisah koma) -> daftar ID unik.
function resolvePicIds_(v, tim) {
  var out = [];
  String(v === undefined || v === null ? '' : v).split(',').forEach(function (p) {
    var id = normalizePic_(p, tim);
    if (id && out.indexOf(id) === -1) out.push(id);
  });
  return out;
}

// Untuk memeriksa "milik siapa" (bukan untuk validasi): seperti resolvePicIds_, tetapi nilai yang belum ada di tab Tim
// tetap dihitung (huruf kecil). Dengan begitu orang yang belum tersinkron tidak lolos memutuskan kegiatannya sendiri.
function ownerIds_(v, tim) {
  var out = [];
  String(v === undefined || v === null ? '' : v).split(',').forEach(function (p) {
    var id = normalizePic_(p, tim) || String(p).trim().toLowerCase();
    if (id && out.indexOf(id) === -1) out.push(id);
  });
  return out;
}

function picNama_(id) {
  var tim = readTim_();
  for (var i = 0; i < tim.length; i++) if (tim[i].id === id) return tim[i].nama;
  return id;
}

function picIdList_() {
  return readTim_().map(function (t) { return t.id; });
}

// Menyinkron daftar anggota Zerodeo dari Hub ke tab "Tim". Mengembalikan jumlah anggota.
// Tidak menghapus apa pun kalau Hub gagal atau menjawab daftar kosong.
function syncTimDariHub() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('HUB_URL');
  if (!url || !hubSecret_()) throw new Error('Isi Script Properties HUB_URL dan SECRET_ZERODEO dulu.');
  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'text/plain', muteHttpExceptions: true, followRedirects: true,
    payload: JSON.stringify({ action: 'usersForApp', app: HUB_APP, token: makeHubToken_('zerodeo-service', 'service', 300) })
  });
  var j;
  try { j = JSON.parse(res.getContentText()); } catch (e) { throw new Error('Jawaban Hub tidak terbaca.'); }
  if (!j || !j.ok || !Array.isArray(j.users)) throw new Error((j && j.error) || 'Jawaban Hub tidak valid.');
  var users = j.users.filter(function (u) { return u && /^[a-z0-9_-]{2,30}$/.test(String(u.id)) && String(u.nama || '').trim(); });
  if (!users.length) throw new Error('Hub tidak mengembalikan anggota Zerodeo satu pun; daftar tim tidak diubah.');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TIM_TAB) || ss.insertSheet(TIM_TAB);
  var stamp = new Date().toISOString();
  var rows = users.map(function (u) { return [String(u.id), String(u.nama).trim(), String(u.peran || ''), stamp]; });
  sheet.clear();
  sheet.getRange(1, 1, 1, TIM_HEADERS.length).setValues([TIM_HEADERS]).setFontWeight('bold');
  sheet.getRange(2, 1, rows.length, TIM_HEADERS.length).setValues(rows);
  sheet.setFrozenRows(1);
  TIM_MEMO_ = null;
  cacheClear_();
  return users.length;
}

// Sinkron otomatis tanpa pemicu terjadwal. Berjalan kalau: tab Tim masih kosong, orang yang baru masuk (token sah)
// belum ada di tab Tim (anggota baru di Hub), atau sudah lebih dari 10 menit sejak sinkron terakhir.
// Tidak pernah melempar galat (Hub tidak terjangkau -> tab Tim yang ada tetap dipakai) dan tidak dicoba
// lebih sering dari tiap 20 detik, supaya Hub tidak dibebani.
function maybeSyncTim_() {
  try {
    if (!PropertiesService.getScriptProperties().getProperty('HUB_URL')) return;
    var cache = CacheService.getScriptCache();
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TIM_TAB);
    var filled = !!(sheet && sheet.getLastRow() >= 2);
    var uid = CURRENT_WHO_ ? String(CURRENT_WHO_.uid || '').toLowerCase() : '';
    var known = true;
    if (filled && uid) {
      known = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().some(function (r) { return String(r[0] || '').trim().toLowerCase() === uid; });
    }
    if (filled && known && cache.get('tim_fresh')) return;
    if (cache.get('tim_try')) return;
    cache.put('tim_try', '1', 20);
    syncTimDariHub();
    cache.put('tim_fresh', '1', 600);
  } catch (err) { /* abaikan */ }
}

function menuSinkronTim() {
  var ui = SpreadsheetApp.getUi();
  try {
    ui.alert('Tim disinkron', syncTimDariHub() + ' anggota Zerodeo diambil dari Hub.', ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('Gagal sinkron tim', String(err.message || err), ui.ButtonSet.OK);
  }
}

// Opsional: pemicu harian (jam 03.xx) sebagai cadangan. Sinkron otomatis sudah jalan sendiri saat dashboard dipakai (maybeSyncTim_).
function pasangTriggerSinkron() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncTimDariHub') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncTimDariHub').timeBased().everyDays(1).atHour(3).create();
  SpreadsheetApp.getUi().alert('Pemicu harian terpasang: tab Tim disinkron dari Hub tiap hari sekitar jam 03.00.');
}

// ============================================================
// TITIK MERAH (dipanggil Hub dengan token servis). Satu kunci = satu hal yang menunggu tindakan.
//   z:approve:<id>  — kegiatan Diajukan yang harus diputuskan (approver; admin hanya untuk kegiatan milik approver)
//   z:lengkapi:<id> — kegiatan milikmu yang sudah Ditransfer, tinggal diisi Actual dan nota
//   z:nota:<id>     — kegiatan milikmu yang Selesai tapi belum ada nota
// Tidak ada titik untuk "perlu ditransfer": yang mentransfer tidak diminta membuka dashboard lagi.
// Ditambah pengingat strategi untuk PIC-nya (z:mkt-selesai, z:mkt-hasil) dari mkt_pengingatKeys_ di Marketing.gs,
// juga untuk peran marketing.
// ============================================================
function pendingKeysFor_(rows, uid, peran, tim) {
  if (peran === 'marketing') return [];   // peran marketing tidak punya urusan uang, jadi tidak ada titik merah
  var byId = {};
  tim.forEach(function (t) { byId[t.id] = t; });
  var keys = [];
  rows.forEach(function (r) {
    var id = String(r['ID'] || '').trim();
    var status = String(r['Status'] || '');
    if (!id || status === 'Dibatalkan') return;
    var pics = resolvePicIds_(r['PIC'], tim);
    var own = ownerIds_(r['PIC'], tim).indexOf(uid) !== -1;
    if (status === 'Diajukan' && !own) {
      if (peran === 'approver') keys.push('z:approve:' + id);
      else if (peran === 'admin' && pics.some(function (p) { return byId[p] && byId[p].peran === 'approver'; })) keys.push('z:approve:' + id);
    }
    if (own) {
      if (status === 'Ditransfer') keys.push('z:lengkapi:' + id);
      else if (status === 'Selesai' && !/^https?:\/\//i.test(String(r['Nota/Bukti'] || ''))) keys.push('z:nota:' + id);
    }
  });
  return keys;
}

// Hanya menerima token servis dari Hub: uid "hub-service", peran "service". Mengembalikan kunci untuk satu pengguna.
function handlePending_(data) {
  var denied = jsonResponse({ ok: false, error: 'unauthorized' });
  var claims;
  try { claims = verifyHubToken_(data.token); } catch (e) { return denied; }
  if (claims.peran !== 'service' || claims.uid !== 'hub-service') return denied;
  var uid = String(data.for_uid || '').toLowerCase();
  if (!/^[a-z0-9_-]{2,30}$/.test(uid)) return jsonResponse({ ok: false, error: 'for_uid tidak valid.' });
  var peran = PERAN_ZERODEO.indexOf(data.for_peran) !== -1 ? data.for_peran : 'anggota';
  try { ensureKegiatanIds_(); } catch (e) { /* abaikan: dicoba lagi lain kali */ }
  var rows = sheetToObjects(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('kegiatan'));
  var tim = readTim_();
  var keys = pendingKeysFor_(rows, uid, peran, tim);
  try { keys = keys.concat(mkt_pengingatKeys_(uid, tim)); } catch (e) { /* tab marketing belum ada: lewati */ }
  try { keys = keys.concat(seed_keys_(uid, peran, tim)); } catch (e) { /* tab seeding belum ada: lewati */ }
  return jsonResponse({ ok: true, keys: keys });
}

// ============================================================
// BOT TELEGRAM HUB: baca data atas nama satu orang. Dipanggil Hub (token servis, sama seperti "pending"); Hub sudah memeriksa
// orang itu punya akses Zerodeo dan mengirim perannya. Di sini peran itu diterapkan lagi: peran marketing tidak menerima
// kegiatan, dana, atau angka uang apa pun. Hanya membaca, tidak ada yang diubah.
//   jenis: ringkasan | kegiatan | transfer_global | strategi | hasil_event | seeding | pengingat
// ============================================================
var BOT_BACA_MAKS = 40;
function handleBotBaca_(data) {
  var denied = jsonResponse({ ok: false, error: 'unauthorized' });
  var claims;
  try { claims = verifyHubToken_(data.token); } catch (e) { return denied; }
  if (claims.peran !== 'service' || claims.uid !== 'hub-service') return denied;
  var uid = String(data.for_uid || '').toLowerCase();
  if (!/^[a-z0-9_-]{2,30}$/.test(uid)) return jsonResponse({ ok: false, error: 'for_uid tidak valid.' });
  if (PERAN_ZERODEO.indexOf(data.for_peran) === -1) return denied;
  var q = data.q && typeof data.q === 'object' ? data.q : {};
  try { return jsonResponse({ ok: true, hasil: botBaca_(uid, data.for_peran, q) }); }
  catch (e) { return jsonResponse({ ok: false, error: String(e && e.message || e) }); }
}

function botBaca_(uid, peran, q) {
  var uang = peran !== 'marketing';
  var tim = readTim_();
  var nama = function (v) { return resolvePicIds_(v, tim).map(function (id) { return picNama_(id); }).join(', ') || String(v || ''); };
  var milik = function (v) { return ownerIds_(v, tim).indexOf(uid) !== -1; };
  var teks = String(q.teks || '').trim().toLowerCase();
  var jenis = String(q.jenis || 'ringkasan');
  var potong = function (list) { return { total: list.length, data: list.slice(0, BOT_BACA_MAKS), dipotong: list.length > BOT_BACA_MAKS }; };
  var kegMemo = null;
  var kegiatan = function () {
    if (kegMemo) return kegMemo;
    try { ensureKegiatanIds_(); } catch (e) { /* abaikan */ }
    return kegMemo = sheetToObjects(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('kegiatan')).filter(function (r) { return r['Item Kegiatan'] || r['ID']; });
  };
  var adaNota = function (r) { return /^https?:\/\//i.test(String(r['Nota/Bukti'] || '')); };

  if (jenis === 'kegiatan') {
    if (!uang) throw new Error('Peran marketing tidak bisa melihat kegiatan Budgeting.');
    var list = kegiatan().filter(function (r) {
      if (q.status && String(r['Status']) !== String(q.status)) return false;
      if (!q.status && !q.termasuk_selesai && (r['Status'] === 'Selesai' || r['Status'] === 'Dibatalkan')) return false;
      if (q.milikku && !milik(r['PIC'])) return false;
      if (q.belum_nota && !(r['Status'] === 'Selesai' && !adaNota(r))) return false;
      if (teks && ((r['Item Kegiatan'] || '') + ' ' + (r['Project/Brand'] || '') + ' ' + (r['Catatan'] || '')).toLowerCase().indexOf(teks) === -1) return false;
      return true;
    });
    var riwayatTf = {};
    try { riwayatTf = getTransferData_(); } catch (err) { riwayatTf = {}; }
    list = list.map(function (r) {
      var est = Number(r['Estimasi (Rp)']) || 0, tf = Number(r['Nominal Transfer (Rp)']) || 0;
      var sebagian = tf > 0 && ['Ditransfer', 'Selesai', 'Dibatalkan'].indexOf(String(r['Status'])) === -1;
      var o = { id: r['ID'], item: r['Item Kegiatan'], project: r['Project/Brand'] || '', pic: nama(r['PIC']), status: sebagian ? r['Status'] + ' · ditransfer sebagian' : r['Status'],
        deadline: r['Deadline Kegiatan'] || '', estimasi: est, actual: Number(r['Actual (Rp)']) || 0,
        transfer: tf, nota: adaNota(r), dana: r['Dana'] || '', kategori: r['Kategori'] || '', catatan: String(r['Catatan'] || '').slice(0, 200) };
      if (sebagian) o.sisa_transfer = Math.max(0, est - tf);
      if (riwayatTf[String(r['ID'])]) o.riwayat_transfer = riwayatTf[String(r['ID'])].map(function (t) { return t.ket + ' ' + t.tgl + ' Rp' + t.nominal + (t.bukti ? ' (bukti: ' + t.bukti + ')' : ' (tanpa bukti)'); });
      return o;
    });
    return potong(list);
  }
  if (jenis === 'transfer_global') {
    // Untuk Budget WBA di Hub: semua uang yang keluar dari Zerodeo (ringkas, tanpa detail kegiatan) + angka bulan ini.
    // kunci tetap per transfer, dipakai Hub untuk mencatat koreksi kantong tanpa mengubah data Zerodeo.
    if (!uang) throw new Error('Peran marketing tidak bisa melihat angka Budgeting.');
    var tz = Session.getScriptTimeZone();
    var bulan = /^\d{4}-\d{2}$/.test(String(q.bulan || '')) ? String(q.bulan) : Utilities.formatDate(new Date(), tz, 'yyyy-MM');
    var riw = {};
    try { riw = getTransferData_(); } catch (err) { riw = {}; }
    var keluar = [], rk = { bulan: bulan, rencana: 0, ditransfer: 0, sisa_pelunasan: 0, menunggu_approve: 0, belum_nota: 0 };
    kegiatan().forEach(function (r) {
      var st = String(r['Status'] || ''), id = String(r['ID'] || '');
      if (st === 'Dibatalkan') return;
      var est = Number(r['Estimasi (Rp)']) || 0, tf = Number(r['Nominal Transfer (Rp)']) || 0;
      if (st !== 'Ditolak' && String(r['Tanggal Dicatat'] || '').slice(0, 7) === bulan) rk.rencana += est;
      if (st === 'Diajukan') rk.menunggu_approve++;
      if (tf > 0 && ['Ditransfer', 'Selesai'].indexOf(st) === -1) rk.sisa_pelunasan += Math.max(0, est - tf);
      if (st === 'Selesai' && !adaNota(r)) rk.belum_nota++;
      if (r['Dana']) return;   // dibayar dari dana bulk: uangnya dihitung lewat dana (di bawah)
      var list = riw[id] || [];
      if (list.length) list.forEach(function (t, i) { keluar.push({ kunci: 'zd:t:' + id + ':' + i, item: String(r['Item Kegiatan'] || ''), ket: t.ket, tgl: t.tgl, nominal: t.nominal }); });
      else if (tf > 0 && r['Tgl Transfer']) keluar.push({ kunci: 'zd:k:' + id, item: String(r['Item Kegiatan'] || ''), ket: 'Lunas', tgl: String(r['Tgl Transfer']).slice(0, 10), nominal: tf });
    });
    try {
      readDana_().forEach(function (d) {
        var n = Number(d['Nominal (Rp)']) || 0;
        if (n > 0 && d['Tgl Transfer']) keluar.push({ kunci: 'zd:d:' + d['Nama Dana'], item: 'Dana: ' + d['Nama Dana'], ket: 'Dana bulk', tgl: String(d['Tgl Transfer']).slice(0, 10), nominal: n });
      });
    } catch (err) { /* tab dana belum ada */ }
    keluar.forEach(function (t) { if (String(t.tgl).slice(0, 7) === bulan) rk.ditransfer += t.nominal; });
    keluar.sort(function (a, b) { return String(b.tgl).localeCompare(String(a.tgl)); });
    return { rekap: rk, keluar: keluar };
  }
  if (jenis === 'strategi') {
    var st = mkt_readTab_('strategi').filter(function (r) {
      if (q.status && r['Status'] !== q.status) return false;
      if (q.milikku && !milik(r['PIC'])) return false;
      if (teks && ((r['Nama Strategi'] || '') + ' ' + (r['Pesan Inti'] || '') + ' ' + (r['Channel'] || '')).toLowerCase().indexOf(teks) === -1) return false;
      return true;
    }).map(function (r) {
      return { id: r['ID'], nama: r['Nama Strategi'], lane: r['Lane'] || '', channel: r['Channel'] || '', pesan: String(r['Pesan Inti'] || '').slice(0, 200),
        mulai: r['Mulai'] || '', selesai: r['Selesai'] || '', pic: nama(r['PIC']), status: r['Status'] };
    });
    return potong(st);
  }
  if (jenis === 'seeding') {
    // batch seeding + ringkasan kreator; dengan id / teks: ikut daftar kreatornya
    var kr = mkt_readTab_('seeding_kreator');
    var bs = mkt_readTab_('seeding').filter(function (b) {
      if (q.id && String(b['ID']) !== String(q.id)) return false;
      if (q.status && String(b['Status']) !== String(q.status)) return false;
      if (!q.id && !q.status && !q.termasuk_selesai && ['Selesai', 'Ditolak', 'Dibatalkan'].indexOf(String(b['Status'])) !== -1) return false;
      if (teks && ((b['Nama Batch'] || '') + ' ' + (b['Produk'] || '') + ' ' + (b['Lane'] || '')).toLowerCase().indexOf(teks) === -1) return false;
      return true;
    }).map(function (b) {
      var o = seed_ringkas_(b, kr, uang);
      if (q.id || teks || q.detail) o.daftar_kreator = kr.filter(function (k) { return String(k['Batch']) === String(b['ID']); }).map(function (k) {
        return { akun: k['Akun'] ? '@' + seed_akun_(k['Akun']) : '', nama: k['Nama'] || '', platform: k['Platform'] || '', varian: k['Varian'] || '', qty: Number(k['Qty']) || 1, status: k['Status'] || 'Rencana', terima: k['Tgl Terima'] || '', link: k['Link Konten'] || '', views: Number(k['Views']) || 0 };
      });
      return o;
    });
    return potong(bs);
  }
  if (jenis === 'hasil_event') {
    var keg = uang ? kegiatan() : [];
    var byId = {};
    keg.forEach(function (k) { byId[String(k['ID'])] = k; });
    var ev = mkt_readTab_('hasil_event').filter(function (e) {
      if (q.strategi && String(e['Strategi'] || '').toLowerCase() !== String(q.strategi).toLowerCase()) return false;
      if (teks && ((e['Nama Event'] || '') + ' ' + (e['Channel'] || '') + ' ' + (e['Nama Komunitas'] || '')).toLowerCase().indexOf(teks) === -1) return false;
      return true;
    }).sort(function (a, b) { return String(b['Tanggal Event'] || '').localeCompare(String(a['Tanggal Event'] || '')); }).map(function (e) {
      var o = { tanggal: e['Tanggal Event'] || '', nama: e['Nama Event'], channel: e['Channel'] || '', komunitas: e['Nama Komunitas'] || '',
        hadir: Number(e['Hadir']) || 0, coba: Number(e['Coba Produk']) || 0, tanya: Number(e['Tanya Beli Di Mana']) || 0,
        order: Number(e['Order via Kode']) || 0, ugc: Number(e['Konten UGC']) || 0, strategi: e['Strategi'] || '' };
      if (uang) {
        var rp = 0, perkiraan = false;
        String(e['Kegiatan'] || '').split(',').forEach(function (id) {
          var k = byId[id.trim()]; if (!k || k['Status'] === 'Dibatalkan') return;
          var act = Number(k['Actual (Rp)']) || 0;
          if (act > 0) rp += act; else { rp += Number(k['Estimasi (Rp)']) || 0; perkiraan = true; }
        });
        o.biaya = rp; o.biaya_perkiraan = perkiraan;
      }
      return o;
    });
    return potong(ev);
  }
  // ringkasan / pengingat: yang menunggu tindakan orang ini, dalam kalimat
  var tindakan = [], item = [];   // item: bentuk terstruktur (jenis + id) untuk tombol di Telegram
  if (uang) {
    var keys = pendingKeysFor_(kegiatan(), uid, peran, tim);
    var kegById = {};
    kegiatan().forEach(function (k) { kegById[String(k['ID'])] = k; });
    keys.forEach(function (key) {
      var p = key.split(':'), k = kegById[p[2]];
      if (!k) return;
      var label = { approve: 'perlu diputuskan (approve/tolak)', lengkapi: 'sudah ditransfer, tinggal isi Actual dan nota', nota: 'selesai tapi belum ada nota' }[p[1]];
      tindakan.push('Kegiatan "' + k['Item Kegiatan'] + '"' + (k['Project/Brand'] ? ' (' + k['Project/Brand'] + ')' : '') + ': ' + label);
      item.push({ jenis: p[1], id: p[2], judul: String(k['Item Kegiatan'] || ''), project: String(k['Project/Brand'] || ''), pic: resolvePicIds_(k['PIC'], tim).map(function (x) { return picNama_(x); }).join(', '),
        estimasi: Number(k['Estimasi (Rp)']) || 0, transfer: Number(k['Nominal Transfer (Rp)']) || 0, sejak: zTgl_(k['Tanggal Dicatat']) });
    });
  }
  var stById = {};
  mkt_readTab_('strategi').forEach(function (s) { stById[String(s['ID'])] = s; });
  mkt_pengingatKeys_(uid, tim).forEach(function (key) {
    var p = key.split(':'), s = stById[p[2]];
    if (!s) return;
    tindakan.push('Strategi "' + s['Nama Strategi'] + '": ' + (p[1] === 'mkt-selesai' ? 'sudah lewat tanggal selesai (' + s['Selesai'] + ') tapi masih Jalan' : 'sudah selesai, hasil event-nya belum diisi'));
    item.push({ jenis: p[1], id: p[2], judul: String(s['Nama Strategi'] || ''), selesai: String(s['Selesai'] || '') });
  });
  try {
    seed_tindakan_(uid, peran, tim).forEach(function (t) { tindakan.push(t.teks); var sb = t.jenis === 'seed-acc' ? seed_cari_(t.id) : null; item.push({ jenis: t.jenis, id: t.id, judul: t.judul, sejak: sb ? zTgl_(sb['Dicatat Pada']) : '' }); });
  } catch (e) { /* tab seeding belum ada */ }
  if (jenis === 'pengingat') return { tindakan: tindakan };
  var out = { peran: peran, tindakan: tindakan, item: item };
  if (uang) {
    var hitung = {};
    kegiatan().forEach(function (k) { var s = k['Status'] || '(kosong)'; hitung[s] = (hitung[s] || 0) + 1; });
    out.kegiatan_per_status = hitung;
  }
  var hs = {};
  mkt_readTab_('strategi').forEach(function (s) { var x = s['Status'] || '(kosong)'; hs[x] = (hs[x] || 0) + 1; });
  out.strategi_per_status = hs;
  out.jumlah_hasil_event = mkt_readTab_('hasil_event').length;
  return out;
}

// ============================================================
// BOT TELEGRAM HUB: aksi atas nama satu orang, setelah dia menekan "Ya" di Telegram. Diterjemahkan ke permintaan yang
// sama dengan dashboard lalu lewat routePost_ yang sama: semua aturan peran berlaku persis (marketing hanya Marketing,
// approve hanya approver/admin dan bukan milik sendiri, ubah hanya PIC/approver/admin, dst.) dan tercatat di log aktivitas.
// Kegiatan ditunjuk dengan ID (bukan nomor baris). Foto nota tetap lewat dashboard.
// ============================================================
function handleBotAksi_(data) {
  var denied = jsonResponse({ ok: false, error: 'unauthorized' });
  var claims;
  try { claims = verifyHubToken_(data.token); } catch (e) { return denied; }
  if (claims.peran !== 'service' || claims.uid !== 'hub-service') return denied;
  CURRENT_WHO_ = normalizeWho_({ uid: String(data.for_uid || '').toLowerCase(), peran: data.for_peran });
  if (!CURRENT_WHO_) return denied;
  var tolak = enforceTimAccess_();
  if (tolak) return jsonResponse({ ok: false, error: tolak });
  var nat = botNative_(data.aksi && typeof data.aksi === 'object' ? data.aksi : {});
  if (nat.error) return jsonResponse({ ok: false, error: nat.error });
  nat.via = 'telegram';   // tercatat di log aktivitas
  try {
    var out = routePost_(nat);
    logAktivitas_(nat, out);
    return out;
  } finally {
    cacheClear_();
  }
}

function botBarisKegiatan_(id) {
  id = String(id || '').trim();
  if (!id) return 0;
  try { ensureKegiatanIds_(); } catch (e) { /* abaikan */ }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('kegiatan');
  var last = sheet ? sheet.getLastRow() : 0;
  if (last <= HEADER_ROW) return 0;
  var ids = sheet.getRange(HEADER_ROW + 1, COL.ID, last - HEADER_ROW, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) return HEADER_ROW + 1 + i;
  return 0;
}

var BOT_FOTO_MAKS = 7 * 1024 * 1024;   // karakter base64 (~5 MB file)
function botFotoNota_(a) {
  if (!a.photoBase64) return {};
  var mime = a.photoMime === 'application/pdf' ? 'application/pdf' : 'image/jpeg';
  var b64 = String(a.photoBase64);
  if (b64.length > BOT_FOTO_MAKS || !/^[A-Za-z0-9+\/=]+$/.test(b64.slice(0, 200))) return { error: 'Foto nota tidak valid atau terlalu besar.' };
  return { photoBase64: b64, photoMime: mime };
}

function botNative_(a) {
  var baris = function () { var r = botBarisKegiatan_(a.id); return r ? r : null; };
  var j = String(a.jenis || '');
  var perluBaris = { putuskan: 'update_status', tandai_transfer: 'mark_transferred', tempel_bukti: 'attach_transfer_proof', lengkapi: 'complete_kegiatan', ubah_kegiatan: 'edit_kegiatan', batalkan_kegiatan: 'cancel_kegiatan', pulihkan_kegiatan: 'restore_kegiatan' };
  if (perluBaris[j]) {
    var row = baris();
    if (!row) return { error: 'Kegiatan dengan ID "' + String(a.id || '') + '" tidak ditemukan.' };
    if (j === 'putuskan') return { action: 'update_status', row: row, status: a.status };
    // foto/PDF nota / bukti transfer dari Telegram (diteruskan Hub sebagai base64) disimpan ke Drive persis seperti dari dashboard
    var foto = botFotoNota_(a);
    if (foto.error) return foto;
    if (j === 'tempel_bukti') return foto.photoBase64 ? Object.assign({ action: 'attach_transfer_proof', row: row, keterangan: a.keterangan || '', ganti: a.ganti === true }, foto) : { error: 'Foto / PDF bukti transfernya tidak ikut. Kirim fotonya lagi bersama perintahnya.' };
    if (j === 'tandai_transfer') return Object.assign({ action: 'mark_transferred', row: row, nominalTransfer: a.nominal, picTransaksi: a.pic_transaksi, tglTransfer: a.tanggal || '', keterangan: a.keterangan || '' }, foto);
    if (j === 'lengkapi') return Object.assign({ action: 'complete_kegiatan', row: row, actual: a.actual }, foto);
    if (j === 'batalkan_kegiatan') return { action: 'cancel_kegiatan', row: row, alasan: a.alasan || '' };
    if (j === 'pulihkan_kegiatan') return { action: 'restore_kegiatan', row: row };
    var ed = { action: 'edit_kegiatan', row: row };
    ['item', 'kategori', 'tipe', 'pic', 'estimasi', 'deadline', 'nota'].forEach(function (k) { if (a[k] !== undefined && a[k] !== null) ed[k] = a[k]; });
    if (a.nominal !== undefined && a.nominal !== null) ed.nominalTransfer = a.nominal;
    if (a.pic_transaksi !== undefined && a.pic_transaksi !== null) ed.picTransaksi = a.pic_transaksi;
    if (a.tanggal_transfer !== undefined && a.tanggal_transfer !== null) ed.tglTransfer = a.tanggal_transfer;
    if (a.actual !== undefined && a.actual !== null) ed.actual = a.actual;
    return Object.assign(ed, foto);
  }
  if (j === 'ajukan_kegiatan') {
    var st = a.status || 'Diajukan';
    if (['Draft', 'Siap Ajukan', 'Diajukan'].indexOf(st) === -1) return { error: 'Status kegiatan baru harus Draft, Siap Ajukan, atau Diajukan.' };
    if (a.jalur && ['Fixed', 'Pengajuan'].indexOf(a.jalur) === -1) return { error: 'Jalur harus Fixed atau Pengajuan.' };
    var baru = { action: 'add_kegiatan', item: a.item, kategori: a.kategori, tipe: a.tipe, jalur: a.jalur || 'Pengajuan', pic: a.pic, estimasi: a.estimasi, deadline: a.deadline || '', status: st };
    if (a.dana) baru.dana = a.dana;
    return baru;
  }
  if (j === 'strategi_baru') return { action: 'add_strategi', nama: a.nama, pesan: a.pesan, lane: a.lane || [], channel: a.channel || [], mulai: a.mulai, selesai: a.selesai || '', pic: a.pic, status: a.status || 'Ide', kalender: a.kalender !== false };
  if (j === 'status_strategi') return { action: 'update_strategi_status', id: a.id, status: a.status };
  if (j === 'tanggal_strategi') { var ts = { action: 'update_strategi_tanggal', id: a.id }; if (a.mulai) ts.mulai = a.mulai; if (a.selesai !== undefined && a.selesai !== null) ts.selesai = a.selesai; return ts; }
  if (j === 'hasil_event_baru') return { action: 'add_hasil_event', nama: a.nama, tanggal: a.tanggal, channel: Array.isArray(a.channel) ? a.channel[0] : a.channel, komunitas: a.komunitas || '', kode: a.kode || '',
    hadir: a.hadir || 0, coba: a.coba || 0, tanya: a.tanya || 0, order: a.order || 0, ugc: a.ugc || 0, strategi: a.strategi || '', pic: a.pic, kegiatan: a.kegiatan || [] };
  if (j === 'atur_label') return { action: 'atur_label', jenis: a.label_jenis || a.jenis_label || 'lane', op: a.operasi || 'tambah', nama: a.nama, baru: a.baru || '' };
  if (j === 'seeding_baru') return { action: 'add_seeding', nama: a.nama, produk: a.produk || '', lane: a.lane || '', sampel: a.sampel || '', platform: a.platform || '', estimasi: a.estimasi, batas: a.batas, pic: a.pic, strategi: a.strategi || '', catatan: a.catatan || '', kreator: a.kreator || [], kalender: a.kalender === true };
  if (j === 'putuskan_seeding') return { action: 'putuskan_seeding', id: a.id, status: a.status, alasan: a.alasan || '' };
  if (j === 'ubah_seeding') { var us = { action: 'update_seeding', id: a.id }; ['status', 'nama', 'produk', 'lane', 'sampel', 'platform', 'pic', 'estimasi', 'batas', 'catatan', 'kegiatan', 'kalender'].forEach(function (k) { if (a[k] !== undefined && a[k] !== null) us[k] = a[k]; }); return us; }
  if (j === 'kreator_hapus') return { action: 'hapus_kreator', batch: a.id, akun: a.akun || a.nama };
  if (j === 'kreator_tambah') return { action: 'add_kreator', batch: a.id, kreator: a.kreator || [] };
  if (j === 'kreator_update') { var ku = { action: 'update_kreator', batch: a.id, akun: a.akun || a.nama, status: a.status, link: a.link || '', tanggal: a.tanggal || '' }; ['views', 'catatan', 'akun_baru', 'nama_baru', 'platform_baru', 'varian', 'qty'].forEach(function (k) { if (a[k] !== undefined && a[k] !== null) ku[k] = a[k]; }); return ku; }
  if (j === 'tautkan_event') return { action: 'update_hasil_event_kegiatan', id: a.id, kegiatan: a.kegiatan || [] };
  return { error: 'Aksi tidak dikenal.' };
}

// ============================================================
// LOG AKTIVITAS (tab "log_aktivitas"): setiap aksi tulis yang berhasil dicatat otomatis oleh script,
// lengkap dengan siapa pelakunya. Menjawab "siapa yang meng-approve / mencatat transfer ini".
// Catatan: Google Sheets tidak bisa membuat tab benar-benar tidak bisa diubah; tab ini hanya diberi
// peringatan saat diedit. Siapa pun yang punya akses edit ke Sheet tetap bisa mengubahnya.
// ============================================================
var LOG_FIELDS_ = ['status', 'item', 'kategori', 'tipe', 'pic', 'estimasi', 'nominalTransfer', 'nominal', 'actual',
  'picTransaksi', 'dana', 'nama', 'alasan', 'reimburse', 'arsip', 'via'];

function ensureLogTab_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(LOG_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_TAB);
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    try { sheet.protect().setDescription('Log aktivitas (otomatis)').setWarningOnly(true); } catch (e) { /* abaikan */ }
  }
  return sheet;
}

function logSummary_(data) {
  var o = {};
  LOG_FIELDS_.forEach(function (k) {
    if (data[k] === undefined || data[k] === null || data[k] === '') return;
    o[k] = typeof data[k] === 'string' ? data[k].slice(0, 80) : data[k];
  });
  var n = Array.isArray(data.rows) ? data.rows.length : (Array.isArray(data.items) ? data.items.length : 0);
  if (n) o.baris = n;
  var s = JSON.stringify(o);
  return s.length > 300 ? s.slice(0, 297) + '...' : s;
}

function logRowNumbers_(data, res) {
  var rows = [];
  if (data.row) rows.push(Number(data.row));
  if (Array.isArray(data.rows)) data.rows.forEach(function (r) { rows.push(Number(r)); });
  if (Array.isArray(data.items)) data.items.forEach(function (it) { if (it && it.row) rows.push(Number(it.row)); });
  if (res && res.row && !rows.length) rows.push(Number(res.row));
  return rows.filter(function (r) { return r > HEADER_ROW; }).slice(0, 20);
}

// ============================================================
// KABAR TELEGRAM LANGSUNG (lewat Hub, action kabarApp). Dipanggil setelah aksi berhasil; tidak pernah menggagalkan aksinya.
//   perlu_acc  : kegiatan / seeding baru diajukan (atau diajukan lagi) -> yang boleh memutuskan (tombol Acc / Revisi / Tolak di bot)
//   diputuskan : kegiatan / seeding di-approve / ditolak / diminta revisi -> PIC (+ pengaju seeding)
//   ditransfer : kegiatan ditransfer -> PIC
// Pelakunya sendiri tidak dikabari. Hub yang memeriksa ulang: Telegram tertaut, kabar menyala, peran Zerodeo yang sesuai.
// ============================================================
// tanggal (Date / teks) -> 'yyyy-MM-dd' (kosong kalau tidak terbaca); dipakai Hub untuk pengingat "sudah N hari menunggu"
function zTgl_(v) {
  var d = v instanceof Date ? v : (v ? mkt_parseDate_(v) : null);
  return d && !isNaN(d.getTime()) ? Utilities.formatDate(d, 'Asia/Jakarta', 'yyyy-MM-dd') : '';
}
function zDeciders_(owners) {
  var adaApprover = owners.some(isApproverId_);
  return readTim_().filter(function (t) {
    return owners.indexOf(t.id) === -1 && (t.peran === 'approver' || (t.peran === 'admin' && adaApprover));
  }).map(function (t) { return t.id; });
}
function kabarSesudah_(data, out) {
  try {
    if (!PropertiesService.getScriptProperties().getProperty('HUB_URL') || !hubSecret_()) return;
    var res = JSON.parse(out.getContent());
    if (!res || res.ok !== true) return;
    var a = data.action || 'add_kegiatan', oleh = CURRENT_WHO_ ? CURRENT_WHO_.uid : '';
    var kirim = [];
    if (['add_kegiatan', 'update_status', 'mark_transferred'].indexOf(a) !== -1) {
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('kegiatan');
      logRowNumbers_(data, res).slice(0, 5).forEach(function (r) {
        var v = sh.getRange(r, 1, 1, COL.ID).getValues()[0];
        var owners = ownerIds_(v[COL.PIC - 1]), st = String(v[COL.STATUS - 1]);
        var info = { jenis: 'kegiatan', id: String(v[COL.ID - 1] || ''), judul: String(v[COL.ITEM - 1] || '').slice(0, 120), project: String(v[COL.PROJECT - 1] || '').slice(0, 40),
          estimasi: Number(v[COL.ESTIMASI - 1]) || 0, oleh: picNama_(oleh), pic: owners.map(picNama_).join(', ') };
        if (!info.id) return;
        if (a === 'add_kegiatan' && st === 'Diajukan') { info.lagi = !!data.row; kirim.push({ kabar: 'perlu_acc', ke: zDeciders_(owners), data: info }); }
        if (a === 'update_status') { info.status = String(data.status || ''); info.alasan = String(data.alasan || '').slice(0, 200); kirim.push({ kabar: 'diputuskan', ke: owners, data: info }); }
        if (a === 'mark_transferred') { info.ket = String(res.keterangan || ''); info.nominal = Number(data.nominalTransfer) || 0; info.sebagian = !!res.sebagian; kirim.push({ kabar: 'ditransfer', ke: owners, data: info }); }
      });
    }
    if (a === 'add_seeding' || a === 'putuskan_seeding' || (a === 'update_seeding' && data.status === 'Diajukan')) {
      var b = seed_cari_(res.id || data.id);
      if (b) {
        var pemilik = ownerIds_(b['PIC']).concat([String(b['Diajukan Oleh'] || '')]).filter(Boolean);
        var nKr = seed_rows_('seeding_kreator').filter(function (k) { return String(k['Batch']) === String(b['ID']); }).length;
        var sp = seed_sampel_(b), totalPcs = sp.reduce(function (x, y) { return x + y.qty; }, 0);
        var si = { jenis: 'seeding', id: String(b['ID']), judul: String(b['Nama Batch'] || '').slice(0, 120), produk: String(b['Produk'] || '').slice(0, 80), oleh: picNama_(oleh),
          pic: ownerIds_(b['PIC']).map(picNama_).join(', '), kreator: nKr, sampel: sp.map(function (x) { return x.varian + (x.qty ? ' ×' + x.qty : ''); }).join(', ').slice(0, 160),
          total_pcs: totalPcs, platform: String(b['Platform'] || '').slice(0, 80), estimasi: Number(b['Estimasi (Rp)']) || 0 };
        if (a === 'putuskan_seeding') { si.status = String(res.status || ''); si.alasan = String(data.alasan || '').slice(0, 200); kirim.push({ kabar: 'diputuskan', ke: pemilik, data: si }); }
        else if (String(b['Status']) === 'Diajukan') {
          si.lagi = a === 'update_seeding';
          var dec = readTim_().filter(function (t) { return t.peran === 'approver' || (t.peran === 'admin' && pemilik.indexOf(t.id) === -1); }).map(function (t) { return t.id; });
          kirim.push({ kabar: 'perlu_acc', ke: dec, data: si });
        }
      }
    }
    kirim = kirim.filter(function (k) {
      k.ke = k.ke.filter(function (id, i, arr) { return id && id !== oleh && arr.indexOf(id) === i; });
      return k.ke.length > 0;
    });
    // sinkron ke Tracker: strategi & seeding jadi tugas (judul, PIC, tanggal, status); detail tetap di Zerodeo
    var sk = zSinkronItem_(a, data, res, oleh);
    if (sk) kirim.push({ sinkron: sk, ke: ['-'] });
    if (!kirim.length) return;
    // dari web: ditaruh di antrean, dikirim saat web memanggil "kirim_kabar" di belakang (simpanan tidak menunggu kabar).
    // dari bot (via telegram): langsung dikirim, sekalian antrean yang masih ada.
    if (data.via === 'telegram' || !zKabarAntre_(kirim)) { zKabarKirim_(kirim); zKabarKirimAntre_(); }
  } catch (err) { /* kabar gagal: aksinya tetap jalan */ }
}
var ZKABAR_KEY = 'zkabar:antre';
function zKabarAntre_(list) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return false;
  try {
    var c = CacheService.getScriptCache(), ada = [];
    try { ada = JSON.parse(c.get(ZKABAR_KEY) || '[]') || []; } catch (e) { ada = []; }
    c.put(ZKABAR_KEY, JSON.stringify(ada.concat(list).slice(-50)), 21600);
    return true;
  } finally { lock.releaseLock(); }
}
function zKabarKirimAntre_() {
  var list = [];
  var lock = LockService.getScriptLock();
  if (lock.tryLock(3000)) {
    try {
      var c = CacheService.getScriptCache();
      try { list = JSON.parse(c.get(ZKABAR_KEY) || '[]') || []; } catch (e) { list = []; }
      if (list.length) c.remove(ZKABAR_KEY);
    } finally { lock.releaseLock(); }
  }
  zKabarKirim_(list);
  return { ok: true, terkirim: list.length };
}
function zKabarKirim_(list) {
  var url = PropertiesService.getScriptProperties().getProperty('HUB_URL');
  if (!url || !hubSecret_()) return;
  var sinkron = list.filter(function (k) { return k.sinkron; }).map(function (k) { return k.sinkron; });
  var kirimKe = function (body) {
    try {
      UrlFetchApp.fetch(url, { method: 'post', contentType: 'text/plain', muteHttpExceptions: true, followRedirects: true,
        payload: JSON.stringify(Object.assign({ app: HUB_APP, token: makeHubToken_('zerodeo-service', 'service', 300) }, body)) });
    } catch (e) { /* satu kiriman gagal: lanjut yang lain */ }
  };
  if (sinkron.length) kirimKe({ action: 'sinkronTugas', items: sinkron });
  list.forEach(function (k) { if (!k.sinkron) kirimKe({ action: 'kabarApp', kabar: k.kabar, ke: k.ke, data: k.data }); });
}
// Tugas Tracker sesuai strategi / seeding (dikirim ke Hub, Hub yang membuat / memperbarui tugasnya)
function zTambahHari_(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
function zSinkronItem_(a, data, res, oleh) {
  if (a === 'add_strategi' || a === 'update_strategi_status' || a === 'update_strategi_tanggal') {
    var id = String(res.id || data.id || '');
    var r = mkt_readTab_('strategi').filter(function (x) { return String(x['ID']) === id; })[0];
    if (!r) return null;
    var mulai = zTgl_(r['Mulai']), selesai = zTgl_(r['Selesai']);
    return { jenis: 'strategi', id: id, judul: String(r['Nama Strategi'] || ''), pic: ownerIds_(r['PIC']).join(','), mulai: mulai, deadline: selesai || mulai,
      status: String(r['Status'] || 'Ide'), kalender: String(r['Kalender'] || 'ya') !== 'tidak', oleh: oleh, tugas_id: a === 'add_strategi' && data.tugas_id ? String(data.tugas_id).slice(0, 60) : '' };
  }
  if (['add_seeding', 'update_seeding', 'putuskan_seeding'].indexOf(a) !== -1) {
    var b = seed_cari_(res.id || data.id);
    if (!b) return null;
    // tenggat kerja seeding: kirim sampel (± 7 hari) + batas posting sejak diterima
    var dicatat = b['Dicatat Pada'] instanceof Date ? b['Dicatat Pada'] : (mkt_parseDate_(b['Dicatat Pada']) || new Date());
    var batas = mkt_int_(b['Batas Posting (hari)']) || SEED_BATAS_BAWAAN;
    return { jenis: 'seeding', id: String(b['ID']), judul: 'Seeding: ' + String(b['Nama Batch'] || ''), pic: ownerIds_(b['PIC']).join(','),
      mulai: zTgl_(dicatat), deadline: zTgl_(zTambahHari_(dicatat, batas + 7)), status: String(b['Status'] || ''), kalender: String(b['Kalender'] || '') === 'ya', oleh: oleh };
  }
  return null;
}
// Tugas Tracker biasa di project Zerodeo, dari Hub (disimpan sebentar supaya halaman tidak menunggu Hub tiap kali)
function zTugasTracker_() {
  var c = CacheService.getScriptCache(), hit = c.get('ztugas:tracker');
  if (hit) { try { return { ok: true, tugas: JSON.parse(hit) }; } catch (e) { /* ambil ulang */ } }
  var url = PropertiesService.getScriptProperties().getProperty('HUB_URL');
  if (!url || !hubSecret_()) return { ok: true, tugas: [] };
  try {
    var r = UrlFetchApp.fetch(url, { method: 'post', contentType: 'text/plain', muteHttpExceptions: true, followRedirects: true,
      payload: JSON.stringify({ action: 'tugasUntukApp', app: HUB_APP, token: makeHubToken_('zerodeo-service', 'service', 300) }) });
    var j = JSON.parse(r.getContentText());
    if (!j || !j.ok || !Array.isArray(j.tugas)) return { ok: true, tugas: [], catatan: (j && j.error) || 'Hub belum versi terbaru.' };
    c.put('ztugas:tracker', JSON.stringify(j.tugas), 120);
    return { ok: true, tugas: j.tugas };
  } catch (e) { return { ok: true, tugas: [], catatan: 'Hub tidak terjangkau.' }; }
}

// Dipanggil setelah aksi berhasil. Kegagalan mencatat log tidak boleh menggagalkan aksinya.
function logAktivitas_(data, out) {
  try {
    if (data.action === 'get_data' || data.action === 'pending' || data.action === 'kirim_kabar') return;
    var res = JSON.parse(out.getContent());
    if (!res || res.ok !== true) return;
    var ids = [];
    var ksheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('kegiatan');
    if (ksheet) {
      logRowNumbers_(data, res).forEach(function (r) {
        var id = String(ksheet.getRange(r, COL.ID).getValue() || '').trim();
        if (id) ids.push(id);
      });
    }
    ensureLogTab_().appendRow([new Date(), CURRENT_WHO_ ? CURRENT_WHO_.uid : '(kode tim)', CURRENT_WHO_ ? CURRENT_WHO_.peran : '',
      data.action || 'add_kegiatan', ids.join(','), logSummary_(data)]);
  } catch (err) { /* abaikan */ }
  kabarSesudah_(data, out);   // kabar Telegram (lewat Hub) untuk pengajuan / keputusan / transfer
}
