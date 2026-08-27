try{


/* ==================================================================== *
 *  Пылевое ядро.
 *
 *  Шар с референса — не стекло и не гладкий рендер: это плотная бархатная
 *  крупа с мохнатым силуэтом и несколькими раскалёнными точками под
 *  поверхностью. Поэтому он собран из двух совмещённых слоёв:
 *
 *    1) гладкая непрозрачная сфера — она пишет глубину и не даёт видеть
 *       изнанку;
 *    2) облако из десятков тысяч точек чуть выше её поверхности — оно даёт
 *       зернистость и тот самый пушистый край, вылезающий за силуэт.
 *
 *  Оба слоя красит одна и та же функция surfaceColor из общего куска GLSL,
 *  иначе крупа «поплывёт» по цвету относительно основы.
 * ==================================================================== */

const CONFIG = {
  dustCount:     46000,   // крупа на поверхности; главный расход кадра
  ringCount:     15000,
  sparkleCount:    200,
  starCount:       420,
  maxPixelRatio:     2,
  cameraZ:         6.1,
  cameraZScrolled: 10.4,
  dragSensitivity: 0.0055,
  inertiaDamping:  0.94,
  followDamping:   0.08,
  autoSpin:        0.045
};

const stage = document.getElementById('stage');
const hint  = null;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, powerPreference:'high-performance' });
renderer.setClearColor(0x000000, 0);
stage.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
camera.position.set(0, 0, CONFIG.cameraZ);

const world = new THREE.Group();
// подъём сцены равен подъёму кольца вокруг девушки: asin(108/424)
const RING_ELEV = 0.2577;
world.rotation.x = RING_ELEV;
scene.add(world);

// Ядро держим отдельной группой: так его можно масштабировать целиком,
// не трогая кольцо и ауру.
const core = new THREE.Group();
world.add(core);

/* ------------------------------------------------------------------ *
 *  Общий GLSL: шум + функция окраски поверхности.
 *  Подставляется и в сферу, и в крупу — один источник правды по цвету.
 * ------------------------------------------------------------------ */
const NOISE_GLSL = `
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

const SURFACE_GLSL = `
#define SPOTS 6
uniform vec4  uSpots[SPOTS];   // xyz — направление точки, w — текущая яркость
uniform float uSpotSharp[SPOTS]; // резкость: больше значение — компактнее пятно
uniform vec3 uLit;             // цвет освещённой стороны
uniform vec3 uShadow;          // цвет теневой стороны
uniform vec3 uWarm;            // тёплый пыльный подмес на отвороте
uniform vec3 uHot;             // цвет раскалённых точек
uniform vec3 uLightDir;
uniform vec3 uRim;             // холодная подсветка силуэта

// Ободок отделяет шар от фона и даёт тот самый голубоватый край.
vec3 rimColor(vec3 worldNrm, vec3 viewDir){
  float f = pow(1.0 - clamp(dot(worldNrm, viewDir), 0.0, 1.0), 3.2);
  return uRim * f * 1.35;
}

