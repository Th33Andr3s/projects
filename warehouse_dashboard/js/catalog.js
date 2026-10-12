// El catálogo de la bodega: las 5 categorías de mercancía (una por piso del activo), los 20 productos (SKU, cuatro por categoría)
// con su tono, el tamaño de su caja y las unidades que lleva cada caja, y las regiones de Colombia de donde llegan los camiones.
// Son datos puros: los usan la simulación, el dibujo y la interfaz.
//
// El SKU `n` es el producto número `floor(n / 5)` de la categoría `n mod 5`, y esa categoría es también su piso del activo.

export const CD_CITY = "Bogotá";

// Cada categoría tiene un color base (el de sus rótulos y su fila de la leyenda) y cuatro tonos de la misma familia
export const CATEGORIES = [
  { key: "toys", name: "Juguetes", color: "#f97316" },
  { key: "women_clothes", name: "Ropa de mujer", color: "#ec4899" },
  { key: "kids_clothes", name: "Ropa de niño", color: "#14b8a6" },
  { key: "men_clothes", name: "Ropa de hombre", color: "#3b82f6" },
  { key: "technology", name: "Tecnología", color: "#8b5cf6" },
];

// Por categoría, sus cuatro productos: nombre, tono, unidades por caja y tamaño de la caja en metros (largo, alto, fondo)
const PRODUCTS_BY_CATEGORY = [
  [
    { name: "Muñecas", color: "#f97316", units: 12, size: [0.5, 0.42, 0.5] },
    { name: "Carros de juguete", color: "#fb923c", units: 24, size: [0.58, 0.34, 0.46] },
    { name: "Bloques para armar", color: "#c2410c", units: 16, size: [0.42, 0.42, 0.42] },
    { name: "Peluches", color: "#fdba74", units: 8, size: [0.6, 0.5, 0.5] },
  ],
  [
    { name: "Blusas", color: "#ec4899", units: 30, size: [0.5, 0.28, 0.4] },
    { name: "Jeans", color: "#f472b6", units: 24, size: [0.52, 0.3, 0.4] },
    { name: "Vestidos", color: "#be185d", units: 20, size: [0.56, 0.32, 0.44] },
    { name: "Chaquetas de mujer", color: "#f9a8d4", units: 16, size: [0.6, 0.36, 0.46] },
  ],
  [
    { name: "Camisetas de niño", color: "#14b8a6", units: 36, size: [0.44, 0.26, 0.36] },
    { name: "Pijamas de niño", color: "#2dd4bf", units: 24, size: [0.46, 0.28, 0.38] },
    { name: "Uniformes escolares", color: "#0f766e", units: 20, size: [0.52, 0.3, 0.4] },
    { name: "Buzos de niño", color: "#5eead4", units: 18, size: [0.5, 0.32, 0.42] },
  ],
  [
    { name: "Camisas", color: "#3b82f6", units: 30, size: [0.52, 0.28, 0.4] },
    { name: "Pantalones", color: "#60a5fa", units: 24, size: [0.54, 0.3, 0.42] },
    { name: "Camisetas deportivas", color: "#1d4ed8", units: 28, size: [0.5, 0.3, 0.4] },
    { name: "Chaquetas de hombre", color: "#93c5fd", units: 16, size: [0.62, 0.36, 0.46] },
  ],
  [
    { name: "Celulares", color: "#8b5cf6", units: 10, size: [0.34, 0.22, 0.34] },
    { name: "Audífonos", color: "#a78bfa", units: 40, size: [0.4, 0.24, 0.36] },
    { name: "Tablets", color: "#6d28d9", units: 12, size: [0.48, 0.18, 0.38] },
    { name: "Cargadores", color: "#c4b5fd", units: 60, size: [0.42, 0.3, 0.42] },
  ],
];

export const SKU_TOTAL = CATEGORIES.length * 4;

