# Plan de trabajo: Libro de vida (`book_life`)

Documento de planificación del proyecto. Se rige por las reglas de [CLAUDE.md](../CLAUDE.md). Cada fase termina con una revisión en el navegador y la aprobación de la persona dueña antes de pasar a la siguiente.

---

## 1. Qué es este proyecto

Un libro digital **privado** que cuenta la historia de una pareja, desde el día en que se conocieron hasta hoy, escrito día a día por los dos.

Funciona así:

1. **Escribir.** Cualquiera de los dos, desde el celular, escribe una página directamente en el libro. Puede ponerle título, fechas y una foto, todo opcional.
2. **Leer.** Las páginas se leen como un libro físico, con colores claros, estrellas y animaciones.
3. **Revisar cada uno o dos meses.** Se descarga el libro, se revisa la ortografía y las tildes fuera de la aplicación (entre la persona dueña y Claude), y las correcciones se aplican de vuelta con una copia de seguridad automática.

**Nada es público.** Ni el texto ni las fotos se ven sin iniciar sesión. Por eso todo vive en Supabase y nunca en archivos del repositorio.

Antes existían borradores y una pantalla de curaduría para pasarlos al libro. Se eliminaron por innecesarios: escribir directo y revisar de vez en cuando es más simple.

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Stack | HTML, CSS, JS vanilla, Three.js, Lottie, Font Awesome, SVG. Todo por CDN según CLAUDE.md 2.3 |
| Datos | Supabase: base de datos, autenticación y almacenamiento privado de fotos. Sin servidor propio |
| Acceso | Login por correo y contraseña. Solo dos cuentas, creadas a mano en Supabase. Registro cerrado. La sesión dura solo mientras la pestaña esté abierta |
| Privacidad | Sin sesión no se carga ningún dato. RLS activo en todas las tablas y políticas en el almacenamiento |
| Escritura | Directa al libro. No hay borradores |
| Quién edita | Cualquiera de los dos puede editar o borrar cualquier página. Cada página guarda quién la escribió |
| Fechas | Opcionales: una fecha, un periodo (inicio y fin) o ninguna |
| Orden de lectura | Por la fecha de la página; si no tiene, por el día en que se guardó. Lo calcula la base de datos |
| Carga | Por trozos: la aplicación nunca descarga el libro completo, ni para leerlo ni para listarlo |
| Fotos | Una por página, opcional, en un marco fijo 4:3, sin pie de foto, sin ampliar |
| Revisión | Cada 1 o 2 meses: descargar, corregir fuera de la app, aplicar correcciones con copia de seguridad |
| Capítulos | Con nombre y fecha de inicio, en una tabla propia. Cada uno llega hasta donde empieza el siguiente y abre con una hoja con su nombre. Se crean desde la pantalla Capítulos |
| Estética | Libro físico, colores claros, estrellas, 3D llamativo |

---

## 3. Pantallas de la aplicación

Todo vive en un solo `index.html`. Las pantallas se muestran u ocultan con JavaScript, y ninguna carga datos sin sesión.

### 3.1 Acceso
Tarjeta con correo y contraseña sobre un cielo de estrellas y corazones. Mensajes de error claros en español.

### 3.2 Inicio
El protagonista es un **libro 3D** que flota sobre el cielo de estrellas, se inclina hacia donde está el puntero y brilla con un resplandor rosa. Al tocarlo solo abre la tapa unos segundos, muestra su primera página con fuegos artificiales y se cierra. La lectura se abre únicamente con **Leer el libro** (ver "Cómo se abre el libro para leer"). Debajo hay cuatro accesos: **Leer el libro**, **Escribir en el libro**, **Capítulos** y **Páginas y respaldo**, y un botón para cerrar sesión.

El inicio cabe en la pantalla sin desplazamiento: el libro ocupa la altura que sobra después del título y el menú (entre 150 y 300 px), y en pantallas de 700 px de alto o menos los márgenes y botones se compactan. Solo por debajo de unos 600 px de alto aparece desplazamiento.

