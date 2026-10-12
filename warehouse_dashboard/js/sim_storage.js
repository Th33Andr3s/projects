// Almacenamiento: la reserva (racks de pallets), el activo (la mercancía de cada producto en cada piso del multinivel), las dos
// flotas de montacargas que trabajan aquí (de stock a reserva y de reserva a activo), el elevador que sube las cubetas y el
// reabasto, que trae pallets de la reserva cuando el activo de un producto se queda corto. (Las montacargas de muelle a stock están
// en sim_dock_fleet.js.)
//
// El flujo de la mercancía es siempre el mismo: stock → reserva → activo. Al activo solo llega lo que sale de un pallet de la
// reserva, desarmado en cubetas junto al elevador. Cada flota hace una sola cosa: las de stock a reserva guardan pallets en los
// racks, y las de reserva a activo traen un pallet al pie del multinivel. Un pasillo de rack lo usa una montacarga a la vez.

import { FLOOR_COUNT, TOTE_CAPACITY } from "./config.js";
import { SKUS } from "./catalog.js";
import { ActiveShelf, Elevator, Forklift, Tote } from "./entities.js";
import { build_segments, segment_capacity, slot_position, visible_slots } from "./active_layout.js";
import {
  BELT_HEIGHT,
  CROSS_LANE_Z,
  ELEVATOR,
  ELEVATOR_DOOR,
  FRONT_LANE_Z,
  GARAGE_LANE_Z,
  PALLET_SPOTS,
  PARK_SPOTS_REPLEN,
  PARK_SPOTS_STOCK,
  REPLEN_LANE_X,
  TRUNK_X,
  UNLOAD_POINT,
  floor_y,
  reserve_positions,
} from "./layout.js";

const ELEVATOR_SPEED = 4;
const ELEVATOR_LOAD_SECONDS = 1.2;
const ELEVATOR_BOX_SECONDS = 0.5;
const UNPACK_INTERVAL_SECONDS = 3;
const LIFT_SECONDS = 1.2;
const TURN_SECONDS = 0.9;
const INSERT_DISTANCE = 1.2;
// Las montacargas con la fila de abajo de la franja de armado: se paran a esta distancia del puesto, mirando hacia él
const PICKUP_DISTANCE = 1.75;
// La mesa de desarme junto al elevador es una sola: de las montacargas de reserva a activo, una descarga y otra espera su turno.
// Más en camino a la vez solo harían fila en el mismo punto del pasillo.
const MAX_REPLEN_IN_FLIGHT = 2;
// Una devolución (un pedido cancelado) puede pasar un poco de lo que cabe en un tramo; así ninguna caja se pierde
const OVERFLOW_FACTOR = 1.25;
const OVERFLOW_EXTRA = 2;

export class StorageSystem {
  constructor(sim) {
    this.sim = sim;

    this.positions = reserve_positions();
    // Qué pallet ocupa cada ubicación de la reserva, y cuáles están apartadas por un montacarga
    this.reserve_slots = this.positions.map(() => null);
    this.reserve_claims = this.positions.map(() => false);
    this.reserve_pallets = [];
    // Los pallets de la reserva de cada producto, del más viejo al más nuevo
    this.reserve_by_sku = Array.from({ length: SKUS.length }, () => []);
    // Desde qué ubicación hay que buscar un lugar libre: así no se recorre toda la reserva cada vez
    this.free_hint = 0;

    // Los tramos del activo: uno por producto y piso, con las cajas que tiene guardadas
    this.segments = build_segments(sim.allocation).map((segment) => {
      segment.boxes = [];
      segment.reserved = 0;
      segment.inbound = 0;
      const position = slot_position(segment, 0);
      segment.shelf = new ActiveShelf(segment, { x: position.x, y: position.y, z: position.z });
      return segment;
    });
    this.segments_by_sku = Array.from({ length: SKUS.length }, () => []);
    // Un tramo por piso y producto, en una tabla (se consulta muchísimas veces por paso)
    this.segment_grid = Array.from({ length: FLOOR_COUNT }, () => Array(SKUS.length).fill(null));
    this.segments.forEach((segment) => {
      this.segments_by_sku[segment.sku_id].push(segment);
      this.segment_grid[segment.floor][segment.sku_id] = segment;
    });
    // Cajas que van en camino al activo de cada producto (en un pallet que viene del reabasto o ya en cubetas)
    this.inbound = Array(SKUS.length).fill(0);
    this.replen_pending = Array(SKUS.length).fill(false);
    // Un producto entra en "reabasto" cuando baja del umbral y sigue en él hasta llegar a la meta
    this.replen_mode = Array(SKUS.length).fill(false);

    // Las dos flotas: cada una con su cantidad (un parámetro), su fila de puestos en el taller y la tarea que le toca
    this.groups = {
      stock: { fleet: "stock", forklifts: [], spots: PARK_SPOTS_STOCK, park_slots: PARK_SPOTS_STOCK.map(() => null), count_key: "forklift_count", max_in_flight: Infinity },
      replen: { fleet: "replen", forklifts: [], spots: PARK_SPOTS_REPLEN, park_slots: PARK_SPOTS_REPLEN.map(() => null), count_key: "replen_forklift_count", max_in_flight: MAX_REPLEN_IN_FLIGHT },
    };
    this.aisle_locks = new Map();
    this.unpack_jobs = [];

    this.elevator = new Elevator(ELEVATOR, 0);
    this.elevator_box_timer = 0;
    // La cubeta que espera en la puerta del elevador (una a la vez) y quién tiene ocupado el pasillo de reabasto
    this.door_tote = null;
    this.replen_lane_busy = false;
  }

