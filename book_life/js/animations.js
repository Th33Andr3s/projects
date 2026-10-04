// Animaciones del libro de vida.
// - Three.js: cielo de estrellas que titilan, estrellas fugaces ocasionales, corazones que suben,
//   pétalos de rosa que caen, una ráfaga de corazones al entrar, el libro 3D del inicio y los fuegos
//   artificiales que lanza al mostrar su primera página.
// - DOM: destellos (estrellas y corazones) alrededor de las tarjetas, giro de las hojas del libro
//   y celebraciones Lottie.
//
// Reglas de CLAUDE.md 2.10: son decorativas, respetan prefers-reduced-motion, se pausan con la
// pestaña oculta, usan requestAnimationFrame y limitan el pixelRatio a 2.
// Three.js se importa de forma dinámica: si la CDN falla, la aplicación sigue funcionando.

import { create_home_book } from "./home_book.js";
import { create_fireworks } from "./fireworks.js";

const reduced_motion_query = window.matchMedia("(prefers-reduced-motion: reduce)");
const small_screen_query = window.matchMedia("(max-width: 640px)");

const MAX_PIXEL_RATIO = 2;
// El cielo no necesita 60 cuadros por segundo: a 30 se ve igual de suave y gasta la mitad.
const MIN_FRAME_MILLISECONDS = 1000 / 30;
// Si de cada 90 cuadros más de este porcentaje tarda más de SLOW_FRAME_MILLISECONDS, el equipo va justo.
const GOVERNOR_WINDOW_FRAMES = 90;
const SLOW_FRAME_MILLISECONDS = 50;
const SLOW_FRAME_RATIO_LIMIT = 0.4;
// Una pausa más larga que esto es la pestaña dormida, no lentitud real.
const MAX_REAL_INTERVAL_MILLISECONDS = 1000;
const TWO_PI = Math.PI * 2;

let scene_state = null;
let scene_started = false;
let current_mode = "login";
let pending_book_slot = null;
let pending_book_cover = null;

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

// Arranca la escena 3D sobre el canvas. Nunca lanza: si algo falla, simplemente no hay 3D.
export async function start_scene(canvas_element) {
  if (scene_started) return;
  scene_started = true;

  try {
    const THREE = await import("three");
    scene_state = build_scene(THREE, canvas_element);
    scene_state.set_mode(current_mode);
    scene_state.set_book_slot(pending_book_slot);
    if (pending_book_cover) scene_state.set_book_cover(pending_book_cover);
  } catch {
    // Sin WebGL o sin red a la CDN: queda el fondo CSS y los destellos del DOM.
    scene_state = null;
  }
}

// "login": cielo y muchos corazones. "home": pétalos de rosa y menos corazones.
export function set_scene_mode(mode) {
  current_mode = mode;
  if (scene_state) scene_state.set_mode(mode);
}

// Indica dónde se dibuja el libro 3D: el elemento de la pantalla de inicio que lo ocupa, o null si no se ve.
// Sin 3D no pasa nada: el elemento conserva su dibujo de respaldo.
// Portada del libro 3D: { names, image }. image es una foto ya cargada o null. Se guarda por si la escena aún no existe.
export function set_home_book_cover(content) {
  pending_book_cover = content;
  if (scene_state) scene_state.set_book_cover(content);
}

export function set_home_book_slot(slot_element) {
  pending_book_slot = slot_element;
  if (scene_state) scene_state.set_book_slot(slot_element);
}

// Al tocar el libro: gira, abre la tapa para mostrar su primera página, lanza fuegos artificiales y se
// cierra de nuevo, sin cambiar de tamaño. Devuelve true si se mostró la animación.
// Con movimiento reducido, sin 3D o con la calidad al mínimo no hace nada y devuelve false.
export async function peek_book_animation() {
  if (!scene_state || reduced_motion_query.matches) return false;
  return scene_state.peek_book();
}

// Abrir el libro para leer, en tres pasos que la pantalla va encadenando:
// 1. open_book_animation: el libro gira y abre la tapa. Devuelve una promesa que termina con la tapa abierta,
//    o null si no hay animación (sin 3D, con movimiento reducido, pestaña oculta o calidad al mínimo).
// 2. land_book_animation: con la tapa abierta, el libro se desliza, crece y se estira hasta quedar justo
//    sobre el libro real de la lectura (el elemento que se le da). Termina cuando llegó.
// 3. release_book_animation: el libro 3D se desvanece, ya cubierto por el real.
export function open_book_animation() {
  if (!scene_state || reduced_motion_query.matches) return null;
  return scene_state.open_book();
}

export function land_book_animation(book_element) {
  if (!scene_state) return Promise.resolve();
  return scene_state.land_book(book_element);
}

