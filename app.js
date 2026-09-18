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
    let d = new Date(s); if (!isNaN(d.getTime())) return d;
    const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (m) {
        const a=+m[1], b=+m[2];
        const mo = a > 12 ? b-1 : a-1, dy = a > 12 ? a : b;
        d = new Date(+m[3], mo, dy, +(m[4]||0), +(m[5]||0), +(m[6]||0));
        if (!isNaN(d.getTime())) return d;
    }
    const m2 = s.match(/(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?/);
    if (m2) {
        const a=+m2[1], b=+m2[2];
        let dy, mo;
        if (a > 12) { dy = a; mo = b-1; }
        else if (b > 12) { dy = b; mo = a-1; }
        else { dy = b; mo = a-1; }
        d = new Date(+m2[3], mo, dy, +(m2[4]||0), +(m2[5]||0));
        if (!isNaN(d.getTime())) return d;
    }
    return null;
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
        const tgl = parseDate(get('tglInsp')) || parseDate(get('ts')) || new Date();
        const lok = get('lok'), et = get('eT'), ec = get('eC'), it = get('iT'), ic = get('iC'), div = get('div');
        const dt = get('dT'), dn = get('dN'), sp = get('sp'), pr = get('pr');
        const irrigator = (it && ic && it !== ic) ? `${it} – ${ic}` : (ic || it || '-');
        const engine = [et,ec].filter(Boolean).join(' – ');
        const damage = dn ? (dt ? `${dt} — ${dn}` : dn) : (dt || '-');
        const spNorm = sp ? sp.replace(/[\r\n]+/g,'; ').replace(/\s*;\s*/g,'; ') : '-';
        const status = pr ? 'Proses' : 'Belum Ditangani';
        if (!lok && !ic && !dt && spNorm === '-') continue;
        out.push({
            timestamp: tgl.toISOString(),
            tanggalInspeksi: tgl.toISOString().slice(0,10),
            lokasi: lok || '-', divisi: div || '-',
            engineType: et || '-', engineCode: ec || '-', engine: engine || '-',
            irrType: it || '-', irrCode: ic || '-', irrigator,
            damageType: dt || '-', keterangan: dn || '', damage,
            sparepart: spNorm, prNumber: pr || null, status, unit: lok || '-'
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
            timestamp:d.toISOString(),tanggalInspeksi:d.toISOString().slice(0,10),
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

async function refreshData(forceLive=false) {
    const icon=document.getElementById('refreshIcon');
    icon.classList.add('spin');
    const ls = document.getElementById('loadingState'); if(ls) ls.classList.remove('hidden');
    const tb = document.getElementById('tableBody'); if(tb) tb.innerHTML='';
    const es = document.getElementById('emptyState'); if(es) es.classList.add('hidden');

    let data=null, source='cache';
    if(forceLive) { data=await fetchLiveCSV(); if(data&&data.length) source='live-sheet'; }
    if(!data) {
        try {
            const res=await fetch(DATA_URL+'?t='+Date.now(),{cache:'no-store'});
            if(res.ok) {
                const json=await res.json();
                if(Array.isArray(json)&&json.length) {
                    data = json.map(r => ({
                        ...r,
                        lokasi: r.lokasi || r.unit || '-',
                        divisi: r.divisi || '-',
                        engineType: r.engineType || '-',
                        engineCode: r.engineCode || '-',
                        engine: r.engine || '-',
                        irrType: r.irrType || '-',
                        irrCode: r.irrCode || '-',
                        irrigator: r.irrigator || '-',
                        damageType: r.damageType || '-',
                        keterangan: r.keterangan || r.notes || '',
                        tanggalInspeksi: r.tanggalInspeksi || (r.timestamp?r.timestamp.slice(0,10):new Date().toISOString().slice(0,10)),
                        prNumber: r.prNumber || null
                    }));
                    source='github-cache';
                }
            }
        } catch(e) {}
    }
    if(!data||!data.length) {
        data=generateDemo(); source='demo';
        showToast('Menggunakan data demo. Pastikan spreadsheet dishare "Anyone with link – Viewer".','warning');
    }

    rawData = data;
    document.getElementById('syncTime').textContent = new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
    const srcLabel = {'live-sheet':'Live (Sheets)','github-cache':'Sync GitHub','demo':'Data Demo'}[source];
    document.getElementById('dataSource').textContent = `${srcLabel} · ${data.length} record`;
    const dot=document.getElementById('dataSourceDot');
    dot.className = 'w-2 h-2 rounded-full pulse-dot '+(source==='live-sheet'?'bg-green-500':source==='github-cache'?'bg-blue-500':'bg-amber-500');
    icon.classList.remove('spin');

    populateMultiSelect('divisiFilter', [...new Set(rawData.map(d=>d.divisi).filter(v=>v&&v!=='-'))].sort(), state.divisi);
    populateMultiSelect('lokasiFilter', [...new Set(rawData.map(d=>d.lokasi).filter(v=>v&&v!=='-'))].sort(), state.lokasi);
    populateMultiSelect('statusFilter', ['Belum Ditangani','Proses'], state.status);

    state.divisi = state.divisi.filter(v => rawData.some(d => d.divisi === v));
    state.lokasi = state.lokasi.filter(v => rawData.some(d => d.lokasi === v));
    state.status = state.status.filter(v => ['Belum Ditangani','Proses'].includes(v));

    state.page = 1;
    applyFilters();
    isFirstLoad = false;
}

// ---------- Date Utils ----------
function startOfDay(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate());}
function startOfWeek(d){const x=startOfDay(d);x.setDate(x.getDate()-((x.getDay()+6)%7));return x;}
function startOfMonth(d){return new Date(d.getFullYear(),d.getMonth(),1);}
function isoDate(d){const x=new Date(d);x.setHours(0,0,0,0);return x.toISOString().slice(0,10);}
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
            const blob = `${d.lokasi} ${d.divisi} ${d.engine} ${d.engineCode} ${d.irrigator} ${d.damageType} ${d.keterangan} ${d.sparepart} ${d.prNumber||''} ${d.status}`.toLowerCase();
            if (!blob.includes(q)) return false;
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
    ['trend','status','lokasi','sparepart','jenis','divisi','divStacked'].forEach(k=>dk(k));

    // ==== TREND (overview tab) ====
    const trendEl = document.getElementById('trendChart');
    if(trendEl && isElVisible(trendEl)){
        const groups={}; let getKey;
        let mode = state.period;
        if (state.selectedDate) mode = 'daily';
        if (mode === 'daily' && !state.selectedDate) {
            getKey = d => String(d.getHours()).padStart(2,'0');
            for (let h=0;h<24;h++) groups[String(h).padStart(2,'0')]=0;
        } else if (mode === 'weekly' || (state.period==='custom' && dateRangeDays()<=10)) {
            getKey = d => ['Min','Sen','Sel','Rab','Kam','Jum','Sab'][d.getDay()];
            ['Sen','Sel','Rab','Kam','Jum','Sab','Min'].forEach(k=>groups[k]=0);
        } else if (mode === 'monthly' || (state.period==='custom' && dateRangeDays()<=62)) {
            getKey = d => d.getDate();
            const ref = state.selectedDate ? new Date(state.selectedDate) : new Date();
            const dim = new Date(ref.getFullYear(), ref.getMonth()+1,0).getDate();
            for (let i=1;i<=dim;i++) groups[i]=0;
        } else {
            getKey = d => d.toLocaleDateString('id-ID',{month:'short',year:'numeric'});
        }
        filteredData.forEach(d=>{const k=getKey(new Date(d.timestamp));groups[k]=(groups[k]||0)+1;});
        const ctx=trendEl.getContext('2d');
        if(ctx){
            const g=ctx.createLinearGradient(0,0,0,240);
            g.addColorStop(0,'rgba(37,99,235,0.35)');g.addColorStop(1,'rgba(37,99,235,0)');
            charts.trend = new Chart(ctx,{
                type:'line',
                data:{labels:Object.keys(groups),datasets:[{
                    label:'Laporan',data:Object.values(groups),
                    borderColor:'#2563eb',backgroundColor:g,
                    borderWidth:2.5,fill:true,tension:0.4,
                    pointRadius:0,pointHoverRadius:5,
                    pointHoverBackgroundColor:'#1d4ed8',pointHoverBorderColor:'#fff',pointHoverBorderWidth:2
                }]},
                options:mkOpts(false,{plugins:{legend:{display:false}}})
            });
        }
        const ts = document.getElementById('trendSub');
        if(ts){
            const peak = Object.entries(groups).sort((a,b)=>b[1]-a[1])[0];
            ts.textContent = peak && peak[1]>0 ? `Puncak: ${peak[0]} (${peak[1]} laporan)` : 'Frekuensi laporan per periode';
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

// ---------- Tab badges ----------
function updateTabBadges(){
    const bd=document.getElementById('badgeDamage');
    const bv=document.getElementById('badgeDivisi');
    const types = new Set(filteredData.map(d=>d.damageType).filter(v=>v&&v!=='-')).size;
    const divs = new Set(filteredData.map(d=>d.divisi).filter(v=>v&&v!=='-')).size;
    if(bd) bd.textContent = types;
    if(bv) bv.textContent = divs;
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

// ---------- Utils ----------
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ---------- Init ----------
document.addEventListener('DOMContentLoaded',()=>{
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
    setInterval(()=>refreshData(false),5*60*1000);
});
