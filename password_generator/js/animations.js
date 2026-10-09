// Animación de fondo: partículas tenues que flotan detrás de la tarjeta y hacen un leve destello cada vez que
// se genera una contraseña. Es solo decoración: nunca bloquea ni retrasa nada de lo que hace la persona.
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
const PARTICLES_SMALL_SCREEN = 70;
const PARTICLES_LARGE_SCREEN = 140;

const CAMERA_FOV = 60;
const CAMERA_Z = 22;
// Cuánto más grande que la pantalla es el campo de partículas, y cuánta profundidad tiene
const FIELD_MARGIN = 1.15;
const FIELD_DEPTH = 9;

const PARTICLE_COLOR = 0x2dd4bf;
const BASE_OPACITY = 0.5;
const BASE_SIZE = 0.45;
// Destello: sube a 1 al generar y se apaga solo, más rápido cuanto mayor es este número
const FLASH_DECAY_PER_SECOND = 3.2;
const FLASH_OPACITY = 0.4;
const FLASH_SIZE = 0.7;
const FLASH_SCALE = 0.05;
const FLASH_WHITENING = 0.7;

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

// Destello breve de las partículas. Sin escena o con movimiento reducido no hace nada.
export function flash_scene() {
  if (scene_state) scene_state.flash();
}

// Punto redondo y suave, para que las partículas parezcan luces y no cuadrados.
function make_dot_texture(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.35, "rgba(255, 255, 255, 0.45)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function build_scene(THREE, canvas) {
  const reduced_motion_query = window.matchMedia("(prefers-reduced-motion: reduce)");

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  camera.position.z = CAMERA_Z;

  // Las partículas viven en un cubo de lado 2 y el objeto se estira para cubrir la pantalla: así al cambiar el
  // tamaño de la ventana basta con cambiar la escala, sin recalcular cada posición.
  const particle_count = window.innerWidth < SMALL_SCREEN_WIDTH ? PARTICLES_SMALL_SCREEN : PARTICLES_LARGE_SCREEN;
  const positions = new Float32Array(particle_count * 3);
  const drift_speeds = new Float32Array(particle_count);
  for (let index = 0; index < particle_count; index += 1) {
    positions[index * 3] = Math.random() * 2 - 1;
    positions[index * 3 + 1] = Math.random() * 2 - 1;
    positions[index * 3 + 2] = Math.random() * 2 - 1;
    drift_speeds[index] = 0.01 + Math.random() * 0.03;
  }
  const position_attribute = new THREE.BufferAttribute(positions, 3);
  position_attribute.setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", position_attribute);

  const base_color = new THREE.Color(PARTICLE_COLOR);
  const flash_color = new THREE.Color(0xffffff);
  const material = new THREE.PointsMaterial({
    map: make_dot_texture(THREE),
    color: PARTICLE_COLOR,
    size: BASE_SIZE,
    transparent: true,
    opacity: BASE_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const field = new THREE.Points(geometry, material);
  field.frustumCulled = false;
  const group = new THREE.Group();
  group.add(field);
  scene.add(group);

  let frame_id = 0;
  let last_render_time = 0;
  let flash_level = 0;

  function update(time, delta) {
    if (!reduced_motion_query.matches) {
      // Las partículas suben despacio y, al salir por arriba, vuelven a entrar por abajo
      for (let index = 0; index < particle_count; index += 1) {
        const y_index = index * 3 + 1;
        positions[y_index] += drift_speeds[index] * delta;
        if (positions[y_index] > 1) positions[y_index] = -1;
      }
      position_attribute.needsUpdate = true;
      group.rotation.y = Math.sin(time * 0.12) * 0.22;
      group.rotation.x = Math.sin(time * 0.08) * 0.08;
    }

    flash_level *= Math.exp(-FLASH_DECAY_PER_SECOND * delta);
    if (flash_level < 0.002) flash_level = 0;
    material.opacity = BASE_OPACITY + FLASH_OPACITY * flash_level;
    material.size = BASE_SIZE * (1 + FLASH_SIZE * flash_level);
    material.color.copy(base_color).lerp(flash_color, flash_level * FLASH_WHITENING);
    group.scale.setScalar(1 + FLASH_SCALE * flash_level);
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
    const half_height = Math.tan((CAMERA_FOV * Math.PI) / 360) * CAMERA_Z;
    field.scale.set(half_height * camera.aspect * FIELD_MARGIN, half_height * FIELD_MARGIN, FIELD_DEPTH);
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
