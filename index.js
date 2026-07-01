/**
 * ============================================================================
 *  WAR ROOM PLANTATION — BACKEND (Google Apps Script)
 * ============================================================================
 *  Sheet sumber : "History Produksi"  (tab: Produksi)
 *                 "DB PKS"            (tab: PKS)
 *  Tab baru otomatis dibuat di "History Produksi":
 *    - Blok        (master blok/luas/populasi per AFD)
 *    - Budget      (target bulanan per Kebun)
 *    - Users       (akun login)
 *    - AuditLog    (rekam jejak aktivitas)
 *
 *  CARA DEPLOY:
 *  1. Buka https://script.google.com -> New Project
 *  2. Hapus isi default, paste SEMUA kode ini
 *  3. Ganti SPREADSHEET_ID_PRODUKSI & SPREADSHEET_ID_PKS di bawah jika perlu
 *     (sudah saya isi otomatis dari file Anda)
 *  4. Jalankan fungsi `setupSheets` SEKALI dari editor (klik Run) untuk
 *     membuat tab Blok/Budget/Users/AuditLog + header otomatis.
 *     -> Saat pertama run, Google akan minta otorisasi akses sheet. Izinkan.
 *  5. Klik "Deploy" -> "New deployment" -> pilih tipe "Web app"
 *     - Execute as: Me
 *     - Who has access: Anyone (atau "Anyone with Google account")
 *  6. Copy URL deployment (...../exec) -> paste ke Settings dashboard HTML
 *  7. Setiap kali Anda EDIT kode ini, harus "Manage deployments" -> Edit ->
 *     New version, supaya URL yang sama menjalankan kode terbaru.
 * ============================================================================
 */

// ── KONFIGURASI ──────────────────────────────────────────────────────────
const SPREADSHEET_ID_PRODUKSI = '15VzZknIpWjCKGnqPO1DAW5cJN2y5ooFHHqhNjZ37LWA'; // History Produksi
const SPREADSHEET_ID_PKS      = '1ZI2Buqb-TmePjC1Sp-53J1s0T_wVcPUgYKObIqwnEpM'; // DB PKS

const SHEET_PRODUKSI = 'Produksi';
const SHEET_PKS       = 'PKS';
const SHEET_BLOK      = 'Blok';
const SHEET_BUDGET    = 'Budget';
const SHEET_USERS     = 'Users';
const SHEET_AUDIT     = 'AuditLog';
const SHEET_HARIAN    = 'Harian';        // tab baru di spreadsheet Produksi
const SHEET_PKS_HARIAN = 'Harian';       // tab baru di spreadsheet PKS (nama sama, file berbeda)
const SHEET_PERAWATAN  = 'perawatan';    // tab perawatan di DB PKS
const SHEET_HIST_PUPUK = 'hist pupuk';   // tab hist pupuk di DB PKS
const SHEET_PEM_BLOK   = 'pemupukan blok'; // tab pemupukan blok di DB PKS

// Kolom asli tab "Produksi" (urutan HARUS sama dengan sheet asli Anda)
// TANGGAL ditambahkan di akhir (kolom ke-24) - data lama akan kosong untuk kolom ini,
// tetap muncul di total bulanan, tapi tidak muncul di chart tren HARIAN sampai diisi.
const PRODUKSI_COLS = ['PT','KEBUN','AFD','LUAS','PKK','SPH','BUDGET_TON','SENSUS_TON',
  'BUDGET_KG','SENSUS_KG','JJG','KG','HK','HA_PANEN','TON','BJR','ROTASI','TON_HA',
  'JJG_PKK','OUTPUT_JJG','OUTPUT_KG','BULAN','TAHUN','TANGGAL'];

const PKS_COLS = ['TAHUN','BULAN','KEGIATAN','SER','DATA','SAT','ACTUAL','BUDGET',
  'PCT_PCP','SBI_ACTUAL','SBI_BUDGET','SBI_PCT_PCP'];

const BLOK_COLS   = ['KODE','ESTATE','AFD','LUAS_HA','TAHUN_TANAM','JENIS','POPULASI','STATUS'];
const BUDGET_COLS = ['TAHUN','BULAN','ESTATE','BUDGET_KG','HK_RENCANA'];
const USERS_COLS  = ['USERNAME','NAMA','EMAIL','PASSWORD_HASH','SALT','ROLE','ESTATE_AKSES','STATUS','LAST_LOGIN'];
const AUDIT_COLS  = ['TIMESTAMP','USERNAME','KATEGORI','AKSI','IP'];

