# Plan de trabajo: Generador aleatorio (`random_generator`)

Documento de planificación del proyecto. Se rige por las reglas de [CLAUDE.md](../CLAUDE.md). Cada fase termina con una revisión en el navegador y la aprobación de la persona dueña antes de pasar a la siguiente.

---

## 1. Qué es este proyecto

Una página para dejar algo al azar de forma justa y rápida: sacar números en un rango, elegir a alguien de una lista, mezclar una lista o repartirla en equipos, y tirar dados o una moneda. Pensada para quien hace una rifa en la oficina, decide quién empieza un juego, arma los equipos de un partido, sortea un turno o necesita unos números al azar para una prueba, desde el computador o el celular, con un resultado grande que se pueda mostrar a los demás.

Funciona así:

1. **Elegir qué sortear** en una de tres pestañas: **Números**, **Lista** o **Dados y moneda**.
2. **Tocar el botón grande.** El resultado aparece en letras grandes, con una pequeña animación de "tirada", y se va guardando un historial de las últimas tiradas por si alguien pregunta "¿quién salió antes?".
3. **Copiar** el resultado o el historial.

**No usa servidor ni cuentas.** Nada sale del navegador. Lo único que se recuerda en el equipo son las opciones y la lista escrita, para no tener que pegarla otra vez.

### Qué no es

- **No genera contraseñas:** para eso está `password_generator`, que ya lo hace bien y con indicador de fuerza.
- **No es una herramienta de estadística ni de simulación.** Da números enteros, elecciones y tiradas; no distribuciones, decimales con tantas cifras ni muestras de millones.
- **No guarda ganadores en ningún lado** más allá del historial de la sesión en pantalla. Si una rifa necesita constancia, se copia el historial y se pega donde corresponda.
- **No es un juego de azar con dinero.** Es una moneda y unos dados, no una ruleta ni un casino.

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Stack | HTML, CSS, JS vanilla, Three.js, Font Awesome. Todo por CDN según CLAUDE.md 2.3. Sin Lottie |
| Datos | Ninguno en servidor. Las opciones, la lista y el historial de la sesión en `localStorage` |
| Fuente de azar | `crypto.getRandomValues`, la misma del generador de contraseñas: azar de verdad del sistema, no `Math.random`. Los números en un rango se sacan por **rechazo** (se descartan los valores que harían que unos salieran más que otros), así todos tienen exactamente la misma probabilidad. Toda la lógica de azar recibe la fuente como parámetro, para probarla con una fuente fija |
| Pestañas | **Números** (un rango, cuántos, sin repetir, ordenados), **Lista** (elegir uno o varios, mezclar, repartir en equipos) y **Dados y moneda** (de 1 a 10 dados de 4, 6, 8, 10, 12, 20 o 100 caras, y de 1 a 10 monedas). Son los tres usos que cubren casi todo lo que la gente sortea; lo que no cabe ahí se resuelve con una lista |
| Resultado | Grande, centrado y legible desde lejos (para mostrarlo en una reunión). Con varios resultados, uno al lado del otro; con equipos, una columna por equipo. Una animación breve de "tirada" (los valores cambian unas décimas de segundo antes de quedarse quietos), que se omite con `prefers-reduced-motion` |
| Historial | Las últimas 50 tiradas de la sesión, con su hora y lo que se hizo ("14:05 · Lista · Ana", "14:06 · Equipos · Equipo 1: Ana, Luis / Equipo 2: Sara", "14:07 · Dados · 4 + 6 = 10", "14:08 · Moneda · Cara"); el texto de cada tirada se acorta a 300 caracteres si es larguísimo (por ejemplo, 1.000 números). Se guarda en el equipo para que sobreviva a una recarga por accidente en mitad de una rifa. Botones Copiar historial y Borrar historial |
| Lista | Un cuadro de texto, un elemento por línea (también se aceptan separados por coma o punto y coma si no hay saltos de línea). Las líneas vacías y los espacios de los bordes se ignoran; los repetidos se conservan, porque alguien puede tener dos boletas. Casilla **Quitar de la lista a quien salga** para rifas con varios premios: al elegir, el elegido desaparece del cuadro |
| Equipos | De 2 a 20 equipos. Se mezcla la lista y se reparte en orden, de modo que los tamaños difieren a lo sumo en uno. Si hay menos personas que equipos, se avisa |
| Números | Mínimo y máximo enteros (pueden ser negativos), entre −1.000.000.000 y 1.000.000.000; cantidad de 1 a 1.000; **Sin repetir** (marcada por defecto, y solo si el rango alcanza: si se piden 10 sin repetir entre 1 y 5, se avisa) y **Ordenar de menor a mayor** |
| Copiar | El resultado como texto ("7, 23, 41"; "Equipo 1: Ana, Luis / Equipo 2: …"); si el navegador no deja, se selecciona y se avisa. El historial se copia como una línea por tirada |
| Estética | La misma familia que las otras herramientas (tarjeta oscura, pestañas, botones grandes), con acento verde esmeralda para distinguirla. Animación 3D sutil de fondo con dados que giran despacio |
| Idioma | Interfaz en español. La moneda muestra **Cara** y **Sello**, como se dice en Colombia |

