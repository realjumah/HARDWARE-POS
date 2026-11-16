GOOGLE DRIVE HOURLY BACKUP - ONE-TIME SETUP (free)
===================================================
The app backs up to YOUR Google Drive every hour while it is open. You need a free Google "client ID" once.

1. Open console.cloud.google.com and sign in with the Google account that will hold the backups.
2. Create a project (any name, e.g. "Okpotani Backup").
3. APIs & Services > Library > search "Google Drive API" > Enable.
4. APIs & Services > OAuth consent screen: choose External, fill the app name and your email, save.
   Under Test users add your own Google email (and any other account that will connect).
5. APIs & Services > Credentials > Create credentials > OAuth client ID > Application type: Web application.
   Authorized JavaScript origins: add your GitHub Pages address, for example  https://YOURNAME.github.io
6. Copy the Client ID (ends with .apps.googleusercontent.com).
7. In the app: Setup > Google Drive backup > paste the Client ID > Save client ID > Connect Google Drive.

Notes
- Only files the app made itself (folder "Okpotani Backups") are visible to the app.
- It backs up only while the app is open and online. Restore with Setup > Restore from backup.
