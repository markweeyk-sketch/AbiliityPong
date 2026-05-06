// Web Audio API sound engine — no external files
const Audio = (() => {
  let ctx = null;
  let muted = false;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, type, gainVal, duration, fadeStart) {
    if (muted) return;
    const ac = getCtx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    gain.gain.setValueAtTime(gainVal, ac.currentTime);
    if (fadeStart !== undefined) {
      gain.gain.setValueAtTime(gainVal, ac.currentTime + fadeStart);
      gain.gain.linearRampToValueAtTime(0, ac.currentTime + duration);
    }
    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + duration);
  }

  function noise(duration, gainVal) {
    if (muted) return;
    const ac = getCtx();
    const bufSize = ac.sampleRate * duration;
    const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(gainVal, ac.currentTime);
    gain.gain.linearRampToValueAtTime(0, ac.currentTime + duration);
    src.connect(gain);
    gain.connect(ac.destination);
    src.start();
  }

  return {
    paddleHit() {
      tone(320, 'square', 0.18, 0.08, 0.02);
      tone(640, 'sine', 0.08, 0.06, 0.01);
    },
    wallBounce() {
      tone(180, 'square', 0.12, 0.06, 0.01);
    },
    score() {
      tone(440, 'sine', 0.2, 0.1, 0.05);
      setTimeout(() => tone(660, 'sine', 0.2, 0.12, 0.06), 120);
      setTimeout(() => tone(880, 'sine', 0.18, 0.18, 0.08), 250);
    },
    abilityActivate(color) {
      tone(880, 'sawtooth', 0.12, 0.05);
      setTimeout(() => tone(1100, 'sine', 0.15, 0.12, 0.04), 60);
      noise(0.08, 0.04);
    },
    win() {
      [523, 659, 784, 1047].forEach((f, i) =>
        setTimeout(() => tone(f, 'sine', 0.2, 0.25, 0.1), i * 130)
      );
    },
    lose() {
      [400, 320, 220, 160].forEach((f, i) =>
        setTimeout(() => tone(f, 'sawtooth', 0.15, 0.2, 0.1), i * 110)
      );
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    isMuted() { return muted; },
  };
})();
