// Lista de tareas: funciones puras, sin tocar la pantalla, para probarlas con valores conocidos. Las que dependen de
// "hoy" lo reciben como parámetro (una clave "AAAA-MM-DD" de la fecha local), y las que ponen fechas de creación reciben
// la hora actual como texto ISO.
//
// Las fechas de las tareas son claves "AAAA-MM-DD" sin hora ni zona horaria: una tarea del 15 nunca aparece vencida la
// noche del 14 por culpa de la zona horaria. Por eso nunca pasan por Date.toISOString(); los cálculos con días se hacen en
// UTC con una fecha de mediodía, donde no existen los cambios de hora.

const MAX_TITLE_LENGTH = 200;
const MAX_NOTE_LENGTH = 2000;
const MAX_ID_LENGTH = 64;
const BACKUP_APP = "to_do_list";
const BACKUP_VERSION = 1;
const PRIORITIES = ["high", "normal", "low"];
const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };
const DAY_NAMES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTH_NAMES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

function pad(value, length) {
  return String(value).padStart(length, "0");
}

// "AAAA-MM-DD" de una fecha, con los números locales del equipo
export function today_key(date) {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

// La fecha de una clave a las 12:00 UTC, o null si la clave no existe en el calendario (por ejemplo, 2026-02-30)
function key_to_utc(key) {
  const match = typeof key === "string" ? KEY_PATTERN.exec(key) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const is_real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return is_real ? date : null;
}

function is_valid_key(key) {
  return key_to_utc(key) !== null;
}

function utc_to_key(date) {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

export function add_days(key, days) {
  return utc_to_key(new Date(key_to_utc(key).getTime() + days * MILLISECONDS_PER_DAY));
}

// El domingo de la semana de una fecha (la semana empieza en lunes, como en Colombia)
function end_of_week(key) {
  const weekday = key_to_utc(key).getUTCDay();
  return add_days(key, weekday === 0 ? 0 : 7 - weekday);
}

// "hoy", "mañana", "ayer" o "mié 15 oct" (con ", 2027" si el año no es el de hoy)
export function format_due_date(key, today) {
  const date = key_to_utc(key);
  const difference = Math.round((date.getTime() - key_to_utc(today).getTime()) / MILLISECONDS_PER_DAY);
  if (difference === 0) return "hoy";
  if (difference === 1) return "mañana";
  if (difference === -1) return "ayer";
  const text = `${DAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}`;
  return date.getUTCFullYear() === key_to_utc(today).getUTCFullYear() ? text : `${text}, ${date.getUTCFullYear()}`;
}

// ---------------------------------------------------------------------------
// Grupos y orden
// ---------------------------------------------------------------------------

// A qué grupo va una tarea: "done", "no_date", "overdue", "today", "tomorrow", "this_week" (hasta el domingo) o "later"
function group_of(task, today) {
  if (task.done) return "done";
  if (!task.due_date) return "no_date";
  if (task.due_date < today) return "overdue";
  if (task.due_date === today) return "today";
  if (task.due_date === add_days(today, 1)) return "tomorrow";
  if (task.due_date <= end_of_week(today)) return "this_week";
  return "later";
}

function compare_text(first, second) {
  if (first < second) return -1;
  return first > second ? 1 : 0;
}

// Primero por prioridad (alta, normal, baja), luego por fecha (sin fecha al final) y luego por orden de creación
function sort_tasks(tasks) {
  return [...tasks].sort((first, second) => {
    const by_priority = PRIORITY_ORDER[first.priority] - PRIORITY_ORDER[second.priority];
    if (by_priority !== 0) return by_priority;
    if (first.due_date !== second.due_date) {
      if (!first.due_date) return 1;
      if (!second.due_date) return -1;
      return compare_text(first.due_date, second.due_date);
    }
    return compare_text(first.created_at, second.created_at);
  });
}

// { overdue, today, tomorrow, this_week, later, no_date, done }, cada grupo ya ordenado; las hechas, de la más reciente
export function group_tasks(tasks, today) {
  const groups = { overdue: [], today: [], tomorrow: [], this_week: [], later: [], no_date: [], done: [] };
  sort_tasks(tasks.filter((task) => !task.done)).forEach((task) => groups[group_of(task, today)].push(task));
  groups.done = tasks.filter((task) => task.done).sort((first, second) => compare_text(second.done_at ?? "", first.done_at ?? ""));
  return groups;
}

export function summarize(tasks, today) {
  const pending = tasks.filter((task) => !task.done);
  return {
    pending: pending.length,
    overdue: pending.filter((task) => group_of(task, today) === "overdue").length,
    done: tasks.length - pending.length,
  };
}

// ---------------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------------

// Minúsculas y sin tildes ni diéresis, con los espacios seguidos reducidos a uno. La ñ pierde su tilde: "ano" encuentra
// "año", que es lo que se espera al escribir sin cuidado.
function normalize_text(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function matches(task, query) {
  const normalized_query = normalize_text(query);
  if (normalized_query === "") return true;
  return normalize_text(`${task.title} ${task.note}`).includes(normalized_query);
}

// ---------------------------------------------------------------------------
// Tareas
// ---------------------------------------------------------------------------

// Revisa y limpia los campos que escribe la persona. Devuelve { fields } o { error }.
function validate_fields({ title, note, due_date, priority }) {
  const clean_title = String(title ?? "").trim();
  if (clean_title === "") return { error: "La tarea necesita un título." };
  if (clean_title.length > MAX_TITLE_LENGTH) return { error: `El título es muy largo (máximo ${MAX_TITLE_LENGTH} caracteres).` };
  const clean_note = String(note ?? "").trim();
  if (clean_note.length > MAX_NOTE_LENGTH) return { error: "La nota es muy larga (máximo 2.000 caracteres)." };
  const has_date = due_date !== undefined && due_date !== null && due_date !== "";
  if (has_date && !is_valid_key(due_date)) return { error: "La fecha no es válida." };
  return {
    fields: {
      title: clean_title,
      note: clean_note,
      due_date: has_date ? due_date : null,
      priority: PRIORITIES.includes(priority) ? priority : "normal",
    },
  };
}

// Una tarea nueva. now es la hora actual en texto ISO e id, un texto único. Devuelve { task } o { error }.
export function create_task(fields, now, id) {
  const result = validate_fields(fields);
  if (result.error) return { error: result.error };
  return { task: { id, ...result.fields, done: false, created_at: now, done_at: null } };
}

// La tarea con los cambios dados (title, note, due_date, priority y/o done). Marcarla hecha pone done_at; desmarcarla lo quita.
export function update_task(task, changes, now) {
  const result = validate_fields({ ...task, ...changes });
  if (result.error) return { error: result.error };
  const done = typeof changes.done === "boolean" ? changes.done : task.done;
  let done_at = task.done_at;
  if (done && !task.done) done_at = now;
  if (!done) done_at = null;
  return { task: { ...task, ...result.fields, done, done_at } };
}

function is_iso_date(value) {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

// Convierte cualquier cosa (lo guardado en localStorage o lo que trae un archivo) en una tarea válida, o null si no se
// puede salvar. Lo dañado se arregla campo por campo donde se puede: una fecha mala queda sin fecha, una prioridad mala
// queda normal.
export function sanitize_task(value, now) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.id !== "string" || value.id === "" || value.id.length > MAX_ID_LENGTH) return null;
  if (typeof value.title !== "string") return null;
  const title = value.title.trim();
  if (title === "" || title.length > MAX_TITLE_LENGTH) return null;
  const done = value.done === true;
  const created_at = is_iso_date(value.created_at) ? value.created_at : now;
  return {
    id: value.id,
    title,
    note: typeof value.note === "string" ? value.note.trim().slice(0, MAX_NOTE_LENGTH) : "",
    due_date: is_valid_key(value.due_date) ? value.due_date : null,
    priority: PRIORITIES.includes(value.priority) ? value.priority : "normal",
    done,
    created_at,
    done_at: done ? (is_iso_date(value.done_at) ? value.done_at : created_at) : null,
  };
}

// ---------------------------------------------------------------------------
// Respaldo
// ---------------------------------------------------------------------------

export function export_backup(tasks, exported_at) {
  return JSON.stringify({ app: BACKUP_APP, version: BACKUP_VERSION, exported_at, tasks }, null, 2);
}

// Lee un archivo de respaldo. Devuelve { tasks } o { error } con el motivo en palabras.
export function parse_backup(text, now) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "Este archivo no es un JSON válido." };
  }
  if (!data || typeof data !== "object" || data.app !== BACKUP_APP) return { error: "Este archivo no es un respaldo de la lista de tareas." };
  if (data.version !== BACKUP_VERSION) return { error: "Este respaldo es de otra versión de la página." };
  const tasks = Array.isArray(data.tasks) ? data.tasks.map((task) => sanitize_task(task, now)).filter(Boolean) : [];
  if (tasks.length === 0) return { error: "El respaldo no trae ninguna tarea válida." };
  return { tasks };
}

// Las tareas importadas reemplazan a las que tienen el mismo id y se agregan las demás (si el archivo repite un id, vale la última)
export function merge_tasks(current, imported) {
  const imported_by_id = new Map(imported.map((task) => [task.id, task]));
  const current_ids = new Set(current.map((task) => task.id));
  const merged = current.map((task) => imported_by_id.get(task.id) ?? task);
  const added = [...imported_by_id.values()].filter((task) => !current_ids.has(task.id));
  return { tasks: [...merged, ...added], added: added.length, replaced: imported_by_id.size - added.length };
}
