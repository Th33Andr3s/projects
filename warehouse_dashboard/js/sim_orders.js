// Pedidos: se crean con una tasa al azar, cada línea la recoge un operario del piso de su SKU y la pone en la banda de ese piso;
// las bandas de piso bajan por la espiral hasta la banda principal, que pasa por los muros de consolidación. Aquí también vive
// la acción de la persona administradora de cancelar un pedido (y reprocesarlo).
//
// Regla de los muros: la primera caja de un pedido que llega a la zona de muros toma una casilla libre. Si no hay ninguna, la
// caja se queda en la banda aunque eso atasque a las que vienen detrás; el atasco se avisa pero no se resuelve solo.

import { ORDER_SPIKE_FACTOR, WALL_JAM_SECONDS } from "./config.js";
import { Belt } from "./belts.js";
import { DESTINATIONS, DESTINATION_WEIGHT_TOTAL, SKUS } from "./catalog.js";
import { assigned_cutoff, next_cutoff_after } from "./cutoffs.js";
import { Order, Wall, Worker } from "./entities.js";
import { ACTIVE, floor_y } from "./layout.js";
import { project_on_path } from "./path_tools.js";

const PICK_SECONDS = 1.5;
const WALK_SPEED = 1.4;
// Dónde se paran los operarios de picking junto a la banda: a este lado del eje
const PICKER_HOME_OFFSET_Z = 1.3;
// La posición donde empieza la zona de muros: antes de la primera casilla de la primera fila
const WALL_ZONE_Z = -11.8;
// Cuántos pedidos esperando se revisan en cada paso para soltarlos a los operarios (los demás esperan su turno)
const RELEASE_SCAN_LIMIT = 150;
const RELEASE_INTERVAL_SECONDS = 1;
// Tope de pedidos de clientes esperando turno. Si la demanda supera por mucho la capacidad, la cola crecería sin fin y tras días de
// simulación la página se volvería lenta; al llegar al tope no entran pedidos nuevos (se cuentan como rechazados y se avisa).
const PENDING_ORDERS_LIMIT = 5000;

export class OrdersSystem {
  constructor(sim) {
    this.sim = sim;
    const { layout, paths } = sim;

    this.orders = [];
    // Los pedidos creados que todavía no se sueltan a los operarios (esperan existencias en el activo o un lugar en los muros), en
    // orden de llegada. Solo cuando se sueltan sus líneas pasan a la cola de los operarios.
    this.pending = [];
    // Las líneas de los pedidos soltados que esperan un operario: cada piso toma las de los productos que tiene en sus estantes
    this.line_queue = [];
    // Por producto: líneas que no han apartado caja (en pedidos esperando o en la cola), líneas en la cola, y líneas que esperan
    // existencias en el activo (para pedir el reabasto)
    this.unpicked_by_sku = Array(SKUS.length).fill(0);
    this.queued_by_sku = Array(SKUS.length).fill(0);
    this.waiting_by_sku = Array(SKUS.length).fill(0);
    this.wanted_pickers = 0;
    this.released_orders = [];
    this.last_release_at = -Infinity;
    this.pickers = Array.from({ length: ACTIVE.floors }, () => []);
    this.pending_order_event = null;
    // El e-commerce arranca apagado: sin pedidos de clientes hasta que la persona lo active
    this.ecommerce_enabled = false;

    // Bandas de piso y banda principal (la espiral va incluida)
    this.main = new Belt("main_belt", "main", paths.main_chain, () => sim.belt_speed());
    this.floor_belts = paths.floor_belts.map((path, floor) => {
      const belt = new Belt(`floor_belt_${floor + 1}`, "floor", path, () => sim.belt_speed());
      // La banda de cada piso entra a la principal en el punto de la espiral que queda a su altura
      const entry_index = (ACTIVE.floors - 1 - floor) * 16;
      belt.entry_s = paths.main_chain.cumulative[entry_index];
      belt.on_end = (box, from, now) => this.merge_into_main(belt, box, now);
      return belt;
    });
    sim.belts.push(this.main, ...this.floor_belts);
    this.merge_start = 0;

    // Muros de consolidación (todos dibujados; los habilitados dependen del slider)
    this.walls = layout.walls.map((layout_wall, index) => {
      const wall = new Wall(index, layout_wall);
      wall.row = Math.floor(index / 2);
      return wall;
    });
    this.wall_zone_s = project_on_path(paths.main_chain, 30, WALL_ZONE_Z);
    this.main.add_gate({ s: this.wall_zone_s, name: "wall_zone", handle: (box, belt, now) => this.zone_gate(box, now) });
    const rows = new Map();
    this.walls.forEach((wall) => rows.set(wall.row, wall.layout.center_z));
    this.row_count = rows.size;
    rows.forEach((center_z, row) => {
      this.main.add_gate({ s: project_on_path(paths.main_chain, 30, center_z), name: `wall_row_${row}`, row, handle: (box) => this.row_gate(box, row) });
    });
    // Cuándo empezó el atasco de muros (la primera caja que espera sin casilla) y si algún cuadro la vio esperando
    this.jam_started_at = null;
    this.jam_box = null;
    this.saw_waiting_box = false;
  }