---

## 3. Pantalla

Todo vive en un solo `index.html`, en una sola pantalla.

### 3.1 Pestañas
Tres botones con `role="tab"`: **Números**, **Lista**, **Dados y moneda**. Cada una muestra sus opciones y comparte el resultado y el historial de abajo.

### 3.2 Opciones de cada pestaña
- **Números:** campos Mínimo (1 por defecto) y Máximo (100), Cantidad (1); casillas Sin repetir (marcada) y Ordenar de menor a mayor (sin marcar). Botón grande **Sacar número** (o "Sacar números" si la cantidad es más de uno).
- **Lista:** cuadro de texto ("Escribe un nombre por línea"), debajo el contador "12 elementos". Campo Cuántos elegir (1) y casilla Quitar de la lista a quien salga. Tres botones: **Elegir**, **Mezclar** y **Repartir en equipos** (con un campo Equipos, 2 por defecto, al lado).
- **Dados y moneda:** campo Dados (1) y lista Caras (6); botón **Tirar dados**. Campo Monedas (1); botón **Lanzar moneda**.

### 3.3 Resultado
- Un recuadro grande con el resultado en letras grandes: un número, varios números separados, un nombre o varios, la lista mezclada numerada, los equipos en columnas, los dados con su suma ("4 + 6 = 10") o las monedas ("Cara, Sello, Cara").
- Debajo, el botón **Copiar** y una línea pequeña con qué se hizo ("Entre 1 y 100, sin repetir").
- Antes de la primera tirada el recuadro muestra un texto atenuado ("Aquí aparece el resultado").

### 3.4 Historial
- Un `<details>` plegado, "Historial (12)", con las tiradas de la sesión de la más reciente a la más vieja: hora, pestaña y resultado. Botones **Copiar historial** y **Borrar historial**.

### 3.5 Comportamiento común
- Lo que se recuerda va en `localStorage` con la clave `random_generator_last`, en `try/catch`: pestaña activa, todos los campos y casillas, el texto de la lista (si pesa 50 KB o menos) y el historial. Si el almacenamiento falla, la página funciona igual.
- Teclado: Tab recorre pestañas, campos, casillas, botones de acción, Copiar, el historial y sus botones; en las pestañas, las flechas, Inicio y Fin cambian de pestaña; Enter en un campo dispara la acción principal de su pestaña. Foco siempre visible.
- Al tirar, el resultado se anuncia a lectores de pantalla una vez terminada la animación. Copiar dice "Copiado" dos segundos.
- Los avisos (rango vacío, lista vacía, más elegidos que elementos) salen debajo de las opciones en el color de atención y no borran el resultado anterior.
- Sin `console.log` ni errores en consola.

---

## 4. Cómo se sortea