La tarjeta del inicio es transparente para que se vea el libro; el texto lleva un halo claro para leerse sobre el cielo. Sobre el libro hay un botón real invisible, así que también se abre con teclado. Sin 3D, o con la calidad al mínimo, el botón muestra un libro dibujado; con movimiento reducido, el libro se ve quieto y se pasa a la lectura sin animación.

### 3.3 Leer el libro
- Doble página en pantallas de 900 px o más, con giro 3D de la hoja sobre el lomo. Una sola página en celular.
- Portada con el título, una foto y los nombres, sin fecha (ver 3.6). Página final con "Continuará…".
- Si hay capítulos, con la primera entrada de cada uno va antes una **hoja de capítulo**: una estrella dorada, "Capítulo N" y su nombre. Los capítulos sin páginas no aparecen y se numeran en el orden en que aparecen. En doble página la hoja de capítulo ocupa un lado del libro y la primera hoja de la entrada el otro. Saltar con la barra a la primera entrada de un capítulo muestra su hoja de capítulo.
- Cada entrada empieza en una página nueva. Un texto largo continúa en las siguientes: la aplicación mide cuánto cabe de verdad y reparte el texto.
- Las páginas se numeran **por entrada**: "Entrada 37 de 1000" y, si la entrada ocupa varias hojas, "hoja 2 de 3". El pie de cada página muestra el número de entrada. No se numeran las hojas de todo el libro porque eso obligaría a descargarlo completo.
- Si la página tiene foto, va **arriba, justo después del título**, centrada en un marco de tamaño fijo, y el texto debajo.
- Navegación por botones, flechas del teclado, Re Pág y Av Pág, Inicio y Fin, deslizar con el dedo y una barra para moverse por el libro. La barra solo salta al soltarla, para no pedir datos mientras se arrastra.
- Al cambiar el tamaño de la ventana, se vuelve a repartir el texto y se conserva el punto de lectura.

### 3.4 Escribir en el libro
- Texto de la página, título opcional, fechas opcionales (con "Hasta" bloqueado hasta elegir fecha y sin permitir fechas anteriores) y foto opcional.
- Una copia del texto sin enviar se guarda en el equipo para no perderlo si se cierra la pestaña. Se borra al guardar y al cerrar sesión a propósito.
- Si falla el guardado, el texto y la foto elegida se quedan en pantalla.
- Al guardar, una animación Lottie de confirmación y una ráfaga de corazones.
- El mismo formulario sirve para **editar** una página existente: se puede cambiar o quitar la foto.

### 3.5 Capítulos
- Lista de capítulos con su nombre, la fecha en que empiezan y cuántas páginas tienen. Un capítulo sin páginas lo avisa: no aparece en el libro.
- Formulario para crear, o editar (nombre y fecha). Dos capítulos no pueden empezar el mismo día. Al borrar uno se pide confirmación y sus páginas no se borran: pasan a formar parte del capítulo anterior.
- Si falta crear la tabla en Supabase, la pantalla lo dice y apunta a esta sección del PLAN.

### 3.6 Portada del libro
Panel dentro de **Páginas y respaldo**, "Portada del libro": elegir, cambiar o quitar la foto (se recorta 4:3 como las de las páginas), escribir los nombres que salen en la portada y guardar. La portada es la misma en el libro 3D del inicio y en la primera hoja de la lectura: título "Libro de vida", la foto y los nombres. Sin foto queda un corazón en su lugar; sin nombres guardados se usan los de las dos cuentas. No lleva fecha. Se guarda en Supabase (ver `book_settings`), nunca en archivos del repositorio.

### 3.7 Páginas y respaldo
- **Páginas del libro:** lista paginada de 10 en 10, en el orden del libro pero de la más reciente a la más antigua. La base entrega solo las 10 que se ven. Cada una muestra fecha, autor, título, miniatura de la foto y texto, y permite leer completo, editar y borrar. Los botones de paginación están arriba y abajo de la lista, y desaparecen si hay 10 páginas o menos. Varios clics seguidos suman hojas y solo se ejecuta el último pedido.
- **Descargar el libro:** un archivo con todas las páginas, que sirve como respaldo y para revisar el texto fuera de la aplicación.
- **Aplicar correcciones:** sube un archivo de correcciones, consulta a la base solo las páginas que el archivo menciona, muestra un resumen de lo que cambiaría y, al confirmar, descarga primero una copia de seguridad de las páginas que van a cambiar.

