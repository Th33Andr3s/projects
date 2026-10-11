// Codificador de códigos QR (modelo 2, ISO/IEC 18004), escrito a mano: CLAUDE.md 2.2 no permite librerías extra.
// Son funciones puras que no tocan la pantalla, para poder probarlas con valores conocidos.
//
// Recorrido: texto -> modo (numérico, alfanumérico o bytes) -> versión más chica que alcance -> palabras de datos
// -> bloques con corrección Reed-Solomon -> matriz con patrones fijos -> mejor de las 8 máscaras -> matriz final.
// La salida es una matriz de booleanos: true = módulo negro.
//
// Al final del archivo están los constructores de contenido (Wi-Fi, contacto y WhatsApp): arman el texto que
// luego se codifica igual que cualquier otro.

export const ERROR_LEVELS = ["L", "M", "Q", "H"];

const MIN_VERSION = 1;
const MAX_VERSION = 40;

// Índice de cada nivel en las tablas de abajo
const LEVEL_INDEX = { L: 0, M: 1, Q: 2, H: 3 };
// Los dos bits del nivel dentro de la información de formato (no siguen el orden L, M, Q, H)
const FORMAT_LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

// Palabras de corrección por bloque, por nivel y versión (el índice 0 de cada fila no se usa)
const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

// Cantidad de bloques de corrección, por nivel y versión
const BLOCK_COUNTS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

// Los 45 caracteres del modo alfanumérico: el valor de cada uno es su posición
const ALPHANUMERIC_CHARACTERS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

const MODE_NUMERIC = "numeric";
const MODE_ALPHANUMERIC = "alphanumeric";
const MODE_BYTE = "byte";
const MODE_INDICATORS = { [MODE_NUMERIC]: 0b0001, [MODE_ALPHANUMERIC]: 0b0010, [MODE_BYTE]: 0b0100 };

// Palabras de relleno que se alternan hasta llenar los datos
const PAD_BYTES = [0xec, 0x11];

