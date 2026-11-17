// Port Solara: a procedural sun-soaked coastal city, built deterministically
// from one seed. A painted ground texture carries the roads, sidewalks and
// beach; buildings are shared-geometry boxes with windowed facades; the east
// edge is sand and ocean. Exports the colliders, road graph and named places
// the missions, traffic and police all share.
import * as THREE from 'three';
import { makeRng, pick, range, clamp } from './utils.js';

export const CITY = {
  half: 450,          // playable land extends -450..450 on x and z
  roadStep: 100,      // grid spacing
  roadWidth: 16,
  beachX: 452,        // sand starts here
  oceanX: 520,        // water starts here
};

// Named places the story uses.
export const PLACES = {
  plaza: { x: 0, z: 0, name: 'Solara Plaza' },
  marina: { x: 430, z: 120, name: 'Marina' },
  garage: { x: -300, z: -300, name: "Rico's Garage" },
  docks: { x: 430, z: -200, name: 'The Docks' },
  bank: { x: 100, z: -100, name: 'Solara National Bank' },
  safehouse: { x: -300, z: 300, name: 'Safehouse' },
  warehouse: { x: 300, z: 300, name: 'Warehouse 9' },
  beach: { x: 470, z: 250, name: 'Solara Beach' },
};

function groundTexture() {
  const S = 2048, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const toPx = (v) => ((v + 500) / 1000) * S;
  // Grass / dirt base.
  g.fillStyle = '#5d7a4a'; g.fillRect(0, 0, S, S);
  // City slab.
  g.fillStyle = '#8a8f96'; g.fillRect(toPx(-450), toPx(-450), toPx(450) - toPx(-450), toPx(450) - toPx(-450));
  // Blocks sit BETWEEN the roads: their centres are offset half a grid step
  // from the road lines, so no building ever protrudes onto the asphalt.
  const road = CITY.roadWidth, step = CITY.roadStep;
  for (let i = -5; i <= 4; i++) {
    for (let j = -5; j <= 4; j++) {
      const bx = i * step + 50, bz = j * step + 50;
      g.fillStyle = '#b9b3a4';
      g.fillRect(toPx(bx - 42), toPx(bz - 42), toPx(bx + 42) - toPx(bx - 42), toPx(bz + 42) - toPx(bz - 42));
    }
  }
  // Roads: dark asphalt with dashed centre lines.
  g.fillStyle = '#33363d';
  const roadPx = (toPx(road / 2) - toPx(-road / 2));
  for (let k = -4; k <= 4; k++) {
    g.fillRect(toPx(k * step - road / 2), toPx(-450), roadPx, toPx(450) - toPx(-450));
    g.fillRect(toPx(-450), toPx(k * step - road / 2), toPx(450) - toPx(-450), roadPx);
  }
  g.strokeStyle = '#e8c33c'; g.lineWidth = 3; g.setLineDash([26, 22]);
  for (let k = -4; k <= 4; k++) {
    g.beginPath(); g.moveTo(toPx(k * step), toPx(-450)); g.lineTo(toPx(k * step), toPx(450)); g.stroke();
    g.beginPath(); g.moveTo(toPx(-450), toPx(k * step)); g.lineTo(toPx(450), toPx(k * step)); g.stroke();
  }
  g.setLineDash([]);
  // Central park plaza over the crossroads at (0, 0).
  g.fillStyle = '#4e7d3f';
  g.fillRect(toPx(-42), toPx(-42), toPx(42) - toPx(-42), toPx(42) - toPx(-42));
  // Crosswalks at every intersection except the park plaza.
  g.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
    if (i === 0 && j === 0) continue;
    const x = toPx(i * step), z = toPx(j * step);
    for (let s = -3; s <= 3; s++) {
      g.fillRect(x - 14 + s * 4, z - 12, 2.5, 24);
      g.fillRect(x - 12, z - 14 + s * 4, 24, 2.5);
    }
  }
  // Beach and ocean edge.
  g.fillStyle = '#e8d49a'; g.fillRect(toPx(CITY.beachX), 0, toPx(520) - toPx(CITY.beachX), S);
  g.fillStyle = '#2f7fb8'; g.fillRect(toPx(520), 0, S - toPx(520), S);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  for (let z = 0; z < S; z += 90) g.fillRect(toPx(516), z, 6, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function facadeTexture(base, lit) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, 128, 10);
  for (let y = 18; y < 244; y += 22) {
    for (let x = 10; x < 118; x += 20) {
      const warm = Math.random() < 0.45;
      g.fillStyle = warm ? (lit ? '#ffd98a' : '#ffe9b8') : '#2a3542';
      g.fillRect(x, y, 13, 14);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildCity(scene) {
  const rng = makeRng(20261117);
  const colliders = [];
  const buildings = [];
  const group = new THREE.Group();
  scene.add(group);

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000),
    new THREE.MeshLambertMaterial({ map: groundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Ocean plane (slightly above ground, animated in main loop).
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(480, 1000, 24, 24),
    new THREE.MeshPhongMaterial({ color: 0x1f6fb2, transparent: true, opacity: 0.92, shininess: 90 }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(520 + 240, 0.4, 0);
  group.add(ocean);

  // Facade materials (shared).
  const facades = [
    '#c98f5f', '#b7a99a', '#7fa3b8', '#d9c08a', '#a88f7a', '#8fa8c9',
  ].map((col) => new THREE.MeshLambertMaterial({ map: facadeTexture(col, true) }));
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x4a4640 });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  // Buildings, one block at a time. Blocks are centred between the roads
  // (offset +50), so buildings never touch the asphalt. Downtown (near the
  // centre) goes taller.
  for (let i = -5; i <= 4; i++) {
    for (let j = -5; j <= 4; j++) {
      const cx = i * 100 + 50, cz = j * 100 + 50;
      const distC = Math.hypot(cx, cz);
      const n = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const w = range(rng, 18, 34);
        const d = range(rng, 18, 34);
        const h = clamp(range(rng, 10, 46) * (1.6 - distC / 700), 8, 62);
        const ox = range(rng, -14, 14), oz = range(rng, -14, 14);
        const x = cx + ox, z = cz + oz;
        if (Math.abs(x) > 428 || Math.abs(z) > 428) continue;
        const mesh = new THREE.Mesh(boxGeo, pick(rng, facades));
        mesh.scale.set(w, h, d);
        mesh.position.set(x, h / 2, z);
        mesh.castShadow = true; mesh.receiveShadow = true;
        group.add(mesh);
        colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
        buildings.push({ x, z, w, d, h });
        // Rooftop box on some buildings.
        if (rng() < 0.45) {
          const roof = new THREE.Mesh(boxGeo, roofMat);
          roof.scale.set(w * 0.3, 3, d * 0.3);
          roof.position.set(x + range(rng, -4, 4), h + 1.5, z + range(rng, -4, 4));
          group.add(roof);
        }
      }
    }
  }

  // Central park: trees + a fountain plinth.
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f8f3a });
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.8, 6, 6);
  const crownGeo = new THREE.IcosahedronGeometry(3.4, 0);
  for (let t = 0; t < 14; t++) {
    const x = range(rng, -36, 36), z = range(rng, -36, 36);
    if (Math.hypot(x, z) < 8) continue;
    if (Math.abs(x) < 12 || Math.abs(z) < 12) continue; // keep the crossroads clear
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, 3, z); trunk.castShadow = true;
    const crown = new THREE.Mesh(crownGeo, leafMat);
    crown.position.set(x, 8, z); crown.scale.y = 0.8; crown.castShadow = true;
    group.add(trunk, crown);
  }
  const fountain = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 6, 1.2, 16),
    new THREE.MeshPhongMaterial({ color: 0x9fd8ff, shininess: 120 }),
  );
  fountain.position.set(0, 0.6, 0);
  group.add(fountain);
  colliders.push({ minX: -6, maxX: 6, minZ: -6, maxZ: 6 });

  // Palms along the beach and a few streets.
  const palmTrunk = new THREE.CylinderGeometry(0.35, 0.6, 9, 6);
  const palmCrown = new THREE.ConeGeometry(3.2, 3.5, 7);
  const palmLeaf = new THREE.MeshLambertMaterial({ color: 0x2f9e4f });
  const palms = [];
  for (let z = -420; z <= 420; z += 42) {
    const x = 462 + range(rng, -4, 4);
    const trunk = new THREE.Mesh(palmTrunk, trunkMat);
    trunk.position.set(x, 4.5, z); trunk.rotation.z = range(rng, -0.08, 0.08); trunk.castShadow = true;
    const crown = new THREE.Mesh(palmCrown, palmLeaf);
    crown.position.set(x, 10.2, z); crown.castShadow = true;
    group.add(trunk, crown);
    palms.push({ x, z });
  }

  // Streetlights along the avenues.
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2c2f36 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const poleGeo = new THREE.CylinderGeometry(0.14, 0.18, 7, 6);
  const lampGeo = new THREE.SphereGeometry(0.55, 8, 6);
  for (let k = -4; k <= 4; k++) {
    for (let s = -3; s <= 3; s += 2) {
      const x = k * 100 + 9, z = s * 100 + 9;
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, 3.5, z);
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(x, 7.1, z);
      group.add(pole, lamp);
    }
  }

  // Crates and benches as street props (small colliders).
  const crateMat = new THREE.MeshLambertMaterial({ color: 0x8a6a3f });
  for (let p = 0; p < 26; p++) {
    const bx = pick(rng, [-4, -3, -2, -1, 0, 1, 2, 3, 4]) * 100 + range(rng, -38, 38);
    const bz = pick(rng, [-4, -3, -2, -1, 0, 1, 2, 3, 4]) * 100 + range(rng, -38, 38);
    const s = range(rng, 1.4, 2.6);
    const crate = new THREE.Mesh(boxGeo, crateMat);
    crate.scale.set(s, s, s);
    crate.position.set(bx, s / 2, bz);
    crate.rotation.y = rng() * Math.PI;
    crate.castShadow = true;
    group.add(crate);
    colliders.push({ minX: bx - s / 2, maxX: bx + s / 2, minZ: bz - s / 2, maxZ: bz + s / 2 });
  }

  // A few clouds, drifting slowly in main.
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const clouds = [];
  for (let c = 0; c < 10; c++) {
    const cloud = new THREE.Group();
    for (let b = 0; b < 3; b++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(range(rng, 8, 16), 8, 6), cloudMat);
      puff.position.set(b * 12 - 12, range(rng, -2, 2), range(rng, -4, 4));
      puff.scale.y = 0.45;
      cloud.add(puff);
    }
    cloud.position.set(range(rng, -600, 600), range(rng, 90, 150), range(rng, -600, 600));
    scene.add(cloud);
    clouds.push(cloud);
  }

  // Road graph: intersections at every grid crossing, for traffic + police.
  const roadLines = [];
  for (let k = -4; k <= 4; k++) roadLines.push(k * 100);

  return { colliders, buildings, roadLines, ocean, clouds, group };
}
