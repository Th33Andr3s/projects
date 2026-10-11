# Plan de trabajo: Generador de códigos QR y de barras (`generator_barcodes_qr`)

Documento de planificación del proyecto. Se rige por las reglas de [CLAUDE.md](../CLAUDE.md). Cada fase termina con una revisión en el navegador y la aprobación de la persona dueña antes de pasar a la siguiente.

---

## 1. Qué es este proyecto

Una página para crear un código QR o un código de barras en segundos y llevárselo como imagen: se escribe el texto, el enlace o el número, el código aparece al instante y se descarga en SVG o PNG, se copia o se imprime. Pensada para quien pone el menú de su negocio en un QR, comparte la clave del Wi‑Fi de la casa o la oficina, deja su contacto en una tarjeta, etiqueta productos o cajas con un código de barras, o necesita una hoja con varios códigos para pegar en el inventario, desde el computador o el celular.

Funciona así:

1. **Elegir qué crear** en una de dos pestañas: **QR** o **Código de barras**.
2. **Escribir el contenido.** El código se dibuja solo mientras se escribe, grande y nítido, con un aviso claro si algo no sirve ("un EAN‑13 lleva 12 o 13 dígitos").
3. **Descargar** en SVG o PNG, **Copiar** la imagen o **Imprimir**. Con varios contenidos a la vez, una hoja lista para imprimir con un código por etiqueta.

**No usa servidor ni cuentas.** Nada sale del navegador: el QR se calcula en el equipo, no se envía a ningún servicio para generarlo. Lo único que se recuerda en el equipo son las opciones y el último contenido corto.

### Qué no es

