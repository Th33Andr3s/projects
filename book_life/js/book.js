// Lectura del libro: reparte el texto en páginas reales, las muestra como un libro físico
// (doble página en pantallas anchas, una sola en celular) y permite pasar de página.
//
// Cómo se reparte el texto: cada entrada empieza en una página nueva. Un texto largo se parte
// en varias páginas midiendo, en una página invisible del mismo tamaño, cuánto cabe de verdad.
//
// Uso de recursos: el libro nunca se descarga completo. La base entrega las entradas en trozos
// de 20, ya ordenadas. En memoria solo viven el trozo que se lee y sus vecinos; el trozo
// siguiente se pide un poco antes de llegar al borde para que pasar de hoja no espere, y los
// pedidos que dejan de servir se cancelan. Por eso las páginas se numeran por entrada ("Entrada
// 37 de 1000") y no por hoja: contar las hojas de todo el libro exigiría descargarlo entero.
import { supabase_client } from "./auth.js";
import { play_page_turn, play_celebration, stop_celebration } from "./animations.js";
import { get_photo_url, forget_photo_url } from "./images.js";
import { fetch_cover } from "./cover.js";
import { create_element, describe_error, format_date_range, order_book } from "./utils.js";

const TWO_PAGE_QUERY = window.matchMedia("(min-width: 900px)");
const SWIPE_MIN_DISTANCE = 48;
const SWIPE_DIRECTION_RATIO = 1.5;
const RELAYOUT_DELAY_MILLISECONDS = 200;
const JUMP_FADE_MILLISECONDS = 260;
// Una página medida con menos que esto significa que la ventana aún no tiene su tamaño real.
const MIN_MEASURABLE_PAGE_SIZE = 120;

const CHUNK_SIZE = 20;
// Trozos que se conservan a cada lado del actual. Con 1 hay como máximo 3 trozos (60 entradas) en memoria.
const CHUNKS_KEPT_EACH_SIDE = 1;
// A cuántas entradas del borde de un trozo se pide el vecino.
const PREFETCH_DISTANCE = 5;
const ENTRY_COLUMNS = "id, entry_date, entry_date_end, title, content, order_index, image_path";
const END_CELEBRATION_MILLISECONDS = 4200;
const LOAD_ERROR_MESSAGE = "No se pudo cargar esa parte del libro. Revisa tu internet e inténtalo de nuevo.";

let dom = {};

let total_entries = 0;
let cover_info = { names: "", photo_path: null };
const loaded_chunks = new Map(); // número de trozo -> entradas
const pending_chunks = new Map(); // número de trozo -> { promise, controller }
const entry_pages_cache = new Map(); // posición de la entrada -> sus páginas ya repartidas
// Entradas con las que empieza un capítulo: posición de la entrada -> { number, title }. Son pocas y se piden de una vez.
const chapter_starts = new Map();

let is_two_page = false;
let view = { cursor: null, positions: [], pages: [] };
let is_busy = false;
let relayout_timer = 0;
let measured_size = "";
let swipe_start = null;
let is_end_celebrated = false;

// ---------------------------------------------------------------------------
// Inicio y estado
// ---------------------------------------------------------------------------

export function init_book() {
  dom = {
    reader_screen: document.getElementById("read_screen"),
    reader_status: document.getElementById("reader_status"),
    reader_retry: document.getElementById("reader_retry"),
    book_viewport: document.getElementById("book_viewport"),
    book: document.getElementById("book"),
    spread: document.getElementById("spread"),
    leaf_layer: document.getElementById("leaf_layer"),
    ruler: document.getElementById("page_ruler"),
    page_prev: document.getElementById("page_prev"),
    page_next: document.getElementById("page_next"),
    page_indicator: document.getElementById("page_indicator"),
    page_slider: document.getElementById("page_slider"),
    end_celebration: document.getElementById("end_celebration"),
  };

  dom.reader_retry.addEventListener("click", on_read_shown);
  dom.page_prev.addEventListener("click", () => turn(-1));
  dom.page_next.addEventListener("click", () => turn(1));
  // Mientras se arrastra la barra solo cambia el texto; el salto se hace al soltar, para no pedir datos de más.
  dom.page_slider.addEventListener("input", handle_slider_input);
  dom.page_slider.addEventListener("change", handle_slider_change);
  document.addEventListener("keydown", handle_keydown);
  dom.book.addEventListener("pointerdown", handle_pointer_down);
  dom.book.addEventListener("pointerup", handle_pointer_up);
  dom.book.addEventListener("pointercancel", () => {
    swipe_start = null;
  });

  window.addEventListener("resize", () => schedule_relayout(false));
  TWO_PAGE_QUERY.addEventListener("change", () => schedule_relayout(false));
  // Si la tipografía termina de cargar después de medir, hay que volver a repartir el texto.
  if (document.fonts) document.fonts.addEventListener("loadingdone", () => schedule_relayout(true));
}

