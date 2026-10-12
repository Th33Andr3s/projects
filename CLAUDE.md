# CLAUDE.md

Guía base de trabajo para Claude Code. Este archivo tiene dos partes:

- **Parte 1. Reglas generales**: aplican a cualquier repositorio donde se copie este archivo, sin importar el tipo de proyecto.
- **Parte 2. Reglas de este repositorio**: aplican solo a esta colección de sitios estáticos publicados en GitHub Pages. Al reutilizar este archivo en otro repositorio, solo se reemplaza esta parte.

Las reglas de este archivo tienen prioridad sobre cualquier costumbre o valor por defecto de Claude.

---

# Parte 1. Reglas generales (cualquier proyecto)

## 1.1 Git es exclusivo del dueño del repositorio

Claude **nunca** ejecuta operaciones de git. Esto incluye, sin excepción:

- `git add`, `git commit`, `git push`, `git pull`, `git fetch`, `git merge`, `git rebase`
- Crear, cambiar o borrar ramas
- Crear tags, stashes o pull requests
- Modificar `.git/`, hooks o la configuración de git

Claude sí puede **leer** el estado de git (`git status`, `git log`, `git diff`) cuando ayude a entender el contexto. Todo lo que cambie el historial o el remoto lo hace únicamente la persona dueña del repositorio, cuando ella lo decida.

## 1.2 Idioma

| Qué | Idioma |
|---|---|
| Código: nombres de variables, funciones, clases, archivos, carpetas, ids, claves | Inglés |
| Comentarios dentro del código | Español |
| Documentación: README, planes, este archivo | Español |
| Textos visibles para la persona en la interfaz | Español |
| Mensajes de Claude en la conversación | Español |

Los comentarios explican el **por qué** de una decisión, no repiten lo que el código ya dice.

## 1.3 Nomenclatura

- **snake_case** para todo: carpetas, archivos, variables, funciones, clases CSS, ids de HTML, claves de almacenamiento, tablas y columnas de base de datos.
- **UPPER_SNAKE_CASE** para constantes.
- Nombres descriptivos y completos. `total_amount` en lugar de `ta`. `calculate_monthly_payment` en lugar de `calc`.
- Sin prefijos ni sufijos técnicos innecesarios (`str_name`, `arr_items`).

## 1.4 Simplicidad ante todo

- Se prefiere siempre la solución más sencilla que cumpla el objetivo.
- No se agregan dependencias, herramientas ni abstracciones "por si acaso".
- No se crean archivos, carpetas ni configuraciones fuera de la estructura definida para el proyecto.
- Un proyecto pequeño se resuelve con pocos archivos claros, no con muchas capas.

## 1.5 Calidad mínima obligatoria

Todo lo que se entregue debe cumplir esto, sin que haya que pedirlo:

- **Responsive**: funciona y se ve bien en cualquier tamaño de pantalla, priorizando celulares.
- **Navegación por teclado**: todo lo que se puede hacer con el mouse o el dedo se puede hacer con Tab, Enter, Espacio, Escape y flechas. El foco siempre es visible.
- **Intuitivo**: una persona sin conocimientos técnicos entiende qué hacer sin leer instrucciones.
- **Ordenado**: nombres consistentes, archivos en su lugar, sin código muerto ni comentarios obsoletos.
- **Sin errores en consola** al cargar ni al usar la aplicación.

## 1.6 Documentación por proyecto

Cada proyecto tiene su propio `README.md` con exactamente estas tres secciones:

1. **Título** del proyecto.
2. **Descripción** breve de qué hace y para quién.
3. **Ejecución local**: el comando exacto para correrlo y la URL que abrir.

## 1.7 Forma de trabajar con Claude

- Claude **no inicia un desarrollo ni un plan** hasta que la persona lo indique explícitamente. Antes de eso, solo analiza, propone y pregunta.
- Ante una decisión estructural (nuevo archivo fuera de la estructura, nueva librería, cambio de enfoque), Claude pregunta antes de actuar.
- Claude trabaja solo dentro de la carpeta del proyecto que se está desarrollando. No toca otros proyectos del repositorio.
- Cuando algo no se pueda cumplir tal como se pidió, Claude lo dice de forma directa, propone la alternativa más cercana y continúa con el resto.
- Claude reporta lo que hizo de forma clara y verificable, sin exagerar ni omitir problemas.

