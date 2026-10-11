// Todo lo que se mueve o cambia en la escena: cajas, pallets, cubetas, paquetes, camiones, montacargas, personas, el elevador,
// las casillas de los muros, los avisos y los destellos. Cada tipo vive en un `InstancedMesh` con un tamaño fijo (un pool): en
// cada cuadro se escribe la posición de lo que existe y se ajusta cuántas instancias se dibujan, sin crear ni destruir mallas.
//
// El dibujo interpola entre la posición anterior y la actual de cada cosa (ver Renderable en entities.js) para que el movimiento
// sea continuo aunque la simulación avance en pasos de 0,25 s.

import { PartCollector } from "./geometry_parts.js";
import { sku_color } from "./config.js";
import { lerp_angle } from "./path_tools.js";
import { ACTIVE, TRUCK } from "./layout.js";

const BOX_SIZE = 0.55;
const BOX_SIZE_IN_SLOT = 0.42;
// Estados en que una caja se dibuja por sí sola; en un pallet, una cubeta o un camión la dibuja su contenedor
const BOX_VISIBLE_STATES = new Set(["ON_RAIL", "AT_RECEIVING", "IN_ACTIVE", "PICKED", "ON_FLOOR_BELT", "ON_MAIN_BELT", "IN_WALL_SLOT"]);
const POOLS = { boxes: 2600, pallets: 560, totes: 180, parcels: 220, trucks: 28, forklifts: 12, workers: 90, slots: 130, markers: 24, flashes: 28, leds: 32 };
// Lo que solo adorna no se elige con el puntero
const NOT_PICKABLE = new Set(["wheels", "beacons", "markers", "leds", "flashes", "forks", "truck_doors"]);
const MAX_LABELS = 36;
const LABEL_ZOOM = 2.2;
const CART_POOL = 12;
const CART_SECONDS = 10;
const ALERT_POOL = 18;
const TOTE_IN_COLOR = "#3b82f6";
const TOTE_OUT_COLOR = "#a855f7";
const ROLE_COLORS = { picker: "#38bdf8", wall: "#c4b5fd", packer: "#34d399" };
const SLOT_COLORS = { disabled: "#1f2937", FREE: "#f8fafc", ASSIGNED: "#fbbf24", COMPLETE: "#34d399", EMPTYING: "#22d3ee", problem: "#f87171" };
const LED_COLORS = { running: "#22c55e", stalled: "#f59e0b", stopped: "#ef4444" };
// Dónde nacen los pedidos web: sobre las casitas de la zona de clientes
const CUSTOMER_HOUSES = [-16, -8, 0, 8, 16];

class Pool {
  constructor(THREE, name, geometry, material, capacity, shadow = false) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = name;
    // La caja envolvente de un InstancedMesh no se actualiza sola: se desactiva el recorte por cámara
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadow;
    this.mesh.count = 0;
    this.capacity = capacity;
    this.count = 0;
    this.entities = new Array(capacity);
  }

  begin() {
    this.count = 0;
  }

  end() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get is_full() {
    return this.count >= this.capacity;
  }
}

