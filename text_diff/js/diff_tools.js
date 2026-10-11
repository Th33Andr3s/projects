// Comparador de textos: funciones puras, sin tocar la pantalla, para poder probarlas con valores conocidos.
//
// Se compara por líneas con el algoritmo de Myers (el de Git) y, dentro de cada par de líneas que cambió, por palabras
// para resaltar solo lo distinto. El resultado es una lista de renglones (iguales, quitados, agregados y modificados)
// de la que salen las dos vistas, las estadísticas y el formato diff para copiar o descargar.
//
// Regla de oro: lo que se muestra es siempre el texto tal cual. Las opciones de ignorar espacios y mayúsculas solo
// cambian cómo se decide si dos líneas son iguales.

// Tope de ediciones (líneas quitadas más agregadas) que busca el algoritmo. Su memoria crece con el cuadrado de este
// número (unos 18 MB con 3.000), y dos textos sin nada en común lo superan enseguida. Al superarlo se parte el problema
// con las líneas que aparecen una sola vez en cada texto (diff_with_anchors); si ni así hay forma, lo que queda del medio
// se muestra como un bloque quitado y otro agregado, en vez de congelar el celular.
const MAX_LINE_EDITS = 3000;
// Lo mismo, para comparar las palabras de un par de líneas
const MAX_WORD_EDITS = 300;
// Una línea más larga que esto no se compara por palabras, y entre todas las líneas de una comparación solo se
// comparan por palabras hasta cierto número de trozos: así un archivo con miles de líneas largas modificadas no se traba
const MAX_HIGHLIGHT_CHARS = 2000;
const MAX_HIGHLIGHT_TOKENS_TOTAL = 400000;
// Si el parecido entre dos líneas es menor que esto, el resaltado por palabras sería confeti: se dejan enteras
const MIN_SIMILARITY = 0.4;
const CONTEXT_LINES = 3;
// Un tramo de líneas iguales de este largo o menos no se pliega, porque no se ahorra nada
const MAX_UNFOLDED_RUN = 6;
const TOKEN_PATTERN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
const WORD_TOKEN_PATTERN = /^[\p{L}\p{N}_]/u;
const SPACE_TOKEN_PATTERN = /^\s/u;

// Parte un texto en líneas. Un salto de línea final no crea una línea vacía de más, pero se recuerda.
function split_lines(text) {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (normalized === "") return { lines: [], ends_with_newline: false };
  const lines = normalized.split("\n");
  const ends_with_newline = lines[lines.length - 1] === "";
  if (ends_with_newline) lines.pop();
  return { lines, ends_with_newline };
}

// La clave con la que se comparan dos líneas: la línea tal cual, o sin las diferencias que se pidió ignorar
function comparison_key(line, ignore_spaces, ignore_case) {
  let key = line;
  if (ignore_spaces) key = key.trim().replace(/[ \t]+/g, " ");
  if (ignore_case) key = key.toLowerCase();
  return key;
}

// Cada clave distinta pasa a ser un número: comparar dos líneas es comparar dos enteros
function make_ids(first, second) {
  const ids = new Map();
  const to_id = (key) => {
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    return id;
  };
  return [first.map(to_id), second.map(to_id)];
}

