/**
 * ZERODEO — Tracker Kegiatan & Budgeting (Apps Script, auto-generate)
 * ---------------------------------------------------------------------
 * Cara pasang di Google Sheet KOSONG (bebas nama filenya):
 * 1. Extensions -> Apps Script.
 * 2. Hapus isi Code.gs default, paste SELURUH isi file ini.
 * 3. Save (ikon disket), lalu RELOAD tab Google Sheets-nya (F5).
 * 4. Muncul menu baru "Zerodeo Tools" di sebelah menu Help.
 *    Klik Zerodeo Tools -> Setup / Reset Tracker.
 * 5. Google minta otorisasi pertama kali -> Allow / Izinkan.
 * 6. Tab "kegiatan", "plafon_fixed", "ringkasan" otomatis terbentuk
 *    lengkap dengan header, dropdown, formula, dan 1 baris contoh.
 * 7. Buat expose data ke dashboard nanti: Deploy -> New deployment
 *    -> Web app -> Execute as: Me -> Who has access: sesuai kebutuhan
 *    -> Deploy. Copy URL-nya.
 *
 * Menjalankan "Setup / Reset Tracker" lagi kapan saja akan MENGOSONGKAN
 * ULANG ketiga tab itu ke kondisi awal (formula & struktur, bukan data
 * yang sudah diisi tim) — hati-hati kalau sudah ada isian asli.
 *
 * PENTING: Code.gs sekarang bergantung pada Marketing.gs (isAuthorized_,
 * mkt_getData, mkt_handlePost). Di project Apps Script, paste KEDUANYA
 * sebagai file terpisah, lalu Deploy -> New version.
 */

var HEADER_ROW = 4;
// BUKAN batas jumlah kegiatan. Ini hanya sampai baris mana template di Sheet disiapkan
// (rumus No/Selisih, format, dropdown). Lewat dari itu, dashboard membuat baris dan
// rumusnya sendiri, jadi jumlah kegiatan tidak dibatasi.
var TEMPLATE_LAST_ROW = 500;
var CURR_FORMAT = '"Rp"#,##0;("Rp"#,##0);-';
var DATE_FORMAT = 'dd-mmm-yy';

// PIN buat approve/reject kegiatan — cuma Lemon yang tahu ini.
// PIN TIDAK ditulis di kode: disimpan di Script Properties dan diatur lewat
// menu Zerodeo Tools -> Ganti PIN Lemon. Kabari Lemon PIN-nya lewat chat pribadi.
var PIN_PROPERTY_KEY = 'APPROVAL_PIN';
var MIN_PIN_LENGTH = 4;

var KATEGORI_LIST = ['Peralatan/Kulak', 'Packaging Tambahan', 'Ongkos Kirim/Logistik',
                      'Konten & Aktivasi Akar', 'Operasional Tim', 'Lain-lain'];
var PIC_LIST = ['Lenno', 'Ricko', 'Yanuar', 'Christina'];
var STATUS_LIST = ['Draft', 'Siap Ajukan', 'Diajukan', 'Approved', 'Ditolak', 'Revisi', 'Ditransfer', 'Selesai'];
var TIPE_LIST = ['Capex', 'Opex'];

// Posisi kolom di tab kegiatan (nomor kolom, mulai dari 1). Kalau nambah/geser
// kolom, ubah di sini DAN huruf kolom di formula (buildKegiatanSheet, plafon,
// ringkasan) — urutannya harus sama dengan array headers.
var COL = {
  NO: 1, TGL_DICATAT: 2, DEADLINE: 3, PROJECT: 4, ITEM: 5, KATEGORI: 6, TIPE: 7,
  JALUR: 8, PIC: 9, ESTIMASI: 10, STATUS: 11, PIC_TRANSAKSI: 12,
  NOMINAL_TRANSFER: 13, TGL_TRANSFER: 14, ACTUAL: 15, SELISIH: 16, NOTA: 17, CATATAN: 18,
  DANA: 19
};

var NOTA_FOLDER_NAME = 'Zerodeo - Nota Bukti';

// ============================================================
// MENU
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Zerodeo Tools')
    .addItem('Setup / Reset Tracker', 'setupTracker')
    .addItem('Perluas Tabel', 'perluasTabel')
    .addItem('Ganti PIN Lemon', 'gantiPinLemon')
    .addToUi();
}

// Menyiapkan tab kegiatan sampai baris TEMPLATE_LAST_ROW dan memperbarui rumus tab lain
// supaya tidak terbatas. Data yang sudah ada TIDAK dihapus (beda dengan Setup / Reset).
function perluasTabel() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('kegiatan');
  if (!sheet) {
    ui.alert('Tab kegiatan tidak ditemukan. Jalankan Setup / Reset Tracker dulu.');
    return;
  }
  var res = ui.alert('Perluas Tabel',
    'Menyiapkan rumus, format, dan dropdown tab kegiatan sampai baris ' + TEMPLATE_LAST_ROW +
    ', serta memperbarui rumus tab ringkasan dan plafon_fixed. Data yang sudah ada TIDAK dihapus. Lanjut?',
    ui.ButtonSet.OK_CANCEL);
  if (res !== ui.Button.OK) return;
  extendTemplate_(ss, sheet);
  ui.alert('Selesai. Tab kegiatan siap sampai baris ' + TEMPLATE_LAST_ROW +
    '. Lewat dari itu pun tetap bisa: dashboard menambah baris dan rumusnya otomatis.');
}

function extendTemplate_(ss, sheet) {
  applyKegiatanTemplate_(sheet);
  recreateKegiatanFilter_(sheet);
  buildRingkasanSheet(ss); // isinya rumus semua, aman dibangun ulang

  // plafon_fixed: perbarui rumus "Terpakai" di tempat (kolom Plafon yang diisi manual tidak disentuh)
  var plafon = ss.getSheetByName('plafon_fixed');
  if (plafon) {
    KATEGORI_LIST.forEach(function (kat, i) {
      var r = HEADER_ROW + 1 + i;
      if (plafon.getRange(r, 1).getValue() === kat) {
        plafon.getRange(r, 3).setFormula(plafonUsedFormula_(r)).setNumberFormat(CURR_FORMAT);
      }
    });
  }
}

