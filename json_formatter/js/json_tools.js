// Análisis y escritura de JSON: un analizador propio que conserva el texto original de cada valor, un escritor que solo
// cambia los espacios, y las estadísticas. Son funciones puras: reciben texto y devuelven texto o números, sin tocar la
// pantalla, para poder probarlas con valores conocidos (ver PLAN.md, sección 4.4).
//
// Por qué no se usa JSON.parse: un formateador no debe cambiar nada del contenido, y JSON.parse pierde cifras en los
// números grandes (12345678901234567890), reordena las claves que parecen números ("2" y "1" pasan a "1" y "2"),
// normaliza los escapes de los textos y da mensajes de error distintos en cada navegador, sin línea ni columna.
// Aquí cada número y cada texto se guarda tal como se escribió.
//
// Se acepta JSON estricto (RFC 8259): comillas dobles, sin comas finales, sin comentarios, sin NaN ni Infinity.

const BYTE_ORDER_MARK = 0xfeff;
// Hasta cuántos niveles de objetos o arreglos se aceptan, para no agotar la pila con un texto malicioso
const MAX_DEPTH = 1000;
const FIRST_PRINTABLE_CODE = 0x20;
const HEX_DIGITS_IN_UNICODE_ESCAPE = 4;
const SIMPLE_ESCAPES = '"\\/bfnrt';
const BYTES_PER_KILOBYTE = 1024;
const BYTE_UNITS = ["B", "KB", "MB", "GB"];
const LITERAL_WORDS = new Set(["true", "false", "null"]);

// Un error de sintaxis lleva la posición (número de carácter, desde 0) donde se detectó
class JsonSyntaxError extends Error {
  constructor(message, offset) {
    super(message);
    this.offset = offset;
  }
}

function is_digit(character) {
  return character >= "0" && character <= "9";
}

function is_letter(character) {
  return (character >= "a" && character <= "z") || (character >= "A" && character <= "Z");
}

// Línea y columna (desde 1, contando caracteres y no unidades UTF-16) de una posición del texto. Un salto de línea
// puede ser \n, \r\n o \r.
function locate(text, offset) {
  let line = 1;
  let line_start = 0;
  for (let index = 0; index < offset; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 10 || code === 13) {
      if (code === 13 && text.charCodeAt(index + 1) === 10) index += 1;
      line += 1;
      line_start = index + 1;
    }
  }
  return { line, column: Array.from(text.slice(line_start, offset)).length + 1 };
}