  // ---------- Creación de pedidos ----------
  order_rate_per_second() {
    const { config, disruptions } = this.sim;
    return (config.get("orders_per_minute") / 60) * (disruptions.spike_active ? ORDER_SPIKE_FACTOR : 1);
  }

  schedule_next_order(now) {
    const { sim } = this;
    this.pending_order_event = null;
    if (!this.ecommerce_enabled) return;
    const rate = this.order_rate_per_second();
    const interval = -Math.log(1 - sim.rng_orders.next()) / rate;
    this.pending_order_event = { time: now + interval, id: sim.events.schedule(now + interval, "order_created") };
  }

  // Cuando cambia la tasa (slider o pico de pedidos) se vuelve a sortear el próximo pedido
  reschedule(now) {
    if (this.pending_order_event) this.sim.events.cancel(this.pending_order_event.id);
    this.schedule_next_order(now);
  }

  // Enciende o apaga el e-commerce. Apagado no nacen pedidos nuevos; los que ya están en proceso terminan normalmente.
  set_ecommerce(enabled, now) {
    if (this.ecommerce_enabled === enabled) return;
    this.ecommerce_enabled = enabled;
    this.reschedule(now);
  }

  on_order_event(now) {
    this.create_order(now, null);
    this.schedule_next_order(now);
  }

  // La cola de pedidos esperando llegó al tope: la demanda supera lo que la bodega alcanza a atender
  backlog_full() {
    return this.pending.length >= PENDING_ORDERS_LIMIT;
  }

  // Cuántas cajas de un producto se pueden pedir todavía: las que hay en el activo (sin lo ya apartado), en la reserva y en camino al
  // activo, menos lo que ya esperan los pedidos que no han apartado caja. Si un pedido pide algo que el activo no tiene pero la
  // reserva sí, el pedido espera y se pide el reabasto de ese producto.
  orderable_boxes(sku_id) {
    const { storage } = this.sim;
    return storage.available(sku_id) + storage.reserve_boxes(sku_id) + storage.inbound[sku_id] - this.unpicked_by_sku[sku_id];
  }

  // Saca un pedido de la lista cambiándolo de lugar con el último (recorrer la lista en cada pedido que sale no aguanta con miles)
  remove_order(order) {
    const last = this.orders.pop();
    if (last !== order) {
      this.orders[order.list_index] = last;
      last.list_index = order.list_index;
    }
  }

  // Cuántos lugares de muro hay en servicio
  wall_slot_total() {
    return this.walls.reduce((sum, wall) => (wall.enabled ? sum + wall.slots.filter((slot) => slot.enabled).length : sum), 0);
  }

  // Cuántos pedidos ya soltados siguen ocupando o van a ocupar una casilla de muro: los que están en picking, en consolidación o
  // completos con casilla. Se lleva una lista aparte de los soltados (son pocos) y se limpia aquí.
  released_count() {
    this.released_orders = this.released_orders.filter((order) => {
      const state = order.machine.state;
      return state === "CREATED" || state === "PICKING" || state === "CONSOLIDATING" || (state === "COMPLETE" && order.slot);
    });
    return this.released_orders.length;
  }

