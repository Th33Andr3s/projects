// Escritor de PDF propio y genérico (CLAUDE.md 2.2 prohíbe librerías): páginas, texto, líneas, rectángulos, imágenes JPEG,
// medida de texto y corte de líneas. Son funciones puras: reciben datos y devuelven bytes, sin tocar la pantalla.
//
// Se usa lo más básico y estable del formato para que cualquier lector lo abra igual: PDF 1.4, las fuentes estándar
// Helvetica y Helvetica-Bold (no se incrustan; todo lector las tiene) con codificación WinAnsi (tildes, eñes, el signo de
// pesos), flujos sin comprimir y el JPEG tal cual (sin decodificarlo ni recomprimirlo). La tabla xref lleva los
// desplazamientos exactos en bytes.
//
// Las coordenadas que recibe son las de una hoja vista desde arriba: (0, 0) es la esquina superior izquierda y las
// y crecen hacia abajo; el escritor las convierte a las del PDF. La unidad es el punto (1/72 de pulgada).

export const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

// Ancho de cada código WinAnsi (de 0 a 255) en milésimas del tamaño de la letra. Son los anchos de Helvetica y
// Helvetica-Bold de Adobe (archivos AFM de las fuentes estándar); los códigos sin letra valen 0.
const REGULAR_WIDTHS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0,
  556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
  0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667,
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];

const BOLD_WIDTHS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 0,
  556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
  0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667,
  278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
  611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
];

const WIDTHS = { regular: REGULAR_WIDTHS, bold: BOLD_WIDTHS };
const FONT_RESOURCE = { regular: "F1", bold: "F2" };
// Los caracteres de WinAnsi (Windows-1252) que no están en Latin-1, con su código
const WINANSI_EXTRA = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);
const UNKNOWN_CODE = 0x3f;

// ---------------------------------------------------------------------------
// Texto: codificación y medidas
// ---------------------------------------------------------------------------

// El código WinAnsi de un carácter, o "?" si no existe en WinAnsi
function winansi_code(character) {
  const code = character.codePointAt(0);
  if (code >= 0x20 && code <= 0x7e) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  return WINANSI_EXTRA.get(code) ?? UNKNOWN_CODE;
}

// Los bytes WinAnsi de un texto (los saltos de línea y tabulaciones pasan a espacio)
function encode_winansi(text) {
  return [...String(text)].map((character) => (character === "\n" || character === "\t" || character === "\r" ? 0x20 : winansi_code(character)));
}

// Cuánto mide un texto, en puntos, con una fuente ("regular" o "bold") y un tamaño
function text_width(text, font, size) {
  const widths = WIDTHS[font];
  return (encode_winansi(text).reduce((total, code) => total + widths[code], 0) * size) / 1000;
}

