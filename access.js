/* Okpotani staff, roles, PIN lock and audit log.
 *
 * Works on top of the existing app (index.html) and cloud.js. Nothing here replaces existing data:
 *  - db.SF   staff records (name, phone, role, hashed PIN)           -> synced by cloud.js
 *  - db.perm which switches the owner changed for Manager/Attendant   -> synced (small top-level doc)
 *  - db.sec  lock time and the hashed owner recovery code             -> synced (small top-level doc)
 *  - db.AU   audit log, one record per phone per day (recent 60 days) -> synced
 *  - db.AA   audit archive, one record per phone per month (older)    -> synced
 *  - db.staff (the old "served by" names) is kept in step with the active staff, so everything that used it still works.
 *
 * Honest limits are written in ACCESS-NOTES.md: this is a shop-floor lock inside the browser, not bank-grade security.
 */
(function(){
'use strict';
if(window.okpAcc)return;

/* ---------------------------------------------------------------- small helpers */
const $=s=>document.querySelector(s);
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ls={get(k,d){try{const v=localStorage.getItem(k);return v===null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const p2=n=>String(n).padStart(2,'0');
const ymd=t=>{const d=new Date(t);return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())};
const hm=t=>{const d=new Date(t);return p2(d.getHours())+':'+p2(d.getMinutes())};
const money=n=>Math.round(+n||0).toLocaleString('en-US');
const rndHex=n=>{const a=new Uint8Array(n);(window.crypto||{getRandomValues:x=>{for(let i=0;i<x.length;i++)x[i]=Math.floor(Math.random()*256)}}).getRandomValues(a);return Array.from(a,b=>p2(b.toString(16))).join('')};
const LK={last:'okp_acc_last',lock:'okp_acc_lock',seq:'okp_au_seq',prev:'okp_au_prev',dev:'okp_dev',arch:'okp_au_archday'};
const DEV=(()=>{let d=ls.get(LK.dev,'');if(!d){d=rndHex(3);ls.set(LK.dev,d)}return d})();

/* SHA-256 (synchronous): used for the audit chain and as the PIN fallback when WebCrypto is not available. */
const SK=[],SH=[];(function(){let n=2,c=0;while(c<64){let p=true;for(let i=2;i*i<=n;i++)if(n%i===0){p=false;break}if(p){SK.push((Math.pow(n,1/3)%1)*4294967296|0);if(c<8)SH.push((Math.pow(n,.5)%1)*4294967296|0);c++}n++}})();
function sha256(str){
  const b=unescape(encodeURIComponent(str)),l=b.length,w=[];
  for(let i=0;i<l;i++)w[i>>2]|=b.charCodeAt(i)<<(24-(i%4)*8);
  w[l>>2]|=0x80<<(24-(l%4)*8);w[(((l+8)>>6)<<4)+15]=l*8;for(let i=0;i<w.length;i++)w[i]|=0;
  const H=SH.slice();
  for(let j=0;j<w.length;j+=16){
    const x=w.slice(j,j+16),a=H.slice();
    for(let i=0;i<64;i++){
      if(i>=16){const g0=x[i-15],g1=x[i-2];x[i]=(x[i-16]+(((g0>>>7)|(g0<<25))^((g0>>>18)|(g0<<14))^(g0>>>3))+x[i-7]+(((g1>>>17)|(g1<<15))^((g1>>>19)|(g1<<13))^(g1>>>10)))|0}
      const e=a[4],t1=(a[7]+(((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)))+((e&a[5])^(~e&a[6]))+SK[i]+x[i])|0;
      const z=a[0],t2=((((z>>>2)|(z<<30))^((z>>>13)|(z<<19))^((z>>>22)|(z<<10)))+((z&a[1])^(z&a[2])^(a[1]&a[2])))|0;
      a.pop();a.unshift((t1+t2)|0);a[4]=(a[4]+t1)|0;
    }
    for(let i=0;i<8;i++)H[i]=(H[i]+a[i])|0;
  }
  return H.map(v=>(v>>>0).toString(16).padStart(8,'0')).join('');
}
/* PIN hashing: PBKDF2-SHA256 (100,000 rounds, its own random salt per person). */
const ITER=100000;
async function kdf(secret,salt,kv){
  secret=String(secret);salt=String(salt);
  if(kv!=='f1'&&window.crypto&&crypto.subtle&&window.TextEncoder){
    const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),'PBKDF2',false,['deriveBits']);
    const b=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:ITER},k,256);
    return Array.from(new Uint8Array(b),x=>p2(x.toString(16))).join('');
  }
  if(kv==='p1')throw new Error('This phone cannot check PINs here. Open the app from its https address.');
  let h=sha256(salt+':'+secret);for(let i=0;i<4000;i++)h=sha256(h+salt+secret);return h;
}
const KV=()=>(window.crypto&&crypto.subtle&&window.TextEncoder)?'p1':'f1';
const sameStr=(a,b)=>{a=String(a);b=String(b);if(a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0};
async function hashPin(pin,u){const kv=KV(),sl=rndHex(12);return{sl,kv,ph:await kdf(pin,sl+':'+u,kv)}}
async function checkPin(pin,u){if(!u||!u.ph)return false;return sameStr(await kdf(pin,u.sl+':'+u.id,u.kv||'p1'),u.ph)}
function mkCode(){const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const a=new Uint8Array(12);crypto.getRandomValues(a);let s='';for(let i=0;i<12;i++){s+=A[a[i]%A.length];if(i%4===3&&i<11)s+='-'}return s}
const normCode=c=>String(c||'').toUpperCase().replace(/[^A-Z0-9]/g,'');

/* ---------------------------------------------------------------- data access */
const ROLES=[['owner','Owner'],['manager','Manager'],['attendant','Attendant']];
const RL=r=>(ROLES.find(x=>x[0]===r)||[0,r])[1];
const SF=()=>(db.SF=db.SF||[]);
const act=u=>u&&u.active!==false;
const on=()=>SF().some(u=>u.role==='owner'&&act(u)&&u.ph);
const names=()=>SF().filter(act).map(u=>u.name);
function syncNames(){db.staff=names()}
let cur=null,lastAct=Date.now();
const me=()=>cur;

/* ---------------------------------------------------------------- permissions */
// [key, label, help, manager default, attendant default]
const PERMS=[
['sell','Make sales','Ring up customers, print receipts, bits journal',1,1],
['credit_pay','Receive customer payments','Take part-payments on credit receipts',1,1],
['view_stock','View stock and prices','See products, stock levels and selling prices',1,1],
['see_cost','See buying prices','Buying (cost) price on products and in Check a price',1,0],
['see_profit','See profit','Profit figures, profit report and margins',1,0],
['discount','Give discounts','Change the price of an item while selling',1,0],
['edit_receipt','Edit receipts','Add or change items on a saved receipt',1,0],
['delete_receipt','Delete receipts','Remove a saved receipt',1,0],
['returns','Returns and refunds','Take goods back and refund customers',1,0],
['expenses','Record expenses','Add, edit and see expenses',1,0],
['purchases','Purchases and suppliers','Record stock arriving and pay suppliers',1,0],
['edit_stock','Edit stock','Add or edit products and prices, stock take, stock adjustment',1,0],
['customers','Customers, orders, advances','Edit customers and credit limits, orders, advances',1,0],
['reports','Reports and cash book','Reports, cash book, closing the day, assistant',1,0],
['export','Export and share','Excel, PDF and price list sharing',1,0],
['backup','Download backups','Make a backup copy of the data',1,0]];
const DEF={};PERMS.forEach(p=>{DEF[p[0]]={manager:p[3],attendant:p[4]}});
const OWN=['staff','settings','audit','restore','cloud'];   // owner only, cannot be switched on for others
function can(p){
  if(!on())return true;                // before the owner has been set up the app behaves as before (the setup screen blocks it anyway)
  if(!cur)return false;
  if(cur.role==='owner')return true;
  if(OWN.indexOf(p)>=0)return false;
  const o=db.perm&&db.perm[cur.role];
  if(o&&Object.prototype.hasOwnProperty.call(o,p))return !!o[p];
  const d=DEF[p];return !!(d&&d[cur.role]);
}
function permOf(role,p){
  if(role==='owner')return true;
  const o=db.perm&&db.perm[role];
  if(o&&Object.prototype.hasOwnProperty.call(o,p))return !!o[p];
  return !!DEF[p][role];
}
function deny(m){try{toast(m||'Your role cannot do that')}catch(e){}return false}

const TAB={sell:'sell',stock:'view_stock',price:'view_stock',sa:'edit_stock',rep:'reports',profit:'see_profit',close:'reports',cls:'reports',set:'settings',staff:'staff',audit:'audit',ai:'reports'};
const SUB={buy:'purchases',exp:'expenses',rt:'returns',cr:'credit_pay',adv:'customers',sup:'purchases',ord:'customers',jn:'sell',cb:'reports'};
const SUBORDER=['hub','cr','jn','buy','exp','rt','adv','sup','ord','cb'];
function tabOk(t,s){
  if(!on())return true;if(!cur)return false;
  if(t==='ai')return can('reports')&&can('see_profit')&&can('see_cost');   // the assistant can answer with cost and profit figures
  let p=TAB[t];if(t==='money'&&s&&SUB[s])p=SUB[s];
  return !p||can(p);
}
function subOk(k){const p=SUB[k];return !p||can(p)}
function route(t,s){if(tabOk(t,s))return true;deny();return false}
const CARD={sales:'sell',stock:'view_stock',stockP:'view_stock',reorder:'view_stock',take:'edit_stock',adjust:'edit_stock',credit:'credit_pay',orders:'customers',journal:'sell',close:'reports',rd:'reports',price:'view_stock',returns:'returns',buy:'purchases',exp:'expenses',adv:'customers',sup:'purchases',cash:'reports',profit:'see_profit',reports:'reports',rm:'reports',backup:'backup'};
function cards(C){const o={};for(const k in C){const p=CARD[k];o[k]=(!p||can(p))?C[k]:''}return o}
const MORE={'Reports':'reports','Bits journal':'sell','Customer orders':'customers','Returns & refunds':'returns','Low stock & reorder':'view_stock','Stock take':'edit_stock','Stock adjustment':'edit_stock','Cash book':'reports','Price list':'view_stock','Setup':'settings','Ask the assistant':'reports','Staff & roles':'staff','Audit log':'audit'};
const SEC={'Receipts':'sell','Products':'view_stock','People & suppliers':'customers','Purchases':'purchases','Expenses':'expenses','Advances':'customers','Owner drawings & transfers':'reports','Journal':'sell','Cash book':'reports','Pre-orders':'customers'};
function corpus(C){
  if(!on()||!cur||cur.role==='owner')return C;
  return C.filter(c=>{
    if(c.sec==='Payments')return can(/^Payment to/.test(c.title)?'purchases':'credit_pay');
    const p=SEC[c.sec];return !p||can(p);
  });
}
function more(R){return R.filter(r=>{const p=MORE[r[1]];return !p||can(p)})}

/* Called at the start of every render(): lock screen when nobody is signed in, and keep the screen inside the role. */
function gate(){
  if(cloudMode)return true;
  if(!on()){showSetup();return false}
  if(!cur){showLock();return false}
  if(typeof st!=='undefined'){
    if(!tabOk(st.tab,st.sub)){
      if(st.tab==='money'){const s=SUBORDER.find(k=>k==='hub'||subOk(k));st.sub=s||'hub';if(!tabOk('money',st.sub))st.tab='home'}
      else{st.tab='home'}
    }
  }
  return true;
}

/* ---------------------------------------------------------------- AUDIT LOG */
// code -> [icon, label, group]
const ACT={
login:['🔓','Signed in','login'],login_fail:['⚠️','Wrong PIN','login'],locked_out:['⛔','Locked after wrong PINs','login'],pin_change:['🔑','PIN changed','login'],pin_reset:['🔑','PIN reset by owner','login'],recovery:['🛟','Owner PIN recovered','login'],
sale_edit:['✏️','Receipt edited','sales'],sale_delete:['🗑','Receipt deleted','sales'],discount:['🏷','Discount given','sales'],return:['↩️','Return recorded','sales'],return_rev:['↩️','Return reversed','sales'],bulk_change:['📦','Many records changed at once','sales'],
price_change:['💲','Selling price changed','price'],cost_change:['💲','Buying price changed','price'],product_add:['➕','Product added','price'],product_delete:['🗑','Product deleted','price'],product_edit:['✏️','Product renamed','price'],
stock_adjust:['🛠','Stock adjusted','stock'],stock_adjust_rev:['🛠','Stock adjustment reversed','stock'],stock_open:['🛠','Opening stock changed','stock'],stock_take:['📋','Stock take','stock'],purchase_add:['📥','Stock arrival recorded','stock'],purchase_edit:['📥','Stock arrival edited','stock'],purchase_delete:['📥','Stock arrival deleted','stock'],
expense_add:['💸','Expense added','money'],expense_edit:['💸','Expense edited','money'],expense_delete:['💸','Expense deleted','money'],credit_payment:['💳','Credit payment received','money'],credit_payment_removed:['💳','Credit payment removed','money'],credit_limit:['💳','Credit limit changed','money'],customer_add:['👤','Customer added','money'],customer_delete:['👤','Customer deleted','money'],advance:['💵','Customer advance','money'],cash_entry:['🏦','Cash book entry','money'],
day_close:['🔒','Day closed','money'],day_reopen:['🔓','Day reopened','money'],backup:['💾','Backup made','system'],restore:['♻️','Backup restored','system'],settings:['⚙️','Setting changed','system'],
staff_add:['👥','Staff added','staff'],staff_edit:['👥','Staff edited','staff'],staff_disable:['👥','Staff disabled','staff'],staff_enable:['👥','Staff enabled','staff'],staff_delete:['👥','Staff deleted','staff'],role_change:['🛡','Role or permission changed','staff']};
const GROUPS=[['','All actions'],['login','Logins and PINs'],['sales','Sales and returns'],['price','Prices and products'],['stock','Stock'],['money','Expenses, credit and cash'],['staff','Staff and roles'],['system','Backups and settings']];
const actLabel=a=>(ACT[a]||['•',a,'system'])[1];
const actIcon=a=>(ACT[a]||['•'])[0];
const actGroup=a=>(ACT[a]||[0,0,'system'])[2];

let seq=+ls.get(LK.seq,0)||0,prevK=String(ls.get(LK.prev,''));
function actor(){return cur?{id:cur.id,name:cur.name,role:cur.role}:{id:'',name:'(nobody signed in)',role:''}}
function mkEntry(a,s,b,f,who){
  const e={q:++seq,t:Date.now(),u:who.id||'',n:who.name||'',r:who.role||'',a,s:String(s||'').slice(0,300)};
  if(b&&Object.keys(b).length)e.b=b;if(f&&Object.keys(f).length)e.f=f;
  e.k=chainK(prevK,e);prevK=e.k;ls.set(LK.seq,seq);ls.set(LK.prev,prevK);return e;
}
const chainK=(pk,e)=>sha256(pk+'|'+DEV+'|'+e.q+'|'+e.t+'|'+e.u+'|'+e.a+'|'+e.s+'|'+JSON.stringify(e.b||'')+'|'+JSON.stringify(e.f||'')).slice(0,16);
function chunkFor(t){
  const d=ymd(t);let n=1;
  for(;;){
    const id='A'+d.replace(/-/g,'')+'.'+DEV+(n>1?'.'+n:'');
    const c=(db.AU=db.AU||[]).find(x=>x.id===id);
    if(!c){const nc={id,d,dv:DEV,e:[]};db.AU.push(nc);return nc}
    if(c.e.length<300)return c;
    n++;
  }
}
function log(a,s,b,f,who){const e=mkEntry(a,s,b,f,who||actor());chunkFor(e.t).e.push(e);return e}
let inPre=false;
function persist(){if(!inPre&&typeof save==='function')save()}
function note(a,s,b,f,who){log(a,s,b,f,who);persist()}

/* Everything the audit log can read, newest first (live records and monthly archives together). */
function allEntries(){
  const out=[],seen=new Set();
  const add=c=>(c.e||[]).forEach(e=>{const k=(c.dv||'')+':'+e.q;if(seen.has(k))return;seen.add(k);out.push(Object.assign({dv:c.dv||''},e))});
  (db.AU||[]).forEach(add);(db.AA||[]).forEach(add);
  out.sort((a,b)=>b.t-a.t||b.q-a.q);return out;
}
/* Keep the live log light: months that are completely older than 60 days move into one archive record per phone per month. */
function archive(){
  try{
    if(!db.AU||!db.AU.length)return;
    const co=new Date();co.setDate(co.getDate()-60);const cut=ymd(co);
    const g={};
    db.AU.forEach(c=>{if(c.dv!==DEV)return;const m=c.d.slice(0,7),y=+m.slice(0,4),mo=+m.slice(5,7),last=ymd(new Date(y,mo,0).getTime());if(last<cut)(g[m]=g[m]||[]).push(c)});
    const ms=Object.keys(g);if(!ms.length)return;
    if(!db.AA)db.AA=[];
    ms.forEach(m=>{
      const id='M'+m.replace('-','')+'.'+DEV;let r=db.AA.find(x=>x.id===id);
      if(!r){r={id,m,dv:DEV,e:[]};db.AA.push(r)}
      const have=new Set(r.e.map(e=>e.q));
      g[m].forEach(c=>c.e.forEach(e=>{if(!have.has(e.q)){r.e.push(e);have.add(e.q)}}));
      r.e.sort((a,b)=>a.q-b.q);
    });
    const gone=new Set();ms.forEach(m=>g[m].forEach(c=>gone.add(c.id)));
    db.AU=db.AU.filter(c=>!gone.has(c.id));
    persist();
  }catch(e){console.warn('audit archive',e)}
}
/* Tamper check: every entry carries a hash of the one before it (per phone). */
function verify(){
  const by={};allEntries().forEach(e=>{(by[e.dv]=by[e.dv]||[]).push(e)});
  let n=0;const bad=[];
  Object.keys(by).forEach(dv=>{
    const L=by[dv].sort((a,b)=>a.q-b.q);
    L.forEach((e,i)=>{
      n++;
      const p=i>0?L[i-1]:null;
      if(!p&&e.q===1&&chainK('',e)!==e.k)bad.push(e);
      else if(p&&p.q===e.q-1&&chainK(p.k,e)!==e.k)bad.push(e);
    });
  });
  return{n,bad};
}

/* ---- change detection: compare the records before and after every save, so every screen (even files added later) is covered ---- */
const TRACK=['S','P','U','X','CU','R','AD','ST','A','M','C'];
const STAMP=['S','U','X','R','AD','ST','A','M'];
const BULK=25;
let snap=null;
const cy=s=>{let h1=0xdeadbeef,h2=0x41c6ce57;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677)}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return(h2>>>0).toString(36)+(h1>>>0).toString(36)};
const itemTxt=r=>(r.items||[]).map(i=>i.n+' ×'+i.q+' @'+money(i.p)).join('; ').slice(0,300);
function sm(c,r){
  switch(c){
    case'S':{const ps=(r.pays||[]).reduce((a,p)=>a+(+p.a||0),0);return{no:r.no,tot:(r.items||[]).reduce((a,i)=>a+i.q*i.p,0),cust:r.cust||'',pay:r.pay||'',date:r.date||'',by:r.by||'',ps,it:itemTxt(r)}}
    case'P':return{name:r.name,price:+r.price||0,cost:+r.cost||0,open:+r.open||0};
    case'U':return{n:r.n,q:r.q,c:r.c,sup:r.sup||'',date:r.date||''};
    case'X':return{type:r.type||'',desc:r.desc||'',amt:+r.amt||0,date:r.date||''};
    case'CU':return{name:r.name||'',limit:+r.limit||0};
    case'R':return{no:r.no,val:+r.val||0,cust:r.cust||'',rev:!!r.rev};
    case'AD':return{n:r.n,q:r.q,r:r.r||'',rev:!!r.rev};
    case'ST':return{st:r.st||'',nl:(r.lines||[]).length};
    case'A':return{cust:r.cust||'',amt:+r.amt||0,desc:r.desc||''};
    case'M':return{kind:r.kind||'',amt:+r.amt||0,date:r.date||''};
    case'C':return{date:r.date||'',cc:+r.cc||0,by:r.by||'',dv:+r.dv||0};
  }
  return{};
}
function takeSnap(){
  const s={};
  TRACK.forEach(c=>{const m=new Map();(db[c]||[]).forEach(r=>{if(r&&r.id!=null)m.set(String(r.id),{h:cy(JSON.stringify(r)),m:sm(c,r)})});s[c]=m});
  return s;
}
function rebase(){snap=on()?takeSnap():null}
function remote(keys){   // changes that arrived from another phone belong to that phone's log, not ours
  try{
    if(!snap)return;
    (keys||[]).forEach(key=>{
      const i=String(key).indexOf(':');if(i<0)return;const c=key.slice(0,i),k=key.slice(i+1);
      if(c==='SF'){recheckSession();return}
      if(!snap[c])return;
      const r=(db[c]||[]).find(x=>x&&String(x.id)===k);
      if(r)snap[c].set(k,{h:cy(JSON.stringify(r)),m:sm(c,r)});else snap[c].delete(k);
    });
    if(!on()&&!cur)return;
  }catch(e){}
}
const disc=r=>{let d=0;const L=[];(r.items||[]).forEach(i=>{const p=(db.P||[]).find(x=>x.name===i.n);if(p&&p.price>0&&i.p<p.price&&i.q>0){d+=(p.price-i.p)*i.q;L.push(i.n+' ×'+i.q+': '+money(p.price)+' → '+money(i.p))}});return{d,L}};
function report(ch,who){
  const E1=(a,s,b,f)=>log(a,s,b,f,who);
  const big=(c,x)=>{const n=x.add.length+x.chg.length+x.del.length;return n>BULK};
  const label={S:'receipts',P:'products',U:'stock arrivals',X:'expenses',CU:'customers',R:'returns',AD:'stock adjustments',ST:'stock takes',A:'advances',M:'cash book entries',C:'day closings'};
  Object.keys(ch).forEach(c=>{
    const x=ch[c];
    if(big(c,x)){
      let extra='';
      if(c==='S'&&x.del.length)extra=' · '+x.del.length+' receipts deleted, UGX '+money(x.del.reduce((a,d)=>a+d[1].tot,0));
      E1('bulk_change',x.add.length+' added, '+x.chg.length+' changed, '+x.del.length+' removed ('+label[c]+')'+extra,{records:x.del.length+x.chg.length},{records:x.add.length});
      return;
    }
    if(c==='S'){
      x.del.forEach(([k,m])=>E1('sale_delete','Receipt #'+m.no+' deleted · UGX '+money(m.tot)+(m.cust?' · '+m.cust:''),{receipt:'#'+m.no,total:'UGX '+money(m.tot),customer:m.cust||'Walk-in',payment:m.pay,date:m.date,served_by:m.by,items:m.it}));
      x.add.forEach(([k,m,r])=>{const d=disc(r);if(d.d>0)E1('discount','Receipt #'+m.no+' · discount UGX '+money(d.d),{list_price_total:'UGX '+money(m.tot+d.d)},{sold_for:'UGX '+money(m.tot),lines:d.L.join('; ')})});
      x.chg.forEach(([k,o,n,r])=>{
        if(n.ps>o.ps+0.001)E1('credit_payment','UGX '+money(n.ps-o.ps)+' from '+(n.cust||'customer')+' · receipt #'+n.no,{paid_before:'UGX '+money(o.ps)},{paid_after:'UGX '+money(n.ps)});
        else if(n.ps<o.ps-0.001)E1('credit_payment_removed','UGX '+money(o.ps-n.ps)+' removed · receipt #'+n.no,{paid_before:'UGX '+money(o.ps)},{paid_after:'UGX '+money(n.ps)});
        const b={},f={};
        if(o.tot!==n.tot){b.total='UGX '+money(o.tot);f.total='UGX '+money(n.tot)}
        if(o.cust!==n.cust){b.customer=o.cust||'Walk-in';f.customer=n.cust||'Walk-in'}
        if(o.pay!==n.pay){b.payment=o.pay;f.payment=n.pay}
        if(o.date!==n.date){b.date=o.date;f.date=n.date}
        if(o.by!==n.by){b.served_by=o.by||'-';f.served_by=n.by||'-'}
        if(o.it!==n.it){b.items=o.it;f.items=n.it}
        if(Object.keys(f).length)E1('sale_edit','Receipt #'+n.no+' edited · UGX '+money(o.tot)+(o.tot!==n.tot?' → UGX '+money(n.tot):''),b,f);
        if(o.it!==n.it){const d=disc(r),d0=disc({items:parseIt(o.it)});if(d.d>0&&d.d>d0.d+0.001)E1('discount','Receipt #'+n.no+' · discount UGX '+money(d.d),null,{sold_for:'UGX '+money(n.tot),lines:d.L.join('; ')})}
      });
    }else if(c==='P'){
      x.add.forEach(([k,m])=>E1('product_add',m.name+' added · price UGX '+money(m.price),null,{price:'UGX '+money(m.price),buying:'UGX '+money(m.cost)}));
      x.del.forEach(([k,m])=>E1('product_delete',m.name+' deleted',{price:'UGX '+money(m.price),buying:'UGX '+money(m.cost),opening_stock:m.open}));
      x.chg.forEach(([k,o,n])=>{
        if(o.price!==n.price)E1('price_change',n.name+' · selling price UGX '+money(o.price)+' → '+money(n.price),{price:'UGX '+money(o.price)},{price:'UGX '+money(n.price)});
        if(o.cost!==n.cost)E1('cost_change',n.name+' · buying price UGX '+money(o.cost)+' → '+money(n.cost),{buying:'UGX '+money(o.cost)},{buying:'UGX '+money(n.cost)});
        if(o.open!==n.open)E1('stock_open',n.name+' · opening stock '+o.open+' → '+n.open,{opening_stock:o.open},{opening_stock:n.open});
        if(o.name!==n.name)E1('product_edit','Renamed '+o.name+' → '+n.name,{name:o.name},{name:n.name});
      });
    }else if(c==='U'){
      x.add.forEach(([k,m])=>E1('purchase_add',m.n+' ×'+m.q+' @ UGX '+money(m.c)+(m.sup?' · '+m.sup:'')));
      x.del.forEach(([k,m])=>E1('purchase_delete',m.n+' ×'+m.q+' @ UGX '+money(m.c)+(m.sup?' · '+m.sup:''),{product:m.n,quantity:m.q,unit_cost:'UGX '+money(m.c),supplier:m.sup,date:m.date}));
      x.chg.forEach(([k,o,n])=>E1('purchase_edit',n.n+' · '+o.q+' @ '+money(o.c)+' → '+n.q+' @ '+money(n.c),{quantity:o.q,unit_cost:'UGX '+money(o.c),supplier:o.sup},{quantity:n.q,unit_cost:'UGX '+money(n.c),supplier:n.sup}));
    }else if(c==='X'){
      x.add.forEach(([k,m])=>E1('expense_add',(m.desc||m.type)+' · UGX '+money(m.amt),null,{type:m.type,amount:'UGX '+money(m.amt),date:m.date}));
      x.del.forEach(([k,m])=>E1('expense_delete',(m.desc||m.type)+' · UGX '+money(m.amt),{type:m.type,description:m.desc,amount:'UGX '+money(m.amt),date:m.date}));
      x.chg.forEach(([k,o,n])=>E1('expense_edit',(n.desc||n.type)+' · UGX '+money(o.amt)+' → '+money(n.amt),{type:o.type,description:o.desc,amount:'UGX '+money(o.amt),date:o.date},{type:n.type,description:n.desc,amount:'UGX '+money(n.amt),date:n.date}));
    }else if(c==='CU'){
      x.add.forEach(([k,m])=>E1('customer_add',m.name+(m.limit?' · credit limit UGX '+money(m.limit):''),null,{credit_limit:'UGX '+money(m.limit)}));
      x.del.forEach(([k,m])=>E1('customer_delete',m.name,{credit_limit:'UGX '+money(m.limit)}));
      x.chg.forEach(([k,o,n])=>{if(o.limit!==n.limit)E1('credit_limit',n.name+' · credit limit UGX '+money(o.limit)+' → '+money(n.limit),{credit_limit:'UGX '+money(o.limit)},{credit_limit:'UGX '+money(n.limit)})});
    }else if(c==='R'){
      x.add.forEach(([k,m])=>E1('return','Return R-'+m.no+' · UGX '+money(m.val)+(m.cust?' · '+m.cust:'')));
      x.chg.forEach(([k,o,n])=>{if(!o.rev&&n.rev)E1('return_rev','Return R-'+n.no+' reversed · UGX '+money(n.val))});
    }else if(c==='AD'){
      if(x.add.length>=8)E1('stock_adjust',x.add.length+' stock adjustments recorded together (stock take)',null,{lines:x.add.length});
      else x.add.forEach(([k,m])=>E1('stock_adjust',m.n+' · '+(m.q>0?'+':'')+m.q+(m.r?' · '+m.r:'')));
      x.chg.forEach(([k,o,n])=>{if(!o.rev&&n.rev)E1('stock_adjust_rev',n.n+' · '+(n.q>0?'+':'')+n.q+' reversed')});
    }else if(c==='ST'){
      x.add.concat(x.chg.map(a=>[a[0],a[2]])).forEach(([k,m])=>{const o=x.chg.find(z=>z[0]===k);if(m.st==='posted'&&(!o||o[1].st!=='posted'))E1('stock_take','Stock take posted · '+m.nl+' lines')});
    }else if(c==='A'){
      x.add.forEach(([k,m])=>E1('advance',(m.cust||'Customer')+' · UGX '+money(m.amt)+(m.desc?' · '+m.desc:'')));
      x.del.forEach(([k,m])=>E1('advance','Deleted: '+(m.cust||'Customer')+' · UGX '+money(m.amt),{amount:'UGX '+money(m.amt)}));
    }else if(c==='C'){
      x.add.forEach(([k,m])=>E1('day_close','Day '+m.date+' closed · counted UGX '+money(m.cc)+(m.dv?' · '+(m.dv<0?'SHORT by ':'OVER by ')+money(Math.abs(m.dv)):' · balanced'),null,{counted:'UGX '+money(m.cc),closed_by:m.by||'-'}));
      x.del.forEach(([k,m])=>E1('day_reopen','Day '+m.date+' reopened (closing removed)',{counted:'UGX '+money(m.cc),closed_by:m.by||'-'}));
    }else if(c==='M'){
      x.add.forEach(([k,m])=>E1('cash_entry',(m.kind||'entry')+' · UGX '+money(m.amt)+' · '+m.date));
      x.del.forEach(([k,m])=>E1('cash_entry','Deleted: '+(m.kind||'entry')+' · UGX '+money(m.amt),{amount:'UGX '+money(m.amt),date:m.date}));
    }
  });
}
function parseIt(t){return String(t||'').split('; ').map(z=>{const m=z.match(/^(.*) ×([\d.]+) @([\d,]+)$/);return m?{n:m[1],q:+m[2],p:+m[3].replace(/,/g,'')}:null}).filter(Boolean)}
/* called by save() before it writes: stamp "served by" on new records and write the audit entries */
function pre(){
  if(inPre)return;
  if(!on()){snap=null;return}
  inPre=true;
  try{
    if(!snap){snap=takeSnap();return}
    const who=actor();
    STAMP.forEach(c=>{if(!snap[c])return;(db[c]||[]).forEach(r=>{if(r&&r.id!=null&&!r.by&&!snap[c].has(String(r.id)))r.by=who.name})});
    const next={},ch={};
    TRACK.forEach(c=>{
      const old=snap[c]||new Map(),nm=new Map(),add=[],chg=[],del=[];
      (db[c]||[]).forEach(r=>{
        if(!r||r.id==null)return;const k=String(r.id),h=cy(JSON.stringify(r)),o=old.get(k),e={h,m:sm(c,r)};nm.set(k,e);
        if(!o)add.push([k,e.m,r]);else if(o.h!==h)chg.push([k,o.m,e.m,r]);
      });
      old.forEach((o,k)=>{if(!nm.has(k))del.push([k,o.m])});
      next[c]=nm;if(add.length||chg.length||del.length)ch[c]={add,chg,del};
    });
    snap=next;
    if(Object.keys(ch).length)report(ch,who);
  }catch(e){console.warn('audit',e)}finally{inPre=false}
}

