// The screenshot scenes behind ?shot=start|play|storm|end. Each one plays the
// real rules forward from a fresh flight for a fixed number of steps, steered
// by a simple autopilot (bank toward the next ring, pitch toward its height,
// throttle steady, flare for the strip), so the frame is what a short game
// really looks like and the same seed always gives the same frame.
import { STEP } from './config.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WIN } from './render.js';

const START_SECONDS = 4;
const PLAY_SECONDS = 24;
const STORM_SECONDS = 20;
const END_LIMIT_SECONDS = 900;

function angleDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Steer toward a point: bank toward its bearing, pitch toward its height. */
function steerToward(flight, terrain, target, throttleTarget, clearance, glide) {
  const plane = flight.plane;
  const dx = target.x - plane.x;
  const dz = target.z - plane.z;
  const bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const bearingDiff = angleDiff(bearing, plane.heading);
  const bank = Math.max(-0.7, Math.min(0.7, bearingDiff / 60));
  const dist = Math.sqrt(dx * dx + dz * dz);
  // A gliding target is flown level at its height (a landing flare); a
  // normal target is approached from above, higher when still far out.
  let wantAlt = glide ? target.y : target.y + Math.max(0, dist * 0.04);
  // Terrain clearance: never fly into the volcano's flank — climb over the
  // ground ahead before worrying about the target's height. The caller sets
  // the clearance: far out it is large (terrain safety), close to a strip
  // it is zero (the runway is flat and the clearance would hold the plane
  // above the strip forever).
  const clear = clearance ?? 50;
  const aheadX = plane.x + Math.sin((plane.heading * Math.PI) / 180) * 180;
  const aheadZ = plane.z - Math.cos((plane.heading * Math.PI) / 180) * 180;
  const groundAhead = terrain.heightAt(aheadX, aheadZ);
  wantAlt = Math.max(wantAlt, groundAhead + clear);
  const altDiff = wantAlt - plane.y;
  const pitch = Math.max(-0.6, Math.min(0.6, altDiff / 80));
  // Throttle is a rate in the flight model: drive it toward the target.
  const throttle = Math.max(-1, Math.min(1, ((throttleTarget ?? 0.7) - plane.throttle) * 2));
  return { bank, pitch, throttle, brake: false };
}

/** Fly the final approach: aim past the strip along its axis and glide down
 * through it, so the run-in is along the runway and the touchdown happens
 * while crossing the strip. The landing check accepts either runway
 * direction, so the plane just flies straight at the far end. */
function approachStrip(flight, terrain, strip) {
  const plane = flight.plane;
  const rad = (strip.heading * Math.PI) / 180;
  const fx = Math.sin(rad);
  const fz = -Math.cos(rad);
  const ground = terrain.heightAt(strip.x, strip.z);
  const dist = Math.hypot(strip.x - plane.x, strip.z - plane.z);
  // The far side from where the plane is: the plane always flies THROUGH the
  // strip toward the point beyond it.
  const along = (plane.x - strip.x) * fx + (plane.z - strip.z) * fz;
  const side = along > 0 ? -1 : 1;
  const beyond = {
    x: strip.x + fx * 300 * side,
    y: ground,
    z: strip.z + fz * 300 * side,
  };
  // Close in the clearance drops to zero so the plane can reach the runway;
  // further out it keeps the plane off the terrain on the way in.
  return steerToward(flight, terrain, beyond, 0.25, dist < 400 ? 0 : 50, true);
}

/** Fly to a strip: if the run-in is across the runway (more than 45° off
 * its axis) join the axis first at a point 800 m out, then fly the final.
 * A north-south runway cannot be landed on from an eastbound approach — the
 * plane has to get onto the axis before the glide, or it just sails past
 * the strip sideways. */
