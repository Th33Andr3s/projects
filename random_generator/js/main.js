// Generador aleatorio: pestañas (Números, Lista, Dados y moneda), tirada con su animación, resultado grande, historial,
// copiar y la memoria de los últimos valores. El azar y los textos viven en random_tools.js.
import { start_scene, flash_scene } from "./animations.js";
import {
  create_random_source,
  flip_coins,
  format_result,
  parse_list,
  pick_items,
  random_integers,
  roll_dice,
  shuffle,
  split_into_teams,
  validate_numbers,
} from "./random_tools.js";

const STORAGE_KEY = "random_generator_last";
const TABS = ["numbers", "list", "dice"];
const ROLL_MILLISECONDS = 600;
const ROLL_FRAME_MILLISECONDS = 70;
const COPIED_MILLISECONDS = 2000;
const ANNOUNCE_DELAY_MILLISECONDS = 50;
const MAX_HISTORY = 50;
// El texto de cada tirada del historial se acorta si es larguísimo (por ejemplo, 1.000 números)
const MAX_HISTORY_TEXT = 300;
const MAX_SAVED_LIST_BYTES = 50 * 1024;
const MANY_RESULTS = 12;
const MIN_TEAMS = 2;
const MAX_TEAMS = 20;
const MAX_DICE_OR_COINS = 10;
const NOT_A_NUMBER_FIELD_LENGTH = 12;

const dom = {
  tabs: [...document.querySelectorAll(".tab")],
  tab_list: document.querySelector(".tabs"),
  panels: { numbers: document.getElementById("panel_numbers"), list: document.getElementById("panel_list"), dice: document.getElementById("panel_dice") },
  numbers_minimum: document.getElementById("numbers_minimum"),
  numbers_maximum: document.getElementById("numbers_maximum"),
  numbers_count: document.getElementById("numbers_count"),
  numbers_unique: document.getElementById("numbers_unique"),
  numbers_sorted: document.getElementById("numbers_sorted"),
  draw_numbers_label: document.getElementById("draw_numbers_label"),
  list_input: document.getElementById("list_input"),
  list_count: document.getElementById("list_count"),
  list_pick_count: document.getElementById("list_pick_count"),
  list_teams: document.getElementById("list_teams"),
  list_remove_picked: document.getElementById("list_remove_picked"),
  dice_count: document.getElementById("dice_count"),
  dice_faces: document.getElementById("dice_faces"),
  coin_count: document.getElementById("coin_count"),
  form_warning: document.getElementById("form_warning"),
  form_warning_text: document.getElementById("form_warning_text"),
  result_placeholder: document.getElementById("result_placeholder"),
  result_content: document.getElementById("result_content"),
  result_detail: document.getElementById("result_detail"),
  copy_button: document.getElementById("copy_button"),
  copy_label: document.getElementById("copy_label"),
  copy_fallback: document.getElementById("copy_fallback"),
  copy_fallback_text: document.getElementById("copy_fallback_text"),
  history_summary: document.getElementById("history_summary"),
  history_empty: document.getElementById("history_empty"),
  history_list: document.getElementById("history_list"),
  copy_history_button: document.getElementById("copy_history_button"),
  copy_history_label: document.getElementById("copy_history_label"),
  clear_history_button: document.getElementById("clear_history_button"),
  live_status: document.getElementById("live_status"),
  action_buttons: [...document.querySelectorAll(".action_button")],
};

// La fuente de azar de verdad (crypto). Si el navegador no la tiene, no se sortea: nunca se cae a Math.random sin decirlo.
let random_below = null;
try {
  random_below = create_random_source(window.crypto);
} catch {
  random_below = null;
}

let current_tab = "numbers";
let is_rolling = false;
let roll_timer = 0;
let roll_frame = 0;
// El último resultado (para copiarlo) y el historial, de la tirada más reciente a la más vieja
let current_result = null;
let history = [];

// ---------------------------------------------------------------------------
// Números y avisos
// ---------------------------------------------------------------------------

