// Kerangka halaman: helper bersama, tab/routing, popup, dan pemuatan data.
// Urutan script di index.html: common.js, app.js, tracker.js, marketing.js, lalu boot().

const $ = (id) => document.getElementById(id);
const PIC_LIST = ['Lenno', 'Ricko', 'Yanuar', 'Christina'];
const TIPE_LIST = ['Capex', 'Opex'];

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
async function load() {
  setSync('Memuat…', false);
  try {
    const json = await zApi.get();
    if (json.ok === false) throw new Error(json.error || 'Gagal');
    kegiatanData = json.kegiatan || [];
    plafonData = json.plafon_fixed || [];
    backendBaru = Array.isArray(json.kategori);
    backendDana = Array.isArray(json.dana);
    danaList = backendDana ? json.dana : [];
    kategoriList = (json.kategori && json.kategori.length) ? json.kategori : KATEGORI_DEFAULT.slice();
    M = {
      ada: 'strategi' in json,
      strategi: json.strategi || [], lane: json.lane || [],
      channel: json.channel || [], hasil_event: json.hasil_event || []
    };
    setSync('Terakhir ambil data: ' + new Date().toLocaleString('id-ID'), false);
    renderTracker();
    renderMarketing();
  } catch (err) {
    setSync('Gagal ambil data: ' + err.message + ' — cek kode akses tim & konfigurasi proxy di Vercel.', true);
    showLoadError();
  } finally {
    dataLoaded = true;
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
