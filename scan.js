/* Okpotani barcode scanning, labels and internal codes (scan.js)
 *
 * What this file does (everything works offline; the two libraries below are saved inside the app and only loaded when needed):
 *  - camera scanning (built-in BarcodeDetector first, ZXing as the offline backup) for Sell, Check a price, Stock list, Stock arriving,
 *    "Scan to attach" on a product, and a bulk "attach barcodes" screen
 *  - Bluetooth / USB barcode scanners that type like a keyboard (they end with Enter)
 *  - barcode field on products: p.bc = list of barcodes (several allowed). The old "Code" field (p.code) also works as a scan code.
 *    No product is rewritten when the app updates: a product without p.bc simply has no extra barcodes.
 *  - label printer: Code 128 barcode or QR labels, A4 sheets or 58mm roll, made as print page or PDF
 *
 * Libraries (saved next to index.html, unchanged):
 *   zxing.min.js  = @zxing/library 0.21.3 (MIT / Apache-2.0 licence, https://github.com/zxing-js/library)
 *   qrcode.js     = qrcode-generator 2.0.4 by Kazuhiko Arase (MIT licence)
 */
(function(){
'use strict';
const WR=[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const WB=[278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const PT=25.4/72;                      // millimetres per point
const PREF_KEY='okp_scan_prefs';
const $q=s=>document.querySelector(s);
const E=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const F0=n=>Math.round(+n||0).toLocaleString('en-US');

/* ------------------------------------------------------------------ preferences (this phone only) */
function prefs(){let p={};try{p=JSON.parse(localStorage.getItem(PREF_KEY)||'{}')||{}}catch(e){}return Object.assign({sound:1,vib:1,engine:'auto',cont:{sell:1,price:1,bulk:1},lab:{}},p)}
function setPref(k,v){const p=prefs();p[k]=v;try{localStorage.setItem(PREF_KEY,JSON.stringify(p))}catch(e){}}

/* ------------------------------------------------------------------ codes and products */
const clean=s=>String(s==null?'':s).replace(/[\s\u0000-\u001f\u007f]+/g,'').slice(0,64);
// Matching key. UPC-A (12), EAN-13 (13) and ITF-14 (14) are the same number with leading zeros added, so those are compared without them.
function key(s){s=clean(s).toUpperCase();if(/^\d{12,14}$/.test(s))s=s.replace(/^0+/,'');return s}
const prod=()=>(typeof db!=='undefined'&&db&&Array.isArray(db.P))?db.P:[];
function bcs(p){return Array.isArray(p&&p.bc)?p.bc.map(clean).filter(Boolean):[]}
// every code a product answers to: its barcodes plus the old "Code" field
function codesOf(p){const o=[],seen=new Set();bcs(p).concat(p&&p.code?[clean(p.code)]:[]).forEach(c=>{const k=key(c);if(k&&!seen.has(k)){seen.add(k);o.push(c)}});return o}
function owners(code,exceptId){const k=key(code);if(!k)return[];return prod().filter(p=>p.id!=exceptId&&codesOf(p).some(c=>key(c)==k))}
function find(code){const o=owners(code);return o.length?{p:o[0],all:o}:null}
const hay=p=>codesOf(p).join(' ').toLowerCase();
// typed search: barcodes are only matched for 4+ characters so a short word never matches random numbers
const hit=(p,q)=>{q=String(q||'').toLowerCase().trim();return q.length>=4&&/\d/.test(q)&&hay(p).includes(q)};
const csv=p=>bcs(p).join(', ');
function parseCsv(s){const o=[],seen=new Set();String(s||'').split(/[,;\n]+/).map(clean).filter(Boolean).forEach(c=>{const k=key(c);if(!seen.has(k)){seen.add(k);o.push(c)}});return o}
const isInternal=c=>/^OK\d{6}$/.test(clean(c));
function newInternal(extra){const used=new Set();prod().forEach(p=>codesOf(p).forEach(c=>used.add(key(c))));(extra||[]).forEach(c=>used.add(key(c)));
 for(let i=0;i<500;i++){const a=new Uint32Array(1);(window.crypto&&crypto.getRandomValues)?crypto.getRandomValues(a):(a[0]=Math.floor(Math.random()*4e9));const c='OK'+String(100000+a[0]%900000);if(!used.has(key(c)))return c}
 return 'OK'+String(Date.now()).slice(-6)}
// the code printed on a label: the product's own internal code, else its first barcode, else its Code field
function labelCode(p){const l=codesOf(p);return l.find(isInternal)||l[0]||''}
function canEdit(){return window.okpAcc?!!okpAcc.route('stock'):true}
const canCost=()=>(typeof can==='function')?can('see_cost'):true;

/* ------------------------------------------------------------------ Code 128 encoder */
const C128=['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
// returns the symbol values (start, data..., checksum, stop)
function c128Values(s){
 s=String(s).replace(/[^\x20-\x7e]/g,'');if(!s)return null;
 const v=[];let mode=null;const dig=(i,n)=>{for(let k=0;k<n;k++)if(!/\d/.test(s[i+k]||''))return false;return true};
 const run=i=>{let n=0;while(/\d/.test(s[i+n]||''))n++;return n};
 let i=0;
 const r0=run(0);
 if(r0>=4||(r0==2&&s.length==2)){ if(r0%2==0){mode='C';v.push(105)}else{mode='B';v.push(104);v.push(s.charCodeAt(0)-32);i=1;if(run(1)>=4){v.push(99);mode='C'}} }
 else{mode='B';v.push(104)}
 while(i<s.length){
  if(mode=='C'){ if(dig(i,2)){v.push(+s.substr(i,2));i+=2}else{v.push(100);mode='B'} }
  else{ const r=run(i); if(r>=6||(r>=4&&i+r==s.length)){ if(r%2){v.push(s.charCodeAt(i)-32);i++} v.push(99);mode='C' } else{v.push(s.charCodeAt(i)-32);i++} }
 }
 let sum=v[0];for(let k=1;k<v.length;k++)sum+=v[k]*k;v.push(sum%103);v.push(106);return v}
// returns {w:[bar,space,bar,...] widths in modules, total}
function c128(s){const v=c128Values(s);if(!v)return null;const w=[];let total=0;v.forEach(x=>{String(C128[x]).split('').forEach(d=>{w.push(+d);total+=+d})});return{w,total,v}}

/* ------------------------------------------------------------------ text fitting (Helvetica metrics, same as the PDF font) */
const latin=s=>{let o='';for(const ch of String(s==null?'':s)){const c=ch.codePointAt(0);if(c>=32&&c<=126||c>=160&&c<=255)o+=ch;else if(c==9)o+=' ';else if(c==0x2013||c==0x2014||c==0x2212)o+='-';else if(c==0x2018||c==0x2019)o+="'";else if(c==0x201c||c==0x201d)o+='"'}return o.replace(/\s+/g,' ').trim()};
function tmm(str,size,bold){let w=0;const T=bold?WB:WR;for(let i=0;i<str.length;i++){const c=str.charCodeAt(i);w+=(c>=32&&c<=126)?T[c-32]:556}return w*size/1000*PT}
function wrap(str,maxW,size,bold){const out=[];let cur='';
 const put=w=>{ // a word wider than the line is broken
  while(tmm(w,size,bold)>maxW&&w.length>1){let k=w.length-1;while(k>1&&tmm(w.slice(0,k),size,bold)>maxW)k--;if(cur){out.push(cur);cur=''}out.push(w.slice(0,k));w=w.slice(k)}
  const t=cur?cur+' '+w:w;if(tmm(t,size,bold)<=maxW)cur=t;else{if(cur)out.push(cur);cur=w}};
 str.split(' ').filter(Boolean).forEach(put);if(cur)out.push(cur);return out}
function fitText(str,maxW,maxLines,smax,smin,bold){str=latin(str);if(!str)return{lines:[],size:smin};
 for(let s=smax;s>=smin-1e-6;s-=.5){const L=wrap(str,maxW,s,bold);if(L.length<=maxLines)return{lines:L,size:s}}
 let L=wrap(str,maxW,smin,bold).slice(0,maxLines),l=L[L.length-1];while(l.length>1&&tmm(l+'...',smin,bold)>maxW)l=l.slice(0,-1);L[L.length-1]=l+'...';return{lines:L,size:smin}}

/* ------------------------------------------------------------------ label layout: shapes in millimetres */
// d = {name, price, code, type:'bar'|'qr', showPrice, px, py, qr:{n,dark(r,c)}}
function labelPrims(W,H,d){
 const P=[],px=d.px==null?1.6:d.px,py=d.py==null?1.4:d.py,iw=W-2*px;let warn='';
 const text=(x,y,s,size,bold,anchor)=>P.push({t:'text',x,y,s,size,bold:!!bold,a:anchor||'l'});
 const priceStr=d.showPrice&&d.price>0?'UGX '+F0(d.price):'';
 if(d.type=='qr'&&d.qr){
  const n=d.qr.n,q=Math.min(H-2*py,W*.5),ms=q/(n+4),qy=(H-q)/2;
  P.push({t:'qr',x:px,y:qy,ms,n,q:d.qr});
  const x0=px+q+1.6,rw=W-x0-px;
  const nm=fitText(d.name,rw,H>=28?4:3,H>=28?9:7,5.5,true);let y=py;
  const lh=nm.size*PT*1.15;nm.lines.forEach(l=>{y+=lh;text(x0,y-lh*.2,l,nm.size,true)});
  if(priceStr){const ps=Math.min(11,Math.max(7,H*.26));const f=fitText(priceStr,rw,1,ps,6,true);y+=f.size*PT*1.3;text(x0,y-f.size*PT*.25,f.lines[0],f.size,true)}
  const cs=fitText(d.code,rw,1,7,4.5,false);text(x0,H-py-cs.size*PT*.2,cs.lines[0]||'',cs.size,false);
  return{prims:P,warn:ms<.35?'QR is small on this label size':''}}
 // barcode label
 const b=c128(d.code);
 const nm=fitText(d.name,iw,H>=34?2:(H>=22?2:1),H>=34?9:7.5,5.5,true);
 const nlh=nm.size*PT*1.15;let y=py;
 nm.lines.forEach(l=>{y+=nlh;text(W/2,y-nlh*.2,l,nm.size,true,'c')});
 let ps=0,pH=0;if(priceStr){ps=Math.min(11,Math.max(7,H*.24));pH=ps*PT*1.25}
 if(priceStr){y+=pH;text(W/2,y-ps*PT*.22,priceStr,ps,true,'c')}
 const csz=Math.min(7,Math.max(5,W*.11)),cH=csz*PT*1.25;
 const barH=Math.max(4,H-py-y-cH-.8);
 if(b){const mw=iw/(b.total+12);if(mw<.2)warn='Code is long for this label size, it may not scan';
  const tw=b.total*mw;let x=px+(iw-tw)/2;const by=y+.6;
  for(let i=0;i<b.w.length;i++){const w=b.w[i]*mw;if(i%2==0)P.push({t:'rect',x,y:by,w,h:barH});x+=w}
  const cs=fitText(d.code,iw,1,csz,4.5,false);text(W/2,H-py-cs.size*PT*.18,cs.lines[0]||'',cs.size,false,'c')}
 else warn='This code cannot be drawn as a barcode';
 return{prims:P,warn}}

/* ------------------------------------------------------------------ SVG renderer (for the print page and the preview) */
function svgLabel(W,H,L,o){o=o||{};const f=n=>(+n).toFixed(3).replace(/\.?0+$/,'');
 let bars='',s='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'mm" height="'+H+'mm" viewBox="0 0 '+f(W)+' '+f(H)+'" style="display:block;background:#fff">';
 if(o.border)s+='<rect x=".15" y=".15" width="'+f(W-.3)+'" height="'+f(H-.3)+'" fill="none" stroke="#999" stroke-width=".2" stroke-dasharray="1 .8"/>';
 L.prims.forEach(p=>{
  if(p.t=='rect')bars+='M'+f(p.x)+' '+f(p.y)+'h'+f(p.w)+'v'+f(p.h)+'h-'+f(p.w)+'z';
  else if(p.t=='qr'){for(let r=0;r<p.n;r++)for(let c=0;c<p.n;c++)if(p.q.dark(r,c))bars+='M'+f(p.x+(c+2)*p.ms)+' '+f(p.y+(r+2)*p.ms)+'h'+f(p.ms)+'v'+f(p.ms)+'h-'+f(p.ms)+'z'}
  else if(p.t=='text')s+='<text x="'+f(p.x)+'" y="'+f(p.y)+'" font-family="Helvetica,Arial,sans-serif" font-size="'+f(p.size*PT)+'" font-weight="'+(p.bold?700:400)+'" text-anchor="'+(p.a=='c'?'middle':'start')+'" fill="#000">'+E(p.s)+'</text>'});
 return s+(bars?'<path d="'+bars+'" fill="#000" shape-rendering="crispEdges"/>':'')+'</svg>'}

/* ------------------------------------------------------------------ PDF writer (labels only; no outside library) */
// pages: [{w,h (mm), items:[{x,y,W,H,L,border}] }]
function pdfLabels(pages){
 const M=72/25.4,f=n=>(+n).toFixed(2).replace(/\.?0+$/,''),esc=s=>latin(s).replace(/[\\()]/g,'\\$&');
 const objs=[];const add=s=>{objs.push(s);return objs.length};
 add('<< /Type /Catalog /Pages 2 0 R >>');add('');add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
 const kids=[];
 pages.forEach(pg=>{let c='0 g\n';const PH=pg.h;
  pg.items.forEach(it=>{
   if(it.border)c+='0.6 G 0.25 w ['+f(2)+' '+f(2)+'] 0 d '+f(it.x*M)+' '+f((PH-it.y-it.H)*M)+' '+f(it.W*M)+' '+f(it.H*M)+' re S [] 0 d 0 G\n';
   it.L.prims.forEach(p=>{
    if(p.t=='rect')c+=f((it.x+p.x)*M)+' '+f((PH-it.y-p.y-p.h)*M)+' '+f(p.w*M)+' '+f(p.h*M)+' re f\n';
    else if(p.t=='qr'){for(let r=0;r<p.n;r++){let c0=-1;for(let k=0;k<=p.n;k++){const d=k<p.n&&p.q.dark(r,k);if(d&&c0<0)c0=k;if(!d&&c0>=0){c+=f((it.x+p.x+(c0+2)*p.ms)*M)+' '+f((PH-it.y-p.y-(r+3)*p.ms)*M)+' '+f((k-c0)*p.ms*M)+' '+f(p.ms*M)+' re f\n';c0=-1}}}}
    else if(p.t=='text'){const w=tmm(latin(p.s),p.size,p.bold),x=it.x+p.x-(p.a=='c'?w/2:0);c+='BT /F'+(p.bold?2:1)+' '+f(p.size)+' Tf '+f(x*M)+' '+f((PH-it.y-p.y)*M)+' Td ('+esc(p.s)+') Tj ET\n'}})});
  const ci=add('<< /Length '+c.length+' >>\nstream\n'+c+'endstream');
  kids.push(add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+f(pg.w*M)+' '+f(pg.h*M)+'] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '+ci+' 0 R >>'))});
 objs[1]='<< /Type /Pages /Count '+kids.length+' /Kids ['+kids.map(k=>k+' 0 R').join(' ')+'] >>';
 let out='%PDF-1.4\n',off=[];objs.forEach((o,i)=>{off.push(out.length);out+=(i+1)+' 0 obj\n'+o+'\nendobj\n'});
 const xr=out.length;out+='xref\n0 '+(objs.length+1)+'\n0000000000 65535 f \n'+off.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(objs.length+1)+' /Root 1 0 R >>\nstartxref\n'+xr+'\n%%EOF';
 const u=new Uint8Array(out.length);for(let i=0;i<out.length;i++)u[i]=out.charCodeAt(i)&255;return u}

/* ================================================================== CAMERA SCANNER */
const S={open:0,opts:null,stream:null,track:null,video:null,eng:'',det:null,zx:null,cv:null,timer:0,seen:{},busy:0,cont:false,torch:false,fails:0,devs:[],lockAt:0,bnT:0,list:[]};
const libP={};
function loadJS(src){return libP[src]||(libP[src]=new Promise((ok,no)=>{const s=document.createElement('script');s.src=src;s.onload=()=>ok();s.onerror=()=>{delete libP[src];no(new Error('Could not load '+src))};document.head.appendChild(s)}))}
const toastS=m=>{try{toast(m)}catch(e){}};

/* ---- sound and vibration ---- */
let AC=null;
function beep(kind){if(!prefs().sound)return;try{AC=AC||new(window.AudioContext||window.webkitAudioContext)();if(AC.state==='suspended')AC.resume();const o=AC.createOscillator(),g=AC.createGain();o.type='square';o.frequency.value=kind=='ok'?1500:kind=='warn'?800:280;g.gain.value=.07;o.connect(g);g.connect(AC.destination);o.start();o.stop(AC.currentTime+(kind=='ok'?.09:.24))}catch(e){}}
function buzz(kind){if(!prefs().vib)return;try{if(navigator.vibrate)navigator.vibrate(kind=='ok'?60:[90,70,90])}catch(e){}}
function feedback(kind){beep(kind);buzz(kind)}

/* ---- Android back button closes the scanner / screens instead of leaving the app ---- */
const NAV=[];let skipPop=0;
function navPush(fn){try{history.pushState({okpScan:1},'')}catch(e){}NAV.push(fn)}
function navDrop(fn){const i=NAV.lastIndexOf(fn);if(i>=0)NAV.splice(i,1)}
window.addEventListener('popstate',()=>{const fn=NAV.pop();if(fn)fn(true)});

/* ---- sheets: small panels that slide over everything (not found, choose product...) ---- */
function sheetEl(){return document.getElementById('okpsh')}
function closeSheet(){const e=sheetEl();if(e)e.remove()}
function sheet(html,mount){closeSheet();const d=document.createElement('div');d.id='okpsh';d.innerHTML='<div class="shb">'+html+'</div>';d.addEventListener('click',e=>{if(e.target===d){closeSheet()}});document.body.appendChild(d);if(mount)mount(d.firstChild);return d.firstChild}

function matchWords(p,q){const w=String(q||'').toLowerCase().trim().split(/\s+/).filter(Boolean);if(!w.length)return true;const h=(p.name+' '+(p.cat||'')+' '+(p.code||'')).toLowerCase(),b=hay(p);return w.every(k=>h.includes(k)||(k.length>=4&&b.includes(k)))}
// pick one product from a searchable list. o:{title, sub, list, firstNoBc, onPick, extra(html), cancel}
function pickSheet(o){
 const L0=(o.list||prod()).slice();
 sheet('<h2>'+E(o.title||'Choose product')+'</h2>'+(o.sub?'<p class="mut">'+o.sub+'</p>':'')+'<input id="pks" type="search" placeholder="Search product name" autocomplete="off"><div id="pkl" class="pkl"></div><button class="btn" id="pkx">'+E(o.cancel||'Cancel')+'</button>',el=>{
  const inp=el.querySelector('#pks'),box=el.querySelector('#pkl');
  const draw=()=>{const q=inp.value;let L=L0.filter(p=>matchWords(p,q));if(o.firstNoBc)L.sort((a,b)=>(codesOf(a).length>0)-(codesOf(b).length>0)||a.name.localeCompare(b.name));
   const more=L.length>40;L=L.slice(0,40);
   box.innerHTML=L.map(p=>'<button class="item" data-id="'+p.id+'"><span class="nm"><b>'+E(p.name)+'</b><small>'+E(p.cat||'')+(codesOf(p).length?' · '+codesOf(p).length+' code'+(codesOf(p).length>1?'s':''):' · <span class="low">no barcode</span>')+'</small></span><span class="pr">'+(p.price>0?F0(p.price):'')+'</span></button>').join('')+(more?'<small class="mut">Showing 40. Type more letters to narrow down.</small>':'')||'<div class="empty">No product found</div>'};
  inp.oninput=draw;draw();
  box.onclick=e=>{const b=e.target.closest('button[data-id]');if(!b)return;const p=prod().find(x=>x.id==b.dataset.id);if(p){closeSheet();o.onPick(p)}};
  el.querySelector('#pkx').onclick=()=>{closeSheet();if(o.onCancel)o.onCancel()};
  if(!/Android|iPhone/i.test(navigator.userAgent))inp.focus()})}

/* ---- put a barcode on a product (asks before taking it from another product) ---- */
function attach(p,code,done){
 code=clean(code);const o=owners(code,p.id);
 const go=()=>{o.forEach(x=>{x.bc=bcs(x).filter(c=>key(c)!=key(code));if(x.code&&key(x.code)==key(code))x.code=''});
  const l=bcs(p);if(!l.some(c=>key(c)==key(code)))l.push(code);p.bc=l;save();if(done)done(p)};
 if(o.length)askc('Barcode '+code+' is already on "'+o.map(x=>x.name).join('", "')+'".\nMove it to "'+p.name+'"?',go);else go()}
function needEdit(){if(canEdit())return true;if(!document.getElementById('dlg'))toastS('Only the owner or manager can add or change products.');return false}

/* ---- what happens with a scanned code. ctx = { onFound(p,code) -> result, raw(code)?, title? } ---- */
async function process(code,ctx,after){
 code=clean(code);if(!code)return;
 if(ctx.raw)return after(await ctx.raw(code));
 const f=find(code);
 if(!f)return unknownSheet(code,ctx,after);
 if(f.all.length>1){feedback('warn');return pickSheet({title:'Which product?',sub:'Barcode <b>'+E(code)+'</b> is on '+f.all.length+' products. Choose the right one.',list:f.all,onPick:async p=>after(await ctx.onFound(p,code))})}
 after(await ctx.onFound(f.p,code))}

function unknownSheet(code,ctx,after){
 feedback('bad');
 const sh=sheet('<h2>Not found</h2><p>The code <b>'+E(code)+'</b> is not on any product.</p><button class="btn big" id="u1">🔗 Attach to an existing product</button><button class="btn" id="u2">➕ New product with this barcode</button><button class="btn" id="u3">Skip</button>',el=>{
  el.querySelector('#u3').onclick=()=>{closeSheet();after({skip:1,title:'Skipped '+code})};
  el.querySelector('#u1').onclick=()=>{if(!needEdit())return;closeSheet();pickSheet({title:'Attach '+code+' to…',sub:'Choose the product this barcode belongs to.',firstNoBc:true,onPick:p=>attach(p,code,async p2=>{after(await ctx.onFound(p2,code))}),onCancel:()=>unknownSheet(code,ctx,after)})};
  el.querySelector('#u2').onclick=()=>{if(!needEdit())return;closeSheet();const md=document.getElementById('md');if(md&&md.dataset.hold){delete md.dataset.hold;md.style.display=''}S.pend={code,cb:async np=>after(await ctx.onFound(np,code))};pform(0,{bc:[code]})}})}
// called by pform when a new product is saved
function created(np){const pd=S.pend;if(!pd)return;if(owners(pd.code).some(x=>x.id==np.id)){S.pend=null;setTimeout(()=>pd.cb(np),0)}}

/* ---- camera ---- */
const WANT=['ean_13','ean_8','upc_a','upc_e','code_128','code_39','code_93','itf','codabar','qr_code','data_matrix'];
function camMsg(e){const n=e&&e.name||'';
 if(n=='NotAllowedError'||n=='PermissionDeniedError')return'Camera permission was denied.\n\nTo allow it: tap the lock (or ⓘ) icon next to the web address, open Permissions, set Camera to Allow, then tap Try again. If Chrome says it is blocked: Chrome menu → Settings → Site settings → Camera.';
 if(n=='NotFoundError'||n=='DevicesNotFoundError')return'No camera was found on this phone.';
 if(n=='NotReadableError'||n=='TrackStartError')return'The camera is busy. Close other apps that use the camera (video calls, camera app) and tap Try again.';
 if(n=='SecurityError'||(window.isSecureContext===false))return'The camera only works on the secure (https) web address of the app.';
 if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)return'This browser cannot open the camera. Use Chrome, or a Bluetooth/USB scanner, or type the code below.';
 return'The camera could not start ('+(n||'error')+'). Tap Try again, or type the code below.'}
function ovHtml(o){return'<div class="sct"><b>'+E(o.title)+'</b><button id="scx" aria-label="Close scanner">✕ Close</button></div>'
 +'<div class="scv"><video playsinline muted autoplay></video><div class="scf"></div><div id="scbn" class="scbn hide"></div><div id="scms" class="scms hide"></div></div>'
 +'<div class="sctl"><button id="sctor" class="hide">🔦 Light</button><button id="sccam" class="hide">🔄 Camera</button><button id="sceng" class="hide"></button><button id="scsnd"></button></div>'
 +'<input id="sczm" type="range" class="hide" aria-label="Zoom">'
 +(o.cont===null?'':'<label class="sck"><input type="checkbox" id="sccont"> <span>Keep scanning (scan many items one after another)</span></label>')
 +'<div class="scb"><div class="scman"><input id="scin" placeholder="Or type / paste the code" autocomplete="off" inputmode="text"><button id="scok" class="btn">OK</button></div>'
 +(o.hint?'<small class="mut">'+o.hint+'</small>':'')+'<div id="scl"></div></div>'
 +'<div class="scd"><button id="scdone" class="btn big"></button></div>'}
function openScanner(o){
 if(S.open)closeScanner(true);
 S.opts=o;S.open=1;S.seen={};S.list=[];S.busy=0;S.torch=false;S.fails=0;
 const pf=prefs();S.cont=o.cont===null?false:(o.cont===undefined?!!pf.cont[o.mode]:!!o.cont);
 const md=document.getElementById('md');if(o.holdModal&&md){md.dataset.hold='1';md.style.display='none'}
 const ov=document.createElement('div');ov.id='scn';ov.innerHTML=ovHtml(o);document.body.appendChild(ov);document.body.classList.add('scn-on');
 S.video=ov.querySelector('video');
 const $o=s=>ov.querySelector(s);
 $o('#scx').onclick=()=>closeScanner();
 $o('#scdone').onclick=()=>closeScanner();
 const ck=$o('#sccont');if(ck){ck.checked=S.cont;ck.onchange=()=>{S.cont=ck.checked;const c=prefs().cont;c[o.mode]=S.cont?1:0;setPref('cont',c);drawDone()}}
 const snd=$o('#scsnd');const sndT=()=>{const on=prefs().sound;snd.textContent=on?'🔊 Sound on':'🔇 Sound off'};sndT();snd.onclick=()=>{setPref('sound',prefs().sound?0:1);sndT();beep('ok')};
 const man=()=>{const v=$o('#scin').value;if(!clean(v))return;$o('#scin').value='';handle(v,'manual',true)};
 $o('#scok').onclick=man;$o('#scin').onkeydown=e=>{if(e.key=='Enter'){e.preventDefault();e.stopPropagation();man()}};
 $o('#sctor').onclick=toggleTorch;$o('#sccam').onclick=nextCam;
 $o('#sceng').onclick=()=>{const cur=S.eng;setPref('engine',cur=='native'?'zxing':'native');startEngine().then(()=>engBtn())};
 ov.addEventListener('keydown',e=>{if(e.key=='Escape')closeScanner()});
 navPush(S.navFn=()=>closeScanner(true));
 drawList();drawDone();
 document.addEventListener('visibilitychange',visCh);
 startAll();
}
function drawDone(){const b=document.getElementById('scdone');if(!b)return;const o=S.opts;b.textContent=o.doneText?o.doneText(S.cont):(S.cont?'Done':'Cancel');}
function visCh(){if(!S.open)return;if(document.hidden){stopCam()}else startAll()}
async function startAll(){
 const ms=document.getElementById('scms');if(ms){ms.className='scms';ms.innerHTML='<div>Starting camera…</div>'}
 try{await startCam();if(ms)ms.className='scms hide';await startEngine();engBtn();loop()}
 catch(e){if(!S.open)return;const m=document.getElementById('scms');if(m){m.className='scms';m.innerHTML='<div class="scmt"></div><button class="btn big" id="scretry">Try again</button>';m.querySelector('.scmt').textContent=camMsg(e);m.querySelector('#scretry').onclick=startAll}}}
async function startCam(){
 stopCam();
 const md=navigator.mediaDevices;if(!md||!md.getUserMedia)throw{name:'NoApi'};
 const pf=prefs();let v={facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}};
 if(pf.cam)v={deviceId:{ideal:pf.cam},width:{ideal:1280},height:{ideal:720}};
 try{S.stream=await md.getUserMedia({audio:false,video:v})}
 catch(e){if(e&&(e.name=='OverconstrainedError'||e.name=='ConstraintNotSatisfiedError')){S.stream=await md.getUserMedia({audio:false,video:true})}else throw e}
 if(!S.open){stopCam();return}
 S.video.srcObject=S.stream;try{await S.video.play()}catch(e){}
 S.track=S.stream.getVideoTracks()[0];const caps=(S.track.getCapabilities&&S.track.getCapabilities())||{};
 try{if(caps.focusMode&&caps.focusMode.includes('continuous'))await S.track.applyConstraints({advanced:[{focusMode:'continuous'}]})}catch(e){}
 const ov=document.getElementById('scn');if(!ov)return;
 ov.querySelector('#sctor').classList.toggle('hide',!caps.torch);
 const z=ov.querySelector('#sczm');if(caps.zoom&&caps.zoom.max>caps.zoom.min){z.classList.remove('hide');z.min=caps.zoom.min;z.max=caps.zoom.max;z.step=caps.zoom.step||0.1;z.value=(S.track.getSettings&&S.track.getSettings().zoom)||caps.zoom.min;z.oninput=()=>{try{S.track.applyConstraints({advanced:[{zoom:+z.value}]})}catch(e){}}}else z.classList.add('hide');
 try{const d=(await md.enumerateDevices()).filter(x=>x.kind=='videoinput');S.devs=d;ov.querySelector('#sccam').classList.toggle('hide',d.length<2)}catch(e){}
}
function stopCam(){if(S.timer){clearTimeout(S.timer);S.timer=0}if(S.stream){try{S.stream.getTracks().forEach(t=>t.stop())}catch(e){}}S.stream=null;S.track=null;if(S.video)try{S.video.srcObject=null}catch(e){}}
async function toggleTorch(){try{S.torch=!S.torch;await S.track.applyConstraints({advanced:[{torch:S.torch}]});const b=document.getElementById('sctor');if(b)b.classList.toggle('on',S.torch)}catch(e){S.torch=false;toastS('This camera has no light control')}}
async function nextCam(){if(S.devs.length<2)return;const cur=S.track&&S.track.getSettings?S.track.getSettings().deviceId:'';let i=S.devs.findIndex(d=>d.deviceId==cur);i=(i+1)%S.devs.length;setPref('cam',S.devs[i].deviceId);startAll()}
function engBtn(){const b=document.getElementById('sceng');if(!b)return;const nat='BarcodeDetector' in window;b.classList.toggle('hide',!nat);b.textContent=S.eng=='native'?'⚙ Scanner: built-in':'⚙ Scanner: backup'}
// choose the reading engine: built-in BarcodeDetector if Chrome has it, otherwise (or if it fails) the saved ZXing library
async function startEngine(){
 const want=prefs().engine;S.det=null;
 if(want!='zxing'&&'BarcodeDetector' in window){try{let sup=await BarcodeDetector.getSupportedFormats();const f=WANT.filter(x=>sup.includes(x));if(f.length){S.det=new BarcodeDetector({formats:f});S.eng='native';return}}catch(e){}}
 await loadJS('./zxing.min.js');const Z=window.ZXing;if(!Z)throw new Error('The backup scanner library is missing');
 const h=new Map(),BF=Z.BarcodeFormat;h.set(Z.DecodeHintType.POSSIBLE_FORMATS,[BF.EAN_13,BF.EAN_8,BF.UPC_A,BF.UPC_E,BF.CODE_128,BF.CODE_39,BF.CODE_93,BF.ITF,BF.CODABAR,BF.QR_CODE,BF.DATA_MATRIX]);h.set(Z.DecodeHintType.TRY_HARDER,true);
 S.zx=new Z.MultiFormatReader();S.zx.setHints(h);S.cv=S.cv||document.createElement('canvas');S.eng='zxing'}
function loop(){if(!S.open||!S.stream)return;S.timer=setTimeout(tick,S.eng=='native'?90:170)}
async function tick(){
 if(!S.open||!S.stream)return;
 try{
  const now=Date.now();
  if(now-S.lockAt>2500){S.lockAt=now;if(window.okpAcc&&okpAcc.gate&&okpAcc.gate()===false){closeScanner();return}}
  const md=document.getElementById('md');
  const blocked=sheetEl()||document.getElementById('dlg')||(md&&!md.classList.contains('hide')&&md.style.display!='none')||S.busy||document.hidden;
  const v=S.video;
  if(!blocked&&v&&v.readyState>=2&&v.videoWidth){
   let code='',fmt='';
   if(S.eng=='native'){try{const r=await S.det.detect(v);if(r&&r.length){code=r[0].rawValue;fmt=r[0].format}S.fails=0}catch(e){S.fails++;if(S.fails>=3){setPref('engine','zxing');await startEngine();engBtn()}}}
   else{const sc=Math.min(1,960/v.videoWidth),w=Math.round(v.videoWidth*sc),h=Math.round(v.videoHeight*sc);S.cv.width=w;S.cv.height=h;S.cv.getContext('2d',{willReadFrequently:true}).drawImage(v,0,0,w,h);
    try{const Z=window.ZXing,src=new Z.HTMLCanvasElementLuminanceSource(S.cv),bm=new Z.BinaryBitmap(new Z.HybridBinarizer(src)),r=S.zx.decode(bm);code=r.getText();fmt=Z.BarcodeFormat[r.getBarcodeFormat()]||''}catch(e){}}
   if(code)handle(code,fmt,false)}
 }catch(e){}
 loop()}
// a detected or typed code. The same code seen again within about a second is the same item held in front of the camera, so it counts once;
// take it away and show it again (or another item) and it counts again.
async function handle(code,fmt,force){
 code=clean(code);if(!code||!S.open)return;
 const k=key(code),now=Date.now(),last=S.seen[k]||0;S.seen[k]=now;
 if(!force&&now-last<1100)return;
 if(S.busy)return;S.busy=1;
 try{await process(code,S.opts,afterResult)}catch(e){console.warn('scan',e);showBn('bad','Something went wrong',String(e&&e.message||e))}
 finally{S.busy=0}}
function showBn(kind,title,sub){const b=document.getElementById('scbn');if(!b)return;b.className='scbn '+kind;b.innerHTML='<b></b><small></small>';b.firstChild.textContent=title||'';b.lastChild.textContent=sub||'';clearTimeout(S.bnT);S.bnT=setTimeout(()=>{if(b)b.className='scbn hide'},kind=='bad'?4000:2600)}
function afterResult(r){
 if(!S.open||!r)return;
 if(r.skip){showBn('warn',r.title||'Skipped','');return}
 if(r.ok){feedback(r.warn?'warn':'ok');showBn(r.warn?'warn':'ok','✓ '+r.title,[r.sub,r.warn].filter(Boolean).join(' · '));if(r.entry)S.list=[r.entry].concat(S.list.filter(x=>x.id!=r.entry.id)).slice(0,60);drawList();drawDone();if(r.close||!S.cont)closeScanner(false,r)}
 else{feedback('bad');showBn('bad',r.title||'Not found',r.sub||'')}}
function drawList(){const l=document.getElementById('scl');if(!l)return;const o=S.opts;l.innerHTML=o.list?o.list(S.list):''}
function closeScanner(fromPop,res){
 if(!S.open)return;S.open=0;
 document.removeEventListener('visibilitychange',visCh);stopCam();closeSheet();
 const ov=document.getElementById('scn');if(ov)ov.remove();document.body.classList.remove('scn-on');
 const md=document.getElementById('md');if(md&&md.dataset.hold){delete md.dataset.hold;md.style.display=''}
 if(S.navFn){navDrop(S.navFn);S.navFn=null}
 const o=S.opts;S.opts=null;
 try{if(o&&o.onClose)o.onClose(res||null,S.list)}catch(e){console.warn(e)}}

/* ================================================================== USES OF THE SCANNER */
const stockOf=p=>{try{return stk()[p.name]||0}catch(e){return 0}};
const stockTxt=p=>{const n=Math.round(stockOf(p)*100)/100;return n+' '+(p.unit||'')};
const nameKey=p=>'p'+p.id;

/* ---- SELL: add to the cart; a repeat scan adds one more ---- */
function sellAdd(p){const c=st.cart;let l=c.find(x=>x.n==p.name);if(l)l.q++;else{l={n:p.name,q:1,p:p.price,c:costNow(p)};c.push(l)}return l}
function sellRes(p){const l=sellAdd(p),s=stockOf(p);
 return{ok:true,title:p.name,sub:'×'+l.q+' · UGX '+F0(l.p)+' each',warn:p.price>0?(s<=0?'Stock shows '+Math.round(s*100)/100+' (added anyway)':''):'No selling price set',entry:{id:nameKey(p),n:p.name}}}
function sellList(){const c=st.cart;if(!c.length)return'<div class="empty">Scanned items appear here</div>';
 const T=c.reduce((a,i)=>a+i.q*i.p,0),n=c.reduce((a,i)=>a+i.q,0);
 return c.map((i,x)=>'<div class="item" style="cursor:default"><span class="nm"><b>'+E(i.n)+'</b><small>UGX '+F0(i.p)+' each</small></span><span class="scq"><button aria-label="One less" onclick="okpScan._q('+x+',-1)">−</button><b>'+i.q+'</b><button aria-label="One more" onclick="okpScan._q('+x+',1)">+</button></span><span class="pr">'+F0(i.q*i.p)+'</span></div>').join('')+'<div class="stat wide"><small>'+n+' item'+(n==1?'':'s')+' in the cart</small><span class="num">UGX '+F0(T)+'</span></div>'}
function _q(i,d){const l=st.cart[i];if(!l)return;l.q=Math.round((l.q+d)*1000)/1000;if(l.q<=0)st.cart.splice(i,1);drawList();drawDone()}
function sell(){
 openScanner({mode:'sell',title:'Scan to sell',hint:'Point the camera at a barcode or QR code. Each scan adds one to the cart.',
  onFound:async p=>sellRes(p),list:sellList,doneText:()=>st.cart.length?'View cart':'Close',
  onClose:()=>{st.q='';if(st.co){cr()}else{render();if(st.cart.length)cartfs(1)}}})}

function sqKey(e,el){if(e.key!=='Enter')return;const code=clean(el.value);if(!code||!find(code))return;e.preventDefault();
 process(code,{onFound:async p=>sellRes(p)},r=>{if(r&&r.ok){feedback(r.warn?'warn':'ok');toastS('✓ '+r.title+' '+r.sub)}st.q='';if(st.co)cr();else render()})}

/* ---- CHECK A PRICE ---- */
function priceRes(p){return{ok:true,title:p.name,sub:'Selling UGX '+F0(p.price),entry:{id:nameKey(p),n:p.name,code:true}}}
function priceList(L){if(!L.length)return'<div class="empty">Scanned prices appear here</div>';
 return L.map(e=>{const p=prod().find(x=>nameKey(x)==e.id);if(!p)return'';return'<div class="pcr"><div><b>'+E(p.name)+'</b><small>'+E(p.cat||'')+' · '+E(stockTxt(p))+' in stock</small></div><div class="pcp">'+(p.price>0?F0(p.price):'no price')+'<small>selling · per '+E(p.unit||'unit')+'</small>'+(canCost()?'<span style="display:block;font-size:15px;font-weight:600;margin-top:3px">'+(costNow(p)>0?F0(costNow(p)):'no cost')+'</span><small>buying</small>':'')+'</div></div>'}).join('')}
function price(){let lastCode='';
 openScanner({mode:'price',title:'Check a price',hint:'Scan an item to see its selling'+(canCost()?' and buying':'')+' price.',
  onFound:async(p,code)=>{lastCode=code;return priceRes(p)},list:priceList,doneText:()=>'Done',
  onClose:(r,L)=>{if(lastCode){st.pcq=lastCode;const i=document.getElementById('pcq');if(i){i.value=lastCode;if(typeof pcs==='function')pcs(lastCode)}}}})}

/* ---- STOCK LIST: find an item ---- */
function find1(){openScanner({mode:'find',title:'Find an item',cont:null,hint:'Scan the item to open it.',onFound:async p=>({ok:true,title:p.name,sub:'',close:true,p}),onClose:r=>{if(r&&r.p)card(r.p)}})}
function card(p){
 const cs=codesOf(p);
 modal('<h2>'+E(p.name)+'</h2>'
  +'<div class="item" style="cursor:default"><span class="nm"><b>In stock</b><small>'+E(p.cat||'')+'</small></span><span class="pr">'+E(stockTxt(p))+'</span></div>'
  +'<div class="item" style="cursor:default"><span class="nm"><b>Selling price</b><small>per '+E(p.unit||'unit')+'</small></span><span class="pr">UGX '+F0(p.price)+'</span></div>'
  +(canCost()?'<div class="item" style="cursor:default"><span class="nm"><b>Buying price</b><small>latest cost per '+E(p.unit||'unit')+'</small></span><span class="pr">UGX '+F0(costNow(p))+'</span></div>':'')
  +'<div class="item" style="cursor:default"><span class="nm"><b>Barcodes</b><small>'+(cs.length?cs.map(E).join(' · '):'none yet')+'</small></span></div>'
  +'<button class="btn big" id="cdE">Edit product</button><button class="btn" id="cdL">🏷 Print label</button><button class="btn" id="cdX">Close</button>');
 document.getElementById('cdE').onclick=()=>{modal();pform(p.id)};
 document.getElementById('cdL').onclick=()=>{modal();labels([p.id])};
 document.getElementById('cdX').onclick=()=>modal()}

/* ---- STOCK ARRIVING: pick the product in the form ---- */
function recvPick(p){const q=document.getElementById('psq'),sel=document.getElementById('f_n');if(!sel){if(typeof uform==='function'&&!recvPick._r){recvPick._r=1;uform();setTimeout(()=>{recvPick._r=0;recvPick(p)},80)}return}
 if(q){q.value=p.name;if(q.oninput)q.oninput()}
 if(![...sel.options].some(o=>o.value==p.name)){const o=document.createElement('option');o.textContent=p.name;sel.appendChild(o)}
 sel.value=p.name;sel.dispatchEvent(new Event('change'));const n=document.getElementById('psn');if(n)n.textContent='Scanned: '+p.name;
 const qty=document.getElementById('f_q');if(qty){qty.focus();try{qty.select()}catch(e){}}}
// the scanner above hides the form while it is open; picking happens through this wrapper
function recvGo(){openScanner({mode:'recv',title:'Scan the goods arriving',cont:null,holdModal:true,hint:'Scan one item to choose it in the form.',
 onFound:async p=>({ok:true,title:p.name,sub:'',close:true,p}),onClose:r=>{if(r&&r.p)setTimeout(()=>recvPick(r.p),30)}})}

/* ---- PRODUCT FORM: barcode field, scan to attach, internal code ---- */
function fieldCodes(){const f=document.getElementById('f_bcs');return f?parseCsv(f.value):[]}
function fieldWarn(){const f=document.getElementById('f_bcs'),w=document.getElementById('bcw');if(!f||!w)return;const pid=S.formPid;
 const msgs=[];fieldCodes().forEach(c=>{const o=owners(c,pid);if(o.length)msgs.push('⚠ '+E(c)+' is already on '+E(o.map(x=>x.name).join(', ')))});w.innerHTML=msgs.join('<br>')}
function fieldAdd(code){const f=document.getElementById('f_bcs');if(!f)return;const l=fieldCodes();if(!l.some(c=>key(c)==key(code)))l.push(clean(code));f.value=l.join(', ');fieldWarn()}
function formUI(p){ // called after pform built its form
 S.formPid=p&&p.id;const f=document.getElementById('f_bcs');if(!f)return;
 f.setAttribute('inputmode','text');f.placeholder='Type or scan. Several: separate with a comma';f.oninput=fieldWarn;
 f.insertAdjacentHTML('afterend','<div id="bcw" class="bcw low"></div><div class="bcrow"><button class="btn" type="button" id="bcS">📷 Scan to attach</button><button class="btn" type="button" id="bcG">🏷 Make a shop code</button></div><small class="mut" style="display:block;margin:-2px 0 10px">A shop code (OK…) is for items with no barcode: you print it as a label. The old "Code" box above also works when scanning.</small>');
 document.getElementById('bcS').onclick=()=>openScanner({mode:'attach',title:'Scan to attach',cont:null,holdModal:true,hint:'Scan the barcode on the item. It is added to this product when you tap Save.',
  raw:async code=>{fieldAdd(code);return{ok:true,title:'Barcode '+code,sub:'added to the form',close:true}},onClose:()=>{}});
 document.getElementById('bcG').onclick=()=>{const l=fieldCodes();if(l.some(isInternal)){toastS('This product already has a shop code');return}fieldAdd(newInternal(l))};
 fieldWarn()}
// called from pform's save. Returns '' (fine), 'wait' (asked the user something) or a message to show.
function formSave(r,p,again){
 const l=parseCsv(r.bcs);delete r.bcs;
 const conf=[];l.forEach(c=>owners(c,p&&p.id).forEach(o=>conf.push({c,o})));
 if(conf.length&&!S.moveOK){askc(conf.map(x=>'Barcode '+x.c+' is already on "'+x.o.name+'"').join('\n')+'\n\nMove it to this product?',()=>{S.moveOK=1;again()});return'wait'}
 if(conf.length&&S.moveOK){conf.forEach(x=>{x.o.bc=bcs(x.o).filter(c=>key(c)!=key(x.c));if(x.o.code&&key(x.o.code)==key(x.c))x.o.code=''})}
 S.moveOK=0;r.bc=l;return''}

/* ---- BULK: scan and attach barcodes to many products ---- */
function bulkStats(){const P=prod(),n=P.filter(p=>codesOf(p).length==0).length;return{all:P.length,none:n}}
function bulk(){
 if(!needEdit())return;
 let scr=document.getElementById('okpscr');if(scr)scr.remove();
 scr=document.createElement('div');scr.id='okpscr';document.body.appendChild(scr);
 let flt='none',q='',done=0;const fn=()=>{scr.remove();render()},close=()=>{navDrop(fn);fn()};navPush(fn);
 const draw=()=>{const P=prod(),st0=bulkStats();
  let L=P.filter(p=>matchWords(p,q));if(flt=='none')L=L.filter(p=>codesOf(p).length==0);L.sort((a,b)=>a.name.localeCompare(b.name));const more=L.length>60;L=L.slice(0,60);
  scr.innerHTML='<div class="sct"><b>Attach barcodes</b><button id="bkx">✕ Close</button></div><div class="scs"><div class="stat wide"><small>Products with a barcode</small><span class="num">'+(st0.all-st0.none)+' of '+st0.all+'</span></div>'
   +'<button class="btn big" id="bkA">📷 Scan an item, then pick its product</button><button class="btn" id="bkB">📋 Go down the list: I scan, it moves to the next</button>'
   +(done?'<small class="ok">Attached in this session: '+done+'</small>':'')
   +'<div class="seg"><button id="bkf1" class="'+(flt=='none'?'on':'')+'">Without barcode ('+st0.none+')</button><button id="bkf2" class="'+(flt=='all'?'on':'')+'">All products</button></div>'
   +'<input id="bkq" type="search" placeholder="Search product" value="'+E(q)+'" autocomplete="off"><div id="bkl">'
   +(L.map(p=>'<button class="item" data-id="'+p.id+'"><span class="nm"><b>'+E(p.name)+'</b><small>'+(codesOf(p).length?E(codesOf(p).join(' · ')):'<span class="low">no barcode</span>')+'</small></span><span class="pr">📷 Scan</span></button>').join('')||'<div class="empty">'+(flt=='none'?'Every product has a barcode 🎉':'No product found')+'</div>')+(more?'<small class="mut">Showing 60. Search to narrow down.</small>':'')+'</div></div>';
  scr.querySelector('#bkx').onclick=close;
  scr.querySelector('#bkf1').onclick=()=>{flt='none';draw()};scr.querySelector('#bkf2').onclick=()=>{flt='all';draw()};
  const qi=scr.querySelector('#bkq');qi.oninput=()=>{q=qi.value;const pos=qi.selectionStart;draw();const n=scr.querySelector('#bkq');n.focus();try{n.setSelectionRange(pos,pos)}catch(e){}};
  scr.querySelector('#bkA').onclick=()=>scanFirst();scr.querySelector('#bkB').onclick=()=>scanList();
  scr.querySelector('#bkl').onclick=e=>{const b=e.target.closest('button[data-id]');if(!b)return;const p=prod().find(x=>x.id==b.dataset.id);if(p)scanOne(p)}};
 const attached=(p,code)=>{done++;return{ok:true,title:p.name,sub:'barcode '+code+' attached',entry:{id:nameKey(p),n:p.name,code}}};
 const bList=L=>L.length?L.map(e=>'<div class="item" style="cursor:default"><span class="nm"><b>'+E(e.n)+'</b><small>'+E(e.code||'')+'</small></span><span class="pr ok">✓</span></div>').join(''):'<div class="empty">Attached items appear here</div>';
 // A: scan first, then say which product it is
 function scanFirst(){openScanner({mode:'bulk',title:'Scan items to attach',holdModal:false,hint:'Scan an item. If its barcode is new you choose the product it belongs to.',
  raw:code=>new Promise(res=>{const o=owners(code);
   if(o.length){res({ok:false,title:'Already on '+o[0].name,sub:code});return}
   feedback('warn');pickSheet({title:'Which product is this?',sub:'Barcode <b>'+E(code)+'</b>. Products without a barcode are listed first.',firstNoBc:true,onPick:p=>attach(p,code,p2=>res(attached(p2,code))),onCancel:()=>res({skip:1,title:'Skipped '+code})})}),
  list:bList,doneText:()=>'Done',onClose:()=>draw()})}
 // B: one product at a time from the list
 function scanList(){let cur=null;const next=()=>{const L=prod().filter(p=>codesOf(p).length==0).sort((a,b)=>a.name.localeCompare(b.name));return L.find(p=>!skipped.has(p.id))||null};const skipped=new Set();cur=next();if(!cur){toastS('Every product already has a barcode');return}
  const ttl=()=>cur?'Scan for: '+cur.name:'All done';
  openScanner({mode:'bulk',title:ttl(),holdModal:false,hint:'Scan the item named at the top. It moves to the next product by itself. Use Skip if you do not have the item.',
   raw:code=>new Promise(res=>{if(!cur){res({ok:false,title:'All done'});return}const o=owners(code,cur.id);
    const put=()=>attach(cur,code,p2=>{const r=attached(p2,code);cur=next();const t=document.querySelector('#scn .sct b');if(t)t.textContent=ttl();r.sub='barcode '+code+(cur?' · next: '+cur.name:' · all done');if(!cur)r.close=true;res(r)});
    if(o.length)askc('Barcode '+code+' is already on "'+o[0].name+'". Move it to "'+cur.name+'"?',put);else put()}),
   list:L=>'<button class="btn" id="bkskip">Skip "'+E(cur?cur.name:'')+'"</button>'+bList(L),doneText:()=>'Done',onClose:()=>draw()});
  document.getElementById('scl').addEventListener('click',e=>{if(e.target.id=='bkskip'&&cur){skipped.add(cur.id);cur=next();const t=document.querySelector('#scn .sct b');if(t)t.textContent=ttl();drawList()}})}
 // one product, scan for it
 function scanOne(p){openScanner({mode:'bulk',title:'Scan for: '+p.name,cont:null,holdModal:false,hint:'Scan the barcode on this item.',
  raw:code=>new Promise(res=>{const o=owners(code,p.id);const put=()=>attach(p,code,p2=>{const r=attached(p2,code);r.close=true;res(r)});if(o.length)askc('Barcode '+code+' is already on "'+o[0].name+'". Move it to "'+p.name+'"?',put);else put()}),onClose:()=>draw()})}
 S.bulkCtx={scr,scanFirst,draw};
 draw()}

/* ================================================================== LABEL PRINTER */
const LAYOUTS=[
 {id:'a4_24',name:'A4 sheet · 24 labels (3 × 8, 70 × 37 mm)',sheet:1,W:70,H:37,cols:3,rows:8},
 {id:'a4_40',name:'A4 sheet · 40 labels (4 × 10, 48.5 × 25.4 mm)',sheet:1,W:48.5,H:25.4,cols:4,rows:10},
 {id:'a4_14',name:'A4 sheet · 14 labels (2 × 7, 99 × 38 mm)',sheet:1,W:99.1,H:38.1,cols:2,rows:7},
 {id:'a4_8',name:'A4 sheet · 8 big labels (2 × 4, 99 × 67 mm)',sheet:1,W:99.1,H:67.7,cols:2,rows:4},
 {id:'r58_30',name:'58 mm roll · one label, 30 mm long',sheet:0,W:58,H:30,px:4.5,py:1.5},
 {id:'r58_40',name:'58 mm roll · one label, 40 mm long',sheet:0,W:58,H:40,px:4.5,py:2},
 {id:'r58_50',name:'58 mm roll · one label, 50 mm long',sheet:0,W:58,H:50,px:4.5,py:2.5}];
const LB={sel:new Map(),q:'',flt:'all'};
function loadQR(){return loadJS('./qrcode.js').then(()=>{if(typeof qrcode==='undefined')throw new Error('QR library missing')})}
function mkQR(text){const q=qrcode(0,'M');q.addData(String(text),'Byte');q.make();return{n:q.getModuleCount(),dark:(r,c)=>q.isDark(r,c)}}
// make sure every chosen product has a code; products without one get an OKxxxxxx shop code that is saved on the product
function ensureCodes(ids){const made=[];const extra=[];
 ids.forEach(id=>{const p=prod().find(x=>x.id==id);if(!p)return;if(labelCode(p))return;const c=newInternal(extra);extra.push(c);p.bc=bcs(p).concat([c]);made.push(p)});
 if(made.length)save();return made.length}
function labelItems(o,pick){ // o: {layout, type, showPrice}
 const rows=[];prod().filter(p=>pick.has(p.id)).sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>{const n=pick.get(p.id)||1;for(let i=0;i<n;i++)rows.push(p)});
 return rows}
function oneLabel(p,lay,o,pxy){const code=labelCode(p);const d={name:p.name,price:p.price,code,type:o.type,showPrice:o.showPrice,px:lay.px,py:lay.py};if(o.type=='qr')d.qr=mkQR(code);return labelPrims(lay.W,lay.H,d)}
// returns pages for the PDF and html for the print page
function buildPages(o,pick){
 const lay=LAYOUTS.find(x=>x.id==o.layout)||LAYOUTS[0],rows=labelItems(o,pick),pages=[];let warn='';
 if(lay.sheet){const per=lay.cols*lay.rows,gx=(210-lay.cols*lay.W)/2,gy=(297-lay.rows*lay.H)/2;
  for(let i=0;i<rows.length;i+=per){const items=[];rows.slice(i,i+per).forEach((p,k)=>{const r=Math.floor(k/lay.cols),c=k%lay.cols,L=oneLabel(p,lay,o);if(L.warn)warn=L.warn;items.push({x:gx+c*lay.W,y:gy+r*lay.H,W:lay.W,H:lay.H,L,border:o.cut})});pages.push({w:210,h:297,items})}}
 else rows.forEach(p=>{const L=oneLabel(p,lay,o);if(L.warn)warn=L.warn;pages.push({w:lay.W,h:lay.H,items:[{x:0,y:0,W:lay.W,H:lay.H,L,border:false}]})});
 return{pages,lay,warn,count:rows.length}}
function printHtml(pg,lay,o){let h='';
 pg.pages.forEach(p=>{h+='<div class="lbpg" style="width:'+p.w+'mm;height:'+p.h+'mm">'+p.items.map(it=>'<div style="position:absolute;left:'+it.x.toFixed(2)+'mm;top:'+it.y.toFixed(2)+'mm">'+svgLabel(it.W,it.H,it.L,{border:it.border})+'</div>').join('')+'</div>'});return h}
async function labelsOut(how){ // how: 'print' | 'share' | 'save'
 const o=Object.assign({layout:'a4_24',type:'bar',showPrice:true,cut:true},prefs().lab||{});
 if(!LB.sel.size){toastS('Choose at least one product');return}
 const miss=[...LB.sel.keys()].filter(id=>{const p=prod().find(x=>x.id==id);return p&&!labelCode(p)});
 const go=async()=>{
  try{ensureCodes([...LB.sel.keys()]);if(o.type=='qr')await loadQR();
   const pg=buildPages(o,LB.sel);
   if(how=='print'){let h=document.getElementById('lbp');if(h)h.remove();h=document.createElement('div');h.id='lbp';h.innerHTML=printHtml(pg,pg.lay,o);document.body.appendChild(h);
    const sty=document.createElement('style');sty.id='lbs';sty.textContent='@page{size:'+(pg.lay.sheet?'A4':pg.lay.W+'mm '+pg.lay.H+'mm')+';margin:0}';document.head.appendChild(sty);
    const clean0=()=>{const a=document.getElementById('lbp');if(a)a.remove();const b=document.getElementById('lbs');if(b)b.remove();window.removeEventListener('afterprint',clean0)};window.addEventListener('afterprint',clean0);
    setTimeout(()=>{print();setTimeout(()=>{if(!/Android/i.test(navigator.userAgent))return},0)},60)}
   else{const bytes=pdfLabels(pg.pages),name='labels-'+(typeof td==='function'?td():'')+'.pdf',blob=new Blob([bytes],{type:'application/pdf'});
    if(how=='share'&&navigator.canShare&&navigator.share){const f=new File([blob],name,{type:'application/pdf'});if(navigator.canShare({files:[f]})){try{await navigator.share({files:[f],title:'Labels'});return}catch(e){if(e&&e.name=='AbortError')return}}}
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},4000);toastS('PDF saved to Downloads')}
   if(pg.warn)setTimeout(()=>alert(pg.warn+'. Try a bigger label or QR labels.'),400)}
  catch(e){alert('Could not make the labels: '+(e&&e.message||e))}};
 if(miss.length){if(!needEdit())return;askc(miss.length+' product'+(miss.length>1?'s have':' has')+' no code yet. A shop code (OK + 6 digits) will be made and saved on '+(miss.length>1?'each of them':'it')+'.',go)}else go()}
