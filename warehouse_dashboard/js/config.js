// Toda constante operativa de la simulación vive aquí. Hay dos clases:
// - Las constantes fijas (paso de simulación, escala de tiempo, SKU, pisos): se exportan sueltas.
// - Los parámetros con slider (PARAMETERS): tienen valor por defecto, rango y paso, y los guarda la clase Config, que avisa a
//   quien escuche cuando uno cambia. Los cambios se aplican sin reiniciar, salvo los marcados con `needs_restart`.

// ---- Constantes fijas ----
export const DEFAULT_SEED = 2026;
// Cada paso de la simulación avanza este tiempo simulado
export const SIM_STEP_SECONDS = 0.25;
// A 1× pasan tantos segundos simulados por segundo real
export const BASE_TIME_SCALE = 4;
// A 100× un día entero (24 h simuladas) pasa en unos 3 minutos y medio reales
export const SPEED_FACTORS = [1, 2, 5, 10, 25, 50, 100];
// Tope de pasos por cuadro: evita congelar la página si el equipo no da abasto a 10×
export const MAX_STEPS_PER_FRAME = 80;
// El reloj simulado arranca a esta hora
export const SIM_START_HOUR = 6;
// El primer camión del primer día llega a la barrera a estos segundos simulados, para no esperar horas a que pase algo
export const FIRST_TRUCK_SECONDS = 40;
// Muelles de recepción (los habilita o bloquea la persona desde el panel del patio)
export const DOCK_COUNT = 10;

export const SKU_COUNT = 20;
export const FLOOR_COUNT = 5;
export const SKUS_PER_FLOOR = SKU_COUNT / FLOOR_COUNT;
// Cada caja va a la reserva con esta probabilidad y al activo con la contraria
export const SPLIT_RESERVE = 0.7;
// Un pallet incompleto sale igual si pasan estos segundos sin llegar más cajas de su SKU (con 20 SKU, cada camión trae pocas de cada uno)
export const PALLET_FLUSH_SECONDS = 600;
// Duración del pico de pedidos y cuánto multiplica la tasa
export const ORDER_SPIKE_SECONDS = 120;
export const ORDER_SPIKE_FACTOR = 5;
// Si una caja espera casilla de muro y no se libera ninguna en este tiempo, se avisa del atasco
export const WALL_JAM_SECONDS = 120;

// Lo que cabe en el activo por SKU (40 cajas en dos niveles de estante; un tercer nivel recibe las que vuelven al cancelar un pedido)
export const ACTIVE_SKU_CAPACITY = 40;
export const ACTIVE_SLOTS_PER_SKU = 60;
// Una cubeta de entrada lleva hasta estas cajas y sale igual si pasan estos segundos sin llegar más
export const TOTE_CAPACITY = 6;
export const TOTE_FLUSH_SECONDS = 60;
// Velocidad de los rieles de descarga (m/s); las demás bandas siguen el slider
export const RAIL_SPEED = 0.8;

// El piso (0 a 4) donde se guarda un SKU en el activo
export function sku_floor(sku_id) {
  return sku_id % FLOOR_COUNT;
}

// ---- Parámetros con slider ----
// group: en qué sección del panel va. needs_restart: solo se aplica al reiniciar. unit: lo que se muestra junto al valor.
export const PARAMETER_GROUPS = [
  { key: "receiving", label: "Recibo" },
  { key: "reserve", label: "Reserva y reabasto" },
  { key: "orders", label: "Pedidos" },
  { key: "belts", label: "Bandas" },
  { key: "walls_packing", label: "Muros y empaque" },
  { key: "dispatch", label: "Despacho" },
  { key: "start", label: "Inicio (al reiniciar)" },
];

