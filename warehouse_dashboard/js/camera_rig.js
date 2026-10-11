// La matemática de la cámara isométrica: hacia dónde mira, cuánto se ve, cómo se mueve con el arrastre, el zoom y los giros de
// 90°. Es pura (sin Three.js ni la página), así se prueba con números; renderer.js solo copia su resultado a la cámara real.
//
// La cámara es ortográfica y mira el centro (target) desde un ángulo de elevación fijo, el isométrico verdadero (35,264°).
// Girar es cambiar el ángulo horizontal (yaw) en pasos de 90°, con una transición corta.

export const ISO_ELEVATION = Math.atan(1 / Math.SQRT2);
const SIN_ELEVATION = Math.sin(ISO_ELEVATION);
const COS_ELEVATION = Math.cos(ISO_ELEVATION);
const INITIAL_YAW = Math.PI / 4;
export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 8;
// Lo que dura el giro de 90° (s)
export const ROTATE_SECONDS = 0.3;
// Cuánto se mueve el paneo con una flecha del teclado, en fracción de la pantalla por segundo
const KEY_PAN_SCREENS_PER_SECOND = 0.6;
const KEY_ZOOM_FACTOR = 1.25;

function ease_in_out(progress) {
  return progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
}

export class CameraRig {
  // `site` es el rectángulo del terreno {x0, x1, z0, z1}; `height` es lo más alto que llega lo construido (para encuadrar)
  constructor(site, height, reduced_motion = false) {
    this.site = site;
    this.height = height;
    this.reduced_motion = reduced_motion;
    this.reset();
  }

  set_reduced_motion(value) {
    this.reduced_motion = Boolean(value);
  }

  reset() {
    this.target = { x: (this.site.x0 + this.site.x1) / 2, z: (this.site.z0 + this.site.z1) / 2 };
    this.zoom = 1;
    this.yaw = INITIAL_YAW;
    this.yaw_from = INITIAL_YAW;
    this.yaw_to = INITIAL_YAW;
    this.rotate_progress = 1;
    // El número de giros acumulados, para anunciar la orientación (0 a 3)
    this.quarter_turns = 0;
  }

  // Alto del recuadro visible a zoom 1: lo justo para que quepa todo el terreno, sea cual sea la forma de la ventana.
  // Se calcula para el peor giro (a 45° el terreno proyecta lo más ancho) y sirve para todos.
  base_frustum_height(aspect) {
    const width = this.site.x1 - this.site.x0;
    const depth = this.site.z1 - this.site.z0;
    const screen_width = (width + depth) * Math.SQRT1_2;
    const screen_height = (width + depth) * Math.SQRT1_2 * SIN_ELEVATION + this.height * COS_ELEVATION;
    const margin = 1.06;
    return Math.max(screen_height, screen_width / aspect) * margin;
  }

  // Medio alto y medio ancho del recuadro visible con el zoom actual
  half_extents(aspect) {
    const half_height = this.base_frustum_height(aspect) / (2 * this.zoom);
    return { half_width: half_height * aspect, half_height };
  }

  // Gira 90° a la derecha (step = 1) o a la izquierda (step = -1). Si ya está girando, suma al destino.
  rotate(step) {
    const direction = step >= 0 ? 1 : -1;
    this.quarter_turns = (((this.quarter_turns + direction) % 4) + 4) % 4;
    if (this.reduced_motion) {
      this.yaw_to += direction * (Math.PI / 2);
      this.yaw = this.yaw_to;
      this.yaw_from = this.yaw_to;
      this.rotate_progress = 1;
      return;
    }
    // Se parte del ángulo actual para que un segundo giro no dé un salto
    this.yaw_from = this.yaw;
    this.yaw_to += direction * (Math.PI / 2);
    this.rotate_progress = 0;
  }

  // Avanza la transición del giro. Devuelve true si la vista cambió.
  update(dt) {
    if (this.rotate_progress >= 1) return false;
    this.rotate_progress = Math.min(1, this.rotate_progress + dt / ROTATE_SECONDS);
    this.yaw = this.yaw_from + (this.yaw_to - this.yaw_from) * ease_in_out(this.rotate_progress);
    return true;
  }