  // Las dos flotas juntas
  get forklifts() {
    return [...this.groups.stock.forklifts, ...this.groups.replen.forklifts];
  }

  // ---------- Activo ----------
  active_capacity() {
    return this.sim.config.get("active_capacity");
  }

  capacity_of(segment) {
    return segment_capacity(segment, this.active_capacity());
  }

  segment_of(floor, sku_id) {
    return this.segment_grid[floor][sku_id];
  }

  // Lo que cabe de un producto en todo el activo
  sku_capacity(sku_id) {
    return this.segments_by_sku[sku_id].reduce((sum, segment) => sum + this.capacity_of(segment), 0);
  }

  active_count(sku_id) {
    return this.segments_by_sku[sku_id].reduce((sum, segment) => sum + segment.boxes.length, 0);
  }

  // Cajas del producto que se pueden asignar a un pedido: las que hay en el activo sin las ya apartadas
  available(sku_id) {
    return this.segments_by_sku[sku_id].reduce((sum, segment) => sum + segment.boxes.length - segment.reserved, 0);
  }

  available_on_floor(sku_id, floor) {
    const segment = this.segment_of(floor, sku_id);
    return segment ? segment.boxes.length - segment.reserved : 0;
  }

  // Cuántas cajas más de este producto caben en el activo, contando las que vienen en camino
  active_room(sku_id) {
    return Math.max(0, this.sku_capacity(sku_id) - this.active_count(sku_id) - this.inbound[sku_id]);
  }

  floor_count(floor) {
    return this.segments.reduce((sum, segment) => (segment.floor === floor ? sum + segment.boxes.length : sum), 0);
  }

  active_total() {
    return this.segments.reduce((sum, segment) => sum + segment.boxes.length, 0);
  }

  // Lo que queda libre en un tramo para las cubetas que van llegando
  segment_room(segment) {
    return this.capacity_of(segment) - segment.boxes.length - segment.inbound;
  }

  segment_limit(segment) {
    return Math.ceil(this.capacity_of(segment) * OVERFLOW_FACTOR) + OVERFLOW_EXTRA;
  }

  // El tramo del producto con más lugar libre (el piso al que le conviene la siguiente cubeta)
  roomiest_segment(sku_id) {
    let best = null;
    let best_room = -Infinity;
    for (const segment of this.segments_by_sku[sku_id]) {
      const room = this.segment_room(segment);
      if (room > best_room) {
        best = segment;
        best_room = room;
      }
    }
    return best;
  }

  // Una caja entra al activo, en el tramo dado. Devuelve false si el tramo ya llegó a su tope.
  add_to_segment(box, segment, now, teleport = true) {
    if (!segment || segment.boxes.length >= this.segment_limit(segment)) return false;
    segment.boxes.push(box);
    box.segment = segment;
    box.container = null;
    box.order = null;
    box.line = null;
    box.reserved = false;
    box.machine.go_to("IN_ACTIVE", now);
    const position = this.top_position(segment, box);
    if (teleport) box.teleport(position.x, position.y, position.z, 0);
    else box.set_position(position.x, position.y, position.z, 0);
    this.sim.orders.on_stock_added(box.sku_id);
    return true;
  }

