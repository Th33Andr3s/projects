# Plan de trabajo: Lista de tareas (`to_do_list`)

Documento de planificación del proyecto. Se rige por las reglas de [CLAUDE.md](../CLAUDE.md). Cada fase termina con una revisión en el navegador y la aprobación de la persona dueña antes de pasar a la siguiente.

---

## 1. Qué es este proyecto

Una lista de tareas personal, de una sola pantalla, para anotar lo que hay que hacer y tacharlo cuando esté hecho. Cada tarea tiene un título y, si se quiere, una fecha límite, una prioridad y una nota. Las tareas se ven agrupadas por cuándo tocan (vencidas, hoy, mañana, esta semana, más adelante, sin fecha), así lo urgente queda arriba sin tener que ordenar nada a mano. Pensada para el día a día de una persona, desde el celular o el computador: la lista del mercado, los pendientes de la semana, lo que hay que pagar.

Funciona así:

1. **Escribir la tarea** en el cuadro de arriba y pulsar Enter o **Agregar**. Si hace falta fecha, prioridad o nota, se despliegan con un toque.
2. **Ver las tareas** agrupadas por fecha, con las vencidas en rojo arriba. Tocar la casilla la marca como hecha y la pasa a la sección **Hechas**, plegada al final.
3. **Editar o borrar** una tarea desde su propio renglón. Al borrar hay unos segundos para **Deshacer**.

**No usa servidor ni cuentas.** Las tareas se guardan en el equipo (`localStorage`). Para pasarlas a otro equipo o tener un respaldo hay **Exportar** e **Importar** en formato JSON, igual que en el Calendario.

### Qué no es

- **No se sincroniza entre equipos.** Las tareas viven en el navegador donde se escribieron. Si eso hace falta, el camino es Supabase (CLAUDE.md 2.9), que sería otro proyecto o una versión posterior; Exportar e Importar cubren el traslado a mano.
- **No tiene subtareas, listas separadas ni etiquetas.** Una sola lista, con prioridad y fecha, basta para el uso personal que se busca; cada capa de organización extra es algo más que mantener y que explicar. Si una tarea es grande, su nota puede llevar los pasos.
- **No manda avisos ni notificaciones.** Lo vencido se ve en rojo al abrir la página, y nada más.
- **No repite tareas** ("cada lunes"). Las tareas que se repiten son eventos, y para eso está el Calendario.

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Stack | HTML, CSS, JS vanilla, Three.js, Font Awesome. Todo por CDN según CLAUDE.md 2.3. Sin Lottie |
| Datos | Ninguno en servidor. Las tareas en `localStorage` (clave `to_do_list_tasks`), las opciones de pantalla en `to_do_list_view` |
| Una tarea | `{ id, title, note, due_date, priority, done, created_at, done_at }`. El id es un texto corto al azar (`crypto.randomUUID`, o un sustituto con `getRandomValues` si no existe). `due_date` es `"AAAA-MM-DD"` o `null`; `priority` es `"high"`, `"normal"` o `"low"`; `created_at` y `done_at` son fechas con hora en formato ISO. El título tiene como máximo 200 caracteres y la nota 2.000; los espacios de los bordes se recortan |
| Grupos | Las pendientes se agrupan por su fecha respecto a hoy: **Vencidas**, **Hoy**, **Mañana**, **Esta semana** (hasta el domingo), **Más adelante** y **Sin fecha**. Dentro de cada grupo, primero por prioridad (alta, normal, baja), luego por fecha y luego por orden de creación. Las **Hechas** van en una sección plegada al final, de la más reciente a la más vieja. Un grupo vacío no se muestra |
| Sin orden manual | No hay arrastrar y soltar ni "subir y bajar": el orden lo dan la fecha y la prioridad, que es lo que una persona cambiaría para subir una tarea. Es más simple de usar con teclado y en celular, y no hay que explicarlo |
| Agregar rápido | Un cuadro de texto siempre visible arriba: escribir y Enter. Debajo, un enlace **Más opciones** despliega fecha (con botones Hoy y Mañana), prioridad y nota. Las opciones desplegadas se quedan abiertas si se usaron la última vez |
| Editar | Tocar el título abre un cuadro de diálogo (`<dialog>`) con los mismos campos, **Guardar**, **Cancelar** y **Borrar**. Se cierra con Escape |
| Marcar hecha | La casilla del renglón. Al marcar, la tarea pasa a Hechas con una transición breve; desmarcarla desde Hechas la devuelve a su grupo |
| Borrar | Sin preguntar: la tarea desaparece y abajo sale un aviso "Tarea borrada · Deshacer" durante 6 segundos. **Borrar hechas** (en la sección Hechas) sí pregunta antes, porque borra varias de una vez, y también se puede deshacer |
| Buscar y filtrar | Un cuadro de búsqueda que filtra por título y nota sin distinguir mayúsculas ni tildes, y una lista para ver **Pendientes** (por defecto: los grupos y la sección Hechas plegada al final), **Hechas** (solo la sección Hechas, abierta) o **Todas** (los grupos y la sección Hechas abierta). Con búsqueda activa se muestran todos los grupos que tengan coincidencias. El filtro se recuerda; la búsqueda no. Si se agrega una tarea que el filtro o la búsqueda esconderían, se quitan para que se vea |
| Resumen | Bajo el título: "5 pendientes · 2 vencidas" (o "Nada pendiente" en verde) |
| Respaldo | **Exportar** descarga `tareas.json` con todas las tareas: `{ "app": "to_do_list", "version": 1, "tasks": [...] }`. **Importar** lee un archivo igual, dice cuántas tareas trae y, al confirmar, las agrega; una con el mismo id que otra ya existente se reemplaza. Si el archivo no es un respaldo de esta página, se avisa y no se toca nada |
| Fechas | Las fechas se guardan como `"AAAA-MM-DD"` sin hora ni zona horaria, y "hoy" se calcula con la fecha local del equipo, para que una tarea del 15 no aparezca vencida la noche del 14 por la zona horaria. Se muestran como "mié 15 oct"; con año solo si no es el actual |
| Estética | La misma familia que las otras herramientas (tarjeta oscura, botones grandes), con acento coral (`#fb923c`) para distinguirla. El rojo solo marca lo vencido y la prioridad alta, siempre acompañado de texto. Animación 3D sutil de fondo con casillas marcadas que flotan |
| Idioma | Interfaz en español. Días y meses abreviados en español, escritos a mano para no depender del idioma del navegador |

