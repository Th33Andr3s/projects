// El mapa esquemático de Colombia: el contorno del país, dónde queda cada ciudad y por qué ciudades intermedias pasa la ruta de cada
// destino desde Bogotá. Es un dibujo propio (sin librerías de mapas ni imágenes externas): el contorno y las rutas son aproximados y
// las rutas son líneas quebradas entre ciudades, no las carreteras reales. Los kilómetros y los tiempos de viaje de la simulación sí
// son los de carretera (catalog.js); aquí solo se reparte ese viaje a lo largo de la línea dibujada. Son datos y cuentas puras.

import { CD_CITY } from "./catalog.js";

// El dibujo mide 520 × 700: 40 unidades por grado, de 79,5° O a 66,5° O y de 13° N a 4,5° S
const SCALE = 40;
const LON_MIN = -79.5;
const LAT_MAX = 13;
export const MAP_WIDTH = 520;
export const MAP_HEIGHT = 700;

export function project(longitude, latitude) {
  return { x: (longitude - LON_MIN) * SCALE, y: (LAT_MAX - latitude) * SCALE };
}

// De un punto del dibujo a longitud y latitud (lo contrario de `project`)
export function unproject(x, y) {
  return { longitude: x / SCALE + LON_MIN, latitude: LAT_MAX - y / SCALE };
}

// El contorno (longitud, latitud), siguiendo la costa del Caribe, la frontera con Venezuela, Brasil, Perú y Ecuador, y la costa del
// Pacífico
const OUTLINE = [
  [-77.37, 8.67], [-77.28, 8.5], [-77.1, 8.15], [-76.85, 8.05], [-76.74, 8.45], [-76.43, 8.87], [-75.9, 9.35], [-75.6, 9.45], [-75.6, 10.1],
  [-75.5, 10.45], [-74.85, 10.95], [-74.25, 11.3], [-73.4, 11.3], [-72.9, 11.6], [-72.2, 12.15], [-71.65, 12.45], [-71.3, 11.85],
  [-71.95, 11.35], [-72.15, 10.7], [-72.8, 10.1], [-72.55, 9.4], [-72.4, 8.1], [-72.45, 7.4], [-71.85, 7.0], [-70.75, 7.05], [-70.1, 6.95],
  [-69.45, 6.15], [-67.8, 6.2], [-67.45, 5.4], [-67.6, 4.3], [-67.7, 2.85], [-67.35, 1.85], [-66.9, 1.25], [-68.2, 1.75], [-69.8, 1.1],
  [-70.05, 0.55], [-69.5, -0.3], [-69.55, -1.15], [-69.95, -1.75], [-69.75, -2.8], [-69.95, -4.2], [-70.5, -3.55], [-71.4, -2.35],
  [-72.4, -2.4], [-73.4, -1.9], [-74.3, -0.95], [-75.3, -0.15], [-76.4, 0.2], [-77.0, 0.4], [-77.65, 0.85], [-78.85, 1.45], [-78.75, 1.8],
  [-78.15, 2.3], [-77.9, 2.75], [-77.4, 3.4], [-77.25, 3.95], [-77.3, 4.6], [-77.5, 5.45], [-77.35, 6.15], [-77.7, 6.95], [-77.9, 7.2],
  [-77.6, 7.6], [-77.45, 8.05],
];

// Dónde queda cada ciudad (latitud, longitud)
const CITY_COORDINATES = {
  Bogotá: [4.711, -74.072],
  Barranquilla: [10.96, -74.8],
  Cartagena: [10.39, -75.48],
  "Santa Marta": [11.24, -74.2],
  Valledupar: [10.47, -73.25],
  Montería: [8.75, -75.88],
  Sincelejo: [9.3, -75.4],
  Riohacha: [11.54, -72.91],
  Medellín: [6.25, -75.57],
  Bucaramanga: [7.12, -73.12],
  Cúcuta: [7.89, -72.51],
  Pereira: [4.81, -75.69],
  Manizales: [5.07, -75.52],
  Armenia: [4.53, -75.68],
  Tunja: [5.54, -73.36],
  Ibagué: [4.44, -75.23],
  Neiva: [2.93, -75.28],
  Cali: [3.45, -76.53],
  Pasto: [1.21, -77.28],
  Popayán: [2.44, -76.61],
  Buenaventura: [3.88, -77.03],
  Quibdó: [5.69, -76.65],
  Villavicencio: [4.15, -73.63],
  Yopal: [5.34, -72.4],
  Arauca: [7.09, -70.76],
  Florencia: [1.61, -75.61],
  Mocoa: [1.15, -76.65],
  "San José del Guaviare": [2.57, -72.64],
};

