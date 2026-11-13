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
  return jsonResponse({ ok: true, keys: keys });
}

// ============================================================
// BOT TELEGRAM HUB: baca data atas nama satu orang. Dipanggil Hub (token servis, sama seperti "pending"); Hub sudah memeriksa
// orang itu punya akses Zerodeo dan mengirim perannya. Di sini peran itu diterapkan lagi: peran marketing tidak menerima
// kegiatan, dana, atau angka uang apa pun. Hanya membaca, tidak ada yang diubah.
//   jenis: ringkasan | kegiatan | strategi | hasil_event | pengingat
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
    }).map(function (r) {
      return { id: r['ID'], item: r['Item Kegiatan'], project: r['Project/Brand'] || '', pic: nama(r['PIC']), status: r['Status'],
        deadline: r['Deadline Kegiatan'] || '', estimasi: Number(r['Estimasi (Rp)']) || 0, actual: Number(r['Actual (Rp)']) || 0,
        transfer: Number(r['Nominal Transfer (Rp)']) || 0, nota: adaNota(r), dana: r['Dana'] || '', kategori: r['Kategori'] || '' };
    });
    return potong(list);
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
  var tindakan = [];
  if (uang) {
    var keys = pendingKeysFor_(kegiatan(), uid, peran, tim);
    var kegById = {};
    kegiatan().forEach(function (k) { kegById[String(k['ID'])] = k; });
    keys.forEach(function (key) {
      var p = key.split(':'), k = kegById[p[2]];
      if (!k) return;
      var label = { approve: 'perlu diputuskan (approve/tolak)', lengkapi: 'sudah ditransfer, tinggal isi Actual dan nota', nota: 'selesai tapi belum ada nota' }[p[1]];
      tindakan.push('Kegiatan "' + k['Item Kegiatan'] + '"' + (k['Project/Brand'] ? ' (' + k['Project/Brand'] + ')' : '') + ': ' + label);
    });
  }
  var stById = {};
  mkt_readTab_('strategi').forEach(function (s) { stById[String(s['ID'])] = s; });
  mkt_pengingatKeys_(uid, tim).forEach(function (key) {
    var p = key.split(':'), s = stById[p[2]];
    if (!s) return;
    tindakan.push('Strategi "' + s['Nama Strategi'] + '": ' + (p[1] === 'mkt-selesai' ? 'sudah lewat tanggal selesai (' + s['Selesai'] + ') tapi masih Jalan' : 'sudah selesai, hasil event-nya belum diisi'));
  });
  if (jenis === 'pengingat') return { tindakan: tindakan };
  var out = { peran: peran, tindakan: tindakan };
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

function botNative_(a) {
  var baris = function () { var r = botBarisKegiatan_(a.id); return r ? r : null; };
  var j = String(a.jenis || '');
  var perluBaris = { putuskan: 'update_status', tandai_transfer: 'mark_transferred', lengkapi: 'complete_kegiatan', ubah_kegiatan: 'edit_kegiatan', batalkan_kegiatan: 'cancel_kegiatan', pulihkan_kegiatan: 'restore_kegiatan' };
  if (perluBaris[j]) {
    var row = baris();
    if (!row) return { error: 'Kegiatan dengan ID "' + String(a.id || '') + '" tidak ditemukan.' };
    if (j === 'putuskan') return { action: 'update_status', row: row, status: a.status };
    if (j === 'tandai_transfer') return { action: 'mark_transferred', row: row, nominalTransfer: a.nominal, picTransaksi: a.pic_transaksi, tglTransfer: a.tanggal || '' };
    if (j === 'lengkapi') return { action: 'complete_kegiatan', row: row, actual: a.actual };
    if (j === 'batalkan_kegiatan') return { action: 'cancel_kegiatan', row: row, alasan: a.alasan || '' };
    if (j === 'pulihkan_kegiatan') return { action: 'restore_kegiatan', row: row };
    var ed = { action: 'edit_kegiatan', row: row };
    ['item', 'kategori', 'tipe', 'pic', 'estimasi', 'deadline', 'nota'].forEach(function (k) { if (a[k] !== undefined && a[k] !== null) ed[k] = a[k]; });
    if (a.nominal !== undefined && a.nominal !== null) ed.nominalTransfer = a.nominal;
    if (a.pic_transaksi !== undefined && a.pic_transaksi !== null) ed.picTransaksi = a.pic_transaksi;
    if (a.tanggal_transfer !== undefined && a.tanggal_transfer !== null) ed.tglTransfer = a.tanggal_transfer;
    if (a.actual !== undefined && a.actual !== null) ed.actual = a.actual;
    return ed;
  }
  if (j === 'ajukan_kegiatan') {
    var st = a.status || 'Diajukan';
    if (['Draft', 'Siap Ajukan', 'Diajukan'].indexOf(st) === -1) return { error: 'Status kegiatan baru harus Draft, Siap Ajukan, atau Diajukan.' };
    if (a.jalur && ['Fixed', 'Pengajuan'].indexOf(a.jalur) === -1) return { error: 'Jalur harus Fixed atau Pengajuan.' };
    var baru = { action: 'add_kegiatan', item: a.item, kategori: a.kategori, tipe: a.tipe, jalur: a.jalur || 'Pengajuan', pic: a.pic, estimasi: a.estimasi, deadline: a.deadline || '', status: st };
    if (a.dana) baru.dana = a.dana;
    return baru;
  }
  if (j === 'strategi_baru') return { action: 'add_strategi', nama: a.nama, pesan: a.pesan, lane: a.lane || [], channel: a.channel || [], mulai: a.mulai, selesai: a.selesai || '', pic: a.pic, status: a.status || 'Ide' };
  if (j === 'status_strategi') return { action: 'update_strategi_status', id: a.id, status: a.status };
  if (j === 'hasil_event_baru') return { action: 'add_hasil_event', nama: a.nama, tanggal: a.tanggal, channel: Array.isArray(a.channel) ? a.channel[0] : a.channel, komunitas: a.komunitas || '', kode: a.kode || '',
    hadir: a.hadir || 0, coba: a.coba || 0, tanya: a.tanya || 0, order: a.order || 0, ugc: a.ugc || 0, strategi: a.strategi || '', pic: a.pic, kegiatan: a.kegiatan || [] };
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

// Dipanggil setelah aksi berhasil. Kegagalan mencatat log tidak boleh menggagalkan aksinya.
function logAktivitas_(data, out) {
  try {
    if (data.action === 'get_data' || data.action === 'pending') return;
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
}
