import * as THREE from 'three';
import type { BuildingModel, ElementKind, OpeningElement, Vec3 } from './domain/model';
import { kindOf } from './domain/model';
import { EPS, openingsOf, roofPolygon, storeyBounds, wallLength, wallOutline } from './domain/geometry';

/** Element colours shared by viewport, model tree, legend and summary. */
export const KIND_COLOR: Record<ElementKind, string> = {
  wall: '#d9d1c2',
  window: '#5f7a8c',
  door: '#6b5a4a',
  roof: '#8a6f5f',
  slab: '#8f8a82',
};
export const ACCENT = '#3a5bc7';
const ACCENT_FILL = 0x9fb1ee;
const EDGE = 0x2a2926;
const FRAME = 0xf7f6f2;

/** The single domain (Z-up) → Three.js (Y-up) conversion. */
export const toThree = ([x, y, z]: Vec3) => new THREE.Vector3(x, z, -y);

export type Role = 'wall' | 'frame' | 'glass' | 'door' | 'roof' | 'slab';
export interface Part {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  edges?: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  role: Role;
  base: THREE.ColorRepresentation;
}

/**
 * Builds Three.js meshes from the domain model. Mesh names are
 * `<elementId>:<role>`; `userData` carries elementId and elementType so the
 * glTF export keeps them as node extras. `ghost` draws an invalid opening
 * outline that is not part of the model.
 */
export function buildBuilding(m: BuildingModel, opts: { ghost?: OpeningElement | null; forExport?: boolean } = {}) {
  const group = new THREE.Group();
  group.name = m.name;
  const parts: Record<string, Part[]> = {};

  const mk = (geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, id: string, role: Role, o: { opacity?: number; rough?: number; doubleSide?: boolean } = {}) => {
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: o.rough ?? 0.9, metalness: 0, transparent: o.opacity !== undefined, opacity: o.opacity ?? 1,
      side: o.doubleSide ? THREE.DoubleSide : THREE.FrontSide, depthWrite: o.opacity === undefined,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const el = m.elements[id];
    mesh.name = `${id}:${role}`;
    mesh.userData = { elementId: id, elementType: el ? kindOf(el) : '', role };
    mesh.castShadow = o.opacity === undefined;
    mesh.receiveShadow = true;
    const part: Part = { mesh, role, base: color };
    if (!opts.forExport) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: EDGE, transparent: true, opacity: 0.7 }));
      edges.raycast = () => {};
      mesh.add(edges);
      part.edges = edges;
    }
    (parts[id] ??= []).push(part);
    return mesh;
  };

  for (const w of Object.values(m.elements)) {
    if (w.type !== 'wall') continue;
    const L = wallLength(w), t = w.thickness;
    if (!(L > 0 && w.height > 0 && t > 0)) continue;

    // Wall-local frame: x along the wall, y up, z = outward normal; the
    // exterior face sits at z = 0 and the wall extends inward to z = -t.
    const wg = new THREE.Group();
    wg.position.copy(toThree(w.start));
    wg.rotation.y = Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0]);
    group.add(wg);

    const openings = openingsOf(m, w.id);
    const { outer, holes } = wallOutline(w, openings);
    const shape = new THREE.Shape(outer.map(([u, v]) => new THREE.Vector2(u, v)));
    shape.holes = holes.map((h) => new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
    geo.translate(0, 0, -t);
    wg.add(mk(geo, KIND_COLOR.wall, w.id, 'wall'));

    for (const o of openings) {
      if (!(o.width > 0 && o.height > 0 && o.offset >= -EPS && o.offset + o.width <= L + EPS && o.sillHeight + o.height <= w.height + EPS)) continue;
      const fw = 0.06, fd = 0.07, z = -Math.min(0.12, t * 0.35), cx = o.offset + o.width / 2, cy = o.sillHeight + o.height / 2;
      const box = (bw: number, bh: number, bd: number, x: number, y: number, color: THREE.ColorRepresentation, role: Role, opt = {}) => {
        const b = mk(new THREE.BoxGeometry(bw, bh, bd), color, o.id, role, opt);
        b.position.set(x, y, z);
        wg.add(b);
      };
      box(o.width, fw, fd, cx, o.sillHeight + o.height - fw / 2, FRAME, 'frame');
      if (o.sillHeight > EPS) box(o.width, fw, fd, cx, o.sillHeight + fw / 2, FRAME, 'frame');
      box(fw, o.height, fd, o.offset + fw / 2, cy, FRAME, 'frame');
      box(fw, o.height, fd, o.offset + o.width - fw / 2, cy, FRAME, 'frame');
      if (o.openingType === 'door') {
        box(o.width - 2 * fw, o.height - fw, 0.05, cx, (o.height - fw) / 2, KIND_COLOR.door, 'door');
      } else {
        box(o.width - 2 * fw, o.height - 2 * fw, 0.02, cx, cy, KIND_COLOR.window, 'glass', { opacity: 0.78, rough: 0.2 });
        if (o.width > 1.05) box(0.05, o.height - 2 * fw, 0.05, cx, cy, FRAME, 'frame');
      }
    }

    const ghost = opts.ghost;
    if (ghost && ghost.hostWallId === w.id && !opts.forExport) {
      const gg = new THREE.BoxGeometry(ghost.width, ghost.height, t + 0.06);
      const gm = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ color: 0xd23b30, transparent: true, opacity: 0.16, depthWrite: false }));
      gm.add(new THREE.LineSegments(new THREE.EdgesGeometry(gg), new THREE.LineBasicMaterial({ color: 0xc0392b })));
      gm.position.set(ghost.offset + ghost.width / 2, ghost.sillHeight + ghost.height / 2, -t / 2);
      gm.raycast = () => {};
      wg.add(gm);
    }
  }

  for (const e of Object.values(m.elements)) {
    if (e.type !== 'roof') continue;
    const p = roofPolygon(m, e);
    if (!p) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(planarTriangles(p), 3));
    geo.computeVertexNormals();
    group.add(mk(geo, KIND_COLOR.roof, e.id, 'roof', { doubleSide: true }));
  }

  for (const e of Object.values(m.elements)) {
    if (e.type !== 'slab' || !(e.thickness > 0)) continue;
    if (e.polygon) {
      // Extrude the plan outline down by the thickness in domain space, then
      // rotate -90° about x, which is exactly the domain → Three.js mapping.
      const top = Math.max(...e.polygon.map((q) => q[2]));
      const shape = new THREE.Shape(e.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: e.thickness, bevelEnabled: false });
      geo.translate(0, 0, top - e.thickness);
      geo.rotateX(-Math.PI / 2);
      group.add(mk(geo, KIND_COLOR.slab, e.id, 'slab'));
      continue;
    }
    const b = storeyBounds(m, e.storeyId);
    if (!b) continue;
    const X = b.x1 - b.x0, Y = b.y1 - b.y0;
    const s = mk(new THREE.BoxGeometry(X, e.thickness, Y), KIND_COLOR.slab, e.id, 'slab');
    s.position.copy(toThree([b.x0 + X / 2, b.y0 + Y / 2, -e.thickness / 2]));
    group.add(s);
  }

  return { group, parts };
}

