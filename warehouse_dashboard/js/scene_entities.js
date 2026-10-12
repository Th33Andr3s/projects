// Todo lo que se mueve o cambia en la escena: cajas, pallets, cubetas, paquetes, camiones, montacargas, personas, el elevador,
// las casillas de los muros, los avisos y los destellos. Cada tipo vive en un `InstancedMesh` con un tamaño fijo (un pool): en
// cada cuadro se escribe la posición de lo que existe y se ajusta cuántas instancias se dibujan, sin crear ni destruir mallas.
//
// El dibujo interpola entre la posición anterior y la actual de cada cosa (ver Renderable en entities.js) para que el movimiento
// sea continuo aunque la simulación avance en pasos de 0,25 s.

import { PartCollector } from "./geometry_parts.js";
import { SKUS, sku_color } from "./catalog.js";
import { lerp_angle } from "./path_tools.js";
import { ACTIVE, COMPOUND, TRUCK, floor_y } from "./layout.js";
import { slot_position, visible_slots } from "./active_layout.js";
import { staging_grid } from "./layout.js";

// Una caja dentro de una casilla del muro se dibuja un poco más chica que en una banda
const SLOT_BOX_SCALE = 0.76;
const TRUCK_CAB_COLOR = "#7dd3fc";
const TRUCK_TRAILER_COLOR = "#ffffff";
const TRUCK_NUMBER_COLOR = "#0b3b66";
const DIGIT_CAPACITY = 400;
const BARRIER_CAPACITY = 4;
// Estados en que una caja se dibuja por sí sola; en un pallet, una cubeta o un camión la dibuja su contenedor. Las del activo no
// se dibujan una por una: cada estante muestra casillas llenas según lo que tiene (ver sync_active).
const BOX_VISIBLE_STATES = new Set(["ON_RAIL", "PICKED", "ON_FLOOR_BELT", "ON_MAIN_BELT", "IN_WALL_SLOT"]);
// active_boxes: las casillas de estante del activo (8 pisos, hasta 240 por piso); pallets: los 1.040 de la reserva y los que se arman
const POOLS = { boxes: 2600, active_boxes: 2600, pallets: 1500, totes: 180, parcels: 220, trucks: 60, forklifts: 34, workers: 2000, slots: 130, stacks: 24, dispatch_bins: 32, markers: 24, flashes: 28, leds: 32 };
// Lo que solo adorna no se elige con el puntero
const NOT_PICKABLE = new Set(["wheels", "beacons", "markers", "leds", "flashes", "forks", "truck_doors", "truck_digits"]);
const MAX_LABELS = 1;
// Las pilas de la bodega de stock: el tamaño en planta lo da la cuadrícula del plano (más chicas si hay muchos productos). El alto
// crece con la raíz de la cantidad de cajas, así una pila con pocas se ve y una con muchísimas no sale del techo; la pila llena es
// la de una cuarta parte de la capacidad.
const STACK_BASE_HEIGHT = 0.25;
const STACK_MAX_HEIGHT = 5;
const STACK_FULL_SHARE = 0.25;
// Los pallets de descarga llevan cajas de varios productos: un tono de cartón
const MIXED_PALLET_COLOR = "#c9a468";
// Qué tan rápido sigue la altura dibujada de una pila a la real (por segundo): las pilas suben y bajan sin saltos ni parpadeos
const STACK_EASE_RATE = 4;
const STACK_MIN_VISIBLE = 0.06;
// Las pilas de despacho por destino: tamaño en planta, alto de cada paquete apilado y alto máximo
const BIN_SIZE = 3.2;
const BIN_PARCEL_HEIGHT = 0.12;
const BIN_MAX_HEIGHT = 3.6;
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
  truck_body_parts.add_box(-1.4, 2.15, 0, 8.3, 2.5, 2.6, TRUCK_TRAILER_COLOR);
  truck_body_parts.add_box(-1.4, 3.42, 0, 8.1, 0.06, 2.2, "#e2e8f0");
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
  truck_door_parts.add_box(0, 1.2, -1.25, 0.08, 2.4, 2.5, TRUCK_TRAILER_COLOR);
  const truck_door_geometry = truck_door_parts.build();

  // Tres flotas con tres colores: las de muelle a stock son naranja, las de stock a reserva, azules y las de reserva a activo, verdes
  function build_forklift_body(body_color, counterweight_color) {
    const forklift_body_parts = new PartCollector(THREE);
    forklift_body_parts.add_box(-0.25, 0.55, 0, 1.6, 0.6, 1.1, body_color);
    forklift_body_parts.add_box(-1.0, 0.75, 0, 0.5, 0.9, 1.1, counterweight_color);
    forklift_body_parts.add_box(-0.35, 1.05, 0, 0.6, 0.3, 0.7, "#1f2937");
    [0.4, -0.85].forEach((x) => [-0.45, 0.45].forEach((z) => forklift_body_parts.add_box(x, 1.7, z, 0.06, 1.2, 0.06, "#374151")));
    forklift_body_parts.add_box(-0.22, 2.3, 0, 1.4, 0.06, 1.0, "#374151");
    [-0.35, 0.35].forEach((z) => forklift_body_parts.add_box(0.95, 1.3, z, 0.1, 2.4, 0.1, "#374151"));
    return forklift_body_parts.build();
  }
  const forklift_body_geometry = build_forklift_body("#f59e0b", "#d97706");
  const forklift_stock_body_geometry = build_forklift_body("#3b82f6", "#1d4ed8");
  const forklift_replen_body_geometry = build_forklift_body("#22c55e", "#15803d");

  const fork_parts = new PartCollector(THREE);
  [-0.3, 0.3].forEach((z) => fork_parts.add_box(1.3, 0.06, z, 1.4, 0.08, 0.14, "#9ca3af"));
  fork_parts.add_box(0.98, 0.45, 0, 0.06, 0.9, 0.9, "#6b7280");
  const fork_geometry = fork_parts.build();

  // La barrera de la talanquera: un brazo a rayas rojas y blancas que sale de su bisagra hacia +z
  const barrier_parts = new PartCollector(THREE);
  for (let stripe = 0; stripe < 6; stripe += 1) barrier_parts.add_box(0, 0, 0.35 + stripe * 0.7, 0.12, 0.16, 0.7, stripe % 2 === 0 ? "#dc2626" : "#f8fafc");
  const barrier_geometry = barrier_parts.build();

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
  add_pool("active_boxes", unit_box, instance_material(), POOLS.active_boxes);
  add_pool("pallet_bases", pallet_base_geometry, instance_material({ color: "#b99b6b" }), POOLS.pallets);
  add_pool("pallet_loads", unit_box, instance_material(), POOLS.pallets);
  add_pool("tote_bodies", unit_box, instance_material(), POOLS.totes);
  add_pool("tote_fills", unit_box, instance_material(), POOLS.totes);
  add_pool("parcels", parcel_geometry, vertex_material, POOLS.parcels);
  add_pool("truck_bodies", truck_body_geometry, vertex_material, POOLS.trucks, true);
  add_pool("truck_cabs", truck_cab_geometry, instance_material({ vertexColors: true }), POOLS.trucks, true);
  add_pool("truck_doors", truck_door_geometry, vertex_material, POOLS.trucks);
  add_pool("barrier_arms", barrier_geometry, vertex_material, BARRIER_CAPACITY);
  add_pool("forklift_bodies", forklift_body_geometry, vertex_material, POOLS.forklifts, true);
  add_pool("forklift_stock_bodies", forklift_stock_body_geometry, vertex_material, POOLS.forklifts, true);
  add_pool("forklift_replen_bodies", forklift_replen_body_geometry, vertex_material, POOLS.forklifts, true);
  add_pool("forks", fork_geometry, vertex_material, POOLS.forklifts);
  add_pool("wheels", wheel_geometry, instance_material({ color: "#111827" }), POOLS.forklifts * 4);
  add_pool("beacons", beacon_geometry, basic({ color: "#ffffff" }), POOLS.forklifts);
  add_pool("worker_bodies", worker_body_geometry, instance_material(), POOLS.workers);
  add_pool("worker_heads", worker_head_geometry, instance_material({ color: "#f3c9a1" }), POOLS.workers);
  add_pool("slots", unit_box, instance_material({ roughness: 0.6 }), POOLS.slots);
  add_pool("stock_stacks", unit_box, instance_material({ roughness: 0.85 }), POOLS.stacks, true);
  add_pool("dispatch_bins", unit_box, instance_material({ roughness: 0.85 }), POOLS.dispatch_bins, true);
  add_pool("markers", unit_box, basic({ color: "#0b1220", transparent: true, opacity: 0.82 }), POOLS.markers);
  add_pool("leds", led_geometry, basic({ color: "#ffffff" }), POOLS.leds);
  add_pool("flashes", flash_geometry, basic({ color: "#ffffff", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), POOLS.flashes);

  // Los números pintados en el contenedor de cada camión: un solo plano repetido, con un atlas de los diez dígitos del que cada
  // instancia elige su celda (un atributo por instancia desplaza las coordenadas de la textura)
  const digit_canvas = document.createElement("canvas");
  digit_canvas.width = 640;
  digit_canvas.height = 128;
  const digit_context = digit_canvas.getContext("2d");
  digit_context.fillStyle = TRUCK_NUMBER_COLOR;
  digit_context.font = "700 112px system-ui, 'Segoe UI', Arial, sans-serif";
  digit_context.textAlign = "center";
  digit_context.textBaseline = "middle";
  for (let digit = 0; digit < 10; digit += 1) digit_context.fillText(String(digit), digit * 64 + 32, 70);
  const digit_texture = new THREE.CanvasTexture(digit_canvas);
  digit_texture.colorSpace = THREE.SRGBColorSpace;
  digit_texture.anisotropy = 4;
  const digit_geometry = new THREE.PlaneGeometry(0.8, 1.4);
  const digit_cells = new THREE.InstancedBufferAttribute(new Float32Array(DIGIT_CAPACITY), 1);
  digit_geometry.setAttribute("uv_cell", digit_cells);
  const digit_material = new THREE.MeshBasicMaterial({ map: digit_texture, transparent: true, alphaTest: 0.25 });
  digit_material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "attribute float uv_cell;\nvoid main() {")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv.x = vMapUv.x * 0.1 + uv_cell * 0.1;\n#endif");
  };
  const digit_pool = add_pool("truck_digits", digit_geometry, digit_material, DIGIT_CAPACITY);

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
  const customers_zone = layout.zones.find((zone) => zone.id === "customers");
  const customers_center = { x: (customers_zone.x0 + customers_zone.x1) / 2, z: (customers_zone.z0 + customers_zone.z1) / 2 };
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
    // Lo que no se movió en el último paso se dibuja quieto (ver step_clock en entities.js)
    if (entity.moved_step !== undefined && !entity.moved_this_step) {
      spot.x = entity.x;
      spot.y = entity.y;
      spot.z = entity.z;
      spot.yaw = entity.yaw;
      return spot;
    }
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
      const scale = box.machine.state === "IN_WALL_SLOT" ? SLOT_BOX_SCALE : 1;
      const [length, height, depth] = box.size;
      // En una banda la posición es la de la superficie; la caja se apoya encima
      const lift = box.belt ? (height * scale) / 2 + 0.03 : 0;
      put(pool, box, p.x, p.y + lift, p.z, p.yaw, length * scale, height * scale, depth * scale, sku_color(box.sku_id));
    }
    pool.end();
  }

  // El activo: cada tramo (producto en un piso) dibuja tantas casillas llenas como le toquen según lo que tiene guardado. Es una
  // representación: con miles de cajas por piso no se dibuja una por una, solo cuánto está lleno cada estante.
  function sync_active(sim) {
    const pool = pools.active_boxes;
    pool.begin();
    for (const segment of sim.storage.segments) {
      const count = segment.boxes.length;
      if (count === 0) continue;
      if (!segment.slot_spots) segment.slot_spots = [];
      const [length, height, depth] = SKUS[segment.sku_id].size;
      const hex = sku_color(segment.sku_id);
      const shown = visible_slots(segment, count, sim.storage.capacity_of(segment));
      for (let slot = 0; slot < shown; slot += 1) {
        let spot_at = segment.slot_spots[slot];
        if (!spot_at) {
          spot_at = slot_position(segment, slot);
          segment.slot_spots[slot] = spot_at;
        }
        put(pool, segment.shelf, spot_at.x, spot_at.y + height / 2, spot_at.z, 0, length, height, depth, hex);
      }
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
        put(loads, pallet, p.x, p.y + 0.07 + height / 2, p.z, p.yaw, 1.0, height, 0.85, pallet.mixed ? MIXED_PALLET_COLOR : sku_color(pallet.sku_id));
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

  // Cada camión es azul cielo con el contenedor blanco y su número pintado, centrado, en los dos costados
  function sync_trucks(sim) {
    const bodies = pools.truck_bodies;
    const cabs = pools.truck_cabs;
    const doors = pools.truck_doors;
    bodies.begin();
    cabs.begin();
    doors.begin();
    digit_pool.begin();
    const trucks = [...sim.receiving.trucks, ...sim.outbound.trucks];
    for (const truck of trucks) {
      const p = place(truck);
      vehicle_matrix(matrix_a, p.x, 0, p.z, p.yaw);
      put_matrix(bodies, truck, matrix_a);
      put_matrix(cabs, truck, matrix_a, TRUCK_CAB_COLOR);
      // La puerta trasera gira sobre su bisagra
      matrix_b.makeTranslation(-5.55, 0.95, TRUCK.width / 2 - 0.05);
      matrix_c.makeRotationY(truck.door_open * 1.8);
      matrix_c.premultiply(matrix_b);
      matrix_c.premultiply(matrix_a);
      put_matrix(doors, truck, matrix_c);
      const digits = String(truck.id);
      [1, -1].forEach((side) => {
        for (let index = 0; index < digits.length; index += 1) {
          if (digit_pool.is_full) return;
          // Vistos desde afuera, los dígitos se leen de atrás hacia el cabezote en un costado y al revés en el otro
          const offset = (index - (digits.length - 1) / 2) * 0.82 * side;
          matrix_b.makeTranslation(-1.4 + offset, 2.15, side * (TRUCK.width / 2 + 0.01));
          if (side < 0) matrix_c.makeRotationY(Math.PI).premultiply(matrix_b).premultiply(matrix_a);
          else matrix_c.copy(matrix_b).premultiply(matrix_a);
          digit_cells.setX(digit_pool.count, Number(digits[index]));
          put_matrix(digit_pool, truck, matrix_c);
        }
      });
    }
    bodies.end();
    cabs.end();
    doors.end();
    digit_pool.end();
    digit_cells.needsUpdate = true;
  }

  // Las talanqueras suben y bajan según lo que diga cada carril
  function sync_barriers(sim) {
    const pool = pools.barrier_arms;
    pool.begin();
    Object.values(sim.gates).forEach((lane) => {
      const side = Math.sign(lane.z);
      matrix_b.makeTranslation(lane.x, 1.1, side * 1.6);
      matrix_c.makeRotationY(side > 0 ? 0 : Math.PI);
      matrix_a.makeRotationX(-lane.progress * 1.45);
      matrix_c.multiply(matrix_a).premultiply(matrix_b);
      put_matrix(pool, lane, matrix_c);
    });
    pool.end();
  }

  function sync_forklifts(sim, time, view) {
    const bodies = pools.forklift_bodies;
    const stock_bodies = pools.forklift_stock_bodies;
    const replen_bodies = pools.forklift_replen_bodies;
    const forks = pools.forks;
    const wheels = pools.wheels;
    const beacons = pools.beacons;
    bodies.begin();
    stock_bodies.begin();
    replen_bodies.begin();
    forks.begin();
    wheels.begin();
    beacons.begin();
    for (const forklift of sim.forklifts) {
      const p = place(forklift);
      vehicle_matrix(matrix_a, p.x, 0, p.z, p.yaw);
      put_matrix(forklift.fleet === "dock" ? bodies : forklift.fleet === "stock" ? stock_bodies : replen_bodies, forklift, matrix_a);
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
    stock_bodies.end();
    replen_bodies.end();
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

  // La bodega de stock: una pila por producto, tan alta como la cantidad de cajas, del color del producto. La altura dibujada va
  // alcanzando a la real poco a poco: una pila que recibe y entrega cajas seguidas no aparece y desaparece a cada rato (eso se veía
  // como un parpadeo).
  let last_stack_time = 0;
  function sync_stock_stacks(sim, time) {
    const pool = pools.stock_stacks;
    const dt = Math.min(0.25, Math.max(0, time - last_stack_time));
    last_stack_time = time;
    const blend = 1 - Math.exp(-STACK_EASE_RATE * dt);
    pool.begin();
    const full_pile = Math.max(1, sim.config.get("staging_capacity") * STACK_FULL_SHARE);
    const pile = staging_grid();
    sim.receiving.stacks.forEach((stack) => {
      const target = stack.boxes > 0 ? Math.min(STACK_MAX_HEIGHT, STACK_BASE_HEIGHT + (STACK_MAX_HEIGHT - STACK_BASE_HEIGHT) * Math.sqrt(stack.boxes / full_pile)) : 0;
      stack.shown_height = stack.shown_height === undefined ? target : stack.shown_height + (target - stack.shown_height) * blend;
      if (Math.abs(target - stack.shown_height) < 0.01) stack.shown_height = target;
      if (stack.shown_height < STACK_MIN_VISIBLE) return;
      put(pool, stack, stack.x, stack.shown_height / 2 + 0.05, stack.z, 0, pile.pile_width, stack.shown_height, pile.pile_depth, sku_color(stack.sku_id));
    });
    pool.end();
  }

  // Las pilas de despacho: una por ciudad, del color de su región, tan altas como paquetes listos esperan su corte (con el mismo
  // suavizado de las pilas de la bodega)
  function sync_dispatch_bins(sim) {
    const pool = pools.dispatch_bins;
    const blend = 1 - Math.exp(-STACK_EASE_RATE * 0.05);
    pool.begin();
    sim.outbound.bins.forEach((bin) => {
      const target = bin.parcels.length > 0 ? Math.min(BIN_MAX_HEIGHT, 0.3 + bin.parcels.length * BIN_PARCEL_HEIGHT) : 0;
      bin.shown_height = bin.shown_height === undefined ? target : bin.shown_height + (target - bin.shown_height) * blend;
      if (Math.abs(target - bin.shown_height) < 0.01) bin.shown_height = target;
      if (bin.shown_height < STACK_MIN_VISIBLE) return;
      put(pool, bin, bin.x, bin.shown_height / 2 + 0.05, bin.z, 0, BIN_SIZE, bin.shown_height, BIN_SIZE, bin.destination.color);
    });
    pool.end();
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
    const signature = `${sim.alerts.map((alert) => alert.key).join(",")}|${sim.disruptions.is_active("belt_down")}|${sim.forklifts.map((forklift) => forklift.machine.state === "MAINTENANCE").join("")}`;
    if (signature === icon_signature) return;
    icon_signature = signature;
    icon_list = [];
    sim.alerts.forEach((alert) => {
      if (alert.key === "wall_jam" && sim.orders.jam_box) icon_list.push({ kind: "danger", entity: sim.orders.jam_box, height: 1.4 });
      else if (alert.key === "reserve_full") icon_list.push({ kind: "warn", point: { x: -26, y: 17, z: -10 } });
      else if (alert.key.startsWith("blocked_")) {
        const order = sim.orders.orders.find((candidate) => candidate.id === alert.order_id);
        if (order && order.slot) icon_list.push({ kind: "danger", entity: order.slot, height: 1.7 });
        else if (order) {
          const line = order.lines.find((candidate) => candidate.box);
          if (line) icon_list.push({ kind: "danger", entity: line.box, height: 1.4 });
          else icon_list.push({ kind: "danger", point: { x: ACTIVE.x0 + 14, y: floor_y(ACTIVE.floors - 1) + 4, z: ACTIVE.belt_z } });
        }
      } else if (alert.key.startsWith("no_stock_")) icon_list.push({ kind: "warn", point: { x: ACTIVE.x0 + 14, y: floor_y(ACTIVE.floors - 1) + 4, z: ACTIVE.z0 - 1 } });
    });
    if (sim.disruptions.is_active("belt_down")) icon_list.push({ kind: "danger", point: { x: 30, y: 2.6, z: -20.5 } });
    sim.forklifts.forEach((forklift) => {
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
      item.x = customers_center.x + CUSTOMER_HOUSES[event.order.id % CUSTOMER_HOUSES.length];
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
      const z = customers_center.z;
      item.sprite.position.set(item.x, y, z);
      item.sprite.scale.set(height * 4, height, 1);
      item.sprite.material.opacity = Math.min(1, (CART_SECONDS - age) / 2);
      item.sprite.visible = true;
      // La línea punteada baja del carrito hacia la entrada de la bodega
      const attribute = item.line.geometry.getAttribute("position");
      attribute.setXYZ(0, item.x, y - 0.8, z + 1);
      attribute.setXYZ(1, item.x, 0.6, COMPOUND.z0 - 1);
      attribute.needsUpdate = true;
      item.line.computeLineDistances();
      item.line.material.opacity = Math.min(0.85, (CART_SECONDS - age) / 3);
      item.line.visible = true;
    });
  }

  // El único rótulo de la escena sobre una caja: el de la caja que la persona eligió con un clic. Nada de textos sueltos sobre todas
  // las cajas: se amontonaban y, al cambiar cuál estaba más cerca del centro, saltaban de una a otra y titilaban.
  function sync_labels(view) {
    const sprite = label_sprites[0];
    label_sprites.forEach((other) => (other.visible = false));
    if (!selected || selected.kind !== "box" || !BOX_VISIBLE_STATES.has(selected.machine.state)) return;
    const p = place(selected);
    const entry = label_texture(`Caja ${selected.id}`);
    sprite.material = entry.material;
    sprite.position.set(p.x, p.y + 0.7, p.z);
    const label_height = 16 * view.meters_per_pixel;
    sprite.scale.set(label_height * (160 / 48), label_height, 1);
    sprite.visible = true;
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
    gate_lane: [1.4, 2.6, 4.8],
    stock_stack: [3.8, 2.2, 2.6],
    active_shelf: [2.4, 1.3, 1.2],
    dispatch_bin: [3.6, 2.2, 3.6],
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
    const lift = selected.kind === "stock_stack" || selected.kind === "dispatch_bin" ? 1.1 : selected.kind === "truck" ? 1.9 : selected.kind === "forklift" ? 1.2 : selected.kind === "box" && selected.belt ? 0.33 : selected.kind === "wall_slot" ? 0.35 : 0;
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
    sim.receiving.docks.forEach((dock) => add(dock, dock.x, 1.9, dock.z, 0, 1.0, 3.8, 4.2));
    Object.values(sim.gates).forEach((lane) => add(lane, lane.x, 1.3, lane.z, 0, 1.4, 2.6, 4.8));
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
      sync_active(sim);
      sync_pallets(sim);
      sync_totes(sim);
      sync_parcels(sim);
      sync_trucks(sim);
      sync_barriers(sim);
      sync_forklifts(sim, time, view);
      sync_workers(sim);
      sync_slots_and_markers(sim);
      sync_stock_stacks(sim, time);
      sync_dispatch_bins(sim);
      sync_leds(sim);
      sync_flashes(sim, view);
      sync_elevator(sim);
      sync_icons(sim, view);
      sync_carts(sim, view);
      sync_labels(view);
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
