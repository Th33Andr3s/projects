// Formateadores de código: la limpieza común de espacios, la detección del lenguaje y el formateador de CSS. Son
// funciones puras: reciben texto y opciones y devuelven texto, sin tocar la pantalla, para poder probarlas con valores
// conocidos (ver PLAN.md, sección 4.6).
//
// Regla de oro: un formateador nunca cambia el contenido, solo los espacios. Por eso el CSS se recorre con un
// tokenizador que trata las cadenas y los comentarios como bloques intocables, en vez de hacerle reemplazos al texto.
//
// Cada formateador recibe (texto, { mode, indent }) y devuelve { text, warning }, donde warning es null o
// { line, message } con la línea del texto de entrada donde está el problema (contada desde 1).

const MAX_INDENT_DEPTH = 40;
const SQL_FIRST_WORDS = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "WITH", "EXPLAIN"]);

function normalize_newlines(text) {
  return text.replace(/\r\n?/g, "\n");
}

// ---------------------------------------------------------------------------
// Limpieza común (PLAN 4.1)
// ---------------------------------------------------------------------------

// Saltos de línea a \n, sin espacios ni tabulaciones al final de cada línea (la sangría del inicio no se toca), nunca
// más de una línea en blanco seguida y sin líneas en blanco al principio ni al final
function clean_text(text) {
  const lines = normalize_newlines(text)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""));
  const kept = [];
  lines.forEach((line) => {
    if (line === "" && (kept.length === 0 || kept[kept.length - 1] === "")) return;
    kept.push(line);
  });
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  return kept.join("\n");
}

// Texto cualquiera: la limpieza común y las tabulaciones del inicio de línea pasan a la sangría elegida. Si la
// sangría elegida es la tabulación, no se tocan los espacios: no hay forma de saber cuántos hacen una tabulación.
function format_text(text, { indent }) {
  const cleaned = clean_text(text);
  const text_result = indent === "\t" ? cleaned : cleaned.replace(/^\t+/gm, (tabs) => indent.repeat(tabs.length));
  return { text: text_result, warning: null };
}

// ---------------------------------------------------------------------------
// Detección del lenguaje (PLAN 4.5)
// ---------------------------------------------------------------------------

function strip_leading_comments(text) {
  let rest = text.trimStart();
  for (;;) {
    if (rest.startsWith("--")) rest = rest.replace(/^--[^\n]*/, "").trimStart();
    else if (rest.startsWith("/*") && rest.includes("*/")) rest = rest.slice(rest.indexOf("*/") + 2).trimStart();
    else return rest;
  }
}

// ¿Lo que hay antes de la primera llave parece el selector de una regla de CSS? Una arroba lo es (@media, @font-face);
// si no, no puede haber "=" fuera de corchetes ni paréntesis que no sean de una pseudoclase (:not(…)), porque eso es
// código de programación (x = {…}, function f() {…}).
function looks_like_css_head(head) {
  const trimmed = head.trim();
  if (trimmed === "") return false;
  if (trimmed.startsWith("@")) return true;
  const outside_brackets = trimmed.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"|'[^']*'/g, "");
  if (outside_brackets.includes("=")) return false;
  const parentheses = [...outside_brackets.matchAll(/\(/g)];
  return parentheses.every((match) => /:[a-zA-Z-]+$/.test(outside_brackets.slice(0, match.index)));
}

// Devuelve "html", "sql", "css" o "text"
export function detect_language(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("<") && trimmed.includes(">")) return "html";

  const first_word = /^[A-Za-z]+/.exec(strip_leading_comments(trimmed));
  if (first_word && SQL_FIRST_WORDS.has(first_word[0].toUpperCase())) return "sql";

  // La llave de cierre no se exige: un CSS al que le falta (o que se está escribiendo) debe seguir detectándose como CSS
  // para que el aviso de la llave sin cerrar pueda aparecer
  const open_index = trimmed.indexOf("{");
  if (open_index !== -1) {
    const head = strip_leading_comments(trimmed.slice(0, open_index));
    const body = trimmed.slice(open_index + 1);
    if (looks_like_css_head(head) && /:[^;{}]*(;|\}|$)/.test(body)) return "css";
  }
  return "text";
}

// ---------------------------------------------------------------------------
// CSS (PLAN 4.2)
// ---------------------------------------------------------------------------

// Una sentencia (un selector, una declaración…) se guarda como segmentos: el texto, con los espacios ya reducidos a uno,
// y las partes intocables ("raw"): cadenas, comentarios y url( sin comillas ). Así lo que va entre comillas jamás se toca.
function render(segments) {
  return segments.map((segment) => segment.value).join("").trim();
}

