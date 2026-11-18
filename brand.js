// Budget WBA: satu dashboard budgeting untuk beberapa brand (Zerodeo, Depot, Retail Online, Kimia Kita, ...).
// - Pilihan brand di atas (chip) menyaring kartu, tabel, Perlu Ditransfer, dan rekap.
// - Ringkasan bulan ini: rencana, sudah ditransfer, sisa pelunasan, per brand, dan uangnya keluar dari mana.
// - Pengaturan Brand (khusus admin): anggota, approver, dan sumber dana tiap brand.
// - Laporan PDF (dibuat di browser, tanpa AI).
// Server tetap memeriksa semua aturan; yang di sini hanya untuk tampilan.

let BRANDS = [];          // [{ nama, anggota[], approver[], sumber[] }] dari Apps Script (payload.brand)
let semuaKegiatan = [];   // semua kegiatan yang boleh dilihat orang ini (server sudah menyaring per brand)
let brandPilih = (function () {
  try {
    const q = new URLSearchParams(location.search).get('brand');
    if (q) return q.slice(0, 40);
    return localStorage.getItem('zBrand') || '';
  } catch (e) { return ''; }
})();

function adaBrand() { return BRANDS.length > 0; }
function brandOf(r) { return String(r['Project/Brand'] || '').trim() || 'Zerodeo'; }
function cariBrand(nama) {
  const k = String(nama || '').trim().toLowerCase();
  return BRANDS.find((b) => b.nama.toLowerCase() === k) || null;
}
function brandTerlihat(b) {
  if (!b || myRole() === 'admin' || !b.anggota.length) return true;
  const me = myUid();
  return b.anggota.indexOf(me) !== -1 || b.approver.indexOf(me) !== -1;
}
function brandSaya() { return BRANDS.filter(brandTerlihat); }
// Yang memutuskan kegiatan brand ini: approver brand; kalau belum diatur, peran approver di Hub.
function deciderIds(b) {
  if (b && b.approver.length) return b.approver.slice();
  return TIM.filter((t) => t.peran === 'approver').map((t) => t.id);
}
function namaDecider(r) { return deciderIds(cariBrand(brandOf(r))).map((id) => picNama(id)).join(', '); }
// Pemegang keputusan untuk kegiatan ini (boleh mengubah yang uangnya sudah diputuskan): admin atau approver brandnya.
function isDeciderFor(r) {
  if (myRole() === 'admin') return true;
  if (!adaBrand()) return isDecider();
  return deciderIds(cariBrand(brandOf(r))).indexOf(myUid()) !== -1;
}
function ownerIdsOf(r) { return String(r['PIC'] || '').split(',').map((p) => picKey(p).toLowerCase()).filter(Boolean); }

function saringBrand(list) {
  if (!brandPilih || !adaBrand()) return list;
  const k = brandPilih.toLowerCase();
  return list.filter((r) => brandOf(r).toLowerCase() === k);
}

// Dipanggil applyPayload: pasang daftar brand + kegiatan, lalu saring sesuai brand terpilih.
function pasangBrand(json) {
  BRANDS = Array.isArray(json.brand) ? json.brand : [];
  semuaKegiatan = json.kegiatan || [];
  if (brandPilih && adaBrand() && !brandSaya().some((b) => b.nama.toLowerCase() === brandPilih.toLowerCase())) brandPilih = '';
  if (adaBrand() && brandSaya().length === 1) brandPilih = brandSaya()[0].nama;   // hanya pegang satu brand: langsung itu
  kegiatanData = saringBrand(semuaKegiatan);
}

function pilihBrand(nama) {
  brandPilih = nama || '';
  try { localStorage.setItem('zBrand', brandPilih); } catch (e) { /* abaikan */ }
  kegiatanData = saringBrand(semuaKegiatan);
  renderTracker();
}

