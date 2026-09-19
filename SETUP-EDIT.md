# Panduan Mengaktifkan Fitur Edit/Hapus Langsung dari Web

Secara default dashboard bersifat *read-only* (data ditarik dari GitHub cache yang di-sync 15 menit sekali). Untuk bisa **mengedit dan menghapus baris langsung dari web** (dan perubahan langsung tersimpan ke Google Sheets), perlu deploy Apps Script Web App sebagai *write proxy* sekali saja.

## 1. Deploy Web App

1. Buka **https://script.google.com/**, login dengan akun Google yang punya akses edit ke spreadsheet PG2.
2. Klik **New Project** → hapus semua kode default.
3. Buka file [`scripts/write-proxy.gs`](./write-proxy.gs) di repo ini, **copy seluruh isinya** → paste ke editor Apps Script.
4. Pastikan dua baris di atas cocok dengan spreadsheet Anda:
   ```js
   const SHEET_ID   = '1TZiQfgiVXmXCLorD1BePuH2wEDnUcy_zWTivQSE3fUk';
   const SHEET_NAME = 'Response';
   ```
5. Klik tombol **Save** 💾 (nama project bebas, misal `PG2 Write Proxy`).
6. Klik **Deploy** → **New deployment**
7. Klik ⚙️ → **Web app**
   - **Execute as:** `Me (xxx@gmail.com)`
   - **Who has access:** `Anyone` ← WAJIB pilih "Anyone" (bukan "Anyone with Google account")
8. Klik **Deploy**, authorize saat diminta (klik "Advanced" → "Go to …" kalau ada warning Google belum verifikasi — normal karena ini script Anda sendiri).
9. Copy **Web app URL** yang muncul (formatnya `https://script.google.com/macros/s/xxxx/exec`).

## 2. Hubungkan ke Dashboard

1. Buka dashboard (GitHub Pages Anda).
2. Muncul banner **"Aktifkan Edit/Hapus Langsung"** di pojok kiri bawah → klik **Setup**.
3. Paste URL Web App yang dicopy ke kolom, klik **Tes koneksi** — kalau berhasil muncul centang hijau.
4. Klik **Simpan**.

URL tersimpan di browser Anda (localStorage), tidak di-share ke server.

## 3. Pakai Fitur

Setelah tersetup:

- Buka tab **Data Lengkap**
- Di kolom paling kanan ada dua tombol aksi per baris:
  - ✏️ **Edit** — membuka modal form untuk mengubah Tanggal, Lokasi, Divisi, Status, Engine (jenis+kode), Irigator (jenis+kode), Jenis Kerusakan, Keterangan, Sparepart, Nomor PR. Klik **Simpan ke Spreadsheet**.
  - 🗑️ **Hapus** — konfirmasi → baris dihapus dari Google Sheets.

Setelah berhasil, dashboard otomatis refresh data live dari sheet.

## Catatan Keamanan

- Web App ini **tidak memakai API key/secret**. Siapa pun yang tahu URL bisa menulis spreadsheet. Jangan bagikan URL ini secara publik.
- Kalau ingin mematikan fitur: buka **Setup** → kosongkan kolom URL → Simpan. Atau buka Apps Script → **Manage deployments** → **Archive** deployment.
- Perubahan tetap lewat GitHub Actions (15 menit) untuk cache; edit/hapus tersinkron instan ke Google Sheets dan ter-refresh ke user berikutnya setelah sync GitHub berjalan atau tombol Refresh diklik.

## Troubleshooting

| Masalah | Solusi |
|---|---|
| "Respons tidak valid (401/403)" | Deploy ulang dengan akses "Anyone" (bukan "Anyone with Google account") |
| "Baris tidak ditemukan" | Ada kemungkinan urutan data berubah. Klik **Refresh** dulu lalu coba lagi — `__row` akan ter-update dari live. |
| Tombol tidak muncul / banner tidak ada | Hard refresh browser (Ctrl+Shift+R), pastikan browser tidak memblokir localStorage. |