  // Una caja que vuelve al activo (un pedido cancelado): al piso del que salió si le queda lugar, y si no, al que más tenga
  add_to_active(box, now, preferred_floor = null, teleport = true) {
    const preferred = preferred_floor === null ? null : this.segment_of(preferred_floor, box.sku_id);
    if (preferred && this.add_to_segment(box, preferred, now, teleport)) return true;
    const candidates = [...this.segments_by_sku[box.sku_id]].sort((first, second) => this.segment_room(second) - this.segment_room(first));
    return candidates.some((segment) => this.add_to_segment(box, segment, now, teleport));
  }

  // Dónde se ve la última casilla llena de un tramo: de ahí se recoge la caja que sigue
  top_position(segment, box) {
    const capacity = this.capacity_of(segment);
    const slot = Math.max(0, visible_slots(segment, segment.boxes.length, capacity) - 1);
    const position = slot_position(segment, slot);
    return { ...position, y: position.y + box.size[1] / 2 };
  }

  remove_from_active(box) {
    const segment = box.segment;
    if (!segment) return;
    const index = segment.boxes.lastIndexOf(box);
    if (index >= 0) {
      segment.boxes.splice(index, 1);
      if (box.reserved) segment.reserved -= 1;
    }
    box.segment = null;
    box.reserved = false;
  }

  // Aparta una caja del producto en un piso para una línea de pedido (la de más arriba que no esté apartada)
  reserve_box(sku_id, floor) {
    const segment = this.segment_of(floor, sku_id);
    if (!segment) return null;
    for (let index = segment.boxes.length - 1; index >= 0; index -= 1) {
      const box = segment.boxes[index];
      if (box.reserved) continue;
      box.reserved = true;
      box.home_floor = segment.floor;
      segment.reserved += 1;
      // Se pone donde está la casilla de la que se recoge, para que el operario camine hasta ahí
      const position = this.top_position(segment, box);
      box.teleport(position.x, position.y, position.z, 0);
      box.aisle_z = position.aisle_z;
      return box;
    }
    return null;
  }

  unreserve_box(box) {
    if (!box.reserved) return;
    box.reserved = false;
    if (box.segment) box.segment.reserved -= 1;
  }

  // ---------- Reserva ----------
  reserve_used() {
    return this.reserve_pallets.length;
  }

  // Cuántos pallets caben: la capacidad (en cajas) entre el tamaño del pallet, sin pasar de las ubicaciones que tienen los racks
  reserve_pallet_capacity() {
    const { config } = this.sim;
    return Math.min(this.positions.length, Math.floor(config.get("reserve_capacity") / config.get("pallet_size")));
  }

  find_free_reserve_index() {
    const capacity = this.reserve_pallet_capacity();
    for (let index = this.free_hint; index < capacity; index += 1) {
      if (!this.reserve_slots[index] && !this.reserve_claims[index]) {
        this.free_hint = index;
        return index;
      }
    }
    this.free_hint = Math.max(this.free_hint, capacity);
    return -1;
  }

  // Un pallet queda guardado en su ubicación
  store_pallet(pallet, index, now) {
    const position = this.positions[index];
    this.reserve_slots[index] = pallet;
    this.reserve_claims[index] = false;
    pallet.reserve_index = index;
    pallet.machine.go_to("IN_RESERVE", now);
    pallet.claimed = false;
    pallet.teleport(position.x, position.y + 0.07, position.z, 0);
    pallet.boxes.forEach((box) => box.machine.go_to("IN_RESERVE", now));
    this.reserve_pallets.push(pallet);
    this.reserve_by_sku[pallet.sku_id].push(pallet);
  }

  // Un montacarga saca un pallet de su ubicación: queda libre
  release_reserve_pallet(pallet) {
    this.reserve_slots[pallet.reserve_index] = null;
    this.free_hint = Math.min(this.free_hint, pallet.reserve_index);
    this.reserve_pallets = this.reserve_pallets.filter((candidate) => candidate !== pallet);
    this.reserve_by_sku[pallet.sku_id] = this.reserve_by_sku[pallet.sku_id].filter((candidate) => candidate !== pallet);
    pallet.reserve_index = -1;
  }

  oldest_reserve_pallet(sku_id) {
    return this.reserve_by_sku[sku_id].find((pallet) => !pallet.claimed) || null;
  }

  reserve_boxes(sku_id) {
    return this.reserve_by_sku[sku_id].reduce((total, pallet) => total + pallet.boxes.length, 0);
  }

