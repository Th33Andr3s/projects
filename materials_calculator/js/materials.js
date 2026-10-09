// Tablas de obra y fórmulas de cada trabajo: muro, concreto, pañete, pintura y piso. Son funciones puras: reciben
// números y devuelven cantidades sin redondear, sin tocar la pantalla. Así se pueden probar con valores conocidos
// (ver PLAN.md, sección 4.6) y ajustar los rendimientos en un solo lugar.
//
// Todos los valores son de referencia, los habituales en obras pequeñas en Colombia. Dependen del material, de la
// mano de obra y del proveedor, por eso la pantalla siempre avisa que son aproximados y deja editar el desperdicio.
// El redondeo hacia arriba a lo que se compra (bultos, cajas, galones) lo hace la pantalla, no este archivo.

const PERCENT = 100;
const SQUARE_CENTIMETERS_PER_SQUARE_METER = 10000;
const MILLIMETERS_PER_CENTIMETER = 10;

// ---------------------------------------------------------------------------
// Mortero (pega y pañete)
// ---------------------------------------------------------------------------

// Por metro cúbico de mortero 1:4, que es el habitual para pegar muros y para pañetar.
const MORTAR_1_4 = { cement_bags: 8, sand_m3: 1.1 };

function mortar_materials(volume_m3) {
  return { cement_bags: volume_m3 * MORTAR_1_4.cement_bags, sand_m3: volume_m3 * MORTAR_1_4.sand_m3 };
}

// ---------------------------------------------------------------------------
// Muro de ladrillo o bloque
// ---------------------------------------------------------------------------

// Junta entre piezas, en centímetros
const WALL_JOINT_CM = 1.5;

// Medidas de la cara que queda a la vista y espesor del muro, en centímetros
export const WALL_PIECES = {
  common_brick: { length_cm: 25, height_cm: 6.5, wall_thickness_cm: 12 },
  clay_block_4: { length_cm: 30, height_cm: 20, wall_thickness_cm: 10 },
  clay_block_5: { length_cm: 33, height_cm: 23, wall_thickness_cm: 12 },
  concrete_block_10: { length_cm: 40, height_cm: 20, wall_thickness_cm: 10 },
  concrete_block_15: { length_cm: 40, height_cm: 20, wall_thickness_cm: 15 },
};

// Piezas por metro cuadrado: cada pieza ocupa su cara más la junta.
function pieces_per_square_meter(piece) {
  return SQUARE_CENTIMETERS_PER_SQUARE_METER / ((piece.length_cm + WALL_JOINT_CM) * (piece.height_cm + WALL_JOINT_CM));
}

// Mortero de pega por metro cuadrado: lo que no ocupan las piezas, en todo el espesor del muro. Para los bloques
// huecos da un poco más del que se gasta de verdad, lo que va del lado de comprar de más.
function mortar_per_square_meter(piece) {
  const face_area_m2 = (piece.length_cm * piece.height_cm) / SQUARE_CENTIMETERS_PER_SQUARE_METER;
  return (piece.wall_thickness_cm / PERCENT) * (1 - pieces_per_square_meter(piece) * face_area_m2);
}

export function calculate_wall(length_m, height_m, openings_m2, piece_key, waste_percent) {
  const piece = WALL_PIECES[piece_key];
  const net_area_m2 = length_m * height_m - openings_m2;
  const waste_factor = 1 + waste_percent / PERCENT;
  const mortar_m3 = net_area_m2 * mortar_per_square_meter(piece) * waste_factor;
  return {
    net_area_m2,
    pieces: net_area_m2 * pieces_per_square_meter(piece) * waste_factor,
    mortar_m3,
    ...mortar_materials(mortar_m3),
  };
}

// ---------------------------------------------------------------------------
// Concreto
// ---------------------------------------------------------------------------

// Por metro cúbico de concreto. usage dice para qué sirve cada dosificación.
export const CONCRETE_MIXES = {
  mix_1_2_3: { cement_bags: 8.5, sand_m3: 0.55, gravel_m3: 0.8, water_liters: 190, usage: "Para losas, columnas y vigas: concreto de unos 21 MPa (3000 psi)." },
  mix_1_2_4: { cement_bags: 7, sand_m3: 0.55, gravel_m3: 0.9, water_liters: 180, usage: "Para vigas y zapatas corrientes: concreto de unos 17,5 MPa (2500 psi)." },
  mix_1_3_5: { cement_bags: 5, sand_m3: 0.6, gravel_m3: 0.95, water_liters: 170, usage: "Para pisos y solados: concreto de unos 14 MPa (2000 psi)." },
};

