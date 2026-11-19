// Tab Marketing → Seeding: batch seeding (diajukan tim, di-acc approver/admin) + status tiap kreator.
// Server (Marketing.gs) tetap memeriksa semua aturan; di sini hanya tampilan + kiriman.
const KREATOR_ST = ['Rencana', 'Dikirim', 'Diterima', 'Posting', 'Tidak posting'];
let sdFilter = 'aktif';
let sdBuka = null;   // id batch yang sedang dibuka di detail

function sdKreator(id) { return (M.seeding_kreator || []).filter((k) => String(k.Batch) === String(id)); }
function sdMilik(b) { const me = myUid(); return !!me && (String(b.PIC || '').split(',').some((p) => picKey(p) === me) || String(b['Diajukan Oleh'] || '') === me); }
function sdBolehAcc(b) { return b.Status === 'Diajukan' && isDecider() && !sdMilik(b); }
function sdAkun(k) { return k.Akun ? '@' + String(k.Akun).replace(/^@+/, '') : (k.Nama || '-'); }
// sampel batch: Lane = varian (dipisah koma), Qty = jumlah per varian (dipisah "; ")
function sdSampel(b) {
  const ln = splitList(b.Lane), q = String(b.Qty == null ? '' : b.Qty).split(/[;,]/).map((x) => Number(String(x).trim()) || 0);
  return ln.map((v, i) => ({ varian: v, qty: q[i] || 0 }));
}
function sdVarProg(b, ks) {
  const per = {}, urut = [];
  const ambil = (v) => { const k = v.toLowerCase(); if (!per[k]) { per[k] = { varian: v, rencana: 0, keluar: 0 }; urut.push(k); } return per[k]; };
  sdSampel(b).forEach((x) => { ambil(x.varian).rencana += x.qty; });
  ks.forEach((k) => { if ((k.Status || 'Rencana') === 'Rencana') return; ambil(String(k.Varian || '').trim() || 'tanpa varian').keluar += Number(k.Qty) || 1; });
  return urut.map((k) => per[k]);
}
function sdHitung(b) {
  const ks = sdKreator(b.ID), n = { Rencana: 0, Dikirim: 0, Diterima: 0, Posting: 0, 'Tidak posting': 0 };
  ks.forEach((k) => { n[k.Status || 'Rencana'] = (n[k.Status || 'Rencana'] || 0) + 1; });
  const views = ks.reduce((a, k) => a + (Number(k.Views) || 0), 0);
  let biaya = Number(b['Estimasi (Rp)']) || 0, est = true;
  const ids = splitList(b.Kegiatan);
  if (ids.length && typeof kegiatanData !== 'undefined') {
    biaya = 0; est = false;
    ids.forEach((id) => { const k = kegiatanData.find((x) => String(x.ID) === id); if (!k || k.Status === 'Dibatalkan') return; const a = Number(k['Actual (Rp)']) || 0; if (a > 0) biaya += a; else { biaya += Number(k['Estimasi (Rp)']) || 0; est = true; } });
  }
  const vp = sdVarProg(b, ks);
  return { ks, n, total: ks.length, views, biaya, est, vp, rencana: vp.reduce((a, x) => a + x.rencana, 0), keluar: vp.reduce((a, x) => a + x.keluar, 0) };
}

