// Tab Tracker: kartu ringkas, tabel, approve/reject, tandai ditransfer,
// popup input kegiatan, popup lengkapi (actual + foto nota).

const STATUS_ORDER = ['Draft', 'Siap Ajukan', 'Diajukan', 'Approved', 'Ditolak', 'Revisi', 'Ditransfer', 'Selesai'];
const STATUS_CLASS = {
  'Draft': 'draft', 'Siap Ajukan': 'siap', 'Diajukan': 'diajukan', 'Approved': 'approved',
  'Ditolak': 'ditolak', 'Revisi': 'revisi', 'Ditransfer': 'ditransfer', 'Selesai': 'selesai'
};

let kegiatanData = [];
let plafonData = []; // sengaja belum dirender ke UI (konsep plafon belum settle)
let cachedPin = null;

// Daftar kategori sebenarnya dari tab "kategori" di Sheet (dikirim di doGet).
// Daftar bawaan ini hanya cadangan kalau Apps Script belum di-update.
const KATEGORI_DEFAULT = ['Peralatan/Kulak', 'Packaging Tambahan', 'Ongkos Kirim/Logistik',
  'Konten & Aktivasi Akar', 'Operasional Tim', 'Lain-lain'];
let kategoriList = KATEGORI_DEFAULT.slice();
// Apps Script versi baru mengirim daftar "kategori" dan mengerti data lama (arsip).
// Kalau belum di-update, mode Data lama disembunyikan supaya tidak tersimpan salah.
let backendBaru = false;

// Dana bulk: transfer besar yang dipakai untuk banyak kebutuhan (tab "dana" di Sheet).
// Kebutuhan tertaut lewat kolom "Dana" dan tidak punya Nominal Transfer sendiri.
let danaList = [];
let backendDana = false;

// ---------- approve / reject (PIN diverifikasi di Apps Script) ----------
async function updateStatus(row, newStatus) {
  let pin = cachedPin;
  if (!pin) {
    pin = prompt('PIN approve/reject dari Lemon:');
    if (!pin) return;
  }
  try {
    const json = await zApi.post({ action: 'update_status', row: row, status: newStatus, pin: pin });
    if (json.ok) {
      cachedPin = pin; // biar tidak nanya PIN tiap klik dalam sesi yang sama
      load();
    } else {
      cachedPin = null;
      alert('Gagal: ' + json.error);
    }
  } catch (err) {
    alert('Gagal kirim: ' + err.message);
  }
}

// ---------- render ----------
function renderTracker() {
  populateFilters();
  renderCards();
  renderTable();
  renderDana();
  fillKategori();
  fillDana();
  if ($('m-urgent').classList.contains('show')) renderUrgentList();
  if ($('m-settle').classList.contains('show')) renderSettle();
}

function populateFilters() {
  const kategoris = [...new Set(kegiatanData.map((r) => r['Kategori']).filter(Boolean))].sort();
  $('filterKategori').innerHTML = '<option value="">Semua Kategori</option>' +
    kategoris.map((k) => `<option value="${zEsc(k)}">${zEsc(k)}</option>`).join('');
  $('filterTipe').innerHTML = '<option value="">Semua Tipe</option>' +
    TIPE_LIST.map((t) => `<option value="${t}">${t}</option>`).join('');
  $('filterPic').innerHTML = '<option value="">Semua PIC</option>' +
    PIC_LIST.map((p) => `<option value="${p}">${p}</option>`).join('');
  $('filterStatus').innerHTML = '<option value="">Semua Status</option>' +
    STATUS_ORDER.map((s) => `<option value="${s}">${s}</option>`).join('');
  $('filterDana').innerHTML = '<option value="">Semua Dana</option>' +
    danaList.map((d) => `<option value="${zEsc(d['Nama Dana'])}">${zEsc(d['Nama Dana'])}</option>`).join('');
  $('filterDana').style.display = backendDana && danaList.length ? '' : 'none';
}

// ---------- urgent: sudah di-approve, belum ditransfer ----------
function deadlineKey(r) { return r['Deadline Kegiatan'] || '9999-12-31'; }

// Sudah di-approve dan belum ditransfer. Yang dibayar dari dana tidak dihitung (uangnya
// sudah ada di dana).
function urgentItems() {
  return kegiatanData
    .filter((r) => r['Status'] === 'Approved' && !r['Dana'])
    .sort((a, b) => deadlineKey(a).localeCompare(deadlineKey(b)));
}

function dayLabel(days) {
  if (days === null) return '';
  return days < 0 ? `${Math.abs(days)}h lewat` : days === 0 ? 'hari ini' : `${days}h lagi`;
}

function renderUrgentCard() {
  const items = urgentItems();
  const wrap = $('urgentWrap');
  wrap.classList.toggle('alert', items.length > 0);
  wrap.classList.toggle('idle', items.length === 0);
  if (items.length === 0) {
    $('urgentCard').innerHTML = '<div class="card-empty">Tidak ada. Semua yang sudah di-approve sudah ditransfer.</div>';
    return;
  }
  const total = items.reduce((sum, r) => sum + (Number(r['Estimasi (Rp)']) || 0), 0);
  const withDeadline = items.find((r) => r['Deadline Kegiatan']);
  const days = withDeadline ? daysUntil(withDeadline['Deadline Kegiatan']) : null;
  $('urgentCard').innerHTML =
    `<div class="card-big">${items.length} kegiatan</div>
     <div class="card-sub">Sudah di-approve, belum ditransfer · ${fmtRupiah(total)}</div>` +
    (days === null ? '' : `<div class="card-sub">Deadline terdekat: <span class="${days <= 3 ? 'deadline-soon' : ''}">${dayLabel(days)}</span></div>`);
}

