// Eventos del calendario: forma de un evento, validación, repeticiones y guardado en localStorage. Son funciones que
// no tocan la pantalla, para poder probarlas con valores conocidos (ver PLAN.md, sección 4.4).
//
// Un evento es { id, title, date, all_day, start, end, color, repeat, notes }:
// - date es la fecha del primer día, como texto AAAA-MM-DD (ver dates.js).
// - start y end son "HH:MM", o "" cuando el evento dura todo el día (end también puede ir vacío con start).
// - repeat es "none", "weekly", "monthly" o "yearly". Un evento repetido se guarda una sola vez: sus apariciones
//   se calculan al dibujar, no se guardan copias.

import { add_days, days_between, parse_iso, parse_time } from "./dates.js";

const STORAGE_KEY = "calendar_events";
const DAYS_PER_WEEK = 7;
// Posiciones del mes y del día dentro de un texto AAAA-MM-DD
const DAY_START = 8;
const MONTH_DAY_START = 5;

const COLORS = ["red", "orange", "green", "teal", "purple", "pink"];
export const DEFAULT_COLOR = "green";
const REPEATS = ["none", "weekly", "monthly", "yearly"];
export const REPEAT_DESCRIPTIONS = {
  weekly: "Se repite cada semana",
  monthly: "Se repite cada mes",
  yearly: "Se repite cada año",
};

const MAX_TITLE_LENGTH = 80;
const MAX_NOTES_LENGTH = 500;
export const MAX_EVENTS = 5000;
const MAX_ID_LENGTH = 64;
// Años que acepta el calendario, los mismos que limitan el selector de fecha del diálogo
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2200;

// ---------------------------------------------------------------------------
// Forma y validación
// ---------------------------------------------------------------------------

export function create_id() {
  try {
    return crypto.randomUUID();
  } catch {
    // crypto.randomUUID solo existe en páginas seguras (https o localhost)
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

function is_valid_date(text) {
  const parsed = typeof text === "string" ? parse_iso(text) : null;
  return Boolean(parsed) && parsed.year >= MIN_YEAR && parsed.year <= MAX_YEAR;
}

// Revisa lo que escribió la persona en el diálogo. Devuelve un mensaje por cada campo con problema:
// { title, date, times }. Sin mensajes, todo sirve.
export function validate_event_fields({ title, date, all_day, start, end }) {
  const errors = {};
  if (!title.trim()) errors.title = "Escribe un título.";
  if (!is_valid_date(date)) errors.date = "Elige una fecha.";
  if (!all_day) {
    if (!parse_time(start)) errors.times = "Escribe la hora de inicio.";
    else if (end && (!parse_time(end) || end <= start)) errors.times = "La hora de fin debe ser posterior a la de inicio.";
  }
  return errors;
}

// Deja un evento con la forma exacta que espera el resto del programa, o devuelve null si no sirve (sin título o
// sin fecha real). Se usa con lo guardado y con lo que traiga un archivo importado: lo dañado se descarta y los
// campos opcionales con valores raros se arreglan en vez de perder el evento.
export function sanitize_event(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = typeof raw.title === "string" ? raw.title.trim().slice(0, MAX_TITLE_LENGTH) : "";
  if (!title || !is_valid_date(raw.date)) return null;

  const has_start = raw.all_day === false && parse_time(raw.start);
  const start = has_start ? raw.start : "";
  const end = has_start && parse_time(raw.end) && raw.end > start ? raw.end : "";
  const has_valid_id = typeof raw.id === "string" && raw.id.length > 0 && raw.id.length <= MAX_ID_LENGTH;
  return {
    id: has_valid_id ? raw.id : create_id(),
    title,
    date: raw.date,
    all_day: !has_start,
    start,
    end,
    color: COLORS.includes(raw.color) ? raw.color : DEFAULT_COLOR,
    repeat: REPEATS.includes(raw.repeat) ? raw.repeat : "none",
    notes: typeof raw.notes === "string" ? raw.notes.trim().slice(0, MAX_NOTES_LENGTH) : "",
  };
}

// ---------------------------------------------------------------------------
// Repeticiones
// ---------------------------------------------------------------------------

// ¿Aparece el evento en este día? Cada mes: el mismo día del mes, así un día 31 no aparece en los meses de 30. Cada
// año: la misma fecha, así un 29 de febrero solo aparece en años bisiestos. Nunca aparece antes de su fecha.
function occurs_on(event, iso) {
  if (iso < event.date) return false;
  switch (event.repeat) {
    case "weekly":
      return days_between(event.date, iso) % DAYS_PER_WEEK === 0;
    case "monthly":
      return iso.slice(DAY_START) === event.date.slice(DAY_START);
    case "yearly":
      return iso.slice(MONTH_DAY_START) === event.date.slice(MONTH_DAY_START);
    default:
      return iso === event.date;
  }
}

// Todo-el-día primero, luego por hora de inicio y por título
function compare_in_day(first, second) {
  if (first.start !== second.start) return first.start < second.start ? -1 : 1;
  return first.title.localeCompare(second.title, "es");
}

// Los eventos de cada día entre dos fechas (ambas incluidas): { "AAAA-MM-DD": [eventos en orden] }. Solo trae los
// días que tienen algo.
export function group_by_day(events, from_iso, to_iso) {
  const days = {};
  for (let iso = from_iso; iso <= to_iso; iso = add_days(iso, 1)) {
    const on_day = events.filter((event) => occurs_on(event, iso));
    if (on_day.length) days[iso] = on_day.sort(compare_in_day);
  }
  return days;
}

// ---------------------------------------------------------------------------
// Guardado
// ---------------------------------------------------------------------------

// Devuelve { events, can_save }. Con el almacenamiento bloqueado o con datos dañados la lista queda vacía; solo en
// el primer caso se avisa que no se podrá guardar.
export function load_events() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const events = Array.isArray(stored) ? stored.map(sanitize_event).filter(Boolean).slice(0, MAX_EVENTS) : [];
    return { events, can_save: true };
  } catch (error) {
    // Un JSON dañado se puede reemplazar al guardar; un almacenamiento bloqueado, no.
    return { events: [], can_save: error instanceof SyntaxError };
  }
}

