// El motor de la simulación. Es híbrido: lo que ocurre en un momento exacto (llegada de un camión, nacimiento de un pedido,
// salida de un camión por horario, fin de un pico de pedidos) va en una cola de eventos, y lo continuo (bandas, vehículos,
// personas) avanza en pasos de tiempo fijos. Cada paso atiende primero los eventos que ya tocan y luego mueve todo.
//
// No usa nada del navegador ni de Three.js, y todo el azar sale de flujos con semilla: dos corridas con la misma semilla y las
// mismas acciones terminan igual. Lo que la interfaz y el dibujo necesitan se lee de las listas públicas (`boxes`, `pallets`,
// `totes`, `parcels`, `belts`, los actores de cada sistema) y de `drain_events()`.

import { FLOOR_COUNT, SIM_STEP_SECONDS } from "./config.js";
import { EventQueue } from "./event_queue.js";
import { Rng } from "./rng.js";
import { build_belt_paths } from "./layout.js";
import { SKUS, sku_label, sku_name } from "./catalog.js";
import { build_gate_lanes } from "./gates.js";
import { Inventory } from "./inventory.js";
import { format_sim_datetime } from "./format.js";
import { Box, step_clock } from "./entities.js";
import { default_allocation } from "./active_layout.js";
import { Disruptions } from "./disruptions.js";
import { ReceivingSystem } from "./sim_receiving.js";
import { DockFleet } from "./sim_dock_fleet.js";
import { StorageSystem } from "./sim_storage.js";
import { OrdersSystem } from "./sim_orders.js";
import { Coordinator } from "./sim_coordinator.js";
import { OutboundSystem } from "./sim_outbound.js";

// Cada cuánto se recalculan las alertas y se acumulan las utilizaciones
const SLOW_UPDATE_SECONDS = 5;
const MAX_PENDING_EVENTS = 400;
const FLASH_SECONDS = 1.2;
const FINISHED_ORDERS_KEPT = 300;

export class Simulation {
  // `yard` es la configuración del patio (camiones por franja, muelles, restricciones) y `start_ms` el instante
  // real (UTC) que corresponde a las 6 de la mañana del primer día, para escribir fechas
  constructor(config, yard, layout, seed, start_ms, allocation = default_allocation()) {
    this.config = config;
    this.yard = yard;
    this.layout = layout;
    this.seed = seed;
    this.start_ms = start_ms;
    this.paths = build_belt_paths(layout);
    this.now = 0;
    this.steps = 0;

    const root = new Rng(seed);
    this.rng_trucks = root.fork("camiones");
    this.rng_agenda = root.fork("agenda");
    this.rng_destinations = root.fork("destinos");
    this.rng_order_destinations = root.fork("destinos_pedidos");
    this.rng_routes = root.fork("viajes");
    this.rng_coordinator = root.fork("coordinador");
    this.rng_orders = root.fork("pedidos");
    this.rng_pack = root.fork("empaque");

    this.events = new EventQueue();
    this.ids = {};
    this.counters = {
      trucks_received: 0,
      boxes_created: 0,
      boxes_received: 0,
      boxes_shipped: 0,
      orders_created: 0,
      orders_packed: 0,
      orders_dispatched: 0,
      orders_delivered: 0,
      orders_cancelled: 0,
      orders_rejected: 0,
      lines_unfilled: 0,
      trucks_dispatched: 0,
      cutoffs_run: 0,
      late_shipments: 0,
      orders_on_time: 0,
      cycle_time_total: 0,
      cycle_count: 0,
    };
    this.utilization = { forklift_busy: 0, forklift_total: 0, packer_busy: 0, packer_total: 0 };

    this.boxes = [];
    this.pallets = [];
    this.totes = [];
    this.parcels = [];
    this.belts = [];
    this.finished_orders = [];
    // Destellos y otros efectos breves que el dibujo muestra; los eventos que la interfaz y el audio consumen
    this.effects = [];
    this.pending_events = [];
    this.alerts = [];
    this.slow_timer = 0;
    this.reschedule_orders = false;

    // Qué producto va en cada piso del activo y en qué proporción
    this.allocation = allocation;
    this.gates = build_gate_lanes();
    this.disruptions = new Disruptions(this);
    this.inventory = new Inventory(this);
    this.coordinator = new Coordinator(this);
    this.receiving = new ReceivingSystem(this);
    this.storage = new StorageSystem(this);
    this.dock_fleet = new DockFleet(this);
    this.orders = new OrdersSystem(this);
    this.outbound = new OutboundSystem(this);

    // Si la persona cambia las horas de corte, el próximo paso reprograma el corte que viene
    this.reschedule_cutoffs = false;
    this.unsubscribe_yard = yard.subscribe((kind) => {
      if (kind === "cutoffs" || kind === "reset") this.reschedule_cutoffs = true;
    });
    this.unsubscribe = config.subscribe((key) => {
      if (key === "orders_per_minute" || key === "max_order_lines") this.reschedule_orders = true;
    });

    this.orders.sync_walls();
  }