function renderUrgentList() {
  const items = urgentItems();
  if (items.length === 0) {
    $('urgentBody').innerHTML = '<tr><td colspan="5" class="empty">Semua yang sudah di-approve sudah ditransfer.</td></tr>';
    renderUrgentBulk();
    return;
  }
  $('urgentBody').innerHTML = items.map((r) => {
    const days = daysUntil(r['Deadline Kegiatan']);
    const soon = days !== null && days <= 3;
    return `<tr>
      <td class="item">${zEsc(r['Item Kegiatan'] || '-')}</td>
      <td>${zEsc(r['PIC'] || '-')}</td>
      <td class="num">${fmtRupiah(r['Estimasi (Rp)'])}</td>
      <td class="${soon ? 'deadline-soon' : ''}">${zEsc(fmtDate(r['Deadline Kegiatan']))}${days === null ? '' : ' (' + dayLabel(days) + ')'}</td>
      <td><button class="aksi-btn approve" onclick="openTransferModal(${Number(r['_row'])})">Tandai Ditransfer</button>${bayarDanaBtn(Number(r['_row']))}</td>
    </tr>`;
  }).join('');
  renderUrgentBulk();
}

function openUrgent() {
  if (urgentItems().length === 0) return;
  setMsg($('ub-msg'), '', '');
  renderUrgentList();
  openModal('m-urgent');
}

function renderCards() {
  renderUrgentCard();
  // Menunggu Approve: jumlah + total estimasi kegiatan berstatus Diajukan
  const menunggu = kegiatanData.filter((r) => r['Status'] === 'Diajukan');
  const menungguTotal = menunggu.reduce((sum, r) => sum + (Number(r['Estimasi (Rp)']) || 0), 0);
  $('menungguCard').innerHTML = menunggu.length === 0
    ? '<div class="card-empty">Tidak ada yang menunggu approve.</div>'
    : `<div class="card-big">${menunggu.length} kegiatan</div>
       <div class="card-sub">Total estimasi ${fmtRupiah(menungguTotal)}</div>`;

  // Sudah Cair, Belum Ada Nota: (nominal transfer) - (actual dari baris yang sama)
  // Dana bulk ikut dihitung: nominal dana = diterima, total Actual kebutuhan tertaut = terpakai.
  // (Kebutuhan tertaut tidak punya Nominal Transfer sendiri, jadi tidak terhitung dua kali.)
  // Penjaga anti-dobel: baris yang dibayar dari dana diabaikan di sini (nominalnya, kalau ada,
  // dan Actual-nya sudah dihitung lewat dana).
  const sudahCair = kegiatanData.filter((r) => !r['Dana'] && r['Nominal Transfer (Rp)'] !== null && r['Nominal Transfer (Rp)'] !== '' && r['Nominal Transfer (Rp)'] !== undefined);
  let diterima = sudahCair.reduce((sum, r) => sum + (Number(r['Nominal Transfer (Rp)']) || 0), 0);
  let actualDariItu = sudahCair.reduce((sum, r) => sum + (Number(r['Actual (Rp)']) || 0), 0);
  if (backendDana) {
    danaStats().forEach((d) => { diterima += d.nominal; actualDariItu += d.terpakai; });
  }
  const belumNota = diterima - actualDariItu;
  $('belumNotaCard').innerHTML =
    `<div class="card-big ${belumNota === 0 ? 'zero' : ''}">${fmtRupiah(belumNota)}</div>
     <div class="card-sub">Diterima ${fmtRupiah(diterima)} − actual ${fmtRupiah(actualDariItu)}</div>`;

  // Deadline terdekat (belum Selesai, ada tanggal, urut terdekat, max 5)
  const upcoming = kegiatanData
    .filter((r) => r['Status'] !== 'Selesai' && r['Deadline Kegiatan'])
    .map((r) => ({ item: r['Item Kegiatan'], date: r['Deadline Kegiatan'], days: daysUntil(r['Deadline Kegiatan']) }))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 5);

  if (upcoming.length === 0) {
    $('deadlineCard').innerHTML = '<div class="card-empty">Tidak ada deadline mendatang.</div>';
  } else {
    $('deadlineCard').innerHTML = upcoming.map((u) => {
      const soon = u.days !== null && u.days <= 3;
      const dayLabel = u.days === null ? '' : (u.days < 0 ? `${Math.abs(u.days)}h lewat` : u.days === 0 ? 'hari ini' : `${u.days}h lagi`);
      return `<div class="card-row">
        <span class="label" style="max-width:65%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${zEsc(u.item || '-')}</span>
        <span class="value ${soon ? 'deadline-soon' : ''}">${dayLabel}</span>
      </div>`;
    }).join('');
  }
}