// ---------- rekap bulan (sama dengan rekapBulan_ di Code.gs) ----------
function bulanIni() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
// rows: kegiatan; bulan: 'yyyy-mm' atau '' (semua waktu)
function rekapBulanWeb(rows, bulan) {
  const out = { rencana: 0, ditransfer: 0, sisa: 0, belumNota: 0, perBrand: {}, perSumber: {} };
  const masuk = (tgl) => !bulan || String(tgl || '').slice(0, 7) === bulan;
  const tambah = (k, f, n) => { out.perBrand[k] = out.perBrand[k] || { rencana: 0, ditransfer: 0 }; out.perBrand[k][f] += n; };
  rows.forEach((r) => {
    const st = r['Status'] || '';
    if (st === 'Dibatalkan') return;
    const b = brandOf(r), est = Number(r['Estimasi (Rp)']) || 0, tf = Number(r['Nominal Transfer (Rp)']) || 0;
    if (st !== 'Ditolak' && masuk(r['Tanggal Dicatat'])) { out.rencana += est; tambah(b, 'rencana', est); }
    if (tfSebagian(r)) out.sisa += tfSisa(r);
    if (st === 'Selesai' && !hasNota(r)) out.belumNota++;
    const riw = transferRiwayat[String(r['ID'] || '')] || [];
    if (riw.length) {
      riw.forEach((t) => {
        if (!masuk(t.tgl)) return;
        out.ditransfer += t.nominal; tambah(b, 'ditransfer', t.nominal);
        const s = t.sumber || '(belum diisi)';
        out.perSumber[s] = (out.perSumber[s] || 0) + t.nominal;
      });
    } else if (tf > 0 && masuk(r['Tgl Transfer'])) {
      out.ditransfer += tf; tambah(b, 'ditransfer', tf);
      out.perSumber['(belum diisi)'] = (out.perSumber['(belum diisi)'] || 0) + tf;
    }
  });
  return out;
}
function rpJt(n) {
  n = Math.round(Number(n) || 0);
  if (Math.abs(n) >= 1e6) return 'Rp' + (n / 1e6).toFixed(1).replace('.', ',').replace(',0', '') + ' jt';
  if (Math.abs(n) >= 1e3) return 'Rp' + Math.round(n / 1e3) + ' rb';
  return 'Rp' + n;
}

// ---------- bar brand + ringkasan bulan ini ----------
function renderBrandBar() {
  const bar = $('brandBar'), box = $('brandBulan');
  if (!bar) return;
  if (!adaBrand() || isMarketingOnly()) { bar.hidden = true; box.hidden = true; return; }
  const mine = brandSaya();
  bar.hidden = false;
  const chip = (nama, label) => `<button type="button" class="bchip${(brandPilih || '').toLowerCase() === nama.toLowerCase() ? ' on' : ''}" onclick="pilihBrand(${zEsc(JSON.stringify(nama))})">${zEsc(label || nama)}</button>`;
  bar.innerHTML = '<div class="bchips">' + (mine.length > 1 ? chip('', 'Semua') : '') + mine.map((b) => chip(b.nama)).join('') + '</div>' +
    (myRole() === 'admin' ? '<button type="button" class="btn ghost bset" onclick="openBrandSet()">⚙ Pengaturan Brand</button>' : '');

  const bulan = bulanIni();
  const rk = rekapBulanWeb(kegiatanData, bulan);
  const brandRows = Object.keys(rk.perBrand).filter((k) => rk.perBrand[k].rencana || rk.perBrand[k].ditransfer)
    .sort((a, b) => rk.perBrand[b].ditransfer - rk.perBrand[a].ditransfer || rk.perBrand[b].rencana - rk.perBrand[a].rencana);
  const sumberRows = Object.keys(rk.perSumber).sort((a, b) => rk.perSumber[b] - rk.perSumber[a]);
  const maxB = Math.max(1, ...brandRows.map((k) => Math.max(rk.perBrand[k].ditransfer, rk.perBrand[k].rencana)));
  box.hidden = false;
  box.innerHTML = `<div class="bb-head"><h2>${monthLabel(bulan)} · ${zEsc(brandPilih || 'semua brand')}</h2>
      <span class="bb-btns"><button type="button" class="btn ghost" onclick="openRekap()">Rekap lengkap</button><button type="button" class="btn ghost" onclick="laporanPdf(bulanIni())">📄 Laporan PDF</button></span></div>
    <div class="bb-tiles">
      <div><b>${fmtRupiah(rk.rencana)}</b><span>Rencana (estimasi)</span></div>
      <div><b>${fmtRupiah(rk.ditransfer)}</b><span>Sudah ditransfer</span></div>
      <div><b>${fmtRupiah(rk.sisa)}</b><span>Sisa pelunasan</span></div>
      <div><b>${rk.belumNota} kegiatan</b><span>Selesai, belum ada nota</span></div>
    </div>` +
    ((!brandPilih && brandRows.length > 1) || sumberRows.length ? '<div class="bb-grid">' +
      (!brandPilih && brandRows.length > 1 ? `<div><div class="bb-title">Per brand (ditransfer dari rencana)</div>${brandRows.map((k) => {
        const g = rk.perBrand[k];
        return `<div class="bb-row" onclick="pilihBrand(${zEsc(JSON.stringify(k))})"><span class="brand-tag">${zEsc(k)}</span><span class="v">${fmtRupiah(g.ditransfer)}<small> / ${rpJt(g.rencana)}</small></span><div class="bb-bar"><i style="width:${Math.round(g.ditransfer / maxB * 100)}%"></i></div></div>`;
      }).join('')}</div>` : '') +
      (sumberRows.length ? `<div><div class="bb-title">Uangnya keluar dari mana</div>${sumberRows.map((k) => `<div class="bb-row"><span class="${k === '(belum diisi)' ? 'muted' : ''}">${zEsc(k)}</span><span class="v">${fmtRupiah(rk.perSumber[k])}</span></div>`).join('')}</div>` : '') +
      '</div>' : '');
}

