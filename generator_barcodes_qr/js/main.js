// Generador de códigos QR y de barras: pestañas, campos, código en vivo, descargas, copiar, imprimir y "Varios a la vez".
// Nada sale del navegador. Lo único que se recuerda en el equipo son las opciones y el último texto corto; la clave
// del Wi-Fi, los datos de un contacto y el número de WhatsApp no se guardan nunca.

import { start_scene, flash_scene } from "./animations.js";
import { QrError, encode_qr, fitting_level, build_wifi_text, build_contact_text, build_whatsapp_text } from "./qr_encoder.js";
import { BARCODE_TYPES, BarcodeError, encode_barcode } from "./barcode_encoder.js";
import { build_qr_drawing, build_barcode_drawing, drawing_to_svg, svg_to_element, drawing_to_png_blob, pixels_per_module } from "./code_renderer.js";

const STORAGE_KEY = "generator_barcodes_qr_last";
// Un texto más largo que esto (2 KB) no se guarda en el equipo
const MAX_SAVED_TEXT_LENGTH = 2048;
// Espera tras dejar de escribir antes de dibujar, para no calcular en cada tecla
const TYPING_DELAY_MILLISECONDS = 150;
const BATCH_DELAY_MILLISECONDS = 300;
// Los lectores de pantalla oyen el aviso cuando se deja de escribir, no con cada letra
const ANNOUNCE_DELAY_MILLISECONDS = 900;
const COPIED_MILLISECONDS = 2000;
// El destello del fondo no se repite más seguido que esto mientras se escribe
const MIN_FLASH_INTERVAL_MILLISECONDS = 800;
const MAX_BATCH_LINES = 200;
// Cuántos códigos del lote se dibujan por cuadro, para que la página no se congele
const BATCH_CHUNK_SIZE = 20;
const MAX_FILE_NAME_PART = 30;
const MAX_LABEL_TEXT = 80;
const MAX_CAPTION_TEXT = 60;

const EXAMPLE_QR_TEXT = "Escribe algo para generar tu código";
const EXAMPLE_BARCODE = { type: "ean13", text: "770200400350" };

const TAB_NAMES = ["qr", "barcode"];
const QR_TYPES = ["text", "wifi", "contact", "whatsapp"];

// Campos de cada tipo de QR que cuentan para saber si la persona ya empezó a llenarlo
const TYPE_INPUT_IDS = {
  wifi: ["wifi_ssid", "wifi_password"],
  contact: ["contact_first_name", "contact_last_name", "contact_phone", "contact_email", "contact_company", "contact_job_title", "contact_website"],
  whatsapp: ["whatsapp_number", "whatsapp_message"],
};

const by_id = (id) => document.getElementById(id);

