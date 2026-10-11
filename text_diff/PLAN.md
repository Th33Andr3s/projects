# Plan de trabajo: Comparador de textos (`text_diff`)

Documento de planificación del proyecto. Se rige por las reglas de [CLAUDE.md](../CLAUDE.md). Cada fase termina con una revisión en el navegador y la aprobación de la persona dueña antes de pasar a la siguiente.

---

## 1. Qué es este proyecto

Una página para pegar dos textos y ver en qué se diferencian: qué líneas se quitaron, cuáles se agregaron y, dentro de una línea cambiada, qué palabras son distintas. Pensada para quien tiene dos versiones de un contrato, un correo, una configuración, un listado o un trozo de código y necesita saber qué cambió sin leerlo todo dos veces, desde el computador o el celular. Es la tercera herramienta de texto del repositorio, con la misma pantalla y la misma forma de trabajar que el Formateador de JSON y el Formateador de código.

Funciona así:

1. **Pegar el texto de antes** en el cuadro de la izquierda y **el de después** en el de la derecha (o abrir un archivo en cada uno).
2. **Ver las diferencias al instante**, debajo: las líneas quitadas en rojo con un `−`, las agregadas en verde con un `+`, y las palabras que cambiaron dentro de una línea resaltadas. Se puede ver todo seguido (vista unificada) o las dos versiones una al lado de la otra, y esconder lo que no cambió.
3. **Saltar de cambio en cambio** con dos botones, y **copiar o descargar** el resultado en formato `diff` estándar, el que entienden Git y los editores de código.

**No usa servidor ni cuentas.** Nada de lo que se pega sale del navegador. Lo único que se recuerda en el equipo son las opciones y los dos últimos textos (si no son muy grandes).

### Qué no es

- **No es un editor de fusión (merge).** Muestra las diferencias; no deja elegir trozos de uno y de otro para armar un tercer texto. Eso exigiría un editor en vivo con tres paneles, que es otro proyecto.
- **No compara carpetas, imágenes ni archivos binarios.** Solo texto. Un archivo que no sea texto se abre como caracteres sin sentido y el resultado no sirve.
- **No aplica parches ni se conecta con Git.** El `diff` que produce se puede pegar donde se quiera, pero la página no lee repositorios ni aplica cambios a archivos.
- **No resalta la sintaxis** de ningún lenguaje: lo que se compara es texto, venga de donde venga.

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Stack | HTML, CSS, JS vanilla, Three.js, Font Awesome. Todo por CDN según CLAUDE.md 2.3. Sin Lottie |
| Datos | Ninguno en servidor. Las opciones y los dos textos en `localStorage` |
| Unidad de comparación | **Líneas.** Es lo que la gente espera de un comparador y lo que entiende el formato `diff`. Dentro de cada par de líneas que cambió se comparan además las **palabras**, para resaltar solo lo distinto (sección 4.3) |
| Algoritmo | El de **Myers** (el mismo de Git y de la mayoría de editores): da la lista de cambios más corta y es rápido en textos parecidos, que es el caso normal. Escrito a mano en `js/diff_tools.js`, sin librerías, en una sola función para líneas y para palabras |
| Regla de oro | **Lo que se muestra es el texto tal cual.** Las opciones de ignorar espacios o mayúsculas solo cambian cómo se decide si dos líneas son iguales; en pantalla y en el `diff` descargado las líneas salen exactamente como se escribieron |
| Vistas | **Unificada** (una sola columna con `−` y `+`, como en Git) y **Lado a lado** (antes a la izquierda, después a la derecha, con las líneas emparejadas), con dos botones tipo pestaña. En pantallas angostas la primera vez se abre Unificada, que se lee mejor; la elección se recuerda |
| Solo cambios | Casilla que esconde las líneas iguales, dejando tres de contexto alrededor de cada cambio y un renglón plegado "12 líneas iguales" que se despliega con un toque |
| Opciones de comparación | **Ignorar espacios** (al inicio y al final de la línea, y varios seguidos cuentan como uno) e **Ignorar mayúsculas**. Las dos apagadas por defecto |
| Navegación | Botones **Anterior** y **Siguiente** con el contador "Cambio 2 de 7". Llevan el cambio a la vista y lo marcan |
| Entradas | Cada cuadro tiene su botón **Abrir archivo** (se lee en el navegador, no se sube a ningún lado) y entre los dos hay **Intercambiar**, que cambia uno por otro. Botón **Limpiar** que vacía los dos |
| Resultado en vivo | Se recalcula 200 ms después de dejar de escribir en cualquiera de los dos cuadros. Hasta 1 MB y 20.000 líneas por cuadro; hasta 5.000 renglones dibujados (más allá, un aviso que recomienda "Solo cambios", Copiar o Descargar, que entregan el resultado completo) |
| Copiar y descargar | **Copiar** copia el `diff` en formato unificado estándar (sección 4.6); si el navegador no deja, lo muestra en un cuadro seleccionado y avisa. **Descargar** guarda `diferencias.diff` |
| Estadísticas | Bajo las opciones: "3 cambios · +5 líneas · −2 líneas · 40 iguales", o "Los dos textos son iguales" en verde (y "iguales salvo espacios" o "salvo mayúsculas" si solo las opciones los igualan) |
| Estética | La misma de los dos formateadores (tarjeta oscura, cuadros monoespaciados, pestañas), con acento azul para distinguirlo. El verde y el rojo quedan reservados para agregado y quitado, y nunca son la única señal: siempre van con `+`, `−` y texto para lectores de pantalla. Animación 3D sutil de fondo |
| Idioma | Interfaz en español. Los nombres de archivo del `diff` son `antes` y `después`, sin tilde (`despues`), para que no den problemas en ninguna herramienta |

