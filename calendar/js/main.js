// Calendario: pestañas, cuadrícula del mes navegable con dedo y teclado, detalle del día, lista de próximos y el
// diálogo para agregar, editar y borrar eventos. Las reglas de fechas y los festivos de Colombia viven en dates.js, y
// la forma de los eventos, sus repeticiones y su guardado en events.js.
import {
  add_days,
  build_month_grid,
  describe_day,
  format_long_date,
  format_month_title,
  format_time_range,
  get_holiday_name,
  get_holidays_between,
  get_weekday_headers,
  parse_iso,
  shift_month,
  today_iso,
  weekday_position,
} from "./dates.js";
import { start_scene, flash_scene } from "./animations.js";
import {
  DEFAULT_COLOR,
  MAX_BACKUP_BYTES,
  MAX_EVENTS,
  MAX_YEAR,
  MIN_YEAR,
  REPEAT_DESCRIPTIONS,
  build_backup,
  create_id,
  group_by_day,
  load_events,
  merge_events,
  parse_backup,
  sanitize_event,
  save_events,
  validate_event_fields,
} from "./events.js";

const STORAGE_KEY = "calendar_view";
const DEFAULT_VIEW = "month";
const UPCOMING_DAYS = 90;
const DAYS_PER_WEEK = 7;
const LAST_WEEKDAY_POSITION = DAYS_PER_WEEK - 1;
const MAX_MARKS_PER_DAY = 3;
const ANNOUNCE_DELAY_MILLISECONDS = 50;
const BACKUP_FILE_NAME = "calendario.json";
// Se espera un momento antes de soltar el archivo temporal, para que el navegador alcance a descargarlo
const REVOKE_URL_DELAY_MILLISECONDS = 1000;

const dom = {
  tabs: [...document.querySelectorAll(".tab")],
  tab_list: document.querySelector(".tabs"),
  storage_warning: document.getElementById("storage_warning"),
  live_status: document.getElementById("live_status"),
  month_title: document.getElementById("month_title"),
  month_prev: document.getElementById("month_prev"),
  month_next: document.getElementById("month_next"),
  month_today: document.getElementById("month_today"),
  grid_head_row: document.querySelector("#month_grid thead tr"),
  grid_body: document.querySelector("#month_grid tbody"),
  day_title: document.getElementById("day_title"),
  day_holiday: document.getElementById("day_holiday"),
  day_holiday_name: document.getElementById("day_holiday_name"),
  day_events: document.getElementById("day_events"),
  day_empty: document.getElementById("day_empty"),
  add_event_button: document.getElementById("add_event_button"),
  upcoming_list: document.getElementById("upcoming_list"),
  upcoming_empty: document.getElementById("upcoming_empty"),
  upcoming_add_button: document.getElementById("upcoming_add_button"),
  // Respaldo
  export_button: document.getElementById("export_button"),
  import_button: document.getElementById("import_button"),
  import_file: document.getElementById("import_file"),
  import_summary: document.getElementById("import_summary"),
  import_summary_text: document.getElementById("import_summary_text"),
  import_confirm: document.getElementById("import_confirm"),
  import_cancel: document.getElementById("import_cancel"),
  // Diálogo del evento
  dialog: document.getElementById("event_dialog"),
  form: document.getElementById("event_form"),
  dialog_title: document.getElementById("dialog_title"),
  title: document.getElementById("event_title"),
  date: document.getElementById("event_date"),
  all_day: document.getElementById("event_all_day"),
  times: document.getElementById("event_times"),
  start: document.getElementById("event_start"),
  end: document.getElementById("event_end"),
  colors: [...document.querySelectorAll('input[name="event_color"]')],
  repeat: document.getElementById("event_repeat"),
  repeat_hint: document.getElementById("event_repeat_hint"),
  notes: document.getElementById("event_notes"),
  title_error: document.getElementById("event_title_error"),
  date_error: document.getElementById("event_date_error"),
  times_error: document.getElementById("event_times_error"),
  cancel_button: document.getElementById("cancel_button"),
  delete_button: document.getElementById("delete_button"),
  delete_confirm: document.getElementById("delete_confirm"),
  delete_yes: document.getElementById("delete_yes"),
  delete_no: document.getElementById("delete_no"),
};