// nrm — нормаль в системе шара, она же направление точки на сфере.
vec3 surfaceColor(vec3 nrm){
  // Полуламберт: у пылевой поверхности нет резкой границы света и тени.
  float lam  = dot(nrm, uLightDir) * 0.5 + 0.5;
  float turn = dot(nrm, normalize(vec3(0.72, 0.05, -0.42))) * 0.5 + 0.5;

  vec3 col = mix(uShadow, uLit, smoothstep(0.30, 1.00, lam));
  col = mix(col, uWarm, smoothstep(0.30, 1.0, turn) * 0.85);

  // Два масштаба шума: крупные пылевые поля и мелкая бархатная крупа.
  col *= 0.93 + snoise(nrm * 2.7) * 0.12;
  col *= 0.88 + (snoise(nrm * 46.0) * 0.5 + 0.5) * 0.26;

  // Раскалённые точки под поверхностью: тёплое ядро плюс белый пересвет.
  for (int i = 0; i < SPOTS; i++){
    float d = distance(nrm, uSpots[i].xyz);
    float g = exp(-d * d * uSpotSharp[i]) * uSpots[i].w;
    col += uHot * g * 1.75 + vec3(1.0) * g * g * 1.3;
  }
  return col;
}
`;

/* ------------------------------------------------------------------ *
 *  Раскалённые точки. Живут в системе координат шара, поэтому при
 *  вращении честно уезжают за горизонт, а не скользят по картинке.
 * ------------------------------------------------------------------ */
function sphereDir(theta, phi){
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta)
  );
}

// theta около pi/2 держит точку на обращённой к камере половине;
// phi задаёт высоту. Раскладка повторяет расстановку пятен на референсе.
const SPOT_SEEDS = [
  { dir: sphereDir(2.55, 0.82), base: 0.62, speed: 0.55, sharp:  70 },  // бледное вверху слева
  { dir: sphereDir(2.05, 1.05), base: 1.00, speed: 0.41, sharp:  95 },  // главное, с ореолом
  { dir: sphereDir(1.28, 1.44), base: 0.90, speed: 0.63, sharp: 130 },  // правая группа: три рядом
  { dir: sphereDir(1.12, 1.62), base: 0.70, speed: 0.34, sharp: 190 },
  { dir: sphereDir(1.42, 1.66), base: 0.55, speed: 0.72, sharp: 220 },
  { dir: sphereDir(2.30, 1.95), base: 0.34, speed: 0.49, sharp: 150 }   // слабое внизу
];

const spotUniform = SPOT_SEEDS.map(s => new THREE.Vector4(s.dir.x, s.dir.y, s.dir.z, s.base));

const surfaceUniforms = {
  uSpots:     { value: spotUniform },
  uSpotSharp: { value: SPOT_SEEDS.map(s => s.sharp) },
  uLit:      { value: new THREE.Color('#ffffff') },
  uShadow:   { value: new THREE.Color('#cfc7dc') },
  uWarm:     { value: new THREE.Color('#ded0cb') },
  uHot:      { value: new THREE.Color('#ffb98a') },
  uLightDir: { value: new THREE.Vector3(-0.74, 0.46, 0.50).normalize() },
  uRim:      { value: new THREE.Color('#bcd4ff') }
};

/* ------------------------------------------------------------------ *
 *  Слой 1. Гладкая непрозрачная основа.
 *  Её задача — писать глубину: без неё сквозь крупу просвечивает изнанка
 *  шара и объём разваливается.
 * ------------------------------------------------------------------ */
const body = new THREE.Mesh(
  new THREE.SphereGeometry(0.985, 128, 128),
  new THREE.ShaderMaterial({
    uniforms: surfaceUniforms,
    vertexShader: `
      varying vec3 vNrm;
      varying vec3 vWorldNrm;
      varying vec3 vView;
      void main(){
        vNrm = normalize(position);
        vWorldNrm = normalize(normalMatrix * vNrm);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: NOISE_GLSL + SURFACE_GLSL + `
      varying vec3 vNrm;
      varying vec3 vWorldNrm;
      varying vec3 vView;
      void main(){
        vec3 col = surfaceColor(normalize(vNrm));
        col += rimColor(normalize(vWorldNrm), normalize(vView));
        gl_FragColor = vec4(col, 1.0);
      }
    `
  })
);
body.renderOrder = 0;
core.add(body);

/* ------------------------------------------------------------------ *
 *  Слой 2. Бархатная крупа.
 *
 *  Точки сидят чуть выше поверхности и проходят тест глубины по основе:
 *  видна только крупа лицевой половины плюс та, что вылезает за силуэт —
 *  она и даёт мохнатый край. Цвет считается один раз на точку в вершинном
 *  шейдере, поэтому 85 тысяч частиц обходятся дёшево.
 * ------------------------------------------------------------------ */
function fibonacciSphere(n, out){
  // Спираль Фибоначчи распределяет точки равномерно, без сгущения у полюсов.
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++){
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(1 - y * y, 0));
    const th = golden * i;
    out[i*3+0] = Math.cos(th) * r;
    out[i*3+1] = y;
    out[i*3+2] = Math.sin(th) * r;
  }
  return out;
}

const D = CONFIG.dustCount;
const dustPos   = fibonacciSphere(D, new Float32Array(D * 3));
const dustLift  = new Float32Array(D);
const dustScale = new Float32Array(D);