function renderSeeding() {
  if (!$('sdList')) return;
  if (!M.seedAda) { $('sdList').innerHTML = '<div class="empty">Apps Script Zerodeo belum versi terbaru (Seeding). Pasang Code.gs, Marketing.gs, dan Hub.gs terbaru.</div>'; $('sdFilter').innerHTML = ''; return; }
  const filt = { aktif: (b) => ['Selesai', 'Ditolak', 'Dibatalkan'].indexOf(b.Status) < 0, acc: (b) => b.Status === 'Diajukan', selesai: (b) => b.Status === 'Selesai', semua: () => true };
  const nAcc = M.seeding.filter((b) => b.Status === 'Diajukan').length;
  $('sdFilter').innerHTML = [['aktif', 'Berjalan'], ['acc', 'Menunggu acc' + (nAcc ? ' (' + nAcc + ')' : '')], ['selesai', 'Selesai'], ['semua', 'Semua']]
    .map((x) => `<button type="button" class="${sdFilter === x[0] ? 'on' : ''}" onclick="sdFilter='${x[0]}';renderSeeding()">${x[1]}</button>`).join('');
  const list = M.seeding.filter(filt[sdFilter]).sort((a, z) => String(z['Dicatat Pada'] || '').localeCompare(String(a['Dicatat Pada'] || '')));
  if (!list.length) { $('sdList').innerHTML = '<div class="empty">Belum ada seeding di sini. Tekan <b>+ Ajukan seeding</b>.</div>'; return; }
  const uang = !isMarketingOnly();
  $('sdList').innerHTML = list.map((b) => {
    const h = sdHitung(b), t = Math.max(1, h.total);
    const kirim = h.n.Dikirim, terima = h.n.Diterima, post = h.n.Posting, tidak = h.n['Tidak posting'];
    return `<button type="button" class="sd-card" onclick="bukaSeeding('${zEsc(b.ID)}')">
      <div class="t"><span>${zEsc(b['Nama Batch'] || '-')}</span><span class="badge sd-${zEsc(b.Status)}">${zEsc(b.Status === 'Diajukan' ? 'Menunggu acc' : b.Status)}</span></div>
      <div class="m">${[b.Produk, b.Lane, b.Platform, h.rencana ? h.keluar + '/' + h.rencana + ' pcs keluar' : (h.keluar ? h.keluar + ' pcs keluar' : '')].filter(Boolean).map(zEsc).join(' · ') || '&nbsp;'} · PIC ${zEsc(picNama(b.PIC) || '-')}</div>
      <div class="sd-bar"><i class="p" style="width:${post / t * 100}%"></i><i class="d" style="width:${terima / t * 100}%"></i><i class="k" style="width:${kirim / t * 100}%"></i><i class="x" style="width:${tidak / t * 100}%"></i></div>
      <div class="sd-angka"><span><b>${post}</b>/${h.total} posting</span><span>${terima} nunggu konten</span><span>${kirim} di jalan</span>${h.views ? `<span>${h.views.toLocaleString('id-ID')} views</span>` : ''}${uang && h.biaya ? `<span>${post ? 'per konten <b>' + (h.est ? '≈' : '') + fmtRupiah(h.biaya / post) + '</b>' : 'biaya ' + (h.est ? '≈' : '') + fmtRupiah(h.biaya)}</span>` : ''}</div>
    </button>`;
  }).join('');
  if (sdBuka && $('m-seeddetail').classList.contains('show')) bukaSeeding(sdBuka);
}