- **No lee códigos.** No usa la cámara ni decodifica imágenes. Solo genera.
- **No acorta enlaces ni cuenta escaneos.** Un QR de esta página es el texto tal cual; no hay un servicio en medio que pueda caerse o cobrar después.
- **No pone logos ni colores dentro del QR.** Los códigos salen en negro sobre blanco, que es lo que cualquier lector lee a la primera. Un QR con dibujos encima se lee peor y no aporta nada a quien escanea.
- **No asigna códigos de barras comerciales.** Un EAN‑13 o UPC‑A para vender en una cadena lo asigna GS1 (en Colombia, GS1 Colombia); esta página solo dibuja el número que ya se tiene o uno interno para uso propio.

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Stack | HTML, CSS, JS vanilla, Three.js, Font Awesome. Todo por CDN según CLAUDE.md 2.3. Sin Lottie |
| Codificación | **Codificadores propios**, sin librerías: CLAUDE.md 2.2 prohíbe librerías de utilidades adicionales. El QR se codifica completo en `js/qr_encoder.js` (modos numérico, alfanumérico y bytes UTF‑8, versiones 1 a 40, cuatro niveles de corrección, Reed‑Solomon, las 8 máscaras con su penalización, información de formato y de versión). Los códigos de barras, por tablas, en `js/barcode_encoder.js`. Es el bloque de trabajo más grande del proyecto y se prueba contra valores conocidos (sección 4.6) |
| Datos | Ninguno en servidor. Las opciones y el último contenido (si pesa 2 KB o menos) en `localStorage` |
| Pestaña QR | Un selector **Tipo de contenido**: **Texto o enlace** (por defecto), **Wi‑Fi** (nombre de red, clave, seguridad WPA/WEP/abierta, red oculta), **Contacto** (nombre, teléfono, correo, empresa, cargo, sitio web; se arma una vCard 3.0) y **WhatsApp** (número y mensaje opcional; se arma el enlace `https://wa.me/`). Cada tipo muestra sus campos y todos terminan en un texto que se codifica igual. Opciones: **Corrección de errores** L/M/Q/H (M por defecto, que es lo habitual) y **Tamaño** de la imagen |
| Pestaña Código de barras | Un selector **Tipo**: **Code 128** (por defecto: acepta letras, números y símbolos, y elige solo el subconjunto más compacto), **EAN‑13**, **EAN‑8**, **UPC‑A**, **Code 39** e **ITF‑14**. Para EAN, UPC e ITF el dígito de control se calcula solo si se escriben todos los dígitos menos uno, y se comprueba si se escriben todos. Opciones: **Mostrar el texto debajo** (marcada), **Alto** de las barras y **Tamaño** |
| Resultado | El código se dibuja como **SVG** en pantalla, nítido a cualquier tamaño, con su zona de silencio (4 módulos en QR; 11 y 7 en EAN‑13; 7 en EAN‑8; 9 en UPC‑A; 10 en los demás). Siempre negro sobre blanco. Se redibuja al escribir, con una espera de 150 ms para no calcular en cada tecla |
| Descargar y copiar | **SVG** (el mismo que se ve) y **PNG** (se dibuja en un `<canvas>` al tamaño elegido: 256, 512, 1024 o 2048 px de lado para QR, y ese ancho para barras) con nombre `qr_<contenido-corto>.svg` o `barcode_<tipo>_<numero>.png`. **Copiar** pone el PNG en el portapapeles (`ClipboardItem`; solo funciona con https o localhost; si no se puede, se avisa y se ofrece Descargar). **Imprimir** abre el diálogo del navegador con una hoja de impresión limpia (`@media print`) |
| Varios a la vez | Un `<details>` **Varios a la vez** en cada pestaña: un cuadro de texto con un contenido por línea (hasta 200). Se dibujan en una rejilla de etiquetas con su texto debajo y el botón **Imprimir hoja**. Las líneas que no sirven se marcan en la rejilla y no detienen a las demás. No hay descarga en ZIP (necesitaría una librería); la hoja impresa o guardada como PDF desde el navegador es el camino |
| Límites | QR: hasta 2.953 bytes en UTF‑8 (versión 40‑L); si no cabe en el nivel elegido, se avisa con cuántos bytes sobran y se sugiere bajar la corrección. Code 128 y Code 39: hasta 80 caracteres (más largo no lo leen bien los escáneres de mano). Wi‑Fi y vCard escapan `\`, `;`, `,` y `:` como manda cada formato |
| Estética | La misma familia que las otras herramientas (tarjeta oscura, pestañas, botones grandes), con acento índigo para distinguirla. El código va sobre un recuadro blanco siempre, aunque el tema sea oscuro. Animación 3D sutil de fondo con módulos de QR que flotan |
| Idioma | Interfaz en español. Nombres de los tipos como los conoce la gente: "Code 128", "EAN‑13", "Wi‑Fi", "WhatsApp" |

---

## 3. Pantalla

Todo vive en un solo `index.html`, en una sola pantalla.

### 3.1 Pestañas
Dos botones con `role="tab"`: **QR** y **Código de barras**. Cada una muestra sus campos y comparte el recuadro de resultado y los botones de abajo.

### 3.2 Pestaña QR
- Selector **Tipo de contenido** (botones de radio con aspecto de fichas): Texto o enlace, Wi‑Fi, Contacto, WhatsApp.
- **Texto o enlace:** un cuadro de texto de varias líneas ("Escribe un texto o pega un enlace"), con contador "34 caracteres · versión 3‑M" debajo.
- **Wi‑Fi:** Nombre de la red, Clave (con botón para verla), Seguridad (WPA/WPA2 por defecto, WEP, Sin clave) y casilla Red oculta.
- **Contacto:** Nombre, Apellido, Teléfono, Correo, Empresa, Cargo, Sitio web. Solo el nombre es obligatorio.
- **WhatsApp:** Número con indicativo (57 por defecto, Colombia) y Mensaje opcional.
- Opciones: **Corrección de errores** (L 7 %, M 15 %, Q 25 %, H 30 %) y **Tamaño** de la imagen.

### 3.3 Pestaña Código de barras
- Selector **Tipo**: Code 128, EAN‑13, EAN‑8, UPC‑A, Code 39, ITF‑14.
- Un campo de texto con una pista según el tipo ("12 o 13 dígitos", "letras mayúsculas, números y - . $ / + % espacio").
- Opciones: casilla **Mostrar el texto debajo**, **Alto** de las barras (corto, normal, alto) y **Tamaño**.
- Debajo del campo, en gris, el valor que se va a codificar con el dígito de control ya calculado ("770200400350**8**").

### 3.4 Resultado
- Un recuadro blanco con el código en SVG, centrado, de hasta 320 px de lado en escritorio y el ancho de la tarjeta en celular. Antes de escribir algo muestra un QR de ejemplo atenuado con el texto "Escribe algo para generar tu código".
- Debajo, una línea pequeña con qué se generó ("QR · 34 bytes · versión 3 · corrección M" o "EAN‑13 · 7702004003508").
- Botones: **Descargar SVG**, **Descargar PNG**, **Copiar** e **Imprimir**.

### 3.5 Varios a la vez
- Un `<details>` plegado, "Varios a la vez", con un cuadro de texto (un contenido por línea), el contador "12 códigos (1 con error)" y el botón **Imprimir hoja**. La rejilla se dibuja debajo, con el texto de cada uno y las líneas malas marcadas con su motivo.

### 3.6 Comportamiento común
- Lo que se recuerda va en `localStorage` con la clave `generator_barcodes_qr_last`, en `try/catch`: pestaña activa, tipo de contenido, tipo de barras, opciones y el último contenido de Texto o enlace y de barras si pesa 2 KB o menos. **La clave del Wi‑Fi y los datos de contacto no se guardan**, porque son datos sensibles y la página no debe dejarlos en un equipo compartido. Si el almacenamiento falla, la página funciona igual.
- Teclado: Tab recorre pestañas, fichas de tipo, campos, opciones, botones y el bloque de varios; en las pestañas y en las fichas, las flechas, Inicio y Fin cambian de opción; Escape cierra la vista previa del campo de clave. Foco siempre visible.
- Cada código generado se anuncia a lectores de pantalla una vez ("Código listo: QR de 34 bytes"), y el SVG lleva `role="img"` con un `aria-label` que describe el contenido sin repetirlo si es una clave.
- Los avisos (dígito de control equivocado, carácter no permitido, texto que no cabe) salen debajo del campo en el color de atención y dejan el último código válido en pantalla, atenuado.
- Sin `console.log` ni errores en consola.

---

## 4. Cómo se codifica

Toda la lógica vive en funciones puras, sin tocar la pantalla, para probarla con valores conocidos:

- `js/qr_encoder.js`: de un texto a una matriz de módulos (`true` = negro).
- `js/barcode_encoder.js`: de un texto a una lista de barras y espacios con su ancho en módulos, más el texto legible.
- `js/code_renderer.js`: de una matriz o de una lista de barras a un dibujo neutro (rectángulos y textos en módulos) y de ahí a un SVG o a un PNG (vía `<canvas>`). La hoja de impresión de "Varios a la vez" la arma `main.js` con esos mismos SVG y la hoja de estilos.

### 4.1 QR
1. **Modo:** numérico si todo son dígitos, alfanumérico si todo está en los 45 caracteres de ese modo (mayúsculas, dígitos, espacio y `$ % * + - . / :`), y bytes (UTF‑8) en cualquier otro caso. No se usa ECI: los lectores actuales asumen UTF‑8 y así los QR salen más cortos.
2. **Versión:** la menor (1 a 40) cuya capacidad para ese modo y nivel alcance, según la tabla de capacidades del estándar.
3. **Datos:** indicador de modo (4 bits), contador de caracteres (su largo depende de la versión), los datos empaquetados según el modo, terminador, relleno a byte y los bytes de relleno `0xEC` y `0x11` alternados hasta llenar.
4. **Corrección:** los datos se parten en bloques según la tabla de versión y nivel; a cada bloque se le calculan sus códigos Reed‑Solomon en GF(256) con el polinomio `0x11D`, con el generador del grado que pide el bloque. Luego se intercalan datos y códigos como manda el estándar.
5. **Matriz:** patrones de búsqueda, separadores, patrones de alineación (según la versión), líneas de sincronía, módulo oscuro, reservas de formato y versión; los bits se colocan en zigzag de dos columnas de derecha a izquierda saltando las zonas reservadas.
6. **Máscara:** se prueban las 8 máscaras, se calcula la penalización con las cuatro reglas (corridas, bloques 2×2, patrones parecidos al de búsqueda y proporción de oscuros) y se elige la de menor puntaje.
7. **Formato y versión:** 15 bits de formato (nivel y máscara) con su código BCH y la máscara `0x5412`, escritos en los dos lugares; para versiones 7 o más, 18 bits de versión con su BCH.

### 4.2 Code 128
- Dos juegos: B (mayúsculas, minúsculas y símbolos, un carácter por símbolo) y C (pares de dígitos, dos por símbolo). El juego A no se usa: solo sirve para caracteres de control, que no se admiten, y todo lo imprimible cabe en B y C. Para elegir entre B y C se usa programación dinámica, que da siempre la cantidad mínima de símbolos (cada cambio de juego cuesta un símbolo); si empatan, se queda en B.
- Dígito de control: `(valor de inicio + Σ posición × valor) mod 103`. Luego la parada (patrón de 13 módulos). Ancho total: `11 × (n + 2) + 13` módulos.
- Caracteres fuera del ASCII imprimible (tildes, eñe) se rechazan con aviso: Code 128 no los lleva.

### 4.3 EAN‑13, EAN‑8 y UPC‑A
- Dígito de control: suma de los dígitos en posiciones impares más tres veces los de posiciones pares (contando desde la derecha del número sin control), y lo que falte para la decena.
- EAN‑13: el primer dígito no se dibuja; decide la paridad (L o G) de los seis de la izquierda según la tabla; los seis de la derecha van en R. Guardas `101`, `01010`, `101`; 95 módulos. UPC‑A es un EAN‑13 con primer dígito 0 y texto de 12 dígitos. EAN‑8: cuatro en L y cuatro en R, 67 módulos.
- Texto legible debajo con el primer dígito a la izquierda de la primera guarda, como en los empaques.

### 4.4 Code 39 e ITF‑14
- Code 39: 43 caracteres más el asterisco de inicio y fin, cada uno con 9 elementos (3 anchos, en proporción 3 a 1 con los finos) y un espacio fino entre caracteres. Las minúsculas se pasan a mayúsculas antes de codificar y se avisa. Sin dígito de control (no es obligatorio y los lectores no lo esperan por defecto).
- ITF‑14: 14 dígitos (13 más control, calculado como en EAN), codificados por pares entrelazados (barras del primero, espacios del segundo), inicio de cuatro módulos finos y fin de barra ancha, espacio fino y barra fina (proporción 3 a 1), con un marco portador de 5 módulos alrededor, como se usa en cajas. Mide 135 módulos de símbolo.

### 4.5 Dibujo
- SVG con `viewBox` en módulos y `shape-rendering="crispEdges"`, un `<rect>` blanco de fondo y un solo `<path>` negro con todos los módulos o barras, para que pese poco. El texto legible va en `<text>` con fuente monoespaciada del sistema.
- PNG: se dibuja el mismo contenido en un `<canvas>` al tamaño pedido con el módulo en píxeles enteros (para que no se vean bordes grises) y se exporta con `toBlob`.
- Hoja de impresión: rejilla de etiquetas en `@media print`, con márgenes de 1 cm, y `page-break-inside: avoid` en cada etiqueta.

### 4.6 Valores de comprobación
La fase 2 corre una prueba automática en Node (los módulos no tocan la pantalla) y además se leen con un celular:
- QR `"HELLO WORLD"` en 1‑M: modo alfanumérico, 16 palabras de datos `20 5B 0B 78 D1 72 DC 4D 43 40 EC 11 EC 11 EC 11` y 10 de corrección `C4 23 27 77 EB D7 E7 E2 5D 17` (ejemplo público de referencia del tutorial de Thonky, con 196 en el primer byte de corrección; se confirma además leyendo el QR con un celular), matriz de 21×21, patrones de búsqueda en las tres esquinas, 15 bits de formato que coinciden con la tabla para M y la máscara elegida.
- GF(256): `multiply(0x53, 0x8C)` → `0x01` y `multiply(0x02, 0x8E)` → `0x01` (pares inversos); el generador de grado 10 empieza por `1, 216, 194, 159, 111, 199, 94, 95, 113, 157, 193`.
- Selección de versión: 25 caracteres alfanuméricos en L → versión 1; 26 → versión 2; 2.953 bytes en L → versión 40; 2.954 → aviso. Un texto con tildes ("Año") → modo bytes, 4 bytes.
- Penalización de máscara: una matriz de 21×21 toda blanca suma 798 por corridas, 1.200 por bloques de 2×2 y 90 por proporción (0 % de negros: el múltiplo de 5 más cercano al 50 % está a 45, o sea 9 pasos de 10); un tablero de ajedrez da 0.
- EAN‑13: `770200400350` → control `8`, `7702004003508`; `400638133393` → `1`; `7702004003507` → aviso "el dígito de control debería ser 8". EAN‑8: `9638507` → `4`. UPC‑A: `03600029145` → `2`. ITF‑14: `1770200400350` → `5`.
- EAN‑13 `7702004003508` dibuja 95 módulos, empieza en `101` y la paridad de la izquierda para el primer dígito 7 es `L G L G L G`.
- Code 128 `"A"` → inicio B (104), valor 33, control `(104 + 33) mod 103 = 34`; `"1234567890"` → inicio C, cinco pares, control `(105 + 1·12 + 2·34 + 3·56 + 4·78 + 5·90) mod 103`; `"AB123456CD"` → cambia a C para `123456` y vuelve a B (10 símbolos contra 11 solo en B), mientras que `"AB1234CD"` empata y se queda en B; `"Año"` → aviso.
- Code 39 `"ABC-123"` → 9 caracteres con asteriscos, `9 × 15 + 8 = 143` módulos de ancho (15 por carácter con proporción 3 a 1, más 8 espacios entre caracteres); `"abc"` → `"ABC"` con aviso.
- Wi‑Fi (red `Casa;2`, clave `p@ss,word`, WPA) → `WIFI:T:WPA;S:Casa\;2;P:p@ss\,word;;`; un nombre o clave que solo tenga dígitos hexadecimales (`1234`) va entre comillas para que no se lea como hexadecimal. WhatsApp (57, 3001234567, "Hola") → `https://wa.me/573001234567?text=Hola`. Contacto → texto que empieza por `BEGIN:VCARD` y `VERSION:3.0` y termina en `END:VCARD`, con `N:` y `FN:` correctos.
- Dibujo: el SVG de un QR de versión 1 tiene `viewBox="0 0 29 29"` (21 más 4 de zona de silencio a cada lado) y el PNG de 512 px usa un módulo de 17 px (512 ÷ 29, entero) con el resto repartido en el borde.