---

## 3. Pantalla

Todo vive en un solo `index.html`, en una sola pantalla.

### 3.1 Entradas
- Dos **cuadros de texto** monoespaciados, **Antes** y **Después**, lado a lado en pantallas anchas y uno sobre otro en el celular. Cada uno crece con el contenido hasta un máximo y luego se desplaza. Cada cuadro tiene su botón **Abrir archivo** en el encabezado.
- Entre los dos, el botón **Intercambiar** (icono de flechas), y arriba a la derecha, **Limpiar**.
- Debajo de las entradas, el **estado en vivo**: "Los dos textos son iguales" en verde, o las estadísticas de los cambios ("3 cambios · +5 líneas · −2 líneas · 40 iguales"), o un aviso en el color de atención (texto demasiado grande, archivo que no se pudo leer). Con los dos cuadros vacíos no se muestra nada; con uno solo lleno, el resultado es ese texto entero agregado o quitado.

### 3.2 Opciones
- **Vista:** Unificada / Lado a lado (botones con `role="tab"`).
- **Casillas:** Solo cambios, Ignorar espacios, Ignorar mayúsculas.
- **Navegación:** Anterior, "Cambio 2 de 7", Siguiente. Desactivados cuando no hay cambios.

### 3.3 Resultado
- Una **tabla** de solo lectura, monoespaciada, con los números de línea de cada versión, una columna con `−`, `+` o nada, y el texto. Las líneas quitadas van sobre fondo rojizo, las agregadas sobre fondo verdoso y, dentro de un par de líneas cambiadas, las palabras distintas con un resaltado más fuerte. En la vista lado a lado cada renglón tiene las dos versiones; una línea que solo existe en una de ellas deja la otra celda vacía y rayada.
- Las líneas largas se parten para que nunca haya desplazamiento horizontal, salvo en la vista lado a lado en el celular, donde la tabla se desplaza por dentro.
- Los renglones plegados de "Solo cambios" son botones: "12 líneas iguales · Mostrar".
- Debajo, los botones **Copiar** y **Descargar**, desactivados cuando no hay resultado.

### 3.4 Comportamiento común
- Lo que se recuerda va en `localStorage` con la clave `text_diff_last`, en `try/catch`: vista, las tres casillas y los dos textos si cada uno pesa 200 KB o menos. Si el almacenamiento falla, la página funciona igual.
- Teclado: Tab recorre Limpiar, Abrir archivo y cuadro de Antes, Intercambiar, Abrir archivo y cuadro de Después, vista, casillas, Anterior y Siguiente, los renglones plegados, Copiar y Descargar; en la vista, las flechas, Inicio y Fin cambian de pestaña. Dentro de los cuadros Tab sigue siendo la tecla para moverse. Siguiente y Anterior llevan el foco al cambio, así el lector de pantalla lo lee. Foco siempre visible.
- Copiar y Descargar: el botón dice "Copiado" dos segundos; se avisa a lectores de pantalla. Abrir archivo e Intercambiar también se anuncian.
- Sin `console.log` ni errores en consola.