const dom = {
  canvas: by_id("scene_canvas"),
  tab_list: document.querySelector('[role="tablist"]'),
  tabs: { qr: by_id("tab_qr"), barcode: by_id("tab_barcode") },
  panels: { qr: by_id("panel_qr"), barcode: by_id("panel_barcode") },
  batches: { qr: by_id("batch_qr"), barcode: by_id("batch_barcode") },
  controls: document.querySelector(".controls"),
  type_picker: by_id("qr_type_picker"),
  type_radios: Array.from(document.querySelectorAll('input[name="qr_type"]')),
  type_fields: { text: by_id("fields_text"), wifi: by_id("fields_wifi"), contact: by_id("fields_contact"), whatsapp: by_id("fields_whatsapp") },
  qr_text: by_id("qr_text"),
  qr_counter: by_id("qr_counter"),
  qr_level: by_id("qr_level"),
  qr_size: by_id("qr_size"),
  wifi_ssid: by_id("wifi_ssid"),
  wifi_password: by_id("wifi_password"),
  wifi_password_toggle: by_id("wifi_password_toggle"),
  wifi_security: by_id("wifi_security"),
  wifi_hidden: by_id("wifi_hidden"),
  contact_first_name: by_id("contact_first_name"),
  contact_last_name: by_id("contact_last_name"),
  contact_phone: by_id("contact_phone"),
  contact_email: by_id("contact_email"),
  contact_company: by_id("contact_company"),
  contact_job_title: by_id("contact_job_title"),
  contact_website: by_id("contact_website"),
  whatsapp_country_code: by_id("whatsapp_country_code"),
  whatsapp_number: by_id("whatsapp_number"),
  whatsapp_message: by_id("whatsapp_message"),
  barcode_type: by_id("barcode_type"),
  barcode_input: by_id("barcode_input"),
  barcode_hint: by_id("barcode_hint"),
  barcode_value: by_id("barcode_value"),
  barcode_value_text: by_id("barcode_value_text"),
  barcode_show_text: by_id("barcode_show_text"),
  barcode_height: by_id("barcode_height"),
  barcode_size: by_id("barcode_size"),
  warning: by_id("form_warning"),
  warning_text: by_id("form_warning_text"),
  lower_level_button: by_id("lower_level_button"),
  result_box: by_id("result_box"),
  placeholder: by_id("code_placeholder"),
  placeholder_drawing: by_id("placeholder_drawing"),
  code_holder: by_id("code_holder"),
  result_detail: by_id("result_detail"),
  result_note: by_id("result_note"),
  download_svg_button: by_id("download_svg_button"),
  download_png_button: by_id("download_png_button"),
  copy_button: by_id("copy_button"),
  copy_label: by_id("copy_label"),
  print_button: by_id("print_button"),
  live_status: by_id("live_status"),
  batch_input: { qr: by_id("batch_input_qr"), barcode: by_id("batch_input_barcode") },
  batch_count: { qr: by_id("batch_count_qr"), barcode: by_id("batch_count_barcode") },
  batch_grid: { qr: by_id("batch_grid_qr"), barcode: by_id("batch_grid_barcode") },
  print_sheet: { qr: by_id("print_sheet_qr"), barcode: by_id("print_sheet_barcode") },
};
dom.copy_icon = dom.copy_button.querySelector("i");
dom.action_buttons = [dom.download_svg_button, dom.download_png_button, dom.copy_button, dom.print_button];

const state = {
  tab: "qr",
  qr_type: "text",
  // Último código válido en pantalla: { kind, drawing, label, detail, file_base, target, notes }
  current: null,
};

let typing_timer = 0;
let save_timer = 0;
let announce_timer = 0;
let copied_timer = 0;
let last_flash_time = 0;
// Texto del último QR que se intentó codificar, para sugerir una corrección menor si no cabe
let last_qr_text = "";
const batch_runs = { qr: { timer: 0, run: 0 }, barcode: { timer: 0, run: 0 } };

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

// Número con punto de miles, como se escribe en Colombia
function format_count(count) {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function truncate(text, maximum) {
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

// Parte del nombre de un archivo: solo letras, números y guion bajo
function file_name_part(text) {
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_FILE_NAME_PART)
    .replace(/_+$/, "");
  return slug || "code";
}

function announce(message) {
  dom.live_status.textContent = message;
}

// Avisa a lectores de pantalla pasado un momento sin cambios, para no hablar con cada letra escrita
function announce_later(message) {
  clearTimeout(announce_timer);
  announce_timer = setTimeout(() => announce(message), ANNOUNCE_DELAY_MILLISECONDS);
}

function show_warning(message, lower_level = null) {
  dom.warning_text.textContent = message;
  dom.lower_level_button.hidden = !lower_level;
  if (lower_level) {
    dom.lower_level_button.dataset.level = lower_level;
    dom.lower_level_button.textContent = `Usar corrección ${lower_level}`;
  }
  dom.warning.hidden = false;
}

function hide_warning() {
  dom.warning.hidden = true;
  dom.lower_level_button.hidden = true;
}

function set_actions_enabled(enabled) {
  dom.action_buttons.forEach((button) => {
    button.disabled = !enabled;
  });
}

function is_text_like(element) {
  return element.matches('input:not([type="checkbox"]):not([type="radio"]), textarea');
}

// ---------------------------------------------------------------------------
// Memoria en el equipo (sin claves ni datos de otras personas)
// ---------------------------------------------------------------------------

function select_has_value(select, value) {
  return Array.from(select.options).some((option) => option.value === value);
}

function load_state() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

function save_state() {
  const data = {
    tab: state.tab,
    qr_type: state.qr_type,
    qr_level: dom.qr_level.value,
    qr_size: dom.qr_size.value,
    barcode_type: dom.barcode_type.value,
    barcode_show_text: dom.barcode_show_text.checked,
    barcode_height: dom.barcode_height.value,
    barcode_size: dom.barcode_size.value,
  };
  // Solo el texto libre y el contenido de barras, y solo si son cortos
  if (dom.qr_text.value.length <= MAX_SAVED_TEXT_LENGTH) data.qr_text = dom.qr_text.value;
  if (dom.barcode_input.value.length <= MAX_SAVED_TEXT_LENGTH) data.barcode_text = dom.barcode_input.value;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Almacenamiento bloqueado o lleno: la página funciona igual, solo que sin recordar
  }
}

