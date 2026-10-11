// Números al azar con semilla (mulberry32). La misma semilla da siempre la misma secuencia, y toda la aleatoriedad de la
// simulación pasa por aquí: nunca se usa el azar del navegador, así una corrida se puede repetir exactamente.
//
// Cada parte de la simulación (llegada de camiones, pedidos, reparto de cajas…) saca sus números de un flujo propio, derivado
// de la semilla con `fork`. Así, mover un parámetro que cambia cuántos números usa una parte no cambia los que recibe otra.

// Mezcla un texto en un número de 32 bits (xmur3): sirve para derivar la semilla de un flujo a partir de su nombre
function hash_text(text) {
  let hash = 1779033703 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export class Rng {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  // Un número de 0 (incluido) a 1 (excluido)
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  // Un número entre minimum (incluido) y maximum (excluido)
  float(minimum, maximum) {
    return minimum + this.next() * (maximum - minimum);
  }

  // Un entero entre minimum y maximum, los dos incluidos
  int(minimum, maximum) {
    return minimum + Math.floor(this.next() * (maximum - minimum + 1));
  }

  // Verdadero con la probabilidad dada (de 0 a 1)
  chance(probability) {
    return this.next() < probability;
  }

  // Un elemento de una lista no vacía
  pick(items) {
    return items[Math.floor(this.next() * items.length)];
  }

  // Mezcla una lista en su lugar (Fisher-Yates) y la devuelve
  shuffle(items) {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const other = Math.floor(this.next() * (index + 1));
      [items[index], items[other]] = [items[other], items[index]];
    }
    return items;
  }

  // Un número con distribución normal (Box-Muller), con la media y la desviación dadas
  normal(mean, deviation) {
    const first = Math.max(this.next(), 1e-12);
    const second = this.next();
    return mean + deviation * Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  }

  // Un flujo nuevo, independiente de este, que depende solo de la semilla y del nombre
  fork(name) {
    return new Rng(hash_text(`${this.seed}:${name}`));
  }
}