---

## 4. Cómo se compara

Toda la lógica vive en `js/diff_tools.js` como funciones puras, sin tocar la pantalla, para probarlas con valores conocidos. La función principal recibe los dos textos y las opciones y devuelve la lista de cambios (sección 4.4); otras funciones la convierten en renglones para cada vista y en el `diff` de texto.

### 4.1 Preparación
- Saltos `\r\n` y `\r` pasan a `\n`. Se parte por `\n`. Un salto de línea final no crea una línea vacía de más, pero se recuerda si cada texto termina con salto o no. Para la pantalla, que uno termine con salto y el otro no, no es un cambio (el estado dice "iguales salvo el salto de línea final"); para el formato `diff`, en cambio, esa última línea sí va como quitada y agregada, con la marca `\ No newline at end of file`, porque así lo exigen las herramientas que aplican parches.
- Cada línea tiene una **clave de comparación**: la línea tal cual, o, con **Ignorar espacios**, recortada y con los espacios y tabulaciones seguidos reducidos a uno; con **Ignorar mayúsculas**, en minúscula. Dos líneas son iguales si sus claves lo son. Lo que se muestra es siempre la línea original.
- Las claves se cambian por números (la misma clave, el mismo número) para que comparar dos líneas sea comparar dos enteros y el algoritmo corra rápido.

### 4.2 Diferencias entre líneas (algoritmo de Myers)
- Primero se quitan las líneas iguales del principio y del final, que suelen ser la mayoría; el algoritmo solo trabaja con lo del medio.
- Myers busca el camino más corto que convierte el texto de antes en el de después, avanzando en diagonal por las líneas iguales. Devuelve una lista de operaciones en orden: **igual**, **quitada** o **agregada**, cada una con sus números de línea en antes y en después.
- Su costo crece con el número de diferencias. Para que un par de textos muy distintos (por ejemplo, dos archivos que no tienen nada que ver) no congele el celular, hay un tope de **3.000 pasos de edición** (líneas quitadas más agregadas; la memoria crece con su cuadrado, unos 18 MB con 3.000). Si se supera, se buscan las líneas que aparecen **una sola vez en cada texto y en el mismo orden** (la idea del diff "patience"): son puntos fijos que parten el problema en tramos pequeños, cada uno resuelto por su cuenta, así que un archivo con miles de cambios repartidos se compara bien (aunque no siempre por el camino más corto). Si ni así hay forma (no hay ningún punto fijo, como en dos archivos que no tienen nada que ver), lo que queda del medio se muestra como un solo bloque quitado y otro agregado, y un aviso lo dice ("Los textos son tan distintos que no se alinearon línea por línea"). Medido en la fase 2: 20.000 líneas por lado con 200 cambios se comparan en 30 ms, y 12.000 líneas con 6.000 cambios, en 170 ms.
- Cuando una línea quitada va seguida de una agregada, Myers a veces alinea mal una línea vacía o un cierre de llave. Después del algoritmo, los bloques de cambio se deslizan hacia abajo mientras la primera línea del bloque sea igual a la que le sigue (la "regla de deslizar" de Git), que es lo que hace que el resultado se vea natural.

