// Una banda transportadora: un camino con elementos encima que avanzan a la velocidad de la banda sin pasar al de adelante y
// sin tocarlo. Si algo bloquea (banda detenida, salida llena, una compuerta que no deja pasar), los de atrás se acumulan.
//
// Los elementos (cajas, cubetas, paquetes) tienen `belt_length`, que es lo que ocupan sobre la banda, y los campos `s`
// (distancia recorrida), `belt` y `gate_index` que maneja la banda.
//
// Las compuertas (`gates`) son puntos de la banda donde se decide qué hace cada elemento que llega: seguir ("pass"), quedarse
// esperando ("hold") o salirse de la banda porque alguien lo recibe ("take"). Con ellas se hacen los muros de consolidación,
// las estaciones de empaque y las puertas de despacho sin que la banda sepa nada de ellos.

import { StateMachine } from "./state_machines.js";
import { sample_path } from "./path_tools.js";
import { describe_duration } from "./entities.js";

// Hueco mínimo entre un elemento y el siguiente, además de la mitad de lo que mide cada uno (metros)
const ITEM_GAP = 0.12;

export class Belt {
  constructor(id, kind, path, get_speed) {
    this.id = id;
    this.kind = kind;
    this.path = path;
    this.get_speed = get_speed;
    this.machine = new StateMachine("belt", 0);
    // De adelante hacia atrás: el primero es el de mayor `s`
    this.items = [];
    this.gates = [];
    // Qué hacer con un elemento que llega al final: devuelve true si alguien lo recibió
    this.on_end = null;
    // Verdadero si hay elementos y ninguno se movió en el último paso estando la banda en marcha (la banda está atascada)
    this.is_stalled = false;
    this.stalled_since = null;
    this.scratch = { x: 0, y: 0, z: 0, yaw: 0 };
    this.entity_type = "belt";
  }

  get is_running() {
    return this.machine.state === "RUNNING";
  }

  get count() {
    return this.items.length;
  }

  set_running(running, now) {
    const next = running ? "RUNNING" : "STOPPED";
    if (this.machine.state !== next) this.machine.go_to(next, now);
  }

  // Lo que muestra el panel de inspección
  get_info(now) {
    const names = {
      rail: "Riel de descarga",
      tote_in: "Banda de cubetas al elevador",
      floor: "Banda de piso",
      main: "Banda principal",
      tote_out: "Banda de salida de muros",
      pack: "Banda de alimentación de empaque",
      dispatch: "Banda de despacho",
      door: "Carril de puerta",
    };
    const type = names[this.kind] || "Banda";
    const state = this.machine.label + (this.is_stalled ? " (atascada)" : "");
    return {
      type,
      id_text: `${type} ${this.id}`,
      state,
      destination: "Siguiente etapa del flujo",
      order: "—",
      time_in_state: describe_duration(this.machine.time_in_state(now)),
      extra: [["Elementos encima", String(this.items.length)]],
    };
  }

  // Las compuertas se ordenan por distancia al inicio; un elemento solo mira la siguiente que le toca
  add_gate(gate) {
    this.gates.push(gate);
    this.gates.sort((first, second) => first.s - second.s);
  }

  // ¿Cabe un elemento de largo `length` centrado en `s`, sin tocar a los demás?
  has_space_at(s, length) {
    for (const other of this.items) {
      if (Math.abs(other.s - s) < (other.belt_length + length) / 2 + ITEM_GAP) return false;
    }
    return true;
  }

  // Pone el elemento en la banda a `s` metros del inicio si hay lugar. Devuelve si lo logró.
  try_insert(item, s, now) {
    if (!this.has_space_at(s, item.belt_length)) return false;
    item.s = s;
    item.belt = this;
    item.gate_index = this.gates.findIndex((gate) => gate.s > s);
    if (item.gate_index < 0) item.gate_index = this.gates.length;
    let position = 0;
    while (position < this.items.length && this.items[position].s > s) position += 1;
    this.items.splice(position, 0, item);
    this.place(item);
    // Una caja que entra no parte desde el punto anterior que tuviera en otra banda
    item.teleport(item.x, item.y, item.z, item.yaw);
    this.is_stalled = false;
    this.stalled_since = null;
    return true;
  }

  remove(item) {
    const position = this.items.indexOf(item);
    if (position >= 0) this.items.splice(position, 1);
    if (item.belt === this) item.belt = null;
  }

  // Escribe la posición del elemento según su `s`
  place(item) {
    sample_path(this.path, item.s, this.scratch);
    item.set_position(this.scratch.x, this.scratch.y, this.scratch.z, this.scratch.yaw);
  }

  update(dt, now) {
    const items = this.items;
    const speed = this.is_running ? this.get_speed(this) : 0;
    const taken = [];
    let moved = false;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      let limit = this.path.length;
      if (index > 0) {
        const ahead = items[index - 1];
        limit = Math.min(limit, ahead.s - (ahead.belt_length + item.belt_length) / 2 - ITEM_GAP);
      }
      let target = Math.max(item.s, Math.min(item.s + speed * dt, limit));
      let removed = false;
      // Compuertas: se decide qué hace el elemento al llegar a la siguiente que le toca (la banda en pausa no decide nada)
      while (speed > 0 && item.gate_index < this.gates.length) {
        const gate = this.gates[item.gate_index];
        if (target < gate.s) break;
        const decision = gate.handle(item, this, now);
        if (decision === "pass") {
          item.gate_index += 1;
        } else if (decision === "take") {
          removed = true;
          break;
        } else {
          target = Math.min(target, Math.max(item.s, gate.s));
          break;
        }
      }
      if (removed) {
        taken.push(item);
        continue;
      }
      // Al final de la banda, el siguiente eslabón decide si lo recibe
      if (speed > 0 && target >= this.path.length - 1e-9 && this.on_end && this.on_end(item, this, now)) {
        taken.push(item);
        continue;
      }
      if (target > item.s + 1e-9) moved = true;
      item.s = target;
      this.place(item);
    }
    taken.forEach((item) => this.remove(item));
    const stalled = speed > 0 && items.length > 0 && !moved;
    if (stalled && !this.is_stalled) this.stalled_since = now;
    if (!stalled) this.stalled_since = null;
    this.is_stalled = stalled;
  }
}
