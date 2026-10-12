// El catálogo de la bodega: las categorías de mercancía, los productos (SKU) con su tono, el tamaño de su caja, las unidades que lleva
// cada caja y su prioridad, su precio de compra al proveedor y su precio de venta al cliente (en pesos colombianos por unidad), y las
// regiones de Colombia de donde llegan los camiones. Son datos que usan la simulación, el dibujo y la interfaz.
//
// De fábrica hay 5 categorías y 20 productos (cuatro por categoría), pero la persona puede crear categorías y productos nuevos desde
// la sección Mercancía. Esos cambios se guardan en el navegador y valen al reiniciar: al cargar la página, este módulo lee lo
// guardado y llena `CATEGORIES` y `SKUS` (los mismos arreglos, por eso todos los demás módulos los ven al día). El SKU `n` es el
// producto número `n` de la lista; los productos de fábrica quedan en el mismo orden de siempre (el SKU `n` es el producto
// `floor(n / 5)` de la categoría `n mod 5`).

import { load_settings } from "./settings.js";

export const CD_CITY = "Bogotá";

export const MAX_PRODUCTS = 60;
export const MAX_CATEGORIES = 20;
export const MAX_NAME_LENGTH = 40;
// El precio más alto que se acepta por unidad (COP) y el recargo que se pone si un precio guardado no sirve
export const MAX_PRICE = 100000000;
// El IVA general de Colombia: el precio de venta es el que paga el cliente (con IVA) y el costo de compra es sin IVA
export const VAT_RATE = 0.19;
const FALLBACK_COST = 10000;
const FALLBACK_MARKUP = 1.25;

// Cuánto pesa cada nivel de prioridad: al sortear qué trae cada camión y al decidir quién pasa primero a un muelle libre
export const PRIORITY_LEVELS = [
  { value: 1, label: "Normal" },
  { value: 3, label: "Alta" },
  { value: 5, label: "Máxima" },
];

// Tamaños de caja que se ofrecen al crear un producto (largo, alto, fondo en metros)
export const BOX_SIZES = [
  { key: "small", label: "Pequeña", size: [0.34, 0.22, 0.34] },
  { key: "medium", label: "Mediana", size: [0.5, 0.3, 0.4] },
  { key: "large", label: "Grande", size: [0.6, 0.4, 0.5] },
];

// Los productos de fábrica, por categoría: nombre, clave, tono, unidades por caja, tamaño de la caja y precios en pesos colombianos por
// unidad. Son productos reales que se venden en Colombia (marca y presentación). El precio de venta (`price`, con IVA) es el que se vio en
// Falabella.com.co, Studio F y Arturo Calle el 12 de octubre de 2026; el de compra al proveedor (`cost`, sin IVA) y las unidades por caja
// son estimados: no hay precios mayoristas públicos, así que se derivaron con márgenes brutos típicos de cada categoría
// (juguetes 30–45 %, ropa 42–60 %, celulares y tablets 10–12 %, accesorios 28–30 %). Ver PLAN.md, sección 29.
const DEFAULT_CATEGORIES = [
  { key: "toys", name: "Juguetes", color: "#f97316" },
  { key: "women_clothes", name: "Ropa de mujer", color: "#ec4899" },
  { key: "kids_clothes", name: "Ropa de niño", color: "#14b8a6" },
  { key: "men_clothes", name: "Ropa de hombre", color: "#3b82f6" },
  { key: "technology", name: "Tecnología", color: "#8b5cf6" },
];