### 4.3 Diferencias dentro de una línea
- Un bloque de líneas quitadas seguido de uno de agregadas es una **modificación**. Se emparejan la primera quitada con la primera agregada, la segunda con la segunda, y así hasta que se acaba el bloque más corto; las sobrantes quedan como quitadas o agregadas sueltas.
- Cada par se compara por **palabras**: la línea se parte en trozos de palabra (letras, números y guion bajo), de puntuación (cada signo por separado) y de espacios, y se corre el mismo Myers sobre esos trozos. Las partes quitadas se resaltan en la línea de antes y las agregadas en la de después.
- Si las dos líneas se parecen poco, el resaltado por palabras sería un confeti sin sentido: el par se muestra como una línea quitada y otra agregada enteras, sin resaltado interno. El parecido es la parte de las letras y números que están en trozos iguales respecto a la línea más larga (los signos y los espacios no cuentan, porque casi todas las líneas de código los comparten); menos del 40 % es "se parecen poco". Si una línea no tiene ni una letra ni un número (`});`), cuentan los signos. Una línea de más de 2.000 caracteres no se compara por palabras, y entre todas las líneas de una comparación hay un tope de 400.000 trozos, para que un archivo con miles de líneas largas modificadas no se trabe.
- Las opciones de ignorar espacios y mayúsculas también aplican aquí, al comparar trozos.

### 4.4 Lista de cambios
El resultado del comparador es una lista de **renglones**, en orden, cada uno de un tipo:
- `equal`: una línea que está en los dos textos, con su número en cada uno.
- `removed` / `added`: una línea que solo está en uno.
- `modified`: un par de líneas emparejadas, con sus trozos resaltados.

Y, aparte, los **cambios**: cada grupo de renglones seguidos que no son `equal` es un cambio, numerado desde 1. Es lo que recorren Anterior y Siguiente y lo que cuentan las estadísticas. Las dos vistas y el `diff` de texto se construyen a partir de la misma lista, para que nunca cuenten cosas distintas.

### 4.5 Solo cambios
Con la casilla marcada, de cada tramo de renglones `equal` se dejan los tres primeros y los tres últimos (si el tramo está al inicio o al final del texto, solo los tres que tocan al cambio) y el resto se pliega en un renglón "N líneas iguales · Mostrar". Un tramo de seis o menos líneas no se pliega, porque no se ahorra nada. Al desplegar, el tramo se muestra entero hasta que se recalcule el resultado.

### 4.6 Formato `diff` unificado (Copiar y Descargar)
El estándar que leen Git, GitHub y los editores:

```
--- antes
+++ despues
@@ -3,4 +3,5 @@
 línea igual
-línea quitada
+línea agregada
 línea igual
```

- Cada bloque `@@` (hunk) lleva tres líneas de contexto a cada lado, y dos cambios con seis líneas iguales o menos entre ellos van en el mismo bloque, como hace `git diff`.
- Las líneas van precedidas de un espacio, `-` o `+`. Si un texto no termina con salto de línea, tras su última línea va `\ No newline at end of file`.
- Las modificaciones (4.3) salen como sus líneas quitadas seguidas de las agregadas; el formato `diff` no tiene resaltado por palabras.
- Si los textos son iguales, lo que se copia es la cabecera sola, sin bloques, y el estado ya lo decía.

### 4.7 Valores de comprobación
La fase 2 corre una prueba automática con estos casos, calculados aparte:
- `a\nb\nc` contra `a\nc\nd` → renglones: `a` igual (1 → 1), `b` quitada (2), `c` igual (3 → 2), `d` agregada (→ 3). Un solo cambio con `b`, y otro con `d`: 2 cambios, +1, −1, 2 iguales.
- `hola mundo` contra `hola mundo cruel` → una modificación, con ` cruel` resaltado como agregado y nada quitado.
- `El gato come` contra `El perro come` → una modificación con `gato` quitado y `perro` agregado; los espacios y `El` y `come` sin resaltar.
- `x = 1;` contra `y = 2;` → se parecen poco (ninguna de sus palabras, `x` y `1` contra `y` y `2`, es igual: 0 %): se muestra como quitada y agregada enteras, sin resaltado interno.
- Textos iguales → sin cambios, estado "Los dos textos son iguales". `Hola` contra `hola` → distintos; con Ignorar mayúsculas, "iguales salvo mayúsculas". `a  b ` contra `a b` → distintos; con Ignorar espacios, "iguales salvo espacios".
- Vacío contra `a\nb` → 2 líneas agregadas, un cambio. `a\nb` contra vacío → 2 quitadas.
- `a\n` contra `a` → la misma línea `a` igual y el estado "iguales salvo el salto de línea final"; el `diff` de texto la lleva como `-a`, `+a` y la marca `\ No newline at end of file` solo en el lado de después.
- Regla de deslizar: `f() {\n}\n` contra `f() {\n}\ng() {\n}\n` → el cambio agregado es `g() {` y `}`, no `}` y `g() {`.
- `diff` de texto para `a\nb\nc\nd\ne\nf\ng\nh` contra `a\nb\nc\nd\nE\nf\ng\nh` → un solo bloque `@@ -2,7 +2,7 @@` con `b c d` de contexto, `-e`, `+E` y `f g h`.
- Tope de edición: dos textos de 3.000 líneas sin ninguna en común terminan en menos de un segundo, con el aviso de que no se alinearon. Dos textos de 12.000 líneas con 6.000 cambios repartidos (más de 3.000 ediciones) se alinean con puntos fijos, sin aviso.
- Propiedades, con 400 pares de textos al azar: los renglones de iguales y quitados reconstruyen el texto de antes y los de iguales y agregados, el de después; el número de ediciones es el mínimo posible (el largo de los dos textos menos el doble de su subsecuencia común más larga); los números de línea salen completos y en orden; aplicar el `diff` generado al texto de antes da el de después; y plegar y desplegar no pierde renglones.
- Tiempo: dos textos de 20.000 líneas con 200 cambios repartidos se comparan en menos de un segundo.

