// Las cosas que existen en la bodega: cajas, pallets, cubetas, paquetes, camiones, montacargas, personas, pedidos, casillas de
// muro, estaciones, puertas y el elevador. Cada una lleva su máquina de estados (ver state_machines.js), su posición para
// dibujarla y un `get_info` con lo que muestra el panel de inspección.
//
// La posición de lo que se mueve se guarda dos veces, la del paso anterior y la actual: el dibujo interpola entre las dos y
// así el movimiento se ve continuo aunque la simulación avance en pasos de 0,25 s.

import { StateMachine } from "./state_machines.js";
import { make_path, sample_path } from "./path_tools.js";
import { sku_floor } from "./config.js";
import { SKUS, sku_category, sku_label } from "./catalog.js";

// El número del paso de simulación en curso (lo pone Simulation.step). Con él se sabe si algo se movió en este paso: lo que no se
// movió se dibuja quieto en su lugar; si se interpolara con una posición anterior vieja, "bailaría" entre las dos al repetirse
// la fracción del paso en cada cuadro (era el titileo de camiones parados, cajas detenidas y montacargas esperando).
export const step_clock = { current: 0 };

export class Renderable {
  constructor(kind, id) {
    this.kind = kind;
    this.id = id;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.yaw = 0;
    this.prev_x = 0;
    this.prev_y = 0;
    this.prev_z = 0;
    this.prev_yaw = 0;
    this.moved_step = -1;
  }

  // ¿Se movió en el último paso de la simulación? Solo entonces tiene sentido interpolar desde la posición anterior
  get moved_this_step() {
    return this.moved_step === step_clock.current;
  }

  set_position(x, y, z, yaw = this.yaw) {
    this.moved_step = step_clock.current;
    this.prev_x = this.x;
    this.prev_y = this.y;
    this.prev_z = this.z;
    this.prev_yaw = this.yaw;
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
  }

  // Cambia de lugar sin que el dibujo recorra el camino entre los dos puntos
  teleport(x, y, z, yaw = this.yaw) {
    this.moved_step = -1;
    this.x = this.prev_x = x;
    this.y = this.prev_y = y;
    this.z = this.prev_z = z;
    this.yaw = this.prev_yaw = yaw;
  }
}