// Penalizaciones de las cuatro reglas de la máscara
const PENALTY_RUN = 3;
const PENALTY_BLOCK = 3;
const PENALTY_FINDER_LIKE = 40;
const PENALTY_BALANCE = 10;
const MIN_RUN_LENGTH = 5;
// Patrón parecido al de búsqueda (1:1:3:1:1) con cuatro módulos claros a un lado, en los dos sentidos
const FINDER_LIKE_PATTERNS = [
  [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
];

// Error propio del codificador: `code` dice qué pasó para que la pantalla elija el aviso.
//   empty: no hay nada que codificar · too_long: no cabe · invalid_input: un campo no sirve
export class QrError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "QrError";
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Modo, versión y capacidad
// ---------------------------------------------------------------------------

export function utf8_bytes(text) {
  return Array.from(new TextEncoder().encode(text));
}

// El modo más compacto en el que cabe todo el texto. Sin ECI: los lectores actuales asumen UTF-8.
export function detect_mode(text) {
  if (/^[0-9]+$/.test(text)) return MODE_NUMERIC;
  if ([...text].every((character) => ALPHANUMERIC_CHARACTERS.includes(character))) return MODE_ALPHANUMERIC;
  return MODE_BYTE;
}

function count_characters(text, mode) {
  // En modo bytes el contador cuenta bytes UTF-8; en los otros dos, caracteres (todos ASCII)
  return mode === MODE_BYTE ? utf8_bytes(text).length : text.length;
}

// Cuántos bits ocupa el contador de caracteres: crece con la versión
function count_bit_length(mode, version) {
  const sizes = { [MODE_NUMERIC]: [10, 12, 14], [MODE_ALPHANUMERIC]: [9, 11, 13], [MODE_BYTE]: [8, 16, 16] }[mode];
  if (version <= 9) return sizes[0];
  return version <= 26 ? sizes[1] : sizes[2];
}

function payload_bit_length(mode, count) {
  if (mode === MODE_NUMERIC) return Math.floor(count / 3) * 10 + [0, 4, 7][count % 3];
  if (mode === MODE_ALPHANUMERIC) return Math.floor(count / 2) * 11 + (count % 2) * 6;
  return count * 8;
}

// Módulos que quedan para datos y corrección una vez descontados los patrones fijos
function raw_data_modules(version) {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignment_count = Math.floor(version / 7) + 2;
    modules -= (25 * alignment_count - 10) * alignment_count - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

export function data_codeword_count(version, level) {
  const index = LEVEL_INDEX[level];
  return Math.floor(raw_data_modules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[index][version] * BLOCK_COUNTS[index][version];
}

// La versión más chica en la que caben `count` caracteres en ese modo y nivel; 0 si no cabe en ninguna
export function find_version(mode, count, level) {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    const needed_bits = 4 + count_bit_length(mode, version) + payload_bit_length(mode, count);
    if (needed_bits <= data_codeword_count(version, level) * 8) return version;
  }
  return 0;
}

// Cuántos caracteres caben como máximo en esa versión, modo y nivel
export function max_characters(version, level, mode) {
  const available_bits = data_codeword_count(version, level) * 8 - 4 - count_bit_length(mode, version);
  if (mode === MODE_NUMERIC) {
    const remainder = available_bits % 10;
    return Math.floor(available_bits / 10) * 3 + (remainder >= 7 ? 2 : remainder >= 4 ? 1 : 0);
  }
  if (mode === MODE_ALPHANUMERIC) return Math.floor(available_bits / 11) * 2 + (available_bits % 11 >= 6 ? 1 : 0);
  return Math.floor(available_bits / 8);
}

// El nivel más alto, por debajo del pedido, en el que sí cabe el texto; null si en ninguno
export function fitting_level(text, level) {
  const mode = detect_mode(text);
  const count = count_characters(text, mode);
  for (let index = LEVEL_INDEX[level] - 1; index >= 0; index--) {
    if (find_version(mode, count, ERROR_LEVELS[index])) return ERROR_LEVELS[index];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Palabras de datos
// ---------------------------------------------------------------------------

function append_bits(bits, value, length) {
  for (let position = length - 1; position >= 0; position--) bits.push((value >>> position) & 1);
}

export function build_data_codewords(text, mode, version, level) {
  const bits = [];
  append_bits(bits, MODE_INDICATORS[mode], 4);
  append_bits(bits, count_characters(text, mode), count_bit_length(mode, version));

  if (mode === MODE_NUMERIC) {
    for (let index = 0; index < text.length; index += 3) {
      const group = text.slice(index, index + 3);
      append_bits(bits, Number(group), [0, 4, 7, 10][group.length]);
    }
  } else if (mode === MODE_ALPHANUMERIC) {
    for (let index = 0; index < text.length; index += 2) {
      const first = ALPHANUMERIC_CHARACTERS.indexOf(text[index]);
      if (index + 1 < text.length) {
        append_bits(bits, first * 45 + ALPHANUMERIC_CHARACTERS.indexOf(text[index + 1]), 11);
      } else {
        append_bits(bits, first, 6);
      }
    }
  } else {
    utf8_bytes(text).forEach((byte) => append_bits(bits, byte, 8));
  }

  const capacity_bits = data_codeword_count(version, level) * 8;
  // Terminador de hasta 4 ceros, luego ceros hasta completar el byte
  append_bits(bits, 0, Math.min(4, capacity_bits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let index = 0; index < bits.length; index += 8) {
    codewords.push(parseInt(bits.slice(index, index + 8).join(""), 2));
  }
  // Relleno alternado hasta llenar todas las palabras de datos
  for (let pad = 0; codewords.length < capacity_bits / 8; pad++) codewords.push(PAD_BYTES[pad % 2]);
  return codewords;
}

// ---------------------------------------------------------------------------
// Corrección de errores Reed-Solomon en GF(256)
// ---------------------------------------------------------------------------

// Multiplicación en GF(256) con el polinomio reductor 0x11D, bit a bit
export function gf_multiply(left, right) {
  let product = 0;
  for (let bit = 7; bit >= 0; bit--) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    product ^= ((right >>> bit) & 1) * left;
  }
  return product;
}

const generator_cache = new Map();

// Polinomio generador del grado dado, de mayor a menor potencia y empezando por 1: producto de (x - 2^i)
export function reed_solomon_generator(degree) {
  if (generator_cache.has(degree)) return generator_cache.get(degree);
  let generator = [1];
  let root = 1;
  for (let step = 0; step < degree; step++) {
    const next = new Array(generator.length + 1).fill(0);
    for (let index = 0; index < generator.length; index++) {
      next[index] ^= generator[index];
      next[index + 1] ^= gf_multiply(generator[index], root);
    }
    generator = next;
    root = gf_multiply(root, 2);
  }
  generator_cache.set(degree, generator);
  return generator;
}

// Las palabras de corrección de un bloque: el resto de dividir los datos por el generador
export function reed_solomon_remainder(data, degree) {
  const generator = reed_solomon_generator(degree);
  const remainder = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift();
    remainder.push(0);
    for (let index = 0; index < degree; index++) remainder[index] ^= gf_multiply(generator[index + 1], factor);
  }
  return remainder;
}

// Parte los datos en bloques, calcula la corrección de cada uno e intercala todo como manda el estándar
export function add_error_correction(data, version, level) {
  const index = LEVEL_INDEX[level];
  const block_count = BLOCK_COUNTS[index][version];
  const ecc_length = ECC_CODEWORDS_PER_BLOCK[index][version];
  const raw_codewords = Math.floor(raw_data_modules(version) / 8);
  const short_block_count = block_count - (raw_codewords % block_count);
  const short_block_length = Math.floor(raw_codewords / block_count);

  const blocks = [];
  let offset = 0;
  for (let block = 0; block < block_count; block++) {
    // Los primeros bloques son cortos; los últimos llevan una palabra de datos más
    const data_length = short_block_length - ecc_length + (block < short_block_count ? 0 : 1);
    const block_data = data.slice(offset, offset + data_length);
    offset += data_length;
    blocks.push({ data: block_data, ecc: reed_solomon_remainder(block_data, ecc_length) });
  }

  const result = [];
  const longest = Math.max(...blocks.map((block) => block.data.length));
  for (let position = 0; position < longest; position++) {
    blocks.forEach((block) => {
      if (position < block.data.length) result.push(block.data[position]);
    });
  }
  for (let position = 0; position < ecc_length; position++) blocks.forEach((block) => result.push(block.ecc[position]));
  return result;
}

// ---------------------------------------------------------------------------
// Matriz
// ---------------------------------------------------------------------------

function make_grid(size, value) {
  return Array.from({ length: size }, () => new Array(size).fill(value));
}

function get_bit(value, index) {
  return ((value >>> index) & 1) !== 0;
}

// Posiciones de los patrones de alineación (el mismo valor sirve de fila y de columna)
export function get_alignment_positions(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let position = version * 4 + 10; positions.length < count; position -= step) positions.splice(1, 0, position);
  return positions;
}

// Los 15 bits de formato: nivel y máscara, con su código BCH, y enmascarados con 0x5412
export function format_bits_for(level, mask) {
  const data = (FORMAT_LEVEL_BITS[level] << 3) | mask;
  let remainder = data;
  for (let step = 0; step < 10; step++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
}

// Los 18 bits de versión (solo versiones 7 o más), con su código BCH
export function version_bits_for(version) {
  let remainder = version;
  for (let step = 0; step < 12; step++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  return (version << 12) | remainder;
}

function set_function_module(grid, x, y, dark) {
  grid.modules[y][x] = dark;
  grid.is_function[y][x] = true;
}

function draw_finder_pattern(grid, center_x, center_y) {
  for (let delta_y = -4; delta_y <= 4; delta_y++) {
    for (let delta_x = -4; delta_x <= 4; delta_x++) {
      const x = center_x + delta_x;
      const y = center_y + delta_y;
      if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) continue;
      const distance = Math.max(Math.abs(delta_x), Math.abs(delta_y));
      // Anillos: negro (centro 3x3), claro, negro, y separador claro alrededor
      set_function_module(grid, x, y, distance !== 2 && distance !== 4);
    }
  }
}

function draw_alignment_pattern(grid, center_x, center_y) {
  for (let delta_y = -2; delta_y <= 2; delta_y++) {
    for (let delta_x = -2; delta_x <= 2; delta_x++) {
      set_function_module(grid, center_x + delta_x, center_y + delta_y, Math.max(Math.abs(delta_x), Math.abs(delta_y)) !== 1);
    }
  }
}

function draw_format_bits(grid, level, mask) {
  const bits = format_bits_for(level, mask);
  const size = grid.size;
  // Primera copia, alrededor del patrón de búsqueda de arriba a la izquierda
  for (let index = 0; index <= 5; index++) set_function_module(grid, 8, index, get_bit(bits, index));
  set_function_module(grid, 8, 7, get_bit(bits, 6));
  set_function_module(grid, 8, 8, get_bit(bits, 7));
  set_function_module(grid, 7, 8, get_bit(bits, 8));
  for (let index = 9; index < 15; index++) set_function_module(grid, 14 - index, 8, get_bit(bits, index));
  // Segunda copia, repartida entre los otros dos patrones de búsqueda
  for (let index = 0; index < 8; index++) set_function_module(grid, size - 1 - index, 8, get_bit(bits, index));
  for (let index = 8; index < 15; index++) set_function_module(grid, 8, size - 15 + index, get_bit(bits, index));
  // El módulo oscuro fijo
  set_function_module(grid, 8, size - 8, true);
}

function draw_version_bits(grid, version) {
  if (version < 7) return;
  const bits = version_bits_for(version);
  for (let index = 0; index < 18; index++) {
    const dark = get_bit(bits, index);
    const a = grid.size - 11 + (index % 3);
    const b = Math.floor(index / 3);
    set_function_module(grid, a, b, dark);
    set_function_module(grid, b, a, dark);
  }
}

// Todo lo que no son datos: búsqueda, sincronía, alineación, formato (con una máscara cualquiera) y versión
function build_function_grid(version) {
  const size = version * 4 + 17;
  const grid = { size, modules: make_grid(size, false), is_function: make_grid(size, false) };

  for (let index = 0; index < size; index++) {
    set_function_module(grid, 6, index, index % 2 === 0);
    set_function_module(grid, index, 6, index % 2 === 0);
  }
  draw_finder_pattern(grid, 3, 3);
  draw_finder_pattern(grid, size - 4, 3);
  draw_finder_pattern(grid, 3, size - 4);

  const positions = get_alignment_positions(version);
  const last = positions.length - 1;
  positions.forEach((x, column) => {
    positions.forEach((y, row) => {
      // Los tres que caerían encima de un patrón de búsqueda no se dibujan
      const overlaps_finder = (column === 0 && row === 0) || (column === 0 && row === last) || (column === last && row === 0);
      if (!overlaps_finder) draw_alignment_pattern(grid, x, y);
    });
  });

  // Reserva el lugar del formato (la máscara real se escribe después) y escribe la versión
  draw_format_bits(grid, "L", 0);
  draw_version_bits(grid, version);
  return grid;
}

// Coloca los bits en zigzag, de dos en dos columnas de derecha a izquierda, saltando lo que ya está ocupado
function place_codewords(grid, codewords) {
  const size = grid.size;
  let bit_index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    // La columna 6 es la línea de sincronía vertical: se salta
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      for (let offset = 0; offset < 2; offset++) {
        const x = right - offset;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - step : step;
        if (!grid.is_function[y][x] && bit_index < codewords.length * 8) {
          grid.modules[y][x] = get_bit(codewords[bit_index >>> 3], 7 - (bit_index & 7));
          bit_index++;
        }
      }
    }
  }
}

const MASK_CONDITIONS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function apply_mask(grid, mask) {
  const condition = MASK_CONDITIONS[mask];
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (!grid.is_function[y][x] && condition(x, y)) grid.modules[y][x] = !grid.modules[y][x];
    }
  }
}