// ---------- ajukan / ubah ----------
let sdEdit = null;   // id batch yang sedang diubah (null = ajukan baru)
function openSeeding(editId) {
  if (!M.seedAda) { toast('Apps Script Zerodeo belum versi terbaru (Seeding).', 'err'); return; }
  const b = editId ? M.seeding.find((x) => x.ID === editId) : null;
  sdEdit = b ? b.ID : null;
  $('seedingForm').reset(); clearErrors($('seedingForm')); setMsg($('sd-msg'), '', '');
  $('sd-sampel').innerHTML = '';
  (b ? sdSampel(b) : []).forEach((x) => sdBarisVarian(x.varian, x.qty));
  if (!$('sd-sampel').children.length) sdBarisVarian();
  sdTotalSampel();
  const plat = b ? splitList(b.Platform) : [];
  $('sd-platform').innerHTML = M.channel.concat(plat.filter((x) => M.channel.indexOf(x) < 0)).map((x) => `<button type="button" class="${plat.indexOf(x) >= 0 ? 'on' : ''}" onclick="this.classList.toggle('on')">${zEsc(x)}</button>`).join('');
  $('sd-est-wrap').style.display = isMarketingOnly() ? 'none' : '';
  $('sd-judul').textContent = b ? 'Ubah seeding' : 'Ajukan seeding';
  $('sd-hint').textContent = b ? 'Kreator diubah / dihapus langsung di daftar kreator.' : 'Setelah di-acc approver / admin, sampel baru boleh dikirim. Daftar kreator bisa ditambah belakangan.';
  $('sd-submit').textContent = b ? 'Simpan perubahan' : 'Ajukan';
  $('sd-kreator-wrap').style.display = b ? 'none' : '';
  if (b) {
    $('sd-nama').value = b['Nama Batch'] || ''; $('sd-produk').value = b.Produk || '';
    $('sd-est').value = b['Estimasi (Rp)'] || ''; $('sd-batas').value = b['Batas Posting (hari)'] || 7; $('sd-pic').value = picKey(b.PIC || '');
    $('sd-catatan').value = String(b.Catatan || '').split(' | ').filter((x) => !/^(Approved|Ditolak|Revisi) oleh /.test(x.trim())).join(' | ');
  } else {
    $('sd-batas').value = 7;
    const me = myUid(); if (me && TIM.some((t) => t.id === me)) $('sd-pic').value = me;
  }
  $('sd-kreator-hint').textContent = '';
  if (b) closeModal('m-seeddetail');
  openModal('m-seeding');
}
// baris varian + jumlah di form
function sdBarisVarian(varian, qty) {
  const d = document.createElement('div'); d.className = 'sd-var';
  const daftar = M.lane.concat(varian && M.lane.indexOf(varian) < 0 ? [varian] : []);
  d.innerHTML = `<select><option value="">Pilih varian…</option>${daftar.map((x) => `<option ${x === varian ? 'selected' : ''}>${zEsc(x)}</option>`).join('')}</select><input type="number" min="1" inputmode="numeric" placeholder="pcs" value="${qty || ''}"><button type="button" title="Hapus baris">✕</button>`;
  d.querySelector('button').onclick = () => { d.remove(); if (!$('sd-sampel').children.length) sdBarisVarian(); sdTotalSampel(); };
  d.querySelectorAll('select,input').forEach((x) => x.addEventListener('input', sdTotalSampel));
  $('sd-sampel').appendChild(d);
  if (!varian && $('sd-sampel').children.length > 1) d.querySelector('select').focus();
}
function sdAmbilPlatform() { return Array.from($('sd-platform').querySelectorAll('button.on')).map((x) => x.textContent); }
function sdAmbilSampel() {
  return Array.from($('sd-sampel').querySelectorAll('.sd-var')).map((d) => ({ varian: d.querySelector('select').value, qty: Number(d.querySelector('input').value) || 0 })).filter((x) => x.varian);
}
function sdTotalSampel() {
  const t = sdAmbilSampel().reduce((a, x) => a + x.qty, 0);
  $('sd-sampel-total').textContent = t ? '· total ' + t + ' pcs' : '';
}
$('sd-kreator').addEventListener('input', () => { const n = $('sd-kreator').value.split('\n').filter((x) => x.trim()).length; $('sd-kreator-hint').textContent = n ? n + ' kreator' : ''; });
$('seedingForm').addEventListener('submit', (e) => {
  e.preventDefault(); clearErrors($('seedingForm'));
  const nama = $('sd-nama').value.trim();
  if (!nama) { $('err-sd-nama').classList.add('show'); return; }
  if (sdEdit) {
    const b = M.seeding.find((x) => x.ID === sdEdit) || {};
    const sampelTeks = (arr) => arr.map((x) => x.varian + '=' + (x.qty || 0)).join('|');
    const ubah = { nama, produk: $('sd-produk').value.trim(), sampel: sampelTeks(sdAmbilSampel()), platform: sdAmbilPlatform().join(', '), pic: $('sd-pic').value,
      batas: $('sd-batas').value, catatan: $('sd-catatan').value.trim() };
    if (!isMarketingOnly()) ubah.estimasi = $('sd-est').value;
    const lama = { nama: b['Nama Batch'] || '', produk: b.Produk || '', sampel: sampelTeks(sdSampel(b)), platform: splitList(b.Platform).join(', '), pic: picKey(b.PIC || ''), batas: String(b['Batas Posting (hari)'] || 7),
      catatan: String(b.Catatan || '').split(' | ').filter((x) => !/^(Approved|Ditolak|Revisi) oleh /.test(x.trim())).join(' | '), estimasi: String(b['Estimasi (Rp)'] || '') };
    const payload = { action: 'update_seeding', id: sdEdit };
    Object.keys(ubah).forEach((k) => { if (String(ubah[k]) !== String(lama[k])) payload[k] = ubah[k]; });
    if (payload.sampel !== undefined) payload.sampel = sdAmbilSampel();
    const id = sdEdit; sdEdit = null;
    closeModal('m-seeding');
    if (Object.keys(payload).length === 2) { toast('Tidak ada perubahan.'); bukaSeeding(id); return; }
    enqueueSave({ label: 'Ubah seeding: ' + nama, payload, okMsg: 'Seeding "' + nama + '" diperbarui.' });
    bukaSeeding(id);   // detail dibuka lagi; ikut diperbarui begitu data baru masuk
    return;
  }
  const kreator = $('sd-kreator').value;
  enqueueSave({
    label: 'Seeding: ' + nama,
    payload: { action: 'add_seeding', nama, produk: $('sd-produk').value.trim(), sampel: sdAmbilSampel(), platform: sdAmbilPlatform(),
      estimasi: isMarketingOnly() ? '' : $('sd-est').value, batas: $('sd-batas').value, pic: $('sd-pic').value, kreator, catatan: $('sd-catatan').value.trim() },
    okMsg: 'Seeding "' + nama + '" diajukan. Menunggu acc approver / admin.'
  });
  closeModal('m-seeding');
});

