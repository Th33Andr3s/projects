// Formateador de JSON: entrada, opciones, resultado en vivo, estado (válido o el error con su línea y columna),
// estadísticas, copiar, descargar y la memoria de los últimos valores. El análisis, la escritura y las estadísticas
// viven en json_tools.js.
import { start_scene, flash_scene } from "./animations.js";
import { byte_length, compute_stats, format_count, format_size, parse_json, write_json } from "./json_tools.js";

const STORAGE_KEY = "json_formatter_last";
const DEFAULT_MODE = "format";
const DEFAULT_INDENT = "2";
const DEBOUNCE_MILLISECONDS = 150;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
// Solo se recuerda el texto de entrada si es corto: los datos grandes no tienen por qué quedarse guardados en el equipo
const MAX_SAVED_TEXT_BYTES = 200 * 1024;
// Un cuadro de texto con cientos de miles de líneas tarda varios segundos en dibujarse (unos 3 segundos con 130.000
// líneas), así que un resultado más largo que esto no se muestra, solo se avisa
const MAX_DISPLAYED_LINES = 20000;
const COPIED_MILLISECONDS = 2000;
const ANNOUNCE_DELAY_MILLISECONDS = 50;
const DOWNLOAD_FILE_NAME = "resultado.json";
// Se espera un momento antes de soltar el archivo temporal, para que el navegador alcance a descargarlo
const REVOKE_URL_DELAY_MILLISECONDS = 1000;
const INDENTS = { 2: "  ", 4: "    ", tab: "\t" };

const dom = {
  input: document.getElementById("json_input"),
  output: document.getElementById("json_output"),
  tabs: [...document.querySelectorAll(".tab")],
  tab_list: document.querySelector(".tabs"),
  output_panel: document.getElementById("output_panel"),
  indent_select: document.getElementById("indent_select"),
  sort_keys: document.getElementById("sort_keys"),
  status_valid: document.getElementById("status_valid"),
  status_valid_text: document.getElementById("status_valid_text"),
  status_error: document.getElementById("status_error"),
  status_error_text: document.getElementById("status_error_text"),
  go_to_error_button: document.getElementById("go_to_error_button"),
  clear_button: document.getElementById("clear_button"),
  stats: document.getElementById("json_stats"),
  copy_button: document.getElementById("copy_button"),
  copy_label: document.getElementById("copy_label"),
  download_button: document.getElementById("download_button"),
  live_status: document.getElementById("live_status"),
};

// Dónde está el error que se muestra, para que "Ir al error" ponga el cursor ahí (null si no hay o no se puede ir)
let error_location = null;
let debounce_timer = 0;
// El resultado completo, que es lo que se copia y se descarga. El cuadro puede mostrar un aviso en su lugar si es enorme.
let result_text = "";
// Si lo último que se vio fue un JSON válido o uno con error (null mientras no se haya visto ninguno): el fondo hace su
// destello cuando pasa de una cosa a la otra
let last_validity = null;

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

// Pone el cursor (con el carácter del error seleccionado) en una posición del texto de entrada y la deja a la vista
function go_to_offset(offset) {
  const text = dom.input.value;
  dom.input.focus();
  dom.input.setSelectionRange(offset, Math.min(offset + 1, text.length));
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

function get_mode() {
  const active_tab = dom.tabs.find((tab) => tab.getAttribute("aria-selected") === "true");
  return active_tab ? active_tab.dataset.mode : DEFAULT_MODE;
}

// Acepta solo valores válidos de lo guardado: si alguien lo editó a mano, se usan los iniciales campo por campo.
function load_state() {
  const state = { mode: DEFAULT_MODE, indent: DEFAULT_INDENT, sort_keys: false, text: "" };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (dom.tabs.some((tab) => tab.dataset.mode === stored?.mode)) state.mode = stored.mode;
    if (typeof stored?.indent === "string" && Object.keys(INDENTS).includes(stored.indent)) state.indent = stored.indent;
    if (stored?.sort_keys === true) state.sort_keys = true;
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
  const state = { mode: get_mode(), indent: dom.indent_select.value, sort_keys: dom.sort_keys.checked, text: is_short ? text : "" };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Sin almacenamiento los valores solo duran mientras la página está abierta.
  }
}

// ---------------------------------------------------------------------------
// Avisos para lectores de pantalla y copiar
// ---------------------------------------------------------------------------

