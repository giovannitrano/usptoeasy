# USPTO Trademark Lookup

A clean, fast trademark lookup tool for the US Patent & Trademark Office.
No API keys required. Deploy to Netlify in 2 minutes.

## Features
- 🔍 Search by 8-digit serial number
- 📋 Auto-detects trademark numbers from clipboard (no click needed)
- 🖼️ Shows trademark logo with zoom-in viewer
- 👤 Displays owner/applicant information
- 🔗 Direct links to TSDR Status and TM Search pages
- ⚡ Serverless function proxy handles CORS + data extraction

## Deploy to Netlify

### Option A — Drag & Drop (fastest)
1. Go to https://app.netlify.com
2. Log in and click **"Add new site"** → **"Deploy manually"**
3. Drag the entire `uspto-trademark` folder onto the deploy area
4. Done — your site is live in ~30 seconds

### Option B — GitHub
1. Push this folder to a GitHub repo
2. In Netlify: **Add new site** → **Import from Git** → select your repo
3. Build settings are auto-detected from `netlify.toml`
4. Click **Deploy site**

## Project Structure
```
uspto-trademark/
├── index.html                    ← Frontend UI
├── netlify.toml                  ← Netlify config
└── netlify/
    └── functions/
        └── trademark.js          ← Serverless proxy (Node.js)
```

## How it works
- The **frontend** (`index.html`) handles UI, clipboard detection, and display
- The **serverless function** (`trademark.js`) runs on Netlify's servers and:
  - Calls the USPTO TSDR internal JSON endpoints
  - Falls back to the TM Search API
  - Returns trademark name, owner info, and metadata as JSON
  - Bypasses browser CORS restrictions (requests made server-side)
- The **logo** is fetched directly from `tmcms-docs.uspto.gov` by the browser

## Notes
- The TSDR website renders via JavaScript, so data is fetched from USPTO's
  underlying API endpoints. If a record isn't found via API, the tool still
  shows the logo and provides direct links to the official USPTO pages.
- Clipboard monitoring activates when you click the search field and polls
  every 700ms. It stops when you click elsewhere.
- The logo zoom viewer opens inline — click outside or press Esc to close.
