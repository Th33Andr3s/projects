// La sección "Mercancía": las categorías y los productos del catálogo (nombre, color, unidades por caja, tamaño de caja y prioridad) y
// los precios de cada producto (compra al proveedor y venta al cliente, en pesos colombianos por unidad; el de venta siempre tiene que
// ser mayor) y la distribución del activo por piso (qué productos van en cada piso y qué porcentaje del piso ocupa cada uno, con una barra de
// colores por piso que muestra el reparto de un vistazo y un aviso de si suma 100 %). Lo que se edita aquí
// es un borrador: no cambia la simulación que corre. Al "Aplicar y reiniciar" se guarda en el navegador y la página se recarga, así la
// bodega se arma de cero con el catálogo y la distribución nuevos.

import { FLOOR_COUNT } from "./config.js";
import { BOX_SIZES, MAX_CATEGORIES, MAX_NAME_LENGTH, MAX_PRICE, MAX_PRODUCTS, PRIORITY_LEVELS, VAT_RATE, normalize_catalog } from "./catalog.js";
import { default_allocation_json, equal_shares } from "./active_layout.js";
import { format_currency, format_number } from "./format.js";

function make(tag, class_name, text) {
  const element = document.createElement(tag);
  if (class_name) element.className = class_name;
  if (text !== undefined) element.textContent = text;
  return element;
}

