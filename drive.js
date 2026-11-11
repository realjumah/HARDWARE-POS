/* drive.js - hourly backup of the shop data to the owner's Google Drive.
 *
 *   How it works
 *   - Uses Google sign-in (Google Identity Services) and the Drive "drive.file" permission, which lets the app see ONLY
 *     the files it created itself. Nothing else in the Drive is read.
 *   - Writes into a Drive folder "Okpotani Backups": one file "Okpotani-backup-latest.json" (updated every hour; Drive keeps
 *     older versions) and one file per day "Okpotani-backup-YYYY-MM-DD.json".
 *   - The file is the same backup you get from Setup > Download backup, so it can be restored with Setup > Restore from backup.
 *
 *   Limits (the browser cannot do more than this)
 *   - It runs only while the app is open on a device that has been connected. A closed app cannot back up.
 *   - Google's access pass lasts about an hour. The app asks for a fresh one quietly; if the browser blocks that, a banner
 *     appears and one tap anywhere finishes it.
 *   - The device needs internet. One-time setup of a free Google client ID is needed (see README-DRIVE.txt).
 *
 *   Public API: gdHtml() for the Setup card, gdBanner() for the Home banner, gdBackup(true) to back up now.
 */
(function(){
'use strict';
const KEY='okp_gd',SCOPE='https://www.googleapis.com/auth/drive.file',FOLDER='Okpotani Backups',HOUR=36e5;
const S=(()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){return{}}})();
const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}};
let tok=null,tokExp=0,tc=null,busy=false,err='',need=false;
const E=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cid=()=>(window.db&&db.shop&&db.shop.gdClient)||S.cid||'';
const when=t=>{if(!t)return'never';const d=new Date(t),n=new Date(),hm=d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});return d.toDateString()==n.toDateString()?'today '+hm:d.toLocaleDateString('en-GB')+' '+hm};
function redraw(){try{if(window.st&&st.tab=='set'&&!document.querySelector('#md:not(.hide)')&&!document.activeElement?.matches?.('input,textarea,select'))render();else if(window.st&&st.tab=='home')render()}catch(e){}}
function setErr(m){err=m||'';redraw()}

/* ---------- Google sign-in ---------- */
function gsi(ok,bad){if(window.google&&google.accounts&&google.accounts.oauth2)return ok();
 const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.onload=ok;s.onerror=()=>bad('Could not reach Google. Check the internet connection.');document.head.appendChild(s)}
let pend=null;
function getToken(interactive){return new Promise((res,rej)=>{
 if(tok&&Date.now()<tokExp)return res(tok);
 if(!cid())return rej(new Error('Enter your Google client ID first.'));
 if(pend){const o=pend;pend=null;o.rej(new Error('A newer request replaced this one.'))}
 pend={res,rej};
 gsi(()=>{try{
   if(!tc||tc._cid!==cid()){tc=google.accounts.oauth2.initTokenClient({client_id:cid(),scope:SCOPE,callback:r=>{const p=pend;pend=null;if(!p)return;
     if(r&&r.access_token){tok=r.access_token;tokExp=Date.now()+Math.max(60,(r.expires_in||3600)-120)*1000;p.res(tok)}else p.rej(new Error((r&&r.error)||'Google did not give access.'))},
     error_callback:e=>{const p=pend;pend=null;if(p)p.rej(new Error((e&&e.type)||'The Google window was closed or blocked.'))}});tc._cid=cid()}
   tc.requestAccessToken({prompt:interactive?(S.granted?'':'consent'):''})
 }catch(e){const p=pend;pend=null;if(p)p.rej(e)}},m=>{const p=pend;pend=null;if(p)p.rej(new Error(m))})})}

/* ---------- Drive calls ---------- */
async function api(url,o,retry){const h=Object.assign({Authorization:'Bearer '+tok},o&&o.headers||{});
 const r=await fetch(url,Object.assign({},o,{headers:h}));
 if(r.status==401&&!retry){tok=null;tokExp=0;await getToken(false);return api(url,o,true)}
 if(!r.ok){let m='';try{m=(await r.json()).error.message}catch(e){}throw new Error('Drive said '+r.status+(m?': '+m:''))}
 return r.json()}
