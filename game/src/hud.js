// HUD: cash, wanted stars, health, ammo, speed, objective, prompts, the
// toast feed — and the circular minimap drawn on a 2D canvas from the live
// game state (roads, beach, player, cars, cops, mission marker).
import { fmtCash } from './utils.js';

export class Hud {
  constructor(game) {
    this.game = game;
    this.el = {};
    for (const id of ['hud', 'cash-num', 'objective-title', 'objective-text', 'objective-dist', 'wanted',
      'clock-time', 'clock-day', 'health-fill', 'ammo-num', 'speed', 'speed-num', 'minimap',
      'crosshair', 'prompt', 'banner', 'banner-title', 'banner-sub', 'feed', 'toast', 'damage-vignette']) {
      this.el[id] = document.getElementById(id);
    }
    this.minimap = this.el.minimap.getContext('2d');
    this.promptLocked = false;
    this.bannerTimer = 0;
    this.toastTimer = 0;
    this.feedItems = [];
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  setCash(n) { this.el['cash-num'].textContent = fmtCash(n); }
  setHealth(h) { this.el['health-fill'].style.width = Math.max(0, h) + '%'; }
  setAmmo(a, r) { this.el['ammo-num'].textContent = a + ' / ' + r; }
  setSpeed(kmh, show) {
    this.el.speed.classList.toggle('hidden', !show);
    if (show) this.el['speed-num'].textContent = Math.round(kmh);
  }
  setClock(hours) {
    const h = Math.floor(hours) % 24, m = Math.floor((hours % 1) * 60);
    this.el['clock-time'].textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  setDay(d) { this.el['clock-day'].textContent = 'DAY ' + d + ' · PORT SOLARA'; }

  updateWanted(stars) {
    for (const s of this.el.wanted.querySelectorAll('.star')) {
      s.classList.toggle('on', Number(s.dataset.s) <= stars);
    }
  }

  setObjective(title, text) {
    this.el['objective-title'].textContent = title;
    this.el['objective-text'].textContent = text;
  }

  setObjectiveDist(d, label) {
    this.el['objective-dist'].textContent = label ? '· ' + label : (d > 9998 ? '' : '· ' + Math.round(d) + 'm');
  }

  setPrompt(text, lock = false) {
    this.promptLocked = lock;
    if (!text) { this.el.prompt.classList.add('hidden'); return; }
    this.el.prompt.innerHTML = text;
    this.el.prompt.classList.remove('hidden');
  }

  banner(title, sub) {
    this.el['banner-title'].textContent = title;
    this.el['banner-sub'].textContent = sub || '';
    this.el.banner.classList.remove('hidden');
    this.bannerTimer = 3.2;
  }

  flash(text) { this.toast(text); }

  toast(text) {
    this.el.toast.textContent = text;
    this.el.toast.classList.remove('hidden');
    this.toastTimer = 3;
  }

  feed(text) {
    const div = document.createElement('div');
    div.textContent = text;
    this.el.feed.prepend(div);
    this.feedItems.push(div);
    if (this.feedItems.length > 4) {
      const old = this.feedItems.shift();
      old.remove();
    }
    setTimeout(() => { if (div.parentNode) div.remove(); }, 9000);
  }

  flashDamage() {
    this.el['damage-vignette'].style.opacity = '1';
    setTimeout(() => { this.el['damage-vignette'].style.opacity = '0'; }, 180);
  }

  update(dt) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.classList.add('hidden');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.add('hidden');
    }
  }

  // --- Minimap ---------------------------------------------------------------
  drawMinimap(game) {
    const ctx = this.minimap;
    const S = 200, C = S / 2;
    const scale = S / 1100; // world -550..550 fits the circle
    const toMap = (x, z) => [C + x * scale, C + z * scale];
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(C, C, C - 2, 0, Math.PI * 2); ctx.clip();
    // Water + sand on the east edge.
    ctx.fillStyle = '#12324e'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#e8d49a';
    const [bx] = toMap(452, 0); ctx.fillRect(bx, 0, S - bx, S);
    // Land.
    ctx.fillStyle = '#2a3a2e'; ctx.fillRect(0, 0, bx, S);
    // City blocks.
    ctx.fillStyle = '#4a5560';
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
      const [x, z] = toMap(i * 100 - 42, j * 100 - 42);
      ctx.fillRect(x, z, 84 * scale, 84 * scale);
    }
    // Roads.
    ctx.strokeStyle = '#8a8f96'; ctx.lineWidth = 16 * scale;
    for (let k = -4; k <= 4; k++) {
      const [x1, z1] = toMap(k * 100, -450); const [x2, z2] = toMap(k * 100, 450);
      ctx.beginPath(); ctx.moveTo(x1, z1); ctx.lineTo(x2, z2); ctx.stroke();
      const [x3, z3] = toMap(-450, k * 100); const [x4, z4] = toMap(450, k * 100);
      ctx.beginPath(); ctx.moveTo(x3, z3); ctx.lineTo(x4, z4); ctx.stroke();
    }
    // Mission marker: pulsing gold diamond.
    if (game.missionTarget) {
      const [mx, mz] = toMap(game.missionTarget.x, game.missionTarget.z);
      const pulse = 6 + Math.sin(performance.now() / 200) * 2;
      ctx.fillStyle = '#ffb020';
      ctx.beginPath();
      ctx.moveTo(mx, mz - pulse); ctx.lineTo(mx + pulse, mz); ctx.lineTo(mx, mz + pulse); ctx.lineTo(mx - pulse, mz);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // Traffic cars: small white dots.
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const c of game.traffic.cars) {
      if (c.isCop) continue;
      const [x, z] = toMap(c.x, c.z);
      ctx.fillRect(x - 1.5, z - 1.5, 3, 3);
    }
    // Cops: flashing blue/red dots.
    const flash = Math.floor(performance.now() / 300) % 2 === 0;
    ctx.fillStyle = flash ? '#3b82ff' : '#ff3333';
    for (const c of game.police.copCars) {
      const [x, z] = toMap(c.x, c.z);
      ctx.beginPath(); ctx.arc(x, z, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    for (const c of game.police.cops) {
      const [x, z] = toMap(c.x, c.z);
      ctx.beginPath(); ctx.arc(x, z, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    // Player: white triangle pointing along the heading.
    const p = game.player;
    const px = p.inCar ? p.inCar.x : p.x;
    const pz = p.inCar ? p.inCar.z : p.z;
    const heading = p.inCar ? p.inCar.heading : p.heading;
    const [mx, mz] = toMap(px, pz);
    ctx.save();
    ctx.translate(mx, mz);
    ctx.rotate(heading);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5.5, 6); ctx.lineTo(-5.5, 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.restore();
    // North tick.
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('N', C, 12);
  }
}