// Recorre el CSS y devuelve la lista de elementos (aperturas de bloque, cierres, declaraciones, sentencias de arroba y
// comentarios sueltos) y los avisos que encontró
function scan_css(source) {
  const text = normalize_newlines(source);
  const length = text.length;
  const items = [];
  const warnings = [];
  const open_lines = [];
  let current = [];
  let text_buffer = "";
  let space_pending = false;
  let line = 1;
  let position = 0;

  function flush_text() {
    if (text_buffer) current.push({ raw: false, value: text_buffer });
    text_buffer = "";
  }

  function add_space() {
    // Los espacios al principio de una sentencia se descartan
    if (current.length || text_buffer) space_pending = true;
  }

  function add_text(chunk) {
    if (space_pending) text_buffer += " ";
    space_pending = false;
    text_buffer += chunk;
  }

  function add_raw(value) {
    if (space_pending) text_buffer += " ";
    space_pending = false;
    flush_text();
    current.push({ raw: true, value });
  }

  function take_statement() {
    flush_text();
    space_pending = false;
    const segments = current;
    current = [];
    return segments;
  }

  function count_lines(chunk) {
    for (let index = chunk.indexOf("\n"); index !== -1; index = chunk.indexOf("\n", index + 1)) line += 1;
  }

  function finish_statement() {
    const segments = take_statement();
    if (segments.length === 0) return;
    items.push({ kind: open_lines.length === 0 ? "statement" : "declaration", segments });
  }

  while (position < length) {
    const character = text[position];

    if (character === "\n") {
      line += 1;
      add_space();
      position += 1;
    } else if (character === " " || character === "\t") {
      add_space();
      position += 1;
    } else if (character === "/" && text[position + 1] === "*") {
      const end = text.indexOf("*/", position + 2);
      const comment = end === -1 ? text.slice(position) : text.slice(position, end + 2);
      if (end === -1) warnings.push({ line, message: `hay un comentario sin cerrar desde la línea ${line}` });
      if (current.length === 0 && text_buffer === "") items.push({ kind: "comment", value: comment });
      else add_raw(comment);
      count_lines(comment);
      position += comment.length;
    } else if (character === '"' || character === "'") {
      let end = position + 1;
      let is_closed = false;
      while (end < length) {
        if (text[end] === "\\") end += 2;
        else if (text[end] === character) {
          is_closed = true;
          end += 1;
          break;
        } else if (text[end] === "\n") break;
        else end += 1;
      }
      end = Math.min(end, length);
      const string = text.slice(position, end);
      if (!is_closed) warnings.push({ line, message: `hay una cadena sin cerrar en la línea ${line}` });
      add_raw(string);
      count_lines(string);
      position = end;
    } else if (character === "\\") {
      const escaped = text.slice(position, position + 2);
      add_text(escaped);
      count_lines(escaped);
      position += escaped.length;
    } else if (character === "{") {
      items.push({ kind: "open", segments: take_statement(), line });
      open_lines.push(line);
      position += 1;
    } else if (character === "}") {
      finish_statement();
      if (open_lines.length === 0) warnings.push({ line, message: `sobra una llave de cierre en la línea ${line}` });
      else {
        open_lines.pop();
        items.push({ kind: "close" });
      }
      position += 1;
    } else if (character === ";") {
      finish_statement();
      position += 1;
    } else if ((character === "u" || character === "U") && /^url\(/i.test(text.slice(position, position + 4)) && !/[\w-]$/.test(text_buffer)) {
      // url( sin comillas: su contenido puede llevar ; y : (los datos incrustados), así que se copia entero hasta el )
      let inner = position + 4;
      while (inner < length && /\s/.test(text[inner])) inner += 1;
      if (text[inner] === '"' || text[inner] === "'") {
        add_text(text.slice(position, position + 4));
        position += 4;
      } else {
        const close = text.indexOf(")", inner);
        const end = close === -1 ? length : close + 1;
        const raw = text.slice(position, end);
        add_raw(raw);
        count_lines(raw);
        position = end;
      }
    } else {
      add_text(character);
      position += 1;
    }
  }

  finish_statement();
  if (open_lines.length) {
    // La llave que falta es casi siempre la de la primera regla que se quedó abierta: lo demás quedó dentro de ella
    warnings.push({ line: open_lines[0], message: `hay una llave sin cerrar desde la línea ${open_lines[0]}` });
    open_lines.forEach(() => items.push({ kind: "close" }));
  }
  return { items, warnings };
}

// Parte una sentencia en las comas que no están dentro de paréntesis ni corchetes (rgb(0, 0, 0) y [a="x,y"] no se parten)
function split_top_level_commas(segments) {
  const parts = [[]];
  let depth = 0;
  segments.forEach((segment) => {
    if (segment.raw) {
      parts[parts.length - 1].push(segment);
      return;
    }
    let start = 0;
    for (let index = 0; index < segment.value.length; index += 1) {
      const character = segment.value[index];
      if (character === "(" || character === "[") depth += 1;
      else if (character === ")" || character === "]") depth = Math.max(0, depth - 1);
      else if (character === "," && depth === 0) {
        parts[parts.length - 1].push({ raw: false, value: segment.value.slice(start, index) });
        parts.push([]);
        start = index + 1;
      }
    }
    parts[parts.length - 1].push({ raw: false, value: segment.value.slice(start) });
  });
  return parts;
}

// Parte una declaración en propiedad y valor por los primeros dos puntos que no están dentro de paréntesis.
// Devuelve null si no los tiene.
function split_declaration(segments) {
  let depth = 0;
  for (let segment_index = 0; segment_index < segments.length; segment_index += 1) {
    const segment = segments[segment_index];
    if (segment.raw) continue;
    for (let index = 0; index < segment.value.length; index += 1) {
      const character = segment.value[index];
      if (character === "(") depth += 1;
      else if (character === ")") depth = Math.max(0, depth - 1);
      else if (character === ":" && depth === 0) {
        const property = [...segments.slice(0, segment_index), { raw: false, value: segment.value.slice(0, index) }];
        const value = [{ raw: false, value: segment.value.slice(index + 1) }, ...segments.slice(segment_index + 1)];
        return { property, value };
      }
    }
  }
  return null;
}

function format_declaration(segments) {
  const parts = split_declaration(segments);
  if (!parts) return render(segments);
  const value = render(parts.value);
  return value ? `${render(parts.property)}: ${value}` : `${render(parts.property)}:`;
}

function is_at_rule(segments) {
  return render(segments).startsWith("@");
}

function write_formatted_css(items, indent) {
  const lines = [];
  let depth = 0;
  // Qué se escribió justo antes: decide dónde va una línea en blanco (entre reglas, no entre declaraciones)
  let last = "start";
  // A partir de MAX_INDENT_DEPTH niveles la sangría deja de crecer: ningún CSS real anida tanto, y sin este tope un texto
  // con miles de llaves seguidas llenaría la memoria de espacios
  const pad = () => indent.repeat(Math.min(depth, MAX_INDENT_DEPTH));

  items.forEach((item) => {
    if (item.kind === "open") {
      if (last === "close" || last === "statement" || last === "declaration") lines.push("");
      // Los selectores separados por coma van uno por línea; el encabezado de una arroba (@media…) va en una sola
      const parts = is_at_rule(item.segments) ? [item.segments] : split_top_level_commas(item.segments);
      const rendered = parts.map(render);
      rendered.forEach((part, index) => {
        const is_last = index === rendered.length - 1;
        lines.push(`${pad()}${part}${is_last ? (part ? " {" : "{") : ","}`);
      });
      depth += 1;
      last = "open";
    } else if (item.kind === "close") {
      depth = Math.max(0, depth - 1);
      lines.push(`${pad()}}`);
      last = "close";
    } else if (item.kind === "declaration") {
      lines.push(`${pad()}${format_declaration(item.segments)};`);
      last = "declaration";
    } else if (item.kind === "statement") {
      if (last === "close") lines.push("");
      lines.push(`${pad()}${render(item.segments)};`);
      last = "statement";
    } else {
      if (last === "close" || last === "statement") lines.push("");
      const [first, ...rest] = item.value.split("\n");
      lines.push(`${pad()}${first}`, ...rest);
      last = "comment";
    }
  });
  return clean_text(lines.join("\n"));
}

// Quita los espacios de alrededor de las comas y dentro de los paréntesis, solo en el texto y no en lo intocable
function tighten(segments) {
  return segments.map((segment) => (segment.raw ? segment : { raw: false, value: segment.value.replace(/\s*,\s*/g, ",").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")") }));
}