// Corta un texto en líneas que quepan en un ancho, por palabras. Respeta los saltos de línea del texto, y una palabra más
// larga que el ancho se parte por letras.
export function wrap_text(text, font, size, max_width) {
  const lines = [];
  String(text).replace(/\r\n?/g, "\n").split("\n").forEach((paragraph) => {
    let current = "";
    paragraph.split(" ").forEach((word) => {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (text_width(candidate, font, size) <= max_width) {
        current = candidate;
        return;
      }
      if (current !== "") lines.push(current);
      current = word;
      // Una palabra sola que no cabe se parte por letras
      while (text_width(current, font, size) > max_width && [...current].length > 1) {
        let cut = [...current];
        while (cut.length > 1 && text_width(cut.join(""), font, size) > max_width) cut = cut.slice(0, -1);
        lines.push(cut.join(""));
        current = current.slice(cut.join("").length);
      }
    });
    lines.push(current);
  });
  return lines;
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

// Lee las medidas de un JPEG sin decodificarlo: { width, height, components } o null si no es un JPEG que el PDF pueda usar
// tal cual (grises o color). Recorre los marcadores hasta el de inicio de cuadro (SOF).
function parse_jpeg(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let position = 2;
  while (position + 4 <= bytes.length) {
    if (bytes[position] !== 0xff) return null;
    const marker = bytes[position + 1];
    if (marker === 0xff) {
      position += 1;
      continue;
    }
    // Marcadores sin longitud
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      position += 2;
      continue;
    }
    const length = (bytes[position + 2] << 8) | bytes[position + 3];
    const is_frame_start = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (is_frame_start) {
      if (position + 10 > bytes.length) return null;
      const height = (bytes[position + 5] << 8) | bytes[position + 6];
      const width = (bytes[position + 7] << 8) | bytes[position + 8];
      const components = bytes[position + 9];
      return width > 0 && height > 0 && (components === 1 || components === 3) ? { width, height, components } : null;
    }
    if (marker === 0xda) return null;
    position += 2 + length;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

// Un número para el contenido de la página: sin notación científica y con hasta 2 decimales
function number(value) {
  return String(Math.round(value * 100) / 100);
}

function color_ops(color, fill) {
  return `${color.map(number).join(" ")} ${color.length === 1 ? (fill ? "g" : "G") : fill ? "rg" : "RG"}`;
}

// Un texto como cadena PDF entre paréntesis, con sus bytes WinAnsi como caracteres de 0 a 255 y escapando ( ) y \
function pdf_string(text) {
  return `(${encode_winansi(text).map((code) => (code === 0x28 || code === 0x29 || code === 0x5c ? `\\${String.fromCharCode(code)}` : String.fromCharCode(code))).join("")})`;
}

class Page {
  constructor() {
    this.operations = [];
  }

  // Texto con su línea base en y. align: "left" (x es el borde izquierdo), "right" (x es el borde derecho) o "center".
  text(x, y, text, { font = "regular", size = 10, align = "left", color = [0] } = {}) {
    const width = text_width(text, font, size);
    const left = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
    this.operations.push(`BT ${color_ops(color, true)} /${FONT_RESOURCE[font]} ${number(size)} Tf 1 0 0 1 ${number(left)} ${number(PAGE_HEIGHT - y)} Tm ${pdf_string(text)} Tj ET`);
  }

  line(x1, y1, x2, y2, { width = 0.5, color = [0] } = {}) {
    this.operations.push(`${color_ops(color, false)} ${number(width)} w ${number(x1)} ${number(PAGE_HEIGHT - y1)} m ${number(x2)} ${number(PAGE_HEIGHT - y2)} l S`);
  }

  // Rectángulo con su esquina superior izquierda en (x, y); con fill, relleno
  rect(x, y, width, height, { fill = null, stroke = null, line_width = 0.5 } = {}) {
    const paint = fill && stroke ? "B" : fill ? "f" : "S";
    const colors = `${fill ? `${color_ops(fill, true)} ` : ""}${stroke ? `${color_ops(stroke, false)} ${number(line_width)} w ` : ""}`;
    this.operations.push(`${colors}${number(x)} ${number(PAGE_HEIGHT - y - height)} ${number(width)} ${number(height)} re ${paint}`);
  }

  // Una imagen agregada con add_jpeg, dentro del rectángulo con su esquina superior izquierda en (x, y)
  image(image_id, x, y, width, height) {
    this.operations.push(`q ${number(width)} 0 0 ${number(height)} ${number(x)} ${number(PAGE_HEIGHT - y - height)} cm /Im${image_id} Do Q`);
  }

  content() {
    return this.operations.join("\n");
  }
}

// Crea un documento PDF vacío. Se le agregan imágenes y páginas, y build() devuelve los bytes.
export function create_pdf({ title = "" } = {}) {
  const pages = [];
  const images = [];

  return {
    pages,

    add_page() {
      const page = new Page();
      pages.push(page);
      return page;
    },

    // Agrega un JPEG (bytes) y devuelve { id, width, height }, con el id para page.image(), o null si no se puede usar
    add_jpeg(bytes) {
      const info = parse_jpeg(bytes);
      if (!info) return null;
      images.push({ bytes, ...info });
      return { id: images.length - 1, width: info.width, height: info.height };
    },

    build() {
      const chunks = [];
      const offsets = [];
      let length = 0;
      const push_bytes = (bytes) => {
        chunks.push(bytes);
        length += bytes.length;
      };
      // Texto cuyos caracteres ya son bytes (de 0 a 255)
      const push_text = (text) => push_bytes(Uint8Array.from(text, (character) => character.charCodeAt(0)));
      const begin_object = (id) => {
        offsets[id] = length;
        push_text(`${id} 0 obj\n`);
      };

      const first_image_id = 6;
      const first_page_id = first_image_id + images.length;
      const page_id = (index) => first_page_id + index * 2;
      const total_objects = first_page_id + pages.length * 2 - 1;

      push_text("%PDF-1.4\n%");
      push_bytes(Uint8Array.from([0xe2, 0xe3, 0xcf, 0xd3]));
      push_text("\n");

      begin_object(1);
      push_text("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
      begin_object(2);
      push_text(`<< /Type /Pages /Kids [${pages.map((_, index) => `${page_id(index)} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`);
      begin_object(3);
      push_text("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n");
      begin_object(4);
      push_text("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n");
      begin_object(5);
      push_text(`<< /Title ${pdf_string(title)} /Producer (Cotizaciones y cuentas de cobro) >>\nendobj\n`);

      images.forEach((image, index) => {
        begin_object(first_image_id + index);
        push_text(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /${image.components === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`);
        push_bytes(image.bytes);
        push_text("\nendstream\nendobj\n");
      });

      const image_resources = images.length ? ` /XObject << ${images.map((_, index) => `/Im${index} ${first_image_id + index} 0 R`).join(" ")} >>` : "";
      pages.forEach((page, index) => {
        const content = Uint8Array.from(page.content(), (character) => character.charCodeAt(0));
        begin_object(page_id(index));
        push_text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${page_id(index) + 1} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${image_resources} >> >>\nendobj\n`);
        begin_object(page_id(index) + 1);
        push_text(`<< /Length ${content.length} >>\nstream\n`);
        push_bytes(content);
        push_text("\nendstream\nendobj\n");
      });

      const xref_offset = length;
      push_text(`xref\n0 ${total_objects + 1}\n0000000000 65535 f \n`);
      for (let id = 1; id <= total_objects; id += 1) push_text(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
      push_text(`trailer\n<< /Size ${total_objects + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref_offset}\n%%EOF\n`);

      const result = new Uint8Array(length);
      let position = 0;
      chunks.forEach((chunk) => {
        result.set(chunk, position);
        position += chunk.length;
      });
      return result;
    },
  };
}