function getApprovalPin() {
  return PropertiesService.getScriptProperties().getProperty(PIN_PROPERTY_KEY);
}

// Menu ganti PIN. Kalau PIN sudah pernah diset, minta PIN lama dulu.
// Lupa PIN lama? Hapus properti APPROVAL_PIN di Apps Script:
// Project Settings -> Script Properties.
function gantiPinLemon() {
  var ui = SpreadsheetApp.getUi();
  var current = getApprovalPin();

  if (current) {
    var oldRes = ui.prompt('Ganti PIN Lemon', 'Masukkan PIN yang sekarang:', ui.ButtonSet.OK_CANCEL);
    if (oldRes.getSelectedButton() !== ui.Button.OK) return;
    if (oldRes.getResponseText().trim() !== current) {
      ui.alert('PIN lama salah. PIN tidak diubah.');
      return;
    }
  }

  var newRes = ui.prompt('Ganti PIN Lemon', 'PIN baru (minimal ' + MIN_PIN_LENGTH + ' karakter):', ui.ButtonSet.OK_CANCEL);
  if (newRes.getSelectedButton() !== ui.Button.OK) return;
  var newPin = newRes.getResponseText().trim();
  if (newPin.length < MIN_PIN_LENGTH) {
    ui.alert('PIN terlalu pendek (minimal ' + MIN_PIN_LENGTH + ' karakter). PIN tidak diubah.');
    return;
  }

  var confirmRes = ui.prompt('Ganti PIN Lemon', 'Ketik ulang PIN baru buat konfirmasi:', ui.ButtonSet.OK_CANCEL);
  if (confirmRes.getSelectedButton() !== ui.Button.OK) return;
  if (confirmRes.getResponseText().trim() !== newPin) {
    ui.alert('Konfirmasi tidak sama. PIN tidak diubah.');
    return;
  }

  PropertiesService.getScriptProperties().setProperty(PIN_PROPERTY_KEY, newPin);
  ui.alert('PIN Lemon sudah diganti. Kabari Lemon lewat chat pribadi.');
}

function setupTracker() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  buildKegiatanSheet(ss);
  buildPlafonSheet(ss);
  buildRingkasanSheet(ss);
  SpreadsheetApp.getUi().alert('Setup selesai — cek tab kegiatan, plafon_fixed, ringkasan.');
}

function getOrResetSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (sheet) {
    sheet.clear();
    sheet.clearFormats();
    sheet.getDataRange().clearDataValidations();
    var existingFilter = sheet.getFilter();
    if (existingFilter) existingFilter.remove();
  } else {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function styleHeaderRow(sheet, row, numCols) {
  sheet.getRange(row, 1, 1, numCols)
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F4E5F')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sheet.setRowHeight(row, 34);
}

// ============================================================
// KATEGORI — daftar yang bisa bertambah
// Disimpan di tab "kategori" (dibuat otomatis, isi awal = KATEGORI_LIST).
// Kategori baru dari form dashboard ditambahkan ke sini. Setup / Reset Tracker
// TIDAK menghapus tab ini, jadi kategori tambahan tidak hilang.
// ============================================================
var KATEGORI_TAB = 'kategori';

function ensureKategoriTab_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(KATEGORI_TAB);
  if (sheet) return sheet;
  sheet = ss.insertSheet(KATEGORI_TAB);
  sheet.getRange(1, 1).setValue('Kategori')
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F4E5F');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 260);
  sheet.getRange(2, 1, KATEGORI_LIST.length, 1).setValues(KATEGORI_LIST.map(function (k) { return [k]; }));
  return sheet;
}

function cleanKategori_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 60);
}

function getKategoriList() {
  var sheet = ensureKategoriTab_();
  var last = sheet.getLastRow();
  var out = [];
  if (last >= 2) {
    sheet.getRange(2, 1, last - 1, 1).getValues().forEach(function (row) {
      var k = cleanKategori_(row[0]);
      if (k) out.push(k);
    });
  }
  return out.length ? out : KATEGORI_LIST.slice();
}

// Samakan dengan daftar yang ada (abaikan huruf besar/kecil dan spasi berlebih).
// Kategori yang benar-benar baru ditambahkan ke tab "kategori" dan dropdown
// di tab kegiatan ikut diperbarui. Return nama kanonik ('' kalau kosong).
function resolveKategori_(raw) {
  var clean = cleanKategori_(raw);
  if (!clean) return '';
  var list = getKategoriList();
  for (var i = 0; i < list.length; i++) {
    if (list[i].toLowerCase() === clean.toLowerCase()) return list[i];
  }
  // Cegah teks yang diawali = + - @ dibaca Sheets sebagai formula.
  var safe = /^[=+\-@]/.test(clean) ? ' ' + clean : clean;
  ensureKategoriTab_().appendRow([safe]);
  list.push(clean);
  var kegiatan = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('kegiatan');
  if (kegiatan) setColumnDropdown_(kegiatan, COL.KATEGORI, list);
  return clean;
}

// ============================================================
// DANA — transfer bulk yang dipakai untuk banyak kebutuhan
// Tab "dana" (dibuat otomatis): satu baris per transfer bulk. Kebutuhan ditautkan
// lewat kolom "Dana" (S) di tab kegiatan. Saldo = Nominal - total Actual kebutuhan
// yang tertaut. Kebutuhan tertaut tidak punya Nominal Transfer sendiri (uangnya sudah
// ada di dana), jadi tidak terhitung dua kali. Jalurnya "Dana", dan statusnya langsung
// "Ditransfer" sehingga tinggal di-Lengkapi.
// Setup / Reset Tracker TIDAK menghapus tab "dana".
// ============================================================
var DANA_TAB = 'dana';
var DANA_HEADERS = ['Nama Dana', 'Nominal (Rp)', 'Tgl Transfer', 'PIC Transaksi', 'Catatan', 'Terpakai (Rp)', 'Saldo (Rp)', 'Dicatat Pada'];
var JALUR_DANA = 'Dana';

