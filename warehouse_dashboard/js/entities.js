// Las cosas que existen en la bodega: cajas, pallets, cubetas, paquetes, camiones, montacargas, personas, pedidos, casillas de
// muro, estaciones, puertas y el elevador. Cada una lleva su máquina de estados (ver state_machines.js), su posición para
// dibujarla y un `get_info` con lo que muestra el panel de inspección.
//
// La posición de lo que se mueve se guarda dos veces, la del paso anterior y la actual: el dibujo interpola entre las dos y
// así el movimiento se ve continuo aunque la simulación avance en pasos de 0,25 s.

import { StateMachine } from "./state_machines.js";
import { make_path, sample_path } from "./path_tools.js";
import { sku_floor, sku_name } from "./config.js";

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
  }

  set_position(x, y, z, yaw = this.yaw) {
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
    this.belt_length = 0.6;
    this.s = 0;
    this.gate_index = 0;
    this.belt = null;
    this.created_at = now;
  }

  get_info(now) {
    const destinations = {
      IN_TRUCK: "Rieles de recibo",
      ON_RAIL: "Mesa de recibo",
      AT_RECEIVING: "Pallet o cubeta",
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
      ON_DISPATCH_BELT: "Camión de despacho",
      LOADED: "Salida del camión",
      SHIPPED: "Entregada",
    };
    return info(this, "Caja", destinations[this.machine.state], now, [
      ["Producto", `${sku_name(this.sku_id)} (piso ${sku_floor(this.sku_id) + 1})`],
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
  }

  get_info(now) {
    const destinations = {
      FORMING: "Esperando un montacargas",
      READY: "Racks de reserva",
      CARRIED: "Racks de reserva",
      IN_RESERVE: "Reserva (hasta que haga falta)",
      CARRIED_TO_REPLENISH: "Pie del multinivel",
      UNPACKED: "—",
    };
    return info(this, "Pallet", destinations[this.machine.state], now, [
      ["Producto", sku_name(this.sku_id)],
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
        const finished = this.drive_s + distance >= path.length - 1e-9;
        const next_s = finished ? path.length : this.drive_s + distance;
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
  // role: "receiving" (trae cajas) o "dispatch" (se las lleva)
  constructor(id, role, now) {
    super("truck", id, role === "receiving" ? "truck_receiving" : "truck_dispatch", 5, now);
    this.role = role;
    this.cargo = [];
    this.loaded_count = 0;
    this.dock = null;
    this.door = null;
    this.door_open = 0;
    this.cab_color = "#ef4444";
    this.arrived_at = now;
  }

  get_info(now) {
    if (this.role === "receiving") {
      return info(this, "Camión de recibo", this.dock ? `Muelle ${this.dock.index + 1}` : "Patio", now, [["Cajas por descargar", String(this.cargo.length)]]);
    }
    return info(this, "Camión de despacho", this.door ? `Puerta ${this.door.index + 1}` : "Salida", now, [["Paquetes cargados", String(this.loaded_count)]]);
  }
}

// ---------- Montacargas y personas ----------
export class Forklift extends Actor {
  constructor(id, now) {
    super("forklift", id, "forklift", 3.0, now);
    this.task = null;
    this.carry_forward = 1.15;
    this.park_index = -1;
    this.wants_maintenance = false;
    this.retiring = false;
    this.wheel_angle = 0;
  }

  get_info(now) {
    const task = this.task;
    const destination = task ? task.description : "Parqueo del taller";
    return info(this, "Montacargas", destination, now, [["Tarea", task ? task.description : "Ninguna"]]);
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
    this.order = this;
    this.x = 0;
    this.y = 0;
    this.z = 0;
  }

  get is_cancellable() {
    return ["CREATED", "PICKING", "CONSOLIDATING"].includes(this.machine.state);
  }

  get_info(now) {
    const lines = this.lines.map((line) => `${sku_name(line.sku_id)}: ${line.machine.label}`);
    return {
      type: "Pedido",
      id_text: `Pedido #${this.id}`,
      state: this.machine.label,
      destination: this.slot ? `Casilla ${this.slot.label}` : "Muros de consolidación",
      order: `#${this.id}`,
      time_in_state: describe_duration(this.machine.time_in_state(now)),
      extra: [["Líneas", lines.join("; ")], ...(this.replaces ? [["Reemplaza al pedido", `#${this.replaces}`]] : [])],
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
    this.lane = null;
    this.enabled = true;
    this.assigned = 0;
    this.next_departure_at = null;
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
      extra: [["Camión", this.truck ? this.truck.id : "ninguno"], ["Paquetes esperando", String(this.lane ? this.lane.count : 0)]],
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
    // Cajas esperando en la mesa de recibo
    this.table = [];
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
      destination: "Rieles de recibo",
      order: "—",
      time_in_state: describe_duration(this.machine.time_in_state(now)),
      extra: [["Camión", this.truck ? this.truck.id : "ninguno"], ["Cajas en la mesa", String(this.table.length)]],
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
