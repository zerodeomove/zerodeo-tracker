// Tab Marketing: strategi + hasil event, beserta popup input masing-masing.

const MKT_STATUS = ['Ide', 'Jalan', 'Selesai'];
const MKT_RANK = { Jalan: 0, Ide: 1, Selesai: 2 };
let M = { ada: false, strategi: [], lane: [], channel: [], hasil_event: [] };

function splitList(s) { return s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : []; }

function mktDate(s) {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return zEsc(s);
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' });
}

// Kalau Apps Script belum punya modul marketing, aksi marketing akan jatuh ke
// handler kegiatan dan membuat baris sampah. Jadi popup/aksi ditahan dulu.
function mktReady() {
  if (M.ada) return true;
  alert('Modul marketing belum aktif di Apps Script (hook di Code.gs belum dipasang atau belum Deploy -> New version).');
  return false;
}

// ---------- render ----------
function renderMarketing() {
  const note = $('mktNote');
  if (M.ada) {
    note.style.display = 'none';
  } else {
    note.textContent = 'Apps Script belum punya modul marketing (hook di Code.gs belum dipasang atau belum redeploy).';
    note.style.display = 'block';
  }
  fillMktFilters();
  renderStrategi();
  renderEvents();
}

function fillMktFilters() {
  const fill = (id, all, list) => {
    const cur = $(id).value;
    $(id).innerHTML = '<option value="">' + all + '</option>' + list.map((x) => '<option>' + zEsc(x) + '</option>').join('');
    if (list.indexOf(cur) !== -1) $(id).value = cur;
  };
  fill('fLane', 'Semua Lane', M.lane);
  fill('fChannel', 'Semua Channel', M.channel);
}