async function folderId(){if(S.folder)return S.folder;
 const q=encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name='"+FOLDER+"' and trashed=false"),f=await api('https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id)');
 if(f.files&&f.files[0])S.folder=f.files[0].id;else{const c=await api('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:FOLDER,mimeType:'application/vnd.google-apps.folder'})});S.folder=c.id}
 persist();return S.folder}
async function findFile(name,folder){const q=encodeURIComponent("name='"+name+"' and '"+folder+"' in parents and trashed=false"),f=await api('https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id)');return f.files&&f.files[0]?f.files[0].id:null}
async function put(name,content,folder,id){
 const meta=id?{name}:{name,parents:[folder],mimeType:'application/json'},b='okpbnd'+Date.now();
 const body='--'+b+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(meta)+'\r\n--'+b+'\r\nContent-Type: application/json\r\n\r\n'+content+'\r\n--'+b+'--';
 const u='https://www.googleapis.com/upload/drive/v3/files'+(id?'/'+id:'')+'?uploadType=multipart&fields=id';
 return api(u,{method:id?'PATCH':'POST',headers:{'Content-Type':'multipart/related; boundary='+b},body})}
const sig=s=>{let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return s.length+':'+h};

/* ---------- the backup itself ---------- */
async function backup(interactive,force){
 if(busy)return;if(!S.on)return;busy=true;err='';
 try{
  const json=JSON.stringify(db),sg=sig(json);
  if(!force&&S.sig===sg&&S.up&&Date.now()-S.up<6*HOUR){S.last=Date.now();persist();return}
  await getToken(interactive);const folder=await folderId(),day=td();
  if(!S.latest)S.latest=await findFile('Okpotani-backup-latest.json',folder);
  const r1=await put('Okpotani-backup-latest.json',json,folder,S.latest);S.latest=r1.id;
  if(S.dayDate!==day){S.dayId=await findFile('Okpotani-backup-'+day+'.json',folder);S.dayDate=day}
  const r2=await put('Okpotani-backup-'+day+'.json',json,folder,S.dayId);S.dayId=r2.id;
  S.last=Date.now();S.up=S.last;S.sig=sg;S.granted=1;need=false;err='';persist();
  try{toast('Backed up to Google Drive ✓')}catch(e){}
 }catch(e){
  need=true;err=e&&e.message?e.message:'Backup to Google Drive failed.';
  if(/blocked|closed|popup|access_denied|interaction|immediate/i.test(err))err='Google needs a tap to continue. Tap the banner on Home, or Back up now in Setup.';
 }finally{busy=false;redraw()}}
window.gdBackup=function(i){return backup(true,!!i)};

/* ---------- schedule: check every minute while the app is open ---------- */
function due(){return S.on&&cid()&&(!S.last||Date.now()-S.last>=HOUR)&&navigator.onLine!==false}
function tick(){if(!due()||busy)return;
 if(!tok||Date.now()>=tokExp){ /* quiet refresh first; if the browser blocks it, wait for the next tap */
  backup(false).then(()=>{if(need&&due())armTap()});return}
 backup(false)}
let armed=false;
function armTap(){if(armed)return;armed=true;const f=()=>{armed=false;document.removeEventListener('pointerdown',f,true);if(due())backup(true)};document.addEventListener('pointerdown',f,true)}
setInterval(tick,60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(tick,1500)});
window.addEventListener('online',()=>setTimeout(tick,1500));
setTimeout(tick,8000);

/* ---------- Setup card and Home banner ---------- */
window.gdSaveId=function(){const v=(document.getElementById('gdid')||{}).value||'';const id=v.trim();
 if(id&&!/\.apps\.googleusercontent\.com$/.test(id))return alert('That does not look like a client ID. It ends with .apps.googleusercontent.com');
 S.cid=id;if(db.shop)db.shop.gdClient=id;persist();try{save()}catch(e){}tc=null;try{window.toast('Client ID saved')}catch(e){}render()};
window.gdConnect=function(){if(!cid())return alert('Enter your Google client ID first.');S.on=1;persist();backup(true,true)};
window.gdOff=function(){if(!confirm('Stop backing up to Google Drive on this device? Existing backup files stay in your Drive.'))return;
 try{if(tok&&window.google&&google.accounts.oauth2)google.accounts.oauth2.revoke(tok,()=>{})}catch(e){}tok=null;tokExp=0;S.on=0;need=false;err='';persist();render()};
window.gdHtml=function(){const c=cid(),on=!!S.on;
 let h='<h3>Google Drive backup</h3><div class="item" style="cursor:default;display:block">';
 if(!c)h+='<small>Backs up your shop data to your own Google Drive every hour while the app is open. One-time setup: create a free Google client ID (steps are in README-DRIVE.txt), then paste it here.</small><label>Google client ID</label><input id="gdid" placeholder="123456789-abc.apps.googleusercontent.com" autocomplete="off"><button class="btn" onclick="gdSaveId()">Save client ID</button>';
 else{h+='<b>'+(on?'Auto backup is ON for this device':'Auto backup is OFF')+'</b><small style="display:block;margin-top:4px">Last backup: '+when(S.last)+(on&&S.last?' · next about '+when(S.last+HOUR).replace('today ',''):'')+'</small>';
  if(err)h+='<small style="display:block;margin-top:6px;color:var(--bad)">'+E(err)+'</small>';
  h+=on?'<button class="btn big" onclick="gdBackup(true)">Back up now</button><button class="btn del" onclick="gdOff()">Turn off on this device</button>':'<button class="btn big" onclick="gdConnect()">Connect Google Drive</button>';
  h+='<small style="display:block;margin-top:8px">Folder in your Drive: '+FOLDER+'. The app can only see files it made itself. It backs up only while the app is open, and needs internet. Restore with Setup → Restore from backup.</small><button class="btn" onclick="gdChange()">Change client ID</button>'}
 return h+'</div>'};
window.gdChange=function(){S.cid='';if(db.shop)db.shop.gdClient='';S.on=0;tok=null;tokExp=0;persist();try{save()}catch(e){}render()};
window.gdBanner=function(){if(!S.on||!need)return'';return'<button class="item" style="border-left:4px solid var(--acc2)" onclick="gdBackup(true)"><span class="nm"><b>Google Drive backup is waiting</b><small>Tap here to finish the hourly backup. '+(err?E(err):'')+'</small></span></button>'};
window.gdState=function(){return{on:!!S.on,busy,need,err,tokenValid:!!tok&&Date.now()<tokExp,last:S.last||0,due:!!due()}};
window.gdRecent=function(){return !!(S.on&&S.last&&Date.now()-S.last<27*HOUR)};
})();
