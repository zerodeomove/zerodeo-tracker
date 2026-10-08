// Tab Tracker: kartu ringkas, tabel, approve/reject, tandai ditransfer,
// popup input kegiatan, popup lengkapi (actual + foto nota).

const STATUS_ORDER = ['Draft', 'Siap Ajukan', 'Diajukan', 'Approved', 'Ditolak', 'Revisi', 'Ditransfer', 'Selesai', 'Dibatalkan'];
const STATUS_CLASS = {
  'Draft': 'draft', 'Siap Ajukan': 'siap', 'Diajukan': 'diajukan', 'Approved': 'approved',
  'Ditolak': 'ditolak', 'Revisi': 'revisi', 'Ditransfer': 'ditransfer', 'Selesai': 'selesai', 'Dibatalkan': 'dibatalkan'
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
// Apps Script versi baru mengerti edit / batalkan / pulihkan / edit dana (doGet mengirim edit: true).
let backendEdit = false;
let backendVersi = '';   // penanda versi Apps Script yang sedang melayani (doGet.versi)
let backendFoto = false;
let backendReimburse = false;   // Catat reimburse di kartu dana (butuh Apps Script terbaru)
let backendFotoBatch = false;   // foto/PDF per baris di Isi Actual sekaligus
let noNotaOnly = false;         // saringan "Selesai tapi belum ada nota" (dari kartu)   // upload foto nota di Data lama / Edit (butuh Apps Script terbaru)
const PIN_STATUSES = ['Approved', 'Ditransfer', 'Selesai'];

// ---------- approve / reject (PIN diverifikasi di Apps Script) ----------
function updateStatus(row, newStatus) {
  let pin = cachedPin;
  if (!pin) {
    pin = prompt('PIN approve/reject dari Lemon:');
    if (!pin) return;
  }
  enqueueSave({
    label: (newStatus === 'Approved' ? 'Approve' : 'Reject') + ': ' + (namaBaris(row) || 'baris ' + row),
    payload: { action: 'update_status', row: row, status: newStatus, pin: pin },
    rows: [row], restore: null
  });
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

// Pilihan filter dibangun ulang setiap data dimuat; pilihan yang sedang aktif dipertahankan
// (sebelumnya kembali ke "Semua" setiap selesai simpan).
function populateFilters() {
  const ids = ['filterKategori', 'filterTipe', 'filterPic', 'filterStatus', 'filterDana', 'filterPeriode'];
  const keep = {};
  ids.forEach((id) => { keep[id] = $(id).value; });
  buildFilterOptions();
  ids.forEach((id) => {
    const el = $(id);
    if (keep[id] && [...el.options].some((o) => o.value === keep[id])) el.value = keep[id];
  });
}

// Bulan (yyyy-mm) dari Tanggal Dicatat; data lama memakai tanggal bayarnya.
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function monthKey(r) {
  const t = String(r['Tanggal Dicatat'] || '');
  return /^\d{4}-\d{2}/.test(t) ? t.slice(0, 7) : '';
}
function monthLabel(k) {
  return k ? BULAN[Number(k.slice(5, 7)) - 1] + ' ' + k.slice(0, 4) : 'Tanpa tanggal';
}
function monthOptions() {
  return [...new Set(kegiatanData.map(monthKey).filter(Boolean))].sort().reverse();
}

function hasNota(r) {
  return /^https?:\/\//i.test(r['Nota/Bukti'] || '');
}

function buildFilterOptions() {
  $('filterPeriode').innerHTML = '<option value="">Semua waktu</option>' +
    monthOptions().map((k) => `<option value="${k}">${monthLabel(k)}</option>`).join('');
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
  const sudahCair = kegiatanData.filter((r) => r['Status'] !== 'Dibatalkan' && !r['Dana'] && r['Nominal Transfer (Rp)'] !== null && r['Nominal Transfer (Rp)'] !== '' && r['Nominal Transfer (Rp)'] !== undefined);
  let diterima = sudahCair.reduce((sum, r) => sum + (Number(r['Nominal Transfer (Rp)']) || 0), 0);
  let actualDariItu = sudahCair.reduce((sum, r) => sum + (Number(r['Actual (Rp)']) || 0), 0);
  if (backendDana) {
    danaStats().forEach((d) => { diterima += d.nominal + d.reimburse; actualDariItu += d.terpakai; });
  }
  const belumNota = diterima - actualDariItu;
  // Kegiatan Selesai yang kolom notanya masih kosong: bisa diklik untuk menyaring tabel.
  const tanpaNota = kegiatanData.filter((r) => r['Status'] === 'Selesai' && !hasNota(r)).length;
  $('belumNotaCard').innerHTML =
    `<div class="card-big ${belumNota === 0 ? 'zero' : ''}">${fmtRupiah(belumNota)}</div>
     <div class="card-sub">Diterima ${fmtRupiah(diterima)} − actual ${fmtRupiah(actualDariItu)}</div>` +
    (tanpaNota ? `<div class="card-sub"><a href="#" class="card-link" onclick="setNoNota(true); return false;">${tanpaNota} kegiatan Selesai belum ada nota →</a></div>` : '');

  // Deadline terdekat (belum Selesai, ada tanggal, urut terdekat, max 5)
  const upcoming = kegiatanData
    .filter((r) => deadlineAktif(r) && r['Deadline Kegiatan'])
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

// Deadline hanya berarti untuk kegiatan yang masih berjalan: bukan Selesai, Ditolak, atau Dibatalkan.
function deadlineAktif(r) {
  return ['Selesai', 'Ditolak', 'Dibatalkan'].indexOf(r['Status']) === -1;
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
  const periode = $('filterPeriode').value;
  const search = $('searchBox').value.trim().toLowerCase();
  $('noNotaChip').style.display = noNotaOnly ? '' : 'none';

  let hidden = 0;
  const rows = kegiatanData.filter((r) => {
    if (periode && monthKey(r) !== periode) return false;
    if (noNotaOnly && !(r['Status'] === 'Selesai' && !hasNota(r))) return false;
    if (kat && r['Kategori'] !== kat) return false;
    if (tipe && r['Tipe'] !== tipe) return false;
    if (pic && r['PIC'] !== pic) return false;
    if (status && r['Status'] !== status) return false;
    if (dana && r['Dana'] !== dana) return false;
    if (search && !(r['Item Kegiatan'] || '').toLowerCase().includes(search)) return false;
    if (!status && r['Status'] === 'Dibatalkan') { hidden++; return false; } // disembunyikan kecuali disaring khusus
    return true;
  });

  // terbaru di atas (Tanggal Dicatat, lalu nomor baris)
  rows.sort((a, b) => String(b['Tanggal Dicatat'] || '').localeCompare(String(a['Tanggal Dicatat'] || '')) || Number(b['_row']) - Number(a['_row']));

  $('hiddenHint').textContent = hidden ? hidden + ' dibatalkan disembunyikan (saring Status: Dibatalkan)' : '';
  const pend = pendingRows();
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
    const deadlineSoon = deadlineAktif(r) && days !== null && days <= 3;
    let aksi = '';
    const editBtn = backendEdit ? `<button class="aksi-btn edit" onclick="openEdit(${rowNo})">Edit</button>` : '';
    if (pend.has(rowNo)) {
      aksi = '<span class="pending-note">menyimpan…</span>';
    } else if (r['Status'] === 'Diajukan') {
      aksi = `<button class="aksi-btn approve" onclick="updateStatus(${rowNo}, 'Approved')">Approve</button>
         <button class="aksi-btn reject" onclick="updateStatus(${rowNo}, 'Ditolak')">Reject</button>`;
    } else if (r['Status'] === 'Ditransfer') {
      aksi = `<button class="aksi-btn approve" onclick="openComplete(${rowNo})">Lengkapi</button>`;
    } else if (r['Status'] !== 'Selesai' && r['Status'] !== 'Dibatalkan' && !r['Dana'] && (r['Jalur'] === 'Fixed' || r['Status'] === 'Approved')) {
      aksi = `<button class="aksi-btn approve" onclick="openTransferModal(${rowNo})">Tandai Ditransfer</button>` +
        (r['Status'] !== 'Ditolak' ? bayarDanaBtn(rowNo) : '');
    }
    if (!pend.has(rowNo)) aksi += editBtn;
    return `<tr>
      <td class="item">${zEsc(r['Item Kegiatan'] || '-')}${/^https?:\/\//i.test(r['Nota/Bukti'] || '') ? ` <a class="nota-link" href="${zEsc(r['Nota/Bukti'])}" data-item="${zEsc(r['Item Kegiatan'] || '')}" onclick="return openNota(this)" target="_blank" rel="noopener noreferrer" title="Lihat nota">📎</a>` : ''}<div class="sub">${r['Tanggal Dicatat'] ? 'dicatat ' + zEsc(fmtDate(r['Tanggal Dicatat'])) : ''}${r['Tanggal Dicatat'] && r['Dana'] ? ' · ' : ''}${r['Dana'] ? 'Dana: ' + zEsc(r['Dana']) : ''}</div></td>
      <td data-label="Kategori">${zEsc(r['Kategori'] || '-')}</td>
      <td data-label="Tipe">${zEsc(r['Tipe'] || '-')}</td>
      <td data-label="PIC">${zEsc(r['PIC'] || '-')}</td>
      <td data-label="Status"><span class="badge ${statusClass}">${zEsc(r['Status'] || 'Draft')}</span></td>
      <td data-label="Deadline" class="${deadlineSoon ? 'deadline-soon' : ''}">${zEsc(fmtDate(r['Deadline Kegiatan']))}</td>
      <td data-label="Estimasi" class="num">${fmtRupiah(r['Estimasi (Rp)'])}</td>
      <td data-label="Actual" class="num">${fmtRupiah(r['Actual (Rp)'])}</td>
      <td data-label="Selisih" class="num">${fmtRupiah(selisihOf(r))}</td>
      <td class="aksi">${aksi}</td>
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

function submitTransfer() {
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
  const row = transferRow;
  const nama = namaBaris(row) || 'Kegiatan';
  enqueueSave({
    label: 'Ditransfer: ' + nama,
    payload: { action: 'mark_transferred', row: row, picTransaksi: pic, nominalTransfer: Number(nominal), tglTransfer: tanggal },
    rows: [row],
    okMsg: 'Ditransfer: ' + nama + '. Sekarang tinggal Lengkapi dengan Actual.',
    restore: () => { openTransferModal(row); $('tf-pic').value = pic; $('tf-nominal').value = nominal; $('tf-tanggal').value = tanggal; }
  });
  closeTransferModal();
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
    const linked = kegiatanData.filter((r) => r['Dana'] === nama && r['Status'] !== 'Dibatalkan');
    const terpakai = linked.reduce((s, r) => s + (Number(r['Actual (Rp)']) || 0), 0);
    const rencana = linked
      .filter((r) => !(Number(r['Actual (Rp)']) > 0) && r['Status'] !== 'Selesai')
      .reduce((s, r) => s + (Number(r['Estimasi (Rp)']) || 0), 0);
    const nominal = Number(d['Nominal (Rp)']) || 0;
    const reimburse = Number(d['Reimburse (Rp)']) || 0;   // talangan yang sudah diganti
    const saldo = nominal + reimburse - terpakai;
    return {
      nama: nama, row: d['_row'], nominal: nominal, reimburse: reimburse, tgl: d['Tgl Transfer'], pic: d['PIC Transaksi'], catatan: d['Catatan'],
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
    const masuk = d.nominal + d.reimburse;
    const pct = masuk > 0 ? Math.min(100, Math.max(0, d.terpakai / masuk * 100)) : 0;
    const minus = d.saldo < 0;
    const btnReimburse = minus && backendReimburse
      ? `<button class="aksi-btn dana" data-nama="${zEsc(d.nama)}" onclick="event.stopPropagation(); openReimburse(this.dataset.nama)">Catat reimburse</button>` : '';
    const btnSettle = d.menunggu > 0
      ? `<button class="aksi-btn dana" data-nama="${zEsc(d.nama)}" onclick="event.stopPropagation(); openSettle(this.dataset.nama)">Isi Actual sekaligus (${d.menunggu})</button>` : '';
    const btnEdit = backendEdit
      ? `<button class="aksi-btn edit" data-nama="${zEsc(d.nama)}" onclick="event.stopPropagation(); openDanaEdit(this.dataset.nama)">Edit</button>` : '';
    return `<div class="dana-card ${aktif === d.nama ? 'on' : ''}" data-nama="${zEsc(d.nama)}" onclick="filterDanaBy(this.dataset.nama)" title="Klik untuk lihat kebutuhan dari dana ini">
      <div class="dana-name">${zEsc(d.nama)}</div>
      <div class="dana-meta">${zEsc(fmtDate(d.tgl))} · ${zEsc(d.pic || '-')} · ${d.jumlah} kebutuhan</div>
      <div class="dana-nums"><span>Dana ${fmtDanaRp(d.nominal)}${d.reimburse ? ` + reimburse ${fmtDanaRp(d.reimburse)}` : ''}</span><span>Terpakai ${fmtDanaRp(d.terpakai)}</span></div>
      <div class="dana-bar"><div class="dana-fill ${minus ? 'over' : ''}" style="width:${pct}%"></div></div>
      <div class="dana-saldo ${minus ? 'minus' : ''}">${minus ? 'Perlu reimburse' : 'Saldo'} <b>${fmtDanaRp(Math.abs(d.saldo))}</b></div>
      ${minus ? '<div class="dana-plan">Pengeluaran melebihi dana, selisihnya ditalangi dulu.</div>' : ''}
      ${d.rencana > 0 ? `<div class="dana-plan">Rencana belum jalan ${fmtDanaRp(d.rencana)} · sisa bebas ${fmtDanaRp(d.bebas)}</div>` : ''}
      ${(btnReimburse || btnSettle || btnEdit) ? `<div class="dana-actions">${btnReimburse}${btnSettle}${btnEdit}</div>` : ''}
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

function submitBayarDana() {
  const dana = $('bd-dana').value;
  const errEl = $('bd-err');
  errEl.classList.remove('show');
  if (!dana) {
    errEl.textContent = 'Pilih dananya dulu.';
    errEl.classList.add('show');
    return;
  }
  const row = bayarRow;
  const nama = namaBaris(row) || 'Kegiatan';
  enqueueSave({
    label: 'Bayar dari dana: ' + nama,
    payload: { action: 'link_dana', row: row, dana: dana },
    rows: [row],
    okMsg: nama + ' dibayar dari dana "' + dana + '". Tinggal Lengkapi dengan Actual.',
    restore: () => { openBayarDana(row); $('bd-dana').value = dana; updateBayarHint(); }
  });
  closeModal('m-bayardana');
  bayarRow = null;
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

// Foto/PDF nota per baris di Isi Actual sekaligus: { nomorBaris: hasil compressImage }.
// Disimpan di sini (bukan di input file) supaya tidak hilang saat tabel dibangun ulang.
let settlePhotos = {};
const SETTLE_MAX_FOTO = 10;
const SETTLE_MAX_KB = 3400;   // total foto per kirim (batas kiriman Vercel ±4,5 MB setelah base64)

function settlePhotoLabel(rowNo) {
  const p = settlePhotos[rowNo];
  if (!p) return '';
  return '<span class="settle-photo-ok">' + (p.mime === 'application/pdf' ? '📄 ' : '🖼 ') + zEsc(p.name) + ' · ' + p.kb + ' KB ' +
    '<button type="button" class="link-btn" onclick="clearSettlePhoto(' + rowNo + ')">hapus</button></span>';
}

async function pickSettlePhoto(input) {
  const rowNo = Number(input.closest('tr').dataset.row);
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    settlePhotos[rowNo] = await compressImage(file);
  } catch (err) {
    setMsg($('st-msg'), err.message, 'err');
    return;
  }
  input.closest('td').querySelector('.settle-photo-info').innerHTML = settlePhotoLabel(rowNo);
  updateSettleSum();
}

function clearSettlePhoto(rowNo) {
  delete settlePhotos[rowNo];
  const tr = document.querySelector('#settleBody tr[data-row="' + rowNo + '"]');
  if (tr) tr.querySelector('.settle-photo-info').innerHTML = '';
  updateSettleSum();
}

function openSettle(nama) {
  settleDana = nama;
  settlePhotos = {};
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
    $('settleBody').innerHTML = '<tr><td colspan="5" class="empty">Semua kebutuhan dari dana ini sudah selesai.</td></tr>';
  } else {
    $('settleBody').innerHTML = items.map((r) => {
      const rowNo = Number(r['_row']);
      const k = keep[rowNo] || { a: '', n: '' };
      return `<tr data-row="${rowNo}">
        <td class="item">${zEsc(r['Item Kegiatan'] || '-')}</td>
        <td class="num">${fmtRupiah(r['Estimasi (Rp)'])}</td>
        <td><input type="number" class="settle-in" min="0" step="1" inputmode="numeric" placeholder="0" value="${zEsc(k.a)}" oninput="updateSettleSum()"></td>
        <td><input type="text" class="settle-nota" placeholder="https://…" value="${zEsc(k.n)}"></td>
        <td class="settle-photo-cell" ${backendFotoBatch ? '' : 'style="display:none"'}>
          <input type="file" class="settle-photo" accept="image/*,application/pdf" onchange="pickSettlePhoto(this)">
          <div class="settle-photo-info">${settlePhotoLabel(rowNo)}</div></td>
      </tr>`;
    }).join('');
  }
  $('st-submit').disabled = !items.length;
  $('st-photo-th').style.display = backendFotoBatch ? '' : 'none';
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
    const p = backendFotoBatch ? settlePhotos[Number(tr.dataset.row)] : null;
    if (a === '' && n === '' && !p) return; // dibiarkan: tetap Ditransfer
    if (!(Number(a) > 0)) { bad = 'Actual harus angka lebih dari 0 (atau kosongkan barisnya).'; tr.classList.add('settle-row-err'); return; }
    if (n && !/^https?:\/\/\S+$/i.test(n)) { bad = 'Link nota harus diawali http:// atau https://'; tr.classList.add('settle-row-err'); return; }
    const item = { row: Number(tr.dataset.row), actual: Number(a), nota: n || null };
    if (p) { item.photoBase64 = p.base64; item.photoMime = p.mime; }
    items.push(item);
  });
  const fotos = items.filter((i) => i.photoBase64);
  const fotoKb = fotos.reduce((s, i) => s + Math.round(i.photoBase64.length * 3 / 4 / 1024), 0);
  if (!bad && fotos.length > SETTLE_MAX_FOTO) bad = 'Foto/PDF maksimal ' + SETTLE_MAX_FOTO + ' sekali kirim. Hapus sebagian foto, kirim, lalu sisanya berikutnya.';
  if (!bad && fotoKb > SETTLE_MAX_KB) bad = 'Total foto/PDF terlalu besar untuk sekali kirim (' + fotoKb + ' KB, maks ±3,4 MB). Kirim sebagian dulu.';
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
    (json.completed || []).forEach((r) => { delete settlePhotos[r]; });
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

// ---------- popup: dana baru / edit dana ----------
let danaEditRow = null;   // null = dana baru, angka = baris di tab dana yang sedang diedit

function setDanaMode(edit) {
  $('d-title').textContent = edit ? 'Edit dana' : 'Dana baru';
  $('d-intro').style.display = edit ? 'none' : '';
  $('d-submit').textContent = edit ? 'Simpan perubahan' : 'Simpan dana';
}

function openDana() {
  danaEditRow = null;
  $('danaForm').reset();
  clearErrors($('danaForm'));
  setMsg($('d-msg'), '', '');
  setDanaMode(false);
  $('d-pin-wrap').style.display = 'none';
  $('d-tgl').value = todayStr();
  openModal('m-dana');
}

function openDanaEdit(nama) {
  const d = danaList.find((x) => x['Nama Dana'] === nama);
  if (!d) return;
  danaEditRow = d['_row'];
  $('danaForm').reset();
  clearErrors($('danaForm'));
  setMsg($('d-msg'), '', '');
  setDanaMode(true);
  $('d-nama').value = d['Nama Dana'] || '';
  $('d-nominal').value = d['Nominal (Rp)'] || '';
  $('d-tgl').value = String(d['Tgl Transfer'] || '').slice(0, 10);
  $('d-pic').value = d['PIC Transaksi'] || '';
  $('d-catatan').value = d['Catatan'] || '';
  const terpakai = kegiatanData.some((r) => r['Dana'] === nama);   // PIN hanya kalau sudah dipakai
  $('d-pin-wrap').style.display = terpakai ? '' : 'none';
  $('d-pin').value = cachedPin || '';
  openModal('m-dana');
}

$('danaForm').addEventListener('submit', (e) => {
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
  const needPin = danaEditRow !== null && $('d-pin-wrap').style.display !== 'none';
  if (needPin && !$('d-pin').value.trim()) { setMsg($('d-msg'), 'Isi PIN Lemon dulu.', 'err'); ok = false; }
  if (!ok) return;

  const snap = snapshotForm($('danaForm'));
  delete snap['d-pin'];
  const edit = danaEditRow !== null;
  const row = danaEditRow;
  const oldNama = edit ? (danaList.find((x) => x['_row'] === row) || {})['Nama Dana'] : null;
  const payload = {
    action: edit ? 'edit_dana' : 'add_dana', nama: nama, nominal: Number(nominal),
    tglTransfer: $('d-tgl').value || null, picTransaksi: pic, catatan: $('d-catatan').value.trim() || null,
  };
  if (edit) payload.row = row;
  if (needPin) payload.pin = $('d-pin').value.trim();
  enqueueSave({
    label: (edit ? 'Edit dana: ' : 'Dana: ') + nama,
    payload: payload, rows: [],
    okMsg: edit ? null : 'Dana "' + nama + '" tersimpan. Sekarang bisa dipilih di form Kebutuhan baru.',
    restore: () => { if (edit) openDanaEdit(oldNama); else openDana(); restoreForm(snap); }
  });
  $('danaForm').reset();
  closeModal('m-dana');
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
  photos.k = null;
  showPhoto('k');
  $('k-photo').closest('label').style.display = backendFoto ? '' : 'none';
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
  photos.k = null;
  showPhoto('k');
  clearErrors($('kegiatanForm'));
  syncKegiatanForm();
  $('k-item').focus();
}

$('kegiatanForm').addEventListener('submit', (e) => {
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
    if (photos.k) Object.assign(payload, { photoBase64: photos.k.base64, photoMime: photos.k.mime });
  }
  const dana = chosenDana();
  if (dana) {
    Object.assign(payload, { dana: dana, jalur: 'Dana', status: arsip ? 'Selesai' : 'Ditransfer' });
    if (arsip) payload.nominalTransfer = null; // uangnya sudah ada di dana
  }

  const snap = snapshotForm($('kegiatanForm'));
  const photoK = arsip ? photos.k : null;
  enqueueSave({
    label: payload.item + (arsip ? ' (data lama)' : '') + (photoK ? ' (+ foto nota)' : '') + (dana ? ' — dari dana "' + dana + '"' : ''),
    payload: payload, rows: [], expectNota: !!photoK,
    restore: () => { openKegiatan(); restoreForm(snap); photos.k = photoK; showPhoto('k'); syncKegiatanForm(); }
  });
  if (keepOpen) {
    setMsg($('k-msg'), '"' + payload.item + '" masuk antrean simpan. Silakan isi yang berikutnya.', 'ok');
    clearForNext();
  } else {
    $('kegiatanForm').reset();
    photos.k = null;
    showPhoto('k');
    syncKegiatanForm();
    closeModal('m-kegiatan');
  }
});

// ---------- foto nota di popup Data lama (k) dan Edit (ed) ----------
// Foto dikecilkan di browser (compressImage), dikirim sebagai base64, dan Apps Script
// menyimpannya ke folder Drive "Zerodeo - Nota Bukti" lalu mengisi link notanya sendiri.
const photos = { k: null, ed: null };

// Isi kotak preview: gambar untuk foto, nama file untuk PDF.
function paintPreview(wrapEl, imgEl, sizeEl, v) {
  wrapEl.style.display = v ? 'block' : 'none';
  if (!v) return;
  const pdf = v.mime === 'application/pdf';
  imgEl.style.display = pdf ? 'none' : '';
  if (!pdf) imgEl.src = v.dataUrl;
  sizeEl.textContent = pdf ? 'PDF: ' + v.name + ' · ' + v.kb + ' KB' : 'Ukuran setelah dikecilkan: ± ' + v.kb + ' KB';
}

function showPhoto(p) {
  const v = photos[p];
  paintPreview($(p + '-photo-prev'), $(p + '-photo-img'), $(p + '-photo-size'), v);
  if (!v) $(p + '-photo').value = '';
}

['k', 'ed'].forEach((p) => {
  $(p + '-photo').addEventListener('change', async () => {
    const file = $(p + '-photo').files[0];
    photos[p] = null;
    showPhoto(p);
    if (!file) return;
    try {
      photos[p] = await compressImage(file);
      showPhoto(p);
    } catch (err) {
      $(p + '-photo').value = '';
      setMsg($(p === 'k' ? 'k-msg' : 'ed-msg'), err.message, 'err');
    }
  });
});

// ---------- popup: lengkapi (actual + foto nota) ----------
const MAX_DIM = 1600;
const JPEG_QUALITY = 0.7;
let completeRow = null;
let photoBase64 = null; // hasil kompresi, tanpa prefix data:...;base64,
let photoInfo = null;   // { mime, name, kb, dataUrl } untuk preview dan jenis file

function openComplete(row) {
  completeRow = row;
  photoBase64 = null;
  photoInfo = null;
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

// Nota: foto dikecilkan (max sisi 1600px, JPEG kualitas 0.7); PDF dikirim apa adanya (maks
// PDF_MAX_KB, karena Vercel membatasi ukuran kiriman). Return { base64, dataUrl, kb, mime, name }.
const PDF_MAX_KB = 3000;
function compressImage(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Gagal membaca file PDF.'));
      reader.onload = () => {
        const base64 = String(reader.result).split(',')[1] || '';
        const kb = Math.round(base64.length * 3 / 4 / 1024);
        if (kb > PDF_MAX_KB) { reject(new Error('PDF terlalu besar (' + kb + ' KB, maks 3 MB). Kecilkan dulu, atau pakai link Drive.')); return; }
        resolve({ base64, dataUrl: '', kb, mime: 'application/pdf', name: file.name || 'nota.pdf' });
      };
      reader.readAsDataURL(file);
    });
  }
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
        resolve({ base64, dataUrl, kb: Math.round(base64.length * 3 / 4 / 1024), mime: 'image/jpeg', name: file.name || 'foto.jpg' });
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
    photoInfo = out;
    paintPreview($('c-preview'), $('c-previewImg'), $('c-previewSize'), out);
  } catch (err) {
    $('c-photo').value = '';
    setMsg($('c-msg'), err.message, 'err');
  }
});