// Kolom ringkas untuk input harian produksi (tab "Harian" di spreadsheet Produksi)
// RESTAN_KG = jumlah TBS tertinggal / belum terangkut di blok hari ini (Kg)
const HARIAN_COLS = ['TANGGAL','KEBUN','AFD','JJG','KG','HK','RESTAN_KG'];

// Kolom untuk input harian PKS (tab "Harian" di spreadsheet DB PKS) -
// mengikuti struktur PKS yang sudah ada + TANGGAL
const PKS_HARIAN_COLS = ['TANGGAL','TAHUN','BULAN','KEGIATAN','SER','DATA','SAT','ACTUAL','BUDGET'];

// ── ENTRY POINTS ─────────────────────────────────────────────────────────
function doGet(e) {
  return handleRequest(e);
}
function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    const action = (e.parameter.action || '').toString();
    const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const payload = Object.assign({}, e.parameter, body);

    let result;
    switch (action) {
      // ── DASHBOARD / PRODUKSI ──
      case 'getProduksi':        result = getProduksi(payload); break;
      case 'getProduksiHarian':  result = getProduksiHarian(payload); break;
      case 'addProduksi':        result = addProduksi(payload); break;
      case 'importProduksiBulk': result = importProduksiBulk(payload); break;

      // ── HARIAN (Produksi) ──
      case 'getHarian':          result = getHarian(payload); break;
      case 'addHarian':          result = addHarian(payload); break;

      // ── PKS ──
      case 'getPKS':             result = getPKS(payload); break;

      // ── PKS HARIAN ──
      case 'getPksHarian':       result = getPksHarian(payload); break;
      case 'addPksHarian':       result = addPksHarian(payload); break;
      case 'addPksHarianBatch':  result = addPksHarianBatch(payload); break;

      // ── PERAWATAN ──
      case 'getPerawatan':       result = getPerawatan(payload); break;
      case 'getHistPupuk':       result = getHistPupuk(payload); break;
      case 'getPemupukanBlok':   result = getPemupukanBlok(payload); break;

      // ── PER BLOK ──
      case 'getPerblok':         result = getPerblok(payload); break;

      // ── MASTER BLOK ──
      case 'getBlok':            result = getBlok(payload); break;
      case 'addBlok':            result = addBlok(payload); break;
      case 'updateBlok':         result = updateBlok(payload); break;
      case 'deleteBlok':         result = deleteBlok(payload); break;

      // ── MASTER BUDGET ──
      case 'getBudget':          result = getBudget(payload); break;
      case 'setBudget':          result = setBudget(payload); break;

      // ── USERS / AUTH ──
      case 'login':              result = login(payload); break;
      case 'getUsers':           result = getUsers(payload); break;
      case 'addUser':            result = addUser(payload); break;
      case 'updateUser':         result = updateUser(payload); break;
      case 'deleteUser':         result = deleteUser(payload); break;

      // ── AUDIT ──
      case 'getAudit':           result = getAudit(payload); break;
      case 'addAudit':           result = addAudit(payload); break;

      // ── UTIL ──
      case 'ping':               result = { ok: true, time: new Date().toISOString() }; break;

      default:
        result = { ok: false, error: 'Unknown action: ' + action };
    }
    return jsonOut(result);
  } catch (err) {
    return jsonOut({ ok: false, error: err.message, stack: err.stack });
  }
}

function jsonOut(obj) {
  // Apps Script tidak mengizinkan set custom header (mis. Access-Control-Allow-Origin)
  // pada ContentService. Browser MENGIZINKAN simple cross-origin GET/POST dengan
  // Content-Type text/plain tanpa preflight, sehingga ini cukup untuk fetch() biasa.
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Menangani permintaan preflight OPTIONS (browser kadang mengirim ini lebih dulu)
function doOptions(e) {
  return ContentService.createTextOutput('');
}

// ── SETUP (jalankan sekali manual dari editor) ───────────────────────────
function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  ensureSheet(ss, SHEET_BLOK, BLOK_COLS);
  ensureSheet(ss, SHEET_BUDGET, BUDGET_COLS);
  ensureSheet(ss, SHEET_USERS, USERS_COLS);
  ensureSheet(ss, SHEET_AUDIT, AUDIT_COLS);
  ensureSheet(ss, SHEET_HARIAN, HARIAN_COLS);

  // Tambahkan tab "Harian" di spreadsheet DB PKS juga
  const ssPks = SpreadsheetApp.openById(SPREADSHEET_ID_PKS);
  ensureSheet(ssPks, SHEET_PKS_HARIAN, PKS_HARIAN_COLS);

  // Tambahkan header kolom TANGGAL di tab Produksi jika belum ada (migrasi aman,
  // tidak menghapus/mengubah data lama - hanya menambah 1 kolom di akhir).
  const prodSheet = ss.getSheetByName(SHEET_PRODUKSI);
  if (prodSheet) {
    const lastCol = prodSheet.getLastColumn();
    const headerRow = prodSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    if (headerRow.indexOf('TANGGAL') === -1) {
      prodSheet.getRange(1, lastCol + 1).setValue('TANGGAL');
      Logger.log('Kolom TANGGAL ditambahkan ke tab Produksi pada kolom ke-' + (lastCol + 1));
    }
  }

  // Buat user Super Admin default jika tab Users masih kosong
  const usersSheet = ss.getSheetByName(SHEET_USERS);
  if (usersSheet.getLastRow() <= 1) {
    const salt = generateSalt();
    const hash = hashPassword('admin123', salt);
    usersSheet.appendRow(['admin', 'Super Admin', 'admin@psam.id', hash, salt,
      'Super Admin', 'Semua', 'Aktif', '']);
    Logger.log('User default dibuat -> username: admin / password: admin123 (HARAP DIGANTI)');
  }
  Logger.log('Setup selesai. Tab Harian (Produksi) & Harian (PKS) siap digunakan.');
}

