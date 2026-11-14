/* OKPOTANI GENERAL HARDWARE - returns and refunds.
   Data: db.R (synced through cloud.js COLS). One record per return:
   {id,no,sid,sno,date,time,by,cust,reason,note,items:[{n,q,p,c,back}],val,dec,cash,momo,exch,xid,xno,rev}
   val = value of goods returned; dec + cash + momo + exch = val.
   Core maths (stock, profit, cash book, credit balance) lives in index.html (rets, rtv, rtc, rdec, stk, pl, flows, paid). */
(function(){
'use strict';
const A=()=>(db.R=db.R||[]);
const q3=x=>Math.round((+x||0)*1000)/1000;
const rn=x=>Math.round(+x||0);
const sById=i=>db.S.find(s=>s.id==i);
const hasName=n=>{n=String(n||'').trim();return !!n&&n.toLowerCase()!=='walk-in'};
const REASONS=['Customer changed mind','Wrong item or size','Faulty / damaged goods','Overcharged / price error','Bought by mistake','Other'];
const LAB={cash:'Cash',momo:'Mobile Money',debt:'Reduce what they owe',exch:'Exchange for other items'};
let D=null;

/* ---------- styles (colours come from the app theme variables, so light and dark both work) ---------- */
(function(){const e=document.createElement('style');e.id='okp-rt-css';e.textContent=
'.rtl{background:var(--card);border:1.5px solid var(--line);border-radius:14px;padding:12px;margin-bottom:10px}'+
'.rtl>b{display:block;overflow-wrap:anywhere;font-size:1.02em}'+
'.rtm{display:block;font-size:12.5px;color:var(--mut);margin:3px 0 9px;line-height:1.4}'+
'.rtq{display:flex;gap:6px;align-items:center}'+
'.rtq input{margin:0;text-align:center;font-size:20px;font-weight:800;min-height:50px;flex:1;min-width:0}'+
'.rtq button{min-width:54px;min-height:50px;border-radius:12px;border:1.5px solid var(--line);background:var(--card);color:var(--ink);font-size:24px;font-weight:800;cursor:pointer}'+
'.rtq button.all{min-width:62px;font-size:14px;background:var(--acc);border-color:var(--acc);color:#1b1100}'+
'.rtl .seg{margin:9px 0 0}.rtl .seg button{min-height:46px}'+
'.rtx2{display:grid;grid-template-columns:1fr 1.4fr 54px;gap:8px;align-items:end;margin-top:8px}'+
'.rtx2 input{margin:0;min-height:48px}.rtx2 .btn{margin:0;min-height:48px;padding:0}'+
'.rtdh{display:flex;justify-content:space-between;align-items:baseline;margin:16px 2px 6px;font-weight:700}'+
'.rtrev{opacity:.55}.rtlist .item{width:100%}'+
'#md .rtsel{min-height:50px}'+
'.rtfin .item{cursor:default}';
document.head.appendChild(e)})();

/* ---------- quantity rules ---------- */
function lines(s){const m=new Map();s.items.forEach(i=>{const g=m.get(i.n)||{n:i.n,q:0,v:0,k:0};g.q+=i.q;g.v+=i.q*i.p;g.k+=i.q*i.c;m.set(i.n,g)});
 return[...m.values()].map(g=>({n:g.n,q:q3(g.q),p:g.q?g.v/g.q:0,c:g.q?g.k/g.q:0}))}
function doneQ(s,n){let a=0;rets().forEach(r=>{if(r.sid==s.id)r.items.forEach(i=>{if(i.n==n)a+=i.q})});return q3(a)}
function leftQ(s,n){const l=lines(s).find(x=>x.n==n);return l?Math.max(0,q3(l.q-doneQ(s,n))):0}
const defMode=s=>(s.pay=='Credit'&&Math.round(tot(s)-paid(s))>0)?'debt':(s.pay=='Mobile Money'?'momo':'cash');

/* ---------- the calculation shared by the form and by create() ---------- */
function calc(d){
 const s=sById(d.sid),L=lines(s),items=[];
 L.forEach(l=>{const q=q3(Math.min(Math.max(+(d.q&&d.q[l.n])||0,0),leftQ(s,l.n)));if(q>0)items.push({n:l.n,q,p:l.p,c:l.c,back:(d.back&&d.back[l.n]===0)?0:1})});
 const V=rn(items.reduce((a,i)=>a+i.q*i.p,0));
 const cr=s.pay=='Credit',O=cr?Math.max(0,rn(tot(s)-paid(s))):0,Dd=Math.min(V,O),M=V-Dd;
 const modes=O>0?['debt','exch']:['cash','momo','exch'];
 const mode=modes.includes(d.mode)?d.mode:defMode(s);
 const xit=(d.xit||[]).filter(x=>x.n&&+x.q>0),X=rn(xit.reduce((a,x)=>a+x.q*x.p,0)),mp=d.mpay=='momo'?'momo':'cash';
 let cash=0,momo=0,exch=0,rest=0,diff=0;
 if(mode=='cash')cash=M;else if(mode=='momo')momo=M;
 else if(mode=='debt'){if(mp=='momo')momo=M;else cash=M}
 else{exch=Math.min(M,X);rest=M-exch;diff=X-exch;if(mp=='momo')momo=rest;else cash=rest}
 const needMp=(mode=='debt'&&M>0)||(mode=='exch'&&rest>0);
 return{s,L,items,V,cr,O,D:Dd,M,modes,mode,cash,momo,exch,X,diff,rest,needMp,mp,xit}}

/* ---------- create a return (used by the form; also testable on its own) ---------- */
function create(d){
 const s=sById(d.sid);if(!s)return{err:'That receipt was not found.'};
 const c=calc(d);
 if(!c.items.length)return{err:'Enter how many of each item are coming back.'};
 for(const l of c.L){const q=+(d.q&&d.q[l.n])||0;if(q>leftQ(s,l.n)+1e-9)return{err:'Too many '+l.n+': only '+leftQ(s,l.n)+' can still be returned.'}}
 if(!String(d.reason||'').trim())return{err:'Choose the reason for the return.'};
 const date=d.date||td();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return{err:'Enter a valid date.'};
 if(date<s.date)return{err:'The return date cannot be before the receipt date ('+s.date+').'};
 if(!c.modes.includes(d.mode||c.mode))return{err:'That refund option is not available for this receipt.'};
 let xpay='Cash';
 if(c.mode=='exch'){
  if(!c.xit.length)return{err:'Choose the items the customer takes in exchange, or pick another refund option.'};
  if(c.xit.some(x=>!(+x.q>0)||!(+x.p>=0)))return{err:'Check the quantities and prices of the exchange items.'};
  if(c.diff>0){xpay=['Cash','Mobile Money','Credit'].includes(d.xpay)?d.xpay:'Cash';
   if(xpay=='Credit'){const cu=String(s.cust||'').trim();if(!hasName(cu))return{err:'Credit needs a customer name and this receipt has none. Choose Cash or Mobile Money for the difference.'};
    if(window.okpCr){const er=okpCr.check(cu,c.diff,0);if(er)return{err:er}}}}}
 const rid=id(),no=Math.max(0,...A().map(r=>+r.no||0))+1,time=d.time||nowt(),by=String(d.by||'').trim();
 const rec={id:rid,no,sid:s.id,sno:s.no,date,time,by,cust:s.cust||'',reason:String(d.reason).trim(),note:String(d.note||'').trim(),
  items:c.items.map(i=>({n:i.n,q:i.q,p:i.p,c:i.c,back:i.back})),val:c.V,dec:c.D,cash:c.cash,momo:c.momo,exch:c.exch};
 let xs=null;
 if(c.mode=='exch'){
  xs={id:id(),no:Math.max(0,...db.S.map(x=>+x.no||0))+1,date,time,by,cust:s.cust||'',pay:xpay,pays:[],
   items:c.xit.map(x=>({n:x.n,q:+x.q,p:+x.p,c:+x.c||0})),xrid:rid};
  if(c.exch>0)xs.advA=c.exch;
  db.S.push(xs);rec.xid=xs.id;rec.xno=xs.no;
  if(xpay=='Credit'&&window.okpCr)okpCr.ensure(xs.cust,'',xs,'');}
 A().push(rec);db.lastSb=by;save();
 return{ok:1,rec,xs}}

/* ---------- guards used by the rest of the app ---------- */
function locked(s){
 if(!s)return false;
 const rs=A().filter(r=>!r.rev&&r.sid==s.id);
 if(rs.length){alert('Receipt #'+s.no+' has '+rs.length+' return'+(rs.length>1?'s':'')+'. To edit or delete this receipt, first reverse its returns: Money → Returns → open the return → Reverse this return.');return true}
 if(s.xrid){const r=A().find(x=>x.id==s.xrid&&!x.rev);if(r){alert('Receipt #'+s.no+' was made by exchange return R-'+r.no+'. To change or remove it, reverse that return (Money → Returns).');return true}}
 return false}
function dayLocked(d){
 const bad=db.S.filter(s=>s.date==d).find(s=>A().some(r=>!r.rev&&r.sid==s.id&&r.date!=d));
 if(bad){alert('Receipt #'+bad.no+' has a return on another day. Reverse that return first (Money → Returns), then delete this day.');return true}
 return false}

/* ---------- start: choose the receipt ---------- */
function start(sid){if(sid)begin(sid);else pick('')}
function pick(q){
 modal('<h2>New return / refund</h2><small>Find the receipt the goods were sold on.</small><input id="rtpq" type="search" placeholder="Receipt number, customer or product" value="'+esc(q||'')+'" oninput="okpRt.pickFind(this.value)" autocomplete="off"><div id="rtpl">'+pickList(q)+'</div><button class="btn" onclick="modal()">Cancel</button>');
 const e=$('#rtpq');if(e&&!q)e.focus()}
function pickFind(v){const e=$('#rtpl');if(e)e.innerHTML=pickList(v)}
function pickList(q){
 const w=String(q||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
 let L=db.S.slice().sort((a,b)=>(b.date+(b.time||'')+String(1e6+(+b.no||0)))<(a.date+(a.time||'')+String(1e6+(+a.no||0)))?-1:1);
 if(w.length){L=L.filter(s=>{const h=('#'+s.no+' '+s.no+' '+(s.cust||'walk-in')+' '+s.date+' '+s.pay+' '+s.items.map(i=>i.n).join(' ')).toLowerCase();return w.every(k=>h.includes(k))});
  if(/^#?\d+$/.test(w[0])){const n=w[0].replace('#','');L.sort((a,b)=>(String(a.no)==n?0:1)-(String(b.no)==n?0:1))}}
 L=L.slice(0,w.length?40:25);
 return L.map(s=>{const rem=sum(lines(s),l=>leftQ(s,l.n)),rv=rtsv(s);
  return'<button class="item" onclick="okpRt.begin('+s.id+')"><span class="nm"><b>#'+s.no+' · '+esc(s.cust||'Walk-in')+'</b><small>'+s.date+(s.time?' · '+s.time:'')+' · '+esc(s.pay)+(rv>0?(rem<=0?' · fully returned':' · returned UGX '+fm(rv)):'')+'</small><small>'+s.items.map(i=>esc(i.n)+' ×'+i.q).join(', ')+'</small></span><span class="pr">UGX '+fm(tot(s))+'</span></button>'}).join('')||'<div class="empty">No receipt found</div>'}

function begin(sid){
 const s=sById(sid);if(!s)return;
 if(!lines(s).some(l=>leftQ(s,l.n)>0)){modal();return alert('Everything on receipt #'+s.no+' has already been returned.')}
 D={sid:s.id,q:{},back:{},reason:'',note:'',date:td(),time:'',by:(window.okpAcc&&okpAcc.name())||db.lastSb||'',mode:defMode(s),mpay:'cash',xit:[],xpay:'Cash'};
 formShow()}

/* ---------- the return form ---------- */
function byBox(){
 const L=(db.staff||[]).slice();if(D.by&&!L.includes(D.by))L.push(D.by);
 return'<label>Served by</label>'+(L.length?'<select id="rtby" class="rtsel" onchange="okpRt.f(\'by\',this.value)"><option value="">(not recorded)</option>'+L.map(n=>'<option'+(n==D.by?' selected':'')+'>'+esc(n)+'</option>').join('')+'</select>'
  :'<input id="rtby" placeholder="Name of the person serving (optional)" value="'+esc(D.by||'')+'" oninput="okpRt.f(\'by\',this.value)">')}
function formShow(){
 const s=sById(D.sid),L=lines(s);
 let h='<h2>Return / refund</h2><div class="item" style="cursor:default"><span class="nm"><b>Receipt #'+s.no+' · '+esc(s.cust||'Walk-in')+'</b><small>'+s.date+(s.time?' · '+s.time:'')+' · '+esc(s.pay)+(s.by?' · '+esc(s.by):'')+'</small></span><span class="pr">UGX '+fm(tot(s))+'</span></div><h3>Items coming back</h3>';
 L.forEach((l,i)=>{const lf=leftQ(s,l.n),dn=doneQ(s,l.n);
  h+='<div class="rtl" id="rtr'+i+'"><b>'+esc(l.n)+'</b><span class="rtm">Sold '+l.q+' · already returned '+dn+' · can still return '+lf+' · UGX '+fm(l.p)+' each</span>'+
  (lf>0?'<div class="rtq"><button type="button" aria-label="One less" onclick="okpRt.step('+i+',-1)">−</button><input id="rtq'+i+'" type="number" inputmode="decimal" step="any" min="0" max="'+lf+'" placeholder="0" aria-label="Quantity coming back" oninput="okpRt.setq('+i+',this.value)"><button type="button" aria-label="One more" onclick="okpRt.step('+i+',1)">+</button><button type="button" class="all" onclick="okpRt.all('+i+')">All</button></div>'+
   '<div class="seg hide" id="rtb'+i+'"><button type="button" id="rtbb'+i+'" class="on" onclick="okpRt.back('+i+',1)">↩ Back to stock</button><button type="button" id="rtbd'+i+'" onclick="okpRt.back('+i+',0)">🗑 Damaged</button></div>':'<small>Nothing left to return on this item.</small>')+'</div>'});
 h+='<label>Reason for the return</label><select id="rtrs" class="rtsel" onchange="okpRt.f(\'reason\',this.value)"><option value="">Choose a reason…</option>'+REASONS.map(r=>'<option>'+esc(r)+'</option>').join('')+'</select><input id="rtnt" placeholder="More details (optional)" oninput="okpRt.f(\'note\',this.value)">'+
  '<label>Date</label><input id="rtd" type="date" value="'+D.date+'" onchange="okpRt.f(\'date\',this.value)"><label>Time (leave empty to use the time you complete it)</label><input id="rttm" type="time" onchange="okpRt.f(\'time\',this.value)">'+byBox()+
  '<h3>Refund</h3><div id="rtv"></div><div id="rtmodes"></div>'+
  '<div id="rtx" class="hide"><h3>Items the customer takes in exchange</h3><div id="rtxl"></div><input id="rtxs" type="search" placeholder="Search a product to add…" autocomplete="off" oninput="okpRt.xfind(this.value)"><div id="rtxr"></div></div>'+
  '<div id="rtfin" class="rtfin"></div><button class="btn big" id="rtgo" onclick="okpRt.go()">Complete return</button><button class="btn" onclick="modal()">Cancel</button>';
 modal(h);xList();upd()}
function f(k,v){if(D)D[k]=v}
function setq(i,v){const s=sById(D.sid),l=lines(s)[i],mx=leftQ(s,l.n);let x=q3(parseFloat(v));if(!(x>0))x=0;
 if(x>mx){x=mx;const e=$('#rtq'+i);if(e)e.value=x;toast('Only '+mx+' can be returned')}D.q[l.n]=x;upd()}
function step(i,dl){const s=sById(D.sid),l=lines(s)[i],mx=leftQ(s,l.n);let x=q3((D.q[l.n]||0)+dl);x=Math.min(Math.max(x,0),mx);D.q[l.n]=x;const e=$('#rtq'+i);if(e)e.value=x||'';upd()}
function all(i){const s=sById(D.sid),l=lines(s)[i];D.q[l.n]=leftQ(s,l.n);const e=$('#rtq'+i);if(e)e.value=D.q[l.n];upd()}
function back(i,v){const s=sById(D.sid),l=lines(s)[i];D.back[l.n]=v?1:0;upd()}
function mode(k){D.mode=k;upd()}

function modesH(c){
 let h='<label>How is the customer refunded?</label>';
 if(c.O>0)h+='<div class="item" style="cursor:default"><span class="nm"><b>Still owed on this receipt</b><small>Returned goods are taken off what the customer owes first</small></span><span class="pr low">UGX '+fm(c.O)+'</span></div>';
 h+='<div class="seg">'+c.modes.map(k=>'<button type="button" class="'+(c.mode==k?'on':'')+'" onclick="okpRt.mode(\''+k+'\')">'+LAB[k]+'</button>').join('')+'</div>';
 if(c.needMp)h+='<label>'+(c.mode=='exch'?'Money left over (UGX '+fm(c.rest)+') is paid back in':'The customer had already paid UGX '+fm(c.M)+'. Pay it back in')+'</label><select id="rtmp" class="rtsel" onchange="okpRt.f(\'mpay\',this.value);okpRt.upd()"><option value="cash"'+(c.mp=='cash'?' selected':'')+'>Cash</option><option value="momo"'+(c.mp=='momo'?' selected':'')+'>Mobile Money</option></select>';
 if(c.mode=='exch'&&c.diff>0){const cu=hasName(c.s.cust);
  h+='<label>The customer pays the difference (UGX '+fm(c.diff)+') by</label><select id="rtxp" class="rtsel" onchange="okpRt.f(\'xpay\',this.value);okpRt.upd()">'+['Cash','Mobile Money'].concat(cu?['Credit']:[]).map(p=>'<option'+(D.xpay==p?' selected':'')+'>'+p+'</option>').join('')+'</select>'}
 return h}
function finH(c){
 const row=(a,b,cls)=>'<div class="item"><span class="nm"><b>'+a+'</b></span><span class="pr '+(cls||'')+'">'+b+'</span></div>';
 let h='';
 if(c.D>0)h+=row('Taken off what the customer owes','UGX '+fm(c.D));
 if(c.cash>0)h+=row('Cash to give back','UGX '+fm(c.cash));
 if(c.momo>0)h+=row('Mobile Money to send back','UGX '+fm(c.momo));
 if(c.mode=='exch'){h+=row('Exchange items total','UGX '+fm(c.X));if(c.exch>0)h+=row('Return credit used','UGX '+fm(c.exch));if(c.diff>0)h+=row('Customer pays now ('+(D.xpay||'Cash')+')','UGX '+fm(c.diff))}
 const bk=c.items.filter(i=>i.back),dm=c.items.filter(i=>!i.back);
 if(bk.length)h+=row('Back to stock',bk.map(i=>esc(i.n)+' ×'+i.q).join(', '));
 if(dm.length)h+=row('Written off as damaged',dm.map(i=>esc(i.n)+' ×'+i.q).join(', '),'low');
 return h}
function upd(){
 if(!D)return;const c=calc(D);D.mode=c.mode;
 const v=$('#rtv');if(!v)return;
 v.innerHTML='<div class="stat wide"><small>Value of goods coming back</small><span class="num">UGX '+fm(c.V)+'</span></div>';
 $('#rtmodes').innerHTML=modesH(c);
 $('#rtx').classList.toggle('hide',c.mode!='exch');
 $('#rtfin').innerHTML=c.items.length?finH(c):'';
 c.L.forEach((l,i)=>{const b=$('#rtb'+i);if(!b)return;const on=(D.q[l.n]||0)>0;b.classList.toggle('hide',!on);
  const bb=$('#rtbb'+i),bd=$('#rtbd'+i);if(bb)bb.classList.toggle('on',D.back[l.n]!==0);if(bd)bd.classList.toggle('on',D.back[l.n]===0);
  const r=$('#rtr'+i);if(r)r.style.borderColor=on?'var(--acc)':''});
 const g=$('#rtgo');if(g){g.disabled=!c.items.length;g.textContent=c.items.length?'Complete return · UGX '+fm(c.V):'Complete return'}}

/* exchange items */
function xList(){
 const e=$('#rtxl');if(!e)return;
 e.innerHTML=D.xit.map((x,k)=>'<div class="rtl"><b>'+esc(x.n)+'</b><div class="rtx2"><div><label>Qty</label><input type="number" inputmode="decimal" step="any" min="0" value="'+x.q+'" oninput="okpRt.xq('+k+',this.value)"></div><div><label>Price (UGX)</label><input type="number" inputmode="numeric" min="0" value="'+x.p+'" oninput="okpRt.xp('+k+',this.value)"></div><button type="button" class="btn del" aria-label="Remove" onclick="okpRt.xdel('+k+')">✕</button></div></div>').join('')}
function xfind(v){
 const e=$('#rtxr');if(!e)return;const w=String(v||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
 if(!w.length){e.innerHTML='';return}
 const m=stk();
 e.innerHTML=db.P.filter(p=>{const h=(p.name+' '+(p.code||'')+' '+(p.cat||'')).toLowerCase();return w.every(k=>h.includes(k))}).slice(0,6)
  .map(p=>'<button type="button" class="item" onclick="okpRt.xadd(\''+p.id+'\')"><span class="nm"><b>'+esc(p.name)+'</b><small>In stock: '+(Math.round((m[p.name]||0)*100)/100)+'</small></span><span class="pr">UGX '+fm(p.price)+'</span></button>').join('')||'<div class="empty">No product found</div>'}
function xadd(pid){
 const p=db.P.find(x=>String(x.id)==String(pid));if(!p)return;
 const ex=D.xit.find(x=>x.n==p.name);if(ex)ex.q=q3(ex.q+1);else D.xit.push({n:p.name,q:1,p:p.price||0,c:costNow(p)});
 const s=$('#rtxs');if(s)s.value='';$('#rtxr').innerHTML='';xList();upd()}
function xq(k,v){if(D.xit[k])D.xit[k].q=q3(parseFloat(v)||0);upd()}
function xp(k,v){if(D.xit[k])D.xit[k].p=Math.max(0,parseFloat(v)||0);upd()}
function xdel(k){D.xit.splice(k,1);xList();upd()}

function go(){
 const b=$('#rtgo');if(b&&b.disabled)return;
 const r=create(D);if(r.err)return alert(r.err);
 D=null;render();view(r.rec.id);toast('Return saved ✓')}

/* ---------- return receipt ---------- */
const reasonOf=r=>r.reason+(r.note?' – '+r.note:'');
function rtHtml(r){
 const th=shp().paper=='58',s=sById(r.sid),xs=r.xid?sById(r.xid):null,R=(a,b)=>'<tr><td>'+a+'</td><td>'+b+'</td></tr>';
 const st=i=>'<br><span style="font-size:.85em;color:#333">'+(i.back?'back to stock':'damaged · written off')+'</span>';
 let h='<div class="rcp'+(th?' p58':'')+'">'+rch('RETURN / REFUND')+(r.rev?'<div class="ttl">*** REVERSED '+r.rev.date+' ***</div>':'')+
 '<table class="mt">'+R('Return no.','R-'+r.no)+R('Receipt no.','#'+r.sno)+R('Date',r.date+(r.time?'  '+r.time:''))+R('Customer',esc(r.cust||'Walk-in'))+(r.by?R('Served by',esc(r.by)):'')+R('Reason',esc(reasonOf(r)))+'</table><hr class="ds">'+
 (th?'<table class="it2">'+r.items.map(i=>'<tr><td colspan="2"><b>'+esc(i.n)+'</b>'+st(i)+'</td></tr><tr><td>'+i.q+' x '+fm(i.p)+'</td><td>'+fm(i.q*i.p)+'</td></tr>').join('')+'</table>'
  :'<table class="it"><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>'+r.items.map(i=>'<tr><td>'+esc(i.n)+st(i)+'</td><td>'+i.q+'</td><td>'+fm(i.p)+'</td><td>'+fm(i.q*i.p)+'</td></tr>').join('')+'</table>')+
 '<hr class="ds"><table class="tt">'+R('TOTAL RETURNED','UGX '+fm(r.val))+(r.dec>0?R('Taken off balance owed',fm(r.dec)):'')+(r.cash>0?R('Refunded in cash',fm(r.cash)):'')+(r.momo>0?R('Refunded by Mobile Money',fm(r.momo)):'')+(r.exch>0?R('Exchange credit',fm(r.exch)):'')+'</table>';
 if(xs)h+='<hr class="ds"><b>Exchange · receipt #'+xs.no+'</b>'+(th?'<table class="it2">'+xs.items.map(i=>'<tr><td colspan="2"><b>'+esc(i.n)+'</b></td></tr><tr><td>'+i.q+' x '+fm(i.p)+'</td><td>'+fm(i.q*i.p)+'</td></tr>').join('')+'</table>'
  :'<table class="it"><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>'+xs.items.map(i=>'<tr><td>'+esc(i.n)+'</td><td>'+i.q+'</td><td>'+fm(i.p)+'</td><td>'+fm(i.q*i.p)+'</td></tr>').join('')+'</table>')+
  '<table class="tt">'+R('Exchange total',fm(tot(xs)))+(xs.advA?R('Return credit used','-'+fm(xs.advA)):'')+R('Customer pays ('+esc(xs.pay)+')',fm(tot(xs)-(xs.advA||0)))+'</table>';
 if(r.cust&&window.okpCr&&((s&&s.pay=='Credit')||(xs&&xs.pay=='Credit')))h+='<table class="tt">'+R('ACCOUNT BALANCE','UGX '+fm(okpCr.bal(r.cust)))+'</table>';
 return h+rcf()+'</div>'}
function rtText(r){
 const sh=db.shop,h=shp(),w=(a,b)=>a.padEnd(22).slice(0,22)+b.padStart(10),s=sById(r.sid),xs=r.xid?sById(r.xid):null,L='-'.repeat(32);
 return[sh.name,h.tag,sh.addr,sh.tel?'Tel: '+sh.tel:'',sh.reg?'Licence: '+sh.reg:'',sh.tin?'TIN: '+sh.tin:'','RETURN / REFUND'+(r.rev?' (REVERSED)':''),'Return no.: R-'+r.no,'Receipt no.: #'+r.sno,'Date: '+r.date+(r.time?' '+r.time:''),'Customer: '+(r.cust||'Walk-in'),r.by?'Served by: '+r.by:'','Reason: '+reasonOf(r),L,
  ...r.items.map(i=>i.n+'\n'+w('  '+i.q+' x '+fm(i.p),fm(i.q*i.p))+'\n  ('+(i.back?'back to stock':'damaged, written off')+')'),L,
  w('TOTAL RETURNED',fm(r.val)),r.dec>0?w('Taken off balance',fm(r.dec)):'',r.cash>0?w('Refunded in cash',fm(r.cash)):'',r.momo>0?w('Refunded by MoMo',fm(r.momo)):'',r.exch>0?w('Exchange credit',fm(r.exch)):'',
  ...(xs?[L,'Exchange · receipt #'+xs.no,...xs.items.map(i=>w(i.n.slice(0,16)+' x'+i.q,fm(i.q*i.p))),w('Exchange total',fm(tot(xs))),xs.advA?w('Return credit used','-'+fm(xs.advA)):'',w('Customer pays ('+xs.pay+')',fm(tot(xs)-(xs.advA||0)))]:[]),
  r.cust&&window.okpCr&&((s&&s.pay=='Credit')||(xs&&xs.pay=='Credit'))?w('ACCOUNT BALANCE',fm(okpCr.bal(r.cust))):'',h.foot].filter(x=>x!=='').join('\n')}
function view(rid){
 const r=A().find(x=>x.id==rid);if(!r)return;const th=shp().paper=='58',xs=r.xid?sById(r.xid):null,s=sById(r.sid);
 modal('<div id="rc">'+rtHtml(r)+'</div><label style="margin-top:10px">Print layout on this device</label><div class="seg"><button class="'+(th?'':'on')+'" onclick="okpRt.paper(\'a4\','+r.id+')">Normal</button><button class="'+(th?'on':'')+'" onclick="okpRt.paper(\'58\','+r.id+')">58mm printer</button></div>'+
  '<button class="btn big" onclick="rprint()">🖨 Print</button>'+(window.X&&X.returnReceipt?'<button class="btn" onclick="X.returnReceipt('+r.id+',1)">📄 Share receipt as PDF</button><button class="btn" onclick="X.returnReceipt('+r.id+',0)">⬇ Download receipt PDF</button>':'')+
  '<a class="btn" style="text-align:center;text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/?text='+encodeURIComponent(rtText(r))+'">Share on WhatsApp</a>'+
  (s?'<button class="btn" onclick="rcpt('+s.id+')">View original receipt #'+s.no+'</button>':'')+(xs?'<button class="btn" onclick="rcpt('+xs.id+')">View exchange receipt #'+xs.no+'</button>':'')+
  (r.rev?'<div class="empty">This return was reversed on '+r.rev.date+(r.rev.time?' '+r.rev.time:'')+'. It no longer affects stock, cash or reports.</div>':'<button class="btn del" onclick="okpRt.reverse('+r.id+')">Reverse this return (mistake)</button>')+
  '<button class="btn" onclick="modal()">Close</button>')}
function paper(v,rid){try{localStorage.setItem('okp_paper',v)}catch(e){}view(rid)}

/* ---------- reverse ---------- */
function reverse(rid){
 const r=A().find(x=>x.id==rid);if(!r||r.rev)return;
 const xs=r.xid?sById(r.xid):null;
 if(xs){if(A().some(z=>!z.rev&&z.sid==xs.id))return alert('The exchange receipt #'+xs.no+' has its own return. Reverse that return first.');
  if(sum(xs.pays||[],p=>p.a)>0)return alert('The customer has already made payments on exchange receipt #'+xs.no+'. Deal with those payments first.')}
 askc('Reverse return R-'+r.no+'?\n\n• Items that went back to stock are taken out of stock again.\n• Cash / Mobile Money refunds disappear from the cash book.\n• What the customer owes goes back up by UGX '+fm(r.dec)+'.\n'+(xs?'• Exchange receipt #'+xs.no+' is deleted.\n':'')+'\nUse this only to correct a mistake.',()=>{
  r.rev={date:td(),time:nowt(),by:(window.okpAcc&&okpAcc.name())||db.lastSb||''};
  if(xs)db.S=db.S.filter(x=>x.id!=xs.id);
  save();render();view(rid);toast('Return reversed')})}

/* ---------- Money → Returns tab ---------- */
const hay=r=>['R-'+r.no,'r'+r.no,'#'+r.sno,r.sno,r.cust||'walk-in',r.reason,r.note,r.by,r.date,rthow(r),r.items.map(i=>i.n).join(' ')].join(' ').toLowerCase();
function rowH(r){
 const sub=[r.time||'',esc(r.cust||'Walk-in'),esc(rthow(r)),r.by?esc(r.by):''].filter(Boolean).join(' · ');
 return'<button class="item'+(r.rev?' rtrev':'')+'" onclick="okpRt.view('+r.id+')"><span class="nm"><b>R-'+r.no+' · Receipt #'+r.sno+'</b><small>'+sub+'</small><small>'+r.items.map(i=>esc(i.n)+' ×'+i.q).join(', ')+' · '+esc(r.reason)+'</small>'+(r.rev?'<small class="low">REVERSED</small>':'')+'</span><span class="pr'+(r.rev?'':' low')+'">'+(r.rev?'':'−')+'UGX '+fm(r.val)+'</span></button>'}
function listH(){
 const q=String(st.rq||'').trim().toLowerCase(),m=st.rm||td().slice(0,7);
 let L=A().slice();
 if(q){const w=q.split(/\s+/).filter(Boolean);L=L.filter(r=>{const h=hay(r);return w.every(k=>h.includes(k))})}
 else L=L.filter(r=>(r.date||'').startsWith(m));
 L.sort((a,b)=>(b.date+(b.time||'')+String(1e6+b.no))<(a.date+(a.time||'')+String(1e6+a.no))?-1:1);
 const act=L.filter(r=>!r.rev);
 let h='<div class="stat wide"><small>'+(q?'Found '+L.length+' return'+(L.length==1?'':'s'):'Returned in '+new Date(m+'-01T00:00').toLocaleDateString('en-GB',{month:'long',year:'numeric'}))+'</small><span class="num">UGX '+fm(sum(act,rtv))+'</span></div>';
 const days=[...new Set(L.map(r=>r.date))];
 days.forEach(d=>{const g=L.filter(r=>r.date==d);h+='<div class="rtdh"><span>'+fdt(d)+'</span><span class="low">'+(sum(g.filter(r=>!r.rev),rtv)?'−UGX '+fm(sum(g.filter(r=>!r.rev),rtv)):'')+'</span></div>'+g.map(rowH).join('')});
 if(!L.length)h+='<div class="empty">'+(q?'No return found':'No returns recorded in this month')+'</div>';
 return h}
function tab(seg){
 const m=st.rm||td().slice(0,7),today=A().filter(r=>!r.rev&&r.date==td()),mon=A().filter(r=>!r.rev&&(r.date||'').startsWith(m));
 return seg+'<div class="cards"><div class="stat"><small>Returned today ('+today.length+')</small><span class="num">'+fm(sum(today,rtv))+'</span></div><div class="stat"><small>Returned in month ('+mon.length+')</small><span class="num">'+fm(sum(mon,rtv))+'</span></div></div>'+
  '<button class="btn big" onclick="okpRt.start()">+ New return / refund</button>'+
  '<input id="rtsq" type="search" placeholder="Search return no., receipt no., customer, item or reason" value="'+esc(st.rq||'')+'" oninput="okpRt.search(this.value)" autocomplete="off">'+
  '<label>Month (clear the search to use it)</label><input type="month" value="'+m+'" onchange="okpRt.month(this.value)">'+
  '<div id="rtlist" class="rtlist">'+listH()+'</div>'}
function search(v){st.rq=v;const e=$('#rtlist');if(e)e.innerHTML=listH()}
function month(v){if(v){st.rm=v;render()}}

/* ---------- buttons shown inside the sale receipt ---------- */
function btns(s){
 const L=A().filter(r=>r.sid==s.id);
 let h='<button class="btn" onclick="okpRt.start('+s.id+')">↩️ Return / refund items</button>';
 if(L.length)h+='<h3>Returns on this receipt</h3><div class="rtlist">'+L.map(rowH).join('')+'</div>';
 if(s.xrid){const r=A().find(x=>x.id==s.xrid);if(r)h+='<button class="item" onclick="okpRt.view('+r.id+')"><span class="nm"><b>Exchange for return R-'+r.no+'</b><small>Tap to open that return</small></span></button>'}
 return h}

window.okpRt={tab,start,begin,pickFind,setq,step,all,back,f,mode,upd,xfind,xadd,xq,xp,xdel,go,view,reverse,paper,search,month,btns,locked,dayLocked,create,calc,lines,leftQ,doneQ,rtText,rtHtml,_D:()=>D};
try{if(typeof render==='function'&&!$('#md').innerHTML)render()}catch(e){}
})();
