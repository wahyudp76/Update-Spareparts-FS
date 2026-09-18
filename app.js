// ======================================================
// PG2 Irrigation Dashboard - Main Application
// ======================================================
const SHEET_ID = '1TZiQfgiVXmXCLorD1BePuH2wEDnUcy_zWTivQSE3fUk';
const SHEET_NAME = 'Response';
const STORAGE_KEY_API = 'pg2_apps_script_url';

let rawData = [];
let filteredData = [];
let currentFilter = 'daily';
let currentPage = 1;
const PAGE_SIZE = 15;
let sortField = 'timestamp';
let sortDir = 'desc';
let charts = {};

// ---- Demo Data (digunakan sebelum Apps Script di-deploy) ----
function generateDemoData() {
    const units = ['PG2-A1','PG2-A2','PG2-A3','PG2-B1','PG2-B2','PG2-B3','PG2-C1','PG2-C2','PG2-D1','PG2-D2','PG2-D3'];
    const irrigators = ['Irr-01','Irr-02','Irr-03','Irr-04','Irr-05','Irr-06','Irr-07','Irr-08','Irr-09','Irr-10'];
    const damages = ['Kebocoran Pipa','Kerusakan Pompa','Kerusakan Sprinkler','Valve Rusak','Filter Tersumbat','Kebocoran Seal','Motor Mogok','Tekanan Rendah','Pipa Pecah','Bearing Rusak'];
    const spareparts = ['Pipa PVC 3"','Seal Karet','Pompa Submersible','Sprinkler Head','Valve Gate 2"','Filter Cartridge','Motor 1HP','Bearing 6205','O-Ring Set','Packing Gasket','Baut & Mur','Kabel Listrik'];
    const statuses = ['Belum Ditangani','Proses','Selesai','Belum Ditangani','Proses'];
    const reporters = ['Budi Santoso','Ahmad Fauzi','Slamet Riyadi','Joko Widodo','Dedi Kurniawan','Rudi Hartono'];

    const data = [];
    const now = new Date();
    for (let i = 0; i < 120; i++) {
        const daysAgo = Math.floor(Math.random() * 90);
        const d = new Date(now);
        d.setDate(d.getDate() - daysAgo);
        d.setHours(Math.floor(Math.random()*24), Math.floor(Math.random()*60));

        data.push({
            timestamp: d,
            unit: units[Math.floor(Math.random()*units.length)],
            irrigator: irrigators[Math.floor(Math.random()*irrigators.length)],
            damage: damages[Math.floor(Math.random()*damages.length)],
            sparepart: spareparts[Math.floor(Math.random()*spareparts.length)],
            qty: Math.floor(Math.random()*10)+1,
            status: statuses[Math.floor(Math.random()*statuses.length)],
            reporter: reporters[Math.floor(Math.random()*reporters.length)],
            notes: ''
        });
    }
    return data.sort((a,b) => b.timestamp - a.timestamp);
}

// ---- Date utilities ----
function startOfDay(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate());}
function startOfWeek(d){const x=startOfDay(d);x.setDate(x.getDate()-x.getDay());return x;}
function startOfMonth(d){return new Date(d.getFullYear(),d.getMonth(),1);}
function fmtDate(d){return d.toISOString().slice(0,10);}
function fmtDateTime(d){return d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})+' '+d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});}

// ---- Data loading ----
async function refreshData() {
    const icon = document.getElementById('refreshIcon');
    icon.classList.add('fa-spin');
    document.getElementById('loadingState').classList.remove('hidden');
    document.getElementById('tableBody').innerHTML = '';
    document.getElementById('emptyState').classList.add('hidden');

    const apiUrl = localStorage.getItem(STORAGE_KEY_API);

    if (apiUrl) {
        try {
            const res = await fetch(apiUrl + '?action=getAll', { method: 'GET', mode: 'cors' });
            if (!res.ok) throw new Error('Network error');
            const rows = await res.json();
            rawData = parseSheetData(rows);
        } catch(e) {
            console.warn('Apps Script gagal, fallback ke demo data:', e);
            rawData = generateDemoData();
            showToast('Tidak bisa terhubung ke Apps Script. Menggunakan data demo.','warning');
        }
    } else {
        rawData = generateDemoData();
    }

    document.getElementById('syncTime').textContent = new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
    icon.classList.remove('fa-spin');
    initUnitFilter();
    applyFilters();
}

