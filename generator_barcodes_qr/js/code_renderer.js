// Dibujo de los códigos: de una matriz QR o de un modelo de barras a un "dibujo" neutro (rectángulos y textos en
// módulos) y de ahí a SVG (para ver y descargar) o a PNG (con un <canvas>).
//
// Todo se mide en módulos, la unidad más pequeña del código, y el SVG usa esas mismas medidas como `viewBox`:
// así el código se ve nítido a cualquier tamaño. Los códigos salen siempre en negro sobre blanco, que es lo que
// cualquier lector lee a la primera.
//
// Un dibujo es { kind, width, height, rects: [{ x, y, width, height }], texts: [{ x, y, text, size }] }.

const QR_QUIET_ZONE = 4;
// Alto de las barras en módulos según la opción elegida
const BARCODE_HEIGHTS = { short: 30, normal: 50, tall: 80 };
const DEFAULT_BARCODE_HEIGHT = BARCODE_HEIGHTS.normal;
// Aire arriba y abajo de las barras (el lado lo pone la zona de silencio del código)
const VERTICAL_PADDING = 4;
const TEXT_SIZE = 10;
// En EAN y UPC las guardas bajan hasta el texto, y los dígitos van en esa franja
const GUARD_EXTENSION = 9;
const EAN_TEXT_BASELINE = 8.5;
// En los demás tipos el texto va debajo de las barras, con un espacio
const LINE_TEXT_BASELINE = 12;
const LINE_TEXT_ZONE = 14;
const SVG_FONT_FAMILY = "ui-monospace,Consolas,'Courier New',monospace";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

// ---------------------------------------------------------------------------
// De matriz o barras a dibujo
// ---------------------------------------------------------------------------

// QR: un rectángulo por cada tramo seguido de módulos negros de una fila, con 4 módulos de zona de silencio
export function build_qr_drawing(matrix) {
  const size = matrix.length;
  const rects = [];
  matrix.forEach((row, y) => {
    let start = -1;
    for (let x = 0; x <= size; x++) {
      const is_dark = x < size && row[x];
      if (is_dark && start < 0) start = x;
      if (!is_dark && start >= 0) {
        rects.push({ x: start + QR_QUIET_ZONE, y: y + QR_QUIET_ZONE, width: x - start, height: 1 });
        start = -1;
      }
    }
  });
  const total = size + QR_QUIET_ZONE * 2;
  return { kind: "qr", width: total, height: total, rects, texts: [] };
}

