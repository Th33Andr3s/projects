// Páginas del libro: ver la lista, editar, borrar, descargar el libro para revisarlo y
// aplicar correcciones (ortografía, tildes) preparadas fuera de la aplicación.
// Los formatos JSON están documentados en PLAN.md, sección "Formatos JSON de intercambio".
//
// Uso de recursos: nunca se descarga el libro completo para mostrar la lista. La base entrega
// solo las 10 páginas que se ven; la descarga completa y las correcciones trabajan por trozos.
import { supabase_client } from "./auth.js";
import { burst_hearts } from "./animations.js";
import { fetch_cover } from "./cover.js";
import { get_photo_url, remove_photo } from "./images.js";
import {
  create_element,
  create_action_button,
  toggle_content,
  ask_confirmation,
  describe_error,
  order_book,
  get_today_iso,
  format_date_range,
  set_edit_request,
  take_notice,
} from "./utils.js";

const EXPORT_FORMAT = "book_life_export";
const CORRECTIONS_FORMAT = "book_life_corrections";
const EXPORT_VERSION = 3;
const CORRECTIONS_VERSION = 1;
const PAGE_SIZE = 10;
const EXPORT_BATCH_SIZE = 200;
const LOOKUP_BATCH_SIZE = 100;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_ENTRIES = 500;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 50000;
const MAX_ERRORS_SHOWN = 8;
const LONG_CONTENT_LENGTH = 300;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTRY_COLUMNS = "id, entry_date, entry_date_end, title, content, order_index, created_at, author_id, image_path";

let navigate_to = () => {};
let dom = {};

// Solo las páginas de la hoja de la lista que se está viendo
let list_entries = [];
let total_entries = 0;
let current_page = 0;
let author_names = new Map();
let corrections_plan = null;
// Pedido de lista en curso: si la persona cambia de hoja rápido, el anterior se cancela y no gasta recursos.
let list_request = null;
// Hoja que la persona pidió por última vez: varios clics seguidos suman hojas aunque la anterior aún esté cargando.
let requested_page = 0;

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------

export function init_pages({ navigate }) {
  navigate_to = navigate;

  dom = {
    pages_status: document.getElementById("pages_status"),
    pages_retry: document.getElementById("pages_retry"),
    pages_summary: document.getElementById("pages_summary"),
    pages_list: document.getElementById("pages_list"),
    pagers: document.querySelectorAll("#pages_screen .pager"),
    export_book: document.getElementById("export_book"),
    import_file: document.getElementById("import_file"),
    import_text: document.getElementById("import_text"),
    import_review: document.getElementById("import_review"),
    import_error: document.getElementById("import_error"),
    import_error_list: document.getElementById("import_error_list"),
    import_preview: document.getElementById("import_preview"),
    import_summary: document.getElementById("import_summary"),
    import_list: document.getElementById("import_list"),
    import_confirm: document.getElementById("import_confirm"),
    import_cancel: document.getElementById("import_cancel"),
  };

  dom.pages_retry.addEventListener("click", () => load_list_page(current_page));
  dom.export_book.addEventListener("click", handle_export);
  dom.import_review.addEventListener("click", handle_import_review);
  dom.import_confirm.addEventListener("click", handle_import_confirm);
  dom.import_cancel.addEventListener("click", clear_import);
  dom.import_file.addEventListener("change", clear_import_feedback);
  dom.import_text.addEventListener("input", clear_import_feedback);
  dom.pages_list.addEventListener("click", handle_list_click);
  dom.pagers.forEach((pager) => pager.addEventListener("click", handle_pager_click));
}

// Se llama al cerrar sesión: no debe quedar nada del libro en pantalla ni pedidos pendientes.
export function reset_pages() {
  if (list_request) list_request.abort();
  list_request = null;
  list_entries = [];
  total_entries = 0;
  current_page = 0;
  requested_page = 0;
  author_names = new Map();
  corrections_plan = null;
  clear_import();
  dom.pages_list.replaceChildren();
  dom.pages_status.textContent = "";
  dom.pages_retry.hidden = true;
  dom.pagers.forEach((pager) => (pager.hidden = true));
}

// ---------------------------------------------------------------------------
// Acceso a datos. Cada función devuelve { ok, ... } y nunca lanza.
// ---------------------------------------------------------------------------

function is_aborted(error) {
  return error?.name === "AbortError" || /abort/i.test(String(error?.message || ""));
}