---

## 3. Pantalla

Todo vive en un solo `index.html`, en una sola pantalla.

### 3.1 Cabecera
- Título, el resumen ("5 pendientes · 2 vencidas") y debajo el cuadro de búsqueda y la lista Pendientes / Hechas / Todas, en una fila.

### 3.2 Agregar
- Cuadro de texto grande ("¿Qué hay que hacer?") con el botón **Agregar** al lado. Enter agrega.
- Enlace-botón **Más opciones** que despliega: Fecha (campo de fecha con botones **Hoy** y **Mañana** y uno para quitarla), Prioridad (tres botones tipo pestaña: Alta, Normal, Baja; Normal por defecto) y Nota (cuadro de texto de dos líneas).
- Un título vacío no se agrega: el cuadro muestra un aviso corto y se queda con el foco.

### 3.3 Lista
- Grupos con su encabezado ("Hoy", "Vencidas · 2") y sus tareas. Cada renglón: casilla, título, y debajo en pequeño la fecha (en rojo si está vencida), la prioridad si no es Normal (una marca "Alta" en rojo o "Baja" en gris) y el principio de la nota. A la derecha, el botón **Editar** (icono de lápiz) y **Borrar** (icono de papelera), ambos con nombre accesible.
- Tocar el título o Editar abre el diálogo de edición.
- La sección **Hechas** es un `<details>` plegado con el contador ("Hechas · 12") y, dentro, las tareas tachadas con la fecha en que se hicieron y el botón **Borrar hechas**.
- Con la lista vacía del todo, un texto amable ("Todavía no hay tareas. Escribe la primera arriba."). Con búsqueda sin resultados, "Nada coincide con «…»".

### 3.4 Diálogo de edición
- `<dialog>` con los campos Título, Fecha (con Hoy, Mañana y Quitar), Prioridad y Nota, y los botones **Guardar**, **Cancelar** y **Borrar**. Escape cancela. Al abrir, el foco va al título; al cerrar, vuelve al renglón de la tarea.

### 3.5 Pie
- Botones discretos **Exportar** e **Importar**, y el aviso de deshacer cuando corresponde.