for (let i = 0; i < D; i++){
  // Ворс неравномерный: большинство частиц лежит почти на поверхности,
  // меньшинство торчит наружу — из них и складывается пушистая кромка.
  const lift = Math.pow(Math.random(), 1.7);
  dustLift[i]  = 1.0 + lift * 0.098;   // ворс до 7.5% радиуса
  dustScale[i] = 0.55 + Math.random() * 0.95;

  // Лёгкий разброс по направлению, иначе спираль читается узором.
  const j = i * 3;
  dustPos[j+0] += (Math.random() - 0.5) * 0.012;
  dustPos[j+1] += (Math.random() - 0.5) * 0.012;
  dustPos[j+2] += (Math.random() - 0.5) * 0.012;
}

const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
dustGeo.setAttribute('aLift',    new THREE.BufferAttribute(dustLift, 1));
dustGeo.setAttribute('aScale',   new THREE.BufferAttribute(dustScale, 1));

function radialTexture(stops, size){
  size = size || 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const softDot = radialTexture([
  [0.0,  'rgba(255,255,255,1)'],
  [0.45, 'rgba(255,255,255,0.72)'],
  [1.0,  'rgba(255,255,255,0)']
]);

const dustUniforms = Object.assign({}, surfaceUniforms, {
  uSize: { value: 11.0 },
  uDPR:  { value: 1 },
  uMap:  { value: softDot }
});

const dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
  uniforms: dustUniforms,
  transparent: true,
  depthTest: true,
  depthWrite: false,
  vertexShader: NOISE_GLSL + SURFACE_GLSL + `
    uniform float uSize;
    uniform float uDPR;
    attribute float aLift;
    attribute float aScale;
    varying vec3 vColor;
    varying float vAlpha;
    void main(){
      vec3 nrm = normalize(position);
      vec4 mv = modelViewMatrix * vec4(nrm * aLift, 1.0);
      vColor = surfaceColor(nrm) + rimColor(normalize(normalMatrix * nrm), normalize(-mv.xyz));

      gl_Position = projectionMatrix * mv;
      // Частицы ворса тем мельче, чем выше они торчат — край получается мягким.
      gl_PointSize = uSize * aScale * uDPR * (1.35 - (aLift - 1.0) / 0.098 * 0.55) / max(-mv.z, 0.001);

      // Чем выше приподнята частица, тем она прозрачнее: ворс должен
      // растворяться наружу, а не обрываться жёсткой каймой.
      vAlpha = mix(0.98, 0.20, pow((aLift - 1.0) / 0.098, 0.75));
    }
  `,
  fragmentShader: `
    uniform sampler2D uMap;
    varying vec3 vColor;
    varying float vAlpha;
    void main(){
      float a = texture2D(uMap, gl_PointCoord).a;
      if (a < 0.02) discard;
      gl_FragColor = vec4(vColor, a * vAlpha);
    }
  `
}));
dust.renderOrder = 1;
core.add(dust);

/* ------------------------------------------------------------------ *
 *  Свечение раскалённых точек, выходящее за силуэт.
 *  Шейдер рисует их только на поверхности; ореол, переваливающий через
 *  край шара, добавляют отдельные аддитивные спрайты.
 * ------------------------------------------------------------------ */
const glowTex = radialTexture([
  [0.00, 'rgba(255,228,196,0.95)'],
  [0.22, 'rgba(255,150,90,0.50)'],
  [0.55, 'rgba(214,132,150,0.16)'],
  [1.00, 'rgba(214,132,150,0)']
], 256);

const spotSprites = SPOT_SEEDS.map(seed => {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false, transparent: true
  }));
  sp.position.copy(seed.dir);
  sp.renderOrder = 6;
  core.add(sp);
  return sp;
});

/* ------------------------------------------------------------------ *
 *  Холодная аура по краю. На референсе шар подсвечен сзади голубым,
 *  и этот ободок выходит за пределы силуэта.
 * ------------------------------------------------------------------ */
const auraTex = radialTexture([
  [0.00, 'rgba(255,255,255,0)'],
  [0.755,'rgba(255,255,255,0)'],
  [0.812,'rgba(186,212,255,0.34)'],
  [0.855,'rgba(214,204,255,0.11)'],
  [1.00, 'rgba(214,204,255,0)']
], 512);

