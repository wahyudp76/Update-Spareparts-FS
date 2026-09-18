# PG2 - Dashboard Monitoring Kerusakan & Spareparts Irigasi

Dashboard interaktif untuk memonitor kerusakan unit irigasi dan kebutuhan spareparts di PG2. Data tersinkronisasi otomatis dari Google Spreadsheet **Form_Responses** pada sheet **Response**.

![Preview](https://img.shields.io/badge/Status-Live-brightgreen) ![Tech](https://img.shields.io/badge/Stack-HTML%2FTailwind%2FChart.js-blue)

## 🎯 Fitur Utama

- 📊 **Visualisasi Real-time** — Chart tren kerusakan, distribusi status, top unit/irrigator yang sering rusak, dan ringkasan sparepart
- 🗓️ **Filter Periode** — Harian, Mingguan, Bulanan, Semua data, plus custom date range
- 🔍 **Filter Lanjutan** — Berdasarkan Unit, Status, dan pencarian keyword
- ⚠️ **Status Penanganan** — Belum Ditangani (Merah), Proses (Kuning), Selesai (Hijau)
- 📋 **Tabel Detail** — Data lengkap dengan sorting & pagination
- 📥 **Export CSV** — Download laporan dalam satu klik
- 🔄 **Auto-refresh** — Data update otomatis setiap 5 menit
- 📱 **Responsive Design** — Tampil optimal di desktop, tablet, maupun mobile
- 🎨 **Modern & Minimalis** — Tema glassmorphism dengan animasi yang smooth

## 🔧 Cara Setup Koneksi ke Google Spreadsheet

Dashboard perlu dihubungkan ke spreadsheet melalui **Google Apps Script** (agar bisa membaca data tanpa login).

### Langkah-langkah:

1. **Buka Google Spreadsheet**
   - Spreadsheet ID: `1TZiQfgiVXmXCLorD1BePuH2wEDnUcy_zWTivQSE3fUk`
   - Pastikan sheet bernama **Response** berisi data Form Responses

2. **Buka Apps Script**
   - Di dalam spreadsheet, klik menu `Extensions` → `Apps Script`
   - Hapus semua kode default di `Code.gs`

3. **Copy Kode Apps Script**
   - Buka file `Code.gs` yang ada di repo ini
   - Copy seluruh isinya dan paste ke Apps Script editor
   - Klik 💾 **Save** (icon disket)

4. **Deploy sebagai Web App**
   - Klik `Deploy` → `New deployment`
   - Klik ⚙️ icon → pilih **Web app**
   - Isi:
     - **Description**: `PG2 Dashboard API`
     - **Execute as**: `Me (your email)`
     - **Who has access**: `Anyone` (atau "Anyone with the link")
   - Klik **Deploy**
   - Berikan izin akses saat diminta (klik "Review Permissions" → pilih akun → klik "Advanced" → "Go to ..." → "Allow")
   - Copy **Web App URL** yang diberikan (format: `https://script.google.com/macros/s/.../exec`)

5. **Hubungkan ke Dashboard**
   - Buka dashboard di browser
   - Klik icon ⚙️ **(Settings/Pengaturan)** di kanan atas
   - Paste URL Web App ke input field
   - Klik **Simpan & Hubungkan**
   - Dashboard akan otomatis memuat data real dari spreadsheet!

## 📁 Struktur File

```
Update-Spareparts-FS/
├── index.html        # Halaman utama dashboard
├── app.js            # Logika aplikasi, filtering, chart, dan data binding
├── Code.gs           # Google Apps Script backend (untuk di-copy ke Apps Script)
└── README.md         # Dokumentasi ini
```

## 🚀 Cara Membuka Dashboard

### Lokal
Buka langsung `index.html` di browser modern (Chrome, Firefox, Edge).

### Host di GitHub Pages
1. Push file ini ke GitHub repo
2. Di repo, masuk ke `Settings` → `Pages`
3. Source: `Deploy from a branch` → Branch: `main` → Folder: `/ (root)` → Save
4. Dashboard akan tersedia di `https://wahyudp76.github.io/Update-Spareparts-FS/`

## 📝 Format Kolom yang Diharapkan dari Spreadsheet

Agar mapping otomatis bekerja, gunakan header kolom (row pertama) yang minimal mengandung kata kunci berikut:

| Kolom | Keyword Header yang dikenali | Contoh |
|-------|------------------------------|--------|
| Timestamp/Waktu | `timestamp`, `tanggal`, `waktu` | 20/09/2026 08:30 |
| Unit | `unit` | PG2-A1 |
| Irrigator | `irrigator` | Irr-01 |
| Kerusakan | `kerusakan`, `damage`, `masalah` | Kebocoran Pipa |
| Sparepart | `sparepart`, `spare` | Seal Karet |
| Quantity | `qty`, `jumlah`, `quantity` | 3 |
| Status | `status` | Belum Ditangani |
| Pelapor | `pelapor`, `nama`, `reporter` | Budi Santoso |
| Catatan | `catatan`, `note`, `keterangan` | (opsional) |

> Header tidak harus persis sama — sistem akan mengenali keyword di atas secara case-insensitive.

## 🎨 Warna Status

| Status | Badge | Warna |
|--------|-------|-------|
| Belum Ditangani | 🔴 Merah | Perlu segera ditangani |
| Proses | 🟡 Kuning | Sedang dalam perbaikan |
| Selesai | 🟢 Hijau | Unit sudah beroperasi normal |

## 🔄 Auto Refresh

Dashboard akan otomatis refresh data setiap **5 menit**. Anda juga bisa klik tombol **Refresh** di kanan atas untuk update manual.

## ❓ Troubleshooting

- **Data tidak muncul / masih demo**: Pastikan Apps Script sudah di-deploy dengan akses "Anyone" dan URL sudah dimasukkan di Settings.
- **Error CORS**: Di deployment Apps Script, pastikan memilih versi "New deployment" (bukan "Manage deployments" tanpa update versi).
- **Kolom tidak terbaca**: Periksa header row pertama — pastikan nama kolom mengandung keyword yang tercantum di atas.
- **Data lama tidak ter-update**: Klik tombol Refresh atau tunggu 5 menit untuk auto-refresh.

## 📞 Spreadsheet Info

- **Spreadsheet ID**: `1TZiQfgiVXmXCLorD1BePuH2wEDnUcy_zWTivQSE3fUk`
- **Sheet Name**: `Response` (dari form `Form_Responses`)
- **Repository**: https://github.com/wahyudp76/Update-Spareparts-FS

---
&copy; 2026 PG2 Irrigation Monitoring System