// Puntos para los miles, como en Colombia: 1250 → "1.250". Se arma a mano para no depender del idioma del navegador.
function format_count(count) {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function count_text(count, singular, plural) {
  return `${format_count(count)} ${count === 1 ? singular : plural}`;
}

// El valor entero de un campo; un campo vacío o con decimales da NaN o un número no entero, y la validación lo rechaza
function read_number(input) {
  return input.value.trim() === "" ? Number.NaN : Number(input.value);
}

// Lo que se avisa a lectores de pantalla, con un momento de pausa para que se vuelva a leer aunque el texto sea igual
// al anterior
function announce(message) {
  dom.live_status.textContent = "";
  setTimeout(() => (dom.live_status.textContent = message), ANNOUNCE_DELAY_MILLISECONDS);
}

function show_warning(message) {
  dom.form_warning_text.textContent = message;
  dom.form_warning.hidden = false;
}

function hide_warning() {
  dom.form_warning.hidden = true;
}

// ---------------------------------------------------------------------------
// Memoria de los últimos valores
// ---------------------------------------------------------------------------

function is_number_field(value) {
  return typeof value === "string" && value.length <= NOT_A_NUMBER_FIELD_LENGTH && /^-?\d*$/.test(value);
}

function is_history_entry(entry) {
  return Boolean(entry) && ["time", "label", "text"].every((key) => typeof entry[key] === "string") && entry.time.length <= 5 && entry.label.length <= 20 && entry.text.length <= MAX_HISTORY_TEXT + 1;
}

// Acepta solo valores válidos de lo guardado: si alguien lo editó a mano, se usan los iniciales campo por campo.
function load_state() {
  const state = {};
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (TABS.includes(stored?.tab)) state.tab = stored.tab;
    const numbers = stored?.numbers;
    ["minimum", "maximum", "count"].forEach((key) => {
      if (is_number_field(numbers?.[key])) (state.numbers ??= {})[key] = numbers[key];
    });
    ["unique", "sorted"].forEach((key) => {
      if (typeof numbers?.[key] === "boolean") (state.numbers ??= {})[key] = numbers[key];
    });
    const list = stored?.list;
    if (typeof list?.text === "string" && new TextEncoder().encode(list.text).length <= MAX_SAVED_LIST_BYTES) (state.list ??= {}).text = list.text;
    ["pick_count", "teams"].forEach((key) => {
      if (is_number_field(list?.[key])) (state.list ??= {})[key] = list[key];
    });
    if (typeof list?.remove_picked === "boolean") (state.list ??= {}).remove_picked = list.remove_picked;
    const dice = stored?.dice;
    if (is_number_field(dice?.count)) (state.dice ??= {}).count = dice.count;
    if (is_number_field(dice?.coins)) (state.dice ??= {}).coins = dice.coins;
    if ([...dom.dice_faces.options].some((option) => option.value === dice?.faces)) (state.dice ??= {}).faces = dice.faces;
    if (Array.isArray(stored?.history)) state.history = stored.history.filter(is_history_entry).slice(0, MAX_HISTORY);
  } catch {
    // Sin almacenamiento, o con datos dañados, se usan los valores iniciales.
  }
  return state;
}

// El almacenamiento puede fallar (modo privado, bloqueado): la página funciona igual, solo que sin recordar nada.
function save_state() {
  const list_text = dom.list_input.value;
  const state = {
    tab: current_tab,
    numbers: {
      minimum: dom.numbers_minimum.value,
      maximum: dom.numbers_maximum.value,
      count: dom.numbers_count.value,
      unique: dom.numbers_unique.checked,
      sorted: dom.numbers_sorted.checked,
    },
    list: {
      text: new TextEncoder().encode(list_text).length <= MAX_SAVED_LIST_BYTES ? list_text : "",
      pick_count: dom.list_pick_count.value,
      teams: dom.list_teams.value,
      remove_picked: dom.list_remove_picked.checked,
    },
    dice: { count: dom.dice_count.value, faces: dom.dice_faces.value, coins: dom.coin_count.value },
    history,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Sin almacenamiento los valores solo duran mientras la página está abierta.
  }
}

