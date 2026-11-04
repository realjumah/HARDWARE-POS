OKPOTANI PRO - NEW LOOK (design system v1)
==========================================

FILES TO UPLOAD TO GITHUB (replace the old ones, upload together)
  theme.css                 NEW  the whole look in one file
  index.html                updated (links theme.css, vector icons, app-bar buttons, Appearance settings)
  sw.js                     updated (version firebase-v15, saves theme.css and new icons)
  manifest.webmanifest      updated (brand colours, icons, app shortcuts)
  icon-192.png, icon-512.png            updated app icon (your logo)
  icon-maskable-192.png, icon-maskable-512.png   NEW round-safe icons for Android
  icon.svg                  updated small badge icon
Do NOT upload cloud.js, pdf.js, finder.js, subscription.js, firebase-config.js or firestore.rules. They are unchanged.

COLOURS
  Navy   #0B3079  brand, buttons, app bar, active tab
  Orange #F26A0A  highlight (search button glow, bars in charts)
  Page   #F3F5FA  background        Card #FFFFFF
  Text   #0F172A  main text         Muted #5A6478
  Good   #0E8A4F  profit, OK        Bad  #D92D20  loss, errors
  Dark theme: page #0A1020, card #121A2C, text #E8EDF8, action blue #8DB1FF
  All colours are variables at the top of theme.css. Change them there and the whole app follows.

TYPE (Roboto on Android, system font elsewhere)
  App bar title 17 | Page title 20 bold | Section label 12 caps | Body 15.5 | Small 13 | Figures 24 bold | Hero figure 30 bold
  Figures use tabular digits so amounts line up in lists.
  Text size can be changed per device: Setup > Appearance > Text size (Small, Normal, Large, Extra large).

SHAPE AND SPACE
  Corners 10 / 14 / 20 / 28.  Cards 20, buttons and fields 14, pop-up sheets 28 on top.
  Buttons and fields are at least 48 px tall (comfortable for thumbs).  Page margin 16.

COMPONENTS
  App bar (gradient navy, logo mark, search and calculator icons, help)  |  Hero card (gradient, orange glow)
  Stat cards  |  List rows  |  Filled, tonal and danger buttons  |  Outlined fields with focus ring
  Chips (tabs)  |  Bottom navigation with line icons and a pill on the active tab  |  Bottom sheet pop-ups
  Snackbar messages  |  Section cards with icon tiles  |  Tables with soft headers  |  Touch ripple

DARK MODE
  Setup > Appearance > Theme: Automatic (follows the phone), Light or Dark. Saved on that device only.

ACCESSIBILITY
  Main text and buttons meet normal contrast rules. Animations switch off if the phone is set to reduce motion.

HOME-SCREEN SHORTCUTS (Android)
  Long-press the installed app icon: New sale, Stock, Money, Reports open the app on that page.

GO BACK TO THE OLD LOOK
  Delete the line  <link rel="stylesheet" href="./theme.css">  in index.html. Nothing else depends on theme.css.

AFTER UPLOADING
  1. Wait one to two minutes for GitHub Pages.  2. Open the app with internet, close it fully, open it again, once or twice.
  3. If the old look still shows, check that sw.js first line says firebase-v15.