$('completeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  setMsg($('c-msg'), '', '');
  $('err-c-actual').classList.remove('show');

  const actual = $('c-actual').value;
  if (!actual || Number(actual) <= 0) {
    $('err-c-actual').classList.add('show');
    return;
  }
  const row = completeRow;
  const photo = photoBase64;
  const info = photo ? photoInfo : null;
  const nama = namaBaris(row) || 'kegiatan';
  enqueueSave({
    label: 'Selesai: ' + nama + (photo ? ' (+ foto nota)' : ''),
    payload: { action: 'complete_kegiatan', row: row, actual: Number(actual), photoBase64: photo, photoMime: info ? info.mime : 'image/jpeg' },
    rows: [row],
    restore: () => {
      openComplete(row);
      $('c-actual').value = actual;
      if (photo) {
        photoBase64 = photo;
        photoInfo = info;
        paintPreview($('c-preview'), $('c-previewImg'), $('c-previewSize'), info);
      }
    }
  });
  closeModal('m-complete');
});

// ---------- pratinjau nota: klik 📎 = pratinjau, klik gambar = buka file penuh ----------
// Link Drive (/d/<id>) ditampilkan sebagai gambar kecil (thumbnail, PDF = halaman pertama).
// Link lain (bukan Drive) langsung dibuka di tab baru. return false = jangan ikuti href.
function openNota(a) {
  const url = a.href;
  const m = /drive\.google\.com\/file\/d\/([\w-]+)/.exec(url);
  if (!m) return true;
  const img = $('nota-img');
  $('nota-title').textContent = a.dataset.item || 'Nota';
  $('nota-open').href = url;
  $('nota-fallback').style.display = 'none';
  img.style.display = '';
  img.onerror = () => { img.style.display = 'none'; $('nota-fallback').style.display = ''; };
  img.src = 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1000';
  openModal('m-nota');
  return false;
}

