let ctx: AudioContext | null = null;

const CLICK_GAIN = 0.035;

/** Muteable soft metronome tick. Not a full audio system. */
export function playBeatClick(intensity = 0): void {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 660;
    osc.connect(g);
    g.connect(ctx.destination);
    const t = ctx.currentTime;
    const i = Math.min(1, Math.max(0, intensity));
    const level = CLICK_GAIN * (1 + i);
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);
    osc.start(t);
    osc.stop(t + 0.03);
  } catch {
    /* autoplay / missing Web Audio */
  }
}
