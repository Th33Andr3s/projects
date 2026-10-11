// Salida: cuando un pedido completa su casilla, un operario del muro la vacía en una cubeta que va por banda a empaque; una
// estación la convierte en un paquete sellado que sigue a despacho; en la puerta se carga al camión, y los camiones salen por
// horario (cada cierto tiempo simulado, con lo que lleven, aunque sea nada).

import { Belt } from "./belts.js";
import { DispatchDoor, PackStation, Parcel, Tote, Truck, Worker } from "./entities.js";
import { project_on_path } from "./path_tools.js";

const EMPTY_SLOT_SECONDS = 4;
const TOTE_OUT_HEIGHT = 0.3;
// El nuevo camión de una puerta entra poco después de que el anterior arranca
const REPLACEMENT_DELAY_SECONDS = 8;
const ENTRY_LANE_Z = 3.5;
const EXIT_LANE_Z = -3.5;
const CAB_COLORS = ["#ef4444", "#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899"];
const TURN_SECONDS = 2.5;

export class OutboundSystem {
  constructor(sim) {
    this.sim = sim;
    const { layout, paths, config } = sim;

    this.feed = new Belt("pack_feed", "pack", paths.wall_chain, () => sim.belt_speed());
    this.east = new Belt("wall_out_east", "tote_out", paths.wall_east, () => sim.belt_speed());
    this.out = new Belt("dispatch_belt", "dispatch", paths.dispatch_chain, () => sim.belt_speed());
    sim.belts.push(this.feed, this.east, this.out);

    // La banda del lado este se junta con la principal de alimentación
    const merge_s = project_on_path(paths.wall_chain, 34.6, 28.5);
    this.east.on_end = (tote, belt, now) => {
      if (!this.feed.has_space_at(merge_s, tote.belt_length)) return false;
      this.feed.try_insert(tote, merge_s, now);
      return true;
    };

    this.stations = layout.pack_stations.map((layout_station, index) => {
      const station = new PackStation(index, layout_station, 0);
      station.pickup_s = project_on_path(paths.wall_chain, 42, layout_station.z);
      station.drop_s = project_on_path(paths.dispatch_chain, 50, layout_station.z);
      this.feed.add_gate({ s: station.pickup_s, name: `station_${index + 1}`, handle: (tote, belt, now) => this.station_gate(station, tote, now) });
      return station;
    });
    this.packers = [];

    this.doors = layout.doors.map((layout_door, index) => {
      const door = new DispatchDoor(index, layout_door, 0);
      door.lane = new Belt(`door_lane_${index + 1}`, "door", paths.door_lanes[index], () => sim.belt_speed());
      door.lane.on_end = (parcel, belt, now) => this.load_parcel(door, parcel, now);
      door.gate_s = project_on_path(paths.dispatch_chain, 58, layout_door.z);
      this.out.add_gate({ s: door.gate_s, name: `door_${index + 1}`, handle: (parcel, belt, now) => this.door_gate(door, parcel, now) });
      sim.belts.push(door.lane);
      return door;
    });
    this.trucks = [];
    this.operators = [];

    // Los camiones de despacho que ya esperan en cada puerta al empezar, y su horario de salida
    const first = config.get("door_count");
    const interval = config.get("truck_departure_minutes") * 60;
    this.doors.forEach((door, index) => {
      door.enabled = index < first;
      door.next_departure_at = null;
      if (index >= first) return;
      this.spawn_initial_truck(door);
      this.schedule_departure(door, interval * (1 - index / first));
    });
  }

  // ---------- Camiones de despacho ----------
  new_dispatch_truck(door, now) {
    const truck = new Truck(this.sim.next_id("truck_dispatch"), "dispatch", now);
    truck.door = door;
    truck.cab_color = CAB_COLORS[truck.id % CAB_COLORS.length];
    truck.docked = false;
    door.truck = truck;
    door.machine.go_to("OCCUPIED", now);
    this.trucks.push(truck);
    return truck;
  }

  spawn_initial_truck(door) {
    const truck = this.new_dispatch_truck(door, 0);
    truck.teleport(door.layout.truck_x, 0, door.z, 0);
    truck.door_open = 1;
    truck.docked = true;
  }