  // Suelta a los operarios los pedidos que ya se pueden atender: todos sus productos están en el activo (sin contar lo que ya esperan
  // las líneas de pedidos soltados) y queda un lugar en los muros para ellos. Un pedido que espera un producto que el activo no tiene
  // no ocupa casilla con sus primeras cajas, y nunca hay más pedidos empezados que lugares en los muros: así los muros no se llenan de
  // pedidos incompletos y la banda no se atasca por mucho que se pida. Aquí también se cuentan las líneas que esperan existencias.
  release_orders(now) {
    if (this.pending.length === 0) {
      this.waiting_by_sku.fill(0);
      return;
    }
    // Revisar los pedidos que esperan una vez por segundo simulado basta (y evita recorrerlos en cada paso)
    if (now - this.last_release_at < RELEASE_INTERVAL_SECONDS) return;
    this.last_release_at = now;
    this.waiting_by_sku.fill(0);
    const { storage } = this.sim;
    const slots = this.wall_slot_total();
    let started = this.released_count();
    const kept = [];
    let scanned = 0;
    for (let index = 0; index < this.pending.length; index += 1) {
      const order = this.pending[index];
      if (scanned >= RELEASE_SCAN_LIMIT) {
        for (let rest = index; rest < this.pending.length; rest += 1) kept.push(this.pending[rest]);
        break;
      }
      scanned += 1;
      const needed = new Map();
      order.lines.forEach((line) => needed.set(line.sku_id, (needed.get(line.sku_id) || 0) + 1));
      let in_stock = true;
      needed.forEach((count, sku_id) => {
        if (storage.available(sku_id) - this.queued_by_sku[sku_id] < count) in_stock = false;
      });
      if (!in_stock) {
        // Las líneas que no tienen existencias en el activo esperan (y de ahí se pide el reabasto)
        order.lines.forEach((line) => {
          if (storage.available(line.sku_id) - this.queued_by_sku[line.sku_id] >= 1) return;
          this.waiting_by_sku[line.sku_id] += 1;
          if (line.machine.state === "PENDING") {
            line.machine.go_to("WAITING_STOCK", now);
            line.waiting_since = now;
          }
        });
      }
      if (in_stock && started < slots) {
        started += 1;
        order.released = true;
        this.released_orders.push(order);
        order.lines.forEach((line) => {
          this.queued_by_sku[line.sku_id] += 1;
          this.line_queue.push(line);
        });
      } else {
        kept.push(order);
      }
    }
    this.pending = kept;
  }

  // Crea un pedido. Si no se dan los productos, el cliente quiere unos al azar (de los que tienen lugar en el activo): el coordinador
  // de recibo anota que se pidieron, y el pedido lleva solo los que el activo tiene; si no tiene ninguno, no se crea nada.
  create_order(now, sku_ids, replaces = null) {
    const { sim } = this;
    let skus = sku_ids;
    if (!skus) {
      if (this.backlog_full()) {
        sim.counters.orders_rejected += 1;
        return null;
      }
      const wanted = [];
      for (let sku = 0; sku < SKUS.length; sku += 1) {
        // Un producto sin lugar en el activo no se puede recoger, así que no se pide
        if (sim.storage.sku_capacity(sku) > 0) wanted.push(sku);
      }
      if (wanted.length === 0) return null;
      const count = Math.min(wanted.length, sim.rng_orders.int(1, sim.config.get("max_order_lines")));
      const chosen = sim.rng_orders.shuffle(wanted).slice(0, count);
      chosen.forEach((sku) => sim.coordinator.register_demand(sku, now));
      skus = chosen.filter((sku) => this.orderable_boxes(sku) > 0);
      sim.counters.lines_unfilled += chosen.length - skus.length;
      if (skus.length === 0) return null;
    }
    const order = new Order(sim.next_id("order"), skus, now);
    order.replaces = replaces;
    order.destination = this.pick_destination();
    this.assign_cutoff(order, now);
    order.list_index = this.orders.length;
    this.orders.push(order);
    this.pending.push(order);
    order.lines.forEach((line) => {
      this.unpicked_by_sku[line.sku_id] += 1;
    });
    sim.counters.orders_created += 1;
    sim.emit({ type: "order_created", order });
    return order;
  }

  // ---------- Destino y corte ----------
  // Una ciudad de Colombia con acceso por carretera, al azar y con más peso para las ciudades grandes
  pick_destination() {
    let pick = this.sim.rng_order_destinations.float(0, DESTINATION_WEIGHT_TOTAL);
    for (const destination of DESTINATIONS) {
      pick -= destination.weight;
      if (pick < 0) return destination;
    }
    return DESTINATIONS[DESTINATIONS.length - 1];
  }

