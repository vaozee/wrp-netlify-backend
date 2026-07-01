# Setup Backend WRP di Netlify (pengganti Google Apps Script)

## 1. Struktur folder
Upload/commit 3 file ini ke root repo yang connect ke `wrplan.netlify.app`:
```
├── netlify.toml
├── package.json
└── netlify/
    └── functions/
        └── wrp.js
```
(kalau `index.html` WRP juga mau dihost di repo yang sama, taruh sejajar dengan folder `netlify/`)

## 2. Buat Service Account (Google Cloud Console)
1. Buka https://console.cloud.google.com/ → pilih/buat project.
2. **APIs & Services → Library** → cari "Google Sheets API" → **Enable**.
3. **IAM & Admin → Service Accounts → Create Service Account**
   - Nama bebas, misal `wrp-backend`.
   - Skip "grant access" (tidak perlu role project, cukup akses ke Sheet-nya nanti).
4. Klik service account yang baru dibuat → tab **Keys → Add Key → Create new key → JSON** → download.
5. Buka file JSON itu, catat 2 nilai:
   - `client_email` → contoh: `wrp-backend@nama-project.iam.gserviceaccount.com`
   - `private_key` → string panjang diawali `-----BEGIN PRIVATE KEY-----`

## 3. Share kedua Spreadsheet ke Service Account
Buka **kedua** spreadsheet (History Produksi & DB PKS) di Google Sheets biasa:
- Klik **Share**
- Tempel email service account (`...@...iam.gserviceaccount.com`)
- Beri akses **Editor** (perlu Editor karena ada fitur tambah/edit data, bukan cuma baca)

## 4. Set Environment Variables di Netlify
Buka **Netlify dashboard → Site (wrplan) → Site configuration → Environment variables → Add a variable**, tambahkan:

| Key | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | isi dari `client_email` |
| `GOOGLE_PRIVATE_KEY` | isi dari `private_key` (paste utuh, termasuk `-----BEGIN...` dan `-----END...`) |

> Tidak perlu set `SPREADSHEET_ID_PRODUKSI`/`SPREADSHEET_ID_PKS` — sudah ada default di kode sesuai Sheet ID Ibra. Kalau suatu saat ganti spreadsheet, baru perlu ditambahkan sebagai env var juga.

## 5. Deploy
Kalau repo sudah terhubung ke Netlify (auto-deploy dari GitHub), push/commit ketiga file di atas — Netlify akan otomatis build & install `googleapis` dari `package.json`, lalu function langsung aktif di:
```
https://wrplan.netlify.app/.netlify/functions/wrp
```

## 6. Ganti URL di frontend
Di `index.html` WRP, pada layar "Koneksi Backend" — ganti isi field **Apps Script Web App URL** dari:
```
https://script.google.com/macros/s/AKfycby.../exec
```
menjadi:
```
https://wrplan.netlify.app/.netlify/functions/wrp
```
Klik "Simpan & Tes Koneksi". Tidak perlu ubah kode JS apa pun — format request (`?action=...` / JSON body) dan response (`{ok, count, data}`) sudah dibuat identik dengan Apps Script lama.

## 7. Test cepat tanpa buka WRP dulu
Buka langsung di browser:
```
https://wrplan.netlify.app/.netlify/functions/wrp?action=ping
```
Harus muncul: `{"ok":true,"time":"..."}`

Kalau muncul error `GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY belum diset` → env var belum benar/belum ke-deploy ulang (Netlify butuh **trigger deploy baru** setelah env var ditambah/diubah — klik "Trigger deploy" di dashboard).

Kalau muncul error permission (403 dari Google) → spreadsheet belum di-share ke email service account, atau salah share ke email yang berbeda.
