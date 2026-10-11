// Resumen: para el mes elegido, lo cotizado, lo aceptado, lo cobrado y lo pendiente por cobrar; la lista de cuentas de cobro
// pendientes (las vencidas primero) y barras simples de los últimos seis meses, dibujadas con SVG.
import {
  effective_status,
  format_date_short,
  format_money,
  format_month,
  month_of,
  monthly_series,
  monthly_summary,
  pending_bills,
  shift_month,
  today_key,
} from "./document_model.js";
import { hooks } from "./navigation.js";
import { state } from "./store.js";
import { by_id, count_text, make_element } from "./ui_helpers.js";

const MONTHS = 6;
const SVG_NS = "http://www.w3.org/2000/svg";
const CHART = { width: 600, height: 220, top: 16, bottom: 36, left: 8, right: 8 };
const QUOTED_COLOR = "#22d3ee";
const COLLECTED_COLOR = "#4ade80";
const MONTH_NAMES_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

let month = month_of(today_key(new Date()));

function svg_element(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function render_figures(summary, pending) {
  const figures = [
    { label: "Cotizado en el mes", ...summary.quoted, unit: ["cotización", "cotizaciones"] },
    { label: "Aceptado en el mes", ...summary.accepted, unit: ["aceptada", "aceptadas"] },
    { label: "Cobrado en el mes", ...summary.paid, unit: ["cuenta pagada", "cuentas pagadas"] },
    { label: "Pendiente por cobrar", count: pending.length, value: pending.reduce((total, entry) => total + entry.total, 0), unit: ["cuenta enviada", "cuentas enviadas"] },
  ];
  by_id("summary_figures").replaceChildren(...figures.map((figure) => {
    const item = make_element("li", "figure");
    item.append(make_element("span", "figure_label", figure.label), make_element("span", "figure_value", format_money(figure.value)), make_element("span", "figure_count", count_text(figure.count, ...figure.unit)));
    return item;
  }));
}

function render_pending(pending, today) {
  const list = by_id("pending_list");
  list.replaceChildren(...pending.map(({ document, expired, total }) => {
    const row = make_element("li", "item");
    const main = make_element("button", "item_main");
    main.type = "button";
    const detail = document.due_date ? `${expired ? "Vencida" : "Vence"} el ${format_date_short(document.due_date)}` : "Sin fecha de vencimiento";
    const detail_element = make_element("span", "item_detail", detail);
    if (expired) detail_element.classList.add("is_error");
    main.append(make_element("span", "item_title", `${document.number} · ${document.client.name.trim() || "Sin cliente"}`), detail_element);
    main.addEventListener("click", () => hooks.open_document(document.id));
    const status = effective_status(document, today);
    row.append(main, make_element("span", "item_amount", format_money(total)), make_element("span", `status_chip is_${status}`, status === "expired" ? "Vencida" : "Enviada"));
    return row;
  }));
  by_id("pending_empty").hidden = pending.length > 0;
}

// Barras de lo cotizado y lo cobrado, mes por mes. El texto completo va en el aria-label para quien no ve el dibujo.
function render_chart(series) {
  const box = by_id("chart_box");
  const maximum = Math.max(1, ...series.flatMap((entry) => [entry.quoted, entry.collected]));
  const plot_height = CHART.height - CHART.top - CHART.bottom;
  const slot = (CHART.width - CHART.left - CHART.right) / series.length;
  const bar_width = Math.min(34, slot / 3);
  const svg = svg_element("svg", { viewBox: `0 0 ${CHART.width} ${CHART.height}`, role: "img", "aria-label": `Cotizado y cobrado en los últimos seis meses. ${series.map((entry) => `${format_month(entry.month)}: cotizado ${format_money(entry.quoted)}, cobrado ${format_money(entry.collected)}`).join(". ")}.` });
  svg.append(svg_element("line", { x1: CHART.left, x2: CHART.width - CHART.right, y1: CHART.height - CHART.bottom, y2: CHART.height - CHART.bottom, stroke: "#6a8094", "stroke-width": 1 }));
  series.forEach((entry, index) => {
    const center = CHART.left + slot * index + slot / 2;
    [[entry.quoted, QUOTED_COLOR, -bar_width - 2, "Cotizado"], [entry.collected, COLLECTED_COLOR, 2, "Cobrado"]].forEach(([value, color, offset, label]) => {
      const height = value === 0 ? 0 : Math.max(2, (value / maximum) * plot_height);
      const bar = svg_element("rect", { x: center + offset, y: CHART.height - CHART.bottom - height, width: bar_width, height, fill: color, rx: 3 });
      bar.append(Object.assign(svg_element("title"), { textContent: `${label} en ${format_month(entry.month)}: ${format_money(value)}` }));
      svg.append(bar);
    });
    const text = svg_element("text", { x: center, y: CHART.height - 14, "text-anchor": "middle", fill: "#9fb0c0", "font-size": 15 });
    text.textContent = MONTH_NAMES_SHORT[Number(entry.month.slice(5)) - 1];
    svg.append(text);
  });
  const legend = make_element("div", "chart_legend");
  [["Cotizado", QUOTED_COLOR], ["Cobrado", COLLECTED_COLOR]].forEach(([label, color]) => {
    const item = make_element("span", "");
    const swatch = make_element("span", "legend_swatch");
    swatch.style.background = color;
    item.append(swatch, document.createTextNode(label));
    legend.append(item);
  });
  box.replaceChildren(svg, legend);
}

export function render_summary() {
  const today = today_key(new Date());
  const documents = state.data.documents;
  const pending = pending_bills(documents, today);
  by_id("month_label").textContent = format_month(month);
  render_figures(monthly_summary(documents, month), pending);
  render_pending(pending, today);
  render_chart(monthly_series(documents, month, MONTHS));
}

export function init_summary() {
  by_id("month_previous_button").addEventListener("click", () => {
    month = shift_month(month, -1);
    render_summary();
  });
  by_id("month_next_button").addEventListener("click", () => {
    month = shift_month(month, 1);
    render_summary();
  });
  by_id("month_today_button").addEventListener("click", () => {
    month = month_of(today_key(new Date()));
    render_summary();
  });
}
