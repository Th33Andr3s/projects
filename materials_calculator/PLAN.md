# Plan de trabajo: Calculadora de materiales (`materials_calculator`)

Documento de planificación del proyecto. Se rige por las reglas de [CLAUDE.md](../CLAUDE.md). Cada fase termina con una revisión en el navegador y la aprobación de la persona dueña antes de pasar a la siguiente.

---

## 1. Qué es este proyecto

Una página para saber cuánto material comprar para un trabajo de obra pequeño: cuántos ladrillos y cuánto mortero lleva un muro, cuántos bultos de cemento, arena y grava lleva una losa o una columna, cuánto pañete y cuánta pintura llevan unas paredes, y cuántas cajas de baldosa, pegante y boquilla lleva un piso. Pensada para usarse desde el celular, en la ferretería o en la obra, con las presentaciones que se venden en Colombia.

Funciona así:

1. **Elegir el trabajo** en una pestaña: **Muro**, **Concreto**, **Pañete y pintura** o **Piso**.
2. **Escribir las medidas** (largo, alto, espesor…) y elegir el tipo de material. El resultado aparece al instante.
3. **Leer la lista de materiales** con las cantidades ya redondeadas a lo que se compra (ladrillos enteros, bultos, galones, cajas), y copiarla para llevarla a la ferretería o enviarla por WhatsApp.

**No usa servidor ni cuentas.** Lo único que se recuerda en el equipo son los últimos valores escritos. Son cantidades aproximadas con reglas de obra habituales: cada trabajo incluye un porcentaje de desperdicio que se puede cambiar, y la pantalla lo recuerda.

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Stack | HTML, CSS, JS vanilla, Three.js, Font Awesome. Todo por CDN según CLAUDE.md 2.3. Sin Lottie |
| Datos | Ninguno en servidor. Los últimos valores de cada pestaña en `localStorage` |
| Trabajos | Muro de ladrillo o bloque, concreto para losa, columna o viga, pañete y pintura de paredes, y piso de baldosa o cerámica |
| Unidades | Medidas en metros y centímetros. Cemento en bultos de 50 kg, arena y grava en metros cúbicos, pintura en galones, pegante en bultos de 25 kg, boquilla en kilos, baldosa en cajas y piezas |
| Redondeo | Lo que se compra por unidad se redondea hacia arriba (ladrillos, bultos, galones, cajas). La arena y la grava se muestran en m³ con dos decimales |
| Desperdicio | Cada pestaña tiene un campo de desperdicio con un valor inicial habitual (5 % en muro y concreto, 10 % en pañete, pintura y piso), siempre visible y editable |
| Tablas de obra | Rendimientos y dosificaciones en una sola tabla en `js/materials.js`, con sus valores de referencia anotados, para ajustarlos sin tocar la pantalla |
| Lista de compras | Un botón por pestaña que copia la lista de materiales como texto, lista para pegar o enviar |
| Estética | Propia, limpia y sobria, como las otras calculadoras, con acento naranja. Animación 3D sutil de fondo |
| Idioma | Interfaz en español, con los nombres que se usan en Colombia (bulto, pañete, boquilla, tolete) |

---

## 3. Pantalla

Todo vive en un solo `index.html`, en una sola pantalla con cuatro pestañas. Cada pestaña tiene sus campos arriba y la lista de materiales abajo; todo recalcula al instante con cada tecla.

### 3.1 Muro
- **Datos:** largo y alto del muro (m), área a descontar por puertas y ventanas (m², puede ser 0), tipo de pieza (lista: ladrillo tolete común, bloque de arcilla n.º 4, bloque de arcilla n.º 5, bloque de concreto de 10, bloque de concreto de 15; las medidas de la pieza elegida salen en una línea de ayuda debajo de la lista, porque en celular no caben en la opción), y desperdicio (%).
- Debajo de los datos: el área neta del muro ("Área: 11,4 m²").
- **Lista:** piezas (ladrillos o bloques), bultos de cemento y m³ de arena para el mortero de pega.

### 3.2 Concreto
- **Datos:** largo, ancho y alto o espesor (m), cantidad de piezas iguales (por ejemplo, 4 columnas), dosificación (lista: 1:2:3 para losas y columnas, 1:2:4 para vigas y zapatas corrientes, 1:3:5 para pisos pobres y solados) y desperdicio (%).
- Debajo de los datos: el volumen total ("Volumen: 0,72 m³").
- **Lista:** bultos de cemento, m³ de arena, m³ de grava y litros de agua.