// Código de barras: `height` es "short", "normal" o "tall"; `show_text` pone el texto legible debajo
export function build_barcode_drawing(model, { height = "normal", show_text = true } = {}) {
  const bar_height = BARCODE_HEIGHTS[height] ?? DEFAULT_BARCODE_HEIGHT;
  // Solo EAN y UPC tienen barras que bajan hasta el texto, y su texto va dígito por dígito
  const is_digit_layout = model.bars.some((bar) => bar.extended);
  const frame = model.frame || 0;
  const text_zone = !show_text ? 0 : is_digit_layout ? GUARD_EXTENSION : LINE_TEXT_ZONE;

  const origin_x = frame + model.quiet_left;
  const origin_y = frame + VERTICAL_PADDING;
  const width = origin_x + model.width + model.quiet_right + frame;
  const height_total = origin_y + bar_height + text_zone + VERTICAL_PADDING + frame;

  const rects = model.bars.map((bar) => ({
    x: origin_x + bar.x,
    y: origin_y,
    width: bar.width,
    height: bar_height + (bar.extended && show_text ? GUARD_EXTENSION : 0),
  }));

  // Marco portador del ITF-14: cuatro barras alrededor de todo
  if (frame) {
    rects.push(
      { x: 0, y: 0, width, height: frame },
      { x: 0, y: height_total - frame, width, height: frame },
      { x: 0, y: frame, width: frame, height: height_total - frame * 2 },
      { x: width - frame, y: frame, width: frame, height: height_total - frame * 2 },
    );
  }

  const texts = [];
  if (show_text) {
    const baseline = origin_y + bar_height + (is_digit_layout ? EAN_TEXT_BASELINE : LINE_TEXT_BASELINE);
    model.labels.forEach((label) => texts.push({ x: origin_x + label.center, y: baseline, text: label.text, size: TEXT_SIZE }));
  }
  return { kind: "barcode", width, height: height_total, rects, texts };
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

function escape_xml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Texto SVG del dibujo. `label` es la descripción para lectores de pantalla (no debe repetir una clave);
// `scale` fija el tamaño en píxeles por módulo (para el archivo descargado); sin él, el SVG se adapta al contenedor.
export function drawing_to_svg(drawing, { label = "", scale = 0 } = {}) {
  const path = drawing.rects.map((rect) => `M${rect.x} ${rect.y}h${rect.width}v${rect.height}h${-rect.width}z`).join("");
  const size_attributes = scale ? ` width="${drawing.width * scale}" height="${drawing.height * scale}"` : "";
  const accessibility = label ? ` role="img" aria-label="${escape_xml(label)}"` : "";
  const texts = drawing.texts
    .map((item) => `<text x="${item.x}" y="${item.y}" font-size="${item.size}" text-anchor="middle">${escape_xml(item.text)}</text>`)
    .join("");
  return (
    `<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 ${drawing.width} ${drawing.height}"${size_attributes}${accessibility} shape-rendering="crispEdges">` +
    `<rect width="${drawing.width}" height="${drawing.height}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/>` +
    (texts ? `<g fill="#000" font-family="${SVG_FONT_FAMILY}" shape-rendering="auto">${texts}</g>` : "") +
    "</svg>"
  );
}

// Convierte el texto SVG en un elemento listo para insertar en la página, sin usar innerHTML
export function svg_to_element(svg_text) {
  const parsed = new DOMParser().parseFromString(svg_text, "image/svg+xml");
  if (parsed.querySelector("parsererror")) throw new Error("No se pudo construir el dibujo.");
  return document.importNode(parsed.documentElement, true);
}

// Píxeles por módulo para que el dibujo quepa en el ancho pedido, siempre un número entero y al menos 1
export function pixels_per_module(drawing, target_pixels) {
  return Math.max(1, Math.floor(target_pixels / drawing.width));
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

// Dibuja el código en un lienzo del ancho pedido. El módulo mide siempre un número entero de píxeles, para que
// no haya bordes grises que confundan al lector; lo que sobra se reparte como margen blanco alrededor.
export function draw_on_canvas(drawing, canvas, target_pixels) {
  const module_pixels = pixels_per_module(drawing, target_pixels);
  const drawn_width = module_pixels * drawing.width;
  const drawn_height = module_pixels * drawing.height;
  canvas.width = Math.max(target_pixels, drawn_width);
  // El QR es cuadrado y queda centrado; el de barras mide lo justo de alto
  canvas.height = drawing.kind === "qr" ? canvas.width : drawn_height;
  const offset_x = Math.floor((canvas.width - drawn_width) / 2);
  const offset_y = Math.floor((canvas.height - drawn_height) / 2);

  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000";
  drawing.rects.forEach((rect) => {
    context.fillRect(offset_x + rect.x * module_pixels, offset_y + rect.y * module_pixels, rect.width * module_pixels, rect.height * module_pixels);
  });
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  drawing.texts.forEach((item) => {
    context.font = `${item.size * module_pixels}px ${SVG_FONT_FAMILY}`;
    context.fillText(item.text, offset_x + item.x * module_pixels, offset_y + item.y * module_pixels);
  });
}

// PNG como Blob. Devuelve una promesa: el portapapeles de Safari exige recibir la promesa y no el Blob ya listo.
export function drawing_to_png_blob(drawing, target_pixels) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    draw_on_canvas(drawing, canvas, target_pixels);
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No se pudo crear la imagen."))), "image/png");
  });
}
