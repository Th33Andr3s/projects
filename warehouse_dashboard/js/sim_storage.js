// Almacenamiento: la reserva (racks de pallets), el activo (stock por SKU en los 5 pisos), los montacargas que llevan pallets,
// el elevador que sube las cubetas y el reabasto, que trae pallets de la reserva cuando el activo de un SKU se queda corto.
//
// Prioridad de los montacargas, de mayor a menor: reabasto de un SKU que ya tiene pedidos esperando, guardar pallets de recibo,
// y reabasto normal por umbral. Un pasillo de rack lo usa un montacargas a la vez.

import {
  ACTIVE_SKU_CAPACITY,
  ACTIVE_SLOTS_PER_SKU,
  SKU_COUNT,
  TOTE_CAPACITY,
  sku_floor,
} from "./config.js";
import { Belt } from "./belts.js";
import { Elevator, Forklift, Tote } from "./entities.js";
import {
  BELT_HEIGHT,
  CROSS_LANE_Z,
  ELEVATOR,
  PALLET_SPOT_X,
  PALLET_SPOT_ZS,
  PARK_SPOTS,
  TOTE_CONVEYOR_START_X,
  TRUNK_X,
  UNLOAD_POINT,
  floor_y,
  reserve_positions,
  sku_anchor,
} from "./layout.js";

const BOX_SIZE = 0.55;
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

// Dónde queda la caja número `index` del SKU en el activo (en un estante, de izquierda a derecha)
export function active_slot_position(sku_id, index) {
  const anchor = sku_anchor(sku_id);
  const shelf = Math.floor(index / COLUMNS_PER_SHELF);
  const column = index % COLUMNS_PER_SHELF;
  return {
    x: anchor.x0 + 0.35 + column * 0.69,
    y: anchor.y + SHELF_TOPS[shelf] + BOX_SIZE / 2,
    z: anchor.z,
  };
}

export class StorageSystem {
  constructor(sim) {
    this.sim = sim;
    const { paths } = sim;

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
    this.park_slots = PARK_SPOTS.map(() => null);
    this.aisle_locks = new Map();
    this.unpack_jobs = [];

    this.conveyor = new Belt("tote_conveyor", "tote_in", paths.tote_conveyor, (belt) => sim.belt_speed());
    this.conveyor.on_end = (tote, belt, now) => this.elevator_take(tote, now);
    sim.belts.push(this.conveyor);
    this.unload_s = UNLOAD_POINT.x - TOTE_CONVEYOR_START_X;
    this.elevator = new Elevator(ELEVATOR, 0);
    this.elevator_box_timer = 0;
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
  // Una cubeta de recibo llena sale a la banda hacia el elevador. Devuelve si pudo salir.
  try_start_tote(tote, now) {
    if (!this.conveyor.has_space_at(0, tote.belt_length)) return false;
    tote.machine.go_to("ON_CONVEYOR", now);
    this.conveyor.try_insert(tote, 0, now);
    return true;
  }

  elevator_take(tote, now) {
    const elevator = this.elevator;
    if (elevator.machine.state !== "IDLE") return false;
    elevator.tote = tote;
    elevator.target_floor = tote.floor;
    elevator.machine.go_to("LOADING", now);
    elevator.timer = ELEVATOR_LOAD_SECONDS;
    tote.machine.go_to("IN_ELEVATOR", now);
    return true;
  }

  step_elevator(now, dt) {
    const elevator = this.elevator;
    const state = elevator.machine.state;
    elevator.prev_y = elevator.y;
    if (state === "IDLE") return;
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
      if (!this.conveyor.has_space_at(this.unload_s, 1.1)) continue;
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
      tote.machine.go_to("ON_CONVEYOR", now);
      this.conveyor.try_insert(tote, this.unload_s, now);
      job.next_at = now + UNPACK_INTERVAL_SECONDS;
      if (pallet.boxes.length === 0) {
        pallet.machine.go_to("UNPACKED", now);
        this.sim.pallets = this.sim.pallets.filter((candidate) => candidate !== pallet);
        this.unpack_jobs = this.unpack_jobs.filter((candidate) => candidate !== job);
        this.replen_pending[pallet.sku_id] = false;
      }
    }
  }

