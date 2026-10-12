// La sección "Patio de recibo y muelles": cuántos camiones llegan en cada franja, qué muelles se usan, cómo va el parqueadero y la tabla de camiones programados con la restricción de cada uno (muelle fijo y
// franja desde la que puede entrar). Todo lo que se cambia aquí se guarda en la configuración del patio (yard_config.js).

import { DOCK_COUNT } from "./config.js";
import { CATEGORIES } from "./catalog.js";
import { format_number } from "./format.js";
import { SLOTS, MAX_TRUCKS_PER_SLOT, slot_label } from "./yard_config.js";
import { DAY_SECONDS, MAX_MANUAL_TRUCKS } from "./truck_schedule.js";
import { make_filter_bar, matches_search } from "./table_tools.js";

// Cuántos camiones terminados se siguen mostrando en el filtro de terminados, y cuántas decisiones del coordinador
const FINISHED_SHOWN = 30;
const COORDINATOR_LOG_SHOWN = 8;

function make(tag, class_name, text) {
  const element = document.createElement(tag);
  if (class_name) element.className = class_name;
  if (text !== undefined) element.textContent = text;
  return element;
}

function make_card(title) {
  const card = make("section", "yard_card");
  card.append(make("h3", "", title));
  return card;
}

function make_select(options, label) {
  const select = make("select", "table_select");
  select.setAttribute("aria-label", label);
  options.forEach(([value, text]) => {
    const option = make("option", "", text);
    option.value = value;
    select.append(option);
  });
  return select;
}

