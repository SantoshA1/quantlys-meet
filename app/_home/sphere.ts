// Signal sphere — the Quantlys mark (many dots converging to one) as a live
// WebGL scene. Loaded lazily after first paint; the page works without it.
//
// Budget: one Points draw call (custom shader, additive), one glossy sphere,
// one glow sprite. DPR capped, pauses offscreen / hidden tab.

import {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, BufferAttribute, Points,
  ShaderMaterial, AdditiveBlending, Mesh, SphereGeometry, PlaneGeometry, Group, Color,
} from "three";

export type SphereHandle = { dispose(): void };

const VERT = /* glsl */ `
  uniform float uTime; uniform float uPx;
  attribute vec3 aTarget; attribute vec3 aStart; attribute float aSeed;
  varying float vMix; varying float vAlpha;
  float ease(float t){ return 1.0 - pow(1.0 - clamp(t,0.0,1.0), 3.0); }
  void main(){
    float cyc = fract(uTime * (0.045 + aSeed * 0.035) + aSeed * 7.31);
    vec3 p; float mixv; float a = 1.0;
    if (cyc < 0.42) {                       // voices drift in from the dark
      float t = ease(cyc / 0.42);
      p = mix(aStart, aTarget, t);
      mixv = t * 0.6; a = smoothstep(0.0, 0.12, cyc);
    } else if (cyc < 0.86) {                // ride the surface
      p = aTarget; mixv = 0.6 + 0.2 * sin(uTime * 1.5 + aSeed * 40.0);
    } else {                                // condense into the one point
      float t = (cyc - 0.86) / 0.14;
      t = t * t;
      p = mix(aTarget, vec3(0.0, -0.05, 0.0), t);
      mixv = 1.0; a = 1.0 - smoothstep(0.75, 1.0, t);
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPx * (1.4 + aSeed * 1.6 + mixv * 1.2) * (3.2 / -mv.z);
    vMix = mixv; vAlpha = a;
  }`;
const FRAG = /* glsl */ `
  uniform vec3 uA; uniform vec3 uB;
  varying float vMix; varying float vAlpha;
  void main(){
    vec2 c = gl_PointCoord - 0.5; float d = length(c);
    float s = smoothstep(0.5, 0.0, d); s *= s;
    gl_FragColor = vec4(mix(uA, uB, vMix) * s, s * vAlpha);
  }`;
