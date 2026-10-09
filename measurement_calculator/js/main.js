// Calculadora de medidas: pestañas de magnitud, conversión al instante, formato de números, copiar y memoria
// de la última conversión. Las unidades y la conversión viven en units.js.
import { start_scene, flash_scene } from "./animations.js";
import {
  MAGNITUDES,
  INGREDIENT_DENSITIES,
  TEMPERATURE_FORMULAS,
  get_unit_list,
  get_unit_label,
  get_unit_text,
  get_unit_word,
  convert_value,
} from "./units.js";

const STORAGE_KEY = "measurement_calculator_last";
const DEFAULT_MAGNITUDE = "length";
const DEFAULT_VALUE = "1";
const MAX_VALUE_LENGTH = 30;
const COPIED_MILLISECONDS = 2000;

const NUMBER_LOCALE = "es";
const RESULT_SIGNIFICANT_DIGITS = 6;
// Al repetir lo que la persona escribió se conservan más cifras, para no alterar su número
const ECHO_SIGNIFICANT_DIGITS = 15;
// Fuera de este rango los números se muestran con exponente para que no se corten
const EXPONENT_ABOVE = 1e15;
const EXPONENT_BELOW = 1e-6;
// Tolerancia al comparar con el cero absoluto, por los residuos de la aritmética decimal
const ABSOLUTE_ZERO_TOLERANCE = 1e-9;
const NUMBER_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;

const dom = {
  tabs: [...document.querySelectorAll(".tab")],
  tab_list: document.querySelector(".tabs"),
  panel: document.getElementById("converter_panel"),
  ingredient_field: document.getElementById("ingredient_field"),
  ingredient_select: document.getElementById("ingredient_select"),
  value_input: document.getElementById("value_input"),
  value_hint: document.getElementById("value_hint"),
  from_select: document.getElementById("from_select"),
  to_select: document.getElementById("to_select"),
  swap_button: document.getElementById("swap_button"),
  result_number: document.getElementById("result_number"),
  result_symbol: document.getElementById("result_symbol"),
  result_sentence: document.getElementById("result_sentence"),
  result_formula: document.getElementById("result_formula"),
  copy_button: document.getElementById("copy_button"),
  copy_label: document.getElementById("copy_label"),
  copy_status: document.getElementById("copy_status"),
};
dom.copy_icon = dom.copy_button.querySelector("i");

// magnitude: la magnitud activa. pairs: el último par de unidades usado en cada magnitud.
let state = { magnitude: DEFAULT_MAGNITUDE, value: DEFAULT_VALUE, ingredient: "", pairs: {} };
let copied_timer = 0;
// Último resultado mostrado: el fondo solo hace su destello cuando el resultado cambia de verdad
let last_result_text = "";

// ---------------------------------------------------------------------------
// Números: leer lo que se escribe y mostrar el resultado
// ---------------------------------------------------------------------------

// Lee el valor escrito. La coma y el punto valen como decimal; si aparecen los dos, el último es el decimal y el
// otro separa miles ("1.234,5" y "1,234.5" valen lo mismo); si un mismo signo se repite, separa miles.
// Devuelve { is_empty }, { error } o { value }.
function parse_number(text) {
  let cleaned = text.replace(/[\s  ]/g, "");
  // Un signo o un punto solos son un número a medio escribir: no es un error todavía
  if (/^[+-]?[.,]?$/.test(cleaned)) return { is_empty: true };

  const commas = (cleaned.match(/,/g) || []).length;
  const dots = (cleaned.match(/\./g) || []).length;
  if (commas && dots) {
    const decimal = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    cleaned = cleaned.split(thousands).join("").replace(decimal, ".");
  } else if (commas > 1) {
    cleaned = cleaned.split(",").join("");
  } else if (commas === 1) {
    cleaned = cleaned.replace(",", ".");
  } else if (dots > 1) {
    cleaned = cleaned.split(".").join("");
  }

  if (!NUMBER_PATTERN.test(cleaned)) return { error: "Escribe un número." };
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return { error: "Ese número es demasiado grande." };
  return { value };
}

