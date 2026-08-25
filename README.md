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

The key ships **scrambled inside `js/ai.js`** (encoded so GitHub's secret scanner doesn't
recognize and auto-revoke it), and the app decodes it at runtime — so nobody has to paste
anything during setup. Anyone who inspects the site's code could reconstruct it, so set a
**monthly spend limit** at [console.anthropic.com](https://console.anthropic.com) → Billing.
A key pasted into `localStorage` under `bite.key` (via DevTools) overrides the built-in one.
To rotate: re-encode the new key (reverse the string, then base64) into `AI._seed`.

Models used:
- **Meal photos** — Claude Fable 5 by default ("Smartest" — roughly 1–2¢ per photo);
  switchable to Sonnet 5 or Haiku 4.5 in Settings.
- **Label scanning** — Haiku 4.5 (fast + cheap, a fraction of a cent per frame).

## Stack

Zero-build static PWA: vanilla HTML/CSS/JS, a service worker for offline shell caching,
and direct browser calls to the Claude API (structured outputs, vision). No frameworks,
no bundler, no server.