### 3.6 Comportamiento común
- Todo lo que cambia se guarda al instante en `localStorage`, en `try/catch`. Si el almacenamiento falla, la página avisa una vez ("No se pueden guardar las tareas en este navegador") y sigue funcionando mientras esté abierta.
- Teclado: Tab recorre búsqueda, filtro, cuadro de agregar, Agregar, Más opciones (y sus campos si están abiertos), cada casilla, título (es un botón), Editar y Borrar de cada tarea, el resumen de Hechas, Borrar hechas, Exportar e Importar. En la prioridad, las flechas cambian entre Alta, Normal y Baja. Foco siempre visible. Al borrar con el teclado, el foco pasa a la tarea siguiente (o a la anterior, o al cuadro de agregar si no queda ninguna).
- Cambios anunciados a lectores de pantalla con `role="status"`: "Tarea agregada", "Tarea hecha", "Tarea borrada. Deshacer disponible", "3 tareas importadas".
- Sin `console.log` ni errores en consola.

---

## 4. Cómo funciona por dentro

Toda la lógica que no toca la pantalla vive en `js/task_tools.js` como funciones puras, para probarla con valores conocidos. Las que dependen de "hoy" lo reciben como parámetro.

### 4.1 Fechas
- `today_key(date)`: `"AAAA-MM-DD"` de una fecha local. `add_days(key, days)`: suma días a una clave. `end_of_week(key)`: la clave del domingo de esa semana (la semana empieza en lunes, como en Colombia).
- `format_due_date(key, today_key)`: "hoy", "mañana", "ayer" o "mié 15 oct" (con ", 2027" si el año no es el de hoy). Los nombres de días y meses son listas propias.
- `group_of(task, today_key)`: `"overdue"` (fecha anterior a hoy), `"today"`, `"tomorrow"`, `"this_week"` (hasta el domingo de esta semana, sin incluir hoy ni mañana), `"later"` o `"no_date"`. Una tarea hecha no tiene grupo de fecha: va a `"done"`.

### 4.2 Orden y grupos
- `sort_tasks(tasks)`: prioridad (alta, normal, baja), luego fecha (sin fecha al final), luego `created_at`. Devuelve una lista nueva.
- `group_tasks(tasks, today_key)`: `{ overdue: [...], today: [...], tomorrow: [...], this_week: [...], later: [...], no_date: [...], done: [...] }`, cada grupo ya ordenado; `done` va por `done_at` descendente.
- `summarize(tasks, today_key)`: `{ pending, overdue, done }`.

### 4.3 Búsqueda
- `normalize_text(text)`: minúsculas y sin tildes ni diéresis (`"Canción"` → `"cancion"`), con `normalize("NFD")` y quitando las marcas.
- `matches(task, query)`: la consulta normalizada está en el título o la nota normalizados. Consulta vacía: todas coinciden.

### 4.4 Tareas
- `create_task(fields, now, id)`: recorta y valida; título obligatorio (1 a 200 caracteres), nota hasta 2.000, fecha `"AAAA-MM-DD"` válida o `null`, prioridad de las tres o `"normal"`. Devuelve `{ task }` o `{ error }`.
- `update_task(task, fields, now)`: lo mismo sobre una existente; marcar hecha pone `done_at`, desmarcar lo quita.
- `sanitize_task(value, now)`: recibe cualquier cosa (de `localStorage` o de un archivo) y devuelve una tarea válida o `null`: id de texto, título válido, nota recortada a su máximo, fecha válida o `null`, prioridad válida o `"normal"`, `done` booleano, `created_at` ISO o la hora actual (`now`), y `done_at` ISO si está hecha (si falta, la fecha de creación). Una lista guardada con tareas dañadas pierde solo las dañadas.

### 4.5 Respaldo
- `export_backup(tasks)`: el JSON `{ app: "to_do_list", version: 1, exported_at, tasks }` con sangría de 2 espacios.
- `parse_backup(text, now)`: `{ tasks }` o `{ error }` con el motivo ("no es un archivo JSON", "no es un respaldo de la lista de tareas", "es de otra versión", "no trae ninguna tarea válida"). Las tareas pasan por `sanitize_task`.
- `merge_tasks(current, imported)`: las importadas reemplazan a las que tienen el mismo id y se agregan las demás; devuelve `{ tasks, added, replaced }`.

