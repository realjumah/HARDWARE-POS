# Okpotani: roles, PIN login and audit log

## Upload to GitHub (same folder as the other files)
access.js (NEW), index.html, cloud.js, sw.js, theme.css, pdf.js. credit.js is unchanged.
sw.js is now okpotani-hardware-firebase-v24 and lists access.js. Open the app twice online so the new version installs.

## First time
1. Open the app: it asks for the owner name and a 4-digit PIN (twice).
2. It shows a recovery code ONCE. Write it on paper.
3. Your old "served by" names become staff records with no PIN. Go to More > Staff & roles, tap each name, set role and PIN.
4. On the other phones: they download the staff list from the cloud. Nothing else to do.
New phone for an existing cloud shop: on the setup screen tap "Connect first", sign in to the cloud, then the PIN screen appears.

## Where things are
- More > Staff & roles (owner): add/edit/disable/delete staff, reset PINs, on/off switches per role, lock time (5/15/30 min/never), new recovery code.
- More > Audit log (owner): filter by date, staff, action, text. Excel and PDF, download or share. "Check log is untouched" tests the hash chain.
- Header name button: Switch user / Change my PIN.

## What is recorded
Logins, wrong PINs, lockouts, PIN changes/resets, recovery; receipts edited/deleted (before/after); discounts; selling and buying price changes; stock adjustments, stock takes, opening stock; stock arrivals; expenses added/edited/deleted; credit payments; credit limits; returns; advances; cash book entries; backups and restores; staff and role changes. Doing 25+ changes at once (for example "delete records by date") is one summary line.
New receipts, returns, expenses, purchases, adjustments get "by" = the signed-in person automatically. Owner/manager may still change "served by" on the sale screen.

## Size and Firebase cost
One audit record per phone per day (not one per event). Months older than 60 days are merged into one archive record per phone per month (data is kept, only repacked). Restoring a backup keeps staff, PINs, role switches and the audit log as they are now.

## What this can and cannot protect against
CAN: staff borrowing the phone; attendants seeing buying prices, profit, reports, settings; accidental deletes; honest "who did it" answers; guessing PINs on the phone (5 tries, 5 minute lock); PINs are stored only as PBKDF2 hashes with a salt per person.
CANNOT:
- The app runs in the browser. Someone who knows how to open browser developer tools on an unlocked or stolen phone can read the stored data. The lock is for shop-floor use, not for experts.
- A 4-digit PIN has only 10,000 combinations. If someone gets the hashes (from the phone's storage or Firebase), they can find PINs by brute force in minutes, even with hashing. Do not reuse these PINs anywhere else.
- Firebase rules only see "this phone is signed in as a shop member", not which PIN user is using it. Every phone signed in to the shop can technically read and write all shop data. Roles are enforced by the app, not by Firebase. Real server-side roles need a separate Firebase login per person (and Cloud Functions). Do not give the cloud shop code to people you would not trust with the data.
- The audit log cannot be edited in the app, and each entry is chained to the one before so edits in the middle are detected. But anyone with Firebase console access (you) can edit or delete documents. A deleted last entry is not detectable. A phone with the wrong clock writes wrong times.
- Wrong-PIN counters are per phone; someone can try 5 times on each phone.
- If the owner loses the PIN AND the recovery code AND cannot sign in to the cloud owner account, there is no way back in except a backup file restored on a fresh browser. Keep the recovery code safe.
Suggested Firebase rule (adapt to your existing rules and test in the Rules Playground): make archive records write-once, e.g. for documents whose id starts "AA:" allow create but not update or delete.

## Not covered (files I did not receive)
finder.js, assistant.js, subscription.js, closing.js, profit.js, returns.js, stock.js were not uploaded, so I could not edit their screens. Their entry points are blocked or hidden by role (profit report, closing, stock take/adjust, returns, assistant), and the stamping and audit work for them automatically. But "Search everything" and any card inside those files may still show a cost figure to a role without "See buying prices". Send those files if you want them cleaned too.