---

# Parte 2. Reglas de este repositorio

## 2.1 Qué es este repositorio

Una colección de **proyectos web estáticos, pequeños e independientes**, publicados automáticamente en GitHub Pages. Cada carpeta de primer nivel es un proyecto completo y autónomo sobre un tema distinto. Lo único que comparten es este repositorio contenedor y el portal de la raíz.

## 2.2 Stack permitido

Solo se usa esto. Nada más.

| Tecnología | Uso |
|---|---|
| HTML5 | Estructura |
| CSS3 | Estilos, layout responsive, transiciones simples |
| JavaScript vanilla (ES2020+) | Toda la lógica. Sin frameworks, sin TypeScript, sin bundlers |
| Three.js | Animaciones y escenas 3D |
| Lottie (LottieFiles) | Animaciones vectoriales |
| Font Awesome | Iconos |
| SVG inline o en archivo | Iconos e ilustraciones propias |
| Supabase | Solo para proyectos que necesiten datos compartidos entre personas o privados tras login. Ver sección 2.9 |

**Prohibido**: npm, Node, bundlers (Vite, Webpack), preprocesadores (Sass, Less), frameworks (React, Vue), jQuery, librerías de utilidades adicionales.

## 2.3 Todo por CDN con versión fija

Ninguna librería se descarga al repositorio. Se carga por CDN con la versión exacta que aparece aquí. Todos los proyectos usan las mismas versiones.

```html
<!-- Font Awesome: en el <head> -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css">

<!-- Lottie: reproductor como web component, antes de cerrar <body> -->
<script src="https://unpkg.com/@lottiefiles/lottie-player@2.0.12/dist/lottie-player.js"></script>

<!-- Three.js: solo se distribuye como módulo ES, por eso usa importmap -->
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
  }
}
</script>

<!-- Supabase: solo en proyectos que lo necesiten, se importa dentro de un módulo -->
<!-- import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"; -->
```

Consecuencia: los scripts propios se cargan con `<script type="module" src="./js/main.js">`. Dentro de ellos se usa `import * as THREE from "three";`.

Si se necesita subir la versión de alguna librería, se cambia aquí primero y luego en todos los proyectos a la vez.

## 2.4 Estructura del repositorio

```
projects/
├── CLAUDE.md              # Este archivo
├── README.md              # Descripción del repositorio
├── .gitignore
├── .nojekyll              # Evita que GitHub Pages procese el sitio con Jekyll
├── LICENSE                # Licencia MIT de todo el repositorio
├── dev_server.py          # Servidor local de desarrollo: sin caché y con recarga al reiniciar
├── index.html             # Portal: lista y enlaza todos los proyectos
├── assets/
│   └── favicon.ico        # Favicon de la marca: copia original. Cada proyecto lleva su propia copia (ver 2.16)
├── css/
│   └── styles.css         # Estilos del portal
├── js/
│   └── main.js            # Script del portal
│
├── book_life/             # Un proyecto
├── calendar/              # Otro proyecto
├── code_formatter/
├── financial_calculator/
├── generator_barcodes_qr/
├── json_formatter/
├── materials_calculator/
├── measurement_calculator/
├── password_generator/
├── quotes_and_bills/
├── random_generator/
├── text_diff/
├── to_do_list/
└── warehouse_dashboard/
```

## 2.5 Estructura fija de cada proyecto

Todos los proyectos tienen **exactamente** esta estructura. Solo cambia el contenido de los archivos, nunca su nombre ni su ubicación.

```
nombre_del_proyecto/
├── index.html             # Única página. GitHub Pages la sirve automáticamente
├── README.md              # Título, descripción y ejecución local
├── css/
│   └── styles.css         # Todos los estilos del proyecto
├── js/
│   ├── main.js            # Lógica del proyecto (módulo ES)
│   ├── animations.js      # Three.js, Lottie y cualquier animación
│   └── config.js          # Solo si el proyecto usa Supabase. Ver 2.9
└── assets/
    ├── lottie/            # Archivos .json o .lottie
    ├── icons/             # favicon.ico de la marca (obligatorio, ver 2.16) y SVG propios
    └── img/               # Imágenes
```

