/* pdf.js — makes real PDF files on the phone (no outside library, works offline).
 *   X.receipt(id,share)   one receipt as PDF (A5, or 58mm roll if that paper is chosen)
 *   X.dayReport(share)    daily report as PDF
 *   X.monthReport(share)  monthly report as PDF (latest day first)
 *   X.report(share)       FULL business report as PDF (optional date range)
 *   X.backup(share)       BACKUP as PDF: readable report + a hidden copy of all data inside, so it can be restored
 *   X.pdfJson(file)       reads a backup PDF made by X.backup() and returns the data (used by Restore)
 * share=true opens the phone's share sheet (WhatsApp, email, Drive...); otherwise the file is downloaded.
 */
(function(){
'use strict';
const WR=[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const WB=[278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const MAP={0x2013:150,0x2014:151,0x2018:145,0x2019:146,0x201C:147,0x201D:148,0x2022:149,0x2026:133,0x20AC:128,0x2122:153,0x2212:45,0x2192:62,0x2190:60,0x2713:42,0x2022:149};
function enc(s){s=String(s==null?'':s);let o='';for(const ch of s){const c=ch.codePointAt(0);if(c>=32&&c<=126)o+=ch;else if(c>=160&&c<=255)o+=ch;else if(c==9)o+=' ';else if(MAP[c])o+=String.fromCharCode(MAP[c]);}return o}
function tw(s,sz,b){s=enc(s);let w=0;const T=b?WB:WR;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);w+=(c>=32&&c<=126)?T[c-32]:(c==150||c==151?556:556)}return w*sz/1000}
function pesc(s){return enc(s).replace(/[\\()]/g,'\\$&')}
function lat(s){const b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i)&255;return b}
function rgb(h){h=String(h||'').trim().replace('#','');if(/^[0-9a-f]{3}$/i.test(h))h=h.split('').map(x=>x+x).join('');if(!/^[0-9a-f]{6}$/i.test(h))return '0 0 0';return [0,2,4].map(i=>(parseInt(h.substr(i,2),16)/255).toFixed(3)).join(' ')}
function theme(){let cs=null;try{cs=getComputedStyle(document.documentElement)}catch(e){}const g=(n,d)=>{const v=cs&&cs.getPropertyValue(n).trim();return v||d};
 return{acc:rgb(g('--acc','#7cb83a')),accInk:rgb(g('--accink','#10240b')),head:rgb(g('--head','#1c3a1f')),ink:'0.13 0.13 0.13',mut:'0.40 0.40 0.40',line:'0.80 0.80 0.80',zebra:'0.955 0.955 0.955',bad:'0.75 0.22 0.17',ok:'0.09 0.47 0.31',white:'1 1 1'}}

class Doc{
 constructor(o){o=o||{};this.w=o.w||595.28;this.h=o.h||841.89;this.m=o.m==null?40:o.m;this.fb=o.footer===false?0:1;this.foot=o.foot||'';this.pages=[];this.ims=[];this.T=theme();this.np()}
 get cw(){return this.w-2*this.m}
 get bot(){return this.m+(this.fb?14:0)}
 np(){this.c=[];this.pages.push(this.c);this.y=this.h-this.m}
 used(){return this.h-this.y+this.m}
 need(h){if(this.y-h<this.bot){this.np();return true}return false}
 text(s,x,y,sz,b,col){if(s===''||s==null)return;this.c.push('BT /F'+(b?2:1)+' '+sz+' Tf '+(col||this.T.ink)+' rg '+x.toFixed(2)+' '+y.toFixed(2)+' Td ('+pesc(s)+') Tj ET')}
 rect(x,y,w,h,col){this.c.push(col+' rg '+x.toFixed(2)+' '+y.toFixed(2)+' '+w.toFixed(2)+' '+h.toFixed(2)+' re f')}
 line(x1,y1,x2,y2,col,lw){this.c.push((col||this.T.line)+' RG '+(lw||0.6)+' w '+x1.toFixed(2)+' '+y1.toFixed(2)+' m '+x2.toFixed(2)+' '+y2.toFixed(2)+' l S')}
 dash(y){this.c.push(this.T.mut+' RG 0.5 w [2 2] 0 d '+this.m+' '+y.toFixed(2)+' m '+(this.w-this.m)+' '+y.toFixed(2)+' l S [] 0 d')}
 img(im,x,y,w,h){let k=this.ims.indexOf(im);if(k<0){this.ims.push(im);k=this.ims.length-1}this.c.push('q '+w.toFixed(2)+' 0 0 '+h.toFixed(2)+' '+x.toFixed(2)+' '+y.toFixed(2)+' cm /Im'+k+' Do Q')}
 wrap(s,w,sz,b,max){const out=[];String(s==null?'':s).split('\n').forEach(par=>{if(!par.trim()){out.push('');return}let cur='';par.split(/\s+/).filter(Boolean).forEach(word=>{let t=cur?cur+' '+word:word;if(tw(t,sz,b)<=w){cur=t;return}if(cur)out.push(cur);cur='';while(tw(word,sz,b)>w&&word.length>1){let n=word.length-1;while(n>1&&tw(word.slice(0,n),sz,b)>w)n--;out.push(word.slice(0,n));word=word.slice(n)}cur=word});if(cur)out.push(cur)});if(max&&out.length>max){out.length=max;out[max-1]=out[max-1].replace(/.{0,2}$/,'')+'…'}return out.length?out:['']}
 // one line of text at the cursor; a = 'l' | 'c' | 'r'
 para(s,o){o=o||{};const sz=o.size||9,b=o.bold,lh=sz*1.32,lines=this.wrap(s,this.cw-(o.indent||0),sz,b);lines.forEach(l=>{this.need(lh);this.y-=lh;const x=o.a=='c'?this.m+(this.cw-tw(l,sz,b))/2:o.a=='r'?this.w-this.m-tw(l,sz,b):this.m+(o.indent||0);this.text(l,x,this.y+sz*0.25,sz,b,o.col)});this.y-=(o.gap==null?2:o.gap)}
 h2(s){this.need(46);this.y-=14;this.rect(this.m,this.y-4,3,15,this.T.acc);this.text(s,this.m+9,this.y,12,1,this.T.head);this.y-=10}
 grid(items,cols){cols=cols||3;const g=6,bw=(this.cw-(cols-1)*g)/cols,bh=36;for(let i=0;i<items.length;i+=cols){this.need(bh+g);const top=this.y;items.slice(i,i+cols).forEach((it,j)=>{const x=this.m+j*(bw+g);this.rect(x,top-bh,bw,bh,this.T.zebra);this.rect(x,top-bh,2.5,bh,this.T.acc);this.text(it[0],x+9,top-12,7.5,0,this.T.mut);const bad=it[2]=='bad'||(typeof it[1]=='number'&&it[1]<0);const v=typeof it[1]=='number'?fm(it[1]):String(it[1]);this.text(v,x+9,top-28,12.5,1,bad?this.T.bad:this.T.ink)});this.y-=bh+g}this.y-=2}
 table(cols,rows,o){o=o||{};const sz=o.size||8,lh=sz*1.3,pad=3,cw=this.cw,ws=cols.map(c=>c.w*cw),T=this.T;
  const head=()=>{const h=lh+pad*2;this.need(h+lh*2+pad*2);this.rect(this.m,this.y-h,cw,h,T.head);let x=this.m;cols.forEach((c,i)=>{const t=c.h||'';const tx=c.a=='r'?x+ws[i]-pad-tw(t,sz,1):c.a=='c'?x+(ws[i]-tw(t,sz,1))/2:x+pad;this.text(t,tx,this.y-pad-sz*0.85,sz,1,T.white);x+=ws[i]});this.y-=h};
  if(!rows.length){this.para(o.empty||'Nothing recorded.',{size:8.5,col:T.mut,gap:4});return}
  head();let zi=0;
  rows.forEach(r=>{const cells=r.c||r,bold=!!r.b,L=cells.map((t,i)=>this.wrap(t,ws[i]-pad*2,sz,bold||cols[i].b,o.maxLines||5)),n=Math.max(1,...L.map(l=>l.length)),h=n*lh+pad*2;
   if(this.y-h<this.bot){this.np();head()}
   if(r.b){this.rect(this.m,this.y-h,cw,h,T.zebra);this.line(this.m,this.y,this.m+cw,this.y,T.mut,0.7)}else if(zi++%2)this.rect(this.m,this.y-h,cw,h,T.zebra);
   let x=this.m;L.forEach((ls,i)=>{ls.forEach((l,k)=>{const b=bold||cols[i].b,tx=cols[i].a=='r'?x+ws[i]-pad-tw(l,sz,b):cols[i].a=='c'?x+(ws[i]-tw(l,sz,b))/2:x+pad;this.text(l,tx,this.y-pad-sz*0.85-k*lh,sz,b,(cols[i].bad&&String(cells[i]).charAt(0)=='-')?T.bad:null)});x+=ws[i]});
   this.y-=h});
  this.line(this.m,this.y,this.m+cw,this.y,T.line,0.5);this.y-=8}
 finish(emb,meta){const N=this.pages.length,T=this.T;
  if(this.fb)this.pages.forEach((c,i)=>{const y=this.m*0.5+2;c.push(T.line+' RG 0.5 w '+this.m+' '+(y+10)+' m '+(this.w-this.m)+' '+(y+10)+' l S');
   c.push('BT /F1 7.5 Tf '+T.mut+' rg '+this.m+' '+y+' Td ('+pesc(this.foot)+') Tj ET');const pg='Page '+(i+1)+' of '+N;c.push('BT /F1 7.5 Tf '+T.mut+' rg '+(this.w-this.m-tw(pg,7.5,0)).toFixed(2)+' '+y+' Td ('+pg+') Tj ET')});
  const parts=[],offs=[];let off=0;const P=x=>{const b=typeof x=='string'?lat(x):x;parts.push(b);off+=b.length};
  const obj=(n,body)=>{offs[n]=off;P(n+' 0 obj\n'+body+'\nendobj\n')},sobj=(n,dict,bytes)=>{offs[n]=off;P(n+' 0 obj\n'+dict.replace('LEN',bytes.length)+'\nstream\n');P(bytes);P('\nendstream\nendobj\n')};
  const nI=this.ims.length,i0=5+2*N,info=i0+nI,fs=info+1,es=info+2;
  P('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1,'<< /Type /Catalog /Pages 2 0 R'+(emb?' /Names << /EmbeddedFiles << /Names [('+pesc(emb.name)+') '+fs+' 0 R] >> >>':'')+' >>');
  obj(2,'<< /Type /Pages /Count '+N+' /Kids ['+this.pages.map((_,i)=>(5+2*i)+' 0 R').join(' ')+'] >>');
  obj(3,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(4,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const xo=nI?' /XObject << '+this.ims.map((_,k)=>'/Im'+k+' '+(i0+k)+' 0 R').join(' ')+' >>':'';
  this.pages.forEach((c,i)=>{obj(5+2*i,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+this.w.toFixed(2)+' '+this.h.toFixed(2)+'] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>'+xo+' >> /Contents '+(6+2*i)+' 0 R >>');sobj(6+2*i,'<< /Length LEN >>',lat(c.join('\n')))});
  this.ims.forEach((im,k)=>sobj(i0+k,'<< /Type /XObject /Subtype /Image /Width '+im.w+' /Height '+im.h+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length LEN >>',im.data));
  obj(info,'<< /Title ('+pesc((meta&&meta.title)||'Report')+') /Author ('+pesc((meta&&meta.author)||'')+') /Producer (Shop app) /CreationDate (D:'+new Date().toISOString().replace(/[-:T]/g,'').slice(0,14)+'Z) >>');
  if(emb){obj(fs,'<< /Type /Filespec /F ('+pesc(emb.name)+') /UF ('+pesc(emb.name)+') /Desc (Full copy of the shop data. Use Restore on the Setup page.) /EF << /F '+es+' 0 R >> >>');sobj(es,'<< /Type /EmbeddedFile /Subtype /application#2Fjson /Length LEN >>',emb.bytes)}
  else{obj(fs,'null');obj(es,'null')}
  const xr=off,n=es+1;P('xref\n0 '+n+'\n0000000000 65535 f \n');for(let i=1;i<n;i++)P(String(offs[i]).padStart(10,'0')+' 00000 n \n');
  P('trailer\n<< /Size '+n+' /Root 1 0 R /Info '+info+' 0 R >>\nstartxref\n'+xr+'\n%%EOF');
  const out=new Uint8Array(off);let p=0;parts.forEach(b=>{out.set(b,p);p+=b.length});return out}
}

/* ---------- helpers ---------- */
const nowS=()=>new Date().toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
const R=v=>fm(v);
const bytesOf=url=>{const b=atob(url.split(',')[1]),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u};
async function logoJpeg(){try{const h=shp();if(h.logoSel=='none')return null;let src='';
  if(h.logoSel=='own'&&h.logo)src=h.logo;else if(h.logoSel=='full'&&typeof LOGOIMG!='undefined'&&LOGOIMG)src=LOGOIMG;
  else if(typeof LOGO!='undefined'&&LOGO)src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(LOGO.split('__W__').join('240'));
  if(!src)return null;
  const im=await new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>no();i.src=src});
  const k=Math.min(1,360/Math.max(im.width||240,im.height||240)),c=document.createElement('canvas');c.width=Math.max(1,Math.round((im.width||240)*k));c.height=Math.max(1,Math.round((im.height||240)*k));
  const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(im,0,0,c.width,c.height);
  return{w:c.width,h:c.height,data:bytesOf(c.toDataURL('image/jpeg',0.92)),full:h.logoSel=='full'}}catch(e){return null}}
function who(){const s=db.shop||{};return s.adv||s.mgr||''}
function idLine(){const s=db.shop||{},a=[];if(s.tel)a.push('Tel: '+s.tel);if(s.reg)a.push('Licence: '+s.reg);if(s.tin)a.push('TIN: '+s.tin);return a.join('  ·  ')}
function letter(d,logo,title,sub){const T=d.T,s=db.shop||{};let x=d.m,top=d.y;
 if(logo){const lh=50,lw=Math.min(logo.full?170:90,lh*logo.w/logo.h),lh2=lw/(logo.w/logo.h);d.img(logo,x,top-lh2,lw,lh2);x+=lw+12}
 let y=top-13;if(!(logo&&logo.full)){d.text(s.name||'',x,y,17,1,T.head);y-=14}
 const tg=(shp().tag||'');if(tg&&!(logo&&logo.full)){d.text(tg,x,y,8.5,0,T.mut);y-=11}
 if(s.addr){d.text(s.addr,x,y,9,0);y-=11}const il=idLine();if(il){d.text(il,x,y,9,0);y-=11}
 const own=who();if(own){d.text((db.FM?'Advisor: ':'Manager: ')+own,x,y,9,0);y-=11}
 d.y=Math.min(y,top-54)-4;d.line(d.m,d.y,d.w-d.m,d.y,T.acc,1.6);d.y-=18;
 d.text(title,d.m,d.y,15,1,T.head);d.y-=13;if(sub)d.para(sub,{size:8.5,col:T.mut,gap:6});else d.y-=4}
function newA4(title){return new Doc({foot:(db.shop.name||'')+'  ·  '+title+'  ·  made '+nowS()})}

/* ---------- send: share sheet or download ---------- */
async function out(bytes,name,share){const blob=new Blob([bytes],{type:'application/pdf'});
 if(share){try{const f=new File([blob],name,{type:'application/pdf'});if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:name});return true}}catch(e){if(e&&e.name=='AbortError')return false}toast('Sharing is not available on this device — downloading instead')}
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},5000);toast('PDF downloaded ✓');return true}
let busy=false;
async function run(label,fn){if(busy)return;busy=true;toast('Preparing '+label+'…');try{await fn()}catch(e){console.error(e);alert('Could not make the PDF: '+(e&&e.message||e))}busy=false}
const slug=()=>(db.shop.name||'shop').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24)||'shop';

