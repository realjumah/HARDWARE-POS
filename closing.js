/* Okpotani DAILY CLOSING.
 *
 * Built on top of the existing cash book, so there is only ONE set of figures:
 *  - the expected money for a day always comes from cbexp(day) / flows(day) (the Cash book)
 *  - a closing is saved in the same db.C list as before (date, co, cc, mo, mc, note) plus extra fields:
 *      cash   cash counted in the box (notes + coins)        cc = cash + MoMo balance (the same "total money" the Cash book uses)
 *      mc     Mobile Money balance entered                  den  note-and-coin counts
 *      by, at, time   who closed it and when                f    the figures as they were when the day was closed
 *      dc, dm, dv     cash / MoMo / total difference        sig  a fingerprint of the day's records (to notice later changes)
 *  - the next day's opening cash is the closing balance (opening() in index.html already does this)
 *  - db.LG (synced, listed in COLS in cloud.js) is the closing log: closed, reopened, confirmed edits, changes after closing
 *
 * A closed day is locked: editing or deleting its receipts, expenses, purchases/supplier payments, advances or owner
 * entries asks for a confirmation and is written to the log. Anything that still changes a closed day by another route
 * (a return, a late payment dated on that day, another phone) is noticed afterwards and marked "changed after closing".
 * Reopening a day removes the closing (so the Cash book works as before) and leaves a visible entry in the log.
 */
