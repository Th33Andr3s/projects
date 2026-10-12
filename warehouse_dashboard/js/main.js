// Arranque y bucle del simulador: une el reloj, la simulación, la escena 3D, la interfaz y el sonido. Aquí se decide qué pasa
// cuando la persona elige algo, cancela un pedido, activa una disrupción, reinicia o vuelve a los valores de
// fábrica, y se guardan y recuperan los ajustes.

import { Config, SIM_START_HOUR } from "./config.js";
import { SimClock } from "./sim_clock.js";
import { build_layout } from "./layout.js";
import { YardConfig } from "./yard_config.js";
import { Simulation } from "./simulation.js";
import { start_animation_loop, start_scene } from "./animations.js";
import { attach_camera_controls } from "./camera_controls.js";
import { create_ui } from "./ui.js";
import { create_audio } from "./audio.js";
import { clear_settings, load_settings, save_settings } from "./settings.js";
import { format_clock_display, format_fps } from "./format.js";
import { SKUS, catalog_to_json, default_catalog } from "./catalog.js";
import { allocation_from_json, allocation_to_json, default_allocation_json } from "./active_layout.js";

// Cada cuánto se calculan los cuadros por segundo y a partir de cuántos se considera que el equipo no da abasto
const FPS_WINDOW_SECONDS = 0.5;
const LOW_FPS_LIMIT = 40;
const LOW_FPS_SECONDS = 3;
// Las sombras solo se encienden en pantallas anchas
const WIDE_SCREEN_QUERY = "(min-width: 900px)";
// Cada cuánto (segundos reales) se refresca la interfaz, el sonido continuo y el resumen para lectores de pantalla
const UI_UPDATE_SECONDS = 0.25;
const AUDIO_UPDATE_SECONDS = 0.25;
const SUMMARY_UPDATE_SECONDS = 2;
const SAVE_DELAY_SECONDS = 0.8;

const config = new Config();
const clock = new SimClock();
const audio = create_audio();
// La bodega se dibuja siempre con todo lo que los sliders pueden abrir; la simulación decide qué está en servicio
const layout = build_layout();

const yard = new YardConfig();
const saved = load_settings();
if (saved.params) config.load(saved.params);
if (saved.yard) yard.load(saved.yard);

// El día 1 es hoy y arranca a las 6 de la mañana. Las fechas de los camiones se escriben con el reloj de la persona, así que se
// usa Date.UTC con las partes locales: así no hay saltos por zona horaria ni por cambio de hora.
function today_start_ms() {
  const today = new Date();
  return Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), SIM_START_HOUR, 0, 0);
}

// Qué producto va en cada piso del activo: lo guardado o la distribución de fábrica. La escena estática lo lee de `layout`.
const allocation = allocation_from_json(saved.allocation);
layout.allocation = allocation;

// Cada corrida usa un azar distinto: la semilla sale del navegador y no se le pide a la persona
function random_seed() {
  return window.crypto.getRandomValues(new Uint32Array(1))[0];
}

let sim = new Simulation(config, yard, layout, random_seed(), today_start_ms(), allocation);
let is_muted = saved.muted === true;
let is_fps_visible = false;
let scene = null;
let camera_controls = null;
let last_clock_text = "";
let real_time = 0;
let ui_timer = 0;
let audio_timer = 0;
let summary_timer = 0;
let save_pending = false;
let save_timer = 0;

// Una vez que las sombras se bajan por falta de fluidez, no se vuelven a encender solas
let shadows_dropped = false;
let fps_frames = 0;
let fps_time = 0;
let low_fps_time = 0;

function request_save() {
  save_pending = true;
  save_timer = 0;
}

function current_settings() {
  return { params: config.to_json(), yard: yard.to_json(), speed: clock.speed_factor, muted: is_muted, catalog: catalog_to_json(), allocation: allocation_to_json(allocation) };
}

function save_now() {
  save_pending = false;
  save_settings(current_settings());
}

config.subscribe(request_save);
yard.subscribe(request_save);

// Elegir algo (con un clic en la escena o desde una lista): se resalta, se muestra su detalle y, si viene de una lista o de
// un aviso, la vista se acerca a donde está
function select_entity(entity, move_camera) {
  if (scene) scene.entities.set_selected(entity);
  ui.show_selection(entity, sim.now);
  if (!entity || !move_camera) return;
  // Si se eligió desde una lista de abajo, la página sube a la bodega y la vista se acerca a lo elegido
  ui.reveal_scene();
  if (scene && entity.x !== undefined) scene.focus(entity.x, entity.z);
}

