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
const LOCAL_CACHE_KEY = 'pg2_data_cache_v1';


// Pra-hitung field turunan untuk filter cepat (dipanggil sekali per muat data)
function indexRecords(arr){
    arr.forEach(d=>{
        d.__t = new Date(d.timestamp).getTime();
        const blob = `${d.lokasi} ${d.divisi} ${d.engine} ${d.engineCode} ${d.engineType} ${d.irrigator} ${d.irrCode} ${d.irrType} ${d.damageType} ${d.keterangan} ${d.sparepart} ${d.prNumber||''} ${d.pic||''} ${d.status} ${d.tingkat||''}`.toLowerCase();
        d.__blob = blob; d.__flat = blob.replace(/[^a-z0-9]/g,'');
    });
    return arr;
}

// ======================================================
// VALIDASI KUALITAS DATA (angka dengan titik/koma, kode tak lengkap, dsb.)
// Dijalankan pada SETIAP record setelah sync. Nilai bermasalah dinormalkan
// untuk tampilan (mis. "11.095.745" -> "11095745") tetapi tetap ditandai
// agar operator memperbaikinya di spreadsheet.
// ======================================================
function auditNumericField(raw, opts){
    // opts: {label, digits (panjang wajib), allowEmpty}
    const issues=[]; let v=String(raw==null?'':raw).trim(); let fixed=v;
    if(!v) return {value:'', fixed:'', issues};
    if(/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(v)){
        issues.push({type:'scientific', msg:`${opts.label} tertulis dalam notasi ilmiah "${v}" (sel diformat sebagai angka). Ubah format kolom menjadi Teks/Plain text.`});
        fixed = String(Math.round(Number(v)));
    } else if(/[.,]/.test(v)){
        const sep = v.includes('.') && v.includes(',') ? 'titik & koma' : v.includes('.') ? 'titik' : 'koma';
        // "32,0" / "0032.00" = desimal nol → ambil bagian bulatnya; selain itu buang semua pemisah
        const mDec = v.match(/^(\d+)[.,]0+$/);
        const digitsOnly = mDec ? mDec[1] : v.replace(/[.,\s]/g,'');
        if(/^\d+$/.test(digitsOnly)){
            issues.push({type:'separator', msg:`${opts.label} "${v}" mengandung ${sep} sebagai pemisah. Tulis angka tanpa pemisah (contoh: ${digitsOnly}).`});
            fixed = digitsOnly;
        } else {
            issues.push({type:'nonnumeric', msg:`${opts.label} "${v}" bukan angka yang valid.`});
        }
    } else if(/\s/.test(v)){
        issues.push({type:'space', msg:`${opts.label} "${v}" mengandung spasi.`});
        fixed = v.replace(/\s+/g,'');
    } else if(!/^\d+$/.test(v)){
        issues.push({type:'nonnumeric', msg:`${opts.label} "${v}" mengandung karakter selain angka.`});
    }
    if(opts.digits && /^\d+$/.test(fixed) && fixed.length!==opts.digits){
        if(fixed.length<opts.digits){
            issues.push({type:'length', msg:`${opts.label} "${v}" hanya ${fixed.length} digit (seharusnya ${opts.digits}). Angka nol di depan mungkin hilang karena sel diformat angka — gunakan format Teks.`});
            fixed = fixed.padStart(opts.digits,'0');
        } else {
            issues.push({type:'length', msg:`${opts.label} "${v}" ${fixed.length} digit (seharusnya ${opts.digits}).`});
        }
    }
    return {value:v, fixed, issues};
}
function validateRecord(d){
    const issues=[];
    const add=(field,col,r)=>r.issues.forEach(x=>issues.push({field,col,type:x.type,msg:x.msg,raw:r.value,fixed:r.fixed}));
    const pr = auditNumericField(d.prNumber, {label:'Nomor PR / Notifikasi', digits:8});
    add('prNumber','Nomor PR / Notifikasi',pr); if(pr.issues.length && /^\d+$/.test(pr.fixed)) d.prNumber = pr.fixed;
    if(d.engineCode && d.engineCode!=='-'){ const r=auditNumericField(d.engineCode,{label:'Kode Engine',digits:4}); add('engineCode','Kode Engine',r); if(r.issues.length && /^\d+$/.test(r.fixed)){ d.engineCode=r.fixed; d.engine=[d.engineType,d.engineCode].filter(x=>x&&x!=='-').join(' – ')||'-'; } }
    if(d.irrCode && d.irrCode!=='-'){ const r=auditNumericField(d.irrCode,{label:'Kode Irrigator',digits:4}); add('irrCode','Kode Irrigator',r); if(r.issues.length && /^\d+$/.test(r.fixed)){ d.irrCode=r.fixed; d.irrigator=(d.irrType&&d.irrType!=='-'&&d.irrType!==d.irrCode)?`${d.irrType} – ${d.irrCode}`:d.irrCode; } }
    if(d.irrCode && d.irrCode!=='-' && (!d.irrType || d.irrType==='-')) issues.push({field:'irrType',col:'Jenis Irrigator',type:'missing',msg:`Kode Irrigator ${d.irrCode} diisi tetapi Jenis Irrigator kosong.`});
    if(d.engineCode && d.engineCode!=='-' && (!d.engineType || d.engineType==='-')) issues.push({field:'engineType',col:'Jenis Engine',type:'missing',msg:`Kode Engine ${d.engineCode} diisi tetapi Jenis Engine kosong.`});
    if(d.__rawTingkat && !d.tingkat) issues.push({field:'tingkat',col:'Tingkat Kerusakan',type:'enum',msg:`Tingkat Kerusakan "${d.__rawTingkat}" tidak dikenali (gunakan Berat/Sedang/Ringan).`});
    if(d.__rawRepair && !normRepair(d.__rawRepair)) issues.push({field:'repairStatus',col:'Status Perbaikan',type:'enum',msg:`Status Perbaikan "${d.__rawRepair}" tidak dikenali (gunakan Sudah/Belum).`});
    if(d.__rawTgl && d.__yearFixed) issues.push({field:'tanggalInspeksi',col:'Tanggal Inspeksi',type:'year',msg:`Tanggal Inspeksi "${d.__rawTgl}" memiliki tahun tidak wajar — dibaca sebagai ${d.tanggalInspeksi}.`});
    const t=new Date(d.timestamp); if(!isNaN(t) && t.getTime() > Date.now()+86400000) issues.push({field:'tanggalInspeksi',col:'Tanggal Inspeksi',type:'future',msg:`Tanggal ${d.tanggalInspeksi} berada di masa depan.`});
    if(!d.lokasi || d.lokasi==='-') issues.push({field:'lokasi',col:'Lokasi',type:'missing',msg:'Lokasi kosong.'});
    else {
        const lk=String(d.lokasi).trim();
        if(/\s/.test(lk) || lk!==lk.toUpperCase()) { issues.push({field:'lokasi',col:'Lokasi',type:'format',msg:`Lokasi "${lk}" mengandung spasi/huruf kecil — ditampilkan sebagai ${lokKey(lk)}.`,raw:lk,fixed:lokKey(lk)}); d.lokasi=lokKey(lk); d.unit=d.lokasi; }
        else if(!/^\d{3}[A-Z]{1,2}\d{0,2}$/.test(lk) && !/^(GUAVA|BANANA)/i.test(lk)) issues.push({field:'lokasi',col:'Lokasi',type:'format',msg:`Lokasi "${lk}" tidak sesuai pola kode lokasi (contoh 104I, 111C9).`});
        else if(typeof unitsByLokasi!=='undefined' && unitsByLokasi && Object.keys(unitsByLokasi).length && !unitsByLokasi[lokKey(lk)] && (__lokFreq[lokKey(lk)]||0)<=2){
            // Lokasi jarang dipakai & tidak ada di daftar unit → kemungkinan salah ketik; tawarkan lokasi mirip
            const near=Object.keys(unitsByLokasi).filter(k=>k.length>=3 && (k.startsWith(lokKey(lk).slice(0,3)))).slice(0,4);
            issues.push({field:'lokasi',col:'Lokasi',type:'unknown',msg:`Lokasi "${lk}" hanya muncul ${__lokFreq[lokKey(lk)]||1}× dan tidak ada di daftar unit terpasang — salah ketik?${near.length?` Mirip: ${near.join(', ')}.`:''}`});
        }
    }
    // Pilihan harus sama dengan Google Form
    const FO = typeof FORM_OPTIONS!=='undefined' ? FORM_OPTIONS : null;
    if(FO){
        if(!d.damageType || d.damageType==='-') issues.push({field:'damageType',col:'Jenis Kerusakan',type:'missing',msg:'Jenis Kerusakan kosong (wajib di Google Form).'});
        else if(FO.damageType.length && !FO.damageType.includes(d.damageType)) issues.push({field:'damageType',col:'Jenis Kerusakan',type:'enum',msg:`Jenis Kerusakan "${d.damageType}" tidak ada di pilihan Google Form.`});
        if(d.divisi && d.divisi!=='-' && FO.divisi.length && !FO.divisi.includes(d.divisi)) issues.push({field:'divisi',col:'Divisi',type:'enum',msg:`Divisi "${d.divisi}" tidak ada di pilihan form (${FO.divisi.join('/')}).`});
        if(d.engineType && d.engineType!=='-' && FO.engineType.length && !FO.engineType.includes(d.engineType)) issues.push({field:'engineType',col:'Jenis Engine',type:'enum',msg:`Jenis Engine "${d.engineType}" tidak ada di pilihan form.`});
        if(d.irrType && d.irrType!=='-' && FO.irrType.length && !FO.irrType.includes(d.irrType)) issues.push({field:'irrType',col:'Jenis Irrigator',type:'enum',msg:`Jenis Irrigator "${d.irrType}" tidak ada di pilihan form.`});
        if(d.pic && d.pic!=='-' && FO.pic && FO.pic.length && !FO.pic.includes(d.pic)) issues.push({field:'pic',col:'PIC',type:'enum',msg:`PIC "${d.pic}" tidak ada di pilihan form (${FO.pic.join('/')}).`});
    }
    if(!d.keterangan || d.keterangan.trim().length<3) issues.push({field:'keterangan',col:'Keterangan',type:'missing',msg:'Keterangan kerusakan kosong/terlalu pendek (wajib di Google Form).'});
    if(!d.tingkat) issues.push({field:'tingkat',col:'Tingkat Kerusakan',type:'missing',msg:'Tingkat Kerusakan kosong — dashboard menebak dari kata kunci; sebaiknya diisi.'});
    if((!d.pic||d.pic==='-') && typeof __picSince==='number' && new Date(d.timestamp).getTime()>=__picSince) issues.push({field:'pic',col:'PIC',type:'missing',msg:'PIC kosong (wajib di Google Form sejak kolom PIC ditambahkan).'});
    if(d.engineCode && d.engineCode!=='-' && d.irrCode && d.irrCode!=='-' && d.engineCode===d.irrCode && d.engineType===d.irrType) issues.push({field:'irrCode',col:'Kode Irrigator',type:'suspect',msg:`Kode Engine dan Kode Irrigator sama (${d.engineCode}) — salah satu kemungkinan salah isi.`});
    // Tanggal inspeksi vs waktu kirim form
    if(d.__rawTgl){ const tt=parseDate(d.__rawTgl); const ts=d.__rawTs?parseDate(d.__rawTs):null;
        if(tt && ts){ const diff=(ts-tt)/86400000; if(diff>60) issues.push({field:'tanggalInspeksi',col:'Tanggal Inspeksi',type:'date',msg:`Tanggal Inspeksi ${d.tanggalInspeksi} ${Math.round(diff)} hari lebih awal dari waktu kirim form (${fmtDateShort(ts)}) — periksa bulan/tahun.`}); else if(diff<-1.5) issues.push({field:'tanggalInspeksi',col:'Tanggal Inspeksi',type:'date',msg:`Tanggal Inspeksi ${d.tanggalInspeksi} lebih baru dari waktu kirim form (${fmtDateShort(ts)}).`}); } }
    // Cocokkan dengan unit terpasang (hanya jika laporan dibuat setelah unit tercatat terpasang)
    if(typeof unitsByLokasi!=='undefined' && unitsByLokasi && d.lokasi && d.lokasi!=='-'){
        const u=unitsByLokasi[lokKey(d.lokasi)];
        if(u && (!u.tanggal || new Date(d.timestamp).getTime() >= u.tanggal.getTime())){
            if(u.divisi && FO && FO.divisi.includes(u.divisi) && d.divisi && d.divisi!=='-' && d.divisi!==u.divisi) issues.push({field:'divisi',col:'Divisi',type:'unit',msg:`Divisi ${d.divisi} berbeda dengan bengkel unit terpasang di ${u.lokasi} (${u.divisi}).`,fixed:u.divisi});
            if(d.engineCode && d.engineCode!=='-' && u.engineCode && (d.engineCode!==u.engineCode || (d.engineType&&d.engineType!=='-'&&u.engineType&&d.engineType!==u.engineType))) issues.push({field:'engineCode',col:'Kode Engine',type:'unit',msg:`Engine ${d.engineType||''} ${d.engineCode} berbeda dengan unit terpasang di ${u.lokasi} (${u.engineType} ${u.engineCode}).`,fixed:u.engineCode});
            if(d.irrCode && d.irrCode!=='-' && u.irrCode && (d.irrCode!==u.irrCode || (d.irrType&&d.irrType!=='-'&&u.irrType&&d.irrType!==u.irrType))) issues.push({field:'irrCode',col:'Kode Irrigator',type:'unit',msg:`Irrigator ${d.irrType||''} ${d.irrCode} berbeda dengan unit terpasang di ${u.lokasi} (${u.irrType} ${u.irrCode}).`,fixed:u.irrCode});
        }
    }
    // Hasil edit dari web yang (setelah 1 menit) masih berbeda dengan spreadsheet
    const sm = __syncMismatch[_wkey(d)];
    if(sm){ if(Date.now()-sm.ts > 15*60*1000 || _sameFields(d, sm.rec)) delete __syncMismatch[_wkey(d)];
            else issues.push({field:'sync',col:'Sinkron',type:'sync',msg:`Hasil edit dari web (${new Date(sm.ts).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}) berbeda dengan isi spreadsheet saat ini — buka, periksa, lalu simpan ulang.`}); }
    d.__issues = issues;
    return issues;
}
let __picSince = null; // sejak kapan PIC dianggap wajib (dihitung dari data)
let __lokFreq = {};   // frekuensi lokasi di laporan (lokasi yang sering dipakai dianggap valid)
function validateAll(arr){
    // PIC dianggap wajib sejak titik waktu di mana ≥70% laporan sesudahnya sudah berisi PIC
    // (bukan sejak PIC pertama muncul — laporan lama yang dikirim ulang bisa mengecoh).
    const byT = arr.map(d=>({t:new Date(d.timestamp).getTime(), p:!!(d.pic&&d.pic!=='-')})).filter(x=>!isNaN(x.t)).sort((a,b)=>a.t-b.t);
    __picSince = null;
    if(byT.some(x=>x.p)){
        let withP=0; for(let i=byT.length-1;i>=0;i--){ if(byT[i].p) withP++; const n=byT.length-i; if(n>=5 && withP/n>=0.7) __picSince=byT[i].t; else if(n>=5 && withP/n<0.5) break; }
    }
    __lokFreq = {}; arr.forEach(d=>{ if(d.lokasi&&d.lokasi!=='-') __lokFreq[lokKey(d.lokasi)]=(__lokFreq[lokKey(d.lokasi)]||0)+1; });
    let n=0; arr.forEach(d=>{ n += validateRecord(d).length ? 1 : 0; });
    // Duplikat: timestamp + lokasi + jenis kerusakan sama persis
    const seen={}; arr.forEach(d=>{ const k=`${d.timestamp}|${d.lokasi}|${d.damageType}`; (seen[k]=seen[k]||[]).push(d); });
    Object.values(seen).filter(v=>v.length>1).forEach(v=>v.slice(1).forEach(d=>{ d.__issues.push({field:'dup',col:'—',type:'duplicate',msg:`Kemungkinan duplikat dari baris ${v[0].__row}.`}); }));
    // Duplikat "kiriman ganda": tanggal inspeksi + lokasi + jenis + keterangan sama walau
    // timestamp berbeda (umumnya form dikirim 2x, mis. untuk menambah PIC). Baris yang paling
    // lengkap (ada PIC, status Sudah) dianggap asli; sisanya ditandai agar bisa dihapus.
    const seen2={}; arr.forEach(d=>{
        if(!d.lokasi||d.lokasi==='-'||!d.damageType||d.damageType==='-') return;
        const k=`${d.tanggalInspeksi}|${lokKey(d.lokasi)}|${d.damageType.toLowerCase()}|${String(d.keterangan||'').toLowerCase().replace(/\s+/g,' ').trim()}`;
        (seen2[k]=seen2[k]||[]).push(d);
    });
    const score=d=>(d.pic&&d.pic!=='-'?2:0)+(d.repairStatus==='Sudah'?1:0)+(d.prNumber?1:0)+(d.sparepart&&d.sparepart!=='-'?1:0);
    Object.values(seen2).filter(v=>v.length>1).forEach(v=>{
        v.sort((a,b)=>score(b)-score(a)||(b.__row||0)-(a.__row||0));
        v.slice(1).forEach(d=>{
            if(d.__issues.some(i=>i.type==='duplicate')) return;
            const keep=v[0]; const diff=[];
            if(keep.repairStatus!==d.repairStatus) diff.push(`status ${d.repairStatus}→${keep.repairStatus}`);
            if((keep.pic||'-')!==(d.pic||'-')) diff.push(`PIC ${d.pic&&d.pic!=='-'?d.pic:'kosong'}→${keep.pic&&keep.pic!=='-'?keep.pic:'kosong'}`);
            d.__issues.push({field:'dup',col:'Duplikat',type:'duplicate',msg:`Laporan yang sama dengan baris ${keep.__row} (tanggal, lokasi, jenis & keterangan identik; dikirim 2×${diff.length?' — '+diff.join(', '):''}). Baris ini menggandakan hitungan; sebaiknya dihapus.`});
        });
    });
    return arr.filter(d=>d.__issues.length);
}
// Setelah baris ditulis ke sheet (edit/tambah), nilai di sheet = nilai form (sudah normal),
// jadi tanda masalah lama harus dihitung ulang, bukan dibawa dari record sebelumnya.
function revalidateAfterWrite(rec){
    rec.__rawTingkat = rec.tingkat || ''; rec.__rawRepair = rec.repairStatus || '';
    rec.__rawTgl = rec.tanggalInspeksi || ''; rec.__yearFixed = false;
    rec.__issues = [];
    validateRecord(rec);
    return rec;
}
let __lastQualityKey = '';
// Tingkat keparahan isu: 'error' = angka/nilai salah atau duplikat (mengubah hitungan),
// 'warn' = kemungkinan salah (perlu dicek), 'info' = kelengkapan.
const ISSUE_LEVEL = { separator:'error', scientific:'error', nonnumeric:'error', length:'error', space:'error', duplicate:'error', enum:'error', year:'error', future:'error', sync:'error',
                      unit:'warn', date:'warn', format:'warn', unknown:'warn', suspect:'warn', missing:'info' };
