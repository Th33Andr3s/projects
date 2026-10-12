// Salida: cuando un pedido completa su casilla, un operario del muro la vacía en una cubeta que va por banda a empaque; una
// estación la convierte en un paquete sellado que sigue por la banda de despacho hasta la pila de su destino. A cada hora de corte
// salen camiones, uno por ciudad, con los paquetes de los pedidos a los que les tocaba ese corte; los que no estaban listos son
// envíos tardíos y salen en el siguiente. Cada salida queda en el informe. El registro de Entrega a Tiempo (OTD) mide solo entregas:
// un pedido cuenta (a tiempo o tarde) cuando su camión llega al cliente, no cuando sale.
// La persona puede cerrar la entrada de camiones de despacho.

import { Belt } from "./belts.js";
import { DESTINATIONS, make_route } from "./catalog.js";
import { day_index, day_start_time, next_cutoff_after } from "./cutoffs.js";
import { DispatchBin, DispatchDoor, PackStation, Parcel, Tote, Truck, Worker } from "./entities.js";
import { GATES, ROAD_SPAWN_X, dispatch_bin_slot } from "./layout.js";
import { project_on_path } from "./path_tools.js";

const EMPTY_SLOT_SECONDS = 4;
const TOTE_OUT_HEIGHT = 0.3;
// Cuántos camiones recuerda el informe como máximo
// Cuántos camiones que salieron recuerda la simulación (informe y viajes del mapa) y cuántas entregas por pedido (para el detalle del
// OTD). El OTD por día no depende de estos topes: se va sumando aparte.
const DISPATCH_LOG_LIMIT = 20000;
const TRIPS_LIMIT = 20000;
const DELIVERIES_LIMIT = 60000;
// Lo que tarda en cargarse un paquete al camión, y cada cuánto puede salir a la carretera un camión nuevo
const LOAD_SECONDS = 0.6;
const SPAWN_GAP_SECONDS = 8;
// El viaje: a qué velocidad promedio se promete la entrega (km/h), cuánto cambia la de cada camión y la tolerancia de la promesa
const NOMINAL_SPEED_KMH = 55;
const SPEED_DEVIATION_KMH = 4;
const MIN_SPEED_KMH = 45;
const MAX_SPEED_KMH = 65;
const DELIVERY_TOLERANCE_SECONDS = 3600;
// Separación entre los camiones que esperan en la carretera, para que no se pisen
const ROAD_QUEUE_SPACING = 13;
const TURN_SECONDS = 2.5;
const ROAD_SPEED = 9;
const GATE_CROSSING_SPEED = 3.5;
const YARD_SPEED = 5;
const GATE_CLEARANCE = 9;
// Los camiones de despacho llevan números desde aquí, para no confundirlos con los de recibo
const DISPATCH_FIRST_NUMBER = 501;

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

    this.out.on_end = (parcel, belt, now) => this.receive_parcel(parcel, now);

    this.doors = layout.doors.map((layout_door, index) => {
      const door = new DispatchDoor(index, layout_door, 0);
      door.enabled = index < config.get("door_count");
      return door;
    });
    this.trucks = [];
    this.operators = [];
    // El informe de despachos: un renglón por cada camión que sale en un corte
    this.log = [];
    this.log_count = 0;
    // Una pila de paquetes listos por destino, los camiones que faltan por entrar en la ola del corte y las entregas registradas
    this.bins = DESTINATIONS.map((destination) => new DispatchBin(destination, dispatch_bin_slot(destination.index)));
    this.jobs = [];
    this.deliveries = [];
    // El OTD sumado por día de entrega prometida, que no se pierde cuando el detalle por pedido llega a su tope
    this.otd_days = new Map();
    this.otd_totals = { orders: 0, on_time: 0 };
    // Las entregas de pedidos que ya salieron y todavía no llegan al cliente, y cuándo llega la próxima
    this.in_transit = [];
    this.next_arrival_at = Infinity;
    // Los viajes de los camiones que salieron, para el mapa: dónde van, cuánto llevan y cuándo llegan
    this.trips = [];
    this.last_spawn_at = -Infinity;
    this.cutoff_event_id = null;
    this.cutoff_event_time = null;
    this.schedule_next_cutoff(0);
  }

  // ---------- Camiones de despacho: una ola por hora de corte ----------
  // Los paquetes empacados llegan al final de la banda de despacho y esperan en la pila de su destino. A cada hora de corte salen
  // los de los pedidos a los que les tocaba ese corte (o uno anterior, si habían quedado tardíos): un camión por ciudad, o más si
  // no caben en uno. Los pedidos que no estaban listos pierden el corte: son envíos tardíos y salen en el siguiente.

  // El paquete llega al final de la banda: queda en la pila de su destino, esperando el corte
  receive_parcel(parcel, now) {
    const { sim } = this;
    const bin = this.bins[parcel.order.destination.index];
    parcel.boxes.forEach((box) => box.machine.go_to("IN_DISPATCH_BIN", now));
    parcel.ready_at = now;
    bin.parcels.push(parcel);
    sim.parcels = sim.parcels.filter((candidate) => candidate !== parcel);
    return true;
  }

  // ---------- Cortes ----------
  schedule_next_cutoff(now) {
    const at = next_cutoff_after(now, this.sim.yard.cutoffs, 0);
    this.cutoff_event_time = at;
    this.cutoff_event_id = this.sim.events.schedule(at, "dispatch_cutoff", {});
  }

  // La persona cambió las horas de corte: se cancela el corte que venía, se programa el que sigue y los pedidos toman su corte nuevo
  reschedule_cutoffs(now) {
    if (this.cutoff_event_id !== null) this.sim.events.cancel(this.cutoff_event_id);
    this.sim.orders.reassign_cutoffs(now);
    this.schedule_next_cutoff(now);
  }

  on_cutoff_event(now) {
    this.run_cutoff(now);
    this.schedule_next_cutoff(now);
  }

  // Llegó una hora de corte: se arman los camiones con lo que está listo y los demás pedidos del corte pasan a tardíos
  run_cutoff(now) {
    const { sim } = this;
    const capacity = sim.config.get("dispatch_truck_capacity");
    const going_orders = new Set();
    const created = [];
    this.bins.forEach((bin) => {
      const going = bin.parcels.filter((parcel) => parcel.order.cutoff_at <= now).sort((first, second) => first.order.created_at - second.order.created_at);
      if (going.length === 0) return;
      bin.parcels = bin.parcels.filter((parcel) => !going.includes(parcel));
      going.forEach((parcel) => going_orders.add(parcel.order));
      // Un camión por ciudad; si no caben, otro de la misma ciudad
      let current = null;
      going.forEach((parcel) => {
        const boxes = parcel.boxes.length;
        if (!current || (current.boxes > 0 && current.boxes + boxes > capacity)) {
          current = { destination: bin.destination, parcels: [], boxes: 0, cutoff_at: now, cutoff_text: sim.format_time(now) };
          created.push(current);
        }
        current.parcels.push(parcel);
        current.boxes += boxes;
      });
    });
    // Los pedidos de este corte que no estaban listos (en proceso, o empacados pero todavía en la banda) pierden el corte
    sim.orders.orders.forEach((order) => {
      if (order.cutoff_at <= now && !going_orders.has(order)) {
        sim.orders.mark_late(order, now);
        sim.counters.late_shipments += 1;
      }
    });
    // Las rutas más largas salen primero
    created.sort((first, second) => second.destination.kilometers - first.destination.kilometers);
    this.jobs.push(...created);
    sim.counters.cutoffs_run += 1;
    sim.emit({ type: "dispatch_cutoff", trucks: created.length, at: now });
  }

  // ---------- Camiones ----------
  new_dispatch_truck(door, job, now) {
    const { sim } = this;
    const truck = new Truck(DISPATCH_FIRST_NUMBER - 1 + sim.next_id("truck_dispatch"), "dispatch", now);
    truck.door = door;
    truck.destination = job.destination;
    truck.route = make_route(job.destination.region_index, job.destination.city_index, false);
    truck.docked = false;
    truck.job = job;
    truck.load_queue = [...job.parcels];
    truck.load_timer = 0;
    truck.cutoff_at = job.cutoff_at;
    truck.cutoff_text = job.cutoff_text;
    // A qué velocidad promedio hace el viaje (con paradas y tráfico): cambia de un camión a otro
    truck.speed_kmh = Math.min(MAX_SPEED_KMH, Math.max(MIN_SPEED_KMH, sim.rng_routes.normal(NOMINAL_SPEED_KMH, SPEED_DEVIATION_KMH)));
    door.truck = truck;
    door.machine.go_to("OCCUPIED", now);
    this.trucks.push(truck);
    return truck;
  }

  // El camión llega por la carretera del este, espera en la talanquera, entra y se acopla de reversa a su puerta
  spawn_entering_truck(door, job, now) {
    const { sim } = this;
    const truck = this.new_dispatch_truck(door, job, now);
    const lane = sim.gates.east_in;
    truck.teleport(ROAD_SPAWN_X, 0, lane.z, Math.PI);
    truck.start_script([
      // Cada puerta espera en su propio lugar de la fila, así dos camiones detenidos por el bloqueo no quedan uno encima del otro
      { do: "drive", points: [{ x: lane.stop_x + door.index * ROAD_QUEUE_SPACING, z: lane.z }], speed: ROAD_SPEED },
      { do: "until", test: () => !sim.yard.dispatch_blocked },
      { do: "drive", points: [{ x: lane.stop_x, z: lane.z }], speed: ROAD_SPEED },
      { do: "until", test: () => lane.try_claim(truck) },
      { do: "until", test: () => lane.is_open_for(truck) },
      { do: "drive", points: [{ x: GATES.east.x - GATE_CLEARANCE, z: lane.z }], speed: GATE_CROSSING_SPEED },
      {
        do: "call",
        fn: (time) => {
          lane.release(truck);
          truck.arrived_text = sim.format_time(time);
        },
      },
      { do: "drive", points: [{ x: GATES.east.x - GATE_CLEARANCE - 1, z: lane.z }, { x: GATES.east.x - GATE_CLEARANCE - 1, z: door.z }, { x: door.layout.approach_x, z: door.z }], speed: YARD_SPEED },
      { do: "turn", yaw: 0, seconds: TURN_SECONDS },
      { do: "drive", points: [{ x: door.layout.truck_x, z: door.z }], reverse: true, speed: 2.5 },
      {
        do: "call",
        fn: (time) => {
          truck.docked = true;
          truck.door_open = 1;
          truck.machine.go_to("LOADING", time);
        },
      },
    ]);
  }

  // Los camiones que faltan entran a las puertas libres, de a uno cada cierto tiempo para que no salgan encimados de la pantalla
  fill_doors(now) {
    if (this.sim.yard.dispatch_blocked || this.jobs.length === 0) return;
    for (const door of this.doors) {
      if (this.jobs.length === 0 || now - this.last_spawn_at < SPAWN_GAP_SECONDS) break;
      if (!door.enabled || door.truck) continue;
      this.last_spawn_at = now;
      this.spawn_entering_truck(door, this.jobs.shift(), now);
    }
  }

  // Un camión acoplado carga sus paquetes de a uno; cuando termina, sale
  step_loading(now, dt) {
    this.doors.forEach((door) => {
      const truck = door.truck;
      if (!truck || !truck.docked || truck.machine.state !== "LOADING") return;
      truck.load_timer -= dt;
      while (truck.load_timer <= 0 && truck.load_queue.length > 0) {
        this.load_one(door, truck, now);
        truck.load_timer += LOAD_SECONDS;
      }
      // A la talanquera de salida va un camión a la vez; los demás esperan cargados en su puerta
      if (truck.load_queue.length === 0 && this.exit_is_free()) this.depart(door, truck, now);
    });
  }

  exit_is_free() {
    return !this.trucks.some((truck) => truck.machine.state === "DEPARTING" && !truck.exit_claimed);
  }

  load_one(door, truck, now) {
    const parcel = truck.load_queue.shift();
    parcel.boxes.forEach((box) => box.machine.go_to("LOADED", now));
    truck.cargo.push(parcel);
    truck.loaded_count += 1;
    this.sim.emit({ type: "parcel_loaded", door });
  }

  depart(door, truck, now) {
    const { sim } = this;
    this.record(door, truck, now);
    truck.cargo.forEach((parcel) => this.ship_parcel(parcel, now, truck));
    sim.counters.trucks_dispatched += 1;
    this.record_trip(truck, now);
    truck.machine.go_to("DEPARTING", now);
    truck.docked = false;
    sim.emit({ type: "truck_departing", truck, empty: false });
    door.truck = null;
    door.machine.go_to("EMPTY", now);
    const lane = sim.gates.east_out;
    truck.start_script([
      { do: "drive", points: [{ x: door.layout.approach_x, z: door.z }, { x: GATES.east.x - GATE_CLEARANCE - 1, z: door.z }, { x: GATES.east.x - GATE_CLEARANCE - 1, z: lane.z }, { x: lane.stop_x, z: lane.z }], speed: YARD_SPEED },
      {
        do: "until",
        test: () => {
          if (!lane.try_claim(truck)) return false;
          truck.exit_claimed = true;
          return true;
        },
      },
      { do: "until", test: () => lane.is_open_for(truck) },
      { do: "drive", points: [{ x: GATES.east.x + GATE_CLEARANCE, z: lane.z }], speed: GATE_CROSSING_SPEED },
      { do: "call", fn: () => lane.release(truck) },
      { do: "drive", points: [{ x: ROAD_SPAWN_X + 10, z: lane.z }], speed: ROAD_SPEED },
      {
        do: "call",
        fn: (time) => {
          truck.machine.go_to("GONE", time);
          this.trucks = this.trucks.filter((candidate) => candidate !== truck);
        },
      },
    ]);
    truck.door_open = 0;
  }

  // El viaje de un camión que salió: a dónde va, a qué velocidad, qué lleva y cuándo llega al cliente. Las entregas de sus pedidos
  // acaban de quedar registradas (son las últimas de la lista).
  record_trip(truck, now) {
    const delivered = this.deliveries.slice(this.deliveries.length - truck.cargo.length);
    const products = new Map();
    truck.cargo.forEach((parcel) => parcel.boxes.forEach((box) => products.set(box.sku_id, (products.get(box.sku_id) || 0) + 1)));
    const { kilometers } = truck.destination;
    this.trips.push({
      id: this.log_count,
      truck_id: truck.id,
      destination: truck.destination,
      kilometers,
      departed_at: now,
      speed_kmh: truck.speed_kmh,
      arrival_at: now + (kilometers / truck.speed_kmh) * 3600,
      cutoff_text: truck.cutoff_text,
      orders: truck.cargo.length,
      late_shipments: delivered.filter((delivery) => delivery.late_shipment).length,
      late_arrivals: delivered.filter((delivery) => delivery.late_arrival).length,
      boxes: delivered.reduce((sum, delivery) => sum + delivery.boxes, 0),
      units: delivered.reduce((sum, delivery) => sum + delivery.units, 0),
      products: [...products.entries()].map(([sku_id, boxes]) => ({ sku_id, boxes })).sort((first, second) => second.boxes - first.boxes),
    });
    if (this.trips.length > TRIPS_LIMIT) this.trips.shift();
  }

  // Un renglón del informe de despachos: un camión que salió en un corte
  record(door, truck, now) {
    let boxes = 0;
    let units = 0;
    let late = 0;
    truck.cargo.forEach((parcel) => {
      boxes += parcel.boxes.length;
      if (parcel.order.late) late += 1;
      parcel.boxes.forEach((box) => {
        units += box.units;
      });
    });
    this.log_count += 1;
    this.log.push({
      id: this.log_count,
      cutoff_at: truck.cutoff_at,
      cutoff_text: truck.cutoff_text,
      departed_at: now,
      departed_text: this.sim.format_time(now),
      door: door.index + 1,
      truck_id: truck.id,
      destination: truck.route.text,
      kilometers: truck.destination.kilometers,
      orders: truck.cargo.length,
      late_orders: late,
      boxes,
      units,
    });
    if (this.log.length > DISPATCH_LOG_LIMIT) this.log.shift();
  }

  // Lo que va en el camión que sale queda despachado, y su entrega queda registrada para la Entrega a Tiempo (OTD)
  ship_parcel(parcel, now, truck) {
    const { sim } = this;
    const order = parcel.order;
    let units = 0;
    parcel.boxes.forEach((box) => {
      units += box.units;
      box.machine.go_to("SHIPPED", now);
      sim.inventory.ship(box);
      sim.retire_box(box);
    });
    order.machine.go_to("DISPATCHED", now);
    order.dispatched_at = now;
    sim.counters.orders_dispatched += 1;
    sim.counters.cycle_time_total += now - order.created_at;
    sim.counters.cycle_count += 1;
    sim.orders.remove_order(order);
    sim.finished_orders.push(order);
    sim.parcels = sim.parcels.filter((candidate) => candidate !== parcel);
    this.record_delivery(order, truck, now, parcel.boxes.length, units);
  }

  // Cuándo llega el pedido al cliente (salida más el viaje) contra cuándo se prometió (corte más el viaje a velocidad normal más una
  // tolerancia). Un pedido que perdió su corte nunca es a tiempo.
  record_delivery(order, truck, now, boxes, units) {
    const { sim } = this;
    const { kilometers } = order.destination;
    const arrival_at = now + (kilometers / truck.speed_kmh) * 3600;
    const promised_at = order.promised_cutoff + (kilometers / NOMINAL_SPEED_KMH) * 3600 + DELIVERY_TOLERANCE_SECONDS;
    const late_shipment = order.late;
    const late_arrival = arrival_at > promised_at;
    const on_time = !late_shipment && !late_arrival;
    const delivery = {
      order_id: order.id,
      city: order.destination.city,
      region: order.destination.region,
      kilometers,
      boxes,
      units,
      created_at: order.created_at,
      promised_cutoff: order.promised_cutoff,
      shipped_at: now,
      truck_id: truck.id,
      arrival_at,
      promised_at,
      late_shipment,
      late_arrival,
      on_time,
    };
    this.deliveries.push(delivery);
    // Al pasar el tope se sueltan de un golpe las más viejas (no una por una, que cuesta mover todo el arreglo cada vez)
    if (this.deliveries.length > DELIVERIES_LIMIT * 1.1) this.deliveries.splice(0, this.deliveries.length - DELIVERIES_LIMIT);
    // Todavía no es una entrega: cuenta para el OTD cuando el camión llegue al cliente
    this.in_transit.push(delivery);
    this.next_arrival_at = Math.min(this.next_arrival_at, arrival_at);
  }

  // Los pedidos cuyo camión ya llegó al cliente pasan a contar: a tiempo o tarde, por día de entrega prometida
  settle_arrivals(now) {
    if (now < this.next_arrival_at) return;
    const { sim } = this;
    let next = Infinity;
    const waiting = [];
    this.in_transit.forEach((delivery) => {
      if (delivery.arrival_at > now) {
        waiting.push(delivery);
        next = Math.min(next, delivery.arrival_at);
        return;
      }
      sim.counters.orders_delivered += 1;
      if (delivery.on_time) sim.counters.orders_on_time += 1;
      const day = day_index(delivery.promised_at);
      if (!this.otd_days.has(day)) this.otd_days.set(day, { key: day, orders: 0, on_time: 0, late_shipment: 0, late_arrival: 0, units: 0 });
      const row = this.otd_days.get(day);
      row.orders += 1;
      row.units += delivery.units;
      if (delivery.on_time) row.on_time += 1;
      else if (delivery.late_shipment) row.late_shipment += 1;
      else row.late_arrival += 1;
      this.otd_totals.orders += 1;
      if (delivery.on_time) this.otd_totals.on_time += 1;
    });
    this.in_transit = waiting;
    this.next_arrival_at = next;
  }

  // El informe de Entrega a Tiempo por día de entrega prometida: { days, deliveries, pending_late, totals }
  otd_report() {
    const { sim } = this;
    const rows = [...this.otd_days.values()]
      .sort((first, second) => first.key - second.key)
      .map((row) => ({ ...row, date: sim.format_iso_date(day_start_time(row.key)), otd: row.orders > 0 ? row.on_time / row.orders : null }));
    const { orders: total, on_time } = this.otd_totals;
    // Pedidos que ya perdieron su corte y todavía no salen: atrasados sin enviar
    const pending_late = sim.orders.orders.filter((order) => order.late).length;
    return { days: rows, deliveries: this.deliveries, pending_late, totals: { orders: total, on_time, otd: total > 0 ? on_time / total : null } };
  }

  // Puertas que se abren con el slider
  sync_doors() {
    const wanted = this.sim.config.get("door_count");
    this.doors.forEach((door, index) => {
      door.enabled = index < wanted;
    });
  }

  // Los pedidos listos de cada destino y los camiones que faltan por salir (para la interfaz)
  pending_summary() {
    return {
      bins: this.bins.filter((bin) => bin.parcels.length > 0),
      jobs: this.jobs.length,
      next_cutoff_at: this.cutoff_event_time,
    };
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
    this.sync_doors();
    this.fill_doors(now);
    this.step_operators(now);
    this.step_stations(now, dt);
    this.step_loading(now, dt);
    this.settle_arrivals(now);
    this.operators.forEach((operator) => operator.update(dt, now));
    this.trucks.forEach((truck) => truck.update(dt, now));
  }

  update_belts(dt, now) {
    this.east.update(dt, now);
    this.feed.update(dt, now);
    this.out.update(dt, now);
  }
}
