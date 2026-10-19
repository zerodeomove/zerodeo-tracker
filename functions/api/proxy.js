// Cloudflare Pages Function: browser -> /api/proxy -> Apps Script
//
// Versi Cloudflare dari api/proxy.js (Vercel). Perilakunya sama persis; yang berbeda hanya API platform
// (Request/Response standar dan Web Crypto, bukan req/res Node). Repo yang sama bisa dipasang di Cloudflare Pages
// (memakai folder functions/) maupun di Vercel (memakai folder api/).
//
// Variabel yang harus diisi di Cloudflare (Pages -> Settings -> Variables and Secrets, jenis Secret):
//   SECRET_ZERODEO   kunci tanda tangan token dari Hub Pinggiran. SAMA PERSIS dengan SECRET_ZERODEO di Script
//                    Properties Hub dan di Script Properties Apps Script Zerodeo.
//   APPS_SCRIPT_URL  URL web app Apps Script (.../exec)
//   SHARED_SECRET    string acak panjang, sama persis dengan Script Property SHARED_SECRET di Apps Script
//   TEAM_CODE        (SEMENTARA, opsional) kode tim lama; sebaiknya TIDAK diisi di Cloudflare.
//
// Ubah variabel -> deploy ulang supaya berlaku.

const PERAN = ['anggota', 'admin', 'approver', 'marketing'];
const enc = new TextEncoder();

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

// Perbandingan waktu-tetap (tidak berhenti di karakter pertama yang beda).
function safeEqual(a, b) {
  const x = enc.encode(String(a || ''));
  const y = enc.encode(String(b || ''));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function b64urlFromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_');
}

// Token dari Hub (Apps Script, base64EncodeWebSafe) membawa padding "=" di ujung; tanda tangan dibandingkan tanpa padding.
const noPad = (v) => String(v || '').replace(/=+$/, '');

function utf8FromB64url(b64url) {
  let b = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  const bin = atob(b);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Mengembalikan {uid, peran} kalau token sah untuk app ini, selain itu null.
export async function verifyHubToken(token, secret, nowMs) {
  const parts = String(token || '').split('.');
  if (!secret || parts.length !== 2) return null;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64urlFromBytes(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(parts[0]))));
  if (!safeEqual(noPad(sig), noPad(parts[1]))) return null;
  let d;
  try { d = JSON.parse(utf8FromB64url(parts[0])); } catch (e) { return null; }
  const now = Math.floor((nowMs === undefined ? Date.now() : nowMs) / 1000);
  if (!d || typeof d.uid !== 'string' || d.app !== 'zerodeo' || !(d.exp > now) || !(d.iat <= now + 60)) return null;
  if (PERAN.indexOf(d.peran) === -1) return null;   // token servis (peran "service") bukan untuk browser
  if (!/^[a-z0-9_-]{2,30}$/.test(d.uid)) return null;
  return { uid: d.uid, peran: d.peran };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function onRequest(context) {
  const { request } = context;
  const env = context.env || {};
  const { TEAM_CODE, APPS_SCRIPT_URL, SHARED_SECRET, SECRET_ZERODEO } = env;

  if (!APPS_SCRIPT_URL || !SHARED_SECRET || !(SECRET_ZERODEO || TEAM_CODE)) {
    return json({ ok: false, error: 'Server belum dikonfigurasi (variabel APPS_SCRIPT_URL / SHARED_SECRET / SECRET_ZERODEO).' }, 500);
  }

  // Identitas: token Hub yang sah, atau (sementara) kode tim lama tanpa identitas.
  let who = null;
  const token = request.headers.get('x-hub-token');
  if (token) {
    who = await verifyHubToken(token, SECRET_ZERODEO);
    if (!who) {
      await sleep(400);
      return json({ ok: false, error: 'Sesi dari Hub tidak valid atau sudah habis.', code: 'LOGIN_HUB' }, 401);
    }
  } else if (!(TEAM_CODE && safeEqual(request.headers.get('x-team-code'), TEAM_CODE))) {
    await sleep(400); // perlambat tebak-tebakan
    return json({ ok: false, error: 'Masuk lewat Hub dulu.', code: 'LOGIN_HUB' }, 401);
  }

  try {
    let payload;
    if (request.method === 'GET') {
      // Pembacaan data dikirim sebagai POST (action "get_data") supaya secret ada di body, bukan di URL.
      const fresh = new URL(request.url).searchParams.get('fresh') === '1';
      payload = { action: 'get_data', fresh: fresh, secret: SHARED_SECRET, hub: who };
    } else if (request.method === 'POST') {
      let body = null;
      try { body = JSON.parse(await request.text()); } catch (e) { body = null; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json({ ok: false, error: 'Body tidak valid.' }, 400);
      }
      body.secret = SHARED_SECRET;
      body.hub = who;   // identitas terverifikasi (atau null); isian "hub" dari browser ditimpa
      payload = body;
    } else {
      return json({ ok: false, error: 'Method tidak didukung.' }, 405);
    }
    // Content-Type default (text/plain) memang disengaja: Apps Script tidak mendukung preflight
    const upstream = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload), redirect: 'follow' });
    const text = await upstream.text();
    let out;
    try {
      out = JSON.parse(text);
    } catch (e) {
      return json({ ok: false, error: 'Respons Apps Script bukan JSON (cek akses deployment "Anyone" dan izin script).' }, 502);
    }
    return json(out, 200);
  } catch (err) {
    return json({ ok: false, error: 'Gagal menghubungi Apps Script: ' + err.message }, 502);
  }
}
