import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BuildingModel, OpeningElement } from './domain/model';
import { buildBuilding, disposeGroup, paintSelection, type Part } from './scene';
import { useEditor } from './store';

export interface ViewportApi {
  fit: () => void;
  /** factor > 1 zooms in. */
  zoom: (factor: number) => void;
}

interface Props {
  model: BuildingModel;
  ghost: OpeningElement | null;
  ref?: Ref<ViewportApi>;
  children?: ReactNode;
}

interface Three {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  render: () => void;
  sun: THREE.DirectionalLight;
  ground: THREE.Mesh;
  grid?: THREE.GridHelper;
  bounds: THREE.Box3;
  building?: THREE.Group;
  parts: Record<string, Part[]>;
  pickables: THREE.Object3D[];
}

/** Home view: the design's 3/4 angle, at a distance proportional to the building's size. */
function homeView(bounds: THREE.Box3) {
  const target = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(8, bounds.getSize(new THREE.Vector3()).length() * 2.05);
  return { target, position: new THREE.Vector3().setFromSphericalCoords(radius, 1.2, 0.58).add(target) };
}

/** Moves the grid, ground and sun shadow frustum to sit under and around the building. */
function frameStage(t: Three) {
  const c = t.bounds.getCenter(new THREE.Vector3()), r = t.bounds.getSize(new THREE.Vector3()).length() / 2;
  const size = Math.max(40, Math.ceil(r * 6));
  if (t.grid?.userData.size !== size) {
    if (t.grid) { t.scene.remove(t.grid); disposeGroup(t.grid); }
    t.grid = new THREE.GridHelper(size, size, 0xc9c5bc, 0xdcd9d2); // 1 m cells
    t.grid.userData.size = size;
    t.scene.add(t.grid);
  }
  t.grid.position.set(Math.round(c.x), t.bounds.min.y - 0.005, Math.round(c.z));
  t.ground.position.set(c.x, t.bounds.min.y - 0.01, c.z);
  t.sun.target.position.set(c.x, t.bounds.min.y, c.z);
  t.sun.position.copy(c).add(new THREE.Vector3(13, 23, 18).multiplyScalar(Math.max(1, r / 8)));
  Object.assign(t.sun.shadow.camera, { left: -r * 1.6, right: r * 1.6, top: r * 1.6, bottom: -r * 1.6, near: 1, far: r * 12 + 60 });
  t.sun.shadow.camera.updateProjectionMatrix();
}