function line_run_penalty(line) {
  let penalty = 0;
  let run = 1;
  for (let index = 1; index <= line.length; index++) {
    if (index < line.length && line[index] === line[index - 1]) {
      run++;
      continue;
    }
    if (run >= MIN_RUN_LENGTH) penalty += PENALTY_RUN + (run - MIN_RUN_LENGTH);
    run = 1;
  }
  return penalty;
}

function line_finder_like_count(line) {
  const values = line.map((dark) => (dark ? 1 : 0));
  let count = 0;
  for (let start = 0; start + 11 <= values.length; start++) {
    if (FINDER_LIKE_PATTERNS.some((pattern) => pattern.every((value, offset) => values[start + offset] === value))) count++;
  }
  return count;
}

// Puntaje de una matriz según las cuatro reglas del estándar: menos es mejor
export function penalty_score(modules) {
  const size = modules.length;
  let penalty = 0;

  const columns = Array.from({ length: size }, (_, x) => modules.map((row) => row[x]));
  [...modules, ...columns].forEach((line) => {
    penalty += line_run_penalty(line);
    penalty += line_finder_like_count(line) * PENALTY_FINDER_LIKE;
  });

  // Bloques de 2x2 del mismo color
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const color = modules[y][x];
      if (modules[y][x + 1] === color && modules[y + 1][x] === color && modules[y + 1][x + 1] === color) penalty += PENALTY_BLOCK;
    }
  }

  // Proporción de negros: cada 5 % que se aleja del 50 % suma 10
  const dark_count = modules.reduce((total, row) => total + row.filter(Boolean).length, 0);
  const dark_percent = (dark_count * 100) / (size * size);
  const previous_multiple = Math.floor(dark_percent / 5) * 5;
  const steps = Math.min(Math.abs(previous_multiple - 50), Math.abs(previous_multiple + 5 - 50)) / 5;
  penalty += steps * PENALTY_BALANCE;
  return penalty;
}