function ensureSheet(ss, name, cols) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(cols);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(cols);
    sh.setFrozenRows(1);
  }
  return sh;
}

// ── HELPERS ──────────────────────────────────────────────────────────────
function sheetToObjects(sheet, colNames) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return data.map(row => {
    const obj = {};
    colNames.forEach((c, i) => { obj[c] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  }).filter(o => Object.values(o).some(v => v !== '' && v !== null));
}

function generateSalt() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 16);
}
function hashPassword(password, salt) {
  const raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password + salt,
    Utilities.Charset.UTF_8
  );
  return raw.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

function parseNum(v) {
  if (v === '' || v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  // Tangani format ribuan ber-titik ala sheet asli (mis. "1.288.536")
  const s = String(v).trim().replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ── PRODUKSI ─────────────────────────────────────────────────────────────
function getProduksi(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ss.getSheetByName(SHEET_PRODUKSI);
  let rows = sheetToObjects(sh, PRODUKSI_COLS);

  if (p.tahun) rows = rows.filter(r => String(r.TAHUN) === String(p.tahun));
  if (p.bulan) rows = rows.filter(r => String(r.BULAN) === String(p.bulan));
  if (p.kebun) rows = rows.filter(r => String(r.KEBUN) === String(p.kebun));
  if (p.afd)   rows = rows.filter(r => String(r.AFD) === String(p.afd));

  // Normalisasi angka (banyak nilai sheet asli berupa string format ribuan)
  rows = rows.map(r => {
    const o = Object.assign({}, r);
    ['LUAS','PKK','SPH','BUDGET_TON','SENSUS_TON','BUDGET_KG','SENSUS_KG','JJG','KG',
     'HK','HA_PANEN','TON','BJR','ROTASI','TON_HA','JJG_PKK','OUTPUT_JJG','OUTPUT_KG']
      .forEach(k => o[k] = parseNum(o[k]));
    // Normalisasi TANGGAL ke format YYYY-MM-DD string (aman untuk JSON & sort),
    // kosong jika data lama belum punya tanggal.
    o.TANGGAL = normalizeDateStr(o.TANGGAL);
    return o;
  });

  return { ok: true, count: rows.length, data: rows };
}

// Endpoint khusus untuk chart tren HARIAN bulan berjalan (dipakai Dashboard).
// SEKARANG sepenuhnya membaca dari tab "Harian" (bukan scan tab Produksi lagi).
function getProduksiHarian(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ensureSheet(ss, SHEET_HARIAN, HARIAN_COLS);
  let rows = sheetToObjects(sh, HARIAN_COLS);

  rows = rows.map(r => {
    const o = Object.assign({}, r);
    ['JJG','KG','HK','RESTAN_KG'].forEach(k => o[k] = parseNum(o[k]));
    o.TANGGAL = normalizeDateStr(o.TANGGAL);
    return o;
  }).filter(r => r.TANGGAL !== '');

  if (p.tahun) rows = rows.filter(r => r.TANGGAL.substring(0,4) === String(p.tahun));
  if (p.bulan) rows = rows.filter(r => parseInt(r.TANGGAL.substring(5,7),10) === parseInt(p.bulan,10));

  const byDate = {};
  rows.forEach(r => {
    if (!byDate[r.TANGGAL]) byDate[r.TANGGAL] = { tanggal: r.TANGGAL, jjg: 0, kg: 0, hk: 0, restanKg: 0 };
    byDate[r.TANGGAL].jjg += r.JJG;
    byDate[r.TANGGAL].kg += r.KG;
    byDate[r.TANGGAL].hk += r.HK;
    byDate[r.TANGGAL].restanKg += r.RESTAN_KG;
  });
  const result = Object.values(byDate).sort((a,b) => a.tanggal.localeCompare(b.tanggal));
  return { ok: true, count: result.length, data: result, hasTanggalData: result.length > 0 };
}

// ── HARIAN (Produksi) — CRUD tab "Harian" di spreadsheet Produksi ───────
function getHarian(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ensureSheet(ss, SHEET_HARIAN, HARIAN_COLS);
  let rows = sheetToObjects(sh, HARIAN_COLS);
  rows = rows.map((r, i) => {
    const o = Object.assign({ _row: i + 2 }, r);
    ['JJG','KG','HK','RESTAN_KG'].forEach(k => o[k] = parseNum(o[k]));
    o.TANGGAL = normalizeDateStr(o.TANGGAL);
    return o;
  });
  if (p.tahun) rows = rows.filter(r => r.TANGGAL.substring(0,4) === String(p.tahun));
  if (p.bulan) rows = rows.filter(r => r.TANGGAL && parseInt(r.TANGGAL.substring(5,7),10) === parseInt(p.bulan,10));
  if (p.kebun) rows = rows.filter(r => String(r.KEBUN) === String(p.kebun));
  return { ok: true, count: rows.length, data: rows };
}

function addHarian(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ensureSheet(ss, SHEET_HARIAN, HARIAN_COLS);
  const row = HARIAN_COLS.map(c => p[c] !== undefined ? p[c] : '');
  sh.appendRow(row);
  logAudit(p.username || 'system', 'Input Harian', `Input harian produksi ${p.KEBUN || ''} ${p.AFD || ''} tgl ${p.TANGGAL || ''}`);
  return { ok: true };
}

function normalizeDateStr(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  if (s === '') return '';
  // Coba parse format umum: yyyy-MM-dd, dd/MM/yyyy, dd-MM-yyyy
  let d;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    d = new Date(s);
  } else if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(s)) {
    const parts = s.split(/[\/\-]/);
    d = new Date(parts[2], parts[1]-1, parts[0]);
  } else {
    d = new Date(s);
  }
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function addProduksi(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ss.getSheetByName(SHEET_PRODUKSI);
  const row = PRODUKSI_COLS.map(c => p[c] !== undefined ? p[c] : (p[c.toLowerCase()] !== undefined ? p[c.toLowerCase()] : ''));
  sh.appendRow(row);
  logAudit(p.username || 'system', 'Produksi', `Tambah data produksi ${p.KEBUN || ''} ${p.AFD || ''} (${p.BULAN || ''}/${p.TAHUN || ''})`);
  return { ok: true };
}

// Import bulk dari hasil parsing Excel (SheetJS) di frontend
function importProduksiBulk(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ss.getSheetByName(SHEET_PRODUKSI);
  const rows = p.rows || [];
  if (!rows.length) return { ok: false, error: 'Tidak ada baris untuk diimpor' };

  let success = 0, failed = 0;
  const toAppend = [];
  rows.forEach(r => {
    try {
      const row = PRODUKSI_COLS.map(c => r[c] !== undefined ? r[c] : '');
      toAppend.push(row);
      success++;
    } catch (err) {
      failed++;
    }
  });
  if (toAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, PRODUKSI_COLS.length).setValues(toAppend);
  }
  logAudit(p.username || 'system', 'Import', `Import bulk produksi: ${success} berhasil, ${failed} gagal`);
  return { ok: true, success, failed, total: rows.length };
}

