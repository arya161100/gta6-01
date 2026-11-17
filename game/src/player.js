// Mara Voss on foot: third-person walking, running, jumping and punching,
// plus the low-poly character mesh (built from primitives, animated by code).
import * as THREE from 'three';
import { clamp, collideCircleBoxes, damp } from './utils.js';

export function createPersonMesh(jacket, pants, skin = 0xc98d64, hair = 0x1a1210) {
  const g = new THREE.Group();
  const jacketMat = new THREE.MeshLambertMaterial({ color: jacket });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const hairMat = new THREE.MeshLambertMaterial({ color: hair });
  const box = new THREE.BoxGeometry(1, 1, 1);
  // Legs.
  const legL = new THREE.Mesh(box, pantsMat);
  legL.scale.set(0.2, 0.8, 0.22); legL.position.set(-0.13, 0.4, 0);
  const legR = legL.clone(); legR.position.x = 0.13;
  // Torso.
  const torso = new THREE.Mesh(box, jacketMat);
  torso.scale.set(0.62, 0.68, 0.34); torso.position.y = 1.14;
  // Arms.
  const armL = new THREE.Mesh(box, jacketMat);
  armL.scale.set(0.16, 0.62, 0.2); armL.position.set(-0.4, 1.16, 0);
  const armR = armL.clone(); armR.position.x = 0.4;
  // Head + hair.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), skinMat);
  head.position.y = 1.72;
  const hairM = new THREE.Mesh(box, hairMat);
  hairM.scale.set(0.44, 0.16, 0.42); hairM.position.y = 1.9;
  for (const m of [legL, legR, torso, armL, armR, head, hairM]) { m.castShadow = true; g.add(m); }
  g.userData = { legL, legR, armL, armR, torso, head };
  return g;
}

export class Player {
  constructor(scene, x, z) {
    this.mesh = createPersonMesh(0xd94f30, 0x2c3e50); // Mara: red jacket, dark jeans
    this.mesh.position.set(x, 0, z);
    scene.add(this.mesh);
    this.x = x; this.z = z;
    this.y = 0; this.vy = 0;
    this.heading = Math.PI; // facing the camera start
    this.speed = 0;
    this.health = 100;
    this.maxHealth = 100;
    this.inCar = null;
    this.radius = 0.7;
    this.onGround = true;
    this.walkPhase = 0;
    this.punchTimer = 0;
    this.punchCooldown = 0;
    this.hurtTimer = 0;
  }

  damage(amount, game) {
    if (this.health <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.hurtTimer = 0.35;
    if (game && game.hud) game.hud.flashDamage();
    if (this.health <= 0 && game) game.wasted();
  }

  heal(amount) { this.health = Math.min(this.maxHealth, this.health + amount); }

  update(dt, input, cameraHeading, colliders, game) {
    if (this.inCar) return;
    const fwd = { x: Math.sin(cameraHeading), z: Math.cos(cameraHeading) };
    const right = { x: fwd.z, z: -fwd.x };
    let mx = 0, mz = 0;
    if (input.forward) { mx += fwd.x; mz += fwd.z; }
    if (input.back) { mx -= fwd.x; mz -= fwd.z; }
    if (input.left) { mx -= right.x; mz -= right.z; }
    if (input.right) { mx += right.x; mz += right.z; }
    const len = Math.hypot(mx, mz);
    const sprint = input.sprint ? 1.7 : 1;
    const targetSpeed = len > 0 ? 5.2 * sprint : 0;
    if (len > 0) {
      mx /= len; mz /= len;
      this.heading = Math.atan2(mx, mz);
    }
    this.speed = damp(this.speed, targetSpeed, 10, dt);
    this.x += mx * this.speed * dt;
    this.z += mz * this.speed * dt;
    // Jump + gravity.
    if (input.jump && this.onGround) { this.vy = 7.5; this.onGround = false; }
    this.vy -= 22 * dt;
    this.y += this.vy * dt;
    if (this.y <= 0) { this.y = 0; this.vy = 0; this.onGround = true; }
    // Collisions with buildings and props.
    const [nx, nz] = collideCircleBoxes(this.x, this.z, this.radius, colliders);
    this.x = nx; this.z = nz;
    this.x = clamp(this.x, -448, 510); this.z = clamp(this.z, -448, 448);
    // Mesh pose.
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.heading;
    const u = this.mesh.userData;
    this.walkPhase += this.speed * dt * 2.2;
    const swing = this.speed > 0.3 ? Math.sin(this.walkPhase) * 0.55 : 0;
    u.legL.rotation.x = swing; u.legR.rotation.x = -swing;
    u.armL.rotation.x = -swing * 0.8; u.armR.rotation.x = swing * 0.8;
    if (this.punchTimer > 0) {
      this.punchTimer -= dt;
      u.armR.rotation.x = -1.6;
    }
    this.punchCooldown = Math.max(0, this.punchCooldown - dt);
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    // Bob while walking.
    u.torso.position.y = 1.14 + (this.speed > 0.3 ? Math.abs(Math.sin(this.walkPhase)) * 0.05 : 0);
  }

  punch() {
    if (this.punchCooldown > 0 || this.inCar) return false;
    this.punchTimer = 0.28;
    this.punchCooldown = 0.45;
    return true;
  }
}