  dispose() {
    this.unsubscribe();
    this.unsubscribe_yard();
  }

  // ---------- Servicios para los sistemas ----------
  // Las tres flotas de montacargas juntas: de muelle a stock, de stock a reserva y de reserva a activo
  get forklifts() {
    return [...this.dock_fleet.forklifts, ...this.storage.forklifts];
  }

  next_id(kind) {
    this.ids[kind] = (this.ids[kind] || 0) + 1;
    return this.ids[kind];
  }

  belt_speed() {
    return this.config.get("belt_speed");
  }

  sku_label(sku_id) {
    return sku_label(sku_id);
  }

  // La fecha de un momento de la simulación como AAAA-MM-DD (para los archivos que se descargan)
  format_iso_date(seconds) {
    return new Date(this.start_ms + seconds * 1000).toISOString().slice(0, 10);
  }

  // La fecha y hora de un momento como AAAA-MM-DD HH:MM
  format_iso_datetime(seconds) {
    return new Date(this.start_ms + seconds * 1000).toISOString().slice(0, 16).replace("T", " ");
  }

  // La fecha y hora (con el día) de un momento de la simulación, para los camiones y la programación
  format_time(seconds) {
    return format_sim_datetime(this.start_ms, seconds);
  }

  new_box(sku_id, now) {
    const box = new Box(this.next_id("box"), sku_id, now);
    box.list_index = this.boxes.length;
    this.boxes.push(box);
    this.counters.boxes_created += 1;
    return box;
  }

  retire_box(box) {
    this.counters.boxes_shipped += 1;
    // Se saca de la lista cambiándola de lugar con la última (con decenas de miles de cajas, recorrer la lista en cada envío no aguanta)
    const last = this.boxes.pop();
    if (last !== box) {
      this.boxes[box.list_index] = last;
      last.list_index = box.list_index;
    }
  }

  emit(event) {
    this.pending_events.push(event);
    if (this.pending_events.length > MAX_PENDING_EVENTS) this.pending_events.shift();
  }

  // Los eventos desde la última vez que se pidieron
  drain_events() {
    const drained = this.pending_events;
    this.pending_events = [];
    return drained;
  }

  // ---------- Un paso ----------
  handle_event(event, now) {
    switch (event.type) {
      case "truck_spawn":
        this.receiving.on_truck_spawn(event.payload.entry, now);
        break;
      case "order_created":
        this.orders.on_order_event(now);
        break;
      case "dispatch_cutoff":
        this.outbound.on_cutoff_event(now);
        break;
      case "spike_end":
        this.disruptions.on_spike_end(now);
        break;
      default:
        throw new Error(`Evento desconocido: ${event.type}`);
    }
  }

  // El e-commerce (los pedidos de clientes) arranca apagado y la persona lo enciende o lo apaga cuando quiera
  get ecommerce_enabled() {
    return this.orders.ecommerce_enabled;
  }

  set_ecommerce(enabled) {
    this.orders.set_ecommerce(Boolean(enabled), this.now);
  }

  // Avanza un paso de SIM_STEP_SECONDS. `now` es el tiempo simulado al final del paso.
  step(now) {
    const dt = SIM_STEP_SECONDS;
    this.now = now;
    this.steps += 1;
    step_clock.current = this.steps;

    if (this.reschedule_cutoffs) {
      this.reschedule_cutoffs = false;
      this.outbound.reschedule_cutoffs(now);
    }
    if (this.reschedule_orders) {
      this.reschedule_orders = false;
      this.orders.reschedule(now);
    }
    let event;
    while ((event = this.events.pop_due(now))) this.handle_event(event, now);

    this.coordinator.step(now);
    this.receiving.step(now, dt);
    this.storage.step(now, dt);
    this.dock_fleet.step(now, dt);
    this.orders.step(now, dt);
    this.outbound.step(now, dt);
    Object.values(this.gates).forEach((lane) => lane.update(dt));
    this.receiving.trucks.forEach((truck) => truck.update(dt, now));
    this.receiving.docks.forEach((dock) => dock.rail.update(dt, now));
    this.orders.update_belts(dt, now);
    this.outbound.update_belts(dt, now);

    this.effects = this.effects.filter((effect) => now - effect.born < FLASH_SECONDS);

    this.slow_timer += dt;
    if (this.slow_timer >= SLOW_UPDATE_SECONDS) {
      this.slow_timer -= SLOW_UPDATE_SECONDS;
      this.slow_update(now);
    }
    // Los pedidos terminados que el panel ya no necesita se sueltan para no crecer sin límite
    if (this.finished_orders.length > FINISHED_ORDERS_KEPT) this.finished_orders.splice(0, this.finished_orders.length - FINISHED_ORDERS_KEPT);
  }

