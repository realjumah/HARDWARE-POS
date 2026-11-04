TURNING THE APP INTO AN ANDROID APP
===================================

LEVEL 1 - Install from Chrome (works today, nothing to build)
  Open the app in Chrome on the phone > menu > Install app (or Add to Home screen).
  You get a home-screen icon, full-screen window without the browser bar, splash colours from the manifest,
  and long-press shortcuts (New sale, Stock, Money, Reports).

LEVEL 2 - A real .apk / .aab file (Trusted Web Activity)
  1. Go to pwabuilder.com and enter your app address (https://realjumah.github.io/HARDWARE-POS/).
  2. Check the scores. The manifest, service worker and icons in this update are there to pass them.
  3. Choose Package for stores > Android. Download the zip it gives you.
  4. KEEP the signing key file and its passwords from that zip somewhere safe (you need the same key for every update).
  5. Install the .apk on a phone (allow "install unknown apps" for your file manager), or upload the .aab to Google Play.
     Google Play needs a developer account with a one-time registration fee (check the current amount).
  Note: to hide the browser address bar inside the app, Google needs a "Digital Asset Links" file at the root of
  your website domain. A GitHub project address (name.github.io/repo) does not give you that root, so the app may
  show a thin address bar until you use your own domain or a repository called yourname.github.io.
  PWABuilder explains this step; follow its current instructions because the process changes over time.

LEVEL 3 - A native wrapper (later project)
  Needed only for things a web page cannot do well, such as printing straight to a classic Bluetooth receipt
  printer or reading SMS. This is a bigger job and best done in its own chat.

BEFORE ANY OF THIS
  Keep downloading a backup from Setup. The app stores records in the cloud and on the phone, and a backup file
  is your safety net.
