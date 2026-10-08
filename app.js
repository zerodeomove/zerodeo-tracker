// Kerangka halaman: helper bersama, tab/routing, popup, dan pemuatan data.
// Urutan script di index.html: common.js, app.js, tracker.js, marketing.js, lalu boot().

const $ = (id) => document.getElementById(id);
const PIC_LIST = ['Lenno', 'Ricko', 'Yanuar', 'Christina'];
const TIPE_LIST = ['Capex', 'Opex'];
// Harus sama dengan KODE_VERSI di Code.gs. Kalau Apps Script yang melayani berbeda, muncul peringatan.
const EXPECTED_VERSI = '2026-10-08 rekap-reimburse';

function fmtRupiah(n) {
  if (n === null || n === undefined || n === '' || isNaN(n)) return '-';
  const num = Number(n);
  if (num === 0) return '-';
  return (num < 0 ? '-Rp' : 'Rp') + Math.abs(Math.round(num)).toLocaleString('id-ID');
}

function fmtDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' });
}

function daysUntil(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  dt.setHours(0, 0, 0, 0);
  return Math.round((dt - today) / 86400000);
}

// Tanggal hari ini menurut jam perangkat (yyyy-mm-dd), bukan UTC.
function todayStr() {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function setSync(msg, isErr) {
  const el = $('lastSync');
  el.textContent = msg;
  el.style.color = isErr ? 'var(--red)' : '';
}

function setMsg(el, text, kind) {
  el.textContent = text;
  el.className = 'msg' + (kind ? ' ' + kind : '');
}

function clearErrors(root) {
  root.querySelectorAll('.field-error').forEach((x) => x.classList.remove('show'));
}

// Notifikasi kecil di bawah layar (hilang sendiri). Dipakai setelah simpan, karena popup ditutup.
let toastTimer = null;
function toast(msg, kind) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show' + (kind === 'err' ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'err' ? 6000 : 4000);
}


// ---------- antrean simpan di background ----------
// Semua simpan (kecuali popup sekaligus/batch) masuk antrean: popup langsung menutup, simpan jalan
// berurutan di belakang, dan statusnya tampil di bar tipis di atas layar. Kalau gagal, bar
// menawarkan "Coba lagi" (kirim ulang isi yang sama) atau "Ubah" (buka lagi popup dengan isian semula).
// job = { label, payload, rows: [nomor baris yang sedang disimpan], restore: fn|null, okMsg: string|null }
const saveJobs = [];
let saveSeq = 0;
let saveRunning = false;

function enqueueSave(job) {
  job.id = ++saveSeq;
  job.state = 'queued';
  job.error = '';
  job.reloaded = false;
  job.rows = job.rows || [];
  saveJobs.push(job);
  renderSaveBar();
  runSaveQueue();
}

function failSave(job, msg) {
  job.state = 'err';
  job.error = msg;
  job.noRetry = /PIN/i.test(msg);          // PIN salah: kirim ulang percuma, harus diubah
  if (job.payload.pin) cachedPin = null;
}