export function release_book_animation() {
  if (!scene_state) return Promise.resolve();
  return scene_state.release_book();
}

const celebration_timers = new WeakMap();

// Muestra una celebración Lottie (una capa que flota sobre la pantalla) durante unos instantes.
// Devuelve true si se mostró; con movimiento reducido no se muestra y devuelve false.
export function play_celebration(overlay_element, milliseconds) {
  if (reduced_motion_query.matches) return false;

  clearTimeout(celebration_timers.get(overlay_element));
  overlay_element.hidden = false;
  const player = overlay_element.querySelector("lottie-player");
  // Si la librería de Lottie no cargó, el resto de la pantalla ya comunicó lo que pasó.
  if (player && typeof player.play === "function") {
    player.stop();
    player.play();
  }
  celebration_timers.set(overlay_element, setTimeout(() => stop_celebration(overlay_element), milliseconds));
  return true;
}

export function stop_celebration(overlay_element) {
  clearTimeout(celebration_timers.get(overlay_element));
  overlay_element.hidden = true;
}

// Ráfaga de corazones desde el centro, por ejemplo al entrar con éxito.
export function burst_hearts() {
  if (scene_state && !reduced_motion_query.matches) scene_state.burst();
}

// Agrega destellos que aparecen, desaparecen y cambian de lugar alrededor de una tarjeta.
export function add_card_sparkles(card_element, sparkle_count = 12) {
  const layer = document.createElement("div");
  layer.className = "sparkle_layer";
  layer.setAttribute("aria-hidden", "true");

  for (let index = 0; index < sparkle_count; index += 1) {
    const sparkle = document.createElement("i");
    const is_heart = index % 4 === 3;
    sparkle.className = `fa-solid ${is_heart ? "fa-heart sparkle_heart" : "fa-star"} sparkle`;
    sparkle.style.setProperty("--duration", `${2.6 + Math.random() * 2.8}s`);
    sparkle.style.setProperty("--delay", `${(Math.random() * 5).toFixed(2)}s`);
    place_sparkle(sparkle);
    // Al terminar cada ciclo (invisible) cambia de sitio, así nunca se repite el mismo patrón.
    sparkle.addEventListener("animationiteration", () => place_sparkle(sparkle));
    layer.append(sparkle);
  }

  card_element.prepend(layer);
}

// Anima el giro de una hoja del libro y avisa cuando termina.
// En doble página la hoja gira 180 grados sobre el lomo; en página única se desliza y se desvanece.
// Con movimiento reducido no hay animación: devuelve de inmediato.
export async function play_page_turn(leaf, { two_page, direction }) {
  if (reduced_motion_query.matches || typeof leaf.animate !== "function") return;

  const duration = two_page ? 850 : 650;
  const easing = "cubic-bezier(0.45, 0.05, 0.25, 1)";
  const animations = [];

  if (two_page) {
    const end_angle = direction > 0 ? -180 : 180;
    animations.push(
      leaf.animate(
        [{ transform: "rotateY(0deg)" }, { transform: `rotateY(${end_angle}deg)` }],
        { duration, easing, fill: "forwards" },
      ),
    );
    // Sombras que oscurecen la hoja a mitad del giro, para dar sensación de volumen.
    const [front_shade, back_shade] = leaf.querySelectorAll(".leaf_shade");
    if (front_shade) {
      animations.push(
        front_shade.animate([{ opacity: 0 }, { opacity: 0.45, offset: 0.5 }, { opacity: 0.5 }], {
          duration,
          easing: "linear",
          fill: "forwards",
        }),
      );
    }
    if (back_shade) {
      animations.push(
        back_shade.animate([{ opacity: 0.5 }, { opacity: 0.45, offset: 0.5 }, { opacity: 0 }], {
          duration,
          easing: "linear",
          fill: "forwards",
        }),
      );
    }
  } else {
    const keyframes = [
      { transform: "rotateY(0deg)", opacity: 1 },
      { transform: "rotateY(-100deg)", opacity: 0 },
    ];
    animations.push(
      leaf.animate(direction > 0 ? keyframes : [...keyframes].reverse(), { duration, easing, fill: "forwards" }),
    );
  }

  // Tope de seguridad: si el navegador pausa las animaciones (pestaña oculta), no se queda esperando.
  const finished = Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
  const timeout = new Promise((resolve) => setTimeout(resolve, duration + 400));
  await Promise.race([finished, timeout]);
}

// ---------------------------------------------------------------------------
// Destellos del DOM
// ---------------------------------------------------------------------------

