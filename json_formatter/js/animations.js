// Animación de fondo: llaves y corchetes translúcidos ({ } [ ]), hechos con planos y dibujados solo con su contorno, que
// flotan y giran despacio detrás de la tarjeta y hacen un leve destello cuando el JSON pasa de válido a inválido (o al
// revés) y al copiar el resultado. Es solo decoración: nunca bloquea ni retrasa nada de lo que hace la persona.
//
// Reglas de CLAUDE.md 2.10: bucle con requestAnimationFrame, tope de 30 cuadros por segundo, pixelRatio máximo
// de 2, se ajusta al tamaño de la ventana, se pausa con la pestaña oculta y, con movimiento reducido, queda
// como una imagen quieta.
//
// Three.js se carga con import() dentro de start_scene, no con un import estático arriba: si la CDN falla o el
// navegador no tiene WebGL, el formateador sigue funcionando igual y este archivo no lo rompe.

const MIN_FRAME_MILLISECONDS = 1000 / 30;
const MAX_DELTA_SECONDS = 0.1;
const MAX_PIXEL_RATIO = 2;
const SMALL_SCREEN_WIDTH = 700;
const PIECES_PER_GLYPH_SMALL_SCREEN = 2;
const PIECES_PER_GLYPH_LARGE_SCREEN = 5;
const GLYPHS = ["{", "}", "[", "]"];

const CAMERA_FOV = 60;
const CAMERA_Z = 22;
// Cuánto más grande que la pantalla es la zona donde viven las piezas, y cuánta profundidad tiene
const FIELD_MARGIN = 1.1;
const FIELD_DEPTH = 6;

// Una pieza es más alta que ancha; el tamaño de cada una varía
const PIECE_WIDTH = 1.6;
const PIECE_HEIGHT = 2.4;
const MIN_PIECE_SCALE = 0.7;
const MAX_PIECE_SCALE = 1.5;
// Velocidad de giro de cada pieza, en radianes por segundo
const MIN_SPIN = 0.05;
const MAX_SPIN = 0.2;
// Las piezas flotan: suben y bajan un poco, sin salir de su sitio
const FLOAT_AMPLITUDE = 0.9;
const MIN_FLOAT_SPEED = 0.2;
const MAX_FLOAT_SPEED = 0.5;

const PIECE_COLOR = 0xa78bfa;
const BASE_OPACITY = 0.45;
// Destello: sube a 1 al cambiar algo y se apaga solo, más rápido cuanto mayor es este número
const FLASH_DECAY_PER_SECOND = 3;
const FLASH_OPACITY = 0.3;
const FLASH_GROWTH = 0.25;
const FLASH_WHITENING = 0.6;

// Tamaño del dibujo de cada símbolo, en píxeles, y de su letra
const GLYPH_TEXTURE_WIDTH = 96;
const GLYPH_TEXTURE_HEIGHT = 144;
const GLYPH_FONT_SIZE = 150;

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

// Destello breve de las piezas. Sin escena o con movimiento reducido no hace nada.
export function flash_scene() {
  if (scene_state) scene_state.flash();
}

