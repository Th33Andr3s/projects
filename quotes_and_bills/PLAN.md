# Plan de trabajo: Cotizaciones y cuentas de cobro (`quotes_and_bills`)

Documento de planificación del proyecto. Se rige por las reglas de [CLAUDE.md](../CLAUDE.md). Cada fase termina con una revisión en el navegador y la aprobación de la persona dueña antes de pasar a la siguiente.

---

## 1. Qué es este proyecto

Una página para que un negocio pequeño o una persona independiente haga sus **cotizaciones** y sus **cuentas de cobro** en minutos y las entregue en PDF con su logo: se escriben los datos del negocio una sola vez, se guardan los clientes y los productos o servicios que se venden, y cada documento nuevo se arma eligiendo cliente, agregando renglones y revisando el total con IVA. Pensada para el plomero, la diseñadora, el taller, la tienda o el consultor que hoy hace las cotizaciones en Word o a mano y pierde la cuenta de cuáles le aceptaron y cuáles le deben, desde el computador o el celular.

Funciona así:

1. **Mi negocio:** nombre, NIT o cédula, teléfono, correo, logo y la leyenda legal del pie. Se escribe una vez.
2. **Nuevo documento:** se elige Cotización o Cuenta de cobro, el cliente (guardado o nuevo), se agregan renglones desde el catálogo o a mano, y los totales salen solos.
3. **Entregar:** **Descargar PDF**, **Imprimir** o **Enviar** por WhatsApp o correo con el resumen. El documento queda en la lista con su número y su estado (enviada, aceptada, pagada…), y el resumen muestra cuánto se cotizó y cuánto se cobró en el mes.

**No usa servidor ni cuentas.** Todo se guarda en el navegador del equipo, con **Exportar** e **Importar** en JSON como respaldo y para pasar los datos a otro equipo.

### Qué no es

- **No es facturación electrónica.** En Colombia una factura de venta debe ser electrónica y pasar por la DIAN a través de un proveedor autorizado; una página estática no puede emitirla. Esta herramienta hace cotizaciones y cuentas de cobro, que son los documentos que usan las personas y negocios no obligados a facturar o que cotizan antes de facturar. Cada documento lleva la nota "Este documento no es una factura electrónica".
- **No lleva contabilidad ni calcula impuestos a declarar.** Muestra el IVA de cada documento y, si se quiere, la retención en la fuente, con los porcentajes que la persona elija; no decide por ella qué porcentaje le aplica.
- **No envía correos ni mensajes por sí sola.** Abre WhatsApp o el programa de correo con el texto listo; el PDF se descarga y se adjunta a mano. Una página estática no puede mandar archivos.
- **No comparte datos entre personas ni equipos.** Los datos viven en el navegador. Si el negocio necesita varios equipos o varias personas, el camino es una fase posterior con Supabase (CLAUDE.md 2.9), fuera de este plan.

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Stack | HTML, CSS, JS vanilla, Three.js, Font Awesome. Todo por CDN según CLAUDE.md 2.3. Sin Lottie |
| Datos | Ninguno en servidor. Todo en `localStorage` bajo una sola clave, `quotes_and_bills_data`: `{ version, business, clients, products, documents, counters }`. Si al guardar el navegador dice que no hay espacio, se avisa y se ofrece Exportar; nada se pierde en silencio |
| Dos documentos | **Cotización** (con fecha de vigencia) y **Cuenta de cobro** (con fecha de vencimiento). Una cotización aceptada se convierte en cuenta de cobro con un botón, copiando cliente y renglones |
| Numeración | Consecutiva por tipo, con prefijo configurable (`COT` y `CC` por defecto) y cuatro cifras: `COT-0001`. El número se asigna al crear el documento y nunca se reutiliza, aunque se borre un borrador. El contador inicial se puede fijar en Mi negocio, para quien ya venía numerando |
| Estados | Cotización: **Borrador**, **Enviada**, **Aceptada**, **Rechazada**; y **Vencida** se calcula sola cuando pasa la vigencia sin aceptarse. Cuenta de cobro: **Borrador**, **Enviada**, **Pagada**; y **Vencida** se calcula sola cuando pasa el vencimiento sin pagarse. El estado lo cambia la persona con un selector; Descargar, Imprimir o Enviar pasan un Borrador a Enviada |
| Cliente en el documento | El documento guarda una **copia** de los datos del cliente al momento de crearse; editar el cliente después no cambia los documentos viejos. Al elegir un cliente guardado se copia; también se puede escribir uno nuevo y guardarlo al catálogo con una casilla |
| Renglones | `{ description, quantity, unit_price, discount_percent, tax_rate }`. Cantidad con hasta dos decimales (2,5 horas), precio en pesos enteros, descuento de 0 a 100 %, IVA 0, 5 o 19 %. Se agregan desde el catálogo (busca por nombre) o a mano. Se reordenan con botones subir y bajar, no arrastrando |
| Dinero | Pesos colombianos en enteros: `$ 1.250.000`, sin centavos. Cada renglón se redondea a peso al final (mitad hacia arriba); el IVA y la retención se calculan sobre los totales ya redondeados. Ver 4.1 |
| Totales | Subtotal (suma de renglones con su descuento), IVA (por tarifa, con una línea por cada tarifa usada), **Retención en la fuente** opcional con el porcentaje que se escriba (se resta del total y se explica que la aplica quien paga), y **Total**. Un descuento general en porcentaje, opcional, antes del IVA |
| Mi negocio | Nombre, NIT o cédula, teléfono, correo, dirección, ciudad, logo, casilla **Responsable de IVA** (si no lo es, el IVA no se muestra en los documentos y el pie lleva "No responsable de IVA"), leyenda del pie (editable), prefijos y contadores, retención por defecto y días de vigencia por defecto (15) |
| Logo | Se elige una imagen, se redimensiona en el navegador a 400 px de lado como máximo y se guarda como JPEG sobre fondo blanco (unos 20 a 40 KB). JPEG porque el PDF lo incrusta tal cual, sin recomprimir ni decodificar |
| PDF | **Escritor de PDF propio** en `js/pdf_writer.js`: CLAUDE.md 2.2 prohíbe librerías. Tamaño carta, fuentes estándar Helvetica y Helvetica-Bold (no se incrustan; cualquier lector las tiene) con codificación WinAnsi, que cubre tildes, eñes y el signo de pesos; tabla de anchos de las dos fuentes para alinear números a la derecha y cortar descripciones largas en varias líneas; logo como imagen JPEG; varias páginas si hay muchos renglones, repitiendo la cabecera de la tabla. Es el bloque técnico más grande del proyecto y se prueba leyendo el PDF con un lector independiente (4.6) |
| Imprimir | La vista del documento en pantalla se imprime con `@media print` (solo el documento, sin la interfaz). Es la alternativa si el PDF propio fallara en algún lector |
| Enviar | **WhatsApp** abre `https://wa.me/<número del cliente>?text=` con un resumen (número, total, vigencia); **Correo** abre `mailto:` con asunto y cuerpo. En ambos se recuerda adjuntar el PDF descargado. Los datos del cliente solo van en la URL cuando la persona toca el botón, y la URL se abre, no se guarda |
| Respaldo | **Exportar** descarga `cotizaciones_respaldo_AAAA-MM-DD.json` con todo; **Importar** lee un archivo igual, muestra cuántos clientes, productos y documentos trae y, al confirmar, reemplaza lo que hay. Antes de reemplazar descarga solo un respaldo de lo actual, por si acaso |
| Lista y búsqueda | Una lista con los documentos del más nuevo al más viejo: número, tipo, cliente, fecha, total y estado. Filtros por tipo y estado, y búsqueda por número o cliente sin tildes ni mayúsculas |
| Resumen | Para el mes elegido: cotizaciones hechas y aceptadas (cantidad y valor), cuentas de cobro emitidas, pagadas y pendientes (cantidad y valor), y la lista de pendientes con su vencimiento. Barras simples en SVG inline con los últimos seis meses |
| Fechas | `"AAAA-MM-DD"` sin hora ni zona horaria (como en `to_do_list`); "hoy" con la fecha local del equipo. En pantalla "12 oct 2026"; en el PDF "12 de octubre de 2026" |
| Estética | La misma familia que las otras herramientas (tarjeta oscura, botones grandes), con acento cian (`#22d3ee`) para distinguirla. La tarjeta es más ancha (960 px) porque el editor tiene una tabla. La vista del documento es blanca siempre, como el papel. Animación 3D sutil de fondo con hojas de papel que flotan |
| Idioma | Interfaz en español de Colombia: "NIT", "cuenta de cobro", "retención en la fuente", "IVA" |