// Algoritmo de Myers: el camino más corto que convierte la lista a en la lista b. Devuelve las operaciones en orden
// ({ type, a, b } con a y b como posiciones en cada lista), o null si hacen falta más de max_edits ediciones.
function myers(a, b, max_edits) {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  const limit = Math.min(n + m, max_edits);
  const offset = limit + 1;
  const furthest = new Int32Array(2 * limit + 3);
  // De cada ronda se guarda hasta dónde llegó cada diagonal (solo las de su paridad), para poder desandar el camino
  const trace = [];
  let found = -1;
  for (let d = 0; d <= limit && found < 0; d += 1) {
    const snapshot = new Int32Array(d + 1);
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && furthest[offset + k - 1] < furthest[offset + k + 1])) x = furthest[offset + k + 1];
      else x = furthest[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      furthest[offset + k] = x;
      snapshot[(k + d) >> 1] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    trace.push(snapshot);
  }
  if (found < 0) return null;

  const operations = [];
  let x = n;
  let y = m;
  let k = n - m;
  for (let d = found; d > 0; d -= 1) {
    const previous = trace[d - 1];
    const read = (diagonal) => previous[(diagonal + d - 1) >> 1];
    const previous_k = k === -d || (k !== d && read(k - 1) < read(k + 1)) ? k + 1 : k - 1;
    const previous_x = read(previous_k);
    const previous_y = previous_x - previous_k;
    while (x > previous_x && y > previous_y) {
      x -= 1;
      y -= 1;
      operations.push({ type: "equal", a: x, b: y });
    }
    if (x === previous_x) {
      y -= 1;
      operations.push({ type: "added", a: x, b: y });
    } else {
      x -= 1;
      operations.push({ type: "removed", a: x, b: y });
    }
    k = previous_k;
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    operations.push({ type: "equal", a: x, b: y });
  }
  return operations.reverse();
}

// La subsecuencia creciente más larga de unos pares [a, b] ordenados por a, mirando solo b (búsqueda binaria sobre los
// finales de cada largo posible)
function longest_increasing_pairs(pairs) {
  const tails = [];
  const previous = new Array(pairs.length).fill(-1);
  pairs.forEach((pair, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (pairs[tails[mid]][1] < pair[1]) low = mid + 1;
      else high = mid;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  });
  const chain = [];
  for (let index = tails.length ? tails[tails.length - 1] : -1; index !== -1; index = previous[index]) chain.push(pairs[index]);
  return chain.reverse();
}

// Cuando Myers necesita demasiadas ediciones, se buscan líneas que aparecen una sola vez en cada texto: si están en el
// mismo orden son puntos fijos que parten el problema en tramos pequeños, cada uno resuelto por su cuenta (la idea del
// diff "patience"). No siempre da el camino más corto, pero evita tratar como un solo bloque dos textos grandes con
// muchos cambios repartidos. Devuelve null si no hay ningún punto fijo.
function diff_with_anchors(a, b, max_edits) {
  const count_a = new Map();
  const count_b = new Map();
  const position_b = new Map();
  a.forEach((id) => count_a.set(id, (count_a.get(id) ?? 0) + 1));
  b.forEach((id, index) => {
    count_b.set(id, (count_b.get(id) ?? 0) + 1);
    position_b.set(id, index);
  });
  const pairs = [];
  a.forEach((id, index) => {
    if (count_a.get(id) === 1 && count_b.get(id) === 1) pairs.push([index, position_b.get(id)]);
  });
  const chain = longest_increasing_pairs(pairs);
  if (chain.length === 0) return null;

  const operations = [];
  let truncated = false;
  const solve_segment = (a_start, a_end, b_start, b_end) => {
    const segment = diff_sequences(a.slice(a_start, a_end), b.slice(b_start, b_end), max_edits);
    truncated = truncated || segment.truncated;
    segment.operations.forEach((operation) => operations.push({ type: operation.type, a: operation.a + a_start, b: operation.b + b_start }));
  };
  let a_position = 0;
  let b_position = 0;
  chain.forEach(([a_index, b_index]) => {
    solve_segment(a_position, a_index, b_position, b_index);
    operations.push({ type: "equal", a: a_index, b: b_index });
    a_position = a_index + 1;
    b_position = b_index + 1;
  });
  solve_segment(a_position, a.length, b_position, b.length);
  return { operations, truncated };
}