/* ---------------------------------------------------------------- LOCK SCREEN, LOGIN, SETUP, RECOVERY */
const idleMin=()=>(db.sec&&db.sec.idle!=null)?+db.sec.idle:15;
const MAXTRY=5,LOCKMS=5*60000;
let cloudMode=false;
let L={mode:'pick',sel:null,pin:'',msg:'',step:1,data:{},busy:false};
function css(){
  if($('#okp-acc-css'))return;
  const s=document.createElement('style');s.id='okp-acc-css';
  s.textContent=`
#lk{position:fixed;inset:0;z-index:99999;background:var(--head,#2b2723);color:#fff;overflow:auto;display:flex;flex-direction:column;align-items:center;padding:calc(18px + env(safe-area-inset-top,0px)) 16px calc(18px + env(safe-area-inset-bottom,0px))}
#lk .lkb{width:100%;max-width:340px;margin:auto;text-align:center}
#lk h1{font-size:22px;margin:4px 0 2px;display:block}#lk h1:before{content:none!important;display:none!important}
#lk h2{margin:2px 0 4px;font-size:20px}
#lk .sub{opacity:.78;margin:0 0 14px;font-size:14.5px}
#lk .chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:0 0 14px}
#lk .chip{min-height:48px;padding:8px 16px;border-radius:999px;border:2px solid rgba(255,255,255,.28);background:transparent;color:#fff;font-weight:700;font-size:16px;cursor:pointer}
#lk .chip.on{background:var(--acc,#f28c00);border-color:var(--acc,#f28c00);color:#2a1700}
#lk .dots{display:flex;gap:16px;justify-content:center;margin:8px 0 12px}
#lk .dots i{width:16px;height:16px;border-radius:50%;border:2px solid #fff;display:block}
#lk .dots i.f{background:var(--acc,#f28c00);border-color:var(--acc,#f28c00)}
#lk .msg{min-height:24px;margin:0 0 8px;color:#ffb3a8;font-weight:600;font-size:14.5px}
#lk .pad{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:0 auto 10px;max-width:300px}
#lk .pad button{height:68px;border-radius:20px;border:0;background:rgba(255,255,255,.14);color:#fff;font-size:27px;font-weight:700;cursor:pointer}
#lk .pad button:active{background:var(--acc,#f28c00);color:#2a1700}
#lk .pad button.sm{font-size:20px}
#lk .lnk2{background:none;border:0;color:#ffcf99;font-size:15px;font-weight:600;padding:12px;cursor:pointer;text-decoration:underline}
#lk input{background:var(--card,#fff);color:var(--ink,#22201c);text-align:left}
#lk label{color:rgba(255,255,255,.8);text-align:left}
#lk .btn{background:rgba(255,255,255,.14);color:#fff;border-color:transparent}
#lk .btn.big{background:var(--acc,#f28c00);color:#2a1700}
#lk .code{font:800 26px/1.3 ui-monospace,Menlo,monospace;letter-spacing:2px;background:#fff;color:#000;border-radius:12px;padding:16px 8px;margin:12px 0;user-select:all}
#hu{grid-area:u;min-width:44px;height:44px;padding:0 12px;border:0;border-radius:999px;background:rgba(255,255,255,.12);color:#fff;font-weight:800;font-size:14px;cursor:pointer;display:grid;place-items:center;max-width:110px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
#hu.hide{display:none!important}
.sw{display:flex;align-items:center;justify-content:center;min-width:56px;min-height:44px}
.sw input{width:26px;height:26px;margin:0;accent-color:var(--acc,#f28c00)}
.pm{display:grid;grid-template-columns:1fr 64px 64px;gap:4px 6px;align-items:center;background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:6px 10px;margin-bottom:10px}
.pm .h{font-size:12.5px;font-weight:700;text-align:center;color:var(--mut)}
.pm .pl b{display:block;font-size:14.5px}.pm .pl small{display:block;line-height:1.25}
.pm .al{text-align:center;color:var(--mut);font-size:12.5px}
.aud{background:var(--card);border:1.5px solid var(--line);border-radius:10px;margin-bottom:8px;padding:0 12px}
.aud summary{list-style:none;display:flex;gap:10px;align-items:flex-start;padding:10px 0;cursor:pointer}
.aud summary::-webkit-details-marker{display:none}
.aud .ai{font-size:20px;line-height:1.2}.aud .at{flex:1;min-width:0}.aud .at b{display:block}.aud .at small{display:block}
.aud .dt{padding:0 0 10px 30px;font-size:13.5px}.aud .dt div{margin:2px 0;overflow-wrap:anywhere}
.aud .dt .bf{color:var(--bad)}.aud .dt .af{color:var(--ok)}`;
  document.head.appendChild(s);
}
function ov(){let e=$('#lk');if(!e){e=document.createElement('div');e.id='lk';document.body.appendChild(e)}return e}
const shopName=()=>{const n=(db.shop&&db.shop.name)||'';return n===n.toUpperCase()?n.toLowerCase().replace(/(^|[\s(-])([a-z])/g,(m,a,b)=>a+b.toUpperCase()):n};
const visible=()=>{const e=$('#lk');return !!e&&e.style.display!=='none'&&e.dataset.on==='1'};
function hide(){const e=ov();e.style.display='none';e.dataset.on='0';e.innerHTML=''}
function showLock(){if(visible()&&L.mode!=='setup')return;css();L.mode='pick';L.pin='';L.msg='';L.busy=false;const l=ls.get(LK.last,null),A=SF().filter(act);L.sel=(A.find(u=>u.id===l)||(A.length===1?A[0]:null)||{}).id||null;draw()}
function showSetup(){if(visible()&&L.mode==='setup')return;css();L.mode='setup';L.step=1;L.pin='';L.msg='';L.busy=false;L.data={name:(db.shop&&db.shop.mgr)||'',phone:''};draw()}
const dotsH=()=>'<div class="dots">'+[0,1,2,3].map(i=>'<i class="'+(i<L.pin.length?'f':'')+'"></i>').join('')+'</div>';
const padH=()=>'<div class="pad">'+[1,2,3,4,5,6,7,8,9,'C',0,'⌫'].map(k=>'<button type="button" data-k="'+k+'"'+(k==='C'||k==='⌫'?' class="sm"':'')+' aria-label="'+(k==='C'?'Clear':k==='⌫'?'Delete':k)+'">'+k+'</button>').join('')+'</div>';
const head=(t,s)=>'<h1>'+E(shopName()||'Shop')+'</h1><h2>'+t+'</h2><p class="sub">'+s+'</p>';
function lockInfo(key){const a=ls.get(LK.lock,{})[key]||{n:0,u:0};if(a.u&&a.u<=Date.now())return{n:0,u:0};return a}
function lockSet(key,v){const a=ls.get(LK.lock,{});if(v)a[key]=v;else delete a[key];ls.set(LK.lock,a)}
const mins=ms=>{const s=Math.ceil(ms/1000);return Math.floor(s/60)+':'+p2(s%60)};
function draw(){
  const o=ov();o.style.display='flex';o.dataset.on='1';
  let h='';
  if(L.mode==='pick'){
    const A=SF().filter(act),u=A.find(x=>x.id===L.sel);
    h=head('Who is this?','Choose your name, then enter your 4-digit PIN')
     +'<div class="chips">'+A.map(x=>'<button type="button" class="chip'+(x.id===L.sel?' on':'')+'" data-u="'+E(x.id)+'">'+E(x.name)+'</button>').join('')+'</div>'
     +dotsH()+'<div class="msg" id="lkm">'+E(L.msg)+'</div>'+padH()
     +(u&&u.role==='owner'?'<button type="button" class="lnk2" data-act="forgot">Forgot my PIN</button>':(u?'<small style="opacity:.7;display:block">Forgot your PIN? Ask the owner to reset it.</small>':''));
  }else if(L.mode==='setup'){
    const st1=L.step;
    if(st1===1)h=head('Set up your shop lock','First time only. Create the owner PIN. Your records stay exactly as they are.')
      +'<label>Owner name</label><input id="lkn" value="'+E(L.data.name)+'" autocomplete="off" placeholder="Your name">'
      +'<label>Phone (optional)</label><input id="lkp" type="tel" value="'+E(L.data.phone)+'" placeholder="07xx xxx xxx">'
      +'<div class="msg" id="lkm">'+E(L.msg)+'</div><button type="button" class="btn big" data-act="s1">Continue</button>'
      +'<button type="button" class="lnk2" data-act="cloud">This shop already uses the cloud on another phone? Connect first</button>';
    else if(st1===2||st1===3)h=head(st1===2?'Create your PIN':'Repeat your PIN',st1===2?'Choose 4 digits you will remember':'Enter the same 4 digits again')+dotsH()+'<div class="msg" id="lkm">'+E(L.msg)+'</div>'+padH();
    else h=head('Write down your recovery code','If you ever forget the owner PIN, this code lets you set a new one. It is shown only once. Keep it on paper somewhere safe, not in this phone.')
      +'<div class="code">'+E(L.data.code)+'</div><button type="button" class="btn big" data-act="s4">I have written it down</button>';
  }else if(L.mode==='recover'){
    const s=L.step;
    if(s==='choose')h=head('Owner PIN recovery','Choose how to prove you are the owner')
      +'<button type="button" class="btn big" data-act="rcode">Use my recovery code</button><button type="button" class="btn" data-act="rcloud">Use my cloud account password (needs internet)</button><button type="button" class="lnk2" data-act="back">Back</button>';
    else if(s==='code')h=head('Recovery code','Type the code you wrote down at setup')+'<input id="lkc" autocapitalize="characters" autocomplete="off" placeholder="XXXX-XXXX-XXXX"><div class="msg" id="lkm">'+E(L.msg)+'</div><button type="button" class="btn big" data-act="rcodego">Check code</button><button type="button" class="lnk2" data-act="back">Back</button>';
    else if(s==='cloud')h=head('Cloud account','Enter the password of the owner\u2019s cloud account')+'<input id="lkc" type="password" autocomplete="current-password" placeholder="Cloud password"><div class="msg" id="lkm">'+E(L.msg)+'</div><button type="button" class="btn big" data-act="rcloudgo">Check password</button><button type="button" class="lnk2" data-act="back">Back</button>';
    else if(s==='new1'||s==='new2')h=head(s==='new1'?'Choose a new PIN':'Repeat the new PIN',s==='new1'?'4 digits':'Enter it again')+dotsH()+'<div class="msg" id="lkm">'+E(L.msg)+'</div>'+padH();
    else if(s==='done')h=head('New recovery code','The old code no longer works. Write this one down.')+'<div class="code">'+E(L.data.code)+'</div><button type="button" class="btn big" data-act="rdone">I have written it down</button>';
  }
  o.innerHTML='<div class="lkb">'+h+'</div>';
  tickLock();
}
function setMsg(m){L.msg=m;const e=$('#lkm');if(e)e.textContent=m}
function updDots(){const d=$('#lk .dots');if(d)d.outerHTML=dotsH()}
let tkTimer=null;
function tickLock(){
  clearInterval(tkTimer);
  if(L.mode!=='pick'||!L.sel)return;
  const f=()=>{const i=lockInfo(L.sel);if(i.u>Date.now())setMsg('Too many wrong PINs. Try again in '+mins(i.u-Date.now()));else if(L.msg.indexOf('Too many')===0)setMsg('')};
  f();tkTimer=setInterval(()=>{if(!visible()||L.mode!=='pick'){clearInterval(tkTimer);return}f()},1000);
}
const weak=p=>/^(\d)\1{3}$/.test(p)||p==='1234'||p==='4321'||p==='0123'||p==='2580';
async function onPin(){
  const pin=L.pin;L.pin='';
  if(L.mode==='pick')return doLogin(pin);
  if(L.mode==='setup'&&L.step===2){if(weak(pin)){updDots();return setMsg('Too easy to guess. Avoid 1234 or repeated digits.')}L.data.pin1=pin;L.step=3;L.msg='';return draw()}
  if(L.mode==='setup'&&L.step===3){if(pin!==L.data.pin1){L.step=2;L.msg='The two PINs did not match. Start again.';return draw()}return finishSetup()}
  if(L.mode==='recover'&&L.step==='new1'){if(weak(pin)){updDots();return setMsg('Too easy to guess. Avoid 1234 or repeated digits.')}L.data.pin1=pin;L.step='new2';L.msg='';return draw()}
  if(L.mode==='recover'&&L.step==='new2'){if(pin!==L.data.pin1){L.step='new1';L.msg='The two PINs did not match. Start again.';return draw()}return finishRecover()}
}
function padKey(k){
  if(L.busy)return;
  if(k==='C')L.pin='';else if(k==='⌫')L.pin=L.pin.slice(0,-1);
  else if(/^\d$/.test(k)&&L.pin.length<4)L.pin+=k;
  updDots();
  if(L.pin.length===4)onPin();
}
async function doLogin(pin){
  const u=SF().find(x=>x.id===L.sel&&act(x));
  updDots();
  if(!u)return setMsg('Choose your name first');
  if(!u.ph)return setMsg('No PIN has been set for you yet. Ask the owner.');
  const li=lockInfo(u.id);
  if(li.u>Date.now())return setMsg('Too many wrong PINs. Try again in '+mins(li.u-Date.now()));
  L.busy=true;setMsg('Checking…');
  let ok=false;
  try{ok=await checkPin(pin,u)}catch(e){L.busy=false;return setMsg(e.message||'Could not check the PIN')}
  L.busy=false;
  if(ok){
    lockSet(u.id,null);ls.set(LK.last,u.id);
    cur={id:u.id,name:u.name,role:u.role};lastAct=Date.now();
    hide();chip();
    note('login','Signed in',null,null,actor());
    afterLogin();
  }else{
    const n=(li.n||0)+1,who={id:u.id,name:u.name,role:u.role};
    if(n>=MAXTRY){lockSet(u.id,{n,u:Date.now()+LOCKMS});note('locked_out','Locked for 5 minutes after '+n+' wrong PINs',null,null,who);setMsg('Too many wrong PINs. Try again in '+mins(LOCKMS));tickLock()}
    else{lockSet(u.id,{n,u:0});note('login_fail','Wrong PIN (attempt '+n+' of '+MAXTRY+')',null,null,who);setMsg('Wrong PIN. '+(MAXTRY-n)+' '+(MAXTRY-n===1?'try':'tries')+' left.')}
  }
}
function afterLogin(){
  try{if(typeof st!=='undefined'&&!tabOk(st.tab,st.sub)){st.tab='home'}}catch(e){}
  try{render()}catch(e){console.warn(e)}
  if(ls.get(LK.arch,'')!==ymd(Date.now())){ls.set(LK.arch,ymd(Date.now()));setTimeout(archive,1500)}
}
async function finishSetup(){
  L.busy=true;
  try{
    const d=L.data,oid=(typeof id==='function'?id():Date.now());
    const h=await hashPin(d.pin1,oid);
    const owner={id:oid,name:d.name,phone:d.phone||'',role:'owner',active:true,ph:h.ph,sl:h.sl,kv:h.kv,at:Date.now()};
    SF().push(owner);
    (db.staff||[]).forEach(n=>{n=String(n).trim();if(!n||SF().some(u=>u.name.toLowerCase()===n.toLowerCase()))return;SF().push({id:(typeof id==='function'?id():Date.now()),name:n,phone:'',role:'attendant',active:true,at:Date.now()})});
    const code=mkCode(),rsl=rndHex(12),kv=KV();
    db.sec=Object.assign({},db.sec||{},{idle:(db.sec&&db.sec.idle!=null)?db.sec.idle:15,rec:{sl:rsl,kv,h:await kdf(normCode(code),rsl+':rec',kv)}});
    syncNames();
    snap=null;
    log('staff_add','First setup: owner '+owner.name+' created'+(SF().length>1?' · '+(SF().length-1)+' existing staff names kept (they need a PIN from the owner)':''),null,{name:owner.name,role:'Owner'},{id:owner.id,name:owner.name,role:'owner'});
    if(typeof save==='function')save();
    L.data.code=code;L.data.oid=oid;L.step=4;L.busy=false;L.pin='';L.msg='';draw();
  }catch(e){L.busy=false;L.step=1;L.msg='Setup failed: '+(e&&e.message||e);draw()}
}
function afterSetup(){
  const u=SF().find(x=>x.id===L.data.oid);if(!u)return;
  cur={id:u.id,name:u.name,role:'owner'};ls.set(LK.last,u.id);lastAct=Date.now();
  hide();chip();note('login','Signed in',null,null,actor());afterLogin();
}
async function cloudVerify(pw){
  const core=window.okpotaniCloudCore;
  if(!core||!core.state||!core.state.user||!core.state.ws||core.state.ws.role!=='owner')throw new Error('This phone is not signed in to the cloud as the owner. Use the recovery code instead.');
  if(navigator.onLine===false)throw new Error('Connect to the internet first.');
  try{await core.FB.signInWithEmailAndPassword(core.state.auth,core.state.user.email,pw);return true}
  catch(e){throw new Error(/network/i.test((e&&e.code)||'')?'No internet connection.':'That password is not correct.')}
}
async function finishRecover(){
  L.busy=true;
  try{
    const u=SF().find(x=>x.id===L.sel&&x.role==='owner'),h=await hashPin(L.data.pin1,u.id);
    Object.assign(u,{ph:h.ph,sl:h.sl,kv:h.kv,active:true});
    const code=mkCode(),rsl=rndHex(12),kv=KV();
    db.sec=Object.assign({},db.sec||{},{rec:{sl:rsl,kv,h:await kdf(normCode(code),rsl+':rec',kv)}});
    lockSet(u.id,null);lockSet('rec',null);
    note('recovery','Owner PIN reset with '+(L.data.how==='cloud'?'the cloud account password':'the recovery code'),null,null,{id:u.id,name:u.name,role:'owner'});
    L.data.code=code;L.step='done';L.busy=false;draw();
  }catch(e){L.busy=false;L.step='choose';L.msg='Could not reset: '+(e&&e.message||e);draw()}
}
function overlayClick(ev){
  const b=ev.target.closest('[data-k],[data-u],[data-act]');if(!b)return;
  if(b.dataset.k!==undefined)return padKey(b.dataset.k);
  if(b.dataset.u!==undefined){L.sel=b.dataset.u;L.pin='';L.msg='';ls.set(LK.last,L.sel);return draw()}
  const a=b.dataset.act;
  if(a==='s1'){
    const n=($('#lkn').value||'').trim(),p=($('#lkp').value||'').trim();
    L.data.name=n;L.data.phone=p;
    if(n.length<2)return setMsg('Enter your name');
    L.step=2;L.msg='';L.pin='';return draw();
  }
  if(a==='s4')return afterSetup();
  if(a==='cloud'){
    cloudMode=true;hide();
    try{window.openOkpotaniCloud()}catch(e){}
    const t=setInterval(()=>{const m=$('#md');if(!m||m.classList.contains('hide')||!m.innerHTML){clearInterval(t);cloudMode=false;try{render()}catch(e){}}},800);
    return;
  }
  if(a==='forgot'){L.mode='recover';L.step='choose';L.msg='';L.pin='';return draw()}
  if(a==='back'){L.mode='pick';L.msg='';L.pin='';return draw()}
  if(a==='rcode'){L.step='code';L.msg='';return draw()}
  if(a==='rcloud'){L.step='cloud';L.msg='';return draw()}
  if(a==='rcodego'){return recoverGo('code')}
  if(a==='rcloudgo'){return recoverGo('cloud')}
  if(a==='rdone'){L.mode='pick';L.step=1;L.pin='';L.msg='New PIN saved. Sign in with it.';return draw()}
}
async function recoverGo(how){
  if(L.busy)return;
  const v=($('#lkc')||{}).value||'';
  const li=lockInfo('rec');if(li.u>Date.now())return setMsg('Too many tries. Wait '+mins(li.u-Date.now())+'.');
  L.busy=true;setMsg('Checking…');
  try{
    if(how==='code'){
      const r=db.sec&&db.sec.rec;if(!r)throw new Error('No recovery code was saved. Use the cloud password instead.');
      const h=await kdf(normCode(v),r.sl+':rec',r.kv||'p1');
      if(!sameStr(h,r.h))throw new Error('wrong');
    }else await cloudVerify(v);
    L.busy=false;lockSet('rec',null);L.data={how};L.step='new1';L.pin='';L.msg='';draw();
  }catch(e){
    L.busy=false;const n=(li.n||0)+1;
    if(n>=MAXTRY){lockSet('rec',{n,u:Date.now()+LOCKMS});setMsg('Too many tries. Wait 5:00.')}
    else{lockSet('rec',{n,u:0});setMsg((e.message==='wrong'?'That code is not correct.':e.message)+' ('+(MAXTRY-n)+' tries left)')}
  }
}
function lock(){
  if(!on())return;
  cur=null;chip();
  try{modal()}catch(e){}
  L.mode='pick';L.pin='';L.msg='';
  const l=ls.get(LK.last,null),A=SF().filter(act);L.sel=(A.find(u=>u.id===l)||(A.length===1?A[0]:{})).id||null;
  css();draw();
}
function recheckSession(){
  if(!cur)return;
  const u=SF().find(x=>x.id===cur.id);
  if(!u||!act(u)){cur=null;lock();try{toast('Your access was removed')}catch(e){}return}
  if(u.role!==cur.role||u.name!==cur.name){cur.role=u.role;cur.name=u.name;chip();try{render()}catch(e){}}
}
function chip(){
  const b=$('#hu');if(!b)return;
  if(!cur||!on()){b.classList.add('hide');return}
  b.classList.remove('hide');b.textContent=cur.name.split(' ')[0];b.title=cur.name+' · '+RL(cur.role)+' · tap to switch user';
}
function menu(){
  if(!cur)return;
  modal('<h2>'+E(cur.name)+'</h2><small>'+RL(cur.role)+'</small>'
   +'<button class="btn big" onclick="modal();okpAcc.lock()">🔁 Switch user / lock</button>'
   +'<button class="btn" onclick="okpAcc.pinForm()">🔑 Change my PIN</button>'
   +'<button class="btn" onclick="modal()">Close</button>');
}
function pinForm(){
  modal('<h2>Change my PIN</h2><label>Current PIN</label><input id="cp0" type="password" inputmode="numeric" maxlength="4" autocomplete="off"><label>New PIN (4 digits)</label><input id="cp1" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"><label>Repeat new PIN</label><input id="cp2" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"><div class="low" id="cpm"></div><button class="btn big" onclick="okpAcc.pinSave()">Save new PIN</button><button class="btn" onclick="modal()">Cancel</button>');
}
async function pinSave(){
  const m=t=>{const e=$('#cpm');if(e)e.textContent=t},u=SF().find(x=>cur&&x.id===cur.id);
  const a=$('#cp0').value,b=$('#cp1').value,c=$('#cp2').value;
  if(!u)return;
  if(!/^\d{4}$/.test(b))return m('The new PIN must be 4 digits.');
  if(b!==c)return m('The two new PINs do not match.');
  if(weak(b))return m('Too easy to guess. Avoid 1234 or repeated digits.');
  const li=lockInfo(u.id);if(li.u>Date.now())return m('Too many wrong PINs. Wait '+mins(li.u-Date.now())+'.');
  let ok=false;try{ok=await checkPin(a,u)}catch(e){return m(e.message)}
  if(!ok){const n=(li.n||0)+1;if(n>=MAXTRY){lockSet(u.id,{n,u:Date.now()+LOCKMS});note('locked_out','Locked for 5 minutes after '+n+' wrong PINs (PIN change)');lock();return}lockSet(u.id,{n,u:0});note('login_fail','Wrong current PIN while changing PIN (attempt '+n+')');return m('The current PIN is not correct.')}
  const h=await hashPin(b,u.id);Object.assign(u,{ph:h.ph,sl:h.sl,kv:h.kv});lockSet(u.id,null);
  note('pin_change','Changed own PIN');modal();toast('PIN changed ✓');
}

/* ---------------------------------------------------------------- STAFF SCREEN (owner only) */
const lastOwner=u=>!SF().some(x=>x.id!==u.id&&x.role==='owner'&&act(x)&&x.ph);
const findU=i=>SF().find(x=>String(x.id)===String(i));
function staffPage(){
  if(!can('staff'))return '<div class="empty">Only the owner can open this screen.</div>';
  const S=SF().slice().sort((a,b)=>ROLES.findIndex(r=>r[0]===a.role)-ROLES.findIndex(r=>r[0]===b.role)||a.name.localeCompare(b.name));
  let h='<button class="btn big" onclick="okpAcc.staffForm()" style="margin:0 0 10px">+ Add staff</button>';
  h+=S.map(u=>'<button class="item" onclick="okpAcc.staffForm('+u.id+')"><span class="nm"><b>'+E(u.name)+'</b><small>'+RL(u.role)+(u.phone?' · '+E(u.phone):'')+(!u.ph?' · <span class="low">No PIN yet</span>':'')+(act(u)?'':' · <span class="low">Disabled</span>')+'</small></span><span class="pr">'+(cur&&u.id===cur.id?'You':'')+'</span></button>').join('');
  h+='<h3>What each role can do</h3><small>The owner can always do everything. Switch things on or off for Manager and Attendant. Changes reach the other phones when they sync.</small>';
  h+='<div class="pm" style="margin-top:8px"><span></span><span class="h">Manager</span><span class="h">Attendant</span>';
  PERMS.forEach(p=>{
    h+='<div class="pl"><b>'+E(p[1])+'</b><small>'+E(p[2])+'</small></div>'
     +['manager','attendant'].map(r=>'<label class="sw"><input type="checkbox" aria-label="'+E(p[1])+' for '+r+'" '+(permOf(r,p[0])?'checked':'')+' onchange="okpAcc.setPerm(\''+r+'\',\''+p[0]+'\',this.checked)"></label>').join('');
  });
  h+='</div><small>Only the owner can: manage staff and roles, open Setup and cloud sync, see the audit log, restore backups or delete records by date.</small>';
  h+='<button class="btn" onclick="okpAcc.resetPerms()">Put all switches back to the standard settings</button>';
  const id0=idleMin();
  h+='<h3>Lock</h3><label>Lock the app after no use for</label><select onchange="okpAcc.setIdle(this.value)">'+[[5,'5 minutes'],[15,'15 minutes'],[30,'30 minutes'],[0,'Never (not recommended)']].map(o=>'<option value="'+o[0]+'"'+(o[0]===id0?' selected':'')+'>'+o[1]+'</option>').join('')+'</select>';
  h+='<button class="btn" onclick="okpAcc.lock()">🔒 Lock now</button><button class="btn" onclick="okpAcc.recoveryNew()">🛟 Make a new recovery code</button><button class="btn" onclick="go(\'audit\')">📜 Open the audit log</button>';
  return h;
}
function staffForm(i){
  if(!can('staff'))return deny();
  const u=i?findU(i):null;
  modal('<h2>'+(u?'Edit staff':'Add staff')+'</h2><label>Name</label><input id="sfn" value="'+E(u?u.name:'')+'" autocomplete="off"><label>Phone (optional)</label><input id="sfp" type="tel" value="'+E(u?u.phone||'':'')+'"><label>Role</label><select id="sfr">'+ROLES.map(r=>'<option value="'+r[0]+'"'+((u?u.role:'attendant')===r[0]?' selected':'')+'>'+r[1]+'</option>').join('')+'</select>'
   +(u?'':'<label>PIN (4 digits)</label><input id="sfa" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"><label>Repeat PIN</label><input id="sfb" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password">')
   +'<div class="low" id="sfm"></div><button class="btn big" onclick="okpAcc.staffSave('+(u?u.id:0)+')">Save</button>'
   +(u?'<button class="btn" onclick="okpAcc.pinReset('+u.id+')">🔑 Set a new PIN</button><button class="btn" onclick="okpAcc.toggleActive('+u.id+')">'+(act(u)?'⏸ Disable (cannot sign in)':'▶ Enable again')+'</button><button class="btn del" onclick="okpAcc.staffDelete('+u.id+')">Delete</button>':'')
   +'<button class="btn" onclick="modal()">Cancel</button>');
}
async function staffSave(i){
  if(!can('staff'))return deny();
  const m=t=>{const e=$('#sfm');if(e)e.textContent=t};
  const n=$('#sfn').value.trim(),ph=$('#sfp').value.trim(),r=$('#sfr').value;
  if(n.length<2)return m('Enter the name.');
  if(SF().some(x=>String(x.id)!==String(i)&&x.name.toLowerCase()===n.toLowerCase()))return m('Another staff member already has that name.');
  if(i){
    const u=findU(i);if(!u)return;
    if(u.role==='owner'&&r!=='owner'&&lastOwner(u))return m('There must always be at least one owner.');
    const o={name:u.name,phone:u.phone||'',role:u.role};
    Object.assign(u,{name:n,phone:ph,role:r});
    if(o.name!==n||o.phone!==ph)log('staff_edit',n+' · details changed',{name:o.name,phone:o.phone||'-'},{name:n,phone:ph||'-'});
    if(o.role!==r)log('role_change',n+' · '+RL(o.role)+' → '+RL(r),{role:RL(o.role)},{role:RL(r)});
    if(cur&&String(cur.id)===String(u.id)){cur.name=n;cur.role=r;chip()}
    syncNames();persist();modal();render();toast('Saved ✓');return;
  }
  const a=$('#sfa').value,b=$('#sfb').value;
  if(!/^\d{4}$/.test(a))return m('The PIN must be 4 digits.');
  if(a!==b)return m('The two PINs do not match.');
  if(weak(a))return m('Too easy to guess. Avoid 1234 or repeated digits.');
  const nid=(typeof id==='function'?id():Date.now()),h=await hashPin(a,nid);
  SF().push({id:nid,name:n,phone:ph,role:r,active:true,ph:h.ph,sl:h.sl,kv:h.kv,at:Date.now()});
  log('staff_add',n+' added as '+RL(r),null,{name:n,role:RL(r),phone:ph||'-'});
  syncNames();persist();modal();render();toast('Staff added ✓');
}
function pinReset(i){
  if(!can('staff'))return deny();const u=findU(i);if(!u)return;
  modal('<h2>New PIN for '+E(u.name)+'</h2><label>New PIN (4 digits)</label><input id="pr1" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"><label>Repeat PIN</label><input id="pr2" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"><div class="low" id="prm"></div><button class="btn big" onclick="okpAcc.pinResetSave('+u.id+')">Save PIN</button><button class="btn" onclick="modal()">Cancel</button>');
}
async function pinResetSave(i){
  if(!can('staff'))return deny();const u=findU(i);if(!u)return;
  const m=t=>{const e=$('#prm');if(e)e.textContent=t},a=$('#pr1').value,b=$('#pr2').value;
  if(!/^\d{4}$/.test(a))return m('The PIN must be 4 digits.');if(a!==b)return m('The two PINs do not match.');if(weak(a))return m('Too easy to guess. Avoid 1234 or repeated digits.');
  const h=await hashPin(a,u.id);Object.assign(u,{ph:h.ph,sl:h.sl,kv:h.kv});lockSet(u.id,null);
  note('pin_reset','PIN reset for '+u.name);modal();render();toast('PIN saved ✓');
}
function toggleActive(i){
  if(!can('staff'))return deny();const u=findU(i);if(!u)return;
  if(act(u)){
    if(cur&&String(cur.id)===String(u.id))return alert('You cannot disable yourself.');
    if(u.role==='owner'&&lastOwner(u))return alert('There must always be at least one active owner.');
    return askc('Disable '+u.name+'? They will not be able to sign in until you enable them again.',()=>{u.active=false;note('staff_disable',u.name+' disabled');syncNames();persist();modal();render()});
  }
  u.active=true;note('staff_enable',u.name+' enabled');syncNames();persist();modal();render();
}
function staffDelete(i){
  if(!can('staff'))return deny();const u=findU(i);if(!u)return;
  if(cur&&String(cur.id)===String(u.id))return alert('You cannot delete yourself.');
  if(u.role==='owner'&&lastOwner(u))return alert('There must always be at least one owner.');
  askc('Delete '+u.name+'? Old receipts keep the name. This cannot be undone.',()=>{db.SF=SF().filter(x=>x.id!==u.id);log('staff_delete',u.name+' deleted',{name:u.name,role:RL(u.role)});syncNames();persist();modal();render()});
}
function setPerm(role,key,val){
  if(!can('staff'))return deny();
  const p=PERMS.find(x=>x[0]===key);if(!p||(role!=='manager'&&role!=='attendant'))return;
  const old=permOf(role,key);if(old===!!val)return;
  db.perm=db.perm||{};db.perm[role]=db.perm[role]||{};db.perm[role][key]=!!val;
  log('role_change',RL(role)+' · '+p[1]+': '+(val?'ON':'OFF'),{[p[1]]:old?'on':'off'},{[p[1]]:val?'on':'off'});
  persist();
}
function resetPerms(){
  if(!can('staff'))return deny();
  askc('Put every Manager and Attendant switch back to the standard settings?',()=>{db.perm={};note('role_change','All role switches put back to the standard settings');render()});
}
function setIdle(v){
  if(!can('staff'))return deny();
  const o=idleMin();db.sec=Object.assign({},db.sec||{},{idle:+v});
  note('settings','Lock time: '+(o?o+' min':'never')+' → '+(+v?(+v)+' min':'never'),{lock_after:o?o+' min':'never'},{lock_after:+v?(+v)+' min':'never'});
}
function recoveryNew(){
  if(!can('staff'))return deny();
  modal('<h2>New recovery code</h2><small>The old code stops working. Enter your PIN to continue.</small><label>Your PIN</label><input id="rn0" type="password" inputmode="numeric" maxlength="4" autocomplete="off"><div class="low" id="rnm"></div><button class="btn big" onclick="okpAcc.recoveryNewGo()">Make new code</button><button class="btn" onclick="modal()">Cancel</button>');
}
async function recoveryNewGo(){
  const u=findU(cur&&cur.id),m=t=>{const e=$('#rnm');if(e)e.textContent=t};
  let ok=false;try{ok=u&&await checkPin($('#rn0').value,u)}catch(e){return m(e.message)}
  if(!ok)return m('That PIN is not correct.');
  const code=mkCode(),rsl=rndHex(12),kv=KV();
  db.sec=Object.assign({},db.sec||{},{rec:{sl:rsl,kv,h:await kdf(normCode(code),rsl+':rec',kv)}});
  note('settings','New owner recovery code made');
  modal('<h2>Write this down</h2><small>Keep it on paper somewhere safe. It is shown only once.</small><div style="font:800 24px/1.3 ui-monospace,Menlo,monospace;letter-spacing:2px;background:#fff;color:#000;border-radius:12px;padding:16px 8px;margin:12px 0;text-align:center;user-select:all">'+E(code)+'</div><button class="btn big" onclick="modal()">I have written it down</button>');
}

/* ---------------------------------------------------------------- AUDIT LOG SCREEN (owner only) */
let AF={from:'',to:'',u:'',g:'',q:'',lim:100};
function auInit(){if(!AF.from){const d=new Date();d.setDate(d.getDate()-6);AF.from=ymd(d.getTime());AF.to=ymd(Date.now())}}
function filtered(){
  const from=AF.from?new Date(AF.from+'T00:00:00').getTime():0,to=AF.to?new Date(AF.to+'T23:59:59.999').getTime():Infinity,q=AF.q.trim().toLowerCase();
  return allEntries().filter(e=>e.t>=from&&e.t<=to&&(!AF.u||e.n===AF.u)&&(!AF.g||actGroup(e.a)===AF.g)&&(!q||(e.n+' '+actLabel(e.a)+' '+e.s+' '+JSON.stringify(e.b||'')+' '+JSON.stringify(e.f||'')).toLowerCase().indexOf(q)>=0));
}
const kvH=o=>Object.keys(o).map(k=>'<div><b>'+E(k.replace(/_/g,' '))+':</b> '+E(o[k])+'</div>').join('');
const kvT=o=>Object.keys(o).map(k=>k.replace(/_/g,' ')+': '+o[k]).join('; ');
function rowH(e){
  return '<details class="aud"><summary><span class="ai">'+actIcon(e.a)+'</span><span class="at"><b>'+E(actLabel(e.a))+'</b><span>'+E(e.s)+'</span><small>'+ymd(e.t)+' '+hm(e.t)+' · '+E(e.n||'-')+(e.r?' ('+RL(e.r)+')':'')+'</small></span></summary><div class="dt">'
   +(e.b?'<div class="bf"><b>Before</b></div>'+kvH(e.b):'')+(e.f?'<div class="af"><b>After</b></div>'+kvH(e.f):'')
   +(!e.b&&!e.f?'<div><small>No before and after values for this action.</small></div>':'')+'</div></details>';
}
function auList(){
  const L=filtered(),el=$('#aul'),ct=$('#auc');
  if(ct)ct.textContent=L.length+' entr'+(L.length===1?'y':'ies');
  if(el)el.innerHTML=(L.slice(0,AF.lim).map(rowH).join('')||'<div class="empty">No entries match these filters.</div>')+(L.length>AF.lim?'<button class="btn" onclick="okpAcc.auMore()">Show more ('+(L.length-AF.lim)+' left)</button>':'');
}
function auSet(k,v){AF[k]=v;AF.lim=100;auList()}
function auMore(){AF.lim+=200;auList()}
function auditPage(){
  if(!can('audit'))return '<div class="empty">Only the owner can open the audit log.</div>';
  auInit();
  const who=[...new Set(allEntries().map(e=>e.n).concat(SF().map(u=>u.name)).filter(Boolean))].sort();
  return '<small>Every important action is recorded with who did it and when. Entries cannot be edited or deleted from the app.</small>'
   +'<div class="cards" style="margin-top:8px"><div><label>From</label><input type="date" value="'+AF.from+'" onchange="okpAcc.auSet(\'from\',this.value)"></div><div><label>To</label><input type="date" value="'+AF.to+'" onchange="okpAcc.auSet(\'to\',this.value)"></div></div>'
   +'<label>Staff</label><select onchange="okpAcc.auSet(\'u\',this.value)"><option value="">Everyone</option>'+who.map(n=>'<option'+(n===AF.u?' selected':'')+'>'+E(n)+'</option>').join('')+'</select>'
   +'<label>Type of action</label><select onchange="okpAcc.auSet(\'g\',this.value)">'+GROUPS.map(g=>'<option value="'+g[0]+'"'+(g[0]===AF.g?' selected':'')+'>'+g[1]+'</option>').join('')+'</select>'
   +'<label>Search</label><input type="search" placeholder="Product, customer, receipt number…" value="'+E(AF.q)+'" oninput="okpAcc.auSet(\'q\',this.value)">'
   +'<div class="seg np"><button onclick="okpAcc.auPdf(1)">📄 Share PDF</button><button onclick="okpAcc.auPdf(0)">⬇ PDF</button><button onclick="okpAcc.auXl(0)">⬇ Excel</button><button onclick="okpAcc.auXl(1)">📤 Share Excel</button></div>'
   +'<div class="sh" style="display:flex;justify-content:space-between;align-items:center"><h3 id="auc" style="margin:6px 0"></h3><button class="lnk" onclick="okpAcc.auCheck()">Check log is untouched</button></div><div id="aul">'+(function(){const L=filtered();return (L.slice(0,AF.lim).map(rowH).join('')||'<div class="empty">No entries match these filters.</div>')+(L.length>AF.lim?'<button class="btn" onclick="okpAcc.auMore()">Show more ('+(L.length-AF.lim)+' left)</button>':'')})()+'</div>';
}
function auCheck(){
  const r=verify();
  modal('<h2>Log check</h2><p>'+r.n+' entries checked.</p>'+(r.bad.length?'<p class="low">'+r.bad.length+' entr'+(r.bad.length===1?'y does':'ies do')+' not match the chain. Something was changed outside the app (for example in the Firebase console), or a phone\u2019s data was edited.</p>'+r.bad.slice(0,8).map(e=>'<div class="item" style="cursor:default"><span class="nm"><b>'+E(actLabel(e.a))+'</b><small>'+ymd(e.t)+' '+hm(e.t)+' · '+E(e.n)+'</small></span></div>').join(''):'<p class="ok"><b>No problems found.</b> Every entry still matches the one before it.</p>')+'<small>This check catches edits or deletions in the middle of the log. It cannot detect entries removed from the very end.</small><button class="btn" onclick="modal()">Close</button>');
}
function exportRows(){
  return filtered().slice(0,5000).map(e=>({when:ymd(e.t)+' '+hm(e.t),date:ymd(e.t),time:hm(e.t),who:(e.n||'-'),role:e.r?RL(e.r):'',act:actLabel(e.a),sum:e.s,b:e.b?kvT(e.b):'',f:e.f?kvT(e.f):'',det:e.s+(e.b?'  |  Before: '+kvT(e.b):'')+(e.f?'  |  After: '+kvT(e.f):'')}));
}
function subLine(n){return (AF.from||'start')+' to '+(AF.to||'now')+(AF.u?'  ·  '+AF.u:'')+(AF.g?'  ·  '+(GROUPS.find(g=>g[0]===AF.g)||[0,''])[1]:'')+(AF.q?'  ·  search "'+AF.q+'"':'')+'  ·  '+n+' entries'}
function auPdf(share){
  if(!can('audit'))return deny();
  const R=exportRows();
  if(!window.X||!X.auditPdf)return alert('PDF maker is not loaded. Reload the app and try again.');
  X.auditPdf(R,subLine(R.length),!!share);
}
async function auXl(share){
  if(!can('audit'))return deny();
  try{
    const R=exportRows(),rows=[['Date','Time','Staff','Role','Action','Details','Before','After']].concat(R.map(r=>[r.date,r.time,r.who,r.role,r.act,r.sum,r.b,r.f]));
    const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[{wch:11},{wch:7},{wch:16},{wch:11},{wch:26},{wch:60},{wch:44},{wch:44}];
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Audit log');
    const name='Okpotani-audit-log-'+td()+'.xlsx';
    if(!share){XLSX.writeFile(wb,name);return toast('Excel downloaded ✓')}
    const buf=XLSX.write(wb,{bookType:'xlsx',type:'array'}),blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    try{const f=new File([blob],name,{type:blob.type});if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:name});return}}catch(e){if(e&&e.name==='AbortError')return}
    XLSX.writeFile(wb,name);toast('Sharing is not available here, so the file was downloaded');
  }catch(e){alert('Excel export failed: '+(e&&e.message||e))}
}