const ORB_V = /* glsl */ `
  varying vec3 vN; varying vec3 vV;
  void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const ORB_F = /* glsl */ `
  uniform vec3 uRim; varying vec3 vN; varying vec3 vV;
  void main(){
    float f = pow(1.0 - max(dot(vN, vV), 0.0), 4.0);
    vec3 L = normalize(vec3(-0.5, 0.8, 0.6));
    float spec = pow(max(dot(reflect(-L, vN), vV), 0.0), 40.0);
    vec3 base = vec3(0.012, 0.018, 0.024);
    float bounce = smoothstep(0.2, -0.9, vN.y) * 0.10;
    gl_FragColor = vec4(base + uRim * (f * 0.85 + bounce) + vec3(0.85) * spec * 0.45, 1.0);
  }`;
const GLOW_F = /* glsl */ `
  uniform vec3 uC; uniform float uI; varying vec2 vUv;
  void main(){ float d = length(vUv - 0.5) * 2.0; float g = exp(-d * d * 7.0) * uI; gl_FragColor = vec4(uC * g, g); }`;
const GLOW_V = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

export function mountSphere(canvas: HTMLCanvasElement, onFirstFrame: () => void): SphereHandle | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "low-power" });
  } catch {
    return null;
  }
  const small = Math.min(window.innerWidth, window.innerHeight) < 760;
  const dprCap = () => Math.min(window.devicePixelRatio || 1, Math.min(window.innerWidth, window.innerHeight) < 760 ? 1.5 : 1.75);
  let dpr = dprCap();
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 50);
  // Framing: the canvas is a square box (CSS --S). At this distance the dot
  // sphere (R 0.98) spans 62% of the box, leaving the rest for the glow, which
  // the CSS mask fades to nothing before the box edge — so if the box fits on
  // screen, the sphere and its glow do too.
  camera.position.set(0, 0, 0.98 / (Math.tan((16 * Math.PI) / 180) * 0.62));
  const rig = new Group();
  const spin = new Group();
  rig.add(spin);
  scene.add(rig);

  // Particles: Fibonacci sphere targets, scattered starts.
  const N = small ? 1500 : 2800;
  const target = new Float32Array(N * 3), start = new Float32Array(N * 3), seed = new Float32Array(N);
  const R = 0.98, golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i;
    target.set([Math.cos(th) * r * R, y * R, Math.sin(th) * r * R], i * 3);
    const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * 1.2, d = 2.6 + Math.random() * 3.4;
    start.set([Math.cos(a) * d, b * d * 0.55, Math.sin(a) * d * 0.6 - 0.5], i * 3);
    seed[i] = Math.random();
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(target.slice(), 3));
  g.setAttribute("aTarget", new BufferAttribute(target, 3));
  g.setAttribute("aStart", new BufferAttribute(start, 3));
  g.setAttribute("aSeed", new BufferAttribute(seed, 1));
  const pm = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPx: { value: 3.6 * dpr }, uA: { value: new Color("#8a97a8") }, uB: { value: new Color("#2DD4BF") } },
  });
  const pts = new Points(g, pm);
  pts.frustumCulled = false;
  spin.add(pts);

  const orbG = new SphereGeometry(0.86, 64, 48);
  const orbM = new ShaderMaterial({ vertexShader: ORB_V, fragmentShader: ORB_F, uniforms: { uRim: { value: new Color("#2DD4BF") } } });
  spin.add(new Mesh(orbG, orbM));

  const glowG = new PlaneGeometry(1, 1);
  const glowM = new ShaderMaterial({ vertexShader: GLOW_V, fragmentShader: GLOW_F, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
    uniforms: { uC: { value: new Color("#2DD4BF") }, uI: { value: 0.55 } } });
  const glow = new Mesh(glowG, glowM);
  glow.scale.set(4.2, 4.2, 1);
  glow.position.z = -1.5;
  glow.renderOrder = -1;
  glowM.depthTest = true;
  scene.add(glow);

  // Size
  function size() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    dpr = dprCap();
    renderer.setPixelRatio(dpr);
    // Dot size follows the box so a phone-sized sphere is not a blur of fat points.
    pm.uniforms.uPx.value = dpr * (2.1 + 1.5 * Math.min(Math.max((Math.min(w, h) - 300) / 600, 0), 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(size);
  ro.observe(canvas);
  window.addEventListener("orientationchange", size);
  size();

  // Mouse parallax
  let mx = 0, my = 0;
  const onMove = (e: PointerEvent) => { mx = (e.clientX / window.innerWidth) * 2 - 1; my = (e.clientY / window.innerHeight) * 2 - 1; };
  window.addEventListener("pointermove", onMove, { passive: true });

  // Run only when visible
  let visible = true, raf = 0, last = performance.now(), t = 0, first = true;
  const loop = (now: number) => {
    raf = 0;
    const dt = Math.min((now - last) / 1000, 0.05); last = now; t += dt;
    pm.uniforms.uTime.value = t;
    spin.rotation.y += dt * 0.08;
    rig.rotation.y += ((mx * 0.35) - rig.rotation.y) * 0.04;
    rig.rotation.x += ((my * 0.18) - rig.rotation.x) * 0.04;
    rig.position.x += ((mx * 0.12) - rig.position.x) * 0.04;
    glowM.uniforms.uI.value = 0.5 + Math.sin(t * 0.9) * 0.06;
    renderer.render(scene, camera);
    if (first) { first = false; onFirstFrame(); }
    if (visible && !document.hidden) raf = requestAnimationFrame(loop);
  };
  const kick = () => { if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(loop); } };
  const io = new IntersectionObserver((es) => { visible = es[0]?.isIntersecting ?? true; kick(); });
  io.observe(canvas);
  const onVis = () => kick();
  document.addEventListener("visibilitychange", onVis);
  kick();

  return {
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect(); ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("orientationchange", size);
      document.removeEventListener("visibilitychange", onVis);
      g.dispose(); pm.dispose(); orbG.dispose(); orbM.dispose(); glowG.dispose(); glowM.dispose();
      renderer.dispose();
    },
  };
}
