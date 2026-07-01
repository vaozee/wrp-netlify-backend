/**
 * ============================================================================
 *  WAR ROOM PLANTATION — BACKEND (Netlify Functions + Google Sheets API)
 *  Pengganti Google Apps Script Web App (menghindari blokir ISP ke
 *  script.google.com / script.googleusercontent.com).
 * ============================================================================
 *  ENDPOINT: https://<site-anda>.netlify.app/.netlify/functions/wrp
 *  (atau via redirect: https://<site-anda>.netlify.app/api/wrp )
 *
 *  Cara pakai dari frontend: SAMA PERSIS seperti Apps Script lama —
 *  GET  ?action=getProduksi&tahun=2026...
 *  POST JSON body { action: 'login', username: '...', password: '...' }
 *  Response format juga sama: { ok, count, data } / { ok, error }
 *
 *  ENV VARS yang WAJIB diisi di Netlify (Site settings -> Environment variables):
 *   - GOOGLE_SERVICE_ACCOUNT_EMAIL   -> email service account (...@...iam.gserviceaccount.com)
 *   - GOOGLE_PRIVATE_KEY             -> private key dari JSON key (JAGA KERAHASIAANNYA)
 *                                       (paste apa adanya, boleh multi-baris; kode ini
 *                                        otomatis menangani \n literal maupun baris asli)
 *   - SPREADSHEET_ID_PRODUKSI        -> (opsional, default sudah diisi di bawah)
 *   - SPREADSHEET_ID_PKS             -> (opsional, default sudah diisi di bawah)
 * ============================================================================
 */

const { google } = require('googleapis');

// ── KONFIGURASI (sama seperti Code.gs lama) ────────────────────────────────
const SPREADSHEET_ID_PRODUKSI = process.env.SPREADSHEET_ID_PRODUKSI || '15VzZknIpWjCKGnqPO1DAW5cJN2y5ooFHHqhNjZ37LWA';
const SPREADSHEET_ID_PKS      = process.env.SPREADSHEET_ID_PKS      || '1ZI2Buqb-TmePjC1Sp-53J1s0T_wVcPUgYKObIqwnEpM';

const SHEET_PRODUKSI  = 'Produksi';
const SHEET_PKS       = 'PKS';
const SHEET_BLOK      = 'Blok';
const SHEET_BUDGET    = 'Budget';
const SHEET_USERS     = 'Users';
const SHEET_AUDIT     = 'AuditLog';
const SHEET_HARIAN    = 'Harian';
const SHEET_PKS_HARIAN = 'Harian';
const SHEET_PERAWATAN  = 'perawatan';
const SHEET_HIST_PUPUK = 'hist pupuk';
const SHEET_PEM_BLOK   = 'pemupukan blok';
const SHEET_PERBLOK    = 'perblok';

const PRODUKSI_COLS = ['PT','KEBUN','AFD','LUAS','PKK','SPH','BUDGET_TON','SENSUS_TON',
  'BUDGET_KG','SENSUS_KG','JJG','KG','HK','HA_PANEN','TON','BJR','ROTASI','TON_HA',
  'JJG_PKK','OUTPUT_JJG','OUTPUT_KG','BULAN','TAHUN','TANGGAL'];
const PKS_COLS = ['TAHUN','BULAN','KEGIATAN','SER','DATA','SAT','ACTUAL','BUDGET',
  'PCT_PCP','SBI_ACTUAL','SBI_BUDGET','SBI_PCT_PCP'];
const BLOK_COLS   = ['KODE','ESTATE','AFD','LUAS_HA','TAHUN_TANAM','JENIS','POPULASI','STATUS'];
const BUDGET_COLS = ['TAHUN','BULAN','ESTATE','BUDGET_KG','HK_RENCANA'];
const USERS_COLS  = ['USERNAME','NAMA','EMAIL','PASSWORD_HASH','SALT','ROLE','ESTATE_AKSES','STATUS','LAST_LOGIN'];
const AUDIT_COLS  = ['TIMESTAMP','USERNAME','KATEGORI','AKSI','IP'];
const HARIAN_COLS = ['TANGGAL','KEBUN','AFD','JJG','KG','HK','RESTAN_KG'];
const PKS_HARIAN_COLS = ['TANGGAL','TAHUN','BULAN','KEGIATAN','SER','DATA','SAT','ACTUAL','BUDGET'];

