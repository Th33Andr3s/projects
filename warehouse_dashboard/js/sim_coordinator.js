// El coordinador de recibo: mira cuánto se pide de cada producto, cuánta mercancía hay y cuánta viene en camino, y cuando va a faltar
// pide camiones de ese producto. Sabe lo que ya va a llegar (los camiones programados por franja, los que ya están en el patio
// descargando y los que él mismo pidió), así no pide de más. Si lo que falta se acaba antes de que llegue ayuda, pide un camión
// urgente que llega en una hora; si no, un camión normal que tarda lo que tarda el viaje desde la región de donde sale.
//
// Se guía por la demanda real: las líneas de pedido de clientes de las últimas horas. Con el e-commerce apagado no hay demanda y no
// pide nada; la bodega se llena entonces con los camiones programados y con "Hacer llegar camiones ahora".

import { SKUS } from "./catalog.js";
import { LOCATION_BY_STATE } from "./inventory.js";

// Cada cuánto revisa (segundos simulados)
const TICK_SECONDS = 300;
// Con cuántas horas de pedidos recientes calcula el ritmo de cada producto
const DEMAND_WINDOW_SECONDS = 3 * 3600;
// Las primeras horas de demanda se promedian al menos sobre este tiempo, para que unas pocas líneas no den un ritmo exagerado
const MIN_WINDOW_SECONDS = 1800;
// Un camión urgente llega a la talanquera en esta hora, sin importar de dónde salga
export const URGENT_SECONDS = 3600;
// Velocidad promedio con la que se calcula lo que tarda un camión normal en llegar (km/h, la de los despachos)
const NORMAL_SPEED_KMH = 55;
// Un producto no pide más de estos camiones en una revisión
const MAX_TRUCKS_PER_PRODUCT = 2;
// No pide si con lo pedido la bodega de stock pasaría de esta parte de su capacidad
const STAGING_LIMIT = 0.9;
const LOG_KEPT = 60;

export class Coordinator {
  constructor(sim) {
    this.sim = sim;
    // Cuándo se pidió cada línea de pedido, por producto (solo las últimas horas)
    this.demand = SKUS.map(() => []);
    this.first_demand_at = null;
    this.next_tick_at = TICK_SECONDS;
    // Lo que se muestra en la interfaz: lo pedido en total y las últimas decisiones
    this.requested_trucks = 0;
    this.requested_urgent = 0;
    this.log = [];
  }

  // Alguien quiso un producto (se haya podido atender o no): así el coordinador ve la demanda aunque no haya existencias
  register_demand(sku_id, now) {
    if (this.first_demand_at === null) this.first_demand_at = now;
    this.demand[sku_id].push(now);
  }

  // Cajas por hora que se piden de un producto
  demand_rate(sku_id, now) {
    const list = this.demand[sku_id];
    const from = now - DEMAND_WINDOW_SECONDS;
    while (list.length > 0 && list[0] < from) list.shift();
    if (list.length === 0 || this.first_demand_at === null) return 0;
    const window = Math.min(DEMAND_WINDOW_SECONDS, Math.max(MIN_WINDOW_SECONDS, now - this.first_demand_at));
    return (list.length / window) * 3600;
  }

  // Los camiones que ya están pedidos o programados y todavía no terminan: lo que traen y cuándo llegan, por producto
  incoming(now) {
    const boxes = SKUS.map(() => ({ total: 0, arrivals: [] }));
    this.sim.receiving.schedule.entries.forEach((entry) => {
      if (entry.finished) return;
      const counts = new Map();
      if (entry.truck) {
        // El camión ya está en el patio: solo cuenta lo que le falta por descargar
        entry.truck.cargo.forEach((box) => counts.set(box.sku_id, (counts.get(box.sku_id) || 0) + 1));
      } else {
        entry.sku_ids.forEach((sku_id) => counts.set(sku_id, (counts.get(sku_id) || 0) + 1));
      }
      counts.forEach((count, sku_id) => {
        boxes[sku_id].total += count;
        boxes[sku_id].arrivals.push({ time: Math.max(now, entry.arrival_time), boxes: count });
      });
    });
    return boxes;
  }