  set_cutoff(order, time) {
    order.cutoff_at = time;
    order.cutoff_text = this.sim.format_time(time);
  }

  // El corte que le toca a un pedido que cae ahora: el primero a más de 60 minutos
  assign_cutoff(order, now) {
    order.promised_cutoff = assigned_cutoff(now, this.sim.yard.cutoffs);
    this.set_cutoff(order, order.promised_cutoff);
  }

  // Un pedido que no estaba listo a su hora de corte pierde el corte: es un envío tardío y sale en el siguiente
  mark_late(order, now) {
    order.late = true;
    this.set_cutoff(order, next_cutoff_after(now, this.sim.yard.cutoffs, 0));
  }

  // La persona cambió las horas de corte: los pedidos sin enviar toman el corte que les toca con las horas nuevas
  reassign_cutoffs(now) {
    const { cutoffs } = this.sim.yard;
    this.orders.forEach((order) => {
      if (order.late) {
        this.set_cutoff(order, next_cutoff_after(now, cutoffs, 0));
        return;
      }
      order.promised_cutoff = assigned_cutoff(order.created_at, cutoffs);
      if (order.promised_cutoff <= now) this.mark_late(order, now);
      else this.set_cutoff(order, order.promised_cutoff);
    });
  }

  // ---------- Stock y líneas ----------
  waiting_lines(sku_id) {
    return this.waiting_by_sku[sku_id];
  }

  // Llegó stock de un SKU: nada que hacer aquí, los operarios lo ven en su siguiente búsqueda
  on_stock_added() {}

  mark_progress(order, now) {
    order.last_progress_at = now;
  }

  // ---------- Operarios de picking ----------
  sync_pickers(now) {
    const wanted = this.sim.config.get("pickers_per_floor");
    // Con muchos operarios, revisar las listas en cada paso cuesta: solo se revisan si cambió la cantidad o si alguno se está retirando
    if (wanted === this.wanted_pickers && !this.pickers.some((list) => list.some((worker) => worker.retiring))) return;
    this.wanted_pickers = wanted;
    for (let floor = 0; floor < ACTIVE.floors; floor += 1) {
      const list = this.pickers[floor];
      const active = list.filter((worker) => !worker.retiring);
      for (let index = active.length; index < wanted; index += 1) this.add_picker(floor, list.length, now);
      for (let index = active.length - 1; index >= wanted; index -= 1) active[index].retiring = true;
      this.pickers[floor] = list.filter((worker) => !(worker.retiring && !worker.is_busy && worker.machine.state === "IDLE"));
    }
  }

  add_picker(floor, slot, now) {
    const { sim } = this;
    const picker = new Worker(sim.next_id("worker"), "picker", now);
    picker.floor = floor;
    const y = floor_y(floor) + ACTIVE.slab_thickness;
    picker.home = { x: ACTIVE.x0 + 1.2 + (slot % 3) * 1.1, y, z: ACTIVE.belt_z + PICKER_HOME_OFFSET_Z };
    picker.teleport(picker.home.x, y, picker.home.z, 0);
    this.pickers[floor].push(picker);
  }

  // Cada picker libre toma la primera línea que tenga stock disponible en su piso
  assign_lines(now) {
    const { sim } = this;
    const queue = this.line_queue;
    if (queue.length === 0) return;
    // Las líneas sin stock en ningún piso pasan a esperar (y de ahí se pide el reabasto)
    queue.forEach((line) => {
      if (line.machine.state === "PENDING" && sim.storage.available(line.sku_id) <= 0) {
        line.machine.go_to("WAITING_STOCK", now);
        line.waiting_since = now;
      }
    });
    for (let floor = 0; floor < ACTIVE.floors; floor += 1) {
      for (const picker of this.pickers[floor]) {
        if (picker.is_busy || picker.retiring || queue.length === 0) continue;
        const position = queue.findIndex((line) => sim.storage.available_on_floor(line.sku_id, floor) > 0);
        if (position < 0) break;
        const line = queue.splice(position, 1)[0];
        this.queued_by_sku[line.sku_id] -= 1;
        this.unpicked_by_sku[line.sku_id] -= 1;
        this.start_pick(picker, line, now);
      }
    }
  }

