// Recibo: llegan las tractomulas, hacen cola si no hay muelle, se acoplan de reversa, descargan las cajas por el riel hasta una
// mesa, y de ahí cada caja se reparte al azar (70 % / 30 %) a un pallet de su SKU, que va a la reserva, o a una cubeta de su
// piso, que sube al activo. Es el único lugar donde entran cajas nuevas a la bodega.

import {
  FIRST_TRUCK_SECONDS,
  PALLET_FLUSH_SECONDS,
  RAIL_SPEED,
  RECEIVING_BACKLOG_LIMIT,
  SKU_COUNT,
  SPLIT_RESERVE,
  TABLE_CAPACITY,
  TABLE_HANDLING_SECONDS,
  TOTE_CAPACITY,
  TOTE_FLUSH_SECONDS,
  sku_floor,
} from "./config.js";
import { Belt } from "./belts.js";
import { Dock, Pallet, Tote, Truck } from "./entities.js";
import { PALLET_SPOT_X, PALLET_SPOT_ZS, TOTE_STATION_X, TOTE_STATION_ZS, TRUCK } from "./layout.js";

const CAB_COLORS = ["#ef4444", "#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899"];
const ENTRY_POINT = { x: -89.5, z: -3.5 };
const EXIT_LANE_Z = 3.5;
const DOOR_SECONDS = 1.5;
const TURN_SECONDS = 2.5;
// Si todos los lugares de espera están ocupados, el camión espera afuera y vuelve a intentarlo después de esto
const QUEUE_FULL_RETRY_SECONDS = 30;

export class ReceivingSystem {
  constructor(sim) {
    this.sim = sim;
    const { layout, paths } = sim;
    this.docks = layout.docks.map((layout_dock, index) => {
      const dock = new Dock(index, layout_dock, 0);
      dock.rail = new Belt(`rail_${index + 1}`, "rail", paths.rails[index], () => RAIL_SPEED);
      dock.rail.on_end = (box, belt, now) => this.on_rail_end(dock, box, now);
      sim.belts.push(dock.rail);
      return dock;
    });
    this.trucks = [];
    // Camiones esperando muelle, en el orden en que llegaron
    this.queue = [];
    this.queue_spots = layout.queue_spots.map(() => null);
    this.forming_pallets = [];
    this.pallet_spots = PALLET_SPOT_ZS.map(() => null);
    this.filling_totes = TOTE_STATION_ZS.map(() => null);
    this.pending_arrival = null;
    // Cajas en rieles y mesas: cuando son muchas, los camiones dejan de descargar
    this.backlog = 0;
    this.schedule_first_arrival();
  }

  // ---------- Llegadas ----------
  schedule_first_arrival() {
    this.schedule_arrival_at(FIRST_TRUCK_SECONDS);
  }

  schedule_arrival_at(time) {
    this.pending_arrival = { time, id: this.sim.events.schedule(time, "truck_arrival") };
  }

  schedule_next_arrival(now) {
    const { config, rng_trucks } = this.sim;
    const spread = config.get("truck_interval_spread");
    const interval = Math.max(30, config.get("truck_interval_mean") + rng_trucks.float(-spread, spread));
    this.schedule_arrival_at(now + interval);
  }

  // Mueve la llegada pendiente (lo usa la disrupción de camión retrasado)
  move_pending_arrival(new_time) {
    if (!this.pending_arrival) return;
    this.sim.events.cancel(this.pending_arrival.id);
    this.schedule_arrival_at(new_time);
  }

  // Un cargamento: cada caja con un solo SKU y, en tandas de SKU_COUNT, sin repetir producto
  make_cargo(now) {
    const { config, rng_cargo } = this.sim;
    const total = config.get("boxes_per_truck");
    const cargo = [];
    while (cargo.length < total) {
      const round = rng_cargo.shuffle(Array.from({ length: SKU_COUNT }, (_, sku) => sku));
      for (const sku of round) {
        if (cargo.length >= total) break;
        cargo.push(this.sim.new_box(sku, now));
      }
    }
    return cargo;
  }

  on_truck_arrival(now) {
    const { sim } = this;
    // Sin lugar en el patio: el camión espera en la vía y vuelve a intentarlo
    const free_dock = this.find_free_dock();
    if (!free_dock && this.queue.length >= this.queue_spots.length) {
      this.schedule_arrival_at(now + QUEUE_FULL_RETRY_SECONDS);
      return;
    }
    this.pending_arrival = null;
    sim.disruptions.on_truck_arrived(now);
    sim.counters.trucks_received += 1;
    const truck = new Truck(sim.next_id("truck_receiving"), "receiving", now);
    truck.cargo = this.make_cargo(now);
    truck.cab_color = CAB_COLORS[truck.id % CAB_COLORS.length];
    truck.teleport(ENTRY_POINT.x, 0, ENTRY_POINT.z, 0);
    this.trucks.push(truck);
    sim.emit({ type: "truck_arrived", truck });
    if (free_dock) this.send_to_dock(truck, free_dock, now);
    else this.send_to_queue(truck, now);
    this.schedule_next_arrival(now);
  }

