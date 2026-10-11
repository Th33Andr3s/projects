// Lo que no se mueve en la bodega: terreno, edificio, racks, estructura del multinivel, bandas, muros, estaciones, puertas y los
// letreros de cada zona. Todo se junta en una sola malla con color por vértice (ver geometry_parts.js) y los letreros son
// rótulos que siempre miran a la cámara. Las medidas salen de layout.js.

import { PartCollector } from "./geometry_parts.js";
import {
  ACTIVE,
  BELT_HEIGHT,
  BUILDING,
  BUILDING_WALL_HEIGHT,
  ELEVATOR,
  RESERVE,
  SITE,
  SPIRAL,
  floor_y,
  sku_anchor,
  spiral_point,
} from "./layout.js";
import { SKU_COUNT, sku_color } from "./config.js";

const COLORS = {
  ground: "#aeb6c1",
  indoor_floor: "#e4e8ee",
  yard: "#8b929c",
  road: "#6b727d",
  road_line: "#e8ecf1",
  customers: "#c5d8c9",
  wall: "#f5f7fa",
  wall_cap: "#c3cad4",
  steel: "#5b6b7f",
  steel_light: "#94a3b8",
  rack_beam: "#e08a1e",
  rack_deck: "#d7dde5",
  belt_frame: "#64748b",
  belt_surface: "#273244",
  belt_rail: "#9fb0c4",
  slab: "#cdd4dd",
  rail_yellow: "#f2c94c",
  bumper: "#334155",
  amber: "#f59e0b",
  slot: "#f8fafc",
  wall_body: "#8b7fb5",
  table: "#a9b6c6",
  table_top: "#e2e8f0",
  house: "#f1f5f9",
  roof: "#6366f1",
  staging: "#fde68a",
  grid: "#ffffff",
};

// El tinte del piso de cada zona cubierta
const ZONE_TINTS = {
  receiving: "#d7e5f6",
  reserve: "#efe4d2",
  active: "#dbe9df",
  workshop: "#f0dcdc",
  walls: "#e2dcf1",
  packing: "#d8e8ec",
  dispatch: "#ece8d4",
};

// Alturas de las capas del piso, de abajo hacia arriba, para que nada parpadee al superponerse
const LAYER = { ground: 0, slab: 0.05, zone: 0.08, marking: 0.1 };
const LAYER_THICKNESS = 0.05;

function add_flat(collector, x0, x1, z0, z1, top, color, thickness = LAYER_THICKNESS) {
  collector.add_box((x0 + x1) / 2, top - thickness / 2, (z0 + z1) / 2, x1 - x0, thickness, z1 - z0, color);
}

// Un tramo de muro bajo de pared recta, con huecos (muelles o puertas) de ancho `gap` centrados en `openings`
function add_wall_run(collector, axis, fixed, start, end, openings, gap) {
  const thickness = 0.4;
  const cuts = [...openings].sort((first, second) => first - second);
  let cursor = start;
  const pieces = [];
  cuts.forEach((center) => {
    pieces.push([cursor, center - gap / 2]);
    cursor = center + gap / 2;
  });
  pieces.push([cursor, end]);
  pieces.forEach(([from, to]) => {
    if (to - from < 0.05) return;
    const middle = (from + to) / 2;
    const length = to - from;
    if (axis === "x") {
      collector.add_box(middle, BUILDING_WALL_HEIGHT / 2, fixed, length, BUILDING_WALL_HEIGHT, thickness, COLORS.wall);
      collector.add_box(middle, BUILDING_WALL_HEIGHT + 0.05, fixed, length, 0.1, thickness + 0.1, COLORS.wall_cap);
    } else {
      collector.add_box(fixed, BUILDING_WALL_HEIGHT / 2, middle, thickness, BUILDING_WALL_HEIGHT, length, COLORS.wall);
      collector.add_box(fixed, BUILDING_WALL_HEIGHT + 0.05, middle, thickness + 0.1, 0.1, length, COLORS.wall_cap);
    }
  });
}

