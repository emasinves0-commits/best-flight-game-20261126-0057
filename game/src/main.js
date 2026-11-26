// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s steps
// (several in a slow frame, none in a fast one), and the renderer paints what is there. The game
// moves between five screens: title, play, paused, game over and win.
//
// ?seed=N fixes the islands and the ring route. ?shot=start|play|storm|end (with &seed=N) stages
// that scene instead of running the loop, paints it twice and sets window.__shotReady.
import { BEST_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createTerrain } from './terrain.js';
import { createFlight, EVENT_CRASH, EVENT_LANDED, EVENT_LOW_FUEL, EVENT_RING, EVENT_STALL, EVENT_WIN } from './flight.js';
import { ACTION_CONFIRM, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WIN } from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const terrain = createTerrain(createRandom(seed));
const flight = createFlight(terrain);
const renderer = createRenderer(canvas, terrain);
const audio = createAudio();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, flight, terrain);
  let painted = 0;
  let time = 0;
  function paint() {
    renderer.draw(flight.state, scene.screen, scene.best, time, 0.016);
    painted += 1;
    time += 0.016;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let time = 0;

  // Screen readers (and anyone watching the page's text) hear the screen changes and each event.
  function announce(message) {
    status.textContent = message;
  }

  function startGame(contractKey) {
    flight.reset(contractKey);
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce(`Flying ${contractKey}. ${flight.state.message}`);
  }

  function endGame(won) {
    screen = won ? SCREEN_WIN : SCREEN_OVER;
    if (flight.state.score > best) {
      best = flight.state.score;
      saveBest(best);
    }
    announce(won ? `Delivery complete. Score ${flight.state.score}.` : `Crashed. Score ${flight.state.score}.`);
  }

  function handleActions() {
    const actions = input.takeActions();
    const contract = input.takeContract();
    if (contract && screen === SCREEN_TITLE) {
      startGame(contract === '1' ? 'rings' : contract === '2' ? 'airmail' : 'storm');
      return;
    }
    if (actions & ACTION_CONFIRM && screen === SCREEN_TITLE) startGame('rings');
    else if (actions & ACTION_CONFIRM && (screen === SCREEN_OVER || screen === SCREEN_WIN)) startGame(flight.state.contract);
    else if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
      announce('Flying.');
    }
    if (actions & ACTION_RESTART && screen === SCREEN_PLAY) startGame(flight.state.contract);
  }

  function step() {
    if (screen === SCREEN_TITLE) return;
    const events = flight.step(STEP, input.control(), false);
    audio.engine(flight.plane.throttle, flight.plane.speed, screen === SCREEN_PLAY);
    if (events & EVENT_RING) {
      audio.ring();
      announce(`Ring ${flight.state.ringsPassed} of ${flight.state.ringsTotal}. Score ${flight.state.score}.`);
    } else if (events & EVENT_LANDED) audio.land();
    else if (events & EVENT_CRASH) {
      audio.crash();
      endGame(false);
    } else if (events & EVENT_WIN) endGame(true);
    else if (events & EVENT_STALL) audio.warn();
    else if (events & EVENT_LOW_FUEL) audio.warn();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    time += Math.min((now - last) / 1000, MAX_FRAME);
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(flight.state, screen, best, time, 0.016);
  }

  // Leaving the tab pauses a running game rather than letting fuel burn unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });
  document.addEventListener('pointerdown', () => audio.unlock(), { once: true });
  document.addEventListener('keydown', () => audio.unlock(), { once: true });

  announce('Merapi Airmail. Press 1, 2 or 3 to pick a contract, or Space to fly the Ring Run.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