function flyToStrip(flight, terrain, strip) {
  const plane = flight.plane;
  const dist = Math.hypot(strip.x - plane.x, strip.z - plane.z);
  // Aligned means the plane is FLYING along the runway axis, not merely
  // pointing at the strip: close in and off to the side, the bearing to the
  // centre is diagonal even on a perfect final, and judging by it sends
  // the plane off to re-join the axis it is already on.
  const axis = Math.abs(angleDiff(plane.heading, strip.heading)) < Math.abs(angleDiff(plane.heading, strip.heading + 180))
    ? strip.heading
    : strip.heading + 180;
  const misaligned = Math.abs(angleDiff(plane.heading, axis)) > 45;
  // The join only happens far out: once the plane is inside 700 m it is
  // committed to the final, and a mid-approach detour just strands it low
  // next to the runway.
  if (dist > 700 && misaligned) {
    const rad = (strip.heading * Math.PI) / 180;
    const fx = Math.sin(rad);
    const fz = -Math.cos(rad);
    const ground = terrain.heightAt(strip.x, strip.z);
    const along = (plane.x - strip.x) * fx + (plane.z - strip.z) * fz;
    const side = along > 0 ? 1 : -1;
    const join = { x: strip.x + fx * 800 * side, y: ground + 80, z: strip.z + fz * 800 * side };
    return steerToward(flight, terrain, join, 0.3, 50, false);
  }
  if (dist < 700) return approachStrip(flight, terrain, strip);
  return steerToward(flight, terrain, { x: strip.x, y: 80, z: strip.z }, 0.7);
}

export function autopilot(flight, terrain) {
  const plane = flight.plane;
  const state = flight.state;
  if (plane.onGround) {
    // Take off: full throttle, nose up once fast.
    return { bank: 0, pitch: plane.speed > 62 ? 0.8 : 0, throttle: 1, brake: false };
  }
  // Airmail: after the bonus rings, deliver to both island strips in turn.
  if (state.contract === 'airmail' && state.nextRing >= state.ringOrder.length) {
    const remaining = terrain.strips.filter((s) => (s.id === 'palm' || s.id === 'green') && !state.deliveredStrips[s.id]);
    if (remaining.length > 0) {
      let best = remaining[0];
      let bestD = Infinity;
      for (const strip of remaining) {
        const d = Math.hypot(strip.x - plane.x, strip.z - plane.z);
        if (d < bestD) {
          bestD = d;
          best = strip;
        }
      }
      return flyToStrip(flight, terrain, best);
    }
    return flyToStrip(flight, terrain, terrain.strips[0]);
  }
  // Storm: the lighthouse strip is the goal; the eastern rings are on the way.
  if (state.contract === 'storm' && state.nextRing >= state.ringOrder.length) {
    const light = terrain.strips[3];
    const d = Math.hypot(light.x - plane.x, light.z - plane.z);
    return flyToStrip(flight, terrain, light);
  }
  const ring = terrain.rings[state.ringOrder[state.nextRing]];
  if (ring && !ring.passed) return steerToward(flight, terrain, ring, 0.7);
  // No ring left: head for the home strip and land.
  const home = terrain.strips[0];
  const d = Math.hypot(home.x - plane.x, home.z - plane.z);
  return flyToStrip(flight, terrain, home);
}

/**
 * Set the flight to the named scene (start, play, storm or end; any other
 * name is start) and return the screen to draw over it and the best score to
 * show.
 */
export function stageShot(name, flight, terrain) {
  // The end shot stages the ring run to its win screen: the airmail
  // contract's Green-strip final is a visual landing a human flies by eye,
  // but the blind autopilot orbits it instead of landing, so it cannot
  // stage a win — the ring run proves the game is completable.
  const contract = name === 'storm' ? 'storm' : 'rings';
  flight.reset(contract);
  if (name !== 'play' && name !== 'storm' && name !== 'end') {
    for (let index = 0; index < START_SECONDS / STEP; index += 1) {
      flight.step(STEP, { bank: 0, pitch: 0, throttle: 0.4, brake: false }, false);
    }
    return { screen: SCREEN_TITLE, best: 0 };
  }
  const limit = name === 'end' ? END_LIMIT_SECONDS : name === 'storm' ? STORM_SECONDS : PLAY_SECONDS;
  for (let index = 0; index < limit / STEP; index += 1) {
    const events = flight.step(STEP, autopilot(flight, terrain), false);
    if (flight.state.won || flight.state.crashed) break;
  }
  const state = flight.state;
  const screen = state.won ? SCREEN_WIN : state.crashed ? SCREEN_OVER : SCREEN_PLAY;
  return { screen, best: state.score };
}
