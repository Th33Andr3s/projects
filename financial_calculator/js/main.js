// Calculadora financiera: pestañas, lectura de lo que se escribe, formato en pesos, los cuatro cálculos (préstamo
// con su tabla, interés simple y compuesto, ahorro con su gráfico y conversión de tasas), copiar y la memoria de los
// últimos valores. Las fórmulas viven en finance.js.
import { start_scene, flash_scene } from "./animations.js";
import {
  effective_annual_to_period_rate,
  build_amortization,
  convert_rates,
  calculate_simple_interest,
  calculate_compound_interest,
  calculate_saving,
} from "./finance.js";

const STORAGE_KEY = "financial_calculator_last";
const DEFAULT_CALCULATION = "loan";
const MAX_FIELD_LENGTH = 30;
const NBSP = " ";
const MAX_MONEY = 999_999_999_999;
const MAX_RATE_PERCENT = 500;
const MIN_MONTHS = 1;
const MAX_MONTHS = 480;
const MIN_YEARS = 1;
const MAX_YEARS = 60;
const MONTHS_PER_YEAR = 12;
const COPIED_MILLISECONDS = 2000;
const EMPTY_VALUE = "—";

// Cómo se llama cada capitalización y su "vencida" en la jerga bancaria colombiana (N.A.M.V., N.A.T.V., etc.)
const COMPOUNDINGS = {
  12: { period_adjective: "mensual", matured: "mes vencido" },
  6: { period_adjective: "bimestral", matured: "bimestre vencido" },
  4: { period_adjective: "trimestral", matured: "trimestre vencido" },
  2: { period_adjective: "semestral", matured: "semestre vencido" },
};

// Medidas del gráfico del ahorro (el SVG se dibuja en un espacio de 320 por 170 y se escala a la pantalla)
const CHART = { width: 320, height: 170, left: 12, right: 12, top: 12, bottom: 30 };
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MAX_CHART_LABELS = 10;
// Separación mínima entre dos etiquetas del eje, en unidades del gráfico, para que no se pisen
const MIN_LABEL_GAP = 22;
// Un punto muy arriba abriría su globo fuera del gráfico: en ese caso el globo va debajo del punto
const TOOLTIP_BELOW_UNDER_Y = 70;

const dom = {
  tabs: [...document.querySelectorAll(".tab")],
  tab_list: document.querySelector(".tabs"),
  copy_status: document.getElementById("copy_status"),
  // Préstamo
  loan_amount: document.getElementById("loan_amount"),
  loan_rate: document.getElementById("loan_rate"),
  loan_months: document.getElementById("loan_months"),
  loan_hint: document.getElementById("loan_hint"),
  loan_error: document.getElementById("loan_error"),
  loan_payment: document.getElementById("loan_payment"),
  loan_total: document.getElementById("loan_total"),
  loan_interest: document.getElementById("loan_interest"),
  loan_share: document.getElementById("loan_share"),
  copy_loan_button: document.getElementById("copy_loan_button"),
  copy_loan_label: document.getElementById("copy_loan_label"),
  table_panel: document.querySelector(".table_panel"),
  table_body: document.querySelector("#amortization_table tbody"),
  table: document.getElementById("amortization_table"),
  copy_table_button: document.getElementById("copy_table_button"),
  copy_table_label: document.getElementById("copy_table_label"),
  // Interés
  interest_capital: document.getElementById("interest_capital"),
  interest_rate: document.getElementById("interest_rate"),
  interest_months: document.getElementById("interest_months"),
  interest_hint: document.getElementById("interest_hint"),
  interest_error: document.getElementById("interest_error"),
  simple_final: document.getElementById("simple_final"),
  simple_interest: document.getElementById("simple_interest"),
  compound_final: document.getElementById("compound_final"),
  compound_interest: document.getElementById("compound_interest"),
  interest_sentence: document.getElementById("interest_sentence"),
  copy_simple_button: document.getElementById("copy_simple_button"),
  copy_simple_label: document.getElementById("copy_simple_label"),
  copy_compound_button: document.getElementById("copy_compound_button"),
  copy_compound_label: document.getElementById("copy_compound_label"),
  // Ahorro
  saving_initial: document.getElementById("saving_initial"),
  saving_monthly: document.getElementById("saving_monthly"),
  saving_rate: document.getElementById("saving_rate"),
  saving_years: document.getElementById("saving_years"),
  saving_error: document.getElementById("saving_error"),
  saving_total: document.getElementById("saving_total"),
  saving_contributed: document.getElementById("saving_contributed"),
  saving_interest: document.getElementById("saving_interest"),
  copy_saving_button: document.getElementById("copy_saving_button"),
  copy_saving_label: document.getElementById("copy_saving_label"),
  saving_chart: document.getElementById("saving_chart"),
  chart_tooltip: document.getElementById("chart_tooltip"),
  // Tasas
  rates_value: document.getElementById("rates_value"),
  rates_type: document.getElementById("rates_type"),
  rates_compounding: document.getElementById("rates_compounding"),
  rates_error: document.getElementById("rates_error"),
};