/* ---------- RECEIPT ---------- */
function rcBuild(d,s,logo,th){const T=d.T,sh=db.shop,h=shp(),cw=d.cw,sz=th?8:9.5;
 const ctr=(t,z,b,col,gap)=>{d.para(t,{size:z,bold:b,a:'c',col:col,gap:gap==null?1:gap})};
 if(logo){const lh=th?(logo.full?40:46):(logo.full?56:60),lw=Math.min(cw*(logo.full?0.8:0.5),lh*logo.w/logo.h),hh=lw/(logo.w/logo.h);d.need(hh+6);d.img(logo,d.m+(cw-lw)/2,d.y-hh,lw,hh);d.y-=hh+6}
 if(!(logo&&logo.full))ctr(sh.name||'',th?11:16,1,T.head,1);
 if(h.tag&&!(logo&&logo.full))ctr(h.tag,th?7:8.5,0,T.mut);
 if(sh.addr)ctr(sh.addr,th?7.5:9,0);if(sh.tel)ctr('Tel: '+sh.tel,th?7.5:9,0);if(sh.reg)ctr('Licence: '+sh.reg,th?7.5:9,0);if(sh.tin)ctr('TIN: '+sh.tin,th?7.5:9,0);
 d.y-=3;if(th)d.dash(d.y);else d.line(d.m,d.y,d.m+cw,d.y,T.acc,1.4);d.y-=3;ctr('RECEIPT',th?10:13,1,T.head,3);
 const kv=(a,b,bold,z)=>{z=z||sz;d.need(z*1.5);d.y-=z*1.35;d.text(a,d.m,d.y+z*0.25,z,bold,T.mut);const t=String(b),x=d.m+cw-tw(t,z,bold);d.text(t,Math.max(x,d.m+tw(a,z,bold)+6),d.y+z*0.25,z,bold)};
 kv('Receipt no.','#'+s.no,1);kv('Date',s.date+(s.time?'  '+s.time:''));kv('Customer',s.cust||'Walk-in');if(s.by)kv('Served by',s.by);
 d.y-=4;if(th)d.dash(d.y);else d.line(d.m,d.y,d.m+cw,d.y,T.line,0.6);d.y-=4;
 if(th){s.items.forEach(i=>{d.para(i.n,{size:8,bold:1,gap:0});kv(i.q+' x '+R(i.p),R(i.q*i.p),0,8)})}
 else d.table([{h:'Item',w:.5},{h:'Qty',w:.12,a:'r'},{h:'Price',w:.19,a:'r'},{h:'Total',w:.19,a:'r'}],s.items.map(i=>[i.n,String(i.q),R(i.p),R(i.q*i.p)]),{size:9});
 if(typeof agUseText=='function'){const u=agUseText(s);if(u){d.y-=2;d.para(u,{size:th?6.5:7.5,col:T.mut,gap:3})}}
 d.y-=2;if(th)d.dash(d.y);else d.line(d.m,d.y,d.m+cw,d.y,T.line,0.6);d.y-=2;
 kv('TOTAL','UGX '+R(tot(s)),1,th?10:12);if(s.advA)kv('Advance used','-'+R(s.advA));if(s.advA&&s.pay!='Credit')kv('Paid now ('+s.pay+')',R(tot(s)-s.advA));kv('Paid by',s.pay);
 if(s.pay=='Credit'){kv('Paid so far',R(paid(s)));kv('BALANCE',R(tot(s)-paid(s)),1,th?9:11)}
 d.y-=4;if(th)d.dash(d.y);else d.line(d.m,d.y,d.m+cw,d.y,T.line,0.6);d.y-=6;
 const ab=th?h.about58:h.about;if(ab)d.para(ab,{size:th?7:8,a:'c',col:T.mut,gap:3});if(h.foot)ctr(h.foot,th?8:9.5,1,T.head)}
