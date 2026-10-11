# Plan de trabajo: Formateador de código (`code_formatter`)

Documento de planificación del proyecto. Se rige por las reglas de [CLAUDE.md](../CLAUDE.md). Cada fase termina con una revisión en el navegador y la aprobación de la persona dueña antes de pasar a la siguiente.

> **Nombre de la carpeta.** CLAUDE.md 1.3 pide snake_case en minúscula para carpetas y archivos, y 2.7 recuerda que GitHub Pages distingue mayúsculas en las direcciones. La carpeta se creó como `Code_Formatter` y en la Fase 1 se renombró a `code_formatter`, que es el nombre que usa este plan, el portal y la tabla 2.12 de CLAUDE.md.

---

## 1. Qué es este proyecto

Una página para pegar código y dejarlo ordenado: **CSS**, **HTML** y **SQL** con sangría y saltos de línea en su sitio, o comprimidos en una sola línea; y cualquier otro texto limpio de espacios sobrantes. Pensada para quien copia un estilo de una herramienta, una consulta de un registro o un trozo de HTML de una respuesta y necesita leerlo o pegarlo limpio, desde el computador o el celular. Es el hermano del Formateador de JSON: misma pantalla, misma forma de trabajar.

Funciona así:

1. **Pegar el código** en el cuadro de entrada. La página detecta si es CSS, HTML o SQL; si se equivoca, se elige el lenguaje en la lista.
2. **Ver el resultado al instante**, formateado o minificado según el modo, con la sangría que se prefiera. Si algo no cuadra (una llave sin cerrar, un texto sin cerrar), un aviso lo dice con su línea, pero el resultado se muestra igual.
3. **Copiar o descargar** el resultado.

**No usa servidor ni cuentas.** Nada de lo que se pega sale del navegador. Lo único que se recuerda en el equipo son las opciones y el último texto (si no es muy grande).

### Qué no es

- **No formatea JavaScript, Python ni otros lenguajes de programación.** Formatearlos bien exige entender su gramática completa (cadenas, plantillas, expresiones regulares, comentarios, inserción de puntos y coma); hacerlo "a ojo" por las llaves rompe código real, y las librerías que lo hacen bien (Prettier, Black) están fuera del stack de CLAUDE.md 2.2. Si más adelante se quiere JavaScript, será un proyecto aparte con un analizador propio, como se hizo con el JSON.
- **No es un validador.** Los avisos ayudan a encontrar un error evidente, pero un CSS o un HTML "aceptados" no son necesariamente correctos.
- **No formatea JSON:** para eso está `json_formatter`.

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Stack | HTML, CSS, JS vanilla, Three.js, Font Awesome. Todo por CDN según CLAUDE.md 2.3. Sin Lottie |
| Datos | Ninguno en servidor. Las opciones y el último texto en `localStorage` |
| Lenguajes | **CSS**, **HTML** y **SQL**, cada uno con su formateador propio basado en un tokenizador (ver sección 4), más **Texto** para cualquier otra cosa (solo limpieza de espacios). Elegidos porque se pueden formatear con seguridad sin entender toda su gramática: basta con respetar cadenas y comentarios y conocer sus bloques |
| Regla de oro | **El formateador nunca cambia el contenido, solo los espacios.** Cadenas, comentarios, nombres, valores y atributos salen exactamente como entraron; en HTML tampoco se toca lo que hay dentro de `<pre>`, `<textarea>`, `<script>` y `<style>`. La única excepción es SQL, que pone las palabras clave en mayúscula (opción, activada por defecto) |
| Detección | Al pegar, la lista de lenguaje queda en **Detectar** y la página adivina (sección 4.5). La persona puede fijar el lenguaje a mano, y esa elección se recuerda mientras no se vacíe la entrada |
| Modos | **Formateado** y **Minificado**, con dos botones tipo pestaña. Minificado quita todo el espacio que no cambia el significado; en Texto está desactivado, porque no hay forma segura de saber qué espacios sobran |
| Sangría | 2 espacios (por defecto), 4 espacios o tabulación |
| Limpieza común | En todos los lenguajes, al formatear: espacios al final de cada línea fuera, saltos de línea `\r\n` y `\r` pasan a `\n`, nunca más de una línea en blanco seguida, y el resultado termina sin salto de línea final |
| Avisos | Lo que el formateador no entiende no detiene nada: se formatea lo que se puede y se muestra un aviso con la línea ("Aviso: hay una llave sin cerrar desde la línea 14"). Como mucho se muestra un aviso, el primero |
| Resultado en vivo | Igual que en el Formateador de JSON: se recalcula 150 ms después de dejar de escribir; entrada de hasta 2 MB y resultado de hasta 20.000 líneas en pantalla (más allá, un aviso, y Copiar y Descargar entregan el resultado completo) |
| Copiar y descargar | **Copiar** copia el resultado; si el navegador no deja, lo selecciona y avisa. **Descargar** guarda el archivo con la extensión del lenguaje: `resultado.css`, `resultado.html`, `resultado.sql` o `resultado.txt` |
| Estadísticas | Bajo el resultado: lenguaje, tamaño de entrada y de salida, y líneas del resultado |
| Estética | La misma del Formateador de JSON (misma pantalla, cuadros monoespaciados, entrada y resultado lado a lado en pantallas anchas), con acento ámbar para distinguirlo. Animación 3D sutil de fondo |
| Idioma | Interfaz en español. Los avisos son propios, iguales en cualquier navegador |

