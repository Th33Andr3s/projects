// Generador de contraseñas: opciones, generación segura, fortaleza y copiar al portapapeles.
// Lo único que se guarda en el equipo son las opciones elegidas; ninguna contraseña se guarda.

import { start_scene, flash_scene } from "./animations.js";

const STORAGE_KEY = "password_generator_options";
const MIN_LENGTH = 8;
const MAX_LENGTH = 64;
const COPIED_MILLISECONDS = 2000;
// Caracteres que se confunden al leerlos o dictarlos
const CONFUSING_CHARACTERS = "0Oo1lI|";

const CHARACTER_SETS = {
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  numbers: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.<>?",
};
const TYPE_NAMES = Object.keys(CHARACTER_SETS);

const DEFAULT_OPTIONS = {
  length: 16,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  avoid_confusing: true,
};

// Niveles según los bits de entropía. Se recorren de mayor a menor y gana el primero que se alcanza.
const STRENGTH_LEVELS = [
  { min_bits: 90, level: 4, label: "Muy fuerte" },
  { min_bits: 60, level: 3, label: "Fuerte" },
  { min_bits: 40, level: 2, label: "Aceptable" },
  { min_bits: 0, level: 1, label: "Débil" },
];

const dom = {
  output: document.getElementById("password_output"),
  copy_button: document.getElementById("copy_button"),
  copy_label: document.getElementById("copy_label"),
  copy_status: document.getElementById("copy_status"),
  regenerate_button: document.getElementById("regenerate_button"),
  strength: document.getElementById("strength"),
  strength_label: document.getElementById("strength_label"),
  strength_bits: document.getElementById("strength_bits"),
  form: document.getElementById("options_form"),
  length_slider: document.getElementById("length_slider"),
  length_input: document.getElementById("length_input"),
  avoid_confusing: document.getElementById("avoid_confusing"),
  notice: document.getElementById("options_notice"),
};
dom.copy_icon = dom.copy_button.querySelector("i");
dom.type_checkboxes = Object.fromEntries(TYPE_NAMES.map((type) => [type, document.getElementById(`use_${type}`)]));

let current_password = "";
let copied_timer = 0;

// ---------------------------------------------------------------------------
// Generación segura
// ---------------------------------------------------------------------------

// Número entero al azar de 0 a limit - 1, sin sesgo. Se usa el generador del navegador (crypto) y se descartan
// los valores que caen en el resto de la división: así todos los caracteres tienen exactamente la misma
// probabilidad. Math.random no sirve para contraseñas porque es predecible.
function random_index(limit) {
  const buffer = new Uint32Array(1);
  const max_valid = Math.floor(0x100000000 / limit) * limit;
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= max_valid);
  return buffer[0] % limit;
}

function pick_character(characters) {
  return characters[random_index(characters.length)];
}

// Un alfabeto por cada tipo activo, sin los caracteres confusos si la persona lo pidió.
function get_active_alphabets(options) {
  return TYPE_NAMES.filter((type) => options[type]).map((type) =>
    options.avoid_confusing ? [...CHARACTER_SETS[type]].filter((character) => !CONFUSING_CHARACTERS.includes(character)).join("") : CHARACTER_SETS[type],
  );
}

// Garantiza al menos un carácter de cada tipo activo, completa con el alfabeto entero y baraja todo
// (Fisher-Yates con el mismo generador seguro) para que los obligatorios no queden siempre al principio.
function generate_password(options) {
  const alphabets = get_active_alphabets(options);
  const all_characters = alphabets.join("");
  const characters = alphabets.map(pick_character);
  while (characters.length < options.length) characters.push(pick_character(all_characters));

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const other = random_index(index + 1);
    [characters[index], characters[other]] = [characters[other], characters[index]];
  }
  return characters.join("");
}

function calculate_entropy_bits(options) {
  const alphabet_size = get_active_alphabets(options).join("").length;
  return Math.round(options.length * Math.log2(alphabet_size));
}

function get_strength(bits) {
  return STRENGTH_LEVELS.find((strength) => bits >= strength.min_bits);
}

// ---------------------------------------------------------------------------
// Opciones recordadas
// ---------------------------------------------------------------------------

// Acepta solo valores válidos de lo guardado: si alguien lo editó a mano, se usan las opciones iniciales.
function sanitize_options(stored) {
  const is_valid_length = Number.isInteger(stored?.length) && stored.length >= MIN_LENGTH && stored.length <= MAX_LENGTH;
  const options = { length: is_valid_length ? stored.length : DEFAULT_OPTIONS.length };
  [...TYPE_NAMES, "avoid_confusing"].forEach((name) => {
    options[name] = typeof stored?.[name] === "boolean" ? stored[name] : DEFAULT_OPTIONS[name];
  });
  if (!TYPE_NAMES.some((type) => options[type])) TYPE_NAMES.forEach((type) => (options[type] = true));
  return options;
}

// El almacenamiento puede fallar (modo privado, bloqueado): la página funciona igual con las opciones iniciales.
function load_options() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? sanitize_options(JSON.parse(stored)) : { ...DEFAULT_OPTIONS };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

