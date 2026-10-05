

/* ============================================================
   THEME (light/dark)
============================================================ */
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t==='dark'?'dark':'light');
  localStorage.setItem('sipakem_theme', t);
  const isDark = t==='dark';
  const loginIcon = document.getElementById('loginThemeIcon');
  const loginToggle = document.getElementById('loginThemeToggle');
  const sbIcon = document.getElementById('sidebarThemeIcon');
  const sbLabel = document.getElementById('sidebarThemeLabel');
  const sbToggle = document.getElementById('sidebarThemeToggle');
  if(loginIcon) loginIcon.textContent = isDark? '🌙':'☀';
  if(loginToggle) loginToggle.classList.toggle('on', isDark);
  if(sbIcon) sbIcon.textContent = isDark? '🌙':'☀';
  if(sbLabel) sbLabel.textContent = isDark? 'Mode Gelap':'Mode Terang';
  if(sbToggle) sbToggle.classList.toggle('on', isDark);
}
function toggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme')||'light';
  applyTheme(cur==='dark'?'light':'dark');
}
applyTheme(localStorage.getItem('sipakem_theme')||'light');

/* ============================================================
   STATE — data berasal dari Google Sheets (via Apps Script)
============================================================ */
const DB = { kops:[], templates:[], docs:[], users:[], signature:null, bsre:{enabled:false} };
const $ = id => document.getElementById(id);

let CURRENT_USER = null;
let EDITING_DOC_ID = null; // draf yang sedang diedit (null = dokumen baru)
let sk = null; // the SK currently being edited (see resetSkForm)
let selectedKopId = null, selectedTplId = null;

/* ============================================================
   AUTH
============================================================ */

function showLoginError(msg){
  const err = $('loginError'); err.style.display='block'; err.textContent=msg;
}
async function doLogin(){
  const u = $('loginUser').value.trim();
  const p = $('loginPass').value;
  const btn = $('loginBtn');
  $('loginError').style.display='none';
  if(!u || !p){ showLoginError('Isi nama pengguna dan kata sandi.'); return; }
  btn.disabled = true; btn.textContent = 'Memeriksa...';
  try{
    const r = await Api.call('login', {username:u, password:p});
    Api.setToken(r.token);
    CURRENT_USER = r.user;
    await loadAll();
    enterApp();
    if(CURRENT_USER.mustChange) openPwModal(true);
  }catch(e){
    console.error(e);
    Api.setToken(null);
    showLoginError(Api.msg(e));
  }finally{
    btn.disabled = false; btn.textContent = 'Masuk';
  }
}

/* Ambil seluruh data dari server (Google Sheets). */
function applyBootstrap(d){
  CURRENT_USER = d.user;
  DB.kops = d.kops||[]; DB.templates = d.templates||[]; DB.docs = d.docs||[]; DB.users = d.users||[];
  DB.signature = (d.signature && d.signature.signature) || null;
  DB.bsre = d.bsre || {enabled:false};
}
async function loadAll(){
  applyBootstrap(await Api.call('bootstrap', {}, {retry:true}));
}
function rerenderAll(){
  refreshDashboard(); renderKopManageTable(); renderTplManageTable(); renderUserTable();
  loadKopPicker(); loadTplPicker(); renderRiwayat(); loadSavedSignaturePreview(); renderBsreInfo();
  $('sbUserName').textContent = CURRENT_USER.nama;
  $('sbUserRole').textContent = CURRENT_USER.role==='admin' ? 'Administrator' : 'Staf';
}
async function reloadFromServer(silent){
  showProgress('Memuat data terbaru...');
  try{
    await loadAll(); rerenderAll(); renderPreview();
    if(!silent) toast('Data diperbarui dari server.', 'ok');
    return true;
  }catch(e){ console.error(e); if(e.code!=='AUTH') toast(Api.msg(e), 'err'); return false; }
  finally{ hideProgress(); }
}

/* Jalankan aksi tulis ke server dengan overlay + penanganan error seragam. Mengembalikan null bila gagal. */
async function guarded(progressMsg, fn){
  showProgress(progressMsg||'Memproses...');
  try{ return await fn(); }
  catch(e){ console.error(e); if(e.code!=='AUTH') toast(Api.msg(e), 'err'); return null; }
  finally{ hideProgress(); }
}

async function doLogout(){
  try{ if(Api.hasToken()) await Api.call('logout'); }catch(e){ /* abaikan: tetap keluar */ }
  forceLogout();
}
function forceLogout(message){
  Api.setToken(null);
  CURRENT_USER = null; EDITING_DOC_ID = null;
  DB.kops=[]; DB.templates=[]; DB.docs=[]; DB.users=[]; DB.signature=null; DB.bsre={enabled:false};
  selectedKopId = null; selectedTplId = null;
  $('app').style.display='none';
  $('loginScreen').style.display='flex';
  $('loginUser').value=''; $('loginPass').value='';
  closePwModal(true);
  hideProgress();
  if(message){ showLoginError(message); } else { $('loginError').style.display='none'; }
}
Api.onAuthExpired = ()=>{ if(CURRENT_USER) forceLogout('Sesi berakhir. Silakan masuk kembali.'); };

function enterApp(){
  $('loginScreen').style.display='none';
  $('app').style.display='block';
  $('sbUserName').textContent = CURRENT_USER.nama;
  $('sbUserRole').textContent = CURRENT_USER.role==='admin' ? 'Administrator' : 'Staf';
  buildNav();
  goto('dashboard');
  refreshDashboard();
  renderKopManageTable();
  renderTplManageTable();
  renderUserTable();
  loadKopPicker();
  loadTplPicker();
  resetSkForm(true);
  initSigCanvas();
  loadSavedSignaturePreview();
  renderBsreInfo();
}
/* ============================================================
   NAV
============================================================ */
const NAV_ITEMS = [
  {id:'dashboard', label:'Dasbor', icon:'▦'},
  {id:'buat', label:'Buat SK Baru', icon:'✎'},
  {id:'riwayat', label:'Riwayat SK', icon:'🗂'},
  {id:'kop', label:'Kelola Kop Surat', icon:'⌂', adminOnly:true},
  {id:'template', label:'Kelola Template', icon:'▤', adminOnly:true},
  {id:'tte', label:'Tanda Tangan Elektronik', icon:'✒'},
  {id:'users', label:'Kelola Pengguna', icon:'☺', adminOnly:true},
];
function buildNav(){
  const nav = document.getElementById('navList');
  nav.innerHTML='';
  NAV_ITEMS.forEach(it=>{
    if(it.adminOnly && CURRENT_USER.role!=='admin') return;
    const d = document.createElement('div');
    d.className='nav-item'; d.id='nav-'+it.id;
    d.innerHTML = `<span class="nav-icon">${it.icon}</span><span>${it.label}</span>`;
    d.onclick=()=>goto(it.id);
    nav.appendChild(d);
  });
}
function goto(view){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(v=>v.classList.remove('active'));
  const v = document.getElementById('view-'+view);
  if(v) v.classList.add('active');
  const n = document.getElementById('nav-'+view);
  if(n) n.classList.add('active');
  if(view==='dashboard') refreshDashboard();
  if(view==='riwayat') renderRiwayat();
  if(view==='buat') renderPreview();
  if(view==='tte' && window._sigResize) window._sigResize();
}

/* ============================================================
   TOAST / PROGRESS
============================================================ */
function toast(msg, type){
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (type? ' '+type:'');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>{ t.className='toast'; }, 3200);
}
function showProgress(msg){ document.getElementById('progressText').textContent=msg; document.getElementById('progressOverlay').classList.add('show'); }
function hideProgress(){ document.getElementById('progressOverlay').classList.remove('show'); }

/* ============================================================
   DASHBOARD
============================================================ */