  spawn_entering_truck(door, now) {
    const truck = this.new_dispatch_truck(door, now);
    truck.teleport(105, 0, ENTRY_LANE_Z, Math.PI);
    truck.start_script([
      { do: "drive", points: [{ x: 99, z: ENTRY_LANE_Z }, { x: door.layout.approach_x, z: door.z }] },
      { do: "turn", yaw: 0, seconds: TURN_SECONDS },
      { do: "drive", points: [{ x: door.layout.truck_x, z: door.z }], reverse: true, speed: 2.5 },
      {
        do: "call",
        fn: () => {
          truck.docked = true;
          truck.door_open = 1;
        },
      },
    ]);
  }

  schedule_departure(door, time) {
    door.next_departure_at = time;
    this.sim.events.schedule(time, "dispatch_departure", { door_index: door.index });
  }

  on_departure_event(door_index, now) {
    const { sim } = this;
    const door = this.doors[door_index];
    const interval = sim.config.get("truck_departure_minutes") * 60;
    // Una puerta cerrada ya no programa más salidas
    if (door.enabled) this.schedule_departure(door, now + interval);
    else door.next_departure_at = null;
    const truck = door.truck;
    if (!truck || !truck.docked) return;
    this.depart(door, truck, now);
  }

  depart(door, truck, now) {
    const { sim } = this;
    if (truck.loaded_count > 0) {
      truck.cargo.forEach((parcel) => this.ship_parcel(parcel, now));
      sim.counters.trucks_dispatched += 1;
    } else {
      sim.counters.empty_departures += 1;
    }
    truck.machine.go_to("DEPARTING", now);
    truck.docked = false;
    sim.emit({ type: "truck_departing", truck, empty: truck.loaded_count === 0 });
    door.truck = null;
    door.machine.go_to("EMPTY", now);
    truck.start_script([
      { do: "drive", points: [{ x: door.layout.approach_x, z: door.z }, { x: 99, z: EXIT_LANE_Z }, { x: 106, z: EXIT_LANE_Z }] },
      {
        do: "call",
        fn: (time) => {
          truck.machine.go_to("GONE", time);
          this.trucks = this.trucks.filter((candidate) => candidate !== truck);
        },
      },
    ]);
    truck.door_open = 0;
    if (door.enabled) sim.events.schedule(now + REPLACEMENT_DELAY_SECONDS, "dispatch_truck", { door_index: door.index });
  }

  on_replacement_event(door_index, now) {
    const door = this.doors[door_index];
    if (door.enabled && !door.truck) this.spawn_entering_truck(door, now);
  }

  // Lo que va en el camión que sale queda despachado
  ship_parcel(parcel, now) {
    const { sim } = this;
    const order = parcel.order;
    parcel.boxes.forEach((box) => {
      box.machine.go_to("SHIPPED", now);
      sim.retire_box(box);
    });
    order.machine.go_to("DISPATCHED", now);
    order.dispatched_at = now;
    sim.counters.orders_dispatched += 1;
    sim.counters.cycle_time_total += now - order.created_at;
    sim.counters.cycle_count += 1;
    sim.orders.orders = sim.orders.orders.filter((candidate) => candidate !== order);
    sim.finished_orders.push(order);
    sim.parcels = sim.parcels.filter((candidate) => candidate !== parcel);
  }

  // Puertas que se abren con el slider: reciben camión y salidas por horario
  sync_doors(now) {
    const { sim } = this;
    const wanted = sim.config.get("door_count");
    const interval = sim.config.get("truck_departure_minutes") * 60;
    this.doors.forEach((door, index) => {
      const enabled = index < wanted;
      if (enabled && !door.enabled) {
        // Recién abierta: llega un camión y empieza su horario
        door.enabled = true;
        if (!door.truck) this.spawn_entering_truck(door, now);
        if (door.next_departure_at === null) this.schedule_departure(door, now + interval);
      } else if (!enabled && door.enabled) {
        door.enabled = false;
      }
    });
  }

  // ---------- Paquetes hacia la puerta ----------
  choose_door() {
    let best = null;
    this.doors.forEach((door) => {
      if (door.enabled && (!best || door.assigned < best.assigned)) best = door;
    });
    return best;
  }

  door_gate(door, parcel, now) {
    if (parcel.door !== door) return "pass";
    // Una puerta que se cerró después de asignar el paquete: se reasigna a otra
    if (!door.enabled) {
      const other = this.choose_door();
      if (other) {
        door.assigned -= 1;
        other.assigned += 1;
        parcel.door = other;
      }
      return "pass";
    }
    if (!door.lane.has_space_at(0, parcel.belt_length)) return "hold";
    door.lane.try_insert(parcel, 0, now);
    return "take";
  }