// Parse data dari Apps Script (format array of arrays / array of objects)
function parseSheetData(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    // Anggap row pertama header
    const headers = (typeof rows[0] === 'object' && !Array.isArray(rows[0]))
        ? Object.keys(rows[0])
        : rows[0];

    const normalize = h => String(h || '').toLowerCase().trim();
    const hMap = {};
    headers.forEach((h,i) => {
        const key = normalize(h);
        if (key.includes('tanggal')||key.includes('waktu')||key.includes('timestamp')) hMap.timestamp = i;
        else if (key.includes('unit')&&!key.includes('spare')) hMap.unit = i;
        else if (key.includes('irrigator')) hMap.irrigator = i;
        else if (key.includes('kerusakan')||key.includes('damage')||key.includes('masalah')) hMap.damage = i;
        else if (key.includes('sparepart')||key.includes('spare')) hMap.sparepart = i;
        else if (key.includes('jumlah')||key.includes('qty')||key.includes('quantity')) hMap.qty = i;
        else if (key.includes('status')) hMap.status = i;
        else if (key.includes('pelapor')||key.includes('nama')||key.includes('reporter')) hMap.reporter = i;
        else if (key.includes('catatan')||key.includes('note')||key.includes('keterangan')) hMap.notes = i;
    });

    const data = [];
    const startIdx = (typeof rows[0] === 'object' && !Array.isArray(rows[0])) ? 0 : 1;
    rows.slice(startIdx).forEach(r => {
        const get = f => {
            const v = Array.isArray(r) ? r[hMap[f]] : r[headers[hMap[f]]];
            return v ? String(v).trim() : '';
        };
        if (hMap.timestamp === undefined && hMap.unit === undefined) return;
        const ts = get('timestamp');
        const timestamp = ts ? new Date(ts) : new Date();
        if (isNaN(timestamp.getTime())) return;
        data.push({
            timestamp,
            unit: get('unit')||'Tidak tercatat',
            irrigator: get('irrigator')||'-',
            damage: get('damage')||'-',
            sparepart: get('sparepart')||'-',
            qty: parseInt(get('qty'))||1,
            status: get('status')||'Belum Ditangani',
            reporter: get('reporter')||'-',
            notes: get('notes')||''
        });
    });
    return data.sort((a,b) => b.timestamp - a.timestamp);
}

// ---- Filters ----
function setFilter(f) {
    currentFilter = f;
    currentPage = 1;
    document.querySelectorAll('.filter-btn').forEach(b => {
        if (b.dataset.filter === f) {
            b.classList.add('active');
            b.classList.remove('text-slate-600');
        } else {
            b.classList.remove('active');
            b.classList.add('text-slate-600');
        }
    });
    // clear custom dates
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value = '';
    applyFilters();
}

function getFilterRange() {
    const now = new Date();
    if (currentFilter === 'daily') return { from: startOfDay(now), to: now, label: 'Hari ini' };
    if (currentFilter === 'weekly') return { from: startOfWeek(now), to: now, label: 'Minggu ini' };
    if (currentFilter === 'monthly') return { from: startOfMonth(now), to: now, label: 'Bulan ini' };
    return { from: new Date(0), to: now, label: 'Semua data' };
}

function applyCustomFilter() {
    const fromEl = document.getElementById('dateFrom');
    const toEl = document.getElementById('dateTo');
    if (fromEl.value && toEl.value) {
        currentFilter = 'custom';
        document.querySelectorAll('.filter-btn').forEach(b => { b.classList.remove('active'); b.classList.add('text-slate-600'); });
        currentPage = 1;
        applyFilters();
    }
}

function initUnitFilter() {
    const select = document.getElementById('unitFilter');
    const units = [...new Set(rawData.map(d => d.unit))].sort();
    select.innerHTML = '<option value="">Semua Unit</option>' + units.map(u => `<option value="${u}">${u}</option>`).join('');
}

function applyFilters() {
    const range = getFilterRange();
    const customFrom = document.getElementById('dateFrom').value;
    const customTo = document.getElementById('dateTo').value;
    let from = range.from, to = range.to;
    let label = range.label;
    if (customFrom && customTo) {
        from = new Date(customFrom); from.setHours(0,0,0,0);
        to = new Date(customTo); to.setHours(23,59,59,999);
        label = `${from.toLocaleDateString('id-ID')} s/d ${to.toLocaleDateString('id-ID')}`;
    }

    const unitF = document.getElementById('unitFilter').value;
    const statusF = document.getElementById('statusFilter').value;
    const search = document.getElementById('searchInput').value.toLowerCase().trim();

    filteredData = rawData.filter(d => {
        if (d.timestamp < from || d.timestamp > to) return false;
        if (unitF && d.unit !== unitF) return false;
        if (statusF && d.status !== statusF) return false;
        if (search) {
            const blob = `${d.unit} ${d.irrigator} ${d.damage} ${d.sparepart} ${d.status} ${d.reporter}`.toLowerCase();
            if (!blob.includes(search)) return false;
        }
        return true;
    });

    document.getElementById('activePeriodText').textContent = label;
    updateStats();
    renderCharts();
    renderTable();
}

