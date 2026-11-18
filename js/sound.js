// Optional Web Audio effects. Only a user gesture creates/resumes the context.

let context = null;
let output = null;
let enabled = true;
const oscillators = new Set();

const SONGS = {
  tap: [[1800, 0.03]],
  ok: [[1500, 0.05], [2000, 0.06]],
  no: [[400, 0.12]],
  call: [[2200, 0.08], [0, 0.05], [2200, 0.08], [0, 0.05], [2200, 0.08]],
  hit: [[900, 0.04], [500, 0.06]],
  win: [[1300, 0.08], [1600, 0.08], [2000, 0.16]],
  lose: [[800, 0.12], [600, 0.12], [400, 0.2]],
  evolve: [[1000, 0.1], [1200, 0.1], [1500, 0.1], [2000, 0.3]],
  // Original synthesized UI cues, not a sampled theme or soundtrack.
  evolveCharge: [[220, 0.12], [330, 0.12], [440, 0.18]],
  hatchCharge: [[440, 0.1], [660, 0.16]],
  evolveScan: [[880, 0.05], [0, 0.04], [990, 0.05]],
  evolveMorph: [[330, 0.09], [495, 0.09], [660, 0.16]],
  evolveReveal: [[660, 0.12], [880, 0.12], [1320, 0.2]],
  evolveCelebrate: [[880, 0.08], [1100, 0.08], [1320, 0.18]],
  pet: [[660, 0.06], [880, 0.1]],
  pet1: [[740, 0.08]],
  pet2: [[880, 0.08]],
  pet3: [[990, 0.08], [1320, 0.12]],
};

export function setSoundEnabled(on) {
  enabled = Boolean(on);
  if (output) output.gain.value = enabled ? 0.05 : 0;
  if (!enabled) {
    // Stop scheduled notes too, rather than letting them play after re-enabling.
    for (const oscillator of oscillators) {
      try { oscillator.stop(); } catch { /* Already stopped. */ }
      try { oscillator.disconnect(); } catch { /* Audio may be unavailable. */ }
    }
    oscillators.clear();
    try { globalThis.navigator?.vibrate?.(0); } catch { /* Optional feature. */ }
  }
}

export function unlockAudio() {
  if (!enabled) return;
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContext) return;
  try {
    if (!context || context.state === 'closed') {
      context = new AudioContext();
      output = context.createGain();
      output.gain.value = 0.05;
      output.connect(context.destination);
    }
    if (context.state === 'suspended') {
      // Some browsers reject resume even when AudioContext exists.
      const resumed = context.resume();
      resumed?.catch?.(() => {});
    }
  } catch {
    context = null;
    output = null;
  }
}

function tone(frequency, delay, duration) {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  const start = context.currentTime + delay;
  oscillator.type = 'square';
  oscillator.frequency.value = frequency;
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(1, start + 0.003);
  envelope.gain.setValueAtTime(1, start + Math.max(0.003, duration - 0.005));
  envelope.gain.linearRampToValueAtTime(0, start + duration);
  oscillator.connect(envelope);
  envelope.connect(output);
  oscillators.add(oscillator);
  oscillator.onended = () => {
    oscillators.delete(oscillator);
    try {
      oscillator.disconnect();
      envelope.disconnect();
    } catch { /* Context may have closed. */ }
  };
  oscillator.start(start);
  oscillator.stop(start + duration);
  return oscillator;
}

/** Returns an idempotent stop function so abandoned scenes cannot leave notes playing. */
export function play(name) {
  const notes = [];
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const oscillator of notes) {
      if (!oscillators.delete(oscillator)) continue;
      try { oscillator.stop(); } catch { /* Already stopped. */ }
      try { oscillator.disconnect(); } catch { /* Optional audio. */ }
    }
  };
  if (!enabled || !context || !output || context.state === 'suspended' || context.state === 'closed') return stop;
  try {
    let delay = 0;
    for (const [frequency, duration] of SONGS[name] || []) {
      if (frequency) notes.push(tone(frequency, delay, duration));
      delay += duration;
    }
  } catch {
    // Sound must never prevent a care action or interrupt the animation loop.
    stop();
  }
  return stop;
}

export function vibrate(pattern = 30) {
  if (!enabled) return;
  try { globalThis.navigator?.vibrate?.(pattern); } catch { /* Optional feature. */ }
}
