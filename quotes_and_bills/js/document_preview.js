// La vista previa del documento: el mismo contenido que sale en el PDF (cabecera con logo, cliente, tabla, totales, notas y
// pie), dibujado con HTML sobre una hoja blanca. Es lo que se imprime. Los totales vienen de calculate_totals, los mismos del PDF.
import { disclaimer_text } from "./document_layout.js";
import { KIND_LABELS, calculate_totals, format_date_long, format_money, format_percent, format_quantity } from "./document_model.js";
import { make_element } from "./ui_helpers.js";

const DUE_LABELS = { quote: "Válida hasta", bill: "Vence" };

function paragraph(class_name, text) {
  return make_element("p", class_name, text);
}

function business_block(business) {
  const block = make_element("div", "paper_business");
  if (business.logo) {
    const logo = make_element("img", "");
    logo.src = business.logo;
    logo.alt = "";
    block.append(logo);
  }
  const text = make_element("div", "");
  text.append(paragraph("paper_business_name", business.name || "Nombre de tu negocio"));
  [business.tax_id ? `NIT/CC: ${business.tax_id}` : "", [business.address, business.city].filter(Boolean).join(", "), [business.phone, business.email].filter(Boolean).join("  ·  ")]
    .filter(Boolean)
    .forEach((line) => text.append(paragraph("paper_muted", line)));
  block.append(text);
  return block;
}

function meta_block(document) {
  const meta = make_element("div", "paper_meta");
  meta.append(paragraph("paper_kind", KIND_LABELS[document.kind]), paragraph("paper_number", `N.º ${document.number}`), paragraph("", `Fecha: ${format_date_long(document.date)}`));
  if (document.due_date) meta.append(paragraph("", `${DUE_LABELS[document.kind]}: ${format_date_long(document.due_date)}`));
  return meta;
}

function client_block(client) {
  const block = make_element("div", "");
  block.append(paragraph("paper_section_label", "CLIENTE"), paragraph("paper_client_name", client.name || "Nombre del cliente"));
  [client.tax_id ? `NIT/CC: ${client.tax_id}` : "", client.address, [client.phone, client.email].filter(Boolean).join("  ·  ")].filter(Boolean).forEach((line) => block.append(paragraph("", line)));
  return block;
}

function lines_table(document, totals) {
  const table = make_element("table", "");
  const head = make_element("tr", "");
  ["Descripción", "Cant.", "Valor unit.", "Desc.", ...(document.charges_vat ? ["IVA"] : []), "Total"].forEach((label) => head.append(make_element("th", "", label)));
  const thead = make_element("thead", "");
  thead.append(head);
  table.append(thead);
  const body = make_element("tbody", "");
  document.lines.forEach((line, index) => {
    const row = make_element("tr", "");
    [line.description, format_quantity(line.quantity), format_money(line.unit_price), line.discount_percent > 0 ? format_percent(line.discount_percent) : "", ...(document.charges_vat ? [format_percent(line.tax_rate)] : []), format_money(totals.line_totals[index])].forEach((value) => row.append(make_element("td", "", value)));
    body.append(row);
  });
  table.append(body);
  return table;
}

function totals_block(document, totals) {
  const block = make_element("div", "paper_totals");
  const add = (label, value, class_name = "") => {
    const row = make_element("div", class_name);
    row.append(make_element("span", "", label), make_element("span", "", value));
    block.append(row);
  };
  add("Subtotal", format_money(totals.subtotal));
  if (totals.general_discount > 0) add(`Descuento (${format_percent(document.discount_percent)})`, format_money(-totals.general_discount));
  totals.vat.forEach((entry) => add(`IVA ${format_percent(entry.rate)}`, format_money(entry.amount)));
  if (totals.withholding > 0) add(`Retención en la fuente (${format_percent(document.withholding_percent)})`, format_money(-totals.withholding));
  add("TOTAL", format_money(totals.total), "is_total");
  return block;
}

// Dibuja el documento dentro de un contenedor (se vacía antes)
export function render_preview(container, document, business) {
  const totals = calculate_totals(document);
  const body = make_element("div", "paper_body");
  const head = make_element("div", "paper_head");
  head.append(business_block(business), meta_block(document));
  body.append(head, client_block(document.client), lines_table(document, totals), totals_block(document, totals));
  if (document.notes.trim()) body.append(paragraph("paper_section_label", "NOTAS"), paragraph("paper_text", document.notes));
  if (business.payment_info.trim()) body.append(paragraph("paper_section_label", "DATOS PARA EL PAGO"), paragraph("paper_text", business.payment_info));
  const footer = make_element("div", "paper_footer");
  footer.textContent = [business.footer_text, disclaimer_text(document)].filter((text) => text.trim() !== "").join("\n");
  container.replaceChildren(body, footer);
}