function schedule_save() {
  clearTimeout(save_timer);
  save_timer = setTimeout(save_state, 400);
}

// Cada campo malo se descarta por separado: un dato dañado no impide recuperar los demás
function restore_state(stored) {
  const restore_select = (select, value) => {
    if (typeof value === "string" && select_has_value(select, value)) select.value = value;
  };
  restore_select(dom.qr_level, stored.qr_level);
  restore_select(dom.qr_size, stored.qr_size);
  restore_select(dom.barcode_type, stored.barcode_type);
  restore_select(dom.barcode_height, stored.barcode_height);
  restore_select(dom.barcode_size, stored.barcode_size);
  if (typeof stored.barcode_show_text === "boolean") dom.barcode_show_text.checked = stored.barcode_show_text;
  if (typeof stored.qr_text === "string" && stored.qr_text.length <= MAX_SAVED_TEXT_LENGTH) dom.qr_text.value = stored.qr_text;
  if (typeof stored.barcode_text === "string" && stored.barcode_text.length <= MAX_SAVED_TEXT_LENGTH) dom.barcode_input.value = stored.barcode_text;
  if (QR_TYPES.includes(stored.qr_type)) state.qr_type = stored.qr_type;
  if (TAB_NAMES.includes(stored.tab)) state.tab = stored.tab;
}

// ---------------------------------------------------------------------------
// Contenido y código
// ---------------------------------------------------------------------------

function any_type_field_filled() {
  return (TYPE_INPUT_IDS[state.qr_type] || []).some((id) => by_id(id).value.trim() !== "");
}

// El texto que se va a codificar según el tipo de contenido, con su descripción y el nombre base del archivo.
// Lanza QrError: "empty" si falta lo obligatorio, "invalid_input" si algo no sirve.
function read_qr_content() {
  if (state.qr_type === "wifi") {
    const ssid = dom.wifi_ssid.value.trim();
    const text = build_wifi_text({ ssid, password: dom.wifi_password.value, security: dom.wifi_security.value, hidden: dom.wifi_hidden.checked });
    return { text, label: `Código QR de la red Wi-Fi ${ssid}`, file_base: `qr_wifi_${file_name_part(ssid)}` };
  }
  if (state.qr_type === "contact") {
    const first_name = dom.contact_first_name.value.trim();
    const last_name = dom.contact_last_name.value.trim();
    const text = build_contact_text({
      first_name,
      last_name,
      phone: dom.contact_phone.value,
      email: dom.contact_email.value,
      company: dom.contact_company.value,
      job_title: dom.contact_job_title.value,
      website: dom.contact_website.value,
    });
    const full_name = [first_name, last_name].filter(Boolean).join(" ");
    return { text, label: `Código QR del contacto ${full_name}`, file_base: `qr_contact_${file_name_part(full_name)}` };
  }
  if (state.qr_type === "whatsapp") {
    const text = build_whatsapp_text({ country_code: dom.whatsapp_country_code.value, number: dom.whatsapp_number.value, message: dom.whatsapp_message.value });
    return { text, label: "Código QR de un chat de WhatsApp", file_base: `qr_whatsapp_${file_name_part(dom.whatsapp_number.value)}` };
  }
  const text = dom.qr_text.value.trim();
  if (!text) throw new QrError("empty", "Escribe un texto o pega un enlace.");
  return { text, label: `Código QR con el texto: ${truncate(text.replace(/\s+/g, " "), MAX_LABEL_TEXT)}`, file_base: `qr_${file_name_part(text)}` };
}

function update_counter(text, version = 0, level = "", fits = true) {
  if (state.qr_type !== "text") return;
  const characters = [...text].length;
  let message = `${format_count(characters)} ${characters === 1 ? "carácter" : "caracteres"}`;
  if (!fits) message += " · no cabe con esa corrección";
  else if (version) message += ` · versión ${version}-${level}`;
  dom.qr_counter.textContent = message;
}

