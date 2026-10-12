// La tabla de la bodega: dónde está cada zona, muelle, rack, piso, banda, muro, estación y puerta. Todas las medidas están
// aquí, en metros, y no repartidas por el código. Son números puros (sin Three.js), así se pueden probar con Node.
//
// Sistema de coordenadas: x crece hacia la derecha (el flujo va de izquierda a derecha), z crece hacia "delante" (hacia
// quien mira) e y hacia arriba. El origen está en el centro del recorrido.
//
// Los muelles de recepción son siempre 10. Las cantidades que la persona cambia con sliders (puertas, muros, casillas,
// estaciones) entran a `build_layout` y el diseño las acomoda; el resto es fijo.

import { DOCK_COUNT, FLOOR_COUNT, PARAMETERS, SKU_COUNT, SKUS_PER_FLOOR, sku_floor } from "./config.js";
import { make_path } from "./path_tools.js";
import { Rng } from "./rng.js";

// ---- Terreno, predio y edificio ----
// El terreno es enorme (las carreteras salen de la pantalla en cualquier equipo); SITE es lo que se encuadra al inicio y por
// donde se mueve la cámara: el predio con su carretera perimetral, y los clientes al norte.
export const WORLD = { half_size: 900 };
export const SITE = { x0: -145, x1: 129, z0: -80, z1: 58 };
// El predio es un rectángulo cerrado con vallas de alambre; solo se entra por las dos garitas con talanquera
export const COMPOUND = { x0: -126, x1: 110, z0: -40, z1: 40 };
export const BUILDING = { x0: -53, x1: 78, z0: -30, z1: 30 };
// Los muros del edificio son bajos (corte de maqueta) para que nunca tapen lo de adentro, gire como gire la cámara
export const BUILDING_WALL_HEIGHT = 1.4;
// La altura a la que van las bandas sobre el piso de cada nivel
export const BELT_HEIGHT = 0.9;

// ---- Carreteras ----
// La carretera perimetral rodea la valla a RING_OFFSET metros; cuatro carreteras salen de ella hasta el borde del mundo. Los
// camiones de recibo llegan y se van por la del oeste; los de despacho, por la del este. Se maneja por la derecha.
export const ROAD_WIDTH = 10;
export const RING_OFFSET = 14;
export const ROAD_END = 420;
export const ROAD_NORTH_SOUTH_X = -60;
// Por dónde llegan y salen los camiones, a lo largo de x, cuando no están en una garita
export const ROAD_SPAWN_X = 400;

// Cada garita: la talanquera está en `x` y cada carril tiene el punto donde el camión se detiene antes de la talanquera
export const GATES = {
  west: { id: "west", label: "Entrada de camiones", x: COMPOUND.x0, in_lane_z: 3.5, out_lane_z: -3.5, in_stop_x: COMPOUND.x0 - 7, out_stop_x: COMPOUND.x0 + 7 },
  east: { id: "east", label: "Acceso de despacho", x: COMPOUND.x1, in_lane_z: -3.5, out_lane_z: 3.5, in_stop_x: COMPOUND.x1 + 7, out_stop_x: COMPOUND.x1 - 7 },
};