export const PARAMETERS = [
  { key: "boxes_per_truck", label: "Cajas por camión", unit: "", group: "receiving", default: 120, min: 20, max: 300, step: 5 },
  { key: "staging_capacity", label: "Capacidad de la bodega de recibo", unit: "cajas", group: "receiving", default: 5000, min: 500, max: 8000, step: 500 },
  { key: "dock_forklift_count", label: "Montacargas de muelle a stock", unit: "", group: "receiving", default: 10, min: 1, max: 10, step: 1 },
  { key: "staging_release_per_minute", label: "Reparto a reserva y activo", unit: "cajas/min", group: "receiving", default: 90, min: 10, max: 300, step: 10 },
  { key: "pallet_size", label: "Tamaño de pallet", unit: "cajas", group: "reserve", default: 12, min: 4, max: 24, step: 1 },
  { key: "forklift_count", label: "Montacargas de stock a racks y multinivel", unit: "", group: "reserve", default: 10, min: 1, max: 10, step: 1 },
  { key: "reserve_capacity", label: "Capacidad de la reserva", unit: "pallets", group: "reserve", default: 160, min: 40, max: 400, step: 10 },
  { key: "replenish_threshold", label: "Umbral de reabasto", unit: "%", group: "reserve", default: 30, min: 5, max: 80, step: 5 },
  { key: "orders_per_minute", label: "Pedidos por minuto", unit: "", group: "orders", default: 0.8, min: 0.1, max: 20, step: 0.1 },
  { key: "max_order_lines", label: "Líneas máximas por pedido", unit: "", group: "orders", default: 4, min: 1, max: 8, step: 1 },
  { key: "pickers_per_floor", label: "Operarios de picking por piso", unit: "", group: "orders", default: 1, min: 1, max: 3, step: 1 },
  { key: "blocked_order_alert_seconds", label: "Alerta de pedido bloqueado", unit: "s", group: "orders", default: 300, min: 60, max: 1800, step: 30 },
  { key: "belt_speed", label: "Velocidad de las bandas", unit: "m/s", group: "belts", default: 0.6, min: 0.2, max: 1.5, step: 0.1 },
  { key: "wall_count", label: "Muros de consolidación", unit: "", group: "walls_packing", default: 3, min: 1, max: 6, step: 1 },
  { key: "slots_per_wall", label: "Casillas por muro", unit: "", group: "walls_packing", default: 10, min: 4, max: 20, step: 2 },
  { key: "pack_station_count", label: "Estaciones de empaque", unit: "", group: "walls_packing", default: 3, min: 1, max: 8, step: 1 },
  { key: "pack_seconds", label: "Tiempo de empaque", unit: "s", group: "walls_packing", default: 25, min: 5, max: 90, step: 5 },
  { key: "door_count", label: "Puertas de despacho", unit: "", group: "dispatch", default: 6, min: 1, max: 6, step: 1 },
  { key: "dispatch_truck_capacity", label: "Cajas por camión de despacho", unit: "cajas", group: "dispatch", default: 200, min: 20, max: 400, step: 10 },
  { key: "initial_active_fill", label: "Activo lleno al empezar", unit: "%", group: "start", default: 0, min: 0, max: 100, step: 5, needs_restart: true },
  { key: "initial_reserve_fill", label: "Reserva llena al empezar", unit: "%", group: "start", default: 0, min: 0, max: 100, step: 5, needs_restart: true },
];

const PARAMETER_BY_KEY = new Map(PARAMETERS.map((parameter) => [parameter.key, parameter]));

// Cuántos decimales tiene un paso (0,5 → 1; 10 → 0)
function step_decimals(step) {
  const text = String(step);
  return text.includes(".") ? text.split(".")[1].length : 0;
}

export function clamp_parameter(parameter, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return parameter.default;
  const stepped = Math.round((number - parameter.min) / parameter.step) * parameter.step + parameter.min;
  const bounded = Math.min(parameter.max, Math.max(parameter.min, stepped));
  return Number(bounded.toFixed(step_decimals(parameter.step)));
}

export class Config {
  constructor() {
    this.values = {};
    this.listeners = new Set();
    this.reset();
  }

  get(key) {
    return this.values[key];
  }

  // Cambia un parámetro (se ajusta al rango y al paso) y avisa. Devuelve el valor que quedó.
  set(key, value) {
    const parameter = PARAMETER_BY_KEY.get(key);
    if (!parameter) return undefined;
    const next = clamp_parameter(parameter, value);
    if (this.values[key] !== next) {
      this.values[key] = next;
      this.listeners.forEach((listener) => listener(key, next));
    }
    return next;
  }

  reset() {
    PARAMETERS.forEach((parameter) => this.set(parameter.key, parameter.default));
  }

  // Cada vez que cambia un parámetro se llama a `listener(clave, valor)`. Devuelve la función que deja de escuchar.
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  to_json() {
    return { ...this.values };
  }

  // Carga valores guardados; lo que no se reconoce o no es un número se ignora
  load(saved) {
    if (!saved || typeof saved !== "object") return;
    PARAMETERS.forEach((parameter) => {
      if (Object.prototype.hasOwnProperty.call(saved, parameter.key)) this.set(parameter.key, saved[parameter.key]);
    });
  }
}
