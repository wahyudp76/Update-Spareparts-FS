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


## Validasi kualitas data (angka dengan titik/koma, dsb.)

Tiga lapis pengaman agar angka yang salah tulis di spreadsheet tidak muncul janggal di dashboard:

1. **Di spreadsheet (pencegahan)** — pasang `scripts/sheet-validator.gs` (Extensions → Apps Script → file baru → Run `installValidationTrigger`). Saat seseorang mengetik `11.095.745`, `1.1E7`, `32,0`, atau kode 2 digit, sel langsung **merah muda + catatan**, dan (opsional) dinormalkan otomatis. Kolom angka dipaksa ke format Teks.
2. **Saat sync GitHub Actions** — `fetch-data.js` mencatat peringatan (`::warning`) di log run dan menulis `data.quality.json`.
3. **Di dashboard** — banner kuning **"N baris spreadsheet perlu diperiksa"** + toast saat data dimuat, ikon ⚠ pada baris di tab Data Lengkap, dan modal detail (baris sheet, kolom, masalah, nilai yang ditampilkan, tombol perbaiki). Nilai dinormalkan untuk tampilan (`11.095.745` → `11095745`, `32` → `0032`) tetapi tetap ditandai sampai sumbernya diperbaiki.

Yang diperiksa: Nomor PR (8 digit), Kode Engine/Irrigator (4 digit) — pemisah titik/koma, notasi ilmiah, spasi, karakter non-angka, nol di depan hilang; Tingkat Kerusakan & Status Perbaikan di luar pilihan; tahun tanggal tidak wajar; tanggal masa depan; kode tanpa jenis; lokasi kosong; kemungkinan duplikat.


## Tambah laporan langsung dari web (write-proxy v4)

Tombol hijau **＋ Tambah Laporan** di header membuka form yang sama dengan Edit. Saat disimpan, dashboard mengirim `action:'create'` ke Apps Script write-proxy yang menambahkan **baris baru di sheet Response** (Timestamp diisi otomatis, kolom kode diformat Teks). Baris langsung tampil di dashboard dan disinkronkan ulang dari sheet 1,5 detik kemudian.

Pengaman: Lokasi, Jenis Kerusakan, dan Tanggal wajib; Nomor PR (8 digit) dan Kode Engine/Irrigator (4 digit) ditolak jika memakai titik/koma atau jumlah digit salah — divalidasi di web **dan** di Apps Script. Form menyediakan saran (autocomplete) lokasi, jenis engine/irrigator, dan jenis kerusakan dari data yang ada.

**Butuh write-proxy v4** — salin `scripts/write-proxy.gs` terbaru ke project Apps Script → Save → Deploy → *Manage deployments* → ✏️ Edit → Version: **New version** → Deploy (URL tidak berubah). Dashboard akan menampilkan peringatan jika proxy masih v3.

## Tab Spareparts (analisa kebutuhan sparepart)

Dibangun murni dari `filteredData` (mengikuti filter global) — tidak menyentuh alur sync/rekonsiliasi. Item dipecah dari kolom *Spareparts Yang Dibutuhkan* dengan pemisah `;`, disatukan tanpa membedakan huruf besar/kecil (variasi penulisan ditampilkan sebagai catatan). Isi tab:

- **KPI**: jenis sparepart, masih dibutuhkan (laporan belum selesai), belum ada PR, urgensi kritis, sudah terpenuhi.
- **Paling sering dibutuhkan** (top 12, terbuka vs terpenuhi) dan **kebutuhan per divisi** (top 8 × divisi).
- **Spareparts Urgent**: skor = Σ bobot tingkat kerusakan kebutuhan terbuka (Berat 3/Sedang 2/Ringan 1) + umur laporan tertua (maks +6) + 1,5 per kebutuhan tanpa PR + 1 per lokasi tambahan. Kritis ≥ 9, Tinggi ≥ 5.
- **Kebutuhan teratas per divisi**, **per jenis aset** (engine/irigator), **matriks sparepart × jenis kerusakan**, **kebutuhan berulang di lokasi yang sama**.
- **Katalog** (urut total/terbuka/skor/terbaru/nama, pencarian, "hanya yang terbuka"), klik baris → daftar laporan terkait + tombol edit.
- **Unduh ringkasan CSV** dan peringatan jumlah laporan terbuka yang belum mencantumkan sparepart.

## Auto-isi dari spreadsheet "Unit Terpasang" (Draft Dashboard)

`config.js` → `UNITS_SHEET_ID` / `UNITS_SHEET_GID` menunjuk sheet unit terpasang (kolom Lokasi, Bengkel, Jenis Engine, Kode Engine `SPC0195`, Kode Irigator `ITI0200`, Wil, Power, Sumber Air, Kode Air, Terpasang, Tanggal). Saat form **Tambah Laporan** dibuka, data dibaca (CSV publik, cache localStorage 6 jam). Mengetik **Lokasi** akan:
- mengisi otomatis Divisi, Jenis/Kode Engine, Jenis/Kode Irrigator yang masih kosong (mode tambah), dan menampilkan ringkasan unit (wilayah, sumber air, power, tanggal pencatatan);
- jika isian berbeda dari unit terpasang (atau pada mode edit), menampilkan perbedaan + tombol **Samakan dengan unit terpasang** — tidak pernah mengubah isian diam-diam;
- menyarankan lokasi mirip saat diketik sebagian, dan memberi tahu bila lokasi tidak ada di data unit.
Lokasi yang tercatat lebih dari sekali diambil catatan terbarunya; baris dengan status selain "Terpasang" diabaikan. Sheet unit harus dapat dibaca "Siapa saja yang memiliki link".

## Notifikasi anomali data (ikon lonceng)
Setiap record diperiksa setelah sync (dari spreadsheet maupun hasil edit web): angka dengan titik/koma/notasi ilmiah, kode tidak 4/8 digit, nilai di luar pilihan Google Form (Divisi/Jenis/PIC), lokasi salah format/tidak dikenal, laporan terkirim ganda, tanggal tidak wajar, data tidak sesuai unit terpasang (Draft Dashboard), kolom wajib kosong (Keterangan, Tingkat, PIC), dan hasil edit web yang belum sama dengan sheet. Ikon lonceng di header menampilkan jumlah & daftar (merah = salah/duplikat, kuning = perlu dicek, abu = belum lengkap) dengan tombol **Perbaiki** (buka form edit berisi nilai yang sudah dinormalkan) dan **Hapus** untuk duplikat. Notifikasi bisa diabaikan per item (tersimpan di browser) dan dipulihkan.

## Keandalan edit web ↔ spreadsheet
- Sebelum menyimpan edit, dashboard membaca ulang baris di sheet; bila berubah sejak dimuat (diedit di Sheets/orang lain) ditampilkan perbedaannya dengan pilihan **Muat nilai terbaru** atau **Tetap simpan**.
- Respons Apps Script yang tidak dikenal diperlakukan sebagai "belum pasti" lalu diverifikasi ke sheet (opId sama) — tidak lagi memicu baris ganda saat klik ulang.
- Verifikasi hasil tulis diulang hingga 4× (CSV publik Google bisa tertinggal 10–20 detik).
- Hasil tulis yang setelah 1 menit masih berbeda dengan sheet ditandai sebagai anomali "Sinkron".
