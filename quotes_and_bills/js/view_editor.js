// El editor de un documento: fecha y estado, cliente, renglones (a mano o desde el catálogo), totales en vivo, notas, vista
// previa, PDF, impresión y envío por WhatsApp o correo. Todo se guarda solo al escribir. Los totales salen de
// calculate_totals (document_model.js) y los muestran por igual la pantalla, la vista previa y el PDF.
import { flash_scene } from "./animations.js";
import { build_document_pdf, mailto_url, pdf_file_name, whatsapp_url } from "./document_layout.js";
import { render_preview } from "./document_preview.js";
import {
  KIND_LABELS,
  MAX_QUANTITY,
  MAX_UNIT_PRICE,
  STATUSES,
  STATUS_LABELS,
  blank_line,
  calculate_totals,
  clean_tax_id,
  effective_status,
  format_date_short,
  format_money,
  format_percent,
  format_quantity,
  is_valid_key,
  normalize_text,
  parse_decimal,
  parse_money,
  today_key,
  validate_document,
} from "./document_model.js";
import { hooks } from "./navigation.js";
import { save_now, save_soon, state } from "./store.js";
import { announce, by_id, download_file, focus_field, make_element, make_id } from "./ui_helpers.js";

const MAX_CATALOG_RESULTS = 8;
const CLIENT_FIELDS = [
  ["client_name", "name"],
  ["client_tax_id", "tax_id"],
  ["client_phone", "phone"],
  ["client_email", "email"],
  ["client_address", "address"],
];

