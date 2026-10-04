// Escribir una página del libro (o editar una que ya existe).
// Lo que se guarda aquí aparece directamente en el libro: no hay borradores ni pasos intermedios.
// Regla de oro de esta pantalla: el texto de la persona nunca se pierde por un fallo.
import { supabase_client } from "./auth.js";
import { burst_hearts, play_celebration, stop_celebration } from "./animations.js";
import { build_photo_path, get_photo_url, prepare_photo, remove_photo, upload_photo } from "./images.js";
import {
  describe_error,
  get_today_iso,
  normalize_date_range,
  link_date_range_inputs,
  take_edit_request,
  set_notice,
} from "./utils.js";

const UNSENT_STORAGE_KEY = "book_life_unsent_page";
// Clave de cuando existían los borradores: se borra para no dejar texto viejo en el equipo.
const LEGACY_UNSENT_STORAGE_KEY = "book_life_unsent_draft";
const CELEBRATION_MILLISECONDS = 2600;

let navigate_to = () => {};
let current_user_id = null;
let dom = {};
let sync_date_inputs = () => {};

// Si hay una página aquí, se está editando; si no, se está escribiendo una nueva.
let editing_entry = null;
let photo = { existing_path: null, new_blob: null, preview_url: "", is_removed: false };
let save_unsent_timer = 0;

// ---------------------------------------------------------------------------
// Inicio y estado de sesión
// ---------------------------------------------------------------------------

export function init_write({ navigate }) {
  navigate_to = navigate;

  dom = {
    write_title: document.getElementById("write_title"),
    write_hint: document.getElementById("write_hint"),
    write_form: document.getElementById("write_form"),
    entry_content: document.getElementById("entry_content"),
    entry_title: document.getElementById("entry_title"),
    write_date: document.getElementById("write_date"),
    write_date_end: document.getElementById("write_date_end"),
    clear_dates: document.getElementById("clear_dates"),
    photo_preview: document.getElementById("photo_preview"),
    photo_placeholder: document.getElementById("photo_placeholder"),
    photo_input: document.getElementById("photo_input"),
    photo_choose: document.getElementById("photo_choose"),
    photo_remove: document.getElementById("photo_remove"),
    photo_error: document.getElementById("photo_error"),
    write_error: document.getElementById("write_error"),
    write_success: document.getElementById("write_success"),
    write_submit: document.getElementById("write_submit"),
    write_cancel: document.getElementById("write_cancel"),
    save_celebration: document.getElementById("save_celebration"),
  };

  try {
    localStorage.removeItem(LEGACY_UNSENT_STORAGE_KEY);
  } catch {
    // Sin almacenamiento disponible no hay nada que borrar.
  }

  dom.write_form.addEventListener("submit", handle_write_submit);
  dom.write_cancel.addEventListener("click", cancel_edit);
  dom.entry_content.addEventListener("input", handle_content_input);
  dom.entry_title.addEventListener("input", schedule_save_unsent);
  sync_date_inputs = link_date_range_inputs(dom.write_date, dom.write_date_end);
  dom.write_date.addEventListener("input", schedule_save_unsent);
  dom.write_date_end.addEventListener("input", schedule_save_unsent);
  dom.clear_dates.addEventListener("click", clear_date_fields);
  dom.photo_choose.addEventListener("click", () => dom.photo_input.click());
  dom.photo_input.addEventListener("change", handle_photo_chosen);
  dom.photo_remove.addEventListener("click", handle_photo_remove);
}

// Se llama al iniciar o cerrar sesión. Sin sesión se vacía todo lo que haya en pantalla.
export function set_current_user(user_id) {
  current_user_id = user_id;
  if (user_id) return;

  editing_entry = null;
  clearTimeout(save_unsent_timer);
  hide_celebration();
  dom.entry_content.value = "";
  dom.entry_title.value = "";
  dom.write_date.value = "";
  dom.write_date_end.value = "";
  sync_date_inputs();
  reset_photo_state(null);
}

