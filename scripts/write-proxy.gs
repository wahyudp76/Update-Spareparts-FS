/**
 * PG2 Irrigation Dashboard — Write Proxy  (v4 — tambah action 'create': catat laporan baru dari web)
 * -----------------------------------------------------------
 * Web App Apps Script yang menerima perintah EDIT/DELETE dari dashboard
 * statis (GitHub Pages) dan menerapkannya ke Google Spreadsheet sumber.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ CARA DEPLOY / UPDATE (WAJIB diikuti persis, ini penyebab error umum)  │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ 1. https://script.google.com → buka project proxy (atau New project) │
 * │ 2. Ganti SELURUH kode dengan isi file ini → Save                      │
 * │ 3. Di toolbar pilih fungsi  "authorize"  → klik Run → izinkan akses  │
 * │    Spreadsheet saat diminta. (Tanpa langkah ini, doPost akan gagal   │
 * │    diam-diam dan Google mengirim halaman HTML "Sorry, unable to open  │
 * │    the file" ke dashboard → itulah error edit/hapus.)                 │
 * │ 4. Deploy → Manage deployments → ✏️ Edit → Version: "New version"     │
 * │    → Execute as: Me · Who has access: Anyone → Deploy.                │
 * │    (JANGAN "New deployment" — itu membuat URL baru dan config.js      │
 * │    harus diubah. Kalau terpaksa URL baru, update config.js.)          │
 * │ 5. Uji: buka <URL>/exec?action=check → harus "ok: sheet Response,     │
 * │    N baris". Jika HTML/“pong” saja → ulangi langkah 3–4.              │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Endpoint:
 *   GET  ?action=ping    → "pong"           (server hidup)
 *   GET  ?action=check   → "ok: sheet …"    (server hidup + BISA baca sheet)
 *   POST {action:'create', ...}  → "ok: created row N"
 *   POST {action:'update', ...}  → "ok: updated row N"
 *   POST {action:'delete', ...}  → "ok: deleted row N"
 *   Semua error → "error: <pesan>" (teks, bukan HTML) dengan HTTP 200.
 */
var SHEET_ID   = '1TZiQfgiVXmXCLorD1BePuH2wEDnUcy_zWTivQSE3fUk';
var SHEET_NAME = 'Response';
var VERSION    = 'v4';