// ---- Stats ----
function updateStats() {
    const total = filteredData.length;
    const units = new Set(filteredData.map(d=>d.unit)).size;
    const pending = filteredData.filter(d=>d.status==='Belum Ditangani'||d.status==='Proses').length;
    const done = filteredData.filter(d=>d.status==='Selesai').length;

    animateNumber('statTotal', total);
    animateNumber('statUnits', units);
    animateNumber('statPending', pending);
    animateNumber('statDone', done);
}

function animateNumber(id, target) {
    const el = document.getElementById(id);
    const curr = parseInt(el.textContent)||0;
    const step = Math.ceil(Math.abs(target-curr)/15);
    let v = curr;
    const fn = setInterval(()=>{
        if (v<target) v=Math.min(v+step,target);
        else if (v>target) v=Math.max(v-step,target);
        el.textContent = v;
        if (v===target) clearInterval(fn);
    },25);
}

// ---- Charts ----
const chartColors = ['#3b82f6','#ef4444','#f59e0b','#10b981','#8b5cf6','#ec4899','#06b6d4','#f97316','#84cc16','#6366f1'];

function renderCharts() {
    renderTrendChart();
    renderStatusChart();
    renderUnitChart();
    renderSparepartChart();
    renderIrrigatorChart();
    renderDamageChart();
}

function destroyChart(key) { if (charts[key]) { charts[key].destroy(); } }

function renderTrendChart() {
    destroyChart('trend');
    // Group by period
    const groups = {};
    let fmt, getKey;
    if (currentFilter === 'daily') {
        getKey = d => d.getHours()+':00';
        for(let h=0;h<24;h++) groups[h+':00'] = 0;
    } else if (currentFilter === 'weekly') {
        getKey = d => ['Min','Sen','Sel','Rab','Kam','Jum','Sab'][d.getDay()];
        ['Sen','Sel','Rab','Kam','Jum','Sab','Min'].forEach(k => groups[k]=0);
    } else if (currentFilter === 'monthly') {
        getKey = d => d.getDate();
        const daysInMonth = new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate();
        for(let i=1;i<=daysInMonth;i++) groups[i] = 0;
    } else {
        getKey = d => d.toLocaleDateString('id-ID',{month:'short',year:'numeric'});
    }
    filteredData.forEach(d => {
        const k = getKey(d.timestamp);
        groups[k] = (groups[k]||0)+1;
    });
    const labels = Object.keys(groups);
    const data = Object.values(groups);
    const ctx = document.getElementById('trendChart').getContext('2d');
    const gradient = ctx.createLinearGradient(0,0,0,280);
    gradient.addColorStop(0,'rgba(59,130,246,0.3)');
    gradient.addColorStop(1,'rgba(59,130,246,0.0)');
    charts.trend = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: [{
            label: 'Jumlah Laporan', data, borderColor: '#2563eb',
            backgroundColor: gradient, borderWidth: 2.5, fill: true, tension: 0.4,
            pointRadius: 3, pointBackgroundColor: '#2563eb', pointHoverRadius: 6, pointHoverBackgroundColor: '#1d4ed8'
        }]},
        options: chartOpts({ legend: { display: false } })
    });
}

function renderStatusChart() {
    destroyChart('status');
    const groups = { 'Belum Ditangani':0, 'Proses':0, 'Selesai':0 };
    filteredData.forEach(d => { if(groups[d.status]!==undefined) groups[d.status]++; else groups['Belum Ditangani']++; });
    const ctx = document.getElementById('statusChart').getContext('2d');
    charts.status = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(groups),
            datasets: [{
                data: Object.values(groups),
                backgroundColor: ['#ef4444','#f59e0b','#10b981'],
                borderWidth: 0, hoverOffset: 8
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '70%',
            plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 15, font: { size: 11 } } } }
        }
    });
}