function labels(ids){
 if(!needEdit())return;
 if(ids&&ids.length){LB.sel=new Map(ids.map(i=>[i,1]))}
 let scr=document.getElementById('okpscr');if(scr)scr.remove();
 scr=document.createElement('div');scr.id='okpscr';document.body.appendChild(scr);
 const fn=()=>scr.remove(),close=()=>{navDrop(fn);fn()};navPush(fn);
 const draw=()=>{
  const o=Object.assign({layout:'a4_24',type:'bar',showPrice:true,cut:true},prefs().lab||{});let L=prod().filter(p=>matchWords(p,LB.q));
  if(LB.flt=='none')L=L.filter(p=>codesOf(p).length==0);else if(LB.flt=='sel')L=L.filter(p=>LB.sel.has(p.id));L.sort((a,b)=>a.name.localeCompare(b.name));const more=L.length>80;L=L.slice(0,80);
  const nSel=LB.sel.size,tot=[...LB.sel.values()].reduce((a,b)=>a+b,0);
  scr.innerHTML='<div class="sct"><b>Print labels</b><button id="lbx">✕ Close</button></div><div class="scs">'
   +'<label>Label size</label><select id="lbL">'+LAYOUTS.map(l=>'<option value="'+l.id+'"'+(l.id==o.layout?' selected':'')+'>'+E(l.name)+'</option>').join('')+'</select>'
   +'<label>What to print</label><select id="lbT"><option value="bar"'+(o.type=='bar'?' selected':'')+'>Barcode (Code 128)</option><option value="qr"'+(o.type=='qr'?' selected':'')+'>QR code</option></select>'
   +'<label class="sck"><input type="checkbox" id="lbP"'+(o.showPrice?' checked':'')+'> <span>Show the price on the label</span></label>'
   +'<label class="sck" id="lbCw"><input type="checkbox" id="lbC"'+(o.cut?' checked':'')+'> <span>Draw cut lines (for plain paper, turn off for sticker sheets)</span></label>'
   +'<div id="lbpv" class="lbpv"></div>'
   +'<div class="seg"><button id="lbf1" class="'+(LB.flt=='all'?'on':'')+'">All</button><button id="lbf2" class="'+(LB.flt=='none'?'on':'')+'">No barcode</button><button id="lbf3" class="'+(LB.flt=='sel'?'on':'')+'">Chosen ('+nSel+')</button></div>'
   +'<input id="lbq" type="search" placeholder="Search product" value="'+E(LB.q)+'" autocomplete="off">'
   +'<div class="seg"><button id="lbSA">Choose all shown</button><button id="lbSN">Choose those without barcode</button><button id="lbCl">Clear</button></div>'
   +'<div id="lbl">'+(L.map(p=>{const n=LB.sel.get(p.id)||0,c=labelCode(p);return'<div class="item lbr" data-id="'+p.id+'"><button class="lbck'+(n?' on':'')+'" data-a="t" aria-label="Choose">'+(n?'✓':'')+'</button><span class="nm"><b>'+E(p.name)+'</b><small>'+(c?E(c):'<span class="low">no code yet · a shop code will be made</span>')+' · UGX '+F0(p.price)+'</small></span>'+(n?'<span class="scq"><button data-a="m" aria-label="One less">−</button><b>'+n+'</b><button data-a="p" aria-label="One more">+</button></span>':'')+'</div>'}).join('')||'<div class="empty">No product found</div>')+(more?'<small class="mut">Showing 80. Search to narrow down.</small>':'')+'</div></div>'
   +'<div class="scd"><div class="lbn">'+nSel+' product'+(nSel==1?'':'s')+' · '+tot+' label'+(tot==1?'':'s')+'</div><div class="lbb"><button class="btn big" id="lbPr">🖨 Print</button><button class="btn" id="lbSh">Share PDF</button><button class="btn" id="lbDl">Save PDF</button></div></div>';
  const setO=(k,v)=>{const x=Object.assign({},prefs().lab||{});x[k]=v;setPref('lab',x)};
  scr.querySelector('#lbx').onclick=close;
  scr.querySelector('#lbL').onchange=e=>{setO('layout',e.target.value);draw()};scr.querySelector('#lbT').onchange=e=>{setO('type',e.target.value);draw()};
  scr.querySelector('#lbP').onchange=e=>{setO('showPrice',e.target.checked);preview()};scr.querySelector('#lbC').onchange=e=>setO('cut',e.target.checked);
  const lay=LAYOUTS.find(x=>x.id==o.layout)||LAYOUTS[0];if(!lay.sheet)scr.querySelector('#lbCw').classList.add('hide');
  scr.querySelector('#lbf1').onclick=()=>{LB.flt='all';draw()};scr.querySelector('#lbf2').onclick=()=>{LB.flt='none';draw()};scr.querySelector('#lbf3').onclick=()=>{LB.flt='sel';draw()};
  const qi=scr.querySelector('#lbq');qi.oninput=()=>{LB.q=qi.value;const pos=qi.selectionStart;draw();const n=scr.querySelector('#lbq');n.focus();try{n.setSelectionRange(pos,pos)}catch(e){}};
  scr.querySelector('#lbSA').onclick=()=>{L.forEach(p=>{if(!LB.sel.has(p.id))LB.sel.set(p.id,1)});draw()};
  scr.querySelector('#lbSN').onclick=()=>{prod().filter(p=>!codesOf(p).length).forEach(p=>{if(!LB.sel.has(p.id))LB.sel.set(p.id,1)});draw()};
  scr.querySelector('#lbCl').onclick=()=>{LB.sel.clear();draw()};
  scr.querySelector('#lbl').onclick=e=>{const b=e.target.closest('button[data-a]');if(!b)return;const id=b.closest('[data-id]').dataset.id,p=prod().find(x=>x.id==id);if(!p)return;const n=LB.sel.get(p.id)||0,a=b.dataset.a;
   if(a=='t'){n?LB.sel.delete(p.id):LB.sel.set(p.id,1)}else if(a=='p')LB.sel.set(p.id,Math.min(200,n+1));else if(a=='m'){n>1?LB.sel.set(p.id,n-1):LB.sel.delete(p.id)}
   const sc=scr.querySelector('.scs').scrollTop;draw();scr.querySelector('.scs').scrollTop=sc};
  scr.querySelector('#lbPr').onclick=()=>labelsOut('print');scr.querySelector('#lbSh').onclick=()=>labelsOut('share');scr.querySelector('#lbDl').onclick=()=>labelsOut('save');
  preview()};
 const preview=async()=>{const el=document.getElementById('lbpv');if(!el)return;const o=Object.assign({layout:'a4_24',type:'bar',showPrice:true,cut:true},prefs().lab||{}),lay=LAYOUTS.find(x=>x.id==o.layout)||LAYOUTS[0];
  const p=LB.sel.size?prod().find(x=>LB.sel.has(x.id)):prod()[0];if(!p){el.innerHTML='';return}
  try{if(o.type=='qr')await loadQR();const code=labelCode(p)||'OK123456',d={name:p.name,price:p.price,code,type:o.type,showPrice:o.showPrice,px:lay.px,py:lay.py};if(o.type=='qr')d.qr=mkQR(code);const L=labelPrims(lay.W,lay.H,d);
   el.innerHTML='<small>Preview of one label ('+lay.W+' × '+lay.H+' mm)'+(labelCode(p)?'':' · the code shown is an example')+(L.warn?' · <span class="low">'+E(L.warn)+'</span>':'')+'</small><div class="lbsv">'+svgLabel(lay.W,lay.H,L,{border:true})+'</div>'}catch(e){el.innerHTML='<small class="low">Preview not available: '+E(e.message)+'</small>'}};
 draw()}

