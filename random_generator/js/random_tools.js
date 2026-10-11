// Azar justo: funciones puras que reciben la fuente de azar como parámetro (una función random_below(limit) que devuelve
// un entero entre 0 y limit − 1), para probarlas con una fuente fija y para que main.js les pase la de crypto.

const MIN_NUMBER = -1000000000;
const MAX_NUMBER = 1000000000;
const MAX_COUNT = 1000;
// Hasta este tamaño de rango, "sin repetir" se resuelve mezclando el rango entero, que nunca se queda dando vueltas;
// con rangos más grandes la cantidad (máximo 1.000) es siempre menos de la mitad del rango y basta sacar y descartar
const MAX_SHUFFLED_RANGE = 2000;
const UINT32_RANGE = 2 ** 32;
const COIN_SIDES = ["Cara", "Sello"];

// La fuente de azar del sistema (crypto.getRandomValues). Cada número se saca por rechazo: se descartan los valores
// del "sobrante" que harían que unos salieran más que otros, así todos tienen exactamente la misma probabilidad.
// Lanza un error si el navegador no tiene crypto: no se cae a Math.random sin decirlo.
export function create_random_source(crypto_source) {
  if (!crypto_source || typeof crypto_source.getRandomValues !== "function") {
    throw new Error("No hay generador de azar seguro");
  }
  const buffer = new Uint32Array(1);
  return function random_below(limit) {
    const accepted_below = UINT32_RANGE - (UINT32_RANGE % limit);
    let value;
    do {
      crypto_source.getRandomValues(buffer);
      value = buffer[0];
    } while (value >= accepted_below);
    return value % limit;
  };
}

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

function format_integer(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Revisa las opciones de Números antes de sortear. Si el mínimo es mayor que el máximo, se intercambian solos.
// Devuelve { error, minimum, maximum }; error es null si todo está bien.
export function validate_numbers({ minimum, maximum, count, unique }) {
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum)) {
    return { error: "El mínimo y el máximo deben ser números enteros." };
  }
  if (minimum < MIN_NUMBER || maximum > MAX_NUMBER || maximum < MIN_NUMBER || minimum > MAX_NUMBER) {
    return { error: `Los números deben estar entre −${format_integer(-MIN_NUMBER)} y ${format_integer(MAX_NUMBER)}.` };
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    return { error: `La cantidad debe estar entre 1 y ${format_integer(MAX_COUNT)}.` };
  }
  const low = Math.min(minimum, maximum);
  const high = Math.max(minimum, maximum);
  const range_size = high - low + 1;
  if (unique && count > range_size) {
    return { error: `Sin repetir, en ese rango solo hay ${format_integer(range_size)} ${range_size === 1 ? "número" : "números"}: pide ${format_integer(range_size)} o menos, o desmarca «Sin repetir».` };
  }
  return { error: null, minimum: low, maximum: high };
}

// Mezcla de Fisher-Yates: desde el final, cada elemento se intercambia con uno al azar entre los que quedan, lo que da
// todas las permutaciones con la misma probabilidad. Devuelve una lista nueva.
export function shuffle(items, random_below) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = random_below(index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

// Números enteros al azar entre minimum y maximum, ya validados (ver validate_numbers)
export function random_integers(minimum, maximum, count, { unique, sorted }, random_below) {
  const range_size = maximum - minimum + 1;
  let values;
  if (!unique) {
    values = Array.from({ length: count }, () => minimum + random_below(range_size));
  } else if (range_size <= MAX_SHUFFLED_RANGE) {
    const range = Array.from({ length: range_size }, (_, offset) => minimum + offset);
    values = shuffle(range, random_below).slice(0, count);
  } else {
    const seen = new Set();
    while (seen.size < count) seen.add(minimum + random_below(range_size));
    values = [...seen];
  }
  return sorted ? values.sort((first, second) => first - second) : values;
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

// Un elemento por línea; si no hay ningún salto de línea, también se separa por comas o puntos y coma. Los espacios de los
// bordes y las líneas vacías se ignoran; los repetidos se conservan.
export function parse_list(text) {
  const normalized = text.replace(/\r\n?/g, "\n");
  const parts = normalized.includes("\n") ? normalized.split("\n") : normalized.split(/[,;]/);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

// Elige `count` elementos distintos de la lista, en el orden en que salieron
export function pick_items(items, count, random_below) {
  return shuffle(items, random_below).slice(0, count);
}

// Reparte la lista en equipos: se mezcla y se reparte en orden, así los tamaños difieren a lo sumo en uno
export function split_into_teams(items, team_count, random_below) {
  const teams = Array.from({ length: team_count }, () => []);
  shuffle(items, random_below).forEach((item, index) => teams[index % team_count].push(item));
  return teams;
}

// ---------------------------------------------------------------------------
// Dados y moneda
// ---------------------------------------------------------------------------

export function roll_dice(count, faces, random_below) {
  const values = Array.from({ length: count }, () => 1 + random_below(faces));
  return { values, sum: values.reduce((total, value) => total + value, 0) };
}

export function flip_coins(count, random_below) {
  return Array.from({ length: count }, () => COIN_SIDES[random_below(2)]);
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

// El resultado como texto: lo que se copia y, con los saltos de línea cambiados por " / ", lo que va al historial.
// result es { kind, ... } con kind "numbers", "pick", "shuffle", "teams", "dice" o "coins".
export function format_result(result) {
  switch (result.kind) {
    case "numbers":
    case "pick":
    case "coins":
      return result.values.join(", ");
    case "shuffle":
      return result.values.map((value, index) => `${index + 1}. ${value}`).join("\n");
    case "teams":
      return result.teams.map((team, index) => `Equipo ${index + 1}: ${team.join(", ")}`).join("\n");
    case "dice":
      return result.values.length === 1 ? String(result.values[0]) : `${result.values.join(" + ")} = ${result.sum}`;
    default:
      return "";
  }
}