// El documento que se está editando (el mismo objeto de state.data.documents) y el cliente guardado al que está ligado
let current = null;
let client_link = null;
let preview_frame = 0;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function format_plain_amount(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function icon(class_name) {
  const element = make_element("i", class_name);
  element.setAttribute("aria-hidden", "true");
  return element;
}

export function is_editor_open() {
  return current !== null;
}

// Después de cualquier cambio: totales, vista previa y guardado
function after_change() {
  render_totals();
  update_preview();
  save_soon();
}

// ---------------------------------------------------------------------------
// Cabecera: título, estado, fechas y enlaces
// ---------------------------------------------------------------------------

function render_status() {
  const select = by_id("doc_status");
  select.replaceChildren(...STATUSES[current.kind].map((status) => {
    const option = make_element("option", "", STATUS_LABELS[status]);
    option.value = status;
    return option;
  }));
  select.value = current.status;
  const note = by_id("doc_expired_note");
  if (effective_status(current, today_key(new Date())) === "expired") {
    note.textContent = `Venció el ${format_date_short(current.due_date)}. Cambia el estado (${current.kind === "quote" ? "Aceptada o Rechazada" : "Pagada"}) o la fecha.`;
    note.hidden = false;
  } else {
    note.hidden = true;
  }
}

function render_links() {
  const links = by_id("editor_links");
  links.replaceChildren();
  const add_link = (prefix, id) => {
    const other = state.data.documents.find((document) => document.id === id);
    if (!other) return;
    const button = make_element("button", "link_button", other.number);
    button.type = "button";
    button.addEventListener("click", () => hooks.open_document(id));
    links.append(document.createTextNode(`${prefix} `), button, document.createTextNode(". "));
  };
  if (current.converted_to) add_link("Se convirtió en la cuenta de cobro", current.converted_to);
  if (current.converted_from) add_link("Viene de la cotización", current.converted_from);
  links.hidden = links.childNodes.length === 0;
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

function fill_client_select() {
  const select = by_id("client_select");
  const first = make_element("option", "", "Nuevo cliente (escribe los datos abajo)");
  first.value = "";
  const clients = [...state.data.clients].sort((a, b) => normalize_text(a.name).localeCompare(normalize_text(b.name)));
  select.replaceChildren(first, ...clients.map((client) => {
    const option = make_element("option", "", client.name);
    option.value = client.id;
    return option;
  }));
  select.value = client_link && clients.some((client) => client.id === client_link) ? client_link : "";
}

export function refresh_editor_clients() {
  if (current) fill_client_select();
}

function render_client_fields() {
  CLIENT_FIELDS.forEach(([id, key]) => (by_id(id).value = current.client[key]));
  by_id("client_save").checked = false;
}

// Con "Guardar en Clientes" marcada, el cliente del documento se guarda en la lista (o actualiza al ligado)
function sync_client() {
  const fields = { ...current.client };
  if (client_link) {
    const saved = state.data.clients.find((client) => client.id === client_link);
    if (saved) Object.assign(saved, fields);
  } else {
    client_link = make_id();
    state.data.clients.push({ id: client_link, ...fields });
    fill_client_select();
  }
  hooks.refresh_clients();
}

function handle_client_select() {
  const id = by_id("client_select").value;
  client_link = id === "" ? null : id;
  by_id("client_save").checked = false;
  if (id === "") return;
  const saved = state.data.clients.find((client) => client.id === id);
  if (!saved) return;
  current.client = { name: saved.name, tax_id: saved.tax_id, phone: saved.phone, email: saved.email, address: saved.address };
  render_client_fields();
  after_change();
  announce(`Cliente elegido: ${saved.name}.`);
}

function handle_client_input(id, key) {
  const input = by_id(id);
  if (key === "tax_id") {
    const cleaned = clean_tax_id(input.value);
    if (cleaned !== input.value) input.value = cleaned;
  }
  current.client[key] = input.value;
  if (by_id("client_save").checked && current.client.name.trim()) sync_client();
  after_change();
}

function handle_client_save() {
  const checkbox = by_id("client_save");
  if (!checkbox.checked) return;
  if (!current.client.name.trim()) {
    checkbox.checked = false;
    focus_field("client_name");
    announce("Escribe el nombre del cliente para guardarlo.");
    return;
  }
  sync_client();
  save_now();
  announce("Cliente guardado en Clientes.");
}

// ---------------------------------------------------------------------------
// Renglones
// ---------------------------------------------------------------------------

function make_input(id, value, label, extra = {}) {
  const input = make_element("input", "");
  input.type = "text";
  input.id = id;
  input.value = value;
  input.setAttribute("aria-label", label);
  Object.entries(extra).forEach(([name, attribute]) => input.setAttribute(name, attribute));
  return input;
}

function make_cell(class_name, label) {
  const cell = make_element("td", class_name);
  cell.dataset.label = label;
  return cell;
}

function make_action_button(label, icon_class, handler, disabled) {
  const button = make_element("button", "icon_button");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.disabled = disabled;
  button.append(icon(icon_class));
  button.addEventListener("click", handler);
  return button;
}

function make_line_row(line, index, count) {
  const row = make_element("tr", "");
  const number = index + 1;

  const description = make_cell("cell_description", "Descripción");
  const description_input = make_input(`line_description_${index}`, line.description, `Descripción del renglón ${number}`, { maxlength: "200", autocomplete: "off" });
  description_input.addEventListener("input", () => {
    line.description = description_input.value;
    after_change();
  });
  description.append(description_input);

  const quantity = make_cell("cell_quantity", "Cantidad");
  const quantity_input = make_input(`line_quantity_${index}`, format_quantity(line.quantity), `Cantidad del renglón ${number}`, { inputmode: "decimal", autocomplete: "off" });
  quantity_input.addEventListener("input", () => {
    const value = parse_decimal(quantity_input.value);
    line.quantity = Number.isNaN(value) || value < 0 ? 0 : Math.min(value, MAX_QUANTITY);
    after_change();
  });
  quantity_input.addEventListener("blur", () => (quantity_input.value = format_quantity(line.quantity)));
  quantity.append(quantity_input);

  const price = make_cell("cell_price", "Precio");
  const price_input = make_input(`line_price_${index}`, line.unit_price > 0 ? format_plain_amount(line.unit_price) : "", `Precio del renglón ${number}`, { inputmode: "numeric", autocomplete: "off", placeholder: "0" });
  price_input.addEventListener("input", () => {
    const value = price_input.value.trim() === "" ? 0 : parse_money(price_input.value);
    line.unit_price = Number.isNaN(value) ? 0 : Math.min(value, MAX_UNIT_PRICE);
    after_change();
  });
  price_input.addEventListener("blur", () => (price_input.value = line.unit_price > 0 ? format_plain_amount(line.unit_price) : ""));
  price.append(price_input);

  const discount = make_cell("cell_discount", "Desc. %");
  const discount_input = make_input(`line_discount_${index}`, line.discount_percent > 0 ? String(line.discount_percent).replace(".", ",") : "", `Descuento del renglón ${number}, en porcentaje`, { inputmode: "decimal", autocomplete: "off", placeholder: "0" });
  discount_input.addEventListener("input", () => {
    const value = discount_input.value.trim() === "" ? 0 : parse_decimal(discount_input.value);
    line.discount_percent = Number.isNaN(value) || value < 0 ? 0 : Math.min(value, 100);
    after_change();
  });
  discount_input.addEventListener("blur", () => (discount_input.value = line.discount_percent > 0 ? String(line.discount_percent).replace(".", ",") : ""));
  discount.append(discount_input);

  const vat = make_cell("cell_vat", "IVA");
  const vat_select = make_element("select", "");
  vat_select.id = `line_tax_${index}`;
  vat_select.setAttribute("aria-label", `IVA del renglón ${number}`);
  [0, 5, 19].forEach((rate) => {
    const option = make_element("option", "", `${rate} %`);
    option.value = String(rate);
    vat_select.append(option);
  });
  vat_select.value = String(line.tax_rate);
  vat_select.addEventListener("change", () => {
    line.tax_rate = Number(vat_select.value);
    after_change();
  });
  vat.append(vat_select);

  const total = make_cell("cell_total", "Total");
  total.dataset.index = String(index);

  const actions = make_cell("cell_actions", "Acciones");
  actions.append(
    make_action_button(`Subir el renglón ${number}`, "fa-solid fa-arrow-up", () => move_line(index, -1), index === 0),
    make_action_button(`Bajar el renglón ${number}`, "fa-solid fa-arrow-down", () => move_line(index, 1), index === count - 1),
    make_action_button(`Quitar el renglón ${number}`, "fa-regular fa-trash-can", () => remove_line(index), false),
  );

  // Enter en el último campo del último renglón agrega otro renglón: así se arma una lista sin soltar el teclado
  if (index === count - 1) {
    [price_input, discount_input, vat_select].forEach((field) =>
      field.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        add_line();
      }),
    );
  }

  row.append(description, quantity, price, discount, vat, total, actions);
  return row;
}

