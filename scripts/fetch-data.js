/**
 * scripts/fetch-data.js
 *
 * Ambil data dari Google Spreadsheet (sheet "Response") via endpoint
 * CSV publik Google, parse, lalu tulis ke data.json di root repo.
 *
 * Dijalankan otomatis oleh GitHub Actions tiap 15 menit
 * (dan juga saat push ke main / workflow_dispatch).
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SHEET_ID = process.env.SHEET_ID || '1TZiQfgiVXmXCLorD1BePuH2wEDnUcy_zWTivQSE3fUk';
const SHEET_NAME = process.env.SHEET_NAME || 'Response';
const OUTPUT = path.join(__dirname, '..', 'data.json');
const META = path.join(__dirname, '..', 'data.meta.json');

const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'PG2-Dashboard/1.0 (+GitHub Actions)',
        'Accept': 'text/csv,text/plain,*/*'
      },
      timeout: 20000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} untuk ${url}`));
      let buf = '';
      res.setEncoding('utf-8');
      res.on('data', c => buf += c);
      res.on('end', () => resolve(buf));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function parseCSV(text) {
  const rows = [];
  let cur = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i+1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i+1] === '\n') i++;
        cur.push(field);
        if (cur.some(x => x && x.trim() !== '')) rows.push(cur);
        cur = []; field = '';
      } else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); if (cur.some(x => x && x.trim() !== '')) rows.push(cur); }
  return rows;
}

function parseDateFlexible(s) {
  if (!s) return null;
  s = String(s).trim();
  if (!s) return null;
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  // m/d/yyyy atau d/m/yyyy
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    const a = parseInt(m[1],10), b = parseInt(m[2],10);
    const mo = a > 12 ? b-1 : a-1;
    const dy = a > 12 ? a : b;
    d = new Date(parseInt(m[3],10), mo, dy, parseInt(m[4]||'0',10), parseInt(m[5]||'0',10), parseInt(m[6]||'0',10));
    if (!isNaN(d.getTime())) return d;
  }
  const m2 = s.match(/(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (m2) {
    const a = parseInt(m2[1],10), b = parseInt(m2[2],10);
    let dy, mo;
    if (a > 12) { dy = a; mo = b-1; }
    else if (b > 12) { dy = b; mo = a-1; }
    else { dy = b; mo = a-1; }
    d = new Date(parseInt(m2[3],10), mo, dy, parseInt(m2[4]||'0',10), parseInt(m2[5]||'0',10));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function normalizeStatus(rawStatus, prNumber) {
  if (rawStatus) {
    const s = String(rawStatus).toLowerCase().trim();
    if (s.includes('selesai') || s.includes('done') || s.includes('fixed') || s.includes('beres')) return 'Selesai';
    if (s.includes('proses') || s.includes('progres') || s.includes('dikerjakan') || s.includes('on progress')) return 'Proses';
  }
  // Jika tidak ada status eksplisit: jika Nomor PR sudah terisi → dianggap Proses (pengadaan sparepart),
  // jika belum ada PR → Belum Ditangani
  if (prNumber && String(prNumber).trim()) return 'Proses';
  return 'Belum Ditangani';
}

function mapRows(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || '').trim());
  const h = {
    timestamp:-1, tanggalInspeksi:-1, lokasi:-1, divisi:-1,
    engineType:-1, engineCode:-1, irrType:-1, irrCode:-1,
    damageType:-1, damageNote:-1, sparepart:-1, prNumber:-1,
    qty:-1, status:-1, reporter:-1
  };
  headers.forEach((name, i) => {
    const k = String(name).toLowerCase().trim();
    if (k === 'timestamp') h.timestamp = i;
    else if (k.includes('tanggal inspeksi') || k.includes('tgl inspeksi')) h.tanggalInspeksi = i;
    else if (k.includes('lokasi') || (k === 'unit') || k.includes('blok') || k.includes('area')) h.lokasi = i;
    else if (k.includes('divisi') || k.includes('bagian')) h.divisi = i;
    else if (k.includes('jenis engine') || k.includes('tipe engine') || k.includes('engine type')) h.engineType = i;
    else if (k.includes('kode engine') || k.includes('engine code')) h.engineCode = i;
    else if (k.includes('jenis irrigator') || k.includes('tipe irrigator')) h.irrType = i;
    else if (k.includes('kode irrigator') || k.includes('irrigator code')) h.irrCode = i;
    else if (k.includes('irrigator') && h.irrType < 0 && h.irrCode < 0) h.irrCode = i;
    else if (k.includes('jenis kerusakan') || k === 'kerusakan' || k.includes('damage type')) h.damageType = i;
    else if (k.includes('keterangan kerusakan') || k.includes('detail kerusakan') || k.includes('deskripsi')) h.damageNote = i;
    else if (k.includes('sparepart') || k.includes('spare part') || k.includes('suku cadang')) h.sparepart = i;
    else if (k.includes('nomor pr') || k.includes('no pr') || k.includes('notifikasi') || k.includes('pr number')) h.prNumber = i;
    else if (k.includes('qty') || k.includes('jumlah') || k.includes('quantity')) h.qty = i;
    else if (k.includes('status') || k.includes('penanganan')) h.status = i;
    else if (k.includes('pelapor') || k.includes('nama pelapor') || k.includes('reporter') || k.includes('petugas') || k.includes('teknisi')) h.reporter = i;
  });

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = f => (h[f] >= 0 ? String(r[h[f]] || '').trim() : '');

    // Timestamp: pilih Tanggal Inspeksi jika ada & valid, selainnya Timestamp
    const tglInsp = parseDateFlexible(get('tanggalInspeksi'));
    const ts = tglInsp || parseDateFlexible(get('timestamp')) || new Date();

    const lokasi = get('lokasi');
    const irrType = get('irrType');
    const irrCode = get('irrCode');
    let irrigator = '-';
    if (irrType && irrCode) irrigator = `${irrType} – ${irrCode}`;
    else if (irrCode) irrigator = irrCode;
    else if (irrType) irrigator = irrType;

    let unit = lokasi;
    const engCode = get('engineCode');
    const engType = get('engineType');
    // Jika tidak ada lokasi, coba pakai engine code sebagai unit identifier
    if (!unit && engCode) unit = engCode;
    if (!unit) unit = 'Tidak tercatat';

    // Gabungkan engine type/code ke info jika ada
    const engineInfo = [engType, engCode].filter(Boolean).join(' – ');

    const dmgType = get('damageType');
    const dmgNote = get('damageNote');
    const damage = dmgNote ? `${dmgType}${dmgType && dmgNote ? ' — ' : ''}${dmgNote}` : dmgType;

    let sparepart = get('sparepart');
    if (!sparepart) sparepart = '-';
    // Normalisasi line break dalam sparepart (jika multi item)
    sparepart = sparepart.replace(/[\r\n]+/g, '; ').replace(/\s*;\s*/g, '; ');

    const pr = get('prNumber');
    const rawStatus = get('status');
    const status = normalizeStatus(rawStatus, pr);

    const qtyRaw = get('qty');
    const qtyMatch = qtyRaw.match(/\d+/);
    const qty = qtyMatch ? parseInt(qtyMatch[0],10) : 1;

    const reporter = get('reporter') || get('divisi') || '-';
    const divisi = get('divisi');

    // Skip row yang isinya kosong sama sekali
    if (!lokasi && !irrCode && !dmgType && !sparepart) continue;

    out.push({
      timestamp: ts.toISOString(),
      unit,
      irrigator,
      engine: engineInfo || null,
      damage: damage || '-',
      damageType: dmgType || '-',
      sparepart,
      qty,
      status,
      prNumber: pr || null,
      reporter,
      divisi: divisi || null,
      notes: dmgNote || ''
    });
  }
  return out.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
}

async function main() {
  console.log(`Fetching ${CSV_URL} ...`);
  let text;
  let ok = true;
  let err = null;
  try {
    text = await fetchText(CSV_URL);
    if (!text || text.length < 20) throw new Error('Response terlalu pendek');
    if (text.trim().toLowerCase().startsWith('<!doctype') || text.trim().toLowerCase().startsWith('<html')) {
      throw new Error('Menerima HTML (bukan CSV). Pastikan sharing spreadsheet: "Anyone with the link" -> Viewer.');
    }
  } catch (e) {
    ok = false;
    err = e.message;
    console.error('[warn] Fetch gagal:', e.message);
    if (fs.existsSync(OUTPUT)) {
      console.log('Data sebelumnya sudah ada di data.json, tidak menimpa.');
      const meta = fs.existsSync(META) ? JSON.parse(fs.readFileSync(META,'utf-8')) : {};
      meta.lastFetchError = err;
      meta.lastFetchAttempt = new Date().toISOString();
      meta.lastFetchSuccess = false;
      fs.writeFileSync(META, JSON.stringify(meta,null,2));
      return;
    }
    // Jika belum ada data.json sama sekali, tulis array kosong
    fs.writeFileSync(OUTPUT, '[]');
    fs.writeFileSync(META, JSON.stringify({ lastFetchSuccess:false, lastFetchError:err, lastFetchAttempt:new Date().toISOString(), recordCount:0 }, null, 2));
    console.log('Menulis data.json kosong karena fetch gagal dan belum ada file sebelumnya.');
    return;
  }

  const rows = parseCSV(text);
  console.log(`Parsed ${Math.max(0,rows.length-1)} data rows (${rows.length} rows termasuk header).`);
  const data = mapRows(rows);
  console.log(`Valid records: ${data.length}`);

  fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2));
  fs.writeFileSync(META, JSON.stringify({
    sheetId: SHEET_ID,
    sheetName: SHEET_NAME,
    lastFetchSuccess: ok,
    lastFetchAttempt: new Date().toISOString(),
    lastFetchError: ok ? null : err,
    recordCount: data.length,
    headers: rows.length ? rows[0] : []
  }, null, 2));
  console.log('OK -> data.json ditulis (' + data.length + ' records)');
}

main().catch(e => { console.error(e); process.exit(1); });
