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
  fillKategori();
  if ($('m-urgent').classList.contains('show')) renderUrgentList();
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
}

// ---------- urgent: sudah di-approve, belum ditransfer ----------
function deadlineKey(r) { return r['Deadline Kegiatan'] || '9999-12-31'; }

function urgentItems() {
  return kegiatanData
    .filter((r) => r['Status'] === 'Approved')
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
      <td><button class="aksi-btn approve" onclick="openTransferModal(${Number(r['_row'])})">Tandai Ditransfer</button></td>
    </tr>`;
  }).join('');
}

function openUrgent() {
  if (urgentItems().length === 0) return;
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
  const sudahCair = kegiatanData.filter((r) => r['Nominal Transfer (Rp)'] !== null && r['Nominal Transfer (Rp)'] !== '' && r['Nominal Transfer (Rp)'] !== undefined);
  const diterima = sudahCair.reduce((sum, r) => sum + (Number(r['Nominal Transfer (Rp)']) || 0), 0);
  const actualDariItu = sudahCair.reduce((sum, r) => sum + (Number(r['Actual (Rp)']) || 0), 0);
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

function renderTable() {
  const kat = $('filterKategori').value;
  const tipe = $('filterTipe').value;
  const pic = $('filterPic').value;
  const status = $('filterStatus').value;
  const search = $('searchBox').value.trim().toLowerCase();

  const rows = kegiatanData.filter((r) => {
    if (kat && r['Kategori'] !== kat) return false;
    if (tipe && r['Tipe'] !== tipe) return false;
    if (pic && r['PIC'] !== pic) return false;
    if (status && r['Status'] !== status) return false;
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
    } else if (r['Status'] !== 'Selesai' && (r['Jalur'] === 'Fixed' || r['Status'] === 'Approved')) {
      aksi = `<button class="aksi-btn approve" onclick="openTransferModal(${rowNo})">Tandai Ditransfer</button>`;
    }
    return `<tr>
      <td class="item">${zEsc(r['Item Kegiatan'] || '-')}</td>
      <td>${zEsc(r['Kategori'] || '-')}</td>
      <td>${zEsc(r['Tipe'] || '-')}</td>
      <td>${zEsc(r['PIC'] || '-')}</td>
      <td><span class="badge ${statusClass}">${zEsc(r['Status'] || 'Draft')}</span></td>
      <td class="${deadlineSoon ? 'deadline-soon' : ''}">${zEsc(fmtDate(r['Deadline Kegiatan']))}</td>
      <td class="num">${fmtRupiah(r['Estimasi (Rp)'])}</td>
      <td class="num">${fmtRupiah(r['Actual (Rp)'])}</td>
      <td class="num">${fmtRupiah(r['Selisih (Rp)'])}</td>
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
      closeTransferModal();
      load();
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

// ---------- popup: input kegiatan baru ----------
// Isi pilihan kategori dari daftar di Sheet. Pilihan yang sedang dipilih dipertahankan.
function fillKategori() {
  const cur = $('k-kategori').value;
  $('k-kategori').innerHTML = '<option value="">Pilih kategori…</option>' +
    kategoriList.map((k) => `<option value="${zEsc(k)}">${zEsc(k)}</option>`).join('');
  if (kategoriList.indexOf(cur) !== -1) $('k-kategori').value = cur;
}

// Mode "Data lama": kegiatan yang sudah selesai sebelum dashboard dipakai.
function toggleArsip() {
  const on = $('k-arsip').checked;
  $('k-arsip-box').style.display = on ? 'flex' : 'none';
  $('k-status-wrap').style.display = on ? 'none' : '';
  $('k-est-opt').style.display = on ? 'inline' : 'none';
}
$('k-arsip').addEventListener('change', toggleArsip);

function openKegiatan() {
  $('kegiatanForm').reset();
  clearErrors($('kegiatanForm'));
  setMsg($('k-msg'), '', '');
  fillKategori();
  $('k-arsip').closest('label').style.display = backendBaru ? '' : 'none';
  toggleArsip();
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
  need('jalur', !$('k-jalur').value);
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

$('kegiatanForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg($('k-msg'), '', '');
  if (!validateKegiatan()) return;

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

  const btn = $('k-submit');
  btn.disabled = true;
  btn.textContent = 'Menyimpan…';
  try {
    const json = await zApi.post(payload);
    if (json.ok) {
      setMsg($('k-msg'), 'Tersimpan sebagai baris ke-' + json.row + (arsip ? ' (data lama, berstatus Selesai)' : '') + '. Form dikosongkan buat input berikutnya.', 'ok');
      $('kegiatanForm').reset();
      toggleArsip();
      load();
    } else {
      setMsg($('k-msg'), 'Gagal simpan: ' + (json.error || 'error tidak diketahui.'), 'err');
    }
  } catch (err) {
    setMsg($('k-msg'), 'Gagal kirim: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Simpan kegiatan';
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
      $('completeForm').style.display = 'none';
      setMsg($('c-msg-done'), 'Tersimpan. Kegiatan ditandai Selesai.', 'ok');
      $('c-close-row').style.display = 'flex';
      load();
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
