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
 */

var HEADER_ROW = 4;
var LAST_DATA_ROW = 60;
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
  NOMINAL_TRANSFER: 13, TGL_TRANSFER: 14, ACTUAL: 15, SELISIH: 16, NOTA: 17, CATATAN: 18
};

var NOTA_FOLDER_NAME = 'Zerodeo - Nota Bukti';

// ============================================================
// MENU
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Zerodeo Tools')
    .addItem('Setup / Reset Tracker', 'setupTracker')
    .addItem('Ganti PIN Lemon', 'gantiPinLemon')
    .addToUi();
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

function setDropdown(sheet, a1, list) {
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build();
  sheet.getRange(a1).setDataValidation(rule);
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
                  'Nominal Transfer (Rp)', 'Tgl Transfer', 'Actual (Rp)', 'Selisih (Rp)', 'Nota/Bukti', 'Catatan'];
  sheet.getRange(HEADER_ROW, 1, 1, headers.length).setValues([headers]);
  styleHeaderRow(sheet, HEADER_ROW, headers.length);

  var firstDataRow = HEADER_ROW + 1;
  var example = [1, new Date(2026, 8, 26), new Date(2026, 9, 5), 'Zerodeo',
                  'Contoh: sewa rak display sample Malang', 'Peralatan/Kulak', 'Opex', 'Pengajuan', 'Ricko',
                  1200000, 'Draft', '', '', '', '', '', '', ''];
  sheet.getRange(firstDataRow, 1, 1, example.length).setValues([example]);
  sheet.getRange(firstDataRow, 1, 1, example.length).setBackground('#FFFF00');
  // Selisih (P) = Actual (O) - Estimasi (J)
  sheet.getRange(firstDataRow, COL.SELISIH).setFormula('=IF(O' + firstDataRow + '="","",O' + firstDataRow + '-J' + firstDataRow + ')');

  for (var row = firstDataRow + 1; row <= LAST_DATA_ROW; row++) {
    sheet.getRange(row, COL.NO).setFormula('=IF(E' + row + '="","",ROW()-' + HEADER_ROW + ')');
    sheet.getRange(row, COL.SELISIH).setFormula('=IF(O' + row + '="","",O' + row + '-J' + row + ')');
  }

  var numDataRows = LAST_DATA_ROW - firstDataRow + 1;
  sheet.getRange(firstDataRow, COL.TGL_DICATAT, numDataRows, 1).setNumberFormat(DATE_FORMAT);
  sheet.getRange(firstDataRow, COL.DEADLINE, numDataRows, 1).setNumberFormat(DATE_FORMAT);
  sheet.getRange(firstDataRow, COL.ESTIMASI, numDataRows, 1).setNumberFormat(CURR_FORMAT);
  sheet.getRange(firstDataRow, COL.NOMINAL_TRANSFER, numDataRows, 1).setNumberFormat(CURR_FORMAT);
  sheet.getRange(firstDataRow, COL.TGL_TRANSFER, numDataRows, 1).setNumberFormat(DATE_FORMAT);
  sheet.getRange(firstDataRow, COL.ACTUAL, numDataRows, 1).setNumberFormat(CURR_FORMAT);
  sheet.getRange(firstDataRow, COL.SELISIH, numDataRows, 1).setNumberFormat(CURR_FORMAT);

  setDropdown(sheet, 'D' + firstDataRow + ':D' + LAST_DATA_ROW, ['Zerodeo']);
  setDropdown(sheet, 'F' + firstDataRow + ':F' + LAST_DATA_ROW, KATEGORI_LIST);
  setDropdown(sheet, 'G' + firstDataRow + ':G' + LAST_DATA_ROW, TIPE_LIST);
  setDropdown(sheet, 'H' + firstDataRow + ':H' + LAST_DATA_ROW, ['Fixed', 'Pengajuan']);
  setDropdown(sheet, 'I' + firstDataRow + ':I' + LAST_DATA_ROW, PIC_LIST);
  setDropdown(sheet, 'K' + firstDataRow + ':K' + LAST_DATA_ROW, STATUS_LIST);
  setDropdown(sheet, 'L' + firstDataRow + ':L' + LAST_DATA_ROW, PIC_LIST);

  var widths = [40, 90, 90, 80, 260, 150, 70, 80, 70, 100, 90, 100, 110, 90, 100, 100, 120, 160];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);

  sheet.setFrozenRows(HEADER_ROW);
  sheet.getRange(HEADER_ROW, 1, LAST_DATA_ROW - HEADER_ROW + 1, headers.length).createFilter();
}