// "Hoy" y el día elegido, como texto AAAA-MM-DD. El mes que se ve es siempre el del día elegido.
let today = today_iso();
let selected_day = today;
let events = [];
// El evento que se está editando en el diálogo (null si se está agregando uno nuevo)
let editing_event = null;
// Lo que traería un archivo de respaldo mientras la persona decide si lo importa: { merged, imported }
let pending_import = null;

// ---------------------------------------------------------------------------
// Eventos en pantalla
// ---------------------------------------------------------------------------

// 5000 → "5.000"
function format_count(count) {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// "3 eventos" / "1 evento"
function count_events(count) {
  return `${format_count(count)} ${count === 1 ? "evento" : "eventos"}`;
}

// "Todo el día" o la hora, y si se repite: "Todo el día · Se repite cada mes"
function describe_event_time(event) {
  const time = format_time_range(event.start, event.end);
  return event.repeat === "none" ? time : `${time} · ${REPEAT_DESCRIPTIONS[event.repeat]}`;
}

// Lo que se avisa a lectores de pantalla ("Evento guardado.") con un momento de pausa para que se vuelva a leer
// aunque el texto sea igual al anterior.
function announce(message) {
  dom.live_status.textContent = "";
  setTimeout(() => (dom.live_status.textContent = message), ANNOUNCE_DELAY_MILLISECONDS);
}

// Si el navegador no deja guardar, se avisa una sola vez arriba; el calendario sigue funcionando en esta sesión.
function warn_cannot_save() {
  dom.storage_warning.hidden = false;
}

function persist_events() {
  if (!save_events(events)) warn_cannot_save();
}

// ---------------------------------------------------------------------------
// Mes
// ---------------------------------------------------------------------------

function render_weekday_headers() {
  const headers = get_weekday_headers().map(({ letter, name }) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.abbr = name;
    th.textContent = letter;
    return th;
  });
  dom.grid_head_row.replaceChildren(...headers);
}

// Lo que lee un lector de pantalla al llegar a un día: la fecha completa, si es hoy, si es festivo y cuántos eventos tiene
function describe_day_for_screen_reader(iso, holiday_name, day_events) {
  const parts = [format_long_date(iso)];
  if (iso === today) parts.push("hoy");
  if (holiday_name) parts.push(`festivo: ${holiday_name}`);
  if (day_events.length) parts.push(count_events(day_events.length));
  return parts.join(", ");
}

// Los puntos de un día: el anillo del festivo, un punto por evento (hasta tres) y "+N" si hay más
function build_day_marks(has_holiday, day_events) {
  const marks = document.createElement("span");
  marks.className = "day_marks";
  marks.setAttribute("aria-hidden", "true");
  if (has_holiday) {
    const holiday_mark = document.createElement("span");
    holiday_mark.className = "holiday_mark";
    marks.append(holiday_mark);
  }
  day_events.slice(0, MAX_MARKS_PER_DAY).forEach((event) => {
    const mark = document.createElement("span");
    mark.className = `mark color_${event.color}`;
    marks.append(mark);
  });
  if (day_events.length > MAX_MARKS_PER_DAY) {
    const more = document.createElement("span");
    more.className = "mark_more";
    more.textContent = `+${day_events.length - MAX_MARKS_PER_DAY}`;
    marks.append(more);
  }
  return marks;
}