---

## 3. Pantalla

Todo vive en un solo `index.html`. Una barra de navegación dentro de la tarjeta cambia entre cinco vistas; solo una se ve a la vez. La vista inicial es **Documentos**, salvo la primera vez, que abre **Mi negocio** con un aviso de bienvenida.

### 3.1 Navegación
Cinco botones con `role="tab"`: **Documentos**, **Clientes**, **Catálogo**, **Resumen** y **Mi negocio**. En celular se muestran con icono y nombre corto.

### 3.2 Documentos (lista)
- Botón grande **Nuevo documento** que abre un diálogo chico: Cotización o Cuenta de cobro.
- Filtros: tipo (Todos, Cotizaciones, Cuentas de cobro), estado (Todos, Borrador, Enviada, Aceptada, Pagada, Vencida, Rechazada) y el cuadro de búsqueda.
- Cada renglón: número, cliente, fecha, total y una ficha de estado con color. Tocarlo abre el editor. Un menú de tres puntos por renglón: Duplicar, Convertir en cuenta de cobro (solo cotizaciones), Borrar (pregunta antes).
- Sin documentos: un texto que invita a crear el primero y, si falta el negocio, a llenar Mi negocio.

### 3.3 Editor de documento
- Arriba: número y tipo, fecha, vigencia o vencimiento, y el selector de estado.
- **Cliente:** una lista para elegir uno guardado o "Nuevo cliente", y los campos nombre, NIT o cédula, teléfono, correo, dirección. Casilla "Guardar en Clientes".
- **Renglones:** una tabla con descripción, cantidad, precio, descuento, IVA y total del renglón, y botones subir, bajar y quitar. Debajo, un cuadro **Agregar del catálogo** que busca mientras se escribe y un botón **Renglón en blanco**. En celular cada renglón es una ficha apilada, no una fila.
- **Totales:** subtotal, descuento general (campo de porcentaje), IVA por tarifa, retención (casilla y porcentaje) y total en grande.
- **Notas** (texto libre que sale en el PDF, por ejemplo forma de pago) y los datos bancarios del negocio, que vienen de Mi negocio.
- Botones: **Vista previa**, **Descargar PDF**, **Imprimir**, **Enviar** (abre WhatsApp o Correo) y **Volver a la lista**. Todo se guarda solo al escribir; no hay botón Guardar.
- La **vista previa** es el documento como saldrá en papel: logo y datos del negocio arriba, datos del cliente, tabla, totales, notas, pie legal. Es lo que se imprime.

