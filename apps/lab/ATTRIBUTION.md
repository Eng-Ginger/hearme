# Attribution

## Audio
No audio files are used. Every sound in the HearMe Lab is synthesised at runtime with the Web Audio API
(`src/audio/audio.ts`):

| Sound | How it is made |
|---|---|
| Street ambience | Low-passed white noise (two decorrelated sources, wide stereo) + band-passed noise "wind" with a slow LFO |
| Birds (day) / crickets (night) | Short sine chirps with exponential frequency sweeps, placed at random 3D positions |
| Petrol motorbike, car, bus engines | Sawtooth + square oscillators at a speed-dependent firing frequency, `tanh` wave-shaper distortion, low-pass filter |
| Tyre / rolling noise | Band-passed noise whose level and centre frequency follow speed (very quiet for e-bikes and e-scooters) |
| Electric motor whine | Low-level sine following speed (e-scooter, electric tuk-tuk) |
| Bus brake hiss | High-passed noise while braking below 3 m/s |
| AVAS hum (comparison mode) | Two detuned triangle oscillators (380/571 Hz, pitch rising with speed) with a 6 Hz tremolo |
| HearMe earcons | Short sine/triangle/square beeps through an HRTF `PannerNode` placed in the vehicle's direction |

Speech uses the browser's Web Speech API voices (installed on the user's operating system).

## 3D models and textures
All models are built from three.js primitives in `src/scene/`. Sign and ground textures are drawn at
runtime on a `<canvas>` (`src/scene/textures.ts`). No external images or fonts are downloaded.

## Libraries
three.js (MIT), @react-three/fiber and @react-three/drei (MIT), React (MIT), Vite (MIT), Playwright (Apache-2.0).
