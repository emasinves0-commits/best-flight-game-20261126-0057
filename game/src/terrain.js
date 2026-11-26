// The archipelago: where the islands are, how high the ground is, where the
// runways lie and where the gold rings hang. Everything is seeded, so the same
// seed always builds the same islands. The heightfield is a GRID x GRID mesh
// over the world; heightAt(x, z) answers the ground height anywhere (the
// flight model uses it for crashes and landings).
import { GRID, WORLD } from './config.js';

// Island cones: x, z, radius, height. The volcano is the tall one in the
// north; the two green islands carry the airstrips; the rock holds the
// lighthouse; the stacks are thin stone needles in the sea.
const ISLANDS = [
  { x: -260, z: -1150, radius: 780, height: 265, kind: 'volcano' },
  { x: 1080, z: -420, radius: 430, height: 62, kind: 'green' },
  { x: -1150, z: -260, radius: 400, height: 48, kind: 'green' },
  { x: 150, z: 1180, radius: 520, height: 14, kind: 'home' },
  { x: 620, z: -980, radius: 90, height: 34, kind: 'rock' },
  { x: -700, z: -760, radius: 55, height: 88, kind: 'stack' },
  { x: -560, z: -880, radius: 42, height: 64, kind: 'stack' },
  { x: 330, z: -760, radius: 48, height: 74, kind: 'stack' },
];

// Airstrips: centre, heading (degrees, 0 = north), length, width. The home
// strip points north toward the volcano; Palm strip runs east-west; Green
// strip runs north-south; the lighthouse strip is short and on the rock.
export const STRIPS = [
  { id: 'home', name: 'MERAPI FIELD', x: 150, z: 1180, heading: 0, length: 340, width: 34 },
  { id: 'palm', name: 'PALM STRIP', x: -1150, z: -260, heading: 90, length: 260, width: 40 },
  { id: 'green', name: 'GREEN STRIP', x: 1080, z: -420, heading: 0, length: 280, width: 40 },
  { id: 'light', name: 'LIGHTHOUSE', x: 620, z: -980, heading: 45, length: 170, width: 30 },
];

// Ring route: positions the autopilot and the player thread in order. The
// route climbs the volcano's southern valley to the crater rim, swings west
// over the sea, then runs east along the south coast toward the green island
// — it never crosses the volcano's flank, so the rings stay threadable.
const RING_POINTS = [
  { x: 150, y: 70, z: 820 },
  { x: 60, y: 110, z: 380 },
  { x: -140, y: 170, z: -120 },
  { x: -260, y: 230, z: -560 },
  { x: -620, y: 170, z: -780 },
  { x: -950, y: 130, z: -1000 },
  { x: -700, y: 110, z: -300 },
  { x: 200, y: 100, z: -500 },
];

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function islandHeight(island, x, z) {
  const dx = x - island.x;
  const dz = z - island.z;
  const d = Math.sqrt(dx * dx + dz * dz) / island.radius;
  if (d >= 1) return 0;
  if (island.kind === 'volcano') {
    // A cone with a crater bowl at the top.
    const cone = (1 - d) * island.height;
    const crater = smoothstep(0.16, 0.05, d) * 55;
    return cone - crater;
  }
  if (island.kind === 'stack' || island.kind === 'rock') {
    return Math.pow(1 - d, 0.6) * island.height;
  }
  // Green islands and home: a soft dome with a flat top for the strip.
  return Math.pow(1 - d, 1.4) * island.height;
}

export function createTerrain(random) {
  const step = WORLD.size / GRID;
  const heights = new Float32Array((GRID + 1) * (GRID + 1));
  // A little seeded bumpiness so the ground is not a perfect cone.
  const bumps = [];
  for (let i = 0; i < 26; i += 1) {
    bumps.push({
      x: (random() * 2 - 1) * WORLD.half,
      z: (random() * 2 - 1) * WORLD.half,
      radius: 180 + random() * 320,
      height: (random() * 2 - 1) * 9,
    });
  }

  function groundHeight(x, z) {
    let h = 0;
    for (const island of ISLANDS) h += islandHeight(island, x, z);
    for (const bump of bumps) {
      const dx = x - bump.x;
      const dz = z - bump.z;
      const d = Math.sqrt(dx * dx + dz * dz) / bump.radius;
      if (d < 1) h += (1 - d) * bump.height;
    }
    return h;
  }

  for (let gz = 0; gz <= GRID; gz += 1) {
    for (let gx = 0; gx <= GRID; gx += 1) {
      const x = -WORLD.half + gx * step;
      const z = -WORLD.half + gz * step;
      heights[gz * (GRID + 1) + gx] = groundHeight(x, z);
    }
  }

  // Flatten the ground under each airstrip so the runway sits on level land.
  for (const strip of STRIPS) {
    const rad = (strip.heading * Math.PI) / 180;
    const fx = Math.sin(rad);
    const fz = -Math.cos(rad);
    const rx = Math.cos(rad);
    const rz = Math.sin(rad);
    for (let gz = 0; gz <= GRID; gz += 1) {
      for (let gx = 0; gx <= GRID; gx += 1) {
        const x = -WORLD.half + gx * step;
        const z = -WORLD.half + gz * step;
        const along = (x - strip.x) * fx + (z - strip.z) * fz;
        const across = (x - strip.x) * rx + (z - strip.z) * rz;
        if (Math.abs(along) < strip.length / 2 + 60 && Math.abs(across) < strip.width / 2 + 60) {
          const idx = gz * (GRID + 1) + gx;
          const target = groundHeight(strip.x, strip.z);
          const blend = smoothstep(1, 0.35, Math.max(Math.abs(along) / (strip.length / 2 + 60), Math.abs(across) / (strip.width / 2 + 60)));
          heights[idx] = heights[idx] * (1 - blend) + target * blend;
        }
      }
    }
  }

  const rings = RING_POINTS.map((point, index) => ({
    index,
    x: point.x,
    y: point.y,
    z: point.z,
    passed: false,
  }));

  // Clouds drift slowly above the islands.
  const clouds = [];
  for (let i = 0; i < 14; i += 1) {
    clouds.push({
      x: (random() * 2 - 1) * WORLD.half * 0.9,
      y: 200 + random() * 120,
      z: (random() * 2 - 1) * WORLD.half * 0.9,
      size: 90 + random() * 160,
      speed: 2 + random() * 3,
    });
  }

  // The volcano's smoke plume: soft puffs rising from the crater.
  const smoke = [];
  for (let i = 0; i < 10; i += 1) {
    smoke.push({ phase: i / 10, size: 26 + i * 7 });
  }

  function heightAt(x, z) {
    // Bilinear sample of the mesh so the flight model feels the same ground
    // the renderer draws.
    const gx = Math.min(GRID - 0.001, Math.max(0, (x + WORLD.half) / step));
    const gz = Math.min(GRID - 0.001, Math.max(0, (z + WORLD.half) / step));
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const fx = gx - x0;
    const fz = gz - z0;
    const i00 = heights[z0 * (GRID + 1) + x0];
    const i10 = heights[z0 * (GRID + 1) + x0 + 1];
    const i01 = heights[(z0 + 1) * (GRID + 1) + x0];
    const i11 = heights[(z0 + 1) * (GRID + 1) + x0 + 1];
    return (i00 * (1 - fx) + i10 * fx) * (1 - fz) + (i01 * (1 - fx) + i11 * fx) * fz;
  }

  return { heights, step, rings, clouds, smoke, heightAt, strips: STRIPS };
}
