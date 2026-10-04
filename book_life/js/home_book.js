// El libro 3D de la pantalla de inicio: tapas, lomo y hojas hechos con formas simples.
// Flota sobre su sitio y se inclina hacia donde está el puntero. Tiene dos secuencias:
// - mostrar la página ("peek"): al tocar el libro se gira hacia quien lo mira, abre la tapa, la deja
//   abierta un rato (mientras la escena lanza fuegos artificiales) y la cierra. Sin cambiar de tamaño.
// - abrir para leer ("open", "land", "release"): gira y abre la tapa; luego se desliza, crece y se estira hasta
//   quedar exactamente sobre el libro de la pantalla de lectura (la hoja derecha del 3D es la hoja derecha
//   del libro real); por último se desvanece. Así la lectura aparece sobre este mismo libro, sin cambio brusco.
//
// Este módulo no importa Three.js: la escena le pasa la librería. Así, si la CDN falla, no rompe nada.

const BOOK_WIDTH = 100;
const BOOK_HEIGHT = 135;
const BOOK_THICKNESS = 20;
const COVER_THICKNESS = 3;
// Las hojas son un poco más pequeñas que las tapas: el borde de la tapa es el marco del libro real.
const PAGES_WIDTH = BOOK_WIDTH - 6;
const PAGES_HEIGHT = BOOK_HEIGHT - 6;
// El libro vive delante del cielo (corazones y pétalos están en z = 0), para que nunca los tape.
const BOOK_DEPTH = 120;
const OPEN_ANGLE = 2.85;
const APPEAR_SPEED = 2.2;
// Apertura para leer: pausa para girar antes de abrir la tapa, trayecto hasta el libro real y desvanecido final.
const OPEN_COVER_DELAY_SECONDS = 0.2;
const LAND_SECONDS = 1.1;
const RELEASE_SECONDS = 0.3;
// Si la pestaña está dormida y la animación no avanza, no se deja a la persona esperando.
const OPEN_SAFETY_SECONDS = 3;
const LAND_SAFETY_SECONDS = 3;
const RELEASE_SAFETY_SECONDS = 1;
// Color del papel de las hojas del libro real (--paper en styles.css): el 3D y el libro real deben coincidir.
const PAPER_COLOR = "#fffdf8";
const HOVER_SCALE = 1.07;
// Velocidades con las que el libro se acerca a su postura final (por segundo): sin saltos entre secuencias.
const FACING_SPEED = 5;
const COVER_SPEED = 3.4;
// Cuánto tiempo queda abierto el libro, contado desde que la tapa terminó de abrirse.
const PEEK_HOLD_SECONDS = 3.1;
const PEEK_SAFETY_SECONDS = 10;
// La tapa abierta ocupa casi dos anchos de libro: se centra el conjunto y, si no cabe, se reduce.
const OPEN_SPREAD_UNITS = BOOK_WIDTH * 1.96;
const SCREEN_FIT_MARGIN = 0.94;

function clamp_unit(value) {
  return Math.min(1, Math.max(0, value));
}

function ease_in_out(value) {
  return value < 0.5 ? 2 * value * value : 1 - (-2 * value + 2) ** 2 / 2;
}

function ease_out(value) {
  return 1 - (1 - value) ** 3;
}