  load_parcel(door, parcel, now) {
    const truck = door.truck;
    if (!truck || !truck.docked || !["WAITING_AT_DOOR", "LOADING"].includes(truck.machine.state)) return false;
    if (truck.machine.state === "WAITING_AT_DOOR") truck.machine.go_to("LOADING", now);
    parcel.boxes.forEach((box) => box.machine.go_to("LOADED", now));
    truck.cargo.push(parcel);
    truck.loaded_count += 1;
    door.assigned -= 1;
    parcel.door = null;
    this.sim.emit({ type: "parcel_loaded", door });
    return true;
  }

  // ---------- Muros: vaciar una casilla completa ----------
  step_operators(now) {
    const { sim } = this;
    this.sim.orders.walls.forEach((wall) => {
      let operator = this.operators.find((candidate) => candidate.wall === wall);
      const needs_operator = wall.enabled || wall.slots.some((slot) => slot.machine.state !== "FREE");
      if (needs_operator && !operator) {
        operator = new Worker(sim.next_id("worker"), "wall", now);
        operator.wall = wall;
        const side = wall.layout.side === "west" ? 1 : -1;
        operator.home = { x: wall.layout.out_x + side * 0.65, y: 0, z: wall.layout.center_z };
        operator.teleport(operator.home.x, 0, operator.home.z, wall.layout.side === "west" ? 0 : Math.PI);
        this.operators.push(operator);
        wall.operator = operator;
      }
      if (!operator || operator.is_busy) return;
      const slot = wall.slots.filter((candidate) => candidate.machine.state === "COMPLETE").sort((first, second) => first.order.id - second.order.id)[0];
      if (slot) this.start_emptying(operator, wall, slot, now);
    });
  }

  start_emptying(operator, wall, slot, now) {
    const belt = wall.layout.side === "west" ? this.feed : this.east;
    const path = belt.path;
    const drop_s = project_on_path(path, wall.layout.out_x, slot.position.z);
    const order = slot.order;
    slot.machine.go_to("EMPTYING", now);
    operator.machine.go_to("EMPTYING_SLOT", now);
    operator.order = order;
    const side = wall.layout.side === "west" ? 1 : -1;
    let tote = null;
    operator.start_script([
      { do: "drive", points: [{ x: wall.layout.out_x + side * 0.65, z: slot.position.z }] },
      { do: "wait", seconds: EMPTY_SLOT_SECONDS },
      {
        do: "call",
        fn: (time) => {
          tote = new Tote(this.sim.next_id("tote"), "out", time);
          tote.order = order;
          tote.boxes = [...slot.boxes];
          tote.boxes.forEach((box) => {
            box.machine.go_to("IN_ORDER_TOTE", time);
            box.container = tote;
          });
          tote.teleport(wall.layout.out_x, TOTE_OUT_HEIGHT, slot.position.z, 0);
          this.sim.totes.push(tote);
          // La casilla queda libre desde que se vacía
          slot.boxes = [];
          slot.order = null;
          order.slot = null;
          slot.machine.go_to("FREE", time);
        },
      },
      { do: "until", test: () => belt.has_space_at(drop_s, 1.1) },
      {
        do: "call",
        fn: (time) => {
          tote.machine.go_to("ON_OUT_BELT", time);
          belt.try_insert(tote, drop_s, time);
          operator.order = null;
          operator.machine.go_to("IDLE", time);
        },
      },
      { do: "drive", points: [{ x: operator.home.x, z: operator.home.z }] },
    ]);
  }

  // ---------- Empaque ----------
  // Una cubeta toma la primera estación libre que encuentre en su camino; si no hay ninguna libre, espera en la primera
  // compuerta. Al pasar una estación ocupada, la cubeta ya lleva apartada otra libre de más adelante (`reserved_for`), así
  // dos cubetas nunca van por la misma y ninguna se queda esperando delante de una estación mientras otras están libres.
  station_gate(station, tote, now) {
    if (!station.enabled) {
      if (tote.target_station === station) tote.target_station = null;
      return "pass";
    }
    if (tote.target_station === station) {
      this.take_tote(station, tote, now);
      return "take";
    }
    if (tote.target_station) return "pass";
    if (this.is_station_free(station)) {
      this.take_tote(station, tote, now);
      return "take";
    }
    // "Más adelante" es más lejos a lo largo de la banda, que no es el orden de los números de las estaciones
    const next = this.stations
      .filter((other) => other.enabled && other.pickup_s > station.pickup_s && this.is_station_free(other))
      .sort((first, second) => first.pickup_s - second.pickup_s)[0];
    if (!next) return "hold";
    next.reserved_for = tote;
    tote.target_station = next;
    return "pass";
  }