// Pide solo una hoja de la lista (10 páginas) y cuántas hay en total.
async function fetch_list_page(page_index, signal) {
  try {
    const first = page_index * PAGE_SIZE;
    const query = supabase_client.from("book_entries").select(ENTRY_COLUMNS, { count: "exact" });
    const { data, count, error } = await order_book(query, false).range(first, first + PAGE_SIZE - 1).abortSignal(signal);
    if (error) return is_aborted(error) ? { ok: false, aborted: true } : { ok: false, message: describe_error(error) };
    return { ok: true, entries: data, total: count ?? data.length };
  } catch (error) {
    return is_aborted(error) ? { ok: false, aborted: true } : { ok: false, message: describe_error(error) };
  }
}

async function fetch_author_names() {
  try {
    const { data, error } = await supabase_client.from("profiles").select("id, display_name");
    // Si los nombres fallan, todo sigue funcionando con un nombre genérico.
    if (!error) author_names = new Map(data.map((profile) => [profile.id, profile.display_name]));
  } catch {
    // Sin nombres se muestran las páginas igual.
  }
}

// Descarga todas las páginas en trozos de 200, para no pedir mucho de una sola vez.
async function fetch_all_entries(report_progress) {
  const entries = [];
  let total = Infinity;
  try {
    // El primer trozo también informa cuántas páginas hay, para no pedir uno de más al final.
    for (let first = 0; entries.length < total; first += EXPORT_BATCH_SIZE) {
      const query = supabase_client.from("book_entries").select(ENTRY_COLUMNS, first === 0 ? { count: "exact" } : {});
      const { data, count, error } = await order_book(query, true).range(first, first + EXPORT_BATCH_SIZE - 1);
      if (error) return { ok: false, message: describe_error(error) };
      if (first === 0) total = count ?? data.length;
      entries.push(...data);
      report_progress(entries.length);
      if (data.length === 0) break;
    }
    return { ok: true, entries };
  } catch (error) {
    return { ok: false, message: describe_error(error) };
  }
}

// Trae solo las páginas que el archivo de correcciones menciona, de 100 en 100.
async function fetch_entries_by_ids(ids) {
  const by_id = new Map();
  try {
    for (let first = 0; first < ids.length; first += LOOKUP_BATCH_SIZE) {
      const batch = ids.slice(first, first + LOOKUP_BATCH_SIZE);
      const { data, error } = await supabase_client.from("book_entries").select(ENTRY_COLUMNS).in("id", batch);
      if (error) return { ok: false, message: describe_error(error) };
      data.forEach((entry) => by_id.set(entry.id, entry));
    }
    return { ok: true, by_id };
  } catch (error) {
    return { ok: false, message: describe_error(error) };
  }
}

async function delete_entry(entry_id) {
  try {
    const { data, error } = await supabase_client.from("book_entries").delete().eq("id", entry_id).select("id");
    if (error) return { ok: false, message: describe_error(error) };
    if (!data || data.length === 0) return { ok: false, message: "Esa página ya no existe." };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: describe_error(error) };
  }
}

// Solo se envían las columnas que cambian, y solo las que la corrección trae.
async function apply_entry_changes(entry_id, changes) {
  try {
    const { data, error } = await supabase_client.from("book_entries").update(changes).eq("id", entry_id).select("id");
    if (error) return { ok: false, message: describe_error(error) };
    if (!data || data.length === 0) return { ok: false, message: "Esa página ya no existe." };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: describe_error(error) };
  }
}

// ---------------------------------------------------------------------------
// Lista paginada
// ---------------------------------------------------------------------------

function get_author_name(author_id) {
  return author_names.get(author_id) || "";
}

