// Helper bersama semua halaman: sesi dari Hub Pinggiran + panggilan ke /api/proxy.
// Masuk = lewat Hub (login sekali). Hub membuka halaman ini dengan token di fragment URL (#t=...);
// token dibaca, disimpan di perangkat, lalu langsung dihapus dari alamat. Tidak ada form login di sini.
(function () {
  const TOKEN_KEY = 'zerodeo_hub_token';
  const LEGACY_KEY = 'zerodeo_team_code';        // kode tim lama, hanya dipakai selama masa transisi
  const HUB_URL = 'https://pinggiran.vercel.app';   // alamat Hub (publik)
  const API = '/api/proxy';
  const CACHE_KEY = 'zerodeo_data_cache_v1';   // data terakhir di perangkat ini (per pengguna), supaya dashboard langsung tampil

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* mode privat: abaikan */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } }

  // Token dari Hub ada di fragment URL. Simpan, lalu hapus dari alamat supaya tidak ikut ke riwayat/bagikan link.
  (function takeTokenFromUrl() {
    const m = /(?:^#|&)t=([^&]+)/.exec(location.hash || '');
    if (!m) return;
    try { lsSet(TOKEN_KEY, decodeURIComponent(m[1])); } catch (e) { /* abaikan */ }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* abaikan */ }
  })();

  // Isi token (HANYA untuk tampilan; yang sebenarnya memeriksa adalah server): {uid, peran, exp} atau null.
  function claims() {
    const t = lsGet(TOKEN_KEY);
    if (!t) return null;
    try {
      let p = t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      const d = JSON.parse(decodeURIComponent(escape(atob(p))));
      if (!d || typeof d.uid !== 'string' || !(d.exp * 1000 > Date.now())) return null;
      return { uid: d.uid, peran: d.peran, exp: d.exp };
    } catch (e) { return null; }
  }

  // Layar "Masuk lewat Hub" menutupi halaman. Tidak ada kolom isian: login dilakukan di Hub.
  function showLoginHub(msg) {
    if (document.getElementById('hubGate')) { document.getElementById('hubGateMsg').textContent = msg; return; }
    const wrap = document.createElement('div');
    wrap.id = 'hubGate';
    wrap.setAttribute('role', 'alertdialog');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(10,12,12,.72);padding:16px';
    wrap.innerHTML = '<div style="background:#fff;color:#1d1f1e;max-width:360px;width:100%;border-radius:14px;padding:24px;font-family:system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.3)">' +
      '<h2 style="margin:0 0 8px;font-size:18px">Masuk lewat Hub</h2>' +
      '<p id="hubGateMsg" style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#555"></p>' +
      '<a id="hubGateLink" style="display:inline-block;background:#2f6f5e;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px"></a></div>';
    document.body.appendChild(wrap);
    document.getElementById('hubGateMsg').textContent = msg;
    const a = document.getElementById('hubGateLink');
    a.href = HUB_URL; a.textContent = 'Buka Hub';
  }

  async function call(method, body, query) {
    const token = lsGet(TOKEN_KEY);
    const legacy = lsGet(LEGACY_KEY);
    const headers = {};
    if (token) headers['x-hub-token'] = token;
    else if (legacy) headers['x-team-code'] = legacy;   // transisi: yang sudah pernah memasukkan kode masih bisa jalan, tanpa identitas
    else { showLoginHub('Buka Zerodeo dari Hub supaya kami tahu siapa kamu. Login cukup sekali di Hub.'); throw new Error('Masuk lewat Hub dulu.'); }

    const opts = { method: method, headers: headers };
    if (body) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(API + (query || ''), opts);
    if (res.status === 401) {
      if (token) lsDel(TOKEN_KEY); else lsDel(LEGACY_KEY);
      lsDel(CACHE_KEY);
      showLoginHub(token ? 'Sesimu dari Hub sudah habis. Buka lagi dari Hub (cukup klik kartu Zerodeo).' : 'Masuk lewat Hub dulu, ya.');
      throw new Error('Masuk lewat Hub dulu.');
    }
    let json;
    try { json = await res.json(); } catch (e) { throw new Error('Respons server tidak valid (HTTP ' + res.status + ').'); }
    return json;
  }

  // Data terakhir yang diterima, disimpan per pengguna. Dihapus saat Keluar atau sesi ditolak. Tidak disimpan kalau terlalu besar.
  function cacheRead() {
    const c = claims();
    if (!c) return null;
    try {
      const x = JSON.parse(lsGet(CACHE_KEY));
      if (x && x.uid === c.uid && x.json && x.json.ok !== false) return x;
    } catch (e) { /* tidak ada */ }
    return null;
  }
  function cacheWrite(json) {
    const c = claims();
    if (!c) return;
    try {
      const text = JSON.stringify({ uid: c.uid, at: Date.now(), json: json });
      if (text.length < 4000000) lsSet(CACHE_KEY, text); else lsDel(CACHE_KEY);
    } catch (e) { /* abaikan */ }
  }

  window.zApi = {
    // fresh = true: lewati cache data di Apps Script (dipakai tombol Refresh)
    get: function (fresh) { return call('GET', null, fresh ? '?fresh=1' : ''); },
    post: function (b) { return call('POST', b); },
    me: claims,          // {uid, peran, exp} atau null (untuk tampilan saja)
    logout: function () { lsDel(TOKEN_KEY); lsDel(LEGACY_KEY); lsDel(CACHE_KEY); location.href = HUB_URL; },
    cacheRead: cacheRead,
    cacheWrite: cacheWrite,   // hapus sesi di perangkat ini lalu ke Hub
    hubUrl: HUB_URL
  };

  // Escape HTML — semua teks dari user wajib lewat ini sebelum masuk innerHTML
  window.zEsc = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
})();
