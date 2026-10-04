// Arranque de la aplicación y navegación entre pantallas.
// Regla de privacidad: sin sesión solo se puede ver la pantalla de acceso.
import { get_current_session, sign_in, sign_out, on_session_change, get_display_name } from "./auth.js";
import {
  start_scene,
  set_scene_mode,
  set_home_book_slot,
  open_book_animation,
  land_book_animation,
  release_book_animation,
  peek_book_animation,
  burst_hearts,
  add_card_sparkles,
} from "./animations.js";
import { init_write, set_current_user, clear_unsent_text, on_write_shown } from "./write.js";
import { init_pages, reset_pages, on_pages_shown } from "./pages.js";
import { init_chapters, reset_chapters, on_chapters_shown } from "./chapters.js";
import { init_cover, reset_cover, on_cover_panel_shown, refresh_home_book_cover } from "./cover.js";
import { clear_photo_cache } from "./images.js";
import { init_book, reset_book, on_read_shown } from "./book.js";

const HOME_SCREEN = "home_screen";
const LOGIN_SCREEN = "login_screen";
const LOADING_SCREEN = "loading_screen";
const READ_SCREEN = "read_screen";

// Tiempos de la apertura del libro para leer. Deben coincidir con las transiciones de styles.css
// (.is_leaving del inicio y .is_arriving de la lectura).
const HOME_FADE_MILLISECONDS = 350;
const READER_FADE_MILLISECONDS = 650;

const screen_elements = document.querySelectorAll(".screen");
const login_form = document.getElementById("login_form");
const login_email = document.getElementById("login_email");
const login_password = document.getElementById("login_password");
const login_error = document.getElementById("login_error");
const login_submit = document.getElementById("login_submit");
const toggle_password = document.getElementById("toggle_password");
const home_greeting = document.getElementById("home_greeting");
const logout_button = document.getElementById("logout_button");
const home_book_button = document.getElementById("home_book_button");
const open_reading_button = document.getElementById("open_reading_button");
const home_screen = document.getElementById(HOME_SCREEN);
const reader_screen = document.getElementById(READ_SCREEN);
const reader_viewport = document.getElementById("book_viewport");
const reader_book = document.getElementById("book");

let is_signed_in = false;
let current_user_id = null;
let is_opening_book = false;

// Qué hacer cada vez que se abre una pantalla que carga o prepara datos.
const screen_hooks = {
  write_screen: on_write_shown,
  pages_screen: () => {
    on_cover_panel_shown();
    return on_pages_shown();
  },
  chapters_screen: on_chapters_shown,
  read_screen: on_read_shown,
};

// Muestra una sola pantalla y lleva el foco a su título para teclado y lectores de pantalla.
// Con keep_book el libro 3D no se oculta: lo usa la apertura para leer, que lo desvanece al terminar.
// Devuelve lo que tarde en prepararse la pantalla (por ejemplo, la lectura mientras carga el libro).
function show_screen(screen_id, { keep_book = false } = {}) {
  screen_elements.forEach((screen) => {
    screen.hidden = screen.id !== screen_id;
  });
  // El fondo cambia según la pantalla: corazones y estrellas al entrar, pétalos de rosa dentro.
  const is_entry_screen = screen_id === LOGIN_SCREEN || screen_id === LOADING_SCREEN;
  set_scene_mode(is_entry_screen ? "login" : "home");
  // El libro 3D solo se dibuja mientras se ve el inicio, en el sitio que ocupa su botón.
  if (!keep_book) set_home_book_slot(screen_id === HOME_SCREEN ? home_book_button : null);
  const heading = document.querySelector(`#${screen_id} [tabindex="-1"]`);
  if (heading) heading.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  const hook = screen_hooks[screen_id];
  return hook ? hook() : undefined;
}