// ============================================================
// TAB 2 — plafon_fixed
// ============================================================
function buildPlafonSheet(ss) {
  var sheet = getOrResetSheet(ss, 'plafon_fixed');
  sheet.getRange('A1').setValue('Plafon Budget Fixed per Kategori').setFontWeight('bold').setFontSize(14);
  sheet.getRange('A2').setValue('Diisi Lemon/Budianto. Kosongkan dulu kalau belum disepakati.')
    .setFontStyle('italic').setFontColor('#666666').setFontSize(9);

  var headers = ['Kategori', 'Plafon per Bulan (Rp)', 'Terpakai (Rp)', 'Sisa (Rp)'];
  sheet.getRange(4, 1, 1, headers.length).setValues([headers]);
  styleHeaderRow(sheet, 4, headers.length);

  var firstDataRow = HEADER_ROW + 1;
  var kegJalur = "kegiatan!$H$" + firstDataRow + ":$H$" + LAST_DATA_ROW;
  var kegKat = "kegiatan!$F$" + firstDataRow + ":$F$" + LAST_DATA_ROW;
  var kegStatus = "kegiatan!$K$" + firstDataRow + ":$K$" + LAST_DATA_ROW;
  var kegActual = "kegiatan!$O$" + firstDataRow + ":$O$" + LAST_DATA_ROW;

  var r = firstDataRow;
  KATEGORI_LIST.forEach(function (kat) {
    sheet.getRange(r, 1).setValue(kat);
    sheet.getRange(r, 2).setBackground('#FFFF00').setNumberFormat(CURR_FORMAT);
    sheet.getRange(r, 3)
      .setFormula('=SUMIFS(' + kegActual + ',' + kegKat + ',A' + r + ',' + kegJalur + ',"Fixed",' + kegStatus + ',"Selesai")')
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

  var firstDataRow = HEADER_ROW + 1;
  var statusRange = "kegiatan!$K$" + firstDataRow + ":$K$" + LAST_DATA_ROW;
  var jalurRange = "kegiatan!$H$" + firstDataRow + ":$H$" + LAST_DATA_ROW;
  var katRange = "kegiatan!$F$" + firstDataRow + ":$F$" + LAST_DATA_ROW;
  var actualRange = "kegiatan!$O$" + firstDataRow + ":$O$" + LAST_DATA_ROW;
  var estRange = "kegiatan!$J$" + firstDataRow + ":$J$" + LAST_DATA_ROW;
  var transferRange = "kegiatan!$M$" + firstDataRow + ":$M$" + LAST_DATA_ROW;
  var deadlineRange = "kegiatan!$C$" + firstDataRow + ":$C$" + LAST_DATA_ROW;

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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var payload = {
    generated_at: new Date().toISOString(),
    kegiatan: sheetToObjects(ss.getSheetByName('kegiatan')),
    plafon_fixed: sheetToObjects(ss.getSheetByName('plafon_fixed')),
  };
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

    if (data.action === 'update_status') {
      return handleUpdateStatus(data);
    }
    if (data.action === 'complete_kegiatan') {
      return handleCompleteKegiatan(data);
    }
    if (data.action === 'mark_transferred') {
      return handleMarkTransferred(data);
    }
    return handleAddKegiatan(data);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function handleAddKegiatan(data) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('kegiatan');
    if (!sheet) return jsonResponse({ ok: false, error: 'Tab kegiatan tidak ditemukan.' });

    var firstDataRow = HEADER_ROW + 1;
    var targetRow = null;
    for (var r = firstDataRow; r <= LAST_DATA_ROW; r++) {
      var itemVal = sheet.getRange(r, COL.ITEM).getValue(); // Item Kegiatan
      if (!itemVal) { targetRow = r; break; }
    }
    if (!targetRow) {
      return jsonResponse({ ok: false, error: 'Tabel kegiatan sudah penuh (60 baris). Tambah baris manual dulu di Sheet, atau minta perluas template.' });
    }

    sheet.getRange(targetRow, COL.TGL_DICATAT).setValue(new Date()).setNumberFormat(DATE_FORMAT);
    if (data.deadline) {
      sheet.getRange(targetRow, COL.DEADLINE).setValue(new Date(data.deadline)).setNumberFormat(DATE_FORMAT);
    }
    sheet.getRange(targetRow, COL.PROJECT).setValue('Zerodeo');
    sheet.getRange(targetRow, COL.ITEM).setValue(data.item || '');
    sheet.getRange(targetRow, COL.KATEGORI).setValue(data.kategori || '');
    sheet.getRange(targetRow, COL.TIPE).setValue(data.tipe || '');
    sheet.getRange(targetRow, COL.JALUR).setValue(data.jalur || '');
    sheet.getRange(targetRow, COL.PIC).setValue(data.pic || '');
    sheet.getRange(targetRow, COL.ESTIMASI).setValue(Number(data.estimasi) || 0).setNumberFormat(CURR_FORMAT);
    sheet.getRange(targetRow, COL.STATUS).setValue(data.status || 'Draft');

    return jsonResponse({ ok: true, row: targetRow });
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
  if (!row || row < HEADER_ROW + 1 || row > LAST_DATA_ROW) {
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
  if (!row || row < HEADER_ROW + 1 || row > LAST_DATA_ROW) {
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
  if (!row || row < HEADER_ROW + 1 || row > LAST_DATA_ROW) {
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