function render_lines(focus_id = null) {
  by_id("lines_table").classList.toggle("no_vat", !current.charges_vat);
  by_id("lines_body").replaceChildren(...current.lines.map((line, index) => make_line_row(line, index, current.lines.length)));
  render_totals();
  if (focus_id) focus_field(focus_id);
}

function add_line(line = null) {
  current.lines.push(line ?? blank_line(current.charges_vat));
  render_lines(`line_description_${current.lines.length - 1}`);
  update_preview();
  save_soon();
  announce(`Renglón ${current.lines.length} agregado.`);
}

function remove_line(index) {
  current.lines.splice(index, 1);
  const next = Math.min(index, current.lines.length - 1);
  render_lines(next >= 0 ? `line_description_${next}` : "add_line_button");
  update_preview();
  save_soon();
  announce("Renglón quitado.");
}

function move_line(index, step) {
  const target = index + step;
  if (target < 0 || target >= current.lines.length) return;
  [current.lines[index], current.lines[target]] = [current.lines[target], current.lines[index]];
  render_lines();
  // El foco sigue al renglón movido, en el mismo botón; si ese botón quedó desactivado (llegó al borde), en el otro
  const buttons = by_id("lines_body").children[target].querySelectorAll(".icon_button");
  const same = buttons[step < 0 ? 0 : 1];
  (same.disabled ? buttons[step < 0 ? 1 : 0] : same).focus();
  update_preview();
  save_soon();
  announce(`Renglón movido a la posición ${target + 1}.`);
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

function hide_catalog_results() {
  by_id("catalog_results").hidden = true;
}

function render_catalog_results() {
  const results = by_id("catalog_results");
  const query = normalize_text(by_id("catalog_search").value);
  if (query === "") {
    hide_catalog_results();
    return;
  }
  const matches = state.data.products.filter((product) => normalize_text(`${product.name} ${product.description}`).includes(query)).slice(0, MAX_CATALOG_RESULTS);
  results.replaceChildren();
  if (matches.length === 0) {
    const item = make_element("li", "");
    item.append(make_element("p", "empty_message", state.data.products.length === 0 ? "Todavía no tienes productos en el Catálogo." : "Ningún producto coincide."));
    results.append(item);
  }
  matches.forEach((product) => {
    const item = make_element("li", "");
    const button = make_element("button", "");
    button.type = "button";
    button.append(make_element("span", "", product.name), make_element("span", "result_price", format_money(product.price)));
    button.addEventListener("click", () => {
      add_line({ description: product.description ? `${product.name} - ${product.description}`.slice(0, 200) : product.name, quantity: 1, unit_price: product.price, discount_percent: 0, tax_rate: current.charges_vat ? product.tax_rate : 0 });
      by_id("catalog_search").value = "";
      hide_catalog_results();
    });
    item.append(button);
    results.append(item);
  });
  results.hidden = false;
}

// ---------------------------------------------------------------------------
// Totales
// ---------------------------------------------------------------------------

function render_totals() {
  const totals = calculate_totals(current);
  document.querySelectorAll("#lines_body .cell_total").forEach((cell) => (cell.textContent = format_money(totals.line_totals[Number(cell.dataset.index)])));
  const list = by_id("totals_list");
  list.replaceChildren();
  const add = (label, value, class_name = "") => {
    const term = make_element("dt", class_name, label);
    const detail = make_element("dd", class_name, value);
    list.append(term, detail);
  };
  add("Subtotal", format_money(totals.subtotal));
  if (totals.general_discount > 0) add(`Descuento (${format_percent(current.discount_percent)})`, format_money(-totals.general_discount));
  totals.vat.forEach((entry) => add(`IVA ${format_percent(entry.rate)}`, format_money(entry.amount)));
  if (totals.withholding > 0) add(`Retención en la fuente (${format_percent(current.withholding_percent)})`, format_money(-totals.withholding));
  add("Total", format_money(totals.total), "is_total");
}

function handle_percent_input(id, key) {
  const input = by_id(id);
  const value = input.value.trim() === "" ? 0 : parse_decimal(input.value);
  current[key] = Number.isNaN(value) || value < 0 ? 0 : Math.min(value, 100);
  after_change();
}

function show_percent(id, value) {
  by_id(id).value = value > 0 ? String(value).replace(".", ",") : "";
}

// ---------------------------------------------------------------------------
// Vista previa
// ---------------------------------------------------------------------------

function is_preview_visible() {
  return !by_id("doc_preview").hidden;
}

// Redibuja la vista previa (una vez por cuadro, aunque se escriba muy rápido)
function update_preview() {
  if (!is_preview_visible() || preview_frame) return;
  preview_frame = requestAnimationFrame(() => {
    preview_frame = 0;
    if (current) render_preview(by_id("doc_preview"), current, state.data.business);
  });
}

function set_preview(visible) {
  by_id("doc_preview").hidden = !visible;
  by_id("preview_button").setAttribute("aria-expanded", String(visible));
  by_id("preview_button").lastChild.textContent = visible ? " Ocultar vista previa" : " Vista previa";
  if (visible) render_preview(by_id("doc_preview"), current, state.data.business);
}

function handle_preview() {
  const visible = !is_preview_visible();
  set_preview(visible);
  if (visible) by_id("doc_preview").scrollIntoView({ block: "start" });
}

// ---------------------------------------------------------------------------
// Entregar: PDF, imprimir y enviar
// ---------------------------------------------------------------------------

function show_message(text, with_pdf_button = false) {
  const box = by_id("doc_message");
  box.replaceChildren(make_element("p", "", text));
  if (with_pdf_button) {
    const button = make_element("button", "button button_secondary button_small", "Descargar PDF");
    button.type = "button";
    button.addEventListener("click", handle_pdf);
    box.append(button);
  }
  box.hidden = false;
}

// Revisa que el documento esté completo. Si falta algo, lo dice y lleva el foco al primer campo que falta.
function ensure_valid() {
  const problems = validate_document(current, state.data.business);
  const box = by_id("doc_problems");
  if (problems.length === 0) {
    box.hidden = true;
    return true;
  }
  const list = make_element("ul", "");
  problems.forEach((problem) => list.append(make_element("li", "", problem.message)));
  box.replaceChildren(make_element("p", "", "Falta completar:"), list);
  box.hidden = false;
  const first = problems[0].field;
  if (first === "business_name") {
    announce(problems[0].message);
    hooks.go_to_view("business", "business_name");
  } else {
    focus_field(first);
  }
  return false;
}

// Descargar, imprimir o enviar pasa un borrador a "Enviada"
function mark_sent() {
  if (current.status !== "draft") return;
  current.status = "sent";
  render_status();
  save_now();
}

function handle_pdf() {
  if (!ensure_valid()) return;
  const file_name = pdf_file_name(current);
  download_file(file_name, build_document_pdf(current, state.data.business), "application/pdf");
  mark_sent();
  show_message(`PDF descargado como ${file_name}.`);
  announce(`PDF descargado como ${file_name}.`);
  flash_scene();
}

function handle_print() {
  if (!ensure_valid()) return;
  mark_sent();
  set_preview(true);
  window.print();
}

function handle_whatsapp() {
  if (!ensure_valid()) return;
  window.open(whatsapp_url(current, state.data.business), "_blank", "noopener");
  mark_sent();
  show_message(current.client.phone.trim() ? "Se abrió WhatsApp con el resumen. Recuerda adjuntar el PDF." : "Se abrió WhatsApp con el resumen; el cliente no tiene teléfono guardado, elige el chat tú. Recuerda adjuntar el PDF.", true);
  announce("Se abrió WhatsApp con el resumen del documento.");
  flash_scene();
}

function handle_email() {
  if (!ensure_valid()) return;
  mark_sent();
  show_message("Se abrió tu programa de correo con el resumen. Recuerda adjuntar el PDF.", true);
  announce("Se abrió el programa de correo con el resumen del documento.");
  flash_scene();
  window.location.href = mailto_url(current, state.data.business);
}

// ---------------------------------------------------------------------------
// Abrir y cerrar
// ---------------------------------------------------------------------------

function render_all() {
  by_id("editor_title").textContent = `${KIND_LABELS[current.kind]} ${current.number}`;
  by_id("doc_due_label").textContent = current.kind === "quote" ? "Vigencia hasta" : "Vence el";
  by_id("doc_date").value = current.date;
  by_id("doc_due").value = current.due_date;
  render_status();
  render_links();
  fill_client_select();
  render_client_fields();
  show_percent("doc_discount", current.discount_percent);
  show_percent("doc_withholding", current.withholding_percent);
  by_id("doc_charges_vat").checked = current.charges_vat;
  by_id("doc_notes").value = current.notes;
  by_id("catalog_search").value = "";
  hide_catalog_results();
  by_id("doc_problems").hidden = true;
  by_id("doc_message").hidden = true;
  render_lines();
  set_preview(false);
}

export function open_editor(id) {
  const found = state.data.documents.find((document) => document.id === id);
  if (!found) return;
  current = found;
  client_link = null;
  by_id("documents_screen").hidden = true;
  by_id("editor_screen").hidden = false;
  render_all();
  window.scrollTo({ top: 0 });
  by_id("editor_back_button").focus();
}

// Vuelve a la lista. Devuelve el id del documento que se estaba editando.
export function close_editor() {
  const id = current ? current.id : null;
  if (current) save_now();
  current = null;
  client_link = null;
  by_id("editor_screen").hidden = true;
  by_id("documents_screen").hidden = false;
  hooks.refresh_documents();
  return id;
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

export function init_editor() {
  by_id("editor_back_button").addEventListener("click", () => {
    const id = close_editor();
    const row = id ? document.querySelector(`#documents_list .item[data-id="${CSS.escape(id)}"] .item_main`) : null;
    (row ?? by_id("new_document_button")).focus();
  });

  by_id("doc_status").addEventListener("change", () => {
    current.status = by_id("doc_status").value;
    render_status();
    save_now();
    update_preview();
    announce(`Estado: ${STATUS_LABELS[current.status]}.`);
  });
  by_id("doc_date").addEventListener("change", () => {
    if (!is_valid_key(by_id("doc_date").value)) return;
    current.date = by_id("doc_date").value;
    after_change();
  });
  by_id("doc_due").addEventListener("change", () => {
    const value = by_id("doc_due").value;
    if (value !== "" && !is_valid_key(value)) return;
    current.due_date = value;
    render_status();
    after_change();
  });

  by_id("client_select").addEventListener("change", handle_client_select);
  CLIENT_FIELDS.forEach(([id, key]) => by_id(id).addEventListener("input", () => handle_client_input(id, key)));
  by_id("client_save").addEventListener("change", handle_client_save);

  by_id("add_line_button").addEventListener("click", () => add_line());
  by_id("catalog_search").addEventListener("input", render_catalog_results);
  by_id("catalog_search").addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide_catalog_results();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".catalog_search")) hide_catalog_results();
  });

  by_id("doc_discount").addEventListener("input", () => handle_percent_input("doc_discount", "discount_percent"));
  by_id("doc_withholding").addEventListener("input", () => handle_percent_input("doc_withholding", "withholding_percent"));
  ["doc_discount", "doc_withholding"].forEach((id) => by_id(id).addEventListener("blur", () => show_percent(id, current[id === "doc_discount" ? "discount_percent" : "withholding_percent"])));
  by_id("doc_charges_vat").addEventListener("change", () => {
    current.charges_vat = by_id("doc_charges_vat").checked;
    render_lines();
    update_preview();
    save_soon();
  });
  by_id("doc_notes").addEventListener("input", () => {
    current.notes = by_id("doc_notes").value;
    after_change();
  });

  by_id("preview_button").addEventListener("click", handle_preview);
  by_id("pdf_button").addEventListener("click", handle_pdf);
  by_id("print_button").addEventListener("click", handle_print);
  by_id("whatsapp_button").addEventListener("click", handle_whatsapp);
  by_id("email_button").addEventListener("click", handle_email);
}
