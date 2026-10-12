// El inventario del centro de distribución: arranca en cero y cada caja se anota cuando un camión la suelta en el riel (entra) y
// cuando sale en un camión de despacho (sale). Lo que hay ahora se cuenta desde las cajas vivas, agrupado por producto y por
// dónde está: en recibo, en la reserva, en el activo o en un pedido. También lleva la cuenta del dinero (en pesos colombianos):
// lo comprado y lo que vale lo que hay se miden a precio de compra al proveedor, y lo vendido a precio de venta al cliente.

import { CATEGORIES, SKUS, VAT_RATE } from "./catalog.js";

const DAY_SECONDS = 86400;

// En qué parte del proceso está una caja, según su estado. Las que siguen en el camión todavía no son inventario.
export const LOCATION_BY_STATE = {
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
  // (la de la reserva no pasa de lo que dan sus ubicaciones) y se dan también en unidades con el promedio de unidades por caja.
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
    const capacity = {
      staging: sim.config.get("staging_capacity"),
      reserve: Math.min(sim.config.get("reserve_capacity"), sim.storage.positions.length * sim.config.get("pallet_size")),
      active: sim.config.get("active_capacity"),
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

  // Cuántos días simulados han pasado (el reloj arranca en 0); con menos de una hora todavía no se puede promediar nada
  elapsed_days() {
    const days = this.sim.now / DAY_SECONDS;
    return days >= 1 / 24 ? days : null;
  }

  // El promedio de ventas por día de lo enviado hasta ahora: cajas, unidades y pesos a precio de venta (null si es muy pronto)
  average_daily_sales() {
    const days = this.elapsed_days();
    if (days === null) return null;
    const boxes = this.shipped_boxes.reduce((sum, value) => sum + value, 0);
    const units = this.shipped_units.reduce((sum, value) => sum + value, 0);
    const value = SKUS.reduce((sum, sku) => sum + this.shipped_units[sku.id] * sku.price, 0);
    return { days, boxes: boxes / days, units: units / days, value: value / days };
  }

  // La economía del centro de distribución: lo gastado en compras (cada caja que entra, a precio de compra), lo que vale hoy la
  // mercancía que hay (a precio de compra, por lugar), lo vendido (cada caja que sale, a precio de venta al público, con IVA), el IVA de
  // esas ventas, el costo de eso vendido y la utilidad bruta (ventas sin IVA menos costo). Se da en total, por producto y por categoría.
  // Siempre se cumple: comprado = lo que hay + costo de lo vendido.
  economy() {
    const places = { staging: 0, reserve: 0, active: 0, other: 0 };
    const stock_units = Array(SKUS.length).fill(0);
    this.sim.boxes.forEach((box) => {
      const location = LOCATION_BY_STATE[box.machine.state];
      if (!location) return;
      const value = box.units * SKUS[box.sku_id].cost;
      places[location === "staging" || location === "reserve" || location === "active" ? location : "other"] += value;
      stock_units[box.sku_id] += box.units;
    });
    const by_sku = SKUS.map((sku) => {
      const purchased = this.received_units[sku.id] * sku.cost;
      const sold = this.shipped_units[sku.id] * sku.price;
      const net = sold / (1 + VAT_RATE);
      const cogs = this.shipped_units[sku.id] * sku.cost;
      return {
        sku_id: sku.id,
        cost: sku.cost,
        price: sku.price,
        received_units: this.received_units[sku.id],
        stock_units: stock_units[sku.id],
        shipped_units: this.shipped_units[sku.id],
        purchased,
        inventory: stock_units[sku.id] * sku.cost,
        sold,
        net,
        cogs,
        profit: net - cogs,
      };
    });
    const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
    const by_category = CATEGORIES.map((category, index) => {
      const rows = by_sku.filter((row) => SKUS[row.sku_id].category_index === index);
      return {
        category_index: index,
        received_units: sum(rows, "received_units"),
        stock_units: sum(rows, "stock_units"),
        shipped_units: sum(rows, "shipped_units"),
        purchased: sum(rows, "purchased"),
        inventory: sum(rows, "inventory"),
        sold: sum(rows, "sold"),
        net: sum(rows, "net"),
        cogs: sum(rows, "cogs"),
        profit: sum(rows, "profit"),
      };
    });
    const sold = sum(by_sku, "sold");
    const net = sum(by_sku, "net");
    const cogs = sum(by_sku, "cogs");
    const days = this.elapsed_days();
    return {
      purchased: sum(by_sku, "purchased"),
      purchased_units: sum(by_sku, "received_units"),
      inventory: Object.values(places).reduce((total, value) => total + value, 0),
      inventory_units: sum(by_sku, "stock_units"),
      places,
      sold,
      vat: sold - net,
      net,
      sold_units: sum(by_sku, "shipped_units"),
      cogs,
      profit: net - cogs,
      margin: net > 0 ? (net - cogs) / net : null,
      sold_per_day: days === null ? null : sold / days,
      days,
      by_sku,
      by_category,
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
