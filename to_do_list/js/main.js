// Lista de tareas: agregar, tareas agrupadas por cuándo tocan, marcar hechas, editar, borrar con Deshacer, buscar, filtrar,
// respaldo en JSON y guardado en el navegador. Las reglas (fechas, grupos, orden, validación, respaldo) viven en task_tools.js.
import { start_scene, flash_scene } from "./animations.js";
import { add_days, create_task, export_backup, format_due_date, group_tasks, matches, merge_tasks, parse_backup, sanitize_task, summarize, today_key, update_task } from "./task_tools.js";

const TASKS_KEY = "to_do_list_tasks";
const VIEW_KEY = "to_do_list_view";
const FILTERS = ["pending", "done", "all"];
const GROUP_ORDER = ["overdue", "today", "tomorrow", "this_week", "later", "no_date"];
const GROUP_TITLES = { overdue: "Vencidas", today: "Hoy", tomorrow: "Mañana", this_week: "Esta semana", later: "Más adelante", no_date: "Sin fecha" };
const UNDO_MILLISECONDS = 6000;
const FADE_MILLISECONDS = 250;
const DAY_CHECK_MILLISECONDS = 60000;
const ANNOUNCE_DELAY_MILLISECONDS = 50;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
// Se espera un momento antes de soltar el archivo temporal, para que el navegador alcance a descargarlo
const REVOKE_URL_DELAY_MILLISECONDS = 1000;
const BACKUP_FILE_NAME = "tareas.json";

const dom = {
  summary: document.getElementById("summary"),
  search_input: document.getElementById("search_input"),
  filter_select: document.getElementById("filter_select"),
  add_form: document.getElementById("add_form"),
  title_input: document.getElementById("title_input"),
  add_warning: document.getElementById("add_warning"),
  more_button: document.getElementById("more_button"),
  more_options: document.getElementById("more_options"),
  due_input: document.getElementById("due_input"),
  due_today_button: document.getElementById("due_today_button"),
  due_tomorrow_button: document.getElementById("due_tomorrow_button"),
  due_clear_button: document.getElementById("due_clear_button"),
  note_input: document.getElementById("note_input"),
  task_groups: document.getElementById("task_groups"),
  empty_message: document.getElementById("empty_message"),
  done_section: document.getElementById("done_section"),
  done_summary: document.getElementById("done_summary"),
  done_list: document.getElementById("done_list"),
  clear_done_button: document.getElementById("clear_done_button"),
  export_button: document.getElementById("export_button"),
  import_button: document.getElementById("import_button"),
  import_file: document.getElementById("import_file"),
  backup_message: document.getElementById("backup_message"),
  storage_notice: document.getElementById("storage_notice"),
  live_status: document.getElementById("live_status"),
  undo_bar: document.getElementById("undo_bar"),
  undo_text: document.getElementById("undo_text"),
  undo_button: document.getElementById("undo_button"),
  edit_dialog: document.getElementById("edit_dialog"),
  edit_form: document.getElementById("edit_form"),
  edit_title_input: document.getElementById("edit_title_input"),
  edit_due_input: document.getElementById("edit_due_input"),
  edit_due_today_button: document.getElementById("edit_due_today_button"),
  edit_due_tomorrow_button: document.getElementById("edit_due_tomorrow_button"),
  edit_due_clear_button: document.getElementById("edit_due_clear_button"),
  edit_note_input: document.getElementById("edit_note_input"),
  edit_warning: document.getElementById("edit_warning"),
  edit_cancel_button: document.getElementById("edit_cancel_button"),
  edit_delete_button: document.getElementById("edit_delete_button"),
  confirm_dialog: document.getElementById("confirm_dialog"),
  confirm_text: document.getElementById("confirm_text"),
  confirm_ok_button: document.getElementById("confirm_ok_button"),
  confirm_cancel_button: document.getElementById("confirm_cancel_button"),
};

let tasks = [];
let filter = "pending";
let query = "";
// El día que se dibujó por última vez: si la página queda abierta de un día para otro, la lista se redibuja sola
let rendered_day = "";
// La tarea que se está editando, y a cuál volver al cerrar el diálogo
let editing_id = null;
// Lo último que se borró y el temporizador del aviso de deshacer
let undo_tasks = [];
let undo_timer = 0;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function now_iso() {
  return new Date().toISOString();
}