// Devuelve { tree } si el texto es JSON válido, { error: { message, line, column, offset } } si no, o { empty: true }
// si no hay nada escrito (vacío o solo espacios, que no es un error).
export function parse_json(text) {
  const length = text.length;
  let position = text.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0;

  function fail(message, at = position) {
    throw new JsonSyntaxError(message, at);
  }

  function skip_whitespace() {
    while (position < length) {
      const character = text[position];
      if (character !== " " && character !== "\t" && character !== "\n" && character !== "\r") return;
      position += 1;
    }
  }

  // Lee un texto entre comillas y devuelve su texto original, comillas incluidas
  function read_string() {
    const start = position;
    position += 1;
    while (position < length) {
      const character = text[position];
      if (character === '"') {
        position += 1;
        return text.slice(start, position);
      }
      if (character === "\\") {
        const next = text[position + 1];
        if (next === undefined) break;
        if (SIMPLE_ESCAPES.includes(next)) {
          position += 2;
          continue;
        }
        const hex = text.slice(position + 2, position + 2 + HEX_DIGITS_IN_UNICODE_ESCAPE);
        if (next !== "u" || !/^[0-9a-fA-F]{4}$/.test(hex)) fail("Escape no válido");
        position += 2 + HEX_DIGITS_IN_UNICODE_ESCAPE;
        continue;
      }
      if (text.charCodeAt(position) < FIRST_PRINTABLE_CODE) {
        if (character === "\n" || character === "\r") fail("Un texto no puede tener saltos de línea; escribe \\n en su lugar");
        fail("Carácter no permitido dentro del texto");
      }
      position += 1;
    }
    return fail("Falta cerrar el texto con comillas", start);
  }

  function skip_digits() {
    while (position < length && is_digit(text[position])) position += 1;
  }

  function read_number() {
    const start = position;
    if (text[position] === "-") position += 1;
    if (!is_digit(text[position] ?? "")) fail("Número no válido", start);
    if (text[position] === "0") {
      position += 1;
      if (is_digit(text[position] ?? "")) fail("Los números no pueden empezar por 0", start);
    } else {
      skip_digits();
    }
    if (text[position] === ".") {
      position += 1;
      if (!is_digit(text[position] ?? "")) fail("Faltan dígitos después del punto");
      skip_digits();
    }
    if (text[position] === "e" || text[position] === "E") {
      position += 1;
      if (text[position] === "+" || text[position] === "-") position += 1;
      if (!is_digit(text[position] ?? "")) fail("Faltan dígitos en el exponente");
      skip_digits();
    }
    return { type: "literal", text: text.slice(start, position) };
  }

  // true, false y null; cualquier otra palabra (undefined, True, NaN…) no es un valor
  function read_word() {
    const start = position;
    while (position < length && is_letter(text[position])) position += 1;
    const word = text.slice(start, position);
    if (!LITERAL_WORDS.has(word)) fail("Se esperaba un valor", start);
    return { type: "literal", text: word };
  }

  // Un objeto o arreglo a la profundidad dada es el nivel número depth + 1
  function check_depth(depth) {
    if (depth >= MAX_DEPTH) fail(`El JSON tiene demasiados niveles de anidación (el máximo es ${MAX_DEPTH})`);
  }

  function read_object(depth) {
    check_depth(depth);
    position += 1;
    const pairs = [];
    skip_whitespace();
    if (position >= length) fail("Falta cerrar el objeto con }");
    if (text[position] === "}") {
      position += 1;
      return { type: "object", pairs };
    }
    for (;;) {
      skip_whitespace();
      const character = text[position];
      if (character === "}") fail("Sobra una coma antes de }");
      if (character === "'") fail("Las comillas deben ser dobles");
      if (character !== '"') fail("Se esperaba una clave entre comillas dobles");
      const key = read_string();
      skip_whitespace();
      if (text[position] !== ":") fail("Faltan los dos puntos después de la clave");
      position += 1;
      pairs.push({ key, value: read_value(depth + 1) });

      skip_whitespace();
      if (position >= length) fail("Falta cerrar el objeto con }");
      const next = text[position];
      position += next === "," || next === "}" ? 1 : 0;
      if (next === "}") return { type: "object", pairs };
      if (next === ",") continue;
      if (next === '"' || next === "'") fail("Falta una coma entre las propiedades");
      if (next === "]") fail("Se esperaba } pero hay ]");
      fail("Se esperaba una coma o }");
    }
  }

  function read_array(depth) {
    check_depth(depth);
    position += 1;
    const items = [];
    skip_whitespace();
    if (position >= length) fail("Falta cerrar el arreglo con ]");
    if (text[position] === "]") {
      position += 1;
      return { type: "array", items };
    }
    for (;;) {
      skip_whitespace();
      if (text[position] === "]") fail("Sobra una coma antes de ]");
      items.push(read_value(depth + 1));

      skip_whitespace();
      if (position >= length) fail("Falta cerrar el arreglo con ]");
      const next = text[position];
      position += next === "," || next === "]" ? 1 : 0;
      if (next === "]") return { type: "array", items };
      if (next === ",") continue;
      if (next === "}") fail("Se esperaba ] pero hay }");
      // Si lo que sigue podría ser otro elemento, lo que falta es la coma
      if (next === '"' || next === "'" || next === "{" || next === "[" || next === "-" || is_digit(next) || is_letter(next)) {
        fail("Falta una coma entre los elementos");
      }
      fail("Se esperaba una coma o ]");
    }
  }

  function read_value(depth) {
    skip_whitespace();
    if (position >= length) fail("Se esperaba un valor");
    const character = text[position];
    if (character === "{") return read_object(depth);
    if (character === "[") return read_array(depth);
    if (character === '"') return { type: "literal", text: read_string() };
    if (character === "'") fail("Las comillas deben ser dobles");
    if (character === "-" || is_digit(character)) return read_number();
    if (character === "+" || character === ".") fail("Número no válido");
    if (is_letter(character)) return read_word();
    return fail("Se esperaba un valor");
  }

  try {
    skip_whitespace();
    if (position >= length) return { empty: true };
    const tree = read_value(0);
    skip_whitespace();
    if (position < length) fail("Hay texto después del final del JSON");
    return { tree };
  } catch (error) {
    if (!(error instanceof JsonSyntaxError)) throw error;
    return { error: { message: error.message, offset: error.offset, ...locate(text, error.offset) } };
  }
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

// El texto de una clave ya sin comillas ni escapes ("é" → "é"), solo para ordenar
function decode_key(raw_key) {
  return JSON.parse(raw_key);
}

// Escribe el árbol. mode es "format" (una clave o elemento por línea) o "minify" (todo en una línea); indent es lo que
// se repite por cada nivel ("  ", "    " o "\t"); sort_keys ordena las claves de todos los objetos (los arreglos
// nunca se reordenan). Solo cambia los espacios: cada número y cada texto sale como entró.
export function write_json(tree, { mode, indent, sort_keys }) {
  const is_minified = mode === "minify";

  function sorted(pairs) {
    if (!sort_keys) return pairs;
    // sort es estable: las claves repetidas conservan su orden
    return pairs
      .map((pair) => ({ pair, name: decode_key(pair.key) }))
      .sort((first, second) => first.name.localeCompare(second.name, "es"))
      .map(({ pair }) => pair);
  }

  function write(node, level) {
    if (node.type === "literal") return node.text;
    const entries = node.type === "array" ? node.items.map((item) => write(item, level + 1)) : sorted(node.pairs).map(({ key, value }) => `${key}${is_minified ? ":" : ": "}${write(value, level + 1)}`);
    const [open, close] = node.type === "array" ? ["[", "]"] : ["{", "}"];
    if (entries.length === 0) return open + close;
    if (is_minified) return `${open}${entries.join(",")}${close}`;
    const inner = indent.repeat(level + 1);
    return `${open}\n${entries.map((entry) => inner + entry).join(",\n")}\n${indent.repeat(level)}${close}`;
  }

  return write(tree, 0);
}

// ---------------------------------------------------------------------------
// Estadísticas y formato de números
// ---------------------------------------------------------------------------

// Claves (pares de todos los objetos), elementos (valores de todos los arreglos) y profundidad (un valor suelto es 0;
// {"a":[1]} es 2)
export function compute_stats(tree) {
  const stats = { keys: 0, items: 0, depth: 0 };
  function visit(node, level) {
    if (node.type === "literal") return;
    stats.depth = Math.max(stats.depth, level + 1);
    if (node.type === "array") {
      stats.items += node.items.length;
      node.items.forEach((item) => visit(item, level + 1));
    } else {
      stats.keys += node.pairs.length;
      node.pairs.forEach(({ value }) => visit(value, level + 1));
    }
  }
  visit(tree, 0);
  return stats;
}

// Tamaño del texto en bytes UTF-8
export function byte_length(text) {
  return new TextEncoder().encode(text).length;
}

// Puntos para los miles, como en Colombia: 1250 → "1.250". Se arma a mano para no depender del idioma del navegador.
export function format_count(count) {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// "850 B", "1,2 KB", "3,4 MB"
export function format_size(bytes) {
  let value = bytes;
  let unit_index = 0;
  while (value >= BYTES_PER_KILOBYTE && unit_index < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_KILOBYTE;
    unit_index += 1;
  }
  if (unit_index === 0) return `${bytes} ${BYTE_UNITS[0]}`;
  return `${value.toFixed(1).replace(".", ",")} ${BYTE_UNITS[unit_index]}`;
}
