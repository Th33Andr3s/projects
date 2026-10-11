// Formateador de código: entrada, lenguaje, opciones, resultado en vivo, estado (listo, o un aviso con su línea),
// estadísticas, copiar, descargar y la memoria de los últimos valores. La detección del lenguaje y los formateadores
// viven en formatters.js.
import { start_scene, flash_scene } from "./animations.js";
import { detect_language, format_code } from "./formatters.js";

const STORAGE_KEY = "code_formatter_last";
const DEFAULT_LANGUAGE = "auto";
const DEFAULT_MODE = "format";
const DEFAULT_INDENT = "2";
const DEBOUNCE_MILLISECONDS = 150;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
// Solo se recuerda el texto de entrada si es corto: el código grande no tiene por qué quedarse guardado en el equipo
const MAX_SAVED_TEXT_BYTES = 200 * 1024;
const COPIED_MILLISECONDS = 2000;
const ANNOUNCE_DELAY_MILLISECONDS = 50;
// Se espera un momento antes de soltar el archivo temporal, para que el navegador alcance a descargarlo
const REVOKE_URL_DELAY_MILLISECONDS = 1000;
// Un cuadro de texto con cientos de miles de líneas tarda varios segundos en dibujarse (unos 3 segundos con 130.000
// líneas), así que un resultado más largo que esto no se muestra, solo se avisa
const MAX_DISPLAYED_LINES = 20000;
const BYTES_PER_KILOBYTE = 1024;
const INDENTS = { 2: "  ", 4: "    ", tab: "\t" };
const LANGUAGE_NAMES = { css: "CSS", html: "HTML", sql: "SQL", text: "Texto" };
// El archivo que se descarga lleva la extensión del lenguaje
const DOWNLOAD_FILES = {
  css: { name: "resultado.css", type: "text/css" },
  html: { name: "resultado.html", type: "text/html" },
  sql: { name: "resultado.sql", type: "application/sql" },
  text: { name: "resultado.txt", type: "text/plain" },
};

const dom = {
  input: document.getElementById("code_input"),
  output: document.getElementById("code_output"),
  tabs: [...document.querySelectorAll(".tab")],
  tab_list: document.querySelector(".tabs"),
  output_panel: document.getElementById("output_panel"),
  language_select: document.getElementById("language_select"),
  indent_select: document.getElementById("indent_select"),
  uppercase_option: document.getElementById("uppercase_option"),
  uppercase_keywords: document.getElementById("uppercase_keywords"),
  status_ready: document.getElementById("status_ready"),
  status_ready_text: document.getElementById("status_ready_text"),
  status_warning: document.getElementById("status_warning"),
  status_warning_text: document.getElementById("status_warning_text"),
  go_to_line_button: document.getElementById("go_to_line_button"),
  clear_button: document.getElementById("clear_button"),
  stats: document.getElementById("code_stats"),
  copy_button: document.getElementById("copy_button"),
  copy_label: document.getElementById("copy_label"),
  download_button: document.getElementById("download_button"),
  live_status: document.getElementById("live_status"),
};

// Qué modo eligió la persona (el que se ve puede ser otro: con Texto solo existe Formateado)
let chosen_mode = DEFAULT_MODE;
// La línea de la entrada a la que lleva el aviso que se muestra (null si no hay aviso o no hay línea a la que ir)
let warning_line = null;
let debounce_timer = 0;
// El resultado completo y su lenguaje, que es lo que se copia y se descarga. El cuadro puede mostrar un aviso en su
// lugar si es enorme.
let result_text = "";
let result_language = "text";
// El último lenguaje con el que se formateó (null mientras no haya habido ninguno): el fondo hace su destello cuando cambia
let last_language = null;

// ---------------------------------------------------------------------------
// Números y tamaños
// ---------------------------------------------------------------------------

