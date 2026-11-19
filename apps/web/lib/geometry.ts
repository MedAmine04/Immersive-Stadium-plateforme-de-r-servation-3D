import * as THREE from "three";
import type { BowlSpec, SectionInfo, TierSpec } from "./types";

const D2R = Math.PI / 180;

/** Repère : Y vertical, terrain dans le plan XZ, +X = Est, +Z = Sud. Identique au générateur côté serveur. */
export function ringParams(bowl: BowlSpec, d: number) {
  const HW = bowl.pitch.width / 2, HL = bowl.pitch.length / 2;
  const a = HW + d, b = HL + d;
  const r = Math.min(bowl.corner.r0 + bowl.corner.k * d, a - 1, b - 1);
  return { a, b, r };
}

/** Point (x, z) de l'anneau décalé de d mètres, à l'angle polaire phi (degrés) depuis le centre du terrain. */
export function ringPointAtPhi(bowl: BowlSpec, d: number, phiDeg: number): [number, number] {
  const { a, b, r } = ringParams(bowl, d);
  const t = phiDeg * D2R;
  const ux = Math.cos(t), uz = Math.sin(t);
  const ax = Math.abs(ux), az = Math.abs(uz);
  let tt = Math.min(ax > 1e-9 ? a / ax : Infinity, az > 1e-9 ? b / az : Infinity);
  let px = ux * tt, pz = uz * tt;
  if (Math.abs(px) > a - r + 1e-9 && Math.abs(pz) > b - r + 1e-9) {
    const cx = Math.sign(ux) * (a - r), cz = Math.sign(uz) * (b - r);
    const dot = ux * cx + uz * cz;
    const c2 = cx * cx + cz * cz;
    tt = dot + Math.sqrt(Math.max(dot * dot - (c2 - r * r), 0));
    px = ux * tt; pz = uz * tt;
  }
  return [px, pz];
}

export function unwrapRange(p0: number, p1: number): [number, number] {
  let a = ((p0 % 360) + 360) % 360, b = ((p1 % 360) + 360) % 360;
  if (b <= a) b += 360;
  return [a, b];
}

type Pt = [number, number]; // (d, y)

