// ======================================================
// PG2 Irrigation Dashboard - Application
// Kolom sesuai sheet Response:
// Timestamp | Tanggal Inspeksi | Lokasi | Divisi |
// Jenis Engine | Kode Engine | Jenis Irrigator | Kode Irrigator |
// Jenis Kerusakan | Keterangan Kerusakan |
// Spareparts Yang Dibutuhkan | Nomor PR / Notifikasi
// ======================================================
const SHEET_ID = '1TZiQfgiVXmXCLorD1BePuH2wEDnUcy_zWTivQSE3fUk';
const SHEET_NAME = 'Response';
const DATA_URL = './data.json';

let rawData = [];
let filteredData = [];

// State filter
const state = {
    tab: 'overview',
    period: 'all',
    dateFrom: '',
    dateTo: '',
    selectedDate: null,
    divisi: [],
    status: [],
    lokasi: [],
    search: '',
    page: 1,
    pageSize: 15,
    sortField: 'timestamp',
    sortDir: 'desc',
    calMonth: (() => { const d = new Date(); d.setDate(1); return d; })()
};

let charts = {};
let isFirstLoad = true;

// Palette
const CC = ['#2563eb','#ef4444','#f59e0b','#10b981','#8b5cf6','#ec4899','#06b6d4','#f97316','#84cc16','#6366f1'];
const DIV_COLORS = { 'PG2':'#2563eb','FM4':'#f59e0b','OP2':'#10b981' };
const DIV_CLASS = { 'PG2':'pg2','FM4':'fm4','OP2':'op2' };
// Palet khusus untuk jenis engine/irigator (muncul di card header)
const ENG_COLORS = { 'DEM':'#f97316','DEC':'#dc2626','SPC':'#8b5cf6','PMP':'#06b6d4' };
const IRR_COLORS = { 'BTI':'#ec4899','RKD':'#06b6d4','KPP':'#84cc16','SPR':'#6366f1' };
const GRID_COLOR='rgba(148,163,184,0.12)';
const TICK_COLOR='#64748b';

// ---------- CSV Parser ----------
function parseCSV(text) {
    const rows = []; let cur = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQ) {
            if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; }
            else field += c;
        } else {
            if (c === '"') inQ = true;
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
function parseDate(s) {
    if (!s) return null;
    s = String(s).trim(); if (!s) return null;

    // Spreadsheet ini locale ID → SEMUA format slash adalah DD/MM/YYYY
    // (dengan jam opsional). Jangan tebak MM/DD dari ada/tidaknya jam —
    // itu salah untuk locale ID dan bikin tanggal seperti 19/09 loncat ke 2027.
    function tryDMY(dd,mm,yyyy,hh,mi,ss){
        dd=+dd; mm=+mm;
        if(mm<1||mm>12||dd<1||dd>31) return null;
        const d=new Date(yyyy, mm-1, dd, +(hh||0), +(mi||0), +(ss||0));
        if(d.getFullYear()!==+yyyy||d.getMonth()!==mm-1||d.getDate()!==dd) return null;
        return d;
    }
    function tryMDY(mm,dd,yyyy,hh,mi,ss){
        mm=+mm; dd=+dd;
        if(mm<1||mm>12||dd<1||dd>31) return null;
        const d=new Date(yyyy, mm-1, dd, +(hh||0), +(mi||0), +(ss||0));
        if(d.getFullYear()!==+yyyy||d.getMonth()!==mm-1||d.getDate()!==dd) return null;
        return d;
    }

    // dd/mm/yyyy dengan jam opsional
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
    if (m) {
        const a=+m[1], b=+m[2];
        let d = null;
        if (a > 12)      d = tryDMY(m[1],m[2],m[3],m[4],m[5],m[6]);
        else if (b > 12) d = tryMDY(m[1],m[2],m[3],m[4],m[5],m[6]);
        else             d = tryDMY(m[1],m[2],m[3],m[4],m[5],m[6]); // ambigu → DD/MM (locale ID)
        if (d) return d;
    }
    // ISO yyyy-mm-dd tanpa jam (tanggalInspeksi di data.json) → parse sebagai
    // TANGGAL LOKAL, bukan UTC. new Date('2026-09-19') = 00:00 UTC yang di zona
    // barat UTC menjadi 18 Sep → off-by-one. Pakai komponen lokal jam 12:00.
    const mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (mIso) {
        const d0 = new Date(+mIso[1], +mIso[2]-1, +mIso[3], 12, 0, 0);
        return isNaN(d0.getTime()) ? null : d0;
    }
    // ISO lengkap dengan jam/zona (timestamp di data.json) → instan absolut, aman.
    let d = new Date(s);
    if (!isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}T/.test(s)) return d;
    // dd-mm-yyyy
    const m2 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?$/);
    if (m2) {
        d = tryDMY(m2[1],m2[2],m2[3],m2[4],m2[5]);
        if (d) return d;
    }
    return null;
}
// Format tanggal ke ISO tanpa terpengaruh timezone (pakai komponen lokal)
function localIsoDate(d){
    const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
}
function normalizeFromCSV(rows) {
    if (!rows.length) return [];
    const headers = rows[0].map(h => String(h||'').trim());
    const hi = {ts:-1,tglInsp:-1,lok:-1,div:-1,eT:-1,eC:-1,iT:-1,iC:-1,dT:-1,dN:-1,sp:-1,pr:-1};
    headers.forEach((name,i) => {
        const k = String(name).toLowerCase().trim();
        if (k === 'timestamp') hi.ts = i;
        else if (k.includes('tanggal inspeksi')) hi.tglInsp = i;
        else if (k.includes('lokasi')) hi.lok = i;
        else if (k.includes('divisi')) hi.div = i;
        else if (k.includes('jenis engine')) hi.eT = i;
        else if (k.includes('kode engine')) hi.eC = i;
        else if (k.includes('jenis irrigator')) hi.iT = i;
        else if (k.includes('kode irrigator')) hi.iC = i;
        else if (k.includes('jenis kerusakan') || k === 'kerusakan') hi.dT = i;
        else if (k.includes('keterangan kerusakan') || k.includes('detail')) hi.dN = i;
        else if (k.includes('sparepart')) hi.sp = i;
        else if (k.includes('pr') || k.includes('notifikasi')) hi.pr = i;
    });
    const out = [];
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const get = f => hi[f] >= 0 ? String(r[hi[f]]||'').trim() : '';
        // Tgl inspeksi lebih dulu (yang dipilih user); fallback ke Timestamp submit.
        // Jangan pernah new Date() — nanti bikin record "hari ini" palsu.
        const tgl = parseDate(get('tglInsp')) || parseDate(get('ts'));
        if (!tgl) continue;
        const lok = get('lok'), et = get('eT'), ec = get('eC'), it = get('iT'), ic = get('iC'), div = get('div');
        const dt = get('dT'), dn = get('dN'), sp = get('sp'), pr = get('pr');
        const irrigator = (it && ic && it !== ic) ? `${it} – ${ic}` : (ic || it || '-');
        const engine = [et,ec].filter(Boolean).join(' – ');
        const damage = dn ? (dt ? `${dt} — ${dn}` : dn) : (dt || '-');
        const spNorm = sp ? sp.replace(/[\r\n]+/g,'; ').replace(/\s*;\s*/g,'; ') : '-';
        const status = pr ? 'Proses' : 'Belum Ditangani';
        if (!lok && !ic && !dt && spNorm === '-') continue;
        // Normalisasi timestamp: gunakan komponen TANGGAL dari tgl (hasil parseDate)
        // tapi jam dari Timestamp asli jika tersedia, untuk sorting yang akurat.
        // tanggalInspeksi pakai localIsoDate agar tidak off-by-one akibat UTC.
        const tsDate = parseDate(get('ts'));
        const outTs = new Date(tgl.getFullYear(), tgl.getMonth(), tgl.getDate(),
                               tsDate ? tsDate.getHours()   : 12,
                               tsDate ? tsDate.getMinutes() : 0,
                               tsDate ? tsDate.getSeconds() : 0);
        out.push({
            timestamp: outTs.toISOString(),
            tanggalInspeksi: localIsoDate(tgl),
            lokasi: lok || '-', divisi: div || '-',
            engineType: et || '-', engineCode: ec || '-', engine: engine || '-',
            irrType: it || '-', irrCode: ic || '-', irrigator,
            damageType: dt || '-', keterangan: dn || '', damage,
            sparepart: spNorm, prNumber: pr || null, status, unit: lok || '-',
            __row: i+2 // baris spreadsheet (header=1, data mulai 2)
        });
    }
    return out.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function generateDemo() {
    const lok=['104I','144D1','185B','118F','102C','137A','118H','102G','169A','172F'];
    const divs=['PG2','FM4','OP2'];
    const ets=['DEM','DEC','SPC'], its=['BTI','RKD','KPP'];
    const dmg=[['Pompa Sumur Bor',['Air kecil','Patah as','Karung masuk']],['Turbin',['Bocor seal','As getar']],['Blok Mesin',['Bocor oli','Baut lepas']],['Pipa PE',['Bocor sambungan','Pecah']],['Prodo',['Rilis kopling rusak','Macet']]];
    const sp=['Seal Mechanical','Bearing 6205','Pipa PVC','O-Ring','Packing Gasket','Belt Ebara','Selang Oli','Seal Crankshaft'];
    const data=[]; const now=new Date();
    for (let i=0;i<60;i++) {
        const d=new Date(now);
        d.setDate(d.getDate()-Math.floor(Math.random()*60));
        d.setHours(0,0,0,0);
        const hasPr = Math.random()>0.4;
        const dc = dmg[Math.floor(Math.random()*dmg.length)];
        const note = dc[1][Math.floor(Math.random()*dc[1].length)];
        data.push({
            timestamp:d.toISOString(),tanggalInspeksi:localIsoDate(d),
            lokasi:lok[Math.floor(Math.random()*lok.length)],divisi:divs[Math.floor(Math.random()*divs.length)],
            engineType:ets[Math.floor(Math.random()*ets.length)],engineCode:String(Math.floor(Math.random()*200)+100).padStart(4,'0'),
            engine:'',irrType:its[Math.floor(Math.random()*its.length)],irrCode:String(Math.floor(Math.random()*200)+1).padStart(4,'0'),
            irrigator:'',damageType:dc[0],keterangan:note,damage:`${dc[0]} — ${note}`,
            sparepart:sp[Math.floor(Math.random()*sp.length)],
            prNumber:hasPr?String(Math.floor(Math.random()*9000000)+1000000):null,
            status:hasPr?'Proses':'Belum Ditangani',unit:''
        });
        const last=data[data.length-1];
        last.engine=`${last.engineType} – ${last.engineCode}`;
        last.irrigator=`${last.irrType} – ${last.irrCode}`;
        last.unit=last.lokasi;
    }
    return data.sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
}

async function fetchLiveCSV() {
    const url=`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}&t=${Date.now()}`;
    try {
        const ctrl=new AbortController(); const tid=setTimeout(()=>ctrl.abort(),12000);
        const res=await fetch(url,{signal:ctrl.signal,cache:'no-store'});
        clearTimeout(tid);
        if(!res.ok) return null;
        const txt=await res.text();
        if(txt.length<50||txt.trim().toLowerCase().startsWith('<!')) return null;
        return normalizeFromCSV(parseCSV(txt));
    } catch(e) { return null; }
}

// Normalisasi record dari data.json (cache GitHub) agar identik dengan hasil
// normalizeFromCSV (jalur live). Semua derived field dibangun ulang di sini.
function normalizeFromJson(json) {
    return json.map((r,i) => {
        const et = r.engineType||'-', ec = r.engineCode||'-';
        const it = r.irrType||'-', ic = r.irrCode||'-';
        const dt = r.damageType||'-', dn = r.keterangan||r.notes||'';
        const sp = (r.sparepart||'-');
        const pr = r.prNumber||null;
        const tglObj = parseDate(r.tanggalInspeksi) || parseDate(r.timestamp);
        if(!tglObj) return null; // skip record rusak
        const tsObj = parseDate(r.timestamp) || tglObj;
        const mergedTs = new Date(tglObj.getFullYear(), tglObj.getMonth(), tglObj.getDate(),
                                  tsObj.getHours(), tsObj.getMinutes(), tsObj.getSeconds());
        return {
            ...r,
            lokasi: r.lokasi || r.unit || '-',
            divisi: r.divisi || '-',
            engineType:et, engineCode:ec,
            engine: (et&&et!=='-'&&ec&&ec!=='-')?`${et} – ${ec}`:(r.engine||'-'),
            irrType:it, irrCode:ic,
            irrigator: (it&&it!=='-'&&ic&&ic!=='-'&&it!==ic)?`${it} – ${ic}`:(r.irrigator||'-'),
            damageType:dt, keterangan:dn,
            damage: dn?(dt?`${dt} — ${dn}`:dn):(dt||'-'),
            sparepart: sp,
            prNumber: pr,
            status: pr?'Proses':'Belum Ditangani',
            unit: r.lokasi || r.unit || '-',
            timestamp: mergedTs.toISOString(),
            tanggalInspeksi: localIsoDate(tglObj),
            __row: typeof r.__row==='number'?r.__row:(i+2)
        };
    }).filter(Boolean).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
}

async function fetchGithubCache() {
    try {
        const ctrl=new AbortController(); const tid=setTimeout(()=>ctrl.abort(),15000);
        const res=await fetch(DATA_URL+'?t='+Date.now(),{cache:'no-store',signal:ctrl.signal});
        clearTimeout(tid);
        if(!res.ok) return null;
        const json=await res.json();
        if(!Array.isArray(json)) return null;
        return normalizeFromJson(json);
    } catch(e) { return null; }
}

// Penjaga race-condition: hanya hasil dari request TERAKHIR yang boleh dirender.
let __refreshSeq = 0;
let __refreshInFlight = null;

/**
 * Muat data. Urutan sumber (selalu sama, baik saat load pertama, reload,
 * auto-refresh, maupun klik tombol Refresh):
 *   1. Google Sheets langsung (CSV publik) — data paling baru, real-time.
 *   2. data.json hasil sync GitHub Actions — cadangan jika Sheets tidak bisa
 *      diakses (offline / diblokir / sharing berubah).
 *   3. Jika keduanya gagal → PERTAHANKAN data yang sedang tampil (jangan
 *      dikosongkan), tampilkan peringatan.
 * Dulu: load/reload hanya baca data.json (bisa tertinggal berjam-jam karena
 * cron GitHub tidak andal) sementara tombol Refresh baca Sheets → data
 * "maju-mundur" tiap kali reload. Sekarang keduanya konsisten.
 */
async function refreshData(forceLive=false, opts={}) {
    if (__refreshInFlight && !forceLive) return __refreshInFlight; // sudah ada yang jalan
    const seq = ++__refreshSeq;
    const silent = !!opts.silent;
    const icon=document.getElementById('refreshIcon');
    if(icon) icon.classList.add('spin');
    const ls = document.getElementById('loadingState');
    const es = document.getElementById('emptyState');
    // Loading skeleton hanya saat belum ada data sama sekali (first load).
    // Saat refresh berikutnya, data lama tetap tampil sampai data baru siap.
    if (isFirstLoad) {
        if(ls) ls.classList.remove('hidden');
        if(es) es.classList.add('hidden');
    }

    const run = (async () => {
        let data=null, source='empty', note='';
        // 1) Live Sheets
        data = await fetchLiveCSV();
        if (data && data.length) source='live-sheet';
        // 2) Cadangan: data.json (cache GitHub)
        if (!data || !data.length) {
            const cached = await fetchGithubCache();
            if (cached && cached.length) { data = cached; source='github-cache'; }
            else if (cached && !cached.length && data && !data.length) { data = []; source='empty'; }
        }
        if (seq !== __refreshSeq) return; // sudah ada request yang lebih baru → abaikan

        if (!data) {
            // Keduanya gagal total (mis. offline)
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('demo') === '1') {
                data = generateDemo(); source = 'demo';
                showToast('Mode demo aktif — menampilkan data contoh.','warning');
            } else if (rawData.length) {
                // Pertahankan data lama, jangan kosongkan tampilan.
                source = 'stale'; note = 'gagal sinkron, menampilkan data terakhir';
                if(!silent) showToast('Tidak bisa mengambil data terbaru (periksa koneksi). Menampilkan data terakhir yang berhasil dimuat.','warning');
                data = rawData;
            } else {
                data = []; source = 'error';
                showToast('Gagal memuat data dari Google Sheets maupun cache GitHub. Periksa koneksi lalu klik Refresh.','error');
            }
        }

        rawData = data;
        const syncEl=document.getElementById('syncTime');
        if(syncEl && source!=='stale' && source!=='error')
            syncEl.textContent = new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
        const srcLabel = {
            'live-sheet':'Live (Sheets)','github-cache':'Sync GitHub (cadangan)',
            'demo':'Data Demo','empty':'Tidak ada data','stale':'Offline','error':'Gagal memuat'
        }[source];
        const dsEl=document.getElementById('dataSource');
        if(dsEl) dsEl.textContent = `${srcLabel} · ${data.length} record${note?' · '+note:''}`;
        const dot=document.getElementById('dataSourceDot');
        if(dot) dot.className = 'w-2 h-2 rounded-full pulse-dot '+(
            source==='live-sheet'?'bg-green-500':
            source==='github-cache'?'bg-blue-500':
            source==='demo'?'bg-amber-500':
            (source==='stale'||source==='error')?'bg-red-500':'bg-slate-400');

        populateMultiSelect('divisiFilter', [...new Set(rawData.map(d=>d.divisi).filter(v=>v&&v!=='-'))].sort(), state.divisi);
        populateMultiSelect('lokasiFilter', [...new Set(rawData.map(d=>d.lokasi).filter(v=>v&&v!=='-'))].sort(), state.lokasi);
        populateMultiSelect('statusFilter', ['Belum Ditangani','Proses'], state.status);

        state.divisi = state.divisi.filter(v => rawData.some(d => d.divisi === v));
        state.lokasi = state.lokasi.filter(v => rawData.some(d => d.lokasi === v));
        state.status = state.status.filter(v => ['Belum Ditangani','Proses'].includes(v));

        // Jangan reset halaman saat auto-refresh diam-diam (user mungkin sedang di halaman 3)
        if (!silent) state.page = 1;
        applyFilters();
        isFirstLoad = false;
    })();

    __refreshInFlight = run;
    try { await run; }
    catch(e) {
        console.error('refreshData error:', e);
        if (seq === __refreshSeq) {
            const dsEl=document.getElementById('dataSource');
            if(dsEl) dsEl.textContent = 'Gagal memuat · '+(rawData.length||0)+' record';
            if (isFirstLoad) { rawData = rawData||[]; applyFilters(); isFirstLoad=false; }
            showToast('Terjadi kesalahan saat memuat data: '+(e && e.message ? e.message : e),'error');
        }
    }
    finally {
        if (seq === __refreshSeq) {
            if(icon) icon.classList.remove('spin');
            if(ls) ls.classList.add('hidden');
            __refreshInFlight = null;
        }
    }
}

