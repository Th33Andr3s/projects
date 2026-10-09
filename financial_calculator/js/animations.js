// Animación de fondo: barras finas y translúcidas, agrupadas como pequeños gráficos de crecimiento (cada grupo sube
// en escalera), que ascienden despacio detrás de la tarjeta y hacen un leve destello cada vez que cambia el resultado.
// Es solo decoración: nunca bloquea ni retrasa nada de lo que hace la persona.
//
// Reglas de CLAUDE.md 2.10: bucle con requestAnimationFrame, tope de 30 cuadros por segundo, pixelRatio máximo
// de 2, se ajusta al tamaño de la ventana, se pausa con la pestaña oculta y, con movimiento reducido, queda
// como una imagen quieta.
//
// Three.js se carga con import() dentro de start_scene, no con un import estático arriba: si la CDN falla o el
// navegador no tiene WebGL, la calculadora sigue funcionando igual y este archivo no la rompe.

const MIN_FRAME_MILLISECONDS = 1000 / 30;
const MAX_DELTA_SECONDS = 0.1;
const MAX_PIXEL_RATIO = 2;
const SMALL_SCREEN_WIDTH = 700;
const CLUSTERS_SMALL_SCREEN = 3;
const CLUSTERS_LARGE_SCREEN = 6;
const BARS_PER_CLUSTER_SMALL_SCREEN = 5;
const BARS_PER_CLUSTER_LARGE_SCREEN = 6;

const CAMERA_FOV = 60;
const CAMERA_Z = 22;
// Cuánto más grande que la pantalla es la zona donde viven los grupos, y cuánta profundidad tiene
const FIELD_MARGIN = 1.1;
const FIELD_DEPTH = 6;

// Medidas de un grupo, en unidades de la escena: ancho y separación de las barras, y alto del grupo
const BAR_WIDTH = 0.55;
const BAR_SPACING = 1;
const MIN_CLUSTER_HEIGHT = 3;
const MAX_CLUSTER_HEIGHT = 9;
// Cuánto varía al azar la altura de cada barra respecto a la escalera perfecta
const BAR_HEIGHT_JITTER = 0.12;
// Velocidad a la que sube un grupo, como fracción del alto de la pantalla por segundo
const MIN_DRIFT = 0.008;
const MAX_DRIFT = 0.02;
// Un grupo sube hasta quedar un poco por encima del borde y vuelve a entrar desde abajo
const EDGE_MARGIN = 1.05;
// Las barras "respiran" despacio: su altura sube y baja un poco
const BREATH_AMPLITUDE = 0.08;
const BREATH_SPEED = 0.5;

const BAR_COLOR = 0x34d399;
const BASE_OPACITY = 0.85;
// Destello: sube a 1 al cambiar el resultado y se apaga solo, más rápido cuanto mayor es este número
const FLASH_DECAY_PER_SECOND = 3;
const FLASH_OPACITY = 0.15;
const FLASH_GROWTH = 0.4;
const FLASH_WHITENING = 0.6;

let scene_state = null;
let is_started = false;

// Prepara la escena en el lienzo dado. Si algo falla, no pasa nada: la página se ve y funciona sin el fondo.
export async function start_scene(canvas) {
  if (is_started || !canvas) return;
  is_started = true;
  try {
    const THREE = await import("three");
    scene_state = build_scene(THREE, canvas);
  } catch {
    scene_state = null;
  }
}

// Destello breve de las barras. Sin escena o con movimiento reducido no hace nada.
export function flash_scene() {
  if (scene_state) scene_state.flash();
}

