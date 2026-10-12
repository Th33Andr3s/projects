// Recibo: los camiones programados salen a la carretera, esperan en la talanquera, entran, van a un muelle libre o se parquean
// en orden hasta que se desocupe uno, se acoplan de reversa, descargan las cajas por el riel hasta una mesa, y de ahí cada caja
// se reparte al azar (70 % / 30 %) a un pallet de su SKU, que va a la reserva, o a una cubeta de su piso, que sube al activo.
// Es el único lugar donde entran cajas nuevas a la bodega.
//
// Quién pasa primero a un muelle libre: los camiones de la categoría con mayor prioridad y, entre iguales, el que llegó antes.
// A un camión con restricción solo se le da el muelle que pidió y solo desde la franja que pidió; mientras tanto espera
// parqueado y no estorba a los demás.

import {
  PALLET_FLUSH_SECONDS,
  RAIL_SPEED,
  SPLIT_RESERVE,
  TOTE_CAPACITY,
  TOTE_FLUSH_SECONDS,
  sku_floor,
} from "./config.js";
import { CATEGORIES, SKUS } from "./catalog.js";
import { Belt } from "./belts.js";
import { Dock, Pallet, StockStack, Tote, Truck } from "./entities.js";
import { GATES, PALLET_SPOTS, PARKING, ROAD_SPAWN_X, TOTE_STATIONS, staging_slot } from "./layout.js";
import { heading_yaw } from "./path_tools.js";
import { TruckSchedule } from "./truck_schedule.js";

