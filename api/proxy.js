// Vercel Function: browser -> /api/proxy -> Apps Script
//
// Env variable yang harus diisi di Vercel (Project Settings -> Environment Variables):
//   SECRET_ZERODEO   kunci tanda tangan token dari Hub Pinggiran. SAMA PERSIS dengan SECRET_ZERODEO di Script
//                    Properties Hub dan di Script Properties Apps Script Zerodeo.
//   APPS_SCRIPT_URL  URL web app Apps Script (.../exec), TIDAK ditulis di repo
//   SHARED_SECRET    string acak panjang, sama persis dengan Script Property SHARED_SECRET di Apps Script
//                    (WAJIB: tanpa ini proxy menolak jalan)
//   TEAM_CODE        (SEMENTARA, opsional) kode tim lama. Selama diisi, orang yang belum masuk lewat Hub masih bisa
//                    membaca dan mencatat, tetapi TANPA identitas, jadi tidak bisa approve/ubah keputusan.
//                    HAPUS setelah semua orang masuk lewat Hub.
//
// Masuk: browser mengirim token dari Hub di header "x-hub-token". Proxy memverifikasi tanda tangan (HMAC-SHA256),
// app = "zerodeo", dan masa berlaku, lalu meneruskan identitas yang SUDAH terverifikasi ke Apps Script di body.hub.
// Isian "hub" dan "secret" dari browser selalu ditimpa.
//
// Ubah env -> wajib Redeploy supaya berlaku.

const crypto = require('crypto');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

const PERAN = ['anggota', 'admin', 'approver'];

// Mengembalikan {uid, peran} kalau token sah untuk app ini, selain itu null.
function verifyHubToken(token, secret, nowMs) {
  const parts = String(token || '').split('.');
  if (!secret || parts.length !== 2) return null;
  const sig = crypto.createHmac('sha256', secret).update(parts[0]).digest('base64').replace(/\+/g, '-').replace(/\//g, '_');
  if (!safeEqual(sig, parts[1])) return null;
  let d;
  try { d = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (e) { return null; }
  const now = Math.floor((nowMs === undefined ? Date.now() : nowMs) / 1000);
  if (!d || typeof d.uid !== 'string' || d.app !== 'zerodeo' || !(d.exp > now) || !(d.iat <= now + 60)) return null;
  if (PERAN.indexOf(d.peran) === -1) return null;   // token servis (peran "service") bukan untuk browser
  if (!/^[a-z0-9_-]{2,30}$/.test(d.uid)) return null;
  return { uid: d.uid, peran: d.peran };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { TEAM_CODE, APPS_SCRIPT_URL, SHARED_SECRET, SECRET_ZERODEO } = process.env;

  if (!APPS_SCRIPT_URL || !SHARED_SECRET || !(SECRET_ZERODEO || TEAM_CODE)) {
    return res.status(500).json({ ok: false, error: 'Server belum dikonfigurasi (env APPS_SCRIPT_URL / SHARED_SECRET / SECRET_ZERODEO).' });
  }

  // Identitas: token Hub yang sah, atau (sementara) kode tim lama tanpa identitas.
  let who = null;
  const token = req.headers['x-hub-token'];
  if (token) {
    who = verifyHubToken(token, SECRET_ZERODEO);
    if (!who) {
      await new Promise((r) => setTimeout(r, 400));
      return res.status(401).json({ ok: false, error: 'Sesi dari Hub tidak valid atau sudah habis.', code: 'LOGIN_HUB' });
    }
  } else if (!(TEAM_CODE && safeEqual(req.headers['x-team-code'], TEAM_CODE))) {
    await new Promise((r) => setTimeout(r, 400)); // perlambat tebak-tebakan
    return res.status(401).json({ ok: false, error: 'Masuk lewat Hub dulu.', code: 'LOGIN_HUB' });
  }

  try {
    let upstream;
    if (req.method === 'GET') {
      // Pembacaan data dikirim sebagai POST (action "get_data") supaya secret ada di body,
      // bukan di URL (URL tercatat di log). Hanya "fresh=1" yang diteruskan dari browser.
      const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      const body = { action: 'get_data', fresh: !!(q && q.fresh === '1'), secret: SHARED_SECRET, hub: who };
      upstream = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' });
    } else if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = null; }
      }
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ ok: false, error: 'Body tidak valid.' });
      }
      body.secret = SHARED_SECRET;
      body.hub = who;   // identitas terverifikasi (atau null); isian "hub" dari browser ditimpa
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

module.exports.verifyHubToken = verifyHubToken;
