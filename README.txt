OKPOTANI GENERAL HARDWARE — MULTI-PHONE CLOUD APP (FIREBASE + GITHUB PAGES)

WHAT CHANGED FROM THE SUPABASE VERSION
- Cloud: Supabase is gone. Sign-in is Firebase Authentication; shared records live in Cloud Firestore.
- The app still works fully on the phone with no internet. The cloud only shares records between phones.
- Safer + cheaper: each record (a product, a sale, a purchase, an expense...) is its own cloud document.
  Only records that changed are sent, and a phone only downloads what changed since it last looked.
  Two phones editing DIFFERENT records never conflict (the old version could only keep one whole copy).
- Deleting a record leaves a small "deleted" marker so other phones remove it too; nothing is hard-deleted by the app.
- Email verification is required before anyone can read or write shop data.
- Owner can see who has access, remove staff, and replace the invite code.
- Firebase code is bundled in this folder (firebase-bundle.js), so the app does not depend on any outside website to load.

========================================================================
SETUP (all free; takes about 20 minutes; do it once)
========================================================================
A. CREATE THE FIREBASE PROJECT
 1. Go to https://console.firebase.google.com and sign in with a Google account. Click "Create a project".
    Name it e.g. okpotani-hardware. You can turn Google Analytics OFF.
 2. Left menu -> Build -> Authentication -> Get started -> Sign-in method -> Email/Password -> Enable -> Save.
    (Leave "Email link" off.)
 3. Authentication -> Settings -> Authorized domains -> Add domain:  YOURUSERNAME.github.io
    (use your real GitHub user name, lowercase, no https://).
 4. Left menu -> Build -> Firestore Database -> Create database.
    Choose "Production mode" and a location near you. (Pick one; it cannot be changed later.)
 5. Firestore -> Rules tab. Delete everything, open firestore.rules from this folder, copy ALL of it, paste, click Publish.
 6. Project settings (gear icon) -> General -> "Your apps" -> click the </> (Web) icon -> give it a nickname -> Register app.
    Copy the values apiKey, authDomain, projectId, appId.
    (Do NOT tick "Firebase Hosting". We use GitHub Pages.)

B. PUT YOUR SETTINGS IN THE APP
 7. Open firebase-config.js in a text editor. Replace the 4 PASTE_/YOUR- values with the ones from step 6. Save.
    These web settings are not secrets. Never put an admin / service-account key in this folder.

C. PUBLISH ON GITHUB PAGES
 8. In your GitHub repository (the same one you used before), delete the old files supabase-setup.sql and cloud-config.js,
    then upload ALL files from this folder (index.html, cloud.js, firebase-bundle.js, firebase-config.js, firestore.rules,
    sw.js, manifest.webmanifest, icon files, .nojekyll). Commit to the main branch.
    The repository is PUBLIC, so never upload backup files (.json) or anything private.
 9. Settings -> Pages -> Deploy from a branch -> main / (root) (already set if you used it before). Wait 1-2 minutes.
10. Open your site: https://YOURUSERNAME.github.io/REPOSITORY-NAME/
    If you still see the old version, close the app fully and reopen it once or twice (the phone keeps an old copy briefly).

D. FIRST USE
11. OWNER'S PHONE (the one that has your records):
    - FIRST download a backup: Setup -> Download backup file. Keep it safe (do not put it on GitHub).
    - Setup -> Cloud & team sync -> Sign in / set up cloud -> Create account (email + password, 8+ characters).
    - Open the verification email Firebase sends (check spam), then tap "I have verified my email".
    - Tap "Create cloud shop from this phone". Wait until it says Connected.
    - Open Cloud & team settings to see the staff invite code. Share it privately (WhatsApp to a person you trust).
12. EACH STAFF PHONE / SECOND DEVICE:
    - Open the same site, create their own account, verify the email.
    - Staff: paste the invite code and tap "Join existing shop". This REPLACES that phone's records with the shop's records.
    - The owner's own second phone: sign in with the same account and tap "Load shop records onto this phone".
13. Install on Android: Chrome menu -> Install app / Add to Home screen.

========================================================================
DATA SAFETY
========================================================================
- Download a backup every evening (the app reminds you). The cloud is shared storage, not a replacement for backups.
  Free Firebase has no automatic backups, so your own backup files are your safety net.
- Only verified accounts that are members of the shop can read or write records (see firestore.rules).
  Anyone who has the invite code AND a verified account can join, so share it only privately. Use "Make a new invite code"
  if it leaks, and "Remove" to cut off a person.
- Everyone who joins can currently edit all records (same as the old version). There are no cashier-only permissions yet.
- Restoring an old backup on a connected phone replaces the shop's records for EVERYONE. The app asks you to confirm.
  A delete of many records at once also asks for confirmation.
- If two phones change the SAME record at the same time, the later save wins and the other version is saved
  (Cloud & team settings -> Download conflict copies). Changes to different records never clash.
- Receipt numbers are chosen by each phone (last number + 1). If two phones sell at the very same moment before they
  have synced, both could print the same receipt number. The records themselves are all kept.
- Free Firebase limits (check current numbers on the Firebase pricing page): about 50,000 reads and 20,000 writes per day,
  and 1 GB storage. This design uses a few reads/writes per sale, so a small shop is far below that.
- Optional hardening: Google Cloud console -> APIs & Services -> Credentials -> your Browser key -> Application restrictions
  -> Websites: add https://YOURUSERNAME.github.io/* and https://YOUR-PROJECT-ID.firebaseapp.com/*  (keep both).
- The old Supabase project still holds a copy of your data until you delete or pause it. Once Firebase works, delete it from
  the Supabase dashboard, and remove cloud-config.js from GitHub (it contained the Supabase URL and key).

FILES (see also pdf.js and finder.js, added later)
index.html            Main business app
cloud.js              Sign-in and shared-shop sync (Firebase)
firebase-bundle.js    The Firebase code (Auth + Firestore), bundled so it works offline
firebase-config.js    YOUR Firebase web settings go here
firestore.rules       Security rules to paste into the Firebase console
sw.js                 Offline app-shell cache
manifest.webmanifest, icon-*.png, icon.svg   Install-to-phone files

TROUBLESHOOTING
- "Cloud is not set up yet": firebase-config.js still has the PASTE_ values, or the old copy of the app is cached. Reopen the app.
- "The cloud refused...": email not verified yet, wrong rules published, or you were removed from the shop.
- Verification email not arriving: check spam; tap "Send the email again". It comes from noreply@YOUR-PROJECT-ID.firebaseapp.com.
- Sign-in works but nothing syncs: confirm step 3 (authorized domain) and step 5 (rules published).
- "Invite code not found": ask the owner for the current code (it changes when they make a new one).
- Records look out of date on one phone: Cloud & team settings -> Sync now, or "Download whole shop again".

========================================================================
NEW: PDF SHARING, SEARCH AND FILTERS
========================================================================
- Every receipt now has "Share receipt as PDF" and "Download receipt PDF" (A5 page, or a narrow 58mm roll if that paper is chosen).
- Reports page: the Daily summary table now lists the LATEST date first. Daily and monthly reports can be shared/downloaded as PDF.
- Setup page: "Download backup as PDF" / "Share backup PDF" (readable report plus a hidden full copy of your data), and
  "Whole business report (PDF)" with an optional date range. Restore accepts the .json file OR the backup PDF.
  Keep the .json backup too; the PDF backup restores only if the file is not edited or re-saved by another PDF program.
- Search: the round magnifier button opens "Search everything" (receipts, products, customers/suppliers, purchases, expenses, ...),
  with area chips and a date range. Long list pages also get a filter bar (text + calendar button for dates).
  While a filter is on, lists show ALL records, not just the latest 60/80.
- New files to upload to GitHub: pdf.js and finder.js (plus the updated index.html, sw.js and, for the agro app, agro.js).