---

## 5. Cómo se muestran los números
- Contadores con punto de miles si pasan de 999 ("1.250 líneas iguales"), y en singular cuando toca ("1 cambio", "+1 línea").
- Tamaños, en los avisos de límite, con una cifra decimal y coma ("1,0 MB").
- Los números de línea de la tabla se cuentan desde 1, como en los editores, y cada versión tiene los suyos.

---

## 6. Diseño visual y animación

- Fondo oscuro neutro con acento azul (`#60a5fa`) para la pestaña activa y los botones principales. Las líneas quitadas van sobre un rojo oscuro y las agregadas sobre un verde oscuro, con el texto claro encima y los trozos resaltados en un tono más intenso del mismo color; todo con contraste de al menos 4,5 a 1 en los textos (WCAG AA). El contorno de foco es ámbar, para no confundirse con el azul ni con el verde y el rojo.
- Tarjeta de hasta 720 px de ancho; a partir de 1100 px, 1200 px, con los dos cuadros de entrada lado a lado y el resultado debajo a todo el ancho. Cuadros monoespaciados de 16 px y tabla de 14 px (las líneas largas se parten, y así caben más caracteres por renglón). Las palabras distintas dentro de una línea van además subrayadas, para que no dependan solo del color.
- El color nunca es la única señal: cada renglón quitado o agregado lleva su `−` o `+` en una columna y un texto solo para lectores de pantalla ("quitada", "agregada"); los trozos resaltados van en `<del>` y `<ins>`, que los lectores anuncian.
- **Animación 3D (Three.js):** signos `+` y `−` translúcidos, azules, que flotan y giran despacio detrás de la tarjeta y hacen un leve destello cuando el resultado pasa de "iguales" a "distintos" (o al revés) y al copiar. Decorativa: la página funciona igual si no carga. Three.js se importa con `import()` dentro de `animations.js`, como en las otras herramientas.
- Según CLAUDE.md 2.10: `requestAnimationFrame`, tope de 30 cuadros por segundo, `pixelRatio` máximo 2, se ajusta al cambiar el tamaño, se pausa con la pestaña oculta y con `prefers-reduced-motion` se queda quieta.
- Favicon de la marca y pie de copyright según CLAUDE.md 2.16.

---

## 7. Fases de desarrollo

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Estructura de carpetas (con el favicon y el pie de copyright), `index.html` estático con las dos entradas, las opciones, una tabla de resultado de ejemplo en las dos vistas y el estado, `css/styles.css` responsive y README | Hecha |
| 2 | `js/diff_tools.js`: preparación con las opciones de ignorar, Myers para líneas y para palabras, regla de deslizar, tope de edición, emparejamiento de modificaciones y lista de cambios, con su prueba de valores conocidos y de tiempos. `js/main.js`: entradas en vivo, vista unificada, estado con las estadísticas, límites de tamaño | Hecha |
| 3 | Vista lado a lado, Solo cambios con los renglones plegados, Anterior y Siguiente, Intercambiar, Abrir archivo y el tope de 5.000 renglones dibujados | Hecha |
| 4 | Copiar y Descargar en formato `diff` unificado, Limpiar, valores recordados y animación 3D de fondo (`js/animations.js`) | Hecha |
| 5 | Cierre: checklist de CLAUDE.md 2.11, tarjeta en el portal, fila en CLAUDE.md 2.12, prueba en celular y en GitHub Pages | Hecha |