### 4.6 Valores de comprobación
La fase 2 corre una prueba automática con estos casos, con hoy = miércoles `2026-10-14`:
- `group_of` con fecha `2026-10-13` → `overdue`; `2026-10-14` → `today`; `2026-10-15` → `tomorrow`; `2026-10-18` (domingo) → `this_week`; `2026-10-19` (lunes) → `later`; sin fecha → `no_date`; hecha con cualquier fecha → `done`.
- Hoy domingo `2026-10-18`: mañana (lunes 19) → `tomorrow` y el martes 20 → `later` (la semana terminó, `this_week` queda vacío).
- `format_due_date`: `2026-10-14` → "hoy"; `2026-10-15` → "mañana"; `2026-10-13` → "ayer"; `2026-10-30` → "vie 30 oct"; `2027-01-05` → "mar 5 ene, 2027".
- `end_of_week("2026-10-14")` → `"2026-10-18"`; `end_of_week("2026-10-18")` → `"2026-10-18"`; `add_days("2026-12-31", 1)` → `"2027-01-01"`; `add_days("2024-02-28", 1)` → `"2024-02-29"`.
- `sort_tasks`: alta sin fecha va antes que normal con fecha de hoy; dos normales, la de fecha más cercana primero; sin fecha después de con fecha; a igualdad, la creada antes primero.
- `normalize_text("  Canción ÁÉÍÓÚ ü ñ ")` → `"cancion aeiou u n"` (la ñ pierde la tilde para que "ano" encuentre "año", y se documenta); `matches` encuentra "pagar" en la nota y "LUZ" en el título "luz".
- `create_task({ title: "  " })` → error "La tarea necesita un título"; título de 201 caracteres → error; `due_date: "2026-02-30"` → error "La fecha no es válida"; `priority: "urgente"` → se guarda `"normal"`.
- `sanitize_task` con `{ id: 5 }` → `null`; con `{ id: "a", title: "x", done: "sí" }` → `done: false`; con una nota de 3.000 caracteres → recortada a 2.000.
- `parse_backup("{}")` → error "no es un respaldo"; `{ app: "calendar", version: 1, events: [] }` → error "no es un respaldo"; `{ app: "to_do_list", version: 2, tasks: [] }` → error "otra versión"; `{ app: "to_do_list", version: 1, tasks: [{ id: 1 }] }` → error "ninguna tarea válida".
- `merge_tasks` con una existente `a` y un archivo con `a` (cambiada) y `b` → 2 tareas, `added: 1`, `replaced: 1`, y `a` queda con los datos del archivo.
- Ida y vuelta: `parse_backup(export_backup(tasks)).tasks` es igual a `tasks`.
- `summarize` con 3 pendientes (una vencida) y 2 hechas → `{ pending: 3, overdue: 1, done: 2 }`.

---

## 5. Cómo se muestran los números y las fechas
- Contadores con punto de miles si pasan de 999 ("1.250 hechas") y en singular cuando toca ("1 pendiente", "1 vencida").
- Fechas como "mié 15 oct" o "hoy", "mañana", "ayer"; en las hechas, "hecha el mar 13 oct".
- El campo de fecha es `type="date"`, que en celular abre el selector del sistema.

---

## 6. Diseño visual y animación

- Fondo oscuro neutro con acento coral (`#fb923c`) para el botón Agregar, la prioridad seleccionada y los encabezados de grupo. Las vencidas y la prioridad alta en el color de atención (`#fda4af`), siempre con texto ("Vencida", "Alta"). Verde solo para "Nada pendiente". Contraste de al menos 4,5 a 1 en textos (WCAG AA). El contorno de foco es cian (`#4cc9f0`), para no confundirse con el coral.
- Tarjeta de hasta 640 px. Cada renglón mide al menos 56 px de alto y la casilla al menos 28 px, para el dedo. Los botones Editar y Borrar son de icono con nombre accesible, de 44 px.
- Los renglones hechos van tachados y atenuados. Al marcar una tarea, una transición de 250 ms la atenúa antes de pasar a Hechas; con `prefers-reduced-motion` no hay transición.
- **Animación 3D (Three.js):** casillas marcadas translúcidas (cuadrados con su marca de verificación dibujada en una textura) que flotan y giran despacio detrás de la tarjeta y hacen un leve destello al marcar una tarea como hecha. Decorativa: la página funciona igual si no carga. Three.js se importa con `import()` dentro de `animations.js`, como en las otras herramientas.
- Según CLAUDE.md 2.10: `requestAnimationFrame`, tope de 30 cuadros por segundo, `pixelRatio` máximo 2, se ajusta al cambiar el tamaño, se pausa con la pestaña oculta y con `prefers-reduced-motion` se queda quieta.
- Favicon de la marca y pie de copyright según CLAUDE.md 2.16.

