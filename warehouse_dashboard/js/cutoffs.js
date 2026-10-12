// Las horas de corte de los despachos. Son horas del día (en minutos desde la medianoche) que se repiten todos los días. El tiempo
// de la simulación cuenta en segundos desde las SIM_START_HOUR del primer día, así que la medianoche del día 1 queda en un valor
// negativo. Funciones puras: no tocan la simulación ni la página.

import { SIM_START_HOUR } from "./config.js";

export const DAY_SECONDS = 86400;
// Un pedido que cae a MENOS de este margen antes de un corte (o justo en él) ya no sale en ese corte, sino en el siguiente
export const CUTOFF_MARGIN_SECONDS = 3600;
export const MAX_CUTOFFS = 24;
// 03:00, 09:00, 12:00, 18:00 y 20:00
export const DEFAULT_CUTOFFS = [180, 540, 720, 1080, 1200];

// El segundo de la simulación en que empieza (a medianoche) cada día: el día 1 empieza antes de que arranque el reloj
const MIDNIGHT_OFFSET = -SIM_START_HOUR * 3600;

// El día de la simulación (1 es el primero) al que pertenece un momento, y el segundo en que empieza (a medianoche) ese día
export function day_index(time) {
  return Math.floor((time - MIDNIGHT_OFFSET) / DAY_SECONDS) + 1;
}

export function day_start_time(day) {
  return MIDNIGHT_OFFSET + (day - 1) * DAY_SECONDS;
}

// Una lista de horas de corte válida: enteros entre 0 y 1439, sin repetir y de menor a mayor; si no queda ninguna, la de fábrica
export function normalize_cutoffs(values) {
  const list = Array.isArray(values) ? values : [];
  const valid = [...new Set(list.map((value) => Math.round(Number(value))).filter((value) => Number.isFinite(value) && value >= 0 && value < 1440))].sort((first, second) => first - second);
  return valid.length > 0 ? valid.slice(0, MAX_CUTOFFS) : [...DEFAULT_CUTOFFS];
}

// El primer corte (como segundo de la simulación) que queda a MÁS de `margin` segundos después de `time`. Con margin 0 es el primer
// corte posterior a ese momento.
export function next_cutoff_after(time, cutoffs, margin = 0) {
  const first_day = Math.floor((time - MIDNIGHT_OFFSET) / DAY_SECONDS) - 1;
  for (let day = first_day; day < first_day + 4; day += 1) {
    for (const minutes of cutoffs) {
      const at = MIDNIGHT_OFFSET + day * DAY_SECONDS + minutes * 60;
      if (at - time > margin) return at;
    }
  }
  throw new Error("No se encontró el siguiente corte");
}

// El corte que le toca a un pedido que cae en `time`: el primero que queda a más de 60 minutos
export function assigned_cutoff(time, cutoffs) {
  return next_cutoff_after(time, cutoffs, CUTOFF_MARGIN_SECONDS);
}

// "HH:MM" de una hora de corte en minutos del día
export function format_cutoff(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// De "HH:MM" a minutos del día, o null si no es una hora válida
export function parse_cutoff(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text).trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[1]) < 24 && Number(match[2]) < 60 ? minutes : null;
}