function build_day_cell({ iso, day, is_outside }, day_events) {
  const holiday_name = get_holiday_name(iso);
  const is_selected = iso === selected_day;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "day_button";
  button.classList.toggle("is_outside", is_outside);
  button.classList.toggle("is_today", iso === today);
  // Solo el día elegido entra en el orden de Tab; con las flechas se pasa a los demás.
  button.tabIndex = is_selected ? 0 : -1;
  button.dataset.date = iso;
  button.setAttribute("aria-label", describe_day_for_screen_reader(iso, holiday_name, day_events));
  if (iso === today) button.setAttribute("aria-current", "date");

  const number = document.createElement("span");
  number.className = "day_number";
  number.textContent = String(day);
  button.append(number, build_day_marks(Boolean(holiday_name), day_events));

  const cell = document.createElement("td");
  cell.setAttribute("role", "gridcell");
  cell.setAttribute("aria-selected", String(is_selected));
  cell.append(button);
  return cell;
}

function render_month() {
  const { year, month } = parse_iso(selected_day);
  dom.month_title.textContent = format_month_title(year, month);

  const grid = build_month_grid(year, month);
  const events_by_day = group_by_day(events, grid[0].iso, grid[grid.length - 1].iso);
  const cells = grid.map((day) => build_day_cell(day, events_by_day[day.iso] || []));
  const rows = [];
  for (let start = 0; start < cells.length; start += DAYS_PER_WEEK) {
    const row = document.createElement("tr");
    row.append(...cells.slice(start, start + DAYS_PER_WEEK));
    rows.push(row);
  }
  dom.grid_body.replaceChildren(...rows);
}

function build_event_item(event) {
  const bar = document.createElement("span");
  bar.className = "event_bar";
  bar.setAttribute("aria-hidden", "true");

  const title = document.createElement("p");
  title.className = "event_title";
  title.textContent = event.title;
  const time = document.createElement("p");
  time.className = "event_time";
  time.textContent = describe_event_time(event);
  const text = document.createElement("div");
  text.className = "event_text";
  text.append(title, time);

  const icon = document.createElement("i");
  icon.className = "fa-solid fa-pen";
  icon.setAttribute("aria-hidden", "true");
  const edit_button = document.createElement("button");
  edit_button.type = "button";
  edit_button.className = "icon_button";
  edit_button.dataset.eventId = event.id;
  edit_button.setAttribute("aria-label", `Editar evento: ${event.title}`);
  edit_button.append(icon);

  const item = document.createElement("li");
  item.className = `event_item color_${event.color}`;
  item.append(bar, text, edit_button);
  return item;
}

function render_day_detail() {
  dom.day_title.textContent = format_long_date(selected_day);
  const holiday_name = get_holiday_name(selected_day);
  dom.day_holiday.hidden = !holiday_name;
  dom.day_holiday_name.textContent = holiday_name ? `Festivo: ${holiday_name}` : "";

  const day_events = group_by_day(events, selected_day, selected_day)[selected_day] || [];
  dom.day_events.replaceChildren(...day_events.map(build_event_item));
  dom.day_events.hidden = day_events.length === 0;
  dom.day_empty.hidden = day_events.length > 0;
}

// Elige un día (y, si hace falta, cambia de mes). focus_day deja el foco en ese día de la cuadrícula: lo piden el
// dedo y el teclado al usar la cuadrícula, no los botones de mes ni "Hoy", que conservan su foco.
function select_day(iso, focus_day) {
  selected_day = iso;
  render_month();
  render_day_detail();
  if (focus_day) dom.grid_body.querySelector(`[data-date="${iso}"]`).focus();
}

function handle_grid_click(event) {
  const button = event.target.closest(".day_button");
  if (button) select_day(button.dataset.date, true);
}

// Flechas: de un día en un día y de una semana en otra. Inicio y Fin: primer y último día de la semana. Re Pág y
// Av Pág: mes anterior y siguiente. Enter: agregar un evento ese día.
function handle_grid_keydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    open_event_dialog(null, selected_day);
    return;
  }
  const position = weekday_position(selected_day);
  const targets = {
    ArrowLeft: () => add_days(selected_day, -1),
    ArrowRight: () => add_days(selected_day, 1),
    ArrowUp: () => add_days(selected_day, -DAYS_PER_WEEK),
    ArrowDown: () => add_days(selected_day, DAYS_PER_WEEK),
    Home: () => add_days(selected_day, -position),
    End: () => add_days(selected_day, LAST_WEEKDAY_POSITION - position),
    PageUp: () => shift_month(selected_day, -1),
    PageDown: () => shift_month(selected_day, 1),
  };
  if (!targets[event.key]) return;
  event.preventDefault();
  select_day(targets[event.key](), true);
}

