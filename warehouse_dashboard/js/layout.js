// La tabla de la bodega: dónde está cada zona, muelle, rack, piso, banda, muro, estación y puerta. Todas las medidas están
// aquí, en metros, y no repartidas por el código. Son números puros (sin Three.js), así se pueden probar con Node.
//
// Sistema de coordenadas: x crece hacia la derecha (el flujo va de izquierda a derecha), z crece hacia "delante" (hacia
// quien mira) e y hacia arriba. El origen está en el centro del recorrido.
//
// Las cantidades que la persona cambia con sliders (muelles, puertas, muros, casillas, estaciones) entran a `build_layout` y
// el diseño las acomoda; el resto es fijo.

import { FLOOR_COUNT, PARAMETERS, SKU_COUNT, SKUS_PER_FLOOR, sku_floor } from "./config.js";
import { make_path } from "./path_tools.js";

// ---- Terreno y edificio ----
export const SITE = { x0: -90, x1: 105, z0: -52, z1: 34 };
export const BUILDING = { x0: -53, x1: 78, z0: -30, z1: 30 };
// Los muros del edificio son bajos (corte de maqueta) para que nunca tapen lo de adentro, gire como gire la cámara
export const BUILDING_WALL_HEIGHT = 1.4;
// La altura a la que van las bandas sobre el piso de cada nivel
export const BELT_HEIGHT = 0.9;

// ---- Zonas con letrero ----
// kind: indoor (bajo techo), yard (patio de asfalto), road (vía) o customers (afuera, fuera de la bodega).
// sign: dónde queda el poste del letrero (x, z) y a qué altura (y) flota el rótulo. priority: si dos rótulos se pisan en
// pantalla, el de mayor prioridad se queda donde está y el otro se corre hacia arriba.
export const ZONES = [
  { id: "road_in", label: "Vía de acceso", kind: "road", priority: 2, x0: -90, x1: -75, z0: -7, z1: 7, sign: { x: -82, z: 0, y: 5 } },
  { id: "yard", label: "Patio de recibo y muelles", kind: "yard", priority: 8, x0: -75, x1: -53, z0: -30, z1: 30, sign: { x: -64, z: 0, y: 11 } },
  { id: "receiving", label: "Recibo (rieles)", kind: "indoor", priority: 9, x0: -53, x1: -39, z0: -30, z1: 30, sign: { x: -46, z: 0, y: 5 } },
  { id: "reserve", label: "Racks de reserva", kind: "indoor", priority: 11, x0: -39, x1: -13, z0: -30, z1: 4, sign: { x: -26, z: -23, y: 9 } },
  { id: "active", label: "Multinivel activo", kind: "indoor", priority: 12, x0: -9, x1: 19, z0: -23, z1: -9, sign: { x: 5, z: -25, y: 19 } },
  { id: "workshop", label: "Taller de montacargas", kind: "indoor", priority: 3, x0: -37, x1: -27, z0: 16, z1: 28, sign: { x: -32, z: 22, y: 4 } },
  { id: "walls", label: "Muros de consolidación", kind: "indoor", priority: 10, x0: 24, x1: 40, z0: -30, z1: 30, sign: { x: 38, z: -26, y: 11 } },
  { id: "packing", label: "Empaque", kind: "indoor", priority: 7, x0: 40, x1: 56, z0: -30, z1: 30, sign: { x: 53, z: -26, y: 5 } },
  { id: "dispatch", label: "Despacho y puertas", kind: "indoor", priority: 6, x0: 56, x1: 78, z0: -30, z1: 30, sign: { x: 66, z: -26, y: 10 } },
  { id: "exit_yard", label: "Patio de salida", kind: "yard", priority: 5, x0: 78, x1: 98, z0: -30, z1: 30, sign: { x: 90, z: 0, y: 5 } },
  { id: "road_out", label: "Vía de salida", kind: "road", priority: 1, x0: 98, x1: 105, z0: -7, z1: 7, sign: { x: 102, z: 0, y: 9 } },
  { id: "customers", label: "Clientes / e-commerce", kind: "customers", priority: 4, x0: -24, x1: 24, z0: -50, z1: -36, sign: { x: 0, z: -43, y: 7 } },
];

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

