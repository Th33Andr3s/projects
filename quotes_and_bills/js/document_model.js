// Cotizaciones y cuentas de cobro: funciones puras, sin tocar la pantalla, para probarlas con valores conocidos. Aquí viven
// el dinero y su redondeo, los totales con IVA y retención, la numeración, los estados, la validación, las fechas, la
// limpieza de datos guardados y el respaldo.
//
// Dinero: pesos colombianos en enteros. Cada renglón se redondea a peso (mitad hacia arriba) y el IVA y la retención se
// calculan sobre los totales ya redondeados. Las multiplicaciones se hacen con BigInt: así el redondeo es exacto y no
// depende de los errores de los decimales de coma flotante (3 × 12.345 × 0,9 es 33.331,5 y debe dar 33.332).
//
// Las fechas son claves "AAAA-MM-DD" sin hora ni zona horaria; "hoy" es la fecha local del equipo.

const TAX_RATES = [0, 5, 19];
const KINDS = ["quote", "bill"];
export const STATUSES = { quote: ["draft", "sent", "accepted", "rejected"], bill: ["draft", "sent", "paid"] };
export const STATUS_LABELS = { draft: "Borrador", sent: "Enviada", accepted: "Aceptada", rejected: "Rechazada", paid: "Pagada", expired: "Vencida" };
export const KIND_LABELS = { quote: "Cotización", bill: "Cuenta de cobro" };
const DEFAULT_PREFIXES = { quote: "COT", bill: "CC" };
const DEFAULT_VALIDITY_DAYS = 15;
const BILL_DUE_DAYS = 30;
const MAX_LINES = 200;
const MAX_LINE_TOTAL = 1000000000000;
export const MAX_QUANTITY = 100000;
export const MAX_UNIT_PRICE = 10000000000;
const MAX_TEXT = 200;
const MAX_NOTES = 2000;
const MAX_LOGO_LENGTH = 300000;
const MAX_ITEMS = 5000;
const MAX_ID_LENGTH = 64;
const BACKUP_APP = "quotes_and_bills";
const DATA_VERSION = 1;
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const LOGO_PREFIX = "data:image/jpeg;base64,";

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

function pad(value, length) {
  return String(value).padStart(length, "0");
}

