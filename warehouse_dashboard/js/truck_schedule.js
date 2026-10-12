// La programación de los camiones de recibo: para cada día y cada franja (mañana, tarde, noche) se sortean cuántos camiones
// configuró la persona, a qué hora llegan a la talanquera, qué categoría traen (según la prioridad), de qué región de Colombia
// vienen y qué cajas llevan. La programación de hoy y de mañana está siempre armada, así se pueden poner restricciones a un
// camión antes de que llegue.
//
// Cada camión lleva un número (el que se pinta en su contenedor) que no cambia. Si la persona cambia cuántos camiones van en
// una franja que todavía no ha empezado, esa franja se vuelve a sortear con números nuevos.

import { FIRST_TRUCK_SECONDS } from "./config.js";
import { CATEGORIES, REGIONS, SKUS, category_sku_ids, make_route } from "./catalog.js";
import { SLOTS, SLOT_OFFSETS, slot_label } from "./yard_config.js";

export const DAY_SECONDS = 86400;
// Lo que tarda un camión en recorrer la carretera desde el borde de la pantalla hasta la talanquera
export const TRUCK_LEAD_SECONDS = 30;
// Cuánto separa la salida de dos camiones pedidos a mano
const MANUAL_SPACING_SECONDS = 5;
export const MAX_MANUAL_TRUCKS = 40;

// Cuándo empieza y termina una franja de un día (segundos desde el arranque del reloj)
export function slot_window(day, slot_key) {
  const { start, length } = SLOT_OFFSETS[slot_key];
  const base = (day - 1) * DAY_SECONDS + start;
  return { start: base, end: base + length };
}

// Desde cuándo vale una restricción de franja para un camión: la primera vez que empieza esa franja en el momento en que llega el
// camión o después (si ya está en ella, desde que llega)
export function slot_threshold(entry, from_slot) {
  const { start, length } = SLOT_OFFSETS[from_slot];
  for (let day = Math.max(1, entry.day - 1); day < entry.day + 3; day += 1) {
    const base = (day - 1) * DAY_SECONDS + start;
    if (base + length > entry.arrival_time) return base;
  }
  return entry.arrival_time;
}

export class TruckSchedule {
  constructor(sim) {
    this.sim = sim;
    this.entries = [];
    this.next_id = 1;
    // Por cada día y franja: cuántos camiones se sortearon y cuáles
    this.generated = new Map();
  }

  // Se llama en cada paso: deja armados hoy y mañana, y vuelve a sortear las franjas futuras si cambió el número de camiones
  update(now) {
    const day = Math.floor(now / DAY_SECONDS) + 1;
    for (let offset = 0; offset < 2; offset += 1) {
      SLOTS.forEach((slot) => this.ensure(day + offset, slot, now));
    }
  }

  ensure(day, slot, now) {
    const key = `${day}:${slot.key}`;
    const count = this.sim.yard.get_count(slot.key);
    const generated = this.generated.get(key);
    if (!generated) {
      this.generate(key, day, slot, count, now);
      return;
    }
    if (generated.count !== count && slot_window(day, slot.key).start > now) {
      // Se quitan los camiones de esa franja que todavía no salieron a la carretera y se sortean de nuevo
      generated.entries.forEach((entry) => {
        if (entry.spawned) return;
        this.sim.events.cancel(entry.spawn_event_id);
        this.entries = this.entries.filter((candidate) => candidate !== entry);
      });
      this.generate(key, day, slot, count, now);
    }
  }

  generate(key, day, slot, count, now) {
    const { sim } = this;
    const window = slot_window(day, slot.key);
    const created = [];
    for (let index = 0; index < count; index += 1) {
      const jitter = sim.rng_agenda.float(0.1, 0.9);
      let arrival = window.start + ((index + jitter) * (window.end - window.start)) / count;
      // El primer camión del primer día llega pronto: así no hay que esperar horas a que pase algo
      if (day === 1 && slot.key === "morning" && index === 0) arrival = FIRST_TRUCK_SECONDS;
      created.push(this.make_entry(day, slot.key, arrival, now));
    }
    created.sort((first, second) => first.arrival_time - second.arrival_time);
    // Los números se reparten en el orden de llegada
    created.forEach((entry) => {
      entry.id = this.next_id;
      this.next_id += 1;
      entry.spawn_time = Math.max(now, entry.arrival_time - TRUCK_LEAD_SECONDS);
      entry.spawn_event_id = sim.events.schedule(entry.spawn_time, "truck_spawn", { entry });
      this.entries.push(entry);
    });
    this.entries.sort((first, second) => first.arrival_time - second.arrival_time || first.id - second.id);
    this.generated.set(key, { count, entries: created });
  }

