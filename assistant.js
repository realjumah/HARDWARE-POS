/* assistant.js - the shop assistant (works on the phone, no internet needed).
 *   Type a request in plain words. It reads YOUR stock, sales, expenses and debts and answers.
 *   It understands: restock plans from a budget, prices, best and slow sellers, low stock, debts,
 *   sales / profit for today, week or month, expenses and cash.
 *   It is built-in logic, not an online AI service, so it only answers the topics above.
 *   Page: go('ai')    Plan as PDF: X.planPdf(plan, share)
 */
(function(){
'use strict';
const AI=window.AI={msgs:[],last:null};
const E=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num=x=>Math.round(x||0).toLocaleString('en-US');
const rnd=(x,d)=>{const k=Math.pow(10,d||0);return Math.round(x*k)/k};

/* ---------- reading what the person typed ---------- */
function money(s){const re=/(\d[\d,]*(?:\.\d+)?)\s*(billion|bn|million|mil|mn|thousand|k|m|b)?(?![a-z])/gi;let m,best=null;
 while((m=re.exec(s))){let v=parseFloat(m[1].replace(/,/g,''));const u=(m[2]||'').toLowerCase();
  if(/^(billion|bn|b)$/.test(u))v*=1e9;else if(/^(million|mil|mn|m)$/.test(u))v*=1e6;else if(/^(thousand|k)$/.test(u))v*=1e3;
  if(v>=10000&&(best===null||v>best))best=v}
 return best}
function daysIn(s,def){const m=s.match(/(\d+)\s*(day|days|week|weeks|month|months|year|years)/);if(m){const n=+m[1],u=m[2];return u[0]=='d'?n:u[0]=='w'?n*7:u[0]=='m'?n*30:n*365}
 if(/\bweek\b/.test(s))return 7;if(/\bmonth\b/.test(s))return 30;if(/\byear\b/.test(s))return 365;return def}
function period(s){const t=td(),d=new Date();
 if(/today/.test(s))return{from:t,to:t,label:'today'};
 if(/yesterday/.test(s)){const y=new Date(d-864e5).toISOString().slice(0,10);return{from:y,to:y,label:'yesterday'}}
 if(/this week|past week|last 7|week/.test(s)){return{from:new Date(d-6*864e5).toISOString().slice(0,10),to:t,label:'the last 7 days'}}
 if(/year/.test(s))return{from:t.slice(0,4)+'-01-01',to:t,label:'this year'};
 if(/last month/.test(s)){const p=new Date(d.getFullYear(),d.getMonth()-1,1),k=p.getFullYear()+'-'+String(p.getMonth()+1).padStart(2,'0');return{from:k+'-01',to:k+'-31',label:'last month'}}
 const k=t.slice(0,7);return{from:k+'-01',to:k+'-31',label:'this month'}}

/* ---------- facts from the records ---------- */
const stockMap=()=>stk();
function costOf(p){const c=costNow(p);return c>0?c:(p.price>0?p.price*0.75:0)}
function sold(from,to){const m={};db.S.forEach(s=>{if(s.date<from||s.date>to)return;s.items.forEach(i=>{const r=m[i.n]||(m[i.n]={q:0,v:0,p:0});r.q+=i.q;r.v+=i.q*i.p;r.p+=i.q*(i.p-i.c)})});return m}
function firstSale(){return db.S.reduce((a,s)=>!a||s.date<a?s.date:a,'')}
function ago(n){return new Date(Date.now()-n*864e5).toISOString().slice(0,10)}
function findProducts(s){const stop=/\b(price|prices|cost|costs|how|much|is|are|the|a|an|of|for|what|whats|what's|does|do|per|bag|one|1|check|tell|me|please|selling|sell|sells|at)\b/g;
 const w=s.replace(/[?!.,]/g,' ').replace(stop,' ').trim().split(/\s+/).filter(x=>x.length>1);if(!w.length)return[];
 const hit=db.P.filter(p=>{const t=(p.name+' '+(p.code||'')+' '+(p.cat||'')).toLowerCase();return w.every(k=>t.includes(k))});
 return hit.length?hit:db.P.filter(p=>{const t=(p.name+' '+(p.code||'')+' '+(p.cat||'')).toLowerCase();return w.some(k=>k.length>3&&t.includes(k))})}

/* ---------- the restock planner ---------- */
function plan(budget,cover,all,force){
 const win=90,fs=firstSale(),since=fs?Math.max(1,Math.round((Date.now()-new Date(fs+'T00:00:00'))/864e5)+1):win,eff=Math.max(7,Math.min(win,since)),S=sold(ago(eff),td()),m=stockMap();
 const items=db.P.filter(p=>p.name).map(p=>{const sa=S[p.name]||{q:0,v:0,p:0},c=costOf(p);return{p,n:p.name,c,vel:sa.q/eff,sold:sa.q,val:sa.v,pf:sa.p,stock:m[p.name]||0,qty:0,cap:0}});
 const ok=items.filter(x=>x.c>0),skipped=items.filter(x=>!(x.c>0));
 ok.sort((a,b)=>(b.val-a.val)||(b.pf-a.pf));
 let R=budget,short=0;
 /* step 1: one of everything, best sellers first, so every product is on the order */
 if(all)for(const x of ok){if(R>=x.c){x.qty=1;R-=x.c}else short++}
 /* step 2: spread the rest by how well each product sells, within a sensible limit that grows only if money is left */
 const tv=ok.reduce((a,x)=>a+x.val,0)||1;ok.forEach(x=>{x.w=x.val+0.004*tv});
 let cov=cover;
 for(let round=0;round<6;round++){
  ok.forEach(x=>{x.cap=force?1e9:Math.max(x.qty,Math.ceil(x.vel*cov+(x.p.re||0))-Math.floor(Math.max(0,x.stock)))});
  for(let it=0;it<8;it++){const open=ok.filter(x=>x.qty<x.cap);if(!open.length||R<1)break;const W=open.reduce((a,x)=>a+x.w,0);let spent=0;
   open.forEach(x=>{const add=Math.min(Math.floor(R*x.w/W/x.c),x.cap-x.qty);if(add>0){x.qty+=add;spent+=add*x.c}});
   if(spent<=0)break;R-=spent}
  const open=ok.filter(x=>x.qty<x.cap).sort((a,b)=>b.w/b.c-a.w/a.c);let went=true;
  while(went){went=false;for(const x of open){if(x.qty<x.cap&&R>=x.c){x.qty++;R-=x.c;went=true}}}
  if(R<budget*0.03||cov>=365||force)break;cov*=2}
 const rows=ok.filter(x=>x.qty>0).map(x=>({n:x.n,stock:rnd(x.stock,1),sold:rnd(x.sold,1),qty:x.qty,c:x.c,cost:x.qty*x.c,days:x.vel>0?Math.round((Math.max(0,x.stock)+x.qty)/x.vel):0})).sort((a,b)=>b.cost-a.cost);
 const spent=rows.reduce((a,r)=>a+r.cost,0);
 return{budget,spent,left:budget-spent,rows,skipped:skipped.map(x=>x.n),short,eff,cover:cov,all,force:!!force,count:db.P.length,req:cover}}
function planHtml(p){let h='<div class="aib-s"><b>Restock plan for UGX '+num(p.budget)+'</b></div>';
 h+='<ul><li>Planned spending: <b>UGX '+num(p.spent)+'</b> ('+Math.round(p.spent/p.budget*100)+'% of your money)</li><li>Unspent: <b>UGX '+num(p.left)+'</b></li><li>Products on the order: <b>'+p.rows.length+'</b> of '+p.count+'</li><li>Based on your sales of the last '+p.eff+' days, with a buying cap of about '+p.cover+' days of sales per product.</li></ul>';
 if(p.short)h+='<p class="aiw2">Your money was not enough to buy even one of every product. '+p.short+' lower-selling products were left out.</p>';
 if(p.force)h+='<p class="aiw2">You asked me to use your money anyway, so products that sell best take most of the extra. Their stock may last many months. Check storage space and your supplier terms first.</p>';
 if(p.left>p.budget*0.1&&!p.force)h+='<p class="aiw2">About UGX '+num(p.left)+' could not be used sensibly: buying more than about '+p.cover+' days of sales of any product would tie up money in slow stock. Raise the days (for example "for 8 months") if you still want to spend it all.</p><div class="aiact"><button class="btn" onclick="AI.force()">💰 Use all my money anyway</button></div>';
 if(p.cover>120)h+='<p class="aiw2">Your budget is large compared with your sales, so this plan covers up to about '+p.cover+' days of sales. Check storage space and how fast each item really sells before buying.</p>';
 if(p.skipped.length)h+='<p class="aiw2">Skipped because they have no cost or selling price: '+E(p.skipped.slice(0,8).join(', '))+(p.skipped.length>8?' and '+(p.skipped.length-8)+' more':'')+'.</p>';
 h+='<div class="tw"><table><tr><th>Product</th><th>Buy</th><th>Cost (UGX)</th></tr>'+p.rows.map(r=>'<tr><td>'+E(r.n)+'<small style="display:block;color:var(--mut)">in stock '+r.stock+' · sold '+r.sold+' · @ '+num(r.c)+'</small></td><td><b>'+r.qty+'</b></td><td>'+num(r.cost)+'</td></tr>').join('')+'<tr><td colspan="2"><b>Total</b></td><td><b>'+num(p.spent)+'</b></td></tr></table></div>';
 h+='<div class="aiact"><button class="btn" onclick="AI.copy()">📋 Copy list</button><button class="btn" onclick="AI.pdf(true)">📄 Share as PDF</button><button class="btn" onclick="AI.pdf(false)">⬇ Download PDF</button></div><small>This is a suggestion from your own sales records. It does not record any purchase. Check prices with your supplier before you buy.</small>';
 return h}

/* ---------- answers ---------- */
function help(){return '<b>I can help with:</b><ul><li><b>Restock plan:</b> "I have 50 million shillings, plan my restock" (add "for 3 months" to change the buying limit)</li><li><b>Prices:</b> "price of cement"</li><li><b>Best sellers:</b> "best selling products this month"</li><li><b>Slow sellers:</b> "what is not selling?"</li><li><b>Low stock:</b> "what is running low?"</li><li><b>Debts:</b> "who owes me money?"</li><li><b>Sales and profit:</b> "sales today", "profit this week"</li><li><b>Expenses and cash:</b> "expenses this month", "cash in the box"</li></ul><small>I read your own records on this phone. I only understand these topics.</small>'}
function answer(q){const s=q.toLowerCase().replace(/\s+/g,' ').trim();if(!s)return help();
 const amt=money(q);
 if(amt&&/(stock|restock|buy|purchase|order|spend|invest|plan)/.test(s)){const cover=daysIn(s,60),all=!/(only|just)\b/.test(s)||/all product|every product|each product|at least/.test(s);const p=plan(amt,cover,true);AI.last=p;AI.args={budget:amt,cover};return planHtml(p)}
 if(/(price|how much|cost of|costs|selling for|sell for)/.test(s)&&!/(sales|profit|expense)/.test(s)){const L=findProducts(s);
  if(!L.length)return 'I could not find that product. Try a shorter name, for example "price of cement".';
  const m=stockMap();return '<ul>'+L.slice(0,8).map(p=>'<li><b>'+E(p.name)+'</b>: UGX '+(p.price>0?num(p.price):'no selling price set')+' per '+E(p.unit||'unit')+' · '+rnd(m[p.name]||0,1)+' in stock</li>').join('')+'</ul>'+(L.length>8?'<small>and '+(L.length-8)+' more. Type more of the name to narrow it.</small>':'')}
 if(/(best sell|top sell|most sold|fast moving|fast-moving|best product|bestsell|popular)/.test(s)){let P=period(s),S=sold(P.from,P.to),a=Object.keys(S).sort((x,y)=>S[y].v-S[x].v).slice(0,10);
  if(!a.length){P={from:ago(30),to:td(),label:'the last 30 days (nothing sold in the period you asked for)'};S=sold(P.from,P.to);a=Object.keys(S).sort((x,y)=>S[y].v-S[x].v).slice(0,10)}
  if(!a.length)return 'No sales found yet.';
  return '<b>Best sellers, '+P.label+' (by sales value)</b><div class="tw"><table><tr><th>Product</th><th>Qty</th><th>Sales</th><th>Profit</th></tr>'+a.map(n=>'<tr><td>'+E(n)+'</td><td>'+rnd(S[n].q,1)+'</td><td>'+num(S[n].v)+'</td><td>'+num(S[n].p)+'</td></tr>').join('')+'</table></div>'}
 if(/(slow|not selling|dead stock|never sold|no sales|unsold)/.test(s)){const days=daysIn(s,60),S=sold(ago(days),td()),m=stockMap(),a=db.P.filter(p=>(m[p.name]||0)>0&&!S[p.name]).sort((x,y)=>(m[y.name]*costOf(y))-(m[x.name]*costOf(x))).slice(0,15);
  if(!a.length)return 'Every product in stock has sold in the last '+days+' days.';
  return '<b>In stock but not sold in '+days+' days</b> (money tied up, largest first)<div class="tw"><table><tr><th>Product</th><th>Stock</th><th>Value</th></tr>'+a.map(p=>'<tr><td>'+E(p.name)+'</td><td>'+rnd(m[p.name],1)+'</td><td>'+num(m[p.name]*costOf(p))+'</td></tr>').join('')+'</table></div>'}
 if(/(low stock|running low|run out|running out|reorder|finish|almost|out of stock|shortage)/.test(s)){const m=stockMap(),a=db.P.filter(p=>(m[p.name]||0)<=(p.re||0)).sort((x,y)=>(m[x.name]||0)-(m[y.name]||0));
  if(!a.length)return 'Nothing is at or below its reorder level.';
  return '<b>'+a.length+' products at or below their reorder level</b><div class="tw"><table><tr><th>Product</th><th>Stock</th><th>Reorder at</th></tr>'+a.slice(0,30).map(p=>'<tr><td>'+E(p.name)+'</td><td>'+rnd(m[p.name]||0,1)+'</td><td>'+(p.re||0)+'</td></tr>').join('')+'</table></div>'+(a.length>30?'<small>and '+(a.length-30)+' more.</small>':'')+'<small>Tell me how much money you have and I will plan the restock.</small>'}
 if(/(owe|debt|debtor|credit|who owes|unpaid|balance)/.test(s)){const g={};db.S.forEach(x=>{if(x.pay=='Credit'){const b=tot(x)-paid(x);if(b>0.5)g[x.cust||'(no name)']=(g[x.cust||'(no name)']||0)+b}});const a=Object.keys(g).sort((x,y)=>g[y]-g[x]),sup=db.U.reduce((t,u)=>t+(typeof sowed=='function'?sowed(u):0),0),tot2=a.reduce((t,n)=>t+g[n],0);
  return (a.length?'<b>Customers who owe: UGX '+num(tot2)+'</b><div class="tw"><table><tr><th>Customer</th><th>Owes</th></tr>'+a.slice(0,20).map(n=>'<tr><td>'+E(n)+'</td><td>'+num(g[n])+'</td></tr>').join('')+'</table></div>':'No customer owes you on credit.')+'<p>You owe suppliers: <b>UGX '+num(sup)+'</b></p>'}
 if(/(expense|spent|spending)/.test(s)){const P=period(s),L=db.X.filter(x=>x.date>=P.from&&x.date<=P.to),g={};L.forEach(x=>{g[x.type||'Other']=(g[x.type||'Other']||0)+x.amt});const a=Object.keys(g).sort((x,y)=>g[y]-g[x]);
  if(!a.length)return 'No expenses recorded for '+P.label+'.';return '<b>Expenses, '+P.label+': UGX '+num(L.reduce((t,x)=>t+x.amt,0))+'</b><div class="tw"><table><tr><th>Type</th><th>Amount</th></tr>'+a.map(k=>'<tr><td>'+E(k)+'</td><td>'+num(g[k])+'</td></tr>').join('')+'</table></div>'}
 if(/(cash in|cash box|cash book|how much cash|money in the box|expected cash)/.test(s)){try{const c=cbexp(td());return 'Expected cash in the box today: <b>UGX '+num(c.c)+'</b>'}catch(e){return 'I could not read the cash book.'}}
 if(/(stock value|value of stock|worth of stock|inventory)/.test(s)){const m=stockMap();let c=0,v=0;db.P.forEach(p=>{const q=Math.max(0,m[p.name]||0);c+=q*costOf(p);v+=q*(p.price||0)});return 'Stock is worth <b>UGX '+num(c)+'</b> at cost and <b>UGX '+num(v)+'</b> at selling prices (possible profit UGX '+num(v-c)+').'}
 if(/(sales|sold|sell|profit|income|revenue|made|earn|takings)/.test(s)){const P=period(s),L=db.S.filter(x=>x.date>=P.from&&x.date<=P.to),t=L.reduce((a,x)=>a+tot(x),0),c=L.reduce((a,x)=>a+x.items.reduce((b,i)=>b+i.q*i.c,0),0),e=db.X.filter(x=>x.date>=P.from&&x.date<=P.to).reduce((a,x)=>a+x.amt,0);
  return '<b>'+P.label[0].toUpperCase()+P.label.slice(1)+'</b><ul><li>Sales: <b>UGX '+num(t)+'</b> from '+L.length+' receipts</li><li>Gross profit: <b>UGX '+num(t-c)+'</b></li><li>Expenses: UGX '+num(e)+'</li><li>Net profit: <b>UGX '+num(t-c-e)+'</b></li></ul>'}
 return 'I did not understand that. '+help()}

/* ---------- actions on a plan ---------- */
AI.copy=function(){const p=AI.last;if(!p)return;const t='Restock plan - budget UGX '+num(p.budget)+'\n'+p.rows.map(r=>r.n+': buy '+r.qty+' @ '+num(r.c)+' = '+num(r.cost)).join('\n')+'\nTotal UGX '+num(p.spent);
 const done=()=>toast('List copied ✓');try{navigator.clipboard.writeText(t).then(done,()=>{window.prompt('Copy this list',t)})}catch(e){window.prompt('Copy this list',t)}};
AI.pdf=function(share){if(AI.last&&window.X&&X.planPdf)X.planPdf(AI.last,share);else alert('PDF is not available.')};

/* ---------- the page ---------- */
const CH=['I have 50 million shillings, plan my restock','Best selling products this month','What is running low?','Who owes me money?','Price of cement','Sales today','Expenses this month'];
AI.send=function(t){const i=document.getElementById('aiq');const q=(t!=null?t:(i?i.value:'')).trim();if(!q)return;
 AI.msgs.push({u:1,h:E(q)});let a;try{a=answer(q)}catch(e){console.error(e);a='Something went wrong while reading your records.'}AI.msgs.push({u:0,h:a});render();
 const mn=document.getElementById('mn');if(mn)mn.scrollTop=mn.scrollHeight};
AI.force=function(){const a=AI.args;if(!a)return;AI.msgs.push({u:1,h:'Use all my money anyway'});const p=plan(a.budget,a.cover,true,true);AI.last=p;AI.msgs.push({u:0,h:planHtml(p)});render();const mn=document.getElementById('mn');if(mn)mn.scrollTop=mn.scrollHeight};
AI.clear=function(){AI.msgs=[];AI.last=null;render()};
(function css(){if(document.getElementById('aistyle'))return;const s=document.createElement('style');s.id='aistyle';
 s.textContent='.aip .aih{margin:0 0 10px;color:var(--mut);font-size:.84rem}.aim{display:flex;flex-direction:column;gap:10px;margin-bottom:12px}'
 +'.aib{max-width:100%;padding:12px 14px;border-radius:18px;line-height:1.45;overflow-wrap:anywhere}.aib.u{align-self:flex-end;background:var(--acc);color:var(--accink);border-bottom-right-radius:6px;max-width:88%}'
 +'.aib.a{align-self:flex-start;background:var(--card);box-shadow:var(--shadow1,0 1px 3px #0002);border-bottom-left-radius:6px;width:100%}.aib ul{margin:6px 0 6px 18px;padding:0}.aib li{margin-bottom:4px}'
 +'.aib td,.aib th{white-space:normal;padding:8px 6px}.aib td:nth-child(n+2),.aib th:nth-child(n+2){white-space:nowrap;text-align:right}.aib .tw{overflow-x:visible}.aib-s{font-size:1.05rem;margin-bottom:4px}.aiw2{margin:8px 0;padding:8px 10px;border-radius:10px;background:var(--tint2,#fff1e4);font-size:.84rem}.aiact{display:grid;gap:6px;margin:10px 0 6px}'
 +'.aic{display:flex;gap:8px;overflow-x:auto;padding:2px 0 10px}.aic button{flex:none;border:1.5px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;padding:8px 12px;font-size:.8rem;font-weight:600;white-space:nowrap}'
 +'.aiw{padding:8px 0 4px}.aiw textarea{min-height:64px;margin:0 0 8px}';
 document.head.appendChild(s)})();
function page(){const m=AI.msgs.length?AI.msgs.map(x=>'<div class="aib '+(x.u?'u':'a')+'">'+x.h+'</div>').join(''):'<div class="aib a"><b>Hello! I am your shop assistant.</b><br>Ask me in plain words. For example: <i>"I have 50 million shillings and I want to restock based on my sales."</i>'+help().replace('<b>I can help with:</b>','<br><br><b>I can help with:</b>')+'</div>';
 return '<div class="aip"><h2>✨ Shop assistant</h2><p class="aih">Reads your own stock, sales and debts on this phone. Works without internet.</p>'
 +'<div class="aic">'+CH.map((c,i)=>'<button onclick="AI.send(AI.ch['+i+'])">'+E(c.length>34?c.slice(0,32)+'…':c)+'</button>').join('')+'</div>'
 +'<div class="aim">'+m+'</div>'
 +'<div class="aiw"><textarea id="aiq" rows="2" placeholder="Type your request, e.g. I have 50 million shillings, plan my restock"></textarea><button class="btn big" style="margin:0" onclick="AI.send()">Send</button>'+(AI.msgs.length?'<button class="btn" onclick="AI.clear()">Clear chat</button>':'')+'</div></div>'}
AI.ch=CH;
const reg=()=>{if(typeof V!=='undefined')V.ai=page};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',reg);else reg();
window.AIanswer=answer;window.AIplan=plan;
})();