function write_minified_css(items) {
  // Se arma en una lista y no en un solo texto: quitar el último ; de un texto enorme lo copiaría entero en cada bloque
  const pieces = [];
  items.forEach((item) => {
    if (item.kind === "open") {
      pieces.push(`${split_top_level_commas(tighten(item.segments)).map(render).join(",")}{`);
    } else if (item.kind === "close") {
      // El último ; de un bloque sobra
      const last = pieces.length - 1;
      if (last >= 0 && pieces[last].endsWith(";")) pieces[last] = pieces[last].slice(0, -1);
      pieces.push("}");
    } else if (item.kind === "declaration") {
      const parts = split_declaration(tighten(item.segments));
      pieces.push(`${parts ? `${render(parts.property)}:${render(parts.value)}` : render(item.segments)};`);
    } else if (item.kind === "statement") {
      pieces.push(`${render(tighten(item.segments))};`);
    } else if (item.value.startsWith("/*!")) {
      // Los comentarios que empiezan por /*! son avisos de licencia y se conservan
      pieces.push(item.value);
    }
  });
  return pieces.join("").trim();
}

function format_css(text, { mode, indent }) {
  const { items, warnings } = scan_css(text);
  // Si hay varios avisos se muestra el de la línea más temprana: es donde empezó el problema
  const warning = warnings.length ? warnings.reduce((first, other) => (other.line < first.line ? other : first)) : null;
  return { text: mode === "minify" ? write_minified_css(items) : write_formatted_css(items, indent), warning };
}

// ---------------------------------------------------------------------------
// HTML (PLAN 4.3)
// ---------------------------------------------------------------------------