// ---------------------------------------------------------------------------
// Qué se sortea en cada acción: valida las opciones y devuelve { error } o { label, detail, compute, finish }.
// compute(source) calcula el resultado con la fuente de azar que se le dé (la real, o la de adorno de la animación);
// finish(resultado) (opcional) se llama cuando el resultado de verdad ya se mostró.
// ---------------------------------------------------------------------------

function prepare_numbers() {
  const unique = dom.numbers_unique.checked;
  const sorted = dom.numbers_sorted.checked;
  const count = read_number(dom.numbers_count);
  const validation = validate_numbers({ minimum: read_number(dom.numbers_minimum), maximum: read_number(dom.numbers_maximum), count, unique });
  if (validation.error) return { error: validation.error };
  const { minimum, maximum } = validation;
  // Si el mínimo estaba por encima del máximo, los campos quedan en su orden
  dom.numbers_minimum.value = String(minimum);
  dom.numbers_maximum.value = String(maximum);
  const range_text = `entre ${minimum} y ${maximum}${unique ? ", sin repetir" : ""}${sorted ? ", de menor a mayor" : ""}`;
  return {
    label: "Números",
    detail: count > 1 ? `${format_count(count)} números ${range_text}` : `Un número ${range_text}`,
    compute: (source) => ({ kind: "numbers", values: random_integers(minimum, maximum, count, { unique, sorted }, source) }),
  };
}

function list_items_or_error() {
  const items = parse_list(dom.list_input.value);
  return items.length === 0 ? { error: "Escribe al menos un elemento en la lista, uno por línea." } : { items };
}

function prepare_pick() {
  const { items, error } = list_items_or_error();
  if (error) return { error };
  const count = read_number(dom.list_pick_count);
  if (!Number.isInteger(count) || count < 1) return { error: "«Cuántos elegir» debe ser un número entero de 1 en adelante." };
  if (count > items.length) return { error: `Pides elegir ${format_count(count)}, pero la lista tiene ${count_text(items.length, "elemento", "elementos")}.` };
  const remove_picked = dom.list_remove_picked.checked;
  return {
    label: "Lista",
    detail: `Elegir ${format_count(count)} de ${count_text(items.length, "elemento", "elementos")}${remove_picked ? ", quitando a quien sale" : ""}`,
    compute: (source) => ({ kind: "pick", values: pick_items(items, count, source) }),
    finish: (result) => {
      if (!remove_picked) return;
      // Se quita la primera aparición de cada elegido y la lista se vuelve a escribir, un elemento por línea
      const remaining = [...items];
      result.values.forEach((value) => remaining.splice(remaining.indexOf(value), 1));
      dom.list_input.value = remaining.join("\n");
      update_list_count();
    },
  };
}

function prepare_shuffle() {
  const { items, error } = list_items_or_error();
  if (error) return { error };
  return {
    label: "Lista",
    detail: `Mezcla de ${count_text(items.length, "elemento", "elementos")}`,
    compute: (source) => ({ kind: "shuffle", values: shuffle(items, source) }),
  };
}

function prepare_teams() {
  const { items, error } = list_items_or_error();
  if (error) return { error };
  const team_count = read_number(dom.list_teams);
  if (!Number.isInteger(team_count) || team_count < MIN_TEAMS || team_count > MAX_TEAMS) return { error: `Los equipos deben ser un número entero entre ${MIN_TEAMS} y ${MAX_TEAMS}.` };
  if (team_count > items.length) return { error: `Hay ${count_text(items.length, "elemento", "elementos")} y ${team_count} equipos: no alcanza para uno por equipo.` };
  return {
    label: "Equipos",
    detail: `${count_text(items.length, "elemento", "elementos")} repartidos en ${team_count} equipos`,
    compute: (source) => ({ kind: "teams", teams: split_into_teams(items, team_count, source) }),
  };
}

function prepare_dice() {
  const count = read_number(dom.dice_count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_DICE_OR_COINS) return { error: `Los dados deben ser un número entero entre 1 y ${MAX_DICE_OR_COINS}.` };
  const faces = Number(dom.dice_faces.value);
  return {
    label: "Dados",
    detail: `${count_text(count, "dado", "dados")} de ${faces} caras`,
    compute: (source) => ({ kind: "dice", ...roll_dice(count, faces, source) }),
  };
}

