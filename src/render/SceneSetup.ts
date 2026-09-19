/**
 * Renderer, cinematic lighting, procedural sky with drifting clouds,
 * exponential-height fog and the post-processing chain
 * (bloom + filmic grade/vignette/grain + FXAA on medium+).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { QualityPreset } from '../config/quality';

const SKY_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
  }
`;
const SKY_FRAG = `
  varying vec3 vDir;
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec3 cloudColor;
  uniform float uTime;

  float hash(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.55;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = p * 2.1 + vec2(17.3, 9.1);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = clamp(dir.y, 0.0, 1.0);
    vec3 col = mix(horizonColor, topColor, pow(h, 0.5));

    // sun disc + warm glow
    float sunDot = max(dot(dir, normalize(sunDir)), 0.0);
    float disc = smoothstep(0.9993, 0.9997, sunDot);
    float glow = pow(sunDot, 24.0) * 0.35 + pow(sunDot, 5.0) * 0.12;
    col += sunColor * (disc * 3.0 + glow);

    // drifting cloud layer projected on a virtual plane
    if (dir.y > 0.02) {
      vec2 cuv = dir.xz / (dir.y + 0.22) * 1.35 + vec2(uTime * 0.006, uTime * 0.0022);
      float n = fbm(cuv * 1.4);
      float n2 = fbm(cuv * 2.8 + vec2(4.7));
      float cover = smoothstep(0.60, 0.80, n) * 0.85;
      float horizonFade = smoothstep(0.02, 0.16, dir.y);
      vec3 cloud = mix(cloudColor * 0.88, cloudColor, smoothstep(0.4, 0.9, n2));
      // silver lining toward the sun
      cloud += sunColor * pow(sunDot, 3.0) * 0.18 * cover;
      col = mix(col, cloud, cover * horizonFade);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

/** filmic grade: gentle contrast/saturation, vignette, fine grain */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.32 },
    uContrast: { value: 1.05 },
    uSaturation: { value: 1.07 },
    uTime: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uTime;
    varying vec2 vUv;
    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p + 19.19);
      return fract(p.x * p.y);
    }
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 col = (src.rgb - 0.5) * uContrast + 0.5;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, uSaturation);
      col.r *= 1.015; col.b *= 0.985; // faint warm-cool split
      vec2 d = vUv - 0.5;
      col *= 1.0 - uVignette * dot(d, d) * 2.4;
      col += (hash(vUv * 913.0 + fract(uTime)) - 0.5) * 0.016;
      gl_FragColor = vec4(col, src.a);
    }
  `,
};

export class GameScene {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;
  private preset!: QualityPreset;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private gradePass: ShaderPass | null = null;
  private fxaaPass: ShaderPass | null = null;
  private skyTime = 0;
  readonly sunDir = new THREE.Vector3(0.5, 0.72, 0.36).normalize();

  constructor(canvas: HTMLCanvasElement, preset: QualityPreset) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: preset.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.fog = new THREE.FogExp2(0xa8b4bd, preset.fogDensity);

    this.hemi = new THREE.HemisphereLight(0xbcd0e2, 0x544d38, 1.15);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe7c4, 3.4);
    this.sun.position.set(this.sunDir.x * 100, this.sunDir.y * 100, this.sunDir.z * 100);
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight(0x3c4650, 0.45));

    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x4f7cb4) },
        horizonColor: { value: new THREE.Color(0xd3d9d6) },
        sunDir: { value: this.sunDir },
        sunColor: { value: new THREE.Color(0xffe8c0) },
        cloudColor: { value: new THREE.Color(0xe8ecef) },
        uTime: { value: 0 },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(760, 32, 18), skyMat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // environment map baked from the sky — makes PBR metals read correctly
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(this.sky.geometry, skyMat);
    envScene.add(envSky);
    const envRt = pmrem.fromScene(envScene, 0.06);
    this.scene.environment = envRt.texture;
    pmrem.dispose();

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
    this.sun.shadow.normalBias = 0.5;
    cam.updateProjectionMatrix();
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      (this.sun.shadow as any).map = null;
    }
    (this.scene.fog as THREE.FogExp2).density = preset.fogDensity;
    this.rebuildComposer();
  }

  private rebuildComposer(): void {
    this.composer = null;
    this.bloomPass = null;
    this.gradePass = null;
    this.fxaaPass = null;
    if (!this.preset.postFx || !this.cameraRef) return;
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.cameraRef!));
    const bloom = new UnrealBloomPass(size, this.preset.bloomStrength, 0.45, 0.86);
    composer.addPass(bloom);
    const grade = new ShaderPass(GradeShader);
    composer.addPass(grade);
    composer.addPass(new OutputPass());
    const fxaa = new ShaderPass(FXAAShader);
    composer.addPass(fxaa);
    this.composer = composer;
    this.bloomPass = bloom;
    this.gradePass = grade;
    this.fxaaPass = fxaa;
    this.resizeComposer();
  }

  private cameraRef: THREE.Camera | null = null;
  attachCamera(camera: THREE.Camera): void {
    this.cameraRef = camera;
    this.rebuildComposer();
  }

  get quality(): QualityPreset {
    return this.preset;
  }

  /** keep the shadow frustum centered near the action */
  updateSunTarget(focus: THREE.Vector3): void {
    this.sun.position.set(focus.x + this.sunDir.x * 150, focus.y + this.sunDir.y * 150, focus.z + this.sunDir.z * 150);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    this.sky.position.set(focus.x, 0, focus.z);
  }

  /** render one frame through post if enabled */
  render(camera: THREE.Camera): void {
    this.skyTime += 0.016;
    (this.sky.material as THREE.ShaderMaterial).uniforms.uTime.value = this.skyTime;
    if (this.gradePass) this.gradePass.uniforms.uTime.value = this.skyTime;
    if (this.composer && this.cameraRef) this.composer.render();
    else this.renderer.render(this.scene, camera);
  }

  resizeComposer(): void {
    if (!this.composer) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.composer.setSize(w, h);
    if (this.fxaaPass) {
      const pr = this.renderer.getPixelRatio();
      this.fxaaPass.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    }
  }

  resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.resizeComposer();
  }
}