---

## 4. Modelo de datos en Supabase

Todas las tablas con RLS activo. Nombres en snake_case.

### `profiles`
Relaciona cada cuenta con un nombre para mostrar. Sin cambios.

### `book_entries`
Cada fila es una página del libro.

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | uuid | Clave primaria |
| `entry_date` | date | Fecha de la historia, o inicio de un periodo. Opcional |
| `entry_date_end` | date | Fin del periodo. Opcional. Requiere `entry_date` y debe ser posterior |
| `title` | text | Título opcional |
| `content` | text | Texto de la página |
| `order_index` | integer | Desempate entre páginas con la misma fecha, asignado en orden de llegada |
| `sort_date` | date | Fecha de orden: `entry_date` o, si no tiene, el día en que se guardó (hora de Bogotá). La calcula un disparador de la base cada vez que se guarda o cambia la fecha |
| `author_id` | uuid | Quién la escribió. La base lo completa con la sesión |
| `image_path` | text | Ruta de la foto en el almacenamiento, o nulo si no tiene |
| `created_at` | timestamptz | Momento en que se creó |

### Índice y orden
Hay un índice sobre `(sort_date, created_at, order_index)`. Con él la base ordena y entrega cualquier trozo del libro sin leer toda la tabla. Todas las consultas usan ese orden: por fecha, luego por momento de guardado y luego por `order_index`.

### `book_chapters`
Cada fila es un capítulo.

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | uuid | Clave primaria |
| `title` | text | Nombre del capítulo, de 1 a 100 letras |
| `start_date` | date | Fecha en que empieza. Única: no hay dos capítulos que empiecen el mismo día |
| `created_at` | timestamptz | Momento en que se creó |

Una página pertenece al capítulo con la fecha de inicio más reciente que no pase de su `sort_date`. Las páginas anteriores al primer capítulo no tienen capítulo. RLS: cualquier usuario con sesión puede leer, crear, editar y borrar.

La función `book_chapter_list()` devuelve cada capítulo con `first_offset` (cuántas páginas hay antes de él, es decir, la posición de su primera página en el libro) y `entry_count` (cuántas páginas tiene). La usan la lectura, para saber dónde poner cada hoja de capítulo con una sola consulta y sin descargar el libro, y la pantalla Capítulos. Se ejecuta con los permisos de quien la llama, así que respeta RLS.

#### SQL para crearla (se ejecuta una vez en el editor SQL de Supabase)

```sql
create table public.book_chapters (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  start_date date not null unique,
  created_at timestamptz not null default now()
);

alter table public.book_chapters enable row level security;

create policy "chapters_select" on public.book_chapters for select to authenticated using (true);
create policy "chapters_insert" on public.book_chapters for insert to authenticated with check (true);
create policy "chapters_update" on public.book_chapters for update to authenticated using (true) with check (true);
create policy "chapters_delete" on public.book_chapters for delete to authenticated using (true);

grant select, insert, update, delete on public.book_chapters to authenticated;

create or replace function public.book_chapter_list()
returns table (id uuid, title text, start_date date, first_offset bigint, entry_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with ordered as (
    select c.id, c.title, c.start_date,
           lead(c.start_date) over (order by c.start_date) as next_start
    from public.book_chapters c
  )
  select o.id, o.title, o.start_date,
         (select count(*) from public.book_entries e where e.sort_date < o.start_date) as first_offset,
         (select count(*) from public.book_entries e
           where e.sort_date >= o.start_date and (o.next_start is null or e.sort_date < o.next_start)) as entry_count
  from ordered o
  order by o.start_date;
$$;

revoke execute on function public.book_chapter_list() from public, anon;
grant execute on function public.book_chapter_list() to authenticated;

-- Sin sesión no hay acceso ni a la tabla (igual que book_entries). Con RLS ya devolvía una lista vacía.
revoke all on public.book_chapters from anon;
```

