// Portada del libro: la foto y los nombres que salen en ella, tanto en el libro 3D del inicio como en
// la primera hoja de la lectura. Se editan desde "Páginas y respaldo, Portada del libro".
//
// Todo vive en Supabase (tabla book_settings, una sola fila, y el contenedor privado de fotos): ni la foto ni los
// nombres están en archivos del repositorio, que es público. La foto se recorta 4:3 como las de las páginas.
import { supabase_client } from "./auth.js";
import { burst_hearts, set_home_book_cover } from "./animations.js";
import { build_cover_photo_path, get_photo_url, prepare_photo, remove_photo, upload_photo } from "./images.js";
import { describe_error } from "./utils.js";

const MAX_NAMES_LENGTH = 120;
// Códigos de "la tabla no existe": falta ejecutar el SQL de la portada en Supabase.
const MISSING_SETUP_CODES = ["42P01", "PGRST205"];
const MISSING_SETUP_MESSAGE = "Falta crear la portada en Supabase. Ejecuta el SQL de la sección de portada del PLAN.md y vuelve a intentar.";

let dom = {};
// Lo que hay guardado, y los cambios de foto que aún no se guardan
let saved = { names: "", photo_path: null };
let photo = { new_blob: null, preview_url: "", is_removed: false };
let is_saving = false;
let load_id = 0;

export function init_cover() {
  dom = {
    form: document.getElementById("cover_form"),
    names: document.getElementById("cover_names"),
    preview: document.getElementById("cover_photo_preview"),
    placeholder: document.getElementById("cover_photo_placeholder"),
    input: document.getElementById("cover_photo_input"),
    choose: document.getElementById("cover_photo_choose"),
    remove: document.getElementById("cover_photo_remove"),
    photo_error: document.getElementById("cover_photo_error"),
    error: document.getElementById("cover_error"),
    success: document.getElementById("cover_success"),
    submit: document.getElementById("cover_submit"),
  };

  dom.form.addEventListener("submit", handle_submit);
  dom.choose.addEventListener("click", () => dom.input.click());
  dom.input.addEventListener("change", handle_photo_chosen);
  dom.remove.addEventListener("click", handle_photo_remove);
}

// Se llama al cerrar sesión: no debe quedar ni la portada ni su foto en pantalla.
export function reset_cover() {
  load_id += 1;
  saved = { names: "", photo_path: null };
  clear_pending_photo();
  dom.form.reset();
  dom.preview.removeAttribute("src");
  hide_messages();
  show_photo();
  set_home_book_cover({ names: "", image: null });
}

// ---------------------------------------------------------------------------
// Acceso a datos. Nunca lanzan.
// ---------------------------------------------------------------------------

function join_names(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

// Devuelve { names, saved_names, photo_path }. Si todavía no se escribieron los nombres de la portada, se usan los de
// las dos cuentas. Si algo falla, la portada simplemente sale sin foto y sin nombres: el libro se lee igual.
export async function fetch_cover() {
  let saved_names = "";
  let photo_path = null;
  let setup_error = false;
  try {
    const { data, error } = await supabase_client.from("book_settings").select("cover_names, cover_photo_path").eq("id", 1).maybeSingle();
    if (error) setup_error = MISSING_SETUP_CODES.includes(error.code);
    else if (data) {
      saved_names = data.cover_names || "";
      photo_path = data.cover_photo_path || null;
    }
  } catch {
    // Sin conexión: se sigue con una portada vacía.
  }

  let names = saved_names;
  if (!names) {
    try {
      const { data, error } = await supabase_client.from("profiles").select("display_name");
      if (!error) names = join_names(data.map((profile) => profile.display_name).filter(Boolean));
    } catch {
      // Sin los nombres de las cuentas, la portada no muestra nombres.
    }
  }
  return { names, saved_names, photo_path, setup_error };
}

async function save_cover(names, photo_path) {
  try {
    const { error } = await supabase_client
      .from("book_settings")
      .upsert({ id: 1, cover_names: names || null, cover_photo_path: photo_path, updated_at: new Date().toISOString() });
    if (error) return { ok: false, message: MISSING_SETUP_CODES.includes(error.code) ? MISSING_SETUP_MESSAGE : describe_error(error) };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: describe_error(error) };
  }
}

// ---------------------------------------------------------------------------
// Libro 3D del inicio
// ---------------------------------------------------------------------------

