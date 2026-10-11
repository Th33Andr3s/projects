// Pedidos: se crean con una tasa al azar, cada línea la recoge un operario del piso de su SKU y la pone en la banda de ese piso;
// las bandas de piso bajan por la espiral hasta la banda principal, que pasa por los muros de consolidación. Aquí también vive
// la acción de la persona administradora de cancelar un pedido (y reprocesarlo).
//
// Regla de los muros: la primera caja de un pedido que llega a la zona de muros toma una casilla libre. Si no hay ninguna, la
// caja se queda en la banda aunque eso atasque a las que vienen detrás; el atasco se avisa pero no se resuelve solo.

import { ORDER_SPIKE_FACTOR, SKU_COUNT, WALL_JAM_SECONDS, sku_floor } from "./config.js";
import { Belt } from "./belts.js";
import { Order, Wall, Worker } from "./entities.js";
import { ACTIVE, floor_y, sku_anchor } from "./layout.js";
import { project_on_path } from "./path_tools.js";

const PICK_SECONDS = 1.5;
const WALK_SPEED = 1.4;
// Dónde se paran los operarios de picking junto a la banda: a este lado del eje
const PICKER_HOME_OFFSET_Z = 1.3;
// La posición donde empieza la zona de muros: antes de la primera casilla de la primera fila
const WALL_ZONE_Z = -11.8;

export class OrdersSystem {
  constructor(sim) {
    this.sim = sim;
    const { layout, paths } = sim;

    this.orders = [];
    // Las líneas que esperan un operario, por piso y en orden de llegada
    this.floor_queues = Array.from({ length: ACTIVE.floors }, () => []);
    this.pickers = Array.from({ length: ACTIVE.floors }, () => []);
    this.pending_order_event = null;

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
    const rate = this.order_rate_per_second();
    const interval = -Math.log(1 - sim.rng_orders.next()) / rate;
    this.pending_order_event = { time: now + interval, id: sim.events.schedule(now + interval, "order_created") };
  }

  // Cuando cambia la tasa (slider o pico de pedidos) se vuelve a sortear el próximo pedido
  reschedule(now) {
    if (this.pending_order_event) this.sim.events.cancel(this.pending_order_event.id);
    this.schedule_next_order(now);
  }

  on_order_event(now) {
    this.create_order(now, null);
    this.schedule_next_order(now);
  }

  create_order(now, sku_ids, replaces = null) {
    const { sim } = this;
    let skus = sku_ids;
    if (!skus) {
      const count = sim.rng_orders.int(1, sim.config.get("max_order_lines"));
      skus = sim.rng_orders.shuffle(Array.from({ length: SKU_COUNT }, (_, sku) => sku)).slice(0, count);
    }
    const order = new Order(sim.next_id("order"), skus, now);
    order.replaces = replaces;
    this.orders.push(order);
    order.lines.forEach((line) => this.floor_queues[sku_floor(line.sku_id)].push(line));
    sim.counters.orders_created += 1;
    sim.emit({ type: "order_created", order });
    return order;
  }

  // ---------- Stock y líneas ----------
  waiting_lines(sku_id) {
    let total = 0;
    for (const queue of this.floor_queues) {
      for (const line of queue) {
        if (line.sku_id === sku_id && line.machine.state === "WAITING_STOCK") total += 1;
      }
    }
    return total;
  }

  // Llegó stock de un SKU: nada que hacer aquí, los operarios lo ven en su siguiente búsqueda
  on_stock_added() {}

  mark_progress(order, now) {
    order.last_progress_at = now;
  }

  // ---------- Operarios de picking ----------
  sync_pickers(now) {
    const wanted = this.sim.config.get("pickers_per_floor");
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

  // Cada picker libre toma la primera línea de su piso que tenga stock disponible
  assign_lines(now) {
    const { sim } = this;
    for (let floor = 0; floor < ACTIVE.floors; floor += 1) {
      const queue = this.floor_queues[floor];
      // Las líneas sin stock pasan a esperar (y de ahí se pide el reabasto)
      queue.forEach((line) => {
        if (line.machine.state === "PENDING" && sim.storage.available(line.sku_id) <= 0) {
          line.machine.go_to("WAITING_STOCK", now);
          line.waiting_since = now;
        }
      });
      for (const picker of this.pickers[floor]) {
        if (picker.is_busy || picker.retiring || queue.length === 0) continue;
        const position = queue.findIndex((line) => sim.storage.available(line.sku_id) > 0);
        if (position < 0) break;
        const line = queue.splice(position, 1)[0];
        this.start_pick(picker, line, now);
      }
    }
  }

  start_pick(picker, line, now) {
    const { sim } = this;
    const box = sim.storage.reserve_box(line.sku_id);
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

    const anchor = sku_anchor(line.sku_id);
    const belt = this.floor_belts[picker.floor];
    const belt_x = Math.min(ACTIVE.x1 - 1, Math.max(ACTIVE.x0 + 0.5, box.x));
    const belt_s = belt_x - ACTIVE.x0;
    const y = floor_y(picker.floor) + ACTIVE.slab_thickness;
    picker.start_script([
      { do: "drive", points: [{ x: box.x, y, z: anchor.aisle_z }], speed: WALK_SPEED },
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

    order.lines.forEach((line) => {
      // Líneas que todavía esperan un operario o stock
      const queue = this.floor_queues[sku_floor(line.sku_id)];
      const queued = queue.indexOf(line);
      if (queued >= 0) queue.splice(queued, 1);
      const box = line.box;
      if (!box) return;
      const state = box.machine.state;
      if (state === "IN_ACTIVE") {
        // Apartada pero todavía en su sitio: se libera el apartado
        sim.storage.unreserve_box(box);
      } else if (state === "PICKED") {
        // La lleva un operario en la mano
        this.pickers.flat().forEach((picker) => {
          if (picker.current_line === line) {
            picker.abort_script();
            picker.carried = [];
            picker.order = null;
            picker.current_line = null;
            if (picker.machine.state !== "IDLE") picker.machine.go_to("IDLE", now);
          }
        });
        this.return_box(box, now);
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
    if (reprocess) new_order = this.create_order(now, sku_ids, order.id);
    this.orders = this.orders.filter((candidate) => candidate !== order);
    sim.finished_orders.push(order);
    return { ok: true, order, new_order };
  }

  // Una caja deja el pedido: desaparece con un destello y vuelve al stock del activo
  return_box(box, now) {
    const { sim } = this;
    sim.effects.push({ type: "flash", x: box.x, y: box.y, z: box.z, born: now });
    sim.storage.add_to_active(box, now, true);
  }

  // ---------- Un paso ----------
  step(now, dt) {
    this.sync_pickers(now);
    this.sync_walls();
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