function renderUnitChart() {
    destroyChart('unit');
    const groups = {};
    filteredData.forEach(d => groups[d.unit] = (groups[d.unit]||0)+1);
    const sorted = Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const ctx = document.getElementById('unitChart').getContext('2d');
    charts.unit = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(s=>s[0]),
            datasets: [{ label: 'Laporan', data: sorted.map(s=>s[1]),
                backgroundColor: sorted.map((_,i)=>chartColors[i%chartColors.length]),
                borderRadius: 6, borderSkipped: false }]
        },
        options: chartOpts({ indexAxis: 'y', legend: { display: false } })
    });
}

function renderSparepartChart() {
    destroyChart('sparepart');
    const groups = {};
    filteredData.forEach(d => { if(d.sparepart && d.sparepart!=='-') groups[d.sparepart] = (groups[d.sparepart]||0)+(d.qty||1); });
    const sorted = Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const ctx = document.getElementById('sparepartChart').getContext('2d');
    charts.sparepart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(s=>s[0]),
            datasets: [{ label: 'Total Qty', data: sorted.map(s=>s[1]),
                backgroundColor: '#f59e0b', borderRadius: 6, borderSkipped: false }]
        },
        options: chartOpts({ indexAxis: 'y', legend: { display: false } })
    });
}

function renderIrrigatorChart() {
    destroyChart('irrigator');
    const groups = {};
    filteredData.forEach(d => { if(d.irrigator && d.irrigator!=='-') groups[d.irrigator] = (groups[d.irrigator]||0)+1; });
    const sorted = Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0,10);
    const ctx = document.getElementById('irrigatorChart').getContext('2d');
    charts.irrigator = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(s=>s[0]),
            datasets: [{ label: 'Kerusakan', data: sorted.map(s=>s[1]),
                backgroundColor: '#ef4444', borderRadius: 6, borderSkipped: false }]
        },
        options: chartOpts({ legend: { display: false } })
    });
}

function renderDamageChart() {
    destroyChart('damage');
    const groups = {};
    filteredData.forEach(d => { if(d.damage && d.damage!=='-') groups[d.damage] = (groups[d.damage]||0)+1; });
    const sorted = Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const ctx = document.getElementById('damageChart').getContext('2d');
    charts.damage = new Chart(ctx, {
        type: 'polarArea',
        data: {
            labels: sorted.map(s=>s[0]),
            datasets: [{
                data: sorted.map(s=>s[1]),
                backgroundColor: chartColors.map(c=>c+'cc'), borderWidth: 0
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 }, padding: 8 } } }
        }
    });
}

function chartOpts(extra={}) {
    return {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, labels: { font: { size: 11 } } }, tooltip: { backgroundColor: '#1e293b', padding: 12, cornerRadius: 8, titleFont: { size: 12, weight: 'bold' }, bodyFont: { size: 11 } } },
        scales: extra.indexAxis==='y' ? {
            x: { grid: { display: false }, ticks: { font: { size: 10 } } },
            y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 } } }
        } : {
            x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
            y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 }, precision: 0 }, beginAtZero: true }
        },
        ...extra
    };
}

