// La interfaz que flota sobre la escena: barra superior, cajones, leyenda, diálogos, atajos de teclado y avisos. Este archivo
// enlaza la página con las acciones que le pasa main.js (`handlers`) y arma los paneles (parámetros, indicadores, inspección,
// disrupciones y avisos); no sabe nada del 3D y de la simulación solo lee lo que le pasan en `update`.

import { SKU_COUNT, SPEED_FACTORS, sku_color } from "./config.js";
import { build_alerts, build_disruptions } from "./ui_alerts.js";
import { build_inspector } from "./ui_inspector.js";
import { build_kpi_panel } from "./ui_kpis.js";
import { build_params_panel } from "./ui_params.js";

// Cada cuánto se refresca la lista de entidades del panel de inspección, si está abierto (ms reales)
const LIST_REFRESH_MILLISECONDS = 2000;
const QUALITY_NOTICE_MILLISECONDS = 10000;

const NARROW_QUERY = "(max-width: 1099px)";
const SEED_MAX = 4294967295;
const DRAWER_IDS = ["params_drawer", "kpis_drawer", "inspector_drawer", "disruptions_drawer"];
// Estos dos comparten el centro de la pantalla: abrir uno cierra el otro
const CENTER_DRAWER_IDS = ["inspector_drawer", "disruptions_drawer"];
const TEXT_INPUT_TYPES = new Set(["text", "number", "search", "email", "url", "tel", "password"]);

function by_id(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta el elemento #${id} en la página`);
  return element;
}

// ¿Está la persona escribiendo? Entonces las letras y los números no son atajos
function is_typing_target(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  return target.tagName === "INPUT" && TEXT_INPUT_TYPES.has(target.type);
}

// Los SKU que comparten color (hay 20 SKU y 12 colores), para la leyenda
function sku_legend_entries() {
  const by_color = new Map();
  for (let sku = 0; sku < SKU_COUNT; sku += 1) {
    const color = sku_color(sku);
    if (!by_color.has(color)) by_color.set(color, []);
    by_color.get(color).push(String(sku + 1).padStart(2, "0"));
  }
  return [...by_color.entries()].map(([color, numbers]) => ({ color, text: numbers.join(" y ") }));
}