// Dibuja un símbolo solo con su contorno, con un velo muy tenue por dentro, para que se lea sin tapar nada
function make_glyph_texture(THREE, glyph) {
  const canvas = document.createElement("canvas");
  canvas.width = GLYPH_TEXTURE_WIDTH;
  canvas.height = GLYPH_TEXTURE_HEIGHT;
  const context = canvas.getContext("2d");
  context.font = `700 ${GLYPH_FONT_SIZE}px ui-monospace, "Cascadia Code", Consolas, "Courier New", monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const x = canvas.width / 2;
  const y = canvas.height / 2;
  context.fillStyle = "rgba(255, 255, 255, 0.25)";
  context.fillText(glyph, x, y);
  context.lineWidth = 3;
  context.strokeStyle = "rgba(255, 255, 255, 0.95)";
  context.strokeText(glyph, x, y);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function random_between(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

function build_scene(THREE, canvas) {
  const reduced_motion_query = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Los símbolos son formas de colores suaves: no necesitan suavizado de bordes.
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  camera.position.z = CAMERA_Z;

  const pieces_per_glyph = window.innerWidth < SMALL_SCREEN_WIDTH ? PIECES_PER_GLYPH_SMALL_SCREEN : PIECES_PER_GLYPH_LARGE_SCREEN;
  const geometry = new THREE.PlaneGeometry(PIECE_WIDTH, PIECE_HEIGHT);

  // Cada símbolo es una malla con su textura, y todas sus piezas se dibujan de una vez. Se ven por las dos caras al girar.
  const groups = GLYPHS.map((glyph) => {
    const material = new THREE.MeshBasicMaterial({
      map: make_glyph_texture(THREE, glyph),
      color: PIECE_COLOR,
      transparent: true,
      opacity: BASE_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, pieces_per_glyph);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Las posiciones cambian cada cuadro: el cálculo de visibilidad por caja no sirve, así que se dibuja siempre
    mesh.frustumCulled = false;
    scene.add(mesh);
    const pieces = Array.from({ length: pieces_per_glyph }, () => ({
      unit_x: random_between(-1, 1),
      unit_y: random_between(-1, 1),
      unit_z: random_between(-1, 1),
      scale: random_between(MIN_PIECE_SCALE, MAX_PIECE_SCALE),
      rotation_x: random_between(0, Math.PI * 2),
      rotation_y: random_between(0, Math.PI * 2),
      rotation_z: random_between(0, Math.PI * 2),
      spin_x: random_between(MIN_SPIN, MAX_SPIN),
      spin_y: random_between(MIN_SPIN, MAX_SPIN),
      spin_z: random_between(MIN_SPIN, MAX_SPIN),
      float_speed: random_between(MIN_FLOAT_SPEED, MAX_FLOAT_SPEED),
      phase: random_between(0, Math.PI * 2),
    }));
    return { mesh, material, pieces };
  });

  const base_color = new THREE.Color(PIECE_COLOR);
  const flash_color = new THREE.Color(0xffffff);
  const placeholder = new THREE.Object3D();

  let half_width = 1;
  let half_height = 1;
  let size_factor = 1;
  let frame_id = 0;
  let last_render_time = 0;
  let flash_level = 0;

  function place_pieces(time) {
    const growth = 1 + FLASH_GROWTH * flash_level;
    const float_factor = reduced_motion_query.matches ? 0 : 1;
    groups.forEach(({ mesh, pieces }) => {
      pieces.forEach((piece, index) => {
        placeholder.position.set(
          piece.unit_x * half_width,
          piece.unit_y * half_height + Math.sin(time * piece.float_speed + piece.phase) * FLOAT_AMPLITUDE * float_factor * size_factor,
          piece.unit_z * FIELD_DEPTH,
        );
        placeholder.rotation.set(piece.rotation_x, piece.rotation_y, piece.rotation_z);
        placeholder.scale.setScalar(piece.scale * size_factor * growth);
        placeholder.updateMatrix();
        mesh.setMatrixAt(index, placeholder.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  function update(time, delta) {
    if (!reduced_motion_query.matches) {
      groups.forEach(({ pieces }) =>
        pieces.forEach((piece) => {
          piece.rotation_x += piece.spin_x * delta;
          piece.rotation_y += piece.spin_y * delta;
          piece.rotation_z += piece.spin_z * delta;
        }),
      );
    }

    flash_level *= Math.exp(-FLASH_DECAY_PER_SECOND * delta);
    if (flash_level < 0.002) flash_level = 0;
    groups.forEach(({ material }) => {
      material.opacity = BASE_OPACITY + FLASH_OPACITY * flash_level;
      material.color.copy(base_color).lerp(flash_color, flash_level * FLASH_WHITENING);
    });
    place_pieces(time);
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
    // En pantallas estrechas las piezas se achican en proporción, para que no tapen todo el fondo
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
