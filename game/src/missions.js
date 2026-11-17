// Missions and the story of SOLARA HEAT: five jobs for Mara Voss, from a
// homecoming at the marina to the big score at the bank. Each mission is a
// small state machine: a target, a beacon, dialogue, and a cash reward.
import * as THREE from 'three';
import { clamp } from './utils.js';
import { createCarMesh, Car } from './vehicles.js';
import { PLACES } from './city.js';

const MISSIONS = [
  {
    id: 1, title: 'HOMECOMING',
    brief: 'Dario is waiting at the Marina. Drive or walk over and hear him out.',
    target: () => ({ x: PLACES.marina.x, z: PLACES.marina.z, radius: 8 }),
    startText: 'Dario: "Mara! You came back. The city missed its best driver."',
    doneText: 'Dario: "Rico needs a car lifted. A gold one. You in?"',
    reward: 200,
  },
  {
    id: 2, title: 'HOT WHEELS',
    brief: 'Steal the gold sports car parked by the plaza and deliver it to Rico\'s Garage. It is hot — the cops will notice.',
    target: () => ({ x: PLACES.garage.x, z: PLACES.garage.z, radius: 10 }),
    needsCar: true,
    startText: 'The gold coupe is parked by the plaza. Take it. Quietly is optional.',
    doneText: 'Rico: "Clean. Real clean. Here is your cut."',
    reward: 500,
  },
  {
    id: 3, title: 'THE COURIER',
    brief: 'A courier is running Dario\'s package across town. Ram his car until it stops, grab the package, bring it to Dario at the Marina.',
    target: () => ({ x: PLACES.marina.x, z: PLACES.marina.z, radius: 8 }),
    startText: 'The courier will not stop for a friendly wave. Stop his car.',
    doneText: 'Dario: "Package safe. You drive like the old days, Mara."',
    reward: 800,
  },
  {
    id: 4, title: 'HEAT WAVE',
    brief: 'The PSPD is onto you. Survive the heat: lose the cops, then get to the Safehouse.',
    target: () => ({ x: PLACES.safehouse.x, z: PLACES.safehouse.z, radius: 8 }),
    startText: 'Sirens everywhere. Lose them, then vanish into the Safehouse.',
    doneText: 'Safe. For now. The city never forgets, but it does forgive — for a price.',
    reward: 600,
  },
  {
    id: 5, title: 'THE BIG SCORE',
    brief: 'Solara National Bank. Five guards. One vault of cash. Take it all, then run for the boat at the Docks.',
    target: () => ({ x: PLACES.docks.x, z: PLACES.docks.z, radius: 10 }),
    startText: 'This is the one, Mara. The whole city is watching.',
    doneText: 'The boat pulls away as the sirens fade. Port Solara is yours.',
    reward: 2000,
  },
];

