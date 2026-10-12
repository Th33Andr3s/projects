// La sección "Inventario": cuánta mercancía hay hoy en el centro de distribución, por categoría y por producto, y dónde está. Parte
// de cero y crece con cada caja que un camión suelta en el riel. Solo se escribe en la página lo que cambió.

import { CATEGORIES, SKUS, sku_name } from "./catalog.js";
import { LOCATIONS } from "./inventory.js";
import { format_currency_compact, format_number } from "./format.js";
import { download_csv, make_download_menu, make_filter_bar, make_table_header, matches_search } from "./table_tools.js";

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
      // La capacidad en una línea y el porcentaje lleno en la siguiente, para que ninguna se corte
      const capacity = make("p", "inventory_card_capacity");
      const percent = make("p", "inventory_card_percent");
      const track = make("div", "bar_track");
      track.setAttribute("aria-hidden", "true");
      const fill = make("div", "bar_fill");
      track.append(fill);
      card.append(capacity, percent, track);
      cells.capacity = capacity;
      cells.percent = percent;
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

  // El promedio de ventas por día: una tarjeta ancha con las cajas, las unidades y los pesos que salen en promedio cada día
  const sales_card = make("section", "inventory_card inventory_card_wide");
  sales_card.append(make("h3", "", "Promedio de ventas por día"));
  const sales_stats = make("div", "inventory_sales");
  const sales_cells = {};
  [
    ["boxes", "Cajas por día"],
    ["units", "Unidades por día"],
    ["value", "Ventas por día (a precio de venta)"],
  ].forEach(([key, label]) => {
    const stat = make("div", "inventory_sales_stat");
    const value = make("p", "inventory_card_value");
    stat.append(value, make("p", "inventory_card_units", label));
    sales_stats.append(stat);
    sales_cells[key] = value;
  });
  const sales_note = make("p", "inventory_card_units");
  sales_card.append(sales_stats, sales_note);
  summary.append(sales_card);

  // ---------- Tabla por producto, agrupada por categoría ----------
  // Encima de la tabla: su título con el menú de descarga a un lado, y los filtros (producto, categoría y solo lo que tiene mercancía)
  let last_snapshot = null;
  const header = make_table_header(
    "Inventario por producto",
    make_download_menu([
      {
        label: "Inventario por producto (CSV)",
        hint: "Cajas, unidades y dónde está cada producto ahora",
        run: () => last_snapshot && download_csv(`inventario_${last_date}.csv`, inventory_lines(last_snapshot)),
      },
    ]),
  );
  let last_date = "corrida";
  const filters = make_filter_bar([
    { kind: "search", label: "Buscar producto", placeholder: "Nombre, SKU o categoría" },
    { kind: "select", label: "Categoría", options: [["", "Todas"], ...CATEGORIES.map((category, index) => [String(index), category.name])] },
    { kind: "check", label: "Solo lo que tiene mercancía" },
  ]);
  const shown_note = make("p", "note filter_count");
  shown_note.setAttribute("role", "status");
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
  body.append(summary, header, filters.bar, shown_note, scroll);

  const category_cells = [];
  const sku_cells = [];
  const group_rows = [];
  const sku_rows = [];
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
    group_rows[category_index] = group_row;
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
      sku_rows[sku.id] = row;
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
      const exact = capacity.boxes > 0 ? Math.min(100, (boxes / capacity.boxes) * 100) : 0;
      // Con capacidades tan grandes, unas pocas cajas no llegan a 1 %: se dice así y la barra deja ver una franja
      const percent = exact > 0 && exact < 1 ? "menos de 1" : String(Math.round(exact));
      set_text(cells.capacity, `Capacidad: ${format_number(capacity.boxes)} cajas (unas ${format_number(capacity.units)} unidades)`);
      set_text(cells.percent, `${percent} % lleno`);
      cells.fill.style.width = `${exact > 0 ? Math.max(exact, 0.8) : 0}%`;
    }
  }

  // Los renglones de producto que cumplen los filtros; una categoría sin ninguno se oculta con su renglón de total
  function apply_filters() {
    if (!last_snapshot) return;
    const [query, category_value, only_stock] = filters.values();
    let visible = 0;
    const visible_by_category = CATEGORIES.map(() => 0);
    SKUS.forEach((sku) => {
      const entry = last_snapshot.by_sku[sku.id];
      const text = `${sku_name(sku.id)} ${sku.name} ${CATEGORIES[sku.category_index].name}`;
      const show = matches_search(query, text) && (category_value === "" || Number(category_value) === sku.category_index) && (!only_stock || entry.boxes > 0);
      sku_rows[sku.id].hidden = !show;
      if (show) {
        visible += 1;
        visible_by_category[sku.category_index] += 1;
      }
    });
    group_rows.forEach((row, index) => {
      row.hidden = visible_by_category[index] === 0;
    });
    set_text(shown_note, visible === SKUS.length ? `${SKUS.length} productos.` : `Mostrando ${visible} de ${SKUS.length} productos.`);
  }
  filters.on_change(apply_filters);

  // Los renglones del CSV: un producto por renglón, con lo que hay en cada lugar
  function inventory_lines(snapshot) {
    const lines = [["Producto", "Categoría", "Cajas", "Unidades", ...LOCATIONS.map((location) => `${location.label} (cajas)`), "Recibidas (u)", "Despachadas (u)"]];
    SKUS.forEach((sku) => {
      const entry = snapshot.by_sku[sku.id];
      lines.push([`${sku_name(sku.id)} ${sku.name}`, CATEGORIES[sku.category_index].name, entry.boxes, entry.units, ...LOCATIONS.map((location) => entry[location.key]), entry.received_units, entry.shipped_units]);
    });
    return lines;
  }

  return {
    update(sim) {
      const snapshot = sim.inventory.snapshot();
      last_snapshot = snapshot;
      last_date = sim.format_iso_date(sim.now);
      const totals = sim.inventory.summary();
      write_card(summary_cells.total, totals.total.boxes, totals.total.units);
      write_card(summary_cells.staging, totals.staging.boxes, totals.staging.units, totals.capacity.staging);
      write_card(summary_cells.reserve, totals.reserve.boxes, totals.reserve.units, totals.capacity.reserve);
      write_card(summary_cells.active, totals.active.boxes, totals.active.units, totals.capacity.active);
      write_card(summary_cells.other, totals.other.boxes, totals.other.units);
      write_card(summary_cells.shipped, totals.shipped.boxes, totals.shipped.units);
      const average = sim.inventory.average_daily_sales();
      set_text(sales_cells.boxes, average ? format_number(Math.round(average.boxes)) : "—");
      set_text(sales_cells.units, average ? format_number(Math.round(average.units)) : "—");
      set_text(sales_cells.value, average ? format_currency_compact(average.value) : "—");
      set_text(sales_note, average ? `Lo enviado hasta ahora dividido entre ${format_number(Math.round(average.days * 10) / 10)} días simulados.` : "Se calcula cuando lleva al menos una hora simulada.");
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
      apply_filters();
    },
  };
}