function statusBadge(d){
  if(d.status!=='signed') return '<span class="badge badge-warn">Draf</span>';
  if(d.tteStatus==='bsre') return '<span class="badge badge-ok">TTE BSrE</span>';
  if(d.tteStatus==='bsre_pending') return '<span class="badge badge-warn">Menunggu TTE BSrE</span>';
  return '<span class="badge badge-ok">Ditandatangani (internal)</span>';
}
function refreshDashboard(){
  const docs = DB.docs;
  $('stDocs').textContent = docs.length;
  $('stSigned').textContent = docs.filter(d=>d.status==='signed' && d.tteStatus!=='bsre_pending').length;
  $('stTpl').textContent = DB.templates.length;
  $('stKop').textContent = DB.kops.length;
  const tb = document.querySelector('#dashRecentTable tbody'); tb.innerHTML='';
  docs.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,6).forEach(d=>{
    const kop = DB.kops.find(k=>k.id===d.kopId);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(d.nomor)}/${escapeHtml(d.tahun)}</td><td>${escapeHtml(d.tentang||'-')}</td><td>${kop? escapeHtml(kop.kelurahan):'-'}</td>
      <td>${statusBadge(d)}</td>
      <td><button class="btn btn-outline btn-sm" onclick="loadDocToForm('${escapeHtml(d.id)}')">Buka</button></td>`;
    tb.appendChild(tr);
  });
  if(!docs.length){ tb.innerHTML = '<tr><td colspan="5" class="small-muted">Belum ada SK. Klik “Buat SK Baru” untuk memulai.</td></tr>'; }
}
/* ============================================================
   HELPERS: dates, ordinal, escaping
============================================================ */
const BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
function formatTanggalIndo(iso){
  if(!iso) return '..........';
  const d = new Date(iso+'T00:00:00');
  if(isNaN(d)) return iso;
  return d.getDate()+' '+BULAN[d.getMonth()]+' '+d.getFullYear();
}
const ORDINAL = ['KESATU','KEDUA','KETIGA','KEEMPAT','KELIMA','KEENAM','KETUJUH','KEDELAPAN','KESEMBILAN','KESEPULUH','KESEBELAS','KEDUABELAS','KETIGABELAS','KEEMPATBELAS','KELIMABELAS'];
function ordinalIndo(n){ return ORDINAL[n-1] || ('KE-'+n); }
function letterOf(n){ return String.fromCharCode(96+n); } // 1=a,2=b...
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function nl2br(s){ return escapeHtml(s||'').replace(/\n/g,'<br>'); }

/* ============================================================
   KOP: manage (CRUD)
============================================================ */
let editingKopId = null;
function renderKopManageTable(){
  const tb = document.getElementById('kopTableBody'); tb.innerHTML='';
  DB.kops.forEach(k=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><b>${escapeHtml(k.pemerintah)}</b></td><td>${escapeHtml(k.kecamatan)}<br>${escapeHtml(k.kelurahan)}</td>
      <td>${escapeHtml(k.jabatanKepala||'-')}<br><span class="small-muted">${escapeHtml(k.namaKepala||'')}</span></td>
      <td><button class="btn btn-outline btn-sm" onclick="openKopForm('${k.id}')">Ubah</button>
      <button class="btn btn-danger btn-sm" onclick="deleteKop('${k.id}')">Hapus</button></td>`;
    tb.appendChild(tr);
  });
}

function openKopForm(id){
  editingKopId = id || null;
  $('kopFormCard').classList.remove('hidden');
  const k = id ? DB.kops.find(x=>x.id===id) : {pemerintah:'PEMERINTAH KOTA PALANGKA RAYA',kecamatan:'KECAMATAN RAKUMPIT',kelurahan:'',kodepos:'',alamat:'',laman:'',email:'',jabatanKepala:'',namaKepala:'',nipKepala:'',logo:null};
  $('kopFormTitle').textContent = id? 'Ubah Kop Surat':'Kop Surat Baru';
  ['pemerintah','kecamatan','kelurahan','kodepos','alamat','laman','email','jabatanKepala','namaKepala','nipKepala']
    .forEach(f=>{ $('kf_'+f).value = k[f]||''; });
  $('kf_logoPreview').src = 'data:image/png;base64,'+(k.logo||LOGO_B64);
  window._kopLogoNew = null;
  $('kopFormCard').scrollIntoView({behavior:'smooth', block:'start'});
}
function closeKopForm(){ document.getElementById('kopFormCard').classList.add('hidden'); editingKopId=null; }

async function handleLogoUpload(ev){
  const f = ev.target.files[0]; if(!f) return;
  try{
    const b64 = await fileToPngBase64(f, 400);
    window._kopLogoNew = b64;
    $('kf_logoPreview').src = 'data:image/png;base64,'+b64;
  }catch(e){ toast(Api.msg(e), 'err'); }
  ev.target.value = '';
}

async function saveKop(){
  const g = f => $('kf_'+f).value.trim();
  const data = {
    id: editingKopId || undefined,
    pemerintah: g('pemerintah'), kecamatan: g('kecamatan'), kelurahan: g('kelurahan'),
    kodepos: g('kodepos'), alamat: g('alamat'), laman: g('laman'), email: g('email'),
    jabatanKepala: g('jabatanKepala'), namaKepala: g('namaKepala'), nipKepala: g('nipKepala')
  };
  if(!data.pemerintah){ toast('Baris 1 kop (pemerintah) wajib diisi.', 'err'); return; }
  if(!data.kelurahan){ toast('Nama kelurahan/instansi wajib diisi.', 'err'); return; }
  if(window._kopLogoNew) data.logo = window._kopLogoNew;
  const r = await guarded('Menyimpan kop surat...', ()=>Api.call('saveKop', {kop:data}));
  if(!r) return;
  await reloadFromServer(true);
  closeKopForm();
  toast('Kop surat tersimpan.', 'ok');
}

