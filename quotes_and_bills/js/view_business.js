// Mi negocio: los datos del negocio que salen en todos los documentos (con su logo), los prefijos y contadores de
// numeración, los valores por defecto y el respaldo (Exportar e Importar). Los datos se guardan al escribir.
import { clean_tax_id, export_backup, min_counter, parse_backup, parse_decimal, today_key } from "./document_model.js";
import { hooks } from "./navigation.js";
import { replace_data, save_now, save_soon, state } from "./store.js";
import { announce, ask_confirmation, by_id, count_text, download_file, now_iso } from "./ui_helpers.js";

const LOGO_MAX_SIDE = 400;
const LOGO_QUALITY_STEPS = [0.85, 0.7, 0.55, 0.4];
// Un JPEG de más de esto se descarta al limpiar los datos: aquí se reduce hasta que quepa
const LOGO_MAX_LENGTH = 250000;
const MAX_LOGO_FILE_BYTES = 15 * 1024 * 1024;
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

// Los campos de texto del negocio: el id del control y la clave en los datos
const TEXT_FIELDS = [
  ["business_name", "name"],
  ["business_phone", "phone"],
  ["business_email", "email"],
  ["business_address", "address"],
  ["business_city", "city"],
  ["business_payment_info", "payment_info"],
  ["business_footer", "footer_text"],
];

// ---------------------------------------------------------------------------
// Dibujo
// ---------------------------------------------------------------------------

function render_logo() {
  const logo = state.data.business.logo;
  by_id("logo_image").hidden = logo === "";
  by_id("logo_placeholder").hidden = logo !== "";
  if (logo) by_id("logo_image").src = logo;
  by_id("logo_remove_button").disabled = logo === "";
}

export function render_business() {
  const { business, counters } = state.data;
  TEXT_FIELDS.forEach(([id, key]) => (by_id(id).value = business[key]));
  by_id("business_tax_id").value = business.tax_id;
  by_id("business_charges_vat").checked = business.charges_vat;
  by_id("business_withholding").value = String(business.default_withholding).replace(".", ",");
  by_id("business_validity").value = String(business.default_validity_days);
  by_id("business_quote_prefix").value = business.quote_prefix;
  by_id("business_bill_prefix").value = business.bill_prefix;
  by_id("business_quote_counter").value = String(counters.quote);
  by_id("business_bill_counter").value = String(counters.bill);
  by_id("counter_message").hidden = true;
  render_logo();
}

export function show_welcome() {
  by_id("welcome_box").hidden = false;
}

// ---------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------

function set_business_field(key, value) {
  state.data.business[key] = value;
  save_soon();
}

// Un porcentaje de 0 a 100 escrito con coma o punto; si no es válido, el campo se queda como estaba
function handle_withholding_input() {
  const value = parse_decimal(by_id("business_withholding").value);
  if (Number.isNaN(value) || value < 0 || value > 100) return;
  set_business_field("default_withholding", value);
}

function handle_validity_input() {
  const value = Number(by_id("business_validity").value.trim());
  if (!Number.isInteger(value) || value < 1 || value > 365) return;
  set_business_field("default_validity_days", value);
}

// El prefijo de numeración: solo letras y números, en mayúscula, hasta 6. Cambiarlo no toca los documentos que ya tienen número.
function handle_prefix_input(id, key, fallback) {
  const input = by_id(id);
  const cleaned = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (cleaned !== input.value) input.value = cleaned;
  set_business_field(key, cleaned === "" ? fallback : cleaned);
}

// El próximo número no puede quedar por debajo del mayor ya usado con ese prefijo: así nunca se repite un número
function handle_counter_input(id, kind) {
  const message = by_id("counter_message");
  const value = Number(by_id(id).value.trim());
  const minimum = min_counter(state.data.documents, kind, state.data.business[`${kind}_prefix`]);
  if (!Number.isInteger(value) || value < 1 || value > 99999999) {
    message.textContent = "Escribe un número entero de 1 en adelante.";
    message.hidden = false;
    return;
  }
  if (value < minimum) {
    message.textContent = `Ya hay documentos con ese prefijo hasta el número ${minimum - 1}: el próximo no puede ser menor que ${minimum}.`;
    message.hidden = false;
    return;
  }
  message.hidden = true;
  state.data.counters[kind] = value;
  save_soon();
}

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

function show_logo_message(text) {
  const message = by_id("logo_message");
  message.textContent = text;
  message.hidden = text === "";
}

function load_image(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No es una imagen"));
    };
    image.src = url;
  });
}

// La imagen a 400 px de lado como máximo, como JPEG sobre fondo blanco: el PDF lo incrusta tal cual, sin recomprimirlo
async function resize_logo(file) {
  const image = await load_image(file);
  const natural = Math.max(image.naturalWidth || LOGO_MAX_SIDE, image.naturalHeight || LOGO_MAX_SIDE);
  const scale = Math.min(1, LOGO_MAX_SIDE / natural);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((image.naturalWidth || LOGO_MAX_SIDE) * scale));
  canvas.height = Math.max(1, Math.round((image.naturalHeight || LOGO_MAX_SIDE) * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of LOGO_QUALITY_STEPS) {
    const data_url = canvas.toDataURL("image/jpeg", quality);
    if (data_url.length <= LOGO_MAX_LENGTH) return data_url;
  }
  throw new Error("La imagen es demasiado pesada");
}

