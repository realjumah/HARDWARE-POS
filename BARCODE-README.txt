BARCODE SCANNING - what to upload and what to check on your phone
=================================================================
UPLOAD to GitHub (replace / add), keep all your other files as they are:
  index.html        (changed)
  sw.js             (changed: CACHE_NAME = ...-v27, three new files in the app shell)
  scan.js           (NEW)
  zxing.min.js      (NEW, backup scanner library, unchanged from @zxing/library 0.21.3)
  qrcode.js         (NEW, QR label maker, unchanged from qrcode-generator 2.0.4)
NOT changed (no need to upload again): cloud.js, theme.css, pdf.js, credit.js.
Upload ALL 5 files together. sw.js lists the new files; if one is missing the app update cannot install.

HOW IT WORKS
- Product barcodes are stored on each product as a list (several allowed). The old "Code" box also works when scanning.
- Products are not rewritten by the update. Cloud sync needed no change: each product already syncs as a whole.
- Products with no barcode get a shop code "OK" + 6 digits, only when you print their label.

CHECK ON YOUR PHONE (these cannot be tested from here)
1. Open the app online once, close it fully, open again (so the update installs). Then try the camera in airplane mode.
2. Tap Scan, allow the camera when Chrome asks. If you said Block by mistake: lock icon next to the address > Permissions > Camera > Allow.
3. Print one test sheet of labels BEFORE printing many, then scan them: lighting, label size, printer darkness.
4. In Settings of your Bluetooth/USB scanner, choose keyboard mode (HID) and "add Enter after code".
5. Stock take screen: not wired yet (stock.js was not uploaded). Upload stock.js and access.js in a new message and it will be added.
