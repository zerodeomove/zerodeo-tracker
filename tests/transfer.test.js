// Tes transfer bertahap (DP / termin / pelunasan) di Code.gs + bacaan bot di Hub.gs. Jalankan: node tests/transfer.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

let n = 0;
const ok = (m) => { n++; console.log('ok  ' + m); };
const sama = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));

function lembar(rows) {
  return {
    rows,
    getLastRow() { return this.rows.length; },
    getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); },
    appendRow(r) { this.rows.push(r.slice()); },
    getRange(r, c, nr, nc) {
      const self = this; nr = nr || 1; nc = nc || 1;
      return {
        getValue() { return ((self.rows[r - 1] || [])[c - 1]) ?? ''; },
        setValue(v) { while (self.rows.length < r) self.rows.push([]); self.rows[r - 1][c - 1] = v; return this; },
        setNumberFormat() { return this; },
        getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((self.rows[r - 1 + i] || [])[c - 1 + j]) ?? ''); o.push(row); } return o; }
      };
    }
  };
}

const COLS = ['No', 'Tanggal Dicatat', 'Deadline Kegiatan', 'Project/Brand', 'Item Kegiatan', 'Kategori', 'Tipe', 'Jalur', 'PIC', 'Estimasi (Rp)', 'Status', 'PIC Transaksi',
  'Nominal Transfer (Rp)', 'Tgl Transfer', 'Actual (Rp)', 'Selisih', 'Nota/Bukti', 'Catatan', 'Dana', 'ID'];
