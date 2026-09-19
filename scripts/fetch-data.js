/**
 * scripts/fetch-data.js
 *
 * Ambil data dari Google Spreadsheet (sheet "Response") via endpoint
 * CSV publik Google, parse, lalu tulis ke data.json di root repo.
 * Kolom sesuai header sheet aktual:
 *   Timestamp | Tanggal Inspeksi | Lokasi | DIvisi | Jenis Engine | Kode Engine |
 *   Jenis Irrigator | Kode Irrigator | Jenis Kerusakan | Keterangan Kerusakan |
 *   Spareparts Yang Dibutuhkan | Nomor PR / Notifikasi
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
      headers: { 'User-Agent': 'PG2-Dashboard/1.0 (+GitHub Actions)', 'Accept': 'text/csv,text/plain,*/*' },
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
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
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
  // Timestamp Google Sheets selalu format AS: MM/DD/YYYY HH:MM:SS (ada jam).
  // Tanggal Inspeksi dari Form (locale ID) selalu: DD/MM/YYYY (tanpa jam).
  // Deteksi dari ada/tidaknya ':' untuk membedakan keduanya secara andal.
  const hasTime = /\d{1,2}:\d{2}/.test(s);
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    let mo, dy;
    if (hasTime) { mo = parseInt(m[1],10)-1; dy = parseInt(m[2],10); }
    else         { dy = parseInt(m[1],10);   mo = parseInt(m[2],10)-1; }
    const d = new Date(parseInt(m[3],10), mo, dy, parseInt(m[4]||'0',10), parseInt(m[5]||'0',10), parseInt(m[6]||'0',10));
    if (!isNaN(d.getTime())) return d;
  }
  // Fallback ISO
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  // Fallback dd-mm-yyyy
  const m2 = s.match(/(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (m2) {
    d = new Date(parseInt(m2[3],10), parseInt(m2[2],10)-1, parseInt(m2[1],10), parseInt(m2[4]||'0',10), parseInt(m2[5]||'0',10));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function mapRows(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || '').trim());
  const hi = {
    timestamp:-1, tanggalInspeksi:-1, lokasi:-1, divisi:-1,
    engineType:-1, engineCode:-1, irrType:-1, irrCode:-1,
    damageType:-1, damageNote:-1, sparepart:-1, prNumber:-1
  };

  headers.forEach((name, i) => {
    const k = String(name).toLowerCase().trim();
    if (k === 'timestamp') hi.timestamp = i;
    else if (k.includes('tanggal inspeksi')) hi.tanggalInspeksi = i;
    else if (k.includes('lokasi')) hi.lokasi = i;
    else if (k.includes('divisi')) hi.divisi = i;
    else if (k.includes('jenis engine')) hi.engineType = i;
    else if (k.includes('kode engine')) hi.engineCode = i;
    else if (k.includes('jenis irrigator')) hi.irrType = i;
    else if (k.includes('kode irrigator')) hi.irrCode = i;
    else if (k.includes('jenis kerusakan') || k === 'kerusakan') hi.damageType = i;
    else if (k.includes('keterangan kerusakan') || k.includes('detail kerusakan')) hi.damageNote = i;
    else if (k.includes('sparepart') || k.includes('spare part')) hi.sparepart = i;
    else if (k.includes('nomor pr') || k.includes('notifikasi') || k.includes('pr')) hi.prNumber = i;
    // Fallback
    else if ((k.includes('unit') || k.includes('blok')) && hi.lokasi < 0) hi.lokasi = i;
    else if (k.includes('irrigator') && hi.irrCode < 0) hi.irrCode = i;
  });

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = f => (hi[f] >= 0 ? String(r[hi[f]] || '').trim() : '');

    const tglInsp = parseDateFlexible(get('tanggalInspeksi'));
    const tsRaw = parseDateFlexible(get('timestamp'));
    const ts = tglInsp || tsRaw || new Date();

    const lokasi = get('lokasi');
    const et = get('engineType');
    const ec = get('engineCode');
    const it = get('irrType');
    const ic = get('irrCode');
    const divisi = get('divisi');
    const dt = get('damageType');
    const dn = get('damageNote');
    let sp = get('sparepart');
    const pr = get('prNumber');

    const irrigator = (it && ic && it !== ic) ? `${it} – ${ic}` : (ic || it || '-');
    const unit = lokasi || ec || 'Tidak tercatat';
    const engine = [et, ec].filter(Boolean).join(' – ');
    const damage = dn ? `${dt}${dt && dn ? ' — ' : ''}${dn}` : (dt || '-');
    sp = sp ? sp.replace(/[\r\n]+/g, '; ').replace(/\s*;\s*/g, '; ') : '-';

    // Status: Nomor PR terisi → Proses; jika tidak → Belum Ditangani.
    // (Sheet tidak punya kolom status, ini heuristik yang paling masuk akal)
    const status = pr ? 'Proses' : 'Belum Ditangani';

    if (!lokasi && !ic && !dt && sp === '-') continue;

    out.push({
      timestamp: ts.toISOString(),
      tanggalInspeksi: ts.toISOString().slice(0,10),
      lokasi: lokasi || '-',
      divisi: divisi || '-',
      engineType: et || '-',
      engineCode: ec || '-',
      engine: engine || '-',
      irrType: it || '-',
      irrCode: ic || '-',
      irrigator,
      damageType: dt || '-',
      keterangan: dn || '',
      damage,
      sparepart: sp,
      prNumber: pr || null,
      status,
      unit: lokasi || '-',
      __row: i + 2 // baris spreadsheet (header=1, data mulai baris 2)
    });
  }
  return out.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
}

async function main() {
  console.log(`Fetching ${CSV_URL} ...`);
  let text, ok = true, err = null;
  try {
    text = await fetchText(CSV_URL);
    if (!text || text.length < 20) throw new Error('Response terlalu pendek');
    if (text.trim().toLowerCase().startsWith('<!doctype') || text.trim().toLowerCase().startsWith('<html'))
      throw new Error('Menerima HTML (bukan CSV). Pastikan sharing spreadsheet: "Anyone with the link" -> Viewer.');
  } catch (e) {
    ok = false; err = e.message;
    console.error('[warn] Fetch gagal:', e.message);
    if (fs.existsSync(OUTPUT)) {
      console.log('Data sebelumnya sudah ada, tidak menimpa.');
      const meta = fs.existsSync(META) ? JSON.parse(fs.readFileSync(META,'utf-8')) : {};
      meta.lastFetchError = err; meta.lastFetchAttempt = new Date().toISOString(); meta.lastFetchSuccess = false;
      fs.writeFileSync(META, JSON.stringify(meta, null, 2));
      return;
    }
    fs.writeFileSync(OUTPUT, '[]');
    fs.writeFileSync(META, JSON.stringify({ lastFetchSuccess:false, lastFetchError:err, lastFetchAttempt:new Date().toISOString(), recordCount:0 }, null, 2));
    return;
  }

  const rows = parseCSV(text);
  console.log(`Parsed ${Math.max(0, rows.length-1)} data rows.`);
  const data = mapRows(rows);
  console.log(`Valid records: ${data.length}`);

  fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2));
  fs.writeFileSync(META, JSON.stringify({
    sheetId: SHEET_ID, sheetName: SHEET_NAME,
    lastFetchSuccess: ok, lastFetchAttempt: new Date().toISOString(),
    lastFetchError: ok ? null : err, recordCount: data.length,
    headers: rows.length ? rows[0] : []
  }, null, 2));
  console.log('OK -> data.json ditulis (' + data.length + ' records)');
}

main().catch(e => { console.error(e); process.exit(1); });
