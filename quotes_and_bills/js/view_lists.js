// Clientes y Catálogo: dos listas iguales en forma (búsqueda, Agregar, Editar y Borrar con confirmación). Editar y agregar
// abren un diálogo. Los documentos ya hechos no cambian al editar o borrar un cliente o un producto, porque llevan su copia.
import { clean_tax_id, format_money, normalize_text, parse_money, MAX_UNIT_PRICE } from "./document_model.js";
import { hooks } from "./navigation.js";
import { save_now, state } from "./store.js";
import { announce, ask_confirmation, by_id, make_element, make_id } from "./ui_helpers.js";

// ---------------------------------------------------------------------------
// Una lista genérica
// ---------------------------------------------------------------------------

// Arma una vista de lista con su búsqueda y sus botones. config:
//   ids: { list, empty, search, add }, items(): los elementos, haystack(item): el texto donde se busca, sort_key(item),
//   describe(item): { title, detail }, open_dialog(item | null, origin), delete_text(item), noun
function make_list_view(config) {
  function render() {
    const query = normalize_text(by_id(config.ids.search).value);
    const all = config.items();
    const shown = all.filter((item) => query === "" || normalize_text(config.haystack(item)).includes(query)).sort((first, second) => normalize_text(config.sort_key(first)).localeCompare(normalize_text(config.sort_key(second))));
    const list = by_id(config.ids.list);
    list.replaceChildren();
    shown.forEach((item) => {
      const description = config.describe(item);
      const row = make_element("li", "item");
      row.dataset.id = item.id;
      const main = make_element("button", "item_main");
      main.type = "button";
      main.setAttribute("aria-label", `Editar: ${description.title}`);
      main.append(make_element("span", "item_title", description.title), make_element("span", "item_detail", description.detail));
      main.addEventListener("click", () => config.open_dialog(item, main));
      const remove = make_element("button", "icon_button");
      remove.type = "button";
      remove.setAttribute("aria-label", `Borrar: ${description.title}`);
      const icon = make_element("i", "fa-regular fa-trash-can");
      icon.setAttribute("aria-hidden", "true");
      remove.append(icon);
      remove.addEventListener("click", () => delete_item(item, description.title));
      row.append(main, remove);
      list.append(row);
    });
    const empty = by_id(config.ids.empty);
    if (all.length === 0) empty.textContent = config.empty_text;
    else empty.textContent = shown.length === 0 ? `Nada coincide con «${by_id(config.ids.search).value.trim()}».` : "";
    empty.hidden = empty.textContent === "";
  }

  async function delete_item(item, title) {
    const accepted = await ask_confirmation(config.delete_text(title), "Borrar");
    if (!accepted) return;
    config.remove(item);
    save_now();
    render();
    config.after_change();
    announce(`${config.noun} borrado: ${title}.`);
    by_id(config.ids.add).focus();
  }

  by_id(config.ids.search).addEventListener("input", render);
  by_id(config.ids.add).addEventListener("click", () => config.open_dialog(null, by_id(config.ids.add)));
  return { render, announce_saved: (title) => announce(`${config.noun} guardado: ${title}.`) };
}

