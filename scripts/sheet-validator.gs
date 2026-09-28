/**
 * PG2 — Pemeriksa Input Spreadsheet (pencegahan di sumber)
 * -------------------------------------------------------------
 * Menandai sel yang berisi angka TIDAK NORMAL saat diketik/di-paste:
 *   • memakai titik/koma sebagai pemisah (11.095.745 / 11,095,745 / 32,0)
 *   • notasi ilmiah (1.1E7) akibat sel berformat angka
 *   • jumlah digit tidak sesuai (Nomor PR 8 digit, Kode Engine/Irrigator 4 digit)
 *   • Tingkat Kerusakan / Status Perbaikan di luar pilihan yang diizinkan
 * Sel bermasalah diwarnai MERAH MUDA + diberi catatan (note) penjelasan, dan
 * angka dengan pemisah otomatis dinormalkan (opsional, lihat AUTO_FIX).
 *
 * CARA PASANG (sekali, ±1 menit) — bisa di project Apps Script yang sama
 * dengan write-proxy.gs (standalone) ATAU project terikat spreadsheet
 * (Extensions → Apps Script). Keduanya didukung.
 *   1. Buka project Apps Script.
 *   2. File → New → Script, beri nama "sheet-validator", tempel seluruh isi ini → Save.
 *   3. Pilih fungsi  installValidationTrigger  di toolbar → Run → izinkan akses.
 *      (Trigger "on edit" terpasang; berjalan untuk semua editor sheet.)
 *   4. Uji: ketik 11.095.745 di kolom Nomor PR → sel jadi merah muda + catatan.
 *   Opsional: jalankan  scanAllRows  untuk memeriksa seluruh data lama sekaligus.
 */
var VAL_SPREADSHEET_ID = '1TZiQfgiVXmXCLorD1BePuH2wEDnUcy_zWTivQSE3fUk'; // ID spreadsheet (dipakai jika project standalone)
var VAL_SHEET_NAME = 'Response';
var AUTO_FIX = true; // true = angka dengan titik/koma otomatis diganti ke digit saja (tetap diberi catatan)
var BAD_COLOR = '#fde2e2';

var NUMERIC_COLS = {
  'nomor pr / notifikasi': { label: 'Nomor PR / Notifikasi', digits: 8 },
  'kode engine':           { label: 'Kode Engine',           digits: 4 },
  'kode irrigator':        { label: 'Kode Irrigator',        digits: 4 }
};
var ENUM_COLS = {
  'tingkat kerusakan': ['Berat', 'Sedang', 'Ringan'],
  'status perbaikan':  ['Sudah', 'Belum']
};

function _ss() {
  // Berfungsi di project terikat spreadsheet maupun project standalone
  var ss = null;
  try { ss = SpreadsheetApp.getActive(); } catch (e) {}
  if (!ss) ss = SpreadsheetApp.openById(VAL_SPREADSHEET_ID);
  return ss;
}
function _alert(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

function installValidationTrigger() {
  var ss = _ss();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onEditValidate') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onEditValidate').forSpreadsheet(ss).onEdit().create();
  // Paksa kolom angka menjadi Plain text agar nol di depan & digit panjang tidak berubah
  var sh = ss.getSheetByName(VAL_SHEET_NAME);
  if (sh) {
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    headers.forEach(function (h, i) {
      if (NUMERIC_COLS[_n(h)]) sh.getRange(2, i + 1, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
    });
  }
  _alert('Pemeriksa input aktif.\nKolom angka diset ke format Teks. Ketik angka tanpa titik/koma.');
}

function onEditValidate(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== VAL_SHEET_NAME) return;
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var r0 = e.range.getRow(), c0 = e.range.getColumn();
    var nR = e.range.getNumRows(), nC = e.range.getNumColumns();
    for (var r = r0; r < r0 + nR; r++) {
      if (r < 2) continue;
      for (var c = c0; c < c0 + nC; c++) {
        _checkCell(sh, r, c, headers[c - 1]);
      }
    }
  } catch (err) { /* jangan ganggu pengguna */ }
}

