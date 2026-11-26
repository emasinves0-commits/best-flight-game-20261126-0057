// Sound, synthesized with WebAudio — no audio files, nothing over the
// network. The engine hum follows the throttle, a chime marks each ring, a
// thud marks a landing and a beep warns of a stall or low fuel. Everything
// is guarded: in a headless screenshot run there is no gesture and no audio,
// and the game must not care.
export function createAudio() {
  let context = null;
  let engineOsc = null;
  let engineGain = null;
  let muted = false;

  function ensure() {
    if (context) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      engineOsc = context.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(filter);
      filter.connect(engineGain);
      engineGain.connect(context.destination);
      engineOsc.start();
      return true;
    } catch {
      return false;
    }
  }

  function unlock() {
    if (ensure() && context.state === 'suspended') context.resume().catch(() => {});
  }

  function blip(frequency, duration, type, volume) {
    if (!ensure() || muted) return;
    try {
      const osc = context.createOscillator();
      osc.type = type || 'sine';
      osc.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.setValueAtTime(volume || 0.12, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start();
      osc.stop(context.currentTime + duration);
    } catch {
      // Silence is always acceptable.
    }
  }

  return {
    unlock,
    toggleMute() {
      muted = !muted;
      if (engineGain) engineGain.gain.value = 0;
      return muted;
    },
    /** Called every frame: the hum follows throttle and speed. */
    engine(throttle, speed, running) {
      if (!ensure() || muted || !running) {
        if (engineGain) engineGain.gain.value = 0;
        return;
      }
      try {
        engineOsc.frequency.value = 48 + throttle * 55 + speed * 0.12;
        engineGain.gain.value = 0.02 + throttle * 0.035;
      } catch {
        // Silence is always acceptable.
      }
    },
    ring() {
      blip(880, 0.18, 'sine', 0.14);
      setTimeout(() => blip(1318, 0.3, 'sine', 0.12), 90);
    },
    land() {
      blip(120, 0.25, 'triangle', 0.2);
    },
    crash() {
      blip(70, 0.6, 'sawtooth', 0.18);
    },
    warn() {
      blip(1180, 0.12, 'square', 0.07);
    },
  };
}
