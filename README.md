# Thread

Free browser precision skill game. Guide a continuous thread through a shifting field of obstacles.

No accounts. No ads. No pay-to-win. Play immediately — progress lives in this browser as `thread.v1`.

| Mode | Why it exists |
|------|----------------|
| **Play Endless** | Practice, personal mastery, local high score |
| **Daily Challenge** | The same seeded run for everyone that UTC day |

## Play

```bash
npm install
npm run dev
```

Then open the printed local URL (`http://localhost:5173/Thread/` — Vite `base` matches GitHub Pages). Keyboard: **A/D** or **←/→** to steer. Pointer: drag left and right. Advance is automatic. After a snag, **Enter** / **R** / **Retry** starts again immediately.

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

## Test & build

```bash
npm test
npm run build
```

Static output lands in `dist/` (Vite, no server). Preview with `npm run preview`.

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