function colLetter_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Rentang satu kolom di tab kegiatan, tanpa batas bawah (K5:K), jadi rumus di tab lain
// otomatis ikut kalau baris bertambah.
function kegiatanRange_(col) {
  var L = colLetter_(col);
  return 'kegiatan!$' + L + '$' + (HEADER_ROW + 1) + ':$' + L;
}

// ============================================================
// BARIS KEGIATAN — tidak ada batas jumlah
// ============================================================

// Dropdown untuk seluruh kolom (dari baris data pertama sampai baris terakhir di sheet).
function setColumnDropdown_(sheet, col, list) {
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build();
  sheet.getRange(HEADER_ROW + 1, col, Math.max(sheet.getMaxRows() - HEADER_ROW, 1), 1).setDataValidation(rule);
}

function lastKegiatanRow_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('kegiatan');
  return sheet ? sheet.getLastRow() : 0;
}

// Baris kosong pertama di kolom Item Kegiatan; kalau semuanya terisi, baris setelah yang
// terakhir. Satu kali baca (bukan satu per baris), dan tanpa batas atas.
function nextKegiatanRow_(sheet) {
  var first = HEADER_ROW + 1;
  var last = sheet.getLastRow();
  if (last >= first) {
    var items = sheet.getRange(first, COL.ITEM, last - first + 1, 1).getValues();
    for (var i = 0; i < items.length; i++) {
      if (!items[i][0]) return first + i;
    }
  }
  return Math.max(last, first - 1) + 1;
}

// Pastikan baris ada di grid sheet dan punya rumus No (A) dan Selisih (P).
function prepareKegiatanRow_(sheet, row) {
  if (row > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), Math.max(row - sheet.getMaxRows(), 100));
  }
  var no = sheet.getRange(row, COL.NO);
  if (!no.getFormula() && no.getValue() === '') {
    no.setFormula('=IF(E' + row + '="","",ROW()-' + HEADER_ROW + ')');
  }
  var selisih = sheet.getRange(row, COL.SELISIH);
  if (!selisih.getFormula() && selisih.getValue() === '') {
    selisih.setFormula('=IF(O' + row + '="","",O' + row + '-J' + row + ')').setNumberFormat(CURR_FORMAT);
  }
}

// Isi rumus hanya di sel yang masih kosong (sel berisi, misal angka 1 di baris contoh,
// tidak disentuh). Satu panggilan per blok sel kosong yang berurutan.
function fillFormulasWhereMissing_(sheet, col, first, last, makeFormula) {
  var n = last - first + 1;
  var range = sheet.getRange(first, col, n, 1);
  var formulas = range.getFormulas();
  var values = range.getValues();
  var missing = function (i) { return formulas[i][0] === '' && (values[i][0] === '' || values[i][0] === null); };
  var i = 0;
  while (i < n) {
    if (!missing(i)) { i++; continue; }
    var block = [];
    var j = i;
    while (j < n && missing(j)) { block.push([makeFormula(first + j)]); j++; }
    sheet.getRange(first + i, col, block.length, 1).setFormulas(block);
    i = j;
  }
}

// Menyiapkan baris data pertama sampai TEMPLATE_LAST_ROW: rumus, format tanggal/Rp, dropdown.
// Aman dijalankan berulang dan tidak menghapus data.
function applyKegiatanTemplate_(sheet) {
  var first = HEADER_ROW + 1, last = TEMPLATE_LAST_ROW;
  if (sheet.getMaxRows() < last) sheet.insertRowsAfter(sheet.getMaxRows(), last - sheet.getMaxRows());
  fillFormulasWhereMissing_(sheet, COL.NO, first, last, function (r) {
    return '=IF(E' + r + '="","",ROW()-' + HEADER_ROW + ')';
  });
  fillFormulasWhereMissing_(sheet, COL.SELISIH, first, last, function (r) {
    return '=IF(O' + r + '="","",O' + r + '-J' + r + ')';
  });
  var n = last - first + 1;
  [[COL.TGL_DICATAT, DATE_FORMAT], [COL.DEADLINE, DATE_FORMAT], [COL.ESTIMASI, CURR_FORMAT],
   [COL.NOMINAL_TRANSFER, CURR_FORMAT], [COL.TGL_TRANSFER, DATE_FORMAT], [COL.ACTUAL, CURR_FORMAT],
   [COL.SELISIH, CURR_FORMAT]].forEach(function (f) {
    sheet.getRange(first, f[0], n, 1).setNumberFormat(f[1]);
  });
  setColumnDropdown_(sheet, COL.PROJECT, ['Zerodeo']);
  setColumnDropdown_(sheet, COL.KATEGORI, getKategoriList());
  setColumnDropdown_(sheet, COL.TIPE, TIPE_LIST);
  setColumnDropdown_(sheet, COL.JALUR, ['Fixed', 'Pengajuan', JALUR_DANA]);
  setColumnDropdown_(sheet, COL.PIC, PIC_LIST);
  setColumnDropdown_(sheet, COL.STATUS, STATUS_LIST);
  setColumnDropdown_(sheet, COL.PIC_TRANSAKSI, PIC_LIST);
  var danaNames = getDanaNames_();
  if (danaNames.length) setColumnDropdown_(sheet, COL.DANA, danaNames);
}

function recreateKegiatanFilter_(sheet) {
  var existing = sheet.getFilter();
  if (existing) existing.remove();
  sheet.getRange(HEADER_ROW, 1, TEMPLATE_LAST_ROW - HEADER_ROW + 1, COL.DANA).createFilter();
}

function cleanText_(s, max) {
  return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max || 200);
}

// Cegah teks yang diawali = + - @ dibaca Sheets sebagai formula.
function safeText_(s) {
  return /^[=+\-@]/.test(s) ? ' ' + s : s;
}

function ensureDanaTab_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DANA_TAB);
  if (sheet) return sheet;
  sheet = ss.insertSheet(DANA_TAB);
  sheet.getRange(1, 1, 1, DANA_HEADERS.length).setValues([DANA_HEADERS])
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F4E5F');
  sheet.setFrozenRows(1);
  [220, 130, 100, 110, 220, 130, 130, 110].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  return sheet;
}

