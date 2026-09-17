#!/usr/bin/env python3
"""Synthesize Thread's original audio bed in-house. No third-party samples.

Writes 16-bit mono WAVs, then encodes tiny MP3s into public/audio/.
Loop length is an integer number of seconds so every oscillator can close
on a cycle boundary (seamless, no stitch click).
"""

from __future__ import annotations

import math
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "audio"
TMP = ROOT / ".audio-build"

SR = 22050
LOOP_SEC = 72.0  # 60–90s; 72 divides cleanly for LFOs
NICK_SEC = 0.132  # <150ms


def rng_for(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)


def snap_hz(hz: float, n: int, sr: int = SR) -> float:
    cycles = max(1, int(round(hz * n / sr)))
    return cycles * sr / n


def env_exp(n: int, attack: float, decay: float, sr: int = SR) -> np.ndarray:
    t = np.arange(n, dtype=np.float64) / sr
    att_n = max(1, int(attack * sr))
    a = np.linspace(0.0, 1.0, att_n, endpoint=False)
    rest = n - att_n
    d = np.exp(-t[:rest] / max(decay, 1e-4)) if rest > 0 else np.array([], dtype=np.float64)
    e = np.concatenate([a, d])[:n]
    if len(e) < n:
        e = np.pad(e, (0, n - len(e)))
    return e


def fft_band(x: np.ndarray, lo: float, hi: float, sr: int = SR) -> np.ndarray:
    n = len(x)
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, 1.0 / sr)
    # Raised-cosine skirts so the loop stays smooth.
    bw = max(40.0, (hi - lo) * 0.08)
    lo_w = np.clip((freqs - (lo - bw)) / bw, 0.0, 1.0)
    hi_w = np.clip(((hi + bw) - freqs) / bw, 0.0, 1.0)
    spec *= lo_w * hi_w
    return np.fft.irfft(spec, n)


def soft_limit(x: np.ndarray, thresh: float = 0.95) -> np.ndarray:
    return thresh * np.tanh(x / max(thresh, 1e-6))


def peak_to(x: np.ndarray, peak: float) -> np.ndarray:
    m = float(np.max(np.abs(x))) + 1e-12
    return x * (peak / m)


def write_wav(path: Path, x: np.ndarray, sr: int = SR) -> None:
    y = np.clip(x, -1.0, 1.0)
    pcm = (y * 32767.0).astype(np.int16)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def encode_mp3(wav: Path, mp3: Path, bitrate: str) -> None:
    mp3.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(wav),
        "-codec:a",
        "libmp3lame",
        "-b:a",
        bitrate,
        "-ac",
        "1",
        "-ar",
        str(SR),
        str(mp3),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr or "ffmpeg failed\n")
        raise SystemExit(r.returncode)


def sine(n: int, hz: float, phase: float = 0.0, sr: int = SR) -> np.ndarray:
    t = np.arange(n, dtype=np.float64) / sr
    return np.sin(2.0 * math.pi * hz * t + phase)