---

## 7. Fases de desarrollo

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Estructura de carpetas (con el favicon y el pie de copyright), `index.html` estático con cabecera, cuadro de agregar con sus opciones, grupos de ejemplo, sección Hechas, diálogo de edición y pie, `css/styles.css` responsive y README | Hecha |
| 2 | `js/task_tools.js`: fechas, grupos, orden, búsqueda, validación, limpieza y respaldo, con su prueba de valores conocidos. `js/main.js`: agregar (con opciones), marcar hecha, borrar con Deshacer, grupos en vivo, resumen y guardado en `localStorage` | Hecha |
| 3 | Diálogo de edición, búsqueda, filtro Pendientes / Hechas / Todas, sección Hechas con Borrar hechas, foco al borrar y avisos para lectores de pantalla | Hecha |
| 4 | Exportar e Importar JSON, opciones de pantalla recordadas, transición al marcar y animación 3D de fondo (`js/animations.js`) | Hecha |
| 5 | Cierre: checklist de CLAUDE.md 2.11, tarjeta en el portal, fila en CLAUDE.md 2.12, prueba en celular y en GitHub Pages | Hecha |

---

## 8. Estructura de archivos del proyecto

Según CLAUDE.md 2.5:

```
to_do_list/
├── index.html             # Única página
├── README.md              # Título, descripción y ejecución local
├── PLAN.md                # Este documento
├── css/
│   └── styles.css         # Todos los estilos
├── js/
│   ├── main.js            # Pantalla: agregar, lista por grupos, edición, búsqueda, deshacer, respaldo, guardado
│   ├── task_tools.js      # Fechas, grupos, orden, búsqueda, validación, limpieza y respaldo. Funciones puras
│   └── animations.js      # Fondo 3D con Three.js
└── assets/
    └── icons/
        └── favicon.ico    # Favicon de la marca (CLAUDE.md 2.16)
```

Sin `config.js` (no usa Supabase) y sin `lottie/` ni `img/` (no los necesita). `task_tools.js` es la división de `main.js` que permite 2.5: toda la lógica que se puede probar sin pantalla va ahí.

---

## 9. Ejecución local

Desde esta carpeta, `python ../dev_server.py` y abrir http://localhost:8080 (ver CLAUDE.md 2.8).

---

## 10. Riesgos y cómo se manejan

| Riesgo | Manejo |
|---|---|
| Las tareas viven solo en este navegador y se pierden al borrar sus datos | Exportar a JSON como respaldo; el README lo dice. Si hace falta verlas en varios equipos, el camino es Supabase (sección 1, "Qué no es") |
| Una tarea del día 15 aparece vencida la noche del 14 por la zona horaria | Las fechas son claves `"AAAA-MM-DD"` sin hora, y "hoy" se calcula con la fecha local; nunca pasan por `Date.toISOString()` |
| La página queda abierta de un día para otro y los grupos se desactualizan | Al volver a la pestaña (`visibilitychange`) y cada minuto mientras está visible se recalcula "hoy" y, si cambió, se redibuja la lista |
| Borrar por error | Deshacer durante 6 segundos para una tarea y para "Borrar hechas"; además, la pregunta previa en "Borrar hechas" |
| Datos dañados en `localStorage` o un archivo de respaldo ajeno | `sanitize_task` descarta solo lo dañado; `parse_backup` rechaza lo que no sea un respaldo de esta página sin tocar nada |
| Muchas tareas (cientos) frenan el dibujo | La lista se redibuja entera en cada cambio, que con 500 tareas tarda milisegundos; se mide en la fase 3 con 1.000 tareas y, si hace falta, las Hechas se dibujan solo al desplegar la sección |
| El 3D pesa en un equipo lento | Pocas piezas, tope de cuadros, y la página funciona sin 3D |

---

## 11. Cierre: checklist de CLAUDE.md 2.11

Revisión técnica hecha con la aplicación corriendo, servida desde el portal en una subcarpeta (`/to_do_list/`), como quedará en GitHub Pages.