  start_pick(picker, line, now) {
    const { sim } = this;
    const box = sim.storage.reserve_box(line.sku_id, picker.floor);
    if (line.machine.state === "WAITING_STOCK") line.waiting_since = null;
    line.box = box;
    box.line = line;
    box.order = line.order;
    const order = line.order;
    if (order.machine.state === "CREATED") order.machine.go_to("PICKING", now);
    this.mark_progress(order, now);
    picker.order = order;
    picker.current_line = line;
    picker.machine.go_to("WALKING_TO_SLOT", now);

    const belt = this.floor_belts[picker.floor];
    const belt_x = Math.min(ACTIVE.x1 - 1, Math.max(ACTIVE.x0 + 0.5, box.x));
    const belt_s = belt_x - ACTIVE.x0;
    const y = floor_y(picker.floor) + ACTIVE.slab_thickness;
    picker.start_script([
      { do: "drive", points: [{ x: box.x, y, z: box.aisle_z }], speed: WALK_SPEED },
      { do: "call", fn: (time) => picker.machine.go_to("PICKING", time) },
      { do: "wait", seconds: PICK_SECONDS },
      {
        do: "call",
        fn: (time) => {
          sim.storage.remove_from_active(box);
          box.machine.go_to("PICKED", time);
          picker.carried = [box];
          picker.machine.go_to("PLACING_ON_BELT", time);
        },
      },
      { do: "drive", points: [{ x: belt_x, y, z: ACTIVE.belt_z + 0.8 }], speed: WALK_SPEED },
      { do: "until", test: () => belt.has_space_at(belt_s, box.belt_length) },
      {
        do: "call",
        fn: (time) => {
          picker.carried = [];
          box.machine.go_to("ON_FLOOR_BELT", time);
          belt.try_insert(box, belt_s, time);
          line.machine.go_to("PICKED", time);
          this.mark_progress(order, time);
          picker.order = null;
          picker.current_line = null;
          picker.machine.go_to("IDLE", time);
        },
      },
      { do: "drive", points: [{ x: picker.home.x, y, z: picker.home.z }], speed: WALK_SPEED },
    ]);
  }

  // ---------- De la banda de piso a la principal ----------
  merge_into_main(belt, box, now) {
    if (!this.main.has_space_at(belt.entry_s, box.belt_length)) return false;
    box.machine.go_to("ON_MAIN_BELT", now);
    this.main.try_insert(box, belt.entry_s, now);
    return true;
  }

  // ---------- Muros de consolidación ----------
  zone_gate(box, now) {
    const order = box.order;
    if (!order || order.slot) return "pass";
    const slot = this.find_free_slot();
    if (!slot) {
      this.saw_waiting_box = true;
      if (this.jam_started_at === null) {
        this.jam_started_at = now;
        this.jam_box = box;
      }
      return "hold";
    }
    slot.machine.go_to("ASSIGNED", now);
    slot.order = order;
    order.slot = slot;
    if (order.machine.state === "PICKING") order.machine.go_to("CONSOLIDATING", now);
    this.mark_progress(order, now);
    return "pass";
  }

  // La casilla libre del muro más cercano en el sentido de la banda (primero las filas de arriba)
  find_free_slot() {
    for (const wall of this.walls) {
      if (!wall.enabled) continue;
      for (const slot of wall.slots) {
        if (slot.enabled && slot.machine.state === "FREE") return slot;
      }
    }
    return null;
  }

  row_gate(box, row) {
    const slot = box.order && box.order.slot;
    if (!slot || slot.wall.row !== row) return "pass";
    this.put_in_slot(box, slot, this.sim.now);
    return "take";
  }

  put_in_slot(box, slot, now) {
    const order = box.order;
    box.machine.go_to("IN_WALL_SLOT", now);
    box.container = slot;
    slot.boxes.push(box);
    box.line.machine.go_to("AT_WALL", now);
    this.mark_progress(order, now);
    // Las cajas de una casilla se apilan una al lado de la otra
    const index = slot.boxes.length - 1;
    box.set_position(slot.position.x, slot.position.y + 0.3, slot.position.z + (index % 3 - 1) * 0.2, 0);
    if (slot.boxes.length === order.lines.length) {
      slot.machine.go_to("COMPLETE", now);
      order.machine.go_to("COMPLETE", now);
      this.sim.emit({ type: "order_complete", order });
    }
  }