// ---- Red de los montacargas ----
// Un eje vertical entre recibo y reserva (el troncal), un pasillo horizontal por cada cara de rack (el de cada ubicación está en
// `reserve_positions`), un carril cruzado por delante de los racks hasta la mesa de reabasto, y el parqueo en el taller.
export const TRUNK_X = -39.3;
export const CROSS_LANE_Z = 1.2;
// Donde un montacarga deja el pallet que se va a desarmar en cubetas para reabastecer el activo
export const UNLOAD_POINT = { x: -14.5, z: -0.8 };
// El eje de la banda de cubetas que lleva al elevador
export const TOTE_CONVEYOR_Z = -3;
export const TOTE_CONVEYOR_START_X = -40.5;
// Dónde se forman los pallets en recibo, entre rieles
export const PALLET_SPOT_X = -44.5;
// En cada hueco entre rieles caben tres pallets en fila, a 1,8 m uno del otro, todos con la salida libre hacia el troncal
export const PALLET_SPOT_ZS = [-26, -17.333, -8.667, 0, 8.667, 17.333, 26].flatMap((center) => [center - 1.8, center, center + 1.8]);
// Las cubetas de entrada que se van llenando en recibo, una por piso
export const TOTE_STATION_X = -40.8;
export const TOTE_STATION_ZS = [-10.4, -9.25, -8.1, -6.95, -5.8];
// Parqueo de montacargas en el taller
export const PARK_SPOTS = Array.from({ length: 8 }, (_, index) => ({ x: -35.4 + (index % 4) * 2.4, z: 19.5 + Math.floor(index / 4) * 4 }));

// La cantidad máxima de cada estructura que se puede abrir con los sliders. La bodega se dibuja siempre con todas; la
// simulación decide cuántas están en servicio y las demás se muestran cerradas.
export function max_counts() {
  const maximum = (key) => PARAMETERS.find((parameter) => parameter.key === key).max;
  return {
    dock_count: maximum("dock_count"),
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
  const { dock_count, door_count, wall_count, slots_per_wall, pack_station_count } = counts;

  // Muelles de recibo en el muro izquierdo del edificio, con su riel hacia adentro
  const docks = spread(dock_count, -26, 26).map((z, index) => ({
    id: `dock_${index + 1}`,
    x: BUILDING.x0,
    z,
    // Donde queda el centro del camión: de reversa contra el muelle, con el cabezote hacia el patio
    truck_x: BUILDING.x0 - 0.9 - TRUCK.length / 2,
    // Desde dónde empieza a dar reversa, después de girar
    approach_x: -67,
    rail_start: { x: BUILDING.x0, y: 1.3, z },
    rail_end: { x: -43.5, y: BELT_HEIGHT, z },
  }));

  // Lugares de espera en el patio, en una fila a lo largo de x = -70 (la cola visible)
  const queue_spots = spread(8, -27, 27).map((z, index) => ({ id: `queue_${index + 1}`, x: -70, z }));

  // Banda de cubetas del 30 % directo al activo: sale de recibo, cruza por el pasillo de adelante y entra al elevador
  const tote_conveyor = belt("tote_conveyor", "tote_in", [
    { x: TOTE_CONVEYOR_START_X, y: BELT_HEIGHT, z: TOTE_CONVEYOR_Z },
    { x: ELEVATOR.x, y: BELT_HEIGHT, z: TOTE_CONVEYOR_Z },
    { x: ELEVATOR.x, y: BELT_HEIGHT, z: ELEVATOR.z },
  ]);

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

  // La vía de salida: del patio al borde derecho del mapa
  const exit_path = [
    { x: 96, z: 0 },
    { x: SITE.x1, z: 0 },
  ];

  const belts = [tote_conveyor, ...floor_belts, main_belt, wall_out_west, wall_out_east, pack_feed, pack_out, dispatch_belt, ...doors.map((door) => door.lane)];

  return {
    site: SITE,
    building: BUILDING,
    zones: ZONES,
    docks,
    queue_spots,
    walls,
    pack_stations,
    doors,
    belts,
    exit_path,
    workshop: { x: -32, z: 22 },
    // Cuántas ubicaciones tiene cada estructura, para comprobar que lo dibujado coincide con lo simulado
    counts: {
      dock_count,
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
    tote_conveyor: make_path(belt_by_id.get("tote_conveyor").points),
    floor_belts: layout.belts.filter((item) => item.kind === "floor").map((item) => make_path(item.points)),
    // El índice de cada vuelta de la espiral donde entra la banda de cada piso: de arriba hacia abajo
    main_chain: make_path(main_points),
    wall_chain: make_path(joined("wall_out_west", "pack_feed")),
    wall_east: make_path(belt_by_id.get("wall_out_east").points),
    dispatch_chain: make_path(joined("pack_out", "dispatch_belt")),
    door_lanes: layout.doors.map((door) => make_path(door.lane.points)),
  };
}
