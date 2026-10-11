// Codificadores de códigos de barras: Code 128, EAN-13, EAN-8, UPC-A, Code 39 e ITF-14, escritos a mano
// (CLAUDE.md 2.2 no permite librerías extra). Son funciones puras que no tocan la pantalla.
//
// Cada codificador devuelve un modelo con las barras en "módulos" (el ancho de la barra más fina), la zona de
// silencio que pide el estándar y el texto legible con su posición. Dibujarlo es trabajo de code_renderer.js.
//
// Modelo devuelto por encode_barcode:
//   type, type_label   qué tipo es
//   value              lo que de verdad se codificó (con el dígito de control ya puesto)
//   notes              avisos que no impiden dibujar (por ejemplo: "se pasó a mayúsculas")
//   quiet_left/right   zona de silencio en módulos
//   width              ancho del símbolo en módulos, sin zona de silencio
//   bars               [{ x, width, extended }]; extended = barra que baja hasta el texto (guardas de EAN y UPC)
//   labels             [{ text, center }] con el centro en módulos desde el inicio del símbolo
//   frame              grosor en módulos del marco portador (solo ITF-14), 0 en los demás

export class BarcodeError extends Error {
  // code: "empty" si no hay nada escrito, "invalid_input" si lo escrito no sirve
  constructor(code, message) {
    super(message);
    this.name = "BarcodeError";
    this.code = code;
  }
}

const MAX_TEXT_LENGTH = 80;

// Lo que la pantalla necesita saber de cada tipo
export const BARCODE_TYPES = [
  { id: "code128", label: "Code 128", numeric: false, hint: "Letras, números y símbolos del teclado, hasta 80 caracteres. Sin tildes ni eñes.", placeholder: "PEDIDO-2026-001" },
  { id: "ean13", label: "EAN-13", numeric: true, max_length: 13, hint: "12 o 13 dígitos. Si escribes 12, el último (de control) se calcula solo.", placeholder: "770200400350" },
  { id: "ean8", label: "EAN-8", numeric: true, max_length: 8, hint: "7 u 8 dígitos. Si escribes 7, el último (de control) se calcula solo.", placeholder: "9638507" },
  { id: "upca", label: "UPC-A", numeric: true, max_length: 12, hint: "11 o 12 dígitos. Si escribes 11, el último (de control) se calcula solo.", placeholder: "03600029145" },
  { id: "code39", label: "Code 39", numeric: false, hint: "Letras, números y - . $ / + % espacio, hasta 80 caracteres. Las minúsculas pasan a mayúsculas.", placeholder: "ABC-123" },
  { id: "itf14", label: "ITF-14", numeric: true, max_length: 14, hint: "13 o 14 dígitos, para cajas y embalajes. Si escribes 13, el último (de control) se calcula solo.", placeholder: "1770200400350" },
];

// ---------------------------------------------------------------------------
// Utilidades comunes
// ---------------------------------------------------------------------------