// Textura de una barra: transparente abajo y cada vez más visible hacia arriba, con la punta más marcada.
function make_bar_texture(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, canvas.height, 0, 0);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.06)");
  gradient.addColorStop(0.9, "rgba(255, 255, 255, 0.4)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 1)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function random_between(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

function build_scene(THREE, canvas) {
  const reduced_motion_query = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Las barras son rectángulos de colores suaves: no necesitan suavizado de bordes.
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  camera.position.z = CAMERA_Z;

  const is_small = window.innerWidth < SMALL_SCREEN_WIDTH;
  const cluster_count = is_small ? CLUSTERS_SMALL_SCREEN : CLUSTERS_LARGE_SCREEN;
  const bars_per_cluster = is_small ? BARS_PER_CLUSTER_SMALL_SCREEN : BARS_PER_CLUSTER_LARGE_SCREEN;

  // Cada grupo: una escalera de barras que sube. Las barras se dibujan todas de una vez (una sola llamada).
  const clusters = Array.from({ length: cluster_count }, () => {
    const height = random_between(MIN_CLUSTER_HEIGHT, MAX_CLUSTER_HEIGHT);
    return {
      unit_x: random_between(-1, 1),
      unit_y: random_between(-EDGE_MARGIN, EDGE_MARGIN),
      unit_z: random_between(-1, 1),
      height,
      drift: random_between(MIN_DRIFT, MAX_DRIFT),
      phase: random_between(0, Math.PI * 2),
      // Altura de cada barra como fracción del grupo: una escalera con un poco de desorden
      steps: Array.from({ length: bars_per_cluster }, (_, index) => {
        const ratio = bars_per_cluster === 1 ? 1 : index / (bars_per_cluster - 1);
        return (0.25 + 0.75 * ratio ** 1.2) * (1 + random_between(-BAR_HEIGHT_JITTER, BAR_HEIGHT_JITTER));
      }),
    };
  });

  const material = new THREE.MeshBasicMaterial({
    map: make_bar_texture(THREE),
    color: BAR_COLOR,
    transparent: true,
    opacity: BASE_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const bars = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, cluster_count * bars_per_cluster);
  bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Las posiciones cambian cada cuadro: el cálculo de visibilidad por caja no sirve, así que se dibuja siempre
  bars.frustumCulled = false;
  scene.add(bars);

  const base_color = new THREE.Color(BAR_COLOR);
  const flash_color = new THREE.Color(0xffffff);
  const placeholder = new THREE.Object3D();

  let half_width = 1;
  let half_height = 1;
  let size_factor = 1;
  let frame_id = 0;
  let last_render_time = 0;
  let flash_level = 0;

  // Coloca cada barra: parada sobre la base de su grupo, con la altura de su escalón (más la respiración y el destello)
  function place_bars(time) {
    const growth = 1 + FLASH_GROWTH * flash_level;
    let index = 0;
    clusters.forEach((cluster) => {
      const breath = reduced_motion_query.matches ? 1 : 1 + BREATH_AMPLITUDE * Math.sin(time * BREATH_SPEED + cluster.phase);
      const base_x = cluster.unit_x * half_width;
      const base_y = cluster.unit_y * half_height;
      cluster.steps.forEach((step, step_index) => {
        const bar_height = cluster.height * step * breath * growth * size_factor;
        placeholder.position.set(
          base_x + (step_index - (bars_per_cluster - 1) / 2) * BAR_SPACING * size_factor,
          base_y + bar_height / 2,
          cluster.unit_z * FIELD_DEPTH,
        );
        placeholder.scale.set(BAR_WIDTH * size_factor, bar_height, 1);
        placeholder.updateMatrix();
        bars.setMatrixAt(index, placeholder.matrix);
        index += 1;
      });
    });
    bars.instanceMatrix.needsUpdate = true;
  }

  function update(time, delta) {
    if (!reduced_motion_query.matches) {
      clusters.forEach((cluster) => {
        cluster.unit_y += cluster.drift * delta;
        // Al salir por arriba, el grupo vuelve a entrar desde abajo: empieza con la punta justo bajo el borde, así no aparece de golpe
        if (cluster.unit_y > EDGE_MARGIN) cluster.unit_y = -EDGE_MARGIN - (cluster.height * size_factor * (1 + FLASH_GROWTH)) / half_height;
      });
    }

    flash_level *= Math.exp(-FLASH_DECAY_PER_SECOND * delta);
    if (flash_level < 0.002) flash_level = 0;
    material.opacity = BASE_OPACITY + FLASH_OPACITY * flash_level;
    material.color.copy(base_color).lerp(flash_color, flash_level * FLASH_WHITENING);
    place_bars(time);
  }

  function render_frame(time, delta) {
    update(time, delta);
    renderer.render(scene, camera);
  }

  // Con movimiento reducido se dibuja un solo cuadro quieto.
  function render_once() {
    render_frame(1.5, 0);
  }

  function frame(now) {
    frame_id = requestAnimationFrame(frame);
    // Se salta el cuadro si todavía no toca: así la animación corre a 30 cuadros por segundo como máximo.
    const interval = now - last_render_time;
    if (interval < MIN_FRAME_MILLISECONDS - 2) return;
    last_render_time = now;
    render_frame(now / 1000, Math.min(interval / 1000, MAX_DELTA_SECONDS));
  }

  function start_loop() {
    if (frame_id || document.hidden || reduced_motion_query.matches) return;
    last_render_time = performance.now();
    frame_id = requestAnimationFrame(frame);
  }

  function stop_loop() {
    cancelAnimationFrame(frame_id);
    frame_id = 0;
  }

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    half_height = Math.tan((CAMERA_FOV * Math.PI) / 360) * CAMERA_Z * FIELD_MARGIN;
    half_width = half_height * camera.aspect;
    // En pantallas estrechas los grupos se achican en proporción, para que no tapen todo el fondo
    size_factor = Math.min(1, camera.aspect);
    // Si el bucle no está corriendo (movimiento reducido), se redibuja una vez con el nuevo tamaño.
    if (!frame_id) render_once();
  }

  // Si el navegador pierde el contexto gráfico (memoria, cambio de tarjeta), se pausa y se retoma al volver.
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    stop_loop();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    resize();
    start_loop();
  });

  window.addEventListener("resize", resize);
  // Pausa al ocultar la pestaña para no gastar batería.
  document.addEventListener("visibilitychange", () => (document.hidden ? stop_loop() : start_loop()));
  reduced_motion_query.addEventListener("change", () => {
    if (reduced_motion_query.matches) {
      stop_loop();
      render_once();
    } else {
      start_loop();
    }
  });

  resize();
  start_loop();

  return {
    flash() {
      if (reduced_motion_query.matches) return;
      flash_level = 1;
      start_loop();
    },
  };
}