// Por qué ciudades pasa la ruta de cada destino (siempre empieza en Bogotá y termina en la ciudad)
const ROUTE_CITIES = {
  Barranquilla: ["Bogotá", "Tunja", "Bucaramanga", "Valledupar", "Santa Marta", "Barranquilla"],
  Cartagena: ["Bogotá", "Medellín", "Montería", "Sincelejo", "Cartagena"],
  "Santa Marta": ["Bogotá", "Tunja", "Bucaramanga", "Valledupar", "Santa Marta"],
  Valledupar: ["Bogotá", "Tunja", "Bucaramanga", "Valledupar"],
  Montería: ["Bogotá", "Medellín", "Montería"],
  Sincelejo: ["Bogotá", "Medellín", "Montería", "Sincelejo"],
  Riohacha: ["Bogotá", "Tunja", "Bucaramanga", "Valledupar", "Riohacha"],
  Medellín: ["Bogotá", "Medellín"],
  Bucaramanga: ["Bogotá", "Tunja", "Bucaramanga"],
  Cúcuta: ["Bogotá", "Tunja", "Bucaramanga", "Cúcuta"],
  Pereira: ["Bogotá", "Ibagué", "Armenia", "Pereira"],
  Manizales: ["Bogotá", "Ibagué", "Armenia", "Pereira", "Manizales"],
  Armenia: ["Bogotá", "Ibagué", "Armenia"],
  Tunja: ["Bogotá", "Tunja"],
  Ibagué: ["Bogotá", "Ibagué"],
  Neiva: ["Bogotá", "Ibagué", "Neiva"],
  Cali: ["Bogotá", "Ibagué", "Armenia", "Cali"],
  Pasto: ["Bogotá", "Ibagué", "Armenia", "Cali", "Popayán", "Pasto"],
  Popayán: ["Bogotá", "Ibagué", "Armenia", "Cali", "Popayán"],
  Buenaventura: ["Bogotá", "Ibagué", "Armenia", "Cali", "Buenaventura"],
  Quibdó: ["Bogotá", "Ibagué", "Armenia", "Pereira", "Quibdó"],
  Villavicencio: ["Bogotá", "Villavicencio"],
  Yopal: ["Bogotá", "Tunja", "Yopal"],
  Arauca: ["Bogotá", "Tunja", "Yopal", "Arauca"],
  Florencia: ["Bogotá", "Neiva", "Florencia"],
  Mocoa: ["Bogotá", "Neiva", "Florencia", "Mocoa"],
  "San José del Guaviare": ["Bogotá", "Villavicencio", "San José del Guaviare"],
};

export function outline_points() {
  return OUTLINE.map(([longitude, latitude]) => project(longitude, latitude));
}

export function city_point(city) {
  const coordinates = CITY_COORDINATES[city];
  if (!coordinates) return null;
  return project(coordinates[1], coordinates[0]);
}

export function mapped_cities() {
  return Object.keys(CITY_COORDINATES);
}

// La ruta de un destino como una línea quebrada: sus puntos y la distancia acumulada hasta cada uno (en unidades del dibujo)
const route_cache = new Map();
export function route_of(city) {
  if (route_cache.has(city)) return route_cache.get(city);
  const names = city === CD_CITY ? [CD_CITY] : ROUTE_CITIES[city];
  if (!names) return null;
  const points = names.map((name) => city_point(name));
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y));
  }
  const route = { city, names, points, cumulative, length: cumulative[cumulative.length - 1] };
  route_cache.set(city, route);
  return route;
}

// Lo mismo que position_at, pero en longitud y latitud (para el histórico de posiciones que se descarga)
export function geo_position_at(city, fraction) {
  const point = position_at(city, fraction);
  return point ? unproject(point.x, point.y) : null;
}

// Dónde está un camión que ha recorrido `fraction` (de 0 a 1) del viaje: un punto sobre la línea de su ruta
export function position_at(city, fraction) {
  const route = route_of(city);
  if (!route || route.points.length === 1) return route ? route.points[0] : null;
  const clamped = Math.min(1, Math.max(0, fraction));
  const target = clamped * route.length;
  let index = 1;
  while (index < route.points.length - 1 && route.cumulative[index] < target) index += 1;
  const from = route.points[index - 1];
  const to = route.points[index];
  const span = route.cumulative[index] - route.cumulative[index - 1];
  const t = span > 0 ? (target - route.cumulative[index - 1]) / span : 0;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

// ---------- Histórico de posiciones ----------
// Cada cuánto (segundos simulados) se anota la posición de un camión en el histórico que se descarga: 15, 30 o 60 minutos, el más fino que
// deje el archivo en unos 600.000 renglones como máximo
const TRACK_INTERVALS = [900, 1800, 3600];
const TRACK_ROWS_LIMIT = 600000;

export function track_interval(trips, now) {
  for (const interval of TRACK_INTERVALS) {
    let rows = 0;
    for (const trip of trips) rows += Math.ceil((Math.min(trip.arrival_at, now) - trip.departed_at) / interval) + 1;
    if (rows <= TRACK_ROWS_LIMIT) return interval;
  }
  return TRACK_INTERVALS[TRACK_INTERVALS.length - 1];
}

// Las posiciones de un viaje desde su salida, una cada `interval` segundos, y la última: la de llegada (o la de ahora si todavía va en
// ruta). Cada una: momento, longitud, latitud, kilómetros recorridos y restantes.
export function* trip_track(trip, now, interval) {
  const end = Math.min(trip.arrival_at, now);
  const span = Math.max(1, trip.arrival_at - trip.departed_at);
  const sample = (time) => {
    const fraction = Math.min(1, Math.max(0, (time - trip.departed_at) / span));
    const geo = geo_position_at(trip.destination.city, fraction);
    return { time, longitude: geo.longitude, latitude: geo.latitude, traveled: trip.kilometers * fraction, remaining: trip.kilometers * (1 - fraction) };
  };
  for (let time = trip.departed_at; time < end; time += interval) yield sample(time);
  yield sample(end);
}