// Etiquetas que ocupan su propia línea
const HTML_BLOCK = new Set([
  "html", "head", "body", "div", "section", "article", "header", "footer", "main", "nav", "aside", "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "form", "fieldset", "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "figure", "figcaption", "details", "summary", "dialog", "template", "select", "option", "label", "button", "canvas", "svg", "address", "hr",
  "pre", "textarea", "noscript", "meta", "link", "title", "script", "style", "base",
]);
// Etiquetas que se quedan en la línea con su texto
const HTML_INLINE = new Set(["a", "span", "strong", "em", "b", "i", "u", "small", "code", "kbd", "abbr", "img", "br", "wbr", "sup", "sub", "mark", "time", "q", "cite", "s", "input"]);
// Etiquetas vacías: no tienen contenido ni etiqueta de cierre
const HTML_VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
// Etiquetas cuyo contenido se copia tal cual hasta su cierre, sin tocar una sola letra
const HTML_RAW = new Set(["pre", "textarea", "script", "style"]);
// Etiquetas a las que el HTML permite no ponerles el cierre: no se avisa si faltan
const HTML_OPTIONAL_END = new Set(["p", "li", "dt", "dd", "tr", "td", "th", "thead", "tbody", "tfoot", "option", "optgroup", "colgroup", "caption", "head", "body", "html"]);
// Lo que cierra el navegador por su cuenta al abrir una etiqueta: la clave es la que se abre, el valor, las que cierra
const HTML_AUTO_CLOSE = { li: ["li"], dt: ["dt", "dd"], dd: ["dt", "dd"], tr: ["tr", "td", "th"], td: ["td", "th"], th: ["td", "th"], option: ["option"] };
// Las etiquetas que cierran un <p> abierto al abrirse
const HTML_CLOSES_PARAGRAPH = new Set(["address", "article", "aside", "blockquote", "div", "dl", "fieldset", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul"]);

// Recorre el HTML y arma el árbol: elementos con sus hijos, texto, comentarios, declaraciones y los avisos
function parse_html(source) {
  const text = normalize_newlines(source);
  const length = text.length;
  const root = { children: [] };
  const stack = [root];
  const warnings = [];
  let position = 0;
  let line = 1;

  const top = () => stack[stack.length - 1];

  function count_lines(chunk) {
    for (let index = chunk.indexOf("\n"); index !== -1; index = chunk.indexOf("\n", index + 1)) line += 1;
  }

  // ¿La etiqueta es lo primero que hay en su línea? Decide si una etiqueta desconocida es de bloque
  function starts_line(offset) {
    return text.slice(text.lastIndexOf("\n", offset - 1) + 1, offset).trim() === "";
  }

  function push_text(value) {
    if (value) top().children.push({ type: "text", value });
  }

  function find_tag_end(from) {
    let index = from;
    let quote = "";
    while (index < length) {
      const character = text[index];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") quote = character;
      else if (character === ">") return index;
      index += 1;
    }
    return -1;
  }

  function close_matching(name, raw) {
    let match = -1;
    for (let index = stack.length - 1; index > 0; index -= 1) {
      if (stack[index].name === name) {
        match = index;
        break;
      }
    }
    if (match === -1) {
      warnings.push({ line, message: `sobra una etiqueta de cierre \`</${name}>\` en la línea ${line}` });
      top().children.push({ type: "stray", value: raw });
      return;
    }
    // Un cierre que no coincide con la última abierta cierra las intermedias, como hace el navegador
    stack[match].close_raw = raw;
    stack.length = match;
  }

  function open_element(name, raw, tag_start) {
    const opening_line = line;
    if (name === "p" || HTML_CLOSES_PARAGRAPH.has(name)) {
      if (top().name === "p") stack.pop();
    }
    const closed_by = HTML_AUTO_CLOSE[name];
    while (closed_by && closed_by.includes(top().name)) stack.pop();

    const element = { type: "element", name, open_raw: raw, close_raw: null, children: [], is_void: HTML_VOID.has(name) || /\/\s*>$/.test(raw), starts_line: starts_line(tag_start), line: opening_line };
    top().children.push(element);
    if (!element.is_void) stack.push(element);
    return element;
  }

  while (position < length) {
    const tag_start = text.indexOf("<", position);
    if (tag_start === -1) {
      push_text(text.slice(position));
      break;
    }
    const before = text.slice(position, tag_start);
    push_text(before);
    count_lines(before);
    const rest = text.slice(tag_start, tag_start + 4);

    if (rest === "<!--") {
      const end = text.indexOf("-->", tag_start + 4);
      const comment = end === -1 ? text.slice(tag_start) : text.slice(tag_start, end + 3);
      if (end === -1) warnings.push({ line, message: `hay un comentario sin cerrar desde la línea ${line}` });
      top().children.push({ type: "comment", value: comment });
      count_lines(comment);
      position = tag_start + comment.length;
    } else if (rest.startsWith("<!") || rest.startsWith("<?")) {
      const end = text.indexOf(">", tag_start);
      const declaration = end === -1 ? text.slice(tag_start) : text.slice(tag_start, end + 1);
      top().children.push({ type: "doctype", value: declaration });
      count_lines(declaration);
      position = tag_start + declaration.length;
    } else if (/^<\/[A-Za-z]/.test(rest)) {
      const end = text.indexOf(">", tag_start);
      if (end === -1) {
        warnings.push({ line, message: `hay una etiqueta sin cerrar en la línea ${line}` });
        push_text(text.slice(tag_start));
        position = length;
      } else {
        const raw = text.slice(tag_start, end + 1);
        close_matching(/^<\/([A-Za-z][^\s>/]*)/.exec(raw)[1].toLowerCase(), raw);
        count_lines(raw);
        position = end + 1;
      }
    } else if (/^<[A-Za-z]/.test(rest)) {
      const end = find_tag_end(tag_start + 1);
      if (end === -1) {
        warnings.push({ line, message: `hay una etiqueta sin cerrar en la línea ${line}` });
        push_text(text.slice(tag_start));
        position = length;
      } else {
        const raw = text.slice(tag_start, end + 1);
        const name = /^<([A-Za-z][^\s>/]*)/.exec(raw)[1].toLowerCase();
        const element = open_element(name, raw, tag_start);
        position = end + 1;
        if (HTML_RAW.has(name) && !element.is_void) {
          // Todo hasta el cierre se copia sin tocar: el elemento entero pasa a ser un bloque de texto intocable
          stack.pop();
          top().children.pop();
          const close = new RegExp(`</${name}[\\s>]`, "gi");
          close.lastIndex = position;
          const found = close.exec(text);
          let raw_end = length;
          if (found) {
            const close_end = text.indexOf(">", found.index);
            raw_end = close_end === -1 ? length : close_end + 1;
          } else warnings.push({ line, message: `falta cerrar \`<${name}>\` abierto en la línea ${element.line}` });
          const whole = text.slice(tag_start, raw_end);
          top().children.push({ type: "raw_element", name, value: whole, starts_line: element.starts_line });
          count_lines(whole);
          position = raw_end;
        } else count_lines(raw);
      }
    } else {
      // Un < suelto (a < b) es texto
      push_text("<");
      position = tag_start + 1;
    }
  }

  // Lo que quedó abierto: se avisa de la primera etiqueta (la de más afuera) a la que el HTML no permite faltarle el cierre
  const unclosed = stack.slice(1).find((element) => !HTML_OPTIONAL_END.has(element.name));
  if (unclosed) warnings.push({ line: unclosed.line, message: `falta cerrar \`<${unclosed.name}>\` abierto en la línea ${unclosed.line}` });
  return { nodes: root.children, warnings };
}

function is_whitespace_text(node) {
  return node.type === "text" && node.value.trim() === "";
}

// ¿Esta etiqueta va en su propia línea? Las conocidas, según su lista; las desconocidas (componentes, SVG interno) van
// en su línea si ya estaban solas en la suya en el original, y junto a su texto si no
function is_block_element(node) {
  if (HTML_BLOCK.has(node.name)) return true;
  if (HTML_INLINE.has(node.name)) return false;
  return node.starts_line;
}

const block_level_cache = new WeakMap();

// ¿El nodo rompe el hilo de una línea? Los comentarios, las declaraciones y los textos intocables sí; un elemento, si es
// de bloque o si lleva algo de bloque adentro
function is_block_level(node) {
  if (node.type === "text") return false;
  if (node.type !== "element") return true;
  if (!block_level_cache.has(node)) {
    block_level_cache.set(node, is_block_element(node) || node.children.some(is_block_level));
  }
  return block_level_cache.get(node);
}

// Las líneas de una tanda de nodos de línea (texto y etiquetas de línea). El texto conserva sus saltos de línea
// (cada línea recortada de los espacios de los bordes); lo demás se queda donde estaba.
function html_run_lines(nodes) {
  const lines = [];
  let current = "";

  function end_line() {
    lines.push(current.replace(/[ \t]+$/, ""));
    current = "";
  }

  function add(node) {
    if (node.type === "text") {
      node.value.split("\n").forEach((part, index) => {
        if (index > 0) {
          end_line();
          current = part.replace(/^[ \t]+/, "");
        } else current += current === "" ? part.replace(/^[ \t]+/, "") : part;
      });
    } else {
      current += node.open_raw;
      if (!node.is_void) {
        node.children.forEach(add);
        current += node.close_raw ?? "";
      }
    }
  }

  nodes.forEach(add);
  end_line();
  const kept = [];
  lines.forEach((line) => {
    if (line === "" && (kept.length === 0 || kept[kept.length - 1] === "")) return;
    kept.push(line);
  });
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  return kept;
}

function write_formatted_html(nodes, indent) {
  const out = [];
  let pending_blank = false;
  const pad = (depth) => indent.repeat(Math.min(depth, MAX_INDENT_DEPTH));

  function push(depth, text) {
    if (pending_blank && out.length && out[out.length - 1] !== "") out.push("");
    pending_blank = false;
    out.push(text === "" ? "" : pad(depth) + text);
  }

  // Un texto intocable (comentario, pre, script…): solo se sangra su primera línea
  function push_verbatim(depth, value) {
    const [first, ...rest] = value.split("\n");
    push(depth, first);
    out.push(...rest);
  }

  function render_element(element, depth) {
    const close = element.close_raw ?? "";
    if (element.is_void) {
      push(depth, element.open_raw);
      return;
    }
    const children = element.children;
    if (children.every(is_whitespace_text)) {
      push(depth, element.open_raw + close);
    } else if (!children.some(is_block_level)) {
      const lines = html_run_lines(children);
      if (lines.length === 1) {
        push(depth, element.open_raw + lines[0] + close);
      } else {
        push(depth, element.open_raw);
        lines.forEach((line) => push(depth + 1, line));
        if (close) push(depth, close);
      }
    } else {
      push(depth, element.open_raw);
      render_nodes(children, depth + 1);
      if (close) push(depth, close);
    }
  }

  function render_nodes(list, depth) {
    let run = [];

    function flush_run() {
      if (run.length === 0) return;
      if (run.every(is_whitespace_text)) {
        // Una línea en blanco entre bloques se conserva, una sola
        if (run.map((node) => node.value).join("").split("\n").length > 2) pending_blank = true;
      } else {
        html_run_lines(run).forEach((line) => push(depth, line));
      }
      run = [];
    }

    list.forEach((node) => {
      if (!is_block_level(node)) {
        run.push(node);
        return;
      }
      flush_run();
      if (node.type === "element") render_element(node, depth);
      else if (node.type === "stray") push(depth, node.value);
      else push_verbatim(depth, node.value);
    });
    flush_run();
  }

  render_nodes(nodes, 0);
  while (out.length && out[0] === "") out.shift();
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

// Los comentarios condicionales (<!--[if IE]>) tienen efecto, así que no se quitan al minificar
function is_kept_comment(value) {
  return value.startsWith("<!--[if") || value.startsWith("<!--<!");
}

function write_minified_html(nodes) {
  // Entre etiquetas de bloque los espacios y los saltos de línea no se ven y se quitan; entre las de línea, donde sí
  // separan palabras, se reducen a un espacio
  function render_list(list, container_is_block) {
    return list
      .map((node, index) => {
        if (node.type === "text") {
          let value = node.value.replace(/\s+/g, " ");
          const previous = list[index - 1];
          const next = list[index + 1];
          if ((index === 0 && container_is_block) || (previous && is_block_level(previous))) value = value.replace(/^ /, "");
          if ((index === list.length - 1 && container_is_block) || (next && is_block_level(next))) value = value.replace(/ $/, "");
          return value;
        }
        if (node.type === "comment") return is_kept_comment(node.value) ? node.value : "";
        if (node.type === "element") {
          if (node.is_void) return node.open_raw;
          return node.open_raw + render_list(node.children, is_block_level(node)) + (node.close_raw ?? "");
        }
        return node.value;
      })
      .join("");
  }
  return render_list(nodes, true).trim();
}

function format_html(text, { mode, indent }) {
  const { nodes, warnings } = parse_html(text);
  const warning = warnings.length ? warnings.reduce((first, other) => (other.line < first.line ? other : first)) : null;
  return { text: mode === "minify" ? write_minified_html(nodes) : write_formatted_html(nodes, indent), warning };
}

// ---------------------------------------------------------------------------
// SQL (PLAN 4.4)
// ---------------------------------------------------------------------------

// Palabras clave que pasan a mayúscula si la casilla está marcada. Los nombres de tablas y columnas nunca se tocan.
const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "GROUP", "BY", "HAVING", "ORDER", "LIMIT", "OFFSET", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE",
  "ALTER", "DROP", "WITH", "UNION", "ALL", "AS", "ON", "IN", "NOT", "NULL", "IS", "LIKE", "BETWEEN", "EXISTS", "DISTINCT", "CASE", "WHEN", "THEN", "ELSE",
  "END", "ASC", "DESC", "INDEX", "VIEW", "PRIMARY", "KEY", "DEFAULT", "TRUE", "FALSE", "AND", "OR", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "FULL",
  "CROSS", "NATURAL", "USING", "INTERSECT", "EXCEPT", "UNIQUE", "FOREIGN", "REFERENCES", "IF", "CONSTRAINT", "ADD", "COLUMN", "RETURNING", "FOR",
]);
// Estas también son nombres de funciones: solo son palabra clave si van seguidas de un paréntesis, para no tocar una columna que se llame `count`
const SQL_FUNCTIONS = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX"]);
// Después de estas palabras un paréntesis lleva espacio (`IN (1, 2)`); después de un nombre no (`COUNT(*)`)
const SQL_SPACE_BEFORE_PAREN = new Set([
  "IN", "NOT", "AND", "OR", "ON", "AS", "VALUES", "WHERE", "HAVING", "WHEN", "THEN", "ELSE", "EXISTS", "SELECT", "FROM", "JOIN", "UNION", "ALL", "ANY", "SOME", "BY",
  "USING", "SET", "KEY", "INTO", "TABLE", "DISTINCT", "CASE", "BETWEEN", "LIKE", "IS", "UPDATE", "WITH",
]);
// Si una de estas palabras va antes de un + o un -, ese signo es de un número (`WHERE x = -1`) y no una resta
const SQL_BEFORE_UNARY = new Set(["SELECT", "WHERE", "AND", "OR", "WHEN", "THEN", "ELSE", "ON", "BY", "IN", "NOT", "SET", "BETWEEN", "LIKE", "IS", "VALUES", "LIMIT", "OFFSET", "HAVING", "DISTINCT", "RETURN"]);
const SQL_OPERATORS = ["->>", "<>", "<=", ">=", "!=", "||", "::", "==", "->", "<<", ">>", "&&"];
// Palabras con las que empieza una línea nueva (la sentencia se parte por ellas), de la más larga a la más corta
const SQL_CLAUSE_PHRASES = [
  ["GROUP", "BY"], ["ORDER", "BY"], ["INSERT", "INTO"], ["DELETE", "FROM"], ["CREATE", "TABLE"], ["ALTER", "TABLE"], ["DROP", "TABLE"], ["UNION", "ALL"],
  ["SELECT"], ["FROM"], ["WHERE"], ["HAVING"], ["LIMIT"], ["OFFSET"], ["VALUES"], ["UPDATE"], ["SET"], ["WITH"], ["UNION"], ["INTERSECT"], ["EXCEPT"], ["RETURNING"], ["ON"],
];
const SQL_JOIN_MODIFIERS = new Set(["NATURAL", "LEFT", "RIGHT", "FULL", "INNER", "OUTER", "CROSS"]);
const SQL_WORD = /[\p{L}\p{N}_$@#?]+/uy;
const SQL_NUMBER = /\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[\p{L}\p{N}_$]*/uy;
const SQL_PARAMETER = /:[\p{L}\p{N}_]+/uy;

// Parte el SQL en piezas: palabras, cadenas, identificadores entre comillas, comentarios, signos y paréntesis
function tokenize_sql(text) {
  const tokens = [];
  const warnings = [];
  const length = text.length;
  let position = 0;
  let line = 1;
  let space_before = false;
  let newline_before = false;

  function push(type, value, start_line) {
    tokens.push({ type, value, line: start_line, space_before, newline_before });
    space_before = false;
    newline_before = false;
  }

  function count_newlines(value) {
    for (let index = value.indexOf("\n"); index !== -1; index = value.indexOf("\n", index + 1)) line += 1;
  }

  // Cadena o identificador entre comillas; la comilla doble repetida es una comilla dentro del texto
  function scan_quoted(quote) {
    let index = position + 1;
    while (index < length) {
      if (text[index] === quote) {
        if (text[index + 1] === quote) index += 2;
        else return index + 1;
      } else index += 1;
    }
    return -1;
  }

  function match(regex, from) {
    regex.lastIndex = from;
    const found = regex.exec(text);
    return found ? found[0] : null;
  }

  while (position < length) {
    const character = text[position];
    if (character === "\n") {
      line += 1;
      newline_before = true;
      space_before = true;
      position += 1;
      continue;
    }
    if (/\s/.test(character)) {
      space_before = true;
      position += 1;
      continue;
    }
    const start_line = line;
    const next = text[position + 1];

    if (character === "-" && next === "-") {
      let end = text.indexOf("\n", position);
      if (end === -1) end = length;
      push("line_comment", text.slice(position, end).replace(/[ \t]+$/, ""), start_line);
      position = end;
    } else if (character === "/" && next === "*") {
      const end = text.indexOf("*/", position + 2);
      const value = end === -1 ? text.slice(position) : text.slice(position, end + 2);
      if (end === -1) warnings.push({ line, message: `hay un comentario sin cerrar desde la línea ${line}` });
      push("block_comment", value, start_line);
      count_newlines(value);
      position += value.length;
    } else if (character === "'" || character === '"' || character === "`") {
      const end = scan_quoted(character);
      const value = end === -1 ? text.slice(position) : text.slice(position, end);
      if (end === -1) warnings.push({ line, message: `hay una cadena sin cerrar desde la línea ${line}` });
      push(character === "'" ? "string" : "ident", value, start_line);
      count_newlines(value);
      position += value.length;
    } else if (character === "(") {
      push("open", "(", start_line);
      position += 1;
    } else if (character === ")") {
      push("close", ")", start_line);
      position += 1;
    } else if (character === ",") {
      push("comma", ",", start_line);
      position += 1;
    } else if (character === ";") {
      push("semi", ";", start_line);
      position += 1;
    } else if (/\d/.test(character)) {
      const value = match(SQL_NUMBER, position);
      push("word", value, start_line);
      position += value.length;
    } else if (character === ":" && next !== ":" && text[position - 1] !== ":" && match(SQL_PARAMETER, position)) {
      const value = match(SQL_PARAMETER, position);
      push("word", value, start_line);
      position += value.length;
    } else if (match(SQL_WORD, position)) {
      const value = match(SQL_WORD, position);
      push("word", value, start_line);
      position += value.length;
    } else if (character === ".") {
      push("dot", ".", start_line);
      position += 1;
    } else {
      const operator = SQL_OPERATORS.find((candidate) => text.startsWith(candidate, position)) ?? character;
      push("op", operator, start_line);
      position += operator.length;
    }
  }
  return { tokens, warnings };
}

// Arma el árbol: cada paréntesis es un grupo con sus hijos adentro
function parse_sql(source) {
  const { tokens, warnings } = tokenize_sql(normalize_newlines(source));
  const root = { children: [] };
  const stack = [root];
  tokens.forEach((token) => {
    const top = stack[stack.length - 1];
    if (token.type === "open") {
      const group = { type: "group", children: [], closed: false, line: token.line, space_before: token.space_before };
      top.children.push(group);
      stack.push(group);
    } else if (token.type === "close") {
      if (stack.length > 1) {
        top.closed = true;
        stack.pop();
      } else {
        warnings.push({ line: token.line, message: `sobra un paréntesis de cierre en la línea ${token.line}` });
        top.children.push({ ...token, type: "stray" });
      }
    } else top.children.push(token);
  });
  stack.slice(1).forEach((group) => warnings.push({ line: group.line, message: `hay un paréntesis sin cerrar desde la línea ${group.line}` }));
  return { nodes: root.children, warnings };
}

function is_sql_comment(node) {
  return node.type === "line_comment" || node.type === "block_comment";
}

function is_sql_subquery(node) {
  if (node.type !== "group") return false;
  const first = node.children.find((child) => !is_sql_comment(child));
  return Boolean(first) && first.type === "word" && ["SELECT", "WITH"].includes(first.value.toUpperCase());
}

// La palabra tal como sale: en mayúscula si es palabra clave y la casilla está marcada. Un nombre con punto (`t.key`) no se toca.
function sql_word_text(node, before, after, context) {
  if (!context.uppercase) return node.value;
  const upper = node.value.toUpperCase();
  const is_function = SQL_FUNCTIONS.has(upper);
  if (!is_function && !SQL_KEYWORDS.has(upper)) return node.value;
  if ((before && before.type === "dot") || (after && after.type === "dot")) return node.value;
  if (is_function) return after && after.type === "group" ? upper : node.value;
  return upper;
}

function sql_needs_space(previous, kind, value, space_before) {
  if (!previous) return false;
  if (kind === "comma" || kind === "close") return false;
  if (previous.kind === "open" || previous.kind === "dot" || previous.unary) return false;
  if (previous.kind === "op" && previous.value === "::") return false;
  if (kind === "dot") return !["word", "ident", "close"].includes(previous.kind);
  if (kind === "op" && value === "::") return false;
  if (kind === "open") {
    if (previous.kind === "word") return SQL_SPACE_BEFORE_PAREN.has(previous.value) || space_before;
    if (previous.kind === "ident" || previous.kind === "string") return space_before;
    return true;
  }
  return true;
}

function sql_new_line(ind) {
  return { ind, text: "", comment_end: false };
}

// Pega texto al final de las líneas; si la última termina en un comentario de línea, va en una línea nueva para no quedar comentado
function sql_append(lines, text) {
  const last = lines[lines.length - 1];
  if (last.comment_end) lines.push({ ind: last.ind, text, comment_end: false });
  else {
    last.text += text;
    last.comment_end = false;
  }
}

function sql_shift(lines, amount) {
  return lines.map((line) => ({ ...line, ind: line.ind + amount }));
}

// El texto va delante de la primera línea ("FROM " + "t")
function sql_prefix(lines, prefix) {
  const first = lines[0];
  return [{ ...first, text: first.text === "" ? prefix.trimEnd() : prefix + first.text }, ...lines.slice(1)];
}

// Lo que va entre dos comas, o después de una palabra clave, escrito en una línea; solo se parte en más líneas si hay un
// CASE, una subconsulta o un comentario de línea. Devuelve líneas { ind, text }, con la sangría relativa a la primera.
function sql_render_expression(nodes, context) {
  const lines = [sql_new_line(0)];
  const case_indents = [];
  let previous = null;
  let break_pending = false;
  const last_line = () => lines[lines.length - 1];

  function new_line(ind) {
    lines.push(sql_new_line(ind));
    previous = null;
    break_pending = false;
  }

  function write(text, kind, value, space_before) {
    if (break_pending) new_line(last_line().ind);
    const line = last_line();
    if (line.text !== "" && sql_needs_space(previous, kind, value, space_before)) line.text += " ";
    line.text += text;
    line.comment_end = false;
    previous = { kind, value, unary: false };
  }

  nodes.forEach((node, index) => {
    const before = nodes[index - 1];
    const after = nodes[index + 1];
    switch (node.type) {
      case "word": {
        const upper = node.value.toUpperCase();
        if (!context.flat && case_indents.length > 0) {
          if (upper === "WHEN" || upper === "ELSE") new_line(case_indents[case_indents.length - 1] + 1);
          else if (upper === "END") new_line(case_indents.pop());
        }
        write(sql_word_text(node, before, after, context), "word", upper, node.space_before);
        if (!context.flat && upper === "CASE") case_indents.push(last_line().ind);
        break;
      }
      case "string":
        write(node.value, "string", "", node.space_before);
        break;
      case "ident":
        write(node.value, "ident", "", node.space_before);
        break;
      case "dot":
        write(".", "dot", ".", false);
        break;
      case "comma":
      case "semi":
        write(node.value, "comma", node.value, false);
        break;
      case "stray":
        write(")", "close", ")", false);
        break;
      case "op": {
        const is_sign = node.value === "-" || node.value === "+";
        const is_unary = is_sign && (!previous || ["op", "comma", "open"].includes(previous.kind) || (previous.kind === "word" && SQL_BEFORE_UNARY.has(previous.value)));
        write(node.value, "op", node.value, node.space_before);
        previous.unary = is_unary;
        break;
      }
      case "line_comment":
      case "block_comment": {
        if (context.flat) break;
        if (!break_pending && last_line().text !== "" && node.newline_before) new_line(last_line().ind);
        write(node.value, "comment", "", true);
        if (node.type === "line_comment") {
          last_line().comment_end = true;
          break_pending = true;
        }
        break;
      }
      case "group": {
        write("(", "open", "(", node.space_before);
        const base = last_line().ind;
        if (is_sql_subquery(node) && !context.flat) {
          lines.push(...sql_shift(sql_render_statements(node.children, context), base + 1));
          if (node.closed) {
            new_line(base);
            write(")", "close", ")", false);
          } else previous = { kind: "close", value: ")", unary: false };
        } else {
          const inner = sql_render_expression(node.children, context);
          last_line().text += inner[0].text;
          last_line().comment_end = inner[0].comment_end;
          lines.push(...sql_shift(inner.slice(1), base));
          if (node.closed) {
            if (last_line().comment_end) new_line(last_line().ind);
            last_line().text += ")";
          }
          previous = { kind: "close", value: ")", unary: false };
        }
        break;
      }
      default:
        break;
    }
  });
  return lines;
}

// Parte una lista en sus elementos por las comas de primer nivel. Un comentario que sigue a la coma en la misma línea
// pertenece al elemento de antes.
function sql_split_items(nodes) {
  const items = [{ nodes: [], trailing: [] }];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.type === "comma") {
      items.push({ nodes: [], trailing: [] });
      while (nodes[index + 1] && is_sql_comment(nodes[index + 1]) && !nodes[index + 1].newline_before) {
        items[items.length - 2].trailing.push(nodes[index + 1]);
        index += 1;
      }
    } else items[items.length - 1].nodes.push(node);
  }
  return items;
}