Toda la lógica vive en `js/random_tools.js` como funciones puras que reciben la **fuente de azar** como parámetro (una función que devuelve un entero al azar entre 0 y un máximo, excluido), para probarlas con una fuente fija y para que `main.js` les pase la de `crypto`.

### 4.1 Fuente de azar
- `random_below(limit)`: entero entre 0 y `limit − 1` con la misma probabilidad para cada uno. Se piden 32 bits a `crypto.getRandomValues`; si el valor cae en el "sobrante" que haría el reparto desigual (los últimos `2^32 mod limit` valores), se descarta y se pide otro. Para `limit` hasta 2.000.000.001 (el rango máximo de Números) el descarte ocurre menos de la mitad de las veces, así que no se nota.
- Si `crypto.getRandomValues` no existe (navegador muy viejo), se avisa en pantalla y no se sortea. No se cae a `Math.random` sin decirlo.

### 4.2 Números
- `random_integers(minimum, maximum, count, { unique, sorted }, random_below)`: cada número es `minimum + random_below(maximum − minimum + 1)`.
- Sin repetir: si el rango tiene 2.000 valores o menos, se construye la lista del rango, se mezcla (4.3) y se toman los primeros, así nunca se queda dando vueltas aunque se pida el rango entero; con rangos más grandes la cantidad (máximo 1.000) es siempre menos de la mitad del rango, y se van sacando y descartando los repetidos.
- Validación antes de sortear: mínimo y máximo enteros dentro de los límites, mínimo no mayor que máximo (si lo es, se intercambian solos), cantidad de 1 a 1.000, y con Sin repetir la cantidad no mayor que el tamaño del rango.

### 4.3 Lista
- `parse_list(text)`: parte por saltos de línea; si no hay ninguno y sí comas o puntos y coma, parte por esos. Recorta espacios y descarta vacíos. Conserva repetidos.
- `shuffle(items, random_below)`: mezcla de Fisher-Yates (desde el final, cada elemento se intercambia con uno al azar entre los que quedan), que da todas las permutaciones con la misma probabilidad.
- Elegir N: se mezcla y se toman los primeros N, en el orden en que salieron.
- `split_into_teams(items, teams, random_below)`: se mezcla y se reparte en orden (el primero al equipo 1, el segundo al 2…). Los equipos quedan con tamaños que difieren a lo sumo en uno; los primeros son los que tienen uno más.
- Quitar al elegido: `main.js` elimina de la lista la primera aparición de cada elegido y vuelve a escribir el cuadro.

### 4.4 Dados y moneda
- `roll_dice(count, faces, random_below)`: cada dado es `1 + random_below(faces)`; se devuelve la lista y la suma.
- `flip_coins(count, random_below)`: cada moneda es `random_below(2)`, 0 = Cara, 1 = Sello.

### 4.5 Textos
- `format_result(result)`: números separados por coma y espacio; nombres igual; mezcla numerada "1. Ana"; equipos "Equipo 1: Ana, Luis"; dados "4 + 6 = 10" (un solo dado: "4"); monedas "Cara, Sello". Es lo que se muestra, se copia y va al historial.