// Las tres tasas equivalentes de la pestaña Tasas, con sus elementos
const RATE_KINDS = ["effective_annual", "nominal_annual", "effective_period"];
const rate_dom = Object.fromEntries(
  RATE_KINDS.map((kind) => [
    kind,
    {
      item: document.getElementById(`rate_item_${kind}`),
      name: document.getElementById(`rate_name_${kind}`),
      value: document.getElementById(`rate_${kind}`),
      formula: document.getElementById(`rate_formula_${kind}`),
      badge: document.querySelector(`#rate_item_${kind} .rate_badge`),
      copy_button: document.getElementById(`copy_rate_${kind}`),
    },
  ]),
);

// Lo último calculado en cada pestaña. La tabla del préstamo solo se dibuja cuando se abre, porque con 480 meses
// pesaría en celular.
let loan_result = null;
let is_table_stale = true;
let interest_result = null;
let saving_result = null;
// Último resultado mostrado en cada pestaña: el fondo solo hace su destello cuando el resultado cambia de verdad
const last_results = {};

// ---------------------------------------------------------------------------
// Leer lo que se escribe. Cada función devuelve { is_empty }, { error } o { value }.
// ---------------------------------------------------------------------------

// Dinero. Acepta "1250000", "1.250.000" y "1,250,000". Un solo punto o coma seguido de exactamente tres cifras
// es un separador de miles ("1.250"); seguido de otra cantidad es el decimal ("1250,5"). Si aparecen los dos
// signos, el último es el decimal. name es cómo se llama el campo en los mensajes ("monto", "capital"...).
function parse_money(text, name = "monto", allow_zero = false) {
  const cleaned = text.replace(/[\s$]/g, "");
  if (cleaned === "") return { is_empty: true };
  if (cleaned.startsWith("-")) return { error: `El ${name} no puede ser negativo.` };
  if (!/^[\d.,]+$/.test(cleaned)) return { error: "Escribe un número." };

  const commas = (cleaned.match(/,/g) || []).length;
  const dots = (cleaned.match(/\./g) || []).length;
  let integer_text = cleaned;
  let decimal_text = "";
  if (commas && dots) {
    const decimal_index = Math.max(cleaned.lastIndexOf(","), cleaned.lastIndexOf("."));
    integer_text = cleaned.slice(0, decimal_index).replace(/[.,]/g, "");
    decimal_text = cleaned.slice(decimal_index + 1);
  } else if (commas + dots > 1) {
    integer_text = cleaned.replace(/[.,]/g, "");
  } else if (commas + dots === 1) {
    const [whole, fraction] = cleaned.split(/[.,]/);
    if (fraction.length === 3) integer_text = whole + fraction;
    else {
      integer_text = whole;
      decimal_text = fraction;
    }
  }
  if (!/^\d*$/.test(decimal_text)) return { error: "Escribe un número." };

  const value = Number(`${integer_text || "0"}.${decimal_text || "0"}`);
  if (!Number.isFinite(value)) return { error: "Escribe un número." };
  if (value === 0 && !allow_zero) return { error: `El ${name} debe ser mayor que 0.` };
  if (value > MAX_MONEY) return { error: `El ${name} máximo es ${format_money(MAX_MONEY)}.` };
  return { value };
}

// Porcentaje, con coma o punto decimal. Devuelve el porcentaje tal cual se escribió (18 para 18 %).
function parse_percent(text) {
  const cleaned = text.replace(/[\s%]/g, "").replace(",", ".");
  if (cleaned === "") return { is_empty: true };
  if (cleaned.startsWith("-")) return { error: "La tasa no puede ser negativa." };
  if (!/^(\d+\.?\d*|\.\d+)$/.test(cleaned)) return { error: "Escribe un número." };
  const value = Number(cleaned);
  if (value > MAX_RATE_PERCENT) return { error: `La tasa máxima es ${MAX_RATE_PERCENT} %.` };
  return { value };
}

