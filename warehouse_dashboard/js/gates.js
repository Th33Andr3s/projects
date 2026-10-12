// Las talanqueras de las garitas, estilo peaje: cada carril tiene una barrera que se levanta cuando el camión que espera
// delante ya se registró y baja apenas pasa. Un carril atiende a un camión a la vez; los demás esperan su turno.
//
// La simulación solo lleva el estado de cada talanquera (cuánto está levantada); el dibujo la pinta con ese número.

import { GATES } from "./layout.js";

// Lo que tarda el registro con el camión detenido antes de que la barrera empiece a subir, y lo que tarda en subir o bajar
const REGISTER_SECONDS = 1.2;
const MOVE_SECONDS = 1.0;

export class GateLane {
  // gate: "west" o "east"; direction: "in" (entra al predio) o "out" (sale)
  constructor(gate_key, direction) {
    const gate = GATES[gate_key];
    this.kind = "gate_lane";
    this.id = `${gate_key}_${direction}`;
    this.gate_key = gate_key;
    this.direction = direction;
    this.label = `${gate.label} · carril de ${direction === "in" ? "entrada" : "salida"}`;
    this.x = gate.x;
    this.y = 1;
    this.z = direction === "in" ? gate.in_lane_z : gate.out_lane_z;
    this.stop_x = direction === "in" ? gate.in_stop_x : gate.out_stop_x;
    this.occupant = null;
    // Cuánto está levantada la barrera: 0 cerrada, 1 abierta del todo
    this.progress = 0;
    this.timer = 0;
    this.machine = null;
    this.order = null;
  }

  // Un camión pide el carril; se lo da si está libre (o ya es suyo). Devuelve si lo tiene.
  try_claim(truck) {
    if (this.occupant === null || this.occupant === truck) {
      this.occupant = truck;
      return true;
    }
    return false;
  }

  is_open_for(truck) {
    return this.occupant === truck && this.progress >= 1;
  }

  // El camión ya pasó: la barrera empieza a bajar
  release(truck) {
    if (this.occupant === truck) this.occupant = null;
  }

  update(dt) {
    if (this.occupant) {
      this.timer += dt;
      if (this.timer >= REGISTER_SECONDS) this.progress = Math.min(1, this.progress + dt / MOVE_SECONDS);
    } else {
      this.timer = 0;
      this.progress = Math.max(0, this.progress - dt / MOVE_SECONDS);
    }
  }

  get state_label() {
    if (this.progress >= 1) return "Abierta";
    if (this.progress <= 0) return this.occupant ? "Registrando el camión" : "Cerrada";
    return this.occupant ? "Subiendo" : "Bajando";
  }

  get_info() {
    return {
      type: "Talanquera",
      id_text: this.label,
      state: this.state_label,
      destination: this.direction === "in" ? "Parqueadero y muelles" : "Carretera",
      order: "—",
      time_in_state: "—",
      extra: [["Camión en el carril", this.occupant ? `Camión ${this.occupant.id}` : "ninguno"]],
    };
  }
}

export function build_gate_lanes() {
  return {
    west_in: new GateLane("west", "in"),
    west_out: new GateLane("west", "out"),
    east_in: new GateLane("east", "in"),
    east_out: new GateLane("east", "out"),
  };
}