const aura = new THREE.Sprite(new THREE.SpriteMaterial({
  map: auraTex, blending: THREE.AdditiveBlending,
  depthWrite: false, depthTest: false, transparent: true, opacity: 0.28
}));
aura.scale.set(2.55, 2.55, 1);
aura.renderOrder = -1;
scene.add(aura);   // в сцене, а не в world: аура не вращается вместе с шаром

/* ------------------------------------------------------------------ *
 *  Искры на поверхности — редкие холодные точки, они мерцают.
 * ------------------------------------------------------------------ */
const S = CONFIG.sparkleCount;
const sparkPos   = new Float32Array(S * 3);
const sparkPhase = new Float32Array(S);
const sparkCol   = new Float32Array(S * 3);
const cCool = new THREE.Color('#9fc4ff');
const cWarm = new THREE.Color('#ffc4d6');
const cTmp  = new THREE.Color();

for (let i = 0; i < S; i++){
  const th = Math.random() * Math.PI * 2;
  const ph = Math.acos(2 * Math.random() - 1);
  const d = sphereDir(th, ph).multiplyScalar(1.012);
  sparkPos[i*3+0] = d.x; sparkPos[i*3+1] = d.y; sparkPos[i*3+2] = d.z;
  sparkPhase[i] = Math.random() * Math.PI * 2;
  cTmp.copy(Math.random() > 0.45 ? cCool : cWarm);
  sparkCol[i*3+0] = cTmp.r; sparkCol[i*3+1] = cTmp.g; sparkCol[i*3+2] = cTmp.b;
}

const sparkGeo = new THREE.BufferGeometry();
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
sparkGeo.setAttribute('aPhase',   new THREE.BufferAttribute(sparkPhase, 1));
sparkGeo.setAttribute('aColor',   new THREE.BufferAttribute(sparkCol, 3));

const sparkUniforms = { uTime:{value:0}, uDPR:{value:1}, uMap:{value:softDot}, uSize:{value:26.0} };

const sparkles = new THREE.Points(sparkGeo, new THREE.ShaderMaterial({
  uniforms: sparkUniforms,
  transparent: true, depthWrite: false, depthTest: true,
  blending: THREE.AdditiveBlending,
  vertexShader: `
    uniform float uTime; uniform float uDPR; uniform float uSize;
    attribute float aPhase; attribute vec3 aColor;
    varying vec3 vColor; varying float vAlpha;
    void main(){
      vColor = aColor;
      float tw = 0.35 + 0.65 * pow(sin(uTime * 1.6 + aPhase) * 0.5 + 0.5, 3.0);
      vAlpha = tw;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uSize * uDPR * tw / max(-mv.z, 0.001);
    }
  `,
  fragmentShader: `
    uniform sampler2D uMap;
    varying vec3 vColor; varying float vAlpha;
    void main(){
      float a = texture2D(uMap, gl_PointCoord).a;
      if (a < 0.02) discard;
      gl_FragColor = vec4(vColor, a * vAlpha);
    }
  `
}));
sparkles.renderOrder = 2;
core.add(sparkles);



/* ------------------------------------------------------------------ *
 *  Кольцо. На референсе оно тонкое, тёплое и обязательно уходит за шар
 *  сверху — поэтому частицы проходят тест глубины и честно скрываются.
 * ------------------------------------------------------------------ */
// кольцо планеты и кольцо с надписью вокруг девушки крутятся синхронно:
// суммарная угловая скорость кольца = автоповорот сцены + собственная
const RING_OMEGA = -(0.115 - CONFIG.autoSpin);

const R = CONFIG.ringCount;
const ringGeo = new THREE.BufferGeometry();
const rPos = new Float32Array(R * 3);
const rRad = new Float32Array(R);
const rAng = new Float32Array(R);
const rSpd = new Float32Array(R);
const rScl = new Float32Array(R);
const rCol = new Float32Array(R * 3);

const ringWarm = new THREE.Color('#ffd9b8');
const ringPale = new THREE.Color('#f0e6ff');