function load_image(url) {
  return new Promise((resolve) => {
    const image = new Image();
    // Sin esto el navegador no deja usar la foto como textura 3D
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

// Trae la portada y se la da al libro 3D del inicio. Se llama al iniciar sesión y al guardar cambios.
export async function refresh_home_book_cover() {
  const request = ++load_id;
  const cover = await fetch_cover();
  let image = null;
  if (cover.photo_path) {
    const url = await get_photo_url(cover.photo_path);
    if (url) image = await load_image(url);
  }
  // Si mientras tanto se cerró sesión o hubo otro pedido más nuevo, este resultado ya no sirve.
  if (request !== load_id) return;
  set_home_book_cover({ names: cover.names, image });
}

// ---------------------------------------------------------------------------
// Panel "Portada del libro"
// ---------------------------------------------------------------------------

export async function on_cover_panel_shown() {
  hide_messages();
  clear_pending_photo();
  const cover = await fetch_cover();
  saved = { names: cover.saved_names, photo_path: cover.photo_path };
  dom.names.value = cover.names;
  if (cover.setup_error) show_error(MISSING_SETUP_MESSAGE);
  await show_photo();
}

function hide_messages() {
  dom.error.textContent = "";
  dom.error.hidden = true;
  dom.photo_error.textContent = "";
  dom.photo_error.hidden = true;
  dom.success.textContent = "";
  dom.success.hidden = true;
}

function show_error(message) {
  dom.error.textContent = message;
  dom.error.hidden = false;
}

function clear_pending_photo() {
  if (photo.preview_url) URL.revokeObjectURL(photo.preview_url);
  photo = { new_blob: null, preview_url: "", is_removed: false };
}

function has_photo() {
  return Boolean(photo.new_blob) || Boolean(saved.photo_path && !photo.is_removed);
}

// Muestra en el marco la foto elegida o, si no hay cambios, la que está guardada.
async function show_photo() {
  dom.placeholder.hidden = has_photo();
  dom.preview.hidden = true;
  dom.remove.hidden = !has_photo();
  dom.choose.lastChild.textContent = has_photo() ? " Cambiar foto" : " Elegir foto";

  if (photo.new_blob) {
    dom.preview.src = photo.preview_url;
    dom.preview.hidden = false;
    return;
  }
  if (!saved.photo_path || photo.is_removed) return;

  const requested_path = saved.photo_path;
  const url = await get_photo_url(requested_path);
  // La persona pudo elegir otra foto mientras llegaba el enlace
  if (!url || saved.photo_path !== requested_path || photo.new_blob || photo.is_removed) return;
  dom.preview.src = url;
  dom.preview.hidden = false;
}

async function handle_photo_chosen() {
  const file = dom.input.files[0];
  dom.input.value = "";
  if (!file) return;
  dom.photo_error.hidden = true;

  const result = await prepare_photo(file);
  if (!result.ok) {
    dom.photo_error.textContent = result.message;
    dom.photo_error.hidden = false;
    return;
  }
  clear_pending_photo();
  photo.new_blob = result.blob;
  photo.preview_url = URL.createObjectURL(result.blob);
  await show_photo();
}

function handle_photo_remove() {
  clear_pending_photo();
  photo.is_removed = Boolean(saved.photo_path);
  show_photo();
}

async function handle_submit(event) {
  event.preventDefault();
  if (is_saving) return;
  hide_messages();

  const names = dom.names.value.trim().replace(/\s+/g, " ");
  if (names.length > MAX_NAMES_LENGTH) {
    show_error(`Los nombres pueden tener hasta ${MAX_NAMES_LENGTH} letras.`);
    dom.names.focus();
    return;
  }

  // Se bloquea el botón mientras responde el servidor para evitar envíos dobles.
  is_saving = true;
  dom.submit.disabled = true;

  // Orden seguro: primero se sube la foto nueva, después se guarda la portada y solo entonces se borra la foto vieja.
  let next_path = photo.is_removed ? null : saved.photo_path;
  let uploaded_path = null;
  if (photo.new_blob) {
    uploaded_path = build_cover_photo_path();
    const uploaded = await upload_photo(uploaded_path, photo.new_blob);
    if (!uploaded.ok) {
      finish_saving();
      show_error(uploaded.message);
      return;
    }
    next_path = uploaded_path;
  }

  const result = await save_cover(names, next_path);
  if (!result.ok) {
    // La foto subida no quedó en uso: se borra para no dejar archivos sueltos
    await remove_photo(uploaded_path);
    finish_saving();
    show_error(result.message);
    return;
  }

  if (saved.photo_path && saved.photo_path !== next_path) await remove_photo(saved.photo_path);
  saved = { names, photo_path: next_path };
  clear_pending_photo();
  finish_saving();
  await show_photo();
  dom.success.textContent = "Portada guardada.";
  dom.success.hidden = false;
  burst_hearts();
  refresh_home_book_cover();
}

function finish_saving() {
  is_saving = false;
  dom.submit.disabled = false;
}