function save_options(options) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Sin almacenamiento las opciones solo duran mientras la página está abierta.
  }
}

function read_options() {
  const options = { length: Number(dom.length_slider.value), avoid_confusing: dom.avoid_confusing.checked };
  TYPE_NAMES.forEach((type) => (options[type] = dom.type_checkboxes[type].checked));
  return options;
}

function apply_options_to_form(options) {
  dom.length_slider.value = String(options.length);
  dom.length_input.value = String(options.length);
  dom.avoid_confusing.checked = options.avoid_confusing;
  TYPE_NAMES.forEach((type) => (dom.type_checkboxes[type].checked = options[type]));
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

// Los números y los símbolos van en otro color para distinguir caracteres parecidos. Todo va dentro de un solo
// elemento: el recuadro usa flex, y sin él cada carácter coloreado sería un bloque aparte y, al copiar a mano,
// se colarían saltos de línea en la contraseña.
function render_password(password) {
  const nodes = [...password].map((character) => {
    if (/[A-Za-z]/.test(character)) return document.createTextNode(character);
    const span = document.createElement("span");
    span.className = /[0-9]/.test(character) ? "char_digit" : "char_symbol";
    span.textContent = character;
    return span;
  });
  const text = document.createElement("span");
  text.append(...nodes);
  dom.output.replaceChildren(text);
}

function render_strength(options) {
  const bits = calculate_entropy_bits(options);
  const strength = get_strength(bits);
  dom.strength.dataset.level = String(strength.level);
  dom.strength_label.textContent = strength.label;
  dom.strength_bits.textContent = `${bits} bits`;
}

function reset_copy_state() {
  clearTimeout(copied_timer);
  dom.copy_label.textContent = "Copiar";
  dom.copy_icon.className = "fa-regular fa-copy";
  dom.copy_status.textContent = "";
}

function show_notice(message) {
  dom.notice.textContent = message;
  dom.notice.hidden = false;
}

function hide_notice() {
  dom.notice.textContent = "";
  dom.notice.hidden = true;
}

// Genera una contraseña nueva con las opciones de la pantalla y recuerda esas opciones.
function refresh() {
  const options = read_options();
  save_options(options);
  current_password = generate_password(options);
  render_password(current_password);
  render_strength(options);
  reset_copy_state();
  flash_scene();
}

// ---------------------------------------------------------------------------
// Copiar
// ---------------------------------------------------------------------------

function select_password_text() {
  const range = document.createRange();
  range.selectNodeContents(dom.output);
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

async function copy_password() {
  try {
    await navigator.clipboard.writeText(current_password);
    show_copy_result("Copiada", "fa-solid fa-check", "Contraseña copiada al portapapeles.");
  } catch {
    // El navegador no deja copiar (por ejemplo, página sin https): se deja la contraseña seleccionada para copiarla a mano.
    select_password_text();
    show_copy_result("Copia a mano", "fa-regular fa-copy", "No se pudo copiar solo. La contraseña quedó seleccionada: cópiala con Ctrl y C, o mantén pulsado sobre ella.");
  }
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

function handle_slider_input() {
  dom.length_input.value = dom.length_slider.value;
  refresh();
}

// Mientras se escribe en el campo, solo se aplica lo que ya es válido: "5" a medio escribir no debe cambiar nada.
function handle_length_input() {
  const length = Number(dom.length_input.value);
  if (!Number.isInteger(length) || length < MIN_LENGTH || length > MAX_LENGTH) return;
  dom.length_slider.value = String(length);
  refresh();
}

// Al terminar de escribir, un valor vacío o fuera de rango se corrige al más cercano.
function handle_length_change() {
  const typed = Number.parseInt(dom.length_input.value, 10);
  const length = Number.isNaN(typed) ? Number(dom.length_slider.value) : Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, typed));
  dom.length_input.value = String(length);
  dom.length_slider.value = String(length);
  refresh();
}

// La última casilla de tipo activa no se puede desactivar: sin tipos no habría con qué armar la contraseña.
function handle_type_change(event) {
  if (!TYPE_NAMES.some((type) => dom.type_checkboxes[type].checked)) {
    event.target.checked = true;
    show_notice("Debe quedar al menos un tipo de caracteres.");
    return;
  }
  hide_notice();
  refresh();
}

function setup_events() {
  dom.length_slider.addEventListener("input", handle_slider_input);
  dom.length_input.addEventListener("input", handle_length_input);
  dom.length_input.addEventListener("change", handle_length_change);
  TYPE_NAMES.forEach((type) => dom.type_checkboxes[type].addEventListener("change", handle_type_change));
  dom.avoid_confusing.addEventListener("change", refresh);
  dom.regenerate_button.addEventListener("click", refresh);
  dom.copy_button.addEventListener("click", copy_password);
  // Enter dentro del campo de longitud no debe enviar el formulario ni recargar la página.
  dom.form.addEventListener("submit", (event) => event.preventDefault());
}

apply_options_to_form(load_options());
setup_events();
refresh();
// El fondo es decorativo: se prepara sin esperar y la página ya funciona mientras carga.
start_scene(document.getElementById("scene_canvas"));