// Header kolom "Dana" di tab kegiatan. Sheet yang dibuat sebelum fitur ini belum
// punya kolom itu, jadi ditambahkan di sini (hanya kalau selnya masih kosong).
function ensureDanaColumn_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('kegiatan');
  if (!sheet) return;
  var cell = sheet.getRange(HEADER_ROW, COL.DANA);
  if (String(cell.getValue() || '').trim() !== '') return;
  cell.setValue('Dana')
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F4E5F')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sheet.setColumnWidth(COL.DANA, 140);
}

function readDana_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DANA_TAB);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, DANA_HEADERS.length).getValues();
  var tz = Session.getScriptTimeZone();
  var out = [];
  rows.forEach(function (row, i) {
    var nama = cleanText_(row[0], 80);
    if (!nama) return;
    var o = { _row: i + 2 };
    DANA_HEADERS.forEach(function (h, c) {
      var v = row[c];
      if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      o[h] = (v === '' || v === null) ? null : v;
    });
    o['Nama Dana'] = nama;
    out.push(o);
  });
  return out;
}

function getDanaData_() {
  ensureDanaTab_();
  ensureDanaColumn_();
  return readDana_();
}

function getDanaNames_() {
  return readDana_().map(function (d) { return d['Nama Dana']; });
}

function findDana_(name) {
  var key = cleanText_(name, 80).toLowerCase();
  if (!key) return null;
  var list = readDana_();
  for (var i = 0; i < list.length; i++) {
    if (list[i]['Nama Dana'].toLowerCase() === key) return list[i];
  }
  return null;
}

function refreshDanaDropdown_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('kegiatan');
  var names = getDanaNames_();
  if (!sheet || !names.length) return;
  setColumnDropdown_(sheet, COL.DANA, names);
}

