// Las montacargas de muelle a stock: cada una lleva un pallet de descarga (el que se llena al final del riel de un muelle con las cajas
// que baja el camión) hasta un andén de la bodega de recibo, donde las cajas pasan a la pila de su producto. Son otra flota,
// distinta de la de stock a racks y multinivel: solo hacen este viaje.
//
// El camino: un carril norte-sur pegado a los rieles (A_LANE_X), el carril del taller por el sur y, desde el carril, un tramo corto
// hacia el este hasta cada andén, a través de la pared de la bodega.

import { Forklift } from "./entities.js";
import { A_LANE_X, GARAGE_LANE_Z, PARK_SPOTS_DOCK, UNLOAD_BAYS } from "./layout.js";

const LIFT_SECONDS = 1.0;
const TURN_SECONDS = 0.9;
const FORKLIFT_LENGTH_HALF = 1.15;
// Lo que sobresale la carga hacia adelante de la montacarga
const CARRY_FORWARD = 1.15;

export class DockFleet {
  constructor(sim) {
    this.sim = sim;
    this.forklifts = [];
    this.park_slots = PARK_SPOTS_DOCK.map(() => null);
    // Qué montacarga tiene apartado cada andén de la bodega
    this.bay_claims = UNLOAD_BAYS.map(() => null);
  }

  // ---------- Cantidad ----------
  sync_count(now) {
    const wanted = this.sim.config.get("dock_forklift_count");
    const active = this.forklifts.filter((forklift) => !forklift.retiring);
    for (let index = active.length; index < wanted; index += 1) this.add_forklift(now);
    let surplus = active.length - wanted;
    for (let index = active.length - 1; index >= 0 && surplus > 0; index -= 1) {
      active[index].retiring = true;
      surplus -= 1;
    }
  }

  add_forklift(now) {
    const forklift = new Forklift(this.sim.next_id("forklift"), now, "dock");
    const slot = this.park_slots.findIndex((occupant) => occupant === null);
    forklift.park_index = slot;
    if (slot >= 0) this.park_slots[slot] = forklift;
    const spot = PARK_SPOTS_DOCK[Math.max(0, slot)];
    forklift.teleport(spot.x, 0, spot.z, -Math.PI / 2);
    forklift.on_idle = () => this.on_forklift_idle(forklift);
    this.forklifts.push(forklift);
  }

  on_forklift_idle(forklift) {
    if (forklift.machine.state !== "IDLE") {
      if (forklift.machine.state === "CARRYING") forklift.machine.go_to("UNLOADING", this.sim.now);
      if (forklift.machine.state === "UNLOADING") forklift.machine.go_to("RETURNING", this.sim.now);
      if (forklift.machine.state === "RETURNING" || forklift.machine.state === "GOING_TO_PICKUP") forklift.machine.go_to("IDLE", this.sim.now);
    }
    forklift.task = null;
  }

  in_garage(forklift) {
    return forklift.z >= GARAGE_LANE_Z + 1;
  }

  free_park_slot(forklift) {
    if (forklift.park_index >= 0 && this.park_slots[forklift.park_index] === forklift) this.park_slots[forklift.park_index] = null;
    forklift.park_index = -1;
  }

  free_bay_index() {
    return this.bay_claims.findIndex((claim) => claim === null);
  }

  // ---------- Tareas ----------
  assign_tasks(now) {
    const idle = this.forklifts.filter((forklift) => forklift.machine.state === "IDLE" && (!forklift.is_busy || forklift.parking) && !forklift.retiring && !forklift.wants_maintenance);
    if (idle.length === 0) return;
    const pallets = this.sim.receiving.ready_dock_pallets();
    for (const forklift of idle) {
      const pallet = pallets.find((candidate) => !candidate.claimed);
      const bay_index = this.free_bay_index();
      if (!pallet || bay_index < 0) break;
      this.start_task(forklift, pallet, bay_index, now);
    }
  }

  start_task(forklift, pallet, bay_index, now) {
    if (forklift.parking) {
      forklift.abort_script();
      forklift.parking = false;
    }
    this.free_park_slot(forklift);
    pallet.claimed = true;
    this.bay_claims[bay_index] = forklift;
    forklift.task = { type: "dock_pallet", pallet, description: `Llevar el pallet ${pallet.id} del muelle ${pallet.dock_index + 1} a la bodega de recibo` };
    forklift.start_script(this.carry_script(forklift, pallet, bay_index));
    forklift.machine.go_to("GOING_TO_PICKUP", now);
  }

