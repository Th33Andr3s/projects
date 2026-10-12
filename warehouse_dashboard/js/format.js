// Cómo se escriben los números, las horas y los tiempos en pantalla. Funciones puras, sin tocar la página.

const number_formatter = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 });

const datetime_formatter = new Intl.DateTimeFormat("es-CO", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });

// La fecha y hora de un momento de la simulación: `start_ms` es el instante (en milisegundos UTC, con la hora como si fuera
// local) en que arranca el reloj simulado, y `seconds` lo que ha pasado desde entonces. Resultado: "lun, 12 oct 2026, 06:35".
export function format_sim_datetime(start_ms, seconds) {
  return datetime_formatter.format(new Date(start_ms + seconds * 1000));
}

// El reloj simulado junto al día: "06:00 · Día 1"
export function format_clock_display(clock_text, day) {
  return `${clock_text} · Día ${day}`;
}

export function format_fps(fps) {
  return `${Math.round(fps)} FPS`;
}

// Un número con puntos de miles y coma decimal, como en Colombia: 1250 → "1.250"; 0,6 → "0,6"
export function format_number(value) {
  return number_formatter.format(value);
}

// Dinero en pesos colombianos, exacto: 1250000 → "$ 1.250.000"
export function format_currency(value) {
  return `$ ${format_number(Math.round(value))}`;
}

// Dinero para las tarjetas, más corto: "$ 850.000", "$ 12,4 millones" y "$ 3,2 mil millones" (mil millones = 10^9)
export function format_currency_compact(value) {
  const amount = Math.round(value);
  if (Math.abs(amount) < 1e6) return `$ ${format_number(amount)}`;
  if (Math.abs(amount) < 1e9) return `$ ${format_number(Math.round(amount / 1e5) / 10)} millones`;
  return `$ ${format_number(Math.round(amount / 1e8) / 10)} mil millones`;
}

export function format_percent(value) {
  return value === null || value === undefined ? "—" : `${Math.round(value)} %`;
}

// Segundos simulados como "mm:ss", o "h:mm:ss" si pasan de una hora; null se escribe como raya
export function format_duration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pair = (value) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pair(minutes)}:${pair(rest)}` : `${pair(minutes)}:${pair(rest)}`;
}

// El valor de un parámetro con su unidad: "0,6 m/s", "540 s", "30 %"
export function format_parameter_value(parameter, value) {
  const text = format_number(value);
  if (!parameter.unit) return text;
  return parameter.unit === "%" ? `${text} %` : `${text} ${parameter.unit}`;
}

// Para buscar sin que importen las tildes ni las mayúsculas
export function normalize_search_text(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