// Myers sobre dos listas de números, quitando antes lo igual del principio y del final, que suele ser casi todo
function diff_sequences(a, b, max_edits) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let a_end = a.length;
  let b_end = b.length;
  while (a_end > start && b_end > start && a[a_end - 1] === b[b_end - 1]) {
    a_end -= 1;
    b_end -= 1;
  }

  const operations = [];
  for (let index = 0; index < start; index += 1) operations.push({ type: "equal", a: index, b: index });
  const a_middle = a.slice(start, a_end);
  const b_middle = b.slice(start, b_end);
  let truncated = false;
  const middle = myers(a_middle, b_middle, max_edits);
  if (middle) middle.forEach((operation) => operations.push({ type: operation.type, a: operation.a + start, b: operation.b + start }));
  else {
    const anchored = diff_with_anchors(a_middle, b_middle, max_edits);
    if (anchored) {
      truncated = anchored.truncated;
      anchored.operations.forEach((operation) => operations.push({ type: operation.type, a: operation.a + start, b: operation.b + start }));
    } else {
      truncated = true;
      for (let index = start; index < a_end; index += 1) operations.push({ type: "removed", a: index, b: start });
      for (let index = start; index < b_end; index += 1) operations.push({ type: "added", a: a_end, b: index });
    }
  }
  for (let a_index = a_end, b_index = b_end; a_index < a.length; a_index += 1, b_index += 1) {
    operations.push({ type: "equal", a: a_index, b: b_index });
  }
  return { operations, truncated };
}

// Regla de deslizar de Git: un bloque de líneas solo agregadas (o solo quitadas) entre líneas iguales se corre hacia abajo
// mientras su primera línea sea igual a la que le sigue. Así el cambio cae donde se espera (una llave de cierre al final
// del bloque nuevo y no al principio).
function slide_blocks(operations, a_ids, b_ids) {
  let index = 0;
  while (index < operations.length) {
    const type = operations[index].type;
    if (type === "equal") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < operations.length && operations[end].type === type) end += 1;
    const is_pure = index === 0 || operations[index - 1].type === "equal";
    if (is_pure && (type === "added" || type === "removed")) {
      const ids = type === "added" ? b_ids : a_ids;
      const field = type === "added" ? "b" : "a";
      while (end < operations.length && operations[end].type === "equal" && ids[operations[index][field]] === ids[operations[end][field]]) {
        const first = operations[index];
        const equal = operations[end];
        // La línea igual de después sube al primer puesto del bloque y el bloque se corre una posición
        operations[index] = type === "added" ? { type: "equal", a: equal.a, b: first.b } : { type: "equal", a: first.a, b: equal.b };
        for (let position = index + 1; position <= end; position += 1) {
          operations[position] = type === "added" ? { type, a: operations[position].a, b: first.b + (position - index) } : { type, a: first.a + (position - index), b: operations[position].b };
        }
        index += 1;
        end += 1;
      }
    }
    index = end;
  }
}

// ---------------------------------------------------------------------------
// Diferencias dentro de una línea
// ---------------------------------------------------------------------------

function token_weight(token, use_punctuation) {
  if (WORD_TOKEN_PATTERN.test(token)) return token.length;
  if (use_punctuation && !SPACE_TOKEN_PATTERN.test(token)) return token.length;
  return 0;
}

// Cuánto pesa en total una lista de trozos: las letras y números cuentan; los signos solo si no hay ni una palabra
function total_weight(tokens, use_punctuation) {
  return tokens.reduce((sum, token) => sum + token_weight(token, use_punctuation), 0);
}

// Cota superior del parecido entre dos listas de trozos (sin mirar el orden): sirve para descartar rápido pares que no
// se parecen antes de correr el algoritmo
function overlap_weight(first, second, use_punctuation) {
  const counts = new Map();
  first.forEach((token) => counts.set(token, (counts.get(token) ?? 0) + 1));
  let weight = 0;
  second.forEach((token) => {
    const remaining = counts.get(token) ?? 0;
    if (remaining > 0) {
      counts.set(token, remaining - 1);
      weight += token_weight(token, use_punctuation);
    }
  });
  return weight;
}

function merge_parts(parts) {
  const merged = [];
  parts.forEach((part) => {
    const last = merged[merged.length - 1];
    if (last && last.changed === part.changed) last.text += part.text;
    else merged.push({ text: part.text, changed: part.changed });
  });
  return merged;
}