// ---- Table ----
function renderTable() {
    document.getElementById('loadingState').classList.add('hidden');
    const tbody = document.getElementById('tableBody');
    const sorted = [...filteredData].sort((a,b)=>{
        let av = a[sortField], bv = b[sortField];
        if (av < bv) return sortDir==='asc'?-1:1;
        if (av > bv) return sortDir==='asc'?1:-1;
        return 0;
    });

    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage-1)*PAGE_SIZE;
    const page = sorted.slice(start, start+PAGE_SIZE);

    if (sorted.length === 0) {
        tbody.innerHTML = '';
        document.getElementById('emptyState').classList.remove('hidden');
    } else {
        document.getElementById('emptyState').classList.add('hidden');
    }

    tbody.innerHTML = page.map(d => {
        const statusBadge = {
            'Belum Ditangani': '<span class="status-badge bg-red-100 text-red-700"><i class="fas fa-circle text-[6px] mr-1"></i>Belum Ditangani</span>',
            'Proses': '<span class="status-badge bg-amber-100 text-amber-700"><i class="fas fa-circle text-[6px] mr-1"></i>Proses</span>',
            'Selesai': '<span class="status-badge bg-emerald-100 text-emerald-700"><i class="fas fa-circle text-[6px] mr-1"></i>Selesai</span>'
        }[d.status] || `<span class="status-badge bg-slate-100 text-slate-700">${d.status}</span>`;

        return `
        <tr class="table-row transition">
            <td class="px-5 py-3 text-slate-600 text-xs">
                <div class="font-medium text-slate-800">${fmtDateTime(d.timestamp)}</div>
            </td>
            <td class="px-5 py-3">
                <span class="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 px-2.5 py-1 rounded-md text-xs font-semibold">
                    <i class="fas fa-tint text-[10px]"></i>${d.unit}
                </span>
            </td>
            <td class="px-5 py-3 font-medium text-slate-700 text-xs">${d.irrigator}</td>
            <td class="px-5 py-3 text-slate-600 text-xs">${d.damage}</td>
            <td class="px-5 py-3 text-slate-600 text-xs">${d.sparepart}</td>
            <td class="px-5 py-3">
                <span class="inline-flex items-center justify-center w-7 h-7 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold">${d.qty}</span>
            </td>
            <td class="px-5 py-3">${statusBadge}</td>
            <td class="px-5 py-3 text-slate-600 text-xs"><i class="fas fa-user text-slate-400 mr-1 text-[10px]"></i>${d.reporter}</td>
        </tr>`;
    }).join('');

    document.getElementById('tableCount').textContent = `Menampilkan ${page.length} dari ${sorted.length} data`;
    document.getElementById('pageInfo').textContent = `Halaman ${currentPage} / ${totalPages}`;
    document.getElementById('prevBtn').disabled = currentPage === 1;
    document.getElementById('nextBtn').disabled = currentPage === totalPages;
}

function sortTable(field) {
    if (sortField === field) sortDir = sortDir==='asc'?'desc':'asc';
    else { sortField = field; sortDir = 'desc'; }
    renderTable();
}

function prevPage() { if(currentPage>1){currentPage--;renderTable();} }
function nextPage() {
    const totalPages = Math.ceil(filteredData.length/PAGE_SIZE);
    if(currentPage<totalPages){currentPage++;renderTable();}
}

// ---- Export CSV ----
function exportCSV() {
    const headers = ['Tanggal','Unit','Irrigator','Kerusakan','Sparepart','Qty','Status','Pelapor','Catatan'];
    const rows = filteredData.map(d => [fmtDateTime(d.timestamp),d.unit,d.irrigator,d.damage,d.sparepart,d.qty,d.status,d.reporter,d.notes||'']);
    const csv = [headers.join(','), ...rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(','))].join('\n');
    const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `PG2_Spareparts_Report_${fmtDate(new Date())}.csv`; a.click();
    URL.revokeObjectURL(url);
    showToast('Data berhasil di-export ke CSV','success');
}

// ---- Settings ----
function toggleSettings() {
    const m = document.getElementById('settingsModal');
    m.classList.toggle('hidden');
    m.classList.toggle('flex');
    document.getElementById('apiUrlInput').value = localStorage.getItem(STORAGE_KEY_API)||'';
}
function saveApiUrl() {
    const url = document.getElementById('apiUrlInput').value.trim();
    if (url) localStorage.setItem(STORAGE_KEY_API, url);
    else localStorage.removeItem(STORAGE_KEY_API);
    toggleSettings();
    showToast('API URL disimpan. Menghubungkan...','success');
    refreshData();
}
function useDemoData() {
    localStorage.removeItem(STORAGE_KEY_API);
    toggleSettings();
    showToast('Menggunakan data demo','info');
    refreshData();
}

// ---- Toast ----
function showToast(msg,type='info') {
    const colors = { success:'bg-emerald-500', warning:'bg-amber-500', error:'bg-red-500', info:'bg-blue-500' };
    const icons = { success:'check-circle', warning:'exclamation-triangle', error:'times-circle', info:'info-circle' };
    const toast = document.createElement('div');
    toast.className = `fixed top-20 right-4 ${colors[type]} text-white px-4 py-3 rounded-lg shadow-xl z-50 flex items-center gap-2 fade-in text-sm font-medium`;
    toast.innerHTML = `<i class="fas fa-${icons[type]}"></i>${msg}`;
    document.body.appendChild(toast);
    setTimeout(()=>{ toast.style.opacity='0'; toast.style.transition='opacity .3s'; setTimeout(()=>toast.remove(),300); }, 3000);
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
    const today = fmtDate(new Date());
    document.getElementById('dateTo').max = today;
    refreshData();
    // Auto refresh tiap 5 menit
    setInterval(refreshData, 5*60*1000);
});