// Cómo se cuenta el tiempo en un estado para el panel: "1 min 5 s"
export function describe_duration(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < 60) return `${whole} s`;
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes} min ${whole % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function info(entity, type, destination, now, extra = []) {
  return {
    type,
    id_text: `${type} ${entity.id}`,
    state: entity.machine ? entity.machine.label : "",
    destination: destination || "—",
    order: entity.order ? `#${entity.order.id}` : "—",
    time_in_state: entity.machine ? describe_duration(entity.machine.time_in_state(now)) : "—",
    extra,
  };
}

// ---------- Cajas ----------
export class Box extends Renderable {
  constructor(id, sku_id, now) {
    super("box", id);
    this.sku_id = sku_id;
    this.machine = new StateMachine("box", now);
    this.order = null;
    this.line = null;
    // Contenedor donde está: pallet, cubeta, casilla de muro...
    this.container = null;
    // Posición dentro del activo (0 a 59) o -1
    this.slot_index = -1;
    // Está apartada para una línea de pedido pero todavía en su sitio del activo
    this.reserved = false;
    // El producto define cuántas unidades lleva la caja y cuánto mide (largo, alto, fondo en metros)
    this.units = SKUS[sku_id].units_per_box;
    this.size = SKUS[sku_id].size;
    // El camión que la trajo (ninguno si venía del inventario inicial)
    this.truck = null;
    this.belt_length = this.size[0] + 0.1;
    this.s = 0;
    this.gate_index = 0;
    this.belt = null;
    this.created_at = now;
  }

  get_info(now) {
    const destinations = {
      IN_TRUCK: "Rieles de recibo",
      ON_RAIL: "Pallet de descarga del muelle",
      ON_DOCK_PALLET: "Bodega de recibo",
      IN_STAGING: "Pallet o cubeta",
      ON_PALLET: "Racks de reserva",
      IN_RESERVE: "Multinivel activo (si hace falta reabasto)",
      IN_TOTE: "Elevador y piso de su SKU",
      IN_ACTIVE: "Esperando un pedido",
      PICKED: "Banda del piso",
      ON_FLOOR_BELT: "Banda principal",
      ON_MAIN_BELT: "Casilla de su pedido",
      IN_WALL_SLOT: "Cubeta del pedido",
      IN_ORDER_TOTE: "Estación de empaque",
      PACKING: "Caja sellada",
      PACKED: "Puerta de despacho",
      ON_DISPATCH_BELT: "Pila de despacho de su destino",
      IN_DISPATCH_BIN: "Camión de su destino en el corte",
      LOADED: "Salida del camión",
      SHIPPED: "Entregada",
    };
    const truck = this.truck;
    return info(this, "Caja", destinations[this.machine.state], now, [
      ["Número de caja", String(this.id)],
      ["SKU", sku_label(this.sku_id)],
      ["Categoría", `${sku_category(this.sku_id).name} (piso ${sku_floor(this.sku_id) + 1})`],
      ["Unidades en la caja", String(this.units)],
      ["Lugar de procedencia", truck ? `${truck.route.city} · Región ${truck.route.region}` : "Inventario inicial"],
      ["Camión asociado", truck ? `Camión ${truck.id}` : "—"],
      ["Unidades que trae el camión", truck ? String(truck.units) : "—"],
    ]);
  }
}

// ---------- Pallets y cubetas ----------
export class Pallet extends Renderable {
  constructor(id, sku_id, capacity, now) {
    super("pallet", id);
    this.sku_id = sku_id;
    this.capacity = capacity;
    this.boxes = [];
    this.machine = new StateMachine("pallet", now);
    this.last_added_at = now;
    // Dónde está: puesto de formación en recibo o ubicación de la reserva
    this.spot_index = -1;
    this.reserve_index = -1;
    this.order = null;
    // Un pallet de descarga lleva cajas de varios productos del mismo camión, del muelle a la bodega de recibo
    this.mixed = false;
    this.dock_index = -1;
  }

  get_info(now) {
    if (this.mixed) {
      const destinations = { FORMING: "Esperando una montacarga de muelle a stock", READY: "Bodega de recibo", CARRIED: "Bodega de recibo", DELIVERED: "—" };
      return info(this, "Pallet de descarga", destinations[this.machine.state] || "—", now, [
        ["Muelle", this.dock_index >= 0 ? String(this.dock_index + 1) : "—"],
        ["Cajas", `${this.boxes.length} de ${this.capacity}`],
      ]);
    }
    const destinations = {
      FORMING: "Esperando una montacarga",
      READY: "Racks de reserva",
      CARRIED: "Racks de reserva",
      IN_RESERVE: "Reserva (hasta que haga falta)",
      CARRIED_TO_REPLENISH: "Pie del multinivel",
      UNPACKED: "—",
    };
    return info(this, "Pallet", destinations[this.machine.state], now, [
      ["Producto", sku_label(this.sku_id)],
      ["Cajas", `${this.boxes.length} de ${this.capacity}`],
    ]);
  }
}

export class Tote extends Renderable {
  // variant: "in" (cubeta de entrada, sube al activo) u "out" (cubeta de un pedido, va a empaque)
  constructor(id, variant, now) {
    super("tote", id);
    this.variant = variant;
    this.machine = new StateMachine(variant === "in" ? "tote_in" : "tote_out", now);
    this.boxes = [];
    this.floor = -1;
    this.order = null;
    this.capacity = 6;
    this.last_added_at = now;
    this.belt_length = 1.1;
    this.s = 0;
    this.gate_index = 0;
    this.belt = null;
  }

  get_info(now) {
    const destination = this.variant === "in" ? (this.floor >= 0 ? `Piso ${this.floor + 1} del activo` : "Activo") : "Empaque";
    return info(this, this.variant === "in" ? "Cubeta de entrada" : "Cubeta de pedido", destination, now, [["Cajas", String(this.boxes.length)]]);
  }
}

// El paquete sellado en que se convierte la cubeta de un pedido al empacarse
export class Parcel extends Renderable {
  constructor(id, order, boxes) {
    super("parcel", id);
    this.order = order;
    this.boxes = boxes;
    this.door = null;
    this.belt_length = 0.95;
    this.s = 0;
    this.gate_index = 0;
    this.belt = null;
    // Se pone al empacar: para el panel de inspección
    this.machine = null;
  }

  get_info(now) {
    return info(this, "Paquete", this.door ? `Puerta ${this.door.index + 1}` : "Despacho", now, [["Cajas", String(this.boxes.length)]]);
  }
}

// ---------- Quien se mueve: camiones, montacargas y personas ----------
// Un Actor sigue un guion: una lista de pasos que hace uno tras otro. Los pasos que no gastan tiempo (call) se encadenan en
// el mismo cuadro; los demás consumen el tiempo del paso y pasan lo que sobra al siguiente.
//   { do: "drive", points, speed, reverse }  recorre los puntos (parte de donde está)
//   { do: "turn", yaw, seconds }             gira en el lugar
//   { do: "lift", to, seconds }              sube o baja la horquilla
//   { do: "wait", seconds }                  espera
//   { do: "until", test }                    espera hasta que test() sea verdadero
//   { do: "call", fn }                       ejecuta fn(ahora) sin gastar tiempo
const TURN_RATE = 2.6;

function approach_angle(current, target, max_step) {
  let difference = (target - current) % (Math.PI * 2);
  if (difference > Math.PI) difference -= Math.PI * 2;
  else if (difference < -Math.PI) difference += Math.PI * 2;
  if (Math.abs(difference) <= max_step) return target;
  return current + Math.sign(difference) * max_step;
}

export class Actor extends Renderable {
  constructor(kind, id, machine_type, speed, now) {
    super(kind, id);
    this.machine = new StateMachine(machine_type, now);
    this.speed = speed;
    this.script = [];
    this.cursor = 0;
    this.entered = false;
    this.timer = 0;
    this.drive_path = null;
    this.drive_s = 0;
    this.drive_reverse = false;
    // Hasta dónde puede avanzar por el camino actual (distancia recorrida): así un camión no pisa al que va delante en una fila
    this.s_limit = null;
    this.turn_from = 0;
    this.turn_total = 0;
    this.lift_from = 0;
    this.lift_total = 0;
    this.fork_height = 0;
    this.is_reversing = false;
    // Lo que lleva: se mueve con el actor (pallets, cajas, cubetas)
    this.carried = [];
    this.carry_forward = 1.0;
    this.carry_up = 0.2;
    this.on_idle = null;
    this.scratch = { x: 0, y: 0, z: 0, yaw: 0 };
    this.busy_seconds = 0;
  }

  get is_busy() {
    return this.script.length > 0;
  }

  start_script(steps) {
    this.script = steps;
    this.cursor = 0;
    this.entered = false;
    this.is_reversing = false;
  }

  abort_script() {
    this.script = [];
    this.cursor = 0;
    this.entered = false;
    this.is_reversing = false;
  }

  enter_step(step) {
    if (step.do === "drive") {
      const start = { x: this.x, y: this.y, z: this.z };
      const points = [start, ...step.points.map((point) => ({ x: point.x, y: point.y === undefined ? this.y : point.y, z: point.z }))];
      this.drive_path = make_path(points);
      this.drive_s = 0;
      this.s_limit = null;
      this.drive_reverse = Boolean(step.reverse);
      this.is_reversing = this.drive_reverse;
      this.scratch.yaw = this.yaw;
    } else if (step.do === "turn") {
      this.timer = 0;
      this.turn_from = this.yaw;
      this.turn_total = Math.max(0.01, step.seconds);
    } else if (step.do === "lift") {
      this.timer = 0;
      this.lift_from = this.fork_height;
      this.lift_total = Math.max(0.01, step.seconds);
    } else if (step.do === "wait") {
      this.timer = step.seconds;
    }
  }

  // Avanza el paso actual con `remaining` segundos. Devuelve lo que sobró si lo terminó, o -1 si sigue.
  run_step(step, remaining, now) {
    switch (step.do) {
      case "call":
        step.fn(now);
        return remaining;
      case "wait":
        this.timer -= remaining;
        return this.timer <= 0 ? -this.timer : -1;
      case "until":
        return step.test() ? remaining : -1;
      case "turn": {
        this.timer += remaining;
        const fraction = Math.min(1, this.timer / this.turn_total);
        const eased = fraction * fraction * (3 - 2 * fraction);
        let difference = (step.yaw - this.turn_from) % (Math.PI * 2);
        if (difference > Math.PI) difference -= Math.PI * 2;
        else if (difference < -Math.PI) difference += Math.PI * 2;
        this.set_position(this.x, this.y, this.z, this.turn_from + difference * eased);
        return fraction >= 1 ? this.timer - this.turn_total : -1;
      }
      case "lift": {
        this.timer += remaining;
        const fraction = Math.min(1, this.timer / this.lift_total);
        this.fork_height = this.lift_from + (step.to - this.lift_from) * fraction;
        return fraction >= 1 ? this.timer - this.lift_total : -1;
      }
      case "drive": {
        const speed = step.speed || this.speed;
        const path = this.drive_path;
        const distance = speed * remaining;
        const reach = this.s_limit === null ? path.length : Math.min(path.length, Math.max(this.drive_s, this.s_limit));
        const finished = reach >= path.length - 1e-9 && this.drive_s + distance >= path.length - 1e-9;
        const next_s = finished ? path.length : Math.min(this.drive_s + distance, reach);
        const used = finished ? (path.length - this.drive_s) / speed : remaining;
        this.drive_s = next_s;
        sample_path(path, next_s, this.scratch);
        // Mira hacia donde avanza (o al revés si va en reversa) y gira con suavidad en las esquinas
        const heading = this.scratch.yaw + (this.drive_reverse ? Math.PI : 0);
        const yaw = approach_angle(this.yaw, heading, TURN_RATE * Math.max(used, 0.05));
        this.set_position(this.scratch.x, this.scratch.y, this.scratch.z, yaw);
        return finished ? remaining - used : -1;
      }
      default:
        throw new Error(`Paso desconocido: ${step.do}`);
    }
  }

  update(dt, now) {
    if (this.script.length === 0) return;
    this.busy_seconds += dt;
    let remaining = dt;
    for (let guard = 0; guard < 64; guard += 1) {
      const step = this.script[this.cursor];
      if (!step) {
        this.script = [];
        this.cursor = 0;
        this.is_reversing = false;
        if (this.on_idle) this.on_idle(now);
        break;
      }
      if (!this.entered) {
        this.enter_step(step);
        this.entered = true;
      }
      const script_before = this.script;
      const left = this.run_step(step, remaining, now);
      if (left < 0) break;
      remaining = left;
      // Un guion nuevo (o ninguno) puesto desde dentro de un paso (call) reemplaza al actual y empieza desde su primer paso
      if (this.script !== script_before) continue;
      this.cursor += 1;
      this.entered = false;
    }
    this.update_carried();
  }

  update_carried() {
    if (this.carried.length === 0) return;
    const forward_x = Math.cos(this.yaw) * this.carry_forward;
    const forward_z = -Math.sin(this.yaw) * this.carry_forward;
    this.carried.forEach((item, index) => {
      item.set_position(this.x + forward_x, this.y + this.carry_up + this.fork_height + index * 0.0, this.z + forward_z, this.yaw);
    });
  }
}

// ---------- Camiones ----------
export class Truck extends Actor {
  // role: "receiving" (trae cajas) o "dispatch" (se las lleva). `id` es el número que lleva pintado en el contenedor.
  constructor(id, role, now) {
    super("truck", id, role === "receiving" ? "truck_receiving" : "truck_dispatch", 5, now);
    this.role = role;
    this.cargo = [];
    this.loaded_count = 0;
    this.dock = null;
    this.door = null;
    this.door_open = 0;
    this.door_target = 0;
    // La ruta de región (de dónde viene o a dónde va) y cuándo cruzó la talanquera
    this.route = null;
    this.arrived_text = "—";
    // Lo que trae: categoría, cajas y unidades (camiones de recibo)
    this.category = null;
    this.box_count = 0;
    this.units = 0;
    this.restriction_text = "Ninguna";
    this.bay = null;
    // Lo que usa el reparto de muelles y el cuaderno de programación
    this.entry = null;
    // Camión de despacho: la ciudad a la que va, los paquetes que le faltan por cargar y a qué velocidad promedio hace el viaje
    this.destination = null;
    this.load_queue = null;
    this.speed_kmh = 55;
  }

  get_info(now) {
    const rows = [
      ["Número del camión", String(this.id)],
      ["Llegada", this.arrived_text],
      ["Ruta", this.route ? this.route.text : "—"],
    ];
    if (this.role === "receiving") {
      rows.push(["Mercancía", this.category ? this.category.name : "—"], ["Cajas", String(this.box_count)], ["Unidades", String(this.units)], ["Restricción", this.restriction_text], ["Cajas por descargar", String(this.cargo.length)]);
      const place = this.dock ? `Muelle ${this.dock.index + 1}` : this.bay ? `Parqueadero, plaza ${this.bay.number}` : "Patio";
      return info(this, "Camión de recibo", place, now, rows);
    }
    rows.push(["Destino", this.destination ? this.destination.text : "—"]);
    rows.push(["Paquetes por cargar", String(this.load_queue ? this.load_queue.length : 0)], ["Paquetes cargados", String(this.loaded_count)]);
    rows.push(["Pedidos tardíos a bordo", String(this.cargo.filter((parcel) => parcel.order.late).length)]);
    rows.push(["Hora de corte", this.cutoff_text || "—"]);
    return info(this, "Camión de despacho", this.door ? `Puerta ${this.door.index + 1}` : "Salida", now, rows);
  }
}

// ---------- Montacargas y personas ----------
export class Forklift extends Actor {
  // fleet: "dock" (lleva pallets de descarga del muelle a la bodega de recibo) o "stock" (lleva pallets a los racks y cubetas al
  // multinivel, y trae los pallets de reabasto)
  constructor(id, now, fleet = "stock") {
    super("forklift", id, "forklift", 3.0, now);
    this.fleet = fleet;
    this.task = null;
    this.carry_forward = 1.15;
    this.park_index = -1;
    this.wants_maintenance = false;
    this.retiring = false;
    this.wheel_angle = 0;
  }

  get_info(now) {
    const task = this.task;
    const destination = task ? task.description : "Taller de montacargas";
    const type = this.fleet === "dock" ? "Montacarga de muelle a stock" : "Montacarga de stock a racks y multinivel";
    return info(this, type, destination, now, [["Tarea", task ? task.description : "Ninguna"]]);
  }
}

export class Worker extends Actor {
  // role: "picker" (piso del activo), "wall" (operario de un muro) o "packer" (estación de empaque)
  constructor(id, role, now) {
    super("worker", id, role === "picker" ? "worker_picker" : role === "wall" ? "worker_wall" : "worker_packer", 1.4, now);
    this.role = role;
    this.floor = -1;
    this.home = { x: 0, y: 0, z: 0 };
    this.order = null;
    this.retiring = false;
    this.carry_forward = 0.35;
    this.carry_up = 0.95;
    this.current_line = null;
  }

  get_info(now) {
    const names = { picker: "Operario de picking", wall: "Operario de muro", packer: "Empacador" };
    const place = this.role === "picker" ? `Piso ${this.floor + 1}` : this.role === "wall" ? "Muro de consolidación" : "Estación de empaque";
    return info(this, names[this.role], place, now, []);
  }
}

// ---------- Pedidos ----------
export class OrderLine {
  constructor(order, sku_id, now) {
    this.order = order;
    this.sku_id = sku_id;
    this.machine = new StateMachine("order_line", now);
    this.box = null;
    // Cuándo empezó a esperar stock, si lo está esperando
    this.waiting_since = null;
  }
}

export class Order {
  constructor(id, sku_ids, now) {
    this.kind = "order";
    this.id = id;
    this.machine = new StateMachine("order", now);
    this.lines = sku_ids.map((sku_id) => new OrderLine(this, sku_id, now));
    this.created_at = now;
    this.last_progress_at = now;
    this.slot = null;
    this.packed_at = null;
    this.dispatched_at = null;
    // Si nació de "Cancelar y reprocesar", el número del pedido que reemplaza
    this.replaces = null;
    // A dónde va (una ciudad de Colombia) y en qué corte sale: el que le toca según la regla de los 60 minutos. Si no alcanza a salir
    // en él, queda como envío tardío y pasa al siguiente corte.
    this.destination = null;
    this.promised_cutoff = null;
    this.cutoff_at = null;
    this.late = false;
    this.order = this;
    this.x = 0;
    this.y = 0;
    this.z = 0;
  }

  get is_cancellable() {
    return ["CREATED", "PICKING", "CONSOLIDATING"].includes(this.machine.state);
  }

  get_info(now) {
    const lines = this.lines.map((line) => `${sku_label(line.sku_id)}: ${line.machine.label}`);
    return {
      type: "Pedido",
      id_text: `Pedido #${this.id}`,
      state: this.machine.label,
      destination: this.slot ? `Casilla ${this.slot.label}` : "Muros de consolidación",
      order: `#${this.id}`,
      time_in_state: describe_duration(this.machine.time_in_state(now)),
      extra: [
        ["Destino", this.destination ? this.destination.text : "—"],
        ["Corte en que sale", this.cutoff_text || "—"],
        ["Envío", this.late ? "Tardío: perdió su corte" : "A tiempo hasta ahora"],
        ["Líneas", lines.join("; ")],
        ...(this.replaces ? [["Reemplaza al pedido", `#${this.replaces}`]] : []),
      ],
    };
  }
}

// ---------- Muros, estaciones, puertas, muelles y elevador ----------
export class WallSlot {
  constructor(wall, index, position) {
    this.kind = "wall_slot";
    this.wall = wall;
    this.index = index;
    this.id = `${wall.index + 1}.${index + 1}`;
    this.label = this.id;
    this.position = position;
    this.machine = new StateMachine("wall_slot", 0);
    this.order = null;
    this.boxes = [];
    this.enabled = true;
    this.x = position.x;
    this.y = position.y;
    this.z = position.z;
  }

  get_info(now) {
    const progress = this.order ? `${this.boxes.length} de ${this.order.lines.length}` : "—";
    return {
      type: "Casilla de muro",
      id_text: `Casilla ${this.label}`,
      state: this.enabled ? this.machine.label : "Cerrada",
      destination: "Cubeta del pedido",
      order: this.order ? `#${this.order.id}` : "—",
      time_in_state: describe_duration(this.machine.time_in_state(now)),
      extra: [["Progreso", progress]],
    };
  }
}

export class Wall {
  constructor(index, layout_wall) {
    this.kind = "wall";
    this.index = index;
    this.id = layout_wall.id;
    this.layout = layout_wall;
    this.slots = layout_wall.slots.map((position, slot_index) => new WallSlot(this, slot_index, position));
    this.operator = null;
    this.enabled = true;
    this.x = layout_wall.face_x;
    this.y = 1;
    this.z = layout_wall.center_z;
    this.machine = null;
  }

  get_info() {
    const free = this.slots.filter((slot) => slot.enabled && slot.machine.state === "FREE").length;
    const active = this.slots.filter((slot) => slot.enabled).length;
    return {
      type: "Muro de consolidación",
      id_text: `Muro ${this.index + 1}`,
      state: this.enabled ? `${free} de ${active} casillas libres` : "Cerrado",
      destination: "Empaque",
      order: "—",
      time_in_state: "—",
      extra: [],
    };
  }
}

export class PackStation {
  constructor(index, layout_station, now) {
    this.kind = "pack_station";
    this.index = index;
    this.id = layout_station.id;
    this.layout = layout_station;
    this.machine = new StateMachine("pack_station", now);
    this.tote = null;
    this.parcel = null;
    this.timer = 0;
    this.enabled = true;
    this.worker = null;
    this.busy_seconds = 0;
    this.x = layout_station.x;
    this.y = 1;
    this.z = layout_station.z;
    this.order = null;
  }

  get_info(now) {
    return {
      type: "Estación de empaque",
      id_text: `Estación ${this.index + 1}`,
      state: this.enabled ? this.machine.label : "Cerrada",
      destination: "Banda de despacho",
      order: this.tote && this.tote.order ? `#${this.tote.order.id}` : "—",
      time_in_state: describe_duration(this.machine.time_in_state(now)),
      extra: [],
    };
  }
}

export class DispatchDoor {
  constructor(index, layout_door, now) {
    this.kind = "door";
    this.index = index;
    this.id = layout_door.id;
    this.layout = layout_door;
    this.machine = new StateMachine("dispatch_door", now);
    this.truck = null;
    this.enabled = true;
    this.x = layout_door.x;
    this.y = 1;
    this.z = layout_door.z;
    this.order = null;
  }

  get_info(now) {
    return {
      type: "Puerta de despacho",
      id_text: `Puerta ${this.index + 1}`,
      state: this.enabled ? this.machine.label : "Cerrada",
      destination: "Patio de salida",
      order: "—",
      time_in_state: describe_duration(this.machine.time_in_state(now)),
      extra: [["Camión", this.truck ? this.truck.id : "ninguno"], ["Destino", this.truck && this.truck.destination ? this.truck.destination.text : "—"], ["Paquetes por cargar", String(this.truck && this.truck.load_queue ? this.truck.load_queue.length : 0)]],
    };
  }
}

export class Dock {
  constructor(index, layout_dock, now) {
    this.kind = "dock";
    this.index = index;
    this.id = layout_dock.id;
    this.layout = layout_dock;
    this.machine = new StateMachine("dispatch_door", now);
    this.truck = null;
    this.rail = null;
    // Los pallets de descarga que hay al final del riel (hasta dos: uno que se llena y otro que espera montacarga)
    this.pallets = [];
    this.enabled = true;
    this.x = layout_dock.x;
    this.y = 1;
    this.z = layout_dock.z;
    this.order = null;
  }

  get_info(now) {
    return {
      type: "Muelle de recibo",
      id_text: `Muelle ${this.index + 1}`,
      state: this.enabled ? this.machine.label : "Cerrado",
      destination: "Rieles y bodega de recibo",
      order: "—",
      time_in_state: describe_duration(this.machine.time_in_state(now)),
      extra: [["Camión", this.truck ? this.truck.id : "ninguno"], ["Cajas en el riel", String(this.rail ? this.rail.count : 0)]],
    };
  }
}

// Lo que hay de un producto en la bodega de recibo: una pila por SKU
export class StockStack {
  constructor(sku_id, slot) {
    this.kind = "stock_stack";
    this.sku_id = sku_id;
    this.id = sku_id + 1;
    this.x = slot.x;
    this.y = 0;
    this.z = slot.z;
    this.boxes = 0;
    this.units = 0;
    this.order = null;
  }

  get_info() {
    return {
      type: "Pila de la bodega de recibo",
      id_text: sku_label(this.sku_id),
      state: this.boxes > 0 ? `${this.boxes} ${this.boxes === 1 ? "caja" : "cajas"}` : "Vacía",
      destination: "Pallets de la reserva y cubetas del activo",
      order: "—",
      time_in_state: "—",
      extra: [
        ["Categoría", sku_category(this.sku_id).name],
        ["Cajas en la pila", String(this.boxes)],
        ["Unidades en la pila", String(this.units)],
      ],
    };
  }
}

// Los paquetes listos de un destino, esperando el corte: una pila por ciudad en la zona de despacho
export class DispatchBin {
  constructor(destination, slot) {
    this.kind = "dispatch_bin";
    this.destination = destination;
    this.id = destination.index + 1;
    this.x = slot.x;
    this.y = 0;
    this.z = slot.z;
    this.parcels = [];
    this.order = null;
    this.next_cutoff_text = "—";
  }

  get boxes() {
    return this.parcels.reduce((sum, parcel) => sum + parcel.boxes.length, 0);
  }

  get units() {
    return this.parcels.reduce((sum, parcel) => sum + parcel.boxes.reduce((total, box) => total + box.units, 0), 0);
  }

  get_info() {
    const late = this.parcels.filter((parcel) => parcel.order.late).length;
    return {
      type: "Pila de despacho por destino",
      id_text: this.destination.text,
      state: this.parcels.length > 0 ? `${this.parcels.length} ${this.parcels.length === 1 ? "pedido listo" : "pedidos listos"}` : "Vacía",
      destination: `Camión a ${this.destination.city}`,
      order: "—",
      time_in_state: "—",
      extra: [
        ["Kilómetros desde Bogotá", String(this.destination.kilometers)],
        ["Pedidos listos", String(this.parcels.length)],
        ["Cajas", String(this.boxes)],
        ["Unidades", String(this.units)],
        ["Pedidos tardíos", String(late)],
        ["Próximo corte", this.next_cutoff_text],
      ],
    };
  }
}

export class Elevator {
  constructor(layout_elevator, now) {
    this.kind = "elevator";
    this.id = 1;
    this.machine = new StateMachine("elevator", now);
    this.tote = null;
    this.x = layout_elevator.x;
    this.z = layout_elevator.z;
    this.y = 0.9;
    this.prev_y = 0.9;
    this.target_floor = 0;
    this.timer = 0;
    this.order = null;
  }

  get_info(now) {
    return {
      type: "Elevador",
      id_text: "Elevador de cubetas",
      state: this.machine.label,
      destination: this.tote ? `Piso ${this.tote.floor + 1}` : "Piso de recibo",
      order: "—",
      time_in_state: describe_duration(this.machine.time_in_state(now)),
      extra: [],
    };
  }
}