async function receipt(id,share){const s=db.S.find(x=>x.id==id);if(!s)return;
 await run('receipt PDF',async()=>{const th=shp().paper=='58',logo=await logoJpeg(),o=th?{w:164.4,h:6000,m:9,footer:false}:{w:419.53,h:595.28,m:30,foot:(db.shop.name||'')+'  ·  Receipt #'+s.no};
  let d=new Doc(o);rcBuild(d,s,logo,th);if(th){const H=Math.ceil(d.used()+10);d=new Doc(Object.assign({},o,{h:H}));rcBuild(d,s,logo,th)}
  await out(d.finish(null,{title:'Receipt #'+s.no,author:db.shop.name}),'receipt-'+s.no+'-'+s.date+'.pdf',share)})}

/* ---------- report sections ---------- */
const svc=p=>typeof isSvc=='function'&&isSvc(p);
const byD=(a,b)=>(a.date+(a.time||''))<(b.date+(b.time||''))?1:(a.date+(a.time||''))>(b.date+(b.time||''))?-1:((b.no||b.id||0)-(a.no||a.id||0));
const inR=(d,f,t)=>(!f||d>=f)&&(!t||d<=t);
const itemsTxt=s=>s.items.map(i=>i.n+' x'+i.q).join(', ');
function secSummary(d,ss,xs,label){const t=sum(ss,tot),c=sum(ss,cogs),e=sum(xs,x=>x.amt),by=p=>sum(ss.filter(s=>s.pay==p),tot);
 d.h2('Summary · '+label);d.grid([['Total sales',t],['Cost of goods sold',c],['Gross profit',t-c],['Expenses',e],['Net profit',t-c-e],['Receipts',String(ss.length)],['Cash sales',by('Cash')],['Mobile Money sales',by('Mobile Money')],['Credit sales',by('Credit')]],3)}