---

## 3. Pantalla

Todo vive en un solo `index.html`, en una sola pantalla, con la misma disposición que `json_formatter`.

### 3.1 Entrada
- **Cuadro de texto** grande ("Pega aquí tu código"), monoespaciado, que crece con el contenido hasta un máximo y luego se desplaza. Botón **Limpiar**.
- Debajo, el **estado en vivo**: "Listo · CSS" en verde, o un aviso en el color de atención ("Aviso: hay una llave sin cerrar desde la línea 14") con el botón **Ir a la línea**, que pone el cursor al inicio de esa línea. Con el cuadro vacío no se muestra nada.

### 3.2 Opciones
- **Lenguaje:** lista con Detectar (por defecto), CSS, HTML, SQL y Texto. En Detectar, la lista muestra entre paréntesis lo que se detectó: "Detectar (CSS)".
- **Modo:** Formateado / Minificado (botones con `role="tab"`). En Texto, Minificado queda desactivado.
- **Sangría:** lista con 2 espacios, 4 espacios y tabulación. Desactivada en Minificado.
- **Palabras clave en mayúscula:** casilla, marcada por defecto. Solo se ve con SQL.

### 3.3 Resultado
- Cuadro de solo lectura, monoespaciado. Si la entrada está vacía, muestra un texto atenuado ("Aquí aparece el resultado").
- Botones **Copiar** y **Descargar**, desactivados cuando no hay resultado.
- **Estadísticas** en una línea: "CSS · Entrada 1,2 KB · Salida 1,6 KB · 48 líneas".

### 3.4 Comportamiento común
- Lo que se recuerda va en `localStorage` con la clave `code_formatter_last`, en `try/catch`: lenguaje elegido, modo, sangría, mayúsculas en SQL y el texto de entrada si pesa 200 KB o menos. Si el almacenamiento falla, la página funciona igual.
- Teclado: Tab recorre Limpiar, entrada, estado, opciones, resultado y botones; en el modo, las flechas, Inicio y Fin cambian entre Formateado y Minificado. Dentro del cuadro de entrada Tab sigue siendo la tecla para moverse. Foco siempre visible.
- Copiar y Descargar: el botón dice "Copiado" dos segundos; se avisa a lectores de pantalla.
- Sin `console.log` ni errores en consola.

---

## 4. Cómo se formatea cada lenguaje

Toda la lógica vive en `js/formatters.js` como funciones puras, sin tocar la pantalla, para probarlas con valores conocidos. Cada formateador recibe el texto y las opciones y devuelve `{ text, warning }`, donde `warning` es `null` o `{ line, message }`.

### 4.1 Limpieza común (todos los lenguajes, modo Formateado)
- Saltos `\r\n` y `\r` pasan a `\n`.
- Se quitan los espacios y tabulaciones al final de cada línea (nunca al inicio, que es la sangría).
- Dos o más líneas en blanco seguidas pasan a una.
- Se quitan las líneas en blanco del principio y del final.
- Para **Texto** esto es todo lo que se hace, y además las tabulaciones al inicio de línea pasan a la sangría elegida (y al revés, si se elige tabulación).

