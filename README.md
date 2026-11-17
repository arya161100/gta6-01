# SOLARA HEAT

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/arya161100/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/arya161100/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**SOLARA HEAT** is an original open-world crime game for the desktop browser,
built for make.fun's "Make GTA 6" bounty (gta6-01). You play Mara Voss, a
getaway driver who came home to the fictional coastal city of Port Solara —
and finds the city has jobs for her. Steal cars, outrun the Port Solara Police
Department, run five story missions for the fixer Dario, and pull off the big
score at Solara National Bank.

Everything is original: the city, the characters, the story, the art, the
sound and the music. Nothing is taken from Rockstar Games or any other
commercial game. The game runs entirely offline from static files — no
network request, no build step, no install. three.js is vendored under
`game/vendor/`.

## What is in the game

- **A living city** — Port Solara is a procedural 9×9 road grid with ~120
  buildings, a central park plaza with a fountain, a beach and a drifting
  ocean, palms, streetlights and props, all built deterministically from one
  seed. Golden-hour lighting, a gradient sunset sky and drifting clouds.
- **On foot and by car** — third-person walking, sprinting and jumping with
  a punch, plus arcade driving with steering, handbrake, wheel spin and
  collision damage.
- **Traffic and pedestrians** — cars drive the road grid, stop for the car
  ahead and scatter; 26 pedestrians stroll the sidewalks, chat, and flee
  from gunfire and speeding cars.
- **Steal cars** — walk up to any parked or occupied car and press **E**.
  Jacking an occupied car (or a police cruiser) draws the law's attention.
- **Wanted system and police** — crimes add heat, heat maps to 0–5 stars.
  Cop cars spawn, chase and ram you; foot officers run you down and can
  bust you. Stay out of sight and the heat cools off.
- **Combat** — a pistol with hitscan shots, tracers, reloads and ammo
  pickups; melee punches; enemy gunmen who shoot back; health pickups.
- **Five story missions** ($4,100 total) — *Homecoming*, *Hot Wheels* (steal
  a gold sports car), *The Courier* (ram a fleeing courier, grab the
  package), *Heat Wave* (lose the cops, reach the safehouse), and *The Big
  Score* (five guards, a vault of cash, a boat at the Docks). Each has a
  beacon, a waypoint ring, dialogue and a cash reward.
- **HUD and minimap** — cash, wanted stars, health, ammo, speed, a live
  clock and day counter, mission objectives with distance, prompts, a feed
  of events, and a circular minimap showing roads, cars, cops and the
  mission marker.
- **Sound** — every sound is synthesized live with WebAudio: engine hum,
  two-tone sirens, gunshots, crashes, pickups, mission jingles, and a
  bass-and-kick sunset groove that gets tenser as your wanted level rises.
- **Start and save** — a start screen with the story and controls, a
  continue option, pause, and localStorage saves (cash, mission progress,
  position, health, ammo) so a session picks up where it left off.
- **Busted / Wasted** — get caught or killed and you lose 10% of your cash
  and wake up at the safehouse.

## Controls

| Key | Action |
| --- | ------ |
| **W A S D** / arrows | Move on foot / drive |
| **Mouse drag** | Look around (camera) |
| **Mouse wheel** | Zoom camera |
| **Shift** | Sprint |
| **Space** | Jump / handbrake |
| **E** | Steal / enter car (or exit the car) |
| **Left click** | Shoot (on foot) |
| **F** | Punch |
| **R** | Reload |
| **H** | Horn |
| **M** | Start the next mission |
| **P** / **Esc** | Pause |

## How to run

The game is plain static files under `game/`. Any static server works:

```sh
node serve.ts
# then open http://localhost:8080
```

Or serve `game/` with any other static server (for example
`npx serve game` or Python's `http.server`). Open `game/index.html` in a
desktop browser — Chrome recommended. No network connection is needed; the
game makes zero network requests.

Requires Node.js 22.18 or later for `serve.ts` and for `main.ts` (the
submission program). The game itself needs only a modern desktop browser
with WebGL.

## How to play

1. Press **START ENGINE** on the menu.
2. Press **M** to start the first job, *Homecoming* — meet Dario at the
   Marina (follow the gold beacon and the minimap diamond).
3. Walk to a parked car and press **E** to steal it, then drive with
   **W A S D**. Press **E** again to get out.
4. Causing trouble raises your wanted level. At 1 star a cruiser shows up;
   at 3 stars you are in a real chase. Lose the cops by breaking line of
   sight, or outrun them.
5. Finish all five jobs to become the Legend of Solara — then keep free
   roaming. Your progress saves automatically.

## Project layout

```
game/
  index.html            start screen, HUD, screens, import map
  vendor/three.module.min.js   three.js r160 (vendored)
  src/
    main.js             wiring + frame loop, input, camera, enter/exit car
    city.js             procedural Port Solara (ground, buildings, park, beach)
    vehicles.js         car meshes, arcade driving, traffic AI
    player.js           Mara on foot + low-poly character mesh
    peds.js             pedestrians (walk / idle / flee)
    police.js           wanted heat, cop cars, foot officers, bust timer
    combat.js           pistol, enemies, melee, pickups
    missions.js         five story missions, beacons, rewards
    hud.js              HUD + circular minimap
    audio.js            WebAudio synth: engine, sirens, shots, music
    save.js             localStorage save / load
    shots.js            deterministic screenshot staging (?shot=...)
    utils.js            math helpers + seeded RNG
main.ts                 submission program: copies game/ + screenshots/,
                        writes dossier.json (makefun/dossier/v1)
serve.ts                tiny static server for local play (port 8080)
screenshots/            1-start, 2-play, 3-chase, 4-mission
vendor/makefun-game.ts  make.fun dossier library (kit copy, unchanged)
```

## Screenshots

The four screenshots under `screenshots/` are real renders of the game's
own code, staged deterministically with `?shot=start|play|chase|mission`:

1. `1-start.jpg` — the start menu over a golden-hour vista of downtown.
2. `2-play.jpg` — Mara driving a red sports car down the main avenue.
3. `3-chase.jpg` — a three-star wanted chase with PSPD cruisers on her tail.
4. `4-mission.jpg` — mission 3, *The Courier*, on foot with the beacon lit.

## License

MIT — see [LICENSE](LICENSE).

---

<sub>Entered on [make.fun](https://make.fun/?ref=3cjrh3ss&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
