// SOLARA HEAT — main loop and wiring. Builds the city, the player, traffic,
// pedestrians, police, combat and missions, then runs the frame loop: input,
// camera, physics, HUD and save. Everything original; three.js is vendored.
import * as THREE from 'three';
import { buildCity, PLACES } from './city.js';
import { Player } from './player.js';
import { TrafficSystem, createCarMesh, Car } from './vehicles.js';
import { PedSystem } from './peds.js';
import { PoliceSystem } from './police.js';
import { Combat } from './combat.js';
import { MissionSystem } from './missions.js';
import { Hud } from './hud.js';
import { AudioEngine } from './audio.js';
import { loadSave, writeSave } from './save.js';
import { applyShot } from './shots.js';
import { clamp, damp, angleLerp, collideCircleBoxes, makeRng, pick } from './utils.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
// Sunset sky: a vertical gradient painted on a canvas.
{
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#2e4a7a');
  grad.addColorStop(0.45, '#e8875a');
  grad.addColorStop(0.72, '#ffb36b');
  grad.addColorStop(1, '#ffd9a0');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
}
scene.fog = new THREE.Fog(0xf2a56b, 220, 900);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2000);

// Golden-hour sun + warm ambient.
const sun = new THREE.DirectionalLight(0xffd9a0, 2.4);
sun.position.set(-260, 190, 140);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -260; sun.shadow.camera.right = 260;
sun.shadow.camera.top = 260; sun.shadow.camera.bottom = -260;
sun.shadow.camera.far = 900;
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xffc890, 0x3a4a3a, 0.85));
const sunTarget = new THREE.Object3D();
scene.add(sunTarget);
sun.target = sunTarget;

// ---- Game state ------------------------------------------------------------
const G = {
  scene, camera, renderer,
  mode: 'menu', // menu | play | paused | busted | wasted
  cash: 0,
  day: 1,
  clockHours: 18.7,
  time: 0,
  missionTarget: null,
  autoDrive: false,
  cameraHeading: Math.PI,
  cameraPitch: 0.32,
  cameraDist: 11,
  cameraTarget: new THREE.Vector3(0, 2, 0),
  cameraMode: 'follow',
  saveTimer: 0,
  shotMode: !!SHOT,
};

G.city = buildCity(scene);
G.traffic = new TrafficSystem(scene, G.city.colliders);
G.peds = new PedSystem(scene, G.city.colliders);
G.police = new PoliceSystem(scene, G.city.colliders, G.traffic);
G.player = new Player(scene, 8, 8);
G.combat = new Combat(scene, G);
G.missions = new MissionSystem(scene, G);
G.hud = new Hud(G);
G.audio = new AudioEngine();

// Parked cars along the avenues.
const parkedSpots = [
  { x: -92, z: 8, heading: Math.PI / 2, kind: 'sedan' },
  { x: 108, z: -8, heading: -Math.PI / 2, kind: 'sedan' },
  { x: 8, z: 192, heading: 0, kind: 'taxi' },
  { x: -8, z: -208, heading: Math.PI, kind: 'sedan' },
  { x: 208, z: 92, heading: Math.PI / 2, kind: 'van' },
  { x: -208, z: -92, heading: -Math.PI / 2, kind: 'sedan' },
  { x: 292, z: -8, heading: Math.PI / 2, kind: 'sedan' },
  { x: -292, z: 108, heading: -Math.PI / 2, kind: 'taxi' },
  { x: -8, z: 24, heading: 0, kind: 'sport', color: 0xff2d55 },
  { x: -108, z: 292, heading: 0, kind: 'sedan' },
];
G.traffic.spawnInitial(14, parkedSpots);
G.peds.spawnInitial(26);
G.combat.spawnInitialPickups();

// ---- Save / load ------------------------------------------------------------
function saveGame() {
  const p = G.player;
  writeSave({
    cash: G.cash, missionIndex: G.missions.index, day: G.day, clockHours: G.clockHours,
    x: p.inCar ? p.inCar.x : p.x, z: p.inCar ? p.inCar.z : p.z,
    health: p.health, ammo: G.combat.ammo, reserve: G.combat.reserve,
    savedAt: Date.now(),
  });
}
G.saveGame = saveGame;