// Borra la copia local del texto sin enviar. Se usa al cerrar sesión a propósito.
export function clear_unsent_text() {
  try {
    localStorage.removeItem(UNSENT_STORAGE_KEY);
  } catch {
    // Sin almacenamiento disponible no hay nada que borrar.
  }
}

// ---------------------------------------------------------------------------
// Acceso a datos. Cada función devuelve { ok, ... } y nunca lanza.
// ---------------------------------------------------------------------------

async function fetch_next_order_index() {
  try {
    const { data, error } = await supabase_client
      .from("book_entries")
      .select("order_index")
      .order("order_index", { ascending: false })
      .limit(1);
    if (error) return { ok: false, message: describe_error(error) };
    return { ok: true, value: (data[0]?.order_index ?? 0) + 1 };
  } catch (error) {
    return { ok: false, message: describe_error(error) };
  }
}

// Se envían solo las columnas de la tabla, una por una. El autor lo pone la base con la sesión.
async function insert_entry(entry_id, fields) {
  const next = await fetch_next_order_index();
  if (!next.ok) return next;
  try {
    const { error } = await supabase_client.from("book_entries").insert({
      id: entry_id,
      entry_date: fields.entry_date,
      entry_date_end: fields.entry_date_end,
      title: fields.title,
      content: fields.content,
      image_path: fields.image_path,
      order_index: next.value,
    });
    if (error) return { ok: false, message: describe_error(error) };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: describe_error(error) };
  }
}

async function update_entry(entry_id, fields) {
  try {
    const { data, error } = await supabase_client
      .from("book_entries")
      .update({
        entry_date: fields.entry_date,
        entry_date_end: fields.entry_date_end,
        title: fields.title,
        content: fields.content,
        image_path: fields.image_path,
      })
      .eq("id", entry_id)
      .select("id");
    if (error) return { ok: false, message: describe_error(error) };
    if (!data || data.length === 0) return { ok: false, message: "Esa página ya no existe." };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: describe_error(error) };
  }
}

// ---------------------------------------------------------------------------
// Copia local del texto sin enviar
// ---------------------------------------------------------------------------

function schedule_save_unsent() {
  if (editing_entry) return;
  clearTimeout(save_unsent_timer);
  save_unsent_timer = setTimeout(save_unsent, 400);
}

function save_unsent() {
  const content = dom.entry_content.value;
  try {
    if (!content.trim()) {
      localStorage.removeItem(UNSENT_STORAGE_KEY);
      return;
    }
    localStorage.setItem(
      UNSENT_STORAGE_KEY,
      JSON.stringify({
        user_id: current_user_id,
        entry_date: dom.write_date.value,
        entry_date_end: dom.write_date_end.value,
        title: dom.entry_title.value,
        content,
      }),
    );
  } catch {
    // Si el almacenamiento está bloqueado, el texto igual sigue en pantalla.
  }
}