---

## 5. Cómo se muestran los textos y números
- El texto legible de los códigos de barras sale tal cual, sin puntos de miles ni espacios, para que sea el mismo que el codificado.
- El contador de bytes y de códigos lleva punto de miles si pasa de 999 ("2.953 bytes").
- El campo de barras usa `inputmode="numeric"` cuando el tipo solo acepta dígitos, para que el celular muestre el teclado de números; con Code 128 y Code 39, el teclado normal.
- El nombre del archivo descargado usa solo letras, números y guion bajo del contenido, hasta 30 caracteres: `qr_menu_del_dia.svg`, `barcode_ean13_7702004003508.png`.

---

## 6. Diseño visual y animación

- Fondo oscuro neutro con acento índigo (`#818cf8`) para la pestaña activa, las fichas de tipo y los botones principales. El color de atención para los avisos. Contraste de al menos 4,5 a 1 en textos (WCAG AA). El contorno de foco es ámbar.
- Tarjeta de hasta 720 px de ancho: en escritorio los campos a la izquierda y el código a la derecha; en celular el código arriba, pegado, y los campos debajo, para que se vea cambiar mientras se escribe.
- El recuadro del código es blanco siempre, con una sombra suave y el borde de la tarjeta, para que el QR tenga su zona de silencio real y se pueda escanear desde la pantalla.
- **Animación 3D (Three.js):** una nube de cubos pequeños que se ordenan por un momento en una cuadrícula parecida a un QR y se vuelven a dispersar despacio, detrás de la tarjeta, con un leve destello cada vez que se genera un código. Decorativa: la página funciona igual si no carga. Three.js se importa con `import()` dentro de `animations.js`, como en las otras herramientas.
- Según CLAUDE.md 2.10: `requestAnimationFrame`, tope de 30 cuadros por segundo, `pixelRatio` máximo 2, se ajusta al cambiar el tamaño, se pausa con la pestaña oculta y con `prefers-reduced-motion` se queda quieta.
- Favicon de la marca y pie de copyright según CLAUDE.md 2.16.

