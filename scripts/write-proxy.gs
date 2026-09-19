/**
 * PG2 Irrigation Dashboard — Write Proxy
 * -----------------------------------------------
 * Web App kecil yang berjalan sebagai Apps Script untuk
 * menerima perintah EDIT/DELETE dari dashboard statis
 * di GitHub Pages dan menerapkannya langsung ke Google
 * Spreadsheet sumber (sheet "Response").
 *
 * Cara deploy:
 *   1. Buka https://script.google.com/ dan buat project baru
 *   2. Hapus kode default, paste seluruh file ini
 *   3. Pastikan const SHEET_ID dan SHEET_NAME di bawah sesuai
 *   4. Klik Deploy → New deployment
 *   5. Type: Web app
 *      - Execute as: Me (xxx@gmail.com)
 *      - Who has access: Anyone  ← WAJIB "Anyone" (bukan Anyone with Google)
 *   6. Authorize saat diminta, copy URL /exec
 *   7. Paste URL itu ke tombol Setup di dashboard
 *
 * Endpoint:
 *   GET ?action=ping             → health check
 *   POST {action:'update', ...}  → update sebaris
 *   POST {action:'delete', ...}  → hapus sebaris
 *
 * Keamanan:
 *   Script ini TIDAK menggunakan token/secret — setiap
 *   orang yang tahu URL bisa menulis spreadsheet. Untuk
 *   lingkungan internal PG2 dengan akses terbatas ini
 *   cukup; JANGAN sebarkan URL-nya secara publik.
 */
const SHEET_ID   = '1TZiQfgiVXmXCLorD1BePuH2wEDnUcy_zWTivQSE3fUk';
const SHEET_NAME = 'Response';

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'ping') {
    return ContentService.createTextOutput('pong');
  }
  return ContentService.createTextOutput('pg2-write-proxy ok');
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action || '';
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return _err('Sheet ' + SHEET_NAME + ' tidak ditemukan');

    // Ambil header & data
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return _err('Sheet kosong');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const headerIdx = {};
    headers.forEach(function(h, i){
      headerIdx[String(h).trim().toLowerCase()] = i;
    });

    // Cari baris target (cocokkan dulu sheetRow kalau ada; fallback ke match key)
    function findRow(payload) {
      if (payload.sheetRow && payload.sheetRow >= 2 && payload.sheetRow <= lastRow) {
        return payload.sheetRow;
      }
      // Fallback: cari berdasarkan timestamp + lokasi + damage
      const tsCol = _col('timestamp');
      const lokCol = _col('lokasi');
      const dmgCol = _col('jenis kerusakan');
      const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const ts = _ts(row[tsCol]);
        if (!ts) continue;
        const sameTs = Math.abs(ts - new Date(payload.matchTs).getTime()) < 86400000; // ±1 hari
        const sameLok = String(row[lokCol]||'').trim() === String(payload.matchLokasi||'').trim();
        const sameDmg = String(row[dmgCol]||'').trim() === String(payload.matchDamage||'').trim();
        if (sameTs && sameLok && sameDmg) return i + 2;
      }
      return -1;
    }

    function _col(key) {
      const idx = headerIdx[key.toLowerCase()];
      return idx === undefined ? -1 : idx;
    }
    function _ts(v) {
      if (v instanceof Date) return v.getTime();
      if (!v) return 0;
      const d = new Date(v);
      return isNaN(d.getTime()) ? 0 : d.getTime();
    }

    if (action === 'update') {
      const r = findRow(body);
      if (r < 0) return _err('Baris tidak ditemukan di sheet');
      // Field yang bisa diupdate (nama kolom persis sesuai header)
      const updates = [
        { key: 'Tanggal Inspeksi',        val: body.tanggalInspeksi, type: 'date' },
        { key: 'Lokasi',                  val: body.lokasi },
        { key: 'DIvisi',                  val: body.divisi },  // header sheet memang "DIvisi"
        { key: 'Jenis Engine',            val: body.engineType },
        { key: 'Kode Engine',             val: body.engineCode },
        { key: 'Jenis Irrigator',         val: body.irrType },
        { key: 'Kode Irrigator',          val: body.irrCode },
        { key: 'Jenis Kerusakan',         val: body.damageType },
        { key: 'Keterangan Kerusakan',    val: body.keterangan },
        { key: 'Spareparts Yang Dibutuhkan', val: body.sparepart },
        { key: 'Nomor PR / Notifikasi',   val: body.prNumber }
      ];
      updates.forEach(function(u){
        const c = _col(u.key);
        if (c < 0) return;
        let v = (u.val === '-' || u.val === null || u.val === undefined) ? '' : u.val;
        if (u.type === 'date' && v) {
          // Spreadsheet form responses memakai format MM/dd/yyyy HH:mm:ss
          // Pakai DateTimeFormat agar kompatibel dengan locale sheet
          v = Utilities.formatDate(new Date(v + ' 12:00:00'), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
        }
        sheet.getRange(r, c + 1).setValue(v);
      });
      // Status ditentukan otomatis dari prNumber (tidak ada kolom tersendiri)
      return _ok('updated row ' + r);
    }

    if (action === 'delete') {
      const r = findRow(body);
      if (r < 0) return _err('Baris tidak ditemukan di sheet');
      sheet.deleteRow(r);
      return _ok('deleted row ' + r);
    }

    return _err('Unknown action: ' + action);
  } catch (e) {
    return _err('Exception: ' + (e && e.message ? e.message : e));
  }
}

function _ok(msg)  { return ContentService.createTextOutput('ok: ' + msg); }
function _err(msg) { return ContentService.createTextOutput('error: ' + msg); }