const DOOR_SECONDS = 1.5;
const TURN_SECONDS = 2.5;
const ROAD_SPEED = 9;
const GATE_CROSSING_SPEED = 3.5;
const YARD_SPEED = 5;
// Lo que se aleja un camión de la talanquera antes de soltarla, para que la barrera baje detrás de él
const GATE_CLEARANCE = 9;
// Distancia entre los centros de dos camiones que esperan en fila en la carretera: el largo de un camión más un hueco
const ROAD_QUEUE_SPACING = 13;
const ROAD_RETRY_SECONDS = 3;
// El reparto acumula como mucho este crédito (cajas) y revisa hasta tantas cajas por paso
const MAX_RELEASE_CREDIT = 3;
const RELEASE_SCAN_LIMIT = 80;
// El pallet de descarga de un muelle: cajas que lleva y segundos sin recibir cajas antes de salir incompleto
const DOCK_PALLET_SIZE = 24;
const DOCK_PALLET_FLUSH_SECONDS = 40;
// Las coordenadas de los carriles de dentro del predio, ver PARKING en layout.js
const INNER_IN_LANE_Z = GATES.west.in_lane_z;
const INNER_OUT_LANE_Z = GATES.west.out_lane_z;

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
    this.bays = layout.parking_bays.map((bay) => ({ ...bay, truck: null, kind: "parking_bay" }));
    this.trucks = [];
    // Camiones que ya entraron al predio y todavía no tienen muelle: parqueados o yendo a su plaza
    this.waiting = [];
    this.forming_pallets = [];
    this.pallet_spots = PALLET_SPOTS.map(() => null);
    this.filling_totes = TOTE_STATIONS.map(() => null);
    this.schedule = new TruckSchedule(sim);
    // La bodega de recibo: todo lo que baja de los camiones entra aquí (en orden de llegada) y de aquí se reparte a pallets y
    // cubetas. Así la descarga no espera a que haya pallet o cubeta libre.
    this.staging = [];
    this.stacks = SKUS.map((sku) => new StockStack(sku.id, staging_slot(sku.id)));
    // Cuánto reparto "acumulado" hay: se gasta de a una caja
    this.release_credit = 0;
    // Cajas que ya bajaron del camión y todavía no llegan a la bodega: en los rieles, en pallets de descarga o en camino
    this.inbound_boxes = 0;
  }

  get staged_by_sku() {
    return this.stacks.map((stack) => stack.boxes);
  }

  staged_boxes_of(sku_id) {
    return this.stacks[sku_id].boxes;
  }

  // ---------- Del borde de la pantalla a la talanquera ----------
  on_truck_spawn(entry, now) {
    const { sim } = this;
    // Si la fila de la carretera ya llega hasta el borde de la pantalla, el camión espera unos segundos afuera para no aparecer
    // encima del último
    if (this.trucks.some((truck) => truck.on_road && truck.x < -ROAD_SPAWN_X + ROAD_QUEUE_SPACING + 2)) {
      entry.spawn_event_id = sim.events.schedule(now + ROAD_RETRY_SECONDS, "truck_spawn", { entry });
      return;
    }
    entry.spawned = true;
    sim.disruptions.on_truck_spawned(entry);
    const truck = new Truck(entry.id, "receiving", now);
    truck.entry = entry;
    entry.truck = truck;
    truck.route = entry.route;
    truck.on_road = true;
    truck.category = CATEGORIES[entry.category_index];
    truck.box_count = entry.box_count;
    truck.units = entry.units;
    truck.cargo = entry.sku_ids.map((sku_id) => {
      const box = sim.new_box(sku_id, now);
      box.truck = truck;
      return box;
    });
    truck.restriction_text = this.schedule.restriction_text(entry);
    const lane = sim.gates.west_in;
    truck.teleport(-ROAD_SPAWN_X, 0, lane.z, 0);
    this.trucks.push(truck);
    sim.emit({ type: "truck_arrived", truck });
    truck.start_script([
      { do: "drive", points: [{ x: lane.stop_x, z: lane.z }], speed: ROAD_SPEED },
      // Antes de pedir la talanquera hay que saber que adentro hay a dónde ir: un muelle libre o una plaza del parqueadero
      {
        do: "until",
        test: () => {
          if (!this.has_room_for(truck) || !lane.try_claim(truck)) return false;
          truck.on_road = false;
          truck.s_limit = null;
          return true;
        },
      },
      { do: "until", test: () => lane.is_open_for(truck) },
      { do: "drive", points: [{ x: GATES.west.x + GATE_CLEARANCE, z: lane.z }], speed: GATE_CROSSING_SPEED },
      {
        do: "call",
        fn: (time) => {
          lane.release(truck);
          this.on_entered(truck, time);
        },
      },
    ]);
  }

  has_room_for(truck) {
    return this.find_dock_for(truck, this.sim.now) !== null || this.free_bay() !== null;
  }

  on_entered(truck, now) {
    const { sim } = this;
    truck.arrived_text = sim.format_time(now);
    truck.entry.entered_at = now;
    sim.counters.trucks_received += 1;
    this.waiting.push(truck);
    truck.needs_route = true;
  }

  // ---------- Muelles y parqueadero ----------
  free_bay() {
    return this.bays.find((bay) => bay.truck === null) || null;
  }

  // El primer muelle (por número) que este camión puede usar ahora: habilitado, libre y dentro de su restricción
  find_dock_for(truck, now) {
    return this.docks.find((dock) => dock.enabled && !dock.truck && this.schedule.can_use_dock(truck.entry, dock.index, now)) || null;
  }

  // Mayor prioridad de su categoría primero; entre iguales, el que llegó antes
  rank(first, second) {
    const { yard } = this.sim;
    return yard.get_priority(second.entry.category_index) - yard.get_priority(first.entry.category_index) || first.entry.arrival_time - second.entry.arrival_time || first.id - second.id;
  }

  // Los camiones que vienen por la carretera hacia la talanquera hacen fila: cada uno se queda detrás del que va delante
  queue_road_trucks() {
    const road = this.trucks.filter((truck) => truck.on_road).sort((first, second) => second.x - first.x);
    road.forEach((truck, index) => {
      // El camino arranca en el borde de la pantalla y es recto, así que la distancia recorrida es x + ROAD_SPAWN_X
      truck.s_limit = index === 0 ? null : road[index - 1].x - ROAD_QUEUE_SPACING + ROAD_SPAWN_X;
    });
  }

  // A la talanquera de salida llega un camión a la vez; los demás esperan en su muelle con la puerta abierta
  exit_is_free() {
    return !this.trucks.some((truck) => truck.machine.state === "LEAVING_EMPTY" && !truck.exit_claimed);
  }

  // Cada paso: a los camiones que esperan se les da el muelle que les toque y a los que no, una plaza
  route_waiting_trucks(now) {
    const candidates = this.waiting.filter((truck) => truck.needs_route || truck.machine.state === "QUEUED").sort((first, second) => this.rank(first, second));
    for (const truck of candidates) {
      const dock = this.find_dock_for(truck, now);
      if (dock) {
        this.waiting = this.waiting.filter((candidate) => candidate !== truck);
        this.send_to_dock(truck, dock, now);
      } else if (truck.needs_route) {
        const bay = this.free_bay();
        if (bay) this.send_to_bay(truck, bay, now);
      }
    }
  }

  send_to_bay(truck, bay, now) {
    truck.needs_route = false;
    bay.truck = truck;
    truck.bay = bay;
    truck.start_script([
      { do: "drive", points: [{ x: PARKING.aisle_x, z: INNER_IN_LANE_Z }, { x: PARKING.aisle_x, z: bay.z }, { x: bay.x, z: bay.z }], speed: YARD_SPEED },
      { do: "turn", yaw: bay.yaw, seconds: 0.5 },
      { do: "call", fn: (time) => truck.machine.go_to("QUEUED", time) },
    ]);
  }

  send_to_dock(truck, dock, now) {
    truck.needs_route = false;
    dock.truck = truck;
    truck.dock = dock;
    dock.machine.go_to("OCCUPIED", now);
    truck.machine.go_to("DOCKING", now);
    const steps = [];
    const bay = truck.bay;
    let to_lane;
    if (bay) {
      // Sale de su plaza en reversa hasta el pasillo y ahí gira hacia donde va
      const next_z = INNER_IN_LANE_Z;
      steps.push(
        { do: "drive", points: [{ x: PARKING.aisle_x, z: bay.z }], reverse: true, speed: 2.5 },
        {
          do: "call",
          fn: () => {
            bay.truck = null;
            truck.bay = null;
          },
        },
        { do: "turn", yaw: heading_yaw(0, next_z - bay.z), seconds: 1.5 },
      );
      to_lane = [{ x: PARKING.aisle_x, z: INNER_IN_LANE_Z }];
    } else {
      to_lane = [];
    }
    steps.push(
      { do: "drive", points: [...to_lane, { x: PARKING.yard_lane_x, z: INNER_IN_LANE_Z }, { x: PARKING.yard_lane_x, z: dock.z }, { x: dock.layout.approach_x, z: dock.z }], speed: YARD_SPEED },
      { do: "turn", yaw: Math.PI, seconds: TURN_SECONDS },
      { do: "drive", points: [{ x: dock.layout.truck_x, z: dock.z }], reverse: true, speed: 2.5 },
      {
        do: "call",
        fn: (time) => {
          truck.machine.go_to("UNLOADING", time);
          truck.door_target = 1;
        },
      },
    );
    truck.start_script(steps);
  }

  // Un camión vacío se va: cierra la puerta, sale por el carril de salida, pasa la talanquera y se pierde por la carretera
  start_leaving(truck, now) {
    const { sim } = this;
    const dock = truck.dock;
    const lane = sim.gates.west_out;
    truck.door_target = 0;
    truck.machine.go_to("LEAVING_EMPTY", now);
    sim.emit({ type: "truck_leaving", truck });
    truck.start_script([
      { do: "until", test: () => truck.door_open <= 0 },
      { do: "drive", points: [{ x: dock.layout.approach_x, z: dock.z }], speed: YARD_SPEED },
      {
        do: "call",
        fn: (time) => {
          dock.truck = null;
          dock.machine.go_to("EMPTY", time);
          truck.dock = null;
        },
      },
      { do: "drive", points: [{ x: PARKING.yard_lane_x, z: dock.z }, { x: PARKING.yard_lane_x, z: INNER_OUT_LANE_Z }, { x: lane.stop_x, z: lane.z }], speed: YARD_SPEED },
      {
        do: "until",
        test: () => {
          if (!lane.try_claim(truck)) return false;
          truck.exit_claimed = true;
          return true;
        },
      },
      { do: "until", test: () => lane.is_open_for(truck) },
      { do: "drive", points: [{ x: GATES.west.x - GATE_CLEARANCE, z: lane.z }], speed: GATE_CROSSING_SPEED },
      { do: "call", fn: () => lane.release(truck) },
      { do: "drive", points: [{ x: -ROAD_SPAWN_X - 10, z: lane.z }], speed: ROAD_SPEED },
      {
        do: "call",
        fn: (time) => {
          truck.machine.go_to("GONE", time);
          truck.entry.finished = true;
          this.trucks = this.trucks.filter((candidate) => candidate !== truck);
        },
      },
    ]);
  }

  // ---------- Descarga y bodega de recibo ----------
  staging_capacity() {
    return this.sim.config.get("staging_capacity");
  }

  // Una caja llega al final del riel y se acomoda en el pallet de descarga de su muelle que se esté llenando. Si ese ya está lleno y
  // todavía no se lo lleva una montacarga, empieza el segundo; si los dos esperan, la caja espera en el riel.
  on_rail_end(dock, box, now) {
    const { sim } = this;
    let pallet = dock.pallets.find((candidate) => candidate.machine.state === "FORMING" && candidate.boxes.length < candidate.capacity);
    if (!pallet) {
      const slot = dock.layout.pallet_spots.findIndex((spot, index) => !dock.pallets.some((candidate) => candidate.spot_slot === index));
      if (slot < 0) return false;
      const spot = dock.layout.pallet_spots[slot];
      pallet = new Pallet(sim.next_id("pallet"), box.sku_id, DOCK_PALLET_SIZE, now);
      pallet.mixed = true;
      pallet.dock_index = dock.index;
      pallet.spot_slot = slot;
      pallet.teleport(spot.x, 0.07, spot.z, 0);
      dock.pallets.push(pallet);
      sim.pallets.push(pallet);
    }
    box.machine.go_to("ON_DOCK_PALLET", now);
    box.container = pallet;
    pallet.boxes.push(box);
    pallet.last_added_at = now;
    box.teleport(pallet.x, pallet.y, pallet.z, 0);
    if (pallet.boxes.length >= pallet.capacity) pallet.machine.go_to("READY", now);
    return true;
  }

  // Los pallets de descarga listos que todavía no tiene una montacarga (los más viejos primero)
  ready_dock_pallets() {
    return this.docks
      .flatMap((dock) => dock.pallets)
      .filter((pallet) => pallet.machine.state === "READY" && !pallet.claimed)
      .sort((first, second) => first.id - second.id);
  }

  // Una montacarga levantó el pallet de descarga: su puesto en el muelle queda libre para el siguiente
  release_dock_pallet(pallet) {
    const dock = this.docks[pallet.dock_index];
    if (dock) dock.pallets = dock.pallets.filter((candidate) => candidate !== pallet);
  }

  // La montacarga llegó al andén de la bodega: las cajas del pallet pasan a su pila
  deliver_dock_pallet(pallet, now) {
    const { sim } = this;
    pallet.boxes.forEach((box) => {
      box.machine.go_to("IN_STAGING", now);
      box.container = null;
      const stack = this.stacks[box.sku_id];
      stack.boxes += 1;
      stack.units += box.units;
      box.teleport(stack.x, 0, stack.z, 0);
      this.staging.push(box);
    });
    this.inbound_boxes -= pallet.boxes.length;
    pallet.boxes = [];
    pallet.machine.go_to("DELIVERED", now);
    sim.pallets = sim.pallets.filter((candidate) => candidate !== pallet);
  }

  // Los pallets de descarga que llevan un rato sin recibir cajas salen aunque no estén llenos
  flush_dock_pallets(now) {
    this.docks.forEach((dock) => {
      dock.pallets.forEach((pallet) => {
        if (pallet.machine.state === "FORMING" && pallet.boxes.length > 0 && now - pallet.last_added_at >= DOCK_PALLET_FLUSH_SECONDS) pallet.machine.go_to("READY", now);
      });
    });
  }

  // Reparto: de la bodega de recibo salen cajas hacia pallets (reserva) y cubetas (activo) al ritmo configurado. Si a una caja no
  // le toca todavía lugar (sin puesto de pallet o con la cubeta de su piso llena), se pasa a la siguiente.
  release_staging(now, dt) {
    const rate = this.sim.config.get("staging_release_per_minute") / 60;
    this.release_credit = Math.min(this.release_credit + rate * dt, MAX_RELEASE_CREDIT);
    let scanned = 0;
    for (let index = 0; index < this.staging.length && this.release_credit >= 1 && scanned < RELEASE_SCAN_LIMIT; scanned += 1) {
      const box = this.staging[index];
      if (this.sort_box(box, now)) {
        this.staging.splice(index, 1);
        const stack = this.stacks[box.sku_id];
        stack.boxes -= 1;
        stack.units -= box.units;
        this.release_credit -= 1;
      } else {
        index += 1;
      }
    }
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
      pallet.teleport(PALLET_SPOTS[spot].x, 0.07, PALLET_SPOTS[spot].z, 0);
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
      tote.teleport(TOTE_STATIONS[floor].x, 0.2, TOTE_STATIONS[floor].z, 0);
      this.filling_totes[floor] = tote;
      sim.totes.push(tote);
    }
    box.machine.go_to("IN_TOTE", now);
    box.container = tote;
    tote.boxes.push(box);
    tote.last_added_at = now;
    sim.storage.inbound[box.sku_id] += 1;
    if (tote.boxes.length >= TOTE_CAPACITY) this.mark_tote_ready(tote, now);
    return true;
  }

  mark_tote_ready(tote, now) {
    tote.ready = true;
    tote.machine.go_to("READY", now);
  }

  // Las cubetas llenas que todavía no tiene una montacarga (las más viejas primero)
  ready_totes() {
    return this.filling_totes.filter((tote) => tote && tote.ready && !tote.claimed).sort((first, second) => first.id - second.id);
  }

  // Una montacarga levantó la cubeta: el puesto de su piso queda libre
  release_tote_station(tote) {
    if (this.filling_totes[tote.floor] === tote) this.filling_totes[tote.floor] = null;
  }

  // ---------- Un paso ----------
  step(now, dt) {
    const { sim } = this;
    this.schedule.update(now);
    this.docks.forEach((dock, index) => {
      dock.enabled = !sim.yard.is_dock_blocked(index);
    });
    this.trucks.forEach((truck) => {
      truck.restriction_text = this.schedule.restriction_text(truck.entry);
    });
    this.route_waiting_trucks(now);
    this.queue_road_trucks();

    this.docks.forEach((dock) => {
      const truck = dock.truck;
      if (truck) {
        // La puerta trasera se abre y se cierra poco a poco
        const target = truck.door_target || 0;
        truck.door_open = Math.min(1, Math.max(0, truck.door_open + Math.sign(target - truck.door_open) * (dt / DOOR_SECONDS)));
        if (Math.abs(target - truck.door_open) < dt / DOOR_SECONDS) truck.door_open = target;
        if (truck.machine.state === "UNLOADING") this.unload(dock, truck, now);
      }
    });

    this.release_staging(now, dt);

    // Lo incompleto que lleva mucho esperando sale igual
    this.forming_pallets
      .filter((pallet) => now - pallet.last_added_at >= PALLET_FLUSH_SECONDS && pallet.boxes.length > 0)
      .forEach((pallet) => this.close_pallet(pallet, now));
    this.filling_totes.forEach((tote) => {
      if (tote && !tote.ready && now - tote.last_added_at >= TOTE_FLUSH_SECONDS) this.mark_tote_ready(tote, now);
    });
    this.flush_dock_pallets(now);
  }

  // El camión suelta cajas al riel mientras haya lugar en el riel y en la bodega de recibo (contando lo que ya bajó y va en camino a ella)
  unload(dock, truck, now) {
    if (truck.door_open < 1) return;
    // Las cajas miden distinto: el espacio que se pide es el de la caja que sigue, no uno fijo, o el riel podría rechazarla
    // después de haberla anotado como recibida
    const next_box = truck.cargo[0];
    if (this.staging.length + this.inbound_boxes < this.staging_capacity() && next_box && dock.rail.has_space_at(0, next_box.belt_length)) {
      const box = truck.cargo.shift();
      box.machine.go_to("ON_RAIL", now);
      box.teleport(dock.layout.rail_start.x - 1, 1.5, dock.z, 0);
      dock.rail.try_insert(box, 0, now);
      this.sim.counters.boxes_received += 1;
      this.sim.inventory.receive(box);
      this.inbound_boxes += 1;
    }
    if (truck.cargo.length === 0 && this.exit_is_free()) this.start_leaving(truck, now);
  }

  // Los pallets cerrados que todavía no tiene un montacarga (los más viejos primero)
  ready_pallets() {
    return this.pallet_spots.filter((pallet) => pallet && pallet.machine.state === "READY" && !pallet.claimed).sort((first, second) => first.id - second.id);
  }

  release_pallet_spot(pallet) {
    if (pallet.spot_index >= 0) this.pallet_spots[pallet.spot_index] = null;
    pallet.spot_index = -1;
  }

  get parked_count() {
    return this.bays.filter((bay) => bay.truck !== null).length;
  }
}
