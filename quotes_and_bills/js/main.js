// Cotizaciones y cuentas de cobro: arranque, navegación entre las cinco secciones y conexión de las vistas. Las reglas
// (totales, numeración, estados, respaldo) viven en document_model.js; el PDF, en pdf_writer.js y document_layout.js.
import { start_scene } from "./animations.js";
import { hooks } from "./navigation.js";
import { load_data, on_save_failure, save_now } from "./store.js";
import { by_id } from "./ui_helpers.js";
import { init_business, export_data, render_business, show_welcome } from "./view_business.js";
import { init_documents, render_documents, render_reminder } from "./view_documents.js";
import { close_editor, init_editor, is_editor_open, open_editor, refresh_editor_clients } from "./view_editor.js";
import { init_lists, render_clients, render_products } from "./view_lists.js";
import { init_summary, render_summary } from "./view_summary.js";

const VIEWS = ["documents", "clients", "catalog", "summary", "business"];
const RENDERERS = { documents: render_documents, clients: render_clients, catalog: render_products, summary: render_summary, business: render_business };

let current_view = "documents";

// ---------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------

function show_view(name) {
  current_view = name;
  document.querySelectorAll(".tab").forEach((tab) => {
    const is_active = tab.dataset.view === name;
    tab.setAttribute("aria-selected", String(is_active));
    // Solo la pestaña activa entra en el orden de Tab; con las flechas se pasa a las otras.
    tab.tabIndex = is_active ? 0 : -1;
  });
  VIEWS.forEach((view) => (by_id(`view_${view}`).hidden = view !== name));
  RENDERERS[name]();
}

function handle_tab_keydown(event) {
  const index = VIEWS.indexOf(current_view);
  const last = VIEWS.length - 1;
  const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  show_view(VIEWS[next]);
  by_id(`tab_${VIEWS[next]}`).focus();
}

// Redibuja todo (después de importar un respaldo): si había un documento abierto, se vuelve a la lista
function refresh_all() {
  if (is_editor_open()) close_editor();
  RENDERERS[current_view]();
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

function connect() {
  hooks.go_to_view = (name, focus_id = null) => {
    show_view(name);
    if (focus_id) by_id(focus_id).focus();
  };
  hooks.open_document = (id) => {
    show_view("documents");
    open_editor(id);
  };
  hooks.refresh_all = refresh_all;
  hooks.refresh_reminder = render_reminder;
  hooks.refresh_clients = () => {
    render_clients();
    refresh_editor_clients();
  };
  hooks.refresh_products = render_products;
}

function setup_events() {
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => show_view(tab.dataset.view)));
  document.querySelector(".tabs").addEventListener("keydown", handle_tab_keydown);
  by_id("storage_export_button").addEventListener("click", () => export_data());
  by_id("reminder_export_button").addEventListener("click", () => export_data());
  // Lo último que se escribió se guarda aunque se cierre la pestaña antes de los 300 ms de espera
  window.addEventListener("pagehide", save_now);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) save_now();
  });
}

on_save_failure(() => (by_id("storage_strip").hidden = false));
const first_time = load_data();
connect();
init_business();
init_lists();
init_summary();
init_documents();
init_editor();
setup_events();
render_business();
if (first_time) {
  // La primera vez se empieza por Mi negocio, con un aviso de bienvenida
  show_view("business");
  show_welcome();
} else {
  show_view("documents");
}
// El fondo es decorativo: se prepara sin esperar y la página ya funciona mientras carga.
start_scene(by_id("scene_canvas"));