### 4.6 Valores de comprobación
La fase 2 corre una prueba automática con una fuente fija (una lista de valores que se van devolviendo en orden) y otra estadística con la fuente real:
- Con una fuente que devuelve siempre 0: `random_integers(5, 9, 3, { unique: false })` → `[5, 5, 5]`; `roll_dice(2, 6)` → `[1, 1]`, suma 2; `flip_coins(3)` → `["Cara", "Cara", "Cara"]`; `shuffle(["a", "b", "c"])` → la permutación que sale de intercambiar cada posición con la 0: `["b", "c", "a"]`.
- Con la fuente real: 10.000 números entre 1 y 100 sin repetir en grupos de 100 → cada grupo es exactamente `1..100` ordenado; `random_integers(1, 1, 1)` → `[1]`; 1.000 sin repetir entre 1 y 1.000 → los mil, cada uno una vez.
- `parse_list("Ana\n\n Luis \nAna")` → `["Ana", "Luis", "Ana"]`; `parse_list("a, b; c")` → `["a", "b", "c"]`; `parse_list("a\nb, c")` → `["a", "b, c"]` (hay saltos de línea, así que la coma es parte del nombre).
- `split_into_teams` de 7 elementos en 3 equipos → tamaños `[3, 2, 2]`, y todos los elementos aparecen una sola vez; 2 elementos en 3 equipos → aviso.
- Validación: cantidad 10 sin repetir entre 1 y 5 → aviso "solo hay 5 números en el rango"; mínimo 20 y máximo 10 → se intercambian; `maximum − minimum + 1` igual a 2.000.000.001 funciona sin desbordar.
- Estadística (fuente real): 60.000 tiradas de un dado de 6 → cada cara sale entre 9.000 y 11.000 veces; 100.000 `random_below(3)` → cada valor entre 31.000 y 35.600; 20.000 mezclas de `["a", "b", "c"]` → cada una de las 6 permutaciones entre 2.900 y 3.800 veces. Se ejecuta con la fuente de Node (`crypto.getRandomValues` existe ahí también).
- `format_result` de dados `[4, 6]` → `"4 + 6 = 10"`; de un dado `[4]` → `"4"`; de equipos → `"Equipo 1: Ana, Luis\nEquipo 2: Sara"`.

---

## 5. Cómo se muestran los números
- Los números del resultado salen tal cual, sin puntos de miles, para que se puedan copiar y usar (un "1.250" podría leerse como decimal). El contador de elementos y el del historial sí llevan punto de miles si pasan de 999.
- La hora del historial en formato de 24 horas, "14:05".
- Los campos numéricos son `type="number"` con `inputmode="numeric"`, para que el celular muestre el teclado de números.

---

## 6. Diseño visual y animación

- Fondo oscuro neutro con acento verde esmeralda (`#34d399`) para la pestaña activa y los botones principales. El color de atención para los avisos. Contraste de al menos 4,5 a 1 en textos (WCAG AA). El contorno de foco es ámbar, para no confundirse con el verde.
- Tarjeta de hasta 640 px de ancho; el resultado en una letra de hasta 3 rem que se reduce en celular (`clamp`). Los equipos en una rejilla de columnas que se parten en una sola en pantallas angostas.
- **Animación de tirada:** durante unas 600 ms el recuadro muestra valores cambiando (números al azar, nombres de la lista, caras del dado) y luego el resultado de verdad. Se hace con `requestAnimationFrame` y se omite entera con `prefers-reduced-motion`. El botón queda desactivado mientras dura, y el resultado solo se anuncia y se guarda en el historial al terminar.
- **Animación 3D (Three.js):** dados translúcidos (cubos con sus puntos dibujados en una textura) que flotan y giran despacio detrás de la tarjeta y hacen un leve destello con cada tirada. Decorativa: la página funciona igual si no carga. Three.js se importa con `import()` dentro de `animations.js`, como en las otras herramientas.
- Según CLAUDE.md 2.10: `requestAnimationFrame`, tope de 30 cuadros por segundo, `pixelRatio` máximo 2, se ajusta al cambiar el tamaño, se pausa con la pestaña oculta y con `prefers-reduced-motion` se queda quieta.
- Favicon de la marca y pie de copyright según CLAUDE.md 2.16.

---

## 7. Fases de desarrollo

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Estructura de carpetas (con el favicon y el pie de copyright), `index.html` estático con las tres pestañas, sus opciones, un resultado de ejemplo y el historial, `css/styles.css` responsive y README | Hecha |
| 2 | `js/random_tools.js`: fuente de azar por rechazo, números, mezcla, equipos, dados, monedas, lista y textos, con su prueba de valores conocidos y estadística. `js/main.js`: pestañas, pestaña Números en vivo con validación y avisos, resultado y Copiar | Hecha |
| 3 | Pestañas Lista (elegir, mezclar, equipos, quitar al elegido, contador) y Dados y moneda; historial con Copiar y Borrar | Hecha |
| 4 | Animación de tirada, valores recordados y animación 3D de fondo (`js/animations.js`) | Hecha |
| 5 | Cierre: checklist de CLAUDE.md 2.11, tarjeta en el portal, fila en CLAUDE.md 2.12, prueba en celular y en GitHub Pages | Hecha |