const issueLevel = i => ISSUE_LEVEL[i.type] || 'warn';
const NOTIF_DISMISS_KEY = 'pg2_notif_dismissed_v1';
function _dismissed(){ try{ return JSON.parse(localStorage.getItem(NOTIF_DISMISS_KEY)||'{}'); }catch(e){ return {}; } }
const _issueKey = (d,i) => `${d.tanggalInspeksi}|${d.lokasi}|${d.damageType}|${i.field}|${i.type}`;
function dismissIssue(rawi, idx){ const d=rawData[rawi]; if(!d) return; const i=d.__issues[idx]; if(!i) return; const m=_dismissed(); m[_issueKey(d,i)]=Date.now(); localStorage.setItem(NOTIF_DISMISS_KEY, JSON.stringify(m)); renderQualityBanner(); renderNotifPanel(); }
function clearDismissed(){ localStorage.removeItem(NOTIF_DISMISS_KEY); renderQualityBanner(); renderNotifPanel(); }
// Daftar isu aktif (tidak diabaikan), per record
function activeIssues(){
    const dm=_dismissed(); const out=[];
    rawData.forEach((d,ri)=>{ if(!d.__issues||!d.__issues.length) return; const list=d.__issues.map((i,ix)=>({i,ix})).filter(x=>!dm[_issueKey(d,x.i)]); if(list.length) out.push({d,ri,list}); });
    const rank={error:0,warn:1,info:2};
    out.forEach(r=>{ r.level = r.list.reduce((a,x)=>rank[issueLevel(x.i)]<rank[a]?issueLevel(x.i):a,'info'); });
    out.sort((a,b)=>rank[a.level]-rank[b.level]||(new Date(b.d.timestamp)-new Date(a.d.timestamp)));
    return out;
}
function toggleNotifPanel(force){
    const p=document.getElementById('notifPanel'); if(!p) return;
    const show = force!==undefined ? force : p.classList.contains('hidden');
    p.classList.toggle('hidden', !show);
    if(show){
        renderNotifPanel();
        // Di layar sempit: panel menempel di bawah header selebar layar (position fixed),
        // supaya tidak terpotong di tepi kiri.
        if(window.innerWidth < 520){
            const hb=document.querySelector('header'); const top=hb?Math.round(hb.getBoundingClientRect().bottom)+6:60;
            Object.assign(p.style,{position:'fixed',left:'8px',right:'8px',top:top+'px',width:'auto',marginTop:'0'});
        } else { Object.assign(p.style,{position:'',left:'',right:'',top:'',width:'',marginTop:''}); }
    }
}
document.addEventListener('click', e=>{ const w=document.getElementById('notifWrap'); if(w && !w.contains(e.target)) { const p=document.getElementById('notifPanel'); if(p) p.classList.add('hidden'); } });
function renderNotifPanel(){
    const p=document.getElementById('notifPanel'); if(!p) return;
    const items=activeIssues(); const dmCount=Object.keys(_dismissed()).length;
    const lvl={error:'bg-red-100 text-red-700',warn:'bg-amber-100 text-amber-800',info:'bg-slate-100 text-slate-600'};
    const lvlIcon={error:'fa-circle-exclamation text-red-600',warn:'fa-triangle-exclamation text-amber-600',info:'fa-circle-info text-slate-400'};
    const cnt={error:0,warn:0,info:0}; items.forEach(r=>cnt[r.level]++);
    const head=`<div class="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 bg-slate-50">
        <div><div class="text-xs font-bold text-slate-800"><i class="fas fa-bell mr-1 text-slate-500"></i>Anomali data</div>
        <div class="text-[10.5px] text-slate-500">${items.length?`${cnt.error} salah · ${cnt.warn} perlu dicek · ${cnt.info} belum lengkap`:'Tidak ada anomali pada data saat ini'}</div></div>
        <div class="flex items-center gap-1">${getWriteUrl()&&items.length?`<button onclick="toggleNotifPanel(false);openQualityModal()" class="text-[10.5px] font-semibold px-2 py-1 rounded-md bg-slate-900 text-white">Tabel lengkap</button>`:''}${dmCount?`<button onclick="clearDismissed()" title="Tampilkan lagi ${dmCount} notifikasi yang diabaikan" class="text-[10.5px] px-2 py-1 rounded-md hover:bg-slate-200 text-slate-500">Pulihkan (${dmCount})</button>`:''}</div></div>`;
    if(!items.length){ p.innerHTML=head+`<div class="px-4 py-6 text-center text-xs text-slate-400"><i class="fas fa-circle-check text-emerald-500 text-lg block mb-1"></i>Semua laporan lolos pemeriksaan.</div>`; return; }
    const rows=items.slice(0,60).map(r=>`<div class="px-4 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50">
        <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
                <div class="text-xs font-semibold text-slate-800 truncate"><i class="fas ${lvlIcon[r.level]} mr-1 text-[10px]"></i>${escapeHtml(r.d.lokasi)} · ${escapeHtml(r.d.damageType||'-')} <span class="text-slate-400 font-normal">· ${fmtDateShort(r.d.timestamp)} · baris ${r.d.__row||'?'}</span></div>
                ${r.list.map(x=>`<div class="text-[11px] text-slate-600 mt-0.5 flex items-start gap-1"><span class="px-1 rounded text-[9.5px] font-bold ${lvl[issueLevel(x.i)]} shrink-0 mt-[1px]">${escapeHtml(x.i.col)}</span><span>${escapeHtml(x.i.msg)}</span><button onclick="event.stopPropagation();dismissIssue(${r.ri},${x.ix})" title="Abaikan notifikasi ini" class="ml-auto text-slate-300 hover:text-slate-600 shrink-0"><i class="fas fa-xmark text-[10px]"></i></button></div>`).join('')}
            </div>
            <div class="flex flex-col gap-1 shrink-0">
                ${getWriteUrl()?`<button onclick="toggleNotifPanel(false);openEditModalRaw(${r.ri})" class="px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[10.5px] font-semibold"><i class="fas fa-pen mr-1"></i>Perbaiki</button>`:''}
                ${getWriteUrl()&&r.list.some(x=>x.i.type==='duplicate')?`<button onclick="toggleNotifPanel(false);openDeleteModalRaw(${r.ri})" class="px-2 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-[10.5px] font-semibold"><i class="fas fa-trash mr-1"></i>Hapus</button>`:''}
            </div>
        </div></div>`).join('');
    p.innerHTML=head+`<div class="max-h-[70vh] overflow-y-auto">${rows}${items.length>60?`<div class="px-4 py-2 text-[11px] text-slate-400 text-center">+${items.length-60} lainnya — buka "Tabel lengkap"</div>`:''}</div>`;
}
function updateNotifBadge(items){
    const b=document.getElementById('notifBadge'); const btn=document.getElementById('notifBtn'); if(!b) return;
    const n=items.length; b.textContent=n>99?'99+':n; b.classList.toggle('hidden',!n);
    const hasErr=items.some(r=>r.level==='error'); b.className=b.className.replace(/bg-(red|amber|slate)-\d+/,'')+' '+(hasErr?'bg-red-600':items.some(r=>r.level==='warn')?'bg-amber-500':'bg-slate-400');
    if(btn) btn.title = n?`${n} laporan dengan anomali data — klik untuk melihat`:'Tidak ada anomali data';
}
function renderQualityBanner(){
    const items = activeIssues(); updateNotifBadge(items);
    const bad = items.map(r=>Object.assign({}, r.d, {__issues:r.list.map(x=>x.i)}));
    const el = document.getElementById('qualityBanner'); if(!el) return;
    const sepCount = bad.reduce((a,d)=>a+d.__issues.filter(i=>i.type==='separator'||i.type==='scientific').length,0);
    const dupCount = bad.filter(d=>d.__issues.some(i=>i.type==='duplicate')).length;
    const errCount = items.filter(r=>r.level==='error').length, warnCount=items.filter(r=>r.level==='warn').length, infoCount=items.filter(r=>r.level==='info').length;
    const p=document.getElementById('notifPanel'); if(p && !p.classList.contains('hidden')) renderNotifPanel();
    if(!bad.length){ el.classList.add('hidden'); el.innerHTML=''; __lastQualityKey=''; return; }
    el.classList.remove('hidden');
    el.innerHTML = `<div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2 text-xs text-amber-900">
            <i class="fas fa-triangle-exclamation text-amber-600"></i>
            <b>${bad.length} laporan dengan anomali data</b>
            ${errCount?`<span class="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">${errCount} salah/duplikat</span>`:''}
            ${warnCount?`<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold">${warnCount} perlu dicek</span>`:''}
            ${infoCount?`<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold">${infoCount} belum lengkap</span>`:''}
            ${dupCount?`<span class="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold">${dupCount} terkirim ganda</span>`:''}
            <span class="text-amber-700 hidden sm:inline">— nilai sudah dinormalkan di dashboard, tetapi sumber di spreadsheet sebaiknya diperbaiki.</span>
        </div>
        <div class="flex items-center gap-1.5"><button onclick="toggleNotifPanel(true)" class="text-xs font-semibold bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 px-3 py-1.5 rounded-lg"><i class="fas fa-bell mr-1"></i>Notifikasi</button><button onclick="openQualityModal()" class="text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg"><i class="fas fa-list-check mr-1"></i>Lihat detail</button></div>
    </div>`;
    // Toast sekali per kombinasi masalah baru (agar tidak spam tiap auto-refresh)
    const key = bad.map(d=>d.__row+':'+d.__issues.map(i=>i.type).join('/')).join(',');
    if(key!==__lastQualityKey){
        __lastQualityKey = key;
        if(sepCount) showToast(`${sepCount} angka di spreadsheet ditulis dengan titik/koma sebagai pemisah (mis. Nomor PR). Periksa panel "Kualitas Data".`,'warning');
        else if(dupCount) showToast(`${dupCount} laporan tampaknya terkirim 2× (duplikat) sehingga menggandakan hitungan. Klik ikon lonceng untuk menghapus.`,'warning');
        else if(errCount) showToast(`${errCount} laporan berisi nilai yang salah — klik ikon lonceng untuk memperbaiki.`,'warning');
        else showToast(`${bad.length} laporan memiliki anomali data (klik ikon lonceng).`,'info');
    }
}
function openQualityModal(){
    const modal=document.getElementById('typeDetailModal'); if(!modal) return;
    const bad = activeIssues().map(r=>Object.assign({}, r.d, {__issues:r.list.map(x=>x.i), __ri:r.ri})).sort((a,b)=>(a.__row||0)-(b.__row||0));
    const rowsHtml = bad.map(d=>`<tr class="border-b border-slate-100 last:border-0 align-top">
        <td class="py-2 pr-2 font-mono text-slate-500">${d.__row||'—'}</td>
        <td class="py-2 pr-2 whitespace-nowrap">${fmtDateShort(d.timestamp)}<div class="text-[10px] text-blue-700 font-semibold">${escapeHtml(d.lokasi)}</div></td>
        <td class="py-2 pr-2">${d.__issues.map(i=>`<div class="mb-1"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${i.type==='separator'||i.type==='scientific'?'bg-red-100 text-red-700':i.type==='duplicate'?'bg-purple-100 text-purple-700':'bg-amber-100 text-amber-800'}">${escapeHtml(i.col)}</span> <span class="text-slate-700">${escapeHtml(i.msg)}</span>${i.fixed&&i.fixed!==i.raw?` <span class="text-emerald-700 text-[10px]">→ ditampilkan sebagai <b>${escapeHtml(i.fixed)}</b></span>`:''}</div>`).join('')}</td>
        <td class="py-2 whitespace-nowrap">${getWriteUrl()?`<button onclick="closeModal('typeDetailModal');openEditModalRaw(${d.__ri})" class="act-btn edit" title="Perbaiki lewat web"><i class="fas fa-pen"></i></button>${d.__issues.some(i=>i.type==='duplicate')?` <button onclick="closeModal('typeDetailModal');openDeleteModalRaw(${d.__ri})" class="act-btn del" title="Hapus baris duplikat"><i class="fas fa-trash"></i></button>`:''}`:''}</td>
    </tr>`).join('');
    modal.querySelector('.modal').innerHTML = `
        <div class="p-5 text-white" style="background:linear-gradient(135deg,#d97706,#b45309)">
            <div class="flex items-start justify-between gap-3">
                <div><div class="text-[10px] uppercase tracking-widest font-semibold opacity-80">Kualitas Data Spreadsheet</div>
                <h3 class="display-font font-bold text-2xl leading-tight">${bad.length} baris perlu diperiksa</h3>
                <div class="text-[11px] opacity-90 mt-1">Dashboard menormalkan nilai ini agar angka tidak tampil janggal, tetapi <b>sumber di Google Sheets tetap salah</b> sampai diperbaiki. Nomor baris mengacu ke sheet "Response".</div></div>
                <button onclick="closeModal('typeDetailModal')" class="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 flex items-center justify-center"><i class="fas fa-times"></i></button>
            </div>
        </div>
        <div class="p-5">
            <div class="bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs text-slate-700 mb-4">
                <b>Cara mencegah:</b> di Google Sheets, blok kolom <i>Nomor PR / Notifikasi</i>, <i>Kode Engine</i>, <i>Kode Irrigator</i> → <b>Format → Number → Plain text</b>, lalu ketik angka tanpa titik/koma. Pasang juga pemeriksa otomatis <code class="bg-white px-1 rounded">scripts/sheet-validator.gs</code> agar sel bermasalah langsung diwarnai merah saat diketik.
            </div>
            <div class="overflow-x-auto"><table class="w-full text-xs">
                <thead><tr class="text-[10px] uppercase text-slate-400 border-b border-slate-200"><th class="text-left py-1.5 pr-2">Baris</th><th class="text-left py-1.5 pr-2">Tanggal / Lokasi</th><th class="text-left py-1.5 pr-2">Masalah</th><th class="py-1.5"></th></tr></thead>
                <tbody>${rowsHtml||'<tr><td colspan="4" class="py-6 text-center text-slate-400 italic">Tidak ada masalah</td></tr>'}</tbody>
            </table></div>
        </div>`;
    openModal('typeDetailModal');
}

// ======================================================
// TAB SPAREPARTS — analisa kebutuhan sparepart
// Sumber: kolom "Spareparts Yang Dibutuhkan" (dipisah ";"). Bekerja murni di atas
// filteredData (tidak menyentuh alur sync) sehingga aman terhadap refresh/rekonsiliasi.
// ======================================================
let spOpenOnly = false, spSearch = '', spSort = 'total';
let __spChartData = null;

// Pecah & normalkan daftar sparepart satu laporan → [{key, name}]
function splitSpareparts(str){
    if(!str || str==='-') return [];
    const out=[]; const seen=new Set();
    String(str).split(/[;\n]+/).forEach(raw=>{
        let name = raw.replace(/\s+/g,' ').trim().replace(/^[-•*]\s*/,'').replace(/[.,;]+$/,'');
        if(!name || name==='-') return;
        const key = name.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
        if(!key || seen.has(key)) return; // item ganda dalam satu laporan dihitung sekali
        seen.add(key); out.push({key, name});
    });
    return out;
}
const _spDispName = (variants) => { // pilih ejaan terbanyak; seri → yang berawalan huruf kapital
    let best=null, bn=-1; for(const [n,c] of Object.entries(variants)){ if(c>bn || (c===bn && /^[A-Z]/.test(n) && !/^[A-Z]/.test(best))){ best=n; bn=c; } } return best||'';
};

function buildSparepartStats(){
    const src = filteredData;
    const items = {}; // key → agregat
    let reportsWithSp=0, totalMentions=0, reportsNeedNoSp=0;
    src.forEach(d=>{
        const parts = splitSpareparts(d.sparepart);
        if(!parts.length){ if(isOpen(d)) reportsNeedNoSp++; return; }
        reportsWithSp++;
        const lv = effectiveTingkat(d) || 'Ringan';
        const w = (SEVERITY_RULES[lv]||SEVERITY_RULES.Ringan).weight;
        const open = isOpen(d);
        const age = daysSince(d.timestamp);
        parts.forEach(({key,name})=>{
            totalMentions++;
            const it = items[key] || (items[key]={key, variants:{}, total:0, open:0, done:0, noPr:0, withPr:0, berat:0, sedang:0, ringan:0,
                weight:0, oldestOpen:0, lastTs:0, firstTs:Infinity, byDiv:{}, byLok:{}, byDmg:{}, byAsset:{}, lokOpen:{}, records:[]});
            it.variants[name]=(it.variants[name]||0)+1;
            it.total++; it.records.push(d);
            if(open){ it.open++; it.weight += w; if(age>it.oldestOpen) it.oldestOpen=age; if(d.prNumber) it.withPr++; else it.noPr++; it.lokOpen[d.lokasi]=(it.lokOpen[d.lokasi]||0)+1; }
            else it.done++;
            if(lv==='Berat') it.berat++; else if(lv==='Sedang') it.sedang++; else it.ringan++;
            const t=d.__t||new Date(d.timestamp).getTime(); if(t>it.lastTs) it.lastTs=t; if(t<it.firstTs) it.firstTs=t;
            const dv=d.divisi&&d.divisi!=='-'?d.divisi:'—'; it.byDiv[dv]=(it.byDiv[dv]||0)+1;
            const lk=d.lokasi&&d.lokasi!=='-'?d.lokasi:'—'; it.byLok[lk]=(it.byLok[lk]||0)+1;
            const dm=d.damageType&&d.damageType!=='-'?d.damageType:'—'; it.byDmg[dm]=(it.byDmg[dm]||0)+1;
            const as=(d.engineType&&d.engineType!=='-')?`Engine ${d.engineType}`:(d.irrType&&d.irrType!=='-')?`Irigator ${d.irrType}`:assetCategory(d); it.byAsset[as]=(it.byAsset[as]||0)+1;
        });
    });
    const list = Object.values(items).map(it=>{
        it.name = _spDispName(it.variants);
        const lokCount = Object.keys(it.lokOpen).length;
        // Skor urgensi: bobot tingkat kebutuhan terbuka + umur (maks +6) + tanpa PR + sebaran lokasi
        it.score = it.open ? Math.round((it.weight + Math.min(6, it.oldestOpen/10) + it.noPr*1.5 + Math.max(0,lokCount-1)*1.0)*10)/10 : 0;
        it.urgency = it.score>=9 ? 'Kritis' : it.score>=5 ? 'Tinggi' : it.score>0 ? 'Sedang' : 'Selesai';
        return it;
    });
    return { list, reportsWithSp, totalMentions, reportsNeedNoSp, reports: src.length };
}
function spToggleOpenOnly(v){ spOpenOnly=!!v; renderSparepartsTab(); renderCharts(); }
function spSetSearch(v){ spSearch=(v||'').toLowerCase().trim(); clearTimeout(spSetSearch._t); spSetSearch._t=setTimeout(()=>renderSparepartsTab(false),150); }
function spSetSort(v){ spSort=v; renderSparepartsTab(false); }
const _spUrgBadge = u => ({Kritis:'bg-red-100 text-red-700',Tinggi:'bg-orange-100 text-orange-700',Sedang:'bg-amber-100 text-amber-800',Selesai:'bg-emerald-100 text-emerald-700'}[u]||'bg-slate-100 text-slate-600');
const _spTop = (obj,n=3) => Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,n);

function renderSparepartsTab(rebuildCharts=true){
    const stats = buildSparepartStats();
    let list = stats.list;
    if(spOpenOnly) list = list.filter(i=>i.open>0);
    const listAll = list;
    if(spSearch) list = list.filter(i=>i.name.toLowerCase().includes(spSearch) || Object.keys(i.variants).some(v=>v.toLowerCase().includes(spSearch)));
    const cnt = f => listAll.reduce((a,i)=>a+i[f],0);
    const openItems = listAll.filter(i=>i.open>0).length;
    const critical = listAll.filter(i=>i.urgency==='Kritis').length;
    const noPr = cnt('noPr');

    // KPI
    const k=document.getElementById('spKpis');
    if(k) k.innerHTML = [
        {l:'Jenis Sparepart', v:listAll.length, s:`${stats.totalMentions} permintaan · ${stats.reportsWithSp} laporan`, c:'text-teal-700', i:'fa-gears'},
        {l:'Masih Dibutuhkan', v:cnt('open'), s:`${openItems} jenis, belum selesai diperbaiki`, c:'text-amber-700', i:'fa-hourglass-half'},
        {l:'Belum Ada PR', v:noPr, s:'kebutuhan terbuka tanpa nomor PR', c:'text-red-700', i:'fa-file-circle-exclamation'},
        {l:'Urgensi Kritis', v:critical, s:'jenis sparepart skor ≥ 9', c:'text-red-700', i:'fa-fire'},
        {l:'Sudah Terpenuhi', v:cnt('done'), s:'permintaan pada laporan selesai', c:'text-emerald-700', i:'fa-circle-check'},
    ].map(x=>`<div class="card p-3"><div class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1"><i class="fas ${x.i} ${x.c}"></i>${x.l}</div><div class="display-font font-bold text-2xl ${x.c} mt-1">${x.v.toLocaleString('id-ID')}</div><div class="text-[10px] text-slate-500">${x.s}</div></div>`).join('');

    // Data chart
    const topN = [...listAll].sort((a,b)=>b.total-a.total||b.open-a.open).slice(0,12);
    const top8 = topN.slice(0,8);
    const divs = [...new Set(filteredData.map(d=>d.divisi).filter(v=>v&&v!=='-'))].sort();
    __spChartData = { topN, top8, divs };
    const ts=document.getElementById('spTopSub'); if(ts) ts.textContent = topN.length?`Top ${topN.length} berdasarkan jumlah laporan · ${spOpenOnly?'hanya kebutuhan terbuka':'terbuka + selesai'}`:'Belum ada data sparepart pada filter aktif';

    // Urgent table
    const urgent = listAll.filter(i=>i.open>0).sort((a,b)=>b.score-a.score||b.open-a.open).slice(0,15);
    const ut=document.getElementById('spUrgentTable');
    if(ut) ut.innerHTML = urgent.length ? `<thead><tr class="text-[10px] uppercase text-slate-400 border-b border-slate-200">
        <th class="text-left py-2 pr-2">#</th><th class="text-left py-2 pr-2">Sparepart</th><th class="text-center py-2 px-2">Urgensi</th><th class="text-right py-2 px-2">Skor</th><th class="text-right py-2 px-2">Terbuka</th><th class="text-center py-2 px-2">Tingkat (B/S/R)</th><th class="text-right py-2 px-2">Tanpa PR</th><th class="text-right py-2 px-2">Tertua</th><th class="text-left py-2 px-2">Divisi</th><th class="text-left py-2 px-2">Lokasi</th><th class="py-2"></th></tr></thead><tbody>` +
        urgent.map((i,ix)=>`<tr class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onclick="openSparepartDetail('${escapeHtml(i.key)}')">
            <td class="py-2 pr-2 text-slate-400">${ix+1}</td>
            <td class="py-2 pr-2 font-semibold text-slate-800">${escapeHtml(i.name)}</td>
            <td class="py-2 px-2 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${_spUrgBadge(i.urgency)}">${i.urgency}</span></td>
            <td class="py-2 px-2 text-right font-mono font-bold text-slate-700">${i.score}</td>
            <td class="py-2 px-2 text-right font-semibold text-amber-700">${i.open}<span class="text-slate-400 font-normal">/${i.total}</span></td>
            <td class="py-2 px-2 text-center text-[10px]"><span class="text-red-600 font-bold">${i.berat}</span> / <span class="text-amber-600 font-bold">${i.sedang}</span> / <span class="text-emerald-600 font-bold">${i.ringan}</span></td>
            <td class="py-2 px-2 text-right ${i.noPr?'text-red-600 font-semibold':'text-slate-400'}">${i.noPr}</td>
            <td class="py-2 px-2 text-right text-slate-600">${i.oldestOpen} hr</td>
            <td class="py-2 px-2 text-slate-600">${_spTop(i.byDiv,3).map(([d,c])=>`<span class="inline-block px-1.5 rounded bg-slate-100 mr-0.5" style="color:${DIV_COLORS[d]||'#475569'}">${escapeHtml(d)} ${c}</span>`).join('')}</td>
            <td class="py-2 px-2 text-slate-600 text-[11px]">${_spTop(i.lokOpen,4).map(([l,c])=>`${escapeHtml(l)}${c>1?`×${c}`:''}`).join(', ')}${Object.keys(i.lokOpen).length>4?` +${Object.keys(i.lokOpen).length-4}`:''}</td>
            <td class="py-2 text-right text-slate-400"><i class="fas fa-chevron-right text-[10px]"></i></td></tr>`).join('') + '</tbody>'
        : '<tbody><tr><td class="py-6 text-center text-slate-400 italic text-sm">Tidak ada kebutuhan sparepart yang masih terbuka pada filter aktif 🎉</td></tr></tbody>';

    // Per divisi
    const bd=document.getElementById('spByDiv');
    if(bd){
        const byDiv={}; listAll.forEach(i=>Object.entries(i.byDiv).forEach(([d,c])=>{ (byDiv[d]=byDiv[d]||[]).push({name:i.name,key:i.key,c,open:Math.min(i.open,c)}); }));
        const dvs=Object.keys(byDiv).sort((a,b)=>(divs.indexOf(a)>=0?divs.indexOf(a):99)-(divs.indexOf(b)>=0?divs.indexOf(b):99)||a.localeCompare(b));
        bd.innerHTML = dvs.length ? dvs.map(dv=>{ const arr=byDiv[dv].sort((a,b)=>b.c-a.c).slice(0,5); const tot=byDiv[dv].reduce((a,x)=>a+x.c,0); const mx=arr[0].c;
            return `<div class="rounded-xl border border-slate-100 p-3"><div class="flex items-center justify-between mb-2"><span class="font-bold text-sm" style="color:${DIV_COLORS[dv]||'#475569'}">${escapeHtml(dv)}</span><span class="text-[10px] text-slate-400">${tot} permintaan</span></div>
            ${arr.map(x=>`<div class="mb-1.5 cursor-pointer" onclick="openSparepartDetail('${escapeHtml(x.key)}')"><div class="flex justify-between text-[11px]"><span class="text-slate-700 truncate pr-2">${escapeHtml(x.name)}</span><span class="font-semibold text-slate-800">${x.c}</span></div><div class="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div class="h-full rounded-full" style="width:${Math.round(x.c/mx*100)}%;background:${DIV_COLORS[dv]||'#475569'}"></div></div></div>`).join('')}</div>`; }).join('')
        : '<div class="text-slate-400 italic text-sm col-span-3">Belum ada data</div>';
    }
    // Per aset
    const ba=document.getElementById('spByAsset');
    if(ba){
        const byAs={}; listAll.forEach(i=>Object.entries(i.byAsset).forEach(([a,c])=>{ (byAs[a]=byAs[a]||[]).push({name:i.name,key:i.key,c}); }));
        const ents=Object.entries(byAs).map(([a,arr])=>[a,arr.sort((x,y)=>y.c-x.c),arr.reduce((s,x)=>s+x.c,0)]).sort((x,y)=>y[2]-x[2]).slice(0,8);
        ba.innerHTML = ents.length ? ents.map(([a,arr,tot])=>`<div class="flex items-start gap-2 text-xs border-b border-slate-100 pb-2 last:border-0"><div class="w-28 shrink-0 font-semibold text-slate-800">${escapeHtml(a)}<div class="text-[10px] text-slate-400 font-normal">${tot} permintaan</div></div><div class="flex flex-wrap gap-1">${arr.slice(0,6).map(x=>`<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] cursor-pointer hover:bg-teal-50" onclick="openSparepartDetail('${escapeHtml(x.key)}')">${escapeHtml(x.name)} <b>${x.c}</b></span>`).join('')}${arr.length>6?`<span class="text-[10px] text-slate-400">+${arr.length-6}</span>`:''}</div></div>`).join('') : '<div class="text-slate-400 italic text-sm">Belum ada data</div>';
    }
    // Matriks sparepart × jenis kerusakan
    const mx=document.getElementById('spMatrix');
    if(mx){
        const rows=[...listAll].sort((a,b)=>b.total-a.total).slice(0,10);
        const dmgTot={}; rows.forEach(i=>Object.entries(i.byDmg).forEach(([d,c])=>dmgTot[d]=(dmgTot[d]||0)+c));
        const cols=Object.entries(dmgTot).sort((a,b)=>b[1]-a[1]).slice(0,6).map(e=>e[0]);
        const max=Math.max(1,...rows.flatMap(i=>cols.map(c=>i.byDmg[c]||0)));
        mx.innerHTML = rows.length ? `<table class="w-full text-[11px]"><thead><tr class="text-[10px] uppercase text-slate-400"><th class="text-left py-1.5 pr-2">Sparepart</th>${cols.map(c=>`<th class="text-center py-1.5 px-1 whitespace-nowrap">${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(i=>`<tr class="border-t border-slate-100"><td class="py-1.5 pr-2 font-medium text-slate-700 whitespace-nowrap">${escapeHtml(i.name)}</td>${cols.map(c=>{const v=i.byDmg[c]||0; const a=v?0.15+0.75*v/max:0; return `<td class="text-center py-1.5 px-1"><span class="inline-block min-w-[26px] px-1 rounded font-semibold" style="background:rgba(13,148,136,${a});color:${a>0.5?'#fff':'#0f766e'}">${v||'·'}</span></td>`;}).join('')}</tr>`).join('')}</tbody></table>` : '<div class="text-slate-400 italic text-sm">Belum ada data</div>';
    }
    // Kebutuhan berulang per lokasi
    const rc=document.getElementById('spRecurring');
    if(rc){
        const rec=[]; listAll.forEach(i=>Object.entries(i.byLok).forEach(([l,c])=>{ if(c>=2 && l!=='—') rec.push({name:i.name,key:i.key,lok:l,c,open:i.lokOpen[l]||0}); }));
        rec.sort((a,b)=>b.c-a.c||b.open-a.open);
        rc.innerHTML = rec.length ? rec.slice(0,10).map(r=>`<div class="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2 cursor-pointer hover:bg-purple-50" onclick="openSparepartDetail('${escapeHtml(r.key)}')"><div><span class="font-semibold text-slate-800">${escapeHtml(r.name)}</span> <span class="text-slate-400">di</span> <span class="font-semibold text-blue-700">${escapeHtml(r.lok)}</span></div><div class="flex items-center gap-2"><span class="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-bold text-[10px]">${r.c}×</span>${r.open?`<span class="text-[10px] text-amber-700">${r.open} terbuka</span>`:'<span class="text-[10px] text-emerald-700">selesai</span>'}</div></div>`).join('') : '<div class="text-slate-400 italic text-sm">Tidak ada sparepart yang diminta berulang di lokasi yang sama</div>';
    }
    // Katalog
    const sorters={ total:(a,b)=>b.total-a.total||b.open-a.open, open:(a,b)=>b.open-a.open||b.total-a.total, score:(a,b)=>b.score-a.score||b.total-a.total, recent:(a,b)=>b.lastTs-a.lastTs, name:(a,b)=>a.name.localeCompare(b.name,'id') };
    const cat=[...list].sort(sorters[spSort]||sorters.total);
    const ct=document.getElementById('spCatalogTable'), nd=document.getElementById('spNoData');
    if(ct){
        ct.innerHTML = cat.length ? `<thead><tr class="text-[10px] uppercase text-slate-400 border-b border-slate-200"><th class="text-left py-2 pr-2">Sparepart</th><th class="text-right py-2 px-2">Total</th><th class="text-right py-2 px-2">Terbuka</th><th class="text-right py-2 px-2">Selesai</th><th class="text-center py-2 px-2">Urgensi</th><th class="text-left py-2 px-2">Divisi</th><th class="text-left py-2 px-2">Jenis Kerusakan Utama</th><th class="text-left py-2 px-2">Terakhir Diminta</th><th class="text-left py-2 px-2">Variasi Penulisan</th></tr></thead><tbody>` +
            cat.map(i=>`<tr class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onclick="openSparepartDetail('${escapeHtml(i.key)}')">
                <td class="py-2 pr-2 font-semibold text-slate-800">${escapeHtml(i.name)}</td>
                <td class="py-2 px-2 text-right font-bold">${i.total}</td>
                <td class="py-2 px-2 text-right ${i.open?'text-amber-700 font-semibold':'text-slate-400'}">${i.open}</td>
                <td class="py-2 px-2 text-right text-emerald-700">${i.done}</td>
                <td class="py-2 px-2 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${_spUrgBadge(i.urgency)}">${i.urgency}</span></td>
                <td class="py-2 px-2 text-slate-600">${_spTop(i.byDiv,3).map(([d,c])=>`${escapeHtml(d)} ${c}`).join(' · ')}</td>
                <td class="py-2 px-2 text-slate-600">${_spTop(i.byDmg,2).map(([d,c])=>`${escapeHtml(d)} (${c})`).join(', ')}</td>
                <td class="py-2 px-2 text-slate-500 whitespace-nowrap">${i.lastTs?fmtDateShort(i.lastTs):'—'}</td>
                <td class="py-2 px-2 text-[10px] text-slate-400">${Object.keys(i.variants).length>1?`<span class="text-amber-700" title="${escapeHtml(Object.keys(i.variants).join(' | '))}"><i class="fas fa-spell-check mr-1"></i>${Object.keys(i.variants).length} variasi</span>`:'—'}</td></tr>`).join('') + '</tbody>' : '';
        if(nd){ nd.classList.toggle('hidden', cat.length>0); nd.textContent = spSearch?`Tidak ada sparepart yang cocok dengan "${spSearch}"`:'Belum ada data sparepart pada filter aktif'; }
    }
    // Gap: laporan terbuka tanpa daftar sparepart
    const gap=document.getElementById('spGap');
    if(gap){
        const n=stats.reportsNeedNoSp;
        gap.classList.toggle('hidden', !n);
        if(n) gap.innerHTML = `<div class="flex items-start gap-3 text-xs text-amber-900"><i class="fas fa-circle-info text-amber-600 mt-0.5"></i><div><b>${n} laporan yang belum selesai tidak mencantumkan sparepart.</b> Kebutuhan sparepart untuk laporan tersebut belum masuk analisa ini — lengkapi kolom <i>Spareparts Yang Dibutuhkan</i> di spreadsheet atau lewat tombol edit di tab Data Lengkap agar perencanaan pengadaan akurat.</div></div>`;
    }
    if(rebuildCharts) renderSparepartCharts();
}

function spBarOpts(extra){
    const base = mkOpts(true,{indexAxis:'y'});
    base.plugins.legend = {display:true,position:'top',labels:{boxWidth:10,font:{size:10}}};
    base.scales = {x:{stacked:true,grid:{color:GRID_COLOR},ticks:{color:TICK_COLOR,font:{size:10},precision:0},border:{display:false},beginAtZero:true,grace:'12%'},
                   y:{stacked:true,grid:{display:false},ticks:{color:TICK_COLOR,font:{size:10},autoSkip:false},border:{display:false}}};
    return Object.assign(base, extra||{});
}
function renderSparepartCharts(){
    dk('spTop'); dk('spDiv');
    if(!__spChartData) return;
    const {topN, top8, divs} = __spChartData;
    const tEl=document.getElementById('spTopChart');
    if(tEl && isElVisible(tEl) && topN.length){
        charts.spTop = new Chart(tEl.getContext('2d'),{type:'bar',data:{labels:topN.map(i=>i.name),datasets:[
            {label:'Masih dibutuhkan',data:topN.map(i=>i.open),backgroundColor:'#f59e0b',stack:'s',borderRadius:3,maxBarThickness:18},
            {label:'Sudah terpenuhi',data:topN.map(i=>i.done),backgroundColor:'#14b8a6',stack:'s',borderRadius:3,maxBarThickness:18}]},
            options:spBarOpts({
                onClick:(e,els)=>{ if(els.length) openSparepartDetail(topN[els[0].index].key); }})});
    }
    const dEl=document.getElementById('spDivChart');
    if(dEl && isElVisible(dEl) && top8.length && divs.length){
        const CC=['#2563eb','#f59e0b','#10b981','#8b5cf6','#ec4899','#64748b'];
        charts.spDiv = new Chart(dEl.getContext('2d'),{type:'bar',data:{labels:top8.map(i=>i.name),datasets:divs.map((dv,ix)=>({label:dv,data:top8.map(i=>i.byDiv[dv]||0),backgroundColor:DIV_COLORS[dv]||CC[ix%CC.length],stack:'s',borderRadius:3,maxBarThickness:18}))},
            options:spBarOpts({
                onClick:(e,els)=>{ if(els.length) openSparepartDetail(top8[els[0].index].key); }})});
    }
}

function openSparepartDetail(key){
    const it = buildSparepartStats().list.find(i=>i.key===key);
    const modal=document.getElementById('typeDetailModal'); if(!modal || !it) return;
    const recs=[...it.records].sort((a,b)=>(isOpen(b)-isOpen(a))||(b.__t||0)-(a.__t||0));
    modal.querySelector('.modal').innerHTML = `
        <div class="p-5 text-white" style="background:linear-gradient(135deg,#0d9488,#0f766e)">
            <div class="flex items-start justify-between gap-3">
                <div><div class="text-[10px] uppercase tracking-widest font-semibold opacity-80">Detail Sparepart</div>
                <h3 class="display-font font-bold text-2xl leading-tight">${escapeHtml(it.name)}</h3>
                <div class="text-[11px] opacity-90 mt-1">${it.total} permintaan · ${it.open} masih terbuka · ${it.done} selesai · skor urgensi <b>${it.score}</b> (${it.urgency})${Object.keys(it.variants).length>1?` · ditulis sebagai: ${escapeHtml(Object.keys(it.variants).join(', '))}`:''}</div></div>
                <button onclick="closeModal('typeDetailModal')" class="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 flex items-center justify-center"><i class="fas fa-times"></i></button>
            </div>
        </div>
        <div class="p-5">
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 text-xs">
                <div class="bg-slate-50 rounded-lg p-2"><div class="text-[10px] text-slate-400 uppercase">Divisi</div>${_spTop(it.byDiv,3).map(([d,c])=>`<div><b style="color:${DIV_COLORS[d]||'#475569'}">${escapeHtml(d)}</b> ${c}</div>`).join('')||'—'}</div>
                <div class="bg-slate-50 rounded-lg p-2"><div class="text-[10px] text-slate-400 uppercase">Lokasi teratas</div>${_spTop(it.byLok,3).map(([d,c])=>`<div><b>${escapeHtml(d)}</b> ${c}</div>`).join('')||'—'}</div>
                <div class="bg-slate-50 rounded-lg p-2"><div class="text-[10px] text-slate-400 uppercase">Jenis kerusakan</div>${_spTop(it.byDmg,3).map(([d,c])=>`<div><b>${escapeHtml(d)}</b> ${c}</div>`).join('')||'—'}</div>
                <div class="bg-slate-50 rounded-lg p-2"><div class="text-[10px] text-slate-400 uppercase">Aset</div>${_spTop(it.byAsset,3).map(([d,c])=>`<div><b>${escapeHtml(d)}</b> ${c}</div>`).join('')||'—'}</div>
            </div>
            <div class="overflow-x-auto"><table class="w-full text-xs">
                <thead><tr class="text-[10px] uppercase text-slate-400 border-b border-slate-200"><th class="text-left py-1.5 pr-2">Tanggal</th><th class="text-left py-1.5 pr-2">Lokasi</th><th class="text-left py-1.5 pr-2">Unit</th><th class="text-left py-1.5 pr-2">Kerusakan</th><th class="text-left py-1.5 pr-2">Tingkat</th><th class="text-left py-1.5 pr-2">Status</th><th class="py-1.5"></th></tr></thead>
                <tbody>${recs.map(d=>`<tr class="border-b border-slate-100 last:border-0 align-top">
                    <td class="py-2 pr-2 whitespace-nowrap">${fmtDateShort(d.timestamp)}<div class="text-[10px] text-slate-400">${isOpen(d)?daysSince(d.timestamp)+' hari':''}</div></td>
                    <td class="py-2 pr-2 font-semibold text-blue-700">${escapeHtml(d.lokasi)}<div class="text-[10px] text-slate-400 font-normal">${escapeHtml(d.divisi)}</div></td>
                    <td class="py-2 pr-2 text-slate-600">${escapeHtml(d.engine!=='-'?d.engine:d.irrigator)}</td>
                    <td class="py-2 pr-2 text-slate-700">${escapeHtml(d.damageType)}<div class="text-[10px] text-slate-400">${escapeHtml((d.keterangan||'').slice(0,80))}</div></td>
                    <td class="py-2 pr-2">${tingkatBadge(effectiveTingkat(d))}</td>
                    <td class="py-2 pr-2">${statusBadge(d)}</td>
                    <td class="py-2 whitespace-nowrap">${getWriteUrl()?`<button onclick="closeModal('typeDetailModal');openEditModalRaw(${rawData.indexOf(d)})" class="act-btn edit" title="Edit"><i class="fas fa-pen"></i></button>`:''}</td>
                </tr>`).join('')}</tbody>
            </table></div>
        </div>`;
    openModal('typeDetailModal');
}

function spExportCsv(){
    const list=buildSparepartStats().list.sort((a,b)=>b.score-a.score||b.total-a.total);
    const esc=v=>`"${String(v==null?'':v).replace(/"/g,'""')}"`;
    const head=['Sparepart','Urgensi','Skor','Total Permintaan','Masih Terbuka','Selesai','Tanpa PR','Berat','Sedang','Ringan','Umur Terbuka Tertua (hari)','Divisi','Lokasi (terbuka)','Jenis Kerusakan','Terakhir Diminta'];
    const rows=list.map(i=>[i.name,i.urgency,i.score,i.total,i.open,i.done,i.noPr,i.berat,i.sedang,i.ringan,i.oldestOpen,
        Object.entries(i.byDiv).map(([d,c])=>`${d}:${c}`).join(' | '),Object.entries(i.lokOpen).map(([d,c])=>`${d}:${c}`).join(' | '),Object.entries(i.byDmg).map(([d,c])=>`${d}:${c}`).join(' | '),i.lastTs?new Date(i.lastTs).toISOString().slice(0,10):'']);
    const csv='\ufeff'+[head,...rows].map(r=>r.map(esc).join(';')).join('\r\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); a.download=`kebutuhan-spareparts-${new Date().toISOString().slice(0,10)}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}

// ---------- Model status (3 tahap) ----------
// Sheet punya 2 kolom terpisah: "Status Perbaikan" (Sudah/Belum) dan "Nomor PR".
//   Selesai         = Status Perbaikan "Sudah"
//   Proses          = belum diperbaiki tapi sudah ada Nomor PR / Notifikasi
//   Belum Ditangani = belum diperbaiki dan belum ada PR
const STATUS_ORDER = ['Belum Ditangani','Proses','Selesai'];
const STATUS_META = {
    'Belum Ditangani': {color:'#94a3b8', bg:'bg-slate-100',   text:'text-slate-700',   icon:'fa-hourglass-half', short:'Belum'},
    'Proses':          {color:'#f59e0b', bg:'bg-amber-100',   text:'text-amber-700',   icon:'fa-cogs',           short:'Proses'},
    'Selesai':         {color:'#10b981', bg:'bg-emerald-100', text:'text-emerald-700', icon:'fa-circle-check',   short:'Selesai'}
};
const TINGKAT_ORDER = ['Berat','Sedang','Ringan'];
function normRepair(v){ v=String(v||'').trim().toLowerCase(); if(!v) return ''; return /^(sudah|selesai|done|ya|yes|y|ok|1|true)/.test(v)?'Sudah':'Belum'; }
// Nama lama di Google Form → nama baru (data historis di sheet tetap tampil konsisten).
// Saat baris lama diedit lewat web, nilai baru yang tersimpan ke sheet.
const DAMAGE_ALIASES = { 'panel': 'Panel Listrik' };
function normDamageType(v){ v=String(v==null?'':v).replace(/\s+/g,' ').trim(); if(!v) return ''; const a=DAMAGE_ALIASES[v.toLowerCase()]; return a||v; }
function normTingkat(v){ v=String(v||'').trim().toLowerCase(); if(/berat|tinggi|high|major/.test(v)) return 'Berat'; if(/sedang|medium|moderate/.test(v)) return 'Sedang'; if(/ringan|rendah|low|minor/.test(v)) return 'Ringan'; return ''; }
function deriveStatus(pr, repair){ if(normRepair(repair)==='Sudah') return 'Selesai'; return pr ? 'Proses' : 'Belum Ditangani'; }
function isOpen(d){ return d.status!=='Selesai'; }
function statusBadge(d, withPr=true){
    const m = STATUS_META[d.status] || STATUS_META['Belum Ditangani'];
    const extra = d.status==='Proses' && withPr && d.prNumber ? ` · ${escapeHtml(d.prNumber)}` : '';
    return `<span class="status-badge ${m.bg} ${m.text}"><i class="fas ${m.icon} text-[9px]"></i>${d.status}${extra}</span>`;
}
function tingkatBadge(t){
    if(!t) return '<span class="text-slate-400 italic text-[10px]">—</span>';
    const R = (typeof SEVERITY_RULES!=='undefined' && SEVERITY_RULES[t]) ? SEVERITY_RULES[t] : {bg:'bg-slate-100',text:'text-slate-700'};
    return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${R.bg} ${R.text}">${t}</span>`;
}


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
    tingkat: [],
    damage: [],
    pic: [],
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
    // Tahun salah ketik seperti "0026" / "26" → 2026 (umum terjadi saat input manual di form)
    function fixYear(y){ y=+y; if(y<100) y+=2000; else if(y>=1000&&y<1900) y=y%100+2000; return y; }
    function mk(yyyy,mm,dd,hh,mi,ss){
        const y=fixYear(yyyy);
        if(mm<1||mm>12||dd<1||dd>31) return null;
        const d=new Date(y, mm-1, dd, +(hh||0), +(mi||0), +(ss||0));
        if(y<100) d.setFullYear(y);
        if(d.getFullYear()!==y||d.getMonth()!==mm-1||d.getDate()!==dd) return null;
        return d;
    }
    function tryDMY(dd,mm,yyyy,hh,mi,ss){ return mk(yyyy,+mm,+dd,hh,mi,ss); }
    function tryMDY(mm,dd,yyyy,hh,mi,ss){ return mk(yyyy,+mm,+dd,hh,mi,ss); }

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
    const hi = {ts:-1,tglInsp:-1,lok:-1,div:-1,eT:-1,eC:-1,iT:-1,iC:-1,dT:-1,dN:-1,sp:-1,pr:-1,tk:-1,rp:-1,pic:-1};
    headers.forEach((name,i) => {
        const k = String(name).toLowerCase().trim();
        if (k === 'timestamp') hi.ts = i;
        else if (k === 'pic' || k.startsWith('pic ') || k.includes('penanggung jawab')) hi.pic = i;
        else if (k.includes('tanggal inspeksi')) hi.tglInsp = i;
        else if (k.includes('lokasi')) hi.lok = i;
        else if (k.includes('divisi')) hi.div = i;
        else if (k.includes('jenis engine')) hi.eT = i;
        else if (k.includes('kode engine')) hi.eC = i;
        else if (k.includes('jenis irrigator')) hi.iT = i;
        else if (k.includes('kode irrigator')) hi.iC = i;
        else if (k.includes('tingkat')) hi.tk = i;
        else if (k.includes('status perbaikan') || k.includes('status')) hi.rp = i;
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
        const dt = normDamageType(get('dT')), dn = get('dN'), sp = get('sp'), pr = get('pr');
        const tingkat = normTingkat(get('tk')), repair = normRepair(get('rp'));
        const rawTk = get('tk'), rawRp = get('rp'), rawTgl = get('tglInsp');
        const irrigator = (it && ic && it !== ic) ? `${it} – ${ic}` : (ic || it || '-');
        const engine = [et,ec].filter(Boolean).join(' – ');
        const damage = dn ? (dt ? `${dt} — ${dn}` : dn) : (dt || '-');
        const spNorm = sp ? sp.replace(/[\r\n]+/g,'; ').replace(/\s*;\s*/g,'; ') : '-';
        const status = deriveStatus(pr, repair);
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
            sparepart: spNorm, prNumber: pr || null, pic: get('pic') || '-', status, repairStatus: repair || 'Belum', tingkat, unit: lok || '-',
            __rawTingkat: rawTk, __rawRepair: rawRp, __rawTgl: rawTgl, __rawTs: get('ts'), __yearFixed: /\/0\d{3}$|\/\d{2}$/.test(rawTgl),
            __row: i+1 // baris spreadsheet: rows[0]=header (baris 1), rows[1]=baris 2, dst.
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
            status:hasPr?'Proses':'Belum Ditangani',repairStatus:'Belum',tingkat:['Berat','Sedang','Ringan'][Math.floor(Math.random()*3)],unit:''
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
        const dt = normDamageType(r.damageType)||'-', dn = r.keterangan||r.notes||'';
        const sp = (r.sparepart||'-');
        const pr = r.prNumber||null;
        const repair = normRepair(r.repairStatus) || 'Belum';
        const tingkat = normTingkat(r.tingkat);
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
            pic: (r.pic && r.pic!=='-') ? String(r.pic).trim() : '-',
            repairStatus: repair, tingkat,
            status: deriveStatus(pr, repair),
            unit: r.lokasi || r.unit || '-',
            timestamp: mergedTs.toISOString(),
            tanggalInspeksi: localIsoDate(tglObj),
            __rawTingkat: r.__rawTingkat||'', __rawRepair: r.__rawRepair||'', __rawTgl: r.__rawTgl||'', __yearFixed: !!r.__yearFixed,
            __row: typeof r.__row==='number'?r.__row:(i+1)
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

// ---- Rekonsiliasi tulis-lalu-baca ----
// Setelah edit/tambah/hapus, Google kadang masih mengirim CSV LAMA selama beberapa
// detik (cache gviz). Tanpa penjaga ini, perubahan yang baru disimpan tampak
// "kembali seperti semula" di dashboard. Perubahan lokal dipertahankan sampai
// data server benar-benar mencerminkannya (maks. 60 detik), lalu sync diulang.
const PENDING_TTL = 60*1000;
const __pendingWrites = []; // {kind:'update'|'create'|'delete', ts, row, rec, key}
const __syncMismatch = {}; // key → {rec, ts}: hasil edit web yang belum sama dengan sheet
const _wkey = d => `${lokKey(d.lokasi)}|${String(d.damageType||'').trim().toLowerCase()}|${d.tanggalInspeksi}`;
const _ketKey = v => String(v||'').toLowerCase().replace(/\s+/g,' ').trim();
// Laporan "sama": tanggal + lokasi + jenis + keterangan identik (abaikan spasi/huruf besar)
const _dupKey = d => `${_wkey(d)}|${_ketKey(d.keterangan)}`;
const _normF = (f,v) => { v = (v==null||v==='-') ? '' : String(v).trim(); return f==='lokasi' ? lokKey(v) : (f==='keterangan'||f==='sparepart') ? _ketKey(v) : v; };
const _sameFields = (a,b) => ['lokasi','divisi','damageType','keterangan','sparepart','prNumber','repairStatus','tingkat','engineType','engineCode','irrType','irrCode','tanggalInspeksi','pic']
    .every(f => _normF(f,a[f]) === _normF(f,b[f]));
function notePendingWrite(kind, rec, row){
    __pendingWrites.push({kind, ts:Date.now(), row: (typeof row==='number'?row:rec&&rec.__row), rec, key: rec?_wkey(rec):null});
}
function reconcilePendingWrites(data){
    const now=Date.now(); let unresolved=false;
    for(let i=__pendingWrites.length-1;i>=0;i--){
        const pw=__pendingWrites[i];
        if(now-pw.ts>PENDING_TTL){
            // Lewat 60 dtk hasil tulis dari web masih belum terlihat sama di spreadsheet → beri tahu
            if(pw.kind!=='delete' && pw.rec){
                const srv = data.find(d=>d.__row===pw.row) || data.find(d=>_wkey(d)===pw.key);
                if(srv && !_sameFields(srv,pw.rec)){
                    __syncMismatch[pw.key] = {rec:pw.rec, ts:pw.ts}; // ditandai oleh validateRecord sampai cocok / 15 menit
                    showToast(`Perubahan ${pw.rec.lokasi} · ${pw.rec.damageType} dari web belum sama dengan spreadsheet. Lihat notifikasi.`,'warning');
                } else if(!srv && pw.kind==='create'){
                    showToast(`Laporan baru ${pw.rec.lokasi} · ${pw.rec.damageType} belum terlihat di spreadsheet setelah 1 menit — periksa sheet.`,'warning');
                }
            }
            __pendingWrites.splice(i,1); continue;
        }
        let resolved=false;
        if(pw.kind==='update'){
            const srv = data.find(d=>d.__row===pw.row) || data.find(d=>_wkey(d)===pw.key);
            if(!srv || _sameFields(srv,pw.rec)) resolved=true;
            else { const idx=data.indexOf(srv); data[idx]=Object.assign({}, pw.rec, {__row: srv.__row}); }
        } else if(pw.kind==='create'){
            if(data.some(d=>_wkey(d)===pw.key) || (pw.row && data.some(d=>d.__row===pw.row && lokKey(d.lokasi)===lokKey(pw.rec.lokasi)))) resolved=true;
            else data.unshift(pw.rec);
        } else if(pw.kind==='delete'){
            const idx = data.findIndex(d=>_wkey(d)===pw.key && (pw.row==null || d.__row===pw.row));
            if(idx<0) resolved=true; else data.splice(idx,1);
        }
        if(resolved) __pendingWrites.splice(i,1); else unresolved=true;
    }
    if(unresolved){
        clearTimeout(reconcilePendingWrites._t);
        reconcilePendingWrites._t = setTimeout(()=>refreshData(true,{silent:true}), 5000);
    }
    return data;
}

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

    // Paint sementara (cache lokal / data.json) sambil menunggu data segar dari Sheets
    const paintInterim = (recs, label) => {
        rawData = indexRecords(recs); validateAll(rawData);
        populateMultiSelect('divisiFilter', [...new Set(rawData.map(d=>d.divisi).filter(v=>v&&v!=='-'))].sort(), state.divisi);
        populateMultiSelect('lokasiFilter', [...new Set(rawData.map(d=>d.lokasi).filter(v=>v&&v!=='-'))].sort(), state.lokasi);
        populateMultiSelect('statusFilter', STATUS_ORDER, state.status);
        populateMultiSelect('tingkatFilter', TINGKAT_ORDER, state.tingkat);
        populateMultiSelect('damageFilter', damageOptions(), state.damage);
        populateMultiSelect('picFilter', picOptions(), state.pic);
        applyFilters();
        if(ls) ls.classList.add('hidden');
        const dsEl=document.getElementById('dataSource'); if(dsEl) dsEl.textContent = `${label==='github-cache'?'Cache GitHub':'Cache lokal'} · ${rawData.length} record · memperbarui…`;
    };
    if (isFirstLoad && !rawData.length) {
        try {
            const c = JSON.parse(localStorage.getItem(LOCAL_CACHE_KEY)||'null');
            if (c && Array.isArray(c.data) && c.data.length && (Date.now()-c.ts) < 7*86400000) paintInterim(normalizeFromJson(c.data), 'local');
        } catch(e) {}
    }
    // Unit terpasang (spreadsheet Draft Dashboard) ikut disegarkan pada SETIAP refresh —
    // tombol Refresh, muat/refresh browser, auto-refresh, dan saat kembali online.
    if(window.PG2_CONFIG && window.PG2_CONFIG.UNITS_SHEET_ID) loadUnits(true).catch(()=>{});
    const run = (async () => {
        let data=null, source='empty', note='';
        // 1) Live Sheets — pada muat pertama tanpa cache lokal, data.json (GitHub, origin
        //    sama & cepat) diambil paralel dan dipakai dulu bila Sheets lambat (>1,2 dtk),
        //    lalu ditimpa hasil live begitu tiba. Layar tidak kosong menunggu Google.
        const livePromise = fetchLiveCSV();
        let cachePromise = null;
        if (isFirstLoad && !rawData.length) {
            cachePromise = fetchGithubCache();
            const early = await Promise.race([livePromise.then(()=> 'live'), new Promise(r=>setTimeout(()=>r('slow'),1200))]);
            if (early === 'slow') {
                const quick = await Promise.race([cachePromise, new Promise(r=>setTimeout(()=>r(null),1500))]);
                if (quick && quick.length && seq === __refreshSeq && !rawData.length) {
                    paintInterim(quick, 'github-cache');
                }
            }
        }
        data = await livePromise;
        if (data && data.length) source='live-sheet';
        // 2) Cadangan: data.json (cache GitHub)
        if (!data || !data.length) {
            const cached = await (cachePromise || fetchGithubCache());
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

        if(source==='live-sheet' || source==='github-cache') data = reconcilePendingWrites(data);
        validateAll(data);
        rawData = indexRecords(data);
        renderQualityBanner();
        if (source==='live-sheet' || source==='github-cache') {
            // Simpan di latar (idle) tanpa field turunan agar cache kecil & parse cepat
            const persist = () => { try {
                const slim = data.map(d=>{ const o={}; for(const k in d){ if(!k.startsWith('__') || k==='__row') o[k]=d[k]; } return o; });
                localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ts:Date.now(), src:source, data:slim}));
            } catch(e) {} };
            (window.requestIdleCallback ? requestIdleCallback(persist,{timeout:3000}) : setTimeout(persist,500));
        }
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
        populateMultiSelect('statusFilter', STATUS_ORDER, state.status);
        populateMultiSelect('tingkatFilter', TINGKAT_ORDER, state.tingkat);
        populateMultiSelect('damageFilter', damageOptions(), state.damage);
        populateMultiSelect('picFilter', picOptions(), state.pic);

        state.divisi = state.divisi.filter(v => rawData.some(d => d.divisi === v));
        state.lokasi = state.lokasi.filter(v => rawData.some(d => d.lokasi === v));
        state.status = state.status.filter(v => STATUS_ORDER.includes(v));
        state.tingkat = state.tingkat.filter(v => TINGKAT_ORDER.includes(v));
        state.damage = state.damage.filter(v => rawData.some(d => d.damageType === v));
        state.pic = state.pic.filter(v => picOptions().includes(v));

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
// Posisikan menu dropdown agar tidak keluar layar (penting di HP: menu lebih lebar dari
// tombolnya sehingga, dengan rata-kanan, sisi kirinya terpotong — terutama "Jenis Kerusakan").
function msPlaceMenu(w){
    const menu = w.querySelector('.ms-menu'); if(!menu) return;
    menu.style.left=''; menu.style.right=''; menu.style.maxWidth='';
    menu.style.maxWidth = Math.max(160, window.innerWidth - 24) + 'px';
    const r = menu.getBoundingClientRect();
    if (r.left < 8) {                        // terpotong di kiri → rata kiri dengan tombol
        menu.style.right='auto'; menu.style.left='0';
        const r2 = menu.getBoundingClientRect();
        if (r2.right > window.innerWidth - 8)  // masih lewat kanan → geser ke dalam layar
            menu.style.left = Math.round(-(r2.right - (window.innerWidth - 8))) + 'px';
    } else if (r.right > window.innerWidth - 8) {
        menu.style.left='auto'; menu.style.right='0';
    }
    // batasi tinggi daftar agar muat di layar
    const list = menu.querySelector('.ms-list');
    if (list) { const top = list.getBoundingClientRect().top; list.style.maxHeight = Math.max(120, window.innerHeight - top - 16) + 'px'; }
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
    // Render konten tab ini bila belum (lazy) + chart yang sekarang visible
    if(__dirtyTabs.has(tab)) renderTabContent(tab);
    else requestAnimationFrame(() => renderCharts());
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

    const fromT = from.getTime(), toT = to.getTime();
    const qFlat = q ? q.replace(/[^a-z0-9]/g,'') : '';
    filteredData = rawData.filter(d => {
        const t = d.__t !== undefined ? d.__t : new Date(d.timestamp).getTime();
        if (t < fromT || t > toT) return false;
        if (state.divisi.length && !state.divisi.includes(d.divisi)) return false;
        if (state.lokasi.length && !state.lokasi.includes(d.lokasi)) return false;
        if (state.status.length && !state.status.includes(d.status)) return false;
        if (state.tingkat.length && !state.tingkat.includes(effectiveTingkat(d))) return false;
        if (state.damage.length && !state.damage.includes(d.damageType)) return false;
        if (state.pic.length && !state.pic.includes(picOf(d))) return false;
        if (q) {
            // Blob utama + blob "padat" (BTI0032 / BTI 0032 / BTI-0032 semuanya ketemu) — sudah dipra-hitung
            if(d.__blob===undefined) indexRecords([d]);
            if (!d.__blob.includes(q) && !(qFlat && d.__flat.includes(qFlat))) return false;
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
    updateTabBadges();
    // Render malas: hanya tab yang sedang terlihat yang dirender sekarang;
    // tab lain ditandai "kotor" dan dirender saat dibuka (hemat ~70% waktu per filter).
    __dirtyTabs = new Set(['overview','damage','divisi','engine','irrigator','severity','spareparts','calendar','data']);
    renderTabContent(state.tab);
}

let __dirtyTabs = new Set();
const TAB_RENDERERS = {
    overview:  () => { renderOverview(); },
    damage:    () => { renderDamageTab(); },
    divisi:    () => { renderDivisiTab(); },
    engine:    () => { renderEngineTab(); },
    irrigator: () => { renderIrrTab(); },
    severity:  () => { renderSeverityTab(); },
    spareparts:() => { renderSparepartsTab(false); },
    calendar:  () => { renderCalendar(); renderCalDayDetail(); },
    data:      () => { renderTable(); }
};
function renderTabContent(tab){
    if(!__dirtyTabs.has(tab)) return;
    __dirtyTabs.delete(tab);
    try { (TAB_RENDERERS[tab]||(()=>{}))(); } catch(e){ console.error('render tab',tab,e); }
    renderCharts(); // hanya chart yang visible yang dibuat (isElVisible)
}

function renderActiveChips() {
    const chips = [];
    state.divisi.forEach(v => chips.push({label:`Div: ${v}`, clear:()=>{state.divisi=state.divisi.filter(x=>x!==v);repop('divisiFilter','divisi');}}));
    state.lokasi.forEach(v => chips.push({label:`Lok: ${v}`, clear:()=>{state.lokasi=state.lokasi.filter(x=>x!==v);repop('lokasiFilter','lokasi');}}));
    state.status.forEach(v => chips.push({label:`Status: ${v}`, clear:()=>{state.status=state.status.filter(x=>x!==v);repop('statusFilter','status');}}));
    state.tingkat.forEach(v => chips.push({label:`Tingkat: ${v}`, clear:()=>{state.tingkat=state.tingkat.filter(x=>x!==v);repop('tingkatFilter','tingkat');}}));
    state.damage.forEach(v => chips.push({label:`Kerusakan: ${v}`, clear:()=>{state.damage=state.damage.filter(x=>x!==v);repop('damageFilter','damage');}}));
    state.pic.forEach(v => chips.push({label:`PIC: ${v}`, clear:()=>{state.pic=state.pic.filter(x=>x!==v);repop('picFilter','pic');}}));
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
// PIC (penanggung jawab perbaikan) — kolom baru di Google Form. Laporan lama tanpa PIC
// dikelompokkan sebagai "Belum diisi" agar tetap bisa difilter.
const PIC_EMPTY = 'Belum diisi';
function picOf(d){ return d.pic && d.pic!=='-' ? d.pic : PIC_EMPTY; }
function picOptions(){
    const cnt={}; rawData.forEach(d=>{ const v=picOf(d); cnt[v]=(cnt[v]||0)+1; });
    const form=(typeof FORM_OPTIONS!=='undefined'&&FORM_OPTIONS.pic)||[];
    const vals=[...new Set([...form, ...Object.keys(cnt).filter(v=>v!==PIC_EMPTY)])];
    if(cnt[PIC_EMPTY]) vals.push(PIC_EMPTY);
    return vals;
}
function damageOptions(){
    const cnt={}; rawData.forEach(d=>{ const v=d.damageType; if(v&&v!=='-') cnt[v]=(cnt[v]||0)+1; });
    const fromData=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a]||a.localeCompare(b));
    const extra=(typeof FORM_OPTIONS!=='undefined'&&FORM_OPTIONS.damageType||[]).filter(v=>!cnt[v]).sort();
    return fromData.concat(extra);
}
function repop(id,key){
    const allOpts = key==='divisi' ? [...new Set(rawData.map(d=>d.divisi).filter(v=>v&&v!=='-'))].sort()
                   : key==='lokasi' ? [...new Set(rawData.map(d=>d.lokasi).filter(v=>v&&v!=='-'))].sort()
                   : key==='tingkat' ? TINGKAT_ORDER
                   : key==='damage' ? damageOptions()
                   : key==='pic' ? picOptions()
                   : STATUS_ORDER;
    populateMultiSelect(id, allOpts, state[key]);
}
function setPeriodUI(p){
    document.querySelectorAll('.filter-btn').forEach(b=>{
        if(b.dataset.filter===p){b.classList.add('active');b.classList.remove('text-slate-600');}
        else{b.classList.remove('active');b.classList.add('text-slate-600');}
    });
}
function clearAllFilters() {
    state.divisi = []; state.lokasi = []; state.status = []; state.tingkat = []; state.damage = []; state.pic = [];
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
    populateMultiSelect('statusFilter',STATUS_ORDER,[]);
    populateMultiSelect('tingkatFilter',TINGKAT_ORDER,[]);
    populateMultiSelect('damageFilter',damageOptions(),[]);
    populateMultiSelect('picFilter',picOptions(),[]);
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
    const done=filteredData.filter(d=>d.status==='Selesai').length;
    animateNumber('statTotal',t);
    const sd = document.getElementById('statDone'); if(sd) animateNumberEl(sd,done);
    const sds = document.getElementById('statDoneSub'); if(sds) sds.textContent = `${t?Math.round(done/t*100):0}% sudah diperbaiki`;
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
    // Hentikan animasi sebelumnya pada elemen yang sama — dua interval yang berjalan
    // bersamaan bisa berakhir di angka lama (KPI salah setelah refresh beruntun).
    if(el.__animT){ clearInterval(el.__animT); el.__animT=null; }
    const cur=parseInt((el.textContent||'0').replace(/\./g,''))||0;
    if(cur===tgt){ el.textContent=tgt.toLocaleString('id-ID'); return; }
    if(document.hidden){ el.textContent=tgt.toLocaleString('id-ID'); return; }
    const step=Math.max(1,Math.ceil(Math.abs(tgt-cur)/15));
    let v=cur;
    el.__animT=setInterval(()=>{
        if(v<tgt)v=Math.min(v+step,tgt);
        else if(v>tgt)v=Math.max(v-step,tgt);
        el.textContent=v.toLocaleString('id-ID');
        if(v===tgt){clearInterval(el.__animT); el.__animT=null;}
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

    // ---- Plugin label angka (tanpa dependensi eksternal) ----
    // Menulis nilai di ujung batang (total untuk batang bertumpuk, segmen bila cukup lebar)
    // dan di atas titik grafik garis/timeline. Nonaktifkan per chart: plugins:{valueLabels:false}.
    const VL_FONT = '600 10px Inter,system-ui,sans-serif';
    function vlText(ctx, txt, x, y, align, base, color, halo=true){
        ctx.font = VL_FONT; ctx.textAlign = align; ctx.textBaseline = base;
        if(halo){ ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineJoin='round'; ctx.strokeText(txt, x, y); }
        ctx.fillStyle = color; ctx.fillText(txt, x, y);
    }
    const fmtVal = v => Number.isInteger(v) ? v.toLocaleString('id-ID') : (Math.round(v*10)/10).toLocaleString('id-ID');
    Chart.register({
        id: 'valueLabels',
        afterDatasetsDraw(chart, args, opts){
            if(opts === false || (opts && opts.display === false)) return;
            const {ctx, chartArea} = chart; if(!chartArea) return;
            const type = chart.config.type;
            ctx.save();
            if(type === 'bar'){
                const horiz = chart.options.indexAxis === 'y';
                const metas = chart.getSortedVisibleDatasetMetas().filter(m=>m.type==='bar');
                if(!metas.length){ ctx.restore(); return; }
                // Total per index per stack & dataset terakhir pada stack tsb
                const stackTotals = {}, lastInStack = {};
                metas.forEach(m=>{
                    const stackKey = m.stack ?? ('__ds'+m.index);
                    const data = chart.data.datasets[m.index].data;
                    data.forEach((v,i)=>{ const n=+v||0; const k=stackKey+'|'+i; stackTotals[k]=(stackTotals[k]||0)+n; if(n>0) lastInStack[k]=m.index; });
                });
                const anyStacked = metas.some(m=>m.stack!=null) && metas.length>1;
                metas.forEach(m=>{
                    const stackKey = m.stack ?? ('__ds'+m.index);
                    const data = chart.data.datasets[m.index].data;
                    m.data.forEach((bar,i)=>{
                        const v = +data[i]||0; if(!v) return;
                        const k = stackKey+'|'+i;
                        const props = bar.getProps(['x','y','base','width','height'], true);
                        const thick = horiz ? props.height : props.width;
                        if(thick < 8) return; // terlalu rapat → lewati agar tidak berantakan
                        const len = horiz ? Math.abs(props.x - props.base) : Math.abs(props.y - props.base);
                        const isLast = anyStacked ? lastInStack[k]===m.index : true;
                        const total = stackTotals[k];
                        // Label segmen di dalam batang bertumpuk (hanya jika muat)
                        if(anyStacked && len >= 18 && v !== total){
                            const cx = horiz ? (props.x + props.base)/2 : props.x;
                            const cy = horiz ? props.y : (props.y + props.base)/2;
                            vlText(ctx, fmtVal(v), cx, cy, 'center', 'middle', '#fff', false);
                        }
                        if(!isLast) return;
                        // Label total/nilai di ujung batang; bila tidak ada ruang di luar, taruh di dalam
                        const txt = fmtVal(total);
                        if(horiz){
                            const w = ctx.measureText(txt).width + 6;
                            const outside = props.x + 4 + w <= chartArea.right;
                            vlText(ctx, txt, outside ? props.x + 4 : props.x - 4, props.y, outside ? 'left' : 'right', 'middle', outside ? '#334155' : '#fff', outside);
                        } else {
                            const outside = props.y - 14 >= chartArea.top;
                            vlText(ctx, txt, props.x, outside ? props.y - 3 : props.y + 3, 'center', outside ? 'bottom' : 'top', outside ? '#334155' : '#fff', outside);
                        }
                    });
                });
            } else if(type === 'line'){
                chart.getSortedVisibleDatasetMetas().forEach(m=>{
                    const data = chart.data.datasets[m.index].data; const n = m.data.length; if(!n) return;
                    const step = Math.max(1, Math.ceil(n * 26 / Math.max(1, chartArea.width)));
                    // Selalu beri label: titik puncak & titik terakhir; sisanya tiap `step`
                    let maxI = 0; data.forEach((v,i)=>{ if((+v||0) > (+data[maxI]||0)) maxI=i; });
                    const color = typeof m.dataset?.options?.borderColor === 'string' ? m.dataset.options.borderColor : '#1e40af';
                    m.data.forEach((pt,i)=>{
                        const v = +data[i]||0; if(!v) return;
                        if(i % step !== 0 && i !== maxI && i !== n-1) return;
                        const {x,y} = pt.getProps(['x','y'], true);
                        const outside = y - 14 >= chartArea.top;
                        ctx.font = VL_FONT; const half = ctx.measureText(fmtVal(v)).width/2;
                        const lx = Math.min(Math.max(x, chartArea.left + half), chart.width - half - 2); // jangan terpotong di tepi
                        vlText(ctx, fmtVal(v), lx, outside ? y - 6 : y + 8, 'center', outside ? 'bottom' : 'top', color);
                    });
                });
            }
            ctx.restore();
        }
    });
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
            x:{grid:{display:false},ticks:{color:TICK_COLOR,font:{size:10}},border:{display:false},beginAtZero:true,grace:'12%'},
            y:{grid:{color:GRID_COLOR},ticks:{color:TICK_COLOR,font:{size:10}},border:{display:false}}
        } : {
            x:{grid:{display:false},ticks:{color:TICK_COLOR,font:{size:10},maxRotation:0,autoSkip:true,maxTicksLimit:12},border:{display:false}},
            y:{grid:{color:GRID_COLOR},ticks:{color:TICK_COLOR,font:{size:10},precision:0},border:{display:false},beginAtZero:true,grace:'10%'}
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
    ['trend','status','lokasi','sparepart','jenis','divisi','divStacked','engine','engineType','irrigator','irrType','pic'].forEach(k=>dk(k));
    renderSeverityCharts();
    renderSparepartCharts();

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
                options:mkOpts(false,{plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:TICK_COLOR,font:{size:10},maxRotation:0,autoSkip:true,maxTicksLimit:keys.length<=16?keys.length:12},border:{display:false}},y:{grid:{color:GRID_COLOR},ticks:{color:TICK_COLOR,font:{size:10},precision:0},border:{display:false},beginAtZero:true,grace:'10%'}}})
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
        const sg={'Belum Ditangani':0,'Proses':0,'Selesai':0};
        filteredData.forEach(d=>{if(sg[d.status]!==undefined)sg[d.status]++;});
        const ctx=statusEl.getContext('2d');
        if(ctx){
            charts.status=new Chart(ctx,{
                type:'doughnut',
                data:{labels:Object.keys(sg),datasets:[{
                    data:Object.values(sg),
                    backgroundColor:STATUS_ORDER.map(k=>STATUS_META[k].color),borderWidth:0,hoverOffset:6
                }]},
                options:mkDoughnutOpts()
            });
        }
        const ins = document.getElementById('statusInsight');
        if(ins){
            const tot=sg['Belum Ditangani']+sg['Proses']+sg['Selesai'];
            const pct=tot?Math.round(sg['Belum Ditangani']/tot*100):0;
            const pctDone=tot?Math.round(sg['Selesai']/tot*100):0;
            ins.innerHTML = (pct>50
                ? `<span class="text-red-600 font-semibold"><i class="fas fa-triangle-exclamation mr-1"></i>${pct}% belum ditangani</span>`
                : pct>0
                ? `<span class="text-amber-600 font-semibold"><i class="fas fa-circle-info mr-1"></i>${pct}% belum ditangani</span>`
                : `<span class="text-emerald-600 font-semibold"><i class="fas fa-circle-check mr-1"></i>Semua sudah ditangani</span>`)
                + ` <span class="text-slate-400">·</span> <span class="text-emerald-600 font-semibold">${pctDone}% selesai</span>`;
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

    // ==== PIC: BEBAN KERJA (overview) — kerusakan belum selesai per penanggung jawab ====
    const picEl = document.getElementById('picChart');
    if(picEl && isElVisible(picEl)){
        const st = picStats();
        const rows = st.filter(r=>r.open>0);
        const ctx=picEl.getContext('2d');
        if(ctx && rows.length){
            charts.pic = new Chart(ctx,{
                type:'bar',
                data:{labels:rows.map(r=>r.pic),datasets:[
                    {label:'Belum Ditangani',data:rows.map(r=>r.pending),backgroundColor:'#94a3b8',borderRadius:{topLeft:4,bottomLeft:4,topRight:0,bottomRight:0},borderSkipped:false,stack:'s',maxBarThickness:30},
                    {label:'Proses',data:rows.map(r=>r.proses),backgroundColor:'#f59e0b',borderRadius:{topLeft:0,bottomLeft:0,topRight:4,bottomRight:4},borderSkipped:false,stack:'s',maxBarThickness:30}
                ]},
                options:mkOpts(true,{
                    indexAxis:'y',
                    onClick:(e,els)=>{ if(!els.length) return; const pic=rows[els[0].index].pic; focusPic(pic); },
                    plugins:{legend:{display:false},tooltip:{backgroundColor:'#0f172a',padding:10,cornerRadius:8,titleFont:{size:11,weight:'600'},bodyFont:{size:11},footerFont:{size:10,weight:'400'},callbacks:{footer:(items)=>{ const r=rows[items[0].dataIndex]; return `Total belum selesai: ${r.open} · Selesai: ${r.done} (${r.pctDone}%)`+(r.oldestDays!=null?` · Terlama ${r.oldestDays} hari`:''); }}}},
                    scales:{
                        x:{stacked:true,grid:{color:GRID_COLOR},ticks:{color:TICK_COLOR,font:{size:10},precision:0},border:{display:false},beginAtZero:true,grace:'12%'},
                        y:{stacked:true,grid:{display:false},ticks:{color:TICK_COLOR,font:{size:11,weight:'600'}},border:{display:false}}
                    }
                })
            });
        } else if(ctx){
            ctx.clearRect(0,0,picEl.width,picEl.height);
            ctx.font='12px Inter, sans-serif'; ctx.fillStyle='#94a3b8'; ctx.textAlign='center';
            ctx.fillText('Semua kerusakan pada filter ini sudah selesai 🎉', picEl.width/2/(window.devicePixelRatio||1), picEl.height/2/(window.devicePixelRatio||1));
        }
        renderPicSummary(st);
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
        const done = divs.map(dv=>filteredData.filter(d=>d.divisi===dv&&d.status==='Selesai').length);
        const ctx=stackEl.getContext('2d');
        if(ctx){
            charts.divStacked = new Chart(ctx,{
                type:'bar',
                data:{labels:divs,datasets:[
                    {label:'Belum Ditangani',data:pending,backgroundColor:'#94a3b8',borderRadius:{topLeft:0,topRight:0,bottomLeft:4,bottomRight:4},borderSkipped:false,stack:'s',maxBarThickness:56},
                    {label:'Proses',data:proses,backgroundColor:'#f59e0b',borderRadius:0,borderSkipped:false,stack:'s',maxBarThickness:56},
                    {label:'Selesai',data:done,backgroundColor:'#10b981',borderRadius:{topLeft:4,topRight:4,bottomLeft:0,bottomRight:0},borderSkipped:false,stack:'s',maxBarThickness:56}
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
// Statistik per PIC (dari filteredData): pending (Belum Ditangani), proses, selesai, umur terlama.
function picStats(){
    const now=Date.now(), m={};
    filteredData.forEach(d=>{
        const k=picOf(d); const r=m[k]||(m[k]={pic:k,pending:0,proses:0,done:0,open:0,total:0,oldest:null});
        r.total++;
        if(d.status==='Selesai'){ r.done++; return; }
        r.open++; if(d.status==='Proses') r.proses++; else r.pending++;
        const t=d.__t!==undefined?d.__t:new Date(d.timestamp).getTime();
        if(r.oldest==null||t<r.oldest) r.oldest=t;
    });
    return Object.values(m).map(r=>({...r, pctDone: r.total?Math.round(r.done/r.total*100):0, oldestDays: r.oldest!=null?Math.max(0,Math.floor((now-r.oldest)/86400000)):null}))
        .sort((a,b)=>b.open-a.open||b.pending-a.pending||a.pic.localeCompare(b.pic));
}
function focusPic(pic){
    state.pic = state.pic.length===1 && state.pic[0]===pic ? [] : [pic];
    repop('picFilter','pic'); state.page=1; applyFilters();
    showToast(state.pic.length?`Filter PIC: ${pic}`:'Filter PIC dihapus','info');
}
function renderPicSummary(st){
    const c=document.getElementById('picSummary'); if(!c) return;
    if(!st.length){ c.innerHTML='<div class="text-xs text-slate-400 py-4 text-center italic">Tidak ada data</div>'; return; }
    const totOpen=st.reduce((a,r)=>a+r.open,0);
    const row=r=>{
        const active = state.pic.length===1 && state.pic[0]===r.pic;
        const share = totOpen?Math.round(r.open/totOpen*100):0;
        const warn = r.oldestDays!=null && r.oldestDays>=14;
        return `<tr class="border-t border-slate-100 hover:bg-violet-50/60 cursor-pointer ${active?'bg-violet-50':''}" onclick="focusPic('${escapeHtml(r.pic).replace(/'/g,"\\'")}')" title="Klik untuk fokus/lepas filter PIC ini">
            <td class="py-1.5 pr-2 text-xs font-semibold text-slate-700 whitespace-nowrap">${r.pic===PIC_EMPTY?`<span class="text-slate-400 italic">${escapeHtml(r.pic)}</span>`:escapeHtml(r.pic)}</td>
            <td class="py-1.5 px-1 text-center"><span class="inline-block min-w-[26px] px-1.5 py-0.5 rounded text-[11px] font-bold ${r.open?'bg-red-50 text-red-700':'bg-slate-50 text-slate-400'}">${r.open}</span></td>
            <td class="py-1.5 px-1 text-center text-[11px] text-slate-500">${r.pending}</td>
            <td class="py-1.5 px-1 text-center text-[11px] text-amber-700">${r.proses}</td>
            <td class="py-1.5 px-1 text-center text-[11px] text-emerald-700">${r.done}</td>
            <td class="py-1.5 px-1 text-center text-[11px] ${warn?'text-red-600 font-semibold':'text-slate-500'}">${r.oldestDays!=null?r.oldestDays+' hr':'—'}</td>
            <td class="py-1.5 pl-1 w-[70px]"><div class="top-bar"><span style="width:${share}%;background:#7c3aed"></span></div></td>
        </tr>`;
    };
    c.innerHTML=`<table class="w-full text-left"><thead><tr class="text-[10px] uppercase tracking-wider text-slate-400">
        <th class="pb-1.5 pr-2 font-semibold">PIC</th><th class="pb-1.5 px-1 font-semibold text-center">Belum selesai</th><th class="pb-1.5 px-1 font-semibold text-center">Belum</th><th class="pb-1.5 px-1 font-semibold text-center">Proses</th><th class="pb-1.5 px-1 font-semibold text-center">Selesai</th><th class="pb-1.5 px-1 font-semibold text-center">Terlama</th><th class="pb-1.5 pl-1 font-semibold">Porsi</th></tr></thead>
        <tbody>${st.map(row).join('')}</tbody></table>
        <div class="mt-2 text-[10.5px] text-slate-400"><i class="fas fa-circle-info mr-1"></i>${totOpen} kerusakan belum selesai pada filter aktif. "Terlama" = umur laporan terbuka tertua. Klik baris/batang untuk memfilter per PIC.</div>`;
}
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
                const sb = statusBadge(d);
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
                    const sb = statusBadge(d);
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
        const color = typeColor(colorMap, t.type, defaultColor);
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
    const color = typeColor(isEng?ENG_COLORS:IRR_COLORS, type, isEng?'#f97316':'#ec4899');
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
            <td class="py-1.5 whitespace-nowrap">${statusBadge(d)}</td>
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
        const color = typeColor(colorMap, u.type, defaultColor);
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
                        const sb = statusBadge(d);
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
function typeColor(map, key, fallback){
    if(map[key]) return map[key];
    const pool=['#0ea5e9','#a855f7','#14b8a6','#f43f5e','#eab308','#64748b','#22c55e','#fb7185'];
    let h=0; for(const ch of String(key||'')) h=(h*31+ch.charCodeAt(0))>>>0;
    return key ? pool[h%pool.length] : fallback;
}
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
        const badge = statusBadge(d);
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
        const sb = statusBadge(d);
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
            <td class="px-4 py-3 text-xs whitespace-nowrap">${d.pic&&d.pic!=='-'?`<span class="inline-flex items-center gap-1 text-violet-700 bg-violet-50 px-2 py-0.5 rounded font-medium"><i class="fas fa-user-gear text-[9px]"></i>${escapeHtml(d.pic)}</span>`:'<span class="text-slate-400 italic">—</span>'}</td>
            <td class="px-4 py-3 whitespace-nowrap">${tingkatBadge(effectiveTingkat(d))}${d.__issues&&d.__issues.length?` <i class="fas fa-triangle-exclamation text-amber-500 ml-1 cursor-help" title="${escapeHtml(d.__issues.map(i=>i.msg).join('\n'))}"></i>`:''}</td>
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

function effectiveTingkat(d){ return d.tingkat || classifySeverity(d).level; }
function classifySeverity(d){
    if(__sevCache.has(d)) return __sevCache.get(d);
    if(d.tingkat){ __sevCache.set(d,{level:d.tingkat, reasons:['kolom "Tingkat Kerusakan" di spreadsheet'], fromSheet:true}); return __sevCache.get(d); }
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
    if(d.status==='Selesai') score = Math.round(score*0.15); // sudah diperbaiki → prioritas sangat rendah
    return Math.round(Math.max(0,Math.min(100,score)));
}

let sevLevelFilterState = '';
let sevIncludeDone = false;
function sevToggleDone(v){ sevIncludeDone=!!v; sevPage=1; renderSeverityTab(); }
let sevPage = 1, sevPageSize = 10;
function sevSetPageSize(n){ sevPageSize = parseInt(n,10)||10; sevPage = 1; renderSeverityTab(); }
function sevGoPage(p){ sevPage = p; renderSeverityTab(); const t=document.getElementById('sevTable'); if(t) t.closest('.card').scrollIntoView({behavior:'smooth',block:'start'}); }
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
    const data = sevIncludeDone ? filteredData : filteredData.filter(isOpen);
    const doneCount = filteredData.filter(d=>!isOpen(d)).length;
    const fromSheet = data.filter(d=>d.tingkat).length;
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
        const all = rows.filter(r=>!sevLevelFilterState||r.level===sevLevelFilterState).sort((a,b)=>b.score-a.score||b.age-a.age);
        const totalPages = Math.max(1, Math.ceil(all.length/sevPageSize));
        if(sevPage>totalPages) sevPage=totalPages; if(sevPage<1) sevPage=1;
        const startIdx = (sevPage-1)*sevPageSize;
        const list = all.slice(startIdx, startIdx+sevPageSize);
        tb.innerHTML = `<thead><tr class="text-[10px] uppercase text-slate-400 border-b border-slate-200"><th class="text-left py-2 pr-2">#</th><th class="text-left py-2 pr-2">Prioritas</th><th class="text-left py-2 pr-2">Tingkat</th><th class="text-left py-2 pr-2">Tanggal</th><th class="text-left py-2 pr-2">Umur</th><th class="text-left py-2 pr-2">Lokasi</th><th class="text-left py-2 pr-2">Aset / Unit</th><th class="text-left py-2 pr-2">Kerusakan</th><th class="text-left py-2 pr-2">Sparepart</th><th class="text-left py-2 pr-2">Status</th><th class="text-left py-2">Alasan</th></tr></thead><tbody>${
            list.length ? list.map((r,i0)=>{ const i=startIdx+i0; const d=r.d, R=SEVERITY_RULES[r.level];
                const unit = d.engineType!=='-'&&d.engineType ? `Engine ${escapeHtml(d.engineType)} ${d.engineCode!=='-'?escapeHtml(d.engineCode):''}` : d.irrType!=='-'&&d.irrType ? `Irigator ${escapeHtml(d.irrType)} ${d.irrCode!=='-'?escapeHtml(d.irrCode):''}` : escapeHtml(r.asset);
                const sc = r.score>=70?'#dc2626':r.score>=45?'#f59e0b':'#10b981';
                return `<tr class="border-b border-slate-100 last:border-0 align-top"><td class="py-2 pr-2 text-slate-400">${i+1}</td><td class="py-2 pr-2"><div class="flex items-center gap-1.5"><div class="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div class="h-full" style="width:${r.score}%;background:${sc}"></div></div><b style="color:${sc}">${r.score}</b></div></td><td class="py-2 pr-2"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${R.bg} ${R.text}">${r.level}</span></td><td class="py-2 pr-2 whitespace-nowrap text-slate-600">${fmtDateShort(d.timestamp)}</td><td class="py-2 pr-2 whitespace-nowrap ${r.age>7&&d.status==='Belum Ditangani'?'text-red-600 font-bold':'text-slate-600'}">${r.age} hr</td><td class="py-2 pr-2"><span class="bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-semibold">${escapeHtml(d.lokasi)}</span><div class="text-[10px] text-slate-400">${escapeHtml(d.divisi)}</div></td><td class="py-2 pr-2 text-slate-700 whitespace-nowrap">${unit}${r.recur>1?`<div class="text-[10px] text-purple-600 font-semibold"><i class="fas fa-rotate mr-0.5"></i>${r.recur}× berulang</div>`:''}</td><td class="py-2 pr-2 text-slate-800"><b>${escapeHtml(d.damageType||'-')}</b>${d.keterangan?`<div class="text-[10px] text-slate-500">${escapeHtml(d.keterangan)}</div>`:''}</td><td class="py-2 pr-2 text-slate-600">${d.sparepart&&d.sparepart!=='-'?escapeHtml(d.sparepart):'<span class="text-slate-400 italic">—</span>'}</td><td class="py-2 pr-2 whitespace-nowrap">${statusBadge(d)}</td><td class="py-2 text-[10px] text-slate-500">${escapeHtml(r.reasons.join('; '))}</td></tr>`;
            }).join('') : '<tr><td colspan="11" class="py-6 text-center text-slate-400 italic">Tidak ada laporan pada tingkat ini</td></tr>'
        }</tbody>`;
        // Pagination
        const pg=document.getElementById('sevPager');
        if(pg){
            const from = all.length? startIdx+1 : 0, to = Math.min(all.length, startIdx+sevPageSize);
            let pages=[]; for(let p=1;p<=totalPages;p++){ if(p===1||p===totalPages||Math.abs(p-sevPage)<=1) pages.push(p); else if(pages[pages.length-1]!=='…') pages.push('…'); }
            pg.innerHTML = `<div class="text-[11px] text-slate-500">Menampilkan <b>${from}–${to}</b> dari <b>${all.length}</b> laporan</div>
                <div class="flex items-center gap-1">
                    <button onclick="sevGoPage(${sevPage-1})" ${sevPage<=1?'disabled':''} class="px-2 py-1 rounded border border-slate-200 text-xs disabled:opacity-40 hover:bg-slate-50"><i class="fas fa-chevron-left"></i></button>
                    ${pages.map(p=>p==='…'?'<span class="px-1 text-slate-400 text-xs">…</span>':`<button onclick="sevGoPage(${p})" class="min-w-[28px] px-2 py-1 rounded text-xs font-semibold ${p===sevPage?'bg-slate-900 text-white':'border border-slate-200 hover:bg-slate-50 text-slate-700'}">${p}</button>`).join('')}
                    <button onclick="sevGoPage(${sevPage+1})" ${sevPage>=totalPages?'disabled':''} class="px-2 py-1 rounded border border-slate-200 text-xs disabled:opacity-40 hover:bg-slate-50"><i class="fas fa-chevron-right"></i></button>
                </div>`;
        }
        const ps=document.getElementById('sevPageSize'); if(ps && +ps.value!==sevPageSize) ps.value=String(sevPageSize);
    }
    const sub=document.getElementById('sevDonutSub'); if(sub) sub.textContent = `${total} laporan ${sevIncludeDone?'(termasuk selesai)':'yang masih terbuka'} · ${fromSheet} tingkat dari spreadsheet${total-fromSheet?`, ${total-fromSheet} estimasi kata kunci`:''}`;
    const dn=document.getElementById('sevDoneNote'); if(dn) dn.textContent = doneCount ? `${doneCount} laporan sudah selesai diperbaiki ${sevIncludeDone?'ditampilkan':'disembunyikan'}` : '';
    // filter tombol
    const lf=document.getElementById('sevLevelFilter');
    if(lf && !lf.dataset.bound){
        lf.dataset.bound='1';
        lf.addEventListener('click',e=>{ const b=e.target.closest('button[data-lv]'); if(!b) return; sevLevelFilterState=b.dataset.lv; sevPage=1; lf.querySelectorAll('button').forEach(x=>x.classList.toggle('ring-2',x===b)); renderSeverityTab(); });
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
    const bs=document.getElementById('badgeSeverity'); if(bs) bs.textContent = filteredData.filter(d=>isOpen(d)&&effectiveTingkat(d)==='Berat').length;
    // Badge spareparts: jumlah jenis sparepart yang masih dibutuhkan (laporan belum selesai) — murah, tanpa render tab
    const bsp=document.getElementById('badgeSpareparts'); if(bsp){ const ks=new Set(); filteredData.forEach(d=>{ if(isOpen(d)) splitSpareparts(d.sparepart).forEach(x=>ks.add(x.key)); }); bsp.textContent = ks.size; }
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
    const headers=['Timestamp','Tanggal Inspeksi','Lokasi','Divisi','Jenis Engine','Kode Engine','Jenis Irrigator','Kode Irrigator','Jenis Kerusakan','Keterangan Kerusakan','Spareparts Yang Dibutuhkan','Nomor PR / Notifikasi','Status','Tingkat Kerusakan','Status Perbaikan','PIC'];
    const rows=filteredData.map(d=>[new Date(d.timestamp).toISOString(),d.tanggalInspeksi,d.lokasi,d.divisi,d.engineType,d.engineCode,d.irrType,d.irrCode,d.damageType,d.keterangan,d.sparepart,d.prNumber||'',d.status,effectiveTingkat(d),d.repairStatus||'Belum',d.pic&&d.pic!=='-'?d.pic:'']);
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

function setEditMode(mode){
    document.getElementById('editMode').value = mode;
    const isCreate = mode==='create';
    document.getElementById('editModalTitle').textContent = isCreate ? 'Tambah Laporan Baru' : 'Edit Laporan';
    document.getElementById('editModalIcon').className = isCreate ? 'fas fa-plus-circle text-emerald-600 mr-2' : 'fas fa-pen-to-square text-blue-600 mr-2';
    document.getElementById('createHint').classList.toggle('hidden', !isCreate);
    const btn = document.getElementById('editSaveBtn');
    btn.innerHTML = isCreate ? '<i class="fas fa-paper-plane mr-1"></i>Simpan ke Spreadsheet' : '<i class="fas fa-save mr-1"></i>Simpan ke Spreadsheet';
    btn.className = 'px-4 py-2 rounded-lg text-xs font-semibold text-white ' + (isCreate ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700');
}

// ======================================================
// UNIT TERPASANG (spreadsheet "Draft Dashboard") — auto-isi form berdasarkan Lokasi
// Hanya dibaca (CSV publik), di-cache di localStorage, tidak menyentuh alur sync laporan.
// ======================================================
const UNITS_CACHE_KEY = 'pg2_units_cache_v1';
let unitsByLokasi = null;      // key lokasi (normalisasi) → unit
let unitsMeta = { loadedAt: 0, count: 0, source: '' };
let __unitsPromise = null;
const lokKey = v => String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
function splitUnitCode(code){ // "SPC0195" → {type:'SPC', code:'0195'}; "0195" → {type:'', code:'0195'}
    const m = String(code||'').trim().toUpperCase().match(/^([A-Z]*)\s*-?\s*(\d+)$/);
    if(!m) return {type:'', code:''};
    return { type:m[1], code:m[2].padStart(4,'0').slice(-4) };
}
function parseUnitsCSV(text){
    const rows = parseCSV(text); if(!rows || rows.length<2) return null;
    const head = rows[0].map(h=>String(h||'').trim().toLowerCase());
    const ci = name => head.findIndex(h=>h===name) >= 0 ? head.findIndex(h=>h===name) : head.findIndex(h=>h.startsWith(name));
    const iLok=ci('lokasi'), iBkl=ci('bengkel'), iJE=ci('jenis engine'), iKE=ci('kode engine'), iKI=ci('kode irigator')>=0?ci('kode irigator'):ci('kode irrigator');
    const iWil=ci('wil'), iPow=ci('power'), iAir=ci('sumber air'), iKA=ci('kode air'), iTgl=ci('tanggal'), iNo=ci('no'), iTerp=ci('terpasang'), iKet=ci('keterangan');
    if(iLok<0) return null;
    const map = {};
    rows.slice(1).forEach(r=>{
        const lok = String(r[iLok]||'').trim(); if(!lok) return;
        if(iTerp>=0 && r[iTerp] && !/terpasang/i.test(r[iTerp])) return; // hanya unit yang masih terpasang
        const eng = splitUnitCode(r[iKE]); const irr = splitUnitCode(r[iKI]);
        const u = {
            lokasi: lok, divisi: String(r[iBkl]||'').trim().toUpperCase(),
            engineType: (String(r[iJE]||'').trim().toUpperCase() || eng.type), engineCode: eng.code,
            irrType: irr.type, irrCode: irr.code,
            wil: iWil>=0?String(r[iWil]||'').trim():'', power: iPow>=0?String(r[iPow]||'').trim():'',
            sumberAir: iAir>=0?String(r[iAir]||'').trim():'', kodeAir: iKA>=0?String(r[iKA]||'').trim():'',
            keterangan: iKet>=0?String(r[iKet]||'').trim():'',
            tanggal: iTgl>=0?(parseDate(r[iTgl])||null):null, no: iNo>=0?(parseInt(r[iNo])||0):0
        };
        const k = lokKey(lok); const prev = map[k];
        // Lokasi yang tercatat >1× → ambil catatan terbaru (tanggal, lalu nomor urut)
        if(!prev || ((u.tanggal?u.tanggal.getTime():0) > (prev.tanggal?prev.tanggal.getTime():0)) || (((u.tanggal?u.tanggal.getTime():0) === (prev.tanggal?prev.tanggal.getTime():0)) && u.no>=prev.no)) map[k]=u;
    });
    return map;
}
async function loadUnits(force=false){
    const cfg = window.PG2_CONFIG||{};
    if(!cfg.UNITS_SHEET_ID) return null;
    if(unitsByLokasi && !force) return unitsByLokasi;
    if(__unitsPromise) return __unitsPromise; // sudah ada permintaan berjalan → pakai itu
    // 1) cache lokal (instan), 2) segarkan dari Sheets di latar belakang
    if(!unitsByLokasi){
        try{ const c=JSON.parse(localStorage.getItem(UNITS_CACHE_KEY)||'null');
            if(c && c.map && Object.keys(c.map).length){ unitsByLokasi=c.map; Object.values(unitsByLokasi).forEach(u=>{ if(u.tanggal) u.tanggal=new Date(u.tanggal); }); unitsMeta={loadedAt:c.ts,count:Object.keys(c.map).length,source:'cache'}; }
        }catch(e){}
    }
    const fresh = (Date.now()-unitsMeta.loadedAt) < 6*3600*1000; // segar < 6 jam
    if(unitsByLokasi && fresh && !force) return unitsByLokasi;
    __unitsPromise = (async()=>{
        try{
            const url=`https://docs.google.com/spreadsheets/d/${cfg.UNITS_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(cfg.UNITS_SHEET_GID||'0')}&t=${Date.now()}`;
            const ctrl=new AbortController(); const tid=setTimeout(()=>ctrl.abort(),12000);
            const res=await fetch(url,{signal:ctrl.signal,cache:'no-store'}); clearTimeout(tid);
            if(!res.ok) throw new Error('HTTP '+res.status);
            const txt=await res.text(); if(txt.length<30 || /^<!doctype|^<html/i.test(txt.trim())) throw new Error('bukan CSV');
            const map=parseUnitsCSV(txt); if(!map || !Object.keys(map).length) throw new Error('kosong');
            unitsByLokasi=map; unitsMeta={loadedAt:Date.now(),count:Object.keys(map).length,source:'live'};
            if(rawData && rawData.length){ validateAll(rawData); renderQualityBanner(); } // isu "unit terpasang" butuh data unit
            try{ localStorage.setItem(UNITS_CACHE_KEY, JSON.stringify({ts:Date.now(), map})); }catch(e){}
            fillDatalists();
            const em=document.getElementById('editModal'); if(em && em.classList.contains('show')) renderLokasiInfo(document.getElementById('f_lokasi').value, true);
        }catch(e){ console.warn('Unit terpasang: gagal memuat —', e.message); }
        finally{ __unitsPromise=null; }
        return unitsByLokasi;
    })();
    return unitsByLokasi || __unitsPromise;
}
function findUnit(lokasi){ if(!unitsByLokasi) return null; return unitsByLokasi[lokKey(lokasi)] || null; }
function unitSummary(u){
    const parts=[];
    if(u.engineType||u.engineCode) parts.push(`Engine ${[u.engineType,u.engineCode].filter(Boolean).join(' ')}`);
    if(u.irrType||u.irrCode) parts.push(`Irigator ${[u.irrType,u.irrCode].filter(Boolean).join(' ')}`);
    if(u.wil) parts.push(u.wil); if(u.sumberAir) parts.push(u.sumberAir+(u.kodeAir?` ${u.kodeAir}`:'')); if(u.power) parts.push(`${u.power} HP`);
    return parts.join(' · ');
}
// Terapkan data unit ke form. overwrite=false → hanya isi kolom yang masih kosong.
function applyUnitToForm(u, overwrite){
    const setSel=(id,val,opts)=>{ const el=document.getElementById(id); if(!el) return false; if(!val) return false; if(!overwrite && el.value) return false; fillSelect(id, opts, val, el.options[0]&&el.options[0].value===''?el.options[0].textContent:undefined); return el.value===val; };
    const setTxt=(id,val)=>{ const el=document.getElementById(id); if(!el||!val) return false; if(!overwrite && el.value.trim()) return false; el.value=val; el.classList.remove('border-red-400'); return true; };
    let n=0;
    if(FORM_OPTIONS.divisi.includes(u.divisi) && setSel('f_divisi', u.divisi, FORM_OPTIONS.divisi)) n++;
    if(setSel('f_engineType', u.engineType, FORM_OPTIONS.engineType)) n++;
    if(setTxt('f_engineCode', u.engineCode)) n++;
    if(setSel('f_irrType', u.irrType, FORM_OPTIONS.irrType)) n++;
    if(setTxt('f_irrCode', u.irrCode)) n++;
    return n;
}
let __lokT=null;
function onLokasiInput(val, commit=false){
    clearTimeout(__lokT);
    __lokT = setTimeout(()=>renderLokasiInfo(val, commit), commit?0:120);
}
function renderLokasiInfo(val, commit){
    const info=document.getElementById('lokasiUnitInfo'); if(!info) return;
    const v=String(val||'').trim();
    if(!v){ info.innerHTML = unitsByLokasi ? `<span class="text-slate-400"><i class="fas fa-link mr-1"></i>${unitsMeta.count} lokasi unit terpasang siap diisi otomatis · ${unitsMeta.source==='live'?'disinkron':'cache'} ${new Date(unitsMeta.loadedAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}</span>` : ''; return; }
    if(!unitsByLokasi){ info.innerHTML='<span class="text-slate-400"><i class="fas fa-spinner spin mr-1"></i>Memuat data unit terpasang…</span>'; loadUnits().then(()=>renderLokasiInfo(val, commit)); return; }
    const u=findUnit(v);
    if(!u){
        // saran lokasi mirip
        const k=lokKey(v); const sug=Object.values(unitsByLokasi).filter(x=>lokKey(x.lokasi).startsWith(k)).slice(0,6);
        info.innerHTML = sug.length
            ? `<span class="text-slate-500">Lokasi mirip: ${sug.map(x=>`<button type="button" class="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-emerald-50 text-slate-700 font-semibold" onclick="pickLokasi('${escapeHtml(x.lokasi)}')">${escapeHtml(x.lokasi)}</button>`).join(' ')}</span>`
            : `<span class="text-amber-700"><i class="fas fa-circle-question mr-1"></i>Lokasi "${escapeHtml(v)}" tidak ada di data unit terpasang — isi kode engine/irrigator manual.</span>`;
        return;
    }
    const isCreate = document.getElementById('editMode').value==='create';
    // Mode tambah: kolom kosong diisi otomatis. Mode edit: tidak mengubah apa pun diam-diam,
    // hanya menampilkan perbedaan + tombol untuk menyamakan.
    const filled = isCreate ? applyUnitToForm(u, false) : 0;
    // deteksi perbedaan dengan isian saat ini
    const g=id=>document.getElementById(id).value.trim();
    const diffs=[];
    const show=v=>v||'kosong';
    if(u.engineType && g('f_engineType')!==u.engineType) diffs.push(`jenis engine ${show(g('f_engineType'))}→${u.engineType}`);
    if(u.engineCode && g('f_engineCode')!==u.engineCode) diffs.push(`kode engine ${show(g('f_engineCode'))}→${u.engineCode}`);
    if(u.irrType && g('f_irrType')!==u.irrType) diffs.push(`jenis irrigator ${show(g('f_irrType'))}→${u.irrType}`);
    if(u.irrCode && g('f_irrCode')!==u.irrCode) diffs.push(`kode irrigator ${show(g('f_irrCode'))}→${u.irrCode}`);
    if(FORM_OPTIONS.divisi.includes(u.divisi) && g('f_divisi')!==u.divisi) diffs.push(`divisi ${g('f_divisi')}→${u.divisi}`);
    const tgl = u.tanggal ? ` · dicatat ${fmtDateShort(u.tanggal)}` : '';
    const divNote = !FORM_OPTIONS.divisi.includes(u.divisi) && u.divisi ? ` · bengkel ${escapeHtml(u.divisi)} (bukan pilihan divisi form)` : '';
    info.innerHTML = `<span class="text-emerald-700"><i class="fas fa-circle-check mr-1"></i><b>Unit terpasang:</b> ${escapeHtml(unitSummary(u))}${divNote}<span class="text-slate-400">${tgl}</span></span>`
        + (filled ? ` <span class="text-slate-500">— ${filled} kolom terisi otomatis</span>` : '')
        + (diffs.length ? ` <span class="text-amber-700 block mt-0.5"><i class="fas fa-triangle-exclamation mr-1"></i>Berbeda dari isian saat ini (${escapeHtml(diffs.join(', '))}). <button type="button" class="px-1.5 py-0.5 rounded bg-amber-600 text-white font-semibold" onclick="applyUnitToForm(findUnit(document.getElementById('f_lokasi').value), true); renderLokasiInfo(document.getElementById('f_lokasi').value, true)">Samakan dengan unit terpasang</button></span>` : '');
}
function pickLokasi(lok){ const el=document.getElementById('f_lokasi'); el.value=lok; renderLokasiInfo(lok, true); }

// Pilihan dropdown — SAMA PERSIS dengan Google Form "Update Service / Maintenance FS PG2".
// Daftar bawaan di bawah ini adalah cadangan; saat dimuat, dashboard menimpanya dengan
// form-options.json yang diperbarui otomatis oleh GitHub Actions dari Google Form
// (scripts/fetch-form-options.js), jadi perubahan pilihan di form ikut tanpa ubah kode.
const FORM_OPTIONS = {
    divisi:     ['PG2','FM4','OP2'],
    engineType: ['SPC','DEC','DED','DEM','SPE'],
    irrType:    ['BTI','ITI'],
    damageType: ['Blok Mesin','Pompa Ebara','Gearbox','Turbin','Pompa Sumur Bor','Transmisi','Dinamo','Prodo','Gun','HM','RPM','Flowmeter','Hidrolik','Pipa PE','Filter','Selang','Rantai','Impeler','Radiator','Panel Listrik','Electromotor','Tangki Solar','Sproket','Knalpot','Aki','Box Panel','Ban'],
    tingkat:    ['Ringan','Sedang','Berat'],
    repair:     ['Sudah','Belum'],
    pic:        ['Internal','Maintenance','Cogen','Engineering','Sumur Bor']
};
// Isi <select> dari daftar form; nilai lama yang tidak ada di daftar (data historis) tetap
// ditampilkan sebagai opsi agar edit tidak diam-diam mengubah data.
async function loadFormOptions(){
    try{
        const r = await fetch('form-options.json?t='+Math.floor(Date.now()/600000), {cache:'no-cache'});
        if(!r.ok) return;
        const j = await r.json();
        if(!j || !j.options) return;
        Object.entries(j.options).forEach(([k,v])=>{ if(Array.isArray(v) && v.length && FORM_OPTIONS[k]) FORM_OPTIONS[k]=v; });
        window.__formOptionsAt = j.fetchedAt;
        if(rawData && rawData.length){ validateAll(rawData); renderQualityBanner(); }
    }catch(e){}
}
function fillSelect(id, options, current, emptyLabel){
    const el=document.getElementById(id); if(!el) return;
    const cur = (current==null||current==='-') ? '' : String(current);
    const opts = [...options];
    if(cur && !opts.includes(cur)) opts.push(cur);
    el.innerHTML = (emptyLabel!==undefined ? `<option value="">${emptyLabel}</option>` : '') +
        opts.map(o=>`<option value="${escapeHtml(o)}"${o===cur?' selected':''}>${escapeHtml(o)}${options.includes(o)?'':' (tidak ada di form)'}</option>`).join('');
    el.value = cur;
}
function fillFormSelects(d){
    d = d || {};
    fillSelect('f_divisi', FORM_OPTIONS.divisi, d.divisi && d.divisi!=='-' ? d.divisi : 'PG2');
    fillSelect('f_engineType', FORM_OPTIONS.engineType, d.engineType, '— tidak ada —');
    fillSelect('f_irrType', FORM_OPTIONS.irrType, d.irrType, '— tidak ada —');
    fillSelect('f_damageType', FORM_OPTIONS.damageType, d.damageType, '— pilih jenis kerusakan —');
    fillSelect('f_pic', FORM_OPTIONS.pic, d.pic, '— pilih PIC —');
}
function fillDatalists(){
    const uniq = (f)=>[...new Set(rawData.map(d=>d[f]).filter(v=>v&&v!=='-'))].sort();
    const set=(id,vals)=>{ const el=document.getElementById(id); if(el) el.innerHTML = vals.map(v=>`<option value="${escapeHtml(v)}">`).join(''); };
    const lokSet = new Set(uniq('lokasi')); if(unitsByLokasi) Object.values(unitsByLokasi).forEach(u=>lokSet.add(u.lokasi));
    set('dl_lokasi', [...lokSet].sort());
}
// Validasi angka di sisi web (sebelum dikirim) — cegah titik/koma & digit salah masuk ke sheet
function validateFormNumbers(){
    const checks=[['f_prNumber','Nomor PR / Notifikasi',8],['f_engineCode','Kode Engine',4],['f_irrCode','Kode Irrigator',4]];
    const errs=[];
    checks.forEach(([id,label,digits])=>{
        const el=document.getElementById(id); const v=el.value.trim(); el.classList.remove('border-red-400');
        if(!v) return;
        let msg=null;
        if(/[.,]/.test(v)) msg=`${label} "${v}" memakai titik/koma sebagai pemisah — tulis tanpa pemisah (${v.replace(/[.,\s]/g,'')}).`;
        else if(!/^\d+$/.test(v)) msg=`${label} "${v}" harus berupa angka saja.`;
        else if(v.length!==digits) msg=`${label} "${v}" harus ${digits} digit (sekarang ${v.length}).`;
        if(msg){ errs.push(msg); el.classList.add('border-red-400'); }
    });
    return errs;
}
function openCreateModal(){
    if(!requireWriteEndpoint()) return;
    fillDatalists();
    setEditMode('create');
    document.getElementById('editRowIdx').value = '';
    document.getElementById('editSheetRow').value = '';
    document.getElementById('editRowLabel').textContent = '';
    const now=new Date(); const pad=n=>String(n).padStart(2,'0');
    document.getElementById('f_tanggal').value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    ['f_lokasi','f_engineCode','f_irrCode','f_keterangan','f_sparepart','f_prNumber'].forEach(id=>{ const el=document.getElementById(id); el.value=''; el.classList.remove('border-red-400'); });
    fillFormSelects({ divisi: (Array.isArray(state.divisi) && state.divisi.length===1) ? state.divisi[0] : 'PG2' });
    document.getElementById('f_repair').value = 'Belum';
    document.getElementById('f_tingkat').value = '';
    document.getElementById('editMsg').innerHTML='';
    document.getElementById('editSaveBtn').disabled=false;
    submitCreate._opId = null; submitCreate._dupConfirmed = false;
    loadUnits().then(()=>{ fillDatalists(); renderLokasiInfo('', false); }); renderLokasiInfo('', false);
    openModal('editModal');
    setTimeout(()=>document.getElementById('f_lokasi').focus(),150);
}
async function submitCreate(){
    const g=id=>document.getElementById(id).value.trim();
    const msg=document.getElementById('editMsg'), btn=document.getElementById('editSaveBtn');
    const errs=validateFormNumbers();
    if(!g('f_lokasi')) errs.unshift('Lokasi wajib diisi.');
    if(!g('f_damageType')) errs.unshift('Jenis Kerusakan wajib diisi.');
    if(!g('f_tanggal')) errs.unshift('Tanggal Inspeksi wajib diisi.');
    if(!g('f_keterangan')) errs.push('Keterangan Kerusakan wajib diisi (sesuai Google Form).');
    if(!g('f_tingkat')) errs.push('Tingkat Kerusakan wajib dipilih (Ringan/Sedang/Berat).');
    if(!g('f_pic')) errs.push('PIC wajib dipilih (sesuai Google Form).');
    if(errs.length){ msg.innerHTML=`<span class="text-red-600"><i class="fas fa-triangle-exclamation mr-1"></i>${escapeHtml(errs[0])}</span>`; return; }
    if(window.__writeBusy){ return; } // cegah klik ganda / Enter dua kali
    const payload={
        action:'create',
        tanggalInspeksi:g('f_tanggal'), lokasi:lokKey(g('f_lokasi')), divisi:g('f_divisi'),
        repairStatus:g('f_repair'), tingkat:g('f_tingkat'),
        engineType:g('f_engineType')||'-', engineCode:g('f_engineCode')||'-',
        irrType:g('f_irrType')||'-', irrCode:g('f_irrCode')||'-',
        damageType:g('f_damageType'), keterangan:g('f_keterangan'),
        sparepart:g('f_sparepart')||'-', prNumber:g('f_prNumber')||null, pic:g('f_pic')
    };
    const setStatus = t => { msg.innerHTML=`<span class="text-emerald-700"><i class="fas fa-spinner spin mr-1"></i>${escapeHtml(t)}</span>`; };
    // Cegah duplikat dari web: laporan dengan tanggal + lokasi + jenis (+ keterangan) sama sudah ada?
    if(!submitCreate._dupConfirmed){
        const same = rawData.filter(d=>_wkey(d)===_wkey(payload));
        const exact = same.filter(d=>_ketKey(d.keterangan)===_ketKey(payload.keterangan));
        if(same.length){
            const list = (exact.length?exact:same).slice(0,3).map(d=>`baris ${d.__row||'?'} · ${escapeHtml(d.keterangan||'-')} · ${escapeHtml(d.repairStatus||'')}${d.pic&&d.pic!=='-'?' · PIC '+escapeHtml(d.pic):''}`).join('<br>');
            msg.innerHTML=`<div class="text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
                <div class="font-semibold"><i class="fas fa-clone mr-1"></i>${exact.length?'Laporan yang SAMA PERSIS sudah ada':'Sudah ada laporan '+escapeHtml(payload.damageType)+' di '+escapeHtml(payload.lokasi)+' pada tanggal ini'}:</div>
                <div class="text-[11px] my-1">${list}</div>
                <div class="text-[11px] mb-1.5">Jika maksudnya memperbarui laporan itu (mis. menambah PIC / status), gunakan <b>Edit</b> — jangan menambah baris baru.</div>
                <div class="flex flex-wrap gap-1.5">
                    <button type="button" onclick="closeModal('editModal');openEditModalRaw(${rawData.indexOf((exact[0]||same[0]))})" class="px-2.5 py-1 rounded-md bg-slate-900 text-white text-[11px] font-semibold"><i class="fas fa-pen mr-1"></i>Edit laporan yang ada</button>
                    <button type="button" onclick="submitCreate._dupConfirmed=true;submitCreate()" class="px-2.5 py-1 rounded-md bg-amber-600 text-white text-[11px] font-semibold"><i class="fas fa-plus mr-1"></i>Tetap tambah sebagai laporan baru</button>
                </div></div>`;
            return;
        }
    }
    if(submitCreate._dupConfirmed) payload.allowDuplicate = true;
    setStatus('Menambahkan ke spreadsheet…');
    btn.disabled=true; window.__writeBusy=true;
    if(submitCreate._opId) payload.opId = submitCreate._opId; // "Coba lagi" memakai opId yang sama → tidak dobel
    try{
        let res;
        try {
            res = await callWriteProxy(payload, {onStatus:setStatus});
            submitCreate._opId = null;
        } catch(e){
            if(!e.uncertain) throw e;
            submitCreate._opId = e.opId;
            setStatus('Tidak ada respons — memeriksa apakah laporan sudah masuk ke spreadsheet…');
            let found=null;
            const ok = await verifyWriteApplied(fresh => (found = fresh.find(x => _dupKey(x)===_dupKey(payload))));
            if(!ok) throw e;
            submitCreate._opId = null;
            res = 'ok: created row ' + (found && found.__row ? found.__row : '');
            showToast('Apps Script lambat merespons, tetapi laporan terverifikasi sudah masuk ke spreadsheet.','success');
        }
        const m = res.match(/row\s+(\d+)/i); const newRow = m ? parseInt(m[1]) : null;
        if(/exists/i.test(res)){
            // Proxy (v9+) menemukan baris identik yang sudah ada → tidak ditambah lagi
            window.__writeBusy=false; submitCreate._dupConfirmed=false;
            closeModal('editModal');
            showToast(`Laporan identik sudah ada di spreadsheet (baris ${newRow||'?'}) — tidak ditambahkan lagi.`,'info');
            setTimeout(()=>refreshData(true,{silent:true}), 1500);
            return;
        }
        const [y,mo,day]=payload.tanggalInspeksi.split('-').map(Number);
        const ts=new Date(y,mo-1,day,12,0,0).toISOString();
        const rec = normalizeFromJson([{
            timestamp: ts, tanggalInspeksi: payload.tanggalInspeksi, lokasi: payload.lokasi, divisi: payload.divisi,
            engineType: payload.engineType, engineCode: payload.engineCode, irrType: payload.irrType, irrCode: payload.irrCode,
            damageType: payload.damageType, keterangan: payload.keterangan, sparepart: payload.sparepart,
            prNumber: payload.prNumber, pic: payload.pic||'-', repairStatus: payload.repairStatus, tingkat: payload.tingkat, __row: newRow
        }])[0];
        revalidateAfterWrite(rec);
        rawData.unshift(indexRecords([rec])[0]);
        notePendingWrite('create', rawData[0], newRow);
        closeModal('editModal');
        showToast(newRow?`Laporan tersimpan di spreadsheet (baris ${newRow}).`:'Laporan tersimpan di spreadsheet.','success');
        applyFilters(); renderQualityBanner();
        submitCreate._dupConfirmed=false;
        setTimeout(()=>refreshData(true,{silent:true}), 2500);
        setTimeout(()=>refreshData(true,{silent:true}), 20000); // CSV publik Google bisa tertinggal
    }catch(e){
        msg.innerHTML=_writeFailHtml(e, e.uncertain?'submitCreate()':null);
        btn.disabled=false;
    } finally { window.__writeBusy=false; }
}

function openEditModal(globalIdx){
    // globalIdx adalah indeks di filteredData
    const d = filteredData[globalIdx];
    if(!d) return;
    return openEditModalRaw(rawData.indexOf(d));
}
// Buka editor berdasarkan indeks di rawData (tidak bergantung pada filter aktif)
function openEditModalRaw(rawi){
    if(!requireWriteEndpoint()) return;
    fillDatalists();
    setEditMode('update');
    const d = rawData[rawi];
    if(!d){ showToast('Baris tidak ditemukan di data lokal. Klik Refresh lalu coba lagi.','warning'); return; }
    document.getElementById('editRowIdx').value = rawi;
    document.getElementById('editSheetRow').value = d.__row || '';
    document.getElementById('editRowLabel').textContent = `· ${d.lokasi} · ${d.damageType||'-'} · ${fmtDateShort(d.timestamp)}`;
    // Isi form
    document.getElementById('f_tanggal').value = d.tanggalInspeksi;
    document.getElementById('f_lokasi').value = d.lokasi==='-'?'':d.lokasi;
    fillFormSelects(d);
    document.getElementById('f_repair').value = d.repairStatus==='Sudah'?'Sudah':'Belum';
    document.getElementById('f_tingkat').value = d.tingkat || '';
    document.getElementById('f_engineCode').value = d.engineCode==='-'?'':d.engineCode;
    document.getElementById('f_irrCode').value = d.irrCode==='-'?'':d.irrCode;
    document.getElementById('f_keterangan').value = d.keterangan || '';
    document.getElementById('f_sparepart').value = d.sparepart==='-'?'':d.sparepart;
    document.getElementById('f_prNumber').value = d.prNumber || '';
    document.getElementById('editMsg').innerHTML='';
    if(d.__issues && d.__issues.length){
        const fixable = d.__issues.filter(i=>i.type==='unit' && i.fixed);
        document.getElementById('editMsg').innerHTML = `<div class="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <div class="font-semibold mb-1"><i class="fas fa-triangle-exclamation mr-1"></i>${d.__issues.length} anomali pada laporan ini</div>
            <ul class="list-disc ml-4 space-y-0.5">${d.__issues.map(i=>`<li>${escapeHtml(i.msg)}</li>`).join('')}</ul>
            <div class="mt-1.5 text-[10.5px] text-amber-700">Nilai angka yang salah format sudah dinormalkan di form. ${fixable.length?`<button type="button" onclick="applyUnitToForm(findUnit(document.getElementById('f_lokasi').value), true); renderLokasiInfo(document.getElementById('f_lokasi').value, true)" class="ml-1 px-2 py-0.5 rounded bg-amber-600 text-white font-semibold">Samakan dengan unit terpasang</button>`:''} Klik <b>Simpan</b> untuk menulis perbaikan ke spreadsheet.</div></div>`;
    }
    openEditModalRaw._snapshot = JSON.stringify(_fieldsOf(d)); openEditModalRaw._conflictChecked = false;
    document.getElementById('editSaveBtn').disabled=false;
    const li=document.getElementById('lokasiUnitInfo'); if(li) li.innerHTML='';
    loadUnits().then(()=>{ if(document.getElementById('editMode').value==='update') renderLokasiInfo(document.getElementById('f_lokasi').value, true); });
    openModal('editModal');
}

// Kirim perintah ke Apps Script write-proxy dan terjemahkan responsnya.
// Apps Script menjawab 302 → googleusercontent; browser mengikuti otomatis.
// Jika deployment belum diotorisasi / versi lama, Google mengirim HALAMAN HTML
// ("Sorry, unable to open the file") alih-alih teks "ok: ..." → deteksi & jelaskan.
async function callWriteProxy(payload, opts={}){
    const url = getWriteUrl();
    if(!url) throw new Error('Endpoint write belum dikonfigurasi.');
    // opId unik per operasi → proxy (v6+) mengembalikan hasil sebelumnya bila request diulang,
    // sehingga retry setelah timeout AMAN (tidak membuat baris ganda / error palsu).
    if(!payload.opId) payload.opId = 'op-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,10);
    const body = JSON.stringify(payload);
    const MAX = opts.attempts || 3, PER_TRY = opts.timeoutMs || 40000;
    const status = typeof opts.onStatus==='function' ? opts.onStatus : ()=>{};
    let lastErr = null;
    for(let attempt=1; attempt<=MAX; attempt++){
        if(attempt>1){
            status(`Apps Script belum merespons — mencoba lagi (${attempt}/${MAX})…`);
            await new Promise(r=>setTimeout(r, attempt===2?1500:4000));
        }
        const ctrl = new AbortController(); const tid=setTimeout(()=>ctrl.abort(), PER_TRY);
        let r, txt;
        try{
            r = await fetch(url,{ method:'POST', body, redirect:'follow', signal: ctrl.signal,
                // text/plain → "simple request", tidak memicu preflight CORS yang tidak didukung Apps Script
                headers:{'Content-Type':'text/plain;charset=utf-8'} });
            txt = await r.text();
        } catch(e){
            clearTimeout(tid);
            lastErr = e.name==='AbortError'
                ? Object.assign(new Error(`Apps Script tidak merespons dalam ${Math.round(PER_TRY/1000)} detik.`), {transient:true})
                : Object.assign(new Error('Tidak bisa menghubungi Apps Script ('+e.message+').'), {transient:true});
            continue;
        }
        clearTimeout(tid);
        const t = (txt||'').trim();
        if(/^<!doctype|^<html/i.test(t)){
            if(/unable to open the file/i.test(t)){
                // Gangguan sementara Google yang umum terjadi pada web app Apps Script → coba lagi.
                lastErr = Object.assign(new Error('Google Apps Script sementara tidak bisa membuka spreadsheet (gangguan sisi Google).'), {transient:true, html:true});
                continue;
            }
            if(/accounts\.google\.com|Sign in/i.test(t))
                throw new Error('Apps Script meminta login. Deploy ulang dengan "Who has access: Anyone" (bukan "Anyone with Google account").');
            if(/Page Not Found/i.test(t) || r.status===404){
                // Saat Google sedang terganggu, /exec yang valid pun bisa sesaat menjawab 404 → coba lagi.
                lastErr = Object.assign(new Error('Apps Script sesaat menjawab "Page Not Found" (gangguan sisi Google, atau URL deployment berubah).'), {transient:true, html:true});
                continue;
            }
            throw new Error('Respons tidak dikenal dari Apps Script (HTML). Deploy ulang web app sebagai versi baru.');
        }
        if(!r.ok){ lastErr = Object.assign(new Error('HTTP '+r.status+': '+t.slice(0,200)), {transient: r.status>=500 || r.status===404 || r.status===429}); if(lastErr.transient) continue; throw lastErr; }
        if(/^error: server sibuk/i.test(t)){ lastErr = Object.assign(new Error(t), {transient:true}); continue; }
        if(/^error:/i.test(t)) throw new Error(t.slice(0,300));
        if(!/^ok\b/i.test(t)){
            // Respons bukan "ok:" dan bukan "error:" (mis. teks doGet "pg2-write-proxy ok vN" saat Google
            // salah mengarahkan redirect POST). Perubahan MUNGKIN sudah tersimpan → verifikasi ke sheet
            // dengan opId yang sama, jangan dianggap gagal (dulu memicu klik ulang → baris ganda).
            lastErr = Object.assign(new Error('Respons Apps Script tidak dikenal: "'+t.slice(0,60)+'"'), {transient:true});
            break;
        }
        return t;
    }
    // Semua percobaan gagal karena gangguan sementara: perubahan MUNGKIN sudah tersimpan.
    const err = new Error((lastErr&&lastErr.message||'Gagal') + (lastErr&&lastErr.html
        ? ' Biasanya pulih dalam beberapa menit. Jika terus terjadi: buka <URL>/exec?action=check di browser — bila bukan "ok: …", jalankan "authorize" lalu Deploy → Manage deployments → Edit → New version.'
        : ''));
    err.uncertain = true; err.opId = payload.opId;
    throw err;
}

// Setelah kegagalan yang "tidak pasti" (timeout), periksa ke sheet apakah perubahan
// sebenarnya sudah masuk. Mengembalikan true bila sudah.
async function verifyWriteApplied(check, tries=4){
    for(let i=0;i<tries;i++){
        try{
            if(i) await new Promise(r=>setTimeout(r, 4000));
            const fresh = await fetchLiveCSV();
            if(fresh && fresh.length && check(fresh)) return true;
        }catch(e){}
    }
    return false;
}
// Snapshot field yang bisa diedit (untuk deteksi konflik edit web vs spreadsheet)
const _EDIT_FIELDS = ['tanggalInspeksi','lokasi','divisi','repairStatus','tingkat','engineType','engineCode','irrType','irrCode','damageType','keterangan','sparepart','prNumber','pic'];
function _fieldsOf(d){ const o={}; _EDIT_FIELDS.forEach(f=>{ o[f]=String(d[f]==null?'':d[f]); }); return o; }
const _FIELD_LABEL = {tanggalInspeksi:'Tanggal',lokasi:'Lokasi',divisi:'Divisi',repairStatus:'Status Perbaikan',tingkat:'Tingkat',engineType:'Jenis Engine',engineCode:'Kode Engine',irrType:'Jenis Irrigator',irrCode:'Kode Irrigator',damageType:'Jenis Kerusakan',keterangan:'Keterangan',sparepart:'Sparepart',prNumber:'No PR',pic:'PIC'};
// Sebelum menimpa baris: cek apakah baris di spreadsheet berubah sejak dimuat (diedit orang lain /
// langsung di Sheets). Mengembalikan {fresh, diffs} atau null bila tidak ada konflik / tidak bisa dicek.
async function detectEditConflict(d){
    const fresh = await fetchLiveCSV(); if(!fresh || !fresh.length) return null;
    let srv = fresh.find(x=>x.__row===d.__row && lokKey(x.lokasi)===lokKey(d.lokasi) && x.damageType===d.damageType);
    if(!srv){ const c=fresh.filter(x=>_wkey(x)===_wkey(d)); if(c.length===1) srv=c[0]; }
    if(!srv) return {fresh, srv:null, diffs:[], missing:true};
    const a=JSON.parse(openEditModalRaw._snapshot||'{}'), b=_fieldsOf(srv);
    const diffs=_EDIT_FIELDS.filter(f=>a[f]!==undefined && a[f]!==b[f]).map(f=>({f,label:_FIELD_LABEL[f],was:a[f],now:b[f]}));
    return diffs.length ? {fresh, srv, diffs} : null;
}
function _writeFailHtml(e, retryFn){
    return `<span class="text-red-600"><i class="fas fa-times-circle mr-1"></i>${escapeHtml(e.message)}</span>`
        + (retryFn ? ` <button onclick="${retryFn}" class="ml-2 px-2 py-0.5 rounded bg-slate-900 text-white text-[11px] font-semibold"><i class="fas fa-rotate-right mr-1"></i>Coba lagi</button>` : '');
}

async function submitEdit(){
    if(document.getElementById('editMode').value==='create') return submitCreate();
    const numErrs=validateFormNumbers();
    if(numErrs.length){ document.getElementById('editMsg').innerHTML=`<span class="text-red-600"><i class="fas fa-triangle-exclamation mr-1"></i>${escapeHtml(numErrs[0])}</span>`; return; }
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
        lokasi: lokKey(document.getElementById('f_lokasi').value) || '-',
        divisi: document.getElementById('f_divisi').value,
        repairStatus: document.getElementById('f_repair').value,
        tingkat: document.getElementById('f_tingkat').value,
        engineType: document.getElementById('f_engineType').value.trim() || '-',
        engineCode: document.getElementById('f_engineCode').value.trim() || '-',
        irrType: document.getElementById('f_irrType').value.trim() || '-',
        irrCode: document.getElementById('f_irrCode').value.trim() || '-',
        damageType: document.getElementById('f_damageType').value.trim() || '-',
        keterangan: document.getElementById('f_keterangan').value.trim(),
        sparepart: document.getElementById('f_sparepart').value.trim() || '-',
        prNumber: document.getElementById('f_prNumber').value.trim() || null,
        pic: document.getElementById('f_pic').value || '-'
    };
    const msg=document.getElementById('editMsg');
    const btn=document.getElementById('editSaveBtn');
    const setStatus = t => { msg.innerHTML=`<span class="text-blue-600"><i class="fas fa-spinner spin mr-1"></i>${escapeHtml(t)}</span>`; };
    if(window.__writeBusy) return;
    btn.disabled=true;
    if(!openEditModalRaw._conflictChecked){
        setStatus('Memeriksa perubahan terbaru di spreadsheet…');
        let conflict=null; try{ conflict = await detectEditConflict(d); }catch(e){}
        if(conflict){
            btn.disabled=false; openEditModalRaw._conflictChecked = true; // klik Simpan berikutnya = timpa
            if(conflict.missing){
                msg.innerHTML=`<div class="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><i class="fas fa-circle-exclamation mr-1"></i>Baris ini tidak ditemukan lagi di spreadsheet (mungkin sudah dihapus atau dipindah). <button type="button" onclick="closeModal('editModal');refreshData(true)" class="ml-1 px-2 py-0.5 rounded bg-slate-900 text-white font-semibold">Refresh data</button></div>`;
                return;
            }
            const srvIdx = rawData.indexOf(d);
            window.__conflictFresh = conflict.srv;
            msg.innerHTML=`<div class="text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
                <div class="font-semibold"><i class="fas fa-code-compare mr-1"></i>Baris ini sudah berubah di spreadsheet sejak dimuat:</div>
                <ul class="list-disc ml-4 my-1">${conflict.diffs.map(x=>`<li><b>${x.label}</b>: "${escapeHtml(x.was||'kosong')}" → "${escapeHtml(x.now||'kosong')}"</li>`).join('')}</ul>
                <div class="flex flex-wrap gap-1.5 mt-1.5">
                    <button type="button" onclick="(function(){ const s=window.__conflictFresh; if(!s) return; rawData[${srvIdx}]=indexRecords([s])[0]; validateRecord(rawData[${srvIdx}]); applyFilters(); openEditModalRaw(${srvIdx}); showToast('Form dimuat ulang dengan nilai terbaru dari spreadsheet.','info'); })()" class="px-2.5 py-1 rounded-md bg-slate-900 text-white text-[11px] font-semibold"><i class="fas fa-rotate mr-1"></i>Muat nilai terbaru</button>
                    <button type="button" onclick="submitEdit()" class="px-2.5 py-1 rounded-md bg-amber-600 text-white text-[11px] font-semibold"><i class="fas fa-pen mr-1"></i>Tetap simpan (timpa perubahan di sheet)</button>
                </div></div>`;
            return;
        }
        openEditModalRaw._conflictChecked = true;
    }
    setStatus('Menyimpan ke spreadsheet…'); window.__writeBusy=true;
    // opId dipertahankan antar klik "Coba lagi" agar proxy tidak menulis dua kali
    submitEdit._opId = submitEdit._opId && submitEdit._opKey===rawi ? submitEdit._opId : null; submitEdit._opKey = rawi;
    try{
        try {
            const res = await callWriteProxy({action:'update', ...payload, ...(submitEdit._opId?{opId:submitEdit._opId}:{})}, {onStatus:setStatus});
            submitEdit._opId = null;
        } catch(e){
            if(!e.uncertain) throw e;
            submitEdit._opId = e.opId;
            setStatus('Tidak ada respons — memeriksa apakah perubahan sudah masuk ke spreadsheet…');
            const ok = await verifyWriteApplied(fresh => fresh.some(x => x.__row===d.__row ? _sameFields(x, payload) : false) || fresh.some(x => _sameFields(x, payload) && x.lokasi===payload.lokasi && x.damageType===payload.damageType));
            if(!ok) throw e;
            submitEdit._opId = null;
            showToast('Apps Script lambat merespons, tetapi perubahan terverifikasi sudah tersimpan di spreadsheet.','success');
        }
        // Update local cache (optimistic)
        const upd = {...d};
        Object.assign(upd,{
            lokasi:payload.lokasi, divisi:payload.divisi,
            repairStatus:payload.repairStatus, tingkat:payload.tingkat,
            status: deriveStatus(payload.prNumber, payload.repairStatus),
            engineType:payload.engineType, engineCode:payload.engineCode,
            irrType:payload.irrType, irrCode:payload.irrCode,
            damageType:payload.damageType, keterangan:payload.keterangan,
            sparepart:payload.sparepart, prNumber:payload.prNumber, pic:payload.pic,
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
        rawData[rawi] = indexRecords([revalidateAfterWrite(upd)])[0];
        notePendingWrite('update', rawData[rawi], rawData[rawi].__row);
        closeModal('editModal');
        showToast('Perubahan tersimpan di spreadsheet.','success');
        applyFilters(); renderQualityBanner();
        // refreshData kini SELALU membaca Sheets langsung (bukan cache) → aman untuk
        // menyelaraskan ulang dari sumber kebenaran, termasuk nomor baris (__row).
        setTimeout(()=>refreshData(true,{silent:true}), 2500);
        setTimeout(()=>refreshData(true,{silent:true}), 20000);
    }catch(e){
        msg.innerHTML=_writeFailHtml(e, e.uncertain?'submitEdit()':null);
        btn.disabled=false;
    } finally { window.__writeBusy=false; }
}

function openDeleteModal(globalIdx){ return openDeleteModalRaw(rawData.indexOf(filteredData[globalIdx])); }
function openDeleteModalRaw(rawi){
    if(!requireWriteEndpoint()) return;
    const d = rawData[rawi];
    if(!d) return;
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
    if(window.__writeBusy) return;           // cegah klik ganda / operasi tulis bersamaan
    window.__writeBusy=true;
    const msg=document.getElementById('delMsg');
    const btn=document.getElementById('delConfirmBtn');
    const setStatus = t => { msg.innerHTML=`<span class="text-red-600"><i class="fas fa-spinner spin mr-1"></i>${escapeHtml(t)}</span>`; };
    setStatus('Menghapus…');
    btn.disabled=true;
    submitDelete._opId = submitDelete._opKey===rawi ? submitDelete._opId : null; submitDelete._opKey = rawi;
    try{
        try {
            await callWriteProxy({
                action:'delete',
                sheetRow: sheetRow?parseInt(sheetRow):null,
                matchTs: d.timestamp,
                matchLokasi: d.lokasi,
                matchDamage: d.damageType,
                ...(submitDelete._opId?{opId:submitDelete._opId}:{})
            }, {onStatus:setStatus});
            submitDelete._opId = null;
        } catch(e){
            if(!e.uncertain) throw e;
            submitDelete._opId = e.opId;
            setStatus('Tidak ada respons — memeriksa apakah baris sudah terhapus…');
            const gone = await verifyWriteApplied(fresh => !fresh.some(x => x.lokasi===d.lokasi && x.damageType===d.damageType && x.tanggalInspeksi===d.tanggalInspeksi && (x.keterangan||'')===(d.keterangan||'')));
            if(!gone) throw e;
            submitDelete._opId = null;
            showToast('Apps Script lambat merespons, tetapi baris terverifikasi sudah terhapus.','success');
        }
        closeModal('deleteModal');
        showToast('Baris dihapus dari spreadsheet.','success');
        const deletedRow = d.__row;
        notePendingWrite('delete', d, deletedRow);
        rawData.splice(rawi,1);
        // Baris di bawah yang dihapus bergeser naik 1 di spreadsheet → koreksi __row lokal
        // agar edit/hapus berikutnya (sebelum refresh) tetap mengenai baris yang benar.
        if(typeof deletedRow==='number') rawData.forEach(x=>{ if(typeof x.__row==='number' && x.__row>deletedRow) x.__row--; });
        applyFilters(); renderQualityBanner();
        setTimeout(()=>refreshData(true,{silent:true}), 2500);
    }catch(e){
        msg.innerHTML=_writeFailHtml(e, e.uncertain?'submitDelete()':null);
        btn.disabled=false;
    }
    finally{ window.__writeBusy=false; }
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
        if(btn) btn.addEventListener('click', e => {
            e.stopPropagation();
            const willOpen = !w.classList.contains('open');
            document.querySelectorAll('.ms-wrap.open').forEach(o => { if(o!==w) o.classList.remove('open'); });
            w.classList.toggle('open', willOpen);
            if(willOpen) msPlaceMenu(w);
        });
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
    loadFormOptions(); // sinkron pilihan dropdown dengan Google Form (latar belakang)
    // Cek versi write-proxy di latar belakang: peringatkan bila kode lama masih terpasang
    (async()=>{
        const u=getWriteUrl(); if(!u) return;
        try{
            const r=await fetch(u+'?action=check',{redirect:'follow'}); const t=(await r.text()).trim();
            const m=t.match(/\bv(\d+)\b/); const ver=m?+m[1]:0;
            if(!/^ok:/i.test(t) || ver<3){
                showToast('Write-proxy Apps Script versi lama/tidak valid ('+(t.slice(0,40)||'no response')+'). Edit Tingkat/Status Perbaikan tidak akan tersimpan — deploy ulang scripts/write-proxy.gs (lihat SETUP-EDIT.md).','warning');
            } else if(ver<7){
                showToast('Write-proxy masih v'+ver+'. Versi terbaru (v7) menyimpan kolom PIC — salin scripts/write-proxy.gs terbaru ke Apps Script lalu Deploy → Manage deployments → Edit → New version.','warning');
            }
            window.__proxyVersion = ver;
        }catch(e){}
    })();

    // Re-render charts saat window resize (throttled) agar tidak terpotong
    let resizeT;
    window.addEventListener('resize',()=>{
        clearTimeout(resizeT);
        resizeT=setTimeout(()=>renderCharts(),150);
    });
});