function secDaily(d,dates){d.h2('Daily summary · latest date first');d.table([{h:'Date',w:.2},{h:'Receipts',w:.12,a:'r'},{h:'Sales',w:.2,a:'r'},{h:'Gross profit',w:.18,a:'r'},{h:'Expenses',w:.15,a:'r'},{h:'Net',w:.15,a:'r',bad:1}],dates.map(x=>{const p=pl(x);return[x,String(p.n),R(p.t),R(p.g),R(p.e),R(p.net)]}),{size:8.5})}
function secProducts(d,ss){const pp={};ss.forEach(s=>s.items.forEach(i=>{const r=pp[i.n]||(pp[i.n]={q:0,s:0,c:0});r.q+=i.q;r.s+=i.q*i.p;r.c+=i.q*i.c}));
 const rows=Object.entries(pp).sort((a,b)=>(b[1].s-b[1].c)-(a[1].s-a[1].c)).map(([n,r])=>[n,String(Math.round(r.q*100)/100),R(r.s),R(r.s-r.c),r.s?Math.round((r.s-r.c)/r.s*100)+'%':'–']);
 d.h2('Products sold · profit by product');d.table([{h:'Product',w:.4},{h:'Qty',w:.1,a:'r'},{h:'Sales',w:.19,a:'r'},{h:'Profit',w:.19,a:'r',bad:1},{h:'Margin',w:.12,a:'r'}],rows,{empty:'No sales in this period.'})}