// Los coloca alrededor de la tarjeta, a poca distancia de su borde.
// La distancia se da en píxeles y no en porcentaje de la altura: en una tarjeta muy alta (como la lista
// de páginas) un porcentaje los mandaba cientos de píxeles fuera, estirando la página cada vez que cambiaban de lugar.
function place_sparkle(sparkle) {
  const side = Math.floor(Math.random() * 4);
  const outside_vertical = 6 + Math.random() * 26;
  const outside_horizontal = 6 + Math.random() * 10;
  let x_position;
  let y_position;

  if (side < 2) {
    x_position = `${-2 + Math.random() * 104}%`;
    y_position = side === 0 ? `${-outside_vertical}px` : `calc(100% + ${outside_vertical}px)`;
  } else {
    y_position = `${6 + Math.random() * 88}%`;
    x_position = side === 2 ? `${-outside_horizontal}px` : `calc(100% + ${outside_horizontal}px)`;
  }

  sparkle.style.setProperty("--x", x_position);
  sparkle.style.setProperty("--y", y_position);
  sparkle.style.setProperty("--size", `${9 + Math.random() * 14}px`);
}

// ---------------------------------------------------------------------------
// Escena Three.js
// ---------------------------------------------------------------------------

const STAR_VERTEX_SHADER = `
  attribute float a_size;
  attribute float a_phase;
  attribute float a_speed;
  attribute vec3 a_color;
  uniform float u_time;
  uniform float u_pixel_ratio;
  varying float v_alpha;
  varying vec3 v_color;

  void main() {
    // La estrella pasa mucho tiempo casi apagada y luego brilla: "aparece y desaparece".
    float wave = sin(u_time * a_speed + a_phase);
    v_alpha = smoothstep(-0.25, 0.9, wave);
    v_color = a_color;
    gl_PointSize = a_size * u_pixel_ratio * (0.55 + 0.6 * v_alpha);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const STAR_FRAGMENT_SHADER = `
  varying float v_alpha;
  varying vec3 v_color;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    // Halo suave más cuatro rayos finos: forma de destello.
    float glow = exp(-d * 9.0);
    float ray_x = exp(-abs(p.x) * 42.0) * exp(-abs(p.y) * 5.0);
    float ray_y = exp(-abs(p.y) * 42.0) * exp(-abs(p.x) * 5.0);
    float alpha = clamp(glow + ray_x + ray_y, 0.0, 1.0) * v_alpha;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(v_color, alpha);
  }