function count_text(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function get_total_list_pages() {
  return Math.max(1, Math.ceil(total_entries / PAGE_SIZE));
}

export async function on_pages_shown() {
  const notice = take_notice();
  await fetch_author_names();
  await load_list_page(current_page, notice);
}

// Pide una hoja de la lista. Si ya había un pedido en curso, lo cancela.
async function load_list_page(page_index, notice = "") {
  if (list_request) list_request.abort();
  const request = new AbortController();
  list_request = request;

  dom.pages_retry.hidden = true;
  dom.pages_status.textContent = "Cargando...";

  const result = await fetch_list_page(page_index, request.signal);
  // Un pedido cancelado o ya reemplazado por otro más reciente no debe tocar la pantalla.
  if (result.aborted || list_request !== request) return;
  list_request = null;

  if (!result.ok) {
    dom.pages_status.textContent = result.message;
    dom.pages_retry.hidden = false;
    // Si no se pudo cargar, la próxima hoja se cuenta desde la que sí se está viendo.
    requested_page = current_page;
    return;
  }

  total_entries = result.total;
  // Si después de borrar la hoja pedida quedó fuera de rango, se pide la última que exista.
  const last_page = get_total_list_pages() - 1;
  if (page_index > last_page) {
    await load_list_page(last_page, notice);
    return;
  }

  current_page = page_index;
  requested_page = page_index;
  list_entries = result.entries;
  render_pages(notice);
}

function render_pages(notice = "") {
  dom.pages_summary.textContent = `Páginas del libro (${total_entries})`;
  const status = total_entries === 0 ? "El libro aún no tiene páginas. Escribe la primera desde “Escribir en el libro”." : "";
  dom.pages_status.textContent = `${notice} ${status}`.trim();
  dom.pages_list.replaceChildren(...list_entries.map(create_entry_item));
  update_pagers();
}

// Muestra u oculta los botones de paginación y dice qué páginas se están viendo.
function update_pagers() {
  const total_pages = get_total_list_pages();
  const needs_pager = total_entries > PAGE_SIZE;
  const first_number = current_page * PAGE_SIZE + 1;
  const text = `Página ${current_page + 1} de ${total_pages} · ${first_number} a ${first_number + list_entries.length - 1} de ${total_entries}`;

  dom.pagers.forEach((pager) => {
    pager.hidden = !needs_pager;
    pager.querySelector(".pager_text").textContent = text;
    pager.querySelector('[data-pager="prev"]').disabled = current_page === 0;
    pager.querySelector('[data-pager="next"]').disabled = current_page >= total_pages - 1;
  });
}

async function handle_pager_click(event) {
  const button = event.target.closest("button[data-pager]");
  if (!button || button.disabled) return;

  const step = button.dataset.pager === "next" ? 1 : -1;
  requested_page = Math.max(0, Math.min(requested_page + step, get_total_list_pages() - 1));
  await load_list_page(requested_page);
  // Al cambiar de página se vuelve al inicio de la lista, que es donde está lo nuevo.
  dom.pages_summary.scrollIntoView({ block: "start" });
  dom.pages_summary.focus({ preventScroll: true });
}

// La miniatura se pide con un enlace temporal, sin bloquear el dibujo de la lista.
async function load_thumbnail(image_element, image_path) {
  const url = await get_photo_url(image_path);
  if (url) image_element.src = url;
  else image_element.hidden = true;
}

function create_entry_item(entry) {
  const item = create_element("li", "list_item");

  const meta = create_element("div", "list_item_meta");
  meta.append(create_element("span", "list_item_date", format_date_range(entry.entry_date, entry.entry_date_end)));
  const author_name = get_author_name(entry.author_id);
  if (author_name) meta.append(create_element("span", "list_item_author", author_name));
  if (entry.title) meta.append(create_element("span", "list_item_title", entry.title));
  item.append(meta);

  if (entry.image_path) {
    const thumbnail = create_element("img", "list_item_photo");
    thumbnail.alt = "Foto de esta página";
    thumbnail.loading = "lazy";
    item.append(thumbnail);
    load_thumbnail(thumbnail, entry.image_path);
  }

  const content = create_element("p", "list_item_content", entry.content);
  item.append(content);

  const actions = create_element("div", "list_item_actions");
  if (entry.content.length > LONG_CONTENT_LENGTH) {
    content.classList.add("is_clamped");
    const toggle = create_action_button("Leer completo", "fa-chevron-down", "toggle", entry.id);
    toggle.setAttribute("aria-expanded", "false");
    actions.append(toggle);
  }
  actions.append(
    create_action_button("Editar", "fa-pen", "edit", entry.id),
    create_action_button("Borrar", "fa-trash", "delete", entry.id, "button_danger_soft"),
  );
  item.append(actions);
  return item;
}

function handle_list_click(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const entry = list_entries.find((candidate) => candidate.id === button.dataset.item_id);
  if (!entry) return;

  if (button.dataset.action === "toggle") toggle_content(button);
  if (button.dataset.action === "edit") {
    set_edit_request(entry);
    navigate_to("write_screen");
  }
  if (button.dataset.action === "delete") confirm_and_delete(entry, button);
}

async function confirm_and_delete(entry, trigger_button) {
  const preview = entry.title || (entry.content.length > 90 ? `${entry.content.slice(0, 90)}...` : entry.content);
  const confirmed = await ask_confirmation({
    title: "¿Borrar esta página?",
    text: `“${preview}” saldrá del libro para siempre${entry.image_path ? ", junto con su foto" : ""}.`,
    confirm_label: "Sí, borrar",
  });
  if (!confirmed) {
    trigger_button.focus();
    return;
  }

  const result = await delete_entry(entry.id);
  if (!result.ok) {
    dom.pages_status.textContent = result.message;
    trigger_button.focus();
    return;
  }

  // La foto se borra después de la página: si esto falla solo queda un archivo sin usar.
  await remove_photo(entry.image_path);
  await load_list_page(current_page, "Página eliminada.");
  dom.pages_summary.focus();
}

// ---------------------------------------------------------------------------
// Descargar el libro
// ---------------------------------------------------------------------------

function download_json_file(file_name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file_name;
  document.body.append(link);
  link.click();
  link.remove();
  // Se libera la URL un instante después para no dejar memoria ocupada.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Los capítulos van en la descarga como respaldo. Si no se pueden leer (por ejemplo, aún no se crearon en la base),
// la descarga sale igual con la lista vacía: lo importante son las páginas.
async function fetch_chapters_for_export() {
  try {
    const { data, error } = await supabase_client.from("book_chapters").select("id, title, start_date").order("start_date", { ascending: true });
    return error ? [] : data;
  } catch {
    return [];
  }
}

function build_export(entries, scope, chapters, cover = null) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    scope,
    exported_at: new Date().toISOString(),
    profiles: [...author_names].map(([id, display_name]) => ({ id, display_name })),
    cover,
    chapters: chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, start_date: chapter.start_date })),
    entries: entries.map((entry) => ({
      id: entry.id,
      entry_date: entry.entry_date,
      entry_date_end: entry.entry_date_end,
      title: entry.title,
      content: entry.content,
      author_name: get_author_name(entry.author_id) || null,
      image_path: entry.image_path,
      order_index: entry.order_index,
      created_at: entry.created_at,
    })),
  };
}