// ---------- detail ----------
function bukaSeeding(id) {
  const b = M.seeding.find((x) => String(x.ID) === String(id));
  if (!b) return;
  sdBuka = id;
  const h = sdHitung(b), uang = !isMarketingOnly(), sudahAcc = ['Approved', 'Jalan', 'Selesai'].indexOf(b.Status) >= 0;
  const aksiBatch = [];
  if (sdBolehAcc(b)) aksiBatch.push(`<button class="btn green" onclick="sdPutus('${zEsc(id)}','Approved')">✓ Acc</button>`, `<button class="btn ghost" onclick="sdPutus('${zEsc(id)}','Revisi')">Minta revisi</button>`, `<button class="btn ghost" style="color:var(--red)" onclick="sdPutus('${zEsc(id)}','Ditolak')">Tolak</button>`);
  const bolehIsi = ['Diajukan', 'Revisi'].indexOf(b.Status) >= 0 ? (sdMilik(b) || isDecider()) : (['Approved', 'Jalan'].indexOf(b.Status) >= 0 && isDecider());
  if (bolehIsi) aksiBatch.push(`<button class="btn ghost" onclick="openSeeding('${zEsc(id)}')">✎ Ubah</button>`);
  if (b.Status === 'Diajukan' && !sdBolehAcc(b)) aksiBatch.push(`<span class="sub">${sdMilik(b) ? 'Menunggu acc approver / admin lain.' : 'Menunggu acc approver / admin.'}</span>`);
  if (b.Status === 'Revisi' && (sdMilik(b) || isDecider())) aksiBatch.push(`<button class="btn green" onclick="sdUbah('${zEsc(id)}',{status:'Diajukan'},'Diajukan lagi')">Ajukan lagi</button>`);
  if (['Approved', 'Jalan'].indexOf(b.Status) >= 0 && (sdMilik(b) || isDecider())) aksiBatch.push(`<button class="btn ghost" onclick="sdUbah('${zEsc(id)}',{status:'Selesai'},'Seeding ditandai selesai')">Tandai selesai</button>`);
  if (['Diajukan', 'Revisi', 'Approved'].indexOf(b.Status) >= 0 && (sdMilik(b) || isDecider()) || (b.Status === 'Jalan' && isDecider()))
    aksiBatch.push(`<button class="btn ghost" style="color:var(--red)" onclick="if(this.dataset.y!=='1'){this.dataset.y='1';this.textContent='Yakin batalkan?';return;} sdUbah('${zEsc(id)}',{status:'Dibatalkan'},'Seeding dibatalkan')">Batalkan</button>`);
  let keg = '';
  if (uang && typeof kegiatanData !== 'undefined' && kegiatanData.length) {
    const ids = splitList(b.Kegiatan);
    keg = `<label style="margin-top:8px">Biaya dari kegiatan Budgeting <span class="opt">(sampel, ongkir)</span>
      <select onchange="sdUbah('${zEsc(id)}',{kegiatan:this.value?[this.value]:[]},'Kegiatan ditautkan')"><option value="">— belum ditautkan —</option>${kegiatanData.filter((k) => k.ID && k.Status !== 'Dibatalkan').slice().reverse().slice(0, 80).map((k) => `<option value="${zEsc(k.ID)}" ${ids.indexOf(String(k.ID)) >= 0 ? 'selected' : ''}>${zEsc(k['Item Kegiatan'] || '')} · ${fmtRupiah(k['Estimasi (Rp)'])}</option>`).join('')}</select></label>`;
  }
  const baris = h.ks.map((k) => {
    const st = k.Status || 'Rencana', kid = zEsc(k.ID);
    const btn = [];
    if (sudahAcc && b.Status !== 'Selesai') {
      if (st === 'Rencana') btn.push(`<button class="go" onclick="sdKr('${kid}',{status:'Dikirim'})">📦 Dikirim</button>`);
      if (st === 'Dikirim') btn.push(`<button class="go" onclick="sdKr('${kid}',{status:'Diterima'})">✅ Diterima</button>`);
      if (st === 'Dikirim' || st === 'Diterima') btn.push(`<button onclick="sdLink('${kid}')">🎬 Sudah posting</button>`, `<button onclick="sdKr('${kid}',{status:'Tidak posting'})">✕ Tidak posting</button>`);
      if (st === 'Posting') btn.push(`<button onclick="sdLink('${kid}')">✎ Link / views</button>`);
    }
    if ((sdMilik(b) || isDecider()) && ['Ditolak', 'Dibatalkan', 'Selesai'].indexOf(b.Status) < 0) {
      btn.push(`<button title="Ubah akun / nama / platform / varian / jumlah" onclick="sdEditKr('${kid}')">✎</button>`);
      if (st === 'Rencana') btn.push(`<button title="Hapus (belum dikirim)" onclick="if(this.dataset.y!=='1'){this.dataset.y='1';this.textContent='Yakin?';return;} sdSimpan({action:'hapus_kreator',id:'${kid}'},'Hapus kreator','Kreator dihapus.')">🗑</button>`);
    }
    const tgl = st === 'Diterima' && k['Tgl Terima'] ? ' · diterima ' + mktDate(k['Tgl Terima']) : st === 'Dikirim' && k['Tgl Kirim'] ? ' · dikirim ' + mktDate(k['Tgl Kirim']) : '';
    return `<div class="sdk" id="sdk-${kid}"><div class="who"><b>${zEsc(sdAkun(k))}${k.Varian || Number(k.Qty) > 1 ? `<span class="vq">${zEsc([k.Varian, '×' + (Number(k.Qty) || 1)].filter(Boolean).join(' '))}</span>` : ''}</b><span>${zEsc([k.Nama && k.Akun ? k.Nama : '', k.Platform].filter(Boolean).join(' · '))} <span class="ks ${zEsc(st.split(' ')[0])}">${zEsc(st)}</span>${zEsc(tgl)}${k['Link Konten'] ? ` · <a href="${zEsc(k['Link Konten'])}" target="_blank" rel="noopener noreferrer">lihat konten ↗</a>` : ''}${Number(k.Views) ? ' · ' + Number(k.Views).toLocaleString('id-ID') + ' views' : ''}</span></div>
      <div class="act">${btn.join('')}</div></div>`;
  }).join('') || '<div class="empty">Belum ada kreator. Tambahkan di bawah.</div>';
  $('sdd-isi').innerHTML = `<h3>${zEsc(b['Nama Batch'] || '')} <span class="badge sd-${zEsc(b.Status)}">${zEsc(b.Status === 'Diajukan' ? 'Menunggu acc' : b.Status)}</span></h3>
    <div class="hint">${[b.Produk, b.Lane, b.Platform].filter(Boolean).map(zEsc).join(' · ')}${b.Produk || b.Lane || b.Platform ? ' · ' : ''}PIC ${zEsc(picNama(b.PIC) || '-')} · diajukan ${zEsc(picNama(b['Diajukan Oleh']) || '-')}${b['Diputuskan Oleh'] ? ' · diputuskan ' + zEsc(picNama(b['Diputuskan Oleh'])) : ''}</div>
    <div class="sd-angka" style="margin:10px 0"><span><b>${h.n.Posting}</b>/${h.total} posting</span><span>${h.n.Diterima} nunggu konten</span><span>${h.n.Dikirim} di jalan</span><span>${h.n['Tidak posting']} tidak posting</span>${h.views ? `<span><b>${h.views.toLocaleString('id-ID')}</b> views</span>` : ''}${uang && h.biaya ? `<span>biaya ${h.est ? '≈' : ''}<b>${fmtRupiah(h.biaya)}</b>${h.n.Posting ? ' · per konten ' + fmtRupiah(h.biaya / h.n.Posting) : ''}</span>` : ''}</div>
    ${h.vp.length ? `<div class="sd-vprog">${h.vp.map((v) => `<div class="v"><div class="t"><span>${zEsc(v.varian)}</span><span><b>${v.keluar}</b>${v.rencana ? '/' + v.rencana : ''} pcs keluar</span></div>${v.rencana ? `<div class="bar"><i style="width:${Math.min(100, v.keluar / v.rencana * 100)}%"></i></div>` : ''}</div>`).join('')}</div>` : ''}
    ${!sudahAcc && b.Status !== 'Ditolak' ? '<div class="note" style="display:block">Sampel baru boleh dikirim setelah seeding ini di-acc.</div>' : ''}
    <div class="sd-acts">${aksiBatch.join('')}</div>
    ${b.Catatan ? `<div class="hint" style="white-space:pre-wrap">${zEsc(String(b.Catatan).split(' | ').join('\n'))}</div>` : ''}
    ${keg}
    <h4 style="margin:14px 0 4px">Kreator (${h.total})</h4>${baris}
    ${['Ditolak', 'Selesai', 'Dibatalkan'].indexOf(b.Status) < 0 ? `<label style="margin-top:10px">Tambah kreator <span class="opt">(satu per baris: @akun - platform - nama)</span><textarea id="sdd-tambah" rows="2" placeholder="@sari.lari - TikTok"></textarea></label>
      <button class="btn ghost" onclick="sdTambah('${zEsc(id)}')">+ Tambah</button>` : ''}`;
  if (!$('m-seeddetail').classList.contains('show')) openModal('m-seeddetail');
}
function sdSimpan(payload, label, okMsg) { enqueueSave({ label, payload, okMsg }); }
function sdPutus(id, status) {
  const b = M.seeding.find((x) => x.ID === id);
  let alasan = '';
  if (status !== 'Approved') { alasan = (window.prompt(status === 'Ditolak' ? 'Alasan ditolak (opsional):' : 'Apa yang perlu direvisi?') || '').trim(); }
  sdSimpan({ action: 'putuskan_seeding', id, status, alasan }, (status === 'Approved' ? 'Acc' : status) + ': ' + (b ? b['Nama Batch'] : 'seeding'), 'Seeding ' + (status === 'Approved' ? 'di-acc' : status === 'Ditolak' ? 'ditolak' : 'diminta revisi') + '.');
}
function sdUbah(id, isi, okMsg) { sdSimpan(Object.assign({ action: 'update_seeding', id }, isi), okMsg, okMsg + '.'); }
function sdKr(kid, isi) {
  const k = (M.seeding_kreator || []).find((x) => x.ID === kid);
  sdSimpan(Object.assign({ action: 'update_kreator', id: kid }, isi), (k ? sdAkun(k) : 'Kreator') + ': ' + (isi.status || 'Posting'), (k ? sdAkun(k) : 'Kreator') + ' → ' + (isi.status || 'Posting') + '.');
}
function sdLink(kid) {
  const row = $('sdk-' + kid); if (!row || row.querySelector('.linkrow')) return;
  const k = (M.seeding_kreator || []).find((x) => x.ID === kid) || {};
  const d = document.createElement('div'); d.className = 'linkrow';
  d.innerHTML = `<input type="url" placeholder="https://… link konten" value="${zEsc(k['Link Konten'] || '')}"><input type="number" placeholder="views" style="max-width:90px" value="${Number(k.Views) || ''}"><button class="btn green">Simpan</button>`;
  d.querySelector('button').onclick = () => {
    const link = d.querySelector('input').value.trim(), views = d.querySelectorAll('input')[1].value;
    if (link && !/^https?:\/\/\S+$/i.test(link)) { toast('Link harus diawali http:// atau https://', 'err'); return; }
    sdKr(kid, Object.assign({ status: 'Posting' }, link ? { link } : {}, views !== '' ? { views } : {}));
  };
  row.appendChild(d); d.querySelector('input').focus();
}
function sdEditKr(kid) {
  const row = $('sdk-' + kid); if (!row || row.querySelector('.linkrow')) return;
  const k = (M.seeding_kreator || []).find((x) => x.ID === kid) || {};
  const d = document.createElement('div'); d.className = 'linkrow';
  const b = M.seeding.find((x) => String(x.ID) === String(k.Batch)) || {};
  const vs = splitList(b.Lane).concat(M.lane).filter((x, i, a) => a.indexOf(x) === i).concat(k.Varian && splitList(b.Lane).concat(M.lane).indexOf(k.Varian) < 0 ? [k.Varian] : []);
  d.innerHTML = `<input placeholder="akun" value="${zEsc(k.Akun ? '@' + String(k.Akun).replace(/^@+/, '') : '')}"><input placeholder="nama" value="${zEsc(k.Nama || '')}"><input placeholder="platform" value="${zEsc(k.Platform || '')}"><select><option value="">varian</option>${vs.map((x) => `<option ${x === k.Varian ? 'selected' : ''}>${zEsc(x)}</option>`).join('')}</select><input class="qty" type="number" min="1" inputmode="numeric" placeholder="pcs" value="${Number(k.Qty) || 1}"><button class="btn green">Simpan</button>`;
  d.querySelector('button').onclick = () => {
    const [a, n, p, q] = Array.from(d.querySelectorAll('input')).map((x) => x.value.trim());
    const v = d.querySelector('select').value;
    const isi = { action: 'update_kreator', id: kid };
    if (v !== (k.Varian || '')) isi.varian = v;
    if (Number(q) !== (Number(k.Qty) || 1)) { if (!(Number(q) > 0)) { toast('Jumlah sampel minimal 1.', 'err'); return; } isi.qty = Number(q); }
    if (a !== (k.Akun ? '@' + String(k.Akun).replace(/^@+/, '') : '')) isi.akun_baru = a;
    if (n !== (k.Nama || '')) isi.nama_baru = n;
    if (p !== (k.Platform || '')) isi.platform_baru = p;
    if (Object.keys(isi).length === 2) { d.remove(); return; }
    sdSimpan(isi, 'Ubah kreator', 'Data kreator diperbarui.');
  };
  row.appendChild(d); d.querySelector('input').focus();
}
function sdTambah(id) {
  const v = $('sdd-tambah').value.trim();
  if (!v) { toast('Tulis dulu akun kreatornya.', 'err'); return; }
  sdSimpan({ action: 'add_kreator', batch: id, kreator: v }, 'Tambah kreator', 'Kreator ditambahkan.');
}
