// Animación de fondo: dados translúcidos (cubos con sus puntos dibujados en cada cara) que flotan y giran despacio
// detrás de la tarjeta y hacen un leve destello con cada tirada y al copiar el resultado. Es solo decoración: nunca
// bloquea ni retrasa nada de lo que hace la persona.
//
// Reglas de CLAUDE.md 2.10: bucle con requestAnimationFrame, tope de 30 cuadros por segundo, pixelRatio máximo
// de 2, se ajusta al tamaño de la ventana, se pausa con la pestaña oculta y, con movimiento reducido, queda
// como una imagen quieta.
//
// Three.js se carga con import() dentro de start_scene, no con un import estático arriba: si la CDN falla o el
// navegador no tiene WebGL, el generador sigue funcionando igual y este archivo no lo rompe.

const MIN_FRAME_MILLISECONDS = 1000 / 30;
const MAX_DELTA_SECONDS = 0.1;
const MAX_PIXEL_RATIO = 2;
const SMALL_SCREEN_WIDTH = 700;
const DICE_SMALL_SCREEN = 4;
const DICE_LARGE_SCREEN = 8;

const CAMERA_FOV = 60;
const CAMERA_Z = 22;
// Cuánto más grande que la pantalla es la zona donde viven los dados, y cuánta profundidad tiene
const FIELD_MARGIN = 1.1;
const FIELD_DEPTH = 6;

const DIE_SIZE = 2;
const MIN_DIE_SCALE = 0.8;
const MAX_DIE_SCALE = 1.7;
// Velocidad de giro de cada dado, en radianes por segundo
const MIN_SPIN = 0.08;
const MAX_SPIN = 0.3;
// Los dados flotan: suben y bajan un poco, sin salir de su sitio
const FLOAT_AMPLITUDE = 0.9;
const MIN_FLOAT_SPEED = 0.2;
const MAX_FLOAT_SPEED = 0.5;

const DIE_COLOR = 0x34d399;
const BASE_OPACITY = 0.4;
// Destello: sube a 1 al cambiar algo y se apaga solo, más rápido cuanto mayor es este número
const FLASH_DECAY_PER_SECOND = 3;
const FLASH_OPACITY = 0.3;
const FLASH_GROWTH = 0.2;
const FLASH_WHITENING = 0.6;

// Tamaño del dibujo de cada cara, en píxeles, y sus puntos: posición (de 0 a 1) de los puntos de cada valor del dado
const FACE_TEXTURE_SIZE = 128;
const DOT_RADIUS = 11;
const FACE_MARGIN = 14;
const DOT_POSITIONS = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]],
};

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

// Destello breve de los dados. Sin escena o con movimiento reducido no hace nada.
export function flash_scene() {
  if (scene_state) scene_state.flash();
}

// Dibuja una cara de dado: el contorno redondeado, un velo muy tenue por dentro y los puntos del valor
function make_face_texture(THREE, value) {
  const canvas = document.createElement("canvas");
  canvas.width = FACE_TEXTURE_SIZE;
  canvas.height = FACE_TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  const inner = FACE_TEXTURE_SIZE - FACE_MARGIN * 2;
  context.beginPath();
  // roundRect no existe en navegadores un poco viejos: ahí la cara queda con esquinas rectas
  if (context.roundRect) context.roundRect(FACE_MARGIN, FACE_MARGIN, inner, inner, 22);
  else context.rect(FACE_MARGIN, FACE_MARGIN, inner, inner);
  context.fillStyle = "rgba(255, 255, 255, 0.12)";
  context.fill();
  context.lineWidth = 5;
  context.strokeStyle = "rgba(255, 255, 255, 0.95)";
  context.stroke();
  context.fillStyle = "rgba(255, 255, 255, 0.95)";
  DOT_POSITIONS[value].forEach(([x, y]) => {
    context.beginPath();
    context.arc(x * FACE_TEXTURE_SIZE, y * FACE_TEXTURE_SIZE, DOT_RADIUS, 0, Math.PI * 2);
    context.fill();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function random_between(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

function build_scene(THREE, canvas) {
  const reduced_motion_query = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Los dados son formas de colores suaves: no necesitan suavizado de bordes.
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  camera.position.z = CAMERA_Z;

  const dice_count = window.innerWidth < SMALL_SCREEN_WIDTH ? DICE_SMALL_SCREEN : DICE_LARGE_SCREEN;
  const geometry = new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE);

  // Las seis caras (de 1 a 6 puntos) son seis materiales que comparten todos los dados, así el destello los toca a todos
  const materials = [1, 2, 3, 4, 5, 6].map(
    (value) =>
      new THREE.MeshBasicMaterial({
        map: make_face_texture(THREE, value),
        color: DIE_COLOR,
        transparent: true,
        opacity: BASE_OPACITY,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
  );

  const dice = Array.from({ length: dice_count }, () => {
    const mesh = new THREE.Mesh(geometry, materials);
    // Las posiciones cambian cada cuadro: el cálculo de visibilidad por caja no sirve, así que se dibuja siempre
    mesh.frustumCulled = false;
    mesh.rotation.set(random_between(0, Math.PI * 2), random_between(0, Math.PI * 2), random_between(0, Math.PI * 2));
    scene.add(mesh);
    return {
      mesh,
      unit_x: random_between(-1, 1),
      unit_y: random_between(-1, 1),
      unit_z: random_between(-1, 1),
      scale: random_between(MIN_DIE_SCALE, MAX_DIE_SCALE),
      spin_x: random_between(MIN_SPIN, MAX_SPIN),
      spin_y: random_between(MIN_SPIN, MAX_SPIN),
      spin_z: random_between(MIN_SPIN, MAX_SPIN),
      float_speed: random_between(MIN_FLOAT_SPEED, MAX_FLOAT_SPEED),
      phase: random_between(0, Math.PI * 2),
    };
  });

  const base_color = new THREE.Color(DIE_COLOR);
  const flash_color = new THREE.Color(0xffffff);

  let half_width = 1;
  let half_height = 1;
  let size_factor = 1;
  let frame_id = 0;
  let last_render_time = 0;
  let flash_level = 0;

  function place_dice(time) {
    const growth = 1 + FLASH_GROWTH * flash_level;
    const float_factor = reduced_motion_query.matches ? 0 : 1;
    dice.forEach((die) => {
      die.mesh.position.set(
        die.unit_x * half_width,
        die.unit_y * half_height + Math.sin(time * die.float_speed + die.phase) * FLOAT_AMPLITUDE * float_factor * size_factor,
        die.unit_z * FIELD_DEPTH,
      );
      die.mesh.scale.setScalar(die.scale * size_factor * growth);
    });
  }

  function update(time, delta) {
    if (!reduced_motion_query.matches) {
      dice.forEach((die) => {
        die.mesh.rotation.x += die.spin_x * delta;
        die.mesh.rotation.y += die.spin_y * delta;
        die.mesh.rotation.z += die.spin_z * delta;
      });
    }

    flash_level *= Math.exp(-FLASH_DECAY_PER_SECOND * delta);
    if (flash_level < 0.002) flash_level = 0;
    materials.forEach((material) => {
      material.opacity = BASE_OPACITY + FLASH_OPACITY * flash_level;
      material.color.copy(base_color).lerp(flash_color, flash_level * FLASH_WHITENING);
    });
    place_dice(time);
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
    // En pantallas estrechas los dados se achican en proporción, para que no tapen todo el fondo
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