  is_station_free(station) {
    return station.machine.state === "FREE" && !station.tote && !station.reserved_for;
  }

  take_tote(station, tote, now) {
    station.reserved_for = null;
    tote.target_station = null;
    station.tote = tote;
    station.machine.go_to("BUSY", now);
    const variation = 0.85 + this.sim.rng_pack.next() * 0.3;
    station.timer = this.sim.config.get("pack_seconds") * variation;
    tote.machine.go_to("AT_PACK", now);
    tote.set_position(station.x - 0.7, 1.15, station.z, 0);
    tote.boxes.forEach((box) => box.machine.go_to("PACKING", now));
  }

  sync_stations() {
    const wanted = this.sim.config.get("pack_station_count");
    this.stations.forEach((station, index) => {
      station.enabled = index < wanted;
    });
  }

  // Un empacador de pie junto a cada estación abierta; trabaja mientras la estación esté ocupada
  sync_packers(now) {
    this.stations.forEach((station) => {
      let packer = station.worker;
      if (station.enabled && !packer) {
        packer = new Worker(this.sim.next_id("worker"), "packer", now);
        packer.teleport(station.x, 0, station.z + 1.5, Math.PI / 2);
        station.worker = packer;
        this.packers.push(packer);
      } else if (!station.enabled && packer && station.machine.state === "FREE") {
        this.packers = this.packers.filter((candidate) => candidate !== packer);
        station.worker = null;
        return;
      }
      if (!packer) return;
      if (station.machine.state === "BUSY" && packer.machine.state === "IDLE") packer.machine.go_to("PACKING", now);
      else if (station.machine.state !== "BUSY" && packer.machine.state === "PACKING") packer.machine.go_to("IDLE", now);
    });
  }

  step_stations(now, dt) {
    const { sim } = this;
    this.stations.forEach((station) => {
      if (station.machine.state !== "BUSY" || !station.tote) return;
      station.busy_seconds += dt;
      if (!station.parcel) {
        station.timer -= dt;
        if (station.timer > 0) return;
        const tote = station.tote;
        const order = tote.order;
        const parcel = new Parcel(sim.next_id("parcel"), order, tote.boxes);
        parcel.boxes.forEach((box) => box.machine.go_to("PACKED", now));
        tote.machine.go_to("CONSUMED", now);
        sim.totes = sim.totes.filter((candidate) => candidate !== tote);
        order.machine.go_to("PACKED", now);
        order.packed_at = now;
        sim.counters.orders_packed += 1;
        station.parcel = parcel;
        sim.parcels.push(parcel);
        parcel.teleport(station.x + 1.0, 1.1, station.z, 0);
        sim.emit({ type: "parcel_packed", station });
      }
      // Se pone en la banda de salida cuando hay hueco; mientras tanto la estación sigue ocupada
      const parcel = station.parcel;
      if (!this.out.has_space_at(station.drop_s, parcel.belt_length)) return;
      const door = this.choose_door();
      parcel.door = door;
      door.assigned += 1;
      parcel.boxes.forEach((box) => box.machine.go_to("ON_DISPATCH_BELT", now));
      this.out.try_insert(parcel, station.drop_s, now);
      station.parcel = null;
      station.tote = null;
      station.machine.go_to("FREE", now);
    });
  }

  // ---------- Un paso ----------
  step(now, dt) {
    this.sync_stations();
    this.sync_packers(now);
    this.sync_doors(now);
    this.step_operators(now);
    this.step_stations(now, dt);
    this.operators.forEach((operator) => operator.update(dt, now));
    this.trucks.forEach((truck) => truck.update(dt, now));
  }

  update_belts(dt, now) {
    this.east.update(dt, now);
    this.feed.update(dt, now);
    this.out.update(dt, now);
    this.doors.forEach((door) => door.lane.update(dt, now));
  }
}