### `book_settings`
Una sola fila con lo que lleva la portada.

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | smallint | Siempre 1: solo puede existir una fila |
| `cover_names` | text | Nombres que salen en la portada, hasta 120 letras. Opcional |
| `cover_photo_path` | text | Ruta de la foto de la portada en el almacenamiento (`cover/cover-{marca_de_tiempo}.jpg`). Opcional |
| `updated_at` | timestamptz | Último cambio |

RLS: cualquier usuario con sesión puede leer, crear y editar. Nadie puede borrar la fila. Sin sesión no hay acceso.

#### SQL para crearla (se ejecuta una vez en el editor SQL de Supabase)

```sql
create table public.book_settings (
  id smallint primary key default 1 check (id = 1),
  cover_names text check (cover_names is null or char_length(cover_names) <= 120),
  cover_photo_path text,
  updated_at timestamptz not null default now()
);

alter table public.book_settings enable row level security;

create policy "settings_select" on public.book_settings for select to authenticated using (true);
create policy "settings_insert" on public.book_settings for insert to authenticated with check (true);
create policy "settings_update" on public.book_settings for update to authenticated using (true) with check (true);

revoke all on public.book_settings from anon;
grant select, insert, update on public.book_settings to authenticated;

insert into public.book_settings (id) values (1) on conflict (id) do nothing;
```

### Almacenamiento: contenedor `book_images`
- **Privado.** Ninguna foto tiene dirección pública.
- Solo acepta `image/jpeg` y hasta 2 MB por archivo.
- Políticas: solo usuarios con sesión pueden ver, subir, reemplazar y borrar.
- Ruta de cada foto: `pages/{id_de_la_pagina}-{marca_de_tiempo}.jpg`; la de la portada, `cover/cover-{marca_de_tiempo}.jpg`. Cada cambio de foto usa un nombre nuevo, así un enlace antiguo nunca muestra una foto vieja.

### Reglas RLS de `book_entries`
- **Lectura, inserción, edición y borrado:** cualquier usuario con sesión.
- **Sin sesión:** ninguna operación.

### Tabla de borradores
Ya no se usa. En la migración, los borradores pendientes se copiaron al libro como páginas y la tabla se renombró a `drafts_archive` para poder borrarla cuando se confirme que nada falta.

---

## 5. Revisión periódica del texto

1. En **Páginas y respaldo**, descargar el libro.
2. En una sesión con Claude, revisar y corregir ortografía, tildes y puntuación, respetando lo que cada uno quiso contar. El texto pasa por la conversación solo cuando la persona dueña decide compartirlo.
3. Claude prepara un archivo de correcciones.
4. En **Páginas y respaldo, Aplicar correcciones**, se sube el archivo, se revisa el resumen y se confirma. Antes de cambiar nada se descarga una copia de seguridad de las páginas que cambiarán.

### 5.1 Formatos JSON de intercambio

#### Descarga del libro (`book_life_export`, versión 3)

```json
{
  "format": "book_life_export",
  "version": 3,
  "exported_at": "2026-10-03T15:20:00.000Z",
  "profiles": [{ "id": "…", "display_name": "Nombre" }],
  "cover": { "names": "Nombres de la portada", "photo_path": "cover/cover-1791084419528.jpg" },
  "chapters": [{ "id": "…", "title": "Cómo nos conocimos", "start_date": "2025-03-01" }],
  "entries": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "entry_date": "2025-03-12",
      "entry_date_end": null,
      "title": "El día que nos conocimos",
      "content": "Texto de la página.",
      "author_name": "Nombre",
      "image_path": null,
      "order_index": 1,
      "created_at": "2025-03-12T10:00:00Z"
    }
  ]
}
```

Los capítulos van como respaldo y como pista para quien revise el libro: si no se pueden leer, la lista sale vacía. La copia de seguridad que se descarga antes de aplicar correcciones no los incluye. Las fotos no van dentro del archivo: solo su ruta. Las fotos quedan en el almacenamiento de Supabase.