const DEFAULT_PRODUCTS_BY_CATEGORY = [
  [
    { key: "dolls", name: "Muñeca Barbie Fashionista", color: "#f97316", units: 12, size: [0.5, 0.42, 0.5], cost: 31709, price: 62890 },
    { key: "toy_cars", name: "Hot Wheels pack x5 autos", color: "#fb923c", units: 24, size: [0.58, 0.34, 0.46], cost: 26164, price: 47900 },
    { key: "building_blocks", name: "LEGO Classic caja mediana 10696", color: "#c2410c", units: 6, size: [0.42, 0.42, 0.42], cost: 147000, price: 249900 },
    { key: "plush", name: "Peluche Squishmallows 6,5 pulgadas", color: "#fdba74", units: 24, size: [0.6, 0.5, 0.5], cost: 48483, price: 104900 },
  ],
  [
    { key: "blouses", name: "Blusa tank top bordada Studio F", color: "#ec4899", units: 30, size: [0.5, 0.28, 0.4], cost: 34564, price: 97930 },
    { key: "jeans", name: "Jean skinny mujer Levi's 721", color: "#f472b6", units: 20, size: [0.52, 0.3, 0.4], cost: 73368, price: 167900 },
    { key: "dresses", name: "Vestido midi casual Basement", color: "#be185d", units: 20, size: [0.56, 0.32, 0.44], cost: 33610, price: 99990 },
    { key: "women_jackets", name: "Chaqueta mujer cuello alto Arturo Calle", color: "#f9a8d4", units: 12, size: [0.6, 0.36, 0.46], cost: 59965, price: 169900 },
  ],
  [
    { key: "kids_t_shirts", name: "Camiseta niño algodón Ecko", color: "#14b8a6", units: 48, size: [0.44, 0.26, 0.36], cost: 17013, price: 44990 },
    { key: "kids_pajamas", name: "Pijama niño algodón Federation", color: "#2dd4bf", units: 36, size: [0.46, 0.28, 0.38], cost: 20165, price: 59990 },
    { key: "school_uniforms", name: "Sudadera escolar Urban Plus", color: "#0f766e", units: 24, size: [0.52, 0.3, 0.4], cost: 37773, price: 89900 },
    { key: "kids_hoodies", name: "Buzo niño algodón Levi's", color: "#5eead4", units: 24, size: [0.5, 0.32, 0.42], cost: 40962, price: 97490 },
  ],
  [
    { key: "shirts", name: "Camisa business Arturo Calle", color: "#3b82f6", units: 24, size: [0.52, 0.28, 0.4], cost: 47997, price: 135991 },
    { key: "pants", name: "Pantalón casual slim Arturo Calle", color: "#60a5fa", units: 20, size: [0.54, 0.3, 0.42], cost: 67055, price: 189990 },
    { key: "sport_t_shirts", name: "Camiseta Nike Dri-FIT running", color: "#1d4ed8", units: 48, size: [0.5, 0.3, 0.4], cost: 87726, price: 179990 },
    { key: "men_jackets", name: "Chaqueta impermeable Arturo Calle", color: "#93c5fd", units: 10, size: [0.62, 0.36, 0.46], cost: 95259, price: 269900 },
  ],
  [
    { key: "phones", name: "Celular Motorola Moto G06 128 GB", color: "#8b5cf6", units: 10, size: [0.34, 0.22, 0.34], cost: 393202, price: 519900 },
    { key: "headphones", name: "Audífonos Sony WH-CH520", color: "#a78bfa", units: 10, size: [0.4, 0.24, 0.36], cost: 72545, price: 119900 },
    { key: "tablets", name: "Tablet Samsung Galaxy Tab A11", color: "#6d28d9", units: 10, size: [0.48, 0.18, 0.38], cost: 443624, price: 599900 },
    { key: "chargers", name: "Cargador USB-C 20 W Apple", color: "#c4b5fd", units: 50, size: [0.42, 0.3, 0.42], cost: 58765, price: 99900 },
  ],
];

// El catálogo de fábrica: los productos en el orden de siempre (el SKU n es el producto floor(n / 5) de la categoría n mod 5)
export function default_catalog() {
  const categories = DEFAULT_CATEGORIES.map((category) => ({ ...category }));
  const products = [];
  const per_category = DEFAULT_PRODUCTS_BY_CATEGORY[0].length;
  for (let product_index = 0; product_index < per_category; product_index += 1) {
    DEFAULT_PRODUCTS_BY_CATEGORY.forEach((list, category_index) => {
      const product = list[product_index];
      products.push({ key: product.key, name: product.name, category: categories[category_index].key, color: product.color, units: product.units, size: [...product.size], priority: 1, cost: product.cost, price: product.price });
    });
  }
  return { categories, products };
}

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

function clean_name(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH) : "";
}