// ---------------------------------------------------------------------------
// Próximos
// ---------------------------------------------------------------------------

function build_upcoming_event(event) {
  const bar = document.createElement("span");
  bar.className = "event_bar";
  bar.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.className = "event_text";
  const lines = [
    ["event_title", event.title],
    ["event_time", describe_event_time(event)],
    ["event_notes", event.notes],
  ];
  lines.forEach(([class_name, content]) => {
    if (!content) return;
    const line = document.createElement("span");
    line.className = class_name;
    line.textContent = content;
    text.append(line);
  });

  const button = document.createElement("button");
  button.type = "button";
  button.className = `upcoming_event color_${event.color}`;
  button.dataset.eventId = event.id;
  button.setAttribute("aria-label", `Editar evento: ${event.title}`);
  button.append(bar, text);

  const item = document.createElement("li");
  item.append(button);
  return item;
}

// Cada día con algo (un festivo, eventos o ambos) desde hoy hasta dentro de 90 días
function build_upcoming_day(iso, index, holiday_name, day_events) {
  const title = document.createElement("h2");
  title.id = `upcoming_day_${index}`;
  title.className = "upcoming_day_title";
  title.textContent = describe_day(iso, today);

  const section = document.createElement("section");
  section.className = "upcoming_day";
  section.setAttribute("aria-labelledby", title.id);
  section.append(title);

  if (holiday_name) {
    const holiday = document.createElement("p");
    holiday.className = "upcoming_holiday";
    const icon = document.createElement("i");
    icon.className = "fa-regular fa-flag";
    icon.setAttribute("aria-hidden", "true");
    holiday.append(icon, ` Festivo: ${holiday_name}`);
    section.append(holiday);
  }
  if (day_events.length) {
    const list = document.createElement("ul");
    list.className = "upcoming_events";
    list.append(...day_events.map(build_upcoming_event));
    section.append(list);
  }
  return section;
}

function render_upcoming() {
  const last_day = add_days(today, UPCOMING_DAYS);
  const events_by_day = group_by_day(events, today, last_day);
  const holidays = Object.fromEntries(get_holidays_between(today, last_day).map(({ iso, name }) => [iso, name]));
  const days = [...new Set([...Object.keys(events_by_day), ...Object.keys(holidays)])].sort();

  dom.upcoming_list.replaceChildren(...days.map((iso, index) => build_upcoming_day(iso, index, holidays[iso], events_by_day[iso] || [])));
  const has_events = Object.keys(events_by_day).length > 0;
  // Los festivos solos no cuentan: el aviso habla de eventos de la persona
  dom.upcoming_empty.hidden = has_events;
}

// ---------------------------------------------------------------------------
// Diálogo del evento
// ---------------------------------------------------------------------------

function get_selected_color() {
  const checked = dom.colors.find((radio) => radio.checked);
  return checked ? checked.value : DEFAULT_COLOR;
}

function update_times_visibility() {
  dom.times.hidden = dom.all_day.checked;
}

function update_repeat_hint() {
  dom.repeat_hint.hidden = dom.repeat.value === "none";
}

const FIELD_ERRORS = [
  { key: "title", message: dom.title_error, inputs: [dom.title] },
  { key: "date", message: dom.date_error, inputs: [dom.date] },
  { key: "times", message: dom.times_error, inputs: [dom.start, dom.end] },
];

function clear_form_errors() {
  FIELD_ERRORS.forEach(({ message, inputs }) => {
    message.hidden = true;
    message.textContent = "";
    inputs.forEach((input) => input.setAttribute("aria-invalid", "false"));
  });
}

