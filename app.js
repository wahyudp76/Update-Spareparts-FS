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
let currentFilter = 'all';  // default semua saat load agar kalender terisi penuh
let currentPage = 1;
const PAGE_SIZE = 15;
let sortField = 'timestamp';
let sortDir = 'desc';
let charts = {};
let calMonth = new Date();
calMonth.setDate(1);
let selectedDate = null; // ISO date string 'YYYY-MM-DD' or null

// ---------- CSV parser ----------
function parseCSV(text) {
    const rows = []; let cur = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQ) { if (c==='"') { if (text[i+1]==='"') { field+='"'; i++; } else inQ=false; } else field+=c; }
        else {
            if (c==='"') inQ=true;
            else if (c===',') { cur.push(field); field=''; }
            else if (c==='\n'||c==='\r') {
                if (c==='\r' && text[i+1]==='\n') i++;
                cur.push(field);
                if (cur.some(x=>x && x.trim()!=='')) rows.push(cur);
                cur=[]; field='';
            } else field+=c;
        }
    }
    if (field.length||cur.length) { cur.push(field); if (cur.some(x=>x&&x.trim()!=='')) rows.push(cur); }
    return rows;
}
function parseDate(s) {
    if(!s) return null;
    s = String(s).trim(); if(!s) return null;
    let d = new Date(s); if(!isNaN(d.getTime())) return d;
    const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if(m) {
        const a=+m[1],b=+m[2]; const mo=a>12?b-1:a-1, dy=a>12?a:b;
        d = new Date(+m[3],mo,dy,+(m[4]||0),+(m[5]||0),+(m[6]||0));
        if(!isNaN(d.getTime())) return d;
    }
    const m2 = s.match(/(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?/);
    if(m2){
        const a=+m2[1],b=+m2[2]; let dy,mo;
        if(a>12){dy=a;mo=b-1;} else if(b>12){dy=b;mo=a-1;} else {dy=b;mo=a-1;}
        d = new Date(+m2[3],mo,dy,+(m2[4]||0),+(m2[5]||0));
        if(!isNaN(d.getTime())) return d;
    }
    return null;
}
function normalizeFromCSV(rows) {
    if(!rows.length) return [];
    const headers = rows[0].map(h=>String(h||'').trim());
    const hi = {ts:-1, tglInsp:-1, lok:-1, div:-1, eT:-1, eC:-1, iT:-1, iC:-1, dT:-1, dN:-1, sp:-1, pr:-1};
    headers.forEach((name,i)=>{
        const k=String(name).toLowerCase().trim();
        if(k==='timestamp') hi.ts=i;
        else if(k.includes('tanggal inspeksi')) hi.tglInsp=i;
        else if(k.includes('lokasi')) hi.lok=i;
        else if(k.includes('divisi')) hi.div=i;
        else if(k.includes('jenis engine')) hi.eT=i;
        else if(k.includes('kode engine')) hi.eC=i;
        else if(k.includes('jenis irrigator')) hi.iT=i;
        else if(k.includes('kode irrigator')) hi.iC=i;
        else if(k.includes('jenis kerusakan')||k==='kerusakan') hi.dT=i;
        else if(k.includes('keterangan kerusakan')||k.includes('detail')) hi.dN=i;
        else if(k.includes('sparepart')) hi.sp=i;
        else if(k.includes('pr')||k.includes('notifikasi')) hi.pr=i;
    });
    const out=[];
    for(let i=1;i<rows.length;i++){
        const r=rows[i];
        const get=f=>hi[f]>=0?String(r[hi[f]]||'').trim():'';
        const tgl = parseDate(get('tglInsp')) || parseDate(get('ts')) || new Date();
        const lok=get('lok'), et=get('eT'), ec=get('eC'), it=get('iT'), ic=get('iC'), div=get('div');
        const dt=get('dT'), dn=get('dN'), sp=get('sp'), pr=get('pr');
        const irrigator = (it&&ic&&it!==ic)?`${it} – ${ic}`:(ic||it||'-');
        const engine = [et,ec].filter(Boolean).join(' – ');
        const damage = dn ? (dt?`${dt} — ${dn}`:dn) : (dt||'-');
        const spNorm = sp ? sp.replace(/[\r\n]+/g,'; ').replace(/\s*;\s*/g,'; ') : '-';
        const status = pr ? 'Proses' : 'Belum Ditangani';
        if(!lok && !ic && !dt && spNorm==='-') continue;
        out.push({
            timestamp: tgl.toISOString(),
            tanggalInspeksi: tgl.toISOString().slice(0,10),
            lokasi: lok || '-', divisi: div || '-',
            engineType: et || '-', engineCode: ec || '-',
            engine: engine || '-',
            irrType: it || '-', irrCode: ic || '-', irrigator,
            damageType: dt || '-', keterangan: dn || '', damage,
            sparepart: spNorm, prNumber: pr || null, status,
            unit: lok || '-'
        });
    }
    return out.sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
}

// ---------- Demo fallback ----------
function generateDemo() {
    const lok=['104I','144D1','185B','118F','102C','137A','118H','102G','169A','172F'];
    const divs=['PG2','FM4','OP2'];
    const ets=['DEM','DEC','SPC'];
    const its=['BTI','RKD','KPP'];
    const dmg=[['Pompa Sumur Bor',['Air kecil','Patah as','Karung masuk']],['Turbin',['Bocor seal','As getar']],['Blok Mesin',['Bocor oli','Baut lepas']],['Pipa PE',['Bocor sambungan','Pecah']],['Prodo',['Rilis kopling rusak','Macet']]];
    const sp=['Seal Mechanical','Bearing 6205','Pipa PVC','O-Ring','Packing Gasket','Belt Ebara','Selang Oli','Seal Crankshaft'];
    const data=[]; const now=new Date();
    for(let i=0;i<60;i++){
        const d=new Date(now);
        d.setDate(d.getDate()-Math.floor(Math.random()*60));
        d.setHours(0,0,0,0);
        const hasPr = Math.random()>0.4;
        const dmgChoice = dmg[Math.floor(Math.random()*dmg.length)];
        const note = dmgChoice[1][Math.floor(Math.random()*dmgChoice[1].length)];
        data.push({
            timestamp:d.toISOString(),tanggalInspeksi:d.toISOString().slice(0,10),
            lokasi:lok[Math.floor(Math.random()*lok.length)],
            divisi:divs[Math.floor(Math.random()*divs.length)],
            engineType:ets[Math.floor(Math.random()*ets.length)],
            engineCode:String(Math.floor(Math.random()*200)+100).padStart(4,'0'),
            engine:'',
            irrType:its[Math.floor(Math.random()*its.length)],
            irrCode:String(Math.floor(Math.random()*200)+1).padStart(4,'0'),
            irrigator:'',damageType:dmgChoice[0],keterangan:note,
            damage:`${dmgChoice[0]} — ${note}`,
            sparepart:sp[Math.floor(Math.random()*sp.length)],
            prNumber: hasPr?String(Math.floor(Math.random()*9000000)+1000000):null,
            status: hasPr?'Proses':'Belum Ditangani', unit:''
        });
        data[data.length-1].engine = `${data[data.length-1].engineType} – ${data[data.length-1].engineCode}`;
        data[data.length-1].irrigator = `${data[data.length-1].irrType} – ${data[data.length-1].irrCode}`;
        data[data.length-1].unit = data[data.length-1].lokasi;
    }
    return data.sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
}

async function fetchLiveCSV() {
    const url=`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}&t=${Date.now()}`;
    try{
        const ctrl=new AbortController(); const tid=setTimeout(()=>ctrl.abort(),12000);
        const res=await fetch(url,{signal:ctrl.signal,cache:'no-store'});
        clearTimeout(tid);
        if(!res.ok) return null;
        const txt=await res.text();
        if(txt.length<50||txt.trim().toLowerCase().startsWith('<!')) return null;
        return normalizeFromCSV(parseCSV(txt));
    }catch(e){return null;}
}

async function refreshData(forceLive=false) {
    const icon=document.getElementById('refreshIcon');
    icon.classList.add('fa-spin');
    document.getElementById('loadingState').classList.remove('hidden');
    document.getElementById('tableBody').innerHTML='';
    document.getElementById('emptyState').classList.add('hidden');
    let data=null, source='cache';
    if(forceLive){ data=await fetchLiveCSV(); if(data&&data.length) source='live-sheet'; }
    if(!data){
        try{
            const res=await fetch(DATA_URL+'?t='+Date.now(),{cache:'no-store'});
            if(res.ok){
                const json=await res.json();
                if(Array.isArray(json)&&json.length){
                    // Back-fill fields jika data.json dari fetch script lama
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
        }catch(e){}
    }
    if(!data||!data.length){ data=generateDemo(); source='demo'; showToast('Menggunakan data demo. Pastikan spreadsheet dishare "Anyone with link – Viewer".','warning'); }
    rawData = data;
    document.getElementById('syncTime').textContent = new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
    const srcLabel = {'live-sheet':'Live (Sheets)','github-cache':'Sync GitHub','demo':'Data Demo'}[source];
    document.getElementById('dataSource').textContent = `${srcLabel} · ${data.length} record`;
    const dot=document.getElementById('dataSourceDot');
    dot.className = 'w-2 h-2 rounded-full pulse-dot '+(source==='live-sheet'?'bg-green-500':source==='github-cache'?'bg-blue-500':'bg-amber-500');
    icon.classList.remove('fa-spin');
    initFilters(); renderCalendar(); applyFilters();
}

// ---------- Date utils ----------
function startOfDay(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate());}
function startOfWeek(d){const x=startOfDay(d);x.setDate(x.getDate()-((x.getDay()+6)%7));return x;}
function startOfMonth(d){return new Date(d.getFullYear(),d.getMonth(),1);}
function isoDate(d){const x=new Date(d);x.setHours(0,0,0,0);return x.toISOString().slice(0,10);}
function fmtDateTime(d){const dt=(d instanceof Date)?d:new Date(d);return dt.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})+' '+dt.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});}
function fmtDate(d){return new Date(d).toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric',weekday:'long'});}

// ---------- Filters ----------
function setFilter(f){
    currentFilter=f; currentPage=1; selectedDate=null;
    document.querySelectorAll('.filter-btn').forEach(b=>{
        if(b.dataset.filter===f){b.classList.add('active');b.classList.remove('text-slate-600');}
        else{b.classList.remove('active');b.classList.add('text-slate-600');}
    });
    document.getElementById('dateFrom').value='';document.getElementById('dateTo').value='';
    document.getElementById('selectedDateBadge').classList.add('hidden');
    applyFilters();
}
function getFilterRange(){
    const now=new Date();
    if(currentFilter==='daily')return{from:startOfDay(now),to:now,label:'Hari ini ('+now.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})+')'};
    if(currentFilter==='weekly')return{from:startOfWeek(now),to:now,label:'Minggu ini'};
    if(currentFilter==='monthly')return{from:startOfMonth(now),to:now,label:now.toLocaleDateString('id-ID',{month:'long',year:'numeric'})};
    return{from:new Date(1970,0,1),to:now,label:'Semua data'};
}
function applyCustomFilter(){
    if(document.getElementById('dateFrom').value&&document.getElementById('dateTo').value){
        currentFilter='custom';
        document.querySelectorAll('.filter-btn').forEach(b=>{b.classList.remove('active');b.classList.add('text-slate-600');});
        currentPage=1;selectedDate=null;document.getElementById('selectedDateBadge').classList.add('hidden');applyFilters();
    }
}
function initFilters(){
    const divs=[...new Set(rawData.map(d=>d.divisi))].filter(Boolean).sort();
    const ds=document.getElementById('divisiFilter'); const cur=ds.value;
    ds.innerHTML='<option value="">Semua Divisi</option>'+divs.map(v=>`<option value="${v}">${v}</option>`).join('');
    ds.value=cur;
}
function applyFilters(){
    const range=getFilterRange();
    const cf=document.getElementById('dateFrom').value,ct=document.getElementById('dateTo').value;
    let from=range.from, to=range.to, label=range.label;
    if(cf&&ct){from=new Date(cf);from.setHours(0,0,0,0);to=new Date(ct);to.setHours(23,59,59,999);label=`${new Date(cf).toLocaleDateString('id-ID')} – ${new Date(ct).toLocaleDateString('id-ID')}`;}
    const dF=document.getElementById('divisiFilter').value;
    const sF=document.getElementById('statusFilter').value;
    const q=document.getElementById('searchInput').value.toLowerCase().trim();

    filteredData=rawData.filter(d=>{
        const t=new Date(d.timestamp);
        if(t<from||t>to) return false;
        if(selectedDate && d.tanggalInspeksi !== selectedDate) return false;
        if(dF && d.divisi !== dF) return false;
        if(sF && d.status !== sF) return false;
        if(q){
            const blob=`${d.lokasi} ${d.divisi} ${d.engine} ${d.engineCode} ${d.irrigator} ${d.damageType} ${d.keterangan} ${d.sparepart} ${d.prNumber||''} ${d.status}`.toLowerCase();
            if(!blob.includes(q)) return false;
        }
        return true;
    });

    if(selectedDate){
        label = fmtDate(selectedDate);
        document.getElementById('selectedDateBadge').classList.remove('hidden');
        document.getElementById('selectedDateText').textContent = fmtDate(selectedDate);
    }
    document.getElementById('activePeriodText').textContent = label;
    updateStats(); renderCharts(); renderCalDayDetail(); renderTable();
}
function clearSelectedDate(){ selectedDate=null; document.getElementById('selectedDateBadge').classList.add('hidden'); applyFilters(); renderCalendar(); }