function make_qr_result() {
  const content = read_qr_content();
  last_qr_text = content.text;
  const level = dom.qr_level.value;
  let encoded;
  try {
    encoded = encode_qr(content.text, level);
  } catch (error) {
    if (error instanceof QrError && error.code === "too_long") update_counter(dom.qr_text.value.trim(), 0, level, false);
    throw error;
  }
  update_counter(dom.qr_text.value.trim(), encoded.version, level);
  return {
    kind: "qr",
    drawing: build_qr_drawing(encoded.matrix),
    label: content.label,
    detail: `QR · ${format_count(encoded.bytes)} bytes · versión ${encoded.version} · corrección ${level}`,
    file_base: content.file_base,
    target: Number(dom.qr_size.value),
    notes: [],
    announcement: `Código listo: QR de ${format_count(encoded.bytes)} bytes`,
  };
}

function make_barcode_result() {
  const type_id = dom.barcode_type.value;
  const text = dom.barcode_input.value.trim();
  if (!text) throw new BarcodeError("empty", "Escribe el contenido del código.");
  const model = encode_barcode(type_id, text);
  const drawing = build_barcode_drawing(model, { height: dom.barcode_height.value, show_text: dom.barcode_show_text.checked });
  return {
    kind: "barcode",
    drawing,
    label: `Código de barras ${model.type_label}: ${model.value}`,
    detail: `${model.type_label} · ${model.value}`,
    file_base: `barcode_${type_id}_${file_name_part(model.value)}`,
    target: Number(dom.barcode_size.value),
    notes: model.notes,
    // Si se calculó el dígito de control, se muestra el valor completo debajo del campo
    value_hint: model.value !== text ? model.value : "",
    announcement: `Código listo: ${model.type_label} ${model.value}`,
  };
}

// ---------------------------------------------------------------------------
// Resultado en pantalla
// ---------------------------------------------------------------------------

function show_empty() {
  state.current = null;
  dom.code_holder.hidden = true;
  dom.code_holder.replaceChildren();
  dom.placeholder.hidden = false;
  dom.result_box.classList.remove("is_stale");
  dom.result_detail.hidden = true;
  dom.result_note.hidden = true;
  set_actions_enabled(false);
}

// Lo escrito ya no sirve: el último código válido se queda atenuado y sin botones, para que nadie descargue uno viejo
function mark_stale() {
  if (!state.current) return;
  dom.result_box.classList.add("is_stale");
  set_actions_enabled(false);
}

function show_result(result) {
  state.current = result;
  dom.code_holder.replaceChildren(svg_to_element(drawing_to_svg(result.drawing, { label: result.label })));
  dom.code_holder.dataset.kind = result.drawing.kind;
  dom.code_holder.hidden = false;
  dom.placeholder.hidden = true;
  dom.result_box.classList.remove("is_stale");
  dom.result_detail.textContent = result.detail;
  dom.result_detail.hidden = false;
  dom.result_note.textContent = result.notes.join(" ");
  dom.result_note.hidden = result.notes.length === 0;
  set_actions_enabled(true);
  reset_copy_button();

  if (state.tab === "barcode") {
    dom.barcode_value_text.textContent = result.value_hint || "";
    dom.barcode_value.hidden = !result.value_hint;
  }

  const now = performance.now();
  if (now - last_flash_time > MIN_FLASH_INTERVAL_MILLISECONDS) {
    last_flash_time = now;
    flash_scene();
  }
  announce_later(result.announcement);
}

function warn_too_long(error) {
  const { level, mode, count, max_count } = error.details;
  const unit = mode === "byte" ? "bytes" : "caracteres";
  let message = `No cabe en un QR con corrección ${level}: tiene ${format_count(count)} ${unit} y caben ${format_count(max_count)} como máximo.`;
  const lower_level = fitting_level(last_qr_text, level);
  if (!lower_level) message += " Acórtalo para que quepa.";
  show_warning(message, lower_level);
}