// ---------- form kebutuhan: pilihan brand ----------
function fillBrandForm() {
  const wrap = $('k-brand-wrap');
  if (!wrap) return;
  wrap.style.display = adaBrand() ? '' : 'none';
  if (!adaBrand()) return;
  const mine = brandSaya();
  const keep = $('k-brand').value;
  $('k-brand').innerHTML = (mine.length > 1 ? '<option value="">Pilih brand…</option>' : '') + mine.map((b) => `<option value="${zEsc(b.nama)}">${zEsc(b.nama)}</option>`).join('');
  const pref = keep || brandPilih;
  if (pref && mine.some((b) => b.nama === pref)) $('k-brand').value = pref;
  updateBrandHint();
}
function updateBrandHint() {
  const el = $('k-brand-hint');
  if (!el) return;
  const b = cariBrand($('k-brand').value);
  if (!b) { el.textContent = ''; return; }
  const dec = deciderIds(b).map((id) => picNama(id));
  el.textContent = dec.length ? 'Diajukan ke approver ' + b.nama + ': ' + dec.join(', ') + '. Jalur Fixed = biaya rutin, tanpa approve.' : 'Brand ini belum punya approver (atur di Pengaturan Brand).';
}
function fillBrandEdit(r) {
  const wrap = $('ed-brand-wrap');
  if (!wrap) return;
  wrap.style.display = adaBrand() ? '' : 'none';
  if (!adaBrand()) return;
  const cur = brandOf(r);
  const list = brandSaya().map((b) => b.nama);
  if (list.indexOf(cur) === -1) list.unshift(cur);
  $('ed-brand').innerHTML = list.map((n) => `<option value="${zEsc(n)}">${zEsc(n)}</option>`).join('');
  $('ed-brand').value = cur;
}

// ---------- catat transfer: "Dibayar dari" ----------
function fillSumberTransfer(r) {
  const wrap = $('tf-sumber-wrap');
  if (!wrap) return;
  const b = cariBrand(brandOf(r));
  const list = b ? b.sumber : [];
  wrap.style.display = list.length ? '' : 'none';
  $('tf-sumber').innerHTML = '<option value="">Pilih sumber dana…</option>' + list.map((s) => `<option value="${zEsc(s)}">${zEsc(s)}</option>`).join('');
  let last = '';
  try { last = localStorage.getItem('zSumber:' + (b ? b.nama : '')) || ''; } catch (e) { /* abaikan */ }
  if (list.indexOf(last) !== -1) $('tf-sumber').value = last;
  else if (list.length === 1) $('tf-sumber').value = list[0];
}
function sumberTransferDipilih(r) {
  const wrap = $('tf-sumber-wrap');
  if (!wrap || wrap.style.display === 'none') return { ok: true, nilai: '' };
  const v = $('tf-sumber').value;
  if (!v) return { ok: false };
  try { localStorage.setItem('zSumber:' + brandOf(r), v); } catch (e) { /* abaikan */ }
  return { ok: true, nilai: v };
}

