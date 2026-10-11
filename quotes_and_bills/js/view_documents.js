// Documentos: la lista con filtros y búsqueda, y las acciones sobre un documento (nuevo, duplicar, convertir una cotización en
// cuenta de cobro y borrar). Abrir un documento lleva al editor (view_editor.js).
import {
  KIND_LABELS,
  STATUS_LABELS,
  convert_quote_to_bill,
  create_document,
  document_total,
  duplicate_document,
  effective_status,
  filter_documents,
  format_date_short,
  format_money,
  needs_backup_reminder,
  sort_documents,
  today_key,
} from "./document_model.js";
import { hooks } from "./navigation.js";
import { save_now, state } from "./store.js";
import { open_editor } from "./view_editor.js";
import { announce, ask_confirmation, by_id, close_menus, make_element, make_id, now_iso } from "./ui_helpers.js";

function icon(class_name) {
  const element = make_element("i", class_name);
  element.setAttribute("aria-hidden", "true");
  return element;
}

// ---------------------------------------------------------------------------
// La lista
// ---------------------------------------------------------------------------

function empty_text(total_count, shown_count) {
  if (total_count === 0) {
    return state.data.business.name.trim() === "" ? "Todavía no hay documentos. Antes de crear el primero, llena los datos de tu negocio en «Mi negocio»; después toca «Nuevo documento»." : "Todavía no hay documentos. Toca «Nuevo documento» para crear el primero.";
  }
  return shown_count === 0 ? "Ningún documento coincide con los filtros." : "";
}

function make_menu(document) {
  const menu = make_element("details", "row_menu");
  const summary = make_element("summary", "");
  summary.setAttribute("aria-label", `Más acciones para ${document.number}`);
  summary.append(icon("fa-solid fa-ellipsis-vertical"));
  const panel = make_element("div", "menu_panel");
  const add_action = (label, handler, class_name = "") => {
    const button = make_element("button", class_name, label);
    button.type = "button";
    button.addEventListener("click", () => {
      menu.open = false;
      handler();
    });
    panel.append(button);
  };
  add_action("Duplicar", () => duplicate(document));
  if (document.kind === "quote") add_action("Convertir en cuenta de cobro", () => convert(document));
  add_action("Borrar", () => remove(document), "is_danger");
  menu.append(summary, panel);
  menu.addEventListener("toggle", () => {
    if (menu.open) close_menus(menu);
  });
  return menu;
}

function make_row(document, today) {
  const status = effective_status(document, today);
  const row = make_element("li", "item");
  row.dataset.id = document.id;
  const main = make_element("button", "item_main");
  main.type = "button";
  main.append(
    make_element("span", "item_title", `${document.number} · ${document.client.name.trim() || "Sin cliente"}`),
    make_element("span", "item_detail", `${KIND_LABELS[document.kind]} · ${format_date_short(document.date)}`),
  );
  main.addEventListener("click", () => open_editor(document.id));
  row.append(
    main,
    make_element("span", "item_amount", format_money(document_total(document))),
    make_element("span", `status_chip is_${status}`, STATUS_LABELS[status]),
    make_menu(document),
  );
  return row;
}

export function render_documents() {
  const today = today_key(new Date());
  const filters = { kind: by_id("filter_kind").value, status: by_id("filter_status").value, query: by_id("documents_search").value };
  const shown = sort_documents(filter_documents(state.data.documents, filters, today));
  by_id("documents_list").replaceChildren(...shown.map((document) => make_row(document, today)));
  const empty = by_id("documents_empty");
  empty.textContent = empty_text(state.data.documents.length, shown.length);
  empty.hidden = empty.textContent === "";
  render_reminder();
}

export function render_reminder() {
  by_id("backup_reminder").hidden = !needs_backup_reminder(state.data, today_key(new Date()));
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

function context() {
  return { business: state.data.business, counters: state.data.counters, today: today_key(new Date()), id: make_id(), now: now_iso() };
}

function open_new_document_dialog() {
  by_id("new_document_dialog").showModal();
  by_id("new_quote_button").focus();
}

function close_new_document_dialog() {
  if (by_id("new_document_dialog").open) by_id("new_document_dialog").close();
}

function create(kind) {
  close_new_document_dialog();
  const created = create_document(kind, context());
  state.data.documents.push(created.document);
  state.data.counters = created.counters;
  save_now();
  open_editor(created.document.id);
  by_id("client_name").focus();
  announce(`${KIND_LABELS[kind]} ${created.document.number} creada.`);
}

function duplicate(document) {
  const created = duplicate_document(document, context());
  state.data.documents.push(created.document);
  state.data.counters = created.counters;
  save_now();
  open_editor(created.document.id);
  announce(`Duplicado como ${created.document.number}.`);
}

async function convert(quote) {
  if (quote.status !== "accepted") {
    const accepted = await ask_confirmation(`La cotización ${quote.number} todavía no está aceptada. ¿Convertirla en cuenta de cobro de todos modos?`, "Convertir");
    if (!accepted) return;
  }
  const converted = convert_quote_to_bill(quote, context());
  state.data.documents = state.data.documents.map((document) => (document.id === quote.id ? converted.quote : document));
  state.data.documents.push(converted.bill);
  state.data.counters = converted.counters;
  save_now();
  open_editor(converted.bill.id);
  announce(`Cuenta de cobro ${converted.bill.number} creada desde ${quote.number}.`);
}

async function remove(document) {
  const accepted = await ask_confirmation(`¿Borrar ${document.number}? Su número no se vuelve a usar.`, "Borrar");
  if (!accepted) {
    by_id("new_document_button").focus();
    return;
  }
  state.data.documents = state.data.documents.filter((existing) => existing.id !== document.id);
  save_now();
  render_documents();
  announce(`${document.number} borrado.`);
  by_id("new_document_button").focus();
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

export function init_documents() {
  by_id("new_document_button").addEventListener("click", open_new_document_dialog);
  by_id("new_quote_button").addEventListener("click", () => create("quote"));
  by_id("new_bill_button").addEventListener("click", () => create("bill"));
  by_id("new_document_cancel_button").addEventListener("click", () => {
    close_new_document_dialog();
    by_id("new_document_button").focus();
  });
  ["filter_kind", "filter_status"].forEach((id) => by_id(id).addEventListener("change", render_documents));
  by_id("documents_search").addEventListener("input", render_documents);
  // Un menú de tres puntos abierto se cierra al tocar fuera o con Escape
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".row_menu")) close_menus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close_menus();
  });
  hooks.refresh_documents = render_documents;
}
