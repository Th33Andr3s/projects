// Fuegos artificiales del inicio: ráfagas de chispas que salen en todas direcciones, se frenan,
// caen un poco y se apagan. Todas las chispas son un solo conjunto de puntos que se dibuja de una vez,
// así que cuestan muy poco aunque haya muchas a la vez.
//
// Este módulo no importa Three.js: la escena le pasa la librería.

const MAX_BURSTS = 8;
const GRAVITY = 150; // píxeles por segundo al cuadrado
const DRAG = 1.6; // fracción de velocidad que se pierde por segundo

// Colores saturados: sobre un cielo claro, los pálidos no se verían.
const BURST_COLORS = [
  [1.0, 0.72, 0.15], // dorado
  [1.0, 0.3, 0.55], // rosa fuerte
  [0.62, 0.38, 1.0], // violeta
  [1.0, 0.45, 0.35], // coral
  [1.0, 0.55, 0.8], // rosa claro
];

const VERTEX_SHADER = `
  attribute vec3 a_color;
  attribute float a_size;
  attribute float a_alpha;
  uniform float u_pixel_ratio;
  varying vec3 v_color;
  varying float v_alpha;

  void main() {
    v_color = a_color;
    v_alpha = a_alpha;
    gl_PointSize = a_size * u_pixel_ratio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  varying vec3 v_color;
  varying float v_alpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    // Centro brillante y un halo suave alrededor
    float core = smoothstep(0.5, 0.0, d);
    float alpha = (core * core * 0.95 + exp(-d * 9.0) * 0.4) * v_alpha;
    if (alpha < 0.01) discard;
    vec3 color = mix(v_color, vec3(1.0), core * core * 0.55);
    gl_FragColor = vec4(color, alpha);
  }
`;

export function create_fireworks(THREE, { is_small }) {
  const particles_per_burst = is_small ? 22 : 34;
  const capacity = particles_per_burst * MAX_BURSTS;

  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const alphas = new Float32Array(capacity);
  const velocity_x = new Float32Array(capacity);
  const velocity_y = new Float32Array(capacity);
  const ages = new Float32Array(capacity);
  const lives = new Float32Array(capacity).fill(1);
  const base_sizes = new Float32Array(capacity);
  const phases = new Float32Array(capacity);
  const is_alive = new Uint8Array(capacity);

  const geometry = new THREE.BufferGeometry();
  const position_attribute = new THREE.BufferAttribute(positions, 3);
  const color_attribute = new THREE.BufferAttribute(colors, 3);
  const size_attribute = new THREE.BufferAttribute(sizes, 1);
  const alpha_attribute = new THREE.BufferAttribute(alphas, 1);
  [position_attribute, color_attribute, size_attribute, alpha_attribute].forEach((attribute) => attribute.setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("position", position_attribute);
  geometry.setAttribute("a_color", color_attribute);
  geometry.setAttribute("a_size", size_attribute);
  geometry.setAttribute("a_alpha", alpha_attribute);

  const material = new THREE.ShaderMaterial({
    uniforms: { u_pixel_ratio: { value: 1 } },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;

  let next_burst = 0;
  let alive_count = 0;

  return {
    points,

    set_pixel_ratio(pixel_ratio) {
      material.uniforms.u_pixel_ratio.value = pixel_ratio;
    },

    has_active_particles() {
      return alive_count > 0;
    },

    // Lanza una ráfaga en (x, y), en píxeles de la escena. Las ráfagas se reutilizan en círculo.
    launch(x, y, depth) {
      const first = next_burst * particles_per_burst;
      next_burst = (next_burst + 1) % MAX_BURSTS;
      const base = BURST_COLORS[Math.floor(Math.random() * BURST_COLORS.length)];
      const speed_scale = 0.8 + Math.random() * 0.5;

      for (let index = first; index < first + particles_per_burst; index += 1) {
        if (!is_alive[index]) alive_count += 1;
        is_alive[index] = 1;

        const angle = Math.random() * Math.PI * 2;
        // Unas chispas salen más lejos que otras, para que la ráfaga no sea un círculo perfecto
        const speed = (110 + Math.random() * 230) * speed_scale;
        velocity_x[index] = Math.cos(angle) * speed;
        velocity_y[index] = Math.sin(angle) * speed;
        positions[index * 3] = x;
        positions[index * 3 + 1] = y;
        positions[index * 3 + 2] = depth;
        ages[index] = 0;
        lives[index] = 1.1 + Math.random() * 0.7;
        base_sizes[index] = 9 + Math.random() * 11;
        phases[index] = Math.random() * Math.PI * 2;

        // La mayoría del color de la ráfaga; algunas chispas doradas o blancas para dar vida
        const accent = Math.random();
        const color = accent < 0.18 ? [1.0, 0.85, 0.4] : accent < 0.28 ? [1.0, 0.97, 0.92] : base;
        colors[index * 3] = color[0];
        colors[index * 3 + 1] = color[1];
        colors[index * 3 + 2] = color[2];
      }
      points.visible = true;
    },

    update(delta) {
      if (alive_count === 0) return;

      for (let index = 0; index < capacity; index += 1) {
        if (!is_alive[index]) continue;

        ages[index] += delta;
        const progress = ages[index] / lives[index];
        if (progress >= 1) {
          is_alive[index] = 0;
          alive_count -= 1;
          alphas[index] = 0;
          sizes[index] = 0;
          continue;
        }

        const drag_factor = Math.max(0, 1 - DRAG * delta);
        velocity_x[index] *= drag_factor;
        velocity_y[index] = velocity_y[index] * drag_factor - GRAVITY * delta;
        positions[index * 3] += velocity_x[index] * delta;
        positions[index * 3 + 1] += velocity_y[index] * delta;

        // Se apaga con suavidad y titila un poco al final, como una chispa de verdad
        const twinkle = 0.75 + 0.25 * Math.sin(ages[index] * 26 + phases[index]);
        alphas[index] = (1 - progress) ** 1.4 * twinkle;
        sizes[index] = base_sizes[index] * (1 - 0.45 * progress);
      }

      position_attribute.needsUpdate = true;
      color_attribute.needsUpdate = true;
      size_attribute.needsUpdate = true;
      alpha_attribute.needsUpdate = true;
      if (alive_count === 0) points.visible = false;
    },

    clear() {
      is_alive.fill(0);
      alphas.fill(0);
      sizes.fill(0);
      alive_count = 0;
      points.visible = false;
      alpha_attribute.needsUpdate = true;
      size_attribute.needsUpdate = true;
    },
  };
}
