/* finder.js — search + filters inside the app.
 *  1) A filter bar (text + optional dates) appears on every long list page (Money, Reports, Farmers, Market ...).
 *  2) The round 🔍 button opens "Search everything": receipts, products, customers, purchases, expenses, farmers...
 */
(function(){
'use strict';
const X=window.X=window.X||{};
const esc2=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const words=q=>String(q||'').toLowerCase().trim().split(/\s+/).filter(Boolean);
const ISO=/\d{4}-\d{2}-\d{2}/g;
const hit=(t,w)=>w.every(k=>new RegExp('(^|[^a-z0-9])'+k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(t));  // every typed word must start a word in the text

/* ---------- 1) filter bar on list pages ---------- */
window.XF=window.XF||{k:'',q:'',from:'',to:'',on:false,dates:false};
window.xLim=n=>window.XF&&window.XF.on?1e9:n;   // lists that normally show only the latest 60/80 show everything while filtering
const SKIP=['home','sell','stock','set','help','guide'];
function key(){return [st.tab,st.sub,st.fs,st.ms,st.rt,st.mon,st.of,st.dlf].join('|')}
function units(){const mn=document.getElementById('mn');if(!mn)return[];const a=[...mn.querySelectorAll('.item')].filter(e=>!e.closest('#xf'));
 mn.querySelectorAll('table').forEach(t=>t.querySelectorAll('tr').forEach(r=>{if(r.querySelector('td'))a.push(r)}));return a}
function dateOf(el){const t=el.textContent||'',m=t.match(ISO);if(m)return m[0];const r=t.trim().match(/^(\d{2})-(\d{2})\b/);if(r&&st.mon)return st.mon.slice(0,4)+'-'+r[1]+'-'+r[2];return''}
function applyF(){const F=window.XF,w=words(F.q),L=units();let shown=0;
 L.forEach(el=>{let ok=true;if(w.length){const t=(el.textContent||'').toLowerCase();ok=hit(t,w)}
  if(ok&&(F.from||F.to)){const d=dateOf(el);if(d)ok=(!F.from||d>=F.from)&&(!F.to||d<=F.to)}
  el.style.display=ok?'':'none';if(ok)shown++});
 const n=document.getElementById('xfn');if(n)n.textContent=(F.q||F.from||F.to)?shown+' of '+L.length+' shown':''}
X.fq=v=>{XF.q=v;chg()};X.ff=v=>{XF.from=v;chg()};X.ft=v=>{XF.to=v;chg()};
X.fc=()=>{XF.q='';XF.from='';XF.to='';XF.refocus=1;chg()};
X.fd=()=>{XF.dates=!XF.dates;const e=document.getElementById('xfd');if(e)e.classList.toggle('hide',!XF.dates)};
function chg(){const on=!!(XF.q||XF.from||XF.to);if(on!==XF.on){XF.on=on;XF.refocus=1;render();return}applyF()}
window.xAfter=function(){try{
 const mn=document.getElementById('mn');if(!mn)return;const k=key();
 if(XF.k!==k){XF.k=k;XF.q='';XF.from='';XF.to='';XF.on=false;XF.dates=false}
 const old=document.getElementById('xf');if(old)old.remove();
 if(SKIP.includes(st.tab)||mn.querySelector('#gd')||mn.querySelector('input[placeholder*="earch"],input[placeholder*="🔍"],#fq,#bq,#q,#pq'))return;
 const L=units();if(L.length<5&&!XF.on)return;
 const first=L[0];if(!first)return;
 const tw=first.closest('.tw')||first,bar=document.createElement('div');bar.id='xf';bar.className='np';bar.style.cssText='margin:0 0 10px';
 bar.innerHTML='<div style="display:flex;gap:6px"><input id="xfq" type="search" placeholder="🔍 Filter this list (name, item, date…)" autocomplete="off" style="margin:0" value="'+esc2(XF.q)+'" oninput="X.fq(this.value)"><button class="btn" style="margin:0;width:auto;padding:0 12px" onclick="X.fd()" title="Filter by date" aria-label="Filter by date">📅</button>'+(XF.on?'<button class="btn" style="margin:0;width:auto;padding:0 12px" onclick="X.fc()" aria-label="Clear filter">✕</button>':'')+'</div><div id="xfd" class="'+(XF.dates||XF.from||XF.to?'':'hide')+'" style="display:flex;gap:6px;margin-top:6px"><div style="flex:1"><label>From</label><input type="date" style="margin:0" value="'+XF.from+'" onchange="X.ff(this.value)"></div><div style="flex:1"><label>To</label><input type="date" style="margin:0" value="'+XF.to+'" onchange="X.ft(this.value)"></div></div><small id="xfn" style="display:block;margin-top:4px"></small>';
 tw.parentNode.insertBefore(bar,tw);
 if(XF.on)applyF();
 if(XF.refocus){XF.refocus=0;const i=document.getElementById('xfq');if(i&&(XF.q||!XF.on)){i.focus();try{i.setSelectionRange(i.value.length,i.value.length)}catch(e){}}}
}catch(e){console.error(e)}};

/* ---------- 2) search everything ---------- */
let G={q:'',scope:'all',from:'',to:'',res:[]};
function corpus(){const C=[],has=Array.isArray(db.FM),ag=window.ag||{};
 const add=(sec,date,title,sub,right,text,open)=>C.push({sec,date:date||'',title,sub,right,text:(title+' '+sub+' '+text+' '+(date||'')).toLowerCase(),open});
 db.S.forEach(s=>add('Receipts',s.date,'#'+s.no+' · '+(s.cust||'Walk-in'),s.date+(s.time?' '+s.time:'')+' · '+s.items.map(i=>i.n+' ×'+i.q).join(', ')+' · '+s.pay,fm(tot(s)),(s.by||'')+' receipt '+s.no,()=>rcpt(s.id)));
 db.P.forEach(p=>add('Products','',p.name,(p.cat||'')+(p.code?' · '+p.code:''),fm(p.price),(p.code||'')+' '+(p.cat||''),()=>pform(p.id)));
 const ppl={};const P=(n,k,v)=>{n=(n||'').trim();if(!n)return;const r=ppl[n]||(ppl[n]={n:0,b:0});r.n++;r.b+=v||0};
 db.S.forEach(s=>P(s.cust,0,s.pay=='Credit'?tot(s)-paid(s):0));db.A.forEach(a=>P(a.cust));(db.O||[]).forEach(o=>P(o.cust));db.U.forEach(u=>P(u.sup));
 Object.keys(ppl).forEach(n=>add('People & suppliers','',n,ppl[n].n+' records'+(ppl[n].b>0.5?' · owes '+fm(ppl[n].b):''),'','',()=>{G.q=n;G.scope='Receipts';X.gs(true)}));
 db.U.forEach(u=>add('Purchases',u.date,u.n+(u.sup?' · '+u.sup:''),u.date+' · '+u.q+' @ '+fm(ul(u)),fm(u.q*ul(u)),u.sup||'',()=>uform(u.id)));
 db.X.forEach(x=>add('Expenses',x.date,(x.desc||x.type||'Expense'),x.date+' · '+(x.type||''),fm(x.amt),x.type||'',()=>xform(x.id)));
 db.A.forEach(a=>add('Advances',a.date,a.cust+(a.desc?' – '+a.desc:''),a.date+' · advance',fm(a.amt),'',()=>aform(a.id)));
 (db.O||[]).forEach(o=>add('Pre-orders',o.date,(o.cust||'')+' · '+(o.item||''),o.date+' · '+(o.tel||''),'',o.note||'',()=>oform(o.id)));
 if(has){
  db.FM.forEach(f=>add('Farmers',f.since,f.name,[f.village,f.crops,f.tel].filter(Boolean).join(' · '),'',(f.grp||'')+' '+(f.sub||'')+' '+(f.dist||'')+' '+(f.note||'')+' '+(f.ani||''),()=>ag.fopen(f.id)));
  (db.VS||[]).forEach(v=>add('Visits',v.date,(v.farm||v.who||'')+' · '+(v.type||''),v.date+' · '+(v.crop||''),'',(v.find||'')+' '+(v.adv||'')+' '+(v.prob||''),()=>ag.vopen(v.id)));
  (db.EV||[]).forEach(e=>add('Events',e.date,e.topic||e.type||'Event',e.date+' · '+(e.venue||''),'',(e.type||'')+' '+(e.host||'')+' '+(e.crop||''),()=>ag.eopen(e.id)));
  (db.GP||[]).forEach(g=>add('Groups','',g.name,[g.village,g.leader].filter(Boolean).join(' · '),'',g.focus||'',()=>ag.gopen(g.id)));
  (db.SO||[]).forEach(o=>add('Market',o.date,(o.prod||'')+' · '+(o.farm||o.who||''),o.date+' · offer '+(o.qty||'')+' '+(o.unit||''),'',o.loc||'',()=>ag.soopen(o.id)));
  (db.BR||[]).forEach(o=>add('Market',o.date,(o.prod||'')+' · '+(o.buyer||o.who||''),o.date+' · request '+(o.qty||'')+' '+(o.unit||''),'',o.spec||'',()=>ag.bropen(o.id)));
  (db.DL||[]).forEach(z=>add('Market',z.date,(z.prod||'')+' · '+(z.farm||z.who||''),(z.date||'')+' · deal',fm((z.qty||0)*(z.bp||0)),(z.buyer||'')+' '+(z.bwho||''),()=>ag.dopen(z.id)));
  (db.BY||[]).forEach(b=>add('Market','',b.name,[b.type,b.loc,b.tel].filter(Boolean).join(' · '),'',b.prods||'',()=>ag.byopen(b.id)));
  (db.PT||[]).forEach(p=>add('Partners','',p.name,[p.org,p.role,p.tel].filter(Boolean).join(' · '),'',p.cat||'',()=>ag.ptopen(p.id)));
  (db.LC||[]).forEach(l=>add('Documents','',l.name,[l.no,l.issuer].filter(Boolean).join(' · '),'',l.exp||'',()=>ag.lform(l.id)))}
 return C}
function scopes(C){const o=[['all','All']],seen={};C.forEach(c=>{if(!seen[c.sec]){seen[c.sec]=1}});Object.keys(seen).forEach(s=>o.push([s,s]));return o}
function results(){const C=corpus(),w=words(G.q);G.res=[];
 let L=C.filter(c=>(G.scope=='all'||c.sec==G.scope)&&hit(c.text,w));
 if(G.from||G.to)L=L.filter(c=>c.date&&(!G.from||c.date>=G.from)&&(!G.to||c.date<=G.to));
 const order=[],by={};L.forEach(c=>{if(!by[c.sec]){by[c.sec]=[];order.push(c.sec)}by[c.sec].push(c)});
 let h='',n=0;order.forEach(sec=>{const A=by[sec].sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:0),cap=G.scope=='all'?8:60;
  h+='<h3>'+esc2(sec)+' ('+A.length+')</h3>';A.slice(0,cap).forEach(c=>{G.res.push(c);h+='<button class="item" data-i="'+(G.res.length-1)+'"><span class="nm"><b>'+esc2(c.title)+'</b><small>'+esc2(c.sub)+'</small></span><span class="pr">'+esc2(c.right)+'</span></button>'});
  if(A.length>cap)h+='<button class="btn" data-sc="'+esc2(sec)+'">Show all '+A.length+' in '+esc2(sec)+'</button>';n+=A.length});
 if(!w.length&&!G.from&&!G.to)return{h:'<div class="empty">Type a name, product, receipt number, phone, crop or village.<br><small>Use the chips to search one area only, or pick dates.</small></div>',C};
 return{h:n?h:'<div class="empty">Nothing found</div>',C}}
X.gs=function(keep){if(!keep&&!G.q)G.scope='all';const C=corpus(),chips=scopes(C).map(([k,l])=>'<button data-sc="'+esc2(k)+'" class="'+(G.scope==k?'on':'')+'">'+esc2(l)+'</button>').join('');
 modal('<h2>🔍 Search everything</h2><input id="gsq" type="search" placeholder="Name, product, receipt no., phone…" autocomplete="off" value="'+esc2(G.q)+'"><div class="seg" id="gsc" style="flex-wrap:nowrap;overflow-x:auto">'+chips+'</div><div style="display:flex;gap:6px"><div style="flex:1"><label>From date</label><input id="gsf" type="date" value="'+G.from+'"></div><div style="flex:1"><label>To date</label><input id="gst" type="date" value="'+G.to+'"></div></div><div id="gsr"></div><button class="btn" onclick="modal()">Close</button>');
 const q=document.getElementById('gsq'),r=document.getElementById('gsr');
 const draw=()=>{r.innerHTML=results().h;document.querySelectorAll('#gsc button').forEach(b=>b.classList.toggle('on',b.dataset.sc==G.scope))};
 q.oninput=()=>{G.q=q.value;draw()};document.getElementById('gsf').onchange=e=>{G.from=e.target.value;draw()};document.getElementById('gst').onchange=e=>{G.to=e.target.value;draw()};
 document.getElementById('gsc').onclick=e=>{const b=e.target.closest('button');if(b){G.scope=b.dataset.sc;draw()}};
 r.onclick=e=>{const b=e.target.closest('[data-i]');if(b){const c=G.res[+b.dataset.i];if(c)c.open();return}const s=e.target.closest('[data-sc]');if(s){G.scope=s.dataset.sc;draw()}};
 draw();if(!keep)q.focus()};

function mkBtn(){if(document.getElementById('gsb'))return;const b=document.createElement('button');b.id='gsb';b.setAttribute('aria-label','Search everything');b.textContent='🔍';b.onclick=()=>X.gs();document.body.appendChild(b);
 const s=document.createElement('style');s.textContent='#gsb{position:fixed;right:14px;bottom:calc(126px + env(safe-area-inset-bottom,0px));width:50px;height:50px;border-radius:50%;border:2px solid var(--acc);background:var(--card);color:var(--ink);font-size:21px;box-shadow:0 2px 8px #0006;z-index:5;cursor:pointer}@media print{#gsb,#xf{display:none!important}}';document.head.appendChild(s)}
if(document.body)mkBtn();else document.addEventListener('DOMContentLoaded',mkBtn);
})();
