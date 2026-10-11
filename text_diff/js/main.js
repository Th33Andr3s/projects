// Comparador de textos: entradas, opciones, estado en vivo, tabla de diferencias en dos vistas, navegación entre
// cambios, copiar, descargar y la memoria de los últimos valores. La comparación vive en diff_tools.js.
import { start_scene, flash_scene } from "./animations.js";
import { build_unified_diff, compare_texts, fold_rows } from "./diff_tools.js";

const STORAGE_KEY = "text_diff_last";
const DEBOUNCE_MILLISECONDS = 200;
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_INPUT_LINES = 20000;
// Una tabla con decenas de miles de renglones tarda en dibujarse y frena el celular: más allá de este tope se avisa, y
// Copiar y Descargar entregan el resultado completo
const MAX_DRAWN_ITEMS = 5000;
// Solo se recuerdan los textos si son cortos: no tienen por qué quedarse guardados en el equipo
const MAX_SAVED_TEXT_BYTES = 200 * 1024;
const BYTES_PER_KILOBYTE = 1024;
const COPIED_MILLISECONDS = 2000;
const ANNOUNCE_DELAY_MILLISECONDS = 50;
const DOWNLOAD_FILE_NAME = "diferencias.diff";
// Se espera un momento antes de soltar el archivo temporal, para que el navegador alcance a descargarlo
const REVOKE_URL_DELAY_MILLISECONDS = 1000;
// En pantallas más angostas que esto, la primera vez se abre la vista Unificada, que se lee mejor
const NARROW_SCREEN_WIDTH = 700;
const VIEWS = ["unified", "split"];
const MINUS_SIGN = "−";
const EMPTY_LINE_MARK = "​";
const EQUALITY_MESSAGES = {
  exact: "Los dos textos son iguales",
  newline: "Los dos textos son iguales salvo el salto de línea final",
  spaces: "Los dos textos son iguales salvo espacios",
  case: "Los dos textos son iguales salvo mayúsculas",
  spaces_and_case: "Los dos textos son iguales salvo espacios y mayúsculas",
};

const dom = {
  before: document.getElementById("before_input"),
  after: document.getElementById("after_input"),
  before_file: document.getElementById("before_file"),
  after_file: document.getElementById("after_file"),
  before_file_button: document.getElementById("before_file_button"),
  after_file_button: document.getElementById("after_file_button"),
  swap_button: document.getElementById("swap_button"),
  clear_button: document.getElementById("clear_button"),
  status_same: document.getElementById("status_same"),
  status_same_text: document.getElementById("status_same_text"),
  status_changes: document.getElementById("status_changes"),
  status_changes_text: document.getElementById("status_changes_text"),
  status_warning: document.getElementById("status_warning"),
  status_warning_text: document.getElementById("status_warning_text"),
  tabs: [...document.querySelectorAll(".tab")],
  tab_list: document.querySelector(".tabs"),
  result_panel: document.getElementById("result_panel"),
  only_changes: document.getElementById("only_changes"),
  ignore_spaces: document.getElementById("ignore_spaces"),
  ignore_case: document.getElementById("ignore_case"),
  previous_button: document.getElementById("previous_button"),
  next_button: document.getElementById("next_button"),
  change_counter: document.getElementById("change_counter"),
  placeholder: document.getElementById("diff_placeholder"),
  scroll: document.getElementById("diff_scroll"),
  table: document.getElementById("diff_table"),
  table_notice: document.getElementById("table_notice"),
  copy_fallback: document.getElementById("copy_fallback"),
  copy_fallback_text: document.getElementById("copy_fallback_text"),
  copy_button: document.getElementById("copy_button"),
  copy_label: document.getElementById("copy_label"),
  download_button: document.getElementById("download_button"),
  live_status: document.getElementById("live_status"),
};

