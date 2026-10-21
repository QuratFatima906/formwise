# Decisions

Short records of choices that shape the code. Newest last.

## 1. Single Vite app, not a pnpm monorepo

The spec suggests `apps/web`, `apps/api`, `packages/domain`. With no backend yet, a monorepo adds config without isolating anything real. The same boundary is kept in-tree: `src/domain/` imports nothing from React or Three.js. Split it into a package when a second consumer (an API) exists.

## 2. Z-up domain, one conversion point

The domain uses Z-up metres (+x east, +y north), matching CityJSON/IFC conventions for a future importer. Three.js is Y-up. `toThree([x, y, z]) = (x, z, −y)` in `src/scene.ts` is the only axis swap. It is a proper rotation (det = +1), so polygon winding is preserved.

## 3. Wall cutouts by outline extrusion, not CSG

Openings are cut by building each wall's elevation polygon (`wallOutline()`, tested) and extruding it. Doors and top-reaching openings become notches; the rest become holes. This is deterministic, cheap and testable. It cannot represent non-rectangular or wall-crossing openings, which are out of scope.

## 4. Drafts hold raw strings; invalid edits never reach the model

Inspector values are kept as typed strings, so `1.` or `1,6` (comma decimal) don't fight the user mid-typing. `evaluateDraft()` parses and validates a candidate model. Only error-free candidates are applied. An edit is blocked only by errors it *introduces*, so a pre-existing problem elsewhere on a wall doesn't lock the wall.

## 5. Persistence: localStorage first, backend later

The spec allows the simplest reliable approach as long as it is disclosed. localStorage is synchronous and needs no server, and the UI says "Stored in this browser". Loaded data is shape-validated (`parseModel()`), since storage is a trust boundary. The design's simulated save delay and failure toggle were removed rather than faked. Upgrade path: a NestJS `projects` module storing the same JSON model in PostgreSQL `jsonb`, with `parseModel()` reused as the request validator.

## 6. OrbitControls instead of hand-rolled camera math

The design prototype implemented orbit/pan itself. Three's `OrbitControls` (already installed) covers orbit, pan, zoom and the Orbit/Pan left-button switch. We only add click-vs-drag detection for picking. Rendering is on demand (`change` events), not a continuous loop.

## 7. TypeScript pinned to 6.x

typescript-eslint does not support TypeScript 7 yet (`typescript-eslint does not support TS 7.0`). TS 6 is the supported side-by-side version. Revisit when typescript-eslint supports TS ≥ 7.

## 8. Bundle size accepted for now

The production main chunk is ~840 KB before gzip, mostly Three.js. `GLTFExporter` is already lazy-loaded on export. Not split further until load time is measured to matter.

## 9. Strict file input, 1 MB cap

Open… accepts only Formwise project files (`{"format": "formwise.project", "version": 1, "model": …}`). The picker's `accept` attribute is a hint users can bypass, so `checkFileMeta()` enforces extension, MIME type and size (≤ 1 MB, checked before reading). `parseImportBytes()` then requires strict UTF-8, JSON, the known format/version, and `parseModel()`'s exact shape (now also checking unique storey IDs and that every element's storey exists), with 1–2000 elements. 1 MB is about 100× the sample project. Raise it with a measured need. Unknown versions are rejected rather than guessed. CityJSON follows as a separate importer behind the same gate.