// ---------- popup: edit kegiatan (+ batalkan / pulihkan) ----------
let editRow = null;
let editOrig = null;
let editCancelAsk = false;   // klik pertama "Batalkan" minta konfirmasi, klik kedua baru jalan

// Status asal sebelum dibatalkan, dibaca dari jejak terakhir di Catatan (sama seperti di Apps Script).
function priorStatusOf(r) {
  const re = /Dibatalkan dari "([^"]+)"/g;
  let m, last = 'Draft';
  while ((m = re.exec(String(r['Catatan'] || ''))) !== null) {
    if (STATUS_ORDER.indexOf(m[1]) !== -1 && m[1] !== 'Dibatalkan') last = m[1];
  }
  return last;
}

function openEdit(row) {
  const r = kegiatanData.find((x) => x['_row'] === row);
  if (!r || !backendEdit) return;
  if (pendingRows().has(row)) { toast('Masih menyimpan perubahan untuk kegiatan ini.', 'err'); return; }
  editRow = row;
  editCancelAsk = false;
  const status = r['Status'] || 'Draft';
  const batal = status === 'Dibatalkan';

  const kats = kategoriList.slice();
  if (r['Kategori'] && kats.indexOf(r['Kategori']) === -1) kats.push(r['Kategori']);
  $('ed-kategori').innerHTML = kats.map((k) => `<option value="${zEsc(k)}">${zEsc(k)}</option>`).join('');

  editOrig = {
    item: r['Item Kegiatan'] || '', kategori: r['Kategori'] || '', tipe: r['Tipe'] || 'Opex', pic: r['PIC'] || '',
    estimasi: String(r['Estimasi (Rp)'] === null || r['Estimasi (Rp)'] === undefined ? '' : r['Estimasi (Rp)']),
    deadline: String(r['Deadline Kegiatan'] || '').slice(0, 10),
    nominal: String(r['Nominal Transfer (Rp)'] === null || r['Nominal Transfer (Rp)'] === undefined ? '' : r['Nominal Transfer (Rp)']),
    pictrans: r['PIC Transaksi'] || '', tgltf: String(r['Tgl Transfer'] || '').slice(0, 10),
    actual: String(r['Actual (Rp)'] === null || r['Actual (Rp)'] === undefined ? '' : r['Actual (Rp)']),
    nota: r['Nota/Bukti'] || ''
  };
  $('editForm').reset();
  clearErrors($('editForm'));
  setMsg($('ed-msg'), '', '');
  $('ed-item').value = editOrig.item;
  $('ed-kategori').value = editOrig.kategori;
  $('ed-kategoriNew').value = '';
  $('ed-tipe').value = editOrig.tipe;
  $('ed-pic').value = editOrig.pic;
  $('ed-estimasi').value = editOrig.estimasi;
  $('ed-deadline').value = editOrig.deadline;
  $('ed-nominal').value = editOrig.nominal;
  $('ed-pictrans').value = editOrig.pictrans;
  $('ed-tgltf').value = editOrig.tgltf;
  $('ed-actual').value = editOrig.actual;
  $('ed-nota').value = editOrig.nota;
  const notaOpen = $('ed-nota-open');
  notaOpen.style.display = /^https?:\/\//i.test(editOrig.nota) ? '' : 'none';
  if (notaOpen.style.display === '') notaOpen.href = editOrig.nota;
  photos.ed = null;
  showPhoto('ed');
  $('ed-photo').closest('label').style.display = backendFoto ? '' : 'none';

  const sudahTf = status === 'Ditransfer' || status === 'Selesai';
  $('ed-sub').textContent = (r['Item Kegiatan'] || '-') + ' · status ' + status + (r['Dana'] ? ' · dari dana "' + r['Dana'] + '"' : '');
  $('ed-fields').style.display = batal ? 'none' : '';
  $('ed-submit').style.display = batal ? 'none' : '';
  $('ed-tf-box').style.display = sudahTf && (!r['Dana'] || r['PIC Transaksi'] || r['Tgl Transfer']) ? '' : 'none';
  $('ed-nominal-wrap').style.display = r['Dana'] ? 'none' : '';
  $('ed-sel-box').style.display = status === 'Selesai' ? '' : 'none';
  const needPin = PIN_STATUSES.indexOf(batal ? priorStatusOf(r) : status) !== -1;
  $('ed-pin-wrap').style.display = needPin ? '' : 'none';
  $('ed-pin').value = cachedPin || '';
  $('ed-alasan').style.display = 'none';
  $('ed-alasan').value = '';
  $('ed-cancel-btn').style.display = batal ? 'none' : '';
  $('ed-cancel-btn').textContent = 'Batalkan kegiatan';
  $('ed-restore-btn').style.display = batal ? '' : 'none';
  openModal('m-edit');
}