// Puntos para los miles, como en Colombia: 1250 → "1.250". Se arma a mano para no depender del idioma del navegador.
function format_count(count) {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// "850 B", "1,2 KB", "3,4 MB"
function format_size(bytes) {
  if (bytes < BYTES_PER_KILOBYTE) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / BYTES_PER_KILOBYTE;
  let unit_index = 0;
  while (value >= BYTES_PER_KILOBYTE && unit_index < units.length - 1) {
    value /= BYTES_PER_KILOBYTE;
    unit_index += 1;
  }
  return `${value.toFixed(1).replace(".", ",")} ${units[unit_index]}`;
}

function byte_length(text) {
  return new TextEncoder().encode(text).length;
}

// ---------------------------------------------------------------------------
// Cuadros de texto
// ---------------------------------------------------------------------------

// El cuadro crece con su contenido; el máximo lo pone el CSS y, pasado ese alto, el contenido se desplaza por dentro.
function fit_height(textarea) {
  textarea.style.height = "auto";
  const borders = textarea.offsetHeight - textarea.clientHeight;
  textarea.style.height = `${textarea.scrollHeight + borders}px`;
}

// Alto, en píxeles desde el borde de arriba del contenido, al que queda una posición del texto. Se mide dibujando el
// mismo texto, con la misma letra y el mismo ancho, en un bloque fuera de pantalla, porque las líneas largas se parten y
// por eso contar líneas no basta.
function measure_offset_top(textarea, offset) {
  const style = getComputedStyle(textarea);
  const mirror = document.createElement("div");
  ["fontFamily", "fontSize", "lineHeight", "letterSpacing", "tabSize", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "boxSizing"].forEach((property) => {
    mirror.style[property] = style[property];
  });
  mirror.style.width = `${textarea.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`;
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.textContent = textarea.value.slice(0, offset);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.append(marker);
  document.body.append(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}

// Posición del texto donde empieza una línea (contada desde 1)
function line_start_offset(text, line) {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf("\n", offset);
    if (next === -1) break;
    offset = next + 1;
  }
  return offset;
}

// Pone el cursor al inicio de una línea del texto de entrada y la deja a la vista
function go_to_line(line) {
  const offset = line_start_offset(dom.input.value, line);
  dom.input.focus();
  dom.input.setSelectionRange(offset, offset);
  const top = measure_offset_top(dom.input, offset);
  dom.input.scrollTop = Math.max(0, top - dom.input.clientHeight / 2);
  // Si el cuadro es más alto que lo que se ve de la página, también se desplaza la página hasta el cursor
  const line_height = parseFloat(getComputedStyle(dom.input).lineHeight);
  const box = dom.input.getBoundingClientRect();
  const caret_y = box.top + top - dom.input.scrollTop;
  if (caret_y < 0 || caret_y + line_height > window.innerHeight) window.scrollBy({ top: caret_y - window.innerHeight / 2 });
}

// ---------------------------------------------------------------------------
// Memoria de los últimos valores
// ---------------------------------------------------------------------------

// Acepta solo valores válidos de lo guardado: si alguien lo editó a mano, se usan los iniciales campo por campo.
function load_state() {
  const state = { language: DEFAULT_LANGUAGE, mode: DEFAULT_MODE, indent: DEFAULT_INDENT, uppercase_keywords: true, text: "" };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if ([...dom.language_select.options].some((option) => option.value === stored?.language)) state.language = stored.language;
    if (dom.tabs.some((tab) => tab.dataset.mode === stored?.mode)) state.mode = stored.mode;
    if (typeof stored?.indent === "string" && Object.keys(INDENTS).includes(stored.indent)) state.indent = stored.indent;
    if (stored?.uppercase_keywords === false) state.uppercase_keywords = false;
    if (typeof stored?.text === "string" && stored.text.length <= MAX_SAVED_TEXT_BYTES && byte_length(stored.text) <= MAX_SAVED_TEXT_BYTES) state.text = stored.text;
  } catch {
    // Sin almacenamiento, o con datos dañados, se usan los valores iniciales.
  }
  return state;
}

// El almacenamiento puede fallar (modo privado, bloqueado): la página funciona igual, solo que sin recordar nada.
function save_state() {
  const text = dom.input.value;
  const is_short = text.length <= MAX_SAVED_TEXT_BYTES && byte_length(text) <= MAX_SAVED_TEXT_BYTES;
  const state = {
    language: dom.language_select.value,
    mode: chosen_mode,
    indent: dom.indent_select.value,
    uppercase_keywords: dom.uppercase_keywords.checked,
    text: is_short ? text : "",
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Sin almacenamiento los valores solo duran mientras la página está abierta.
  }
}

// ---------------------------------------------------------------------------
// Avisos para lectores de pantalla, copiar y descargar
// ---------------------------------------------------------------------------

// Lo que se avisa a lectores de pantalla, con un momento de pausa para que se vuelva a leer aunque el texto sea igual
// al anterior
function announce(message) {
  dom.live_status.textContent = "";
  setTimeout(() => (dom.live_status.textContent = message), ANNOUNCE_DELAY_MILLISECONDS);
}

const copy_icon = dom.copy_button.querySelector("i");
let copy_timer = 0;

// Vuelve el botón de copiar a su estado normal; se llama cuando cambia el resultado
function reset_copy() {
  clearTimeout(copy_timer);
  dom.copy_label.textContent = "Copiar";
  copy_icon.className = "fa-regular fa-copy";
}

function show_copy_state(label_text, icon_class, status) {
  dom.copy_label.textContent = label_text;
  copy_icon.className = icon_class;
  announce(status);
  clearTimeout(copy_timer);
  copy_timer = setTimeout(reset_copy, COPIED_MILLISECONDS);
}