// ---- Zonas con letrero ----
// kind: indoor (bajo techo), yard (patio de asfalto), gate (garita) o customers (afuera, fuera del predio).
// sign: dónde queda el poste del letrero (x, z) y a qué altura (y) flota el rótulo. priority: si dos rótulos se pisan en
// pantalla, el de mayor prioridad se queda donde está y el otro se corre hacia arriba.
export const ZONES = [
  { id: "gate_west", label: "Entrada de camiones", kind: "gate", priority: 3, x0: -138, x1: -118, z0: -8, z1: 8, sign: { x: -131, z: -9, y: 7 } },
  { id: "parking", label: "Parqueadero de camiones", kind: "yard", priority: 8, x0: -124, x1: -86, z0: -24, z1: 24, sign: { x: -105, z: 25, y: 7 } },
  { id: "yard", label: "Patio de recibo y muelles", kind: "yard", priority: 9, x0: -86, x1: -53, z0: -38, z1: 38, sign: { x: -70, z: -36, y: 8 } },
  { id: "receiving", label: "Recibo (rieles)", kind: "indoor", priority: 9, x0: -53, x1: -39, z0: -30, z1: 25, sign: { x: -46, z: 0, y: 5 } },
  { id: "reserve", label: "Racks de reserva", kind: "indoor", priority: 11, x0: -39, x1: -13, z0: -30, z1: 4, sign: { x: -26, z: -23, y: 9 } },
  { id: "active", label: "Multinivel activo", kind: "indoor", priority: 12, x0: -9, x1: 19, z0: -23, z1: -9, sign: { x: 5, z: -25, y: 19 } },
  { id: "staging", label: "Bodega de recibo (stock)", kind: "indoor", priority: 10, x0: -38, x1: -4, z0: 8, z1: 24.5, sign: { x: -21, z: 9, y: 7 } },
  { id: "workshop", label: "Taller de montacargas", kind: "indoor", priority: 3, x0: -52, x1: -19, z0: 26, z1: 29.8, sign: { x: -35.5, z: 27.9, y: 4 } },
  { id: "walls", label: "Muros de consolidación", kind: "indoor", priority: 10, x0: 24, x1: 40, z0: -30, z1: 30, sign: { x: 38, z: -26, y: 11 } },
  { id: "packing", label: "Empaque", kind: "indoor", priority: 7, x0: 40, x1: 56, z0: -30, z1: 30, sign: { x: 53, z: -26, y: 5 } },
  { id: "dispatch", label: "Despacho y puertas", kind: "indoor", priority: 6, x0: 56, x1: 78, z0: -30, z1: 30, sign: { x: 66, z: -26, y: 10 } },
  { id: "exit_yard", label: "Patio de salida", kind: "yard", priority: 5, x0: 78, x1: 108, z0: -38, z1: 38, sign: { x: 92, z: 30, y: 6 } },
  { id: "gate_east", label: "Acceso de despacho", kind: "gate", priority: 2, x0: 100, x1: 120, z0: -8, z1: 8, sign: { x: 114, z: 9, y: 7 } },
  { id: "customers", label: "Clientes / e-commerce", kind: "customers", priority: 4, x0: 0, x1: 48, z0: -76, z1: -62, sign: { x: 24, z: -69, y: 7 } },
];

// ---- Bodega de recibo (stock) ----
// Una sala grande al sur de los racks, pegada a los rieles de los muelles. Toda la mercancía que baja de los camiones llega aquí en
// pallets de descarga (las montacargas de muelle a stock) y de aquí se arman los pallets y las cubetas que llevan las montacargas de
// stock a los racks y al multinivel. Una pila por producto: una fila por categoría (el piso del activo) y una columna por producto.
// Al norte de las pilas hay una franja de armado con los puestos de pallets y de cubetas.
export const STAGING = { x0: -38, x1: -4, z0: 8, z1: 24.5, columns: 4, rows: 5, pitch_x: 8.2, pitch_z: 2.4, pile_width: 3.4, pile_depth: 2.2, first_x: -33.4, first_z: 13.2 };
export function staging_slot(sku_id) {
  const row = sku_id % STAGING.rows;
  const column = Math.floor(sku_id / STAGING.rows);
  return { x: STAGING.first_x + column * STAGING.pitch_x, z: STAGING.first_z + row * STAGING.pitch_z };
}
// La franja de armado (norte de la bodega): diez puestos de pallet y cinco de cubeta, en una sola fila
export const ARMADO_Z = 9.4;
export const PALLET_SPOTS = Array.from({ length: 10 }, (_, index) => ({ x: -36.6 + index * 2.1, z: ARMADO_Z }));
export const TOTE_STATIONS = Array.from({ length: 5 }, (_, index) => ({ x: -15.6 + index * 2.1, z: ARMADO_Z }));
// Los andenes donde las montacargas de muelle a stock descargan, sobre la pared oeste de la bodega
export const UNLOAD_BAYS = [13.2, 15.6, 18, 20.4, 22.8].map((z) => ({ x: -36.8, z }));