Reglas:

- Todo proyecto tiene `assets/icons/favicon.ico`, aunque no use ninguna otra imagen. Si no necesita más carpetas dentro de `assets/`, no se crean, pero no se inventa otra.
- Si la lógica crece, se puede dividir `main.js` en más archivos dentro de `js/`, siempre en snake_case y siempre importados desde `main.js`.
- No se crean subcarpetas fuera de las definidas.

## 2.6 Aislamiento total entre proyectos

- Cada proyecto es completamente autónomo. Se puede copiar su carpeta a otro lugar y sigue funcionando.
- **Nada se comparte** entre proyectos: ni CSS, ni JS, ni assets, ni configuración.
- Un proyecto nunca enlaza, importa ni referencia archivos de otro proyecto ni de la raíz.
- Si dos proyectos necesitan lo mismo, se duplica. La duplicación es preferible al acoplamiento. El favicon y el pie de copyright son ejemplos: cada proyecto lleva su propia copia (ver 2.16).

## 2.7 Reglas de GitHub Pages

El sitio se publica desde la rama principal, en la raíz del repositorio. La URL de cada proyecto es `https://<usuario>.github.io/projects/<nombre_del_proyecto>/`.

- La página de cada proyecto se llama **`index.html`**, sin excepción.
- **Todas las rutas son relativas** y empiezan con `./`. Ejemplo: `./css/styles.css`, `./assets/img/logo.svg`. Nunca `/css/styles.css` ni rutas absolutas.
- El archivo `.nojekyll` en la raíz debe existir siempre.
- Cada proyecto nuevo se agrega al portal `index.html` de la raíz.
- No hay proceso de build. Lo que está en el repositorio es exactamente lo que se publica.

## 2.8 Ejecución local

Los módulos ES, los JSON de Lottie y Supabase no funcionan abriendo el archivo con doble clic (`file://`). Siempre se usa un servidor local. El comando estándar, ejecutado **desde la carpeta del proyecto**, es:

```bash
python ../dev_server.py
```

Y se abre `http://localhost:8080` en el navegador. Este es el comando que va en la sección "Ejecución local" del README de cada proyecto. Para usar otro puerto: `python ../dev_server.py 9000`.

`dev_server.py` (en la raíz del repositorio) es una herramienta de desarrollo, no parte de ningún proyecto ni de lo que se publica. Hace lo mismo que `python -m http.server`, con dos mejoras:

- **Sin caché:** envía cada archivo con la orden de no guardarse, así el navegador nunca muestra una copia vieja de la página, los estilos o los scripts.
- **Recarga sola:** al reiniciar el servidor, las pestañas que ya estaban abiertas se recargan solas. Para esto agrega un pequeño aviso a las páginas HTML que entrega; los archivos del proyecto no cambian.

En GitHub Pages no se puede controlar la caché: el navegador puede guardar una copia hasta 10 minutos. Si algo se ve como antes tras publicar, se recarga con Ctrl y F5.

## 2.9 Datos: localStorage y Supabase

### localStorage (por defecto)

- Es la opción por defecto para guardar datos de la persona.
- **Toda clave lleva el nombre del proyecto como prefijo**, para que dos proyectos bajo el mismo dominio no se pisen: `password_generator_history`, `calendar_events`.
- Toda lectura y escritura va dentro de `try/catch`, porque puede fallar en modo privado o con almacenamiento bloqueado. La aplicación debe funcionar aunque falle.

### Supabase (solo cuando haga falta)

Se permite únicamente cuando el proyecto necesita **datos compartidos entre varias personas** o **datos privados protegidos por login**. Un sitio estático puede consumir Supabase directamente desde el navegador, sin servidor propio.

Reglas obligatorias:

