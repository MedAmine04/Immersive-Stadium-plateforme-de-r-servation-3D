"use client";

import { Bvh, OrbitControls } from "@react-three/drei";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { memo, MutableRefObject, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  buildApron, buildFacade, buildRoof, buildSectionGeometry, buildTierStructure, mergeGeometries,
  pitchTexture, ringPointAtPhi, tierEdges, tierFor, unwrapRange,
} from "@/lib/geometry";
import { hoverStore } from "@/lib/hoverStore";
import { seatRefAt } from "@/lib/seats";
import type { Availability, BowlSpec, SeatRef, SectionInfo, SectionSeats, Venue } from "@/lib/types";

export type Focus =
  | { kind: "overview" }
  | { kind: "section"; code: string }
  | { kind: "seat"; seat: SeatRef };

export interface SceneApi {
  captureThumb: (seat: { x: number; y: number; z: number }) => string | null;
}

export type QualityMode = "auto" | "high" | "low";

interface SceneProps {
  venue: Venue;
  availability: Availability | null;
  categoryColors: Record<string, string>;
  focus: Focus;
  focusKey: number;
  activeSection: string | null;
  seatData: Record<string, SectionSeats>;
  selectedIds: Set<number>;
  compareIds: Set<number>;
  roofVisible: boolean;
  quality: QualityMode;
  hoverSectionCode: string | null;
  onSectionClick: (code: string) => void;
  onSectionHover: (code: string | null) => void;
  onSeatClick: (seat: SeatRef) => void;
  apiRef: MutableRefObject<SceneApi | null>;
  onFps?: (fps: number, dpr: number) => void;
}

const SEAT_BASE = new THREE.Color("#8fa3bf");

/* ------------------------------------------------------------------ */
/* Statique : terrain, façade, toit, gradins                           */
/* ------------------------------------------------------------------ */
function Pitch({ venue }: { venue: Venue }) {
  const { length, width } = venue.pitch;
  const tex = useMemo(() => pitchTexture(length, width), [length, width]);
  useEffect(() => () => tex.dispose(), [tex]);
  const goal = useMemo(() => {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: "#f2f2f2", roughness: 0.5 });
    for (const sgn of [-1, 1]) {
      const z = sgn * (length / 2);
      const post = (x: number) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.44, 8), mat);
        m.position.set(x, 1.22, z);
        g.add(m);
      };
      post(-3.66); post(3.66);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.32, 8), mat);
      bar.rotation.z = Math.PI / 2; bar.position.set(0, 2.44, z);
      g.add(bar);
      const net = new THREE.Mesh(new THREE.PlaneGeometry(7.32, 2.44), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.16, side: THREE.DoubleSide }));
      net.position.set(0, 1.22, z + sgn * 1.8);
      g.add(net);
    }
    return g;
  }, [length]);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial map={tex} roughness={0.95} />
      </mesh>
      <primitive object={goal} />
    </group>
  );
}

