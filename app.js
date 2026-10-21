// Kerangka halaman: helper bersama, tab/routing, popup, dan pemuatan data.
// Urutan script di index.html: common.js, app.js, tracker.js, marketing.js, lalu boot().

const $ = (id) => document.getElementById(id);
// Daftar anggota (dari tab Tim di Sheet, disinkron dari Hub). PIC disimpan sebagai ID dan ditampilkan sebagai nama.
// Isi awal ini hanya cadangan sebelum data pertama dimuat.
let TIM = [{ id: 'lenno', nama: 'Lenno', peran: '' }, { id: 'ricko', nama: 'Ricko', peran: '' },
  { id: 'yanuar', nama: 'Yanuar', peran: '' }, { id: 'christina', nama: 'Christina', peran: '' }];

// Nilai PIC (ID atau nama lama, huruf besar/kecil bebas) -> ID. Yang tidak dikenal dikembalikan apa adanya.
function picKey(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  const low = s.toLowerCase();
  const t = TIM.find((x) => x.id === low || x.nama.toLowerCase() === low);
  return t ? t.id : s;
}
// ID (atau nama lama) -> nama untuk tampilan.
function picNama(v) {
  if (v === null || v === undefined || v === '') return '';
  return String(v).split(',').map((p) => {
    const t = TIM.find((x) => x.id === picKey(p));
    return t ? t.nama : p.trim();
  }).join(', ');
}
function picOptionsHtml() {
  return TIM.map((t) => `<option value="${zEsc(t.id)}">${zEsc(t.nama)}</option>`).join('');
}
// Isi ulang semua pilihan PIC (select[data-pic]); pilihan kosong/placeholder di atas dipertahankan.
function fillPicSelects() {
  document.querySelectorAll('select[data-pic]').forEach((sel) => {
    const keep = sel.value;
    const placeholders = [...sel.options].filter((o) => o.value === '').map((o) => o.outerHTML).join('');
    sel.innerHTML = placeholders + picOptionsHtml();
    if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
  });
}

// Peran pengguna ini dari token Hub (hanya untuk tampilan; server yang memutuskan). null = tanpa identitas.
function myRole() { const c = zApi.me(); return c ? c.peran : null; }
function myUid() { const c = zApi.me(); return c ? c.uid : null; }
// Tanda siapa yang sedang masuk (pojok kanan atas). Hanya tampilan; yang berwenang tetap server.
function renderWho() {
  const el = $('whoami');
  if (!el) return;
  const c = zApi.me();
  el.textContent = '';
  if (!c) {
    const s = document.createElement('span');
    s.className = 'who-off';
    s.textContent = 'Belum masuk lewat Hub';
    el.appendChild(s);
    return;
  }
  const s = document.createElement('span');
  s.className = 'who-name';
  s.textContent = picNama(c.uid) + ' · ' + c.peran;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ghost who-out';
  b.textContent = '← Hub';
  b.onclick = () => { location.href = zApi.hubUrl; };   // kembali ke Hub saja; logout hanya di Hub
  if (c.ha) {   // hanya admin Hub
    const k = document.createElement('button');
    k.type = 'button';
    k.className = 'btn ghost who-out';
    k.textContent = 'Kelola Tim';
    k.onclick = () => { location.href = zApi.hubUrl + '/tim/'; };
    el.append(s, k, b);
  } else el.append(s, b);
}
// Peran marketing (videografer, vendor): hanya melihat modul Marketing, tanpa tab Budgeting.
function isMarketingOnly() { return myRole() === 'marketing'; }
function applyRoleView() {
  const tab = document.querySelector('.tab[data-main="tracker"]');
  if (tab) tab.style.display = isMarketingOnly() ? 'none' : '';
}
function isDecider() { const r = myRole(); return r === 'approver' || r === 'admin'; }
function isOwnRow(r) { const me = myUid(); return !!me && String(r['PIC'] || '').split(',').some((p) => picKey(p).toLowerCase() === me); }
const TIPE_LIST = ['Capex', 'Opex'];
// Harus sama dengan KODE_VERSI di Code.gs. Kalau Apps Script yang melayani berbeda, muncul peringatan.
const EXPECTED_VERSI = '2026-10-18 aturan-peran-2';

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
  job.noRetry = /hanya approver|tidak boleh|Masuk lewat Hub/i.test(msg);   // ditolak karena peran/identitas: kirim ulang percuma
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
  if (isMarketingOnly() && view === 'tracker') view = lastMktView;
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
// Memasang data ke seluruh tampilan. Dipakai untuk data tersimpan (langsung tampil) dan data baru dari server.
function applyPayload(json) {
  if (Array.isArray(json.tim) && json.tim.length) TIM = json.tim;
  fillPicSelects();
  renderWho();
  applyRoleView();
  if (isMarketingOnly()) showView(lastMktView);
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
  renderTracker();
  renderMarketing();
}

// fresh = true: ambil langsung dari Sheet, lewati cache Apps Script (tombol Refresh).
// Pemuatan biasa: kalau ada data tersimpan di perangkat ini, tampilkan dulu, lalu segarkan di latar.
// Layar logo (index.html): hilang dengan fade setelah data pertama datang (atau gagal), minimal 0,6 detik supaya tidak berkedip.
function hideSplash() {
  const sp = document.getElementById('splash');
  if (!sp) return;
  clearTimeout(window.__splashMax);
  setTimeout(() => { sp.classList.add('hide'); setTimeout(() => sp.remove(), 500); }, Math.max(0, 600 - performance.now()));
}
window.__splashMax = setTimeout(hideSplash, 20000);   // jaga-jaga: jangan menutupi halaman lebih dari 20 detik

async function load(fresh) {
  loadingNow = true;
  renderWho();
  let cached = null;
  if (fresh !== true && !dataLoaded) {
    cached = zApi.cacheRead();
    if (cached) {
      try {
        applyPayload(cached.json);
        setSync('Menampilkan data tersimpan (' + new Date(cached.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + '), memperbarui…', false);
      } catch (e) { cached = null; }
    }
  }
  if (!cached) setSync('Memuat…', false);
  try {
    const json = await zApi.get(fresh === true);
    if (json.ok === false) throw new Error(json.error || 'Gagal');
    applyPayload(json);
    zApi.cacheWrite(json);
    setSync('Terakhir ambil data: ' + new Date().toLocaleString('id-ID') + ' · Apps Script: ' + backendVersi, false);
  } catch (err) {
    if (/Masuk lewat Hub/.test(err.message)) {
      setSync('Belum masuk lewat Hub.', false);   // layar "Masuk lewat Hub" sudah menjelaskan; tidak perlu toast galat
      if (cached) showLoadError();
    } else if (cached) {
      setSync('Gagal memperbarui (' + err.message + '). Data di layar dari ' + new Date(cached.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' — tekan Refresh untuk mencoba lagi.', true);
    } else {
      setSync('Gagal ambil data: ' + err.message + ' — cek login Hub & konfigurasi proxy (Cloudflare atau Vercel).', true);
      toast('Gagal memuat data. Tekan Refresh.', 'err');
      showLoadError();
    }
    if (!cached && /Masuk lewat Hub/.test(err.message)) showLoadError();
  } finally {
    dataLoaded = true;
    loadingNow = false;
    hideSplash();
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