  // Lo que no hace falta calcular en cada paso: utilizaciones y alertas
  slow_update(now) {
    const { outbound, utilization } = this;
    this.forklifts.forEach((forklift) => {
      utilization.forklift_total += SLOW_UPDATE_SECONDS;
      if (forklift.is_busy && forklift.machine.state !== "MAINTENANCE") utilization.forklift_busy += SLOW_UPDATE_SECONDS;
    });
    outbound.stations.forEach((station) => {
      if (!station.enabled) return;
      utilization.packer_total += SLOW_UPDATE_SECONDS;
      if (station.machine.state === "BUSY") utilization.packer_busy += SLOW_UPDATE_SECONDS;
    });
    this.alerts = this.compute_alerts(now);
  }

  // ---------- Alertas ----------
  compute_alerts(now) {
    const alerts = [];
    const { storage, orders, config } = this;

    if (storage.find_free_reserve_index() < 0 && (this.receiving.ready_pallets().length > 0 || this.receiving.forming_pallets.length > 0)) {
      alerts.push({ key: "reserve_full", severity: "warn", text: "Reserva llena: los pallets esperan en recibo." });
    }

    if (this.receiving.parked_count === this.receiving.bays.length) {
      alerts.push({ key: "parking_full", severity: "warn", text: "Parqueadero lleno: los camiones esperan en la carretera." });
    }

    if (orders.backlog_full()) {
      alerts.push({ key: "orders_backlog", severity: "warn", text: "Demasiados pedidos esperando: no entran pedidos nuevos hasta que se atienda la cola (suma operarios o muros)." });
    }

    // Lo que se mueve por una banda que corre es avance para su pedido (se recorren las bandas, no todas las cajas de la bodega)
    this.belts.forEach((belt) => {
      if (!belt.is_running || belt.is_stalled) return;
      belt.items.forEach((item) => {
        if (item.order) item.order.last_progress_at = now;
      });
    });

    const jam_order = orders.wall_jam_active && orders.jam_box ? orders.jam_box.order : null;
    if (jam_order) {
      alerts.push({
        key: "wall_jam",
        severity: "danger",
        order_id: jam_order.id,
        text: `Muros llenos: la banda está atascada (pedido #${jam_order.id} espera casilla).`,
      });
    }

    const limit = config.get("blocked_order_alert_seconds");
    orders.orders.forEach((order) => {
      if (!order.is_cancellable || order === jam_order) return;
      if (now - order.last_progress_at < limit) return;
      // Un pedido que espera su turno para soltarse a los operarios (muros ocupados) no está bloqueado: solo uno que espera existencias
      if (order.machine.state === "CREATED" && !order.lines.some((line) => line.machine.state === "WAITING_STOCK")) return;
      alerts.push({ key: `blocked_${order.id}`, severity: "danger", order_id: order.id, text: this.blocked_reason(order) });
    });

    for (let sku = 0; sku < SKUS.length; sku += 1) {
      const waiting = orders.waiting_lines(sku);
      if (waiting > 0 && storage.available(sku) <= 0 && storage.reserve_boxes(sku) === 0 && storage.inbound[sku] === 0 && this.receiving.staged_boxes_of(sku) === 0) {
        alerts.push({ key: `no_stock_${sku}`, severity: "warn", text: `${sku_name(sku)} sin stock en ningún lado: ${waiting} ${waiting === 1 ? "línea espera" : "líneas esperan"} reposición.` });
      }
    }
    return alerts;
  }

  blocked_reason(order) {
    const { storage } = this;
    const waiting = order.lines.find((line) => line.machine.state === "WAITING_STOCK");
    if (waiting) {
      const reserve = storage.reserve_boxes(waiting.sku_id);
      const detail = reserve > 0 ? `sin stock en el activo; ${reserve} cajas en la reserva` : "sin stock en el activo ni en la reserva";
      return `Pedido #${order.id} bloqueado: espera el ${sku_name(waiting.sku_id)} (${detail}).`;
    }
    if (this.orders.jam_box && this.orders.jam_box.order === order) return `Pedido #${order.id} bloqueado: espera casilla de muro.`;
    return `Pedido #${order.id} bloqueado: lleva mucho sin avanzar.`;
  }