function filterMenungguApprove() {
  $('filterStatus').value = 'Diajukan';
  renderTable();
  $('tableKegiatan').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Selisih dari Sheet (rumus). Baris yang diketik manual di luar template belum berumus,
// jadi kalau kosong dihitung di sini: Actual - Estimasi.
function selisihOf(r) {
  const s = r['Selisih (Rp)'];
  if (s !== null && s !== undefined && s !== '') return s;
  const actual = Number(r['Actual (Rp)']);
  return actual ? actual - (Number(r['Estimasi (Rp)']) || 0) : null;
}

function renderTable() {
  const kat = $('filterKategori').value;
  const tipe = $('filterTipe').value;
  const pic = $('filterPic').value;
  const status = $('filterStatus').value;
  const dana = $('filterDana').value;
  const search = $('searchBox').value.trim().toLowerCase();

  const rows = kegiatanData.filter((r) => {
    if (kat && r['Kategori'] !== kat) return false;
    if (tipe && r['Tipe'] !== tipe) return false;
    if (pic && r['PIC'] !== pic) return false;
    if (status && r['Status'] !== status) return false;
    if (dana && r['Dana'] !== dana) return false;
    if (search && !(r['Item Kegiatan'] || '').toLowerCase().includes(search)) return false;
    return true;
  });

  $('rowCount').textContent = rows.length + ' kegiatan';

  const tbody = $('tableBody');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">Tidak ada kegiatan yang cocok dengan filter.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((r) => {
    const rowNo = Number(r['_row']);
    const statusClass = STATUS_CLASS[r['Status']] || 'draft';
    const days = daysUntil(r['Deadline Kegiatan']);
    const deadlineSoon = r['Status'] !== 'Selesai' && days !== null && days <= 3;
    let aksi = '';
    if (r['Status'] === 'Diajukan') {
      aksi = `<button class="aksi-btn approve" onclick="updateStatus(${rowNo}, 'Approved')">Approve</button>
         <button class="aksi-btn reject" onclick="updateStatus(${rowNo}, 'Ditolak')">Reject</button>`;
    } else if (r['Status'] === 'Ditransfer') {
      aksi = `<button class="aksi-btn approve" onclick="openComplete(${rowNo})">Lengkapi</button>`;
    } else if (r['Status'] !== 'Selesai' && !r['Dana'] && (r['Jalur'] === 'Fixed' || r['Status'] === 'Approved')) {
      aksi = `<button class="aksi-btn approve" onclick="openTransferModal(${rowNo})">Tandai Ditransfer</button>` +
        (r['Status'] !== 'Ditolak' ? bayarDanaBtn(rowNo) : '');
    }
    return `<tr>
      <td class="item">${zEsc(r['Item Kegiatan'] || '-')}${r['Dana'] ? `<div class="sub">Dana: ${zEsc(r['Dana'])}</div>` : ''}</td>
      <td>${zEsc(r['Kategori'] || '-')}</td>
      <td>${zEsc(r['Tipe'] || '-')}</td>
      <td>${zEsc(r['PIC'] || '-')}</td>
      <td><span class="badge ${statusClass}">${zEsc(r['Status'] || 'Draft')}</span></td>
      <td class="${deadlineSoon ? 'deadline-soon' : ''}">${zEsc(fmtDate(r['Deadline Kegiatan']))}</td>
      <td class="num">${fmtRupiah(r['Estimasi (Rp)'])}</td>
      <td class="num">${fmtRupiah(r['Actual (Rp)'])}</td>
      <td class="num">${fmtRupiah(selisihOf(r))}</td>
      <td>${aksi}</td>
    </tr>`;
  }).join('');
}

// ---------- popup: tandai ditransfer ----------
let transferRow = null;

function openTransferModal(row) {
  transferRow = row;
  $('tf-pic').innerHTML = '<option value="">Pilih PIC…</option>' +
    PIC_LIST.map((p) => `<option value="${p}">${p}</option>`).join('');
  $('tf-nominal').value = '';
  $('tf-tanggal').value = todayStr();
  const errEl = $('tf-err');
  errEl.textContent = '';
  errEl.classList.remove('show');
  openModal('transferModal');
}

function closeTransferModal() {
  closeModal('transferModal');
  transferRow = null;
}