// Las líneas de un elemento con su coma y sus comentarios de al lado
function sql_render_item(item, is_last, context) {
  const lines = sql_render_expression(item.nodes, context);
  if (!is_last) sql_append(lines, ",");
  item.trailing.forEach((comment) => {
    const last = lines[lines.length - 1];
    last.text += ` ${comment.value}`;
    last.comment_end = comment.type === "line_comment";
  });
  return lines;
}

function sql_is_empty_item(item) {
  return item.nodes.length === 0 && item.trailing.length === 0;
}

// SELECT, SET y VALUES: un elemento va en la misma línea; varios, cada uno en la suya con sangría
function sql_render_item_clause(keyword, body, context) {
  const items = sql_split_items(body);
  if (items.length === 1) return sql_prefix(sql_render_expression(items[0].nodes, context), `${keyword} `);
  const lines = [{ ind: 0, text: keyword, comment_end: false }];
  items.forEach((item, index) => {
    if (sql_is_empty_item(item) && index === items.length - 1) return;
    lines.push(...sql_shift(sql_render_item(item, index === items.length - 1, context), 1));
  });
  return lines;
}

// WHERE, HAVING y ON: la primera condición va en la línea de la palabra clave; cada AND y OR, en una línea nueva con sangría
function sql_render_condition_clause(keyword, body, context) {
  const parts = [{ operator: null, nodes: [] }];
  let in_between = false;
  body.forEach((node) => {
    const word = node.type === "word" ? node.value.toUpperCase() : "";
    if (word === "BETWEEN") in_between = true;
    if (word === "AND" && in_between) {
      // El AND de `BETWEEN a AND b` es parte de la condición
      in_between = false;
      parts[parts.length - 1].nodes.push(node);
    } else if (word === "AND" || word === "OR") parts.push({ operator: context.uppercase ? word : node.value, nodes: [] });
    else parts[parts.length - 1].nodes.push(node);
  });
  const lines = [];
  parts.forEach((part, index) => {
    const part_lines = sql_render_expression(part.nodes, context);
    if (index === 0) lines.push(...sql_prefix(part_lines, `${keyword} `));
    else lines.push(...sql_shift(sql_prefix(part_lines, `${part.operator} `), 1));
  });
  return lines;
}