  // ---------- Cubetas hacia el elevador ----------
  // Una cubeta queda en la puerta del elevador (nace ahí al desarmar un pallet de reabasto)
  place_at_door(tote, now) {
    if (this.door_tote) throw new Error("La puerta del elevador ya tiene una cubeta");
    this.door_tote = tote;
    tote.machine.go_to("AT_DOOR", now);
    tote.teleport(ELEVATOR_DOOR.x, 0.2, ELEVATOR_DOOR.z, 0);
  }

  // El elevador, cuando está libre, toma la cubeta de la puerta
  elevator_take_from_door(now) {
    const elevator = this.elevator;
    const tote = this.door_tote;
    if (!tote || elevator.machine.state !== "IDLE") return;
    this.door_tote = null;
    elevator.tote = tote;
    elevator.target_floor = tote.floor;
    elevator.machine.go_to("LOADING", now);
    elevator.timer = ELEVATOR_LOAD_SECONDS;
    tote.machine.go_to("IN_ELEVATOR", now);
  }

  step_elevator(now, dt) {
    const elevator = this.elevator;
    const state = elevator.machine.state;
    elevator.prev_y = elevator.y;
    if (state === "IDLE") {
      this.elevator_take_from_door(now);
      return;
    }
    const tote = elevator.tote;
    if (state === "LOADING") {
      elevator.timer -= dt;
      if (elevator.timer <= 0) elevator.machine.go_to("RISING", now);
    } else if (state === "RISING") {
      const goal = floor_y(elevator.target_floor) + BELT_HEIGHT;
      elevator.y = Math.min(goal, elevator.y + ELEVATOR_SPEED * dt);
      if (elevator.y >= goal) {
        elevator.machine.go_to("UNLOADING", now);
        tote.machine.go_to("AT_FLOOR", now);
        this.elevator_box_timer = 0;
      }
    } else if (state === "UNLOADING") {
      this.elevator_box_timer -= dt;
      if (this.elevator_box_timer <= 0 && tote.boxes.length > 0) {
        const box = tote.boxes[0];
        if (this.add_to_segment(box, tote.segment, now)) {
          tote.boxes.shift();
          this.inbound[box.sku_id] -= 1;
          tote.segment.inbound -= 1;
          this.elevator_box_timer = ELEVATOR_BOX_SECONDS;
        }
      }
      if (tote.boxes.length === 0 && this.elevator_box_timer <= 0) {
        tote.machine.go_to("EMPTY", now);
        this.sim.totes = this.sim.totes.filter((candidate) => candidate !== tote);
        elevator.tote = null;
        elevator.machine.go_to("DESCENDING", now);
      }
    } else if (state === "DESCENDING") {
      elevator.y = Math.max(BELT_HEIGHT, elevator.y - ELEVATOR_SPEED * dt);
      if (elevator.y <= BELT_HEIGHT) elevator.machine.go_to("IDLE", now);
    }
    if (elevator.tote) elevator.tote.set_position(elevator.x, elevator.y + 0.2, elevator.z, 0);
  }

  // ---------- Desarmar un pallet de reabasto en cubetas ----------
  // Cada cubeta va al piso donde el producto tenga más lugar libre; un pallet puede repartirse en varios pisos.
  step_unpack(now) {
    for (const job of [...this.unpack_jobs]) {
      if (now < job.next_at) continue;
      // La cubeta nueva necesita la puerta del elevador libre
      if (this.door_tote) continue;
      const pallet = job.pallet;
      const segment = this.roomiest_segment(pallet.sku_id);
      if (!segment) continue;
      // Si ningún piso tiene lugar (se cambió la distribución o la capacidad mientras tanto) la cubeta sale igual y llena lo que pueda
      const room = Math.max(1, this.segment_room(segment));
      const count = Math.min(TOTE_CAPACITY, pallet.boxes.length, room);
      const tote = new Tote(this.sim.next_id("tote"), "in", now);
      tote.floor = segment.floor;
      tote.segment = segment;
      for (let index = 0; index < count; index += 1) {
        const box = pallet.boxes.shift();
        box.machine.go_to("IN_TOTE", now);
        box.container = tote;
        tote.boxes.push(box);
      }
      segment.inbound += count;
      this.sim.totes.push(tote);
      this.place_at_door(tote, now);
      job.next_at = now + UNPACK_INTERVAL_SECONDS;
      if (pallet.boxes.length === 0) {
        pallet.machine.go_to("UNPACKED", now);
        this.sim.pallets = this.sim.pallets.filter((candidate) => candidate !== pallet);
        this.unpack_jobs = this.unpack_jobs.filter((candidate) => candidate !== job);
        this.replen_pending[pallet.sku_id] = false;
      }
    }
  }