// ---------- Date Utils ----------
function startOfDay(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate());}
function startOfWeek(d){const x=startOfDay(d);x.setDate(x.getDate()-((x.getDay()+6)%7));return x;}
function startOfMonth(d){return new Date(d.getFullYear(),d.getMonth(),1);}
function isoDate(d){const x=new Date(d);x.setHours(0,0,0,0);return localIsoDate(x);}
function fmtDate(d){return new Date(d).toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric',weekday:'long'});}
function fmtDateShort(d){return new Date(d).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'});}
function dateRangeDays() {
    if(!state.dateFrom||!state.dateTo) return 0;
    return Math.round((new Date(state.dateTo)-new Date(state.dateFrom))/86400000)+1;
}

// ---------- Multi-select ----------
function populateMultiSelect(id, options, selected) {
    const wrap = document.getElementById(id);
    if(!wrap)return;
    const validSelected = selected.filter(s => options.includes(s));
    const ph = wrap.dataset.ph || 'Semua';
    const selectedText = validSelected.length === 0 ? ph
        : (validSelected.length === options.length && options.length>0 ? `Semua (${options.length})`
        : validSelected.length <= 2 ? validSelected.join(', ') : `${validSelected.length} terpilih`);
    const btn = wrap.querySelector('.ms-btn-text');
    if(btn) btn.textContent = selectedText;
    const menu = wrap.querySelector('.ms-menu');
    const allCheck = menu.querySelector('.ms-opt-all .ms-check');
    const allChecked = validSelected.length === options.length && options.length > 0;
    allCheck.innerHTML = allChecked ? '<i class="fas fa-check"></i>' : '';
    allCheck.classList.toggle('on', allChecked);
    menu.querySelector('.ms-opt-all').dataset.checked = allChecked ? '1' : '0';
    const list = menu.querySelector('.ms-list');
    list.innerHTML = options.map(opt => {
        const checked = validSelected.includes(opt);
        return `<label class="ms-opt flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer rounded" data-value="${opt}">
            <span class="ms-check ${checked?'on':''}">${checked?'<i class="fas fa-check"></i>':''}</span>
            <span class="text-slate-700">${opt}</span>
        </label>`;
    }).join('');
}
function msToggleAll(btn) {
    const wrap = btn.closest('.ms-wrap');
    const options = [...wrap.querySelectorAll('.ms-list .ms-opt')].map(o => o.dataset.value);
    const isAll = btn.dataset.checked === '1';
    const stateKey = wrap.dataset.stateKey;
    state[stateKey] = isAll ? [] : [...options];
    populateMultiSelect(wrap.id, options, state[stateKey]);
    state.page = 1;
    applyFilters();
}
function msToggleOption(label) {
    const wrap = label.closest('.ms-wrap');
    const val = label.dataset.value;
    const stateKey = wrap.dataset.stateKey;
    const idx = state[stateKey].indexOf(val);
    if (idx >= 0) state[stateKey].splice(idx,1);
    else state[stateKey].push(val);
    const options = [...wrap.querySelectorAll('.ms-list .ms-opt')].map(o => o.dataset.value);
    populateMultiSelect(wrap.id, options, state[stateKey]);
    state.page = 1;
    applyFilters();
}
document.addEventListener('click', (e) => {
    if (!e.target.closest('.ms-wrap')) {
        document.querySelectorAll('.ms-wrap').forEach(w => w.classList.remove('open'));
    }
});

// ---------- Tabs ----------
function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-'+tab));
    // Render ulang chart yang sekarang visible (butuh layout karena Chart.js butuh container visible)
    requestAnimationFrame(() => renderCharts());
    if(tab === 'data') renderTable();
    window.scrollTo({top:0,behavior:'smooth'});
}

// ---------- Period Filter ----------
function setPeriod(p) {
    state.period = p;
    state.page = 1;
    state.selectedDate = null;
    state.dateFrom = ''; state.dateTo = '';
    const df = document.getElementById('dateFrom'); if(df) df.value='';
    const dt = document.getElementById('dateTo'); if(dt) dt.value='';
    const bd = document.getElementById('selectedDateBadge'); if(bd) bd.classList.add('hidden');
    document.querySelectorAll('.filter-btn').forEach(b => {
        if (b.dataset.filter === p) { b.classList.add('active'); b.classList.remove('text-slate-600'); }
        else { b.classList.remove('active'); b.classList.add('text-slate-600'); }
    });
    applyFilters();
}
function getPeriodRange() {
    const now = new Date();
    if (state.period === 'daily') return { from: startOfDay(now), to: now };
    if (state.period === 'weekly') return { from: startOfWeek(now), to: now };
    if (state.period === 'monthly') return { from: startOfMonth(now), to: now };
    return { from: new Date(1970,0,1), to: now };
}
function applyCustomDate() {
    const cf = document.getElementById('dateFrom').value;
    const ct = document.getElementById('dateTo').value;
    if (cf && ct) {
        state.period = 'custom';
        state.dateFrom = cf;
        state.dateTo = ct;
        state.page = 1;
        state.selectedDate = null;
        document.getElementById('selectedDateBadge').classList.add('hidden');
        document.querySelectorAll('.filter-btn').forEach(b => { b.classList.remove('active'); b.classList.add('text-slate-600'); });
        applyFilters();
    }
}
function applyFilters() {
    let from, to;
    let periodLabel = '';
    const now = new Date();
    if (state.selectedDate) {
        from = new Date(state.selectedDate+'T00:00:00');
        to = new Date(state.selectedDate+'T23:59:59');
        periodLabel = fmtDate(state.selectedDate);
    } else if (state.period === 'custom' && state.dateFrom && state.dateTo) {
        from = new Date(state.dateFrom+'T00:00:00');
        to = new Date(state.dateTo+'T23:59:59');
        periodLabel = `${new Date(state.dateFrom).toLocaleDateString('id-ID')} – ${new Date(state.dateTo).toLocaleDateString('id-ID')}`;
    } else {
        const r = getPeriodRange();
        from = r.from; to = r.to;
        periodLabel = {
            'daily':'Hari ini ('+now.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})+')',
            'weekly':'Minggu ini',
            'monthly':now.toLocaleDateString('id-ID',{month:'long',year:'numeric'}),
            'all':'Semua data'
        }[state.period];
    }

    const q = (state.search || (document.getElementById('searchInput')&&document.getElementById('searchInput').value) || '').toLowerCase().trim();

    filteredData = rawData.filter(d => {
        const t = new Date(d.timestamp);
        if (t < from || t > to) return false;
        if (state.divisi.length && !state.divisi.includes(d.divisi)) return false;
        if (state.lokasi.length && !state.lokasi.includes(d.lokasi)) return false;
        if (state.status.length && !state.status.includes(d.status)) return false;
        if (q) {
            // Blob utama (untuk pencarian dengan spasi & tanda baca)
            const blob = `${d.lokasi} ${d.divisi} ${d.engine} ${d.engineCode} ${d.engineType} ${d.irrigator} ${d.irrCode} ${d.irrType} ${d.damageType} ${d.keterangan} ${d.sparepart} ${d.prNumber||''} ${d.status}`.toLowerCase();
            // Blob "padat" (tanpa spasi/tanda baca) agar "BTI0032", "BTI 0032", "BTI-0032", "SPC 0127", "DEC 0033" semuanya ketemu
            const blobFlat = blob.replace(/[^a-z0-9]/g,'');
            const qFlat = q.replace(/[^a-z0-9]/g,'');
            if (!blob.includes(q) && !(qFlat && blobFlat.includes(qFlat))) return false;
        }
        return true;
    });

    const apt = document.getElementById('activePeriodText'); if(apt) apt.textContent = periodLabel;
    const badge = document.getElementById('selectedDateBadge');
    if (badge) {
        if (state.selectedDate) {
            badge.classList.remove('hidden');
            document.getElementById('selectedDateText').textContent = fmtDate(state.selectedDate);
        } else badge.classList.add('hidden');
    }

    renderActiveChips();
    updateStats();
    renderCharts();
    renderOverview();
    renderDamageTab();
    renderDivisiTab();
    renderEngineTab();
    renderIrrTab();
    renderSeverityTab();
    renderCalendar();
    renderCalDayDetail();
    renderTable();
    updateTabBadges();
}

function renderActiveChips() {
    const chips = [];
    state.divisi.forEach(v => chips.push({label:`Div: ${v}`, clear:()=>{state.divisi=state.divisi.filter(x=>x!==v);repop('divisiFilter','divisi');}}));
    state.lokasi.forEach(v => chips.push({label:`Lok: ${v}`, clear:()=>{state.lokasi=state.lokasi.filter(x=>x!==v);repop('lokasiFilter','lokasi');}}));
    state.status.forEach(v => chips.push({label:`Status: ${v}`, clear:()=>{state.status=state.status.filter(x=>x!==v);repop('statusFilter','status');}}));
    if (state.selectedDate) chips.push({label:`Tgl: ${fmtDate(state.selectedDate)}`, clear:()=>clearSelectedDate()});
    else if (state.period==='custom') chips.push({label:'Custom date', clear:()=>{state.period='all';state.dateFrom='';state.dateTo='';const df=document.getElementById('dateFrom');if(df)df.value='';const dt=document.getElementById('dateTo');if(dt)dt.value='';setPeriodUI('all');applyFilters();}});

    const container = document.getElementById('activeFilters');
    if (!container) return;
    if (!chips.length) { container.innerHTML = ''; return; }
    container.innerHTML = chips.map((c,i)=>
        `<span class="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full">
            ${c.label}
            <button onclick="window.__chipAction(${i})" class="hover:text-blue-900"><i class="fas fa-times text-[9px]"></i></button>
        </span>`
    ).join('') + `<button onclick="clearAllFilters()" class="text-xs text-slate-500 hover:text-red-600 font-medium">Reset semua</button>`;
    window.__chipActions = chips.map(c=>c.clear);
    window.__chipAction = i => { window.__chipActions[i](); applyFilters(); };
}
function repop(id,key){
    const allOpts = key==='divisi' ? [...new Set(rawData.map(d=>d.divisi).filter(v=>v&&v!=='-'))].sort()
                   : key==='lokasi' ? [...new Set(rawData.map(d=>d.lokasi).filter(v=>v&&v!=='-'))].sort()
                   : ['Belum Ditangani','Proses'];
    populateMultiSelect(id, allOpts, state[key]);
}
function setPeriodUI(p){
    document.querySelectorAll('.filter-btn').forEach(b=>{
        if(b.dataset.filter===p){b.classList.add('active');b.classList.remove('text-slate-600');}
        else{b.classList.remove('active');b.classList.add('text-slate-600');}
    });
}
function clearAllFilters() {
    state.divisi = []; state.lokasi = []; state.status = [];
    state.search = '';
    const si=document.getElementById('searchInput'); if(si) si.value = '';
    state.selectedDate = null;
    state.dateFrom=''; state.dateTo='';
    const df=document.getElementById('dateFrom');if(df)df.value='';
    const dt=document.getElementById('dateTo');if(dt)dt.value='';
    state.period = 'all';
    setPeriodUI('all');
    populateMultiSelect('divisiFilter',[...new Set(rawData.map(d=>d.divisi).filter(v=>v&&v!=='-'))].sort(),[]);
    populateMultiSelect('lokasiFilter',[...new Set(rawData.map(d=>d.lokasi).filter(v=>v&&v!=='-'))].sort(),[]);
    populateMultiSelect('statusFilter',['Belum Ditangani','Proses'],[]);
    state.page = 1;
    applyFilters();
}
function clearSelectedDate() {
    state.selectedDate = null;
    state.dateFrom=''; state.dateTo='';
    const df=document.getElementById('dateFrom');if(df)df.value='';
    const dt=document.getElementById('dateTo');if(dt)dt.value='';
    const bd=document.getElementById('selectedDateBadge');if(bd)bd.classList.add('hidden');
    if (state.period === 'custom') { state.period='all'; setPeriodUI('all'); }
    renderCalendar();
    applyFilters();
}

// ---------- Stats ----------
function updateStats() {
    const t=filteredData.length;
    const loc=new Set(filteredData.map(d=>d.lokasi).filter(v=>v&&v!=='-')).size;
    const proses=filteredData.filter(d=>d.status==='Proses').length;
    const pending=filteredData.filter(d=>d.status==='Belum Ditangani').length;
    animateNumber('statTotal',t);
    const su = document.getElementById('statUnits'); if(su) animateNumberEl(su,loc);
    const sp = document.getElementById('statProses'); if(sp) animateNumberEl(sp,proses);
    const spe = document.getElementById('statPending'); if(spe) animateNumberEl(spe,pending);
    // Subtitles
    const pctP = t?Math.round(pending/t*100):0;
    const pctPr = t?Math.round(proses/t*100):0;
    const ts = document.getElementById('statTotalSub'); if(ts) ts.textContent = state.selectedDate?fmtDateShort(state.selectedDate):`${rawData.length} total di dataset`;
    const us = document.getElementById('statUnitsSub'); if(us) us.textContent = `${loc} area berbeda`;
    const prs = document.getElementById('statProsesSub'); if(prs) prs.textContent = `${pctPr}% dari total`;
    const pes = document.getElementById('statPendingSub'); if(pes) pes.textContent = `${pctP}% dari total`;
}
function animateNumber(id,tgt){const el=document.getElementById(id);if(!el)return;animateNumberEl(el,tgt);}
function animateNumberEl(el,tgt) {
    const cur=parseInt((el.textContent||'0').replace(/\./g,''))||0;
    if(cur===tgt)return;
    const step=Math.max(1,Math.ceil(Math.abs(tgt-cur)/15));
    let v=cur;
    const fn=setInterval(()=>{
        if(v<tgt)v=Math.min(v+step,tgt);
        else if(v>tgt)v=Math.max(v-step,tgt);
        el.textContent=v.toLocaleString('id-ID');
        if(v===tgt)clearInterval(fn);
    },25);
}

// ---------- Chart defaults ----------
function dk(k){if(charts[k]){charts[k].destroy();charts[k]=null;}}
if(typeof Chart !== 'undefined'){
    Chart.defaults.font.family="Inter,system-ui,sans-serif";
    Chart.defaults.font.size=11;
    Chart.defaults.color=TICK_COLOR;
    Chart.defaults.plugins.legend.labels.boxWidth=8;
    Chart.defaults.plugins.legend.labels.boxHeight=8;
    Chart.defaults.plugins.legend.labels.padding=10;
    Chart.defaults.plugins.legend.labels.usePointStyle=true;
    Chart.defaults.plugins.legend.labels.pointStyle='circle';
    Chart.defaults.elements.bar.borderWidth=0;
    Chart.defaults.elements.line.borderWidth=2;
}
function mkOpts(h=false,extra={}){
    return{
        responsive:true,maintainAspectRatio:false,
        plugins:{
            legend:{display:false},
            tooltip:{
                backgroundColor:'#0f172a',padding:10,cornerRadius:8,
                titleFont:{size:11,weight:'600',family:'Inter'},
                bodyFont:{size:11,family:'Inter'},
                displayColors:true,boxPadding:4,
                borderColor:'rgba(255,255,255,0.1)',borderWidth:1
            }
        },
        scales: h ? {
            x:{grid:{display:false},ticks:{color:TICK_COLOR,font:{size:10}},border:{display:false},beginAtZero:true},
            y:{grid:{color:GRID_COLOR},ticks:{color:TICK_COLOR,font:{size:10}},border:{display:false}}
        } : {
            x:{grid:{display:false},ticks:{color:TICK_COLOR,font:{size:10},maxRotation:0,autoSkip:true,maxTicksLimit:12},border:{display:false}},
            y:{grid:{color:GRID_COLOR},ticks:{color:TICK_COLOR,font:{size:10},precision:0},border:{display:false},beginAtZero:true}
        },
        layout:{padding:{top:4,right:4,bottom:0,left:0}},
        ...extra
    };
}
function mkDoughnutOpts(opts={}){
    return{
        responsive:true,maintainAspectRatio:false,cutout:'72%',
        plugins:{
            legend:{position:'bottom',labels:{boxWidth:8,boxHeight:8,padding:12,usePointStyle:true,pointStyle:'circle',font:{size:10}}},
            tooltip:{backgroundColor:'#0f172a',padding:10,cornerRadius:8,titleFont:{size:11,weight:'600'},bodyFont:{size:11}}
        },
        ...opts
    };
}

