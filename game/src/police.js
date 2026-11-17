// The wanted system and the Port Solara Police Department. Crimes add heat;
// heat maps to 0–5 stars; police cars and foot officers spawn, chase and ram
// the player, and lay off when the player stays out of sight long enough.
import * as THREE from 'three';
import { clamp, angleDiff, angleLerp, collideCircleBoxes } from './utils.js';
import { createCarMesh, Car } from './vehicles.js';
import { createPersonMesh } from './player.js';

const STAR_LIMITS = [0, 120, 280, 480, 700, 900]; // heat thresholds per star
export function heatToStars(heat) {
  let s = 0;
  for (let i = 1; i <= 5; i++) if (heat >= STAR_LIMITS[i]) s = i;
  return s;
}

export class PoliceSystem {
  constructor(scene, colliders, traffic) {
    this.scene = scene;
    this.colliders = colliders;
    this.traffic = traffic;
    this.heat = 0;
    this.stars = 0;
    this.copCars = [];
    this.cops = []; // foot officers
    this.spawnTimer = 0;
    this.unseenTimer = 0;
    this.bustTimer = 0;
    this.maxCopCars = 0;
    this.lightTimer = 0;
  }

  addHeat(amount, game) {
    this.heat = clamp(this.heat + amount, 0, 1000);
    const s = heatToStars(this.heat);
    if (s > this.stars && game) game.hud.flash(`WANTED LEVEL ${s} — PSPD ON YOUR TAIL`);
    this.stars = s;
  }

  setStars(n, game) {
    this.heat = n === 0 ? 0 : STAR_LIMITS[n] + 5;
    this.stars = n;
    if (game) game.hud.updateWanted(n);
  }

  clearWanted(game) {
    this.heat = 0;
    this.stars = 0;
    this.despawnAll();
    if (game) game.hud.updateWanted(0);
  }

  despawnAll() {
    for (const c of this.copCars) this.scene.remove(c.mesh);
    for (const c of this.cops) this.scene.remove(c.mesh);
    this.copCars = [];
    this.cops = [];
  }

  spawnCopCarNear(x, z) {
    const angle = Math.random() * Math.PI * 2;
    const d = 55 + Math.random() * 40;
    const sx = clamp(x + Math.cos(angle) * d, -440, 440);
    const sz = clamp(z + Math.sin(angle) * d, -440, 440);
    // Snap to the nearest road line so the car starts on asphalt.
    const rx = Math.round(sx / 100) * 100;
    const rz = Math.round(sz / 100) * 100;
    const mesh = createCarMesh(0x1a1a22, 'cop');
    const car = new Car(mesh, rx, rz, Math.atan2(x - rx, z - rz), { kind: 'cop', isCop: true, maxSpeed: 44 });
    this.scene.add(mesh);
    this.copCars.push(car);
    return car;
  }