async function handle_export() {
  dom.export_book.disabled = true;
  dom.pages_status.textContent = "Preparando la descarga...";

  await fetch_author_names();
  const result = await fetch_all_entries((loaded) => {
    dom.pages_status.textContent = `Preparando la descarga... ${count_text(loaded, "página", "páginas")}`;
  });
  dom.export_book.disabled = false;

  if (!result.ok) {
    dom.pages_status.textContent = result.message;
    return;
  }
  const chapters = await fetch_chapters_for_export();
  const cover = await fetch_cover();
  download_json_file(
    `libro_de_vida_${get_today_iso()}.json`,
    build_export(result.entries, "all", chapters, { names: cover.saved_names || null, photo_path: cover.photo_path }),
  );
  dom.pages_status.textContent = `Libro descargado: ${count_text(result.entries.length, "página", "páginas")}.`;
}

// ---------------------------------------------------------------------------
// Aplicar correcciones
// ---------------------------------------------------------------------------

function is_real_iso_date(value) {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  // Rechaza fechas que JavaScript "corrige", como el 31 de febrero.
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function has_field(object, name) {
  return Object.prototype.hasOwnProperty.call(object, name);
}

// Saca del archivo los ids de las páginas que menciona, para pedir solo esas a la base.
// Si el archivo no se puede leer, devuelve una lista vacía y el error lo explica la validación.
function extract_entry_ids(text) {
  try {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.entries)) return [];
    const ids = data.entries.map((raw) => (raw && typeof raw.id === "string" ? raw.id.toLowerCase() : "")).filter((id) => UUID_PATTERN.test(id));
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

// Valida el archivo completo y calcula qué cambiaría. Si algo está mal, no se aplica nada: todo o nada.
function build_corrections_plan(text, current_by_id) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { errors: ["El texto no es un JSON válido. Revisa que esté completo y sin partes cortadas."] };
  }

  if (!data || typeof data !== "object" || data.format !== CORRECTIONS_FORMAT) {
    return { errors: [`Falta "format": "${CORRECTIONS_FORMAT}". Este archivo no parece ser de correcciones.`] };
  }
  if (data.version !== CORRECTIONS_VERSION) {
    return { errors: [`La versión del formato debe ser ${CORRECTIONS_VERSION}.`] };
  }
  if (!Array.isArray(data.entries) || data.entries.length === 0) {
    return { errors: ['Falta la lista "entries" o está vacía.'] };
  }
  if (data.entries.length > MAX_IMPORT_ENTRIES) {
    return { errors: [`Son demasiadas páginas de una vez. El máximo es ${MAX_IMPORT_ENTRIES}.`] };
  }

  const errors = [];
  const planned = [];
  const seen_ids = new Set();

  data.entries.forEach((raw, index) => {
    const label = `Corrección ${index + 1}`;
    const problems = [];

    if (!raw || typeof raw !== "object") {
      errors.push(`${label}: no es un objeto válido.`);
      return;
    }

    const id = typeof raw.id === "string" ? raw.id.toLowerCase() : "";
    if (!UUID_PATTERN.test(id)) problems.push('falta "id" o no es válido');
    else if (!current_by_id.has(id)) problems.push("esa página no existe en el libro");
    else if (seen_ids.has(id)) problems.push("la página aparece repetida en el archivo");
    seen_ids.add(id);

    const changes = {};
    const wanted = {};

    if (has_field(raw, "content")) {
      const content = typeof raw.content === "string" ? raw.content.trim() : "";
      if (!content) problems.push('"content" no puede estar vacío');
      else if (content.length > MAX_CONTENT_LENGTH) problems.push(`"content" supera ${MAX_CONTENT_LENGTH} caracteres`);
      else wanted.content = content;
    }
    if (has_field(raw, "title")) {
      if (raw.title !== null && typeof raw.title !== "string") problems.push('"title" debe ser texto');
      else {
        const title = raw.title === null ? null : raw.title.trim() || null;
        if (title && title.length > MAX_TITLE_LENGTH) problems.push(`"title" supera ${MAX_TITLE_LENGTH} caracteres`);
        else wanted.title = title;
      }
    }
    if (has_field(raw, "entry_date")) {
      if (raw.entry_date !== null && raw.entry_date !== "" && !is_real_iso_date(raw.entry_date)) {
        problems.push('"entry_date" debe ser una fecha real AAAA-MM-DD, o null');
      } else wanted.entry_date = raw.entry_date || null;
    }
    if (has_field(raw, "entry_date_end")) {
      if (raw.entry_date_end !== null && raw.entry_date_end !== "" && !is_real_iso_date(raw.entry_date_end)) {
        problems.push('"entry_date_end" debe ser una fecha real AAAA-MM-DD, o null');
      } else wanted.entry_date_end = raw.entry_date_end || null;
    }

    if (problems.length > 0) {
      errors.push(`${label}: ${problems.join("; ")}.`);
      return;
    }

    // Reglas del periodo, calculadas con las fechas que quedarían después del cambio.
    const current = current_by_id.get(id);
    const final_start = has_field(wanted, "entry_date") ? wanted.entry_date : current.entry_date;
    let final_end = has_field(wanted, "entry_date_end") ? wanted.entry_date_end : current.entry_date_end;
    if (final_end && !final_start) {
      errors.push(`${label}: una página con "entry_date_end" necesita también "entry_date".`);
      return;
    }
    if (final_end && final_end < final_start) {
      errors.push(`${label}: "entry_date_end" no puede ser anterior a "entry_date".`);
      return;
    }
    if (final_end === final_start) final_end = null;
    if (has_field(wanted, "entry_date") || has_field(wanted, "entry_date_end")) {
      wanted.entry_date = final_start;
      wanted.entry_date_end = final_end;
    }

    // Solo cuenta lo que de verdad cambia.
    Object.entries(wanted).forEach(([field, value]) => {
      if ((current[field] ?? null) !== value) changes[field] = value;
    });
    planned.push({ id, current, changes, has_changes: Object.keys(changes).length > 0 });
  });

  if (errors.length > 0) return { errors };
  return { errors: [], planned, to_apply: planned.filter((item) => item.has_changes) };
}

