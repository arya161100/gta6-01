// Screenshot staging: ?shot=start|play|chase|mission puts the game into a
// fixed, good-looking pose so the four screenshots show the city, the HUD,
// a police chase and a mission — deterministically, every run.
import { createCarMesh, Car } from './vehicles.js';

export function applyShot(game, name) {
  const G = game;
  if (name === 'start') {
    // Menu over a golden-hour vista of downtown.
    G.mode = 'menu';
    G.cameraMode = 'vista';
    G.cameraHeading = Math.PI * 0.78;
    G.cameraPitch = 0.42;
    G.cameraDist = 60;
    G.cameraTarget.set(0, 18, 0);
    return;
  }
  // All other shots play the game with the HUD on.
  G.mode = 'play';
  G.hud.show();
  G.audio.started = true; // silence: never open an AudioContext in shot mode
  document.getElementById('start-screen').classList.add('hidden');
  G.player.mesh.visible = true;

  if (name === 'play') {
    // Mara driving a red sports car down the main avenue, traffic around.
    const mesh = createCarMesh(0xd42a1e, 'sport');
    const car = new Car(mesh, 100, -60, 0, { kind: 'sport', maxSpeed: 46 });
    G.scene.add(mesh);
    G.traffic.cars.push(car);
    // Clear the avenue ahead so the car never rear-ends traffic mid-shot.
    for (let i = G.traffic.cars.length - 1; i >= 0; i--) {
      const c = G.traffic.cars[i];
      if (c === car || c.isPlayer) continue;
      if (Math.abs(c.x - 100) < 16 && c.z > -70 && c.z < 320) {
        G.scene.remove(c.mesh);
        G.traffic.cars.splice(i, 1);
      }
    }
    G.enterCar(car, true);
    car.speed = 22;
    G.autoDrive = true;
    G.cameraHeading = 0.15;
    G.cameraPitch = 0.32;
    G.missions.startMission(0);
    G.hud.bannerTimer = 0.5; // let the title card fade well before the screenshot
    G.hud.feed('Dario: "Mara! You came back."');
  } else if (name === 'chase') {
    // Three-star wanted: PSPD cruisers right on Mara's tail.
    const mesh = createCarMesh(0x2e86c1, 'sport');
    const car = new Car(mesh, 0, 120, Math.PI, { kind: 'sport', maxSpeed: 46 });
    G.scene.add(mesh);
    G.traffic.cars.push(car);
    G.enterCar(car, true);
    car.speed = 26;
    G.autoDrive = true;
    G.police.setStars(3, G);
    for (let i = 0; i < 3; i++) {
      const cop = G.police.spawnCopCarNear(0, 120 + 45 + i * 22);
      cop.speed = 24;
    }
    G.cameraHeading = Math.PI + 0.2;
    G.cameraPitch = 0.3;
    G.hud.setObjective('WANTED — LEVEL 3', 'Lose the PSPD. Do not get caught.');
  } else if (name === 'mission') {
    // Mission 3 in progress: the courier flees, Mara on foot, beacon lit.
    G.missions.startMission(2);
    G.hud.bannerTimer = 0.5; // let the title card fade well before the screenshot
    G.player.x = 92; G.player.z = 78;
    G.player.heading = 0.72; // Mara faces the courier
    G.missions.courier.x = 106; G.missions.courier.z = 94;
    G.missions.courier.heading = 0.6;
    G.missions.courier.speed = 10;
    G.missions.courier.disabled = true; // staged shot: the courier waits for Mara
    G.cameraHeading = 0.72; // face the courier, 21 m ahead
    G.cameraPitch = 0.3;
    G.cameraDist = 13;
    G.hud.setObjective('THE COURIER', 'Stop the purple sedan and grab the package.');
  }
}