  // ---------- Flotas de montacargas ----------
  sync_forklift_count(now, group) {
    const wanted = this.sim.config.get(group.count_key);
    const active = group.forklifts.filter((forklift) => !forklift.retiring);
    for (let index = active.length; index < wanted; index += 1) this.add_forklift(now, group);
    // Si sobran, las que están libres se retiran en cuanto estén en el taller
    let surplus = active.length - wanted;
    for (let index = active.length - 1; index >= 0 && surplus > 0; index -= 1) {
      active[index].retiring = true;
      surplus -= 1;
    }
  }

  add_forklift(now, group) {
    const forklift = new Forklift(this.sim.next_id("forklift"), now, group.fleet);
    const slot = group.park_slots.findIndex((occupant) => occupant === null);
    forklift.park_index = slot;
    if (slot >= 0) group.park_slots[slot] = forklift;
    const spot = group.spots[Math.max(0, slot)];
    forklift.teleport(spot.x, 0, spot.z, -Math.PI / 2);
    forklift.on_idle = () => this.on_forklift_idle(forklift);
    group.forklifts.push(forklift);
  }

  on_forklift_idle(forklift) {
    if (forklift.machine.state !== "IDLE") {
      if (forklift.machine.state === "CARRYING") forklift.machine.go_to("UNLOADING", this.sim.now);
      if (forklift.machine.state === "UNLOADING") forklift.machine.go_to("RETURNING", this.sim.now);
      if (forklift.machine.state === "RETURNING" || forklift.machine.state === "GOING_TO_PICKUP") forklift.machine.go_to("IDLE", this.sim.now);
    }
    forklift.task = null;
  }

  // ¿Está en su puesto del taller?
  in_garage(forklift) {
    return forklift.z >= GARAGE_LANE_Z + 1;
  }

  // Un pasillo solo lo usa una montacarga a la vez
  aisle_free(aisle_z) {
    return !this.aisle_locks.has(aisle_z);
  }

  lock_aisle(aisle_z, forklift) {
    this.aisle_locks.set(aisle_z, forklift);
  }

  unlock_aisle(aisle_z, forklift) {
    if (this.aisle_locks.get(aisle_z) === forklift) this.aisle_locks.delete(aisle_z);
  }

  // Las tareas de las montacargas de stock a reserva: guardar los pallets que ya están listos en la franja de armado
  store_tasks() {
    return this.sim.receiving.ready_pallets().map((pallet) => ({ type: "store", pallet }));
  }

  // Las tareas de las montacargas de reserva a activo: traer un pallet de un producto cuyo activo se quedó corto. Un producto entra
  // en reabasto cuando baja del umbral (un porcentaje de lo que le cabe en el activo) y sigue en él hasta llegar a la meta: así el
  // activo queda lleno, pero no a tope, con todos sus productos. Si un pedido espera un producto que el activo no tiene, ese producto
  // va primero.
  replen_tasks() {
    const { sim } = this;
    const threshold = sim.config.get("replenish_threshold") / 100;
    const target = sim.config.get("replenish_target") / 100;
    const urgent = [];
    const normal = [];
    for (let sku = 0; sku < SKUS.length; sku += 1) {
      if (this.replen_pending[sku]) continue;
      const capacity = this.sku_capacity(sku);
      if (capacity <= 0) continue;
      const stock = this.active_count(sku) + this.inbound[sku];
      if (stock <= threshold * capacity) this.replen_mode[sku] = true;
      else if (stock >= target * capacity) this.replen_mode[sku] = false;
      const waiting = sim.orders.waiting_lines(sku) > 0 && this.available(sku) <= 0;
      if (!waiting && !this.replen_mode[sku]) continue;
      const pallet = this.oldest_reserve_pallet(sku);
      if (!pallet || stock + pallet.boxes.length > capacity) continue;
      (waiting ? urgent : normal).push({ type: "replen", sku, pallet, waiting });
    }
    return [...urgent, ...normal];
  }

  assign_tasks(now) {
    this.assign_group_tasks(now, this.groups.stock, () => this.store_tasks());
    this.assign_group_tasks(now, this.groups.replen, () => this.replen_tasks());
  }

