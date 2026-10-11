// Las cuatro disrupciones que la persona puede activar y desactivar. No tienen caminos aparte: leen y escriben el mismo estado
// que el resto de la simulación (la banda principal, un montacarga, la tasa de pedidos, la llegada del próximo camión).

import { ORDER_SPIKE_SECONDS } from "./config.js";

export const DISRUPTION_KINDS = ["belt_down", "forklift_maintenance", "order_spike", "delayed_truck"];

// El camión retrasado tarda este múltiplo del tiempo que le faltaba
const DELAY_FACTOR = 3;

export class Disruptions {
  constructor(sim) {
    this.sim = sim;
    this.active = { belt_down: false, forklift_maintenance: false, order_spike: false, delayed_truck: false };
    this.spike_ends_at = null;
    this.spike_event_id = null;
    this.maintenance_forklift = null;
  }

  get spike_active() {
    return this.active.order_spike;
  }

  is_active(kind) {
    return this.active[kind];
  }

  // Segundos simulados que le quedan al pico de pedidos, o 0
  spike_remaining(now) {
    return this.spike_ends_at === null ? 0 : Math.max(0, this.spike_ends_at - now);
  }

  toggle(kind, now) {
    this.set(kind, !this.active[kind], now);
  }

  set(kind, on, now) {
    if (this.active[kind] === on) return;
    this.active[kind] = on;
    const { sim } = this;
    if (kind === "belt_down") {
      sim.orders.main.set_running(!on, now);
    } else if (kind === "forklift_maintenance") {
      this.set_maintenance(on, now);
    } else if (kind === "order_spike") {
      if (on) {
        this.spike_ends_at = now + ORDER_SPIKE_SECONDS;
        this.spike_event_id = sim.events.schedule(this.spike_ends_at, "spike_end");
      } else {
        if (this.spike_event_id !== null) sim.events.cancel(this.spike_event_id);
        this.spike_event_id = null;
        this.spike_ends_at = null;
      }
      sim.orders.reschedule(now);
    } else if (kind === "delayed_truck") {
      const pending = sim.receiving.pending_arrival;
      if (pending) {
        const remaining = Math.max(0, pending.time - now);
        sim.receiving.move_pending_arrival(now + (on ? remaining * DELAY_FACTOR : remaining / DELAY_FACTOR));
      }
    }
    sim.emit({ type: "disruption_changed", kind, on });
  }

  // El pico terminó solo
  on_spike_end(now) {
    this.spike_event_id = null;
    if (this.active.order_spike) this.set("order_spike", false, now);
  }

  // Llegó el camión retrasado: la disrupción termina
  on_truck_arrived() {
    if (!this.active.delayed_truck) return;
    this.active.delayed_truck = false;
    this.sim.emit({ type: "disruption_changed", kind: "delayed_truck", on: false });
  }

  // El montacarga con menos trabajo termina lo que lleva y va al taller
  set_maintenance(on, now) {
    const { storage } = this.sim;
    if (on) {
      const candidates = storage.forklifts.filter((forklift) => !forklift.retiring && forklift.machine.state !== "MAINTENANCE");
      if (candidates.length === 0) {
        this.active.forklift_maintenance = false;
        return;
      }
      candidates.sort((first, second) => Number(first.is_busy) - Number(second.is_busy) || first.busy_seconds - second.busy_seconds || first.id - second.id);
      this.maintenance_forklift = candidates[0];
      this.maintenance_forklift.wants_maintenance = true;
    } else if (this.maintenance_forklift) {
      const forklift = this.maintenance_forklift;
      forklift.wants_maintenance = false;
      if (forklift.machine.state === "MAINTENANCE") forklift.machine.go_to("IDLE", now);
      this.maintenance_forklift = null;
    }
  }
}
