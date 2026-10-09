// Reglas de fechas del calendario: cuadrícula del mes, festivos de Colombia y formato en español. Son funciones
// puras: reciben y devuelven texto o números, sin tocar la pantalla, para poder probarlas con valores conocidos
// (ver PLAN.md, sección 4.4).
//
// Toda fecha se maneja como texto "AAAA-MM-DD" en la zona horaria del equipo. Cuando hace falta un objeto Date se
// construye con año, mes y día por separado (hora local) y a mediodía, nunca con new Date("AAAA-MM-DD"), que lo
// interpretaría en UTC y haría que un evento del 12 apareciera el 11.

const NBSP = " ";
const DAYS_PER_WEEK = 7;
const GRID_WEEKS = 6;
const NOON = 12;

// Primer día de la semana: 0 = domingo, 1 = lunes. Cambiar este número basta para empezar la semana en domingo.
const WEEK_STARTS_ON = 1;

// Índice 0 = domingo, como en Date.getDay()
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// Festivos de Colombia (Ley 51 de 1983). Cada línea es [mes, día, nombre]. Si cambia la ley, se cambia aquí.
const FIXED_HOLIDAYS = [
  [1, 1, "Año Nuevo"],
  [5, 1, "Día del Trabajo"],
  [7, 20, "Día de la Independencia"],
  [8, 7, "Batalla de Boyacá"],
  [12, 8, "Inmaculada Concepción"],
  [12, 25, "Navidad"],
];

// Estos se pasan al lunes siguiente si no caen en lunes
const MOVED_TO_MONDAY_HOLIDAYS = [
  [1, 6, "Día de los Reyes Magos"],
  [3, 19, "Día de San José"],
  [6, 29, "San Pedro y San Pablo"],
  [8, 15, "La Asunción de la Virgen"],
  [10, 12, "Día de la Raza"],
  [11, 1, "Todos los Santos"],
  [11, 11, "Independencia de Cartagena"],
];

// Días antes (−) o después (+) del domingo de Pascua. La Ascensión, Corpus Christi y el Sagrado Corazón ya quedan
// en lunes con estos desplazamientos (son jueves o viernes pasados al lunes siguiente).
const EASTER_HOLIDAYS = [
  [-3, "Jueves Santo"],
  [-2, "Viernes Santo"],
  [43, "Ascensión del Señor"],
  [64, "Corpus Christi"],
  [71, "Sagrado Corazón de Jesús"],
];

// ---------------------------------------------------------------------------
// Fechas como texto
// ---------------------------------------------------------------------------

function pad(number, length = 2) {
  return String(number).padStart(length, "0");
}

// month va de 1 a 12
function format_iso(year, month, day) {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

function days_in_month(year, month) {
  return new Date(year, month, 0).getDate();
}

// Devuelve { year, month, day } o null si el texto no es una fecha real (el 30 de febrero, por ejemplo)
export function parse_iso(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > days_in_month(year, month)) return null;
  return { year, month, day };
}

function to_date(iso) {
  const { year, month, day } = parse_iso(iso);
  // A mediodía, para que un cambio de hora no mueva la fecha
  return new Date(year, month - 1, day, NOON);
}

function date_to_iso(date) {
  return format_iso(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function add_days(iso, days) {
  const date = to_date(iso);
  date.setDate(date.getDate() + days);
  return date_to_iso(date);
}

// Cuántos días hay de una fecha a otra (negativo si la segunda es anterior)
export function days_between(from_iso, to_iso) {
  return Math.round((to_date(to_iso) - to_date(from_iso)) / 86_400_000);
}

export function today_iso() {
  return date_to_iso(new Date());
}

// 0 = domingo … 6 = sábado
function day_of_week(iso) {
  return to_date(iso).getDay();
}

// Posición del día dentro de su semana (0 = primer día de la semana, según WEEK_STARTS_ON)
export function weekday_position(iso) {
  return (day_of_week(iso) - WEEK_STARTS_ON + DAYS_PER_WEEK) % DAYS_PER_WEEK;
}

// Mueve una fecha a otro mes conservando el día; si ese mes no tiene el día, queda en su último día
export function shift_month(iso, months) {
  const { year, month, day } = parse_iso(iso);
  const target_index = year * 12 + (month - 1) + months;
  const target_year = Math.floor(target_index / 12);
  const target_month = (target_index % 12) + 1;
  return format_iso(target_year, target_month, Math.min(day, days_in_month(target_year, target_month)));
}

// ---------------------------------------------------------------------------
// Cuadrícula del mes
// ---------------------------------------------------------------------------

// 42 días (seis semanas) que contienen el mes. Los que no son del mes quedan marcados con is_outside.
export function build_month_grid(year, month) {
  const first_day = format_iso(year, month, 1);
  const grid_start = add_days(first_day, -weekday_position(first_day));
  return Array.from({ length: DAYS_PER_WEEK * GRID_WEEKS }, (_, index) => {
    const iso = add_days(grid_start, index);
    const parsed = parse_iso(iso);
    return { iso, day: parsed.day, is_outside: parsed.month !== month };
  });
}

// Letras de los encabezados y nombres completos de los días, empezando por el primer día de la semana
export function get_weekday_headers() {
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) => {
    const name = capitalize(DAY_NAMES[(WEEK_STARTS_ON + index) % DAYS_PER_WEEK]);
    return { letter: name[0], name };
  });
}

