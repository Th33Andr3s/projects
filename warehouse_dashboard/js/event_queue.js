// Cola de eventos discretos: llegadas de camiones, fin de tareas, creación de pedidos, salidas por horario, fin de disrupciones.
// Es un montículo binario ordenado por tiempo; a igual tiempo sale primero el que se agregó antes, para que dos corridas con
// la misma semilla atiendan los empates siempre en el mismo orden.

export class EventQueue {
  constructor() {
    this.heap = [];
    this.next_id = 1;
    this.cancelled = new Set();
  }

  get size() {
    return this.heap.length - this.cancelled.size;
  }

  // Agenda un evento para el tiempo `time` (segundos simulados). Devuelve su identificador, que sirve para cancelarlo.
  schedule(time, type, payload = null) {
    const event = { time, type, payload, id: this.next_id };
    this.next_id += 1;
    this.heap.push(event);
    this.sift_up(this.heap.length - 1);
    return event.id;
  }

  // Quita un evento que todavía no se atendió. No hace nada si ya se atendió o no existe.
  cancel(event_id) {
    if (this.heap.some((event) => event.id === event_id)) this.cancelled.add(event_id);
  }

  // El tiempo del próximo evento, o Infinity si no hay
  peek_time() {
    this.discard_cancelled();
    return this.heap.length === 0 ? Infinity : this.heap[0].time;
  }

  // Saca y devuelve el próximo evento si le toca a más tardar en `time`; si no, devuelve null
  pop_due(time) {
    this.discard_cancelled();
    if (this.heap.length === 0 || this.heap[0].time > time) return null;
    return this.pop();
  }

  clear() {
    this.heap = [];
    this.cancelled.clear();
  }

  discard_cancelled() {
    while (this.heap.length > 0 && this.cancelled.has(this.heap[0].id)) {
      this.cancelled.delete(this.heap[0].id);
      this.pop();
    }
  }

  pop() {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sift_down(0);
    }
    return top;
  }

  // ¿Va `first` antes que `second`? Por tiempo y, a igual tiempo, por orden de llegada
  is_before(first, second) {
    return first.time < second.time || (first.time === second.time && first.id < second.id);
  }

  sift_up(start) {
    let index = start;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.is_before(this.heap[index], this.heap[parent])) break;
      [this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]];
      index = parent;
    }
  }

  sift_down(start) {
    let index = start;
    const length = this.heap.length;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < length && this.is_before(this.heap[left], this.heap[smallest])) smallest = left;
      if (right < length && this.is_before(this.heap[right], this.heap[smallest])) smallest = right;
      if (smallest === index) break;
      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
      index = smallest;
    }
  }
}