  // Sortea lo que trae un camión: categoría según la prioridad, región y ciudad de origen, y las cajas
  make_entry(day, slot_key, arrival, now) {
    const { sim } = this;
    const weights = CATEGORIES.map((_, index) => sim.yard.get_priority(index));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let pick = sim.rng_agenda.float(0, total);
    let category_index = 0;
    for (let index = 0; index < weights.length; index += 1) {
      pick -= weights[index];
      if (pick < 0) {
        category_index = index;
        break;
      }
    }
    const region_index = sim.rng_agenda.int(0, REGIONS.length - 1);
    const city_index = sim.rng_agenda.int(0, REGIONS[region_index].cities.length - 1);
    const box_count = Math.max(4, Math.round(sim.config.get("boxes_per_truck") * sim.rng_agenda.float(0.85, 1.15)));
    // Cajas de los cuatro productos de la categoría, sin repetir producto en cada tanda de cuatro
    const sku_ids = [];
    const category_skus = category_sku_ids(category_index);
    while (sku_ids.length < box_count) {
      sim.rng_agenda.shuffle([...category_skus]).forEach((sku_id) => {
        if (sku_ids.length < box_count) sku_ids.push(sku_id);
      });
    }
    return {
      id: 0,
      day,
      slot: slot_key,
      arrival_time: arrival,
      arrival_text: sim.format_time(arrival),
      spawn_time: 0,
      spawn_event_id: null,
      spawned: false,
      category_index,
      sku_ids,
      box_count,
      units: sku_ids.reduce((sum, sku_id) => sum + SKUS[sku_id].units_per_box, 0),
      route: make_route(region_index, city_index, true),
      truck: null,
      finished: false,
      created_at: now,
    };
  }

  // La persona pide que lleguen `count` camiones ya: salen a la carretera uno tras otro, con unos segundos entre sí para que no
  // se pisen, y no cuentan en los camiones por franja. Devuelve las entradas nuevas.
  add_manual(count, now) {
    const { sim } = this;
    const day = Math.floor(now / DAY_SECONDS) + 1;
    const created = [];
    for (let index = 0; index < count; index += 1) {
      const spawn_time = now + index * MANUAL_SPACING_SECONDS;
      const entry = this.make_entry(day, "manual", spawn_time + TRUCK_LEAD_SECONDS, now);
      entry.manual = true;
      entry.id = this.next_id;
      this.next_id += 1;
      entry.spawn_time = spawn_time;
      entry.spawn_event_id = sim.events.schedule(spawn_time, "truck_spawn", { entry });
      this.entries.push(entry);
      created.push(entry);
    }
    this.entries.sort((first, second) => first.arrival_time - second.arrival_time || first.id - second.id);
    return created;
  }

  // El próximo camión que todavía no sale a la carretera tarda `factor` veces lo que le faltaba para llegar. Devuelve ese camión.
  delay_next(now, factor) {
    const entry = this.entries.find((candidate) => !candidate.spawned);
    if (!entry) return null;
    entry.original_arrival_time = entry.arrival_time;
    this.move_arrival(entry, now + Math.max(0, entry.arrival_time - now) * factor, now);
    return entry;
  }

  undo_delay(entry, now) {
    if (entry.spawned || entry.original_arrival_time === undefined) return;
    this.move_arrival(entry, entry.original_arrival_time, now);
    delete entry.original_arrival_time;
  }

  move_arrival(entry, arrival, now) {
    const { sim } = this;
    sim.events.cancel(entry.spawn_event_id);
    entry.arrival_time = arrival;
    entry.arrival_text = sim.format_time(arrival);
    entry.spawn_time = Math.max(now, arrival - TRUCK_LEAD_SECONDS);
    entry.spawn_event_id = sim.events.schedule(entry.spawn_time, "truck_spawn", { entry });
    this.entries.sort((first, second) => first.arrival_time - second.arrival_time || first.id - second.id);
  }

  find(id) {
    return this.entries.find((entry) => entry.id === id) || null;
  }

  // ¿Puede este camión entrar ya al muelle `dock_index`? Respeta su muelle fijo y la franja desde la que puede entrar.
  can_use_dock(entry, dock_index, now) {
    const rule = this.sim.yard.get_rule(entry.id);
    if (!rule) return true;
    if (rule.dock !== null && rule.dock !== dock_index) return false;
    return rule.from_slot === null || now >= slot_threshold(entry, rule.from_slot);
  }

  restriction_text(entry) {
    const rule = this.sim.yard.get_rule(entry.id);
    if (!rule) return "Ninguna";
    const parts = [];
    if (rule.dock !== null) parts.push(`muelle ${rule.dock + 1}`);
    if (rule.from_slot !== null) parts.push(`desde la ${slot_label(rule.from_slot).toLowerCase()}`);
    return parts.join(", ");
  }

  // Lo que dice la tabla en la columna de estado
  status_text(entry) {
    const truck = entry.truck;
    if (!truck) return entry.spawned ? "En camino" : "Programado";
    const states = {
      ARRIVING: "En la entrada",
      QUEUED: `Parqueado, plaza ${truck.bay ? truck.bay.number : "—"}`,
      DOCKING: `Yendo al muelle ${truck.dock ? truck.dock.index + 1 : "—"}`,
      UNLOADING: `Descargando en el muelle ${truck.dock ? truck.dock.index + 1 : "—"}`,
      LEAVING_EMPTY: "Saliendo",
      GONE: "Terminado",
    };
    return states[truck.machine.state] || truck.machine.label;
  }
}