// ---------------------------------------------------------------------------
// Festivos de Colombia
// ---------------------------------------------------------------------------

// Domingo de Pascua (algoritmo de Meeus, Jones y Butcher para el calendario gregoriano)
function easter_sunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return format_iso(year, month, day);
}

// Si la fecha no cae en lunes, pasa al lunes siguiente
function next_monday(iso) {
  const days_until_monday = (1 - day_of_week(iso) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return add_days(iso, days_until_monday);
}

const holidays_cache = new Map();

// Los festivos de un año como { "AAAA-MM-DD": nombre }. Si dos festivos caen el mismo día (pasa en algunos años),
// los nombres se unen en uno solo.
function get_holidays(year) {
  if (holidays_cache.has(year)) return holidays_cache.get(year);

  const holidays = {};
  const add = (iso, name) => {
    holidays[iso] = holidays[iso] ? `${holidays[iso]} y ${name}` : name;
  };
  FIXED_HOLIDAYS.forEach(([month, day, name]) => add(format_iso(year, month, day), name));
  MOVED_TO_MONDAY_HOLIDAYS.forEach(([month, day, name]) => add(next_monday(format_iso(year, month, day)), name));
  const easter = easter_sunday(year);
  EASTER_HOLIDAYS.forEach(([offset, name]) => add(add_days(easter, offset), name));

  holidays_cache.set(year, holidays);
  return holidays;
}

// Nombre del festivo de una fecha, o "" si no es festivo
export function get_holiday_name(iso) {
  return get_holidays(parse_iso(iso).year)[iso] || "";
}

// Festivos entre dos fechas (ambas incluidas), en orden: [{ iso, name }]
export function get_holidays_between(from_iso, to_iso) {
  const years = [];
  for (let year = parse_iso(from_iso).year; year <= parse_iso(to_iso).year; year += 1) years.push(year);
  return years
    .flatMap((year) => Object.entries(get_holidays(year)).map(([iso, name]) => ({ iso, name })))
    .filter(({ iso }) => iso >= from_iso && iso <= to_iso)
    .sort((first, second) => (first.iso < second.iso ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Formato en español
// ---------------------------------------------------------------------------

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// "Lunes 12 de octubre de 2026"
export function format_long_date(iso) {
  const { year, month, day } = parse_iso(iso);
  return `${capitalize(DAY_NAMES[day_of_week(iso)])} ${day} de ${MONTH_NAMES[month - 1]} de ${year}`;
}

// "Lunes 12 de octubre", sin el año
function format_short_date(iso) {
  const { month, day } = parse_iso(iso);
  return `${capitalize(DAY_NAMES[day_of_week(iso)])} ${day} de ${MONTH_NAMES[month - 1]}`;
}

// "Octubre de 2026"
export function format_month_title(year, month) {
  return `${capitalize(MONTH_NAMES[month - 1])} de ${year}`;
}

// "Hoy", "Mañana" o la fecha sin el año (la que se usa en la lista de próximos)
export function describe_day(iso, current_iso) {
  const distance = days_between(current_iso, iso);
  if (distance === 0) return "Hoy";
  if (distance === 1) return "Mañana";
  return format_short_date(iso);
}

// "HH:MM" válido (de 00:00 a 23:59), o null
export function parse_time(text) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(text));
  if (!match) return null;
  const [hours, minutes] = match.slice(1).map(Number);
  return hours < 24 && minutes < 60 ? { hours, minutes } : null;
}

// "15:30" → "3:30 p. m." (con espacios que no se parten, para que "p. m." no quede en dos renglones)
function format_time(text) {
  const { hours, minutes } = parse_time(text);
  const suffix = hours < NOON ? `a.${NBSP}m.` : `p.${NBSP}m.`;
  return `${hours % NOON || NOON}:${pad(minutes)}${NBSP}${suffix}`;
}

// "8:00 a. m. – 9:30 a. m.", "3:30 p. m." (solo inicio) o "Todo el día"
export function format_time_range(start, end) {
  if (!start) return "Todo el día";
  return end ? `${format_time(start)} – ${format_time(end)}` : format_time(start);
}
