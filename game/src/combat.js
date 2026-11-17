// Combat: Mara's pistol, enemy gunmen, melee punches and pickups.
// Hitscan shooting with a tracer line; enemies take cover-free pot shots
// back at the player. Health and ammo pickups spawn around the city.
import * as THREE from 'three';
import { clamp, makeRng, pick, range } from './utils.js';
import { createPersonMesh } from './player.js';

export class Combat {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.ammo = 12;
    this.reserve = 48;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.enemies = [];
    this.pickups = [];
    this.tracers = [];
    this.rng = makeRng(99);
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 });
    this.enemyFireTimer = 0;
  }

  spawnEnemy(x, z, opts = {}) {
    const mesh = createPersonMesh(opts.jacket ?? 0x3a3a3a, 0x1a1a1a);
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    const e = {
      mesh, x, z, heading: Math.random() * 6.28, health: opts.health ?? 100,
      speed: opts.speed ?? 4.5, state: 'guard', target: null, fireTimer: range(this.rng, 0.5, 1.5),
      radius: 0.7, dead: false, walkPhase: 0, bar: null, kind: opts.kind || 'guard',
    };
    // Health bar sprite above the head.
    const barGeo = new THREE.PlaneGeometry(1.4, 0.14);
    const barMat = new THREE.MeshBasicMaterial({ color: 0xff3333, side: THREE.DoubleSide });
    const bar = new THREE.Mesh(barGeo, barMat);
    bar.position.y = 2.25;
    mesh.add(bar);
    e.bar = bar;
    this.enemies.push(e);
    return e;
  }

  spawnPickup(x, z, kind) {
    const color = kind === 'health' ? 0x2ecc71 : 0xf1c40f;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.9, 0.9),
      new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.4 }),
    );
    mesh.position.set(x, 0.7, z);
    mesh.rotation.y = Math.PI / 4;
    this.scene.add(mesh);
    const p = { mesh, x, z, kind, spin: 0 };
    this.pickups.push(p);
    return p;
  }

  spawnInitialPickups() {
    const spots = [
      [30, 30, 'health'], [-120, 80, 'ammo'], [180, -140, 'health'], [-260, 220, 'ammo'],
      [60, -260, 'health'], [340, 60, 'ammo'], [-340, -120, 'health'], [120, 300, 'ammo'],
    ];
    for (const [x, z, kind] of spots) this.spawnPickup(x, z, kind);
  }

  fire(from, dir) {
    if (this.fireCooldown > 0 || this.reloadTimer > 0) return;
    if (this.ammo <= 0) { this.startReload(); return; }
    this.ammo--;
    this.fireCooldown = 0.22;
    this.game.audio.gunshot();
    // Find the closest hittable thing along the ray.
    const origin = new THREE.Vector3(from.x, from.y, from.z);
    const direction = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    let best = null, bestD = 70;
    const consider = (x, z, y, radius, ref) => {
      const dx = x - origin.x, dz = z - origin.z;
      const along = dx * direction.x + dz * direction.z;
      if (along < 0 || along > bestD) return;
      const px = origin.x + direction.x * along, pz = origin.z + direction.z * along;
      const perp = Math.hypot(px - x, pz - z);
      if (perp < radius + 0.5) { bestD = along; best = { ref, along }; }
    };
    for (const e of this.enemies) if (!e.dead) consider(e.x, e.z, 1.2, 0.9, { type: 'enemy', e });
    for (const p of this.game.peds.peds) if (!p.dead) consider(p.x, p.z, 1.2, 0.8, { type: 'ped', p });
    for (const c of this.game.traffic.cars) {
      if (c.isPlayer) continue;
      consider(c.x, c.z, 1.0, 2.4, { type: 'car', c });
    }
    for (const b of this.game.city.colliders) {
      // Cheap AABB ray test: treat as a point at its centre with a big radius.
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const r = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
      consider(cx, cz, 5, r, { type: 'wall' });
    }
    const end = origin.clone().addScaledVector(direction, best ? best.along : 60);
    this.addTracer(origin, end);
    if (best) {
      if (best.ref.type === 'enemy') this.damageEnemy(best.ref.e, 34);
      else if (best.ref.type === 'ped') {
        const p = best.ref.p;
        this.game.peds.kill(p, this.game);
        this.game.hud.feed('A bystander went down. The city saw it.');
      } else if (best.ref.type === 'car') {
        const c = best.ref.c;
        c.health -= 20;
        if (c.driver && !c.isCop) {
          c.driver = false;
          this.game.peds.scare(c.x, c.z, 12);
          this.game.addHeat(40, 'You shot at a driver');
        }
        if (c.health <= 0 && !c.disabled) {
          c.disabled = true;
          this.game.hud.feed('That car is wrecked.');
          if (this.game.audio) this.game.audio.crash();
        }
      }
      this.game.addHeat(8, 'Gunfire');
    }
  }

  damageEnemy(e, amount) {
    if (e.dead) return;
    e.health -= amount;
    e.state = 'attack';
    if (e.bar) e.bar.scale.x = Math.max(0.01, e.health / 100);
    if (e.health <= 0) {
      e.dead = true;
      e.mesh.rotation.x = -Math.PI / 2;
      e.mesh.position.y = 0.35;
      if (e.bar) e.bar.visible = false;
      this.game.hud.feed('Guard down.');
      if (this.game.missions) this.game.missions.onEnemyKilled(e);
    }
  }

  punchHit(player) {
    const f = { x: Math.sin(player.heading), z: Math.cos(player.heading) };
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - player.x, dz = e.z - player.z;
      const d = Math.hypot(dx, dz);
      const dot = (dx * f.x + dz * f.z) / (d || 1);
      if (d < 2.4 && dot > 0.5) {
        this.damageEnemy(e, 30);
        e.x += f.x * 1.2; e.z += f.z * 1.2;
        this.game.audio.punch();
        return true;
      }
    }
    for (const p of this.game.peds.peds) {
      if (p.dead) continue;
      const dx = p.x - player.x, dz = p.z - player.z;
      const d = Math.hypot(dx, dz);
      const dot = (dx * f.x + dz * f.z) / (d || 1);
      if (d < 2.2 && dot > 0.5) {
        this.game.peds.kill(p, this.game);
        this.game.audio.punch();
        return true;
      }
    }
    this.game.audio.punch();
    return false;
  }

  startReload() {
    if (this.reloadTimer > 0 || this.reserve <= 0 || this.ammo === 12) return;
    this.reloadTimer = 1.4;
    this.game.hud.feed('Reloading…');
  }

  addTracer(a, b) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, this.tracerMat.clone());
    this.scene.add(line);
    this.tracers.push({ line, life: 0.12 });
  }

  update(dt, player, camera) {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const need = 12 - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take; this.reserve -= take;
      }
    }
    // Tracers fade.
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.12) * 0.9;
      if (t.life <= 0) { this.scene.remove(t.line); this.tracers.splice(i, 1); }
    }
    // Pickups spin and get collected.
    const px = player.inCar ? player.inCar.x : player.x;
    const pz = player.inCar ? player.inCar.z : player.z;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.spin += dt * 2;
      p.mesh.rotation.y = p.spin;
      p.mesh.position.y = 0.7 + Math.sin(p.spin * 1.5) * 0.15;
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d < 2.2) {
        if (p.kind === 'health') { player.heal(50); this.game.hud.feed('+50 health'); }
        else { this.reserve += 24; this.game.hud.feed('+24 pistol ammo'); }
        this.game.audio.pickup();
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
      }
    }
    // Enemies: guard, chase and shoot at the player when alerted.
    const alerted = this.game.police.stars > 0 || this.enemies.some((e) => e.state === 'attack');
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = px - e.x, dz = pz - e.z;
      const d = Math.hypot(dx, dz);
      if (e.state === 'attack' || (alerted && d < 55)) {
        e.state = 'attack';
        e.heading = Math.atan2(dx, dz);
        if (d > 14) {
          e.x += Math.sin(e.heading) * e.speed * dt;
          e.z += Math.cos(e.heading) * e.speed * dt;
          e.walkPhase += e.speed * dt * 2.4;
        }
        e.fireTimer -= dt;
        if (e.fireTimer <= 0 && d < 45) {
          e.fireTimer = range(this.rng, 0.9, 1.8);
          // Enemy shot: 35% hit chance, more when close.
          const hitChance = clamp(0.55 - d / 120, 0.12, 0.5);
          const origin = new THREE.Vector3(e.x, 1.4, e.z);
          const target = new THREE.Vector3(px, 1.2, pz);
          const dir = target.clone().sub(origin).normalize();
          const spread = 0.06;
          dir.x += (Math.random() - 0.5) * spread; dir.z += (Math.random() - 0.5) * spread;
          this.addTracer(origin, origin.clone().addScaledVector(dir, Math.min(d + 4, 50)));
          this.game.audio.gunshot();
          if (Math.random() < hitChance) {
            if (player.inCar) { player.inCar.health -= 8; }
            else player.damage(9, this.game);
            this.game.hud.feed('You took a bullet.');
          }
        }
      }
      const u = e.mesh.userData;
      const swing = e.state === 'attack' ? Math.sin(e.walkPhase) * 0.5 : 0;
      u.legL.rotation.x = swing; u.legR.rotation.x = -swing;
      u.armL.rotation.x = -swing * 0.7; u.armR.rotation.x = swing * 0.7;
      e.mesh.position.set(e.x, 0, e.z);
      e.mesh.rotation.y = e.heading;
      if (e.bar) e.bar.lookAt(camera.position);
    }
  }
}