// Dígito de control de GS1: el dígito de más a la derecha pesa 3, el siguiente 1, y así alternando
export function calculate_check_digit(digits) {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    const from_right = digits.length - 1 - index;
    sum += Number(digits[index]) * (from_right % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

// Convierte una lista de anchos que alternan barra, espacio, barra... (empezando en barra) en barras con posición
function widths_to_bars(widths) {
  const bars = [];
  let position = 0;
  widths.forEach((width, index) => {
    if (index % 2 === 0) bars.push({ x: position, width, extended: false });
    position += width;
  });
  return { bars, width: position };
}

// Convierte una cadena de 0 y 1 (un carácter por módulo) en barras; `extended_ranges` marca las que bajan hasta el texto
function modules_to_bars(modules, extended_ranges) {
  const bars = [];
  let start = -1;
  for (let index = 0; index <= modules.length; index++) {
    const is_dark = index < modules.length && modules[index] === "1";
    if (is_dark && start < 0) start = index;
    if (!is_dark && start >= 0) {
      const extended = extended_ranges.some(([from, to]) => start >= from && start <= to);
      bars.push({ x: start, width: index - start, extended });
      start = -1;
    }
  }
  return bars;
}

// Valida y normaliza un texto de solo dígitos. Con `length - 1` dígitos calcula el de control; con `length` lo comprueba.
function complete_digits(text, length, name) {
  const digits = text.replace(/\s/g, "");
  if (!digits) throw new BarcodeError("empty", "Escribe los dígitos del código.");
  if (!/^[0-9]+$/.test(digits)) throw new BarcodeError("invalid_input", `${name} solo admite dígitos, del 0 al 9.`);
  if (digits.length !== length - 1 && digits.length !== length) {
    throw new BarcodeError("invalid_input", `Un ${name} lleva ${length - 1} o ${length} dígitos; escribiste ${digits.length}.`);
  }
  const expected = calculate_check_digit(digits.slice(0, length - 1));
  if (digits.length === length) {
    if (Number(digits[length - 1]) !== expected) {
      throw new BarcodeError("invalid_input", `El dígito de control debería ser ${expected}, no ${digits[length - 1]}. Corrígelo o bórralo para que se calcule solo.`);
    }
    return digits;
  }
  return digits + expected;
}

// ---------------------------------------------------------------------------
// EAN-13, EAN-8 y UPC-A
// ---------------------------------------------------------------------------

// Dígitos en el lado izquierdo (juego L) y su paridad; el derecho (R) es el complemento y el juego G es R al revés
const EAN_L_PATTERNS = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_R_PATTERNS = EAN_L_PATTERNS.map((pattern) => [...pattern].map((bit) => (bit === "1" ? "0" : "1")).join(""));
const EAN_G_PATTERNS = EAN_R_PATTERNS.map((pattern) => [...pattern].reverse().join(""));
// El primer dígito del EAN-13 no se dibuja: decide qué juego (L o G) usa cada uno de los seis de la izquierda
const EAN13_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

const EAN_START_GUARD = "101";
const EAN_MIDDLE_GUARD = "01010";
const EAN_END_GUARD = "101";
const EAN_DIGIT_MODULES = 7;

function side_modules(digits, parity) {
  return [...digits].map((digit, index) => (parity[index] === "G" ? EAN_G_PATTERNS : parity[index] === "R" ? EAN_R_PATTERNS : EAN_L_PATTERNS)[Number(digit)]).join("");
}

function encode_ean13(text) {
  const digits = complete_digits(text, 13, "EAN-13");
  const left = side_modules(digits.slice(1, 7), EAN13_PARITY[Number(digits[0])]);
  const right = side_modules(digits.slice(7), "RRRRRR");
  const modules = EAN_START_GUARD + left + EAN_MIDDLE_GUARD + right + EAN_END_GUARD;
  const labels = [{ text: digits[0], center: -4.5 }];
  for (let index = 0; index < 6; index++) {
    labels.push({ text: digits[1 + index], center: 3 + EAN_DIGIT_MODULES * index + EAN_DIGIT_MODULES / 2 });
    labels.push({ text: digits[7 + index], center: 50 + EAN_DIGIT_MODULES * index + EAN_DIGIT_MODULES / 2 });
  }
  return {
    value: digits,
    quiet_left: 11,
    quiet_right: 7,
    width: modules.length,
    bars: modules_to_bars(modules, [[0, 2], [45, 49], [92, 94]]),
    labels,
  };
}

function encode_upca(text) {
  const digits = complete_digits(text, 12, "UPC-A");
  // Un UPC-A es un EAN-13 con un 0 delante: los seis de la izquierda van todos en el juego L
  const left = side_modules(digits.slice(0, 6), "LLLLLL");
  const right = side_modules(digits.slice(6), "RRRRRR");
  const modules = EAN_START_GUARD + left + EAN_MIDDLE_GUARD + right + EAN_END_GUARD;
  // El primer y el último dígito van fuera de las guardas y sus barras también bajan hasta el texto
  const labels = [{ text: digits[0], center: -5 }];
  for (let index = 0; index < 5; index++) {
    labels.push({ text: digits[1 + index], center: 3 + EAN_DIGIT_MODULES * (index + 1) + EAN_DIGIT_MODULES / 2 });
    labels.push({ text: digits[6 + index], center: 50 + EAN_DIGIT_MODULES * index + EAN_DIGIT_MODULES / 2 });
  }
  labels.push({ text: digits[11], center: modules.length + 5 });
  return {
    value: digits,
    quiet_left: 9,
    quiet_right: 9,
    width: modules.length,
    bars: modules_to_bars(modules, [[0, 9], [45, 49], [85, 94]]),
    labels,
  };
}

function encode_ean8(text) {
  const digits = complete_digits(text, 8, "EAN-8");
  const modules = EAN_START_GUARD + side_modules(digits.slice(0, 4), "LLLL") + EAN_MIDDLE_GUARD + side_modules(digits.slice(4), "RRRR") + EAN_END_GUARD;
  const labels = [];
  for (let index = 0; index < 4; index++) {
    labels.push({ text: digits[index], center: 3 + EAN_DIGIT_MODULES * index + EAN_DIGIT_MODULES / 2 });
    labels.push({ text: digits[4 + index], center: 36 + EAN_DIGIT_MODULES * index + EAN_DIGIT_MODULES / 2 });
  }
  return {
    value: digits,
    quiet_left: 7,
    quiet_right: 7,
    width: modules.length,
    bars: modules_to_bars(modules, [[0, 2], [31, 35], [64, 66]]),
    labels,
  };
}

// ---------------------------------------------------------------------------
// Code 128
// ---------------------------------------------------------------------------

// Ancho de las 6 barras y espacios de cada valor 0..105 y la parada (106, de 7 elementos)
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const CODE128_START_B = 104;
const CODE128_START_C = 105;
const CODE128_SWITCH_TO_C = 99;
const CODE128_SWITCH_TO_B = 100;
const CODE128_STOP = 106;
const CODE128_MODULUS = 103;

function is_digit_pair(text, index) {
  return index + 1 < text.length && /[0-9]/.test(text[index]) && /[0-9]/.test(text[index + 1]);
}

// Elige entre el juego B (un carácter por símbolo) y el C (dos dígitos por símbolo) lo que dé menos símbolos.
// Programación dinámica: costo mínimo de llegar a cada posición estando en cada juego. El juego A no se usa:
// solo sirve para caracteres de control, que no se admiten, y todo lo imprimible cabe en B y C.
export function code128_values(text) {
  const length = text.length;
  const INFINITY = Number.MAX_SAFE_INTEGER;
  // cost[i][set]: símbolos usados para dejar escritos los primeros i caracteres terminando en ese juego (0 = B, 1 = C)
  const cost = Array.from({ length: length + 1 }, () => [INFINITY, INFINITY]);
  const previous = Array.from({ length: length + 1 }, () => [null, null]);

  cost[0][0] = 1; // símbolo de inicio B
  if (is_digit_pair(text, 0)) cost[0][1] = 1; // símbolo de inicio C

  for (let index = 0; index <= length; index++) {
    // Cambiar de juego en esta posición cuesta un símbolo
    if (cost[index][0] + 1 < cost[index][1]) {
      cost[index][1] = cost[index][0] + 1;
      previous[index][1] = { index, set: 0, kind: "switch" };
    }
    if (cost[index][1] + 1 < cost[index][0]) {
      cost[index][0] = cost[index][1] + 1;
      previous[index][0] = { index, set: 1, kind: "switch" };
    }
    if (index === length) break;
    if (cost[index][0] + 1 < cost[index + 1][0]) {
      cost[index + 1][0] = cost[index][0] + 1;
      previous[index + 1][0] = { index, set: 0, kind: "character" };
    }
    if (is_digit_pair(text, index) && cost[index][1] + 1 < cost[index + 2][1]) {
      cost[index + 2][1] = cost[index][1] + 1;
      previous[index + 2][1] = { index, set: 1, kind: "pair" };
    }
  }

  // Se retrocede desde el final, prefiriendo terminar en B si empatan, y se arma la lista de valores
  let set = cost[length][0] <= cost[length][1] ? 0 : 1;
  let index = length;
  const steps = [];
  while (previous[index][set]) {
    const step = previous[index][set];
    steps.push({ ...step, to_set: set, to_index: index });
    index = step.index;
    set = step.set;
  }
  steps.reverse();

  const values = [set === 0 ? CODE128_START_B : CODE128_START_C];
  steps.forEach((step) => {
    if (step.kind === "switch") values.push(step.to_set === 1 ? CODE128_SWITCH_TO_C : CODE128_SWITCH_TO_B);
    else if (step.kind === "pair") values.push(Number(text.slice(step.index, step.index + 2)));
    else values.push(text.charCodeAt(step.index) - 32);
  });
  return values;
}

// Dígito de control: (inicio + suma de posición * valor) módulo 103
export function code128_checksum(values) {
  let sum = values[0];
  for (let index = 1; index < values.length; index++) sum += index * values[index];
  return sum % CODE128_MODULUS;
}

function encode_code128(text) {
  if (!text) throw new BarcodeError("empty", "Escribe el texto del código.");
  if (text.length > MAX_TEXT_LENGTH) {
    throw new BarcodeError("invalid_input", `Más de ${MAX_TEXT_LENGTH} caracteres no lo leen bien los escáneres de mano (escribiste ${text.length}).`);
  }
  const unsupported = [...text].find((character) => character < " " || character > "~");
  if (unsupported) {
    throw new BarcodeError("invalid_input", `Code 128 no admite «${unsupported}»: solo letras sin tilde, números y los símbolos del teclado inglés.`);
  }
  const values = code128_values(text);
  values.push(code128_checksum(values), CODE128_STOP);

  const widths = [];
  values.forEach((value) => [...CODE128_PATTERNS[value]].forEach((digit) => widths.push(Number(digit))));
  const { bars, width } = widths_to_bars(widths);
  return {
    value: text,
    quiet_left: 10,
    quiet_right: 10,
    width,
    bars,
    labels: [{ text, center: width / 2 }],
    symbol_values: values,
  };
}

// ---------------------------------------------------------------------------
// Code 39
// ---------------------------------------------------------------------------

// Nueve elementos por carácter, de barra y espacio alternados: n = fino, w = ancho (tres de cada nueve son anchos)
const CODE39_PATTERNS = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw",
  "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn", "9": "nnwwnnwnn",
  A: "wnnnnwnnw", B: "nnwnnwnnw", C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn",
  F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn",
  K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww", O: "wnnnwnnwn",
  P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn",
  U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn",
  Z: "nwwnwnnnn", "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "*": "nwnnwnwnn",
  $: "nwnwnwnnn", "/": "nwnwnnnwn", "+": "nwnnnwnwn", "%": "nnnwnwnwn",
};
// Proporción entre el elemento ancho y el fino (el estándar admite de 2 a 3)
const CODE39_WIDE = 3;
const CODE39_GAP = 1;

function encode_code39(text) {
  if (!text) throw new BarcodeError("empty", "Escribe el texto del código.");
  const notes = [];
  let value = text;
  if (/[a-z]/.test(text)) {
    value = text.toUpperCase();
    notes.push("Code 39 no tiene minúsculas: se pasaron a mayúsculas.");
  }
  if (value.length > MAX_TEXT_LENGTH) {
    throw new BarcodeError("invalid_input", `Más de ${MAX_TEXT_LENGTH} caracteres no lo leen bien los escáneres de mano (escribiste ${value.length}).`);
  }
  const unsupported = [...value].find((character) => character === "*" || !CODE39_PATTERNS[character]);
  if (unsupported) {
    throw new BarcodeError("invalid_input", `Code 39 no admite «${unsupported}»: solo A-Z, 0-9 y - . $ / + % espacio.`);
  }

  const widths = [];
  [...`*${value}*`].forEach((character, index, all) => {
    [...CODE39_PATTERNS[character]].forEach((element) => widths.push(element === "w" ? CODE39_WIDE : 1));
    if (index < all.length - 1) widths.push(CODE39_GAP);
  });
  const { bars, width } = widths_to_bars(widths);
  return { value, notes, quiet_left: 10, quiet_right: 10, width, bars, labels: [{ text: value, center: width / 2 }] };
}

// ---------------------------------------------------------------------------
// ITF-14
// ---------------------------------------------------------------------------

// Cinco elementos por dígito, dos de ellos anchos
const ITF_PATTERNS = ["nnwwn", "wnnnw", "nwnnw", "wwnnn", "nnwnw", "wnwnn", "nwwnn", "nnnww", "wnnwn", "nwnwn"];
const ITF_WIDE = 3;
const ITF_FRAME = 5;

function encode_itf14(text) {
  const digits = complete_digits(text, 14, "ITF-14");
  const widths = [1, 1, 1, 1]; // inicio: cuatro módulos finos, barra y espacio alternados
  for (let index = 0; index < 14; index += 2) {
    // Un par de dígitos va entrelazado: el primero dibuja las barras y el segundo los espacios
    const bar_pattern = ITF_PATTERNS[Number(digits[index])];
    const space_pattern = ITF_PATTERNS[Number(digits[index + 1])];
    for (let element = 0; element < 5; element++) {
      widths.push(bar_pattern[element] === "w" ? ITF_WIDE : 1);
      widths.push(space_pattern[element] === "w" ? ITF_WIDE : 1);
    }
  }
  widths.push(ITF_WIDE, 1, 1); // parada: barra ancha, espacio fino, barra fina
  const { bars, width } = widths_to_bars(widths);
  return {
    value: digits,
    quiet_left: 10,
    quiet_right: 10,
    width,
    bars,
    labels: [{ text: digits, center: width / 2 }],
    frame: ITF_FRAME,
  };
}

// ---------------------------------------------------------------------------
// Entrada principal
// ---------------------------------------------------------------------------

const ENCODERS = { code128: encode_code128, ean13: encode_ean13, ean8: encode_ean8, upca: encode_upca, code39: encode_code39, itf14: encode_itf14 };

// Codifica un texto con el tipo dado. Lanza BarcodeError si está vacío o no sirve para ese tipo.
export function encode_barcode(type_id, text) {
  const type = BARCODE_TYPES.find((item) => item.id === type_id);
  if (!type) throw new BarcodeError("invalid_input", "Tipo de código desconocido.");
  const model = ENCODERS[type_id](text);
  return { type: type_id, type_label: type.label, notes: [], frame: 0, ...model };
}