// ── PKS ──────────────────────────────────────────────────────────────────
function getPKS(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PKS);
  const sh = ss.getSheetByName(SHEET_PKS);
  let rows = sheetToObjects(sh, PKS_COLS);
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

// ── PKS HARIAN — CRUD tab "Harian" di spreadsheet DB PKS ────────────────
function getPksHarian(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PKS);
  const sh = ensureSheet(ss, SHEET_PKS_HARIAN, PKS_HARIAN_COLS);
  let rows = sheetToObjects(sh, PKS_HARIAN_COLS);
  rows = rows.map((r, i) => {
    const o = Object.assign({ _row: i + 2 }, r);
    ['ACTUAL','BUDGET'].forEach(k => o[k] = parseNum(o[k]));
    o.TANGGAL = normalizeDateStr(o.TANGGAL);
    return o;
  }).filter(r => r.TANGGAL !== '');
  if (p.tahun) rows = rows.filter(r => r.TANGGAL.substring(0,4) === String(p.tahun));
  if (p.bulan) rows = rows.filter(r => parseInt(r.TANGGAL.substring(5,7),10) === parseInt(p.bulan,10));
  if (p.kegiatan) rows = rows.filter(r => String(r.KEGIATAN).toUpperCase().includes(String(p.kegiatan).toUpperCase()));
  rows.sort((a,b) => a.TANGGAL.localeCompare(b.TANGGAL));
  return { ok: true, count: rows.length, data: rows };
}