// Una banda transportadora: marco, superficie oscura y dos bordes, tramo por tramo (los tramos pueden ir inclinados)
function add_belt_path(collector, points, width = 0.9) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const from_array = [from.x, from.y, from.z];
    const to_array = [to.x, to.y, to.z];
    const below = (point) => [point.x, point.y - 0.12, point.z];
    collector.add_beam(below(from), below(to), width + 0.1, 0.16, COLORS.belt_frame);
    collector.add_beam(from_array, to_array, width, 0.06, COLORS.belt_surface);
    // Bordes: la banda se desplaza al costado según su dirección
    const delta_x = to.x - from.x;
    const delta_z = to.z - from.z;
    const length = Math.hypot(delta_x, delta_z) || 1;
    const side_x = (-delta_z / length) * (width / 2 + 0.03);
    const side_z = (delta_x / length) * (width / 2 + 0.03);
    [-1, 1].forEach((sign) => {
      collector.add_beam(
        [from.x + side_x * sign, from.y + 0.08, from.z + side_z * sign],
        [to.x + side_x * sign, to.y + 0.08, to.z + side_z * sign],
        0.06,
        0.12,
        COLORS.belt_rail,
      );
    });
  }
}

function add_terrain(collector, layout) {
  add_flat(collector, SITE.x0, SITE.x1, SITE.z0, SITE.z1, LAYER.ground, COLORS.ground, 0.2);
  // El interior del edificio
  add_flat(collector, BUILDING.x0, BUILDING.x1, BUILDING.z0, BUILDING.z1, LAYER.slab, COLORS.indoor_floor);

  layout.zones.forEach((zone) => {
    if (zone.kind === "yard") add_flat(collector, zone.x0, zone.x1, zone.z0, zone.z1, LAYER.zone, COLORS.yard);
    else if (zone.kind === "road") add_flat(collector, zone.x0, zone.x1, zone.z0, zone.z1, LAYER.zone, COLORS.road);
    else if (ZONE_TINTS[zone.id]) add_flat(collector, zone.x0, zone.x1, zone.z0, zone.z1, LAYER.zone, ZONE_TINTS[zone.id]);
  });

  // Línea discontinua al centro de las vías
  [
    [-90, -75],
    [98, 105],
  ].forEach(([from, to]) => {
    for (let x = from + 1; x < to - 1; x += 3) add_flat(collector, x, x + 1.6, -0.12, 0.12, LAYER.marking + 0.01, COLORS.road_line, 0.02);
  });
  // Carril de entrada y de salida pintados sobre los patios, hasta los muelles y las puertas
  add_flat(collector, -75, -62, -0.12, 0.12, LAYER.marking, COLORS.road_line, 0.02);
  add_flat(collector, 86, 98, -0.12, 0.12, LAYER.marking, COLORS.road_line, 0.02);
}

function add_customers(collector, layout) {
  const zone = layout.zones.find((candidate) => candidate.id === "customers");
  collector.add_box((zone.x0 + zone.x1) / 2, 0.15, (zone.z0 + zone.z1) / 2, zone.x1 - zone.x0, 0.3, zone.z1 - zone.z0, COLORS.customers);
  // Casitas: cada pedido web nace sobre una de ellas
  [-16, -8, 0, 8, 16].forEach((x, index) => {
    const z = -43 + (index % 2 === 0 ? 1.5 : -1.5);
    collector.add_box(x, 1.5, z, 3.6, 2.4, 3.2, COLORS.house);
    collector.add_box(x, 3.0, z, 4.2, 0.5, 3.8, COLORS.roof);
  });
  // Camino punteado desde los clientes hasta la bodega
  for (let z = -34; z <= -31; z += 1.5) collector.add_box(0, 0.12, z, 0.5, 0.04, 0.6, COLORS.road_line);
}

function add_building_walls(collector, layout) {
  add_wall_run(collector, "x", BUILDING.z0, BUILDING.x0, BUILDING.x1, [], 0);
  add_wall_run(collector, "x", BUILDING.z1, BUILDING.x0, BUILDING.x1, [], 0);
  add_wall_run(collector, "z", BUILDING.x0, BUILDING.z0, BUILDING.z1, layout.docks.map((dock) => dock.z), 4.6);
  add_wall_run(collector, "z", BUILDING.x1, BUILDING.z0, BUILDING.z1, layout.doors.map((door) => door.z), 4.6);
}

