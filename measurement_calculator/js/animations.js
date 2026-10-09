// Animación de fondo: anillos con marcas finas, como diales de medición o el borde de una regla, que giran y suben
// despacio detrás de la tarjeta y hacen un leve destello cada vez que cambia el resultado. Es solo decoración:
// nunca bloquea ni retrasa nada de lo que hace la persona.
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
const DIALS_SMALL_SCREEN = 4;
const DIALS_LARGE_SCREEN = 7;

const CAMERA_FOV = 60;
const CAMERA_Z = 22;
// Cuánto más grande que la pantalla es la zona donde viven los diales, y cuánta profundidad tiene
const FIELD_MARGIN = 1.1;
const FIELD_DEPTH = 6;
// Tamaño de un dial (radio en unidades de la escena) y su velocidad de giro y de subida
const MIN_DIAL_RADIUS = 2.5;
const MAX_DIAL_RADIUS = 6;
const MIN_SPIN = 0.04;
const MAX_SPIN = 0.14;
const MAX_TILT = 0.55;
const MIN_DRIFT = 0.008;
const MAX_DRIFT = 0.025;
// Un dial sube hasta salir por arriba (un poco más allá del borde, para que no desaparezca a la vista) y vuelve por abajo
const WRAP_LIMIT = 1.25;

// Las marcas: cada 6 grados una corta y cada 30 una larga
const RING_SEGMENTS = 120;
const TICK_COUNT = 60;
const LONG_TICK_EVERY = 5;
const SHORT_TICK_LENGTH = 0.06;
const LONG_TICK_LENGTH = 0.13;

const DIAL_COLOR = 0x5aa9ff;
const BASE_OPACITY = 0.34;
// Destello: sube a 1 al cambiar el resultado y se apaga solo, más rápido cuanto mayor es este número
const FLASH_DECAY_PER_SECOND = 3;
const FLASH_OPACITY = 0.5;
const FLASH_SCALE = 0.05;
const FLASH_WHITENING = 0.75;
// Durante el destello los diales giran más rápido, como un dial que "salta" a la nueva medida
const FLASH_SPIN_BOOST = 1.6;

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

// Destello breve de los diales. Sin escena o con movimiento reducido no hace nada.
export function flash_scene() {
  if (scene_state) scene_state.flash();
}

// Un dial de radio 1: un anillo y las marcas hacia adentro. Todo en un solo conjunto de segmentos.
function make_dial_geometry(THREE) {
  const points = [];
  for (let index = 0; index < RING_SEGMENTS; index += 1) {
    const start_angle = (index / RING_SEGMENTS) * Math.PI * 2;
    const end_angle = ((index + 1) / RING_SEGMENTS) * Math.PI * 2;
    points.push(Math.cos(start_angle), Math.sin(start_angle), 0, Math.cos(end_angle), Math.sin(end_angle), 0);
  }
  for (let index = 0; index < TICK_COUNT; index += 1) {
    const angle = (index / TICK_COUNT) * Math.PI * 2;
    const length = index % LONG_TICK_EVERY === 0 ? LONG_TICK_LENGTH : SHORT_TICK_LENGTH;
    const inner_radius = 1 - length;
    points.push(Math.cos(angle), Math.sin(angle), 0, Math.cos(angle) * inner_radius, Math.sin(angle) * inner_radius, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

function random_between(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

function build_scene(THREE, canvas) {
  const reduced_motion_query = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Las líneas finas se ven dentadas sin suavizado. En pantallas de alta densidad ya no se nota, y ahí el
  // suavizado costaría memoria de más en los equipos justos, así que solo se activa en las de densidad normal.
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: window.devicePixelRatio < 2, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  camera.position.z = CAMERA_Z;

  const geometry = make_dial_geometry(THREE);
  const base_color = new THREE.Color(DIAL_COLOR);
  const flash_color = new THREE.Color(0xffffff);
  // Un solo material para todos los diales: así el destello los ilumina juntos con un solo cambio
  const material = new THREE.LineBasicMaterial({
    color: DIAL_COLOR,
    transparent: true,
    opacity: BASE_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  // Cada dial es un grupo (posición, inclinación y tamaño) con las líneas dentro, que son las que giran.
  // La posición se guarda en coordenadas de -1 a 1 y se convierte a la pantalla en resize().
  const dial_count = window.innerWidth < SMALL_SCREEN_WIDTH ? DIALS_SMALL_SCREEN : DIALS_LARGE_SCREEN;
  const dials = Array.from({ length: dial_count }, () => {
    const group = new THREE.Group();
    group.rotation.set(random_between(-MAX_TILT, MAX_TILT), random_between(-MAX_TILT, MAX_TILT), 0);
    const lines = new THREE.LineSegments(geometry, material);
    lines.rotation.z = random_between(0, Math.PI * 2);
    group.add(lines);
    scene.add(group);
    return {
      group,
      lines,
      unit_x: random_between(-1, 1),
      unit_y: random_between(-WRAP_LIMIT, WRAP_LIMIT),
      unit_z: random_between(-1, 1),
      radius: random_between(MIN_DIAL_RADIUS, MAX_DIAL_RADIUS),
      spin: random_between(MIN_SPIN, MAX_SPIN) * (Math.random() < 0.5 ? -1 : 1),
      drift: random_between(MIN_DRIFT, MAX_DRIFT),
      base_scale: 1,
    };
  });

  let half_width = 1;
  let half_height = 1;
  let frame_id = 0;
  let last_render_time = 0;
  let flash_level = 0;

  function place_dial(dial) {
    dial.group.position.set(dial.unit_x * half_width, dial.unit_y * half_height, dial.unit_z * FIELD_DEPTH);
  }

  function update(time, delta) {
    if (!reduced_motion_query.matches) {
      const spin_factor = 1 + FLASH_SPIN_BOOST * flash_level;
      dials.forEach((dial) => {
        dial.lines.rotation.z += dial.spin * spin_factor * delta;
        dial.unit_y += dial.drift * delta;
        if (dial.unit_y > WRAP_LIMIT) dial.unit_y = -WRAP_LIMIT;
        place_dial(dial);
      });
    }

    flash_level *= Math.exp(-FLASH_DECAY_PER_SECOND * delta);
    if (flash_level < 0.002) flash_level = 0;
    material.opacity = BASE_OPACITY + FLASH_OPACITY * flash_level;
    material.color.copy(base_color).lerp(flash_color, flash_level * FLASH_WHITENING);
    dials.forEach((dial) => dial.group.scale.setScalar(dial.base_scale * (1 + FLASH_SCALE * flash_level)));
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
    // En pantallas estrechas los diales se achican en proporción, para que no tapen todo el fondo
    const size_factor = Math.min(1, camera.aspect);
    dials.forEach((dial) => {
      dial.base_scale = dial.radius * size_factor;
      place_dial(dial);
    });
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
