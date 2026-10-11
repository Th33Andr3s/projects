// El motor de la simulación. Es híbrido: lo que ocurre en un momento exacto (llegada de un camión, nacimiento de un pedido,
// salida de un camión por horario, fin de un pico de pedidos) va en una cola de eventos, y lo continuo (bandas, vehículos,
// personas) avanza en pasos de tiempo fijos. Cada paso atiende primero los eventos que ya tocan y luego mueve todo.
//
// No usa nada del navegador ni de Three.js, y todo el azar sale de flujos con semilla: dos corridas con la misma semilla y las
// mismas acciones terminan igual. Lo que la interfaz y el dibujo necesitan se lee de las listas públicas (`boxes`, `pallets`,
// `totes`, `parcels`, `belts`, los actores de cada sistema) y de `drain_events()`.

import {
  ACTIVE_SKU_CAPACITY,
  SIM_STEP_SECONDS,
  SKU_COUNT,
  sku_name,
} from "./config.js";
import { EventQueue } from "./event_queue.js";
import { Rng } from "./rng.js";
import { build_belt_paths } from "./layout.js";
import { Box, Pallet } from "./entities.js";
import { Disruptions } from "./disruptions.js";
import { ReceivingSystem } from "./sim_receiving.js";
import { StorageSystem } from "./sim_storage.js";
import { OrdersSystem } from "./sim_orders.js";
import { OutboundSystem } from "./sim_outbound.js";

// Cada cuánto se recalculan las alertas y se acumulan las utilizaciones
const SLOW_UPDATE_SECONDS = 1;
const MAX_PENDING_EVENTS = 400;
const FLASH_SECONDS = 1.2;
const FINISHED_ORDERS_KEPT = 300;

export class Simulation {
  constructor(config, layout, seed) {
    this.config = config;
    this.layout = layout;
    this.seed = seed;
    this.paths = build_belt_paths(layout);
    this.now = 0;
    this.steps = 0;

    const root = new Rng(seed);
    this.rng_trucks = root.fork("camiones");
    this.rng_cargo = root.fork("carga");
    this.rng_split = root.fork("reparto");
    this.rng_orders = root.fork("pedidos");
    this.rng_pack = root.fork("empaque");
    this.rng_init = root.fork("inicio");

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
      orders_cancelled: 0,
      trucks_dispatched: 0,
      empty_departures: 0,
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

    this.disruptions = new Disruptions(this);
    this.receiving = new ReceivingSystem(this);
    this.storage = new StorageSystem(this);
    this.orders = new OrdersSystem(this);
    this.outbound = new OutboundSystem(this);

    this.unsubscribe = config.subscribe((key) => {
      if (key === "orders_per_minute" || key === "max_order_lines") this.reschedule_orders = true;
    });

    this.fill_initial();
    this.orders.sync_walls();
    this.orders.schedule_next_order(0);
  }

  dispose() {
    this.unsubscribe();
  }

  // ---------- Servicios para los sistemas ----------
  next_id(kind) {
    this.ids[kind] = (this.ids[kind] || 0) + 1;
    return this.ids[kind];
  }

  belt_speed() {
    return this.config.get("belt_speed");
  }

  sku_label(sku_id) {
    return sku_name(sku_id);
  }

  new_box(sku_id, now) {
    const box = new Box(this.next_id("box"), sku_id, now);
    this.boxes.push(box);
    this.counters.boxes_created += 1;
    return box;
  }

