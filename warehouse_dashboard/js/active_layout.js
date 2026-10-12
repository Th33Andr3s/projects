// La distribución del activo: qué producto se guarda en cada piso del multinivel y qué parte del piso ocupa. Cada piso tiene dos
// racks (A atrás y B adelante) que se cuentan como un solo tramo seguido; cada producto de un piso toma un pedazo de ese tramo
// proporcional a su porcentaje. Un producto puede estar en más de un piso. Son datos y cuentas puras (sin Three.js).
//
// El dibujo del activo es representativo: un estante tiene pocas casillas visibles y mucha mercancía contable. Por eso cada tramo
// tiene un número fijo de casillas dibujadas (`slots`) y la cantidad de cajas que hay decide cuántas de ellas se ven llenas.

import { FLOOR_COUNT } from "./config.js";
import { SKUS, catalog_to_json } from "./catalog.js";
import { ACTIVE, floor_y } from "./layout.js";

// Altura de cada estante sobre la losa, y lo que ocupa cada casilla a lo largo del rack
const SHELF_TOPS = [0.7, 1.45, 2.2];
const COLUMN_PITCH = 0.69;
// Cuánto se aleja el pasillo de picking de cada rack, a lado y lado de la banda del piso
const AISLE_OFFSET = 2.8;
const RACK_LENGTH = ACTIVE.x1 - ACTIVE.x0;

// Reparte una lista de claves en bloques seguidos entre los pisos (con 20 productos y 8 pisos, cuatro pisos llevan 3 y cuatro llevan 2),
// y cada piso reparte su espacio en partes iguales (la sobra del redondeo va al primero)
function distribute_keys(keys) {
  const base = Math.floor(keys.length / FLOOR_COUNT);
  const extra = keys.length % FLOOR_COUNT;
  const allocation = [];
  let cursor = 0;
  for (let floor = 0; floor < FLOOR_COUNT; floor += 1) {
    const size = base + (floor < extra ? 1 : 0);
    const floor_keys = keys.slice(cursor, cursor + size);
    cursor += size;
    allocation.push(equal_shares(floor_keys));
  }
  return allocation;
}

// Los porcentajes de un piso en partes iguales: enteros que suman 100
export function equal_shares(keys) {
  const share = keys.length > 0 ? Math.floor(100 / keys.length) : 0;
  return keys.map((key, index) => ({ key, percent: share + (index === 0 ? 100 - share * keys.length : 0) }));
}

// La distribución de fábrica para un catálogo: los productos, ordenados por categoría, repartidos en bloques entre los pisos
export function default_allocation_json(catalog) {
  const category_order = new Map(catalog.categories.map((category, index) => [category.key, index]));
  const keys = catalog.products
    .map((product, index) => ({ product, index }))
    .sort((first, second) => category_order.get(first.product.category) - category_order.get(second.product.category) || first.index - second.index)
    .map((entry) => entry.product.key);
  return distribute_keys(keys);
}

// La distribución de fábrica del catálogo actual, con el número de cada producto
export function default_allocation() {
  const by_key = new Map(SKUS.map((sku) => [sku.key, sku.id]));
  return default_allocation_json(catalog_to_json()).map((entries) => entries.map((entry) => ({ sku_id: by_key.get(entry.key), percent: entry.percent })));
}

// La distribución guardada en el navegador usa la clave de cada producto (no su número, que cambia al borrar uno). Lo que no se
// reconoce se descarta; si no queda nada, se usa la de fábrica.
export function allocation_to_json(allocation) {
  return allocation.map((entries) => entries.map((entry) => ({ key: SKUS[entry.sku_id].key, percent: entry.percent })));
}

export function allocation_from_json(saved) {
  if (!Array.isArray(saved)) return default_allocation();
  const by_key = new Map(SKUS.map((sku) => [sku.key, sku.id]));
  let assigned = 0;
  const allocation = Array.from({ length: FLOOR_COUNT }, (_, floor) => {
    const seen = new Set();
    const entries = [];
    (Array.isArray(saved[floor]) ? saved[floor] : []).forEach((entry) => {
      const sku_id = entry && by_key.get(entry.key);
      if (sku_id === undefined || seen.has(sku_id) || !Number.isInteger(entry.percent) || entry.percent < 1 || entry.percent > 100) return;
      seen.add(sku_id);
      entries.push({ sku_id, percent: entry.percent });
    });
    assigned += entries.length;
    return entries;
  });
  return assigned > 0 ? allocation : default_allocation();
}

// Los tramos del activo, uno por producto y piso. El porcentaje de un piso que no suma 100 se reparte tal cual sobre el total
// que tenga, así el piso siempre se aprovecha completo.
export function build_segments(allocation) {
  const segments = [];
  allocation.forEach((entries, floor) => {
    const total = entries.reduce((sum, entry) => sum + entry.percent, 0);
    let cursor = 0;
    entries.forEach((entry) => {
      if (entry.percent <= 0 || total <= 0) return;
      const length = (entry.percent / total) * RACK_LENGTH * 2;
      const columns = Math.max(1, Math.floor(length / COLUMN_PITCH));
      segments.push({ floor, sku_id: entry.sku_id, percent: entry.percent, start: cursor, length, columns, slots: columns * SHELF_TOPS.length });
      cursor += length;
    });
  });
  return segments;
}

// Cuántas cajas caben en un tramo: su parte del piso (la capacidad del activo entre los pisos), por su porcentaje
export function segment_capacity(segment, active_capacity) {
  return Math.max(1, Math.round(((active_capacity / FLOOR_COUNT) * segment.percent) / 100));
}

// Cuántas casillas dibujadas se ven llenas con `count` cajas de `capacity`
export function visible_slots(segment, count, capacity) {
  if (count <= 0) return 0;
  return Math.min(segment.slots, Math.max(1, Math.ceil((count * segment.slots) / Math.max(capacity, count))));
}

// Dónde está la casilla dibujada número `slot` de un tramo: llena primero el estante de abajo, de izquierda a derecha
export function slot_position(segment, slot) {
  const column = slot % segment.columns;
  const shelf = Math.floor(slot / segment.columns) % SHELF_TOPS.length;
  const along = segment.start + ((column + 0.5) * segment.length) / segment.columns;
  const rack = along < RACK_LENGTH ? 0 : 1;
  return {
    x: ACTIVE.x0 + (along - rack * RACK_LENGTH),
    y: floor_y(segment.floor) + ACTIVE.slab_thickness + SHELF_TOPS[shelf],
    z: rack === 0 ? ACTIVE.rack_a_z : ACTIVE.rack_b_z,
    // Dónde se para quien recoge: el pasillo, del lado del rack en que está la casilla
    aisle_z: rack === 0 ? ACTIVE.belt_z - AISLE_OFFSET : ACTIVE.belt_z + AISLE_OFFSET,
  };
}

// Los pedazos de rack que ocupa un tramo, para pintar su franja de color: uno si cabe en un rack, dos si cruza del A al B
export function segment_pieces(segment) {
  const end = segment.start + segment.length;
  const pieces = [];
  if (segment.start < RACK_LENGTH) pieces.push({ z: ACTIVE.rack_a_z, x0: ACTIVE.x0 + segment.start, x1: ACTIVE.x0 + Math.min(end, RACK_LENGTH) });
  if (end > RACK_LENGTH) pieces.push({ z: ACTIVE.rack_b_z, x0: ACTIVE.x0 + Math.max(segment.start, RACK_LENGTH) - RACK_LENGTH, x1: ACTIVE.x0 + end - RACK_LENGTH });
  return pieces;
}
