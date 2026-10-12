// Las máquinas de estados de cada entidad. Cada una es una tabla explícita: de cada estado, a cuáles se puede pasar. Una
// transición que no está en la tabla es un error (lanza una excepción), así un fallo de lógica se descubre en el momento y
// no como una caja que aparece en un lugar imposible.
//
// Los nombres de los estados salen del encargo y se quedan en inglés porque son identificadores; lo que ve la persona se
// traduce en `STATE_LABELS` (para el panel de inspección).

// Cada tabla: { estado: [estados a los que se puede pasar] }. El primer estado de la tabla es el inicial.
export const TRANSITIONS = {
  // Camión de recibo: llega, espera si no hay muelle, acopla, descarga y se va vacío
  truck_receiving: {
    ARRIVING: ["QUEUED", "DOCKING"],
    QUEUED: ["DOCKING"],
    DOCKING: ["UNLOADING"],
    UNLOADING: ["LEAVING_EMPTY"],
    LEAVING_EMPTY: ["GONE"],
    GONE: [],
  },
  // Camión de despacho: espera en su puerta, se carga y sale (o sale vacío)
  truck_dispatch: {
    WAITING_AT_DOOR: ["LOADING", "DEPARTING"],
    LOADING: ["DEPARTING"],
    DEPARTING: ["GONE"],
    GONE: [],
  },
  // Caja: del camión al despacho. Las del 70 % pasan por pallet y reserva; las del 30 %, por cubeta. Desde la reserva también
  // se puede pasar a cubeta (reabasto). Al cancelar un pedido, sus cajas vuelven al activo.
  box: {
    IN_TRUCK: ["ON_RAIL"],
    ON_RAIL: ["ON_DOCK_PALLET"],
    ON_DOCK_PALLET: ["IN_STAGING"],
    IN_STAGING: ["ON_PALLET", "IN_TOTE"],
    ON_PALLET: ["IN_RESERVE"],
    IN_RESERVE: ["IN_TOTE"],
    IN_TOTE: ["IN_ACTIVE"],
    IN_ACTIVE: ["PICKED"],
    PICKED: ["ON_FLOOR_BELT", "IN_ACTIVE"],
    ON_FLOOR_BELT: ["ON_MAIN_BELT", "IN_ACTIVE"],
    ON_MAIN_BELT: ["IN_WALL_SLOT", "IN_ACTIVE"],
    IN_WALL_SLOT: ["IN_ORDER_TOTE", "IN_ACTIVE"],
    IN_ORDER_TOTE: ["PACKING"],
    PACKING: ["PACKED"],
    PACKED: ["ON_DISPATCH_BELT"],
    ON_DISPATCH_BELT: ["IN_DISPATCH_BIN"],
    IN_DISPATCH_BIN: ["LOADED"],
    LOADED: ["SHIPPED"],
    SHIPPED: [],
  },
  // Pallet de reserva: se forma en recibo, lo lleva un montacarga a un rack y, si hace falta, otro a reabastecer
  pallet: {
    FORMING: ["READY"],
    READY: ["CARRIED"],
    CARRIED: ["IN_RESERVE", "DELIVERED"],
    DELIVERED: [],
    IN_RESERVE: ["CARRIED_TO_REPLENISH"],
    CARRIED_TO_REPLENISH: ["UNPACKED"],
    UNPACKED: [],
  },
  // Cubeta de entrada: se llena en la franja de armado de la bodega, una montacarga la lleva a la puerta del elevador y sube a su piso
  // (las que salen de desarmar un pallet de reabasto nacen ya en la puerta del elevador)
  tote_in: {
    FILLING: ["READY", "AT_DOOR"],
    READY: ["CARRIED"],
    CARRIED: ["AT_DOOR"],
    AT_DOOR: ["IN_ELEVATOR"],
    IN_ELEVATOR: ["AT_FLOOR"],
    AT_FLOOR: ["EMPTY"],
    EMPTY: [],
  },
  // Cubeta de salida: se llena en un muro con un pedido completo y va a empaque
  tote_out: {
    FILLING_ORDER: ["ON_OUT_BELT"],
    ON_OUT_BELT: ["AT_PACK"],
    AT_PACK: ["CONSUMED"],
    CONSUMED: [],
  },
  // Montacarga: la disrupción de mantenimiento lo saca de circulación y lo devuelve
  forklift: {
    IDLE: ["GOING_TO_PICKUP", "MAINTENANCE"],
    GOING_TO_PICKUP: ["CARRYING", "IDLE"],
    CARRYING: ["UNLOADING"],
    UNLOADING: ["RETURNING"],
    RETURNING: ["IDLE"],
    MAINTENANCE: ["IDLE"],
  },
  // Operario de picking de un piso
  worker_picker: {
    IDLE: ["WALKING_TO_SLOT"],
    // Si el pedido se cancela, el operario que iba a recoger deja lo que hacía y queda libre
    WALKING_TO_SLOT: ["PICKING", "IDLE"],
    PICKING: ["PLACING_ON_BELT", "IDLE"],
    PLACING_ON_BELT: ["IDLE"],
  },
  worker_wall: {
    IDLE: ["EMPTYING_SLOT"],
    EMPTYING_SLOT: ["IDLE"],
  },
  worker_packer: {
    IDLE: ["PACKING"],
    PACKING: ["IDLE"],
  },
  // Pedido. Solo se cancela mientras no esté completo.
  order: {
    CREATED: ["PICKING", "CANCELLED"],
    PICKING: ["CONSOLIDATING", "CANCELLED"],
    CONSOLIDATING: ["COMPLETE", "CANCELLED"],
    COMPLETE: ["PACKED"],
    PACKED: ["DISPATCHED"],
    DISPATCHED: [],
    CANCELLED: [],
  },
  // Línea de un pedido (un SKU). Espera stock si el activo no tiene.
  order_line: {
    PENDING: ["WAITING_STOCK", "PICKED"],
    WAITING_STOCK: ["PICKED"],
    PICKED: ["AT_WALL"],
    AT_WALL: [],
  },
  belt: {
    RUNNING: ["STOPPED"],
    STOPPED: ["RUNNING"],
  },
  // Casilla de un muro de consolidación
  wall_slot: {
    FREE: ["ASSIGNED"],
    ASSIGNED: ["COMPLETE", "FREE"],
    COMPLETE: ["EMPTYING"],
    EMPTYING: ["FREE"],
  },
  pack_station: {
    FREE: ["BUSY"],
    BUSY: ["FREE"],
  },
  dispatch_door: {
    EMPTY: ["OCCUPIED"],
    OCCUPIED: ["EMPTY"],
  },
  // Elevador de cubetas: sube una cubeta a la vez al piso de sus cajas y vuelve vacío
  elevator: {
    IDLE: ["LOADING"],
    LOADING: ["RISING"],
    RISING: ["UNLOADING"],
    UNLOADING: ["DESCENDING"],
    DESCENDING: ["IDLE"],
  },
};

