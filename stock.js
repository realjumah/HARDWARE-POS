/* Okpotani stock control: low-stock alerts, reorder list, stock take and stock adjustments.
 *
 * How it fits the app (read before changing):
 *  - Stock is still CALCULATED by stk() in index.html: opening stock + purchases - sales + returns + ADJUSTMENTS.
 *    Adjustments live in db.AD (one record each). A reversed adjustment has a.rev and is ignored by stk().
 *  - db.AD  = stock adjustments  {id,date,time,n:product name,q:+/- quantity,r:reason,c:unit cost,bf:stock before,by,ap,tid,note,rev}
 *  - db.ST  = stock takes        {id,no,date,time,scope,cat,by,st:'draft'|'posted'|'reversed',note,lines:[{n,k,u,c,sys,cnt,r,at}],sum,pd,pt,ap}
 *    Both arrays are listed in COLS in cloud.js, so they sync like every other record.
 *  - A stock take line remembers the system quantity AT THE MOMENT it was counted (sys). The adjustment posted is
 *    counted - sys, so sales made while you are still counting never create a false shortage or surplus.
 *  - Drafts are saved after every count (save()), so closing the app never loses a count.
 */
(function(){
  'use strict';
  const KP='okp_stk_pref',KR='okp_stk_ro',KS='okp_stk_seen',KB='okp_stk_by',KN='okp_stk_note';
  const RS_OUT=['Damaged','Lost','Used by shop','Other'],RS_IN=['Found','Other'];
  const RS_SHORT=['Counted','Damaged','Lost','Used by shop','Other'],RS_GAIN=['Counted','Found','Other'];
  const rnd=x=>Math.round((+x||0)*1e4)/1e4;
  const qf=x=>rnd(x).toLocaleString('en-US',{maximumFractionDigits:4});
  const sg=x=>(x>0?'+':x<0?'-':'')+qf(Math.abs(x));
  const mf=x=>(x<0?'-':'')+fm(Math.abs(x));
  const svc=p=>typeof isSvc=='function'&&isSvc(p);
  const hm=()=>new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  const jget=(k,d,s)=>{try{const v=(s||localStorage).getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}};
  const jset=(k,v,s)=>{try{(s||localStorage).setItem(k,JSON.stringify(v))}catch(e){}};
  const ads=()=>(db.AD=db.AD||[]),sts=()=>(db.ST=db.ST||[]);
  const pref=()=>({banner:true,notify:false,...jget(KP,{})});
  const setPref=o=>jset(KP,{...pref(),...o});
  const O={v:'low',lf:'all',sup:'__all',tid:null,cq:'',cf:'todo',ap:null,apq:'',dir:'out',more:30,ro:null,open:null};

  /* ---------- low stock ---------- */
  function lastBuy(name){let b=null;db.U.forEach(u=>{if(u.n==name&&(!b||(u.date||'')>=(b.date||'')))b=u});return b}
  function lowList(m){
    m=m||stk();const L=[];
    db.P.forEach(p=>{if(svc(p))return;const s=rnd(m[p.name]||0),re=+p.re||0;
      if(s<=re){const b=lastBuy(p.name);L.push({p,s,re,out:s<=0,sup:b?((b.sup||'').trim()):'',lb:b})}});
    const key=x=>x.out?(x.s<0?-1:0):1;
    L.sort((a,b)=>key(a)-key(b)||(a.re>0?a.s/a.re:0)-(b.re>0?b.s/b.re:0)||a.p.name.localeCompare(b.p.name));
    return L;
  }
  function counts(m){const L=lowList(m);return{n:L.length,out:L.filter(x=>x.out).length,L}}
  function badge(p,s){
    if(svc(p))return '';s=rnd(s);
    if(s<0)return '<span class="bdg bad">CHECK</span>';
    if(s==0)return '<span class="bdg bad">OUT</span>';
    if(s<=(+p.re||0))return '<span class="bdg warn">LOW</span>';
    return '';
  }
  function homeCard(){
    const c=counts();
    if(!c.n)return '<div class="cards"><div role="button" tabindex="0" class="stat wide sk-card sk-ok" onclick="okpStk.open(\'low\')"><small>Stock levels</small><span class="num">All stock above reorder level</span></div></div>';
    return '<div class="cards"><div role="button" tabindex="0" class="stat wide sk-card '+(c.out?'sk-bad':'sk-warn')+'" onclick="okpStk.open(\'low\')"><small>Low stock · tap to see the list</small><span class="num">'+c.n+' at or below reorder level</span><small>'+(c.out?c.out+' out of stock':'None out of stock')+'</small></div></div>';
  }

  /* ---------- helpers for screens ---------- */
  const whoDef=()=>{try{return localStorage.getItem(KB)||db.lastSb||''}catch(e){return db.lastSb||''}};
  const rem=v=>{try{if(v)localStorage.setItem(KB,v)}catch(e){}};
  function whoH(idn,lab){const L=db.staff||[],d=whoDef();
    return '<label>'+lab+'</label>'+(L.length?'<select id="'+idn+'"><option value="">(not recorded)</option>'+L.map(n=>'<option'+(n==d?' selected':'')+'>'+esc(n)+'</option>').join('')+'</select>':'<input id="'+idn+'" placeholder="Name" value="'+esc(d)+'">');
  }
  const val=i=>{const e=document.getElementById(i);return e?String(e.value||'').trim():''};
  const js=v=>JSON.stringify(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  const pByName=n=>db.P.find(p=>p.name==n);
  const unitOf=n=>{const p=pByName(n);return p?(p.unit||''):''};
  const optH=(a,sel)=>a.map(x=>'<option'+(x==sel?' selected':'')+'>'+esc(x)+'</option>').join('');
  function segH(){
    const T=[['low','Low stock'],['ro','Reorder list'],['take','Stock take'],['adj','Adjust stock'],['hist','History']];
    const act=O.v=='count'||O.v=='review'?'take':O.v=='detail'?'hist':O.v;
    return '<div class="seg tabs">'+T.map(([k,l])=>'<button class="'+(act==k?'on':'')+'" onclick="okpStk.go(\''+k+'\')">'+l+'</button>').join('')+'</div>';
  }

  /* ---------- LOW STOCK screen ---------- */
  function lowView(){
    const c=counts(),L=O.lf=='out'?c.L.filter(x=>x.out):c.L,pf=pref();
    const cards='<div class="cards"><div class="stat sk-card '+(c.n?'sk-warn':'sk-ok')+'"><small>At or below reorder level</small><span class="num">'+c.n+'</span></div><div class="stat sk-card '+(c.out?'sk-bad':'sk-ok')+'"><small>Out of stock</small><span class="num">'+c.out+'</span></div></div>';
    const f='<div class="seg"><button class="'+(O.lf=='all'?'on':'')+'" onclick="okpStk.lf(\'all\')">All low ('+c.n+')</button><button class="'+(O.lf=='out'?'on':'')+'" onclick="okpStk.lf(\'out\')">Out of stock ('+c.out+')</button></div>';
    const rows=L.map(x=>{const p=x.p,lb=x.lb;
      return '<button class="item sk-item '+(x.out?'sk-bad':'sk-warn')+'" onclick="okpStk.prod('+p.id+')"><span class="nm"><b>'+esc(p.name)+'</b><small>Reorder at '+qf(x.re)+' '+esc(p.unit||'')+(p.cat?' · '+esc(p.cat):'')+'</small><small>'+(lb?'Last bought from <b>'+esc(x.sup||'(no name)')+'</b> · '+fdt(lb.date)+' · UGX '+fm(lb.c)+' each':'Not bought yet (no supplier recorded)')+'</small></span><span class="pr">'+qf(x.s)+' '+esc(p.unit||'')+'<br>'+badge(p,x.s)+'</span></button>'}).join('');
    return segH()+cards+(c.n?'<button class="btn big" onclick="okpStk.go(\'ro\')">Make reorder list</button>':'')+f+(rows||'<div class="empty">'+(c.n?'Nothing out of stock.':'All stock levels are above their reorder level.')+'</div>')+
      '<h3>Alerts on this phone</h3>'+
      '<button class="item row" onclick="okpStk.togBanner()"><span class="nm"><b>Banner when I open the app</b><small>Shows which items are low or newly low</small></span><span class="pr '+(pf.banner?'in':'')+'">'+(pf.banner?'ON':'OFF')+'</span></button>'+
      '<button class="item row" onclick="okpStk.togNote()"><span class="nm"><b>Phone notification</b><small>'+noteInfo()+'</small></span><span class="pr '+(noteOn()?'in':'')+'">'+(noteOn()?'ON':'OFF')+'</span></button>'+
      '<small>The notification is sent when you open the app (once a day). A phone cannot wake the app by itself while it is closed, unless a notification server is added later.</small>';
  }
  const noteSupported=()=>typeof Notification!=='undefined';
  const noteOn=()=>noteSupported()&&Notification.permission==='granted'&&pref().notify;
  function noteInfo(){
    if(!noteSupported())return 'Not supported on this browser';
    if(Notification.permission==='denied')return 'Blocked. Allow notifications for this app in the phone settings';
    return 'Tap to turn on or off';
  }
  function togBanner(){setPref({banner:!pref().banner});render()}
  async function togNote(){
    if(!noteSupported())return alert('This browser cannot show notifications. The banner on opening the app still works.');
    if(Notification.permission==='denied')return alert('Notifications are blocked for this app. Open the phone Settings, find this app or website, and allow notifications.');
    if(noteOn()){setPref({notify:false});toast('Phone notification off');render();return}
    let perm=Notification.permission;
    if(perm!=='granted'){try{perm=await Notification.requestPermission()}catch(e){}}
    if(perm==='granted'){setPref({notify:true});toast('Phone notification on');showNote(counts(),true)}else toast('Notification not allowed');
    render();
  }
  function showNote(c,test){
    if(!noteSupported()||Notification.permission!=='granted')return;
    const title=test?'Low-stock alerts are on':c.n+' item'+(c.n>1?'s':'')+' low'+(c.out?' · '+c.out+' out of stock':'');
    const body=test?'You will be told when items are low.':c.L.slice(0,4).map(x=>x.p.name+' ('+qf(x.s)+' '+(x.p.unit||'')+')').join(', ')+(c.n>4?' and '+(c.n-4)+' more':'');
    const o={body,icon:'./icon-192.png',badge:'./icon-192.png',tag:'okp-low-stock',data:{to:'low'}};
    try{
      if(navigator.serviceWorker&&navigator.serviceWorker.ready)navigator.serviceWorker.ready.then(r=>r.showNotification(title,o)).catch(()=>{try{new Notification(title,o)}catch(e){}});
      else new Notification(title,o);
    }catch(e){}
  }
  function prod(i){
    const p=db.P.find(x=>x.id==i);if(!p)return;const m=stk(),s=rnd(m[p.name]||0);
    modal('<h2>'+esc(p.name)+'</h2><div class="item" style="cursor:default"><span class="nm"><b>In stock now</b><small>Reorder level '+qf(p.re||0)+' '+esc(p.unit||'')+'</small></span><span class="pr">'+qf(s)+' '+esc(p.unit||'')+'<br>'+badge(p,s)+'</span></div>'+
      '<button class="btn big" onclick="okpStk.addRo('+p.id+')">Add to reorder list</button>'+
      '<button class="btn" onclick="modal();uform()">Record stock arriving</button>'+
      '<button class="btn" onclick="okpStk.adjFor('+p.id+')">Adjust stock (damaged, lost…)</button>'+
      '<button class="btn" onclick="sc('+p.id+')">View stock history</button>'+
      '<button class="btn" onclick="modal()">Close</button>');
  }

  /* ---------- REORDER LIST ---------- */
  function roState(){if(!O.ro)O.ro=jget(KR,{});return O.ro}
  function roSave(){jset(KR,O.ro||{})}
  function suggest(x){return Math.max(1,Math.ceil(2*x.re-x.s))}
  function roRows(all){
    const S=roState(),c=counts();
    return c.L.map(x=>{const e=S[x.p.name]||{};return{n:x.p.name,unit:x.p.unit||'',stock:x.s,re:x.re,sup:x.sup,out:x.out,on:!!e.on,qty:e.q!=null?+e.q:suggest(x)}}).filter(r=>all||(r.on&&r.qty>0));
  }
  function supOpts(){
    const set=new Set();counts().L.forEach(x=>set.add(x.sup||''));
    return [...set].sort((a,b)=>(a||'~').localeCompare(b||'~'));
  }
  function roVisible(){const rows=roRows(true);return O.sup=='__all'?rows:rows.filter(r=>r.sup===O.sup)}
  function roSend(){const v=roVisible().filter(r=>r.on&&r.qty>0);return v}
  function roList(){
    const R=roVisible();
    if(!R.length)return '<div class="empty">'+(counts().n?'No items for this supplier.':'Nothing to reorder. All stock is above the reorder level.')+'</div>';
    return R.map(r=>'<div class="item sk-ro" style="cursor:default"><button class="tk'+(r.on?' on':'')+'" aria-pressed="'+r.on+'" aria-label="Tick '+esc(r.n)+'" onclick="okpStk.tick('+js(r.n)+')">'+(r.on?'✓':'')+'</button><span class="nm"><b>'+esc(r.n)+'</b><small>In stock '+qf(r.stock)+' · reorder at '+qf(r.re)+' '+esc(r.unit)+'</small><small>'+(r.sup?esc(r.sup):'No supplier recorded')+'</small></span><span class="sk-q"><input type="number" inputmode="decimal" step="any" min="0" value="'+r.qty+'" aria-label="Quantity to order" onchange="okpStk.roq('+js(r.n)+',this.value)"><small>'+esc(r.unit)+'</small></span></div>').join('');
  }
  function roSum(){const n=roSend().length;return n?n+' item'+(n>1?'s':'')+' ticked':'Tick the items you want to order'}
  function roView(){
    const S=supOpts(),sel=O.sup;
    const so='<option value="__all"'+(sel=='__all'?' selected':'')+'>All suppliers (grouped)</option>'+S.map(s=>'<option value="'+esc(s)+'"'+(sel===s?' selected':'')+'>'+esc(s||'No supplier recorded')+'</option>').join('');
    return segH()+'<small>Items at or below their reorder level. Tick what you want to order and check the quantities. The suggested quantity brings stock up to twice the reorder level.</small>'+
      '<label style="margin-top:10px">Send list for</label><select onchange="okpStk.supSel(this.value)">'+so+'</select>'+
      '<div class="seg"><button onclick="okpStk.tickAll(1)">Tick all</button><button onclick="okpStk.tickAll(2)">Out of stock</button><button onclick="okpStk.tickAll(0)">Clear ticks</button></div>'+
      '<div id="skl">'+roList()+'</div><div class="stat wide" style="margin:8px 0"><small id="sks">'+roSum()+'</small></div>'+
      '<button class="btn big" onclick="okpStk.roWa()">Send on WhatsApp</button>'+
      '<button class="btn" onclick="okpStk.roPdf(1)">Share as PDF</button>'+
      '<button class="btn" onclick="okpStk.roPdf(0)">Download PDF</button>'+
      '<button class="btn" onclick="okpStk.roCopy()">Copy text</button>'+
      '<button class="btn del" onclick="okpStk.roClear()">Clear list</button>';
  }
  function roPaint(){const e=document.getElementById('skl');if(e)e.innerHTML=roList();const s=document.getElementById('sks');if(s)s.textContent=roSum()}
  function tick(n){const S=roState(),e=S[n]||(S[n]={});e.on=!e.on;roSave();roPaint()}
  function roq(n,v){const S=roState(),e=S[n]||(S[n]={}),q=+v;e.q=isFinite(q)&&q>=0?q:0;if(e.q>0)e.on=true;roSave();roPaint()}
  function tickAll(mode){
    const S=roState();counts().L.forEach(x=>{const e=S[x.p.name]||(S[x.p.name]={});e.on=mode==1?true:mode==2?x.out:false});
    roSave();roPaint();
  }
  function supSel(v){O.sup=v;render()}
  function addRo(i){const p=db.P.find(x=>x.id==i);if(!p)return;const S=roState(),e=S[p.name]||(S[p.name]={});e.on=true;roSave();modal();O.v='ro';O.sup='__all';st.tab='sa';render();toast('Added to the reorder list')}
  function roText(rows){
    const g={};rows.forEach(r=>{(g[r.sup||'']=g[r.sup||'']||[]).push(r)});
    const keys=Object.keys(g).sort((a,b)=>(a||'~').localeCompare(b||'~'));
    const L=['*REORDER LIST*','*'+(db.shop.name||'Shop')+'*'+(db.shop.tel?' · '+db.shop.tel:''),'Date: '+fdt(td()),''];
    const single=O.sup!='__all'&&keys.length==1;
    keys.forEach(k=>{
      if(!single||k)L.push('*'+(k?'Supplier: '+k:'Supplier not recorded')+'*');
      g[k].forEach((r,i)=>L.push((i+1)+'. '+r.n+' - '+qf(r.qty)+' '+r.unit));
      L.push('');
    });
    L.push('Please confirm availability and price. Thank you.');
    return L.join('\n');
  }
  function roGuard(){const r=roSend();if(!r.length){alert('Tick at least one item with a quantity first.');return null}return r}
  function roWa(){const r=roGuard();if(!r)return;window.open('https://wa.me/?text='+encodeURIComponent(roText(r)),'_blank')}
  function roCopy(){const r=roGuard();if(!r)return;const x=roText(r);
    (navigator.clipboard?navigator.clipboard.writeText(x):Promise.reject()).then(()=>toast('List copied ✓')).catch(()=>{prompt('Copy this text:',x)})}
  function roPdf(share){const r=roGuard();if(!r)return;if(!window.X||!X.reorderPdf)return alert('PDF is not available.');X.reorderPdf({rows:r,single:O.sup!='__all'},share)}
  function roClear(){askc('Clear all ticks and quantities on the reorder list?',()=>{O.ro={};roSave();render()})}

  /* ---------- STOCK TAKE: list and start ---------- */
  const takeById=i=>sts().find(t=>t.id==i);
  function tsum(t){
    let ns=0,ng=0,sh=0,su=0,cnt=0;
    t.lines.forEach(l=>{if(l.cnt==null)return;cnt++;const d=rnd(l.cnt-l.sys),v=Math.round(d*(+l.c||0));if(d<0){ns++;sh+=v}else if(d>0){ng++;su+=v}});
    return{counted:cnt,total:t.lines.length,ns,ng,diffs:ns+ng,short:sh,surp:su,net:sh+su};
  }
  const stLab=t=>t.st=='posted'?'Posted':t.st=='reversed'?'Reversed':'Draft';
  function takeView(){
    const drafts=sts().filter(t=>t.st=='draft').sort((a,b)=>(b.date+(b.time||''))<(a.date+(a.time||''))?-1:1);
    const cats=[...new Set(db.P.filter(p=>!svc(p)).map(p=>p.cat||'Other'))].sort((a,b)=>a.localeCompare(b));
    const n=c=>db.P.filter(p=>!svc(p)&&(c=='__all'||(p.cat||'Other')==c)).length;
    let h=segH();
    if(drafts.length){
      h+='<h3>Counts in progress</h3>'+drafts.map(t=>{const s=tsum(t);
        return '<button class="item sk-item sk-warn" onclick="okpStk.cont('+t.id+')"><span class="nm"><b>Stock take #'+t.no+' · '+esc(t.scope)+'</b><small>Started '+fdt(t.date,t.time)+(t.by?' · '+esc(t.by):'')+'</small><small>Counted '+s.counted+' of '+s.total+' products</small></span><span class="pr">Continue</span></button>'}).join('');
    }
    h+='<h3>Start a new stock take</h3><label>What will you count?</label><select id="sk_sc"><option value="__all">All products ('+n('__all')+')</option>'+cats.map(c=>'<option value="'+esc(c)+'">'+esc(c)+' ('+n(c)+')</option>').join('')+'</select>'+
      whoH('sk_by','Counted by')+'<label>Note (optional)</label><input id="sk_nt" placeholder="For example: end of month count">'+
      '<button class="btn big" onclick="okpStk.start()">Start stock take</button><small>Each product shows the quantity the system expects. You type what you really count on the shelf. Your count is saved as you go, so you can stop and continue later, even after closing the app.</small>';
    return h;
  }
  function start(){
    const scope=val('sk_sc')||'__all',by=val('sk_by'),note=val('sk_nt');
    const L=db.P.filter(p=>!svc(p)&&(scope=='__all'||(p.cat||'Other')==scope)).sort((a,b)=>(a.cat||'Other').localeCompare(b.cat||'Other')||a.name.localeCompare(b.name));
    if(!L.length)return alert('There are no products to count here.');
    if(!by&&(db.staff||[]).length)return alert('Choose who is counting.');
    rem(by);
    const no=Math.max(0,...sts().map(t=>+t.no||0))+1;
    const t={id:id(),no,date:td(),time:hm(),scope:scope=='__all'?'All products':scope,cat:scope=='__all'?'':scope,by,st:'draft',note,lines:L.map(p=>({n:p.name,k:p.cat||'Other',u:p.unit||'',c:costNow(p)}))};
    sts().push(t);save();O.tid=t.id;O.v='count';O.cq='';O.cf='todo';render();$('#mn').scrollTop=0;
  }
  function cont(i){O.tid=i;O.v='count';O.cq='';O.cf='todo';render();$('#mn').scrollTop=0}

  /* ---------- STOCK TAKE: counting ---------- */
  function rowH(t,i,m){
    const l=t.lines[i],done=l.cnt!=null,sys=done?l.sys:rnd(m[l.n]||0),d=done?rnd(l.cnt-sys):0;
    return '<div class="sk-row'+(done?' done':'')+'"><div class="nm"><b>'+esc(l.n)+'</b><small>'+esc(l.k||'')+' · System: <b>'+qf(sys)+' '+esc(l.u)+'</b></small></div><div class="sk-in"><input class="skq" type="number" inputmode="decimal" step="any" min="0" placeholder="Count" data-i="'+i+'" data-sys="'+sys+'" value="'+(done?l.cnt:'')+'" aria-label="Counted quantity for '+esc(l.n)+'" oninput="okpStk.cin(this)" onchange="okpStk.ccn(this)" onkeydown="okpStk.ckd(event,this)"><button class="skeq" aria-label="Same as system" onclick="okpStk.same('+i+')">=</button></div><span class="sk-df'+(d<0?' neg':d>0?' pos':'')+'" id="skd'+i+'">'+(done?(d==0?'OK':sg(d)):'')+'</span></div>';
  }
  function countList(t){
    const m=stk(),q=O.cq.toLowerCase();let n=0;
    const h=t.lines.map((l,i)=>({l,i})).filter(({l})=>{
      if(q&&!(l.n+' '+(l.k||'')).toLowerCase().includes(q))return false;
      if(O.cf=='todo')return l.cnt==null;
      if(O.cf=='diff')return l.cnt!=null&&rnd(l.cnt-l.sys)!=0;
      return true;
    }).slice(0,300).map(({i})=>{n++;return rowH(t,i,m)}).join('');
    return h||'<div class="empty">'+(O.cf=='todo'&&!q?'Every product is counted. Tap "Review differences".':'Nothing to show here.')+'</div>';
  }
  function countTop(t){const s=tsum(t);return '<div class="cards"><div class="stat"><small>Counted</small><span class="num" id="skc">'+s.counted+' / '+s.total+'</span></div><div class="stat"><small>Difference so far</small><span class="num '+(s.net<0?'low':s.net>0?'ok':'')+'" id="skn">UGX '+mf(s.net)+'</span></div></div>'}
  function countView(){
    const t=takeById(O.tid);if(!t){O.v='take';return takeView()}
    if(t.st!='draft'){return viewTakeHtml(t)}
    return '<div class="sk-head"><b>Stock take #'+t.no+' · '+esc(t.scope)+'</b><small>'+fdt(t.date,t.time)+(t.by?' · counted by '+esc(t.by):'')+'</small></div><div id="skt">'+countTop(t)+'</div>'+
      '<input type="search" placeholder="Search product…" value="'+esc(O.cq)+'" oninput="okpStk.cq(this.value)">'+
      '<div class="seg"><button class="'+(O.cf=='todo'?'on':'')+'" onclick="okpStk.cf(\'todo\')">Not counted</button><button class="'+(O.cf=='diff'?'on':'')+'" onclick="okpStk.cf(\'diff\')">Differences</button><button class="'+(O.cf=='all'?'on':'')+'" onclick="okpStk.cf(\'all\')">All</button></div>'+
      '<div id="skl">'+countList(t)+'</div>'+
      '<button class="btn big" onclick="okpStk.review()">Review differences</button>'+
      '<button class="btn" onclick="okpStk.go(\'take\')">Save and finish later</button>'+
      '<button class="btn del" onclick="okpStk.delDraft('+t.id+')">Delete this draft</button><small>Your count is saved on this phone after every entry.</small>';
  }
  function cPaint(){const t=takeById(O.tid);if(!t)return;const e=document.getElementById('skl');if(e)e.innerHTML=countList(t);cTop(t)}
  function cTop(t){const e=document.getElementById('skt');if(e)e.innerHTML=countTop(t)}
  function cq(v){O.cq=v;cPaint()}
  function cf(v){O.cf=v;render()}
  function chip(i,d,has){const e=document.getElementById('skd'+i);if(!e)return;e.textContent=!has?'':d==0?'OK':sg(d);e.className='sk-df'+(!has?'':d<0?' neg':d>0?' pos':'')}
  function cin(el){ // live: show the difference while typing (not saved yet)
    const i=+el.dataset.i,v=el.value.trim();if(v===''){chip(i,0,false);return}
    const n=+v;if(isFinite(n))chip(i,rnd(n-(+el.dataset.sys)),true);
  }
  function setCount(t,i,n){
    const l=t.lines[i];
    if(n==null){delete l.cnt;delete l.sys;delete l.at;delete l.r}
    else{l.cnt=rnd(n);l.sys=rnd(stk()[l.n]||0);l.at=new Date().toISOString();if(rnd(l.cnt-l.sys)==0)delete l.r}
    return l;
  }
  function ccn(el){
    const t=takeById(O.tid);if(!t||t.st!='draft')return;const i=+el.dataset.i,v=el.value.trim();
    if(v===''){setCount(t,i,null);chip(i,0,false);save();cTop(t);return}
    const n=+v;if(!isFinite(n)||n<0){toast('Enter a quantity of 0 or more');el.value='';setCount(t,i,null);chip(i,0,false);save();cTop(t);return}
    const l=setCount(t,i,n);el.dataset.sys=l.sys;chip(i,rnd(l.cnt-l.sys),true);save();cTop(t);
  }
  function same(i){
    const t=takeById(O.tid);if(!t||t.st!='draft')return;const sys=rnd(stk()[t.lines[i].n]||0);
    setCount(t,i,Math.max(0,sys));const el=document.querySelector('.skq[data-i="'+i+'"]');
    if(el){el.value=t.lines[i].cnt;el.dataset.sys=t.lines[i].sys}chip(i,rnd(t.lines[i].cnt-t.lines[i].sys),true);save();cTop(t);
  }
  function ckd(e,el){
    if(e.key!=='Enter')return;e.preventDefault();
    const all=[...document.querySelectorAll('.skq')],k=all.indexOf(el);ccn(el);
    const nx=all[k+1];if(nx)nx.focus();else el.blur();
  }
  function flush(){const a=document.activeElement;if(a&&a.classList&&a.classList.contains('skq'))ccn(a)}
  function delDraft(i){askc('Delete this draft stock take? Nothing in stock is changed.',()=>{db.ST=sts().filter(t=>t.id!=i);save();O.v='take';render()})}

  /* ---------- STOCK TAKE: review and approve ---------- */
  function diffs(t){return t.lines.map((l,i)=>({l,i})).filter(x=>x.l.cnt!=null&&rnd(x.l.cnt-x.l.sys)!=0)}
  function reviewView(){
    const t=takeById(O.tid);if(!t||t.st!='draft'){O.v='take';return takeView()}
    flush();const s=tsum(t),D=diffs(t),un=s.total-s.counted;
    const lines=D.map(({l,i})=>{const d=rnd(l.cnt-l.sys),v=Math.round(d*(+l.c||0));
      return '<div class="item sk-rv" style="cursor:default"><span class="nm"><b>'+esc(l.n)+'</b><small>System '+qf(l.sys)+' → counted '+qf(l.cnt)+' '+esc(l.u)+'</small><label style="margin:6px 0 2px">Reason</label><select onchange="okpStk.rsn('+i+',this.value)">'+optH(d<0?RS_SHORT:RS_GAIN,l.r||'Counted')+'</select></span><span class="pr '+(d<0?'out':'in')+'">'+sg(d)+' '+esc(l.u)+'<br><small>UGX '+mf(v)+'</small></span></div>'}).join('');
    return '<div class="sk-head"><b>Review · Stock take #'+t.no+'</b><small>'+esc(t.scope)+' · '+fdt(t.date,t.time)+'</small></div>'+
      '<div class="cards"><div class="stat sk-card sk-bad"><small>Shortage ('+s.ns+')</small><span class="num">UGX '+mf(s.short)+'</span></div><div class="stat sk-card sk-ok"><small>Surplus ('+s.ng+')</small><span class="num">UGX '+mf(s.surp)+'</span></div></div>'+
      '<div class="stat wide"><small>'+(s.net<0?'Total value LOST (at cost price)':s.net>0?'Total value GAINED (at cost price)':'No difference in value')+'</small><span class="num">UGX '+mf(s.net)+'</span></div>'+
      (un?'<p class="low" style="margin:10px 0 0">'+un+' product'+(un>1?'s were':' was')+' not counted. They will NOT be changed.</p>':'')+
      '<h3>Differences ('+D.length+')</h3>'+(lines||'<div class="empty">The shelf matches the system. No adjustments are needed.</div>')+
      whoH('sk_ap','Approved by')+
      '<button class="btn big" onclick="okpStk.post()">'+(D.length?'Approve and post '+D.length+' adjustment'+(D.length>1?'s':''):'Approve and close stock take')+'</button>'+
      '<button class="btn" onclick="okpStk.go(\'count\')">Back to counting</button>';
  }
  function review(){const t=takeById(O.tid);if(!t)return;flush();if(!tsum(t).counted)return alert('Count at least one product first.');O.v='review';render();$('#mn').scrollTop=0}
  function rsn(i,v){const t=takeById(O.tid);if(!t||t.st!='draft')return;t.lines[i].r=v;save()}
  function post(){
    const t=takeById(O.tid);if(!t||t.st!='draft')return;
    const D=diffs(t),ap=val('sk_ap');
    askc(D.length?'Post '+D.length+' stock adjustment'+(D.length>1?'s':'')+'? Stock will change to match your count. You can reverse a posted stock take later.':'Close this stock take with no changes?',()=>{
      if(t.st!='draft')return;
      const d=td(),tm=hm(),m=stk(),S=tsum(t);
      D.forEach(({l})=>{const q=rnd(l.cnt-l.sys);
        ads().push({id:id(),date:d,time:tm,n:l.n,q,r:l.r||'Counted',c:+l.c||0,bf:rnd(m[l.n]||0),by:t.by||'',ap,tid:t.id,note:'Stock take #'+t.no})});
      t.st='posted';t.pd=d;t.pt=tm;t.ap=ap;t.sum=S;rem(ap);
      save();O.tid=t.id;O.v='detail';render();$('#mn').scrollTop=0;toast('Stock take posted ✓');
    });
  }

  /* ---------- STOCK TAKE: detail, print, share ---------- */
  function viewTakeHtml(t){
    const s=t.st=='draft'?tsum(t):(t.sum||tsum(t)),D=diffs(t);
    const R=(a,b)=>'<tr><td>'+a+'</td><td>'+b+'</td></tr>';
    const rows=D.map(({l})=>{const d=rnd(l.cnt-l.sys);return '<tr><td style="text-align:left;white-space:normal">'+esc(l.n)+'</td><td>'+qf(l.sys)+'</td><td>'+qf(l.cnt)+'</td><td>'+sg(d)+'</td><td>'+mf(Math.round(d*(+l.c||0)))+'</td><td style="text-align:left">'+esc(l.r||'Counted')+'</td></tr>'}).join('');
    const rev=t.st=='reversed';
    return segH()+'<div id="rc"><div class="rcp" style="max-width:none">'+(typeof rch=='function'?rch('STOCK TAKE'):'<h2>Stock take</h2>')+
      '<table class="mt skt">'+R('Stock take','#'+t.no+' · '+esc(t.scope))+R('Started',fdt(t.date,t.time))+R('Counted by',esc(t.by||'(not recorded)'))+(t.st=='posted'||rev?R('Posted',fdt(t.pd,t.pt))+R('Approved by',esc(t.ap||'(not recorded)')):'')+R('Status',stLab(t)+(rev?' on '+fdt(t.rd):''))+(t.note?R('Note',esc(t.note)):'')+'</table><hr class="ds">'+
      '<table class="mt skt">'+R('Products counted',s.counted+' of '+s.total)+R('Shortages',s.ns+' · UGX '+mf(s.short))+R('Surpluses',s.ng+' · UGX '+mf(s.surp))+R('<b>'+(s.net<0?'VALUE LOST':s.net>0?'VALUE GAINED':'NET VALUE')+'</b>','<b>UGX '+mf(s.net)+'</b>')+'</table><hr class="ds">'+
      '<div class="tw"><table class="skt"><tr><th style="text-align:left">Product</th><th>System</th><th>Counted</th><th>Diff</th><th>Value</th><th style="text-align:left">Reason</th></tr>'+(rows||'<tr><td colspan="6" style="text-align:center">No differences</td></tr>')+'</table></div>'+
      '<small style="color:#444">Values are at cost price.</small></div></div>'+
      '<button class="btn big" onclick="print()">Print</button><button class="btn" onclick="okpStk.tPdf('+t.id+',1)">Share as PDF</button><button class="btn" onclick="okpStk.tPdf('+t.id+',0)">Download PDF</button><button class="btn" onclick="okpStk.tWa('+t.id+')">Share summary on WhatsApp</button>'+
      (t.st=='posted'?'<button class="btn del" onclick="okpStk.revTake('+t.id+')">Reverse this stock take</button>':'')+
      (t.st=='draft'?'<button class="btn" onclick="okpStk.cont('+t.id+')">Continue counting</button>':'')+
      '<button class="btn" onclick="okpStk.go(\'hist\')">Back to history</button>';
  }
  function tText(t){
    const s=t.sum||tsum(t),D=diffs(t),L=['*STOCK TAKE #'+t.no+'*','*'+(db.shop.name||'Shop')+'*','Scope: '+t.scope,'Date: '+fdt(t.date,t.time),'Counted by: '+(t.by||'-')+(t.ap?' · Approved by: '+t.ap:''),'Status: '+stLab(t),'',
      'Counted '+s.counted+' of '+s.total+' products','Shortages: '+s.ns+' (UGX '+mf(s.short)+')','Surpluses: '+s.ng+' (UGX '+mf(s.surp)+')','*'+(s.net<0?'Value lost':'Value gained')+': UGX '+mf(s.net)+'* (at cost)'];
    if(D.length){L.push('','*Differences*');D.forEach(({l})=>{const d=rnd(l.cnt-l.sys);L.push('- '+l.n+': system '+qf(l.sys)+', counted '+qf(l.cnt)+' ('+sg(d)+' '+l.u+') '+(l.r||'Counted'))})}
    return L.join('\n');
  }
  function tWa(i){const t=takeById(i);if(t)window.open('https://wa.me/?text='+encodeURIComponent(tText(t)),'_blank')}
  function tPdf(i,share){const t=takeById(i);if(!t)return;if(!window.X||!X.stockTakePdf)return alert('PDF is not available.');X.stockTakePdf(t,share)}
  function revTake(i){
    const t=takeById(i);if(!t||t.st!='posted')return;
    askc('Reverse stock take #'+t.no+'? Its adjustments are cancelled and stock goes back to what it was. The record stays in the history.',()=>{
      const d=td();let n=0;ads().forEach(a=>{if(a.tid==t.id&&!a.rev){a.rev=1;a.rd=d;n++}});
      t.st='reversed';t.rd=d;save();O.v='detail';render();toast('Reversed '+n+' adjustment'+(n==1?'':'s'));
    });
  }

  /* ---------- HISTORY ---------- */
  function histView(){
    const L=sts().filter(t=>t.st!='draft').sort((a,b)=>((b.pd||b.date)+(b.pt||''))<((a.pd||a.date)+(a.pt||''))?-1:1);
    return segH()+(L.length?L.map(t=>{const s=t.sum||tsum(t);
      return '<button class="item sk-item '+(t.st=='reversed'?'':s.net<0?'sk-bad':'sk-ok')+'" onclick="okpStk.view('+t.id+')"><span class="nm"><b>Stock take #'+t.no+' · '+esc(t.scope)+'</b><small>'+fdt(t.date,t.time)+' · counted by '+esc(t.by||'(not recorded)')+'</small><small>'+s.diffs+' difference'+(s.diffs==1?'':'s')+' · '+stLab(t)+'</small></span><span class="pr '+(s.net<0?'out':s.net>0?'in':'')+'">UGX '+mf(s.net)+'</span></button>'}).join(''):'<div class="empty">No finished stock takes yet.</div>');
  }
  function view(i){O.tid=i;O.v='detail';render();$('#mn').scrollTop=0}
  function detailView(){const t=takeById(O.tid);if(!t){O.v='hist';return histView()}return viewTakeHtml(t)}

  /* ---------- SINGLE-ITEM ADJUSTMENT ---------- */
  function adjView(){
    const p=O.ap&&pByName(O.ap),m=stk(),cur=p?rnd(m[p.name]||0):0,rs=O.dir=='out'?RS_OUT:RS_IN;
    let h=segH();
    h+='<label>Product</label>'+(p?'<div class="item" style="cursor:default"><span class="nm"><b>'+esc(p.name)+'</b><small>In stock now: <b>'+qf(cur)+' '+esc(p.unit||'')+'</b> · cost UGX '+fm(costNow(p))+'</small></span><button class="lnk" onclick="okpStk.apClr()">Change</button></div>':
      '<input id="ap_q" type="search" autocomplete="off" placeholder="Search product…" value="'+esc(O.apq)+'" oninput="okpStk.apq(this.value)"><div id="ap_res">'+apRes()+'</div>');
    if(p){
      h+='<label>What happened</label><div class="seg"><button class="'+(O.dir=='out'?'on':'')+'" onclick="okpStk.dir(\'out\')">Remove from stock</button><button class="'+(O.dir=='in'?'on':'')+'" onclick="okpStk.dir(\'in\')">Add to stock</button></div>'+
        '<label>Reason</label><select id="ap_r">'+optH(rs)+'</select>'+
        '<label>Quantity ('+esc(p.unit||'')+')</label><input id="ap_n" type="number" inputmode="decimal" step="any" min="0" placeholder="0">'+
        '<label>Note (needed if the reason is Other)</label><input id="ap_t" placeholder="Details">'+
        whoH('ap_by','Done by')+'<button class="btn big" onclick="okpStk.adjSave()">Save adjustment</button>';
    }
    const A=ads().slice().sort((a,b)=>((b.date||'')+(b.time||''))<((a.date||'')+(a.time||''))?-1:((b.date||'')+(b.time||''))>((a.date||'')+(a.time||''))?1:0);
    h+='<h3>Adjustment log (audit trail)</h3>'+(A.length?A.slice(0,O.more).map(a=>'<button class="item" onclick="okpStk.viewAdj('+a.id+')"><span class="nm"><b>'+esc(a.n)+'</b><small>'+fdt(a.date,a.time)+' · '+esc(a.r)+(a.tid?' · '+esc(a.note||'Stock take'):'')+(a.by?' · '+esc(a.by):'')+'</small>'+(a.rev?'<small class="low">Reversed '+fdt(a.rd)+'</small>':'')+'</span><span class="pr '+(a.rev?'':a.q<0?'out':'in')+'" style="'+(a.rev?'text-decoration:line-through;opacity:.6':'')+'">'+sg(a.q)+' '+esc(unitOf(a.n))+'<br><small>UGX '+mf(Math.round(a.q*(+a.c||0)))+'</small></span></button>').join('')+(A.length>O.more?'<button class="btn" onclick="okpStk.moreA()">Show more</button>':''):'<div class="empty">No adjustments yet.</div>');
    return h;
  }
  function apRes(){
    const q=O.apq.toLowerCase().trim();if(!q)return '<small>Type part of the product name.</small>';
    const m=stk(),L=db.P.filter(p=>p.name.toLowerCase().includes(q)||(p.code||'').toLowerCase().includes(q)).slice(0,8);
    return L.map(p=>'<button class="item" onclick="okpStk.apPick('+p.id+')"><span class="nm"><b>'+esc(p.name)+'</b><small>'+qf(m[p.name]||0)+' '+esc(p.unit||'')+' in stock</small></span></button>').join('')||'<div class="empty">No product found.</div>';
  }
  function apq(v){O.apq=v;const e=document.getElementById('ap_res');if(e)e.innerHTML=apRes()}
  function apPick(i){const p=db.P.find(x=>x.id==i);if(!p)return;O.ap=p.name;O.apq='';render()}
  function apClr(){O.ap=null;O.apq='';render()}
  function dir(d){O.dir=d;render()}
  function adjFor(i){const p=db.P.find(x=>x.id==i);if(!p)return;modal();O.ap=p.name;O.v='adj';O.dir='out';st.tab='sa';render();$('#mn').scrollTop=0}
  function moreA(){O.more+=30;render()}
  function adjSave(){
    const p=O.ap&&pByName(O.ap);if(!p)return alert('Choose a product first.');
    const n=+val('ap_n'),r=val('ap_r'),note=val('ap_t'),by=val('ap_by');
    if(!(n>0))return alert('Enter the quantity (more than 0).');
    if(r=='Other'&&!note)return alert('Write a short note to explain the reason.');
    if(!by&&(db.staff||[]).length)return alert('Choose who is doing this adjustment.');
    const q=rnd(O.dir=='out'?-n:n),cur=rnd(stk()[p.name]||0);
    const go=()=>{ads().push({id:id(),date:td(),time:hm(),n:p.name,q,r,c:costNow(p),bf:cur,by,note});rem(by);save();O.ap=null;O.apq='';render();toast('Adjustment saved ✓')};
    if(cur+q<0)askc('This will make stock '+qf(cur+q)+' '+(p.unit||'')+' (below zero). Save it anyway?',go);else go();
  }
  function viewAdj(i){
    const a=ads().find(x=>x.id==i);if(!a)return;const p=pByName(a.n),after=rnd((+a.bf||0)+a.q);
    const R=(x,y)=>'<div class="item" style="cursor:default"><span class="nm"><b>'+x+'</b></span><span class="pr" style="font-weight:600">'+y+'</span></div>';
    modal('<h2>Stock adjustment</h2>'+R('Product',esc(a.n))+R('Date',fdt(a.date,a.time))+R('Reason',esc(a.r))+R('Quantity',sg(a.q)+' '+esc(unitOf(a.n)))+R('Value at cost','UGX '+mf(Math.round(a.q*(+a.c||0))))+(a.bf!=null?R('Stock before / after',qf(a.bf)+' → '+qf(after)):'')+R('Done by',esc(a.by||'(not recorded)'))+(a.ap?R('Approved by',esc(a.ap)):'')+(a.note?R('Note',esc(a.note)):'')+
      (a.rev?'<p class="low">Reversed on '+fdt(a.rd)+'. It no longer changes stock.</p>':'')+
      (!a.rev&&!a.tid?'<button class="btn del" onclick="okpStk.revAdj('+a.id+')">Reverse this adjustment</button>':'')+
      (!a.rev&&a.tid?'<small>This came from a stock take. To undo it, reverse the whole stock take in History.</small>':'')+
      '<button class="btn" onclick="modal()">Close</button>');
  }
  function revAdj(i){
    const a=ads().find(x=>x.id==i);if(!a||a.rev||a.tid)return;
    askc('Reverse this adjustment? Stock goes back to what it was. The record stays in the log.',()=>{a.rev=1;a.rd=td();save();modal();render();toast('Adjustment reversed')});
  }

  /* ---------- page + navigation ---------- */
  function page(){
    const v=O.v;
    if(v=='ro')return roView();
    if(v=='take')return takeView();
    if(v=='count')return countView();
    if(v=='review')return reviewView();
    if(v=='detail')return detailView();
    if(v=='adj')return adjView();
    if(v=='hist')return histView();
    return lowView();
  }
  function open(v){st.tab='sa';O.v=v||'low';if(O.v=='low'||O.v=='ro')O.sup='__all';render();const m=$('#mn');if(m)m.scrollTop=0}
  function go(v){if(v=='count'&&!takeById(O.tid))v='take';O.v=v;render();const m=$('#mn');if(m)m.scrollTop=0}
  function back(){ // header back button: step up inside this screen before leaving it
    if(st.tab!='sa')return false;
    if(O.v=='review'){O.v='count';render();return true}
    if(O.v=='count'||O.v=='detail'){const t=takeById(O.tid);O.v=(t&&t.st=='draft')?'take':'hist';render();return true}
    return false;
  }
  function lf(v){O.lf=v;render()}

  /* ---------- alert on opening the app ---------- */
  let bt=null;
  function banner(c,fresh){
    let e=document.getElementById('lsb');if(e)e.remove();
    e=document.createElement('div');e.id='lsb';e.setAttribute('role','alert');
    const names=fresh.slice(0,3).map(x=>x.p.name).join(', ')+(fresh.length>3?' +'+(fresh.length-3)+' more':'');
    e.innerHTML='<div class="lsb-t"><b>'+c.n+' item'+(c.n>1?'s':'')+' low'+(c.out?' · '+c.out+' out of stock':'')+'</b><small>'+esc(names)+'</small></div><button class="lsb-v" onclick="okpStk.open(\'low\');okpStk.hideBanner()">View</button><button class="lsb-x" aria-label="Close" onclick="okpStk.hideBanner()">✕</button>';
    document.body.appendChild(e);clearTimeout(bt);bt=setTimeout(hideBanner,20000);
  }
  function hideBanner(){const e=document.getElementById('lsb');if(e)e.remove();clearTimeout(bt)}
  function check(){
    try{
      if(typeof db==='undefined'||!db||!db.P)return;
      const c=counts(),names=c.L.map(x=>x.p.name);
      let seen=jget(KS,[],sessionStorage);
      seen=seen.filter(n=>names.includes(n));
      const fresh=c.L.filter(x=>!seen.includes(x.p.name));
      jset(KS,seen.concat(fresh.map(x=>x.p.name)),sessionStorage);
      if(!fresh.length)return;
      const pf=pref();
      if(pf.banner)banner(c,fresh);
      if(pf.notify&&jget(KN,'')!==td()){jset(KN,td());showNote(c,false)}
    }catch(e){console.warn('low-stock check',e)}
  }

  /* ---------- styles (kept here so this file works even without theme.css) ---------- */
  const css=document.createElement('style');css.id='stk-css';
  css.textContent=[
    '.bdg{display:inline-block;margin-top:4px;padding:2px 9px;border-radius:99px;font-size:.72rem;font-weight:800;letter-spacing:.04em;line-height:1.5;color:#fff}',
    '.bdg.bad{background:#c0392b}.bdg.warn{background:#f28c00;color:#2a1700}',
    '.nm .bdg{margin-left:0}',
    '.sk-card{border-left:6px solid var(--line)}.sk-card.sk-bad{border-left-color:#c0392b}.sk-card.sk-warn{border-left-color:#f28c00}.sk-card.sk-ok{border-left-color:#18794e}',
    '.stat.wide.sk-card{border-left:6px solid #f28c00}.stat.wide.sk-card.sk-bad{border-left-color:#e0523f}.stat.wide.sk-card.sk-ok{border-left-color:#4cc38a}',
    '.sk-item.sk-bad{border-left:6px solid #c0392b}.sk-item.sk-warn{border-left:6px solid #f28c00}.sk-item.sk-ok{border-left:6px solid #18794e}',
    '.sk-head{margin:4px 0 10px}.sk-head b{display:block;font-size:1.1rem}.sk-head small{color:var(--mut)}',
    '.sk-ro{align-items:center}',
    'button.tk{flex:0 0 48px;width:48px;height:48px;min-height:48px;margin:0;padding:0;border-radius:12px;border:2px solid var(--line);background:var(--card);color:var(--accink);font-size:1.5rem;font-weight:800;cursor:pointer}',
    'button.tk.on{background:#f28c00;border-color:#f28c00}',
    '.sk-q{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex:0 0 96px}.sk-q input{width:96px;margin:0;text-align:right;font-weight:700}.sk-q small{color:var(--mut)}',
    '.sk-row{display:flex;align-items:center;flex-wrap:wrap;gap:10px;background:var(--card);border:1.5px solid var(--line);border-radius:14px;padding:12px 14px;margin-bottom:10px}',
    '.sk-row.done{border-color:#18794e}.sk-row .nm{flex:1 1 150px;min-width:0}.sk-row .nm b{display:block;overflow-wrap:anywhere}.sk-row .nm small{display:block;color:var(--mut)}',
    '.sk-in{display:flex;gap:8px;align-items:center;flex:0 0 auto}.sk-in input{width:112px;margin:0;text-align:right;font-size:1.15rem;font-weight:800}',
    'button.skeq{width:48px;height:48px;min-height:48px;margin:0;padding:0;border-radius:12px;border:2px solid var(--line);background:var(--card);font-size:1.4rem;font-weight:800;cursor:pointer}',
    '.sk-df{flex:0 0 100%;text-align:right;font-weight:800;min-height:0}.sk-df:empty{display:none}.sk-df.neg{color:var(--bad)}.sk-df.pos{color:var(--ok)}',
    '.skt{background:#fff!important;color:#000!important}.skt th,.skt td{color:#000!important;border-bottom:1px solid #ccc}',
    '#lsb{position:fixed;z-index:40;left:10px;right:10px;top:calc(env(safe-area-inset-top,0px) + 8px);max-width:520px;margin:0 auto;display:flex;align-items:center;gap:8px;padding:10px 10px 10px 14px;border-radius:16px;background:#2b2723;color:#fff;border:2px solid #f28c00;box-shadow:0 8px 24px #0007}',
    '#lsb .lsb-t{flex:1;min-width:0}#lsb b{display:block}#lsb small{display:block;color:#e8dccb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#lsb button{min-height:48px;min-width:48px;border-radius:12px;border:0;font-weight:800;cursor:pointer}',
    '#lsb .lsb-v{background:#f28c00;color:#2a1700;padding:0 16px}#lsb .lsb-x{background:transparent;color:#fff;font-size:1.2rem}',
    '@media print{#lsb{display:none!important}}'
  ].join('\n');
  document.head.appendChild(css);

  /* ---------- wiring ---------- */
  V.sa=page;
  window.okpStk={open,go,back,page,homeCard,badge,counts,lowList,lf,prod,tick,roq,tickAll,supSel,addRo,roWa,roCopy,roPdf,roClear,
    start,cont,cin,ccn,ckd,same,cq,cf,review,rsn,post,delDraft,view,tPdf,tWa,revTake,
    apq,apPick,apClr,dir,adjFor,moreA,adjSave,viewAdj,revAdj,togBanner,togNote,hideBanner,check,
    _:{O,tsum,diffs,roText,roRows,roVisible,roSend,lastBuy,tText,rnd}};

  window.addEventListener('load',()=>{
    // run after the other scripts, and keep any hook they already added
    const prev=window.xAfter;
    window.xAfter=function(){if(typeof prev==='function'){try{prev.apply(this,arguments)}catch(e){console.warn(e)}}check()};
    if(/[?&]open=low\b/.test(location.search)){try{history.replaceState(null,'',location.pathname)}catch(e){}open('low')}
    else check();
  });
  if(navigator.serviceWorker)navigator.serviceWorker.addEventListener('message',e=>{if(e.data&&e.data.type=='okp-open')open(e.data.to||'low')});
  // save a half-typed count when the app goes to the background or closes
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){try{flush()}catch(e){};O.hiddenAt=Date.now();return}
    if(O.hiddenAt&&Date.now()-O.hiddenAt>30*60*1000){try{sessionStorage.removeItem(KS)}catch(e){}check()}
    O.hiddenAt=0;
  });
  window.addEventListener('pagehide',()=>{try{flush()}catch(e){}});
})();