function addPksHarian(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PKS);
  const sh = ensureSheet(ss, SHEET_PKS_HARIAN, PKS_HARIAN_COLS);
  const row = PKS_HARIAN_COLS.map(c => p[c] !== undefined ? p[c] : '');
  sh.appendRow(row);
  logAudit(p.username || 'system', 'Input Harian PKS', `Input harian PKS ${p.KEGIATAN || ''} tgl ${p.TANGGAL || ''}`);
  return { ok: true };
}

// Input banyak baris sekaligus (1 tanggal, beberapa item kegiatan/sub-kegiatan).
// payload.rows = array of { KEGIATAN, SER, DATA, SAT, ACTUAL }, payload.TANGGAL/TAHUN/BULAN umum untuk semua baris.
function addPksHarianBatch(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PKS);
  const sh = ensureSheet(ss, SHEET_PKS_HARIAN, PKS_HARIAN_COLS);
  const rows = p.rows || [];
  if (!rows.length) return { ok: false, error: 'Tidak ada baris untuk disimpan' };

  const toAppend = rows.map(r => PKS_HARIAN_COLS.map(c => {
    if (c === 'TANGGAL') return p.TANGGAL || '';
    if (c === 'TAHUN') return p.TAHUN || '';
    if (c === 'BULAN') return p.BULAN || '';
    return r[c] !== undefined ? r[c] : '';
  }));
  sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, PKS_HARIAN_COLS.length).setValues(toAppend);
  logAudit(p.username || 'system', 'Input Harian PKS', `Input batch harian PKS tgl ${p.TANGGAL || ''} (${rows.length} item)`);
  return { ok: true, count: rows.length };
}

// ── MASTER BLOK ──────────────────────────────────────────────────────────
function getBlok(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ensureSheet(ss, SHEET_BLOK, BLOK_COLS);
  let rows = sheetToObjects(sh, BLOK_COLS);
  if (p.estate) rows = rows.filter(r => String(r.ESTATE) === String(p.estate));
  rows = rows.map((r, i) => Object.assign({ _row: i + 2 }, r));
  return { ok: true, count: rows.length, data: rows };
}
function addBlok(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ensureSheet(ss, SHEET_BLOK, BLOK_COLS);
  sh.appendRow(BLOK_COLS.map(c => p[c] !== undefined ? p[c] : ''));
  logAudit(p.username || 'system', 'Master Blok', `Tambah blok ${p.KODE || ''}`);
  return { ok: true };
}
function updateBlok(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ensureSheet(ss, SHEET_BLOK, BLOK_COLS);
  if (!p._row) return { ok: false, error: 'Baris (_row) wajib diisi untuk update' };
  const rowVals = BLOK_COLS.map(c => p[c] !== undefined ? p[c] : '');
  sh.getRange(p._row, 1, 1, BLOK_COLS.length).setValues([rowVals]);
  logAudit(p.username || 'system', 'Master Blok', `Edit blok ${p.KODE || ''}`);
  return { ok: true };
}
function deleteBlok(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ensureSheet(ss, SHEET_BLOK, BLOK_COLS);
  if (!p._row) return { ok: false, error: 'Baris (_row) wajib diisi untuk hapus' };
  sh.deleteRow(p._row);
  logAudit(p.username || 'system', 'Master Blok', `Hapus blok baris ${p._row}`);
  return { ok: true };
}

