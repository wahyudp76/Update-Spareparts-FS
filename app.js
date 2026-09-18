// ======================================================
// PG2 Irrigation Dashboard - Main Application
// Data source: data.json yang di-update otomatis oleh
// GitHub Actions tiap 15 menit dari Google Sheets.
// Tombol Refresh juga bisa fetch live langsung via
// Google Chart Tools endpoint (mendukung CORS/JSONP).
// ======================================================
const SHEET_ID = '1TZiQfgiVXmXCLorD1BePuH2wEDnUcy_zWTivQSE3fUk';
const SHEET_NAME = 'Response';
const DATA_URL = './data.json';

let rawData = [];
let filteredData = [];
let currentFilter = 'daily';
let currentPage = 1;
const PAGE_SIZE = 15;
let sortField = 'timestamp';
let sortDir = 'desc';
let charts = {};

// ---------- CSV parser ----------
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
    let d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (m) {
        const a = parseInt(m[1],10), b = parseInt(m[2],10);
        const mo = a > 12 ? b-1 : a-1, dy = a > 12 ? a : b;
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

function normalizeRowsFromCSV(rows) {
    if (!rows.length) return [];
    const headers = rows[0].map(h => String(h||'').trim());
    const hi = {};
    headers.forEach((name,i)=>{
        const k = String(name).toLowerCase().trim();
        if (k==='timestamp') hi.timestamp=i;
        else if(k.includes('tanggal inspeksi')) hi.tanggalInspeksi=i;
        else if(k.includes('lokasi')||k==='unit'||k.includes('blok')) hi.lokasi=i;
        else if(k.includes('divisi')) hi.divisi=i;
        else if(k.includes('jenis engine')) hi.engineType=i;
        else if(k.includes('kode engine')) hi.engineCode=i;
        else if(k.includes('jenis irrigator')) hi.irrType=i;
        else if(k.includes('kode irrigator')) hi.irrCode=i;
        else if(k.includes('irrigator')) hi.irrCode=i;
        else if(k.includes('jenis kerusakan')) hi.damageType=i;
        else if(k.includes('keterangan kerusakan')||k.includes('detail')) hi.damageNote=i;
        else if(k.includes('sparepart')||k.includes('spare part')) hi.sparepart=i;
        else if(k.includes('nomor pr')||k.includes('no pr')||k.includes('notifikasi')) hi.prNumber=i;
        else if(k.includes('qty')||k.includes('jumlah')) hi.qty=i;
        else if(k.includes('status')) hi.status=i;
    });
    const out=[];
    for(let i=1;i<rows.length;i++){
        const r=rows[i];
        const get=f=>(hi[f]>=0?String(r[hi[f]]||'').trim():'');
        const tglInsp = parseDateFlexible(get('tanggalInspeksi'));
        const ts = tglInsp || parseDateFlexible(get('timestamp')) || new Date();
        const lok=get('lokasi'), ec=get('engineCode'), et=get('engineType');
        const it=get('irrType'), ic=get('irrCode');
        const irrigator = (it&&ic)?`${it} – ${ic}`:(ic||it||'-');
        const unit = lok || ec || 'Tidak tercatat';
        const eng = [et,ec].filter(Boolean).join(' – ');
        const dt=get('damageType'), dn=get('damageNote');
        const damage = dn ? `${dt}${dt&&dn?' — ':''}${dn}` : dt;
        let sp = get('sparepart')||'-';
        sp = sp.replace(/[\r\n]+/g,'; ').replace(/\s*;\s*/g,'; ');
        const pr=get('prNumber');
        let st = get('status');
        if(!st){ st = pr?'Proses':'Belum Ditangani'; }
        else {
            const sl=st.toLowerCase();
            if(sl.includes('selesai')||sl.includes('done')||sl.includes('fixed')) st='Selesai';
            else if(sl.includes('proses')||sl.includes('progres')||sl.includes('dikerjakan')) st='Proses';
            else st='Belum Ditangani';
        }
        const qm=(get('qty').match(/\d+/));
        const qty=qm?parseInt(qm[0],10):1;
        if(!lok && !ic && !dt && sp==='-') continue;
        out.push({
            timestamp: ts.toISOString(), unit, irrigator, engine: eng||null,
            damage: damage||'-', damageType: dt||'-', sparepart: sp, qty,
            status, prNumber: pr||null, reporter: get('divisi')||'-', divisi: get('divisi')||null, notes: dn||''
        });
    }
    return out.sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
}

// ---------- Demo fallback ----------
function generateDemoData() {
    const units=['104I','144D1','185B','118F','102C','137A','118H','102G','169A','172F','103E','163B'];
    const irrigators=['BTI – 0032','BTI – 0045','BTI – 0078','RKD – 0012','RKD – 0025','KPP – 0008'];
    const damages=['Pompa Sumur Bor','Pipa Tersumbat','Kebocoran Pipa','Kerusakan Engine','Valve Rusak','Bearing Rusak'];
    const damageNotes=['Air kecil','Patah as sumur','Karung masuk pompa','Tekanan drop','Bocor di joint','Konslet'];
    const spareparts=['Pompa Submersible','Bearing 6205','Pipa PVC 3"','Seal Mechanical','Valve 2"','O-Ring Set','Packing Gasket','Filter Cartridge'];
    const data=[];
    const now=new Date();
    for(let i=0;i<80;i++){
        const d=new Date(now);
        d.setDate(d.getDate()-Math.floor(Math.random()*60));
        const r=Math.random();
        const st=r<0.45?'Belum Ditangani':r<0.75?'Proses':'Selesai';
        data.push({
            timestamp:d.toISOString(),
            unit:units[Math.floor(Math.random()*units.length)],
            irrigator:irrigators[Math.floor(Math.random()*irrigators.length)],
            engine:'Engine – ENG'+(Math.floor(Math.random()*200)+100),
            damage:damages[Math.floor(Math.random()*damages.length)]+' — '+damageNotes[Math.floor(Math.random()*damageNotes.length)],
            damageType:damages[Math.floor(Math.random()*damages.length)],
            sparepart:spareparts[Math.floor(Math.random()*spareparts.length)],
            qty:Math.floor(Math.random()*5)+1,
            status:st,
            prNumber:(st==='Proses'?String(Math.floor(Math.random()*9000000)+1000000):null),
            reporter:'PG2', divisi:'PG2', notes:''
        });
    }
    return data.sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
}

// ---------- Live fetch via Google Visualization CSV endpoint ----------
async function fetchLiveCSV() {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}&t=${Date.now()}`;
    try {
        const ctrl = new AbortController();
        const tid = setTimeout(()=>ctrl.abort(),12000);
        const res = await fetch(url,{signal:ctrl.signal,cache:'no-store'});
        clearTimeout(tid);
        if(!res.ok) return null;
        const txt = await res.text();
        if(txt.length<50||txt.trim().toLowerCase().startsWith('<!')) return null;
        return normalizeRowsFromCSV(parseCSV(txt));
    } catch(e){ return null; }
}

// ---------- Main loader ----------
async function refreshData(forceLive=false) {
    const icon=document.getElementById('refreshIcon');
    icon.classList.add('fa-spin');
    document.getElementById('loadingState').classList.remove('hidden');
    document.getElementById('tableBody').innerHTML='';
    document.getElementById('emptyState').classList.add('hidden');
    let data=null, source='cache';

    if(forceLive){
        data = await fetchLiveCSV();
        if(data && data.length) source='live-sheet';
    }
    if(!data){
        try{
            const res = await fetch(DATA_URL+'?t='+Date.now(),{cache:'no-store'});
            if(res.ok){
                const json = await res.json();
                if(Array.isArray(json) && json.length){ data=json; source='github-cache'; }
            }
        }catch(e){}
    }
    if(!data || !data.length){
        data=generateDemoData(); source='demo';
        showToast('Data real-time tidak tersedia. Menampilkan data demo. Pastikan spreadsheet dishare: Anyone with link – Viewer.','warning');
    }
    rawData = data;
    document.getElementById('syncTime').textContent = new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
    const srcLabel = {
        'live-sheet':'Live (Google Sheets)',
        'github-cache':'Sync dari GitHub',
        'demo':'Data Demo'
    }[source];
    document.getElementById('dataSource').textContent = srcLabel + ` · ${data.length} record`;
    const dot = document.getElementById('dataSourceDot');
    dot.className = 'w-2 h-2 rounded-full pulse-dot ' + (source==='live-sheet'?'bg-green-500':source==='github-cache'?'bg-blue-500':'bg-amber-500');
    icon.classList.remove('fa-spin');
    initUnitFilter();
    applyFilters();
}

// ---------- Date utilities ----------
function startOfDay(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate());}
function startOfWeek(d){const x=startOfDay(d);x.setDate(x.getDate()-((x.getDay()+6)%7));return x;}
function startOfMonth(d){return new Date(d.getFullYear(),d.getMonth(),1);}
function fmtDate(d){return d.toISOString().slice(0,10);}
function fmtDateTime(d){const dt=(d instanceof Date)?d:new Date(d);return dt.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})+' '+dt.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});}

// ---------- Filters ----------
function setFilter(f){
    currentFilter=f;
    currentPage=1;
    document.querySelectorAll('.filter-btn').forEach(b=>{
        if(b.dataset.filter===f){b.classList.add('active');b.classList.remove('text-slate-600');}
        else{b.classList.remove('active');b.classList.add('text-slate-600');}
    });
    document.getElementById('dateFrom').value='';
    document.getElementById('dateTo').value='';
    applyFilters();
}
function getFilterRange(){
    const now=new Date();
    if(currentFilter==='daily')return{from:startOfDay(now),to:now,label:'Hari ini ('+now.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})+')'};
    if(currentFilter==='weekly')return{from:startOfWeek(now),to:now,label:'Minggu ini'};
    if(currentFilter==='monthly')return{from:startOfMonth(now),to:now,label:'Bulan ini ('+now.toLocaleDateString('id-ID',{month:'long',year:'numeric'})+')'};
    return{from:new Date(1970,0,1),to:now,label:'Semua data'};
}
function applyCustomFilter(){
    if(document.getElementById('dateFrom').value&&document.getElementById('dateTo').value){
        currentFilter='custom';
        document.querySelectorAll('.filter-btn').forEach(b=>{b.classList.remove('active');b.classList.add('text-slate-600');});
        currentPage=1;applyFilters();
    }
}
function initUnitFilter(){
    const select=document.getElementById('unitFilter');const curr=select.value;
    const units=[...new Set(rawData.map(d=>d.unit))].filter(Boolean).sort();
    select.innerHTML='<option value="">Semua Unit</option>'+units.map(u=>`<option value="${u}">${u}</option>`).join('');
    select.value=curr;
}
function applyFilters(){
    const range=getFilterRange();
    const cf=document.getElementById('dateFrom').value,ct=document.getElementById('dateTo').value;
    let from=range.from,to=range.to,label=range.label;
    if(cf&&ct){
        from=new Date(cf);from.setHours(0,0,0,0);
        to=new Date(ct);to.setHours(23,59,59,999);
        label=`${from.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})} s/d ${to.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})}`;
    }
    const uF=document.getElementById('unitFilter').value;
    const sF=document.getElementById('statusFilter').value;
    const q=document.getElementById('searchInput').value.toLowerCase().trim();

    filteredData=rawData.filter(d=>{
        const t=new Date(d.timestamp);
        if(t<from||t>to)return false;
        if(uF&&d.unit!==uF)return false;
        if(sF&&d.status!==sF)return false;
        if(q){
            const blob=`${d.unit} ${d.irrigator} ${d.engine||''} ${d.damage} ${d.sparepart} ${d.status} ${d.prNumber||''} ${d.reporter||''}`.toLowerCase();
            if(!blob.includes(q))return false;
        }
        return true;
    });
    document.getElementById('activePeriodText').textContent=label;
    updateStats();renderCharts();renderTable();
}

// ---------- Stats ----------
function updateStats(){
    const total=filteredData.length;
    const units=new Set(filteredData.map(d=>d.unit)).size;
    const pending=filteredData.filter(d=>d.status==='Belum Ditangani'||d.status==='Proses').length;
    const done=filteredData.filter(d=>d.status==='Selesai').length;
    animateNumber('statTotal',total);animateNumber('statUnits',units);animateNumber('statPending',pending);animateNumber('statDone',done);
}
function animateNumber(id,target){
    const el=document.getElementById(id);const curr=parseInt(el.textContent.replace(/\./g,''))||0;
    const step=Math.max(1,Math.ceil(Math.abs(target-curr)/15));let v=curr;
    const fn=setInterval(()=>{
        if(v<target)v=Math.min(v+step,target);
        else if(v>target)v=Math.max(v-step,target);
        el.textContent=v.toLocaleString('id-ID');
        if(v===target)clearInterval(fn);
    },25);
}

// ---------- Charts ----------
const chartColors=['#3b82f6','#ef4444','#f59e0b','#10b981','#8b5cf6','#ec4899','#06b6d4','#f97316','#84cc16','#6366f1'];
function destroyChart(k){if(charts[k]){charts[k].destroy();}}
function renderCharts(){renderTrendChart();renderStatusChart();renderUnitChart();renderSparepartChart();renderIrrigatorChart();renderDamageChart();}

function chartOpts(extra={}){
    return{
        responsive:true,maintainAspectRatio:false,
        plugins:{
            legend:{display:true,labels:{font:{size:11}}},
            tooltip:{backgroundColor:'#1e293b',padding:12,cornerRadius:8,titleFont:{size:12,weight:'bold'},bodyFont:{size:11}}
        },
        scales:extra.indexAxis==='y'?{
            x:{grid:{display:false},ticks:{font:{size:10}},beginAtZero:true},
            y:{grid:{color:'#f1f5f9'},ticks:{font:{size:10}}}
        }:{
            x:{grid:{display:false},ticks:{font:{size:10},maxRotation:0,autoSkip:true,maxTicksLimit:12}},
            y:{grid:{color:'#f1f5f9'},ticks:{font:{size:10},precision:0},beginAtZero:true}
        },...extra
    };
}

function renderTrendChart(){
    destroyChart('trend');
    const groups={};let getKey;
    if(currentFilter==='daily'){getKey=d=>String(d.getHours()).padStart(2,'0')+':00';for(let h=0;h<24;h++)groups[h+':00']=0;}
    else if(currentFilter==='weekly'){getKey=d=>['Min','Sen','Sel','Rab','Kam','Jum','Sab'][d.getDay()];['Sen','Sel','Rab','Kam','Jum','Sab','Min'].forEach(k=>groups[k]=0);}
    else if(currentFilter==='monthly'){
        getKey=d=>d.getDate();
        const dim=new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate();
        for(let i=1;i<=dim;i++)groups[i]=0;
    } else { getKey=d=>d.toLocaleDateString('id-ID',{month:'short',year:'numeric'}); }
    filteredData.forEach(d=>{const k=getKey(new Date(d.timestamp));groups[k]=(groups[k]||0)+1;});
    const labels=Object.keys(groups),data=Object.values(groups);
    const ctx=document.getElementById('trendChart').getContext('2d');
    const grad=ctx.createLinearGradient(0,0,0,280);
    grad.addColorStop(0,'rgba(37,99,235,0.35)');grad.addColorStop(1,'rgba(37,99,235,0)');
    charts.trend=new Chart(ctx,{type:'line',data:{labels,datasets:[{label:'Jumlah Laporan',data,borderColor:'#2563eb',backgroundColor:grad,borderWidth:2.5,fill:true,tension:0.4,pointRadius:3,pointBackgroundColor:'#2563eb',pointHoverRadius:6}]},options:chartOpts({legend:{display:false}})});
}
function renderStatusChart(){
    destroyChart('status');
    const g={'Belum Ditangani':0,'Proses':0,'Selesai':0};
    filteredData.forEach(d=>{if(g[d.status]!==undefined)g[d.status]++;});
    charts.status=new Chart(document.getElementById('statusChart').getContext('2d'),{
        type:'doughnut',
        data:{labels:Object.keys(g),datasets:[{data:Object.values(g),backgroundColor:['#ef4444','#f59e0b','#10b981'],borderWidth:0,hoverOffset:8}]},
        options:{responsive:true,maintainAspectRatio:false,cutout:'70%',plugins:{legend:{position:'bottom',labels:{usePointStyle:true,padding:15,font:{size:11}}}}}
    });
}
function renderBarChart(id,k,colorIdx,horizontal,top,field,useQty){
    destroyChart(k);
    const groups={};
    filteredData.forEach(d=>{
        const f=d[field];
        if(f&&f!==' '&&f!=='-')groups[f]=(groups[f]||0)+(useQty?(d.qty||1):1);
    });
    const sorted=Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0,top);
    charts[k]=new Chart(document.getElementById(id).getContext('2d'),{
        type:'bar',
        data:{labels:sorted.map(s=>s[0]),datasets:[{
            label:useQty?'Total Qty':'Jumlah',data:sorted.map(s=>s[1]),
            backgroundColor:Array.isArray(colorIdx)?sorted.map((_,i)=>chartColors[i%chartColors.length]):chartColors[colorIdx],
            borderRadius:6,borderSkipped:false
        }]},
        options:chartOpts({indexAxis:horizontal?'y':'x',legend:{display:false}})
    });
}
function renderUnitChart(){renderBarChart('unitChart','unit',0,true,10,'unit',false);}
function renderSparepartChart(){renderBarChart('sparepartChart','sparepart',2,true,10,'sparepart',true);}
function renderIrrigatorChart(){
    // hanya yang punya irrigator terisi
    destroyChart('irrigator');
    const groups={};
    filteredData.forEach(d=>{if(d.irrigator&&d.irrigator!=='-')groups[d.irrigator]=(groups[d.irrigator]||0)+1;});
    const sorted=Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0,10);
    charts.irrigator=new Chart(document.getElementById('irrigatorChart').getContext('2d'),{
        type:'bar',
        data:{labels:sorted.map(s=>s[0]),datasets:[{label:'Kerusakan',data:sorted.map(s=>s[1]),backgroundColor:'#ef4444',borderRadius:6,borderSkipped:false}]},
        options:chartOpts({legend:{display:false}})
    });
}
function renderDamageChart(){
    destroyChart('damage');
    const groups={};
    filteredData.forEach(d=>{if(d.damageType&&d.damageType!=='-')groups[d.damageType]=(groups[d.damageType]||0)+1;});
    const sorted=Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0,7);
    charts.damage=new Chart(document.getElementById('damageChart').getContext('2d'),{
        type:'polarArea',
        data:{labels:sorted.map(s=>s[0]),datasets:[{data:sorted.map(s=>s[1]),backgroundColor:chartColors.map(c=>c+'cc'),borderWidth:0}]},
        options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{boxWidth:10,font:{size:10},padding:8}}}}
    });
}

// ---------- Table ----------
function renderTable(){
    document.getElementById('loadingState').classList.add('hidden');
    const tbody=document.getElementById('tableBody');
    const sorted=[...filteredData].sort((a,b)=>{
        let av=a[sortField],bv=b[sortField];
        if(sortField==='timestamp'){av=new Date(av).getTime();bv=new Date(bv).getTime();}
        else if(sortField==='qty'){av=Number(av);bv=Number(bv);}
        av=String(av||'').toLowerCase();bv=String(bv||'').toLowerCase();
        if(av<bv)return sortDir==='asc'?-1:1;
        if(av>bv)return sortDir==='asc'?1:-1;
        return 0;
    });
    const totalPages=Math.max(1,Math.ceil(sorted.length/PAGE_SIZE));
    if(currentPage>totalPages)currentPage=totalPages;
    const start=(currentPage-1)*PAGE_SIZE;
    const page=sorted.slice(start,start+PAGE_SIZE);
    document.getElementById('emptyState').classList.toggle('hidden',sorted.length!==0);

    tbody.innerHTML=page.map(d=>{
        const sb={
            'Belum Ditangani':'<span class="status-badge bg-red-100 text-red-700"><i class="fas fa-circle text-[6px] mr-1"></i>Belum Ditangani</span>',
            'Proses':'<span class="status-badge bg-amber-100 text-amber-700"><i class="fas fa-circle text-[6px] mr-1"></i>Proses</span>',
            'Selesai':'<span class="status-badge bg-emerald-100 text-emerald-700"><i class="fas fa-check text-[9px] mr-1"></i>Selesai</span>'
        }[d.status]||`<span class="status-badge bg-slate-100 text-slate-700">${d.status}</span>`;

        const prHtml = d.prNumber
            ? `<div class="text-[10px] text-slate-400 mt-0.5"><i class="fas fa-file-invoice mr-0.5"></i>PR: ${d.prNumber}</div>`
            : '';

        const engHtml = d.engine
            ? `<div class="text-[10px] text-slate-400 mt-0.5"><i class="fas fa-cog mr-0.5"></i>${d.engine}</div>`
            : '';

        return `<tr class="table-row transition">
            <td class="px-5 py-3 text-slate-600 text-xs whitespace-nowrap">
                <div class="font-medium text-slate-800">${fmtDateTime(d.timestamp)}</div>
            </td>
            <td class="px-5 py-3">
                <span class="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 px-2.5 py-1 rounded-md text-xs font-semibold">
                    <i class="fas fa-map-marker-alt text-[10px]"></i>${d.unit}
                </span>
                ${engHtml}
            </td>
            <td class="px-5 py-3 font-medium text-slate-700 text-xs whitespace-nowrap">
                ${d.irrigator!=='-'?'<i class="fas fa-water-ladder text-slate-400 mr-1 text-[10px]"></i>'+d.irrigator:'<span class="text-slate-400">—</span>'}
            </td>
            <td class="px-5 py-3 text-slate-600 text-xs max-w-[220px]">
                <div class="font-medium text-slate-700">${d.damageType&&d.damageType!=='-'?d.damageType:''}</div>
                <div class="text-slate-500 text-[11px] ${d.damageType&&d.damageType!=='-'?'mt-0.5':''}">${d.notes||''}</div>
            </td>
            <td class="px-5 py-3 text-slate-600 text-xs max-w-[220px]">
                ${d.sparepart!=='-'?'<span class="text-slate-700">'+d.sparepart+'</span>'+prHtml:'<span class="text-slate-400 italic">Belum ditentukan</span>'}
            </td>
            <td class="px-5 py-3">
                <span class="inline-flex items-center justify-center w-7 h-7 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold">${d.qty}</span>
            </td>
            <td class="px-5 py-3 whitespace-nowrap">${sb}</td>
            <td class="px-5 py-3 text-slate-600 text-xs whitespace-nowrap">
                <i class="fas fa-user text-slate-400 mr-1 text-[10px]"></i>${d.reporter}
                ${d.divisi?`<div class="text-[10px] text-slate-400">Div. ${d.divisi}</div>`:''}
            </td>
        </tr>`;
    }).join('');

    document.getElementById('tableCount').textContent=`Menampilkan ${page.length} dari ${sorted.length} data`;
    document.getElementById('pageInfo').textContent=`Halaman ${currentPage} / ${totalPages}`;
    document.getElementById('prevBtn').disabled=currentPage===1;
    document.getElementById('nextBtn').disabled=currentPage===totalPages;
}
function sortTable(field){
    if(sortField===field)sortDir=sortDir==='asc'?'desc':'asc';
    else{sortField=field;sortDir=field==='qty'||field==='timestamp'?'desc':'asc';}
    renderTable();
}
function prevPage(){if(currentPage>1){currentPage--;renderTable();}}
function nextPage(){const tp=Math.ceil(filteredData.length/PAGE_SIZE);if(currentPage<tp){currentPage++;renderTable();}}

// ---------- Export CSV ----------
function exportCSV(){
    const headers=['Tanggal','Unit/Lokasi','Engine','Irrigator','Jenis Kerusakan','Keterangan','Sparepart','Qty','Nomor PR','Status','Divisi/Pelapor'];
    const rows=filteredData.map(d=>[fmtDateTime(d.timestamp),d.unit,d.engine||'',d.irrigator,d.damageType,d.notes,d.sparepart,d.qty,d.prNumber||'',d.status,d.reporter]);
    const csv=[headers.join(','),...rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(','))].join('\n');
    const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=`PG2_Spareparts_Report_${fmtDate(new Date())}.csv`;a.click();
    URL.revokeObjectURL(url);
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
    document.getElementById('dateTo').max=fmtDate(new Date());
    refreshData(false);
    setInterval(()=>refreshData(false),5*60*1000);
});
