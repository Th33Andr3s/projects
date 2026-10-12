// Lo que no se mueve en la bodega: terreno, edificio, racks, estructura del multinivel, bandas, muros, estaciones, puertas y los
// letreros de cada zona. Todo se junta en una sola malla con color por vértice (ver geometry_parts.js) y los letreros son
// rótulos que siempre miran a la cámara. Las medidas salen de layout.js.

import { PartCollector } from "./geometry_parts.js";
import {
  ACTIVE,
  BELT_HEIGHT,
  BUILDING,
  BUILDING_WALL_HEIGHT,
  COMPOUND,
  ELEVATOR,
  GATES,
  RESERVE,
  SPIRAL,
  WORLD,
  build_trees,
  floor_y,
  road_segments,
  sku_anchor,
  spiral_point,
  DISPATCH_BINS,
  PALLET_SPOTS,
  PARK_SPOTS_DOCK,
  PARK_SPOTS_STOCK,
  STAGING,
  TOTE_STATIONS,
  UNLOAD_BAYS,
  dispatch_bin_slot,
  staging_slot,
} from "./layout.js";
import { SKU_COUNT } from "./config.js";
import { CATEGORIES, DESTINATIONS, sku_color } from "./catalog.js";

const COLORS = {
  grass: "#aec59f",
  compound: "#a9b0ba",
  indoor_floor: "#e4e8ee",
  yard: "#848b96",
  road: "#5f6671",
  fence: "#cfd6df",
  fence_post: "#6b7788",
  canopy: "#dbe3ec",
  trunk: "#7c5a3a",
  leaves_dark: "#2f7a43",
  leaves_light: "#3f8f4f",
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

// El color suave del cuadro de cada pila en el piso de la bodega de recibo: el de su categoría
// (mezclado con blanco para que no compita con las pilas)
function lighten(hex, amount) {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  return `#${channels.map((value) => Math.round(value + (255 - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}
const CATEGORY_TONES = CATEGORIES.map((category) => lighten(category.color, 0.7));

// El tinte del piso de cada zona cubierta
const ZONE_TINTS = {
  receiving: "#d7e5f6",
  reserve: "#efe4d2",
  active: "#dbe9df",
  workshop: "#f0dcdc",
  staging: "#f6efd2",
  walls: "#e2dcf1",
  packing: "#d8e8ec",
  dispatch: "#ece8d4",
};

// Alturas de las capas del piso, de abajo hacia arriba, para que nada parpadee al superponerse
const LAYER = { ground: 0, road: 0.03, compound: 0.04, slab: 0.05, zone: 0.08, marking: 0.1 };
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
  const half = WORLD.half_size;
  add_flat(collector, -half, half, -half, half, LAYER.ground, COLORS.grass, 0.2);

  // Carreteras con su línea central discontinua: salen de la pantalla en cualquier equipo
  road_segments().forEach((road) => {
    add_flat(collector, road.x0, road.x1, road.z0, road.z1, LAYER.road, COLORS.road, 0.03);
    if (road.axis === "x") {
      const center = (road.z0 + road.z1) / 2;
      for (let x = road.x0 + 3; x < road.x1 - 3; x += 5) add_flat(collector, x, x + 2.4, center - 0.12, center + 0.12, LAYER.road + 0.01, COLORS.road_line, 0.01);
    } else {
      const center = (road.x0 + road.x1) / 2;
      for (let z = road.z0 + 3; z < road.z1 - 3; z += 5) add_flat(collector, center - 0.12, center + 0.12, z, z + 2.4, LAYER.road + 0.01, COLORS.road_line, 0.01);
    }
  });

  // El predio: un rectángulo de asfalto, con el edificio adentro
  add_flat(collector, COMPOUND.x0, COMPOUND.x1, COMPOUND.z0, COMPOUND.z1, LAYER.compound, COLORS.compound);
  add_flat(collector, BUILDING.x0, BUILDING.x1, BUILDING.z0, BUILDING.z1, LAYER.slab, COLORS.indoor_floor);

  layout.zones.forEach((zone) => {
    if (zone.kind === "yard") add_flat(collector, zone.x0, zone.x1, zone.z0, zone.z1, LAYER.zone, COLORS.yard);
    else if (ZONE_TINTS[zone.id]) add_flat(collector, zone.x0, zone.x1, zone.z0, zone.z1, LAYER.zone, ZONE_TINTS[zone.id]);
  });
}

// Las plazas del parqueadero de camiones: dos rayas largas y una de fondo por plaza
function add_parking(collector, layout) {
  layout.parking_bays.forEach((bay) => {
    const half_length = 6;
    const half_width = 1.7;
    const back = bay.yaw === 0 ? bay.x - half_length : bay.x + half_length;
    add_flat(collector, bay.x - half_length, bay.x + half_length, bay.z - half_width - 0.06, bay.z - half_width + 0.06, LAYER.marking, COLORS.road_line, 0.02);
    add_flat(collector, bay.x - half_length, bay.x + half_length, bay.z + half_width - 0.06, bay.z + half_width + 0.06, LAYER.marking, COLORS.road_line, 0.02);
    add_flat(collector, back - 0.06, back + 0.06, bay.z - half_width, bay.z + half_width, LAYER.marking, COLORS.road_line, 0.02);
  });
}

// La valla de alambre que cierra el predio: postes, cinco hilos y un larguero arriba
function add_fence_run(collector, axis, fixed, start, end) {
  const height = 2.4;
  const wire_levels = [0.35, 0.8, 1.25, 1.7, 2.15];
  const length = end - start;
  if (length < 0.5) return;
  const middle = (start + end) / 2;
  const post_count = Math.max(2, Math.round(length / 4) + 1);
  for (let index = 0; index < post_count; index += 1) {
    const at = start + (length * index) / (post_count - 1);
    if (axis === "x") collector.add_box(at, height / 2, fixed, 0.14, height, 0.14, COLORS.fence_post);
    else collector.add_box(fixed, height / 2, at, 0.14, height, 0.14, COLORS.fence_post);
  }
  wire_levels.forEach((level) => {
    if (axis === "x") collector.add_box(middle, level, fixed, length, 0.03, 0.03, COLORS.fence);
    else collector.add_box(fixed, level, middle, 0.03, 0.03, length, COLORS.fence);
  });
  if (axis === "x") collector.add_box(middle, height, fixed, length, 0.08, 0.08, COLORS.fence_post);
  else collector.add_box(fixed, height, middle, 0.08, 0.08, length, COLORS.fence_post);
}

// El predio queda sellado por todos lados; solo se abren los huecos de las dos garitas (a los lados del eje, 8 m)
function add_fence(collector) {
  const gap = 8;
  add_fence_run(collector, "x", COMPOUND.z0, COMPOUND.x0, COMPOUND.x1);
  add_fence_run(collector, "x", COMPOUND.z1, COMPOUND.x0, COMPOUND.x1);
  add_fence_run(collector, "z", COMPOUND.x0, COMPOUND.z0, -gap);
  add_fence_run(collector, "z", COMPOUND.x0, gap, COMPOUND.z1);
  add_fence_run(collector, "z", COMPOUND.x1, COMPOUND.z0, -gap);
  add_fence_run(collector, "z", COMPOUND.x1, gap, COMPOUND.z1);
}

// Las garitas estilo peaje: una isleta con la caseta entre los dos carriles, un techo sobre ambos y la base de cada talanquera
// (la barrera que sube y baja la dibuja scene_entities.js, porque se mueve)
function add_gates(collector) {
  Object.values(GATES).forEach((gate) => {
    collector.add_box(gate.x, 0.1, 0, 16, 0.2, 2.8, COLORS.wall_cap);
    collector.add_box(gate.x, 1.5, 0, 3.2, 2.8, 2.0, COLORS.wall);
    collector.add_box(gate.x, 1.9, 1.02, 2.4, 0.9, 0.06, COLORS.bumper);
    collector.add_box(gate.x, 1.9, -1.02, 2.4, 0.9, 0.06, COLORS.bumper);
    collector.add_box(gate.x, 3.0, 0, 3.6, 0.25, 2.4, COLORS.amber);
    // Techo del peaje sobre los dos carriles
    collector.add_box(gate.x, 5.4, 0, 10, 0.3, 17, COLORS.canopy);
    collector.add_box(gate.x, 5.25, 8.4, 10, 0.1, 0.3, COLORS.amber);
    collector.add_box(gate.x, 5.25, -8.4, 10, 0.1, 0.3, COLORS.amber);
    [-4, 4].forEach((dx) => [-8, 8].forEach((dz) => collector.add_box(gate.x + dx, 2.6, dz, 0.3, 5.2, 0.3, COLORS.steel)));
    [
      [gate.in_lane_z, gate.in_stop_x],
      [gate.out_lane_z, gate.out_stop_x],
    ].forEach(([lane_z, stop_x]) => {
      collector.add_box(gate.x, 0.55, Math.sign(lane_z) * 1.5, 0.3, 1.1, 0.3, COLORS.bumper);
      // Raya de pare un poco antes de la talanquera, del lado por donde llega el camión
      const stop_line = gate.x + (stop_x < gate.x ? -1.4 : 1.4);
      add_flat(collector, stop_line - 0.2, stop_line + 0.2, lane_z - 1.6, lane_z + 1.6, LAYER.marking, COLORS.road_line, 0.02);
    });
  });
}

// Los árboles: un solo modelo (tronco y dos copas) repetido por el terreno, cada uno con su tamaño y su tono de verde
function build_trees_mesh(THREE) {
  const parts = new PartCollector(THREE);
  parts.add_cylinder(0, 1.0, 0, 0.22, 0.3, 2.0, COLORS.trunk, 6);
  parts.add_cylinder(0, 3.0, 0, 0.1, 1.7, 2.8, COLORS.leaves_dark, 8);
  parts.add_cylinder(0, 4.7, 0, 0.05, 1.2, 2.4, COLORS.leaves_light, 8);
  const trees = build_trees();
  const mesh = new THREE.InstancedMesh(parts.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), trees.length);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  trees.forEach((tree, index) => {
    dummy.position.set(tree.x, 0, tree.z);
    dummy.scale.set(tree.scale, tree.scale, tree.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    tint.setRGB(tree.tint, tree.tint, tree.tint);
    mesh.setColorAt(index, tint);
  });
  mesh.name = "trees";
  mesh.frustumCulled = false;
  return mesh;
}

function add_customers(collector, layout) {
  const zone = layout.zones.find((candidate) => candidate.id === "customers");
  const center_x = (zone.x0 + zone.x1) / 2;
  const center_z = (zone.z0 + zone.z1) / 2;
  collector.add_box(center_x, 0.15, center_z, zone.x1 - zone.x0, 0.3, zone.z1 - zone.z0, COLORS.customers);
  // Casitas: cada pedido web nace sobre una de ellas
  [-16, -8, 0, 8, 16].forEach((dx, index) => {
    const z = center_z + (index % 2 === 0 ? 1.5 : -1.5);
    collector.add_box(center_x + dx, 1.5, z, 3.6, 2.4, 3.2, COLORS.house);
    collector.add_box(center_x + dx, 3.0, z, 4.2, 0.5, 3.8, COLORS.roof);
  });
  // Camino punteado desde los clientes hasta la valla del predio
  for (let z = zone.z1 + 2; z <= COMPOUND.z0 - 1; z += 2) collector.add_box(center_x, 0.12, z, 0.5, 0.04, 0.8, COLORS.road_line);
}

function add_building_walls(collector, layout) {
  add_wall_run(collector, "x", BUILDING.z0, BUILDING.x0, BUILDING.x1, [], 0);
  add_wall_run(collector, "x", BUILDING.z1, BUILDING.x0, BUILDING.x1, [], 0);
  add_wall_run(collector, "z", BUILDING.x0, BUILDING.z0, BUILDING.z1, layout.docks.map((dock) => dock.z), 4.2);
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
    // El puesto del pallet de descarga, al pie del riel
    add_flat(collector, dock.pallet_spot.x - 0.8, dock.pallet_spot.x + 0.8, dock.z - 0.75, dock.z + 0.75, LAYER.marking, COLORS.rail_yellow, 0.02);
  });
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

// El taller de montacargas: una franja pegada a la pared sur con diez puestos para las de muelle a stock (naranja) y diez para las de
// stock a racks y multinivel (azul)
function add_workshop(collector, layout) {
  const zone = layout.zones.find((candidate) => candidate.id === "workshop");
  const wall_color = COLORS.wall;
  collector.add_box(zone.x0, 0.6, (zone.z0 + zone.z1) / 2, 0.2, 1.2, zone.z1 - zone.z0, wall_color);
  collector.add_box(zone.x1, 0.6, (zone.z0 + zone.z1) / 2, 0.2, 1.2, zone.z1 - zone.z0, wall_color);
  [[PARK_SPOTS_DOCK, "#fbd38d"], [PARK_SPOTS_STOCK, "#93c5fd"]].forEach(([spots, color]) => {
    spots.forEach((spot) => add_flat(collector, spot.x - 0.7, spot.x + 0.7, spot.z - 1.3, spot.z + 1.3, LAYER.marking, color, 0.02));
  });
}

// La bodega de recibo: muros bajos al sur y al este; al oeste, una pared con un hueco en cada andén por donde entran las
// montacargas de muelle a stock; al norte queda abierta hacia el carril de las de stock a racks y multinivel. En el piso, el cuadro de
// cada pila con el color de su categoría y los puestos de la franja de armado (pallets y cubetas).
function add_staging(collector, layout) {
  const zone = layout.zones.find((candidate) => candidate.id === "staging");
  const wall_color = COLORS.wall;
  collector.add_box((zone.x0 + zone.x1) / 2, 0.6, zone.z1, zone.x1 - zone.x0, 1.2, 0.2, wall_color);
  collector.add_box(zone.x1, 0.6, (zone.z0 + zone.z1) / 2, 0.2, 1.2, zone.z1 - zone.z0, wall_color);
  const gap = 2.6;
  let cursor = zone.z0;
  UNLOAD_BAYS.forEach((bay) => {
    const end = bay.z - gap / 2;
    if (end - cursor > 0.05) collector.add_box(zone.x0, 0.6, (cursor + end) / 2, 0.2, 1.2, end - cursor, wall_color);
    cursor = bay.z + gap / 2;
  });
  if (zone.z1 - cursor > 0.05) collector.add_box(zone.x0, 0.6, (cursor + zone.z1) / 2, 0.2, 1.2, zone.z1 - cursor, wall_color);
  for (let sku = 0; sku < SKU_COUNT; sku += 1) {
    const slot = staging_slot(sku);
    const half_width = STAGING.pile_width / 2 + 0.25;
    // Los cuadros no se tocan entre filas (el paso en z es 2,4 m), para que no peleen por la misma altura
    const half_depth = STAGING.pile_depth / 2 + 0.05;
    add_flat(collector, slot.x - half_width, slot.x + half_width, slot.z - half_depth, slot.z + half_depth, LAYER.marking, CATEGORY_TONES[sku % CATEGORY_TONES.length], 0.02);
  }
  PALLET_SPOTS.forEach((spot) => add_flat(collector, spot.x - 0.7, spot.x + 0.7, spot.z - 0.6, spot.z + 0.6, LAYER.marking, COLORS.rail_yellow, 0.02));
  TOTE_STATIONS.forEach((spot) => add_flat(collector, spot.x - 0.65, spot.x + 0.65, spot.z - 0.5, spot.z + 0.5, LAYER.marking, "#7dd3fc", 0.02));
}

// El cuadro de cada pila de despacho en el piso, con el color suave de su región
function add_dispatch_bins(collector) {
  DESTINATIONS.forEach((destination) => {
    const slot = dispatch_bin_slot(destination.index);
    const half = DISPATCH_BINS.size / 2 + 0.2;
    add_flat(collector, slot.x - half, slot.x + half, slot.z - half, slot.z + half, LAYER.marking, lighten(destination.color, 0.75), 0.02);
  });
}

function add_grid(THREE) {
  const vertices = [];
  const step = 5;
  for (let x = Math.ceil(COMPOUND.x0 / step) * step; x <= COMPOUND.x1; x += step) vertices.push(x, 0.115, COMPOUND.z0, x, 0.115, COMPOUND.z1);
  for (let z = Math.ceil(COMPOUND.z0 / step) * step; z <= COMPOUND.z1; z += step) vertices.push(COMPOUND.x0, 0.115, z, COMPOUND.x1, 0.115, z);
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
// El número de cada muelle, para saber de cuál se habla en la configuración del patio: un círculo que siempre mira a la cámara
function build_dock_labels(THREE, layout) {
  return layout.docks.map((dock, index) => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    context.fillStyle = "rgba(11, 18, 32, 0.92)";
    context.beginPath();
    context.arc(48, 48, 44, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = 6;
    context.strokeStyle = "#22d3ee";
    context.stroke();
    context.fillStyle = "#f8fafc";
    context.font = "700 52px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(index + 1), 48, 52);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.position.set(dock.x - 1.2, 3.6, dock.z);
    sprite.name = `dock_label_${index + 1}`;
    sprite.renderOrder = 9;
    return { sprite, dock_index: index };
  });
}

export function build_static_scene(THREE, layout) {
  const collector = new PartCollector(THREE);
  add_terrain(collector, layout);
  add_parking(collector, layout);
  add_fence(collector);
  add_gates(collector);
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
  add_staging(collector, layout);
  add_dispatch_bins(collector);
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
  group.add(build_trees_mesh(THREE));
  signs.forEach((sign) => group.add(sign.sprite));
  const dock_labels = build_dock_labels(THREE, layout);
  dock_labels.forEach((label) => group.add(label.sprite));
  return { group, signs, dock_labels, mesh, vertex_count: collector.vertex_count };
}