---

## 7. Fases de desarrollo

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Estructura de carpetas (con el favicon y el pie de copyright), `index.html` estático con las dos pestañas, sus campos y opciones, un resultado de ejemplo y el bloque Varios a la vez, `css/styles.css` responsive (con la hoja de impresión) y README | Hecha |
| 2 | `js/qr_encoder.js` completo (modos, versiones, Reed‑Solomon, máscaras, formato y versión) con su prueba de valores conocidos; `js/code_renderer.js` con el SVG; `js/main.js` con la pestaña QR de Texto o enlace en vivo, el contador y Descargar SVG | Hecha |
| 3 | `js/barcode_encoder.js` (Code 128, EAN‑13, EAN‑8, UPC‑A, Code 39, ITF‑14) con su prueba; pestaña Código de barras en vivo con dígito de control, avisos y texto legible; Descargar PNG, Copiar e Imprimir | Hecha |
| 4 | Tipos Wi‑Fi, Contacto y WhatsApp; Varios a la vez con la hoja de impresión; valores recordados; animación 3D de fondo (`js/animations.js`) | Hecha |
| 5 | Cierre: checklist de CLAUDE.md 2.11, tarjeta en el portal, fila en CLAUDE.md 2.12 y carpeta en 2.4. Las lecturas con celular, la impresión en papel y la prueba en GitHub Pages quedan para la persona dueña (sección 11) | Hecha, con pruebas a mano pendientes |