---

## 8. Estructura de archivos del proyecto

Según CLAUDE.md 2.5:

```
random_generator/
├── index.html             # Única página
├── README.md              # Título, descripción y ejecución local
├── PLAN.md                # Este documento
├── css/
│   └── styles.css         # Todos los estilos
├── js/
│   ├── main.js            # Pantalla: pestañas, opciones, resultado, historial, copiar, memoria
│   ├── random_tools.js    # Azar: fuente por rechazo, números, mezcla, equipos, dados, monedas, lista y textos. Funciones puras
│   └── animations.js      # Fondo 3D con Three.js
└── assets/
    └── icons/
        └── favicon.ico    # Favicon de la marca (CLAUDE.md 2.16)
```

Sin `config.js` (no usa Supabase) y sin `lottie/` ni `img/` (no los necesita). `random_tools.js` es la división de `main.js` que permite 2.5: toda la lógica que se puede probar sin pantalla va ahí.

---

## 9. Ejecución local

Desde esta carpeta, `python ../dev_server.py` y abrir http://localhost:8080 (ver CLAUDE.md 2.8).

---

## 10. Riesgos y cómo se manejan

| Riesgo | Manejo |
|---|---|
| Unos números salen más que otros (sesgo del módulo) | Fuente por rechazo sobre 32 bits y prueba estadística automática en la fase 2 |
| Pedir muchos números sin repetir en un rango justo (1.000 de 1.000) se queda dando vueltas | Si la cantidad pasa de la mitad del rango se mezcla el rango entero en vez de sacar y descartar |
| Un rango enorme (mil millones) con Sin repetir y mezcla del rango entero agotaría la memoria | La mezcla del rango entero solo se usa cuando el rango tiene como mucho 2.000 valores; con rangos grandes la cantidad (máximo 1.000) siempre es pequeña respecto al rango y se saca y descarta |
| Alguien pega una lista con comas dentro de los nombres | Solo se parte por comas cuando no hay ningún salto de línea; con saltos, la coma es parte del nombre. El contador de elementos deja ver enseguida cuántos entendió la página |
| Se recarga la página en mitad de una rifa y se pierde quién salió | El historial se guarda en el equipo y vuelve al recargar; la lista también (con los elegidos ya quitados, si se marcó esa casilla) |
| La animación de tirada confunde a un lector de pantalla o marea | Se anuncia solo el resultado final; con movimiento reducido no hay animación |
| El 3D pesa en un equipo lento | Pocas piezas, tope de cuadros, y la página funciona sin 3D |

---

## 11. Cierre: checklist de CLAUDE.md 2.11

Revisión técnica hecha con la aplicación corriendo, servida desde el portal en una subcarpeta (`/random_generator/`), como quedará en GitHub Pages.

