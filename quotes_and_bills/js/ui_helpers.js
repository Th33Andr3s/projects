// Piezas de pantalla que comparten todas las vistas: crear elementos, avisos a lectores de pantalla, confirmaciones,
// descargas de archivos e identificadores. Nada de aquí sabe de cotizaciones.

const ANNOUNCE_DELAY_MILLISECONDS = 50;
// Se espera un momento antes de soltar el archivo temporal, para que el navegador alcance a descargarlo
const REVOKE_URL_DELAY_MILLISECONDS = 1000;

export function make_element(tag, class_name, text) {
  const element = document.createElement(tag);
  if (class_name) element.className = class_name;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function by_id(id) {
  return document.getElementById(id);
}

// Lo que se avisa a lectores de pantalla, con un momento de pausa para que se vuelva a leer aunque el texto sea igual
// al anterior
export function announce(message) {
  const live_status = by_id("live_status");
  live_status.textContent = "";
  setTimeout(() => (live_status.textContent = message), ANNOUNCE_DELAY_MILLISECONDS);
}

// Un texto único para cada cliente, producto o documento. No es un secreto: solo tiene que no repetirse.
export function make_id() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(12);
  try {
    window.crypto.getRandomValues(bytes);
  } catch {
    bytes.forEach((_, index) => (bytes[index] = Math.floor(Math.random() * 256)));
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function now_iso() {
  return new Date().toISOString();
}

// Puntos para los miles, como en Colombia: 1250 → "1.250"
function format_count(count) {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function count_text(count, singular, plural) {
  return `${format_count(count)} ${count === 1 ? singular : plural}`;
}

// Pregunta antes de una acción que no se puede deshacer. Devuelve una promesa que dice si se aceptó. Los botones deciden
// por su cuenta; Escape, que cierra el diálogo sin pasar por ellos, cuenta como cancelar. El foco empieza en Cancelar:
// aceptar sin querer con Enter es lo que no se quiere.
export function ask_confirmation(message, ok_label) {
  const dialog = by_id("confirm_dialog");
  const ok_button = by_id("confirm_ok_button");
  const cancel_button = by_id("confirm_cancel_button");
  return new Promise((resolve) => {
    const listeners = new AbortController();
    const settle = (accepted) => {
      listeners.abort();
      if (dialog.open) dialog.close();
      resolve(accepted);
    };
    by_id("confirm_text").textContent = message;
    ok_button.textContent = ok_label;
    ok_button.addEventListener("click", () => settle(true), { signal: listeners.signal });
    cancel_button.addEventListener("click", () => settle(false), { signal: listeners.signal });
    dialog.addEventListener("close", () => settle(false), { signal: listeners.signal });
    dialog.showModal();
    cancel_button.focus();
  });
}

// Baja un texto como archivo
export function download_file(file_name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file_name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_URL_DELAY_MILLISECONDS);
}

// Lleva el foco a un control y lo deja a la vista
export function focus_field(id) {
  const field = by_id(id);
  if (!field) return;
  field.focus();
  field.scrollIntoView({ block: "center" });
}

// Cierra los menús de tres puntos abiertos que no sean el dado
export function close_menus(except = null) {
  document.querySelectorAll("details.row_menu[open]").forEach((menu) => {
    if (menu !== except) menu.open = false;
  });
}