// Lo que se avisa a lectores de pantalla, con un momento de pausa para que se vuelva a leer aunque el texto sea igual
// al anterior
function announce(message) {
  dom.live_status.textContent = "";
  setTimeout(() => (dom.live_status.textContent = message), ANNOUNCE_DELAY_MILLISECONDS);
}

// Conecta el botón de copiar. get_text devuelve lo que se copia; si el navegador no deja copiar, select_fallback deja
// el resultado seleccionado para copiarlo a mano. Devuelve la función que vuelve el botón a su estado normal, para
// llamarla cuando cambia el resultado.
function setup_copy({ button, label, idle_label, get_text, select_fallback }) {
  const icon = button.querySelector("i");
  let timer = 0;

  function reset() {
    clearTimeout(timer);
    label.textContent = idle_label;
    icon.className = "fa-regular fa-copy";
  }

  function show(label_text, icon_class, status) {
    label.textContent = label_text;
    icon.className = icon_class;
    announce(status);
    clearTimeout(timer);
    timer = setTimeout(reset, COPIED_MILLISECONDS);
  }

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(get_text());
      show("Copiado", "fa-solid fa-check", "Resultado copiado al portapapeles.");
      flash_scene();
    } catch {
      // El navegador no deja copiar (por ejemplo, página sin https): se deja seleccionado para copiarlo a mano.
      select_fallback();
      show("Copia a mano", "fa-regular fa-copy", "No se pudo copiar solo. Quedó seleccionado: cópialo con Ctrl y C, o mantén pulsado sobre él.");
    }
  });
  return reset;
}

const reset_copy = setup_copy({
  button: dom.copy_button,
  label: dom.copy_label,
  idle_label: "Copiar",
  get_text: () => result_text,
  select_fallback: () => {
    // Si el cuadro mostraba un aviso en vez de un resultado enorme, ahora se muestra completo para poder seleccionarlo
    if (dom.output.value !== result_text) {
      dom.output.value = result_text;
      fit_height(dom.output);
    }
    dom.output.focus();
    dom.output.select();
  },
});

function handle_download() {
  const file = new Blob([result_text], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = DOWNLOAD_FILE_NAME;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_URL_DELAY_MILLISECONDS);
  announce(`Descargado como ${DOWNLOAD_FILE_NAME}.`);
}

// ---------------------------------------------------------------------------
// Estado y resultado
// ---------------------------------------------------------------------------

function lower_first(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// "3 claves" / "1 clave"
function count_text(count, singular, plural) {
  return `${format_count(count)} ${count === 1 ? singular : plural}`;
}

function hide_status() {
  dom.status_valid.hidden = true;
  dom.status_error.hidden = true;
  dom.input.setAttribute("aria-invalid", "false");
  error_location = null;
}

// offset es el punto del texto de entrada donde está el error, o null si no hay un punto al que ir (por ejemplo, si el texto es demasiado grande)
function show_error(message, offset) {
  hide_status();
  dom.status_error_text.textContent = message;
  dom.go_to_error_button.hidden = offset === null;
  dom.status_error.hidden = false;
  dom.input.setAttribute("aria-invalid", "true");
  error_location = offset;
}

// "JSON válido · 2 claves · 27 B": cuántas claves (o, si no hay objetos, cuántos elementos) y cuánto pesa
function show_valid(stats, bytes) {
  hide_status();
  const parts = ["JSON válido"];
  if (stats.keys > 0) parts.push(count_text(stats.keys, "clave", "claves"));
  else if (stats.items > 0) parts.push(count_text(stats.items, "elemento", "elementos"));
  parts.push(format_size(bytes));
  dom.status_valid_text.textContent = parts.join(" · ");
  dom.status_valid.hidden = false;
}

function count_lines(text) {
  let lines = 1;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) lines += 1;
  return lines;
}

// Sin resultado (entrada vacía o con error): el cuadro, las estadísticas y los botones quedan vacíos o desactivados
function clear_result() {
  result_text = "";
  dom.output.value = "";
  fit_height(dom.output);
  dom.stats.hidden = true;
  dom.copy_button.disabled = true;
  dom.download_button.disabled = true;
  reset_copy();
}

