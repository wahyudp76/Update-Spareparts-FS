# PG2 - Dashboard Monitoring Kerusakan & Spareparts Irigasi

Dashboard interaktif untuk memonitor kerusakan unit irigasi dan kebutuhan spareparts di PG2. Data **otomatis tersinkronisasi** dari Google Spreadsheet (`Form_Responses`, sheet **Response**) melalui **GitHub Actions** dan di-deploy ke **GitHub Pages**.

> 🚫 **Tidak menggunakan Google Apps Script** — semua sinkronisasi berjalan di GitHub Actions.

---

## ✨ Fitur Utama

- 📊 **7 Visualisasi Interaktif** — Tren kerusakan, distribusi status (doughnut), top unit (horizontal bar), sparepart needs, top irrigator, dan kategori kerusakan (polar area).
- 🗓️ **Filter Periode** — **Harian**, **Mingguan**, **Bulanan**, **Semua data**, plus custom date range.
- 🔍 **Filter Lanjutan** — Filter Unit, Status (Belum Ditangani / Proses / Selesai), dan pencarian keyword global.
- ⚠️ **Status Badge** — 🔴 Merah = Belum Ditangani, 🟡 Kuning = Proses Perbaikan, 🟢 Hijau = Selesai.
- 📋 **Tabel Detail** — Sortable columns, pagination (15 data per halaman), pencarian real-time.
- 📥 **Export CSV** — Download laporan yang sudah difilter dalam 1 klik.
- 🔄 **Auto Sync** — GitHub Actions menarik data baru tiap **15 menit** dan auto-deploy ulang.
- 📱 **Responsive Design** — Optimal di desktop, tablet, dan mobile.
- 🎨 **Modern UI** — Tailwind CSS + Chart.js, tema glassmorphism, gradient, animasi smooth.

---

## 🚀 Akses Dashboard

Setelah GitHub Actions berjalan, dashboard bisa diakses di:

```
https://wahyudp76.github.io/Update-Spareparts-FS/
```

---

## 🔧 Setup Awal (hanya sekali)

Dashboard membutuhkan 2 hal agar data bisa tersinkronisasi:

### 1. Set Google Spreadsheet bisa diakses publik (Viewer)

Karena kita TIDAK memakai Apps Script, GitHub Actions perlu menarik data melalui endpoint CSV publik Google Sheets.