// Muestra un aviso bajo cada campo con problema y lleva el foco al primero
function show_form_errors(errors) {
  clear_form_errors();
  const with_errors = FIELD_ERRORS.filter(({ key }) => errors[key]);
  with_errors.forEach(({ key, message, inputs }) => {
    message.textContent = errors[key];
    message.hidden = false;
    inputs.forEach((input) => input.setAttribute("aria-invalid", "true"));
  });
  const first = with_errors[0];
  // En las horas, el foco va a la que falta: el inicio si está vacío y, si no, el fin
  const target = first.key === "times" && dom.start.value ? dom.end : first.inputs[0];
  target.focus();
}

function fill_form(event, date) {
  dom.title.value = event ? event.title : "";
  dom.date.value = event ? event.date : date;
  dom.all_day.checked = event ? event.all_day : true;
  dom.start.value = event ? event.start : "";
  dom.end.value = event ? event.end : "";
  const color = event ? event.color : DEFAULT_COLOR;
  dom.colors.forEach((radio) => (radio.checked = radio.value === color));
  dom.repeat.value = event ? event.repeat : "none";
  dom.notes.value = event ? event.notes : "";
  update_times_visibility();
  update_repeat_hint();
  clear_form_errors();
}

// Abre el diálogo para agregar (event = null, con la fecha dada) o para editar un evento
function open_event_dialog(event, date) {
  editing_event = event;
  dom.dialog_title.textContent = event ? "Editar evento" : "Agregar evento";
  dom.delete_button.hidden = !event;
  dom.delete_confirm.hidden = true;
  fill_form(event, date);
  dom.dialog.showModal();
  dom.title.focus();
}

function read_form() {
  return {
    title: dom.title.value,
    date: dom.date.value,
    all_day: dom.all_day.checked,
    start: dom.start.value,
    end: dom.end.value,
  };
}

// Después de guardar o borrar, el foco vuelve a donde estaba la persona: al día en la cuadrícula o, en Próximos, al
// evento (si sigue existiendo) o a la pestaña.
function restore_focus(event_id) {
  if (get_current_view() === "month") {
    dom.grid_body.querySelector(`[data-date="${selected_day}"]`).focus();
    return;
  }
  const button = event_id ? dom.upcoming_list.querySelector(`[data-event-id="${event_id}"]`) : null;
  (button || dom.tabs.find((tab) => tab.dataset.view === "upcoming")).focus();
}

function refresh_all() {
  render_month();
  render_day_detail();
  render_upcoming();
  update_backup_buttons();
}

function handle_form_submit(submit_event) {
  submit_event.preventDefault();
  const fields = read_form();
  const errors = validate_event_fields(fields);
  if (!editing_event && events.length >= MAX_EVENTS) errors.title = `Llegaste al máximo de ${format_count(MAX_EVENTS)} eventos. Borra alguno para agregar otro.`;
  if (Object.keys(errors).length) {
    show_form_errors(errors);
    return;
  }

  const saved_event = sanitize_event({
    id: editing_event ? editing_event.id : create_id(),
    ...fields,
    color: get_selected_color(),
    repeat: dom.repeat.value,
    notes: dom.notes.value,
  });
  events = editing_event ? events.map((event) => (event.id === saved_event.id ? saved_event : event)) : [...events, saved_event];
  persist_events();

  dom.dialog.close();
  // Se muestra el día del evento, aunque esté en otro mes
  selected_day = saved_event.date;
  refresh_all();
  restore_focus(saved_event.id);
  flash_scene();
  announce("Evento guardado.");
}

function handle_delete_confirmed() {
  events = events.filter((event) => event.id !== editing_event.id);
  persist_events();
  dom.dialog.close();
  refresh_all();
  restore_focus(null);
  flash_scene();
  announce("Evento borrado.");
}