/* ================================================================== KEYBOARD SCANNERS (Bluetooth / USB) */
// These scanners "type" the code very fast and finish with Enter. A burst of fast keys is treated as a scan.
const W={buf:'',t0:0,tl:0,el:null,v0:'',n:0,idle:0};
function wReset(){W.buf='';W.el=null;W.n=0;clearTimeout(W.idle)}
function typing(el){return el&&(el.tagName=='INPUT'||el.tagName=='TEXTAREA')}
function looksLikeCode(c){return /^\d{6,}$/.test(c)||/^OK\d{6}$/.test(c)||(c.length>=6&&/\d/.test(c)&&/^[A-Za-z0-9\-._$\/+%]+$/.test(c))}
function wFinish(why){
 const code=clean(W.buf),n=W.n,el=W.el,v0=W.v0,span=W.tl-W.t0;
 const fast=n>=4&&span/Math.max(1,n-1)<=60;
 wReset();
 if(!fast)return false;
 if(!find(code)&&!looksLikeCode(code))return false;
 // take the typed characters back out of the box they went into
 if(typing(el)){try{el.value=v0;el.dispatchEvent(new Event('input',{bubbles:true}))}catch(e){}}
 route(code);return true}
function route(code){
 if(sheetEl())return;
 if(S.open){handle(code,'keyboard',true);return}
 const fld=document.getElementById('f_bcs');
 if(fld&&document.getElementById('md')&&!document.getElementById('md').classList.contains('hide')){fieldAdd(code);feedback('ok');toastS('Barcode '+code+' added to the form');return}
 const ps=document.getElementById('psq');
 if(ps&&document.getElementById('f_n')){process(code,{onFound:async p=>{recvPick(p);return{ok:true,title:p.name}}},r=>{if(r&&r.ok){feedback('ok');toastS('✓ '+r.title)}});return}
 const md=document.getElementById('md');if(md&&!md.classList.contains('hide'))return; // some other form is open: leave it alone
 if(typeof st==='undefined')return;
 if(document.getElementById('okpscr')){if(document.getElementById('bkl'))bulkWedge(code);return}
 if(document.getElementById('cfs')||st.tab=='sell'){process(code,{onFound:async p=>sellRes(p)},r=>{if(r&&r.ok){feedback(r.warn?'warn':'ok');toastS('✓ '+r.title+' '+r.sub+(r.warn?' · '+r.warn:''));if(st.co)cr();else render()}else if(r&&r.skip){}});return}
 if(st.tab=='stock'){process(code,{onFound:async p=>{card(p);return{ok:true,title:p.name}}},r=>{if(r&&r.ok)feedback('ok')});return}
 if(st.tab=='home'){process(code,{onFound:async(p,c)=>{st.pcq=c;const i=document.getElementById('pcq');if(i){i.value=c;if(typeof pcs==='function')pcs(c)}return priceRes(p)}},r=>{if(r&&r.ok){feedback('ok');toastS('✓ '+r.title+' · UGX '+F0(prod().find(p=>p.name==r.title).price))}})}}