function renderCharts() {
    // Destroy dulu semua
    ['trend','status','lokasi','sparepart','jenis','divisi','divStacked','engine','engineType','irrigator','irrType'].forEach(k=>dk(k));
    renderSeverityCharts();

    // ==== TREND (overview tab) ====
    const trendEl = document.getElementById('trendChart');
    if(trendEl && isElVisible(trendEl)){
        const groups={}; let getKey;
        let mode = state.period;
        if (state.selectedDate) mode = 'daily';
        const p2 = n => String(n).padStart(2,'0');
        const dayKey = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
        const monKey = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}`;
        const fmtDay = k => { const [y,m,dd]=k.split('-'); return new Date(+y,+m-1,+dd).toLocaleDateString('id-ID',{day:'2-digit',month:'short'}); };
        const fmtMon = k => { const [y,m]=k.split('-'); return new Date(+y,+m-1,1).toLocaleDateString('id-ID',{month:'short',year:'numeric'}); };
        let labelFmt = k => k;
        // Rentang tanggal aktual dari data (untuk mode "Semua" / custom panjang)
        const times = filteredData.map(d=>new Date(d.timestamp).getTime()).filter(t=>!isNaN(t));
        const dMin = times.length ? new Date(Math.min(...times)) : null;
        const dMax = times.length ? new Date(Math.max(...times)) : null;
        const spanDays = dMin ? Math.round((startOfDay(dMax)-startOfDay(dMin))/86400000)+1 : 0;

        if (mode === 'daily' && !state.selectedDate) {
            getKey = d => String(d.getHours()).padStart(2,'0');
            for (let h=0;h<24;h++) groups[String(h).padStart(2,'0')]=0;
            labelFmt = k => k+':00';
        } else if (mode === 'daily' && state.selectedDate) {
            getKey = d => String(d.getHours()).padStart(2,'0');
            for (let h=0;h<24;h++) groups[String(h).padStart(2,'0')]=0;
            labelFmt = k => k+':00';
        } else if (mode === 'weekly') {
            // Minggu berjalan: 7 hari dari Senin, key per tanggal agar tidak
            // tercampur antar minggu.
            const ws = startOfWeek(new Date());
            for (let i=0;i<7;i++){ const x=new Date(ws); x.setDate(ws.getDate()+i); groups[dayKey(x)]=0; }
            getKey = dayKey;
            labelFmt = k => { const [y,m,dd]=k.split('-'); return ['Min','Sen','Sel','Rab','Kam','Jum','Sab'][new Date(+y,+m-1,+dd).getDay()]+' '+dd; };
        } else if (mode === 'monthly') {
            const ref = new Date();
            const dim = new Date(ref.getFullYear(), ref.getMonth()+1,0).getDate();
            for (let i=1;i<=dim;i++) groups[`${ref.getFullYear()}-${p2(ref.getMonth()+1)}-${p2(i)}`]=0;
            getKey = dayKey; labelFmt = k => String(+k.split('-')[2]);
        } else {
            // "Semua" atau custom: pilih granularitas dari rentang data/filter.
            // SEBELUMNYA: mode "Semua" selalu per-BULAN → jika semua data ada di
            // 1 bulan, hanya 1 titik → garis tidak tergambar (grafik kosong).
            let from = dMin, to = dMax;
            if (state.period==='custom' && state.dateFrom && state.dateTo) {
                from = new Date(state.dateFrom+'T00:00:00'); to = new Date(state.dateTo+'T23:59:59');
            }
            const span = from ? Math.round((startOfDay(to)-startOfDay(from))/86400000)+1 : 0;
            if (from && span <= 120) {
                // per hari, isi hari kosong dengan 0 agar garis kontinu
                for (let x=startOfDay(from); x<=to; x.setDate(x.getDate()+1)) groups[dayKey(x)]=0;
                getKey = dayKey; labelFmt = fmtDay;
            } else if (from) {
                for (let x=startOfMonth(from); x<=to; x.setMonth(x.getMonth()+1)) groups[monKey(x)]=0;
                getKey = monKey; labelFmt = fmtMon;
            } else { getKey = dayKey; labelFmt = fmtDay; }
        }
        filteredData.forEach(d=>{const t=new Date(d.timestamp); if(isNaN(t)) return; const k=getKey(t); groups[k]=(groups[k]||0)+1;});
        const keys = Object.keys(groups).sort();
        const labels = keys.map(labelFmt);
        const values = keys.map(k=>groups[k]);
        const nonZero = values.filter(v=>v>0).length;
        // Jika hanya 1 titik berisi data, garis tidak bisa tergambar → tampilkan titiknya.
        const showPoints = keys.length <= 31 || nonZero <= 2;
        const ctx=trendEl.getContext('2d');
        if(ctx){
            const g=ctx.createLinearGradient(0,0,0,240);
            g.addColorStop(0,'rgba(37,99,235,0.35)');g.addColorStop(1,'rgba(37,99,235,0)');
            charts.trend = new Chart(ctx,{
                type:'line',
                data:{labels,datasets:[{
                    label:'Laporan',data:values,
                    borderColor:'#2563eb',backgroundColor:g,
                    borderWidth:2.5,fill:true,tension:0.35,
                    pointRadius:showPoints?3:0,pointBackgroundColor:'#2563eb',pointHoverRadius:5,
                    pointHoverBackgroundColor:'#1d4ed8',pointHoverBorderColor:'#fff',pointHoverBorderWidth:2
                }]},
                options:mkOpts(false,{plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:TICK_COLOR,font:{size:10},maxRotation:0,autoSkip:true,maxTicksLimit:keys.length<=16?keys.length:12},border:{display:false}},y:{grid:{color:GRID_COLOR},ticks:{color:TICK_COLOR,font:{size:10},precision:0},border:{display:false},beginAtZero:true}}})
            });
        }
        const ts = document.getElementById('trendSub');
        if(ts){
            const peak = keys.map((k,i)=>[labels[i],values[i]]).sort((a,b)=>b[1]-a[1])[0];
            const tot = values.reduce((a,b)=>a+b,0);
            ts.textContent = peak && peak[1]>0 ? `${tot} laporan · Puncak: ${peak[0]} (${peak[1]} laporan)` : 'Frekuensi laporan per periode';
        }
    }

    // ==== STATUS DONUT (overview) ====
    const statusEl = document.getElementById('statusChart');
    if(statusEl && isElVisible(statusEl)){
        const sg={'Belum Ditangani':0,'Proses':0};
        filteredData.forEach(d=>{if(sg[d.status]!==undefined)sg[d.status]++;});
        const ctx=statusEl.getContext('2d');
        if(ctx){
            charts.status=new Chart(ctx,{
                type:'doughnut',
                data:{labels:Object.keys(sg),datasets:[{
                    data:Object.values(sg),
                    backgroundColor:['#94a3b8','#f59e0b'],borderWidth:0,hoverOffset:6
                }]},
                options:mkDoughnutOpts()
            });
        }
        const ins = document.getElementById('statusInsight');
        if(ins){
            const tot=sg['Belum Ditangani']+sg['Proses'];
            const pct=tot?Math.round(sg['Belum Ditangani']/tot*100):0;
            ins.innerHTML = pct>50
                ? `<span class="text-red-600 font-semibold"><i class="fas fa-triangle-exclamation mr-1"></i>${pct}% belum ditangani</span>`
                : pct>0
                ? `<span class="text-amber-600 font-semibold"><i class="fas fa-circle-info mr-1"></i>${pct}% masih menunggu</span>`
                : `<span class="text-emerald-600 font-semibold"><i class="fas fa-circle-check mr-1"></i>Semua sudah diproses</span>`;
        }
    }

    // ==== DIVISI DONUT (overview) ====
    const divisiEl = document.getElementById('divisiChart');
    if(divisiEl && isElVisible(divisiEl)){
        const dg={};
        filteredData.forEach(d=>{if(d.divisi&&d.divisi!=='-')dg[d.divisi]=(dg[d.divisi]||0)+1;});
        const ctx=divisiEl.getContext('2d');
        if(ctx){
            const labels=Object.keys(dg);
            charts.divisi=new Chart(ctx,{
                type:'doughnut',
                data:{labels,datasets:[{
                    data:Object.values(dg),
                    backgroundColor:labels.map(l=>DIV_COLORS[l]||CC[labels.indexOf(l)%CC.length]),
                    borderWidth:0,hoverOffset:6
                }]},
                options:mkDoughnutOpts()
            });
        }
    }

    // ==== JENIS BAR (damage tab) ====
    const jenisEl = document.getElementById('jenisChart');
    if(jenisEl && isElVisible(jenisEl)){
        const jg={};
        filteredData.forEach(d=>{if(d.damageType&&d.damageType!=='-')jg[d.damageType]=(jg[d.damageType]||0)+1;});
        const js=Object.entries(jg).sort((a,b)=>b[1]-a[1]);
        const ctx=jenisEl.getContext('2d');
        if(ctx){
            charts.jenis=new Chart(ctx,{
                type:'bar',
                data:{labels:js.map(x=>x[0]),datasets:[{
                    label:'Jumlah',data:js.map(x=>x[1]),
                    backgroundColor:js.map((_,i)=>CC[i%CC.length]),
                    borderRadius:6,borderSkipped:false,borderWidth:0,maxBarThickness:44
                }]},
                options:mkOpts(false,{plugins:{legend:{display:false}}})
            });
        }
    }

    // ==== LOKASI H-BAR (divisi tab) ====
    const lokasiEl = document.getElementById('lokasiChart');
    if(lokasiEl && isElVisible(lokasiEl)){
        const lg={};
        filteredData.forEach(d=>{if(d.lokasi&&d.lokasi!=='-')lg[d.lokasi]=(lg[d.lokasi]||0)+1;});
        const ls=Object.entries(lg).sort((a,b)=>b[1]-a[1]).slice(0,10);
        const ctx=lokasiEl.getContext('2d');
        if(ctx){
            charts.lokasi=new Chart(ctx,{
                type:'bar',
                data:{labels:ls.map(x=>x[0]),datasets:[{
                    label:'Jumlah',data:ls.map(x=>x[1]),
                    backgroundColor:ls.map((_,i)=>CC[i%CC.length]),
                    borderRadius:6,borderSkipped:false,borderWidth:0,maxBarThickness:22
                }]},
                options:mkOpts(true,{indexAxis:'y',plugins:{legend:{display:false}},scales:{
                    x:{grid:{color:GRID_COLOR},ticks:{color:TICK_COLOR,font:{size:10},precision:0},border:{display:false},beginAtZero:true},
                    y:{grid:{display:false},ticks:{color:TICK_COLOR,font:{size:10}},border:{display:false}}
                }})
            });
        }
    }

    // ==== SPAREPART BAR (overview tak perlu, tapi kita tidak pakai; dihapus karena sekarang top-list) ====
    const sparepartEl = document.getElementById('sparepartChart');
    if(sparepartEl && isElVisible(sparepartEl)){
        const spg={};
        filteredData.forEach(d=>{
            if(d.sparepart&&d.sparepart!=='-')d.sparepart.split(/;\s*/).forEach(sp=>{sp=sp.trim();if(sp)spg[sp]=(spg[sp]||0)+1;});
        });
        const sps=Object.entries(spg).sort((a,b)=>b[1]-a[1]).slice(0,8);
        const ctx=sparepartEl.getContext('2d');
        if(ctx){
            charts.sparepart=new Chart(ctx,{
                type:'bar',
                data:{labels:sps.map(x=>x[0]),datasets:[{
                    label:'Kebutuhan',data:sps.map(x=>x[1]),
                    backgroundColor:'#f59e0b',borderRadius:6,borderSkipped:false,borderWidth:0,maxBarThickness:24
                }]},
                options:mkOpts(true,{plugins:{legend:{display:false}}})
            });
        }
    }

    // ==== DIVISI STACKED (per-divisi tab) ====
    const stackEl = document.getElementById('divisiStackedChart');
    if(stackEl && isElVisible(stackEl)){
        const divs = [...new Set(filteredData.map(d=>d.divisi).filter(v=>v&&v!=='-'))].sort();
        const pending = divs.map(dv=>filteredData.filter(d=>d.divisi===dv&&d.status==='Belum Ditangani').length);
        const proses = divs.map(dv=>filteredData.filter(d=>d.divisi===dv&&d.status==='Proses').length);
        const ctx=stackEl.getContext('2d');
        if(ctx){
            charts.divStacked = new Chart(ctx,{
                type:'bar',
                data:{labels:divs,datasets:[
                    {label:'Belum Ditangani',data:pending,backgroundColor:'#94a3b8',borderRadius:{topLeft:0,topRight:0,bottomLeft:4,bottomRight:4},borderSkipped:false,stack:'s',maxBarThickness:56},
                    {label:'Proses',data:proses,backgroundColor:'#f59e0b',borderRadius:{topLeft:4,topRight:4,bottomLeft:0,bottomRight:0},borderSkipped:false,stack:'s',maxBarThickness:56}
                ]},
                options:mkOpts(false,{
                    plugins:{legend:{position:'bottom',labels:{boxWidth:8,boxHeight:8,usePointStyle:true,pointStyle:'circle',font:{size:10},padding:12}}},
                    scales:{
                        x:{stacked:true,grid:{display:false},ticks:{color:TICK_COLOR,font:{size:11,weight:'600'}},border:{display:false}},
                        y:{stacked:true,grid:{color:GRID_COLOR},ticks:{color:TICK_COLOR,font:{size:10},precision:0},border:{display:false},beginAtZero:true}
                    }
                })
            });
        }
    }

    // ==== ENGINE TOP UNITS H-BAR (engine tab) ====
    const engEl = document.getElementById('engineChart');
    if(engEl && isElVisible(engEl)){
        const eu = {};
        filteredData.forEach(d=>{
            if(d.engineCode&&d.engineCode!=='-'&&d.engineType&&d.engineType!=='-'){
                const k = `${d.engineType} ${d.engineCode}`;
                eu[k] = (eu[k]||0)+1;
            }
        });
        const es = Object.entries(eu).sort((a,b)=>b[1]-a[1]).slice(0,12).reverse();
        const ctx=engEl.getContext('2d');
        if(ctx && es.length){
            charts.engine = new Chart(ctx,{
                type:'bar',
                data:{labels:es.map(x=>x[0]),datasets:[{
                    label:'Kerusakan',data:es.map(x=>x[1]),
                    backgroundColor:es.map((x)=>{
                        const t=x[0].split(' ')[0];
                        return ENG_COLORS[t]||'#f97316';
                    }),
                    borderRadius:6,borderSkipped:false,borderWidth:0,maxBarThickness:24
                }]},
                options:mkOpts(true,{indexAxis:'y',plugins:{legend:{display:false},datalabels:false},scales:{
                    x:{grid:{color:GRID_COLOR},ticks:{color:TICK_COLOR,font:{size:10},precision:0},border:{display:false},beginAtZero:true,title:{display:false}},
                    y:{grid:{display:false},ticks:{color:TICK_COLOR,font:{size:11,weight:'600'}},border:{display:false}}
                }})
            });
        }
    }

    // ==== ENGINE TYPE DONUT (engine tab) ====
    const engTypeEl = document.getElementById('engineTypeChart');
    if(engTypeEl && isElVisible(engTypeEl)){
        const et = {};
        filteredData.forEach(d=>{ if(d.engineType&&d.engineType!=='-') et[d.engineType]=(et[d.engineType]||0)+1; });
        const labels = Object.keys(et);
        const ctx=engTypeEl.getContext('2d');
        if(ctx && labels.length){
            charts.engineType = new Chart(ctx,{
                type:'doughnut',
                data:{labels,datasets:[{
                    data:Object.values(et),
                    backgroundColor:labels.map(l=>ENG_COLORS[l]||CC[labels.indexOf(l)%CC.length]),
                    borderWidth:0,hoverOffset:6
                }]},
                options:mkDoughnutOpts()
            });
        }
    }

    // ==== IRIGATOR TOP UNITS H-BAR (irrigator tab) ====
    const irrEl = document.getElementById('irrigatorChart');
    if(irrEl && isElVisible(irrEl)){
        const iu = {};
        filteredData.forEach(d=>{
            if(d.irrCode&&d.irrCode!=='-'&&d.irrType&&d.irrType!=='-'){
                const k = `${d.irrType} ${d.irrCode}`;
                iu[k] = (iu[k]||0)+1;
            }
        });
        const is_ = Object.entries(iu).sort((a,b)=>b[1]-a[1]).slice(0,12).reverse();
        const ctx=irrEl.getContext('2d');
        if(ctx && is_.length){
            charts.irrigator = new Chart(ctx,{
                type:'bar',
                data:{labels:is_.map(x=>x[0]),datasets:[{
                    label:'Kerusakan',data:is_.map(x=>x[1]),
                    backgroundColor:is_.map((x)=>{
                        const t=x[0].split(' ')[0];
                        return IRR_COLORS[t]||'#ec4899';
                    }),
                    borderRadius:6,borderSkipped:false,borderWidth:0,maxBarThickness:24
                }]},
                options:mkOpts(true,{indexAxis:'y',plugins:{legend:{display:false}},scales:{
                    x:{grid:{color:GRID_COLOR},ticks:{color:TICK_COLOR,font:{size:10},precision:0},border:{display:false},beginAtZero:true},
                    y:{grid:{display:false},ticks:{color:TICK_COLOR,font:{size:11,weight:'600'}},border:{display:false}}
                }})
            });
        }
    }

    // ==== IRIGATOR TYPE DONUT (irrigator tab) ====
    const irrTypeEl = document.getElementById('irrTypeChart');
    if(irrTypeEl && isElVisible(irrTypeEl)){
        const it = {};
        filteredData.forEach(d=>{ if(d.irrType&&d.irrType!=='-') it[d.irrType]=(it[d.irrType]||0)+1; });
        const labels = Object.keys(it);
        const ctx=irrTypeEl.getContext('2d');
        if(ctx && labels.length){
            charts.irrType = new Chart(ctx,{
                type:'doughnut',
                data:{labels,datasets:[{
                    data:Object.values(it),
                    backgroundColor:labels.map(l=>IRR_COLORS[l]||CC[labels.indexOf(l)%CC.length]),
                    borderWidth:0,hoverOffset:6
                }]},
                options:mkDoughnutOpts()
            });
        }
    }
}
function isElVisible(el){
    if(!el) return false;
    while(el){
        if(el===document.body) break;
        if(!el.offsetParent && el.style.display!=='') return false;
        if(getComputedStyle(el).display==='none') return false;
        el = el.parentElement;
    }
    return true;
}

// ---------- Overview render ----------
function renderOverview(){
    if(!document.getElementById('topLokasi')) return;

    const countBy = (key, filterD=filteredData) => {
        const o={};
        filterD.forEach(d=>{
            const v = typeof key==='function'?key(d):d[key];
            if(!v||v==='-') return;
            if(typeof v==='string' && v.includes(';')) v.split(/;\s*/).forEach(x=>{x=x.trim();if(x)o[x]=(o[x]||0)+1;});
            else o[v]=(o[v]||0)+1;
        });
        return o;
    };

    const renderTopList = (containerId, obj, color, icon, emptyText='Tidak ada data', max=6) => {
        const c = document.getElementById(containerId);
        if(!c) return;
        const entries = Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,max);
        if(!entries.length){ c.innerHTML = `<div class="text-xs text-slate-400 py-4 text-center italic">${emptyText}</div>`; return; }
        const maxV = entries[0][1];
        c.innerHTML = entries.map(([k,v],i)=>{
            const rankBg = i===0?'bg-red-100 text-red-600':i===1?'bg-amber-100 text-amber-600':i===2?'bg-blue-100 text-blue-600':'bg-slate-100 text-slate-500';
            const pct = maxV?Math.round(v/maxV*100):0;
            return `<div class="top-item">
                <div class="top-rank ${rankBg}">${i+1}</div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-xs font-semibold text-slate-700 truncate">${escapeHtml(k)}</span>
                        <span class="text-xs font-bold text-slate-900 ml-2">${v}</span>
                    </div>
                    <div class="top-bar"><span style="width:${pct}%;background:${color}"></span></div>
                </div>
            </div>`;
        }).join('');
    };

    renderTopList('topLokasi', countBy('lokasi'), '#ef4444', 'fa-map-pin', 'Tidak ada lokasi');
    renderTopList('topSparepart', countBy(d=>d.sparepart), '#f59e0b', 'fa-boxes', 'Tidak ada data sparepart');
    renderTopList('topJenis', countBy('damageType'), '#8b5cf6', 'fa-triangle-exclamation', 'Tidak ada data kerusakan');

    // Quick insights
    const qi = document.getElementById('quickInsights');
    if(qi){
        const total = filteredData.length;
        const pending = filteredData.filter(d=>d.status==='Belum Ditangani').length;
        const proses = total - pending;
        const locCount = new Set(filteredData.map(d=>d.lokasi).filter(v=>v&&v!=='-')).size;
        const spCount = new Set();
        filteredData.forEach(d=>{ if(d.sparepart&&d.sparepart!=='-') d.sparepart.split(/;\s*/).forEach(s=>{if(s.trim())spCount.add(s.trim());}); });
        // Top lokasi
        const lEnt = Object.entries(countBy('lokasi')).sort((a,b)=>b[1]-a[1]);
        const topLoc = lEnt[0];
        // Recent
        const latest = filteredData[0];
        const cards = [];
        if(topLoc && topLoc[1]>0){
            cards.push({color:'red',icon:'fa-fire',title:`Hotspot utama`,text:`<b>${topLoc[0]}</b> dengan ${topLoc[1]} laporan (${total?Math.round(topLoc[1]/total*100):0}% dari total)`});
        }
        cards.push({color:'slate',icon:'fa-hourglass-half',title:'Belum ditangani',text:`<b>${pending}</b> laporan (${total?Math.round(pending/total*100):0}%) belum memiliki nomor PR`});
        cards.push({color:'amber',icon:'fa-file-invoice',title:'Sedang diproses',text:`<b>${proses}</b> laporan sudah memiliki PR aktif (${total?Math.round(proses/total*100):0}%)`});
        cards.push({color:'indigo',icon:'fa-box-open',title:'Variasi sparepart',text:`<b>${spCount.size}</b> jenis sparepart berbeda dibutuhkan dalam periode ini`});
        cards.push({color:'blue',icon:'fa-location-dot',title:'Cakupan area',text:`${locCount} lokasi/unit berbeda mengalami kerusakan`});
        qi.innerHTML = cards.map(c=>`
            <div class="flex items-start gap-3 p-2.5 rounded-lg bg-slate-50/70 hover:bg-slate-50 transition">
                <div class="w-8 h-8 rounded-lg bg-${c.color}-100 text-${c.color}-600 flex items-center justify-center text-xs flex-shrink-0"><i class="fas ${c.icon}"></i></div>
                <div class="min-w-0 flex-1">
                    <div class="text-[11px] font-bold text-slate-800">${c.title}</div>
                    <div class="text-[11px] text-slate-600 leading-snug">${c.text}</div>
                </div>
            </div>
        `).join('');
    }

    // Recent list (5 terbaru)
    const rl = document.getElementById('recentList');
    if(rl){
        const recent = filteredData.slice(0,6);
        if(!recent.length){ rl.innerHTML = `<div class="text-xs text-slate-400 py-6 text-center italic">Tidak ada data pada filter ini</div>`; }
        else {
            rl.innerHTML = recent.map(d=>{
                const sb = d.status==='Proses'
                    ? '<span class="status-badge bg-amber-100 text-amber-700"><i class="fas fa-circle text-[6px]"></i>Proses</span>'
                    : '<span class="status-badge bg-slate-100 text-slate-700"><i class="fas fa-circle text-[6px]"></i>Belum</span>';
                return `<div class="flex items-start gap-3 py-2.5 cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded-lg" onclick="selectDate('${d.tanggalInspeksi}');switchTab('calendar')">
                    <div class="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex flex-col items-center justify-center flex-shrink-0">
                        <div class="text-[8px] font-bold uppercase leading-none">${new Date(d.timestamp).toLocaleDateString('id-ID',{month:'short'})}</div>
                        <div class="text-sm font-bold leading-none">${new Date(d.timestamp).getDate()}</div>
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 mb-0.5 flex-wrap">
                            <span class="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-semibold"><i class="fas fa-map-marker-alt text-[7px]"></i>${d.lokasi}</span>
                            <span class="text-[9px] text-slate-400 font-semibold bg-slate-50 px-1.5 py-0.5 rounded">${d.divisi}</span>
                            ${sb}
                        </div>
                        <div class="text-xs font-semibold text-slate-800 truncate">${d.damageType||'-'}</div>
                        <div class="text-[11px] text-slate-500 truncate">${d.keterangan||d.sparepart||'-'}</div>
                    </div>
                </div>`;
            }).join('');
        }
    }
}

// ---------- Damage Tab ----------
function renderDamageTab(){
    const grid = document.getElementById('damageDetailGrid');
    if(!grid) return;
    const groups = {};
    filteredData.forEach(d=>{
        const t = d.damageType && d.damageType !== '-' ? d.damageType : 'Lainnya';
        if(!groups[t]) groups[t]=[];
        groups[t].push(d);
    });
    const entries = Object.entries(groups).sort((a,b)=>b[1].length-a[1].length);
    document.getElementById('dmgTotalTypes').textContent = entries.length;
    document.getElementById('dmgTotalReports').textContent = filteredData.length;
    if(!entries.length){ grid.innerHTML = `<div class="card p-10 text-center col-span-full text-slate-400 text-sm italic"><i class="fas fa-inbox text-4xl mb-2 block text-slate-200"></i>Tidak ada data pada filter ini</div>`; return; }
    const maxV = entries[0][1].length;
    grid.innerHTML = entries.map(([name,items],idx)=>{
        const pending = items.filter(x=>x.status==='Belum Ditangani').length;
        const proses = items.length - pending;
        // Top lokasi
        const lokMap = {}; items.forEach(x=>{if(x.lokasi&&x.lokasi!=='-')lokMap[x.lokasi]=(lokMap[x.lokasi]||0)+1;});
        const topLok = Object.entries(lokMap).sort((a,b)=>b[1]-a[1]).slice(0,3);
        // Top sparepart
        const spMap = {}; items.forEach(x=>{if(x.sparepart&&x.sparepart!=='-')x.sparepart.split(/;\s*/).forEach(s=>{s=s.trim();if(s)spMap[s]=(spMap[s]||0)+1;});});
        const topSp = Object.entries(spMap).sort((a,b)=>b[1]-a[1]).slice(0,3);
        const color = CC[idx%CC.length];
        const sevColor = pending/items.length > 0.6 ? 'text-red-600 bg-red-50' : pending/items.length > 0.3 ? 'text-amber-600 bg-amber-50' : 'text-emerald-600 bg-emerald-50';
        const sevLabel = pending/items.length > 0.6 ? 'Prioritas Tinggi' : pending/items.length > 0.3 ? 'Perlu Perhatian' : 'Terkendali';
        const pctPending = Math.round(pending/items.length*100);
        return `<div class="card p-4 card-hover">
            <div class="flex items-start justify-between gap-2 mb-3">
                <div class="flex items-center gap-2 min-w-0">
                    <div class="w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm flex-shrink-0" style="background:${color}"><i class="fas fa-bug"></i></div>
                    <div class="min-w-0">
                        <h4 class="font-bold text-slate-800 text-sm truncate">${escapeHtml(name)}</h4>
                        <div class="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">#${idx+1} terbanyak</div>
                    </div>
                </div>
                <div class="flex flex-col items-end gap-1 flex-shrink-0">
                    <span class="stat-number text-2xl" style="color:${color}">${items.length}</span>
                    <span class="text-[9px] font-bold px-1.5 py-0.5 rounded ${sevColor}"><i class="fas fa-circle text-[5px] mr-0.5"></i>${sevLabel}</span>
                </div>
            </div>
            <!-- Progress status -->
            <div class="mb-3">
                <div class="flex justify-between text-[10px] text-slate-500 mb-1 font-semibold">
                    <span><i class="fas fa-hourglass-half mr-1"></i>${pending} belum · ${proses} proses</span>
                    <span>${pctPending}% tertunda</span>
                </div>
                <div class="pbar"><span style="width:${pctPending}%;background:${pctPending>60?'#ef4444':pctPending>30?'#f59e0b':'#10b981'}"></span></div>
            </div>
            <!-- Top lokasi -->
            <div class="mb-2">
                <div class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1"><i class="fas fa-map-pin mr-1 text-red-400"></i>Lokasi Terdampak</div>
                <div class="flex flex-wrap gap-1">
                    ${topLok.length ? topLok.map(([l,c])=>`<span class="inline-flex items-center gap-1 bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[10px] font-semibold"><i class="fas fa-location-dot text-[8px] text-red-500"></i>${escapeHtml(l)} <span class="text-slate-400">×${c}</span></span>`).join('') : '<span class="text-[10px] text-slate-400 italic">—</span>'}
                </div>
            </div>
            <!-- Top sparepart -->
            <div class="mb-3">
                <div class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1"><i class="fas fa-cog mr-1 text-amber-400"></i>Sparepart Dibutuhkan</div>
                <div class="flex flex-wrap gap-1">
                    ${topSp.length ? topSp.map(([s,c])=>`<span class="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-[10px] font-semibold"><i class="fas fa-wrench text-[8px]"></i>${escapeHtml(s)} <span class="text-amber-400">×${c}</span></span>`).join('') : '<span class="text-[10px] text-slate-400 italic">Belum ditentukan</span>'}
                </div>
            </div>
            <!-- Mini list -->
            <details class="group">
                <summary class="text-[11px] font-semibold text-blue-600 cursor-pointer list-none flex items-center gap-1 hover:text-blue-800"><i class="fas fa-chevron-right text-[9px] group-open:rotate-90 transition"></i>Lihat ${items.length} laporan</summary>
                <div class="mt-2 space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    ${items.slice(0,15).map(d=>`
                        <div class="p-2 rounded-lg bg-slate-50 text-[11px] border-l-2" style="border-color:${color}">
                            <div class="flex items-center justify-between mb-0.5">
                                <span class="font-semibold text-slate-700">${d.lokasi} · ${d.divisi}</span>
                                <span class="text-[9px] text-slate-400">${fmtDateShort(d.timestamp)}</span>
                            </div>
                            ${d.keterangan?`<div class="text-slate-600 mb-0.5">${escapeHtml(d.keterangan)}</div>`:''}
                            <div class="flex items-center gap-1.5 flex-wrap">
                                ${d.sparepart&&d.sparepart!=='-'?`<span class="text-amber-700 text-[10px]"><i class="fas fa-cog text-[8px]"></i> ${escapeHtml(d.sparepart)}</span>`:''}
                                ${d.prNumber?`<span class="text-blue-700 text-[10px]"><i class="fas fa-file-invoice text-[8px]"></i> PR ${d.prNumber}</span>`:''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </details>
        </div>`;
    }).join('');
}

// ---------- Divisi Tab ----------
function renderDivisiTab(){
    const cards = document.getElementById('divisiCards');
    const grid = document.getElementById('divisiDetailGrid');
    if(!cards||!grid) return;

    // Ambil semua divisi yang ada di rawData
    const allDivs = [...new Set(rawData.map(d=>d.divisi).filter(v=>v&&v!=='-'))].sort();
    const visibleDivs = [...new Set(filteredData.map(d=>d.divisi).filter(v=>v&&v!=='-'))].sort();

    // Cards
    cards.innerHTML = allDivs.map(dv=>{
        const items = filteredData.filter(d=>d.divisi===dv);
        const total = items.length;
        const pending = items.filter(d=>d.status==='Belum Ditangani').length;
        const proses = total - pending;
        const locCount = new Set(items.map(d=>d.lokasi).filter(v=>v&&v!=='-')).size;
        const pctP = total?Math.round(pending/total*100):0;
        const active = items.length>0 || !state.divisi.length || state.divisi.includes(dv);
        return `<div class="card overflow-hidden card-hover">
            <div class="div-card ${DIV_CLASS[dv]||'pg2'} p-4 text-white">
                <div class="flex items-center justify-between">
                    <div>
                        <div class="text-[10px] uppercase tracking-widest font-semibold opacity-80">Divisi</div>
                        <h3 class="display-font font-bold text-2xl">${dv}</h3>
                    </div>
                    <div class="text-right">
                        <div class="stat-number text-3xl">${total}</div>
                        <div class="text-[10px] opacity-80 font-semibold uppercase">laporan</div>
                    </div>
                </div>
            </div>
            <div class="p-4">
                <div class="grid grid-cols-3 gap-2 mb-3 text-center">
                    <div><div class="text-[9px] font-bold text-slate-400 uppercase">Belum</div><div class="text-lg font-bold text-slate-700">${pending}</div></div>
                    <div><div class="text-[9px] font-bold text-slate-400 uppercase">Proses</div><div class="text-lg font-bold text-amber-600">${proses}</div></div>
                    <div><div class="text-[9px] font-bold text-slate-400 uppercase">Lokasi</div><div class="text-lg font-bold text-blue-600">${locCount}</div></div>
                </div>
                <div class="mb-1 flex justify-between text-[10px] font-semibold">
                    <span class="text-slate-500">Progress penanganan</span>
                    <span style="color:${DIV_COLORS[dv]||'#2563eb'}">${100-pctP}%</span>
                </div>
                <div class="pbar"><span style="width:${100-pctP}%;background:${DIV_COLORS[dv]||'#2563eb'}"></span></div>
            </div>
        </div>`;
    }).join('');

    // Detail blocks per-divisi (hanya yang ada data di filter)
    if(!visibleDivs.length){
        grid.innerHTML = `<div class="card p-10 text-center text-slate-400 text-sm italic"><i class="fas fa-folder-open text-4xl mb-2 block text-slate-200"></i>Tidak ada data divisi pada filter ini</div>`;
        return;
    }
    grid.innerHTML = visibleDivs.map(dv=>{
        const items = filteredData.filter(d=>d.divisi===dv);
        const total = items.length;
        const pending = items.filter(d=>d.status==='Belum Ditangani').length;
        const proses = total - pending;
        // Top lokasi
        const locMap={}; items.forEach(x=>{if(x.lokasi&&x.lokasi!=='-')locMap[x.lokasi]=(locMap[x.lokasi]||0)+1;});
        const topLoc = Object.entries(locMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
        // Top jenis kerusakan
        const dmgMap={}; items.forEach(x=>{if(x.damageType&&x.damageType!=='-')dmgMap[x.damageType]=(dmgMap[x.damageType]||0)+1;});
        const topDmg = Object.entries(dmgMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
        // Top sparepart
        const spMap={}; items.forEach(x=>{if(x.sparepart&&x.sparepart!=='-')x.sparepart.split(/;\s*/).forEach(s=>{s=s.trim();if(s)spMap[s]=(spMap[s]||0)+1;});});
        const topSp = Object.entries(spMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
        const color = DIV_COLORS[dv] || '#2563eb';
        // List terbaru per divisi
        const latest = items.slice(0,4);

        return `<div class="card p-4">
            <div class="flex items-center gap-3 mb-4 pb-3 border-b border-slate-100">
                <div class="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style="background:${color}"><i class="fas fa-building"></i></div>
                <div class="flex-1">
                    <h3 class="font-bold text-slate-900 text-base">Divisi ${escapeHtml(dv)}</h3>
                    <p class="text-[11px] text-slate-500">${total} laporan · ${Object.keys(locMap).length} lokasi · ${pending} belum ditangani</p>
                </div>
                <button onclick="state.divisi=['${dv}'];repop('divisiFilter','divisi');applyFilters();" class="text-[10px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition">Fokus divisi ini</button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <!-- Hotspot lokasi -->
                <div>
                    <h5 class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2"><i class="fas fa-fire text-red-500 mr-1"></i>Hotspot Lokasi</h5>
                    <div class="space-y-1.5">
                        ${topLoc.length?topLoc.map(([l,c],i)=>{
                            const pct=Math.round(c/total*100);
                            const rankBg=i===0?'bg-red-500':i<3?'bg-amber-500':'bg-slate-400';
                            return `<div class="top-item p-0 hover:bg-transparent">
                                <div class="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold text-white ${rankBg}">${i+1}</div>
                                <div class="flex-1 min-w-0">
                                    <div class="flex items-center justify-between mb-0.5">
                                        <span class="text-xs font-semibold text-slate-700 truncate">${escapeHtml(l)}</span>
                                        <span class="text-xs font-bold text-slate-900 ml-1">${c} <span class="text-slate-400 font-normal">(${pct}%)</span></span>
                                    </div>
                                    <div class="pbar" style="height:5px"><span style="width:${pct}%;background:${rankBg}"></span></div>
                                </div>
                            </div>`;
                        }).join(''):'<div class="text-[11px] text-slate-400 italic">—</div>'}
                    </div>
                </div>
                <!-- Jenis kerusakan -->
                <div>
                    <h5 class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2"><i class="fas fa-triangle-exclamation text-purple-500 mr-1"></i>Kerusakan Dominan</h5>
                    <div class="space-y-1.5">
                        ${topDmg.length?topDmg.map(([k,c],i)=>{
                            const pct=Math.round(c/total*100);
                            return `<div class="flex items-center gap-2 text-xs">
                                <span class="sev-dot" style="background:${CC[i%CC.length]}"></span>
                                <span class="flex-1 text-slate-700 truncate">${escapeHtml(k)}</span>
                                <span class="text-slate-500">${c}</span>
                                <span class="text-slate-400 text-[10px] w-8 text-right">${pct}%</span>
                            </div>`;
                        }).join(''):'<div class="text-[11px] text-slate-400 italic">—</div>'}
                    </div>
                </div>
                <!-- Sparepart -->
                <div>
                    <h5 class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2"><i class="fas fa-boxes text-amber-500 mr-1"></i>Kebutuhan Sparepart</h5>
                    <div class="space-y-1.5">
                        ${topSp.length?topSp.map(([s,c])=>{
                            return `<div class="flex items-center gap-2 text-xs">
                                <i class="fas fa-cog text-amber-500 text-[9px]"></i>
                                <span class="flex-1 text-slate-700 truncate">${escapeHtml(s)}</span>
                                <span class="font-bold text-amber-600">×${c}</span>
                            </div>`;
                        }).join(''):'<div class="text-[11px] text-slate-400 italic">Belum ada data sparepart</div>'}
                    </div>
                </div>
            </div>
            <!-- Status bar -->
            <div class="mt-4 p-3 rounded-lg bg-slate-50 flex items-center justify-between gap-3 flex-wrap">
                <div class="flex items-center gap-4">
                    <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-slate-400"></span><span class="text-[11px] text-slate-600">Belum: <b>${pending}</b></span></div>
                    <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-amber-500"></span><span class="text-[11px] text-slate-600">Proses: <b>${proses}</b></span></div>
                </div>
                <button onclick="showDivisiDetails('${dv}')" class="text-[10px] font-semibold px-3 py-1 rounded-lg text-white hover:opacity-90 transition" style="background:${color}"><i class="fas fa-list-check mr-1"></i>Lihat ${latest.length} laporan terbaru</button>
            </div>
            <!-- Laporan terbaru per divisi -->
            <div id="divlist-${dv.replace(/\W/g,'_')}" class="hidden mt-3 space-y-2">
                ${latest.map(d=>{
                    const sb = d.status==='Proses'
                        ? '<span class="status-badge bg-amber-100 text-amber-700"><i class="fas fa-circle text-[6px]"></i>Proses</span>'
                        : '<span class="status-badge bg-slate-100 text-slate-700"><i class="fas fa-circle text-[6px]"></i>Belum</span>';
                    return `<div class="p-2.5 rounded-lg border-l-2 bg-slate-50" style="border-color:${color}">
                        <div class="flex items-start justify-between gap-2 mb-1">
                            <span class="inline-flex items-center gap-1 text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded text-[10px] font-semibold"><i class="fas fa-map-marker-alt text-[7px]"></i>${d.lokasi}</span>
                            <span class="text-[9px] text-slate-400">${fmtDateShort(d.timestamp)}</span>
                        </div>
                        <div class="text-xs font-semibold text-slate-800 mb-0.5">${d.damageType||'-'}</div>
                        ${d.keterangan?`<div class="text-[11px] text-slate-600 mb-1">${escapeHtml(d.keterangan)}</div>`:''}
                        <div class="flex items-center gap-2 flex-wrap">
                            ${sb}
                            ${d.sparepart&&d.sparepart!=='-'?`<span class="text-[10px] text-amber-700"><i class="fas fa-cog text-[8px]"></i> ${escapeHtml(d.sparepart)}</span>`:''}
                            ${d.irrigator&&d.irrigator!=='-'?`<span class="text-[10px] text-slate-500"><i class="fas fa-spray-can text-[8px]"></i> ${escapeHtml(d.irrigator)}</span>`:''}
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    }).join('');
}
function showDivisiDetails(dv){
    const id = 'divlist-'+dv.replace(/\W/g,'_');
    const el = document.getElementById(id);
    if(el) el.classList.toggle('hidden');
}

// ---------- Unit Tab (Engine & Irigator) builder ----------
// unitKey: misal "DEM 0032" = type + " " + code
// Returns object per-unit: { key, type, code, items, total, pending, proses, locMap, dmgMap, spMap, divMap, latest }
function aggregateByUnit(typeField, codeField, data) {
    const byKey = {};
    data.forEach(d=>{
        const t=d[typeField], c=d[codeField];
        if(!t||t==='-'||!c||c==='-') return;
        const k=`${t} ${c}`;
        if(!byKey[k]) byKey[k]={type:t,code:c,key:k,items:[]};
        byKey[k].items.push(d);
    });
    Object.values(byKey).forEach(u=>{
        u.total = u.items.length;
        u.pending = u.items.filter(x=>x.status==='Belum Ditangani').length;
        u.proses = u.total - u.pending;
        u.locMap = {}; u.dmgMap = {}; u.spMap = {}; u.divMap = {};
        u.items.forEach(x=>{
            if(x.lokasi&&x.lokasi!=='-') u.locMap[x.lokasi]=(u.locMap[x.lokasi]||0)+1;
            if(x.damageType&&x.damageType!=='-') u.dmgMap[x.damageType]=(u.dmgMap[x.damageType]||0)+1;
            if(x.sparepart&&x.sparepart!=='-') x.sparepart.split(/;\s*/).forEach(s=>{s=s.trim();if(s)u.spMap[s]=(u.spMap[s]||0)+1;});
            if(x.divisi&&x.divisi!=='-') u.divMap[x.divisi]=(u.divMap[x.divisi]||0)+1;
        });
        u.latest = u.items.slice().sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp))[0];
        u.firstSeen = u.items.slice().sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp))[0];
    });
    return byKey;
}
function severityBadge(pctPending){
    if(pctPending>60) return {cls:'bg-red-50 text-red-600',icon:'fa-triangle-exclamation',label:'Kritis'};
    if(pctPending>30) return {cls:'bg-amber-50 text-amber-600',icon:'fa-circle-exclamation',label:'Perlu Perhatian'};
    if(pctPending>0)  return {cls:'bg-emerald-50 text-emerald-600',icon:'fa-circle-check',label:'Terkendali'};
    return {cls:'bg-emerald-50 text-emerald-600',icon:'fa-circle-check',label:'Selesai'};
}
function renderUnitTypeCards(cardsContainerId, data, typeField, colorMap, defaultColor, iconClass, emptyLabel){
    const c = document.getElementById(cardsContainerId);
    if(!c) return;
    const types = {};
    data.forEach(d=>{
        const t=d[typeField]; if(!t||t==='-') return;
        if(!types[t]) types[t]={type:t,items:[]};
        types[t].items.push(d);
    });
    const entries = Object.values(types);
    entries.sort((a,b)=>b.items.length-a.items.length);
    if(!entries.length){ c.innerHTML=`<div class="card p-5 col-span-full text-center text-slate-400 text-xs italic"><i class="fas fa-inbox text-2xl mb-2 block text-slate-200"></i>${emptyLabel}</div>`; return; }
    c.innerHTML = entries.map(t=>{
        const total=t.items.length;
        const pending=t.items.filter(x=>x.status==='Belum Ditangani').length;
        const units = new Set(t.items.map(x=>x.engineCode||x.irrCode||'-').filter(v=>v&&v!=='-')).size;
        const color = colorMap[t.type]||defaultColor;
        // Top damage & sparepart
        const dmg={}, sp={};
        t.items.forEach(x=>{
            if(x.damageType&&x.damageType!=='-') dmg[x.damageType]=(dmg[x.damageType]||0)+1;
            if(x.sparepart&&x.sparepart!=='-') x.sparepart.split(/;\s*/).forEach(s=>{s=s.trim();if(s)sp[s]=(sp[s]||0)+1;});
        });
        const topDmg = Object.entries(dmg).sort((a,b)=>b[1]-a[1])[0];
        const topSp = Object.entries(sp).sort((a,b)=>b[1]-a[1])[0];
        const kind = typeField==='engineType' ? 'engine' : 'irr';
        return `<div class="card overflow-hidden card-hover cursor-pointer" role="button" tabindex="0" title="Klik untuk detail ${escapeHtml(t.type)}" onclick="openTypeDetail('${kind}','${escapeHtml(t.type).replace(/'/g,"\\'")}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">
            <div class="p-4 text-white" style="background:linear-gradient(135deg,${color},${shade(color,-25)})">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <div class="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center text-lg"><i class="fas ${iconClass}"></i></div>
                        <div>
                            <div class="text-[10px] uppercase tracking-widest font-semibold opacity-80">Jenis</div>
                            <h3 class="display-font font-bold text-xl">${escapeHtml(t.type)}</h3>
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="stat-number text-3xl">${total}</div>
                        <div class="text-[10px] opacity-80 font-semibold uppercase">laporan</div>
                    </div>
                </div>
            </div>
            <div class="p-3">
                <div class="grid grid-cols-3 gap-2 mb-2 text-center">
                    <div><div class="text-[9px] font-bold text-slate-400 uppercase">Unit</div><div class="text-base font-bold text-slate-700">${units}</div></div>
                    <div><div class="text-[9px] font-bold text-slate-400 uppercase">Belum</div><div class="text-base font-bold text-slate-700">${pending}</div></div>
                    <div><div class="text-[9px] font-bold text-slate-400 uppercase">Proses</div><div class="text-base font-bold text-amber-600">${total-pending}</div></div>
                </div>
                <div class="text-[10px] text-slate-600 space-y-0.5">
                    ${topDmg?`<div><i class="fas fa-triangle-exclamation text-red-400 mr-1"></i>Kerusakan: <b>${escapeHtml(topDmg[0])}</b> (${topDmg[1]}×)</div>`:''}
                    ${topSp?`<div><i class="fas fa-cog text-amber-500 mr-1"></i>Sparepart: <b>${escapeHtml(topSp[0])}</b></div>`:''}
                </div>
                <div class="mt-2 pt-2 border-t border-slate-100 text-[10px] font-semibold flex items-center justify-between" style="color:${color}"><span><i class="fas fa-circle-info mr-1"></i>Lihat detail lokasi &amp; kerusakan</span><i class="fas fa-arrow-right"></i></div>
            </div>
        </div>`;
    }).join('');
}

// ======================================================
// DETAIL JENIS ENGINE / IRIGATOR (modal) — semua angka dari data spreadsheet
// yang sedang aktif (mengikuti filter periode/divisi/lokasi/pencarian).
// ======================================================
function openTypeDetail(kind, type){
    const isEng = kind==='engine';
    const tf = isEng?'engineType':'irrType', cf = isEng?'engineCode':'irrCode';
    const items = filteredData.filter(d=>d[tf]===type);
    const color = (isEng?ENG_COLORS:IRR_COLORS)[type] || (isEng?'#f97316':'#ec4899');
    const label = isEng?'Engine':'Irigator';
    const modal = document.getElementById('typeDetailModal');
    if(!modal) return;
    const cnt = (arr, fn) => { const m={}; arr.forEach(x=>{ const k=fn(x); if(k&&k!=='-') m[k]=(m[k]||0)+1; }); return Object.entries(m).sort((a,b)=>b[1]-a[1]); };
    const total = items.length;
    const pending = items.filter(x=>x.status==='Belum Ditangani').length;
    const byLok = cnt(items, x=>x.lokasi);
    const byDmg = cnt(items, x=>x.damageType);
    const byDiv = cnt(items, x=>x.divisi);
    const byUnit = cnt(items, x=>x[cf]&&x[cf]!=='-'?`${type} ${x[cf]}`:null);
    const spm={}; items.forEach(x=>{ if(x.sparepart&&x.sparepart!=='-') x.sparepart.split(/;\s*/).forEach(v=>{v=v.trim(); if(v) spm[v]=(spm[v]||0)+1;}); });
    const bySp = Object.entries(spm).sort((a,b)=>b[1]-a[1]);
    const dates = items.map(x=>new Date(x.timestamp)).filter(d=>!isNaN(d)).sort((a,b)=>a-b);
    // Lokasi ↔ kerusakan (matriks ringkas: tiap lokasi, kerusakan apa saja)
    const lokDmg = {}; items.forEach(x=>{ const l=x.lokasi||'-'; (lokDmg[l]=lokDmg[l]||{}); const k=x.damageType||'-'; lokDmg[l][k]=(lokDmg[l][k]||0)+1; });

    const bar = (rows, colr, maxShow=8) => {
        if(!rows.length) return '<div class="text-xs text-slate-400 italic">Tidak ada data</div>';
        const max = rows[0][1];
        return rows.slice(0,maxShow).map(([k,v])=>`
            <div class="flex items-center gap-2 text-xs">
                <div class="w-28 truncate font-medium text-slate-700" title="${escapeHtml(k)}">${escapeHtml(k)}</div>
                <div class="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden"><div class="h-full rounded-full" style="width:${Math.max(6,v/max*100)}%;background:${colr}"></div></div>
                <div class="w-8 text-right font-bold text-slate-700">${v}</div>
            </div>`).join('') + (rows.length>maxShow?`<div class="text-[10px] text-slate-400 mt-1">+${rows.length-maxShow} lainnya</div>`:'');
    };
    const chips = (rows, cls) => rows.length ? rows.map(([k,v])=>`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}">${escapeHtml(k)}<span class="opacity-70">×${v}</span></span>`).join(' ') : '<span class="text-xs text-slate-400 italic">—</span>';

    // Ringkasan naratif
    let summary = '';
    if(!total){
        summary = `Tidak ada laporan kerusakan untuk ${label} <b>${escapeHtml(type)}</b> pada filter yang sedang aktif.`;
    } else {
        const topDmg = byDmg[0], topLok = byLok[0];
        summary = `Terdapat <b>${total} laporan</b> kerusakan pada ${label} <b>${escapeHtml(type)}</b>`
            + (byUnit.length?` yang melibatkan <b>${byUnit.length} unit</b>`:'')
            + ` di <b>${byLok.length} lokasi</b>`
            + (byDiv.length?` (${byDiv.map(([k,v])=>`${escapeHtml(k)} ${v}`).join(', ')})`:'')
            + `. `
            + (topDmg?`Kerusakan paling sering: <b>${escapeHtml(topDmg[0])}</b> (${topDmg[1]}×${total>1?`, ${Math.round(topDmg[1]/total*100)}%`:''})`:'')
            + (topLok?`; lokasi paling sering: <b>${escapeHtml(topLok[0])}</b> (${topLok[1]}×)`:'') + `. `
            + `<b>${pending}</b> laporan belum ditangani, <b>${total-pending}</b> dalam proses (sudah ada nomor PR)`
            + (bySp.length?`. Sparepart yang paling dibutuhkan: <b>${escapeHtml(bySp[0][0])}</b>`:'') + `.`
            + (dates.length?` Rentang laporan: ${fmtDateShort(dates[0])}${dates.length>1?` – ${fmtDateShort(dates[dates.length-1])}`:''}.`:'');
    }

    const rowsHtml = [...items].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)).map(d=>`
        <tr class="border-b border-slate-100 last:border-0">
            <td class="py-1.5 pr-2 whitespace-nowrap text-slate-600">${fmtDateShort(d.timestamp)}</td>
            <td class="py-1.5 pr-2 font-semibold text-blue-700">${escapeHtml(d.lokasi)}</td>
            <td class="py-1.5 pr-2 text-slate-600">${escapeHtml(d.divisi)}</td>
            <td class="py-1.5 pr-2 font-mono text-slate-700">${d[cf]&&d[cf]!=='-'?escapeHtml(d[cf]):'—'}</td>
            <td class="py-1.5 pr-2 text-slate-800">${escapeHtml(d.damageType||'-')}${d.keterangan?`<div class="text-[10px] text-slate-500">${escapeHtml(d.keterangan)}</div>`:''}</td>
            <td class="py-1.5 pr-2 text-slate-600">${d.sparepart&&d.sparepart!=='-'?escapeHtml(d.sparepart):'<span class="text-slate-400 italic">—</span>'}</td>
            <td class="py-1.5 whitespace-nowrap">${d.status==='Proses'?`<span class="status-badge bg-amber-100 text-amber-700">Proses${d.prNumber?` · ${escapeHtml(d.prNumber)}`:''}</span>`:'<span class="status-badge bg-slate-100 text-slate-700">Belum</span>'}</td>
        </tr>`).join('');

    const lokDmgHtml = Object.entries(lokDmg).sort((a,b)=>Object.values(b[1]).reduce((x,y)=>x+y,0)-Object.values(a[1]).reduce((x,y)=>x+y,0)).map(([l,m])=>`
        <div class="flex items-start gap-2 text-xs py-1 border-b border-slate-100 last:border-0">
            <span class="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-semibold whitespace-nowrap"><i class="fas fa-map-marker-alt text-[9px]"></i>${escapeHtml(l)}</span>
            <div class="flex flex-wrap gap-1">${Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span class="px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-[10px] font-semibold">${escapeHtml(k)}${v>1?` ×${v}`:''}</span>`).join('')}</div>
        </div>`).join('');

    modal.querySelector('.modal').innerHTML = `
        <div class="p-5 text-white" style="background:linear-gradient(135deg,${color},${shade(color,-25)})">
            <div class="flex items-start justify-between gap-3">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-xl"><i class="fas ${isEng?'fa-oil-can':'fa-spray-can'}"></i></div>
                    <div>
                        <div class="text-[10px] uppercase tracking-widest font-semibold opacity-80">Detail Jenis ${label}</div>
                        <h3 class="display-font font-bold text-2xl leading-tight">${escapeHtml(type)}</h3>
                        <div class="text-[11px] opacity-80 mt-0.5">Berdasarkan data spreadsheet · filter aktif: ${escapeHtml(document.getElementById('activePeriodText')?document.getElementById('activePeriodText').textContent:'Semua data')}</div>
                    </div>
                </div>
                <button onclick="closeModal('typeDetailModal')" class="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 flex items-center justify-center"><i class="fas fa-times"></i></button>
            </div>
            <div class="grid grid-cols-4 gap-2 mt-4">
                ${[['Laporan',total],['Unit',byUnit.length],['Lokasi',byLok.length],['Belum ditangani',pending]].map(([k,v])=>`<div class="bg-white/15 rounded-lg p-2 text-center"><div class="stat-number text-xl">${v}</div><div class="text-[9px] uppercase font-semibold opacity-80">${k}</div></div>`).join('')}
            </div>
        </div>
        <div class="p-5 space-y-5">
            <div class="bg-slate-50 border border-slate-100 rounded-xl p-4 text-sm text-slate-700 leading-relaxed"><i class="fas fa-circle-info mr-1" style="color:${color}"></i>${summary}</div>
            ${total?`
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="card p-4"><h4 class="text-xs font-bold text-slate-800 mb-3"><i class="fas fa-map-marker-alt text-blue-500 mr-1"></i>Lokasi kerusakan</h4>${bar(byLok,'#2563eb')}</div>
                <div class="card p-4"><h4 class="text-xs font-bold text-slate-800 mb-3"><i class="fas fa-triangle-exclamation text-red-500 mr-1"></i>Jenis kerusakan</h4>${bar(byDmg,'#ef4444')}</div>
                <div class="card p-4"><h4 class="text-xs font-bold text-slate-800 mb-3"><i class="fas fa-hashtag mr-1" style="color:${color}"></i>Unit terdampak</h4>${bar(byUnit,color)}</div>
                <div class="card p-4"><h4 class="text-xs font-bold text-slate-800 mb-3"><i class="fas fa-cog text-amber-500 mr-1"></i>Sparepart dibutuhkan</h4>${bar(bySp,'#f59e0b')}</div>
            </div>
            <div class="card p-4">
                <h4 class="text-xs font-bold text-slate-800 mb-2"><i class="fas fa-sitemap text-slate-500 mr-1"></i>Kerusakan per lokasi</h4>
                ${lokDmgHtml}
            </div>
            <div class="card p-4">
                <div class="flex items-center justify-between mb-2">
                    <h4 class="text-xs font-bold text-slate-800"><i class="fas fa-list text-slate-500 mr-1"></i>Daftar laporan (${total})</h4>
                    <div class="flex gap-1 flex-wrap">${chips(byDiv,'bg-slate-100 text-slate-700')}</div>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-xs">
                        <thead><tr class="text-[10px] uppercase text-slate-400 border-b border-slate-200"><th class="text-left py-1.5 pr-2">Tanggal</th><th class="text-left py-1.5 pr-2">Lokasi</th><th class="text-left py-1.5 pr-2">Divisi</th><th class="text-left py-1.5 pr-2">Kode</th><th class="text-left py-1.5 pr-2">Kerusakan</th><th class="text-left py-1.5 pr-2">Sparepart</th><th class="text-left py-1.5">Status</th></tr></thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </div>`:''}
        </div>`;
    openModal('typeDetailModal');
}
function renderUnitDetailGrid(gridId, byUnit, colorMap, defaultColor, codeLabel){
    const g = document.getElementById(gridId);
    if(!g) return;
    const units = Object.values(byUnit).sort((a,b)=>b.total-a.total);
    if(!units.length){ g.innerHTML=`<div class="card p-10 col-span-full text-center text-slate-400 text-sm italic"><i class="fas fa-inbox text-4xl mb-2 block text-slate-200"></i>Tidak ada data unit pada filter ini</div>`; return; }
    // Batasi yang ditampilkan; unit dengan >=2 laporan selalu tampil, sisanya top 12
    const freq = units.filter(u=>u.total>=2);
    const rest = units.filter(u=>u.total<2).slice(0,12);
    const show = freq.length?freq.concat(rest.length?rest:[]).slice(0,24):units.slice(0,12);
    const maxV = units[0].total;
    g.innerHTML = show.map((u,idx)=>{
        const color = colorMap[u.type]||defaultColor;
        const pctP = Math.round(u.pending/u.total*100);
        const sev = severityBadge(pctP);
        const topLoc = Object.entries(u.locMap).sort((a,b)=>b[1]-a[1]).slice(0,3);
        const topDmg = Object.entries(u.dmgMap).sort((a,b)=>b[1]-a[1]).slice(0,3);
        const topSp = Object.entries(u.spMap).sort((a,b)=>b[1]-a[1]).slice(0,3);
        const divs = Object.entries(u.divMap).sort((a,b)=>b[1]-a[1]);
        const latest = u.latest;
        const firstDt = fmtDateShort(u.firstSeen.timestamp);
        const lastDt = fmtDateShort(latest.timestamp);
        return `<div class="card p-4 card-hover">
            <div class="flex items-start justify-between gap-2 mb-3">
                <div class="flex items-center gap-2 min-w-0">
                    <div class="w-10 h-10 rounded-lg flex items-center justify-center text-white text-xs flex-shrink-0 font-bold" style="background:${color}">${escapeHtml(u.type)}</div>
                    <div class="min-w-0">
                        <div class="flex items-center gap-1.5">
                            <h4 class="font-bold text-slate-900 text-base leading-tight">${codeLabel} <span class="font-mono" style="color:${color}">${escapeHtml(u.code)}</span></h4>
                            <span class="text-[9px] font-bold px-1.5 py-0.5 rounded ${sev.cls}"><i class="fas ${sev.icon} text-[5px] mr-0.5"></i>${sev.label}</span>
                        </div>
                        <div class="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mt-0.5">Jenis ${escapeHtml(u.type)} · ${divs.map(x=>x[0]).join('/')||'-'}</div>
                    </div>
                </div>
                <div class="flex flex-col items-end flex-shrink-0">
                    <span class="stat-number text-2xl" style="color:${color}">${u.total}</span>
                    <span class="text-[9px] text-slate-400 font-semibold uppercase">laporan</span>
                </div>
            </div>
            <!-- Progress -->
            <div class="mb-3">
                <div class="flex justify-between text-[10px] font-semibold text-slate-500 mb-1">
                    <span>${u.pending} belum · ${u.proses} proses</span>
                    <span>${pctP}% tertunda</span>
                </div>
                <div class="pbar"><span style="width:${pctP}%;background:${pctP>60?'#ef4444':pctP>30?'#f59e0b':'#10b981'}"></span></div>
                <div class="text-[10px] text-slate-400 mt-1"><i class="far fa-calendar mr-0.5"></i>${firstDt === lastDt ? lastDt : firstDt+' → '+lastDt}</div>
            </div>
            <!-- 3 kolom info -->
            <div class="grid grid-cols-3 gap-2 mb-3">
                <div>
                    <div class="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1"><i class="fas fa-map-pin mr-0.5 text-red-400"></i>Lokasi</div>
                    <div class="flex flex-wrap gap-1">
                        ${topLoc.length?topLoc.map(([l,c])=>`<span class="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">${escapeHtml(l)}<span class="text-slate-400 ml-0.5">×${c}</span></span>`).join(''):'<span class="text-[10px] text-slate-400 italic">—</span>'}
                    </div>
                </div>
                <div>
                    <div class="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1"><i class="fas fa-triangle-exclamation mr-0.5 text-purple-400"></i>Kerusakan</div>
                    <div class="flex flex-wrap gap-1">
                        ${topDmg.length?topDmg.map(([k,c])=>`<span class="bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">${escapeHtml(k)}<span class="text-purple-400 ml-0.5">×${c}</span></span>`).join(''):'<span class="text-[10px] text-slate-400 italic">—</span>'}
                    </div>
                </div>
                <div>
                    <div class="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1"><i class="fas fa-cog mr-0.5 text-amber-400"></i>Sparepart</div>
                    <div class="flex flex-wrap gap-1">
                        ${topSp.length?topSp.map(([s,c])=>`<span class="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">${escapeHtml(s.length>14?s.slice(0,13)+'…':s)}<span class="text-amber-400 ml-0.5">×${c}</span></span>`).join(''):'<span class="text-[10px] text-slate-400 italic">—</span>'}
                    </div>
                </div>
            </div>
            <!-- Detail laporan terbaru -->
            <details class="group">
                <summary class="text-[11px] font-semibold cursor-pointer list-none flex items-center gap-1" style="color:${color}"><i class="fas fa-chevron-right text-[9px] group-open:rotate-90 transition"></i>Detail ${u.items.length} laporan</summary>
                <div class="mt-2 space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    ${u.items.slice().sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)).slice(0,10).map(d=>{
                        const sb = d.status==='Proses'
                            ? '<span class="status-badge bg-amber-100 text-amber-700"><i class="fas fa-circle text-[6px]"></i>Proses</span>'
                            : '<span class="status-badge bg-slate-100 text-slate-700"><i class="fas fa-circle text-[6px]"></i>Belum</span>';
                        return `<div class="p-2 rounded-lg bg-slate-50 text-[11px] border-l-2" style="border-color:${color}">
                            <div class="flex items-center justify-between mb-0.5">
                                <span class="font-semibold text-slate-700">${d.lokasi} · ${d.divisi}</span>
                                <span class="text-[9px] text-slate-400">${fmtDateShort(d.timestamp)}</span>
                            </div>
                            <div class="text-slate-800 font-medium mb-0.5">${escapeHtml(d.damageType||'-')}</div>
                            ${d.keterangan?`<div class="text-slate-600 mb-0.5">${escapeHtml(d.keterangan)}</div>`:''}
                            <div class="flex items-center gap-1.5 flex-wrap">
                                ${sb}
                                ${d.sparepart&&d.sparepart!=='-'?`<span class="text-amber-700 text-[10px]"><i class="fas fa-cog text-[8px]"></i> ${escapeHtml(d.sparepart)}</span>`:''}
                                ${d.prNumber?`<span class="text-blue-700 text-[10px]"><i class="fas fa-file-invoice text-[8px]"></i> PR ${d.prNumber}</span>`:''}
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </details>
        </div>`;
    }).join('');
}
// Utility: gelapkan/terangin hex
function shade(hex,pct){
    let c=hex.replace('#','');
    if(c.length===3) c=c.split('').map(x=>x+x).join('');
    const num=parseInt(c,16);
    let r=(num>>16)+Math.round(255*pct/100);
    let g=((num>>8)&0xff)+Math.round(255*pct/100);
    let b=(num&0xff)+Math.round(255*pct/100);
    r=Math.max(0,Math.min(255,r)); g=Math.max(0,Math.min(255,g)); b=Math.max(0,Math.min(255,b));
    return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
}