// Lo que ve la persona en el panel de inspección
export const STATE_LABELS = {
  ARRIVING: "Llegando",
  QUEUED: "Parqueado en el patio",
  DOCKING: "Yendo al muelle",
  UNLOADING: "Descargando",
  LEAVING_EMPTY: "Saliendo vacío",
  GONE: "Fuera de la bodega",
  WAITING_AT_DOOR: "Esperando en la puerta",
  LOADING: "Cargando",
  DEPARTING: "Saliendo",
  IN_TRUCK: "En el camión",
  ON_RAIL: "Bajando por el riel",
  ON_DOCK_PALLET: "En un pallet de descarga",
  IN_STAGING: "En la bodega de recibo",
  ON_PALLET: "En un pallet",
  IN_RESERVE: "En la reserva",
  IN_TOTE: "En una cubeta",
  IN_ACTIVE: "En el activo",
  PICKED: "Recién tomada",
  ON_FLOOR_BELT: "En la banda del piso",
  ON_MAIN_BELT: "En la banda principal",
  IN_WALL_SLOT: "En una casilla del muro",
  IN_ORDER_TOTE: "En la cubeta del pedido",
  PACKING: "Empacando",
  PACKED: "Empacada",
  ON_DISPATCH_BELT: "En la banda de despacho",
  IN_DISPATCH_BIN: "Esperando su hora de corte",
  LOADED: "Cargada en el camión",
  SHIPPED: "Despachada",
  FORMING: "Formándose",
  READY: "Lista para guardar",
  CARRIED: "Llevada por un montacarga",
  CARRIED_TO_REPLENISH: "Llevada a reabastecer",
  UNPACKED: "Desarmada en cubetas",
  DELIVERED: "Entregada a la bodega",
  FILLING: "Llenándose",
  READY: "Lista para llevar",
  AT_DOOR: "Esperando el elevador",
  IN_ELEVATOR: "Subiendo en el elevador",
  AT_FLOOR: "En su piso",
  EMPTY: "Vacío",
  FILLING_ORDER: "Llenándose con un pedido",
  ON_OUT_BELT: "En la banda a empaque",
  AT_PACK: "En empaque",
  CONSUMED: "Procesada",
  IDLE: "Libre",
  GOING_TO_PICKUP: "Yendo a recoger",
  CARRYING: "Llevando una carga",
  RETURNING: "Volviendo",
  MAINTENANCE: "En mantenimiento",
  WALKING_TO_SLOT: "Caminando a la posición",
  PICKING: "Tomando la caja",
  PLACING_ON_BELT: "Poniéndola en la banda",
  EMPTYING_SLOT: "Vaciando la casilla",
  CREATED: "Creado",
  CONSOLIDATING: "Consolidando",
  COMPLETE: "Completo",
  DISPATCHED: "Despachado",
  CANCELLED: "Cancelado",
  PENDING: "Pendiente",
  WAITING_STOCK: "Esperando stock",
  AT_WALL: "En el muro",
  RUNNING: "En marcha",
  STOPPED: "Detenida",
  FREE: "Libre",
  ASSIGNED: "Asignada",
  EMPTYING: "Vaciándose",
  BUSY: "Ocupada",
  OCCUPIED: "Ocupado",
  RISING: "Subiendo",
  DESCENDING: "Bajando",
};