// WITH: cada tabla temporal (`nombre AS (…)`) empieza línea
function sql_render_with_clause(keyword, body, context) {
  const items = sql_split_items(body);
  const lines = [];
  items.forEach((item, index) => {
    if (sql_is_empty_item(item) && index === items.length - 1) return;
    const item_lines = sql_render_item(item, index === items.length - 1, context);
    lines.push(...(index === 0 ? sql_prefix(item_lines, `${keyword} `) : item_lines));
  });
  return lines.length ? lines : [{ ind: 0, text: keyword, comment_end: false }];
}

// CREATE TABLE: cada columna en su línea dentro de los paréntesis
function sql_render_create_table_clause(keyword, body, context) {
  const group_index = body.findIndex((node) => node.type === "group" && node.closed && !is_sql_subquery(node));
  if (group_index === -1) return sql_prefix(sql_render_expression(body, context), `${keyword} `);
  const lines = sql_prefix(sql_render_expression(body.slice(0, group_index), context), `${keyword} `);
  sql_append(lines, " (");
  const items = sql_split_items(body[group_index].children);
  items.forEach((item, index) => {
    if (sql_is_empty_item(item) && index === items.length - 1) return;
    lines.push(...sql_shift(sql_render_item(item, index === items.length - 1, context), 1));
  });
  lines.push({ ind: 0, text: ")", comment_end: false });
  const tail = body.slice(group_index + 1);
  if (tail.length) {
    const tail_lines = sql_render_expression(tail, context);
    const last = lines[lines.length - 1];
    last.text += tail_lines[0].text === "" ? "" : ` ${tail_lines[0].text}`;
    last.comment_end = tail_lines[0].comment_end;
    lines.push(...tail_lines.slice(1));
  }
  return lines;
}