function loadIntoGame(data) {
  G.cash = data.cash || 0;
  G.missions.index = data.missionIndex || 0;
  G.day = data.day || 1;
  G.clockHours = data.clockHours || 18.7;
  G.player.x = data.x ?? 8; G.player.z = data.z ?? 8;
  G.player.health = data.health ?? 100;
  G.combat.ammo = data.ammo ?? 12;
  G.combat.reserve = data.reserve ?? 48;
  G.player.mesh.position.set(G.player.x, 0, G.player.z);
  const next = G.missions.currentDef();
  if (next) G.hud.setObjective('NEXT JOB: ' + next.title, 'Press M to start: ' + next.brief);
  else G.hud.setObjective('LEGEND OF SOLARA', 'All five jobs done. Free roam, Mara.');
}

const saved = loadSave();
const btnContinue = document.getElementById('btn-continue');
if (saved && saved.cash !== undefined) {
  document.getElementById('continue-label').textContent =
    '$' + Math.floor(saved.cash).toLocaleString('en-US') + ' · JOB ' + ((saved.missionIndex || 0) + 1) + '/5';
  btnContinue.classList.remove('hidden');
}

// ---- Heat / wanted -----------------------------------------------------------
G.addHeat = function (amount, reason) {
  G.police.addHeat(amount, G);
  G.hud.updateWanted(G.police.stars);
  if (reason && G.police.stars > 0) G.hud.setObjectiveDist(0, null);
};

G.busted = function () {
  if (G.mode !== 'play') return;
  G.mode = 'busted';
  G.audio.busted();
  G.cash = Math.floor(G.cash * 0.9);
  G.police.clearWanted(G);
  G.exitCar(true);
  showEnd('BUSTED', 'The PSPD hauled you in. Bail cost you 10% of your cash.', 'busted');
};
G.wasted = function () {
  if (G.mode !== 'play') return;
  G.mode = 'wasted';
  G.audio.busted();
  G.cash = Math.floor(G.cash * 0.9);
  G.police.clearWanted(G);
  G.exitCar(true);
  showEnd('WASTED', 'The streets of Port Solara claim another one.', 'wasted');
};
G.showMissionComplete = function (title, sub) {
  document.getElementById('mc-title').textContent = title;
  document.getElementById('mc-sub').textContent = sub;
  document.getElementById('mission-complete').classList.remove('hidden');
  G.mode = 'paused';
};

function showEnd(title, sub, cls) {
  const el = document.getElementById('end-screen');
  el.classList.remove('hidden', 'wasted', 'busted');
  el.classList.add(cls);
  document.getElementById('end-title').textContent = title;
  document.getElementById('end-sub').textContent = sub;
  G.hud.hide();
  saveGame();
}

// ---- Cars: enter / exit -------------------------------------------------------
G.enterCar = function (car, silent) {
  const p = G.player;
  if (car.disabled) { G.hud.feed('That car is wrecked.'); return; }
  if (car.driver && !car.isCop && !silent) {
    // Stealing an occupied car: the driver bails, the law notices.
    car.driver = false;
    G.peds.scare(car.x, car.z, 10);
    G.addHeat(130, 'Grand theft auto');
    G.hud.feed('You jacked a car. The PSPD noticed.');
    G.audio.horn();
  } else if (car.isCop && !silent) {
    G.addHeat(60, 'Stole a police cruiser');
    G.hud.feed('You stole a cop car. Bold.');
  }
  p.inCar = car;
  car.isPlayer = true;
  car.parked = false;
  car.traffic = false;
  p.mesh.visible = false;
  G.hud.setPrompt('');
  G.hud.el.crosshair.classList.add('hidden');
  G.cameraDist = 13;
};

