# Synthetic speech-activity controls

These are the seven existing local negative-control fixtures generated for the
November 9, 2026 correction review, now preserved for real decoder/VAD regressions.
All are mono AAC/M4A, 32 kHz, encoded with a 64 kbps target. They contain no user,
customer or production recording. Speech is an offline Windows desktop TTS voice,
not a human whisper or real-device microphone sample.

- `digital-silence`: zero samples before AAC encoding, 3 seconds.
- `hiss`: seeded PRNG broadband noise, amplitude 0.005, 3 seconds.
- `room-noise-surrogate`: seeded noise plus 60/120 Hz hum, 3 seconds.
- `mechanical-noise-surrogate`: 120 Hz tone plus seeded noise, 3 seconds.
- `quiet-speech`: normal synthetic phrase scaled to -52 dB RMS before encoding.
- `short-word`: synthetic “Yes.”
- `normal-speech`: synthetic “I can follow up tomorrow and confirm the next step.”

The PRNG uses seed 193, multiplier 1664525, increment 1013904223, uint32 state.
These fixtures establish deterministic controls, not general noise rejection or
real-world false-rejection/acceptance rates. Real microphones, whispers, accents,
far-field speech and environmental speech still require staging acceptance.