function secSales(d,ss,title){d.h2(title||'Sales (receipts) · latest first');d.table([{h:'Date',w:.14},{h:'No.',w:.08},{h:'Customer',w:.17},{h:'Items',w:.34},{h:'Paid by',w:.1},{h:'Total',w:.17,a:'r'}],ss.slice().sort(byD).map(s=>[s.date+(s.time?' '+s.time:''),'#'+s.no,s.cust||'Walk-in',itemsTxt(s),s.pay,R(tot(s))]),{size:7.5,maxLines:4,empty:'No sales in this period.'})}
function secBuy(d,us,title){d.h2(title||'Stock bought (purchases) · latest first');const L=us.slice().sort(byD);d.table([{h:'Date',w:.13},{h:'Supplier',w:.2},{h:'Product',w:.3},{h:'Qty',w:.08,a:'r'},{h:'Unit cost',w:.14,a:'r'},{h:'Total',w:.15,a:'r'}],L.map(u=>[u.date,u.sup||'',u.n,String(u.q),R(ul(u)),R(u.q*ul(u))]).concat(L.length?[{b:1,c:['','','Total','','',R(sum(L,u=>u.q*ul(u)))]}]:[]),{size:7.5,empty:'No purchases in this period.'})}
function secExp(d,xs,title){d.h2(title||'Expenses · latest first');const L=xs.slice().sort(byD);d.table([{h:'Date',w:.15},{h:'Type',w:.25},{h:'Description',w:.4},{h:'Amount',w:.2,a:'r'}],L.map(x=>[x.date,x.type||'',x.desc||'',R(x.amt)]).concat(L.length?[{b:1,c:['','','Total',R(sum(L,x=>x.amt))]}]:[]),{size:8,empty:'No expenses in this period.'})}
function secStock(d){const m=stk(),L=db.P.slice().sort((a,b)=>(a.cat||'').localeCompare(b.cat||'')||a.name.localeCompare(b.name));let v=0,sv=0;
 const rows=L.map(p=>{const q=m[p.name]||0,c=costNow(p),isS=svc(p);if(!isS){v+=Math.max(q,0)*c;sv+=Math.max(q,0)*p.price}return[p.name,p.cat||'',isS?'service':q+' '+(p.unit||''),R(c),R(p.price),isS?'':R(Math.max(q,0)*c)]});
 d.h2('Stock on hand (today)');d.grid([['Stock value at cost',v],['Stock value at selling price',sv],['Products',String(L.length)]],3);
 d.table([{h:'Product',w:.34},{h:'Category',w:.17},{h:'In stock',w:.12,a:'r'},{h:'Cost',w:.11,a:'r'},{h:'Price',w:.11,a:'r'},{h:'Value (cost)',w:.15,a:'r'}],rows,{size:7.5})}