// PIN dari popup edit; null (dan pesan galat) kalau dibutuhkan tapi kosong.
function editPin() {
  if ($('ed-pin-wrap').style.display === 'none') return '';
  const pin = $('ed-pin').value.trim();
  if (!pin) { setMsg($('ed-msg'), 'Isi PIN Lemon dulu.', 'err'); return null; }
  return pin;
}

$('editForm').addEventListener('submit', (e) => {
  e.preventDefault();
  setMsg($('ed-msg'), '', '');
  clearErrors($('editForm'));
  const row = editRow;
  const o = editOrig;
  const kat = $('ed-kategoriNew').value.trim() || $('ed-kategori').value;
  const cur = {
    item: $('ed-item').value.trim(), kategori: kat, tipe: $('ed-tipe').value, pic: $('ed-pic').value,
    estimasi: $('ed-estimasi').value.trim(), deadline: $('ed-deadline').value
  };
  const sel = $('ed-sel-box').style.display !== 'none';
  const tf = $('ed-tf-box').style.display !== 'none';
  const hasNominal = tf && $('ed-nominal-wrap').style.display !== 'none';
  if (hasNominal) cur.nominal = $('ed-nominal').value.trim();
  if (tf) { cur.pictrans = $('ed-pictrans').value; cur.tgltf = $('ed-tgltf').value; }
  if (sel) { cur.actual = $('ed-actual').value.trim(); cur.nota = $('ed-nota').value.trim(); }

  let ok = true;
  const bad = (id) => { $(id).classList.add('show'); ok = false; };
  if (!cur.item) bad('err-ed-item');
  if (!(Number(cur.estimasi) > 0)) bad('err-ed-estimasi');
  if (hasNominal && !(Number(cur.nominal) > 0)) bad('err-ed-nominal');
  if (tf && o.tgltf && !cur.tgltf) bad('err-ed-tgltf');
  if (tf && o.pictrans && !cur.pictrans) { setMsg($('ed-msg'), 'PIC Transaksi tidak boleh dikosongkan.', 'err'); ok = false; }
  if (sel && !(Number(cur.actual) > 0)) bad('err-ed-actual');
  if (sel && cur.nota && !/^https?:\/\/\S+$/i.test(cur.nota)) bad('err-ed-nota');
  if (!ok) return;

  const map = { item: 'item', kategori: 'kategori', tipe: 'tipe', pic: 'pic', estimasi: 'estimasi', deadline: 'deadline',
    nominal: 'nominalTransfer', pictrans: 'picTransaksi', tgltf: 'tglTransfer', actual: 'actual', nota: 'nota' };
  const num = { estimasi: 1, nominal: 1, actual: 1 };
  const payload = { action: 'edit_kegiatan', row: row };
  let changed = 0;
  Object.keys(cur).forEach((k) => {
    if (String(cur[k]) === String(o[k])) return;
    payload[map[k]] = num[k] ? Number(cur[k]) : cur[k];
    changed++;
  });
  const photoEd = sel ? photos.ed : null;
  if (photoEd) {
    delete payload.nota;   // foto menggantikan link
    payload.photoBase64 = photoEd.base64;
    payload.photoMime = photoEd.mime;
    changed++;
  }
  if (!changed) { closeModal('m-edit'); toast('Tidak ada perubahan.'); return; }
  const pin = editPin();
  if (pin === null) return;
  if (pin) payload.pin = pin;

  const snap = snapshotForm($('editForm'));
  delete snap['ed-pin'];
  enqueueSave({
    label: 'Edit: ' + (o.item || 'kegiatan') + (photoEd ? ' (+ foto nota)' : ''), payload: payload, rows: [row], expectNota: !!photoEd,
    restore: () => { openEdit(row); restoreForm(snap); photos.ed = photoEd; showPhoto('ed'); }
  });
  closeModal('m-edit');
});

