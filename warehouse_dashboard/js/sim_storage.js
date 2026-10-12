// Almacenamiento: la reserva (racks de pallets), el activo (stock por SKU en los 5 pisos), las montacargas de stock a racks y
// multinivel, el elevador que sube las cubetas y el reabasto, que trae pallets de la reserva cuando el activo de un SKU se queda corto.
// (Las montacargas de muelle a stock están en sim_dock_fleet.js.)
//
// Prioridad de estas montacargas, de mayor a menor: reabasto de un SKU que ya tiene pedidos esperando, llevar cubetas llenas al
// elevador, guardar pallets en los racks, y reabasto normal por umbral. Un pasillo de rack lo usa una montacarga a la vez.

import {
  ACTIVE_SKU_CAPACITY,
  ACTIVE_SLOTS_PER_SKU,
  SKU_COUNT,
  TOTE_CAPACITY,
  sku_floor,
} from "./config.js";
import { SKUS } from "./catalog.js";
import { Elevator, Forklift, Tote } from "./entities.js";
import {
  BELT_HEIGHT,
  CROSS_LANE_Z,
  ELEVATOR,
  ELEVATOR_DOOR,
  FRONT_LANE_Z,
  GARAGE_LANE_Z,
  PALLET_SPOTS,
  PARK_SPOTS_STOCK,
  REPLEN_LANE_X,
  TOTE_LANE_X,
  TOTE_STATIONS,
  TRUNK_X,
  UNLOAD_POINT,
  floor_y,
  reserve_positions,
  sku_anchor,
} from "./layout.js";

// Alturas de los estantes del activo por encima de la losa, como en la escena estática
const SHELF_TOPS = [0.7, 1.45, 2.2];
const COLUMNS_PER_SHELF = 20;
const ELEVATOR_SPEED = 2.5;
const ELEVATOR_LOAD_SECONDS = 1.5;
const ELEVATOR_BOX_SECONDS = 0.8;
const UNPACK_INTERVAL_SECONDS = 3;
const LIFT_SECONDS = 1.2;
const TURN_SECONDS = 0.9;
const INSERT_DISTANCE = 1.2;
const FORKLIFT_LENGTH_HALF = 1.15;
// Las montacargas con la fila de abajo de la franja de armado: se paran a esta distancia del puesto, mirando hacia él
const PICKUP_DISTANCE = 1.75;

// Dónde queda la caja número `index` del SKU en el activo (en un estante, de izquierda a derecha)
export function active_slot_position(sku_id, index) {
  const anchor = sku_anchor(sku_id);
  const shelf = Math.floor(index / COLUMNS_PER_SHELF);
  const column = index % COLUMNS_PER_SHELF;
  return {
    x: anchor.x0 + 0.35 + column * 0.69,
    // La caja se apoya en el estante: su centro queda a media altura de ella
    y: anchor.y + SHELF_TOPS[shelf] + SKUS[sku_id].size[1] / 2,
    z: anchor.z,
  };
}

export class StorageSystem {
  constructor(sim) {
    this.sim = sim;

    this.positions = reserve_positions();
    // Qué pallet ocupa cada ubicación de la reserva, y cuáles están apartadas por un montacarga
    this.reserve_slots = this.positions.map(() => null);
    this.reserve_claims = this.positions.map(() => false);
    this.reserve_pallets = [];

    this.active = Array.from({ length: SKU_COUNT }, () => ({ slots: Array(ACTIVE_SLOTS_PER_SKU).fill(null), count: 0, reserved: 0 }));
    // Cajas que van en camino al activo de cada SKU (en cubetas o en un pallet que se está desarmando)
    this.inbound = Array(SKU_COUNT).fill(0);
    this.replen_pending = Array(SKU_COUNT).fill(false);

    this.forklifts = [];
    this.park_slots = PARK_SPOTS_STOCK.map(() => null);
    this.aisle_locks = new Map();
    this.unpack_jobs = [];

    this.elevator = new Elevator(ELEVATOR, 0);
    this.elevator_box_timer = 0;
    // La cubeta que espera en la puerta del elevador (una a la vez) y quién tiene ocupado el pasillo de cubetas o el de reabasto
    this.door_tote = null;
    this.tote_lane_busy = false;
    this.replen_lane_busy = false;
  }

  // ---------- Activo ----------
  active_count(sku_id) {
    return this.active[sku_id].count;
  }

  available(sku_id) {
    const entry = this.active[sku_id];
    return entry.count - entry.reserved;
  }

  // Cuántas cajas más de este SKU caben, contando las que vienen en camino
  active_room(sku_id) {
    return ACTIVE_SKU_CAPACITY - this.active[sku_id].count - this.inbound[sku_id];
  }

  floor_count(floor) {
    let total = 0;
    for (let sku = floor; sku < SKU_COUNT; sku += 5) total += this.active[sku].count;
    return total;
  }