function secOwed(d){const g={};db.S.filter(s=>s.pay=='Credit').forEach(s=>{const b=tot(s)-paid(s);if(b>0.5){const k=s.cust||'(no name)',r=g[k]||(g[k]={n:0,b:0,l:''});r.n++;r.b+=b;if(s.date>r.l)r.l=s.date}});
 const rows=Object.entries(g).sort((a,b)=>b[1].b-a[1].b).map(([k,r])=>[k,String(r.n),r.l,R(r.b)]);
 d.h2('Customers who owe the shop (credit)');d.table([{h:'Customer',w:.4},{h:'Credit sales',w:.15,a:'r'},{h:'Last sale',w:.2},{h:'Balance owed',w:.25,a:'r'}],rows.concat(rows.length?[{b:1,c:['Total','','',R(sum(Object.values(g),r=>r.b))]}]:[]),{empty:'Nobody owes the shop.'});
 const sg={};db.U.forEach(u=>{const o=sowed(u);if(o>0.5){const k=(u.sup||'').trim()||'(no name)';sg[k]=(sg[k]||0)+o}});
 const sr=Object.entries(sg).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,R(v)]);
 d.h2('Suppliers the shop owes');d.table([{h:'Supplier',w:.7},{h:'Balance owed',w:.3,a:'r'}],sr.concat(sr.length?[{b:1,c:['Total',R(sum(Object.values(sg),v=>v))]}]:[]),{empty:'The shop owes no supplier.'})}
function secMore(d,f,t){
 const A=db.A.filter(a=>inR(a.date,f,t)).sort(byD);if(A.length){d.h2('Customer advances');d.table([{h:'Date',w:.14},{h:'Customer',w:.22},{h:'Goods reserved',w:.3},{h:'Paid',w:.17,a:'r'},{h:'Balance',w:.17,a:'r'}],A.map(a=>[a.date,a.cust||'',a.desc||'',R(a.amt),R(abal(a))]),{size:8})}
 const O=(db.O||[]).filter(o=>inR(o.date,f,t)).sort(byD);if(O.length){d.h2('Pre-orders');d.table([{h:'Date',w:.14},{h:'Customer',w:.22},{h:'Item ordered',w:.34},{h:'Phone',w:.14},{h:'Status',w:.16}],O.map(o=>[o.date,o.cust||'',o.item||'',o.tel||'',(typeof OS!='undefined'&&typeof OK!='undefined'?OS[OK.indexOf(o.st)]:o.st)||'']),{size:8})}
 if(typeof jbal=='function'){const b=jbal(),L=Object.keys(b).filter(n=>b[n]>0.5);if(L.length){d.h2('Loose-sales cash kept aside (not yet taken off stock)');d.table([{h:'Product',w:.7},{h:'Cash kept aside',w:.3,a:'r'}],L.map(n=>[n,R(b[n])]),{size:8})}}
 const M=(db.M||[]).filter(x=>inR(x.date,f,t)&&x.kind!='xfc'&&x.kind!='xmc').sort(byD);if(M.length){d.h2('Owner drawings and other money in / out');d.table([{h:'Date',w:.14},{h:'What',w:.38},{h:'Account',w:.14},{h:'Note',w:.16},{h:'Amount',w:.18,a:'r'}],M.map(x=>[x.date,(typeof KL!='undefined'&&typeof KK!='undefined'&&KL[KK.indexOf(x.kind)])||x.kind,x.acct||'',x.desc||'',R(x.amt)]),{size:8})}
 const C=(db.C||[]).filter(x=>inR(x.date,f,t)).sort(byD);if(C.length){d.h2('Cash book · days closed');d.table([{h:'Date',w:.16},{h:'Opening cash',w:.19,a:'r'},{h:'Counted cash',w:.19,a:'r'},{h:'Counted MoMo',w:.19,a:'r'},{h:'Note',w:.27}],C.map(x=>[x.date,R(x.co),R(x.cc),x.mc!=null?R(x.mc):'',x.note||'']),{size:8})}}