// Hasta N cifras significativas, sin ceros de más, con separadores y coma decimal en español. Los números muy
// grandes o muy pequeños llevan exponente ("1,23457e+21").
function format_number(value, significant_digits = RESULT_SIGNIFICANT_DIGITS) {
  if (value === 0) return "0";
  const absolute = Math.abs(value);
  if (absolute >= EXPONENT_ABOVE || absolute < EXPONENT_BELOW) {
    const [mantissa, exponent] = value.toExponential(significant_digits - 1).split("e");
    const trimmed = mantissa.includes(".") ? mantissa.replace(/0+$/, "").replace(/\.$/, "") : mantissa;
    return `${trimmed.replace(".", ",")}e${exponent}`;
  }
  return Number(value.toPrecision(significant_digits)).toLocaleString(NUMBER_LOCALE, { maximumFractionDigits: 20 });
}

// ---------------------------------------------------------------------------
// Memoria de la última conversión
// ---------------------------------------------------------------------------

function is_valid_pair(magnitude_key, ingredient_key, pair) {
  const keys = get_unit_list(magnitude_key, ingredient_key).map((unit_item) => unit_item.key);
  return typeof pair?.from === "string" && typeof pair?.to === "string" && keys.includes(pair.from) && keys.includes(pair.to);
}

// Acepta solo valores válidos de lo guardado: si alguien lo editó a mano, se usan los iniciales.
function sanitize_state(stored) {
  const ingredient = typeof stored?.ingredient === "string" && stored.ingredient in INGREDIENT_DENSITIES ? stored.ingredient : "";
  const pairs = {};
  Object.keys(MAGNITUDES).forEach((magnitude_key) => {
    const pair = stored?.pairs?.[magnitude_key];
    if (is_valid_pair(magnitude_key, ingredient, pair)) pairs[magnitude_key] = { from: pair.from, to: pair.to };
  });
  return {
    magnitude: typeof stored?.magnitude === "string" && stored.magnitude in MAGNITUDES ? stored.magnitude : DEFAULT_MAGNITUDE,
    value: typeof stored?.value === "string" && stored.value.length <= MAX_VALUE_LENGTH ? stored.value : DEFAULT_VALUE,
    ingredient,
    pairs,
  };
}

// El almacenamiento puede fallar (modo privado, bloqueado): la página funciona igual con lo inicial.
function load_state() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? sanitize_state(JSON.parse(stored)) : sanitize_state(null);
  } catch {
    return sanitize_state(null);
  }
}

function save_state() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Sin almacenamiento la última conversión solo dura mientras la página está abierta.
  }
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

function fill_select(select, units, selected_key) {
  const options = units.map((unit_item) => {
    const option = document.createElement("option");
    option.value = unit_item.key;
    option.textContent = get_unit_label(unit_item);
    return option;
  });
  select.replaceChildren(...options);
  select.value = selected_key;
}

// Llena las dos listas con las unidades de la magnitud activa. Si el par recordado ya no sirve (por ejemplo, era
// el gramo y se quitó el ingrediente), se vuelve al par más común.
function render_units() {
  const magnitude = MAGNITUDES[state.magnitude];
  const units = get_unit_list(state.magnitude, state.ingredient);
  const stored_pair = state.pairs[state.magnitude];
  const pair = is_valid_pair(state.magnitude, state.ingredient, stored_pair) ? stored_pair : { from: magnitude.default_from, to: magnitude.default_to };
  fill_select(dom.from_select, units, pair.from);
  fill_select(dom.to_select, units, pair.to);
}

