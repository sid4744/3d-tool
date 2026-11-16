# qtents 3d tool — Local Edition

A fully local 3D tent planning and layout tool. No API keys, no cloud services required.

## Features

- **3D Viewer** — load `.glb`, `.gltf`, or `.zip` site models
- **Sketch Tool** — draw tent outlines on the ground plane (top view)
- **Poles** — place and height-adjust structural poles
- **Measure** — click two points to measure distances
- **Layout Generator** — describe furniture in plain English; items are parsed and placed locally, instantly
- **Fabric Calculator** — automatic 1.5 m panel breakdown with waste estimate
- **Export** — DXF, OBJ, and PDF sheet exports
- **Import OBJ** — bring in additional 3D objects

## Run Locally

**Prerequisites:** Node.js 18+

```bash
npm install
npm run dev
```

No `.env` configuration needed — everything runs in the browser.

## Layout Generator Prompt Examples

```
3 round tables (1m) and 10 chairs
2 bars (3x1m), 1 stage, 5 stools
4 booths (2x1m), 1 podium, 6 round tables
```

Supported item keywords include: `chair`, `stool`, `table`, `desk`, `sofa`, `bench`,
`bar`, `counter`, `stage`, `podium`, `shelf`, `cabinet`, `booth`, `display`, `stand`,
`screen`, `speaker`, `fridge`, `plant`, `bin`, `box`, `crate`, `pallet`, and more.

Dimensions can be given inline: `(1m)` for square/round, `(2x1m)` for rectangular.

## Build for Production

```bash
npm run build
```

Output is in `dist/` and can be served statically from any web server.