  find_free_dock() {
    return this.docks.find((dock) => dock.enabled && !dock.truck) || null;
  }

  send_to_queue(truck, now) {
    const spot_index = this.queue_spots.findIndex((occupant) => occupant === null);
    const spot = this.sim.layout.queue_spots[spot_index];
    this.queue_spots[spot_index] = truck;
    truck.queue_spot = spot_index;
    this.queue.push(truck);
    truck.start_script([
      { do: "drive", points: [{ x: -80, z: ENTRY_POINT.z }, { x: spot.x - TRUCK.length / 2 + 2, z: spot.z }] },
      { do: "call", fn: (time) => truck.machine.go_to("QUEUED", time) },
    ]);
  }

  send_to_dock(truck, dock, now) {
    dock.truck = truck;
    truck.dock = dock;
    dock.machine.go_to("OCCUPIED", now);
    if (truck.machine.state !== "DOCKING") truck.machine.go_to("DOCKING", now);
    const layout_dock = dock.layout;
    const from_queue = truck.queue_spot !== undefined && truck.queue_spot >= 0;
    const approach = from_queue
      ? [{ x: layout_dock.approach_x, z: dock.z }]
      : [{ x: -76, z: ENTRY_POINT.z }, { x: layout_dock.approach_x, z: dock.z }];
    if (from_queue) {
      this.queue_spots[truck.queue_spot] = null;
      truck.queue_spot = -1;
    }
    truck.start_script([
      { do: "drive", points: approach },
      { do: "turn", yaw: Math.PI, seconds: TURN_SECONDS },
      { do: "drive", points: [{ x: layout_dock.truck_x, z: dock.z }], reverse: true, speed: 2.5 },
      {
        do: "call",
        fn: (time) => {
          truck.machine.go_to("UNLOADING", time);
          truck.door_target = 1;
        },
      },
    ]);
  }

  // Un camión vacío se va: cierra la puerta, sale por el carril de salida y libera el muelle apenas se aparta
  start_leaving(truck, now) {
    const dock = truck.dock;
    truck.door_target = 0;
    truck.machine.go_to("LEAVING_EMPTY", now);
    this.sim.emit({ type: "truck_leaving", truck });
    truck.start_script([
      { do: "until", test: () => truck.door_open <= 0 },
      { do: "drive", points: [{ x: dock.layout.truck_x - 7.5, z: dock.z }] },
      {
        do: "call",
        fn: (time) => {
          dock.truck = null;
          dock.machine.go_to("EMPTY", time);
          truck.dock = null;
        },
      },
      { do: "drive", points: [{ x: -78, z: EXIT_LANE_Z }, { x: -90, z: EXIT_LANE_Z }] },
      {
        do: "call",
        fn: (time) => {
          truck.machine.go_to("GONE", time);
          this.trucks = this.trucks.filter((candidate) => candidate !== truck);
        },
      },
    ]);
  }

  // ---------- Descarga y mesas ----------
  on_rail_end(dock, box, now) {
    if (dock.table.length >= TABLE_CAPACITY) return false;
    box.machine.go_to("AT_RECEIVING", now);
    box.table_ready_at = now + TABLE_HANDLING_SECONDS;
    const table = dock.layout.rail_end;
    const index = dock.table.length;
    dock.table.push(box);
    box.set_position(table.x + 1.1 + (index % 2) * 0.65 - 0.3, 1.25, table.z + (index >> 1) * 0.65 - 0.3, 0);
    return true;
  }

  // ---------- Reparto ----------
  sort_box(box, now) {
    const { sim } = this;
    if (box.route === undefined) box.route = sim.rng_split.chance(SPLIT_RESERVE) ? "reserve" : "active";
    // Si el activo de su SKU ya no tiene lugar, la caja se va a la reserva
    if (box.route === "active" && sim.storage.active_room(box.sku_id) <= 0) box.route = "reserve";
    return box.route === "reserve" ? this.add_to_pallet(box, now) : this.add_to_tote(box, now);
  }

  add_to_pallet(box, now) {
    const { sim } = this;
    let pallet = this.forming_pallets.find((candidate) => candidate.sku_id === box.sku_id && candidate.boxes.length < candidate.capacity);
    if (!pallet) {
      const spot = this.pallet_spots.findIndex((occupant) => occupant === null);
      // Sin lugar para formar otro pallet: la caja espera en la mesa hasta que un montacarga se lleve alguno que ya esté listo
      if (spot < 0) return false;
      pallet = new Pallet(sim.next_id("pallet"), box.sku_id, sim.config.get("pallet_size"), now);
      pallet.spot_index = spot;
      pallet.teleport(PALLET_SPOT_X, 0.07, PALLET_SPOT_ZS[spot], 0);
      this.pallet_spots[spot] = pallet;
      this.forming_pallets.push(pallet);
      sim.pallets.push(pallet);
    }
    box.machine.go_to("ON_PALLET", now);
    box.container = pallet;
    pallet.boxes.push(box);
    pallet.last_added_at = now;
    if (pallet.boxes.length >= pallet.capacity) this.close_pallet(pallet, now);
    return true;
  }