function cancel_pending_requests() {
  pending_chunks.forEach((pending) => pending.controller.abort());
  pending_chunks.clear();
}

function clear_book_data() {
  cancel_pending_requests();
  loaded_chunks.clear();
  entry_pages_cache.clear();
  chapter_starts.clear();
  total_entries = 0;
  cover_info = { names: "", photo_path: null };
  view = { cursor: null, positions: [], pages: [] };
  measured_size = "";
}

// Se llama al cerrar sesión: no debe quedar nada del libro en pantalla ni pedidos pendientes.
export function reset_book() {
  clear_book_data();
  is_busy = false;
  is_end_celebrated = false;
  stop_celebration(dom.end_celebration);
  clearTimeout(relayout_timer);
  dom.spread.replaceChildren();
  dom.leaf_layer.replaceChildren();
  dom.book_viewport.hidden = true;
  dom.reader_retry.hidden = true;
  dom.reader_status.textContent = "";
}

// ---------------------------------------------------------------------------
// Carga de datos por trozos
// ---------------------------------------------------------------------------

// Pide solo lo mínimo para empezar: cuántas entradas hay, los capítulos y la portada (foto y nombres).
async function fetch_book_summary() {
  try {
    const [count_result, chapters_result, cover] = await Promise.all([
      supabase_client.from("book_entries").select("id", { count: "exact", head: true }),
      supabase_client.rpc("book_chapter_list"),
      fetch_cover(),
    ]);
    if (count_result.error) return { ok: false, message: describe_error(count_result.error) };

    return {
      ok: true,
      total: count_result.count ?? 0,
      cover: { names: cover.names, photo_path: cover.photo_path },
      // Si los capítulos fallan, el libro se lee igual, solo que sin hojas de capítulo.
      chapters: chapters_result.error ? [] : chapters_result.data,
    };
  } catch (error) {
    return { ok: false, message: describe_error(error) };
  }
}

function chunk_of(offset) {
  return Math.floor(offset / CHUNK_SIZE);
}

// Pide un trozo de 20 entradas. Si ya está cargado o ya se está pidiendo, no se repite el pedido.
function load_chunk(chunk_index) {
  if (loaded_chunks.has(chunk_index)) return Promise.resolve(true);
  if (pending_chunks.has(chunk_index)) return pending_chunks.get(chunk_index).promise;

  const controller = new AbortController();
  const promise = (async () => {
    try {
      const first = chunk_index * CHUNK_SIZE;
      const query = supabase_client.from("book_entries").select(ENTRY_COLUMNS);
      const { data, error } = await order_book(query, true).range(first, first + CHUNK_SIZE - 1).abortSignal(controller.signal);
      if (error) return false;
      loaded_chunks.set(chunk_index, data);
      return true;
    } catch {
      return false;
    } finally {
      pending_chunks.delete(chunk_index);
    }
  })();

  pending_chunks.set(chunk_index, { promise, controller });
  return promise;
}

function get_loaded_entry(offset) {
  const chunk = loaded_chunks.get(chunk_of(offset));
  return chunk ? chunk[offset % CHUNK_SIZE] ?? null : null;
}

async function ensure_entry(offset) {
  const loaded = await load_chunk(chunk_of(offset));
  if (!loaded) throw new Error("No se pudo cargar el trozo del libro");
  return get_loaded_entry(offset);
}

// Suelta de memoria los trozos lejanos, cancela sus pedidos y adelanta el vecino si hace falta.
function housekeeping() {
  const offset = get_view_offset();
  const current_chunk = chunk_of(offset);

  for (const chunk_index of [...loaded_chunks.keys()]) {
    if (Math.abs(chunk_index - current_chunk) <= CHUNKS_KEPT_EACH_SIDE) continue;
    loaded_chunks.delete(chunk_index);
    // Las páginas ya repartidas de esas entradas también se sueltan.
    for (const cached_offset of [...entry_pages_cache.keys()]) {
      if (chunk_of(cached_offset) === chunk_index) entry_pages_cache.delete(cached_offset);
    }
  }
  for (const [chunk_index, pending] of [...pending_chunks]) {
    if (Math.abs(chunk_index - current_chunk) <= CHUNKS_KEPT_EACH_SIDE) continue;
    pending.controller.abort();
    pending_chunks.delete(chunk_index);
  }

  // El trozo actual siempre se asegura: al volver a la portada, la primera hoja ya está lista.
  load_chunk(current_chunk);
  const position_in_chunk = offset % CHUNK_SIZE;
  const last_chunk = chunk_of(Math.max(0, total_entries - 1));
  if (position_in_chunk >= CHUNK_SIZE - PREFETCH_DISTANCE && current_chunk < last_chunk) load_chunk(current_chunk + 1);
  if (position_in_chunk < PREFETCH_DISTANCE && current_chunk > 0) load_chunk(current_chunk - 1);
}