function load_unsent() {
  try {
    const stored = JSON.parse(localStorage.getItem(UNSENT_STORAGE_KEY));
    // Solo se recupera si es de la misma persona que tiene la sesión abierta.
    if (stored && stored.user_id === current_user_id && stored.content) return stored;
  } catch {
    // Dato dañado o sin almacenamiento: se ignora.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Foto
// ---------------------------------------------------------------------------

function revoke_preview() {
  if (photo.preview_url) URL.revokeObjectURL(photo.preview_url);
}

function reset_photo_state(existing_path) {
  revoke_preview();
  photo = { existing_path, new_blob: null, preview_url: "", is_removed: false };
  dom.photo_error.hidden = true;
  render_photo();
}

function has_photo() {
  return Boolean(photo.new_blob) || Boolean(photo.existing_path && !photo.is_removed);
}

// Muestra la foto elegida, la que ya tenía la página, o el marco vacío.
async function render_photo() {
  const visible = has_photo();
  dom.photo_preview.hidden = !visible;
  dom.photo_placeholder.hidden = visible;
  dom.photo_remove.hidden = !visible;
  dom.photo_choose.lastChild.textContent = visible ? " Cambiar foto" : " Elegir foto";

  if (!visible) {
    dom.photo_preview.removeAttribute("src");
    return;
  }
  if (photo.new_blob) {
    dom.photo_preview.src = photo.preview_url;
    return;
  }

  // La foto guardada se pide con un enlace temporal. Si la persona cambió de foto mientras tanto, se descarta.
  const requested_path = photo.existing_path;
  const url = await get_photo_url(requested_path);
  if (photo.existing_path !== requested_path || photo.new_blob || photo.is_removed) return;
  if (url) dom.photo_preview.src = url;
  else dom.photo_preview.hidden = true;
}

async function handle_photo_chosen() {
  const file = dom.photo_input.files[0];
  // Se limpia el campo para que elegir la misma foto otra vez también se detecte.
  dom.photo_input.value = "";
  if (!file) return;

  dom.photo_error.hidden = true;
  // Reducir una foto grande tarda un instante: el botón avisa mientras tanto.
  dom.photo_choose.disabled = true;
  dom.photo_choose.lastChild.textContent = " Preparando foto...";
  const result = await prepare_photo(file);
  dom.photo_choose.disabled = false;

  if (!result.ok) {
    dom.photo_error.textContent = result.message;
    dom.photo_error.hidden = false;
    render_photo();
    return;
  }
  revoke_preview();
  photo.new_blob = result.blob;
  photo.preview_url = URL.createObjectURL(result.blob);
  photo.is_removed = false;
  render_photo();
}

function handle_photo_remove() {
  revoke_preview();
  photo.new_blob = null;
  photo.preview_url = "";
  // Si la página ya tenía una foto guardada, se marca para borrarla al guardar.
  photo.is_removed = Boolean(photo.existing_path);
  dom.photo_error.hidden = true;
  render_photo();
  dom.photo_choose.focus();
}

// ---------------------------------------------------------------------------
// Pantalla de escribir
// ---------------------------------------------------------------------------

function show_write_error(message) {
  dom.write_error.textContent = message;
  dom.write_error.hidden = false;
}

function clear_write_messages() {
  dom.write_error.textContent = "";
  dom.write_error.hidden = true;
  dom.write_success.textContent = "";
  dom.write_success.hidden = true;
}

function hide_celebration() {
  stop_celebration(dom.save_celebration);
}

function show_celebration() {
  dom.write_success.textContent = "Guardada. Ya está en el libro.";
  dom.write_success.hidden = false;
  // Con movimiento reducido no hay celebración: el mensaje de texto ya avisó que se guardó.
  if (play_celebration(dom.save_celebration, CELEBRATION_MILLISECONDS)) burst_hearts();
}

// Se llama cada vez que se abre la pantalla de escribir.
export function on_write_shown() {
  clear_write_messages();
  hide_celebration();

  const request = take_edit_request();
  if (request) {
    editing_entry = request;
    dom.write_title.textContent = "Editar página";
    dom.write_hint.textContent = "Corrige lo que quieras y guarda los cambios.";
    dom.write_submit.textContent = "Guardar cambios";
    dom.write_cancel.hidden = false;
    dom.entry_content.value = request.content;
    dom.entry_title.value = request.title || "";
    dom.write_date.value = request.entry_date || "";
    dom.write_date_end.value = request.entry_date_end || "";
    sync_date_inputs();
    reset_photo_state(request.image_path);
  } else {
    editing_entry = null;
    dom.write_title.textContent = "Escribir en el libro";
    dom.write_hint.textContent = "Lo que escribas aparece directo en el libro. Cada tanto lo revisamos juntos para corregir la ortografía.";
    dom.write_submit.textContent = "Guardar en el libro";
    dom.write_cancel.hidden = true;
    const unsent = load_unsent();
    // Lo recuperado se respeta tal cual, incluso si la persona había quitado las fechas.
    dom.write_date.value = unsent ? unsent.entry_date || "" : get_today_iso();
    dom.write_date_end.value = unsent ? unsent.entry_date_end || "" : "";
    sync_date_inputs();
    dom.entry_title.value = unsent ? unsent.title || "" : "";
    dom.entry_content.value = unsent ? unsent.content : "";
    reset_photo_state(null);
    if (unsent) {
      dom.write_success.textContent = "Recuperamos lo que estabas escribiendo.";
      dom.write_success.hidden = false;
    }
  }

  // Listo para escribir al instante: en el celular se abre el teclado.
  dom.entry_content.focus({ preventScroll: true });
}

// Quita las dos fechas: la página queda "sin fecha", útil cuando no se sabe o no importa el día.
function clear_date_fields() {
  dom.write_date.value = "";
  dom.write_date_end.value = "";
  sync_date_inputs();
  schedule_save_unsent();
  dom.write_date.focus();
}

function handle_content_input() {
  // Al volver a escribir, el aviso de "guardado" ya no aplica.
  if (!dom.write_error.hidden || !dom.write_success.hidden) clear_write_messages();
  schedule_save_unsent();
}

function cancel_edit() {
  editing_entry = null;
  navigate_to("pages_screen");
}

async function handle_write_submit(event) {
  event.preventDefault();
  clear_write_messages();

  const dates = normalize_date_range(dom.write_date.value, dom.write_date_end.value);
  const content = dom.entry_content.value.trim();

  if (dates.error) {
    show_write_error(dates.error);
    (dom.write_date.value ? dom.write_date_end : dom.write_date).focus();
    return;
  }
  if (!content) {
    show_write_error("Escribe algo antes de guardar.");
    dom.entry_content.focus();
    return;
  }

  // Se bloquea el botón mientras responde el servidor para evitar guardar dos veces.
  const idle_label = dom.write_submit.textContent;
  dom.write_submit.disabled = true;
  dom.write_submit.textContent = "Guardando...";

  const is_editing = Boolean(editing_entry);
  const entry_id = is_editing ? editing_entry.id : crypto.randomUUID();
  const previous_path = is_editing ? editing_entry.image_path : null;

  // La foto se sube primero; si después falla el guardado de la página, se borra para no dejar archivos sueltos.
  let uploaded_path = null;
  let failure = "";
  if (photo.new_blob) {
    uploaded_path = build_photo_path(entry_id);
    const uploaded = await upload_photo(uploaded_path, photo.new_blob);
    if (!uploaded.ok) {
      failure = `No se pudo subir la foto. ${uploaded.message}`;
      uploaded_path = null;
    }
  }

  let image_path = null;
  if (is_editing) image_path = uploaded_path ?? (photo.is_removed ? null : previous_path);
  else image_path = uploaded_path;

  if (!failure) {
    const fields = {
      entry_date: dates.entry_date,
      entry_date_end: dates.entry_date_end,
      title: dom.entry_title.value.trim() || null,
      content,
      image_path,
    };
    const result = is_editing ? await update_entry(entry_id, fields) : await insert_entry(entry_id, fields);
    if (!result.ok) {
      failure = result.message;
      if (uploaded_path) await remove_photo(uploaded_path);
    }
  }

  dom.write_submit.disabled = false;
  dom.write_submit.textContent = idle_label;

  if (failure) {
    // El texto y la foto elegida se quedan en pantalla para reintentar.
    show_write_error(`${failure} Tu texto sigue aquí.`);
    return;
  }

  // La foto anterior solo se borra cuando el cambio ya quedó guardado.
  if (is_editing && previous_path && previous_path !== image_path) await remove_photo(previous_path);

  if (is_editing) {
    editing_entry = null;
    set_notice("Cambios guardados.");
    navigate_to("pages_screen");
    return;
  }

  clearTimeout(save_unsent_timer);
  clear_unsent_text();
  dom.entry_content.value = "";
  dom.entry_title.value = "";
  dom.write_date.value = get_today_iso();
  dom.write_date_end.value = "";
  sync_date_inputs();
  reset_photo_state(null);
  show_celebration();
  dom.entry_content.focus({ preventScroll: true });
}
