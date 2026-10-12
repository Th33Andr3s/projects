// Lo que la página recuerda entre visitas: los valores de los sliders, la configuración del patio, el catálogo de mercancía, la
// distribución del activo por piso, la velocidad y el silencio. Va en
// `localStorage` con el nombre del proyecto como prefijo (para no pisarse con otros proyectos del mismo dominio) y toda lectura o
// escritura va dentro de try/catch: en modo privado o con el almacenamiento bloqueado puede fallar, y la página sigue igual.

import { SPEED_FACTORS } from "./config.js";

const STORAGE_KEY = "warehouse_dashboard_settings";

// Devuelve lo guardado ya validado, o un objeto vacío si no hay nada o no sirve
export function load_settings() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return {};
    const settings = {};
    if (data.params && typeof data.params === "object") settings.params = data.params;
    if (data.yard && typeof data.yard === "object") settings.yard = data.yard;
    // El catálogo y la distribución del activo se revisan donde se usan (catalog.js y active_layout.js)
    if (data.catalog && typeof data.catalog === "object") settings.catalog = data.catalog;
    if (Array.isArray(data.allocation)) settings.allocation = data.allocation;
    if (SPEED_FACTORS.includes(data.speed)) settings.speed = data.speed;
    if (typeof data.muted === "boolean") settings.muted = data.muted;
    return settings;
  } catch {
    return {};
  }
}

export function save_settings(settings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento la página funciona igual, solo que no recuerda
  }
}

export function clear_settings() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Igual que arriba
  }
}