// ---------------------------------------------------------------------------
// Entrada principal
// ---------------------------------------------------------------------------

// Codifica un texto. Devuelve { matrix, size, version, level, mode, mask, bytes, characters }.
// Lanza QrError: "empty" si no hay texto, "too_long" si no cabe con ese nivel de corrección.
export function encode_qr(text, level = "M") {
  if (!ERROR_LEVELS.includes(level)) throw new QrError("invalid_input", "Nivel de corrección desconocido.");
  if (!text) throw new QrError("empty", "No hay nada que codificar.");

  const mode = detect_mode(text);
  const count = count_characters(text, mode);
  const version = find_version(mode, count, level);
  if (!version) {
    throw new QrError("too_long", "El contenido no cabe en un QR con ese nivel de corrección.", {
      level,
      mode,
      count,
      max_count: max_characters(MAX_VERSION, level, mode),
    });
  }

  const data = build_data_codewords(text, mode, version, level);
  const codewords = add_error_correction(data, version, level);
  const base = build_function_grid(version);
  place_codewords(base, codewords);

  // Se prueban las 8 máscaras y se queda la de menor penalización (la de menor número si empatan)
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = { size: base.size, modules: base.modules.map((row) => row.slice()), is_function: base.is_function };
    apply_mask(candidate, mask);
    draw_format_bits(candidate, level, mask);
    const score = penalty_score(candidate.modules);
    if (best === null || score < best.score) best = { mask, score, modules: candidate.modules };
  }

  return {
    matrix: best.modules,
    size: base.size,
    version,
    level,
    mode,
    mask: best.mask,
    bytes: utf8_bytes(text).length,
    characters: [...text].length,
  };
}