// Al tocar el libro: abre la tapa para mostrar su primera página, con fuegos artificiales, y se cierra.
// No cambia de pantalla ni de tamaño: la lectura solo se abre con el botón "Leer el libro".
async function show_first_page() {
  if (is_opening_book) return;
  await peek_book_animation();
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Abre el libro para leer, solo con el botón "Leer el libro". El libro 3D abre la tapa mientras el inicio se
// desvanece y la lectura carga sin verse. Luego el 3D se desliza hasta quedar justo sobre el libro real, la lectura
// (hojas, botones y textos) aparece encima y el 3D se desvanece: no hay un cambio brusco entre uno y otro.
// Sin animación 3D (movimiento reducido, sin WebGL, pestaña oculta) pasa directo a la lectura.
async function open_reading() {
  if (is_opening_book) return;
  const cover_opening = open_book_animation();
  if (!cover_opening) {
    go_to(READ_SCREEN);
    return;
  }

  is_opening_book = true;
  // Si mientras tanto la persona se fue a otra pantalla o cerró sesión, se abandona la apertura.
  try {
    home_screen.classList.add("is_leaving");
    await wait(HOME_FADE_MILLISECONDS);
    if (!is_signed_in || home_screen.hidden) return;

    reader_screen.classList.add("is_arriving");
    const reader_ready = go_to(READ_SCREEN, { keep_book: true });
    await Promise.all([cover_opening, reader_ready]);
    if (!is_signed_in || reader_screen.hidden) return;

    // Si el libro no se pudo mostrar (vacío o con error) no hay dónde aterrizar: solo se desvanece
    if (!reader_viewport.hidden) await land_book_animation(reader_book);
    if (!is_signed_in || reader_screen.hidden) return;

    reader_screen.classList.remove("is_arriving");
    await wait(READER_FADE_MILLISECONDS);
  } finally {
    is_opening_book = false;
    home_screen.classList.remove("is_leaving");
    reader_screen.classList.remove("is_arriving");
    // El libro 3D se desvanece al terminar, o si se abandonó la apertura, para que no quede flotando.
    // Si la persona ya volvió al inicio, ese libro es el nuevo y no se toca.
    if (home_screen.hidden) release_book_animation();
  }
}

// Pantallas que exigen sesión. Si alguien intenta abrirlas sin ella, vuelve al acceso.
function go_to(screen_id, options) {
  if (!is_signed_in && screen_id !== LOGIN_SCREEN) {
    show_screen(LOGIN_SCREEN);
    return undefined;
  }
  return show_screen(screen_id, options);
}

function show_login_error(message) {
  login_error.textContent = message;
  login_error.hidden = false;
}

function clear_login_error() {
  login_error.textContent = "";
  login_error.hidden = true;
}

// Aplica el estado de sesión a la interfaz. Se usa al arrancar y cada vez que la sesión cambia.
async function apply_session(session) {
  if (!session) {
    is_signed_in = false;
    current_user_id = null;
    set_current_user(null);
    reset_pages();
    reset_chapters();
    reset_cover();
    clear_photo_cache();
    reset_book();
    home_greeting.textContent = "";
    login_form.reset();
    show_screen(LOGIN_SCREEN);
    return;
  }

  // Supabase vuelve a avisar "sesión iniciada" cuando la persona regresa a la pestaña.
  // Si es la misma persona no se toca la pantalla, para no sacarla de lo que estaba escribiendo.
  if (is_signed_in && current_user_id === session.user.id) return;

  is_signed_in = true;
  current_user_id = session.user.id;
  set_current_user(session.user.id);
  const display_name = await get_display_name(session.user.id);
  home_greeting.textContent = display_name ? `Hola, ${display_name}.` : "Hola.";
  show_screen(HOME_SCREEN);
  // La portada del libro 3D (foto y nombres) llega después, sin hacer esperar al inicio
  refresh_home_book_cover();
}

async function handle_login_submit(event) {
  event.preventDefault();
  clear_login_error();

  const email = login_email.value.trim();
  const password = login_password.value;

  if (!email || !password) {
    show_login_error("Escribe tu correo y tu contraseña.");
    (email ? login_password : login_email).focus();
    return;
  }

  // Se bloquea el botón mientras responde el servidor para evitar envíos dobles.
  login_submit.disabled = true;
  login_submit.textContent = "Entrando...";

  const result = await sign_in(email, password);

  login_submit.disabled = false;
  login_submit.textContent = "Entrar";

  if (!result.ok) {
    show_login_error(result.message);
    login_password.select();
  }
  // Si salió bien, on_session_change se encarga de cambiar de pantalla.
  if (result.ok) burst_hearts();
}

// Al cerrar sesión a propósito también se borra la copia local de lo que no se había enviado.
function handle_logout() {
  clear_unsent_text();
  clear_photo_cache();
  sign_out();
}

function handle_toggle_password() {
  const is_hidden = login_password.type === "password";
  login_password.type = is_hidden ? "text" : "password";
  toggle_password.setAttribute("aria-pressed", String(is_hidden));
  toggle_password.setAttribute("aria-label", is_hidden ? "Ocultar contraseña" : "Mostrar contraseña");
  toggle_password.firstElementChild.className = is_hidden ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
}

function setup_events() {
  login_form.addEventListener("submit", handle_login_submit);
  toggle_password.addEventListener("click", handle_toggle_password);
  logout_button.addEventListener("click", handle_logout);
  home_book_button.addEventListener("click", show_first_page);
  open_reading_button.addEventListener("click", open_reading);

  // Botones de navegación: cada uno declara su destino en data-go_to.
  document.querySelectorAll("[data-go_to]").forEach((button) => {
    button.addEventListener("click", () => go_to(button.dataset.go_to));
  });

  // Escape vuelve al inicio desde cualquier pantalla interna.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !is_signed_in) return;
    // No interferir con el diálogo de confirmación ni con quien está escribiendo en un campo.
    if (document.querySelector("dialog[open]")) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select")) return;
    const visible_screen = document.querySelector(".screen:not([hidden])");
    if (visible_screen && visible_screen.id !== HOME_SCREEN) go_to(HOME_SCREEN);
  });

  // Cierre de sesión, expiración o inicio de sesión desde otra pestaña.
  on_session_change((event, session) => {
    if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
    apply_session(session);
  });
}

async function start_app() {
  document.querySelectorAll(".card").forEach((card) => add_card_sparkles(card));
  // La escena 3D es decorativa: no se espera a que cargue para mostrar la aplicación.
  start_scene(document.getElementById("scene_canvas"));
  init_write({ navigate: go_to });
  init_pages({ navigate: go_to });
  init_chapters();
  init_cover();
  init_book();
  setup_events();
  const session = await get_current_session();
  await apply_session(session);
}

start_app();