async function handle_logo_file() {
  const file = by_id("logo_file").files[0];
  by_id("logo_file").value = "";
  if (!file) return;
  if (file.size > MAX_LOGO_FILE_BYTES) {
    show_logo_message("Esa imagen es demasiado pesada. Prueba con una más pequeña.");
    return;
  }
  try {
    state.data.business.logo = await resize_logo(file);
  } catch {
    show_logo_message("No se pudo leer esa imagen. Prueba con un archivo PNG o JPG.");
    return;
  }
  show_logo_message("");
  save_now();
  render_logo();
  announce("Logo guardado.");
}

function handle_logo_remove() {
  state.data.business.logo = "";
  show_logo_message("");
  save_now();
  render_logo();
  announce("Logo quitado.");
}

// ---------------------------------------------------------------------------
// Respaldo
// ---------------------------------------------------------------------------

function show_backup_message(text, is_error) {
  const message = by_id("backup_message");
  message.textContent = text;
  message.classList.toggle("is_error", is_error);
  message.hidden = text === "";
}

// Baja un respaldo de todo y anota la fecha, para el recordatorio
export function export_data(file_prefix = "cotizaciones_respaldo") {
  const today = today_key(new Date());
  download_file(`${file_prefix}_${today}.json`, export_backup(state.data, now_iso()), "application/json");
  if (file_prefix === "cotizaciones_respaldo") {
    state.data.last_export = today;
    save_now();
    hooks.refresh_reminder();
  }
  return today;
}

function handle_export() {
  export_data();
  show_backup_message("Copia descargada. Guárdala en un lugar seguro.", false);
  announce("Copia de seguridad descargada.");
}

async function handle_import() {
  const file = by_id("import_file").files[0];
  // Se vacía el campo para poder abrir el mismo archivo otra vez
  by_id("import_file").value = "";
  if (!file) return;
  show_backup_message("", false);
  if (file.size > MAX_IMPORT_BYTES) {
    show_backup_message("Este archivo es demasiado grande para ser un respaldo.", true);
    return;
  }
  let text;
  try {
    text = await file.text();
  } catch {
    show_backup_message("No se pudo leer el archivo.", true);
    return;
  }
  const parsed = parse_backup(text, now_iso());
  if (parsed.error) {
    show_backup_message(parsed.error, true);
    return;
  }
  const { data, discarded } = parsed;
  const discarded_total = discarded.clients + discarded.products + discarded.documents;
  const summary = `El archivo trae ${count_text(data.clients.length, "cliente", "clientes")}, ${count_text(data.products.length, "producto", "productos")} y ${count_text(data.documents.length, "documento", "documentos")}${discarded_total > 0 ? ` (se descartó ${count_text(discarded_total, "elemento dañado", "elementos dañados")})` : ""}.`;
  const accepted = await ask_confirmation(`${summary} Al importar se reemplaza todo lo que tienes ahora; antes se descarga una copia de lo actual. ¿Continuar?`, "Importar");
  if (!accepted) {
    by_id("import_button").focus();
    return;
  }
  export_data("cotizaciones_respaldo_antes_de_importar");
  replace_data(data);
  hooks.refresh_all();
  show_backup_message(`Se importaron ${count_text(data.documents.length, "documento", "documentos")}.`, false);
  announce("Respaldo importado.");
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

export function init_business() {
  TEXT_FIELDS.forEach(([id, key]) => by_id(id).addEventListener("input", () => set_business_field(key, by_id(id).value)));
  by_id("business_tax_id").addEventListener("input", () => {
    const input = by_id("business_tax_id");
    const cleaned = clean_tax_id(input.value);
    if (cleaned !== input.value) input.value = cleaned;
    set_business_field("tax_id", cleaned);
  });
  by_id("business_charges_vat").addEventListener("change", () => set_business_field("charges_vat", by_id("business_charges_vat").checked));
  by_id("business_withholding").addEventListener("input", handle_withholding_input);
  by_id("business_validity").addEventListener("input", handle_validity_input);
  by_id("business_quote_prefix").addEventListener("input", () => handle_prefix_input("business_quote_prefix", "quote_prefix", "COT"));
  by_id("business_bill_prefix").addEventListener("input", () => handle_prefix_input("business_bill_prefix", "bill_prefix", "CC"));
  by_id("business_quote_counter").addEventListener("input", () => handle_counter_input("business_quote_counter", "quote"));
  by_id("business_bill_counter").addEventListener("input", () => handle_counter_input("business_bill_counter", "bill"));
  // Al salir de un campo con un valor corregido o no válido, se vuelve a mostrar lo que de verdad quedó guardado
  ["business_withholding", "business_validity", "business_quote_counter", "business_bill_counter"].forEach((id) => by_id(id).addEventListener("blur", () => render_business_numbers()));
  by_id("logo_button").addEventListener("click", () => by_id("logo_file").click());
  by_id("logo_file").addEventListener("change", handle_logo_file);
  by_id("logo_remove_button").addEventListener("click", handle_logo_remove);
  by_id("export_button").addEventListener("click", handle_export);
  by_id("import_button").addEventListener("click", () => by_id("import_file").click());
  by_id("import_file").addEventListener("change", handle_import);
  by_id("welcome_close_button").addEventListener("click", () => (by_id("welcome_box").hidden = true));
}

function render_business_numbers() {
  const { business, counters } = state.data;
  by_id("business_withholding").value = String(business.default_withholding).replace(".", ",");
  by_id("business_validity").value = String(business.default_validity_days);
  by_id("business_quote_counter").value = String(counters.quote);
  by_id("business_bill_counter").value = String(counters.bill);
  by_id("counter_message").hidden = true;
}