1. Buka spreadsheet: [`1TZiQfgiVXmXCLorD1BePuH2wEDnUcy_zWTivQSE3fUk`](https://docs.google.com/spreadsheets/d/1TZiQfgiVXmXCLorD1BePuH2wEDnUcy_zWTivQSE3fUk)
2. Klik tombol **Share** (kanan atas) → **General access**
3. Ubah dari **Restricted** menjadi **Anyone with the link**
4. Pastikan role adalah **Viewer**
5. Klik **Done**

> ℹ️ Keamanan: Spreadsheet hanya dibagikan sebagai **view-only** dan tidak bisa di-edit oleh publik. Data hanya diambil oleh GitHub Actions menggunakan Node.js.

### 2. Enable GitHub Pages via GitHub Actions

1. Buka repo: https://github.com/wahyudp76/Update-Spareparts-FS
2. Klik tab **Settings** → **Pages** (sidebar kiri, bagian "Code and automation")
3. Pada **Source**, pilih: **GitHub Actions** (bukan Deploy from a branch)
4. Tunggu run pertama Actions selesai (lihat tab **Actions**)
5. Dashboard akan live di URL Pages yang tertera di Settings → Pages

### (Opsional) 3. Custom Spreadsheet / Sheet

Jika nanti ingin mengganti spreadsheet/sheet target:

1. Buka repo **Settings** → **Secrets and variables** → **Actions** → tab **Variables**
2. Tambahkan **Repository variables**:
   - `SHEET_ID` → ID spreadsheet baru
   - `SHEET_NAME` → Nama sheet baru (default: `Response`)

---

## 🔄 Cara Kerja Sinkronisasi

```
┌──────────────────┐  (1) Trigger: tiap 15 menit  ┌─────────────────────┐
│ Google Sheet     │  ──────────────────────────► │  GitHub Actions     │
│ (Response sheet) │  CSV public endpoint         │  - fetch-data.js    │
│ "Anyone with     │  /gviz/tq?tqx=out:csv        │  - parse → data.json│
│  link - Viewer"  │                              │  - commit & push    │
└──────────────────┘                              └─────────┬───────────┘
                                                           │
                                                           ▼
                                                ┌─────────────────────┐
                                                │ GitHub Pages        │
                                                │ (Hosting statis)    │
                                                │ index.html + app.js │
                                                │ + data.json         │
                                                └─────────┬───────────┘
                                                          │
                                                          ▼
                                                ┌─────────────────────┐
                                                │ Browser User        │
                                                │ Dashboard membaca   │
                                                │ data.json           │
                                                └─────────────────────┘
```

- **Pemicu workflow** (`deploy.yml`):
  - Setiap ada push ke branch `main`
  - Setiap **15 menit** via cron `*/15 * * * *`
  - Manual via tombol **Run workflow** di tab Actions
- Script `scripts/fetch-data.js` akan:
  - Fetch CSV dari Google Sheets
  - Parse CSV (handle quoted fields, tanggal format ID/US/ISO)
  - Normalisasi field (mencari kolom Timestamp/Unit/Irrigator/Kerusakan/Sparepart/QTY/Status/Pelapor secara fleksibel)
  - Normalisasi nilai status (Selesai / Proses / Belum Ditangani)
  - Tulis hasil ke `data.json`
- Workflow kemudian:
  - Commit `data.json` yang baru jika ada perubahan
  - Deploy ulang ke GitHub Pages

---

## 📁 Struktur File

```
Update-Spareparts-FS/
├── index.html                 # Halaman utama dashboard
├── app.js                     # Logika client-side (filter, chart, table, export)
├── data.json                  # Data hasil fetch (dibuat/diupdate otomatis oleh Actions)
├── data.meta.json             # Metadata fetch terakhir (dibuat otomatis)
├── package.json               # Konfigurasi node (script `npm run fetch`)
├── scripts/
│   └── fetch-data.js          # Script Node.js untuk fetch + parse CSV dari Sheets
├── .github/
│   └── workflows/
│       └── deploy.yml         # GitHub Actions workflow (sync + deploy)
├── .nojekyll                  # Agar GitHub Pages tidak memproses Jekyll
└── README.md                  # Dokumentasi ini
```

---

## 📝 Format Kolom Spreadsheet yang Didukung

Mapping kolom **otomatis / fuzzy** — header row pertama tidak harus persis, cukup mengandung kata kunci:

| Field | Keyword yang dikenali (case-insensitive) |
|-------|------------------------------------------|
| Waktu/Timestamp | `timestamp`, `tanggal`, `waktu` |
| Unit | `unit`, `blok`, `area` |
| Irrigator | `irrigator`, `irigasi`, `penyiram` |
| Kerusakan | `kerusakan`, `damage`, `masalah`, `kondisi`, `rusak` |
| Sparepart | `sparepart`, `spare`, `part`, `suku cadang` |
| Quantity | `qty`, `jumlah`, `quantity`, `banyaknya` |
| Status | `status`, `penanganan`, `progres` |
| Pelapor | `pelapor`, `nama`, `reporter`, `petugas`, `teknisi` |
| Catatan | `catatan`, `note`, `keterangan`, `deskripsi` |

Nilai status juga dinormalisasi otomatis:
- Mengandung `selesai / done / fixed / beres` → **Selesai** (hijau)
- Mengandung `proses / progres / dikerjakan / on progress` → **Proses** (kuning)
- Selainnya → **Belum Ditangani** (merah)

---

## 🖱️ Cara Manual Trigger Sinkronisasi

Jika data di spreadsheet sudah diupdate tapi belum muncul di dashboard:

1. Buka tab **Actions** di repo
2. Pilih workflow **Build & Deploy Dashboard** (sidebar kiri)
3. Klik dropdown **Run workflow** (kanan atas)
4. Klik tombol hijau **Run workflow**
5. Tunggu 30–60 detik sampai job selesai, lalu refresh dashboard

---

## 🛠️ Menjalankan Secara Lokal

Cukup buka `index.html` di browser (tidak butuh server). Atau jika ingin fetch data terbaru di lokal:

```bash
node scripts/fetch-data.js   # hasilnya di data.json
python3 -m http.server 8080  # buka http://localhost:8080
```

---

## ❓ Troubleshooting

| Masalah | Solusi |
|---|---|
| Data tidak muncul / masih kosong | Pastikan spreadsheet dishare **"Anyone with the link – Viewer"**. Cek log workflow di tab Actions untuk error detail. |
| Dashboard muncul "Data Demo" | Tombol Refresh akan coba fetch live ke Sheets. Jika gagal, gunakan GitHub Actions untuk sinkron (tunggu cron 15 menit atau trigger manual). |
| Kolom tidak terbaca | Pastikan header (baris 1) di sheet **Response** memuat salah satu keyword yang tercantum di tabel Format Kolom di atas. |
| Pages 404 | Pastikan Settings → Pages → Source diset ke **GitHub Actions** (bukan branch), dan workflow run terakhir statusnya ✅ success. |
| Cron Actions tidak berjalan | GitHub menonaktifkan cron setelah 60 hari repo tidak aktif; klik sekali pada tab Actions untuk mengaktifkan ulang, atau push commit kecil. |

---

## 📌 Info Teknis

- **Spreadsheet ID**: `1TZiQfgiVXmXCLorD1BePuH2wEDnUcy_zWTivQSE3fUk`
- **Sheet Name**: `Response` (dari Form_Responses)
- **Repository**: https://github.com/wahyudp76/Update-Spareparts-FS
- **Deploy**: GitHub Pages via GitHub Actions (auto-sync setiap 15 menit)
- **Frontend stack**: HTML + Tailwind CSS (CDN) + Chart.js 4 + Font Awesome
- **Backend sync**: Node.js (vanilla `https` module, tanpa dependency)

---

&copy; 2026 PG2 Irrigation Monitoring System


## Alur sinkronisasi data (diperbarui 2026-09-19)

Setiap kali halaman dibuka, di-reload, ditekan tombol **Refresh**, auto-refresh 5 menit,
tab kembali aktif, atau koneksi pulih — urutan sumber data SELALU sama:

1. **Google Sheets langsung** (CSV publik) → label hijau `Live (Sheets)`.
2. **`data.json`** hasil sync GitHub Actions → label biru `Sync GitHub (cadangan)`,
   hanya dipakai bila Sheets tidak bisa diakses.
3. Jika keduanya gagal → data terakhir yang berhasil dimuat **tetap ditampilkan**
   (label merah `Offline`), tidak dikosongkan.

Catatan: `data.json` sekarang menyimpan timestamp dengan offset `+07:00` (WIB), bukan
`Z`/UTC, sehingga jam & tanggal konsisten dengan jalur live di semua zona waktu.