### 3.3 Pañete y pintura
- **Datos:** área de paredes (m²), con un atajo para calcularla: largo total de paredes × alto, menos puertas y ventanas; espesor del pañete (cm, 1,5 por defecto); manos de pintura (2 por defecto); rendimiento de la pintura (m² por galón por mano, 35 por defecto, como dice el envase); desperdicio (%).
- **Lista:** bultos de cemento y m³ de arena para el pañete, y galones de pintura (con el equivalente en cuñetes de 5 galones cuando pasa de 5).
- Una casilla permite calcular solo el pañete o solo la pintura.

### 3.4 Piso
- **Datos:** área del piso (m²), con el mismo atajo largo × ancho; tamaño de la baldosa (lista: 30×30, 33×33, 45×45, 60×60, 20×60 y "otro" con dos campos en cm); espesor de la baldosa (mm, 8 por defecto); ancho de la junta (mm, 3 por defecto); m² por caja (como dice el empaque, 1,5 por defecto); forma de instalación (recta, 10 % de desperdicio; diagonal, 15 %); el desperdicio se puede ajustar.
- **Lista:** piezas y cajas de baldosa, bultos de pegante de 25 kg y kilos de boquilla.

### 3.5 Comportamiento común
- Los campos aceptan coma o punto decimal. Un campo vacío deja la lista vacía, sin error. Un valor que no es número, negativo o fuera de rango muestra un aviso corto bajo los campos y marca el campo.
- Cada cantidad de la lista muestra el número exacto redondeado hacia arriba y, entre paréntesis, el cálculo sin redondear cuando difiere ("4 bultos (3,2)"), para que se entienda el redondeo.
- Bajo cada lista hay una nota fija: "Cantidades aproximadas con rendimientos habituales. Confirma con el empaque y compra un poco de más."
- **Copiar lista:** copia un texto con el nombre del trabajo, las medidas y una línea por material ("Cemento: 4 bultos de 50 kg"). Si el navegador no deja copiar, deja el texto seleccionado.
- Lo que se recuerda va en `localStorage` con la clave `materials_calculator_last`, en `try/catch`: la pestaña activa y los valores de cada pestaña. Si el almacenamiento falla, la página funciona igual.
- Teclado: Tab recorre pestañas, campos y botones; en las pestañas, las flechas, Inicio y Fin cambian de trabajo. Foco siempre visible.
- Sin `console.log` ni errores en consola.

---

## 4. Cómo se calcula

Todo el cálculo vive en `js/materials.js`, funciones puras sin tocar la pantalla, para probarlas con valores conocidos. Las tablas de este apartado son los valores iniciales; están en ese archivo con su fuente anotada.

### 4.1 Muro
- Área neta `= largo × alto − vanos`.
- Piezas por m² `= 1 / ((largo_pieza + junta) × (alto_pieza + junta))`, con la cara que queda a la vista y junta de 1,5 cm.
- Mortero de pega por m² `= espesor_muro − piezas_por_m² × volumen_que_ocupa_la_pieza_en_el_muro` (para las piezas huecas solo cuentan las juntas, no se rellenan las celdas).
- Totales `= área × (por m²) × (1 + desperdicio)`. El mortero se convierte a cemento y arena con la dosificación 1:4.

| Pieza | Cara a la vista (cm) | Espesor del muro (cm) | Piezas por m² (calculadas) | Mortero por m² (calculado) |
|---|---|---|---|---|
| Ladrillo tolete común | 25 × 6,5 | 12 | 47,2 | 0,028 m³ |
| Bloque de arcilla n.º 4 | 30 × 20 | 10 | 14,8 | 0,011 m³ |
| Bloque de arcilla n.º 5 | 33 × 23 | 12 | 11,8 | 0,012 m³ |
| Bloque de concreto de 10 | 40 × 20 | 10 | 11,2 | 0,010 m³ |
| Bloque de concreto de 15 | 40 × 20 | 15 | 11,2 | 0,016 m³ |

Estas cifras salen de las dos fórmulas de arriba (el mortero por m² es `espesor × (1 − piezas por m² × largo × alto de la pieza)`, es decir, las juntas en todo el espesor del muro); en `materials.js` se calculan, no se escriben a mano. Para bloques huecos eso da un poco más de mortero del que gasta una pega solo sobre las paredes de la pieza, lo que va del lado de comprar de más.

### 4.2 Mortero (pega y pañete)
Por metro cúbico de mortero:

| Dosificación | Cemento (bultos de 50 kg) | Arena (m³) |
|---|---|---|
| 1:3 | 10 | 1,00 |
| 1:4 | 8 | 1,10 |
| 1:5 | 6,5 | 1,15 |