// ---- Pilas de despacho por destino ----
// Los paquetes empacados esperan su corte en una pila por ciudad de destino, en la zona de despacho entre la banda y las puertas:
// tres columnas por nueve filas, con las ciudades en el orden del catálogo (por región).
export const DISPATCH_BINS = { columns: 3, rows: 9, first_x: 62.5, pitch_x: 5, first_z: -24, pitch_z: 6, size: 3.6 };
export function dispatch_bin_slot(index) {
  const column = Math.floor(index / DISPATCH_BINS.rows);
  const row = index % DISPATCH_BINS.rows;
  return { x: DISPATCH_BINS.first_x + column * DISPATCH_BINS.pitch_x, z: DISPATCH_BINS.first_z + row * DISPATCH_BINS.pitch_z };
}

// ---- Reserva (racks de pallets) ----
export const RESERVE = {
  x0: -38.5,
  bay_width: 1.95,
  bays_per_row: 13,
  // Cada fila es un rack doble (dos caras espalda con espalda); la fila se identifica por el centro en z
  row_z: [-26, -20, -14, -8],
  sides: 2,
  side_offset: 0.65,
  rack_depth: 1.1,
  levels: 4,
  level_height: 1.5,
  // Altura del primer larguero; el pallet se apoya encima
  first_level_y: 0.3,
};

export const RESERVE_POSITION_COUNT = RESERVE.row_z.length * RESERVE.sides * RESERVE.bays_per_row * RESERVE.levels;

// Las ubicaciones de la reserva, una por pallet, en el orden en que se van llenando: primero la fila de adelante (la que mejor
// se ve), cara por cara, de recibo hacia el fondo, y de abajo hacia arriba en cada hueco.
export function reserve_positions() {
  const positions = [];
  for (let row = RESERVE.row_z.length - 1; row >= 0; row -= 1) {
    for (let side = 0; side < RESERVE.sides; side += 1) {
      for (let bay = 0; bay < RESERVE.bays_per_row; bay += 1) {
        for (let level = 0; level < RESERVE.levels; level += 1) {
          positions.push({
            index: positions.length,
            row,
            side,
            bay,
            level,
            x: RESERVE.x0 + (bay + 0.5) * RESERVE.bay_width,
            y: RESERVE.first_level_y + level * RESERVE.level_height,
            z: RESERVE.row_z[row] + (side === 0 ? -RESERVE.side_offset : RESERVE.side_offset),
            // Desde dónde se accede: el pasillo hacia el que mira esa cara
            aisle_z: RESERVE.row_z[row] + (side === 0 ? -3 : 3),
          });
        }
      }
    }
  }
  return positions;
}

// ---- Activo multinivel ----
export const ACTIVE = {
  x0: -9,
  x1: 19,
  z0: -23,
  z1: -9,
  floors: FLOOR_COUNT,
  floor_height: 3.2,
  slab_thickness: 0.25,
  // La banda de cada piso corre por el pasillo central
  belt_z: -16,
  rack_a_z: -21.8,
  rack_b_z: -10.2,
  rack_depth: 1.2,
  rack_height: 2.2,
};

export function floor_y(floor) {
  return floor * ACTIVE.floor_height;
}

// Dónde se guarda un SKU en el activo: su piso (sku mod 5), el rack y el tramo de x que ocupa. Los cuatro SKU de un piso se
// reparten así: los dos primeros en el rack de atrás y los dos últimos en el de adelante, cada uno en la mitad de la longitud.
export function sku_anchor(sku_id) {
  const floor = sku_floor(sku_id);
  const order = Math.floor(sku_id / FLOOR_COUNT);
  const length = (ACTIVE.x1 - ACTIVE.x0) / 2;
  const column = order % 2;
  const x0 = ACTIVE.x0 + column * length;
  return {
    sku_id,
    floor,
    x0,
    x1: x0 + length,
    x: x0 + length / 2,
    y: floor_y(floor) + ACTIVE.slab_thickness,
    z: order < SKUS_PER_FLOOR / 2 ? ACTIVE.rack_a_z : ACTIVE.rack_b_z,
    // Dónde se para quien recoge: el pasillo, al lado del rack
    aisle_z: order < SKUS_PER_FLOOR / 2 ? ACTIVE.belt_z - 2.8 : ACTIVE.belt_z + 2.8,
  };
}

