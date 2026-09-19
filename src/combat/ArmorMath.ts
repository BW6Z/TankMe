/**
 * Shared armor geometry & penetration math.
 *
 * Used by BOTH the projectile system (authoritative resolution) and the
 * camera/aim visualization (predicted verdict) so the indicator can never
 * disagree with the simulation.
 */
import * as THREE from 'three';
import type { Tank } from '../tank/Tank';
import type { ArmorZone } from '../config/tanks';
import { COMBAT_CONFIG } from '../config/combat';

export interface HitAnalysis {
  zone: ArmorZone;
  /** plate thickness at the struck zone (mm-equivalent rating) */
  thickness: number;
  /** impact angle in degrees between shell path and plate normal */
  angleDeg: number;
  /** line-of-sight effective armor = thickness / cos(angle) */
  effArmor: number;
  /** penetration at this range after distance falloff */
  penAtRange: number;
  /** ratio penAtRange / effArmor */
  ratio: number;
  /** 'green' | 'yellow' | 'orange' | 'red' */
  verdict: Verdict;
  /** human label of the zone, e.g. FRONT */
  zoneLabel: string;
}

export type Verdict = 'green' | 'yellow' | 'orange' | 'red';

const VERDICT_LABEL: Record<Verdict, string> = {
  green: 'LIKELY',
  yellow: 'POSSIBLE',
  orange: 'UNLIKELY',
  red: 'NO CHANCE',
};

const ZONE_LABEL: Record<ArmorZone, string> = {
  front: 'FRONT',
  side: 'SIDE',
  rear: 'REAR',
  turret: 'TURRET',
  top: 'ROOF',
  tracks: 'TRACKS',
};

const _m = new THREE.Matrix4();
const _lp = new THREE.Vector3();
const _ld = new THREE.Vector3();
const _n = new THREE.Vector3();

/** penetration after distance falloff (deterministic, no roll) */
export function penAtRange(penetration: number, flightDist: number): number {
  const p = COMBAT_CONFIG.penetration;
  const f = Math.max(p.minDistFactor, 1 - (p.lossPer100m * flightDist) / 100);
  return penetration * f;
}

export function verdictLabel(v: Verdict): string {
  return VERDICT_LABEL[v];
}

function ratioToVerdict(ratio: number): Verdict {
  const t = COMBAT_CONFIG.verdict;
  if (ratio >= t.green) return 'green';
  if (ratio >= t.yellow) return 'yellow';
  if (ratio >= t.orange) return 'orange';
  return 'red';
}

/**
 * Determine which plate a projectile traveling `worldDir` would strike at
 * `worldPoint` on `tank`, the impact angle and the effective armor.
 * `penOverride` lets the caller supply the *shooter's* penetration (the
 * camera rig passes the player's gun); default is the struck tank's own gun.
 * Pure math — no game state is modified.
 */
export function analyzeHit(
  tank: Tank,
  worldPoint: THREE.Vector3,
  worldDir: THREE.Vector3,
  flightDist: number,
  penOverride?: number,
): HitAnalysis | null {
  const v = tank.visual;
  v.root.updateMatrixWorld(true);
  _m.copy(v.root.matrixWorld).invert();

  // point & direction in hull-local space
  _lp.copy(worldPoint).applyMatrix4(_m);
  _ld.copy(worldDir).transformDirection(_m);

  const zone = pickZone(tank, _lp, _ld);
  const thickness = tank.armorAt(zone);

  // plate normal in local space → world space
  plateNormalLocal(zone, _lp, _n);
  _n.transformDirection(v.root.matrixWorld);

  // impact angle between the incoming shell and the plate normal.
  // dir points INTO the plate, normal points OUT → facing = -dot, clamped so
  // grazing hits can't produce infinite effective armor.
  const facing = Math.max(0.05, -_n.dot(_ld));
  const angleDeg = Math.acos(Math.min(1, facing)) * (180 / Math.PI);

  const effArmor = thickness / facing;
  const pen = penAtRange(penOverride ?? tank.spec.gun.penetration, flightDist);
  return {
    zone,
    thickness,
    angleDeg,
    effArmor,
    penAtRange: pen,
    ratio: pen / Math.max(1, effArmor),
    verdict: ratioToVerdict(pen / Math.max(1, effArmor)),
    zoneLabel: ZONE_LABEL[zone],
  };
}

/** which armor zone does a local-space hit at lp traveling along ld belong to */
function pickZone(tank: Tank, lp: THREE.Vector3, ld: THREE.Vector3): ArmorZone {
  const v = tank.visual;
  const trackW = tank.spec.dims.trackW;
  // turret & roof line
  if (lp.y > v.hullTopY - 0.02) {
    // steep downward strike on the upper body → roof plating
    if (ld.y < -0.62) return 'top';
    return 'turret';
  }
  // running gear — low hits on the outer edges
  if (lp.y < 0.5 && Math.abs(lp.x) > v.halfW - trackW * 1.15) return 'tracks';
  // steep downward strike on the hull deck
  if (ld.y < -0.72) return 'top';
  // hull faces by longitudinal position
  if (lp.z > v.halfL * 0.55) return 'front';
  if (lp.z < -v.halfL * 0.55) return 'rear';
  return 'side';
}

/** outward plate normal of a zone at a local hit point (local space) */
function plateNormalLocal(zone: ArmorZone, lp: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  switch (zone) {
    case 'front': return out.set(0, 0, 1);
    case 'rear': return out.set(0, 0, -1);
    case 'side': return out.set(lp.x >= 0 ? 1 : -1, 0, 0);
    case 'tracks': return out.set(lp.x >= 0 ? 1 : -1, 0, 0);
    case 'top': return out.set(0, 1, 0);
    case 'turret': {
      // radial normal around the turret ring in XZ
      out.set(lp.x, 0, lp.z);
      if (out.lengthSq() < 0.01) out.set(0, 0, 1);
      return out.normalize();
    }
  }
}

/** true when the impact angle is so bad the shell ricochets off */
export function isRicochet(analysis: HitAnalysis): boolean {
  const r = COMBAT_CONFIG.ricochet;
  if (analysis.angleDeg < r.angle) return false;
  // overmatch: a much more powerful shell does not care about bad angles
  return analysis.penAtRange < analysis.thickness * r.overmatchMult;
}