function parse_whole_number(text, minimum, maximum, too_small_message, too_large_message) {
  const cleaned = text.replace(/\s/g, "");
  if (cleaned === "") return { is_empty: true };
  if (cleaned.startsWith("-")) return { error: "No puede ser negativo." };
  if (!/^\d+$/.test(cleaned)) return { error: "Escribe un número entero." };
  const value = Number(cleaned);
  if (value < minimum) return { error: too_small_message };
  if (value > maximum) return { error: too_large_message };
  return { value };
}

function parse_months(text, name = "plazo") {
  return parse_whole_number(
    text,
    MIN_MONTHS,
    MAX_MONTHS,
    `El ${name} mínimo es ${MIN_MONTHS} mes.`,
    `El ${name} máximo es ${MAX_MONTHS} meses (${MAX_MONTHS / MONTHS_PER_YEAR} años).`,
  );
}

function parse_years(text) {
  return parse_whole_number(text, MIN_YEARS, MAX_YEARS, `El tiempo mínimo es ${MIN_YEARS} año.`, `El tiempo máximo es ${MAX_YEARS} años.`);
}

// Lee un conjunto de campos, marca los que tienen un valor que no sirve y muestra el primer mensaje bajo ellos.
// Devuelve los valores en el mismo orden y si todo está listo para calcular (nada vacío ni con error).
function read_fields(specs, error_element) {
  const fields = specs.map(({ input, parse }) => ({ input, parsed: parse(input.value) }));
  const first_error = fields.find(({ parsed }) => parsed.error);
  fields.forEach(({ input, parsed }) => mark_invalid(input, Boolean(parsed.error)));
  show_error(error_element, first_error ? first_error.parsed.error : "");
  return {
    values: fields.map(({ parsed }) => parsed.value),
    is_ready: !first_error && fields.every(({ parsed }) => !parsed.is_empty),
  };
}

function mark_invalid(input, is_invalid) {
  const group = input.closest(".input_group");
  if (group) group.classList.toggle("is_invalid", is_invalid);
  input.setAttribute("aria-invalid", String(is_invalid));
}

function show_error(error_element, message) {
  error_element.textContent = message;
  error_element.hidden = !message;
}

// ---------------------------------------------------------------------------
// Mostrar números
// ---------------------------------------------------------------------------

// Puntos para los miles, como en Colombia: 1250000 → "1.250.000". Se arma a mano para no depender del idioma
// ni de la versión del navegador.
function group_thousands(whole_number) {
  return String(Math.round(whole_number)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function format_money(value) {
  return `$${NBSP}${group_thousands(value)}`;
}

// 16,67 % (con punto en los miles si hiciera falta: 6.402,14 %)
function format_percent(value, decimals) {
  const [whole, fraction] = value.toFixed(decimals).split(".");
  const grouped = group_thousands(Number(whole));
  return `${fraction ? `${grouped},${fraction}` : grouped}${NBSP}%`;
}

// "36 meses = 3 años", "18 meses = 1 año y 6 meses"
function describe_months(months) {
  if (months < MONTHS_PER_YEAR) return "Menos de un año";
  const years = Math.floor(months / MONTHS_PER_YEAR);
  const remaining_months = months % MONTHS_PER_YEAR;
  const years_text = `${years} ${years === 1 ? "año" : "años"}`;
  const months_text = remaining_months ? ` y ${remaining_months} ${remaining_months === 1 ? "mes" : "meses"}` : "";
  return `${months} meses = ${years_text}${months_text}`;
}

// Al salir de un campo de dinero se ordena con puntos y se descartan los centavos que se hubieran escrito.
function format_money_field(input, name, allow_zero) {
  const parsed = parse_money(input.value, name, allow_zero);
  if (parsed.value !== undefined) input.value = group_thousands(parsed.value);
}

// ---------------------------------------------------------------------------
// Copiar
// ---------------------------------------------------------------------------

function select_node_text(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

// Conecta un botón de copiar. get_text devuelve lo que se copia; si el navegador no deja copiar, get_fallback_node
// devuelve el elemento que se deja seleccionado para copiarlo a mano. Los botones solo con icono no llevan label.
// Devuelve la función que vuelve el botón a su estado normal, para llamarla cuando cambia el resultado.
function setup_copy({ button, label, idle_label, get_text, get_fallback_node }) {
  const icon = button.querySelector("i");
  let timer = 0;

  function reset() {
    clearTimeout(timer);
    if (label) label.textContent = idle_label;
    icon.className = "fa-regular fa-copy";
    dom.copy_status.textContent = "";
  }

  function show(label_text, icon_class, status) {
    if (label) label.textContent = label_text;
    icon.className = icon_class;
    dom.copy_status.textContent = status;
    clearTimeout(timer);
    timer = setTimeout(reset, COPIED_MILLISECONDS);
  }

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(get_text());
      show("Copiado", "fa-solid fa-check", "Copiado al portapapeles.");
    } catch {
      // El navegador no deja copiar (por ejemplo, página sin https): se deja seleccionado para copiarlo a mano.
      select_node_text(get_fallback_node());
      show("Copia a mano", "fa-regular fa-copy", "No se pudo copiar solo. Quedó seleccionado: cópialo con Ctrl y C, o mantén pulsado sobre él.");
    }
  });
  return reset;
}