function cancelEditRow() {
  if (!editCancelAsk) {
    editCancelAsk = true;
    $('ed-alasan').style.display = '';
    $('ed-cancel-btn').textContent = 'Yakin batalkan? Klik lagi';
    $('ed-alasan').focus();
    return;
  }
  const pin = editPin();
  if (pin === null) return;
  const row = editRow;
  const nama = editOrig.item || 'kegiatan';
  const payload = { action: 'cancel_kegiatan', row: row, alasan: $('ed-alasan').value.trim() || null };
  if (pin) payload.pin = pin;
  enqueueSave({
    label: 'Batalkan: ' + nama, payload: payload, rows: [row],
    okMsg: 'Dibatalkan: ' + nama + '. Bisa dipulihkan lewat Edit.',
    restore: () => openEdit(row)
  });
  closeModal('m-edit');
}

function restoreEditRow() {
  const pin = editPin();
  if (pin === null) return;
  const row = editRow;
  const nama = editOrig.item || 'kegiatan';
  const payload = { action: 'restore_kegiatan', row: row };
  if (pin) payload.pin = pin;
  enqueueSave({
    label: 'Pulihkan: ' + nama, payload: payload, rows: [row],
    okMsg: 'Dipulihkan: ' + nama,
    restore: () => openEdit(row)
  });
  closeModal('m-edit');
}