function render_tabs() {
  dom.tabs.forEach((tab) => {
    const is_active = tab.dataset.magnitude === state.magnitude;
    tab.setAttribute("aria-selected", String(is_active));
    // Solo la pestaña activa entra en el orden de Tab; con las flechas se pasa a las demás.
    tab.tabIndex = is_active ? 0 : -1;
    if (is_active) dom.panel.setAttribute("aria-labelledby", tab.id);
  });
  dom.ingredient_field.hidden = state.magnitude !== "cooking";
}

function reset_copy_state() {
  clearTimeout(copied_timer);
  dom.copy_label.textContent = "Copiar resultado";
  dom.copy_icon.className = "fa-regular fa-copy";
  dom.copy_status.textContent = "";
}

// Deja el resultado vacío. Si hay un mensaje, lo muestra bajo el campo de valor.
function clear_result(message = "") {
  last_result_text = "";
  dom.result_number.textContent = "—";
  dom.result_symbol.textContent = "";
  dom.result_sentence.textContent = "";
  dom.result_formula.textContent = "";
  dom.value_hint.textContent = message;
  dom.value_hint.hidden = !message;
  dom.copy_button.disabled = true;
  reset_copy_state();
}

// Avisa si el valor no tiene sentido en la magnitud: negativo donde no cabe, o por debajo del cero absoluto.
function get_range_error(magnitude, from_unit, value) {
  if (!magnitude.allows_negative && value < 0) return "En esta magnitud el valor no puede ser negativo.";
  if (magnitude.allows_negative && from_unit.to_base(value) < -ABSOLUTE_ZERO_TOLERANCE) return "Eso es menos que el cero absoluto.";
  return "";
}

function get_formula(from_unit, to_unit) {
  if (from_unit.key === to_unit.key) return "Es la misma unidad.";
  const temperature_formula = TEMPERATURE_FORMULAS[`${from_unit.key}>${to_unit.key}`];
  if (temperature_formula) return temperature_formula;
  const one_converted = convert_value(from_unit, to_unit, 1);
  return `1 ${get_unit_text(from_unit, 1)} = ${format_number(one_converted)} ${get_unit_text(to_unit, one_converted)}`;
}

// Recalcula el resultado con lo que hay en pantalla y recuerda la conversión.
function update() {
  const magnitude = MAGNITUDES[state.magnitude];
  const units = get_unit_list(state.magnitude, state.ingredient);
  const from_unit = units.find((unit_item) => unit_item.key === dom.from_select.value);
  const to_unit = units.find((unit_item) => unit_item.key === dom.to_select.value);
  state.value = dom.value_input.value.slice(0, MAX_VALUE_LENGTH);
  state.pairs[state.magnitude] = { from: from_unit.key, to: to_unit.key };
  save_state();

  const parsed = parse_number(dom.value_input.value);
  if (parsed.is_empty) {
    clear_result();
    return;
  }
  if (parsed.error) {
    clear_result(parsed.error);
    return;
  }
  const range_error = get_range_error(magnitude, from_unit, parsed.value);
  if (range_error) {
    clear_result(range_error);
    return;
  }

  const result = convert_value(from_unit, to_unit, parsed.value);
  // El resultado se redondea primero, y con ese número se decide si va en singular o plural
  const rounded = Number(result.toPrecision(RESULT_SIGNIFICANT_DIGITS));
  const result_text = format_number(result);
  const verb = Math.abs(parsed.value) === 1 ? "equivale a" : "equivalen a";

  dom.value_hint.textContent = "";
  dom.value_hint.hidden = true;
  dom.result_number.textContent = result_text;
  dom.result_symbol.textContent = get_unit_text(to_unit, rounded);
  dom.result_sentence.textContent = `${format_number(parsed.value, ECHO_SIGNIFICANT_DIGITS)} ${get_unit_word(from_unit, parsed.value)} ${verb} ${result_text} ${get_unit_word(to_unit, rounded)}`;
  dom.result_formula.textContent = get_formula(from_unit, to_unit);
  dom.copy_button.disabled = false;
  reset_copy_state();
  if (result_text !== last_result_text) flash_scene();
  last_result_text = result_text;
}