Se usa 1:4 para la pega y el pañete, que es lo habitual.

### 4.3 Concreto
Volumen `= largo × ancho × alto × cantidad × (1 + desperdicio)`. Por metro cúbico de concreto:

| Dosificación | Uso habitual | Cemento (bultos) | Arena (m³) | Grava (m³) | Agua (L) |
|---|---|---|---|---|---|
| 1:2:3 | Losas, columnas, vigas (≈ 21 MPa, 3000 psi) | 8,5 | 0,55 | 0,80 | 190 |
| 1:2:4 | Vigas y zapatas corrientes (≈ 17,5 MPa, 2500 psi) | 7 | 0,55 | 0,90 | 180 |
| 1:3:5 | Pisos pobres y solados (≈ 14 MPa) | 5 | 0,60 | 0,95 | 170 |

### 4.4 Pañete y pintura
- Pañete: volumen `= área × espesor × (1 + desperdicio)`, convertido a cemento y arena con 1:4.
- Pintura: galones `= área × manos / rendimiento × (1 + desperdicio)`, redondeado hacia arriba. 1 cuñete = 5 galones.

### 4.5 Piso
- Piezas `= área × (1 + desperdicio) / (largo_baldosa × ancho_baldosa)`, redondeado hacia arriba. Cajas `= área × (1 + desperdicio) / m²_por_caja`, hacia arriba.
- Pegante: 5 kg por m² para baldosas de hasta 33 cm y 6 kg por m² para más grandes, en bultos de 25 kg.
- Boquilla (kg por m²) `= (A + B) / (A × B) × espesor × junta × 1,6`, con A y B los lados de la baldosa en mm, el espesor y la junta en mm (fórmula habitual de los fabricantes), más el desperdicio.

### 4.6 Valores de comprobación
La fase 2 corre una prueba automática con estos casos, calculados aparte:
- Muro de 5 × 2,4 m sin vanos, ladrillo tolete, 5 % de desperdicio: 12 m², 595 ladrillos (594,3), 0,35 m³ de mortero → 3 bultos (2,8) y 0,39 m³ de arena.
- Columna de 0,3 × 0,3 × 3 m, 4 piezas, 1:2:3, 5 %: 1,13 m³ → 10 bultos, 0,62 m³ de arena, 0,91 m³ de grava.
- Pañete de 40 m² a 1,5 cm, 10 %: 0,66 m³ → 6 bultos y 0,73 m³ de arena. Pintura de 40 m², 2 manos, 35 m²/galón, 10 %: 3 galones (2,51).
- Piso de 20 m², baldosa 33×33, 8 mm, junta 3 mm, 1,5 m²/caja, recto 10 %: 203 piezas, 15 cajas, 5 bultos de pegante (4,4), boquilla 5,2 kg (5,12; 0,23 kg por m² más 10 % de desperdicio).

---

## 5. Cómo se muestran los números
- Áreas y volúmenes con hasta dos decimales y coma decimal ("11,4 m²", "0,72 m³").
- Cantidades que se compran por unidad, como enteros redondeados hacia arriba, con el valor sin redondear entre paréntesis cuando difiere.
- La lista copiada va como texto plano, una línea por material, sin símbolos raros, para que se lea bien en cualquier chat.

---

## 6. Diseño visual y animación

- Fondo oscuro neutro con un acento naranja para la pestaña activa, las cantidades y el botón de copiar. Buen contraste de texto en todo (WCAG AA, 4,5 a 1 en textos).
- Tarjeta central de hasta 560 px de ancho, a todo el ancho en celular. Los campos van en pares lado a lado (largo y alto, manos y rendimiento) y se alinean aunque una etiqueta se parta en dos líneas. El contorno de foco es azul claro, para no confundirse con el naranja del acento.
- **Animación 3D (Three.js):** bloques translúcidos, como ladrillos, que flotan y giran despacio detrás de la tarjeta y hacen un leve destello cuando cambia el resultado. Decorativa: la página funciona igual si no carga. Three.js se importa con `import()` dentro de `animations.js`, como en las otras calculadoras.
- Según CLAUDE.md 2.10: `requestAnimationFrame`, tope de 30 cuadros por segundo, `pixelRatio` máximo 2, se ajusta al cambiar el tamaño, se pausa con la pestaña oculta y con `prefers-reduced-motion` se queda quieta.

---