// Un diálogo de edición con su formulario. fill(item) llena los campos; read() devuelve { fields } o { error }.
function make_dialog({ dialog_id, form_id, title_id, warning_id, cancel_id, fill, read, titles, on_save }) {
  const dialog = by_id(dialog_id);
  let editing = null;
  let origin = null;

  function close() {
    if (dialog.open) dialog.close();
  }

  function restore_focus() {
    if (origin && origin.isConnected) origin.focus();
  }

  by_id(form_id).addEventListener("submit", (event) => {
    event.preventDefault();
    const result = read();
    if (result.error) {
      by_id(warning_id).textContent = result.error.message;
      by_id(warning_id).hidden = false;
      by_id(result.error.field).focus();
      return;
    }
    on_save(editing, result.fields);
    close();
    // El botón que abrió el diálogo puede haberse redibujado: si ya no está, el foco queda en el botón de agregar
    restore_focus();
  });
  by_id(cancel_id).addEventListener("click", () => {
    close();
    restore_focus();
  });
  dialog.addEventListener("close", () => {
    if (origin && origin.isConnected && document.activeElement === document.body) origin.focus();
  });

  return function open(item, opener) {
    editing = item;
    origin = opener;
    by_id(title_id).textContent = item ? titles.edit : titles.add;
    by_id(warning_id).hidden = true;
    fill(item);
    dialog.showModal();
    dialog.querySelector("input").focus();
  };
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

const CLIENT_FIELDS = [
  ["dialog_client_name", "name"],
  ["dialog_client_tax_id", "tax_id"],
  ["dialog_client_phone", "phone"],
  ["dialog_client_email", "email"],
  ["dialog_client_address", "address"],
];

let clients_view;
let open_client_dialog;

export function render_clients() {
  clients_view.render();
}

function init_clients() {
  open_client_dialog = make_dialog({
    dialog_id: "client_dialog",
    form_id: "client_form",
    title_id: "client_dialog_title",
    warning_id: "client_dialog_warning",
    cancel_id: "client_dialog_cancel",
    titles: { add: "Agregar cliente", edit: "Editar cliente" },
    fill: (item) => CLIENT_FIELDS.forEach(([id, key]) => (by_id(id).value = item ? item[key] : "")),
    read: () => {
      const fields = Object.fromEntries(CLIENT_FIELDS.map(([id, key]) => [key, by_id(id).value.trim()]));
      fields.tax_id = clean_tax_id(fields.tax_id);
      if (fields.name === "") return { error: { field: "dialog_client_name", message: "El cliente necesita un nombre." } };
      return { fields };
    },
    on_save: (item, fields) => {
      if (item) Object.assign(item, fields);
      else state.data.clients.push({ id: make_id(), ...fields });
      save_now();
      clients_view.render();
      hooks.refresh_clients();
      clients_view.announce_saved(fields.name);
    },
  });
  clients_view = make_list_view({
    ids: { list: "clients_list", empty: "clients_empty", search: "clients_search", add: "add_client_button" },
    items: () => state.data.clients,
    haystack: (client) => `${client.name} ${client.tax_id} ${client.phone} ${client.email}`,
    sort_key: (client) => client.name,
    describe: (client) => ({ title: client.name, detail: [client.tax_id ? `NIT/CC ${client.tax_id}` : "", client.phone, client.email].filter(Boolean).join(" · ") || "Sin más datos" }),
    open_dialog: (item, opener) => open_client_dialog(item, opener),
    delete_text: (title) => `¿Borrar a ${title}? Los documentos que ya hiciste no cambian.`,
    remove: (client) => (state.data.clients = state.data.clients.filter((existing) => existing.id !== client.id)),
    after_change: () => hooks.refresh_clients(),
    empty_text: "Todavía no tienes clientes guardados. Agrégalos aquí o desde un documento, con «Guardar en Clientes».",
    noun: "Cliente",
  });
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

let products_view;
let open_product_dialog;

export function render_products() {
  products_view.render();
}

function init_products() {
  open_product_dialog = make_dialog({
    dialog_id: "product_dialog",
    form_id: "product_form",
    title_id: "product_dialog_title",
    warning_id: "product_dialog_warning",
    cancel_id: "product_dialog_cancel",
    titles: { add: "Agregar producto o servicio", edit: "Editar producto o servicio" },
    fill: (item) => {
      by_id("dialog_product_name").value = item ? item.name : "";
      by_id("dialog_product_description").value = item ? item.description : "";
      by_id("dialog_product_price").value = item && item.price > 0 ? String(item.price).replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "";
      by_id("dialog_product_tax").value = String(item ? item.tax_rate : 0);
    },
    read: () => {
      const name = by_id("dialog_product_name").value.trim();
      if (name === "") return { error: { field: "dialog_product_name", message: "El producto o servicio necesita un nombre." } };
      const price_text = by_id("dialog_product_price").value.trim();
      const price = price_text === "" ? 0 : parse_money(price_text);
      if (Number.isNaN(price) || price > MAX_UNIT_PRICE) return { error: { field: "dialog_product_price", message: "El precio no es válido: escribe solo números." } };
      return { fields: { name, description: by_id("dialog_product_description").value.trim(), price, tax_rate: Number(by_id("dialog_product_tax").value) } };
    },
    on_save: (item, fields) => {
      if (item) Object.assign(item, fields);
      else state.data.products.push({ id: make_id(), ...fields });
      save_now();
      products_view.render();
      hooks.refresh_products();
      products_view.announce_saved(fields.name);
    },
  });
  products_view = make_list_view({
    ids: { list: "products_list", empty: "products_empty", search: "products_search", add: "add_product_button" },
    items: () => state.data.products,
    haystack: (product) => `${product.name} ${product.description}`,
    sort_key: (product) => product.name,
    describe: (product) => ({ title: product.name, detail: [product.description, format_money(product.price), product.tax_rate > 0 ? `IVA ${product.tax_rate} %` : ""].filter(Boolean).join(" · ") }),
    open_dialog: (item, opener) => open_product_dialog(item, opener),
    delete_text: (title) => `¿Borrar «${title}» del catálogo? Los documentos que ya hiciste no cambian.`,
    remove: (product) => (state.data.products = state.data.products.filter((existing) => existing.id !== product.id)),
    after_change: () => hooks.refresh_products(),
    empty_text: "Todavía no tienes productos ni servicios guardados. Agrégalos para armar tus documentos más rápido.",
    noun: "Producto",
  });
}

export function init_lists() {
  init_clients();
  init_products();
}