function secAgro(d,f,t){if(!Array.isArray(db.FM))return;const sd=x=>x||'';
 d.h2('Farmers register');d.table([{h:'Name',w:.22},{h:'Phone',w:.14},{h:'Village',w:.17},{h:'Main crops',w:.23},{h:'Group',w:.14},{h:'Since',w:.1}],db.FM.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(x=>[x.name,sd(x.tel),sd(x.village),sd(x.crops),sd(x.grp),sd(x.since)]),{size:7.5,empty:'No farmers registered.'});
 const V=(db.VS||[]).filter(v=>inR(v.date,f,t)).sort(byD);d.h2('Advice visits and soil tests');d.table([{h:'Date',w:.12},{h:'Farmer',w:.18},{h:'Type',w:.12},{h:'Crop',w:.12},{h:'Findings',w:.23},{h:'Advice',w:.23}],V.map(v=>[v.date,v.farm||v.who||'',v.type||'',v.crop||'',v.find||v.prob||'',v.adv||'']),{size:7.5,empty:'No visits recorded.'});
 const E=(db.EV||[]).filter(v=>inR(v.date,f,t)).sort(byD);d.h2('Trainings, field days and demos');d.table([{h:'Date',w:.13},{h:'Type',w:.15},{h:'Topic',w:.3},{h:'Venue',w:.18},{h:'Attended',w:.12,a:'r'},{h:'Women',w:.12,a:'r'}],E.map(v=>[v.date,v.type||'',v.topic||'',v.venue||'',String(v.att||0),String(v.wom||0)]),{size:7.5,empty:'No events recorded.'});
 if((db.GP||[]).length){d.h2('Farmer groups');d.table([{h:'Group',w:.28},{h:'Leader',w:.22},{h:'Phone',w:.16},{h:'Village',w:.22},{h:'Members',w:.12,a:'r'}],db.GP.map(g=>[g.name,sd(g.leader),sd(g.tel),sd(g.village),String(db.FM.filter(f=>f.grp==g.name).length||g.mem||0)]),{size:8})}
 const SO=(db.SO||[]).filter(v=>inR(v.date,f,t)).sort(byD);if(SO.length){d.h2('Farmers\u2019 produce offers');d.table([{h:'Date',w:.13},{h:'Farmer',w:.22},{h:'Produce',w:.22},{h:'Quantity',w:.15,a:'r'},{h:'Asking price',w:.14,a:'r'},{h:'Status',w:.14}],SO.map(v=>[v.date,v.farm||v.who||'',v.prod||'',(v.qty||'')+' '+(v.unit||''),v.ask?R(v.ask):'',v.st||'']),{size:7.5})}
 const BR=(db.BR||[]).filter(v=>inR(v.date,f,t)).sort(byD);if(BR.length){d.h2('Buyers\u2019 requests');d.table([{h:'Date',w:.13},{h:'Buyer',w:.22},{h:'Produce',w:.22},{h:'Quantity',w:.15,a:'r'},{h:'Price',w:.14,a:'r'},{h:'Status',w:.14}],BR.map(v=>[v.date,v.buyer||v.who||'',v.prod||'',(v.qty||'')+' '+(v.unit||''),v.price?R(v.price):'',v.st||'']),{size:7.5})}
 const DL=(db.DL||[]).filter(v=>inR(v.date||'',f,t)).sort(byD);if(DL.length){d.h2('Produce deals (bought from farmers, sold to buyers)');d.table([{h:'Date',w:.13},{h:'Farmer',w:.22},{h:'Produce',w:.2},{h:'Qty',w:.12,a:'r'},{h:'Bought @',w:.12,a:'r'},{h:'Sold to',w:.21}],DL.map(v=>[v.date||'',v.farm||v.who||'',v.prod||'',String(v.qty||''),R(v.bp),v.buyer||v.bwho||'']),{size:7.5})}
 if((db.BY||[]).length){d.h2('Buyer directory');d.table([{h:'Buyer',w:.26},{h:'Phone',w:.16},{h:'Type',w:.18},{h:'Location',w:.18},{h:'Buys',w:.22}],db.BY.map(b=>[b.name,sd(b.tel),sd(b.type),sd(b.loc),sd(b.prods)]),{size:7.5})}
 if((db.PT||[]).length){d.h2('Partners and referral contacts');d.table([{h:'Name',w:.26},{h:'Organisation',w:.26},{h:'Role',w:.18},{h:'Phone',w:.14},{h:'Type',w:.16}],db.PT.map(p=>[p.name,sd(p.org),sd(p.role),sd(p.tel),sd(p.cat)]),{size:7.5})}
 if((db.LC||[]).length){d.h2('Documents and licences');d.table([{h:'Document',w:.3},{h:'Number',w:.2},{h:'Issued by',w:.22},{h:'Expires',w:.14},{h:'Note',w:.14}],db.LC.map(l=>[l.name,sd(l.no),sd(l.issuer),sd(l.exp),sd(l.note)]),{size:7.5})}}

/* ---------- FULL BUSINESS REPORT / BACKUP ---------- */
async function bizBuild(f,t,embed){const logo=await logoJpeg(),label=(f||t)?(f||'start')+' to '+(t||'today'):'all records',title=embed?'Backup & full business record':'Full business report';
 const d=newA4(title);letter(d,logo,title,'Period: '+label+'  ·  made '+nowS()+(embed?'\nThis PDF contains a hidden full copy of the shop data. To restore: Setup → Restore from backup → choose this PDF.':''));
 const ss=db.S.filter(s=>inR(s.date,f,t)),xs=db.X.filter(x=>inR(x.date,f,t)),us=db.U.filter(u=>inR(u.date,f,t));
 secSummary(d,ss,xs,label);
 d.h2('Where the shop stands today');const owed=sum(db.S.filter(s=>s.pay=='Credit'),s=>tot(s)-paid(s));let so=sum(db.U,sowed);const m=stk();let sv=0;db.P.forEach(p=>{if(!svc(p))sv+=Math.max(m[p.name]||0,0)*costNow(p)});
 d.grid([['Stock value (cost)',sv],['Owed by customers',owed],['Owed to suppliers',so],['Advances held',sum(db.A,abal)]],4);
 const dates=[...new Set([...ss.map(s=>s.date),...xs.map(x=>x.date)])].sort().reverse();
 secDaily(d,dates);secProducts(d,ss);secStock(d);secSales(d,ss);secBuy(d,us);secExp(d,xs);secOwed(d);secMore(d,f,t);secAgro(d,f,t);
 d.para('— End of report —',{size:8,a:'c',col:d.T.mut});
 let emb=null;if(embed){const js=new TextEncoder().encode('BIZBACKUP-BEGIN:'+(Array.isArray(db.FM)?'agro':'pos')+'\n'+JSON.stringify(db)+'\nBIZBACKUP-END');emb={name:slug()+'-backup-'+td()+'.json',bytes:js}}
 return d.finish(emb,{title:(db.shop.name||'')+' — '+title,author:db.shop.name})}
