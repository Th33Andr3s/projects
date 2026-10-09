# Plan de trabajo: Calendario (`calendar`)

Documento de planificación del proyecto. Se rige por las reglas de [CLAUDE.md](../CLAUDE.md). Cada fase termina con una revisión en el navegador y la aprobación de la persona dueña antes de pasar a la siguiente.

---

## 1. Qué es este proyecto

Una agenda personal sencilla: un calendario de mes donde se anotan eventos por día (citas, cumpleaños, pagos, recordatorios) y se ven de un vistazo los próximos. Pensada para usarse desde el celular, sin cuentas ni servidor, con los festivos de Colombia ya marcados.

Funciona así:

1. **Ver el mes** en una cuadrícula. Cada día muestra puntos de color por cada evento que tiene; los festivos van marcados.
2. **Tocar un día** para ver sus eventos y agregar uno nuevo con título, hora opcional, color y notas.
3. **Ver la lista de lo que viene** en la pestaña Próximos: los eventos de los siguientes días, en orden.

**No usa servidor ni cuentas.** Los eventos se guardan en el equipo (`localStorage`). Para pasarlos a otro equipo o tener un respaldo hay **Exportar** e **Importar** en formato JSON.

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Stack | HTML, CSS, JS vanilla, Three.js, Font Awesome. Todo por CDN según CLAUDE.md 2.3. Sin Lottie |
| Datos | Solo en `localStorage`, como manda CLAUDE.md 2.9 por defecto: una agenda personal no necesita datos compartidos ni login. Si más adelante se quiere ver la misma agenda en varios equipos, el paso siguiente sería Supabase; la exportación a JSON ya deja los datos listos para migrarlos |
| Vistas | Dos pestañas: **Mes** (cuadrícula con el detalle del día elegido) y **Próximos** (lista de los eventos desde hoy). Sin vista de semana: en celular no aporta sobre el mes con el detalle del día |
| Evento | Título (obligatorio), fecha (obligatoria), hora de inicio y de fin (opcionales; sin hora es "todo el día"), color (uno de seis) y notas (opcionales) |
| Repetición | No, cada semana, cada mes o cada año (para cumpleaños y pagos). Se repite sin fecha de fin. Editar o borrar un evento repetido afecta a todas sus repeticiones; no hay excepciones por fecha |
| Festivos | Los festivos de Colombia se calculan con la regla legal (sección 4.2), no con una lista fija, así sirven para cualquier año. Se muestran como un día marcado con su nombre, no como eventos de la persona |
| Semana | Empieza en lunes. Es una constante en el código por si se quiere cambiar a domingo |
| Fechas | Cada fecha se maneja como texto `AAAA-MM-DD` en la zona horaria del equipo, nunca como fecha UTC: así un evento del 12 nunca aparece el 11 |
| Edición | Un cuadro de diálogo nativo (`<dialog>`) con el formulario del evento: lo abre, atrapa el foco y lo cierra con Escape el propio navegador, sin librerías |
| Borrar | Pide confirmación dentro del mismo diálogo ("¿Borrar este evento?" con botón de confirmar). Sin papelera |
| Respaldo | **Exportar** descarga `calendario.json` con todos los eventos. **Importar** lee un archivo igual, muestra cuántos eventos trae y, al confirmar, los agrega; si uno ya existe (mismo id) lo reemplaza |
| Estética | Propia, limpia y sobria, como las calculadoras, con acento azul. Animación 3D sutil de fondo |
| Idioma | Interfaz en español. Nombres de meses y días escritos en el código, sin depender del idioma del navegador |

---

## 3. Pantalla

Todo vive en un solo `index.html`, en una sola pantalla con dos pestañas.