#### Correcciones (`book_life_corrections`, versión 1)

```json
{
  "format": "book_life_corrections",
  "version": 1,
  "entries": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "content": "Texto corregido de la página, con tildes y puntuación."
    }
  ]
}
```

| Campo | Obligatorio | Regla |
|---|---|---|
| `id` | Sí | El id de una página que exista, tomado del archivo descargado |
| `content` | No | Texto nuevo, no vacío, hasta 50 000 caracteres |
| `title` | No | Título nuevo, hasta 200 caracteres. `null` o vacío lo quita |
| `entry_date` | No | Fecha real `AAAA-MM-DD`. `null` la quita |
| `entry_date_end` | No | Fin de un periodo. Requiere fecha de inicio y debe ser posterior |

Reglas:
- **Solo cambia lo que viene.** Un campo ausente no se toca.
- **Todo o nada al validar.** Si una corrección tiene un error, no se aplica ninguna y se listan los problemas con su número.
- **Solo cuenta lo que de verdad cambia.** Una corrección idéntica al texto actual se omite.
- **Vista previa y copia de seguridad obligatorias** antes de aplicar. La copia contiene las páginas que van a cambiar, tal como están antes del cambio.
- Si una corrección falla al aplicarla, se puede repetir el mismo archivo: lo ya aplicado se omite.
- Límites: hasta 500 correcciones y 2 MB.
- Las fotos no se modifican con correcciones.

### 5.2 Orden de lectura
El libro se lee ordenado por `sort_date`: la fecha de la página o, si no tiene fecha, el día en que se guardó. Un periodo se ubica por su fecha de inicio. Entre páginas con la misma fecha manda el momento en que se guardaron y, si coincide, `order_index`. Una página sin fecha queda, por tanto, en el lugar del día en que se escribió.

---

## 6. Fotos

- **Una foto por página, opcional.** Sin pie de foto. No se puede ampliar.
- **Marco fijo.** En la página del libro hay un rectángulo de proporción 4:3 que siempre mide lo mismo. Va arriba, después del título, centrado.
- **Recorte al elegir la foto.** La foto se recorta al centro con proporción 4:3 y se reduce a 1200×900 como máximo en el navegador, antes de subirla. Lo que se ve en la vista previa es exactamente lo que queda. Una foto vertical pierde franjas arriba y abajo.
- **Foto pequeña:** no se agranda.
- **Formato:** JPEG, unos 100 a 300 KB por foto. Con el plan gratuito (1 GB) caben miles.
- **Se adjunta al escribir o al editar la página,** no en un paso aparte.
- **Orden al guardar:** primero se sube la foto, después se guarda la página. Si la página falla, la foto subida se borra. Al reemplazar o quitar una foto, la anterior se borra solo después de guardar el cambio.
- **Al borrar una página** se borra también su foto.
- **Enlaces temporales.** Las fotos se muestran con enlaces que vencen y se renuevan solos.

---

## 7. Diseño visual y animaciones

Todas las animaciones están en `js/animations.js` o en CSS, son decorativas, respetan `prefers-reduced-motion` y se pausan con la pestaña oculta, según CLAUDE.md 2.10.

### Ya hecho
- Cielo de estrellas que titilan, corazones que suben y pétalos de rosa que caen (Three.js).
- Ráfaga de corazones al entrar y al guardar.
- Destellos que aparecen y desaparecen alrededor de las tarjetas.
- Corazón latiendo en la pantalla de acceso.
- Giro 3D de las hojas del libro.
- Libro 3D del inicio: tapas, lomo, hojas con rayitas y portada con el título, hecha en un canvas. Flota y se inclina hacia el puntero. Al tocarlo solo abre la tapa unos segundos, muestra su primera página con fuegos artificiales y se cierra, sin cambiar de tamaño ni de pantalla. La lectura se abre únicamente con el botón "Leer el libro".
- Estrellas fugaces ocasionales, una cada 7 a 15 segundos, cruzando el cielo en diagonal.
- Lottie: corazón que late mientras carga, confirmación al guardar y lluvia de corazones al llegar a la última página (una vez por llegada).

