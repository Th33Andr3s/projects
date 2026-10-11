// La plantilla del documento sobre el escritor de PDF (cabecera con logo, cliente, tabla con salto de página, totales, notas
// y pie en cada hoja) y los textos para enviar por WhatsApp y correo. Son funciones puras: reciben el documento y el
// negocio y devuelven bytes, textos o direcciones.
//
// Los totales salen de calculate_totals (document_model.js), los mismos que muestra la pantalla: el PDF no recalcula nada.
import { KIND_LABELS, calculate_totals, format_date_long, format_money, format_percent, format_quantity, normalize_text, whatsapp_phone } from "./document_model.js";
import { PAGE_WIDTH, create_pdf, wrap_text } from "./pdf_writer.js";

const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const RIGHT_EDGE = PAGE_WIDTH - MARGIN;
// Cada hoja reserva abajo el pie (la leyenda legal y el número de página); el contenido llega hasta aquí
const FOOTER_LINE_Y = 730;
const BOTTOM_LIMIT = 716;
const FOOTER_TEXT_WIDTH = 430;
const MAX_FOOTER_LINES = 3;
const LOGO_BOX = 80;
const LOGO_GAP = 12;
const TEXT_LINE = 11.5;
const CELL_PADDING = 4;
const HEADER_ROW_HEIGHT = 18;
const GRAY = [0.4];
const LIGHT_GRAY = [0.8];
const HEADER_FILL = [0.93];
const NOT_INVOICE_NOTE = "Este documento no es una factura electrónica.";
const NOT_VAT_NOTE = "No responsable de IVA.";
const BUSINESS_BLOCK_RIGHT = 372;
const MAX_FILE_NAME_PART = 40;
const SHARE_NAMES = { quote: "cotización", bill: "cuenta de cobro" };
const DUE_LABELS = { quote: "Válida hasta", bill: "Vence" };

// La leyenda que va en el pie de todo documento (y en la vista previa)
export function disclaimer_text(document) {
  return document.charges_vat ? NOT_INVOICE_NOTE : `${NOT_INVOICE_NOTE} ${NOT_VAT_NOTE}`;
}

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