  retire_box(box) {
    this.counters.boxes_shipped += 1;
    this.boxes = this.boxes.filter((candidate) => candidate !== box);
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

  // ---------- Relleno inicial ----------
  fill_initial() {
    const { config, storage, rng_init } = this;
    const active_fill = config.get("initial_active_fill") / 100;
    const reserve_fill = config.get("initial_reserve_fill") / 100;
    // Las cajas del relleno inicial recorren los estados que tendrían si hubieran llegado por un camión
    const to_receiving = (box) => ["ON_RAIL", "AT_RECEIVING"].forEach((state) => box.machine.go_to(state, 0));

    for (let sku = 0; sku < SKU_COUNT; sku += 1) {
      const wanted = Math.round(ACTIVE_SKU_CAPACITY * active_fill) + rng_init.int(-2, 2);
      const count = Math.min(ACTIVE_SKU_CAPACITY, Math.max(0, wanted));
      for (let index = 0; index < count; index += 1) {
        const box = this.new_box(sku, 0);
        to_receiving(box);
        box.machine.go_to("IN_TOTE", 0);
        storage.add_to_active(box, 0);
      }
    }

    const pallet_count = Math.round(Math.min(storage.positions.length, config.get("reserve_capacity")) * reserve_fill);
    const size = config.get("pallet_size");
    for (let index = 0; index < pallet_count; index += 1) {
      const sku = rng_init.int(0, SKU_COUNT - 1);
      const pallet = new Pallet(this.next_id("pallet"), sku, size, 0);
      for (let slot = 0; slot < size; slot += 1) {
        const box = this.new_box(sku, 0);
        to_receiving(box);
        box.machine.go_to("ON_PALLET", 0);
        box.container = pallet;
        pallet.boxes.push(box);
      }
      pallet.machine.go_to("READY", 0);
      pallet.machine.go_to("CARRIED", 0);
      storage.store_pallet(pallet, storage.find_free_reserve_index(), 0);
      this.pallets.push(pallet);
    }
  }

  // ---------- Un paso ----------
  handle_event(event, now) {
    switch (event.type) {
      case "truck_arrival":
        this.receiving.on_truck_arrival(now);
        break;
      case "order_created":
        this.orders.on_order_event(now);
        break;
      case "dispatch_departure":
        this.outbound.on_departure_event(event.payload.door_index, now);
        break;
      case "dispatch_truck":
        this.outbound.on_replacement_event(event.payload.door_index, now);
        break;
      case "spike_end":
        this.disruptions.on_spike_end(now);
        break;
      default:
        throw new Error(`Evento desconocido: ${event.type}`);
    }
  }

  // Avanza un paso de SIM_STEP_SECONDS. `now` es el tiempo simulado al final del paso.
  step(now) {
    const dt = SIM_STEP_SECONDS;
    this.now = now;
    this.steps += 1;

    if (this.reschedule_orders) {
      this.reschedule_orders = false;
      this.orders.reschedule(now);
    }
    let event;
    while ((event = this.events.pop_due(now))) this.handle_event(event, now);

    this.receiving.step(now, dt);
    this.storage.step(now, dt);
    this.orders.step(now, dt);
    this.outbound.step(now, dt);
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
    const { storage, outbound, utilization } = this;
    storage.forklifts.forEach((forklift) => {
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

    // Una caja que se mueve por una banda que corre es avance para su pedido
    this.boxes.forEach((box) => {
      if (box.order && box.belt && box.belt.is_running && !box.belt.is_stalled) box.order.last_progress_at = now;
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
      alerts.push({ key: `blocked_${order.id}`, severity: "danger", order_id: order.id, text: this.blocked_reason(order) });
    });

    for (let sku = 0; sku < SKU_COUNT; sku += 1) {
      const waiting = orders.waiting_lines(sku);
      if (waiting > 0 && storage.available(sku) <= 0 && storage.reserve_boxes(sku) === 0 && storage.inbound[sku] === 0) {
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
    const capacity = Math.min(storage.positions.length, config.get("reserve_capacity"));
    return {
      trucks_received: counters.trucks_received,
      boxes_received: counters.boxes_received,
      reserve_used: storage.reserve_used(),
      reserve_capacity: capacity,
      reserve_percent: capacity > 0 ? Math.round((storage.reserve_used() / capacity) * 100) : 0,
      floor_percent: Array.from({ length: 5 }, (_, floor) => Math.round((storage.floor_count(floor) / (ACTIVE_SKU_CAPACITY * (SKU_COUNT / 5))) * 100)),
      orders_created: counters.orders_created,
      orders_picking: picking,
      orders_consolidating: consolidating,
      orders_packed: counters.orders_packed,
      orders_dispatched: counters.orders_dispatched,
      orders_cancelled: counters.orders_cancelled,
      cycle_average_seconds: counters.cycle_count > 0 ? counters.cycle_time_total / counters.cycle_count : null,
      boxes_on_belts: on_belts,
      forklift_utilization: utilization.forklift_total > 0 ? Math.round((utilization.forklift_busy / utilization.forklift_total) * 100) : 0,
      packer_utilization: utilization.packer_total > 0 ? Math.round((utilization.packer_busy / utilization.packer_total) * 100) : 0,
      trucks_dispatched: counters.trucks_dispatched,
      empty_departures: counters.empty_departures,
    };
  }

  // Resumen para el lienzo, que lo lee un lector de pantalla
  describe_scene() {
    const docked = this.receiving.docks.filter((dock) => dock.truck && dock.truck.machine.state === "UNLOADING").length;
    return `Centro de distribución: ${docked} camiones descargando, ${this.orders.orders.length} pedidos en proceso, ${this.boxes.length} cajas.`;
  }
}