  assign_group_tasks(now, group, collect) {
    // Una montacarga que va de vuelta al taller puede tomar una tarea nueva en el camino
    const idle = group.forklifts.filter((forklift) => forklift.machine.state === "IDLE" && (!forklift.is_busy || forklift.parking) && !forklift.retiring && !forklift.wants_maintenance);
    let room = group.max_in_flight - group.forklifts.filter((forklift) => forklift.task).length;
    if (idle.length === 0 || room <= 0) return;
    const tasks = collect();
    for (const forklift of idle) {
      if (room <= 0) break;
      const task = tasks.find((candidate) => !candidate.taken && this.can_start(candidate));
      if (!task) break;
      room -= 1;
      task.taken = true;
      this.start_task(forklift, task, now);
    }
  }

  can_start(task) {
    if (task.type === "store") return this.find_free_reserve_index() >= 0;
    return true;
  }

  start_task(forklift, task, now) {
    const { sim } = this;
    if (forklift.parking) {
      forklift.abort_script();
      forklift.parking = false;
    }
    // Su puesto del taller queda libre (si ya iba hacia él, se sigue desde donde quedó)
    this.free_park_slot(forklift);
    if (task.type === "store") {
      task.pallet.claimed = true;
      task.index = this.find_free_reserve_index();
      this.reserve_claims[task.index] = true;
      task.description = `Guardar pallet ${task.pallet.id} (${sim.sku_label(task.pallet.sku_id)}) en la reserva`;
      forklift.task = task;
      forklift.start_script(this.store_script(forklift, task));
    } else {
      task.pallet.claimed = true;
      this.replen_pending[task.sku] = true;
      this.inbound[task.sku] += task.pallet.boxes.length;
      task.description = `Reabastecer ${sim.sku_label(task.sku)} con el pallet ${task.pallet.id}`;
      forklift.task = task;
      forklift.start_script(this.replen_script(forklift, task));
    }
    forklift.machine.go_to("GOING_TO_PICKUP", now);
  }

  // El camino hasta el troncal desde donde esté la montacarga (el puesto del taller, el carril del taller, el frente de la franja de
  // armado, el pasillo del elevador, el carril cruzado o un pasillo de rack) y por él hasta la altura `target_z`. Siempre se
  // recorren segmentos rectos y se entra al troncal por el carril de su sentido.
  to_trunk_steps(forklift, target_z) {
    const steps = [];
    let x = forklift.x;
    let z = forklift.z;
    const near = (value, goal, tolerance) => Math.abs(value - goal) <= tolerance;
    if (z >= GARAGE_LANE_Z + 1) {
      // En su puesto del taller: sale al carril del taller
      steps.push({ do: "drive", points: [{ x, z: GARAGE_LANE_Z }] });
      z = GARAGE_LANE_Z;
    }
    if (near(z, GARAGE_LANE_Z, 0.8) && !near(x, TRUNK_X, 1)) {
      steps.push({ do: "drive", points: [{ x: TRUNK_X - 0.3, z: GARAGE_LANE_Z }] });
      x = TRUNK_X - 0.3;
      z = GARAGE_LANE_Z;
    } else if (z > FRONT_LANE_Z + 0.8 && z < GARAGE_LANE_Z - 0.8 && !near(x, TRUNK_X, 1)) {
      // Frente a un puesto de la franja de armado: vuelve al carril del frente
      steps.push({ do: "drive", points: [{ x, z: FRONT_LANE_Z }] });
      z = FRONT_LANE_Z;
    }
    if (near(z, FRONT_LANE_Z, 0.8) && !near(x, TRUNK_X, 1)) {
      steps.push({ do: "drive", points: [{ x: TRUNK_X - 0.3, z: FRONT_LANE_Z }] });
      x = TRUNK_X - 0.3;
      z = FRONT_LANE_Z;
    } else if (x > TRUNK_X + 3 && z < FRONT_LANE_Z - 0.8 && near(x, REPLEN_LANE_X, 1)) {
      // En el pasillo del elevador: baja al carril del frente y va al troncal
      steps.push({ do: "drive", points: [{ x, z: FRONT_LANE_Z }, { x: TRUNK_X - 0.3, z: FRONT_LANE_Z }] });
      x = TRUNK_X - 0.3;
      z = FRONT_LANE_Z;
    } else if (!near(x, TRUNK_X, 1)) {
      // En el carril cruzado o en un pasillo de rack: sale hacia el troncal a la misma altura
      steps.push({ do: "drive", points: [{ x: target_z >= z ? TRUNK_X + 0.3 : TRUNK_X - 0.3, z }] });
      x = TRUNK_X;
    }
    const lane = target_z >= z ? TRUNK_X + 0.3 : TRUNK_X - 0.3;
    steps.push({ do: "drive", points: [{ x: lane, z }, { x: lane, z: target_z }] });
    return steps;
  }