// Lo que se copia de un resultado de dinero: el número solo, sin símbolo ni puntos, para pegarlo en cualquier parte
function money_text(value) {
  return String(Math.round(value));
}

// Lo que se copia de una tasa: el número como se ve, sin el símbolo de porcentaje
function rate_text(element) {
  return element.textContent.replace(`${NBSP}%`, "");
}

// El fondo hace su destello cuando el resultado de una pestaña cambia (no si se vuelve a escribir lo mismo).
function announce_result(calculation, result_text) {
  if (last_results[calculation] !== result_text) flash_scene();
  last_results[calculation] = result_text;
}

// ---------------------------------------------------------------------------
// Préstamo
// ---------------------------------------------------------------------------

function render_table() {
  const fragment = document.createDocumentFragment();
  loan_result.rows.forEach((row) => {
    const tr = document.createElement("tr");
    [row.month, ...[row.payment, row.interest, row.principal, row.balance].map(format_money)].forEach((cell_text) => {
      const td = document.createElement("td");
      td.textContent = String(cell_text);
      tr.append(td);
    });
    fragment.append(tr);
  });
  dom.table_body.replaceChildren(fragment);
  is_table_stale = false;
}

// Dibuja la tabla solo si está abierta. Si está plegada, la vacía y la deja pendiente para cuando se abra.
function refresh_table() {
  if (loan_result && dom.table_panel.open) {
    render_table();
    return;
  }
  dom.table_body.replaceChildren();
  is_table_stale = true;
}

// Texto de la tabla para pegar en una hoja de cálculo: columnas separadas por tabulaciones, cifras sin símbolo.
function get_table_text() {
  const header = ["Mes", "Cuota", "Interés", "Abono a capital", "Saldo"].join("\t");
  const lines = loan_result.rows.map((row) =>
    [row.month, row.payment, row.interest, row.principal, row.balance].map((value, index) => (index === 0 ? value : Math.round(value))).join("\t"),
  );
  return [header, ...lines].join("\n");
}

function clear_loan_result() {
  last_results.loan = "";
  loan_result = null;
  [dom.loan_payment, dom.loan_total, dom.loan_interest, dom.loan_share].forEach((element) => (element.textContent = EMPTY_VALUE));
  dom.copy_loan_button.disabled = true;
  dom.copy_table_button.disabled = true;
  refresh_table();
}

// Recalcula el préstamo con lo que hay en pantalla.
function update_loan() {
  save_state();
  const { values, is_ready } = read_fields(
    [
      { input: dom.loan_amount, parse: (text) => parse_money(text, "monto") },
      { input: dom.loan_rate, parse: parse_percent },
      { input: dom.loan_months, parse: parse_months },
    ],
    dom.loan_error,
  );
  const [amount, rate, months] = values;
  dom.loan_hint.textContent = months ? describe_months(months) : "";
  reset_copy_loan();
  reset_copy_table();

  if (!is_ready) {
    clear_loan_result();
    return;
  }

  const monthly_rate = effective_annual_to_period_rate(rate / 100);
  loan_result = build_amortization(amount, monthly_rate, months);
  dom.loan_payment.textContent = format_money(loan_result.payment);
  dom.loan_total.textContent = format_money(loan_result.total_paid);
  dom.loan_interest.textContent = format_money(loan_result.total_interest);
  dom.loan_share.textContent = format_percent((loan_result.total_interest / loan_result.total_paid) * 100, 1);
  dom.copy_loan_button.disabled = false;
  dom.copy_table_button.disabled = false;
  refresh_table();
  announce_result("loan", dom.loan_payment.textContent);
}

const reset_copy_loan = setup_copy({
  button: dom.copy_loan_button,
  label: dom.copy_loan_label,
  idle_label: "Copiar cuota",
  get_text: () => money_text(loan_result.payment),
  get_fallback_node: () => dom.loan_payment,
});