function renderStrategi() {
  const fl = $('fLane').value, fc = $('fChannel').value, fs = $('fStatus').value;
  const q = $('fSearch').value.trim().toLowerCase();
  const rows = M.strategi.filter((r) => {
    if (fl && splitList(r.Lane).indexOf(fl) === -1) return false;
    if (fc && splitList(r.Channel).indexOf(fc) === -1) return false;
    if (fs && r.Status !== fs) return false;
    if (q && !((r['Nama Strategi'] || '') + ' ' + (r['Pesan Inti'] || '')).toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (MKT_RANK[a.Status] - MKT_RANK[b.Status]) || String(a.Mulai || '').localeCompare(String(b.Mulai || '')));

  $('countS').textContent = rows.length + ' strategi';
  if (!rows.length) { $('bodyS').innerHTML = '<tr><td colspan="6" class="empty">Belum ada strategi yang cocok.</td></tr>'; return; }
  $('bodyS').innerHTML = rows.map((r) => `<tr>
    <td style="max-width:300px"><b>${zEsc(r['Nama Strategi'])}</b><div class="sub">${zEsc(r['Pesan Inti'])}</div></td>
    <td>${splitList(r.Lane).map((x) => `<span class="pill">${zEsc(x)}</span>`).join('')}</td>
    <td>${splitList(r.Channel).map((x) => `<span class="pill alt">${zEsc(x)}</span>`).join('')}</td>
    <td style="white-space:nowrap">${mktDate(r.Mulai)}${r.Selesai ? ' – ' + mktDate(r.Selesai) : ' →'}</td>
    <td>${zEsc(r.PIC)}</td>
    <td><select data-id="${zEsc(r.ID)}" onchange="setStrategiStatus(this.dataset.id, this.value)">${MKT_STATUS.map((s) => `<option ${s === r.Status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
  </tr>`).join('');
}

async function setStrategiStatus(id, status) {
  try {
    const j = await zApi.post({ action: 'update_strategi_status', id: id, status: status });
    if (!j.ok) throw new Error(j.error || 'Gagal');
    load();
  } catch (e) {
    alert('Gagal ubah status: ' + e.message);
    load();
  }
}

function renderEvents() {
  const ev = M.hasil_event;
  if (!ev.length) {
    $('bodySum').innerHTML = '<tr><td colspan="8" class="empty">Belum ada hasil event.</td></tr>';
    $('bodyE').innerHTML = '<tr><td colspan="10" class="empty">Belum ada hasil event.</td></tr>';
    return;
  }
  const g = {};
  ev.forEach((e) => {
    const k = e.Channel || '(tanpa channel)';
    const a = g[k] || (g[k] = { n: 0, h: 0, c: 0, t: 0, o: 0, u: 0 });
    a.n++; a.h += +e.Hadir || 0; a.c += +e['Coba Produk'] || 0;
    a.t += +e['Tanya Beli Di Mana'] || 0; a.o += +e['Order via Kode'] || 0; a.u += +e['Konten UGC'] || 0;
  });
  $('bodySum').innerHTML = Object.keys(g).sort((x, y) => g[y].o - g[x].o).map((k) => {
    const a = g[k];
    return `<tr><td><b>${zEsc(k)}</b></td><td class="num">${a.n}</td><td class="num">${a.h}</td><td class="num">${a.c}</td>
      <td class="num">${a.t}</td><td class="num">${a.o}</td><td class="num">${a.u}</td>
      <td class="num">${a.h ? (a.o / a.h * 100).toFixed(1) + '%' : '-'}</td></tr>`;
  }).join('');

  $('bodyE').innerHTML = ev.slice().sort((a, b) => String(b['Tanggal Event'] || '').localeCompare(String(a['Tanggal Event'] || ''))).map((e) => `<tr>
    <td style="white-space:nowrap">${mktDate(e['Tanggal Event'])}</td><td>${zEsc(e['Nama Event'])}</td><td>${zEsc(e.Channel)}</td>
    <td>${zEsc(e['Nama Komunitas'])}</td><td>${zEsc(e['Kode Voucher'])}</td>
    <td class="num">${+e.Hadir || 0}</td><td class="num">${+e['Coba Produk'] || 0}</td>
    <td class="num">${+e['Tanya Beli Di Mana'] || 0}</td><td class="num">${+e['Order via Kode'] || 0}</td>
    <td class="num">${+e['Konten UGC'] || 0}</td></tr>`).join('');
}

// ---------- popup: strategi baru ----------
const sOpts = { lane: [], channel: [] };
const sSel = { lane: new Set(), channel: new Set() };

function cleanLabel(s) { return String(s || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); }

function renderChips(kind) {
  $('s-' + kind + 'Chips').innerHTML = sOpts[kind].map((o, i) =>
    `<label class="chip ${sSel[kind].has(o) ? 'on' : ''}"><input type="checkbox" data-kind="${kind}" data-i="${i}" ${sSel[kind].has(o) ? 'checked' : ''}>${zEsc(o)}</label>`
  ).join('') || '<span class="sub">Belum ada pilihan, tambah di bawah.</span>';
}

$('m-strategi').addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches && t.matches('input[data-kind]')) {
    const k = t.dataset.kind, o = sOpts[k][+t.dataset.i];
    if (t.checked) sSel[k].add(o); else sSel[k].delete(o);
    renderChips(k);
  }
});

function addNewLabel(kind) {
  const inp = $('s-' + kind + 'New'), c = cleanLabel(inp.value);
  if (!c) return;
  const ex = sOpts[kind].find((o) => o.toLowerCase() === c.toLowerCase());
  const use = ex || c;
  if (!ex) sOpts[kind].push(c);
  sSel[kind].add(use);
  inp.value = '';
  renderChips(kind);
}
$('m-strategi').querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => addNewLabel(b.dataset.add)));
['lane', 'channel'].forEach((k) => $('s-' + k + 'New').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addNewLabel(k); }
}));

function openStrategi() {
  if (!mktReady()) return;
  $('strategiForm').reset();
  clearErrors($('strategiForm'));
  setMsg($('s-msg'), '', '');
  sOpts.lane = M.lane.slice();
  sOpts.channel = M.channel.slice();
  sSel.lane.clear(); sSel.channel.clear();
  $('s-mulai').value = todayStr();
  renderChips('lane'); renderChips('channel');
  openModal('m-strategi');
}

$('strategiForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg($('s-msg'), '', '');
  clearErrors($('strategiForm'));
  const v = {
    nama: $('s-nama').value.trim(), pesan: $('s-pesan').value.trim(),
    mulai: $('s-mulai').value, selesai: $('s-selesai').value, pic: $('s-pic').value, status: $('s-status').value
  };
  let ok = true;
  const bad = (id) => { $(id).classList.add('show'); ok = false; };
  if (!v.nama) bad('err-s-nama');
  if (!v.pesan) bad('err-s-pesan');
  if (!sSel.lane.size) bad('err-s-lane');
  if (!sSel.channel.size) bad('err-s-channel');
  if (!v.mulai) bad('err-s-mulai');
  if (v.selesai && v.mulai && v.selesai < v.mulai) bad('err-s-selesai');
  if (!v.pic) bad('err-s-pic');
  if (!ok) return;

  const btn = $('s-submit');
  btn.disabled = true; btn.textContent = 'Menyimpan…';
  try {
    const j = await zApi.post({
      action: 'add_strategi', nama: v.nama, pesan: v.pesan,
      lane: Array.from(sSel.lane), channel: Array.from(sSel.channel),
      mulai: v.mulai, selesai: v.selesai || null, pic: v.pic, status: v.status
    });
    if (!j.ok) throw new Error(j.error || 'Gagal');
    $('strategiForm').reset(); sSel.lane.clear(); sSel.channel.clear();
    closeModal('m-strategi');
    toast('Strategi "' + v.nama + '" tersimpan. Lane/channel baru otomatis masuk daftar untuk semua orang.');
    await load();
  } catch (err) {
    setMsg($('s-msg'), 'Gagal simpan: ' + err.message, 'bad');
  } finally {
    btn.disabled = false; btn.textContent = 'Simpan strategi';
  }
});

// ---------- popup: hasil event ----------
function openEvent() {
  if (!mktReady()) return;
  $('eventForm').reset();
  clearErrors($('eventForm'));
  setMsg($('e-msg'), '', '');
  $('e-tanggal').value = todayStr();
  $('e-channel').innerHTML = '<option value="">Pilih channel…</option>' + M.channel.map((c) => '<option>' + zEsc(c) + '</option>').join('');
  $('e-strategi').innerHTML = '<option value="">-</option>' + M.strategi.map((s) => '<option>' + zEsc(s['Nama Strategi']) + '</option>').join('');
  openModal('m-event');
}

$('eventForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg($('e-msg'), '', '');
  clearErrors($('eventForm'));
  const channel = $('e-channelNew').value.trim() || $('e-channel').value;
  let ok = true;
  const bad = (id) => { $(id).classList.add('show'); ok = false; };
  if (!$('e-nama').value.trim()) bad('err-e-nama');
  if (!$('e-tanggal').value) bad('err-e-tanggal');
  if (!$('e-pic').value) bad('err-e-pic');
  if (!channel) bad('err-e-channel');
  if (!ok) return;

  const btn = $('e-submit');
  btn.disabled = true; btn.textContent = 'Menyimpan…';
  try {
    const j = await zApi.post({
      action: 'add_hasil_event', nama: $('e-nama').value.trim(), tanggal: $('e-tanggal').value, channel: channel,
      komunitas: $('e-komunitas').value.trim(), kode: $('e-kode').value.trim(),
      hadir: $('e-hadir').value, coba: $('e-coba').value, tanya: $('e-tanya').value, order: $('e-order').value, ugc: $('e-ugc').value,
      strategi: $('e-strategi').value, pic: $('e-pic').value
    });
    if (!j.ok) throw new Error(j.error || 'Gagal');
    const namaEvent = $('e-nama').value.trim();
    $('eventForm').reset();
    closeModal('m-event');
    toast('Hasil event "' + namaEvent + '" tersimpan.');
    await load();
  } catch (err) {
    setMsg($('e-msg'), 'Gagal simpan: ' + err.message, 'bad');
  } finally {
    btn.disabled = false; btn.textContent = 'Simpan hasil event';
  }
});
