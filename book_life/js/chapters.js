// Capítulos del libro: crear, cambiar de nombre o fecha, y borrar.
// Un capítulo tiene un nombre y la fecha en que empieza. Dura hasta donde empiece el siguiente, así que
// no hay que asignar cada página a mano: la base calcula cuántas páginas tiene cada uno (book_chapter_list).
// Las páginas anteriores al primer capítulo quedan sin capítulo. Borrar un capítulo no borra páginas.
import { supabase_client } from "./auth.js";
import { burst_hearts } from "./animations.js";
import { create_element, create_action_button, ask_confirmation, describe_error, format_date } from "./utils.js";

const MAX_TITLE_LENGTH = 100;
const UNIQUE_VIOLATION_CODE = "23505";
// Códigos de "la tabla o la función no existe": falta ejecutar el SQL de los capítulos en Supabase.
const MISSING_SETUP_CODES = ["42P01", "42883", "PGRST202", "PGRST205"];
const MISSING_SETUP_MESSAGE = "Falta crear los capítulos en Supabase. Ejecuta el SQL de la sección de capítulos del PLAN.md y vuelve a intentar.";

let dom = {};
let chapters = [];
// Si hay un capítulo aquí, el formulario lo está editando; si no, crea uno nuevo.
let editing_chapter = null;
let is_saving = false;

export function init_chapters() {
  dom = {
    status: document.getElementById("chapters_status"),
    retry: document.getElementById("chapters_retry"),
    list: document.getElementById("chapters_list"),
    form: document.getElementById("chapter_form"),
    form_title: document.getElementById("chapter_form_title"),
    title_input: document.getElementById("chapter_title"),
    date_input: document.getElementById("chapter_start_date"),
    error: document.getElementById("chapter_error"),
    submit: document.getElementById("chapter_submit"),
    cancel: document.getElementById("chapter_cancel"),
  };

  dom.retry.addEventListener("click", load_chapters);
  dom.form.addEventListener("submit", handle_submit);
  dom.cancel.addEventListener("click", () => start_editing(null));
  dom.list.addEventListener("click", handle_list_click);
}

// Se llama al cerrar sesión: no debe quedar nada en pantalla.
export function reset_chapters() {
  chapters = [];
  editing_chapter = null;
  is_saving = false;
  dom.list.replaceChildren();
  dom.status.textContent = "";
  dom.retry.hidden = true;
  dom.form.reset();
  hide_error();
  show_form_mode();
}

export async function on_chapters_shown() {
  start_editing(null);
  await load_chapters();
}

// ---------------------------------------------------------------------------
// Acceso a datos. Cada función devuelve { ok, ... } y nunca lanza.
// ---------------------------------------------------------------------------

function describe_chapter_error(error) {
  if (MISSING_SETUP_CODES.includes(error?.code)) return MISSING_SETUP_MESSAGE;
  if (error?.code === UNIQUE_VIOLATION_CODE) return "Ya hay un capítulo que empieza ese día. Elige otra fecha.";
  return describe_error(error);
}

async function fetch_chapters() {
  try {
    const { data, error } = await supabase_client.rpc("book_chapter_list");
    if (error) return { ok: false, message: describe_chapter_error(error) };
    return { ok: true, chapters: data };
  } catch (error) {
    return { ok: false, message: describe_chapter_error(error) };
  }
}

async function insert_chapter(fields) {
  try {
    const { error } = await supabase_client.from("book_chapters").insert({ title: fields.title, start_date: fields.start_date });
    if (error) return { ok: false, message: describe_chapter_error(error) };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: describe_chapter_error(error) };
  }
}

async function update_chapter(chapter_id, fields) {
  try {
    const { data, error } = await supabase_client
      .from("book_chapters")
      .update({ title: fields.title, start_date: fields.start_date })
      .eq("id", chapter_id)
      .select("id");
    if (error) return { ok: false, message: describe_chapter_error(error) };
    if (!data || data.length === 0) return { ok: false, message: "Ese capítulo ya no existe." };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: describe_chapter_error(error) };
  }
}

async function delete_chapter(chapter_id) {
  try {
    const { error } = await supabase_client.from("book_chapters").delete().eq("id", chapter_id);
    if (error) return { ok: false, message: describe_chapter_error(error) };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: describe_chapter_error(error) };
  }
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

async function load_chapters(notice = "") {
  dom.retry.hidden = true;
  dom.status.textContent = "Cargando...";

  const result = await fetch_chapters();
  if (!result.ok) {
    dom.status.textContent = result.message;
    dom.retry.hidden = false;
    return;
  }

  chapters = result.chapters;
  render_chapters(notice);
}