// ---------- Stats ----------
function updateStats(){
    const t=filteredData.length;
    const loc=new Set(filteredData.map(d=>d.lokasi)).size;
    const proses=filteredData.filter(d=>d.status==='Proses').length;
    const pending=filteredData.filter(d=>d.status==='Belum Ditangani').length;
    animateNumber('statTotal',t);animateNumber('statUnits',loc);animateNumber('statProses',proses);animateNumber('statPending',pending);
}
function animateNumber(id,tgt){
    const el=document.getElementById(id); const cur=parseInt(el.textContent.replace(/\./g,''))||0;
    const step=Math.max(1,Math.ceil(Math.abs(tgt-cur)/15)); let v=cur;
    const fn=setInterval(()=>{
        if(v<tgt)v=Math.min(v+step,tgt); else if(v>tgt)v=Math.max(v-step,tgt);
        el.textContent=v.toLocaleString('id-ID'); if(v===tgt)clearInterval(fn);
    },25);
}

// ---------- Charts ----------
const CC=['#3b82f6','#ef4444','#f59e0b','#10b981','#8b5cf6','#ec4899','#06b6d4','#f97316','#84cc16','#6366f1'];
function dk(k){if(charts[k]){charts[k].destroy();}}
function baseOpts(extra={}){
    return{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:true,labels:{font:{size:11}}},tooltip:{backgroundColor:'#1e293b',padding:12,cornerRadius:8,titleFont:{size:12,weight:'bold'},bodyFont:{size:11}}},
        scales:extra.indexAxis==='y'?{x:{grid:{display:false},ticks:{font:{size:10}},beginAtZero:true},y:{grid:{color:'#f1f5f9'},ticks:{font:{size:10}}}}:{x:{grid:{display:false},ticks:{font:{size:10},maxRotation:0,autoSkip:true,maxTicksLimit:12},y:{grid:{color:'#f1f5f9'},ticks:{font:{size:10},precision:0},beginAtZero:true}},...extra};
}
function renderCharts(){
    dk('trend');dk('status');dk('lokasi');dk('sparepart');dk('jenis');dk('divisi');
    // Trend
    const groups={}; let getKey;
    if(currentFilter==='daily'){getKey=d=>String(d.getHours()).padStart(2,'0')+':00';for(let h=0;h<24;h++)groups[h+':00']=0;}
    else if(currentFilter==='weekly'){getKey=d=>['Min','Sen','Sel','Rab','Kam','Jum','Sab'][d.getDay()];['Sen','Sel','Rab','Kam','Jum','Sab','Min'].forEach(k=>groups[k]=0);}
    else if(currentFilter==='monthly'){
        getKey=d=>d.getDate();const dim=new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate();
        for(let i=1;i<=dim;i++)groups[i]=0;
    } else { getKey=d=>d.toLocaleDateString('id-ID',{day:'2-digit',month:'short'}); }
    filteredData.forEach(d=>{const k=getKey(new Date(d.timestamp));groups[k]=(groups[k]||0)+1;});
    const ctx=document.getElementById('trendChart').getContext('2d');
    const g=ctx.createLinearGradient(0,0,0,280);g.addColorStop(0,'rgba(37,99,235,0.35)');g.addColorStop(1,'rgba(37,99,235,0)');
    charts.trend=new Chart(ctx,{type:'line',data:{labels:Object.keys(groups),datasets:[{label:'Laporan',data:Object.values(groups),borderColor:'#2563eb',backgroundColor:g,borderWidth:2.5,fill:true,tension:0.4,pointRadius:3,pointBackgroundColor:'#2563eb'}]},options:baseOpts({legend:{display:false}})});
    // Status
    const sg={'Belum Ditangani':0,'Proses':0};
    filteredData.forEach(d=>{if(sg[d.status]!==undefined)sg[d.status]++;});
    charts.status=new Chart(document.getElementById('statusChart').getContext('2d'),{type:'doughnut',data:{labels:Object.keys(sg),datasets:[{data:Object.values(sg),backgroundColor:['#64748b','#f59e0b'],borderWidth:0,hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:false,cutout:'70%',plugins:{legend:{position:'bottom',labels:{usePointStyle:true,padding:15,font:{size:11}}}}}});
    // Bar helper
    function bar(id,field,color,h,top,label){
        const gp={};
        filteredData.forEach(d=>{const v=d[field];if(v&&v!==' '&&v!=='-')gp[v]=(gp[v]||0)+1;});
        const s=Object.entries(gp).sort((a,b)=>b[1]-a[1]).slice(0,top);
        charts[id]=new Chart(document.getElementById(id).getContext('2d'),{type:'bar',data:{labels:s.map(x=>x[0]),datasets:[{label:label||'Jumlah',data:s.map(x=>x[1]),backgroundColor:Array.isArray(color)?s.map((_,i)=>CC[i%CC.length]):color,borderRadius:6,borderSkipped:false}]},options:baseOpts({indexAxis:h?'y':'x',legend:{display:false}})});
    }
    bar('lokasiChart','lokasi',0,true,10);
    // Sparepart
    const spg={};
    filteredData.forEach(d=>{if(d.sparepart&&d.sparepart!=='-')d.sparepart.split(/;\s*/).forEach(sp=>{sp=sp.trim();if(sp)spg[sp]=(spg[sp]||0)+1;});});
    const sps=Object.entries(spg).sort((a,b)=>b[1]-a[1]).slice(0,8);
    charts.sparepart=new Chart(document.getElementById('sparepartChart').getContext('2d'),{type:'bar',data:{labels:sps.map(x=>x[0]),datasets:[{label:'Kebutuhan',data:sps.map(x=>x[1]),backgroundColor:'#f59e0b',borderRadius:6,borderSkipped:false}]},options:baseOpts({indexAxis:'y',legend:{display:false}})});
    // Jenis Kerusakan
    bar('jenisChart','damageType',CC.slice(0,7),false,8);
    // Divisi
    const dg={};filteredData.forEach(d=>{if(d.divisi&&d.divisi!=='-')dg[d.divisi]=(dg[d.divisi]||0)+1;});
    charts.divisi=new Chart(document.getElementById('divisiChart').getContext('2d'),{type:'doughnut',data:{labels:Object.keys(dg),datasets:[{data:Object.values(dg),backgroundColor:CC,borderWidth:0,hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{position:'bottom',labels:{usePointStyle:true,padding:12,font:{size:11}}}}}});
}

// ---------- Calendar ----------
function renderCalendar(){
    const grid=document.getElementById('calendarGrid');
    const monthNames=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    document.getElementById('calMonthYear').textContent = `${monthNames[calMonth.getMonth()]} ${calMonth.getFullYear()}`;
    // Kelompokkan data per tanggal (berdasarkan data penuh, bukan filteredData — agar kalender menampilkan semua laporan)
    const byDate={};
    rawData.forEach(d=>{ byDate[d.tanggalInspeksi]=(byDate[d.tanggalInspeksi]||0)+1; });

    // Hari pertama & terakhir bulan
    const first=new Date(calMonth.getFullYear(),calMonth.getMonth(),1);
    const firstWeekday=(first.getDay()+6)%7; // Senin = 0
    const daysInMonth=new Date(calMonth.getFullYear(),calMonth.getMonth()+1,0).getDate();
    const daysInPrev=new Date(calMonth.getFullYear(),calMonth.getMonth(),0).getDate();
    const todayIso=isoDate(new Date());

    let html='<div class="cal-weekday">Sen</div><div class="cal-weekday">Sel</div><div class="cal-weekday">Rab</div><div class="cal-weekday">Kam</div><div class="cal-weekday">Jum</div><div class="cal-weekday">Sab</div><div class="cal-weekday">Min</div>';

    // Prev month filler
    for(let i=firstWeekday-1;i>=0;i--){
        html+=`<div class="cal-day other-month">${daysInPrev-i}</div>`;
    }
    // Current month
    for(let d=1;d<=daysInMonth;d++){
        const date=new Date(calMonth.getFullYear(),calMonth.getMonth(),d);
        const iso=isoDate(date);
        const count=byDate[iso]||0;
        let cls='cal-day';
        if(count>0) cls+=' has-data';
        if(count>=3) cls+=' has-many';
        if(iso===todayIso) cls+=' today';
        if(iso===selectedDate) cls+=' selected';
        html+=`<div class="${cls}" data-date="${iso}" onclick="selectDate('${iso}')">${d}${count>0?`<span class="cal-dot"></span>`:''}</div>`;
    }
    // Next month filler
    const totalCells = firstWeekday + daysInMonth;
    const nextCells = (7 - (totalCells%7)) % 7;
    for(let i=1;i<=nextCells;i++){
        html+=`<div class="cal-day other-month">${i}</div>`;
    }
    grid.innerHTML=html;
    renderCalDayDetail();
}
function changeCalMonth(delta){
    calMonth.setMonth(calMonth.getMonth()+delta);
    renderCalendar();
}
function goToday(){
    calMonth=new Date(); calMonth.setDate(1);
    selectedDate=null;
    document.getElementById('selectedDateBadge').classList.add('hidden');
    renderCalendar();
    // Jangan reset filter periode biar pilihan filter user tetap, tapi hapus pemilihan tanggal
    applyFilters();
}
function selectDate(iso){
    selectedDate = (selectedDate === iso) ? null : iso;
    currentPage=1;
    // Set custom date range 1 hari tersebut agar filter periode ikut
    if(selectedDate){
        document.getElementById('dateFrom').value = selectedDate;
        document.getElementById('dateTo').value = selectedDate;
        calMonth = new Date(selectedDate + 'T00:00:00');
        calMonth.setDate(1);
        document.querySelectorAll('.filter-btn').forEach(b=>{b.classList.remove('active');b.classList.add('text-slate-600');});
    } else {
        document.getElementById('dateFrom').value='';document.getElementById('dateTo').value='';
        document.getElementById('selectedDateBadge').classList.add('hidden');
    }
    renderCalendar();
    applyFilters();
}
function renderCalDayDetail(){
    const box=document.getElementById('calDayDetail');
    const label=document.getElementById('calDateLabel');
    if(!selectedDate){
        label.textContent='—';
        box.innerHTML=`<div class="text-center py-12 text-slate-400 text-sm"><i class="fas fa-hand-pointer text-3xl mb-2 text-slate-300"></i><p>Klik tanggal di kalender<br>untuk melihat detail laporan</p></div>`;
        return;
    }
    const items = rawData.filter(d=>d.tanggalInspeksi===selectedDate);
    label.textContent = fmtDate(selectedDate)+` · ${items.length} laporan`;
    if(items.length===0){
        box.innerHTML=`<div class="text-center py-10 text-slate-400 text-sm"><i class="fas fa-calendar-check text-3xl mb-2 text-emerald-300"></i><p>Tidak ada laporan<br>di tanggal ini ✓</p></div>`;
        return;
    }
    box.innerHTML = items.map(d=>{
        const badge = d.status==='Proses'
            ? '<span class="status-badge bg-amber-100 text-amber-700"><i class="fas fa-circle text-[6px]"></i>Proses</span>'
            : '<span class="status-badge bg-slate-100 text-slate-700"><i class="fas fa-circle text-[6px]"></i>Belum</span>';
        return `<div class="border border-slate-200 rounded-lg p-3 hover:bg-slate-50 transition cursor-pointer" onclick="focusRecord('${d.lokasi}','${d.tanggalInspeksi}')">
            <div class="flex items-start justify-between gap-2 mb-1">
                <div class="flex items-center gap-1.5">
                    <span class="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-semibold"><i class="fas fa-map-marker-alt text-[9px]"></i>${d.lokasi}</span>
                    <span class="text-[10px] text-slate-400">${d.divisi}</span>
                </div>
                ${badge}
            </div>
            <div class="text-sm font-semibold text-slate-800 mb-1">${d.damageType||'-'}</div>
            ${d.keterangan?`<div class="text-xs text-slate-500 mb-1.5">${d.keterangan}</div>`:''}
            <div class="flex flex-wrap gap-2 text-[11px]">
                ${d.sparepart&&d.sparepart!=='-'?`<span class="inline-flex items-center gap-1 text-amber-700"><i class="fas fa-cog text-[9px]"></i>${d.sparepart}</span>`:''}
                ${d.engine&&d.engine!=='-'?`<span class="inline-flex items-center gap-1 text-slate-500"><i class="fas fa-engine text-[9px]"></i>${d.engine}</span>`:''}
                ${d.irrigator&&d.irrigator!=='-'?`<span class="inline-flex items-center gap-1 text-slate-500"><i class="fas fa-water-ladder text-[9px]"></i>${d.irrigator}</span>`:''}
                ${d.prNumber?`<span class="inline-flex items-center gap-1 text-blue-700"><i class="fas fa-file-invoice text-[9px]"></i>PR ${d.prNumber}</span>`:''}
            </div>
        </div>`;
    }).join('');
}
function focusRecord(lokasi,tgl){
    document.getElementById('searchInput').value = lokasi;
    applyFilters();
    document.getElementById('tableBody').scrollIntoView({behavior:'smooth',block:'start'});
}

// ---------- Table ----------
function renderTable(){
    document.getElementById('loadingState').classList.add('hidden');
    const tbody=document.getElementById('tableBody');
    const sorted=[...filteredData].sort((a,b)=>{
        let av=a[sortField],bv=b[sortField];
        if(sortField==='timestamp'){av=new Date(av).getTime();bv=new Date(bv).getTime();}
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
        const sb = d.status==='Proses'
            ? '<span class="status-badge bg-amber-100 text-amber-700"><i class="fas fa-circle text-[6px]"></i>Proses (PR Aktif)</span>'
            : '<span class="status-badge bg-slate-100 text-slate-700"><i class="fas fa-circle text-[6px]"></i>Belum Ditangani</span>';
        const engCell = (d.engine&&d.engine!=='-')
            ? `<div class="font-medium text-slate-700 text-xs">${d.engine}</div>`
            : '<span class="text-slate-400 italic text-xs">—</span>';
        const irrCell = (d.irrigator&&d.irrigator!=='-')
            ? `<div class="font-medium text-slate-700 text-xs">${d.irrigator}</div>`
            : '<span class="text-slate-400 italic text-xs">—</span>';
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
    document.getElementById('pageInfo').textContent=`Halaman ${currentPage} / ${totalPages}`;
    document.getElementById('prevBtn').disabled=currentPage===1;
    document.getElementById('nextBtn').disabled=currentPage===totalPages;
}
function sortTable(field){
    if(sortField===field)sortDir=sortDir==='asc'?'desc':'asc';
    else{sortField=field;sortDir=field==='timestamp'?'desc':'asc';}
    renderTable();
}
function prevPage(){if(currentPage>1){currentPage--;renderTable();}}
function nextPage(){const tp=Math.ceil(filteredData.length/PAGE_SIZE);if(currentPage<tp){currentPage++;renderTable();}}

// ---------- Export CSV (kolom sesuai sheet) ----------
function exportCSV(){
    const headers=['Timestamp','Tanggal Inspeksi','Lokasi','Divisi','Jenis Engine','Kode Engine','Jenis Irrigator','Kode Irrigator','Jenis Kerusakan','Keterangan Kerusakan','Spareparts Yang Dibutuhkan','Nomor PR / Notifikasi','Status'];
    const rows=filteredData.map(d=>[
        new Date(d.timestamp).toISOString(),
        d.tanggalInspeksi,d.lokasi,d.divisi,d.engineType,d.engineCode,
        d.irrType,d.irrCode,d.damageType,d.keterangan,d.sparepart,d.prNumber||'',d.status
    ]);
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
    // default filter "Semua" agar kalender terisi penuh saat load pertama
    setFilter('all');
    refreshData(false);
    setInterval(()=>refreshData(false),5*60*1000);
});