  // El grupo (flota) al que pertenece una montacarga
  group_of(forklift) {
    return this.groups[forklift.fleet];
  }

  free_park_slot(forklift) {
    const group = this.group_of(forklift);
    if (forklift.park_index >= 0 && group.park_slots[forklift.park_index] === forklift) group.park_slots[forklift.park_index] = null;
    forklift.park_index = -1;
  }

  // Entrar a un pasillo, poner o sacar un pallet de su ubicación y salir en reversa
  aisle_steps(forklift, position, pallet_action) {
    const aisle_z = position.aisle_z;
    const faces_positive = position.z > aisle_z;
    const rack_yaw = faces_positive ? -Math.PI / 2 : Math.PI / 2;
    const level_height = position.y + 0.15;
    const direction = faces_positive ? 1 : -1;
    return [
      { do: "until", test: () => this.aisle_free(aisle_z) },
      { do: "call", fn: () => this.lock_aisle(aisle_z, forklift) },
      { do: "drive", points: [{ x: position.x, z: aisle_z }] },
      { do: "turn", yaw: rack_yaw, seconds: TURN_SECONDS },
      { do: "lift", to: level_height - (pallet_action.takes ? 0.15 : 0), seconds: LIFT_SECONDS },
      { do: "drive", points: [{ x: position.x, z: aisle_z + direction * INSERT_DISTANCE }], speed: 0.8 },
      ...pallet_action.steps,
      { do: "drive", points: [{ x: position.x, z: aisle_z }], reverse: true, speed: 0.8 },
      { do: "lift", to: 0.15, seconds: LIFT_SECONDS },
      { do: "turn", yaw: 0, seconds: TURN_SECONDS },
      { do: "drive", points: [{ x: TRUNK_X + 0.3, z: aisle_z }], reverse: true },
      { do: "call", fn: () => this.unlock_aisle(aisle_z, forklift) },
    ];
  }

  // Recoge algo del puesto de la franja de armado: viene por el carril del frente, baja hasta quedar frente al puesto y vuelve a
  // subir en reversa con la carga
  armado_pickup_steps(forklift, spot, pickup_action) {
    return [
      { do: "drive", points: [{ x: spot.x, z: FRONT_LANE_Z }] },
      { do: "drive", points: [{ x: spot.x, z: spot.z - PICKUP_DISTANCE }], speed: 1.5 },
      { do: "lift", to: 0.2, seconds: 1.0 },
      { do: "call", fn: pickup_action },
      { do: "drive", points: [{ x: spot.x, z: FRONT_LANE_Z }], reverse: true },
    ];
  }

  store_script(forklift, task) {
    const { sim } = this;
    const pallet = task.pallet;
    const spot = PALLET_SPOTS[pallet.spot_index];
    const position = this.positions[task.index];
    return [
      // Al carril del frente por el troncal, hasta la altura del frente de la franja de armado
      ...this.to_trunk_steps(forklift, FRONT_LANE_Z),
      ...this.armado_pickup_steps(forklift, spot, (time) => {
        pallet.machine.go_to("CARRIED", time);
        sim.receiving.release_pallet_spot(pallet);
        forklift.carried = [pallet];
        forklift.machine.go_to("CARRYING", time);
      }),
      { do: "drive", points: [{ x: TRUNK_X - 0.3, z: FRONT_LANE_Z }] },
      { do: "drive", points: [{ x: TRUNK_X - 0.3, z: position.aisle_z }] },
      ...this.aisle_steps(forklift, position, {
        takes: false,
        steps: [
          {
            do: "call",
            fn: (time) => {
              forklift.machine.go_to("UNLOADING", time);
              forklift.carried = [];
              this.store_pallet(pallet, task.index, time);
            },
          },
        ],
      }),
      { do: "call", fn: (time) => forklift.machine.go_to("RETURNING", time) },
    ];
  }

