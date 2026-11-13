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

// ---------- hasil event ↔ kegiatan Budgeting (bukan untuk peran marketing: tanpa data uang) ----------
const idsKegiatan = (e) => splitList(e && e.Kegiatan);
function biayaKegiatan(k) {
  if (!k || k.Status === 'Dibatalkan') return { rp: 0, est: false };
  const actual = Number(k['Actual (Rp)']) || 0;
  return actual > 0 ? { rp: actual, est: false } : { rp: Number(k['Estimasi (Rp)']) || 0, est: true };
}
// Total biaya event dari kegiatan yang ditautkan. est = ada yang masih memakai Estimasi.
function biayaEvent(e) {
  const ids = idsKegiatan(e);
  let rp = 0, est = false, n = 0;
  ids.forEach((id) => { const k = kegiatanData.find((x) => String(x.ID) === id); if (!k) return; const b = biayaKegiatan(k); rp += b.rp; est = est || (b.est && b.rp > 0); n++; });
  return { rp, est, n, ada: ids.length > 0 };
}
const rpEvent = (b) => (b.ada ? (b.est ? '<span class="biaya-est">≈</span>' : '') + fmtRupiah(b.rp) : '<span class="sub">-</span>');
const perOrang = (rp, n, est) => (rp > 0 && n > 0 ? (est ? '<span class="biaya-est">≈</span>' : '') + fmtRupiah(rp / n) : '-');

// Daftar kegiatan untuk dipilih: yang tidak dibatalkan, terdekat dengan tanggal event di atas; yang sudah dipilih selalu tampil.
function pilihanKegiatan(tanggal, terpilih, cari) {
  const t = tanggal ? new Date(tanggal + 'T00:00:00').getTime() : Date.now();
  const q = String(cari || '').trim().toLowerCase();
  return kegiatanData.filter((k) => k.ID && (terpilih.has(String(k.ID)) || k.Status !== 'Dibatalkan'))
    .filter((k) => !q || ((k['Item Kegiatan'] || '') + ' ' + (k['Project/Brand'] || '')).toLowerCase().includes(q))
    .map((k) => ({ k, jarak: k['Deadline Kegiatan'] ? Math.abs(new Date(k['Deadline Kegiatan']).getTime() - t) : 9e15 }))
    .sort((a, b) => (terpilih.has(String(b.k.ID)) - terpilih.has(String(a.k.ID))) || a.jarak - b.jarak)
    .slice(0, 40).map((x) => x.k);
}
function renderPilihanKegiatan(wadahId, tanggal, terpilih, cari) {
  const list = pilihanKegiatan(tanggal, terpilih, cari);
  $(wadahId).innerHTML = list.map((k) => {
    const b = biayaKegiatan(k), on = terpilih.has(String(k.ID));
    return `<label class="chip ${on ? 'on' : ''}"><input type="checkbox" data-keg="${zEsc(k.ID)}" ${on ? 'checked' : ''}>
      <span><b>${zEsc(k['Item Kegiatan'] || '(tanpa nama)')}</b><span class="sub">${[k['Project/Brand'] ? zEsc(k['Project/Brand']) : '', k['Deadline Kegiatan'] ? mktDate(k['Deadline Kegiatan']) : '', (b.est ? '≈' : '') + fmtRupiah(b.rp), zEsc(k.Status || '')].filter(Boolean).join(' · ')}</span></span></label>`;
  }).join('') || '<span class="sub">Tidak ada kegiatan yang cocok.</span>';
}
function pasangPemilih(wadahId, cariId, ambilTanggal, terpilih) {
  $(wadahId).addEventListener('change', (e) => {
    const id = e.target && e.target.dataset && e.target.dataset.keg;
    if (!id) return;
    if (e.target.checked) terpilih.add(id); else terpilih.delete(id);
    e.target.closest('.chip').classList.toggle('on', e.target.checked);
  });
  $(cariId).addEventListener('input', () => renderPilihanKegiatan(wadahId, ambilTanggal(), terpilih, $(cariId).value));
}
const eKeg = new Set();
pasangPemilih('e-kegChips', 'e-kegCari', () => $('e-tanggal').value, eKeg);
$('e-tanggal').addEventListener('change', () => { if (!$('e-kegWrap').hidden) renderPilihanKegiatan('e-kegChips', $('e-tanggal').value, eKeg, $('e-kegCari').value); });