for (let i = 0; i < R; i++){
  // Широкий диск: плотность выше у внутреннего края, поэтому кольцо
  // читается как диск, а не как труба.
  const t = Math.pow(Math.random(), 0.65);
  const radius = 1.55 + t * 0.80;
  const thick  = (1 - t) * 0.05 + 0.008;

  rRad[i] = radius;
  rAng[i] = Math.random() * Math.PI * 2;
  rSpd[i] = RING_OMEGA;   // жёсткое кольцо, в такт с надписью вокруг девушки
  rScl[i] = 0.35 + Math.random() * 0.85;
  rPos[i*3+1] = (Math.random() - 0.5) * thick * 2.4;

  cTmp.copy(ringWarm).lerp(ringPale, Math.random() * 0.7);
  rCol[i*3+0] = cTmp.r; rCol[i*3+1] = cTmp.g; rCol[i*3+2] = cTmp.b;
}

ringGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
ringGeo.setAttribute('aRadius',  new THREE.BufferAttribute(rRad, 1));
ringGeo.setAttribute('aAngle',   new THREE.BufferAttribute(rAng, 1));
ringGeo.setAttribute('aSpeed',   new THREE.BufferAttribute(rSpd, 1));
ringGeo.setAttribute('aScale',   new THREE.BufferAttribute(rScl, 1));
ringGeo.setAttribute('aColor',   new THREE.BufferAttribute(rCol, 3));

const ringUniforms = {
  uTime:{value:0}, uDPR:{value:1}, uSize:{value:24.0}, uSpread:{value:1}, uMap:{value:softDot}
};

const ring = new THREE.Points(ringGeo, new THREE.ShaderMaterial({
  uniforms: ringUniforms,
  transparent: true, depthWrite: false, depthTest: true,
  blending: THREE.AdditiveBlending,
  vertexShader: `
    uniform float uTime; uniform float uDPR; uniform float uSize; uniform float uSpread;
    attribute float aRadius; attribute float aAngle; attribute float aSpeed; attribute float aScale;
    attribute vec3 aColor;
    varying vec3 vColor; varying float vAlpha;
    void main(){
      float ang = aAngle + uTime * aSpeed;
      float r = aRadius * uSpread;
      vec3 p = vec3(cos(ang) * r, position.y, sin(ang) * r);
      vColor = aColor;
      // Вспышка на одном участке орбиты — на референсе кольцо ярче слева.
      float flare = 1.0 + 1.6 * pow(max(cos(ang - 2.5), 0.0), 6.0);
      vAlpha = 0.44 * flare * smoothstep(2.52, 1.66, aRadius) * smoothstep(1.44, 1.70, aRadius);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uSize * aScale * uDPR / max(-mv.z, 0.001);
    }
  `,
  fragmentShader: `
    uniform sampler2D uMap;
    varying vec3 vColor; varying float vAlpha;
    void main(){
      float a = texture2D(uMap, gl_PointCoord).a;
      if (a < 0.02) discard;
      gl_FragColor = vec4(vColor, a * vAlpha);
    }
  `
}));
ring.rotation.z = 0.2443;   // тот же крен, что у надписи
ring.rotation.x = 0.0;   // орбита не должна смотреть строго с ребра, иначе сливается в полосу   // наклон орбиты как на референсе
ring.renderOrder = 3;
world.add(ring);

/* ------------------------------------------------------------------ *
 *  Дальние искры для глубины
 * ------------------------------------------------------------------ */
const starGeo = new THREE.BufferGeometry();
const stPos = new Float32Array(CONFIG.starCount * 3);
for (let i = 0; i < CONFIG.starCount; i++){
  const r = 8 + Math.random() * 16;
  const th = Math.random() * Math.PI * 2;
  const ph = Math.acos(2 * Math.random() - 1);
  stPos[i*3+0] = r * Math.sin(ph) * Math.cos(th);
  stPos[i*3+1] = r * Math.cos(ph) * 0.6;
  stPos[i*3+2] = r * Math.sin(ph) * Math.sin(th);
}
starGeo.setAttribute('position', new THREE.BufferAttribute(stPos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
  size: 0.03, map: softDot, transparent: true, depthWrite: false,
  blending: THREE.AdditiveBlending, color: 0xd6dcff, opacity: 0.5, sizeAttenuation: true
}));
scene.add(stars);

/* ------------------------------------------------------------------ *
 *  Ввод: перетаскивание с инерцией и параллакс от курсора
 * ------------------------------------------------------------------ */