### Uso de recursos
- **Lectura:** el libro se pide a la base en trozos de 20 entradas, ya ordenadas. Al abrirlo se descargan solo el primer trozo y un resumen mínimo (cuántas entradas hay, primera y última fecha, nombres). En memoria viven como máximo 3 trozos (el actual y sus vecinos); los demás se sueltan.
- **Adelantarse:** el trozo vecino se pide cuando se está a 5 entradas del borde, para que pasar de hoja no espere.
- **Cancelar:** los pedidos que dejan de servir (por saltar lejos o cambiar de hoja rápido) se cancelan y no gastan conexión.
- **Lista de páginas:** la base entrega solo las 10 que se ven.
- **Descarga completa:** se hace en trozos de 200 y solo cuando la persona la pide.
- **Correcciones:** se consultan únicamente las páginas que el archivo menciona, de 100 en 100.
- **Conexiones:** la aplicación usa solo pedidos HTTP que terminan al responder. No abre conexiones permanentes (no usa tiempo real) y las fotos se piden con enlaces temporales, una por página visible.

### Rendimiento
- El cielo se dibuja a 30 cuadros por segundo como máximo.
- Si el equipo va lento, la calidad baja sola: primero la resolución y las partículas, y si sigue lento el cielo se queda quieto.
- Si el navegador pierde el contexto gráfico, el cielo se pausa y se retoma al volver.
- Las tarjetas no usan desenfoque de fondo ni bordes animados, que obligaban a repintar la pantalla en cada cuadro.
- Los destellos alrededor de las tarjetas se colocan a una distancia fija en píxeles, nunca como porcentaje de la altura. En una tarjeta muy alta, un porcentaje los sacaba cientos de píxeles y la página se estiraba y encogía cada vez que uno cambiaba de lugar, con un tirón y una franja del fondo visible al final del scroll.
- Las pantallas recortan lo que sobresalga, para que nada pueda alargar la página.

### Cómo se dibuja el libro 3D
- Vive en la misma escena del cielo, no en un segundo lienzo: un segundo contexto gráfico costaría memoria justo en los equipos justos.
- Se dibuja en el sitio que ocupa el botón del inicio y lo sigue cada cuadro, así acompaña a la pantalla cuando aparece o se desplaza.
- Se coloca delante de los corazones y los pétalos para que no los tape.
- Solo existe mientras se ve el inicio.
- El lomo sobresale un poco de las tapas. Si compartieran el mismo plano, la tarjeta gráfica elegiría una u otra en cada cuadro y el costado izquierdo titilaría entre morado claro y oscuro.
- Los fuegos artificiales son un solo conjunto de puntos (`js/fireworks.js`) que se dibuja de una vez; se limpian al salir del inicio.
- Si la página está oculta, la animación de apertura se omite y se pasa directo a la lectura.

### Cómo se abre el libro para leer
Al pulsar "Leer el libro" no hay un cambio de pantalla con otro dibujo: el mismo libro 3D se convierte en el libro de la lectura.
1. El libro gira de frente y abre la tapa. El inicio (título, menú) se desvanece, menos el libro, y la lectura se prepara sin verse mientras carga.
2. Con la tapa abierta, el libro se desliza, crece y se estira (cada eje por separado, porque el libro real tiene otras proporciones) hasta que su hoja derecha queda exactamente sobre la hoja derecha del libro real. En doble página la tapa abierta queda sobre la hoja izquierda; en una sola página queda fuera de la pantalla. El destino se mide en cada cuadro.
3. El papel del 3D es del mismo color y con la misma sombra de lomo que el real, y sin renglones ni corazón (esos se apagan en el trayecto). Entonces la lectura aparece encima: primero el libro y el título, y un instante después los controles y el texto de ayuda.
4. Cuando el libro real ya cubre todo, el 3D se desvanece.
- Si la persona se va a otra pantalla o cierra sesión durante la apertura, esta se abandona y el 3D se desvanece.
- Si el libro no se pudo cargar o está vacío, no hay dónde aterrizar: el 3D solo se desvanece y se ve el mensaje.
- Sin 3D, con movimiento reducido o con la pestaña oculta, se pasa directo a la lectura sin animación.