def make_loop() -> np.ndarray:
    n = int(LOOP_SEC * SR)
    t = np.arange(n, dtype=np.float64) / SR
    rng = rng_for(0x74687264)  # 'thrd'
    # Uniforms used only for static partial phases (loop-safe).
    phases = rng.random(24) * 2.0 * math.pi

    def hz(f: float) -> float:
        return snap_hz(f, n)

    # Dark-desk drone: D2 + A2 fifth, integer-cycle, slow beating via nearby partials.
    d2, a2, d3, f3, a3, c4, g3 = (hz(f) for f in (73.42, 110.0, 146.83, 174.61, 220.0, 261.63, 196.0))

    drone = np.zeros(n, dtype=np.float64)
    for i, (f, amp) in enumerate(
        [
            (d2, 0.22),
            (hz(d2 * 2), 0.08),
            (a2, 0.11),
            (hz(d2 * 3), 0.03),
        ]
    ):
        beat = 1.0 + 0.04 * np.sin(2.0 * math.pi * t / (18.0 if i % 2 == 0 else 24.0) + phases[i])
        drone += amp * beat * sine(n, f, phases[i])

    # Calm pad: D-F-A with a slow color drift toward F-A-C that returns at t=0.
    # Period = loop, so the seam is the same chord.
    color = 0.5 + 0.5 * np.sin(2.0 * math.pi * t / LOOP_SEC)
    pad = (
        0.10 * sine(n, d3, phases[4]) * (1.0 - 0.35 * color)
        + 0.09 * sine(n, f3, phases[5])
        + 0.07 * sine(n, a3, phases[6])
        + 0.045 * sine(n, c4, phases[7]) * (0.35 + 0.65 * color)
        + 0.04 * sine(n, g3, phases[8]) * (0.5 + 0.5 * np.sin(2.0 * math.pi * t / 36.0 + phases[8]))
    )
    # Breath on the pad (12s and 24s, both divide 72).
    pad *= 0.72 + 0.28 * np.sin(2.0 * math.pi * t / 24.0 + 0.4) * (
        0.85 + 0.15 * np.sin(2.0 * math.pi * t / 12.0)
    )

    # High air — quiet, never a lead. D5/A5 wisps.
    d5, a5 = hz(587.33), hz(880.0)
    air = 0.018 * sine(n, d5, phases[9]) * (0.5 + 0.5 * np.sin(2.0 * math.pi * t / 18.0 + phases[10]))
    air += 0.012 * sine(n, a5, phases[11]) * (0.5 + 0.5 * np.sin(2.0 * math.pi * t / 24.0 + phases[12]))

    # Sparse long tones (premium indie, not a melody run). Times wrap with the loop.
    motif = np.zeros(n, dtype=np.float64)
    notes = [
        (0.0, d3, 5.5, 0.055),
        (12.0, a3, 4.0, 0.04),
        (24.0, f3, 6.0, 0.048),
        (36.0, hz(293.66), 5.0, 0.042),  # D4
        (48.0, a2, 7.0, 0.05),
        (60.0, f3, 5.0, 0.038),
    ]
    for start, f, dur, amp in notes:
        i0 = int(start * SR)
        nnote = int(dur * SR)
        tone = sine(nnote, f, phases[13]) * env_exp(nnote, 0.35, dur * 0.55)
        # Wrap into the loop so a tail past 72s lands on the head.
        idx = (i0 + np.arange(nnote)) % n
        motif[idx] += amp * tone

    # Desk noise: brown-ish, band-limited, periodic via FFT of a loop-sized buffer.
    white = rng.random(n) * 2.0 - 1.0
    brown = np.cumsum(white)
    brown -= brown.mean()
    brown = fft_band(brown, 80.0, 700.0)
    noise = 0.035 * peak_to(brown, 1.0)
    # Slow dust swell, 8s period.
    noise *= 0.75 + 0.25 * np.sin(2.0 * math.pi * t / 8.0 + phases[14])

    # Barely-there low pulse every 6s — a desk clock, not a kick.
    pulse = np.zeros(n, dtype=np.float64)
    pulse_len = int(0.18 * SR)
    thud = sine(pulse_len, d2, 0.0) * env_exp(pulse_len, 0.01, 0.09)
    for s in np.arange(0.0, LOOP_SEC, 6.0):
        i0 = int(s * SR)
        end = min(i0 + pulse_len, n)
        pulse[i0:end] += 0.045 * thud[: end - i0]

    mix = drone + pad + air + motif + noise + pulse
    mix = fft_band(mix, 28.0, 5200.0)
    mix = soft_limit(mix, 0.97)
    return peak_to(mix, 0.38).astype(np.float64)


def make_nick() -> np.ndarray:
    """Soft brush / tape stretch. Tool, not a fail buzzer. <150ms."""
    n = int(NICK_SEC * SR)
    t = np.arange(n, dtype=np.float64) / SR
    # Downward sweep ~1.4kHz → 420Hz (tape stretch) + bandpassed dust.
    sweep = np.sin(2.0 * math.pi * (1400.0 * t - 0.5 * 7400.0 * t * t))
    sweep *= env_exp(n, 0.006, 0.045)
    rng = rng_for(11)
    dust = fft_band(rng.random(n) * 2.0 - 1.0, 400.0, 2800.0)
    dust *= env_exp(n, 0.004, 0.05)
    # Gentle downward chorus, quieter than the sweep.
    stretch = np.sin(2.0 * math.pi * np.linspace(900.0, 280.0, n) * t)
    stretch *= env_exp(n, 0.008, 0.055)
    mix = 0.42 * sweep + 0.38 * dust + 0.22 * stretch
    return peak_to(soft_limit(mix), 0.62)


