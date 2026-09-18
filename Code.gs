/**
 * ============================================================
 *  GOOGLE APPS SCRIPT - PG2 Irrigation Dashboard Backend
 * ============================================================
 * 
 *  Cara deploy:
 *  1. Buka Google Spreadsheet ID: 1TZiQfgiVXmXCLorD1BePuH2wEDnUcy_zWTivQSE3fUk
 *  2. Klik menu Extensions > Apps Script
 *  3. Hapus semua kode default, copy-paste seluruh isi file ini ke Code.gs
 *  4. Sesuaikan SHEET_NAME bila nama sheet bukan "Response"
 *  5. Klik Deploy > New deployment
 *  6. Tipe: Web app
 *     - Execute as: Me (your email)
 *     - Who has access: Anyone (with link)
 *  7. Klik Deploy, copy URL Web App
 *  8. Buka dashboard, klik ikon gear (pengaturan) di kanan atas
 *     paste URL tersebut dan klik "Simpan & Hubungkan"
 * ============================================================
 */

const SHEET_ID   = '1TZiQfgiVXmXCLorD1BePuH2wEDnUcy_zWTivQSE3fUk';
const SHEET_NAME = 'Response'; // pastikan sama dengan nama sheet "Response"

function doGet(e) {
  try {
    const action = (e.parameter.action || 'getAll').toLowerCase();
    let result;
    if (action === 'getall') {
      result = getAllData();
    } else if (action === 'summary') {
      result = getSummary();
    } else {
      result = { error: 'Unknown action: ' + action };
    }
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getAllData() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) return { error: 'Sheet "' + SHEET_NAME + '" tidak ditemukan' };
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  // Format setiap row menjadi object pakai header
  const headers = values[0].map(h => String(h || '').trim());
  const data = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every(c => c === '' || c === null)) continue; // skip row kosong
    const obj = {};
    headers.forEach((h, idx) => {
      const v = row[idx];
      obj[h] = v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss') : v;
    });
    data.push(obj);
  }
  return data;
}

function getSummary() {
  const data = getAllData();
  const byUnit = {}, byIrrigator = {}, bySparepart = {}, byStatus = {};
  data.forEach(d => {
    const unit = d['Unit'] || d['Nama Unit'] || 'Unknown';
    const irr = d['Irrigator'] || d['Nama Irrigator'] || '-';
    const sp = d['Sparepart'] || d['Sparepart yang Dibutuhkan'] || '-';
    const st = d['Status'] || 'Belum Ditangani';
    byUnit[unit] = (byUnit[unit]||0)+1;
    byIrrigator[irr] = (byIrrigator[irr]||0)+1;
    bySparepart[sp] = (bySparepart[sp]||0)+(parseInt(d['Qty']||d['Jumlah'])||1);
    byStatus[st] = (byStatus[st]||0)+1;
  });
  return { total: data.length, byUnit, byIrrigator, bySparepart, byStatus };
}

/**
 * Opsional: Untuk menambahkan data via POST (jika dibutuhkan form tambahan)
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = ss.getSheetByName(SHEET_NAME);
    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    const newRow = headers.map(h => body[String(h).trim()] || '');
    sh.appendRow(newRow);
    return ContentService.createTextOutput(JSON.stringify({ ok:true })).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}