function prepare_coins() {
  const count = read_number(dom.coin_count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_DICE_OR_COINS) return { error: `Las monedas deben ser un número entero entre 1 y ${MAX_DICE_OR_COINS}.` };
  return {
    label: "Moneda",
    detail: count_text(count, "moneda", "monedas"),
    compute: (source) => ({ kind: "coins", values: flip_coins(count, source) }),
  };
}

const ACTIONS = {
  draw_numbers: prepare_numbers,
  pick_from_list: prepare_pick,
  shuffle_list: prepare_shuffle,
  split_list: prepare_teams,
  roll_dice_button: prepare_dice,
  flip_coin_button: prepare_coins,
};

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

function make_element(tag, class_name, text) {
  const element = document.createElement(tag);
  if (class_name) element.className = class_name;
  if (text !== undefined) element.textContent = text;
  return element;
}

function make_chips(values) {
  const list = make_element("ul", values.length > MANY_RESULTS ? "chips is_many" : "chips");
  values.forEach((value) => list.append(make_element("li", "chip", String(value))));
  return list;
}

// Dibuja el resultado en letras grandes: según lo que se sorteó, fichas, una lista numerada o una columna por equipo
function render_result(result) {
  const content = dom.result_content;
  content.replaceChildren();
  if (result.kind === "shuffle") {
    const list = make_element("ol", "shuffle_list");
    result.values.forEach((value) => list.append(make_element("li", "", value)));
    content.append(list);
  } else if (result.kind === "teams") {
    const teams = make_element("div", "teams");
    result.teams.forEach((team, index) => {
      const section = make_element("section", "team");
      section.append(make_element("h3", "team_title", `Equipo ${index + 1} (${team.length})`));
      const members = make_element("ul", "");
      team.forEach((member) => members.append(make_element("li", "", member)));
      section.append(members);
      teams.append(section);
    });
    content.append(teams);
  } else {
    content.append(make_chips(result.values));
    if (result.kind === "dice" && result.values.length > 1) content.append(make_element("p", "result_sum", `Suma: ${result.sum}`));
  }
  dom.result_placeholder.hidden = true;
  content.hidden = false;
}

// Mientras dura la tirada, los valores van cambiando en un solo texto (aria-hidden: solo cuenta el resultado final)
function render_rolling(result) {
  const fake = make_element("p", "result_fake", format_result(result).replace(/\n/g, "   "));
  fake.setAttribute("aria-hidden", "true");
  dom.result_content.replaceChildren(fake);
  dom.result_placeholder.hidden = true;
  dom.result_content.hidden = false;
}

function reset_copy() {
  clearTimeout(copy_timer);
  dom.copy_label.textContent = "Copiar";
  copy_icon.className = "fa-regular fa-copy";
}

function show_result(result, detail) {
  current_result = result;
  render_result(result);
  dom.result_detail.textContent = detail;
  dom.result_detail.hidden = false;
  dom.copy_button.disabled = false;
  dom.copy_fallback.hidden = true;
  reset_copy();
}

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------

function two_digits(value) {
  return String(value).padStart(2, "0");
}

function history_line(entry) {
  return `${entry.time} · ${entry.label} · ${entry.text}`;
}

function render_history() {
  dom.history_summary.textContent = `Historial (${format_count(history.length)})`;
  dom.history_list.replaceChildren();
  history.forEach((entry) => {
    const item = make_element("li", "");
    item.append(make_element("span", "history_time", `${entry.time} · `), document.createTextNode(`${entry.label} · ${entry.text}`));
    dom.history_list.append(item);
  });
  dom.history_empty.hidden = history.length > 0;
  dom.history_list.hidden = history.length === 0;
  dom.copy_history_button.disabled = history.length === 0;
  dom.clear_history_button.disabled = history.length === 0;
}

function add_to_history(label, result) {
  const now = new Date();
  let text = format_result(result).replace(/\n/g, " / ");
  if (text.length > MAX_HISTORY_TEXT) text = `${text.slice(0, MAX_HISTORY_TEXT)}…`;
  history = [{ time: `${two_digits(now.getHours())}:${two_digits(now.getMinutes())}`, label, text }, ...history].slice(0, MAX_HISTORY);
  render_history();
}