async function runSaveQueue() {
  if (saveRunning) return;
  saveRunning = true;
  try {
    let job;
    while ((job = saveJobs.find((j) => j.state === 'queued'))) {
      job.state = 'running';
      renderSaveBar();
      try {
        const json = await zApi.post(job.payload);
        if (json.ok) {
          job.state = 'ok';
          if (job.payload.pin) cachedPin = job.payload.pin;
          if (job.expectNota && !json.nota) {
            // Server menjawab sukses tapi tidak mengunggah file: Apps Script kemungkinan belum versi terbaru.
            failSave(job, 'Server menjawab sukses tapi file nota tidak terunggah. Pastikan Apps Script sudah versi terbaru (Deploy → New version). Info server: ' + (json.foto || 'tidak ada (kemungkinan Apps Script versi lama)'));
            renderSaveBar();
            continue;
          }
          if (/^https:\/\/(drive|docs)\.google\.com\//.test(json.nota || '')) job.notaUrl = json.nota;
          if (job.okMsg) toast(job.okMsg);
        } else {
          failSave(job, json.error || 'Gagal menyimpan.');
        }
      } catch (err) {
        failSave(job, 'Gagal kirim: ' + err.message);
      }
      renderSaveBar();
    }
  } finally {
    saveRunning = false;
  }
  // satu kali muat ulang setelah antrean habis
  const done = saveJobs.filter((j) => j.state === 'ok' && !j.reloaded);
  if (done.length) {
    await load();
    done.forEach((j) => { j.reloaded = true; });
    renderSaveBar();
    if (typeof renderTracker === 'function' && dataLoaded) renderTracker();
    setTimeout(() => {
      done.forEach((j) => { const i = saveJobs.indexOf(j); if (i !== -1) saveJobs.splice(i, 1); });
      renderSaveBar();
    }, 2500);
  }
}

function retrySave(id) {
  const job = saveJobs.find((j) => j.id === id);
  if (!job || job.state !== 'err') return;
  job.state = 'queued';
  job.error = '';
  renderSaveBar();
  runSaveQueue();
}

function editFailedSave(id) {
  const i = saveJobs.findIndex((j) => j.id === id);
  if (i === -1 || !saveJobs[i].restore) return;
  if (document.querySelector('.modal-overlay.show')) { toast('Tutup popup yang sedang terbuka dulu, lalu klik Ubah.', 'err'); return; }
  const job = saveJobs.splice(i, 1)[0];
  renderSaveBar();
  renderTracker();
  job.restore();
}

function dismissSave(id) {
  const i = saveJobs.findIndex((j) => j.id === id);
  if (i !== -1) saveJobs.splice(i, 1);
  renderSaveBar();
  renderTracker();
}

// Nomor baris yang sedang disimpan (atau sudah tersimpan tapi data belum dimuat ulang).
function pendingRows() {
  const s = new Set();
  saveJobs.forEach((j) => {
    if (j.state === 'queued' || j.state === 'running' || (j.state === 'ok' && !j.reloaded)) j.rows.forEach((r) => s.add(Number(r)));
  });
  return s;
}

function renderSaveBar() {
  if (dataLoaded && typeof renderTable === 'function') renderTable();   // baris yang sedang disimpan tampil "menyimpan…"
  const bar = $('saveBar');
  document.body.classList.toggle('savebar-on', saveJobs.length > 0);
  bar.innerHTML = saveJobs.map((j) => {
    const l = zEsc(j.label);
    if (j.state === 'running') return `<div class="sb-item run"><span class="spin"></span>Menyimpan: ${l}…</div>`;
    if (j.state === 'queued') return `<div class="sb-item wait">Antre: ${l}</div>`;
    if (j.state === 'ok') return `<div class="sb-item ok">✓ Tersimpan: ${l}` + (j.notaUrl ? ` <a class="sb-link" href="${zEsc(j.notaUrl)}" target="_blank" rel="noopener noreferrer">Buka nota</a>` : '') + '</div>';
    return `<div class="sb-item err"><span class="sb-text">Gagal: ${l} — ${zEsc(j.error)}</span>` +
      (j.noRetry ? '' : `<button onclick="retrySave(${j.id})">Coba lagi</button>`) +
      (j.restore ? `<button onclick="editFailedSave(${j.id})">Ubah</button>` : '') +
      `<button class="sb-x" title="Buang" onclick="dismissSave(${j.id})">×</button></div>`;
  }).join('');
}

window.addEventListener('beforeunload', (e) => {
  if (saveJobs.some((j) => j.state !== 'ok')) { e.preventDefault(); e.returnValue = ''; }
});

// Salin semua isian form (by id) supaya bisa dipulihkan lewat "Ubah" saat simpan gagal.
function snapshotForm(form) {
  const snap = {};
  form.querySelectorAll('input, select, textarea').forEach((el) => {
    if (!el.id || el.type === 'file') return;
    snap[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  return snap;
}

function restoreForm(snap) {
  Object.keys(snap).forEach((id) => {
    const el = $(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = snap[id]; else el.value = snap[id];
  });
}

// ---------- popup ----------
function openModal(id) {
  $(id).classList.add('show');
  document.body.classList.add('no-scroll');
}

function closeModal(id) {
  $(id).classList.remove('show');
  if (!document.querySelector('.modal-overlay.show')) document.body.classList.remove('no-scroll');
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = Array.from(document.querySelectorAll('.modal-overlay.show')).pop();
  if (open) closeModal(open.id);
});

// ---------- tab ----------
// view: 'tracker' | 'strategi' | 'event'. Marketing = strategi + event.
const MKT_VIEWS = ['strategi', 'event'];
let lastMktView = 'strategi';

function showView(view) {
  if (view !== 'tracker' && MKT_VIEWS.indexOf(view) === -1) view = 'tracker';
  const isMkt = view !== 'tracker';
  if (isMkt) lastMktView = view;
  $('panel-tracker').classList.toggle('on', !isMkt);
  $('panel-marketing').classList.toggle('on', isMkt);
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.main === (isMkt ? 'marketing' : 'tracker')));
  document.querySelectorAll('.subtab').forEach((t) => t.classList.toggle('on', t.dataset.view === view));
  $('view-strategi').style.display = view === 'strategi' ? '' : 'none';
  $('view-event').style.display = view === 'event' ? '' : 'none';
  history.replaceState(null, '', '#' + view);
}

// Alamat lama (input.html dll) diarahkan ke sini dengan hash aksi:
// #tambah-kegiatan, #tambah-strategi, #tambah-event, #lengkapi=<baris>.
let dataLoaded = false;
let pending = null;

function runPending() {
  if (pending && dataLoaded) { const f = pending; pending = null; f(); }
}

function whenLoaded(fn) {
  pending = fn;
  runPending();
}

function route() {
  const h = decodeURIComponent((location.hash || '').replace(/^#/, ''));
  const m = /^lengkapi=(\d+)$/.exec(h);
  if (h === 'tambah-kegiatan') { showView('tracker'); whenLoaded(openKegiatan); }
  else if (h === 'tambah-strategi') { showView('strategi'); whenLoaded(openStrategi); }
  else if (h === 'tambah-event') { showView('event'); whenLoaded(openEvent); }
  else if (m) { showView('tracker'); const row = Number(m[1]); whenLoaded(() => openComplete(row)); }
  else showView(h);
}

window.addEventListener('hashchange', route);

// ---------- muat data (sekali untuk tracker + marketing) ----------
// Muat ulang otomatis saat kembali ke tab dashboard (data dari orang lain ikut terlihat),
// kalau terakhir dimuat lebih dari 30 detik lalu dan tidak sedang mengisi popup / menyimpan.
let lastLoadAt = 0;
let loadingNow = false;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !dataLoaded || loadingNow) return;
  if (Date.now() - lastLoadAt < 30000) return;
  if (document.querySelector('.modal-overlay.show')) return;
  if (saveJobs.some((j) => j.state === 'queued' || j.state === 'running')) return;
  load();
});

// fresh = true: ambil langsung dari Sheet, lewati cache Apps Script (tombol Refresh).
async function load(fresh) {
  loadingNow = true;
  setSync('Memuat…', false);
  try {
    const json = await zApi.get(fresh === true);
    if (json.ok === false) throw new Error(json.error || 'Gagal');
    kegiatanData = json.kegiatan || [];
    plafonData = json.plafon_fixed || [];
    backendBaru = Array.isArray(json.kategori);
    backendDana = Array.isArray(json.dana);
    backendEdit = json.edit === true;
    backendFoto = json.fotoNota === true;
    backendReimburse = json.reimburse === true;
    backendFotoBatch = json.fotoBatch === true;
    lastLoadAt = Date.now();
    backendVersi = json.versi || 'lama';
    const vb = $('versiBanner');
    if (backendVersi !== EXPECTED_VERSI) {
      vb.style.display = '';
      vb.textContent = 'Apps Script yang melayani dashboard ini versi "' + backendVersi + '", seharusnya "' + EXPECTED_VERSI + '". Fitur baru (misalnya upload nota) belum jalan. Di Apps Script: Deploy → Manage deployments → ikon pensil → di Version pilih "New version" (bukan Version yang lama) → Deploy.';
    } else {
      vb.style.display = 'none';
    }
    danaList = backendDana ? json.dana : [];
    kategoriList = (json.kategori && json.kategori.length) ? json.kategori : KATEGORI_DEFAULT.slice();
    M = {
      ada: 'strategi' in json,
      strategi: json.strategi || [], lane: json.lane || [],
      channel: json.channel || [], hasil_event: json.hasil_event || []
    };
    setSync('Terakhir ambil data: ' + new Date().toLocaleString('id-ID') + ' · Apps Script: ' + backendVersi, false);
    renderTracker();
    renderMarketing();
  } catch (err) {
    setSync('Gagal ambil data: ' + err.message + ' — cek kode akses tim & konfigurasi proxy di Vercel.', true);
    toast('Gagal memuat data. Tekan Refresh.', 'err');
    showLoadError();
  } finally {
    dataLoaded = true;
    loadingNow = false;
    runPending();
  }
}

function showLoadError() {
  $('tableBody').innerHTML = '<tr><td colspan="10" class="empty-state">Data belum bisa dimuat.</td></tr>';
  $('bodyS').innerHTML = '<tr><td colspan="6" class="empty">Data belum bisa dimuat.</td></tr>';
  $('bodySum').innerHTML = '<tr><td colspan="8" class="empty">Data belum bisa dimuat.</td></tr>';
  $('bodyE').innerHTML = '<tr><td colspan="10" class="empty">Data belum bisa dimuat.</td></tr>';
}

function boot() {
  route();
  load();
}