function report(share){const body='<h2>Business report (PDF)</h2><small>Shop details, sales, stock, purchases, expenses, credit and more. Leave the dates empty to include everything.</small><label style="margin-top:8px">From date (optional)</label><input id="xrf" type="date"><label>To date (optional)</label><input id="xrt" type="date"><button class="btn big" onclick="X.reportGo(1)">Share PDF</button><button class="btn" onclick="X.reportGo(0)">Download PDF</button><button class="btn" onclick="modal()">Cancel</button>';modal(body)}
function reportGo(share){const f=$('#xrf').value,t=$('#xrt').value;if(f&&t&&f>t)return alert('The From date must be before the To date.');modal();run('business report',async()=>{const b=await bizBuild(f,t,false);await out(b,slug()+'-business-report-'+td()+'.pdf',share)})}
function backup(share){return run('backup PDF',async()=>{db.lastBk=Date.now();save();const b=await bizBuild('','',true);await out(b,slug()+'-backup-'+td()+'.pdf',share)})}
async function pdfJson(file){const buf=new Uint8Array(await file.arrayBuffer()),s=new TextDecoder('latin1').decode(buf),b=s.indexOf('BIZBACKUP-BEGIN:');if(b<0)throw new Error('This PDF has no backup data inside. Use a PDF made with “Backup as PDF”, or a .json backup file.');
 const nl=s.indexOf('\n',b),e=s.indexOf('\nBIZBACKUP-END',nl),tag=s.slice(b+16,nl).trim();if(nl<0||e<0)throw new Error('The backup data in this PDF is incomplete.');
 const x=JSON.parse(new TextDecoder('utf-8').decode(buf.subarray(nl+1,e)));x._tag=tag;return x}

/* ---------- DAILY / MONTHLY REPORT ---------- */
function dayReport(share){const dd=st.rd||td();return run('daily report',async()=>{const logo=await logoJpeg(),d=newA4('Daily report '+dd),ss=db.S.filter(s=>s.date==dd),xs=db.X.filter(x=>x.date==dd),us=db.U.filter(u=>u.date==dd);
 letter(d,logo,'Daily report · '+dd,'Made '+nowS());secSummary(d,ss,xs,dd);
 const col=sum(db.S.filter(s=>s.pay=='Credit'),s=>sum(s.pays.filter(p=>p.d==dd&&!p.z),p=>p.a));d.grid([['Credit payments received',col],['Advances received',sum(db.A.filter(a=>a.date==dd),a=>a.amt)],['Cash paid for stock',sum(db.U,u=>cashOut(u,dd))]],3);
 secProducts(d,ss);secSales(d,ss,'Receipts');secExp(d,xs,'Expenses');secBuy(d,us,'Stock received');
 try{const cb=cbexp(dd),cl=db.C.find(z=>z.date==dd);d.h2('Cash book');d.grid([['Expected cash in box',cb.c],['Counted cash',cl?cl.cc:'not closed'],['Result',cl?(cl.cc-cb.c==0?'Balanced':(cl.cc<cb.c?'Short by ':'Over by ')+R(Math.abs(cl.cc-cb.c))):'–',cl&&cl.cc!=cb.c?'bad':'']],3)}catch(e){}
 await out(d.finish(null,{title:'Daily report '+dd,author:db.shop.name}),slug()+'-daily-'+dd+'.pdf',share)})}
function monthReport(share){const m=st.mon;return run('monthly report',async()=>{const logo=await logoJpeg(),d=newA4('Monthly report '+m),ss=db.S.filter(s=>s.date.startsWith(m)),xs=db.X.filter(x=>x.date.startsWith(m)),us=db.U.filter(u=>u.date.startsWith(m));
 letter(d,logo,'Monthly report · '+m,'Made '+nowS());secSummary(d,ss,xs,m);
 const dates=[...new Set([...ss.map(s=>s.date),...xs.map(x=>x.date)])].sort().reverse();secDaily(d,dates);secProducts(d,ss);
 const g={};xs.forEach(x=>{g[x.type||'Other']=(g[x.type||'Other']||0)+x.amt});d.h2('Expenses by type');d.table([{h:'Type',w:.7},{h:'Amount',w:.3,a:'r'}],Object.entries(g).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,R(v)]),{empty:'No expenses this month.'});
 secBuy(d,us);await out(d.finish(null,{title:'Monthly report '+m,author:db.shop.name}),slug()+'-monthly-'+m+'.pdf',share)})}

window.X=Object.assign(window.X||{},{receipt,report,reportGo,backup,pdfJson,dayReport,monthReport,_Doc:Doc});
})();