// La tipografía debe estar cargada antes de medir, o el texto cambiaría de tamaño después.
async function load_fonts() {
  if (!document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load("1rem Lora"),
      document.fonts.load("italic 1rem Lora"),
      document.fonts.load("700 1rem Lora"),
    ]);
  } catch {
    // Sin la fuente se usa una de respaldo; el libro funciona igual.
  }
}

// Guarda con qué entrada empieza cada capítulo. La base ya calculó esa posición (first_offset). Un capítulo sin
// páginas no aparece, y los capítulos se numeran en el orden en que aparecen.
function register_chapters(chapters) {
  chapter_starts.clear();
  let number = 0;
  [...chapters]
    .sort((first, second) => first.start_date.localeCompare(second.start_date))
    .forEach((chapter) => {
      const offset = Number(chapter.first_offset);
      if (Number(chapter.entry_count) <= 0 || offset < 0 || offset >= total_entries || chapter_starts.has(offset)) return;
      number += 1;
      chapter_starts.set(offset, { number, title: chapter.title });
    });
}

export async function on_read_shown() {
  clear_book_data();
  dom.reader_retry.hidden = true;
  dom.book_viewport.hidden = true;
  dom.reader_status.textContent = "Abriendo el libro...";

  const summary = await fetch_book_summary();
  // Si la persona salió de la pantalla mientras cargaba, no se dibuja nada.
  if (dom.reader_screen.hidden) return;

  if (!summary.ok) {
    dom.reader_status.textContent = summary.message;
    dom.reader_retry.hidden = false;
    return;
  }
  if (summary.total === 0) {
    dom.reader_status.textContent = "El libro aún no tiene páginas. Escribe la primera desde “Escribir en el libro”.";
    return;
  }

  total_entries = summary.total;
  register_chapters(summary.chapters);
  cover_info = summary.cover;

  // El primer trozo se pide antes de mostrar nada: es lo único que hace falta para empezar a leer.
  const first_chunk_loaded = await load_chunk(0);
  await load_fonts();
  if (dom.reader_screen.hidden) return;
  if (!first_chunk_loaded) {
    dom.reader_status.textContent = LOAD_ERROR_MESSAGE;
    dom.reader_retry.hidden = false;
    return;
  }

  dom.reader_status.textContent = "";
  dom.book_viewport.hidden = false;
  await layout(null);
}

// ---------------------------------------------------------------------------
// Reparto del texto en páginas
// ---------------------------------------------------------------------------

function split_paragraphs(text) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

// Separa un texto en palabras conservando los espacios exactos entre ellas.
function tokenize(text) {
  return text.split(/(\s+)/);
}

function take_words(tokens, word_count) {
  return tokens.slice(0, word_count * 2 - 1).join("");
}

// Marco fijo de la foto: siempre el mismo tamaño, centrado, justo después del título.
// La foto real se pide después (hydrate_page_photos); el marco ya ocupa su lugar para poder medir la página.
function create_photo_frame(image_path) {
  const frame = create_element("div", "page_photo");
  const icon = create_element("i", "fa-regular fa-image page_photo_icon");
  icon.setAttribute("aria-hidden", "true");
  const image = create_element("img", "photo_image");
  image.alt = "Foto de esta página";
  image.hidden = true;
  image.dataset.path = image_path;
  frame.append(icon, image);
  return frame;
}

// Carga las fotos de una página ya dibujada, con enlaces temporales. Si algo falla queda el marco con su icono.
function hydrate_page_photos(article) {
  article.querySelectorAll("img[data-path]").forEach(async (image) => {
    const path = image.dataset.path;
    image.addEventListener("load", () => {
      image.hidden = false;
    });
    image.addEventListener("error", async () => {
      // Un enlace vencido se reemplaza una sola vez por uno nuevo.
      if (image.dataset.retried) return;
      image.dataset.retried = "true";
      forget_photo_url(path);
      const fresh_url = await get_photo_url(path);
      if (fresh_url) image.src = fresh_url;
    });
    const url = await get_photo_url(path);
    if (url) image.src = url;
  });
}

