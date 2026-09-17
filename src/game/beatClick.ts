let ctx: AudioContext | null = null;

/** Muteable soft metronome tick. Not a full audio system. */
export function playBeatClick(): void {
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
    g.gain.setValueAtTime(0.035, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);
    osc.start(t);
    osc.stop(t + 0.03);
  } catch {
    /* autoplay / missing Web Audio */
  }
}