  // Habilita o cierra muros y casillas según los sliders
  sync_walls() {
    const { config } = this.sim;
    const wall_count = config.get("wall_count");
    const slot_count = config.get("slots_per_wall");
    this.walls.forEach((wall, index) => {
      wall.enabled = index < wall_count;
      wall.slots.forEach((slot, slot_index) => {
        slot.enabled = wall.enabled && slot_index < slot_count;
      });
    });
  }

  // ---------- Cancelar un pedido ----------
  // Devuelve { ok, order, new_order }. Un pedido ya completo, empacado o despachado no se puede cancelar.
  cancel_order(order_id, reprocess, now) {
    const { sim } = this;
    const order = this.orders.find((candidate) => candidate.id === order_id);
    if (!order || !order.is_cancellable) return { ok: false };
    const sku_ids = order.lines.map((line) => line.sku_id);
    this.pending = this.pending.filter((candidate) => candidate !== order);

    order.lines.forEach((line) => {
      // Líneas que todavía esperan un operario o stock
      // Una línea que no llegó a apartar caja deja de contar como pendiente
      if (!line.box) {
        const queued = this.line_queue.indexOf(line);
        if (queued >= 0) {
          this.line_queue.splice(queued, 1);
          this.queued_by_sku[line.sku_id] -= 1;
        }
        this.unpicked_by_sku[line.sku_id] -= 1;
      }
      const box = line.box;
      if (!box) return;
      const state = box.machine.state;
      if (state === "IN_ACTIVE" || state === "PICKED") {
        // Un operario va a recogerla o ya la lleva en la mano: deja lo que hacía
        this.pickers.flat().forEach((picker) => {
          if (picker.current_line === line) {
            picker.abort_script();
            picker.carried = [];
            picker.order = null;
            picker.current_line = null;
            if (picker.machine.state !== "IDLE") picker.machine.go_to("IDLE", now);
          }
        });
        // Apartada pero todavía en su sitio: se libera el apartado; en la mano: vuelve al activo
        if (state === "IN_ACTIVE") sim.storage.unreserve_box(box);
        else this.return_box(box, now);
      } else if (state === "ON_FLOOR_BELT" || state === "ON_MAIN_BELT") {
        if (box.belt) box.belt.remove(box);
        this.return_box(box, now);
      } else if (state === "IN_WALL_SLOT") {
        const slot = box.container;
        if (slot) slot.boxes = slot.boxes.filter((candidate) => candidate !== box);
        this.return_box(box, now);
      }
      line.box = null;
    });

    // Su casilla queda libre, y la caja que esperaba en la banda la toma
    const slot = order.slot;
    if (slot) {
      slot.order = null;
      slot.boxes = [];
      slot.machine.go_to("FREE", now);
      order.slot = null;
    }
    order.machine.go_to("CANCELLED", now);
    sim.counters.orders_cancelled += 1;
    sim.emit({ type: "order_cancelled", order });

    let new_order = null;
    if (reprocess) {
      new_order = this.create_order(now, sku_ids, order.id);
      // Es el mismo cliente: el pedido reprocesado va al mismo destino
      if (new_order) new_order.destination = order.destination;
    }
    this.remove_order(order);
    sim.finished_orders.push(order);
    return { ok: true, order, new_order };
  }

  // Una caja deja el pedido: desaparece con un destello y vuelve al stock del activo
  return_box(box, now) {
    const { sim } = this;
    sim.effects.push({ type: "flash", x: box.x, y: box.y, z: box.z, born: now });
    sim.storage.add_to_active(box, now, box.home_floor, true);
  }

  // ---------- Un paso ----------
  step(now, dt) {
    this.sync_pickers(now);
    this.sync_walls();
    this.release_orders(now);
    this.assign_lines(now);
    this.pickers.flat().forEach((picker) => picker.update(dt, now));
  }

  // Las bandas se mueven después de que todos decidieron; las de piso se turnan para entrar a la principal
  update_belts(dt, now) {
    this.saw_waiting_box = false;
    this.main.update(dt, now);
    const count = this.floor_belts.length;
    for (let offset = 0; offset < count; offset += 1) this.floor_belts[(this.merge_start + offset) % count].update(dt, now);
    this.merge_start = (this.merge_start + 1) % count;
    if (!this.saw_waiting_box) {
      this.jam_started_at = null;
      this.jam_box = null;
    }
  }

  get wall_jam_active() {
    return this.jam_started_at !== null && this.sim.now - this.jam_started_at >= WALL_JAM_SECONDS;
  }
}
