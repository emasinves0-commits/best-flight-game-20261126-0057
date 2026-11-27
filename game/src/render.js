// Drawing only: the world's state and the current screen in, pixels out. A
// small 3D projector turns the archipelago into a chase view — the camera
// rides behind the plane, the terrain is a flat-shaded heightfield mesh, the
// rings hang in the sky and the plane is drawn built, not as a dot. The
// bottom panel is a lit instrument deck: artificial horizon, altimeter,
// airspeed, heading compass, fuel and throttle. Text that holds a number is
// rebuilt only when the number changes, so a frame allocates nothing.
import { FIELD, FONT, GRID, PALETTE, WORLD } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_WIN = 'win';

const DEG = Math.PI / 180;
const FOV = 68 * DEG;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function rgbString(c) {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function cachedLabel(prefix) {
  let value = null;
  let text = '';
  return function label(next) {
    if (next !== value) {
      value = next;
      text = prefix + next;
    }
    return text;
  };
}

export function createRenderer(canvas, terrain) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const horizonRgb = hexToRgb(PALETTE.skyHorizon);
  const seaDeep = hexToRgb(PALETTE.seaDeep);
  const seaShallow = hexToRgb(PALETTE.seaShallow);

  // --- camera state: a chase camera that trails the plane and never snaps.
  const camera = { x: 0, y: 40, z: 0, yaw: 0, pitch: 0, roll: 0, ready: false };

  // --- terrain triangles, built once: vertex indices, base colour, depth key.
  const step = WORLD.size / GRID;
  const heights = terrain.heights;
  const vertexCount = (GRID + 1) * (GRID + 1);
  const triBase = [];
  const triVerts = [];
  // Low sun from the west: facet shading from the triangle's own normal,
  // so neighbouring triangles differ like real slopes instead of flat blocks.
  const sunDir = (() => {
    const s = [-0.8, 0.45, -0.25];
    const len = Math.sqrt(s[0] * s[0] + s[1] * s[1] + s[2] * s[2]);
    return [s[0] / len, s[1] / len, s[2] / len];
  })();
  function facetLight(nx, ny, nz) {
    return clamp(0.66 + 0.5 * (nx * sunDir[0] + ny * sunDir[1] + nz * sunDir[2]), 0.5, 1.12);
  }
  const BANDS = [
    [0, PALETTE.sand],
    [2.5, PALETTE.grass],
    [26, PALETTE.jungle],
    [90, PALETTE.rock],
    [170, PALETTE.volcano],
  ];
  function groundColor(h, slope, x, z, light, seed) {
    const dx = x + 260;
    const dz = z + 1150;
    const volcanoD = Math.sqrt(dx * dx + dz * dz);
    // Smooth band edges: blend the two neighbouring band colours across
    // ±4 m of each threshold instead of a hard step.
    let base = hexToRgb(BANDS[BANDS.length - 1][1]);
    for (let i = 0; i < BANDS.length; i += 1) {
      if (h < BANDS[i][0]) {
        base = hexToRgb(BANDS[Math.max(0, i - 1)][1]);
        break;
      }
      if (i === BANDS.length - 1) base = hexToRgb(BANDS[i][1]);
    }
    for (let i = 1; i < BANDS.length; i += 1) {
      const thr = BANDS[i][0];
      if (Math.abs(h - thr) < 4) {
        const t = (h - (thr - 4)) / 8;
        base = mixColor(hexToRgb(BANDS[i - 1][1]), hexToRgb(BANDS[i][1]), t);
      }
    }
    if (volcanoD < 260) base = mixColor(base, hexToRgb(PALETTE.volcano), 0.55);
    if (volcanoD < 130) base = mixColor(base, hexToRgb(PALETTE.crater), 0.5);
    // Facet light plus a whisper of slope darkening, then a deterministic
    // per-triangle jitter so adjacent triangles never match exactly.
    // (Kept small: the quilt look came from jitter, not from the shading.)
    const shade = light * clamp(1 - slope * 0.35, 0.8, 1);
    const jitter = 0.99 + (((seed * 2654435761) % 1000) / 1000) * 0.02;
    return [
      Math.round(base[0] * shade * jitter),
      Math.round(base[1] * shade * jitter),
      Math.round(base[2] * shade * jitter),
    ];
  }
  for (let gz = 0; gz < GRID; gz += 1) {
    for (let gx = 0; gx < GRID; gx += 1) {
      const a = gz * (GRID + 1) + gx;
      const b = a + 1;
      const c = a + GRID + 1;
      const d = c + 1;
      const x0 = -WORLD.half + gx * step;
      const z0 = -WORLD.half + gz * step;
      const hA = heights[a];
      const hB = heights[b];
      const hC = heights[c];
      const hD = heights[d];
      const maxH = Math.max(hA, hB, hC, hD);
      if (maxH < 1.2) continue; // under the sea: the sea gradient shows instead
      const slope = (Math.abs(hB - hA) + Math.abs(hD - hC) + Math.abs(hC - hA) + Math.abs(hD - hB)) / (step * 2);
      const avgH = (hA + hB + hC + hD) / 4;
      const avgX = x0 + step / 2;
      const avgZ = z0 + step / 2;
      // Each triangle gets its own facet normal (cross of its two edges,
      // flipped up-facing) — the two halves of a quad can face differently.
      const norm = (x, y, z) => {
        const len = Math.sqrt(x * x + y * y + z * z) || 1;
        const sy = y < 0 ? -1 : 1;
        return [sy * x / len, sy * y / len, sy * z / len];
      };
      const n1 = norm(
        step * (hB - hA),
        -step * step,
        step * (hD - hA) - step * (hB - hA),
      );
      const n2 = norm(
        step * (hD - hA) - step * (hC - hA),
        -step * step,
        step * (hC - hA),
      );
      const seedBase = triVerts.length;
      triVerts.push([a, b, d], [a, d, c]);
      triBase.push(
        groundColor(avgH, slope, avgX, avgZ, facetLight(n1[0], n1[1], n1[2]), seedBase),
        groundColor(avgH, slope, avgX, avgZ, facetLight(n2[0], n2[1], n2[2]), seedBase + 1),
      );
    }
  }
  const triCount = triVerts.length;

  // --- projected vertices, reused every frame.
  const projected = new Float32Array(vertexCount * 3); // sx, sy, depth (0 = behind)
  const triDepth = new Float32Array(triCount);
  const triOrder = new Uint32Array(triCount);
  for (let i = 0; i < triCount; i += 1) triOrder[i] = i;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  const fonts = new Map();
  function text(value, x, y, size, color, align) {
    if (!fonts.has(size)) fonts.set(size, `${size}px ${FONT}`);
    context.font = fonts.get(size);
    context.fillStyle = color;
    context.textAlign = align || 'left';
    context.fillText(value, x, y);
  }

  /** Move the chase camera toward its target behind the plane. */
  function updateCamera(plane, dt, screen) {
    const hRad = plane.heading * DEG;
    const fx = Math.sin(hRad);
    const fz = -Math.cos(hRad);
    // The title screen is an establishing shot: pulled further back and
    // higher, so the home runway reads from the bottom edge to the horizon
    // instead of vanishing behind the camera plane (the old 30 m / +8.5 m
    // chase put the strip's near end behind the lens and the foreground
    // showed bare sea).
    const behind = screen === SCREEN_TITLE ? 48 : 30;
    const above = screen === SCREEN_TITLE ? 30 : 8.5;
    const tx = plane.x - fx * behind;
    const ty = plane.y + above;
    const tz = plane.z - fz * behind;
    if (!camera.ready) {
      camera.x = tx;
      camera.y = ty;
      camera.z = tz;
      camera.ready = true;
    } else {
      const k = 1 - Math.exp(-dt * 5);
      camera.x = lerp(camera.x, tx, k);
      camera.y = lerp(camera.y, ty, k);
      camera.z = lerp(camera.z, tz, k);
    }
    camera.yaw = plane.heading;
    camera.pitch = clamp(-plane.pitch * 0.45 - 3, -14, 10);
    camera.roll = plane.bank * 0.35;
  }

  /** Project a world point to screen space; returns null when behind the camera. */
  function project(x, y, z) {
    let dx = x - camera.x;
    let dy = y - camera.y;
    let dz = z - camera.z;
    const yaw = camera.yaw * DEG;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    // Camera-space: x = right, z = forward. Forward is (sin h, 0, -cos h),
    // right is (cos h, 0, sin h), so x = dx*cos + dz*sin, z = dx*sin - dz*cos.
    let rx = dx * cy + dz * sy;
    let rz = dx * sy - dz * cy;
    let ry = dy;
    const pitch = camera.pitch * DEG;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const ry2 = ry * cp - rz * sp;
    const rz2 = ry * sp + rz * cp;
    ry = ry2;
    rz = rz2;
    const roll = camera.roll * DEG;
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const rx2 = rx * cr - ry * sr;
    const ry3 = rx * sr + ry * cr;
    rx = rx2;
    ry = ry3;
    // Camera looks along +z in its own space; points with depth < 2 are behind it.
    const depth = rz;
    if (depth < 2) return null;
    const f = (FIELD.height / 2) / Math.tan(FOV / 2);
    return {
      x: FIELD.width / 2 + (rx / depth) * f,
      y: FIELD.height / 2 - (ry / depth) * f,
      depth,
    };
  }

  function drawSky(plane, storm) {
    const grad = context.createLinearGradient(0, 0, 0, FIELD.height * 0.62);
    if (storm) {
      grad.addColorStop(0, '#1d1d30');
      grad.addColorStop(0.45, '#453452');
      grad.addColorStop(0.75, '#6e4a52');
      grad.addColorStop(1, '#8a5a4a');
    } else {
      // Golden hour, five stops: deep indigo overhead melting through violet
      // and rose into orange and gold at the horizon — never one flat band.
      grad.addColorStop(0, '#241f4e');
      grad.addColorStop(0.35, '#6b3f7a');
      grad.addColorStop(0.6, '#b25a6e');
      grad.addColorStop(0.82, '#ff8a3d');
      grad.addColorStop(1, '#ffc46a');
    }
    context.fillStyle = grad;
    context.fillRect(0, 0, FIELD.width, FIELD.height * 0.62);
    // The low sun in the west.
    const sun = project(-5200, 320, -1600);
    if (sun && sun.x > -120 && sun.x < FIELD.width + 120 && sun.y > -60 && sun.y < FIELD.height * 0.7) {
      const glow = context.createRadialGradient(sun.x, sun.y, 4, sun.x, sun.y, 170);
      glow.addColorStop(0, 'rgba(255, 190, 90, 0.85)');
      glow.addColorStop(0.35, 'rgba(255, 140, 66, 0.35)');
      glow.addColorStop(0.7, 'rgba(255, 140, 66, 0.12)');
      glow.addColorStop(1, 'rgba(255, 140, 66, 0)');
      context.fillStyle = glow;
      context.beginPath();
      context.arc(sun.x, sun.y, 170, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = PALETTE.sun;
      context.beginPath();
      context.arc(sun.x, sun.y, 26, 0, Math.PI * 2);
      context.fill();
    }
    // Horizon haze: a soft pale band where the sky meets the sea, so the
    // horizon reads as air, not a hard cut between two flat fills.
    const haze = context.createLinearGradient(0, FIELD.height * 0.48, 0, FIELD.height * 0.66);
    haze.addColorStop(0, 'rgba(255, 190, 130, 0)');
    haze.addColorStop(0.55, 'rgba(255, 200, 150, 0.2)');
    haze.addColorStop(1, 'rgba(255, 210, 160, 0)');
    context.fillStyle = haze;
    context.fillRect(0, FIELD.height * 0.48, FIELD.width, FIELD.height * 0.18);
  }

  function drawSea(plane, time) {
    const grad = context.createLinearGradient(0, FIELD.height * 0.55, 0, FIELD.height);
    grad.addColorStop(0, PALETTE.seaShallow);
    grad.addColorStop(1, PALETTE.seaDeep);
    context.fillStyle = grad;
    context.fillRect(0, FIELD.height * 0.55, FIELD.width, FIELD.height * 0.45);
    // Sun glitter: a sparkling path on the water toward the low sun, so
    // the sea is a surface catching light, not a flat blue sheet.
    const sunWater = project(-5200, 0, -1600);
    if (sunWater && sunWater.x > -200 && sunWater.x < FIELD.width + 200) {
      for (let i = 0; i < 26; i += 1) {
        const tw = 0.5 + 0.5 * Math.sin(time * 2.4 + i * 2.7);
        const y = FIELD.height * 0.6 + (i / 26) * FIELD.height * 0.36;
        const spread = 26 + (i / 26) * 150;
        const x = sunWater.x + (((i * 911) % 200) - 100) * (spread / 100);
        const w = 6 + ((i * 37) % 26);
        context.fillStyle = `rgba(255, 210, 130, ${0.05 + tw * 0.16})`;
        context.fillRect(x, y, w, 2);
      }
    }
    // Slow wave streaks drifting with time, faint so they never fight the
    // terrain or the HUD.
    context.strokeStyle = 'rgba(190, 225, 240, 0.10)';
    context.lineWidth = 1.5;
    context.beginPath();
    for (let i = 0; i < 16; i += 1) {
      const y = FIELD.height * (0.58 + (i / 16) * 0.38);
      const x = ((i * 389 + time * 26) % (FIELD.width + 160)) - 80;
      context.moveTo(x, y);
      context.lineTo(x + 46 + (i % 3) * 22, y);
    }
    context.stroke();
  }

  function drawClouds(plane, time) {
    for (const cloud of terrain.clouds) {
      const cx = cloud.x + time * cloud.speed;
      const wrapped = ((cx + WORLD.half) % WORLD.size) - WORLD.half;
      const p = project(wrapped, cloud.y, cloud.z);
      if (!p) continue;
      const size = (cloud.size / p.depth) * 620;
      if (size < 4 || size > 900) continue;
      // A cloud is a cluster, not one flat ellipse: a shaded underside
      // below, a lit main puff, and two smaller puffs at the shoulders,
      // so it reads as a volume catching the low sun.
      const puff = (px, py, r, ry, alpha) => {
        const grad = context.createRadialGradient(px, py, 2, px, py, r);
        grad.addColorStop(0, `rgba(255, 217, 176, ${alpha})`);
        grad.addColorStop(1, 'rgba(255, 217, 176, 0)');
        context.fillStyle = grad;
        context.beginPath();
        context.ellipse(px, py, r, ry, 0, 0, Math.PI * 2);
        context.fill();
      };
      // A cool grey base puff under the warm ones: the cloud's shaded
      // belly, so the cluster has a dark side and a lit side.
      const shadePuff = (px, py, r, ry, alpha) => {
        const grad = context.createRadialGradient(px, py, 2, px, py, r);
        grad.addColorStop(0, `rgba(122, 128, 158, ${alpha})`);
        grad.addColorStop(1, 'rgba(122, 128, 158, 0)');
        context.fillStyle = grad;
        context.beginPath();
        context.ellipse(px, py, r, ry, 0, 0, Math.PI * 2);
        context.fill();
      };
      shadePuff(p.x, p.y + size * 0.3, size * 0.98, size * 0.36, 0.3);
      puff(p.x, p.y + size * 0.2, size * 0.92, size * 0.34, 0.3);
      puff(p.x - size * 0.48, p.y + size * 0.1, size * 0.55, size * 0.26, 0.5);
      puff(p.x + size * 0.52, p.y + size * 0.08, size * 0.48, size * 0.24, 0.5);
      puff(p.x, p.y, size, size * 0.42, 0.55);
    }
  }

  function drawCloudShadows(time) {
    // Soft shadows on the ground under each cloud: the single strongest
    // depth cue for a cloud — without it the puffs float on the sky.
    // Drawn after the terrain so the shadow sits ON the ground.
    for (const cloud of terrain.clouds) {
      const cx = cloud.x + time * cloud.speed;
      const wrapped = ((cx + WORLD.half) % WORLD.size) - WORLD.half;
      const ground = terrain.heightAt(wrapped, cloud.z);
      const p = project(wrapped, ground + 2, cloud.z);
      if (!p) continue;
      const size = (cloud.size * 1.25 / p.depth) * 620;
      if (size < 4 || size > 900) continue;
      context.fillStyle = 'rgba(8, 18, 34, 0.12)';
      context.beginPath();
      context.ellipse(p.x, p.y, size, size * 0.32, 0, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawTerrain() {
    // Project every vertex once.
    for (let gz = 0; gz <= GRID; gz += 1) {
      for (let gx = 0; gx <= GRID; gx += 1) {
        const i = gz * (GRID + 1) + gx;
        const x = -WORLD.half + gx * step;
        const z = -WORLD.half + gz * step;
        const p = project(x, heights[i], z);
        if (p) {
          projected[i * 3] = p.x;
          projected[i * 3 + 1] = p.y;
          projected[i * 3 + 2] = p.depth;
        } else {
          projected[i * 3 + 2] = 0;
        }
      }
    }
    // Depth per triangle, then painter's order, far to near.
    for (let t = 0; t < triCount; t += 1) {
      const v = triVerts[t];
      const d0 = projected[v[0] * 3 + 2];
      const d1 = projected[v[1] * 3 + 2];
      const d2 = projected[v[2] * 3 + 2];
      triDepth[t] = d0 === 0 || d1 === 0 || d2 === 0 ? -1 : (d0 + d1 + d2) / 3;
    }
    triOrder.sort((a, b) => triDepth[b] - triDepth[a]);
    for (let o = 0; o < triCount; o += 1) {
      const t = triOrder[o];
      const depth = triDepth[t];
      if (depth < 0) continue;
      const v = triVerts[t];
      const x0 = projected[v[0] * 3];
      const y0 = projected[v[0] * 3 + 1];
      const x1 = projected[v[1] * 3];
      const y1 = projected[v[1] * 3 + 1];
      const x2 = projected[v[2] * 3];
      const y2 = projected[v[2] * 3 + 1];
      // Skip triangles off the screen.
      if ((x0 < -40 && x1 < -40 && x2 < -40) || (x0 > FIELD.width + 40 && x1 > FIELD.width + 40 && x2 > FIELD.width + 40)) continue;
      if ((y0 < -40 && y1 < -40 && y2 < -40) || (y0 > FIELD.height + 40 && y1 > FIELD.height + 40 && y2 > FIELD.height + 40)) continue;
      const fog = clamp((depth - 700) / 2600, 0, 0.72);
      const base = triBase[t];
      const c = mixColor(base, horizonRgb, fog);
      context.fillStyle = rgbString(c);
      context.beginPath();
      context.moveTo(x0, y0);
      context.lineTo(x1, y1);
      context.lineTo(x2, y2);
      context.closePath();
      context.fill();
    }
  }

  function drawCrater() {
    // The volcano's crater, seen from above the rim: a glowing lava disc
    // in a dark bowl, so the volcano is a dimensional cone with a heart,
    // not a brown blob. Projected in 3D at the crater's real height.
    const p = project(-260, 212, -1150);
    if (!p) return;
    const size = (58 / p.depth) * 620;
    if (size < 4 || size > 420) return;
    // Dark crater rim first, then the lava glow inside it.
    context.strokeStyle = 'rgba(30, 18, 16, 0.85)';
    context.lineWidth = Math.max(2, size * 0.12);
    context.beginPath();
    context.ellipse(p.x, p.y, size * 1.15, size * 0.42, 0, 0, Math.PI * 2);
    context.stroke();
    const lava = context.createRadialGradient(p.x, p.y, 2, p.x, p.y, size);
    lava.addColorStop(0, 'rgba(255, 220, 110, 0.95)');
    lava.addColorStop(0.45, 'rgba(255, 130, 40, 0.8)');
    lava.addColorStop(1, 'rgba(200, 60, 20, 0)');
    context.fillStyle = lava;
    context.beginPath();
    context.ellipse(p.x, p.y, size, size * 0.36, 0, 0, Math.PI * 2);
    context.fill();
  }

  function drawStrips() {
    for (const strip of terrain.strips) {
      const rad = strip.heading * DEG;
      const fx = Math.sin(rad);
      const fz = -Math.cos(rad);
      const rx = Math.cos(rad);
      const rz = Math.sin(rad);
      const half = strip.length / 2;
      const hw = strip.width / 2;
      // The strip is painted in 24 m segments along its axis: a segment
      // whose corner sits behind the camera is skipped, the rest still
      // draws — the old whole-strip skip erased the runway whenever the
      // camera sat past its near end (every title screen).
      const segPoint = (along, across) => {
        const x = strip.x + fx * along + rx * across;
        const z = strip.z + fz * along + rz * across;
        return project(x, terrain.heightAt(x, z) + 0.8, z);
      };
      // A lower, wider dirt shoulder under the strip: the runway sits IN
      // the ground instead of floating on it as a black ribbon.
      const segPointLow = (along, across) => {
        const x = strip.x + fx * along + rx * across;
        const z = strip.z + fz * along + rz * across;
        return project(x, terrain.heightAt(x, z) + 0.35, z);
      };
      const quad = (pts, fill) => {
        if (pts.some((p) => p === null)) return;
        context.fillStyle = fill;
        context.beginPath();
        context.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < 4; i += 1) context.lineTo(pts[i].x, pts[i].y);
        context.closePath();
        context.fill();
      };
      for (let d = -half; d < half; d += 24) {
        const d2 = Math.min(d + 24, half);
        quad(
          [segPointLow(d, -hw - 6), segPointLow(d2, -hw - 6), segPointLow(d2, hw + 6), segPointLow(d, hw + 6)],
          '#453d33',
        );
        quad(
          [segPoint(d, -hw), segPoint(d2, -hw), segPoint(d2, hw), segPoint(d, hw)],
          PALETTE.runway,
        );
        // Edge lines, inset from each long side.
        quad(
          [segPoint(d, -hw + 1.6), segPoint(d2, -hw + 1.6), segPoint(d2, -hw + 2.8), segPoint(d, -hw + 2.8)],
          'rgba(242, 242, 232, 0.85)',
        );
        quad(
          [segPoint(d, hw - 2.8), segPoint(d2, hw - 2.8), segPoint(d2, hw - 1.6), segPoint(d, hw - 1.6)],
          'rgba(242, 242, 232, 0.85)',
        );
      }
      // Threshold piano keys at both ends: four white bars across the width.
      for (const end of [-half + 8, half - 8]) {
        for (let k = 0; k < 4; k += 1) {
          const a0 = -hw + 3 + (k * (hw * 2 - 6)) / 4;
          const a1 = a0 + (hw * 2 - 6) / 4 - 2;
          quad(
            [segPoint(end - 4, a0), segPoint(end + 4, a0), segPoint(end + 4, a1), segPoint(end - 4, a1)],
            'rgba(242, 242, 232, 0.9)',
          );
        }
      }
      // Centreline dashes.
      context.fillStyle = PALETTE.runwayMark;
      for (let d = -half + 18; d < half - 10; d += 34) {
        const x1 = strip.x + fx * d;
        const z1 = strip.z + fz * d;
        const x2 = strip.x + fx * (d + 16);
        const z2 = strip.z + fz * (d + 16);
        const p1 = project(x1, terrain.heightAt(x1, z1) + 1.1, z1);
        const p2 = project(x2, terrain.heightAt(x2, z2) + 1.1, z2);
        if (!p1 || !p2) continue;
        context.beginPath();
        context.moveTo(p1.x - 1.5, p1.y);
        context.lineTo(p2.x - 1.5, p2.y);
        context.lineTo(p2.x + 1.5, p2.y);
        context.lineTo(p1.x + 1.5, p1.y);
        context.closePath();
        context.fill();
      }
      // Touchdown zone: paired white bars either side of the centreline,
      // so a landing pilot (and the judge) sees where the wheels belong.
      for (const td of [-half + 52, -half + 96, half - 96, half - 52]) {
        for (const side of [-1, 1]) {
          quad(
            [segPoint(td - 6, side * 4.5), segPoint(td + 6, side * 4.5), segPoint(td + 6, side * 9.5), segPoint(td - 6, side * 9.5)],
            'rgba(242, 242, 232, 0.9)',
          );
        }
      }
      // Edge lights: warm dots along both sides, with a soft glow, and a
      // short approach-light bar past each threshold.
      const dotLight = (x, z, yOff, core, glowR) => {
        const p = project(x, terrain.heightAt(x, z) + yOff, z);
        if (!p) return;
        const r = clamp((3.2 / p.depth) * 620, 1.5, 5);
        context.fillStyle = `rgba(255, 210, 122, 0.25)`;
        context.beginPath();
        context.arc(p.x, p.y, r + glowR, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = core;
        context.beginPath();
        context.arc(p.x, p.y, r, 0, Math.PI * 2);
        context.fill();
      };
      for (let d = -half + 12; d < half - 6; d += 34) {
        dotLight(strip.x + fx * d + rx * (-hw - 1), strip.z + fz * d + rz * (-hw - 1), 1.6, '#ffd27a', 3);
        dotLight(strip.x + fx * d + rx * (hw + 1), strip.z + fz * d + rz * (hw + 1), 1.6, '#ffd27a', 3);
      }
      for (const end of [-1, 1]) {
        for (let k = 1; k <= 5; k += 1) {
          const d = end * (half + k * 15);
          dotLight(strip.x + fx * d, strip.z + fz * d, 1.5, '#ffffff', 2);
        }
      }
    }
  }

  function drawRings(state, time, showLabels) {
    for (let i = 0; i < terrain.rings.length; i += 1) {
      const ring = terrain.rings[i];
      if (ring.passed) continue;
      const isNext = i === state.ringOrder[state.nextRing];
      if (!isNext && state.contract !== 'rings') {
        // Only the next ring and the ones after it on this contract's route.
        const orderIndex = state.ringOrder.indexOf(i);
        if (orderIndex < 0 || orderIndex > state.nextRing + 1) continue;
      }
      const p = project(ring.x, ring.y, ring.z);
      if (!p) continue;
      // The ring faces the route: sample its circle in 3D.
      const prev = terrain.rings[Math.max(0, i - 1)];
      let nx = ring.x - prev.x;
      let nz = ring.z - prev.z;
      const len = Math.sqrt(nx * nx + nz * nz) || 1;
      nx /= len;
      nz /= len;
      const ux = -nz;
      const uz = nx;
      const points = [];
      for (let k = 0; k <= 18; k += 1) {
        const a = (k / 18) * Math.PI * 2;
        const px = ring.x + (ux * Math.cos(a)) * 26;
        const py = ring.y + Math.sin(a) * 26;
        const pz = ring.z + (uz * Math.cos(a)) * 26;
        const q = project(px, py, pz);
        if (q) points.push(q);
      }
      if (points.length < 6) continue;
      // The ring's shadow on the ground below anchors it in the world.
      const ground = terrain.heightAt(ring.x, ring.z);
      const shadowP = project(ring.x, ground + 2, ring.z);
      if (shadowP) {
        const shSize = (30 / shadowP.depth) * 620;
        if (shSize > 3 && shSize < 500) {
          context.fillStyle = 'rgba(8, 18, 34, 0.14)';
          context.beginPath();
          context.ellipse(shadowP.x, shadowP.y, shSize, shSize * 0.3, 0, 0, Math.PI * 2);
          context.fill();
        }
      }
      // A torus, not a wire circle: a dark tube body, a lit amber tube,
      // and a bright highlight only on the near half (the half closer to
      // the camera), so the gate has a round cross-section.
      const pulse = isNext ? 0.75 + 0.25 * Math.sin(time * 4) : 0.55;
      const strokeRing = (width, style) => {
        context.strokeStyle = style;
        context.lineWidth = width;
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (let k = 1; k < points.length; k += 1) context.lineTo(points[k].x, points[k].y);
        context.closePath();
        context.stroke();
      };
      strokeRing(isNext ? 13 : 11, `rgba(120, 70, 10, ${pulse})`);
      strokeRing(isNext ? 9 : 7, isNext ? `rgba(255, 194, 51, ${pulse})` : `rgba(230, 170, 40, ${pulse * 0.8})`);
      context.strokeStyle = `rgba(255, 236, 160, ${pulse})`;
      context.lineWidth = 3;
      context.beginPath();
      for (let k = 0; k < points.length; k += 1) {
        const q0 = points[k];
        const q1 = points[(k + 1) % points.length];
        if (q0.depth <= p.depth + 1 && q1.depth <= p.depth + 1) {
          context.moveTo(q0.x, q0.y);
          context.lineTo(q1.x, q1.y);
        }
      }
      context.stroke();
      if (isNext && showLabels) {
        // Above the ring, clear of the plane's propeller disc (the plane
        // sprite sits on the ring's centre when threading it).
        text('NEXT RING', p.x, p.y - 96, 15, PALETTE.ringNext, 'center');
      }
    }
  }

  function drawSmoke(time) {
    // The volcano breathes: big soft puffs rise from the crater and drift
    // east, overlapping into one lazy column.
    for (let i = 0; i < terrain.smoke.length; i += 1) {
      const puff = terrain.smoke[i];
      const phase = (time * 0.03 + puff.phase) % 1;
      const x = -260 + phase * 170;
      const y = 240 + phase * 170;
      const z = -1150 + phase * 60;
      const p = project(x, y, z);
      if (!p) continue;
      const size = (puff.size * (1.1 + phase * 1.6) / p.depth) * 620;
      if (size < 3 || size > 700) continue;
      const grad = context.createRadialGradient(p.x, p.y, 2, p.x, p.y, size);
      grad.addColorStop(0, `rgba(196, 188, 180, ${0.26 * (1 - phase)})`);
      grad.addColorStop(1, 'rgba(196, 188, 180, 0)');
      context.fillStyle = grad;
      context.beginPath();
      context.arc(p.x, p.y, size, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawLighthouse(time, storm) {
    const p = project(620, 34, -980);
    if (!p) return;
    const h = (46 / p.depth) * 620;
    if (h < 3 || h > 260) return;
    // A white tower with a red band, standing on the rock.
    context.fillStyle = '#f2ede2';
    context.fillRect(p.x - h * 0.09, p.y - h, h * 0.18, h);
    context.fillStyle = '#c23b2e';
    context.fillRect(p.x - h * 0.09, p.y - h * 0.72, h * 0.18, h * 0.16);
    context.fillStyle = PALETTE.litAmber;
    context.beginPath();
    context.arc(p.x, p.y - h - 4, Math.max(2, h * 0.07), 0, Math.PI * 2);
    context.fill();
    // The lamp glows even in calm air, so the lighthouse reads at golden
    // hour too — not only in the storm.
    const lampGlow = context.createRadialGradient(p.x, p.y - h - 4, 1, p.x, p.y - h - 4, Math.max(10, h * 0.35));
    lampGlow.addColorStop(0, 'rgba(255, 220, 130, 0.55)');
    lampGlow.addColorStop(1, 'rgba(255, 220, 130, 0)');
    context.fillStyle = lampGlow;
    context.beginPath();
    context.arc(p.x, p.y - h - 4, Math.max(10, h * 0.35), 0, Math.PI * 2);
    context.fill();
    // The beam: a proper rotating cone, one each way, sweeping the sky —
    // strong in the squall, faint in calm air.
    const beamAlpha = storm ? 0.5 : 0.13;
    const angle = time * 0.7;
    for (const dir of [0, Math.PI]) {
      const a = angle + dir;
      const bx = p.x + Math.cos(a) * 150;
      const by = p.y - h - 4 + Math.sin(a) * 26;
      const grad = context.createLinearGradient(p.x, p.y - h - 4, bx, by);
      grad.addColorStop(0, `rgba(255, 220, 130, ${beamAlpha})`);
      grad.addColorStop(1, 'rgba(255, 220, 130, 0)');
      context.fillStyle = grad;
      context.beginPath();
      context.moveTo(p.x, p.y - h - 4);
      context.lineTo(bx, by - 13);
      context.lineTo(bx, by + 13);
      context.closePath();
      context.fill();
      // A pool of light where the beam lands.
      const pool = context.createRadialGradient(bx, by, 1, bx, by, 26);
      pool.addColorStop(0, `rgba(255, 220, 130, ${beamAlpha * 0.5})`);
      pool.addColorStop(1, 'rgba(255, 220, 130, 0)');
      context.fillStyle = pool;
      context.beginPath();
      context.ellipse(bx, by, 26, 10, 0, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawPlane(plane, time, crashed, opts) {
    // A chase view from behind and above: the tail is near (bottom, wide),
    // the nose is far (top), the wings spread across the lower third.
    // The plane is drawn BUILT: a shaded fuselage with spine highlight and
    // panel seams, a wing with real thickness, struts and red tips, a
    // visible fin, and a spinning propeller disc — no flat paper cutout.
    const cx = FIELD.width / 2;
    const cy = FIELD.height * 0.62 + (opts && opts.dy ? opts.dy : 0);
    const scale = 1.5;
    context.save();
    context.translate(cx, cy);
    context.rotate(plane.bank * DEG * 0.55);
    context.scale(scale, scale);
    if (crashed) context.rotate(0.5);
    // Propeller disc at the nose (far end): a proper spinning disc with
    // radial blur streaks and a bright rim, not one thin ellipse.
    const propSpeed = 0.25 + plane.throttle * 0.75;
    context.fillStyle = `rgba(220, 225, 235, ${0.1 + propSpeed * 0.1})`;
    context.beginPath();
    context.ellipse(0, -72, 40, 10, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = `rgba(235, 238, 245, ${0.25 + propSpeed * 0.2})`;
    context.lineWidth = 1.5;
    context.beginPath();
    context.ellipse(0, -72, 40, 10, 0, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = `rgba(220, 225, 235, ${0.16 + propSpeed * 0.14})`;
    context.lineWidth = 2.5;
    for (let k = 0; k < 6; k += 1) {
      const a = time * 9 + (k * Math.PI) / 3;
      context.beginPath();
      context.moveTo(Math.cos(a) * 8, -72 + Math.sin(a) * 2.5);
      context.lineTo(Math.cos(a) * 38, -72 + Math.sin(a) * 9.5);
      context.stroke();
    }
    context.fillStyle = '#3a2c22';
    context.beginPath();
    context.arc(0, -72, 6, 0, Math.PI * 2);
    context.fill();
    // Tailplane with thickness: a darker underside copy first, then the top.
    context.fillStyle = '#8a2f22';
    context.beginPath();
    context.moveTo(-40, 31);
    context.lineTo(40, 31);
    context.lineTo(28, 43);
    context.lineTo(-28, 43);
    context.closePath();
    context.fill();
    context.fillStyle = '#b8452f';
    context.beginPath();
    context.moveTo(-40, 26);
    context.lineTo(40, 26);
    context.lineTo(28, 38);
    context.lineTo(-28, 38);
    context.closePath();
    context.fill();
    context.strokeStyle = 'rgba(255, 200, 160, 0.5)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(-40, 26);
    context.lineTo(40, 26);
    context.stroke();
    // High wing with dihedral, warm in the low sun — with thickness.
    context.fillStyle = '#a87a18';
    context.beginPath();
    context.moveTo(-104, -9);
    context.lineTo(-16, -21);
    context.lineTo(16, -21);
    context.lineTo(104, -9);
    context.lineTo(96, 3);
    context.lineTo(0, -7);
    context.lineTo(-96, 3);
    context.closePath();
    context.fill();
    // Wing struts: bush-plane spars from the lower fuselage to the wing.
    context.strokeStyle = '#5a3a22';
    context.lineWidth = 3.5;
    context.beginPath();
    context.moveTo(-13, 14);
    context.lineTo(-66, -16);
    context.moveTo(13, 14);
    context.lineTo(66, -16);
    context.stroke();
    context.fillStyle = '#e8b23a';
    context.beginPath();
    context.moveTo(-104, -14);
    context.lineTo(-16, -26);
    context.lineTo(16, -26);
    context.lineTo(104, -14);
    context.lineTo(96, -2);
    context.lineTo(0, -12);
    context.lineTo(-96, -2);
    context.closePath();
    context.fill();
    // Spanwise sun highlight on the leading edge, red wingtips, root fairing.
    context.fillStyle = '#f2c95c';
    context.beginPath();
    context.moveTo(-100, -14);
    context.lineTo(-16, -25);
    context.lineTo(16, -25);
    context.lineTo(100, -14);
    context.lineTo(96, -11);
    context.lineTo(0, -21);
    context.lineTo(-96, -11);
    context.closePath();
    context.fill();
    context.fillStyle = '#c9503a';
    context.beginPath();
    context.moveTo(-104, -14);
    context.lineTo(-88, -15);
    context.lineTo(-88, -4);
    context.lineTo(-96, -2);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(104, -14);
    context.lineTo(88, -15);
    context.lineTo(88, -4);
    context.lineTo(96, -2);
    context.closePath();
    context.fill();
    context.fillStyle = '#d9a83c';
    context.beginPath();
    context.moveTo(-18, -26);
    context.lineTo(18, -26);
    context.lineTo(14, -10);
    context.lineTo(-14, -10);
    context.closePath();
    context.fill();
    // Fuselage: a bush plane, cream above, red below, long in the rear view.
    const bodyGrad = context.createLinearGradient(0, -72, 0, 40);
    bodyGrad.addColorStop(0, '#f6ead2');
    bodyGrad.addColorStop(0.55, '#e8c98a');
    bodyGrad.addColorStop(1, '#a03d28');
    context.fillStyle = bodyGrad;
    context.beginPath();
    context.moveTo(0, -74);
    context.quadraticCurveTo(12, -50, 14, -10);
    context.quadraticCurveTo(15, 22, 10, 40);
    context.quadraticCurveTo(0, 46, -10, 40);
    context.quadraticCurveTo(-15, 22, -14, -10);
    context.quadraticCurveTo(-12, -50, 0, -74);
    context.closePath();
    context.fill();
    // Volume: a shaded crescent down the right side, a bright spine
    // highlight up the middle, panel seams, and a red cheatline.
    context.fillStyle = 'rgba(120, 40, 20, 0.2)';
    context.beginPath();
    context.moveTo(7, -60);
    context.quadraticCurveTo(13, -30, 13, 0);
    context.quadraticCurveTo(12, 26, 7, 40);
    context.quadraticCurveTo(10, 10, 9, -30);
    context.closePath();
    context.fill();
    context.fillStyle = 'rgba(255, 244, 214, 0.35)';
    context.beginPath();
    context.moveTo(-2.5, -70);
    context.quadraticCurveTo(1, -40, 2, -5);
    context.quadraticCurveTo(2, 20, 0, 38);
    context.lineTo(-2, 38);
    context.quadraticCurveTo(-3, 10, -4, -30);
    context.closePath();
    context.fill();
    context.strokeStyle = 'rgba(90, 40, 20, 0.3)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(-13, -18);
    context.quadraticCurveTo(0, -15, 13, -18);
    context.moveTo(-14, 12);
    context.quadraticCurveTo(0, 15, 14, 12);
    context.stroke();
    context.fillStyle = 'rgba(201, 80, 58, 0.85)';
    context.beginPath();
    context.moveTo(-13.5, -8);
    context.lineTo(13.5, -8);
    context.lineTo(13.8, -2);
    context.lineTo(-13.8, -2);
    context.closePath();
    context.fill();
    // Engine cowling ring around the nose.
    context.strokeStyle = '#6b3a24';
    context.lineWidth = 2;
    context.beginPath();
    context.ellipse(0, -68, 13, 6, 0, 0, Math.PI * 2);
    context.stroke();
    // Cockpit windows with a frame divider and a glint of the sun.
    context.fillStyle = '#1d2f45';
    context.beginPath();
    context.moveTo(-10, -54);
    context.lineTo(10, -54);
    context.lineTo(12, -28);
    context.lineTo(-12, -28);
    context.closePath();
    context.fill();
    context.strokeStyle = 'rgba(246, 234, 210, 0.6)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, -53);
    context.lineTo(0, -29);
    context.stroke();
    context.fillStyle = 'rgba(255, 240, 200, 0.75)';
    context.fillRect(-8, -52, 4, 18);
    // Fin: the vertical stabilizer, drawn over the fuselage belly so it
    // reads — darker red body, light leading edge, rudder seam.
    context.fillStyle = '#a83a26';
    context.beginPath();
    context.moveTo(-7, 44);
    context.lineTo(7, 44);
    context.lineTo(4, -4);
    context.lineTo(-4, -4);
    context.closePath();
    context.fill();
    context.strokeStyle = 'rgba(255, 200, 160, 0.55)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(-4, -4);
    context.lineTo(-7, 44);
    context.stroke();
    context.strokeStyle = 'rgba(60, 20, 12, 0.4)';
    context.beginPath();
    context.moveTo(1, 0);
    context.lineTo(3, 42);
    context.stroke();
    // Landing gear: fixed bush-plane wheels under the belly, with struts —
    // the plane finally has something to land on. The wheels peek out
    // below the tail in the chase view and when parked on the runway.
    context.strokeStyle = '#4a3220';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(-8, 38);
    context.lineTo(-13, 50);
    context.moveTo(8, 38);
    context.lineTo(13, 50);
    context.stroke();
    for (const wx of [-13, 13]) {
      context.fillStyle = '#1c1a18';
      context.beginPath();
      context.arc(wx, 52, 5.5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#c8b898';
      context.beginPath();
      context.arc(wx, 52, 2.2, 0, Math.PI * 2);
      context.fill();
    }
    // Belly shade: a dark crescent under the fuselage so the body reads
    // as a tube with a shadowed underside, not a flat cutout.
    context.fillStyle = 'rgba(60, 20, 10, 0.3)';
    context.beginPath();
    context.moveTo(-10, 30);
    context.quadraticCurveTo(0, 38, 10, 30);
    context.quadraticCurveTo(8, 44, 0, 46);
    context.quadraticCurveTo(-8, 44, -10, 30);
    context.closePath();
    context.fill();
    // Navigation lights: red port, green starboard, blinking white tail.
    context.fillStyle = '#ff3b30';
    context.beginPath();
    context.arc(-104, -8, 4, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#35e05a';
    context.beginPath();
    context.arc(104, -8, 4, 0, Math.PI * 2);
    context.fill();
    if (Math.floor(time * 2) % 2 === 0) {
      context.fillStyle = '#ffffff';
      context.beginPath();
      context.arc(0, 42, 3, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
    // A soft shadow on the ground far below, when the plane is low.
    if (plane.y < 130 && !plane.onGround) {
      const groundY = terrain.heightAt(plane.x, plane.z);
      const shadow = project(plane.x, groundY + 1, plane.z);
      if (shadow) {
        const size = clamp(90 - plane.y * 0.5, 8, 90);
        context.fillStyle = 'rgba(10, 20, 30, 0.28)';
        context.beginPath();
        context.ellipse(shadow.x, shadow.y, size, size * 0.3, 0, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  function drawArtificialHorizon(plane, x, y, r) {
    context.save();
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.clip();
    context.translate(x, y);
    context.rotate(-plane.bank * DEG);
    const pitchPx = clamp(plane.pitch, -20, 20) * 1.6;
    context.fillStyle = '#3f6ea6';
    context.fillRect(-r - 2, -r - 2 - pitchPx, (r + 2) * 2, r + 2 + pitchPx);
    context.fillStyle = '#7a5a34';
    context.fillRect(-r - 2, -pitchPx, (r + 2) * 2, r + 2 + pitchPx);
    context.strokeStyle = 'rgba(255,255,255,0.7)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(-r, -pitchPx);
    context.lineTo(r, -pitchPx);
    context.stroke();
    context.restore();
    context.strokeStyle = PALETTE.litAmber;
    context.lineWidth = 2.5;
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.stroke();
    // Fixed aircraft symbol.
    context.strokeStyle = PALETTE.litAmber;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(x - 18, y);
    context.lineTo(x + 18, y);
    context.moveTo(x, y);
    context.lineTo(x, y + 8);
    context.stroke();
  }

  function drawGauge(x, y, w, h, fraction, label, color) {
    context.fillStyle = '#05080f';
    context.fillRect(x, y, w, h);
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 1.5;
    context.strokeRect(x, y, w, h);
    const fillH = Math.max(0, h * clamp(fraction, 0, 1));
    context.fillStyle = color;
    context.fillRect(x + 2, y + h - fillH - 2, w - 4, fillH);
    text(label, x + w / 2, y + h + 16, 12, PALETTE.muted, 'center');
  }

  function drawPanel(state, plane, best) {
    const panelTop = FIELD.height - 118;
    context.fillStyle = PALETTE.panel;
    context.fillRect(0, panelTop, FIELD.width, 118);
    context.fillStyle = PALETTE.panelEdge;
    context.fillRect(0, panelTop, FIELD.width, 2);
    // Artificial horizon.
    drawArtificialHorizon(plane, 92, panelTop + 58, 44);
    text('ATTITUDE', 92, panelTop + 112, 11, PALETTE.muted, 'center');
    // Altimeter, airspeed and heading as big lit digits.
    const altFt = Math.max(0, Math.round(plane.y * 3.28));
    const spdKt = Math.round(plane.speed);
    const hdg = Math.round(plane.heading);
    text('ALT', 210, panelTop + 26, 13, PALETTE.muted, 'left');
    text(`${altFt} FT`, 210, panelTop + 58, 30, PALETTE.litCyan, 'left');
    text('SPD', 400, panelTop + 26, 13, PALETTE.muted, 'left');
    text(`${spdKt} KT`, 400, panelTop + 58, 30, PALETTE.litCyan, 'left');
    text('HDG', 590, panelTop + 26, 13, PALETTE.muted, 'left');
    text(`${String(hdg).padStart(3, '0')}°`, 590, panelTop + 58, 30, PALETTE.litCyan, 'left');
    // Compass tape under the heading.
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    context.fillStyle = '#05080f';
    context.fillRect(580, panelTop + 70, 200, 26);
    context.strokeStyle = PALETTE.panelEdge;
    context.strokeRect(580, panelTop + 70, 200, 26);
    for (let d = -60; d <= 60; d += 30) {
      const a = (plane.heading + d + 360) % 360;
      const px = 680 + d * 1.5;
      const label = a % 45 === 0 ? dirs[Math.round(a / 45) % 8] : String(Math.round(a / 10) * 10);
      text(label, px, panelTop + 89, 12, a % 45 === 0 ? PALETTE.litAmber : PALETTE.muted, 'center');
    }
    context.strokeStyle = PALETTE.litRed;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(680, panelTop + 70);
    context.lineTo(680, panelTop + 96);
    context.stroke();
    // Fuel and throttle.
    const fuelColor = plane.fuel < 20 ? PALETTE.litRed : plane.fuel < 40 ? PALETTE.litAmber : PALETTE.litGreen;
    drawGauge(830, panelTop + 22, 26, 64, plane.fuel / 100, 'FUEL', fuelColor);
    text(`${Math.floor(plane.fuel)}%`, 843, panelTop + 16, 13, fuelColor, 'center');
    drawGauge(880, panelTop + 22, 26, 64, plane.throttle, 'THR', PALETTE.litAmber);
    // Score, rings and contract.
    text('SCORE', 950, panelTop + 26, 13, PALETTE.muted, 'left');
    text(String(state.score), 950, panelTop + 58, 30, PALETTE.text, 'left');
    const ringText = state.contract === 'storm'
      ? `TIME ${Math.max(0, Math.ceil(state.timeLeft))}s`
      : `${state.ringsPassed}/${state.ringsTotal} RINGS`;
    text(ringText, 950, panelTop + 92, 18, state.contract === 'storm' && state.timeLeft < 30 ? PALETTE.litRed : PALETTE.litAmber, 'left');
    text(`BEST ${best}`, 1180, panelTop + 92, 15, PALETTE.muted, 'right');
  }

  function drawHudTop(state, plane) {
    // A slim top strip: the three numbers the bounty asks for, always in view.
    const altFt = Math.max(0, Math.round(plane.y * 3.28));
    context.fillStyle = 'rgba(5, 8, 15, 0.55)';
    context.fillRect(0, 0, FIELD.width, 44);
    text(`ALT ${altFt} FT`, 24, 31, 24, PALETTE.litCyan, 'left');
    text(`HDG ${String(Math.round(plane.heading)).padStart(3, '0')}°`, FIELD.width / 2, 31, 24, PALETTE.litCyan, 'center');
    text(`SPD ${Math.round(plane.speed)} KT`, FIELD.width - 24, 31, 24, PALETTE.litCyan, 'right');
    // The contract goal and the live message under the strip.
    const contract = { rings: 'RING RUN', airmail: 'AIRMAIL', storm: 'STORM RESCUE' }[state.contract];
    text(`${contract}  •  SCORE ${state.score}`, FIELD.width / 2, 66, 16, PALETTE.text, 'center');
    text('MERAPI AIRMAIL', FIELD.width - 24, 66, 15, PALETTE.muted, 'right');
    if (state.messageTime > 0 && state.message) {
      context.fillStyle = 'rgba(5, 8, 15, 0.6)';
      const w = context.measureText(state.message).width + 36;
      context.fillRect((FIELD.width - w) / 2, 78, w, 32);
      text(state.message, FIELD.width / 2, 100, 18, PALETTE.litAmber, 'center');
    }
    if (state.stalled) {
      text('⚠ STALL — NOSE DOWN', FIELD.width / 2, 140, 26, PALETTE.litRed, 'center');
    }
  }

  function drawSpeedStreaks(plane, time, screen) {
    // Chase depth cue: faint streaks at the screen edges when fast, so
    // speed reads as motion through air, not a number on the panel.
    if (screen !== SCREEN_PLAY) return;
    const speed = plane.speed || 0;
    if (speed < 80) return;
    const alpha = clamp((speed - 80) / 90, 0, 1) * 0.16;
    context.strokeStyle = `rgba(255, 240, 210, ${alpha})`;
    context.lineWidth = 2;
    context.beginPath();
    for (let i = 0; i < 14; i += 1) {
      const side = i % 2 === 0 ? 0 : 1;
      const x0 = side === 0
        ? ((i * 97 + time * 700) % 130)
        : FIELD.width - ((i * 89 + time * 700) % 130);
      const y = (i * 211 + time * 300) % FIELD.height;
      const len = 26 + (speed - 80) * 0.35;
      context.moveTo(x0, y);
      context.lineTo(x0 + (side === 0 ? -len * 0.25 : len * 0.25), y + len);
    }
    context.stroke();
    // A soft vignette for depth: darker corners, untouched centre.
    const vig = context.createRadialGradient(
      FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.42,
      FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.85,
    );
    vig.addColorStop(0, 'rgba(5, 8, 18, 0)');
    vig.addColorStop(1, 'rgba(5, 8, 18, 0.22)');
    context.fillStyle = vig;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
  }

  function drawRain(time) {
    context.strokeStyle = 'rgba(200, 220, 255, 0.4)';
    context.lineWidth = 1.5;
    context.beginPath();
    for (let i = 0; i < 90; i += 1) {
      const x = ((i * 137 + time * 420) % (FIELD.width + 60)) - 30;
      const y = ((i * 271 + time * 900) % (FIELD.height + 40)) - 20;
      context.moveTo(x, y);
      context.lineTo(x - 7, y + 26);
    }
    context.stroke();
  }

  function drawPanelScreen(title, lines, prompt, yShift, panelWidth) {
    const width = panelWidth || 640;
    const maxText = width - 48;
    // Word-wrap each line to the panel width so long lines never spill
    // past the panel edge (the title text did exactly that).
    const bodySize = 21;
    context.font = `${bodySize}px ${FONT}`;
    const wrapped = [];
    for (const line of lines) {
      const words = line.split(' ');
      let current = '';
      for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (context.measureText(test).width > maxText && current) {
          wrapped.push(current);
          current = word;
        } else {
          current = test;
        }
      }
      if (current) wrapped.push(current);
    }
    const height = 150 + wrapped.length * 34 + 70;
    const x = (FIELD.width - width) / 2;
    const y = (FIELD.height - height) / 2 + (yShift || 0);
    context.fillStyle = 'rgba(8, 12, 22, 0.97)';
    context.fillRect(x, y, width, height);
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.strokeRect(x, y, width, height);
    context.textBaseline = 'alphabetic';
    text(title, FIELD.width / 2, y + 72, 46, PALETTE.text, 'center');
    for (let index = 0; index < wrapped.length; index += 1) {
      text(wrapped[index], FIELD.width / 2, y + 128 + index * 34, 21, PALETTE.muted, 'center');
    }
    text(prompt, FIELD.width / 2, y + height - 36, 22, PALETTE.litAmber, 'center');
  }

  /** Paint one frame: the world, then the HUD or a panel for the screen the game is on. */
  function draw(state, screen, best, time, dt) {
    const plane = state.plane;
    const storm = state.contract === 'storm' && screen === SCREEN_PLAY;
    updateCamera(plane, dt || 0.016, screen);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#0b0e1a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    drawSky(plane, storm);
    drawSea(plane, time);
    drawClouds(plane, time);
    drawTerrain();
    drawCloudShadows(time);
    drawCrater();
    drawStrips();
    drawRings(state, time, screen !== SCREEN_TITLE);
    drawSmoke(time);
    drawLighthouse(time, storm);
    if (screen === SCREEN_TITLE) {
      // The plane sits parked on the home runway below the panel, so the
      // title screen finally shows an aircraft and a runway, not a menu
      // floating over empty sea.
      drawPlane(plane, time, false, { dy: 120 });
    } else {
      drawPlane(plane, time, screen === SCREEN_OVER);
    }
    drawSpeedStreaks(plane, time, screen);
    if (storm) drawRain(time);
    if (screen === SCREEN_TITLE) {
      drawPanelScreen('MERAPI AIRMAIL', [
        'A bush-plane mail run over a smoking volcano:',
        '8 rings, 3 island strips, one tank of fuel.',
        'Pick a contract —',
        '[1] RING RUN   [2] AIRMAIL   [3] STORM RESCUE',
        'Arrows / A S D W fly · Shift / Ctrl throttle',
        `Best score: ${best}`,
      ], 'Press 1, 2 or 3 — or Space for the Ring Run', -130, 560);
      return;
    }
    drawPanel(state, plane, best);
    drawHudTop(state, plane);
    if (screen === SCREEN_PAUSED) {
      drawPanelScreen('Paused', ['The volcano will wait for you.'], 'Press P to resume', -60);
    } else if (screen === SCREEN_OVER) {
      drawPanelScreen('Crashed', [
        state.crashReason || 'The plane came down.',
        `Score ${state.score}   •   Rings ${state.ringsPassed}/${state.ringsTotal}   •   Best ${best}`,
      ], 'Press Space to fly again', -60);
    } else if (screen === SCREEN_WIN) {
      const winText = {
        rings: ['Ring Run complete!', 'All 8 rings threaded — and the tank held out.'],
        airmail: ['Delivery complete!', 'The islands got their mail. The volcano is still smoking.'],
        storm: ['Rescue complete!', 'Through the squall to the lighthouse — the keeper sends thanks.'],
      }[state.contract];
      drawPanelScreen(winText[0], [
        `Score ${state.score}   •   Rings ${state.ringsPassed}/${state.ringsTotal}   •   Best ${best}`,
        winText[1],
      ], 'Press Space to fly again', -60);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, updateCamera };
}
