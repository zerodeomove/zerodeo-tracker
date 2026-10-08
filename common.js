// Helper bersama semua halaman: kode akses tim + panggilan ke /api/proxy.
(function () {
  const KEY = 'zerodeo_team_code';
  const API = '/api/proxy';

  function askCode(msg) {
    const c = prompt(msg || 'Masukkan kode akses tim Zerodeo:');
    if (c && c.trim()) { localStorage.setItem(KEY, c.trim()); return c.trim(); }
    return null;
  }

  async function call(method, body, attempt, query) {
    attempt = attempt || 0;
    const code = localStorage.getItem(KEY) || askCode(attempt > 0 ? 'Kode salah. Masukkan lagi:' : null);
    if (!code) throw new Error('Kode akses dibutuhkan.');
    const opts = { method: method, headers: { 'x-team-code': code } };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(API + (query || ''), opts);
    if (res.status === 401) {
      localStorage.removeItem(KEY);
      if (attempt < 2) return call(method, body, attempt + 1, query);
      throw new Error('Kode akses salah.');
    }
    let json;
    try { json = await res.json(); } catch (e) { throw new Error('Respons server tidak valid (HTTP ' + res.status + ').'); }
    return json;
  }

  window.zApi = {
    // fresh = true: lewati cache data di Apps Script (dipakai tombol Refresh)
    get: function (fresh) { return call('GET', null, 0, fresh ? '?fresh=1' : ''); },
    post: function (b) { return call('POST', b); }
  };

  // Escape HTML — semua teks dari user wajib lewat ini sebelum masuk innerHTML
  window.zEsc = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
})();