/** Ruban 3D balayé sur [phi0, phi1] suivant un profil (d, y). Triangles non indexés (ombrage plat). */
export function buildRibbon(bowl: BowlSpec, phi0: number, phi1: number, profile: Pt[], step = 1, opts?: { jitter?: (k: number, j: number) => [number, number, number] }) {
  const n = Math.max(1, Math.ceil((phi1 - phi0) / step));
  const segs = profile.length - 1;
  const pos: number[] = [];
  const col: number[] = [];
  const cache: [number, number][][] = [];
  for (let k = 0; k <= n; k++) {
    const phi = phi0 + ((phi1 - phi0) * k) / n;
    cache.push(profile.map(([d]) => ringPointAtPhi(bowl, d, phi)));
  }
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < segs; j++) {
      const [x00, z00] = cache[k][j], [x01, z01] = cache[k][j + 1];
      const [x10, z10] = cache[k + 1][j], [x11, z11] = cache[k + 1][j + 1];
      const y0 = profile[j][1], y1 = profile[j + 1][1];
      pos.push(x00, y0, z00, x10, y0, z10, x11, y1, z11, x00, y0, z00, x11, y1, z11, x01, y1, z01);
      if (opts?.jitter) {
        const c1 = opts.jitter(k, j * 2), c2 = opts.jitter(k, j * 2 + 1);
        for (let i = 0; i < 3; i++) col.push(...c1);
        for (let i = 0; i < 3; i++) col.push(...c2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  if (col.length) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Limites de chaque rangée (e_i) : gradin i couvre [e_i, e_{i+1}] à la hauteur y_i. */
export function tierEdges(t: TierSpec) {
  const rows = t.rows, n = rows.length;
  const h0 = n > 1 ? (rows[1].d - rows[0].d) / 2 : 0.4;
  const hN = n > 1 ? (rows[n - 1].d - rows[n - 2].d) / 2 : 0.4;
  const e: number[] = [rows[0].d - h0];
  for (let i = 1; i < n; i++) e.push((rows[i - 1].d + rows[i].d) / 2);
  e.push(rows[n - 1].d + hN);
  return e;
}

export function tierProfile(t: TierSpec): Pt[] {
  const e = tierEdges(t);
  const pts: Pt[] = [];
  t.rows.forEach((r, i) => { pts.push([e[i], r.y], [e[i + 1], r.y]); });
  return pts;
}

export function tierFor(bowl: BowlSpec, s: SectionInfo) {
  return bowl.tiers.find((t) => t.stand === s.stand && t.tier === s.tier)!;
}

/** Géométrie des gradins d'un secteur (avec un léger retrait angulaire pour matérialiser les allées). */
export function buildSectionGeometry(bowl: BowlSpec, s: SectionInfo) {
  const t = tierFor(bowl, s);
  const [p0, p1] = unwrapRange(s.phi_start, s.phi_end);
  return buildRibbon(bowl, p0 + 0.12, p1 - 0.12, tierProfile(t), 1);
}

/** Éléments de structure (murs, sous-faces, fascias) d'un niveau d'une tribune. */
export function buildTierStructure(bowl: BowlSpec, t: TierSpec) {
  const [p0, p1] = unwrapRange(t.phi_start, t.phi_end);
  const e = tierEdges(t);
  const y0 = t.rows[0].y, yN = t.rows[t.rows.length - 1].y;
  const geos: THREE.BufferGeometry[] = [];
  const slab = bowl.slab_thickness;
  // mur arrière
  geos.push(buildRibbon(bowl, p0, p1, [[e[e.length - 1], yN], [e[e.length - 1], 0]], 2));
  if (t.tier === "L") {
    geos.push(buildRibbon(bowl, p0, p1, [[e[0], 0], [e[0], y0]], 2)); // mur de bord de pelouse
  } else {
    // dalle en porte-à-faux : fascia avant + sous-face
    geos.push(buildRibbon(bowl, p0, p1, [[e[0], y0 - slab], [e[0], y0]], 2));
    geos.push(buildRibbon(bowl, p0, p1, [[e[0], y0 - slab], [e[e.length - 1], yN - slab]], 2));
  }
  return geos;
}

export function mergeGeometries(geos: THREE.BufferGeometry[]) {
  let total = 0;
  geos.forEach((g) => (total += g.getAttribute("position").count));
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  let hasCol = geos.every((g) => g.getAttribute("color"));
  const col = hasCol ? new Float32Array(total * 3) : null;
  let o = 0;
  for (const g of geos) {
    const p = g.getAttribute("position").array as Float32Array;
    const n = g.getAttribute("normal").array as Float32Array;
    pos.set(p, o * 3); nor.set(n, o * 3);
    if (col) col.set(g.getAttribute("color").array as Float32Array, o * 3);
    o += g.getAttribute("position").count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  if (col) out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return out;
}

/** Aire plane intérieure (autour du terrain) jusqu'au premier gradin. */
export function buildApron(bowl: BowlSpec, d: number) {
  const pos: number[] = [];
  for (let k = 0; k < 360; k += 2) {
    const [x0, z0] = ringPointAtPhi(bowl, d, k), [x1, z1] = ringPointAtPhi(bowl, d, k + 2);
    pos.push(0, 0, 0, x1, 0, z1, x0, 0, z0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Distance d'extrémité du toit selon l'angle (moyenne glissante pour des raccords doux entre tribunes). */
export function roofOuterD(bowl: BowlSpec, phi: number): number {
  const byStand: Record<string, number> = {};
  const ranges: Record<string, [number, number]> = {};
  for (const t of bowl.tiers) {
    const dMax = t.rows[t.rows.length - 1].d + 4;
    byStand[t.stand] = Math.max(byStand[t.stand] ?? 0, dMax);
    ranges[t.stand] = unwrapRange(t.phi_start, t.phi_end);
  }
  const at = (p: number) => {
    const q = ((p % 360) + 360) % 360;
    for (const [st, [a, b]] of Object.entries(ranges)) {
      if ((q >= a && q < b) || (q + 360 >= a && q + 360 < b)) return byStand[st];
    }
    return 50;
  };
  let sum = 0, n = 0;
  for (let dd = -7; dd <= 7; dd++) { sum += at(phi + dd); n++; }
  return sum / n;
}

export function roofY(bowl: BowlSpec, d: number) {
  return bowl.roof.lip_y + bowl.roof.slope * Math.max(d - bowl.roof.edge_d, 0);
}

export function buildRoof(bowl: BowlSpec) {
  const under: number[] = [], top: number[] = [];
  const th = 1.2;
  for (let k = 0; k < 360; k += 2) {
    const dA = roofOuterD(bowl, k), dB = roofOuterD(bowl, k + 2);
    const e = bowl.roof.edge_d;
    const a0 = ringPointAtPhi(bowl, e, k), a1 = ringPointAtPhi(bowl, e, k + 2);
    const b0 = ringPointAtPhi(bowl, dA, k), b1 = ringPointAtPhi(bowl, dB, k + 2);
    const yi = roofY(bowl, e), yA = roofY(bowl, dA), yB = roofY(bowl, dB);
    under.push(a0[0], yi, a0[1], b0[0], yA, b0[1], b1[0], yB, b1[1], a0[0], yi, a0[1], b1[0], yB, b1[1], a1[0], yi, a1[1]);
    top.push(a0[0], yi + th, a0[1], a1[0], yi + th, a1[1], b1[0], yB + th, b1[1], a0[0], yi + th, a0[1], b1[0], yB + th, b1[1], b0[0], yA + th, b0[1]);
    // chant intérieur
    top.push(a0[0], yi, a0[1], a1[0], yi, a1[1], a1[0], yi + th, a1[1], a0[0], yi, a0[1], a1[0], yi + th, a1[1], a0[0], yi + th, a0[1]);
  }
  const mk = (arr: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    return g;
  };
  return mergeGeometries([mk(under), mk(top)]);
}

/** Façade extérieure en facettes triangulaires (motif original, évoque une peau métallique doré). */
export function buildFacade(bowl: BowlSpec) {
  const rows = 9;
  const heightAt = (k: number) => roofY(bowl, roofOuterD(bowl, k)) + 1.2;
  const jitter = (() => {
    let s = 1234567;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    return () => {
      const base = 0.55 + rnd() * 0.35;
      return [base * 0.95, base * 0.78, base * 0.38] as [number, number, number];
    };
  })();
  const pos: number[] = [], col: number[] = [];
  const pt = (k: number, j: number): [number, number, number] => {
    const dOut = roofOuterD(bowl, k) + 1.5;
    const [x, z] = ringPointAtPhi(bowl, dOut, k);
    return [x, (heightAt(k) * j) / rows, z];
  };
  for (let k = 0; k < 360; k += 3) {
    for (let j = 0; j < rows; j++) {
      const A = pt(k, j), B = pt(k + 3, j), C = pt(k + 3, j + 1), D = pt(k, j + 1);
      const flip = (k / 3 + j) % 2 === 0;
      const tris = flip ? [[A, B, C], [A, C, D]] : [[A, B, D], [B, C, D]];
      for (const t of tris) {
        const c = jitter();
        for (const v of t) { pos.push(...v); col.push(...c); }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function pitchTexture(length: number, width: number) {
  const ppm = 12;
  const W = Math.round(width * ppm), H = Math.round(length * ppm);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d")!;
  const stripes = 14;
  for (let i = 0; i < stripes; i++) {
    x.fillStyle = i % 2 ? "#2f7d3a" : "#2a7035";
    x.fillRect(0, (H / stripes) * i, W, H / stripes + 1);
  }
  x.strokeStyle = "rgba(255,255,255,0.92)";
  x.lineWidth = 0.12 * ppm;
  const m = (v: number) => v * ppm;
  x.strokeRect(m(0.5), m(0.5), W - m(1), H - m(1));
  x.beginPath(); x.moveTo(0, H / 2); x.lineTo(W, H / 2); x.stroke();
  x.beginPath(); x.arc(W / 2, H / 2, m(9.15), 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.arc(W / 2, H / 2, m(0.3), 0, Math.PI * 2); x.fillStyle = "#fff"; x.fill();
  for (const top of [true, false]) {
    const yEdge = top ? 0 : H;
    const dir = top ? 1 : -1;
    x.strokeRect(W / 2 - m(20.16), top ? 0.5 * ppm : H - m(16.5) - 0.5 * ppm, m(40.32), m(16.5));
    x.strokeRect(W / 2 - m(9.16), top ? 0.5 * ppm : H - m(5.5) - 0.5 * ppm, m(18.32), m(5.5));
    x.beginPath(); x.arc(W / 2, yEdge + dir * m(11), m(0.3), 0, Math.PI * 2); x.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