### 3.1 Mes
- **Cabecera:** botón "mes anterior", el nombre del mes y el año ("Octubre de 2026"), botón "mes siguiente" y un botón **Hoy** que vuelve al mes y al día actuales.
- **Cuadrícula:** siete columnas, de lunes a domingo, con las iniciales de los días arriba. Se muestran los días del mes y, atenuados, los del mes anterior y siguiente que completan la primera y la última semana. Siempre seis filas, para que la cuadrícula no cambie de alto al pasar de mes.
- Cada día muestra su número y hasta tres puntos del color de sus eventos (si hay más, un "+2"). El día de hoy lleva un círculo con el acento. Los festivos llevan un punto distinto y su nombre sale en el detalle del día. El día elegido queda resaltado.
- **Detalle del día**, debajo de la cuadrícula (a la derecha en pantallas anchas, ver sección 6): la fecha completa ("Lunes 12 de octubre de 2026"), el nombre del festivo si lo es, la lista de eventos del día ordenados por hora (los de todo el día primero), cada uno con su color, título, hora y un botón de editar. Debajo, el botón **Agregar evento**, que abre el diálogo con esa fecha ya puesta.
- Al cargar se muestra el mes actual con el día de hoy elegido.

### 3.2 Próximos
- Lista de los eventos desde hoy hasta 90 días adelante, agrupados por día ("Hoy", "Mañana", "Jueves 15 de octubre"), con la repetición ya resuelta (un cumpleaños anual aparece en su fecha de este año).
- Cada evento muestra color, título, hora y notas en una línea (recortadas), y se toca para editarlo.
- Si no hay nada: "No tienes eventos en los próximos 90 días." con el botón **Agregar evento** para hoy.
- Los festivos aparecen en la lista como días marcados, sin botón de editar.

### 3.3 Diálogo del evento
- Campos: **Título** (hasta 80 caracteres), **Fecha** (`type="date"`), **Todo el día** (casilla, marcada por defecto; al desmarcarla aparecen **Inicio** y **Fin** con `type="time"`), **Color** (seis botones redondos, uno elegido), **Repetir** (lista: No, Cada semana, Cada mes, Cada año; si se elige una repetición, una línea avisa que la fecha es la del primer día y que los cambios valen para todas las repeticiones) y **Notas** (hasta 500 caracteres). Se guardan hasta 5.000 eventos; al llegar al tope el título avisa que hay que borrar alguno.
- Botones: **Guardar** y **Cancelar**. Al editar, además **Borrar**, que pide confirmación dentro del diálogo.
- Validación al guardar: el título no puede quedar vacío; la fecha debe ser válida; si hay hora de fin, debe ser posterior a la de inicio. El aviso sale bajo el campo y el foco va al primer campo con error.
- Al guardar, el diálogo se cierra, el calendario se actualiza y se muestra el día del evento (aunque esté en otro mes). El foco vuelve al día en la cuadrícula o, en Próximos, al evento; al borrar en Próximos va a la pestaña. Se avisa a lectores de pantalla ("Evento guardado").

### 3.4 Exportar e importar
- Dos botones discretos en el pie de la tarjeta: **Exportar** e **Importar**.
- Exportar descarga `calendario.json`: `{ "app": "calendar", "version": 1, "events": [...] }`. Si no hay eventos, el botón está desactivado.
- Importar abre el selector de archivos. Si el archivo no tiene ese formato, avisa ("Este archivo no es un respaldo del calendario"); lo mismo si es de otra versión, si no trae ningún evento que sirva, si pesa más de 5 MB o si con él se pasaría el tope de 5.000 eventos, y en esos casos solo se ofrece **Cerrar**. Si sirve, muestra cuántos eventos trae, cuántos reemplazarían a uno existente (mismo id) y cuántos no servían y se dejan fuera, con **Importar** y **Cancelar**. Al importar, la animación de fondo hace su destello y se avisa a lectores de pantalla.

### 3.5 Comportamiento común
- Lo que se recuerda va en `localStorage`, en `try/catch`: los eventos en `calendar_events` y la última pestaña vista en `calendar_view`. Al abrir la página siempre se ve el mes de hoy con el día de hoy elegido, aunque se hubiera cerrado en otro mes. Si el almacenamiento falla, el calendario funciona igual pero avisa una sola vez, arriba, que no puede guardar ("Tu navegador no permite guardar. Los eventos se perderán al cerrar la página.").
- Teclado: Tab recorre pestañas, cabecera, cuadrícula (un solo tabulador: entra al día elegido), detalle y botones; en las pestañas, flechas, Inicio y Fin cambian de vista; en la cuadrícula, las flechas mueven el día, Inicio y Fin van al primer y último día de la semana, Re Pág y Av Pág cambian de mes, Enter abre el diálogo para agregar. Foco siempre visible.
- Sin `console.log` ni errores en consola.

