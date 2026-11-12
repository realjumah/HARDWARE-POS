/* Okpotani customer credit book.
 *
 * Works on top of the existing credit sales (a credit sale keeps its own part-payments in s.pays), so the cash book,
 * reports, Excel export and cloud sync keep working exactly as before. This file adds:
 *  - customer accounts (db.CU: name, phone, credit limit, note) synced through cloud.js
 *  - one list of who owes what, with overdue marking and search
 *  - a customer account page: balance, statement, receive payment (oldest receipt first), WhatsApp reminder
 *  - credit limit check when a credit sale is made or edited
 *  - balance and pay-by date printed on credit receipts
 */
(function(){
  'use strict';
  const key=n=>String(n||'').trim().toLowerCase();
  const cus=()=>(db.CU=db.CU||[]);
  const findCu=n=>cus().find(c=>key(c.name)==key(n));
  const credSales=()=>db.S.filter(s=>s.pay=='Credit');
  const owedOf=s=>Math.max(0,tot(s)-paid(s));
  const salesOf=n=>credSales().filter(s=>key(s.cust)==key(n));
  const bal=(n,skipId)=>sum(salesOf(n).filter(s=>s.id!=skipId),owedOf);
  const byOld=(a,b)=>a.date<b.date?-1:a.date>b.date?1:(+a.no||0)-(+b.no||0);

  // One row per customer: saved customers plus anyone who has a credit sale.
  function list(){
    const m=new Map();
    cus().forEach(c=>{if(key(c.name))m.set(key(c.name),{k:key(c.name),name:c.name,c})});
    credSales().forEach(s=>{const k=key(s.cust);if(k&&!m.has(k))m.set(k,{k,name:String(s.cust).trim(),c:null})});
    return [...m.values()].map(r=>{
      const ss=salesOf(r.name),open=ss.filter(s=>owedOf(s)>0),od=open.filter(s=>s.due&&s.due<td());
      const pd=ss.flatMap(s=>(s.pays||[]).map(p=>p.d)).sort();
      r.open=open.sort(byOld);r.bal=sum(open,owedOf);r.over=sum(od,owedOf);
      r.last=pd.length?pd[pd.length-1]:'';r.lim=r.c?(+r.c.limit||0):0;r.phone=r.c&&r.c.phone||'';
      return r;
    });
  }
  const one=k=>list().find(r=>r.k==k);
  const enc=k=>encodeURIComponent(k).replace(/'/g,'%27');

  // ---------- credit tab ----------
  function rowH(r){
    const sub=[r.phone?esc(r.phone):'',r.open.length+' unpaid receipt'+(r.open.length==1?'':'s'),r.last?'last paid '+fdt(r.last):''].filter(Boolean).join(' · ');
    return '<button class="item" onclick="okpCr.view(decodeURIComponent(\''+enc(r.k)+'\'))"><span class="nm"><b>'+esc(r.name)+'</b><small>'+sub+'</small>'
      +(r.over>0?'<small class="low">Overdue: UGX '+fm(r.over)+'</small>':'')
      +(r.lim>0&&r.bal>=r.lim?'<small class="low">Credit limit reached</small>':'')+'</span><span class="pr '+(r.bal>0?'low':'ok')+'">'+fm(r.bal)+'</span></button>';
  }
  function rows(q){
    q=key(q);const L=list();
    const pool=q?L.filter(r=>key(r.name).includes(q)||String(r.phone).replace(/\s/g,'').includes(q.replace(/\s/g,''))):L.filter(r=>r.bal>0);
    pool.sort((a,b)=>(b.over>0)-(a.over>0)||b.bal-a.bal||a.name.localeCompare(b.name));
    return pool.map(rowH).join('')||'<div class="empty">'+(q?'No customer found':'No outstanding credit')+'</div>';
  }
  function tab(seg){
    const L=list().filter(r=>r.bal>0);
    return seg+'<div class="stat wide"><small>Total owed by '+L.length+' customer'+(L.length==1?'':'s')+'</small><span class="num">UGX '+fm(sum(L,r=>r.bal))+'</span></div>'
      +(sum(L,r=>r.over)>0?'<div class="stat wide"><small>Overdue (past the promised date)</small><span class="num low">UGX '+fm(sum(L,r=>r.over))+'</span></div>':'')
      +'<button class="btn big" onclick="okpCr.cuForm()" style="margin:0 0 10px">+ New customer</button>'
      +'<input id="cqs" type="search" placeholder="Search customer name or phone" value="'+esc(st.cq||'')+'" oninput="okpCr.search(this.value)">'
      +'<div id="cqlist">'+rows(st.cq||'')+'</div>'
      +'<small>To sell on credit, choose Credit as the payment when you complete a sale.</small>';
  }
  function search(v){st.cq=v;const e=$('#cqlist');if(e)e.innerHTML=rows(v)}

  // ---------- statement ----------
  function entries(n){
    const e=[];
    salesOf(n).forEach(s=>{
      e.push({d:s.date,o:0,n:+s.no||0,l:'Receipt #'+s.no,a:tot(s)-(s.advA||0)});
      (s.pays||[]).forEach(p=>e.push({d:p.d,o:1,n:+s.no||0,l:'Payment · receipt #'+s.no,a:-p.a}));
      rets().forEach(z=>{if(z.sid==s.id&&z.dec>0)e.push({d:z.date,o:1,n:+s.no||0,l:'Return R-'+z.no+' · receipt #'+s.no,a:-z.dec})});
    });
    e.sort((a,b)=>a.d<b.d?-1:a.d>b.d?1:a.o-b.o||a.n-b.n);
    let r=0;e.forEach(x=>{r+=x.a;x.r=r});return e;
  }
  function stmtText(r){
    const e=entries(r.name).slice(-20),w=(a,b)=>a.padEnd(22).slice(0,22)+b.padStart(10);
    return [db.shop.name,'STATEMENT · '+r.name,'Date: '+td(),'-'.repeat(32),
      ...e.map(x=>x.d+'  '+x.l+'\n'+w('',(x.a<0?'-':'')+fm(Math.abs(x.a))+'  ('+fm(x.r)+')')),
      '-'.repeat(32),w('BALANCE OWED',fm(r.bal)),r.lim>0?w('Credit limit',fm(r.lim)):'',db.shop.tel?'Tel: '+db.shop.tel:''].filter(x=>x!=='').join('\n');
  }
  const waNum=p=>{let d=String(p||'').replace(/\D/g,'');if(d.startsWith('0'))d='256'+d.slice(1);else if(d.length==9)d='256'+d;return d};
  function wa(r,text){window.open('https://wa.me/'+(r.phone?waNum(r.phone):'')+'?text='+encodeURIComponent(text),'_blank')}
  function remind(k){
    const r=one(k);if(!r)return;
    const sh=(db.shop.name||'our shop');
    wa(r,'Hello '+r.name+', this is '+sh+'. Your balance with us is UGX '+fm(r.bal)+(r.over>0?', of which UGX '+fm(r.over)+' is overdue':'')+'. Please make a payment when you can. Thank you.'+(db.shop.tel?' Call us: '+db.shop.tel:''));
  }
  function stmt(k){const r=one(k);if(r)wa(r,stmtText(r))}

  // ---------- customer account page ----------
  function view(k,all){
    const r=one(k);if(!r)return modal();
    const e=entries(r.name),shown=all?e:e.slice(-10),avail=r.lim>0?Math.max(0,r.lim-r.bal):null,q="decodeURIComponent('"+enc(r.k)+"')";
    modal('<h2>'+esc(r.name)+'</h2>'+(r.phone?'<small>📞 '+esc(r.phone)+'</small>':'<small>No phone number saved</small>')
      +'<div class="stat wide"><small>Balance owed</small><span class="num">UGX '+fm(r.bal)+'</span></div>'
      +(r.lim>0?'<small>Credit limit UGX '+fm(r.lim)+' · available UGX '+fm(avail)+'</small>':'<small>No credit limit set</small>')
      +(r.over>0?'<div class="stat wide"><small>Overdue</small><span class="num low">UGX '+fm(r.over)+'</span></div>':'')
      +(r.bal>0?'<button class="btn big" onclick="okpCr.pay('+q+')">💰 Receive payment</button>':'')
      +(r.bal>0?'<button class="btn" onclick="okpCr.remind('+q+')">💬 WhatsApp reminder'+(r.phone?'':' (choose contact)')+'</button>':'')
      +'<button class="btn" onclick="okpCr.stmt('+q+')">📄 Share statement on WhatsApp</button>'
      +'<button class="btn" onclick="okpCr.cuForm('+q+')">✏️ Edit customer / credit limit</button>'
      +(r.open.length?'<h3>Unpaid receipts</h3>'+r.open.map(s=>'<button class="item" onclick="modal();cform('+s.id+')"><span class="nm"><b>#'+s.no+' · '+fdt(s.date,s.time)+'</b><small>total '+fm(tot(s))+(s.due?' · pay by '+fdt(s.due):'')+'</small>'+(s.due&&s.due<td()?'<small class="low">Overdue</small>':'')+'</span><span class="pr low">'+fm(owedOf(s))+'</span></button>').join(''):'')
      +'<h3>Statement</h3>'+(shown.slice().reverse().map(x=>'<div class="item" style="cursor:default"><span class="nm"><b>'+esc(x.l)+'</b><small>'+fdt(x.d)+'</small></span><span class="pr '+(x.a<0?'ok':'low')+'">'+(x.a<0?'−':'')+fm(Math.abs(x.a))+'<br><small>bal '+fm(x.r)+'</small></span></div>').join('')||'<div class="empty">No credit history yet</div>')
      +(!all&&e.length>10?'<button class="btn" onclick="okpCr.view('+q+',1)">Show full statement ('+e.length+' lines)</button>':'')
      +'<button class="btn" onclick="modal()">Close</button>');
  }

  // Receive one payment and spread it over the oldest unpaid receipts first.
  function pay(k){
    const r=one(k);if(!r)return;
    form('Receive payment from '+esc(r.name)+' (owes '+fm(r.bal)+')',[['d','Date paid','date'],['a','Amount received (UGX)','number']],{d:td(),a:r.bal},v=>{
      if(!(v.a>0))return alert('Enter the amount received.'),false;
      if(v.a>r.bal)return alert('That is more than the UGX '+fm(r.bal)+' owed. Enter an amount up to '+fm(r.bal)+'.'),false;
      let left=v.a;const d=v.d||td();
      r.open.forEach(s=>{if(left<=0)return;const x=Math.min(left,owedOf(s));if(x>0){(s.pays=s.pays||[]).push({d,a:x});left-=x}});
      setTimeout(()=>view(k),40);
    });
  }

  // ---------- customer record ----------
  function cuForm(k){
    const r=k?one(k):null,c=(r&&r.c)||{};
    form(r?'Edit customer':'New customer',[['name','Customer name','text'],['phone','Phone number','tel'],['limit','Credit limit (UGX) – 0 means no limit','number'],['note','Note (optional)','text']],
      {name:r?r.name:'',phone:c.phone||'',limit:c.limit||0,note:c.note||''},v=>{
        if(!v.name)return alert('Enter the customer name.'),false;
        if(v.limit<0)return alert('The credit limit cannot be negative.'),false;
        const nk=key(v.name);
        if((!r||nk!=r.k)&&list().some(x=>x.k==nk))return alert('A customer with this name already exists.'),false;
        let rec=r&&r.c;
        if(!rec){rec={id:id(),name:v.name};cus().push(rec)}
        const old=r?r.name:null;
        Object.assign(rec,{name:v.name,phone:v.phone,limit:v.limit,note:v.note});
        if(old&&old!==v.name)db.S.forEach(s=>{if(key(s.cust)==key(old))s.cust=v.name});
        if(r)setTimeout(()=>view(nk),40);
      },(r&&r.c&&r.bal==0)?(()=>{db.CU=cus().filter(x=>x.id!=r.c.id)}):null);
  }
  // Called when a credit sale is saved: makes sure the customer exists, keeps their phone, stores the promised date.
  function ensure(name,phone,s,due){
    if(s&&s.pay!='Credit')delete s.due;
    if(!key(name))return;
    let c=findCu(name);
    if(!c){c={id:id(),name:String(name).trim(),phone:phone||'',limit:0,note:''};cus().push(c)}
    else if(phone&&phone!==c.phone)c.phone=phone;
    if(s){if(s.pay=='Credit'&&due)s.due=due;else delete s.due}
  }
  // Credit limit: newOut = what this sale would leave unpaid. skipId = the sale being edited (not counted twice).
  function check(name,newOut,skipId){
    const c=findCu(name),lim=c?(+c.limit||0):0;
    if(!(lim>0)||!(newOut>0))return '';
    const cur=bal(name,skipId);
    if(cur+newOut<=lim)return '';
    return 'Credit limit reached for '+c.name+'.\n\nOwes now: UGX '+fm(cur)+'\nThis sale on credit: UGX '+fm(newOut)+'\nLimit: UGX '+fm(lim)
      +'\n\nTake a payment first (Money → Credit), or raise the limit there.';
  }

  // ---------- sale screen helpers ----------
  const dl=()=>'<datalist id="cul">'+list().map(r=>'<option value="'+esc(r.name)+'">').join('')+'</datalist>';
  function hint(){
    const i=$('#cu'),o=$('#cuinfo');if(!i||!o)return;
    const n=i.value.trim();if(!n){o.innerHTML='';return}
    const c=findCu(n),b=bal(n),lim=c?(+c.limit||0):0,ph=$('#cph');
    if(ph&&!ph.value&&c&&c.phone)ph.value=c.phone;
    o.innerHTML=(c||b>0)?'<small'+(lim>0&&b>=lim?' class="low"':'')+'>Owes UGX '+fm(b)+(lim>0?' · limit UGX '+fm(lim)+' · available UGX '+fm(Math.max(0,lim-b)):' · no credit limit')+'</small>':'<small>New customer</small>';
  }

  // ---------- receipt lines ----------
  const w=(a,b)=>a.padEnd(22).slice(0,22)+b.padStart(10);
  function rt(s){
    if(s.pay!='Credit'||!key(s.cust))return '';
    return (s.due?'\n'+w('Pay by',fdt(s.due)):'')+'\n'+w('ACCOUNT BALANCE',fm(bal(s.cust)));
  }
  function rh(s,R){
    if(s.pay!='Credit'||!key(s.cust))return '';
    return (s.due?R('Pay by',esc(fdt(s.due))):'')+R('ACCOUNT BALANCE','UGX '+fm(bal(s.cust)));
  }

  window.okpCr={tab,view,pay,cuForm,search,remind,stmt,check,ensure,hint,dl,rt,rh,list,bal};
})();