function valid_money(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_PRICE;
}

// Los precios de fábrica de un producto por su clave (para completar un catálogo guardado antes de que hubiera precios)
function default_prices(key) {
  const found = DEFAULT_PRODUCTS_BY_CATEGORY.flat().find((product) => product.key === key);
  return found && valid_money(found.cost) && valid_money(found.price) ? { cost: found.cost, price: found.price } : null;
}

function valid_size(size) {
  return Array.isArray(size) && size.length === 3 && size.every((value) => Number.isFinite(value) && value >= 0.15 && value <= 0.8);
}

// Revisa un catálogo (por ejemplo el que estaba guardado) y devuelve uno bien formado, o null si no sirve. Lo que no se reconoce
// se descarta: un producto con datos malos se quita y una categoría sin nombre bueno se descarta con sus productos.
export function normalize_catalog(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.categories) || !Array.isArray(data.products)) return null;
  const categories = [];
  const category_keys = new Set();
  data.categories.slice(0, MAX_CATEGORIES).forEach((category) => {
    if (!category || !KEY_PATTERN.test(category.key) || category_keys.has(category.key)) return;
    const name = clean_name(category.name);
    if (!name || !COLOR_PATTERN.test(category.color)) return;
    category_keys.add(category.key);
    categories.push({ key: category.key, name, color: category.color.toLowerCase() });
  });
  const products = [];
  const product_keys = new Set();
  data.products.slice(0, MAX_PRODUCTS).forEach((product) => {
    if (!product || !KEY_PATTERN.test(product.key) || product_keys.has(product.key) || !category_keys.has(product.category)) return;
    const name = clean_name(product.name);
    const units = Number(product.units);
    if (!name || !COLOR_PATTERN.test(product.color) || !Number.isInteger(units) || units < 1 || units > 500 || !valid_size(product.size)) return;
    const priority = PRIORITY_LEVELS.some((level) => level.value === product.priority) ? product.priority : 1;
    // Los precios: si faltan o no sirven se usan los de fábrica del producto (o uno genérico), y el de venta siempre es mayor al de compra
    const fallback = default_prices(product.key);
    let cost = valid_money(product.cost) ? product.cost : fallback ? fallback.cost : FALLBACK_COST;
    let price = valid_money(product.price) ? product.price : fallback ? fallback.price : Math.round(cost * FALLBACK_MARKUP);
    if (price <= cost) price = Math.min(MAX_PRICE, Math.max(cost + 1, Math.round(cost * FALLBACK_MARKUP)));
    if (price <= cost) cost = price - 1;
    product_keys.add(product.key);
    products.push({ key: product.key, name, category: product.category, color: product.color.toLowerCase(), units, size: [...product.size], priority, cost, price });
  });
  if (categories.length === 0 || products.length === 0) return null;
  return { categories, products };
}

// Los arreglos que todo el programa lee. Se llenan en el lugar (no se reemplazan) para que quien los importó los vea al día.
export const CATEGORIES = [];
export const SKUS = [];

export function apply_catalog(data) {
  const catalog = normalize_catalog(data) || default_catalog();
  CATEGORIES.length = 0;
  catalog.categories.forEach((category) => CATEGORIES.push({ ...category }));
  SKUS.length = 0;
  catalog.products.forEach((product, sku_id) => {
    const category_index = CATEGORIES.findIndex((category) => category.key === product.category);
    SKUS.push({
      id: sku_id,
      key: product.key,
      category_index,
      name: product.name,
      color: product.color,
      units_per_box: product.units,
      size: [...product.size],
      priority: product.priority,
      cost: product.cost,
      price: product.price,
    });
  });
}

// El catálogo actual en el formato que se guarda
export function catalog_to_json() {
  return {
    categories: CATEGORIES.map((category) => ({ ...category })),
    products: SKUS.map((sku) => ({ key: sku.key, name: sku.name, category: CATEGORIES[sku.category_index].key, color: sku.color, units: sku.units_per_box, size: [...sku.size], priority: sku.priority, cost: sku.cost, price: sku.price })),
  };
}

apply_catalog(load_settings().catalog);

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

// Los productos de una categoría
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
