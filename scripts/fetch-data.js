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
// Zona waktu spreadsheet (WIB). Ubah bila sheet dipindah ke zona lain.
const SHEET_TZ_OFFSET = process.env.SHEET_TZ_OFFSET || '+07:00';
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

  // Spreadsheet ini pakai locale ID (Indonesia), jadi SEMUA tanggal yang keluar
  // dari Google Sheets — baik kolom Timestamp otomatis maupun Tanggal Inspeksi
  // dari Form — menggunakan format DD/MM/YYYY (dengan HH:MM:SS opsional).
  // Kita TIDAK menebak dd/mm vs mm/dd dari ada/tidaknya jam, karena itu
  // salah (Google bisa kirim timestamp dengan jam tapi dalam locale ID).
  // Heuristik: jika field pertama > 12 → itu pasti hari → DD/MM.
  // Jika tidak jelas (keduanya ≤ 12), kita pilih DD/MM sesuai locale sheet
  // agar konsisten dengan data yang selama ini benar (tgl 1-12).
  function tryDMY(dd, mm, yyyy, hh, mi, ss) {
    dd = parseInt(dd,10); mm = parseInt(mm,10);
    if (mm < 1 || mm > 12) return null;
    if (dd < 1 || dd > 31) return null;
    const d = new Date(yyyy, mm-1, dd, parseInt(hh||'0',10), parseInt(mi||'0',10), parseInt(ss||'0',10));
    // Validasi: tanggal yang di-set harus cocok (Date overflow protection)
    if (d.getFullYear() !== +yyyy || d.getMonth() !== mm-1 || d.getDate() !== dd) return null;
    return d;
  }
  function tryMDY(mm, dd, yyyy, hh, mi, ss) {
    mm = parseInt(mm,10); dd = parseInt(dd,10);
    if (mm < 1 || mm > 12) return null;
    if (dd < 1 || dd > 31) return null;
    const d = new Date(yyyy, mm-1, dd, parseInt(hh||'0',10), parseInt(mi||'0',10), parseInt(ss||'0',10));
    if (d.getFullYear() !== +yyyy || d.getMonth() !== mm-1 || d.getDate() !== dd) return null;
    return d;
  }

  // dd/mm/yyyy dengan jam opsional
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (m) {
    const a = parseInt(m[1],10), b = parseInt(m[2],10);
    let d = null;
    if (a > 12) {
      // a pasti hari → DD/MM
      d = tryDMY(m[1], m[2], m[3], m[4], m[5], m[6]);
    } else if (b > 12) {
      // b pasti hari → MM/DD
      d = tryMDY(m[1], m[2], m[3], m[4], m[5], m[6]);
    } else {
      // Ambigu (keduanya 1-12): locale sheet Indonesia → DD/MM
      d = tryDMY(m[1], m[2], m[3], m[4], m[5], m[6]);
    }
    if (d) return d;
  }
  // ISO
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  // dd-mm-yyyy
  const m2 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?$/);
  if (m2) {
    d = tryDMY(m2[1], m2[2], m2[3], m2[4], m2[5]);
    if (d) return d;
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
    // Tanggal "resmi" untuk laporan: Tanggal Inspeksi (yang dipilih user) jika
    // ada; jika kosong (user lupa isi), pakai tanggal dari Timestamp submit.
    // Jam untuk pengurutan: selalu pakai jam Timestamp jika tersedia, agar
    // laporan pada hari yang sama terurut sesuai waktu kirim.
    const tgl = tglInsp || tsRaw;
    if (!tgl) {
      console.warn(`[warn] Baris ${i+2}: tanggal tidak valid (timestamp="${get('timestamp')}", tglInsp="${get('tanggalInspeksi')}") — dilewati.`);
      continue;
    }
    const tsForTime = tsRaw || tgl;
    // PENTING: jam di spreadsheet adalah jam WIB (UTC+7). Runner GitHub Actions
    // berjalan di UTC, jadi JANGAN pakai new Date(...).toISOString() — itu akan
    // memberi label "Z" (UTC) pada jam WIB sehingga di browser user tampil
    // bergeser +7 jam (23:03 WIB jadi 06:03 esok hari → masuk hari yang salah
    // di filter harian & grafik jam). Tulis offset +07:00 secara eksplisit.
    const p2 = n => String(n).padStart(2,'0');
    const isoDate = `${tgl.getFullYear()}-${p2(tgl.getMonth()+1)}-${p2(tgl.getDate())}`;
    const mergedTsIso = `${isoDate}T${p2(tsForTime.getHours())}:${p2(tsForTime.getMinutes())}:${p2(tsForTime.getSeconds())}${SHEET_TZ_OFFSET}`;
    const mergedTs = new Date(mergedTsIso);

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
    const engine = [et, ec].filter(Boolean).join(' – ');
    const damage = dn ? `${dt}${dt && dn ? ' — ' : ''}${dn}` : (dt || '-');
    sp = sp ? sp.replace(/[\r\n]+/g, '; ').replace(/\s*;\s*/g, '; ') : '-';

    // Status: Nomor PR terisi → Proses; jika tidak → Belum Ditangani.
    // (Sheet tidak punya kolom status, ini heuristik yang paling masuk akal)
    const status = pr ? 'Proses' : 'Belum Ditangani';

    if (!lokasi && !ic && !dt && sp === '-') continue;

    out.push({
      timestamp: mergedTsIso,
      tanggalInspeksi: isoDate,
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
