// Fotos de las páginas del libro.
// Cada página puede tener una sola foto, siempre dentro de un marco fijo de proporción 4:3.
// Por eso la foto se recorta al centro y se reduce en el navegador ANTES de subirla: lo que se ve
// en la vista previa es exactamente lo que queda guardado, y todas las fotos miden lo mismo.
//
// Las fotos viven en un contenedor privado de Supabase Storage. Nunca tienen una dirección pública:
// para mostrarlas se pide un enlace temporal que se renueva cuando hace falta.
import { supabase_client } from "./auth.js";
import { describe_error } from "./utils.js";

const BUCKET_NAME = "book_images";
const PHOTO_WIDTH = 1200;
const PHOTO_HEIGHT = 900;
const PHOTO_QUALITY = 0.85;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const SIGNED_URL_SECONDS = 3600;
// Se reutiliza el enlace un poco menos que su duración, para no mostrar uno a punto de vencer.
const URL_REUSE_MILLISECONDS = 50 * 60 * 1000;

const url_cache = new Map();

// Recorta la foto al centro con la proporción del marco y la reduce. Devuelve { ok, blob } o { ok, message }.
export async function prepare_photo(file) {
  if (!file.type.startsWith("image/")) return { ok: false, message: "Ese archivo no es una imagen." };
  if (file.size > MAX_SOURCE_BYTES) return { ok: false, message: "La foto es demasiado grande. El máximo es 25 MB." };

  let bitmap;
  try {
    // "from-image" respeta la orientación de la cámara, así las fotos de celular no salen giradas.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      return { ok: false, message: "No pudimos leer esa foto. Prueba con otra, en formato JPG o PNG." };
    }
  }

  const target_ratio = PHOTO_WIDTH / PHOTO_HEIGHT;
  let crop_width = bitmap.width;
  let crop_height = bitmap.height;
  if (crop_width / crop_height > target_ratio) crop_width = Math.round(crop_height * target_ratio);
  else crop_height = Math.round(crop_width / target_ratio);
  const crop_x = Math.round((bitmap.width - crop_width) / 2);
  const crop_y = Math.round((bitmap.height - crop_height) / 2);

  // Una foto pequeña no se agranda: se conserva su resolución con la misma proporción.
  const output_width = Math.min(PHOTO_WIDTH, crop_width);
  const output_height = Math.round(output_width / target_ratio);

  const canvas = document.createElement("canvas");
  canvas.width = output_width;
  canvas.height = output_height;
  const context = canvas.getContext("2d");
  // El JPEG no tiene transparencia: el fondo blanco evita zonas negras en imágenes PNG.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, output_width, output_height);
  context.drawImage(bitmap, crop_x, crop_y, crop_width, crop_height, 0, 0, output_width, output_height);
  if (typeof bitmap.close === "function") bitmap.close();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", PHOTO_QUALITY));
  if (!blob) return { ok: false, message: "No pudimos preparar esa foto. Prueba con otra." };
  return { ok: true, blob };
}

// Cada subida usa un nombre nuevo para que un enlace antiguo nunca muestre una foto vieja.
export function build_photo_path(entry_id) {
  return `pages/${entry_id}-${Date.now()}.jpg`;
}

// La foto de la portada vive en su propia carpeta del mismo contenedor privado.
export function build_cover_photo_path() {
  return `cover/cover-${Date.now()}.jpg`;
}

export async function upload_photo(path, blob) {
  try {
    const { error } = await supabase_client.storage
      .from(BUCKET_NAME)
      .upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (error) return { ok: false, message: describe_error(error) };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: describe_error(error) };
  }
}

// Borra una foto. Si falla no se avisa: el peor caso es un archivo sin usar, no un dato perdido.
export async function remove_photo(path) {
  if (!path) return;
  url_cache.delete(path);
  try {
    await supabase_client.storage.from(BUCKET_NAME).remove([path]);
  } catch {
    // Sin conexión: el archivo queda sin usar y no afecta al libro.
  }
}

// Devuelve un enlace temporal para mostrar la foto, o null si no se pudo obtener.
export async function get_photo_url(path) {
  const cached = url_cache.get(path);
  if (cached && cached.expires_at > Date.now()) return cached.url;

  try {
    const { data, error } = await supabase_client.storage.from(BUCKET_NAME).createSignedUrl(path, SIGNED_URL_SECONDS);
    if (error || !data) return null;
    url_cache.set(path, { url: data.signedUrl, expires_at: Date.now() + URL_REUSE_MILLISECONDS });
    return data.signedUrl;
  } catch {
    return null;
  }
}

// Si un enlace dejó de funcionar (la pestaña estuvo abierta mucho tiempo), se descarta para pedir otro.
export function forget_photo_url(path) {
  url_cache.delete(path);
}

// Al cerrar sesión no debe quedar ningún enlace a las fotos.
export function clear_photo_cache() {
  url_cache.clear();
}