// ---------------------------------------------------------------------------
// Tirada
// ---------------------------------------------------------------------------

// Fuente de azar solo para la animación (los valores que se ven cambiar): nunca decide el resultado
function visual_source(limit) {
  return Math.floor(Math.random() * limit);
}

function set_buttons_disabled(disabled) {
  dom.action_buttons.forEach((button) => (button.disabled = disabled));
}

function finish_roll(prepared, result) {
  clearTimeout(roll_timer);
  cancelAnimationFrame(roll_frame);
  is_rolling = false;
  show_result(result, prepared.detail);
  add_to_history(prepared.label, result);
  if (prepared.finish) prepared.finish(result);
  set_buttons_disabled(false);
  save_state();
  flash_scene();
  announce(`Resultado: ${format_result(result).replace(/\n/g, ". ")}.`);
}

function perform(action_id) {
  if (is_rolling) return;
  if (!random_below) {
    show_warning("Tu navegador no tiene un generador de azar seguro, así que no se puede sortear. Prueba con otro navegador.");
    return;
  }
  const prepared = ACTIONS[action_id]();
  if (prepared.error) {
    show_warning(prepared.error);
    return;
  }
  hide_warning();
  const result = prepared.compute(random_below);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finish_roll(prepared, result);
    return;
  }
  // La tirada dura unas décimas de segundo: los botones quedan desactivados y el resultado solo se muestra, se anuncia y
  // se guarda al terminar. El final lo marca un temporizador (no se retrasa si la pestaña se oculta); los cuadros de la
  // animación, el bucle de dibujo.
  is_rolling = true;
  set_buttons_disabled(true);
  let last_frame = 0;
  const frame = (now) => {
    if (now - last_frame >= ROLL_FRAME_MILLISECONDS) {
      last_frame = now;
      render_rolling(prepared.compute(visual_source));
    }
    roll_frame = requestAnimationFrame(frame);
  };
  roll_frame = requestAnimationFrame(frame);
  roll_timer = setTimeout(() => finish_roll(prepared, result), ROLL_MILLISECONDS);
}

// ---------------------------------------------------------------------------
// Copiar y borrar
// ---------------------------------------------------------------------------

const copy_icon = dom.copy_button.querySelector("i");
let copy_timer = 0;

function show_copy_state(label_text, icon_class, status) {
  dom.copy_label.textContent = label_text;
  copy_icon.className = icon_class;
  announce(status);
  clearTimeout(copy_timer);
  copy_timer = setTimeout(reset_copy, COPIED_MILLISECONDS);
}

async function handle_copy() {
  if (!current_result) return;
  const text = format_result(current_result);
  try {
    await navigator.clipboard.writeText(text);
    show_copy_state("Copiado", "fa-solid fa-check", "Resultado copiado al portapapeles.");
    flash_scene();
  } catch {
    // El navegador no deja copiar (por ejemplo, página sin https): se muestra el texto seleccionado para copiarlo a mano
    dom.copy_fallback_text.value = text;
    dom.copy_fallback.hidden = false;
    dom.copy_fallback_text.focus();
    dom.copy_fallback_text.select();
    show_copy_state("Copia a mano", "fa-regular fa-copy", "No se pudo copiar solo. El texto quedó seleccionado en un cuadro: cópialo con Ctrl y C, o mantén pulsado sobre él.");
  }
}

let copy_history_timer = 0;

async function handle_copy_history() {
  const icon = dom.copy_history_button.querySelector("i");
  const reset = () => {
    dom.copy_history_label.textContent = "Copiar historial";
    icon.className = "fa-regular fa-copy";
  };
  clearTimeout(copy_history_timer);
  try {
    await navigator.clipboard.writeText(history.map(history_line).join("\n"));
    dom.copy_history_label.textContent = "Copiado";
    icon.className = "fa-solid fa-check";
    announce("Historial copiado al portapapeles.");
  } catch {
    dom.copy_history_label.textContent = "No se pudo copiar";
    announce("No se pudo copiar el historial. Tu navegador no lo permite en esta página.");
  }
  copy_history_timer = setTimeout(reset, COPIED_MILLISECONDS);
}