function bulkWedge(code){const o=owners(code);if(o.length){feedback('warn');toastS('Already on '+o[0].name);return}
 feedback('warn');pickSheet({title:'Which product is this?',sub:'Barcode <b>'+E(code)+'</b>',firstNoBc:true,onPick:p=>attach(p,code,()=>{feedback('ok');toastS('✓ '+p.name);if(S.bulkCtx)S.bulkCtx.draw()})})}
document.addEventListener('keydown',e=>{
 if(e.ctrlKey||e.altKey||e.metaKey)return;
 const now=Date.now(),k=e.key;
 if(k=='Enter'||k=='Tab'){
  if(W.n>=4){const el=W.el;const used=wFinish('enter');if(used){e.preventDefault();e.stopPropagation()}}else wReset();
  return}
 if(!k||k.length!=1){return}
 if(W.n&&now-W.tl>120)wReset();
 if(!W.n){W.t0=now;W.el=typing(document.activeElement)?document.activeElement:null;W.v0=W.el?W.el.value:''}
 W.buf+=k;W.n++;W.tl=now;
 clearTimeout(W.idle);
 // scanners set to send no Enter: finish after a short pause, only for number-like codes
 W.idle=setTimeout(()=>{if(W.n>=8&&/^\d{8,14}$/.test(W.buf)&&(W.tl-W.t0)/(W.n-1)<=40){const el=W.el;wFinish('idle')}else if(W.n){/* typed by hand: leave it */wReset()}},160)
},true);

