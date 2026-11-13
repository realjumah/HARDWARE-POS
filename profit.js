/* Okpotani PROFIT REPORT.
 *
 * Uses the same formulas as the Daily and Monthly reports in index.html, so the figures always agree with them:
 *   net sales      = sum of receipts (price used x quantity, i.e. AFTER any discount given) - value of returns
 *   cost of goods  = sum of cost on those receipts - cost of returned goods that went back to stock
 *                    (damaged goods that were returned keep their cost: it is a loss)
 *   gross profit   = net sales - cost of goods              net profit = gross profit - expenses
 * Credit receipts are shown separately as money still owed, and the profit is also shown on a CASH-COLLECTED basis:
 *   only money really received in the period counts; for credit receipts the profit is counted in proportion to what was paid.
 * Nothing is saved: the report is worked out from the receipts, returns and expenses every time it is opened.
 */
(function(){
  'use strict';
  const S={per:'month',from:'',to:'',tab:'day',sort:'best',all:false,tgt:15};
  try{const t=+localStorage.getItem('okp_pf_target');if(t>0&&t<100)S.tgt=t}catch(e){}
  const pc=(a,b)=>b>0?Math.round(a/b*1000)/10:0;
  const pcs=(a,b)=>b>0?(Math.round(a/b*1000)/10).toFixed(1)+'%':'–';
  const mon=d=>{const x=new Date(d+'T00:00:00'),k=(x.getDay()+6)%7;return addd(d,-k)};
  const lbl=d=>new Date(d+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  const sl=d=>new Date(d+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'});

  function range(){
    const t=td();let f,e;
    if(S.per=='day'){f=e=t}
    else if(S.per=='week'){f=mon(t);e=t}
    else if(S.per=='month'){f=t.slice(0,8)+'01';e=t}
    else{f=S.from||t.slice(0,8)+'01';e=S.to||t}
    if(f>e){const x=f;f=e;e=x}
    return[f,e];
  }

  /* ---------- all the figures for a period ---------- */
  function calc(from,to){
    const inR=d=>d>=from&&d<=to;
    const ss=db.S.filter(s=>inR(s.date)),rr=rets().filter(r=>inR(r.date)),xs=db.X.filter(x=>inR(x.date));
    const P=Object.fromEntries(db.P.map(p=>[p.name,p]));
    const gross=sum(ss,tot),retV=sum(rr,rtv),sales=gross-retV,cogG=sum(ss,cogs),retC=sum(rr,rtc),cg=cogG-retC;
    const gp=sales-cg,exp=sum(xs,x=>x.amt),net=gp-exp;

    // expenses by category
    const eg={};xs.forEach(x=>{const k=x.type||'Other';eg[k]=(eg[k]||0)+x.amt});
    const expCat=Object.entries(eg).map(([n,v])=>({n,v})).sort((a,b)=>b.v-a.v);

    // discounts: receipts priced below today's list price (profit is already after the discount)
    let disc=0;const below=[];
    ss.forEach(s=>s.items.forEach(i=>{const p=P[i.n];if(p&&p.price>i.p)disc+=(p.price-i.p)*i.q;if(i.p<i.c)below.push({n:i.n,no:s.no,date:s.date,q:i.q,p:i.p,c:i.c,loss:(i.c-i.p)*i.q})}));

    // credit: shown on its own
    const cs=ss.filter(s=>s.pay=='Credit');
    const credGiven=sum(cs,tot),credOwed=sum(cs,s=>Math.max(0,tot(s)-paid(s)));
    const credPaid=sum(cs,s=>(s.pays||[]).reduce((a,p)=>a+p.a,0)+(s.advA||0)),credRet=sum(cs,rdec);

    // cash-collected basis
    const mg=s=>{const t=tot(s);return t>0?(t-cogs(s))/t:0};
    let cashSales=0,cashGP=0;
    db.S.forEach(s=>{
      if(s.pay!='Credit'){if(inR(s.date)){cashSales+=tot(s);cashGP+=tot(s)-cogs(s)}return}
      const col=(s.pays||[]).reduce((a,p)=>a+(inR(p.d)?p.a:0),0)+(inR(s.date)?(s.advA||0):0);
      cashSales+=col;cashGP+=col*mg(s);
    });
    rr.forEach(z=>{const v=rtv(z),back=(z.cash||0)+(z.momo||0)+(z.exch||0);if(v>0&&back>0){const sh=Math.min(1,back/v);cashSales-=back;cashGP-=(v-rtc(z))*sh}});
    cashSales=Math.round(cashSales);cashGP=Math.round(cashGP);
    const cashNet=cashGP-exp;

    // day by day (same formulas as pl(day))
    const by=(arr,k)=>{const m={};arr.forEach(r=>{(m[r[k]]=m[r[k]]||[]).push(r)});return m},sd=by(ss,'date'),rd=by(rr,'date'),xd=by(xs,'date');
    const dates=[...new Set([...Object.keys(sd),...Object.keys(rd),...Object.keys(xd)])].sort();
    const days=dates.map(d=>{const a=sd[d]||[],b=rd[d]||[],c=xd[d]||[],t=sum(a,tot)-sum(b,rtv),k=sum(a,cogs)-sum(b,rtc),e=sum(c,x=>x.amt);
      return{d,n:a.length,t,c:k,g:t-k,e,net:t-k-e,cr:sum(a.filter(s=>s.pay=='Credit'),tot)}});

    // by product and category (same as the monthly report)
    const pp={};
    ss.forEach(s=>s.items.forEach(i=>{const r=pp[i.n]||(pp[i.n]={q:0,s:0,c:0});r.q+=i.q;r.s+=i.q*i.p;r.c+=i.q*i.c}));
    rr.forEach(z=>z.items.forEach(i=>{const r=pp[i.n]||(pp[i.n]={q:0,s:0,c:0});r.q-=i.q;r.s-=i.q*i.p;r.c-=i.back?i.q*i.c:0}));
    const prod=Object.entries(pp).map(([n,r])=>{const p=P[n]||{},prof=r.s-r.c,cost=p.name?costNow(p):(r.q?r.c/r.q:0);
      return{n,cat:p.cat||'Other',unit:p.unit||'',q:r.q,s:r.s,c:r.c,p:prof,m:pc(prof,r.s),avg:r.q?r.s/r.q:0,cost,list:p.price||0}});
    const cg2={};prod.forEach(r=>{const k=cg2[r.cat]||(cg2[r.cat]={n:r.cat,s:0,c:0,p:0,items:0});k.s+=r.s;k.c+=r.c;k.p+=r.p;k.items++});
    const cat=Object.values(cg2).map(r=>({...r,m:pc(r.p,r.s)}));

    return{from,to,n:ss.length,gross,retV,rn:rr.length,sales,cogG,retC,cogs:cg,gp,gm:pc(gp,sales),exp,expCat,net,nm:pc(net,sales),
      disc,below,credGiven,credPaid,credRet,credOwed,cashSales,cashGP,cashNet,days,prod,cat,
      refunds:sum(rr,z=>(z.cash||0)+(z.momo||0))};
  }
  const cur=()=>{const[f,t]=range();return calc(f,t)};

  /* ---------- chart: sales against profit ---------- */
  function buckets(days,from,to){
    const n=Math.round((new Date(to)-new Date(from))/864e5)+1;
    let key,name;
    if(n<=45){key=d=>d;name=d=>sl(d)}
    else if(n<=250){key=d=>mon(d);name=d=>sl(d)}
    else{key=d=>d.slice(0,7);name=d=>new Date(d+'-01T00:00:00').toLocaleDateString('en-GB',{month:'short',year:'2-digit'})}
    const m={};
    if(n<=45){for(let d=from;d<=to;d=addd(d,1))m[d]={k:d,t:0,net:0}}
    days.forEach(x=>{const k=key(x.d),b=m[k]||(m[k]={k,t:0,net:0});b.t+=x.t;b.net+=x.net});
    return{B:Object.values(m).sort((a,b)=>a.k<b.k?-1:1),name:n>250?name:(k=>name(k)),weekly:n>45&&n<=250};
  }
  function chart(D){
    if(!D.days.length)return'<div class="empty">No sales or expenses in this period</div>';
    const{B,name,weekly}=buckets(D.days,D.from,D.to),W=640,H=240,l=52,r=8,t=14,b=34,iw=W-l-r,ih=H-t-b;
    const mx=Math.max(1,...B.map(x=>Math.max(x.t,x.net))),mn=Math.min(0,...B.map(x=>x.net)),rg=mx-mn||1;
    const y=v=>t+(mx-v)/rg*ih,bw=iw/B.length,bar=Math.min(18,bw*.38),f0=y(0);
    const short=v=>{const a=Math.abs(v);return(v<0?'-':'')+(a>=1e6?(a/1e6).toFixed(a>=1e7?0:1)+'M':a>=1e3?Math.round(a/1e3)+'k':Math.round(a))};
    let s='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;display:block" role="img" aria-label="Sales and profit by day">';
    [0,.5,1].forEach(q=>{const v=mn+rg*q,yy=y(v);s+='<line x1="'+l+'" x2="'+(W-r)+'" y1="'+yy+'" y2="'+yy+'" stroke="var(--line)" stroke-width="1"/><text x="'+(l-6)+'" y="'+(yy+4)+'" text-anchor="end" font-size="11" fill="var(--mut)">'+short(v)+'</text>'});
    const every=Math.ceil(B.length/8);
    B.forEach((x,i)=>{
      const cx=l+bw*i+bw/2,ts=y(Math.max(x.t,0)),np=y(x.net);
      s+='<rect x="'+(cx-bar-1)+'" y="'+ts+'" width="'+bar+'" height="'+Math.max(1,f0-ts)+'" rx="2" fill="var(--acc)"/>';
      s+='<rect x="'+(cx+1)+'" y="'+Math.min(np,f0)+'" width="'+bar+'" height="'+Math.max(1,Math.abs(f0-np))+'" rx="2" fill="'+(x.net<0?'var(--bad)':'var(--ok)')+'"/>';
      if(i%every==0)s+='<text x="'+cx+'" y="'+(H-b+16)+'" text-anchor="middle" font-size="11" fill="var(--mut)">'+(weekly?'wk ':'')+esc(name(x.k))+'</text>';
    });
    s+='<line x1="'+l+'" x2="'+(W-r)+'" y1="'+f0+'" y2="'+f0+'" stroke="var(--mut)" stroke-width="1"/>';
    s+='<rect x="'+l+'" y="'+(H-12)+'" width="10" height="10" rx="2" fill="var(--acc)"/><text x="'+(l+15)+'" y="'+(H-3)+'" font-size="11.5" fill="var(--ink)">Sales</text><rect x="'+(l+70)+'" y="'+(H-12)+'" width="10" height="10" rx="2" fill="var(--ok)"/><text x="'+(l+85)+'" y="'+(H-3)+'" font-size="11.5" fill="var(--ink)">Net profit'+(weekly?' (per week)':'')+'</text></svg>';
    return s;
  }

  /* ---------- screen ---------- */
  const sc=(l,v,c,x)=>'<div class="stat"><small>'+l+'</small><span class="num '+(c||'')+'">'+fm(v)+'</span>'+(x?'<small>'+x+'</small>':'')+'</div>';
  const ln=(a,b,c,sub)=>'<div class="item" style="cursor:default"><span class="nm"><b>'+esc(a)+'</b>'+(sub?'<small>'+sub+'</small>':'')+'</span><span class="pr '+(c||'')+'">'+b+'</span></div>';
  function tbl(h,rows){return'<div class="tw"><table><tr>'+h.map((x,i)=>'<th>'+x+'</th>').join('')+'</tr>'+rows.join('')+'</table></div>'}
  function tab(D){
    const T=S.tab;
    const tabs='<div class="seg tabs">'+[['day','Day by day'],['prod','Products'],['cat','Categories'],['low','Low margin']].map(([k,l])=>'<button class="'+(T==k?'on':'')+'" onclick="okpPf.tab(\''+k+'\')">'+l+'</button>').join('')+'</div>';
    let h=tabs;
    if(T=='day'){
      const tt=D.days.reduce((a,x)=>{a.n+=x.n;a.t+=x.t;a.g+=x.g;a.e+=x.e;a.net+=x.net;a.cr+=x.cr;return a},{n:0,t:0,g:0,e:0,net:0,cr:0});
      h+=D.days.length?tbl(['Day','Receipts','Sales','Gross profit','Expenses','Net profit','Credit given'],D.days.slice().reverse().map(x=>'<tr><td>'+sl(x.d)+'</td><td>'+x.n+'</td><td>'+fm(x.t)+'</td><td>'+fm(x.g)+'</td><td>'+fm(x.e)+'</td><td class="'+(x.net<0?'low':'')+'">'+fm(x.net)+'</td><td>'+fm(x.cr)+'</td></tr>').concat('<tr><td><b>Total</b></td><td><b>'+tt.n+'</b></td><td><b>'+fm(tt.t)+'</b></td><td><b>'+fm(tt.g)+'</b></td><td><b>'+fm(tt.e)+'</b></td><td class="'+(tt.net<0?'low':'')+'"><b>'+fm(tt.net)+'</b></td><td><b>'+fm(tt.cr)+'</b></td></tr>')):'<div class="empty">No sales or expenses in this period</div>';
    }else if(T=='prod'){
      const L=D.prod.slice().sort((a,b)=>S.sort=='best'?b.p-a.p:a.p-b.p),shown=S.all?L:L.slice(0,15);
      h+='<div class="seg"><button class="'+(S.sort=='best'?'on':'')+'" onclick="okpPf.sort(\'best\')">Best earners first</button><button class="'+(S.sort=='worst'?'on':'')+'" onclick="okpPf.sort(\'worst\')">Worst earners first</button></div>';
      h+=L.length?tbl(['Product','Qty','Sales','Profit','Margin'],shown.map(r=>'<tr><td>'+esc(r.n)+'</td><td>'+(Math.round(r.q*100)/100)+'</td><td>'+fm(r.s)+'</td><td class="'+(r.p<0?'low':'')+'">'+fm(r.p)+'</td><td class="'+(r.m<0?'low':'')+'">'+r.m.toFixed(1)+'%</td></tr>'))+(L.length>15?'<button class="btn" onclick="okpPf.all()">'+(S.all?'Show only 15':'Show all '+L.length+' products')+'</button>':''):'<div class="empty">No products sold in this period</div>';
    }else if(T=='cat'){
      const L=D.cat.slice().sort((a,b)=>b.p-a.p),tp=sum(L,r=>Math.max(r.p,0));
      h+=L.length?tbl(['Category','Sales','Profit','Margin','Share'],L.map(r=>'<tr><td>'+esc(r.n)+'</td><td>'+fm(r.s)+'</td><td class="'+(r.p<0?'low':'')+'">'+fm(r.p)+'</td><td>'+r.m.toFixed(1)+'%</td><td>'+(r.p>0&&tp>0?Math.round(r.p/tp*100)+'%':'–')+'</td></tr>')):'<div class="empty">No sales in this period</div>';
    }else{
      const g=S.tgt,L=D.prod.filter(r=>r.s>0&&r.q>0).sort((a,b)=>a.m-b.m).slice(0,25);
      h+='<label>Target margin % (profit as a share of the selling price)</label><input type="number" inputmode="decimal" min="1" max="90" value="'+g+'" onchange="okpPf.tgt(this.value)">';
      h+=L.length?'<small>The lowest margins first. "Price for target" = latest cost price ÷ (1 − target), rounded up to the next UGX 100.</small>'+L.map(r=>{
        const sg=r.cost>0?Math.ceil(r.cost/(1-g/100)/100)*100:0;
        return'<div class="item" style="cursor:default"><span class="nm"><b>'+esc(r.n)+'</b><small>Sold at avg '+fm(r.avg)+' · cost '+fm(r.cost)+' · list price '+fm(r.list)+'</small>'+(r.m<g&&sg?'<small class="low">Price for '+g+'%: UGX '+fm(sg)+'</small>':'<small class="ok">Meets the target</small>')+'</span><span class="pr '+(r.m<0?'low':r.m<g?'low':'ok')+'">'+r.m.toFixed(1)+'%</span></div>';
      }).join(''):'<div class="empty">No sales in this period</div>';
      if(D.below.length)h+='<h3>Sold below cost ('+D.below.length+')</h3>'+D.below.slice(0,15).map(x=>ln(x.n,'−'+fm(x.loss),'low','Receipt #'+x.no+' · '+sl(x.date)+' · '+x.q+' × '+fm(x.p)+' (cost '+fm(x.c)+')')).join('');
    }
    return h;
  }
  function page(){
    const[f,t]=range(),D=calc(f,t),P=S.per;
    const seg='<div class="seg tabs">'+[['day','Today'],['week','This week'],['month','This month'],['custom','Custom']].map(([k,l])=>'<button class="'+(P==k?'on':'')+'" onclick="okpPf.per(\''+k+'\')">'+l+'</button>').join('')+'</div>';
    const cu=P=='custom'?'<div class="cards"><div><label>From</label><input type="date" value="'+f+'" max="'+td()+'" onchange="okpPf.set(\'from\',this.value)"></div><div><label>To</label><input type="date" value="'+t+'" max="'+td()+'" onchange="okpPf.set(\'to\',this.value)"></div></div>':'';
    let h=seg+cu+'<small>'+(f==t?esc(lbl(f)):esc(lbl(f))+' – '+esc(lbl(t)))+' · '+D.n+' receipt'+(D.n==1?'':'s')+'</small>';
    h+='<div class="cards" style="margin-top:6px"><div class="stat wide"><small>NET PROFIT (sales earned, less expenses)</small><span class="num '+(D.net<0?'low':'')+'">UGX '+fm(D.net)+'</span><small>'+D.nm.toFixed(1)+'% of sales</small></div>'
      +sc('Total sales'+(D.retV>0?' (after returns)':''),D.sales)+sc('Cost of goods sold',D.cogs)
      +'<div class="stat wide"><small>GROSS PROFIT</small><span class="num '+(D.gp<0?'low':'')+'">UGX '+fm(D.gp)+'</span><small>'+D.gm.toFixed(1)+'% of sales</small></div>'
      +sc('Expenses',D.exp)+sc('Net profit',D.net,D.net<0?'low':'ok')+'</div>';
    if(D.retV>0||D.disc>0)h+='<h3>Discounts and returns</h3>'+(D.retV>0?ln('Returns & refunds ('+D.rn+')','−'+fm(D.retV),'low','Already taken off sales. Cost of goods put back in stock: '+fm(D.retC)+'. Refunded in cash / Mobile Money: '+fm(D.refunds)):'')+(D.disc>0?ln('Discounts given',fm(D.disc),'','Sales are already after discounts (price used below today\'s list price)'):'');
    h+='<h3>Expenses by category</h3>'+(D.expCat.length?D.expCat.map(x=>ln(x.n,fm(x.v),'')).join('')+ln('Total expenses',fm(D.exp),'low'):'<small>No expenses in this period</small>');
    h+='<h3>Credit and cash collected</h3>'
      +ln('Credit sales given',fm(D.credGiven),'','Receipts on credit in this period')
      +ln('Paid so far',fm(D.credPaid),'ok','Part-payments and advances used'+(D.credRet>0?' · reduced by returns '+fm(D.credRet):''))
      +ln('STILL OWED',fm(D.credOwed),D.credOwed>0?'low':'ok','Money customers still owe from these receipts')
      +'<div class="cards" style="margin-top:8px"><div class="stat wide"><small>Net profit on a cash-collected basis</small><span class="num '+(D.cashNet<0?'low':'')+'">UGX '+fm(D.cashNet)+'</span><small>Money really received in the period: UGX '+fm(D.cashSales)+' (incl. credit payments from older receipts). Profit on credit counts only as it is paid.</small></div></div>';
    h+='<h3>Sales against profit</h3><div class="stat" style="padding:8px 6px">'+chart(D)+'</div>';
    h+=tab(D);
    h+='<h3>Share or save</h3><button class="btn big" onclick="okpPf.xl()">⬇ Download Excel</button><button class="btn" onclick="X.profit(1)">📄 Share as PDF</button><button class="btn" onclick="X.profit(0)">⬇ Download PDF</button><button class="btn" onclick="okpPf.wa()">💬 Share summary on WhatsApp</button>';
    return h;
  }

  /* ---------- actions ---------- */
  const per=k=>{S.per=k;if(k=='custom'&&!S.from){S.from=td().slice(0,8)+'01';S.to=td()}render()};
  const set=(k,v)=>{S[k]=v;render()};
  const tabF=k=>{S.tab=k;S.all=false;render()};
  const sort=k=>{S.sort=k;render()};
  const all=()=>{S.all=!S.all;render()};
  const tgt=v=>{v=+v;if(!(v>0&&v<100))return alert('Enter a target between 1 and 99.');S.tgt=v;try{localStorage.setItem('okp_pf_target',v)}catch(e){}render()};

  function text(D){
    D=D||cur();
    const L=['*'+db.shop.name+'*','*PROFIT REPORT*',(D.from==D.to?lbl(D.from):lbl(D.from)+' – '+lbl(D.to)),''];
    L.push('Total sales: UGX '+fm(D.sales)+(D.retV>0?' (after returns '+fm(D.retV)+')':''),'Cost of goods: UGX '+fm(D.cogs),'*GROSS PROFIT: UGX '+fm(D.gp)+' ('+D.gm.toFixed(1)+'%)*','Expenses: UGX '+fm(D.exp));
    D.expCat.slice(0,8).forEach(x=>L.push('  - '+x.n+': '+fm(x.v)));
    L.push('*NET PROFIT: UGX '+fm(D.net)+'*','');
    L.push('Credit given: UGX '+fm(D.credGiven),'Still owed: UGX '+fm(D.credOwed),'Net profit, cash collected: UGX '+fm(D.cashNet),'');
    const b=D.prod.slice().sort((x,y)=>y.p-x.p).filter(r=>r.p>0).slice(0,3),wst=D.prod.slice().sort((x,y)=>x.p-y.p).filter(r=>r.p<0||r.m<5).slice(0,3);
    if(b.length){L.push('Best earners:');b.forEach(r=>L.push('  - '+r.n+': '+fm(r.p)+' ('+r.m.toFixed(0)+'%)'))}
    if(wst.length){L.push('Lowest earners:');wst.forEach(r=>L.push('  - '+r.n+': '+fm(r.p)+' ('+r.m.toFixed(0)+'%)'))}
    if(db.shop.tel)L.push('','Tel: '+db.shop.tel);
    return L.join('\n');
  }
  const wa=()=>window.open('https://wa.me/?text='+encodeURIComponent(text()),'_blank');

  function wbook(D){
    D=D||cur();
    const ser=s=>{const[y,o,d]=s.split('-').map(Number);return{t:'n',v:Math.round(Date.UTC(y,o-1,d)/864e5)+25569,z:'dd-mmm-yyyy'}},pcv=v=>({t:'n',v:v/100,z:'0.0%'});
    const mk=(t,rows)=>{const ws=XLSX.utils.aoa_to_sheet([[t],[db.shop.name+' · '+D.from+' to '+D.to],[],...rows]);ws['!cols']=Array(8).fill({wch:20});return ws};
    const sm=[['Item','UGX'],['Receipts (count)',D.n],['Sales before returns',D.gross],['Returns & refunds',-D.retV],['TOTAL SALES (net)',D.sales],['Cost of goods sold',D.cogs],['GROSS PROFIT',D.gp],['Gross margin %',pcv(D.gm)],['Expenses',D.exp],['NET PROFIT',D.net],['Net margin %',pcv(D.nm)],[],
      ['Discounts given (below today\'s list price)',D.disc],[],['Credit sales given',D.credGiven],['Paid so far',D.credPaid],['Reduced by returns',D.credRet],['STILL OWED',D.credOwed],[],['Money received in the period (cash basis)',D.cashSales],['Gross profit, cash collected',D.cashGP],['Net profit, cash collected',D.cashNet]];
    const dy=[['Date','Receipts','Sales (after returns)','Cost of goods','Gross profit','Expenses','Net profit','Credit given'],...D.days.map(x=>[ser(x.d),x.n,x.t,x.c,x.g,x.e,x.net,x.cr]),['TOTAL',sum(D.days,x=>x.n),sum(D.days,x=>x.t),sum(D.days,x=>x.c),sum(D.days,x=>x.g),sum(D.days,x=>x.e),sum(D.days,x=>x.net),sum(D.days,x=>x.cr)]];
    const pr=[['Product','Category','Unit','Qty sold','Sales','Cost of goods','Profit','Margin %','Latest cost','List price'],...D.prod.slice().sort((a,b)=>b.p-a.p).map(r=>[r.n,r.cat,r.unit,r.q,r.s,r.c,r.p,pcv(r.m),Math.round(r.cost),r.list])];
    const ct=[['Category','Products','Sales','Cost of goods','Profit','Margin %'],...D.cat.slice().sort((a,b)=>b.p-a.p).map(r=>[r.n,r.items,r.s,r.c,r.p,pcv(r.m)])];
    const lw=[['Product','Margin %','Average selling price','Latest cost','List price','Price for target '+S.tgt+'%'],...D.prod.filter(r=>r.s>0&&r.q>0).sort((a,b)=>a.m-b.m).map(r=>[r.n,pcv(r.m),Math.round(r.avg),Math.round(r.cost),r.list,r.cost>0?Math.ceil(r.cost/(1-S.tgt/100)/100)*100:''])];
    const ex=[['Expense category','UGX'],...D.expCat.map(x=>[x.n,x.v]),['TOTAL',D.exp]];
    const ow=[['Customer','Receipt','Date','Total','Still owed']];
    db.S.filter(s=>s.pay=='Credit'&&s.date>=D.from&&s.date<=D.to&&tot(s)-paid(s)>0).sort((a,b)=>a.date<b.date?-1:1).forEach(s=>ow.push([s.cust||'(no name)','#'+s.no,ser(s.date),tot(s),tot(s)-paid(s)]));
    const wb=XLSX.utils.book_new();
    [['Summary','Profit Report',sm],['Day by day','Sales and Profit by Day',dy],['Products','Profit by Product',pr],['Categories','Profit by Category',ct],['Low margin','Margins, lowest first',lw],['Expenses','Expenses by Category',ex],['Credit owed','Credit receipts still owed',ow]].forEach(([n,t,r])=>XLSX.utils.book_append_sheet(wb,mk(t,r),n));
    return wb;
  }
  function xl(){try{const D=cur();XLSX.writeFile(wbook(D),'Okpotani-Profit-'+D.from+'-to-'+D.to+'.xlsx')}catch(e){alert('Excel export failed: '+e.message)}}

  V.profit=()=>page();
  window.okpPf={page,calc,cur,data:cur,range,text,wa,xl,wbook,chart,buckets,per,set,tab:tabF,sort,all,tgt,S};
})();