// ---------- saringan "Selesai tapi belum ada nota" (dari kartu Sudah Cair) ----------
function setNoNota(on) {
  noNotaOnly = !!on;
  if (noNotaOnly) $('filterStatus').value = '';
  renderTable();
  if (noNotaOnly) $('tableKegiatan').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- popup: catat reimburse (talangan yang melebihi dana sudah diganti) ----------
let reimburseDana = null;   // { nama, row }

function openReimburse(nama) {
  const d = danaStats().find((x) => x.nama === nama);
  if (!d) return;
  reimburseDana = { nama: d.nama, row: d.row };
  $('reimburseForm').reset();
  clearErrors($('reimburseForm'));
  setMsg($('rb-msg'), '', '');
  $('rb-sub').textContent = 'Dana "' + d.nama + '" · ' + (d.saldo < 0 ? 'kurang ' + fmtDanaRp(-d.saldo) : 'saldo ' + fmtDanaRp(d.saldo)) +
    '. Isi berapa yang sudah diganti; saldo dana bertambah sebesar itu.';
  $('rb-nominal').value = d.saldo < 0 ? -d.saldo : '';
  $('rb-tgl').value = todayStr();
  openModal('m-reimburse');
}

$('reimburseForm').addEventListener('submit', (e) => {
  e.preventDefault();
  clearErrors($('reimburseForm'));
  const nominal = Number($('rb-nominal').value);
  if (!(nominal > 0)) { $('err-rb-nominal').classList.add('show'); return; }
  const snap = snapshotForm($('reimburseForm'));
  const target = reimburseDana;
  enqueueSave({
    label: 'Reimburse ' + fmtDanaRp(nominal) + ': ' + target.nama,
    payload: { action: 'reimburse_dana', row: target.row, nominal: nominal, tgl: $('rb-tgl').value || null,
      pic: $('rb-pic').value || null, catatan: $('rb-catatan').value.trim() || null },
    rows: [],
    okMsg: 'Reimburse ' + fmtDanaRp(nominal) + ' dicatat untuk dana "' + target.nama + '".',
    restore: () => { openReimburse(target.nama); restoreForm(snap); }
  });
  closeModal('m-reimburse');
});

// ---------- rekap: ringkasan per periode + unduh Excel ----------
// Kegiatan Dibatalkan tidak dihitung. Tanggal = Tanggal Dicatat (data lama = tanggal bayar).
function rekapRows(periode) {
  return kegiatanData.filter((r) => r['Status'] !== 'Dibatalkan' && (!periode || monthKey(r) === periode));
}

function rekapSum(rows) {
  const o = { n: rows.length, est: 0, act: 0, sel: 0, tanpaNota: 0, nAct: 0 };
  rows.forEach((r) => {
    const est = Number(r['Estimasi (Rp)']) || 0;
    const act = Number(r['Actual (Rp)']) || 0;
    o.est += est;
    if (act > 0) { o.act += act; o.sel += act - est; o.nAct++; }
    if (r['Status'] === 'Selesai' && !hasNota(r)) o.tanpaNota++;
  });
  return o;
}

function rekapGroup(rows, keyFn) {
  const map = new Map();
  rows.forEach((r) => {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  });
  return [...map.entries()].map(([k, list]) => Object.assign({ key: k }, rekapSum(list)));
}

function openRekap() {
  $('rk-periode').innerHTML = '<option value="">Semua waktu</option>' +
    monthOptions().map((k) => `<option value="${k}">${monthLabel(k)}</option>`).join('');
  $('rk-periode').value = $('filterPeriode').value;
  setMsg($('rk-msg'), '', '');
  renderRekap();
  openModal('m-rekap');
}

function renderRekap() {
  const periode = $('rk-periode').value;
  const rows = rekapRows(periode);
  const t = rekapSum(rows);
  $('rk-total').innerHTML =
    `<div><span>Kegiatan</span><b>${t.n}</b></div>
     <div><span>Total estimasi</span><b>${fmtDanaRp(t.est)}</b></div>
     <div><span>Total actual</span><b>${fmtDanaRp(t.act)}</b></div>
     <div><span>Selisih</span><b class="${t.sel > 0 ? 'minus' : ''}">${fmtDanaRp(t.sel)}</b></div>
     <div><span>Selesai tanpa nota</span><b>${t.tanpaNota}</b></div>`;
  const tbl = (groups, label) => groups.length
    ? groups.sort((a, b) => b.act - a.act || b.est - a.est).map((g) =>
      `<tr><td>${zEsc(g.key || label)}</td><td class="num">${g.n}</td><td class="num">${fmtDanaRp(g.est)}</td><td class="num">${fmtDanaRp(g.act)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">Tidak ada data.</td></tr>';
  $('rk-kategori').innerHTML = tbl(rekapGroup(rows, (r) => r['Kategori'] || ''), '(tanpa kategori)');
  $('rk-dana').innerHTML = tbl(rekapGroup(rows, (r) => r['Dana'] || ''), 'Transfer langsung (bukan dari dana)');
}

// SheetJS dimuat saat dibutuhkan saja (tidak memperlambat halaman).
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Gagal memuat pembuat Excel. Cek koneksi internet lalu coba lagi.'));
    document.head.appendChild(s);
  });
}

function xlDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : '';
}

// Lembar dari array 2D; kolom uang diberi format Rupiah, lebar kolom diatur.
function xlSheet(aoa, moneyCols, widths) {
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: 'dd-mmm-yy' });
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = range.s.r; r <= range.e.r; r++) {
    moneyCols.forEach((c) => {
      const cell = ws[XLSX.utils.encode_cell({ r: r, c: c })];
      if (cell && cell.t === 'n') cell.z = '"Rp"#,##0;-"Rp"#,##0';
    });
  }
  ws['!cols'] = widths.map((w) => ({ wch: w }));
  return ws;
}

async function downloadRekap() {
  const btn = $('rk-download');
  btn.disabled = true;
  btn.textContent = 'Menyiapkan…';
  setMsg($('rk-msg'), '', '');
  try {
    await loadXlsx();
    const periode = $('rk-periode').value;
    const label = periode ? monthLabel(periode) : 'Semua waktu';
    const rows = rekapRows(periode).slice().sort((a, b) =>
      String(a['Tanggal Dicatat'] || '').localeCompare(String(b['Tanggal Dicatat'] || '')) || a['_row'] - b['_row']);
    const t = rekapSum(rows);
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, xlSheet([
      ['Rekap Zerodeo — Budgeting'],
      ['Periode', label],
      ['Dibuat', new Date().toLocaleString('id-ID')],
      [],
      ['Jumlah kegiatan', t.n],
      ['Total estimasi', t.est],
      ['Total actual', t.act],
      ['Selisih (actual − estimasi, kegiatan yang sudah ada actual)', t.sel],
      ['Selesai tanpa nota', t.tanpaNota],
      [],
      ['Catatan: kegiatan Dibatalkan tidak dihitung. Tanggal = Tanggal Dicatat (data lama = tanggal bayar).']
    ], [1], [48, 22]), 'Ringkasan');

    const bulan = rekapGroup(rows, monthKey).sort((a, b) => a.key.localeCompare(b.key));
    XLSX.utils.book_append_sheet(wb, xlSheet(
      [['Bulan', 'Jumlah kegiatan', 'Estimasi', 'Actual', 'Selisih', 'Selesai tanpa nota']]
        .concat(bulan.map((g) => [monthLabel(g.key), g.n, g.est, g.act, g.sel, g.tanpaNota]))
        .concat([['TOTAL', t.n, t.est, t.act, t.sel, t.tanpaNota]]),
      [2, 3, 4], [16, 16, 16, 16, 16, 18]), 'Per Bulan');

    const kat = rekapGroup(rows, (r) => r['Kategori'] || '(tanpa kategori)').sort((a, b) => b.act - a.act || b.est - a.est);
    XLSX.utils.book_append_sheet(wb, xlSheet(
      [['Kategori', 'Jumlah kegiatan', 'Estimasi', 'Actual', 'Selisih']]
        .concat(kat.map((g) => [g.key, g.n, g.est, g.act, g.sel]))
        .concat([['TOTAL', t.n, t.est, t.act, t.sel]]),
      [2, 3, 4], [28, 16, 16, 16, 16]), 'Per Kategori');

    const posisi = {};
    danaStats().forEach((d) => { posisi[d.nama] = d; });
    const dn = rekapGroup(rows, (r) => r['Dana'] || '').sort((a, b) => b.act - a.act);
    XLSX.utils.book_append_sheet(wb, xlSheet(
      [['Dana', 'Kegiatan (periode)', 'Estimasi (periode)', 'Actual (periode)', 'Nominal dana', 'Reimburse', 'Terpakai (total)', 'Saldo saat ini']]
        .concat(dn.map((g) => {
          const d = posisi[g.key];
          return [g.key || 'Transfer langsung (bukan dari dana)', g.n, g.est, g.act,
            d ? d.nominal : '', d ? d.reimburse : '', d ? d.terpakai : '', d ? d.saldo : ''];
        })),
      [2, 3, 4, 5, 6, 7], [32, 16, 18, 16, 16, 14, 16, 16]), 'Per Dana');

    XLSX.utils.book_append_sheet(wb, xlSheet(
      [['Tgl dicatat', 'Item', 'Kategori', 'Tipe', 'PIC', 'Status', 'Jalur', 'Dana', 'Estimasi', 'Nominal transfer',
        'Actual', 'Selisih', 'Tgl transfer', 'Nota', 'Catatan']]
        .concat(rows.map((r) => {
          const act = Number(r['Actual (Rp)']) || 0;
          const est = Number(r['Estimasi (Rp)']) || 0;
          return [xlDate(r['Tanggal Dicatat']), r['Item Kegiatan'] || '', r['Kategori'] || '', r['Tipe'] || '', r['PIC'] || '',
            r['Status'] || '', r['Jalur'] || '', r['Dana'] || '', est, Number(r['Nominal Transfer (Rp)']) || '',
            act || '', act ? act - est : '', xlDate(r['Tgl Transfer']), hasNota(r) ? r['Nota/Bukti'] : '', r['Catatan'] || ''];
        })),
      [8, 9, 10, 11], [11, 34, 22, 8, 10, 11, 10, 22, 14, 15, 14, 13, 11, 40, 40]), 'Detail');
    // link nota bisa diklik di Excel
    const det = wb.Sheets['Detail'];
    rows.forEach((r, i) => {
      if (!hasNota(r)) return;
      const cell = det[XLSX.utils.encode_cell({ r: i + 1, c: 13 })];
      if (cell) { cell.l = { Target: r['Nota/Bukti'] }; cell.v = 'Buka nota'; }
    });

    XLSX.writeFile(wb, 'Rekap Zerodeo - ' + label + '.xlsx');
    setMsg($('rk-msg'), 'File Excel diunduh.', 'ok');
  } catch (err) {
    setMsg($('rk-msg'), err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Unduh Excel';
  }
}