---

## 8. Estructura de archivos del proyecto

Según CLAUDE.md 2.5:

```
text_diff/
├── index.html             # Única página
├── README.md              # Título, descripción y ejecución local
├── PLAN.md                # Este documento
├── css/
│   └── styles.css         # Todos los estilos
├── js/
│   ├── main.js            # Pantalla: entradas, opciones, tabla de resultado, navegación, copiar, descargar, memoria
│   ├── diff_tools.js      # Comparador: preparación, Myers, modificaciones, lista de cambios y formato diff. Funciones puras
│   └── animations.js      # Fondo 3D con Three.js
└── assets/
    └── icons/
        └── favicon.ico    # Favicon de la marca (CLAUDE.md 2.16)
```

Sin `config.js` (no usa Supabase) y sin `lottie/` ni `img/` (no los necesita). `diff_tools.js` es la división de `main.js` que permite 2.5: toda la lógica que se puede probar sin pantalla va ahí.

---

## 9. Ejecución local

Desde esta carpeta, `python ../dev_server.py` y abrir http://localhost:8080 (ver CLAUDE.md 2.8).

---

## 10. Riesgos y cómo se manejan

| Riesgo | Manejo |
|---|---|
| Dos textos muy distintos hacen que Myers tarde demasiado | Líneas convertidas a números, recorte de lo igual al inicio y al final, y tope de 3.000 pasos de edición; pasado el tope, puntos fijos (líneas únicas en ambos textos) parten el problema, y si no los hay el resto se muestra como un bloque quitado y otro agregado, con aviso. Tiempos medidos en la fase 2 |
| Una tabla de miles de renglones frena el navegador | Tope de 5.000 renglones dibujados; "Solo cambios" pliega lo igual; Copiar y Descargar entregan el resultado completo aunque no se dibuje |
| El resaltado por palabras confunde en líneas que no se parecen | Umbral del 40 % de parecido: por debajo, las líneas salen enteras como quitada y agregada |
| Un cambio se alinea de forma "correcta" pero poco natural (una llave de cierre en el lugar equivocado) | Regla de deslizar después del algoritmo, igual que Git |
| Alguien abre un archivo que no es texto o pesa demasiado | Se lee como texto hasta el límite de 1 MB; pasado, un aviso y no se carga. Si el archivo parece binario (tiene caracteres nulos), un aviso lo dice |
| Alguien daltónico no distingue el rojo del verde | Signos `−` y `+` en su columna, texto para lectores de pantalla y tonos de fondo con distinto brillo |
| El portapapeles no funciona (http sin https) | Se muestra el `diff` seleccionado en un cuadro y se avisa para copiar a mano. En GitHub Pages hay https |
| El 3D pesa en un equipo lento | Pocas piezas, tope de cuadros, y la página funciona sin 3D |

---

## 11. Cierre: checklist de CLAUDE.md 2.11

Revisión técnica hecha con la aplicación corriendo, servida desde el portal en una subcarpeta (`/text_diff/`), como quedará en GitHub Pages.