// Un texto único para cada tarea. No es un secreto: solo tiene que no repetirse.
function make_id() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(12);
  try {
    window.crypto.getRandomValues(bytes);
  } catch {
    bytes.forEach((_, index) => (bytes[index] = Math.floor(Math.random() * 256)));
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Puntos para los miles, como en Colombia: 1250 → "1.250". Se arma a mano para no depender del idioma del navegador.
function count_text(count, singular, plural) {
  return `${String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} ${count === 1 ? singular : plural}`;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Lo que se avisa a lectores de pantalla, con un momento de pausa para que se vuelva a leer aunque el texto sea igual
// al anterior
function announce(message) {
  dom.live_status.textContent = "";
  setTimeout(() => (dom.live_status.textContent = message), ANNOUNCE_DELAY_MILLISECONDS);
}

function make_element(tag, class_name, text) {
  const element = document.createElement(tag);
  if (class_name) element.className = class_name;
  if (text !== undefined) element.textContent = text;
  return element;
}

function prefers_reduced_motion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function find_task(id) {
  return tasks.find((task) => task.id === id);
}

function get_priority(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function set_priority(name, value) {
  document.querySelector(`input[name="${name}"][value="${value}"]`).checked = true;
}

// ---------------------------------------------------------------------------
// Guardado
// ---------------------------------------------------------------------------

function load_tasks() {
  try {
    const stored = JSON.parse(localStorage.getItem(TASKS_KEY));
    const now = now_iso();
    return Array.isArray(stored) ? stored.map((item) => sanitize_task(item, now)).filter(Boolean) : [];
  } catch {
    // Sin almacenamiento, o con datos dañados, se empieza con la lista vacía.
    return [];
  }
}

// El almacenamiento puede fallar (modo privado, bloqueado): la página funciona igual mientras esté abierta, y avisa una vez.
function save_tasks() {
  try {
    localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  } catch {
    dom.storage_notice.hidden = false;
  }
}

function load_view() {
  const view = { filter: "pending", more_open: false };
  try {
    const stored = JSON.parse(localStorage.getItem(VIEW_KEY));
    if (FILTERS.includes(stored?.filter)) view.filter = stored.filter;
    if (stored?.more_open === true) view.more_open = true;
  } catch {
    // Sin almacenamiento, o con datos dañados, se usan los valores iniciales.
  }
  return view;
}

function save_view() {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ filter, more_open: !dom.more_options.hidden }));
  } catch {
    // Las opciones de pantalla no son importantes: sin almacenamiento simplemente no se recuerdan.
  }
}

// ---------------------------------------------------------------------------
// Dibujo de la lista
// ---------------------------------------------------------------------------

function render_summary(stats) {
  dom.summary.replaceChildren();
  dom.summary.classList.remove("is_clear");
  if (tasks.length === 0) {
    dom.summary.textContent = "Sin tareas";
  } else if (stats.pending === 0) {
    dom.summary.textContent = "Nada pendiente";
    dom.summary.classList.add("is_clear");
  } else {
    dom.summary.append(document.createTextNode(count_text(stats.pending, "pendiente", "pendientes")));
    if (stats.overdue > 0) {
      dom.summary.append(document.createTextNode(" · "), make_element("span", "overdue_count", count_text(stats.overdue, "vencida", "vencidas")));
    }
  }
}

// La fecha en que se hizo una tarea: "hecha hoy", "hecha ayer", "hecha el mar 13 oct"
function done_text(task, today) {
  const text = format_due_date(today_key(new Date(task.done_at ?? task.created_at)), today);
  return text === "hoy" || text === "ayer" ? `hecha ${text}` : `hecha el ${text}`;
}

function make_meta(task, today) {
  const meta = make_element("p", "task_meta");
  if (task.done) {
    meta.append(make_element("span", "", done_text(task, today)));
  } else {
    if (task.due_date) {
      const is_overdue = task.due_date < today;
      const text = format_due_date(task.due_date, today);
      meta.append(make_element("span", is_overdue ? "is_overdue" : "", is_overdue ? `Vencida · ${text}` : capitalize(text)));
    }
    if (task.priority === "high") meta.append(make_element("span", "is_high", "Prioridad alta"));
    if (task.priority === "low") meta.append(make_element("span", "", "Prioridad baja"));
  }
  if (task.note) meta.append(make_element("span", "task_note", task.note.replace(/\s+/g, " ")));
  return meta;
}

