# Bite 🍽️

**Point. Shoot. Tracked.** — an AI calorie tracker that runs entirely as a static site.
Snap a photo of any meal and Claude estimates calories, protein, carbs and fat. Live-scan
Nutrition Facts labels with the camera. Installable on iPhone as a home-screen app.

## Deploy to GitHub Pages

```bash
cd bite
git init
git add -A
git commit -m "Bite v1"
git branch -M main
git remote add origin https://github.com/<you>/bite.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root) → Save.**
Your app goes live at `https://<you>.github.io/bite/` in a minute or two.

## Install on iPhone

1. Open the URL in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open **Bite from the home screen** (important — the installed app keeps its own data),
   run through setup, and paste your Claude API key when asked.

## About the API key

The key is **never stored in this repo or in the deployed code** — you paste it once during
setup and it lives in the app's local storage on your phone only. Hardcoding it here would
break the app: GitHub scans public repos for Anthropic keys and they get revoked automatically,
plus anyone could steal it. Get a key at [console.anthropic.com](https://console.anthropic.com).

Models used:
- **Meal photos** — Claude Fable 5 by default ("Smartest" — roughly 1–2¢ per photo);
  switchable to Sonnet 5 or Haiku 4.5 in Settings.
- **Label scanning** — Haiku 4.5 (fast + cheap, a fraction of a cent per frame).

## Stack

Zero-build static PWA: vanilla HTML/CSS/JS, a service worker for offline shell caching,
and direct browser calls to the Claude API (structured outputs, vision). No frameworks,
no bundler, no server.