export function build_yard_panel(body, yard, handlers) {
  // ---------- Camiones por día ----------
  const counts_card = make_card("Camiones por día");
  const slot_fields = make("div", "slot_fields");
  SLOTS.forEach((slot) => {
    const label = make("label", "slot_field");
    label.append(make("span", "slot_name", slot.label), make("small", "", `${slot.start_hour} – ${slot.end_hour} h`));
    const input = make("input", "number_input");
    input.type = "number";
    input.min = "0";
    input.max = String(MAX_TRUCKS_PER_SLOT);
    input.step = "1";
    input.inputMode = "numeric";
    input.value = String(yard.get_count(slot.key));
    input.addEventListener("change", () => {
      yard.set_count(slot.key, input.value);
      input.value = String(yard.get_count(slot.key));
    });
    input.dataset.slot = slot.key;
    label.append(input);
    slot_fields.append(label);
  });
  const total_line = make("p", "yard_total");
  total_line.append("Total del día: ");
  const total_output = make("output", "yard_total_value");
  total_line.append(total_output);
  counts_card.append(slot_fields, total_line, make("p", "note", "De 10 de la noche a 6 de la mañana no llegan camiones."));

  // ---------- Muelles ----------
  const docks_card = make_card("Muelles de recepción");
  const dock_grid = make("div", "dock_grid");
  const dock_buttons = Array.from({ length: DOCK_COUNT }, (_, index) => {
    const button = make("button", "dock_toggle");
    button.type = "button";
    button.setAttribute("role", "switch");
    const name = make("strong", "", `Muelle ${index + 1}`);
    const state = make("span", "dock_state");
    button.append(name, state);
    button.addEventListener("click", () => yard.set_dock_blocked(index, !yard.is_dock_blocked(index)));
    dock_grid.append(button);
    return { button, state };
  });
  // Dos interruptores generales: cerrar todos los muelles, y detener la llegada de camiones hasta nueva orden
  const dock_actions = make("div", "dock_actions");
  const close_docks_button = make("button", "text_button text_button_small");
  close_docks_button.type = "button";
  const close_docks_icon = make("i", "fa-solid fa-lock");
  close_docks_icon.setAttribute("aria-hidden", "true");
  const close_docks_label = make("span");
  close_docks_button.append(close_docks_icon, close_docks_label);
  close_docks_button.addEventListener("click", () => yard.set_all_docks_blocked(!yard.all_docks_blocked));
  const stop_arrivals_button = make("button", "text_button text_button_small");
  stop_arrivals_button.type = "button";
  const stop_arrivals_icon = make("i", "fa-solid fa-ban");
  stop_arrivals_icon.setAttribute("aria-hidden", "true");
  const stop_arrivals_label = make("span");
  stop_arrivals_button.append(stop_arrivals_icon, stop_arrivals_label);
  stop_arrivals_button.addEventListener("click", () => yard.set_arrivals_blocked(!yard.arrivals_blocked));
  dock_actions.append(close_docks_button, stop_arrivals_button);
  const dock_status = make("p", "dock_status");
  dock_status.setAttribute("role", "status");
  docks_card.append(
    dock_actions,
    dock_status,
    dock_grid,
    make("p", "note", "Pulsa un muelle para bloquearlo o habilitarlo. Un camión que ya está en un muelle que se bloquea termina de descargar. Con las llegadas detenidas, los camiones programados no salen a la carretera (no llegan de golpe al reanudar) y el coordinador no pide ninguno; los que ya venían siguen su camino."),
  );

  // ---------- Parqueadero ----------
  const parking_card = make_card("Parqueadero de camiones");
  const parking_summary = make("p", "parking_summary");
  const parking_list = make("ol", "parking_list");
  parking_card.append(parking_summary, parking_list, make("p", "note", "Si todos los muelles están ocupados, los camiones se parquean en orden; cada vez que se libera un muelle pasa el que le toque."));

  // ---------- Coordinador de recibo ----------
  const coordinator_card = make_card("Coordinador de recibo");
  const coordinator_summary = make("p", "coordinator_summary");
  const coordinator_log = make("ol", "coordinator_log");
  coordinator_card.append(
    coordinator_summary,
    coordinator_log,
    make("p", "note", "Pide camiones de un producto cuando va a faltar, según los pedidos de clientes de las últimas horas y lo que ya viene en camino. Si lo que hay se acaba antes de que llegue ayuda, el camión es urgente y llega en una hora. Con el e-commerce apagado no pide nada. Se ajusta en Parámetros."),
  );

  // ---------- Llegada inmediata ----------
  const now_card = make_card("Hacer llegar camiones ahora");
  const now_form = make("form", "send_now_form");
  const now_label = make("label", "slot_field");
  now_label.append(make("span", "slot_name", "Cuántos camiones"));
  const now_input = make("input", "number_input");
  now_input.type = "number";
  now_input.min = "1";
  now_input.max = String(MAX_MANUAL_TRUCKS);
  now_input.step = "1";
  now_input.inputMode = "numeric";
  now_input.value = "4";
  now_label.append(now_input);
  const now_button = make("button", "text_button text_button_primary");
  now_button.type = "submit";
  now_button.append(make("i", "fa-solid fa-truck-fast"), make("span", "", "Llegar ahora"));
  now_button.firstChild.setAttribute("aria-hidden", "true");
  now_form.append(now_label, now_button);
  now_form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (yard.arrivals_blocked) return;
    const count = Math.round(Number(now_input.value));
    if (!Number.isFinite(count) || count < 1) {
      now_input.focus();
      return;
    }
    now_input.value = String(handlers.on_send_trucks(Math.min(count, MAX_MANUAL_TRUCKS)));
  });
  now_card.append(now_form, make("p", "note", "Salen a la carretera uno tras otro, además de los programados por franja."));

  const grid = make("div", "yard_grid");
  grid.append(now_card, counts_card, docks_card, coordinator_card, parking_card);

  // ---------- Camiones programados ----------
  const table_title = make("h3", "table_title", "Camiones programados");
  const toolbar = make("div", "table_toolbar");
  const filter_label = make("label", "filter_field filter_select");
  filter_label.append(make("span", "filter_label", "Mostrar"));
  const filter_select = make_select(
    [
      ["pending", "Pendientes y en el patio"],
      ["today", "Hoy"],
      ["tomorrow", "Mañana"],
      ["finished", "Terminados"],
    ],
    "Qué camiones mostrar",
  );
  filter_label.append(filter_select);
  // Además del día, se puede buscar un camión y quedarse con los que están en un estado
  const extra_filters = make_filter_bar([
    { kind: "search", label: "Buscar camión", placeholder: "Número, ruta o mercancía" },
    { kind: "select", label: "Estado", options: [["", "Todos"], ["scheduled", "Programados"], ["road", "En camino"], ["yard", "En el patio o en un muelle"]] },
  ]);
  toolbar.append(filter_label, extra_filters.bar);
  const table_note = make("p", "note", "A cada camión le puedes fijar un muelle y la franja desde la que puede entrar a él; mientras tanto espera parqueado.");
  const count_note = make("p", "note filter_count");
  count_note.setAttribute("role", "status");
  const wrapper = make("div", "table_scroll");
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-label", "Tabla de camiones programados");
  const table = make("table", "data_table");
  const head = make("thead");
  const head_row = make("tr");
  ["N.º", "Llegada", "Franja", "Ruta", "Mercancía", "Cajas", "Unidades", "Descargado", "Estado", "Muelle fijo", "Entra desde"].forEach((text) => head_row.append(make("th", "", text)));
  head.append(head_row);
  const table_body = make("tbody");
  table.append(head, table_body);
  wrapper.append(table);
  body.append(grid, table_title, toolbar, table_note, count_note, wrapper);

  // ---------- Filas ----------
  const rows = new Map();
  let signature = "";
  let force_rebuild = true;
  yard.subscribe((kind) => {
    if (kind === "reset") force_rebuild = true;
  });
  filter_select.addEventListener("change", () => {
    force_rebuild = true;
  });
  extra_filters.on_change(() => {
    force_rebuild = true;
  });

  // Dónde está un camión: programado (todavía no sale), en la carretera o ya dentro del predio
  function truck_place(entry) {
    if (!entry.spawned) return "scheduled";
    return !entry.truck || entry.truck.on_road ? "road" : "yard";
  }

  function visible_entries(sim) {
    const day = Math.floor(sim.now / DAY_SECONDS) + 1;
    const entries = sim.receiving.schedule.entries;
    let by_day;
    switch (filter_select.value) {
      case "today":
        by_day = entries.filter((entry) => entry.day === day);
        break;
      case "tomorrow":
        by_day = entries.filter((entry) => entry.day === day + 1);
        break;
      case "finished":
        by_day = entries.filter((entry) => entry.finished).slice(-FINISHED_SHOWN);
        break;
      default:
        by_day = entries.filter((entry) => !entry.finished);
    }
    const [query, place] = extra_filters.values();
    return by_day.filter((entry) => (place === "" || truck_place(entry) === place) && matches_search(query, `${entry.id} ${entry.route.text} ${CATEGORIES[entry.category_index].name} ${slot_label(entry.slot)}`));
  }

  function make_row(entry) {
    const row = make("tr");
    const cells = {};
    const add = (key, text) => {
      cells[key] = make("td", `cell_${key}`, text);
      row.append(cells[key]);
    };
    add("id", String(entry.id));
    add("arrival", entry.arrival_text);
    add("slot", slot_label(entry.slot));
    add("route", entry.route.text);
    const category = CATEGORIES[entry.category_index];
    add("category", category.name);
    const swatch = make("span", "swatch");
    swatch.style.background = category.color;
    cells.category.prepend(swatch);
    add("boxes", format_number(entry.box_count));
    add("units", format_number(entry.units));
    add("unloaded", "");
    add("status", "");
    const dock_select = make_select([["", "Cualquiera"], ...Array.from({ length: DOCK_COUNT }, (_, index) => [String(index), `Muelle ${index + 1}`])], `Muelle fijo del camión ${entry.id}`);
    const slot_select = make_select([["", "Cualquier hora"], ...SLOTS.map((slot) => [slot.key, slot.label])], `Franja desde la que puede entrar el camión ${entry.id}`);
    const rule = yard.get_rule(entry.id);
    dock_select.value = rule && rule.dock !== null ? String(rule.dock) : "";
    slot_select.value = rule && rule.from_slot !== null ? rule.from_slot : "";
    const save = () => yard.set_rule(entry.id, dock_select.value === "" ? null : Number(dock_select.value), slot_select.value === "" ? null : slot_select.value);
    dock_select.addEventListener("change", save);
    slot_select.addEventListener("change", save);
    const dock_cell = make("td");
    dock_cell.append(dock_select);
    const slot_cell = make("td");
    slot_cell.append(slot_select);
    row.append(dock_cell, slot_cell);
    return { row, cells };
  }

  function set_text(cell, text) {
    if (cell.textContent !== text) cell.textContent = text;
  }

  function update_rows(sim) {
    const entries = visible_entries(sim);
    const next_signature = entries.map((entry) => entry.id).join(",");
    // Mientras la persona tiene un selector de la tabla en uso no se redibuja, para no cerrarle la lista de opciones
    const is_editing = wrapper.contains(document.activeElement) && document.activeElement !== wrapper;
    if (force_rebuild || (next_signature !== signature && !is_editing)) {
      force_rebuild = false;
      signature = next_signature;
      rows.clear();
      table_body.replaceChildren();
      entries.forEach((entry) => {
        const made = make_row(entry);
        rows.set(entry.id, made);
        table_body.append(made.row);
      });
      if (entries.length === 0) {
        const empty = make("tr");
        const cell = make("td", "placeholder", "No hay camiones en este filtro.");
        cell.colSpan = 11;
        empty.append(cell);
        table_body.append(empty);
      }
    }
    set_text(count_note, `Mostrando ${entries.length} camiones.`);
    entries.forEach((entry) => {
      const made = rows.get(entry.id);
      if (!made) return;
      set_text(made.cells.arrival, entry.arrival_text);
      set_text(made.cells.unloaded, entry.spawned ? `${format_number(entry.unloaded_units || 0)} de ${format_number(entry.units)} u` : "—");
      set_text(made.cells.status, sim.receiving.schedule.status_text(entry));
    });
  }

  return {
    update(sim) {
      total_output.textContent = String(yard.daily_total);
      slot_fields.querySelectorAll("input").forEach((input) => {
        if (document.activeElement !== input) input.value = String(yard.get_count(input.dataset.slot));
      });
      sim.receiving.docks.forEach((dock, index) => {
        const { button, state } = dock_buttons[index];
        const blocked = yard.is_dock_blocked(index);
        button.setAttribute("aria-checked", String(!blocked));
        button.classList.toggle("is_blocked", blocked);
        button.classList.toggle("is_busy", Boolean(dock.truck));
        const text = blocked ? (dock.truck ? `Bloqueado · camión ${dock.truck.id}` : "Bloqueado") : dock.truck ? `Camión ${dock.truck.id}` : "Libre";
        set_text(state, text);
      });
      const all_closed = yard.all_docks_blocked;
      set_text(close_docks_label, all_closed ? "Abrir todos los muelles" : "Cerrar todos los muelles");
      close_docks_icon.className = `fa-solid ${all_closed ? "fa-lock-open" : "fa-lock"}`;
      close_docks_button.setAttribute("aria-pressed", String(all_closed));
      const stopped = yard.arrivals_blocked;
      set_text(stop_arrivals_label, stopped ? "Reanudar llegada de camiones" : "Detener llegada de camiones");
      stop_arrivals_icon.className = `fa-solid ${stopped ? "fa-play" : "fa-ban"}`;
      stop_arrivals_button.setAttribute("aria-pressed", String(stopped));
      stop_arrivals_button.classList.toggle("text_button_danger", stopped);
      now_button.disabled = stopped;
      const status_parts = [];
      if (all_closed) status_parts.push("Todos los muelles están cerrados: los camiones esperan parqueados.");
      if (stopped) status_parts.push("Llegadas detenidas: no llega ningún camión hasta que las reanudes.");
      set_text(dock_status, status_parts.join(" "));
      dock_status.hidden = status_parts.length === 0;
      const parked = sim.receiving.bays.filter((bay) => bay.truck);
      set_text(parking_summary, `Plazas ocupadas: ${parked.length} de ${sim.receiving.bays.length}`);
      const parked_signature = parked.map((bay) => `${bay.number}:${bay.truck.id}`).join(",");
      if (parking_list.dataset.signature !== parked_signature) {
        parking_list.dataset.signature = parked_signature;
        parking_list.replaceChildren();
        parked.forEach((bay) => {
          const item = make("li", "", `Plaza ${bay.number}: camión ${bay.truck.id} (${bay.truck.category ? bay.truck.category.name : "—"})`);
          item.value = bay.number;
          parking_list.append(item);
        });
      }
      const requested = sim.coordinator;
      const in_flight = sim.receiving.schedule.entries.filter((entry) => entry.coordinated && !entry.finished).length;
      set_text(coordinator_summary, `Pidió ${format_number(requested.requested_trucks)} ${requested.requested_trucks === 1 ? "camión" : "camiones"} (${format_number(requested.requested_urgent)} urgentes). En camino ahora: ${format_number(in_flight)}.`);
      const log_signature = requested.log.length > 0 ? `${requested.log.length}:${requested.log[0].time}:${requested.log[0].truck_id}` : "";
      if (coordinator_log.dataset.signature !== log_signature) {
        coordinator_log.dataset.signature = log_signature;
        coordinator_log.replaceChildren();
        requested.log.slice(0, COORDINATOR_LOG_SHOWN).forEach((item) => coordinator_log.append(make("li", item.urgent ? "is_urgent" : "", item.text)));
        if (requested.log.length === 0) coordinator_log.append(make("li", "placeholder", "Todavía no pidió ningún camión."));
      }
      update_rows(sim);
    },
  };
}