- La URL del proyecto y la clave **`anon`** van en `js/config.js`. Esa clave es pública por diseño y puede estar en el repositorio.
- La clave **`service_role` nunca** va en el código, en ningún archivo ni en la conversación.
- **Row Level Security (RLS) activado en todas las tablas** desde el primer día. Sin RLS, cualquiera con la clave `anon` lee y escribe todo.
- Autenticación con Supabase Auth. El registro abierto se desactiva; las cuentas se crean a mano desde el panel de Supabase.
- Sin sesión activa, la página **no carga ni muestra ningún dato**. Solo la pantalla de acceso.
- **Contenido privado nunca va en archivos del repositorio.** Un repositorio público expone todo lo que contiene, incluso lo que la página oculta tras login. Si un texto o imagen debe ser privado, vive en Supabase, no en `assets/` ni en el HTML.
- Todo proyecto con Supabase incluye una función de **exportar todos los datos a JSON**, como respaldo ante cambios del servicio.
- Las imágenes se redimensionan en el navegador antes de subirlas a Supabase Storage.
- El plan gratuito de Supabase pausa el proyecto tras 7 días sin actividad. Se documenta en el README del proyecto.

## 2.10 Animaciones (Three.js y Lottie)

- Las animaciones son **decorativas**. Nunca bloquean ni retrasan una acción de la persona.
- Se respeta `prefers-reduced-motion`: si la persona lo tiene activado, las animaciones se reducen a lo mínimo o se desactivan.
- Se **pausan cuando la pestaña no está visible** (`visibilitychange`) para no gastar batería.
- Los bucles de render usan `requestAnimationFrame`, nunca `setInterval`.
- Three.js se ajusta al tamaño de la ventana (`resize`) y limita el `pixelRatio` a 2 como máximo.
- El contenido debe verse y usarse correctamente aunque el 3D no cargue.
- Toda la lógica de animación vive en `js/animations.js`.

## 2.11 Checklist de proyecto terminado

Un proyecto no se considera terminado hasta cumplir **todo** esto:

- [ ] Estructura de carpetas y archivos exactamente como en 2.5
- [ ] `README.md` con título, descripción y ejecución local
- [ ] Funciona correctamente desde 360 px de ancho hasta escritorio
- [ ] Se puede usar completo con teclado y el foco es visible
- [ ] Sin errores ni advertencias en la consola del navegador
- [ ] Todas las rutas son relativas con `./`
- [ ] Librerías por CDN con las versiones de 2.3
- [ ] Respeta `prefers-reduced-motion` y pausa animaciones al ocultar la pestaña
- [ ] Claves de `localStorage` con prefijo del proyecto y lecturas en `try/catch`
- [ ] Si usa Supabase: RLS activo, registro cerrado, sin datos sin sesión, exportación a JSON
- [ ] Código en inglés, comentarios en español, todo en snake_case
- [ ] Agregado al portal `index.html` de la raíz
- [ ] Favicon de la marca en `assets/icons/favicon.ico` y enlazado en el `<head>` (2.16)
- [ ] Pie de copyright al final de la página, con el texto exacto de 2.16
- [ ] Una persona sin contexto entiende cómo usarlo sin explicación

## 2.12 Proyectos del repositorio