// ¿Empieza aquí una palabra clave que abre línea? Devuelve cuántos nodos ocupa y cuál es, o null
function sql_clause_at(nodes, index) {
  const node = nodes[index];
  if (node.type !== "word") return null;
  const upper_at = (position) => (nodes[position] && nodes[position].type === "word" ? nodes[position].value.toUpperCase() : "");
  let end = index;
  while (SQL_JOIN_MODIFIERS.has(upper_at(end))) end += 1;
  if (upper_at(end) === "JOIN") return { length: end - index + 1, key: "JOIN" };
  const phrase = SQL_CLAUSE_PHRASES.find((words) => words.every((word, offset) => upper_at(index + offset) === word));
  if (!phrase) return null;
  const key = phrase.join(" ");
  // `FOR UPDATE`, `ON DUPLICATE KEY UPDATE` y `ON CONFLICT` no abren línea
  if (key === "UPDATE" && ["FOR", "KEY"].includes(upper_at(index - 1))) return null;
  if (key === "ON" && ["DUPLICATE", "CONFLICT"].includes(upper_at(index + 1))) return null;
  return { length: phrase.length, key };
}

function sql_split_clauses(nodes) {
  const clauses = [];
  let current = { key: null, words: [], body: [] };
  for (let index = 0; index < nodes.length; index += 1) {
    const found = sql_clause_at(nodes, index);
    if (found) {
      if (current.key !== null || current.body.length) clauses.push(current);
      current = { key: found.key, words: nodes.slice(index, index + found.length).map((word) => word.value), body: [] };
      index += found.length - 1;
    } else current.body.push(nodes[index]);
  }
  if (current.key !== null || current.body.length) clauses.push(current);
  return clauses;
}