// Hubungkan event yang sudah tercatat
const ekKeg = new Set();
let ekEvent = null;
pasangPemilih('ek-chips', 'ek-cari', () => (ekEvent ? ekEvent['Tanggal Event'] : ''), ekKeg);
function bukaHubungkan(id) {
  if (!mktReady()) return;
  ekEvent = M.hasil_event.find((e) => String(e.ID) === String(id));
  if (!ekEvent) return;
  ekKeg.clear(); idsKegiatan(ekEvent).forEach((x) => ekKeg.add(x));
  $('ek-judul').textContent = 'Kegiatan untuk "' + (ekEvent['Nama Event'] || '') + '"';
  $('ek-cari').value = '';
  renderPilihanKegiatan('ek-chips', ekEvent['Tanggal Event'], ekKeg, '');
  openModal('m-eventKeg');
}
$('ek-simpan').addEventListener('click', () => {
  if (!ekEvent) return;
  const ev = ekEvent, ids = Array.from(ekKeg);
  enqueueSave({
    label: 'Kegiatan event: ' + ev['Nama Event'],
    payload: { action: 'update_hasil_event_kegiatan', id: ev.ID, kegiatan: ids },
    okMsg: 'Kegiatan untuk "' + ev['Nama Event'] + '" tersimpan.',
    restore: () => bukaHubungkan(ev.ID)
  });
  closeModal('m-eventKeg');
});

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
    <td>${zEsc(picNama(r.PIC))}</td>
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
  const uang = !isMarketingOnly();   // peran marketing tidak melihat biaya
  $('theadSum').innerHTML = '<tr><th>Channel</th><th>Event</th><th>Hadir</th><th>Coba</th><th>Tanya beli</th><th>Order</th><th>UGC</th><th>Order / Hadir</th>' +
    (uang ? '<th>Biaya</th><th>Biaya / order</th>' : '') + '</tr>';
  $('theadE').innerHTML = '<tr><th>Tanggal</th><th>Event</th><th>Channel</th><th>Komunitas</th><th>Kode</th><th>Hadir</th><th>Coba</th><th>Tanya</th><th>Order</th><th>UGC</th>' +
    (uang ? '<th>Biaya</th><th>Biaya / hadir</th><th>Biaya / order</th><th></th>' : '') + '</tr>';
  $('secStrat').hidden = !uang || !ev.length;
  if (!ev.length) {
    $('bodySum').innerHTML = '<tr><td colspan="10" class="empty">Belum ada hasil event.</td></tr>';
    $('bodyE').innerHTML = '<tr><td colspan="14" class="empty">Belum ada hasil event.</td></tr>';
    return;
  }
  const g = {}, gs = {};
  ev.forEach((e) => {
    const b = uang ? biayaEvent(e) : { rp: 0, est: false, ada: false };
    const k = e.Channel || '(tanpa channel)';
    const a = g[k] || (g[k] = { n: 0, h: 0, c: 0, t: 0, o: 0, u: 0, rp: 0, est: false, oBiaya: 0 });
    a.n++; a.h += +e.Hadir || 0; a.c += +e['Coba Produk'] || 0;
    a.t += +e['Tanya Beli Di Mana'] || 0; a.o += +e['Order via Kode'] || 0; a.u += +e['Konten UGC'] || 0;
    if (b.ada) { a.rp += b.rp; a.est = a.est || b.est; a.oBiaya += +e['Order via Kode'] || 0; }
    const sk = e.Strategi || '(tanpa strategi)';
    const s2 = gs[sk] || (gs[sk] = { n: 0, h: 0, o: 0, rp: 0, est: false, hBiaya: 0, oBiaya: 0 });
    s2.n++; s2.h += +e.Hadir || 0; s2.o += +e['Order via Kode'] || 0;
    if (b.ada) { s2.rp += b.rp; s2.est = s2.est || b.est; s2.hBiaya += +e.Hadir || 0; s2.oBiaya += +e['Order via Kode'] || 0; }
  });
  $('bodySum').innerHTML = Object.keys(g).sort((x, y) => g[y].o - g[x].o).map((k) => {
    const a = g[k];
    return `<tr><td><b>${zEsc(k)}</b></td><td class="num">${a.n}</td><td class="num">${a.h}</td><td class="num">${a.c}</td>
      <td class="num">${a.t}</td><td class="num">${a.o}</td><td class="num">${a.u}</td>
      <td class="num">${a.h ? (a.o / a.h * 100).toFixed(1) + '%' : '-'}</td>` +
      (uang ? `<td class="num">${a.rp ? (a.est ? '<span class="biaya-est">≈</span>' : '') + fmtRupiah(a.rp) : '-'}</td><td class="num">${perOrang(a.rp, a.oBiaya, a.est)}</td>` : '') + '</tr>';
  }).join('');
  if (uang) {
    // biaya per hadir/order hanya dari event yang biayanya diketahui (sudah ditautkan ke kegiatan)
    $('bodyStrat').innerHTML = Object.keys(gs).sort((x, y) => gs[y].o - gs[x].o).map((k) => {
      const a = gs[k];
      return `<tr><td><b>${zEsc(k)}</b></td><td class="num">${a.n}</td><td class="num">${a.h}</td><td class="num">${a.o}</td>
        <td class="num">${a.rp ? (a.est ? '<span class="biaya-est">≈</span>' : '') + fmtRupiah(a.rp) : '-'}</td>
        <td class="num">${perOrang(a.rp, a.hBiaya, a.est)}</td><td class="num">${perOrang(a.rp, a.oBiaya, a.est)}</td></tr>`;
    }).join('');
  }

  $('bodyE').innerHTML = ev.slice().sort((a, b) => String(b['Tanggal Event'] || '').localeCompare(String(a['Tanggal Event'] || ''))).map((e) => {
    const b = uang ? biayaEvent(e) : null;
    return `<tr>
    <td style="white-space:nowrap">${mktDate(e['Tanggal Event'])}</td><td>${zEsc(e['Nama Event'])}</td><td>${zEsc(e.Channel)}</td>
    <td>${zEsc(e['Nama Komunitas'])}</td><td>${zEsc(e['Kode Voucher'])}</td>
    <td class="num">${+e.Hadir || 0}</td><td class="num">${+e['Coba Produk'] || 0}</td>
    <td class="num">${+e['Tanya Beli Di Mana'] || 0}</td><td class="num">${+e['Order via Kode'] || 0}</td>
    <td class="num">${+e['Konten UGC'] || 0}</td>` +
    (uang ? `<td class="num">${rpEvent(b)}</td><td class="num">${b.ada ? perOrang(b.rp, +e.Hadir || 0, b.est) : '-'}</td>
    <td class="num">${b.ada ? perOrang(b.rp, +e['Order via Kode'] || 0, b.est) : '-'}</td>
    <td><button type="button" class="link-keg" data-id="${zEsc(e.ID)}" onclick="bukaHubungkan(this.dataset.id)">${b.ada ? '🔗 ' + b.n + ' kegiatan' : '🔗 Hubungkan'}</button></td>` : '') + '</tr>';
  }).join('');
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