function make_task_item(task, today) {
  const item = make_element("li", task.done ? "task is_done" : "task");
  item.dataset.id = task.id;

  const check = make_element("label", "check");
  const checkbox = make_element("input", "");
  checkbox.type = "checkbox";
  checkbox.checked = task.done;
  checkbox.setAttribute("aria-label", `${task.done ? "Marcar como pendiente" : "Marcar como hecha"}: ${task.title}`);
  checkbox.addEventListener("change", () => toggle_done(task.id, checkbox.checked, item, checkbox));
  check.append(checkbox);

  const body = make_element("div", "task_body");
  const title = make_element("button", "task_title", task.title);
  title.type = "button";
  title.addEventListener("click", () => open_edit(task.id));
  body.append(title);
  if (task.done || task.due_date || task.priority !== "normal" || task.note) body.append(make_meta(task, today));

  const edit = make_element("button", "icon_button");
  edit.type = "button";
  edit.setAttribute("aria-label", `Editar: ${task.title}`);
  edit.append(make_element("i", "fa-solid fa-pen"));
  edit.firstChild.setAttribute("aria-hidden", "true");
  edit.addEventListener("click", () => open_edit(task.id));

  const remove = make_element("button", "icon_button");
  remove.type = "button";
  remove.setAttribute("aria-label", `Borrar: ${task.title}`);
  remove.append(make_element("i", "fa-regular fa-trash-can"));
  remove.firstChild.setAttribute("aria-hidden", "true");
  remove.addEventListener("click", () => delete_tasks([task.id], "Tarea borrada"));

  item.append(check, body, edit, remove);
  return item;
}

function make_group(key, group_tasks_list, today) {
  const section = make_element("section", "group");
  const title = make_element("h2", key === "overdue" ? "group_title is_overdue" : "group_title", `${GROUP_TITLES[key]} · ${group_tasks_list.length}`);
  const list = make_element("ul", "task_list");
  group_tasks_list.forEach((task) => list.append(make_task_item(task, today)));
  section.append(title, list);
  return section;
}

// Qué decir cuando no hay nada que mostrar
function empty_text(pending_count, done_count) {
  if (tasks.length === 0) return "Todavía no hay tareas. Escribe la primera arriba.";
  if (pending_count > 0 || done_count > 0) return "";
  if (query.trim() !== "") return `Nada coincide con «${query.trim()}».`;
  return filter === "done" ? "Todavía no hay tareas hechas." : "No hay tareas pendientes.";
}

// Dibuja todo con lo que hay: es una lista personal, así que redibujarla entera en cada cambio es barato
function render() {
  const today = today_key(new Date());
  rendered_day = today;
  const groups = group_tasks(tasks.filter((task) => matches(task, query)), today);
  render_summary(summarize(tasks, today));

  const show_pending = filter !== "done";
  const fragment = document.createDocumentFragment();
  let pending_count = 0;
  if (show_pending) {
    GROUP_ORDER.forEach((key) => {
      if (groups[key].length === 0) return;
      pending_count += groups[key].length;
      fragment.append(make_group(key, groups[key], today));
    });
  }
  dom.task_groups.replaceChildren(fragment);

  dom.done_list.replaceChildren(...groups.done.map((task) => make_task_item(task, today)));
  dom.done_summary.textContent = `Hechas · ${groups.done.length}`;
  dom.done_section.hidden = groups.done.length === 0;

  const message = empty_text(pending_count, groups.done.length);
  dom.empty_message.textContent = message;
  dom.empty_message.hidden = message === "";
  dom.export_button.disabled = tasks.length === 0;
}

// Si la página queda abierta de un día para otro, o se vuelve a ella después de un rato, lo "de hoy" puede haber cambiado
function check_day() {
  if (today_key(new Date()) !== rendered_day) render();
}

// ---------------------------------------------------------------------------
// Agregar
// ---------------------------------------------------------------------------