  // Una caja entra al stock del activo, en el primer lugar libre de su SKU. Devuelve false si no hay.
  add_to_active(box, now, teleport = true) {
    const entry = this.active[box.sku_id];
    const index = entry.slots.indexOf(null);
    if (index < 0) return false;
    entry.slots[index] = box;
    entry.count += 1;
    box.slot_index = index;
    box.container = null;
    box.order = null;
    box.line = null;
    box.reserved = false;
    box.machine.go_to("IN_ACTIVE", now);
    const position = active_slot_position(box.sku_id, index);
    if (teleport) box.teleport(position.x, position.y, position.z, 0);
    else box.set_position(position.x, position.y, position.z, 0);
    this.sim.orders.on_stock_added(box.sku_id);
    return true;
  }

  remove_from_active(box) {
    const entry = this.active[box.sku_id];
    if (box.slot_index >= 0 && entry.slots[box.slot_index] === box) {
      entry.slots[box.slot_index] = null;
      entry.count -= 1;
      if (box.reserved) entry.reserved -= 1;
    }
    box.slot_index = -1;
    box.reserved = false;
  }

  // Aparta una caja del stock para una línea de pedido (la de menor posición que no esté apartada)
  reserve_box(sku_id) {
    const entry = this.active[sku_id];
    for (const box of entry.slots) {
      if (box && !box.reserved) {
        box.reserved = true;
        entry.reserved += 1;
        return box;
      }
    }
    return null;
  }

  unreserve_box(box) {
    if (!box.reserved) return;
    box.reserved = false;
    this.active[box.sku_id].reserved -= 1;
  }

  // ---------- Reserva ----------
  reserve_used() {
    return this.reserve_pallets.length;
  }

  find_free_reserve_index() {
    const capacity = Math.min(this.positions.length, this.sim.config.get("reserve_capacity"));
    for (let index = 0; index < capacity; index += 1) {
      if (!this.reserve_slots[index] && !this.reserve_claims[index]) return index;
    }
    return -1;
  }