### 4.2 CSS
- **Tokenizador:** recorre el texto y separa cadenas (`"…"` y `'…'`, con escapes), comentarios (`/* … */`), llaves, punto y coma, dos puntos, paréntesis y el resto. Dentro de cadenas y comentarios no se cambia nada, ni siquiera los espacios.
- **Formateado:** cada selector en su línea, con `{` al final de la misma línea; cada declaración en su propia línea, con sangría, `propiedad: valor;` (un espacio tras los dos puntos, ninguno antes del punto y coma, y punto y coma al final aunque faltara); `}` solo en su línea; una línea en blanco entre reglas; los bloques anidados (`@media`, `@supports`, `@font-face`, `@keyframes`) aumentan la sangría. Los comentarios se conservan en su sitio, en su propia línea si estaban solos. Los selectores separados por coma se parten uno por línea. Las comas dentro de paréntesis (`rgb(0, 0, 0)`) se dejan como estaban.
- **Minificado:** sin comentarios (salvo los que empiezan por `/*!`, que son de licencia), sin espacios fuera de cadenas, sin el último `;` de cada bloque.
- **Avisos:** llave abierta sin cerrar ("hay una llave sin cerrar desde la línea N"), llave de cierre sin abrir ("sobra una llave de cierre en la línea N"), cadena o comentario sin cerrar. Si falta una llave de cierre, se cierra al final del resultado para que quede ordenado, y el aviso lo dice.

### 4.3 HTML
- **Tokenizador:** separa etiquetas (`<…>`, respetando atributos con comillas que contienen `>`), comentarios (`<!-- … -->`), el `<!DOCTYPE …>` y el texto. El contenido de `<pre>`, `<textarea>`, `<script>` y `<style>` se copia tal cual hasta su cierre, sin tocar una sola letra.
- **Formateado:** cada etiqueta de bloque (`html`, `head`, `body`, `div`, `section`, `article`, `header`, `footer`, `main`, `nav`, `aside`, `ul`, `ol`, `li`, `table`, `thead`, `tbody`, `tr`, `td`, `th`, `form`, `fieldset`, `p`, `h1` a `h6`, `blockquote`, `figure`, `details`, `summary`, `dialog`, `template`, `select`, `option`, `label`, `button`, `canvas`, `svg` y las de `head`: `meta`, `link`, `title`, `script`, `style`) en su propia línea con sangría según su nivel; las etiquetas de línea (`a`, `span`, `strong`, `em`, `b`, `i`, `u`, `small`, `code`, `kbd`, `abbr`, `img`, `br`, `wbr`, `sup`, `sub`, `mark`, `time`, `q`, `cite`, `s`, `input`) se quedan en la línea con su texto, como estaban. Las etiquetas vacías (`br`, `img`, `input`, `meta`, `link`, `hr`, `source`, `track`, `area`, `base`, `col`, `embed`, `param`, `wbr`) no abren nivel. Los atributos salen exactamente como entraron (orden, comillas, espacios internos). El texto suelto se recorta de espacios en los bordes y se parte en líneas solo si ya tenía saltos.
- **Minificado:** se quitan los saltos y la sangría entre etiquetas de bloque y los comentarios (salvo los condicionales `<!--[if …]>`); dentro de las de línea los espacios se reducen a uno, porque ahí sí separan palabras; `<pre>`, `<textarea>`, `<script>` y `<style>` quedan intactos.
- **Avisos:** etiqueta de cierre sin su apertura ("sobra una etiqueta de cierre `</div>` en la línea N") y etiqueta abierta sin cerrar al final ("falta cerrar `<div>` abierto en la línea N"). Un cierre que no coincide con la última abierta cierra las intermedias, como hace el navegador. Como HTML es permisivo, nunca se cierra nada por cuenta propia en el resultado: se avisa y ya.

