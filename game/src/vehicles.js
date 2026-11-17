// Vehicles: low-poly car meshes, arcade driving physics, and the traffic
// system that keeps Port Solara's avenues busy. Cars drive the road grid,
// stop for the car ahead, and can be stolen by the player (E).
import * as THREE from 'three';
import { makeRng, pick, range, clamp, angleLerp, collideCircleBoxes } from './utils.js';

const CAR_COLORS = [0xc0392b, 0x2e86c1, 0xf1c40f, 0xecf0f1, 0x1a1a1a, 0x7d3c98, 0x16a085, 0xe67e22, 0x95a5a6, 0x8e44ad, 0x2c3e50, 0xd35400];
const SPORT_COLORS = [0xffd700, 0xff2d55, 0x00e5ff, 0x7cff00];

let bodyGeo, cabinGeo, wheelGeo, glassMat, tireMat, lightMatF, lightMatB;

function ensureGeos() {
  if (bodyGeo) return;
  bodyGeo = new THREE.BoxGeometry(1, 1, 1);
  cabinGeo = new THREE.BoxGeometry(1, 1, 1);
  wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  glassMat = new THREE.MeshPhongMaterial({ color: 0x1a2a3a, shininess: 140 });
  tireMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  lightMatF = new THREE.MeshBasicMaterial({ color: 0xfff6c0 });
  lightMatB = new THREE.MeshBasicMaterial({ color: 0xff2222 });
}

// Build a low-poly car. kind: 'sedan' | 'sport' | 'taxi' | 'cop' | 'van'.
export function createCarMesh(color, kind = 'sedan') {
  ensureGeos();
  const g = new THREE.Group();
  const paint = new THREE.MeshPhongMaterial({ color, shininess: 90 });
  const L = kind === 'van' ? 4.6 : kind === 'sport' ? 4.2 : 4.0;
  const W = kind === 'van' ? 2.1 : 1.9;
  const body = new THREE.Mesh(bodyGeo, paint);
  body.scale.set(W, 0.62, L);
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(cabinGeo, kind === 'van' ? paint : glassMat);
  cabin.scale.set(W * 0.82, 0.55, L * 0.45);
  cabin.position.set(0, 1.1, kind === 'van' ? 0 : -0.15);
  cabin.castShadow = true;
  g.add(cabin);
  if (kind === 'sport') {
    const spoiler = new THREE.Mesh(bodyGeo, paint);
    spoiler.scale.set(W * 0.9, 0.08, 0.5);
    spoiler.position.set(0, 1.05, -L / 2 + 0.1);
    g.add(spoiler);
  }
  // Wheels.
  const wheels = [];
  const wz = L / 2 - 0.75, wx = W / 2 - 0.05;
  for (const [x, z] of [[-wx, wz], [wx, wz], [-wx, -wz], [wx, -wz]]) {
    const w = new THREE.Mesh(wheelGeo, tireMat);
    w.position.set(x, 0.36, z);
    w.castShadow = true;
    g.add(w);
    wheels.push(w);
  }
  // Headlights / taillights.
  for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) {
    const hl = new THREE.Mesh(bodyGeo, lightMatF);
    hl.scale.set(0.34, 0.16, 0.08);
    hl.position.set(x, 0.62, L / 2 + 0.01);
    g.add(hl);
    const tl = new THREE.Mesh(bodyGeo, lightMatB);
    tl.scale.set(0.34, 0.16, 0.08);
    tl.position.set(x, 0.62, -L / 2 - 0.01);
    g.add(tl);
  }
  if (kind === 'taxi') {
    const sign = new THREE.Mesh(bodyGeo, new THREE.MeshBasicMaterial({ color: 0xffd23e }));
    sign.scale.set(0.7, 0.18, 0.4);
    sign.position.set(0, 1.5, 0);
    g.add(sign);
  }
  if (kind === 'cop') {
    const bar = new THREE.Mesh(bodyGeo, new THREE.MeshBasicMaterial({ color: 0x2244ff }));
    bar.scale.set(1.0, 0.14, 0.4);
    bar.position.set(0, 1.45, -0.1);
    bar.name = 'lightbar';
    g.add(bar);
    const bar2 = new THREE.Mesh(bodyGeo, new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    bar2.scale.set(0.45, 0.15, 0.42);
    bar2.position.set(-0.28, 1.45, -0.1);
    bar2.name = 'lightbar-red';
    g.add(bar2);
  }
  g.userData = { wheels, length: L, width: W, kind };
  return g;
}