function add_docks_and_rails(collector, layout) {
  layout.docks.forEach((dock) => {
    // Tope del muelle y rampa de acople
    collector.add_box(dock.x - 0.7, 0.55, dock.z - 1.9, 0.5, 1.1, 0.4, COLORS.bumper);
    collector.add_box(dock.x - 0.7, 0.55, dock.z + 1.9, 0.5, 1.1, 0.4, COLORS.bumper);
    collector.add_box(dock.x - 0.1, 0.6, dock.z, 1.6, 0.12, 3.6, COLORS.rail_yellow);
    // Marcas del lugar del camión en el patio
    add_flat(collector, dock.x - 15, dock.x - 2, dock.z - 2.7, dock.z - 2.55, LAYER.marking, COLORS.road_line, 0.02);
    add_flat(collector, dock.x - 15, dock.x - 2, dock.z + 2.55, dock.z + 2.7, LAYER.marking, COLORS.road_line, 0.02);
    // El riel inclinado por el que bajan las cajas
    const from = [dock.rail_start.x, dock.rail_start.y, dock.rail_start.z];
    const to = [dock.rail_end.x, dock.rail_end.y, dock.rail_end.z];
    collector.add_beam(from, to, 1.2, 0.14, COLORS.belt_frame);
    [-0.65, 0.65].forEach((offset) => {
      collector.add_beam([from[0], from[1] + 0.1, from[2] + offset], [to[0], to[1] + 0.1, to[2] + offset], 0.08, 0.16, COLORS.belt_rail);
    });
    // Mesa de recibo al pie del riel
    collector.add_box(dock.rail_end.x + 1.1, 0.45, dock.z, 2.0, 0.9, 2.2, COLORS.table);
    collector.add_box(dock.rail_end.x + 1.1, 0.93, dock.z, 2.1, 0.06, 2.3, COLORS.table_top);
  });
  // Líneas de la cola de espera
  layout.queue_spots.forEach((spot) => add_flat(collector, spot.x - 5, spot.x + 5, spot.z - 0.06, spot.z + 0.06, LAYER.marking, COLORS.road_line, 0.02));
}

function add_reserve_racks(collector) {
  const length = RESERVE.bays_per_row * RESERVE.bay_width;
  const top = RESERVE.first_level_y + RESERVE.levels * RESERVE.level_height;
  RESERVE.row_z.forEach((row_z) => {
    for (let side = 0; side < RESERVE.sides; side += 1) {
      const z = row_z + (side === 0 ? -RESERVE.side_offset : RESERVE.side_offset);
      for (let post = 0; post <= RESERVE.bays_per_row; post += 1) {
        collector.add_box(RESERVE.x0 + post * RESERVE.bay_width, top / 2, z, 0.1, top, RESERVE.rack_depth, COLORS.steel);
      }
      for (let level = 0; level < RESERVE.levels; level += 1) {
        const y = RESERVE.first_level_y + level * RESERVE.level_height;
        collector.add_box(RESERVE.x0 + length / 2, y - 0.05, z, length, 0.1, 0.1, COLORS.rack_beam);
        collector.add_box(RESERVE.x0 + length / 2, y - 0.04, z, length, 0.04, RESERVE.rack_depth, COLORS.rack_deck);
      }
    }
  });
}

