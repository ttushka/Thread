# Audio attribution

Every file in this folder was **synthesized in-house for Thread** (2026) by
`scripts/synth-audio.py`. Additive / filtered-noise synthesis only.

- No third-party sample packs
- No asset-store kits
- No “free SFX” downloads without a clear license
- No copyrighted game rips

| File | Cue | Feel |
|------|-----|------|
| `loop.mp3` | Ambient skill bed | 72s seamless dark-desk drone (D dorian). Sits under SFX. |
| `nick.mp3` | Nick / slow-mo enter | Soft brush + tape stretch, ~132ms. A tool, not a buzzer. |
| `clean.mp3` | Clean Pass | Tiny glass click. |
| `tension.mp3` | Tension gain | Quieter tick than Clean Pass. |
| `death.mp3` | Death | Short dull cut / cloth snap (pairs with the fail flash). |
| `clear.mp3` | Daily clear | Soft A→D resolve. No fanfare. |

All 22.05 kHz mono MP3. Total compressed size is well under 500KB.
Regenerate with `python3 scripts/synth-audio.py` (needs numpy + ffmpeg).