function Apron({ bowl }: { bowl: BowlSpec }) {
  const geo = useMemo(() => {
    const dStart = Math.min(...bowl.tiers.filter((t) => t.tier === "L").map((t) => t.rows[0].d - 0.4));
    return buildApron(bowl, dStart);
  }, [bowl]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color="#1d4a2a" roughness={1} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Shell({ bowl, roofOpacity }: { bowl: BowlSpec; roofOpacity: number }) {
  const facade = useMemo(() => buildFacade(bowl), [bowl]);
  const roof = useMemo(() => buildRoof(bowl), [bowl]);
  const lights = useMemo(() => {
    const pts: THREE.Matrix4[] = [];
    for (let k = 0; k < 360; k += 6) {
      const [x, z] = ringPointAtPhi(bowl, bowl.roof.edge_d + 0.5, k);
      pts.push(new THREE.Matrix4().makeTranslation(x, bowl.roof.lip_y - 0.6, z));
    }
    return pts;
  }, [bowl]);
  const lightsRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = lightsRef.current;
    if (!m) return;
    lights.forEach((mat, i) => m.setMatrixAt(i, mat));
    m.instanceMatrix.needsUpdate = true;
  }, [lights]);
  useEffect(() => () => { facade.dispose(); roof.dispose(); }, [facade, roof]);
  return (
    <group>
      <mesh geometry={facade}>
        <meshStandardMaterial vertexColors flatShading metalness={0.25} roughness={0.5} side={THREE.DoubleSide} emissive="#3a2a0a" emissiveIntensity={0.35} />
      </mesh>
      <mesh geometry={roof} visible={roofOpacity > 0.01}>
        <meshStandardMaterial color="#cfd6e2" roughness={0.7} side={THREE.DoubleSide} transparent={roofOpacity < 0.99} opacity={roofOpacity} depthWrite={roofOpacity > 0.99} />
      </mesh>
      <instancedMesh ref={lightsRef} args={[undefined, undefined, lights.length]}>
        <boxGeometry args={[2.2, 0.5, 0.9]} />
        <meshBasicMaterial color="#fff6d8" />
      </instancedMesh>
    </group>
  );
}

