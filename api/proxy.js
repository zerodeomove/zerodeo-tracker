// Vercel Function: browser -> /api/proxy -> Apps Script
//
// Env variable yang harus diisi di Vercel (Project Settings -> Environment Variables):
//   TEAM_CODE        kode akses tim (minimal 8 karakter, jangan angka pendek)
//   APPS_SCRIPT_URL  URL web app Apps Script (.../exec), TIDAK ditulis di repo
//   SHARED_SECRET    string acak panjang, sama persis dengan Script Property
//                    SHARED_SECRET di Apps Script
//
// Ubah env -> wajib Redeploy supaya berlaku.

const crypto = require('crypto');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { TEAM_CODE, APPS_SCRIPT_URL, SHARED_SECRET } = process.env;

  if (!TEAM_CODE || !APPS_SCRIPT_URL) {
    return res.status(500).json({ ok: false, error: 'Server belum dikonfigurasi (env TEAM_CODE / APPS_SCRIPT_URL).' });
  }

  if (!safeEqual(req.headers['x-team-code'], TEAM_CODE)) {
    await new Promise((r) => setTimeout(r, 400)); // perlambat tebak-tebakan kode
    return res.status(401).json({ ok: false, error: 'Kode akses salah.' });
  }

  try {
    let upstream;
    if (req.method === 'GET') {
      const url = new URL(APPS_SCRIPT_URL);
      if (SHARED_SECRET) url.searchParams.set('secret', SHARED_SECRET);
      // Hanya "fresh=1" (lewati cache Apps Script) yang diteruskan dari browser.
      const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      if (q && q.fresh === '1') url.searchParams.set('fresh', '1');
      upstream = await fetch(url.toString(), { redirect: 'follow' });
    } else if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = null; }
      }
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ ok: false, error: 'Body tidak valid.' });
      }
      if (SHARED_SECRET) body.secret = SHARED_SECRET;
      // Content-Type default (text/plain) memang disengaja: Apps Script tidak mendukung preflight
      upstream = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' });
    } else {
      return res.status(405).json({ ok: false, error: 'Method tidak didukung.' });
    }

    const text = await upstream.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return res.status(502).json({ ok: false, error: 'Respons Apps Script bukan JSON (cek akses deployment "Anyone" dan izin script).' });
    }
    return res.status(200).json(json);
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'Gagal menghubungi Apps Script: ' + err.message });
  }
};