function add_active_structure(collector) {
  const width = ACTIVE.x1 - ACTIVE.x0;
  const depth = ACTIVE.z1 - ACTIVE.z0;
  const center_x = (ACTIVE.x0 + ACTIVE.x1) / 2;
  const center_z = (ACTIVE.z0 + ACTIVE.z1) / 2;
  const top_y = floor_y(ACTIVE.floors - 1) + ACTIVE.rack_height + 0.9;

  // Columnas de la estructura
  [ACTIVE.x0, center_x, ACTIVE.x1].forEach((x) => {
    [ACTIVE.z0, center_z, ACTIVE.z1].forEach((z) => {
      collector.add_box(x, top_y / 2, z, 0.4, top_y, 0.4, COLORS.steel);
    });
  });

  for (let floor = 0; floor < ACTIVE.floors; floor += 1) {
    const y = floor_y(floor);
    collector.add_box(center_x, y + ACTIVE.slab_thickness / 2, center_z, width, ACTIVE.slab_thickness, depth, COLORS.slab);
    // Baranda en los dos bordes largos de los pisos altos
    if (floor > 0) {
      [ACTIVE.z0, ACTIVE.z1].forEach((z) => {
        collector.add_box(center_x, y + ACTIVE.slab_thickness + 1.0, z, width, 0.06, 0.06, COLORS.rail_yellow);
        collector.add_box(center_x, y + ACTIVE.slab_thickness + 0.5, z, width, 0.05, 0.05, COLORS.rail_yellow);
        for (let x = ACTIVE.x0; x <= ACTIVE.x1 + 0.01; x += 3.5) collector.add_box(x, y + ACTIVE.slab_thickness + 0.5, z, 0.06, 1.0, 0.06, COLORS.rail_yellow);
      });
    }
    // Dos racks por piso, con los cuatro SKU del piso en las posiciones de picking
    [ACTIVE.rack_a_z, ACTIVE.rack_b_z].forEach((z) => {
      const base = y + ACTIVE.slab_thickness;
      for (let post = 0; post <= 14; post += 1) {
        collector.add_box(ACTIVE.x0 + post * (width / 14), base + ACTIVE.rack_height / 2, z, 0.08, ACTIVE.rack_height, ACTIVE.rack_depth, COLORS.steel);
      }
      [0.7, 1.45, ACTIVE.rack_height].forEach((level_y) => {
        collector.add_box(center_x, base + level_y - 0.04, z, width, 0.08, ACTIVE.rack_depth, COLORS.rack_deck);
        collector.add_box(center_x, base + level_y - 0.06, z, width, 0.06, 0.06, COLORS.rack_beam);
      });
    });
  }

  // La franja de color de cada SKU sobre su tramo de rack, para reconocer qué se guarda dónde
  for (let sku = 0; sku < SKU_COUNT; sku += 1) {
    const anchor = sku_anchor(sku);
    collector.add_box(anchor.x, anchor.y + ACTIVE.rack_height + 0.12, anchor.z, anchor.x1 - anchor.x0 - 0.3, 0.22, 0.34, sku_color(sku));
  }
}

function add_elevator(collector) {
  const half = ELEVATOR.size / 2;
  [-1, 1].forEach((sign_x) => {
    [-1, 1].forEach((sign_z) => {
      collector.add_box(ELEVATOR.x + sign_x * half, ELEVATOR.height / 2, ELEVATOR.z + sign_z * half, 0.16, ELEVATOR.height, 0.16, COLORS.steel);
    });
  });
  collector.add_box(ELEVATOR.x, ELEVATOR.height, ELEVATOR.z, ELEVATOR.size + 0.3, 0.2, ELEVATOR.size + 0.3, COLORS.steel);
  for (let floor = 0; floor < ACTIVE.floors; floor += 1) {
    const y = floor_y(floor) + BELT_HEIGHT;
    // Descansos del elevador y el tramo corto que lleva la cubeta hasta el piso
    collector.add_box(ELEVATOR.x, y - 0.1, ELEVATOR.z, ELEVATOR.size, 0.1, ELEVATOR.size, COLORS.steel_light);
    add_belt_path(
      collector,
      [
        { x: ELEVATOR.x + half, y, z: ELEVATOR.z },
        { x: ACTIVE.x0, y, z: ELEVATOR.z },
      ],
      0.8,
    );
  }
  // La cabina, abajo, a la espera
  collector.add_box(ELEVATOR.x, BELT_HEIGHT + 0.45, ELEVATOR.z, ELEVATOR.size - 0.5, 0.9, ELEVATOR.size - 0.5, COLORS.amber);
}

function add_spiral(collector) {
  const total = SPIRAL.turns * SPIRAL.segments_per_turn;
  for (let index = 0; index < total; index += 1) {
    const from = spiral_point(index / total);
    const to = spiral_point((index + 1) / total);
    const from_array = [from.x, from.y - 0.12, from.z];
    const to_array = [to.x, to.y - 0.12, to.z];
    collector.add_beam(from_array, to_array, 1.2, 0.16, COLORS.belt_frame);
    collector.add_beam([from.x, from.y, from.z], [to.x, to.y, to.z], 0.9, 0.06, COLORS.belt_surface);
  }
  // Eje central y soportes
  collector.add_cylinder(SPIRAL.center_x, SPIRAL.top_y / 2, SPIRAL.center_z, 0.35, 0.35, SPIRAL.top_y, COLORS.steel, 12);
  for (let turn = 0; turn <= SPIRAL.turns; turn += 1) {
    const point = spiral_point(turn / SPIRAL.turns);
    collector.add_beam([SPIRAL.center_x, point.y - 0.3, SPIRAL.center_z], [point.x, point.y - 0.3, point.z], 0.25, 0.2, COLORS.steel);
  }
}