  get is_rotating() {
    return this.rotate_progress < 1;
  }

  // El suelo visto desde la cámara: hacia dónde es "derecha" y hacia dónde es "arriba en la pantalla", sobre el plano del suelo
  ground_basis() {
    const forward_x = -Math.sin(this.yaw);
    const forward_z = -Math.cos(this.yaw);
    return { right: { x: -forward_z, z: forward_x }, up: { x: forward_x, z: forward_z } };
  }

  // La posición de la cámara a `distance` metros del centro
  camera_position(distance) {
    return {
      x: this.target.x + Math.sin(this.yaw) * COS_ELEVATION * distance,
      y: SIN_ELEVATION * distance,
      z: this.target.z + Math.cos(this.yaw) * COS_ELEVATION * distance,
    };
  }

  // Arrastre de `dx`, `dy` píxeles: el mundo sigue al dedo, así que el centro se mueve al revés
  pan_pixels(dx, dy, viewport_height, aspect) {
    if (viewport_height <= 0) return;
    const meters_per_pixel = (this.half_extents(aspect).half_height * 2) / viewport_height;
    const basis = this.ground_basis();
    // Un metro del suelo a lo largo de "arriba" solo ocupa sin(elevación) metros de pantalla; por eso se divide
    const vertical = (dy * meters_per_pixel) / SIN_ELEVATION;
    const horizontal = dx * meters_per_pixel;
    this.target.x += -basis.right.x * horizontal + basis.up.x * vertical;
    this.target.z += -basis.right.z * horizontal + basis.up.z * vertical;
    this.clamp_target();
  }

  // Paneo con teclado: `x` e `y` valen -1, 0 o 1 (derecha / arriba en la pantalla), durante `dt` segundos
  pan_keys(x, y, dt, aspect) {
    const half = this.half_extents(aspect);
    const basis = this.ground_basis();
    const horizontal = x * KEY_PAN_SCREENS_PER_SECOND * half.half_width * 2 * dt;
    const vertical = (y * KEY_PAN_SCREENS_PER_SECOND * half.half_height * 2 * dt) / SIN_ELEVATION;
    this.target.x += basis.right.x * horizontal + basis.up.x * vertical;
    this.target.z += basis.right.z * horizontal + basis.up.z * vertical;
    this.clamp_target();
  }

  // El punto del suelo (relativo al centro) que cae bajo un punto de la pantalla dado en coordenadas normalizadas (-1 a 1)
  ground_offset_at(ndc_x, ndc_y, aspect) {
    const half = this.half_extents(aspect);
    const basis = this.ground_basis();
    const horizontal = ndc_x * half.half_width;
    const vertical = (ndc_y * half.half_height) / SIN_ELEVATION;
    return { x: basis.right.x * horizontal + basis.up.x * vertical, z: basis.right.z * horizontal + basis.up.z * vertical };
  }

  // Cambia el zoom multiplicándolo por `factor`. Con un punto (ndc_x, ndc_y) el zoom se hace hacia ese punto: lo que está bajo
  // el cursor se queda bajo el cursor.
  zoom_by(factor, aspect, ndc_x = 0, ndc_y = 0) {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    if (next === this.zoom) return;
    const before = this.ground_offset_at(ndc_x, ndc_y, aspect);
    this.zoom = next;
    const after = this.ground_offset_at(ndc_x, ndc_y, aspect);
    this.target.x += before.x - after.x;
    this.target.z += before.z - after.z;
    this.clamp_target();
  }

  // Pone el centro de la vista en un punto del suelo (sin cambiar el zoom ni el giro)
  set_target(x, z) {
    this.target.x = x;
    this.target.z = z;
    this.clamp_target();
  }

  zoom_step(direction, aspect) {
    this.zoom_by(direction > 0 ? KEY_ZOOM_FACTOR : 1 / KEY_ZOOM_FACTOR, aspect);
  }

  // El centro nunca se sale del terreno
  clamp_target() {
    this.target.x = Math.min(this.site.x1, Math.max(this.site.x0, this.target.x));
    this.target.z = Math.min(this.site.z1, Math.max(this.site.z0, this.target.z));
  }
}
