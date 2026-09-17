import type { SfxCue } from "../types.ts";

const MUSIC_GAIN = 0.42;
const MUSIC_FADE_SEC = 0.28;
const MUSIC_FADE_IN_SEC = 0.08;

const SFX_GAIN: Record<SfxCue, number> = {
  nick: 0.82,
  clean: 0.68,
  tension: 0.4,
  death: 0.88,
  clear: 0.72,
};

const FILES: Record<"loop" | SfxCue, string> = {
  loop: "loop.mp3",
  nick: "nick.mp3",
  clean: "clean.mp3",
  tension: "tension.mp3",
  death: "death.mp3",
  clear: "clear.mp3",
};

type GainLike = {
  gain: {
    value: number;
    setValueAtTime(value: number, startTime: number): void;
    linearRampToValueAtTime(value: number, endTime: number): void;
    cancelScheduledValues(startTime: number): void;
  };
  connect(dest: unknown): void;
};

type SourceLike = {
  buffer: unknown;
  loop: boolean;
  connect(dest: unknown): void;
  start(when?: number): void;
  stop(when?: number): void;
};

/** Minimal AudioContext surface so tests can inject a fake. */
export type AudioContextLike = {
  state: string;
  currentTime: number;
  destination: unknown;
  createGain(): GainLike;
  createBufferSource(): SourceLike;
  resume(): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
};

export type AudioBedOptions = {
  fetch?: typeof fetch;
  context?: AudioContextLike;
  createContext?: () => AudioContextLike | null;
  baseUrl?: string;
};

export type AudioBed = {
  unlock(): void;
  enterRun(): void;
  leaveRun(): void;
  play(cue: SfxCue): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
};

function defaultCreateContext(): AudioContextLike | null {
  const g = globalThis as typeof globalThis & {
    AudioContext?: { new (): AudioContext };
    webkitAudioContext?: { new (): AudioContext };
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) return null;
  return new Ctor() as unknown as AudioContextLike;
}

function joinUrl(base: string, file: string): string {
  const trimmed = base.endsWith("/") ? base : `${base}/`;
  return `${trimmed}audio/${file}`;
}

/**
 * Lazy Web Audio bed: one loop + one-shots. Missing files stay silent.
 * Mute is applied here; persistence lives in `thread.v1` settings.
 */
export function createAudioBed(opts: AudioBedOptions = {}): AudioBed {
  const fetchFn = opts.fetch ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  const baseUrl = opts.baseUrl ?? (typeof import.meta.env.BASE_URL === "string" ? import.meta.env.BASE_URL : "/");

  let ctx: AudioContextLike | null = opts.context ?? null;
  let master: GainLike | null = null;
  let musicGain: GainLike | null = null;
  let sfxGain: GainLike | null = null;
  let muted = false;
  let wantedPlaying = false;
  let musicSource: SourceLike | null = null;
  let fadingOut = false;
  let stopGen = 0;
  let loadPromise: Promise<void> | null = null;
  let booting = false;
  const buffers: Partial<Record<keyof typeof FILES, unknown>> = {};

  function ensureGraph(): AudioContextLike | null {
    if (!ctx) {
      ctx = opts.context ?? (opts.createContext ? opts.createContext() : defaultCreateContext());
    }
    if (!ctx) return null;
    if (!master) {
      master = ctx.createGain();
      musicGain = ctx.createGain();
      sfxGain = ctx.createGain();
      musicGain.gain.value = MUSIC_GAIN;
      sfxGain.gain.value = 1;
      master.gain.value = muted ? 0 : 1;
      musicGain.connect(master);
      sfxGain.connect(master);
      master.connect(ctx.destination);
    }
    return ctx;
  }

  function applyMute(): void {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(muted ? 0.0001 : 1, now + 0.04);
  }

  async function loadAll(ac: AudioContextLike): Promise<void> {
    if (!fetchFn) return;
    const jobs = (Object.keys(FILES) as (keyof typeof FILES)[]).map(async (id) => {
      try {
        const res = await fetchFn(joinUrl(baseUrl, FILES[id]));
        if (!res.ok) return;
        const data = await res.arrayBuffer();
        buffers[id] = await ac.decodeAudioData(data.slice(0));
      } catch {
        // Fail open: this cue stays silent.
      }
    });
    await Promise.all(jobs);
  }

  function boot(): Promise<void> {
    const ac = ensureGraph();
    if (!ac) return Promise.resolve();
    if (!loadPromise) loadPromise = loadAll(ac);
    if (booting) return loadPromise;
    booting = true;
    return loadPromise.then(() => {
      booting = false;
      if (wantedPlaying) startMusic();
    });
  }

  function startMusic(): void {
    const ac = ctx;
    if (!wantedPlaying || !ac || !musicGain || !buffers.loop) return;
    if (ac.state !== "running") return;
    if (musicSource) return;
    const src = ac.createBufferSource();
    src.buffer = buffers.loop;
    src.loop = true;
    src.connect(musicGain);
    const now = ac.currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(0.0001, now);
    musicGain.gain.linearRampToValueAtTime(MUSIC_GAIN, now + MUSIC_FADE_IN_SEC);
    try {
      src.start();
    } catch {
      return;
    }
    musicSource = src;
    fadingOut = false;
  }

  function fadeStopMusic(): void {
    const ac = ctx;
    if (!ac || !musicGain || !musicSource || fadingOut) return;
    fadingOut = true;
    const src = musicSource;
    const gen = ++stopGen;
    const now = ac.currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(Math.max(musicGain.gain.value, 0.0001), now);
    musicGain.gain.linearRampToValueAtTime(0.0001, now + MUSIC_FADE_SEC);
    const delayMs = Math.ceil(MUSIC_FADE_SEC * 1000) + 20;
    const later = typeof window !== "undefined" ? window.setTimeout.bind(window) : setTimeout;
    later(() => {
      if (gen !== stopGen) return;
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      if (musicSource === src) musicSource = null;
      fadingOut = false;
    }, delayMs);
  }

  return {
    unlock(): void {
      const ac = ensureGraph();
      if (!ac) return;
      void ac.resume().then(() => {
        if (wantedPlaying) void boot();
      });
    },
    enterRun(): void {
      wantedPlaying = true;
      if (musicSource && ctx && musicGain) {
        if (fadingOut) {
          stopGen += 1;
          fadingOut = false;
          const now = ctx.currentTime;
          musicGain.gain.cancelScheduledValues(now);
          musicGain.gain.setValueAtTime(Math.max(musicGain.gain.value, 0.0001), now);
          musicGain.gain.linearRampToValueAtTime(MUSIC_GAIN, now + MUSIC_FADE_IN_SEC);
        }
        return;
      }
      void boot();
    },
    leaveRun(): void {
      if (!wantedPlaying) return;
      wantedPlaying = false;
      fadeStopMusic();
    },
    play(cue: SfxCue): void {
      if (muted) return;
      const ac = ctx;
      if (!ac || ac.state !== "running" || !sfxGain) return;
      const buf = buffers[cue];
      if (!buf) return;
      try {
        const src = ac.createBufferSource();
        src.buffer = buf;
        const g = ac.createGain();
        g.gain.value = SFX_GAIN[cue];
        src.connect(g);
        g.connect(sfxGain);
        src.start();
      } catch {
        // Fail open.
      }
    },
    setMuted(next: boolean): void {
      muted = next;
      applyMute();
    },
    isMuted(): boolean {
      return muted;
    },
  };
}