// ---------------------------------------------------------------------------
// Copiar
// ---------------------------------------------------------------------------

function select_result_text() {
  const range = document.createRange();
  range.selectNodeContents(dom.result_number);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function show_copy_result(label, icon_class, status) {
  dom.copy_label.textContent = label;
  dom.copy_icon.className = icon_class;
  dom.copy_status.textContent = status;
  clearTimeout(copied_timer);
  copied_timer = setTimeout(reset_copy_state, COPIED_MILLISECONDS);
}

// Se copia solo el número, tal como se ve, sin la unidad.
async function copy_result() {
  try {
    await navigator.clipboard.writeText(dom.result_number.textContent);
    show_copy_result("Copiado", "fa-solid fa-check", "Resultado copiado al portapapeles.");
  } catch {
    // El navegador no deja copiar (por ejemplo, página sin https): se deja el número seleccionado para copiarlo a mano.
    select_result_text();
    show_copy_result("Copia a mano", "fa-regular fa-copy", "No se pudo copiar solo. El número quedó seleccionado: cópialo con Ctrl y C, o mantén pulsado sobre él.");
  }
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

// Cambia de magnitud: se guarda el par que se estaba usando y se abre el último par usado en la nueva.
function select_magnitude(magnitude_key) {
  if (magnitude_key === state.magnitude) return;
  state.pairs[state.magnitude] = { from: dom.from_select.value, to: dom.to_select.value };
  state.magnitude = magnitude_key;
  render_tabs();
  render_units();
  update();
  // La pestaña activa siempre queda a la vista, aunque la fila esté desplazada
  const active_tab = dom.tabs.find((tab) => tab.dataset.magnitude === magnitude_key);
  active_tab.scrollIntoView({ inline: "center", block: "nearest" });
}

function handle_tab_keydown(event) {
  const current_index = dom.tabs.findIndex((tab) => tab.dataset.magnitude === state.magnitude);
  const last_index = dom.tabs.length - 1;
  const next_index = {
    ArrowRight: current_index === last_index ? 0 : current_index + 1,
    ArrowLeft: current_index === 0 ? last_index : current_index - 1,
    Home: 0,
    End: last_index,
  }[event.key];
  if (next_index === undefined) return;
  event.preventDefault();
  select_magnitude(dom.tabs[next_index].dataset.magnitude);
  dom.tabs[next_index].focus();
}

function handle_ingredient_change() {
  state.ingredient = dom.ingredient_select.value;
  // Si se quita el ingrediente, el gramo desaparece de las listas y, si estaba elegido, se vuelve al par común
  const stored_pair = { from: dom.from_select.value, to: dom.to_select.value };
  state.pairs[state.magnitude] = stored_pair;
  render_units();
  update();
}

function handle_swap() {
  const from_key = dom.from_select.value;
  dom.from_select.value = dom.to_select.value;
  dom.to_select.value = from_key;
  update();
}

function setup_events() {
  dom.tabs.forEach((tab) => tab.addEventListener("click", () => select_magnitude(tab.dataset.magnitude)));
  dom.tab_list.addEventListener("keydown", handle_tab_keydown);
  dom.ingredient_select.addEventListener("change", handle_ingredient_change);
  dom.value_input.addEventListener("input", update);
  dom.from_select.addEventListener("change", update);
  dom.to_select.addEventListener("change", update);
  dom.swap_button.addEventListener("click", handle_swap);
  dom.copy_button.addEventListener("click", copy_result);
}

state = load_state();
dom.value_input.value = state.value;
dom.ingredient_select.value = state.ingredient;
render_tabs();
render_units();
setup_events();
update();
// El fondo es decorativo: se prepara sin esperar y la calculadora ya funciona mientras carga.
start_scene(document.getElementById("scene_canvas"));