  // Un pallet queda guardado en su ubicación (también lo usa el relleno inicial)
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
  }

  oldest_reserve_pallet(sku_id) {
    return this.reserve_pallets.find((pallet) => pallet.sku_id === sku_id && !pallet.claimed) || null;
  }

  reserve_boxes(sku_id) {
    return this.reserve_pallets.filter((pallet) => pallet.sku_id === sku_id).reduce((total, pallet) => total + pallet.boxes.length, 0);
  }

  // ---------- Cubetas hacia el elevador ----------
  // Una cubeta queda en la puerta del elevador (la deja una montacarga, o nace ahí al desarmar un pallet de reabasto)
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
        if (this.add_to_active(box, now)) {
          tote.boxes.shift();
          this.inbound[box.sku_id] -= 1;
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
  step_unpack(now) {
    for (const job of [...this.unpack_jobs]) {
      if (now < job.next_at) continue;
      // La cubeta nueva necesita la puerta del elevador libre (y que no venga una montacarga a dejar la suya)
      if (this.door_tote || this.tote_lane_busy) continue;
      const pallet = job.pallet;
      const count = Math.min(TOTE_CAPACITY, pallet.boxes.length);
      const tote = new Tote(this.sim.next_id("tote"), "in", now);
      tote.floor = sku_floor(pallet.sku_id);
      for (let index = 0; index < count; index += 1) {
        const box = pallet.boxes.shift();
        box.machine.go_to("IN_TOTE", now);
        box.container = tote;
        tote.boxes.push(box);
      }
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

  // ---------- Montacargas de stock a racks y multinivel ----------
  sync_forklift_count(now) {
    const wanted = this.sim.config.get("forklift_count");
    const active = this.forklifts.filter((forklift) => !forklift.retiring);
    for (let index = active.length; index < wanted; index += 1) this.add_forklift(now);
    // Si sobran, las que están libres se retiran en cuanto estén en el taller
    let surplus = active.length - wanted;
    for (let index = active.length - 1; index >= 0 && surplus > 0; index -= 1) {
      active[index].retiring = true;
      surplus -= 1;
    }
  }

  add_forklift(now) {
    const forklift = new Forklift(this.sim.next_id("forklift"), now, "stock");
    const slot = this.park_slots.findIndex((occupant) => occupant === null);
    forklift.park_index = slot;
    if (slot >= 0) this.park_slots[slot] = forklift;
    const spot = PARK_SPOTS_STOCK[Math.max(0, slot)];
    forklift.teleport(spot.x, 0, spot.z, -Math.PI / 2);
    forklift.on_idle = () => this.on_forklift_idle(forklift);
    this.forklifts.push(forklift);
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

  // Las tareas que hay por hacer, de mayor a menor prioridad
  collect_tasks() {
    const { sim } = this;
    const tasks = [];
    const threshold = (sim.config.get("replenish_threshold") / 100) * ACTIVE_SKU_CAPACITY;
    const replenish = [];
    for (let sku = 0; sku < SKU_COUNT; sku += 1) {
      if (this.replen_pending[sku]) continue;
      const waiting = sim.orders.waiting_lines(sku) > 0 && this.available(sku) <= 0;
      const stock = this.active[sku].count + this.inbound[sku];
      if (!waiting && stock > threshold) continue;
      const pallet = this.oldest_reserve_pallet(sku);
      if (!pallet || stock + pallet.boxes.length > ACTIVE_SKU_CAPACITY) continue;
      replenish.push({ type: "replen", sku, pallet, waiting });
    }
    replenish.filter((task) => task.waiting).forEach((task) => tasks.push(task));
    sim.receiving.ready_totes().forEach((tote) => tasks.push({ type: "tote", tote }));
    sim.receiving.ready_pallets().forEach((pallet) => tasks.push({ type: "store", pallet }));
    replenish.filter((task) => !task.waiting).forEach((task) => tasks.push(task));
    return tasks;
  }

  assign_tasks(now) {
    // Una montacarga que va de vuelta al taller puede tomar una tarea nueva en el camino
    const idle = this.forklifts.filter((forklift) => forklift.machine.state === "IDLE" && (!forklift.is_busy || forklift.parking) && !forklift.retiring && !forklift.wants_maintenance);
    if (idle.length === 0) return;
    const tasks = this.collect_tasks();
    for (const forklift of idle) {
      const task = tasks.find((candidate) => !candidate.taken && this.can_start(candidate));
      if (!task) break;
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
    } else if (task.type === "tote") {
      task.tote.claimed = true;
      task.description = `Llevar la cubeta ${task.tote.id} (piso ${task.tote.floor + 1}) al elevador`;
      forklift.task = task;
      forklift.start_script(this.tote_script(forklift, task));
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
    } else if (x > TRUNK_X + 3 && z < FRONT_LANE_Z - 0.8 && (near(x, TOTE_LANE_X, 1) || near(x, REPLEN_LANE_X, 1))) {
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

  free_park_slot(forklift) {
    if (forklift.park_index >= 0 && this.park_slots[forklift.park_index] === forklift) this.park_slots[forklift.park_index] = null;
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

  // Lleva una cubeta llena de la franja de armado a la puerta del elevador por el pasillo de cubetas
  tote_script(forklift, task) {
    const { sim } = this;
    const tote = task.tote;
    const station = TOTE_STATIONS[tote.floor];
    const pose_z = ELEVATOR_DOOR.z + PICKUP_DISTANCE;
    return [
      ...this.to_trunk_steps(forklift, FRONT_LANE_Z),
      ...this.armado_pickup_steps(forklift, station, (time) => {
        tote.machine.go_to("CARRIED", time);
        sim.receiving.release_tote_station(tote);
        forklift.carried = [tote];
        forklift.machine.go_to("CARRYING", time);
      }),
      { do: "drive", points: [{ x: TOTE_LANE_X, z: FRONT_LANE_Z }] },
      // La puerta del elevador y el pasillo son de uno a la vez
      { do: "until", test: () => !this.door_tote && !this.tote_lane_busy },
      { do: "call", fn: () => (this.tote_lane_busy = true) },
      { do: "drive", points: [{ x: TOTE_LANE_X, z: pose_z }] },
      // Si mientras tanto una cubeta recién desarmada ocupó la puerta, espera a que el elevador la tome
      { do: "until", test: () => !this.door_tote },
      { do: "lift", to: 0.2, seconds: 0.6 },
      {
        do: "call",
        fn: (time) => {
          forklift.machine.go_to("UNLOADING", time);
          forklift.carried = [];
          this.place_at_door(tote, time);
        },
      },
      { do: "drive", points: [{ x: TOTE_LANE_X, z: FRONT_LANE_Z }], reverse: true },
      { do: "call", fn: () => (this.tote_lane_busy = false) },
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
              this.reserve_slots[pallet.reserve_index] = null;
              this.reserve_pallets = this.reserve_pallets.filter((candidate) => candidate !== pallet);
              pallet.reserve_index = -1;
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
  send_to_park(forklift, now) {
    const slot = this.park_slots.findIndex((occupant) => occupant === null);
    if (slot < 0) return;
    this.park_slots[slot] = forklift;
    forklift.park_index = slot;
    const spot = PARK_SPOTS_STOCK[slot];
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
    this.sync_forklift_count(now);
    this.assign_tasks(now);
    this.forklifts.forEach((forklift) => {
      forklift.update(dt, now);
      // Rueda con lo que avanza
      if (forklift.moved_this_step) forklift.wheel_angle += (Math.hypot(forklift.x - forklift.prev_x, forklift.z - forklift.prev_z) / 0.3) * (forklift.is_reversing ? -1 : 1);
    });
    this.forklifts.forEach((forklift) => this.settle_forklift(forklift, now));
    this.forklifts = this.forklifts.filter((forklift) => {
      if (forklift.retiring && forklift.machine.state === "IDLE" && this.in_garage(forklift) && !forklift.is_busy) {
        this.free_park_slot(forklift);
        return false;
      }
      return true;
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
      this.send_to_workshop(forklift);
      return;
    }
    if (state === "IDLE" && !this.in_garage(forklift) && !forklift.task) this.send_to_park(forklift, now);
  }

  send_to_workshop(forklift) {
    this.send_to_park(forklift, this.sim.now);
  }
}