const ui = create_ui(config, yard, {
  on_toggle_play() {
    clock.paused = !clock.paused;
    ui.set_playing(!clock.paused);
    ui.announce(clock.paused ? "Simulación en pausa." : "Simulación en marcha.");
  },
  on_speed(factor) {
    clock.set_speed(factor);
    ui.set_speed(factor);
    ui.announce(`Velocidad ${factor}×.`);
    request_save();
  },
  on_reset() {
    clock.reset();
    sim.dispose();
    sim = new Simulation(config, yard, layout, random_seed(), today_start_ms(), allocation);
    if (scene) scene.attach_simulation(sim);
    ui.set_playing(true);
    ui.set_speed(1);
    ui.set_ecommerce(sim.ecommerce_enabled);
    ui.reset_panels(sim);
    ui.update(sim, real_time * 1000);
    ui.announce("Simulación reiniciada. Inventario en cero y e-commerce apagado.");
    request_save();
  },
  // Mercancía: el catálogo y la distribución del activo nuevos se guardan y la página se recarga, así toda la bodega se arma de cero
  merchandise: {
    catalog: catalog_to_json(),
    allocation: allocation_to_json(allocation),
    keys: SKUS.map((sku) => sku.key),
    factory: () => ({ catalog: default_catalog(), allocation: default_allocation_json(default_catalog()) }),
    on_apply(catalog, allocation_json) {
      save_settings({ ...current_settings(), catalog, allocation: allocation_json });
      window.location.reload();
    },
  },
  on_toggle_ecommerce() {
    sim.set_ecommerce(!sim.ecommerce_enabled);
    ui.set_ecommerce(sim.ecommerce_enabled);
    ui.announce(sim.ecommerce_enabled ? "E-commerce encendido: llegan pedidos de clientes." : "E-commerce apagado: no entran pedidos nuevos; los que están en proceso terminan.");
  },
  on_factory_reset() {
    config.reset();
    yard.reset();
    clock.set_speed(1);
    ui.set_speed(1);
    clear_settings();
    save_pending = false;
    ui.announce("Valores de fábrica restaurados.");
  },
  on_rotate(step) {
    if (!scene) return;
    scene.rotate(step);
    ui.announce(step > 0 ? "Vista girada 90° a la derecha." : "Vista girada 90° a la izquierda.");
  },
  on_zoom(direction) {
    if (scene) scene.zoom(direction);
  },
  on_fit() {
    if (scene) scene.fit();
  },
  on_toggle_mute() {
    is_muted = !is_muted;
    audio.set_muted(is_muted);
    ui.set_muted(is_muted);
    ui.announce(is_muted ? "Sonido silenciado." : "Sonido activado.");
    request_save();
  },
  on_toggle_fps() {
    is_fps_visible = !is_fps_visible;
    ui.set_fps_visible(is_fps_visible);
  },
  on_select(entity) {
    select_entity(entity, true);
  },
  on_send_trucks(count) {
    const entries = sim.receiving.schedule.add_manual(count, sim.now);
    const first = entries[0].id;
    const last = entries[entries.length - 1].id;
    ui.announce(
      `${count === 1 ? "Llega 1 camión" : `Llegan ${count} camiones`} ahora (${count === 1 ? `el ${first}` : `del ${first} al ${last}`}).${clock.paused ? " La simulación está en pausa: salen al reanudar." : ""}`,
    );
    ui.update(sim, real_time * 1000);
    return count;
  },
  on_toggle_disruption(kind) {
    sim.disruptions.toggle(kind, sim.now);
    ui.update(sim, real_time * 1000);
  },
  on_cancel_orders(scope) {
    const count = sim.cancel_orders(scope);
    ui.announce(count === 0 ? "No había pedidos para cancelar." : `${count} ${count === 1 ? "pedido cancelado" : "pedidos cancelados"}. Sus cajas volvieron al stock.`);
    ui.update(sim, real_time * 1000);
    ui.refresh_list(sim);
  },
  on_cancel_order(order_id, reprocess) {
    const result = sim.cancel_order(order_id, reprocess);
    if (!result.ok) {
      ui.announce("No se pudo cancelar: el pedido ya está completo, empacado o despachado.");
      return;
    }
    ui.announce(result.new_order ? `Pedido #${order_id} cancelado y reprocesado como el pedido #${result.new_order.id}.` : `Pedido #${order_id} cancelado. Sus cajas volvieron al stock.`);
    ui.update(sim, real_time * 1000);
    ui.refresh_list(sim);
  },
});