/* ================================================================== SMALL ENTRY POINTS FOR index.html */
function scanBtn(fn,label){return'<button class="btn scanbtn" type="button" onclick="'+fn+'" aria-label="'+E(label||'Scan')+'">📷<span> '+E(label||'Scan')+'</span></button>'}
function stockBar(){const s=bulkStats();return'<div class="bcbar"><button class="btn" onclick="okpScan.labels()">🏷 Print labels</button><button class="btn" onclick="okpScan.bulk()">📷 Attach barcodes'+(s.none?' ('+s.none+' without)':'')+'</button></div>'}

/* ---- styles (use the app colours, light and dark) ---- */
const CSS='#scn{position:fixed;inset:0;z-index:12;background:var(--bg);color:var(--ink);display:flex;flex-direction:column;padding-top:env(safe-area-inset-top,0px)}'
+'#scn .sct,#okpscr .sct{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--head);color:var(--headink)}#scn .sct b,#okpscr .sct b{flex:1;font-size:1.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
+'#scn .sct button,#okpscr .sct button{min-height:46px;padding:0 16px;border:0;border-radius:999px;background:var(--acc);color:var(--accink);font-weight:800;font-size:.95rem;cursor:pointer}'
+'#scn .scv{position:relative;background:#000;height:36vh;min-height:210px;max-height:340px;overflow:hidden;flex:none}#scn video{width:100%;height:100%;object-fit:cover;display:block}'
+'#scn .scf{position:absolute;left:10%;right:10%;top:22%;bottom:22%;border:3px solid rgba(242,140,0,.95);border-radius:14px;box-shadow:0 0 0 999px rgba(0,0,0,.28);pointer-events:none}'
+'#scn .scbn{position:absolute;left:8px;right:8px;bottom:8px;padding:10px 14px;border-radius:12px;color:#fff;background:#18794e;display:flex;flex-direction:column;gap:2px;font-size:1rem}#scn .scbn.warn{background:#b86e00}#scn .scbn.bad{background:#c0392b}#scn .scbn small{color:#fff;opacity:.92}'
+'#scn .scms{position:absolute;inset:0;background:rgba(20,18,16,.94);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;text-align:center;overflow:auto}#scn .scms .scmt{white-space:pre-line;font-size:.95rem}#scn .scms .btn{width:auto;min-width:160px}'
+'#scn .sctl{display:flex;gap:8px;padding:8px 12px 0;flex-wrap:wrap}#scn .sctl button{flex:1;min-width:120px;min-height:46px;border:1.5px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);font-weight:700;cursor:pointer}#scn .sctl button.on{background:var(--acc);color:var(--accink);border-color:var(--acc)}'
+'#scn #sczm{margin:6px 14px 0;width:auto;padding:0}.sck{display:flex!important;align-items:center;gap:10px;margin:10px 14px 0;font-size:.95rem;color:var(--ink)}.sck input{width:24px;height:24px;margin:0;flex:none}'
+'#scn .scb{flex:1;overflow:auto;padding:10px 14px}#scn .scman{display:flex;gap:8px}#scn .scman input{margin:0}#scn .scman .btn{width:auto;margin:0;min-width:70px}'
+'#scn .scd{padding:8px 14px calc(10px + env(safe-area-inset-bottom,0px));background:var(--bg)}#scn .scd .btn{margin:0}'
+'.scq{display:flex;align-items:center;gap:6px;flex:none}.scq button{width:44px;height:44px;border-radius:12px;border:1.5px solid var(--line);background:var(--card);color:var(--ink);font-size:1.3rem;font-weight:800;cursor:pointer}.scq b{min-width:26px;text-align:center}'
+'body.scn-on #md{z-index:15}#okpsh{position:fixed;inset:0;z-index:18;background:#000a;display:flex;align-items:flex-end;justify-content:center}#okpsh .shb{background:var(--bg);color:var(--ink);width:100%;max-width:520px;max-height:90%;overflow:auto;border-radius:18px 18px 0 0;padding:14px 16px calc(14px + env(safe-area-inset-bottom,0px))}#okpsh .pkl{max-height:42vh;overflow:auto}.mut{color:var(--mut)}'
+'#okpscr{position:fixed;inset:0;z-index:8;background:var(--bg);color:var(--ink);display:flex;flex-direction:column;padding-top:env(safe-area-inset-top,0px)}#okpscr .scs{flex:1;overflow:auto;padding:12px 14px calc(20px + env(safe-area-inset-bottom,0px));width:100%;max-width:560px;margin:0 auto}#okpscr .scd{padding:8px 14px calc(10px + env(safe-area-inset-bottom,0px));background:var(--card);border-top:1px solid var(--line)}#okpscr .lbn{font-weight:700;margin-bottom:6px;text-align:center}#okpscr .lbb{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:8px}#okpscr .lbb .btn{margin:0;padding:10px 6px}'
+'.lbck{width:44px;height:44px;flex:none;border-radius:12px;border:2px solid var(--line);background:var(--card);color:var(--accink);font-size:1.3rem;font-weight:800;cursor:pointer}.lbck.on{background:var(--acc);border-color:var(--acc)}.lbr{cursor:default}.lbpv{margin:6px 0 10px}.lbsv{overflow:auto;padding:6px 0}.lbsv svg{box-shadow:0 0 0 1px var(--line);max-width:100%;height:auto}'
+'.scrow{display:flex;gap:8px;align-items:flex-start}.scrow input{flex:1;min-width:0}.scrow .scanbtn{width:auto;margin:0 0 10px;min-height:46px;padding:0 14px;flex:none}.pcb .scrow .scanbtn{margin:0 0 8px}.bcrow{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 6px}.bcrow .btn{margin:0;padding:10px 6px;font-size:.9rem}.bcw{font-size:.85rem;margin:-6px 0 8px}.bcbar{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 10px}.bcbar .btn{margin:0;padding:10px 6px;font-size:.92rem}'
+'#lbp{position:absolute;left:-99999px;top:0}@media print{body *{visibility:hidden}#lbp,#lbp *{visibility:visible}#lbp{position:absolute;left:0;top:0}html,body{height:auto!important;display:block!important;overflow:visible!important}.lbpg{position:relative;page-break-after:always;break-after:page;overflow:hidden}.lbpg:last-child{page-break-after:auto;break-after:auto}}';
(function(){const s=document.createElement('style');s.id='okp-scan-css';s.textContent=CSS;document.head.appendChild(s)})();

window.okpScan={sqKey,sell,price,find:find1,recv:recvGo,bulk,labels,card,created,formUI,formSave,csv,hay,hit,scanBtn,stockBar,_q,
 lookup:find,attach,beep:feedback,route,codesOf,newInternal,
 _t:{key,clean,codesOf,owners,find,c128,c128Values,labelPrims,svgLabel,pdfLabels,fitText,parseCsv,isInternal,labelCode,ensureCodes,buildPages,sellAdd,sellRes,attach,process,formSave,wFinish,W,looksLikeCode,hit,newInternal,S,LAYOUTS,LB}};
})();