const reset_copy_table = setup_copy({
  button: dom.copy_table_button,
  label: dom.copy_table_label,
  idle_label: "Copiar tabla",
  get_text: get_table_text,
  // Si no se pudo copiar, se muestra la tabla y se deja seleccionada
  get_fallback_node: () => {
    dom.table_panel.open = true;
    if (is_table_stale) render_table();
    return dom.table;
  },
});

// ---------------------------------------------------------------------------
// Interés simple y compuesto
// ---------------------------------------------------------------------------

// La frase que explica la diferencia. Con menos de un año el compuesto gana menos que el simple, y a un año exacto
// dan lo mismo, así que "el compuesto gana más" no siempre es cierto.
function describe_interest_difference(rate, months, difference) {
  if (rate === 0) return "Con tasa 0 no se generan intereses.";
  if (months === MONTHS_PER_YEAR) return "A un año exacto el simple y el compuesto dan lo mismo: todavía no hay intereses sobre intereses.";
  const pesos = Math.round(Math.abs(difference));
  if (pesos === 0) return "La diferencia entre los dos es de menos de un peso.";
  if (difference > 0) return `El compuesto gana ${format_money(pesos)} más porque los intereses también generan intereses.`;
  return `Con menos de un año el simple gana ${format_money(pesos)} más: el compuesto solo supera al simple a partir del primer año.`;
}

function clear_interest_result() {
  last_results.interest = "";
  interest_result = null;
  [dom.simple_final, dom.compound_final, dom.simple_interest, dom.compound_interest].forEach((element) => (element.textContent = EMPTY_VALUE));
  dom.interest_sentence.textContent = "";
  dom.copy_simple_button.disabled = true;
  dom.copy_compound_button.disabled = true;
}

function update_interest() {
  save_state();
  const { values, is_ready } = read_fields(
    [
      { input: dom.interest_capital, parse: (text) => parse_money(text, "capital") },
      { input: dom.interest_rate, parse: parse_percent },
      { input: dom.interest_months, parse: (text) => parse_months(text, "tiempo") },
    ],
    dom.interest_error,
  );
  const [capital, rate, months] = values;
  dom.interest_hint.textContent = months ? describe_months(months) : "";
  reset_copy_simple();
  reset_copy_compound();

  if (!is_ready) {
    clear_interest_result();
    return;
  }

  const years = months / MONTHS_PER_YEAR;
  const simple = calculate_simple_interest(capital, rate / 100, years);
  const compound = calculate_compound_interest(capital, rate / 100, years);
  interest_result = { simple, compound };
  dom.simple_final.textContent = format_money(simple.final_amount);
  dom.simple_interest.textContent = format_money(simple.interest);
  dom.compound_final.textContent = format_money(compound.final_amount);
  dom.compound_interest.textContent = format_money(compound.interest);
  dom.interest_sentence.textContent = describe_interest_difference(rate, months, compound.interest - simple.interest);
  dom.copy_simple_button.disabled = false;
  dom.copy_compound_button.disabled = false;
  announce_result("interest", dom.simple_final.textContent + dom.compound_final.textContent);
}

const reset_copy_simple = setup_copy({
  button: dom.copy_simple_button,
  label: dom.copy_simple_label,
  idle_label: "Copiar",
  get_text: () => money_text(interest_result.simple.final_amount),
  get_fallback_node: () => dom.simple_final,
});

const reset_copy_compound = setup_copy({
  button: dom.copy_compound_button,
  label: dom.copy_compound_label,
  idle_label: "Copiar",
  get_text: () => money_text(interest_result.compound.final_amount),
  get_fallback_node: () => dom.compound_final,
});

// ---------------------------------------------------------------------------
// Ahorro y su gráfico
// ---------------------------------------------------------------------------

function svg_element(name, attributes = {}) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  Object.entries(attributes).forEach(([attribute, value]) => element.setAttribute(attribute, String(value)));
  return element;
}

function hide_tooltip() {
  dom.chart_tooltip.hidden = true;
}

