// Google Apps Script API palsu untuk menjalankan Code.gs + Marketing.gs + Hub.gs di Node (tanpa dependensi).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const toSigned = (buf) => Array.from(buf).map((b) => (b > 127 ? b - 256 : b));
const toBuf = (bytes) => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b)));
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');   // dengan padding "=", seperti Apps Script

function makeSheet(name, rows) {
  const sh = { name, rows: rows || [], protectedWarn: false };
  sh.getLastRow = () => sh.rows.length;
  sh.getLastColumn = () => sh.rows.reduce((m, r) => Math.max(m, r.length), 0);
  sh.getMaxRows = () => Math.max(sh.rows.length, 500);
  sh.setFrozenRows = () => {};
  sh.setColumnWidth = () => {};
  sh.clear = () => { sh.rows = []; return sh; };
  sh.appendRow = (vals) => { sh.rows.push(vals.slice()); };
  sh.protect = () => { const p = { setDescription() { return p; }, setWarningOnly() { sh.protectedWarn = true; return p; } }; return p; };
  sh.getRange = (r, c, nr, nc) => {
    nr = nr || 1; nc = nc || 1;
    const rng = {
      getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (sh.rows[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); } return out; },
      setValues: (vals) => { vals.forEach((rv, i) => { while (sh.rows.length < r + i) sh.rows.push([]); rv.forEach((v, j) => { sh.rows[r - 1 + i][c - 1 + j] = v; }); }); return rng; },
      getValue: () => ((sh.rows[r - 1] || [])[c - 1] === undefined ? '' : sh.rows[r - 1][c - 1]),
      setValue: (v) => { while (sh.rows.length < r) sh.rows.push([]); sh.rows[r - 1][c - 1] = v; return rng; },
      getFormula: () => '',
    };
    ['setFontWeight', 'setFontColor', 'setBackground', 'setHorizontalAlignment', 'setVerticalAlignment', 'setWrap', 'setNumberFormat', 'setNumberFormats', 'setFormula', 'setDataValidation']
      .forEach((f) => { rng[f] = () => rng; });
    return rng;
  };
  return sh;
}

function makeEnv(initialProps) {
  const props = Object.assign({}, initialProps);
  const cache = {};
  const sheets = {};
  const ctx = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); }, remove: (k) => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, getContent() { return t; }, setMimeType() { return this; } }) },
    Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: (nm) => sheets[nm] || null,
      insertSheet: (nm) => { sheets[nm] = makeSheet(nm); return sheets[nm]; },
      getSpreadsheetTimeZone: () => 'Asia/Jakarta',
    }) },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased() { return this; }, everyDays() { return this; }, atHour() { return this; }, create() {} }), deleteTrigger() {} },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      computeHmacSha256Signature: (value, key) => toSigned(crypto.createHmac('sha256', key).update(value, 'utf8').digest()),
      base64EncodeWebSafe: (v) => b64url(typeof v === 'string' ? Buffer.from(v, 'utf8') : toBuf(v)),
      base64DecodeWebSafe: (s) => toSigned(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: (bytes) => ({ getDataAsString: () => toBuf(bytes).toString('utf8') }),
      formatDate: (d, tz, fmt) => {
        const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        return fmt === 'yyyy-MM-dd' ? p : p;
      },
    },
    UrlFetchApp: { fetch: () => { throw new Error('UrlFetchApp belum diatur'); } },
  };
  vm.createContext(ctx);
  const root = path.join(__dirname, '..');
  ['Marketing.gs', 'Code.gs', 'Hub.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
  return { ctx, props, cache, sheets };
}

// token seperti yang diterbitkan Hub (spesifikasi di hub-backend/README.md di repo juanda-hub)
function hubToken(secret, claims, nowMs) {
  const now = Math.floor((nowMs === undefined ? Date.now() : nowMs) / 1000);
  const payload = b64url(Buffer.from(JSON.stringify(Object.assign({ app: 'zerodeo', iat: now, exp: now + 12 * 3600 }, claims)), 'utf8'));
  return payload + '.' + b64url(crypto.createHmac('sha256', secret).update(payload).digest());
}

module.exports = { makeEnv, makeSheet, hubToken, b64url };