function sql_render_clause(clause, context) {
  if (clause.key === null) return sql_render_expression(clause.body, context);
  const words = clause.words.map((word) => (context.uppercase ? word.toUpperCase() : word));
  let body = clause.body;
  // `SELECT DISTINCT a, b`: el DISTINCT se queda en la línea de SELECT
  if (clause.key === "SELECT") {
    while (body.length && body[0].type === "word" && ["DISTINCT", "ALL"].includes(body[0].value.toUpperCase())) {
      words.push(context.uppercase ? body[0].value.toUpperCase() : body[0].value);
      body = body.slice(1);
    }
  }
  const keyword = words.join(" ");
  switch (clause.key) {
    case "SELECT":
    case "SET":
    case "VALUES":
      return sql_render_item_clause(keyword, body, context);
    case "WHERE":
    case "HAVING":
    case "ON":
      return sql_render_condition_clause(keyword, body, context);
    case "WITH":
      return sql_render_with_clause(keyword, body, context);
    case "CREATE TABLE":
      return sql_render_create_table_clause(keyword, body, context);
    default:
      return sql_prefix(sql_render_expression(body, context), `${keyword} `);
  }
}

function sql_render_statement(nodes, context) {
  const lines = [];
  sql_split_clauses(nodes).forEach((clause) => {
    const clause_lines = sql_render_clause(clause, context);
    // El ON de un JOIN va con sangría
    lines.push(...(clause.key === "ON" ? sql_shift(clause_lines, 1) : clause_lines));
  });
  return lines;
}

// Varias sentencias separadas por `;`, con una línea en blanco entre ellas
function sql_render_statements(nodes, context) {
  const lines = [];
  let statement = [];

  function finish(has_semicolon) {
    const rendered = sql_render_statement(statement, context);
    statement = [];
    if (rendered.length === 0) {
      if (!has_semicolon) return;
      if (lines.length) sql_append(lines, ";");
      else lines.push({ ind: 0, text: ";", comment_end: false });
      return;
    }
    if (has_semicolon) sql_append(rendered, ";");
    if (lines.length) lines.push(sql_new_line(0));
    lines.push(...rendered);
  }

  nodes.forEach((node) => {
    if (node.type === "semi") finish(true);
    else statement.push(node);
  });
  finish(false);
  return lines;
}

// Minificado: una sentencia por línea y un solo espacio entre palabras; los comentarios se quitan
function write_minified_sql(nodes, context) {
  const flat_context = { ...context, flat: true };
  const statements = [];
  let statement = [];

  function finish(has_semicolon) {
    const text = sql_render_expression(statement, flat_context)[0].text;
    statement = [];
    if (text === "" && !has_semicolon) return;
    if (text === "") {
      if (statements.length) statements[statements.length - 1] += ";";
      else statements.push(";");
      return;
    }
    statements.push(has_semicolon ? `${text};` : text);
  }

  nodes.forEach((node) => {
    if (node.type === "semi") finish(true);
    else statement.push(node);
  });
  finish(false);
  return statements.join("\n");
}

function format_sql(text, { mode, indent, uppercase_keywords }) {
  const { nodes, warnings } = parse_sql(text);
  const warning = warnings.length ? warnings.reduce((first, other) => (other.line < first.line ? other : first)) : null;
  const context = { uppercase: Boolean(uppercase_keywords), flat: false };
  if (mode === "minify") return { text: write_minified_sql(nodes, context), warning };
  const lines = sql_render_statements(nodes, context);
  const result = lines.map((line) => (line.text === "" ? "" : indent.repeat(Math.min(line.ind, MAX_INDENT_DEPTH)) + line.text)).join("\n");
  return { text: result, warning };
}

// ---------------------------------------------------------------------------
// Entrada principal
// ---------------------------------------------------------------------------

// Un código con miles de niveles anidados agota la pila de llamadas del navegador. En vez de fallar, se devuelve sin
// cambios y con un aviso (sin línea, porque el problema es de todo el texto).
function with_nesting_guard(formatter) {
  return (text, options) => {
    try {
      return formatter(text, options);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return { text: normalize_newlines(text), warning: { line: null, message: "el código tiene demasiados niveles anidados para formatearlo, así que se deja como estaba" } };
    }
  };
}

const FORMATTERS = { css: format_css, html: with_nesting_guard(format_html), sql: with_nesting_guard(format_sql), text: format_text };

// options: { mode: "format" | "minify", indent: "  " | "    " | "\t", uppercase_keywords: boolean (solo SQL) }
export function format_code(text, language, options) {
  return FORMATTERS[language](text, options);
}
