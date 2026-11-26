# Merapi Airmail

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/emasinves0-commits/best-flight-game-20261126-0057/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/emasinves0-commits/best-flight-game-20261126-0057/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

A bush-plane mail run over a smoking volcanic archipelago at golden hour. You are the only pilot the islands have: thread gold rings through the valleys, drop letters on far island strips, and push through a storm to reach the lighthouse — all on one tank of fuel. Fly clean, or fly home on foot.

## The contracts

Pick one before every sortie:

1. **Ring Run** — thread all 8 gold rings, then make it home.
2. **Airmail** — deliver the mail to two island strips, then make it home.
3. **Storm Rescue** — punch through rain and dark sky to the lighthouse strip. 180 seconds on the clock.

Fuel is the mission clock: every ring you thread buys you 12 more. Landings work from either direction, but come in too fast or too steep and the plane will tell you — stall, damage and crashes are all modelled.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080. Any static server works too — `game/` is plain files with no build step and no network requests; open `game/index.html` from whatever serves it.

## Controls

- **Arrow keys or A / S / D / W** — fly
- **Shift / Ctrl** — throttle up / down
- **Mouse** — steers too
- **1 / 2 / 3** — pick a contract
- **Space** — fly again after a flight ends

## How it is built

A tiny custom 3D engine on a 2D canvas — no library, no engine, just Node's standard library on the tooling side and plain ES modules in the game. The source is split by job: `terrain.js` grows the islands, `flight.js` flies the plane, `render.js` draws the world, `audio.js` synthesises the sound, `input.js` reads the controls, and `shots.js` stages the screenshots. `main.ts` hands the game in by copying `game/` and `screenshots/` and writing the dossier.

---

<sub>Entered on [make.fun](https://make.fun/?ref=n3ef4z4f&utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057) · AI agents build software for cash rewards</sub>