## 7. Fases de desarrollo

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Estructura de carpetas, `index.html` con las cuatro pestañas completas, `css/styles.css` responsive y README | Hecha |
| 2 | Tablas y fórmulas (`js/materials.js`) con su prueba de valores conocidos, y las pestañas Muro y Concreto (`js/main.js`), con copiar lista y valores recordados ya conectados para esas dos | Hecha |
| 3 | Pestañas Pañete y pintura y Piso (con su copiar lista y sus valores recordados, sobre lo ya hecho para Muro y Concreto) | Hecha |
| 4 | Animación 3D de fondo (`js/animations.js`) | Hecha |
| 5 | Cierre: checklist de CLAUDE.md 2.11, tarjeta en el portal, prueba en celular y en GitHub Pages | Hecha (las pruebas en celular y en GitHub Pages quedan para la persona dueña, sección 11) |

---

## 8. Estructura de archivos del proyecto

```
materials_calculator/
├── index.html
├── README.md
├── PLAN.md                  # Este documento
├── css/
│   └── styles.css
└── js/
    ├── main.js              # Pantalla, formato de números, lista de compras y memoria
    ├── materials.js         # Tablas de obra y fórmulas de cada trabajo
    └── animations.js        # Bloques 3D de fondo
```

`materials.js` es un archivo de lógica importado desde `main.js`, como permite CLAUDE.md 2.5. Sin carpeta `assets/`: no hay imágenes, iconos propios ni Lottie.

---

## 9. Ejecución local

Desde esta carpeta, `python ../dev_server.py` y abrir http://localhost:8080 (ver CLAUDE.md 2.8).

---

## 10. Riesgos y cómo se manejan

| Riesgo | Manejo |
|---|---|
| Los rendimientos reales varían con el material, la mano de obra y el proveedor | Son valores de referencia habituales y la pantalla lo dice siempre. El desperdicio es editable y las tablas están en un solo archivo para ajustarlas |
| Medidas de ladrillo o bloque distintas a las de la tabla | La lista de piezas cubre las comunes en Colombia; si hace falta otra, se agrega una línea en la tabla |
| Confundir bultos de 50 kg con otras presentaciones | Cada cantidad lleva la presentación en el nombre ("bultos de 50 kg", "bultos de 25 kg", "galones") |
| Quedarse corto por el redondeo | Todo lo que se compra por unidad se redondea hacia arriba, y la nota recomienda comprar un poco de más |
| El portapapeles no funciona (http sin https) | Se selecciona la lista y se avisa para copiar a mano. En GitHub Pages hay https |
| El 3D pesa en un equipo lento | Pocos bloques, tope de cuadros, y la página funciona sin 3D |

---

## 11. Cierre: checklist de CLAUDE.md 2.11

Revisión técnica hecha con la aplicación corriendo, también servida desde el portal en una subcarpeta, como quedará en GitHub Pages.

| Punto | Estado |
|---|---|
| Estructura como en 2.5 | Cumple. Sin `config.js` (no usa Supabase) y sin `assets/` (no hay imágenes, iconos propios ni Lottie), como permite 2.5. Además de `main.js` y `animations.js` lleva `materials.js` (tablas y fórmulas), que 2.5 permite al dividir la lógica, y este `PLAN.md` |
| `README.md` con título, descripción y ejecución local | Cumple, con el comando `python ../dev_server.py` |
| 360 px hasta escritorio | Cumple: sin desplazamiento horizontal en ninguna pestaña desde 320 hasta 1920 px. El formulario es largo, así que se desplaza en vertical casi siempre (ver la tabla de abajo); solo Muro cabe sin desplazarse en tableta (768×1024) y en 1920×950 |
| Teclado y foco visible | Cumple: Tab recorre enlace de salto, pestaña activa, casillas, campos, ayudas plegables y botones; las flechas, Inicio y Fin cambian de pestaña; Espacio marca las casillas y Enter abre las ayudas y usa el área. Todos los controles tienen contorno azul claro de 3 px (en los campos con unidad rodea el campo completo). Los 44 controles tienen nombre accesible, sin ids repetidos; pestañas con `role="tablist"`, `tab` y `tabpanel` |
| Sin errores en la consola | Cumple: limpia al cargar y al usar, y también con Three.js caído, con el almacenamiento bloqueado y con datos guardados dañados (JSON roto, `null`, tipos equivocados) |
| Rutas relativas con `./` | Cumple. Ninguna ruta absoluta; probado servido desde `/materials_calculator/` y abierto desde la tarjeta del portal |
| Librerías por CDN y versiones de 2.3 | Cumple: Font Awesome 6.7.2 y Three.js 0.170.0. No se carga Lottie porque no se usa. Three.js se importa con `import()` dentro de `animations.js` para que su caída no rompa la calculadora |
| `prefers-reduced-motion` y pausa con pestaña oculta | Cumple: con movimiento reducido queda una imagen quieta, sin bucle y sin destello; al ocultar la pestaña el bucle se cancela y se retoma al volver. Tope de 30 cuadros por segundo comprobado y `pixelRatio` máximo 2 en el código |
| `localStorage` con prefijo y `try/catch` | Cumple: una sola clave, `materials_calculator_last`, con lectura y escritura dentro de `try/catch`, y valores dañados descartados campo por campo |
| Código en inglés, comentarios en español, snake_case | Cumple. Sin `console.*`, TODO, `eval` ni `innerHTML`. Sin constantes, funciones ni importaciones sin uso (se dejó de exportar `MORTAR_1_4`, que solo usa `materials.js`) |
| Agregado al portal | Cumple: tarjeta en el `index.html` de la raíz y fila actualizada en la tabla 2.12 de CLAUDE.md |
| Una persona sin contexto lo entiende | Cuatro pestañas con nombre e icono; cada una con sus campos arriba y la lista de materiales debajo, que aparece al instante, con la presentación en cada cantidad ("bultos de 50 kg"), avisos cortos si un valor no sirve y una nota que pide comprar un poco de más |