// ---- Elevador de cubetas y espiral ----
export const ELEVATOR = { x: -11.5, z: -16, size: 2.2, height: ACTIVE.floors * ACTIVE.floor_height + 2.2 };

export const SPIRAL = {
  center_x: 23.5,
  center_z: -16,
  radius: 2.6,
  turns: ACTIVE.floors - 1,
  segments_per_turn: 16,
  // Arriba, a la altura de la banda del último piso; abajo, a la altura de la banda a nivel de piso
  top_y: floor_y(ACTIVE.floors - 1) + BELT_HEIGHT,
  bottom_y: BELT_HEIGHT,
};

// Un punto de la espiral: t va de 0 (arriba) a 1 (abajo). Empieza y termina del lado oeste, donde llegan las bandas de piso:
// con una vuelta por piso, la espiral pasa por el lado oeste exactamente a la altura de la banda de cada piso.
export function spiral_point(t) {
  const angle = Math.PI - t * SPIRAL.turns * Math.PI * 2;
  return {
    x: SPIRAL.center_x + Math.cos(angle) * SPIRAL.radius,
    y: SPIRAL.top_y + (SPIRAL.bottom_y - SPIRAL.top_y) * t,
    z: SPIRAL.center_z + Math.sin(angle) * SPIRAL.radius,
  };
}

// ---- Camiones ----
export const TRUCK = { length: 11, width: 2.6, height: 3.4 };

// ---- Red de las montacargas ----
// De muelle a stock: un carril norte-sur pegado a los rieles (A_LANE_X) y, por el sur, el carril del taller. De stock a racks y
// multinivel: un eje norte-sur entre la bodega y los racks (el troncal), un pasillo horizontal por cada cara de rack (el de cada
// ubicación está en `reserve_positions`), un carril cruzado por delante de los racks, un carril al frente de la franja de armado y
// un pasillo entre los racks y el multinivel que sube hasta el elevador.
export const TRUNK_X = -39.3;
export const CROSS_LANE_Z = 1.2;
export const FRONT_LANE_Z = 6;
export const A_LANE_X = -41.9;
export const GARAGE_LANE_Z = 25.2;
// El pasillo entre los racks y el multinivel: un carril para las cubetas (hacia el elevador) y otro para los pallets de reabasto
export const TOTE_LANE_X = -12.2;
export const REPLEN_LANE_X = -10;
// Donde se deja la cubeta para el elevador, y donde se deja el pallet que se va a desarmar en cubetas
export const ELEVATOR_DOOR = { x: -12.2, z: -13.8 };
export const UNLOAD_POINT = { x: REPLEN_LANE_X, z: -8 };
// Los puestos de pallet de descarga, al final de cada riel
export const DOCK_ZS = spread(DOCK_COUNT, -27, 27);
// El taller: diez puestos para las montacargas de muelle a stock y diez para las de stock a racks y multinivel, en una fila
export const PARK_SPOTS_DOCK = Array.from({ length: 10 }, (_, index) => ({ x: -51 + index * 1.6, z: 27.9 }));
export const PARK_SPOTS_STOCK = Array.from({ length: 10 }, (_, index) => ({ x: -34.8 + index * 1.6, z: 27.9 }));

// ---- Parqueadero de camiones ----
// Dos columnas de 10 plazas a los lados de un pasillo norte-sur, con un hueco al centro para el carril de entrada. Los camiones
// entran de frente a su plaza; las plazas se numeran en el orden en que se llenan: primero la columna de la entrada, alternando
// norte y sur desde el centro hacia afuera.
export const PARKING = { aisle_x: -105, left_x: -117, right_x: -93, bay_width: 3.4, yard_lane_x: -83, pivot_x: -74 };
const PARKING_ROWS_Z = [-6.6, 6.6, -10.2, 10.2, -13.8, 13.8, -17.4, 17.4, -21, 21];

export function parking_bays() {
  const bays = [];
  [["left", PARKING.left_x, Math.PI], ["right", PARKING.right_x, 0]].forEach(([side, x, yaw]) => {
    PARKING_ROWS_Z.forEach((z) => {
      const number = bays.length + 1;
      bays.push({ index: number - 1, id: `bay_${number}`, number, side, x, z, yaw });
    });
  });
  return bays;
}