const baris = (item, est, status, jalur, id) => [1, '', '', 'Zerodeo', item, 'Produksi', 'Opex', jalur, 'lenno', est, status, '', '', '', '', '', '', '', '', id];
const sheets = {
  kegiatan: lembar([[], [], [], COLS, baris('Stiker Zerodeo · Sprint', 13447406, 'Approved', 'Pengajuan', 'k-stiker'), baris('Sewa rak', 1200000, 'Approved', 'Pengajuan', 'k-rak')])
};
const ctx = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
  Utilities: { getUuid: () => 'x', formatDate: (d) => d.toISOString().slice(0, 10) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
  Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (nm) => sheets[nm] || null, insertSheet: (nm) => (sheets[nm] = lembar([])) }) },
  console
};
vm.createContext(ctx);
['Marketing.gs', 'Code.gs', 'Hub.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx));
vm.runInContext("normalizePic_ = function (v) { return String(v || ''); }; readTim_ = function () { return [{ id: 'lenno', nama: 'Lenno', peran: 'admin' }]; }; CURRENT_WHO_ = { uid: 'lenno', peran: 'admin' };", ctx);
const tf = (row, nominal, keterangan, tgl) => JSON.parse(ctx.handleMarkTransferred({ row, nominalTransfer: nominal, picTransaksi: 'lenno', tglTransfer: tgl || '2026-11-13', keterangan }).text);
const keg = (row) => sheets.kegiatan.rows[row - 1];

// DP
let r = tf(5, 6723703, 'DP');
assert.strictEqual(r.ok, true); assert.strictEqual(r.sebagian, true); assert.strictEqual(r.total_transfer, 6723703); assert.strictEqual(r.sisa, 6723703);
assert.strictEqual(keg(5)[10], 'Approved'); assert.strictEqual(keg(5)[12], 6723703); ok('DP: status tetap Approved, Nominal Transfer = 6.723.703, sisa 6.723.703');
assert(sheets.transfer && sheets.transfer.rows.length === 2); sama(sheets.transfer.rows[1].slice(1, 5), ['k-stiker', 'Stiker Zerodeo · Sprint', 'DP', 6723703]); ok('DP: tab "transfer" dibuat otomatis, riwayat tercatat (ID, item, keterangan, nominal)');
// pelunasan (boleh langsung, tanpa approve ulang)
r = tf(5, 6723703, 'Pelunasan', '2026-11-20');
assert.strictEqual(r.ok, true); assert.strictEqual(r.sebagian, false); assert.strictEqual(r.total_transfer, 13447406); assert.strictEqual(r.sisa, 0); assert.strictEqual(r.lebih, 0);
assert.strictEqual(keg(5)[10], 'Ditransfer'); assert.strictEqual(keg(5)[12], 13447406); ok('Pelunasan: langsung boleh, total 13.447.406, status Ditransfer (tinggal Lengkapi)');
assert.strictEqual(JSON.parse(ctx.handleMarkTransferred({ row: 5, nominalTransfer: 1000, picTransaksi: 'lenno', keterangan: 'Termin' }).text).ok, false); ok('sudah Ditransfer penuh: tidak bisa ditambah lagi');
// riwayat untuk web & bot
const riw = ctx.getTransferData_();
sama(riw['k-stiker'].map((t) => t.ket + ' ' + t.nominal), ['DP 6723703', 'Pelunasan 6723703']); ok('riwayat transfer per kegiatan (untuk popup web)');
// sekali bayar (perilaku lama, tanpa keterangan)
r = tf(6, 1200000);
assert.strictEqual(r.sebagian, false); assert.strictEqual(keg(6)[10], 'Ditransfer'); assert.strictEqual(r.total_transfer, 1200000); ok('tanpa keterangan = sekali bayar lunas, sama seperti sebelumnya (bot / klien lama tetap jalan)');

// melebihi estimasi: hanya diberi tahu, tetap tersimpan
sheets.kegiatan.rows.push(baris('Banner', 1000000, 'Approved', 'Pengajuan', 'k-banner'));
tf(7, 600000, 'DP');
r = tf(7, 650000, 'Pelunasan');
assert.strictEqual(r.ok, true); assert.strictEqual(r.lebih, 250000); assert.strictEqual(keg(7)[12], 1250000); ok('total melebihi estimasi: tetap tersimpan, server memberi tahu kelebihannya (+250.000)');

// sudah ditransfer duluan padahal belum di-approve: tetap dicatat, dianggap acc, jejaknya di Catatan
sheets.kegiatan.rows.push(baris('Percetakan stiker', 13447406, 'Siap Ajukan', 'Pengajuan', 'k-cetak'));
r = tf(8, 6723703, 'DP');
assert.strictEqual(r.ok, true); assert.strictEqual(r.acc_otomatis, true); assert.strictEqual(keg(8)[10], 'Approved');
assert(/Ditransfer sebelum di-approve, dianggap acc \(dicatat oleh Lenno/.test(keg(8)[17]), keg(8)[17]); ok('belum di-approve (Siap Ajukan) tapi sudah DP: dicatat, status jadi Approved (dianggap acc), jejak di Catatan');
r = tf(8, 6723703, 'Pelunasan');
assert.strictEqual(r.acc_otomatis, false); assert.strictEqual(keg(8)[10], 'Ditransfer'); ok('pelunasan berikutnya: lanjut normal sampai Ditransfer');
sheets.kegiatan.rows.push(baris('Banner ditolak', 500000, 'Ditolak', 'Pengajuan', 'k-tolak'));
r = tf(9, 500000);
assert.strictEqual(r.ok, false); assert(/Ditolak/.test(r.error)); ok('kegiatan Ditolak: transfer tidak bisa dicatat (salah catat)');

// bot membaca: sisa transfer + riwayat
sheets.kegiatan.rows.push(baris('Kaos event', 2000000, 'Approved', 'Pengajuan', 'k-kaos'));
tf(10, 500000, 'DP');
vm.runInContext("sheetToObjects = function (sh) { var h = sh.rows[3]; return sh.rows.slice(4).map(function (r, i) { var o = { _row: i + 5 }; h.forEach(function (k, j) { o[k] = r[j]; }); return o; }); };", ctx);
const b = ctx.botBaca_('lenno', 'admin', { jenis: 'kegiatan', teks: 'kaos' });
const kaos = b.data[0];
assert.strictEqual(kaos.status, 'Approved · ditransfer sebagian'); assert.strictEqual(kaos.sisa_transfer, 1500000); assert(/^DP 2026-11-13 Rp500000 \(tanpa bukti\)$/.test(kaos.riwayat_transfer[0]), kaos.riwayat_transfer[0]);
ok('bot: kegiatan yang dibayar sebagian terbaca "ditransfer sebagian" + sisa + riwayat transfernya');

// bukti transfer (foto/PDF) ikut tersimpan per transfer
vm.runInContext("saveNotaPhoto_ = function (nama, b64, mime) { if (b64 === 'rusak') throw new Error('Folder nota tidak bisa dibuka.'); return 'https://drive.google.com/file/d/BUKTI/view#' + encodeURIComponent(nama); };", ctx);
sheets.kegiatan.rows.push(baris('Stiker kedua', 1000000, 'Approved', 'Pengajuan', 'k-stiker2'));
r = JSON.parse(ctx.handleMarkTransferred({ row: 11, nominalTransfer: 500000, picTransaksi: 'lenno', keterangan: 'DP', photoBase64: 'aGFsbw==', photoMime: 'image/jpeg' }).text);
assert.strictEqual(r.ok, true); assert(/^https:\/\/drive\.google\.com\/file\/d\/BUKTI/.test(r.bukti) && /Bukti%20transfer%20DP%20-%20Stiker%20kedua/.test(r.bukti));
const tfRow = sheets.transfer.rows[sheets.transfer.rows.length - 1];
assert.strictEqual(tfRow[8], r.bukti); assert.strictEqual(ctx.getTransferData_()['k-stiker2'][0].bukti, r.bukti); ok('bukti transfer: disimpan ke Drive ("Bukti transfer DP - <item>"), link tercatat di riwayat transfer');
r = JSON.parse(ctx.handleMarkTransferred({ row: 11, nominalTransfer: 500000, picTransaksi: 'lenno', keterangan: 'Pelunasan', photoBase64: 'rusak' }).text);
assert.strictEqual(r.ok, true); assert(/Folder nota/.test(r.bukti_gagal)); assert.strictEqual(keg(11)[10], 'Ditransfer'); ok('unggah bukti gagal: transfernya tetap tercatat, alasannya dikabarkan');
const nat = ctx.botNative_({ jenis: 'tandai_transfer', id: 'k-stiker2', nominal: 1, pic_transaksi: 'lenno', keterangan: 'DP', photoBase64: 'aGFsbw==', photoMime: 'image/jpeg' });
assert.strictEqual(nat.action, 'mark_transferred'); assert.strictEqual(nat.photoBase64, 'aGFsbw=='); assert.strictEqual(nat.keterangan, 'DP'); ok('bot: foto yang dikirim ke Telegram ikut diteruskan sebagai bukti transfer');

// tempel bukti ke transfer yang sudah tercatat (tidak menambah nominal)
const tempel = (o) => JSON.parse(ctx.handleAttachTransferProof(Object.assign({ photoBase64: 'aGFsbw==', photoMime: 'image/jpeg' }, o)).text);
const totalSebelum = keg(5)[12];
r = tempel({ row: 5 });
assert.strictEqual(r.ok, false); assert(/Ada beberapa transfer: DP .*Pelunasan/.test(r.error), r.error); ok('tempel bukti: ada DP dan pelunasan tanpa bukti → ditanya yang mana');
r = tempel({ row: 5, keterangan: 'dp' });
assert.strictEqual(r.ok, true); assert(/Bukti%20transfer%20DP%20-%20Stiker%20Zerodeo/.test(r.bukti)); assert.strictEqual(keg(5)[12], totalSebelum);
assert.strictEqual(ctx.getTransferData_()['k-stiker'][0].bukti, r.bukti); ok('tempel bukti ke DP: tersimpan di riwayat DP, Nominal Transfer TIDAK bertambah');
r = tempel({ row: 5, keterangan: 'DP' });
assert.strictEqual(r.ok, false); assert(/sudah punya bukti/.test(r.error)); ok('DP sudah punya bukti: ditanya dulu (ganti?)');
assert.strictEqual(tempel({ row: 5, keterangan: 'DP', ganti: true }).ok, true); ok('ganti=true: bukti lama diganti');
r = tempel({ row: 5 });
assert.strictEqual(r.ok, true); assert(/Pelunasan/.test(r.transfer)); ok('tanpa keterangan: otomatis ke satu-satunya transfer yang belum punya bukti (Pelunasan)');
r = tempel({ row: 5, index: 0, ganti: true });
assert.strictEqual(r.ok, true); assert(/^DP/.test(r.transfer)); ok('dari web: pilih lewat urutan riwayat (index)');
assert.strictEqual(tempel({ row: 6, photoBase64: '' }).ok, false); ok('tanpa foto: ditolak');
sheets.kegiatan.rows.push(baris('Belum dibayar', 100000, 'Approved', 'Pengajuan', 'k-belum'));
r = tempel({ row: sheets.kegiatan.rows.length });
assert.strictEqual(r.ok, false); assert(/Belum ada transfer tercatat/.test(r.error)); ok('kegiatan tanpa transfer: diarahkan catat transfer dulu');
const nat2 = ctx.botNative_({ jenis: 'tempel_bukti', id: 'k-stiker', keterangan: 'DP', photoBase64: 'aGFsbw==', photoMime: 'image/jpeg' });
assert.strictEqual(nat2.action, 'attach_transfer_proof'); assert.strictEqual(nat2.keterangan, 'DP');
assert(/tidak ikut/.test(ctx.botNative_({ jenis: 'tempel_bukti', id: 'k-stiker' }).error)); ok('bot: tempel_bukti diteruskan dengan fotonya; tanpa foto ditolak');

console.log('\n' + n + ' pemeriksaan lolos');