// Compara por palabras un par de líneas. Devuelve las partes de cada una, con las distintas marcadas, o null si no se
// parecen lo bastante (o son demasiado largas) para que el resaltado sirva de algo.
function highlight_pair(old_line, new_line, options, budget) {
  if (old_line.length > MAX_HIGHLIGHT_CHARS || new_line.length > MAX_HIGHLIGHT_CHARS) return null;
  const old_tokens = old_line.match(TOKEN_PATTERN) ?? [];
  const new_tokens = new_line.match(TOKEN_PATTERN) ?? [];
  if (budget.tokens + old_tokens.length + new_tokens.length > MAX_HIGHLIGHT_TOKENS_TOTAL) return null;
  budget.tokens += old_tokens.length + new_tokens.length;

  const key_of = (token) => {
    if (options.ignore_spaces && SPACE_TOKEN_PATTERN.test(token)) return " ";
    return options.ignore_case ? token.toLowerCase() : token;
  };
  const old_keys = old_tokens.map(key_of);
  const new_keys = new_tokens.map(key_of);
  const use_punctuation = total_weight(old_tokens, false) + total_weight(new_tokens, false) === 0;
  const longest = Math.max(total_weight(old_tokens, use_punctuation), total_weight(new_tokens, use_punctuation));
  if (longest === 0) return null;
  if (overlap_weight(old_keys, new_keys, use_punctuation) / longest < MIN_SIMILARITY) return null;

  const [old_ids, new_ids] = make_ids(old_keys, new_keys);
  const { operations, truncated } = diff_sequences(old_ids, new_ids, MAX_WORD_EDITS);
  if (truncated) return null;
  const old_parts = [];
  const new_parts = [];
  let matched = 0;
  operations.forEach((operation) => {
    if (operation.type === "equal") {
      matched += token_weight(old_tokens[operation.a], use_punctuation);
      old_parts.push({ text: old_tokens[operation.a], changed: false });
      new_parts.push({ text: new_tokens[operation.b], changed: false });
    } else if (operation.type === "removed") old_parts.push({ text: old_tokens[operation.a], changed: true });
    else new_parts.push({ text: new_tokens[operation.b], changed: true });
  });
  if (matched / longest < MIN_SIMILARITY) return null;
  return { old_parts: merge_parts(old_parts), new_parts: merge_parts(new_parts) };
}

// ---------------------------------------------------------------------------
// Comparación completa
// ---------------------------------------------------------------------------

function lines_equal_under(first, second, ignore_spaces, ignore_case) {
  return first.length === second.length && first.every((line, index) => comparison_key(line, ignore_spaces, ignore_case) === comparison_key(second[index], ignore_spaces, ignore_case));
}

// Si los textos no tienen cambios, por qué son "iguales": exactos, o solo gracias a una opción
function describe_equality(before, after, options) {
  if (lines_equal_under(before.lines, after.lines, false, false)) return before.ends_with_newline === after.ends_with_newline ? "exact" : "newline";
  if (options.ignore_spaces && options.ignore_case) {
    if (lines_equal_under(before.lines, after.lines, true, false)) return "spaces";
    if (lines_equal_under(before.lines, after.lines, false, true)) return "case";
    return "spaces_and_case";
  }
  return options.ignore_spaces ? "spaces" : "case";
}

