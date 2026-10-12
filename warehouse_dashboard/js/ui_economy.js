// La sección "Economía": cuánto dinero se gastó en comprar mercancía, cuánto vale lo que hay hoy en el centro de distribución, cuánto
// se vendió y cuánto se ganó, todo en pesos colombianos. Solo es seguimiento: el dinero no limita nada de la simulación. La compra se
// mide a precio de compra al proveedor (sin IVA), el inventario al mismo precio, y la venta a precio de venta al cliente (con IVA); la
// utilidad bruta es lo vendido sin IVA menos el costo de lo vendido. Los precios de cada producto se editan en Mercancía.

import { CATEGORIES, SKUS, VAT_RATE, sku_name } from "./catalog.js";
import { format_currency, format_currency_compact, format_number, format_percent } from "./format.js";
import { download_csv, make_download_menu, make_table_header } from "./table_tools.js";

function make(tag, class_name, text) {
  const element = document.createElement(tag);
  if (class_name) element.className = class_name;
  if (text !== undefined) element.textContent = text;
  return element;
}

const PLACES = [
  ["staging", "Bodega de stock"],
  ["reserve", "Reserva"],
  ["active", "Activo"],
  ["other", "En proceso (muelle, armado y pedidos)"],
];

const TABLE_COLUMNS = ["Producto", "Compra (u)", "Venta (u)", "Margen", "Comprado", "Inventario", "Vendido (con IVA)", "Costo de lo vendido", "Utilidad bruta"];
const MONEY_KEYS = ["purchased", "inventory", "sold", "cogs", "profit"];