---

## 8. Estructura de archivos del proyecto

Según CLAUDE.md 2.5:

```
generator_barcodes_qr/
├── index.html             # Única página
├── README.md              # Título, descripción y ejecución local
├── PLAN.md                # Este documento
├── css/
│   └── styles.css         # Todos los estilos, incluida la hoja de impresión
├── js/
│   ├── main.js            # Pantalla: pestañas, campos, opciones, resultado, descargas, varios, memoria
│   ├── qr_encoder.js      # QR: modos, versión, Reed-Solomon, máscaras, formato. Funciones puras
│   ├── barcode_encoder.js # Code 128, EAN-13, EAN-8, UPC-A, Code 39, ITF-14. Funciones puras
│   ├── code_renderer.js   # De matriz o barras a un dibujo en módulos, y de ahí a SVG y PNG (canvas)
│   └── animations.js      # Fondo 3D con Three.js
└── assets/
    └── icons/
        └── favicon.ico    # Favicon de la marca (CLAUDE.md 2.16)
```

Sin `config.js` (no usa Supabase) y sin `lottie/` ni `img/` (no los necesita). `qr_encoder.js`, `barcode_encoder.js` y `code_renderer.js` son la división de `main.js` que permite 2.5: toda la lógica que se puede probar sin pantalla va ahí.

