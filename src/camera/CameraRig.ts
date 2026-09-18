/** Third-person tank camera with free orbit, zoom sight, collision and shake. */
import * as THREE from 'three';
import type { Tank } from '../tank/Tank';
import type { PhysicsWorld } from '../world/Physics';
import type { Input } from '../core/Input';
import type { Effects } from '../effects/Effects';
import type { Settings } from '../core/Settings';

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  yaw = Math.PI;
  pitch = 0.3;
  private dist = 13.5;
  private curFov = 56;
  aimPoint = new THREE.Vector3(0, 0, 100);
  /** enemy tank currently under the crosshair (for the target info panel) */
  aimedTarget: { tank: Tank; dist: number } | null = null;
  private time = 0;
  private showroomYaw = 0;

  constructor(
    canvasAspect: () => number,
    private physics: PhysicsWorld,
    private input: Input,
    private effects: Effects,
    private settings: Settings,
  ) {
    this.camera = new THREE.PerspectiveCamera(56, canvasAspect(), 0.3, 1100);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** cinematic showroom orbit for menu / deploy screens */
  updateShowroom(dt: number, focus: { x: number; z: number }, radius = 12.5, height = 7.2): void {
    this.time += dt;
    this.showroomYaw += dt * 0.14;
    const bobY = Math.sin(this.time * 0.45) * 0.5;
    const yaw = this.showroomYaw;
    this.camera.position.set(
      focus.x + Math.sin(yaw) * radius,
      height + bobY,
      focus.z + Math.cos(yaw) * radius,
    );
    this.camera.lookAt(focus.x, height * 0.42 + 0.6, focus.z);
    if (this.curFov !== 46) { this.curFov = 46; this.camera.fov = 46; this.camera.updateProjectionMatrix(); }
  }

  updateBattle(dt: number, tank: Tank): void {
    this.time += dt;
    const sens = this.settings.data.sensitivity * 0.0021;
    const { dx, dy } = this.input.consumeMouseDelta();
    this.yaw -= dx * sens;
    this.pitch += dy * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -0.42, 1.05);

    const zooming = this.input.buttonDown(2);
    const targetDist = zooming ? 6.2 : 13.5;
    this.dist += (targetDist - this.dist) * Math.min(1, 10 * dt);
    const targetFov = zooming ? 34 : 56;
    if (Math.abs(this.curFov - targetFov) > 0.1) {
      this.curFov += (targetFov - this.curFov) * Math.min(1, 10 * dt);
      this.camera.fov = this.curFov;
      this.camera.updateProjectionMatrix();
    }

    const pivot = _v1.copy(tank.pos);
    pivot.y += 2.5;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const off = _v2.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);

    // obstacle & terrain clamp
    let d = this.dist;
    const desired = _v3.copy(pivot).addScaledVector(off, d);
    const hit = this.physics.segmentHit(pivot, desired);
    if (hit) d = Math.max(2.2, hit.t * this.dist - 0.6);
    desired.copy(pivot).addScaledVector(off, d);
    const groundY = this.physics.heightAt(desired.x, desired.z) + 0.7;
    if (desired.y < groundY) desired.y = groundY;

    // smooth position (fast — keeps aim responsive)
    this.camera.position.lerp(desired, Math.min(1, 22 * dt));

    // shake
    const tr = this.effects.trauma;
    if (tr > 0.001) {
      const amp = tr * tr * 0.55;
      this.camera.position.x += (Math.random() - 0.5) * amp;
      this.camera.position.y += (Math.random() - 0.5) * amp;
      this.camera.position.z += (Math.random() - 0.5) * amp;
    }
    this.camera.lookAt(pivot);
    if (tr > 0.001) this.camera.rotation.z += (Math.random() - 0.5) * tr * tr * 0.05;

    // aim ray through screen center
    this.camera.getWorldDirection(_v3);
    const origin = this.camera.position;
    const maxT = 500;
    let bestT = maxT;
    const gT = this.physics.groundRay(origin, _v3, maxT);
    if (gT > 0) bestT = gT;
    const segEnd = _v1.copy(origin).addScaledVector(_v3, bestT);
    const obHit = this.physics.segmentHit(origin, segEnd);
    if (obHit) bestT = Math.min(bestT, obHit.t * origin.distanceTo(segEnd));
    // tank OBBs — remember which vehicle sits under the crosshair
    let hitTank: Tank | null = null;
    const tanks = this.tanksProvider();
    for (const t of tanks) {
      if (!t.alive || t === tank) continue;
      const tHit = rayTank(origin, _v3, t, bestT);
      if (tHit !== null && tHit < bestT) {
        bestT = tHit;
        hitTank = t;
      }
    }
    this.aimedTarget = hitTank ? { tank: hitTank, dist: bestT } : null;
    this.aimPoint.copy(origin).addScaledVector(_v3, Math.max(4, bestT - 0.5));
  }

  tanksProvider: () => Tank[] = () => [];
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _lp = new THREE.Vector3();

/** ray vs tank OBB in local space; returns distance or null */
function rayTank(origin: THREE.Vector3, dir: THREE.Vector3, tank: Tank, maxT: number): number | null {
  _m.copy(tank.visual.root.matrixWorld).invert();
  const lo = _lp.copy(origin).applyMatrix4(_m);
  const ld = _v2.copy(dir).transformDirection(_m);
  const hl = tank.visual.halfL + 0.15, hw = tank.visual.halfW + 0.15, hh = tank.visual.fullH + 0.15;
  let tmin = 0, tmax = maxT;
  const mins = [-hw, -0.4, -hl], maxs = [hw, hh, hl];
  const o = [lo.x, lo.y, lo.z], dd = [ld.x, ld.y, ld.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-9) {
      if (o[i] < mins[i] || o[i] > maxs[i]) return null;
    } else {
      let t1 = (mins[i] - o[i]) / dd[i], t2 = (maxs[i] - o[i]) / dd[i];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}