// Muestra el globo con los datos de un año, sobre su punto (o debajo, si el punto está muy arriba).
function show_tooltip(year_data, x, y) {
  const title = document.createElement("strong");
  title.textContent = `Año ${year_data.year}`;
  const contributed_line = document.createElement("span");
  contributed_line.textContent = `Aportado: ${format_money(year_data.contributed)}`;
  const total_line = document.createElement("span");
  total_line.textContent = `Acumulado: ${format_money(year_data.total)}`;
  dom.chart_tooltip.replaceChildren(title, contributed_line, document.createElement("br"), total_line);

  const horizontal_share = x / CHART.width;
  // Cerca de los bordes el globo se corre para no salirse del gráfico
  const horizontal_shift = horizontal_share < 0.2 ? "-10%" : horizontal_share > 0.8 ? "-90%" : "-50%";
  const vertical_offset = y < TOOLTIP_BELOW_UNDER_Y ? "14px" : "calc(-100% - 14px)";
  dom.chart_tooltip.style.left = `${horizontal_share * 100}%`;
  dom.chart_tooltip.style.top = `${(y / CHART.height) * 100}%`;
  dom.chart_tooltip.style.transform = `translate(${horizontal_shift}, ${vertical_offset})`;
  dom.chart_tooltip.hidden = false;
}

// Dibuja el gráfico del ahorro: una curva de lo aportado y otra de lo acumulado. Los puntos de algunos años (como
// mucho unos diez, para que las etiquetas no se amontonen) son enfocables y muestran sus datos.
function render_chart(saving) {
  const { width, height, left, right, top, bottom } = CHART;
  const years = saving.yearly.length - 1;
  const x_at = (year) => left + ((width - left - right) * year) / years;
  const y_at = (value) => top + (height - top - bottom) * (1 - value / saving.final_amount);
  const step = Math.max(1, Math.ceil(years / MAX_CHART_LABELS));
  const marked_years = saving.yearly.filter((year_data) => year_data.year % step === 0);
  // El último año siempre se marca, porque es la cifra del resumen. Si queda pegado al anterior, se quita el anterior.
  if (marked_years[marked_years.length - 1].year !== years) {
    if (x_at(years) - x_at(marked_years[marked_years.length - 1].year) < MIN_LABEL_GAP) marked_years.pop();
    marked_years.push(saving.yearly[years]);
  }
  const line_points = (key) => saving.yearly.map((year_data) => `${x_at(year_data.year).toFixed(1)},${y_at(year_data[key]).toFixed(1)}`).join(" ");

  const elements = [
    svg_element("line", { class: "chart_axis", x1: left, y1: y_at(0), x2: width - right, y2: y_at(0) }),
    svg_element("polyline", { class: "chart_line chart_line_contributed", points: line_points("contributed") }),
    svg_element("polyline", { class: "chart_line chart_line_total", points: line_points("total") }),
  ];
  marked_years.forEach((year_data) => {
    const x = x_at(year_data.year);
    const y = y_at(year_data.total);
    const point = svg_element("g", {
      class: "chart_point",
      tabindex: 0,
      role: "img",
      "aria-label": `Año ${year_data.year}: aportado ${format_money(year_data.contributed)}, acumulado ${format_money(year_data.total)}`,
    });
    point.append(svg_element("circle", { class: "chart_dot", cx: x, cy: y, r: 4 }), svg_element("circle", { class: "chart_hit", cx: x, cy: y, r: 14 }));
    // Con el mouse el globo sigue al puntero; con el dedo o el teclado aparece al enfocar el punto
    point.addEventListener("pointerenter", (event) => event.pointerType === "mouse" && show_tooltip(year_data, x, y));
    point.addEventListener("pointerleave", (event) => event.pointerType === "mouse" && hide_tooltip());
    point.addEventListener("focus", () => show_tooltip(year_data, x, y));
    point.addEventListener("blur", hide_tooltip);
    point.addEventListener("keydown", (event) => event.key === "Escape" && hide_tooltip());
    elements.push(point);
  });
  marked_years.forEach((year_data) => {
    const label = svg_element("text", { class: "chart_label", x: x_at(year_data.year), y: height - 10, "text-anchor": "middle" });
    label.textContent = String(year_data.year);
    elements.push(label);
  });
  hide_tooltip();
  dom.saving_chart.replaceChildren(...elements);
}

function clear_saving_result() {
  last_results.saving = "";
  saving_result = null;
  [dom.saving_total, dom.saving_contributed, dom.saving_interest].forEach((element) => (element.textContent = EMPTY_VALUE));
  dom.copy_saving_button.disabled = true;
  hide_tooltip();
  dom.saving_chart.replaceChildren();
}