  // Desde donde esté la montacarga (su puesto del taller, el carril del taller, el carril de los rieles o un andén) hasta el carril
  // de los rieles
  to_lane_steps(forklift) {
    const steps = [];
    let { x, z } = forklift;
    if (z >= GARAGE_LANE_Z + 1) {
      steps.push({ do: "drive", points: [{ x, z: GARAGE_LANE_Z }] });
      z = GARAGE_LANE_Z;
    }
    if (Math.abs(z - GARAGE_LANE_Z) <= 0.8) {
      steps.push({ do: "drive", points: [{ x: A_LANE_X, z: GARAGE_LANE_Z }] });
      x = A_LANE_X;
      z = GARAGE_LANE_Z;
    } else if (Math.abs(x - A_LANE_X) > 0.3) {
      // En un andén: sale hacia el carril a la misma altura
      steps.push({ do: "drive", points: [{ x: A_LANE_X, z }] });
    }
    return steps;
  }

  carry_script(forklift, pallet, bay_index) {
    const { sim } = this;
    const bay = UNLOAD_BAYS[bay_index];
    const pallet_x = pallet.x;
    const pallet_z = pallet.z;
    return [
      ...this.to_lane_steps(forklift),
      // Por el carril hasta la altura del pallet; ahí se gira hacia los rieles y se mete la horquilla
      { do: "drive", points: [{ x: A_LANE_X, z: pallet_z }] },
      { do: "turn", yaw: Math.PI, seconds: TURN_SECONDS },
      { do: "drive", points: [{ x: pallet_x + FORKLIFT_LENGTH_HALF + 0.3, z: pallet_z }], speed: 1.5 },
      { do: "lift", to: 0.2, seconds: LIFT_SECONDS },
      {
        do: "call",
        fn: (time) => {
          pallet.machine.go_to("CARRIED", time);
          sim.receiving.release_dock_pallet(pallet);
          forklift.carried = [pallet];
          forklift.machine.go_to("CARRYING", time);
        },
      },
      { do: "drive", points: [{ x: A_LANE_X, z: pallet_z }], reverse: true },
      // Por el carril hasta el andén y hacia adentro de la bodega
      { do: "drive", points: [{ x: A_LANE_X, z: bay.z }] },
      { do: "drive", points: [{ x: bay.x - CARRY_FORWARD, z: bay.z }], speed: 1.5 },
      {
        do: "call",
        fn: (time) => {
          forklift.machine.go_to("UNLOADING", time);
          forklift.carried = [];
          pallet.set_position(bay.x, 0.1, bay.z, 0);
          sim.receiving.deliver_dock_pallet(pallet, time);
          sim.emit({ type: "dock_pallet_delivered", pallet });
        },
      },
      { do: "lift", to: 0, seconds: LIFT_SECONDS },
      { do: "drive", points: [{ x: A_LANE_X, z: bay.z }], reverse: true },
      { do: "call", fn: () => (this.bay_claims[bay_index] = null) },
      { do: "call", fn: (time) => forklift.machine.go_to("RETURNING", time) },
    ];
  }

  // Sin tareas, la montacarga vuelve a su puesto del taller
  send_to_park(forklift) {
    const slot = this.park_slots.findIndex((occupant) => occupant === null);
    if (slot < 0) return;
    this.park_slots[slot] = forklift;
    forklift.park_index = slot;
    const spot = PARK_SPOTS_DOCK[slot];
    forklift.parking = true;
    forklift.start_script([
      ...this.to_lane_steps(forklift),
      { do: "drive", points: [{ x: A_LANE_X, z: GARAGE_LANE_Z }] },
      { do: "drive", points: [{ x: spot.x, z: GARAGE_LANE_Z }] },
      { do: "drive", points: [{ x: spot.x, z: spot.z }] },
      { do: "turn", yaw: -Math.PI / 2, seconds: 1.0 },
      { do: "call", fn: () => (forklift.parking = false) },
    ]);
  }

  // ---------- Un paso ----------
  step(now, dt) {
    this.sync_count(now);
    this.assign_tasks(now);
    this.forklifts.forEach((forklift) => {
      forklift.update(dt, now);
      if (forklift.moved_this_step) forklift.wheel_angle += (Math.hypot(forklift.x - forklift.prev_x, forklift.z - forklift.prev_z) / 0.3) * (forklift.is_reversing ? -1 : 1);
    });
    this.forklifts.forEach((forklift) => this.settle(forklift, now));
    this.forklifts = this.forklifts.filter((forklift) => {
      if (forklift.retiring && forklift.machine.state === "IDLE" && this.in_garage(forklift) && !forklift.is_busy) {
        this.free_park_slot(forklift);
        return false;
      }
      return true;
    });
  }

  settle(forklift, now) {
    if (forklift.is_busy) return;
    const state = forklift.machine.state;
    if (state === "MAINTENANCE") return;
    if (forklift.wants_maintenance && state === "IDLE") {
      forklift.machine.go_to("MAINTENANCE", now);
      this.send_to_park(forklift);
      return;
    }
    if (state === "IDLE" && !this.in_garage(forklift) && !forklift.task) this.send_to_park(forklift);
  }

  send_to_workshop(forklift) {
    this.send_to_park(forklift);
  }
}