function setup_dialog() {
  dom.date.min = `${MIN_YEAR}-01-01`;
  dom.date.max = `${MAX_YEAR}-12-31`;

  dom.all_day.addEventListener("change", update_times_visibility);
  dom.repeat.addEventListener("change", update_repeat_hint);
  dom.form.addEventListener("submit", handle_form_submit);
  dom.cancel_button.addEventListener("click", () => dom.dialog.close());
  // Pedir confirmación antes de borrar, dentro del mismo diálogo; el foco va a "No", la opción segura
  dom.delete_button.addEventListener("click", () => {
    dom.delete_confirm.hidden = false;
    dom.delete_no.focus();
  });
  dom.delete_no.addEventListener("click", () => {
    dom.delete_confirm.hidden = true;
    dom.delete_button.focus();
  });
  dom.delete_yes.addEventListener("click", handle_delete_confirmed);
  // Cada vez que se cierra (con Guardar, Cancelar o Escape) la confirmación de borrado vuelve a estar oculta
  dom.dialog.addEventListener("close", () => (dom.delete_confirm.hidden = true));

  dom.add_event_button.addEventListener("click", () => open_event_dialog(null, selected_day));
  dom.upcoming_add_button.addEventListener("click", () => open_event_dialog(null, today));
  // Tocar el lápiz de un evento (en el detalle del día) o el evento mismo (en Próximos) abre su edición
  [dom.day_events, dom.upcoming_list].forEach((container) =>
    container.addEventListener("click", (click_event) => {
      const button = click_event.target.closest("[data-event-id]");
      if (!button) return;
      const found = events.find((event) => event.id === button.dataset.eventId);
      if (found) open_event_dialog(found, found.date);
    }),
  );
}

// ---------------------------------------------------------------------------
// Respaldo: exportar e importar
// ---------------------------------------------------------------------------

// Sin eventos no hay nada que exportar
function update_backup_buttons() {
  dom.export_button.disabled = events.length === 0;
}

function handle_export() {
  const file = new Blob([build_backup(events)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = BACKUP_FILE_NAME;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_URL_DELAY_MILLISECONDS);
  announce("Respaldo descargado.");
}

function hide_import_summary() {
  pending_import = null;
  dom.import_summary.hidden = true;
  // Se vacía el selector para que elegir otra vez el mismo archivo también cuente como un cambio
  dom.import_file.value = "";
}

// Muestra qué trae el archivo (o por qué no sirve). Solo con can_confirm se ofrece importar; si no, solo cerrar. El
// foco pasa al botón, que lee el resumen como su descripción.
function show_import_summary(message, can_confirm) {
  dom.import_summary_text.textContent = message;
  dom.import_confirm.hidden = !can_confirm;
  dom.import_cancel.textContent = can_confirm ? "Cancelar" : "Cerrar";
  dom.import_summary.hidden = false;
  (can_confirm ? dom.import_confirm : dom.import_cancel).focus();
}

function describe_import(imported, replaced, discarded) {
  const parts = [`El archivo trae ${count_events(imported)}.`];
  if (replaced) parts.push(replaced === 1 ? "1 reemplazará a uno que ya tienes." : `${replaced} reemplazarán a otros que ya tienes.`);
  if (discarded) parts.push(discarded === 1 ? "1 evento no servía y se dejó fuera." : `${discarded} eventos no servían y se dejaron fuera.`);
  return parts.join(" ");
}

async function handle_import_file_change() {
  const file = dom.import_file.files[0];
  if (!file) return;
  pending_import = null;
  if (file.size > MAX_BACKUP_BYTES) {
    show_import_summary("El archivo es demasiado grande para ser un respaldo del calendario.", false);
    return;
  }

  let text;
  try {
    text = await file.text();
  } catch {
    show_import_summary("No se pudo leer el archivo.", false);
    return;
  }
  const parsed = parse_backup(text);
  if (parsed.error) {
    show_import_summary(parsed.error, false);
    return;
  }
  if (parsed.events.length === 0) {
    show_import_summary("El archivo no trae ningún evento que sirva.", false);
    return;
  }
  const { events: merged, replaced } = merge_events(events, parsed.events);
  if (merged.length > MAX_EVENTS) {
    show_import_summary(`Con estos eventos pasarías el máximo de ${format_count(MAX_EVENTS)}. Borra algunos antes de importar.`, false);
    return;
  }
  pending_import = { merged, imported: parsed.events.length };
  show_import_summary(describe_import(parsed.events.length, replaced, parsed.discarded), true);
}

function handle_import_confirmed() {
  const { merged, imported } = pending_import;
  events = merged;
  persist_events();
  hide_import_summary();
  refresh_all();
  flash_scene();
  announce(`Se importaron ${count_events(imported)}.`);
  dom.import_button.focus();
}

function setup_backup() {
  dom.export_button.addEventListener("click", handle_export);
  dom.import_button.addEventListener("click", () => dom.import_file.click());
  dom.import_file.addEventListener("change", handle_import_file_change);
  dom.import_confirm.addEventListener("click", handle_import_confirmed);
  dom.import_cancel.addEventListener("click", () => {
    hide_import_summary();
    dom.import_button.focus();
  });
}

// ---------------------------------------------------------------------------
// Memoria de la última vista
// ---------------------------------------------------------------------------

function get_current_view() {
  const active_tab = dom.tabs.find((tab) => tab.getAttribute("aria-selected") === "true");
  return active_tab ? active_tab.dataset.view : DEFAULT_VIEW;
}

// Acepta solo una vista que exista: si alguien editó lo guardado, se usa la inicial.
function load_view() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const views = dom.tabs.map((tab) => tab.dataset.view);
    return views.includes(stored?.view) ? stored.view : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

// El almacenamiento puede fallar (modo privado, bloqueado): la página funciona igual, solo que sin recordar la vista.
function save_view() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ view: get_current_view() }));
  } catch {
    // Sin almacenamiento la vista solo dura mientras la página está abierta.
  }
}