function update_saving() {
  save_state();
  const { values, is_ready } = read_fields(
    [
      { input: dom.saving_initial, parse: (text) => parse_money(text, "aporte inicial", true) },
      { input: dom.saving_monthly, parse: (text) => parse_money(text, "aporte mensual", true) },
      { input: dom.saving_rate, parse: parse_percent },
      { input: dom.saving_years, parse: parse_years },
    ],
    dom.saving_error,
  );
  const [initial, monthly, rate, years] = values;
  reset_copy_saving();

  if (!is_ready) {
    clear_saving_result();
    return;
  }
  // Sin ningún aporte no hay nada que acumular
  if (initial === 0 && monthly === 0) {
    [dom.saving_initial, dom.saving_monthly].forEach((input) => mark_invalid(input, true));
    show_error(dom.saving_error, "Escribe al menos un aporte.");
    clear_saving_result();
    return;
  }

  saving_result = calculate_saving(initial, monthly, rate / 100, years);
  dom.saving_total.textContent = format_money(saving_result.final_amount);
  dom.saving_contributed.textContent = format_money(saving_result.contributed);
  dom.saving_interest.textContent = format_money(saving_result.interest);
  dom.copy_saving_button.disabled = false;
  render_chart(saving_result);
  announce_result("saving", dom.saving_total.textContent);
}

const reset_copy_saving = setup_copy({
  button: dom.copy_saving_button,
  label: dom.copy_saving_label,
  idle_label: "Copiar acumulado",
  get_text: () => money_text(saving_result.final_amount),
  get_fallback_node: () => dom.saving_total,
});

// ---------------------------------------------------------------------------
// Tasas
// ---------------------------------------------------------------------------

// Escribe una fórmula; una parte puede ser un texto o un exponente ({ sup: "12" }).
function set_formula(element, parts) {
  const nodes = parts.map((part) => {
    if (typeof part === "string") return document.createTextNode(part);
    const sup = document.createElement("sup");
    sup.textContent = part.sup;
    return sup;
  });
  element.replaceChildren(...nodes);
}

// Nombres, fórmulas y la marca de "la que escribiste". Dependen del tipo de tasa y de la capitalización, no del valor.
function render_rate_labels(type, periods) {
  const { period_adjective, matured } = COMPOUNDINGS[periods];
  rate_dom.effective_annual.name.textContent = "Efectiva anual";
  rate_dom.nominal_annual.name.textContent = `Nominal anual (${matured})`;
  rate_dom.effective_period.name.textContent = `Efectiva ${period_adjective}`;

  set_formula(rate_dom.effective_annual.formula, ["E.A. = (1 + i)", { sup: String(periods) }, " − 1"]);
  set_formula(rate_dom.nominal_annual.formula, [`N.A. = i × ${periods}`]);
  set_formula(
    rate_dom.effective_period.formula,
    type === "nominal_annual" ? [`i = N.A. ÷ ${periods}`] : ["i = (1 + E.A.)", { sup: `1/${periods}` }, " − 1"],
  );

  RATE_KINDS.forEach((kind) => {
    const is_given = kind === type;
    rate_dom[kind].item.classList.toggle("rate_item_given", is_given);
    rate_dom[kind].badge.hidden = !is_given;
  });
}

function clear_rates_result() {
  last_results.rates = "";
  RATE_KINDS.forEach((kind) => {
    rate_dom[kind].value.textContent = EMPTY_VALUE;
    rate_dom[kind].copy_button.disabled = true;
  });
}

function update_rates() {
  save_state();
  const { values, is_ready } = read_fields([{ input: dom.rates_value, parse: parse_percent }], dom.rates_error);
  const type = dom.rates_type.value;
  const periods = Number(dom.rates_compounding.value);
  render_rate_labels(type, periods);
  reset_copy_rates.forEach((reset) => reset());

  if (!is_ready) {
    clear_rates_result();
    return;
  }

  const rates = convert_rates(values[0] / 100, type, periods);
  rate_dom.effective_annual.value.textContent = format_percent(rates.effective_annual * 100, 2);
  rate_dom.nominal_annual.value.textContent = format_percent(rates.nominal_annual * 100, 2);
  rate_dom.effective_period.value.textContent = format_percent(rates.period * 100, 4);
  RATE_KINDS.forEach((kind) => (rate_dom[kind].copy_button.disabled = false));
  announce_result("rates", RATE_KINDS.map((kind) => rate_dom[kind].value.textContent).join());
}

const reset_copy_rates = RATE_KINDS.map((kind) =>
  setup_copy({
    button: rate_dom[kind].copy_button,
    label: null,
    idle_label: "",
    get_text: () => rate_text(rate_dom[kind].value),
    get_fallback_node: () => rate_dom[kind].value,
  }),
);

// ---------------------------------------------------------------------------
// Memoria de los últimos valores
// ---------------------------------------------------------------------------