function clear_import_feedback() {
  dom.import_error.hidden = true;
  dom.import_error_list.replaceChildren();
  dom.import_preview.hidden = true;
  dom.import_list.replaceChildren();
  corrections_plan = null;
}

function clear_import() {
  clear_import_feedback();
  dom.import_file.value = "";
  dom.import_text.value = "";
}

function show_import_errors(errors) {
  const shown = errors.slice(0, MAX_ERRORS_SHOWN);
  const items = shown.map((message) => create_element("li", "", message));
  if (errors.length > shown.length) items.push(create_element("li", "", `Y ${errors.length - shown.length} problemas más.`));
  dom.import_error_list.replaceChildren(...items);
  dom.import_error.hidden = false;
}

const FIELD_NAMES = { content: "texto", title: "título", entry_date: "fecha", entry_date_end: "fecha final" };

function render_import_preview(plan) {
  const changing = plan.to_apply.length;
  const unchanged = plan.planned.length - changing;
  const parts = [count_text(changing, "página cambiará", "páginas cambiarán")];
  if (unchanged > 0) parts.push(`${unchanged} ya estaban igual y se omiten`);
  dom.import_summary.textContent = `${parts.join(" · ")}. Antes de aplicar se descargará una copia de seguridad de las páginas que cambiarán.`;

  dom.import_list.replaceChildren(
    ...plan.planned.map((item) => {
      const list_item = create_element("li", item.has_changes ? "import_item" : "import_item is_duplicate");
      const heading = create_element("p", "import_item_title");
      heading.append(
        create_element("strong", "", format_date_range(item.current.entry_date, item.current.entry_date_end)),
        create_element("span", "", item.current.title ? ` · ${item.current.title}` : ""),
        create_element(
          "span",
          "import_item_flag",
          item.has_changes ? ` (cambia: ${Object.keys(item.changes).map((field) => FIELD_NAMES[field]).join(", ")})` : " (sin cambios)",
        ),
      );
      list_item.append(heading);
      if (item.changes.content) {
        const text = item.changes.content;
        list_item.append(create_element("p", "import_item_text", text.length > 140 ? `${text.slice(0, 140)}...` : text));
      }
      return list_item;
    }),
  );

  dom.import_confirm.disabled = changing === 0;
  dom.import_preview.hidden = false;
}