// ---------------------------------------------------------------------------
// Constructores de contenido: cada uno arma el texto que se codifica.
// Lanzan QrError("empty") si falta lo obligatorio y QrError("invalid_input") si algo no sirve.
// ---------------------------------------------------------------------------

const WIFI_SECURITIES = { WPA: "WPA", WEP: "WEP", nopass: "nopass" };
const WHATSAPP_MIN_DIGITS = 7;
const WHATSAPP_MAX_DIGITS = 15;

// Escapa lo que el formato Wi-Fi usa como separador: \ ; , : y las comillas
function escape_wifi_value(value) {
  const escaped = value.replace(/[\\;,:"]/g, (character) => `\\${character}`);
  // Un valor que solo tiene dígitos hexadecimales se podría tomar por hexadecimal: entre comillas se lee tal cual
  return /^[0-9a-fA-F]+$/.test(value) ? `"${escaped}"` : escaped;
}

// Red Wi-Fi: WIFI:T:WPA;S:nombre;P:clave;H:true;;
export function build_wifi_text({ ssid, password, security, hidden }) {
  const network_name = (ssid || "").trim();
  if (!network_name) throw new QrError("empty", "Escribe el nombre de la red.");
  const type = WIFI_SECURITIES[security];
  if (!type) throw new QrError("invalid_input", "Tipo de seguridad desconocido.");
  if (type !== "nopass" && !password) throw new QrError("invalid_input", "Escribe la clave de la red, o elige «Sin clave».");

  let text = `WIFI:T:${type};S:${escape_wifi_value(network_name)};`;
  if (type !== "nopass") text += `P:${escape_wifi_value(password)};`;
  if (hidden) text += "H:true;";
  return `${text};`;
}

// En una vCard se escapan la barra, la coma, el punto y coma y los saltos de línea
function escape_vcard_value(value) {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

// Contacto en formato vCard 3.0, que leen todos los teléfonos
export function build_contact_text({ first_name, last_name, phone, email, company, job_title, website }) {
  const given = (first_name || "").trim();
  const family = (last_name || "").trim();
  if (!given) throw new QrError("empty", "Escribe al menos el nombre.");

  const phone_text = (phone || "").trim();
  if (phone_text && !/^[0-9+\-()\s]+$/.test(phone_text)) {
    throw new QrError("invalid_input", "El teléfono solo puede tener números, espacios y los signos + - ( ).");
  }
  const email_text = (email || "").trim();
  if (email_text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email_text)) {
    throw new QrError("invalid_input", "El correo no parece válido. Revisa que tenga @ y un dominio.");
  }

  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${escape_vcard_value(family)};${escape_vcard_value(given)};;;`];
  lines.push(`FN:${escape_vcard_value([given, family].filter(Boolean).join(" "))}`);
  if ((company || "").trim()) lines.push(`ORG:${escape_vcard_value(company.trim())}`);
  if ((job_title || "").trim()) lines.push(`TITLE:${escape_vcard_value(job_title.trim())}`);
  if (phone_text) lines.push(`TEL;TYPE=CELL:${phone_text}`);
  if (email_text) lines.push(`EMAIL:${email_text}`);
  // Una dirección web no se escapa: es un URI, no un texto
  if ((website || "").trim()) lines.push(`URL:${website.trim()}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

// Chat de WhatsApp: https://wa.me/<indicativo><número>?text=<mensaje>
export function build_whatsapp_text({ country_code, number, message }) {
  const country_digits = (country_code || "").replace(/\D/g, "");
  // Los ceros al inicio del número local no van: el indicativo ya identifica el país
  const number_digits = (number || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!number_digits) throw new QrError("empty", "Escribe el número de WhatsApp.");
  if (!country_digits) throw new QrError("invalid_input", "Escribe el indicativo del país, por ejemplo 57.");
  const full_number = country_digits + number_digits;
  if (full_number.length < WHATSAPP_MIN_DIGITS || full_number.length > WHATSAPP_MAX_DIGITS) {
    throw new QrError("invalid_input", `El número completo debe tener entre ${WHATSAPP_MIN_DIGITS} y ${WHATSAPP_MAX_DIGITS} dígitos con el indicativo.`);
  }
  const text = (message || "").trim();
  return `https://wa.me/${full_number}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