---

## 4. Reglas de fechas

Toda la lógica de fechas vive en `js/dates.js` como funciones puras, y la de eventos (guardar, repetir, exportar) en `js/events.js`. Ninguna toca la pantalla, para poder probarlas con valores conocidos.

### 4.1 Cuadrícula del mes
- Con la semana en lunes, el primer día de la cuadrícula es el lunes anterior o igual al día 1 del mes; siempre se generan 42 días (seis semanas).
- La fecha es un texto `AAAA-MM-DD`. Sumar días, comparar y saber el día de la semana se hace con `Date` construido con año, mes y día por separado (hora local), nunca con `new Date("AAAA-MM-DD")`, que lo interpreta en UTC.
- "Hoy" se calcula con la fecha local del equipo al cargar y se vuelve a leer al volver a la pestaña (`visibilitychange`), por si la página quedó abierta de un día para otro.

### 4.2 Festivos de Colombia (Ley 51 de 1983)
- **Fijos:** 1 de enero (Año Nuevo), 1 de mayo (Día del Trabajo), 20 de julio (Independencia), 7 de agosto (Batalla de Boyacá), 8 de diciembre (Inmaculada Concepción), 25 de diciembre (Navidad).
- **Se pasan al lunes siguiente** si no caen en lunes: 6 de enero (Reyes Magos), 19 de marzo (San José), 29 de junio (San Pedro y San Pablo), 15 de agosto (Asunción de la Virgen), 12 de octubre (Día de la Raza), 1 de noviembre (Todos los Santos), 11 de noviembre (Independencia de Cartagena).
- **Según la Pascua** (domingo de Pascua calculado con el algoritmo de Meeus): Jueves Santo (Pascua − 3), Viernes Santo (Pascua − 2), Ascensión (Pascua + 43, ya en lunes), Corpus Christi (Pascua + 64, lunes) y Sagrado Corazón (Pascua + 71, lunes).
- Son 18 festivos al año. En los años en que el Sagrado Corazón cae el mismo lunes que San Pedro y San Pablo (20 de los 111 años entre 1990 y 2100, por ejemplo 2025 y 2030) quedan 17 días distintos y el día muestra los dos nombres juntos. La tabla está en un solo lugar por si cambia la ley.

### 4.3 Repeticiones
- Un evento con repetición aparece en su fecha original y en cada semana, mes o año siguiente. Cada mes: el mismo día del mes; si el mes no tiene ese día (31), ese mes no aparece. Cada año: la misma fecha; un 29 de febrero solo aparece en años bisiestos.
- Para dibujar un mes o la lista de próximos se piden las apariciones de cada evento dentro de un rango de fechas; no se guardan copias.

### 4.4 Valores de comprobación
La fase 2 corre una prueba automática con estos casos, calculados aparte:
- Octubre de 2026 empieza en jueves: la cuadrícula arranca el lunes 28 de septiembre y termina el domingo 8 de noviembre (42 días).
- Festivos de 2026 (Pascua el 5 de abril): 1 y 12 de enero, 23 de marzo, 2 y 3 de abril, 1 y 18 de mayo, 8, 15 y 29 de junio, 20 de julio, 7 y 17 de agosto, 12 de octubre, 2 y 16 de noviembre, 8 y 25 de diciembre. Dieciocho en total.
- Pascua de otros años: 20 de abril de 2025, 28 de marzo de 2027.
- Un evento mensual el 31 de enero aparece el 31 de marzo y no aparece en febrero ni en abril. Uno anual el 29 de febrero de 2024 aparece en 2028 y no en 2026. Uno semanal el lunes 5 de octubre de 2026 aparece el 12, el 19 y el 26.

---

## 5. Cómo se muestran las fechas y horas
- Fecha completa: "Lunes 12 de octubre de 2026". En la lista de próximos, "Hoy" y "Mañana" en lugar de la fecha.
- Horas en formato de 12 horas con "a. m." y "p. m.", como se dice en Colombia: "3:30 p. m.", "8:00 a. m. – 9:30 a. m.". Los campos del diálogo usan `type="time"`, que el navegador muestra como la persona lo tenga configurado.
- Sin hora: "Todo el día".
- Nombres de meses y días en minúscula dentro de frases, con mayúscula inicial cuando empiezan la frase.