`;

const STAR_COLORS = [
  [1.0, 1.0, 1.0],
  [1.0, 0.88, 0.58],
  [1.0, 0.82, 0.92],
];

const HEART_COLORS = [
  ["#ffb0cb", "#ff5f93"],
  ["#ffd0e0", "#f2709f"],
  ["#ff7aa8", "#d6336c"],
  ["#ffffff", "#ffc0d6"],
];

const PETAL_COLORS = [
  ["#ffd0df", "#f5799f"],
  ["#ffb3c8", "#ec5f8d"],
  ["#ffe3ec", "#ff9fbd"],
  ["#ff9ab9", "#d6336c"],
];

function build_scene(THREE, canvas) {
  const is_small = small_screen_query.matches;
  const counts = is_small
    ? { stars: 150, hearts: 12, petals: 16, burst: 24 }
    : { stars: 340, hearts: 22, petals: 30, burst: 36 };

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  // Cámara ortográfica en píxeles: 1 unidad = 1 píxel CSS, más fácil de razonar para 2D con profundidad de capas.
  // La cámara está lejos para que el libro 3D, que tiene profundidad, quepa entero sin recortarse.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 3000);
  camera.position.z = 1000;

  let width = 1;
  let height = 1;
  let frame_id = 0;
  let last_time = 0;
  let mode = "login";
  // Calidad adaptable: si el equipo va lento se baja la resolución, luego las partículas y, al final, se detiene.
  let quality_level = 0;
  let max_pixel_ratio = MAX_PIXEL_RATIO;
  let petal_limit = counts.petals;
  let is_disabled_for_performance = false;
  let last_render_time = 0;
  let measured_frames = 0;
  let slow_frames = 0;
  const pointer_target = { x: 0, y: 0 };
  const pointer_current = { x: 0, y: 0 };

  // --- Estrellas ---
  const star_positions = new Float32Array(counts.stars * 3);
  const star_sizes = new Float32Array(counts.stars);
  const star_phases = new Float32Array(counts.stars);
  const star_speeds = new Float32Array(counts.stars);
  const star_colors = new Float32Array(counts.stars * 3);

  for (let index = 0; index < counts.stars; index += 1) {
    // Posición normalizada (-0.5 a 0.5): el objeto se escala al tamaño de la ventana.
    star_positions[index * 3] = Math.random() - 0.5;
    star_positions[index * 3 + 1] = Math.random() - 0.5;
    star_sizes[index] = 10 + Math.random() ** 2 * 28;
    star_phases[index] = Math.random() * TWO_PI;
    star_speeds[index] = 0.4 + Math.random() * 1.5;
    const color = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
    star_colors.set(color, index * 3);
  }

  const star_geometry = new THREE.BufferGeometry();
  star_geometry.setAttribute("position", new THREE.BufferAttribute(star_positions, 3));
  star_geometry.setAttribute("a_size", new THREE.BufferAttribute(star_sizes, 1));
  star_geometry.setAttribute("a_phase", new THREE.BufferAttribute(star_phases, 1));
  star_geometry.setAttribute("a_speed", new THREE.BufferAttribute(star_speeds, 1));
  star_geometry.setAttribute("a_color", new THREE.BufferAttribute(star_colors, 3));

  const star_material = new THREE.ShaderMaterial({
    uniforms: { u_time: { value: 0 }, u_pixel_ratio: { value: 1 } },
    vertexShader: STAR_VERTEX_SHADER,
    fragmentShader: STAR_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });

  const stars = new THREE.Points(star_geometry, star_material);
  stars.frustumCulled = false;
  scene.add(stars);

  // --- Texturas dibujadas en canvas: sin archivos externos ---
  const heart_textures = HEART_COLORS.map(([top, bottom]) => make_heart_texture(THREE, top, bottom));
  const petal_textures = PETAL_COLORS.map(([top, bottom]) => make_petal_texture(THREE, top, bottom));

  function make_sprite(texture) {
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0 });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    return sprite;
  }

  // --- Corazones que suben ---
  const hearts_group = new THREE.Group();
  const hearts = Array.from({ length: counts.hearts }, () => {
    const sprite = make_sprite(heart_textures[Math.floor(Math.random() * heart_textures.length)]);
    hearts_group.add(sprite);
    const item = { sprite, active: true };
    reset_heart(item, true);
    return item;
  });
  scene.add(hearts_group);

  function reset_heart(item, anywhere) {
    item.size = (is_small ? 18 : 22) + Math.random() * (is_small ? 22 : 30);
    item.speed = 22 + Math.random() * 38;
    item.x = (Math.random() - 0.5) * width;
    item.y = anywhere ? (Math.random() - 0.5) * height : -height / 2 - item.size;
    item.sway_amount = 10 + Math.random() * 26;
    item.sway_speed = 0.5 + Math.random() * 0.9;
    item.phase = Math.random() * TWO_PI;
    item.max_opacity = 0.55 + Math.random() * 0.4;
  }

  // --- Pétalos que caen ---
  const petals_group = new THREE.Group();
  const petals = Array.from({ length: counts.petals }, () => {
    const sprite = make_sprite(petal_textures[Math.floor(Math.random() * petal_textures.length)]);
    petals_group.add(sprite);
    const item = {};
    item.sprite = sprite;
    reset_petal(item, true);
    return item;
  });
  petals_group.visible = false;
  scene.add(petals_group);

  function reset_petal(item, anywhere) {
    item.size = (is_small ? 16 : 20) + Math.random() * (is_small ? 14 : 20);
    item.speed = 30 + Math.random() * 45;
    item.x = (Math.random() - 0.5) * width;
    item.y = anywhere ? (Math.random() - 0.5) * height : height / 2 + item.size;
    item.drift_amount = 30 + Math.random() * 50;
    item.drift_speed = 0.35 + Math.random() * 0.6;
    item.phase = Math.random() * TWO_PI;
    item.spin = (Math.random() - 0.5) * 2.4;
    item.flip_speed = 1 + Math.random() * 1.8;
    item.rotation = Math.random() * TWO_PI;
    item.max_opacity = 0.7 + Math.random() * 0.3;
  }

  // --- Ráfaga de corazones ---
  const burst_group = new THREE.Group();
  const burst_items = Array.from({ length: counts.burst }, () => {
    const sprite = make_sprite(heart_textures[Math.floor(Math.random() * heart_textures.length)]);
    burst_group.add(sprite);
    return { sprite, active: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, size: 20 };
  });
  scene.add(burst_group);

  function burst() {
    burst_items.forEach((item) => {
      const angle = Math.random() * TWO_PI;
      const speed = 160 + Math.random() * 380;
      item.active = true;
      item.x = 0;
      item.y = height * 0.04;
      item.vx = Math.cos(angle) * speed;
      item.vy = Math.sin(angle) * speed + 90;
      item.age = 0;
      item.life = 1.4 + Math.random() * 0.9;
      item.size = 16 + Math.random() * 26;
    });
    start_loop();
  }

  // --- Estrellas fugaces: una de vez en cuando, cruzando el cielo en diagonal ---
  const streak_texture = make_streak_texture(THREE);
  const shooting_stars = Array.from({ length: 2 }, () => {
    const sprite = make_sprite(streak_texture);
    // La cabeza de la estela está a la derecha de la imagen: ahí se ancla para que avance con ella por delante.
    sprite.center.set(1, 0.5);
    scene.add(sprite);
    return { sprite, active: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, length: 160, direction: 0 };
  });
  let next_shooting_star_time = 4 + Math.random() * 4;

  function launch_shooting_star() {
    const star = shooting_stars.find((item) => !item.active);
    if (!star) return;
    const goes_right = Math.random() < 0.5;
    const slope = (18 + Math.random() * 18) * (Math.PI / 180);
    const speed = 760 + Math.random() * 360;
    star.active = true;
    star.age = 0;
    star.life = 0.85 + Math.random() * 0.4;
    star.length = 130 + Math.random() * 110;
    star.vx = Math.cos(slope) * speed * (goes_right ? 1 : -1);
    star.vy = -Math.sin(slope) * speed;
    star.x = (goes_right ? -0.5 : 0.5) * width + (goes_right ? 1 : -1) * Math.random() * width * 0.25;
    star.y = height * (0.12 + Math.random() * 0.34);
    star.direction = Math.atan2(star.vy, star.vx);
  }

  // --- Libro 3D de la pantalla de inicio ---
  const home_book = create_home_book(THREE);
  scene.add(home_book.group);
  let book_slot = null;
  const book_center = { x: 0, y: 0 };
  // Mientras el libro se abre para leer, la pantalla de inicio se oculta: el libro sigue en el sitio donde estaba
  // (frozen_rect) hasta que se desliza hacia el libro real (landing_element).
  let frozen_rect = null;
  let landing_element = null;

  // --- Fuegos artificiales: salen alrededor del libro cuando muestra su primera página ---
  const fireworks = create_fireworks(THREE, { is_small });
  fireworks.points.renderOrder = 10;
  scene.add(fireworks.points);
  // Momentos (en segundos desde que la tapa se abrió) en que sale cada ráfaga
  const FIREWORK_TIMES = [0, 0.35, 0.7, 1.1, 1.55, 2.0, 2.45];
  let firework_queue = [];
  let firework_clock = 0;

  function launch_firework() {
    const angle = Math.random() * TWO_PI;
    const distance = 120 + Math.random() * 150;
    const margin = 50;
    // Más arriba que abajo, y siempre dentro de la pantalla
    const x = Math.max(-width / 2 + margin, Math.min(width / 2 - margin, book_center.x + Math.cos(angle) * distance));
    const y = Math.max(-height / 2 + margin, Math.min(height / 2 - margin, book_center.y + 50 + Math.sin(angle) * distance));
    fireworks.launch(x, y, 400);
  }

  function start_fireworks() {
    firework_queue = [...FIREWORK_TIMES];
    firework_clock = 0;
  }
  const hover_on = () => home_book.set_hover(true);
  const hover_off = () => home_book.set_hover(false);

  // Se vuelve a dibujar la portada cuando la tipografía ya cargó, para que el título salga con su letra.
  if (document.fonts) {
    document.fonts
      .load('700 64px Lora')
      .then(() => home_book.redraw_cover())
      .catch(() => {});
  }

  // Centro y tamaño de la hoja derecha del libro real (la única hoja si se ve una sola), en coordenadas de la escena.
  // En doble página el libro mide dos hojas de ancho.
  function measure_landing_target() {
    const rect = landing_element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const page_w = landing_element.dataset.mode === "double" ? rect.width / 2 : rect.width;
    return {
      x: rect.right - page_w / 2 - width / 2,
      y: height / 2 - (rect.top + rect.height / 2),
      page_w,
      page_h: rect.height,
    };
  }

  function update_book(time, delta) {
    // El libro sigue al elemento de la pantalla que lo ocupa, también mientras la pantalla se desplaza o aparece.
    const rect = frozen_rect || (book_slot ? book_slot.getBoundingClientRect() : null);
    if (!rect) return;
    book_center.x = rect.left + rect.width / 2 - width / 2;
    book_center.y = height / 2 - (rect.top + rect.height / 2);
    home_book.place(book_center.x, book_center.y, rect.width, rect.height, width);
    // El destino se mide en cada cuadro: si el libro real cambia de sitio (por ejemplo, al aparecer la barra de
    // desplazamiento), el 3D lo sigue y llega exacto.
    if (landing_element) home_book.set_target(measure_landing_target());
    home_book.update(time, delta, pointer_current, !reduced_motion_query.matches);
  }

  function end_opening() {
    frozen_rect = null;
    landing_element = null;
    home_book.set_target(null);
  }

  function set_book_slot(slot_element) {
    if (book_slot) {
      book_slot.classList.remove("has_3d_book");
      book_slot.removeEventListener("pointerenter", hover_on);
      book_slot.removeEventListener("pointerleave", hover_off);
      book_slot.removeEventListener("focus", hover_on);
      book_slot.removeEventListener("blur", hover_off);
    }
    book_slot = slot_element;
    // Si se está abriendo el libro para leer, el 3D sigue a la vista aunque la pantalla de inicio ya se haya ocultado.
    const is_opening = Boolean(frozen_rect);
    if (slot_element || !is_opening) {
      end_opening();
      home_book.set_visible(Boolean(slot_element));
    }
    home_book.set_hover(false);
    // Al irse del inicio no deben quedar chispas ni ráfagas pendientes.
    firework_queue = [];
    fireworks.clear();
    if (slot_element) {
      home_book.reset();
      // Con esta clase la pantalla oculta su dibujo de respaldo.
      slot_element.classList.add("has_3d_book");
      slot_element.addEventListener("pointerenter", hover_on);
      slot_element.addEventListener("pointerleave", hover_off);
      slot_element.addEventListener("focus", hover_on);
      slot_element.addEventListener("blur", hover_off);
    }
    // Si el bucle no está corriendo (movimiento reducido o calidad mínima), se dibuja el libro una vez.
    if (!frame_id) render_once();
  }

  function set_book_cover(content) {
    home_book.set_cover(content);
    // Sin bucle de dibujo (movimiento reducido o calidad mínima) hay que dibujar el cambio a mano
    if (!frame_id) render_once();
  }

  function open_book() {
    if (is_disabled_for_performance || document.hidden || !book_slot) return null;
    const rect = book_slot.getBoundingClientRect();
    frozen_rect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    home_book.set_hover(false);
    // Los fuegos artificiales de un toque anterior no deben seguir mientras se abre para leer
    firework_queue = [];
    start_loop();
    return home_book.open();
  }

  function land_book(book_element) {
    if (!frozen_rect) return Promise.resolve();
    landing_element = book_element;
    home_book.set_target(measure_landing_target());
    start_loop();
    return home_book.land();
  }

  function release_book() {
    return home_book.release().then(end_opening);
  }

  function peek_book() {
    if (is_disabled_for_performance || document.hidden || !book_slot) return Promise.resolve(false);
    start_loop();
    return home_book.peek(start_fireworks).then(() => true);
  }

  // --- Actualización por cuadro ---
  function update(time, delta) {
    star_material.uniforms.u_time.value = time;

    // Parallax suave con el puntero: las capas cercanas se mueven más que el cielo.
    pointer_current.x += (pointer_target.x - pointer_current.x) * Math.min(1, delta * 3);
    pointer_current.y += (pointer_target.y - pointer_current.y) * Math.min(1, delta * 3);
    stars.position.set(-pointer_current.x * 10, pointer_current.y * 10, 0);
    hearts_group.position.set(-pointer_current.x * 26, pointer_current.y * 26, 0);
    petals_group.position.set(-pointer_current.x * 18, pointer_current.y * 18, 0);

    hearts.forEach((item) => {
      if (!item.active) {
        item.sprite.visible = false;
        return;
      }
      item.y += item.speed * delta;
      if (item.y > height / 2 + item.size) reset_heart(item, false);

      const progress = (item.y + height / 2) / height;
      const fade = Math.min(progress / 0.15, 1) * Math.min((1 - progress) / 0.2, 1);
      const beat = 1 + 0.08 * Math.sin(time * 3 + item.phase);

      item.sprite.visible = true;
      item.sprite.position.set(item.x + Math.sin(time * item.sway_speed + item.phase) * item.sway_amount, item.y, 0);
      item.sprite.scale.set(item.size * beat, item.size * beat, 1);
      item.sprite.material.opacity = Math.max(0, fade) * item.max_opacity;
    });

    if (mode === "home") {
      petals.forEach((item, index) => {
        if (index >= petal_limit) {
          item.sprite.visible = false;
          return;
        }
        item.y -= item.speed * delta;
        item.rotation += item.spin * delta;
        if (item.y < -height / 2 - item.size) reset_petal(item, false);

        const progress = (item.y + height / 2) / height;
        const fade = Math.min(progress / 0.1, 1) * Math.min((1 - progress) / 0.1, 1);
        // Al cambiar el ancho simula que el pétalo gira en el aire.
        const flip = 0.35 + 0.65 * Math.abs(Math.cos(time * item.flip_speed + item.phase));

        item.sprite.visible = true;
        item.sprite.position.set(item.x + Math.sin(time * item.drift_speed + item.phase) * item.drift_amount, item.y, 0);
        item.sprite.scale.set(item.size * flip, item.size, 1);
        item.sprite.material.rotation = item.rotation;
        item.sprite.material.opacity = Math.max(0, fade) * item.max_opacity;
      });
    }

    // Estrellas fugaces: no con movimiento reducido.
    if (!reduced_motion_query.matches && time >= next_shooting_star_time && delta > 0) {
      launch_shooting_star();
      next_shooting_star_time = time + 7 + Math.random() * 8;
    }
    shooting_stars.forEach((star) => {
      if (!star.active) {
        star.sprite.visible = false;
        return;
      }
      star.age += delta;
      if (star.age >= star.life) {
        star.active = false;
        star.sprite.visible = false;
        return;
      }
      star.x += star.vx * delta;
      star.y += star.vy * delta;
      const progress = star.age / star.life;
      star.sprite.visible = true;
      star.sprite.position.set(star.x, star.y, 0.5);
      star.sprite.scale.set(star.length, 7, 1);
      star.sprite.material.rotation = star.direction;
      star.sprite.material.opacity = Math.sin(progress * Math.PI) * 0.95;
    });

    update_book(time, delta);

    // Ráfagas programadas y chispas en vuelo
    if (firework_queue.length > 0 && delta > 0) {
      firework_clock += delta;
      while (firework_queue.length > 0 && firework_clock >= firework_queue[0]) {
        firework_queue.shift();
        launch_firework();
      }
    }
    fireworks.update(delta);

    burst_items.forEach((item) => {
      if (!item.active) {
        item.sprite.visible = false;
        return;
      }
      item.age += delta;
      if (item.age >= item.life) {
        item.active = false;
        item.sprite.visible = false;
        return;
      }
      item.vx *= 1 - 1.5 * delta;
      item.vy = item.vy * (1 - 1.2 * delta) + 60 * delta;
      item.x += item.vx * delta;
      item.y += item.vy * delta;
      const progress = item.age / item.life;
      item.sprite.visible = true;
      item.sprite.position.set(item.x, item.y, 1);
      item.sprite.scale.set(item.size * (1 + 0.3 * progress), item.size * (1 + 0.3 * progress), 1);
      item.sprite.material.opacity = 1 - progress * progress;
    });
  }

  function render_frame(time, delta) {
    update(time, delta);
    renderer.render(scene, camera);
  }

  // --- Bucle ---
  function frame(now) {
    frame_id = requestAnimationFrame(frame);
    // Se salta el cuadro si todavía no toca: así el cielo corre a 30 cuadros por segundo como máximo.
    const interval = now - last_render_time;
    if (interval < MIN_FRAME_MILLISECONDS - 2) return;
    last_render_time = now;

    const time = now / 1000;
    // El delta se limita para que al volver a la pestaña no haya un salto enorme.
    const delta = Math.min(time - last_time, 0.05);
    last_time = time;
    render_frame(time, delta);
    watch_performance(interval);
  }

  // Mide si el equipo aguanta el cielo animado y, si no, lo simplifica sin que la persona tenga que hacer nada.
  function watch_performance(interval) {
    if (interval > MAX_REAL_INTERVAL_MILLISECONDS) return;
    measured_frames += 1;
    if (interval > SLOW_FRAME_MILLISECONDS) slow_frames += 1;
    if (measured_frames < GOVERNOR_WINDOW_FRAMES) return;

    const slow_ratio = slow_frames / measured_frames;
    measured_frames = 0;
    slow_frames = 0;
    if (slow_ratio > SLOW_FRAME_RATIO_LIMIT) lower_quality();
  }

  function lower_quality() {
    quality_level += 1;
    if (quality_level === 1) {
      max_pixel_ratio = 1;
      petal_limit = Math.ceil(counts.petals / 2);
      resize();
      set_mode(mode);
      return;
    }
    // Aun simplificado va lento: el cielo se queda quieto y la aplicación sigue funcionando igual.
    is_disabled_for_performance = true;
    stop_loop();
    render_once();
  }

  function start_loop() {
    if (frame_id || document.hidden || reduced_motion_query.matches || is_disabled_for_performance) return;
    last_time = performance.now() / 1000;
    last_render_time = performance.now();
    measured_frames = 0;
    slow_frames = 0;
    frame_id = requestAnimationFrame(frame);
  }

  function stop_loop() {
    cancelAnimationFrame(frame_id);
    frame_id = 0;
  }

  // Con movimiento reducido se dibuja un solo cuadro estático.
  function render_once() {
    render_frame(1.5, 0);
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    const pixel_ratio = Math.min(window.devicePixelRatio || 1, max_pixel_ratio);
    renderer.setPixelRatio(pixel_ratio);
    renderer.setSize(width, height);
    star_material.uniforms.u_pixel_ratio.value = pixel_ratio;
    fireworks.set_pixel_ratio(pixel_ratio);
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
    stars.scale.set(width, height, 1);
    // Si el bucle no está corriendo (movimiento reducido o calidad mínima), se redibuja una vez.
    if (!frame_id) render_once();
  }

  function set_mode(new_mode) {
    mode = new_mode;
    // Con calidad reducida se muestran la mitad de los corazones.
    const quality_scale = quality_level >= 1 ? 0.5 : 1;
    const visible_hearts = Math.ceil(hearts.length * (mode === "home" ? 0.4 : 1) * quality_scale);
    hearts.forEach((item, index) => {
      item.active = index < visible_hearts;
    });
    petals_group.visible = mode === "home";
    if (!petals_group.visible) petals.forEach((item) => (item.sprite.visible = false));
    if (reduced_motion_query.matches) render_once();
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
  window.addEventListener(
    "pointermove",
    (event) => {
      pointer_target.x = event.clientX / width - 0.5;
      pointer_target.y = event.clientY / height - 0.5;
    },
    { passive: true },
  );

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
  // Primer reparto: ya con el tamaño real, se esparcen por toda la pantalla.
  hearts.forEach((item) => reset_heart(item, true));
  petals.forEach((item) => reset_petal(item, true));

  if (reduced_motion_query.matches) render_once();
  else start_loop();

  return { set_mode, burst, set_book_slot, set_book_cover, open_book, land_book, release_book, peek_book };
}

// Estela de estrella fugaz: transparente a la izquierda y brillante en la cabeza, a la derecha.
function make_streak_texture(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 16;
  const context = canvas.getContext("2d");

  const tail = context.createLinearGradient(0, 0, 256, 0);
  tail.addColorStop(0, "rgba(255, 255, 255, 0)");
  tail.addColorStop(0.7, "rgba(255, 244, 214, 0.55)");
  tail.addColorStop(1, "rgba(255, 255, 255, 1)");
  context.fillStyle = tail;
  context.beginPath();
  context.moveTo(0, 8);
  context.lineTo(240, 4);
  context.lineTo(256, 8);
  context.lineTo(240, 12);
  context.closePath();
  context.fill();

  const head = context.createRadialGradient(246, 8, 0, 246, 8, 10);
  head.addColorStop(0, "rgba(255, 255, 255, 1)");
  head.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = head;
  context.fillRect(226, 0, 30, 16);

  return finish_texture(THREE, canvas);
}

// Corazón dibujado en canvas con degradado y brillo.
function make_heart_texture(THREE, top_color, bottom_color) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.translate(64, 66);

  context.beginPath();
  context.moveTo(0, 38);
  context.bezierCurveTo(-46, 6, -40, -34, -18, -34);
  context.bezierCurveTo(-8, -34, -2, -28, 0, -20);
  context.bezierCurveTo(2, -28, 8, -34, 18, -34);
  context.bezierCurveTo(40, -34, 46, 6, 0, 38);
  context.closePath();

  const gradient = context.createLinearGradient(0, -34, 0, 38);
  gradient.addColorStop(0, top_color);
  gradient.addColorStop(1, bottom_color);
  context.shadowColor = bottom_color;
  context.shadowBlur = 14;
  context.fillStyle = gradient;
  context.fill();

  context.shadowBlur = 0;
  context.fillStyle = "rgba(255, 255, 255, 0.55)";
  context.beginPath();
  context.ellipse(-20, -18, 8, 5, -0.6, 0, TWO_PI);
  context.fill();

  return finish_texture(THREE, canvas);
}

// Pétalo de rosa dibujado en canvas con degradado y una nervadura suave.
function make_petal_texture(THREE, top_color, bottom_color) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.translate(64, 64);

  context.beginPath();
  context.moveTo(0, -50);
  context.bezierCurveTo(34, -34, 40, 18, 0, 50);
  context.bezierCurveTo(-40, 18, -34, -34, 0, -50);
  context.closePath();

  const gradient = context.createLinearGradient(0, -50, 0, 50);
  gradient.addColorStop(0, top_color);
  gradient.addColorStop(1, bottom_color);
  context.fillStyle = gradient;
  context.fill();

  context.strokeStyle = "rgba(255, 255, 255, 0.4)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, -38);
  context.quadraticCurveTo(4, 0, 0, 40);
  context.stroke();

  return finish_texture(THREE, canvas);
}

function finish_texture(THREE, canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