export function create_ui(config, handlers) {
  let last_list_refresh = 0;
  let current_sim = null;
  let current_milliseconds = 0;
  const play_button = by_id("play_button");
  const clock_display = by_id("clock_display");
  const seed_input = by_id("seed_input");
  const reset_button = by_id("reset_button");
  const mute_button = by_id("mute_button");
  const fps_badge = by_id("fps_badge");
  const live_status = by_id("live_status");
  const scene_message = by_id("scene_message");
  const legend_panel = by_id("legend_panel");
  const legend_button = by_id("legend_button");
  const reset_dialog = by_id("reset_dialog");
  const reset_text = by_id("reset_text");
  const cancel_dialog = by_id("cancel_dialog");
  const cancel_text = by_id("cancel_text");
  const canvas = by_id("scene_canvas");
  const shortcuts_dialog = by_id("shortcuts_dialog");
  const top_bar = document.querySelector(".top_bar");
  const dock = document.querySelector(".dock");
  const narrow_screen = window.matchMedia(NARROW_QUERY);
  const dock_buttons = new Map([...document.querySelectorAll("[data-drawer]")].map((button) => [button.dataset.drawer, button]));

  // ---- Espacios que dejan la barra superior y la inferior, para que los cajones no las tapen ----
  function measure_space() {
    const root = document.documentElement;
    root.style.setProperty("--top_space", `${Math.ceil(top_bar.getBoundingClientRect().bottom)}px`);
    root.style.setProperty("--bottom_space", `${Math.ceil(window.innerHeight - dock.getBoundingClientRect().top) + 8}px`);
  }
  const space_observer = new ResizeObserver(measure_space);
  space_observer.observe(top_bar);
  space_observer.observe(dock);
  window.addEventListener("resize", measure_space);
  // Los iconos cambian el ancho de los botones al terminar de cargar la fuente, y con él el alto de la barra
  document.fonts.ready.then(measure_space);
  measure_space();

  // ---- Cajones ----
  // Con el lienzo enfocado, Enter abre la lista de Inspección: es la forma de elegir algo sin el mouse
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "Enter") open_drawer("inspector_drawer");
  });

  function is_drawer_open(id) {
    return by_id(id).classList.contains("is_open");
  }

  function close_drawer(id, return_focus = true) {
    const drawer = by_id(id);
    if (!drawer.classList.contains("is_open")) return;
    const had_focus = drawer.contains(document.activeElement);
    drawer.classList.remove("is_open");
    drawer.inert = true;
    dock_buttons.get(id).setAttribute("aria-expanded", "false");
    if (had_focus && return_focus) dock_buttons.get(id).focus();
  }

  function open_drawer(id, move_focus = true) {
    // En pantallas estrechas los cajones suben desde abajo y se tapan entre sí: se deja uno abierto a la vez
    if (narrow_screen.matches) DRAWER_IDS.filter((other) => other !== id).forEach((other) => close_drawer(other, false));
    else if (CENTER_DRAWER_IDS.includes(id)) CENTER_DRAWER_IDS.filter((other) => other !== id).forEach((other) => close_drawer(other, false));
    const drawer = by_id(id);
    drawer.classList.add("is_open");
    drawer.inert = false;
    dock_buttons.get(id).setAttribute("aria-expanded", "true");
    if (id === "inspector_drawer" && current_sim) inspector.refresh_list(current_sim, true);
    if (move_focus) drawer.querySelector("[data-close_drawer]").focus();
  }

  dock_buttons.forEach((button, id) => {
    button.addEventListener("click", () => (is_drawer_open(id) ? close_drawer(id) : open_drawer(id)));
  });
  document.querySelectorAll("[data-close_drawer]").forEach((button) => {
    button.addEventListener("click", () => close_drawer(button.dataset.close_drawer));
  });

  // ---- Leyenda ----
  function set_legend_open(open) {
    legend_panel.hidden = !open;
    legend_button.setAttribute("aria-expanded", String(open));
  }
  legend_button.addEventListener("click", () => set_legend_open(legend_panel.hidden));

  const sku_legend = by_id("sku_legend");
  sku_legend_entries().forEach((entry) => {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = entry.color;
    item.append(swatch, entry.text);
    sku_legend.append(item);
  });

  // ---- Barra superior ----
  play_button.addEventListener("click", () => handlers.on_toggle_play());
  document.querySelectorAll(".speed_input").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) handlers.on_speed(Number(input.value));
    });
  });
  by_id("rotate_left_button").addEventListener("click", () => handlers.on_rotate(-1));
  by_id("rotate_right_button").addEventListener("click", () => handlers.on_rotate(1));
  by_id("zoom_in_button").addEventListener("click", () => handlers.on_zoom(1));
  by_id("zoom_out_button").addEventListener("click", () => handlers.on_zoom(-1));
  by_id("fit_button").addEventListener("click", () => handlers.on_fit());
  mute_button.addEventListener("click", () => handlers.on_toggle_mute());

  // ---- Reinicio con confirmación ----
  function read_seed() {
    const seed = Number(seed_input.value);
    return seed_input.value.trim() !== "" && Number.isInteger(seed) && seed >= 0 && seed <= SEED_MAX ? seed : null;
  }

  function ask_reset() {
    const seed = read_seed();
    if (seed === null) {
      announce("La semilla debe ser un número entero entre 0 y 4.294.967.295.");
      seed_input.focus();
      return;
    }
    reset_text.textContent = `Se vuelve al inicio con la semilla ${seed} y se pierde el avance actual.`;
    reset_dialog.showModal();
  }

  reset_button.addEventListener("click", ask_reset);
  by_id("reset_cancel_button").addEventListener("click", () => reset_dialog.close());
  by_id("reset_confirm_button").addEventListener("click", () => {
    const seed = read_seed();
    reset_dialog.close();
    if (seed !== null) handlers.on_reset(seed);
  });
  seed_input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") ask_reset();
  });
  by_id("shortcuts_button").addEventListener("click", () => shortcuts_dialog.showModal());
  by_id("factory_reset_button").addEventListener("click", () => handlers.on_factory_reset());

  // ---- Cancelar un pedido: una confirmación breve con las tres salidas ----
  let pending_order = null;
  function ask_cancel(order) {
    if (!order.is_cancellable) {
      announce(`El pedido #${order.id} ya no se puede cancelar.`);
      return;
    }
    pending_order = order;
    cancel_text.textContent = `Las cajas del pedido #${order.id} desaparecen de donde estén y vuelven al stock del activo, y su casilla del muro queda libre. "Cancelar y reprocesar" además crea un pedido nuevo con las mismas líneas.`;
    cancel_dialog.showModal();
  }
  function finish_cancel(reprocess) {
    const order = pending_order;
    pending_order = null;
    cancel_dialog.close();
    if (order) handlers.on_cancel_order(order.id, reprocess);
  }
  by_id("cancel_back_button").addEventListener("click", () => {
    pending_order = null;
    cancel_dialog.close();
  });
  by_id("cancel_confirm_button").addEventListener("click", () => finish_cancel(false));
  by_id("cancel_reprocess_button").addEventListener("click", () => finish_cancel(true));

  // ---- Paneles ----
  build_params_panel(config, by_id("params_body"), {
    on_needs_restart: (parameter) => announce(`${parameter.label}: se aplica al reiniciar.`),
  });
  const kpi_panel = build_kpi_panel(by_id("kpis_body"));
  const inspector = build_inspector(
    {
      details: by_id("selection_details"),
      problem_list: by_id("problem_list"),
      problem_empty: by_id("problem_empty"),
      search: by_id("entity_search"),
      count: by_id("entity_count"),
      list: by_id("entity_list"),
    },
    { on_select: (entity) => handlers.on_select(entity), on_cancel: ask_cancel },
  );
  const alerts = build_alerts(by_id("alert_stack"), { on_select: (entity) => handlers.on_select(entity), on_cancel: ask_cancel });
  const disruptions = build_disruptions(by_id("disruptions_drawer"), { on_toggle: (kind) => handlers.on_toggle_disruption(kind) });

  // ---- Atajos de teclado ----
  function close_floating() {
    if (!legend_panel.hidden) {
      set_legend_open(false);
      legend_button.focus();
      return true;
    }
    const open_id = DRAWER_IDS.find(is_drawer_open);
    if (open_id) {
      close_drawer(open_id);
      return true;
    }
    return false;
  }

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (reset_dialog.open || shortcuts_dialog.open || cancel_dialog.open) return;
    if (event.key === "Escape") {
      if (close_floating()) event.preventDefault();
      return;
    }
    if (is_typing_target(event.target)) return;
    const key = event.key.toLowerCase();
    // Una barra espaciadora sobre un botón o un enlace es su propio clic; no se le quita
    const on_activatable = event.target instanceof HTMLElement && ["BUTTON", "A", "SUMMARY"].includes(event.target.tagName);
    if (key === " " && !on_activatable) {
      event.preventDefault();
      handlers.on_toggle_play();
    } else if (key === "q") handlers.on_rotate(-1);
    else if (key === "e") handlers.on_rotate(1);
    else if (key === "m") handlers.on_toggle_mute();
    else if (key === "f") handlers.on_toggle_fps();
    else if (key === "r") {
      event.preventDefault();
      ask_reset();
    } else if (key === "?") shortcuts_dialog.showModal();
    else if (/^[1-9]$/.test(key) && Number(key) <= SPEED_FACTORS.length) handlers.on_speed(SPEED_FACTORS[Number(key) - 1]);
  });

  // ---- Lo que main.js actualiza ----
  function announce(text) {
    // Se vacía primero para que repetir el mismo mensaje se vuelva a anunciar
    live_status.textContent = "";
    live_status.textContent = text;
  }

  return {
    announce,
    set_clock_text(text) {
      clock_display.textContent = text;
    },
    set_playing(playing) {
      play_button.setAttribute("aria-label", playing ? "Pausar" : "Reproducir");
      play_button.querySelector("i").className = playing ? "fa-solid fa-pause" : "fa-solid fa-play";
    },
    set_speed(factor) {
      const input = document.getElementById(`speed_${factor}`);
      if (input) input.checked = true;
    },
    set_muted(muted) {
      mute_button.setAttribute("aria-pressed", String(muted));
    },
    set_seed(seed) {
      seed_input.value = String(seed);
    },
    set_fps_visible(visible) {
      fps_badge.hidden = !visible;
    },
    set_fps_text(text) {
      fps_badge.textContent = text;
    },
    // Un aviso que se queda 10 segundos reales entre los avisos de la escena
    show_quality_notice(text) {
      alerts.notice(text, current_milliseconds + QUALITY_NOTICE_MILLISECONDS);
    },
    show_scene_message() {
      scene_message.hidden = false;
    },
    set_scene_summary(text) {
      canvas.setAttribute("aria-label", `${text} Con el lienzo enfocado, las flechas mueven la vista, más y menos acercan, Q y E giran.`);
    },
    // Lo que elige la persona (con un clic o desde la lista): se muestra en Inspección, que se abre sin quitarle el foco a nadie
    show_selection(entity, now) {
      inspector.show(entity, now);
      if (entity && !is_drawer_open("inspector_drawer")) open_drawer("inspector_drawer", false);
    },
    // Se llama unas veces por segundo (tiempo real) con la simulación actual
    update(sim, real_milliseconds) {
      current_sim = sim;
      current_milliseconds = real_milliseconds;
      kpi_panel.update(sim.get_kpis());
      alerts.update(sim, real_milliseconds);
      disruptions.update(sim);
      inspector.update(sim);
      if (is_drawer_open("inspector_drawer") && real_milliseconds - last_list_refresh >= LIST_REFRESH_MILLISECONDS) {
        last_list_refresh = real_milliseconds;
        inspector.refresh_list(sim);
      }
    },
    // Al reiniciar la simulación todo lo anterior deja de existir
    reset_panels(sim) {
      alerts.clear();
      inspector.show(null, sim.now);
      inspector.refresh_list(sim, true);
    },
    refresh_list(sim) {
      inspector.refresh_list(sim, true);
    },
  };
}