def make_clean() -> np.ndarray:
    """Tiny glass click."""
    n = int(0.055 * SR)
    t = np.arange(n, dtype=np.float64) / SR
    # Inharmonic glass partials.
    click = (
        0.55 * np.sin(2.0 * math.pi * 3120.0 * t)
        + 0.28 * np.sin(2.0 * math.pi * 3120.0 * 2.76 * t)
        + 0.12 * np.sin(2.0 * math.pi * 3120.0 * 5.4 * t)
    )
    click *= np.exp(-t / 0.012)
    transient = fft_band(rng_for(22).random(n) * 2.0 - 1.0, 2000.0, 8000.0) * np.exp(-t / 0.004)
    mix = click + 0.25 * transient
    return peak_to(mix, 0.48)


def make_tension() -> np.ndarray:
    """Quieter, lower cousin of the clean tick."""
    n = int(0.048 * SR)
    t = np.arange(n, dtype=np.float64) / SR
    tick = 0.7 * np.sin(2.0 * math.pi * 1860.0 * t) + 0.2 * np.sin(2.0 * math.pi * 3720.0 * t)
    tick *= np.exp(-t / 0.011)
    return peak_to(tick, 0.28)


def make_death() -> np.ndarray:
    """Short dull cut / cloth snap. Pairs with the existing flash — not a Wilhelm."""
    n = int(0.16 * SR)
    t = np.arange(n, dtype=np.float64) / SR
    cloth = fft_band(rng_for(33).random(n) * 2.0 - 1.0, 120.0, 1400.0)
    cloth *= env_exp(n, 0.002, 0.028)
    # Quick low cut, then mute — a snip, not a drone.
    thud = np.sin(2.0 * math.pi * 92.0 * t) * env_exp(n, 0.003, 0.04)
    mix = 0.7 * cloth + 0.45 * thud
    gate = np.ones(n)
    cut = int(0.09 * SR)
    gate[cut:] *= np.exp(-np.arange(n - cut) / (0.018 * SR))
    return peak_to(mix * gate, 0.7)


def make_clear() -> np.ndarray:
    """Soft resolve chime. Restrained; no fanfare."""
    n = int(0.9 * SR)
    t = np.arange(n, dtype=np.float64) / SR

    def bell(hz: float, delay: float, amp: float) -> np.ndarray:
        i0 = int(delay * SR)
        remain = n - i0
        tt = np.arange(remain, dtype=np.float64) / SR
        tone = (
            np.sin(2.0 * math.pi * hz * tt)
            + 0.22 * np.sin(2.0 * math.pi * hz * 2.0 * tt)
            + 0.08 * np.sin(2.0 * math.pi * hz * 3.0 * tt)
        )
        tone *= np.exp(-tt / 0.28) * (1.0 - np.exp(-tt / 0.012))
        out = np.zeros(n)
        out[i0:] = amp * tone
        return out

    # A4 → D5 with a quiet D4 bed. Settles; does not celebrate.
    mix = bell(440.0, 0.0, 0.42) + bell(587.33, 0.16, 0.38) + bell(293.66, 0.0, 0.18)
    return peak_to(soft_limit(mix), 0.52)


def main() -> None:
    TMP.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    jobs = [
        ("loop", make_loop, "40k"),
        ("nick", make_nick, "48k"),
        ("clean", make_clean, "48k"),
        ("tension", make_tension, "48k"),
        ("death", make_death, "48k"),
        ("clear", make_clear, "48k"),
    ]
    total = 0
    for name, fn, br in jobs:
        print(f"synth {name}…", flush=True)
        wav = TMP / f"{name}.wav"
        mp3 = OUT_DIR / f"{name}.mp3"
        write_wav(wav, fn())
        encode_mp3(wav, mp3, br)
        size = mp3.stat().st_size
        total += size
        print(f"  {mp3.relative_to(ROOT)}  {size} bytes")
    print(f"total {total} bytes ({total / 1024:.1f} KB)")
    if total > 500 * 1024:
        print("warning: over 500KB compressed budget", file=sys.stderr)


if __name__ == "__main__":
    main()
