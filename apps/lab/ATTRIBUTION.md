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

## Reference photos (not shipped in the scene; used only as modelling reference)
The campus street is modelled after these photos of the Ajman University campus in Ajman, UAE (Wikimedia Commons category "Ajman University"; each file page checked: own work, CC BY-SA 4.0). No university
name or logo is used anywhere in the Lab.

| File | Shows | Author | Licence | Source |
|---|---|---|---|---|
| `reference/ajman_uni/SAA1.jpg` | Glass student hub building with blue fins | Therealmau | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:SAA1.jpg |
| `reference/ajman_uni/SAA2.jpg` | Aerial view of the campus, car parks and shade structures | Therealmau | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:SAA2.jpg |
| `reference/ajman_uni/SAA3.jpg` | Student hub facade with young trees | Therealmau | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:SAA3.jpg |
| `reference/ajman_uni/SAA4.jpg` | Older sand-and-terracotta campus building with arched entrance | Therealmau | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:SAA4.jpg |
| `reference/ajman_uni/SAA5.jpg` | Student hub building and plaza | Therealmau | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:SAA5.jpg |
| `reference/ajman_uni/SAAU1.jpg` | Aerial view of the campus and surrounding district | Therealmau | CC BY-SA 4.0 | https://commons.wikimedia.org/wiki/File:SAAU1.jpg |

CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/ — the derived 3D scene is offered under the same licence terms
for anything derived from these photos.

## HDRIs and PBR textures (all CC0)

| Asset | Author | Licence | Source |
|---|---|---|---|
| `public/assets/polyhaven/` asphalt_02 (diffuse_1k, nor_gl_1k, rough_1k) | Poly Haven | CC0 1.0 | https://polyhaven.com/a/asphalt_02 |
| `public/assets/polyhaven/` clay_plaster (diffuse_1k, nor_gl_1k, rough_1k) | Poly Haven | CC0 1.0 | https://polyhaven.com/a/clay_plaster |
| `public/assets/polyhaven/` coast_sand_01 (diffuse_1k, nor_gl_1k, rough_1k) | Poly Haven | CC0 1.0 | https://polyhaven.com/a/coast_sand_01 |
| `public/assets/polyhaven/` concrete_pavement (diffuse_1k, nor_gl_1k, rough_1k) | Poly Haven | CC0 1.0 | https://polyhaven.com/a/concrete_pavement |
| `public/assets/polyhaven/` qwantani_dusk_2_puresky (1k) | Poly Haven | CC0 1.0 | https://polyhaven.com/a/qwantani_dusk_2_puresky |
| `public/assets/polyhaven/` qwantani_late_afternoon_puresky (1k, 2k) | Poly Haven | CC0 1.0 | https://polyhaven.com/a/qwantani_late_afternoon_puresky |

## 3D models
All vehicles, people, buildings, palms and street furniture are built from three.js primitives in
`src/scene/` (Street.tsx, Models.tsx, Students.tsx). Sign textures are drawn at runtime on a `<canvas>`.
No third-party models or fonts are used. (Kenney / Quaternius CC0 models were not needed.)

## Libraries
three.js (MIT), @react-three/fiber and @react-three/drei (MIT), React (MIT), Vite (MIT), Playwright (Apache-2.0).
