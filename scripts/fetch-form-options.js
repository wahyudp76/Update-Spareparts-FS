/**
 * Membaca daftar pilihan dropdown dari Google Form (halaman viewform publik) dan
 * menulis form-options.json. Dijalankan tiap sync oleh GitHub Actions, sehingga
 * dropdown "Tambah Laporan" di dashboard selalu sama dengan Google Form tanpa
 * perlu mengubah kode saat pilihan di form ditambah/dikurangi.
 */
const fs = require('fs');
const path = require('path');
const FORM_ID = process.env.FORM_ID || '19vA7xX0ggR3lIihGI_X4c1QpqBNaUCoEGK_Tv4swOBM';
const OUT = path.join(__dirname, '..', 'form-options.json');
// Judul pertanyaan di form → kunci yang dipakai dashboard
const MAP = { 'divisi':'divisi', 'jenis engine':'engineType', 'jenis irrigator':'irrType', 'jenis kerusakan':'damageType', 'tingkat kerusakan':'tingkat', 'status perbaikan':'repair' };

(async () => {
  try {
    const res = await fetch(`https://docs.google.com/forms/d/${FORM_ID}/viewform`, { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const m = html.match(/FB_PUBLIC_LOAD_DATA_ = (.*?);\s*<\/script>/s);
    if (!m) throw new Error('FB_PUBLIC_LOAD_DATA_ tidak ditemukan (form tidak publik?)');
    const data = JSON.parse(m[1]);
    const out = { formId: FORM_ID, title: data[1] && data[1][8] || '', fetchedAt: new Date().toISOString(), options: {} };
    for (const item of (data[1][1] || [])) {
      if (!item || !item[4] || !item[4][0]) continue;
      const q = item[4][0];
      const opts = (q[1] || []).map(o => o[0]).filter(v => v != null && v !== '');
      const key = MAP[String(item[1] || '').replace(/\s+/g, ' ').trim().toLowerCase()];
      if (key && opts.length) out.options[key] = opts;
    }
    if (!out.options.damageType || out.options.damageType.length < 5) throw new Error('daftar Jenis Kerusakan tidak terbaca');
    // Tulis hanya jika berubah (hindari commit kosong)
    let prev = null; try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {}
    if (prev && JSON.stringify(prev.options) === JSON.stringify(out.options)) { console.log('form-options.json: tidak berubah'); return; }
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log('form-options.json diperbarui:', Object.fromEntries(Object.entries(out.options).map(([k, v]) => [k, v.length + ' pilihan'])));
  } catch (e) {
    // Jangan gagalkan workflow — dashboard memakai daftar bawaan / file lama
    console.log('::warning title=Google Form::Gagal membaca pilihan form: ' + e.message);
  }
})();