function renderEngineTab(){
    const typeCards = document.getElementById('engineTypeCards');
    if(!typeCards) return;
    // Filter data yang punya engine info
    const engData = filteredData.filter(d=>d.engineType&&d.engineType!=='-'&&d.engineCode&&d.engineCode!=='-');
    document.getElementById('engTotalTypes').textContent = new Set(engData.map(d=>d.engineType)).size;
    document.getElementById('engTotalUnits').textContent = new Set(engData.map(d=>`${d.engineType} ${d.engineCode}`)).size;
    document.getElementById('engTotalReports').textContent = engData.length;
    renderUnitTypeCards('engineTypeCards', engData, 'engineType', ENG_COLORS, '#f97316', 'fa-oil-can', 'Belum ada data mesin pada filter ini');
    const byUnit = aggregateByUnit('engineType','engineCode',filteredData);
    renderUnitDetailGrid('engineDetailGrid', byUnit, ENG_COLORS, '#f97316', 'Kode');
}
function renderIrrTab(){
    const typeCards = document.getElementById('irrTypeCards');
    if(!typeCards) return;
    const irrData = filteredData.filter(d=>d.irrType&&d.irrType!=='-'&&d.irrCode&&d.irrCode!=='-');
    document.getElementById('irrTotalTypes').textContent = new Set(irrData.map(d=>d.irrType)).size;
    document.getElementById('irrTotalUnits').textContent = new Set(irrData.map(d=>`${d.irrType} ${d.irrCode}`)).size;
    document.getElementById('irrTotalReports').textContent = irrData.length;
    renderUnitTypeCards('irrTypeCards', irrData, 'irrType', IRR_COLORS, '#ec4899', 'fa-spray-can', 'Belum ada data irigator pada filter ini');
    const byUnit = aggregateByUnit('irrType','irrCode',filteredData);
    renderUnitDetailGrid('irrDetailGrid', byUnit, IRR_COLORS, '#ec4899', 'Kode');
}