// La cantidad máxima de cada estructura que se puede abrir con los sliders. La bodega se dibuja siempre con todas; la
// simulación decide cuántas están en servicio y las demás se muestran cerradas.
export function max_counts() {
  const maximum = (key) => PARAMETERS.find((parameter) => parameter.key === key).max;
  return {
    door_count: maximum("door_count"),
    wall_count: maximum("wall_count"),
    slots_per_wall: maximum("slots_per_wall"),
    pack_station_count: maximum("pack_station_count"),
  };
}

// ---- Utilidades ----
// `count` posiciones repartidas parejo entre `from` y `to`, cada una en el centro de su tramo
export function spread(count, from, to) {
  const pitch = (to - from) / count;
  return Array.from({ length: count }, (_, index) => from + (index + 0.5) * pitch);
}

function belt(id, kind, points) {
  return { id, kind, points };
}

// ---- La bodega completa para unas cantidades dadas ----
export function build_layout(counts = max_counts()) {
  const { door_count, wall_count, slots_per_wall, pack_station_count } = counts;

  // Muelles de recibo en el muro izquierdo del edificio, con su riel hacia adentro
  const docks = DOCK_ZS.map((z, index) => ({
    id: `dock_${index + 1}`,
    x: BUILDING.x0,
    z,
    // Donde queda el centro del camión: de reversa contra el muelle, con el cabezote hacia el patio
    truck_x: BUILDING.x0 - 0.9 - TRUCK.length / 2,
    // Desde dónde empieza a dar reversa, después de girar
    approach_x: PARKING.pivot_x,
    rail_start: { x: BUILDING.x0, y: 1.3, z },
    rail_end: { x: -45, y: BELT_HEIGHT, z },
    // Dos puestos de pallet de descarga al pie del riel: mientras uno espera montacarga, las cajas siguen llegando al otro
    pallet_spot: { x: -43.8, z },
    pallet_spots: [{ x: -43.8, z }, { x: -43.8, z: z + 1.9 }],
  }));

  // Bandas de piso: una por piso, por el pasillo central hasta el lado oeste de la espiral
  const floor_belts = Array.from({ length: ACTIVE.floors }, (_, floor) =>
    belt(`floor_belt_${floor + 1}`, "floor", [
      { x: ACTIVE.x0, y: floor_y(floor) + BELT_HEIGHT, z: ACTIVE.belt_z },
      { x: spiral_point(0).x, y: floor_y(floor) + BELT_HEIGHT, z: ACTIVE.belt_z },
    ]),
  );

  // Banda principal: sale de la espiral, rodea la espiral por el norte y recorre los muros de arriba a abajo
  const main_belt = belt("main_belt", "main", [
    { x: spiral_point(1).x, y: BELT_HEIGHT, z: SPIRAL.center_z },
    { x: spiral_point(1).x, y: BELT_HEIGHT, z: -20.5 },
    { x: 30, y: BELT_HEIGHT, z: -20.5 },
    { x: 30, y: BELT_HEIGHT, z: 27 },
  ]);

  // Muros de consolidación a los dos lados de la banda principal, de a pares
  const per_side = Math.ceil(wall_count / 2);
  const wall_rows = spread(per_side, -11, 23);
  const wall_pitch = per_side > 0 ? 34 / per_side : 34;
  const wall_columns = slots_per_wall / 2;
  const slot_pitch = Math.min(0.9, (wall_pitch - 1.2) / wall_columns);
  const walls = Array.from({ length: wall_count }, (_, index) => {
    const side = index % 2 === 0 ? "west" : "east";
    const row = Math.floor(index / 2);
    const center_z = wall_rows[row];
    // La cara con las casillas mira a la banda principal; las casillas sobresalen de ella hacia la banda
    const face_x = side === "west" ? 28.7 : 31.3;
    const toward_belt = side === "west" ? 1 : -1;
    const slots = [];
    for (let slot = 0; slot < slots_per_wall; slot += 1) {
      const column = slot % wall_columns;
      const level = Math.floor(slot / wall_columns);
      slots.push({
        id: `wall_${index + 1}_slot_${slot + 1}`,
        x: face_x + toward_belt * 0.3,
        y: 0.35 + level * 1.0,
        z: center_z + (column - (wall_columns - 1) / 2) * slot_pitch,
      });
    }
    return {
      id: `wall_${index + 1}`,
      side,
      center_z,
      face_x,
      depth: 2.4,
      length: wall_columns * slot_pitch,
      slot_pitch,
      slots,
      // Por dónde sale la cubeta del pedido completo
      out_x: side === "west" ? 25.4 : 34.6,
    };
  });

  // Bandas de salida de los muros hacia empaque
  const wall_out_west = belt("wall_out_west", "tote_out", [
    { x: 25.4, y: BELT_HEIGHT, z: -13 },
    { x: 25.4, y: BELT_HEIGHT, z: 28.5 },
    { x: 42, y: BELT_HEIGHT, z: 28.5 },
  ]);
  const wall_out_east = belt("wall_out_east", "tote_out", [
    { x: 34.6, y: BELT_HEIGHT, z: -13 },
    { x: 34.6, y: BELT_HEIGHT, z: 28.5 },
  ]);

  // Empaque: banda de alimentación, estaciones al lado y banda de salida
  const pack_feed = belt("pack_feed", "pack", [
    { x: 42, y: BELT_HEIGHT, z: 28.5 },
    { x: 42, y: BELT_HEIGHT, z: -24 },
  ]);
  const pack_stations = spread(pack_station_count, -24, 24).map((z, index) => ({
    id: `pack_${index + 1}`,
    x: 45.5,
    z,
    // Donde entra la cubeta y donde sale la caja sellada
    in_x: 42,
    out_x: 50,
  }));
  const pack_out = belt("pack_out", "pack", [
    { x: 50, y: BELT_HEIGHT, z: 24 },
    { x: 50, y: BELT_HEIGHT, z: -28.5 },
    { x: 58, y: BELT_HEIGHT, z: -28.5 },
  ]);

  // Despacho: banda a lo largo de la zona y un carril de rodillos hacia cada puerta
  const dispatch_belt = belt("dispatch_belt", "dispatch", [
    { x: 58, y: BELT_HEIGHT, z: -28.5 },
    { x: 58, y: BELT_HEIGHT, z: 28 },
  ]);
  const doors = spread(door_count, -24, 24).map((z, index) => ({
    id: `door_${index + 1}`,
    x: BUILDING.x1,
    z,
    lane: belt(`door_lane_${index + 1}`, "door", [
      { x: 58, y: BELT_HEIGHT, z },
      { x: 75, y: BELT_HEIGHT, z },
    ]),
    // Donde queda el centro del camión de despacho, de reversa contra la puerta, con el cabezote hacia el patio
    truck_x: BUILDING.x1 + 0.9 + TRUCK.length / 2,
    approach_x: 95,
  }));

  const belts = [...floor_belts, main_belt, wall_out_west, wall_out_east, pack_feed, pack_out, dispatch_belt];

  return {
    site: SITE,
    building: BUILDING,
    zones: ZONES,
    docks,
    parking_bays: parking_bays(),
    walls,
    pack_stations,
    doors,
    belts,
    workshop: { x: -35.5, z: 27.9 },
    // Cuántas ubicaciones tiene cada estructura, para comprobar que lo dibujado coincide con lo simulado
    counts: {
      dock_count: DOCK_COUNT,
      door_count,
      wall_count,
      slots_per_wall,
      pack_station_count,
      sku_count: SKU_COUNT,
      reserve_positions: RESERVE_POSITION_COUNT,
    },
  };
}