  spawnFootCopNear(x, z) {
    const angle = Math.random() * Math.PI * 2;
    const sx = clamp(x + Math.cos(angle) * 18, -440, 440);
    const sz = clamp(z + Math.sin(angle) * 18, -440, 440);
    const mesh = createPersonMesh(0x1c2f6b, 0x14181f); // PSPD navy uniform
    mesh.position.set(sx, 0, sz);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.4), new THREE.MeshLambertMaterial({ color: 0x0c1440 }));
    cap.position.y = 1.98;
    mesh.add(cap);
    this.scene.add(mesh);
    const cop = { mesh, x: sx, z: sz, heading: 0, speed: 0, walkPhase: 0, radius: 0.7, state: 'chase' };
    this.cops.push(cop);
    return cop;
  }

  update(dt, game) {
    const player = game.player;
    const px = player.inCar ? player.inCar.x : player.x;
    const pz = player.inCar ? player.inCar.z : player.z;
    const stars = this.stars;

    // Desired force scales with stars.
    const wantCars = stars === 0 ? 0 : stars === 1 ? 1 : stars === 2 ? 2 : stars === 3 ? 3 : stars === 4 ? 4 : 5;
    const wantCops = stars >= 2 && !player.inCar ? Math.min(4, stars) : 0;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.2;
      if (this.copCars.length < wantCars) this.spawnCopCarNear(px, pz);
      if (this.cops.length < wantCops) this.spawnFootCopNear(px, pz);
    }
    // Trim excess when wanted drops.
    while (this.copCars.length > wantCars) {
      const c = this.copCars.pop();
      this.scene.remove(c.mesh);
      const idx = game.traffic.cars.indexOf(c);
      if (idx >= 0) game.traffic.cars.splice(idx, 1);
    }
    while (this.cops.length > wantCops) this.scene.remove(this.cops.pop().mesh);

    // Heat decays when no police can see the player.
    let nearestCop = Infinity;
    for (const c of this.copCars) nearestCop = Math.min(nearestCop, Math.hypot(c.x - px, c.z - pz));
    for (const c of this.cops) nearestCop = Math.min(nearestCop, Math.hypot(c.x - px, c.z - pz));
    if (stars > 0) {
      if (nearestCop > 70) {
        this.unseenTimer += dt;
        this.heat = Math.max(0, this.heat - dt * (6 + this.unseenTimer * 1.5));
      } else this.unseenTimer = 0;
      const s = heatToStars(this.heat);
      if (s !== this.stars) {
        this.stars = s;
        game.hud.updateWanted(s);
        if (s === 0) game.hud.flash('You lost the cops. Stay clean, Mara.');
      }
    }

    // Cop cars chase and ram.
    for (const car of this.copCars) {
      const dx = px - car.x, dz = pz - car.z;
      const d = Math.hypot(dx, dz);
      const wantHeading = Math.atan2(dx, dz);
      const dh = angleDiff(car.heading, wantHeading);
      const steer = clamp(dh * 2.2, -1, 1);
      let throttle = d > 10 ? 0.95 : 0.6;
      if (Math.abs(dh) > 1.2) throttle = 0.3;
      car.drive(throttle, steer, false, dt);
      const [nx, nz] = collideCircleBoxes(car.x, car.z, car.radius, this.colliders);
      car.x = nx; car.z = nz;
      car.x = clamp(car.x, -445, 445); car.z = clamp(car.z, -445, 445);
      // Ram the player's car: damage + shove.
      if (player.inCar && d < 4.6) {
        player.inCar.speed *= 0.92;
        car.speed *= 0.9;
        if (Math.abs(player.inCar.speed) > 6 && game.audio) game.audio.crash();
        player.inCar.health -= dt * 6;
      }
      // Flash the light bar.
      this.lightTimer += dt;
      const bar = car.mesh.getObjectByName('lightbar');
      if (bar) bar.material.color.setHex(Math.floor(this.lightTimer * 4) % 2 ? 0xff2222 : 0x2244ff);
    }

    // Foot cops run the player down; touching one starts a bust.
    let touching = false;
    for (const cop of this.cops) {
      const dx = px - cop.x, dz = pz - cop.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.8) {
        cop.heading = Math.atan2(dx, dz);
        const speed = 7.2;
        cop.x += Math.sin(cop.heading) * speed * dt;
        cop.z += Math.cos(cop.heading) * speed * dt;
        cop.walkPhase += speed * dt * 2.4;
      } else if (!player.inCar) {
        touching = true;
      }
      const u = cop.mesh.userData;
      const swing = Math.sin(cop.walkPhase) * 0.55;
      u.legL.rotation.x = swing; u.legR.rotation.x = -swing;
      u.armL.rotation.x = -swing * 0.7; u.armR.rotation.x = swing * 0.7;
      cop.mesh.position.set(cop.x, 0, cop.z);
      cop.mesh.rotation.y = cop.heading;
    }
    if (touching && stars > 0 && !player.inCar) {
      this.bustTimer += dt;
      game.hud.setPrompt('BUSTED IN ' + Math.ceil(2 - this.bustTimer) + '…', true);
      if (this.bustTimer > 2) { this.bustTimer = 0; game.hud.promptLocked = false; game.busted(); }
    } else {
      this.bustTimer = 0;
      if (game.hud.promptLocked) { game.hud.promptLocked = false; game.hud.setPrompt(''); }
    }
  }
}