function add_walls_and_slots(collector, layout) {
  layout.walls.forEach((wall) => {
    const body_x = wall.side === "west" ? wall.face_x - wall.depth / 2 : wall.face_x + wall.depth / 2;
    collector.add_box(body_x, 1.25, wall.center_z, wall.depth, 2.5, wall.length + 0.6, COLORS.wall_body);
    // Cada casilla es una bandeja que sobresale de la cara del muro hacia la banda principal
    wall.slots.forEach((slot) => {
      collector.add_box(slot.x, slot.y + 0.03, slot.z, 0.6, 0.06, Math.max(0.3, wall.slot_pitch - 0.12), COLORS.slot);
    });
    // Cinta de salida que une el muro con su banda de salida
    const behind = wall.side === "west" ? -1 : 1;
    collector.add_box(wall.face_x + behind * (wall.depth + 0.4), 0.45, wall.center_z, 0.6, 0.9, wall.length, COLORS.table);
  });
}

function add_pack_stations(collector, layout) {
  layout.pack_stations.forEach((station) => {
    collector.add_box(station.x, 0.45, station.z, 3.2, 0.9, 2.0, COLORS.table);
    collector.add_box(station.x, 0.93, station.z, 3.3, 0.06, 2.1, COLORS.table_top);
    // El brazo de la cinta y la pantalla
    collector.add_box(station.x + 0.3, 1.5, station.z - 0.9, 0.12, 1.1, 0.12, COLORS.steel);
    collector.add_box(station.x + 0.3, 2.05, station.z - 0.45, 0.2, 0.2, 1.0, COLORS.amber);
  });
}

function add_dispatch(collector, layout) {
  layout.doors.forEach((door) => {
    collector.add_box(door.x + 0.1, 1.9, door.z - 2.6, 0.5, 3.8, 0.4, COLORS.amber);
    collector.add_box(door.x + 0.1, 1.9, door.z + 2.6, 0.5, 3.8, 0.4, COLORS.amber);
    collector.add_box(door.x + 0.1, 3.8, door.z, 0.5, 0.4, 5.6, COLORS.amber);
    // Zona de estacionamiento temporal de cajas ante la puerta
    add_flat(collector, 64, 77, door.z - 2.4, door.z + 2.4, LAYER.marking, COLORS.staging, 0.02);
    collector.add_box(door.x + 5, 0.06, door.z - 2.7, 10, 0.02, 0.12, COLORS.road_line);
    collector.add_box(door.x + 5, 0.06, door.z + 2.7, 10, 0.02, 0.12, COLORS.road_line);
  });
}

function add_workshop(collector, layout) {
  const zone = layout.zones.find((candidate) => candidate.id === "workshop");
  const wall_color = COLORS.wall;
  [zone.z0, zone.z1].forEach((z) => collector.add_box((zone.x0 + zone.x1) / 2, 0.6, z, zone.x1 - zone.x0, 1.2, 0.2, wall_color));
  collector.add_box(zone.x0, 0.6, (zone.z0 + zone.z1) / 2, 0.2, 1.2, zone.z1 - zone.z0, wall_color);
  collector.add_box(zone.x0 + 1.2, 0.5, zone.z0 + 1.2, 2.2, 1.0, 0.9, COLORS.steel_light);
}

function add_grid(THREE) {
  const vertices = [];
  const step = 5;
  for (let x = Math.ceil(SITE.x0 / step) * step; x <= SITE.x1; x += step) vertices.push(x, 0.115, SITE.z0, x, 0.115, SITE.z1);
  for (let z = Math.ceil(SITE.z0 / step) * step; z <= SITE.z1; z += step) vertices.push(SITE.x0, 0.115, z, SITE.x1, 0.115, z);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  const material = new THREE.LineBasicMaterial({ color: COLORS.grid, transparent: true, opacity: 0.14 });
  return new THREE.LineSegments(geometry, material);
}