async function handle_import_review() {
  clear_import_feedback();

  const file = dom.import_file.files[0];
  let text = dom.import_text.value.trim();

  if (file) {
    if (file.size > MAX_IMPORT_BYTES) {
      show_import_errors(["El archivo es demasiado grande. El máximo es 2 MB."]);
      return;
    }
    text = await file.text();
  }
  if (!text) {
    show_import_errors(["Elige un archivo o pega el JSON antes de revisar."]);
    return;
  }

  // Se piden a la base solo las páginas que el archivo menciona, para comparar con su texto real.
  dom.import_review.disabled = true;
  await fetch_author_names();
  const lookup = await fetch_entries_by_ids(extract_entry_ids(text));
  dom.import_review.disabled = false;
  if (!lookup.ok) {
    show_import_errors([lookup.message]);
    return;
  }

  const plan = build_corrections_plan(text, lookup.by_id);
  if (plan.errors.length > 0) {
    show_import_errors(plan.errors);
    return;
  }
  corrections_plan = plan;
  render_import_preview(plan);
}

async function handle_import_confirm() {
  if (!corrections_plan) return;
  const plan = corrections_plan;

  dom.import_confirm.disabled = true;
  dom.import_confirm.textContent = "Aplicando...";

  // Red de seguridad: el libro no guarda historial, así que antes de cambiar nada se descargan las páginas que cambiarán.
  const affected_entries = plan.to_apply.map((item) => item.current);
  download_json_file(
    `libro_de_vida_antes_de_correcciones_${get_today_iso()}.json`,
    build_export(affected_entries, "pages_before_corrections", []),
  );

  const failures = [];
  for (const item of plan.to_apply) {
    const result = await apply_entry_changes(item.id, item.changes);
    if (!result.ok) failures.push(`${format_date_range(item.current.entry_date, item.current.entry_date_end)}: ${result.message}`);
  }

  dom.import_confirm.textContent = "Aplicar correcciones";
  dom.import_confirm.disabled = false;

  if (failures.length > 0) {
    show_import_errors([
      `No se pudieron aplicar ${count_text(failures.length, "corrección", "correcciones")}. Puedes volver a intentarlo con el mismo archivo: lo ya aplicado se omite.`,
      ...failures,
    ]);
    dom.import_preview.hidden = true;
    await load_list_page(current_page);
    return;
  }

  clear_import();
  await load_list_page(current_page, `Listo: ${count_text(plan.to_apply.length, "página corregida", "páginas corregidas")}.`);
  burst_hearts();
}
