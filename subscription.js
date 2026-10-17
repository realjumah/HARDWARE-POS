/* Okpotani subscription layer: 14-day trial, monthly plan, manual mobile money, in-app notices.
 *
 * Data (all in the same Firebase project as the shop data):
 *   billing/{shopId}                trial start, paid-until date, free flag      (admin writes; owner may create the trial once)
 *   payments/{id}                   payment requests from owners                 (owner creates; admin approves)
 *   shops/{shopId}/notices/{id}     messages from the admin to a shop            (admin writes; members read)
 *   platform/payment                mobile money number, registered name, price  (admin writes; signed-in users read)
 *   admins/{uid}                    marks the platform administrator             (created by hand in the console)
 *
 * The app stays local-first: the last known billing status is cached on the phone, so the rules below are
 * enforced offline too. The shop is only billed once it is connected to the cloud.
 */
(function () {
  'use strict';
  const DAY = 864e5, TRIAL_DAYS = 14, PERIOD = 30, GRACE = 3, REMIND = 5;
  const PLAN = 'shop', CURRENCY = 'UGX', DEFAULT_PRICE = 15000;
  const LS = 'okp_sub_v1', LSR = 'okp_sub_read_v1', LSP = 'okp_sub_prof_v1', WSK = 'okp_fb_ws_v1';

  const lsGet = (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Number(n || 0).toLocaleString('en-US') + ' ' + CURRENCY;
  const dstr = ms => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const ms = v => (v && typeof v.toMillis === 'function') ? v.toMillis() : (typeof v === 'number' ? v : null);
  const rid = () => { const a = new Uint8Array(10); (window.crypto || { getRandomValues: x => { for (let i = 0; i < x.length; i++) x[i] = Math.floor(Math.random() * 256); } }).getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); };
  const $ = s => document.querySelector(s);

  const S = { key: '', admin: false, role: '', shopId: '', uid: '', unsubs: [], notices: [], pay: null, mine: [], created: false, firstNotices: true, adm: null, tab: 'pay' };

  // ---- status maths (pure) ----------------------------------------------------------------------------------
  function expiryOf(c, now) {
    const trialEnd = (c.trialStart || now) + (c.trialDays == null ? TRIAL_DAYS : c.trialDays) * DAY;
    return Math.max(trialEnd, c.paidUntil || 0);
  }
  function calc(c, nowIn) {
    if (!c) return { status: 'none' };
    if (c.free) return { status: 'free' };
    const now = Math.max(nowIn || Date.now(), c.lastSeen || 0); // a phone clock set backwards cannot reduce time already seen
    const exp = expiryOf(c, now), left = exp - now;
    if (left > 0) return { status: c.paidUntil ? 'active' : 'trial', days: Math.ceil(left / DAY), exp };
    const g = GRACE * DAY + left;
    if (g > 0) return { status: 'grace', days: 0, graceLeft: Math.ceil(g / DAY), exp };
    return { status: 'locked', days: 0, exp };
  }
  const wsNow = () => { const c = window.okpotaniCloudCore; return (c && c.state.ws) || lsGet(WSK); };
  function cached() { const c = lsGet(LS); const w = wsNow(); return c && w && c.shopId === w.shopId ? c : null; }
  function current() {
    const c = cached(); if (!c || S.admin) return { status: S.admin ? 'free' : 'none' };
    const r = calc(c); const now = Math.max(Date.now(), c.lastSeen || 0);
    if (now > (c.lastSeen || 0)) { c.lastSeen = now; lsSet(LS, c); }
    return r;
  }

  // ---- cloud plumbing --------------------------------------------------------------------------------------
  const core = () => window.okpotaniCloudCore;
  const FB = () => core().FB;
  const fs = () => core().state.fs;
  const R = {
    billing: id => FB().doc(fs(), 'billing', id), payment: id => FB().doc(fs(), 'payments', id),
    payments: () => FB().collection(fs(), 'payments'), notice: (s, id) => FB().doc(fs(), 'shops', s, 'notices', id),
    notices: s => FB().collection(fs(), 'shops', s, 'notices'), plat: () => FB().doc(fs(), 'platform', 'payment'),
    admin: u => FB().doc(fs(), 'admins', u), shop: id => FB().doc(fs(), 'shops', id), shops: () => FB().collection(fs(), 'shops'),
    billings: () => FB().collection(fs(), 'billing')
  };
  function stopAll() { S.unsubs.forEach(u => { try { u() } catch { } }); S.unsubs = []; }

  let hookT = null;
  window.okpotaniSubHook = () => { clearTimeout(hookT); hookT = setTimeout(check, 300); };

  async function check() {
    const c = core(); if (!c) return paint();
    const st = c.state, ws = st.ws, user = st.user;
    const key = (ws && user && user.emailVerified) ? user.uid + '|' + ws.shopId + '|' + ws.role : '';
    if (key === S.key) return paint();
    S.key = key; stopAll(); S.notices = []; S.firstNotices = true; S.created = false; S.admin = false;
    if (!key) return paint();
    S.role = ws.role; S.shopId = ws.shopId; S.uid = user.uid;
    try { const a = await FB().getDoc(R.admin(user.uid)); S.admin = a.exists(); } catch { S.admin = false; }
    if (S.key !== key) return;
    if (!S.admin) listenBilling();
    listenNotices();
    loadPay();
    syncProfile();
    paint();
  }

  function listenBilling() {
    const F = FB(), shopId = S.shopId;
    S.unsubs.push(F.onSnapshot(R.billing(shopId), snap => {
      if (snap.exists()) {
        const d = snap.data();
        const prev = lsGet(LS);
        const rec = { shopId, trialStart: ms(d.trialStart), trialDays: d.trialDays, paidUntil: ms(d.paidUntil), free: !!d.free, lastSeen: Math.max(Date.now(), (prev && prev.shopId === shopId && prev.lastSeen) || 0) };
        if (rec.trialStart === null && prev && prev.shopId === shopId) rec.trialStart = prev.trialStart; // server time still pending
        if (rec.trialStart === null) rec.trialStart = Date.now();
        lsSet(LS, rec);
      } else if (!snap.metadata.fromCache && S.role === 'owner' && !S.created) {
        S.created = true; // first time this shop is seen by the billing system: start the free trial
        F.setDoc(R.billing(shopId), { plan: PLAN, trialStart: F.serverTimestamp(), trialDays: TRIAL_DAYS, paidUntil: null, free: false })
          .catch(e => { S.created = false; console.warn('Trial could not start', e); });
      }
      paint();
    }, err => console.warn('billing listener', err && err.code)));
  }
  function listenNotices() {
    const F = FB();
    S.unsubs.push(F.onSnapshot(F.query(R.notices(S.shopId), F.orderBy('at')), snap => {
      S.notices = snap.docs.map(d => ({ id: d.id, ...d.data(), atMs: ms(d.data().at) || Date.now() })).sort((a, b) => b.atMs - a.atMs);
      if (!S.firstNotices) snap.docChanges().forEach(ch => { if (ch.type === 'added' && !snap.metadata.hasPendingWrites && typeof toast === 'function') toast('🔔 ' + (ch.doc.data().title || 'New message')); });
      S.firstNotices = false; paint();
    }, err => console.warn('notices listener', err && err.code)));
  }
  async function loadPay() { try { const p = await FB().getDoc(R.plat()); S.pay = p.exists() ? p.data() : {}; } catch { S.pay = S.pay || null; } }
  async function loadMine() {
    if (S.role !== 'owner') return;
    try { const F = FB(); const q = await F.getDocs(F.query(R.payments(), F.where('shopId', '==', S.uid))); S.mine = q.docs.map(d => ({ id: d.id, ...d.data(), atMs: ms(d.data().at) || Date.now() })).sort((a, b) => b.atMs - a.atMs); } catch { }
  }
  // Keep the cloud copy of the shop name/description current so the admin can tell clients apart.
  async function syncProfile() {
    if (S.role !== 'owner' || typeof db === 'undefined' || !db.shop) return;
    const name = String(db.shop.name || '').slice(0, 120), desc = String(db.shop.about || db.shop.tag || '').slice(0, 400);
    const sig = S.shopId + '|' + name + '|' + desc; if (lsGet(LSP) === sig) return;
    try { await FB().setDoc(R.shop(S.shopId), { name, desc }, { merge: true }); lsSet(LSP, sig); } catch (e) { console.warn('profile sync', e && e.code); }
  }
  const origSset = window.sset;
  if (typeof origSset === 'function') window.sset = function () { const r = origSset.apply(this, arguments); setTimeout(syncProfile, 200); return r; };

  // ---- UI ----------------------------------------------------------------------------------------------------
  const css = document.createElement('style');
  css.textContent = `#subBar{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:8px 12px;font-size:13px;font-weight:600;color:#fff;background:#1f6f43}
#subBar.warn{background:#b26a00}#subBar.bad{background:#b3261e}#subBar button{border:0;border-radius:6px;padding:6px 10px;font:600 13px system-ui,sans-serif;background:#fff;color:#222}
.subOv{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.65);overflow:auto;padding:14px;display:flex;font:15px/1.4 system-ui,sans-serif}
.subCard{position:relative;background:#fff;color:#222;border-radius:12px;padding:16px;max-width:470px;width:100%;margin:auto}
.subCard h2{margin:0 0 4px;font-size:19px}.subCard h3{margin:14px 0 4px;font-size:15px}.subCard small,.subSm{color:#555;font-size:13px}
.subCard input,.subCard textarea,.subCard select{display:block;width:100%;box-sizing:border-box;margin:5px 0;padding:10px;border:1px solid #bbb;border-radius:8px;font:inherit;background:#fff;color:#222}
.subBtn{display:inline-block;border:0;border-radius:8px;padding:10px 14px;margin:4px 4px 4px 0;background:#1f6f43;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer}
.subBtn.alt{background:#2b4a8b}.subBtn.red{background:#b3261e}.subBtn.grey{background:#666}
.subPay{background:#f1f5f2;border-radius:8px;padding:10px;margin:6px 0;font-weight:700;font-size:17px}
.subRow{border-bottom:1px solid #e3e3e3;padding:8px 0}.subTabs button{margin:0 4px 6px 0}
.subX{position:absolute;right:8px;top:4px;border:0;background:none;font-size:28px;color:#555}.subErr{color:#b3261e;font-size:14px}`;
  document.head.appendChild(css);

  const lastRead = () => Number(lsGet(LSR + '_' + S.shopId, 0)) || 0;
  const unread = () => S.notices.filter(n => n.atMs > lastRead()).length;
  const price = () => Number(S.pay && S.pay.price) || DEFAULT_PRICE;

  function describe(r) {
    if (r.status === 'trial') return 'Free trial: ' + r.days + ' day' + (r.days === 1 ? '' : 's') + ' left';
    if (r.status === 'active') return 'Subscription active until ' + dstr(r.exp) + ' (' + r.days + ' day' + (r.days === 1 ? '' : 's') + ' left)';
    if (r.status === 'grace') return 'Subscription expired. ' + r.graceLeft + ' day' + (r.graceLeft === 1 ? '' : 's') + ' left before the app locks';
    if (r.status === 'locked') return 'Subscription ended';
    if (r.status === 'free') return 'Free access';
    return '';
  }

  function paint() {
    const r = current();
    // top strip
    let bar = $('#subBar');
    const u = unread();
    const warn = r.status === 'grace' || ((r.status === 'trial' || r.status === 'active') && r.days <= REMIND);
    const show = S.role && (u > 0 || warn || r.status === 'trial');
    if (!show) { if (bar) bar.remove(); }
    else {
      if (!bar) { bar = document.createElement('div'); bar.id = 'subBar'; const hd = $('header'); hd ? hd.after(bar) : document.body.prepend(bar); }
      bar.className = r.status === 'grace' ? 'bad' : warn ? 'warn' : '';
      bar.innerHTML = '<span>' + esc(describe(r) || 'Messages') + '</span><span><button id="subBell" type="button">🔔' + (u ? ' ' + u : '') + '</button> ' + (r.status === 'trial' || warn ? '<button id="subGo" type="button">' + (r.status === 'trial' ? 'Subscribe' : 'Renew') + '</button>' : '') + '</span>';
      $('#subBell').onclick = openNotices; const g = $('#subGo'); if (g) g.onclick = openPay;
    }
    // lock screen
    let lk = $('#subLock');
    if (r.status === 'locked') {
      if (!lk) { lk = document.createElement('div'); lk.id = 'subLock'; lk.className = 'subOv'; document.body.appendChild(lk); }
      lk.style.zIndex = S.role ? 9998 : 5; // signed-out phones must still be able to open the app's own sign-in window (z-index 9)
      lk.innerHTML = '<div class="subCard"><h2>Subscription ended</h2><p>Your records are safe on this phone and in the cloud. ' + (S.role === 'owner' ? 'Renew to continue using the app.' : 'Ask the shop owner to renew the subscription.') + '</p>' +
        (S.role === 'owner' ? '<button class="subBtn" id="subLockPay" type="button">Renew now</button>' : '') + (!S.role ? '<button class="subBtn" id="subLockIn" type="button">Sign in to renew</button>' : '') +
        '<button class="subBtn alt" id="subLockBk" type="button">Download my backup</button><button class="subBtn grey" id="subLockMsg" type="button">🔔 Messages' + (u ? ' (' + u + ')' : '') + '</button></div>';
      const p = $('#subLockPay'); if (p) p.onclick = openPay;
      const li = $('#subLockIn'); if (li) li.onclick = () => { try { openOkpotaniCloud(); } catch { } };
      $('#subLockBk').onclick = () => { try { bk(); } catch { alert('Open Setup to download a backup.'); } };
      $('#subLockMsg').onclick = openNotices;
    } else if (lk) lk.remove();
    // settings card
    const card = $('#subCard'); if (card) card.outerHTML = cardHtml();
  }

  function cardHtml() {
    const w = wsNow(); if (!w) return '<span id="subCard" style="display:none"></span>';
    const r = current(); const u = unread();
    let body = '';
    if (S.admin) body = '<p>You are signed in as the <b>platform admin</b>. Your own shop is free.</p><button class="btn big" id="subAdm" type="button">Open admin screen</button>';
    else {
      body = '<p><b>' + esc(describe(r) || 'Checking subscription…') + '</b></p><p class="subSm">' + money(price()) + ' per month</p>' +
        (w.role === 'owner' ? '<button class="btn big" id="subPayBtn" type="button">' + (r.status === 'trial' ? 'Subscribe' : 'Pay / renew') + '</button>' : '<p class="subSm">Only the shop owner can pay.</p>');
    }
    return '<section class="stat" id="subCard" style="margin-bottom:12px"><h2>⭐ Subscription</h2>' + body + '<button class="btn" id="subMsgBtn" type="button">🔔 Messages' + (u ? ' (' + u + ' new)' : '') + '</button></section>';
  }
  // The Settings page is rebuilt by the app's own render(), so buttons are handled by one delegated listener.
  document.addEventListener('click', e => {
    const t = e.target && e.target.closest ? e.target.closest('#subAdm,#subPayBtn,#subMsgBtn') : null; if (!t) return;
    if (t.id === 'subAdm') openAdmin(); else if (t.id === 'subPayBtn') openPay(); else openNotices();
  });

  function overlay(html) {
    let o = $('#subDlg'); if (!o) { o = document.createElement('div'); o.id = 'subDlg'; o.className = 'subOv'; o.style.zIndex = 10000; document.body.appendChild(o); }
    o.innerHTML = '<div class="subCard"><button class="subX" type="button" id="subClose" aria-label="Close">&times;</button>' + html + '</div>';
    $('#subClose').onclick = closeDlg; return o;
  }
  function closeDlg() { const o = $('#subDlg'); if (o) o.remove(); }

  // ---- messages ------------------------------------------------------------------------------------------------
  function openNotices() {
    const r = current(); const items = S.notices.slice();
    lsSet(LSR + '_' + S.shopId, Date.now() + 1000);
    let h = '<h2>Messages</h2>';
    if (r.status !== 'none' && r.status !== 'free') h += '<div class="subRow"><b>Subscription</b><br>' + esc(describe(r)) + '</div>';
    h += items.length ? items.map(n => '<div class="subRow"><b>' + esc(n.title) + '</b> <span class="subSm">' + esc(dstr(n.atMs)) + '</span><br>' + esc(n.body) + '</div>').join('') : '<p class="subSm">No messages yet.</p>';
    overlay(h); paint();
  }

  // ---- pay -------------------------------------------------------------------------------------------------------
  async function openPay() {
    if (S.role !== 'owner') return alert('Only the shop owner can pay. Please ask the owner.');
    await Promise.all([loadPay(), loadMine()]);
    const p = S.pay || {}; const pend = S.mine.filter(x => x.status === 'pending');
    let h = '<h2>Subscribe</h2><p class="subSm">Okpotani Hardware POS</p><p style="font-size:26px;font-weight:700;margin:6px 0">' + money(price()) + ' <small>per month</small></p>';
    if (!p.momoNumber) h += '<p class="subErr">Payment details are not available yet. Please contact the system owner.</p>';
    else {
      h += '<h3>1. Send the money by mobile money to</h3><div class="subPay"><div>' + esc(p.momoNumber) + '</div><div>' + esc(p.momoName || '') + '</div></div>' +
        '<h3>2. Tell us you paid</h3><label>Months</label><select id="subMonths">' + [1, 2, 3, 6, 12].map(m => '<option value="' + m + '">' + m + ' month' + (m > 1 ? 's' : '') + ' · ' + money(price() * m) + '</option>').join('') + '</select>' +
        '<input id="subTxn" placeholder="Transaction ID from your payment message"><input id="subFrom" inputmode="tel" placeholder="Number you paid from">' +
        '<button class="subBtn" id="subSend" type="button">Send payment details</button><div class="subErr" id="subErr"></div>' +
        '<p class="subSm">When the payment is confirmed you will get a message here in the app.</p>';
    }
    if (S.mine.length) h += '<h3>Your payments</h3>' + S.mine.slice(0, 5).map(x => '<div class="subRow">' + esc(dstr(x.atMs)) + ' · ' + money(x.amount) + ' · Txn ' + esc(x.txn) + '<br><b>' + (x.status === 'approved' ? '✅ Confirmed' : x.status === 'rejected' ? '❌ Not confirmed' : '⏳ Waiting for confirmation') + '</b></div>').join('');
    overlay(h);
    const send = $('#subSend'); if (send) send.onclick = submitPay;
  }
  async function submitPay() {
    const err = $('#subErr'); err.textContent = '';
    const txn = $('#subTxn').value.trim(), from = $('#subFrom').value.trim(), months = parseInt($('#subMonths').value, 10);
    if (txn.length < 3 || txn.length > 40) { err.textContent = 'Enter the transaction ID from your payment message.'; return; }
    if (!/^[+\d][\d\s]{6,18}$/.test(from)) { err.textContent = 'Enter the phone number you paid from.'; return; }
    const F = FB(); const btn = $('#subSend'); btn.disabled = true;
    try {
      await F.setDoc(R.payment(rid()), { shopId: S.uid, txn, from, amount: price() * months, months, name: String((typeof db !== 'undefined' && db.shop && db.shop.name) || '').slice(0, 120), status: 'pending', at: F.serverTimestamp() });
      overlay('<h2>Payment details sent</h2><p>Thank you. We will check your payment and you will get a message in the app when it is confirmed.</p><button class="subBtn" id="subOk" type="button">OK</button>');
      $('#subOk').onclick = closeDlg;
    } catch (e) { btn.disabled = false; err.textContent = (e && e.code === 'permission-denied') ? 'Could not send. Check that you are signed in as the shop owner.' : 'Could not send. Check your internet and try again.'; }
  }

  // ---- admin -------------------------------------------------------------------------------------------------------
  async function openAdmin() {
    overlay('<h2>Admin</h2><p>Loading…</p>');
    try {
      const F = FB();
      const [sh, bl, pe, pl] = await Promise.all([F.getDocs(R.shops()), F.getDocs(R.billings()), F.getDocs(F.query(R.payments(), F.where('status', '==', 'pending'))), F.getDoc(R.plat())]);
      S.adm = { shops: sh.docs.map(d => ({ id: d.id, ...d.data() })), billing: {}, payments: pe.docs.map(d => ({ id: d.id, ...d.data(), atMs: ms(d.data().at) || 0 })).sort((a, b) => a.atMs - b.atMs), plat: pl.exists() ? pl.data() : {} };
      bl.docs.forEach(d => { const x = d.data(); S.adm.billing[d.id] = { trialStart: ms(x.trialStart), trialDays: x.trialDays, paidUntil: ms(x.paidUntil), free: !!x.free }; });
      renderAdmin();
    } catch (e) { overlay('<h2>Admin</h2><p class="subErr">Could not load: ' + esc((e && e.code) || e) + '</p>'); }
  }
  function tabs() { return '<div class="subTabs">' + [['pay', 'Payments (' + S.adm.payments.length + ')'], ['cli', 'Clients (' + S.adm.shops.length + ')'], ['msg', 'Send message'], ['set', 'Payment details']].map(t => '<button class="subBtn ' + (S.tab === t[0] ? '' : 'grey') + '" data-t="' + t[0] + '" type="button">' + t[1] + '</button>').join('') + '</div>'; }
  function shopName(id) { const s = S.adm.shops.find(x => x.id === id); return (s && s.name) || '(unnamed shop)'; }
  function renderAdmin() {
    const A = S.adm; let h = '<h2>Admin</h2>' + tabs();
    if (S.tab === 'pay') {
      h += A.payments.length ? A.payments.map(p => '<div class="subRow"><b>' + esc(shopName(p.shopId)) + '</b><br>' + money(p.amount) + ' · ' + p.months + ' month' + (p.months > 1 ? 's' : '') + '<br>Txn: <b>' + esc(p.txn) + '</b> · from ' + esc(p.from) + '<br><span class="subSm">' + esc(p.atMs ? dstr(p.atMs) : '') + '</span><br>' +
        '<button class="subBtn" data-ap="' + esc(p.id) + '" type="button">Approve</button><button class="subBtn red" data-rj="' + esc(p.id) + '" type="button">Reject</button></div>').join('') + '<p class="subSm">Before approving, check your mobile money message: the amount, the sender number and the transaction ID must match.</p>' : '<p class="subSm">No payments waiting.</p>';
    } else if (S.tab === 'cli') {
      h += A.shops.map(s => { const b = A.billing[s.id]; const r = b ? calc({ ...b, lastSeen: 0 }) : { status: 'none' };
        return '<div class="subRow"><b>' + esc(s.name || '(unnamed shop)') + '</b><br><span class="subSm">' + esc(s.desc || '') + '</span><br>' + (b ? esc(describe(r)) + (r.exp ? ' · ends ' + esc(dstr(r.exp)) : '') : 'No billing record yet') + '<br>' +
          '<button class="subBtn alt" data-add="' + esc(s.id) + '" type="button">Add days</button><button class="subBtn grey" data-free="' + esc(s.id) + '" type="button">' + (b && b.free ? 'Remove free access' : 'Make free') + '</button></div>'; }).join('') || '<p class="subSm">No clients yet.</p>';
    } else if (S.tab === 'msg') {
      h += '<label>To</label><select id="admTo"><option value="*">All clients</option>' + A.shops.map(s => '<option value="' + esc(s.id) + '">' + esc(s.name || s.id) + '</option>').join('') + '</select><input id="admTitle" maxlength="120" placeholder="Title"><textarea id="admBody" rows="4" maxlength="1000" placeholder="Message"></textarea><button class="subBtn" id="admSend" type="button">Send</button><div class="subErr" id="admErr"></div>';
    } else {
      const p = A.plat; h += '<label>Mobile money number</label><input id="pmNum" value="' + esc(p.momoNumber || '') + '"><label>Fully registered name</label><input id="pmName" value="' + esc(p.momoName || '') + '"><label>Monthly price (' + CURRENCY + ')</label><input id="pmPrice" inputmode="numeric" value="' + esc(p.price || DEFAULT_PRICE) + '"><button class="subBtn" id="pmSave" type="button">Save</button><div class="subErr" id="pmErr"></div>';
    }
    overlay(h);
    document.querySelectorAll('#subDlg [data-t]').forEach(b => b.onclick = () => { S.tab = b.dataset.t; renderAdmin(); });
    document.querySelectorAll('#subDlg [data-ap]').forEach(b => b.onclick = () => decide(b.dataset.ap, true, b));
    document.querySelectorAll('#subDlg [data-rj]').forEach(b => b.onclick = () => decide(b.dataset.rj, false, b));
    document.querySelectorAll('#subDlg [data-add]').forEach(b => b.onclick = () => addDays(b.dataset.add));
    document.querySelectorAll('#subDlg [data-free]').forEach(b => b.onclick = () => toggleFree(b.dataset.free));
    const sm = $('#admSend'); if (sm) sm.onclick = sendNotice; const ps = $('#pmSave'); if (ps) ps.onclick = savePlat;
  }
  function billingWrite(batch, shopId, patch) {
    const F = FB(), b = S.adm.billing[shopId];
    if (b) batch.set(R.billing(shopId), patch, { merge: true });
    else batch.set(R.billing(shopId), { plan: PLAN, trialStart: F.Timestamp.fromMillis(Date.now()), trialDays: 0, paidUntil: null, free: false, ...patch }, { merge: true });
  }
  const noticeDoc = (title, body, kind) => ({ title, body, kind: kind || 'info', at: FB().serverTimestamp() });
  async function decide(pid, ok, btn) {
    const p = S.adm.payments.find(x => x.id === pid); if (!p) return;
    if (!confirm((ok ? 'Approve ' : 'Reject ') + money(p.amount) + ' from ' + shopName(p.shopId) + '?')) return;
    btn.disabled = true;
    try {
      const F = FB(), b = S.adm.billing[p.shopId], now = Date.now(), batch = F.writeBatch(fs());
      if (ok) {
        const base = Math.max(now, b ? expiryOf(b, now) : 0), until = base + p.months * PERIOD * DAY;
        billingWrite(batch, p.shopId, { paidUntil: F.Timestamp.fromMillis(until) });
        batch.set(R.notice(p.shopId, rid()), noticeDoc('Payment confirmed', 'Thank you. Your subscription is active until ' + dstr(until) + '.', 'payment'));
      } else batch.set(R.notice(p.shopId, rid()), noticeDoc('Payment not confirmed', 'We could not confirm your payment of ' + money(p.amount) + ' (Txn ' + p.txn + '). Please check the transaction ID and send the details again.', 'payment'));
      batch.set(R.payment(pid), { status: ok ? 'approved' : 'rejected' }, { merge: true });
      await batch.commit(); await openAdmin();
    } catch (e) { alert('Could not save: ' + ((e && e.code) || e)); btn.disabled = false; }
  }
  async function addDays(shopId) {
    const n = parseInt(prompt('How many days to add to ' + shopName(shopId) + '?', '30'), 10); if (!(n >= 1 && n <= 3650)) return;
    try { const F = FB(), b = S.adm.billing[shopId], now = Date.now(), batch = F.writeBatch(fs()); const until = Math.max(now, b ? expiryOf(b, now) : 0) + n * DAY;
      billingWrite(batch, shopId, { paidUntil: F.Timestamp.fromMillis(until) }); batch.set(R.notice(shopId, rid()), noticeDoc('Subscription extended', 'Your subscription now runs until ' + dstr(until) + '.', 'payment')); await batch.commit(); await openAdmin(); } catch (e) { alert('Could not save: ' + ((e && e.code) || e)); }
  }
  async function toggleFree(shopId) {
    try { const b = S.adm.billing[shopId], batch = FB().writeBatch(fs()); billingWrite(batch, shopId, { free: !(b && b.free) }); await batch.commit(); await openAdmin(); } catch (e) { alert('Could not save: ' + ((e && e.code) || e)); }
  }
  async function sendNotice() {
    const err = $('#admErr'); err.textContent = ''; const to = $('#admTo').value, title = $('#admTitle').value.trim(), body = $('#admBody').value.trim();
    if (!title || !body) { err.textContent = 'Enter a title and a message.'; return; }
    const ids = to === '*' ? S.adm.shops.map(s => s.id) : [to]; if (!confirm('Send to ' + ids.length + ' client' + (ids.length > 1 ? 's' : '') + '?')) return;
    try { for (let i = 0; i < ids.length; i += 400) { const batch = FB().writeBatch(fs()); ids.slice(i, i + 400).forEach(id => batch.set(R.notice(id, rid()), noticeDoc(title, body, 'info'))); await batch.commit(); }
      overlay('<h2>Sent</h2><p>Message sent to ' + ids.length + ' client' + (ids.length > 1 ? 's' : '') + '.</p><button class="subBtn" id="subOk" type="button">OK</button>'); $('#subOk').onclick = openAdmin; } catch (e) { err.textContent = 'Could not send: ' + ((e && e.code) || e); }
  }
  async function savePlat() {
    const err = $('#pmErr'); err.textContent = ''; const num = $('#pmNum').value.trim(), nm = $('#pmName').value.trim(), pr = parseInt($('#pmPrice').value, 10);
    if (!num || !nm || !(pr > 0)) { err.textContent = 'Fill in the number, the registered name and the price.'; return; }
    try { await FB().setDoc(R.plat(), { momoNumber: num, momoName: nm, price: pr }); S.pay = { momoNumber: num, momoName: nm, price: pr }; S.adm.plat = S.pay; toast('Saved'); renderAdmin(); } catch (e) { err.textContent = 'Could not save: ' + ((e && e.code) || e); }
  }

  // ---- start ---------------------------------------------------------------------------------------------------
  window.addEventListener('load', () => {
    try { const old = V.set; V.set = function () { return cardHtml() + old.apply(this, arguments); }; render(); } catch (e) { console.warn('Settings card not added', e); }
    paint(); check();
    setInterval(paint, 3600000);
  });
  window.okpotaniSubInternals = { calc, expiryOf, current };
})();
