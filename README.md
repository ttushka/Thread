# Thread

Free browser precision skill game. Guide a continuous thread through a shifting field of obstacles.

No accounts. No ads. No pay-to-win. Play immediately — progress lives in this browser as `thread.v1`.

| Mode | Why it exists |
|------|----------------|
| **Play Endless** | Practice, personal mastery, local high score |
| **Daily Challenge** | The same seeded run for everyone that UTC day |

## Play

External play (GitHub Pages, always valid): **https://ttushka.github.io/Thread/**

```bash
npm install
npm run dev
```

Then open the printed local URL (`http://localhost:5173/Thread/` — Vite `base` matches GitHub Pages). Keyboard: **A/D** or **←/→** to steer. Pointer: drag left and right. Advance is automatic. After a snag, **Enter** / **R** / **Retry** starts again immediately. **Sound** (title + HUD) mutes the bed; the choice is stored in `thread.v1`.

Daily Challenge deep link: `/Thread/?daily=YYYY-MM-DD` locally, or `https://ttushka.github.io/Thread/?daily=YYYY-MM-DD` on Pages (that UTC date’s seed).

## GitHub Pages

Playable build: **https://ttushka.github.io/Thread/**

Pushes to `main` (and manual **Actions → pages → Run workflow**) run `npm ci && npm run build` and publish `dist/` with GitHub Actions. Vite `base` is `/Thread/` so JS/CSS/favicon resolve on that project URL, including `?daily=` share links. Production builds set `VITE_PUBLIC_URL=https://ttushka.github.io/Thread` so Daily “Copy challenge” lines point at Pages rather than `localhost`.

### First-time enablement

GitHub often cannot turn this on from the API. Do it once in the UI:

1. Open **https://github.com/ttushka/Thread/settings/pages**
2. Under **Build and deployment → Source**, choose **GitHub Actions**
3. Save. Re-run **Actions → pages** (or push to `main`) if the first deploy failed with a Pages permissions / source error.

After that, the `github-pages` environment appears on its own. The site URL is `https://ttushka.github.io/Thread/` (GitHub may redirect `/Thread` → `/Thread/`).

## itch.io (HTML5)

Pages stays the canonical public URL: **https://ttushka.github.io/Thread/**. itch.io is a second host for the same build, played inside their iframe.

```bash
npm run build:itch
```

That command:

1. Typechecks, then runs Vite with **`base: "./"`** (relative asset paths — no `/Thread/` prefixes, which 404 in the itch iframe).
2. Zips the **contents** of `dist/` to `thread-itch.zip` with `index.html` at the ZIP root (not nested in a `dist/` folder).

GitHub Pages keeps using `npm run build` (`base` `/Thread/`, via default / `VITE_BASE`). Daily “Copy challenge” still points at Pages (`VITE_PUBLIC_URL`).

### Upload on itch

1. Create or edit the project → **Kind of project: HTML**.
2. Upload `thread-itch.zip`.
3. Check **This file will be played in the browser**.
4. Embed options → **Embed in page**.
5. Viewport / embed size: **540 × 960** (portrait). The playfield is 360×640 (9:16) and the canvas fills the iframe; 540×960 is 1.5× that. Landscape **960 × 540** works but letterboxes the playfield.
6. Optional: mark **Mobile friendly** (touch steer is supported) and keep a fullscreen control if you want.

If the game is a white screen on itch, the ZIP almost always has `index.html` inside a folder, or JS/CSS still request `/Thread/assets/…`. Re-run `npm run build:itch` and upload the new zip.

## Test & build

```bash
npm test
npm run build
npm run build:itch
```

`npm run build` writes Pages output to `dist/` (Vite, no server). Preview with `npm run preview`. `npm run build:itch` overwrites `dist/` with the relative-base build and writes `thread-itch.zip` at the repo root.

## Daily Challenge clock

Daily seeds from **UTC**, not your local timezone:

- Date key = `new Date().toISOString().slice(0, 10)` → `YYYY-MM-DD`
- Hash input = `"thread-daily-" + dateKey + ":" + SEED_VERSION` (FNV-1a 32-bit)
- Layout PRNG is mulberry32 from that seed — never `Math.random()` on the Daily path
- **Resets at 00:00 UTC**

Same UTC day → same obstacle stream for every player. After midnight UTC, a new layout; yesterday’s daily best does not carry over.

## Stack

Vite + TypeScript + Canvas. No analytics SDK. No accounts.

## Studio

See [STUDIO.md](./STUDIO.md) for the north star (100 recurrent players, no dark patterns).