// Los caminos continuos que recorren las cajas, cubetas y paquetes. Algunas bandas dibujadas se encadenan en una sola para la
// simulación: la espiral sigue como banda principal, y la salida de los muros sigue como alimentación de empaque.
export function build_belt_paths(layout) {
  const spiral_total = SPIRAL.turns * SPIRAL.segments_per_turn;
  const spiral_points = Array.from({ length: spiral_total + 1 }, (_, index) => spiral_point(index / spiral_total));
  const belt_by_id = new Map(layout.belts.map((item) => [item.id, item]));
  const joined = (...ids) => {
    const points = [];
    ids.forEach((id) => {
      const next = belt_by_id.get(id).points;
      points.push(...(points.length ? next.slice(1) : next));
    });
    return points;
  };

  const main_points = [...spiral_points, ...belt_by_id.get("main_belt").points.slice(1)];
  return {
    rails: layout.docks.map((dock) => make_path([dock.rail_start, dock.rail_end])),
    floor_belts: layout.belts.filter((item) => item.kind === "floor").map((item) => make_path(item.points)),
    // El índice de cada vuelta de la espiral donde entra la banda de cada piso: de arriba hacia abajo
    main_chain: make_path(main_points),
    wall_chain: make_path(joined("wall_out_west", "pack_feed")),
    wall_east: make_path(belt_by_id.get("wall_out_east").points),
    dispatch_chain: make_path(joined("pack_out", "dispatch_belt")),
    door_lanes: layout.doors.map((door) => make_path(door.lane.points)),
  };
}