export const SKUS = Array.from({ length: SKU_TOTAL }, (_, sku_id) => {
  const category_index = sku_id % CATEGORIES.length;
  const product = PRODUCTS_BY_CATEGORY[category_index][Math.floor(sku_id / CATEGORIES.length)];
  return { id: sku_id, category_index, name: product.name, color: product.color, units_per_box: product.units, size: product.size };
});

export function sku_color(sku_id) {
  return SKUS[sku_id].color;
}

export function sku_name(sku_id) {
  return `SKU ${String(sku_id + 1).padStart(2, "0")}`;
}

// "SKU 07 · Vestidos"
export function sku_label(sku_id) {
  return `${sku_name(sku_id)} · ${SKUS[sku_id].name}`;
}

export function sku_category(sku_id) {
  return CATEGORIES[SKUS[sku_id].category_index];
}

// Los cuatro SKU de una categoría
export function category_sku_ids(category_index) {
  return SKUS.filter((sku) => sku.category_index === category_index).map((sku) => sku.id);
}

// Las regiones naturales de Colombia a las que se llega por carretera (sin la insular ni las ciudades sin vía), con sus ciudades,
// los kilómetros aproximados por carretera desde el centro de distribución (Bogotá) y un peso: cuánto más piden las ciudades grandes.
// De aquí salen los orígenes de los camiones de recibo y los destinos de los pedidos.
export const REGIONS = [
  {
    key: "caribe",
    name: "Caribe",
    color: "#f59e0b",
    cities: [["Barranquilla", 1000, 8], ["Cartagena", 1050, 6], ["Santa Marta", 960, 4], ["Valledupar", 840, 3], ["Montería", 780, 3], ["Sincelejo", 800, 2], ["Riohacha", 1050, 2]],
  },
  {
    key: "andina",
    name: "Andina",
    color: "#10b981",
    cities: [["Medellín", 415, 9], ["Bucaramanga", 400, 5], ["Cúcuta", 560, 4], ["Pereira", 320, 4], ["Manizales", 300, 3], ["Armenia", 290, 3], ["Tunja", 150, 3], ["Ibagué", 195, 3], ["Neiva", 300, 3]],
  },
  {
    key: "pacifica",
    name: "Pacífica",
    color: "#3b82f6",
    cities: [["Cali", 460, 9], ["Pasto", 830, 3], ["Popayán", 560, 2], ["Buenaventura", 520, 2], ["Quibdó", 650, 1]],
  },
  { key: "orinoquia", name: "Orinoquía", color: "#ef4444", cities: [["Villavicencio", 90, 4], ["Yopal", 330, 2], ["Arauca", 760, 1]] },
  { key: "amazonia", name: "Amazonía", color: "#8b5cf6", cities: [["Florencia", 560, 1], ["Mocoa", 760, 1], ["San José del Guaviare", 390, 1]] },
];

// Los destinos posibles de un pedido: todas las ciudades de arriba, en un solo arreglo
export const DESTINATIONS = REGIONS.flatMap((region, region_index) =>
  region.cities.map(([city, kilometers, weight], city_index) => ({
    index: 0,
    city,
    kilometers,
    weight,
    region: region.name,
    region_index,
    city_index,
    color: region.color,
    text: `${city} (Región ${region.name})`,
  })),
).map((destination, index) => ({ ...destination, index }));

export const DESTINATION_WEIGHT_TOTAL = DESTINATIONS.reduce((sum, destination) => sum + destination.weight, 0);

// Una ruta de región: de dónde viene (o a dónde va) un camión
export function make_route(region_index, city_index, inbound) {
  const region = REGIONS[region_index];
  const [city, kilometers] = region.cities[city_index];
  const place = `${city} (Región ${region.name})`;
  return {
    region: region.name,
    city,
    kilometers,
    text: inbound ? `${place} → ${CD_CITY}` : `${CD_CITY} → ${place}`,
  };
}