  // ---------- Montacargas ----------
  sync_forklift_count(now) {
    const wanted = this.sim.config.get("forklift_count");
    const active = this.forklifts.filter((forklift) => !forklift.retiring);
    for (let index = active.length; index < wanted; index += 1) this.add_forklift(now);
    // Si sobran, los que están libres se retiran en cuanto estén en el parqueo
    let surplus = active.length - wanted;
    for (let index = active.length - 1; index >= 0 && surplus > 0; index -= 1) {
      active[index].retiring = true;
      surplus -= 1;
    }
  }

  add_forklift(now) {
    const forklift = new Forklift(this.sim.next_id("forklift"), now);
    const slot = this.park_slots.findIndex((occupant) => occupant === null);
    forklift.park_index = slot;
    if (slot >= 0) this.park_slots[slot] = forklift;
    const spot = PARK_SPOTS[Math.max(0, slot)];
    forklift.teleport(spot.x, 0, spot.z, Math.PI / 2);
    forklift.at_park = true;
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

  // Un pasillo solo lo usa un montacarga a la vez
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
    sim.receiving.ready_pallets().forEach((pallet) => tasks.push({ type: "store", pallet }));
    replenish.filter((task) => !task.waiting).forEach((task) => tasks.push(task));
    return tasks;
  }

  assign_tasks(now) {
    // Un montacarga que va de vuelta al parqueo puede tomar una tarea nueva en el camino
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
    task.pallet.claimed = true;
    if (forklift.parking) {
      forklift.abort_script();
      forklift.parking = false;
      // Si ya estaba por entrar al parqueo, la plaza se libera; y desde donde quedó se sigue por el troncal o desde el taller
      this.free_park_slot(forklift);
      forklift.at_park = forklift.x > TRUNK_X + 1;
      forklift.trunk_z = forklift.z;
    }
    if (task.type === "store") {
      task.index = this.find_free_reserve_index();
      this.reserve_claims[task.index] = true;
      task.description = `Guardar pallet ${task.pallet.id} (${sim.sku_label(task.pallet.sku_id)})`;
      forklift.task = task;
      forklift.start_script(this.store_script(forklift, task));
    } else {
      this.replen_pending[task.sku] = true;
      this.inbound[task.sku] += task.pallet.boxes.length;
      task.description = `Reabastecer ${sim.sku_label(task.sku)} con el pallet ${task.pallet.id}`;
      forklift.task = task;
      forklift.start_script(this.replen_script(forklift, task));
    }
    forklift.machine.go_to("GOING_TO_PICKUP", now);
  }

