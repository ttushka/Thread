import { describe, expect, it, vi } from "vitest";
import { createAudioBed, type AudioContextLike } from "../audio.ts";

type GainFake = {
  gain: {
    value: number;
    setValueAtTime: ReturnType<typeof vi.fn>;
    linearRampToValueAtTime: ReturnType<typeof vi.fn>;
    cancelScheduledValues: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
};

function fakeGain(): GainFake {
  return {
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    },
    connect: vi.fn(),
  };
}

function fakeContext(opts?: { decodeOk?: boolean }): {
  ctx: AudioContextLike;
  sources: ReturnType<typeof vi.fn>[];
} {
  const sources: ReturnType<typeof vi.fn>[] = [];
  const ctx: AudioContextLike = {
    state: "running",
    currentTime: 0,
    destination: {},
    createGain: () => fakeGain(),
    createBufferSource: () => {
      const src = {
        buffer: null as unknown,
        loop: false,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      sources.push(src.start);
      return src;
    },
    resume: () => Promise.resolve(),
    decodeAudioData: (data: ArrayBuffer) => {
      if (opts?.decodeOk === false) return Promise.reject(new Error("bad"));
      return Promise.resolve({ byteLength: data.byteLength });
    },
  };
  return { ctx, sources };
}

function okFetch(): typeof fetch {
  return (async () =>
    ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }) as Response) as typeof fetch;
}

function failFetch(): typeof fetch {
  return (async () => {
    throw new Error("network");
  }) as typeof fetch;
}

describe("audio bed", () => {
  it("stays silent when files cannot load and never throws", async () => {
    const { ctx, sources } = fakeContext();
    const bed = createAudioBed({ context: ctx, fetch: failFetch(), baseUrl: "/" });
    expect(() => bed.unlock()).not.toThrow();
    expect(() => bed.enterRun()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(() => bed.play("nick")).not.toThrow();
    expect(() => bed.play("death")).not.toThrow();
    expect(sources).toHaveLength(0);
    expect(() => bed.leaveRun()).not.toThrow();
  });

  it("does not start one-shots while muted", async () => {
    const { ctx, sources } = fakeContext();
    const bed = createAudioBed({ context: ctx, fetch: okFetch(), baseUrl: "/" });
    bed.unlock();
    bed.enterRun();
    await new Promise((r) => setTimeout(r, 20));
    const beforeMute = sources.length;
    bed.setMuted(true);
    bed.play("nick");
    bed.play("clean");
    bed.play("death");
    expect(sources.length).toBe(beforeMute);
    bed.setMuted(false);
    bed.play("nick");
    expect(sources.length).toBe(beforeMute + 1);
  });

  it("has no AudioContext in node and still fails open", () => {
    const bed = createAudioBed({ fetch: failFetch(), createContext: () => null, baseUrl: "/" });
    expect(() => {
      bed.unlock();
      bed.enterRun();
      bed.play("clean");
      bed.leaveRun();
      bed.setMuted(true);
    }).not.toThrow();
    expect(bed.isMuted()).toBe(true);
  });
});
