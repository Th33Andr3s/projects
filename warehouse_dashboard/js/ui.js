// La interfaz de la página: la barra que flota sobre la bodega en la primera pantalla, la tarjeta de lo que se elige con un clic,
// la barra de secciones y las secciones de abajo (patio y muelles, inventario, parámetros, indicadores, inspección y
// disrupciones), más los diálogos y los atajos de teclado. Este archivo enlaza la página con las acciones que le pasa main.js
// (`handlers`); no sabe nada del 3D y de la simulación solo lee lo que le pasan en `update`.

import { SPEED_FACTORS } from "./config.js";
import { CATEGORIES } from "./catalog.js";
import { MAX_MANUAL_TRUCKS } from "./truck_schedule.js";
import { build_alerts, build_disruptions } from "./ui_alerts.js";
import { build_catalog_panel } from "./ui_catalog.js";
import { build_dispatch_panel } from "./ui_dispatch.js";
import { build_economy_panel } from "./ui_economy.js";
import { build_inspector } from "./ui_inspector.js";
import { build_inventory_panel } from "./ui_inventory.js";
import { build_kpi_panel } from "./ui_kpis.js";
import { build_map_panel } from "./ui_map.js";
import { build_params_panel } from "./ui_params.js";
import { build_yard_panel } from "./ui_yard.js";

// Cada cuánto (ms reales) se refrescan las partes más pesadas de las secciones de abajo
const LIST_REFRESH_MILLISECONDS = 2000;
const INVENTORY_REFRESH_MILLISECONDS = 1000;
const QUALITY_NOTICE_MILLISECONDS = 10000;
const WHEEL_HINT_MILLISECONDS = 2500;
// Lo que debe asomar de las secciones para considerarlas a la vista (px)
const SECTIONS_VISIBLE_MARGIN = 24;
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
  const reset_button = by_id("reset_button");
  const mute_button = by_id("mute_button");
  const ecommerce_button = by_id("ecommerce_button");
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

  // ---- Sección activa en la barra de secciones ----
  // Marca con aria-current el enlace de la sección que va ocupando la pantalla (la última cuyo borde superior ya pasó por debajo de la
  // barra) y, si la barra se desplaza de lado (pantallas angostas), deja ese enlace a la vista. Se calcula en el desplazamiento, pero a
  // lo más una vez por cuadro.
  const section_nav = by_id("section_nav");
  const nav_links = [...section_nav.querySelectorAll(".nav_link")]
    .map((link) => ({ link, target: document.getElementById(link.getAttribute("href").slice(1)) }))
    .filter((entry) => entry.target);
  let nav_frame = 0;
  let active_nav_link = null;
  function update_active_section() {
    nav_frame = 0;
    // En escritorio la barra es lateral (no tapa lo de arriba); en pantallas angostas es una banda arriba y hay que descontarla
    const is_sidebar = window.getComputedStyle(section_nav).position === "fixed";
    const threshold = (is_sidebar ? 0 : section_nav.offsetHeight) + SECTIONS_VISIBLE_MARGIN * 2;
    const at_bottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    let active = nav_links[0];
    nav_links.forEach((entry) => {
      if (entry.target.getBoundingClientRect().top <= threshold) active = entry;
    });
    // Una sección final corta nunca llegaría arriba: al llegar al fondo de la página se da por activa la última
    if (at_bottom) active = nav_links[nav_links.length - 1];
    if (!active || active.link === active_nav_link) return;
    active_nav_link = active.link;
    nav_links.forEach((entry) => {
      if (entry.link === active.link) entry.link.setAttribute("aria-current", "true");
      else entry.link.removeAttribute("aria-current");
    });
    // Solo se mueve la barra (no la página): el enlace activo se deja a la vista dentro de ella, de lado o hacia arriba y abajo
    const nav_box = section_nav.getBoundingClientRect();
    const link_box = active.link.getBoundingClientRect();
    const behavior = reduced_motion_query.matches ? "auto" : "smooth";
    if (is_sidebar) {
      if (link_box.top < nav_box.top || link_box.bottom > nav_box.bottom) {
        section_nav.scrollTo({ top: section_nav.scrollTop + link_box.top - nav_box.top - (nav_box.height - link_box.height) / 2, behavior });
      }
    } else if (link_box.left < nav_box.left || link_box.right > nav_box.right) {
      section_nav.scrollTo({ left: section_nav.scrollLeft + link_box.left - nav_box.left - (nav_box.width - link_box.width) / 2, behavior });
    }
  }
  function schedule_active_section() {
    if (!nav_frame) nav_frame = window.requestAnimationFrame(update_active_section);
  }
  window.addEventListener("scroll", schedule_active_section, { passive: true });
  window.addEventListener("resize", schedule_active_section);
  update_active_section();

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
    if (yard.arrivals_blocked) {
      announce("Las llegadas de camiones están detenidas: reanúdalas en Patio y muelles para hacer llegar camiones.");
      return;
    }
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
  function ask_reset() {
    reset_text.textContent = "Se vuelve al inicio y se pierde el avance actual: el inventario empieza en cero, el e-commerce queda apagado y el azar de camiones y pedidos es otro. Los parámetros y la configuración del patio se conservan.";
    // Si la corrida ya despachó pedidos, se ofrece bajar su KPI OTD antes de perderlo
    const has_otd = Boolean(current_sim) && dispatch_panel.has_deliveries(current_sim);
    by_id("reset_otd_label").hidden = !has_otd;
    reset_dialog.showModal();
  }

  reset_button.addEventListener("click", () => ask_reset());
  ecommerce_button.addEventListener("click", () => handlers.on_toggle_ecommerce());
  by_id("reset_cancel_button").addEventListener("click", () => reset_dialog.close());
  by_id("reset_confirm_button").addEventListener("click", () => {
    reset_dialog.close();
    if (current_sim && !by_id("reset_otd_label").hidden && by_id("reset_otd_check").checked) dispatch_panel.download_otd(current_sim);
    handlers.on_reset();
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
  const economy_panel = build_economy_panel(by_id("economy_body"));
  const dispatch_panel = build_dispatch_panel(by_id("dispatch_body"), yard);
  const map_panel = build_map_panel(by_id("map_body"));
  const catalog_panel = build_catalog_panel(by_id("catalog_body"), config, handlers.merchandise);
  build_params_panel(config, by_id("params_body"));
  const kpi_panel = build_kpi_panel(by_id("kpis_body"));
  const inspector = build_inspector(
    {
      details: by_id("selection_details"),
      problem_list: by_id("problem_list"),
      problem_empty: by_id("problem_empty"),
      search: by_id("entity_search"),
      group: by_id("entity_group"),
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
    catalog_panel.update(sim);
    yard_panel.update(sim);
    dispatch_panel.update(sim);
    map_panel.update(sim);
    if (force || real_milliseconds - last_inventory_refresh >= INVENTORY_REFRESH_MILLISECONDS) {
      last_inventory_refresh = real_milliseconds;
      inventory_panel.update(sim);
      economy_panel.update(sim);
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
    if (reset_dialog.open || shortcuts_dialog.open || cancel_dialog.open || mass_cancel_dialog.open || by_id("merch_dialog").open) return;
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
    // El interruptor del e-commerce: encendido deja nacer pedidos de clientes, apagado no
    set_ecommerce(enabled) {
      ecommerce_button.setAttribute("aria-pressed", String(enabled));
      ecommerce_button.querySelector("span").textContent = enabled ? "E-commerce encendido" : "E-commerce apagado";
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
      map_panel.reset();
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