---

## 6. Diseño visual y animación

- Fondo oscuro neutro con un acento azul para la pestaña activa, el día de hoy, el botón principal y el contorno del día elegido. Buen contraste en todo (WCAG AA, 4,5 a 1 en textos; 3 a 1 en puntos, bordes y foco). El contorno de foco es ámbar, para no confundirse con el azul del acento.
- Tarjeta central de hasta 560 px de ancho en celular y tableta. **A partir de 900 px de ancho**, la tarjeta crece hasta 960 px y la vista Mes pone la cuadrícula a la izquierda y el detalle del día a la derecha, para que el calendario entero quepa sin desplazarse en un portátil.
- Celdas de la cuadrícula de al menos 44 px de alto en celular, para tocarlas con el dedo. Los seis colores de evento se eligen para distinguirse entre sí sobre el fondo oscuro y para que ninguno se confunda con el del festivo ni con el acento.
- **Animación 3D (Three.js):** hojas finas y translúcidas azules, con una franja arriba y una cuadrícula de días, como páginas sueltas de un calendario, que flotan y giran despacio detrás de la tarjeta (9 en pantallas pequeñas y 20 en las grandes) y hacen un leve destello cuando se guarda o se borra un evento o se importa un respaldo. No destellan al cancelar, al cambiar de mes o de pestaña, ni si el guardado falla por errores en el formulario. Decorativa: la página funciona igual si no carga. Three.js se importa con `import()` dentro de `animations.js`, como en las calculadoras.
- Según CLAUDE.md 2.10: `requestAnimationFrame`, tope de 30 cuadros por segundo, `pixelRatio` máximo 2, se ajusta al cambiar el tamaño, se pausa con la pestaña oculta y con `prefers-reduced-motion` se queda quieta.

---

## 7. Fases de desarrollo

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Estructura de carpetas, `index.html` con las dos pestañas, la cuadrícula de un mes de ejemplo, el detalle del día y el diálogo del evento (todo estático), `css/styles.css` responsive y README | Hecha |
| 2 | Reglas de fechas (`js/dates.js`: cuadrícula, festivos, formato) con su prueba de valores conocidos, y la vista Mes navegable (`js/main.js`): cambiar de mes, Hoy, elegir día con el dedo y con el teclado | Hecha |
| 3 | Eventos (`js/events.js`): guardar y cargar en `localStorage`, repeticiones, el diálogo de agregar, editar y borrar (con lo que se activan los botones **Agregar evento**, hoy ocultos), los puntos en la cuadrícula, el detalle del día y la pestaña Próximos con sus eventos | Hecha |
| 4 | Exportar e importar JSON y animación 3D de fondo (`js/animations.js`) | Hecha |
| 5 | Cierre: checklist de CLAUDE.md 2.11, tarjeta en el portal, fila en CLAUDE.md 2.12, prueba en celular y en GitHub Pages | Hecha (las pruebas en celular, de descarga y en GitHub Pages quedan para la persona dueña, sección 11) |

---

## 8. Estructura de archivos del proyecto

```
calendar/
├── index.html
├── README.md
├── PLAN.md                  # Este documento
├── css/
│   └── styles.css
└── js/
    ├── main.js              # Pantalla: pestañas, cuadrícula, detalle, diálogo, lista, respaldo
    ├── dates.js             # Cuadrícula del mes, festivos de Colombia y formato de fechas
    ├── events.js            # Guardar y cargar eventos, repeticiones, exportar e importar
    └── animations.js        # Hojas 3D de fondo
```

`dates.js` y `events.js` son archivos de lógica importados desde `main.js`, como permite CLAUDE.md 2.5. Sin carpeta `assets/`: no hay imágenes, iconos propios ni Lottie.

---

## 9. Ejecución local

Desde esta carpeta, `python ../dev_server.py` y abrir http://localhost:8080 (ver CLAUDE.md 2.8).

---