---

## 8. Fases de desarrollo

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Preparación de Supabase | Hecha |
| 1 | Base de la aplicación y acceso | Hecha |
| 2 | Escritura directa al libro, con fechas opcionales y periodos | Hecha |
| 3 | Páginas y respaldo: lista, editar, borrar, descargar y aplicar correcciones | Hecha |
| 4 | Lectura del libro: papel, doble página, giro 3D, teclado y deslizar | Hecha |
| 4b | Fotos opcionales en marco fijo | Hecha |
| 5 | Animaciones y portada 3D | Hecha |
| 6 | Capítulos por nombre: tabla, pantalla para crearlos y hoja de capítulo en la lectura | Hecha (falta ejecutar el SQL y definir los capítulos reales) |
| 7 | Cierre: checklist de CLAUDE.md 2.11, pruebas en dos celulares y en GitHub Pages | Revisión técnica hecha; faltan las pruebas en celulares y en GitHub Pages (sección 12) |

---

## 9. Estructura de archivos del proyecto

```
book_life/
├── index.html
├── README.md
├── PLAN.md                  # Este documento
├── css/
│   └── styles.css
├── js/
│   ├── main.js              # Arranque y navegación entre pantallas
│   ├── config.js            # URL y clave anon de Supabase
│   ├── auth.js              # Sesión: entrar, salir, comprobar
│   ├── utils.js             # Fechas, errores, elementos del DOM y diálogo de confirmación
│   ├── write.js             # Escribir y editar una página, con foto
│   ├── pages.js             # Lista de páginas, descarga y correcciones
│   ├── chapters.js          # Crear, editar y borrar capítulos
│   ├── cover.js             # Foto y nombres de la portada: panel, guardado y libro 3D
│   ├── images.js            # Preparar, subir y mostrar fotos
│   ├── book.js              # Lectura: reparto del texto y paso de página
│   ├── home_book.js         # Libro 3D del inicio: modelo, portada y animaciones de la tapa
│   ├── fireworks.js         # Fuegos artificiales al mostrar la primera página
│   └── animations.js        # Cielo 3D, estrellas fugaces, giro de hoja, destellos y celebraciones
└── assets/
    └── lottie/
        ├── save_heart.json      # Confirmación al guardar
        ├── loading_heart.json   # Corazón que late mientras carga
        └── end_hearts.json      # Lluvia de corazones al final del libro
```

---

## 10. Servidor local de desarrollo

Se ejecuta con `python ../dev_server.py` desde esta carpeta (ver CLAUDE.md 2.8). Envía cada archivo sin caché, así el navegador nunca muestra una copia vieja, y las pestañas abiertas se recargan solas cuando se reinicia el servidor. En GitHub Pages no se puede controlar la caché: tras publicar, si algo se ve como antes, se recarga con Ctrl y F5.

---

## 11. Riesgos y cómo se manejan

| Riesgo | Manejo |
|---|---|
| Supabase pausa el proyecto tras 7 días sin uso (plan gratuito) | Se documenta en el README. Reactivar desde el panel toma un minuto |
| El libro no guarda historial de cambios | Antes de aplicar correcciones se descarga una copia automática. Se recomienda descargar el libro cada cierto tiempo |
| Perder un texto por falta de red al guardar | El texto y la foto se conservan en pantalla, y el texto también en una copia local |
| El repositorio es público | Ningún texto ni foto en archivos. Todo en Supabase con RLS y almacenamiento privado |
| Fotos HEIC de iPhone en algunos navegadores | Si no se pueden leer, se avisa y se pide otra en JPG o PNG |
| Archivos de foto sin usar tras un fallo | Se borran al fallar el guardado, y al reemplazar, quitar o borrar la página |
| El 3D pesa demasiado en un equipo lento | Tope de cuadros, calidad adaptable, y el libro funciona sin 3D |
| Dependencia de un servicio externo | Descarga del libro en cualquier momento |

