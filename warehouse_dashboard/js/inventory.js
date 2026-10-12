// El inventario del centro de distribución: arranca en cero y cada caja se anota cuando un camión la suelta en el riel (entra) y
// cuando sale en un camión de despacho (sale). Lo que hay ahora se cuenta desde las cajas vivas, agrupado por producto y por
// dónde está: en recibo, en la reserva, en el activo o en un pedido.

import { CATEGORIES, SKUS } from "./catalog.js";
import { ACTIVE_SKU_CAPACITY, SKU_COUNT } from "./config.js";

// En qué parte del proceso está una caja, según su estado. Las que siguen en el camión todavía no son inventario.
const LOCATION_BY_STATE = {
  ON_RAIL: "rails",
  ON_DOCK_PALLET: "rails",
  IN_STAGING: "staging",
  ON_PALLET: "receiving",
  IN_TOTE: "receiving",
  IN_RESERVE: "reserve",
  IN_ACTIVE: "active",
  PICKED: "order",
  ON_FLOOR_BELT: "order",
  ON_MAIN_BELT: "order",
  IN_WALL_SLOT: "order",
  IN_ORDER_TOTE: "order",
  PACKING: "order",
  PACKED: "order",
  ON_DISPATCH_BELT: "order",
  IN_DISPATCH_BIN: "order",
  LOADED: "order",
};

export const LOCATIONS = [
  { key: "rails", label: "En muelle" },
  { key: "staging", label: "Bodega de recibo" },
  { key: "receiving", label: "Armando pallets" },
  { key: "reserve", label: "Reserva" },
  { key: "active", label: "Activo" },
  { key: "order", label: "En pedidos" },
];

export class Inventory {
  constructor(sim) {
    this.sim = sim;
    this.received_boxes = Array(SKUS.length).fill(0);
    this.received_units = Array(SKUS.length).fill(0);
    this.shipped_boxes = Array(SKUS.length).fill(0);
    this.shipped_units = Array(SKUS.length).fill(0);
  }

  // Una caja del camión entra al inventario
  receive(box) {
    this.received_boxes[box.sku_id] += 1;
    this.received_units[box.sku_id] += box.units;
    if (box.truck && box.truck.entry) {
      box.truck.entry.unloaded_boxes = (box.truck.entry.unloaded_boxes || 0) + 1;
      box.truck.entry.unloaded_units = (box.truck.entry.unloaded_units || 0) + box.units;
    }
  }

  ship(box) {
    this.shipped_boxes[box.sku_id] += 1;
    this.shipped_units[box.sku_id] += box.units;
  }

  // La mercancía total del centro de distribución y cómo se reparte: bodega de stock, reserva, activo y lo demás (muelle, armado de
  // pallets y cubetas, y pedidos en proceso), más lo que ya se envió, con lo que cabe en cada lugar. Las capacidades son en cajas
  // (la reserva, pallets × cajas por pallet) y se dan también en unidades con el promedio de unidades por caja del catálogo.
  summary() {
    const { sim } = this;
    const places = { staging: { boxes: 0, units: 0 }, reserve: { boxes: 0, units: 0 }, active: { boxes: 0, units: 0 }, other: { boxes: 0, units: 0 } };
    sim.boxes.forEach((box) => {
      const location = LOCATION_BY_STATE[box.machine.state];
      if (!location) return;
      const place = places[location === "staging" || location === "reserve" || location === "active" ? location : "other"];
      place.boxes += 1;
      place.units += box.units;
    });
    const average_units = SKUS.reduce((sum, sku) => sum + sku.units_per_box, 0) / SKUS.length;
    const reserve_pallets = Math.min(sim.storage.positions.length, sim.config.get("reserve_capacity"));
    const capacity = {
      staging: sim.config.get("staging_capacity"),
      reserve: reserve_pallets * sim.config.get("pallet_size"),
      active: SKU_COUNT * ACTIVE_SKU_CAPACITY,
    };
    const total = { boxes: 0, units: 0 };
    Object.values(places).forEach((place) => {
      total.boxes += place.boxes;
      total.units += place.units;
    });
    return {
      total,
      ...places,
      shipped: { boxes: this.shipped_boxes.reduce((sum, value) => sum + value, 0), units: this.shipped_units.reduce((sum, value) => sum + value, 0) },
      capacity: Object.fromEntries(Object.entries(capacity).map(([key, boxes]) => [key, { boxes, units: Math.round(boxes * average_units) }])),
    };
  }

  // Lo que hay ahora, por producto, por categoría y en total
  snapshot() {
    const by_sku = SKUS.map((sku) => {
      const entry = { sku_id: sku.id, boxes: 0, units: 0, received_units: this.received_units[sku.id], shipped_units: this.shipped_units[sku.id] };
      LOCATIONS.forEach((location) => {
        entry[location.key] = 0;
      });
      return entry;
    });
    this.sim.boxes.forEach((box) => {
      const location = LOCATION_BY_STATE[box.machine.state];
      if (!location) return;
      const entry = by_sku[box.sku_id];
      entry.boxes += 1;
      entry.units += box.units;
      entry[location] += 1;
    });
    const by_category = CATEGORIES.map((category, index) => {
      const rows = by_sku.filter((entry) => SKUS[entry.sku_id].category_index === index);
      return {
        category_index: index,
        boxes: rows.reduce((sum, entry) => sum + entry.boxes, 0),
        units: rows.reduce((sum, entry) => sum + entry.units, 0),
        received_units: rows.reduce((sum, entry) => sum + entry.received_units, 0),
        shipped_units: rows.reduce((sum, entry) => sum + entry.shipped_units, 0),
      };
    });
    return {
      by_sku,
      by_category,
      boxes: by_category.reduce((sum, entry) => sum + entry.boxes, 0),
      units: by_category.reduce((sum, entry) => sum + entry.units, 0),
      received_units: by_category.reduce((sum, entry) => sum + entry.received_units, 0),
      shipped_units: by_category.reduce((sum, entry) => sum + entry.shipped_units, 0),
    };
  }
}