/** Periksa seluruh baris yang sudah ada (jalankan manual). */
function scanAllRows() {
  var sh = _ss().getSheetByName(VAL_SHEET_NAME);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var last = sh.getLastRow(), bad = 0;
  for (var r = 2; r <= last; r++) {
    for (var c = 1; c <= headers.length; c++) {
      if (_checkCell(sh, r, c, headers[c - 1])) bad++;
    }
  }
  _alert('Selesai. Sel bermasalah: ' + bad + ' (ditandai merah muda + catatan).');
}

function _checkCell(sh, r, c, header) {
  var key = _n(header);
  var cell = sh.getRange(r, c);
  var raw = cell.getValue();
  var disp = cell.getDisplayValue();
  var v = String(raw == null ? '' : raw).trim();
  var problems = [], fixed = null;

  if (NUMERIC_COLS[key]) {
    var cfg = NUMERIC_COLS[key];
    if (v === '') { _clear(cell); return false; }
    if (typeof raw === 'number') {
      // Sel berformat angka: 00032 → 32, 11095745 → 1.1E7 di tampilan
      problems.push('Sel berformat ANGKA. Gunakan format Teks agar nol di depan/digit tidak berubah.');
      fixed = String(Math.round(raw));
    } else if (/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(v)) {
      problems.push('Notasi ilmiah "' + v + '".');
      fixed = String(Math.round(Number(v)));
    } else if (/[.,]/.test(v)) {
      var mDec = v.match(/^(\d+)[.,]0+$/);
      var digits = mDec ? mDec[1] : v.replace(/[.,\s]/g, '');
      if (/^\d+$/.test(digits)) {
        problems.push(cfg.label + ' ditulis dengan TITIK/KOMA sebagai pemisah ("' + v + '"). Tulis tanpa pemisah: ' + digits);
        fixed = digits;
      } else problems.push(cfg.label + ' "' + v + '" bukan angka yang valid.');
    } else if (!/^\d+$/.test(v)) {
      problems.push(cfg.label + ' mengandung karakter selain angka ("' + v + '").');
    }
    var check = fixed !== null ? fixed : v;
    if (/^\d+$/.test(check) && check.length !== cfg.digits) {
      if (check.length < cfg.digits) { problems.push('Hanya ' + check.length + ' digit, seharusnya ' + cfg.digits + ' (nol di depan hilang?).'); fixed = check.padStart ? check.padStart(cfg.digits, '0') : _pad(check, cfg.digits); }
      else problems.push(check.length + ' digit, seharusnya ' + cfg.digits + '.');
    }
  } else if (ENUM_COLS[key]) {
    if (v === '') { _clear(cell); return false; }
    var allowed = ENUM_COLS[key];
    var match = allowed.filter(function (a) { return a.toLowerCase() === v.toLowerCase(); })[0];
    if (!match) problems.push('Nilai "' + v + '" tidak dikenali. Pilihan: ' + allowed.join(' / '));
    else if (match !== v) fixed = match; // perbaiki kapitalisasi diam-diam
  } else if (key === 'tanggal inspeksi') {
    if (v === '') { _clear(cell); return false; }
    var d = raw instanceof Date ? raw : null;
    var y = d ? d.getFullYear() : NaN;
    if (d && (y < 2000 || y > 2100)) problems.push('Tahun tidak wajar (' + y + '). Periksa penulisan tanggal, mis. 27/09/2026.');
    if (d && d.getTime() > Date.now() + 86400000) problems.push('Tanggal di masa depan.');
  } else return false;

  if (problems.length) {
    cell.setBackground(BAD_COLOR);
    cell.setNote('⚠ ' + problems.join('\n⚠ ') + (fixed !== null && AUTO_FIX ? '\n→ Otomatis dinormalkan menjadi: ' + fixed + ' (nilai asli: ' + v + ')' : ''));
    if (fixed !== null && AUTO_FIX) { cell.setNumberFormat('@'); cell.setValue(fixed); }
    return true;
  }
  if (fixed !== null) { cell.setNumberFormat('@'); cell.setValue(fixed); }
  _clear(cell);
  return false;
}

function _clear(cell) { if (cell.getBackground() === BAD_COLOR) cell.setBackground(null); if (cell.getNote()) cell.setNote(''); }
function _n(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase(); }
function _pad(s, n) { while (s.length < n) s = '0' + s; return s; }