function show_result(result, stats, input_bytes) {
  result_text = result;
  const lines = count_lines(result);
  dom.output.value = lines > MAX_DISPLAYED_LINES ? `Este resultado tiene ${format_count(lines)} líneas, demasiadas para mostrarlas aquí sin frenar la página. Cópialo o descárgalo completo, o prueba el modo Minificado.` : result;
  fit_height(dom.output);
  dom.stats.textContent = [
    `Entrada ${format_size(input_bytes)}`,
    `Salida ${format_size(byte_length(result))}`,
    count_text(lines, "línea", "líneas"),
    count_text(stats.keys, "clave", "claves"),
    count_text(stats.items, "elemento", "elementos"),
    `profundidad ${format_count(stats.depth)}`,
  ].join(" · ");
  dom.stats.hidden = false;
  dom.copy_button.disabled = false;
  dom.download_button.disabled = false;
  reset_copy();
}

// El fondo destella cuando el texto pasa de ser un JSON válido a uno con error, o al revés
function note_validity(validity) {
  if (last_validity !== null && last_validity !== validity) flash_scene();
  last_validity = validity;
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
    note_validity("invalid");
    show_error(`La entrada pesa más de ${format_size(MAX_INPUT_BYTES)}, que es lo máximo que se procesa. Prueba con una parte.`, null);
    return;
  }

  const parsed = parse_json(text);
  if (parsed.empty) {
    clear_result();
    hide_status();
    return;
  }
  if (parsed.error) {
    clear_result();
    note_validity("invalid");
    const { line, column, message, offset } = parsed.error;
    show_error(`Línea ${format_count(line)}, columna ${format_count(column)}: ${lower_first(message)}`, offset);
    return;
  }

  note_validity("valid");
  const stats = compute_stats(parsed.tree);
  show_result(write_json(parsed.tree, { mode: get_mode(), indent: INDENTS[dom.indent_select.value], sort_keys: dom.sort_keys.checked }), stats, bytes);
  show_valid(stats, bytes);
}

// Mientras se escribe, se espera un momento antes de recalcular para no trabajar con cada tecla
function schedule_update() {
  fit_height(dom.input);
  dom.clear_button.disabled = dom.input.value === "";
  clearTimeout(debounce_timer);
  debounce_timer = setTimeout(update, DEBOUNCE_MILLISECONDS);
}

// Vacía la entrada y todo lo que depende de ella, también de lo recordado, y deja el cursor listo para pegar otra cosa
function handle_clear() {
  dom.input.value = "";
  fit_height(dom.input);
  update();
  dom.input.focus();
  announce("Entrada vaciada.");
}

// ---------------------------------------------------------------------------
// Modo
// ---------------------------------------------------------------------------

function select_mode(mode_key) {
  dom.tabs.forEach((tab) => {
    const is_active = tab.dataset.mode === mode_key;
    tab.setAttribute("aria-selected", String(is_active));
    // Solo la pestaña activa entra en el orden de Tab; con las flechas se pasa a la otra.
    tab.tabIndex = is_active ? 0 : -1;
    if (is_active) dom.output_panel.setAttribute("aria-labelledby", tab.id);
  });
  // La sangría solo cuenta en el modo formateado
  dom.indent_select.disabled = mode_key === "minify";
  update();
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
  select_mode(dom.tabs[next_index].dataset.mode);
  dom.tabs[next_index].focus();
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

function setup_events() {
  dom.input.addEventListener("input", schedule_update);
  dom.indent_select.addEventListener("change", update);
  dom.sort_keys.addEventListener("change", update);
  dom.tabs.forEach((tab) => tab.addEventListener("click", () => select_mode(tab.dataset.mode)));
  dom.tab_list.addEventListener("keydown", handle_tab_keydown);
  dom.go_to_error_button.addEventListener("click", () => {
    if (error_location !== null) go_to_offset(error_location);
  });
  dom.clear_button.addEventListener("click", handle_clear);
  dom.download_button.addEventListener("click", handle_download);
  // Al cambiar el ancho de la pantalla las líneas se parten distinto, así que el alto se ajusta de nuevo
  window.addEventListener("resize", () => {
    fit_height(dom.input);
    fit_height(dom.output);
  });
}

const saved_state = load_state();
dom.input.value = saved_state.text;
dom.indent_select.value = saved_state.indent;
dom.sort_keys.checked = saved_state.sort_keys;
setup_events();
select_mode(saved_state.mode);
fit_height(dom.input);
// El fondo es decorativo: se prepara sin esperar y el formateador ya funciona mientras carga.
start_scene(document.getElementById("scene_canvas"));