export function build_entity_layer(THREE, scene, layout) {
  const group = new THREE.Group();
  group.name = "entities";
  scene.add(group);

  const dummy = new THREE.Object3D();
  const matrix_a = new THREE.Matrix4();
  const matrix_b = new THREE.Matrix4();
  const matrix_c = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const axis_y = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const unit_scale = new THREE.Vector3(1, 1, 1);
  const color_cache = new Map();
  const spot = { x: 0, y: 0, z: 0, yaw: 0 };
  const fade_colors = Array.from({ length: 11 }, (_, step) => new THREE.Color(step / 10, step / 10, step / 10));

  function color_of(hex) {
    let color = color_cache.get(hex);
    if (!color) {
      color = new THREE.Color(hex);
      color_cache.set(hex, color);
    }
    return color;
  }

  // ---------- Geometrías ----------
  const unit_box = new THREE.BoxGeometry(1, 1, 1);
  const instance_material = (options = {}) => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.75, metalness: 0.02, ...options });

  const parcel_parts = new PartCollector(THREE);
  parcel_parts.add_box(0, 0, 0, 0.85, 0.55, 0.65, "#c9a468");
  parcel_parts.add_box(0, 0.001, 0, 0.14, 0.56, 0.66, "#f8fafc");
  parcel_parts.add_box(0.2, 0.28, 0.1, 0.25, 0.01, 0.2, "#e2e8f0");
  const parcel_geometry = parcel_parts.build();

  const truck_body_parts = new PartCollector(THREE);
  truck_body_parts.add_box(-1.4, 2.15, 0, 8.3, 2.5, 2.6, "#f1f5f9");
  truck_body_parts.add_box(-1.4, 3.42, 0, 8.1, 0.06, 2.2, "#cbd5e1");
  truck_body_parts.add_box(-0.1, 0.7, 0, 10.6, 0.3, 1.6, "#1f2937");
  [-4.2, -3.0, 3.8].forEach((x) => [-1.15, 1.15].forEach((z) => truck_body_parts.add_cylinder_z(x, 0.5, z, 0.5, 0.36, "#111827", 12)));
  const truck_body_geometry = truck_body_parts.build();

  const truck_cab_parts = new PartCollector(THREE);
  truck_cab_parts.add_box(4.2, 1.75, 0, 2.4, 2.3, 2.5, "#ffffff");
  truck_cab_parts.add_box(5.38, 2.1, 0, 0.06, 0.9, 2.1, "#1e293b");
  [-1.26, 1.26].forEach((z) => truck_cab_parts.add_box(4.5, 2.15, z, 1.2, 0.8, 0.06, "#1e293b"));
  truck_cab_parts.add_box(5.45, 0.75, 0, 0.2, 0.35, 2.5, "#334155");
  const truck_cab_geometry = truck_cab_parts.build();

  const truck_door_parts = new PartCollector(THREE);
  truck_door_parts.add_box(0, 1.2, -1.25, 0.08, 2.4, 2.5, "#e2e8f0");
  const truck_door_geometry = truck_door_parts.build();

  const forklift_body_parts = new PartCollector(THREE);
  forklift_body_parts.add_box(-0.25, 0.55, 0, 1.6, 0.6, 1.1, "#f59e0b");
  forklift_body_parts.add_box(-1.0, 0.75, 0, 0.5, 0.9, 1.1, "#d97706");
  forklift_body_parts.add_box(-0.35, 1.05, 0, 0.6, 0.3, 0.7, "#1f2937");
  [0.4, -0.85].forEach((x) => [-0.45, 0.45].forEach((z) => forklift_body_parts.add_box(x, 1.7, z, 0.06, 1.2, 0.06, "#374151")));
  forklift_body_parts.add_box(-0.22, 2.3, 0, 1.4, 0.06, 1.0, "#374151");
  [-0.35, 0.35].forEach((z) => forklift_body_parts.add_box(0.95, 1.3, z, 0.1, 2.4, 0.1, "#374151"));
  const forklift_body_geometry = forklift_body_parts.build();

  const fork_parts = new PartCollector(THREE);
  [-0.3, 0.3].forEach((z) => fork_parts.add_box(1.3, 0.06, z, 1.4, 0.08, 0.14, "#9ca3af"));
  fork_parts.add_box(0.98, 0.45, 0, 0.06, 0.9, 0.9, "#6b7280");
  const fork_geometry = fork_parts.build();

  const wheel_geometry = new THREE.CylinderGeometry(0.26, 0.26, 0.2, 12);
  wheel_geometry.rotateX(Math.PI / 2);
  const beacon_geometry = new THREE.SphereGeometry(0.1, 8, 6);
  const worker_body_geometry = new THREE.CylinderGeometry(0.2, 0.2, 1.0, 10);
  const worker_head_geometry = new THREE.SphereGeometry(0.17, 10, 8);
  const led_geometry = new THREE.SphereGeometry(0.17, 8, 6);
  const flash_geometry = new THREE.SphereGeometry(0.5, 10, 8);
  const pallet_base_geometry = unit_box;

  // ---------- Pools ----------
  const pools = {};
  const add_pool = (name, geometry, material, capacity, shadow) => {
    pools[name] = new Pool(THREE, name, geometry, material, capacity, shadow);
    group.add(pools[name].mesh);
    return pools[name];
  };
  const vertex_material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.03 });
  const basic = (options) => new THREE.MeshBasicMaterial(options);

  add_pool("boxes", unit_box, instance_material(), POOLS.boxes);
  add_pool("pallet_bases", pallet_base_geometry, instance_material({ color: "#b99b6b" }), POOLS.pallets);
  add_pool("pallet_loads", unit_box, instance_material(), POOLS.pallets);
  add_pool("tote_bodies", unit_box, instance_material(), POOLS.totes);
  add_pool("tote_fills", unit_box, instance_material(), POOLS.totes);
  add_pool("parcels", parcel_geometry, vertex_material, POOLS.parcels);
  add_pool("truck_bodies", truck_body_geometry, vertex_material, POOLS.trucks, true);
  add_pool("truck_cabs", truck_cab_geometry, instance_material({ vertexColors: true }), POOLS.trucks, true);
  add_pool("truck_doors", truck_door_geometry, vertex_material, POOLS.trucks);
  add_pool("forklift_bodies", forklift_body_geometry, vertex_material, POOLS.forklifts, true);
  add_pool("forks", fork_geometry, vertex_material, POOLS.forklifts);
  add_pool("wheels", wheel_geometry, instance_material({ color: "#111827" }), POOLS.forklifts * 4);
  add_pool("beacons", beacon_geometry, basic({ color: "#ffffff" }), POOLS.forklifts);
  add_pool("worker_bodies", worker_body_geometry, instance_material(), POOLS.workers);
  add_pool("worker_heads", worker_head_geometry, instance_material({ color: "#f3c9a1" }), POOLS.workers);
  add_pool("slots", unit_box, instance_material({ roughness: 0.6 }), POOLS.slots);
  add_pool("markers", unit_box, basic({ color: "#0b1220", transparent: true, opacity: 0.82 }), POOLS.markers);
  add_pool("leds", led_geometry, basic({ color: "#ffffff" }), POOLS.leds);
  add_pool("flashes", flash_geometry, basic({ color: "#ffffff", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), POOLS.flashes);

  // El elevador: una sola cabina
  const cabin = new THREE.Mesh(unit_box, instance_material({ color: "#f59e0b" }));
  cabin.scale.set(1.7, 0.9, 1.7);
  cabin.name = "elevator_cabin";
  cabin.castShadow = true;
  group.add(cabin);

  // Piezas invisibles que solo sirven para elegir con el clic lo que no tiene una malla propia: bandas, muelles, puertas,
  // estaciones y muros
  const proxy_entities = [];
  const proxy_boxes = [];
  const proxy_count_hint = layout.belts.length * 4 + 80 + layout.walls.length * layout.walls[0].slots.length;
  const proxy_mesh = new THREE.InstancedMesh(unit_box, new THREE.MeshBasicMaterial({ visible: false }), proxy_count_hint + 40);
  proxy_mesh.visible = false;
  proxy_mesh.frustumCulled = false;
  proxy_mesh.name = "proxies";
  group.add(proxy_mesh);

  // ---------- Marcadores de cerrado: dónde van ----------
  const marker_slots = [];
  layout.docks.forEach((dock, index) => marker_slots.push({ kind: "dock", index, x: dock.x - 0.1, y: 1.9, z: dock.z, sx: 0.5, sy: 3.8, sz: 4.6 }));
  layout.doors.forEach((door, index) => marker_slots.push({ kind: "door", index, x: door.x + 0.1, y: 1.9, z: door.z, sx: 0.5, sy: 3.8, sz: 4.6 }));
  layout.pack_stations.forEach((station, index) => marker_slots.push({ kind: "station", index, x: station.x, y: 0.7, z: station.z, sx: 3.4, sy: 1.5, sz: 2.2 }));

  // ---------- Avisos sobre la escena ----------
  function make_canvas_texture(draw, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext("2d"), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  const alert_texture = make_canvas_texture((context, width, height) => {
    context.fillStyle = "#ef4444";
    context.beginPath();
    context.arc(width / 2, height / 2, width / 2 - 4, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = 6;
    context.strokeStyle = "#ffffff";
    context.stroke();
    context.fillStyle = "#ffffff";
    context.font = "bold 80px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("!", width / 2, height / 2 + 4);
  }, 128, 128);
  const warn_texture = make_canvas_texture((context, width, height) => {
    context.fillStyle = "#f59e0b";
    context.beginPath();
    context.arc(width / 2, height / 2, width / 2 - 4, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = 6;
    context.strokeStyle = "#1f2937";
    context.stroke();
    context.fillStyle = "#1f2937";
    context.font = "bold 80px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("!", width / 2, height / 2 + 4);
  }, 128, 128);
  const wrench_texture = make_canvas_texture((context, width, height) => {
    context.fillStyle = "#1f2937";
    context.beginPath();
    context.arc(width / 2, height / 2, width / 2 - 4, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = 6;
    context.strokeStyle = "#f59e0b";
    context.stroke();
    context.fillStyle = "#f59e0b";
    context.font = "64px system-ui, 'Segoe UI Emoji', sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("🔧", width / 2, height / 2 + 4);
  }, 128, 128);
  const icon_materials = {
    danger: new THREE.SpriteMaterial({ map: alert_texture, depthTest: false, transparent: true }),
    warn: new THREE.SpriteMaterial({ map: warn_texture, depthTest: false, transparent: true }),
    wrench: new THREE.SpriteMaterial({ map: wrench_texture, depthTest: false, transparent: true }),
  };
  const alert_sprites = Array.from({ length: ALERT_POOL }, () => {
    const sprite = new THREE.Sprite(icon_materials.danger);
    sprite.visible = false;
    sprite.renderOrder = 30;
    group.add(sprite);
    return sprite;
  });

  // Pedidos web: un carrito con el número que flota sobre la zona de clientes y una línea punteada hacia la bodega
  const cart_items = Array.from({ length: CART_POOL }, () => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    sprite.visible = false;
    sprite.renderOrder = 28;
    group.add(sprite);
    const line_geometry = new THREE.BufferGeometry();
    line_geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const line = new THREE.Line(line_geometry, new THREE.LineDashedMaterial({ color: "#22d3ee", dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: 0.85 }));
    line.visible = false;
    line.frustumCulled = false;
    group.add(line);
    return { canvas, texture, sprite, line, born: -1, order_id: 0, x: 0 };
  });
  let cart_cursor = 0;

  function draw_cart(item, order_id) {
    const context = item.canvas.getContext("2d");
    context.clearRect(0, 0, 256, 64);
    context.fillStyle = "rgba(11, 18, 32, 0.92)";
    context.beginPath();
    context.roundRect(2, 2, 252, 60, 14);
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = "#22d3ee";
    context.stroke();
    context.fillStyle = "#f8fafc";
    context.font = "600 30px system-ui, 'Segoe UI Emoji', sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(`🛒 pedido #${order_id}`, 128, 34);
    item.texture.needsUpdate = true;
  }

  // Etiquetas con el número de pedido, visibles solo al acercarse
  const label_cache = new Map();
  function label_texture(text) {
    let entry = label_cache.get(text);
    if (entry) {
      // Se vuelve a poner al final para que los más usados no se borren
      label_cache.delete(text);
      label_cache.set(text, entry);
      return entry;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 48;
    const context = canvas.getContext("2d");
    context.fillStyle = "rgba(11, 18, 32, 0.9)";
    context.beginPath();
    context.roundRect(1, 1, 158, 46, 10);
    context.fill();
    context.fillStyle = "#f8fafc";
    context.font = "600 28px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 80, 25);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    entry = { texture, material: new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }) };
    label_cache.set(text, entry);
    if (label_cache.size > 260) {
      const [oldest_key, oldest] = label_cache.entries().next().value;
      label_cache.delete(oldest_key);
      oldest.texture.dispose();
      oldest.material.dispose();
    }
    return entry;
  }
  const label_sprites = Array.from({ length: MAX_LABELS }, () => {
    const sprite = new THREE.Sprite(icon_materials.warn);
    sprite.visible = false;
    sprite.renderOrder = 26;
    group.add(sprite);
    return sprite;
  });

  // Contorno del elemento elegido
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(unit_box), new THREE.LineBasicMaterial({ color: "#22d3ee", depthTest: false }));
  outline.visible = false;
  outline.renderOrder = 25;
  group.add(outline);
  let selected = null;

  // ---------- Escritura de instancias ----------
  let alpha = 0;

  function place(entity) {
    spot.x = entity.prev_x + (entity.x - entity.prev_x) * alpha;
    spot.y = entity.prev_y + (entity.y - entity.prev_y) * alpha;
    spot.z = entity.prev_z + (entity.z - entity.prev_z) * alpha;
    spot.yaw = lerp_angle(entity.prev_yaw, entity.yaw, alpha);
    return spot;
  }

  function put(pool, entity, x, y, z, yaw, sx, sy, sz, hex) {
    if (pool.is_full) return;
    const index = pool.count;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    pool.mesh.setMatrixAt(index, dummy.matrix);
    if (hex) pool.mesh.setColorAt(index, color_of(hex));
    pool.entities[index] = entity;
    pool.count += 1;
  }

  // La matriz de un vehículo: posición y giro, sin escala
  function vehicle_matrix(target, x, y, z, yaw) {
    position.set(x, y, z);
    quaternion.setFromAxisAngle(axis_y, yaw);
    return target.compose(position, quaternion, unit_scale);
  }

  function put_matrix(pool, entity, matrix, hex) {
    if (pool.is_full) return;
    const index = pool.count;
    pool.mesh.setMatrixAt(index, matrix);
    if (hex) pool.mesh.setColorAt(index, color_of(hex));
    pool.entities[index] = entity;
    pool.count += 1;
  }

  // ---------- Un cuadro ----------
  function sync_boxes(sim) {
    const pool = pools.boxes;
    pool.begin();
    for (const box of sim.boxes) {
      if (!BOX_VISIBLE_STATES.has(box.machine.state)) continue;
      const p = place(box);
      const in_slot = box.machine.state === "IN_WALL_SLOT";
      const size = in_slot ? BOX_SIZE_IN_SLOT : BOX_SIZE;
      // En una banda la posición es la de la superficie; la caja se apoya encima
      const lift = box.belt ? size / 2 + 0.03 : 0;
      put(pool, box, p.x, p.y + lift, p.z, p.yaw, size, size, size, sku_color(box.sku_id));
    }
    pool.end();
  }

  function sync_pallets(sim) {
    const bases = pools.pallet_bases;
    const loads = pools.pallet_loads;
    bases.begin();
    loads.begin();
    for (const pallet of sim.pallets) {
      const p = place(pallet);
      put(bases, pallet, p.x, p.y, p.z, p.yaw, 1.2, 0.14, 1.0);
      const count = pallet.boxes.length;
      if (count > 0) {
        const height = 0.12 + 1.0 * Math.min(1, count / pallet.capacity);
        put(loads, pallet, p.x, p.y + 0.07 + height / 2, p.z, p.yaw, 1.0, height, 0.85, sku_color(pallet.sku_id));
      }
    }
    bases.end();
    loads.end();
  }

  function sync_totes(sim) {
    const bodies = pools.tote_bodies;
    const fills = pools.tote_fills;
    bodies.begin();
    fills.begin();
    for (const tote of sim.totes) {
      const p = place(tote);
      const lift = tote.belt ? 0.2 : 0;
      put(bodies, tote, p.x, p.y + lift, p.z, p.yaw, 0.95, 0.34, 0.62, tote.variant === "in" ? TOTE_IN_COLOR : TOTE_OUT_COLOR);
      const fill = Math.min(1, tote.boxes.length / (tote.variant === "in" ? tote.capacity : Math.max(1, tote.order ? tote.order.lines.length : 4)));
      if (tote.boxes.length > 0) {
        const hex = tote.variant === "in" ? sku_color(tote.boxes[0].sku_id) : "#34d399";
        put(fills, tote, p.x, p.y + lift + 0.17 + 0.06 + 0.1 * fill, p.z, p.yaw, 0.8, 0.12 + 0.2 * fill, 0.5, hex);
      }
    }
    bodies.end();
    fills.end();
  }

  function sync_parcels(sim) {
    const pool = pools.parcels;
    pool.begin();
    for (const parcel of sim.parcels) {
      const p = place(parcel);
      const lift = parcel.belt ? 0.31 : 0;
      put(pool, parcel, p.x, p.y + lift, p.z, p.yaw, 1, 1, 1);
    }
    pool.end();
  }

  function sync_trucks(sim) {
    const bodies = pools.truck_bodies;
    const cabs = pools.truck_cabs;
    const doors = pools.truck_doors;
    bodies.begin();
    cabs.begin();
    doors.begin();
    const trucks = [...sim.receiving.trucks, ...sim.outbound.trucks];
    for (const truck of trucks) {
      const p = place(truck);
      vehicle_matrix(matrix_a, p.x, 0, p.z, p.yaw);
      put_matrix(bodies, truck, matrix_a);
      put_matrix(cabs, truck, matrix_a, truck.cab_color);
      // La puerta trasera gira sobre su bisagra
      matrix_b.makeTranslation(-5.55, 0.95, TRUCK.width / 2 - 0.05);
      matrix_c.makeRotationY(truck.door_open * 1.8);
      matrix_c.premultiply(matrix_b);
      matrix_c.premultiply(matrix_a);
      put_matrix(doors, truck, matrix_c);
    }
    bodies.end();
    cabs.end();
    doors.end();
  }

  function sync_forklifts(sim, time, view) {
    const bodies = pools.forklift_bodies;
    const forks = pools.forks;
    const wheels = pools.wheels;
    const beacons = pools.beacons;
    bodies.begin();
    forks.begin();
    wheels.begin();
    beacons.begin();
    for (const forklift of sim.storage.forklifts) {
      const p = place(forklift);
      vehicle_matrix(matrix_a, p.x, 0, p.z, p.yaw);
      put_matrix(bodies, forklift, matrix_a);
      matrix_b.makeTranslation(0, forklift.fork_height, 0);
      matrix_b.premultiply(matrix_a);
      put_matrix(forks, forklift, matrix_b);
      // Las ruedas giran con lo que avanza el montacarga
      [[0.55, 0.62], [0.55, -0.62], [-0.7, 0.62], [-0.7, -0.62]].forEach(([x, z]) => {
        matrix_b.makeRotationZ(-forklift.wheel_angle);
        matrix_c.makeTranslation(x, 0.26, z);
        matrix_b.premultiply(matrix_c);
        matrix_b.premultiply(matrix_a);
        put_matrix(wheels, forklift, matrix_b);
      });
      // Luz giratoria ámbar: parpadea mientras trabaja
      // Con movimiento reducido la luz no parpadea: queda fija mientras trabaja
      const on = forklift.is_busy && (view.reduced_motion || Math.sin(time * 9) > -0.2);
      matrix_b.makeTranslation(-0.7, 2.4, 0);
      matrix_b.premultiply(matrix_a);
      put_matrix(beacons, forklift, matrix_b, on ? "#fbbf24" : "#78716c");
    }
    bodies.end();
    forks.end();
    wheels.end();
    beacons.end();
  }

  function sync_workers(sim) {
    const bodies = pools.worker_bodies;
    const heads = pools.worker_heads;
    bodies.begin();
    heads.begin();
    const add = (worker) => {
      const p = place(worker);
      // Una persona se agacha un poco mientras toma o empaca
      put(bodies, worker, p.x, p.y + 0.5, p.z, p.yaw, 1, 1, 1, ROLE_COLORS[worker.role]);
      put(heads, worker, p.x, p.y + 1.18, p.z, p.yaw, 1, 1, 1);
    };
    sim.orders.pickers.forEach((list) => list.forEach(add));
    sim.outbound.operators.forEach(add);
    sim.outbound.packers.forEach(add);
    bodies.end();
    heads.end();
  }

  function sync_slots_and_markers(sim) {
    const slots = pools.slots;
    slots.begin();
    const blocked_orders = new Set(sim.alerts.filter((alert) => alert.order_id !== undefined).map((alert) => alert.order_id));
    sim.orders.walls.forEach((wall) => {
      // La luz de estado va en el borde de la bandeja, del lado de la banda principal
      const direction = wall.layout.side === "west" ? 1 : -1;
      wall.slots.forEach((slot) => {
        let key = "disabled";
        if (slot.enabled) key = slot.order && blocked_orders.has(slot.order.id) && slot.machine.state !== "COMPLETE" ? "problem" : slot.machine.state;
        put(slots, slot, slot.position.x + direction * 0.33, slot.position.y + 0.17, slot.position.z, 0, 0.06, 0.28, Math.max(0.28, wall.layout.slot_pitch - 0.16), SLOT_COLORS[key] || SLOT_COLORS.FREE);
      });
    });
    slots.end();

    const markers = pools.markers;
    markers.begin();
    marker_slots.forEach((marker) => {
      let closed = false;
      let entity = null;
      if (marker.kind === "dock") {
        entity = sim.receiving.docks[marker.index];
        closed = !entity.enabled && !entity.truck;
      } else if (marker.kind === "door") {
        entity = sim.outbound.doors[marker.index];
        closed = !entity.enabled && !entity.truck;
      } else {
        entity = sim.outbound.stations[marker.index];
        closed = !entity.enabled && entity.machine.state === "FREE";
      }
      if (closed) put(markers, entity, marker.x, marker.y, marker.z, 0, marker.sx, marker.sy, marker.sz);
    });
    markers.end();
  }

  function sync_leds(sim) {
    const pool = pools.leds;
    pool.begin();
    sim.belts.forEach((belt) => {
      if (belt.kind === "rail") return;
      let hex = LED_COLORS.running;
      if (!belt.is_running) hex = LED_COLORS.stopped;
      else if (belt.is_stalled) hex = LED_COLORS.stalled;
      if (belt === sim.orders.main && sim.orders.wall_jam_active) hex = LED_COLORS.stopped;
      if (!belt.led_point) {
        // Un punto cerca del inicio de la banda donde se vea el LED
        const index = Math.min(belt.path.points.length - 1, belt.kind === "main" ? belt.path.points.length - 3 : 0);
        const point = belt.path.points[index];
        belt.led_point = { x: point.x, y: point.y + 1.1, z: point.z };
      }
      put(pool, belt, belt.led_point.x, belt.led_point.y, belt.led_point.z, 0, 1, 1, 1, hex);
    });
    pool.end();
  }

  function sync_flashes(sim, view) {
    const pool = pools.flashes;
    pool.begin();
    sim.effects.forEach((effect) => {
      const age = Math.min(1, (sim.now - effect.born) / 1.2);
      const scale = view.reduced_motion ? 0.7 : 0.35 + age * 1.1;
      const fade = Math.max(0, 1 - age);
      dummy.position.set(effect.x, effect.y, effect.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      if (pool.is_full) return;
      pool.mesh.setMatrixAt(pool.count, dummy.matrix);
      // Con mezcla aditiva, un color más oscuro es más transparente: así el destello se apaga
      pool.mesh.setColorAt(pool.count, fade_colors[Math.round(fade * 10)]);
      pool.entities[pool.count] = null;
      pool.count += 1;
    });
    pool.end();
  }

  function sync_elevator(sim) {
    const elevator = sim.storage.elevator;
    const y = elevator.prev_y + (elevator.y - elevator.prev_y) * alpha;
    cabin.position.set(elevator.x, y + 0.45, elevator.z);
  }

  // Avisos (!) sobre lo que está mal: se recalculan con las alertas
  let icon_signature = "";
  let icon_list = [];
  function update_icon_list(sim) {
    const signature = `${sim.alerts.map((alert) => alert.key).join(",")}|${sim.disruptions.is_active("belt_down")}|${sim.storage.forklifts.map((forklift) => forklift.machine.state === "MAINTENANCE").join("")}`;
    if (signature === icon_signature) return;
    icon_signature = signature;
    icon_list = [];
    sim.alerts.forEach((alert) => {
      if (alert.key === "wall_jam" && sim.orders.jam_box) icon_list.push({ kind: "danger", entity: sim.orders.jam_box, height: 1.4 });
      else if (alert.key === "reserve_full") icon_list.push({ kind: "warn", point: { x: -26, y: 7.5, z: -10 } });
      else if (alert.key.startsWith("blocked_")) {
        const order = sim.orders.orders.find((candidate) => candidate.id === alert.order_id);
        if (order && order.slot) icon_list.push({ kind: "danger", entity: order.slot, height: 1.7 });
        else if (order) {
          const line = order.lines.find((candidate) => candidate.box);
          if (line) icon_list.push({ kind: "danger", entity: line.box, height: 1.4 });
          else icon_list.push({ kind: "danger", point: { x: ACTIVE.x0 + 14, y: 14.5, z: ACTIVE.belt_z } });
        }
      } else if (alert.key.startsWith("no_stock_")) icon_list.push({ kind: "warn", point: { x: ACTIVE.x0 + 14, y: 14.5, z: ACTIVE.z0 - 1 } });
    });
    if (sim.disruptions.is_active("belt_down")) icon_list.push({ kind: "danger", point: { x: 30, y: 2.6, z: -20.5 } });
    sim.storage.forklifts.forEach((forklift) => {
      if (forklift.machine.state === "MAINTENANCE") icon_list.push({ kind: "wrench", entity: forklift, height: 3.3 });
    });
  }

  function sync_icons(sim, view) {
    update_icon_list(sim);
    const size = 26 * view.meters_per_pixel;
    alert_sprites.forEach((sprite, index) => {
      const item = icon_list[index];
      if (!item) {
        sprite.visible = false;
        return;
      }
      if (item.entity) {
        const p = place(item.entity);
        sprite.position.set(p.x, p.y + item.height, p.z);
      } else {
        sprite.position.set(item.point.x, item.point.y, item.point.z);
      }
      sprite.material = icon_materials[item.kind];
      sprite.scale.set(size, size, 1);
      sprite.visible = true;
    });
  }

  // Los pedidos nuevos aparecen con su carrito
  function on_events(events, now) {
    events.forEach((event) => {
      if (event.type !== "order_created") return;
      const item = cart_items[cart_cursor];
      cart_cursor = (cart_cursor + 1) % CART_POOL;
      item.born = now;
      item.order_id = event.order.id;
      item.x = CUSTOMER_HOUSES[event.order.id % CUSTOMER_HOUSES.length];
      draw_cart(item, event.order.id);
    });
  }

  function sync_carts(sim, view) {
    const height = 24 * view.meters_per_pixel;
    cart_items.forEach((item) => {
      const age = sim.now - item.born;
      if (item.born < 0 || age > CART_SECONDS) {
        item.sprite.visible = false;
        item.line.visible = false;
        return;
      }
      const rise = view.reduced_motion ? 1 : Math.min(1, age / 3);
      const y = 4.2 + rise * 2.2;
      const z = -43;
      item.sprite.position.set(item.x, y, z);
      item.sprite.scale.set(height * 4, height, 1);
      item.sprite.material.opacity = Math.min(1, (CART_SECONDS - age) / 2);
      item.sprite.visible = true;
      // La línea punteada baja del carrito hacia la entrada de la bodega
      const attribute = item.line.geometry.getAttribute("position");
      attribute.setXYZ(0, item.x, y - 0.8, z + 1);
      attribute.setXYZ(1, item.x * 0.3, 0.6, -30);
      attribute.needsUpdate = true;
      item.line.computeLineDistances();
      item.line.material.opacity = Math.min(0.85, (CART_SECONDS - age) / 3);
      item.line.visible = true;
    });
  }

  // Etiquetas con el número de pedido sobre lo que está más cerca del centro de la pantalla, solo con el zoom alto
  const projected = new THREE.Vector3();
  function sync_labels(sim, view) {
    if (view.zoom < LABEL_ZOOM) {
      label_sprites.forEach((sprite) => (sprite.visible = false));
      return;
    }
    const candidates = [];
    const consider = (entity, order, text, lift) => {
      if (!order) return;
      const p = place(entity);
      projected.set(p.x, p.y + lift, p.z).project(view.camera);
      if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) return;
      candidates.push({ x: p.x, y: p.y + lift, z: p.z, text, distance: projected.x * projected.x + projected.y * projected.y });
    };
    for (const box of sim.boxes) {
      const state = box.machine.state;
      if (box.order && (state === "ON_FLOOR_BELT" || state === "ON_MAIN_BELT" || state === "PICKED")) consider(box, box.order, `#${box.order.id}`, 0.7);
    }
    sim.orders.walls.forEach((wall) => wall.slots.forEach((slot) => {
      if (slot.order) consider(slot, slot.order, `#${slot.order.id}  ${slot.boxes.length}/${slot.order.lines.length}`, 0.9);
    }));
    for (const tote of sim.totes) if (tote.variant === "out" && tote.order) consider(tote, tote.order, `#${tote.order.id}`, 0.6);
    for (const parcel of sim.parcels) consider(parcel, parcel.order, `#${parcel.order.id}`, 0.8);
    candidates.sort((first, second) => first.distance - second.distance);
    const label_height = 16 * view.meters_per_pixel;
    label_sprites.forEach((sprite, index) => {
      const candidate = candidates[index];
      if (!candidate) {
        sprite.visible = false;
        return;
      }
      const entry = label_texture(candidate.text);
      sprite.material = entry.material;
      sprite.position.set(candidate.x, candidate.y, candidate.z);
      sprite.scale.set(label_height * (160 / 48), label_height, 1);
      sprite.visible = true;
    });
  }

  // ---------- Elemento elegido ----------
  const outline_sizes = {
    box: [0.75, 0.75, 0.75],
    pallet: [1.5, 1.4, 1.3],
    tote: [1.15, 0.6, 0.85],
    parcel: [1.1, 0.75, 0.9],
    truck: [11.2, 3.6, 2.9],
    forklift: [3.2, 2.5, 1.5],
    worker: [0.7, 1.5, 0.7],
    wall_slot: [0.8, 0.7, 0.9],
    elevator: [2.2, 1.2, 2.2],
    dock: [1.2, 4, 4.8],
    door: [1.2, 4, 4.8],
    pack_station: [3.4, 1.8, 2.2],
  };
  const static_target = { x: 0, y: 0, z: 0, prev_x: 0, prev_y: 0, prev_z: 0, yaw: 0, prev_yaw: 0 };

  function sync_outline() {
    if (!selected) {
      outline.visible = false;
      return;
    }
    let size = outline_sizes[selected.kind];
    let target = selected;
    if (selected.kind === "wall") size = [2.6, 2.6, selected.layout.length + 0.6];
    if (!size || selected.x === undefined) {
      // Pedidos y bandas no tienen un lugar propio que resaltar
      outline.visible = false;
      return;
    }
    // Lo que no se mueve (muelles, puertas, casillas, el elevador) no guarda posición anterior
    if (selected.prev_x === undefined || selected.kind === "elevator") {
      static_target.x = static_target.prev_x = selected.x;
      static_target.y = selected.y + (selected.kind === "elevator" ? 0.45 : 0);
      static_target.prev_y = (selected.prev_y === undefined ? selected.y : selected.prev_y) + (selected.kind === "elevator" ? 0.45 : 0);
      static_target.z = static_target.prev_z = selected.z;
      target = static_target;
    }
    const p = place(target);
    const lift = selected.kind === "truck" ? 1.9 : selected.kind === "forklift" ? 1.2 : selected.kind === "box" && selected.belt ? 0.33 : selected.kind === "wall_slot" ? 0.35 : 0;
    outline.position.set(p.x, p.y + lift, p.z);
    outline.rotation.set(0, target === static_target ? 0 : p.yaw, 0);
    outline.scale.set(size[0], size[1], size[2]);
    outline.visible = true;
  }

  // ---------- Piezas para elegir bandas, muelles, puertas, estaciones y muros ----------
  function rebuild_proxies(sim) {
    proxy_entities.length = 0;
    proxy_boxes.length = 0;
    const add = (entity, x, y, z, yaw, sx, sy, sz) => {
      proxy_entities.push(entity);
      proxy_boxes.push([x, y, z, yaw, sx, sy, sz]);
    };
    sim.belts.forEach((belt) => {
      const points = belt.path.points;
      for (let index = 0; index < points.length - 1; index += 1) {
        // Los tramos muy cortos de la espiral se agrupan de a ocho para no llenar de piezas
        if (belt.kind === "main" && index < 64 && index % 8 !== 0) continue;
        const from = points[index];
        const to = points[Math.min(points.length - 1, belt.kind === "main" && index < 64 ? index + 8 : index + 1)];
        const length = Math.hypot(to.x - from.x, to.z - from.z);
        const yaw = Math.atan2(-(to.z - from.z), to.x - from.x);
        add(belt, (from.x + to.x) / 2, (from.y + to.y) / 2 + 0.1, (from.z + to.z) / 2, yaw, Math.max(0.6, length), 0.5, 1.0);
      }
    });
    sim.receiving.docks.forEach((dock) => add(dock, dock.x, 1.9, dock.z, 0, 1.0, 3.8, 4.6));
    sim.outbound.doors.forEach((door) => add(door, door.x, 1.9, door.z, 0, 1.0, 3.8, 4.6));
    sim.outbound.stations.forEach((station) => add(station, station.x, 0.9, station.z, 0, 3.2, 1.8, 2.0));
    sim.orders.walls.forEach((wall) => {
      add(wall, wall.layout.face_x + (wall.layout.side === "west" ? -wall.layout.depth / 2 : wall.layout.depth / 2), 1.25, wall.layout.center_z, 0, wall.layout.depth, 2.5, wall.layout.length);
    });
    proxy_boxes.forEach((entry, index) => {
      dummy.position.set(entry[0], entry[1], entry[2]);
      dummy.rotation.set(0, entry[3], 0);
      dummy.scale.set(entry[4], entry[5], entry[6]);
      dummy.updateMatrix();
      proxy_mesh.setMatrixAt(index, dummy.matrix);
    });
    proxy_mesh.count = proxy_boxes.length;
    proxy_mesh.instanceMatrix.needsUpdate = true;
    proxy_mesh.boundingSphere = null;
  }

  // ---------- Elegir con el puntero ----------
  const pickable = [];
  function pick(raycaster) {
    pickable.length = 0;
    Object.entries(pools).forEach(([name, pool]) => {
      if (NOT_PICKABLE.has(name)) return;
      if (pool.count > 0) {
        pool.mesh.boundingSphere = null;
        pool.mesh.computeBoundingSphere();
        pickable.push(pool.mesh);
      }
    });
    pickable.push(cabin);
    // Las piezas invisibles se eligen aparte para que lo visible siempre gane
    proxy_mesh.boundingSphere = null;
    proxy_mesh.computeBoundingSphere();
    const hits = raycaster.intersectObjects(pickable, false);
    for (const hit of hits) {
      if (hit.object === cabin) return { entity: lookup.elevator, point: hit.point };
      const pool = pools[hit.object.name];
      if (pool && hit.instanceId !== undefined && pool.entities[hit.instanceId]) return { entity: pool.entities[hit.instanceId], point: hit.point };
    }
    const proxy_hits = raycaster.intersectObject(proxy_mesh, false);
    if (proxy_hits.length > 0 && proxy_hits[0].instanceId !== undefined) return { entity: proxy_entities[proxy_hits[0].instanceId], point: proxy_hits[0].point };
    return null;
  }

  const lookup = { elevator: null };

  return {
    group,
    pools,
    // Llamar una vez con la simulación recién creada (o reiniciada)
    attach(sim) {
      lookup.elevator = sim.storage.elevator;
      rebuild_proxies(sim);
      selected = null;
      cart_items.forEach((item) => (item.born = -1));
    },
    on_events,
    set_selected(entity) {
      selected = entity;
    },
    get selected() {
      return selected;
    },
    // `view`: { meters_per_pixel, zoom, camera }
    sync(sim, step_alpha, view, time) {
      alpha = step_alpha;
      sync_boxes(sim);
      sync_pallets(sim);
      sync_totes(sim);
      sync_parcels(sim);
      sync_trucks(sim);
      sync_forklifts(sim, time, view);
      sync_workers(sim);
      sync_slots_and_markers(sim);
      sync_leds(sim);
      sync_flashes(sim, view);
      sync_elevator(sim);
      sync_icons(sim, view);
      sync_carts(sim, view);
      sync_labels(sim, view);
      sync_outline();
    },
    pick,
    stats() {
      return Object.fromEntries(Object.entries(pools).map(([name, pool]) => [name, pool.count]));
    },
    dispose() {
      Object.values(pools).forEach((pool) => {
        pool.mesh.geometry.dispose();
        pool.mesh.material.dispose();
        pool.mesh.dispose();
      });
      label_cache.forEach((entry) => {
        entry.texture.dispose();
        entry.material.dispose();
      });
      [alert_texture, warn_texture, wrench_texture].forEach((texture) => texture.dispose());
      Object.values(icon_materials).forEach((material) => material.dispose());
      cart_items.forEach((item) => {
        item.texture.dispose();
        item.sprite.material.dispose();
        item.line.geometry.dispose();
        item.line.material.dispose();
      });
    },
  };
}