// ---- Carreteras y árboles (solo decoración del terreno) ----
// Los rectángulos de asfalto de las carreteras: la perimetral, las cuatro que salen hasta el borde del mundo y los accesos a
// las garitas. `axis` es hacia dónde corre la línea central discontinua.
export function road_segments() {
  const half = ROAD_WIDTH / 2;
  const ring_x0 = COMPOUND.x0 - RING_OFFSET;
  const ring_x1 = COMPOUND.x1 + RING_OFFSET;
  const ring_z0 = COMPOUND.z0 - RING_OFFSET;
  const ring_z1 = COMPOUND.z1 + RING_OFFSET;
  return [
    { id: "ring_north", axis: "x", x0: ring_x0 - half, x1: ring_x1 + half, z0: ring_z0 - half, z1: ring_z0 + half },
    { id: "ring_south", axis: "x", x0: ring_x0 - half, x1: ring_x1 + half, z0: ring_z1 - half, z1: ring_z1 + half },
    { id: "ring_west", axis: "z", x0: ring_x0 - half, x1: ring_x0 + half, z0: ring_z0 - half, z1: ring_z1 + half },
    { id: "ring_east", axis: "z", x0: ring_x1 - half, x1: ring_x1 + half, z0: ring_z0 - half, z1: ring_z1 + half },
    { id: "spur_west", axis: "x", x0: -ROAD_END, x1: ring_x0 - half, z0: -half, z1: half },
    { id: "spur_east", axis: "x", x0: ring_x1 + half, x1: ROAD_END, z0: -half, z1: half },
    { id: "spur_north", axis: "z", x0: ROAD_NORTH_SOUTH_X - half, x1: ROAD_NORTH_SOUTH_X + half, z0: -ROAD_END, z1: ring_z0 - half },
    { id: "spur_south", axis: "z", x0: ROAD_NORTH_SOUTH_X - half, x1: ROAD_NORTH_SOUTH_X + half, z0: ring_z1 + half, z1: ROAD_END },
    { id: "access_west", axis: "x", x0: ring_x0 + half, x1: COMPOUND.x0, z0: -half, z1: half },
    { id: "access_east", axis: "x", x0: COMPOUND.x1, x1: ring_x1 - half, z0: -half, z1: half },
  ];
}

// Árboles repartidos con una semilla fija (no con el azar del navegador), lejos del predio, las carreteras y los clientes
export function build_trees(count = 520) {
  const rng = new Rng(20260711);
  const margin = RING_OFFSET + ROAD_WIDTH / 2 + 5;
  const half = ROAD_WIDTH / 2 + 3;
  const trees = [];
  for (let attempt = 0; attempt < count * 40 && trees.length < count; attempt += 1) {
    const x = rng.float(-300, 300);
    const z = rng.float(-240, 240);
    const near_compound = x > COMPOUND.x0 - margin && x < COMPOUND.x1 + margin && z > COMPOUND.z0 - margin && z < COMPOUND.z1 + margin;
    const near_east_west_road = Math.abs(z) < half;
    const near_north_south_road = Math.abs(x - ROAD_NORTH_SOUTH_X) < half;
    const near_customers = x > -8 && x < 56 && z > -84 && z < -54;
    if (near_compound || near_east_west_road || near_north_south_road || near_customers) continue;
    trees.push({ x, z, scale: rng.float(0.8, 1.5), tint: rng.float(0.82, 1.12) });
  }
  return trees;
}
