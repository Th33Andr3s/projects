// Los datos de la página y su guardado en el navegador. Todo vive en una sola clave de localStorage,
// `quotes_and_bills_data`, y se guarda 300 ms después del último cambio. Si el navegador no deja guardar (almacenamiento
// bloqueado o lleno), se avisa con una franja y se ofrece Exportar: nada se pierde en silencio.
import { empty_data, sanitize_data } from "./document_model.js";

const STORAGE_KEY = "quotes_and_bills_data";
const SAVE_DELAY_MILLISECONDS = 300;

export const state = { data: empty_data() };

let save_timer = 0;
let save_failure_listener = () => {};

// Quién se entera cuando no se puede guardar (la pantalla muestra la franja de aviso)
export function on_save_failure(listener) {
  save_failure_listener = listener;
}

// Lee lo guardado. Devuelve true si es la primera vez (no había nada guardado). Lo dañado se limpia campo por campo.
export function load_data() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Sin almacenamiento se empieza con datos vacíos; la franja de aviso sale al primer intento de guardar.
  }
  let parsed = null;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    parsed = null;
  }
  state.data = sanitize_data(parsed, new Date().toISOString(), true).data;
  return raw === null;
}

export function save_now() {
  clearTimeout(save_timer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
    return true;
  } catch {
    save_failure_listener();
    return false;
  }
}

// Guarda en un momento: así, mientras se escribe, no se guarda con cada tecla
export function save_soon() {
  clearTimeout(save_timer);
  save_timer = setTimeout(save_now, SAVE_DELAY_MILLISECONDS);
}

export function replace_data(data) {
  state.data = data;
  save_now();
}