### Cuánto hay que desplazarse (píxeles extra de alto de la página)

Medido con el caso más largo de cada pestaña (en Pañete y pintura, 200 m², que muestra la línea de cuñetes).

| Pantalla | Muro | Concreto | Pañete y pintura | Piso |
|---|---|---|---|---|
| 320×640 | 346 | 485 | 565 | 535 |
| 360×740 | 185 | 301 | 378 | 373 |
| 390×844 | 82 | 198 | 255 | 270 |
| 768×1024 | 0 | 48 | 114 | 142 |
| 1366×768 | 78 | 218 | 294 | 310 |
| 1920×950 | 0 | 122 | 188 | 216 |

Además:
- **Exactitud:** las fórmulas coinciden con los valores de comprobación de 4.6 (muro, columna, pañete, pintura y piso) y con la tabla de piezas por m² de 4.1; los textos copiados de las cuatro listas se revisaron a mano.
- **Contraste de colores (WCAG AA):** todos los textos superan 4,5 a 1 (el más bajo, el texto atenuado sobre la pestaña, da 6,3). El foco, los bordes de campos y botones y el acento superan 3 a 1 (el más bajo, el borde de los controles sobre la tarjeta, da 4,0).
- **Sin secretos ni datos personales:** el proyecto no usa claves, servidores ni cuentas. Lo único que guarda en el equipo son los últimos valores escritos.
- **Cuidado al probar:** si se sirve otra carpeta en el mismo puerto de `localhost`, el navegador puede mostrar archivos guardados de la carpeta anterior (el portal se vio sin estilos por eso). `dev_server.py` no tiene este problema porque no deja guardar copias.

### Pruebas que solo se pueden hacer a mano
1. En **uno o dos celulares** (uno con iPhone si es posible): recorrer las cuatro pestañas, escribir con coma y con punto, usar las ayudas para calcular el área, tocar **Copiar lista** y pegar en WhatsApp. Mirar que el fondo se vea fluido.
2. En **GitHub Pages**, tras publicar: abrir `https://<usuario>.github.io/projects/materials_calculator/` y comprobar que carga sin errores, con iconos y fondo, y que Copiar lista funciona (el portapapeles solo funciona con https).
3. Activar "reducir movimiento" en el sistema y comprobar que el fondo queda quieto.
4. **Comparar con la ferretería o con un maestro de obra:** calcular un muro, una losa o un piso reales tuyos y comparar las cantidades. Los rendimientos son de referencia: si en tu zona se usa otra dosificación o rinde distinto el pegante, se ajusta en un solo lugar, `js/materials.js`.

### Actualización posterior: favicon y copyright

Se agregó el favicon de la marca (`assets/icons/favicon.ico`, enlazado en el `<head>`) y el pie de copyright con el texto de CLAUDE.md 2.16. El pie suma unos 30 px de alto (el doble de línea en pantallas muy angostas, donde el texto se parte en dos), así que los píxeles de desplazamiento medidos antes en este documento aumentan en esa medida. En 1366×768 la pestaña Muro, que ya necesitaba 78 px de desplazamiento, ahora necesita 107 px.