// ---------- Calendar ----------
function renderCalendar() {
    const grid=document.getElementById('calendarGrid');
    if(!grid) return;
    const monthNames=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const cm = document.getElementById('calMonthYear'); if(cm) cm.textContent=`${monthNames[state.calMonth.getMonth()]} ${state.calMonth.getFullYear()}`;
    const byDate={};
    rawData.forEach(d=>{byDate[d.tanggalInspeksi]=(byDate[d.tanggalInspeksi]||0)+1;});
    const first=new Date(state.calMonth.getFullYear(),state.calMonth.getMonth(),1);
    const firstWeekday=(first.getDay()+6)%7;
    const daysInMonth=new Date(state.calMonth.getFullYear(),state.calMonth.getMonth()+1,0).getDate();
    const daysInPrev=new Date(state.calMonth.getFullYear(),state.calMonth.getMonth(),0).getDate();
    const todayIso=isoDate(new Date());
    const wd = ['Sen','Sel','Rab','Kam','Jum','Sab','Min'];
    let html=wd.map(w=>`<div class="cal-wd">${w}</div>`).join('');
    for(let i=firstWeekday-1;i>=0;i--) html+=`<div class="cal-day other-month">${daysInPrev-i}</div>`;
    for(let d=1;d<=daysInMonth;d++){
        const date=new Date(state.calMonth.getFullYear(),state.calMonth.getMonth(),d);
        const iso=isoDate(date);
        const count=byDate[iso]||0;
        let cls='cal-day';
        if(count>0) cls+=' has-data';
        if(count>=3) cls+=' has-many';
        if(iso===todayIso) cls+=' today';
        if(iso===state.selectedDate) cls+=' selected';
        html+=`<div class="${cls}" onclick="selectDate('${iso}')" title="${count?count+' laporan':'Tidak ada laporan'}">${d}${count>0?'<span class="cal-dot"></span>':''}</div>`;
    }
    const totalCells=firstWeekday+daysInMonth;
    const nextCells=(7-(totalCells%7))%7;
    for(let i=1;i<=nextCells;i++) html+=`<div class="cal-day other-month">${i}</div>`;
    grid.innerHTML=html;
}
function changeCalMonth(delta){
    state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth()+delta, 1);
    renderCalendar();
}
function goToday(){
    state.calMonth = new Date(); state.calMonth.setDate(1);
    clearSelectedDate();
}
function selectDate(iso){
    if(state.selectedDate===iso){
        clearSelectedDate();
        return;
    }
    state.selectedDate=iso;
    state.page=1;
    const df=document.getElementById('dateFrom');if(df)df.value=iso;
    const dt=document.getElementById('dateTo');if(dt)dt.value=iso;
    state.period='custom';
    state.dateFrom=iso; state.dateTo=iso;
    state.calMonth=new Date(iso+'T00:00:00');
    state.calMonth.setDate(1);
    document.querySelectorAll('.filter-btn').forEach(b=>{b.classList.remove('active');b.classList.add('text-slate-600');});
    renderCalendar();
    applyFilters();
}
function renderCalDayDetail(){
    const box=document.getElementById('calDayDetail');
    const label=document.getElementById('calDateLabel');
    if(!box) return;
    if(!state.selectedDate){
        label.textContent=`${rawData.length} total laporan`;
        const byDate={};
        rawData.forEach(d=>{byDate[d.tanggalInspeksi]=(byDate[d.tanggalInspeksi]||0)+1;});
        const recent = Object.entries(byDate).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,10);
        box.innerHTML = `<div class="text-xs text-slate-500 mb-3"><i class="fas fa-clock-rotate-left mr-1"></i>Laporan terbaru:</div>` +
            recent.map(([dt,c])=>`
            <div onclick="selectDate('${dt}')" class="flex items-center justify-between p-2.5 rounded-lg hover:bg-blue-50 cursor-pointer transition border border-slate-100 mb-1.5">
                <div class="flex items-center gap-2">
                    <i class="fas fa-calendar-day text-blue-500 text-sm"></i>
                    <span class="text-sm font-medium text-slate-700">${new Date(dt).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})}</span>
                </div>
                <span class="bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">${c}</span>
            </div>`).join('');
        return;
    }
    const items=rawData.filter(d=>d.tanggalInspeksi===state.selectedDate);
    label.textContent=`${fmtDate(state.selectedDate)} · ${items.length} laporan`;
    if(items.length===0){
        box.innerHTML=`<div class="text-center py-10 text-slate-400 text-sm"><i class="fas fa-calendar-check text-3xl mb-2 text-emerald-300"></i><p>Tidak ada laporan<br>di tanggal ini ✓</p></div>`;
        return;
    }
    box.innerHTML=items.map(d=>{
        const badge=d.status==='Proses'
            ?'<span class="status-badge bg-amber-100 text-amber-700"><i class="fas fa-circle text-[6px]"></i>Proses</span>'
            :'<span class="status-badge bg-slate-100 text-slate-700"><i class="fas fa-circle text-[6px]"></i>Belum</span>';
        return `<div class="border border-slate-200 rounded-lg p-3 hover:bg-slate-50 transition">
            <div class="flex items-start justify-between gap-2 mb-1">
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-semibold"><i class="fas fa-map-marker-alt text-[9px]"></i>${d.lokasi}</span>
                    <span class="text-[10px] text-slate-400">${d.divisi}</span>
                </div>
                ${badge}
            </div>
            <div class="text-sm font-semibold text-slate-800 mb-1">${d.damageType||'-'}</div>
            ${d.keterangan?`<div class="text-xs text-slate-500 mb-1.5">${escapeHtml(d.keterangan)}</div>`:''}
            <div class="flex flex-wrap gap-2 text-[11px]">
                ${d.sparepart&&d.sparepart!=='-'?`<span class="inline-flex items-center gap-1 text-amber-700"><i class="fas fa-cog text-[9px]"></i>${escapeHtml(d.sparepart)}</span>`:''}
                ${d.engine&&d.engine!=='-'?`<span class="inline-flex items-center gap-1 text-slate-500"><i class="fas fa-oil-can text-[9px]"></i>${escapeHtml(d.engine)}</span>`:''}
                ${d.irrigator&&d.irrigator!=='-'?`<span class="inline-flex items-center gap-1 text-slate-500"><i class="fas fa-spray-can text-[9px]"></i>${escapeHtml(d.irrigator)}</span>`:''}
                ${d.prNumber?`<span class="inline-flex items-center gap-1 text-blue-700"><i class="fas fa-file-invoice text-[9px]"></i>PR ${d.prNumber}</span>`:''}
            </div>
        </div>`;
    }).join('');
}