  replen_script(forklift, task) {
    const { sim } = this;
    const pallet = task.pallet;
    const position = this.positions[pallet.reserve_index];
    return [
      ...this.to_trunk_steps(forklift, position.aisle_z),
      ...this.aisle_steps(forklift, position, {
        takes: true,
        steps: [
          { do: "lift", to: position.y + 0.3, seconds: 0.8 },
          {
            do: "call",
            fn: (time) => {
              pallet.machine.go_to("CARRIED_TO_REPLENISH", time);
              this.release_reserve_pallet(pallet);
              forklift.carried = [pallet];
              forklift.machine.go_to("CARRYING", time);
            },
          },
        ],
      }),
      // Del troncal al carril cruzado y por el pasillo de reabasto hasta la mesa de desarme junto al elevador
      { do: "drive", points: [{ x: TRUNK_X + 0.3, z: CROSS_LANE_Z }] },
      { do: "drive", points: [{ x: REPLEN_LANE_X, z: CROSS_LANE_Z }] },
      { do: "until", test: () => this.unpack_jobs.length === 0 && !this.replen_lane_busy },
      { do: "call", fn: () => (this.replen_lane_busy = true) },
      { do: "drive", points: [{ x: REPLEN_LANE_X, z: UNLOAD_POINT.z + PICKUP_DISTANCE }], speed: 1.0 },
      {
        do: "call",
        fn: (time) => {
          forklift.machine.go_to("UNLOADING", time);
          forklift.carried = [];
          pallet.set_position(UNLOAD_POINT.x, 0.1, UNLOAD_POINT.z, 0);
          this.unpack_jobs.push({ pallet, next_at: time + 2 });
          sim.emit({ type: "replenish_started", sku: task.sku });
        },
      },
      { do: "lift", to: 0, seconds: 0.8 },
      { do: "drive", points: [{ x: REPLEN_LANE_X, z: CROSS_LANE_Z }], reverse: true, speed: 1.0 },
      { do: "call", fn: () => (this.replen_lane_busy = false) },
      { do: "drive", points: [{ x: TRUNK_X + 0.3, z: CROSS_LANE_Z }] },
      { do: "call", fn: (time) => forklift.machine.go_to("RETURNING", time) },
    ];
  }

  // Sin tareas, la montacarga vuelve a su puesto del taller: por el troncal hasta el carril del taller y por él hasta su puesto
  send_to_park(forklift) {
    const group = this.group_of(forklift);
    const slot = group.park_slots.findIndex((occupant) => occupant === null);
    if (slot < 0) return;
    group.park_slots[slot] = forklift;
    forklift.park_index = slot;
    const spot = group.spots[slot];
    forklift.parking = true;
    forklift.start_script([
      ...this.to_trunk_steps(forklift, GARAGE_LANE_Z),
      { do: "drive", points: [{ x: spot.x, z: GARAGE_LANE_Z }] },
      { do: "drive", points: [{ x: spot.x, z: spot.z }] },
      { do: "turn", yaw: -Math.PI / 2, seconds: 1.0 },
      { do: "call", fn: () => (forklift.parking = false) },
    ]);
  }

  // ---------- Un paso ----------
  step(now, dt) {
    Object.values(this.groups).forEach((group) => this.sync_forklift_count(now, group));
    this.assign_tasks(now);
    Object.values(this.groups).forEach((group) => {
      group.forklifts.forEach((forklift) => {
        forklift.update(dt, now);
        // Rueda con lo que avanza
        if (forklift.moved_this_step) forklift.wheel_angle += (Math.hypot(forklift.x - forklift.prev_x, forklift.z - forklift.prev_z) / 0.3) * (forklift.is_reversing ? -1 : 1);
      });
      group.forklifts.forEach((forklift) => this.settle_forklift(forklift, now));
      group.forklifts = group.forklifts.filter((forklift) => {
        if (forklift.retiring && forklift.machine.state === "IDLE" && this.in_garage(forklift) && !forklift.is_busy) {
          this.free_park_slot(forklift);
          return false;
        }
        return true;
      });
    });
    this.step_unpack(now);
    this.step_elevator(now, dt);
  }

  // Lo que hace una montacarga que no tiene nada en marcha: mantenimiento, volver al taller o quedarse libre
  settle_forklift(forklift, now) {
    if (forklift.is_busy) return;
    const state = forklift.machine.state;
    if (state === "MAINTENANCE") return;
    if (forklift.wants_maintenance && state === "IDLE") {
      forklift.machine.go_to("MAINTENANCE", now);
      this.send_to_park(forklift);
      return;
    }
    if (state === "IDLE" && !this.in_garage(forklift) && !forklift.task) this.send_to_park(forklift);
  }
}