function make_icon(name) {
  const icon = make("i", `fa-solid ${name}`);
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function make_button(label, icon_name, extra_class = "") {
  const button = make("button", `text_button text_button_small ${extra_class}`.trim());
  button.type = "button";
  if (icon_name) button.append(make_icon(icon_name));
  button.append(make("span", "", label));
  return button;
}

function make_select(options, label, value) {
  const select = make("select", "table_select");
  select.setAttribute("aria-label", label);
  options.forEach(([option_value, text]) => {
    const option = make("option", "", text);
    option.value = option_value;
    select.append(option);
  });
  select.value = value;
  return select;
}

function make_number(label, value, min, max) {
  const input = make("input", "number_input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = "1";
  input.inputMode = "numeric";
  input.value = String(value);
  input.setAttribute("aria-label", label);
  return input;
}

// Un precio en pesos por unidad: entero, de 1 al tope, de 100 en 100 con las flechas
function make_money(label, value) {
  const input = make("input", "number_input money_input");
  input.type = "number";
  input.min = "1";
  input.max = String(MAX_PRICE);
  input.step = "100";
  input.inputMode = "numeric";
  input.value = String(value);
  input.setAttribute("aria-label", label);
  return input;
}

// El margen bruto de un producto: lo que queda del precio sin IVA después de pagar el costo (puede ser negativo)
function margin_of(product) {
  const net = product.price / (1 + VAT_RATE);
  return net > 0 ? ((net - product.cost) / net) * 100 : 0;
}

function make_text(label, value) {
  const input = make("input", "text_input");
  input.type = "text";
  input.maxLength = MAX_NAME_LENGTH;
  input.value = value;
  input.setAttribute("aria-label", label);
  return input;
}

function make_color(label, value) {
  const input = make("input", "color_input");
  input.type = "color";
  input.value = value;
  input.setAttribute("aria-label", label);
  return input;
}

// Si un color es claro, el texto que va encima tiene que ser oscuro (y al revés): se decide por su luminosidad
function is_light_color(hex) {
  const value = parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return 0.299 * red + 0.587 * green + 0.114 * blue > 160;
}

// Una clave nueva que no repite ninguna: prefijo + número
function next_key(prefix, taken) {
  let number = taken.size + 1;
  while (taken.has(`${prefix}_${number}`)) number += 1;
  return `${prefix}_${number}`;
}

function size_key_of(size) {
  const preset = BOX_SIZES.find((candidate) => candidate.size.every((value, index) => Math.abs(value - size[index]) < 1e-9));
  return preset ? preset.key : "custom";
}

export function build_catalog_panel(body, config, initial) {
  // El borrador: se parte de lo que está guardado y se cambia sin tocar la simulación
  let saved = { catalog: JSON.parse(JSON.stringify(initial.catalog)), allocation: JSON.parse(JSON.stringify(initial.allocation)) };
  let draft = JSON.parse(JSON.stringify(saved));
  let boxes_by_key = new Map();

  // ---------- Esqueleto ----------
  const actions = make("div", "catalog_actions");
  const apply_button = make_button("Aplicar y reiniciar", "fa-rotate-right", "text_button_primary");
  const discard_button = make_button("Descartar cambios", "fa-rotate-left");
  const factory_button = make_button("Catálogo de fábrica", "fa-box-open");
  const status = make("p", "catalog_status");
  status.setAttribute("role", "status");
  actions.append(apply_button, discard_button, factory_button, status);
  const problems = make("ul", "catalog_problems");
  problems.setAttribute("aria-live", "polite");

  const categories_card = make("section", "yard_card");
  categories_card.append(make("h3", "", "Categorías"));
  const categories_list = make("div", "catalog_categories");
  const add_category_button = make_button("Agregar categoría", "fa-plus");
  categories_card.append(categories_list, add_category_button);

  const products_card = make("section", "yard_card");
  products_card.append(make("h3", "", "Productos"));
  const products_scroll = make("div", "table_scroll");
  products_scroll.tabIndex = 0;
  products_scroll.setAttribute("role", "region");
  products_scroll.setAttribute("aria-label", "Tabla de productos");
  const products_table = make("table", "data_table catalog_table");
  const products_head = make("thead");
  const products_head_row = make("tr");
  ["Color", "Nombre", "Categoría", "Unidades por caja", "Tamaño de la caja", "Prioridad", "Precio de compra (u)", "Precio de venta (u)", "Margen", "En inventario", "Acciones"].forEach((text) => products_head_row.append(make("th", "", text)));
  products_head.append(products_head_row);
  const products_body = make("tbody");
  products_table.append(products_head, products_body);
  products_scroll.append(products_table);
  const add_product_button = make_button("Agregar producto", "fa-plus");
  const product_counter = make("p", "note");
  products_card.append(products_scroll, add_product_button, product_counter);

  const distribution_card = make("section", "yard_card catalog_distribution");
  distribution_card.append(make("h3", "", "Distribución del activo por piso"));
  // Tres ideas, cortas: así se entiende de un vistazo qué hay que hacer
  const steps = make("ol", "catalog_steps");
  [
    "Cada piso reparte su espacio entre sus productos, en porcentajes.",
    "Cada piso tiene que sumar 100 %: la barra de colores y el aviso verde o rojo de cada piso te lo dicen.",
    "Un producto puede estar en varios pisos. Uno que no esté en ninguno entra a la bodega, pero no al activo y no se puede pedir.",
  ].forEach((text) => steps.append(make("li", "", text)));
  distribution_card.append(steps);
  const distribution_actions = make("div", "catalog_actions");
  const auto_button = make_button("Repartir todo automáticamente", "fa-wand-magic-sparkles");
  distribution_actions.append(auto_button);
  const floors_grid = make("div", "catalog_floors");
  const unassigned_note = make("p", "note catalog_unassigned");
  distribution_card.append(distribution_actions, floors_grid, unassigned_note);

  body.append(actions, problems, categories_card, products_card, distribution_card);

  // ---------- Lo que se puede saber del borrador ----------
  const category_of = (key) => draft.catalog.categories.find((category) => category.key === key);
  const product_of = (key) => draft.catalog.products.find((product) => product.key === key);
  const products_in = (category_key) => draft.catalog.products.filter((product) => product.category === category_key);
  const floor_capacity = () => Math.round(config.get("active_capacity") / FLOOR_COUNT);

  function is_changed() {
    return JSON.stringify(draft) !== JSON.stringify(saved);
  }

  function find_problems() {
    const list = [];
    draft.allocation.forEach((entries, floor) => {
      if (entries.length === 0) return;
      const total = entries.reduce((sum, entry) => sum + entry.percent, 0);
      if (total !== 100) list.push(`El piso ${floor + 1} suma ${total} %: tiene que sumar 100 %.`);
    });
    if (draft.catalog.products.some((product) => product.name.trim() === "")) list.push("Todos los productos necesitan un nombre.");
    draft.catalog.products.filter((product) => product.price <= product.cost).forEach((product) => list.push(`El precio de venta de «${product.name || "(sin nombre)"}» (${format_currency(product.price)}) tiene que ser mayor al de compra (${format_currency(product.cost)}).`));
    if (draft.catalog.categories.some((category) => category.name.trim() === "")) list.push("Todas las categorías necesitan un nombre.");
    if (!draft.allocation.some((entries) => entries.length > 0)) list.push("El activo necesita al menos un producto en algún piso.");
    return list;
  }

  // ---------- Categorías ----------
  function render_categories() {
    categories_list.replaceChildren();
    draft.catalog.categories.forEach((category, index) => {
      const row = make("div", "catalog_category");
      const color = make_color(`Color de la categoría ${category.name}`, category.color);
      color.addEventListener("input", () => {
        category.color = color.value;
        refresh();
      });
      const name = make_text(`Nombre de la categoría ${index + 1}`, category.name);
      name.addEventListener("input", () => {
        category.name = name.value;
        refresh();
      });
      const count = products_in(category.key).length;
      const info = make("span", "catalog_count", `${count} ${count === 1 ? "producto" : "productos"}`);
      const remove = make_button("Quitar", "fa-trash", "text_button_danger");
      remove.setAttribute("aria-label", `Quitar la categoría ${category.name}`);
      const blocked = count > 0 || draft.catalog.categories.length <= 1;
      remove.disabled = blocked;
      remove.title = count > 0 ? "Tiene productos: quítalos o cámbialos de categoría primero" : draft.catalog.categories.length <= 1 ? "Tiene que quedar al menos una categoría" : "";
      remove.addEventListener("click", () => {
        draft.catalog.categories.splice(index, 1);
        render_all();
        add_category_button.focus();
      });
      row.append(color, name, info, remove);
      categories_list.append(row);
    });
    add_category_button.disabled = draft.catalog.categories.length >= MAX_CATEGORIES;
  }

  add_category_button.addEventListener("click", () => {
    const key = next_key("category", new Set(draft.catalog.categories.map((category) => category.key)));
    draft.catalog.categories.push({ key, name: "Categoría nueva", color: "#0ea5e9" });
    render_all();
    const rows = categories_list.querySelectorAll(".catalog_category");
    rows[rows.length - 1].querySelector(".text_input").focus();
  });

  // ---------- Productos ----------
  function render_products() {
    products_body.replaceChildren();
    draft.catalog.products.forEach((product, index) => {
      const row = make("tr");
      const color_cell = make("td");
      const color = make_color(`Color de ${product.name}`, product.color);
      color.addEventListener("input", () => {
        product.color = color.value;
        refresh();
      });
      color_cell.append(color);
      const name_cell = make("td");
      const name = make_text(`Nombre del producto ${index + 1}`, product.name);
      name.addEventListener("input", () => {
        product.name = name.value;
        refresh();
      });
      name_cell.append(name);
      const category_cell = make("td");
      const category = make_select(draft.catalog.categories.map((candidate) => [candidate.key, candidate.name || "(sin nombre)"]), `Categoría de ${product.name}`, product.category);
      category.addEventListener("change", () => {
        product.category = category.value;
        refresh();
      });
      category_cell.append(category);
      const units_cell = make("td");
      const units = make_number(`Unidades por caja de ${product.name}`, product.units, 1, 500);
      units.addEventListener("change", () => {
        const value = Math.round(Number(units.value));
        product.units = Number.isFinite(value) ? Math.min(500, Math.max(1, value)) : product.units;
        units.value = String(product.units);
        refresh();
      });
      units_cell.append(units);
      const size_cell = make("td");
      const size_options = BOX_SIZES.map((preset) => [preset.key, preset.label]);
      if (size_key_of(product.size) === "custom") size_options.push(["custom", "Personalizada"]);
      const size = make_select(size_options, `Tamaño de la caja de ${product.name}`, size_key_of(product.size));
      size.addEventListener("change", () => {
        const preset = BOX_SIZES.find((candidate) => candidate.key === size.value);
        if (preset) product.size = [...preset.size];
        refresh();
      });
      size_cell.append(size);
      const priority_cell = make("td");
      const priority = make_select(PRIORITY_LEVELS.map((level) => [String(level.value), level.label]), `Prioridad de ${product.name}`, String(product.priority));
      priority.addEventListener("change", () => {
        product.priority = Number(priority.value);
        refresh();
      });
      priority_cell.append(priority);
      // Precios por unidad en pesos: lo que se paga al proveedor y lo que paga el cliente (con IVA)
      const cost_cell = make("td");
      const cost = make_money(`Precio de compra por unidad de ${product.name}`, product.cost);
      cost.dataset.index = String(index);
      cost.addEventListener("change", () => {
        const value = Math.round(Number(cost.value));
        product.cost = Number.isFinite(value) ? Math.min(MAX_PRICE, Math.max(1, value)) : product.cost;
        cost.value = String(product.cost);
        refresh();
      });
      cost_cell.append(cost);
      const price_cell = make("td");
      const price = make_money(`Precio de venta por unidad de ${product.name}`, product.price);
      price.dataset.index = String(index);
      price.addEventListener("change", () => {
        const value = Math.round(Number(price.value));
        product.price = Number.isFinite(value) ? Math.min(MAX_PRICE, Math.max(1, value)) : product.price;
        price.value = String(product.price);
        refresh();
      });
      price_cell.append(price);
      const margin_cell = make("td", "cell_margin");
      margin_cell.dataset.index = String(index);
      const stock_cell = make("td", "cell_stock");
      stock_cell.dataset.key = product.key;
      const remove_cell = make("td");
      const remove = make_button("Quitar", "fa-trash", "text_button_danger");
      remove.setAttribute("aria-label", `Quitar el producto ${product.name}`);
      remove.dataset.key = product.key;
      remove.addEventListener("click", () => {
        draft.catalog.products.splice(index, 1);
        draft.allocation = draft.allocation.map((entries) => entries.filter((entry) => entry.key !== product.key));
        render_all();
        add_product_button.focus();
      });
      remove_cell.append(remove);
      row.append(color_cell, name_cell, category_cell, units_cell, size_cell, priority_cell, cost_cell, price_cell, margin_cell, stock_cell, remove_cell);
      products_body.append(row);
    });
    add_product_button.disabled = draft.catalog.products.length >= MAX_PRODUCTS;
  }

  add_product_button.addEventListener("click", () => {
    const category = draft.catalog.categories[0];
    const key = next_key("product", new Set(draft.catalog.products.map((product) => product.key)));
    draft.catalog.products.push({ key, name: "Producto nuevo", category: category.key, color: category.color, units: 12, size: [...BOX_SIZES[1].size], priority: 1, cost: 10000, price: 15000 });
    render_all();
    const rows = products_body.querySelectorAll("tr");
    rows[rows.length - 1].querySelector(".text_input").focus();
  });

  // ---------- Distribución por piso ----------
  // Deja los porcentajes de un piso sumando 100 % sin cambiar sus proporciones (cada uno de al menos 1 %)
  function normalize_percents(entries) {
    const total = entries.reduce((sum, entry) => sum + entry.percent, 0);
    if (entries.length === 0 || total === 0) return;
    entries.forEach((entry) => {
      entry.percent = Math.max(1, Math.round((entry.percent / total) * 100));
    });
    // El redondeo puede dejar 99 o 101: la diferencia se la lleva el producto más grande
    const difference = 100 - entries.reduce((sum, entry) => sum + entry.percent, 0);
    const largest = entries.reduce((best, entry) => (entry.percent > best.percent ? entry : best), entries[0]);
    largest.percent = Math.max(1, largest.percent + difference);
  }

  function render_floors() {
    floors_grid.replaceChildren();
    draft.allocation.forEach((entries, floor) => {
      const card = make("section", "catalog_floor");
      card.dataset.floor = String(floor);
      const header = make("div", "catalog_floor_header");
      const sum = make("span", "catalog_sum");
      header.append(make("h4", "", `Piso ${floor + 1}`), sum);
      const capacity = make("p", "note", `Caben unas ${format_number(floor_capacity())} cajas`);
      // La barra de colores: un tramo por producto, tan ancho como su porcentaje
      const bar = make("div", "catalog_bar");
      bar.setAttribute("role", "img");
      const list = make("div", "catalog_floor_rows");
      entries.forEach((entry, entry_index) => {
        const row = make("div", "catalog_floor_row");
        const used = new Set(entries.map((candidate) => candidate.key));
        const options = draft.catalog.products.filter((product) => product.key === entry.key || !used.has(product.key)).map((product) => [product.key, product.name || "(sin nombre)"]);
        const dot = make("span", "swatch catalog_dot");
        const select = make_select(options, `Producto ${entry_index + 1} del piso ${floor + 1}`, entry.key);
        select.addEventListener("change", () => {
          entry.key = select.value;
          render_floors();
          refresh();
        });
        const percent = make_number(`Porcentaje del producto ${entry_index + 1} del piso ${floor + 1}`, entry.percent, 1, 100);
        const slider = make("input", "param_slider catalog_slider");
        slider.type = "range";
        slider.min = "1";
        slider.max = "100";
        slider.step = "1";
        slider.value = String(entry.percent);
        slider.setAttribute("aria-label", `Deslizador del porcentaje del producto ${entry_index + 1} del piso ${floor + 1}`);
        // El deslizador y el campo cambian juntos
        slider.addEventListener("input", () => {
          entry.percent = Number(slider.value);
          percent.value = String(entry.percent);
          refresh();
        });
        percent.addEventListener("change", () => {
          const value = Math.round(Number(percent.value));
          entry.percent = Number.isFinite(value) ? Math.min(100, Math.max(1, value)) : entry.percent;
          percent.value = String(entry.percent);
          slider.value = String(entry.percent);
          refresh();
        });
        const unit = make("span", "catalog_percent", "%");
        const remove = make_button("", "fa-xmark");
        remove.setAttribute("aria-label", `Quitar el producto ${entry_index + 1} del piso ${floor + 1}`);
        remove.addEventListener("click", () => {
          entries.splice(entry_index, 1);
          render_floors();
          refresh();
        });
        row.append(dot, select, slider, percent, unit, remove);
        list.append(row);
      });
      const buttons = make("div", "catalog_floor_buttons");
      const add = make_button("Agregar producto", "fa-plus");
      const free = draft.catalog.products.filter((product) => !entries.some((entry) => entry.key === product.key));
      add.disabled = free.length === 0;
      add.addEventListener("click", () => {
        // Entra primero un producto que no esté en ningún piso, y el piso se reparte en partes iguales para que siga sumando 100 %
        const assigned = new Set(draft.allocation.flat().map((entry) => entry.key));
        const chosen = free.find((product) => !assigned.has(product.key)) || free[0];
        draft.allocation[floor] = equal_shares([...entries.map((entry) => entry.key), chosen.key]);
        render_floors();
        refresh();
      });
      const share = make_button("Partes iguales", "fa-equals");
      share.disabled = entries.length === 0;
      share.addEventListener("click", () => {
        draft.allocation[floor] = equal_shares(entries.map((entry) => entry.key));
        render_floors();
        refresh();
      });
      // Si el piso no suma 100 %, un botón lo ajusta sin cambiar las proporciones
      const fit = make_button("Ajustar a 100 %", "fa-arrows-left-right-to-line");
      fit.dataset.action = "fit";
      fit.addEventListener("click", () => {
        normalize_percents(entries);
        render_floors();
        refresh();
      });
      // El mismo reparto en los 8 pisos
      const copy = make_button("Copiar a todos los pisos", "fa-copy");
      copy.disabled = entries.length === 0;
      copy.addEventListener("click", () => {
        const model = entries.map((entry) => ({ ...entry }));
        draft.allocation = draft.allocation.map(() => model.map((entry) => ({ ...entry })));
        render_floors();
        refresh();
      });
      buttons.append(add, share, fit, copy);
      card.append(header, capacity, bar, list, buttons);
      floors_grid.append(card);
    });
  }

  auto_button.addEventListener("click", () => {
    draft.allocation = default_allocation_json(draft.catalog);
    render_floors();
    refresh();
  });

  // ---------- Estado, avisos y botones ----------
  // Lo que cambia con cualquier edición sin volver a dibujar todo: los nombres en las listas, las sumas, los avisos y los botones
  function refresh() {
    const catalog_problems = find_problems();
    problems.replaceChildren();
    catalog_problems.forEach((text) => problems.append(make("li", "", text)));
    const changed = is_changed();
    apply_button.disabled = !changed || catalog_problems.length > 0;
    discard_button.disabled = !changed;
    status.textContent = changed ? "Hay cambios sin aplicar." : "Sin cambios.";
    floors_grid.querySelectorAll(".catalog_floor").forEach((card) => {
      const floor = Number(card.dataset.floor);
      const entries = draft.allocation[floor];
      const total = entries.reduce((value, entry) => value + entry.percent, 0);
      const sum = card.querySelector(".catalog_sum");
      sum.textContent = entries.length === 0 ? "Piso vacío" : total === 100 ? "Suma 100 %" : total < 100 ? `Suma ${total} %: faltan ${100 - total} %` : `Suma ${total} %: sobran ${total - 100} %`;
      sum.classList.toggle("is_bad", entries.length > 0 && total !== 100);
      sum.classList.toggle("is_good", entries.length > 0 && total === 100);
      card.querySelector("[data-action='fit']").disabled = entries.length === 0 || total === 100;
      // La barra: tramos de color con su porcentaje; si sobra, la barra se escala y se marca en rojo; si falta, queda un hueco rayado
      const bar = card.querySelector(".catalog_bar");
      bar.replaceChildren();
      bar.classList.toggle("is_bad", entries.length > 0 && total !== 100);
      const scale = Math.max(100, total);
      const dots = card.querySelectorAll(".catalog_dot");
      entries.forEach((entry, index) => {
        const product = product_of(entry.key);
        const color = product ? product.color : "#98a2b3";
        const segment = make("span", "catalog_segment", entry.percent >= 10 ? `${entry.percent} %` : "");
        segment.style.width = `${(entry.percent / scale) * 100}%`;
        segment.style.background = color;
        segment.classList.toggle("is_light", is_light_color(color));
        segment.title = `${product ? product.name : entry.key}: ${entry.percent} %`;
        bar.append(segment);
        if (dots[index]) dots[index].style.background = color;
      });
      const description = entries.map((entry) => `${product_of(entry.key) ? product_of(entry.key).name : entry.key} ${entry.percent} %`).join(", ");
      bar.setAttribute("aria-label", entries.length === 0 ? `Piso ${floor + 1} vacío.` : `Piso ${floor + 1}: ${description}. Suma ${total} %.`);
    });
    const assigned = new Set(draft.allocation.flat().map((entry) => entry.key));
    const missing = draft.catalog.products.filter((product) => !assigned.has(product.key));
    unassigned_note.textContent = missing.length === 0 ? "" : `Sin piso (no entran al activo): ${missing.map((product) => product.name || "(sin nombre)").join(", ")}.`;
    // Las listas que muestran nombres de producto o de categoría se actualizan en el lugar
    products_body.querySelectorAll("select[aria-label^='Categoría de']").forEach((select) => {
      [...select.options].forEach((option) => {
        const category = category_of(option.value);
        if (category) option.textContent = category.name || "(sin nombre)";
      });
    });
    floors_grid.querySelectorAll(".catalog_floor_row select").forEach((select) => {
      [...select.options].forEach((option) => {
        const product = product_of(option.value);
        if (product) option.textContent = product.name || "(sin nombre)";
      });
    });
    categories_list.querySelectorAll(".catalog_category").forEach((row, index) => {
      const count = products_in(draft.catalog.categories[index].key).length;
      row.querySelector(".catalog_count").textContent = `${count} ${count === 1 ? "producto" : "productos"}`;
    });
    // El margen de cada producto y el aviso si el precio de venta no supera al de compra
    products_body.querySelectorAll("td.cell_margin").forEach((cell) => {
      const product = draft.catalog.products[Number(cell.dataset.index)];
      if (!product) return;
      const margin = margin_of(product);
      cell.textContent = `${format_number(Math.round(margin))} %`;
      cell.classList.toggle("is_bad", product.price <= product.cost || margin <= 0);
    });
    products_body.querySelectorAll(".money_input").forEach((input) => {
      const product = draft.catalog.products[Number(input.dataset.index)];
      if (product) input.setAttribute("aria-invalid", String(product.price <= product.cost));
    });
    product_counter.textContent = `${draft.catalog.products.length} de ${MAX_PRODUCTS} productos. Los precios son por unidad, en pesos colombianos: el de compra es lo que se paga al proveedor (sin IVA) y el de venta lo que paga el cliente (con IVA incluido). El margen es lo que queda del precio sin IVA después de pagar el costo.`;
    refresh_stock();
  }

  // Cuánta mercancía de cada producto hay ahora en la bodega: solo se puede quitar un producto sin inventario
  function refresh_stock() {
    products_body.querySelectorAll("td.cell_stock").forEach((cell) => {
      const boxes = boxes_by_key.get(cell.dataset.key);
      const text = boxes === undefined ? "—" : `${format_number(boxes)} ${boxes === 1 ? "caja" : "cajas"}`;
      if (cell.textContent !== text) cell.textContent = text;
    });
    products_body.querySelectorAll("button[data-key]").forEach((button) => {
      const boxes = boxes_by_key.get(button.dataset.key) || 0;
      const last = draft.catalog.products.length <= 1;
      button.disabled = boxes > 0 || last;
      button.title = boxes > 0 ? "Tiene inventario: no se puede quitar hasta que no quede mercancía" : last ? "Tiene que quedar al menos un producto" : "";
    });
  }

  function render_all() {
    render_categories();
    render_products();
    render_floors();
    refresh();
  }

  // ---------- Botones de arriba ----------
  discard_button.addEventListener("click", () => {
    draft = JSON.parse(JSON.stringify(saved));
    render_all();
  });
  factory_button.addEventListener("click", () => {
    const factory = initial.factory();
    draft = { catalog: JSON.parse(JSON.stringify(factory.catalog)), allocation: JSON.parse(JSON.stringify(factory.allocation)) };
    render_all();
  });
  // Aplicar recarga la página y pierde la corrida: se pide confirmación
  const dialog = document.getElementById("merch_dialog");
  apply_button.addEventListener("click", () => {
    if (find_problems().length === 0) dialog.showModal();
  });
  document.getElementById("merch_cancel_button").addEventListener("click", () => dialog.close());
  document.getElementById("merch_confirm_button").addEventListener("click", () => {
    dialog.close();
    const catalog = normalize_catalog(draft.catalog);
    if (catalog && find_problems().length === 0) initial.on_apply(catalog, draft.allocation);
  });

  render_all();

  return {
    // Se llama con la simulación actual: de ahí salen las cajas que hay de cada producto
    update(sim) {
      const snapshot = sim.inventory.snapshot();
      boxes_by_key = new Map(snapshot.by_sku.map((entry) => [initial.keys[entry.sku_id], entry.boxes]));
      refresh_stock();
    },
  };
}