// ---------- Table ----------
function renderTable(){
    const tbody=document.getElementById('tableBody');
    if(!tbody) return;
    const ls = document.getElementById('loadingState'); if(ls) ls.classList.add('hidden');
    const sorted=[...filteredData].sort((a,b)=>{
        let av=a[state.sortField],bv=b[state.sortField];
        if(state.sortField==='timestamp'){av=new Date(av).getTime();bv=new Date(bv).getTime();}
        av=String(av||'').toLowerCase();bv=String(bv||'').toLowerCase();
        if(av<bv)return state.sortDir==='asc'?-1:1;
        if(av>bv)return state.sortDir==='asc'?1:-1;
        return 0;
    });
    const totalPages=Math.max(1,Math.ceil(sorted.length/state.pageSize));
    if(state.page>totalPages)state.page=totalPages;
    const start=(state.page-1)*state.pageSize;
    const page=sorted.slice(start,start+state.pageSize);
    const es = document.getElementById('emptyState'); if(es) es.classList.toggle('hidden',sorted.length!==0);
    const dtc = document.getElementById('dataTableCount'); if(dtc) dtc.textContent = sorted.length;

    tbody.innerHTML=page.map(d=>{
        const sb=d.status==='Proses'
            ?'<span class="status-badge bg-amber-100 text-amber-700"><i class="fas fa-circle text-[6px]"></i>Proses (PR Aktif)</span>'
            :'<span class="status-badge bg-slate-100 text-slate-700"><i class="fas fa-circle text-[6px]"></i>Belum Ditangani</span>';
        const engCell=d.engine&&d.engine!=='-' ? `<div class="font-medium text-slate-700 text-xs">${escapeHtml(d.engine)}</div>` : '<span class="text-slate-400 italic text-xs">—</span>';
        const irrCell=d.irrigator&&d.irrigator!=='-' ? `<div class="font-medium text-slate-700 text-xs">${escapeHtml(d.irrigator)}</div>` : '<span class="text-slate-400 italic text-xs">—</span>';
        return `<tr class="table-row transition">
            <td class="px-4 py-3 whitespace-nowrap">
                <div class="font-medium text-slate-800 text-xs">${new Date(d.timestamp).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})}</div>
            </td>
            <td class="px-4 py-3">
                <span class="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-semibold"><i class="fas fa-map-marker-alt text-[9px]"></i>${escapeHtml(d.lokasi)}</span>
            </td>
            <td class="px-4 py-3"><span class="text-xs text-slate-600 bg-slate-50 px-2 py-0.5 rounded">${escapeHtml(d.divisi)}</span></td>
            <td class="px-4 py-3">${engCell}</td>
            <td class="px-4 py-3">${irrCell}</td>
            <td class="px-4 py-3"><span class="font-medium text-slate-800 text-xs">${escapeHtml(d.damageType||'-')}</span></td>
            <td class="px-4 py-3 text-xs text-slate-600 max-w-[200px]">${d.keterangan?escapeHtml(d.keterangan):'<span class="text-slate-400 italic">-</span>'}</td>
            <td class="px-4 py-3 text-xs text-slate-700 max-w-[220px]">${d.sparepart!=='-'?escapeHtml(d.sparepart):'<span class="text-slate-400 italic">Belum ditentukan</span>'}</td>
            <td class="px-4 py-3 text-xs">${d.prNumber?`<span class="font-mono font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">${d.prNumber}</span>`:'<span class="text-slate-400 italic">—</span>'}</td>
            <td class="px-4 py-3 whitespace-nowrap">${sb}</td>
            <td class="px-3 py-3">
                <div class="row-actions">
                    <button class="act-btn edit" title="Edit laporan" onclick="openEditModal(${filteredData.indexOf(d)})"><i class="fas fa-pen"></i></button>
                    <button class="act-btn del" title="Hapus laporan" onclick="openDeleteModal(${filteredData.indexOf(d)})"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');

    const tc=document.getElementById('tableCount'); if(tc) tc.textContent=`Menampilkan ${page.length} dari ${sorted.length} data`;
    const pi=document.getElementById('pageInfo'); if(pi) pi.textContent=`Halaman ${state.page} / ${totalPages}`;
    const pb=document.getElementById('prevBtn'); if(pb) pb.disabled=state.page===1;
    const nb=document.getElementById('nextBtn'); if(nb) nb.disabled=state.page===totalPages;
}
function sortTable(field){
    if(state.sortField===field)state.sortDir=state.sortDir==='asc'?'desc':'asc';
    else{state.sortField=field;state.sortDir=field==='timestamp'?'desc':'asc';}
    renderTable();
}
function prevPage(){if(state.page>1){state.page--;renderTable();}}
function nextPage(){const tp=Math.ceil(filteredData.length/state.pageSize);if(state.page<tp){state.page++;renderTable();}}

// ======================================================
// TINGKAT KERUSAKAN / KEPARAHAN
// Klasifikasi berbasis aturan (kata kunci) dari Jenis Kerusakan + Keterangan
// Kerusakan di spreadsheet. Ubah daftar kata kunci di bawah bila perlu.
// ======================================================
const SEVERITY_RULES = {
    // Berat: unit berhenti total / komponen utama patah / perlu overhaul
    Berat: {
        weight: 3, color:'#dc2626', bg:'bg-red-50', text:'text-red-700',
        keywords: ['patah','pecah','jebol','ngancing','ngejam','macet','mati','nggak start','gak start','tidak start','tidak hidup','tidak bisa','terbakar','hangus','overheat','overhaul','rusak berat','hancur','putus','bubut','pompa rusak','kemasukan','as krek','crank'],
        damageTypes: ['Blok Mesin','Gearbox','Transmisi','Radiator']
    },
    // Sedang: unit masih jalan tapi performa turun / bocor / komponen aus / komponen rusak
    Sedang: {
        weight: 2, color:'#f59e0b', bg:'bg-amber-50', text:'text-amber-700',
        keywords: ['bocor','rembes','aus','habis','getar','panas','lemah','kecil','debit','rusak','ganti','kotor','kopling','bearing','seal','packing'],
        damageTypes: ['Turbin','Dinamo','Pompa Ebara','Prodo','Pompa Sumur Bor','RPM','Selang']
    },
    // Ringan: sambungan lepas, penyetelan, kelengkapan kecil
    Ringan: {
        weight: 1, color:'#10b981', bg:'bg-emerald-50', text:'text-emerald-700',
        keywords: ['lepas','kendor','longgar','klem','baut','setel','stel','ganti oli','filter','lampu','kabel'],
        damageTypes: ['Pipa PE','Gun','Rantai']
    }
};
const SEVERITY_ORDER = ['Berat','Sedang','Ringan'];
const __sevCache = new WeakMap();

function assetCategory(d){
    if(d.engineType && d.engineType!=='-') return 'Engine';
    if(d.irrType && d.irrType!=='-') return 'Irigator';
    if(/pompa|sumur/i.test(d.damageType||'')) return 'Pompa Sumur';
    return 'Lainnya';
}
function daysSince(ts){ const t=new Date(ts); if(isNaN(t)) return 0; return Math.max(0, Math.floor((startOfDay(new Date())-startOfDay(t))/86400000)); }

function classifySeverity(d){
    if(__sevCache.has(d)) return __sevCache.get(d);
    // Hanya KETERANGAN yang dipakai untuk kata kunci (bukan nama jenis), supaya
    // "Transmisi – kampas rem habis" tidak otomatis Berat hanya karena kata "transmisi".
    const text = String(d.keterangan||'').toLowerCase();
    const reasons=[]; let level=null;
    // 1) Kata kunci keterangan, dicek dari yang paling berat
    for(const lv of SEVERITY_ORDER){
        const hit = SEVERITY_RULES[lv].keywords.find(k=>text.includes(k));
        if(hit){ level=lv; reasons.push(`kata kunci "${hit}"`); break; }
    }
    // 2) Fallback: jenis kerusakan
    if(!level){
        for(const lv of SEVERITY_ORDER){
            if(SEVERITY_RULES[lv].damageTypes.some(t=>t.toLowerCase()===(d.damageType||'').toLowerCase())){ level=lv; reasons.push(`jenis "${d.damageType}"`); break; }
        }
    }
    if(!level){ level='Sedang'; reasons.push('tidak ada kata kunci cocok → default Sedang'); }
    // Penyesuaian: keterangan "lepas/kendor" pada jenis berat tetap turun satu tingkat sudah tertangani oleh urutan keyword.
    __sevCache.set(d,{level,reasons});
    return __sevCache.get(d);
}

// Skor prioritas 0–100: tingkat (maks 60) + umur belum ditangani (maks 25) + pengulangan (maks 15)
function priorityScore(d, recurCount){
    const {level} = classifySeverity(d);
    const w = SEVERITY_RULES[level].weight;           // 1..3
    let score = w*20;                                  // 20/40/60
    const age = daysSince(d.timestamp);
    const agePts = Math.min(25, age*2.5);              // +2.5/hari maks 25
    score += d.status==='Belum Ditangani' ? agePts : agePts*0.4;
    score += Math.min(15, Math.max(0,(recurCount||1)-1)*7.5);
    if(d.status==='Proses') score -= 10;               // sudah ada PR
    return Math.round(Math.max(0,Math.min(100,score)));
}

let sevLevelFilterState = '';
let __sevChartData = null;
function renderSeverityCharts(){
    dk('severity'); dk('severityAsset');
    if(!__sevChartData) return;
    const {byLv, rows, total} = __sevChartData;
    const dEl=document.getElementById('severityChart');
    if(dEl && isElVisible(dEl) && total){
        charts.severity = new Chart(dEl.getContext('2d'),{type:'doughnut',data:{labels:SEVERITY_ORDER,datasets:[{data:SEVERITY_ORDER.map(l=>byLv[l]),backgroundColor:SEVERITY_ORDER.map(l=>SEVERITY_RULES[l].color),borderWidth:0,hoverOffset:6}]},options:mkDoughnutOpts()});
    }
    const aEl=document.getElementById('severityAssetChart');
    if(aEl && isElVisible(aEl) && total){
        const assets=['Engine','Irigator','Pompa Sumur','Lainnya'].filter(a=>rows.some(r=>r.asset===a));
        charts.severityAsset = new Chart(aEl.getContext('2d'),{type:'bar',data:{labels:assets,datasets:SEVERITY_ORDER.map(lv=>({label:lv,data:assets.map(a=>rows.filter(r=>r.asset===a&&r.level===lv).length),backgroundColor:SEVERITY_RULES[lv].color,stack:'s',borderRadius:4,maxBarThickness:56}))},options:mkOpts(false,{plugins:{legend:{display:true,position:'top',labels:{boxWidth:10,font:{size:10}}}},scales:{x:{stacked:true,grid:{display:false},ticks:{color:TICK_COLOR,font:{size:10}},border:{display:false}},y:{stacked:true,grid:{color:GRID_COLOR},ticks:{color:TICK_COLOR,font:{size:10},precision:0},border:{display:false},beginAtZero:true}}})});
    }
}
function toggleSeverityInfo(){
    const el=document.getElementById('severityInfo'); if(!el) return;
    el.classList.toggle('hidden');
    if(!el.classList.contains('hidden')){
        el.innerHTML = `
            <p class="font-bold text-slate-800">Cara penilaian (otomatis dari teks di spreadsheet)</p>
            <ol class="list-decimal list-inside space-y-1">
                <li><b>Tingkat</b> ditentukan dari <i>Keterangan Kerusakan</i> + <i>Jenis Kerusakan</i>, dicek dari yang paling berat:
                    ${SEVERITY_ORDER.map(lv=>`<div class="ml-4 mt-1"><span class="px-2 py-0.5 rounded-full ${SEVERITY_RULES[lv].bg} ${SEVERITY_RULES[lv].text} font-semibold">${lv}</span> <span class="text-slate-500">${SEVERITY_RULES[lv].keywords.join(', ')}</span></div>`).join('')}
                    <div class="ml-4 mt-1 text-slate-500">Bila tidak ada kata kunci, dipakai jenis kerusakan; bila tetap tidak ada → <b>Sedang</b>.</div>
                </li>
                <li><b>Skor prioritas (0–100)</b> = tingkat (20/40/60) + umur laporan belum ditangani (2,5 poin/hari, maks 25) + pengulangan pada unit/lokasi yang sama (7,5 poin/laporan tambahan, maks 15) − 10 bila sudah ada nomor PR.</li>
                <li>Kategori aset: <b>Engine</b> bila ada jenis engine, <b>Irigator</b> bila ada jenis irigator, <b>Pompa Sumur</b> bila jenis kerusakan menyebut pompa/sumur, sisanya <b>Lainnya</b>.</li>
            </ol>
            <p class="text-slate-500">Daftar kata kunci dapat disesuaikan di <code class="bg-slate-100 px-1 rounded">app.js → SEVERITY_RULES</code>.</p>`;
    }
}

function renderSeverityTab(){
    const kp = document.getElementById('sevKpis'); if(!kp) return;
    const data = filteredData;
    // Pengulangan: key unit (jenis+kode) jika ada, jika tidak lokasi+jenis kerusakan
    const recKey = d => (d.engineCode&&d.engineCode!=='-'&&d.engineType!=='-') ? `E:${d.engineType} ${d.engineCode}`
                      : (d.irrCode&&d.irrCode!=='-'&&d.irrType!=='-') ? `I:${d.irrType} ${d.irrCode}`
                      : `L:${d.lokasi}|${d.damageType}`;
    const rec = {}; data.forEach(d=>{ const k=recKey(d); (rec[k]=rec[k]||[]).push(d); });
    const rows = data.map(d=>{ const c=classifySeverity(d); const n=rec[recKey(d)].length; return {d, level:c.level, reasons:c.reasons, recur:n, score:priorityScore(d,n), age:daysSince(d.timestamp), asset:assetCategory(d)}; });
    const byLv = {Berat:0,Sedang:0,Ringan:0}; rows.forEach(r=>byLv[r.level]++);
    const pendingRows = rows.filter(r=>r.d.status==='Belum Ditangani');
    const avgAge = pendingRows.length ? Math.round(pendingRows.reduce((a,r)=>a+r.age,0)/pendingRows.length) : 0;
    const beratPending = pendingRows.filter(r=>r.level==='Berat').length;
    const total = rows.length;
    const idx = total ? (rows.reduce((a,r)=>a+SEVERITY_RULES[r.level].weight,0)/(total*3)*100) : 0;

    kp.innerHTML = [
        {l:'Indeks Keparahan', v:Math.round(idx)+'%', s:'rata-rata bobot (0–100%)', c:idx>=66?'text-red-600':idx>=45?'text-amber-600':'text-emerald-600', i:'fa-gauge'},
        {l:'Berat', v:byLv.Berat, s:`${beratPending} belum ditangani`, c:'text-red-600', i:'fa-triangle-exclamation'},
        {l:'Sedang', v:byLv.Sedang, s:total?Math.round(byLv.Sedang/total*100)+'% dari total':'-', c:'text-amber-600', i:'fa-circle-exclamation'},
        {l:'Ringan', v:byLv.Ringan, s:total?Math.round(byLv.Ringan/total*100)+'% dari total':'-', c:'text-emerald-600', i:'fa-circle-check'},
        {l:'Umur Rata-rata', v:avgAge+' hari', s:`${pendingRows.length} laporan belum ditangani`, c:avgAge>7?'text-red-600':'text-slate-800', i:'fa-hourglass-half'}
    ].map(k=>`<div class="card p-4"><div class="flex items-center justify-between mb-1"><span class="text-[10px] font-bold uppercase tracking-wider text-slate-500">${k.l}</span><i class="fas ${k.i} ${k.c} text-sm"></i></div><div class="stat-number text-2xl ${k.c}">${k.v}</div><div class="text-[11px] text-slate-500">${k.s}</div></div>`).join('');

    // Chart dirender di renderCharts() (agar tidak dihancurkan oleh siklus dk())
    __sevChartData = {byLv, rows, total};
    renderSeverityCharts();

    // Matriks jenis × tingkat
    const mx=document.getElementById('sevMatrix');
    if(mx){
        const types={}; rows.forEach(r=>{ const t=r.d.damageType||'-'; (types[t]=types[t]||{Berat:0,Sedang:0,Ringan:0,total:0}); types[t][r.level]++; types[t].total++; });
        const ents=Object.entries(types).sort((a,b)=>b[1].Berat-a[1].Berat||b[1].total-a[1].total);
        mx.innerHTML = ents.length ? `<table class="w-full text-xs"><thead><tr class="text-[10px] uppercase text-slate-400 border-b border-slate-200"><th class="text-left py-1.5">Jenis kerusakan</th>${SEVERITY_ORDER.map(l=>`<th class="text-center py-1.5" style="color:${SEVERITY_RULES[l].color}">${l}</th>`).join('')}<th class="text-center py-1.5">Total</th></tr></thead><tbody>${ents.map(([t,v])=>`<tr class="border-b border-slate-100 last:border-0"><td class="py-1.5 font-medium text-slate-700">${escapeHtml(t)}</td>${SEVERITY_ORDER.map(l=>`<td class="text-center py-1.5">${v[l]?`<span class="inline-block min-w-[24px] px-1.5 py-0.5 rounded font-bold ${SEVERITY_RULES[l].bg} ${SEVERITY_RULES[l].text}">${v[l]}</span>`:'<span class="text-slate-300">·</span>'}</td>`).join('')}<td class="text-center py-1.5 font-bold text-slate-800">${v.total}</td></tr>`).join('')}</tbody></table>` : '<div class="text-xs text-slate-400 italic">Tidak ada data</div>';
    }

    // Berulang
    const rc=document.getElementById('sevRecurring');
    if(rc){
        const groups=Object.entries(rec).filter(([k,v])=>v.length>=2).sort((a,b)=>b[1].length-a[1].length).slice(0,8);
        rc.innerHTML = groups.length ? groups.map(([k,v])=>{
            const label = k.startsWith('L:') ? `Lokasi ${k.slice(2).split('|')[0]} · ${k.slice(2).split('|')[1]}` : k.slice(2);
            const worst = SEVERITY_ORDER.find(l=>v.some(x=>classifySeverity(x).level===l));
            const loks=[...new Set(v.map(x=>x.lokasi))].join(', ');
            const dmgs=[...new Set(v.map(x=>x.damageType))].join(', ');
            return `<div class="flex items-start gap-2 p-2 rounded-lg border border-slate-100 bg-slate-50/60"><div class="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style="background:${SEVERITY_RULES[worst].color}">${v.length}×</div><div class="min-w-0 text-xs"><div class="font-bold text-slate-800 truncate">${escapeHtml(label)}</div><div class="text-[10px] text-slate-500">Lokasi: ${escapeHtml(loks)} · Kerusakan: ${escapeHtml(dmgs)}</div><div class="text-[10px] mt-0.5"><span class="px-1.5 py-0.5 rounded ${SEVERITY_RULES[worst].bg} ${SEVERITY_RULES[worst].text} font-semibold">Terberat: ${worst}</span> <span class="text-slate-500">${v.filter(x=>x.status==='Belum Ditangani').length} belum ditangani</span></div></div></div>`;
        }).join('') : '<div class="text-xs text-slate-400 italic py-4 text-center"><i class="fas fa-circle-check text-emerald-400 mr-1"></i>Tidak ada unit/lokasi dengan kerusakan berulang pada filter ini</div>';
    }

    // Tabel prioritas
    const tb=document.getElementById('sevTable');
    if(tb){
        const list = rows.filter(r=>!sevLevelFilterState||r.level===sevLevelFilterState).sort((a,b)=>b.score-a.score||b.age-a.age).slice(0,50);
        tb.innerHTML = `<thead><tr class="text-[10px] uppercase text-slate-400 border-b border-slate-200"><th class="text-left py-2 pr-2">#</th><th class="text-left py-2 pr-2">Prioritas</th><th class="text-left py-2 pr-2">Tingkat</th><th class="text-left py-2 pr-2">Tanggal</th><th class="text-left py-2 pr-2">Umur</th><th class="text-left py-2 pr-2">Lokasi</th><th class="text-left py-2 pr-2">Aset / Unit</th><th class="text-left py-2 pr-2">Kerusakan</th><th class="text-left py-2 pr-2">Sparepart</th><th class="text-left py-2 pr-2">Status</th><th class="text-left py-2">Alasan</th></tr></thead><tbody>${
            list.length ? list.map((r,i)=>{ const d=r.d, R=SEVERITY_RULES[r.level];
                const unit = d.engineType!=='-'&&d.engineType ? `Engine ${escapeHtml(d.engineType)} ${d.engineCode!=='-'?escapeHtml(d.engineCode):''}` : d.irrType!=='-'&&d.irrType ? `Irigator ${escapeHtml(d.irrType)} ${d.irrCode!=='-'?escapeHtml(d.irrCode):''}` : escapeHtml(r.asset);
                const sc = r.score>=70?'#dc2626':r.score>=45?'#f59e0b':'#10b981';
                return `<tr class="border-b border-slate-100 last:border-0 align-top"><td class="py-2 pr-2 text-slate-400">${i+1}</td><td class="py-2 pr-2"><div class="flex items-center gap-1.5"><div class="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div class="h-full" style="width:${r.score}%;background:${sc}"></div></div><b style="color:${sc}">${r.score}</b></div></td><td class="py-2 pr-2"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${R.bg} ${R.text}">${r.level}</span></td><td class="py-2 pr-2 whitespace-nowrap text-slate-600">${fmtDateShort(d.timestamp)}</td><td class="py-2 pr-2 whitespace-nowrap ${r.age>7&&d.status==='Belum Ditangani'?'text-red-600 font-bold':'text-slate-600'}">${r.age} hr</td><td class="py-2 pr-2"><span class="bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-semibold">${escapeHtml(d.lokasi)}</span><div class="text-[10px] text-slate-400">${escapeHtml(d.divisi)}</div></td><td class="py-2 pr-2 text-slate-700 whitespace-nowrap">${unit}${r.recur>1?`<div class="text-[10px] text-purple-600 font-semibold"><i class="fas fa-rotate mr-0.5"></i>${r.recur}× berulang</div>`:''}</td><td class="py-2 pr-2 text-slate-800"><b>${escapeHtml(d.damageType||'-')}</b>${d.keterangan?`<div class="text-[10px] text-slate-500">${escapeHtml(d.keterangan)}</div>`:''}</td><td class="py-2 pr-2 text-slate-600">${d.sparepart&&d.sparepart!=='-'?escapeHtml(d.sparepart):'<span class="text-slate-400 italic">—</span>'}</td><td class="py-2 pr-2 whitespace-nowrap">${d.status==='Proses'?`<span class="status-badge bg-amber-100 text-amber-700">Proses${d.prNumber?` · ${escapeHtml(d.prNumber)}`:''}</span>`:'<span class="status-badge bg-slate-100 text-slate-700">Belum</span>'}</td><td class="py-2 text-[10px] text-slate-500">${escapeHtml(r.reasons.join('; '))}</td></tr>`;
            }).join('') : '<tr><td colspan="11" class="py-6 text-center text-slate-400 italic">Tidak ada laporan pada tingkat ini</td></tr>'
        }</tbody>`;
    }
    const sub=document.getElementById('sevDonutSub'); if(sub) sub.textContent = `${total} laporan pada filter aktif`;
    // filter tombol
    const lf=document.getElementById('sevLevelFilter');
    if(lf && !lf.dataset.bound){
        lf.dataset.bound='1';
        lf.addEventListener('click',e=>{ const b=e.target.closest('button[data-lv]'); if(!b) return; sevLevelFilterState=b.dataset.lv; lf.querySelectorAll('button').forEach(x=>x.classList.toggle('ring-2',x===b)); renderSeverityTab(); });
    }
}