function Structures({ bowl }: { bowl: BowlSpec }) {
  const geo = useMemo(() => mergeGeometries(bowl.tiers.flatMap((t) => buildTierStructure(bowl, t))), [bowl]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color="#9aa1ad" roughness={0.9} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Une maille par secteur : couleur = catégorie tarifaire, assombrie selon le taux d'occupation. */
const SectionMeshes = memo(function SectionMeshes({
  venue, availability, categoryColors, selectedCounts, activeSection, hoverSectionCode, onSectionClick, onSectionHover,
}: {
  venue: Venue; availability: Availability | null; categoryColors: Record<string, string>;
  selectedCounts: Record<string, number>; activeSection: string | null; hoverSectionCode: string | null;
  onSectionClick: (c: string) => void; onSectionHover: (c: string | null) => void;
}) {
  const geos = useMemo(() => venue.sections.map((s) => buildSectionGeometry(venue.bowl, s)), [venue]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  const mats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);

  useEffect(() => {
    venue.sections.forEach((s, i) => {
      const m = mats.current[i];
      if (!m) return;
      const closed = availability?.closed_sections.includes(s.code) ?? false;
      const cat = availability?.section_categories[s.code] ?? s.category;
      const base = new THREE.Color(categoryColors[cat] ?? "#8899aa");
      const sold = availability?.section_taken?.[s.code] ?? 0;
      const fill = Math.min(sold / Math.max(s.seat_count, 1), 1);
      if (closed) base.set("#2c313b");
      else base.lerp(new THREE.Color("#22262e"), fill * 0.75);
      m.color.copy(base);
      const active = s.code === activeSection;
      const hov = s.code === hoverSectionCode;
      const picked = (selectedCounts[s.code] ?? 0) > 0;
      m.emissive.set(active ? "#ffd166" : picked ? "#f08a24" : hov ? "#ffffff" : "#000000");
      m.emissiveIntensity = active ? 0.45 : picked ? 0.35 : hov ? 0.3 : 0;
    });
  }, [venue, availability, categoryColors, selectedCounts, activeSection, hoverSectionCode]);

  const click = (e: ThreeEvent<MouseEvent>, code: string) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    onSectionClick(code);
  };
  return (
    <Bvh firstHitOnly>
      <group>
        {venue.sections.map((s, i) => (
          <mesh
            key={s.code}
            geometry={geos[i]}
            userData={{ section: s.code }}
            onClick={(e) => click(e, s.code)}
            onPointerOver={(e) => { e.stopPropagation(); onSectionHover(s.code); document.body.style.cursor = "pointer"; }}
            onPointerOut={() => { onSectionHover(null); document.body.style.cursor = ""; }}
          >
            <meshStandardMaterial ref={(m) => { mats.current[i] = m; }} color="#8899aa" roughness={0.85} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </Bvh>
  );
});

/* ------------------------------------------------------------------ */
/* Sièges individuels (InstancedMesh)                                   */
/* ------------------------------------------------------------------ */
function seatGeometry() {
  const base = new THREE.BoxGeometry(0.42, 0.08, 0.4); base.translate(0, 0.42, 0.02);
  const back = new THREE.BoxGeometry(0.42, 0.44, 0.06); back.translate(0, 0.66, -0.2);
  const leg = new THREE.BoxGeometry(0.3, 0.4, 0.06); leg.translate(0, 0.2, -0.16);
  const geos = [base, back, leg].map((g) => g.toNonIndexed());
  const g = mergeGeometries(geos);
  geos.forEach((x) => x.dispose());
  return g;
}

const SEAT_COLORS = {
  taken: new THREE.Color("#3b414d"), blocked: new THREE.Color("#5b2b2b"), mine: new THREE.Color("#2dd4bf"),
  selected: new THREE.Color("#ffd166"), compare: new THREE.Color("#ff6bd6"), accessible: new THREE.Color("#4cc9f0"),
};

const SeatLayer = memo(function SeatLayer({
  data, section, availability, categoryColors, selectedIds, compareIds, hiddenSeatId, onSeatClick,
}: {
  data: SectionSeats; section: SectionInfo; availability: Availability | null; categoryColors: Record<string, string>;
  selectedIds: Set<number>; compareIds: Set<number>; hiddenSeatId: number | null; onSeatClick: (s: SeatRef) => void;
}) {
  const geo = useMemo(() => seatGeometry(), []);
  const ref = useRef<THREE.InstancedMesh>(null);
  const cat = availability?.section_categories[section.code] ?? section.category;
  const taken = useMemo(() => new Set(availability?.taken ?? []), [availability]);
  const blocked = useMemo(() => new Set(availability?.blocked_seats ?? []), [availability]);
  const mine = useMemo(() => new Set(availability?.held_by_me ?? []), [availability]);
  const closed = availability?.closed_sections.includes(section.code) ?? false;
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    for (let i = 0; i < data.count; i++) {
      tmp.position.set(data.x[i], data.y[i], data.z[i]);
      tmp.rotation.set(0, data.ry[i], 0);
      const hide = data.ids[i] === hiddenSeatId;
      tmp.scale.setScalar(hide ? 0.0001 : 1);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [data, hiddenSeatId, tmp]);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const base = new THREE.Color(categoryColors[cat] ?? "#8fa3bf");
    for (let i = 0; i < data.count; i++) {
      const id = data.ids[i];
      if (selectedIds.has(id)) color.copy(SEAT_COLORS.selected);
      else if (compareIds.has(id)) color.copy(SEAT_COLORS.compare);
      else if (mine.has(id)) color.copy(SEAT_COLORS.mine);
      else if (closed || blocked.has(id)) color.copy(SEAT_COLORS.blocked);
      else if (taken.has(id)) color.copy(SEAT_COLORS.taken);
      else if ((data.fl[i] & 1) === 1) color.copy(SEAT_COLORS.accessible);
      else color.copy(base);
      m.setColorAt(i, color);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [data, selectedIds, compareIds, taken, blocked, mine, closed, cat, categoryColors, color]);

  const refFor = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const i = e.instanceId;
    return i === undefined ? null : { i, seat: seatRefAt(data, i, availability, cat) };
  };
  const statusOf = (id: number) =>
    selectedIds.has(id) ? "Dans votre sélection" : mine.has(id) ? "Verrouillé pour vous" : closed || blocked.has(id) ? "Non disponible"
      : taken.has(id) ? "Déjà pris" : "Disponible";

  return (
    <instancedMesh
      ref={ref}
      args={[geo, undefined, data.count]}
      frustumCulled={false}
      onClick={(e) => {
        if (e.delta > 5) return;
        const r = refFor(e);
        if (!r) return;
        e.stopPropagation();
        onSeatClick(r.seat);
      }}
      onPointerMove={(e) => {
        const r = refFor(e);
        if (!r) return;
        e.stopPropagation();
        hoverStore.set({ seat: r.seat, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, status: statusOf(r.seat.id) });
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => { hoverStore.set({ seat: null, x: 0, y: 0, status: "" }); document.body.style.cursor = ""; }}
    >
      <meshStandardMaterial color={SEAT_BASE} roughness={0.7} />
    </instancedMesh>
  );
});

/** Marqueurs lumineux pour les sièges sélectionnés hors du secteur actif. */
function Markers({ points }: { points: { x: number; y: number; z: number; color: string }[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    points.forEach((p, i) => {
      tmp.position.set(p.x, p.y + 1.2, p.z);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      m.setColorAt(i, new THREE.Color(p.color));
    });
    m.count = points.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [points, tmp]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, 64]} frustumCulled={false}>
      <coneGeometry args={[0.45, 1.3, 8]} />
      <meshBasicMaterial />
    </instancedMesh>
  );
}

/* ------------------------------------------------------------------ */
/* Caméra                                                               */
/* ------------------------------------------------------------------ */
const OVERVIEW_POS = new THREE.Vector3(190, 175, 240);
const OVERVIEW_TARGET = new THREE.Vector3(0, 6, 0);

function sectionFocusPose(bowl: BowlSpec, s: SectionInfo) {
  const t = tierFor(bowl, s);
  const [p0, p1] = unwrapRange(s.phi_start, s.phi_end);
  const e = tierEdges(t);
  const dMid = (e[0] + e[e.length - 1]) / 2;
  const mid = t.rows[Math.floor(t.rows.length / 2)];
  const [x, z] = ringPointAtPhi(bowl, dMid, (p0 + p1) / 2);
  const target = new THREE.Vector3(x, mid.y, z);
  const inward = new THREE.Vector3(-x, 0, -z).normalize();
  const dist = 20 + t.rows.length * 0.9;
  const pos = target.clone().addScaledVector(inward, dist).add(new THREE.Vector3(0, 10 + t.rows.length * 0.35, 0));
  return { pos, target };
}

interface Flight {
  t: number; dur: number;
  fromPos: THREE.Vector3; toPos: THREE.Vector3;
  fromTarget: THREE.Vector3; toTarget: THREE.Vector3;
  fromFov: number; toFov: number; seat: boolean;
}

function CameraRig({ venue, focus, focusKey, controlsRef }: {
  venue: Venue; focus: Focus; focusKey: number; controlsRef: MutableRefObject<any>;
}) {
  const { camera, gl } = useThree();
  const flight = useRef<Flight | null>(null);
  const seatMode = useRef<{ eye: THREE.Vector3; base: THREE.Vector3; yaw: number; pitch: number } | null>(null);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  const persp = camera as THREE.PerspectiveCamera;

  // Démarrage d'un vol de caméra à chaque changement de focus.
  useEffect(() => {
    const controls = controlsRef.current;
    const fromPos = camera.position.clone();
    let fromTarget: THREE.Vector3;
    if (seatMode.current) {
      const s = seatMode.current;
      fromTarget = s.eye.clone().add(dirFrom(s));
    } else fromTarget = controls ? controls.target.clone() : OVERVIEW_TARGET.clone();
    let toPos: THREE.Vector3, toTarget: THREE.Vector3, toFov = 42, seat = false;
    if (focus.kind === "overview") { toPos = OVERVIEW_POS.clone(); toTarget = OVERVIEW_TARGET.clone(); }
    else if (focus.kind === "section") {
      const s = venue.sections.find((x) => x.code === focus.code);
      if (!s) return;
      const p = sectionFocusPose(venue.bowl, s);
      toPos = p.pos; toTarget = p.target; toFov = 50;
    } else {
      const s = focus.seat;
      const eye = new THREE.Vector3(s.x, s.y + venue.bowl.eye_height, s.z);
      const base = new THREE.Vector3(-s.x, 0, -s.z).sub(new THREE.Vector3(0, eye.y * 0.0, 0)).normalize();
      // vise le centre du terrain (légèrement sous l'horizon selon la hauteur)
      const aim = new THREE.Vector3(0, 0, 0).sub(eye).normalize();
      seatMode.current = null;
      toPos = eye; toTarget = eye.clone().add(aim.multiplyScalar(50)); toFov = 72; seat = true;
      pendingSeat.current = { eye, base: aim.clone().normalize() };
      void base;
    }
    if (!seat) { seatMode.current = null; pendingSeat.current = null; }
    flight.current = { t: 0, dur: seat ? 1.4 : 1.1, fromPos, toPos, fromTarget, toTarget, fromFov: persp.fov, toFov, seat };
    if (controls) controls.enabled = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  const pendingSeat = useRef<{ eye: THREE.Vector3; base: THREE.Vector3 } | null>(null);

  function dirFrom(s: { base: THREE.Vector3; yaw: number; pitch: number }) {
    const d = s.base.clone();
    d.applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
    const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
    d.applyAxisAngle(right, s.pitch);
    return d;
  }

  useFrame((_, dt) => {
    const controls = controlsRef.current;
    const f = flight.current;
    if (f) {
      f.t = Math.min(f.t + dt / f.dur, 1);
      const k = f.t < 0.5 ? 4 * f.t * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 3) / 2;
      camera.position.lerpVectors(f.fromPos, f.toPos, k);
      lookTarget.lerpVectors(f.fromTarget, f.toTarget, k);
      persp.fov = f.fromFov + (f.toFov - f.fromFov) * k;
      persp.updateProjectionMatrix();
      camera.lookAt(lookTarget);
      if (controls) controls.target.copy(lookTarget);
      if (f.t >= 1) {
        flight.current = null;
        if (f.seat && pendingSeat.current) {
          seatMode.current = { eye: pendingSeat.current.eye, base: pendingSeat.current.base, yaw: 0, pitch: 0 };
        } else if (controls) {
          controls.enabled = true;
          controls.update();
        }
      }
      return;
    }
    const s = seatMode.current;
    if (s) {
      camera.position.copy(s.eye);
      camera.lookAt(s.eye.clone().add(dirFrom(s)));
    }
  });

  // Regard libre (souris, tactile, clavier) en vue depuis le siège ; rotation clavier en vue globale.
  useEffect(() => {
    const el = gl.domElement;
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { if (seatMode.current) drag = { x: e.clientX, y: e.clientY }; };
    const move = (e: PointerEvent) => {
      const s = seatMode.current;
      if (!s || !drag) return;
      const k = (persp.fov / 72) * 0.0042;
      s.yaw += (e.clientX - drag.x) * k;
      s.pitch = THREE.MathUtils.clamp(s.pitch + (e.clientY - drag.y) * k * 0.8, -0.9, 0.9);
      drag = { x: e.clientX, y: e.clientY };
    };
    const up = () => { drag = null; };
    const wheel = (e: WheelEvent) => {
      if (!seatMode.current) return;
      e.preventDefault();
      persp.fov = THREE.MathUtils.clamp(persp.fov + e.deltaY * 0.03, 28, 95);
      persp.updateProjectionMatrix();
    };
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const s = seatMode.current;
      const step = 0.08;
      if (s) {
        if (e.key === "ArrowLeft") s.yaw += step;
        else if (e.key === "ArrowRight") s.yaw -= step;
        else if (e.key === "ArrowUp") s.pitch = Math.min(s.pitch + step, 0.9);
        else if (e.key === "ArrowDown") s.pitch = Math.max(s.pitch - step, -0.9);
        else if (e.key === "+" || e.key === "=") { persp.fov = Math.max(28, persp.fov - 4); persp.updateProjectionMatrix(); }
        else if (e.key === "-") { persp.fov = Math.min(95, persp.fov + 4); persp.updateProjectionMatrix(); }
        else return;
        e.preventDefault();
        return;
      }
      const c = controlsRef.current;
      if (!c || flight.current) return;
      const off = camera.position.clone().sub(c.target);
      const sph = new THREE.Spherical().setFromVector3(off);
      if (e.key === "ArrowLeft") sph.theta -= 0.08;
      else if (e.key === "ArrowRight") sph.theta += 0.08;
      else if (e.key === "ArrowUp") sph.phi = Math.max(0.15, sph.phi - 0.06);
      else if (e.key === "ArrowDown") sph.phi = Math.min(1.45, sph.phi + 0.06);
      else if (e.key === "+" || e.key === "=") sph.radius = Math.max(12, sph.radius * 0.9);
      else if (e.key === "-") sph.radius = Math.min(520, sph.radius * 1.1);
      else return;
      e.preventDefault();
      off.setFromSpherical(sph);
      camera.position.copy(c.target).add(off);
      c.update();
    };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    el.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
    };
  }, [gl, camera, persp, controlsRef]);

  return null;
}

/* ------------------------------------------------------------------ */
/* Qualité adaptative + capture de vignettes                            */
/* ------------------------------------------------------------------ */
function Governor({ quality, onFps }: { quality: QualityMode; onFps?: (fps: number, dpr: number) => void }) {
  const setDpr = useThree((s) => s.setDpr);
  const level = useRef(0);
  const acc = useRef({ t: 0, n: 0, low: 0 });
  const maxDpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const dprFor = (l: number, q: QualityMode) => {
    if (q === "low") return 1;
    const steps = [maxDpr, Math.min(maxDpr, 1.5), 1];
    return steps[Math.min(l, 2)];
  };
  useEffect(() => { setDpr(dprFor(level.current, quality)); }, [quality]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => {
    const a = acc.current;
    a.t += dt; a.n++;
    if (a.t >= 2) {
      const fps = a.n / a.t;
      if (quality === "auto") {
        if (fps < 26) a.low++; else a.low = 0;
        if (a.low >= 2 && level.current < 2) { level.current++; a.low = 0; setDpr(dprFor(level.current, quality)); }
      }
      onFps?.(Math.round(fps), dprFor(level.current, quality));
      a.t = 0; a.n = 0;
    }
  });
  return null;
}

function ApiBridge({ apiRef, bowl }: { apiRef: MutableRefObject<SceneApi | null>; bowl: BowlSpec }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const W = 480, H = 270;
    apiRef.current = {
      captureThumb: (seat) => {
        try {
          const cam = new THREE.PerspectiveCamera(72, W / H, 0.1, 900);
          cam.position.set(seat.x, seat.y + bowl.eye_height, seat.z);
          cam.lookAt(0, 0, 0);
          const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
          rt.texture.colorSpace = THREE.SRGBColorSpace;
          const prev = gl.getRenderTarget();
          gl.setRenderTarget(rt);
          gl.render(scene, cam);
          gl.setRenderTarget(prev);
          const buf = new Uint8Array(W * H * 4);
          gl.readRenderTargetPixels(rt, 0, 0, W, H, buf);
          rt.dispose();
          const c = document.createElement("canvas");
          c.width = W; c.height = H;
          const ctx = c.getContext("2d")!;
          const img = ctx.createImageData(W, H);
          for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
          ctx.putImageData(img, 0, 0);
          return c.toDataURL("image/jpeg", 0.82);
        } catch {
          return null;
        }
      },
    };
    return () => { apiRef.current = null; };
  }, [gl, scene, apiRef, bowl]);
  return null;
}