G.exitCar = function (silent) {
  const p = G.player;
  const car = p.inCar;
  if (!car) return;
  car.isPlayer = false;
  const f = car.forward();
  p.x = car.x - f.z * 2.4;
  p.z = car.z + f.x * 2.4;
  p.y = 0; p.vy = 0;
  p.heading = car.heading;
  p.inCar = null;
  p.mesh.visible = true;
  p.mesh.position.set(p.x, 0, p.z);
  G.cameraDist = 11;
};

function nearestCar(maxD) {
  const p = G.player;
  let best = null, bestD = maxD;
  for (const c of G.traffic.cars) {
    if (c.isPlayer || c.disabled) continue;
    const d = Math.hypot(c.x - p.x, c.z - p.z);
    if (d < bestD) { bestD = d; best = c; }
  }
  for (const c of G.police.copCars) {
    const d = Math.hypot(c.x - p.x, c.z - p.z);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// ---- Input --------------------------------------------------------------------
const input = { forward: false, back: false, left: false, right: false, sprint: false, jump: false };
const KEYMAP = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  Space: 'jump',
};
let dragging = false, lastMX = 0, lastMY = 0;

addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  if (KEYMAP[e.code] !== undefined) input[KEYMAP[e.code]] = true;
  if (e.repeat) return;
  if (e.code === 'KeyE' && G.mode === 'play') {
    const p = G.player;
    if (p.inCar) G.exitCar();
    else {
      const car = nearestCar(4.5);
      if (car) G.enterCar(car);
    }
  }
  if (e.code === 'KeyF' && G.mode === 'play' && !G.player.inCar) {
    if (G.player.punch()) G.combat.punchHit(G.player);
  }
  if (e.code === 'KeyR' && G.mode === 'play') G.combat.startReload();
  if (e.code === 'KeyH' && G.mode === 'play' && G.player.inCar) G.audio.horn();
  if (e.code === 'KeyM' && G.mode === 'play') {
    if (!G.missions.active && G.missions.currentDef()) G.missions.startMission(G.missions.index);
    else G.hud.toast('Finish the current job first — or press M after it ends.');
  }
  if ((e.code === 'KeyP' || e.code === 'Escape') && (G.mode === 'play' || G.mode === 'paused')) togglePause();
});
addEventListener('keyup', (e) => { if (KEYMAP[e.code] !== undefined) input[KEYMAP[e.code]] = false; });
canvas.addEventListener('mousedown', (e) => {
  dragging = true; lastMX = e.clientX; lastMY = e.clientY;
  if (G.mode === 'play' && !G.player.inCar && e.button === 0) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const from = camera.position.clone();
    G.combat.fire({ x: from.x, y: from.y, z: from.z }, { x: dir.x, y: dir.y, z: dir.z });
  }
});
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
  if (!dragging) return;
  G.cameraHeading -= (e.clientX - lastMX) * 0.005;
  G.cameraPitch = clamp(G.cameraPitch + (e.clientY - lastMY) * 0.004, 0.06, 1.1);
  lastMX = e.clientX; lastMY = e.clientY;
});
addEventListener('wheel', (e) => {
  G.cameraDist = clamp(G.cameraDist + Math.sign(e.deltaY) * 1.5, 6, 26);
}, { passive: true });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function togglePause() {
  if (G.mode === 'play') {
    G.mode = 'paused';
    document.getElementById('pause-screen').classList.remove('hidden');
    saveGame();
  } else if (G.mode === 'paused') {
    G.mode = 'play';
    document.getElementById('pause-screen').classList.add('hidden');
  }
}