export class Car {
  constructor(mesh, x, z, heading, opts = {}) {
    this.mesh = mesh;
    this.x = x; this.z = z;
    this.heading = heading;
    this.speed = 0; // m/s, forward positive
    this.steer = 0;
    this.kind = opts.kind || 'sedan';
    this.isCop = !!opts.isCop;
    this.isPlayer = false;
    this.driver = opts.driver !== false; // traffic cars have a driver to scare off
    this.stolen = false;
    this.health = 100;
    this.radius = 2.2;
    this.maxSpeed = opts.maxSpeed || (this.kind === 'sport' ? 46 : this.kind === 'cop' ? 44 : 26);
    this.accel = opts.accel || 14;
    this.brake = 26;
    this.id = Car._next = (Car._next || 0) + 1;
  }

  forward() { return { x: Math.sin(this.heading), z: Math.cos(this.heading) }; }

  // Arcade driving: throttle -1..1, steer -1..1, handbrake bool.
  drive(throttle, steer, handbrake, dt) {
    const fwd = this.forward();
    if (throttle > 0) this.speed += this.accel * throttle * dt;
    else if (throttle < 0) {
      if (this.speed > 0.5) this.speed -= this.brake * dt; // brake
      else this.speed -= this.accel * 0.6 * dt; // reverse
    }
    if (handbrake) this.speed = dampSpeed(this.speed, dt, 0.25);
    // Drag + rolling resistance.
    this.speed -= this.speed * 0.35 * dt;
    this.speed = clamp(this.speed, -12, this.maxSpeed);
    if (Math.abs(this.speed) < 0.05 && throttle === 0) this.speed = 0;
    // Steering scales with speed; reverse inverts.
    const steerAmount = steer * clamp(Math.abs(this.speed) / 8, 0, 1) * (handbrake ? 1.5 : 1);
    this.heading += steerAmount * (this.speed >= 0 ? 1 : -1) * 1.9 * dt * (handbrake ? 1.3 : 1);
    const f2 = this.forward();
    this.x += f2.x * this.speed * dt;
    this.z += f2.z * this.speed * dt;
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
    // Wheel spin + front-wheel steer visual.
    const wheels = this.mesh.userData.wheels;
    for (let i = 0; i < wheels.length; i++) {
      wheels[i].rotation.x += (this.speed * dt) / 0.36;
      if (i < 2) wheels[i].rotation.y = steer * 0.4;
    }
    return fwd;
  }
}
function dampSpeed(v, dt, f) { return v * Math.exp(-f * dt * 4); }

// ---- Traffic ---------------------------------------------------------------
export class TrafficSystem {
  constructor(scene, colliders) {
    this.scene = scene;
    this.colliders = colliders;
    this.cars = [];
    this.rng = makeRng(777);
    this.roadLines = [];
    for (let k = -4; k <= 4; k++) this.roadLines.push(k * 100);
  }

  spawnInitial(count, parkedSpots) {
    for (let i = 0; i < count; i++) this.spawnTrafficCar();
    for (const p of parkedSpots) this.spawnParkedCar(p.x, p.z, p.heading, p.kind, p.color);
  }

  randomRoadPoint() {
    const along = pick(this.rng, this.roadLines);
    const cross = (Math.floor(this.rng() * 9) - 4) * 100 + range(this.rng, -30, 30);
    const horizontal = this.rng() < 0.5;
    return horizontal ? { x: cross, z: along, heading: this.rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2 }
                      : { x: along, z: cross, heading: this.rng() < 0.5 ? 0 : Math.PI };
  }