// Los bytes de un JPEG que viene como "data:image/jpeg;base64,…", o null
function jpeg_bytes_from_data_url(data_url) {
  const prefix = "data:image/jpeg;base64,";
  if (typeof data_url !== "string" || !data_url.startsWith(prefix)) return null;
  try {
    const binary = atob(data_url.slice(prefix.length));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dibujo de cada parte
// ---------------------------------------------------------------------------

// La cabecera de la primera hoja: logo y datos del negocio a la izquierda; tipo, número y fechas a la derecha. Devuelve la
// y donde sigue el contenido.
function draw_header(page, document, business, logo) {
  let bottom = MARGIN;
  if (logo) {
    const scale = Math.min(LOGO_BOX / logo.width, LOGO_BOX / logo.height);
    const width = logo.width * scale;
    const height = logo.height * scale;
    page.image(logo.id, MARGIN, MARGIN, width, height);
    bottom = MARGIN + height;
  }
  const text_x = MARGIN + (logo ? LOGO_BOX + LOGO_GAP : 0);
  const text_width_available = BUSINESS_BLOCK_RIGHT - text_x;
  let y = MARGIN + 12;
  wrap_text(business.name, "bold", 14, text_width_available).slice(0, 2).forEach((line) => {
    page.text(text_x, y, line, { font: "bold", size: 14 });
    y += 16;
  });
  const details = [
    business.tax_id ? `NIT/CC: ${business.tax_id}` : "",
    [business.address, business.city].filter(Boolean).join(", "),
    [business.phone, business.email].filter(Boolean).join("  ·  "),
  ].filter(Boolean);
  details.forEach((detail) => {
    wrap_text(detail, "regular", 9, text_width_available).forEach((line) => {
      page.text(text_x, y, line, { size: 9, color: GRAY });
      y += TEXT_LINE;
    });
  });
  bottom = Math.max(bottom, y);

  page.text(RIGHT_EDGE, MARGIN + 16, KIND_LABELS[document.kind].toUpperCase(), { font: "bold", size: 17, align: "right" });
  page.text(RIGHT_EDGE, MARGIN + 34, `N.º ${document.number}`, { font: "bold", size: 12, align: "right" });
  page.text(RIGHT_EDGE, MARGIN + 50, `Fecha: ${format_date_long(document.date)}`, { size: 9.5, align: "right" });
  let right_bottom = MARGIN + 50;
  if (document.due_date) {
    page.text(RIGHT_EDGE, MARGIN + 63, `${DUE_LABELS[document.kind]}: ${format_date_long(document.due_date)}`, { size: 9.5, align: "right" });
    right_bottom = MARGIN + 63;
  }
  const separator_y = Math.max(bottom, right_bottom) + 12;
  page.line(MARGIN, separator_y, RIGHT_EDGE, separator_y, { width: 1 });
  return separator_y + 16;
}

function draw_client(page, client, y) {
  page.text(MARGIN, y, "CLIENTE", { font: "bold", size: 8.5, color: GRAY });
  y += 14;
  page.text(MARGIN, y, client.name, { font: "bold", size: 11 });
  y += 14;
  const details = [client.tax_id ? `NIT/CC: ${client.tax_id}` : "", client.address, [client.phone, client.email].filter(Boolean).join("  ·  ")].filter(Boolean);
  details.forEach((detail) => {
    wrap_text(detail, "regular", 9.5, CONTENT_WIDTH).forEach((line) => {
      page.text(MARGIN, y, line, { size: 9.5 });
      y += 12;
    });
  });
  return y + 8;
}

// Las columnas de la tabla: descripción (ocupa lo que sobra) y los números, cada uno con su borde derecho
function table_columns(has_vat) {
  const numbers = [
    { key: "quantity", label: "Cant.", width: 46 },
    { key: "unit_price", label: "Valor unit.", width: 78 },
    { key: "discount", label: "Desc.", width: 44 },
    ...(has_vat ? [{ key: "vat", label: "IVA", width: 40 }] : []),
    { key: "total", label: "Total", width: 84 },
  ];
  const description_width = CONTENT_WIDTH - numbers.reduce((total, column) => total + column.width, 0);
  let edge = MARGIN + description_width;
  const columns = numbers.map((column) => {
    edge += column.width;
    return { ...column, right: edge - CELL_PADDING };
  });
  return { description_width, columns };
}

function draw_table_header(page, layout, y) {
  page.rect(MARGIN, y, CONTENT_WIDTH, HEADER_ROW_HEIGHT, { fill: HEADER_FILL });
  page.text(MARGIN + CELL_PADDING, y + 12.5, "Descripción", { font: "bold", size: 9 });
  layout.columns.forEach((column) => page.text(column.right, y + 12.5, column.label, { font: "bold", size: 9, align: "right" }));
  return y + HEADER_ROW_HEIGHT;
}

// Las hojas que siguen a la primera: el número del documento arriba, para saber de cuál es
function start_continuation_page(pdf, document) {
  const page = pdf.add_page();
  page.text(MARGIN, MARGIN, `${KIND_LABELS[document.kind]} ${document.number} (continuación)`, { size: 9, color: GRAY });
  return { page, y: MARGIN + 14 };
}

// Dibuja una línea de la tabla; si la descripción es tan larga que no cabe en lo que queda de la hoja, se reparte entre
// hojas (los números solo van en el primer pedazo). Devuelve la página y la y donde sigue.
function draw_row(pdf, document, layout, state, line, total) {
  const description_lines = wrap_text(line.description, "regular", 9, layout.description_width - CELL_PADDING * 2);
  let remaining = description_lines;
  let first_piece = true;
  let { page, y } = state;
  while (remaining.length > 0) {
    const available = Math.floor((BOTTOM_LIMIT - y - CELL_PADDING * 2) / TEXT_LINE);
    if (available < 1) {
      ({ page, y } = start_continuation_page(pdf, document));
      y = draw_table_header(page, layout, y);
      continue;
    }
    const piece = remaining.slice(0, available);
    remaining = remaining.slice(available);
    const baseline = y + CELL_PADDING + 8;
    piece.forEach((text, index) => page.text(MARGIN + CELL_PADDING, baseline + index * TEXT_LINE, text, { size: 9 }));
    if (first_piece) {
      const values = {
        quantity: format_quantity(line.quantity),
        unit_price: format_money(line.unit_price),
        discount: line.discount_percent > 0 ? format_percent(line.discount_percent) : "",
        vat: document.charges_vat ? format_percent(line.tax_rate) : "",
        total: format_money(total),
      };
      layout.columns.forEach((column) => page.text(column.right, baseline, values[column.key], { size: 9, align: "right" }));
      first_piece = false;
    }
    y += piece.length * TEXT_LINE + CELL_PADDING * 2;
    page.line(MARGIN, y, RIGHT_EDGE, y, { width: 0.4, color: LIGHT_GRAY });
    if (remaining.length > 0) {
      ({ page, y } = start_continuation_page(pdf, document));
      y = draw_table_header(page, layout, y);
    }
  }
  return { page, y };
}

// Los totales, alineados a la derecha. Si no caben en lo que queda de la hoja, pasan completos a la siguiente.
function draw_totals(pdf, document, totals, state) {
  const entries = [{ label: "Subtotal", value: format_money(totals.subtotal) }];
  if (totals.general_discount > 0) entries.push({ label: `Descuento (${format_percent(document.discount_percent)})`, value: format_money(-totals.general_discount) });
  totals.vat.forEach((entry) => entries.push({ label: `IVA ${format_percent(entry.rate)}`, value: format_money(entry.amount) }));
  if (totals.withholding > 0) entries.push({ label: `Retención en la fuente (${format_percent(document.withholding_percent)})`, value: format_money(-totals.withholding) });
  const height = entries.length * 15 + 26;
  let { page, y } = state;
  y += 12;
  if (y + height > BOTTOM_LIMIT) ({ page, y } = start_continuation_page(pdf, document));
  const label_x = RIGHT_EDGE - 210;
  entries.forEach((entry) => {
    page.text(label_x, y, entry.label, { size: 9.5 });
    page.text(RIGHT_EDGE - CELL_PADDING, y, entry.value, { size: 9.5, align: "right" });
    y += 15;
  });
  page.line(label_x, y - 8, RIGHT_EDGE, y - 8, { width: 0.8 });
  page.text(label_x, y + 6, "TOTAL", { font: "bold", size: 12 });
  page.text(RIGHT_EDGE - CELL_PADDING, y + 6, format_money(totals.total), { font: "bold", size: 12, align: "right" });
  return { page, y: y + 26 };
}

// Un bloque de texto con título (notas, datos para el pago) que pasa de hoja si hace falta
function draw_paragraph(pdf, document, state, title, text) {
  let { page, y } = state;
  const lines = wrap_text(text, "regular", 9, CONTENT_WIDTH);
  if (y + 14 + TEXT_LINE > BOTTOM_LIMIT) ({ page, y } = start_continuation_page(pdf, document));
  page.text(MARGIN, y, title, { font: "bold", size: 9, color: GRAY });
  y += 13;
  lines.forEach((line) => {
    if (y + TEXT_LINE > BOTTOM_LIMIT) ({ page, y } = start_continuation_page(pdf, document));
    page.text(MARGIN, y, line, { size: 9 });
    y += TEXT_LINE;
  });
  return { page, y: y + 8 };
}

// El pie de cada hoja: la leyenda del negocio, la leyenda de que no es factura electrónica y "Página 1 de 2"
function draw_footers(pdf, document, business) {
  let footer_lines = wrap_text(business.footer_text, "regular", 8, FOOTER_TEXT_WIDTH).filter((line) => line !== "");
  if (footer_lines.length > MAX_FOOTER_LINES) footer_lines = [...footer_lines.slice(0, MAX_FOOTER_LINES - 1), `${footer_lines[MAX_FOOTER_LINES - 1]}…`];
  const disclaimer_lines = wrap_text(disclaimer_text(document), "regular", 8, FOOTER_TEXT_WIDTH);
  pdf.pages.forEach((page, index) => {
    page.line(MARGIN, FOOTER_LINE_Y, RIGHT_EDGE, FOOTER_LINE_Y, { width: 0.5, color: LIGHT_GRAY });
    let y = FOOTER_LINE_Y + 12;
    [...footer_lines, ...disclaimer_lines].forEach((line) => {
      page.text(MARGIN, y, line, { size: 8, color: GRAY });
      y += 10;
    });
    page.text(RIGHT_EDGE, FOOTER_LINE_Y + 12, `Página ${index + 1} de ${pdf.pages.length}`, { size: 8, color: GRAY, align: "right" });
  });
}

// ---------------------------------------------------------------------------
// El documento completo
// ---------------------------------------------------------------------------

// Los bytes del PDF de un documento (cotización o cuenta de cobro) con los datos del negocio
export function build_document_pdf(document, business) {
  const totals = calculate_totals(document);
  const pdf = create_pdf({ title: `${KIND_LABELS[document.kind]} ${document.number}` });
  const logo_bytes = jpeg_bytes_from_data_url(business.logo);
  const logo = logo_bytes ? pdf.add_jpeg(logo_bytes) : null;

  let state = { page: pdf.add_page(), y: 0 };
  state.y = draw_header(state.page, document, business, logo);
  state.y = draw_client(state.page, document.client, state.y);

  const layout = table_columns(document.charges_vat);
  state.y = draw_table_header(state.page, layout, state.y);
  document.lines.forEach((line, index) => {
    state = draw_row(pdf, document, layout, state, line, totals.line_totals[index]);
  });
  state = draw_totals(pdf, document, totals, state);
  if (document.notes.trim()) state = draw_paragraph(pdf, document, state, "Notas", document.notes);
  if (business.payment_info.trim()) state = draw_paragraph(pdf, document, state, "Datos para el pago", business.payment_info);
  draw_footers(pdf, document, business);
  return pdf.build();
}

// ---------------------------------------------------------------------------
// Nombre del archivo y textos para enviar
// ---------------------------------------------------------------------------

function slug(text) {
  return normalize_text(text).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, MAX_FILE_NAME_PART).replace(/_+$/g, "");
}

// "cotizacion_COT-0012_nombre_cliente.pdf" o "cuenta_de_cobro_CC-0003_nombre_cliente.pdf"
export function pdf_file_name(document) {
  const kind = document.kind === "quote" ? "cotizacion" : "cuenta_de_cobro";
  const number = document.number.replace(/[^A-Za-z0-9-]/g, "");
  const client = slug(document.client.name);
  return `${kind}_${number}${client ? `_${client}` : ""}.pdf`;
}

// El resumen que acompaña al documento al enviarlo: { subject, lines }
function share_message(document, business) {
  const totals = calculate_totals(document);
  const name = SHARE_NAMES[document.kind];
  const lines = [
    `Hola ${document.client.name}, te comparto la ${name} ${document.number}${business.name ? ` de ${business.name}` : ""}.`,
    `Total: ${format_money(totals.total)}`,
  ];
  if (document.due_date) lines.push(`${DUE_LABELS[document.kind]}: ${format_date_long(document.due_date)}`);
  lines.push("Te envío el PDF adjunto.");
  return { subject: `${KIND_LABELS[document.kind]} ${document.number}${business.name ? ` - ${business.name}` : ""}`, lines };
}

// La dirección que abre el chat de WhatsApp con el resumen escrito. Sin teléfono del cliente abre WhatsApp para elegir.
export function whatsapp_url(document, business) {
  const message = share_message(document, business);
  const phone = whatsapp_phone(document.client.phone);
  return `https://wa.me/${phone}?text=${encodeURIComponent(message.lines.join("\n"))}`;
}

// La dirección que abre el programa de correo con asunto y cuerpo
export function mailto_url(document, business) {
  const message = share_message(document, business);
  const email = document.client.email.trim();
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.lines.join("\n"))}`;
}