// ---- Menu buttons ---------------------------------------------------------------
function startGame(fromSave) {
  G.audio.start();
  if (fromSave && saved) loadIntoGame(saved);
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('end-screen').classList.add('hidden');
  G.hud.show();
  G.mode = 'play';
  G.hud.setCash(G.cash);
  G.hud.banner('PORT SOLARA', 'Mara Voss is back. Press M to start the next job.');
  if (!fromSave) G.hud.setObjective('FREE ROAM', 'Explore Port Solara. Press M to start the first job: HOMECOMING.');
  saveGame();
}
document.getElementById('btn-start').addEventListener('click', () => startGame(false));
btnContinue.addEventListener('click', () => startGame(true));
document.getElementById('btn-retry').addEventListener('click', () => {
  const p = G.player;
  p.health = p.maxHealth;
  p.x = PLACES.safehouse.x; p.z = PLACES.safehouse.z;
  p.mesh.position.set(p.x, 0, p.z);
  document.getElementById('end-screen').classList.add('hidden');
  G.hud.show();
  G.mode = 'play';
  saveGame();
});
document.getElementById('btn-end-menu').addEventListener('click', () => {
  document.getElementById('end-screen').classList.add('hidden');
  document.getElementById('start-screen').classList.remove('hidden');
  G.mode = 'menu';
});
document.getElementById('btn-resume').addEventListener('click', togglePause);
document.getElementById('btn-quit').addEventListener('click', () => {
  saveGame();
  document.getElementById('pause-screen').classList.add('hidden');
  document.getElementById('start-screen').classList.remove('hidden');
  G.hud.hide();
  G.mode = 'menu';
});
document.getElementById('btn-mc-continue').addEventListener('click', () => {
  document.getElementById('mission-complete').classList.add('hidden');
  G.mode = 'play';
});

// ---- Camera ---------------------------------------------------------------------
function updateCamera(dt) {
  const p = G.player;
  let tx, tz, ty, heading;
  if (G.cameraMode === 'vista') {
    // Slow orbit for the menu backdrop.
    G.cameraHeading += dt * 0.05;
    const a = G.cameraHeading;
    camera.position.set(
      G.cameraTarget.x + Math.sin(a) * G.cameraDist * 4,
      60 + Math.sin(G.time * 0.1) * 6,
      G.cameraTarget.z + Math.cos(a) * G.cameraDist * 4,
    );
    camera.lookAt(0, 10, 0);
    return;
  }
  if (p.inCar) {
    const car = p.inCar;
    tx = car.x; tz = car.z; ty = 1.6;
    // Camera trails behind the car, eased toward the drag heading.
    const behind = car.heading + Math.PI;
    G.cameraHeading = angleLerp(G.cameraHeading, behind, 1 - Math.exp(-2.2 * dt));
    heading = G.cameraHeading;
  } else {
    tx = p.x; tz = p.z; ty = 1.8;
    heading = G.cameraHeading;
  }
  const dist = G.cameraDist;
  const cx = tx - Math.sin(heading) * Math.cos(G.cameraPitch) * dist;
  const cz = tz - Math.cos(heading) * Math.cos(G.cameraPitch) * dist;
  const cy = ty + Math.sin(G.cameraPitch) * dist;
  camera.position.x = damp(camera.position.x, cx, 8, dt);
  camera.position.y = damp(camera.position.y, Math.max(cy, 2.2), 8, dt);
  camera.position.z = damp(camera.position.z, cz, 8, dt);
  camera.lookAt(tx, ty, tz);
}

// ---- Frame loop -------------------------------------------------------------------
const clock = new THREE.Clock();
let frames = 0;