/** Triangulates a planar 3D polygon (any winding, may be concave) into Three.js positions. */
function planarTriangles(p: Vec3[]): number[] {
  const pts = p.map(toThree);
  const n = new THREE.Vector3();
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  });
  n.normalize();
  const u = new THREE.Vector3().subVectors(pts[1]!, pts[0]!).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  const flat = pts.map((q) => new THREE.Vector2(q.clone().sub(pts[0]!).dot(u), q.clone().sub(pts[0]!).dot(v)));
  return THREE.ShapeUtils.triangulateShape(flat, []).flatMap((tri) => tri.flatMap((i) => pts[i]!.toArray()));
}

const tmp = new THREE.Color();

/** Recolours parts for selection/hover without rebuilding geometry. */
export function paintSelection(parts: Record<string, Part[]>, selectedId: string | null, hoverId: string | null) {
  for (const [id, ps] of Object.entries(parts)) {
    for (const p of ps) {
      let color: THREE.ColorRepresentation = p.base, edge: THREE.ColorRepresentation = EDGE, edgeOpacity = 0.7;
      if (id === selectedId) {
        color = p.role === 'glass' ? 0x4a68d0 : p.role === 'frame' || p.role === 'door' ? ACCENT : ACCENT_FILL;
        edge = ACCENT;
        edgeOpacity = 1;
      } else if (id === hoverId) {
        color = tmp.set(p.base).lerp(new THREE.Color(ACCENT_FILL), 0.5).getHex();
        edge = 0x5f7bd6;
        edgeOpacity = 0.8;
      }
      p.mesh.material.color.set(color);
      if (p.edges) {
        p.edges.material.color.set(edge);
        p.edges.material.opacity = edgeOpacity;
      }
    }
  }
}

export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const x = o as THREE.Mesh;
    x.geometry?.dispose();
    const mat = x.material;
    if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
    else mat?.dispose();
  });
}
