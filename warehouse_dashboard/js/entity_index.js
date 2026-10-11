// La lista de todo lo que se puede inspeccionar: es el equivalente accesible del clic sobre la escena (para teclado y lectores
// de pantalla) y lo que busca el cuadro de búsqueda. Son funciones puras sobre la simulación.

import { normalize_search_text } from "./format.js";
import { sku_name } from "./config.js";

// Cuántos resultados se muestran como máximo: una lista de miles de cajas no sirve para nadie
export const MAX_LIST_ITEMS = 120;

function item(group, entity, label, state) {
  return { group, entity, label, state, search_text: normalize_search_text(`${group} ${label} ${state}`) };
}

// Todas las entidades de la simulación, agrupadas por tipo. Las cajas sueltas no se listan: se llega a ellas por su pedido.
export function list_entities(sim) {
  const items = [];
  sim.receiving.trucks.forEach((truck) => items.push(item("Camiones", truck, `Camión de recibo ${truck.id}`, truck.machine.label)));
  sim.outbound.trucks.forEach((truck) => items.push(item("Camiones", truck, `Camión de despacho ${truck.id}`, truck.machine.label)));
  sim.storage.forklifts.forEach((forklift) => items.push(item("Montacargas", forklift, `Montacargas ${forklift.id}`, forklift.machine.label)));
  sim.orders.pickers.flat().forEach((worker) => items.push(item("Personas", worker, `Operario de picking ${worker.id} (piso ${worker.floor + 1})`, worker.machine.label)));
  sim.outbound.operators.forEach((worker) => items.push(item("Personas", worker, `Operario de muro ${worker.id}`, worker.machine.label)));
  sim.outbound.packers.forEach((worker) => items.push(item("Personas", worker, `Empacador ${worker.id}`, worker.machine.label)));
  sim.orders.orders.forEach((order) => items.push(item("Pedidos", order, `Pedido #${order.id}`, order.machine.label)));
  sim.pallets.forEach((pallet) => {
    // Los pallets guardados en la reserva son muchos; solo se listan los que están en movimiento o formándose
    if (pallet.machine.state !== "IN_RESERVE") items.push(item("Pallets", pallet, `Pallet ${pallet.id} (${sku_name(pallet.sku_id)})`, pallet.machine.label));
  });
  sim.totes.forEach((tote) => items.push(item("Cubetas", tote, `${tote.variant === "in" ? "Cubeta de entrada" : "Cubeta de pedido"} ${tote.id}`, tote.machine.label)));
  sim.parcels.forEach((parcel) => items.push(item("Paquetes", parcel, `Paquete ${parcel.id} (pedido #${parcel.order.id})`, "Rumbo a despacho")));
  sim.belts.forEach((belt) => items.push(item("Bandas", belt, belt.get_info(sim.now).id_text, belt.machine.label)));
  sim.receiving.docks.forEach((dock) => items.push(item("Muelles y puertas", dock, `Muelle ${dock.index + 1}`, dock.enabled ? dock.machine.label : "Cerrado")));
  sim.outbound.doors.forEach((door) => items.push(item("Muelles y puertas", door, `Puerta ${door.index + 1}`, door.enabled ? door.machine.label : "Cerrada")));
  sim.orders.walls.forEach((wall) => {
    items.push(item("Muros", wall, `Muro ${wall.index + 1}`, wall.enabled ? "En servicio" : "Cerrado"));
    wall.slots.forEach((slot) => {
      if (slot.enabled && slot.machine.state !== "FREE") items.push(item("Muros", slot, `Casilla ${slot.label}`, slot.machine.label));
    });
  });
  sim.outbound.stations.forEach((station) => items.push(item("Empaque", station, `Estación ${station.index + 1}`, station.enabled ? station.machine.label : "Cerrada")));
  items.push(item("Elevador", sim.storage.elevator, "Elevador de cubetas", sim.storage.elevator.machine.label));
  return items;
}

// Filtra por un texto (sin tildes ni mayúsculas); cada palabra debe aparecer. Devuelve los primeros `limit` y cuántos había.
export function filter_entities(items, query, limit = MAX_LIST_ITEMS) {
  const words = normalize_search_text(query).split(/\s+/).filter(Boolean);
  const matches = words.length === 0 ? items : items.filter((entry) => words.every((word) => entry.search_text.includes(word)));
  return { shown: matches.slice(0, limit), total: matches.length };
}