function create_ornament() {
  const ornament = create_element("div", "page_ornament");
  ornament.setAttribute("aria-hidden", "true");
  ornament.innerHTML = '<i class="fa-solid fa-star"></i><i class="fa-solid fa-heart"></i><i class="fa-solid fa-star"></i>';
  return ornament;
}

function create_block_nodes(block) {
  if (block.type === "header") {
    const nodes = [];
    const { entry } = block;
    if (entry.entry_date) nodes.push(create_element("p", "page_date", format_date_range(entry.entry_date, entry.entry_date_end)));
    if (entry.title) nodes.push(create_element("h3", "page_heading", entry.title));
    if (entry.image_path) nodes.push(create_photo_frame(entry.image_path));
    nodes.push(create_ornament());
    return nodes;
  }

  if (block.type === "paragraph") {
    return [create_element("p", block.drop_cap ? "page_paragraph has_drop_cap" : "page_paragraph", block.text)];
  }

  // Portada: el título, la foto y los nombres. Sin foto queda un corazón en su lugar.
  if (block.type === "cover") {
    const nodes = [create_element("h3", "cover_title", "Libro de vida")];
    if (block.photo_path) {
      nodes.push(create_photo_frame(block.photo_path));
    } else {
      const emblem = create_element("div", "cover_emblem");
      emblem.setAttribute("aria-hidden", "true");
      emblem.innerHTML = '<i class="fa-solid fa-heart"></i>';
      nodes.push(emblem);
    }
    if (block.names) nodes.push(create_element("p", "cover_names", block.names));
    return nodes;
  }

  if (block.type === "chapter") {
    const emblem = create_element("div", "cover_emblem");
    emblem.setAttribute("aria-hidden", "true");
    emblem.innerHTML = '<i class="fa-solid fa-star"></i>';
    return [emblem, create_element("p", "chapter_number", `Capítulo ${block.number}`), create_element("h3", "cover_title", block.title), create_ornament()];
  }

  // Página final
  const emblem = create_element("div", "cover_emblem");
  emblem.setAttribute("aria-hidden", "true");
  emblem.innerHTML = '<i class="fa-solid fa-infinity"></i>';
  return [emblem, create_element("h3", "cover_title", "Continuará…"), create_element("p", "cover_span", "Nuestra historia sigue escribiéndose.")];
}

function create_content_nodes(blocks) {
  return blocks.flatMap(create_block_nodes);
}

// Reparte UNA entrada en las páginas que ocupa, midiendo contra la página invisible.
function paginate_entry(entry, offset) {
  const ruler_body = dom.ruler.querySelector(".page_body");
  // Cabe si el contenido no desborda la página. El relleno inferior de la página da un pequeño margen.
  const fits = (blocks) => {
    ruler_body.replaceChildren(...create_content_nodes(blocks));
    return ruler_body.scrollHeight <= ruler_body.clientHeight;
  };

  // Cuántas palabras de un párrafo caben en la página actual, buscando por mitades.
  const count_fitting_words = (blocks, text, drop_cap) => {
    const tokens = tokenize(text);
    const total_words = Math.ceil(tokens.length / 2);
    let low = 0;
    let high = total_words - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = { type: "paragraph", text: take_words(tokens, middle), drop_cap };
      if (fits([...blocks, candidate])) low = middle;
      else high = middle - 1;
    }
    return low;
  };

  let blocks = [{ type: "header", entry }];
  let is_first_paragraph = true;
  const entry_pages = [];

  const close_page = () => {
    entry_pages.push({ kind: "entry", offset, index_in_entry: entry_pages.length, blocks });
    blocks = [];
  };

  for (const paragraph of split_paragraphs(entry.content)) {
    let rest = paragraph;
    while (rest) {
      const whole = { type: "paragraph", text: rest, drop_cap: is_first_paragraph };
      if (fits([...blocks, whole])) {
        blocks.push(whole);
        is_first_paragraph = false;
        break;
      }

      const fitting_words = count_fitting_words(blocks, rest, is_first_paragraph);
      const page_has_text = blocks.some((block) => block.type === "paragraph");
      // Si el encabezado con foto llena la página, se deja sola y el texto sigue en la siguiente.
      const header_has_photo = blocks.some((block) => block.type === "header" && block.entry.image_path);
      if (fitting_words === 0 && (page_has_text || header_has_photo)) {
        close_page();
        continue;
      }

      // Si no cabe ni una palabra en una página vacía, se fuerza una para no quedar en un ciclo.
      const words_to_take = Math.max(1, fitting_words);
      const tokens = tokenize(rest);
      blocks.push({ type: "paragraph", text: take_words(tokens, words_to_take), drop_cap: is_first_paragraph });
      is_first_paragraph = false;
      close_page();
      rest = tokens.slice(words_to_take * 2).join("");
    }
  }
  if (blocks.length > 0) close_page();
  ruler_body.replaceChildren();

  // Cada página sabe cuántas tiene su entrada, para el número al pie y para ubicarse al repartir de nuevo.
  entry_pages.forEach((page) => {
    page.entry_page_total = entry_pages.length;
    page.footer_text = entry_pages.length > 1 ? `${offset + 1} · ${page.index_in_entry + 1}/${entry_pages.length}` : String(offset + 1);
    page.label = entry_pages.length > 1 ? `Entrada ${offset + 1}, hoja ${page.index_in_entry + 1}` : `Entrada ${offset + 1}`;
  });
  return entry_pages;
}