| Carpeta | Proyecto | Descripción |
|---|---|---|
| `book_life` | Libro de vida | Libro digital privado de una pareja. Ambos escriben páginas directamente desde el celular, con título, fechas y una foto opcionales; todo se guarda en Supabase tras login y se revisa cada uno o dos meses. Se lee con estética de libro físico, estrellas y 3D. Todo el contenido es privado. |
| `calendar` | Calendario | Agenda personal: calendario de mes con eventos por día (título, hora, color, notas y repetición semanal, mensual o anual), los festivos de Colombia calculados con la ley y una lista de próximos eventos. Se guarda solo en el navegador (`localStorage`), con Exportar e Importar en JSON como respaldo. Fondo 3D sutil. |
| `code_formatter` | Formateador de código | Pega CSS, HTML o SQL y lo deja ordenado: lo formatea con sangría o lo minifica, avisa de una llave, una etiqueta o un paréntesis sin cerrar con su línea, y deja copiar o descargar el resultado. Detecta el lenguaje solo; para cualquier otro texto solo limpia espacios sobrantes. Usa un tokenizador propio por lenguaje que no cambia nada del contenido (cadenas, comentarios, atributos y lo que va dentro de `pre`, `script` y `style` salen intactos), salvo las palabras clave de SQL, que pasan a mayúscula si se pide. Nada sale del navegador; recuerda las opciones y el último texto corto. Fondo 3D sutil. |
| `financial_calculator` | Calculadora financiera | Cuota de un préstamo con tabla de amortización, interés simple y compuesto, ahorro con aportes mensuales y conversión de tasas, con tasas efectivas anuales y valores en pesos colombianos. Recuerda los últimos valores. Fondo 3D sutil. |
| `generator_barcodes_qr` | Generador de códigos QR y de barras | Crea códigos QR (texto o enlace, Wi-Fi, contacto en vCard y chat de WhatsApp, con corrección de errores L, M, Q o H) y códigos de barras (Code 128, EAN-13, EAN-8, UPC-A, Code 39 e ITF-14, con el dígito de control calculado o comprobado). Se dibujan en vivo, avisan si algo no sirve, y se descargan en SVG o PNG, se copian o se imprimen; también arma una hoja de etiquetas con hasta 200 códigos a la vez. Los codificadores son propios, sin librerías. Nada sale del navegador; recuerda las opciones y el último texto corto, pero nunca la clave del Wi-Fi, los datos de un contacto ni el número de WhatsApp. Fondo 3D sutil. |
| `json_formatter` | Formateador de JSON | Pega un JSON y lo deja legible: lo formatea con sangría o lo minifica, ordena las claves si se pide, avisa del error con su línea y columna, y deja copiar o descargar el resultado. Usa un analizador propio que no cambia nada del contenido (números grandes, orden de claves y escapes se conservan). Nada sale del navegador; recuerda las opciones y el último texto corto. Fondo 3D sutil. |
| `materials_calculator` | Calculadora de materiales | Cuánto material comprar para obras pequeñas, con las presentaciones de Colombia: ladrillos y mortero de un muro, cemento, arena y grava del concreto, pañete y pintura, y baldosa, pegante y boquilla de un piso. Redondea hacia arriba a lo que se compra, permite ajustar el desperdicio y copiar la lista de compras. Recuerda los últimos valores. Fondo 3D sutil. |
| `measurement_calculator` | Calculadora de medidas | Convierte al instante entre unidades de longitud, masa, volumen, temperatura, área, tiempo, cocina (con pesos por ingrediente), velocidad, datos, energía y presión. Recuerda la última conversión. Fondo 3D sutil. |
| `password_generator` | Generador de contraseñas | Genera contraseñas seguras al azar con longitud y tipos de caracteres a elegir, y las copia con un toque. No guarda ninguna contraseña; solo recuerda las opciones. Fondo 3D sutil. |
| `quotes_and_bills` | Cotizaciones y cuentas de cobro | Para un negocio pequeño o una persona independiente: se escriben los datos del negocio una sola vez (con logo), se guardan clientes y productos, y cada cotización o cuenta de cobro sale eligiendo cliente, agregando renglones y revisando el total con IVA y retención en pesos colombianos. Numeración consecutiva que nunca se repite, estados (borrador, enviada, aceptada, pagada, vencida), una cotización aceptada se convierte en cuenta de cobro, y un resumen del mes. Entrega en PDF con un escritor de PDF propio (sin librerías), impresión y envío por WhatsApp o correo. No es facturación electrónica. Se guarda solo en el navegador (`localStorage`), con Exportar e Importar en JSON. Fondo 3D sutil. |
| `random_generator` | Generador aleatorio | Deja el azar decidir de forma justa: saca números en un rango (con o sin repetir, ordenados), elige a alguien de una lista (también quitando a quien sale), la mezcla o la reparte en equipos, y tira dados de 4 a 100 caras o monedas (Cara y Sello). Usa el azar del sistema (`crypto.getRandomValues`) con muestreo por rechazo, sin sesgo, y nunca `Math.random` para decidir. Resultado grande, animación breve de tirada, historial de las últimas 50 tiradas y Copiar. Nada sale del navegador; recuerda las opciones, la lista y el historial. Fondo 3D sutil con dados. |
| `text_diff` | Comparador de textos | Pega dos textos (o abre dos archivos) y ve qué cambió: líneas quitadas y agregadas con el algoritmo de Myers, y las palabras distintas dentro de cada línea modificada. Vista unificada o lado a lado, solo cambios (con las líneas iguales plegadas), ignorar espacios y mayúsculas, saltar de cambio en cambio, y copiar o descargar el resultado en formato `diff` unificado. Lo que se muestra es siempre el texto tal cual. Nada sale del navegador; recuerda las opciones y los dos últimos textos cortos. Fondo 3D sutil. |
| `to_do_list` | Lista de tareas | Lista de tareas personal: título, fecha límite, prioridad y nota opcionales; las pendientes se agrupan solas por cuándo tocan (vencidas, hoy, mañana, esta semana, más adelante, sin fecha) y las hechas quedan plegadas al final. Edición en un diálogo, borrado con Deshacer, búsqueda sin tildes ni mayúsculas, filtro Pendientes/Hechas/Todas, y Exportar e Importar en JSON como respaldo. Las fechas son claves `AAAA-MM-DD` sin zona horaria. Se guarda solo en el navegador (`localStorage`). Fondo 3D sutil. |
| `warehouse_dashboard` | Simulador de centro de distribución | Simulador 3D isométrico de un centro de distribución que empieza vacío. En la primera pantalla solo está la bodega, rodeada de cerca de alambre, árboles y carreteras sin fin, con garitas de talanqueras estilo peaje; abajo, con scroll, está toda la configuración. Los camiones (cabezote azul cielo, contenedor blanco con su número) llegan con fecha, hora y ruta por región de Colombia, se parquean en orden si los 10 muelles están ocupados y pasan de a uno cuando se libera un muelle; descargan cajas de distintos colores y tamaños (clic en una caja: SKU, número, procedencia, camión y unidades) y cada caja entra al inventario. Se configuran los camiones por franja (mañana, tarde, noche), los muelles habilitados, la prioridad por categoría (juguetes, ropa de mujer, de niño y de hombre, tecnología) y la restricción de cada camión (muelle fijo y franja desde la que entra). Un campo permite hacer llegar N camiones ya. Cada pedido va a una ciudad de Colombia con acceso por carretera y sale en la hora de corte que le toca (configurable; de fábrica 03:00, 09:00, 12:00, 18:00 y 20:00, con la regla de los 60 minutos y envíos tardíos), en un camión por ciudad; la entrada de camiones de despacho se puede cerrar, el informe de camiones y la Entrega a Tiempo (OTD) por día se descargan en CSV, el tiempo corre hasta 100× y el inventario muestra el total del CD, lo que hay en bodega de stock, reserva y activo, lo enviado y la capacidad de cada uno. La mercancía que baja de los camiones llega en pallets de descarga que lleva a una bodega de recibo (stock) grande, junto a los muelles y separada de los racks, una flota de 10 montacargas de muelle a stock; de ahí otra flota de 10 montacargas de stock a racks y multinivel lleva los pallets a la reserva y las cubetas al elevador del activo. Después: reserva y multinivel activo, pedidos solo de lo que hay en inventario, muros de consolidación, empaque y despacho por horario. Se pausa, se acelera (1×, 2×, 5×, 10×), se reinicia con una semilla (la misma semilla repite la corrida exacta), tiene sliders en vivo, KPIs, panel de inspección con lista y buscador, cuatro disrupciones, alertas de pedidos atascados que la persona administradora puede cancelar o reprocesar, y sonido ambiente con Web Audio. La simulación y el azar son propios (sin `Math.random`). Recuerda los sliders, la configuración del patio, la semilla, la velocidad y el silencio (`localStorage`). |