function allCars() {
  const list = [...G.traffic.cars, ...G.police.copCars];
  return list;
}

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  G.time += dt;
  frames++;

  // Idle world animation even on the menu (clouds drift, ocean shimmers).
  for (const c of G.city.clouds) {
    c.position.x += dt * 1.2;
    if (c.position.x > 650) c.position.x = -650;
  }
  G.city.ocean.position.y = 0.4 + Math.sin(G.time * 0.8) * 0.06;

  if (G.mode === 'menu') {
    updateCamera(dt);
    renderer.render(scene, camera);
    return;
  }
  if (G.mode === 'paused' || G.mode === 'busted' || G.mode === 'wasted') {
    renderer.render(scene, camera);
    return;
  }

  // Clock + day.
  G.clockHours += dt / 180;
  if (G.clockHours >= 24) { G.clockHours -= 24; G.day++; G.hud.setDay(G.day); }
  G.hud.setClock(G.clockHours);

  // Auto-drive for screenshot mode.
  const driveInput = G.autoDrive ? { ...input, forward: true } : input;

  // Player on foot.
  const p = G.player;
  p.update(dt, driveInput, G.cameraHeading, G.city.colliders, G);

  // Player driving.
  if (p.inCar) {
    const car = p.inCar;
    const throttle = (driveInput.forward ? 1 : 0) + (driveInput.back ? -1 : 0);
    const steer = (driveInput.left ? -1 : 0) + (driveInput.right ? 1 : 0);
    const before = { x: car.x, z: car.z, speed: car.speed };
    car.drive(throttle, steer, driveInput.jump, dt);
    const [nx, nz] = collideCircleBoxes(car.x, car.z, car.radius, G.city.colliders);
    const hitWall = (nx !== car.x || nz !== car.z) && Math.abs(car.speed) > 8;
    car.x = nx; car.z = nz;
    if (hitWall) {
      car.speed *= 0.45;
      car.health -= 12;
      G.audio.crash();
      if (!G.shotMode) G.hud.flashDamage();
    }
    // Running over pedestrians.
    for (const ped of G.peds.peds) {
      if (ped.dead) continue;
      const d = Math.hypot(ped.x - car.x, ped.z - car.z);
      if (d < 2.2 && Math.abs(car.speed) > 4) {
        G.peds.kill(ped, G);
        car.speed *= 0.9;
        G.hud.feed('You ran someone over. The city saw it.');
        G.audio.crash();
      }
    }
    if (car.health <= 0 && !car.disabled) {
      car.disabled = true;
      G.hud.feed('Your car is wrecked. Get out.');
      G.exitCar();
    }
    G.audio.setEngine(Math.abs(car.speed) * 3.6, true);
  } else {
    G.audio.setEngine(0, false);
  }

  // World systems.
  G.traffic.update(dt, p.inCar, allCars());
  G.traffic.separate(allCars());
  G.peds.update(dt, p, p.inCar);
  G.police.update(dt, G);
  G.combat.update(dt, p, camera);
  G.missions.update(dt, p);

  // Enter-car prompt.
  if (!p.inCar && G.mode === 'play' && !G.hud.promptLocked) {
    const car = nearestCar(4.5);
    if (car) {
      const label = car.isCop ? 'STEAL POLICE CRUISER' : car.driver ? 'STEAL CAR' : car.parked ? 'ENTER CAR' : 'ENTER CAR';
      G.hud.setPrompt('<span class="key">E</span>' + label);
    } else if (!G.police.bustTimer) {
      G.hud.setPrompt('');
    }
  }

  // Audio: sirens + music.
  const sirenOn = G.police.copCars.length > 0;
  G.audio.setSiren(sirenOn, dt);
  G.audio.updateMusic(dt, G.police.stars);

  // HUD.
  G.hud.setCash(G.cash);
  G.hud.setHealth(p.health);
  G.hud.setAmmo(G.combat.ammo, G.combat.reserve);
  G.hud.setSpeed(p.inCar ? Math.abs(p.inCar.speed) * 3.6 : 0, !!p.inCar);
  G.hud.el.crosshair.classList.toggle('hidden', !!p.inCar || G.mode !== 'play');
  G.hud.update(dt);
  G.hud.drawMinimap(G);

  // Sun follows the player so shadows stay local.
  sun.position.set(p.inCar ? p.inCar.x - 260 : p.x - 260, 190, (p.inCar ? p.inCar.z : p.z) + 140);
  sunTarget.position.set(p.inCar ? p.inCar.x : p.x, 0, p.inCar ? p.inCar.z : p.z);

  updateCamera(dt);
  renderer.render(scene, camera);

  // Periodic save.
  G.saveTimer += dt;
  if (G.saveTimer > 10) { G.saveTimer = 0; saveGame(); }

  if (SHOT && frames === 120) window.__shotReady = true;
}

// ---- Boot --------------------------------------------------------------------------
if (SHOT) applyShot(G, SHOT);
G.hud.setCash(G.cash);
G.hud.updateWanted(G.police.stars);
G.hud.setClock(G.clockHours);
G.hud.setDay(G.day);
window.__solara = G;
window.addEventListener('error', (e) => { window.__lastError = String(e.message); });
tick();
