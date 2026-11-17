// Pedestrians: Port Solara's citizens. They stroll the sidewalks, chat in
// place, and flee screaming from gunfire, speeding cars and police chases.
// Hitting one is a crime; killing one is a bigger one.
import * as THREE from 'three';
import { makeRng, pick, range, clamp, collideCircleBoxes } from './utils.js';
import { createPersonMesh } from './player.js';

const JACKETS = [0x3a7bd5, 0x8e44ad, 0x16a085, 0xd4ac0d, 0xe67e22, 0x95a5a6, 0xc0392b, 0x2ecc71, 0xf5b7b1, 0x5d6d7e];
const PANTS = [0x2c3e50, 0x5d4037, 0x1a1a1a, 0x4a6b8a, 0x7b7b7b];

export class Ped {
  constructor(mesh, x, z) {
    this.mesh = mesh;
    this.x = x; this.z = z;
    this.heading = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.health = 100;
    this.state = 'walk'; // walk | idle | flee | dead
    this.target = null;
    this.wait = 0;
    this.fleeTimer = 0;
    this.radius = 0.7;
    this.walkPhase = Math.random() * 6;
    this.dead = false;
  }
}

export class PedSystem {
  constructor(scene, colliders) {
    this.scene = scene;
    this.colliders = colliders;
    this.peds = [];
    this.rng = makeRng(4242);
    this.roadLines = [];
    for (let k = -4; k <= 4; k++) this.roadLines.push(k * 100);
  }

  spawnInitial(count) {
    for (let i = 0; i < count; i++) {
      const x = range(this.rng, -430, 430);
      const z = range(this.rng, -430, 430);
      this.spawnPed(x, z);
    }
  }

  spawnPed(x, z, opts = {}) {
    const mesh = createPersonMesh(pick(this.rng, JACKETS), pick(this.rng, PANTS));
    mesh.position.set(x, 0, z);
    mesh.scale.setScalar(opts.scale || range(this.rng, 0.92, 1.08));
    const ped = new Ped(mesh, x, z);
    if (opts.state) ped.state = opts.state;
    this.scene.add(mesh);
    this.peds.push(ped);
    return ped;
  }

  // A sidewalk-ish target: near a road line, offset to the side.
  pickTarget(ped) {
    const line = pick(this.rng, this.roadLines);
    const along = (Math.floor(this.rng() * 9) - 4) * 100 + range(this.rng, -40, 40);
    const off = pick(this.rng, [-11, 11]);
    if (this.rng() < 0.5) return { x: clamp(along, -440, 440), z: clamp(line + off, -440, 440) };
    return { x: clamp(line + off, -440, 440), z: clamp(along, -440, 440) };
  }

  scare(x, z, radius) {
    for (const ped of this.peds) {
      if (ped.dead) continue;
      const d = Math.hypot(ped.x - x, ped.z - z);
      if (d < radius) {
        ped.state = 'flee';
        ped.fleeTimer = 2.5 + this.rng() * 2;
        ped.fleeFrom = { x, z };
      }
    }
  }

  update(dt, player, playerCar) {
    for (const ped of this.peds) {
      if (ped.dead) continue;
      const u = ped.mesh.userData;
      let moveX = 0, moveZ = 0, speed = 0;
      if (ped.state === 'flee') {
        ped.fleeTimer -= dt;
        const dx = ped.x - ped.fleeFrom.x, dz = ped.z - ped.fleeFrom.z;
        const d = Math.hypot(dx, dz) || 1;
        moveX = dx / d; moveZ = dz / d;
        speed = 6.5;
        ped.heading = Math.atan2(moveX, moveZ);
        if (ped.fleeTimer <= 0) ped.state = 'walk';
      } else if (ped.state === 'walk') {
        if (!ped.target) ped.target = this.pickTarget(ped);
        const dx = ped.target.x - ped.x, dz = ped.target.z - ped.z;
        const d = Math.hypot(dx, dz);
        if (d < 3) {
          ped.target = null;
          if (this.rng() < 0.3) { ped.state = 'idle'; ped.wait = range(this.rng, 2, 6); }
        } else {
          moveX = dx / d; moveZ = dz / d;
          speed = 1.6;
          ped.heading = Math.atan2(moveX, moveZ);
        }
      } else if (ped.state === 'idle') {
        ped.wait -= dt;
        if (ped.wait <= 0) ped.state = 'walk';
      }
      // A speeding car nearby makes peds scatter.
      if (playerCar && Math.abs(playerCar.speed) > 12) {
        const d = Math.hypot(ped.x - playerCar.x, ped.z - playerCar.z);
        if (d < 10 && ped.state !== 'flee') {
          ped.state = 'flee'; ped.fleeTimer = 2; ped.fleeFrom = { x: playerCar.x, z: playerCar.z };
        }
      }
      ped.x += moveX * speed * dt;
      ped.z += moveZ * speed * dt;
      const [nx, nz] = collideCircleBoxes(ped.x, ped.z, ped.radius, this.colliders);
      ped.x = nx; ped.z = nz;
      ped.x = clamp(ped.x, -445, 445); ped.z = clamp(ped.z, -445, 445);
      ped.mesh.position.set(ped.x, 0, ped.z);
      ped.mesh.rotation.y = ped.heading;
      ped.walkPhase += speed * dt * 2.4;
      const swing = speed > 0.2 ? Math.sin(ped.walkPhase) * 0.5 : 0;
      u.legL.rotation.x = swing; u.legR.rotation.x = -swing;
      u.armL.rotation.x = -swing * 0.7; u.armR.rotation.x = swing * 0.7;
    }
  }

  kill(ped, game) {
    if (ped.dead) return;
    ped.dead = true;
    ped.health = 0;
    ped.mesh.rotation.x = -Math.PI / 2; // fall over
    ped.mesh.position.y = 0.35;
    if (game) game.addHeat(120, 'A pedestrian was killed');
  }
}