  spawnTrafficCar() {
    const p = this.randomRoadPoint();
    const kind = pick(this.rng, ['sedan', 'sedan', 'sedan', 'taxi', 'van']);
    const color = kind === 'taxi' ? 0xf5c518 : pick(this.rng, CAR_COLORS);
    const mesh = createCarMesh(color, kind);
    const car = new Car(mesh, p.x, p.z, p.heading, { kind, maxSpeed: range(this.rng, 15, 24) });
    car.traffic = true;
    car.route = this.newRoute(car);
    car.cruise = range(this.rng, 12, 20);
    this.scene.add(mesh);
    this.cars.push(car);
    return car;
  }

  spawnParkedCar(x, z, heading, kind = 'sedan', color) {
    const mesh = createCarMesh(color ?? pick(this.rng, CAR_COLORS), kind);
    const car = new Car(mesh, x, z, heading, { kind, driver: false });
    car.parked = true;
    this.scene.add(mesh);
    this.cars.push(car);
    return car;
  }

  // Route: a list of waypoints along the road grid.
  newRoute(car) {
    const pts = [];
    let x = Math.round(car.x / 100) * 100;
    let z = Math.round(car.z / 100) * 100;
    for (let i = 0; i < 6; i++) {
      if (this.rng() < 0.5) x = clamp(x + pick(this.rng, [-100, 100]), -400, 400);
      else z = clamp(z + pick(this.rng, [-100, 100]), -400, 400);
      pts.push({ x, z });
    }
    return pts;
  }

  update(dt, playerCar, allCars) {
    for (const car of this.cars) {
      if (car.isPlayer || car.parked || car.isCop || car.disabled) continue;
      if (!car.route || car.route.length === 0) car.route = this.newRoute(car);
      const target = car.route[0];
      const dx = target.x - car.x, dz = target.z - car.z;
      const d = Math.hypot(dx, dz);
      if (d < 6) { car.route.shift(); continue; }
      const wantHeading = Math.atan2(dx, dz);
      const dh = ((wantHeading - car.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const steer = clamp(dh * 1.6, -1, 1);
      // Slow down for the car ahead.
      let throttle = 0.55;
      const f = car.forward();
      for (const other of allCars) {
        if (other === car) continue;
        const ox = other.x - car.x, oz = other.z - car.z;
        const ahead = ox * f.x + oz * f.z;
        const side = Math.abs(ox * f.z - oz * f.x);
        if (ahead > 0 && ahead < 13 && side < 3.2) { throttle = -0.6; break; }
      }
      if (Math.abs(dh) > 0.9) throttle = 0.15;
      car.speed = clamp(car.speed, 0, car.cruise || 16);
      car.drive(throttle, steer, false, dt);
      // Keep traffic on the roads: clamp inside the city, nudge out of buildings.
      const [nx, nz] = collideCircleBoxes(car.x, car.z, car.radius, this.colliders);
      if (nx !== car.x || nz !== car.z) { car.x = nx; car.z = nz; car.speed *= 0.4; }
      car.x = clamp(car.x, -445, 445); car.z = clamp(car.z, -445, 445);
    }
  }

  // Push all cars apart so they never overlap (cheap circle separation).
  separate(allCars) {
    for (let i = 0; i < allCars.length; i++) {
      for (let j = i + 1; j < allCars.length; j++) {
        const a = allCars[i], b = allCars[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = a.radius + b.radius - 0.4;
        if (d > 0.01 && d < min) {
          const push = (min - d) / 2;
          const nx = dx / d, nz = dz / d;
          a.x -= nx * push; a.z -= nz * push;
          b.x += nx * push; b.z += nz * push;
          a.speed *= 0.85; b.speed *= 0.85;
        }
      }
    }
  }
}

export { SPORT_COLORS };
