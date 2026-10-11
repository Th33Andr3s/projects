// Lo que mueve la escena: carga de Three.js y el bucle de dibujo. El contenido de la escena está en renderer.js y static_scene.js;
// aquí solo se prepara el terreno para que funcione y se detenga como pide CLAUDE.md 2.10.
//
// Reglas de CLAUDE.md 2.10: bucle con requestAnimationFrame (nunca setInterval), tope de cuadros por segundo, pixelRatio
// máximo de 2 (en renderer.js), tamaño que sigue al contenedor, pausa con la pestaña oculta y contenido usable aunque el 3D
// no cargue.
//
// Three.js se carga con import() dentro de start_scene, no con un import estático arriba: si la CDN falla o el navegador no
// tiene WebGL, el resto de la página sigue funcionando y este archivo no lo rompe.

const MAX_FPS = 60;
const MIN_FRAME_MILLISECONDS = 1000 / MAX_FPS;
// Si la pestaña estuvo oculta o el equipo se trabó, el siguiente cuadro no avanza la simulación de golpe
const MAX_DELTA_SECONDS = 0.25;
// Si la CDN no responde en este tiempo, se sigue sin 3D
const LOAD_TIMEOUT_MILLISECONDS = 8000;

let is_started = false;

// Llama a `update(delta_segundos)` en cada cuadro, a 60 por segundo como máximo, y se detiene mientras la pestaña esté oculta
export function start_animation_loop(update) {
  if (is_started) return;
  is_started = true;
  let frame_id = 0;
  let last_frame_time = 0;

  function frame(now) {
    frame_id = requestAnimationFrame(frame);
    const interval = now - last_frame_time;
    // Se salta el cuadro si todavía no toca; el margen de 2 ms evita saltarse uno de cada dos en pantallas de 60 Hz
    if (interval < MIN_FRAME_MILLISECONDS - 2) return;
    last_frame_time = now;
    update(Math.min(interval / 1000, MAX_DELTA_SECONDS));
  }

  function start() {
    if (frame_id || document.hidden) return;
    last_frame_time = performance.now();
    frame_id = requestAnimationFrame(frame);
  }

  function stop() {
    cancelAnimationFrame(frame_id);
    frame_id = 0;
  }

  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  start();
}

// Dice si el navegador puede dibujar en 3D, antes de bajar Three.js: así, sin WebGL, no se descarga nada ni se llena la consola de errores
function has_webgl() {
  try {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
  } catch {
    return false;
  }
}

// Carga Three.js y arma la escena sobre el lienzo. Devuelve el controlador listo o null si no se pudo (sin red, sin WebGL).
export async function start_scene(options) {
  if (!has_webgl()) return null;
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), LOAD_TIMEOUT_MILLISECONDS));
    const THREE = await Promise.race([import("three"), timeout]);
    const { build_renderer } = await import("./renderer.js");
    return build_renderer(THREE, options);
  } catch {
    return null;
  }
}