function handle_clear_history() {
  history = [];
  render_history();
  save_state();
  announce("Historial borrado.");
}

// ---------------------------------------------------------------------------
// Pestañas
// ---------------------------------------------------------------------------

function select_tab(tab_name) {
  current_tab = tab_name;
  dom.tabs.forEach((tab) => {
    const is_active = tab.dataset.tab === tab_name;
    tab.setAttribute("aria-selected", String(is_active));
    // Solo la pestaña activa entra en el orden de Tab; con las flechas se pasa a las otras.
    tab.tabIndex = is_active ? 0 : -1;
  });
  TABS.forEach((name) => (dom.panels[name].hidden = name !== tab_name));
  hide_warning();
  save_state();
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
  select_tab(dom.tabs[next_index].dataset.tab);
  dom.tabs[next_index].focus();
}

// ---------------------------------------------------------------------------
// Lista y botón de números
// ---------------------------------------------------------------------------

function update_list_count() {
  dom.list_count.textContent = count_text(parse_list(dom.list_input.value).length, "elemento", "elementos");
}

// "Sacar número" o "Sacar números" según la cantidad
function update_draw_label() {
  dom.draw_numbers_label.textContent = read_number(dom.numbers_count) > 1 ? "Sacar números" : "Sacar número";
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

function setup_events() {
  dom.tabs.forEach((tab) => tab.addEventListener("click", () => select_tab(tab.dataset.tab)));
  dom.tab_list.addEventListener("keydown", handle_tab_keydown);
  Object.keys(ACTIONS).forEach((action_id) => document.getElementById(action_id).addEventListener("click", () => perform(action_id)));

  // Enter en un campo dispara la acción principal de su pestaña
  document.querySelectorAll("[data-enter]").forEach((field) => {
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      document.getElementById(field.dataset.enter).click();
    });
  });

  // Los campos y casillas se recuerdan al cambiar
  document.querySelectorAll("input, select, textarea").forEach((field) => {
    field.addEventListener(field.type === "checkbox" || field.tagName === "SELECT" ? "change" : "input", save_state);
  });
  dom.list_input.addEventListener("input", update_list_count);
  dom.numbers_count.addEventListener("input", update_draw_label);

  dom.copy_button.addEventListener("click", handle_copy);
  dom.copy_history_button.addEventListener("click", handle_copy_history);
  dom.clear_history_button.addEventListener("click", handle_clear_history);
}

function restore_state(state) {
  const set_value = (input, value) => {
    if (value !== undefined) input.value = value;
  };
  const set_checked = (input, value) => {
    if (value !== undefined) input.checked = value;
  };
  set_value(dom.numbers_minimum, state.numbers?.minimum);
  set_value(dom.numbers_maximum, state.numbers?.maximum);
  set_value(dom.numbers_count, state.numbers?.count);
  set_checked(dom.numbers_unique, state.numbers?.unique);
  set_checked(dom.numbers_sorted, state.numbers?.sorted);
  set_value(dom.list_input, state.list?.text);
  set_value(dom.list_pick_count, state.list?.pick_count);
  set_value(dom.list_teams, state.list?.teams);
  set_checked(dom.list_remove_picked, state.list?.remove_picked);
  set_value(dom.dice_count, state.dice?.count);
  set_value(dom.dice_faces, state.dice?.faces);
  set_value(dom.coin_count, state.dice?.coins);
  history = state.history ?? [];
}

const saved_state = load_state();
restore_state(saved_state);
setup_events();
update_list_count();
update_draw_label();
render_history();
select_tab(saved_state.tab ?? "numbers");
if (!random_below) {
  show_warning("Tu navegador no tiene un generador de azar seguro, así que no se puede sortear. Prueba con otro navegador.");
  set_buttons_disabled(true);
}
// El fondo es decorativo: se prepara sin esperar y el generador ya funciona mientras carga.
start_scene(document.getElementById("scene_canvas"));