// Palabras que cambian según de qué se hable: "PICKING" en un pedido es "En picking", en una persona es "Tomando la caja"
const MACHINE_LABELS = {
  order: { PICKING: "En picking", PACKED: "Empacado" },
};

export function initial_state(machine_type) {
  return Object.keys(TRANSITIONS[machine_type])[0];
}

export function can_transition(machine_type, from, to) {
  const table = TRANSITIONS[machine_type];
  return Boolean(table && table[from] && table[from].includes(to));
}

// Una máquina de estados concreta: guarda su estado y desde cuándo está en él
export class StateMachine {
  constructor(machine_type, now = 0) {
    if (!TRANSITIONS[machine_type]) throw new Error(`Máquina de estados desconocida: ${machine_type}`);
    this.machine_type = machine_type;
    this.state = initial_state(machine_type);
    this.entered_at = now;
  }

  can_go_to(next_state) {
    return can_transition(this.machine_type, this.state, next_state);
  }

  // Pasa a otro estado; si no está permitido, lanza un error que dice cuál fue la transición
  go_to(next_state, now) {
    if (!this.can_go_to(next_state)) throw new Error(`Transición no permitida en ${this.machine_type}: ${this.state} → ${next_state}`);
    this.state = next_state;
    this.entered_at = now;
  }

  // Segundos simulados que lleva en el estado actual
  time_in_state(now) {
    return now - this.entered_at;
  }

  get label() {
    const overrides = MACHINE_LABELS[this.machine_type];
    return (overrides && overrides[this.state]) || STATE_LABELS[this.state] || this.state;
  }
}
