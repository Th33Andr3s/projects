// Calculadora de materiales: pestañas, lectura de lo que se escribe, formato de números colombiano, cálculo y lista
// de cada trabajo, copiar y la memoria de los últimos valores. Las tablas y fórmulas viven en materials.js.
import { start_scene, flash_scene } from "./animations.js";
import {
  WALL_PIECES,
  CONCRETE_MIXES,
  PAINT_BUCKET_GALLONS,
  FLOOR_TILES,
  FLOOR_LAYOUT_WASTE_PERCENT,
  GLUE_BAG_KG,
  calculate_wall,
  calculate_concrete,
  calculate_plaster,
  calculate_paint,
  calculate_floor,
} from "./materials.js";

const STORAGE_KEY = "materials_calculator_last";
const DEFAULT_JOB = "wall";
const MAX_FIELD_LENGTH = 12;
const NBSP = " ";
const EMPTY_VALUE = "—";
const COPIED_MILLISECONDS = 2000;
// Margen para que un resultado que en teoría es entero (como 8 bultos) no suba un número por culpa de los decimales
const ROUNDING_TOLERANCE = 1e-9;
const MAX_RAW_DECIMALS = 3;

const MAX_WALL_SIDE_M = 1000;
const MAX_WALL_OPENINGS_M2 = 1_000_000;
// Topes del total, para que dos medidas dentro de su rango no den una obra imposible
const MAX_WALL_AREA_M2 = 100_000;
const MAX_CONCRETE_VOLUME_M3 = 10_000;
const MAX_CONCRETE_SIDE_M = 100;
const MAX_CONCRETE_QUANTITY = 9999;
const MAX_WASTE_PERCENT = 100;
const MAX_FINISH_AREA_M2 = 100_000;
const MAX_PLASTER_THICKNESS_CM = 10;
const MAX_PAINT_COATS = 10;
const MAX_PAINT_YIELD_M2_PER_GALLON = 100;
const MAX_FLOOR_AREA_M2 = 100_000;
const MAX_TILE_SIDE_CM = 200;
const MAX_TILE_THICKNESS_MM = 50;
const MAX_JOINT_MM = 50;
const MAX_BOX_AREA_M2 = 20;
const GROUT_DECIMALS = 1;

const dom = {
  tabs: [...document.querySelectorAll(".tab")],
  tab_list: document.querySelector(".tabs"),
  copy_status: document.getElementById("copy_status"),
};

// Los campos de cada trabajo, por su id: se leen de aquí, se recuerdan y se conectan sus eventos. Los campos de las
// ayudas para calcular el área no se recuerdan.
const JOB_FIELD_IDS = {
  wall: ["wall_length", "wall_height", "wall_piece", "wall_openings", "wall_waste"],
  concrete: ["concrete_length", "concrete_width", "concrete_height", "concrete_quantity", "concrete_mix", "concrete_waste"],
  finish: ["finish_include_plaster", "finish_include_paint", "finish_area", "finish_thickness", "finish_coats", "finish_yield", "finish_waste"],
  floor: ["floor_area", "floor_tile", "floor_tile_width", "floor_tile_length", "floor_thickness", "floor_joint", "floor_box", "floor_waste", "floor_layout"],
};
const FIELD_IDS = Object.values(JOB_FIELD_IDS).flat();
const HELPER_FIELD_IDS = ["finish_helper_length", "finish_helper_height", "finish_helper_openings", "floor_helper_length", "floor_helper_width"];
[...FIELD_IDS, ...HELPER_FIELD_IDS].forEach((id) => (dom[id] = document.getElementById(id)));

// Resto de elementos de cada trabajo (resultados, avisos y botón de copiar)
const RESULT_IDS = {
  wall: ["wall_area", "wall_error", "wall_piece_hint", "wall_pieces_name", "wall_pieces", "wall_pieces_unit", "wall_pieces_raw", "wall_cement", "wall_cement_unit", "wall_cement_raw", "wall_sand", "copy_wall_button", "copy_wall_label"],
  concrete: ["concrete_volume", "concrete_error", "concrete_mix_hint", "concrete_cement", "concrete_cement_unit", "concrete_cement_raw", "concrete_sand", "concrete_gravel", "concrete_water", "copy_concrete_button", "copy_concrete_label"],
  finish: [
    "finish_error", "finish_plaster_group", "finish_cement", "finish_cement_unit", "finish_cement_raw", "finish_sand", "finish_paint_group", "finish_paint", "finish_paint_unit", "finish_paint_raw", "finish_buckets",
    "finish_helper_area", "finish_helper_error", "finish_helper_use", "copy_finish_button", "copy_finish_label",
  ],
  floor: [
    "floor_error", "floor_custom_tile", "floor_pieces", "floor_pieces_unit", "floor_pieces_raw", "floor_boxes", "floor_boxes_unit", "floor_boxes_raw", "floor_glue", "floor_glue_unit", "floor_glue_raw", "floor_grout", "floor_grout_raw",
    "floor_helper_area", "floor_helper_error", "floor_helper_use", "copy_floor_button", "copy_floor_label",
  ],
};
Object.values(RESULT_IDS)
  .flat()
  .forEach((id) => (dom[id] = document.getElementById(id)));

