// La escena 3D: luces, cámara ortográfica isométrica, la parte estática de la bodega y el dibujo en el lienzo. Recibe Three.js
// por parámetro (se carga con import() dinámico en animations.js) y devuelve un controlador con lo que necesita el resto.
//
// Solo dibuja cuando algo cambió (la cámara, el tamaño o una marca de `mark_dirty`); así, con la simulación en pausa y la
// cámara quieta, no gasta batería. Las fases siguientes marcan cada cuadro como cambiado mientras haya cosas en movimiento.

import { CameraRig } from "./camera_rig.js";
import { SITE } from "./layout.js";
import { build_entity_layer } from "./scene_entities.js";
import { build_static_scene } from "./static_scene.js";

const BACKGROUND_COLOR = "#0b1220";
// A qué distancia se pone la cámara del centro. En una cámara ortográfica solo importa que todo quede dentro del rango.
const CAMERA_DISTANCE = 300;
// Lo más alto que llega lo construido (el elevador del multinivel), para encuadrar
const SCENE_HEIGHT = 18;
const MAX_PIXEL_RATIO = 2;
// Tamaño del rótulo en pantalla, en píxeles: un tramo fijo más lo que ocupa cada renglón
const SIGN_BASE_PIXELS = 8;
const SIGN_LINE_PIXELS = 15;
// Espacio mínimo entre dos rótulos, en píxeles, y cuántas veces se intenta correr uno hacia arriba para que no pise a otro.
// Si ni así cabe, se oculta hasta que el zoom lo separe de los demás. En ventanas angostas los rótulos son un poco más chicos.
const SIGN_GAP_PIXELS = 4;
const SIGN_MAX_SHIFTS = 2;
const NARROW_VIEWPORT_PIXELS = 600;
const NARROW_SIGN_SCALE = 0.85;

