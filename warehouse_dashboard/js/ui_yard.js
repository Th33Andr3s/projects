// La sección "Patio de recibo y muelles": cuántos camiones llegan en cada franja, qué muelles se usan, qué categoría de mercancía
// tiene prioridad, cómo va el parqueadero y la tabla de camiones programados con la restricción de cada uno (muelle fijo y
// franja desde la que puede entrar). Todo lo que se cambia aquí se guarda en la configuración del patio (yard_config.js).

import { DOCK_COUNT } from "./config.js";
import { CATEGORIES } from "./catalog.js";
import { format_number } from "./format.js";
import { PRIORITY_LEVELS, SLOTS, MAX_TRUCKS_PER_SLOT, slot_label } from "./yard_config.js";
import { DAY_SECONDS, MAX_MANUAL_TRUCKS } from "./truck_schedule.js";

// Cuántos camiones terminados se siguen mostrando en el filtro de terminados
const FINISHED_SHOWN = 30;

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
  docks_card.append(dock_grid, make("p", "note", "Pulsa un muelle para bloquearlo o habilitarlo. Un camión que ya está en un muelle que se bloquea termina de descargar."));

  // ---------- Prioridad ----------
  const priority_card = make_card("Prioridad de mercancía");
  const priority_list = make("div", "priority_list");
  const priority_selects = CATEGORIES.map((category, index) => {
    const label = make("label", "priority_field");
    const swatch = make("span", "swatch");
    swatch.style.background = category.color;
    const select = make_select(PRIORITY_LEVELS.map((level) => [String(level.value), level.label]), `Prioridad de ${category.name}`);
    select.value = String(yard.get_priority(index));
    select.addEventListener("change", () => yard.set_priority(index, select.value));
    label.append(swatch, make("span", "priority_name", category.name), select);
    priority_list.append(label);
    return select;
  });
  priority_card.append(priority_list, make("p", "note", "Una categoría con prioridad trae más camiones, y sus camiones pasan primero al muelle que se desocupe."));

  // ---------- Parqueadero ----------
  const parking_card = make_card("Parqueadero de camiones");
  const parking_summary = make("p", "parking_summary");
  const parking_list = make("ol", "parking_list");
  parking_card.append(parking_summary, parking_list, make("p", "note", "Si todos los muelles están ocupados, los camiones se parquean en orden; cada vez que se libera un muelle pasa el que le toque."));

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
    const count = Math.round(Number(now_input.value));
    if (!Number.isFinite(count) || count < 1) {
      now_input.focus();
      return;
    }
    now_input.value = String(handlers.on_send_trucks(Math.min(count, MAX_MANUAL_TRUCKS)));
  });
  now_card.append(now_form, make("p", "note", "Salen a la carretera uno tras otro, además de los programados por franja."));

  const grid = make("div", "yard_grid");
  grid.append(now_card, counts_card, docks_card, priority_card, parking_card);

  // ---------- Camiones programados ----------
  const table_title = make("h3", "table_title", "Camiones programados");
  const toolbar = make("div", "table_toolbar");
  const filter_label = make("label", "table_filter");
  filter_label.append("Mostrar ");
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
  toolbar.append(filter_label, make("p", "note", "A cada camión le puedes fijar un muelle y la franja desde la que puede entrar a él; mientras tanto espera parqueado."));
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
  body.append(grid, table_title, toolbar, wrapper);

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

  function visible_entries(sim) {
    const day = Math.floor(sim.now / DAY_SECONDS) + 1;
    const entries = sim.receiving.schedule.entries;
    switch (filter_select.value) {
      case "today":
        return entries.filter((entry) => entry.day === day);
      case "tomorrow":
        return entries.filter((entry) => entry.day === day + 1);
      case "finished":
        return entries.filter((entry) => entry.finished).slice(-FINISHED_SHOWN);
      default:
        return entries.filter((entry) => !entry.finished);
    }
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
      priority_selects.forEach((select, index) => {
        if (document.activeElement !== select) select.value = String(yard.get_priority(index));
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
      update_rows(sim);
    },
  };
}