/** Jalankan SEKALI secara manual dari editor untuk memicu dialog otorisasi. */
function authorize() {
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  Logger.log('OK, akses spreadsheet berhasil. Baris: ' + sh.getLastRow());
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'ping') return _text('pong');
  if (action === 'check') {
    try {
      var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
      if (!sh) return _text('error: sheet ' + SHEET_NAME + ' tidak ditemukan');
      return _text('ok: sheet ' + SHEET_NAME + ', ' + (sh.getLastRow() - 1) + ' baris, ' + VERSION);
    } catch (err) {
      return _text('error: tidak bisa membuka spreadsheet — ' + err.message + ' (jalankan fungsi authorize lalu deploy New version)');
    }
  }
  return _text('pg2-write-proxy ok ' + VERSION);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return _text('error: server sibuk, coba lagi');
  }
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (!raw && e && e.parameter && e.parameter.payload) raw = e.parameter.payload;
    var body;
    try { body = JSON.parse(raw || '{}'); } catch (pe) { return _text('error: body bukan JSON valid'); }
    var action = body.action || '';

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return _text('error: Sheet ' + SHEET_NAME + ' tidak ditemukan');

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 1 || lastCol < 1) return _text('error: Sheet tidak punya header');
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var headerIdx = {};
    headers.forEach(function (h, i) { headerIdx[_norm(h)] = i; });

    function col(key) {
      var k = _norm(key);
      if (headerIdx[k] !== undefined) return headerIdx[k];
      // pencocokan longgar (mis. "DIvisi" vs "Divisi", spasi ganda)
      for (var h in headerIdx) if (h.indexOf(k) >= 0 || k.indexOf(h) >= 0) return headerIdx[h];
      return -1;
    }

    var tsCol = col('Timestamp'), tglCol = col('Tanggal Inspeksi'), lokCol = col('Lokasi'), dmgCol = col('Jenis Kerusakan');

    // Definisi kolom yang bisa ditulis (dipakai create & update)
    var FIELDS = [
      { key: 'Tanggal Inspeksi',            prop: 'tanggalInspeksi', type: 'date' },
      { key: 'Lokasi',                      prop: 'lokasi' },
      { key: 'Divisi',                      prop: 'divisi' },
      { key: 'Jenis Engine',                prop: 'engineType' },
      { key: 'Kode Engine',                 prop: 'engineCode',  type: 'code', digits: 4 },
      { key: 'Jenis Irrigator',             prop: 'irrType' },
      { key: 'Kode Irrigator',              prop: 'irrCode',     type: 'code', digits: 4 },
      { key: 'Jenis Kerusakan',             prop: 'damageType' },
      { key: 'Keterangan Kerusakan',        prop: 'keterangan' },
      { key: 'Spareparts Yang Dibutuhkan',  prop: 'sparepart' },
      { key: 'Nomor PR / Notifikasi',       prop: 'prNumber',    type: 'code', digits: 8 },
      { key: 'Tingkat Kerusakan',           prop: 'tingkat' },
      { key: 'Status Perbaikan',            prop: 'repairStatus' }
    ];
    // Validasi angka: tolak titik/koma sebagai pemisah agar angka tidak normal tidak masuk sheet
    function checkCode(f, v) {
      v = String(v == null ? '' : v).trim();
      if (!v || v === '-') return null;
      if (/[.,]/.test(v)) return f.key + ' "' + v + '" memakai titik/koma — tulis angka tanpa pemisah';
      if (!/^\d+$/.test(v)) return f.key + ' "' + v + '" harus berupa angka saja';
      if (f.digits && v.length !== f.digits) return f.key + ' "' + v + '" harus ' + f.digits + ' digit';
      return null;
    }
    function toCell(f, v) {
      if (v === undefined) return undefined;
      v = (v === '-' || v === null) ? '' : v;
      if (f.type === 'date') {
        if (!v) return '';
        var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0) : v;
      }
      return v;
    }

    if (action === 'create') {
      if (!body.lokasi || body.lokasi === '-') return _text('error: Lokasi wajib diisi');
      if (!body.damageType || body.damageType === '-') return _text('error: Jenis Kerusakan wajib diisi');
      var errs = [];
      FIELDS.forEach(function (f) { if (f.type === 'code') { var er = checkCode(f, body[f.prop]); if (er) errs.push(er); } });
      if (errs.length) return _text('error: ' + errs.join('; '));
      var rowVals = new Array(lastCol); for (var k = 0; k < lastCol; k++) rowVals[k] = '';
      if (tsCol >= 0) rowVals[tsCol] = new Date();
      FIELDS.forEach(function (f) {
        var c = col(f.key); if (c < 0) return;
        var v = toCell(f, body[f.prop]); if (v === undefined) return;
        rowVals[c] = (f.type === 'code' && v !== '') ? String(v) : v;
      });
      var newRow = lastRow + 1;
      sheet.getRange(newRow, 1, 1, lastCol).setValues([rowVals]);
      // Kolom kode → format Teks supaya "0032" tidak berubah jadi 32 dan tidak muncul notasi ilmiah
      FIELDS.forEach(function (f) { if (f.type === 'code') { var c = col(f.key); if (c >= 0) { var cell = sheet.getRange(newRow, c + 1); cell.setNumberFormat('@'); if (rowVals[c] !== '') cell.setValue(String(rowVals[c])); } } });
      SpreadsheetApp.flush();
      return _text('ok: created row ' + newRow);
    }

    if (lastRow < 2) return _text('error: Sheet kosong');
    var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    // Verifikasi bahwa baris kandidat memang baris yang dimaksud (lokasi + jenis kerusakan
    // + tanggal ±1 hari). Ini melindungi dari __row yang basi (baris lain sudah dihapus/
    // ditambah sejak data dimuat).
    function rowMatches(rowVals, p) {
      var lokOk = _norm(rowVals[lokCol]) === _norm(p.matchLokasi);
      var dmgOk = dmgCol < 0 || _norm(rowVals[dmgCol]) === _norm(p.matchDamage);
      var want = p.matchTs ? new Date(p.matchTs).getTime() : NaN;
      var tsOk = true;
      if (!isNaN(want)) {
        var have = _ts(tglCol >= 0 ? rowVals[tglCol] : null) || _ts(tsCol >= 0 ? rowVals[tsCol] : null);
        tsOk = !have || Math.abs(have - want) < 2 * 86400000; // ±2 hari (toleransi zona waktu)
      }
      return lokOk && dmgOk && tsOk;
    }

    function findRow(p) {
      var sr = parseInt(p.sheetRow, 10);
      if (sr >= 2 && sr <= lastRow && rowMatches(data[sr - 2], p)) return sr;
      // fallback: cari di seluruh sheet
      var found = [];
      for (var i = 0; i < data.length; i++) if (rowMatches(data[i], p)) found.push(i + 2);
      if (found.length === 1) return found[0];
      if (found.length > 1 && sr >= 2 && found.indexOf(sr) >= 0) return sr;
      if (found.length > 1) return found[found.length - 1];
      return -1;
    }

    if (action === 'update') {
      var r = findRow(body);
      if (r < 0) return _text('error: Baris tidak ditemukan di sheet (mungkin sudah dihapus/berubah). Klik Refresh lalu coba lagi.');
      var updates = [
        { key: 'Tanggal Inspeksi',            val: body.tanggalInspeksi, type: 'date' },
        { key: 'Lokasi',                      val: body.lokasi },
        { key: 'Divisi',                      val: body.divisi },
        { key: 'Jenis Engine',                val: body.engineType },
        { key: 'Kode Engine',                 val: body.engineCode },
        { key: 'Jenis Irrigator',             val: body.irrType },
        { key: 'Kode Irrigator',              val: body.irrCode },
        { key: 'Jenis Kerusakan',             val: body.damageType },
        { key: 'Keterangan Kerusakan',        val: body.keterangan },
        { key: 'Spareparts Yang Dibutuhkan',  val: body.sparepart },
        { key: 'Nomor PR / Notifikasi',       val: body.prNumber },
        { key: 'Tingkat Kerusakan',           val: body.tingkat },
        { key: 'Status Perbaikan',            val: body.repairStatus }
      ];
      updates.forEach(function (u) {
        if (u.val === undefined) return;          // field tidak dikirim → jangan sentuh
        var c = col(u.key);
        if (c < 0) return;
        var v = (u.val === '-' || u.val === null) ? '' : u.val;
        var cell = sheet.getRange(r, c + 1);
        if (u.type === 'date') {
          if (!v) { cell.setValue(''); return; }
          // Tulis sebagai objek Date (bukan string) → tampil sesuai locale sheet (ID = dd/MM/yyyy)
          var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (m) { cell.setValue(new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0)); return; }
          cell.setValue(v); return;
        }
        // Kode seperti "0032" harus tetap teks agar nol di depan tidak hilang
        if (/^0\d+$/.test(String(v))) { cell.setNumberFormat('@'); cell.setValue(String(v)); return; }
        cell.setValue(v);
      });
      SpreadsheetApp.flush();
      return _text('ok: updated row ' + r);
    }

    if (action === 'delete') {
      var rd = findRow(body);
      if (rd < 0) return _text('error: Baris tidak ditemukan di sheet (mungkin sudah dihapus). Klik Refresh lalu coba lagi.');
      sheet.deleteRow(rd);
      SpreadsheetApp.flush();
      return _text('ok: deleted row ' + rd);
    }

    if (action === 'ping') return _text('pong');
    return _text('error: Unknown action: ' + action);
  } catch (err) {
    return _text('error: Exception: ' + (err && err.message ? err.message : err));
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function _norm(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase(); }
function _ts(v) {
  if (v instanceof Date) return v.getTime();
  if (!v) return 0;
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);       // dd/MM/yyyy (locale ID)
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]).getTime();
  var d = new Date(s);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
function _text(msg) { return ContentService.createTextOutput(msg).setMimeType(ContentService.MimeType.TEXT); }
