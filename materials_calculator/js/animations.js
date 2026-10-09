// Animación de fondo: bloques translúcidos con forma de ladrillo que flotan y giran despacio detrás de la tarjeta y
// hacen un leve destello cada vez que cambia el resultado. Es solo decoración: nunca bloquea ni retrasa nada de lo
// que hace la persona.
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
const BLOCKS_SMALL_SCREEN = 12;
const BLOCKS_LARGE_SCREEN = 26;

const CAMERA_FOV = 60;
const CAMERA_Z = 22;
// Cuánto más grande que la pantalla es la zona donde viven los bloques, y cuánta profundidad tiene
const FIELD_MARGIN = 1.1;
const FIELD_DEPTH = 6;

// Un ladrillo mide el doble de largo que de alto; el tamaño de cada bloque varía un poco
const BRICK_LENGTH = 2.6;
const BRICK_HEIGHT = 1.3;
const BRICK_DEPTH = 1.3;
const MIN_BLOCK_SCALE = 0.7;
const MAX_BLOCK_SCALE = 1.6;
// Velocidad de giro de cada bloque, en radianes por segundo
const MIN_SPIN = 0.05;
const MAX_SPIN = 0.2;
// Los bloques flotan: suben y bajan un poco, sin salir de su sitio
const FLOAT_AMPLITUDE = 0.9;
const MIN_FLOAT_SPEED = 0.2;
const MAX_FLOAT_SPEED = 0.5;

const BLOCK_COLOR = 0xfb923c;
const BASE_OPACITY = 0.4;
// Destello: sube a 1 al cambiar el resultado y se apaga solo, más rápido cuanto mayor es este número
const FLASH_DECAY_PER_SECOND = 3;
const FLASH_OPACITY = 0.3;
const FLASH_GROWTH = 0.25;
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

// Destello breve de los bloques. Sin escena o con movimiento reducido no hace nada.
export function flash_scene() {
  if (scene_state) scene_state.flash();
}

// Textura de cada cara: un velo tenue con el borde marcado, para que el bloque se lea como un ladrillo de vidrio.
function make_block_texture(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  context.fillStyle = "rgba(255, 255, 255, 0.14)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(255, 255, 255, 0.85)";
  context.lineWidth = 3;
  context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function random_between(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

function build_scene(THREE, canvas) {
  const reduced_motion_query = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Los bloques son cajas de colores suaves: no necesitan suavizado de bordes.
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  camera.position.z = CAMERA_Z;

  const block_count = window.innerWidth < SMALL_SCREEN_WIDTH ? BLOCKS_SMALL_SCREEN : BLOCKS_LARGE_SCREEN;
  const blocks_data = Array.from({ length: block_count }, () => ({
    unit_x: random_between(-1, 1),
    unit_y: random_between(-1, 1),
    unit_z: random_between(-1, 1),
    scale: random_between(MIN_BLOCK_SCALE, MAX_BLOCK_SCALE),
    rotation_x: random_between(0, Math.PI * 2),
    rotation_y: random_between(0, Math.PI * 2),
    rotation_z: random_between(0, Math.PI * 2),
    spin_x: random_between(MIN_SPIN, MAX_SPIN),
    spin_y: random_between(MIN_SPIN, MAX_SPIN),
    spin_z: random_between(MIN_SPIN, MAX_SPIN),
    float_speed: random_between(MIN_FLOAT_SPEED, MAX_FLOAT_SPEED),
    phase: random_between(0, Math.PI * 2),
  }));

  // Todos los bloques se dibujan de una vez (una sola llamada).
  const material = new THREE.MeshBasicMaterial({
    map: make_block_texture(THREE),
    color: BLOCK_COLOR,
    transparent: true,
    opacity: BASE_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(BRICK_LENGTH, BRICK_HEIGHT, BRICK_DEPTH), material, block_count);
  blocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Las posiciones cambian cada cuadro: el cálculo de visibilidad por caja no sirve, así que se dibuja siempre
  blocks.frustumCulled = false;
  scene.add(blocks);

  const base_color = new THREE.Color(BLOCK_COLOR);
  const flash_color = new THREE.Color(0xffffff);
  const placeholder = new THREE.Object3D();

  let half_width = 1;
  let half_height = 1;
  let size_factor = 1;
  let frame_id = 0;
  let last_render_time = 0;
  let flash_level = 0;

  function place_blocks(time) {
    const growth = 1 + FLASH_GROWTH * flash_level;
    const float_factor = reduced_motion_query.matches ? 0 : 1;
    blocks_data.forEach((block, index) => {
      placeholder.position.set(
        block.unit_x * half_width,
        block.unit_y * half_height + Math.sin(time * block.float_speed + block.phase) * FLOAT_AMPLITUDE * float_factor * size_factor,
        block.unit_z * FIELD_DEPTH,
      );
      placeholder.rotation.set(block.rotation_x, block.rotation_y, block.rotation_z);
      placeholder.scale.setScalar(block.scale * size_factor * growth);
      placeholder.updateMatrix();
      blocks.setMatrixAt(index, placeholder.matrix);
    });
    blocks.instanceMatrix.needsUpdate = true;
  }

  function update(time, delta) {
    if (!reduced_motion_query.matches) {
      blocks_data.forEach((block) => {
        block.rotation_x += block.spin_x * delta;
        block.rotation_y += block.spin_y * delta;
        block.rotation_z += block.spin_z * delta;
      });
    }

    flash_level *= Math.exp(-FLASH_DECAY_PER_SECOND * delta);
    if (flash_level < 0.002) flash_level = 0;
    material.opacity = BASE_OPACITY + FLASH_OPACITY * flash_level;
    material.color.copy(base_color).lerp(flash_color, flash_level * FLASH_WHITENING);
    place_blocks(time);
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
    // En pantallas estrechas los bloques se achican en proporción, para que no tapen todo el fondo
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
