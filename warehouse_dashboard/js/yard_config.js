// La configuración del patio de recibo y los muelles que maneja la persona: cuántos camiones llegan en cada franja del día, qué
// muelles están bloqueados, si las llegadas de camiones están detenidas, las horas de corte de los despachos y las restricciones de cada camión. Se guarda en el
// navegador y la simulación la lee en vivo. Cambiar los camiones por franja vale para las franjas que todavía no han empezado.

import { DOCK_COUNT, SIM_START_HOUR } from "./config.js";
import { DEFAULT_CUTOFFS, normalize_cutoffs } from "./cutoffs.js";

// Las franjas en que llegan camiones. De 10 de la noche a 6 de la mañana el patio no recibe.
export const SLOTS = [
  { key: "morning", label: "Mañana", start_hour: 6, end_hour: 12 },
  { key: "afternoon", label: "Tarde", start_hour: 12, end_hour: 18 },
  { key: "night", label: "Noche", start_hour: 18, end_hour: 22 },
];

// Cada franja en segundos desde las 6 de la mañana, que es la hora en que arranca el reloj simulado
export const SLOT_OFFSETS = Object.fromEntries(
  SLOTS.map((slot) => [slot.key, { start: (slot.start_hour - SIM_START_HOUR) * 3600, length: (slot.end_hour - slot.start_hour) * 3600 }]),
);

export const MAX_TRUCKS_PER_SLOT = 60;
const DEFAULT_COUNTS = { morning: 8, afternoon: 10, night: 6 };

export function slot_label(slot_key) {
  const slot = SLOTS.find((candidate) => candidate.key === slot_key);
  // "manual" son los camiones que la persona hizo llegar con el botón de llegada inmediata; los otros dos los pide el coordinador
  if (slot_key === "coordinator") return "Coordinador";
  if (slot_key === "urgent") return "Urgente";
  return slot ? slot.label : "Manual";
}

export class YardConfig {
  constructor() {
    this.listeners = new Set();
    this.reset();
  }

  reset() {
    this.counts = { ...DEFAULT_COUNTS };
    this.blocked_docks = Array(DOCK_COUNT).fill(false);
    // Llegadas detenidas "hasta nueva orden": mientras es verdad, ningún camión de recibo sale a la carretera (los programados se saltan)
    this.arrivals_blocked = false;
    // Restricción por número de camión: { dock: índice del muelle o null, from_slot: franja o null }
    this.rules = {};
    // La entrada de camiones de despacho: cuando está cerrada no entran camiones nuevos a las puertas
    this.dispatch_blocked = false;
    // Las horas de corte de los despachos, en minutos desde la medianoche
    this.cutoffs = [...DEFAULT_CUTOFFS];
    this.notify("reset");
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(kind) {
    this.listeners.forEach((listener) => listener(kind));
  }

  get_count(slot_key) {
    return this.counts[slot_key];
  }

  set_count(slot_key, value) {
    const number = Math.min(MAX_TRUCKS_PER_SLOT, Math.max(0, Math.round(Number(value))));
    if (!Number.isFinite(number) || this.counts[slot_key] === number) return;
    this.counts[slot_key] = number;
    this.notify("counts");
  }

  // El total del día es la suma de las tres franjas
  get daily_total() {
    return SLOTS.reduce((total, slot) => total + this.counts[slot.key], 0);
  }

  is_dock_blocked(index) {
    return this.blocked_docks[index];
  }

  set_dock_blocked(index, blocked) {
    if (this.blocked_docks[index] === blocked) return;
    this.blocked_docks[index] = blocked;
    this.notify("docks");
  }

  // Cierra todos los muelles de una vez (o los abre todos). Un camión que ya está descargando termina.
  set_all_docks_blocked(blocked) {
    const next = Boolean(blocked);
    if (this.blocked_docks.every((value) => value === next)) return;
    this.blocked_docks = Array(DOCK_COUNT).fill(next);
    this.notify("docks");
  }

  get all_docks_blocked() {
    return this.blocked_docks.every(Boolean);
  }

  // Detiene o reanuda la llegada de camiones de recibo. Los que ya están en la carretera o en el predio siguen su camino.
  set_arrivals_blocked(blocked) {
    if (this.arrivals_blocked === Boolean(blocked)) return;
    this.arrivals_blocked = Boolean(blocked);
    this.notify("arrivals");
  }

  get_rule(truck_id) {
    return this.rules[truck_id] || null;
  }

  // Sin muelle fijo y sin franja, la restricción no existe
  set_rule(truck_id, dock, from_slot) {
    if (dock === null && from_slot === null) delete this.rules[truck_id];
    else this.rules[truck_id] = { dock, from_slot };
    this.notify("rules");
  }

  // Cambia las horas de corte (se ordenan y se quitan las repetidas o inválidas). Devuelve la lista que quedó.
  set_cutoffs(values) {
    const next = normalize_cutoffs(values);
    if (next.length === this.cutoffs.length && next.every((value, index) => value === this.cutoffs[index])) return this.cutoffs;
    this.cutoffs = next;
    this.notify("cutoffs");
    return this.cutoffs;
  }

  set_dispatch_blocked(blocked) {
    if (this.dispatch_blocked === Boolean(blocked)) return;
    this.dispatch_blocked = Boolean(blocked);
    this.notify("dispatch");
  }

  to_json() {
    return { arrivals_blocked: this.arrivals_blocked, dispatch_blocked: this.dispatch_blocked, cutoffs: [...this.cutoffs], counts: { ...this.counts }, blocked_docks: [...this.blocked_docks], rules: JSON.parse(JSON.stringify(this.rules)) };
  }

  // Carga lo guardado; lo que no se reconoce se ignora
  load(data) {
    if (!data || typeof data !== "object") return;
    if (data.counts && typeof data.counts === "object") {
      SLOTS.forEach((slot) => {
        const value = Number(data.counts[slot.key]);
        if (Number.isFinite(value)) this.counts[slot.key] = Math.min(MAX_TRUCKS_PER_SLOT, Math.max(0, Math.round(value)));
      });
    }
    if (Array.isArray(data.blocked_docks)) this.blocked_docks = Array.from({ length: DOCK_COUNT }, (_, index) => data.blocked_docks[index] === true);
    this.dispatch_blocked = data.dispatch_blocked === true;
    this.arrivals_blocked = data.arrivals_blocked === true;
    this.cutoffs = Array.isArray(data.cutoffs) ? normalize_cutoffs(data.cutoffs) : [...DEFAULT_CUTOFFS];
    if (data.rules && typeof data.rules === "object") {
      this.rules = {};
      Object.entries(data.rules).forEach(([truck_id, rule]) => {
        const dock = Number.isInteger(rule && rule.dock) && rule.dock >= 0 && rule.dock < DOCK_COUNT ? rule.dock : null;
        const from_slot = rule && SLOTS.some((slot) => slot.key === rule.from_slot) ? rule.from_slot : null;
        if (dock !== null || from_slot !== null) this.rules[truck_id] = { dock, from_slot };
      });
    }
    this.notify("reset");
  }
}