export function calculate_concrete(length_m, width_m, height_m, quantity, mix_key, waste_percent) {
  const mix = CONCRETE_MIXES[mix_key];
  const volume_m3 = length_m * width_m * height_m * quantity * (1 + waste_percent / PERCENT);
  return {
    volume_m3,
    cement_bags: volume_m3 * mix.cement_bags,
    sand_m3: volume_m3 * mix.sand_m3,
    gravel_m3: volume_m3 * mix.gravel_m3,
    water_liters: volume_m3 * mix.water_liters,
  };
}

// ---------------------------------------------------------------------------
// Pañete y pintura
// ---------------------------------------------------------------------------

// Un cuñete de pintura son 5 galones
export const PAINT_BUCKET_GALLONS = 5;

export function calculate_plaster(area_m2, thickness_cm, waste_percent) {
  const volume_m3 = area_m2 * (thickness_cm / PERCENT) * (1 + waste_percent / PERCENT);
  return { volume_m3, ...mortar_materials(volume_m3) };
}

// Rendimiento: metros cuadrados que cubre un galón en una mano, como dice el envase
export function calculate_paint(area_m2, coats, yield_m2_per_gallon, waste_percent) {
  return { gallons: ((area_m2 * coats) / yield_m2_per_gallon) * (1 + waste_percent / PERCENT) };
}

// ---------------------------------------------------------------------------
// Piso de baldosa
// ---------------------------------------------------------------------------

export const FLOOR_TILES = {
  tile_30_30: { width_cm: 30, length_cm: 30 },
  tile_33_33: { width_cm: 33, length_cm: 33 },
  tile_45_45: { width_cm: 45, length_cm: 45 },
  tile_60_60: { width_cm: 60, length_cm: 60 },
  tile_20_60: { width_cm: 20, length_cm: 60 },
};

// Desperdicio sugerido según cómo se instala la baldosa
export const FLOOR_LAYOUT_WASTE_PERCENT = { straight: 10, diagonal: 15 };

// Pegante: 5 kg por m² para baldosas de hasta 33 cm de lado y 6 kg por m² para las más grandes, en bultos de 25 kg
const SMALL_TILE_MAX_SIDE_CM = 33;
const GLUE_KG_PER_M2_SMALL_TILE = 5;
const GLUE_KG_PER_M2_LARGE_TILE = 6;
export const GLUE_BAG_KG = 25;
// Densidad de la boquilla (la lechada) en kilos por litro, de la fórmula habitual de los fabricantes
const GROUT_DENSITY_KG_PER_LITER = 1.6;

export function calculate_floor(area_m2, tile_width_cm, tile_length_cm, thickness_mm, joint_mm, box_area_m2, waste_percent) {
  const waste_factor = 1 + waste_percent / PERCENT;
  const tile_area_m2 = (tile_width_cm * tile_length_cm) / SQUARE_CENTIMETERS_PER_SQUARE_METER;
  const width_mm = tile_width_cm * MILLIMETERS_PER_CENTIMETER;
  const length_mm = tile_length_cm * MILLIMETERS_PER_CENTIMETER;
  // Boquilla por m² = (A + B) / (A × B) × espesor × junta × densidad, con los lados A y B en milímetros
  const grout_kg_per_m2 = ((width_mm + length_mm) / (width_mm * length_mm)) * thickness_mm * joint_mm * GROUT_DENSITY_KG_PER_LITER;
  const glue_kg_per_m2 = Math.max(tile_width_cm, tile_length_cm) <= SMALL_TILE_MAX_SIDE_CM ? GLUE_KG_PER_M2_SMALL_TILE : GLUE_KG_PER_M2_LARGE_TILE;
  return {
    pieces: (area_m2 * waste_factor) / tile_area_m2,
    boxes: (area_m2 * waste_factor) / box_area_m2,
    glue_bags: (area_m2 * glue_kg_per_m2 * waste_factor) / GLUE_BAG_KG,
    grout_kg: area_m2 * grout_kg_per_m2 * waste_factor,
  };
}