export function build_economy_panel(body) {
  let last_economy = null;
  let last_date = "corrida";

  // ---------- Tarjetas de resumen ----------
  const summary = make("div", "inventory_summary economy_summary");
  const cards = {};
  const add_card = (key, title, main_card = false) => {
    const card = make("section", `inventory_card${main_card ? " inventory_card_main" : ""}`);
    card.append(make("h3", "", title));
    const value = make("p", "inventory_card_value");
    const detail = make("p", "inventory_card_units");
    const exact = make("p", "inventory_card_capacity");
    card.append(value, detail, exact);
    summary.append(card);
    cards[key] = { value, detail, exact };
  };
  add_card("purchased", "Gastado en compras");
  add_card("inventory", "Valor del inventario en el CD", true);
  add_card("sold", "Vendido");
  add_card("cogs", "Costo de lo vendido");
  add_card("profit", "Utilidad bruta");
  add_card("per_day", "Ventas promedio por día");

  // ---------- Dónde está el dinero del inventario ----------
  const places_title = make("h3", "table_title", "Dónde está el dinero del inventario");
  const places_scroll = make("div", "table_scroll table_scroll_short");
  places_scroll.tabIndex = 0;
  places_scroll.setAttribute("role", "region");
  places_scroll.setAttribute("aria-label", "Valor del inventario por lugar");
  const places_table = make("table", "data_table data_table_narrow");
  const places_head = make("tr");
  ["Lugar", "Valor (a precio de compra)", "Parte del total"].forEach((text) => places_head.append(make("th", "", text)));
  places_table.append(make("thead").appendChild(places_head).parentNode);
  const places_body = make("tbody");
  const places_cells = {};
  [...PLACES, ["total", "Total en el CD"]].forEach(([key, label]) => {
    const row = make("tr", key === "total" ? "total_row" : "");
    const name = make("td", "", label);
    const value = make("td");
    const share = make("td");
    row.append(name, value, share);
    places_body.append(row);
    places_cells[key] = { value, share };
  });
  places_table.append(places_body);
  places_scroll.append(places_table);

  // ---------- Tabla por producto, agrupada por categoría ----------
  const header = make_table_header(
    "Economía por producto",
    make_download_menu([
      {
        label: "Economía por producto (CSV)",
        hint: "Precios, lo comprado, lo que hay, lo vendido y la utilidad de cada producto",
        run: () => last_economy && download_csv(`economia_${last_date}.csv`, economy_lines(last_economy)),
      },
    ]),
  );
  const scroll = make("div", "table_scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", "Economía por producto");
  const table = make("table", "data_table economy_table");
  const head = make("thead");
  const head_row = make("tr");
  TABLE_COLUMNS.forEach((text) => head_row.append(make("th", "", text)));
  head.append(head_row);
  const table_body = make("tbody");
  table.append(head, table_body);
  scroll.append(table);
  const note = make("p", "note", `Precios por unidad en pesos colombianos. El precio de venta es el que paga el cliente, con IVA (${Math.round(VAT_RATE * 100)} %); el de compra es sin IVA. Por eso la utilidad bruta se calcula con las ventas sin IVA. Lo comprado se cuenta cuando la caja baja del camión, y lo vendido cuando sale en un camión de despacho. Los precios se cambian en Mercancía.`);
  body.append(summary, places_title, places_scroll, header, scroll, note);

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
    ["unit_cost", "unit_price", "margin", ...MONEY_KEYS].forEach((key) => {
      cells[key] = make("td");
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
      const cells_row = {};
      ["unit_cost", "unit_price", "margin", ...MONEY_KEYS].forEach((key) => {
        cells_row[key] = make("td");
        row.append(cells_row[key]);
      });
      sku_cells[sku.id] = cells_row;
      table_body.append(row);
    });
  });

  function set_text(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }

  // El margen de un precio de venta (con IVA) contra su costo, sobre el precio sin IVA
  function margin_text(price, cost) {
    const net = price / (1 + VAT_RATE);
    return net > 0 ? format_percent(((net - cost) / net) * 100) : "—";
  }

  function write_card(key, value, detail, exact) {
    const card = cards[key];
    set_text(card.value, format_currency_compact(value));
    set_text(card.detail, detail);
    set_text(card.exact, exact);
  }

  // Los renglones del CSV: un producto por renglón, con sus precios y su dinero
  function economy_lines(economy) {
    const lines = [["Producto", "Categoría", "Precio de compra (u)", "Precio de venta (u, con IVA)", "Margen % (sobre precio sin IVA)", "Unidades compradas", "Unidades en el CD", "Unidades vendidas", "Comprado", "Inventario (a precio de compra)", "Vendido (con IVA)", "Costo de lo vendido", "Utilidad bruta"]];
    economy.by_sku.forEach((row) => {
      const sku = SKUS[row.sku_id];
      const net = row.price / (1 + VAT_RATE);
      lines.push([`${sku_name(sku.id)} ${sku.name}`, CATEGORIES[sku.category_index].name, row.cost, row.price, String(Math.round(((net - row.cost) / net) * 1000) / 10).replace(".", ","), row.received_units, row.stock_units, row.shipped_units, Math.round(row.purchased), Math.round(row.inventory), Math.round(row.sold), Math.round(row.cogs), Math.round(row.profit)]);
    });
    lines.push([]);
    lines.push(["Total", "", "", "", "", economy.purchased_units, economy.inventory_units, economy.sold_units, Math.round(economy.purchased), Math.round(economy.inventory), Math.round(economy.sold), Math.round(economy.cogs), Math.round(economy.profit)]);
    lines.push(["Pesos colombianos. Compra y costo sin IVA; venta con IVA incluido; utilidad bruta = ventas sin IVA - costo de lo vendido."]);
    return lines;
  }

  return {
    update(sim) {
      const economy = sim.inventory.economy();
      last_economy = economy;
      last_date = sim.format_iso_date(sim.now);
      write_card("purchased", economy.purchased, `${format_number(economy.purchased_units)} unidades compradas`, format_currency(economy.purchased));
      write_card("inventory", economy.inventory, `${format_number(economy.inventory_units)} unidades, a precio de compra`, format_currency(economy.inventory));
      write_card("sold", economy.sold, `${format_number(economy.sold_units)} unidades, con IVA incluido`, format_currency(economy.sold));
      write_card("cogs", economy.cogs, "Lo que costó comprar lo que se vendió", format_currency(economy.cogs));
      write_card("profit", economy.profit, economy.margin === null ? "Todavía no hay ventas" : `${format_percent(economy.margin * 100)} de las ventas sin IVA`, `Ventas sin IVA ${format_currency(economy.net)} · IVA ${format_currency(economy.vat)}`);
      write_card("per_day", economy.sold_per_day === null ? 0 : economy.sold_per_day, economy.days === null ? "Se calcula cuando lleva al menos una hora simulada" : `Con IVA, en ${format_number(Math.round(economy.days * 10) / 10)} días simulados`, economy.sold_per_day === null ? "" : `${format_currency(economy.sold_per_day)} por día`);
      PLACES.forEach(([key]) => {
        set_text(places_cells[key].value, format_currency(economy.places[key]));
        set_text(places_cells[key].share, economy.inventory > 0 ? format_percent((economy.places[key] / economy.inventory) * 100) : "—");
      });
      set_text(places_cells.total.value, format_currency(economy.inventory));
      set_text(places_cells.total.share, economy.inventory > 0 ? "100 %" : "—");
      economy.by_sku.forEach((row) => {
        const cells = sku_cells[row.sku_id];
        set_text(cells.unit_cost, format_currency(row.cost));
        set_text(cells.unit_price, format_currency(row.price));
        set_text(cells.margin, margin_text(row.price, row.cost));
        MONEY_KEYS.forEach((key) => set_text(cells[key], format_currency(row[key])));
      });
      economy.by_category.forEach((entry, index) => {
        const cells = category_cells[index];
        set_text(cells.unit_cost, "");
        set_text(cells.unit_price, "");
        set_text(cells.margin, entry.net > 0 ? format_percent(((entry.net - entry.cogs) / entry.net) * 100) : "");
        MONEY_KEYS.forEach((key) => set_text(cells[key], format_currency(entry[key])));
      });
    },
  };
}