// ---------- Tab badges ----------
function updateTabBadges(){
    const bd=document.getElementById('badgeDamage');
    const bv=document.getElementById('badgeDivisi');
    const be=document.getElementById('badgeEngine');
    const bi=document.getElementById('badgeIrr');
    const types = new Set(filteredData.map(d=>d.damageType).filter(v=>v&&v!=='-')).size;
    const divs = new Set(filteredData.map(d=>d.divisi).filter(v=>v&&v!=='-')).size;
    const engUnits = new Set(filteredData.filter(d=>d.engineCode&&d.engineCode!=='-'&&d.engineType&&d.engineType!=='-').map(d=>`${d.engineType} ${d.engineCode}`)).size;
    const irrUnits = new Set(filteredData.filter(d=>d.irrCode&&d.irrCode!=='-'&&d.irrType&&d.irrType!=='-').map(d=>`${d.irrType} ${d.irrCode}`)).size;
    if(bd) bd.textContent = types;
    if(bv) bv.textContent = divs;
    if(be) be.textContent = engUnits;
    const bs=document.getElementById('badgeSeverity'); if(bs) bs.textContent = filteredData.filter(d=>classifySeverity(d).level==='Berat').length;
    if(bi) bi.textContent = irrUnits;
}

// ---------- Search debounce ----------
let searchTimer;
function onSearchInput(v){
    state.search = v.toLowerCase().trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(()=>{ state.page=1; applyFilters(); }, 200);
}

// ---------- Export ----------
function exportCSV(){
    const headers=['Timestamp','Tanggal Inspeksi','Lokasi','Divisi','Jenis Engine','Kode Engine','Jenis Irrigator','Kode Irrigator','Jenis Kerusakan','Keterangan Kerusakan','Spareparts Yang Dibutuhkan','Nomor PR / Notifikasi','Status'];
    const rows=filteredData.map(d=>[new Date(d.timestamp).toISOString(),d.tanggalInspeksi,d.lokasi,d.divisi,d.engineType,d.engineCode,d.irrType,d.irrCode,d.damageType,d.keterangan,d.sparepart,d.prNumber||'',d.status]);
    const csv=[headers.join(','),...rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(','))].join('\n');
    const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=`PG2_Spareparts_Report_${isoDate(new Date())}.csv`;
    a.click();
    showToast('Data berhasil di-export ke CSV','success');
}