// Catat transfer bulk baru.
function handleAddDana(data) {
  var nama = cleanText_(data.nama, 80);
  if (!nama) return jsonResponse({ ok: false, error: 'Nama dana wajib diisi.' });
  var nominal = Number(data.nominal);
  if (!nominal || nominal <= 0) return jsonResponse({ ok: false, error: 'Nominal dana harus angka lebih dari 0.' });
  if (PIC_LIST.indexOf(data.picTransaksi) === -1) return jsonResponse({ ok: false, error: 'PIC Transaksi tidak dikenali.' });
  var tgl = new Date();
  if (data.tglTransfer) {
    tgl = new Date(data.tglTransfer);
    if (isNaN(tgl.getTime())) return jsonResponse({ ok: false, error: 'Tanggal transfer tidak valid.' });
  }
  var catatan = cleanText_(data.catatan, 200);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return jsonResponse({ ok: false, error: 'Server sedang sibuk, coba lagi sebentar.' });
  try {
    ensureDanaColumn_();
    var sheet = ensureDanaTab_();
    if (findDana_(nama)) {
      return jsonResponse({ ok: false, error: 'Sudah ada dana dengan nama itu. Pakai nama lain.' });
    }
    sheet.appendRow([safeText_(nama), nominal, tgl, data.picTransaksi, safeText_(catatan), '', '', new Date()]);
    var r = sheet.getLastRow();
    sheet.getRange(r, 2).setNumberFormat(CURR_FORMAT);
    sheet.getRange(r, 3).setNumberFormat(DATE_FORMAT);
    sheet.getRange(r, 6)
      .setFormula('=SUMIFS(' + kegiatanRange_(COL.ACTUAL) + ',' + kegiatanRange_(COL.DANA) + ',A' + r + ')')
      .setNumberFormat(CURR_FORMAT);
    sheet.getRange(r, 7).setFormula('=B' + r + '-F' + r).setNumberFormat(CURR_FORMAT);
    sheet.getRange(r, 8).setNumberFormat(DATE_FORMAT);
    refreshDanaDropdown_();
    return jsonResponse({ ok: true, row: r, nama: nama });
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// TAB 1 — kegiatan
// ============================================================
function buildKegiatanSheet(ss) {
  var sheet = getOrResetSheet(ss, 'kegiatan');
  sheet.getRange('A1').setValue('Zerodeo — Tracker Kegiatan & Budgeting')
    .setFontWeight('bold').setFontSize(14);
  sheet.getRange('A2').setValue(
    "Legend: sel kuning = isi manual. Status pakai dropdown. Jalur Fixed lompat langsung ke " +
    "'Ditransfer' (tidak perlu approve). Klik ikon filter di header buat lihat per Kategori/PIC/Status."
  ).setFontStyle('italic').setFontColor('#666666').setFontSize(9);

  // Urutan harus sama dengan COL di atas.
  var headers = ['No', 'Tanggal Dicatat', 'Deadline Kegiatan', 'Project/Brand', 'Item Kegiatan',
                  'Kategori', 'Tipe', 'Jalur', 'PIC', 'Estimasi (Rp)', 'Status', 'PIC Transaksi',
                  'Nominal Transfer (Rp)', 'Tgl Transfer', 'Actual (Rp)', 'Selisih (Rp)', 'Nota/Bukti', 'Catatan', 'Dana'];
  sheet.getRange(HEADER_ROW, 1, 1, headers.length).setValues([headers]);
  styleHeaderRow(sheet, HEADER_ROW, headers.length);

  var firstDataRow = HEADER_ROW + 1;
  var example = [1, new Date(2026, 8, 26), new Date(2026, 9, 5), 'Zerodeo',
                  'Contoh: sewa rak display sample Malang', 'Peralatan/Kulak', 'Opex', 'Pengajuan', 'Ricko',
                  1200000, 'Draft', '', '', '', '', '', '', ''];
  sheet.getRange(firstDataRow, 1, 1, example.length).setValues([example]);
  sheet.getRange(firstDataRow, 1, 1, example.length).setBackground('#FFFF00');

  // Rumus No/Selisih, format, dan dropdown untuk baris 5..TEMPLATE_LAST_ROW (satu kali, batch).
  applyKegiatanTemplate_(sheet);

  var widths = [40, 90, 90, 80, 260, 150, 70, 80, 70, 100, 90, 100, 110, 90, 100, 100, 120, 160, 140];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);

  sheet.setFrozenRows(HEADER_ROW);
  recreateKegiatanFilter_(sheet);
}

// ============================================================
// TAB 2 — plafon_fixed
// ============================================================
// Rumus "Terpakai" per kategori di plafon_fixed (jalur Fixed yang sudah Selesai), tanpa batas baris.
function plafonUsedFormula_(r) {
  return '=SUMIFS(' + kegiatanRange_(COL.ACTUAL) + ',' + kegiatanRange_(COL.KATEGORI) + ',A' + r + ',' +
    kegiatanRange_(COL.JALUR) + ',"Fixed",' + kegiatanRange_(COL.STATUS) + ',"Selesai")';
}

function buildPlafonSheet(ss) {
  var sheet = getOrResetSheet(ss, 'plafon_fixed');
  sheet.getRange('A1').setValue('Plafon Budget Fixed per Kategori').setFontWeight('bold').setFontSize(14);
  sheet.getRange('A2').setValue('Diisi Lemon/Budianto. Kosongkan dulu kalau belum disepakati.')
    .setFontStyle('italic').setFontColor('#666666').setFontSize(9);

  var headers = ['Kategori', 'Plafon per Bulan (Rp)', 'Terpakai (Rp)', 'Sisa (Rp)'];
  sheet.getRange(4, 1, 1, headers.length).setValues([headers]);
  styleHeaderRow(sheet, 4, headers.length);

  var firstDataRow = HEADER_ROW + 1;

  var r = firstDataRow;
  KATEGORI_LIST.forEach(function (kat) {
    sheet.getRange(r, 1).setValue(kat);
    sheet.getRange(r, 2).setBackground('#FFFF00').setNumberFormat(CURR_FORMAT);
    sheet.getRange(r, 3)
      .setFormula(plafonUsedFormula_(r))
      .setNumberFormat(CURR_FORMAT);
    sheet.getRange(r, 4).setFormula('=IF(B' + r + '="","",B' + r + '-C' + r + ')').setNumberFormat(CURR_FORMAT);
    r++;
  });

  sheet.getRange(r, 1).setValue('TOTAL').setFontWeight('bold');
  sheet.getRange(r, 2).setFormula('=SUM(B' + firstDataRow + ':B' + (r - 1) + ')').setNumberFormat(CURR_FORMAT).setFontWeight('bold');
  sheet.getRange(r, 3).setFormula('=SUM(C' + firstDataRow + ':C' + (r - 1) + ')').setNumberFormat(CURR_FORMAT).setFontWeight('bold');
  sheet.getRange(r, 4).setFormula('=SUM(D' + firstDataRow + ':D' + (r - 1) + ')').setNumberFormat(CURR_FORMAT).setFontWeight('bold');

  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidths(2, 3, 150);
  sheet.setFrozenRows(4);
}

// ============================================================
// TAB 3 — ringkasan
// ============================================================
function buildRingkasanSheet(ss) {
  var sheet = getOrResetSheet(ss, 'ringkasan');
  sheet.getRange('A1').setValue('Ringkasan — untuk Lemon').setFontWeight('bold').setFontSize(14);
  sheet.getRange('A2').setValue('Semua angka formula, tarik otomatis dari tab kegiatan.')
    .setFontStyle('italic').setFontColor('#666666').setFontSize(9);

  var statusRange = kegiatanRange_(COL.STATUS);
  var jalurRange = kegiatanRange_(COL.JALUR);
  var katRange = kegiatanRange_(COL.KATEGORI);
  var actualRange = kegiatanRange_(COL.ACTUAL);
  var estRange = kegiatanRange_(COL.ESTIMASI);
  var transferRange = kegiatanRange_(COL.NOMINAL_TRANSFER);
  var deadlineRange = kegiatanRange_(COL.DEADLINE);

  var r = 4;
  sheet.getRange(r, 1).setValue('Status pengajuan (jalur Pengajuan saja)').setFontWeight('bold');
  r++;
  STATUS_LIST.forEach(function (s) {
    sheet.getRange(r, 1).setValue(s);
    sheet.getRange(r, 2).setFormula('=COUNTIFS(' + jalurRange + ',"Pengajuan",' + statusRange + ',A' + r + ')');
    r++;
  });

  r++;
  sheet.getRange(r, 1).setValue('Sudah cair, belum ada nota (ditransfer − actual)').setFontWeight('bold');
  r++;
  sheet.getRange(r, 1, 1, 3).setValues([['Total Diterima (Rp)', 'Total Actual (Rp)', 'Belum Ada Nota (Rp)']]);
  styleHeaderRow(sheet, r, 3);
  r++;
  // Actual dihitung hanya dari baris yang Nominal Transfer-nya terisi.
  sheet.getRange(r, 1).setFormula('=SUMIF(' + transferRange + ',"<>",' + transferRange + ')').setNumberFormat(CURR_FORMAT);
  sheet.getRange(r, 2).setFormula('=SUMIF(' + transferRange + ',"<>",' + actualRange + ')').setNumberFormat(CURR_FORMAT);
  sheet.getRange(r, 3).setFormula('=A' + r + '-B' + r).setNumberFormat(CURR_FORMAT);
  r++;

  r++;
  sheet.getRange(r, 1).setValue('Scorecard per modul (kegiatan belum Selesai)').setFontWeight('bold');
  r++;
  sheet.getRange(r, 1, 1, 5).setValues([['Modul', 'Kategori terkait', 'Jml Kegiatan Aktif', 'Total Estimasi (Rp)', 'Deadline Terdekat']]);
  styleHeaderRow(sheet, r, 5);
  r++;

  var modules = [
    ['Marketing', ['Konten & Aktivasi Akar']],
    ['Ops', ['Peralatan/Kulak', 'Packaging Tambahan', 'Ongkos Kirim/Logistik']]
  ];
  modules.forEach(function (mod) {
    var name = mod[0], kats = mod[1];
    var countParts = kats.map(function (k) {
      return 'COUNTIFS(' + katRange + ',"' + k + '",' + statusRange + ',"<>Selesai",' + statusRange + ',"<>")';
    }).join(' + ');
    var sumParts = kats.map(function (k) {
      return 'SUMIFS(' + estRange + ',' + katRange + ',"' + k + '",' + statusRange + ',"<>Selesai",' + statusRange + ',"<>")';
    }).join(' + ');
    var minParts = kats.map(function (k) {
      return 'IF(COUNTIFS(' + katRange + ',"' + k + '",' + statusRange + ',"<>Selesai",' + statusRange + ',"<>")=0,99999,' +
             'MINIFS(' + deadlineRange + ',' + katRange + ',"' + k + '",' + statusRange + ',"<>Selesai",' + statusRange + ',"<>"))';
    }).join(',');
    sheet.getRange(r, 1).setValue(name);
    sheet.getRange(r, 2).setValue(kats.join(', '));
    sheet.getRange(r, 3).setFormula('=' + countParts);
    sheet.getRange(r, 4).setFormula('=' + sumParts).setNumberFormat(CURR_FORMAT);
    sheet.getRange(r, 5).setFormula('=IF(MIN(' + minParts + ')=99999,"-",MIN(' + minParts + '))').setNumberFormat(DATE_FORMAT);
    r++;
  });

  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidths(2, 3, 180);
}

// ============================================================
// API — expose data as JSON (dipakai dashboard nanti)
// ============================================================
function doGet(e) {
  // isAuthorized_ ada di Marketing.gs (file terpisah di project Apps Script ini).
  if (!isAuthorized_(e && e.parameter && e.parameter.secret)) {
    return jsonResponse({ ok: false, error: 'unauthorized' });
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var payload = {
    generated_at: new Date().toISOString(),
    kegiatan: sheetToObjects(ss.getSheetByName('kegiatan')),
    plafon_fixed: sheetToObjects(ss.getSheetByName('plafon_fixed')),
  };
  // Fitur tambahan dibungkus supaya kalau salah satunya error, tracker utama tetap
  // jalan. Dashboard menganggap fitur itu belum tersedia kalau kuncinya tidak ada.
  try { payload.kategori = getKategoriList(); } catch (err) { payload.kategori_error = String(err.message); }
  try { payload.dana = getDanaData_(); } catch (err) { payload.dana_error = String(err.message); }
  var m = mkt_getData();
  payload.strategi = m.strategi;
  payload.lane = m.lane;
  payload.channel = m.channel;
  payload.hasil_event = m.hasil_event;
  return jsonResponse(payload);
}

// ============================================================
// API — terima kegiatan baru dari form input (halaman terpisah)
// Dikirim sebagai POST, body JSON, Content-Type text/plain (biar
// lolos tanpa CORS preflight yang tidak didukung Apps Script).
// ============================================================
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (!isAuthorized_(data.secret)) {
      return jsonResponse({ ok: false, error: 'unauthorized' });
    }
    // Aksi modul marketing (Marketing.gs). Return null = bukan aksi marketing.
    var mres = mkt_handlePost(data);
    if (mres) return jsonResponse(mres);

    if (data.action === 'update_status') {
      return handleUpdateStatus(data);
    }
    if (data.action === 'complete_kegiatan') {
      return handleCompleteKegiatan(data);
    }
    if (data.action === 'mark_transferred') {
      return handleMarkTransferred(data);
    }
    if (data.action === 'add_dana') {
      return handleAddDana(data);
    }
    if (data.action === 'link_dana') {
      return handleLinkDana(data);
    }
    return handleAddKegiatan(data);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// Tambah kegiatan baru. Kalau data.arsip === true, ini data lama: kegiatan yang
// sudah selesai sebelum dashboard dipakai. Dicatat langsung berstatus Selesai
// lengkap dengan Actual (+ transfer dan link nota kalau diisi).
function handleAddKegiatan(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('kegiatan');
  if (!sheet) return jsonResponse({ ok: false, error: 'Tab kegiatan tidak ditemukan.' });

  var arsip = data.arsip === true;
  var actual = 0, nominal = 0, picTrans = '', tglTf = null, nota = '';
  if (arsip) {
    actual = Number(data.actual);
    if (!actual || actual <= 0) {
      return jsonResponse({ ok: false, error: 'Data lama: Actual harus angka lebih dari 0.' });
    }
    nominal = Number(data.nominalTransfer) || actual;
    picTrans = data.picTransaksi || data.pic || '';
    if (picTrans && PIC_LIST.indexOf(picTrans) === -1) {
      return jsonResponse({ ok: false, error: 'PIC Transaksi tidak dikenali.' });
    }
    if (data.tglTransfer) {
      tglTf = new Date(data.tglTransfer);
      if (isNaN(tglTf.getTime())) return jsonResponse({ ok: false, error: 'Tanggal transfer tidak valid.' });
    }
    nota = String(data.nota || '').trim();
    if (nota && !/^https?:\/\/\S+$/i.test(nota)) {
      return jsonResponse({ ok: false, error: 'Link nota harus diawali http:// atau https://' });
    }
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return jsonResponse({ ok: false, error: 'Server sedang sibuk, coba lagi sebentar.' });
  try {
    // Dibayar dari dana bulk: uangnya sudah ada di dana, jadi tidak ada approve/transfer
    // sendiri. Jalur "Dana", status langsung "Ditransfer" (tinggal Lengkapi), dan
    // Nominal Transfer dikosongkan supaya tidak terhitung dua kali.
    // (Divalidasi sebelum baris disiapkan, supaya penolakan tidak meninggalkan sisa di Sheet.)
    var danaName = '';
    if (data.dana) {
      ensureDanaColumn_();
      var dn = findDana_(data.dana);
      if (!dn) return jsonResponse({ ok: false, error: 'Dana tidak ditemukan: ' + cleanText_(data.dana, 80) });
      danaName = dn['Nama Dana'];
    }

    // Tidak ada batas jumlah kegiatan: kalau semua baris template terisi, baris baru
    // (beserta rumusnya) dibuat otomatis.
    var targetRow = nextKegiatanRow_(sheet);
    prepareKegiatanRow_(sheet, targetRow);

    // Data lama: kalau tanggalnya diisi, itu dipakai sebagai Tanggal Dicatat.
    sheet.getRange(targetRow, COL.TGL_DICATAT).setValue(arsip && tglTf ? tglTf : new Date()).setNumberFormat(DATE_FORMAT);
    if (data.deadline) {
      sheet.getRange(targetRow, COL.DEADLINE).setValue(new Date(data.deadline)).setNumberFormat(DATE_FORMAT);
    }
    sheet.getRange(targetRow, COL.PROJECT).setValue('Zerodeo');
    sheet.getRange(targetRow, COL.ITEM).setValue(data.item || '');
    sheet.getRange(targetRow, COL.KATEGORI).setValue(resolveKategori_(data.kategori));
    sheet.getRange(targetRow, COL.TIPE).setValue(data.tipe || '');
    sheet.getRange(targetRow, COL.JALUR).setValue(danaName ? JALUR_DANA : (data.jalur || ''));
    sheet.getRange(targetRow, COL.PIC).setValue(data.pic || '');
    sheet.getRange(targetRow, COL.ESTIMASI).setValue(Number(data.estimasi) || actual || 0).setNumberFormat(CURR_FORMAT);
    sheet.getRange(targetRow, COL.STATUS).setValue(arsip ? 'Selesai' : (danaName ? 'Ditransfer' : (data.status || 'Draft')));
    if (danaName) sheet.getRange(targetRow, COL.DANA).setValue(danaName);

    if (arsip) {
      if (picTrans) sheet.getRange(targetRow, COL.PIC_TRANSAKSI).setValue(picTrans);
      if (!danaName) sheet.getRange(targetRow, COL.NOMINAL_TRANSFER).setValue(nominal).setNumberFormat(CURR_FORMAT);
      if (tglTf) sheet.getRange(targetRow, COL.TGL_TRANSFER).setValue(tglTf).setNumberFormat(DATE_FORMAT);
      sheet.getRange(targetRow, COL.ACTUAL).setValue(actual).setNumberFormat(CURR_FORMAT);
      if (nota) sheet.getRange(targetRow, COL.NOTA).setValue(nota);
      var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yy');
      sheet.getRange(targetRow, COL.CATATAN).setValue('Data lama, dicatat dari dashboard ' + stamp);
    }

    return jsonResponse({ ok: true, row: targetRow });
  } finally {
    lock.releaseLock();
  }
}

// Approve / Reject — hanya jalan kalau PIN cocok. Row diambil dari
// field "_row" yang doGet sisipkan ke tiap objek kegiatan, jadi
// dashboard tinggal kirim balik nomor itu tanpa perlu cari lagi.
function handleUpdateStatus(data) {
  var approvalPin = getApprovalPin();
  if (!approvalPin) {
    return jsonResponse({ ok: false, error: 'PIN belum diset. Atur dulu lewat menu Zerodeo Tools -> Ganti PIN Lemon di Google Sheet.' });
  }
  if (data.pin !== approvalPin) {
    return jsonResponse({ ok: false, error: 'PIN salah. Cuma yang punya PIN dari Lemon yang bisa approve/reject.' });
  }
  var row = Number(data.row);
  if (!row || row < HEADER_ROW + 1 || row > lastKegiatanRow_()) {
    return jsonResponse({ ok: false, error: 'Baris tidak valid.' });
  }
  var allowedStatus = ['Approved', 'Ditolak', 'Revisi'];
  if (allowedStatus.indexOf(data.status) === -1) {
    return jsonResponse({ ok: false, error: 'Status tidak dikenali: ' + data.status });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('kegiatan');
  var currentStatus = sheet.getRange(row, COL.STATUS).getValue();
  if (currentStatus !== 'Diajukan') {
    return jsonResponse({ ok: false, error: 'Baris ini statusnya sudah "' + currentStatus + '", bukan "Diajukan" lagi — mungkin sudah diproses orang lain.' });
  }

  sheet.getRange(row, COL.STATUS).setValue(data.status);
  var noteCell = sheet.getRange(row, COL.CATATAN);
  var existingNote = noteCell.getValue();
  var stamp = data.status + ' oleh Lemon, ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yy HH:mm');
  noteCell.setValue(existingNote ? (existingNote + ' | ' + stamp) : stamp);

  return jsonResponse({ ok: true, row: row, status: data.status });
}

// Lengkapi kegiatan yang sudah Ditransfer: isi Actual + foto nota, status -> Selesai.
// Tidak pakai PIN (ini kelanjutan kerja tim, bukan keputusan Lemon).
// Foto opsional; kalau ada, disimpan ke folder Drive NOTA_FOLDER_NAME.
function handleCompleteKegiatan(data) {
  var row = Number(data.row);
  if (!row || row < HEADER_ROW + 1 || row > lastKegiatanRow_()) {
    return jsonResponse({ ok: false, error: 'Baris tidak valid.' });
  }
  var actual = Number(data.actual);
  if (!actual || actual <= 0) {
    return jsonResponse({ ok: false, error: 'Actual harus angka lebih dari 0.' });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('kegiatan');
  var currentStatus = sheet.getRange(row, COL.STATUS).getValue();
  if (currentStatus !== 'Ditransfer') {
    return jsonResponse({ ok: false, error: 'Baris ini statusnya "' + currentStatus + '", bukan "Ditransfer" — mungkin sudah dilengkapi orang lain atau belum waktunya.' });
  }

  var fileUrl = '';
  if (data.photoBase64) {
    var folders = DriveApp.getFoldersByName(NOTA_FOLDER_NAME);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(NOTA_FOLDER_NAME);
    var mime = data.photoMime || 'image/jpeg';
    var itemName = String(sheet.getRange(row, COL.ITEM).getValue() || 'kegiatan').replace(/[\\\/:*?"<>|]/g, '-');
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
    var blob = Utilities.newBlob(Utilities.base64Decode(data.photoBase64), mime, 'Nota - ' + itemName + ' - ' + stamp + '.jpg');
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    fileUrl = file.getUrl();
  }

  sheet.getRange(row, COL.ACTUAL).setValue(actual).setNumberFormat(CURR_FORMAT);
  if (fileUrl) sheet.getRange(row, COL.NOTA).setValue(fileUrl);
  sheet.getRange(row, COL.STATUS).setValue('Selesai');

  return jsonResponse({ ok: true, row: row });
}

// Tandai Ditransfer: isi PIC Transaksi + Nominal Transfer + Tgl Transfer,
// status -> "Ditransfer". Tidak pakai PIN (eksekusi transfer, bukan keputusan
// approve Lemon). Boleh dipakai kalau:
// - Status sekarang "Approved" (jalur Pengajuan yang sudah di-acc Lemon), atau
// - Jalur "Fixed" dan belum "Ditransfer"/"Selesai" (lompat tanpa approve,
//   sesuai catatan di tab kegiatan).
function handleMarkTransferred(data) {
  var row = Number(data.row);
  if (!row || row < HEADER_ROW + 1 || row > lastKegiatanRow_()) {
    return jsonResponse({ ok: false, error: 'Baris tidak valid.' });
  }
  var nominal = Number(data.nominalTransfer);
  if (!nominal || nominal <= 0) {
    return jsonResponse({ ok: false, error: 'Nominal transfer harus angka lebih dari 0.' });
  }
  if (PIC_LIST.indexOf(data.picTransaksi) === -1) {
    return jsonResponse({ ok: false, error: 'PIC Transaksi tidak dikenali.' });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('kegiatan');
  var currentStatus = sheet.getRange(row, COL.STATUS).getValue();
  var jalur = sheet.getRange(row, COL.JALUR).getValue();

  // Penjaga anti-dobel: uang baris yang dibayar dari dana sudah dihitung di dana itu.
  var linkedDana = String(sheet.getRange(row, COL.DANA).getValue() || '').trim();
  if (linkedDana) {
    return jsonResponse({ ok: false, error: 'Baris ini dibayar dari dana "' + linkedDana + '", jadi tidak perlu ditandai ditransfer sendiri (nanti uangnya terhitung dua kali). Tinggal Lengkapi dengan Actual.' });
  }

  var isFixedEligible = jalur === 'Fixed' && currentStatus !== 'Ditransfer' && currentStatus !== 'Selesai';
  var isApprovedEligible = currentStatus === 'Approved';
  if (!isFixedEligible && !isApprovedEligible) {
    return jsonResponse({ ok: false, error: 'Baris ini statusnya "' + currentStatus + '" (Jalur ' + jalur + ') — belum bisa ditandai Ditransfer.' });
  }

  var tglTransfer = data.tglTransfer ? new Date(data.tglTransfer) : new Date();

  sheet.getRange(row, COL.PIC_TRANSAKSI).setValue(data.picTransaksi);
  sheet.getRange(row, COL.NOMINAL_TRANSFER).setValue(nominal).setNumberFormat(CURR_FORMAT);
  sheet.getRange(row, COL.TGL_TRANSFER).setValue(tglTransfer).setNumberFormat(DATE_FORMAT);
  sheet.getRange(row, COL.STATUS).setValue('Ditransfer');

  return jsonResponse({ ok: true, row: row });
}

// Bayar dari dana: tautkan kegiatan yang SUDAH ada (pengajuan yang di-approve, atau jalur
// Fixed) ke sebuah dana bulk. Uangnya sudah ada di dana, jadi baris tidak punya Nominal
// Transfer sendiri; status langsung "Ditransfer" (tinggal Lengkapi). Syaratnya sama dengan
// Tandai Ditransfer, ditambah: belum tertaut ke dana, dan bukan yang ditolak.
function handleLinkDana(data) {
  var row = Number(data.row);
  if (!row || row < HEADER_ROW + 1 || row > lastKegiatanRow_()) {
    return jsonResponse({ ok: false, error: 'Baris tidak valid.' });
  }
  if (!cleanText_(data.dana, 80)) return jsonResponse({ ok: false, error: 'Pilih dananya dulu.' });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return jsonResponse({ ok: false, error: 'Server sedang sibuk, coba lagi sebentar.' });
  try {
    ensureDanaColumn_();
    var dn = findDana_(data.dana);
    if (!dn) return jsonResponse({ ok: false, error: 'Dana tidak ditemukan: ' + cleanText_(data.dana, 80) });

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('kegiatan');
    if (!sheet.getRange(row, COL.ITEM).getValue()) {
      return jsonResponse({ ok: false, error: 'Baris itu kosong.' });
    }
    var already = String(sheet.getRange(row, COL.DANA).getValue() || '').trim();
    if (already) {
      return jsonResponse({ ok: false, error: 'Baris ini sudah tertaut ke dana "' + already + '".' });
    }
    var status = sheet.getRange(row, COL.STATUS).getValue();
    var jalur = sheet.getRange(row, COL.JALUR).getValue();
    var fixedOk = jalur === 'Fixed' && ['Ditransfer', 'Selesai', 'Ditolak'].indexOf(status) === -1;
    if (status !== 'Approved' && !fixedOk) {
      return jsonResponse({ ok: false, error: 'Baris ini statusnya "' + status + '" (Jalur ' + jalur + ') — baru bisa dibayar dari dana setelah Approved (atau jalur Fixed yang belum Ditransfer).' });
    }

    var nama = dn['Nama Dana'];
    sheet.getRange(row, COL.DANA).setValue(nama);
    sheet.getRange(row, COL.STATUS).setValue('Ditransfer');
    var noteCell = sheet.getRange(row, COL.CATATAN);
    var existing = noteCell.getValue();
    var stamp = 'Dibayar dari dana "' + nama + '" (' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yy') + ')';
    noteCell.setValue(existing ? (existing + ' | ' + stamp) : stamp);
    return jsonResponse({ ok: true, row: row, dana: nama });
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheetToObjects(sheet) {
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= HEADER_ROW) return [];

  var headers = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
  var numRows = lastRow - HEADER_ROW;
  var rows = sheet.getRange(HEADER_ROW + 1, 1, numRows, lastCol).getValues();
  var tz = Session.getScriptTimeZone();

  var result = [];
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var obj = {};
    var hasData = false;
    for (var c = 0; c < headers.length; c++) {
      var key = String(headers[c] || '').trim();
      if (!key) continue;
      var val = row[c];
      if (val instanceof Date) val = Utilities.formatDate(val, tz, 'yyyy-MM-dd');
      if (val === '' || val === null) {
        val = null;
      } else {
        hasData = true;
      }
      obj[key] = val;
    }
    if (hasData) {
      obj['_row'] = HEADER_ROW + 1 + r; // nomor baris asli di Sheet, dipakai buat approve/reject
      result.push(obj);
    }
  }
  return result;
}
