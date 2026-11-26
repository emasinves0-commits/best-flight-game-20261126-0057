// The flight model and the three contracts. No drawing and no browser here:
// the plane's position, speed, fuel and damage, the rings, the landings and
// the score. step() advances one fixed step and returns what happened as bit
// flags, so the caller can react without the world knowing about screens or
// sound.
import { CONTRACTS, PLANE, RINGS, STEP } from './config.js';

export const EVENT_RING = 1;
export const EVENT_LANDED = 2;
export const EVENT_DELIVERED = 4;
export const EVENT_CRASH = 8;
export const EVENT_WIN = 16;
export const EVENT_STALL = 32;
export const EVENT_LOW_FUEL = 64;

const DEG = Math.PI / 180;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function angleDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export function createFlight(terrain) {
  const home = terrain.strips[0];
  const plane = {
    x: home.x,
    y: 0,
    z: home.z + home.length / 2 - 20,
    heading: 0,
    pitch: 0,
    bank: 0,
    speed: 0,
    throttle: 0,
    fuel: PLANE.tank,
    damage: 0,
    onGround: true,
    verticalSpeed: 0,
  };
  const state = {
    plane,
    contract: 'rings',
    ringsPassed: 0,
    deliveries: 0,
    deliveredStrips: {},
    score: 0,
    elapsed: 0,
    timeLeft: 0,
    message: '',
    messageTime: 0,
    stalled: false,
    won: false,
    crashed: false,
    crashReason: '',
    nextRing: 0,
    ringsTotal: CONTRACTS.rings.rings,
  };

  function reset(contractKey) {
    const contract = CONTRACTS[contractKey] || CONTRACTS.rings;
    state.contract = contractKey;
    state.ringsTotal = contract.rings;
    state.timeLeft = contract.timeLimit || 0;
    plane.x = home.x;
    plane.z = home.z + home.length / 2 - 20;
    plane.y = terrain.heightAt(plane.x, plane.z) + 2;
    plane.heading = 0;
    plane.pitch = 0;
    plane.bank = 0;
    plane.speed = 0;
    plane.throttle = 0;
    plane.fuel = PLANE.tank;
    plane.damage = 0;
    plane.onGround = true;
    plane.verticalSpeed = 0;
    state.ringsPassed = 0;
    state.deliveries = 0;
    state.deliveredStrips = {};
    state.score = 0;
    state.elapsed = 0;
    state.message = contract.goal;
    state.messageTime = 5;
    state.stalled = false;
    state.won = false;
    state.crashed = false;
    state.crashReason = '';
    state.nextRing = 0;
    state.airborneFor = 0;
    // The storm run threads the eastern rings toward the lighthouse; the
    // other contracts thread the full route from the home field.
    state.ringOrder = contractKey === 'storm' ? [0, 1, 2, 7] : contractKey === 'airmail' ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6, 7];
    state.ringsTotal = state.ringOrder.length;
    for (const ring of terrain.rings) ring.passed = false;
  }

  function setMessage(text, seconds) {
    state.message = text;
    state.messageTime = seconds || 4;
  }

  function crash(reason) {
    if (state.crashed || state.won) return EVENT_CRASH;
    state.crashed = true;
    state.crashReason = reason;
    return EVENT_CRASH;
  }

  function win(reason) {
    if (state.won || state.crashed) return 0;
    state.won = true;
    const timeBonus = state.contract === 'rings' ? Math.max(0, 900 - Math.floor(state.elapsed)) : 0;
    const fuelBonus = Math.floor(plane.fuel) * 5;
    state.score += timeBonus + fuelBonus;
    setMessage(`${reason}  +${timeBonus + fuelBonus} bonus`, 8);
    return EVENT_WIN;
  }

  function nearestStrip() {
    let best = null;
    let bestD = Infinity;
    for (const strip of terrain.strips) {
      const dx = plane.x - strip.x;
      const dz = plane.z - strip.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestD) {
        bestD = d;
        best = strip;
      }
    }
    return { strip: best, distance: bestD };
  }

  function onStrip(strip) {
    const rad = (strip.heading * Math.PI) / 180;
    const fx = Math.sin(rad);
    const fz = -Math.cos(rad);
    const rx = Math.cos(rad);
    const rz = Math.sin(rad);
    const along = (plane.x - strip.x) * fx + (plane.z - strip.z) * fz;
    const across = (plane.x - strip.x) * rx + (plane.z - strip.z) * rz;
    return Math.abs(along) < strip.length / 2 && Math.abs(across) < strip.width / 2;
  }

  /**
   * One fixed step. `ctl` is { bank: -1..1, pitch: -1..1, throttle: -1..1,
   * brake: boolean }. With `harmless` set (the title screen's backdrop) the
   * plane flies itself in a gentle circuit and nothing scores or crashes.
   */
  function step(dt, ctl, harmless) {
    let events = 0;
    state.elapsed += dt;
    if (state.messageTime > 0) state.messageTime -= dt;
    if (state.won || state.crashed) return events;

    // --- throttle and speed: a heavy hand on the throttle burns fuel and
    // the turn bleeds speed, so the pilot has to manage both.
    plane.throttle = clamp(plane.throttle + ctl.throttle * dt * 0.9, 0, 1);
    const target = PLANE.minSpeed + plane.throttle * (PLANE.maxSpeed - PLANE.minSpeed);
    const turnBleed = Math.abs(plane.bank) * 0.055;
    plane.speed += clamp(target - plane.speed, -PLANE.drag * dt, PLANE.accel * dt);
    plane.speed -= turnBleed * plane.speed * dt * 0.03;
    if (ctl.brake) plane.speed = Math.max(0, plane.speed - 60 * dt);

    // --- attitude: the stick sets a bank and pitch to HOLD (first-order lag
    // toward the commanded angle), and the bank turns the heading.
    const targetBank = ctl.bank * PLANE.maxBank;
    plane.bank += (targetBank - plane.bank) * Math.min(1, 3.5 * dt);
    const targetPitch = ctl.pitch * PLANE.maxPitch;
    plane.pitch += (targetPitch - plane.pitch) * Math.min(1, 3.0 * dt);
    plane.heading = (plane.heading + plane.bank * 0.42 * dt * (0.4 + plane.speed / PLANE.maxSpeed) + 360) % 360;

    // --- stall: too slow with the nose up and the wing quits.
    const stalling = !plane.onGround && plane.speed < PLANE.stallSpeed && plane.pitch > 4;
    if (stalling && !state.stalled) {
      state.stalled = true;
      events |= EVENT_STALL;
      setMessage('STALL! Nose down, throttle up!', 3);
    } else if (!stalling) state.stalled = false;

    // --- motion.
    const hRad = plane.heading * DEG;
    const pRad = plane.pitch * DEG;
    const forward = plane.speed * 0.514;
    const climb = stalling ? -14 : Math.sin(pRad) * forward;
    plane.verticalSpeed = climb;
    plane.x += Math.sin(hRad) * Math.cos(pRad) * forward * dt;
    plane.z += -Math.cos(hRad) * Math.cos(pRad) * forward * dt;
    plane.y += climb * dt;
    if (plane.onGround) {
      plane.y = terrain.heightAt(plane.x, plane.z) + 2;
      if (plane.speed > 62 && plane.pitch > 6) plane.onGround = false;
    }

    // --- fuel: the tank is the mission clock.
    if (!plane.onGround || plane.throttle > 0.1) {
      plane.fuel -= PLANE.burnPerSecond * (0.35 + plane.throttle) * dt;
    }
    if (plane.fuel <= 20 && plane.fuel > 0 && Math.floor(state.elapsed * 2) !== Math.floor((state.elapsed - dt) * 2)) {
      events |= EVENT_LOW_FUEL;
    }
    if (plane.fuel <= 0) {
      plane.fuel = 0;
      plane.throttle = 0;
      if (plane.onGround) return crash('Out of fuel on the ground.');
      if (plane.y <= terrain.heightAt(plane.x, plane.z) + 2) return crash('Out of fuel.');
    }

    // --- storm contract: the clock and the gusts.
    if (state.contract === 'storm' && state.timeLeft > 0) {
      state.timeLeft -= dt;
      const gust = Math.sin(state.elapsed * 1.7) * 9 + Math.sin(state.elapsed * 3.1) * 5;
      plane.bank = clamp(plane.bank + gust * dt * 0.25, -PLANE.maxBank, PLANE.maxBank);
      if (state.timeLeft <= 0) return crash('The storm closed in — out of time.');
    }

    // --- rings: threading the next ring in order scores and refuels a little.
    const ring = terrain.rings[state.ringOrder[state.nextRing]];
    if (ring && !ring.passed && !harmless) {
      const dx = plane.x - ring.x;
      const dy = plane.y - ring.y;
      const dz = plane.z - ring.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < RINGS.radius) {
        ring.passed = true;
        state.ringsPassed += 1;
        state.nextRing += 1;
        state.score += RINGS.points;
        plane.fuel = Math.min(PLANE.tank, plane.fuel + PLANE.ringFuel);
        events |= EVENT_RING;
        setMessage(
          state.ringsPassed >= state.ringsTotal
            ? `All ${state.ringsTotal} rings! Now land at ${home.name}.`
            : `Ring ${state.ringsPassed} of ${state.ringsTotal}! +${RINGS.points}`,
          3,
        );
      }
    }

    // --- ground: a gentle touchdown on a strip is a landing; anything else
    // at speed is a crash, and a hard hit on rough ground is damage. The
    // plane must have been properly airborne first, so a liftoff bounce does
    // not count as a landing the instant the wheels leave the strip.
    const ground = terrain.heightAt(plane.x, plane.z);
    if (!plane.onGround) state.airborneFor += dt;
    if (!plane.onGround && state.airborneFor > 1.5 && plane.y <= ground + 1.2) {
      const near = nearestStrip();
      const strip = near.strip;
      const aligned = Math.abs(angleDiff(plane.heading, strip.heading)) < 40
        || Math.abs(angleDiff(plane.heading, (strip.heading + 180) % 360)) < 40;
      if (onStrip(strip) && aligned && Math.abs(plane.verticalSpeed) < 12 && plane.speed < 95) {
        plane.onGround = true;
        plane.y = ground + 2;
        plane.pitch = 0;
        plane.bank = 0;
        state.airborneFor = 0;
        events |= EVENT_LANDED;
        plane.fuel = PLANE.tank;
        if (state.contract === 'airmail' && (strip.id === 'palm' || strip.id === 'green') && !state.deliveredStrips[strip.id]) {
          state.deliveredStrips[strip.id] = true;
          state.deliveries += 1;
          state.score += 250;
          events |= EVENT_DELIVERED;
          setMessage(`Mail delivered at ${strip.name}! +250  (${state.deliveries} of 2)`, 4);
          if (state.deliveries >= 2) setMessage('All mail delivered! Land back at MERAPI FIELD.', 5);
        } else if (strip.id === 'home') {
          if (state.contract === 'rings' && state.ringsPassed >= state.ringsTotal) {
            return events | win('RING RUN COMPLETE!');
          }
          if (state.contract === 'airmail' && state.deliveries >= 2) {
            return events | win('AIRMAIL COMPLETE!');
          }
          setMessage(`Landed at ${strip.name}. Fuel topped up.`, 3);
        } else if (state.contract === 'storm' && strip.id === 'light') {
          return events | win('RESCUE COMPLETE!');
        } else {
          setMessage(`Landed at ${strip.name}. Fuel topped up.`, 3);
        }
      } else if (plane.y <= ground + 0.5) {
        // Rough ground or water.
        const impact = Math.abs(plane.verticalSpeed) + plane.speed * 0.35;
        if (ground <= 0.5) return crash('Ditched in the sea.');
        if (impact > 42 || plane.speed > 120) return crash('Crashed into the terrain.');
        plane.damage += impact;
        plane.y = ground + 2;
        plane.onGround = true;
        plane.pitch = 0;
        plane.bank = 0;
        state.airborneFor = 0;
        setMessage(`Rough landing! Damage ${Math.floor(plane.damage)}%.`, 3);
        if (plane.damage >= PLANE.crashDamage) return crash('Airframe gave out.');
      }
    }

    // --- the world edge: turn back, the islands are this way.
    if (Math.abs(plane.x) > WORLD_HALF || Math.abs(plane.z) > WORLD_HALF) {
      plane.x = clamp(plane.x, -WORLD_HALF, WORLD_HALF);
      plane.z = clamp(plane.z, -WORLD_HALF, WORLD_HALF);
      setMessage('Turn back — the islands are behind you.', 3);
    }
    return events;
  }

  const WORLD_HALF = 1750;

  reset('rings');
  return { state, plane, reset, step, setMessage, nearestStrip };
}
