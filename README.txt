OKPOTANI GENERAL HARDWARE — MULTI-DEVICE CLOUD APP (FREE-TIER SETUP)

WHAT THIS VERSION INCLUDES
- Existing sales, stock, purchases, expenses, credit, advances, reports, Excel/CSV export and local backup features.
- Installable Progressive Web App (PWA) shell and local offline operation.
- Optional shared cloud workspace with email/password sign-in, owner/staff membership, private invite code, cloud saves, polling for other devices, and revision checks to avoid silent overwrites.
- The public app source has been cleaned so it does not embed the starting inventory or transactions.

IMPORTANT LIMITATION
This is a cloud-ready build, not a deployed/connected production service yet. You must create and configure the free Supabase project and publish the app. Simultaneous edits are detected as conflicts; the app intentionally does not silently merge two whole-database snapshots. Resolve a conflict by choosing the cloud copy or deliberately replacing the cloud copy after backing up.

FREE SETUP (NO PAYMENT REQUIRED FOR A SMALL START)
1. Create a free Supabase account/project at https://supabase.com/. The free tier has quotas and inactive projects may be paused; check current terms.
2. In the Supabase project, open SQL Editor -> New query. Paste all of supabase-setup.sql and run it.
3. Open Project Settings -> API (or Connect). Copy the Project URL and publishable/anon key.
4. Edit cloud-config.js. Set url and anonKey. Use ONLY the publishable/anon key. NEVER use a service_role or secret key in a browser app.
5. Publish this folder to a PUBLIC GitHub repository and enable GitHub Pages (Settings -> Pages -> deploy from main/root). GitHub Pages is free on GitHub Free for public repositories. Source files are public, so do not put secrets or private backups in the repository.
6. Open the published HTTPS site. Go to Setup -> Cloud & team sync -> Sign in / set up cloud.
7. Create an account with an email and password. Confirm the email if Supabase asks you to.
8. To restore the existing Okpotani starting inventory/transactions, download the SEPARATE private backup file provided with this package. Do NOT upload it to GitHub. In the app on the first device, go to Setup -> Restore from backup and select the JSON file. Review the records, then download a fresh backup for safekeeping. Skip this if you prefer a clean start.
9. On the first device, choose “Create workspace from this device”. That uploads the local business records into the cloud workspace. Check those records first.
10. On each additional device, open the same site, create a separate account, sign in, and join with the owner’s invite code. Confirm that you want to replace that device’s local records with the shared cloud records.
11. Install the site on Android via Chrome menu -> Install app / Add to Home screen.

SECURITY / DATA SAFETY
- Keep the separate private backup out of public repositories and only share it with trusted people.
- Use strong, unique passwords and keep the invite code private.
- Do not put a secret key in cloud-config.js. The publishable/anon key is intended for browser use, and access is protected by the SQL policies and RPC checks in supabase-setup.sql.
- Download a backup before the first cloud upload, before joining a workspace, and before resolving a sync conflict.
- Cloud snapshots are shared business data. Every workspace member can currently edit records; this build does not yet enforce per-screen cashier/manager permissions or maintain a detailed audit trail.
- This is not a substitute for independent backups. Export a backup regularly and keep it somewhere safe.
- Offline records remain on the current device until synced; they are not visible to other devices while offline.

FILES
index.html               Main business app (no embedded business records)
manifest.webmanifest     Installable PWA metadata
sw.js                    Offline app-shell cache
icon.svg / icon-*.png    App icons
cloud-config.js          Add Supabase Project URL and publishable/anon key here
cloud.js                 Authentication and shared workspace sync
supabase-setup.sql       Database tables, access policies, and RPC functions

TROUBLESHOOTING
- “Cloud is not configured”: verify cloud-config.js was edited and republished.
- Email confirmation: check inbox/spam, confirm the account, then sign in.
- “Invite code not found”: use the owner’s current code exactly.
- “Sync conflict”: back up both devices if possible, then choose which version should become authoritative. Do not press “replace cloud” unless you intend to overwrite shared records.
- If app changes do not appear after publishing, close/reopen the installed app or clear only the site cache (not app data) and reload.