// ---------------------------------------------------------------------------
// Pestañas
// ---------------------------------------------------------------------------

function select_view(view_key) {
  dom.tabs.forEach((tab) => {
    const is_active = tab.dataset.view === view_key;
    tab.setAttribute("aria-selected", String(is_active));
    // Solo la pestaña activa entra en el orden de Tab; con las flechas se pasa a la otra.
    tab.tabIndex = is_active ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !is_active;
  });
  save_view();
}

function handle_tab_keydown(event) {
  const current_index = dom.tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
  const last_index = dom.tabs.length - 1;
  const next_index = {
    ArrowRight: current_index === last_index ? 0 : current_index + 1,
    ArrowLeft: current_index === 0 ? last_index : current_index - 1,
    Home: 0,
    End: last_index,
  }[event.key];
  if (next_index === undefined) return;
  event.preventDefault();
  select_view(dom.tabs[next_index].dataset.view);
  dom.tabs[next_index].focus();
}

// ---------------------------------------------------------------------------
// Eventos de la página
// ---------------------------------------------------------------------------

// Si la página quedó abierta de un día para otro, al volver a ella se actualiza qué día es "hoy".
function refresh_today() {
  const now = today_iso();
  if (now === today) return;
  today = now;
  render_month();
  render_upcoming();
}

function setup_events() {
  dom.tabs.forEach((tab) => tab.addEventListener("click", () => select_view(tab.dataset.view)));
  dom.tab_list.addEventListener("keydown", handle_tab_keydown);

  dom.month_prev.addEventListener("click", () => select_day(shift_month(selected_day, -1), false));
  dom.month_next.addEventListener("click", () => select_day(shift_month(selected_day, 1), false));
  dom.month_today.addEventListener("click", () => select_day(today, false));
  dom.grid_body.addEventListener("click", handle_grid_click);
  dom.grid_body.addEventListener("keydown", handle_grid_keydown);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh_today();
  });
  setup_dialog();
  setup_backup();
}

const loaded = load_events();
events = loaded.events;
if (!loaded.can_save) warn_cannot_save();
render_weekday_headers();
refresh_all();
select_view(load_view());
setup_events();
// El fondo es decorativo: se prepara sin esperar y el calendario ya funciona mientras carga.
start_scene(document.getElementById("scene_canvas"));
