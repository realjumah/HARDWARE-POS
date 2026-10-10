/* Okpotani multi-device cloud layer — uses Supabase Auth + RPC, no paid SDK required. */
(function(){
  'use strict';
  const CFG=window.OKPOTANI_SUPABASE||{};
  const KEY='okpotani_cloud_session_v1';
  const WSKEY='okpotani_cloud_workspace_v1';
  const HASHKEY='okpotani_cloud_hash_v1';
  const REVKEY='okpotani_cloud_revision_v1';
  const $=s=>document.querySelector(s);
  const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state={session:null,workspace:null,dirty:false,conflict:false,status:'Not connected',timer:null,poll:null,lastHash:null,working:false};
  try{state.session=JSON.parse(localStorage.getItem(KEY)||'null')}catch{}
  try{state.lastHash=localStorage.getItem(HASHKEY)||null}catch{}
  const configured=()=>/^https:\/\//.test(CFG.url||'')&&!!CFG.anonKey;
  const hash=o=>{let str=JSON.stringify(o);let x=2166136261;for(let i=0;i<str.length;i++){x^=str.charCodeAt(i);x=Math.imul(x,16777619)}return (x>>>0).toString(16)};
  function storeSession(s){state.session=s;try{if(s)localStorage.setItem(KEY,JSON.stringify(s));else localStorage.removeItem(KEY)}catch{}}
  function authToken(){return state.session?.access_token||CFG.anonKey}
  async function refreshSession(){
    if(!state.session?.refresh_token)return;
    if((state.session.expires_at||0)*1000>Date.now()+60000)return;
    const r=await fetch(CFG.url.replace(/\/$/,'')+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json','apikey':CFG.anonKey},body:JSON.stringify({refresh_token:state.session.refresh_token})});
    const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.msg||j.message||j.error_description||'Session expired; sign in again.');
    j.expires_at=j.expires_at||Math.floor(Date.now()/1000)+(j.expires_in||3600);storeSession(j);
  }
  async function api(path,opts={}){
    if(!configured())throw Error('Cloud is not configured. Fill in cloud-config.js first.');
    await refreshSession();
    const headers={'apikey':CFG.anonKey,'Authorization':'Bearer '+authToken(),'Content-Type':'application/json',...(opts.headers||{})};
    const r=await fetch(CFG.url.replace(/\/$/,'')+path,{...opts,headers});
    const j=await r.json().catch(()=>null);
    if(!r.ok){const msg=j?.msg||j?.message||j?.error_description||j?.hint||j?.details||j?.error||('HTTP '+r.status);throw Error(String(msg))}
    return j;
  }
  async function rpc(name,args={}){return api('/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify(args)})}
  function status(s){state.status=s;const el=$('#cloudStatusLine');if(el)el.textContent=s;const btn=$('#cloudStatusBtn');if(btn)btn.textContent='Cloud: '+(state.conflict?'Conflict':state.workspace?'Connected':state.session?'Signed in':'Off');}
  function panel(){
    const who=state.session?.user?.email||'';
    let body='';
    if(!configured())body='<p><b>Not configured yet.</b> This app works locally, but cloud/team sync stays off until you create a free Supabase project, run <code>supabase-setup.sql</code>, then paste the Project URL and publishable/anon key into <code>cloud-config.js</code>.</p><small>Never paste a service-role/secret key into this app.</small>';
    else body='<p id="cloudStatusLine">'+h(state.status)+'</p>'+(who?'<p>Signed in as <b>'+h(who)+'</b></p>':'<p>Sign in on each phone/computer using an account authorized for this shop.</p>')+(state.workspace?'<p>Workspace: <b>'+h(state.workspace.workspace_name||state.workspace.name||'Okpotani Hardware')+'</b> · role: '+h(state.workspace.role||'member')+'</p>':'<p>No cloud workspace is connected on this device yet.</p>')+(state.conflict?'<p class="low"><b>Sync conflict:</b> another device saved newer records. Cloud and this device were not merged automatically, to avoid silently overwriting records.</p>':'')+'<button class="btn big" onclick="openOkpotaniCloud()">'+(state.session?'Cloud & team settings':'Sign in / set up cloud')+'</button>';
    return '<section class="stat" style="margin-bottom:12px;border:2px solid var(--acc)"><h2>☁ Cloud & team sync</h2>'+body+'</section>';
  }
  function rerender(){try{if(typeof render==='function'&&typeof st!=='undefined'&&st.tab==='set')render()}catch{}}
  function setWorkspace(w){state.workspace=w||null;if(w){try{localStorage.setItem(WSKEY,w.workspace_id||w.id);localStorage.setItem(HASHKEY,hash(w.data||{}));localStorage.setItem(REVKEY,String(w.revision||1))}catch{};state.lastHash=hash(w.data||{});state.dirty=false;state.conflict=false;status('Connected · cloud revision '+(w.revision||1))}else{try{localStorage.removeItem(WSKEY)}catch{};status(state.session?'Signed in · no workspace':'Not connected')}rerender()}
  function applyCloudData(data){if(!data||!data.P)throw Error('The cloud backup does not look like an Okpotani data file.');db=data;if(typeof mig==='function')mig();try{localStorage.setItem('okp_hw_v1',JSON.stringify(db))}catch{};if(typeof idbSet==='function')idbSet('db',{at:new Date().toISOString(),db});state.lastHash=hash(db);state.dirty=false;state.conflict=false;try{localStorage.setItem(HASHKEY,state.lastHash);if(state.workspace)localStorage.setItem(REVKEY,String(state.workspace.revision||1))}catch{};rerender()}
  async function getWorkspace(){return await rpc('okp_get_workspace',{})}
  async function checkWorkspace(){
    const w=await getWorkspace();
    if(!w){setWorkspace(null);return null}
    const known=(()=>{try{return localStorage.getItem(WSKEY)}catch{return null}})();
    state.workspace=w;
    if(known && known===(w.workspace_id||w.id)){
      const incoming=hash(w.data||{}), localHash=hash(db), baseline=(()=>{try{return localStorage.getItem(HASHKEY)}catch{return null}})(), savedRev=Number((()=>{try{return localStorage.getItem(REVKEY)}catch{return 0}})()||0);
      state.workspace=w;
      if(baseline && localHash!==baseline){
        state.dirty=true;
        if(savedRev && (w.revision||1)!==savedRev){state.conflict=true;status('Conflict · this device and cloud both changed');}
        else {state.conflict=false;status('Local changes waiting to sync…');clearTimeout(state.timer);state.timer=setTimeout(push,900);}
      } else if(incoming!==state.lastHash){
        if(state.dirty){state.conflict=true;status('Conflict · newer cloud data exists');}
        else {applyCloudData(w.data);state.workspace=w;status('Connected · cloud revision '+w.revision)}
      } else {state.workspace=w;state.lastHash=incoming;status('Connected · cloud revision '+w.revision)}
    }else{
      state.workspace=w;
      status('Cloud workspace found · confirm to use it on this device');
    }
    rerender();return w;
  }
  async function signUp(){const email=$('#cloudEmail')?.value.trim(),password=$('#cloudPassword')?.value;if(!email||!password)return alert('Enter your email and a password (at least 8 characters).');if(password.length<8)return alert('Use a password of at least 8 characters.');try{const j=await api('/auth/v1/signup',{method:'POST',body:JSON.stringify({email,password})});if(j?.access_token){j.expires_at=j.expires_at||Math.floor(Date.now()/1000)+(j.expires_in||3600);storeSession(j);await afterAuth()}else{alert('Account created. Check your email to confirm it, then return here and sign in.');openOkpotaniCloud()}}catch(e){alert('Could not create account: '+e.message)}}
  async function signIn(){const email=$('#cloudEmail')?.value.trim(),password=$('#cloudPassword')?.value;if(!email||!password)return alert('Enter your email and password.');try{const j=await api('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});j.expires_at=j.expires_at||Math.floor(Date.now()/1000)+(j.expires_in||3600);storeSession(j);await afterAuth()}catch(e){alert('Sign in failed: '+e.message)}}
  async function afterAuth(){try{const w=await getWorkspace();if(w){state.workspace=w;const known=(()=>{try{return localStorage.getItem(WSKEY)}catch{return null}})();if(known===(w.workspace_id||w.id)){const baseline=(()=>{try{return localStorage.getItem(HASHKEY)}catch{return null}})(),localHash=hash(db),savedRev=Number((()=>{try{return localStorage.getItem(REVKEY)}catch{return 0}})()||0);state.workspace=w;if(baseline&&localHash!==baseline){state.dirty=true;if(savedRev&&(w.revision||1)!==savedRev){state.conflict=true;status('Conflict · this device and cloud both changed')}else{status('Local changes waiting to sync…');clearTimeout(state.timer);state.timer=setTimeout(push,900)}}else{applyCloudData(w.data);state.workspace=w;status('Connected · cloud revision '+w.revision)}}else{status('Signed in · choose whether to use this cloud workspace');} }else{setWorkspace(null)}openOkpotaniCloud();startPolling();}catch(e){status('Signed in · '+e.message);openOkpotaniCloud()}rerender()}
  async function createWorkspace(){const name=$('#cloudShopName')?.value.trim()||'Okpotani General Hardware';if(!confirm('Create the shared cloud workspace using the business records currently on THIS device? Review the data before confirming.'))return;try{const w=await rpc('okp_create_workspace',{p_name:name,p_data:db});state.workspace=w;setWorkspace(w);state.lastHash=hash(db);try{localStorage.setItem(HASHKEY,state.lastHash);localStorage.setItem(REVKEY,'1')}catch{};alert('Cloud workspace created. Share the invite code shown below only with trusted staff.');openOkpotaniCloud();startPolling()}catch(e){alert('Could not create workspace: '+e.message)}}
  async function joinWorkspace(){const code=$('#cloudInviteCode')?.value.trim().toUpperCase();if(!code)return alert('Enter the shop invite code.');if(!confirm('Join this shop and replace this device’s current records with the shared cloud records? Download a backup first if this device contains records you need.'))return;try{await rpc('okp_join_workspace',{p_invite_code:code});const w=await getWorkspace();if(!w)throw Error('Joined but could not load the workspace.');setWorkspace(w);applyCloudData(w.data);state.workspace=w;alert('This device is now connected to the shared shop.');openOkpotaniCloud();startPolling()}catch(e){alert('Could not join workspace: '+e.message)}}
  async function useCloudCopy(){if(!state.workspace)return;const w=await getWorkspace();if(!w)return alert('Cloud workspace was not found.');if(!confirm('Replace the records on this device with the latest shared cloud records? Any local-only changes on this device will be discarded. Download a backup first if needed.'))return;state.workspace=w;applyCloudData(w.data);state.workspace=w;try{localStorage.setItem(WSKEY,w.workspace_id||w.id)}catch{};status('Connected · cloud revision '+w.revision);openOkpotaniCloud()}
  async function pushLocalCopy(){if(!state.workspace)return;const w=await getWorkspace();if(!w)return alert('Cloud workspace was not found.');if(!confirm('Replace the shared cloud records with the records on THIS device for every connected user? This can overwrite changes from other devices. Download backups first.'))return;try{const out=await rpc('okp_save_workspace',{p_workspace_id:w.workspace_id||w.id,p_data:db,p_expected_revision:w.revision});state.workspace={...w,revision:out.revision,updated_at:out.updated_at,data:db};state.lastHash=hash(db);state.dirty=false;state.conflict=false;try{localStorage.setItem(HASHKEY,state.lastHash);localStorage.setItem(REVKEY,String(out.revision))}catch{};status('Connected · cloud revision '+out.revision);alert('This device’s records are now the shared cloud version.');openOkpotaniCloud()}catch(e){state.conflict=true;status('Conflict · cloud copy changed again');alert('Could not replace cloud records: '+e.message)}}
  async function push(){if(!state.session||!state.workspace||!state.dirty||state.conflict||state.working)return;state.working=true;try{if(!navigator.onLine)throw Error('Offline; local changes are saved on this device and will sync when online.');const w=await rpc('okp_save_workspace',{p_workspace_id:state.workspace.workspace_id||state.workspace.id,p_data:db,p_expected_revision:state.workspace.revision||1});state.workspace.revision=w.revision;state.workspace.updated_at=w.updated_at;state.workspace.data=db;state.lastHash=hash(db);state.dirty=false;try{localStorage.setItem(HASHKEY,state.lastHash);localStorage.setItem(REVKEY,String(w.revision))}catch{};status('Synced · cloud revision '+w.revision);rerender()}catch(e){if(/SYNC_CONFLICT|revision|conflict/i.test(e.message)){state.conflict=true;status('Conflict · another device saved newer records')}else status('Pending sync · '+e.message);rerender()}finally{state.working=false}}
  function markDirty(){if(!state.session||!state.workspace)return;state.dirty=true;if(state.conflict){status('Conflict · local changes waiting');return}status(navigator.onLine?'Changes waiting to sync…':'Offline · changes saved on this device');clearTimeout(state.timer);state.timer=setTimeout(push,2200)}
  async function syncNow(){if(!state.session)return openOkpotaniCloud();if(!state.workspace){const w=await checkWorkspace().catch(e=>{alert(e.message);return null});if(!w)return openOkpotaniCloud();}if(state.conflict)return alert('Resolve the conflict first: use the cloud copy, or deliberately replace cloud with this device’s copy.');if(state.dirty){await push();return}try{const w=await getWorkspace();if(!w)return;const incoming=hash(w.data||{});if(incoming!==state.lastHash){if(confirm('Newer cloud records are available. Load them now?')){state.workspace=w;applyCloudData(w.data);state.workspace=w;status('Connected · cloud revision '+w.revision)}}else{state.workspace=w;status('Already up to date · cloud revision '+w.revision)}openOkpotaniCloud()}catch(e){alert('Sync failed: '+e.message)}}
  async function signOut(){if(state.dirty&&!state.conflict&&!confirm('You have local changes waiting to sync. Sign out anyway?'))return;try{await api('/auth/v1/logout',{method:'POST',body:'{}'})}catch{}storeSession(null);state.workspace=null;state.dirty=false;state.conflict=false;clearInterval(state.poll);status('Signed out');openOkpotaniCloud();rerender()}
  function startPolling(){clearInterval(state.poll);state.poll=setInterval(async()=>{if(!state.session||!navigator.onLine)return;try{await checkWorkspace()}catch(e){if(!navigator.onLine)status('Offline · local mode');}},20000)}
  function openDialog(){
    if(!configured()){modal('<h2>Cloud setup needed</h2><p>To enable multi-device sharing for free:</p><ol><li>Create a Supabase project.</li><li>Run the SQL in <b>supabase-setup.sql</b> in its SQL Editor.</li><li>Copy the Project URL and publishable/anon key into <b>cloud-config.js</b>.</li><li>Publish the updated app, then reopen it.</li></ol><p>Do not put a service-role/secret key in this app.</p><button class="btn" onclick="modal()">Close</button>');return}
    if(!state.session){modal('<h2>Cloud sign in</h2><p>Use the same account on your devices. Create one account first, then sign in on other devices.</p><label>Email</label><input id="cloudEmail" type="email" autocomplete="username" placeholder="you@example.com"><label>Password (minimum 8 characters)</label><input id="cloudPassword" type="password" autocomplete="current-password" placeholder="Password"><button class="btn big" onclick="okpotaniCloudSignIn()">Sign in</button><button class="btn" onclick="okpotaniCloudSignUp()">Create account</button><button class="btn" onclick="modal()">Cancel</button>');return}
    if(!state.workspace){modal('<h2>Set up your shop workspace</h2><p>Signed in as <b>'+h(state.session.user?.email||'')+'</b>. Create a shared workspace from this device’s current records, or join an existing shop using its invite code.</p><label>Shop name (for a new workspace)</label><input id="cloudShopName" value="'+h((typeof db!=='undefined'&&db.shop?.name)||'Okpotani General Hardware')+'"><button class="btn big" onclick="okpotaniCloudCreateWorkspace()">Create workspace from this device</button><hr><label>Invite code (to join an existing shop)</label><input id="cloudInviteCode" autocapitalize="characters" placeholder="ENTER CODE"><button class="btn" onclick="okpotaniCloudJoinWorkspace()">Join existing shop</button><button class="btn" onclick="okpotaniCloudSignOut()">Sign out</button>');return}
    const w=state.workspace,code=(w.role==='owner'&&w.invite_code)?'<label>Staff invite code (share privately)</label><input readonly value="'+h(w.invite_code)+'" onclick="this.select()"><small>Anyone with this code and a verified account may join this workspace.</small>':'';
    modal('<h2>Cloud & team settings</h2><p>Signed in as <b>'+h(state.session.user?.email||'')+'</b></p><p>Shop: <b>'+h(w.workspace_name||w.name||'Okpotani General Hardware')+'</b><br>Role: '+h(w.role||'member')+' · Revision: '+h(w.revision||1)+'</p><p id="cloudStatusLine">'+h(state.status)+'</p>'+code+(state.conflict?'<div class="stat"><b class="low">Sync conflict detected</b><p>Choose one version deliberately. Cloud data may include changes from another device.</p><button class="btn" onclick="okpotaniCloudUseCopy()">Use latest cloud version on this device</button><button class="btn del" onclick="okpotaniCloudPushCopy()">Replace cloud with this device’s version</button></div>':'')+'<button class="btn big" onclick="okpotaniCloudSyncNow()">Sync now</button><button class="btn" onclick="okpotaniCloudUseCopy()">Load latest cloud records</button><button class="btn" onclick="okpotaniCloudSignOut()">Sign out</button><button class="btn" onclick="modal()">Close</button>');
  }
  window.openOkpotaniCloud=openDialog;
  window.okpotaniCloudSignUp=signUp;window.okpotaniCloudSignIn=signIn;window.okpotaniCloudCreateWorkspace=createWorkspace;window.okpotaniCloudJoinWorkspace=joinWorkspace;window.okpotaniCloudUseCopy=useCloudCopy;window.okpotaniCloudPushCopy=pushLocalCopy;window.okpotaniCloudSyncNow=syncNow;window.okpotaniCloudSignOut=signOut;
  window.okpotaniCloudMarkDirty=markDirty;
  window.okpotaniCloudPanel=panel;
  window.addEventListener('online',()=>{if(state.dirty&&!state.conflict)push();else if(state.session)checkWorkspace().catch(()=>{});});
  window.addEventListener('load',()=>{try{const old=V.set;V.set=function(){return panel()+old.apply(this,arguments)};render()}catch{};if(state.session){checkWorkspace().catch(e=>status('Cloud reconnect needed · '+e.message));startPolling()}else status(configured()?'Not signed in':'Not configured');});
})();
