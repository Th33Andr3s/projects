// Animación de fondo: cubos pequeños que flotan y giran despacio detrás de la tarjeta, se ordenan por un momento
// en una cuadrícula parecida a un código QR y vuelven a dispersarse. Hacen un leve destello cada vez que se genera
// un código. Es solo decoración: nunca bloquea ni retrasa nada de lo que hace la persona.
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

const CAMERA_FOV = 60;
const CAMERA_Z = 22;
// Cuánto más grande que la pantalla es la zona donde se dispersan los cubos, y cuánta profundidad tiene
const FIELD_MARGIN = 1.1;
const FIELD_DEPTH = 6;

// La cuadrícula parecida a un QR: tres marcos en las esquinas y módulos sueltos con un reparto fijo
const GRID_SIZE = 15;
const FINDER_SIZE = 5;
const DATA_DENSITY_SMALL_SCREEN = 0.3;
const DATA_DENSITY_LARGE_SCREEN = 0.45;
const GRID_SEED = 20260;

// Un ciclo completo: dispersos, se ordenan, se quedan ordenados un rato y se dispersan otra vez
const CYCLE_SECONDS = 24;
const ASSEMBLE_START = 0.22;
const ASSEMBLED_START = 0.42;
const ASSEMBLED_END = 0.62;
const DISPERSED_AT = 0.82;
// Cada cubo se retrasa un poco distinto, para que no lleguen todos a la vez
const STAGGER_AMOUNT = 0.45;

const MIN_SCALE = 0.45;
const MAX_SCALE = 1.1;
// Velocidad de giro de cada cubo, en radianes por segundo
const MIN_SPIN = 0.1;
const MAX_SPIN = 0.4;
// Los cubos flotan: suben y bajan un poco, sin salir de su sitio
const FLOAT_AMPLITUDE = 0.8;
const MIN_FLOAT_SPEED = 0.2;
const MAX_FLOAT_SPEED = 0.5;
// Cuánto del tamaño de una celda ocupa el cubo ya ordenado
const CELL_FILL = 0.82;

const CUBE_COLOR = 0x818cf8;
const BASE_OPACITY = 0.42;
// Destello: sube a 1 al generar un código y se apaga solo, más rápido cuanto mayor es este número
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

// Destello breve de los cubos. Sin escena o con movimiento reducido no hace nada.
export function flash_scene() {
  if (scene_state) scene_state.flash();
}

// Math.random solo da la variedad de adorno de los cubos: nada de lo que se genera depende de él
function random_between(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

// Generador pseudoaleatorio con semilla: la cuadrícula sale igual cada vez que se abre la página
function make_seeded_random(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Las celdas oscuras de la cuadrícula: coordenadas (columna, fila) con el centro de la cuadrícula en (0, 0)
function make_grid_cells(density) {
  const random = make_seeded_random(GRID_SEED);
  const cells = [];
  const last = GRID_SIZE - FINDER_SIZE;
  const half = (GRID_SIZE - 1) / 2;
  const finder_corners = [[0, 0], [last, 0], [0, last]];

  const in_finder_zone = (column, row) =>
    finder_corners.some(([x, y]) => column >= x - 1 && column <= x + FINDER_SIZE && row >= y - 1 && row <= y + FINDER_SIZE);

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let column = 0; column < GRID_SIZE; column++) {
      let is_dark;
      const corner = finder_corners.find(([x, y]) => column >= x && column < x + FINDER_SIZE && row >= y && row < y + FINDER_SIZE);
      if (corner) {
        // Marco de 5x5 con un punto en el centro
        const local_x = column - corner[0];
        const local_y = row - corner[1];
        const on_ring = local_x === 0 || local_y === 0 || local_x === FINDER_SIZE - 1 || local_y === FINDER_SIZE - 1;
        is_dark = on_ring || (local_x === 2 && local_y === 2);
      } else if (in_finder_zone(column, row)) {
        is_dark = false;
      } else {
        is_dark = random() < density;
      }
      if (is_dark) cells.push({ x: column - half, y: half - row });
    }
  }
  return cells;
}