async function handle_copy() {
  try {
    await navigator.clipboard.writeText(result_text);
    show_copy_state("Copiado", "fa-solid fa-check", "Resultado copiado al portapapeles.");
    flash_scene();
  } catch {
    // El navegador no deja copiar (por ejemplo, página sin https): se deja seleccionado para copiarlo a mano. Si el
    // cuadro mostraba un aviso en vez de un resultado enorme, ahora se muestra completo para poder seleccionarlo.
    if (dom.output.value !== result_text) {
      dom.output.value = result_text;
      fit_height(dom.output);
    }
    dom.output.focus();
    dom.output.select();
    show_copy_state("Copia a mano", "fa-regular fa-copy", "No se pudo copiar solo. Quedó seleccionado: cópialo con Ctrl y C, o mantén pulsado sobre él.");
  }
}

function handle_download() {
  const { name, type } = DOWNLOAD_FILES[result_language];
  const url = URL.createObjectURL(new Blob([result_text], { type: `${type};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_URL_DELAY_MILLISECONDS);
  announce(`Descargado como ${name}.`);
}

// ---------------------------------------------------------------------------
// Estado y resultado
// ---------------------------------------------------------------------------

function count_lines(text) {
  let lines = 1;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) lines += 1;
  return lines;
}

function hide_status() {
  dom.status_ready.hidden = true;
  dom.status_warning.hidden = true;
  warning_line = null;
}

// line es la línea de la entrada a la que lleva el botón, o null si el aviso no tiene una línea a la que ir
function show_warning(message, line) {
  hide_status();
  dom.status_warning_text.textContent = `Aviso: ${message}`;
  dom.go_to_line_button.hidden = line === null;
  dom.status_warning.hidden = false;
  warning_line = line;
}

function show_ready(language) {
  hide_status();
  dom.status_ready_text.textContent = `Listo · ${LANGUAGE_NAMES[language]}`;
  dom.status_ready.hidden = false;
}

// Sin resultado (entrada vacía o demasiado grande): el cuadro, las estadísticas y los botones quedan vacíos o desactivados
function clear_result() {
  result_text = "";
  dom.output.value = "";
  fit_height(dom.output);
  dom.stats.hidden = true;
  dom.copy_button.disabled = true;
  dom.download_button.disabled = true;
  reset_copy();
}

// "CSS · Entrada 1,2 KB · Salida 1,6 KB · 48 líneas"
function show_result(result, language, input_bytes) {
  result_text = result;
  result_language = language;
  const lines = count_lines(result);
  dom.output.value = lines > MAX_DISPLAYED_LINES ? `Este resultado tiene ${format_count(lines)} líneas, demasiadas para mostrarlas aquí sin frenar la página. Cópialo o descárgalo completo, o prueba el modo Minificado.` : result;
  fit_height(dom.output);
  dom.stats.textContent = [LANGUAGE_NAMES[language], `Entrada ${format_size(input_bytes)}`, `Salida ${format_size(byte_length(result))}`, `${format_count(lines)} ${lines === 1 ? "línea" : "líneas"}`].join(" · ");
  dom.stats.hidden = false;
  dom.copy_button.disabled = false;
  dom.download_button.disabled = false;
  reset_copy();
}

// El fondo destella cuando cambia el lenguaje con el que se formatea
function note_language(language) {
  if (last_language !== null && last_language !== language) flash_scene();
  last_language = language;
}

// El lenguaje con el que se formatea. Con la entrada vacía y "Detectar" todavía no hay lenguaje (null).
function resolve_language(text) {
  const chosen = dom.language_select.value;
  if (chosen === "auto" && text.trim() === "") return null;
  return chosen === "auto" ? detect_language(text) : chosen;
}

// Qué pestaña se ve activa y qué queda desactivado: con Texto no hay Minificado, y en Minificado no hay sangría.
// La casilla de mayúsculas solo existe con SQL.
function render_options(language) {
  const mode = language === "text" ? DEFAULT_MODE : chosen_mode;
  dom.tabs.forEach((tab) => {
    const is_active = tab.dataset.mode === mode;
    tab.setAttribute("aria-selected", String(is_active));
    // Solo la pestaña activa entra en el orden de Tab; con las flechas se pasa a la otra.
    tab.tabIndex = is_active ? 0 : -1;
    if (is_active) dom.output_panel.setAttribute("aria-labelledby", tab.id);
    if (tab.dataset.mode === "minify") tab.disabled = language === "text";
  });
  dom.indent_select.disabled = mode === "minify";
  dom.uppercase_option.hidden = language !== "sql";
  return mode;
}

// "Detectar (CSS)": la lista dice qué se detectó, aunque se haya elegido otro lenguaje a mano
function render_detected_label(text) {
  const option = dom.language_select.querySelector('option[value="auto"]');
  option.textContent = text.trim() === "" ? "Detectar" : `Detectar (${LANGUAGE_NAMES[detect_language(text)]})`;
}

// Recalcula el resultado y el estado con lo que hay en pantalla
function update() {
  clearTimeout(debounce_timer);
  const text = dom.input.value;
  dom.clear_button.disabled = text === "";
  save_state();

  // Un texto de más de 2 MB no se procesa, para que el celular no se congele. Primero se compara el número de
  // caracteres, que es barato y nunca pasa de los bytes, y solo si cabe se cuentan los bytes de verdad.
  const bytes = text.length > MAX_INPUT_BYTES ? Infinity : byte_length(text);
  if (bytes > MAX_INPUT_BYTES) {
    clear_result();
    render_options(null);
    show_warning(`la entrada pesa más de ${format_size(MAX_INPUT_BYTES)}, que es lo máximo que se procesa. Prueba con una parte.`, null);
    return;
  }

  const language = resolve_language(text);
  const mode = render_options(language);
  render_detected_label(text);
  if (text.trim() === "") {
    clear_result();
    hide_status();
    return;
  }

  note_language(language);
  const options = { mode, indent: INDENTS[dom.indent_select.value], uppercase_keywords: dom.uppercase_keywords.checked };
  const { text: result, warning } = format_code(text, language, options);
  show_result(result, language, bytes);
  if (warning) show_warning(warning.message, warning.line);
  else show_ready(language);
}

// Mientras se escribe, se espera un momento antes de recalcular para no trabajar con cada tecla
function schedule_update() {
  fit_height(dom.input);
  dom.clear_button.disabled = dom.input.value === "";
  // El lenguaje elegido a mano se recuerda mientras la entrada no se vacíe; al vaciarla se vuelve a Detectar
  if (dom.input.value === "") dom.language_select.value = DEFAULT_LANGUAGE;
  clearTimeout(debounce_timer);
  debounce_timer = setTimeout(update, DEBOUNCE_MILLISECONDS);
}

// Vacía la entrada y todo lo que depende de ella, también de lo recordado, y deja el cursor listo para pegar otra cosa
function handle_clear() {
  dom.input.value = "";
  dom.language_select.value = DEFAULT_LANGUAGE;
  fit_height(dom.input);
  update();
  dom.input.focus();
  announce("Entrada vaciada.");
}

// ---------------------------------------------------------------------------
// Modo
// ---------------------------------------------------------------------------

function select_mode(mode_key) {
  chosen_mode = mode_key;
  update();
}

function handle_tab_keydown(event) {
  const enabled_tabs = dom.tabs.filter((tab) => !tab.disabled);
  const current_index = enabled_tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
  const last_index = enabled_tabs.length - 1;
  const next_index = {
    ArrowRight: current_index === last_index ? 0 : current_index + 1,
    ArrowLeft: current_index === 0 ? last_index : current_index - 1,
    Home: 0,
    End: last_index,
  }[event.key];
  if (next_index === undefined) return;
  event.preventDefault();
  select_mode(enabled_tabs[next_index].dataset.mode);
  enabled_tabs[next_index].focus();
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

function setup_events() {
  dom.input.addEventListener("input", schedule_update);
  dom.language_select.addEventListener("change", update);
  dom.indent_select.addEventListener("change", update);
  dom.uppercase_keywords.addEventListener("change", update);
  dom.tabs.forEach((tab) => tab.addEventListener("click", () => select_mode(tab.dataset.mode)));
  dom.tab_list.addEventListener("keydown", handle_tab_keydown);
  dom.go_to_line_button.addEventListener("click", () => {
    if (warning_line !== null) go_to_line(warning_line);
  });
  dom.clear_button.addEventListener("click", handle_clear);
  dom.copy_button.addEventListener("click", handle_copy);
  dom.download_button.addEventListener("click", handle_download);
  // Al cambiar el ancho de la pantalla las líneas se parten distinto, así que el alto se ajusta de nuevo
  window.addEventListener("resize", () => {
    fit_height(dom.input);
    fit_height(dom.output);
  });
}

const saved_state = load_state();
dom.input.value = saved_state.text;
dom.language_select.value = saved_state.language;
dom.indent_select.value = saved_state.indent;
dom.uppercase_keywords.checked = saved_state.uppercase_keywords;
chosen_mode = saved_state.mode;
setup_events();
update();
fit_height(dom.input);
// El fondo es decorativo: se prepara sin esperar y el formateador ya funciona mientras carga.
start_scene(document.getElementById("scene_canvas"));