function get_entry_pages(offset) {
  if (!entry_pages_cache.has(offset)) {
    entry_pages_cache.set(offset, paginate_entry(get_loaded_entry(offset), offset));
  }
  return entry_pages_cache.get(offset);
}

async function entry_page_count(offset) {
  await ensure_entry(offset);
  return get_entry_pages(offset).length;
}

// ---------------------------------------------------------------------------
// Posiciones: dónde está cada página dentro del libro
// ---------------------------------------------------------------------------
// Una posición es { offset, index }. offset -1 es la portada (index 0) o la tapa en blanco (index -1);
// offset igual al total es la página final (index 0) o la hoja en blanco que la acompaña (index 1);
// cualquier otro offset es una entrada y index es su hoja. Si con esa entrada empieza un capítulo, la hoja
// con el nombre del capítulo es index -1: va justo antes de la primera hoja de la entrada.

function is_blank_tail(position) {
  return Boolean(position) && position.offset === total_entries && position.index >= 1;
}

async function page_at(position) {
  if (!position) return null;
  if (position.offset === -1) return position.index === 0 ? { kind: "cover", label: "Portada", blocks: [{ type: "cover", ...cover_info }] } : null;
  if (position.offset === total_entries) return position.index === 0 ? { kind: "end", label: "Final", blocks: [{ type: "end" }] } : null;
  if (position.index === -1) {
    const chapter = chapter_starts.get(position.offset);
    if (!chapter) return null;
    return {
      kind: "chapter",
      offset: position.offset,
      label: `Capítulo ${chapter.number}: ${chapter.title}`,
      footer_text: "",
      blocks: [{ type: "chapter", number: chapter.number, title: chapter.title }],
    };
  }
  await ensure_entry(position.offset);
  return get_entry_pages(position.offset)[position.index] ?? null;
}

// Primera hoja de una entrada: la de su capítulo, si con ella empieza uno.
function entry_start(offset) {
  return { offset, index: offset < total_entries && chapter_starts.has(offset) ? -1 : 0 };
}

async function next_position(position) {
  if (position.offset === -1) return position.index < 0 ? { offset: -1, index: 0 } : entry_start(0);
  if (position.offset === total_entries) return position.index === 0 ? { offset: total_entries, index: 1 } : null;
  if (position.index === -1) return { offset: position.offset, index: 0 };
  const count = await entry_page_count(position.offset);
  if (position.index + 1 < count) return { offset: position.offset, index: position.index + 1 };
  // Puede ser la página final cuando era la última entrada.
  return entry_start(position.offset + 1);
}

async function prev_position(position) {
  if (position.offset === -1) return position.index === 0 ? { offset: -1, index: -1 } : null;
  if (position.offset === total_entries) {
    if (position.index > 0) return { offset: total_entries, index: position.index - 1 };
    return { offset: total_entries - 1, index: (await entry_page_count(total_entries - 1)) - 1 };
  }
  if (position.index > 0) return { offset: position.offset, index: position.index - 1 };
  // En la primera hoja de la entrada: antes va la hoja de su capítulo, si empieza uno aquí
  if (position.index === 0 && chapter_starts.has(position.offset)) return { offset: position.offset, index: -1 };
  if (position.offset === 0) return { offset: -1, index: 0 };
  return { offset: position.offset - 1, index: (await entry_page_count(position.offset - 1)) - 1 };
}

