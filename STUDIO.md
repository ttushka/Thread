# Game Studio — north star

**Mandate:** Ship a first game that reaches **100 recurrent players**.
**Recurrent:** played on ≥2 distinct calendar days within any 7-day window.
**Hard ban:** ads-ridden, pay-to-win, energy gates, loot-box / merge / idle junk. If a real person would feel scammed after five minutes, we don't ship it.

## Game 1: Thread

Free browser precision skill game. Guide a continuous thread through a shifting field of obstacles.

| Mode | Why it exists |
|------|----------------|
| Endless | Practice, personal mastery, local high score |
| Daily Challenge | Same seeded run for everyone that UTC day — shared conversation, fair comparison |

**Retention thesis:** people come back because the feel is good and today's puzzle is a fresh shared score to beat — not because we stole their attention with dark patterns.

**v1 monetization:** none.

**Ship path:** static web app → shareable URL (itch.io + own host) → measure day-2 return with privacy-respecting, first-party stats later.

## Success bar for the MVP

- Fun is obvious in 30–60 seconds
- Restart is one input
- Keyboard + touch
- No account wall to play
- Looks like a premium indie title, not a mobile-ad casino

## Growth

See studio Players plan (go-to-100). Recurrence is the only official “100” metric.

## Tech

See `THREAD-TECH-PLAN-APPROVED.md` in studio canon. This repo is the playable Thread MVP: Vite + TypeScript + Canvas, static `dist/`.