export function Viewport({ model, ghost, ref, children }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const compass = useRef<HTMLDivElement>(null);
  const three = useRef<Three | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const selectedId = useEditor((s) => s.selectedId);
  const hoverId = useEditor((s) => s.hoverId);
  const nav = useEditor((s) => s.nav);
  const setNav = useEditor((s) => s.setNav);

  const source = useEditor((s) => s.source);
  const fittedSource = useRef<string | null>(null);

  const fit = () => {
    const t = three.current;
    if (!t || t.bounds.isEmpty()) return;
    const home = homeView(t.bounds);
    t.camera.position.copy(home.position);
    t.controls.target.copy(home.target);
    t.controls.maxDistance = Math.max(120, home.position.distanceTo(home.target) * 4);
    t.controls.update();
  };
  const zoom = (f: number) => {
    const t = three.current;
    if (!t) return;
    // OrbitControls.dollyIn(s) multiplies the orbit radius by s.
    t.controls.dollyIn(1 / f);
    t.controls.update();
  };
  useImperativeHandle(ref, () => ({ fit, zoom }), []);

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      // Reports whether the external WebGL context could be created; runs once.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus('error');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xefeeea, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 500);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xa9a49a, 1.25));
    const sun = new THREE.DirectionalLight(0xfffaf0, 2.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.ShadowMaterial({ opacity: 0.18 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = 1.5;
    controls.minDistance = 6;
    controls.maxDistance = 120;

    let frame = 0;
    const render = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        renderer.render(scene, camera);
        // Point the compass needle at domain +y (north) as projected on screen.
        const a = controls.target.clone().project(camera);
        const b = controls.target.clone().add(new THREE.Vector3(0, 0, -1)).project(camera);
        const deg = (Math.atan2(b.x - a.x, (b.y - a.y) / camera.aspect) * 180) / Math.PI;
        if (compass.current) compass.current.style.transform = `rotate(${deg.toFixed(1)}deg)`;
      });
    };
    controls.addEventListener('change', render);
    controls.update();

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const pick = (e: PointerEvent): string | null => {
      const t = three.current;
      if (!t) return null;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(t.pickables, false)[0];
      return (hit?.object.userData.elementId as string | undefined) ?? null;
    };
    // A click selects only if the pointer barely moved; otherwise it was an orbit/pan drag.
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (down && e.button === 0 && Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) < 5) useEditor.getState().select(pick(e));
      down = null;
    };
    const onMove = (e: PointerEvent) => {
      if (down) return;
      const id = pick(e);
      if (id !== useEditor.getState().hoverId) useEditor.getState().setHover(id);
    };
    const onLeave = () => useEditor.getState().setHover(null);
    const cv = renderer.domElement;
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerleave', onLeave);

    three.current = { renderer, scene, camera, controls, render, sun, ground, bounds: new THREE.Box3(), parts: {}, pickables: [] };
    setStatus('ready');

    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      controls.dispose();
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerleave', onLeave);
      if (three.current?.building) disposeGroup(three.current.building);
      disposeGroup(scene);
      renderer.dispose();
      cv.remove();
      three.current = null;
    };
  }, []);

  useEffect(() => {
    const t = three.current;
    if (!t || status !== 'ready') return;
    if (t.building) {
      t.scene.remove(t.building);
      disposeGroup(t.building);
    }
    const { group, parts } = buildBuilding(model, { ghost });
    t.building = group;
    t.parts = parts;
    t.pickables = Object.values(parts).flatMap((ps) => ps.map((p) => p.mesh));
    t.scene.add(group);
    t.bounds = new THREE.Box3().setFromObject(group);
    frameStage(t);
    // Re-frame the camera when a different model is loaded, not on every edit.
    if (fittedSource.current !== source) {
      fittedSource.current = source;
      fit();
    }
    const { selectedId: sel, hoverId: hov } = useEditor.getState();
    paintSelection(parts, sel, hov);
    t.render();
  }, [model, ghost, status, source]);

  useEffect(() => {
    const t = three.current;
    if (!t) return;
    paintSelection(t.parts, selectedId, hoverId);
    t.render();
  }, [selectedId, hoverId]);

  useEffect(() => {
    const t = three.current;
    if (!t) return;
    t.controls.mouseButtons.LEFT = nav === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  }, [nav, status]);

  return (
    <div className="viewport" data-screen-label="Viewport">
      <div ref={host} className="viewport-canvas" style={{ cursor: hoverId ? 'pointer' : nav === 'pan' ? 'move' : 'grab' }} />
      <div className="viewport-tools">
        <div className="segmented">
          <button className={nav === 'orbit' ? 'on' : ''} onClick={() => setNav('orbit')} title="Left-drag orbits the camera">Orbit</button>
          <button className={nav === 'pan' ? 'on' : ''} onClick={() => setNav('pan')} title="Left-drag pans the camera">Pan</button>
        </div>
        <div className="segmented">
          <button className="icon" onClick={() => zoom(1.25)} title="Zoom in" aria-label="Zoom in">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="6" cy="6" r="4" /><path d="M9 9l3 3M4.2 6h3.6M6 4.2v3.6" /></svg>
          </button>
          <button className="icon" onClick={() => zoom(0.8)} title="Zoom out" aria-label="Zoom out">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="6" cy="6" r="4" /><path d="M9 9l3 3M4.2 6h3.6" /></svg>
          </button>
          <button onClick={fit} title="Fit model / reset camera (F)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 5V2h3M9 2h3v3M12 9v3H9M5 12H2V9" /></svg>Fit
          </button>
        </div>
      </div>
      <div className="compass" title="North (domain +y)">
        <div ref={compass} className="compass-needle">
          <span className="compass-n" />
          <span className="compass-s" />
        </div>
        <span className="compass-label">N</span>
      </div>
      <div className="scale-cue mono">
        <span className="scale-bar" />Grid 1.00 m<span>·</span>Perspective
      </div>
      {children}
      {status === 'loading' && <div className="viewport-overlay"><span className="spinner" /> Loading 3D viewport…</div>}
      {status === 'error' && (
        <div className="viewport-overlay">
          <div className="error-card">
            <div className="error-title">3D viewport could not start</div>
            <div>WebGL is not available in this browser.</div>
            <div className="muted">The model tree, inspector and summary still work.</div>
          </div>
        </div>
      )}
    </div>
  );
}