// A dónde lleva "siguiente" o "anterior": una hoja en pantalla única, dos en doble página.
async function next_cursor(cursor) {
  let target = await next_position(cursor);
  if (target && is_two_page) target = await next_position(target);
  return target && !is_blank_tail(target) ? target : null;
}

async function prev_cursor(cursor) {
  let target = await prev_position(cursor);
  if (target && is_two_page) target = await prev_position(target);
  // La tapa en blanco sola no es una vista válida en pantalla única.
  if (target && !is_two_page && target.offset === -1 && target.index === -1) return null;
  return target;
}

// Ajusta una posición a las reglas del modo actual (tapa en blanco solo en doble página, etc.).
function normalize_cursor(cursor) {
  if (cursor.offset === -1) return is_two_page ? { offset: -1, index: -1 } : { offset: -1, index: 0 };
  if (cursor.offset === total_entries) return { offset: total_entries, index: 0 };
  return cursor;
}

// Reúne las páginas de una vista, pidiendo a la base lo que falte. Falla si no se puede cargar.
async function resolve_view(cursor) {
  const positions = is_two_page ? [cursor, await next_position(cursor)] : [cursor];
  const pages = [];
  for (const position of positions) pages.push(await page_at(position));
  return { cursor, positions, pages };
}

// Entrada que se está leyendo: sirve para saber qué trozos conservar.
function get_view_offset() {
  const entry_position = view.positions.find((position) => position && position.offset >= 0 && position.offset < total_entries);
  if (entry_position) return entry_position.offset;
  return view.positions.some((position) => position && position.offset === total_entries) ? Math.max(0, total_entries - 1) : 0;
}

// Casilla de la barra: 0 portada, 1 a total las entradas, total + 1 la página final.
function get_view_slot() {
  const entry_position = view.positions.find((position) => position && position.offset >= 0 && position.offset < total_entries);
  if (entry_position) return entry_position.offset + 1;
  return view.positions.some((position) => position && position.offset === total_entries) ? total_entries + 1 : 0;
}

// ---------------------------------------------------------------------------
// Distribución y dibujo
// ---------------------------------------------------------------------------

function get_anchor() {
  const page = view.pages.find(Boolean);
  if (!page) return null;
  if (page.kind === "chapter") return { kind: "chapter", offset: page.offset };
  if (page.kind !== "entry") return { kind: page.kind };
  return {
    kind: "entry",
    offset: page.offset,
    ratio: page.entry_page_total > 1 ? page.index_in_entry / (page.entry_page_total - 1) : 0,
  };
}

function set_busy(busy) {
  is_busy = busy;
  dom.book.setAttribute("aria-busy", String(busy));
  if (busy) {
    dom.page_prev.disabled = true;
    dom.page_next.disabled = true;
  }
}

// Reparte de nuevo el texto con el tamaño actual y vuelve al mismo punto de lectura.
async function layout(anchor) {
  is_two_page = TWO_PAGE_QUERY.matches;
  dom.book.dataset.mode = is_two_page ? "double" : "single";

  const ruler_body = dom.ruler.querySelector(".page_body");
  // Si la ventana todavía no tiene tamaño, medir daría cientos de páginas diminutas: se espera y se reintenta.
  if (ruler_body.clientWidth < MIN_MEASURABLE_PAGE_SIZE || ruler_body.clientHeight < MIN_MEASURABLE_PAGE_SIZE) {
    schedule_relayout(true);
    return;
  }
  measured_size = `${is_two_page}|${ruler_body.clientWidth}x${ruler_body.clientHeight}`;

  set_busy(true);
  try {
    entry_pages_cache.clear();
    let target;
    if (!anchor || anchor.kind === "cover") target = { offset: -1, index: 0 };
    else if (anchor.kind === "end") target = { offset: total_entries, index: 0 };
    else if (anchor.kind === "chapter") target = entry_start(anchor.offset);
    else {
      const count = await entry_page_count(anchor.offset);
      target = { offset: anchor.offset, index: Math.round(anchor.ratio * (count - 1)) };
    }
    const cursor = normalize_cursor(target);
    view = await resolve_view(cursor);
    render_view();
    dom.reader_status.textContent = "";
    housekeeping();
  } catch {
    dom.reader_status.textContent = LOAD_ERROR_MESSAGE;
  } finally {
    set_busy(false);
    update_controls();
  }
}