(function(){
  'use strict';
  const DEN=[50000,20000,10000,5000,2000,1000];
  const S={d:'',den:{},coin:'',cash:'',mc:'',note:'',by:'',typed:false,f:null,q:'',flt:'all'};
  const unl={};                                    // confirmed unlocks (so one edit does not ask twice)
  const lg=()=>(db.LG=db.LG||[]);
  const rec=d=>db.C.find(c=>c.date==d);
  const iso=()=>new Date().toISOString();
  const hhmm=()=>{const n=new Date();return String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0')};
  const dtxt=v=>v==0?'Balanced':v<0?'SHORT by '+fm(-v):'OVER by '+fm(v);
  const wk=d=>new Date(d+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short'});
  function who(){
    let e='';try{const u=window.okpotaniCloudCore&&window.okpotaniCloudCore.state&&window.okpotaniCloudCore.state.user;e=u&&(u.displayName||u.email)||''}catch(x){}
    return (window.okpAcc&&okpAcc.name())||db.lastCb||e||(db.shop&&db.shop.mgr)||'(not recorded)';
  }
  function log(date,act,what,by){lg().push({id:id(),at:iso(),date,act,who:by||who(),what})}

  /* ---------- the figures of a day: all taken from the Cash book (flows / cbexp) ---------- */
  function fig(d){
    const e=cbexp(d),c=e.f.c,g=(L,k)=>{const x=L.find(z=>z[0]==k);return x?x[1]:0};
    const ss=db.S.filter(s=>s.date==d);
    const IN1=['Cash sales','Mobile Money sales','Customer credit payments','Customer advances received'];
    const SUP=['Stock bought from suppliers','Payments to suppliers','Transport, handling and other costs','Mobile money charges'];
    const OUT1=['Expenses'].concat(SUP),L=[],add=(l,v,k)=>L.push([l,v,k]);
    add('Cash sales',g(c.i,'Cash sales'),'i');
    add('Mobile Money sales',g(c.i,'Mobile Money sales'),'i');
    add('Credit given (not cash)',sum(ss.filter(s=>s.pay=='Credit'),s=>tot(s)-(s.advA||0)),'x');
    add('Credit payments received',g(c.i,'Customer credit payments'),'i');
    add('Expenses',g(c.o,'Expenses'),'o');
    add('Supplier pay / stock',sum(SUP,k=>g(c.o,k)),'o');
    add('Advances received',g(c.i,'Customer advances received'),'i');
    c.i.forEach(z=>{if(!IN1.includes(z[0]))add(z[0],z[1],'i')});
    c.o.forEach(z=>{if(!OUT1.includes(z[0]))add(z[0],z[1],'o')});
    const o=e.o;
    return{oc:o.c-o.m,om:o.m,ot:o.c,L,et:e.c,em:e.m,ec:e.c-e.m};
  }

  /* ---------- fingerprint of a day's records, to notice changes after closing ---------- */
  function sigs(){
    const m={};db.C.forEach(c=>{m[c.date]=[0,0,0,0,0,0,0,0,0,0,0]});
    const P=['Cash','Mobile Money','Credit'];
    db.S.forEach(s=>{const r=m[s.date];if(r){r[0]++;r[1+Math.max(0,P.indexOf(s.pay))]+=tot(s);r[4]+=(s.advA||0)}(s.pays||[]).forEach(p=>{const q=m[p.d];if(q)q[5]+=p.a})});
    db.X.forEach(x=>{const r=m[x.date];if(r)r[6]+=x.amt});
    db.U.forEach(u=>{const r=m[u.date];if(r)r[7]+=u.q*(u.c+(u.tr||0)+(u.hd||0))+(u.mm||0)+(u.oth||0);(u.pays||[]).forEach(p=>{const q=m[p.d];if(q)q[7]+=p.a+(p.f||0)})});
    db.A.forEach(a=>{const r=m[a.date];if(r)r[8]+=a.amt});
    db.M.forEach(x=>{const r=m[x.date];if(r)r[9]+=x.amt*(1+KK.indexOf(x.kind))});
    (db.R||[]).forEach(z=>{if(z.rev)return;const r=m[z.date];if(r)r[10]+=(z.cash||0)+(z.momo||0)+(+z.val||0)});
    const o={};Object.keys(m).forEach(d=>{o[d]=m[d].map(v=>Math.round(v)).join('.')});return o;
  }
  let lastW=0;
  function watch(){
    if(Date.now()-lastW<1500)return;lastW=Date.now();
    try{
      const cl=db.C.filter(c=>c.sig);if(!cl.length)return;
      const m=sigs();let ch=false,nw=false;
      cl.forEach(c=>{const n=m[c.date];
        if(n!==undefined&&n!==c.sig){
          if(c.chg!==n){c.chg=n;ch=nw=true;const e=cbexp(c.date).c;log(c.date,'changed','Figures of this closed day changed after closing. Expected money now UGX '+fm(e)+(c.f?' (was '+fm(c.f.et)+' when closed).':'.'),'system')}
        }else if(c.chg){delete c.chg;ch=true}
      });
      if(ch)save();
      if(nw)toast('A closed day was changed. See Closing log.');
    }catch(e){console.warn('closing watch',e)}
  }

  /* ---------- the lock ---------- */
  function guard(d,what,go,key){
    if(!d||!rec(d)||(key&&unl[key]&&Date.now()-unl[key]<6e5))return go();
    askc('The day '+fdt(d)+' is CLOSED.\n\nYou are about to '+what+'.\n\nThis changes a closed day. It will be written in the closing log. Continue?',()=>{
      if(key)unl[key]=Date.now();log(d,'unlock','Confirmed: '+what,who());save();go();
    });
  }
  function wrap(name,fn){const o=window[name];if(typeof o!=='function')return;window[name]=function(){return fn(o,arguments)}}
  function hook(){
    wrap('editSale',(o,a)=>{const s=db.S.find(x=>x.id==a[0]);return s?guard(s.date,'edit receipt #'+s.no,()=>o.apply(null,a),'S'+s.id):o.apply(null,a)});
    wrap('delEdit',(o,a)=>{const s=db.S.find(x=>x.id==st.edit);return s?guard(s.date,'delete receipt #'+s.no,()=>o.apply(null,a),'S'+s.id):o.apply(null,a)});
    wrap('saveEdit',(o,a)=>{const s=db.S.find(x=>x.id==st.edit),nd=$('#sd')&&$('#sd').value;return(s&&nd&&nd!==s.date&&rec(nd))?guard(nd,'move receipt #'+s.no+' into this closed day',()=>o.apply(null,a)):o.apply(null,a)});
    wrap('done',(o,a)=>{if(st.edit)return o.apply(null,a);const dt=($('#sd')&&$('#sd').value)||td();return guard(dt,'add a new receipt to this closed day',()=>o.apply(null,a))});
    const rows=[['xform','X','expense',x=>(x.desc||x.type)+' · UGX '+fm(x.amt)],['uform','U','purchase / supplier payment',u=>u.n+' · '+u.date],['aform','A','customer advance',a=>a.cust+' · UGX '+fm(a.amt)],['mform','M','owner / other money entry',z=>KL[KK.indexOf(z.kind)]+' · UGX '+fm(z.amt)]];
    rows.forEach(([fn,k,l,t])=>wrap(fn,(o,a)=>{const r=a[0]&&db[k].find(y=>y.id==a[0]);return r?guard(r.date,'edit or delete this '+l+' ('+t(r)+')',()=>o.apply(null,a),k+r.id):o.apply(null,a)}));
    wrap('delday',(o,a)=>{const d=$('#dd')&&$('#dd').value;return(d&&rec(d))?guard(d,'delete ALL records dated '+d,()=>o.apply(null,a)):o.apply(null,a)});
    wrap('render',(o,a)=>{const x=o.apply(null,a);watch();return x});
  }

  /* ---------- text for printing / WhatsApp ---------- */
  const W=32,w=(a,b)=>String(a).padEnd(W-10).slice(0,W-10)+String(b).padStart(10);
  const row=(l,v)=>String(l).length<=W-11?w(l,v):l+'\n'+w('',v);
  const sgn=(k,v)=>(k=='i'?'+':k=='o'?'-':'')+fm(v);
  function view(r){                                  // everything needed to print a closed day (uses the saved figures)
    const f=(r&&r.f&&r.f.L)?r.f:fig(r.date);
    const hasSplit=r.cash!=null;
    return{r,f,cash:hasSplit?r.cash:null,mc:r.mc==null?f.em:r.mc,dc:r.dc!=null?r.dc:(hasSplit?r.cash-f.ec:null),dm:r.dm!=null?r.dm:(r.mc==null?0:r.mc-f.em),dv:r.dv!=null?r.dv:(r.cc-f.et)};
  }
  function body(r){
    const v=view(r),f=v.f,L=[];
    L.push('Date: '+r.date+' ('+wk(r.date)+')','Closed: '+(r.time||'')+' by '+(r.by||'(not recorded)'),'-'.repeat(W));
    L.push(row('Opening cash',fm(f.oc)));if(f.om)L.push(row('Opening Mobile Money',fm(f.om)));
    f.L.forEach((z,i)=>{if(i>=2&&!z[1])return;if(z[2]=='x')L.push(row(z[0],fm(z[1])));else L.push(row(z[0],sgn(z[2],z[1])))});
    L.push('-'.repeat(W),row('EXPECTED CASH IN BOX',fm(f.ec)),row('Expected Mobile Money',fm(f.em)),'-'.repeat(W));
    if(v.cash!=null){
      L.push(row('Cash counted',fm(v.cash)),row('Cash',dtxt(v.dc)));
      if(r.den){const d=r.den,t=DEN.filter(k=>d[k]).map(k=>fm(k)+' x '+d[k]);if(d.coin)t.push('Coins '+fm(d.coin));if(t.length)L.push(...t.map(x=>'  '+x))}
      L.push(row('Mobile Money balance',fm(v.mc)+(r.mnc?' *':'')),row('Mobile Money',dtxt(v.dm)));
      if(r.mnc)L.push('* not counted, taken as expected');
      L.push('-'.repeat(W),row('TOTAL RESULT',dtxt(v.dv)));
    }else{
      L.push(row('Money counted',fm(r.cc)),row('RESULT',dtxt(v.dv)));
    }
    if(r.note)L.push('-'.repeat(W),'Note: '+r.note);
    if(r.chg)L.push('-'.repeat(W),'! Records of this day were changed after closing');
    L.push('-'.repeat(W),'Closing balance carried forward as','tomorrow\'s opening money: '+fm(r.cc));
    return L.join('\n');
  }
  function fullText(r){
    const sh=db.shop;
    return [sh.name,sh.addr,sh.tel?'Tel: '+sh.tel:'','DAILY CLOSING',body(r)].filter(x=>x!=='').join('\n');
  }

  /* ---------- the "Close the day" screen ---------- */
  const csum=()=>DEN.reduce((a,k)=>a+k*(+S.den[k]||0),0)+(+S.coin||0);
  const res=(l,counted,exp)=>{const v=counted-exp;return'<div class="cards"><div class="stat"><small>'+l+' counted</small><span class="num">'+fm(counted)+'</span></div><div class="stat"><small>'+(v==0?'Balanced':v<0?'SHORT by':'OVER by')+'</small><span class="num '+(v<0?'low':'ok')+'">'+fm(Math.abs(v))+'</span></div></div>'};
  function upd(){
    const f=S.f;if(!f)return;
    const a=$('#ccr'),b=$('#mcr'),c=$('#tdr');if(!a)return;
    const cv=S.cash===''?null:+S.cash||0,mv=S.mc===''?null:+S.mc||0;
    a.innerHTML=cv==null?'<small>Count the cash. The result shows here.</small>':res('Cash',cv,f.ec)+((S.typed&&csum()>0&&csum()!=cv)?'<small class="low">The counter adds up to '+fm(csum())+', not the amount typed.</small>':'');
    b.innerHTML=mv==null?'<small>Leave empty if you did not check Mobile Money. It will then be taken as correct.</small>':res('Mobile Money',mv,f.em);
    if(cv==null){c.innerHTML='';return}
    const t=(cv-f.ec)+((mv==null?f.em:mv)-f.em);
    c.innerHTML='<div class="stat wide"><small>Total result</small><span class="num '+(t<0?'low':'')+'">'+dtxt(t)+'</span></div>';
  }
  function setDen(typing){
    S.cash=String(csum());S.typed=false;
    DEN.forEach(k=>{const i=$('#dn'+k);if(i&&document.activeElement!==i)i.value=S.den[k]||0;const s=$('#ds'+k);if(s)s.textContent='= '+fm(k*(S.den[k]||0))});
    const c=$('#cc');if(c&&document.activeElement!==c)c.value=S.cash;upd();
  }
  const dn=(k,x)=>{S.den[k]=Math.max(0,(+S.den[k]||0)+x);setDen()};
  const dset=(k,v)=>{S.den[k]=Math.max(0,Math.floor(+v||0));setDen()};
  const coin=v=>{S.coin=v===''?'':Math.max(0,+v||0);setDen()};
  const setCash=v=>{S.cash=v;S.typed=true;upd()};
  const setMc=v=>{S.mc=v;upd()};
  const setNote=v=>{S.note=v};
  const setBy=v=>{S.by=v};

  function reset(){S.den={};S.coin='';S.cash='';S.mc='';S.note='';S.typed=false;S.f=null}
  function setD(d){if(!d)d=td();if(d!==S.d){S.d=d;reset()}render()}
  function step(n){setD(addd(S.d||td(),n))}
  function open(d){S.d=d||td();reset();go('close')}

  const ln=(l,v,k)=>'<div class="item" style="cursor:default"><span class="nm"><b>'+esc(l)+'</b></span><span class="pr '+(k=='i'?'ok':k=='o'?'low':'')+'">'+(k=='i'?'+':k=='o'?'−':'')+fm(v)+'</span></div>';
  function books(f){
    let h='<h3>1 · What the books say</h3>'+ln('Opening cash in the box (carried forward)',f.oc,'');
    if(f.om)h+=ln('Opening Mobile Money balance',f.om,'');
    f.L.forEach((z,i)=>{
      if(i>=7&&!z[1])return;
      if(z[2]=='x')h+='<div class="item" style="cursor:default"><span class="nm"><b>'+esc(z[0])+'</b><small>Not money in the box. Part-payments taken on the day are in the credit payments line.</small></span><span class="pr">'+fm(z[1])+'</span></div>';
      else h+=ln(z[0],z[1],z[2]);
    });
    h+='<div class="cards" style="margin-top:8px"><div class="stat wide"><small>EXPECTED cash in the box</small><span class="num">UGX '+fm(f.ec)+'</span></div><div class="stat"><small>Expected on Mobile Money</small><span class="num">'+fm(f.em)+'</span></div><div class="stat"><small>Total (= Cash book)</small><span class="num">'+fm(f.et)+'</span></div></div>';
    return h;
  }
  function page(){
    const d=S.d||(S.d=td()),r=rec(d),dis=d>td();
    let h='<div class="seg"><button onclick="okpCl.step(-1)">← Previous</button><button onclick="okpCl.setD(td())">Today</button><button onclick="okpCl.step(1)">Next →</button></div>'
      +'<input type="date" value="'+d+'" onchange="okpCl.setD(this.value)">';
    const reo=lg().filter(x=>x.date==d&&x.act=='reopen').length;
    if(r){
      const v=view(r),f=v.f;
      h+='<div class="stat wide"><small>🔒 CLOSED · '+esc(fdt(d))+'</small><span class="num">by '+esc(r.by||'(not recorded)')+(r.time?' · '+esc(r.time):'')+'</span></div>';
      if(r.chg)h+='<div class="item" style="border-color:var(--bad);cursor:default"><span class="nm"><b class="low">Changed after closing</b><small>Receipts, expenses or payments of this day were changed after it was closed. See the log below. Reopen and close the day again to update it.</small></span></div>';
      if(reo)h+='<small>This day was reopened '+reo+' time'+(reo>1?'s':'')+' before. See the log below.</small>';
      h+=books(f)+'<h3>Result</h3>';
      if(v.cash!=null){
        h+=res('Cash',v.cash,f.ec)+res('Mobile Money',v.mc,f.em)+'<div class="stat wide"><small>Total result</small><span class="num '+(v.dv<0?'low':'')+'">'+dtxt(v.dv)+'</span></div>';
        if(r.mnc)h+='<small>Mobile Money was not counted. It was taken as expected.</small>';
        if(r.den){const t=DEN.filter(k=>r.den[k]).map(k=>fm(k)+' × '+r.den[k]);if(r.den.coin)t.push('coins '+fm(r.den.coin));if(t.length)h+='<h3>Notes and coins counted</h3><small>'+t.join(' · ')+'</small>'}
      }else h+=res('Money',r.cc,f.et);
      if(r.note)h+='<h3>Note</h3><div class="item" style="cursor:default"><span class="nm">'+esc(r.note)+'</span></div>';
      h+='<div class="stat wide"><small>Carried forward as tomorrow\'s opening money</small><span class="num">UGX '+fm(r.cc)+'</span></div>'
        +'<button class="btn big" onclick="okpCl.print(\''+d+'\')">🖨 Print (58mm)</button>'
        +'<button class="btn" onclick="okpCl.wa(\''+d+'\')">💬 Share on WhatsApp</button>'
        +'<button class="btn" onclick="X.closing(\''+d+'\',1)">📄 Share as PDF</button>'
        +'<button class="btn" onclick="X.closing(\''+d+'\',0)">⬇ Download PDF</button>'
        +'<button class="btn del" onclick="okpCl.reopen(\''+d+'\')">🔓 Reopen this day</button>'
        +'<small>This day is locked. Editing or deleting its receipts, expenses or payments asks for a confirmation and is written in the log.</small>';
    }else{
      const f=S.f=fig(d);
      h+='<div class="stat wide"><small>'+(reo?'REOPENED · ':'')+'NOT CLOSED · '+esc(fdt(d))+'</small><span class="num">Count the cash and close the day</span></div>'+books(f);
      if(dis)return h+'<div class="empty">A future day cannot be closed yet.</div>';
      h+='<h3>2 · Count the cash in the box</h3>'
        +DEN.map(k=>'<div class="den"><b>'+fm(k)+'</b><button onclick="okpCl.dn('+k+',-1)" aria-label="Less '+k+'">−</button><input id="dn'+k+'" type="number" inputmode="numeric" min="0" value="'+(S.den[k]||0)+'" oninput="okpCl.dset('+k+',this.value)" aria-label="Number of '+k+' notes"><button onclick="okpCl.dn('+k+',1)" aria-label="More '+k+'">+</button><small class="ds" id="ds'+k+'">= '+fm(k*(S.den[k]||0))+'</small></div>').join('')
        +'<label>Coins (total in UGX)</label><input id="dncoin" type="number" inputmode="numeric" min="0" value="'+esc(S.coin)+'" oninput="okpCl.coin(this.value)">'
        +'<label>Cash counted in the box (UGX) – the counter fills this in, or type it</label><input id="cc" type="number" inputmode="numeric" value="'+esc(S.cash)+'" oninput="okpCl.setCash(this.value)">'
        +'<div id="ccr"></div>'
        +'<h3>3 · Mobile Money balance</h3><label>Balance on the Mobile Money line now (UGX). Expected: '+fm(f.em)+'</label><input id="mc" type="number" inputmode="numeric" value="'+esc(S.mc)+'" oninput="okpCl.setMc(this.value)"><div id="mcr"></div>'
        +'<h3>4 · Close</h3><div id="tdr"></div>'
        +'<label>Closed by</label><input id="cby" list="cbyl" value="'+esc(S.by||(window.okpAcc&&okpAcc.name())||db.lastCb||db.lastSb||'')+'" oninput="okpCl.setBy(this.value)" placeholder="Your name"><datalist id="cbyl">'+[...new Set([...(db.staff||[]),db.shop&&db.shop.mgr].filter(Boolean))].map(n=>'<option value="'+esc(n)+'">').join('')+'</datalist>'
        +'<label>Note (optional)</label><input id="cnote" value="'+esc(S.note)+'" oninput="okpCl.setNote(this.value)" placeholder="e.g. 5,000 short, change given to a customer">'
        +'<button class="btn big" onclick="okpCl.close()">🔒 Close the day</button>'
        +'<small>The counted money becomes tomorrow\'s opening money. You can reopen the day later, and that is recorded.</small>';
      setTimeout(()=>{if(S.f)upd()},0);
    }
    const L=lg().filter(x=>x.date==d).sort((a,b)=>a.at<b.at?1:-1);
    if(L.length)h+='<h3>Log for this day</h3>'+L.map(logRow).join('');
    return h;
  }
  const ACT={close:'Closed',reopen:'REOPENED',unlock:'Edit confirmed',changed:'CHANGED after closing'};
  const logRow=x=>'<div class="item" style="cursor:default"><span class="nm"><b class="'+(x.act=='reopen'||x.act=='changed'?'low':'')+'">'+esc(ACT[x.act]||x.act)+'</b><small>'+esc(x.what||'')+'</small><small>'+esc(fdt(String(x.at).slice(0,10)))+' '+esc(new Date(x.at).toTimeString().slice(0,5))+' · '+esc(x.who||'')+'</small></span></div>';

  function doClose(){
    const d=S.d,f=S.f;
    if(!f||rec(d))return;
    if(d>td())return alert('A future day cannot be closed.');
    if(S.cash===''||isNaN(+S.cash))return alert('Count the cash or type the amount in the box first.');
    if(+S.cash<0)return alert('The cash counted cannot be negative.');
    if(S.mc!==''&&(isNaN(+S.mc)))return alert('Check the Mobile Money balance.');
    const by=String((($('#cby')&&$('#cby').value)||S.by||'')).trim();
    if(!by)return alert('Type who is closing the day.');
    const cash=+S.cash,blank=S.mc==='',mc=blank?f.em:+S.mc,dc=cash-f.ec,dm=mc-f.em,dv=dc+dm;
    const go=()=>{
      const den={};DEN.forEach(k=>{if(S.den[k])den[k]=+S.den[k]});if(+S.coin)den.coin=+S.coin;
      const later=db.C.some(c=>c.date>d);
      const r={id:id(),date:d,co:f.ot,cc:cash+mc,mo:f.om,mc,note:(S.note||'').trim(),cash,by,at:iso(),time:hhmm(),dc,dm,dv,f:{oc:f.oc,om:f.om,ot:f.ot,L:f.L,et:f.et,em:f.em,ec:f.ec}};
      if(Object.keys(den).length)r.den=den;if(blank)r.mnc=1;
      db.C.push(r);r.sig=sigs()[d];db.lastCb=by;
      log(d,'close','Closed. Cash counted '+fm(cash)+' (expected '+fm(f.ec)+') · Mobile Money '+fm(mc)+' (expected '+fm(f.em)+') · '+dtxt(dv),by);
      reset();save();render();toast('Day closed ✓');
      if(later)setTimeout(()=>alert('Later days are already closed. Their opening cash stays as it was recorded.'),300);
    };
    if(dv!==0)askc('The result is: '+dtxt(dv)+'.\n\nCash: '+dtxt(dc)+'\nMobile Money: '+dtxt(dm)+'\n\nClose the day with this result?',go);else go();
  }
  function reopen(d){
    const r=rec(d);if(!r)return;
    form('Reopen '+fdt(d),[['by','Your name','text'],['why','Reason for reopening','text']],{by:(window.okpAcc&&okpAcc.name())||db.lastCb||'',why:''},v=>{
      if(!v.by)return alert('Type your name.'),false;if(!v.why)return alert('Type the reason for reopening.'),false;
      const x=view(r);
      log(d,'reopen','Reopened because: '+v.why+'. It had been closed by '+(r.by||'?')+' at '+(r.time||'?')+' with cash counted '+fm(x.cash!=null?x.cash:r.cc)+' ('+dtxt(x.dv)+')'+(r.chg?'; records had changed after closing':'')+'.',v.by);
      db.C=db.C.filter(z=>z.id!=r.id);db.lastCb=v.by;
    });
  }

  /* ---------- print, WhatsApp ---------- */
  function print(d){
    const r=rec(d);if(!r)return;
    modal('<div id="rc"><div class="rcp p58">'+rch('DAILY CLOSING')+'<pre style="white-space:pre-wrap;font:11px/1.35 ui-monospace,Menlo,monospace;margin:0">'+esc(body(r))+'</pre>'+rcf()+'</div></div>'
      +'<button class="btn big" onclick="okpCl.p58()">🖨 Print</button><button class="btn" onclick="okpCl.wa(\''+d+'\')">💬 Share on WhatsApp</button><button class="btn" onclick="X.closing(\''+d+'\',1)">📄 Share as PDF</button><button class="btn" onclick="modal()">Close</button>');
  }
  function p58(){
    const s=document.createElement('style');s.id='pgs';s.textContent='@page{size:58mm auto;margin:0}';document.head.appendChild(s);document.body.classList.add('p58');
    window.onafterprint=()=>{const e=document.getElementById('pgs');if(e)e.remove();document.body.classList.remove('p58');window.onafterprint=null};
    window.print();
  }
  function wa(d){const r=rec(d);if(!r)return;window.open('https://wa.me/?text='+encodeURIComponent(fullText(r)),'_blank')}

  /* ---------- history of closings ---------- */
  const dOf=r=>view(r).dv;
  function rowsH(){
    const q=String(S.q||'').trim().toLowerCase();
    let L=db.C.slice().sort((a,b)=>a.date<b.date?1:-1);
    if(q)L=L.filter(r=>(r.date+' '+fdt(r.date)+' '+(r.by||'')+' '+(r.note||'')).toLowerCase().includes(q));
    if(S.flt=='short')L=L.filter(r=>dOf(r)<0);else if(S.flt=='over')L=L.filter(r=>dOf(r)>0);else if(S.flt=='ok')L=L.filter(r=>dOf(r)==0);
    const sh=sum(L.filter(r=>dOf(r)<0),dOf),ov=sum(L.filter(r=>dOf(r)>0),dOf);
    return'<div class="cards"><div class="stat"><small>Days shown</small><span class="num">'+L.length+'</span></div><div class="stat"><small>Total short</small><span class="num low">'+fm(-sh)+'</span></div><div class="stat"><small>Total over</small><span class="num ok">'+fm(ov)+'</span></div></div>'
      +(L.map(r=>{const v=dOf(r);return'<button class="item" onclick="okpCl.open(\''+r.date+'\')"><span class="nm"><b>'+esc(fdt(r.date))+'</b><small>Counted '+fm(r.cc)+(r.by?' · '+esc(r.by):'')+(r.time?' · '+esc(r.time):'')+'</small>'+(r.chg?'<small class="low">Changed after closing</small>':'')+(lg().some(x=>x.date==r.date&&x.act=='reopen')?'<small>Was reopened</small>':'')+'</span><span class="pr '+(v<0?'low':'ok')+'">'+(v==0?'Balanced':(v<0?'Short ':'Over ')+fm(Math.abs(v)))+'</span></button>'}).join('')||'<div class="empty">No closed days found</div>');
  }
  const hq=v=>{S.q=v;const e=$('#clh');if(e)e.innerHTML=rowsH()};
  const flt=v=>{S.flt=v;render()};
  function hist(){
    const F=[['all','All'],['short','Short'],['over','Over'],['ok','Balanced']];
    const L=lg().slice().sort((a,b)=>a.at<b.at?1:-1).slice(0,40);
    return'<button class="btn big" onclick="okpCl.open(td())" style="margin:0 0 10px">🔒 Close a day</button>'
      +'<input type="search" placeholder="Search by date (2026-11, 12 Nov), name or note" value="'+esc(S.q)+'" oninput="okpCl.hq(this.value)">'
      +'<div class="seg">'+F.map(([k,l])=>'<button class="'+(S.flt==k?'on':'')+'" onclick="okpCl.flt(\''+k+'\')">'+l+'</button>').join('')+'</div>'
      +'<div id="clh">'+rowsH()+'</div>'
      +'<h3>Closing log (latest 40)</h3>'+(L.map(x=>'<button class="item" onclick="okpCl.open(\''+x.date+'\')"><span class="nm"><b class="'+(x.act=='reopen'||x.act=='changed'?'low':'')+'">'+esc(ACT[x.act]||x.act)+' · '+esc(fdt(x.date))+'</b><small>'+esc(x.what||'')+'</small><small>'+esc(new Date(x.at).toLocaleString('en-GB'))+' · '+esc(x.who||'')+'</small></span></button>').join('')||'<div class="empty">Nothing in the log yet</div>');
  }

  /* ---------- Home warning ---------- */
  function active(d){return db.S.some(s=>s.date==d||(s.pays||[]).some(p=>p.d==d))||db.X.some(x=>x.date==d)||db.U.some(u=>u.date==d||(u.pays||[]).some(p=>p.d==d))||db.A.some(a=>a.date==d)||db.M.some(m=>m.date==d)||(db.R||[]).some(r=>!r.rev&&r.date==d)}
  function homeWarn(){
    try{
      const y=addd(td(),-1);if(rec(y)||!active(y))return '';
      let n=0;for(let i=2;i<=7;i++){const x=addd(td(),-i);if(!rec(x)&&active(x))n++}
      return'<button class="item" style="border-color:var(--bad)" onclick="okpCl.open(\''+y+'\')"><span class="nm"><b class="low">Yesterday was not closed</b><small>'+esc(fdt(y))+' · tap to count the cash and close it'+(n?' · '+n+' earlier day'+(n>1?'s':'')+' also not closed':'')+'</small></span><span class="pr low">Close</span></button>';
    }catch(e){return ''}
  }
  const card=()=>{const t=td(),r=rec(t);return{r,t}};

  V.close=()=>page();
  V.cls=()=>hist();
  window.okpCl={page,hist,open,setD,step,dn,dset,coin,setCash,setMc,setNote,setBy,close:doClose,reopen,print,p58,wa,hq,flt,homeWarn,guard,rec,fig,view,body,fullText,sigs,watch,log,card,DEN};
  hook();
  setTimeout(watch,800);
})();