---

## 12. Cierre: checklist de CLAUDE.md 2.11

Revisión técnica hecha con la aplicación corriendo contra una base simulada y contra el proyecto real de Supabase (solo lecturas con la clave pública).

| Punto | Estado |
|---|---|
| Estructura como en 2.5 | Cumple. Hay además `PLAN.md` y las carpetas `assets/icons` y `assets/img` vacías, permitido por 2.5 |
| `README.md` con título, descripción y ejecución local | Cumple, con el comando `python ../dev_server.py` y el aviso de la pausa de Supabase a los 7 días |
| 360 px hasta escritorio | Cumple: sin desplazamiento horizontal ni controles fuera de pantalla en inicio, escribir, capítulos, páginas y lectura. Los títulos de pantalla no son controles |
| Teclado y foco visible | Cumple: con Tab el foco muestra un contorno naranja de 3 px; todos los botones, campos y la barra de página tienen regla de foco |
| Sin errores en la consola | Sin errores ni promesas rechazadas en las pruebas. El panel de pruebas no puede descargar algunas fuentes externas; en un navegador normal cargan |
| Rutas relativas con `./` | Cumple. Ninguna ruta absoluta |
| Librerías por CDN y versiones de 2.3 | Cumple: Font Awesome 6.7.2, Three.js 0.170.0, Lottie 2.0.12, Supabase 2.45.4. **Excepción aprobada por la persona dueña:** la tipografía Lora, desde Google Fonts, no está en la lista de 2.3 y se deja así solo en este proyecto. Si no carga se usa Georgia |
| `prefers-reduced-motion` y pausa con pestaña oculta | Cumple: sin animación 3D con movimiento reducido y el bucle se detiene al ocultar la pestaña |
| `localStorage` con prefijo y `try/catch` | Cumple: claves `book_life_...` y toda lectura y escritura dentro de `try/catch` |
| Supabase: RLS, registro cerrado, sin datos sin sesión, exportación | Cumple. Con la clave pública y sin sesión: `book_entries`, `profiles` y `drafts_archive` responden "permiso denegado"; `book_chapters` responde vacío (se cierra con el `revoke` de la sección 4); el almacenamiento no lista nada; `disable_signup` está en verdadero y no hay usuarios anónimos. La clave de `config.js` es de rol `anon`. Sin sesión no hay ningún dato en pantalla. La descarga del libro incluye capítulos |
| Secretos | No hay `service_role` ni contraseñas en el repositorio. `book_life/.env` tiene la contraseña de la base y está en `.gitignore`: no se publica, pero conviene borrarlo si ya no se usa |
| Código en inglés, comentarios en español, snake_case | Cumple |
| Agregado al portal | Cumple: tarjeta de `book_life` en el `index.html` de la raíz |

### Pruebas que solo se pueden hacer a mano
1. En **dos celulares** distintos (uno con iPhone si es posible): entrar, escribir una página con foto, leerla, cambiar de página con el dedo, abrir Capítulos y crear uno.
2. En **GitHub Pages**, tras publicar: abrir `https://<usuario>.github.io/projects/book_life/`, comprobar que carga sin errores, que las tipografías y el 3D aparecen y que entrar funciona. Si algo se ve como antes, recargar con Ctrl y F5.
3. En Supabase, **Authentication → URL Configuration**: poner la dirección de GitHub Pages como Site URL.
4. Descargar el libro una vez y guardar el archivo como primera copia de seguridad.

### Actualización posterior: favicon y copyright

Se agregó el favicon de la marca (`assets/icons/favicon.ico`, enlazado en el `<head>`) y el pie de copyright con el texto de CLAUDE.md 2.16. El pie suma unos 30 px de alto (el doble de línea en pantallas muy angostas, donde el texto se parte en dos), así que los píxeles de desplazamiento medidos antes en este documento aumentan en esa medida. En la pantalla de acceso, que es donde va el pie, no hay desplazamiento a 1366×768 ni a 390×844.