### 3.4 Clientes y Catálogo
- Dos listas iguales en forma: cuadro de búsqueda, botón **Agregar**, y cada elemento con sus datos y botones Editar y Borrar (borrar pregunta; los documentos viejos no se afectan porque llevan su copia). Cliente: nombre, NIT o cédula, teléfono, correo, dirección. Producto o servicio: nombre, descripción corta, precio, IVA.
- Editar abre un `<dialog>` con los campos, Guardar y Cancelar; Escape cierra.

### 3.5 Resumen
- Selector de mes (por defecto el actual). Cuatro cifras grandes: cotizado, aceptado, cobrado, pendiente por cobrar. Debajo, la lista de cuentas de cobro pendientes con su vencimiento (las vencidas primero, en el color de atención) y las barras de los últimos seis meses (cotizado y cobrado).

### 3.6 Mi negocio
- Los campos de la sección 2, el logo con vista previa y botón para quitarlo, y la sección **Respaldo** con Exportar e Importar.

### 3.7 Comportamiento común
- Todo se guarda al instante en `localStorage` (con una espera de 300 ms al escribir), dentro de `try/catch`. Si el almacenamiento falla, se avisa con una franja fija "No se pudo guardar en este navegador" y se ofrece Exportar.
- Teclado: Tab recorre todo; las flechas, Inicio y Fin cambian de vista en la navegación; en la tabla de renglones, Enter en el último campo agrega un renglón nuevo; Escape cierra diálogos. Foco siempre visible.
- Los cambios de estado, las descargas y los borrados se anuncian a lectores de pantalla con `role="status"`; los avisos de error con `role="alert"`.
- Sin `console.log` ni errores en consola.

---

## 4. Cómo funciona por dentro

Toda la lógica que no toca la pantalla vive en funciones puras para probarla con valores conocidos:

- `js/document_model.js`: totales, redondeo, numeración, estados calculados, validación, fechas y el formato de dinero.
- `js/pdf_writer.js`: un escritor de PDF genérico (páginas, texto, líneas, rectángulos, imagen JPEG, medida de texto).
- `js/document_layout.js`: la plantilla del documento sobre el escritor (cabecera, tabla con salto de página, totales, pie) y el texto para WhatsApp y correo.
- `js/main.js`: pantalla, navegación, memoria, respaldo, impresión y envío.

### 4.1 Dinero y redondeo
- Precios y totales son enteros en pesos. Las cantidades admiten hasta dos decimales.
- Renglón: `round(quantity × unit_price × (1 − discount_percent / 100))`, con `round` = mitad hacia arriba a peso (`Math.round` sobre el valor positivo; no hay valores negativos).
- Subtotal = suma de renglones. Descuento general = `round(subtotal × percent / 100)`; base = subtotal − descuento general.
- IVA: por cada tarifa usada, `round(base de esa tarifa × tarifa / 100)`, donde la base de la tarifa es la suma de los renglones con esa tarifa menos su parte proporcional del descuento general (repartido en proporción por el método del mayor resto: cada renglón recibe la parte entera de lo que le toca y los pesos que sobran van a los renglones con mayor fracción, así la suma de lo repartido es exactamente el descuento y ningún renglón recibe más de lo que le corresponde redondeado hacia arriba).
- Retención = `round(base × withholding_percent / 100)`, sobre la base sin IVA, que es como se calcula la retención en la fuente.
- Total = base + IVA − retención. En pantalla y PDF se muestran todas las líneas que no son cero.

### 4.2 Numeración y estados
- `next_number(counters, kind)` devuelve `${prefix}-${String(n).padStart(4, "0")}` e incrementa; con más de 9999 sigue con cinco cifras.
- `effective_status(document, today)`: si el estado guardado es Borrador o Enviada y la fecha de vigencia o vencimiento es anterior a hoy, devuelve Vencida; si no, el guardado. Aceptada, Rechazada y Pagada nunca vencen.
- Convertir: crea una cuenta de cobro nueva con su propio número, la fecha de hoy, vencimiento a 30 días, el mismo cliente y los mismos renglones, y en la cotización guarda `converted_to` para mostrar el enlace.

### 4.3 Validación
- Un documento se puede descargar o enviar cuando tiene cliente con nombre, al menos un renglón con descripción, cantidad mayor que cero y precio mayor o igual a cero, y el negocio tiene nombre. Si falta algo, el botón avisa qué falta y lleva el foco al campo.
- NIT o cédula: solo dígitos y guion (`900123456-7`); se limpia pero no se valida el dígito de verificación, porque muchas personas lo escriben sin él.
- Teléfono para WhatsApp: se quitan espacios y signos; si no empieza por indicativo se antepone 57.

