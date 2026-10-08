// ============================================================
// PG2 IRRIGATION DASHBOARD — KONFIGURASI SITUS
// ============================================================
// File ini berisi konfigurasi yang berlaku untuk SEMUA pengunjung
// dashboard (semua device / browser). Edit file ini lalu push ke
// GitHub untuk mengaktifkan fitur secara global.
//
// Cara mengaktifkan Edit/Hapus langsung dari web untuk semua user:
//   1. Deploy Apps Script Web App (lihat SETUP-EDIT.md)
//   2. Paste URL /exec ke bawah ini, simpan, commit, dan push.
//      Contoh: WRITE_URL: 'https://script.google.com/macros/s/AKfycb.../exec'
//
// Setelah diisi, fitur edit/hapus akan AKTIF OTOMATIS untuk SEMUA
// orang yang membuka dashboard di device manapun tanpa setup apapun.
// Biarkan kosong ('') untuk menonaktifkan (mode read-only).
// ============================================================
window.PG2_CONFIG = {
    // URL Web App Apps Script untuk write-proxy edit/hapus.
    WRITE_URL: 'https://script.google.com/macros/s/AKfycbwPvNK2MA5VzE3fiw-1mJpDPl8eVn0cGvpOQNER7sw1t98Co5xdwonTGHL244HI3Ut8yA/exec',

    // Spreadsheet "Unit Terpasang" (Draft Dashboard): dipakai untuk mengisi otomatis
    // Divisi / Jenis & Kode Engine / Jenis & Kode Irrigator saat Lokasi diketik di form
    // Tambah/Edit Laporan. Spreadsheet harus bisa dibaca "Siapa saja yang memiliki link".
    UNITS_SHEET_ID: '1WbGTDqC0Anh6O54twsJfiBiWcTri7FHyQjXIFrOoLz4',
    UNITS_SHEET_GID: '1884963951',
    // PIC wajib untuk laporan sejak tanggal ini (saat pertanyaan PIC ditambahkan ke Google Form).
    // Laporan sebelum tanggal ini tanpa PIC TIDAK dihitung anomali.
    PIC_REQUIRED_SINCE: '2026-10-03'
};
