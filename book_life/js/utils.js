// Utilidades compartidas por las pantallas de escribir y de páginas.
// Aquí vive lo que no pertenece a ninguna pantalla en particular: fechas, mensajes de error,
// elementos del DOM y el diálogo de confirmación.

// Convierte un error de Supabase o de red en un mensaje claro para la persona.
export function describe_error(error) {
  const text = String(error?.message || "").toLowerCase();
  if (text.includes("fetch") || text.includes("network") || text.includes("load failed")) {
    return "No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.";
  }
  if (error?.code === "42501") {
    return "No tienes permiso para hacer esto.";
  }
  if (text.includes("jwt") || error?.code === "PGRST301") {
    return "Tu sesión expiró. Cierra sesión y vuelve a entrar.";
  }
  return "Algo salió mal. Inténtalo de nuevo en un momento.";
}

// Fecha de hoy en la zona horaria de la persona, con formato AAAA-MM-DD para el campo de fecha.
export function get_today_iso() {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${today.getFullYear()}-${month}-${day}`;
}

// Se arma la fecha con sus partes para que la zona horaria no la corra un día.
export function format_date(iso_date) {
  const [year, month, day] = iso_date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("es", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Texto para mostrar una fecha, un periodo o la falta de fecha.
// Ejemplos: "12 de marzo de 2025", "1 al 3 de octubre de 2026", "1 de septiembre al 3 de octubre de 2026".
export function format_date_range(start_iso, end_iso) {
  if (!start_iso) return "Sin fecha";
  if (!end_iso) return format_date(start_iso);

  const [start_year, start_month, start_day] = start_iso.split("-").map(Number);
  const [end_year, end_month, end_day] = end_iso.split("-").map(Number);
  const month_name = (year, month) => new Date(year, month - 1, 1).toLocaleDateString("es", { month: "long" });

  if (start_year === end_year && start_month === end_month) {
    return `${start_day} al ${end_day} de ${month_name(end_year, end_month)} de ${end_year}`;
  }
  if (start_year === end_year) {
    return `${start_day} de ${month_name(start_year, start_month)} al ${end_day} de ${month_name(end_year, end_month)} de ${end_year}`;
  }
  return `${format_date(start_iso)} al ${format_date(end_iso)}`;
}

// Valida y normaliza las fechas opcionales de un texto: una fecha, un periodo o ninguna.
// Un periodo que empieza y termina el mismo día se guarda como una sola fecha.
export function normalize_date_range(start_iso, end_iso) {
  const entry_date = start_iso || null;
  let entry_date_end = end_iso || null;

  if (entry_date_end && !entry_date) {
    return { error: "Para un periodo, pon también la fecha de inicio." };
  }
  // Las fechas ISO (AAAA-MM-DD) se ordenan bien al compararlas como texto.
  if (entry_date_end && entry_date_end < entry_date) {
    return { error: "La fecha final no puede ser anterior a la inicial." };
  }
  if (entry_date_end === entry_date) entry_date_end = null;

  return { entry_date, entry_date_end, error: "" };
}

// Enlaza el campo "Hasta" con el campo de fecha principal:
// - mientras no haya fecha principal, "Hasta" queda deshabilitado y vacío;
// - el calendario de "Hasta" no deja elegir fechas anteriores a la principal (atributo min);
// - si la fecha principal cambia y deja a "Hasta" por delante, "Hasta" se vacía.
// Devuelve la función que sincroniza el estado; hay que llamarla después de cambiar valores por código.
export function link_date_range_inputs(start_input, end_input) {
  const sync = () => {
    const start_value = start_input.value;
    end_input.disabled = !start_value;
    if (start_value) end_input.min = start_value;
    else end_input.removeAttribute("min");
    // Las fechas ISO (AAAA-MM-DD) se ordenan bien al compararlas como texto.
    if (!start_value || (end_input.value && end_input.value < start_value)) end_input.value = "";
  };
  start_input.addEventListener("input", sync);
  start_input.addEventListener("change", sync);
  sync();
  return sync;
}

// Orden de lectura del libro, aplicado en la base de datos: por fecha de la página o, si no tiene fecha,
// por el día en que se guardó (columna sort_date); en empate, por momento de guardado y luego order_index.
// Ordenar en la base permite pedir solo un trozo del libro en vez de descargarlo todo.
export function order_book(query, ascending) {
  return query
    .order("sort_date", { ascending })
    .order("created_at", { ascending })
    .order("order_index", { ascending });
}

// Mensajes y encargos que pasan de una pantalla a otra (por ejemplo, "editar esta página").
// Se leen una sola vez: quien los toma los borra.
const handoff = { edit_entry: null, notice: "" };

export function set_edit_request(entry) {
  handoff.edit_entry = entry;
}

export function take_edit_request() {
  const entry = handoff.edit_entry;
  handoff.edit_entry = null;
  return entry;
}

export function set_notice(text) {
  handoff.notice = text;
}

export function take_notice() {
  const text = handoff.notice;
  handoff.notice = "";
  return text;
}

export function create_element(tag_name, class_name, text) {
  const element = document.createElement(tag_name);
  if (class_name) element.className = class_name;
  // textContent y no innerHTML: el texto de la persona nunca se interpreta como HTML.
  if (text !== undefined) element.textContent = text;
  return element;
}

// Botón pequeño con icono. El id del elemento al que se refiere viaja en data-item_id.
export function create_action_button(label, icon_class, action, item_id, extra_class = "") {
  const button = create_element("button", `button button_secondary button_small ${extra_class}`.trim());
  button.type = "button";
  button.dataset.action = action;
  button.dataset.item_id = item_id;
  const icon = create_element("i", `fa-solid ${icon_class}`);
  icon.setAttribute("aria-hidden", "true");
  button.append(icon, ` ${label}`);
  return button;
}

// Expande o recorta un texto largo y actualiza el botón que lo controla.
export function toggle_content(button) {
  const content = button.closest(".list_item").querySelector(".list_item_content");
  const is_expanded = content.classList.toggle("is_clamped") === false;
  button.setAttribute("aria-expanded", String(is_expanded));
  const icon = create_element("i", `fa-solid ${is_expanded ? "fa-chevron-up" : "fa-chevron-down"}`);
  icon.setAttribute("aria-hidden", "true");
  button.replaceChildren(icon, is_expanded ? " Mostrar menos" : " Leer completo");
}

// Diálogo de confirmación. Devuelve true solo si la persona confirma; Escape o Cancelar devuelven false.
// Responde a los botones y a Escape de forma directa, sin depender del evento "close".
export function ask_confirmation({ title, text, confirm_label }) {
  const dialog = document.getElementById("confirm_dialog");
  const confirm_button = dialog.querySelector('[value="confirm"]');
  const cancel_button = dialog.querySelector('[value="cancel"]');
  document.getElementById("confirm_title").textContent = title;
  document.getElementById("confirm_text").textContent = text;
  confirm_button.textContent = confirm_label;

  return new Promise((resolve) => {
    const listeners = new AbortController();

    const finish = (confirmed) => {
      listeners.abort();
      if (dialog.open) dialog.close();
      resolve(confirmed);
    };

    const options = { signal: listeners.signal };
    confirm_button.addEventListener("click", (event) => {
      event.preventDefault();
      finish(true);
    }, options);
    cancel_button.addEventListener("click", (event) => {
      event.preventDefault();
      finish(false);
    }, options);
    // Escape cierra el diálogo de forma nativa y avisa con "cancel".
    dialog.addEventListener("cancel", () => finish(false), options);
    // Por si se cierra de cualquier otra forma.
    dialog.addEventListener("close", () => finish(false), options);

    dialog.showModal();
  });
}
