// Caminos hechos de segmentos rectos: se mide su largo, se pregunta dónde cae un punto a cierta distancia del inicio y se busca
// el punto más cercano a una posición. Los usan las bandas, los camiones, los montacargas y las personas. Son funciones puras.
//
// Convención de giro: el ángulo `yaw` mira hacia donde apunta el vector (cos yaw, 0, -sin yaw) en el plano x-z, que es como
// Three.js gira un objeto sobre y. Un objeto cuyo "frente" es su eje +x y tiene yaw = heading_yaw(dx, dz) mira hacia (dx, dz).

export function heading_yaw(delta_x, delta_z) {
  return Math.atan2(-delta_z, delta_x);
}

// Un camino a partir de una lista de puntos {x, y, z} (y puede faltar)
export function make_path(points) {
  const normalized = points.map((point) => ({ x: point.x, y: point.y || 0, z: point.z }));
  const cumulative = [0];
  for (let index = 1; index < normalized.length; index += 1) {
    const from = normalized[index - 1];
    const to = normalized[index];
    cumulative.push(cumulative[index - 1] + Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z));
  }
  return { points: normalized, cumulative, length: cumulative[cumulative.length - 1] };
}

// El segmento que contiene la distancia `s` (búsqueda binaria)
function segment_index(path, s) {
  const { cumulative } = path;
  let low = 0;
  let high = cumulative.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (cumulative[middle] <= s) low = middle;
    else high = middle - 1;
  }
  return low;
}

// Escribe en `out` la posición y el giro a `s` metros del inicio (limitado a los extremos). Si el segmento es vertical, el
// giro anterior de `out` se conserva.
export function sample_path(path, s, out) {
  const { points, cumulative } = path;
  if (points.length === 1) {
    out.x = points[0].x;
    out.y = points[0].y;
    out.z = points[0].z;
    return out;
  }
  const clamped = Math.min(path.length, Math.max(0, s));
  const index = segment_index(path, clamped);
  const from = points[index];
  const to = points[index + 1];
  const span = cumulative[index + 1] - cumulative[index];
  const fraction = span > 1e-9 ? (clamped - cumulative[index]) / span : 0;
  out.x = from.x + (to.x - from.x) * fraction;
  out.y = from.y + (to.y - from.y) * fraction;
  out.z = from.z + (to.z - from.z) * fraction;
  if (Math.abs(to.x - from.x) > 1e-9 || Math.abs(to.z - from.z) > 1e-9) out.yaw = heading_yaw(to.x - from.x, to.z - from.z);
  return out;
}

// La distancia desde el inicio del punto del camino más cercano (en planta) a (x, z)
export function project_on_path(path, x, z) {
  let best_distance = Infinity;
  let best_s = 0;
  for (let index = 0; index < path.points.length - 1; index += 1) {
    const from = path.points[index];
    const to = path.points[index + 1];
    const delta_x = to.x - from.x;
    const delta_z = to.z - from.z;
    const squared = delta_x * delta_x + delta_z * delta_z;
    let fraction = squared > 1e-12 ? ((x - from.x) * delta_x + (z - from.z) * delta_z) / squared : 0;
    fraction = Math.min(1, Math.max(0, fraction));
    const distance = Math.hypot(from.x + delta_x * fraction - x, from.z + delta_z * fraction - z);
    if (distance < best_distance) {
      best_distance = distance;
      best_s = path.cumulative[index] + (path.cumulative[index + 1] - path.cumulative[index]) * fraction;
    }
  }
  return best_s;
}

// Interpolación de ángulos por el lado corto, para dibujar entre dos cuadros de la simulación
export function lerp_angle(from, to, fraction) {
  let difference = (to - from) % (Math.PI * 2);
  if (difference > Math.PI) difference -= Math.PI * 2;
  else if (difference < -Math.PI) difference += Math.PI * 2;
  return from + difference * fraction;
}
