/** Renderer, scene, lights and sky. One instance for the whole app. */
import * as THREE from 'three';
import type { QualityPreset } from '../config/quality';

const SKY_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAG = `
  varying vec3 vDir;
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  void main() {
    float h = clamp(vDir.y, 0.0, 1.0);
    vec3 col = mix(horizonColor, topColor, pow(h, 0.55));
    float sun = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 220.0);
    float glow = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 6.0) * 0.22;
    col += sunColor * (sun * 1.4 + glow);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class GameScene {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;
  private preset!: QualityPreset;
  readonly sunDir = new THREE.Vector3(0.55, 0.72, 0.42).normalize();

  constructor(canvas: HTMLCanvasElement, preset: QualityPreset) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: preset.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.fog = new THREE.Fog(0xaebdc7, 60, preset.fogFar);

    this.hemi = new THREE.HemisphereLight(0xbdd2e4, 0x57513c, 1.05);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 3.0);
    this.sun.position.set(this.sunDir.x * 100, this.sunDir.y * 100, this.sunDir.z * 100);
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight(0x404a52, 0.4));

    // sky dome
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x5c86b8) },
        horizonColor: { value: new THREE.Color(0xd7dee2) },
        sunDir: { value: this.sunDir },
        sunColor: { value: new THREE.Color(0xfff0cf) },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(760, 24, 14), skyMat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.applyQuality(preset);
  }

  applyQuality(preset: QualityPreset): void {
    this.preset = preset;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatioCap));
    this.renderer.shadowMap.enabled = preset.shadows;
    this.sun.castShadow = preset.shadows;
    this.sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -110; cam.right = 110; cam.top = 110; cam.bottom = -110;
    cam.near = 20; cam.far = 420;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    cam.updateProjectionMatrix();
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      (this.sun.shadow as any).map = null;
    }
    (this.scene.fog as THREE.Fog).far = preset.fogFar;
  }

  get quality(): QualityPreset {
    return this.preset;
  }

  /** keep the shadow frustum centered near the action */
  updateSunTarget(focus: THREE.Vector3): void {
    this.sun.position.set(focus.x + this.sunDir.x * 140, focus.y + this.sunDir.y * 140, focus.z + this.sunDir.z * 140);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    this.sky.position.set(focus.x, 0, focus.z);
  }

  resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