| Punto | Estado |
|---|---|
| Estructura como en 2.5 | Cumple: `index.html`, `README.md`, `css/styles.css`, `js/main.js`, `js/animations.js` y `assets/icons/favicon.ico`. Sin `config.js` (no usa Supabase) y sin `lottie/` ni `img/` (no los necesita). Además de `main.js` y `animations.js` lleva `js/diff_tools.js` (comparador, plegado y formato diff), que 2.5 permite al dividir la lógica, y este `PLAN.md` |
| `README.md` con título, descripción y ejecución local | Cumple, con el comando `python ../dev_server.py` |
| 360 px hasta escritorio | Cumple: sin desplazamiento horizontal desde 320 hasta 1920 px, en las dos vistas, vacío, con un ejemplo y con una línea de 400 caracteres sin espacios. En Lado a lado en celular la tabla se desplaza por dentro de su marco (y entra en el orden de Tab solo en ese caso); la página no |
| Teclado y foco visible | Cumple: Tab recorre enlace de salto, Limpiar, Abrir archivo y cuadro de Antes, Intercambiar, Abrir archivo y cuadro de Después, vista, las tres casillas, Anterior, Siguiente, los pliegues, Copiar y Descargar (los desactivados se saltan); las flechas, Inicio y Fin cambian de vista. Siguiente y Anterior llevan el foco al renglón del cambio (con el contorno ámbar de 3 px, comprobado con una tecla real) y dan la vuelta al llegar al final. Todos los controles tienen nombre accesible, sin ids repetidos ni referencias rotas; la vista usa `role="tablist"`, `tab` y `tabpanel`, la tabla lleva encabezados y cada renglón quitado o agregado dice "quitada" o "agregada" para lectores de pantalla (con "Cambio N" en el primero de cada cambio), y los avisos de copiar, descargar, intercambiar, limpiar y abrir archivos se anuncian con `role="status"` |
| Sin errores en la consola | Cumple: limpia al cargar y al usar, y también con Three.js caído, con el almacenamiento bloqueado y con datos guardados dañados (JSON roto, tipos equivocados: se descarta cada campo malo por separado) |
| Rutas relativas con `./` | Cumple. Ninguna ruta absoluta; probado servido desde `/text_diff/` y abierto desde la tarjeta del portal |
| Librerías por CDN y versiones de 2.3 | Cumple: Font Awesome 6.7.2 y Three.js 0.170.0 (con importmap). No se carga Lottie porque no se usa. Three.js se importa con `import()` dentro de `animations.js` para que su caída no rompa el comparador |
| `prefers-reduced-motion` y pausa con pestaña oculta | Cumple por construcción: `animations.js` es el mismo de los otros formateadores con otros símbolos y color (quieto con movimiento reducido, bucle cancelado con la pestaña oculta, 30 cuadros por segundo como máximo, `pixelRatio` máximo 2). En el navegador de pruebas la ventana está oculta, así que el dibujo en sí no se pudo mirar: solo se comprobó que la escena se crea, el lienzo toma el tamaño de la ventana y el contexto no se pierde |
| `localStorage` con prefijo y `try/catch` | Cumple: una sola clave, `text_diff_last`, con lectura y escritura dentro de `try/catch`. Cada texto solo se guarda si pesa 200 KB o menos |
| Código en inglés, comentarios en español, snake_case | Cumple. Sin `console.*`, TODO, `eval` ni `innerHTML` (todo el texto entra con `textContent`, así que lo pegado nunca se interpreta como HTML). Sin constantes, funciones, exportaciones ni ids sin uso. Los tres módulos pasan `node --check` |
| Favicon y copyright (2.16) | Cumple: `assets/icons/favicon.ico` enlazado en el `<head>` (responde 200 servido desde la subcarpeta) y pie `© 2026 Andres Felipe Olaya - Dev Layer` al final de la tarjeta |
| Agregado al portal | Cumple: tarjeta en el `index.html` de la raíz (abre `./text_diff/`), fila nueva en la tabla 2.12 de CLAUDE.md y carpeta en el árbol de 2.4 |
| Una persona sin contexto lo entiende | Dos cuadros rotulados "Antes" y "Después" con un texto de ayuda en cada uno, el resultado aparece solo debajo, el estado dice en palabras cuántos cambios hay o que los textos son iguales, y los botones desactivados dejan claro cuándo hay algo que copiar; un texto arriba explica que nada sale del navegador |

### Cuánto hay que desplazarse (píxeles extra de alto de la página)

Medido con los dos cuadros vacíos y con un ejemplo de 8 líneas con dos cambios (la tabla crece con el resultado, así que en celular y tableta la página se desplaza siempre; en pantallas anchas casi no).