// Compara dos textos. options: { ignore_spaces, ignore_case }.
// Devuelve:
//   rows:     lista de renglones { type: "equal" | "removed" | "added" | "modified", index, a_number, b_number, a_text,
//             b_text, change, old_parts, new_parts }. Los números de línea cuentan desde 1; las partes (solo en
//             "modified") son trozos { text, changed } para resaltar lo distinto dentro de la línea, o null si las líneas
//             se parecen poco.
//   changes:  cada grupo de renglones seguidos que no son iguales { number, first_row, last_row }
//   stats:    { changes, added, removed, equal } con líneas (una modificación cuenta como una quitada y una agregada)
//   equality: null si hay cambios; si no, "exact", "newline", "spaces", "case" o "spaces_and_case"
//   truncated: true si los textos eran tan distintos que no se alinearon línea por línea
export function compare_texts(before_text, after_text, options) {
  const before = split_lines(before_text);
  const after = split_lines(after_text);
  const keys = (lines) => lines.map((line) => comparison_key(line, options.ignore_spaces, options.ignore_case));
  const [before_ids, after_ids] = make_ids(keys(before.lines), keys(after.lines));
  const { operations, truncated } = diff_sequences(before_ids, after_ids, MAX_LINE_EDITS);
  slide_blocks(operations, before_ids, after_ids);

  const rows = [];
  const changes = [];
  const budget = { tokens: 0 };
  const stats = { changes: 0, added: 0, removed: 0, equal: 0 };
  let position = 0;
  while (position < operations.length) {
    const operation = operations[position];
    if (operation.type === "equal") {
      rows.push({ type: "equal", index: rows.length, a_number: operation.a + 1, b_number: operation.b + 1, a_text: before.lines[operation.a], b_text: after.lines[operation.b] });
      stats.equal += 1;
      position += 1;
      continue;
    }
    const removed = [];
    const added = [];
    while (position < operations.length && operations[position].type !== "equal") {
      (operations[position].type === "removed" ? removed : added).push(operations[position]);
      position += 1;
    }
    const number = changes.length + 1;
    const first_row = rows.length;
    const pairs = Math.min(removed.length, added.length);
    const push = (row) => rows.push({ ...row, index: rows.length, change: number });
    for (let pair = 0; pair < pairs; pair += 1) {
      const old_line = before.lines[removed[pair].a];
      const new_line = after.lines[added[pair].b];
      const parts = highlight_pair(old_line, new_line, options, budget);
      push({ type: "modified", a_number: removed[pair].a + 1, b_number: added[pair].b + 1, a_text: old_line, b_text: new_line, old_parts: parts ? parts.old_parts : null, new_parts: parts ? parts.new_parts : null });
    }
    removed.slice(pairs).forEach((item) => push({ type: "removed", a_number: item.a + 1, a_text: before.lines[item.a] }));
    added.slice(pairs).forEach((item) => push({ type: "added", b_number: item.b + 1, b_text: after.lines[item.b] }));
    changes.push({ number, first_row, last_row: rows.length - 1 });
    stats.changes += 1;
    stats.removed += removed.length;
    stats.added += added.length;
  }

  const equality = changes.length === 0 ? describe_equality(before, after, options) : null;
  return { rows, changes, stats, equality, truncated, before, after };
}

// ---------------------------------------------------------------------------
// Solo cambios
// ---------------------------------------------------------------------------

// Pliega los tramos de líneas iguales largos dejando tres de contexto junto a cada cambio. Devuelve los renglones y,
// donde se plegó algo, { type: "fold", key, count, rows }. Los pliegues cuya clave está en `expanded` se dejan abiertos.
export function fold_rows(rows, expanded) {
  const items = [];
  let index = 0;
  while (index < rows.length) {
    if (rows[index].type !== "equal") {
      items.push(rows[index]);
      index += 1;
      continue;
    }
    let end = index;
    while (end < rows.length && rows[end].type === "equal") end += 1;
    const length = end - index;
    if (length <= MAX_UNFOLDED_RUN || expanded.has(index)) {
      rows.slice(index, end).forEach((row) => items.push(row));
    } else {
      // Solo se deja contexto del lado donde hay un cambio al lado del tramo
      const head = index > 0 ? CONTEXT_LINES : 0;
      const tail = end < rows.length ? CONTEXT_LINES : 0;
      rows.slice(index, index + head).forEach((row) => items.push(row));
      items.push({ type: "fold", key: index, count: length - head - tail, rows: rows.slice(index + head, end - tail) });
      rows.slice(end - tail, end).forEach((row) => items.push(row));
    }
    index = end;
  }
  return items;
}

// ---------------------------------------------------------------------------
// Formato diff unificado
// ---------------------------------------------------------------------------

