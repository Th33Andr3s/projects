// Piezas que comparten las tablas de la página: la barra de filtros (buscador, listas y casillas), el menú "Descargar" que va aparte
// de la tabla y la escritura de archivos CSV (con ";" y coma decimal, como lo espera Excel en español).

import { normalize_search_text } from "./format.js";

export function make(tag, class_name, text) {
  const element = document.createElement(tag);
  if (class_name) element.className = class_name;
  if (text !== undefined) element.textContent = text;
  return element;
}

function make_icon(name) {
  const icon = make("i", `fa-solid ${name}`);
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

// ---------- Barra de filtros ----------
// `filters`: una lista de { kind: "search" | "select" | "check", label, placeholder?, options?: [[valor, texto]] }. Devuelve la barra,
// una función que lee los valores ({ search, select_n, check_n }) y `on_change(callback)` para enterarse de cualquier cambio.
export function make_filter_bar(filters) {
  const bar = make("div", "filter_bar");
  const controls = [];
  const listeners = [];
  const notify = () => listeners.forEach((listener) => listener());
  filters.forEach((filter, index) => {
    const wrapper = make("label", `filter_field filter_${filter.kind}`);
    let input;
    if (filter.kind === "search") {
      wrapper.append(make("span", "filter_label", filter.label));
      input = make("input", "filter_input");
      input.type = "search";
      input.placeholder = filter.placeholder || "";
      input.autocomplete = "off";
      input.addEventListener("input", notify);
      wrapper.append(input);
    } else if (filter.kind === "select") {
      wrapper.append(make("span", "filter_label", filter.label));
      input = make("select", "table_select");
      filter.options.forEach(([value, text]) => {
        const option = make("option", "", text);
        option.value = value;
        input.append(option);
      });
      input.addEventListener("change", notify);
      wrapper.append(input);
    } else {
      input = make("input");
      input.type = "checkbox";
      input.addEventListener("change", notify);
      wrapper.append(input, make("span", "", filter.label));
    }
    controls[index] = { filter, input };
    bar.append(wrapper);
  });
  return {
    bar,
    on_change(listener) {
      listeners.push(listener);
    },
    // Lo que escribió o eligió la persona, en el orden de `filters`: texto normalizado (sin tildes ni mayúsculas), valor elegido o sí/no
    values() {
      return controls.map(({ filter, input }) => {
        if (filter.kind === "search") return normalize_search_text(input.value);
        if (filter.kind === "select") return input.value;
        return input.checked;
      });
    },
    reset() {
      controls.forEach(({ filter, input }) => {
        if (filter.kind === "check") input.checked = false;
        else input.value = filter.kind === "select" ? filter.options[0][0] : "";
      });
      notify();
    },
  };
}

// Un texto cumple con la búsqueda si todas sus palabras aparecen (sin tildes ni mayúsculas)
export function matches_search(normalized_query, text) {
  if (normalized_query === "") return true;
  const haystack = normalize_search_text(text);
  return normalized_query.split(/\s+/).every((word) => haystack.includes(word));
}

// ---------- Menú de descargas ----------
// Un botón pequeño "Descargar" que abre una lista corta de archivos. Va a un lado del título de la tabla, no dentro de ella.
// `items`: [{ label, hint, run }]. Se cierra al elegir algo, con Escape o al tocar fuera.
export function make_download_menu(items) {
  const details = make("details", "download_menu");
  const summary = make("summary", "text_button text_button_small download_summary");
  summary.append(make_icon("fa-file-arrow-down"), make("span", "", "Descargar"), make_icon("fa-chevron-down"));
  const list = make("ul", "download_list");
  items.forEach((item) => {
    const entry = make("li");
    const button = make("button", "download_item");
    button.type = "button";
    button.append(make("strong", "", item.label), make("small", "", item.hint));
    button.addEventListener("click", () => {
      details.open = false;
      summary.focus();
      item.run();
    });
    entry.append(button);
    list.append(entry);
  });
  details.append(summary, list);
  details.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && details.open) {
      details.open = false;
      summary.focus();
      event.stopPropagation();
    }
  });
  document.addEventListener("click", (event) => {
    if (details.open && !details.contains(event.target)) details.open = false;
  });
  return details;
}

// ---------- CSV ----------
const SEPARATOR = ";";

// Una celda de CSV: con comillas si lleva separador, comillas o saltos de línea
function csv_cell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Un porcentaje con coma decimal, como lo espera Excel en español
export function decimal_percent(ratio) {
  return ratio === null ? "" : (ratio * 100).toFixed(1).replace(".", ",");
}

// Cuántos renglones se juntan en cada trozo del archivo
const CSV_CHUNK_ROWS = 5000;

// `lines` puede ser una lista o un generador de renglones (listas de celdas). El archivo se arma en trozos, así un histórico de cientos de
// miles de renglones no se junta en un solo texto gigante.
export function download_csv(file_name, lines) {
  // El BOM hace que Excel abra bien las tildes
  const parts = ["\ufeff"];
  let chunk = [];
  for (const line of lines) {
    chunk.push(line.map(csv_cell).join(SEPARATOR));
    if (chunk.length >= CSV_CHUNK_ROWS) {
      parts.push(chunk.join("\r\n") + "\r\n");
      chunk = [];
    }
  }
  if (chunk.length > 0) parts.push(chunk.join("\r\n") + "\r\n");
  const url = URL.createObjectURL(new Blob(parts, { type: "text/csv;charset=utf-8" }));
  const link = make("a");
  link.href = url;
  link.download = file_name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Una barra con el título a la izquierda y, si hay, el menú de descargas a la derecha
export function make_table_header(title, download_menu) {
  const header = make("div", "table_header");
  header.append(make("h3", "table_title", title));
  if (download_menu) header.append(download_menu);
  return header;
}