// ── MASTER BUDGET ────────────────────────────────────────────────────────
function getBudget(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ensureSheet(ss, SHEET_BUDGET, BUDGET_COLS);
  let rows = sheetToObjects(sh, BUDGET_COLS);
  if (p.tahun)  rows = rows.filter(r => String(r.TAHUN) === String(p.tahun));
  if (p.estate) rows = rows.filter(r => String(r.ESTATE) === String(p.estate));
  rows = rows.map((r, i) => Object.assign({ _row: i + 2 }, r, {
    BUDGET_KG: parseNum(r.BUDGET_KG), HK_RENCANA: parseNum(r.HK_RENCANA)
  }));
  return { ok: true, count: rows.length, data: rows };
}
function setBudget(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ensureSheet(ss, SHEET_BUDGET, BUDGET_COLS);
  // Cek apakah kombinasi TAHUN+BULAN+ESTATE sudah ada -> update, jika belum -> tambah
  const rows = sheetToObjects(sh, BUDGET_COLS);
  const idx = rows.findIndex(r => String(r.TAHUN) === String(p.TAHUN) &&
    String(r.BULAN) === String(p.BULAN) && String(r.ESTATE) === String(p.ESTATE));
  const rowVals = BUDGET_COLS.map(c => p[c] !== undefined ? p[c] : '');
  if (idx >= 0) {
    sh.getRange(idx + 2, 1, 1, BUDGET_COLS.length).setValues([rowVals]);
  } else {
    sh.appendRow(rowVals);
  }
  logAudit(p.username || 'system', 'Master Budget', `Set budget ${p.ESTATE || ''} ${p.BULAN || ''}/${p.TAHUN || ''} = ${p.BUDGET_KG || 0} Kg`);
  return { ok: true };
}

// ── USERS / AUTH ─────────────────────────────────────────────────────────
function getUsers(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ensureSheet(ss, SHEET_USERS, USERS_COLS);
  let rows = sheetToObjects(sh, USERS_COLS);
  // Jangan kirim hash/salt ke client
  rows = rows.map((r, i) => {
    const o = Object.assign({ _row: i + 2 }, r);
    delete o.PASSWORD_HASH; delete o.SALT;
    return o;
  });
  return { ok: true, count: rows.length, data: rows };
}

function addUser(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ensureSheet(ss, SHEET_USERS, USERS_COLS);
  const salt = generateSalt();
  const hash = hashPassword(p.PASSWORD || 'changeme123', salt);
  sh.appendRow([p.USERNAME || '', p.NAMA || '', p.EMAIL || '', hash, salt,
    p.ROLE || 'Viewer', p.ESTATE_AKSES || 'Semua', p.STATUS || 'Aktif', '']);
  logAudit(p.username || 'system', 'Master User', `Tambah user ${p.USERNAME || ''} (${p.ROLE || ''})`);
  return { ok: true };
}

function updateUser(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ensureSheet(ss, SHEET_USERS, USERS_COLS);
  if (!p._row) return { ok: false, error: 'Baris (_row) wajib diisi' };
  const existing = sh.getRange(p._row, 1, 1, USERS_COLS.length).getValues()[0];
  const obj = {};
  USERS_COLS.forEach((c, i) => obj[c] = existing[i]);
  // Update field yang dikirim saja, kecuali password
  ['NAMA','EMAIL','ROLE','ESTATE_AKSES','STATUS'].forEach(k => {
    if (p[k] !== undefined) obj[k] = p[k];
  });
  if (p.PASSWORD) {
    const salt = generateSalt();
    obj.PASSWORD_HASH = hashPassword(p.PASSWORD, salt);
    obj.SALT = salt;
  }
  const rowVals = USERS_COLS.map(c => obj[c]);
  sh.getRange(p._row, 1, 1, USERS_COLS.length).setValues([rowVals]);
  logAudit(p.username || 'system', 'Master User', `Edit user ${obj.USERNAME || ''}`);
  return { ok: true };
}

function deleteUser(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ensureSheet(ss, SHEET_USERS, USERS_COLS);
  if (!p._row) return { ok: false, error: 'Baris (_row) wajib diisi' };
  sh.deleteRow(p._row);
  logAudit(p.username || 'system', 'Master User', `Hapus user baris ${p._row}`);
  return { ok: true };
}

function login(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ensureSheet(ss, SHEET_USERS, USERS_COLS);
  const rows = sheetToObjects(sh, USERS_COLS);
  const idx = rows.findIndex(r => String(r.USERNAME).toLowerCase() === String(p.username || '').toLowerCase());
  if (idx < 0) {
    logAudit(p.username || '(unknown)', 'Login', 'Gagal login - username tidak ditemukan');
    return { ok: false, error: 'Username atau password salah' };
  }
  const user = rows[idx];
  if (String(user.STATUS) !== 'Aktif') {
    return { ok: false, error: 'Akun tidak aktif. Hubungi administrator.' };
  }
  const hash = hashPassword(p.password || '', user.SALT);
  if (hash !== user.PASSWORD_HASH) {
    logAudit(p.username, 'Login', 'Gagal login - password salah');
    return { ok: false, error: 'Username atau password salah' };
  }
  // Update last login
  sh.getRange(idx + 2, USERS_COLS.indexOf('LAST_LOGIN') + 1).setValue(new Date().toISOString());
  logAudit(p.username, 'Login', 'Login berhasil');
  return {
    ok: true,
    user: { username: user.USERNAME, nama: user.NAMA, email: user.EMAIL,
      role: user.ROLE, estateAkses: user.ESTATE_AKSES }
  };
}