const spin = { x:0, y:0, vx:0, vy:0 };
const pointer = { x:0, y:0, tx:0, ty:0 };
let dragging = false, lastX = 0, lastY = 0;

window.addEventListener('pointerdown', e => {
  // #stage is pointer-events:none, so the gesture is caught on window;
  // ignore presses that start on real UI (links, buttons, inputs, scrollable strips)
  if (e.pointerType === 'touch') return;              // палец оставляем скроллу страницы
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const el = e.target instanceof Element ? e.target : null;
  if (el && el.closest('a, button, summary, input, textarea, select, label, .tabs, .tbl-scroll')) return;
  dragging = true;
  stage.classList.add('dragging');
  lastX = e.clientX; lastY = e.clientY;
});

window.addEventListener('pointermove', e => {
  pointer.tx = (e.clientX / window.innerWidth  - 0.5) * 2;
  pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2;
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  spin.vy = dx * CONFIG.dragSensitivity;
  spin.vx = dy * CONFIG.dragSensitivity;
  spin.y += spin.vy;
  spin.x = Math.max(-0.7, Math.min(0.7, spin.x + spin.vx));
  hideHint();
}, { passive:true });

function endDrag(e){
  dragging = false;
  stage.classList.remove('dragging');
  
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

/* ------------------------------------------------------------------ *
 *  Скролл
 * ------------------------------------------------------------------ */
let scrollTarget = 0, scrollSmooth = 0;
function readScroll(){
  const max = Math.max(document.body.scrollHeight - window.innerHeight, 1);
  scrollTarget = Math.min(window.scrollY / max, 1);
  if (window.scrollY > 40) hideHint();
}
window.addEventListener('scroll', readScroll, { passive:true });

let hintHidden = false;
function hideHint(){ hintHidden = true; }

/* ------------------------------------------------------------------ *
 *  Размер и плотность пикселей
 * ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ *
 *  Привязка ядра к странице.
 *  Вверху страницы шар стоит ровно за изображением девушки и совпадает
 *  с ним по размеру; при скролле к следующему блоку он выезжает в центр
 *  экрана и становится вдвое крупнее, продолжая вращаться.
 * ------------------------------------------------------------------ */
const HERO_ORB = '.crystal-ring';
const CORE_ZOOM = 1.45;
const anchor = { dx: 0, dy: 0, z0: CONFIG.cameraZ, z1: CONFIG.cameraZ, span: 700 };
let coreNear = 0.26, coreFar = 0.44;
let coreP = 0;                     // сглаженный прогресс выезда
const RING_OUT = 2.35;             // внешний радиус кольца в мире

function readCoreOpacity(){
  const cs = getComputedStyle(document.documentElement);
  const a = parseFloat(cs.getPropertyValue('--core-near'));
  const b = parseFloat(cs.getPropertyValue('--core-far'));
  if (!isNaN(a)) coreNear = a;
  if (!isNaN(b)) coreFar = b;
}

function measureAnchor(){
  const w = window.innerWidth, h = window.innerHeight;
  const tan = Math.tan(camera.fov * Math.PI / 360);
  let dx = 0, dy = 0, dia = h * 0.46;
  const el = document.querySelector(HERO_ORB);
  if (el){
    const r = el.getBoundingClientRect();
    if (r.width > 40){
      dx = (r.left + r.width / 2) - w / 2;
      // положение шара в кадре, когда страница прокручена в самый верх
      dy = (r.top + window.scrollY + r.height * 0.505) - h / 2;
      dia = r.width * 0.50;               // чуть меньше шара — планета живёт внутри
    }
  }
  anchor.dx = dx;
  anchor.dy = dy;
  anchor.z0 = h / (dia * tan);
  // ниже по странице планета выходит в центр — крупнее, но так, чтобы
  // кольцо целиком помещалось в кадр
  // внешний край кольца должен совпасть с боковыми границами блоков
  const wrapEl = document.querySelector('.sec .wrap');
  const wrapW = wrapEl ? wrapEl.getBoundingClientRect().width : Math.min(w - 40, 1180);
  const diaFar = wrapW * 0.955 / RING_OUT;   // запас на размер спрайтов
  anchor.z1 = h / (Math.max(diaFar, dia * 1.02) * tan);
  anchor.span = Math.max(h * 1.55, 520);
  readCoreOpacity();
}

function resize(){
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  dustUniforms.uDPR.value = dpr;
  ringUniforms.uDPR.value = dpr;
  sparkUniforms.uDPR.value = dpr;
  world.position.x = 0;
  measureAnchor();
}
window.addEventListener('resize', resize);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureAnchor);
window.addEventListener('load', measureAnchor);
resize();
readScroll();