/* ---------------------------------------------------------------- hiding what a role cannot use */
const CLICK=[
 [/pform\(\)/,'edit_stock'],[/uform\(\)|spay\(/,'purchases'],[/xform\(\)/,'expenses'],[/aform\(\)|oform\(\)|okpCr\.cuForm\(\)/,'customers'],
 [/okpRt\.start/,'returns'],[/okpStk\.open\('(take|adj)'\)/,'edit_stock'],[/okpCl\.open/,'reports'],
 [/X\.(monthReport|dayReport|report|reportGo)|exportXl|[^\w]csv\(/,'export'],[/bk\(\)|X\.backup/,'backup'],
 [/editSale\(/,'edit_receipt'],[/Delete this sale|delEdit\(/,'delete_receipt']];
function clickPerm(oc){
  for(const c of CLICK)if(c[0].test(oc))return c[1];
  let m;
  if((m=oc.match(/nav\('money','(\w+)'\)/))&&SUB[m[1]])return SUB[m[1]];
  if((m=oc.match(/st\.sub='(\w+)'/))&&SUB[m[1]])return SUB[m[1]];
  if((m=oc.match(/(?:go|nav)\('(\w+)'/))&&TAB[m[1]])return TAB[m[1]];
  return null;
}
function dropCols(root,re){
  root.querySelectorAll('table').forEach(t=>{
    const rows=t.querySelectorAll('tr');if(!rows.length)return;
    const hs=[...rows[0].children];
    for(let i=hs.length-1;i>=0;i--)if(re.test((hs[i].textContent||'').trim()))rows.forEach(r=>{const x=r.children[i];if(x)x.remove()});
  });
}
function scrub(root){
  try{
    if(!root||!on()||!cur||cur.role==='owner')return;
    root.querySelectorAll('button.btn,.fx-a button,.seg button,.tile,button.lnk').forEach(b=>{const p=clickPerm(b.getAttribute('onclick')||'');if(p&&!can(p))b.remove()});
    const noP=!can('see_profit'),noC=!can('see_cost');
    if(noP||noC)root.querySelectorAll('.stat').forEach(s=>{
      const t=(s.querySelector('small')||s).textContent||'';
      if((noP&&/profit|margin|net revenue/i.test(t))||(noC&&/stock value \(cost\)|cost of goods|at cost|value (lost|gained)/i.test(t)))s.remove();
    });
    if(noP)dropCols(root,/^(profit|margin)/i);
    if(noC){dropCols(root,/^(unit cost|cost)/i);if(typeof st!=='undefined'&&st.tab==='sa')dropCols(root,/^value/i)}
  }catch(e){console.warn('scrub',e)}
}
function servedBy(){
  const canPick=cur&&(cur.role==='owner'||cur.role==='manager');
  const q=(typeof st!=='undefined'&&st.edit)?db.S.find(x=>x.id==st.edit):null,pick=(q&&q.by)||(cur?cur.name:'');
  if(canPick){const A=names();if(pick&&A.indexOf(pick)<0)A.unshift(pick);return '<label>Served by</label><select id="sb">'+A.map(n=>'<option'+(n===pick?' selected':'')+'>'+E(n)+'</option>').join('')+'</select>'}
  return '<label>Served by</label><input id="sb" value="'+E(pick)+'" readonly>';
}

/* ---------------------------------------------------------------- restore keeps staff, PINs and the audit log */
let pendingRestore=null;
function beforeRestore(x){
  const cnt=d=>({receipts:(d.S||[]).length,products:(d.P||[]).length,expenses:(d.X||[]).length,stock_arrivals:(d.U||[]).length});
  pendingRestore={b:cnt(db),f:cnt(x),who:actor()};
  x.SF=db.SF;x.perm=db.perm;x.sec=db.sec;x.AU=db.AU;x.AA=db.AA;x.staff=db.staff;
  if(x.perm===undefined)delete x.perm;
}
function afterRestore(){
  snap=on()?takeSnap():null;
  if(pendingRestore){const p=pendingRestore;pendingRestore=null;log('restore','Backup restored · '+p.f.receipts+' receipts, '+p.f.products+' products (before: '+p.b.receipts+' receipts, '+p.b.products+' products)',p.b,p.f,p.who)}
}

/* ---------------------------------------------------------------- wiring */
function guard(name,perm,alt){
  const f=window[name];if(typeof f!=='function'||f.__okpg)return;
  const w=function(){if(!can(perm)){if(alt)return alt.apply(this,arguments);return deny()}return f.apply(this,arguments)};w.__okpg=1;window[name]=w;
}
function wrapObj(o,m,fn){if(!o||typeof o[m]!=='function'||o[m].__okpg)return;const f=o[m],w=function(){return fn.call(this,f,arguments)};w.__okpg=1;o[m]=w}
function install(){
  if(install.done)return;install.done=true;
  guard('editSale','edit_receipt');guard('delEdit','delete_receipt');guard('saveEdit','edit_receipt');
  guard('pform','edit_stock',function(i){if(i&&typeof sc==='function')return sc(i);return deny()});
  guard('uform','purchases');guard('xform','expenses');guard('aform','customers');guard('oform','customers');guard('spay','purchases');guard('sview','purchases');
  guard('cform','credit_pay');guard('exportXl','export');guard('csv','export');guard('delday','settings');guard('sset','settings');
  {const f=window.bk;if(typeof f==='function'&&!f.__okpg){const w=function(){if(!can('backup'))return deny();note('backup','Backup downloaded (JSON file)');return f.apply(this,arguments)};w.__okpg=1;window.bk=w}}
  if(window.X)wrapObj(window.X,'backup',function(f,a){if(!can('backup'))return deny();note('backup','Backup made (PDF file)');return f.apply(this,a)});
  ['report','reportGo','monthReport','dayReport'].forEach(m=>{if(window.X)wrapObj(window.X,m,function(f,a){if(!can('export'))return deny();return f.apply(this,a)})});
  if(window.okpStk){const pk=k=>(k==='take'||k==='adj'||k==='hist')?'edit_stock':k==='ro'?'purchases':'view_stock';['open','go'].forEach(m=>wrapObj(window.okpStk,m,function(f,a){if(!can(pk(a[0])))return deny();return f.apply(this,a)}))}
  if(window.okpRt)wrapObj(window.okpRt,'start',function(f,a){if(!can('returns'))return deny();return f.apply(this,a)});
  if(window.okpCl)wrapObj(window.okpCl,'open',function(f,a){if(!can('reports'))return deny();return f.apply(this,a)});
  if(window.okpCr){wrapObj(window.okpCr,'pay',function(f,a){if(!can('credit_pay'))return deny();return f.apply(this,a)});wrapObj(window.okpCr,'cuForm',function(f,a){if(!can('customers'))return deny();return f.apply(this,a)})}
  /* after every screen is drawn, remove what this person may not use */
  const px=window.xAfter;window.xAfter=function(){if(typeof px==='function')px.apply(this,arguments);scrub($('#mn'));scrub($('#nv'))};
  const pm=window.modal;if(typeof pm==='function'&&!pm.__okpg){const w=function(){const r=pm.apply(this,arguments);scrub($('#md'));return r};w.__okpg=1;window.modal=w}
  const pc=window.cartfs;if(typeof pc==='function'&&!pc.__okpg){const w=function(){const r=pc.apply(this,arguments);scrub($('#cfs'));return r};w.__okpg=1;window.cartfs=w}
  try{V.staff=staffPage;V.audit=auditPage}catch(e){console.warn('screens not added',e)}
  if(on()&&!snap)rebase();
}
function bindOverlay(){
  const o=ov();if(o.__b)return;o.__b=1;o.addEventListener('click',overlayClick);
  document.addEventListener('keydown',ev=>{
    if(!visible()||L.busy)return;
    if(ev.target&&/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName))return;
    const padMode=(L.mode==='pick')||(L.mode==='setup'&&(L.step===2||L.step===3))||(L.mode==='recover'&&(L.step==='new1'||L.step==='new2'));
    if(!padMode)return;
    if(/^\d$/.test(ev.key))padKey(ev.key);else if(ev.key==='Backspace')padKey('⌫');else if(ev.key==='Escape')padKey('C');
  });
}
function idleWatch(){
  ['pointerdown','keydown','touchstart','wheel','scroll'].forEach(e=>document.addEventListener(e,()=>{lastAct=Date.now()},{capture:true,passive:true}));
  const chk=()=>{if(!cur)return;const m=idleMin();if(m>0&&Date.now()-lastAct>m*60000)lock()};
  setInterval(chk,5000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)chk()});
}
window.okpAcc={on,can,gate,route,cards,more,sub:subOk,me,name:()=>cur?cur.name:'',role:()=>cur?cur.role:'',lock,menu,pinForm,pinSave,deny,servedBy,
  staffForm,staffSave,pinReset,pinResetSave,toggleActive,staffDelete,setPerm,resetPerms,setIdle,recoveryNew,recoveryNewGo,
  corpus,auSet,auMore,auPdf,auXl,auCheck,beforeRestore,afterRestore,scrub,tabOk,permOf,PERMS,
  _t:{L:()=>L,cur:()=>cur,SF,kdf,checkPin,hashPin,sha256,doLogin,padKey,overlayClick,showLock,showSetup,draw,finishSetup,filtered,allEntries,takeSnap,install,lockInfo,staffPage,auditPage,sm,actor,setCur:u=>{cur=u},chip,cloudMode:()=>cloudMode}};
window.okpAudit={pre,rebase,remote,log:note,verify,entries:allEntries,archive,_dev:DEV};
/* start: cover the app straight away */
css();bindOverlay();idleWatch();chip();
try{if(on())showLock();else showSetup()}catch(e){console.error(e)}
if(document.readyState==='complete')setTimeout(install,0);else window.addEventListener('load',()=>setTimeout(install,0));
})();