// ── AUDIT TRAIL ──────────────────────────────────────────────────────────
function getAudit(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ensureSheet(ss, SHEET_AUDIT, AUDIT_COLS);
  let rows = sheetToObjects(sh, AUDIT_COLS);
  if (p.username) rows = rows.filter(r => String(r.USERNAME) === String(p.username));
  if (p.kategori) rows = rows.filter(r => String(r.KATEGORI) === String(p.kategori));
  if (p.dari) rows = rows.filter(r => new Date(r.TIMESTAMP) >= new Date(p.dari));
  if (p.sampai) rows = rows.filter(r => new Date(r.TIMESTAMP) <= new Date(p.sampai));
  rows.reverse(); // terbaru dulu
  const limit = p.limit ? parseInt(p.limit) : 200;
  return { ok: true, count: rows.length, data: rows.slice(0, limit) };
}

function addAudit(p) {
  logAudit(p.username || 'system', p.kategori || 'General', p.aksi || '');
  return { ok: true };
}

function logAudit(username, kategori, aksi) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
    const sh = ensureSheet(ss, SHEET_AUDIT, AUDIT_COLS);
    sh.appendRow([new Date().toISOString(), username, kategori, aksi, '']);
  } catch (e) {
    Logger.log('Gagal mencatat audit: ' + e.message);
  }
}

// ── PERAWATAN ────────────────────────────────────────────────────────────
// Membaca tab "perawatan" dari spreadsheet DB PKS.
// Kolom yang WAJIB ada (nama bebas, dibaca sebagai header baris 1):
//   KEBUN / ESTATE, AFD, BLOK / KODE_BLOK,
//   ROT_TERAKHIR_GAWANGAN_CHEMIST, ROT_TERAKHIR_GAWANGAN_MANUAL,
//   ROT_TERAKHIR_PIRINGAN_CHEMIST, ROT_TERAKHIR_PIRINGAN_MANUAL
function getPerawatan(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PKS);
  const sh = ss.getSheetByName(SHEET_PERAWATAN);
  if (!sh) return { ok: true, count: 0, data: [], note: 'Sheet "perawatan" tidak ditemukan di DB PKS.' };
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { ok: true, count: 0, data: [] };
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim().toUpperCase().replace(/\s+/g,'_'));
  const dataRange = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  let rows = dataRange.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  }).filter(o => Object.values(o).some(v => v !== '' && v !== null));

  if (p.tahun) rows = rows.filter(r => {
    const thn = r.TAHUN || r.YEAR || r.PERIODE || '';
    return !thn || String(thn) === String(p.tahun);
  });
  if (p.kebun) rows = rows.filter(r => (String(r.KEBUN||r.ESTATE||'')).toUpperCase() === String(p.kebun).toUpperCase());
  if (p.afd) rows = rows.filter(r => (String(r.AFD||'')).toUpperCase() === String(p.afd).toUpperCase());
  if (p.blok) rows = rows.filter(r => (String(r.BLOK||r.KODE_BLOK||'')).toUpperCase() === String(p.blok).toUpperCase());

  return { ok: true, count: rows.length, data: rows };
}

// ── HIST PUPUK ───────────────────────────────────────────────────────────
// Membaca tab "hist pupuk" dari DB PKS.
// Kolom penting: KEBUN, AFD, JENIS_PUPUK (atau JENIS), TAHUN,
//                REALISASI_KG (atau REALISASI), REKOM_KG (atau REKOM)
function getHistPupuk(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PKS);
  const sh = ss.getSheetByName(SHEET_HIST_PUPUK);
  if (!sh) return { ok: true, count: 0, data: [], note: 'Sheet "hist pupuk" tidak ditemukan di DB PKS.' };
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { ok: true, count: 0, data: [] };
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim().toUpperCase().replace(/\s+/g,'_'));
  const dataRange = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  let rows = dataRange.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
    ['REALISASI_KG','REKOM_KG','REALISASI','REKOM'].forEach(k => { if(obj[k]!==undefined) obj[k] = parseNum(obj[k]); });
    return obj;
  }).filter(o => Object.values(o).some(v => v !== '' && v !== null));

  if (p.tahun) rows = rows.filter(r => !r.TAHUN || String(r.TAHUN) === String(p.tahun));
  if (p.kebun) rows = rows.filter(r => (String(r.KEBUN||'')).toUpperCase() === String(p.kebun).toUpperCase());
  if (p.afd) rows = rows.filter(r => (String(r.AFD||'')).toUpperCase() === String(p.afd).toUpperCase());

  return { ok: true, count: rows.length, data: rows };
}