function count_text(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function render_chapters(notice = "") {
  const hint =
    chapters.length === 0
      ? "Aún no hay capítulos. Crea el primero abajo: el libro seguirá igual hasta que lo hagas."
      : "Un capítulo llega hasta donde empieza el siguiente. Las páginas anteriores al primero quedan sin capítulo.";
  dom.status.textContent = `${notice} ${hint}`.trim();
  dom.list.replaceChildren(...chapters.map(create_chapter_item));
}

function create_chapter_item(chapter) {
  const item = create_element("li", "list_item");

  const meta = create_element("div", "list_item_meta");
  meta.append(create_element("span", "list_item_date chapter_name", chapter.title));
  meta.append(create_element("span", "list_item_title", `Desde el ${format_date(chapter.start_date)}`));
  item.append(meta);

  const entry_count = Number(chapter.entry_count);
  // Un capítulo sin páginas no aparece en el libro: se avisa para que no parezca un error.
  const count_message = entry_count === 0 ? "Sin páginas todavía: no aparece en el libro." : count_text(entry_count, "página", "páginas");
  item.append(create_element("p", "list_item_content", count_message));

  const actions = create_element("div", "list_item_actions");
  actions.append(
    create_action_button("Editar", "fa-pen", "edit", chapter.id),
    create_action_button("Borrar", "fa-trash", "delete", chapter.id, "button_danger_soft"),
  );
  item.append(actions);
  return item;
}

function handle_list_click(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const chapter = chapters.find((candidate) => candidate.id === button.dataset.item_id);
  if (!chapter) return;

  if (button.dataset.action === "edit") start_editing(chapter);
  if (button.dataset.action === "delete") confirm_and_delete(chapter, button);
}

async function confirm_and_delete(chapter, trigger_button) {
  const confirmed = await ask_confirmation({
    title: "¿Borrar este capítulo?",
    text: `“${chapter.title}” dejará de aparecer en el libro. Sus páginas no se borran: pasan a formar parte del capítulo anterior.`,
    confirm_label: "Sí, borrar",
  });
  if (!confirmed) {
    trigger_button.focus();
    return;
  }

  const result = await delete_chapter(chapter.id);
  if (!result.ok) {
    dom.status.textContent = result.message;
    trigger_button.focus();
    return;
  }
  if (editing_chapter?.id === chapter.id) start_editing(null);
  await load_chapters("Capítulo borrado.");
  dom.form_title.focus();
}

// ---------------------------------------------------------------------------
// Formulario
// ---------------------------------------------------------------------------

function show_error(message) {
  dom.error.textContent = message;
  dom.error.hidden = false;
}

function hide_error() {
  dom.error.textContent = "";
  dom.error.hidden = true;
}

function show_form_mode() {
  const is_editing = Boolean(editing_chapter);
  dom.form_title.textContent = is_editing ? "Editar capítulo" : "Nuevo capítulo";
  dom.submit.textContent = is_editing ? "Guardar cambios" : "Crear capítulo";
  dom.cancel.hidden = !is_editing;
}

// Con un capítulo, el formulario lo edita; con null vuelve a crear uno nuevo.
function start_editing(chapter) {
  editing_chapter = chapter;
  hide_error();
  dom.title_input.value = chapter ? chapter.title : "";
  dom.date_input.value = chapter ? chapter.start_date : "";
  show_form_mode();
  if (chapter) {
    dom.form.scrollIntoView({ block: "center" });
    dom.title_input.focus({ preventScroll: true });
  }
}

async function handle_submit(event) {
  event.preventDefault();
  if (is_saving) return;
  hide_error();

  const title = dom.title_input.value.trim();
  const start_date = dom.date_input.value;

  if (!title) {
    show_error("Escribe el nombre del capítulo.");
    dom.title_input.focus();
    return;
  }
  if (title.length > MAX_TITLE_LENGTH) {
    show_error(`El nombre puede tener hasta ${MAX_TITLE_LENGTH} letras.`);
    dom.title_input.focus();
    return;
  }
  if (!start_date) {
    show_error("Elige la fecha en que empieza el capítulo.");
    dom.date_input.focus();
    return;
  }

  // Se bloquea el botón mientras responde el servidor para evitar envíos dobles.
  is_saving = true;
  dom.submit.disabled = true;
  const fields = { title, start_date };
  const result = editing_chapter ? await update_chapter(editing_chapter.id, fields) : await insert_chapter(fields);
  is_saving = false;
  dom.submit.disabled = false;

  if (!result.ok) {
    show_error(result.message);
    return;
  }

  const notice = editing_chapter ? "Capítulo actualizado." : "Capítulo creado.";
  start_editing(null);
  burst_hearts();
  await load_chapters(notice);
}