const NO_NEWLINE_MARK = "\\ No newline at end of file";

// El diff que entienden Git y los editores. Los textos van como "antes" y "despues", sin tilde, para que ninguna
// herramienta tenga problemas con el nombre.
export function build_unified_diff(result) {
  const lines = ["--- antes", "+++ despues"];
  const { before, after } = result;
  let { rows, changes } = result;
  // Una línea igual que en un texto es la última sin salto de línea y en el otro no lo es, para la pantalla es la
  // misma línea, pero para el formato diff es un cambio: va como quitada y agregada, con la marca donde falta el salto
  const lacks_newline = (text, number) => number === text.lines.length && !text.ends_with_newline;
  const mismatched = rows.filter((row) => row.type === "equal" && lacks_newline(before, row.a_number) !== lacks_newline(after, row.b_number));
  if (mismatched.length > 0) {
    rows = rows.map((row) => (mismatched.includes(row) ? { ...row, type: "modified", change: changes.length + 1 + mismatched.indexOf(row) } : row));
    changes = [...changes, ...mismatched.map((row, offset) => ({ number: changes.length + 1 + offset, first_row: row.index, last_row: row.index }))].sort((first, second) => first.first_row - second.first_row);
  }
  if (changes.length === 0) return `${lines.join("\n")}\n`;

  // Los cambios que quedan a menos de dos contextos de distancia comparten bloque, como en git diff
  const hunks = [];
  changes.forEach((change) => {
    const start = Math.max(0, change.first_row - CONTEXT_LINES);
    const end = Math.min(rows.length - 1, change.last_row + CONTEXT_LINES);
    const last = hunks[hunks.length - 1];
    if (last && start <= last.end + 1) last.end = end;
    else hunks.push({ start, end });
  });

  // Cuántas líneas de cada texto hay antes de cada renglón, para los números de la cabecera de cada bloque
  const before_seen = [];
  const after_seen = [];
  let before_count = 0;
  let after_count = 0;
  rows.forEach((row) => {
    before_seen.push(before_count);
    after_seen.push(after_count);
    if (row.type !== "added") before_count += 1;
    if (row.type !== "removed") after_count += 1;
  });

  const is_last_of = (text, number) => number === text.lines.length;
  hunks.forEach((hunk) => {
    const body = [];
    let before_lines = 0;
    let after_lines = 0;
    let row_index = hunk.start;
    while (row_index <= hunk.end) {
      const row = rows[row_index];
      if (row.type === "equal") {
        body.push(` ${row.a_text}`);
        if (!before.ends_with_newline && !after.ends_with_newline && is_last_of(before, row.a_number) && is_last_of(after, row.b_number)) body.push(NO_NEWLINE_MARK);
        before_lines += 1;
        after_lines += 1;
        row_index += 1;
        continue;
      }
      // Un cambio entero: primero todas las líneas quitadas y después todas las agregadas
      const group = [];
      while (row_index <= hunk.end && rows[row_index].type !== "equal" && rows[row_index].change === row.change) {
        group.push(rows[row_index]);
        row_index += 1;
      }
      group.filter((item) => item.type !== "added").forEach((item) => {
        body.push(`-${item.a_text}`);
        if (!before.ends_with_newline && is_last_of(before, item.a_number)) body.push(NO_NEWLINE_MARK);
        before_lines += 1;
      });
      group.filter((item) => item.type !== "removed").forEach((item) => {
        body.push(`+${item.b_text}`);
        if (!after.ends_with_newline && is_last_of(after, item.b_number)) body.push(NO_NEWLINE_MARK);
        after_lines += 1;
      });
    }
    // Un lado sin líneas en el bloque se numera con la línea anterior, como hace Git
    const before_start = before_seen[hunk.start] + (before_lines > 0 ? 1 : 0);
    const after_start = after_seen[hunk.start] + (after_lines > 0 ? 1 : 0);
    lines.push(`@@ -${before_start},${before_lines} +${after_start},${after_lines} @@`, ...body);
  });
  return `${lines.join("\n")}\n`;
}