// Todos los campos que se recuerdan, por su id
const FIELD_IDS = [
  "loan_amount",
  "loan_rate",
  "loan_months",
  "interest_capital",
  "interest_rate",
  "interest_months",
  "saving_initial",
  "saving_monthly",
  "saving_rate",
  "saving_years",
  "rates_value",
  "rates_type",
  "rates_compounding",
];

function get_current_calculation() {
  const active_tab = dom.tabs.find((tab) => tab.getAttribute("aria-selected") === "true");
  return active_tab ? active_tab.dataset.calculation : DEFAULT_CALCULATION;
}

// Acepta solo valores válidos de lo guardado: si alguien lo editó a mano, se usan los iniciales.
function sanitize_state(stored) {
  const calculations = dom.tabs.map((tab) => tab.dataset.calculation);
  const fields = {};
  FIELD_IDS.forEach((id) => {
    const value = stored?.fields?.[id];
    if (typeof value !== "string" || value.length > MAX_FIELD_LENGTH) return;
    const input = dom[id];
    // En las listas desplegables solo vale una opción que exista
    if (input.tagName === "SELECT" && ![...input.options].some((option) => option.value === value)) return;
    fields[id] = value;
  });
  return { calculation: calculations.includes(stored?.calculation) ? stored.calculation : DEFAULT_CALCULATION, fields };
}

// El almacenamiento puede fallar (modo privado, bloqueado): la página funciona igual con lo inicial.
function load_state() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return sanitize_state(stored ? JSON.parse(stored) : null);
  } catch {
    return sanitize_state(null);
  }
}

function save_state() {
  const state = { calculation: get_current_calculation(), fields: Object.fromEntries(FIELD_IDS.map((id) => [id, dom[id].value.slice(0, MAX_FIELD_LENGTH)])) };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Sin almacenamiento los valores solo duran mientras la página está abierta.
  }
}

// ---------------------------------------------------------------------------
// Pestañas
// ---------------------------------------------------------------------------

function select_calculation(calculation_key) {
  dom.tabs.forEach((tab) => {
    const is_active = tab.dataset.calculation === calculation_key;
    tab.setAttribute("aria-selected", String(is_active));
    // Solo la pestaña activa entra en el orden de Tab; con las flechas se pasa a las demás.
    tab.tabIndex = is_active ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !is_active;
  });
  hide_tooltip();
  save_state();
}

function handle_tab_keydown(event) {
  const current_index = dom.tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
  const last_index = dom.tabs.length - 1;
  const next_index = {
    ArrowRight: current_index === last_index ? 0 : current_index + 1,
    ArrowLeft: current_index === 0 ? last_index : current_index - 1,
    Home: 0,
    End: last_index,
  }[event.key];
  if (next_index === undefined) return;
  event.preventDefault();
  select_calculation(dom.tabs[next_index].dataset.calculation);
  dom.tabs[next_index].focus();
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

function setup_events() {
  dom.tabs.forEach((tab) => tab.addEventListener("click", () => select_calculation(tab.dataset.calculation)));
  dom.tab_list.addEventListener("keydown", handle_tab_keydown);

  [dom.loan_amount, dom.loan_rate, dom.loan_months].forEach((input) => input.addEventListener("input", update_loan));
  [dom.interest_capital, dom.interest_rate, dom.interest_months].forEach((input) => input.addEventListener("input", update_interest));
  [dom.saving_initial, dom.saving_monthly, dom.saving_rate, dom.saving_years].forEach((input) => input.addEventListener("input", update_saving));
  [dom.rates_value, dom.rates_type, dom.rates_compounding].forEach((input) => input.addEventListener("input", update_rates));

  dom.loan_amount.addEventListener("change", () => format_money_field(dom.loan_amount, "monto", false));
  dom.interest_capital.addEventListener("change", () => format_money_field(dom.interest_capital, "capital", false));
  dom.saving_initial.addEventListener("change", () => format_money_field(dom.saving_initial, "aporte inicial", true));
  dom.saving_monthly.addEventListener("change", () => format_money_field(dom.saving_monthly, "aporte mensual", true));

  dom.table_panel.addEventListener("toggle", () => {
    if (dom.table_panel.open && loan_result && is_table_stale) render_table();
  });
}

const saved_state = load_state();
Object.entries(saved_state.fields).forEach(([id, value]) => (dom[id].value = value));
setup_events();
update_loan();
update_interest();
update_saving();
update_rates();
select_calculation(saved_state.calculation);
// El fondo es decorativo: se prepara sin esperar y la calculadora ya funciona mientras carga.
start_scene(document.getElementById("scene_canvas"));