---

## 9. Ejecución local

Desde esta carpeta, `python ../dev_server.py` y abrir http://localhost:8080 (ver CLAUDE.md 2.8).

---

## 10. Riesgos y cómo se manejan

| Riesgo | Manejo |
|---|---|
| El codificador QR propio tiene un error sutil y el código "se ve bien" pero no se lee | Prueba automática contra el ejemplo público de referencia (datos y corrección byte a byte), comprobación de formato y versión contra las tablas, y lectura real con dos celulares distintos en las fases 2 y 5 antes de dar el QR por bueno. Se prueban textos de versión 1, 7 (primera con bits de versión), 10, 27 y 40 |
| Un texto largo con corrección H no cabe y la persona no entiende por qué | El aviso dice cuántos bytes sobran y ofrece bajar la corrección con un botón; el contador muestra en vivo "versión 12‑H" para que se vea crecer |
| Un dígito de control mal escrito produce un código que el lector rechaza | Si se escriben todos los dígitos, se comprueba el control y se avisa cuál debería ser; si falta uno, se calcula solo y se muestra en el texto atenuado antes de dibujar |
| El PNG sale borroso o con bordes grises y no se lee | Módulo en píxeles enteros y sin suavizado; el SVG es siempre la opción nítida y se ofrece primero |
| Copiar la imagen falla (sin https, navegador sin `ClipboardItem`) | Se avisa "No se pudo copiar" y se señala Descargar PNG; nunca falla en silencio |
| Se guarda en el equipo la clave del Wi‑Fi o un contacto ajeno | Esos campos no se guardan nunca; solo se recuerda el texto libre y el número de barras, y solo si pesan 2 KB o menos |
| Doscientos códigos de golpe congelan la página en un celular | El lote se dibuja en tandas de 20 con `requestAnimationFrame` entre una y otra, el QR en SVG pesa poco, y el límite es 200 líneas |
| El QR de la pantalla no se escanea por el tema oscuro | El recuadro es blanco siempre, con zona de silencio dentro del SVG y un tamaño mínimo de 200 px en celular |
| El 3D pesa en un equipo lento | Pocas piezas, tope de cuadros, y la página funciona sin 3D |

---

## 11. Cierre: checklist de CLAUDE.md 2.11

Revisión técnica hecha con la aplicación corriendo, servida desde el portal en una subcarpeta (`/generator_barcodes_qr/`), como quedará en GitHub Pages.