function handle_error(error) {
  const is_known = error instanceof QrError || error instanceof BarcodeError;
  if (is_known && error.code === "empty") {
    // Con un tipo de varios campos, si ya empezó a llenarlo se le dice qué falta; si no, no se le avisa de nada
    if (state.tab === "qr" && state.qr_type !== "text" && any_type_field_filled()) {
      mark_stale();
      show_warning(error.message);
    } else {
      show_empty();
      update_counter("");
    }
    return;
  }
  mark_stale();
  if (error instanceof QrError && error.code === "too_long") warn_too_long(error);
  else show_warning(is_known ? error.message : "No se pudo generar el código. Revisa lo que escribiste.");
  if (state.tab === "barcode") dom.barcode_value.hidden = true;
}

// Calcula y dibuja el código de la pestaña activa con lo que haya en los campos
function refresh() {
  hide_warning();
  if (state.tab === "barcode") dom.barcode_value.hidden = true;
  try {
    show_result(state.tab === "qr" ? make_qr_result() : make_barcode_result());
  } catch (error) {
    handle_error(error);
  }
}

function schedule_refresh() {
  clearTimeout(typing_timer);
  typing_timer = setTimeout(refresh, TYPING_DELAY_MILLISECONDS);
}

// Un código de ejemplo, atenuado, mientras no hay nada escrito
function render_placeholder() {
  const drawing =
    state.tab === "qr"
      ? build_qr_drawing(encode_qr(EXAMPLE_QR_TEXT, "M").matrix)
      : build_barcode_drawing(encode_barcode(EXAMPLE_BARCODE.type, EXAMPLE_BARCODE.text), { height: "normal", show_text: true });
  dom.placeholder_drawing.replaceChildren(svg_to_element(drawing_to_svg(drawing)));
  dom.placeholder_drawing.dataset.kind = drawing.kind;
}

// ---------------------------------------------------------------------------
// Pestañas, tipos y campos
// ---------------------------------------------------------------------------

function select_tab(tab_name) {
  state.tab = tab_name;
  TAB_NAMES.forEach((name) => {
    const is_active = name === tab_name;
    dom.tabs[name].setAttribute("aria-selected", String(is_active));
    dom.tabs[name].tabIndex = is_active ? 0 : -1;
    dom.panels[name].hidden = !is_active;
    dom.batches[name].hidden = !is_active;
  });
  render_placeholder();
  show_empty();
  refresh();
}

function handle_tab_keydown(event) {
  const index = TAB_NAMES.indexOf(state.tab);
  const last = TAB_NAMES.length - 1;
  const target = {
    ArrowRight: index === last ? 0 : index + 1,
    ArrowLeft: index === 0 ? last : index - 1,
    Home: 0,
    End: last,
  }[event.key];
  if (target === undefined) return;
  event.preventDefault();
  select_tab(TAB_NAMES[target]);
  dom.tabs[TAB_NAMES[target]].focus();
  schedule_save();
}

function set_qr_type(type) {
  state.qr_type = type;
  QR_TYPES.forEach((name) => {
    dom.type_fields[name].hidden = name !== type;
  });
  dom.type_radios.forEach((radio) => {
    radio.checked = radio.value === type;
  });
}