// ── AUTH GOOGLE SHEETS API ──────────────────────────────────────────────────
let sheetsClientPromise = null;
function getSheetsClient() {
  if (!sheetsClientPromise) {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    let key = process.env.GOOGLE_PRIVATE_KEY || '';
    key = key.replace(/\\n/g, '\n'); // handle \n literal dari env var
    if (!email || !key) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY belum diset di Netlify env vars');
    }
    const auth = new google.auth.JWT(email, null, key, ['https://www.googleapis.com/auth/spreadsheets']);
    sheetsClientPromise = auth.authorize().then(() => google.sheets({ version: 'v4', auth }));
  }
  return sheetsClientPromise;
}

// Cache metadata (sheetId per tab) supaya delete row tidak perlu getMeta berulang
const metaCache = {};
async function getSheetMeta(sheets, spreadsheetId) {
  if (metaCache[spreadsheetId]) return metaCache[spreadsheetId];
  const res = await sheets.spreadsheets.get({ spreadsheetId });
  const map = {};
  (res.data.sheets || []).forEach(s => { map[s.properties.title] = s.properties.sheetId; });
  metaCache[spreadsheetId] = map;
  return map;
}

function colLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ── BACA SHEET ───────────────────────────────────────────────────────────
async function readValues(sheets, spreadsheetId, sheetName) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheetName });
    return res.data.values || [];
  } catch (e) {
    const msg = (e && e.errors && e.errors[0] && e.errors[0].message) || e.message || '';
    if (/Unable to parse range/.test(msg) || (e.code === 400)) return null; // sheet tidak ada
    throw e;
  }
}

// Mirip sheetToObjects Apps Script: kolom FIXED order, skip baris header (baris 1)
function rowsFixed(values, colNames) {
  if (!values || values.length < 2) return [];
  return values.slice(1).map(row => {
    const o = {};
    colNames.forEach((c, i) => { o[c] = row[i] !== undefined ? row[i] : ''; });
    return o;
  }).filter(o => Object.values(o).some(v => v !== '' && v !== null));
}

// Mirip getPerawatan/getPerblok dkk: header DINAMIS dari baris 1
function rowsDynamic(values) {
  if (!values || values.length < 2) return [];
  const headers = values[0].map(h => String(h).trim().toUpperCase().replace(/\s+/g, '_'));
  return values.slice(1).map(row => {
    const o = {};
    headers.forEach((h, i) => { o[h] = row[i] !== undefined ? row[i] : ''; });
    return o;
  }).filter(o => Object.values(o).some(v => v !== '' && v !== null));
}

function parseNum(v) {
  if (v === '' || v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function normalizeDateStr(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (s === '') return '';
  let d;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) d = new Date(s);
  else if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(s)) {
    const parts = s.split(/[\/\-]/);
    d = new Date(+parts[2], +parts[1] - 1, +parts[0]);
  } else d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().substring(0, 10);
}