## 2.13 Cómo agregar un proyecto nuevo

1. Crear la carpeta en la raíz con nombre en snake_case.
2. Crear la estructura completa de 2.5.
3. Escribir el `README.md` según 1.6.
4. Copiar el favicon de la marca a `assets/icons/favicon.ico`, enlazarlo en el `<head>` y agregar el pie de copyright (2.16).
5. Agregar la fila en la tabla 2.12 de este archivo.
6. Agregar la tarjeta correspondiente en el portal `index.html` de la raíz.
7. Verificar el checklist 2.11 antes de darlo por terminado.

## 2.14 Plantilla base de `index.html`

Todo proyecto parte de esta plantilla. Se eliminan las líneas de librerías que no se usen.

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nombre del proyecto</title>
  <meta name="description" content="Descripción breve del proyecto">
  <link rel="icon" href="./assets/icons/favicon.ico" sizes="any">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css">
  <link rel="stylesheet" href="./css/styles.css">
  <script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
    }
  }
  </script>
</head>
<body>
  <!-- Contenido principal. Siempre con un <main> para lectores de pantalla -->
  <main id="main_content">
    <h1>Nombre del proyecto</h1>

    <!-- Al final del contenido de la página, dentro de la tarjeta si la hay -->
    <footer class="copyright">
      <p>© 2026 Andres Felipe Olaya - Dev Layer</p>
    </footer>
  </main>

  <script src="https://unpkg.com/@lottiefiles/lottie-player@2.0.12/dist/lottie-player.js"></script>
  <script type="module" src="./js/main.js"></script>