// "AAAA-MM-DD" de una fecha, con los números locales del equipo
export function today_key(date) {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

// La fecha de una clave a las 12:00 UTC (donde no existen los cambios de hora), o null si no existe en el calendario
function key_to_utc(key) {
  const match = typeof key === "string" ? KEY_PATTERN.exec(key) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

export function is_valid_key(key) {
  return key_to_utc(key) !== null;
}

function add_days(key, days) {
  const date = new Date(key_to_utc(key).getTime() + days * MILLISECONDS_PER_DAY);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

// "12 oct 2026"
export function format_date_short(key) {
  const date = key_to_utc(key);
  return `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// "12 de octubre de 2026"
export function format_date_long(key) {
  const date = key_to_utc(key);
  return `${date.getUTCDate()} de ${MONTHS_LONG[date.getUTCMonth()]} de ${date.getUTCFullYear()}`;
}

// "octubre de 2026" para un mes "AAAA-MM"
export function format_month(month_key) {
  const match = MONTH_PATTERN.exec(month_key);
  return `${MONTHS_LONG[Number(match[2]) - 1]} de ${match[1]}`;
}

export function month_of(key) {
  return key.slice(0, 7);
}

// El mes anterior (o de varios meses atrás) a uno "AAAA-MM"
export function shift_month(month_key, months) {
  const match = MONTH_PATTERN.exec(month_key);
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + months;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1, 2)}`;
}

// ---------------------------------------------------------------------------
// Dinero, cantidades y porcentajes: texto ⇄ número
// ---------------------------------------------------------------------------

// "$ 1.250.000" (con signo menos si es negativo)
export function format_money(value) {
  const text = String(Math.abs(Math.round(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${value < 0 ? "-" : ""}$ ${text}`;
}

// Cantidad con hasta dos decimales y coma: 2,5 · 3 · 0,33
export function format_quantity(value) {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

// "19 %"
export function format_percent(value) {
  return `${String(Math.round(value * 100) / 100).replace(".", ",")} %`;
}

// Un precio escrito con o sin puntos de miles y signo de pesos ("1250000", "1.250.000", "$ 1.250.000") a entero. NaN si no hay
// dígitos. Los decimales no existen: una coma o punto seguido de uno o dos dígitos al final se descarta.
export function parse_money(text) {
  const cleaned = String(text ?? "").replace(/[$\s]/g, "");
  if (!/\d/.test(cleaned)) return Number.NaN;
  const without_decimals = cleaned.replace(/[.,]\d{1,2}$/, "");
  const digits = without_decimals.replace(/\D/g, "");
  return digits === "" ? Number.NaN : Number(digits);
}

// Un número con coma o punto decimal ("2,5", "2.5") redondeado a dos decimales. NaN si no es un número.
export function parse_decimal(text) {
  const cleaned = String(text ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (cleaned === "" || !/^-?\d*\.?\d*$/.test(cleaned) || !/\d/.test(cleaned)) return Number.NaN;
  return Math.round(Number(cleaned) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Totales
// ---------------------------------------------------------------------------

// Mitad hacia arriba, para números no negativos y con BigInt
function round_ratio(numerator, denominator) {
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

// round(valor × porcentaje / 100), con el porcentaje a dos decimales
function percent_of(value, percent) {
  return round_ratio(BigInt(value) * BigInt(Math.round(percent * 100)), 10000n);
}

// round(cantidad × precio × (1 − descuento / 100))
function line_total(line) {
  const quantity_hundredths = BigInt(Math.round(line.quantity * 100));
  const discount_hundredths = BigInt(Math.round(line.discount_percent * 100));
  return round_ratio(quantity_hundredths * BigInt(line.unit_price) * (10000n - discount_hundredths), 1000000n);
}

// Reparte un total entero entre varios pesos en proporción a ellos, por el método del mayor resto: la suma de lo
// repartido es exactamente el total
function distribute(total, weights) {
  const sum = weights.reduce((accumulated, weight) => accumulated + weight, 0);
  if (total === 0 || sum === 0) return weights.map(() => 0);
  const shares = weights.map((weight) => Number((BigInt(total) * BigInt(weight)) / BigInt(sum)));
  const remainders = weights.map((weight, index) => ({ index, remainder: (BigInt(total) * BigInt(weight)) % BigInt(sum) }));
  let leftover = total - shares.reduce((accumulated, share) => accumulated + share, 0);
  remainders
    .sort((first, second) => (first.remainder === second.remainder ? first.index - second.index : first.remainder > second.remainder ? -1 : 1))
    .forEach(({ index }) => {
      if (leftover > 0) {
        shares[index] += 1;
        leftover -= 1;
      }
    });
  return shares;
}

// Los totales de un documento: { line_totals, subtotal, general_discount, base, vat: [{ rate, base, amount }], vat_total,
// withholding, total }. Si el documento no cobra IVA, todas las tarifas cuentan como 0 y no hay líneas de IVA.
export function calculate_totals(document) {
  const line_totals = document.lines.map(line_total);
  const subtotal = line_totals.reduce((accumulated, value) => accumulated + value, 0);
  const general_discount = percent_of(subtotal, document.discount_percent);
  const base = subtotal - general_discount;
  const shares = distribute(general_discount, line_totals);

  const bases_by_rate = new Map();
  document.lines.forEach((line, index) => {
    const rate = document.charges_vat ? line.tax_rate : 0;
    bases_by_rate.set(rate, (bases_by_rate.get(rate) ?? 0) + line_totals[index] - shares[index]);
  });
  const vat = [...bases_by_rate.entries()]
    .filter(([rate]) => rate > 0)
    .sort(([first], [second]) => first - second)
    .map(([rate, rate_base]) => ({ rate, base: rate_base, amount: percent_of(rate_base, rate) }));
  const vat_total = vat.reduce((accumulated, entry) => accumulated + entry.amount, 0);
  // La retención en la fuente se calcula sobre la base sin IVA
  const withholding = percent_of(base, document.withholding_percent);
  return { line_totals, subtotal, general_discount, base, vat, vat_total, withholding, total: base + vat_total - withholding };
}

export function document_total(document) {
  return calculate_totals(document).total;
}

// ---------------------------------------------------------------------------
// Numeración y estados
// ---------------------------------------------------------------------------

// El siguiente número ("COT-0001") y los contadores ya incrementados. Con más de 9.999 sigue con cinco cifras.
function next_number(counters, kind, prefix) {
  const current = counters[kind];
  return { number: `${prefix}-${String(current).padStart(4, "0")}`, counters: { ...counters, [kind]: current + 1 } };
}

// El contador más bajo que se puede fijar sin repetir un número ya usado con ese prefijo
export function min_counter(documents, kind, prefix) {
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);
  let highest = 0;
  documents.forEach((document) => {
    if (document.kind !== kind) return;
    const match = pattern.exec(document.number);
    if (match) highest = Math.max(highest, Number(match[1]));
  });
  return highest + 1;
}

// El estado que se muestra: Borrador y Enviada pasan a Vencida cuando la fecha límite ya pasó. Aceptada, Rechazada y Pagada
// nunca vencen.
export function effective_status(document, today) {
  if ((document.status === "draft" || document.status === "sent") && document.due_date && document.due_date < today) return "expired";
  return document.status;
}

// ---------------------------------------------------------------------------
// Textos de datos: NIT y teléfono
// ---------------------------------------------------------------------------

// NIT o cédula: solo dígitos y guion ("900.123.456-7" → "900123456-7"). No se valida el dígito de verificación.
export function clean_tax_id(text) {
  return String(text ?? "").replace(/[^\d-]/g, "").slice(0, 20);
}

// El número para wa.me: solo dígitos y con el indicativo de Colombia (57) si no trae uno
export function whatsapp_phone(phone) {
  const text = String(phone ?? "").trim();
  const digits = text.replace(/\D/g, "");
  if (digits === "") return "";
  if (text.startsWith("+") || digits.startsWith("57")) return digits;
  return `57${digits}`;
}

export function normalize_text(text) {
  return String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

export function blank_line(charges_vat) {
  return { description: "", quantity: 1, unit_price: 0, discount_percent: 0, tax_rate: charges_vat ? 19 : 0 };
}

function empty_client() {
  return { name: "", tax_id: "", phone: "", email: "", address: "" };
}

// Un documento nuevo, con su número ya asignado. Devuelve { document, counters }.
export function create_document(kind, { business, counters, today, id, now }) {
  const numbered = next_number(counters, kind, business[`${kind}_prefix`]);
  const days = kind === "quote" ? business.default_validity_days : BILL_DUE_DAYS;
  const document = {
    id,
    kind,
    number: numbered.number,
    status: "draft",
    date: today,
    due_date: add_days(today, days),
    client: empty_client(),
    lines: [blank_line(business.charges_vat)],
    discount_percent: 0,
    withholding_percent: business.default_withholding,
    charges_vat: business.charges_vat,
    notes: "",
    converted_to: null,
    converted_from: null,
    created_at: now,
  };
  return { document, counters: numbered.counters };
}

// Una copia como borrador, con número nuevo y la fecha de hoy
export function duplicate_document(source, { business, counters, today, id, now }) {
  const created = create_document(source.kind, { business, counters, today, id, now });
  return {
    document: {
      ...created.document,
      client: { ...source.client },
      lines: source.lines.map((line) => ({ ...line })),
      discount_percent: source.discount_percent,
      withholding_percent: source.withholding_percent,
      charges_vat: source.charges_vat,
      notes: source.notes,
    },
    counters: created.counters,
  };
}

// La cotización pasa a cuenta de cobro: número propio, fecha de hoy, vencimiento a 30 días, el mismo cliente y los mismos
// renglones. En la cotización queda anotado a cuál se convirtió. Devuelve { bill, quote, counters }.
export function convert_quote_to_bill(quote, { business, counters, today, id, now }) {
  const created = create_document("bill", { business, counters, today, id, now });
  const bill = {
    ...created.document,
    client: { ...quote.client },
    lines: quote.lines.map((line) => ({ ...line })),
    discount_percent: quote.discount_percent,
    withholding_percent: quote.withholding_percent,
    charges_vat: quote.charges_vat,
    notes: quote.notes,
    converted_from: quote.id,
  };
  return { bill, quote: { ...quote, converted_to: id }, counters: created.counters };
}

// Qué falta para poder descargar o enviar un documento: lista de { field, message }. El campo es el id del control al que
// se lleva el foco ("business_name", "client_name", "line_description_2", "line_quantity_0"…).
export function validate_document(document, business) {
  const problems = [];
  if (!business.name.trim()) problems.push({ field: "business_name", message: "Falta el nombre de tu negocio, en Mi negocio." });
  if (!document.client.name.trim()) problems.push({ field: "client_name", message: "Falta el nombre del cliente." });
  if (document.lines.length === 0) problems.push({ field: "add_line_button", message: "Agrega al menos un renglón." });
  document.lines.forEach((line, index) => {
    const number = index + 1;
    if (!line.description.trim()) problems.push({ field: `line_description_${index}`, message: `Al renglón ${number} le falta la descripción.` });
    else if (!(line.quantity > 0)) problems.push({ field: `line_quantity_${index}`, message: `La cantidad del renglón ${number} debe ser mayor que cero.` });
    else if (!(line.unit_price >= 0)) problems.push({ field: `line_price_${index}`, message: `El precio del renglón ${number} no es válido.` });
    else if (line_total(line) > MAX_LINE_TOTAL) problems.push({ field: `line_price_${index}`, message: `El valor del renglón ${number} es demasiado grande.` });
  });
  return problems;
}

// ---------------------------------------------------------------------------
// Limpieza de datos (lo guardado en el navegador o lo que trae un archivo)
// ---------------------------------------------------------------------------

function clean_string(value, max = MAX_TEXT) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function clean_id(value) {
  return typeof value === "string" && value !== "" && value.length <= MAX_ID_LENGTH ? value : null;
}

function clean_amount(value, maximum) {
  return Number.isInteger(value) && value >= 0 && value <= maximum ? value : 0;
}

function clean_percent(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value * 100) / 100 : 0;
}

function clean_date(value, fallback) {
  return is_valid_key(value) ? value : fallback;
}

function clean_logo(value) {
  return typeof value === "string" && value.startsWith(LOGO_PREFIX) && value.length <= MAX_LOGO_LENGTH && /^[A-Za-z0-9+/=]+$/.test(value.slice(LOGO_PREFIX.length)) ? value : "";
}

function clean_prefix(value, fallback) {
  const prefix = typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) : "";
  return prefix === "" ? fallback : prefix;
}

function default_business() {
  return {
    name: "",
    tax_id: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    logo: "",
    charges_vat: false,
    footer_text: "",
    payment_info: "",
    quote_prefix: DEFAULT_PREFIXES.quote,
    bill_prefix: DEFAULT_PREFIXES.bill,
    default_withholding: 0,
    default_validity_days: DEFAULT_VALIDITY_DAYS,
  };
}

function sanitize_business(value) {
  const defaults = default_business();
  const source = value && typeof value === "object" ? value : {};
  const days = source.default_validity_days;
  return {
    name: clean_string(source.name),
    tax_id: clean_tax_id(source.tax_id),
    phone: clean_string(source.phone, 40),
    email: clean_string(source.email, 120),
    address: clean_string(source.address),
    city: clean_string(source.city, 80),
    logo: clean_logo(source.logo),
    charges_vat: source.charges_vat === true,
    footer_text: clean_string(source.footer_text, MAX_NOTES),
    payment_info: clean_string(source.payment_info, MAX_NOTES),
    quote_prefix: clean_prefix(source.quote_prefix, defaults.quote_prefix),
    bill_prefix: clean_prefix(source.bill_prefix, defaults.bill_prefix),
    default_withholding: clean_percent(source.default_withholding),
    default_validity_days: Number.isInteger(days) && days >= 1 && days <= 365 ? days : defaults.default_validity_days,
  };
}

function sanitize_client(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean_id(value.id);
  const name = clean_string(value.name);
  if (!id || !name) return null;
  return { id, name, tax_id: clean_tax_id(value.tax_id), phone: clean_string(value.phone, 40), email: clean_string(value.email, 120), address: clean_string(value.address) };
}

function sanitize_product(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean_id(value.id);
  const name = clean_string(value.name);
  if (!id || !name) return null;
  return { id, name, description: clean_string(value.description), price: clean_amount(value.price, MAX_UNIT_PRICE), tax_rate: TAX_RATES.includes(value.tax_rate) ? value.tax_rate : 0 };
}

function sanitize_line(value) {
  if (!value || typeof value !== "object") return null;
  const description = clean_string(value.description);
  const quantity = typeof value.quantity === "number" && Number.isFinite(value.quantity) && value.quantity > 0 && value.quantity <= MAX_QUANTITY ? Math.round(value.quantity * 100) / 100 : 0;
  if (!description || quantity <= 0) return null;
  const line = { description, quantity, unit_price: clean_amount(value.unit_price, MAX_UNIT_PRICE), discount_percent: clean_percent(value.discount_percent), tax_rate: TAX_RATES.includes(value.tax_rate) ? value.tax_rate : 0 };
  return line_total(line) <= MAX_LINE_TOTAL ? line : null;
}

// Un documento válido o null. Los renglones dañados se descartan; si no queda ninguno bueno, el documento se descarta.
// Con keep_blank_lines (lo guardado desde la pantalla) se conservan también los renglones a medio escribir y un documento
// sin renglones, porque la persona puede estar en medio de armarlo.
function sanitize_document(value, now, keep_blank_lines = false) {
  if (!value || typeof value !== "object") return null;
  const id = clean_id(value.id);
  const number = clean_string(value.number, 20);
  if (!id || !number || !KINDS.includes(value.kind)) return null;
  const lines = Array.isArray(value.lines) ? value.lines.slice(0, MAX_LINES) : [];
  const clean_lines = keep_blank_lines
    ? lines.map((line) => sanitize_line(line) ?? (line && typeof line === "object" ? sanitize_blank_line(line) : null)).filter(Boolean)
    : lines.map(sanitize_line).filter(Boolean);
  if (clean_lines.length === 0 && !keep_blank_lines) return null;
  const date = clean_date(value.date, now.slice(0, 10));
  const client = value.client && typeof value.client === "object" ? value.client : {};
  const status = STATUSES[value.kind].includes(value.status) ? value.status : "draft";
  return {
    id,
    kind: value.kind,
    number,
    status,
    date,
    due_date: clean_date(value.due_date, ""),
    client: { name: clean_string(client.name), tax_id: clean_tax_id(client.tax_id), phone: clean_string(client.phone, 40), email: clean_string(client.email, 120), address: clean_string(client.address) },
    lines: clean_lines,
    discount_percent: clean_percent(value.discount_percent),
    withholding_percent: clean_percent(value.withholding_percent),
    charges_vat: value.charges_vat === true,
    notes: clean_string(value.notes, MAX_NOTES),
    converted_to: clean_id(value.converted_to),
    converted_from: clean_id(value.converted_from),
    created_at: typeof value.created_at === "string" && !Number.isNaN(Date.parse(value.created_at)) ? value.created_at : now,
  };
}

// Un renglón que se está escribiendo (puede estar sin descripción o con cantidad 0): se conserva tal cual, con sus campos
// limpios, para no perder lo que la persona aún no terminó
function sanitize_blank_line(value) {
  return {
    description: clean_string(value.description),
    quantity: typeof value.quantity === "number" && Number.isFinite(value.quantity) && value.quantity >= 0 && value.quantity <= MAX_QUANTITY ? Math.round(value.quantity * 100) / 100 : 1,
    unit_price: clean_amount(value.unit_price, MAX_UNIT_PRICE),
    discount_percent: clean_percent(value.discount_percent),
    tax_rate: TAX_RATES.includes(value.tax_rate) ? value.tax_rate : 0,
  };
}

export function empty_data() {
  return { version: DATA_VERSION, business: default_business(), clients: [], products: [], documents: [], counters: { quote: 1, bill: 1 }, last_export: "" };
}

function clean_counter(value) {
  return Number.isInteger(value) && value >= 1 && value <= 99999999 ? value : 1;
}

function keep_unique_ids(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

// Limpia todo lo guardado: devuelve los datos válidos y cuántas cosas se descartaron. Los documentos de la pantalla
// (keep_blank_lines) conservan sus renglones a medio escribir.
export function sanitize_data(value, now, keep_blank_lines = false) {
  const source = value && typeof value === "object" ? value : {};
  const take = (list, clean, ...extra) => (Array.isArray(list) ? list.slice(0, MAX_ITEMS).map((item) => clean(item, ...extra)) : []);
  const clients = take(source.clients, sanitize_client);
  const products = take(source.products, sanitize_product);
  const documents = take(source.documents, sanitize_document, now, keep_blank_lines);
  const kept_clients = keep_unique_ids(clients.filter(Boolean));
  const kept_products = keep_unique_ids(products.filter(Boolean));
  const kept_documents = keep_unique_ids(documents.filter(Boolean));
  const business = sanitize_business(source.business);
  const counters = { quote: clean_counter(source.counters?.quote), bill: clean_counter(source.counters?.bill) };
  // Un contador nunca queda por debajo del mayor número ya usado: así no se repite un número aunque el archivo venga alterado
  KINDS.forEach((kind) => (counters[kind] = Math.max(counters[kind], min_counter(kept_documents, kind, business[`${kind}_prefix`]))));
  return {
    data: {
      version: DATA_VERSION,
      business,
      clients: kept_clients,
      products: kept_products,
      documents: kept_documents,
      counters,
      last_export: is_valid_key(source.last_export) ? source.last_export : "",
    },
    discarded: {
      clients: (Array.isArray(source.clients) ? source.clients.length : 0) - kept_clients.length,
      products: (Array.isArray(source.products) ? source.products.length : 0) - kept_products.length,
      documents: (Array.isArray(source.documents) ? source.documents.length : 0) - kept_documents.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Respaldo
// ---------------------------------------------------------------------------

export function export_backup(data, exported_at) {
  return JSON.stringify({ app: BACKUP_APP, version: DATA_VERSION, exported_at, business: data.business, clients: data.clients, products: data.products, documents: data.documents, counters: data.counters }, null, 2);
}

// Lee un archivo de respaldo. Devuelve { data, discarded } o { error } con el motivo en palabras.
export function parse_backup(text, now) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "Este archivo no es un JSON válido." };
  }
  if (!parsed || typeof parsed !== "object" || parsed.app !== BACKUP_APP) return { error: "Este archivo no es un respaldo de Cotizaciones y cuentas de cobro." };
  if (parsed.version !== DATA_VERSION) return { error: "Este respaldo es de otra versión de la página." };
  if (!Array.isArray(parsed.clients) || !Array.isArray(parsed.products) || !Array.isArray(parsed.documents)) return { error: "El respaldo está incompleto: faltan las listas de clientes, productos o documentos." };
  const result = sanitize_data(parsed, now);
  return { data: { ...result.data, last_export: "" }, discarded: result.discarded };
}

// ---------------------------------------------------------------------------
// Lista, búsqueda y resumen
// ---------------------------------------------------------------------------

// Los documentos del más nuevo al más viejo (por fecha y, a igual fecha, por creación)
export function sort_documents(documents) {
  return [...documents].sort((first, second) => {
    if (first.date !== second.date) return first.date < second.date ? 1 : -1;
    if (first.created_at !== second.created_at) return first.created_at < second.created_at ? 1 : -1;
    return first.number < second.number ? 1 : -1;
  });
}

// Filtra por tipo ("all", "quote", "bill"), estado ("all" o uno, incluido "expired") y búsqueda por número o cliente
export function filter_documents(documents, { kind, status, query }, today) {
  const normalized_query = normalize_text(query);
  return documents.filter((document) => {
    if (kind !== "all" && document.kind !== kind) return false;
    if (status !== "all" && effective_status(document, today) !== status) return false;
    if (normalized_query === "") return true;
    return normalize_text(`${document.number} ${document.client.name}`).includes(normalized_query);
  });
}

// Cifras de un mes "AAAA-MM": cotizaciones hechas (no borradores) y aceptadas, cuentas de cobro emitidas (no borradores) y
// pagadas, todo por la fecha del documento. Cada cifra: { count, value }.
export function monthly_summary(documents, month_key) {
  const in_month = documents.filter((document) => month_of(document.date) === month_key);
  const sum = (list) => ({ count: list.length, value: list.reduce((accumulated, document) => accumulated + document_total(document), 0) });
  const quotes = in_month.filter((document) => document.kind === "quote" && document.status !== "draft");
  const bills = in_month.filter((document) => document.kind === "bill" && document.status !== "draft");
  return {
    quoted: sum(quotes),
    accepted: sum(quotes.filter((document) => document.status === "accepted")),
    billed: sum(bills),
    paid: sum(bills.filter((document) => document.status === "paid")),
  };
}

// Las cuentas de cobro enviadas y sin pagar, con las vencidas primero y luego por fecha de vencimiento
export function pending_bills(documents, today) {
  return documents
    .filter((document) => document.kind === "bill" && document.status === "sent")
    .map((document) => ({ document, expired: Boolean(document.due_date) && document.due_date < today, total: document_total(document) }))
    .sort((first, second) => {
      if (first.expired !== second.expired) return first.expired ? -1 : 1;
      return (first.document.due_date || "9999-12-31") < (second.document.due_date || "9999-12-31") ? -1 : 1;
    });
}

// Lo cotizado y lo cobrado en los últimos `months` meses, terminando en month_key: [{ month, quoted, collected }]
export function monthly_series(documents, month_key, months) {
  return Array.from({ length: months }, (_, offset) => {
    const month = shift_month(month_key, offset - (months - 1));
    const summary = monthly_summary(documents, month);
    return { month, quoted: summary.quoted.value, collected: summary.paid.value };
  });
}

// El recordatorio de respaldo: hay más de 20 documentos y no se ha exportado en 30 días (o nunca)
export function needs_backup_reminder(data, today) {
  if (data.documents.length <= 20) return false;
  return !data.last_export || data.last_export < add_days(today, -30);
}