// El rótulo de una zona: texto en dos renglones como máximo, sobre fondo oscuro con borde cian
function make_sign_texture(THREE, label) {
  const words = label.split(" ");
  let lines = [label];
  if (label.length > 15 && words.length > 1) {
    // Se parte donde deja los dos renglones más parejos
    let best = 1;
    let best_difference = Infinity;
    for (let cut = 1; cut < words.length; cut += 1) {
      const difference = Math.abs(words.slice(0, cut).join(" ").length - words.slice(cut).join(" ").length);
      if (difference < best_difference) {
        best_difference = difference;
        best = cut;
      }
    }
    lines = [words.slice(0, best).join(" "), words.slice(best).join(" ")];
  }
  const font_size = 44;
  const padding = 22;
  const line_height = font_size * 1.18;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.font = `600 ${font_size}px system-ui, "Segoe UI", Roboto, sans-serif`;
  const text_width = Math.max(...lines.map((line) => context.measureText(line).width));
  canvas.width = Math.ceil(text_width + padding * 2);
  canvas.height = Math.ceil(line_height * lines.length + padding * 2 - font_size * 0.18);
  context.font = `600 ${font_size}px system-ui, "Segoe UI", Roboto, sans-serif`;
  const radius = 18;
  context.fillStyle = "rgba(11, 18, 32, 0.92)";
  context.beginPath();
  context.roundRect(2, 2, canvas.width - 4, canvas.height - 4, radius);
  context.fill();
  context.lineWidth = 4;
  context.strokeStyle = "#22d3ee";
  context.stroke();
  context.fillStyle = "#f8fafc";
  context.textAlign = "center";
  context.textBaseline = "middle";
  lines.forEach((line, index) => {
    context.fillText(line, canvas.width / 2, padding + font_size * 0.5 + index * line_height);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect: canvas.width / canvas.height, lines: lines.length };
}

// Los letreros: un poste fino y un rótulo flotante por zona. El tamaño del rótulo en el mundo lo ajusta el renderer según el
// zoom y los acomoda para que no se pisen (ver `place_signs`), así se leen igual de cerca y de lejos.
function build_signs(THREE, layout, collector) {
  const signs = [];
  layout.zones.forEach((zone) => {
    const { sign } = zone;
    collector.add_box(sign.x, (sign.y - 1) / 2, sign.z, 0.14, sign.y - 1, 0.14, COLORS.steel_light);
    const { texture, aspect, lines } = make_sign_texture(THREE, zone.label);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(sign.x, sign.y, sign.z);
    sprite.name = `sign_${zone.id}`;
    sprite.renderOrder = 10;
    signs.push({ zone_id: zone.id, label: zone.label, priority: zone.priority, sprite, aspect, lines, base_position: sprite.position.clone() });
  });
  return signs;
}

// Construye todo lo estático y lo devuelve en un grupo, junto con la lista de letreros
export function build_static_scene(THREE, layout) {
  const collector = new PartCollector(THREE);
  add_terrain(collector, layout);
  add_customers(collector, layout);
  add_building_walls(collector, layout);
  add_docks_and_rails(collector, layout);
  add_reserve_racks(collector);
  add_active_structure(collector);
  add_elevator(collector);
  add_spiral(collector);
  layout.belts.forEach((belt) => {
    // Los rieles de los muelles y las bandas de piso ya se dibujan; las de piso solo llegan hasta la espiral
    add_belt_path(collector, belt.points, belt.kind === "floor" ? 0.8 : 0.9);
  });
  add_walls_and_slots(collector, layout);
  add_pack_stations(collector, layout);
  add_dispatch(collector, layout);
  add_workshop(collector, layout);
  const signs = build_signs(THREE, layout, collector);

  const geometry = collector.build();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.02 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "static_scene";
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.name = "static_group";
  group.add(mesh);
  group.add(add_grid(THREE));
  signs.forEach((sign) => group.add(sign.sprite));
  return { group, signs, mesh, vertex_count: collector.vertex_count };
}
