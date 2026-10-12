// La interfaz de la página: la barra que flota sobre la bodega en la primera pantalla, la tarjeta de lo que se elige con un clic,
// la barra de secciones y las secciones de abajo (patio y muelles, inventario, parámetros, indicadores, inspección y
// disrupciones), más los diálogos y los atajos de teclado. Este archivo enlaza la página con las acciones que le pasa main.js
// (`handlers`); no sabe nada del 3D y de la simulación solo lee lo que le pasan en `update`.

import { SPEED_FACTORS } from "./config.js";
import { CATEGORIES } from "./catalog.js";
import { MAX_MANUAL_TRUCKS } from "./truck_schedule.js";
import { build_alerts, build_disruptions } from "./ui_alerts.js";
import { build_dispatch_panel } from "./ui_dispatch.js";
import { build_inspector } from "./ui_inspector.js";
import { build_inventory_panel } from "./ui_inventory.js";
import { build_kpi_panel } from "./ui_kpis.js";
import { build_params_panel } from "./ui_params.js";
import { build_yard_panel } from "./ui_yard.js";

// Cada cuánto (ms reales) se refrescan las partes más pesadas de las secciones de abajo
const LIST_REFRESH_MILLISECONDS = 2000;
const INVENTORY_REFRESH_MILLISECONDS = 1000;
const QUALITY_NOTICE_MILLISECONDS = 10000;
const WHEEL_HINT_MILLISECONDS = 2500;
// Lo que debe asomar de las secciones para considerarlas a la vista (px)
const SECTIONS_VISIBLE_MARGIN = 24;
const SEED_MAX = 4294967295;
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