let visible = !document.hidden;
document.addEventListener('visibilitychange', () => {
  visible = !document.hidden;
  if (visible){ clock.getDelta(); loop(); }
});

/* ------------------------------------------------------------------ *
 *  Кадр
 * ------------------------------------------------------------------ */
const clock = new THREE.Clock();
const lerp = (a,b,t) => a + (b - a) * t;
const spotWorld = new THREE.Vector3();
const camDir = new THREE.Vector3();

function loop(){
  if (!visible) return;
  requestAnimationFrame(loop);

  clock.getDelta();
  const t = clock.elapsedTime;
  const k = CONFIG.followDamping;

  if (!dragging){
    spin.y += spin.vy;
    spin.x = Math.max(-0.7, Math.min(0.7, spin.x + spin.vx));
    spin.vy *= CONFIG.inertiaDamping;
    spin.vx *= CONFIG.inertiaDamping;
  }

  scrollSmooth = lerp(scrollSmooth, scrollTarget, k);
  pointer.x = lerp(pointer.x, pointer.tx, k);
  pointer.y = lerp(pointer.y, pointer.ty, k);
  const s = scrollSmooth;

  if (!reduceMotion){
    world.rotation.y = spin.y + t * CONFIG.autoSpin + pointer.x * 0.16;
    // угол держим постоянным — иначе кольца разъедутся по наклону
    world.rotation.x = RING_ELEV + spin.x + pointer.y * 0.02;

    // p — прогресс выезда: 0 у шара с девушкой, 1 в центре страницы
    const target = Math.min(Math.max(window.scrollY / anchor.span, 0), 1);
    coreP += (target - coreP) * 0.05;          // инерция: планета догоняет скролл
    const c = coreP;
    const e = c * c * c * (c * (c * 6 - 15) + 10);   // мягкая кривая без рывков
    camera.position.z = lerp(anchor.z0, anchor.z1, e);
    camera.position.y = 0;
    camera.lookAt(0, 0, 0);
    camera.setViewOffset(
      window.innerWidth, window.innerHeight,
      -anchor.dx * (1 - e), -anchor.dy * (1 - e),
      window.innerWidth, window.innerHeight
    );
    stage.style.opacity = (coreNear + (coreFar - coreNear) * e).toFixed(3);

    ringUniforms.uSpread.value = 1;
    ringUniforms.uTime.value = t;
    sparkUniforms.uTime.value = t;

    // Раскалённые точки дышат вразнобой — иначе поверхность выглядит мёртвой.
    for (let i = 0; i < SPOT_SEEDS.length; i++){
      const seed = SPOT_SEEDS[i];
      spotUniform[i].w = seed.base * (0.62 + 0.38 * Math.sin(t * seed.speed + i * 1.7));
    }

    stars.rotation.y = t * 0.006 + spin.y * 0.2;
  } else {
    world.rotation.y = spin.y;
    world.rotation.x = RING_ELEV + spin.x;
  }

  // Ореолы раскалённых точек гаснут, когда точка уходит за горизонт.
  world.updateMatrixWorld();
  camera.getWorldDirection(camDir);
  for (let i = 0; i < spotSprites.length; i++){
    const sp = spotSprites[i];
    spotWorld.copy(SPOT_SEEDS[i].dir).applyQuaternion(world.quaternion);
    const facing = Math.max(-spotWorld.dot(camDir), 0);
    const power = spotUniform[i].w;
    sp.material.opacity = Math.pow(facing, 2.0) * power * 0.30;
    sp.scale.setScalar((0.30 + power * 0.22) * (140 / SPOT_SEEDS[i].sharp));
  }

  aura.position.copy(world.position);
  aura.scale.setScalar(2.55 * (1 - s * 0.08));

  renderer.render(scene, camera);
}
loop();

}catch(e){ var s=document.getElementById('stage'); if(s) s.style.display='none'; }