export class MissionSystem {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.index = 0; // next mission to start (0-based)
    this.active = null;
    this.phase = 'idle'; // idle | active | done
    this.beacon = null;
    this.marker = null;
    this.courier = null;
    this.goldCar = null;
    this.package = null;
    this.cashBag = null;
    this.heatTimer = 0;
    this.surviveTimer = 0;
    this.guardsLeft = 0;
    this.missionTime = 0;
    this.buildBeacon();
  }

  buildBeacon() {
    const geo = new THREE.CylinderGeometry(2.2, 2.2, 60, 16, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
    this.beacon = new THREE.Mesh(geo, mat);
    this.beacon.position.y = 30;
    this.beacon.visible = false;
    this.scene.add(this.beacon);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3, 4.2, 24),
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    ring.visible = false;
    this.scene.add(ring);
    this.marker = ring;
  }

  currentDef() { return MISSIONS[this.index] || null; }

  startMission(i) {
    const def = MISSIONS[i];
    if (!def) return;
    this.index = i;
    this.active = { def, step: 'go', t: 0 };
    this.phase = 'active';
    this.missionTime = 0;
    this.game.audio.missionStart();
    this.game.hud.banner(def.title, 'MISSION ' + def.id + ' OF 5 — ' + def.brief);
    this.game.hud.feed(def.startText);
    this.game.hud.setObjective(def.title, def.brief);
    if (def.id === 2) this.spawnGoldCar();
    if (def.id === 3) this.spawnCourier();
    if (def.id === 4) { this.game.police.setStars(2, this.game); this.surviveTimer = 0; }
    if (def.id === 5) this.spawnGuards();
    this.game.saveGame();
  }

  spawnGoldCar() {
    const mesh = createCarMesh(0xffd700, 'sport');
    const car = new Car(mesh, 24, 18, Math.PI / 2, { kind: 'sport', driver: false, maxSpeed: 46 });
    car.parked = true;
    car.missionCar = true;
    this.scene.add(mesh);
    this.game.traffic.cars.push(car);
    this.goldCar = car;
  }

  spawnCourier() {
    const mesh = createCarMesh(0x9b59b6, 'sedan');
    const car = new Car(mesh, 120, 100, 0, { kind: 'sedan', maxSpeed: 30 });
    car.courier = true;
    car.cruise = 20;
    car.route = [];
    this.scene.add(mesh);
    this.game.traffic.cars.push(car);
    this.courier = car;
    this.game.hud.feed('The courier is on the move — east side, purple sedan.');
  }

  spawnGuards() {
    this.guardsLeft = 0;
    const spots = [
      [PLACES.bank.x + 14, PLACES.bank.z + 8], [PLACES.bank.x - 12, PLACES.bank.z + 10],
      [PLACES.bank.x + 8, PLACES.bank.z - 14], [PLACES.bank.x - 16, PLACES.bank.z - 6],
      [PLACES.bank.x, PLACES.bank.z + 20],
    ];
    for (const [x, z] of spots) {
      const e = this.game.combat.spawnEnemy(x, z, { jacket: 0x2c3e50, health: 100 });
      e.missionGuard = true;
      this.guardsLeft++;
    }
    this.game.hud.feed('Five guards between you and the vault.');
  }

  dropPackage(x, z) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.7, 0.8),
      new THREE.MeshLambertMaterial({ color: 0x8e44ad, emissive: 0x8e44ad, emissiveIntensity: 0.35 }),
    );
    mesh.position.set(x, 0.5, z);
    this.scene.add(mesh);
    this.package = { mesh, x, z };
    this.game.hud.feed('The package dropped! Grab it.');
  }

  dropCashBag(x, z) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.9, 0.9),
      new THREE.MeshLambertMaterial({ color: 0x27ae60, emissive: 0x27ae60, emissiveIntensity: 0.35 }),
    );
    mesh.position.set(x, 0.6, z);
    this.scene.add(mesh);
    this.cashBag = { mesh, x, z };
    this.game.hud.feed('The vault cash is yours. Run for the Docks!');
  }

  onEnemyKilled(e) {
    if (e.missionGuard && this.active && this.active.def.id === 5) {
      this.guardsLeft--;
      this.game.hud.feed(`Guards left: ${this.guardsLeft}`);
      if (this.guardsLeft <= 0) {
        this.dropCashBag(PLACES.bank.x, PLACES.bank.z);
        this.active.step = 'escape';
      }
    }
  }

  completeMission() {
    const def = this.active.def;
    this.game.cash += def.reward;
    this.game.audio.missionDone();
    this.game.hud.banner('JOB DONE', def.title + ' — +$' + def.reward.toLocaleString('en-US'));
    this.game.hud.feed(def.doneText);
    this.phase = 'idle';
    this.active = null;
    this.index++;
    this.beacon.visible = false;
    this.marker.visible = false;
    if (this.index >= MISSIONS.length) {
      this.game.hud.setObjective('LEGEND OF SOLARA', 'All five jobs done. The city is yours — free roam, Mara.');
      this.game.showMissionComplete('SOLARA IS YOURS', 'All five jobs complete. $4,100 earned. Free roam unlocked.');
    } else {
      const next = MISSIONS[this.index];
      this.game.hud.setObjective('NEXT JOB: ' + next.title, 'Press M to start: ' + next.brief);
    }
    if (this.cashBag) { this.scene.remove(this.cashBag.mesh); this.cashBag = null; }
    if (this.package) { this.scene.remove(this.package.mesh); this.package = null; }
    this.game.saveGame();
  }

  update(dt, player) {
    const px = player.inCar ? player.inCar.x : player.x;
    const pz = player.inCar ? player.inCar.z : player.z;
    this.missionTime += dt;
    if (!this.active) {
      this.beacon.visible = false;
      this.marker.visible = false;
      return;
    }
    const def = this.active.def;
    // Courier behaviour: drive away from the player, ram-able.
    if (this.courier && this.active.step === 'go' && def.id === 3) {
      const c = this.courier;
      if (!c.disabled) {
        const dx = c.x - px, dz = c.z - pz;
        const d = Math.hypot(dx, dz) || 1;
        const away = Math.atan2(dx, dz);
        const steer = clamp(((away - c.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -1, 1);
        c.drive(d < 25 ? 1 : 0.6, steer, false, dt);
        c.x = clamp(c.x, -445, 445); c.z = clamp(c.z, -445, 445);
        // Ram damage from the player's car.
        if (player.inCar && d < 4.8) {
          c.health -= 40 * dt * 4;
          player.inCar.speed *= 0.96;
          if (c.health <= 0) {
            c.disabled = true;
            this.dropPackage(c.x + 3, c.z + 3);
            this.active.step = 'pickup';
            this.game.hud.feed('Courier stopped! Grab the package.');
          }
        }
      }
    }
    // Mission 2: the gold car must be the one delivered.
    if (def.id === 2 && this.active.step === 'go' && this.goldCar) {
      if (player.inCar === this.goldCar) this.active.step = 'deliver';
    }
    // Mission 4: survive until the heat is gone, then reach the safehouse.
    if (def.id === 4) {
      if (this.active.step === 'go') {
        this.surviveTimer += dt;
        if (this.game.police.stars === 0 && this.surviveTimer > 8) {
          this.active.step = 'reach';
          this.game.hud.feed('Clean! Now get to the Safehouse.');
        }
      }
    }
    // Mission 5: after the guards fall, the cash bag must be picked up.
    if (def.id === 5 && this.cashBag) {
      const d = Math.hypot(this.cashBag.x - px, this.cashBag.z - pz);
      if (d < 3 && !player.inCar) {
        this.scene.remove(this.cashBag.mesh);
        this.cashBag = null;
        this.active.step = 'escape';
        this.game.hud.feed('Cash secured. To the Docks!');
      }
    }
    // Package pickup (mission 3).
    if (def.id === 3 && this.package && this.active.step === 'pickup') {
      const d = Math.hypot(this.package.x - px, this.package.z - pz);
      if (d < 3 && !player.inCar) {
        this.scene.remove(this.package.mesh);
        this.package = null;
        this.active.step = 'deliver';
        this.game.hud.feed('Package in hand. Bring it to Dario at the Marina.');
      }
    }
    // Target / beacon.
    let tx, tz, tr;
    if (def.id === 3 && this.active.step === 'go' && this.courier) { tx = this.courier.x; tz = this.courier.z; tr = 6; }
    else if (def.id === 2 && this.active.step === 'go' && this.goldCar) { tx = this.goldCar.x; tz = this.goldCar.z; tr = 6; }
    else if (def.id === 5 && this.active.step === 'go') { tx = PLACES.bank.x; tz = PLACES.bank.z; tr = 12; }
    else if (def.id === 5 && this.active.step === 'escape') { tx = PLACES.docks.x; tz = PLACES.docks.z; tr = 10; }
    else if (def.id === 4 && this.active.step === 'go') { tx = px; tz = pz; tr = 9999; } // no fixed target while surviving
    else { const t = def.target(); tx = t.x; tz = t.z; tr = t.radius; }
    const dTarget = Math.hypot(tx - px, tz - pz);
    this.game.hud.setObjectiveDist(dTarget, def.id === 4 && this.active.step === 'go' ? 'LOSE THE COPS' : null);
    if (def.id === 4 && this.active.step === 'go') {
      this.beacon.visible = false;
      this.marker.visible = false;
    } else {
      this.beacon.visible = true;
      this.beacon.position.set(tx, 30, tz);
      this.beacon.material.opacity = 0.22 + Math.sin(this.missionTime * 3) * 0.08;
      this.marker.visible = true;
      this.marker.position.set(tx, 0.15, tz);
      const s = 1 + Math.sin(this.missionTime * 3) * 0.12;
      this.marker.scale.set(s, s, 1);
    }
    this.game.missionTarget = { x: tx, z: tz };
    // Arrival completes the mission (except steps that gate it).
    if (dTarget < tr) {
      if (def.id === 2 && this.active.step === 'go') return; // must be in the gold car
      if (def.id === 3 && this.active.step !== 'deliver') return;
      if (def.id === 4 && this.active.step !== 'reach') return;
      if (def.id === 5 && this.active.step !== 'escape') return;
      this.completeMission();
    }
  }
}

export { MISSIONS };