clock.set_speed(saved.speed || 1);
ui.set_speed(clock.speed_factor);
ui.set_ecommerce(sim.ecommerce_enabled);
ui.set_muted(is_muted);
audio.set_muted(is_muted);
ui.update(sim, 0);
ui.set_scene_summary(sim.describe_scene());

// El navegador no deja sonar nada antes de una interacción: el audio se prepara con la primera
["pointerdown", "keydown"].forEach((type) => window.addEventListener(type, () => audio.unlock(), { once: true }));
document.addEventListener("visibilitychange", () => audio.set_hidden(document.hidden));

// Cuadros por segundo: se promedian en ventanas cortas. Si bajan de LOW_FPS_LIMIT de forma sostenida, se apagan las sombras.
function track_fps(dt) {
  fps_frames += 1;
  fps_time += dt;
  if (fps_time < FPS_WINDOW_SECONDS) return;
  const fps = fps_frames / fps_time;
  fps_frames = 0;
  fps_time = 0;
  if (is_fps_visible) ui.set_fps_text(format_fps(fps));
  low_fps_time = fps < LOW_FPS_LIMIT ? low_fps_time + FPS_WINDOW_SECONDS : 0;
  if (scene && scene.shadows_on && low_fps_time >= LOW_FPS_SECONDS) {
    shadows_dropped = true;
    scene.set_shadows(false);
    ui.show_quality_notice("Se bajó la calidad de las sombras para mantener la fluidez.");
  }
}

// Lo continuo del sonido: cuántas bandas trabajan y si algún montacarga va en reversa
function update_audio() {
  const belts = sim.belts.filter((belt) => belt.kind !== "rail");
  const working = belts.filter((belt) => belt.is_running && belt.count > 0).length;
  const reversing = sim.forklifts.some((forklift) => forklift.is_reversing);
  audio.update({ running_belts_ratio: belts.length > 0 ? (working / belts.length) * 2.2 : 0, reversing, paused: clock.paused });
}

function update(dt) {
  real_time += dt;
  const steps = clock.steps_for(dt);
  for (let step = 0; step < steps; step += 1) sim.step(clock.step());

  const clock_text = format_clock_display(clock.clock_text, clock.day);
  if (clock_text !== last_clock_text) {
    last_clock_text = clock_text;
    ui.set_clock_text(clock_text);
  }

  const events = sim.drain_events();
  if (events.length > 0) audio.handle_events(events);

  if (scene) {
    camera_controls.update(dt);
    scene.on_events(events, sim.now);
    scene.sync(sim, clock.step_progress, real_time);
    scene.frame(dt);
  }

  ui_timer += dt;
  if (ui_timer >= UI_UPDATE_SECONDS) {
    ui_timer = 0;
    ui.update(sim, real_time * 1000);
  }
  audio_timer += dt;
  if (audio_timer >= AUDIO_UPDATE_SECONDS) {
    audio_timer = 0;
    update_audio();
  }
  summary_timer += dt;
  if (summary_timer >= SUMMARY_UPDATE_SECONDS) {
    summary_timer = 0;
    ui.set_scene_summary(sim.describe_scene());
  }
  if (save_pending) {
    save_timer += dt;
    if (save_timer >= SAVE_DELAY_SECONDS) save_now();
  }
  track_fps(dt);
}

async function start() {
  const canvas = document.getElementById("scene_canvas");
  const container = document.getElementById("scene_container");
  const reduced_motion_query = window.matchMedia("(prefers-reduced-motion: reduce)");
  const wide_screen_query = window.matchMedia(WIDE_SCREEN_QUERY);

  // El bucle arranca ya: el reloj, la simulación y la interfaz funcionan aunque el 3D tarde o no cargue
  start_animation_loop(update);

  const controller = await start_scene({ canvas, container, layout, reduced_motion: reduced_motion_query.matches });
  if (!controller) {
    ui.show_scene_message();
    return;
  }
  scene = controller;
  scene.attach_simulation(sim);
  controller.on_click = (ndc_x, ndc_y) => {
    const hit = controller.pick(ndc_x, ndc_y);
    select_entity(hit ? hit.entity : null, false);
  };
  controller.on_wheel_hint = () => ui.show_wheel_hint();
  camera_controls = attach_camera_controls(controller);

  new ResizeObserver(() => controller.resize()).observe(container);
  controller.set_shadows(wide_screen_query.matches && !shadows_dropped);
  wide_screen_query.addEventListener("change", () => controller.set_shadows(wide_screen_query.matches && !shadows_dropped));
  reduced_motion_query.addEventListener("change", () => controller.rig.set_reduced_motion(reduced_motion_query.matches));
}

start();