| Punto | Estado |
|---|---|
| Estructura como en 2.5 | Cumple: `index.html`, `README.md`, `css/styles.css`, `js/main.js`, `js/animations.js` y `assets/icons/favicon.ico`. Sin `config.js` (no usa Supabase) y sin `lottie/` ni `img/` (no los necesita). Además de `main.js` y `animations.js` lleva `js/random_tools.js` (fuente de azar, números, lista, dados, monedas y textos), que 2.5 permite al dividir la lógica, y este `PLAN.md` |
| `README.md` con título, descripción y ejecución local | Cumple, con el comando `python ../dev_server.py` |
| 360 px hasta escritorio | Cumple: sin desplazamiento horizontal desde 320 hasta 1920 px, en las tres pestañas, con 1 resultado, con 300 números, con equipos de nombres larguísimos (80 letras sin espacios), con 10 dados y con el historial abierto. En 1366×768 y 1920×950 la página cabe entera sin desplazarse con un número, dos dados o la pestaña vacía (ver la tabla de abajo) |
| Teclado y foco visible | Cumple: Tab recorre enlace de salto, pestaña activa, campos, casillas, botones de la pestaña, Copiar (si hay resultado) y el historial con sus botones; las flechas, Inicio y Fin cambian de pestaña; Enter en un campo dispara la acción principal de su pestaña. Todos los controles tienen contorno ámbar de 3 px y nombre accesible, sin ids repetidos ni referencias rotas; las pestañas usan `role="tablist"`, `tab` y `tabpanel`, el aviso de opciones usa `role="alert"`, y el resultado final, copiar y borrar el historial se anuncian con `role="status"` (durante la animación el texto que cambia va con `aria-hidden`) |
| Sin errores en la consola | Cumple: limpia al cargar y al usar, y también con Three.js caído, con el almacenamiento bloqueado, con datos guardados dañados (JSON roto, tipos equivocados, números en vez de texto: se descarta cada campo malo por separado) y con movimiento reducido |
| Rutas relativas con `./` | Cumple. Ninguna ruta absoluta; probado servido desde `/random_generator/` y abierto desde la tarjeta del portal |
| Librerías por CDN y versiones de 2.3 | Cumple: Font Awesome 6.7.2 y Three.js 0.170.0 (con importmap). No se carga Lottie porque no se usa. Three.js se importa con `import()` dentro de `animations.js` para que su caída no rompa el generador |
| `prefers-reduced-motion` y pausa con pestaña oculta | Cumple por construcción en el fondo: mismo esquema de `animations.js` de las otras herramientas (quieto con movimiento reducido, bucle cancelado con la pestaña oculta, 30 cuadros por segundo como máximo, `pixelRatio` máximo 2). La animación de tirada se omite con movimiento reducido (comprobado simulando la preferencia: el resultado aparece al instante). En el navegador de pruebas la ventana está oculta, así que no se pudo mirar el dibujo de los dados ni la animación de tirada; solo se comprobó que la escena se crea, el lienzo toma el tamaño de la ventana y el contexto no se pierde |
| `localStorage` con prefijo y `try/catch` | Cumple: una sola clave, `random_generator_last`, con lectura y escritura dentro de `try/catch`. La lista solo se guarda si pesa 50 KB o menos (una de 20.000 líneas no se guarda) y el historial se limita a 50 tiradas |
| Código en inglés, comentarios en español, snake_case | Cumple. Sin `console.*`, TODO, `eval` ni `innerHTML` (todo el texto entra con `textContent`). `Math.random` solo aparece en los valores de adorno de la animación y está dicho en un comentario; el resultado sale siempre de `crypto`. Sin constantes, funciones ni ids sin uso. Los tres módulos pasan la revisión de sintaxis |
| Favicon y copyright (2.16) | Cumple: `assets/icons/favicon.ico` enlazado en el `<head>` (responde 200 servido desde la subcarpeta) y pie `© 2026 Andres Felipe Olaya - Dev Layer` al final de la tarjeta |
| Agregado al portal | Cumple: tarjeta en el `index.html` de la raíz (abre `./random_generator/`), fila nueva en la tabla 2.12 de CLAUDE.md y carpeta en el árbol de 2.4 |
| Una persona sin contexto lo entiende | Tres pestañas con nombres claros, cada una con un botón grande que dice qué hace ("Sacar número", "Elegir", "Tirar dados"), el resultado en letras grandes debajo, un texto atenuado antes de la primera tirada, los avisos en palabras ("Sin repetir, en ese rango solo hay 10 números…") y un texto arriba que explica que nada sale del navegador |

### Cuánto hay que desplazarse (píxeles extra de alto de la página)

Medido con la pestaña Números vacía, con un número, con el reparto de 4 personas en 2 equipos y con 2 dados.