// Las flechas ya cambian de ficha en un grupo de radios; Inicio y Fin se agregan para que sea igual que las pestañas
function handle_type_keydown(event) {
  if (event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  const radio = event.key === "Home" ? dom.type_radios[0] : dom.type_radios[dom.type_radios.length - 1];
  radio.focus();
  set_qr_type(radio.value);
  refresh();
  schedule_save();
}

// Cada tipo de barras tiene su pista, su teclado y su ejemplo
function apply_barcode_type() {
  const type = BARCODE_TYPES.find((item) => item.id === dom.barcode_type.value);
  dom.barcode_hint.textContent = type.hint;
  dom.barcode_input.placeholder = type.placeholder;
  dom.barcode_input.inputMode = type.numeric ? "numeric" : "text";
}

function toggle_password_visibility() {
  const is_hidden = dom.wifi_password.type === "password";
  dom.wifi_password.type = is_hidden ? "text" : "password";
  dom.wifi_password_toggle.setAttribute("aria-pressed", String(is_hidden));
  dom.wifi_password_toggle.setAttribute("aria-label", is_hidden ? "Ocultar la clave" : "Mostrar la clave");
  dom.wifi_password_toggle.querySelector("i").className = is_hidden ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
}

// ---------------------------------------------------------------------------
// Descargar, copiar e imprimir
// ---------------------------------------------------------------------------

function download_blob(blob, file_name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file_name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function handle_download_svg() {
  const current = state.current;
  if (!current) return;
  // El archivo lleva tamaño propio (módulos enteros, como el PNG) para que se abra con un tamaño razonable
  const svg = drawing_to_svg(current.drawing, { label: current.label, scale: pixels_per_module(current.drawing, current.target) });
  download_blob(new Blob([svg], { type: "image/svg+xml" }), `${current.file_base}.svg`);
  announce("Se descargó el archivo SVG");
}

async function handle_download_png() {
  const current = state.current;
  if (!current) return;
  try {
    download_blob(await drawing_to_png_blob(current.drawing, current.target), `${current.file_base}.png`);
    announce("Se descargó la imagen PNG");
  } catch {
    show_warning("No se pudo crear la imagen PNG. Prueba con el SVG.");
  }
}

function reset_copy_button() {
  clearTimeout(copied_timer);
  dom.copy_label.textContent = "Copiar";
  dom.copy_icon.className = "fa-regular fa-copy";
}

function show_copy_state(label_text, icon_class, status) {
  clearTimeout(copied_timer);
  dom.copy_label.textContent = label_text;
  dom.copy_icon.className = icon_class;
  announce(status);
  copied_timer = setTimeout(reset_copy_button, COPIED_MILLISECONDS);
}

async function handle_copy() {
  const current = state.current;
  if (!current) return;
  try {
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") throw new Error("sin portapapeles");
    // Se entrega la promesa del PNG y no el Blob ya listo: Safari exige que el permiso se pida dentro del toque
    await navigator.clipboard.write([new ClipboardItem({ "image/png": drawing_to_png_blob(current.drawing, current.target) })]);
    show_copy_state("Copiado", "fa-solid fa-check", "Imagen copiada");
  } catch {
    show_copy_state("No se pudo", "fa-solid fa-triangle-exclamation", "No se pudo copiar la imagen. Usa Descargar PNG.");
  }
}

// Imprime con una de las dos disposiciones de la hoja de estilos: solo el código ("single") o la hoja de varios ("sheet")
function print_page(mode) {
  document.body.dataset.print = mode;
  window.print();
}

function print_sheet(kind) {
  // Un <details> cerrado no se imprime: se abre antes
  dom.batches[kind].open = true;
  print_page("sheet");
}

// ---------------------------------------------------------------------------
// Varios a la vez
// ---------------------------------------------------------------------------

function read_batch_lines(kind) {
  const all = dom.batch_input[kind].value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return { lines: all.slice(0, MAX_BATCH_LINES), ignored: Math.max(0, all.length - MAX_BATCH_LINES) };
}

function make_batch_element(class_name, children) {
  const element = document.createElement("li");
  element.className = class_name;
  element.append(...children);
  return element;
}

function make_paragraph(text, class_name = "") {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  if (class_name) paragraph.className = class_name;
  return paragraph;
}

// Un motivo corto para la etiqueta; el aviso largo de "no cabe" no entra en una etiqueta chica
function short_reason(error) {
  if (error instanceof QrError && error.code === "too_long") return `No cabe con corrección ${error.details.level}.`;
  return error instanceof QrError || error instanceof BarcodeError ? error.message : "No se pudo generar.";
}

// Dibuja la etiqueta de una línea; si no sirve, una ficha con el motivo
function make_batch_item(kind, line) {
  try {
    let drawing;
    let label;
    if (kind === "qr") {
      drawing = build_qr_drawing(encode_qr(line, dom.qr_level.value).matrix);
      label = `Código QR: ${truncate(line, MAX_LABEL_TEXT)}`;
    } else {
      const model = encode_barcode(dom.barcode_type.value, line);
      drawing = build_barcode_drawing(model, { height: dom.barcode_height.value, show_text: dom.barcode_show_text.checked });
      label = `Código de barras ${model.type_label}: ${model.value}`;
    }
    const figure = svg_to_element(drawing_to_svg(drawing, { label }));
    return { ok: true, element: make_batch_element("batch_item", [figure, make_paragraph(truncate(line, MAX_CAPTION_TEXT))]) };
  } catch (error) {
    const children = [make_paragraph(`«${truncate(line, MAX_CAPTION_TEXT)}»`), make_paragraph(short_reason(error), "batch_error_reason")];
    return { ok: false, element: make_batch_element("batch_item is_error", children) };
  }
}

function describe_batch_count(total, error_count, ignored) {
  let text = `${format_count(total)} ${total === 1 ? "código" : "códigos"}`;
  if (error_count) text += ` (${format_count(error_count)} con error)`;
  if (ignored) text += ` · se ignoraron ${format_count(ignored)} líneas de más: el máximo es ${MAX_BATCH_LINES}`;
  return text;
}

// Dibuja el lote en tandas, un cuadro entre una y otra, y cancela la tanda anterior si el texto cambió
function render_batch(kind) {
  const run = ++batch_runs[kind].run;
  const { lines, ignored } = read_batch_lines(kind);
  const grid = dom.batch_grid[kind];
  const counter = dom.batch_count[kind];
  grid.replaceChildren();
  dom.print_sheet[kind].disabled = true;
  if (!lines.length) {
    counter.textContent = "0 códigos";
    return;
  }

  let index = 0;
  let ok_count = 0;
  function draw_next_chunk() {
    if (run !== batch_runs[kind].run) return;
    const fragment = document.createDocumentFragment();
    const end = Math.min(index + BATCH_CHUNK_SIZE, lines.length);
    for (; index < end; index++) {
      const item = make_batch_item(kind, lines[index]);
      if (item.ok) ok_count++;
      fragment.append(item.element);
    }
    grid.append(fragment);
    if (index < lines.length) {
      counter.textContent = `Dibujando… ${format_count(index)} de ${format_count(lines.length)}`;
      requestAnimationFrame(draw_next_chunk);
      return;
    }
    counter.textContent = describe_batch_count(lines.length, lines.length - ok_count, ignored);
    dom.print_sheet[kind].disabled = ok_count === 0;
  }
  draw_next_chunk();
}

function schedule_batch(kind) {
  clearTimeout(batch_runs[kind].timer);
  batch_runs[kind].timer = setTimeout(() => render_batch(kind), BATCH_DELAY_MILLISECONDS);
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

function handle_input(event) {
  if (!is_text_like(event.target)) return;
  schedule_refresh();
  schedule_save();
}

// Selectores, casillas y fichas: cambian al instante, sin esperar
function handle_change(event) {
  const target = event.target;
  if (target.name === "qr_type") set_qr_type(target.value);
  else if (target === dom.barcode_type) apply_barcode_type();
  else if (is_text_like(target)) return;
  clearTimeout(typing_timer);
  refresh();
  schedule_save();
  // Estas opciones también cambian cómo se dibuja cada etiqueta del lote
  if (target === dom.qr_level) schedule_batch("qr");
  if ([dom.barcode_type, dom.barcode_height, dom.barcode_show_text].includes(target)) schedule_batch("barcode");
}

function handle_lower_level() {
  dom.qr_level.value = dom.lower_level_button.dataset.level;
  refresh();
  schedule_batch("qr");
  schedule_save();
}

function setup_events() {
  dom.tab_list.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (!tab) return;
    select_tab(tab.dataset.tab);
    schedule_save();
  });
  dom.tab_list.addEventListener("keydown", handle_tab_keydown);
  dom.type_picker.addEventListener("keydown", handle_type_keydown);

  dom.controls.addEventListener("input", handle_input);
  dom.controls.addEventListener("change", handle_change);
  // Escape en el campo de la clave la vuelve a ocultar
  dom.wifi_password.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dom.wifi_password.type === "text") toggle_password_visibility();
  });
  dom.wifi_password_toggle.addEventListener("click", toggle_password_visibility);
  dom.lower_level_button.addEventListener("click", handle_lower_level);

  dom.download_svg_button.addEventListener("click", handle_download_svg);
  dom.download_png_button.addEventListener("click", handle_download_png);
  dom.copy_button.addEventListener("click", handle_copy);
  dom.print_button.addEventListener("click", () => print_page("single"));
  window.addEventListener("afterprint", () => {
    delete document.body.dataset.print;
  });

  TAB_NAMES.forEach((kind) => {
    dom.batch_input[kind].addEventListener("input", () => schedule_batch(kind));
    dom.print_sheet[kind].addEventListener("click", () => print_sheet(kind));
  });
}

function init() {
  restore_state(load_state());
  apply_barcode_type();
  set_qr_type(state.qr_type);
  setup_events();
  select_tab(state.tab);
  start_scene(dom.canvas);
}

init();