$('strategiForm').addEventListener('submit', (e) => {
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

  const lane = Array.from(sSel.lane), channel = Array.from(sSel.channel);
  const snap = snapshotForm($('strategiForm'));
  enqueueSave({
    label: 'Strategi: ' + v.nama,
    payload: { action: 'add_strategi', nama: v.nama, pesan: v.pesan, lane: lane, channel: channel,
      mulai: v.mulai, selesai: v.selesai || null, pic: v.pic, status: v.status },
    okMsg: 'Strategi "' + v.nama + '" tersimpan. Lane/channel baru otomatis masuk daftar untuk semua orang.',
    restore: () => {
      openStrategi(); restoreForm(snap);
      lane.forEach((x) => { if (sOpts.lane.indexOf(x) === -1) sOpts.lane.push(x); sSel.lane.add(x); });
      channel.forEach((x) => { if (sOpts.channel.indexOf(x) === -1) sOpts.channel.push(x); sSel.channel.add(x); });
      renderChips('lane'); renderChips('channel');
    }
  });
  $('strategiForm').reset(); sSel.lane.clear(); sSel.channel.clear();
  closeModal('m-strategi');
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
  eKeg.clear();
  $('e-kegCari').value = '';
  $('e-kegWrap').hidden = isMarketingOnly() || !kegiatanData.length;
  if (!$('e-kegWrap').hidden) renderPilihanKegiatan('e-kegChips', $('e-tanggal').value, eKeg, '');
  openModal('m-event');
}

$('eventForm').addEventListener('submit', (e) => {
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

  const namaEvent = $('e-nama').value.trim();
  const snap = snapshotForm($('eventForm'));
  enqueueSave({
    label: 'Hasil event: ' + namaEvent,
    payload: {
      action: 'add_hasil_event', nama: namaEvent, tanggal: $('e-tanggal').value, channel: channel,
      komunitas: $('e-komunitas').value.trim(), kode: $('e-kode').value.trim(),
      hadir: $('e-hadir').value, coba: $('e-coba').value, tanya: $('e-tanya').value, order: $('e-order').value, ugc: $('e-ugc').value,
      strategi: $('e-strategi').value, pic: $('e-pic').value,
      kegiatan: isMarketingOnly() ? [] : Array.from(eKeg)
    },
    okMsg: 'Hasil event "' + namaEvent + '" tersimpan.',
    restore: () => { openEvent(); restoreForm(snap); }
  });
  $('eventForm').reset();
  closeModal('m-event');
});