| Pantalla | Números vacío | Un número | Equipos | Dos dados |
|---|---|---|---|---|
| 320×640 | 249 | 278 | 623 | 274 |
| 360×740 | 150 | 179 | 490 | 180 |
| 390×844 | 36 | 66 | 376 | 70 |
| 768×1024 | 0 | 0 | 107 | 0 |
| 1366×768 | 0 | 0 | 302 | 142 |
| 1920×950 | 0 | 0 | 181 | 4 |

Además:
- **Azar:** 56 comprobaciones automáticas, entre ellas las de 4.6. Con la fuente real (`crypto`): 60.000 tiradas de un dado de 6 dan cada cara entre 9.000 y 11.000 veces; 100.000 sorteos entre 3 valores, entre 31.000 y 35.600; 20.000 mezclas de tres elementos dan las 6 permutaciones entre 2.900 y 3.800 veces cada una; 70.000 sorteos entre 7 valores (un límite que no divide a 2³²) quedan entre 9.400 y 10.600; 40.000 monedas, entre 19.000 y 21.000 caras; y con el límite máximo (2.000.000.001) la mitad inferior sale entre 19.000 y 21.000 de 40.000. El rechazo se probó con una fuente falsa: un valor del sobrante se descarta y se pide otro, y el último valor aceptado se acepta. En el navegador, 20 sacadas seguidas de 1 a 100 salieron repartidas (87, 78, 11, 47, 87, 86…).
- **Rangos:** 1 a 1.000 sin repetir en 1.000 números da el rango entero; 1.000 números sin repetir entre 1 y mil millones dan 1.000 distintos; el rango máximo de −1.000.000.000 a 1.000.000.000 funciona sin desbordar.
- **Velocidad:** 200 sorteos de 1.000 números sin repetir, 0,5 s en total; mezclar 100.000 elementos, 0,25 s; repartir 20.000 personas en 5 equipos, 0,3 s en el navegador; dibujar 1.000 números, menos de 0,2 s.
- **Contraste de colores (WCAG AA):** todos los textos superan 4,5 a 1 (el más bajo, el texto atenuado sobre las fichas, da 6,3). El foco, los bordes de los controles y el acento superan 3 a 1 (el más bajo, el borde de los controles sobre la tarjeta, da 4,0).
- **Sin secretos ni datos personales:** el proyecto no usa claves, servidores ni cuentas. Nada de lo que se escribe sale del navegador. La lista de nombres, si la hay, queda solo en el equipo (si pesa 50 KB o menos).

### Pruebas que solo se pueden hacer a mano
1. En **uno o dos celulares** (uno con iPhone si es posible): usar las tres pestañas con el teclado del teléfono (que los campos de número muestren el teclado numérico y que el teclado no tape el botón), pegar una lista de nombres, elegir, mezclar y repartir en equipos, tirar dados y moneda, y tocar **Copiar** y pegar en otra aplicación. Mirar que la animación de tirada y el fondo se vean fluidos.
2. **Mirar el fondo y la animación a simple vista** en un monitor: dados verdes translúcidos que flotan detrás de la tarjeta, sin tapar el texto, con un destello en cada tirada, y la animación de tirada (valores que cambian unas décimas de segundo antes de quedarse quietos).
3. **Copiar de verdad:** comprobar que **Copiar** y **Copiar historial** dejan el texto en el portapapeles (en el navegador de pruebas el portapapeles no se pudo usar y entró el aviso "Copia a mano" y "No se pudo copiar").
4. En **GitHub Pages**, tras publicar: abrir `https://<usuario>.github.io/projects/random_generator/` y comprobar que carga sin errores, con iconos y fondo, y que Copiar funciona (el portapapeles solo funciona con https). Si se ve una versión vieja, recargar con Ctrl y F5.
5. Activar "reducir movimiento" en el sistema y comprobar que el fondo queda quieto y que las tiradas muestran el resultado al instante.
6. **Una rifa de verdad:** pegar una lista de participantes, marcar "Quitar de la lista a quien salga", elegir uno por uno, recargar la página a mitad y comprobar que la lista (sin los ya elegidos) y el historial siguen ahí.