  // El camino hasta el troncal desde donde esté el montacarga, y por él hasta la altura z
  to_trunk_steps(forklift, target_z) {
    const steps = [];
    let current_z = forklift.trunk_z === undefined ? forklift.z : forklift.trunk_z;
    if (forklift.at_park) {
      steps.push({ do: "drive", points: [{ x: TRUNK_X, z: forklift.z }] });
      current_z = forklift.z;
      steps.push({
        do: "call",
        fn: () => {
          forklift.at_park = false;
          this.free_park_slot(forklift);
        },
      });
    }
    // Dos carriles en el troncal, uno por sentido, para que no se crucen de frente
    const lane = target_z >= current_z ? TRUNK_X + 0.3 : TRUNK_X - 0.3;
    steps.push({ do: "drive", points: [{ x: lane, z: current_z }, { x: lane, z: target_z }] });
    steps.push({ do: "call", fn: () => (forklift.trunk_z = target_z) });
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
      { do: "call", fn: () => (forklift.trunk_z = aisle_z) },
    ];
  }

  store_script(forklift, task) {
    const { sim } = this;
    const pallet = task.pallet;
    const spot_z = PALLET_SPOT_ZS[pallet.spot_index];
    const position = this.positions[task.index];
    return [
      ...this.to_trunk_steps(forklift, spot_z),
      { do: "drive", points: [{ x: PALLET_SPOT_X + FORKLIFT_LENGTH_HALF, z: spot_z }], speed: 1.5 },
      { do: "lift", to: 0.2, seconds: 1.0 },
      {
        do: "call",
        fn: (time) => {
          pallet.machine.go_to("CARRIED", time);
          sim.receiving.release_pallet_spot(pallet);
          forklift.carried = [pallet];
          forklift.machine.go_to("CARRYING", time);
        },
      },
      { do: "drive", points: [{ x: TRUNK_X + 0.3, z: spot_z }], reverse: true },
      { do: "call", fn: () => (forklift.trunk_z = spot_z) },
      { do: "drive", points: [{ x: TRUNK_X + 0.3, z: position.aisle_z }] },
      { do: "call", fn: () => (forklift.trunk_z = position.aisle_z) },
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
              this.reserve_slots[pallet.reserve_index] = null;
              this.reserve_pallets = this.reserve_pallets.filter((candidate) => candidate !== pallet);
              pallet.reserve_index = -1;
              forklift.carried = [pallet];
              forklift.machine.go_to("CARRYING", time);
            },
          },
        ],
      }),
      // Del troncal al carril cruzado y hasta la mesa de reabasto
      { do: "drive", points: [{ x: TRUNK_X + 0.3, z: CROSS_LANE_Z }] },
      { do: "drive", points: [{ x: UNLOAD_POINT.x, z: CROSS_LANE_Z }] },
      { do: "turn", yaw: Math.PI / 2, seconds: TURN_SECONDS },
      { do: "drive", points: [{ x: UNLOAD_POINT.x, z: UNLOAD_POINT.z + FORKLIFT_LENGTH_HALF }], speed: 1.0 },
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
      { do: "drive", points: [{ x: UNLOAD_POINT.x, z: CROSS_LANE_Z }], reverse: true, speed: 1.0 },
      { do: "turn", yaw: Math.PI, seconds: TURN_SECONDS },
      { do: "drive", points: [{ x: TRUNK_X - 0.3, z: CROSS_LANE_Z }] },
      { do: "call", fn: () => (forklift.trunk_z = CROSS_LANE_Z) },
      { do: "call", fn: (time) => forklift.machine.go_to("RETURNING", time) },
    ];
  }

  // Sin tareas, el montacarga vuelve al parqueo del taller
  send_to_park(forklift, now) {
    const slot = this.park_slots.findIndex((occupant) => occupant === null);
    if (slot < 0) return;
    this.park_slots[slot] = forklift;
    forklift.park_index = slot;
    const spot = PARK_SPOTS[slot];
    const lane = forklift.z <= spot.z ? TRUNK_X + 0.3 : TRUNK_X - 0.3;
    forklift.parking = true;
    forklift.start_script([
      { do: "drive", points: [{ x: lane, z: forklift.trunk_z === undefined ? forklift.z : forklift.trunk_z }, { x: lane, z: spot.z }] },
      { do: "drive", points: [{ x: spot.x, z: spot.z }] },
      { do: "turn", yaw: Math.PI / 2, seconds: 1.0 },
      {
        do: "call",
        fn: () => {
          forklift.at_park = true;
          forklift.parking = false;
          forklift.trunk_z = undefined;
        },
      },
    ]);
  }

  // ---------- Un paso ----------
  step(now, dt) {
    this.sync_forklift_count(now);
    this.assign_tasks(now);
    this.forklifts.forEach((forklift) => {
      forklift.update(dt, now);
      // Rueda con lo que avanza
      forklift.wheel_angle += (Math.hypot(forklift.x - forklift.prev_x, forklift.z - forklift.prev_z) / 0.3) * (forklift.is_reversing ? -1 : 1);
    });
    this.forklifts.forEach((forklift) => this.settle_forklift(forklift, now));
    this.forklifts = this.forklifts.filter((forklift) => {
      if (forklift.retiring && forklift.machine.state === "IDLE" && forklift.at_park && !forklift.is_busy) {
        this.free_park_slot(forklift);
        return false;
      }
      return true;
    });
    this.step_unpack(now);
    this.step_elevator(now, dt);
    this.conveyor.update(dt, now);
  }

  // Lo que hace un montacarga que no tiene nada en marcha: mantenimiento, volver al parqueo o quedarse libre
  settle_forklift(forklift, now) {
    if (forklift.is_busy) return;
    const state = forklift.machine.state;
    if (state === "MAINTENANCE") return;
    if (forklift.wants_maintenance && state === "IDLE") {
      forklift.machine.go_to("MAINTENANCE", now);
      this.send_to_workshop(forklift);
      return;
    }
    if (state === "IDLE" && !forklift.at_park && !forklift.task) this.send_to_park(forklift, now);
  }

  send_to_workshop(forklift) {
    this.send_to_park(forklift, this.sim.now);
  }
}