  // Los pedidos que se pueden cancelar y están con problema (para la lista de la interfaz)
  problem_orders() {
    const ids = new Set(this.alerts.filter((alert) => alert.order_id !== undefined).map((alert) => alert.order_id));
    return this.orders.orders.filter((order) => ids.has(order.id));
  }

  cancel_order(order_id, reprocess) {
    return this.orders.cancel_order(order_id, reprocess, this.now);
  }

  // Los pedidos que se pueden cancelar: todos, o solo los que están con problema (bloqueados o esperando casilla)
  cancellable_orders(scope) {
    const source = scope === "problems" ? this.problem_orders() : this.orders.orders;
    return source.filter((order) => order.is_cancellable);
  }

  // Cancelación masiva. Devuelve cuántos pedidos se cancelaron.
  cancel_orders(scope) {
    let cancelled = 0;
    this.cancellable_orders(scope).forEach((order) => {
      if (this.cancel_order(order.id, false).ok) cancelled += 1;
    });
    return cancelled;
  }

  // ---------- Lo que lee la interfaz ----------
  box_counts_by_state() {
    const counts = {};
    this.boxes.forEach((box) => {
      counts[box.machine.state] = (counts[box.machine.state] || 0) + 1;
    });
    return counts;
  }

  get_kpis() {
    const { counters, orders, storage, utilization, config } = this;
    let picking = 0;
    let consolidating = 0;
    orders.orders.forEach((order) => {
      const state = order.machine.state;
      if (state === "CREATED" || state === "PICKING") picking += 1;
      else if (state === "CONSOLIDATING" || state === "COMPLETE") consolidating += 1;
    });
    let on_belts = 0;
    this.belts.forEach((belt) => {
      belt.items.forEach((item) => {
        on_belts += item.boxes ? item.boxes.length : 1;
      });
    });
    const capacity = storage.reserve_pallet_capacity();
    const floor_capacity = config.get("active_capacity") / FLOOR_COUNT;
    return {
      trucks_received: counters.trucks_received,
      trucks_requested: this.coordinator.requested_trucks,
      trucks_requested_urgent: this.coordinator.requested_urgent,
      boxes_received: counters.boxes_received,
      reserve_used: storage.reserve_used(),
      reserve_capacity: capacity,
      reserve_percent: capacity > 0 ? Math.round((storage.reserve_used() / capacity) * 100) : 0,
      floor_percent: Array.from({ length: FLOOR_COUNT }, (_, floor) => Math.round((storage.floor_count(floor) / floor_capacity) * 100)),
      orders_created: counters.orders_created,
      orders_waiting: orders.pending.length,
      orders_picking: picking,
      orders_consolidating: consolidating,
      orders_packed: counters.orders_packed,
      orders_dispatched: counters.orders_dispatched,
      orders_delivered: counters.orders_delivered,
      orders_cancelled: counters.orders_cancelled,
      orders_rejected: counters.orders_rejected,
      lines_unfilled: counters.lines_unfilled,
      cycle_average_seconds: counters.cycle_count > 0 ? counters.cycle_time_total / counters.cycle_count : null,
      boxes_on_belts: on_belts,
      forklift_utilization: utilization.forklift_total > 0 ? Math.round((utilization.forklift_busy / utilization.forklift_total) * 100) : 0,
      packer_utilization: utilization.packer_total > 0 ? Math.round((utilization.packer_busy / utilization.packer_total) * 100) : 0,
      trucks_dispatched: counters.trucks_dispatched,
      cutoffs_run: counters.cutoffs_run,
      late_shipments: counters.late_shipments,
      // El OTD mide solo entregas: pedidos a tiempo entre pedidos que ya llegaron al cliente
      otd_percent: counters.orders_delivered > 0 ? Math.round((counters.orders_on_time / counters.orders_delivered) * 100) : null,
      staging_boxes: this.receiving.staging.length,
      staging_percent: Math.round((this.receiving.staging.length / Math.max(1, this.receiving.staging_capacity())) * 100),
      trucks_parked: this.receiving.parked_count,
      docks_busy: this.receiving.docks.filter((dock) => dock.truck).length,
    };
  }

  // Resumen para el lienzo, que lo lee un lector de pantalla
  describe_scene() {
    const docked = this.receiving.docks.filter((dock) => dock.truck && dock.truck.machine.state === "UNLOADING").length;
    return `Centro de distribución: ${docked} camiones descargando, ${this.orders.orders.length} pedidos en proceso, ${this.boxes.length} cajas.`;
  }
}
