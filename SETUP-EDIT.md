# Panduan Mengaktifkan Fitur Edit/Hapus untuk SEMUA User

Ada **dua cara** mengaktifkan fitur edit/hapus:

## 🚀 Cara termudah (satu kali setup, berlaku SEMUA device) — REKOMENDASI

Edit file `config.js` di repository lalu push ke GitHub. Setelah itu **semua orang yang membuka dashboard di device manapun bisa langsung edit/hapus tanpa perlu setup apapun**.

### Langkah-langkah:
1. Deploy Web App Apps Script (lihat langkah 1–7 di bawah "Deploy Web App").
2. Buka file `config.js` di repo.
3. Isi `WRITE_URL` dengan URL Web App yang didapat:
   ```js
   window.PG2_CONFIG = {
       WRITE_URL: 'https://script.google.com/macros/s/AKfycbxxxxx...xxxx/exec'
   };
   ```
4. Commit & push ke GitHub.
5. Setelah GitHub Pages deploy selesai, tombol Edit (✏️) dan Hapus (🗑️) akan muncul otomatis di tab **Data Lengkap** untuk semua user — tanpa setup apapun.

Ikon steker 🔌 di pojok kanan header akan tampil jika ingin menimpa (override) endpoint per-device.

---

## 📱 Cara per-device (tanpa edit repo)

Jika tidak ingin menyentuh repo, pengguna bisa klik banner "Aktifkan Edit/Hapus" atau ikon steker di header → paste URL Web App → Simpan. Berlaku hanya di browser/device itu saja (tersimpan di localStorage).

---

## Deploy Web App (sekali saja)

1. Buka **https://script.google.com/**, login dengan akun yang punya akses edit ke spreadsheet.
2. Klik **New Project** → hapus semua kode default.
3. Copy seluruh isi file [`scripts/write-proxy.gs`](./scripts/write-proxy.gs) → paste ke editor.
4. Pastikan `SHEET_ID` dan `SHEET_NAME` sesuai (sudah terisi default).
5. Klik **Save** 💾, beri nama (misal "PG2 Write Proxy").
6. Klik **Deploy → New deployment**
   - Type: **Web app**
   - Execute as: **Me** (akun Anda yang memiliki akses edit ke sheet)
   - Who has access: **Anyone** ⚠️ (bukan "Anyone with Google account")
7. Klik **Deploy**, authorize saat diminta (klik "Advanced" → "Go to …" jika ada warning Google belum verifikasi).
8. Copy **Web app URL** (`https://script.google.com/macros/s/xxxx/exec`).

Jika memilih cara global (rekomendasi) → paste URL itu ke `config.js` seperti di atas lalu push.
Jika memilih cara per-device → paste URL itu ke modal Setup di dashboard.

## Catatan Keamanan
- Siapapun yang tahu URL Web App bisa menulis spreadsheet. Karena URL hanya tersemat di kode GitHub Pages yang aksesnya adalah siapa pun yang Anda beri link dashboard, anggap ini sebagai "dashboard + write access dibagikan bersamaan". Jangan bagikan URL dashboard ke publik umum.
- Untuk mematikan: edit deployment Apps Script → pilih "Disabled", atau kosongkan `WRITE_URL` di `config.js` dan push.
- Tombol "Hapus" di perangkat manapun akan memanggil `sheet.deleteRow()` dengan pencocokan timestamp+lokasi+jenis kerusakan (fallback) atau nomor baris (akurat).
- Setelah edit/hapus berhasil, dashboard otomatis melakukan `refreshData(true)` (live fetch) sehingga perubahan langsung tampil. GitHub Actions 15 menit akan menyegarkan cache.

## Troubleshooting
| Problem | Solusi |
|---|---|
| Tombol Edit/Hapus tidak muncul | Jika pakai cara global, pastikan `config.js` sudah di-push dan GitHub Pages sudah ter-deploy (tunggu 1–2 menit). Hard refresh Ctrl+Shift+R. |
| Error 401/403 saat menyimpan | Pastikan "Who has access" di-deploy sebagai **Anyone** (bukan Anyone with Google). Deploy ulang jika perlu. |
| "Baris tidak ditemukan" | Klik tombol Refresh (🔄) dulu untuk memastikan nomor baris akurat dengan live sheet, lalu coba lagi. |
| Nonaktifkan di device saya padahal global aktif | Klik ikon steker di header → kosongkan URL → Simpan (tidak mempengaruhi user lain). |