// Se vuelve a repartir el texto cuando cambia el tamaño de la pantalla o la tipografía.
function schedule_relayout(force) {
  if (dom.reader_screen.hidden || dom.book_viewport.hidden || total_entries === 0) return;
  clearTimeout(relayout_timer);
  relayout_timer = setTimeout(() => {
    if (is_busy) {
      schedule_relayout(force);
      return;
    }
    const ruler_body = dom.ruler.querySelector(".page_body");
    const next_size = `${TWO_PAGE_QUERY.matches}|${ruler_body.clientWidth}x${ruler_body.clientHeight}`;
    if (!force && next_size === measured_size) return;
    layout(get_anchor());
  }, RELAYOUT_DELAY_MILLISECONDS);
}

function create_page_element(page, side) {
  const article = create_element("article", `page page_${side}`);
  if (!page) {
    article.classList.add("is_blank");
    article.setAttribute("aria-hidden", "true");
    return article;
  }
  article.classList.add(`kind_${page.kind}`);
  article.setAttribute("aria-label", page.label);
  const body = create_element("div", "page_body");
  body.append(...create_content_nodes(page.blocks));
  article.append(body, create_element("footer", "page_number", page.footer_text || ""));
  hydrate_page_photos(article);
  return article;
}

function render_spread(left_page, right_page) {
  if (!is_two_page) {
    dom.spread.replaceChildren(create_page_element(right_page, "single"));
    return;
  }
  const spine = create_element("div", "spine");
  spine.setAttribute("aria-hidden", "true");
  dom.spread.replaceChildren(create_page_element(left_page, "left"), spine, create_page_element(right_page, "right"));
}

function describe_view(current_view) {
  const visible = current_view.pages.filter(Boolean);
  const entry_pages = visible.filter((page) => page.kind === "entry");
  if (entry_pages.length === 0) return visible[0]?.label || "";

  const entry_numbers = [...new Set(entry_pages.map((page) => page.offset + 1))];
  if (entry_numbers.length === 2) return `Entradas ${entry_numbers[0]} y ${entry_numbers[1]} de ${total_entries}`;

  let text = `Entrada ${entry_numbers[0]} de ${total_entries}`;
  const sheets = entry_pages[0].entry_page_total;
  if (sheets > 1) {
    const numbers = entry_pages.map((page) => page.index_in_entry + 1);
    text += numbers.length === 2 ? ` · hojas ${numbers[0]} y ${numbers[1]} de ${sheets}` : ` · hoja ${numbers[0]} de ${sheets}`;
  }
  return text;
}

function render_view() {
  if (is_two_page) render_spread(view.pages[0], view.pages[1]);
  else render_spread(null, view.pages[0]);
  update_controls();
  celebrate_the_end();
}

// Al llegar a la última página llueven corazones, una sola vez por llegada: si se queda ahí no se repite.
function celebrate_the_end() {
  const is_end_visible = view.positions.some((position) => position && position.offset === total_entries);
  if (is_end_visible && !is_end_celebrated) play_celebration(dom.end_celebration, END_CELEBRATION_MILLISECONDS);
  if (!is_end_visible) stop_celebration(dom.end_celebration);
  is_end_celebrated = is_end_visible;
}

function update_controls() {
  const description = describe_view(view);
  const at_start = !view.cursor || view.cursor.offset === -1;
  const at_end = !view.cursor || view.positions.some((position) => position && position.offset === total_entries);

  dom.page_prev.disabled = is_busy || at_start;
  dom.page_next.disabled = is_busy || at_end;
  dom.page_indicator.textContent = description;
  dom.page_slider.max = String(total_entries + 1);
  dom.page_slider.value = String(get_view_slot());
  dom.page_slider.setAttribute("aria-valuetext", description);
}

// ---------------------------------------------------------------------------
// Pasar de página
// ---------------------------------------------------------------------------

function create_leaf(kind, front_page, back_page) {
  const leaf = create_element("div", `leaf leaf_${kind}`);
  const front = create_element("div", "leaf_face leaf_front");
  front.append(front_page, create_element("span", "leaf_shade"));
  leaf.append(front);
  if (back_page) {
    const back = create_element("div", "leaf_face leaf_back");
    back.append(back_page, create_element("span", "leaf_shade"));
    leaf.append(back);
  }
  return leaf;
}