## 10. Riesgos y cómo se manejan

| Riesgo | Manejo |
|---|---|
| Los eventos viven solo en este navegador y se pierden al borrar sus datos | Exportar a JSON como respaldo; el README lo dice. Si hace falta verlos en varios equipos, el camino es Supabase (sección 2.9 de CLAUDE.md) |
| Un evento aparece un día antes o después por la zona horaria | Las fechas son textos `AAAA-MM-DD` y `Date` se construye con año, mes y día por separado; nunca se usa `new Date("AAAA-MM-DD")` |
| La página queda abierta y "hoy" cambia | Se vuelve a leer la fecha al volver a la pestaña |
| Muchos eventos en un día | La cuadrícula muestra tres puntos y "+N"; el detalle del día lista todos |
| Cambia la ley de festivos | La tabla de festivos está en un solo lugar de `dates.js` |
| Un archivo JSON ajeno o dañado al importar | Se valida la forma del archivo y de cada evento; lo que no sirve se descarta y se avisa cuántos eventos entraron |
| `localStorage` lleno o bloqueado | Todo en `try/catch`; un aviso fijo dice que no se puede guardar, y el calendario sigue funcionando en la sesión |
| El 3D pesa en un equipo lento | Pocas hojas, tope de cuadros, y la página funciona sin 3D |

---

## 11. Cierre: checklist de CLAUDE.md 2.11

Revisión técnica hecha con la aplicación corriendo, también servida desde el portal en una subcarpeta, como quedará en GitHub Pages.

| Punto | Estado |
|---|---|
| Estructura como en 2.5 | Cumple. Sin `config.js` (no usa Supabase) y sin `assets/` (no hay imágenes, iconos propios ni Lottie), como permite 2.5. Además de `main.js` y `animations.js` lleva `dates.js` y `events.js` (la lógica de fechas y de eventos), que 2.5 permite al dividir la lógica, y este `PLAN.md` |
| `README.md` con título, descripción y ejecución local | Cumple, con el comando `python ../dev_server.py` |
| 360 px hasta escritorio | Cumple: sin desplazamiento horizontal en ninguna vista desde 320 hasta 1920 px. En portátil (1366×768) y en 1920×950 el mes cabe entero sin desplazarse vertical; en celular y tableta se desplaza hasta el detalle del día (ver la tabla de abajo) |
| Teclado y foco visible | Cumple: Tab recorre enlace de salto, pestaña activa, cabecera, un solo punto de entrada a la cuadrícula, detalle, botones y respaldo; las flechas, Inicio, Fin, Re Pág y Av Pág mueven el día; Enter agrega un evento; Escape cierra el diálogo y devuelve el foco. Todos los controles tienen contorno ámbar de 3 px (los colores del diálogo lo muestran en su círculo). Los 98 controles tienen nombre accesible, sin ids repetidos ni referencias rotas; pestañas con `role="tablist"`, `tab` y `tabpanel`, cuadrícula con `role="grid"` y cada día con su fecha, "hoy", festivo y cantidad de eventos |
| Sin errores en la consola | Cumple: limpia al cargar y al usar, y también con Three.js caído, con el almacenamiento bloqueado, lleno o con datos dañados (JSON roto, `null`, entradas de tipos equivocados: se ignoran las malas y se muestra lo bueno) |
| Rutas relativas con `./` | Cumple. Ninguna ruta absoluta; probado servido desde `/calendar/` y abierto desde la tarjeta del portal |
| Librerías por CDN y versiones de 2.3 | Cumple: Font Awesome 6.7.2 y Three.js 0.170.0. No se carga Lottie porque no se usa. Three.js se importa con `import()` dentro de `animations.js` para que su caída no rompa el calendario |
| `prefers-reduced-motion` y pausa con pestaña oculta | Cumple: con movimiento reducido queda una imagen quieta, sin bucle y sin destello; al ocultar la pestaña el bucle se cancela y se retoma al volver. Tope de 30 cuadros por segundo comprobado y `pixelRatio` máximo 2 en el código |
| `localStorage` con prefijo y `try/catch` | Cumple: dos claves, `calendar_events` y `calendar_view`, con lectura y escritura dentro de `try/catch`; lo dañado se descarta campo por campo y, si no se puede guardar, un aviso fijo lo dice y el calendario sigue funcionando en la sesión |
| Código en inglés, comentarios en español, snake_case | Cumple. Sin `console.*`, TODO, `eval` ni `innerHTML`. Sin constantes, funciones ni importaciones sin uso; lo que solo se usa dentro de su propio archivo ya no se exporta |
| Agregado al portal | Cumple: tarjeta en el `index.html` de la raíz y fila actualizada en la tabla 2.12 de CLAUDE.md |
| Una persona sin contexto lo entiende | Dos pestañas con nombre e icono; tocar un día muestra sus eventos y un botón claro para agregar uno; el diálogo pide solo el título y la fecha; los avisos salen bajo el campo; un texto en el pie explica que los eventos viven solo en el navegador y ofrece el respaldo |