  // Cuánta mercancía de cada producto hay ya en el centro de distribución (sin lo que está en pedidos): se cuenta todo, el stock, la
  // reserva, el activo y lo que está en camino entre ellos
  on_hand() {
    const counts = SKUS.map(() => 0);
    this.sim.boxes.forEach((box) => {
      const location = LOCATION_BY_STATE[box.machine.state];
      if (location && location !== "order") counts[box.sku_id] += 1;
    });
    return counts;
  }

  step(now) {
    if (now < this.next_tick_at) return;
    this.next_tick_at = now + TICK_SECONDS;
    const { sim } = this;
    const max_trucks = sim.config.get("coordinator_max_trucks");
    if (max_trucks <= 0) return;
    // Con las llegadas detenidas no se pide nada: ningún camión saldría a la carretera
    if (sim.yard.arrivals_blocked) return;
    const cover_hours = sim.config.get("coordinator_cover_hours");
    const max_urgent = sim.config.get("coordinator_max_urgent");
    const schedule = sim.receiving.schedule;
    const requested_in_flight = () => schedule.entries.filter((entry) => entry.coordinated && !entry.finished);
    const on_hand = this.on_hand();
    const incoming = this.incoming(now);
    // No se pide si la bodega de stock ya está casi llena
    const staging_full = () => sim.receiving.staging.length + sim.receiving.inbound_boxes > sim.config.get("staging_capacity") * STAGING_LIMIT;

    // Primero los productos que antes se quedan sin mercancía
    const needs = [];
    for (let sku_id = 0; sku_id < SKUS.length; sku_id += 1) {
      const rate = this.demand_rate(sku_id, now);
      if (rate < 0.5) continue;
      const covered = incoming[sku_id].arrivals.filter((arrival) => arrival.time - now <= cover_hours * 3600).reduce((sum, arrival) => sum + arrival.boxes, 0);
      const deficit = rate * cover_hours - (on_hand[sku_id] + covered);
      if (deficit <= 0) continue;
      const hours_left = on_hand[sku_id] / rate;
      needs.push({ sku_id, rate, deficit, hours_left });
    }
    needs.sort((first, second) => first.hours_left - second.hours_left);

    for (const need of needs) {
      let flight = requested_in_flight();
      if (flight.length >= max_trucks) break;
      const first_arrival_hours = incoming[need.sku_id].arrivals.length > 0 ? (Math.min(...incoming[need.sku_id].arrivals.map((arrival) => arrival.time)) - now) / 3600 : Infinity;
      const truck_boxes = sim.config.get("boxes_per_truck");
      const trucks = Math.min(MAX_TRUCKS_PER_PRODUCT, Math.ceil(need.deficit / truck_boxes));
      for (let index = 0; index < trucks; index += 1) {
        flight = requested_in_flight();
        if (flight.length >= max_trucks) break;
        if (staging_full()) return;
        const route = schedule.pick_origin();
        const normal_hours = route.kilometers / NORMAL_SPEED_KMH;
        // Si lo que hay se acaba antes de que llegue ayuda, el camión es urgente (si quedan urgentes disponibles)
        const help_hours = Math.min(first_arrival_hours, normal_hours);
        const urgent_now = flight.filter((entry) => entry.urgent).length;
        const urgent = need.hours_left < help_hours && urgent_now < max_urgent;
        const arrival = now + (urgent ? URGENT_SECONDS : normal_hours * 3600);
        const entry = schedule.add_requested(need.sku_id, truck_boxes, arrival, urgent, route, now);
        incoming[need.sku_id].arrivals.push({ time: entry.arrival_time, boxes: entry.box_count });
        incoming[need.sku_id].total += entry.box_count;
        this.requested_trucks += 1;
        if (urgent) this.requested_urgent += 1;
        this.record(now, need, entry, urgent);
      }
    }
  }

  record(now, need, entry, urgent) {
    const sku = SKUS[need.sku_id];
    const left = need.hours_left < 1 ? `${Math.round(need.hours_left * 60)} min` : `${need.hours_left.toFixed(1).replace(".", ",")} h`;
    const arrives = this.sim.format_time(entry.arrival_time);
    this.log.unshift({
      time: now,
      text: `${this.sim.format_time(now)} · ${sku.name}: pidió un camión ${urgent ? "urgente" : "normal"} (la mercancía alcanza para ${left}, llega ${arrives})`,
      urgent,
      truck_id: entry.id,
    });
    if (this.log.length > LOG_KEPT) this.log.length = LOG_KEPT;
  }
}