| Punto | Estado |
|---|---|
| Estructura como en 2.5 | Cumple: `index.html`, `README.md`, `css/styles.css`, `js/main.js`, `js/animations.js` y `assets/icons/favicon.ico`. Sin `config.js` (no usa Supabase) y sin `lottie/` ni `img/` (no los necesita). Además de `main.js` y `animations.js` lleva `js/task_tools.js` (fechas, grupos, orden, búsqueda, validación, limpieza y respaldo), que 2.5 permite al dividir la lógica, y este `PLAN.md` |
| `README.md` con título, descripción y ejecución local | Cumple, con el comando `python ../dev_server.py` |
| 360 px hasta escritorio | Cumple: sin desplazamiento horizontal desde 320 hasta 1920 px, con la lista vacía, con 7 tareas (una con un título de 120 letras sin espacios y otra con una nota larga) y con el diálogo de edición abierto, que cabe entero en pantalla en todos los tamaños. Con la lista vacía la página no se desplaza en ninguno de los tamaños probados |
| Teclado y foco visible | Cumple: Tab recorre enlace de salto, búsqueda, filtro, cuadro de agregar, Agregar, Más opciones (y fecha, Hoy, Mañana, Quitar, prioridad y nota si están abiertas), y por cada tarea su casilla, título, Editar y Borrar; el resumen de Hechas, Borrar hechas, Exportar e Importar. La prioridad son tres opciones de radio nativas (flechas y Espacio funcionan sin código). Escape cierra los diálogos (comprobado con una tecla real) y el foco vuelve a la tarea; al marcar o borrar, el foco pasa a la tarea vecina (o al cuadro de agregar). El diálogo de confirmación empieza con el foco en Cancelar. Todos los controles tienen nombre accesible ("Marcar como hecha: Pagar la luz", "Editar: …", "Borrar: …"), sin ids repetidos ni referencias rotas, y las acciones se anuncian con `role="status"` |
| Sin errores en la consola | Cumple: limpia al cargar y al usar, y también con Three.js caído, con el almacenamiento bloqueado (sale el aviso y la lista sigue funcionando mientras la página esté abierta), con datos guardados dañados (JSON roto, tareas sin título, prioridades y fechas inválidas: se salva lo salvable) y con movimiento reducido |
| Rutas relativas con `./` | Cumple. Ninguna ruta absoluta; probado servido desde `/to_do_list/` y abierto desde la tarjeta del portal |
| Librerías por CDN y versiones de 2.3 | Cumple: Font Awesome 6.7.2 y Three.js 0.170.0 (con importmap). No se carga Lottie porque no se usa. Three.js se importa con `import()` dentro de `animations.js` para que su caída no rompa la lista |
| `prefers-reduced-motion` y pausa con pestaña oculta | Cumple por construcción en el fondo: mismo esquema de `animations.js` de las otras herramientas (quieto con movimiento reducido, bucle cancelado con la pestaña oculta, 30 cuadros por segundo como máximo, `pixelRatio` máximo 2). La transición al marcar una tarea se omite con movimiento reducido (comprobado simulando la preferencia: la tarea cambia de sitio al instante). En el navegador de pruebas la ventana está oculta, así que no se pudo mirar el dibujo de las casillas ni la transición; solo se comprobó que la escena se crea, el lienzo toma el tamaño de la ventana y el contexto no se pierde |
| `localStorage` con prefijo y `try/catch` | Cumple: dos claves, `to_do_list_tasks` y `to_do_list_view`, con lectura y escritura dentro de `try/catch`; lo dañado se descarta campo por campo |
| Código en inglés, comentarios en español, snake_case | Cumple. Sin `console.*`, TODO, `eval` ni `innerHTML` (todo lo que escribe la persona entra con `textContent`). `Math.random` solo aparece como último recurso para el identificador de una tarea (si el navegador no tiene `crypto`) y en el adorno de la animación. Sin constantes, funciones, exportaciones ni ids sin uso. Los tres módulos pasan la revisión de sintaxis |
| Favicon y copyright (2.16) | Cumple: `assets/icons/favicon.ico` enlazado en el `<head>` (responde 200 servido desde la subcarpeta) y pie `© 2026 Andres Felipe Olaya - Dev Layer` al final de la tarjeta |
| Agregado al portal | Cumple: tarjeta en el `index.html` de la raíz (abre `./to_do_list/`), fila nueva en la tabla 2.12 de CLAUDE.md y carpeta en el árbol de 2.4 |
| Una persona sin contexto lo entiende | Un cuadro arriba que dice "¿Qué hay que hacer?" y un botón Agregar; la fecha, la prioridad y la nota están a un toque en "Más opciones"; las tareas aparecen ya ordenadas por cuándo tocan, con las vencidas en rojo y dichas en palabras ("Vencida · jue 8 oct", "Prioridad alta"); borrar avisa y deja deshacer; un texto amable cuando no hay nada |