function set_more_open(is_open) {
  dom.more_options.hidden = !is_open;
  dom.more_button.setAttribute("aria-expanded", String(is_open));
}

function show_add_warning(message) {
  dom.add_warning.textContent = message;
  dom.add_warning.hidden = false;
}

function handle_add(event) {
  event.preventDefault();
  const result = create_task({ title: dom.title_input.value, note: dom.note_input.value, due_date: dom.due_input.value, priority: get_priority("priority") }, now_iso(), make_id());
  if (result.error) {
    show_add_warning(result.error);
    dom.title_input.focus();
    return;
  }
  dom.add_warning.hidden = true;
  tasks = [...tasks, result.task];
  save_tasks();
  // Para que la tarea nueva se vea, se quita lo que la esconda: el filtro de hechas o una búsqueda que no la encuentra
  if (filter === "done") {
    set_filter("pending");
    save_view();
  }
  if (!matches(result.task, query)) {
    query = "";
    dom.search_input.value = "";
  }
  dom.title_input.value = "";
  dom.note_input.value = "";
  dom.due_input.value = "";
  set_priority("priority", "normal");
  dom.backup_message.hidden = true;
  render();
  announce(`Tarea agregada: ${result.task.title}.`);
  dom.title_input.focus();
}

// ---------------------------------------------------------------------------
// Marcar, borrar y deshacer
// ---------------------------------------------------------------------------