/* ------------------------------------------------------------------ */
/* Composition                                                          */
/* ------------------------------------------------------------------ */
export default function Scene(props: SceneProps) {
  const {
    venue, availability, categoryColors, focus, focusKey, activeSection, seatData, selectedIds, compareIds,
    roofVisible, quality, hoverSectionCode, onSectionClick, onSectionHover, onSeatClick, apiRef, onFps,
  } = props;
  const controlsRef = useRef<any>(null);

  const seatSectionCode = focus.kind === "seat" ? focus.seat.section : activeSection;
  const hiddenSeatId = focus.kind === "seat" ? focus.seat.id : null;
  const roofOpacity = !roofVisible ? 0 : focus.kind === "section" ? 0.12 : 1;

  const seatToSection = useMemo(() => {
    const m: Record<number, string> = {};
    Object.entries(seatData).forEach(([code, d]) => d.ids.forEach((id) => (m[id] = code)));
    return m;
  }, [seatData]);

  const selectedCounts = useMemo(() => {
    const c: Record<string, number> = {};
    selectedIds.forEach((id) => { const s = seatToSection[id]; if (s) c[s] = (c[s] ?? 0) + 1; });
    return c;
  }, [selectedIds, seatToSection]);

  const markers = useMemo(() => {
    const pts: { x: number; y: number; z: number; color: string }[] = [];
    for (const [code, d] of Object.entries(seatData)) {
      if (code === seatSectionCode) continue;
      for (let i = 0; i < d.count; i++) {
        const id = d.ids[i];
        if (selectedIds.has(id)) pts.push({ x: d.x[i], y: d.y[i], z: d.z[i], color: "#ffd166" });
        else if (compareIds.has(id)) pts.push({ x: d.x[i], y: d.y[i], z: d.z[i], color: "#ff6bd6" });
      }
    }
    return pts.slice(0, 64);
  }, [seatData, selectedIds, compareIds, seatSectionCode]);

  const activeInfo = seatSectionCode ? venue.sections.find((s) => s.code === seatSectionCode) : undefined;
  const activeData = seatSectionCode ? seatData[seatSectionCode] : undefined;

  return (
    <Canvas
      camera={{ position: OVERVIEW_POS.toArray(), fov: 42, near: 0.1, far: 1400 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false }}
      onPointerMissed={() => onSectionHover(null)}
    >
      <color attach="background" args={["#0c1424"]} />
      <fog attach="fog" args={["#0c1424", 380, 1000]} />
      <hemisphereLight args={["#a9bfff", "#2a2733", 0.95]} />
      <directionalLight position={[90, 220, 70]} intensity={1.35} color="#fff1d6" />
      <directionalLight position={[-120, 90, -140]} intensity={0.35} color="#7aa2ff" />

      <mesh rotation-x={-Math.PI / 2} position={[0, -0.08, 0]}>
        <circleGeometry args={[900, 64]} />
        <meshStandardMaterial color="#121a29" roughness={1} />
      </mesh>

      <Pitch venue={venue} />
      <Apron bowl={venue.bowl} />
      <Structures bowl={venue.bowl} />
      <Shell bowl={venue.bowl} roofOpacity={roofOpacity} />
      <SectionMeshes
        venue={venue} availability={availability} categoryColors={categoryColors} selectedCounts={selectedCounts}
        activeSection={activeSection} hoverSectionCode={hoverSectionCode}
        onSectionClick={onSectionClick} onSectionHover={onSectionHover}
      />
      {activeInfo && activeData && (
        <SeatLayer
          key={activeInfo.code}
          data={activeData} section={activeInfo} availability={availability} categoryColors={categoryColors}
          selectedIds={selectedIds} compareIds={compareIds} hiddenSeatId={hiddenSeatId} onSeatClick={onSeatClick}
        />
      )}
      <Markers points={markers} />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping dampingFactor={0.08}
        minDistance={10} maxDistance={520}
        maxPolarAngle={1.47}
        rotateSpeed={0.6} zoomSpeed={0.9} panSpeed={0.7}
        target={OVERVIEW_TARGET.toArray()}
      />
      <CameraRig venue={venue} focus={focus} focusKey={focusKey} controlsRef={controlsRef} />
      <Governor quality={quality} onFps={onFps} />
      <ApiBridge apiRef={apiRef} bowl={venue.bowl} />
    </Canvas>
  );
}