| Punto | Estado |
|---|---|
| Estructura como en 2.5 | Cumple: `index.html`, `README.md`, `css/styles.css`, `js/main.js`, `js/animations.js` y `assets/icons/favicon.ico` (copia idéntica a la original de la raíz). Sin `config.js` (no usa Supabase) y sin `lottie/` ni `img/` (no los necesita). Además lleva tres módulos de lógica pura (`qr_encoder.js`, `barcode_encoder.js` y `code_renderer.js`), que 2.5 permite al dividir la lógica, y este `PLAN.md` |
| `README.md` con título, descripción y ejecución local | Cumple, con el comando `python ../dev_server.py` |
| 360 px hasta escritorio | Cumple: sin desplazamiento horizontal a 320, 360, 768 y 1280 px de ancho, con los cuatro tipos de QR, con un nombre de red de 90 letras seguidas, con un sitio web de 120 caracteres, con Code 128 de 80 caracteres, con ITF-14 y con el lote abierto. Ningún campo, botón ni resumen mide menos de 44 px de alto a 320 px. Desde 760 px los campos van a la izquierda y el código a la derecha; por debajo de 760 px el código va arriba y se queda a la vista mientras se baja a los campos |
| Teclado y foco visible | Cumple: con pulsaciones reales, las flechas, Inicio y Fin cambian de pestaña y de ficha de tipo de contenido (en las fichas, Inicio y Fin están hechos a mano; las flechas son las nativas de un grupo de radios); Escape en el campo de la clave del Wi-Fi la vuelve a ocultar. Todos los controles tienen contorno ámbar de 3 px y nombre accesible; sin ids repetidos ni referencias ARIA rotas (comprobado por script). Las pestañas usan `role="tablist"`, `tab` y `tabpanel`; el aviso usa `role="alert"`; el código listo, las descargas y el copiar se anuncian con `role="status"` (el código listo, pasado un instante sin escribir y no con cada letra) |
| Sin errores en la consola | Cumple: limpia al cargar y al recorrer los cuatro tipos de QR, los seis tipos de barras, el aviso de "no cabe" y su botón de bajar la corrección, el lote con líneas malas, las descargas y la impresión; y con datos guardados dañados (tipos equivocados, valores que no existen en las listas), donde se descarta cada campo malo por separado. Con Three.js caído o el almacenamiento bloqueado queda cubierto por construcción (`import()` dentro de `try/catch` y lecturas y escrituras de `localStorage` en `try/catch`), pero no se simuló |
| Rutas relativas con `./` | Cumple. Ninguna ruta absoluta; probado servido desde `/generator_barcodes_qr/` y abierto desde la tarjeta del portal |
| Librerías por CDN y versiones de 2.3 | Cumple: Font Awesome 6.7.2 y Three.js 0.170.0 (con importmap). No se carga Lottie ni Supabase porque no se usan. Three.js se importa con `import()` dentro de `animations.js` para que su caída no rompa el generador |
| `prefers-reduced-motion` y pausa con pestaña oculta | Cumple por construcción: mismo esquema de `animations.js` de las otras herramientas (quieto con movimiento reducido, bucle cancelado con la pestaña oculta, 30 cuadros por segundo como máximo, `pixelRatio` máximo 2, redibujo al cambiar de tamaño, pérdida del contexto gráfico tratada), y transiciones apagadas con movimiento reducido en la hoja de estilos. Se comprobó que la escena se crea, el lienzo toma el tamaño de la ventana, el contexto sigue vivo y los cubos se ven; no se pudo activar "reducir movimiento" en el navegador de pruebas |
| `localStorage` con prefijo y `try/catch` | Cumple: una sola clave, `generator_barcodes_qr_last`, con lectura y escritura dentro de `try/catch`. Se comprobó que **no aparecen** en lo guardado la clave ni el nombre de la red Wi-Fi, ni el nombre, el correo y el teléfono de un contacto, ni el número de WhatsApp; el texto libre, el contenido de barras y las opciones sí, y vuelven al recargar |
| Código en inglés, comentarios en español, snake_case | Cumple. Sin `console.*`, `TODO`, `eval` ni `innerHTML` (el SVG entra con `DOMParser` e `importNode` y todo texto con `textContent`). `Math.random` solo aparece en los valores de adorno de los cubos y está dicho en un comentario. Sin constantes, funciones ni ids sin uso (revisado por script). Las dos clases de error (`QrError` y `BarcodeError`) siguen la convención de `JsonSyntaxError` de `json_formatter` |
| Favicon y copyright (2.16) | Cumple: `assets/icons/favicon.ico` enlazado en el `<head>` justo después de la descripción, y pie `© 2026 Andres Felipe Olaya - Dev Layer` al final de la tarjeta |
| Agregado al portal | Cumple: tarjeta en el `index.html` de la raíz (abre `./generator_barcodes_qr/` y responde 200), fila nueva en la tabla 2.12 de CLAUDE.md y carpeta en el árbol de 2.4 |
| Una persona sin contexto lo entiende | Dos pestañas con nombres claros, un código de ejemplo atenuado con "Escribe algo para generar tu código", cada tipo de contenido con sus propios campos, avisos en palabras ("El dígito de control debería ser 8, no 7. Corrígelo o bórralo para que se calcule solo.") y botones que dicen qué hacen. Un texto arriba explica que nada sale del navegador |

### Pruebas automáticas (hechas con los módulos reales)

Los módulos de lógica no tocan la pantalla, así que se probaron en Node con un decodificador **independiente** que lee la matriz o las barras sin usar el código del codificador. Los guiones de prueba no forman parte del proyecto (CLAUDE.md 2.2 prohíbe Node en él).