// A qué tarea pasa el foco cuando una desaparece de la pantalla: la siguiente, o la anterior
function neighbor_id(id) {
  const ids = [...document.querySelectorAll(".task")].map((item) => item.dataset.id);
  const index = ids.indexOf(id);
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

function focus_task(id, selector) {
  const target = id ? document.querySelector(`.task[data-id="${CSS.escape(id)}"] ${selector}`) : null;
  if (!target) return false;
  target.focus();
  // Un elemento dentro de las hechas plegadas existe pero no recibe el foco: en ese caso no cuenta como logrado
  return document.activeElement === target;
}

function toggle_done(id, done, item, checkbox) {
  const fallback_id = neighbor_id(id);
  const apply = () => {
    const task = find_task(id);
    if (!task) return;
    const result = update_task(task, { done }, now_iso());
    tasks = tasks.map((existing) => (existing.id === id ? result.task : existing));
    save_tasks();
    render();
    announce(done ? `Tarea hecha: ${task.title}.` : `Tarea pendiente otra vez: ${task.title}.`);
    // Si la tarea cambió de sección, el foco pasa a la que quedó en su lugar
    if (!focus_task(id, ".check input") && !focus_task(fallback_id, ".task_title")) dom.title_input.focus();
  };
  if (done) flash_scene();
  if (prefers_reduced_motion()) {
    apply();
    return;
  }
  // Una transición breve antes de que la tarea cambie de sitio
  checkbox.disabled = true;
  item.classList.add("is_fading");
  setTimeout(apply, FADE_MILLISECONDS);
}

function hide_undo() {
  clearTimeout(undo_timer);
  dom.undo_bar.hidden = true;
  undo_tasks = [];
}

function show_undo(message, removed) {
  clearTimeout(undo_timer);
  undo_tasks = removed;
  dom.undo_text.textContent = message;
  dom.undo_bar.hidden = false;
  undo_timer = setTimeout(hide_undo, UNDO_MILLISECONDS);
}

function delete_tasks(ids, message) {
  const removed = tasks.filter((task) => ids.includes(task.id));
  if (removed.length === 0) return;
  const next_id = ids.length === 1 ? neighbor_id(ids[0]) : null;
  tasks = tasks.filter((task) => !ids.includes(task.id));
  save_tasks();
  render();
  show_undo(message, removed);
  announce(`${message}. Deshacer disponible durante unos segundos.`);
  if (!focus_task(next_id, ".task_title")) dom.title_input.focus();
}

function handle_undo() {
  const restored = undo_tasks;
  if (restored.length === 0) return;
  const existing_ids = new Set(tasks.map((task) => task.id));
  tasks = [...tasks, ...restored.filter((task) => !existing_ids.has(task.id))];
  save_tasks();
  hide_undo();
  render();
  announce(restored.length === 1 ? "Tarea restaurada." : `${count_text(restored.length, "tarea restaurada", "tareas restauradas")}.`);
  if (!(restored.length === 1 && focus_task(restored[0].id, ".task_title"))) dom.title_input.focus();
}

// Pregunta antes de una acción que cambia muchas tareas de una vez. Devuelve una promesa que dice si se aceptó. Los botones
// deciden por su cuenta (sin esperar al evento "close" del diálogo); Escape, que cierra el diálogo sin pasar por ellos,
// cuenta como cancelar.
function ask_confirmation(message, ok_label) {
  return new Promise((resolve) => {
    const listeners = new AbortController();
    const settle = (accepted) => {
      listeners.abort();
      if (dom.confirm_dialog.open) dom.confirm_dialog.close();
      resolve(accepted);
    };
    dom.confirm_text.textContent = message;
    dom.confirm_ok_button.textContent = ok_label;
    dom.confirm_ok_button.addEventListener("click", () => settle(true), { signal: listeners.signal });
    dom.confirm_cancel_button.addEventListener("click", () => settle(false), { signal: listeners.signal });
    dom.confirm_dialog.addEventListener("close", () => settle(false), { signal: listeners.signal });
    dom.confirm_dialog.showModal();
    // El foco empieza en Cancelar: aceptar sin querer con Enter es lo que no se quiere
    dom.confirm_cancel_button.focus();
  });
}

async function handle_clear_done() {
  const done_ids = group_tasks(tasks.filter((task) => matches(task, query)), today_key(new Date())).done.map((task) => task.id);
  if (done_ids.length === 0) return;
  const accepted = await ask_confirmation(`¿Borrar ${count_text(done_ids.length, "tarea hecha", "tareas hechas")}? Podrás deshacerlo unos segundos.`, "Borrar");
  if (accepted) delete_tasks(done_ids, done_ids.length === 1 ? "Tarea borrada" : `${count_text(done_ids.length, "tarea borrada", "tareas borradas")}`);
  else dom.clear_done_button.focus();
}

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------

function open_edit(id) {
  const task = find_task(id);
  if (!task) return;
  editing_id = id;
  dom.edit_title_input.value = task.title;
  dom.edit_due_input.value = task.due_date ?? "";
  set_priority("edit_priority", task.priority);
  dom.edit_note_input.value = task.note;
  dom.edit_warning.hidden = true;
  dom.edit_dialog.showModal();
  dom.edit_title_input.focus();
  dom.edit_title_input.select();
}

// Cierra el diálogo y devuelve la tarea que se editaba. Se vacía editing_id antes de cerrar para que, cuando llegue el
// evento "close", no haya nada que hacer: el foco lo decide quien cerró.
function close_edit_dialog() {
  const id = editing_id;
  editing_id = null;
  dom.edit_dialog.close();
  return id;
}

// El foco vuelve a la tarea que se editaba, o al cuadro de agregar si ya no está
function return_focus(id) {
  if (!focus_task(id, ".task_title")) dom.title_input.focus();
}

function handle_edit_submit(event) {
  event.preventDefault();
  const task = find_task(editing_id);
  if (!task) {
    close_edit_dialog();
    return;
  }
  const result = update_task(task, { title: dom.edit_title_input.value, note: dom.edit_note_input.value, due_date: dom.edit_due_input.value, priority: get_priority("edit_priority") }, now_iso());
  if (result.error) {
    dom.edit_warning.textContent = result.error;
    dom.edit_warning.hidden = false;
    dom.edit_title_input.focus();
    return;
  }
  tasks = tasks.map((existing) => (existing.id === editing_id ? result.task : existing));
  save_tasks();
  const id = close_edit_dialog();
  render();
  return_focus(id);
  announce(`Tarea guardada: ${result.task.title}.`);
}

function handle_edit_cancel() {
  return_focus(close_edit_dialog());
}

// Escape cierra el diálogo por su cuenta: el foco vuelve igual que al cancelar
function handle_edit_closed() {
  if (editing_id === null) return;
  const id = editing_id;
  editing_id = null;
  return_focus(id);
}

function handle_edit_delete() {
  delete_tasks([close_edit_dialog()], "Tarea borrada");
}

// ---------------------------------------------------------------------------
// Buscar y filtrar
// ---------------------------------------------------------------------------

// Cambia el filtro: con "Pendientes" las hechas quedan plegadas; con "Hechas" y "Todas", abiertas
function set_filter(value) {
  filter = value;
  dom.filter_select.value = value;
  dom.done_section.open = value !== "pending";
}

// ---------------------------------------------------------------------------
// Respaldo
// ---------------------------------------------------------------------------

function show_backup_message(message, is_error) {
  dom.backup_message.textContent = message;
  dom.backup_message.classList.toggle("is_error", is_error);
  dom.backup_message.hidden = false;
}

function handle_export() {
  const url = URL.createObjectURL(new Blob([export_backup(tasks, now_iso())], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = BACKUP_FILE_NAME;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_URL_DELAY_MILLISECONDS);
  announce(`Descargado como ${BACKUP_FILE_NAME}.`);
}

async function handle_import() {
  const file = dom.import_file.files[0];
  // Se vacía el campo para poder abrir el mismo archivo otra vez
  dom.import_file.value = "";
  if (!file) return;
  dom.backup_message.hidden = true;
  if (file.size > MAX_IMPORT_BYTES) {
    show_backup_message("Este archivo es demasiado grande para ser un respaldo de la lista de tareas.", true);
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
  const merged = merge_tasks(tasks, parsed.tasks);
  const replaced_text = merged.replaced > 0 ? ` (${count_text(merged.replaced, "reemplaza", "reemplazan")} a una que ya está)` : "";
  const accepted = await ask_confirmation(`El archivo trae ${count_text(parsed.tasks.length, "tarea", "tareas")}${replaced_text}. ¿Importar?`, "Importar");
  if (!accepted) {
    dom.import_button.focus();
    return;
  }
  tasks = merged.tasks;
  save_tasks();
  render();
  show_backup_message(`${count_text(parsed.tasks.length, "tarea importada", "tareas importadas")}.`, false);
  announce(`${count_text(parsed.tasks.length, "tarea importada", "tareas importadas")}.`);
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

// Botones Hoy, Mañana y Quitar de un campo de fecha
function setup_date_buttons(input, today_button, tomorrow_button, clear_button) {
  today_button.addEventListener("click", () => (input.value = today_key(new Date())));
  tomorrow_button.addEventListener("click", () => (input.value = add_days(today_key(new Date()), 1)));
  clear_button.addEventListener("click", () => (input.value = ""));
}

function setup_events() {
  dom.add_form.addEventListener("submit", handle_add);
  dom.title_input.addEventListener("input", () => (dom.add_warning.hidden = true));
  dom.more_button.addEventListener("click", () => {
    set_more_open(dom.more_options.hidden);
    save_view();
  });
  setup_date_buttons(dom.due_input, dom.due_today_button, dom.due_tomorrow_button, dom.due_clear_button);
  setup_date_buttons(dom.edit_due_input, dom.edit_due_today_button, dom.edit_due_tomorrow_button, dom.edit_due_clear_button);

  dom.search_input.addEventListener("input", () => {
    query = dom.search_input.value;
    render();
  });
  dom.filter_select.addEventListener("change", () => {
    set_filter(dom.filter_select.value);
    save_view();
    render();
  });
  dom.clear_done_button.addEventListener("click", handle_clear_done);
  dom.undo_button.addEventListener("click", handle_undo);

  dom.edit_form.addEventListener("submit", handle_edit_submit);
  dom.edit_cancel_button.addEventListener("click", handle_edit_cancel);
  dom.edit_delete_button.addEventListener("click", handle_edit_delete);
  dom.edit_dialog.addEventListener("close", handle_edit_closed);

  dom.export_button.addEventListener("click", handle_export);
  dom.import_button.addEventListener("click", () => dom.import_file.click());
  dom.import_file.addEventListener("change", handle_import);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) check_day();
  });
  setInterval(() => {
    if (!document.hidden) check_day();
  }, DAY_CHECK_MILLISECONDS);
}

const saved_view = load_view();
tasks = load_tasks();
setup_events();
set_more_open(saved_view.more_open);
set_filter(saved_view.filter);
render();
// El fondo es decorativo: se prepara sin esperar y la lista ya funciona mientras carga.
start_scene(document.getElementById("scene_canvas"));
