// El sonido ambiente, hecho con la Web Audio API (sin archivos): un zumbido grave de las bandas que sube con cuántas están
// trabajando, el pitido de reversa de los montacargas, el motor de los camiones al llegar y al salir, un "ding" suave cuando un
// pedido se completa en un muro y un "zip" de cinta en empaque.
//
// El navegador no deja sonar nada antes de que la persona toque la página, así que el contexto de audio se crea recién en la
// primera interacción (`unlock`). El volumen general es bajo y hay un botón de silencio.

const MASTER_VOLUME = 0.32;
const HUM_MAX_GAIN = 0.07;
const BEEP_PERIOD_SECONDS = 0.8;
const BEEP_SECONDS = 0.14;
// Un mismo sonido no se repite antes de esto (segundos reales), para que a 10× no sea un ruido continuo
const MIN_REPEAT_SECONDS = 0.18;

export function create_audio() {
  let context = null;
  let master = null;
  let hum_gain = null;
  let noise_buffer = null;
  let muted = false;
  let next_beep_time = 0;
  const last_played = new Map();

  function make_noise_buffer() {
    const length = context.sampleRate * 2;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    // Ruido determinista simple: el sonido ambiente no usa el azar del navegador
    let state = 12345;
    for (let index = 0; index < length; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      data[index] = (state / 4294967296) * 2 - 1;
    }
    return buffer;
  }

  function build_graph() {
    master = context.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    master.connect(context.destination);

    // Zumbido de las bandas: dos osciladores graves por un filtro
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 260;
    hum_gain = context.createGain();
    hum_gain.gain.value = 0;
    [55, 82.5].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = index === 0 ? "sawtooth" : "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(filter);
      oscillator.start();
    });
    filter.connect(hum_gain);
    hum_gain.connect(master);
    noise_buffer = make_noise_buffer();
  }

  // Se llama con la primera interacción de la persona
  function unlock() {
    if (context) {
      if (context.state === "suspended") context.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      context = new AudioContextClass();
      build_graph();
    } catch {
      context = null;
    }
  }

  function set_muted(value) {
    muted = value;
    if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, context.currentTime, 0.05);
  }

  // Con la pestaña oculta se suspende el contexto para no gastar batería
  function set_hidden(hidden) {
    if (!context) return;
    if (hidden && context.state === "running") context.suspend();
    else if (!hidden && context.state === "suspended") context.resume();
  }

  function can_play(name) {
    if (!context || muted || context.state !== "running") return false;
    const last = last_played.get(name) || -Infinity;
    if (context.currentTime - last < MIN_REPEAT_SECONDS) return false;
    last_played.set(name, context.currentTime);
    return true;
  }

  function envelope(gain_node, start, peak, attack, release) {
    gain_node.gain.setValueAtTime(0.0001, start);
    gain_node.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain_node.gain.exponentialRampToValueAtTime(0.0001, start + attack + release);
  }

  function tone(frequency, start, seconds, type, peak) {
    const oscillator = context.createOscillator();
    const gain_node = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    oscillator.connect(gain_node);
    gain_node.connect(master);
    envelope(gain_node, start, peak, 0.01, seconds);
    oscillator.start(start);
    oscillator.stop(start + seconds + 0.05);
  }

  function noise_burst(start, seconds, filter_type, from_frequency, to_frequency, peak, attack) {
    const source = context.createBufferSource();
    source.buffer = noise_buffer;
    const filter = context.createBiquadFilter();
    filter.type = filter_type;
    filter.frequency.setValueAtTime(from_frequency, start);
    filter.frequency.exponentialRampToValueAtTime(to_frequency, start + seconds);
    const gain_node = context.createGain();
    source.connect(filter);
    filter.connect(gain_node);
    gain_node.connect(master);
    envelope(gain_node, start, peak, attack, seconds);
    source.start(start);
    source.stop(start + seconds + attack + 0.05);
  }

  const sounds = {
    // Motor de camión: un ronroneo grave con ruido filtrado, que sube y baja
    truck() {
      const start = context.currentTime;
      noise_burst(start, 2.2, "bandpass", 160, 90, 0.5, 0.5);
      const oscillator = context.createOscillator();
      const gain_node = context.createGain();
      oscillator.type = "sawtooth";
      oscillator.frequency.setValueAtTime(48, start);
      oscillator.frequency.linearRampToValueAtTime(72, start + 1.0);
      oscillator.frequency.linearRampToValueAtTime(52, start + 2.4);
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 220;
      oscillator.connect(filter);
      filter.connect(gain_node);
      gain_node.connect(master);
      envelope(gain_node, start, 0.22, 0.5, 1.9);
      oscillator.start(start);
      oscillator.stop(start + 2.6);
    },
    // Pedido completo en un muro: dos notas agudas y suaves
    ding() {
      const start = context.currentTime;
      tone(880, start, 0.5, "sine", 0.22);
      tone(1320, start + 0.09, 0.6, "sine", 0.16);
    },
    // Cinta de empaque: un barrido corto de ruido agudo
    zip() {
      noise_burst(context.currentTime, 0.32, "highpass", 4200, 1200, 0.3, 0.02);
    },
  };

  function play(name) {
    if (can_play(name)) sounds[name]();
  }

  // Convierte los eventos de la simulación en sonidos
  function handle_events(events) {
    events.forEach((event) => {
      if (event.type === "truck_arrived" || event.type === "truck_departing") play("truck");
      else if (event.type === "order_complete") play("ding");
      else if (event.type === "parcel_packed") play("zip");
    });
  }

  // Lo continuo: zumbido de bandas y pitido de reversa. `state`: { running_belts_ratio, reversing, paused }
  function update(state) {
    if (!context || context.state !== "running") return;
    const target = state.paused ? 0 : HUM_MAX_GAIN * Math.min(1, state.running_belts_ratio);
    hum_gain.gain.setTargetAtTime(target, context.currentTime, 0.4);
    if (state.reversing && !state.paused && !muted) {
      const now = context.currentTime;
      if (now >= next_beep_time) {
        tone(1000, now, BEEP_SECONDS, "square", 0.07);
        next_beep_time = now + BEEP_PERIOD_SECONDS;
      }
    }
  }

  return { unlock, set_muted, set_hidden, handle_events, update };
}