// Lo último calculado en cada trabajo, que es lo que se copia
let wall_result = null;
let concrete_result = null;
let finish_result = null;
let floor_result = null;
// Último resultado mostrado en cada trabajo: el fondo solo hace su destello cuando el resultado cambia de verdad
const last_results = {};

// ---------------------------------------------------------------------------
// Leer lo que se escribe. Cada función devuelve { is_empty }, { error } o { value }.
// ---------------------------------------------------------------------------

// Número con coma o punto decimal. Son medidas pequeñas, así que no hay separador de miles: "1.250" es 1,25.
// zero_message dice qué avisar si escriben 0; si no se pasa, el 0 es válido.
function parse_decimal(text, { maximum, unit, zero_message }) {
  const cleaned = text.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "") return { is_empty: true };
  if (cleaned.startsWith("-")) return { error: "No puede ser negativo." };
  if (!/^(\d+\.?\d*|\.\d+)$/.test(cleaned)) return { error: "Escribe un número." };
  const value = Number(cleaned);
  if (value === 0 && zero_message) return { error: zero_message };
  if (value > maximum) return { error: `El máximo es ${format_number(maximum, 0)}${NBSP}${unit}.` };
  return { value };
}

function parse_whole_number(text, { minimum, maximum, unit, minimum_message }) {
  const cleaned = text.replace(/\s/g, "");
  if (cleaned === "") return { is_empty: true };
  if (cleaned.startsWith("-")) return { error: "No puede ser negativo." };
  if (!/^\d+$/.test(cleaned)) return { error: "Escribe un número entero." };
  const value = Number(cleaned);
  if (value < minimum) return { error: minimum_message };
  if (value > maximum) return { error: `El máximo es ${format_number(maximum, 0)}${NBSP}${unit}.` };
  return { value };
}