function smoothstep(value) {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

// Qué tan ordenado está el conjunto en este instante: 0 = disperso, 1 = formando la cuadrícula
function assembled_amount(time) {
  const phase = (time % CYCLE_SECONDS) / CYCLE_SECONDS;
  if (phase < ASSEMBLE_START) return 0;
  if (phase < ASSEMBLED_START) return (phase - ASSEMBLE_START) / (ASSEMBLED_START - ASSEMBLE_START);
  if (phase < ASSEMBLED_END) return 1;
  if (phase < DISPERSED_AT) return 1 - (phase - ASSEMBLED_END) / (DISPERSED_AT - ASSEMBLED_END);
  return 0;
}

function build_scene(THREE, canvas) {
  const reduced_motion_query = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Los cubos son formas de colores suaves: no necesitan suavizado de bordes.
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  camera.position.z = CAMERA_Z;

  const is_small_screen = window.innerWidth < SMALL_SCREEN_WIDTH;
  const cells = make_grid_cells(is_small_screen ? DATA_DENSITY_SMALL_SCREEN : DATA_DENSITY_LARGE_SCREEN);

  const material = new THREE.MeshBasicMaterial({
    color: CUBE_COLOR,
    transparent: true,
    opacity: BASE_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  // Un solo InstancedMesh: todos los cubos se dibujan de una vez
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, cells.length);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const cubes = cells.map((cell) => ({
    cell,
    unit_x: random_between(-1, 1),
    unit_y: random_between(-1, 1),
    unit_z: random_between(-1, 1),
    scale: random_between(MIN_SCALE, MAX_SCALE),
    start_x: random_between(0, Math.PI * 2),
    start_y: random_between(0, Math.PI * 2),
    start_z: random_between(0, Math.PI * 2),
    spin_x: random_between(MIN_SPIN, MAX_SPIN),
    spin_y: random_between(MIN_SPIN, MAX_SPIN),
    spin_z: random_between(MIN_SPIN, MAX_SPIN),
    float_speed: random_between(MIN_FLOAT_SPEED, MAX_FLOAT_SPEED),
    phase: random_between(0, Math.PI * 2),
    stagger: random_between(0, 1),
  }));

  const base_color = new THREE.Color(CUBE_COLOR);
  const flash_color = new THREE.Color(0xffffff);
  const dummy = new THREE.Object3D();

  let half_width = 1;
  let half_height = 1;
  let size_factor = 1;
  // Dónde se arma la cuadrícula y qué tan grande es cada celda
  let grid_center_x = 0;
  let grid_center_y = 0;
  let cell_size = 1;
  let frame_id = 0;
  let last_render_time = 0;
  let flash_level = 0;

  function place_cubes(time) {
    const growth = 1 + FLASH_GROWTH * flash_level;
    const float_factor = reduced_motion_query.matches ? 0 : 1;
    const amount = assembled_amount(time);

    cubes.forEach((cube, index) => {
      // Cada cubo llega a la cuadrícula en su propio momento
      const arrival = smoothstep(amount * (1 + STAGGER_AMOUNT) - cube.stagger * STAGGER_AMOUNT);
      const scattered_x = cube.unit_x * half_width;
      const scattered_y = cube.unit_y * half_height + Math.sin(time * cube.float_speed + cube.phase) * FLOAT_AMPLITUDE * float_factor * size_factor;
      const scattered_z = cube.unit_z * FIELD_DEPTH;
      const target_x = grid_center_x + cube.cell.x * cell_size;
      const target_y = grid_center_y + cube.cell.y * cell_size;

      dummy.position.set(
        scattered_x + (target_x - scattered_x) * arrival,
        scattered_y + (target_y - scattered_y) * arrival,
        scattered_z * (1 - arrival),
      );
      // Girando mientras está suelto y quieto al ordenarse
      const spin_left = 1 - arrival;
      dummy.rotation.set(
        (cube.start_x + cube.spin_x * time * float_factor) * spin_left,
        (cube.start_y + cube.spin_y * time * float_factor) * spin_left,
        (cube.start_z + cube.spin_z * time * float_factor) * spin_left,
      );
      const loose_scale = cube.scale * size_factor;
      const ordered_scale = cell_size * CELL_FILL;
      dummy.scale.setScalar((loose_scale + (ordered_scale - loose_scale) * arrival) * growth);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  function update(time, delta) {
    flash_level *= Math.exp(-FLASH_DECAY_PER_SECOND * delta);
    if (flash_level < 0.002) flash_level = 0;
    material.opacity = BASE_OPACITY + FLASH_OPACITY * flash_level;
    material.color.copy(base_color).lerp(flash_color, flash_level * FLASH_WHITENING);
    place_cubes(time);
  }

  function render_frame(time, delta) {
    update(time, delta);
    renderer.render(scene, camera);
  }

  // Con movimiento reducido se dibuja un solo cuadro quieto, con los cubos dispersos.
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
    // En pantallas estrechas los cubos sueltos se achican en proporción, para que no tapen todo el fondo
    size_factor = Math.min(1, camera.aspect);
    if (camera.aspect > 1.1) {
      // Pantalla ancha: la cuadrícula se arma a un lado, donde no la tapa la tarjeta
      grid_center_x = half_width * 0.66;
      grid_center_y = half_height * 0.1;
      cell_size = (half_height * 1.1) / GRID_SIZE;
    } else {
      // Pantalla angosta: se arma arriba
      grid_center_x = 0;
      grid_center_y = half_height * 0.5;
      cell_size = Math.min((half_width * 1.5) / GRID_SIZE, (half_height * 0.7) / GRID_SIZE);
    }
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