// ── PEMUPUKAN BLOK ───────────────────────────────────────────────────────
// Membaca tab "pemupukan blok" dari DB PKS.
// Kolom penting: KEBUN, AFD, BLOK / KODE_BLOK, JENIS_PUPUK (atau JENIS),
//                REKOM_TOTAL_KG, REALISASI_KG_2026, REALISASI_KG_2025, REALISASI_KG_2024
function getPemupukanBlok(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PKS);
  const sh = ss.getSheetByName(SHEET_PEM_BLOK);
  if (!sh) return { ok: true, count: 0, data: [], note: 'Sheet "pemupukan blok" tidak ditemukan di DB PKS.' };
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { ok: true, count: 0, data: [] };
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim().toUpperCase().replace(/\s+/g,'_'));
  const dataRange = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  let rows = dataRange.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
    ['REKOM_TOTAL_KG','REKOM_TOTAL','REALISASI_KG_2026','REALISASI_KG_2025','REALISASI_KG_2024'].forEach(k => {
      if(obj[k]!==undefined) obj[k] = parseNum(obj[k]);
    });
    return obj;
  }).filter(o => Object.values(o).some(v => v !== '' && v !== null));

  if (p.kebun) rows = rows.filter(r => (String(r.KEBUN||'')).toUpperCase() === String(p.kebun).toUpperCase());
  if (p.afd) rows = rows.filter(r => (String(r.AFD||'')).toUpperCase() === String(p.afd).toUpperCase());
  if (p.blok) rows = rows.filter(r => (String(r.BLOK||r.KODE_BLOK||'')).toUpperCase() === String(p.blok).toUpperCase());

  return { ok: true, count: rows.length, data: rows };
}

// ── PER BLOK ─────────────────────────────────────────────────────────────
// Membaca tab "perblok" dari spreadsheet History Produksi (SPREADSHEET_ID_PRODUKSI).
// Kolom penting: KEBUN/ESTATE, AFD, BLOK/KODE_BLOK,
//   TON/TON_AKTUAL, BUDGET_TON/BUD_TON, SENSUS_TON/SEN_TON,
//   BJR, JJG, ROTASI/ROT, HA_PANEN/LUAS
// Filter: tahun (kolom TAHUN/TAHUN_PANEN), kebun, afd, blok
function getPerblok(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID_PRODUKSI);
  const sh = ss.getSheetByName('perblok');
  if (!sh) return { ok: true, count: 0, data: [], note: 'Sheet "perblok" tidak ditemukan di History Produksi.' };
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { ok: true, count: 0, data: [] };

  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(h => String(h).trim().toUpperCase().replace(/\s+/g, '_'));
  const dataRange = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  // Kolom numerik yang perlu di-parse
  const NUM_COLS = [
    'TON','TON_AKTUAL','BUDGET_TON','BUD_TON','RENCANA_TON',
    'SENSUS_TON','SEN_TON','POTENSI_TON',
    'BJR','JJG','ROTASI','ROT','HA_PANEN','LUAS_PANEN','LUAS','KG'
  ];

  let rows = dataRange.map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] !== undefined ? row[i] : '';
    });
    NUM_COLS.forEach(k => { if (obj[k] !== undefined) obj[k] = parseNum(obj[k]); });
    return obj;
  }).filter(o => Object.values(o).some(v => v !== '' && v !== null && v !== 0));

  // Filter tahun — cari di kolom TAHUN, TAHUN_PANEN, PERIODE, atau dari kolom TANGGAL
  if (p.tahun) {
    rows = rows.filter(r => {
      const thn = r.TAHUN || r.TAHUN_PANEN || r.PERIODE || r.YEAR || '';
      if (thn) return String(thn) === String(p.tahun);
      // Fallback: cek dari kolom TANGGAL jika ada
      const tgl = r.TANGGAL || r.TGL || '';
      if (tgl) {
        try { return new Date(tgl).getFullYear() === parseInt(p.tahun); } catch(e) { return true; }
      }
      return true; // Kalau tidak ada kolom tahun sama sekali, tampilkan semua
    });
  }
  if (p.kebun) rows = rows.filter(r => (String(r.KEBUN||r.ESTATE||'')).toUpperCase() === String(p.kebun).toUpperCase());
  if (p.afd)   rows = rows.filter(r => (String(r.AFD||'')).toUpperCase() === String(p.afd).toUpperCase());
  if (p.blok)  rows = rows.filter(r => (String(r.BLOK||r.KODE_BLOK||'')).toUpperCase() === String(p.blok).toUpperCase());

  return { ok: true, count: rows.length, data: rows };
}