- **QR, 25 comprobaciones:** las 160 combinaciones de versión y nivel contra la tabla del estándar de palabras de datos; capacidades en bytes (versiones 1 a 10 y 40), numérico y alfanumérico (7.089 y 4.296 en 40-L); `HELLO WORLD` en 1-M byte a byte, con 196 en el primer byte de corrección; multiplicación en GF(256) y generador de grado 10; entrelazado de la versión 5-Q; posiciones de alineación de las versiones 1, 2, 7, 32 y 40; los 32 valores de formato y los bits de versión 7 y 8; y lectura de vuelta (las dos copias del formato, la máscara, el desentrelazado, los síndromes Reed-Solomon en cero en cada bloque y el texto idéntico) en 200 textos aleatorios, en las versiones 1, 2, 7, 10, 27 y 40 con corrección L y H, en los máximos de cada modo de la versión 40, con tildes, eñes, japonés y emoji, y en un contacto vCard.
- **Barras, 17 comprobaciones:** invariantes de las tablas (Code 128: 107 patrones de 11 módulos con barras de ancho par y todos distintos; Code 39: 44 patrones con tres anchos, 40 con dos barras anchas y 4 con tres espacios anchos; ITF: 10 patrones de dos anchos; EAN: paridad de los juegos L, R y G y las 10 paridades del primer dígito), dígitos de control conocidos, lectura de vuelta de 200 EAN-13 y de 300 textos Code 128 al azar de hasta 80 caracteres, Code 39 con sus 43 caracteres, ITF-14, EAN-8 y UPC-A, el control `55` de `PJJ123C` en Code 128, y la cantidad de símbolos de Code 128 igual al mínimo por fuerza bruta en 400 textos.
- **Dibujo, 8 comprobaciones en Node y 4 en el navegador:** el dibujo reconstruye la matriz exacta con su zona de silencio; el SVG escapa `<`, `&`, `>` y comillas; las guardas de EAN y UPC bajan hasta el texto; el marco del ITF-14. En el navegador, el PNG de tres QR (256, 512 y 1024 px) y de un EAN-13 coincide **módulo por módulo** con la matriz y las barras (0 diferencias), con módulo entero de píxeles y esquina blanca.
- **Interfaz:** los cuatro tipos de QR (con aviso de lo que falta si ya se empezó a llenar), "no cabe" con su botón para bajar la corrección (1.500 bytes con H sugiere Q y lo dibuja en la versión 39), los seis tipos de barras con control calculado, comprobado y rechazado, minúsculas pasadas a mayúsculas en Code 39, el valor completo mostrado bajo el campo, el lote de 26 líneas (1 con error), de 230 (se dibujan 200 y se avisa de las 30 de más) y vacío, las descargas (nombres `qr_menu_del_dia_mesa_7.svg` y `.png`, tipos, firma PNG, tamaño 512×512, SVG con medidas propias) y los dos modos de impresión.
- **Contraste (WCAG AA):** todos los textos superan 4,5 a 1 (el más bajo, el texto atenuado sobre las fichas, da 6,65). El foco, los bordes de los controles y el acento superan 3 a 1 (el más bajo, el borde de los controles sobre la tarjeta, da 4,8).
- **Sin secretos ni datos personales:** el proyecto no usa claves, servidores ni cuentas. Nada de lo que se escribe sale del navegador.

### Desviaciones del plan original (ya corregidas arriba)
- Code 128 no usa el juego A (no hay caracteres de control) y elige B o C con programación dinámica en vez de una regla fija.
- Zonas de silencio de EAN-8 (7) y UPC-A (9) según el estándar, en vez de 10 para todos.
- La paridad del EAN-13 con primer dígito 7 es `L G L G L G` (el plan decía `L G L G G L`, que es la del 8), y el control de `HELLO WORLD` empieza en `C4` (196), no en `BC`.
- Code 39 mide 143 módulos con `ABC-123` (el plan decía `9 × 9 + 8`, una cuenta de elementos y no de módulos).
- La hoja de impresión la arma `main.js` y no `code_renderer.js`.

### Pruebas que solo se pueden hacer a mano
1. **Leer los códigos con dos celulares** (uno con iPhone si es posible), con la cámara nativa y con una aplicación de lectura: un QR corto, uno de 500 caracteres, uno con tildes y eñes, uno de Wi-Fi (que el teléfono ofrezca conectarse), uno de Contacto (que ofrezca guardar el contacto con nombre y teléfono) y uno de WhatsApp (que abra el chat con el mensaje). Y un EAN-13, un UPC-A, un Code 128 con letras y un ITF-14 con una aplicación de lectura de barras. **Es la única prueba que confirma la lectura con un lector real**: los decodificadores de las pruebas automáticas confirman la estructura, pero comparten el entendimiento del estándar de quien los escribió.
2. **Imprimir** una hoja de Varios a la vez y leer los códigos impresos; mirar que las etiquetas no se partan entre páginas y que, al imprimir un solo código, salga solo el código.
3. **Copiar de verdad:** comprobar que **Copiar** deja la imagen en el portapapeles y se pega en WhatsApp Web, un correo o un documento. En el navegador de pruebas el portapapeles rechazó la escritura por permisos (`NotAllowedError`); lo que sí se comprobó es que entonces el botón muestra "No se pudo" y se anuncia que se use Descargar PNG.
4. En **GitHub Pages**, tras publicar: abrir `https://<usuario>.github.io/projects/generator_barcodes_qr/` y comprobar que carga sin errores, con iconos y fondo, y que Copiar funciona (el portapapeles solo funciona con https). Si se ve una versión vieja, recargar con Ctrl y F5.
5. Activar "reducir movimiento" en el sistema y comprobar que el fondo queda quieto.
6. **Mirar el fondo a simple vista** en un monitor: cubos índigo que flotan, se ordenan en una cuadrícula parecida a un QR y se dispersan detrás de la tarjeta, sin tapar el texto, con un destello al generar.