// ---------- Toast ----------
function showToast(msg,type='info'){
    const colors={success:'bg-emerald-500',warning:'bg-amber-500',error:'bg-red-500',info:'bg-blue-500'};
    const icons={success:'check-circle',warning:'exclamation-triangle',error:'times-circle',info:'info-circle'};
    const t=document.createElement('div');
    t.className=`fixed top-20 right-4 ${colors[type]} text-white px-4 py-3 rounded-lg shadow-xl z-50 flex items-center gap-2 fade-in text-sm font-medium max-w-sm`;
    t.innerHTML=`<i class="fas fa-${icons[type]}"></i><span>${msg}</span>`;
    document.body.appendChild(t);
    setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity .3s';setTimeout(()=>t.remove(),300);},4000);
}

// ======================================================
// WRITE ENDPOINT (Edit/Delete via Apps Script proxy)
// ======================================================
const WRITE_ENDPOINT_KEY = 'pg2_write_url';
const DISMISS_KEY = 'pg2_dismissSetup';
function getGlobalWriteUrl(){
    return (window.PG2_CONFIG && window.PG2_CONFIG.WRITE_URL) ? String(window.PG2_CONFIG.WRITE_URL).trim() : '';
}
function getUserWriteUrl(){ return localStorage.getItem(WRITE_ENDPOINT_KEY) || ''; }
function setUserWriteUrl(u){
    if(u) localStorage.setItem(WRITE_ENDPOINT_KEY, u.trim());
    else localStorage.removeItem(WRITE_ENDPOINT_KEY);
}
function getWriteUrl(){
    // User override (per-device) lebih diutamakan; kalau tidak ada, pakai global dari config.js
    return getUserWriteUrl() || getGlobalWriteUrl();
}

function initWriteSetup(){
    const banner = document.getElementById('writeSetupBanner');
    const settingsBtn = document.getElementById('settingsBtn');
    if(!banner) return;
    const globalUrl = getGlobalWriteUrl();
    const userUrl = getUserWriteUrl();
    const dismissed = localStorage.getItem(DISMISS_KEY) === '1';
    // Tampilkan tombol gear di header jika fitur sudah/sedang bisa diset
    if(settingsBtn){
        // Tampilkan selalu jika global URL diset (supaya user bisa override per-device) atau jika belum pernah dismiss
        if(globalUrl || !dismissed) settingsBtn.classList.remove('hidden');
        if(globalUrl){
            settingsBtn.title = (userUrl?'Endpoint per-device':'Endpoint global aktif')+' · klik untuk ubah';
        }
    }
    if(globalUrl){
        banner.classList.add('hidden');
        return;
    }
    if(userUrl || dismissed){
        banner.classList.add('hidden');
        return;
    }
    banner.classList.remove('hidden');
}

function openModal(id){ document.getElementById(id).classList.add('show'); }
function closeModal(id){
    document.getElementById(id).classList.remove('show');
    document.querySelectorAll('#'+id+' [id$="Msg"]').forEach(x=>x.innerHTML='');
}
// Close modal on backdrop click
document.addEventListener('click',(e)=>{
    if(e.target.classList && e.target.classList.contains('modal-backdrop')){
        e.target.classList.remove('show');
    }
});
// Close modal on ESC
document.addEventListener('keydown',(e)=>{
    if(e.key==='Escape'){
        document.querySelectorAll('.modal-backdrop.show').forEach(m=>m.classList.remove('show'));
    }
});

function openSetupModal(){
    const urlInput = document.getElementById('setupUrl');
    urlInput.value = getUserWriteUrl() || getGlobalWriteUrl();
    document.getElementById('setupTestResult').innerHTML='';
    // Update isi keterangan modal
    const globalUrl = getGlobalWriteUrl();
    const infoBox = document.getElementById('setupInfoText');
    if(infoBox){
        if(globalUrl){
            infoBox.innerHTML = '<div class="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-4 text-xs text-emerald-900"><p class="font-bold mb-1"><i class="fas fa-circle-check mr-1"></i>Endpoint global sudah diaktifkan oleh admin.</p><p class="mb-2">Edit &amp; hapus sudah aktif untuk SEMUA pengguna di semua perangkat. Anda bisa mengosongkan URL di bawah hanya untuk menonaktifkan di perangkat ini saja.</p><p class="font-mono text-[10px] bg-white px-2 py-1 rounded border break-all" id="setupGlobalUrlDisplay">'+escapeHtml(globalUrl)+'</p></div>';
        } else {
            infoBox.innerHTML = '<div class="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-4 text-xs text-blue-900"><p class="font-bold mb-1"><i class="fas fa-info-circle mr-1"></i>Opsi konfigurasi</p><ol class="list-decimal list-inside space-y-0.5 text-blue-800"><li><b>(Direkomendasikan)</b> Edit file <code class="bg-white px-1 rounded">config.js</code> di repo, isi <code>WRITE_URL</code> lalu push — berlaku untuk SEMUA user/device otomatis.</li><li>Atau paste URL Web App di bawah untuk mengaktifkan hanya di perangkat/browser ini.</li></ol><p class="mt-2">Lihat <code class="bg-white px-1 rounded">SETUP-EDIT.md</code> untuk panduan lengkap.</p></div>';
        }
    }
    openModal('setupModal');
}
async function testWriteEndpoint(){
    const url=document.getElementById('setupUrl').value.trim();
    const res=document.getElementById('setupTestResult');
    if(!url){ res.innerHTML='<span class="text-red-600">URL belum diisi</span>'; return; }
    res.innerHTML='<span class="text-slate-500"><i class="fas fa-spinner spin mr-1"></i>Testing…</span>';
    try{
        const r = await fetch(url+'?action=check', {method:'GET', redirect:'follow'});
        const t = (await r.text()).trim();
        if(/^<!doctype|^<html/i.test(t)){
            res.innerHTML='<span class="text-red-600">Apps Script tidak bisa mengakses spreadsheet (belum diotorisasi / versi lama). Jalankan fungsi <b>authorize</b> di editor Apps Script lalu deploy sebagai <b>New version</b>.</span>';
        } else if(r.ok && /^ok:/i.test(t)){
            res.innerHTML='<span class="text-emerald-600 font-semibold"><i class="fas fa-circle-check mr-1"></i>Koneksi & akses spreadsheet OK ('+escapeHtml(t.slice(0,80))+'). Klik Simpan.</span>';
        } else if(r.ok && t==='pong'){
            res.innerHTML='<span class="text-amber-600">Endpoint hidup tapi memakai kode proxy versi LAMA. Update kode dari scripts/write-proxy.gs lalu deploy New version.</span>';
        } else {
            res.innerHTML=`<span class="text-red-600">Respons tidak valid (${r.status}). Pastikan deploy sebagai "Anyone, even anonymous".</span>`;
        }
    }catch(e){
        res.innerHTML=`<span class="text-red-600">Gagal konek: ${e.message}. Coba cek URL / deploy ulang.</span>`;
    }
}
function saveSetup(){
    const url=document.getElementById('setupUrl').value.trim();
    if(url && !/^https:\/\/script\.google\.com\//.test(url)){
        document.getElementById('setupTestResult').innerHTML='<span class="text-red-600">URL harus mulai dengan https://script.google.com/</span>';
        return;
    }
    // Jika url == global URL (atau kosong padahal ada global) → hapus override per-user
    if(url === getGlobalWriteUrl()) setUserWriteUrl('');
    else setUserWriteUrl(url);
    closeModal('setupModal');
    document.getElementById('writeSetupBanner').classList.add('hidden');
    if(getWriteUrl()) showToast(url ? 'Endpoint tersimpan. Edit/hapus sekarang aktif di perangkat ini.' : 'Kembali ke endpoint global.','success');
    else showToast('Endpoint dihapus. Fitur edit/hapus dinonaktifkan di perangkat ini.','warning');
}

function requireWriteEndpoint(){
    if(getWriteUrl()) return true;
    showToast('Belum ada endpoint write. Silakan konfigurasi lewat Setup.','warning');
    openSetupModal();
    return false;
}

function openEditModal(globalIdx){
    if(!requireWriteEndpoint()) return;
    // globalIdx adalah indeks di filteredData
    const d = filteredData[globalIdx];
    if(!d) return;
    const rawi = rawData.indexOf(d);
    document.getElementById('editRowIdx').value = rawi;
    document.getElementById('editSheetRow').value = d.__row || '';
    document.getElementById('editRowLabel').textContent = `· ${d.lokasi} · ${d.damageType||'-'} · ${fmtDateShort(d.timestamp)}`;
    // Isi form
    document.getElementById('f_tanggal').value = d.tanggalInspeksi;
    document.getElementById('f_lokasi').value = d.lokasi==='-'?'':d.lokasi;
    document.getElementById('f_divisi').value = d.divisi==='-'?'PG2':d.divisi;
    document.getElementById('f_status').value = d.status;
    document.getElementById('f_engineType').value = d.engineType==='-'?'':d.engineType;
    document.getElementById('f_engineCode').value = d.engineCode==='-'?'':d.engineCode;
    document.getElementById('f_irrType').value = d.irrType==='-'?'':d.irrType;
    document.getElementById('f_irrCode').value = d.irrCode==='-'?'':d.irrCode;
    document.getElementById('f_damageType').value = d.damageType==='-'?'':d.damageType;
    document.getElementById('f_keterangan').value = d.keterangan || '';
    document.getElementById('f_sparepart').value = d.sparepart==='-'?'':d.sparepart;
    document.getElementById('f_prNumber').value = d.prNumber || '';
    document.getElementById('editMsg').innerHTML='';
    document.getElementById('editSaveBtn').disabled=false;
    openModal('editModal');
}

// Kirim perintah ke Apps Script write-proxy dan terjemahkan responsnya.
// Apps Script menjawab 302 → googleusercontent; browser mengikuti otomatis.
// Jika deployment belum diotorisasi / versi lama, Google mengirim HALAMAN HTML
// ("Sorry, unable to open the file") alih-alih teks "ok: ..." → deteksi & jelaskan.
async function callWriteProxy(payload){
    const url = getWriteUrl();
    if(!url) throw new Error('Endpoint write belum dikonfigurasi.');
    const ctrl = new AbortController(); const tid=setTimeout(()=>ctrl.abort(), 30000);
    let r, txt;
    try{
        r = await fetch(url,{ method:'POST', body: JSON.stringify(payload), redirect:'follow', signal: ctrl.signal,
            // text/plain → "simple request", tidak memicu preflight CORS yang tidak didukung Apps Script
            headers:{'Content-Type':'text/plain;charset=utf-8'} });
        txt = await r.text();
    } catch(e){
        clearTimeout(tid);
        if(e.name==='AbortError') throw new Error('Timeout 30 detik — Apps Script tidak merespons.');
        throw new Error('Tidak bisa menghubungi Apps Script ('+e.message+'). Pastikan deployment "Who has access: Anyone".');
    }
    clearTimeout(tid);
    const t = (txt||'').trim();
    if(/^<!doctype|^<html/i.test(t)){
        if(/unable to open the file|Page Not Found/i.test(t))
            throw new Error('Apps Script menolak menulis ke spreadsheet: deployment belum diotorisasi untuk akses Spreadsheet atau memakai versi kode lama. Buka editor Apps Script → jalankan fungsi "authorize" sekali → Deploy → Manage deployments → Edit → Version: New version → Deploy.');
        if(/accounts\.google\.com|Sign in/i.test(t))
            throw new Error('Apps Script meminta login. Deploy ulang dengan "Who has access: Anyone" (bukan "Anyone with Google account").');
        throw new Error('Respons tidak dikenal dari Apps Script (HTML). Deploy ulang web app sebagai versi baru.');
    }
    if(!r.ok) throw new Error('HTTP '+r.status+': '+t.slice(0,200));
    if(!/^ok\b/i.test(t)) throw new Error(t.slice(0,300) || 'Respons kosong dari Apps Script');
    return t;
}

async function submitEdit(){
    const rawi = parseInt(document.getElementById('editRowIdx').value);
    const sheetRow = document.getElementById('editSheetRow').value;
    const d = rawData[rawi];
    if(!d) return;
    const payload = {
        sheetRow: sheetRow ? parseInt(sheetRow) : null,
        // Identitas untuk mencari baris bila sheetRow tidak akurat
        matchTs: d.timestamp,
        matchLokasi: d.lokasi,
        matchDamage: d.damageType,
        // Field-field baru
        tanggalInspeksi: document.getElementById('f_tanggal').value,
        lokasi: document.getElementById('f_lokasi').value.trim() || '-',
        divisi: document.getElementById('f_divisi').value,
        status: document.getElementById('f_status').value,
        engineType: document.getElementById('f_engineType').value.trim() || '-',
        engineCode: document.getElementById('f_engineCode').value.trim() || '-',
        irrType: document.getElementById('f_irrType').value.trim() || '-',
        irrCode: document.getElementById('f_irrCode').value.trim() || '-',
        damageType: document.getElementById('f_damageType').value.trim() || '-',
        keterangan: document.getElementById('f_keterangan').value.trim(),
        sparepart: document.getElementById('f_sparepart').value.trim() || '-',
        prNumber: document.getElementById('f_prNumber').value.trim() || null
    };
    const msg=document.getElementById('editMsg');
    const btn=document.getElementById('editSaveBtn');
    msg.innerHTML='<span class="text-blue-600"><i class="fas fa-spinner spin mr-1"></i>Menyimpan ke spreadsheet…</span>';
    btn.disabled=true;
    try{
        await callWriteProxy({action:'update', ...payload});
        // Update local cache (optimistic)
        const upd = {...d};
        Object.assign(upd,{
            lokasi:payload.lokasi, divisi:payload.divisi, status:payload.status,
            engineType:payload.engineType, engineCode:payload.engineCode,
            irrType:payload.irrType, irrCode:payload.irrCode,
            damageType:payload.damageType, keterangan:payload.keterangan,
            sparepart:payload.sparepart, prNumber:payload.prNumber,
        });
        if(payload.tanggalInspeksi){
            const [y,m,day]=payload.tanggalInspeksi.split('-').map(Number);
            const t=new Date(y, m-1, day, 12, 0, 0);
            upd.tanggalInspeksi=payload.tanggalInspeksi;
            upd.timestamp=t.toISOString();
        }
        upd.engine = [upd.engineType,upd.engineCode].filter(x=>x&&x!=='-').join(' – ') || '-';
        upd.irrigator = (upd.irrType&&upd.irrCode&&upd.irrType!==upd.irrCode)?`${upd.irrType} – ${upd.irrCode}`:(upd.irrCode||upd.irrType||'-');
        upd.damage = upd.keterangan ? (upd.damageType?`${upd.damageType} — ${upd.keterangan}`:upd.keterangan) : (upd.damageType||'-');
        rawData[rawi] = upd;
        closeModal('editModal');
        showToast('Perubahan tersimpan di spreadsheet.','success');
        applyFilters();
        // refreshData kini SELALU membaca Sheets langsung (bukan cache) → aman untuk
        // menyelaraskan ulang dari sumber kebenaran, termasuk nomor baris (__row).
        setTimeout(()=>refreshData(true,{silent:true}), 1500);
    }catch(e){
        msg.innerHTML=`<span class="text-red-600"><i class="fas fa-times-circle mr-1"></i>Error: ${e.message}</span>`;
        btn.disabled=false;
    }
}

function openDeleteModal(globalIdx){
    if(!requireWriteEndpoint()) return;
    const d = filteredData[globalIdx];
    if(!d) return;
    const rawi = rawData.indexOf(d);
    document.getElementById('delRowIdx').value = rawi;
    document.getElementById('delSheetRow').value = d.__row || '';
    document.getElementById('deleteRowLabel').textContent = `${d.lokasi} · ${d.divisi} · ${d.damageType||'-'} · ${fmtDateShort(d.timestamp)}`;
    document.getElementById('delMsg').innerHTML='';
    document.getElementById('delConfirmBtn').disabled=false;
    openModal('deleteModal');
}

async function submitDelete(){
    const rawi = parseInt(document.getElementById('delRowIdx').value);
    const sheetRow = document.getElementById('delSheetRow').value;
    const d = rawData[rawi];
    if(!d) return;
    const msg=document.getElementById('delMsg');
    const btn=document.getElementById('delConfirmBtn');
    msg.innerHTML='<span class="text-red-600"><i class="fas fa-spinner spin mr-1"></i>Menghapus…</span>';
    btn.disabled=true;
    try{
        await callWriteProxy({
            action:'delete',
            sheetRow: sheetRow?parseInt(sheetRow):null,
            matchTs: d.timestamp,
            matchLokasi: d.lokasi,
            matchDamage: d.damageType
        });
        closeModal('deleteModal');
        showToast('Baris dihapus dari spreadsheet.','success');
        const deletedRow = d.__row;
        rawData.splice(rawi,1);
        // Baris di bawah yang dihapus bergeser naik 1 di spreadsheet → koreksi __row lokal
        // agar edit/hapus berikutnya (sebelum refresh) tetap mengenai baris yang benar.
        if(typeof deletedRow==='number') rawData.forEach(x=>{ if(typeof x.__row==='number' && x.__row>deletedRow) x.__row--; });
        applyFilters();
        setTimeout(()=>refreshData(true,{silent:true}), 1500);
    }catch(e){
        msg.innerHTML=`<span class="text-red-600"><i class="fas fa-times-circle mr-1"></i>Error: ${e.message}</span>`;
        btn.disabled=false;
    }
}

// ---------- Utils ----------
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ---------- Init ----------
document.addEventListener('DOMContentLoaded',()=>{
    // Expose internal refs for debugging/testing
    window.__app = { get rawData(){return rawData;}, get filteredData(){return filteredData;}, state, refreshData, applyFilters };
    const dt=document.getElementById('dateTo'); if(dt) dt.max=isoDate(new Date());
    document.querySelectorAll('.filter-btn').forEach(b=>{
        if(b.dataset.filter==='all'){b.classList.add('active');b.classList.remove('text-slate-600');}
        else{b.classList.remove('active');b.classList.add('text-slate-600');}
    });
    document.querySelectorAll('.ms-wrap').forEach(w => {
        const btn=w.querySelector('.ms-btn');
        if(btn) btn.addEventListener('click', e => { e.stopPropagation(); w.classList.toggle('open'); });
        const all=w.querySelector('.ms-opt-all');
        if(all) all.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); msToggleAll(e.currentTarget); });
        const list=w.querySelector('.ms-list');
        if(list) list.addEventListener('click', e => {
            const lbl = e.target.closest('.ms-opt');
            if (!lbl) return;
            e.preventDefault(); e.stopPropagation();
            msToggleOption(lbl);
        });
    });
    const si=document.getElementById('searchInput');
    if(si) si.addEventListener('input', e => onSearchInput(e.target.value));
    refreshData(false);
    // Auto-refresh diam-diam tiap 5 menit (tanpa reset halaman / kedip loading)
    setInterval(()=>refreshData(false,{silent:true}),5*60*1000);
    // Saat tab/PWA kembali aktif setelah lama di background (timer browser
    // di-throttle di mobile), langsung sinkron ulang.
    let lastHidden = 0;
    document.addEventListener('visibilitychange',()=>{
        if(document.hidden){ lastHidden=Date.now(); return; }
        if(Date.now()-lastHidden > 60*1000) refreshData(false,{silent:true});
    });
    // Koneksi pulih → sinkron ulang
    window.addEventListener('online',()=>refreshData(false,{silent:true}));

    // Setup banner edit/hapus
    initWriteSetup();

    // Re-render charts saat window resize (throttled) agar tidak terpotong
    let resizeT;
    window.addEventListener('resize',()=>{
        clearTimeout(resizeT);
        resizeT=setTimeout(()=>renderCharts(),150);
    });
});