// direction: 1 avanza, -1 retrocede.
async function turn(direction) {
  if (is_busy || !view.cursor) return;
  set_busy(true);

  try {
    // Todo lo que pueda tardar (pedir datos) ocurre antes de tocar la pantalla: si falla, no se cambia nada.
    const target_cursor = direction > 0 ? await next_cursor(view.cursor) : await prev_cursor(view.cursor);
    if (!target_cursor) return;
    const old_view = view;
    const new_view = await resolve_view(target_cursor);

    let leaf;
    if (is_two_page) {
      const [old_left, old_right] = old_view.pages;
      const [new_left, new_right] = new_view.pages;
      if (direction > 0) {
        // Debajo queda lo que se descubre: la hoja nueva de la derecha.
        render_spread(old_left, new_right);
        leaf = create_leaf("forward", create_page_element(old_right, "right"), create_page_element(new_left, "left"));
      } else {
        render_spread(new_left, old_right);
        leaf = create_leaf("backward", create_page_element(old_left, "left"), create_page_element(new_right, "right"));
      }
    } else if (direction > 0) {
      render_spread(null, new_view.pages[0]);
      leaf = create_leaf("single_forward", create_page_element(old_view.pages[0], "single"), null);
    } else {
      render_spread(null, old_view.pages[0]);
      leaf = create_leaf("single_backward", create_page_element(new_view.pages[0], "single"), null);
    }

    dom.leaf_layer.replaceChildren(leaf);
    await play_page_turn(leaf, { two_page: is_two_page, direction });
    dom.leaf_layer.replaceChildren();

    view = new_view;
    render_view();
    dom.reader_status.textContent = "";
    housekeeping();
  } catch {
    dom.reader_status.textContent = LOAD_ERROR_MESSAGE;
  } finally {
    dom.leaf_layer.replaceChildren();
    set_busy(false);
    update_controls();
  }
}

// Salto directo (barra o teclas Inicio y Fin): sin giro de hoja, con un suave desvanecimiento.
async function jump_to_slot(slot) {
  if (is_busy || !view.cursor) {
    update_controls();
    return;
  }
  let target;
  if (slot <= 0) target = { offset: -1, index: 0 };
  else if (slot >= total_entries + 1) target = { offset: total_entries, index: 0 };
  else target = entry_start(slot - 1);

  set_busy(true);
  try {
    const cursor = normalize_cursor(target);
    view = await resolve_view(cursor);
    render_view();
    dom.reader_status.textContent = "";
    dom.spread.classList.remove("is_jumping");
    // Se fuerza un reflujo para que el desvanecimiento se reinicie si se salta varias veces seguidas.
    void dom.spread.offsetWidth;
    dom.spread.classList.add("is_jumping");
    setTimeout(() => dom.spread.classList.remove("is_jumping"), JUMP_FADE_MILLISECONDS);
    housekeeping();
  } catch {
    dom.reader_status.textContent = LOAD_ERROR_MESSAGE;
  } finally {
    set_busy(false);
    update_controls();
  }
}

function describe_slot(slot) {
  if (slot <= 0) return "Portada";
  if (slot >= total_entries + 1) return "Final";
  return `Entrada ${slot} de ${total_entries}`;
}

function handle_slider_input() {
  dom.page_indicator.textContent = describe_slot(Number(dom.page_slider.value));
}

function handle_slider_change() {
  jump_to_slot(Number(dom.page_slider.value));
}

// ---------------------------------------------------------------------------
// Teclado y deslizamiento
// ---------------------------------------------------------------------------

function handle_keydown(event) {
  if (dom.reader_screen.hidden || dom.book_viewport.hidden) return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (document.querySelector("dialog[open]")) return;
  // La barra se maneja sola con las flechas, y en campos de texto no se debe interferir.
  if (event.target === dom.page_slider) return;
  if (event.target instanceof Element && event.target.closest("input, textarea, select")) return;

  const handlers = {
    ArrowRight: () => turn(1),
    PageDown: () => turn(1),
    ArrowLeft: () => turn(-1),
    PageUp: () => turn(-1),
    Home: () => jump_to_slot(0),
    End: () => jump_to_slot(total_entries + 1),
  };
  const handler = handlers[event.key];
  if (!handler) return;
  event.preventDefault();
  handler();
}

// El deslizamiento solo se atiende con el dedo o el lápiz: con el mouse se puede seleccionar texto.
function handle_pointer_down(event) {
  if (event.pointerType === "mouse") return;
  swipe_start = { x: event.clientX, y: event.clientY };
}

function handle_pointer_up(event) {
  if (!swipe_start) return;
  const distance_x = event.clientX - swipe_start.x;
  const distance_y = event.clientY - swipe_start.y;
  swipe_start = null;

  const is_horizontal = Math.abs(distance_x) > Math.abs(distance_y) * SWIPE_DIRECTION_RATIO;
  if (Math.abs(distance_x) >= SWIPE_MIN_DISTANCE && is_horizontal) turn(distance_x < 0 ? 1 : -1);
}
