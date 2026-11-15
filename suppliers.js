/* Okpotani supplier book and payables. Builds on the existing purchases (db.U) and their payments (u.pays), so the cash book,
 * reports and sync keep one set of figures. Adds: supplier records (db.SP), supplier returns / credit notes (db.SR, applied to
 * purchases as u.cn so they reduce what is owed and the stock), payables tab, supplier account, pay supplier, ageing, reminders. */
(function(){
'use strict';
const key=n=>String(n||'').trim().toLowerCase(),sps=()=>(db.SP=db.SP||[]),srs=()=>(db.SR=db.SR||[]);
const find=n=>sps().find(s=>key(s.name)==key(n)),enc=k=>encodeURIComponent(k).replace(/'/g,'%27');
const dys=t=>{const m=/^(\d+)/.exec(t||'');return m?+m[1]:0};
const dueOf=u=>u.due||addd(u.date,dys((find(u.sup)||{}).terms));
const byOld=(a,b)=>a.date<b.date?-1:a.date>b.date?1:a.id-b.id;
const purs=n=>db.U.filter(u=>u.cr&&key(u.sup)==key(n));
const waNum=p=>{let d=String(p||'').replace(/\D/g,'');if(d.startsWith('0'))d='256'+d.slice(1);else if(d.length==9)d='256'+d;return d};
const A=(f,k)=>'okpSp.'+f+'(decodeURIComponent(\''+enc(k)+'\'))';
const TERMS=['Cash on delivery','7 days','14 days','30 days'];

function migrate(){let ch=0;db.U.forEach(u=>{if(key(u.sup)&&!find(u.sup)){sps().push({id:id(),name:u.sup.trim(),terms:'Cash on delivery'});ch=1}});if(ch)save();return ch}
// Called whenever a purchase is saved: makes sure the supplier record exists and stores the due date from the payment terms.
function ensure(u){if(!u)return;if(key(u.sup)&&!find(u.sup))sps().push({id:id(),name:u.sup.trim(),terms:'Cash on delivery'});if(u.cr)u.due=addd(u.date,dys((find(u.sup)||{}).terms));else delete u.due}

function list(){
  const m=new Map();sps().forEach(s=>{if(key(s.name))m.set(key(s.name),{k:key(s.name),name:s.name,s})});
  db.U.forEach(u=>{const k=key(u.sup);if(k&&!m.has(k))m.set(k,{k,name:u.sup.trim(),s:null})});
  const t=td(),w=addd(t,7);
  return [...m.values()].map(r=>{
    const all=db.U.filter(u=>key(u.sup)==r.k),open=all.filter(u=>u.cr&&sowed(u)>0).sort(byOld);
    r.n=all.length;r.open=open;r.bal=sum(open,sowed);r.over=sum(open.filter(u=>dueOf(u)<t),sowed);
    r.week=sum(open.filter(u=>dueOf(u)>=t&&dueOf(u)<=w),sowed);r.prods=[...new Set(all.map(u=>u.n))];r.off=!!(r.s&&r.s.off);return r});
}
const one=k=>list().find(r=>r.k==k);
function ageing(L){const t=td(),b=[0,0,0,0];L.forEach(r=>r.open.forEach(u=>{const o=sowed(u),d=Math.round((new Date(t)-new Date(dueOf(u)))/864e5);b[d<=0?0:d<=7?1:d<=30?2:3]+=o}));return b}

// ---------- payables tab ----------
function rowH(r){const s=r.s||{},sub=[s.phone,s.town,r.open.length?r.open.length+' unpaid':'' ].filter(Boolean).map(esc).join(' · ');
  return '<button class="item" onclick="'+A('view',r.k)+'"><span class="nm"><b>'+esc(r.name)+(r.off?' (disabled)':'')+'</b><small>'+sub+'</small>'+(r.over>0?'<small class="low">Overdue: UGX '+fm(r.over)+'</small>':r.week>0?'<small>Due this week: UGX '+fm(r.week)+'</small>':'')+'</span><span class="pr '+(r.bal>0?'low':'ok')+'">'+fm(r.bal)+'</span></button>'}
function rows(q){q=key(q);const L=list().filter(r=>!q||key(r.name).includes(q)||key([r.s&&r.s.phone,r.s&&r.s.wa,r.s&&r.s.cat,r.s&&r.s.person,r.prods.join(' ')].join(' ')).includes(q)||(q.replace(/\s/g,'')&&String((r.s&&r.s.phone)||'').replace(/\s/g,'').includes(q.replace(/\s/g,''))));
  L.sort((a,b)=>(b.over>0)-(a.over>0)||b.bal-a.bal||a.name.localeCompare(b.name));return L.map(rowH).join('')||'<div class="empty">No supplier found</div>'}
function tab(seg){migrate();const L=list(),o=L.filter(r=>r.bal>0),ag=ageing(o),top=o.slice().sort((a,b)=>b.bal-a.bal)[0];
  return seg+'<div class="stat wide"><small>Total owed to '+o.length+' supplier'+(o.length==1?'':'s')+'</small><span class="num">UGX '+fm(sum(o,r=>r.bal))+'</span></div>'
   +(top?'<small>Owed the most: <b>'+esc(top.name)+'</b> · UGX '+fm(top.bal)+'</small>':'')
   +(sum(o,r=>r.over)>0?'<div class="stat wide"><small>Overdue</small><span class="num low">UGX '+fm(sum(o,r=>r.over))+'</span></div>':'')
   +'<div class="stat wide"><small>Due in the next 7 days</small><span class="num">UGX '+fm(sum(o,r=>r.week))+'</span></div>'
   +'<small>Ageing · not due '+fm(ag[0])+' · 1-7 days '+fm(ag[1])+' · 8-30 days '+fm(ag[2])+' · 30+ days '+fm(ag[3])+'</small>'
   +'<button class="btn big" onclick="okpSp.spForm()" style="margin:10px 0">+ New supplier</button>'
   +'<input id="sqs" type="search" placeholder="Search name, phone or product supplied" value="'+esc(st.sq||'')+'" oninput="okpSp.search(this.value)"><div id="sqlist">'+rows(st.sq||'')+'</div>'
   +'<h3>Reports</h3><label>Month</label><input type="month" value="'+esc(mon())+'" onchange="okpSp.setMon(this.value)"><div class="seg np"><button onclick="X.supReport(1)">📄 Share payables PDF</button><button onclick="X.supReport(0)">⬇ Download PDF</button></div><div id="smon">'+monRows()+'</div>'+'<small>To buy on credit: Money → Purchases → "On credit" and enter what you paid now.</small>'}
function search(v){st.sq=v;const e=$('#sqlist');if(e)e.innerHTML=rows(v)}

// ---------- statement ----------
function entries(n){const e=[];purs(n).forEach(u=>{e.push({d:u.date,o:0,l:'Stock arrived'+(u.inv?' · invoice '+u.inv:'')+' · '+u.n,a:u.q*u.c});
  (u.pays||[]).forEach(p=>e.push({d:p.d,o:1,l:'Payment'+(p.m?' · '+p.m:'')+(p.ref?' · '+p.ref:''),a:-p.a}));(u.cn||[]).forEach(c=>e.push({d:c.d,o:1,l:'Return / credit note',a:-c.a}))});
  e.sort((a,b)=>a.d<b.d?-1:a.d>b.d?1:a.o-b.o);let r=0;e.forEach(x=>{r+=x.a;x.r=r});return e}
function stmtText(r){const e=entries(r.name).slice(-20),s=r.s||{};
  return [db.shop.name,'SUPPLIER STATEMENT · '+r.name,'Date: '+td(),'-'.repeat(30),...e.map(x=>x.d+'  '+x.l+'\n   '+(x.a<0?'-':'')+fm(Math.abs(x.a))+'  (balance '+fm(x.r)+')'),'-'.repeat(30),'BALANCE WE OWE: UGX '+fm(r.bal),s.terms?'Terms: '+s.terms:'',db.shop.tel?'Tel: '+db.shop.tel:''].filter(Boolean).join('\n')}
function wa(r,text){const s=r.s||{};window.open('https://wa.me/'+waNum(s.wa||s.phone)+'?text='+encodeURIComponent(text),'_blank')}
const stmt=k=>{const r=one(k);if(r)wa(r,stmtText(r))};

// ---------- supplier account ----------
function view(k,all){const r=one(k);if(!r)return modal();const s=r.s||{},e=entries(r.name),sh=all?e:e.slice(-10),q=A('view',r.k).slice(0,-1);
  const addr=[s.street,s.town,s.district].filter(Boolean).join(', ');
  modal('<h2>'+esc(r.name)+'</h2>'+(s.person?'<small>Contact: '+esc(s.person)+'</small><br>':'')+(addr?'<small>📍 '+esc(addr)+'</small><br>':'<small>No address saved</small><br>')+(s.cat?'<small>Supplies: '+esc(s.cat)+'</small><br>':'')+'<small>Terms: '+esc(s.terms||'Cash on delivery')+'</small>'
   +'<div class="seg">'+(s.phone?'<a class="btn" href="tel:'+esc(s.phone)+'">📞 Call</a>':'')+((s.wa||s.phone)?'<button onclick="'+A('wa',r.k)+'">💬 WhatsApp</button>':'')+(addr?'<button onclick="'+A('maps',r.k)+'">🗺 Maps</button>':'')+'</div>'
   +'<div class="stat wide"><small>Balance owed</small><span class="num">UGX '+fm(r.bal)+'</span></div>'+(r.over>0?'<div class="stat wide"><small>Overdue</small><span class="num low">UGX '+fm(r.over)+'</span></div>':'')
   +(r.bal>0?'<button class="btn big" onclick="'+A('pay',r.k)+'">💰 Pay supplier</button>':'')+'<button class="btn" onclick="'+A('ret',r.k)+'">↩️ Return goods / credit note</button><button class="btn" onclick="'+A('stmt',r.k)+'">💬 Share statement on WhatsApp</button><div class="seg np"><button onclick="X.supStmt(decodeURIComponent(\''+enc(r.k)+'\'),1)">📄 Statement PDF</button><button onclick="X.supStmt(decodeURIComponent(\''+enc(r.k)+'\'),0)">⬇ Download PDF</button></div><button class="btn" onclick="'+A('spForm',r.k)+'">✏️ Edit supplier</button>'
   +(r.open.length?'<h3>Unpaid purchases</h3>'+r.open.map(u=>'<button class="item" onclick="modal();uform('+u.id+')"><span class="nm"><b>'+esc(u.n)+(u.inv?' · inv '+esc(u.inv):'')+'</b><small>'+fdt(u.date)+' · due '+fdt(dueOf(u))+'</small>'+(dueOf(u)<td()?'<small class="low">Overdue</small>':'')+'</span><span class="pr low">'+fm(sowed(u))+'</span></button>').join(''):'')
   +(srs().some(z=>key(z.sup)==r.k)?'<h3>Returns</h3>'+srs().filter(z=>key(z.sup)==r.k).slice().reverse().map(z=>'<button class="item" onclick="okpSp.rdel('+z.id+')"><span class="nm"><b>'+esc(z.n)+' ×'+z.q+'</b><small>'+fdt(z.date)+(z.note?' · '+esc(z.note):'')+' · tap to undo</small></span><span class="pr ok">'+fm(z.amt)+'</span></button>').join(''):'')+'<h3>Statement</h3>'+(sh.slice().reverse().map(x=>'<div class="item" style="cursor:default"><span class="nm"><b>'+esc(x.l)+'</b><small>'+fdt(x.d)+'</small></span><span class="pr '+(x.a<0?'ok':'low')+'">'+(x.a<0?'−':'')+fm(Math.abs(x.a))+'<br><small>bal '+fm(x.r)+'</small></span></div>').join('')||'<div class="empty">No credit history yet</div>')
   +(!all&&e.length>10?'<button class="btn" onclick="'+q+',1)">Show full statement ('+e.length+' lines)</button>':'')+'<button class="btn" onclick="modal()">Close</button>')}
const maps=k=>{const s=(one(k)||{}).s||{};window.open('https://www.google.com/maps/search/?api=1&query='+encodeURIComponent([s.street,s.town,s.district,'Uganda'].filter(Boolean).join(', ')),'_blank')};
const waK=k=>{const r=one(k);if(r)wa(r,'Hello '+r.name+', ')};

// ---------- supplier record ----------
function spForm(k){const r=k?one(k):null,s=(r&&r.s)||{},can=r&&r.s&&r.n==0&&r.bal==0&&!srs().some(z=>key(z.sup)==r.k);
  form(r?'Edit supplier':'New supplier',[['name','Business name','text'],['person','Contact person','text'],['phone','Phone number','tel'],['wa','WhatsApp number','tel'],['email','Email','email'],['town','Town / area','text'],['street','Street or landmark','text'],['district','District','text'],['cat','What they supply (category)','text'],['terms','Payment terms','select',TERMS],['note','Note (optional)','text']],
  {name:r?r.name:'',person:s.person||'',phone:s.phone||'',wa:s.wa||'',email:s.email||'',town:s.town||'',street:s.street||'',district:s.district||'',cat:s.cat||'',terms:s.terms||TERMS[0],note:s.note||''},v=>{
    if(!v.name)return alert('Enter the supplier business name.'),false;const nk=key(v.name);
    if((!r||nk!=r.k)&&list().some(x=>x.k==nk))return alert('A supplier with this name already exists.'),false;
    let rec=r&&r.s;if(!rec){rec={id:id()};sps().push(rec)}const old=r?r.name:null;Object.assign(rec,v);
    if(old&&old!==v.name){db.U.forEach(u=>{if(key(u.sup)==key(old))u.sup=v.name});srs().forEach(z=>{if(key(z.sup)==key(old))z.sup=v.name})}
    if(r)setTimeout(()=>view(nk),40)},can?(()=>{db.SP=sps().filter(x=>x.id!=r.s.id)}):null);
  if(r&&!can)setTimeout(()=>{const b=document.createElement('button');b.className='btn';b.textContent=(r.off?'Enable supplier':'Disable supplier')+' (cannot delete: purchases or money owed)';b.onclick=()=>{if(!r.s){r.s={id:id(),name:r.name,terms:TERMS[0]};sps().push(r.s)}r.s.off=!r.off;save();modal();render()};const m=$('#md');if(m)m.querySelector('#fs').after(b)},50)}

// ---------- pay supplier (oldest unpaid purchase first) ----------
function pay(k){const r=one(k);if(!r)return;
  form('Pay '+esc(r.name)+' (owed '+fm(r.bal)+')',[['d','Date paid','date'],['a','Amount paid (UGX)','number'],['m','Paid by','select',['Cash','Mobile Money']],['ref','Reference (e.g. MoMo transaction ID)','text'],['f','Mobile Money / transfer charge (UGX), if any','number']],{d:td(),a:r.bal,m:'Cash',ref:'',f:0},v=>{
    if(!(v.a>0))return alert('Enter the amount paid.'),false;if(v.a>r.bal)return alert('That is more than the UGX '+fm(r.bal)+' owed.'),false;
    let left=v.a,fee=v.f;r.open.forEach(u=>{if(left<=0)return;const x=Math.min(left,sowed(u));if(x>0){(u.pays=u.pays||[]).push({d:v.d||td(),a:x,f:fee,m:v.m,ref:v.ref});fee=0;left-=x}});
    setTimeout(()=>advice(k,v),40)})}
function adviceText(r,v){const nb=one(r.k).bal;return [db.shop.name,'PAYMENT RECEIPT / ADVICE','-'.repeat(30),'To: '+r.name,'Date: '+v.d,'Amount paid: UGX '+fm(v.a),'Paid by: '+v.m,v.ref?'Reference: '+v.ref:'','Balance still owed: UGX '+fm(nb),db.shop.tel?'Tel: '+db.shop.tel:'','Thank you.'].filter(Boolean).join('\n')}
function advice(k,v){const r=one(k);if(!r)return;const t=adviceText(r,v);
  modal('<h2>Payment saved ✓</h2><div id="rc"><pre style="white-space:pre-wrap;font:inherit">'+esc(t)+'</pre></div><button class="btn big" id="spw">💬 Send advice on WhatsApp</button><button class="btn" onclick="window.print()">🖨 Print</button><button class="btn" onclick="modal()">Close</button>');
  $('#spw').onclick=()=>wa(r,t)}

// ---------- supplier return / credit note ----------
function ret(k){const r=one(k);if(!r)return;if(!r.prods.length)return alert('No purchases from this supplier yet.');
  form('Return goods to '+esc(r.name),[['date','Date','date'],['n','Product','select',r.prods],['q','Quantity returned','number'],['amt','Credit note value (UGX)','number'],['note','Reason (e.g. damaged)','text']],{date:td(),n:r.prods[0],q:'',amt:'',note:''},v=>{
    if(!(v.q>0&&v.amt>0))return alert('Enter the quantity and the credit note value.'),false;if(v.amt>r.bal)return alert('The credit note cannot be more than the UGX '+fm(r.bal)+' owed. Use a smaller value.'),false;
    const z={id:id(),date:v.date||td(),sup:r.name,n:v.n,q:v.q,amt:v.amt,note:v.note};let left=v.amt;
    r.open.forEach(u=>{if(left<=0)return;const x=Math.min(left,sowed(u));if(x>0){(u.cn=u.cn||[]).push({d:z.date,a:x,rid:z.id});left-=x}});srs().push(z);setTimeout(()=>view(r.k),40)})}

// ---------- stock arriving helpers ----------
function attach(){const f=$('#f_sup');if(!f)return;f.setAttribute('list','spl');f.insertAdjacentHTML('afterend','<datalist id="spl">'+sps().filter(s=>!s.off).map(s=>'<option value="'+esc(s.name)+'">').join('')+'</datalist>');
  const c=$('#f_c');if(c)c.insertAdjacentHTML('afterend','<small id="sph"></small>');const up=()=>{const h=$('#sph'),n=$('#f_n');if(!h||!n)return;const L=db.U.filter(u=>key(u.sup)==key(f.value)&&u.n==n.value).sort(byOld).slice(-3);
    h.textContent=L.length?'Paid before: '+L.map(u=>fm(u.c)+' ('+fdt(u.date)+')').join(' → ')+(L.length>1?(L[L.length-1].c>L[0].c?' ↑ going up':L[L.length-1].c<L[0].c?' ↓ going down':' steady'):''):''};
  f.addEventListener('input',up);const n=$('#f_n');if(n)n.addEventListener('change',up);up()}
function homeWarn(){migrate();const o=list().filter(r=>r.bal>0),ov=sum(o,r=>r.over),wk=sum(o,r=>r.week);if(!(ov>0||wk>0))return '';
  return '<button class="item" onclick="nav(\'money\',\'sup\')"><span class="nm"><b>🤝 Supplier payments</b>'+(ov>0?'<small class="low">Overdue: UGX '+fm(ov)+'</small>':'')+(wk>0?'<small>Due this week: UGX '+fm(wk)+'</small>':'')+'</span><span class="pr low">'+fm(ov+wk)+'</span></button>'}

// ---------- reports ----------
const mon=()=>st.mon||td().slice(0,7);
function monthly(m){return list().map(r=>{const us=db.U.filter(u=>key(u.sup)==r.k);
  return {name:r.name,bought:sum(us.filter(u=>u.date.startsWith(m)),u=>u.q*u.c),
   paid:sum(us,u=>(u.cr?0:(u.date.startsWith(m)?u.q*u.c:0))+sum((u.pays||[]).filter(p=>String(p.d).startsWith(m)),p=>p.a)),
   ret:sum(srs().filter(z=>key(z.sup)==r.k&&z.date.startsWith(m)),z=>z.amt),bal:r.bal}}).filter(x=>x.bought||x.paid||x.ret).sort((a,b)=>b.bought-a.bought)}
function ageRows(){return list().filter(r=>r.bal>0).map(r=>({name:r.name,a:ageing([r]),bal:r.bal})).sort((x,y)=>y.bal-x.bal)}
function setMon(v){st.mon=v||mon();const e=$('#smon');if(e)e.innerHTML=monRows()}
function monRows(){const L=monthly(mon());return L.length?L.map(x=>'<div class="item" style="cursor:default"><span class="nm"><b>'+esc(x.name)+'</b><small>bought '+fm(x.bought)+' · paid '+fm(x.paid)+(x.ret?' · returned '+fm(x.ret):'')+'</small></span><span class="pr '+(x.bal>0?'low':'ok')+'">'+fm(x.bal)+'</span></div>').join(''):'<div class="empty">No supplier activity this month</div>'}
// Extra Excel sheets: [sheet name, title, rows]. ser turns a date into the Excel date the other sheets use.
function xl(ser){const L=list(),t=td(),S=d=>d?ser(d):'',P=[];
  const cr=db.U.filter(u=>u.cr).slice().sort(byOld);
  cr.forEach(u=>(u.pays||[]).forEach(p=>P.push([S(p.d),u.sup||'',u.n,p.a,p.m||'Cash',p.ref||'',p.f||0])));
  const ms=[...new Set([...db.U.map(u=>u.date),...db.U.flatMap(u=>(u.pays||[]).map(p=>p.d)),...srs().map(z=>z.date)].filter(Boolean).map(d=>String(d).slice(0,7)))].sort(),M=[];
  ms.forEach(m=>monthly(m).forEach(x=>M.push([m,x.name,x.bought,x.paid,x.ret])));
  return [
  ['Suppliers','Suppliers and Contacts',[['Business Name','Contact Person','Phone','WhatsApp','Email','Town / Area','Street / Landmark','District','Supplies','Payment Terms','Note','Disabled','Balance Owed (UGX)','Overdue (UGX)'],...L.map(r=>{const s=r.s||{};return[r.name,s.person||'',s.phone||'',s.wa||'',s.email||'',s.town||'',s.street||'',s.district||'',s.cat||'',s.terms||'',s.note||'',r.off?'Yes':'No',r.bal,r.over]})]],
  ['Supplier Payables','Supplier Invoices and Balances',[['Date','Supplier','Invoice No.','Product','Invoice Total (UGX)','Paid (UGX)','Credit Notes (UGX)','Owed (UGX)','Due Date','Days Overdue'],...cr.map(u=>[S(u.date),u.sup||'',u.inv||'',u.n,u.q*u.c,sum(u.pays||[],p=>p.a),sum(u.cn||[],c=>c.a),sowed(u),S(dueOf(u)),sowed(u)>0?Math.max(0,Math.round((new Date(t)-new Date(dueOf(u)))/864e5)):0])]],
  ['Supplier Payments','Payments to Suppliers',[['Date','Supplier','Product','Amount (UGX)','Paid By','Reference','Charge (UGX)'],...P]],
  ['Supplier Returns','Supplier Returns and Credit Notes',[['Date','Supplier','Product','Quantity','Credit Note (UGX)','Reason'],...srs().map(z=>[S(z.date),z.sup,z.n,z.q,z.amt,z.note||''])]],
  ['Payables Ageing','Payables Ageing (days past due date)',[['Supplier','Not Due (UGX)','1-7 Days','8-30 Days','30+ Days','Total Owed (UGX)'],...ageRows().map(x=>[x.name,...x.a,x.bal])]],
  ['Supplier Monthly','Purchases and Payments per Supplier per Month',[['Month','Supplier','Bought (UGX)','Paid (UGX)','Returned (UGX)'],...M]]];}
function rdel(i){const z=srs().find(x=>x.id==i);if(!z)return;askc('Undo this return? The goods go back into stock and the balance owed goes back up.',()=>{db.U.forEach(u=>{if(u.cn)u.cn=u.cn.filter(c=>c.rid!=i)});db.SR=srs().filter(x=>x.id!=i);save();render();setTimeout(()=>view(key(z.sup)),40)})}

window.okpSp={tab,view,pay,ret,spForm,search,stmt,wa:waK,maps,ensure,attach,homeWarn,list,ageing,entries,migrate,monthly,ageRows,xl,rdel,setMon,mon};
})();
