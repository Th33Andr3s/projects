// Los gestos y teclas que mueven la cámara: arrastrar para desplazarse, rueda o pellizco para acercar, flechas y +/− con el
// lienzo enfocado. La matemática está en camera_rig.js; aquí solo se traducen eventos de la página a esas llamadas.
// Los giros de 90° (Q y E) son atajos globales y los maneja main.js.

const WHEEL_ZOOM_SPEED = 0.0016;
// Lo que se mueve el puntero antes de contar como arrastre y no como un clic
const DRAG_THRESHOLD_PIXELS = 4;
const PAN_KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

export function attach_camera_controls(controller) {
  const { canvas, rig } = controller;
  const pointers = new Map();
  const held_keys = new Set();
  let pinch_distance = 0;
  let moved_pixels = 0;

  function normalized(client_x, client_y) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((client_x - bounds.left) / bounds.width) * 2 - 1,
      y: -(((client_y - bounds.top) / bounds.height) * 2 - 1),
    };
  }

  function pointer_distance() {
    const [first, second] = [...pointers.values()];
    return Math.hypot(first.x - second.x, first.y - second.y);
  }

  function pointer_middle() {
    const [first, second] = [...pointers.values()];
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  }

  function on_pointer_down(event) {
    if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 1) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      // Con el puntero capturado, el arrastre sigue aunque el dedo salga del lienzo
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Si el puntero ya no está activo no hay nada que capturar; el arrastre sigue funcionando dentro del lienzo
    }
    moved_pixels = 0;
    if (pointers.size === 2) pinch_distance = pointer_distance();
    canvas.classList.add("is_dragging");
  }

  function on_pointer_move(event) {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const current = { x: event.clientX, y: event.clientY };
    if (pointers.size === 1) {
      moved_pixels += Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
      pointers.set(event.pointerId, current);
      if (moved_pixels > DRAG_THRESHOLD_PIXELS) {
        rig.pan_pixels(current.x - previous.x, current.y - previous.y, controller.viewport_height, controller.aspect);
        controller.camera_changed();
      }
      return;
    }
    // Dos dedos: la distancia entre ellos acerca o aleja, y su punto medio arrastra
    const middle_before = pointer_middle();
    pointers.set(event.pointerId, current);
    const middle_after = pointer_middle();
    const distance = pointer_distance();
    if (pinch_distance > 0 && distance > 0) {
      const anchor = normalized(middle_after.x, middle_after.y);
      rig.zoom_by(distance / pinch_distance, controller.aspect, anchor.x, anchor.y);
    }
    pinch_distance = distance;
    rig.pan_pixels(middle_after.x - middle_before.x, middle_after.y - middle_before.y, controller.viewport_height, controller.aspect);
    controller.camera_changed();
  }

  function on_pointer_end(event) {
    const was_single = pointers.size === 1;
    if (!pointers.delete(event.pointerId)) return;
    // Un toque o clic sin arrastre elige lo que haya debajo
    if (event.type === "pointerup" && was_single && moved_pixels <= DRAG_THRESHOLD_PIXELS && controller.on_click) {
      const point = normalized(event.clientX, event.clientY);
      controller.on_click(point.x, point.y);
    }
    pinch_distance = pointers.size === 2 ? pointer_distance() : 0;
    if (pointers.size === 0) canvas.classList.remove("is_dragging");
  }

  function on_wheel(event) {
    event.preventDefault();
    const anchor = normalized(event.clientX, event.clientY);
    // deltaMode 1 son líneas en lugar de píxeles (algunos ratones en Firefox)
    const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
    rig.zoom_by(Math.exp(-delta * WHEEL_ZOOM_SPEED), controller.aspect, anchor.x, anchor.y);
    controller.camera_changed();
  }

  function on_key_down(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (PAN_KEYS[event.key]) {
      held_keys.add(event.key);
      event.preventDefault();
    } else if (event.key === "+" || event.key === "=") {
      rig.zoom_step(1, controller.aspect);
      controller.camera_changed();
      event.preventDefault();
    } else if (event.key === "-" || event.key === "_") {
      rig.zoom_step(-1, controller.aspect);
      controller.camera_changed();
      event.preventDefault();
    } else if (event.key === "Home" || event.key === "0") {
      rig.reset();
      controller.camera_changed();
      event.preventDefault();
    }
  }

  function on_key_up(event) {
    held_keys.delete(event.key);
  }

  canvas.addEventListener("pointerdown", on_pointer_down);
  canvas.addEventListener("pointermove", on_pointer_move);
  canvas.addEventListener("pointerup", on_pointer_end);
  canvas.addEventListener("pointercancel", on_pointer_end);
  canvas.addEventListener("wheel", on_wheel, { passive: false });
  canvas.addEventListener("keydown", on_key_down);
  canvas.addEventListener("keyup", on_key_up);
  canvas.addEventListener("blur", () => held_keys.clear());

  // Se llama en cada cuadro: mueve la cámara mientras haya flechas apretadas
  function update(dt) {
    if (held_keys.size === 0) return;
    let x = 0;
    let y = 0;
    held_keys.forEach((key) => {
      x += PAN_KEYS[key][0];
      y += PAN_KEYS[key][1];
    });
    if (x === 0 && y === 0) return;
    rig.pan_keys(Math.sign(x), Math.sign(y), dt, controller.aspect);
    controller.camera_changed();
  }

  return { update };
}