async function submitTransfer() {
  const pic = $('tf-pic').value;
  const nominal = $('tf-nominal').value;
  const tanggal = $('tf-tanggal').value;
  const errEl = $('tf-err');
  errEl.classList.remove('show');

  if (!pic || !nominal || Number(nominal) <= 0) {
    errEl.textContent = 'Isi PIC Transaksi dan Nominal Transfer (lebih dari 0) dulu.';
    errEl.classList.add('show');
    return;
  }

  const submitBtn = $('tf-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Menyimpan…';

  try {
    const json = await zApi.post({
      action: 'mark_transferred',
      row: transferRow,
      picTransaksi: pic,
      nominalTransfer: Number(nominal),
      tglTransfer: tanggal,
    });
    if (json.ok) {
      const nama = namaBaris(transferRow) || 'Kegiatan';
      closeTransferModal();
      toast('Ditransfer: ' + nama + '. Sekarang tinggal Lengkapi dengan Actual.');
      await load();
    } else {
      errEl.textContent = json.error || 'Gagal menyimpan.';
      errEl.classList.add('show');
    }
  } catch (err) {
    errEl.textContent = 'Gagal kirim: ' + err.message;
    errEl.classList.add('show');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Simpan';
  }
}

// ---------- dana bulk ----------
function fmtDanaRp(n) {
  const num = Math.round(Number(n) || 0);
  return (num < 0 ? '-Rp' : 'Rp') + Math.abs(num).toLocaleString('id-ID');
}

// Terpakai = total Actual kebutuhan tertaut. Rencana = estimasi kebutuhan tertaut yang
// belum selesai. Saldo = dana - terpakai. Sisa bebas = saldo - rencana.
function danaStats() {
  return danaList.map((d) => {
    const nama = d['Nama Dana'];
    const linked = kegiatanData.filter((r) => r['Dana'] === nama);
    const terpakai = linked.reduce((s, r) => s + (Number(r['Actual (Rp)']) || 0), 0);
    const rencana = linked
      .filter((r) => !(Number(r['Actual (Rp)']) > 0) && r['Status'] !== 'Selesai')
      .reduce((s, r) => s + (Number(r['Estimasi (Rp)']) || 0), 0);
    const nominal = Number(d['Nominal (Rp)']) || 0;
    const saldo = nominal - terpakai;
    return {
      nama: nama, nominal: nominal, tgl: d['Tgl Transfer'], pic: d['PIC Transaksi'], catatan: d['Catatan'],
      terpakai: terpakai, rencana: rencana, saldo: saldo, bebas: saldo - rencana, jumlah: linked.length,
      menunggu: linked.filter((r) => r['Status'] === 'Ditransfer').length // menunggu Actual
    };
  });
}

function renderDana() {
  $('danaSection').style.display = backendDana ? '' : 'none';
  if (!backendDana) { $('danaList').innerHTML = ''; return; }
  const stats = danaStats();
  if (!stats.length) {
    $('danaList').innerHTML = '<div class="dana-empty">Belum ada dana. Pakai <b>+ Dana</b> kalau ada transfer bulk yang dipakai untuk banyak kebutuhan.</div>';
    return;
  }
  const aktif = $('filterDana').value;
  $('danaList').innerHTML = stats.map((d) => {
    const pct = d.nominal > 0 ? Math.min(100, Math.max(0, d.terpakai / d.nominal * 100)) : 0;
    const minus = d.saldo < 0;
    return `<div class="dana-card ${aktif === d.nama ? 'on' : ''}" data-nama="${zEsc(d.nama)}" onclick="filterDanaBy(this.dataset.nama)" title="Klik untuk lihat kebutuhan dari dana ini">
      <div class="dana-name">${zEsc(d.nama)}</div>
      <div class="dana-meta">${zEsc(fmtDate(d.tgl))} · ${zEsc(d.pic || '-')} · ${d.jumlah} kebutuhan</div>
      <div class="dana-nums"><span>Dana ${fmtDanaRp(d.nominal)}</span><span>Terpakai ${fmtDanaRp(d.terpakai)}</span></div>
      <div class="dana-bar"><div class="dana-fill ${minus ? 'over' : ''}" style="width:${pct}%"></div></div>
      <div class="dana-saldo ${minus ? 'minus' : ''}">${minus ? 'Kelebihan' : 'Saldo'} <b>${fmtDanaRp(Math.abs(d.saldo))}</b></div>
      ${d.rencana > 0 ? `<div class="dana-plan">Rencana belum jalan ${fmtDanaRp(d.rencana)} · sisa bebas ${fmtDanaRp(d.bebas)}</div>` : ''}
      ${d.menunggu > 0 ? `<div class="dana-actions"><button class="aksi-btn dana" data-nama="${zEsc(d.nama)}" onclick="event.stopPropagation(); openSettle(this.dataset.nama)">Isi Actual sekaligus (${d.menunggu})</button></div>` : ''}
    </div>`;
  }).join('');
}

// Tombol "Bayar dari dana" hanya muncul kalau sudah ada dana.
function bayarDanaBtn(rowNo) {
  return backendDana && danaList.length
    ? ` <button class="aksi-btn dana" onclick="openBayarDana(${rowNo})">Bayar dari dana</button>`
    : '';
}

// ---------- popup: bayar dari dana (tautkan kegiatan yang sudah ada ke dana) ----------
let bayarRow = null;

function updateBayarHint() {
  const el = $('bd-hint');
  const item = kegiatanData.find((r) => r['_row'] === bayarRow);
  const d = danaStats().find((x) => x.nama === $('bd-dana').value);
  if (!item || !d) { el.textContent = ''; el.style.color = ''; return; }
  const sisa = d.bebas - (Number(item['Estimasi (Rp)']) || 0);
  el.textContent = 'Sisa bebas dana setelah ini: ' + fmtDanaRp(sisa) + (sisa < 0 ? ' ⚠ Melebihi sisa dana.' : '.');
  el.style.color = sisa < 0 ? 'var(--red)' : '';
}

function openBayarDana(row) {
  const item = kegiatanData.find((r) => r['_row'] === row);
  if (!item || !danaList.length) return;
  bayarRow = row;
  $('bd-item').textContent = item['Item Kegiatan'] || '-';
  $('bd-estimasi').textContent = fmtRupiah(item['Estimasi (Rp)']);
  $('bd-dana').innerHTML = '<option value="">Pilih dana…</option>' +
    danaStats().map((d) => `<option value="${zEsc(d.nama)}">${zEsc(d.nama)} — saldo ${fmtDanaRp(d.saldo)} · sisa bebas ${fmtDanaRp(d.bebas)}</option>`).join('');
  if (danaList.length === 1) $('bd-dana').value = danaList[0]['Nama Dana'];
  $('bd-err').textContent = '';
  $('bd-err').classList.remove('show');
  $('bd-submit').disabled = false;
  $('bd-submit').textContent = 'Simpan';
  updateBayarHint();
  openModal('m-bayardana');
}

async function submitBayarDana() {
  const dana = $('bd-dana').value;
  const errEl = $('bd-err');
  errEl.classList.remove('show');
  if (!dana) {
    errEl.textContent = 'Pilih dananya dulu.';
    errEl.classList.add('show');
    return;
  }
  const btn = $('bd-submit');
  btn.disabled = true;
  btn.textContent = 'Menyimpan…';
  try {
    const json = await zApi.post({ action: 'link_dana', row: bayarRow, dana: dana });
    if (json.ok) {
      const nama = namaBaris(bayarRow) || 'Kegiatan';
      closeModal('m-bayardana');
      bayarRow = null;
      toast(nama + ' dibayar dari dana "' + dana + '". Tinggal Lengkapi dengan Actual.');
      await load();
    } else {
      errEl.textContent = json.error || 'Gagal menyimpan.';
      errEl.classList.add('show');
    }
  } catch (err) {
    errEl.textContent = 'Gagal kirim: ' + err.message;
    errEl.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Simpan';
  }
}

// ---------- laporan hasil kiriman sekaligus (yang berhasil + yang dilewati beserta alasannya) ----------
function namaBaris(row) {
  const r = kegiatanData.find((x) => x['_row'] === row);
  return r ? (r['Item Kegiatan'] || '') : '';
}

function batchReport(el, json, doneKey, okLabel) {
  const done = json[doneKey] || [];
  const skipped = json.skipped || [];
  const lines = [];
  if (done.length) lines.push(okLabel(done.length));
  if (skipped.length) {
    lines.push(skipped.length + ' dilewati: ' + skipped.map((s) => (namaBaris(s.row) || ('baris ' + s.row)) + ' (' + s.alasan + ')').join('; '));
  }
  if (!done.length && !skipped.length) lines.push(json.error || 'Tidak ada yang diproses.');
  setMsg(el, lines.join(' · '), done.length ? (skipped.length ? 'warn' : 'ok') : 'err');
}

// ---------- bayar SEMUA pengajuan Approved dari satu dana ----------
let ubConfirm = false; // klik pertama minta konfirmasi, klik kedua baru jalan

function renderUrgentBulk() {
  const show = backendDana && danaList.length > 0 && urgentItems().length > 0;
  $('urgentBulk').style.display = show ? '' : 'none';
  if (!show) return;
  const cur = $('ub-dana').value;
  $('ub-dana').innerHTML = danaStats().map((d) =>
    `<option value="${zEsc(d.nama)}">${zEsc(d.nama)} — sisa bebas ${fmtDanaRp(d.bebas)}</option>`).join('');
  if (danaList.some((d) => d['Nama Dana'] === cur)) $('ub-dana').value = cur;
  updateUrgentBulkHint();
}

function updateUrgentBulkHint() {
  ubConfirm = false;
  const items = urgentItems();
  const d = danaStats().find((x) => x.nama === $('ub-dana').value);
  const total = items.reduce((s, r) => s + (Number(r['Estimasi (Rp)']) || 0), 0);
  $('ub-btn').textContent = 'Bayar semua dari dana (' + items.length + ')';
  const el = $('ub-hint');
  if (!d) { el.textContent = ''; el.style.color = ''; return; }
  const sisa = d.bebas - total;
  el.textContent = items.length + ' pengajuan · total estimasi ' + fmtDanaRp(total) + ' · sisa bebas dana setelah ini ' +
    fmtDanaRp(sisa) + (sisa < 0 ? ' ⚠ Melebihi sisa dana.' : '.');
  el.style.color = sisa < 0 ? 'var(--red)' : '';
}

async function submitUrgentBulk() {
  const items = urgentItems();
  const dana = $('ub-dana').value;
  if (!items.length || !dana) return;
  const btn = $('ub-btn');
  if (!ubConfirm) {
    ubConfirm = true;
    btn.textContent = 'Yakin? Klik lagi untuk menautkan ' + items.length + ' pengajuan';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Menyimpan…';
  try {
    const json = await zApi.post({ action: 'link_dana_batch', rows: items.map((r) => Number(r['_row'])), dana: dana });
    batchReport($('ub-msg'), json, 'linked', (n) => n + ' pengajuan dibayar dari dana "' + dana + '" (status Ditransfer, tinggal diisi Actual-nya)');
    if (json.ok) toast((json.linked || []).length + ' pengajuan dibayar dari dana "' + dana + '".');
    await load();
  } catch (err) {
    setMsg($('ub-msg'), 'Gagal kirim: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    updateUrgentBulkHint();
  }
}

// ---------- isi Actual SEKALIGUS untuk kebutuhan dari satu dana ----------
let settleDana = null;

function settleItems() {
  return kegiatanData.filter((r) => r['Dana'] === settleDana && r['Status'] === 'Ditransfer');
}

function openSettle(nama) {
  settleDana = nama;
  setMsg($('st-msg'), '', '');
  $('st-err').classList.remove('show');
  $('settleBody').innerHTML = '';
  renderSettle();
  openModal('m-settle');
}

// Dibangun ulang dari data terbaru; isian yang sudah diketik dipertahankan.
function renderSettle() {
  const keep = {};
  document.querySelectorAll('#settleBody tr[data-row]').forEach((tr) => {
    keep[tr.dataset.row] = { a: tr.querySelector('.settle-in').value, n: tr.querySelector('.settle-nota').value };
  });
  const items = settleItems();
  $('st-sub').textContent = 'Dana: ' + settleDana + ' · ' + items.length + ' kebutuhan menunggu Actual. Kosongkan baris yang belum dibelanjakan, atau yang mau di-Lengkapi sendiri dengan foto nota.';
  if (!items.length) {
    $('settleBody').innerHTML = '<tr><td colspan="4" class="empty">Semua kebutuhan dari dana ini sudah selesai.</td></tr>';
  } else {
    $('settleBody').innerHTML = items.map((r) => {
      const rowNo = Number(r['_row']);
      const k = keep[rowNo] || { a: '', n: '' };
      return `<tr data-row="${rowNo}">
        <td class="item">${zEsc(r['Item Kegiatan'] || '-')}</td>
        <td class="num">${fmtRupiah(r['Estimasi (Rp)'])}</td>
        <td><input type="number" class="settle-in" min="0" step="1" inputmode="numeric" placeholder="0" value="${zEsc(k.a)}" oninput="updateSettleSum()"></td>
        <td><input type="text" class="settle-nota" placeholder="https://…" value="${zEsc(k.n)}"></td>
      </tr>`;
    }).join('');
  }
  $('st-submit').disabled = !items.length;
  updateSettleSum();
}

function updateSettleSum() {
  const rows = [...document.querySelectorAll('#settleBody tr[data-row]')];
  const el = $('st-sum');
  if (!rows.length) { el.textContent = ''; return; }
  let total = 0, filled = 0;
  rows.forEach((tr) => {
    const v = Number(tr.querySelector('.settle-in').value);
    if (v > 0) { total += v; filled++; }
  });
  const d = danaStats().find((x) => x.nama === settleDana);
  const sesudah = d ? d.saldo - total : null;
  el.textContent = 'Terisi ' + filled + ' dari ' + rows.length + ' · total Actual ' + fmtDanaRp(total) +
    (d ? ' · saldo dana setelah ini ' + fmtDanaRp(sesudah) + (sesudah < 0 ? ' ⚠ Melebihi dana.' : '') : '');
  el.style.color = d && sesudah < 0 ? 'var(--red)' : '';
}

// Isi baris yang masih kosong dengan estimasinya (berguna kalau realisasi = rencana).
function settleFillEst() {
  document.querySelectorAll('#settleBody tr[data-row]').forEach((tr) => {
    const input = tr.querySelector('.settle-in');
    if (input.value.trim() !== '') return;
    const r = kegiatanData.find((x) => x['_row'] === Number(tr.dataset.row));
    const est = r ? Number(r['Estimasi (Rp)']) : 0;
    if (est > 0) input.value = est;
  });
  updateSettleSum();
}

async function submitSettle() {
  const errEl = $('st-err');
  errEl.classList.remove('show');
  setMsg($('st-msg'), '', '');
  const items = [];
  let bad = '';
  document.querySelectorAll('#settleBody tr[data-row]').forEach((tr) => {
    tr.classList.remove('settle-row-err');
    const a = tr.querySelector('.settle-in').value.trim();
    const n = tr.querySelector('.settle-nota').value.trim();
    if (a === '' && n === '') return; // dibiarkan: tetap Ditransfer
    if (!(Number(a) > 0)) { bad = 'Actual harus angka lebih dari 0 (atau kosongkan barisnya).'; tr.classList.add('settle-row-err'); return; }
    if (n && !/^https?:\/\/\S+$/i.test(n)) { bad = 'Link nota harus diawali http:// atau https://'; tr.classList.add('settle-row-err'); return; }
    items.push({ row: Number(tr.dataset.row), actual: Number(a), nota: n || null });
  });
  if (bad || !items.length) {
    errEl.textContent = bad || 'Isi Actual minimal satu kebutuhan.';
    errEl.classList.add('show');
    return;
  }
  const btn = $('st-submit');
  btn.disabled = true;
  btn.textContent = 'Menyimpan…';
  try {
    const json = await zApi.post({ action: 'complete_batch', items: items });
    if (json.ok && !(json.skipped || []).length) {
      // semua beres: tutup dan kembali ke dashboard. Kalau ada yang dilewati, popup tetap
      // terbuka supaya alasannya terbaca.
      closeModal('m-settle');
      toast((json.completed || []).length + ' kebutuhan ditandai Selesai.');
    } else {
      batchReport($('st-msg'), json, 'completed', (n) => n + ' kebutuhan ditandai Selesai');
    }
    await load();
  } catch (err) {
    setMsg($('st-msg'), 'Gagal kirim: ' + err.message, 'err');
  } finally {
    btn.textContent = 'Simpan semua';
    btn.disabled = settleItems().length === 0;
  }
}

// Klik kartu dana = saring tabel ke dana itu (klik lagi = lepas saringan).
function filterDanaBy(nama) {
  $('filterDana').value = $('filterDana').value === nama ? '' : nama;
  renderTable();
  renderDana();
  if ($('filterDana').value) $('tableKegiatan').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- popup: dana baru ----------
function openDana() {
  $('danaForm').reset();
  clearErrors($('danaForm'));
  setMsg($('d-msg'), '', '');
  $('d-tgl').value = todayStr();
  openModal('m-dana');
}

$('danaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg($('d-msg'), '', '');
  clearErrors($('danaForm'));
  const nama = $('d-nama').value.trim();
  const nominal = $('d-nominal').value;
  const pic = $('d-pic').value;
  let ok = true;
  const bad = (id) => { $(id).classList.add('show'); ok = false; };
  if (!nama) bad('err-d-nama');
  if (!nominal || Number(nominal) <= 0) bad('err-d-nominal');
  if (!pic) bad('err-d-pic');
  if (!ok) return;

  const btn = $('d-submit');
  btn.disabled = true;
  btn.textContent = 'Menyimpan…';
  try {
    const json = await zApi.post({
      action: 'add_dana', nama: nama, nominal: Number(nominal),
      tglTransfer: $('d-tgl').value || null, picTransaksi: pic, catatan: $('d-catatan').value.trim() || null,
    });
    if (json.ok) {
      $('danaForm').reset();
      closeModal('m-dana');
      toast('Dana "' + (json.nama || nama) + '" tersimpan. Sekarang bisa dipilih di form Kebutuhan baru.');
      await load();
      $('danaSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      setMsg($('d-msg'), 'Gagal simpan: ' + (json.error || 'error tidak diketahui.'), 'err');
    }
  } catch (err) {
    setMsg($('d-msg'), 'Gagal kirim: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Simpan dana';
  }
});

// ---------- popup: input kegiatan baru ----------
// Isi pilihan kategori dari daftar di Sheet. Pilihan yang sedang dipilih dipertahankan.
function fillKategori() {
  const cur = $('k-kategori').value;
  $('k-kategori').innerHTML = '<option value="">Pilih kategori…</option>' +
    kategoriList.map((k) => `<option value="${zEsc(k)}">${zEsc(k)}</option>`).join('');
  if (kategoriList.indexOf(cur) !== -1) $('k-kategori').value = cur;
}

// Pilihan "Dibayar dari dana" (hanya tampil kalau sudah ada dana).
function fillDana() {
  const cur = $('k-dana').value;
  $('k-dana').innerHTML = '<option value="">Bukan dari dana (ajukan biasa)</option>' +
    danaStats().map((d) => `<option value="${zEsc(d.nama)}">${zEsc(d.nama)} — saldo ${fmtDanaRp(d.saldo)}</option>`).join('');
  if (danaList.some((d) => d['Nama Dana'] === cur)) $('k-dana').value = cur;
  $('k-dana-wrap').style.display = backendDana && danaList.length ? '' : 'none';
}

function chosenDana() {
  return backendDana ? $('k-dana').value : '';
}

function updateDanaHint() {
  const el = $('k-dana-hint');
  const nama = chosenDana();
  const d = nama ? danaStats().find((x) => x.nama === nama) : null;
  if (!d) { el.textContent = ''; el.style.color = ''; return; }
  const arsip = backendBaru && $('k-arsip').checked;
  const nilai = Number(arsip ? $('k-actual').value : $('k-estimasi').value) || 0;
  const batas = arsip ? d.saldo : d.bebas;
  el.textContent = 'Saldo dana ' + fmtDanaRp(d.saldo) + (d.rencana > 0 ? ' · sisa bebas ' + fmtDanaRp(d.bebas) : '') + '. ' +
    (arsip ? 'Dicatat langsung Selesai.' : 'Uangnya sudah ada, jadi langsung berstatus Ditransfer, tinggal Lengkapi.') +
    (nilai > 0 && nilai > batas ? ' ⚠ Melebihi sisa dana.' : '');
  el.style.color = nilai > 0 && nilai > batas ? 'var(--red)' : '';
}

// Form menyesuaikan diri: mode Data lama dan pilihan dana mengubah kolom yang perlu.
function syncKegiatanForm() {
  const arsip = backendBaru && $('k-arsip').checked;
  const dana = chosenDana();
  $('k-arsip-box').style.display = arsip ? 'flex' : 'none';
  $('k-status-wrap').style.display = (arsip || dana) ? 'none' : '';
  $('k-jalur-wrap').style.display = dana ? 'none' : '';
  $('k-nominal-wrap').style.display = dana ? 'none' : '';
  $('k-est-opt').style.display = arsip ? 'inline' : 'none';
  updateDanaHint();
}
$('k-arsip').addEventListener('change', syncKegiatanForm);
$('k-dana').addEventListener('change', syncKegiatanForm);
$('k-estimasi').addEventListener('input', updateDanaHint);
$('k-actual').addEventListener('input', updateDanaHint);

function openKegiatan() {
  $('kegiatanForm').reset();
  clearErrors($('kegiatanForm'));
  setMsg($('k-msg'), '', '');
  fillKategori();
  fillDana();
  $('k-arsip').closest('label').style.display = backendBaru ? '' : 'none';
  syncKegiatanForm();
  openModal('m-kegiatan');
}

function chosenKategori() {
  return $('k-kategoriNew').value.trim() || $('k-kategori').value;
}

function validateKegiatan() {
  clearErrors($('kegiatanForm'));
  const arsip = backendBaru && $('k-arsip').checked;
  let valid = true;
  const need = (field, bad) => { if (bad) { $('err-k-' + field).classList.add('show'); valid = false; } };
  need('item', !$('k-item').value.trim());
  need('kategori', !chosenKategori());
  need('tipe', !$('k-tipe').value);
  need('jalur', !chosenDana() && !$('k-jalur').value);
  need('pic', !$('k-pic').value);
  const est = $('k-estimasi').value;
  if (arsip) {
    const actual = $('k-actual').value;
    need('actual', !actual || Number(actual) <= 0);
    const nota = $('k-nota').value.trim();
    need('nota', nota !== '' && !/^https?:\/\/\S+$/i.test(nota));
  } else {
    need('estimasi', !est || Number(est) <= 0);
  }
  return valid;
}

// "Simpan & tambah lagi" menjaga popup tetap terbuka untuk input berikutnya; "Simpan" menutupnya.
let keepOpenAfterSave = false;
$('k-submit').addEventListener('click', () => { keepOpenAfterSave = false; });
$('k-submit-more').addEventListener('click', () => { keepOpenAfterSave = true; });

// Untuk input berikutnya: kosongkan yang biasanya beda tiap baris (item, jumlah, nota), tapi
// pertahankan yang sering sama (Data lama, dana, kategori, tipe, PIC, tanggal) supaya
// memasukkan banyak data berurutan cepat.
function clearForNext() {
  ['k-item', 'k-estimasi', 'k-deadline', 'k-actual', 'k-nominal', 'k-nota', 'k-kategoriNew'].forEach((id) => { $(id).value = ''; });
  clearErrors($('kegiatanForm'));
  syncKegiatanForm();
  $('k-item').focus();
}

$('kegiatanForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg($('k-msg'), '', '');
  if (!validateKegiatan()) return;
  const keepOpen = keepOpenAfterSave;
  keepOpenAfterSave = false;

  const arsip = backendBaru && $('k-arsip').checked;
  const payload = {
    item: $('k-item').value.trim(),
    kategori: chosenKategori(),
    tipe: $('k-tipe').value,
    jalur: $('k-jalur').value,
    pic: $('k-pic').value,
    estimasi: $('k-estimasi').value,
    deadline: $('k-deadline').value || null,
    status: $('k-status').value,
  };
  if (arsip) {
    Object.assign(payload, {
      arsip: true,
      status: 'Selesai',
      actual: Number($('k-actual').value),
      nominalTransfer: $('k-nominal').value || null,
      picTransaksi: $('k-pictrans').value || null,
      tglTransfer: $('k-tgltf').value || null,
      nota: $('k-nota').value.trim() || null,
    });
  }
  const dana = chosenDana();
  if (dana) {
    Object.assign(payload, { dana: dana, jalur: 'Dana', status: arsip ? 'Selesai' : 'Ditransfer' });
    if (arsip) payload.nominalTransfer = null; // uangnya sudah ada di dana
  }

  const btn = keepOpen ? $('k-submit-more') : $('k-submit');
  const btnLabel = btn.textContent;
  $('k-submit').disabled = true;
  $('k-submit-more').disabled = true;
  btn.textContent = 'Menyimpan…';
  try {
    const json = await zApi.post(payload);
    if (json.ok) {
      const ringkas = 'Tersimpan: ' + payload.item + (arsip ? ' (data lama)' : '') + (dana ? ' — dari dana "' + dana + '"' : '');
      toast(ringkas);
      if (keepOpen) {
        setMsg($('k-msg'), ringkas + '. Silakan isi yang berikutnya.', 'ok');
        clearForNext();
      } else {
        $('kegiatanForm').reset();
        syncKegiatanForm();
        closeModal('m-kegiatan');
      }
      await load();
    } else {
      setMsg($('k-msg'), 'Gagal simpan: ' + (json.error || 'error tidak diketahui.'), 'err');
    }
  } catch (err) {
    setMsg($('k-msg'), 'Gagal kirim: ' + err.message, 'err');
  } finally {
    btn.textContent = btnLabel;
    $('k-submit').disabled = false;
    $('k-submit-more').disabled = false;
  }
});

// ---------- popup: lengkapi (actual + foto nota) ----------
const MAX_DIM = 1600;
const JPEG_QUALITY = 0.7;
let completeRow = null;
let photoBase64 = null; // hasil kompresi, tanpa prefix data:...;base64,

function openComplete(row) {
  completeRow = row;
  photoBase64 = null;
  $('completeForm').reset();
  clearErrors($('completeForm'));
  $('c-preview').style.display = 'none';
  setMsg($('c-msg'), '', '');
  setMsg($('c-msg-done'), '', '');
  setMsg($('c-status'), '', '');
  $('c-submit').disabled = false;
  $('c-submit').textContent = 'Simpan & tandai selesai';
  $('c-close-row').style.display = 'none';
  $('c-info').style.display = 'none';
  $('completeForm').style.display = 'none';

  const item = kegiatanData.find((r) => r['_row'] === row);
  if (!item) {
    setMsg($('c-status'), 'Kegiatan di baris ' + row + ' tidak ditemukan, jadi belum bisa dilengkapi.', 'err');
    $('c-close-row').style.display = 'flex';
  } else {
    $('c-i-item').textContent = item['Item Kegiatan'] || '-';
    $('c-i-kategori').textContent = item['Kategori'] || '-';
    $('c-i-estimasi').textContent = fmtRupiah(item['Estimasi (Rp)']);
    $('c-i-transfer').textContent = fmtRupiah(item['Nominal Transfer (Rp)']);
    $('c-info').style.display = 'block';
    if (item['Status'] === 'Selesai') {
      setMsg($('c-status'), 'Kegiatan ini sudah dilengkapi sebelumnya.', 'ok');
      $('c-close-row').style.display = 'flex';
    } else if (item['Status'] !== 'Ditransfer') {
      setMsg($('c-status'), 'Belum bisa dilengkapi: statusnya masih "' + (item['Status'] || 'Draft') + '". Baru bisa setelah statusnya "Ditransfer".', 'warn');
      $('c-close-row').style.display = 'flex';
    } else {
      $('completeForm').style.display = 'flex';
    }
  }
  openModal('m-complete');
}

// Kecilkan foto: max sisi 1600px, JPEG kualitas 0.7. Return { base64, dataUrl, kb }.
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file foto.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('File bukan gambar yang bisa dibaca.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        const base64 = dataUrl.split(',')[1];
        resolve({ base64, dataUrl, kb: Math.round(base64.length * 3 / 4 / 1024) });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

$('c-photo').addEventListener('change', async () => {
  const file = $('c-photo').files[0];
  photoBase64 = null;
  $('c-preview').style.display = 'none';
  if (!file) return;
  try {
    const out = await compressImage(file);
    photoBase64 = out.base64;
    $('c-previewImg').src = out.dataUrl;
    $('c-previewSize').textContent = 'Ukuran setelah dikecilkan: ± ' + out.kb + ' KB';
    $('c-preview').style.display = 'block';
  } catch (err) {
    $('c-photo').value = '';
    setMsg($('c-msg'), err.message, 'err');
  }
});

$('completeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg($('c-msg'), '', '');
  $('err-c-actual').classList.remove('show');

  const actual = $('c-actual').value;
  if (!actual || Number(actual) <= 0) {
    $('err-c-actual').classList.add('show');
    return;
  }

  const btn = $('c-submit');
  btn.disabled = true;
  btn.textContent = 'Menyimpan…';
  try {
    const json = await zApi.post({
      action: 'complete_kegiatan',
      row: completeRow,
      actual: Number(actual),
      photoBase64: photoBase64,
      photoMime: 'image/jpeg',
    });
    if (json.ok) {
      const item = kegiatanData.find((r) => r['_row'] === completeRow);
      closeModal('m-complete');
      toast('Selesai: ' + ((item && item['Item Kegiatan']) || 'kegiatan') + (photoBase64 ? ' (nota terunggah)' : ''));
      await load();
    } else {
      setMsg($('c-msg'), 'Gagal simpan: ' + (json.error || 'error tidak diketahui.'), 'err');
      btn.disabled = false;
      btn.textContent = 'Simpan & tandai selesai';
    }
  } catch (err) {
    setMsg($('c-msg'), 'Gagal kirim: ' + err.message, 'err');
    btn.disabled = false;
    btn.textContent = 'Simpan & tandai selesai';
  }
});