function parse_waste(text) {
  return parse_decimal(text, { maximum: MAX_WASTE_PERCENT, unit: "%" });
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

// Coma decimal y puntos en los miles, sin ceros sobrantes: 1234.5 → "1.234,5". Se arma a mano para no depender
// del idioma ni de la versión del navegador.
function format_number(value, max_decimals) {
  const [whole, fraction = ""] = value.toFixed(max_decimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const trimmed_fraction = fraction.replace(/0+$/, "");
  return trimmed_fraction ? `${grouped},${trimmed_fraction}` : grouped;
}

// Lo que se compra siempre se redondea hacia arriba, a enteros o a los decimales que se indiquen (la boquilla, a décimas)
function round_up(value, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.ceil(value * factor - ROUNDING_TOLERANCE) / factor;
}

// El cálculo sin redondear que se muestra entre paréntesis, con los decimales justos para que se vea distinto al
// redondeado: 594,3 y no 594; 3,02 y no 3,0. Si ya coincide con el redondeado no se muestra.
function raw_text(value, rounded_decimals = 0) {
  if (Math.abs(value - round_up(value, rounded_decimals)) < ROUNDING_TOLERANCE) return "";
  let decimals = rounded_decimals + 1;
  while (decimals < MAX_RAW_DECIMALS + rounded_decimals && Number(value.toFixed(decimals)) === Number(value.toFixed(rounded_decimals))) decimals += 1;
  return `(${format_number(value, decimals)})`;
}

// Metros cúbicos con dos decimales; una cantidad pequeña no se muestra como 0 para que no parezca que no hace falta
function format_cubic_meters(value) {
  return format_number(Math.max(value, value > 0 ? 0.01 : 0), 2);
}

function format_area(value) {
  return `${format_number(value, 2)}${NBSP}m²`;
}

function format_volume(value) {
  return `${format_number(value, 2)}${NBSP}m³`;
}

// Escribe una cantidad que se compra: el número redondeado hacia arriba, su unidad (en singular si es 1, si la
// tiene) y el cálculo sin redondear. Devuelve el número redondeado.
function show_units(strong, unit_element, raw_element, value, singular_unit, plural_unit, decimals = 0) {
  const rounded = round_up(value, decimals);
  const raw = raw_text(value, decimals);
  strong.textContent = format_number(rounded, decimals);
  if (unit_element) unit_element.textContent = rounded === 1 ? singular_unit : plural_unit;
  raw_element.textContent = raw;
  raw_element.hidden = !raw;
  return rounded;
}

function clear_units(strong, raw_element) {
  strong.textContent = EMPTY_VALUE;
  raw_element.textContent = "";
  raw_element.hidden = true;
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
// devuelve el elemento que se deja seleccionado para copiarlo a mano. Devuelve la función que vuelve el botón a su
// estado normal, para llamarla cuando cambia el resultado.
function setup_copy({ button, label, idle_label, get_text, get_fallback_node }) {
  const icon = button.querySelector("i");
  let timer = 0;

  function reset() {
    clearTimeout(timer);
    label.textContent = idle_label;
    icon.className = "fa-regular fa-copy";
    dom.copy_status.textContent = "";
  }

  function show(label_text, icon_class, status) {
    label.textContent = label_text;
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

// El fondo hace su destello cuando el resultado de un trabajo cambia (no si se vuelve a escribir lo mismo).
function announce_result(job, result_text) {
  if (last_results[job] !== result_text) flash_scene();
  last_results[job] = result_text;
}

// ---------------------------------------------------------------------------
// Muro
// ---------------------------------------------------------------------------

function describe_wall_piece(piece_key) {
  const piece = WALL_PIECES[piece_key];
  const face = `${format_number(piece.length_cm, 1)} × ${format_number(piece.height_cm, 1)}`;
  return `Cara a la vista de ${face} cm, en muro de ${format_number(piece.wall_thickness_cm, 0)} cm de espesor.`;
}

function clear_wall_result() {
  last_results.wall = "";
  wall_result = null;
  dom.wall_area.textContent = EMPTY_VALUE;
  clear_units(dom.wall_pieces, dom.wall_pieces_raw);
  clear_units(dom.wall_cement, dom.wall_cement_raw);
  dom.wall_sand.textContent = EMPTY_VALUE;
  dom.copy_wall_button.disabled = true;
}

// Recalcula el muro con lo que hay en pantalla.
function update_wall() {
  save_state();
  const piece_key = dom.wall_piece.value;
  dom.wall_piece_hint.textContent = describe_wall_piece(piece_key);
  dom.wall_pieces_name.textContent = piece_key === "common_brick" ? "Ladrillos" : "Bloques";
  reset_copy_wall();

  const { values, is_ready } = read_fields(
    [
      { input: dom.wall_length, parse: (text) => parse_decimal(text, { maximum: MAX_WALL_SIDE_M, unit: "m", zero_message: "El largo debe ser mayor que 0." }) },
      { input: dom.wall_height, parse: (text) => parse_decimal(text, { maximum: MAX_WALL_SIDE_M, unit: "m", zero_message: "El alto debe ser mayor que 0." }) },
      { input: dom.wall_openings, parse: (text) => parse_decimal(text, { maximum: MAX_WALL_OPENINGS_M2, unit: "m²" }) },
      { input: dom.wall_waste, parse: parse_waste },
    ],
    dom.wall_error,
  );
  const [length, height, openings, waste] = values;

  if (!is_ready) {
    clear_wall_result();
    return;
  }
  if (length * height > MAX_WALL_AREA_M2) {
    [dom.wall_length, dom.wall_height].forEach((input) => mark_invalid(input, true));
    show_error(dom.wall_error, `El muro no puede pasar de ${format_number(MAX_WALL_AREA_M2, 0)}${NBSP}m².`);
    clear_wall_result();
    return;
  }
  // Los vanos no pueden dejar el muro sin área
  if (openings >= length * height) {
    mark_invalid(dom.wall_openings, true);
    show_error(dom.wall_error, "Las puertas y ventanas deben ser menores que el área del muro.");
    clear_wall_result();
    return;
  }

  const result = calculate_wall(length, height, openings, piece_key, waste);
  const pieces = show_units(dom.wall_pieces, dom.wall_pieces_unit, dom.wall_pieces_raw, result.pieces, "pieza", "piezas");
  const cement_bags = show_units(dom.wall_cement, dom.wall_cement_unit, dom.wall_cement_raw, result.cement_bags, "bulto de 50 kg", "bultos de 50 kg");
  dom.wall_area.textContent = format_area(result.net_area_m2);
  dom.wall_sand.textContent = format_cubic_meters(result.sand_m3);
  dom.copy_wall_button.disabled = false;
  announce_result("wall", [dom.wall_pieces, dom.wall_cement, dom.wall_sand].map((element) => element.textContent).join());
  wall_result = { length, height, openings, waste, piece_key, net_area_m2: result.net_area_m2, pieces, cement_bags, sand_m3: result.sand_m3 };
}

// El texto que se copia: una línea por material, para que se lea bien en un chat
function get_wall_text() {
  const { length, height, openings, waste, piece_key, net_area_m2, pieces, cement_bags, sand_m3 } = wall_result;
  const piece_label = dom.wall_piece.selectedOptions[0].textContent;
  const openings_text = openings > 0 ? `, menos ${format_number(openings, 2)} m² de puertas y ventanas` : "";
  return [
    `Muro de ${format_number(length, 2)} × ${format_number(height, 2)} m${openings_text} (área neta ${format_number(net_area_m2, 2)} m²)`,
    `${piece_label}, desperdicio ${format_number(waste, 2)} %`,
    `${dom.wall_pieces_name.textContent}: ${format_number(pieces, 0)} ${pieces === 1 ? "pieza" : "piezas"}`,
    `Cemento para la pega: ${format_number(cement_bags, 0)} ${cement_bags === 1 ? "bulto" : "bultos"} de 50 kg`,
    `Arena para la pega: ${format_cubic_meters(sand_m3)} m³`,
  ].join("\n");
}

const reset_copy_wall = setup_copy({
  button: dom.copy_wall_button,
  label: dom.copy_wall_label,
  idle_label: "Copiar lista",
  get_text: get_wall_text,
  get_fallback_node: () => document.getElementById("wall_result"),
});

// ---------------------------------------------------------------------------
// Concreto
// ---------------------------------------------------------------------------

function clear_concrete_result() {
  last_results.concrete = "";
  concrete_result = null;
  dom.concrete_volume.textContent = EMPTY_VALUE;
  clear_units(dom.concrete_cement, dom.concrete_cement_raw);
  [dom.concrete_sand, dom.concrete_gravel, dom.concrete_water].forEach((element) => (element.textContent = EMPTY_VALUE));
  dom.copy_concrete_button.disabled = true;
}

function update_concrete() {
  save_state();
  const mix_key = dom.concrete_mix.value;
  dom.concrete_mix_hint.textContent = CONCRETE_MIXES[mix_key].usage;
  reset_copy_concrete();

  const { values, is_ready } = read_fields(
    [
      { input: dom.concrete_length, parse: (text) => parse_decimal(text, { maximum: MAX_CONCRETE_SIDE_M, unit: "m", zero_message: "El largo debe ser mayor que 0." }) },
      { input: dom.concrete_width, parse: (text) => parse_decimal(text, { maximum: MAX_CONCRETE_SIDE_M, unit: "m", zero_message: "El ancho debe ser mayor que 0." }) },
      { input: dom.concrete_height, parse: (text) => parse_decimal(text, { maximum: MAX_CONCRETE_SIDE_M, unit: "m", zero_message: "El alto debe ser mayor que 0." }) },
      {
        input: dom.concrete_quantity,
        parse: (text) => parse_whole_number(text, { minimum: 1, maximum: MAX_CONCRETE_QUANTITY, unit: "piezas", minimum_message: "Mínimo 1 pieza." }),
      },
      { input: dom.concrete_waste, parse: parse_waste },
    ],
    dom.concrete_error,
  );
  const [length, width, height, quantity, waste] = values;

  if (!is_ready) {
    clear_concrete_result();
    return;
  }

  if (length * width * height * quantity > MAX_CONCRETE_VOLUME_M3) {
    [dom.concrete_length, dom.concrete_width, dom.concrete_height, dom.concrete_quantity].forEach((input) => mark_invalid(input, true));
    show_error(dom.concrete_error, `El volumen no puede pasar de ${format_number(MAX_CONCRETE_VOLUME_M3, 0)}${NBSP}m³.`);
    clear_concrete_result();
    return;
  }

  const result = calculate_concrete(length, width, height, quantity, mix_key, waste);
  const cement_bags = show_units(dom.concrete_cement, dom.concrete_cement_unit, dom.concrete_cement_raw, result.cement_bags, "bulto de 50 kg", "bultos de 50 kg");
  dom.concrete_volume.textContent = format_volume(result.volume_m3);
  dom.concrete_sand.textContent = format_cubic_meters(result.sand_m3);
  dom.concrete_gravel.textContent = format_cubic_meters(result.gravel_m3);
  dom.concrete_water.textContent = format_number(Math.round(result.water_liters), 0);
  dom.copy_concrete_button.disabled = false;
  announce_result("concrete", [dom.concrete_cement, dom.concrete_sand, dom.concrete_gravel, dom.concrete_water].map((element) => element.textContent).join());
  concrete_result = { length, width, height, quantity, waste, mix_key, volume_m3: result.volume_m3, cement_bags, sand_m3: result.sand_m3, gravel_m3: result.gravel_m3, water_liters: result.water_liters };
}

function get_concrete_text() {
  const { length, width, height, quantity, waste, volume_m3, cement_bags, sand_m3, gravel_m3, water_liters } = concrete_result;
  const mix_label = dom.concrete_mix.selectedOptions[0].textContent;
  return [
    `Concreto: ${format_number(quantity, 0)} ${quantity === 1 ? "pieza" : "piezas"} de ${format_number(length, 2)} × ${format_number(width, 2)} × ${format_number(height, 2)} m`,
    `Dosificación ${mix_label}, desperdicio ${format_number(waste, 2)} %`,
    `Volumen: ${format_volume(volume_m3)}`,
    `Cemento: ${format_number(cement_bags, 0)} ${cement_bags === 1 ? "bulto" : "bultos"} de 50 kg`,
    `Arena: ${format_cubic_meters(sand_m3)} m³`,
    `Grava: ${format_cubic_meters(gravel_m3)} m³`,
    `Agua: ${format_number(Math.round(water_liters), 0)} litros`,
  ].join("\n");
}

const reset_copy_concrete = setup_copy({
  button: dom.copy_concrete_button,
  label: dom.copy_concrete_label,
  idle_label: "Copiar lista",
  get_text: get_concrete_text,
  get_fallback_node: () => document.getElementById("concrete_result"),
});

// ---------------------------------------------------------------------------
// Ayuda para calcular un área a partir de las medidas (pañete y piso)
// ---------------------------------------------------------------------------

// specs son los campos de la ayuda; compute recibe sus valores y devuelve { area } o { error, invalid_inputs }.
// "Usar esta área" la escribe en el campo de área, cierra la ayuda y deja el foco en ese campo.
function setup_area_helper({ specs, compute, area_element, error_element, use_button, target_input, update_target }) {
  let helper_area = null;

  function update() {
    const { values, is_ready } = read_fields(specs, error_element);
    helper_area = null;
    area_element.textContent = EMPTY_VALUE;
    use_button.disabled = true;
    if (!is_ready) return;

    const outcome = compute(values);
    if (outcome.error) {
      outcome.invalid_inputs.forEach((input) => mark_invalid(input, true));
      show_error(error_element, outcome.error);
      return;
    }
    helper_area = outcome.area;
    area_element.textContent = format_area(helper_area);
    use_button.disabled = false;
  }

  specs.forEach(({ input }) => input.addEventListener("input", update));
  use_button.addEventListener("click", () => {
    target_input.value = format_number(helper_area, 2);
    update_target();
    use_button.closest("details").open = false;
    target_input.focus();
  });
  update();
}

// ---------------------------------------------------------------------------
// Pañete y pintura
// ---------------------------------------------------------------------------

// "Equivale a 2 cuñetes de 5 galones y 3 galones." Solo cuando pasa de un cuñete.
function describe_buckets(gallons) {
  if (gallons <= PAINT_BUCKET_GALLONS) return "";
  const buckets = Math.floor(gallons / PAINT_BUCKET_GALLONS);
  const remaining_gallons = gallons % PAINT_BUCKET_GALLONS;
  const buckets_text = `${buckets} ${buckets === 1 ? "cuñete" : "cuñetes"} de ${PAINT_BUCKET_GALLONS} galones`;
  const gallons_text = remaining_gallons ? ` y ${remaining_gallons} ${remaining_gallons === 1 ? "galón" : "galones"}` : "";
  return `Equivale a ${buckets_text}${gallons_text}.`;
}

function clear_finish_result() {
  last_results.finish = "";
  finish_result = null;
  clear_units(dom.finish_cement, dom.finish_cement_raw);
  dom.finish_sand.textContent = EMPTY_VALUE;
  clear_units(dom.finish_paint, dom.finish_paint_raw);
  dom.finish_buckets.hidden = true;
  dom.copy_finish_button.disabled = true;
}

function update_finish() {
  save_state();
  const include_plaster = dom.finish_include_plaster.checked;
  const include_paint = dom.finish_include_paint.checked;
  // Lo que no se calcula no se pide: sus campos quedan desactivados y no se validan
  dom.finish_thickness.disabled = !include_plaster;
  dom.finish_coats.disabled = !include_paint;
  dom.finish_yield.disabled = !include_paint;
  dom.finish_plaster_group.hidden = !include_plaster;
  dom.finish_paint_group.hidden = !include_paint;
  reset_copy_finish();

  const skip = () => ({});
  const { values, is_ready } = read_fields(
    [
      { input: dom.finish_area, parse: (text) => parse_decimal(text, { maximum: MAX_FINISH_AREA_M2, unit: "m²", zero_message: "El área debe ser mayor que 0." }) },
      {
        input: dom.finish_thickness,
        parse: include_plaster ? (text) => parse_decimal(text, { maximum: MAX_PLASTER_THICKNESS_CM, unit: "cm", zero_message: "El espesor debe ser mayor que 0." }) : skip,
      },
      {
        input: dom.finish_coats,
        parse: include_paint ? (text) => parse_whole_number(text, { minimum: 1, maximum: MAX_PAINT_COATS, unit: "manos", minimum_message: "Mínimo 1 mano." }) : skip,
      },
      {
        input: dom.finish_yield,
        parse: include_paint ? (text) => parse_decimal(text, { maximum: MAX_PAINT_YIELD_M2_PER_GALLON, unit: "m²/gal", zero_message: "El rendimiento debe ser mayor que 0." }) : skip,
      },
      { input: dom.finish_waste, parse: parse_waste },
    ],
    dom.finish_error,
  );
  const [area, thickness, coats, yield_per_gallon, waste] = values;

  if (!include_plaster && !include_paint) {
    show_error(dom.finish_error, "Marca pañete, pintura o los dos.");
    clear_finish_result();
    return;
  }
  if (!is_ready) {
    clear_finish_result();
    return;
  }

  finish_result = { area, thickness, coats, yield_per_gallon, waste, include_plaster, include_paint, cement_bags: 0, sand_m3: 0, gallons: 0 };
  if (include_plaster) {
    const plaster = calculate_plaster(area, thickness, waste);
    finish_result.cement_bags = show_units(dom.finish_cement, dom.finish_cement_unit, dom.finish_cement_raw, plaster.cement_bags, "bulto de 50 kg", "bultos de 50 kg");
    finish_result.sand_m3 = plaster.sand_m3;
    dom.finish_sand.textContent = format_cubic_meters(plaster.sand_m3);
  }
  if (include_paint) {
    const paint = calculate_paint(area, coats, yield_per_gallon, waste);
    finish_result.gallons = show_units(dom.finish_paint, dom.finish_paint_unit, dom.finish_paint_raw, paint.gallons, "galón", "galones");
    const buckets_text = describe_buckets(finish_result.gallons);
    dom.finish_buckets.textContent = buckets_text;
    dom.finish_buckets.hidden = !buckets_text;
  }
  dom.copy_finish_button.disabled = false;
  announce_result("finish", [dom.finish_cement, dom.finish_sand, dom.finish_paint].map((element) => element.textContent).join() + include_plaster + include_paint);
}

function get_finish_text() {
  const { area, thickness, coats, yield_per_gallon, waste, include_plaster, include_paint, cement_bags, sand_m3, gallons } = finish_result;
  const jobs = [include_plaster && "Pañete", include_paint && (include_plaster ? "pintura" : "Pintura")].filter(Boolean).join(" y ");
  const lines = [`${jobs} de ${format_number(area, 2)} m² de paredes, desperdicio ${format_number(waste, 2)} %`];
  if (include_plaster) {
    lines.push(
      `Cemento para el pañete (${format_number(thickness, 2)} cm): ${format_number(cement_bags, 0)} ${cement_bags === 1 ? "bulto" : "bultos"} de 50 kg`,
      `Arena para el pañete: ${format_cubic_meters(sand_m3)} m³`,
    );
  }
  if (include_paint) {
    const buckets_text = describe_buckets(gallons);
    lines.push(
      `Pintura (${format_number(coats, 0)} ${coats === 1 ? "mano" : "manos"}, rinde ${format_number(yield_per_gallon, 2)} m² por galón): ${format_number(gallons, 0)} ${gallons === 1 ? "galón" : "galones"}${buckets_text ? `. ${buckets_text}` : ""}`,
    );
  }
  return lines.join("\n");
}

const reset_copy_finish = setup_copy({
  button: dom.copy_finish_button,
  label: dom.copy_finish_label,
  idle_label: "Copiar lista",
  get_text: get_finish_text,
  get_fallback_node: () => document.getElementById("finish_result"),
});

// ---------------------------------------------------------------------------
// Piso
// ---------------------------------------------------------------------------

function clear_floor_result() {
  last_results.floor = "";
  floor_result = null;
  clear_units(dom.floor_pieces, dom.floor_pieces_raw);
  clear_units(dom.floor_boxes, dom.floor_boxes_raw);
  clear_units(dom.floor_glue, dom.floor_glue_raw);
  clear_units(dom.floor_grout, dom.floor_grout_raw);
  dom.copy_floor_button.disabled = true;
}

function update_floor() {
  save_state();
  const tile_key = dom.floor_tile.value;
  const is_custom_tile = tile_key === "custom";
  dom.floor_custom_tile.hidden = !is_custom_tile;
  reset_copy_floor();

  const skip = () => ({});
  const parse_tile_side = (zero_message) => (text) => parse_decimal(text, { maximum: MAX_TILE_SIDE_CM, unit: "cm", zero_message });
  const { values, is_ready } = read_fields(
    [
      { input: dom.floor_area, parse: (text) => parse_decimal(text, { maximum: MAX_FLOOR_AREA_M2, unit: "m²", zero_message: "El área debe ser mayor que 0." }) },
      { input: dom.floor_tile_width, parse: is_custom_tile ? parse_tile_side("El ancho de la baldosa debe ser mayor que 0.") : skip },
      { input: dom.floor_tile_length, parse: is_custom_tile ? parse_tile_side("El largo de la baldosa debe ser mayor que 0.") : skip },
      { input: dom.floor_thickness, parse: (text) => parse_decimal(text, { maximum: MAX_TILE_THICKNESS_MM, unit: "mm", zero_message: "El espesor debe ser mayor que 0." }) },
      { input: dom.floor_joint, parse: (text) => parse_decimal(text, { maximum: MAX_JOINT_MM, unit: "mm" }) },
      { input: dom.floor_box, parse: (text) => parse_decimal(text, { maximum: MAX_BOX_AREA_M2, unit: "m²", zero_message: "Los m² de la caja deben ser más de 0." }) },
      { input: dom.floor_waste, parse: parse_waste },
    ],
    dom.floor_error,
  );
  const [area, custom_width, custom_length, thickness, joint, box_area, waste] = values;

  if (!is_ready) {
    clear_floor_result();
    return;
  }

  const tile = is_custom_tile ? { width_cm: custom_width, length_cm: custom_length } : FLOOR_TILES[tile_key];
  const result = calculate_floor(area, tile.width_cm, tile.length_cm, thickness, joint, box_area, waste);
  const pieces = show_units(dom.floor_pieces, dom.floor_pieces_unit, dom.floor_pieces_raw, result.pieces, "pieza", "piezas");
  const boxes = show_units(dom.floor_boxes, dom.floor_boxes_unit, dom.floor_boxes_raw, result.boxes, "caja", "cajas");
  const glue_bags = show_units(dom.floor_glue, dom.floor_glue_unit, dom.floor_glue_raw, result.glue_bags, `bulto de ${GLUE_BAG_KG} kg`, `bultos de ${GLUE_BAG_KG} kg`);
  const grout_kg = show_units(dom.floor_grout, null, dom.floor_grout_raw, result.grout_kg, "", "", GROUT_DECIMALS);
  dom.copy_floor_button.disabled = false;
  announce_result("floor", [dom.floor_pieces, dom.floor_boxes, dom.floor_glue, dom.floor_grout].map((element) => element.textContent).join());
  floor_result = { area, tile, thickness, joint, box_area, waste, pieces, boxes, glue_bags, grout_kg };
}

// Al cambiar la forma de instalar se propone su desperdicio; después se puede ajustar a mano.
function apply_floor_layout() {
  dom.floor_waste.value = String(FLOOR_LAYOUT_WASTE_PERCENT[dom.floor_layout.value]);
  update_floor();
}

function get_floor_text() {
  const { area, tile, thickness, joint, box_area, waste, pieces, boxes, glue_bags, grout_kg } = floor_result;
  return [
    `Piso de ${format_number(area, 2)} m², baldosa de ${format_number(tile.width_cm, 2)} × ${format_number(tile.length_cm, 2)} cm`,
    `Espesor ${format_number(thickness, 2)} mm, junta ${format_number(joint, 2)} mm, desperdicio ${format_number(waste, 2)} %`,
    `Baldosas: ${format_number(pieces, 0)} ${pieces === 1 ? "pieza" : "piezas"}`,
    `Cajas de ${format_number(box_area, 2)} m²: ${format_number(boxes, 0)} ${boxes === 1 ? "caja" : "cajas"}`,
    `Pegante: ${format_number(glue_bags, 0)} ${glue_bags === 1 ? "bulto" : "bultos"} de ${GLUE_BAG_KG} kg`,
    `Boquilla: ${format_number(grout_kg, GROUT_DECIMALS)} kg`,
  ].join("\n");
}

const reset_copy_floor = setup_copy({
  button: dom.copy_floor_button,
  label: dom.copy_floor_label,
  idle_label: "Copiar lista",
  get_text: get_floor_text,
  get_fallback_node: () => document.getElementById("floor_result"),
});

// ---------------------------------------------------------------------------
// Memoria de los últimos valores
// ---------------------------------------------------------------------------

// Las casillas se guardan como "true" o "false"; el resto de campos, con su texto
function read_field_value(id) {
  return dom[id].type === "checkbox" ? String(dom[id].checked) : dom[id].value.slice(0, MAX_FIELD_LENGTH);
}

function write_field_value(id, value) {
  if (dom[id].type === "checkbox") dom[id].checked = value === "true";
  else dom[id].value = value;
}

function get_current_job() {
  const active_tab = dom.tabs.find((tab) => tab.getAttribute("aria-selected") === "true");
  return active_tab ? active_tab.dataset.job : DEFAULT_JOB;
}

// Acepta solo valores válidos de lo guardado: si alguien lo editó a mano, se usan los iniciales.
function sanitize_state(stored) {
  const jobs = dom.tabs.map((tab) => tab.dataset.job);
  const fields = {};
  FIELD_IDS.forEach((id) => {
    const value = stored?.fields?.[id];
    if (typeof value !== "string" || value.length > MAX_FIELD_LENGTH) return;
    const input = dom[id];
    // En las listas desplegables solo vale una opción que exista, y en las casillas, sí o no
    if (input.tagName === "SELECT" && ![...input.options].some((option) => option.value === value)) return;
    if (input.type === "checkbox" && value !== "true" && value !== "false") return;
    fields[id] = value;
  });
  return { job: jobs.includes(stored?.job) ? stored.job : DEFAULT_JOB, fields };
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
  const state = { job: get_current_job(), fields: Object.fromEntries(FIELD_IDS.map((id) => [id, read_field_value(id)])) };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Sin almacenamiento los valores solo duran mientras la página está abierta.
  }
}

// ---------------------------------------------------------------------------
// Pestañas
// ---------------------------------------------------------------------------

function select_job(job_key) {
  dom.tabs.forEach((tab) => {
    const is_active = tab.dataset.job === job_key;
    tab.setAttribute("aria-selected", String(is_active));
    // Solo la pestaña activa entra en el orden de Tab; con las flechas se pasa a las demás.
    tab.tabIndex = is_active ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !is_active;
  });
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
  select_job(dom.tabs[next_index].dataset.job);
  dom.tabs[next_index].focus();
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

function setup_events() {
  dom.tabs.forEach((tab) => tab.addEventListener("click", () => select_job(tab.dataset.job)));
  dom.tab_list.addEventListener("keydown", handle_tab_keydown);

  JOB_FIELD_IDS.wall.forEach((id) => dom[id].addEventListener("input", update_wall));
  JOB_FIELD_IDS.concrete.forEach((id) => dom[id].addEventListener("input", update_concrete));
  JOB_FIELD_IDS.finish.forEach((id) => dom[id].addEventListener("input", update_finish));
  // El desperdicio del piso lo escribe la persona; la forma de instalar solo lo propone
  JOB_FIELD_IDS.floor.filter((id) => id !== "floor_layout").forEach((id) => dom[id].addEventListener("input", update_floor));
  dom.floor_layout.addEventListener("input", apply_floor_layout);

  const parse_helper_side = (zero_message) => (text) => parse_decimal(text, { maximum: MAX_WALL_SIDE_M, unit: "m", zero_message });
  setup_area_helper({
    specs: [
      { input: dom.finish_helper_length, parse: parse_helper_side("El largo debe ser mayor que 0.") },
      { input: dom.finish_helper_height, parse: parse_helper_side("El alto debe ser mayor que 0.") },
      { input: dom.finish_helper_openings, parse: (text) => parse_decimal(text, { maximum: MAX_WALL_OPENINGS_M2, unit: "m²" }) },
    ],
    compute: ([length, height, openings]) => {
      if (length * height > MAX_FINISH_AREA_M2) {
        return { error: `El área no puede pasar de ${format_number(MAX_FINISH_AREA_M2, 0)}${NBSP}m².`, invalid_inputs: [dom.finish_helper_length, dom.finish_helper_height] };
      }
      if (openings >= length * height) return { error: "Las puertas y ventanas deben ser menores que el área de las paredes.", invalid_inputs: [dom.finish_helper_openings] };
      return { area: length * height - openings };
    },
    area_element: dom.finish_helper_area,
    error_element: dom.finish_helper_error,
    use_button: dom.finish_helper_use,
    target_input: dom.finish_area,
    update_target: update_finish,
  });
  setup_area_helper({
    specs: [
      { input: dom.floor_helper_length, parse: parse_helper_side("El largo debe ser mayor que 0.") },
      { input: dom.floor_helper_width, parse: parse_helper_side("El ancho debe ser mayor que 0.") },
    ],
    compute: ([length, width]) => {
      if (length * width > MAX_FLOOR_AREA_M2) {
        return { error: `El área no puede pasar de ${format_number(MAX_FLOOR_AREA_M2, 0)}${NBSP}m².`, invalid_inputs: [dom.floor_helper_length, dom.floor_helper_width] };
      }
      return { area: length * width };
    },
    area_element: dom.floor_helper_area,
    error_element: dom.floor_helper_error,
    use_button: dom.floor_helper_use,
    target_input: dom.floor_area,
    update_target: update_floor,
  });
}

const saved_state = load_state();
Object.entries(saved_state.fields).forEach(([id, value]) => write_field_value(id, value));
setup_events();
update_wall();
update_concrete();
update_finish();
update_floor();
select_job(saved_state.job);
// El fondo es decorativo: se prepara sin esperar y la calculadora ya funciona mientras carga.
start_scene(document.getElementById("scene_canvas"));