  close_pallet(pallet, now) {
    pallet.machine.go_to("READY", now);
    this.forming_pallets = this.forming_pallets.filter((candidate) => candidate !== pallet);
  }

  add_to_tote(box, now) {
    const { sim } = this;
    const floor = sku_floor(box.sku_id);
    let tote = this.filling_totes[floor];
    if (tote && tote.ready) return false;
    if (!tote) {
      tote = new Tote(sim.next_id("tote"), "in", now);
      tote.floor = floor;
      tote.ready = false;
      tote.teleport(TOTE_STATION_X, 0.2, TOTE_STATION_ZS[floor], 0);
      this.filling_totes[floor] = tote;
      sim.totes.push(tote);
    }
    box.machine.go_to("IN_TOTE", now);
    box.container = tote;
    tote.boxes.push(box);
    tote.last_added_at = now;
    sim.storage.inbound[box.sku_id] += 1;
    if (tote.boxes.length >= TOTE_CAPACITY) tote.ready = true;
    return true;
  }

  // ---------- Un paso ----------
  step(now, dt) {
    const { sim } = this;
    const open_docks = sim.config.get("dock_count");
    this.docks.forEach((dock, index) => {
      dock.enabled = index < open_docks;
    });

    // Camiones que esperan: el primero de la cola toma el muelle que se libere
    if (this.queue.length > 0) {
      const dock = this.find_free_dock();
      const head = this.queue[0];
      if (dock && head.machine.state === "QUEUED") {
        this.queue.shift();
        this.send_to_dock(head, dock, now);
      }
    }

    this.backlog = 0;
    this.docks.forEach((dock) => {
      const truck = dock.truck;
      if (truck) {
        // La puerta trasera se abre y se cierra poco a poco
        const target = truck.door_target || 0;
        truck.door_open = Math.min(1, Math.max(0, truck.door_open + Math.sign(target - truck.door_open) * (dt / DOOR_SECONDS)));
        if (Math.abs(target - truck.door_open) < dt / DOOR_SECONDS) truck.door_open = target;
        if (truck.machine.state === "UNLOADING") this.unload(dock, truck, now);
      }
      this.backlog += dock.rail.count + dock.table.length;
    });

    // Mesas: lo que ya pasó su tiempo de manejo se reparte
    this.docks.forEach((dock) => {
      for (let index = 0; index < dock.table.length; ) {
        const box = dock.table[index];
        if (now >= box.table_ready_at && this.sort_box(box, now)) dock.table.splice(index, 1);
        else index += 1;
      }
      // Las cajas que quedan se corren para no dejar huecos
      dock.table.forEach((box, index) => {
        const table = dock.layout.rail_end;
        box.set_position(table.x + 1.1 + (index % 2) * 0.65 - 0.3, 1.25, table.z + (index >> 1) * 0.65 - 0.3, 0);
      });
    });

    // Lo incompleto que lleva mucho esperando sale igual
    this.forming_pallets
      .filter((pallet) => now - pallet.last_added_at >= PALLET_FLUSH_SECONDS && pallet.boxes.length > 0)
      .forEach((pallet) => this.close_pallet(pallet, now));
    this.filling_totes.forEach((tote, floor) => {
      if (tote && !tote.ready && now - tote.last_added_at >= TOTE_FLUSH_SECONDS) tote.ready = true;
      if (tote && tote.ready && sim.storage.try_start_tote(tote, now)) this.filling_totes[floor] = null;
    });
  }

  // El camión suelta cajas al riel mientras haya lugar y no se esté acumulando todo en recibo
  unload(dock, truck, now) {
    if (truck.door_open < 1) return;
    if (this.backlog < RECEIVING_BACKLOG_LIMIT && truck.cargo.length > 0 && dock.rail.has_space_at(0, 0.6)) {
      const box = truck.cargo.shift();
      box.machine.go_to("ON_RAIL", now);
      box.teleport(dock.layout.rail_start.x - 1, 1.5, dock.z, 0);
      dock.rail.try_insert(box, 0, now);
      this.sim.counters.boxes_received += 1;
      this.backlog += 1;
    }
    if (truck.cargo.length === 0) this.start_leaving(truck, now);
  }

  // Los pallets cerrados que todavía no tiene un montacarga (los más viejos primero)
  ready_pallets() {
    return this.pallet_spots.filter((pallet) => pallet && pallet.machine.state === "READY" && !pallet.claimed).sort((first, second) => first.id - second.id);
  }

  release_pallet_spot(pallet) {
    if (pallet.spot_index >= 0) this.pallet_spots[pallet.spot_index] = null;
    pallet.spot_index = -1;
  }
}