### 4.4 Escritor de PDF
- Genera un PDF 1.4 como texto más los bytes del JPEG: catálogo, árbol de páginas, una página por hoja con su contenido, dos objetos de fuente (`/Helvetica` y `/Helvetica-Bold`, `/WinAnsiEncoding`), un XObject de imagen con `/DCTDecode` si hay logo, y la tabla `xref` con los desplazamientos exactos en bytes. Se arma en un `Uint8Array` y se descarga como `application/pdf`.
- Texto: cada cadena se convierte a WinAnsi (tildes, eñes, `$`, `—`, `€`); lo que no existe en WinAnsi sale como `?`. Se escapan `(`, `)` y `\`.
- Medidas: tabla de anchos de los 256 códigos de Helvetica y Helvetica-Bold (de los archivos AFM públicos de Adobe), para alinear a la derecha, centrar y cortar líneas por palabras al ancho de la columna.
- Página carta (612 × 792 puntos), márgenes de 50 puntos. Cuando la tabla no cabe, se cierra la página, se abre otra y se repite la cabecera de la tabla; los totales van siempre debajo del último renglón, en la página que toque. Pie con "Página 1 de 2".
- Nombre del archivo: `cotizacion_COT-0012_nombre_cliente.pdf` o `cuenta_de_cobro_CC-0003_nombre_cliente.pdf`, con el nombre en minúsculas sin tildes ni espacios.

### 4.5 Respaldo
- Exportar: `{ "app": "quotes_and_bills", "version": 1, "business": {…}, "clients": [...], "products": [...], "documents": [...], "counters": {…} }`.
- Importar: se valida que `app` y `version` coincidan y que las listas sean listas; cada documento o cliente mal formado se descarta por separado y se dice cuántos se descartaron. Antes de reemplazar, se descarga el respaldo de lo actual.

### 4.6 Valores de comprobación
La fase 2 corre una prueba automática sobre `document_model.js`, y la fase 4 otra sobre `pdf_writer.js` y `document_layout.js` que lee el PDF generado con un lector independiente (PyMuPDF, fuera del proyecto) y compara textos, totales y número de páginas:
- Renglón 3 × 12.345 con 10 % de descuento → 33.331,5 → **33.332**; IVA 19 % → 6.333,08 → **6.333**; retención 4 % → 1.333,28 → **1.333**; total **38.332**.
- Cantidad 2,5 × 80.000 → 200.000; cantidad 0,33 × 10.000 → 3.300; 1 × 999 con 100 % de descuento → 0.
- Descuento general 10 % sobre dos renglones de 100.000 (IVA 19) y 50.000 (IVA 5): descuento 15.000; bases 90.000 y 45.000; IVA 17.100 + 2.250 = 19.350; total 154.350. Con tres renglones de 33.333 (IVA 19) y descuento general 10 %: descuento 10.000, y las bases proporcionales suman exactamente 89.999.
- Sin ser responsable de IVA: todos los IVA son 0 y no aparecen líneas de IVA.
- Formato: `format_money(1250000)` → `"$ 1.250.000"`; `format_money(0)` → `"$ 0"`; `format_date_long("2026-10-12")` → `"12 de octubre de 2026"`; `format_date_short` → `"12 oct 2026"`.
- Numeración: `COT-0001`, `COT-0002`; con contador inicial 150 → `COT-0150`; con 9999 → `COT-9999` y luego `COT-10000`; borrar un borrador no devuelve el número.
- Estados: cotización Enviada con vigencia `2026-10-01` y hoy `2026-10-02` → Vencida; Aceptada con la misma vigencia → Aceptada; cuenta de cobro Pagada nunca vence.
- Convertir una cotización con 3 renglones → cuenta de cobro con número `CC-0001`, 3 renglones iguales, total igual, vencimiento 30 días después de hoy, y la cotización queda con `converted_to`.
- WinAnsi: `"Año"` → bytes `41 F1 6F`; `"$ 1.250.000"` sale tal cual; `"→"` → `?`; `"("` → `\(`.
- Anchos: `text_width("Hola", "regular", 10)` coincide con el ancho que calcula PyMuPDF para Helvetica (diferencia menor de 0,01 puntos), lo mismo en negrita y con tildes.
- PDF: empieza por `%PDF-1.4` y termina en `%%EOF`; la tabla `xref` apunta al byte exacto de cada objeto (se comprueba leyendo los desplazamientos); PyMuPDF abre el archivo, cuenta 1 página con 5 renglones y 2 páginas con 40, extrae el número del documento, el nombre del cliente, "Total" con `$ 38.332` y la leyenda "no es una factura electrónica", y encuentra una imagen cuando hay logo.
- Respaldo: exportar e importar devuelve exactamente los mismos datos; un archivo con `app` distinto se rechaza; un documento sin renglones válidos dentro del archivo se descarta y se avisa.

---

## 5. Cómo se muestran los números y las fechas
- Dinero: `$ 1.250.000`, con punto de miles y sin decimales, en pantalla, en el PDF y en los textos de envío. Los campos de precio aceptan el número sin puntos (`1250000`) y lo muestran con puntos al salir del campo.
- Cantidades: hasta dos decimales con coma (`2,5`); el campo acepta coma o punto.
- Porcentajes: `19 %`, con espacio.
- Fechas: campos `type="date"`; en pantalla `12 oct 2026`; en el PDF `12 de octubre de 2026`. Meses abreviados y completos escritos a mano en español, sin depender del idioma del navegador.
- Los campos numéricos usan `inputmode="decimal"` o `"numeric"` para que el celular muestre el teclado de números.

---

## 6. Diseño visual y animación

- Fondo oscuro neutro con acento cian (`#22d3ee`) para la vista activa y los botones principales. Los estados con colores propios de contraste suficiente: Borrador gris, Enviada azul, Aceptada y Pagada verde, Vencida y Rechazada en el color de atención. Contraste de al menos 4,5 a 1 en textos (WCAG AA). El contorno de foco es ámbar.
- Tarjeta de hasta 960 px. La tabla de renglones se vuelve fichas apiladas por debajo de 700 px. La vista previa del documento es blanca, con texto oscuro, tipografía del sistema, y mide como una hoja carta a escala.
- **Animación 3D (Three.js):** hojas de papel blancas, translúcidas, que flotan y giran despacio detrás de la tarjeta, con un leve destello al descargar o enviar un documento. Decorativa: la página funciona igual si no carga. Three.js se importa con `import()` dentro de `animations.js`, como en las otras herramientas.
- Según CLAUDE.md 2.10: `requestAnimationFrame`, tope de 30 cuadros por segundo, `pixelRatio` máximo 2, se ajusta al cambiar el tamaño, se pausa con la pestaña oculta y con `prefers-reduced-motion` se queda quieta.
- Favicon de la marca y pie de copyright según CLAUDE.md 2.16.

---

## 7. Fases de desarrollo

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Estructura de carpetas (con el favicon y el pie de copyright), `index.html` estático con las cinco vistas, el editor con una tabla de ejemplo, la vista previa, los diálogos y la hoja de impresión; `css/styles.css` responsive y README | Hecha |
| 2 | `js/document_model.js` (dinero, totales, numeración, estados, validación, fechas, respaldo) con su prueba de valores conocidos; `js/main.js` con la memoria en `localStorage`, Mi negocio (con logo), Clientes y Catálogo completos | Hecha |
| 3 | Documentos: lista con filtros y búsqueda, Nuevo, editor en vivo con cliente, renglones, catálogo, totales y estado, vista previa, Duplicar, Convertir y Borrar | Hecha |
| 4 | `js/pdf_writer.js` y `js/document_layout.js` con su prueba leyendo el PDF; Descargar PDF, Imprimir y Enviar por WhatsApp y correo | Hecha |
| 5 | Resumen con cifras, pendientes y barras; Exportar e Importar; aviso de bienvenida; animación 3D de fondo (`js/animations.js`) | Hecha |
| 6 | Cierre: checklist de CLAUDE.md 2.11, tarjeta en el portal, fila en CLAUDE.md 2.12 y carpeta en 2.4. La apertura del PDF en varios lectores, la impresión en papel y la prueba en GitHub Pages quedan para la persona dueña (sección 11) | Hecha |

---

## 8. Estructura de archivos del proyecto

Según CLAUDE.md 2.5:

```
quotes_and_bills/
├── index.html             # Única página, con las cinco vistas, los diálogos y la hoja de impresión
├── README.md              # Título, descripción y ejecución local
├── PLAN.md                # Este documento
├── css/
│   └── styles.css         # Todos los estilos, incluida la hoja de impresión
├── js/
│   ├── main.js            # Arranque, navegación entre las cinco secciones y conexión de las vistas
│   ├── store.js           # Los datos en memoria y su guardado en localStorage (con espera de 300 ms y franja de aviso)
│   ├── ui_helpers.js      # Elementos, avisos a lectores de pantalla, confirmaciones, descargas, identificadores
│   ├── navigation.js      # Las acciones que una vista le pide a otra (así no se importan entre sí)
│   ├── view_documents.js  # Lista con filtros y búsqueda; nuevo, duplicar, convertir y borrar
│   ├── view_editor.js     # Editor del documento: cliente, renglones, catálogo, totales, vista previa, PDF, imprimir, enviar
│   ├── view_lists.js      # Clientes y Catálogo
│   ├── view_summary.js    # Resumen: cifras del mes, pendientes y barras de seis meses
│   ├── view_business.js   # Mi negocio: datos, logo, numeración, Exportar e Importar
│   ├── document_preview.js # La vista previa del documento en HTML (lo que se imprime)
│   ├── document_model.js  # Dinero, totales, numeración, estados, validación, fechas, limpieza y respaldo. Funciones puras
│   ├── pdf_writer.js      # Escritor de PDF genérico: páginas, texto, líneas, imagen JPEG, anchos. Funciones puras
│   ├── document_layout.js # Plantilla del documento sobre el escritor, y textos de envío. Funciones puras
│   └── animations.js      # Fondo 3D con Three.js
└── assets/
    └── icons/
        └── favicon.ico    # Favicon de la marca (CLAUDE.md 2.16)
```

Sin `config.js` (no usa Supabase) y sin `lottie/` ni `img/` (el logo lo sube la persona y vive en `localStorage`). Los tres módulos de lógica (`document_model.js`, `pdf_writer.js` y `document_layout.js`) son la división que permite 2.5: todo lo que se puede probar sin pantalla va ahí. La pantalla creció más de lo previsto y CLAUDE.md 2.5 permite dividir `main.js` en más archivos dentro de `js/`, siempre en snake_case e importados desde `main.js`, así que cada sección vive en su `view_*.js`.

---

## 9. Ejecución local

Desde esta carpeta, `python ../dev_server.py` y abrir http://localhost:8080 (ver CLAUDE.md 2.8).

---

## 10. Riesgos y cómo se manejan

| Riesgo | Manejo |
|---|---|
| El PDF propio se ve bien en un lector y mal en otro | Se usa lo más básico y estable del formato (PDF 1.4, fuentes estándar, JPEG sin transformar, sin compresión de flujos) y se prueba con PyMuPDF en la fase 4 y con Chrome, Edge, Acrobat y el visor del celular a mano. Imprimir desde el navegador queda como alternativa siempre |
| Un centavo de diferencia entre pantalla y PDF | Los totales se calculan una sola vez en `document_model.js` y los dos renderizadores los muestran tal cual; la prueba de la fase 4 compara el PDF con el modelo |
| Alguien lo usa como factura y tiene un problema con la DIAN | La nota "Este documento no es una factura electrónica" va en todos los PDF y en la pantalla de Mi negocio; el nombre del proyecto no dice "factura" |
| Se borra el historial del navegador y se pierden todos los documentos | Exportar siempre visible en Mi negocio, y un recordatorio en la lista cuando hay más de 20 documentos y no se ha exportado en 30 días (se guarda la fecha de la última exportación) |
| El almacenamiento se llena (5 MB) | Logo redimensionado a 400 px; un documento típico pesa menos de 2 KB, así que caben miles. Si aun así falla, se avisa y se ofrece Exportar; no se pierde lo que ya estaba |
| Editar un cliente cambia documentos ya enviados | Cada documento lleva su copia del cliente |
| Un número de documento se repite o se salta | El contador vive aparte de la lista y solo sube; borrar no lo baja. La prueba de la fase 2 lo comprueba |
| El teléfono del cliente queda en una URL de WhatsApp | Solo se arma al tocar Enviar, se abre en una pestaña nueva y no se guarda en ningún historial propio |
| La tabla de renglones es incómoda en celular | Por debajo de 700 px cada renglón es una ficha con los campos apilados y los botones grandes |
| El 3D pesa en un equipo lento | Pocas piezas, tope de cuadros, y la página funciona sin 3D |

---

## 11. Cierre: checklist de CLAUDE.md 2.11

Revisión técnica hecha con la aplicación corriendo, servida desde el portal en una subcarpeta (`/quotes_and_bills/`), como quedará en GitHub Pages.

| Punto | Estado |
|---|---|
| Estructura como en 2.5 | Cumple: `index.html`, `README.md`, `css/styles.css`, `js/` y `assets/icons/favicon.ico`. Sin `config.js` (no usa Supabase) y sin `lottie/` ni `img/`. En `js/` hay los tres módulos de lógica del plan y, además, la pantalla dividida en `main.js` y los `view_*.js` (sección 8), que 2.5 permite al crecer la lógica |
| `README.md` con título, descripción y ejecución local | Cumple, con el comando `python ../dev_server.py` |
| 360 px hasta escritorio | Cumple: sin desplazamiento horizontal desde 320 hasta 1920 px en las cinco secciones, con el editor abierto (renglones apilados en fichas por debajo de 700 px), con la vista previa (la tabla del documento se desplaza por dentro de la hoja en pantallas angostas), con el menú de tres puntos y con los diálogos, que caben enteros. Con 320 px las secciones se muestran solo con su icono (el nombre queda para lectores de pantalla) porque cinco nombres no caben |
| Teclado y foco visible | Cumple: Tab recorre enlace de salto, la sección activa y todo el contenido en orden; las flechas, Inicio y Fin cambian de sección; en el editor, Enter en el último campo del último renglón agrega otro; subir y bajar renglones mueven el foco con ellos; Escape cierra los diálogos y los menús; el diálogo de confirmación empieza con el foco en Cancelar. Todos los controles tienen nombre accesible ("Cantidad del renglón 2", "Quitar el renglón 1", "Más acciones para COT-0150"), sin ids repetidos ni referencias rotas; las secciones usan `role="tablist"`, `tab` y `tabpanel`, los errores de validación y de almacenamiento usan `role="alert"` y las acciones (documento creado, PDF descargado, cliente guardado…) se anuncian con `role="status"` |
| Sin errores en la consola | Cumple: limpia al cargar y al usar todo el flujo, y también con Three.js caído, con el almacenamiento bloqueado (sale la franja y la página sigue funcionando mientras esté abierta), con datos guardados dañados (campos mal formados, listas que no son listas, documentos sin renglones válidos: se salva lo salvable) y con JSON roto |
| Rutas relativas con `./` | Cumple. Ninguna ruta absoluta; probado servido desde `/quotes_and_bills/` y abierto desde la tarjeta del portal |
| Librerías por CDN y versiones de 2.3 | Cumple: Font Awesome 6.7.2 y Three.js 0.170.0 (con importmap). No se carga Lottie porque no se usa. El PDF no usa ninguna librería: lo escribe `pdf_writer.js` |
| `prefers-reduced-motion` y pausa con pestaña oculta | Cumple por construcción en el fondo: mismo esquema de `animations.js` de las otras herramientas (quieto con movimiento reducido, bucle cancelado con la pestaña oculta, 30 cuadros por segundo como máximo, `pixelRatio` máximo 2). La página no tiene más animaciones que las transiciones de botones, que se omiten con movimiento reducido. En el navegador de pruebas la ventana está oculta, así que no se pudo mirar el dibujo de las hojas; solo se comprobó que la escena se crea, el lienzo toma el tamaño de la ventana y el contexto no se pierde |
| `localStorage` con prefijo y `try/catch` | Cumple: una sola clave, `quotes_and_bills_data`, con lectura y escritura dentro de `try/catch`. Se guarda 300 ms después de escribir y también al cerrar la pestaña (`pagehide` y `visibilitychange`), y si no se puede guardar sale una franja fija con el botón Exportar |
| Código en inglés, comentarios en español, snake_case | Cumple. Sin `console.*`, TODO, `eval` ni `innerHTML` (todo lo que escribe la persona entra con `textContent`). `Math.random` solo aparece como último recurso para un identificador y en el adorno de la animación. Sin constantes, funciones, exportaciones ni ids sin uso. Todos los módulos pasan la revisión de sintaxis |
| Favicon y copyright (2.16) | Cumple: `assets/icons/favicon.ico` enlazado en el `<head>` (responde 200 servido desde la subcarpeta) y pie `© 2026 Andres Felipe Olaya - Dev Layer` al final de la tarjeta |
| Agregado al portal | Cumple: tarjeta en el `index.html` de la raíz (abre `./quotes_and_bills/`), fila nueva en la tabla 2.12 de CLAUDE.md y carpeta en el árbol de 2.4 |
| Una persona sin contexto lo entiende | La primera vez abre Mi negocio con una bienvenida y la nota de que no es facturación electrónica; la lista vacía dice qué hacer ("Toca «Nuevo documento»…"); crear un documento lleva directo al editor con el cursor en el cliente; si falta algo para descargar, la página dice qué falta y lleva el foco ahí (si falta el nombre del negocio, lleva a Mi negocio); y los estados se leen en palabras ("Vencida"), no solo en color |

### Cuánto hay que desplazarse (píxeles extra de alto de la página)

Medido con la lista vacía, con la lista de dos documentos, con la cotización de tres renglones abierta en el editor y con su vista previa abierta debajo. El editor es largo por naturaleza (cliente, renglones, totales, notas y botones), así que se desplaza siempre.

| Pantalla | Lista vacía | Lista con 2 documentos | Editor (3 renglones) | Editor con vista previa |
|---|---|---|---|---|
| 320×640 | 0 | 119 | 3313 | 4200 |
| 360×740 | 0 | 26 | 3220 | 4107 |
| 390×844 | 0 | 0 | 3120 | 4007 |
| 768×1024 | 0 | 0 | 1213 | 2112 |
| 1366×768 | 0 | 0 | 1280 | 2335 |
| 1920×950 | 0 | 0 | 1130 | 2185 |

Además:
- **Dinero:** 140 comprobaciones automáticas sobre `document_model.js`, entre ellas todas las de 4.6: el renglón 3 × 12.345 con 10 % da 33.332, el IVA 6.333, la retención 1.333 y el total 38.332; 2,5 × 80.000, 0,33 × 10.000 y el 100 % de descuento; el descuento general con dos tarifas (IVA 19.350, total 154.350) y con tres renglones iguales (las bases suman exactamente 89.999); el formato de dinero y fechas; la numeración (`COT-0001`, el contador inicial 150, `COT-9999` y `COT-10000`, y que borrar no devuelve el número); los estados calculados; convertir, duplicar y validar; la limpieza de datos dañados (incluido un logo que no es JPEG o trae caracteres raros) y el respaldo de ida y vuelta. También 5.000 renglones al azar (siempre a menos de medio peso de la cuenta exacta), 2.000 repartos de descuento (la suma siempre cuadra) y 3.000 datos guardados con basura de todo tipo (nada lanza y ningún total sale fuera de rango). Los valores grandes (100.000 × $ 9.999.999.999) salen exactos porque las multiplicaciones son con BigInt.
- **PDF, leído con un lector independiente (PyMuPDF, fuera del proyecto):** 301 comprobaciones sobre 13 archivos de prueba. Cada uno empieza por `%PDF-1.4` y termina en `%%EOF`, su tabla `xref` apunta al byte exacto de cada objeto (con entradas de 20 bytes), los `/Length` de los flujos son exactos y PyMuPDF lo abre. Se extraen el número del documento, el cliente, el total (`$ 38.332`), las líneas de IVA, descuento y retención, las fechas en palabras y la leyenda "no es una factura electrónica"; 5 renglones dan 1 página y 40 dan 2, con la cabecera de la tabla repetida, "(continuación)" arriba y los totales solo en la última; "Página 1 de 2" en cada hoja; el logo sale como imagen JPEG con sus bytes idénticos a los originales, dentro de 80 × 80 puntos y en la esquina superior izquierda (también uno en grises); una descripción de 900 palabras se reparte entre hojas sin perder ninguna; una palabra de 500 letras y un pie larguísimo no se salen de la hoja; y ningún texto pasa de los márgenes. Los anchos de texto de Helvetica y Helvetica-Bold coinciden con los de PyMuPDF con una diferencia máxima de un millonésimo de punto (48 medidas: 8 textos con tildes, signos y mayúsculas anchas, en las dos fuentes y tres tamaños). `Año` sale como `41 F1 6F`, `→` y los emojis como `?`, el euro como `80`, y `(`, `)` y `\` salen escapados. Se revisaron además dos páginas a simple vista, convertidas a imagen. El mismo código, ejecutado en el navegador, genera un PDF que empieza y termina bien (2,9 KB sin logo y 6 KB con logo).
- **Envío:** el resumen para WhatsApp y correo lleva el nombre del cliente, el número, el total y la vigencia; `wa.me` recibe el teléfono con el 57 delante si falta; sin teléfono abre WhatsApp para elegir el chat; el `mailto:` lleva asunto y cuerpo codificados; los nombres de archivo salen `cotizacion_COT-0150_alvaro_gomez.pdf` (sin tildes, espacios ni símbolos).
- **Flujo completo en el navegador:** llenar Mi negocio (se guarda solo, con el prefijo limpiado a `COT` y el NIT a `900123456-7`), agregar un cliente y un producto (con sus avisos si falta el nombre o el precio no es válido), crear una cotización, elegir el cliente, agregar un renglón del catálogo, editar cantidad, precio y descuento, quitar renglones, descuento general, retención, quitar el IVA, notas, vista previa, validar (lista lo que falta y lleva el foco), descargar el PDF (pasa de Borrador a Enviada), abrir WhatsApp, imprimir, marcarla Aceptada, convertirla en cuenta de cobro (`CC-0001`, vence a 30 días, enlaces en las dos direcciones, contadores `COT-0151` y `CC-0002`), marcarla Pagada, duplicar, borrar (la numeración no retrocede) y el Resumen (cifras del mes, el mes anterior, pendientes con las vencidas primero y las seis barras).
- **Respaldo:** exportar baja `cotizaciones_respaldo_AAAA-MM-DD.json` y anota la fecha; importar rechaza con su motivo un archivo ajeno, uno que no es JSON, uno de otra versión y uno sin las listas; con uno bueno dice cuántos clientes, productos y documentos trae y cuántos elementos dañados descartó, descarga antes un respaldo de lo actual y, al aceptar, reemplaza; al cancelar no toca nada. El recordatorio sale con más de 20 documentos y sin exportar en 30 días.
- **Numeración:** el próximo número no puede fijarse por debajo del mayor ya usado con ese prefijo (avisa cuál es el mínimo), y al cargar o importar datos el contador nunca queda por debajo de lo usado.
- **Logo:** una imagen PNG de 1200 × 600 queda en 400 × 200 como JPEG de 3 KB; un archivo que no es imagen se rechaza con su aviso sin tocar el logo guardado.
- **Contraste de colores (WCAG AA):** todos los textos superan 4,5 a 1 (el más bajo, el texto atenuado sobre las fichas, da 6,3), incluidos los cuatro colores de estado y el texto del documento sobre la hoja blanca (17,7); el foco, los bordes de los controles y las barras del Resumen superan 3 a 1 (el más bajo, el borde de los controles sobre la tarjeta, da 4,0).
- **Sin secretos ni datos personales:** el proyecto no usa claves, servidores ni cuentas. Los datos de los clientes viven solo en el navegador y en el respaldo que la persona descargue. El teléfono de un cliente solo va en la dirección de WhatsApp cuando se toca Enviar, y se abre en una pestaña nueva con `noopener`.

### Qué no se pudo comprobar aquí
- **La impresión real:** `window.print()` se llamó (con la vista previa ya dibujada) pero el navegador de pruebas no imprime, así que la hoja de impresión (`@media print`, solo el documento y sin la interfaz) queda para la prueba a mano.
- **El dibujo del fondo 3D** (la ventana del navegador de pruebas está oculta).
- **Abrir el PDF en Chrome, Edge, Acrobat y los visores de celular**, y descargar y abrir los archivos de verdad (allí las descargas se interceptaron).

### Pruebas que solo se pueden hacer a mano
1. **Abrir el PDF** en Chrome, Edge, Acrobat Reader y el visor de un celular Android y de un iPhone: logo, tildes, alineación de los números, salto de página con 40 renglones y "Página 1 de 2".
2. **Imprimir en papel** (o "Guardar como PDF" desde el diálogo de impresión del navegador) un documento desde la vista previa y comparar con el PDF: que salga solo el documento, sin menús ni botones, y que una tabla larga pase a la hoja siguiente con su cabecera.
3. **Enviar de verdad:** tocar Enviar por WhatsApp con un número propio y comprobar que abre el chat con el resumen; tocar Correo y comprobar que abre el programa de correo con asunto y cuerpo. Adjuntar el PDF a mano.
4. **Un flujo completo en el celular:** llenar Mi negocio con logo (elegido desde la galería), crear un cliente y dos productos, hacer una cotización con renglones del catálogo, marcarla aceptada, convertirla en cuenta de cobro, marcarla pagada y verla en el Resumen. Mirar que los renglones apilados se llenen cómodos con el teclado del teléfono y que los campos de número muestren el teclado numérico.
5. **Respaldo entre equipos:** exportar en un equipo, importar en otro y comprobar que todo está igual, incluido el logo.
6. En **GitHub Pages**, tras publicar: abrir `https://<usuario>.github.io/projects/quotes_and_bills/` y comprobar que carga sin errores, con iconos y fondo, y que descarga el PDF. Si se ve una versión vieja, recargar con Ctrl y F5.
7. Activar "reducir movimiento" en el sistema y comprobar que el fondo queda quieto, y mirar el fondo a simple vista en un monitor (hojas translúcidas detrás de la tarjeta, sin tapar el texto).
8. **Un caso real:** hacer con la página una cotización que ya hayas hecho en otra herramienta y comparar los totales (IVA y retención) con tu cuenta; si algún redondeo difiere de tu contador, anota el caso.