### Cuánto hay que desplazarse en la vista Mes (píxeles extra de alto de la página)

Medido con un día de tres eventos elegido (el 12 de octubre, festivo, con dos eventos repetidos y uno con hora).

| Pantalla | Píxeles extra | Ancho de cada día |
|---|---|---|
| 320×640 | 518 | 36 px |
| 360×740 | 357 | 41 px |
| 390×844 | 255 | 41 px |
| 768×1024 | 142 | 70 px |
| 1366×768 | 0 | 79 px |
| 1920×950 | 0 | — |

La vista Próximos es una lista y crece con los eventos, así que siempre se desplaza.

Además:
- **Exactitud:** las reglas de fechas coinciden con los valores de comprobación de 4.4 (cuadrícula de octubre de 2026, Pascua de 2024 a 2027 y de 2038 y 2285, los 18 festivos de 2026, repeticiones mensuales el día 31 y anuales el 29 de febrero); los 111 años entre 1990 y 2100 cumplen que los festivos que se pasan al lunes caen en lunes.
- **Contraste de colores (WCAG AA):** todos los textos superan 4,5 a 1 (el más bajo, el texto de borrar sobre la tarjeta, da 5,9). El foco, los bordes de los controles, el círculo de hoy, el día elegido, el anillo del festivo y los seis colores de evento superan 3 a 1 (el más bajo, el borde de los controles sobre la tarjeta, da 4,0).
- **Respaldo:** exportar e importar probados con archivos válidos, con eventos dañados dentro, de otra aplicación, de otra versión, demasiado grandes y por encima del tope de 5.000 eventos.
- **Sin secretos ni datos personales en el repositorio:** el proyecto no usa claves, servidores ni cuentas. Los eventos viven solo en el navegador de quien los escribe, y ningún evento de ejemplo queda en los archivos.
- **Cuidado al probar:** si se sirve otra carpeta en el mismo puerto de `localhost`, el navegador puede mostrar archivos guardados de la carpeta anterior. `dev_server.py` no tiene este problema porque no deja guardar copias.

### Pruebas que solo se pueden hacer a mano
1. En **uno o dos celulares** (uno con iPhone si es posible): recorrer las dos pestañas, agregar un evento con hora y otro que se repita, editarlos y borrarlos, y mirar que el diálogo se vea bien con el teclado del celular abierto y que las celdas del mes se puedan tocar con comodidad. Mirar que el fondo se vea fluido.
2. **Exportar e importar de verdad:** descargar `calendario.json`, comprobar que se guarda donde esperas, borrar los datos del sitio y volver a importarlo (el selector de archivos del sistema no se pudo probar sin una persona).
3. En **GitHub Pages**, tras publicar: abrir `https://<usuario>.github.io/projects/calendar/` y comprobar que carga sin errores, con iconos y fondo, y que los eventos se recuerdan al recargar.
4. Activar "reducir movimiento" en el sistema y comprobar que el fondo queda quieto.
5. **Comparar con un calendario oficial** de Colombia: revisar los festivos del año en curso y del siguiente (en 2025 y 2030, por ejemplo, el Sagrado Corazón y San Pedro y San Pablo caen el mismo lunes y el día muestra los dos nombres).
6. Dejar la página abierta de un día para otro y volver a ella: el círculo de "hoy" debe pasar al día nuevo.