</body>
</html>
```

## 2.15 Plantilla base de `README.md` por proyecto

```markdown
# Nombre del proyecto

Descripción breve: qué hace, para quién y qué problema resuelve.

## Ejecución local

Desde esta carpeta:

    python ../dev_server.py

Abrir http://localhost:8080 en el navegador.
```

## 2.16 Marca, favicon y derechos de autor

### Favicon

- El favicon es la marca personal y es el mismo en todos los proyectos. El archivo original está en `assets/favicon.ico`, en la raíz del repositorio.
- Por el aislamiento de 2.6, **cada proyecto lleva su propia copia** en `assets/icons/favicon.ico` y la enlaza con `<link rel="icon" href="./assets/icons/favicon.ico" sizes="any">` en el `<head>`, justo después de la descripción. Nunca se enlaza `../assets/favicon.ico`.
- El portal de la raíz usa directamente `./assets/favicon.ico`.
- Si el favicon cambia, se reemplaza el original y se copia a `assets/icons/favicon.ico` de **todos** los proyectos a la vez, como pasa con las versiones de 2.3.

### Derechos de autor

- Toda página lleva, al final de su contenido, una línea con este texto exacto, con el símbolo ©, el año de la primera publicación (2026) y el nombre de la marca:

  `© 2026 Andres Felipe Olaya - Dev Layer`

- Va dentro de un `<footer class="copyright">` con un `<p>`, al pie de la tarjeta (o de la pantalla de acceso, en `book_life`, donde el resto de las pantallas exigen sesión). Estilo: `.copyright` en el `styles.css` de cada proyecto, texto pequeño (0,8 rem), centrado y con el color de texto atenuado de ese proyecto, de modo que cumpla el contraste de 1.5.
- El año de los proyectos es el de la primera publicación y no se actualiza cada enero. El portal de la raíz, en cambio, muestra el año actual (lo escribe `js/main.js`), porque su pie ya lo hacía.
- La línea es una señal de autoría; no reemplaza a la licencia.

### Licencia

- Todo el repositorio se publica bajo la licencia MIT, en el archivo `LICENSE` de la raíz, a nombre de `Andres Felipe Olaya - Dev Layer`. Los proyectos no llevan su propio archivo de licencia.
- La MIT permite que cualquiera use, copie, modifique y publique el código, con una condición: **debe conservar el aviso de copyright y el texto de la licencia** en las copias. Esa es la referencia a la autoría que se exige; no obliga a mencionarla en la interfaz de quien lo reutilice.
- Las librerías cargadas por CDN (2.3) mantienen sus propias licencias: no se copian al repositorio.