// Devuelve false si el navegador no dejó guardar (modo privado, almacenamiento lleno o bloqueado)
export function save_events(events) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Respaldo en un archivo JSON
// ---------------------------------------------------------------------------

const BACKUP_APP = "calendar";
const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const NOT_A_BACKUP_MESSAGE = "Este archivo no es un respaldo del calendario.";

// El texto del archivo que se descarga: { "app": "calendar", "version": 1, "events": [...] }
export function build_backup(events) {
  return JSON.stringify({ app: BACKUP_APP, version: BACKUP_VERSION, events }, null, 2);
}

// Lee el texto de un archivo de respaldo. Devuelve { error } si no sirve, o { events, discarded }: los eventos válidos
// y cuántos del archivo no servían y se dejaron fuera. Si un identificador se repite dentro del archivo, queda el último.
export function parse_backup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: NOT_A_BACKUP_MESSAGE };
  }
  if (!data || typeof data !== "object" || data.app !== BACKUP_APP || !Array.isArray(data.events)) return { error: NOT_A_BACKUP_MESSAGE };
  if (data.version !== BACKUP_VERSION) return { error: "Este respaldo es de otra versión del calendario y no se puede importar." };

  const valid = data.events.map(sanitize_event).filter(Boolean);
  const unique = [...new Map(valid.map((event) => [event.id, event])).values()];
  return { events: unique, discarded: data.events.length - valid.length };
}

// Junta los eventos del archivo con los que ya hay: uno con el mismo id reemplaza al que estaba.
// Devuelve { events, replaced }, con replaced = cuántos reemplazaron a uno existente.
export function merge_events(existing, incoming) {
  const merged = new Map(existing.map((event) => [event.id, event]));
  const replaced = incoming.filter((event) => merged.has(event.id)).length;
  incoming.forEach((event) => merged.set(event.id, event));
  return { events: [...merged.values()], replaced };
}