export function create_ui(config, yard, handlers) {
  let last_list_refresh = 0;
  let last_inventory_refresh = 0;
  let current_sim = null;
  let current_milliseconds = 0;
  let sections_were_visible = false;
  let hint_timer = 0;
  const reduced_motion_query = window.matchMedia("(prefers-reduced-motion: reduce)");
  const hero = by_id("hero");
  const play_button = by_id("play_button");
  const nav_play_button = by_id("nav_play_button");
  const clock_display = by_id("clock_display");
  const nav_clock = by_id("nav_clock");
  const nav_alerts = by_id("nav_alerts");
  const seed_input = by_id("seed_input");
  const reset_button = by_id("reset_button");
  const mute_button = by_id("mute_button");
  const fps_badge = by_id("fps_badge");
  const live_status = by_id("live_status");
  const scene_message = by_id("scene_message");
  const legend_panel = by_id("legend_panel");
  const legend_button = by_id("legend_button");
  const selection_card = by_id("selection_card");
  const reset_dialog = by_id("reset_dialog");
  const reset_text = by_id("reset_text");
  const cancel_dialog = by_id("cancel_dialog");
  const cancel_text = by_id("cancel_text");
  const canvas = by_id("scene_canvas");
  const scene_hint = by_id("scene_hint");
  const shortcuts_dialog = by_id("shortcuts_dialog");
  const mass_cancel_dialog = by_id("mass_cancel_dialog");
  const cancel_problems_button = by_id("cancel_problems_button");
  const cancel_all_button = by_id("cancel_all_button");

  function scroll_options() {
    return { behavior: reduced_motion_query.matches ? "auto" : "smooth", block: "start" };
  }

  // ---- Ir y volver entre la bodega y las secciones ----
  // Con el lienzo enfocado, Enter lleva al buscador de Inspección: es la forma de elegir algo sin el mouse
  canvas.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const search = by_id("entity_search");
    by_id("inspector_section").scrollIntoView(scroll_options());
    search.focus({ preventScroll: true });
  });

  function sections_visible() {
    return window.scrollY + window.innerHeight > hero.offsetHeight + SECTIONS_VISIBLE_MARGIN;
  }

  // ---- Leyenda ----
  function set_legend_open(open) {
    legend_panel.hidden = !open;
    legend_button.setAttribute("aria-expanded", String(open));
  }
  legend_button.addEventListener("click", () => set_legend_open(legend_panel.hidden));

  const category_legend = by_id("category_legend");
  CATEGORIES.forEach((category) => {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = category.color;
    item.append(swatch, category.name);
    category_legend.append(item);
  });

  // ---- Barra superior y barra de secciones ----
  [play_button, nav_play_button].forEach((button) => button.addEventListener("click", () => handlers.on_toggle_play()));
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
  by_id("selection_close_button").addEventListener("click", () => handlers.on_select(null));

  // Llegada inmediata: se escribe cuántos camiones y llegan ya (también con Enter)
  const send_trucks_input = by_id("send_trucks_input");
  by_id("send_trucks_form").addEventListener("submit", (event) => {
    event.preventDefault();
    const count = Math.round(Number(send_trucks_input.value));
    if (!Number.isFinite(count) || count < 1) {
      announce("Escribe cuántos camiones quieres que lleguen, de 1 en adelante.");
      send_trucks_input.focus();
      return;
    }
    const sent = handlers.on_send_trucks(Math.min(count, MAX_MANUAL_TRUCKS));
    send_trucks_input.value = String(sent);
  });

  // ---- Reinicio con confirmación ----
  function read_seed() {
    const seed = Number(seed_input.value);
    return seed_input.value.trim() !== "" && Number.isInteger(seed) && seed >= 0 && seed <= SEED_MAX ? seed : null;
  }

  // `empty_inventory`: además de volver al inicio, deja en 0 los rellenos iniciales de la reserva y del activo
  let pending_empty_inventory = false;
  function ask_reset(empty_inventory = false) {
    const seed = read_seed();
    if (seed === null) {
      announce("La semilla debe ser un número entero entre 0 y 4.294.967.295.");
      seed_input.focus();
      return;
    }
    pending_empty_inventory = empty_inventory;
    const active_fill = config.get("initial_active_fill");
    const reserve_fill = config.get("initial_reserve_fill");
    if (empty_inventory) {
      reset_text.textContent = `Se vacía todo el inventario y se vuelve al inicio con la semilla ${seed}: el reloj, los camiones y los pedidos empiezan de nuevo, y los rellenos iniciales quedan en 0. La configuración del patio se conserva.`;
    } else {
      reset_text.textContent = `Se vuelve al inicio con la semilla ${seed} y se pierde el avance actual. La configuración del patio se conserva.`;
      // Si los parámetros de inicio dejan stock, el inventario no empieza en cero: se avisa
      if (active_fill > 0 || reserve_fill > 0) {
        reset_text.textContent += ` Ojo: los parámetros de inicio dejan el activo al ${active_fill} % y la reserva al ${reserve_fill} %, así que el inventario no empezará en cero (usa «Reiniciar inventario» para dejarlo en 0).`;
      }
    }
    // Si la corrida ya despachó pedidos, se ofrece bajar su KPI OTD antes de perderlo
    const has_otd = Boolean(current_sim) && dispatch_panel.has_deliveries(current_sim);
    by_id("reset_otd_label").hidden = !has_otd;
    reset_dialog.showModal();
  }

  reset_button.addEventListener("click", () => ask_reset(false));
  by_id("reset_inventory_button").addEventListener("click", () => ask_reset(true));
  by_id("reset_cancel_button").addEventListener("click", () => reset_dialog.close());
  by_id("reset_confirm_button").addEventListener("click", () => {
    const seed = read_seed();
    reset_dialog.close();
    if (current_sim && !by_id("reset_otd_label").hidden && by_id("reset_otd_check").checked) dispatch_panel.download_otd(current_sim);
    if (seed !== null) handlers.on_reset(seed, pending_empty_inventory);
  });
  seed_input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") ask_reset(false);
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

  // ---- Cancelación masiva: de todos los pedidos o solo de los que tienen problema ----
  let pending_scope = null;
  function ask_mass_cancel(scope) {
    if (!current_sim) return;
    const count = current_sim.cancellable_orders(scope).length;
    if (count === 0) {
      announce(scope === "problems" ? "No hay pedidos con problema para cancelar." : "No hay pedidos para cancelar.");
      return;
    }
    pending_scope = scope;
    const what = scope === "problems" ? (count === 1 ? "el pedido con problema" : `los ${count} pedidos con problema`) : count === 1 ? "el único pedido en proceso" : `los ${count} pedidos en proceso`;
    by_id("mass_cancel_text").textContent = `Se cancelan ${what}. Sus cajas desaparecen de donde estén y vuelven al stock del activo, y sus casillas del muro quedan libres. No se puede deshacer.`;
    mass_cancel_dialog.showModal();
  }
  cancel_problems_button.addEventListener("click", () => ask_mass_cancel("problems"));
  cancel_all_button.addEventListener("click", () => ask_mass_cancel("all"));
  by_id("mass_cancel_back_button").addEventListener("click", () => {
    pending_scope = null;
    mass_cancel_dialog.close();
  });
  by_id("mass_cancel_confirm_button").addEventListener("click", () => {
    const scope = pending_scope;
    pending_scope = null;
    mass_cancel_dialog.close();
    if (scope) handlers.on_cancel_orders(scope);
  });
  by_id("cancel_reprocess_button").addEventListener("click", () => finish_cancel(true));

  // ---- Secciones ----
  const yard_panel = build_yard_panel(by_id("yard_body"), yard, { on_send_trucks: (count) => handlers.on_send_trucks(count) });
  const inventory_panel = build_inventory_panel(by_id("inventory_body"));
  const dispatch_panel = build_dispatch_panel(by_id("dispatch_body"), yard);
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
  const disruptions = build_disruptions(by_id("disruptions_section"), { on_toggle: (kind) => handlers.on_toggle_disruption(kind) });

  // Lo que se cambia en el patio se ve de inmediato, sin esperar al refresco periódico
  yard.subscribe(() => {
    if (current_sim) {
      yard_panel.update(current_sim);
      dispatch_panel.update(current_sim);
    }
  });

  // Al bajar hasta las secciones se ponen al día de una vez
  window.addEventListener(
    "scroll",
    () => {
      const visible = sections_visible();
      if (visible && !sections_were_visible && current_sim) refresh_sections(current_sim, current_milliseconds, true);
      sections_were_visible = visible;
    },
    { passive: true },
  );

  // Los botones de cancelación masiva dicen cuántos pedidos tocan y se apagan si no hay ninguno
  function update_mass_cancel_buttons(sim) {
    [[cancel_problems_button, "cancel_problems_label", "problems", "Cancelar los pedidos con problema"], [cancel_all_button, "cancel_all_label", "all", "Cancelar todos los pedidos"]].forEach(([button, label_id, scope, text]) => {
      const count = sim.cancellable_orders(scope).length;
      const label = `${text} (${count})`;
      const target = by_id(label_id);
      if (target.textContent !== label) target.textContent = label;
      button.disabled = count === 0;
    });
  }

  function refresh_sections(sim, real_milliseconds, force) {
    update_mass_cancel_buttons(sim);
    kpi_panel.update(sim.get_kpis());
    disruptions.update(sim);
    inspector.update(sim);
    yard_panel.update(sim);
    dispatch_panel.update(sim);
    if (force || real_milliseconds - last_inventory_refresh >= INVENTORY_REFRESH_MILLISECONDS) {
      last_inventory_refresh = real_milliseconds;
      inventory_panel.update(sim);
    }
    if (force || real_milliseconds - last_list_refresh >= LIST_REFRESH_MILLISECONDS) {
      last_list_refresh = real_milliseconds;
      inspector.refresh_list(sim, force);
    }
  }

  // ---- Atajos de teclado ----
  // Escape cierra primero la leyenda y luego la tarjeta de lo elegido
  function close_floating() {
    if (!legend_panel.hidden) {
      set_legend_open(false);
      legend_button.focus();
      return true;
    }
    if (!selection_card.hidden) {
      handlers.on_select(null);
      return true;
    }
    return false;
  }

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (reset_dialog.open || shortcuts_dialog.open || cancel_dialog.open || mass_cancel_dialog.open) return;
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
      ask_reset(false);
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
      nav_clock.textContent = text;
    },
    set_playing(playing) {
      [play_button, nav_play_button].forEach((button) => {
        button.setAttribute("aria-label", playing ? "Pausar" : "Reproducir");
        button.querySelector("i").className = playing ? "fa-solid fa-pause" : "fa-solid fa-play";
      });
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
    // La rueda sola baja la página: se avisa un momento cómo acercar con el mouse
    show_wheel_hint() {
      scene_hint.hidden = false;
      window.clearTimeout(hint_timer);
      hint_timer = window.setTimeout(() => {
        scene_hint.hidden = true;
      }, WHEEL_HINT_MILLISECONDS);
    },
    // Si se eligió algo desde una lista o un aviso de más abajo, la página sube a la bodega para que se vea
    reveal_scene() {
      if (window.scrollY > 4) hero.scrollIntoView(scroll_options());
    },
    // Lo que elige la persona (con un clic o desde la lista): sale en la tarjeta sobre la bodega
    show_selection(entity, now) {
      inspector.show(entity, now);
      selection_card.hidden = !entity;
    },
    // Se llama unas veces por segundo (tiempo real) con la simulación actual
    update(sim, real_milliseconds) {
      current_sim = sim;
      current_milliseconds = real_milliseconds;
      alerts.update(sim, real_milliseconds);
      if (!selection_card.hidden) inspector.update(sim);
      const problems = sim.alerts.length;
      nav_alerts.hidden = problems === 0;
      if (problems > 0) {
        const text = `${problems} ${problems === 1 ? "aviso" : "avisos"}`;
        if (nav_alerts.textContent !== text) nav_alerts.textContent = text;
      }
      sections_were_visible = sections_visible();
      if (sections_were_visible) refresh_sections(sim, real_milliseconds, false);
    },
    // Al reiniciar la simulación todo lo anterior deja de existir
    reset_panels(sim) {
      alerts.clear();
      inspector.show(null, sim.now);
      selection_card.hidden = true;
      refresh_sections(sim, current_milliseconds, true);
    },
    refresh_list(sim) {
      inspector.refresh_list(sim, true);
    },
  };
}