### 4.4 SQL
- **Tokenizador:** separa cadenas (`'…'` con `''` como escape, `"…"` y `` `…` `` para identificadores), comentarios (`-- …` hasta fin de línea y `/* … */`), paréntesis, comas, punto y coma y palabras.
- **Formateado:** las palabras clave principales empiezan línea: `SELECT`, `FROM`, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`, `OFFSET`, `INSERT INTO`, `VALUES`, `UPDATE`, `SET`, `DELETE FROM`, `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, `WITH`, `UNION`, `UNION ALL`. Dentro de `SELECT`, `SET` y `VALUES`, si hay un solo elemento se queda en la línea de la palabra clave (`SELECT *`, `SET a = 1`) y si hay varios, cada uno separado por coma va en su línea con sangría (`SELECT DISTINCT` mantiene el `DISTINCT` en la primera línea); en `CREATE TABLE` cada columna va en su línea dentro de los paréntesis; en `WITH` cada tabla temporal (`nombre AS (…)`) empieza línea; `AND` y `OR` empiezan línea con sangría dentro de `WHERE`, `HAVING` y `ON`; los `JOIN` (`JOIN`, `LEFT JOIN`, `INNER JOIN`, `RIGHT JOIN`, `FULL JOIN`, `CROSS JOIN`) empiezan línea al nivel de `FROM` y su `ON` va con sangría; las subconsultas entre paréntesis aumentan la sangría; `CASE … WHEN … THEN … ELSE … END` pone cada `WHEN` en su línea; `;` cierra la sentencia y deja una línea en blanco antes de la siguiente. Las palabras clave (la lista de 4.4 más `AS`, `ON`, `IN`, `NOT`, `NULL`, `IS`, `LIKE`, `BETWEEN`, `EXISTS`, `DISTINCT`, `CASE`, `WHEN`, `THEN`, `ELSE`, `END`, `ASC`, `DESC`, `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `INTO`, `TABLE`, `INDEX`, `VIEW`, `PRIMARY`, `KEY`, `DEFAULT`, `TRUE`, `FALSE`) pasan a mayúscula si la casilla está marcada; los nombres de tablas y columnas no se tocan nunca, ni lo que va entre comillas.
- **Minificado:** una sentencia por línea, un solo espacio entre palabras, sin comentarios.
- **Avisos:** paréntesis sin cerrar o de más, cadena o comentario sin cerrar. Lo que queda abierto no se cierra por cuenta propia: se avisa y ya.
- **Detalles de la fase 3:** `COUNT`, `SUM`, `AVG`, `MIN` y `MAX` solo pasan a mayúscula si van seguidas de un paréntesis (así una columna llamada `count` no cambia), y una palabra con punto (`t.key`) tampoco se toca. Un paréntesis que empieza con `SELECT` o `WITH` es una subconsulta (con sangría); cualquier otro (`IN (1, 2)`, `COUNT(*)`) se deja en una línea. Un comentario de línea (`-- …`) nunca se deja pegado a algo que lo comentaría: lo que sigue va en la línea de abajo.

### 4.4.1 Detalles de HTML añadidos en la fase 3
- Una etiqueta que no está en ninguna lista (un componente como `<mi-boton>` o una pieza interna de un SVG) va en su propia línea solo si ya estaba sola en la suya en el original; si no, se queda junto a su texto.
- Un comentario, una declaración (`<!DOCTYPE>`) y un `<pre>`, `<textarea>`, `<script>` o `<style>` completo rompen la línea; de estos últimos solo se sangra la primera línea y el resto sale exactamente como entró.
- Una línea en blanco entre bloques se conserva (una sola); los saltos de línea dentro de un texto también.
- Un código con miles de niveles anidados agota la pila de llamadas del navegador; en ese caso se devuelve sin cambios, con el aviso "el código tiene demasiados niveles anidados para formatearlo, así que se deja como estaba" (sin botón "Ir a la línea", porque no hay una línea).

### 4.5 Detección del lenguaje
En orden, sobre el texto sin espacios de los bordes:
1. Empieza por `<` y contiene `>`: **HTML**.
2. Su primera palabra, en mayúscula, es `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP`, `WITH` o `EXPLAIN`: **SQL**.
3. Contiene `{` y, antes de la primera `{`, hay algo que parece un selector o una arroba (`@media`…): sin `=` fuera de corchetes y sin paréntesis que no sean de una pseudoclase (`:not(…)`), y después de la `{` hay un `:` seguido de `;`, de `}` o del final del texto: **CSS**. La llave de cierre no se exige, para que un CSS al que le falta una (o que se está escribiendo) se siga detectando y el aviso pueda aparecer.
4. Si no: **Texto**.

### 4.6 Valores de comprobación
La fase 2 (CSS) y la fase 3 (HTML y SQL) corren una prueba automática con estos casos, calculados aparte:
- CSS: `a{color:red;background:url("a b.png")}p,span{margin:0}` con 2 espacios es:
  ```
  a {
    color: red;
    background: url("a b.png");
  }

  p,
  span {
    margin: 0;
  }
  ```
  Minificado: `a{color:red;background:url("a b.png")}p,span{margin:0}`. La cadena `"a b.png"` conserva su espacio en los dos casos.
- CSS con `@media (max-width: 600px) { .card { padding: 8px } }` → el bloque interno con doble sangría y `padding: 8px;` con su punto y coma. `/* nota */` entre dos reglas se conserva en su línea.
- CSS con error: `a { color: red;` → resultado `a {\n  color: red;\n}` y aviso "hay una llave sin cerrar desde la línea 1". `a { color: red; } }` → aviso "sobra una llave de cierre en la línea 1".
- HTML: `<div><p>Hola <b>mundo</b></p><ul><li>a</li><li>b</li></ul></div>` es:
  ```
  <div>
    <p>Hola <b>mundo</b></p>
    <ul>
      <li>a</li>
      <li>b</li>
    </ul>
  </div>
  ```
  y minificado vuelve a ser el texto original. `<pre>  dos\n espacios</pre>` conserva sus espacios y su salto en los dos modos. `<img src="a.png" alt="x > y">` no se parte por el `>` del atributo.
- HTML con cierres: `<div><p>Hola</div>` no da aviso, porque el `</div>` cierra el `<p>` implícitamente, como hace el navegador. `<div><p>Hola` → aviso "falta cerrar `<div>` abierto en la línea 1". `<p>Hola</p></div>` → aviso "sobra una etiqueta de cierre `</div>` en la línea 1".
- SQL: `select a,b from t where x=1 and y='a b' order by a` con mayúsculas es:
  ```
  SELECT
    a,
    b
  FROM t
  WHERE x = 1
    AND y = 'a b'
  ORDER BY a
  ```
  Minificado: `SELECT a, b FROM t WHERE x = 1 AND y = 'a b' ORDER BY a`. La cadena `'a b'` y los nombres `a`, `b`, `t`, `x`, `y` no cambian; sin la casilla, `select` se queda en minúscula.
- SQL con subconsulta: `select * from (select id from t) s join u on u.id=s.id` → la subconsulta con sangría dentro de sus paréntesis y `JOIN u` al nivel de `FROM`, con `ON` sangrado.
- Texto: `"hola  \r\n\r\n\r\nmundo \t\n"` → `"hola\n\nmundo"`.
- Detección: `<p>x</p>` → HTML; `select 1` → SQL; `a{b:c}` → CSS; `hola mundo` → Texto; `x = { a: 1 }` → Texto (no CSS, porque hay `=` antes de la llave).
- Formatear lo ya formateado no cambia nada (idempotencia), en los tres lenguajes.

---

## 5. Cómo se muestran los números
- Tamaños con una cifra decimal y coma ("1,2 KB"); bytes enteros ("850 B").
- Líneas con punto de miles si pasan de 999 ("1.250 líneas").
- Las líneas de los avisos se cuentan desde 1, como en los editores.

---

## 6. Diseño visual y animación

- Fondo oscuro neutro con acento ámbar (`#fbbf24`) para el modo activo y los botones principales; verde solo para "Listo" y el color de atención para los avisos. Buen contraste en todo (WCAG AA, 4,5 a 1 en textos). El contorno de foco es cian, para no confundirse con el ámbar.
- Tarjeta de hasta 720 px de ancho; a partir de 1100 px, 1200 px con entrada y resultado lado a lado, igual que en `json_formatter`. Cuadros monoespaciados de 16 px.
- **Animación 3D (Three.js):** etiquetas y símbolos translúcidos (`</>`, `{ }`, `;`) que flotan y giran despacio detrás de la tarjeta y hacen un leve destello cuando cambia el lenguaje detectado o al copiar. Decorativa: la página funciona igual si no carga. Three.js se importa con `import()` dentro de `animations.js`, como en las otras herramientas.
- Según CLAUDE.md 2.10: `requestAnimationFrame`, tope de 30 cuadros por segundo, `pixelRatio` máximo 2, se ajusta al cambiar el tamaño, se pausa con la pestaña oculta y con `prefers-reduced-motion` se queda quieta.
- Favicon de la marca y pie de copyright según CLAUDE.md 2.16.

---

## 7. Fases de desarrollo

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Renombrar la carpeta a `code_formatter`, estructura de carpetas (con el favicon y el pie de copyright), `index.html` estático con entrada, opciones, resultado y estado de ejemplo, `css/styles.css` responsive y README | Hecha |
| 2 | Limpieza común, detección de lenguaje y formateador de CSS (`js/formatters.js`) con su prueba de valores conocidos, y la pantalla en vivo (`js/main.js`): entrada, lenguaje, modo, sangría, resultado y avisos con "Ir a la línea". Se adelantaron de la fase 4 el tope de 2 MB y el límite de 20.000 líneas mostradas | Hecha |
| 3 | Formateadores de HTML y SQL con sus pruebas, la casilla de mayúsculas (solo visible con SQL) y los dos lenguajes de vuelta en la lista | Hecha |
| 4 | Estadísticas, Copiar, Descargar (con la extensión del lenguaje), Limpiar, valores recordados y animación 3D de fondo (`js/animations.js`); con Copiar y Descargar, el aviso del resultado demasiado largo pasa a decir que se puede copiar o descargar completo | Hecha |
| 5 | Cierre: checklist de CLAUDE.md 2.11, tarjeta en el portal, fila en CLAUDE.md 2.12, prueba en celular y en GitHub Pages | Hecha |

---

## 8. Estructura de archivos del proyecto

```
code_formatter/
├── index.html
├── README.md
├── PLAN.md                  # Este documento
├── css/
│   └── styles.css
├── js/
│   ├── main.js              # Pantalla: entrada, opciones, resultado, estado, copiar, descargar y memoria
│   ├── formatters.js        # Limpieza común, detección y los formateadores de CSS, HTML y SQL
│   └── animations.js        # Símbolos 3D de fondo
└── assets/
    └── icons/
        └── favicon.ico      # Favicon de la marca (CLAUDE.md 2.16)
```

`formatters.js` es un archivo de lógica importado desde `main.js`, como permite CLAUDE.md 2.5. Si crece demasiado, se parte en `css_formatter.js`, `html_formatter.js` y `sql_formatter.js`, siempre importados desde `main.js`.

---

## 9. Ejecución local

Desde esta carpeta, `python ../dev_server.py` y abrir http://localhost:8080 (ver CLAUDE.md 2.8).

---

## 10. Riesgos y cómo se manejan

| Riesgo | Manejo |
|---|---|
| El formateador cambia el contenido (una cadena, un atributo, un comentario) | Tokenizadores que tratan cadenas y comentarios como bloques intocables, y pruebas de ida y vuelta: minificar lo formateado devuelve el original compacto |
| HTML con etiquetas que el formateador no conoce (componentes, SVG interno) | Las desconocidas se tratan como de bloque si están solas en su línea en la entrada y como de línea si están junto a texto; los atributos nunca se tocan |
| SQL de un dialecto con palabras clave que no están en la lista | Solo cambia la caja de las que conoce; las demás salen como entraron. Se pueden agregar a la lista en un solo lugar |
| Alguien espera que se formatee JavaScript | La lista de lenguajes no lo ofrece, y el texto de la página lo dice; con Detectar cae en Texto, que solo limpia espacios |
| Un texto muy grande congela el celular | Tope de 2 MB, espera de 150 ms al escribir, y tokenizadores de una sola pasada |
| El portapapeles no funciona (http sin https) | Se selecciona el resultado y se avisa para copiar a mano. En GitHub Pages hay https |
| El 3D pesa en un equipo lento | Pocas piezas, tope de cuadros, y la página funciona sin 3D |

---

## 11. Cierre: checklist de CLAUDE.md 2.11

Revisión técnica hecha con la aplicación corriendo, servida desde el portal en una subcarpeta (`/code_formatter/`), como quedará en GitHub Pages.

| Punto | Estado |
|---|---|
| Estructura como en 2.5 | Cumple: `index.html`, `README.md`, `css/styles.css`, `js/main.js`, `js/animations.js` y `assets/icons/favicon.ico`. Sin `config.js` (no usa Supabase) y sin `lottie/` ni `img/` (no los necesita). Además de `main.js` y `animations.js` lleva `js/formatters.js` (detección y los cuatro formateadores), que 2.5 permite al dividir la lógica, y este `PLAN.md` |
| `README.md` con título, descripción y ejecución local | Cumple, con el comando `python ../dev_server.py` |
| 360 px hasta escritorio | Cumple: sin desplazamiento horizontal desde 320 hasta 1920 px, ni vacío, ni con resultado, ni con aviso. En 1366×768 y 1920×950 la página entera cabe sin desplazarse vertical (ver la tabla de abajo) |
| Teclado y foco visible | Cumple: Tab recorre el enlace de salto, Limpiar, entrada, "Ir a la línea" (si hay aviso), modo, lenguaje, sangría, mayúsculas (con SQL), resultado, Copiar y Descargar (los desactivados se saltan); las flechas, Inicio y Fin cambian de modo saltándose Minificado cuando está desactivado; Espacio marca la casilla. Todos los controles tienen contorno cian de 3 px y nombre accesible, sin ids repetidos ni referencias rotas; el modo usa `role="tablist"`, `tab` y `tabpanel`, y el estado y los avisos de copiar, descargar y limpiar se anuncian con `role="status"` |
| Sin errores en la consola | Cumple: limpia al cargar y al usar, y también con Three.js caído, con el almacenamiento bloqueado y con datos guardados dañados (se descarta cada campo malo por separado) |
| Rutas relativas con `./` | Cumple. Ninguna ruta absoluta; probado servido desde `/code_formatter/` y abierto desde la tarjeta del portal |
| Librerías por CDN y versiones de 2.3 | Cumple: Font Awesome 6.7.2 y Three.js 0.170.0 (con importmap). No se carga Lottie porque no se usa. Three.js se importa con `import()` dentro de `animations.js` para que su caída no rompa el formateador |
| `prefers-reduced-motion` y pausa con pestaña oculta | Cumple por construcción: `animations.js` es el mismo de `json_formatter` con otros símbolos y color (quieto con movimiento reducido, bucle cancelado con la pestaña oculta, 30 cuadros por segundo como máximo, `pixelRatio` máximo 2). En el navegador de pruebas la ventana está oculta, así que el dibujo en sí no se pudo mirar: solo se comprobó que la escena se crea, el lienzo toma el tamaño de la ventana y el contexto no se pierde |
| `localStorage` con prefijo y `try/catch` | Cumple: una sola clave, `code_formatter_last`, con lectura y escritura dentro de `try/catch`. El texto solo se guarda si pesa 200 KB o menos (comprobado con 351 KB: no se guarda) y Limpiar lo borra |
| Código en inglés, comentarios en español, snake_case | Cumple. Sin `console.*`, TODO, `eval` ni `innerHTML`. Sin constantes, funciones ni importaciones sin uso (se dejó de exportar `clean_text`, que solo usa `formatters.js`). Los tres módulos pasan `node --check` |
| Favicon y copyright (2.16) | Cumple: `assets/icons/favicon.ico` enlazado en el `<head>` (responde 200 servido desde la subcarpeta) y pie `© 2026 Andres Felipe Olaya - Dev Layer` al final de la tarjeta |
| Agregado al portal | Cumple: tarjeta en el `index.html` de la raíz (abre `./code_formatter/`), fila nueva en la tabla 2.12 de CLAUDE.md y carpeta en el árbol de 2.4 (que también recibió `json_formatter`, que faltaba) |
| Una persona sin contexto lo entiende | Una sola pantalla con un cuadro para pegar y otro con el resultado, que aparece solo; el estado dice "Listo · CSS" o el aviso con su línea y un botón que lleva hasta ella; los botones desactivados dejan claro cuándo hay algo que copiar; un texto arriba explica que nada sale del navegador |

### Cuánto hay que desplazarse (píxeles extra de alto de la página)

Medido con la entrada vacía, con un CSS corto y con un aviso (llave sin cerrar). En pantallas anchas la página tampoco se desplaza con un resultado largo: el cuadro llega a su máximo y el contenido se mueve dentro de él.

| Pantalla | Vacío | CSS corto | Con aviso |
|---|---|---|---|
| 320×640 | 450 | 492 | 566 |
| 360×740 | 466 | 393 | 466 |
| 768×1024 | 148 | 98 | 148 |
| 1366×768 | 0 | 0 | 0 |
| 1920×950 | 0 | 0 | 0 |

Con SQL, la casilla de mayúsculas suma una fila de opciones en pantallas anchas. Los cuadros ceden ese alto y en 1366×768, 1440×900 y 1920×950 la página sigue cabiendo; en pantallas más bajas hay un desplazamiento pequeño (6 px en 1280×720 y 22 px en 1100×700).

Además:
- **Exactitud:** los formateadores pasan los valores de comprobación de 4.6 y unas 190 comprobaciones más (134 de CSS y Texto, 60 de HTML y SQL, y 40 muestras de uso real que se formatean y minifican dos veces sin cambiar). Formatear lo ya formateado no cambia nada en ningún lenguaje, y quitando los espacios el SQL sin comentarios sale igual que entró.
- **Velocidad:** 3,8 MB de CSS se formatean en 0,45 s, 1,5 MB de HTML en 0,3 s y 2,3 MB de SQL en 1,3 s. Un HTML o SQL con miles de niveles anidados se devuelve sin cambios con un aviso, en vez de fallar.
- **Contraste de colores (WCAG AA):** todos los textos superan 4,5 a 1 (el más bajo, el texto atenuado sobre la pestaña, da 6,3). El foco, los bordes de los controles y el acento superan 3 a 1 (el más bajo, el borde de los controles sobre la tarjeta, da 4,0).
- **Límites:** 2 MB de entrada (por encima, un aviso y Copiar y Descargar desactivados) y 20.000 líneas mostradas; por encima, un aviso, con Copiar y Descargar entregando el resultado completo.
- **Sin secretos ni datos personales:** el proyecto no usa claves, servidores ni cuentas. Nada de lo que se pega sale del navegador.

### Pruebas que solo se pueden hacer a mano
1. En **uno o dos celulares** (uno con iPhone si es posible): pegar CSS, HTML y SQL desde el menú del teléfono, mirar que el teclado no tape los cuadros, usar **Ir a la línea**, cambiar de modo y tocar **Copiar** y pegar en otra aplicación. Mirar que el fondo se vea fluido.
2. **Copiar y descargar de verdad:** comprobar que **Copiar** deja el resultado en el portapapeles (en el navegador de pruebas el portapapeles no se pudo usar y entró el aviso "Copia a mano") y que **Descargar** guarda `resultado.css`, `.html`, `.sql` o `.txt` donde esperas.
3. En **GitHub Pages**, tras publicar: abrir `https://<usuario>.github.io/projects/code_formatter/` y comprobar que carga sin errores, con iconos y fondo, y que Copiar funciona (el portapapeles solo funciona con https). Si se ve una versión vieja, recargar con Ctrl y F5.
4. Activar "reducir movimiento" en el sistema y comprobar que el fondo queda quieto, y mirar el fondo a simple vista en un monitor (símbolos ámbar tenues detrás de la tarjeta, sin tapar el texto).
5. **Comparar con código real tuyo:** pegar una hoja de estilos, una página y una consulta que uses, formatearlas y compararlas con otra herramienta; el contenido debe ser idéntico salvo los espacios (y las mayúsculas de las palabras clave de SQL).
6. Probar con un archivo de más de 1 MB en el celular: debe responder en pocos segundos o avisar que el resultado es demasiado largo para mostrarlo.
