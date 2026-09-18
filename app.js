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
    period: 'all',      // 'daily'|'weekly'|'monthly'|'all'|'custom'
    dateFrom: '',
    dateTo: '',
    selectedDate: null, // 'YYYY-MM-DD'
    divisi: [],         // multi-select array
    status: [],         // multi-select array
    lokasi: [],         // multi-select array
    search: '',
    page: 1,
    pageSize: 15,
    sortField: 'timestamp',
    sortDir: 'desc',
    calMonth: (() => { const d = new Date(); d.setDate(1); return d; })()
};

let charts = {};
let isFirstLoad = true;

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
        // Normalize engine field untuk menghindari null
        out.push({
            timestamp: tgl.toISOString(),
            tanggalInspeksi: tgl.toISOString().slice(0,10),
            lokasi: lok || '-', divisi: div || '-',
            engineType: et || '-', engineCode: ec || '-',
            engine: engine || '-',
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
    document.getElementById('loadingState').classList.remove('hidden');
    document.getElementById('tableBody').innerHTML='';
    document.getElementById('emptyState').classList.add('hidden');

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

    // Populate ulang opsi filter TANPA mereset pilihan user yang masih valid
    populateMultiSelect('divisiFilter', [...new Set(rawData.map(d=>d.divisi).filter(v=>v&&v!=='-'))].sort(), state.divisi);
    populateMultiSelect('lokasiFilter', [...new Set(rawData.map(d=>d.lokasi).filter(v=>v&&v!=='-'))].sort(), state.lokasi);
    // Status selalu opsi tetap
    populateMultiSelect('statusFilter', ['Belum Ditangani','Proses'], state.status);

    // Hapus pilihan yang sudah tidak ada di data baru
    state.divisi = state.divisi.filter(v => rawData.some(d => d.divisi === v));
    state.lokasi = state.lokasi.filter(v => rawData.some(d => d.lokasi === v));
    state.status = state.status.filter(v => ['Belum Ditangani','Proses'].includes(v));

    state.page = 1;
    renderCalendar();
    applyFilters();
    isFirstLoad = false;
}

// ---------- Date Utils ----------
function startOfDay(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate());}
function startOfWeek(d){const x=startOfDay(d);x.setDate(x.getDate()-((x.getDay()+6)%7));return x;}
function startOfMonth(d){return new Date(d.getFullYear(),d.getMonth(),1);}
function isoDate(d){const x=new Date(d);x.setHours(0,0,0,0);return x.toISOString().slice(0,10);}
function fmtDate(d){return new Date(d).toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric',weekday:'long'});}

// ---------- Multi-select Dropdown ----------
function populateMultiSelect(id, options, selected) {
    const wrap = document.getElementById(id);
    if(!wrap)return;
    const validSelected = selected.filter(s => options.includes(s));
    const ph = wrap.dataset.ph || 'Semua';
    const selectedText = validSelected.length === 0
        ? ph
        : (validSelected.length === options.length && options.length>0 ? `Semua (${options.length})` :
           validSelected.length <= 2 ? validSelected.join(', ') : `${validSelected.length} terpilih`);
    wrap.querySelector('.ms-btn-text').textContent = selectedText;

    const menu = wrap.querySelector('.ms-menu');
    const allChecked = validSelected.length === options.length && options.length > 0;
    const allCheck = menu.querySelector('.ms-opt-all .ms-check');
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

function toggleMultiSelect(id) {
    // Tutup dropdown lain
    document.querySelectorAll('.ms-wrapper').forEach(w => {
        if (w.id !== id) w.classList.remove('open');
    });
    document.getElementById(id).classList.toggle('open');
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

// ---------- Period Filter ----------
function setPeriod(p) {
    state.period = p;
    state.page = 1;
    state.selectedDate = null;
    state.dateFrom = ''; state.dateTo = '';
    document.getElementById('dateFrom').value='';
    document.getElementById('dateTo').value='';
    document.getElementById('selectedDateBadge').classList.add('hidden');
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
    // Date range
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

    const q = (state.search || document.getElementById('searchInput').value || '').toLowerCase().trim();

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

    // Period info
    document.getElementById('activePeriodText').textContent = periodLabel;
    const badge = document.getElementById('selectedDateBadge');
    if (state.selectedDate) {
        badge.classList.remove('hidden');
        document.getElementById('selectedDateText').textContent = fmtDate(state.selectedDate);
    } else badge.classList.add('hidden');

    // Active filter chips
    renderActiveChips();

    updateStats();
    renderCharts();
    renderCalendar();
    renderCalDayDetail();
    renderTable();
}

function renderActiveChips() {
    const chips = [];
    state.divisi.forEach(v => chips.push({label:`Div: ${v}`, clear:()=>{state.divisi=state.divisi.filter(x=>x!==v);repop('divisiFilter','divisi');}}));
    state.lokasi.forEach(v => chips.push({label:`Lok: ${v}`, clear:()=>{state.lokasi=state.lokasi.filter(x=>x!==v);repop('lokasiFilter','lokasi');}}));
    state.status.forEach(v => chips.push({label:`Status: ${v}`, clear:()=>{state.status=state.status.filter(x=>x!==v);repop('statusFilter','status');}}));
    if (state.selectedDate) chips.push({label:`Tgl: ${fmtDate(state.selectedDate)}`, clear:()=>clearSelectedDate()});
    else if (state.period==='custom') chips.push({label:'Custom date', clear:()=>{state.period='all';state.dateFrom='';state.dateTo='';document.getElementById('dateFrom').value='';document.getElementById('dateTo').value='';setPeriodUI('all');applyFilters();}});

    const container = document.getElementById('activeFilters');
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
    document.getElementById('searchInput').value = '';
    state.selectedDate = null;
    state.dateFrom=''; state.dateTo='';
    document.getElementById('dateFrom').value='';
    document.getElementById('dateTo').value='';
    state.period = 'all';
    setPeriodUI('all');
    // repopulate
    populateMultiSelect('divisiFilter',[...new Set(rawData.map(d=>d.divisi).filter(v=>v&&v!=='-'))].sort(),[]);
    populateMultiSelect('lokasiFilter',[...new Set(rawData.map(d=>d.lokasi).filter(v=>v&&v!=='-'))].sort(),[]);
    populateMultiSelect('statusFilter',['Belum Ditangani','Proses'],[]);
    state.page = 1;
    applyFilters();
}
function clearSelectedDate() {
    state.selectedDate = null;
    state.dateFrom=''; state.dateTo='';
    document.getElementById('dateFrom').value='';
    document.getElementById('dateTo').value='';
    document.getElementById('selectedDateBadge').classList.add('hidden');
    if (state.period === 'custom') { state.period='all'; setPeriodUI('all'); }
    renderCalendar();
    applyFilters();
}

// ---------- Stats ----------
function updateStats() {
    const t=filteredData.length;
    const loc=new Set(filteredData.map(d=>d.lokasi)).size;
    const proses=filteredData.filter(d=>d.status==='Proses').length;
    const pending=filteredData.filter(d=>d.status==='Belum Ditangani').length;
    animateNumber('statTotal',t);
    animateNumber('statUnits',loc);
    animateNumber('statProses',proses);
    animateNumber('statPending',pending);
}
function animateNumber(id,tgt) {
    const el=document.getElementById(id);
    const cur=parseInt((el.textContent||'0').replace(/\./g,''))||0;
    const step=Math.max(1,Math.ceil(Math.abs(tgt-cur)/15));
    let v=cur;
    const fn=setInterval(()=>{
        if(v<tgt)v=Math.min(v+step,tgt);
        else if(v>tgt)v=Math.max(v-step,tgt);
        el.textContent=v.toLocaleString('id-ID');
        if(v===tgt)clearInterval(fn);
    },25);
}

// ---------- Charts (minimalist modern style) ----------
const CC=['#2563eb','#ef4444','#f59e0b','#10b981','#8b5cf6','#ec4899','#06b6d4','#f97316','#84cc16','#6366f1'];
const GRID_COLOR='rgba(148,163,184,0.12)';
const TICK_COLOR='#64748b';
function dk(k){if(charts[k]){charts[k].destroy();charts[k]=null;}}
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
function mkDoughnutOpts(){
    return{
        responsive:true,maintainAspectRatio:false,cutout:'72%',
        plugins:{
            legend:{position:'bottom',labels:{boxWidth:8,boxHeight:8,padding:12,usePointStyle:true,pointStyle:'circle',font:{size:10}}},
            tooltip:{backgroundColor:'#0f172a',padding:10,cornerRadius:8,titleFont:{size:11,weight:'600'},bodyFont:{size:11}}
        }
    };
}
function renderCharts() {
    dk('trend');dk('status');dk('lokasi');dk('sparepart');dk('jenis');dk('divisi');
    // Cek apakah canvas ada (jika halaman belum ready, skip)
    const trendEl = document.getElementById('trendChart');
    if (!trendEl) return;

    // Trend
    const groups={}; let getKey;
    // Jika selected date / custom range pendek, pakai skala hari; jika weekly pakai hari; monthly pakai tanggal; all pakai bulan
    let mode = state.period;
    if (state.selectedDate) mode = 'daily';
    if (mode === 'daily' && !state.selectedDate) {
        getKey = d => String(d.getHours()).padStart(2,'0')+':00';
        for (let h=0;h<24;h++) groups[h+':00']=0;
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
        const g=ctx.createLinearGradient(0,0,0,220);
        g.addColorStop(0,'rgba(37,99,235,0.35)');g.addColorStop(1,'rgba(37,99,235,0)');
        charts.trend = new Chart(ctx,{
            type:'line',
            data:{labels:Object.keys(groups),datasets:[{
                label:'Laporan',data:Object.values(groups),
                borderColor:'#2563eb',backgroundColor:g,
                borderWidth:2.5,fill:true,tension:0.4,
                pointRadius:0,
                pointHoverRadius:5,
                pointHoverBackgroundColor:'#1d4ed8',
                pointHoverBorderColor:'#fff',
                pointHoverBorderWidth:2
            }]},
            options:mkOpts(false,{plugins:{legend:{display:false}}})
        });
    }

    // Status (doughnut)
    const sg={'Belum Ditangani':0,'Proses':0};
    filteredData.forEach(d=>{if(sg[d.status]!==undefined)sg[d.status]++;});
    const statusCtx=document.getElementById('statusChart');
    if(statusCtx&&statusCtx.getContext('2d')){
        charts.status=new Chart(statusCtx.getContext('2d'),{
            type:'doughnut',
            data:{labels:Object.keys(sg),datasets:[{
                data:Object.values(sg),
                backgroundColor:['#94a3b8','#f59e0b'],
                borderWidth:0,hoverOffset:6
            }]},
            options:mkDoughnutOpts()
        });
    }

    // Lokasi (bar horizontal)
    const lg={};
    filteredData.forEach(d=>{if(d.lokasi&&d.lokasi!=='-')lg[d.lokasi]=(lg[d.lokasi]||0)+1;});
    const ls=Object.entries(lg).sort((a,b)=>b[1]-a[1]).slice(0,10);
    const lokasiCtx=document.getElementById('lokasiChart');
    if(lokasiCtx&&lokasiCtx.getContext('2d')){
        charts.lokasi=new Chart(lokasiCtx.getContext('2d'),{
            type:'bar',
            data:{labels:ls.map(x=>x[0]),datasets:[{
                label:'Jumlah',data:ls.map(x=>x[1]),
                backgroundColor:ls.map((_,i)=>CC[i%CC.length]),
                borderRadius:6,borderSkipped:false,borderWidth:0,
                maxBarThickness:28
            }]},
            options:mkOpts(true,{plugins:{legend:{display:false}}})
        });
    }

    // Sparepart (bar horizontal)
    const spg={};
    filteredData.forEach(d=>{
        if(d.sparepart&&d.sparepart!=='-')d.sparepart.split(/;\s*/).forEach(sp=>{sp=sp.trim();if(sp)spg[sp]=(spg[sp]||0)+1;});
    });
    const sps=Object.entries(spg).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const spCtx=document.getElementById('sparepartChart');
    if(spCtx&&spCtx.getContext('2d')){
        charts.sparepart=new Chart(spCtx.getContext('2d'),{
            type:'bar',
            data:{labels:sps.map(x=>x[0]),datasets:[{
                label:'Kebutuhan',data:sps.map(x=>x[1]),
                backgroundColor:'#f59e0b',
                borderRadius:6,borderSkipped:false,borderWidth:0,
                maxBarThickness:24
            }]},
            options:mkOpts(true,{plugins:{legend:{display:false}}})
        });
    }

    // Jenis Kerusakan (bar vertikal)
    const jg={};
    filteredData.forEach(d=>{if(d.damageType&&d.damageType!=='-')jg[d.damageType]=(jg[d.damageType]||0)+1;});
    const js=Object.entries(jg).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const jenisCtx=document.getElementById('jenisChart');
    if(jenisCtx&&jenisCtx.getContext('2d')){
        charts.jenis=new Chart(jenisCtx.getContext('2d'),{
            type:'bar',
            data:{labels:js.map(x=>x[0]),datasets:[{
                label:'Jumlah',data:js.map(x=>x[1]),
                backgroundColor:CC.slice(0,8),
                borderRadius:6,borderSkipped:false,borderWidth:0,
                maxBarThickness:36
            }]},
            options:mkOpts(false,{plugins:{legend:{display:false}}})
        });
    }

    // Divisi (doughnut)
    const dg={};
    filteredData.forEach(d=>{if(d.divisi&&d.divisi!=='-')dg[d.divisi]=(dg[d.divisi]||0)+1;});
    const divisiCtx=document.getElementById('divisiChart');
    if(divisiCtx&&divisiCtx.getContext('2d')){
        charts.divisi=new Chart(divisiCtx.getContext('2d'),{
            type:'doughnut',
            data:{labels:Object.keys(dg),datasets:[{
                data:Object.values(dg),
                backgroundColor:CC,
                borderWidth:0,hoverOffset:6
            }]},
            options:mkDoughnutOpts()
        });
    }
}
function dateRangeDays() {
    if(!state.dateFrom||!state.dateTo) return 0;
    return Math.round((new Date(state.dateTo)-new Date(state.dateFrom))/86400000)+1;
}

// ---------- Calendar ----------
function renderCalendar() {
    const grid=document.getElementById('calendarGrid');
    if(!grid) return;
    const monthNames=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    document.getElementById('calMonthYear').textContent=`${monthNames[state.calMonth.getMonth()]} ${state.calMonth.getFullYear()}`;
    // Gunakan rawData (bukan filteredData) agar kalender selalu menampilkan seluruh laporan
    const byDate={};
    rawData.forEach(d=>{byDate[d.tanggalInspeksi]=(byDate[d.tanggalInspeksi]||0)+1;});

    const first=new Date(state.calMonth.getFullYear(),state.calMonth.getMonth(),1);
    const firstWeekday=(first.getDay()+6)%7;
    const daysInMonth=new Date(state.calMonth.getFullYear(),state.calMonth.getMonth()+1,0).getDate();
    const daysInPrev=new Date(state.calMonth.getFullYear(),state.calMonth.getMonth(),0).getDate();
    const todayIso=isoDate(new Date());

    let html='<div class="cal-weekday">Sen</div><div class="cal-weekday">Sel</div><div class="cal-weekday">Rab</div><div class="cal-weekday">Kam</div><div class="cal-weekday">Jum</div><div class="cal-weekday">Sab</div><div class="cal-weekday">Min</div>';
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
    document.getElementById('dateFrom').value=iso;
    document.getElementById('dateTo').value=iso;
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
        // Ringkasan per tanggal terbaru
        const byDate={};
        rawData.forEach(d=>{byDate[d.tanggalInspeksi]=(byDate[d.tanggalInspeksi]||0)+1;});
        const recent = Object.entries(byDate).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,8);
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
            ${d.keterangan?`<div class="text-xs text-slate-500 mb-1.5">${d.keterangan}</div>`:''}
            <div class="flex flex-wrap gap-2 text-[11px]">
                ${d.sparepart&&d.sparepart!=='-'?`<span class="inline-flex items-center gap-1 text-amber-700"><i class="fas fa-cog text-[9px]"></i>${d.sparepart}</span>`:''}
                ${d.engine&&d.engine!=='-'?`<span class="inline-flex items-center gap-1 text-slate-500"><i class="fas fa-oil-can text-[9px]"></i>${d.engine}</span>`:''}
                ${d.irrigator&&d.irrigator!=='-'?`<span class="inline-flex items-center gap-1 text-slate-500"><i class="fas fa-spray-can text-[9px]"></i>${d.irrigator}</span>`:''}
                ${d.prNumber?`<span class="inline-flex items-center gap-1 text-blue-700"><i class="fas fa-file-invoice text-[9px]"></i>PR ${d.prNumber}</span>`:''}
            </div>
        </div>`;
    }).join('');
}

// ---------- Table ----------
function renderTable(){
    if(!document.getElementById('tableBody')) return;
    document.getElementById('loadingState').classList.add('hidden');
    const tbody=document.getElementById('tableBody');
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
    document.getElementById('emptyState').classList.toggle('hidden',sorted.length!==0);

    tbody.innerHTML=page.map(d=>{
        const sb=d.status==='Proses'
            ?'<span class="status-badge bg-amber-100 text-amber-700"><i class="fas fa-circle text-[6px]"></i>Proses (PR Aktif)</span>'
            :'<span class="status-badge bg-slate-100 text-slate-700"><i class="fas fa-circle text-[6px]"></i>Belum Ditangani</span>';
        const engCell=d.engine&&d.engine!=='-' ? `<div class="font-medium text-slate-700 text-xs">${d.engine}</div>` : '<span class="text-slate-400 italic text-xs">—</span>';
        const irrCell=d.irrigator&&d.irrigator!=='-' ? `<div class="font-medium text-slate-700 text-xs">${d.irrigator}</div>` : '<span class="text-slate-400 italic text-xs">—</span>';
        return `<tr class="table-row transition">
            <td class="px-4 py-3 whitespace-nowrap">
                <div class="font-medium text-slate-800 text-xs">${new Date(d.timestamp).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})}</div>
            </td>
            <td class="px-4 py-3">
                <span class="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-semibold"><i class="fas fa-map-marker-alt text-[9px]"></i>${d.lokasi}</span>
            </td>
            <td class="px-4 py-3"><span class="text-xs text-slate-600 bg-slate-50 px-2 py-0.5 rounded">${d.divisi}</span></td>
            <td class="px-4 py-3">${engCell}</td>
            <td class="px-4 py-3">${irrCell}</td>
            <td class="px-4 py-3"><span class="font-medium text-slate-800 text-xs">${d.damageType||'-'}</span></td>
            <td class="px-4 py-3 text-xs text-slate-600 max-w-[200px]">${d.keterangan||'<span class="text-slate-400 italic">-</span>'}</td>
            <td class="px-4 py-3 text-xs text-slate-700 max-w-[220px]">${d.sparepart!=='-'?d.sparepart:'<span class="text-slate-400 italic">Belum ditentukan</span>'}</td>
            <td class="px-4 py-3 text-xs">${d.prNumber?`<span class="font-mono font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">${d.prNumber}</span>`:'<span class="text-slate-400 italic">—</span>'}</td>
            <td class="px-4 py-3 whitespace-nowrap">${sb}</td>
        </tr>`;
    }).join('');

    document.getElementById('tableCount').textContent=`Menampilkan ${page.length} dari ${sorted.length} data`;
    document.getElementById('pageInfo').textContent=`Halaman ${state.page} / ${totalPages}`;
    document.getElementById('prevBtn').disabled=state.page===1;
    document.getElementById('nextBtn').disabled=state.page===totalPages;
}
function sortTable(field){
    if(state.sortField===field)state.sortDir=state.sortDir==='asc'?'desc':'asc';
    else{state.sortField=field;state.sortDir=field==='timestamp'?'desc':'asc';}
    renderTable();
}
function prevPage(){if(state.page>1){state.page--;renderTable();}}
function nextPage(){const tp=Math.ceil(filteredData.length/state.pageSize);if(state.page<tp){state.page++;renderTable();}}

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

// ---------- Init ----------
document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('dateTo').max=isoDate(new Date());
    document.querySelectorAll('.filter-btn').forEach(b=>{
        if(b.dataset.filter==='all'){b.classList.add('active');b.classList.remove('text-slate-600');}
        else{b.classList.remove('active');b.classList.add('text-slate-600');}
    });
    // Setup multi-select click handlers
    document.querySelectorAll('.ms-wrap').forEach(w => {
        w.querySelector('.ms-btn').addEventListener('click', e => { e.stopPropagation(); w.classList.toggle('open'); });
        w.querySelector('.ms-opt-all').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); msToggleAll(e.currentTarget); });
        w.querySelector('.ms-list').addEventListener('click', e => {
            const lbl = e.target.closest('.ms-opt');
            if (!lbl) return;
            e.preventDefault(); e.stopPropagation();
            msToggleOption(lbl);
        });
    });
    document.getElementById('searchInput').addEventListener('input', e => onSearchInput(e.target.value));
    refreshData(false);
    setInterval(()=>refreshData(false),5*60*1000);
});
