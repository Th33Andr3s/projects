// La sección "Inventario": cuánta mercancía hay hoy en el centro de distribución, por categoría y por producto, y dónde está. Parte
// de cero y crece con cada caja que un camión suelta en el riel. Solo se escribe en la página lo que cambió.

import { CATEGORIES, SKUS, sku_name } from "./catalog.js";
import { LOCATIONS } from "./inventory.js";
import { format_number } from "./format.js";

function make(tag, class_name, text) {
  const element = document.createElement(tag);
  if (class_name) element.className = class_name;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function build_inventory_panel(body) {
  // ---------- Resumen: lo que hay en el CD, dónde está y cuánto cabe ----------
  const summary = make("div", "inventory_summary");
  const summary_cells = {};
  const add_card = (key, label, with_capacity) => {
    const card = make("section", `inventory_card${key === "total" ? " inventory_card_main" : ""}`);
    card.append(make("h3", "", label));
    const boxes = make("p", "inventory_card_value");
    const units = make("p", "inventory_card_units");
    card.append(boxes, units);
    const cells = { boxes, units };
    if (with_capacity) {
      const capacity = make("p", "inventory_card_capacity");
      const track = make("div", "bar_track");
      track.setAttribute("aria-hidden", "true");
      const fill = make("div", "bar_fill");
      track.append(fill);
      card.append(capacity, track);
      cells.capacity = capacity;
      cells.fill = fill;
    }
    summary.append(card);
    summary_cells[key] = cells;
  };
  add_card("total", "Mercancía total en el CD", false);
  add_card("staging", "Bodega de stock", true);
  add_card("reserve", "Reserva", true);
  add_card("active", "Activo", true);
  add_card("other", "En proceso (muelle, armado y pedidos)", false);
  add_card("shipped", "Enviado (acumulado)", false);

  // ---------- Tabla por producto, agrupada por categoría ----------
  const scroll = make("div", "table_scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", "Inventario por producto");
  const table = make("table", "data_table inventory_table");
  const head = make("thead");
  const head_row = make("tr");
  ["Producto", "Cajas", "Unidades", ...LOCATIONS.map((location) => location.label), "Recibidas (u)", "Despachadas (u)"].forEach((text) => head_row.append(make("th", "", text)));
  head.append(head_row);
  const table_body = make("tbody");
  table.append(head, table_body);
  scroll.append(table);
  body.append(summary, scroll);

  const category_cells = [];
  const sku_cells = [];
  CATEGORIES.forEach((category, category_index) => {
    const group_row = make("tr", "group_row");
    const title = make("th", "", "");
    title.scope = "row";
    const swatch = make("span", "swatch");
    swatch.style.background = category.color;
    title.append(swatch, category.name);
    group_row.append(title);
    const cells = {};
    ["boxes", "units", ...LOCATIONS.map((location) => location.key), "received_units", "shipped_units"].forEach((key) => {
      cells[key] = make("td", "");
      group_row.append(cells[key]);
    });
    category_cells[category_index] = cells;
    table_body.append(group_row);

    SKUS.filter((sku) => sku.category_index === category_index).forEach((sku) => {
      const row = make("tr");
      const name = make("th", "sku_cell", "");
      name.scope = "row";
      const dot = make("span", "swatch");
      dot.style.background = sku.color;
      name.append(dot, `${sku_name(sku.id)} · ${sku.name}`);
      row.append(name);
      const sku_row = {};
      ["boxes", "units", ...LOCATIONS.map((location) => location.key), "received_units", "shipped_units"].forEach((key) => {
        sku_row[key] = make("td", "");
        row.append(sku_row[key]);
      });
      sku_cells[sku.id] = sku_row;
      table_body.append(row);
    });
  });

  function set_text(cell, text) {
    if (cell.textContent !== text) cell.textContent = text;
  }

  function set_number(cell, value) {
    set_text(cell, format_number(value));
  }

  function write_card(cells, boxes, units, capacity) {
    set_text(cells.boxes, `${format_number(boxes)} ${boxes === 1 ? "caja" : "cajas"}`);
    set_text(cells.units, `${format_number(units)} unidades`);
    if (capacity && cells.capacity) {
      const percent = capacity.boxes > 0 ? Math.min(100, Math.round((boxes / capacity.boxes) * 100)) : 0;
      set_text(cells.capacity, `Capacidad: ${format_number(capacity.boxes)} cajas (unas ${format_number(capacity.units)} unidades) · ${percent} % lleno`);
      cells.fill.style.width = `${percent}%`;
    }
  }

  return {
    update(sim) {
      const snapshot = sim.inventory.snapshot();
      const totals = sim.inventory.summary();
      write_card(summary_cells.total, totals.total.boxes, totals.total.units);
      write_card(summary_cells.staging, totals.staging.boxes, totals.staging.units, totals.capacity.staging);
      write_card(summary_cells.reserve, totals.reserve.boxes, totals.reserve.units, totals.capacity.reserve);
      write_card(summary_cells.active, totals.active.boxes, totals.active.units, totals.capacity.active);
      write_card(summary_cells.other, totals.other.boxes, totals.other.units);
      write_card(summary_cells.shipped, totals.shipped.boxes, totals.shipped.units);
      snapshot.by_sku.forEach((entry) => {
        Object.entries(sku_cells[entry.sku_id]).forEach(([key, cell]) => set_number(cell, entry[key]));
      });
      snapshot.by_category.forEach((entry, index) => {
        const cells = category_cells[index];
        // La fila de la categoría suma la de sus productos, incluida la ubicación
        const rows = snapshot.by_sku.filter((sku_entry) => SKUS[sku_entry.sku_id].category_index === index);
        Object.entries(cells).forEach(([key, cell]) => {
          const value = key in entry ? entry[key] : rows.reduce((sum, sku_entry) => sum + sku_entry[key], 0);
          set_number(cell, value);
        });
      });
    },
  };
}