| Pantalla | Vacío | Ejemplo, unificada | Ejemplo, lado a lado |
|---|---|---|---|
| 320×640 | 636 | 904 | 835 |
| 360×740 | 488 | 719 | 687 |
| 390×844 | 388 | 656 | 587 |
| 768×1024 | 188 | 398 | 350 |
| 1366×768 | 4 | 214 | 166 |
| 1920×950 | 0 | 76 | 28 |

Además:
- **Exactitud:** 2.781 comprobaciones automáticas. Pasan los valores de 4.7 y las propiedades de los 400 pares al azar (reconstrucción de los dos textos, número mínimo de ediciones, numeración, parche aplicable y plegado sin pérdida), también con más de 3.000 ediciones y con líneas repetidas y desordenadas.
- **Velocidad (Node):** 20.000 líneas por lado con 200 cambios, 30 ms; con inserciones y borrados repartidos, 26 ms; 12.000 líneas con 6.000 cambios, 170 ms; 3.000 líneas largas modificadas (400 caracteres), 0,4 s; 5.000 pares muy distintos de 1.300 caracteres, 0,4 s; dos textos de 20.000 líneas sin nada en común, 0,2 s. En el navegador, dibujar 5.000 renglones tarda menos de dos segundos.
- **Contraste de colores (WCAG AA):** todos los textos superan 4,5 a 1 (el más bajo, el texto sobre una palabra agregada, da 5,6); el foco, los bordes de los controles y el acento superan 3 a 1 (el más bajo, el borde de los controles sobre la tarjeta, da 4,0). Las palabras resaltadas dentro de una línea contrastan poco con el fondo de la línea (1,9 y 2,1 a 1), por eso van además subrayadas y dentro de `<del>` e `<ins>`.
- **Límites:** 1 MB y 20.000 líneas por cuadro (probados con 1 MB más 5 bytes, 20.001 líneas y justo 20.000); un archivo de más de 1 MB o con caracteres nulos no se abre y avisa; la tabla dibuja hasta 5.000 renglones y avisa, con Copiar y Descargar entregando el diff completo (24.004 líneas en la prueba con 12.000).
- **Archivos:** abrir un archivo de texto en cada cuadro funciona y se anuncia; el mismo archivo se puede abrir otra vez.
- **Sin secretos ni datos personales:** el proyecto no usa claves, servidores ni cuentas. Nada de lo que se pega ni de los archivos que se abren sale del navegador.

### Pruebas que solo se pueden hacer a mano
1. En **uno o dos celulares** (uno con iPhone si es posible): pegar dos textos desde el menú del teléfono, mirar que el teclado no tape los cuadros, abrir un archivo desde el selector de archivos, recorrer los cambios con Anterior y Siguiente (que la página baje hasta cada uno y el contador acompañe), cambiar entre las dos vistas y tocar **Copiar** y pegar en otra aplicación. Mirar que el fondo se vea fluido.
2. **Copiar y descargar de verdad:** comprobar que **Copiar** deja el diff en el portapapeles (en el navegador de pruebas el portapapeles no se pudo usar y entró el cuadro "Diff para copiar a mano") y que **Descargar** guarda `diferencias.diff` donde esperas. Aplicar ese archivo con `git apply` o `patch` a una copia del texto de antes y comprobar que da el de después.
3. En **GitHub Pages**, tras publicar: abrir `https://<usuario>.github.io/projects/text_diff/` y comprobar que carga sin errores, con iconos y fondo, y que Copiar funciona (el portapapeles solo funciona con https). Si se ve una versión vieja, recargar con Ctrl y F5.
4. Activar "reducir movimiento" en el sistema y comprobar que el fondo queda quieto, y mirar el fondo a simple vista en un monitor (signos `+` y `−` azules tenues detrás de la tarjeta, sin tapar el texto). Mirar también con calma los colores de lo quitado y lo agregado, y las palabras subrayadas, sobre tu pantalla.
5. **Comparar con textos reales tuyos:** dos versiones de un documento, de un archivo de configuración o de un trozo de código, y compararlas con otra herramienta (por ejemplo `git diff --no-index`); los cambios deben ser los mismos, salvo que el orden de un bloque movido puede variar.
6. Probar con dos archivos de casi 1 MB en el celular: debe responder en pocos segundos o avisar que la tabla se muestra solo en parte.