async function deleteKop(id){
  if(!confirm('Hapus kop surat ini?')) return;
  const r = await guarded('Menghapus kop surat...', ()=>Api.call('deleteKop', {id}));
  if(!r) return;
  DB.kops = DB.kops.filter(k=>k.id!==id);
  renderKopManageTable(); loadKopPicker(); refreshDashboard();
  toast('Kop surat dihapus.', 'ok');
}
/* ============================================================
   TEMPLATE: manage (CRUD)
============================================================ */
let editingTplId = null;
function renderTplManageTable(){
  const tb = document.getElementById('tplTableBody'); tb.innerHTML='';
  DB.templates.forEach(t=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><b>${escapeHtml(t.nama)}</b></td><td>${escapeHtml(t.kategori)}</td>
      <td>${t.menimbang.length} menimbang · ${t.mengingat.length} mengingat · ${t.diktum.length} diktum</td>
      <td><button class="btn btn-outline btn-sm" onclick="openTplForm('${t.id}')">Ubah</button>
      <button class="btn btn-danger btn-sm" onclick="deleteTpl('${t.id}')">Hapus</button></td>`;
    tb.appendChild(tr);
  });
}
function tplAddListItem(field, val){
  const wrap = document.getElementById('tf_'+field);
  const row = document.createElement('div'); row.className='row';
  row.innerHTML = `<div class="tag">•</div><textarea>${escapeHtml(val||'')}</textarea><button class="rm" onclick="this.parentElement.remove()">✕</button>`;
  wrap.appendChild(row);
}
function tplAddDiktum(label, text){
  const wrap = document.getElementById('tf_diktum');
  const n = wrap.children.length+1;
  const row = document.createElement('div'); row.className='diktum-row';
  row.innerHTML = `<div class="dh"><input value="${escapeHtml(label||ordinalIndo(n))}"><button class="rm" onclick="this.closest('.diktum-row').remove()">✕</button></div><textarea>${escapeHtml(text||'')}</textarea>`;
  wrap.appendChild(row);
}
function openTplForm(id){
  editingTplId = id||null;
  document.getElementById('tplFormCard').classList.remove('hidden');
  document.getElementById('tplFormTitle').textContent = id? 'Ubah Template':'Template Baru';
  const t = id? DB.templates.find(x=>x.id===id) : {nama:'',kategori:'Umum / Kosong',menimbang:[''],mengingat:[''],diktum:[{label:'KESATU',text:''}],tembusan:['Arsip.']};
  document.getElementById('tf_nama').value=t.nama;
  document.getElementById('tf_kategori').value=t.kategori;
  ['menimbang','mengingat','tembusan'].forEach(f=>{
    document.getElementById('tf_'+f).innerHTML='';
    t[f].forEach(v=>tplAddListItem(f, v));
  });
  document.getElementById('tf_diktum').innerHTML='';
  t.diktum.forEach(d=>tplAddDiktum(d.label, d.text));
  window._tplLampiranTemp = {lampiran: t.lampiran||false, lampiranKolom: t.lampiranKolom||['NO','NAMA','JABATAN','KETERANGAN'], lampiranBaris: t.lampiranBaris||[]};
}
function closeTplForm(){ document.getElementById('tplFormCard').classList.add('hidden'); editingTplId=null; }

async function saveTpl(){
  const nama = $('tf_nama').value.trim();
  if(!nama){ toast('Nama template wajib diisi.','err'); return; }
  const readList = f => Array.from(document.querySelectorAll('#tf_'+f+' textarea')).map(x=>x.value.trim()).filter(Boolean);
  const diktum = Array.from(document.querySelectorAll('#tf_diktum .diktum-row')).map(row=>({
    label: row.querySelector('input').value.trim(), text: row.querySelector('textarea').value.trim()
  })).filter(d=>d.text);
  const old = editingTplId ? DB.templates.find(t=>t.id===editingTplId) : null;
  const data = {
    id: editingTplId || undefined, nama, kategori: $('tf_kategori').value,
    menimbang: readList('menimbang'), mengingat: readList('mengingat'), diktum, tembusan: readList('tembusan'),
    memperhatikan: (old && old.memperhatikan) || [],
    lampiran: (window._tplLampiranTemp && window._tplLampiranTemp.lampiran) || false,
    lampiranKolom: (window._tplLampiranTemp && window._tplLampiranTemp.lampiranKolom) || ['NO','NAMA','JABATAN','KETERANGAN'],
    lampiranBaris: (window._tplLampiranTemp && window._tplLampiranTemp.lampiranBaris) || []
  };
  const r = await guarded('Menyimpan template...', ()=>Api.call('saveTemplate', {template:data}));
  if(!r) return;
  await reloadFromServer(true);
  closeTplForm();
  toast('Template tersimpan.', 'ok');
}

async function deleteTpl(id){
  if(!confirm('Hapus template ini?')) return;
  const r = await guarded('Menghapus template...', ()=>Api.call('deleteTemplate', {id}));
  if(!r) return;
  DB.templates = DB.templates.filter(t=>t.id!==id);
  renderTplManageTable(); loadTplPicker(); refreshDashboard();
  toast('Template dihapus.', 'ok');
}
/* ============================================================
   USERS
============================================================ */

function renderUserTable(){
  const tb = $('userTableBody'); if(!tb) return; tb.innerHTML='';
  DB.users.forEach(u=>{
    const me = CURRENT_USER && u.username.toLowerCase()===CURRENT_USER.username.toLowerCase();
    const tr = document.createElement('tr');
    const un = escapeHtml(u.username);
    tr.innerHTML = `<td>${un}${me?' <span class="small-muted">(Anda)</span>':''}</td><td>${escapeHtml(u.nama)}</td><td>${u.role==='admin'?'Admin':'Staf'}</td>
      <td><button class="btn btn-outline btn-sm" onclick="resetUserPassword('${un}')">Reset sandi</button>
      ${me?'':`<button class="btn btn-danger btn-sm" onclick="deleteUser('${un}')">Hapus</button>`}</td>`;
    tb.appendChild(tr);
  });
}
function openUserForm(){ document.getElementById('userFormCard').classList.remove('hidden'); }
function closeUserForm(){ document.getElementById('userFormCard').classList.add('hidden'); }

async function saveUser(){
  const username = $('uf_username').value.trim();
  const password = $('uf_password').value;
  const nama = $('uf_nama').value.trim();
  const role = $('uf_role').value;
  if(!username || !password || !nama){ toast('Lengkapi semua kolom.', 'err'); return; }
  if(password.length < 8){ toast('Kata sandi minimal 8 karakter.', 'err'); return; }
  const r = await guarded('Menambahkan pengguna...', ()=>Api.call('saveUser', {username, password, nama, role}));
  if(!r) return;
  await reloadFromServer(true);
  closeUserForm();
  $('uf_username').value=''; $('uf_password').value=''; $('uf_nama').value='';
  toast('Pengguna ditambahkan. Pengguna wajib mengganti sandi saat masuk pertama kali.', 'ok');
}

async function deleteUser(username){
  if(!confirm('Hapus pengguna "'+username+'"?')) return;
  const r = await guarded('Menghapus pengguna...', ()=>Api.call('deleteUser', {username}));
  if(!r) return;
  DB.users = DB.users.filter(u=>u.username!==username);
  renderUserTable();
  toast('Pengguna dihapus.', 'ok');
}
async function resetUserPassword(username){
  if(!confirm('Buat kata sandi sementara baru untuk "'+username+'"?')) return;
  const r = await guarded('Mereset kata sandi...', ()=>Api.call('resetPassword', {username}));
  if(!r) return;
  window.prompt('Kata sandi sementara untuk '+r.username+' (salin dan berikan kepada pengguna; wajib diganti saat masuk):', r.newPassword);
}

/* ---- Ubah kata sandi ---- */
function openPwModal(forced){
  $('pw_old').value=''; $('pw_new').value=''; $('pw_new2').value='';
  $('pwError').style.display='none';
  $('pwCancel').classList.toggle('hidden', !!forced);
  $('pwForcedNote').classList.toggle('hidden', !forced);
  $('pwModal').classList.add('show');
  setTimeout(()=>$('pw_old').focus(), 50);
}
function closePwModal(force){
  if(!force && CURRENT_USER && CURRENT_USER.mustChange) return; // wajib ganti dulu
  $('pwModal').classList.remove('show');
}
async function submitPwChange(){
  const o=$('pw_old').value, n=$('pw_new').value, n2=$('pw_new2').value;
  const err=$('pwError');
  const fail = m=>{ err.textContent=m; err.style.display='block'; };
  if(!o||!n||!n2) return fail('Lengkapi semua kolom.');
  if(n.length<8) return fail('Kata sandi baru minimal 8 karakter.');
  if(n!==n2) return fail('Konfirmasi kata sandi baru tidak sama.');
  if(n===o) return fail('Kata sandi baru harus berbeda dari yang lama.');
  const btn=$('pwSubmit'); btn.disabled=true;
  try{
    await Api.call('changePassword', {oldPassword:o, newPassword:n});
    CURRENT_USER.mustChange=false;
    closePwModal(true);
    toast('Kata sandi berhasil diubah.', 'ok');
  }catch(e){ fail(Api.msg(e)); }
  finally{ btn.disabled=false; }
}
/* ============================================================
   SK BUILDER FORM
============================================================ */
function loadKopPicker(){
  const wrap = document.getElementById('kopPickList'); wrap.innerHTML='';
  const kops = DB.kops;
  if((!selectedKopId || !kops.find(k=>k.id===selectedKopId)) && kops[0]) selectedKopId = kops[0].id;
  kops.forEach(k=>{
    const d = document.createElement('div');
    d.className = 'kop-pick' + (k.id===selectedKopId?' sel':'');
    d.innerHTML = `<div class="kt1">${escapeHtml(k.kelurahan)}</div><div class="kt2">${escapeHtml(k.kecamatan)}<br>${escapeHtml(k.pemerintah)}</div>`;
    d.onclick = ()=>{ selectedKopId = k.id; loadKopPicker(); applyKopDefaultsToForm(); renderPreview(); };
    wrap.appendChild(d);
  });
}
function applyKopDefaultsToForm(){
  const k = DB.kops.find(x=>x.id===selectedKopId);
  if(!k) return;
  document.getElementById('f_jabatanKop').value = k.jabatanKepala||'';
  document.getElementById('f_ditetapkanDi').value = (k.kelurahan||'').replace(/^KELURAHAN\s+/i,'');
  document.getElementById('f_ttdJabatan').value = k.jabatanKepala||'';
  document.getElementById('f_ttdNama').value = k.namaKepala||'';
  document.getElementById('f_ttdNip').value = k.nipKepala||'';
}
function loadTplPicker(){
  const wrap = document.getElementById('tplPickList'); wrap.innerHTML='';
  const tpls = DB.templates;
  if((!selectedTplId || !tpls.find(t=>t.id===selectedTplId)) && tpls[0]) selectedTplId = tpls[0].id;
  tpls.forEach(t=>{
    const d = document.createElement('div');
    d.className='tpl-card'+(t.id===selectedTplId?' sel':'');
    d.innerHTML = `<div class="tk">${escapeHtml(t.kategori)}</div><div class="tn">${escapeHtml(t.nama)}</div><div class="td">${t.menimbang.length} menimbang, ${t.mengingat.length} dasar hukum, ${t.diktum.length} diktum${t.lampiran?', lampiran':''}</div>`;
    d.onclick = ()=>{ selectedTplId = t.id; loadTplPicker(); applyTemplateToForm(t); renderPreview(); };
    wrap.appendChild(d);
  });
}
function applyTemplateToForm(t){
  document.getElementById('f_tentang').value = '';
  fillListEditor('menimbang', t.menimbang);
  fillListEditor('mengingat', t.mengingat);
  fillListEditor('tembusan', t.tembusan);
  fillDiktumEditor(t.diktum);
  document.getElementById('f_hasMemperhatikan').checked = !!(t.memperhatikan && t.memperhatikan.length);
  fillListEditor('memperhatikan', t.memperhatikan||[]);
  toggleMemperhatikan();
  document.getElementById('f_hasLampiran').checked = !!t.lampiran;
  window._lampCols = (t.lampiranKolom||['NO','NAMA','JABATAN','KETERANGAN']).slice();
  window._lampRows = (t.lampiranBaris||[]).map(r=>r.slice());
  toggleLampiran();
  renderLampTable();
}
function fillListEditor(field, items){
  const wrap = document.getElementById(field+'Editor'); wrap.innerHTML='';
  (items.length? items: ['']).forEach(v=>addListItem(field, v));
}
function addListItem(field, val){
  const wrap = document.getElementById(field+'Editor');
  const row = document.createElement('div'); row.className='row';
  const tagSpan = document.createElement('div'); tagSpan.className='tag';
  const ta = document.createElement('textarea'); ta.value = val||''; ta.oninput = renderPreview;
  const rm = document.createElement('button'); rm.className='rm'; rm.textContent='✕';
  rm.onclick = ()=>{ row.remove(); relabelList(field); renderPreview(); };
  row.appendChild(tagSpan); row.appendChild(ta); row.appendChild(rm);
  wrap.appendChild(row);
  relabelList(field);
  renderPreview();
}
function relabelList(field){
  const rows = document.querySelectorAll('#'+field+'Editor .row');
  rows.forEach((r,i)=>{
    const tag = r.querySelector('.tag');
    tag.textContent = (field==='mengingat'||field==='memperhatikan') ? (i+1) : (field==='tembusan' ? (i+1)+'.' : letterOf(i+1)+'.');
  });
}
function fillDiktumEditor(items){
  const wrap = document.getElementById('diktumEditor'); wrap.innerHTML='';
  (items.length? items: [{label:'KESATU',text:''}]).forEach(d=>addDiktum(d.label, d.text));
}
function addDiktum(label, text){
  const wrap = document.getElementById('diktumEditor');
  const n = wrap.children.length+1;
  const row = document.createElement('div'); row.className='diktum-row';
  const head = document.createElement('div'); head.className='dh';
  const inp = document.createElement('input'); inp.value = label || ordinalIndo(n); inp.oninput = renderPreview;
  const rm = document.createElement('button'); rm.className='rm'; rm.textContent='✕';
  rm.onclick=()=>{ row.remove(); renderPreview(); };
  head.appendChild(inp); head.appendChild(rm);
  const ta = document.createElement('textarea'); ta.value = text||''; ta.oninput = renderPreview;
  row.appendChild(head); row.appendChild(ta);
  wrap.appendChild(row);
  renderPreview();
}

/* ---- Memperhatikan (optional) ---- */
function toggleMemperhatikan(){
  const on = document.getElementById('f_hasMemperhatikan').checked;
  document.getElementById('memperhatikanEditorWrap').classList.toggle('hidden', !on);
  renderPreview();
}

/* ---- Lampiran table editor ---- */
window._lampCols = ['NO','NAMA','JABATAN','KETERANGAN'];
window._lampRows = [['1','','','']];
function toggleLampiran(){
  const on = document.getElementById('f_hasLampiran').checked;
  document.getElementById('lampiranEditorWrap').classList.toggle('hidden', !on);
  if(on) renderLampTable();
  renderPreview();
}
function renderLampTable(){
  const table = document.getElementById('lampTable');
  let html = '<thead><tr>';
  window._lampCols.forEach((c,ci)=>{ html += `<th><input value="${escapeHtml(c)}" onchange="lampSetCol(${ci}, this.value)"></th>`; });
  html += '</tr></thead><tbody>';
  window._lampRows.forEach((row,ri)=>{
    html += '<tr>';
    row.forEach((cell,ci)=>{ html += `<td><input value="${escapeHtml(cell)}" onchange="lampSetCell(${ri},${ci}, this.value)"></td>`; });
    html += `<td style="width:1%;"><button class="rm" style="width:26px;height:26px;" onclick="lampRemoveRow(${ri})">✕</button></td>`;
    html += '</tr>';
  });
  html += '</tbody>';
  table.innerHTML = html;
  renderPreview();
}
function lampSetCol(i, v){ window._lampCols[i]=v; renderPreview(); }
function lampSetCell(r,c,v){ window._lampRows[r][c]=v; renderPreview(); }
function lampAddRow(){ window._lampRows.push(window._lampCols.map((c,i)=> i===0? String(window._lampRows.length+1): '')); renderLampTable(); }
function lampRemoveRow(i){ window._lampRows.splice(i,1); renderLampTable(); }
function lampAddCol(){ window._lampCols.push('KOLOM'); window._lampRows.forEach(r=>r.push('')); renderLampTable(); }
function lampRemoveCol(){ if(window._lampCols.length<=1) return; window._lampCols.pop(); window._lampRows.forEach(r=>r.pop()); renderLampTable(); }

/* ---- reset / collect form ---- */

function resetSkForm(fresh){
  if(fresh){
    EDITING_DOC_ID = null;
    $('f_nomor').value='';
    $('f_tahun').value = new Date().getFullYear();
    $('f_tentang').value='';
    $('f_menetapkan').value='';
    $('f_tanggal').value = new Date().toISOString().slice(0,10);
    window._lampRows=[['1','','','']]; window._lampCols=['NO','NAMA','JABATAN','KETERANGAN'];
    $('f_hasLampiran').checked=false;
    $('f_hasMemperhatikan').checked=false;
    $('f_lampJudul').value='';
  } else {
    $('f_tahun').value = new Date().getFullYear();
  }
  applyKopDefaultsToForm();
  const tpl = DB.templates.find(t=>t.id===selectedTplId) || DB.templates[0];
  if(tpl) applyTemplateToForm(tpl);
  toggleLampiran();
  toggleMemperhatikan();
  if(fresh) suggestNextNomor();
  renderPreview();
}

/* Saran nomor SK berikutnya (angka tertinggi pada kop & tahun yang sama + 1). */
function suggestNextNomor(){
  const tahun = $('f_tahun').value.trim();
  let max = 0;
  DB.docs.forEach(d=>{
    if(d.kopId===selectedKopId && String(d.tahun)===tahun){
      const n = parseInt(String(d.nomor).replace(/\D/g,''),10);
      if(!isNaN(n) && n>max) max=n;
    }
  });
  const next = String(max+1).padStart(2,'0');
  $('f_nomor').placeholder = 'mis. '+next;
  const hint = $('nomorHint');
  if(hint) hint.textContent = max ? ('Nomor terakhir pada tahun '+tahun+': '+String(max).padStart(2,'0')+'. Saran berikutnya: '+next+'.') : '';
  if(!$('f_nomor').value && !EDITING_DOC_ID) $('f_nomor').value = next;
}
function collectFormData(){
  const readList = f => Array.from(document.querySelectorAll('#'+f+'Editor textarea')).map(x=>x.value.trim()).filter(Boolean);
  const diktum = Array.from(document.querySelectorAll('#diktumEditor .diktum-row')).map(r=>({
    label: r.querySelector('input').value.trim(), text: r.querySelector('textarea').value.trim()
  })).filter(d=>d.text);
  return {
    kopId: selectedKopId, templateId: selectedTplId,
    nomor: document.getElementById('f_nomor').value.trim(),
    tahun: document.getElementById('f_tahun').value.trim(),
    jabatanKop: document.getElementById('f_jabatanKop').value.trim(),
    tentang: document.getElementById('f_tentang').value.trim(),
    menetapkan: document.getElementById('f_menetapkan').value.trim(),
    ditetapkanDi: document.getElementById('f_ditetapkanDi').value.trim(),
    tanggal: document.getElementById('f_tanggal').value,
    menimbang: readList('menimbang'), mengingat: readList('mengingat'), diktum,
    hasMemperhatikan: document.getElementById('f_hasMemperhatikan').checked,
    memperhatikan: readList('memperhatikan'),
    ttdJabatan: document.getElementById('f_ttdJabatan').value.trim(),
    ttdNama: document.getElementById('f_ttdNama').value.trim(),
    ttdNip: document.getElementById('f_ttdNip').value.trim(),
    tembusan: readList('tembusan'),
    hasLampiran: document.getElementById('f_hasLampiran').checked,
    lampiranJudul: document.getElementById('f_lampJudul').value.trim(),
    lampiranKolom: window._lampCols.slice(),
    lampiranBaris: window._lampRows.map(r=>r.slice())
  };
}

/* ============================================================
   PREVIEW / RENDER
============================================================ */
/* ---- page geometry (F4, margin 3/3/3/4 cm = top/right/bottom/left) ---- */
const MM2PX = 96/25.4;
const PAGE_W_MM = 215, PAGE_H_MM = 330;
const MARGIN_TOP_MM = 30, MARGIN_RIGHT_MM = 30, MARGIN_BOTTOM_MM = 30, MARGIN_LEFT_MM = 40;
function pageInnerHeightPx(){ return (PAGE_H_MM - MARGIN_TOP_MM - MARGIN_BOTTOM_MM) * MM2PX; }

/* ---- measuring helper: renders html blocks off-screen and reads their real height ---- */
function measureBlocksHeights(htmlBlocks){
  const zone = document.getElementById('measureZone');
  zone.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'measure-page';
  zone.appendChild(wrap);
  const heights = htmlBlocks.map(html=>{
    const holder = document.createElement('div');
    holder.innerHTML = html;
    wrap.appendChild(holder);
    return holder.offsetHeight;
  });
  zone.innerHTML = '';
  return heights;
}

/* ---- generic greedy pagination: fits atomic blocks into pages of fixed height ---- */
function layoutPages(headerHtml, blocks){
  if(blocks.length===0) blocks = ['<div>&nbsp;</div>'];
  const availableFull = pageInnerHeightPx();
  const headerHeight = headerHtml ? measureBlocksHeights([headerHtml])[0] : 0;
  const heights = measureBlocksHeights(blocks);
  const pages = [];
  let cur = [], curH = 0, isFirst = true, avail = headerHtml ? (availableFull-headerHeight) : availableFull;
  for(let i=0;i<blocks.length;i++){
    const h = heights[i];
    if(cur.length>0 && (curH+h) > avail){
      pages.push({header: isFirst? headerHtml: null, blocksHtml: cur.join('')});
      cur = []; curH = 0; isFirst = false; avail = availableFull;
    }
    cur.push(blocks[i]); curH += h;
  }
  if(cur.length>0) pages.push({header: isFirst? headerHtml: null, blocksHtml: cur.join('')});
  return pages;
}

/* ---- content builders (return html strings) ---- */
function buildKopHtml(kop){
  return `<div class="kop">
    <img src="data:image/png;base64,${kop.logo||LOGO_B64}">
    <div class="kop-text">
      <div class="p1">${escapeHtml(kop.pemerintah)}</div>
      <div class="p2">${escapeHtml(kop.kecamatan)}</div>
      <div class="p3">${escapeHtml(kop.kelurahan)}</div>
      <div class="p4">Alamat: ${escapeHtml(kop.alamat)}${kop.kodepos? ' Kode Pos '+escapeHtml(kop.kodepos):''}
      ${kop.laman? '<br>Laman: '+escapeHtml(kop.laman):''}${kop.email? (kop.laman?' &nbsp;|&nbsp; ':'<br>')+'Email: '+escapeHtml(kop.email):''}</div>
    </div>
  </div>`;
}
function buildSkHeaderHtml(d, kop){
  return buildKopHtml(kop) + `<div class="doc-title">
    <div class="kt">KEPUTUSAN ${escapeHtml(d.jabatanKop||kop.jabatanKepala)}</div>
    <div class="no">NOMOR : ${escapeHtml(d.nomor||'...')} TAHUN ${escapeHtml(d.tahun||'...')}</div>
    <div class="tt">TENTANG</div>
    <div class="subj">${escapeHtml(d.tentang||'...')}</div>
    <div class="jab">${escapeHtml(d.jabatanKop||kop.jabatanKepala)}</div>
  </div>`;
}
function fieldRowItemHtml(label, showColon, tag, txt){
  return `<div class="field-row"><div class="lbl">${escapeHtml(label)}</div><div class="colon">${showColon?':':''}</div><div class="val"><div class="sub-list"><div class="item"><div class="tagc">${tag}</div><div class="txt">${escapeHtml(txt)}</div></div></div></div></div>`;
}
const BSRE_DISCLAIMER = 'Dokumen ini telah ditandatangani secara elektronik menggunakan sertifikat elektronik yang diterbitkan oleh Balai Sertifikasi Elektronik (BSrE), Badan Siber dan Sandi Negara. Keaslian dapat diperiksa melalui kode &amp; tautan verifikasi di atas serta pada aplikasi pembaca PDF yang mendukung validasi tanda tangan.';
const TTE_DISCLAIMER = 'Dokumen ini dilengkapi tanda tangan &amp; kode verifikasi elektronik internal sistem SIPAKEM sebagai jejak audit administratif, bukan tanda tangan elektronik tersertifikasi Penyelenggara Sertifikasi Elektronik (PSrE) seperti BSrE/BSSN.';

function buildSignBlockHtml(d, kop, withDate, sigBase64){
  let html = '<div class="sign-block"><div class="sign-inner">';
  if(withDate){
    html += `<div class="sign-place">Ditetapkan di : ${escapeHtml(d.ditetapkanDi||'...')}</div>`;
    html += `<div class="sign-place">Pada tanggal : ${formatTanggalIndo(d.tanggal)}</div>`;
  }
  html += `<div class="sign-jab" style="margin-top:${withDate?8:0}px;">${escapeHtml(d.ttdJabatan||kop.jabatanKepala)}</div>`;
  html += `<div class="sign-space">${sigBase64? `<img class="tte-img" src="data:image/png;base64,${sigBase64}">`:''}</div>`;
  html += `<div class="sign-name">${escapeHtml(d.ttdNama||kop.namaKepala||'.........................')}</div>`;
  html += `<div class="sign-nip">NIP. ${escapeHtml(d.ttdNip||kop.nipKepala||'-')}</div>`;
  html += '</div></div>';
  return html;
}
function buildTembusanBlockHtml(d){
  let html = `<div class="tembusan-block"><div class="tt">Tembusan disampaikan kepada Yth :</div><ol>`;
  (d.tembusan.length? d.tembusan:['Arsip.']).forEach(t=>{ html += `<li>${escapeHtml(t)}</li>`; });
  html += `</ol></div>`;
  return html;
}
function buildSkBodyBlocks(d, kop, sigBase64){
  const blocks = [];
  const menimbangItems = d.menimbang.length? d.menimbang: ['...'];
  menimbangItems.forEach((txt,i)=> blocks.push(fieldRowItemHtml(i===0?'Menimbang':'', i===0, letterOf(i+1)+'.', txt)));
  const mengingatItems = d.mengingat.length? d.mengingat: ['...'];
  mengingatItems.forEach((txt,i)=> blocks.push(fieldRowItemHtml(i===0?'Mengingat':'', i===0, (i+1)+'.', txt)));
  if(d.hasMemperhatikan && d.memperhatikan && d.memperhatikan.length){
    d.memperhatikan.forEach((txt,i)=> blocks.push(fieldRowItemHtml(i===0?'Memperhatikan':'', i===0, (i+1)+'.', txt)));
  }
  blocks.push(`<div class="memutuskan-hd">MEMUTUSKAN :</div>`);
  blocks.push(`<div class="field-row"><div class="lbl">Menetapkan</div><div class="colon">:</div><div class="val menetapkan-val">${nl2br(d.menetapkan||'')}</div></div>`);
  const diktumItems = d.diktum.length? d.diktum: [{label:'KESATU',text:'...'}];
  diktumItems.forEach(dk=> blocks.push(`<div class="diktum-line"><div class="lbl">${escapeHtml(dk.label)}</div><div class="colon">:</div><div class="val">${nl2br(dk.text)}</div></div>`));
  blocks.push(buildSignBlockHtml(d, kop, true, sigBase64));
  blocks.push(buildTembusanBlockHtml(d));
  return blocks;
}
function lampHeadRow(lbl, val){
  return `<div class="lh-row"><div class="lh-lbl">${escapeHtml(lbl)}</div><div class="lh-colon">:</div><div class="lh-val">${val}</div></div>`;
}
function buildLampiranHeaderHtml(d, kop){
  const jab = escapeHtml((d.jabatanKop||kop.jabatanKepala||'').toUpperCase());
  let rows = '';
  if(d.lampiranJudul){
    // judul kustom: baris "LABEL : isi" disejajarkan titik duanya; baris lain ditampilkan apa adanya
    d.lampiranJudul.split(/\n+/).forEach(line=>{
      const m = line.match(/^\s*([^:]{1,30}?)\s*:\s*(.*)$/);
      rows += m ? lampHeadRow(m[1], escapeHtml(m[2])) : `<div class="lh-row"><div class="lh-val">${escapeHtml(line)}</div></div>`;
    });
  } else {
    rows += lampHeadRow('LAMPIRAN', 'KEPUTUSAN '+jab);
    rows += lampHeadRow('NOMOR', escapeHtml(d.nomor||'...')+' TAHUN '+escapeHtml(d.tahun||'...'));
    rows += lampHeadRow('TANGGAL', formatTanggalIndo(d.tanggal));
  }
  let html = `<div class="lamp-page-head">${rows}</div>`;
  html += `<div class="lamp-title">${escapeHtml(d.tentang||'')}</div>`;
  return html;
}
function buildLampiranPages(d, kop, sigBase64){
  const headerHtml = buildLampiranHeaderHtml(d, kop);
  const cols = d.lampiranKolom;
  const rows = d.lampiranBaris.length? d.lampiranBaris: [cols.map(()=>'')];
  const theadHtml = `<tr>${cols.map(c=>`<th>${escapeHtml(c)}</th>`).join('')}</tr>`;
  const rowHtmls = rows.map(r=>`<tr>${r.map(c=>`<td>${escapeHtml(c)}</td>`).join('')}</tr>`);

  const zone = document.getElementById('measureZone');
  zone.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'measure-page';
  wrap.innerHTML = `<table class="doc-table"><thead>${theadHtml}</thead><tbody>${rowHtmls.join('')}</tbody></table>`;
  zone.appendChild(wrap);
  const theadH = wrap.querySelector('thead').offsetHeight;
  const rowHeights = Array.from(wrap.querySelectorAll('tbody tr')).map(tr=>tr.offsetHeight);
  zone.innerHTML = '';

  const footerHtml = buildSignBlockHtml(d, kop, false, sigBase64);
  const footerH = measureBlocksHeights([footerHtml])[0];
  const availableFull = pageInnerHeightPx();
  const headerH = measureBlocksHeights([headerHtml])[0];

  const pages = [];
  let idx = 0, isFirst = true;
  while(idx < rowHeights.length){
    const avail = (isFirst? availableFull-headerH : availableFull) - theadH;
    let used = 0; const chunkRows = [];
    while(idx < rowHeights.length && (used + rowHeights[idx] <= avail || chunkRows.length===0)){
      chunkRows.push(rowHtmls[idx]); used += rowHeights[idx]; idx++;
    }
    let blocksHtml = `<table class="doc-table"><thead>${theadHtml}</thead><tbody>${chunkRows.join('')}</tbody></table>`;
    let footerAppended = false;
    if(idx >= rowHeights.length){
      const remaining = avail - used;
      if(remaining >= footerH){ blocksHtml += footerHtml; footerAppended = true; }
    }
    pages.push({header: isFirst? headerHtml: null, blocksHtml});
    isFirst = false;
    if(idx >= rowHeights.length && !footerAppended){
      pages.push({header: null, blocksHtml: footerHtml});
    }
  }
  if(rowHeights.length===0){
    pages.push({header: headerHtml, blocksHtml: `<table class="doc-table"><thead>${theadHtml}</thead><tbody></tbody></table>` + footerHtml});
  }
  return pages;
}

/* ---- footer: page number on every page; QR + verification code + honest disclaimer only once signed (tte provided) ---- */
function buildPageFooterHtml(pageNum, total, tte){
  let html = `<div class="page-footer"><div class="pf-num">Halaman ${pageNum} dari ${total}</div>`;
  if(tte){
    html += `<div class="pf-verif"><img class="pf-qr" src="${tte.qrUrl}"><div class="pf-vtext">Kode verifikasi elektronik: <b>${escapeHtml(tte.verifKode)}</b> &middot; Diterbitkan ${escapeHtml(tte.waktu)}${tte.verifyUrl?`<div class="pf-url">Verifikasi keaslian: ${escapeHtml(tte.verifyUrl)}</div>`:''}<div class="pf-disclaimer">${tte.bsre?BSRE_DISCLAIMER:TTE_DISCLAIMER}</div></div></div>`;
  }
  html += `</div>`;
  return html;
}

/* ---- assembles the whole document into ready-to-render .page divs ----
   opts: { sigBase64, tte:{verifKode, qrUrl, waktu} } — tte is only passed once the document is actually being signed/published. */
function buildAllPages(d, kop, opts){
  opts = opts || {};
  const skHeader = buildSkHeaderHtml(d, kop);
  const skBlocks = buildSkBodyBlocks(d, kop, opts.sigBase64);
  let allPages = layoutPages(skHeader, skBlocks);
  if(d.hasLampiran){
    allPages = allPages.concat(buildLampiranPages(d, kop, opts.sigBase64));
  }
  const total = allPages.length;
  return allPages.map((p,i)=>{
    const inner = (p.header||'') + p.blocksHtml + buildPageFooterHtml(i+1, total, opts.tte);
    return `<div class="page">${inner}</div>`;
  });
}


function renderPreview(){
  if(!CURRENT_USER) return;
  const d = collectFormData();
  const kop = DB.kops.find(k=>k.id===d.kopId) || {pemerintah:'',kecamatan:'',kelurahan:'',logo:LOGO_B64};
  $('previewMount').innerHTML = buildAllPages(d, kop, {sigBase64: DB.signature}).join('');
}
document.addEventListener('input', e=>{
  if(e.target.closest('#view-buat')) renderPreview();
});

/* ============================================================
   TTE — signature pad, uploads, storage
============================================================ */

/* ============================================================
   TTE — signature pad, uploads, storage
============================================================ */

function initSigCanvas(){
  const c = document.getElementById('sigCanvas');
  const ratio = window.devicePixelRatio||1;
  const resize = ()=>{
    const rect = c.getBoundingClientRect();
    if(!rect.width || !rect.height) return false; // tampilan TTE sedang tersembunyi
    c.width = rect.width*ratio; c.height = rect.height*ratio;
    const ctx = c.getContext('2d'); ctx.scale(ratio,ratio);
    ctx.lineWidth=2.2; ctx.lineCap='round'; ctx.strokeStyle='#1a2a6b';
    return true;
  };
  window._sigResize = ()=>{ if(!c.width || c.width<20) resize(); };
  resize();
  let drawing=false, last=null;
  const pos = ev=>{
    const rect = c.getBoundingClientRect();
    const t = ev.touches? ev.touches[0]: ev;
    return {x:t.clientX-rect.left, y:t.clientY-rect.top};
  };
  const start = ev=>{ drawing=true; last=pos(ev); ev.preventDefault(); };
  const move = ev=>{
    if(!drawing) return;
    const p = pos(ev); const ctx = c.getContext('2d');
    ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke();
    last = p; ev.preventDefault();
  };
  const end = ()=>{ drawing=false; };
  c.addEventListener('mousedown',start); c.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
  c.addEventListener('touchstart',start,{passive:false}); c.addEventListener('touchmove',move,{passive:false}); c.addEventListener('touchend',end);
}
function clearSigCanvas(){
  const c = document.getElementById('sigCanvas'); const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
}

async function saveSignatureFromCanvas(){
  const c = $('sigCanvas');
  const blank = !c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3 && v!==0);
  if(blank){ toast('Kanvas masih kosong. Gambar tanda tangan terlebih dahulu.', 'err'); return; }
  let b64;
  try{ b64 = await downscaleDataUrl(c.toDataURL('image/png'), 700); }
  catch(e){ toast(Api.msg(e), 'err'); return; }
  await storeSignature(b64);
}
async function storeSignature(b64){
  const r = await guarded('Menyimpan tanda tangan...', ()=>Api.call('saveSignature', {signature:b64}));
  if(!r) return;
  DB.signature = b64;
  toast('Tanda tangan tersimpan untuk akun ini.', 'ok');
  loadSavedSignaturePreview(); renderPreview();
}

async function handleSigUpload(ev){
  const f = ev.target.files[0]; if(!f) return;
  try{ await storeSignature(await fileToPngBase64(f, 700)); }
  catch(e){ toast(Api.msg(e), 'err'); }
  ev.target.value = '';
}
async function removeSignature(){
  if(!confirm('Hapus tanda tangan tersimpan untuk akun ini?')) return;
  const r = await guarded('Menghapus tanda tangan...', ()=>Api.call('deleteSignature', {}));
  if(!r) return;
  DB.signature = null; loadSavedSignaturePreview(); renderPreview();
  toast('Tanda tangan dihapus.', 'ok');
}

function loadSavedSignaturePreview(){
  const el = $('sigSavedPreview');
  if(DB.signature){
    el.innerHTML = `<img src="data:image/png;base64,${DB.signature}" style="max-height:70px;background:#fff;border:1px solid var(--border);border-radius:6px;padding:4px;"><div class="small-muted">Tanda tangan aktif untuk akun ${escapeHtml(CURRENT_USER? CURRENT_USER.username:'')}.</div>
      <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="removeSignature()">Hapus tanda tangan</button>`;
  } else {
    el.innerHTML = 'Belum ada tanda tangan tersimpan untuk akun ini.';
  }
}

/* ---- util gambar: perkecil & ubah ke PNG agar muat di Google Sheets ---- */
function loadImage(src){
  return new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=()=>rej(new Error('File gambar tidak dapat dibaca.')); i.src=src; });
}
async function downscaleDataUrl(dataUrl, maxDim){
  const img = await loadImage(dataUrl);
  const k = Math.min(1, maxDim/Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width*k)), h = Math.max(1, Math.round(img.height*k));
  const cv = document.createElement('canvas'); cv.width=w; cv.height=h;
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  let b64 = cv.toDataURL('image/png').split(',')[1];
  if(b64.length > 480000) throw new Error('Gambar terlalu kompleks/besar. Gunakan gambar yang lebih sederhana atau perkecil ukurannya.');
  return b64;
}
function fileToPngBase64(file, maxDim){
  return new Promise((res,rej)=>{
    if(!/^image\//.test(file.type)) return rej(new Error('File harus berupa gambar (PNG/JPG).'));
    if(file.size > 8*1024*1024) return rej(new Error('Ukuran file terlalu besar (maks. 8 MB).'));
    const r = new FileReader();
    r.onerror = ()=>rej(new Error('File tidak dapat dibaca.'));
    r.onload = ()=>downscaleDataUrl(r.result, maxDim).then(res, rej);
    r.readAsDataURL(file);
  });
}
/* ============================================================
   PUBLISH FLOW: verification code -> QR -> PDF
============================================================ */
async function sha256Hex(str){
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function makeQrDataUrl(text){
  return new Promise(resolve=>{
    const zone = document.getElementById('qrHiddenZone');
    zone.innerHTML = '';
    const holder = document.createElement('div');
    zone.appendChild(holder);
    /* eslint-disable no-undef */
    new QRCode(holder, {text:text, width:180, height:180, correctLevel: QRCode.CorrectLevel.M});
    setTimeout(()=>{
      const canvas = holder.querySelector('canvas');
      const img = holder.querySelector('img');
      let url;
      if(canvas) url = canvas.toDataURL('image/png');
      else if(img) url = img.src;
      resolve(url);
    }, 120);
  });
}


function openTteConfirm(){
  const d = collectFormData();
  if(!d.nomor || !d.tentang){ toast('Isi minimal Nomor SK dan Tentang sebelum menerbitkan.', 'err'); return; }
  if(!d.kopId){ toast('Pilih kop surat terlebih dahulu.', 'err'); return; }
  if(!DB.signature){
    if(!confirm('Anda belum mengatur tanda tangan elektronik untuk akun ini. Terbitkan PDF tanpa tanda tangan (hanya kop, isi, dan kode verifikasi)?')) {
      goto('tte'); return;
    }
  }
  publishSk();
}

function upsertDoc(rec){
  const i = DB.docs.findIndex(x=>x.id===rec.id);
  if(i>=0) DB.docs[i]=rec; else DB.docs.push(rec);
}
async function saveDraft(){
  const d = collectFormData();
  if(!d.nomor && !d.tentang){ toast('Isi minimal Nomor SK atau Tentang sebelum menyimpan draf.', 'err'); return; }
  const rec = await guarded('Menyimpan draf...', ()=>Api.call('saveDraft', {doc:Object.assign({id:EDITING_DOC_ID||undefined}, d)}));
  if(!rec) return;
  upsertDoc(rec); EDITING_DOC_ID = rec.id;
  toast('Draf SK tersimpan ke Riwayat.', 'ok');
  refreshDashboard(); renderRiwayat();
}

function verifyUrlFor(kode){
  const cfg = window.SIPAKEM_CONFIG || {};
  let base = cfg.PUBLIC_URL || (location.origin + location.pathname.replace(/[^\/]*$/, ''));
  if(!/\/$/.test(base)) base += '/';
  return base + 'verifikasi.html?kode=' + encodeURIComponent(kode);
}
function formatWaktu(iso){
  try{ return new Date(iso).toLocaleString('id-ID', {dateStyle:'long', timeStyle:'short'}); }catch(e){ return iso; }
}

async function publishSk(){
  const useBsre = !!(DB.bsre && DB.bsre.enabled);
  let cred = null;
  if(useBsre){
    cred = await askBsre('Terbitkan & Tandatangani dengan BSrE');
    if(!cred) return;
  }
  showProgress('Menerbitkan SK & membuat kode verifikasi...');
  let rec = null;
  try{
    const d = collectFormData();
    const kop = DB.kops.find(k=>k.id===d.kopId);
    if(!kop) throw new Error('Pilih kop surat terlebih dahulu.');
    const doc = Object.assign({id:EDITING_DOC_ID||undefined}, d);
    try{
      rec = await Api.call('publishDoc', {doc, bsre:useBsre});
    }catch(e){
      if(e.code==='DUPLICATE'){
        hideProgress();
        if(!confirm(e.message+'\n\nTetap terbitkan dengan nomor yang sama?')) return;
        showProgress('Menerbitkan SK...');
        rec = await Api.call('publishDoc', {doc, force:true, bsre:useBsre});
      } else throw e;
    }
    upsertDoc(rec); EDITING_DOC_ID = null;
    refreshDashboard(); renderRiwayat();

    if(rec.tteStatus==='bsre_pending'){
      await signWithBsre(rec, kop, cred, DB.signature);
    } else {
      showProgress('Membuat kode QR verifikasi...');
      const verifyUrl = verifyUrlFor(rec.verifKode);
      const qrUrl = await makeQrDataUrl(verifyUrl);
      showProgress('Menyusun tata letak halaman...');
      try{
        await renderDocToPdfAndSave(rec, kop, {sigBase64: DB.signature, tte:{verifKode:rec.verifKode, qrUrl, waktu:formatWaktu(rec.signedAt), verifyUrl}}, rec.filename);
        toast('SK berhasil diterbitkan & diunduh sebagai PDF.', 'ok');
      }catch(pdfErr){
        console.error(pdfErr);
        toast('SK sudah tersimpan (kode '+rec.verifKode+'), tetapi PDF gagal dibuat. Unduh ulang dari Riwayat.', 'err');
      }
    }
    suggestNextNomor();
  }catch(err){
    console.error(err);
    if(err.code!=='AUTH') toast(Api.msg(err), 'err');
  }finally{
    if(cred) cred.passphrase = null;
    hideProgress();
  }
}

/* ============================================================
   TTE BSrE — NIK + passphrase hanya di memori, dikirim sekali, tidak disimpan
============================================================ */
function askBsre(title){
  return new Promise(resolve=>{
    const m = $('bsreModal');
    $('bsre_title').textContent = title || 'Tanda Tangan Elektronik BSrE';
    let savedNik = ''; try{ savedNik = sessionStorage.getItem('sipakem_nik')||''; }catch(e){}
    $('bsre_nik').value = savedNik; $('bsre_pass').value = '';
    $('bsreError').style.display='none'; $('bsreInfo').textContent='';
    m.classList.add('show');
    setTimeout(()=>($('bsre_nik').value? $('bsre_pass'): $('bsre_nik')).focus(), 50);
    const done = v=>{ m.classList.remove('show'); $('bsre_pass').value=''; resolve(v); };
    const submit = ()=>{
      const nik = $('bsre_nik').value.replace(/\s/g,''), pass = $('bsre_pass').value;
      const err = $('bsreError');
      if(!/^\d{16}$/.test(nik)){ err.textContent='NIK harus 16 digit angka.'; err.style.display='block'; return; }
      if(!pass){ err.textContent='Passphrase wajib diisi.'; err.style.display='block'; return; }
      try{ sessionStorage.setItem('sipakem_nik', nik); }catch(e){}
      done({nik, passphrase:pass});
    };
    $('bsreOk').onclick = submit;
    $('bsreCancel').onclick = ()=>done(null);
    $('bsre_pass').onkeydown = e=>{ if(e.key==='Enter') submit(); };
  });
}
async function checkBsreStatus(){
  const nik = $('bsre_nik').value.replace(/\s/g,'');
  const info = $('bsreInfo'), err = $('bsreError'); err.style.display='none';
  if(!/^\d{16}$/.test(nik)){ err.textContent='Isi NIK 16 digit terlebih dahulu.'; err.style.display='block'; return; }
  info.textContent = 'Memeriksa status sertifikat...';
  try{
    const r = await Api.call('bsreStatus', {nik});
    info.textContent = 'Status sertifikat: ' + (typeof r.status==='object' ? JSON.stringify(r.status) : r.status);
  }catch(e){ info.textContent=''; err.textContent=Api.msg(e); err.style.display='block'; }
}

/* Render PDF lalu kirim ke BSrE untuk ditandatangani; PDF bertanda tangan langsung diunduh. */
async function signWithBsre(rec, kop, cred, sigBase64){
  try{
    showProgress('Membuat PDF & kode QR verifikasi...');
    const verifyUrl = verifyUrlFor(rec.verifKode);
    const qrUrl = await makeQrDataUrl(verifyUrl);
    const pdf = await renderDocToPdf(rec, kop, {sigBase64, tte:{verifKode:rec.verifKode, qrUrl, waktu:formatWaktu(rec.signedAt), verifyUrl, bsre:true}});
    const b64 = pdfToBase64(pdf);
    showProgress('Menandatangani dengan sertifikat BSrE...');
    const r = await Api.call('bsreSign', {docId:rec.id, nik:cred.nik, passphrase:cred.passphrase, pdf:b64});
    cred.passphrase = null;
    rec.tteStatus = 'bsre'; rec.bsre = {idDokumen:r.idDokumen};
    upsertDoc(rec); refreshDashboard(); renderRiwayat();
    downloadBase64Pdf(r.pdf, rec.filename);
    toast('SK ditandatangani dengan sertifikat BSrE & diunduh.', 'ok');
  }catch(e){
    console.error(e);
    cred.passphrase = null;
    if(e.code==='AUTH') throw e;
    toast('SK sudah diterbitkan (kode '+rec.verifKode+') tetapi TTE BSrE belum berhasil: '+Api.msg(e)+' — Anda dapat mencoba lagi dari menu Riwayat. Hati-hati: passphrase yang salah berulang kali dapat memblokir akun TTE.', 'err');
  }
}
async function retryBsreSign(id){
  const d = DB.docs.find(x=>x.id===id); if(!d) return;
  const kop = DB.kops.find(k=>k.id===d.kopId); if(!kop){ toast('Kop surat SK ini tidak ditemukan.', 'err'); return; }
  const cred = await askBsre('Tandatangani SK '+d.nomor+'/'+d.tahun+' dengan BSrE');
  if(!cred) return;
  showProgress('Menyiapkan dokumen...');
  try{
    let sig = null;
    try{ const r = await Api.call('getDocSignature', {id}, {retry:true}); sig = r && r.signature; }catch(e){ if(e.code==='AUTH') throw e; }
    await signWithBsre(d, kop, cred, sig);
  }catch(e){ if(e.code!=='AUTH') toast(Api.msg(e), 'err'); }
  finally{ cred.passphrase = null; hideProgress(); }
}
async function downloadBsrePdf(id){
  const d = DB.docs.find(x=>x.id===id); if(!d) return;
  const r = await guarded('Mengunduh PDF dari BSrE...', ()=>Api.call('bsreDownload', {id}));
  if(!r) return;
  downloadBase64Pdf(r.pdf, d.filename || 'SK.pdf');
  toast('PDF bertanda tangan BSrE diunduh.', 'ok');
}
function fileToBase64(file, maxBytes){
  return new Promise((res,rej)=>{
    if(file.size > maxBytes) return rej(new Error('Ukuran file terlalu besar (maks. '+Math.round(maxBytes/1048576)+' MB).'));
    const r = new FileReader();
    r.onerror = ()=>rej(new Error('File tidak dapat dibaca.'));
    r.onload = ()=>res(String(r.result).split('base64,')[1]);
    r.readAsDataURL(file);
  });
}
async function verifyPdfBsre(ev){
  const f = ev.target.files[0]; ev.target.value=''; if(!f) return;
  const out = $('bsreVerifyOut'); out.textContent='';
  try{
    const b64 = await fileToBase64(f, 9*1048576);
    const r = await guarded('Memeriksa tanda tangan di BSrE...', ()=>Api.call('bsreVerify', {pdf:b64}));
    if(!r) return;
    out.textContent = typeof r.result==='object' && r.result.raw===undefined ? JSON.stringify(r.result, null, 2) : (r.result.raw||'');
  }catch(e){ toast(Api.msg(e), 'err'); }
}
function renderBsreInfo(){
  const el = $('bsreStatusInfo'); if(!el) return;
  el.innerHTML = DB.bsre.enabled
    ? '<span class="badge badge-ok">Aktif</span> SK baru akan ditandatangani dengan sertifikat BSrE (NIK &amp; passphrase diminta saat menerbitkan).'
    : '<span class="badge badge-warn">Belum aktif</span> Aplikasi memakai TTE internal (jejak audit). Untuk mengaktifkan BSrE, isi Script Properties di Apps Script (lihat README bagian TTE BSrE).';
  $('bsreVerifyCard').classList.toggle('hidden', !DB.bsre.enabled);
}
/* Renders the paginated document (signature image + footer verification already baked into
   the HTML by buildAllPages) into #pdfRenderZone, rasterizes each real page individually
   (no slicing -> no stray blank pages), and saves the PDF. */

async function renderDocToPdf(d, kop, opts){
  const zone = document.getElementById('pdfRenderZone');
  zone.innerHTML = buildAllPages(d, kop, opts).join('');
  await new Promise(r=>setTimeout(r, 150)); // let DOM paint (fonts, images)
  showProgress('Merender PDF...');
  try{
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({orientation:'portrait', unit:'mm', format:[PAGE_W_MM, PAGE_H_MM]});
    const pageEls = zone.querySelectorAll('.page');
    for(let i=0;i<pageEls.length;i++){
      await addPageImage(pdf, pageEls[i], i===0);
    }
    return pdf;
  } finally { zone.innerHTML = ''; }
}
async function renderDocToPdfAndSave(d, kop, opts, filename){
  const pdf = await renderDocToPdf(d, kop, opts);
  pdf.save(filename);
}
function pdfToBase64(pdf){
  const uri = pdf.output('datauristring');
  return uri.slice(uri.indexOf('base64,')+7);
}
function downloadBase64Pdf(b64, filename){
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], {type:'application/pdf'}));
  const a = document.createElement('a'); a.href=url; a.download=filename||'dokumen.pdf';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 10000);
}
/* Each .page div is already bounded to F4 height by the pagination engine above,
   so every page is rasterized once and dropped straight onto its own PDF page. */
async function addPageImage(pdf, el, isFirstPage){
  const canvas = await html2canvas(el, {scale:2, backgroundColor:'#ffffff', useCORS:true, windowWidth: el.scrollWidth});
  const imgData = canvas.toDataURL('image/jpeg', 0.85);
  if(!isFirstPage) pdf.addPage();
  pdf.addImage(imgData, 'JPEG', 0, 0, PAGE_W_MM, PAGE_H_MM);
}
function slug(s){ return s.trim().split(/\s+/).slice(0,6).join('_'); }

/* ============================================================
   RIWAYAT
============================================================ */

function renderRiwayat(){
  const q = ($('riwayatSearch') ? $('riwayatSearch').value : '').trim().toLowerCase();
  const stf = $('riwayatStatus') ? $('riwayatStatus').value : '';
  const all = DB.docs.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const docs = all.filter(d=>{
    if(stf && d.status!==stf) return false;
    if(!q) return true;
    return [d.nomor, d.tahun, d.tentang, d.verifKode].join(' ').toLowerCase().includes(q);
  });
  const tb = document.querySelector('#riwayatTable tbody'); tb.innerHTML='';
  $('riwayatEmpty').classList.toggle('hidden', docs.length>0);
  $('riwayatEmpty').lastChild.textContent = all.length ? 'Tidak ada SK yang cocok dengan pencarian.' : 'Belum ada SK yang dibuat.';
  docs.forEach(d=>{
    const kop = DB.kops.find(k=>k.id===d.kopId);
    const tr = document.createElement('tr');
    const id = escapeHtml(d.id);
    const statusHtml = statusBadge(d) + (d.status==='signed' ? `<br><span class="small-muted">${escapeHtml(d.verifKode||'')}</span>` : '');
    let downloadBtn = '';
    if(d.status==='signed'){
      if(d.tteStatus==='bsre') downloadBtn = `<button class="btn btn-gold btn-sm" onclick="downloadBsrePdf('${id}')">Unduh PDF (BSrE)</button>`;
      else if(d.tteStatus==='bsre_pending') downloadBtn = DB.bsre.enabled ? `<button class="btn btn-gold btn-sm" onclick="retryBsreSign('${id}')">Tandatangani BSrE</button>` : '';
      else downloadBtn = `<button class="btn btn-gold btn-sm" onclick="redownloadDoc('${id}')">Unduh ulang PDF</button>`;
    }
    tr.innerHTML = `<td>${escapeHtml(d.nomor)}/${escapeHtml(d.tahun)}</td><td>${escapeHtml(d.tentang)}</td>
      <td>${kop?escapeHtml(kop.kelurahan):'-'}</td><td>${formatTanggalIndo(d.tanggal)}</td>
      <td>${statusHtml}</td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="loadDocToForm('${id}')">${d.status==='signed'?'Buka salinan':'Lanjutkan edit'}</button>
        ${downloadBtn}
        <button class="btn btn-danger btn-sm" onclick="deleteDoc('${id}')">Hapus</button>
      </td>`;
    tb.appendChild(tr);
  });
}

function loadDocToForm(id){
  const d = DB.docs.find(x=>x.id===id);
  if(!d) return;
  selectedKopId = d.kopId; selectedTplId = d.templateId;
  EDITING_DOC_ID = d.status==='draft' ? d.id : null; // SK terbit hanya bisa disalin, bukan diubah
  goto('buat');
  loadKopPicker(); loadTplPicker();
  $('f_nomor').value=d.nomor||'';
  $('f_tahun').value=d.tahun||'';
  $('f_jabatanKop').value=d.jabatanKop||'';
  $('f_tentang').value=d.tentang||'';
  $('f_menetapkan').value=d.menetapkan||'';
  $('f_ditetapkanDi').value=d.ditetapkanDi||'';
  $('f_tanggal').value=d.tanggal||'';
  fillListEditor('menimbang', d.menimbang||[]);
  fillListEditor('mengingat', d.mengingat||[]);
  fillListEditor('tembusan', d.tembusan||[]);
  fillDiktumEditor(d.diktum||[]);
  $('f_hasMemperhatikan').checked = !!d.hasMemperhatikan;
  fillListEditor('memperhatikan', d.memperhatikan||[]);
  toggleMemperhatikan();
  $('f_ttdJabatan').value=d.ttdJabatan||'';
  $('f_ttdNama').value=d.ttdNama||'';
  $('f_ttdNip').value=d.ttdNip||'';
  $('f_hasLampiran').checked = !!d.hasLampiran;
  $('f_lampJudul').value = d.lampiranJudul||'';
  window._lampCols = (d.lampiranKolom||['NO','NAMA','JABATAN','KETERANGAN']).slice();
  window._lampRows = (d.lampiranBaris||[]).map(r=>r.slice());
  toggleLampiran(); renderLampTable(); renderPreview();
  toast(d.status==='draft' ? 'Draf dimuat. Perubahan akan memperbarui draf yang sama.' : 'SK terbit dimuat sebagai salinan baru. SK asli tidak berubah.', 'ok');
}

async function redownloadDoc(id){
  const d = DB.docs.find(x=>x.id===id);
  if(!d) return;
  showProgress('Menyusun ulang PDF...');
  try{
    const kop = DB.kops.find(k=>k.id===d.kopId) || {};
    let sig = null;
    try{ const r = await Api.call('getDocSignature', {id}, {retry:true}); sig = r && r.signature; }
    catch(e){ if(e.code==='AUTH') throw e; console.warn('Tanda tangan dokumen tidak dapat diambil', e); }
    const verifyUrl = verifyUrlFor(d.verifKode);
    const qrUrl = await makeQrDataUrl(verifyUrl);
    await renderDocToPdfAndSave(d, kop, {sigBase64: sig, tte:{verifKode:d.verifKode, qrUrl, waktu:formatWaktu(d.signedAt), verifyUrl}}, d.filename || `SK_${d.nomor}_${d.tahun}.pdf`);
    toast('PDF diunduh ulang.', 'ok');
  }catch(err){ console.error(err); if(err.code!=='AUTH') toast('Gagal membuat ulang PDF: '+Api.msg(err), 'err'); }
  finally{ hideProgress(); }
}

async function deleteDoc(id){
  const d = DB.docs.find(x=>x.id===id);
  if(!confirm('Hapus riwayat SK ini?'+(d && d.status==='signed' ? '\n\nSK ini sudah diterbitkan: kode verifikasinya tidak akan valid lagi.' : '')+'\n(File PDF yang sudah diunduh tidak terpengaruh)')) return;
  const r = await guarded('Menghapus SK...', ()=>Api.call('deleteDoc', {id}));
  if(!r) return;
  DB.docs = DB.docs.filter(x=>x.id!==id);
  if(EDITING_DOC_ID===id) EDITING_DOC_ID = null;
  renderRiwayat(); refreshDashboard();
  toast('SK dihapus.', 'ok');
}
/* ============================================================
   BOOT
============================================================ */
$('loginPass').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
$('loginUser').addEventListener('keydown', e=>{ if(e.key==='Enter') $('loginPass').focus(); });
['pw_old','pw_new','pw_new2'].forEach(id=>$(id).addEventListener('keydown', e=>{ if(e.key==='Enter') submitPwChange(); }));
window.addEventListener('offline', ()=>$('netBanner').classList.add('show'));
window.addEventListener('online', ()=>$('netBanner').classList.remove('show'));
if(navigator.onLine===false) $('netBanner').classList.add('show');

(async function boot(){
  if(!Api.configured()){
    $('configWarn').classList.remove('hidden');
    $('loginBtn').disabled = true;
    return;
  }
  if(Api.hasToken()){
    showProgress('Memulihkan sesi...');
    try{
      await loadAll(); enterApp();
      if(CURRENT_USER.mustChange) openPwModal(true);
    }catch(e){
      console.error(e);
      Api.setToken(null);
      if(e.code!=='AUTH') showLoginError(Api.msg(e));
    }finally{ hideProgress(); }
  }
})();
