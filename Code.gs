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
// GANTI angka ini ke sesuatu yang tidak gampang ditebak, lalu kabari
// Lemon PIN-nya lewat chat pribadi, bukan ditulis di tempat lain.
var APPROVAL_PIN = 'GANTI_PIN_DI_APPS_SCRIPT';

var KATEGORI_LIST = ['Peralatan/Kulak', 'Packaging Tambahan', 'Ongkos Kirim/Logistik',
                      'Konten & Aktivasi Akar', 'Operasional Tim', 'Lain-lain'];
var PIC_LIST = ['Lenno', 'Ricko', 'Yanuar', 'Christina'];
var STATUS_LIST = ['Draft', 'Siap Ajukan', 'Diajukan', 'Approved', 'Ditolak', 'Revisi', 'Ditransfer', 'Selesai'];

// ============================================================
// MENU
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Zerodeo Tools')
    .addItem('Setup / Reset Tracker', 'setupTracker')
    .addToUi();
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

  var headers = ['No', 'Tanggal Dicatat', 'Deadline Kegiatan', 'Project/Brand', 'Item Kegiatan',
                  'Kategori', 'Jalur', 'PIC', 'Estimasi (Rp)', 'Status', 'Ditransfer ke',
                  'Nominal Transfer (Rp)', 'Tgl Transfer', 'Actual (Rp)', 'Selisih (Rp)', 'Nota/Bukti', 'Catatan'];
  sheet.getRange(HEADER_ROW, 1, 1, headers.length).setValues([headers]);
  styleHeaderRow(sheet, HEADER_ROW, headers.length);

  var firstDataRow = HEADER_ROW + 1;
  var example = [1, new Date(2026, 8, 26), new Date(2026, 9, 5), 'Zerodeo',
                  'Contoh: sewa rak display sample Malang', 'Peralatan/Kulak', 'Pengajuan', 'Ricko',
                  1200000, 'Draft', '', '', '', '', '', '', ''];
  sheet.getRange(firstDataRow, 1, 1, example.length).setValues([example]);
  sheet.getRange(firstDataRow, 1, 1, example.length).setBackground('#FFFF00');
  sheet.getRange(firstDataRow, 15).setFormula('=IF(N' + firstDataRow + '="","",N' + firstDataRow + '-I' + firstDataRow + ')');

  for (var row = firstDataRow + 1; row <= LAST_DATA_ROW; row++) {
    sheet.getRange(row, 1).setFormula('=IF(E' + row + '="","",ROW()-' + HEADER_ROW + ')');
    sheet.getRange(row, 15).setFormula('=IF(N' + row + '="","",N' + row + '-I' + row + ')');
  }

  var numDataRows = LAST_DATA_ROW - firstDataRow + 1;
  sheet.getRange(firstDataRow, 2, numDataRows, 1).setNumberFormat(DATE_FORMAT);
  sheet.getRange(firstDataRow, 3, numDataRows, 1).setNumberFormat(DATE_FORMAT);
  sheet.getRange(firstDataRow, 9, numDataRows, 1).setNumberFormat(CURR_FORMAT);
  sheet.getRange(firstDataRow, 12, numDataRows, 1).setNumberFormat(CURR_FORMAT);
  sheet.getRange(firstDataRow, 13, numDataRows, 1).setNumberFormat(DATE_FORMAT);
  sheet.getRange(firstDataRow, 14, numDataRows, 1).setNumberFormat(CURR_FORMAT);
  sheet.getRange(firstDataRow, 15, numDataRows, 1).setNumberFormat(CURR_FORMAT);

  setDropdown(sheet, 'D' + firstDataRow + ':D' + LAST_DATA_ROW, ['Zerodeo']);
  setDropdown(sheet, 'F' + firstDataRow + ':F' + LAST_DATA_ROW, KATEGORI_LIST);
  setDropdown(sheet, 'G' + firstDataRow + ':G' + LAST_DATA_ROW, ['Fixed', 'Pengajuan']);
  setDropdown(sheet, 'H' + firstDataRow + ':H' + LAST_DATA_ROW, PIC_LIST);
  setDropdown(sheet, 'J' + firstDataRow + ':J' + LAST_DATA_ROW, STATUS_LIST);
  setDropdown(sheet, 'K' + firstDataRow + ':K' + LAST_DATA_ROW, PIC_LIST);

  var widths = [40, 90, 90, 80, 260, 150, 80, 70, 100, 90, 90, 110, 90, 100, 100, 120, 160];
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
  var kegJalur = "kegiatan!$G$" + firstDataRow + ":$G$" + LAST_DATA_ROW;
  var kegKat = "kegiatan!$F$" + firstDataRow + ":$F$" + LAST_DATA_ROW;
  var kegStatus = "kegiatan!$J$" + firstDataRow + ":$J$" + LAST_DATA_ROW;
  var kegActual = "kegiatan!$N$" + firstDataRow + ":$N$" + LAST_DATA_ROW;

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
  var statusRange = "kegiatan!$J$" + firstDataRow + ":$J$" + LAST_DATA_ROW;
  var jalurRange = "kegiatan!$G$" + firstDataRow + ":$G$" + LAST_DATA_ROW;
  var katRange = "kegiatan!$F$" + firstDataRow + ":$F$" + LAST_DATA_ROW;
  var actualRange = "kegiatan!$N$" + firstDataRow + ":$N$" + LAST_DATA_ROW;
  var estRange = "kegiatan!$I$" + firstDataRow + ":$I$" + LAST_DATA_ROW;
  var transferRange = "kegiatan!$L$" + firstDataRow + ":$L$" + LAST_DATA_ROW;
  var picTransferRange = "kegiatan!$K$" + firstDataRow + ":$K$" + LAST_DATA_ROW;
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
  sheet.getRange(r, 1).setValue('Saldo uang muka per PIC (ditransfer − actual)').setFontWeight('bold');
  r++;
  sheet.getRange(r, 1, 1, 4).setValues([['PIC', 'Total Diterima (Rp)', 'Total Actual (Rp)', 'Saldo Belum Closed (Rp)']]);
  styleHeaderRow(sheet, r, 4);
  r++;
  PIC_LIST.forEach(function (pic) {
    sheet.getRange(r, 1).setValue(pic);
    sheet.getRange(r, 2).setFormula('=SUMIF(' + picTransferRange + ',A' + r + ',' + transferRange + ')').setNumberFormat(CURR_FORMAT);
    sheet.getRange(r, 3).setFormula('=SUMIFS(' + actualRange + ',' + picTransferRange + ',A' + r + ')').setNumberFormat(CURR_FORMAT);
    sheet.getRange(r, 4).setFormula('=B' + r + '-C' + r).setNumberFormat(CURR_FORMAT);
    r++;
  });

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
      var itemVal = sheet.getRange(r, 5).getValue(); // kolom E — Item Kegiatan
      if (!itemVal) { targetRow = r; break; }
    }
    if (!targetRow) {
      return jsonResponse({ ok: false, error: 'Tabel kegiatan sudah penuh (60 baris). Tambah baris manual dulu di Sheet, atau minta perluas template.' });
    }

    sheet.getRange(targetRow, 2).setValue(new Date()).setNumberFormat(DATE_FORMAT); // Tanggal Dicatat
    if (data.deadline) {
      sheet.getRange(targetRow, 3).setValue(new Date(data.deadline)).setNumberFormat(DATE_FORMAT);
    }
    sheet.getRange(targetRow, 4).setValue('Zerodeo');
    sheet.getRange(targetRow, 5).setValue(data.item || '');
    sheet.getRange(targetRow, 6).setValue(data.kategori || '');
    sheet.getRange(targetRow, 7).setValue(data.jalur || '');
    sheet.getRange(targetRow, 8).setValue(data.pic || '');
    sheet.getRange(targetRow, 9).setValue(Number(data.estimasi) || 0).setNumberFormat(CURR_FORMAT);
    sheet.getRange(targetRow, 10).setValue(data.status || 'Draft');

    return jsonResponse({ ok: true, row: targetRow });
}

// Approve / Reject — hanya jalan kalau PIN cocok. Row diambil dari
// field "_row" yang doGet sisipkan ke tiap objek kegiatan, jadi
// dashboard tinggal kirim balik nomor itu tanpa perlu cari lagi.
function handleUpdateStatus(data) {
  if (data.pin !== APPROVAL_PIN) {
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
  var currentStatus = sheet.getRange(row, 10).getValue();
  if (currentStatus !== 'Diajukan') {
    return jsonResponse({ ok: false, error: 'Baris ini statusnya sudah "' + currentStatus + '", bukan "Diajukan" lagi — mungkin sudah diproses orang lain.' });
  }

  sheet.getRange(row, 10).setValue(data.status);
  var noteCell = sheet.getRange(row, 17); // Catatan
  var existingNote = noteCell.getValue();
  var stamp = data.status + ' oleh Lemon, ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yy HH:mm');
  noteCell.setValue(existingNote ? (existingNote + ' | ' + stamp) : stamp);

  return jsonResponse({ ok: true, row: row, status: data.status });
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