function trace_rounded_rectangle(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function trace_heart(context, center_x, center_y, size) {
  const scale = size / 76;
  context.beginPath();
  context.moveTo(center_x, center_y + 38 * scale);
  context.bezierCurveTo(center_x - 46 * scale, center_y + 6 * scale, center_x - 40 * scale, center_y - 34 * scale, center_x - 18 * scale, center_y - 34 * scale);
  context.bezierCurveTo(center_x - 8 * scale, center_y - 34 * scale, center_x - 2 * scale, center_y - 28 * scale, center_x, center_y - 20 * scale);
  context.bezierCurveTo(center_x + 2 * scale, center_y - 28 * scale, center_x + 8 * scale, center_y - 34 * scale, center_x + 18 * scale, center_y - 34 * scale);
  context.bezierCurveTo(center_x + 40 * scale, center_y - 34 * scale, center_x + 46 * scale, center_y + 6 * scale, center_x, center_y + 38 * scale);
  context.closePath();
}

function trace_sparkle(context, center_x, center_y, radius) {
  context.beginPath();
  for (let point = 0; point < 8; point += 1) {
    const angle = (point * Math.PI) / 4;
    const length = point % 2 === 0 ? radius : radius * 0.28;
    const x = center_x + Math.sin(angle) * length;
    const y = center_y - Math.cos(angle) * length;
    if (point === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

// Parte un texto en renglones que quepan en un ancho, sin cortar palabras.
function wrap_text(context, text, max_width) {
  const lines = [];
  let line = "";
  text.split(" ").forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > max_width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines;
}

// Dibuja la portada del libro en un canvas: degradado rosa y lavanda, marco dorado, el título, la foto
// (o un corazón si todavía no hay foto) y los nombres. content = { names, image }.
function draw_cover(canvas, content) {
  const width = canvas.width;
  const height = canvas.height;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, width, height);

  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#e88fbb");
  background.addColorStop(1, "#a98be3");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  // Un brillo suave en una esquina, sin llegar a lavar los colores
  const shine = context.createRadialGradient(width * 0.25, height * 0.18, 10, width * 0.25, height * 0.18, width * 0.8);
  shine.addColorStop(0, "rgba(255, 255, 255, 0.22)");
  shine.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = shine;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "#ffe29a";
  context.lineWidth = 9;
  trace_rounded_rectangle(context, 28, 28, width - 56, height - 56, 26);
  context.stroke();
  context.strokeStyle = "rgba(255, 255, 255, 0.6)";
  context.lineWidth = 2.5;
  trace_rounded_rectangle(context, 50, 50, width - 100, height - 100, 18);
  context.stroke();

  // Título
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#fffaf0";
  context.shadowColor = "rgba(150, 70, 140, 0.55)";
  context.shadowBlur = 10;
  context.font = '700 62px Lora, Georgia, "Times New Roman", serif';
  context.fillText("Libro de vida", width / 2, height * 0.17);
  context.shadowBlur = 0;

  // Foto con marco blanco, en proporción 4:3 como las fotos del libro
  const photo_width = 340;
  const photo_height = 255;
  const photo_x = (width - photo_width) / 2;
  const photo_y = height * 0.29;
  let is_photo_drawn = false;
  if (content.image) {
    context.save();
    context.shadowColor = "rgba(90, 40, 110, 0.4)";
    context.shadowBlur = 18;
    context.shadowOffsetY = 6;
    context.fillStyle = "#fffdf8";
    trace_rounded_rectangle(context, photo_x - 9, photo_y - 9, photo_width + 18, photo_height + 18, 18);
    context.fill();
    context.restore();
    context.save();
    trace_rounded_rectangle(context, photo_x, photo_y, photo_width, photo_height, 10);
    context.clip();
    context.drawImage(content.image, photo_x, photo_y, photo_width, photo_height);
    context.restore();
    // Si el navegador marcó la imagen como ajena, no se puede usar como textura: se dibuja sin ella.
    try {
      context.getImageData(0, 0, 1, 1);
      is_photo_drawn = true;
    } catch {
      return draw_cover(canvas, { ...content, image: null });
    }
  }
  if (!is_photo_drawn) {
    // Corazón central: rosa con un reflejo discreto, sin el halo blanco que lo hacía brillar de más
    const heart_y = photo_y + photo_height / 2;
    context.save();
    context.shadowColor = "rgba(150, 50, 110, 0.35)";
    context.shadowBlur = 12;
    context.shadowOffsetY = 4;
    const heart_fill = context.createLinearGradient(0, heart_y - 70, 0, heart_y + 60);
    heart_fill.addColorStop(0, "#ffb3cf");
    heart_fill.addColorStop(1, "#ff6f9f");
    context.fillStyle = heart_fill;
    trace_heart(context, width / 2, heart_y, 170);
    context.fill();
    context.restore();
    context.fillStyle = "rgba(255, 255, 255, 0.35)";
    context.beginPath();
    context.ellipse(width / 2 - 40, heart_y - 34, 19, 11, -0.6, 0, Math.PI * 2);
    context.fill();
  }

  // Nombres, en los renglones que hagan falta
  if (content.names) {
    context.fillStyle = "#fffaf0";
    context.shadowColor = "rgba(150, 70, 140, 0.55)";
    context.shadowBlur = 8;
    context.font = 'italic 700 38px Lora, Georgia, "Times New Roman", serif';
    const lines = wrap_text(context, content.names, width - 130).slice(0, 3);
    const first_y = height * 0.77 - ((lines.length - 1) * 46) / 2;
    lines.forEach((line, index) => context.fillText(line, width / 2, first_y + index * 46));
    context.shadowBlur = 0;
  }

  // Destellos en las esquinas y adorno inferior
  context.fillStyle = "#ffe29a";
  [
    [0.15, 0.1, 15],
    [0.85, 0.1, 12],
    [0.14, 0.9, 12],
    [0.86, 0.9, 15],
  ].forEach(([x_ratio, y_ratio, radius]) => {
    trace_sparkle(context, width * x_ratio, height * y_ratio, radius);
    context.fill();
  });
  context.fillStyle = "#fff4f8";
  trace_heart(context, width / 2, height * 0.915, 30);
  context.fill();
}

// Canto de las hojas: rayitas finas, como el borde de un libro de verdad.
function draw_page_edge(canvas) {
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff7e8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let line = 0; line < canvas.height; line += 4) {
    context.fillStyle = line % 8 === 0 ? "rgba(190, 160, 120, 0.38)" : "rgba(190, 160, 120, 0.16)";
    context.fillRect(0, line, canvas.width, 1.5);
  }
}

// Hoja interior: papel liso con la sombra junto al lomo, igual que las hojas del libro real (.page_left y
// .page_right en styles.css), para que al llegar a la lectura no se note dónde termina el 3D.
function draw_inside_page(canvas, shadow_on_left) {
  const width = canvas.width;
  const height = canvas.height;
  const context = canvas.getContext("2d");
  context.fillStyle = PAPER_COLOR;
  context.fillRect(0, 0, width, height);

  const shadow = context.createLinearGradient(shadow_on_left ? 0 : width, 0, shadow_on_left ? width : 0, 0);
  shadow.addColorStop(0, "rgba(120, 90, 60, 0.28)");
  shadow.addColorStop(0.05, "rgba(120, 90, 60, 0.07)");
  shadow.addColorStop(0.14, "rgba(120, 90, 60, 0)");
  shadow.addColorStop(1, "rgba(120, 90, 60, 0)");
  context.fillStyle = shadow;
  context.fillRect(0, 0, width, height);
}

// Adorno de la hoja abierta (renglones tenues y un corazón pequeño). Va en una capa aparte que se desvanece
// al pasar a la lectura, porque el libro real tiene la hoja lisa.
function draw_inside_decor(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, width, height);

  context.fillStyle = "rgba(200, 165, 125, 0.4)";
  for (let line = height * 0.2; line < height * 0.8; line += height * 0.075) {
    context.fillRect(width * 0.16, line, width * 0.68, 2);
  }

  context.fillStyle = "rgba(235, 105, 160, 0.5)";
  trace_heart(context, width / 2, height * 0.9, 30);
  context.fill();
}

function draw_glow(canvas) {
  const context = canvas.getContext("2d");
  const half = canvas.width / 2;
  const gradient = context.createRadialGradient(half, half, 4, half, half, half);
  gradient.addColorStop(0, "rgba(255, 150, 200, 0.7)");
  gradient.addColorStop(0.5, "rgba(255, 150, 200, 0.22)");
  gradient.addColorStop(1, "rgba(255, 150, 200, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function make_texture(THREE, width, height, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, texture };
}

export function create_home_book(THREE) {
  const root = new THREE.Group(); // posición en pantalla y tamaño
  const body = new THREE.Group(); // giro y flotación
  root.add(body);
  root.visible = false;

  // Luz moderada: con más, los colores claros de la portada se queman y el corazón parece encendido.
  root.add(new THREE.AmbientLight(0xffffff, 1.25));
  const key_light = new THREE.DirectionalLight(0xffffff, 1.6);
  key_light.position.set(-120, 160, 320);
  root.add(key_light);

  // Lo que lleva la portada: se cambia con set_cover cuando llegan la foto y los nombres
  let cover_content = { names: "", image: null };
  const cover = make_texture(THREE, 512, 690, (canvas) => draw_cover(canvas, cover_content));
  const page_edge = make_texture(THREE, 64, 128, draw_page_edge);
  const glow = make_texture(THREE, 256, 256, draw_glow);
  const inside_left = make_texture(THREE, 256, 346, (canvas) => draw_inside_page(canvas, false));
  const inside_right = make_texture(THREE, 256, 346, (canvas) => draw_inside_page(canvas, true));
  const inside_decor = make_texture(THREE, 256, 346, draw_inside_decor);

  const materials = {
    paper: new THREE.MeshStandardMaterial({ color: 0xfff4e2, roughness: 0.9 }),
    edge: new THREE.MeshStandardMaterial({ color: 0xc477ac, roughness: 0.6 }),
    back: new THREE.MeshStandardMaterial({ color: 0xa06bc2, roughness: 0.6 }),
    spine: new THREE.MeshStandardMaterial({ color: 0xb866ae, roughness: 0.5 }),
    page_edge: new THREE.MeshStandardMaterial({ map: page_edge.texture, roughness: 0.9 }),
    cover: new THREE.MeshStandardMaterial({ map: cover.texture, roughness: 0.5 }),
    // Sin luces: el papel del 3D tiene que verse del mismo color que el del libro real
    inside_left: new THREE.MeshBasicMaterial({ map: inside_left.texture }),
    inside_right: new THREE.MeshBasicMaterial({ map: inside_right.texture }),
  };
  const all_materials = Object.values(materials);
  const decor_material = new THREE.MeshBasicMaterial({ map: inside_decor.texture, transparent: true, depthWrite: false });

  // Hojas
  const pages_depth = BOOK_THICKNESS - COVER_THICKNESS * 2;
  const pages = new THREE.Mesh(new THREE.BoxGeometry(PAGES_WIDTH, PAGES_HEIGHT, pages_depth), [
    materials.page_edge,
    materials.paper,
    materials.page_edge,
    materials.page_edge,
    materials.inside_right,
    materials.paper,
  ]);
  body.add(pages);

  // Tapa trasera
  const back_cover = new THREE.Mesh(new THREE.BoxGeometry(BOOK_WIDTH, BOOK_HEIGHT, COVER_THICKNESS), [
    materials.edge,
    materials.edge,
    materials.edge,
    materials.edge,
    materials.paper,
    materials.back,
  ]);
  back_cover.position.z = -(BOOK_THICKNESS / 2 - COVER_THICKNESS / 2);
  body.add(back_cover);

  // Lomo. Sobresale un poco de las tapas por todos lados: si sus caras coincidieran exactamente con las
  // de las tapas, la tarjeta gráfica elegiría una u otra al azar en cada cuadro y el borde parpadearía
  // entre morado claro y oscuro.
  const spine = new THREE.Mesh(new THREE.BoxGeometry(5, BOOK_HEIGHT + 1, BOOK_THICKNESS + 1.2), materials.spine);
  spine.position.x = -BOOK_WIDTH / 2 + 1.8;
  body.add(spine);

  // Tapa delantera: gira sobre el lomo, que es su bisagra
  const hinge = new THREE.Group();
  hinge.position.set(-BOOK_WIDTH / 2, 0, BOOK_THICKNESS / 2 - COVER_THICKNESS / 2);
  const front_cover = new THREE.Mesh(new THREE.BoxGeometry(BOOK_WIDTH, BOOK_HEIGHT, COVER_THICKNESS), [
    materials.edge,
    materials.edge,
    materials.edge,
    materials.edge,
    materials.cover,
    materials.inside_left,
  ]);
  front_cover.position.x = BOOK_WIDTH / 2;
  hinge.add(front_cover);
  body.add(hinge);

  // Adorno de las dos hojas abiertas, apenas delante del papel. El de la tapa es hijo de la tapa, así que la acompaña.
  const decor_right = new THREE.Mesh(new THREE.PlaneGeometry(PAGES_WIDTH, PAGES_HEIGHT), decor_material);
  decor_right.position.z = pages_depth / 2 + 0.06;
  body.add(decor_right);
  const decor_left = new THREE.Mesh(new THREE.PlaneGeometry(BOOK_WIDTH, BOOK_HEIGHT), decor_material);
  decor_left.position.z = -COVER_THICKNESS / 2 - 0.06;
  decor_left.rotation.y = Math.PI;
  front_cover.add(decor_left);

  // Resplandor detrás del libro
  const glow_sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow.texture, transparent: true, depthWrite: false, opacity: 0.55 }));
  glow_sprite.scale.set(BOOK_WIDTH * 3, BOOK_WIDTH * 3, 1);
  glow_sprite.position.z = -70;
  root.add(glow_sprite);

  // Estado
  let slot_x = 0;
  let slot_y = 0;
  let slot_scale = 1;
  let viewport_width = 1000;
  let appear = 0;
  let hover_target = 1;
  let hover_current = 1;
  // idle | peeking | opening | open_hold | landing | landed | releasing | gone
  let state = "idle";
  let timeline = 0; // segundos desde que empezó la secuencia actual
  let facing = 0; // 0 de tres cuartos, 1 de frente
  let cover_open = 0; // 0 cerrada, 1 abierta del todo
  let held_open = 0;
  let land_progress = 0; // 0 en su sitio del inicio, 1 sobre el libro real
  let release_progress = 0;
  let applied_opacity = 1;
  let target = null; // dónde está el libro real: { x, y, page_w, page_h }, en píxeles de pantalla
  let has_notified_open = false;
  let on_open_callback = null;
  let sequence_resolve = null;
  let sequence_promise = null;
  let safety_timer = 0;

  function set_opacity(value) {
    applied_opacity = value;
    all_materials.forEach((material) => {
      material.transparent = value < 1;
      material.opacity = value;
    });
  }

  function lerp(from, to, amount) {
    return from + (to - from) * amount;
  }

  function finish_sequence(next_state) {
    clearTimeout(safety_timer);
    state = next_state;
    // Si el aviso de seguridad cortó el trayecto, el libro queda donde debía llegar
    if (next_state === "landed") land_progress = 1;
    if (next_state === "gone") root.visible = false;
    const resolve = sequence_resolve;
    sequence_resolve = null;
    sequence_promise = null;
    on_open_callback = null;
    if (resolve) resolve();
  }

  // Corta la secuencia en curso (si la hay) avisando a quien la esperaba.
  function cancel_sequence() {
    clearTimeout(safety_timer);
    const resolve = sequence_resolve;
    sequence_resolve = null;
    sequence_promise = null;
    on_open_callback = null;
    if (resolve) resolve();
  }

  function begin_sequence(next_state, safety_seconds, safety_state) {
    state = next_state;
    timeline = 0;
    held_open = 0;
    has_notified_open = false;
    sequence_promise = new Promise((resolve) => {
      sequence_resolve = resolve;
    });
    safety_timer = setTimeout(() => finish_sequence(safety_state), safety_seconds * 1000);
    return sequence_promise;
  }

  // Del libro cerrado del inicio al libro real de la lectura: se desliza, crece y se estira hasta cubrirlo.
  function start_landing() {
    land_progress = 0;
    return begin_sequence("landing", LAND_SAFETY_SECONDS, "landed");
  }

  return {
    group: root,

    // Dónde y de qué tamaño se dibuja en el inicio, en píxeles de pantalla. Lo da la escena cada cuadro.
    place(x, y, slot_width, slot_height, screen_width) {
      slot_x = x;
      slot_y = y;
      slot_scale = Math.min(slot_width / (BOOK_WIDTH * 1.1), slot_height / (BOOK_HEIGHT * 1.05));
      viewport_width = screen_width;
    },

    // Dónde está el libro real de la lectura (o null si todavía no se ve). La hoja derecha del 3D se acomoda
    // sobre su hoja derecha: x e y son el centro de esa hoja y page_w y page_h su tamaño.
    set_target(next_target) {
      target = next_target;
    },

    set_visible(is_visible) {
      root.visible = is_visible;
    },

    set_hover(is_hovering) {
      hover_target = is_hovering ? HOVER_SCALE : 1;
    },

    // Vuelve al libro cerrado y lo hace aparecer suavemente.
    reset() {
      cancel_sequence();
      state = "idle";
      timeline = 0;
      appear = 0;
      facing = 0;
      cover_open = 0;
      land_progress = 0;
      release_progress = 0;
      target = null;
      hinge.rotation.y = 0;
      set_opacity(1);
    },

    // Redibuja la portada, por ejemplo cuando la tipografía termina de cargar.
    redraw_cover() {
      draw_cover(cover.canvas, cover_content);
      cover.texture.needsUpdate = true;
    },

    // Cambia lo que lleva la portada: { names, image }, con image ya cargada o null.
    set_cover(content) {
      cover_content = { names: content.names || "", image: content.image || null };
      this.redraw_cover();
    },

    // Se gira, abre la tapa, la deja abierta y la cierra. No cambia de tamaño. Avisa cuando la tapa ya
    // está abierta (para lanzar los fuegos artificiales) y devuelve una promesa que termina al cerrarse.
    peek(on_open) {
      if (state !== "idle") return sequence_promise || Promise.resolve();
      on_open_callback = on_open;
      return begin_sequence("peeking", PEEK_SAFETY_SECONDS, "idle");
    },

    // Gira hacia quien lo mira y abre la tapa, que se queda abierta. La promesa termina cuando la tapa ya
    // está abierta del todo; después hay que llamar a land().
    open() {
      if (state !== "idle" && state !== "peeking") return sequence_promise || Promise.resolve();
      // Si estaba mostrando la página, esa secuencia se corta y la apertura sigue desde la postura actual:
      // la postura se suaviza sola, así que no hay saltos ni se vuelve a cerrar la tapa.
      const was_peeking = state === "peeking";
      cancel_sequence();
      const promise = begin_sequence("opening", OPEN_SAFETY_SECONDS, "open_hold");
      if (was_peeking) timeline = OPEN_COVER_DELAY_SECONDS;
      return promise;
    },

    // Con la tapa abierta, lleva el libro hasta quedar sobre el libro real. Hay que dar antes el destino con
    // set_target. La promesa termina cuando llegó: ahí la lectura puede aparecer encima.
    land() {
      if (state === "opening") return sequence_promise.then(start_landing);
      if (state === "open_hold") return start_landing();
      return sequence_promise || Promise.resolve();
    },

    // Desvanece el libro 3D, ya cubierto por el libro real. La promesa termina cuando desapareció.
    release() {
      if (state === "gone" || state === "idle") return Promise.resolve();
      cancel_sequence();
      release_progress = 0;
      return begin_sequence("releasing", RELEASE_SAFETY_SECONDS, "gone");
    },

    update(time, delta, pointer, can_animate) {
      if (!root.visible) return;

      appear = can_animate ? Math.min(1, appear + delta * APPEAR_SPEED) : 1;
      hover_current += (hover_target - hover_current) * Math.min(1, delta * 8);
      const float_offset = can_animate ? Math.sin(time * 1.4) * 3.5 : 0;

      // Hacia dónde se dirigen la postura y la tapa en cada momento
      let facing_target = 0;
      let cover_target = 0;

      if (state === "peeking") {
        timeline += delta;
        facing_target = 1;
        if (!has_notified_open && cover_open >= 0.92) {
          has_notified_open = true;
          if (on_open_callback) on_open_callback();
        }
        if (has_notified_open) held_open += delta;
        cover_target = held_open < PEEK_HOLD_SECONDS ? 1 : 0;
        const is_closed_again = held_open >= PEEK_HOLD_SECONDS && cover_open < 0.02 && facing < 0.02;
        if (is_closed_again) finish_sequence("idle");
      } else if (state !== "idle") {
        facing_target = 1;
        if (state === "opening") {
          timeline += delta;
          cover_target = timeline > OPEN_COVER_DELAY_SECONDS ? 1 : 0;
          if (cover_open >= 0.97) finish_sequence("open_hold");
        } else {
          cover_target = 1;
        }
        if (state === "landing") {
          land_progress = Math.min(1, land_progress + delta / LAND_SECONDS);
          if (land_progress >= 1) finish_sequence("landed");
        }
        if (state === "releasing") {
          release_progress = Math.min(1, release_progress + delta / RELEASE_SECONDS);
          if (release_progress >= 1) finish_sequence("gone");
        }
      }

      // Cuando no hay animación (movimiento reducido), cada postura se alcanza de inmediato.
      const facing_step = can_animate ? 1 - Math.exp(-FACING_SPEED * delta) : 1;
      const cover_step = can_animate ? 1 - Math.exp(-COVER_SPEED * delta) : 1;
      facing += (facing_target - facing) * facing_step;
      cover_open += (cover_target - cover_open) * cover_step;

      // Giro de reposo: de tres cuartos, para que se vea el lomo, y hacia donde esté el puntero
      const idle_y = -0.42 + (can_animate ? pointer.x * 0.7 : 0);
      const idle_x = 0.1 + (can_animate ? pointer.y * 0.35 : 0);
      body.rotation.y = idle_y * (1 - facing);
      body.rotation.x = idle_x * (1 - facing);

      // Avance hacia el libro real (m) y ajuste fino de la forma (alignment), que va en la segunda parte del trayecto
      const m = target ? ease_in_out(clamp_unit(land_progress)) : 0;
      const alignment = ease_in_out(clamp_unit((m - 0.3) / 0.7));

      const open_amount = ease_in_out(clamp_unit(cover_open));
      let angle = open_amount * OPEN_ANGLE;
      angle += (Math.PI - angle) * alignment;
      hinge.rotation.y = -angle;

      // Al alinearse, la tapa abierta queda plana y del tamaño exacto de una hoja, junto al borde izquierdo de las hojas
      hinge.position.x = -BOOK_WIDTH / 2 + ((BOOK_WIDTH - PAGES_WIDTH) / 2) * alignment;
      front_cover.scale.set(lerp(1, PAGES_WIDTH / BOOK_WIDTH, alignment), lerp(1, PAGES_HEIGHT / BOOK_HEIGHT, alignment), 1);
      front_cover.position.x = (BOOK_WIDTH / 2) * front_cover.scale.x;
      // El lomo, visto de frente con el libro abierto, quedaría como una franja entre las hojas: se adelgaza
      const spine_hidden = Math.min(1, open_amount * 0.8 + alignment * 0.2);
      spine.visible = spine_hidden < 0.995;
      spine.scale.x = Math.max(0.01, 1 - spine_hidden);

      // Con la tapa abierta el conjunto ocupa casi dos anchos: se centra para que no quede corrido a un lado
      const left_extent = Math.min(-BOOK_WIDTH / 2 + BOOK_WIDTH * Math.cos(angle), -BOOK_WIDTH / 2);
      const spread_center = (left_extent + BOOK_WIDTH / 2) / 2;
      body.position.x = -spread_center * facing * (1 - m);
      body.position.y = float_offset * (1 - m);

      // En pantallas estrechas el libro abierto se reduce lo justo para no salirse; con la tapa cerrada no cambia
      const fit_open = Math.min(1, (viewport_width * SCREEN_FIT_MARGIN) / (OPEN_SPREAD_UNITS * slot_scale));
      const fit = 1 - (1 - fit_open) * open_amount;
      const base_scale = slot_scale * fit * hover_current * (0.6 + 0.4 * ease_out(appear));

      if (target) {
        // Cada eje por separado: el libro real no tiene las mismas proporciones que el 3D
        const target_x_scale = target.page_w / PAGES_WIDTH;
        const target_y_scale = target.page_h / PAGES_HEIGHT;
        root.position.set(lerp(slot_x, target.x, m), lerp(slot_y, target.y, m), BOOK_DEPTH);
        root.scale.set(lerp(base_scale, target_x_scale, m), lerp(base_scale, target_y_scale, m), lerp(base_scale, Math.min(target_x_scale, target_y_scale), m));
      } else {
        root.position.set(slot_x, slot_y, BOOK_DEPTH);
        root.scale.setScalar(base_scale);
      }

      // Opacidad: el 3D solo se desvanece al final, cuando el libro real ya lo cubre
      const overall_opacity = state === "releasing" ? 1 - release_progress : state === "gone" ? 0 : 1;
      if (overall_opacity !== applied_opacity) set_opacity(overall_opacity);

      // El resplandor y el adorno de las hojas se apagan mientras el libro llega al libro real
      const glow_pulse = 0.5 + (can_animate ? Math.sin(time * 2) * 0.12 : 0);
      glow_sprite.material.opacity = glow_pulse * (1 - m) * overall_opacity;
      decor_material.opacity = (1 - clamp_unit(m / 0.5)) * overall_opacity;
      decor_right.visible = decor_material.opacity > 0.01;
      decor_left.visible = decor_right.visible;
    },
  };
}
