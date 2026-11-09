# Pinned speech model

Silero VAD v6.2, official `snakers4/silero-vad` commit
`be95df9152c0d7618fa1edfeb296fc3dae32376f`.

Source: https://github.com/snakers4/silero-vad/blob/be95df9152c0d7618fa1edfeb296fc3dae32376f/src/silero_vad/data/silero_vad.onnx

`silero_vad.onnx`: 2,327,524 bytes; SHA-256
`1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`.
The bundled MIT notice is `LICENSE.Silero.txt`. No runtime download occurs.

The API uses the official ONNX Runtime CPU binding, not a VAD wrapper. At
16 kHz, each 512-sample frame includes the preceding 64-sample context and
per-recording recurrent state, following the pinned upstream OnnxWrapper.

FFmpeg is a separately invoked packaged executable (`ffmpeg-static`), not
the video worker's installation. Its package and executable license notices
are supplied by that package; review GPL binary distribution obligations
when distributing the server. Neither runtime nor model is bundled in mobile.