export function build_renderer(THREE, { canvas, container, layout, reduced_motion }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND_COLOR);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -CAMERA_DISTANCE * 2, CAMERA_DISTANCE * 4);
  const rig = new CameraRig(SITE, SCENE_HEIGHT, reduced_motion);

  // Luces: un hemisferio suave para que nada quede negro y un sol que da las sombras
  scene.add(new THREE.HemisphereLight("#dfe9ff", "#8e96a3", 1.15));
  const sun = new THREE.DirectionalLight("#ffffff", 1.6);
  sun.position.set(70, 120, 60);
  sun.target.position.set(0, 0, 0);
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -150;
  sun.shadow.camera.right = 150;
  sun.shadow.camera.top = 110;
  sun.shadow.camera.bottom = -110;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  const static_scene = build_static_scene(THREE, layout);
  scene.add(static_scene.group);
  const entities = build_entity_layer(THREE, scene, layout);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let width = 1;
  let height = 1;
  let is_dirty = true;
  let shadows_on = false;

  function mark_dirty() {
    is_dirty = true;
  }

  // Los rótulos siempre miran a la cámara y se ven del mismo tamaño en pantalla, cerca o lejos. Si dos se pisan, el de
  // mayor prioridad se queda y el otro sube lo justo para no taparlo; si no hay sitio, se oculta.
  const sign_up = new THREE.Vector3();
  const sign_point = new THREE.Vector3();
  const sign_order = [...static_scene.signs].sort((first, second) => second.priority - first.priority);

  function place_signs(meters_per_pixel) {
    camera.updateMatrixWorld(true);
    sign_up.setFromMatrixColumn(camera.matrixWorld, 1);
    const placed = [];
    const size_scale = width < NARROW_VIEWPORT_PIXELS ? NARROW_SIGN_SCALE : 1;
    sign_order.forEach((sign) => {
      const height_pixels = (SIGN_BASE_PIXELS + SIGN_LINE_PIXELS * sign.lines) * size_scale;
      const width_pixels = height_pixels * sign.aspect;
      const world_height = height_pixels * meters_per_pixel;
      sign.sprite.scale.set(world_height * sign.aspect, world_height, 1);
      let chosen = null;
      for (let shift = 0; shift <= SIGN_MAX_SHIFTS && !chosen; shift += 1) {
        sign_point.copy(sign.base_position).addScaledVector(sign_up, shift * (height_pixels + SIGN_GAP_PIXELS) * meters_per_pixel);
        const projected = sign_point.clone().project(camera);
        const box = {
          x: (projected.x * 0.5 + 0.5) * width,
          y: (-projected.y * 0.5 + 0.5) * height,
          half_width: width_pixels / 2 + SIGN_GAP_PIXELS / 2,
          half_height: height_pixels / 2 + SIGN_GAP_PIXELS / 2,
        };
        const overlaps = placed.some((other) => Math.abs(other.x - box.x) < other.half_width + box.half_width && Math.abs(other.y - box.y) < other.half_height + box.half_height);
        if (!overlaps) chosen = { box, position: sign_point.clone() };
      }
      sign.sprite.visible = Boolean(chosen);
      if (!chosen) return;
      sign.sprite.position.copy(chosen.position);
      placed.push(chosen.box);
    });
  }

  function apply_camera() {
    const aspect = width / height;
    const { half_width, half_height } = rig.half_extents(aspect);
    camera.left = -half_width;
    camera.right = half_width;
    camera.top = half_height;
    camera.bottom = -half_height;
    const position = rig.camera_position(CAMERA_DISTANCE);
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(rig.target.x, 0, rig.target.z);
    camera.updateProjectionMatrix();
    place_signs((half_height * 2) / height);
  }

  function resize() {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    apply_camera();
    mark_dirty();
  }

  // Las sombras cuestan: se encienden en pantallas anchas y se apagan si los cuadros por segundo bajan
  function set_shadows(enabled) {
    if (enabled === shadows_on) return;
    shadows_on = enabled;
    renderer.shadowMap.enabled = enabled;
    sun.castShadow = enabled;
    // Cambiar las sombras obliga a recompilar los materiales
    static_scene.mesh.material.needsUpdate = true;
    mark_dirty();
  }

  // Un cuadro: avanza la transición del giro y dibuja si hay algo nuevo que mostrar
  function frame(dt) {
    if (rig.update(dt)) {
      apply_camera();
      mark_dirty();
    }
    if (!is_dirty) return false;
    is_dirty = false;
    renderer.render(scene, camera);
    return true;
  }

  // Cambió la cámara desde fuera (arrastre, zoom, teclado): se recalcula y se redibuja
  function camera_changed() {
    apply_camera();
    mark_dirty();
  }

  // Acciones de los botones de la barra: giro de 90°, un paso de zoom y volver al encuadre inicial
  function rotate(step) {
    rig.rotate(step);
    camera_changed();
  }

  function zoom(direction) {
    rig.zoom_step(direction, width / height);
    camera_changed();
  }

  function fit() {
    rig.reset();
    camera_changed();
  }

  // La escena muestra una simulación: se llama al crearla y cada vez que se reinicia
  function attach_simulation(sim) {
    entities.attach(sim);
    mark_dirty();
  }

  // Un cuadro de lo que se mueve: `step_alpha` (0 a 1) es cuánto va del paso actual de la simulación, para interpolar
  function sync(sim, step_alpha, time) {
    const { half_height } = rig.half_extents(width / height);
    entities.sync(sim, step_alpha, { meters_per_pixel: (half_height * 2) / height, zoom: rig.zoom, camera, reduced_motion: rig.reduced_motion }, time);
    mark_dirty();
  }

  function on_events(events, now) {
    entities.on_events(events, now);
  }

  // Lo que hay bajo un punto de la pantalla (coordenadas normalizadas de -1 a 1), o null
  function pick(ndc_x, ndc_y) {
    pointer.set(ndc_x, ndc_y);
    raycaster.setFromCamera(pointer, camera);
    return entities.pick(raycaster);
  }

  function focus(x, z) {
    rig.set_target(x, z);
    camera_changed();
  }

  function dispose() {
    entities.dispose();
    static_scene.signs.forEach((sign) => {
      sign.sprite.material.map.dispose();
      sign.sprite.material.dispose();
    });
    static_scene.mesh.geometry.dispose();
    static_scene.mesh.material.dispose();
    renderer.dispose();
  }

  resize();

  return {
    rig,
    canvas,
    get aspect() {
      return width / height;
    },
    get viewport_height() {
      return height;
    },
    get shadows_on() {
      return shadows_on;
    },
    get stats() {
      return { draw_calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, vertices: static_scene.vertex_count, instances: entities.stats() };
    },
    entities,
    resize,
    frame,
    mark_dirty,
    camera_changed,
    rotate,
    zoom,
    fit,
    focus,
    attach_simulation,
    on_events,
    sync,
    pick,
    set_shadows,
    dispose,
  };
}