let current_view = "unified";
let debounce_timer = 0;
// La última comparación, o null si no hay nada que comparar
let result = null;
// Los pliegues de "Solo cambios" que la persona abrió (por la posición de su primer renglón)
let expanded_folds = new Set();
// Los renglones de la tabla de cada cambio dibujado (change_rows[0] es el cambio 1) y cuál está marcado (0 = ninguno)
let change_rows = [];
let current_change = 0;
// Si el último resultado fue "iguales" o "distintos" (null mientras no haya habido ninguno): el fondo hace su destello
// cuando pasa de una cosa a la otra
let last_equality = null;

// ---------------------------------------------------------------------------
// Números y tamaños
// ---------------------------------------------------------------------------

// Puntos para los miles, como en Colombia: 1250 → "1.250". Se arma a mano para no depender del idioma del navegador.
function format_count(count) {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// "850 B", "1,2 KB", "1,0 MB"
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

// "3 cambios" / "1 cambio"
function count_text(count, singular, plural) {
  return `${format_count(count)} ${count === 1 ? singular : plural}`;
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

// ---------------------------------------------------------------------------
// Memoria de los últimos valores
// ---------------------------------------------------------------------------

function is_short(text) {
  return text.length <= MAX_SAVED_TEXT_BYTES && byte_length(text) <= MAX_SAVED_TEXT_BYTES;
}

// Acepta solo valores válidos de lo guardado: si alguien lo editó a mano, se usan los iniciales campo por campo.
function load_state() {
  const state = {
    view: window.innerWidth < NARROW_SCREEN_WIDTH ? "unified" : "split",
    only_changes: false,
    ignore_spaces: false,
    ignore_case: false,
    before: "",
    after: "",
  };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (VIEWS.includes(stored?.view)) state.view = stored.view;
    ["only_changes", "ignore_spaces", "ignore_case"].forEach((key) => {
      if (stored?.[key] === true) state[key] = true;
    });
    ["before", "after"].forEach((key) => {
      if (typeof stored?.[key] === "string" && is_short(stored[key])) state[key] = stored[key];
    });
  } catch {
    // Sin almacenamiento, o con datos dañados, se usan los valores iniciales.
  }
  return state;
}

// El almacenamiento puede fallar (modo privado, bloqueado): la página funciona igual, solo que sin recordar nada.
function save_state() {
  const state = {
    view: current_view,
    only_changes: dom.only_changes.checked,
    ignore_spaces: dom.ignore_spaces.checked,
    ignore_case: dom.ignore_case.checked,
    before: is_short(dom.before.value) ? dom.before.value : "",
    after: is_short(dom.after.value) ? dom.after.value : "",
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
  const diff_text = build_unified_diff(result);
  try {
    await navigator.clipboard.writeText(diff_text);
    show_copy_state("Copiado", "fa-solid fa-check", "Diff copiado al portapapeles.");
    flash_scene();
  } catch {
    // El navegador no deja copiar (por ejemplo, página sin https): se muestra el diff seleccionado para copiarlo a mano
    dom.copy_fallback_text.value = diff_text;
    dom.copy_fallback.hidden = false;
    dom.copy_fallback_text.focus();
    dom.copy_fallback_text.select();
    show_copy_state("Copia a mano", "fa-regular fa-copy", "No se pudo copiar solo. El diff quedó seleccionado en un cuadro: cópialo con Ctrl y C, o mantén pulsado sobre él.");
  }
}

function handle_download() {
  const url = URL.createObjectURL(new Blob([build_unified_diff(result)], { type: "text/plain;charset=utf-8" }));
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
// Estado en vivo
// ---------------------------------------------------------------------------

function hide_status() {
  dom.status_same.hidden = true;
  dom.status_changes.hidden = true;
  dom.status_warning.hidden = true;
}

function show_warning(message) {
  dom.status_warning_text.textContent = `Aviso: ${message}`;
  dom.status_warning.hidden = false;
}

function show_status(comparison) {
  hide_status();
  if (comparison.equality) {
    dom.status_same_text.textContent = EQUALITY_MESSAGES[comparison.equality];
    dom.status_same.hidden = false;
    return;
  }
  const { changes, added, removed, equal } = comparison.stats;
  dom.status_changes_text.textContent = [
    count_text(changes, "cambio", "cambios"),
    `+${count_text(added, "línea", "líneas")}`,
    `${MINUS_SIGN}${count_text(removed, "línea", "líneas")}`,
    `${format_count(equal)} ${equal === 1 ? "igual" : "iguales"}`,
  ].join(" · ");
  dom.status_changes.hidden = false;
  if (comparison.truncated) show_warning("los textos son tan distintos que no se alinearon línea por línea; se muestran como un bloque quitado y otro agregado.");
}

// ---------------------------------------------------------------------------
// Tabla de diferencias
// ---------------------------------------------------------------------------

function make_element(tag, class_name, text) {
  const element = document.createElement(tag);
  if (class_name) element.className = class_name;
  if (text !== undefined) element.textContent = text;
  return element;
}

function line_text(text) {
  return text === "" ? EMPTY_LINE_MARK : text;
}

function number_cell(number, kind) {
  return make_element("td", `num cell_${kind}`, number === undefined ? "" : String(number));
}

// El signo se ve (− o +) pero no se lee en voz alta; para lectores de pantalla va un texto: "quitada" o "agregada", con el
// número de cambio en la primera línea de cada uno
function sign_cell(kind, change_number) {
  const cell = make_element("td", `sign cell_${kind}`);
  if (kind === "removed" || kind === "added") {
    const visible = make_element("span", "", kind === "removed" ? MINUS_SIGN : "+");
    visible.setAttribute("aria-hidden", "true");
    const spoken = (change_number ? `Cambio ${change_number}, ` : "") + (kind === "removed" ? "quitada" : "agregada");
    cell.append(visible, make_element("span", "visually_hidden", spoken));
  }
  return cell;
}

// La línea con sus palabras distintas marcadas en <del> (quitadas) o <ins> (agregadas)
function text_cell(text, parts, kind) {
  const cell = make_element("td", `text cell_${kind}`);
  if (!parts) {
    cell.textContent = line_text(text);
    return cell;
  }
  const tag = kind === "removed" ? "del" : "ins";
  parts.forEach((part) => cell.append(part.changed ? make_element(tag, "", part.text) : document.createTextNode(part.text)));
  return cell;
}

function empty_cells() {
  return ["num", "sign", "text"].map((name) => make_element("td", `${name} cell_empty`));
}

function make_row(cells, row) {
  const element = make_element("tr", "");
  element.append(...cells);
  if (row.change) {
    element.dataset.change = String(row.change);
    // El primer renglón de cada cambio es adonde llevan Anterior y Siguiente
    if (!change_rows[row.change - 1]) change_rows[row.change - 1] = [];
    if (change_rows[row.change - 1].length === 0) element.tabIndex = -1;
    change_rows[row.change - 1].push(element);
  }
  return element;
}

// ¿Este renglón es el primero de su cambio? (para el texto que se lee en voz alta)
function is_first_of_change(row) {
  return Boolean(row.change) && result.changes[row.change - 1].first_row === row.index;
}

function unified_rows(row) {
  const first = is_first_of_change(row) ? row.change : 0;
  if (row.type === "equal") return [make_row([number_cell(row.a_number, "equal"), number_cell(row.b_number, "equal"), sign_cell("equal"), text_cell(row.b_text, null, "equal")], row)];
  if (row.type === "removed") return [make_row([number_cell(row.a_number, "removed"), number_cell(undefined, "removed"), sign_cell("removed", first), text_cell(row.a_text, null, "removed")], row)];
  if (row.type === "added") return [make_row([number_cell(undefined, "added"), number_cell(row.b_number, "added"), sign_cell("added", first), text_cell(row.b_text, null, "added")], row)];
  // Una modificación son dos renglones: la línea de antes y la de después, con sus palabras distintas marcadas
  return [
    make_row([number_cell(row.a_number, "removed"), number_cell(undefined, "removed"), sign_cell("removed", first), text_cell(row.a_text, row.old_parts, "removed")], row),
    make_row([number_cell(undefined, "added"), number_cell(row.b_number, "added"), sign_cell("added"), text_cell(row.b_text, row.new_parts, "added")], row),
  ];
}

function split_rows(row) {
  const first = is_first_of_change(row) ? row.change : 0;
  if (row.type === "equal") {
    return [make_row([number_cell(row.a_number, "equal"), sign_cell("equal"), text_cell(row.a_text, null, "equal"), number_cell(row.b_number, "equal"), sign_cell("equal"), text_cell(row.b_text, null, "equal")], row)];
  }
  if (row.type === "removed") return [make_row([number_cell(row.a_number, "removed"), sign_cell("removed", first), text_cell(row.a_text, null, "removed"), ...empty_cells()], row)];
  if (row.type === "added") return [make_row([...empty_cells(), number_cell(row.b_number, "added"), sign_cell("added", first), text_cell(row.b_text, null, "added")], row)];
  return [
    make_row(
      [
        number_cell(row.a_number, "removed"),
        sign_cell("removed", first),
        text_cell(row.a_text, row.old_parts, "removed"),
        number_cell(row.b_number, "added"),
        sign_cell("added"),
        text_cell(row.b_text, row.new_parts, "added"),
      ],
      row,
    ),
  ];
}

function table_columns() {
  return current_view === "split" ? 6 : 4;
}

function make_fold_row(fold) {
  const row = make_element("tr", "row_fold");
  const cell = make_element("td", "fold_cell");
  cell.colSpan = table_columns();
  const button = make_element("button", "fold_button", `${count_text(fold.count, "línea igual", "líneas iguales")} · Mostrar`);
  button.type = "button";
  button.addEventListener("click", () => {
    expanded_folds.add(fold.key);
    const revealed = fold.rows.flatMap((item) => rows_for(item));
    row.replaceWith(...revealed);
    // El botón desaparece: el foco pasa al primer renglón que apareció
    revealed[0].tabIndex = -1;
    revealed[0].focus();
    announce(`${count_text(fold.count, "línea igual mostrada", "líneas iguales mostradas")}.`);
  });
  cell.append(button);
  row.append(cell);
  return row;
}

function rows_for(item) {
  if (item.type === "fold") return [make_fold_row(item)];
  return current_view === "split" ? split_rows(item) : unified_rows(item);
}

// Las columnas (con su ancho) y el encabezado que solo leen los lectores de pantalla
function make_table_head() {
  const group = make_element("colgroup", "");
  const columns = current_view === "split" ? ["num", "sign", "text", "num", "sign", "text"] : ["num", "num", "sign", "text"];
  columns.forEach((name) => group.append(make_element("col", `col_${name}`)));
  const head = make_element("thead", "");
  const row = make_element("tr", "");
  const names = current_view === "split" ? ["Línea antes", "Cambio", "Texto antes", "Línea después", "Cambio", "Texto después"] : ["Línea antes", "Línea después", "Cambio", "Texto"];
  names.forEach((name) => {
    const cell = make_element("th", "");
    cell.append(make_element("span", "visually_hidden", name));
    row.append(cell);
  });
  head.append(row);
  return [group, head];
}

function update_counter() {
  const total = change_rows.length;
  dom.change_counter.textContent = current_change > 0 ? `Cambio ${current_change} de ${format_count(total)}` : total > 0 ? count_text(total, "cambio", "cambios") : "Sin cambios";
  dom.previous_button.disabled = total === 0;
  dom.next_button.disabled = total === 0;
}

// La tabla solo se puede recorrer con teclado si se desplaza por dentro (Lado a lado en pantallas angostas)
function update_scroll_access() {
  dom.scroll.tabIndex = dom.scroll.scrollWidth > dom.scroll.clientWidth ? 0 : -1;
}

function render_view_tabs() {
  dom.tabs.forEach((tab) => {
    const is_active = tab.dataset.view === current_view;
    tab.setAttribute("aria-selected", String(is_active));
    // Solo la pestaña activa entra en el orden de Tab; con las flechas se pasa a la otra.
    tab.tabIndex = is_active ? 0 : -1;
    if (is_active) dom.result_panel.setAttribute("aria-labelledby", tab.id);
  });
}

// Dibuja la tabla con la comparación que hay, en la vista elegida
function render_table() {
  change_rows = [];
  current_change = 0;
  render_view_tabs();
  if (!result) {
    dom.table.replaceChildren();
    dom.scroll.hidden = true;
    dom.placeholder.hidden = false;
    dom.table_notice.hidden = true;
    update_counter();
    return;
  }

  const items = dom.only_changes.checked ? fold_rows(result.rows, expanded_folds) : result.rows;
  const drawn = items.slice(0, MAX_DRAWN_ITEMS);
  const body = make_element("tbody", "");
  drawn.forEach((item) => body.append(...rows_for(item)));
  dom.table.className = current_view === "split" ? "diff_table is_split" : "diff_table";
  dom.table.replaceChildren(...make_table_head(), body);
  dom.scroll.hidden = false;
  dom.placeholder.hidden = true;

  if (items.length > drawn.length) {
    dom.table_notice.textContent = `Se muestran los primeros ${format_count(drawn.length)} renglones de ${format_count(items.length)}. Marca «Solo cambios», o copia o descarga el diff completo. Anterior y Siguiente recorren lo que se ve.`;
    dom.table_notice.hidden = false;
  } else dom.table_notice.hidden = true;
  update_counter();
  update_scroll_access();
}

// ---------------------------------------------------------------------------
// Navegación entre cambios
// ---------------------------------------------------------------------------

function select_change(number) {
  (change_rows[current_change - 1] ?? []).forEach((row) => row.classList.remove("is_current"));
  current_change = number;
  const rows = change_rows[number - 1];
  rows.forEach((row) => row.classList.add("is_current"));
  update_counter();
  // El foco va al primer renglón del cambio: así el lector de pantalla lo lee ("Cambio 2, quitada…")
  rows[0].scrollIntoView({ block: "center" });
  rows[0].focus({ preventScroll: true });
}

function go_to_change(step) {
  const total = change_rows.length;
  if (total === 0) return;
  if (current_change === 0) select_change(step > 0 ? 1 : total);
  else select_change(((current_change - 1 + step + total) % total) + 1);
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

function clear_result() {
  result = null;
  last_equality = null;
  expanded_folds = new Set();
  dom.copy_button.disabled = true;
  dom.download_button.disabled = true;
  dom.copy_fallback.hidden = true;
  reset_copy();
  render_table();
}

// Un texto demasiado grande no se procesa, para que el celular no se congele. Primero se compara el número de
// caracteres, que es barato y nunca pasa de los bytes, y solo si cabe se cuentan los bytes de verdad.
function size_problem(name, text) {
  if (text.length > MAX_INPUT_BYTES || byte_length(text) > MAX_INPUT_BYTES) {
    return `el texto de ${name} pesa más de ${format_size(MAX_INPUT_BYTES)}, que es lo máximo que se procesa. Prueba con una parte.`;
  }
  if (text.split(/\r\n?|\n/).length > MAX_INPUT_LINES) {
    return `el texto de ${name} tiene más de ${format_count(MAX_INPUT_LINES)} líneas, que es lo máximo que se procesa. Prueba con una parte.`;
  }
  return null;
}

// Recalcula la comparación y el estado con lo que hay en pantalla
function update() {
  clearTimeout(debounce_timer);
  const before_text = dom.before.value;
  const after_text = dom.after.value;
  dom.clear_button.disabled = before_text === "" && after_text === "";
  save_state();

  const problem = size_problem("Antes", before_text) ?? size_problem("Después", after_text);
  if (problem) {
    clear_result();
    hide_status();
    show_warning(problem);
    return;
  }
  if (before_text === "" && after_text === "") {
    clear_result();
    hide_status();
    return;
  }

  result = compare_texts(before_text, after_text, { ignore_spaces: dom.ignore_spaces.checked, ignore_case: dom.ignore_case.checked });
  expanded_folds = new Set();
  const equality = result.changes.length === 0 ? "same" : "different";
  if (last_equality !== null && last_equality !== equality) flash_scene();
  last_equality = equality;
  dom.copy_fallback.hidden = true;
  reset_copy();
  show_status(result);
  dom.copy_button.disabled = false;
  dom.download_button.disabled = false;
  render_table();
}

// Mientras se escribe, se espera un momento antes de recalcular para no trabajar con cada tecla
function schedule_update() {
  fit_height(dom.before);
  fit_height(dom.after);
  dom.clear_button.disabled = dom.before.value === "" && dom.after.value === "";
  clearTimeout(debounce_timer);
  debounce_timer = setTimeout(update, DEBOUNCE_MILLISECONDS);
}

function handle_clear() {
  dom.before.value = "";
  dom.after.value = "";
  fit_height(dom.before);
  fit_height(dom.after);
  update();
  dom.before.focus();
  announce("Textos vaciados.");
}

function handle_swap() {
  [dom.before.value, dom.after.value] = [dom.after.value, dom.before.value];
  fit_height(dom.before);
  fit_height(dom.after);
  update();
  announce("Textos intercambiados.");
}

// Lee un archivo de texto en el navegador (no se sube a ningún lado) y lo pone en su cuadro
async function open_file(input, textarea, box_name) {
  const file = input.files[0];
  // Se vacía el campo para poder abrir el mismo archivo otra vez
  input.value = "";
  if (!file) return;
  if (file.size > MAX_INPUT_BYTES) {
    hide_status();
    show_warning(`el archivo ${file.name} pesa más de ${format_size(MAX_INPUT_BYTES)}, que es lo máximo que se procesa.`);
    return;
  }
  let text;
  try {
    text = await file.text();
  } catch {
    hide_status();
    show_warning(`no se pudo leer el archivo ${file.name}.`);
    return;
  }
  if (text.includes("\u0000")) {
    hide_status();
    show_warning(`el archivo ${file.name} no parece de texto, así que no se abrió.`);
    return;
  }
  textarea.value = text;
  fit_height(textarea);
  update();
  announce(`Archivo ${file.name} abierto en ${box_name}.`);
}

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------

function select_view(view) {
  current_view = view;
  save_state();
  render_table();
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
// Eventos
// ---------------------------------------------------------------------------

function setup_events() {
  dom.before.addEventListener("input", schedule_update);
  dom.after.addEventListener("input", schedule_update);
  dom.ignore_spaces.addEventListener("change", update);
  dom.ignore_case.addEventListener("change", update);
  dom.only_changes.addEventListener("change", () => {
    save_state();
    render_table();
  });
  dom.tabs.forEach((tab) => tab.addEventListener("click", () => select_view(tab.dataset.view)));
  dom.tab_list.addEventListener("keydown", handle_tab_keydown);
  dom.clear_button.addEventListener("click", handle_clear);
  dom.swap_button.addEventListener("click", handle_swap);
  dom.before_file_button.addEventListener("click", () => dom.before_file.click());
  dom.after_file_button.addEventListener("click", () => dom.after_file.click());
  dom.before_file.addEventListener("change", () => open_file(dom.before_file, dom.before, "Antes"));
  dom.after_file.addEventListener("change", () => open_file(dom.after_file, dom.after, "Después"));
  dom.previous_button.addEventListener("click", () => go_to_change(-1));
  dom.next_button.addEventListener("click", () => go_to_change(1));
  dom.copy_button.addEventListener("click", handle_copy);
  dom.download_button.addEventListener("click", handle_download);
  // Al cambiar el ancho de la pantalla las líneas se parten distinto, así que el alto se ajusta de nuevo
  window.addEventListener("resize", () => {
    fit_height(dom.before);
    fit_height(dom.after);
    update_scroll_access();
  });
}

const saved_state = load_state();
dom.before.value = saved_state.before;
dom.after.value = saved_state.after;
dom.only_changes.checked = saved_state.only_changes;
dom.ignore_spaces.checked = saved_state.ignore_spaces;
dom.ignore_case.checked = saved_state.ignore_case;
current_view = saved_state.view;
setup_events();
update();
fit_height(dom.before);
fit_height(dom.after);
// El fondo es decorativo: se prepara sin esperar y el comparador ya funciona mientras carga.
start_scene(document.getElementById("scene_canvas"));