// ---------- Pengaturan Brand (admin) ----------
let bsData = [];   // salinan yang sedang diedit: [{ nama, lama, anggota[], approver[], sumber[] }]
function openBrandSet() {
  if (myRole() !== 'admin') return;
  bsData = BRANDS.map((b) => ({ nama: b.nama, lama: b.nama, anggota: b.anggota.slice(), approver: b.approver.slice(), sumber: b.sumber.slice() }));
  setMsg($('bs-msg'), '', '');
  renderBrandSet();
  openModal('m-brandset');
}
function orangBudget() { return TIM.filter((t) => t.peran !== 'marketing'); }
function renderBrandSet() {
  const orang = orangBudget();
  const chips = (i, field) => orang.map((t) => {
    const on = bsData[i][field].indexOf(t.id) !== -1;
    return `<label class="chip${on ? ' on' : ''}"><input type="checkbox" ${on ? 'checked' : ''} onchange="bsToggle(${i}, '${field}', ${zEsc(JSON.stringify(t.id))}, this.checked)">${zEsc(t.nama)}</label>`;
  }).join('');
  $('bs-list').innerHTML = bsData.map((b, i) => `<div class="bs-card">
      <div class="bs-top"><input type="text" value="${zEsc(b.nama)}" maxlength="40" oninput="bsData[${i}].nama = this.value" aria-label="Nama brand">
        ${b.lama ? '' : `<button type="button" class="bs-x" onclick="bsData.splice(${i}, 1); renderBrandSet()" title="Hapus brand baru ini">✕</button>`}</div>
      <div class="bs-row"><div class="bs-k">Anggota <span class="opt">(kosong = semua orang Budget)</span></div><div class="bs-chips">${chips(i, 'anggota')}</div></div>
      <div class="bs-row"><div class="bs-k">Approver <span class="opt">(kosong = approver di Hub: ${zEsc(TIM.filter((t) => t.peran === 'approver').map((t) => t.nama).join(', ') || '-')})</span></div><div class="bs-chips">${chips(i, 'approver')}</div></div>
      <div class="bs-row"><div class="bs-k">Sumber dana <span class="opt">(pilihan "Dibayar dari" saat catat transfer)</span></div>
        <div class="bs-chips">${b.sumber.map((s, j) => `<span class="tag">${zEsc(s)} <button type="button" onclick="bsData[${i}].sumber.splice(${j}, 1); renderBrandSet()" title="Hapus">×</button></span>`).join('')}
          <input type="text" class="bs-add" placeholder="+ tambah, misal Rekening BCA WBA" maxlength="60" onkeydown="if (event.key === 'Enter') { event.preventDefault(); bsAddSumber(${i}, this); }" onblur="bsAddSumber(${i}, this)"></div></div>
    </div>`).join('');
}
function bsToggle(i, field, id, on) {
  const arr = bsData[i][field], k = arr.indexOf(id);
  if (on && k === -1) arr.push(id);
  if (!on && k !== -1) arr.splice(k, 1);
  renderBrandSet();
}
function bsAddSumber(i, el) {
  const v = el.value.replace(/,/g, ' ').trim();
  if (!v) return;
  if (!bsData[i].sumber.some((s) => s.toLowerCase() === v.toLowerCase())) bsData[i].sumber.push(v);
  el.value = '';
  renderBrandSet();
}
function bsTambahBrand() {
  bsData.push({ nama: '', lama: '', anggota: [], approver: [], sumber: [] });
  renderBrandSet();
  const inp = $('bs-list').querySelectorAll('.bs-top input');
  if (inp.length) inp[inp.length - 1].focus();
}
async function simpanBrandSet() {
  document.querySelectorAll('#bs-list .bs-add').forEach((el, i) => { if (el.value.trim()) bsAddSumber(i, el); });
  const kosong = bsData.findIndex((b) => !b.nama.trim());
  if (kosong !== -1) { setMsg($('bs-msg'), 'Nama brand ke-' + (kosong + 1) + ' masih kosong.', 'err'); return; }
  const btn = $('bs-submit');
  btn.disabled = true; btn.textContent = 'Menyimpan…';
  setMsg($('bs-msg'), '', '');
  try {
    const j = await zApi.post({ action: 'simpan_brand', brand: bsData.map((b) => ({ nama: b.nama.trim(), lama: b.lama, anggota: b.anggota, approver: b.approver, sumber: b.sumber })) });
    if (!j || j.ok !== true) throw new Error((j && j.error) || 'Gagal menyimpan.');
    closeModal('m-brandset');
    toast('Pengaturan Brand tersimpan' + (j.diganti ? ' (' + j.diganti + ' kegiatan ikut ganti nama brand)' : '') + '.');
    load(true);
  } catch (err) {
    setMsg($('bs-msg'), err.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Simpan';
  }
}

// ---------- Laporan PDF (rumus, tanpa AI) ----------
const HTML2PDF = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
function muatHtml2pdf() {
  if (window.html2pdf) return Promise.resolve();
  return new Promise((ok, gagal) => {
    const s = document.createElement('script');
    s.src = HTML2PDF; s.onload = () => ok();
    s.onerror = () => gagal(new Error('Gagal memuat pembuat PDF. Cek koneksi internet lalu coba lagi.'));
    document.head.appendChild(s);
  });
}
// periode: 'yyyy-mm' atau '' (semua waktu). Brand = pilihan di atas.
function laporanHtml(periode) {
  const rows = kegiatanData.filter((r) => r['Status'] !== 'Dibatalkan');
  const rk = rekapBulanWeb(rows, periode);
  const label = periode ? monthLabel(periode) : 'Semua waktu';
  const inPer = rows.filter((r) => !periode || monthKey(r) === periode);
  const rp = (n) => fmtRupiah(n);
  const brandRows = Object.keys(rk.perBrand).sort((a, b) => rk.perBrand[b].ditransfer - rk.perBrand[a].ditransfer);
  const sumberRows = Object.keys(rk.perSumber).sort((a, b) => rk.perSumber[b] - rk.perSumber[a]);
  const kat = rekapGroup(inPer, (r) => r['Kategori'] || '(tanpa kategori)').sort((a, b) => b.est - a.est).slice(0, 8);
  const detail = inPer.slice().sort((a, b) => String(a['Tanggal Dicatat'] || '').localeCompare(String(b['Tanggal Dicatat'] || '')));
  const sel = rk.ditransfer - rk.rencana;
  const kesimpulan = [];
  if (rk.rencana) kesimpulan.push('Sudah ditransfer ' + rp(rk.ditransfer) + ' dari rencana ' + rp(rk.rencana) + ' (' + Math.round(rk.ditransfer / rk.rencana * 100) + '%).');
  else if (rk.ditransfer) kesimpulan.push('Sudah ditransfer ' + rp(rk.ditransfer) + '.');
  if (rk.rencana && sel > 0) kesimpulan.push('Transfer melebihi rencana ' + rp(sel) + ' (ada pelunasan / kegiatan bulan sebelumnya).');
  if (rk.sisa) kesimpulan.push('Masih ada sisa pelunasan ' + rp(rk.sisa) + ' yang perlu disiapkan.');
  if (rk.belumNota) kesimpulan.push(rk.belumNota + ' kegiatan selesai belum ada nota.');
  if (rk.perSumber['(belum diisi)']) kesimpulan.push(rp(rk.perSumber['(belum diisi)']) + ' belum tercatat sumber dananya.');
  return `<div class="zl">
    <style>
      .zl{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#1F2422;width:186mm;font-size:10.5px;background:#fff}
      .zl h1{font-size:17px;margin:0}.zl .sub{color:#6B6F68;margin:2px 0 10px}
      .zl .tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-bottom:10px}
      .zl .tiles div{background:#F5F4EF;border-radius:6px;padding:7px 8px}.zl .tiles b{display:block;font-size:13px}.zl .tiles span{color:#6B6F68;font-size:9.5px}
      .zl h2{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6B6F68;margin:12px 0 4px}
      .zl table{width:100%;border-collapse:collapse}.zl td,.zl th{padding:4px 5px;border-top:1px solid #DEDCD3;text-align:left;vertical-align:top}
      .zl th{font-size:9.5px;color:#6B6F68;font-weight:600}.zl .n{text-align:right;white-space:nowrap}
      .zl .grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
      .zl .kes{background:#E4EEF3;border-radius:6px;padding:8px 10px;line-height:1.5}.zl .blok{page-break-inside:avoid}
      .zl .foot{color:#6B6F68;font-size:9px;margin-top:10px}
    </style>
    <h1>Laporan Budget WBA · ${zEsc(brandPilih || 'Semua brand')}</h1>
    <div class="sub">${zEsc(label)} · dibuat ${zEsc(new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }))}</div>
    <div class="tiles">
      <div><b>${rp(rk.rencana)}</b><span>Rencana (estimasi)</span></div>
      <div><b>${rp(rk.ditransfer)}</b><span>Sudah ditransfer</span></div>
      <div><b>${rp(rk.sisa)}</b><span>Sisa pelunasan (semua)</span></div>
      <div><b>${rk.belumNota}</b><span>Selesai belum ada nota</span></div>
    </div>
    ${kesimpulan.length ? `<div class="kes blok"><b>Kesimpulan</b><br>${kesimpulan.map(zEsc).join('<br>')}</div>` : ''}
    <div class="grid blok">
      <div><h2>Per brand</h2><table><tr><th>Brand</th><th class="n">Rencana</th><th class="n">Ditransfer</th></tr>
        ${brandRows.map((k) => `<tr><td>${zEsc(k)}</td><td class="n">${rp(rk.perBrand[k].rencana)}</td><td class="n">${rp(rk.perBrand[k].ditransfer)}</td></tr>`).join('') || '<tr><td colspan="3">Tidak ada data.</td></tr>'}</table></div>
      <div><h2>Dibayar dari</h2><table><tr><th>Sumber dana</th><th class="n">Ditransfer</th></tr>
        ${sumberRows.map((k) => `<tr><td>${zEsc(k)}</td><td class="n">${rp(rk.perSumber[k])}</td></tr>`).join('') || '<tr><td colspan="2">Tidak ada transfer.</td></tr>'}</table></div>
    </div>
    <div class="blok"><h2>Per kategori (rencana)</h2><table><tr><th>Kategori</th><th class="n">Kegiatan</th><th class="n">Estimasi</th><th class="n">Actual</th></tr>
      ${kat.map((g) => `<tr><td>${zEsc(g.key)}</td><td class="n">${g.n}</td><td class="n">${rp(g.est)}</td><td class="n">${rp(g.act)}</td></tr>`).join('') || '<tr><td colspan="4">Tidak ada data.</td></tr>'}</table></div>
    <h2>Detail kegiatan (${detail.length})</h2>
    <table><tr><th>Tgl</th><th>Brand</th><th>Item</th><th>PIC</th><th>Status</th><th class="n">Estimasi</th><th class="n">Ditransfer</th><th class="n">Actual</th></tr>
      ${detail.slice(0, 150).map((r) => `<tr><td>${zEsc(fmtDate(r['Tanggal Dicatat']))}</td><td>${zEsc(brandOf(r))}</td><td>${zEsc(r['Item Kegiatan'] || '-')}</td><td>${zEsc(picNama(r['PIC']) || '-')}</td><td>${zEsc(tfSebagian(r) ? 'Ditransfer sebagian' : (r['Status'] || 'Draft'))}</td><td class="n">${rp(r['Estimasi (Rp)'])}</td><td class="n">${rp(r['Nominal Transfer (Rp)'])}</td><td class="n">${rp(r['Actual (Rp)'])}</td></tr>`).join('') || '<tr><td colspan="8">Tidak ada kegiatan.</td></tr>'}
    </table>
    ${detail.length > 150 ? '<div class="foot">Detail dipotong 150 baris pertama; lengkapnya di Unduh Excel.</div>' : ''}
    <div class="foot">Rencana = estimasi kegiatan yang dicatat di periode ini (tidak termasuk Ditolak / Dibatalkan). Ditransfer = transfer yang tanggalnya di periode ini, termasuk DP / pelunasan kegiatan bulan lain. Dana bulk tidak dihitung per brand.</div>
  </div>`;
}
async function laporanPdf(periode) {
  const wadah = document.createElement('div');
  wadah.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff';
  wadah.innerHTML = laporanHtml(periode);
  document.body.appendChild(wadah);
  toast('Menyiapkan PDF…');
  try {
    await muatHtml2pdf();
    const nama = 'Laporan Budget WBA - ' + (brandPilih || 'Semua brand') + ' - ' + (periode ? monthLabel(periode) : 'Semua waktu') + '.pdf';
    await html2pdf().set({ margin: [8, 8, 8, 8], filename: nama, image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['css', 'legacy'], avoid: ['.blok', 'tr'] } }).from(wadah.firstChild).save();
    toast('PDF diunduh.');
  } catch (err) {
    toast(err.message || 'Gagal membuat PDF.', 'err');
  } finally {
    wadah.remove();
  }
}