### Cuánto hay que desplazarse (píxeles extra de alto de la página)

Medido con la lista vacía y con 7 tareas (pendientes en todos los grupos y una hecha, con las hechas abiertas y "Más opciones" abierto). La lista crece con las tareas, así que con tareas la página se desplaza siempre; con la lista vacía no.

| Pantalla | Lista vacía | 7 tareas |
|---|---|---|
| 320×640 | 0 | 1426 |
| 360×740 | 0 | 1137 |
| 390×844 | 0 | 979 |
| 768×1024 | 0 | 570 |
| 1366×768 | 0 | 794 |
| 1920×950 | 0 | 644 |

Además:
- **Lógica:** 109 comprobaciones automáticas, entre ellas las de 4.6, y una prueba con 5.000 tareas al azar con campos dañados de todo tipo (ninguna rompe `sanitize_task` ni deja una tarea con forma inválida). Los cálculos con días se probaron sobre 400 días seguidos, años bisiestos, fin de año y semanas que empiezan en lunes.
- **Velocidad:** agrupar 5.000 tareas, 10 ms; buscar en 5.000, 5 ms. En el navegador, con 1.000 tareas la lista se dibuja entera en unos 30 ms por cambio y una búsqueda tarda menos de 20 ms.
- **Cambio de día:** con la página abierta y simulando que pasa la medianoche, al volver a la pestaña "Mañana" pasa a "Hoy" y "Hoy" a "Vencidas" sin recargar.
- **Respaldo:** exportar baja `tareas.json` con las 4 tareas de la prueba; importar rechaza con su motivo un archivo ajeno, uno que no es JSON, uno de otra versión y uno sin tareas válidas; con uno bueno pregunta ("El archivo trae 2 tareas (1 reemplaza a una que ya está)") y, al aceptar, fusiona; al cancelar no toca nada.
- **Deshacer:** borrar una, borrar varias hechas y restaurar funcionan; el aviso se apaga solo a los 6 segundos.
- **Contraste de colores (WCAG AA):** todos los textos superan 4,5 a 1 (el más bajo, el texto atenuado sobre las fichas, da 6,3). El foco, los bordes de los controles y el acento superan 3 a 1 (el más bajo, el borde de los controles sobre la tarjeta, da 4,0).
- **Sin secretos ni datos personales:** el proyecto no usa claves, servidores ni cuentas. Las tareas viven solo en el navegador y en el archivo de respaldo que la persona descargue.

### Pruebas que solo se pueden hacer a mano
1. En **uno o dos celulares** (uno con iPhone si es posible): agregar tareas con el teclado del teléfono, usar el selector de fecha del sistema, marcar, editar y borrar con el dedo (que las casillas y los botones se toquen sin error), y deshacer. Mirar que el aviso de deshacer no tape lo que se está haciendo.
2. **Mirar el fondo y la transición** a simple vista en un monitor: casillas vacías y marcadas, coral, tenues, detrás de la tarjeta, con un destello al marcar una tarea, y la tarea atenuándose un momento antes de pasar a Hechas.
3. **Exportar e importar de verdad:** descargar `tareas.json`, comprobar que se guarda donde esperas, borrar los datos del sitio y volver a importarlo (el selector de archivos del sistema no se pudo abrir en el navegador de pruebas; allí se simuló).
4. En **GitHub Pages**, tras publicar: abrir `https://<usuario>.github.io/projects/to_do_list/` y comprobar que carga sin errores, con iconos y fondo, y que las tareas se guardan al recargar. Si se ve una versión vieja, recargar con Ctrl y F5.
5. Activar "reducir movimiento" en el sistema y comprobar que el fondo queda quieto y las tareas cambian de sitio sin transición.
6. **Un día de uso real:** apuntar las tareas de la semana con fechas, dejar la página abierta de un día para otro y comprobar que "Mañana" se vuelve "Hoy" al volver. Probar también en un navegador con el almacenamiento bloqueado (ventana privada estricta) para ver el aviso.
