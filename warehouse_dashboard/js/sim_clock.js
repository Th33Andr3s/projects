// El reloj de la simulación. Es independiente del reloj real: lleva los segundos simulados, tiene un factor de velocidad
// (1×, 2×, 5×, 10×) y una pausa, y convierte el tiempo real que pasó entre dos cuadros en cuántos pasos de simulación hay
// que avanzar. A 1× pasan BASE_TIME_SCALE segundos simulados por segundo real.

import { BASE_TIME_SCALE, SIM_STEP_SECONDS, SIM_START_HOUR, MAX_STEPS_PER_FRAME, SPEED_FACTORS } from "./config.js";

export class SimClock {
  constructor() {
    this.reset();
  }

  reset() {
    // Segundos simulados desde las SIM_START_HOUR del primer día
    this.elapsed = 0;
    this.speed_factor = 1;
    this.paused = false;
    // Tiempo simulado pendiente de convertir en pasos completos
    this.accumulator = 0;
    this.steps_done = 0;
  }

  set_speed(factor) {
    if (SPEED_FACTORS.includes(factor)) this.speed_factor = factor;
  }

  // Los pasos que tocan por `real_seconds` segundos reales. Con un tope por cuadro: si la página se trabó, no se intenta
  // recuperar todo de golpe (eso congelaría la página a 10×), simplemente se sigue desde ahora.
  steps_for(real_seconds) {
    if (this.paused) return 0;
    this.accumulator += real_seconds * BASE_TIME_SCALE * this.speed_factor;
    let steps = Math.floor(this.accumulator / SIM_STEP_SECONDS);
    this.accumulator -= steps * SIM_STEP_SECONDS;
    if (steps > MAX_STEPS_PER_FRAME) {
      steps = MAX_STEPS_PER_FRAME;
      this.accumulator = 0;
    }
    return steps;
  }

  // Cuánto va del paso actual (de 0 a 1): el dibujo interpola con esto
  get step_progress() {
    return this.accumulator / SIM_STEP_SECONDS;
  }

  // Da un paso: avanza el tiempo simulado y devuelve el nuevo tiempo
  step() {
    this.steps_done += 1;
    this.elapsed = this.steps_done * SIM_STEP_SECONDS;
    return this.elapsed;
  }

  // La hora del reloj simulado como "HH:MM" (con las SIM_START_HOUR como hora de arranque)
  get clock_text() {
    const total_minutes = Math.floor(this.elapsed / 60) + SIM_START_HOUR * 60;
    const minutes_of_day = total_minutes % 1440;
    const hours = Math.floor(minutes_of_day / 60);
    return `${String(hours).padStart(2, "0")}:${String(minutes_of_day % 60).padStart(2, "0")}`;
  }

  // Día simulado, empezando en 1
  get day() {
    return Math.floor((Math.floor(this.elapsed / 60) + SIM_START_HOUR * 60) / 1440) + 1;
  }
}