// ── TULIS SHEET ──────────────────────────────────────────────────────────
async function appendRow(sheets, spreadsheetId, sheetName, rowVals) {
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: sheetName,
    valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowVals] }
  });
}
async function appendRows(sheets, spreadsheetId, sheetName, rowsVals) {
  if (!rowsVals.length) return;
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: sheetName,
    valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rowsVals }
  });
}
async function updateRow(sheets, spreadsheetId, sheetName, rowNumber, rowVals) {
  const range = `${sheetName}!A${rowNumber}:${colLetter(rowVals.length)}${rowNumber}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId, range, valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowVals] }
  });
}
async function deleteRow(sheets, spreadsheetId, sheetName, rowNumber) {
  const meta = await getSheetMeta(sheets, spreadsheetId);
  const sheetId = meta[sheetName];
  if (sheetId === undefined) throw new Error(`Sheet "${sheetName}" tidak ditemukan`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ deleteDimension: {
      range: { sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber }
    } }] }
  });
}

// ── PASSWORD HASH (identik dengan Apps Script: SHA-256(password+salt), hex) ─
const crypto = require('crypto');
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(String(password) + String(salt), 'utf8').digest('hex');
}
function generateSalt() {
  return crypto.randomBytes(16).toString('hex').substring(0, 16);
}

async function logAudit(sheets, username, kategori, aksi) {
  try {
    await appendRow(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_AUDIT,
      [new Date().toISOString(), username || 'system', kategori || '', aksi || '', '']);
  } catch (e) { /* jangan sampai gagal audit menghentikan aksi utama */ }
}

// ════════════════════════════════════════════════════════════════════════
//  ACTION HANDLERS (1:1 dengan Code.gs)
// ════════════════════════════════════════════════════════════════════════

async function getProduksi(sheets, p) {
  const values = await readValues(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_PRODUKSI);
  let rows = rowsFixed(values, PRODUKSI_COLS);
  if (p.tahun) rows = rows.filter(r => String(r.TAHUN) === String(p.tahun));
  if (p.bulan) rows = rows.filter(r => String(r.BULAN) === String(p.bulan));
  if (p.kebun) rows = rows.filter(r => String(r.KEBUN) === String(p.kebun));
  if (p.afd)   rows = rows.filter(r => String(r.AFD) === String(p.afd));
  rows = rows.map(r => {
    const o = Object.assign({}, r);
    ['LUAS','PKK','SPH','BUDGET_TON','SENSUS_TON','BUDGET_KG','SENSUS_KG','JJG','KG',
      'HK','HA_PANEN','TON','BJR','ROTASI','TON_HA','JJG_PKK','OUTPUT_JJG','OUTPUT_KG']
      .forEach(k => o[k] = parseNum(o[k]));
    o.TANGGAL = normalizeDateStr(o.TANGGAL);
    return o;
  });
  return { ok: true, count: rows.length, data: rows };
}

async function getProduksiHarian(sheets, p) {
  const values = await readValues(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_HARIAN);
  let rows = rowsFixed(values, HARIAN_COLS).map(r => {
    const o = Object.assign({}, r);
    ['JJG','KG','HK','RESTAN_KG'].forEach(k => o[k] = parseNum(o[k]));
    o.TANGGAL = normalizeDateStr(o.TANGGAL);
    return o;
  }).filter(r => r.TANGGAL !== '');
  if (p.tahun) rows = rows.filter(r => r.TANGGAL.substring(0, 4) === String(p.tahun));
  if (p.bulan) rows = rows.filter(r => parseInt(r.TANGGAL.substring(5, 7), 10) === parseInt(p.bulan, 10));
  const byDate = {};
  rows.forEach(r => {
    if (!byDate[r.TANGGAL]) byDate[r.TANGGAL] = { tanggal: r.TANGGAL, jjg: 0, kg: 0, hk: 0, restanKg: 0 };
    byDate[r.TANGGAL].jjg += r.JJG; byDate[r.TANGGAL].kg += r.KG;
    byDate[r.TANGGAL].hk += r.HK; byDate[r.TANGGAL].restanKg += r.RESTAN_KG;
  });
  const result = Object.values(byDate).sort((a, b) => a.tanggal.localeCompare(b.tanggal));
  return { ok: true, count: result.length, data: result, hasTanggalData: result.length > 0 };
}

async function addProduksi(sheets, p) {
  const row = PRODUKSI_COLS.map(c => p[c] !== undefined ? p[c] : (p[c.toLowerCase()] !== undefined ? p[c.toLowerCase()] : ''));
  await appendRow(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_PRODUKSI, row);
  await logAudit(sheets, p.username, 'Produksi', `Tambah data produksi ${p.KEBUN || ''} ${p.AFD || ''} (${p.BULAN || ''}/${p.TAHUN || ''})`);
  return { ok: true };
}

async function importProduksiBulk(sheets, p) {
  const rows = p.rows || [];
  if (!rows.length) return { ok: false, error: 'Tidak ada baris untuk diimpor' };
  let success = 0, failed = 0;
  const toAppend = [];
  rows.forEach(r => {
    try { toAppend.push(PRODUKSI_COLS.map(c => r[c] !== undefined ? r[c] : '')); success++; }
    catch (e) { failed++; }
  });
  await appendRows(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_PRODUKSI, toAppend);
  await logAudit(sheets, p.username, 'Import', `Import bulk produksi: ${success} berhasil, ${failed} gagal`);
  return { ok: true, success, failed, total: rows.length };
}

async function getHarian(sheets, p) {
  const values = await readValues(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_HARIAN);
  let rows = rowsFixed(values, HARIAN_COLS).map((r, i) => {
    const o = Object.assign({ _row: i + 2 }, r);
    ['JJG','KG','HK','RESTAN_KG'].forEach(k => o[k] = parseNum(o[k]));
    o.TANGGAL = normalizeDateStr(o.TANGGAL);
    return o;
  });
  if (p.tahun) rows = rows.filter(r => r.TANGGAL.substring(0, 4) === String(p.tahun));
  if (p.bulan) rows = rows.filter(r => r.TANGGAL && parseInt(r.TANGGAL.substring(5, 7), 10) === parseInt(p.bulan, 10));
  if (p.kebun) rows = rows.filter(r => String(r.KEBUN) === String(p.kebun));
  return { ok: true, count: rows.length, data: rows };
}

async function addHarian(sheets, p) {
  const row = HARIAN_COLS.map(c => p[c] !== undefined ? p[c] : '');
  await appendRow(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_HARIAN, row);
  await logAudit(sheets, p.username, 'Input Harian', `Input harian produksi ${p.KEBUN || ''} ${p.AFD || ''} tgl ${p.TANGGAL || ''}`);
  return { ok: true };
}

async function getPKS(sheets, p) {
  const values = await readValues(sheets, SPREADSHEET_ID_PKS, SHEET_PKS);
  let rows = rowsFixed(values, PKS_COLS);
  if (p.tahun) rows = rows.filter(r => String(r.TAHUN) === String(p.tahun));
  if (p.bulan) rows = rows.filter(r => String(r.BULAN) === String(p.bulan));
  if (p.kegiatan) rows = rows.filter(r => String(r.KEGIATAN).toUpperCase().includes(String(p.kegiatan).toUpperCase()));
  rows = rows.map(r => {
    const o = Object.assign({}, r);
    ['ACTUAL','BUDGET','PCT_PCP','SBI_ACTUAL','SBI_BUDGET','SBI_PCT_PCP'].forEach(k => o[k] = parseNum(o[k]));
    return o;
  });
  return { ok: true, count: rows.length, data: rows };
}

async function getPksHarian(sheets, p) {
  const values = await readValues(sheets, SPREADSHEET_ID_PKS, SHEET_PKS_HARIAN);
  let rows = rowsFixed(values, PKS_HARIAN_COLS).map((r, i) => {
    const o = Object.assign({ _row: i + 2 }, r);
    ['ACTUAL','BUDGET'].forEach(k => o[k] = parseNum(o[k]));
    o.TANGGAL = normalizeDateStr(o.TANGGAL);
    return o;
  }).filter(r => r.TANGGAL !== '');
  if (p.tahun) rows = rows.filter(r => r.TANGGAL.substring(0, 4) === String(p.tahun));
  if (p.bulan) rows = rows.filter(r => parseInt(r.TANGGAL.substring(5, 7), 10) === parseInt(p.bulan, 10));
  if (p.kegiatan) rows = rows.filter(r => String(r.KEGIATAN).toUpperCase().includes(String(p.kegiatan).toUpperCase()));
  rows.sort((a, b) => a.TANGGAL.localeCompare(b.TANGGAL));
  return { ok: true, count: rows.length, data: rows };
}

async function addPksHarian(sheets, p) {
  const row = PKS_HARIAN_COLS.map(c => p[c] !== undefined ? p[c] : '');
  await appendRow(sheets, SPREADSHEET_ID_PKS, SHEET_PKS_HARIAN, row);
  await logAudit(sheets, p.username, 'Input Harian PKS', `Input harian PKS ${p.KEGIATAN || ''} tgl ${p.TANGGAL || ''}`);
  return { ok: true };
}

async function addPksHarianBatch(sheets, p) {
  const rows = p.rows || [];
  if (!rows.length) return { ok: false, error: 'Tidak ada baris untuk disimpan' };
  const toAppend = rows.map(r => PKS_HARIAN_COLS.map(c => {
    if (c === 'TANGGAL') return p.TANGGAL || '';
    if (c === 'TAHUN') return p.TAHUN || '';
    if (c === 'BULAN') return p.BULAN || '';
    return r[c] !== undefined ? r[c] : '';
  }));
  await appendRows(sheets, SPREADSHEET_ID_PKS, SHEET_PKS_HARIAN, toAppend);
  await logAudit(sheets, p.username, 'Input Harian PKS', `Input batch harian PKS tgl ${p.TANGGAL || ''} (${rows.length} item)`);
  return { ok: true, count: rows.length };
}

async function getPerawatan(sheets, p) {
  const values = await readValues(sheets, SPREADSHEET_ID_PKS, SHEET_PERAWATAN);
  if (values === null) return { ok: true, count: 0, data: [], note: 'Sheet "perawatan" tidak ditemukan di DB PKS.' };
  let rows = rowsDynamic(values);
  if (p.tahun) rows = rows.filter(r => { const t = r.TAHUN || r.YEAR || r.PERIODE || ''; return !t || String(t) === String(p.tahun); });
  if (p.kebun) rows = rows.filter(r => String(r.KEBUN || r.ESTATE || '').toUpperCase() === String(p.kebun).toUpperCase());
  if (p.afd)   rows = rows.filter(r => String(r.AFD || '').toUpperCase() === String(p.afd).toUpperCase());
  if (p.blok)  rows = rows.filter(r => String(r.BLOK || r.KODE_BLOK || '').toUpperCase() === String(p.blok).toUpperCase());
  return { ok: true, count: rows.length, data: rows };
}

async function getHistPupuk(sheets, p) {
  const values = await readValues(sheets, SPREADSHEET_ID_PKS, SHEET_HIST_PUPUK);
  if (values === null) return { ok: true, count: 0, data: [], note: 'Sheet "hist pupuk" tidak ditemukan di DB PKS.' };
  let rows = rowsDynamic(values).map(o => {
    ['REALISASI_KG','REKOM_KG','REALISASI','REKOM'].forEach(k => { if (o[k] !== undefined) o[k] = parseNum(o[k]); });
    return o;
  });
  if (p.tahun) rows = rows.filter(r => !r.TAHUN || String(r.TAHUN) === String(p.tahun));
  if (p.kebun) rows = rows.filter(r => String(r.KEBUN || '').toUpperCase() === String(p.kebun).toUpperCase());
  if (p.afd)   rows = rows.filter(r => String(r.AFD || '').toUpperCase() === String(p.afd).toUpperCase());
  return { ok: true, count: rows.length, data: rows };
}

async function getPemupukanBlok(sheets, p) {
  const values = await readValues(sheets, SPREADSHEET_ID_PKS, SHEET_PEM_BLOK);
  if (values === null) return { ok: true, count: 0, data: [], note: 'Sheet "pemupukan blok" tidak ditemukan di DB PKS.' };
  let rows = rowsDynamic(values).map(o => {
    ['REKOM_TOTAL_KG','REKOM_TOTAL','REALISASI_KG_2026','REALISASI_KG_2025','REALISASI_KG_2024'].forEach(k => {
      if (o[k] !== undefined) o[k] = parseNum(o[k]);
    });
    return o;
  });
  if (p.kebun) rows = rows.filter(r => String(r.KEBUN || '').toUpperCase() === String(p.kebun).toUpperCase());
  if (p.afd)   rows = rows.filter(r => String(r.AFD || '').toUpperCase() === String(p.afd).toUpperCase());
  if (p.blok)  rows = rows.filter(r => String(r.BLOK || r.KODE_BLOK || '').toUpperCase() === String(p.blok).toUpperCase());
  return { ok: true, count: rows.length, data: rows };
}

async function getPerblok(sheets, p) {
  const values = await readValues(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_PERBLOK);
  if (values === null) return { ok: true, count: 0, data: [], note: 'Sheet "perblok" tidak ditemukan di History Produksi.' };
  const NUM_COLS = ['TON','TON_AKTUAL','BUDGET_TON','BUD_TON','RENCANA_TON','SENSUS_TON','SEN_TON',
    'POTENSI_TON','BJR','JJG','ROTASI','ROT','HA_PANEN','LUAS_PANEN','LUAS','KG'];
  let rows = rowsDynamic(values).map(o => {
    NUM_COLS.forEach(k => { if (o[k] !== undefined) o[k] = parseNum(o[k]); });
    return o;
  }).filter(o => Object.values(o).some(v => v !== '' && v !== null && v !== 0));

  if (p.tahun) {
    rows = rows.filter(r => {
      const thn = r.TAHUN || r.TAHUN_PANEN || r.PERIODE || r.YEAR || '';
      if (thn) return String(thn) === String(p.tahun);
      const tgl = r.TANGGAL || r.TGL || '';
      if (tgl) { try { return new Date(tgl).getFullYear() === parseInt(p.tahun); } catch (e) { return true; } }
      return true;
    });
  }
  if (p.kebun) rows = rows.filter(r => String(r.KEBUN || r.ESTATE || '').toUpperCase() === String(p.kebun).toUpperCase());
  if (p.afd)   rows = rows.filter(r => String(r.AFD || '').toUpperCase() === String(p.afd).toUpperCase());
  if (p.blok)  rows = rows.filter(r => String(r.BLOK || r.KODE_BLOK || '').toUpperCase() === String(p.blok).toUpperCase());
  return { ok: true, count: rows.length, data: rows };
}

async function getBlok(sheets, p) {
  const values = await readValues(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_BLOK);
  let rows = rowsFixed(values, BLOK_COLS);
  if (p.estate) rows = rows.filter(r => String(r.ESTATE) === String(p.estate));
  rows = rows.map((r, i) => Object.assign({ _row: i + 2 }, r));
  return { ok: true, count: rows.length, data: rows };
}
async function addBlok(sheets, p) {
  await appendRow(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_BLOK, BLOK_COLS.map(c => p[c] !== undefined ? p[c] : ''));
  await logAudit(sheets, p.username, 'Master Blok', `Tambah blok ${p.KODE || ''}`);
  return { ok: true };
}
async function updateBlokFn(sheets, p) {
  if (!p._row) return { ok: false, error: 'Baris (_row) wajib diisi untuk update' };
  await updateRow(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_BLOK, p._row, BLOK_COLS.map(c => p[c] !== undefined ? p[c] : ''));
  await logAudit(sheets, p.username, 'Master Blok', `Edit blok ${p.KODE || ''}`);
  return { ok: true };
}
async function deleteBlokFn(sheets, p) {
  if (!p._row) return { ok: false, error: 'Baris (_row) wajib diisi untuk hapus' };
  await deleteRow(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_BLOK, p._row);
  await logAudit(sheets, p.username, 'Master Blok', `Hapus blok baris ${p._row}`);
  return { ok: true };
}

async function getBudget(sheets, p) {
  const values = await readValues(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_BUDGET);
  let rows = rowsFixed(values, BUDGET_COLS);
  if (p.tahun)  rows = rows.filter(r => String(r.TAHUN) === String(p.tahun));
  if (p.estate) rows = rows.filter(r => String(r.ESTATE) === String(p.estate));
  rows = rows.map((r, i) => Object.assign({ _row: i + 2 }, r, {
    BUDGET_KG: parseNum(r.BUDGET_KG), HK_RENCANA: parseNum(r.HK_RENCANA)
  }));
  return { ok: true, count: rows.length, data: rows };
}
async function setBudget(sheets, p) {
  const values = await readValues(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_BUDGET);
  const rows = rowsFixed(values, BUDGET_COLS);
  const idx = rows.findIndex(r => String(r.TAHUN) === String(p.TAHUN) &&
    String(r.BULAN) === String(p.BULAN) && String(r.ESTATE) === String(p.ESTATE));
  const rowVals = BUDGET_COLS.map(c => p[c] !== undefined ? p[c] : '');
  if (idx >= 0) await updateRow(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_BUDGET, idx + 2, rowVals);
  else await appendRow(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_BUDGET, rowVals);
  await logAudit(sheets, p.username, 'Master Budget', `Set budget ${p.ESTATE || ''} ${p.BULAN || ''}/${p.TAHUN || ''} = ${p.BUDGET_KG || 0} Kg`);
  return { ok: true };
}

async function getUsers(sheets, p) {
  const values = await readValues(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_USERS);
  let rows = rowsFixed(values, USERS_COLS).map((r, i) => {
    const o = Object.assign({ _row: i + 2 }, r);
    delete o.PASSWORD_HASH; delete o.SALT;
    return o;
  });
  return { ok: true, count: rows.length, data: rows };
}
async function addUser(sheets, p) {
  const salt = generateSalt();
  const hash = hashPassword(p.PASSWORD || 'changeme123', salt);
  await appendRow(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_USERS,
    [p.USERNAME || '', p.NAMA || '', p.EMAIL || '', hash, salt, p.ROLE || 'Viewer', p.ESTATE_AKSES || 'Semua', p.STATUS || 'Aktif', '']);
  await logAudit(sheets, p.username, 'Master User', `Tambah user ${p.USERNAME || ''} (${p.ROLE || ''})`);
  return { ok: true };
}
async function updateUserFn(sheets, p) {
  if (!p._row) return { ok: false, error: 'Baris (_row) wajib diisi' };
  const values = await readValues(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_USERS);
  const existing = values[p._row - 1] || [];
  const obj = {};
  USERS_COLS.forEach((c, i) => obj[c] = existing[i] !== undefined ? existing[i] : '');
  ['NAMA','EMAIL','ROLE','ESTATE_AKSES','STATUS'].forEach(k => { if (p[k] !== undefined) obj[k] = p[k]; });
  if (p.PASSWORD) {
    const salt = generateSalt();
    obj.PASSWORD_HASH = hashPassword(p.PASSWORD, salt);
    obj.SALT = salt;
  }
  await updateRow(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_USERS, p._row, USERS_COLS.map(c => obj[c]));
  await logAudit(sheets, p.username, 'Master User', `Edit user ${obj.USERNAME || ''}`);
  return { ok: true };
}
async function deleteUserFn(sheets, p) {
  if (!p._row) return { ok: false, error: 'Baris (_row) wajib diisi' };
  await deleteRow(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_USERS, p._row);
  await logAudit(sheets, p.username, 'Master User', `Hapus user baris ${p._row}`);
  return { ok: true };
}

async function login(sheets, p) {
  const values = await readValues(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_USERS);
  const rows = rowsFixed(values, USERS_COLS);
  const idx = rows.findIndex(r => String(r.USERNAME).toLowerCase() === String(p.username || '').toLowerCase());
  if (idx < 0) {
    await logAudit(sheets, p.username || '(unknown)', 'Login', 'Gagal login - username tidak ditemukan');
    return { ok: false, error: 'Username atau password salah' };
  }
  const user = rows[idx];
  if (String(user.STATUS) !== 'Aktif') return { ok: false, error: 'Akun tidak aktif. Hubungi administrator.' };
  const hash = hashPassword(p.password || '', user.SALT);
  if (hash !== user.PASSWORD_HASH) {
    await logAudit(sheets, p.username, 'Login', 'Gagal login - password salah');
    return { ok: false, error: 'Username atau password salah' };
  }
  const rowVals = USERS_COLS.map(c => c === 'LAST_LOGIN' ? new Date().toISOString() : user[c]);
  await updateRow(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_USERS, idx + 2, rowVals);
  await logAudit(sheets, p.username, 'Login', 'Login berhasil');
  return { ok: true, user: { username: user.USERNAME, nama: user.NAMA, email: user.EMAIL, role: user.ROLE, estateAkses: user.ESTATE_AKSES } };
}

async function getAudit(sheets, p) {
  const values = await readValues(sheets, SPREADSHEET_ID_PRODUKSI, SHEET_AUDIT);
  let rows = rowsFixed(values, AUDIT_COLS);
  if (p.username) rows = rows.filter(r => String(r.USERNAME) === String(p.username));
  if (p.kategori) rows = rows.filter(r => String(r.KATEGORI) === String(p.kategori));
  if (p.dari)    rows = rows.filter(r => new Date(r.TIMESTAMP) >= new Date(p.dari));
  if (p.sampai)  rows = rows.filter(r => new Date(r.TIMESTAMP) <= new Date(p.sampai));
  rows.reverse();
  const limit = p.limit ? parseInt(p.limit) : 200;
  return { ok: true, count: rows.length, data: rows.slice(0, limit) };
}
async function addAuditAction(sheets, p) {
  await logAudit(sheets, p.username, p.kategori, p.aksi);
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════
//  ROUTER
// ════════════════════════════════════════════════════════════════════════
async function routeAction(sheets, action, payload) {
  switch (action) {
    case 'getProduksi':        return getProduksi(sheets, payload);
    case 'getProduksiHarian':  return getProduksiHarian(sheets, payload);
    case 'addProduksi':        return addProduksi(sheets, payload);
    case 'importProduksiBulk': return importProduksiBulk(sheets, payload);
    case 'getHarian':          return getHarian(sheets, payload);
    case 'addHarian':          return addHarian(sheets, payload);
    case 'getPKS':             return getPKS(sheets, payload);
    case 'getPksHarian':       return getPksHarian(sheets, payload);
    case 'addPksHarian':       return addPksHarian(sheets, payload);
    case 'addPksHarianBatch':  return addPksHarianBatch(sheets, payload);
    case 'getPerawatan':       return getPerawatan(sheets, payload);
    case 'getHistPupuk':       return getHistPupuk(sheets, payload);
    case 'getPemupukanBlok':   return getPemupukanBlok(sheets, payload);
    case 'getPerblok':         return getPerblok(sheets, payload);
    case 'getBlok':            return getBlok(sheets, payload);
    case 'addBlok':            return addBlok(sheets, payload);
    case 'updateBlok':         return updateBlokFn(sheets, payload);
    case 'deleteBlok':         return deleteBlokFn(sheets, payload);
    case 'getBudget':          return getBudget(sheets, payload);
    case 'setBudget':          return setBudget(sheets, payload);
    case 'login':              return login(sheets, payload);
    case 'getUsers':           return getUsers(sheets, payload);
    case 'addUser':            return addUser(sheets, payload);
    case 'updateUser':         return updateUserFn(sheets, payload);
    case 'deleteUser':         return deleteUserFn(sheets, payload);
    case 'getAudit':           return getAudit(sheets, payload);
    case 'addAudit':           return addAuditAction(sheets, payload);
    case 'ping':                return { ok: true, time: new Date().toISOString() };
    default:
      return { ok: false, error: 'Unknown action: ' + action };
  }
}

// ── HANDLER NETLIFY ─────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  try {
    const qs = event.queryStringParameters || {};
    let body = {};
    if (event.body) {
      try { body = JSON.parse(event.body); } catch (e) { body = {}; }
    }
    const payload = Object.assign({}, qs, body);
    const action = (qs.action || body.action || '').toString();

    const sheets = await getSheetsClient();
    const result = await routeAction(sheets, action, payload);

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(result) };
  } catch (err) {
    return {
      statusCode: 200, // tetap 200 supaya frontend lama (yang cek field ok) tetap bisa baca pesan error
      headers: CORS_HEADERS,
      body: JSON.stringify({ ok: false, error: err.message, stack: err.stack })
    };
  }
};
