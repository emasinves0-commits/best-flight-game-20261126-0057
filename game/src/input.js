// Keyboard and pointer input. Held keys give bank, pitch and throttle; the
// mouse steers too (move it and the plane follows); one-shot presses (start,
// pause, contract pick) are queued as bit flags and taken once by the loop,
// so a press between two frames is never lost and never counted twice.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_RESTART = 4;

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const PITCH_UP = new Set(['ArrowDown', 'KeyS']);
const PITCH_DOWN = new Set(['ArrowUp', 'KeyW']);
const THROTTLE_UP = new Set(['ShiftLeft', 'ShiftRight', 'Equal']);
const THROTTLE_DOWN = new Set(['ControlLeft', 'ControlRight', 'Minus']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const RESTART = new Set(['KeyR']);
const BRAKE = new Set(['KeyB']);

export function createInput(target) {
  let left = false;
  let right = false;
  let pitchUp = false;
  let pitchDown = false;
  let throttleUp = false;
  let throttleDown = false;
  let brake = false;
  let actions = 0;
  let mouseX = 0;
  let mouseY = 0;
  let mouseActive = false;
  let contractKey = null;

  window.addEventListener('keydown', (event) => {
    if (LEFT.has(event.code)) left = true;
    else if (RIGHT.has(event.code)) right = true;
    else if (PITCH_UP.has(event.code)) pitchUp = true;
    else if (PITCH_DOWN.has(event.code)) pitchDown = true;
    else if (THROTTLE_UP.has(event.code)) throttleUp = true;
    else if (THROTTLE_DOWN.has(event.code)) throttleDown = true;
    else if (BRAKE.has(event.code)) brake = true;
    else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (RESTART.has(event.code)) {
      if (!event.repeat) actions |= ACTION_RESTART;
    } else if (event.code === 'Digit1' || event.code === 'Digit2' || event.code === 'Digit3') {
      if (!event.repeat) contractKey = event.code.slice(-1);
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (LEFT.has(event.code)) left = false;
    else if (RIGHT.has(event.code)) right = false;
    else if (PITCH_UP.has(event.code)) pitchUp = false;
    else if (PITCH_DOWN.has(event.code)) pitchDown = false;
    else if (THROTTLE_UP.has(event.code)) throttleUp = false;
    else if (THROTTLE_DOWN.has(event.code)) throttleDown = false;
    else if (BRAKE.has(event.code)) brake = false;
  });
  // A key released while the tab is hidden never sends keyup: let go of
  // everything on blur.
  window.addEventListener('blur', () => {
    left = false;
    right = false;
    pitchUp = false;
    pitchDown = false;
    throttleUp = false;
    throttleDown = false;
    brake = false;
    mouseActive = false;
  });
  target.addEventListener('pointerdown', () => {
    actions |= ACTION_CONFIRM;
  });
  target.addEventListener('pointermove', (event) => {
    const rect = target.getBoundingClientRect();
    mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    mouseActive = true;
  });

  return {
    /** Bank -1..1 and pitch -1..1 from keys, or the mouse when it moved. */
    control() {
      let bank = (right ? 1 : 0) - (left ? 1 : 0);
      let pitch = (pitchUp ? 1 : 0) - (pitchDown ? 1 : 0);
      if (bank === 0 && pitch === 0 && mouseActive) {
        bank = Math.max(-1, Math.min(1, mouseX * 1.4));
        pitch = Math.max(-1, Math.min(1, mouseY * 1.2));
      }
      const throttle = (throttleUp ? 1 : 0) - (throttleDown ? 1 : 0);
      return { bank, pitch, throttle, brake };
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** A 1/2/3 contract pick since the last call, or null. */
    takeContract() {
      const taken = contractKey;
      contractKey = null;
      return taken;
    },
  };
}
