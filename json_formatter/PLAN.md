# Plan de trabajo: Formateador de JSON (`json_formatter`)

Documento de planificación del proyecto. Se rige por las reglas de [CLAUDE.md](../CLAUDE.md). Cada fase termina con una revisión en el navegador y la aprobación de la persona dueña antes de pasar a la siguiente.

> **Nombre de la carpeta.** CLAUDE.md 1.3 pide snake_case en minúscula para carpetas y archivos, y 2.7 recuerda que GitHub Pages distingue mayúsculas en las direcciones. La carpeta se creó como `JSON_Formatter` y en la Fase 1 se renombró a `json_formatter`, que es el nombre que usa este plan, el portal y la tabla 2.12 de CLAUDE.md.

---

## 1. Qué es este proyecto

Una página para pegar un JSON y dejarlo legible: lo ordena con sangría, lo comprime en una sola línea, avisa en qué línea y columna está el error cuando no es válido y deja copiar o descargar el resultado. Pensada para quien trabaja con respuestas de una API, archivos de configuración o datos exportados y necesita leerlos o arreglarlos rápido, desde el computador o el celular.

Funciona así:

1. **Pegar o escribir el JSON** en el cuadro de entrada.
2. **Ver el resultado al instante**: formateado o minificado según el modo elegido, con la sangría que se prefiera. Si el JSON no es válido, en vez del resultado aparece el error con su línea y columna y un botón para ir hasta él.
3. **Copiar o descargar** el resultado.

**No usa servidor ni cuentas.** Nada de lo que se pega sale del navegador. Lo único que se recuerda en el equipo son las opciones y el último texto (si no es muy grande).

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Stack | HTML, CSS, JS vanilla, Three.js, Font Awesome. Todo por CDN según CLAUDE.md 2.3. Sin Lottie |
| Datos | Ninguno en servidor. Las opciones y el último texto en `localStorage` |
| Análisis del JSON | Un analizador propio en `js/json_tools.js`, no `JSON.parse`. Razones: `JSON.parse` da mensajes de error distintos en cada navegador y sin línea ni columna fiables, cambia los números grandes (`12345678901234567890` pierde cifras), reordena las claves que parecen números y normaliza los textos con escapes. Un formateador no debe cambiar nada del contenido: el analizador propio conserva cada número y cada texto tal como se escribieron y solo cambia los espacios |
| Qué acepta | JSON estricto (RFC 8259): comillas dobles, sin comas finales, sin comentarios, sin `NaN` ni `Infinity`. Lo que no cumple se reporta como error, con un mensaje claro de qué se esperaba |
| Modos | **Formateado** (una clave o elemento por línea, con sangría) y **Minificado** (todo en una línea, sin espacios). Se elige con dos botones tipo pestaña y el resultado se actualiza solo |
| Sangría | 2 espacios (por defecto), 4 espacios o tabulación. Los arreglos y objetos vacíos quedan como `[]` y `{}` en una sola línea |
| Ordenar claves | Casilla, apagada por defecto, que ordena las claves de todos los objetos alfabéticamente (orden estable; las claves repetidas se conservan). Los arreglos nunca se reordenan |
| Resultado en vivo | El resultado se recalcula al escribir, con una pequeña espera (150 ms) para no trabajar en cada tecla. Entradas de hasta 2 MB; por encima se avisa y no se procesa, para que el celular no se congele. Un resultado de más de 20.000 líneas tampoco se muestra en el cuadro (un cuadro de texto tarda unos 3 segundos en dibujar 130.000 líneas): se avisa y, con Copiar y Descargar, se puede sacar completo |
| Copiar y descargar | **Copiar** copia el resultado; si el navegador no deja, lo selecciona y avisa para copiarlo a mano. **Descargar** guarda `resultado.json` |
| Error | Línea y columna (contando desde 1), un mensaje en español ("Falta una coma entre los elementos", "Las comillas deben ser dobles"…) y el botón **Ir al error**, que pone el cursor en ese punto del cuadro de entrada |
| Estadísticas | Bajo el resultado: tamaño de entrada y de salida, líneas del resultado, número de claves, de elementos de arreglo y profundidad máxima |
| Estética | Propia, limpia y sobria, como las otras herramientas, con acento violeta. Animación 3D sutil de fondo |
| Idioma | Interfaz en español. Los mensajes de error son propios, así se leen igual en cualquier navegador |

---

## 3. Pantalla

Todo vive en un solo `index.html`, en una sola pantalla.

### 3.1 Entrada
- **Cuadro de texto** grande ("Pega aquí tu JSON"), de fuente monoespaciada, que crece con el contenido hasta un máximo y luego se desplaza. Acepta pegar con Ctrl+V o con el menú del celular.
- Debajo, el **estado en vivo**: "JSON válido" en verde con un resumen corto ("2 claves · 1,2 KB"), o el error en el color de aviso: "Línea 4, columna 12: falta una coma entre las propiedades", con el botón **Ir al error**. Con el cuadro vacío no se muestra nada.
- Botón **Limpiar**, que vacía la entrada y el resultado (con el foco de vuelta en el cuadro).

### 3.2 Opciones
- **Modo:** Formateado / Minificado (dos botones con `role="tab"`, como las pestañas de las otras herramientas).
- **Sangría:** lista desplegable con 2 espacios, 4 espacios y tabulación. Solo aplica al modo formateado; en minificado queda desactivada.
- **Ordenar claves:** casilla.

### 3.3 Resultado
- Cuadro de solo lectura, monoespaciado, con el resultado. Se puede seleccionar con el dedo o el mouse. Si la entrada no es válida o está vacía, muestra un texto atenuado ("Aquí aparece el resultado").
- Botones **Copiar** y **Descargar**, desactivados cuando no hay resultado.
- **Estadísticas** en una línea: "Entrada 1,2 KB · Salida 1,6 KB · 48 líneas · 12 claves · 5 elementos · profundidad 3".

### 3.4 Comportamiento común
- Lo que se recuerda va en `localStorage` con la clave `json_formatter_last`, en `try/catch`: modo, sangría, ordenar claves y el texto de entrada si pesa 200 KB o menos. Si el almacenamiento falla, la página funciona igual.
- Teclado: Tab recorre entrada, estado, opciones, resultado y botones; en el modo, las flechas, Inicio y Fin cambian entre Formateado y Minificado. Dentro del cuadro de entrada Tab no inserta tabulaciones (sigue siendo la tecla para moverse, por accesibilidad). Foco siempre visible.
- Copiar: el botón dice "Copiado" dos segundos y vuelve a su texto; se avisa a lectores de pantalla.
- Sin `console.log` ni errores en consola.

---

## 4. Análisis y escritura del JSON

Toda la lógica vive en `js/json_tools.js` como funciones puras, sin tocar la pantalla, para probarlas con valores conocidos.

### 4.1 Analizador
- Recorre el texto carácter por carácter siguiendo la gramática de RFC 8259 y produce un árbol: objetos (lista de pares clave-valor, en el orden del texto), arreglos, y valores hoja que guardan el **texto original**: `"é"` sigue siendo `"é"`, `1.50` sigue siendo `1.50`, `1e5` sigue siendo `1e5`.
- Lleva la cuenta de línea y columna. Al primer error se detiene y devuelve `{ line, column, message }`. La columna cuenta caracteres desde 1; un tabulador cuenta como un carácter.
- Mensajes (los más comunes): "Falta una coma entre las propiedades", "Falta una coma entre los elementos", "Sobra una coma antes de }" (o de `]`), "Las comillas deben ser dobles", "Falta cerrar el texto con comillas", "Faltan los dos puntos después de la clave", "Se esperaba un valor", "Los números no pueden empezar por 0", "Hay texto después del final del JSON", "Falta cerrar el objeto con }" (o el arreglo con `]`), "Carácter no permitido dentro del texto" (saltos de línea o controles sin escapar), "Escape no válido".
- Acepta `true`, `false` y `null`; cualquier otra palabra ("undefined", "True", "NaN") es "Se esperaba un valor".

### 4.2 Escritor
- **Formateado:** cada par o elemento en su propia línea, con la sangría elegida por nivel, `"clave": valor` con un espacio tras los dos puntos, y `[]` y `{}` para los vacíos. Termina sin salto de línea final.
- **Minificado:** sin ningún espacio fuera de los textos.
- **Ordenar claves:** orden alfabético por el texto de la clave con `localeCompare` en español, estable, aplicado a todos los niveles.

### 4.3 Estadísticas
- Tamaño en bytes UTF-8 de entrada y salida, mostrado como "850 B", "1,2 KB" o "3,4 MB" (con coma decimal).
- Claves: total de pares en todos los objetos. Elementos: total de valores en todos los arreglos. Profundidad: niveles de anidación (un valor suelto es 0; `{"a":[1]}` es 2).

### 4.4 Valores de comprobación
La fase 2 corre una prueba automática con estos casos, calculados aparte:
- `{"a":1,"b":[true,null,"x"]}` formateado con 2 espacios es:
  ```
  {
    "a": 1,
    "b": [
      true,
      null,
      "x"
    ]
  }
  ```
  y minificado vuelve a ser `{"a":1,"b":[true,null,"x"]}`. Estadísticas: 2 claves, 3 elementos, profundidad 2.
- `{"z":1,"a":{"c":2,"b":[]}}` con ordenar claves y 4 espacios conserva `[]` en una línea y queda con las claves `a` (con `b`, `c` dentro) y luego `z`.
- `[12345678901234567890, 1.50, 1e5, "é", "café"]` minificado devuelve exactamente el mismo texto: ningún número ni texto cambia.
- `{"2":"b","1":"a"}` sin ordenar conserva `"2"` antes que `"1"` (con `JSON.parse` se invertirían).
- Errores: `{"a":1,}` → línea 1, columna 8, "Sobra una coma antes de }". `{'a':1}` → línea 1, columna 2, "Las comillas deben ser dobles". `[1 2]` → línea 1, columna 4, "Falta una coma entre los elementos". `{"a":01}` → línea 1, columna 6, "Los números no pueden empezar por 0". `{"a":"sin cerrar}` → línea 1, columna 6, "Falta cerrar el texto con comillas". `{"a":1}x` → línea 1, columna 8, "Hay texto después del final del JSON". Un error en la segunda línea de `{\n"a" 1}` → línea 2, columna 5, "Faltan los dos puntos después de la clave".
- Texto vacío o solo espacios no es un error: no hay resultado y no se muestra estado.

---

## 5. Cómo se muestran los números
- Tamaños con una cifra decimal y coma ("1,2 KB"); bytes enteros ("850 B").
- Conteos enteros, con punto de miles si pasan de 999 ("1.250 claves").
- Líneas y columnas contadas desde 1, como en los editores.

---

## 6. Diseño visual y animación

- Fondo oscuro neutro con un acento violeta para el modo activo, el estado "JSON válido" (en verde, el único color aparte del acento) y los botones principales. Buen contraste en todo (WCAG AA, 4,5 a 1 en textos). El contorno de foco es cian, para no confundirse con el violeta.
- Tarjeta central de hasta 720 px de ancho (más ancha que las calculadoras porque el JSON se lee mejor con líneas largas), a todo el ancho en celular. Entrada arriba, opciones en una fila que se parte en celular, resultado abajo. A partir de 1100 px de ancho la tarjeta crece a 1200 px y entrada y resultado quedan lado a lado.
- Cuadros de texto monoespaciados, de 16 px para que iOS no haga zoom, con alto mínimo de 10 líneas y máximo de 60 % del alto de la pantalla.
- **Animación 3D (Three.js):** llaves y corchetes translúcidos (`{ } [ ]`), planos y dibujados solo con su contorno (8 en pantallas pequeñas y 20 en las grandes), que flotan y giran despacio detrás de la tarjeta y hacen un leve destello cuando el texto pasa de ser un JSON válido a uno con error o al revés, y al copiar el resultado con éxito. No destellan al seguir escribiendo algo válido, al cambiar las opciones ni al limpiar. Decorativa: la página funciona igual si no carga. Three.js se importa con `import()` dentro de `animations.js`, como en las otras herramientas.
- Según CLAUDE.md 2.10: `requestAnimationFrame`, tope de 30 cuadros por segundo, `pixelRatio` máximo 2, se ajusta al cambiar el tamaño, se pausa con la pestaña oculta y con `prefers-reduced-motion` se queda quieta.

---

## 7. Fases de desarrollo

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Renombrar la carpeta a `json_formatter`, estructura de carpetas, `index.html` estático con entrada, opciones, resultado y estado de ejemplo, `css/styles.css` responsive y README | Hecha |
| 2 | Analizador y escritor (`js/json_tools.js`) con su prueba de valores conocidos, y la pantalla en vivo (`js/main.js`): entrada, modo, sangría, resultado y estado de error con "Ir al error". Se adelantaron de la fase 3 el orden de las claves y el tope de 2 MB | Hecha |
| 3 | Estadísticas bajo el resultado, Copiar, Descargar, Limpiar y valores recordados (el orden de las claves y el tope de 2 MB ya están hechos) | Hecha |
| 4 | Animación 3D de fondo (`js/animations.js`) | Hecha |
| 5 | Cierre: checklist de CLAUDE.md 2.11, tarjeta en el portal, fila en CLAUDE.md 2.12, prueba en celular y en GitHub Pages | Hecha (las pruebas en celular, de copiar y descargar y en GitHub Pages quedan para la persona dueña, sección 11) |

---

## 8. Estructura de archivos del proyecto

```
json_formatter/
├── index.html
├── README.md
├── PLAN.md                  # Este documento
├── css/
│   └── styles.css
└── js/
    ├── main.js              # Pantalla: entrada, opciones, resultado, estado, copiar, descargar y memoria
    ├── json_tools.js        # Analizador, escritor y estadísticas del JSON
    └── animations.js        # Llaves y corchetes 3D de fondo
```

`json_tools.js` es un archivo de lógica importado desde `main.js`, como permite CLAUDE.md 2.5. Sin carpeta `assets/`: no hay imágenes, iconos propios ni Lottie.

---

## 9. Ejecución local

Desde esta carpeta, `python ../dev_server.py` y abrir http://localhost:8080 (ver CLAUDE.md 2.8).

---

## 10. Riesgos y cómo se manejan

| Riesgo | Manejo |
|---|---|
| Un JSON muy grande congela el celular | Tope de 2 MB con aviso, espera de 150 ms al escribir, y el analizador recorre el texto una sola vez sin expresiones regulares costosas |
| El formateador cambia el contenido (números grandes, orden de claves, escapes) | Analizador y escritor propios que conservan el texto original de cada valor; la prueba de la fase 2 lo comprueba con un caso de ida y vuelta exacta |
| El mensaje de error no ayuda a encontrar el problema | Línea y columna propias, mensaje de qué se esperaba y botón para poner el cursor en el punto exacto |
| Pegar datos sensibles (tokens, claves) | Nada sale del navegador y la página lo dice. El texto solo se recuerda en el equipo si pesa 200 KB o menos; "Limpiar" lo borra también de lo recordado |
| El portapapeles no funciona (http sin https) | Se selecciona el resultado y se avisa para copiar a mano. En GitHub Pages hay https |
| Alguien espera que se acepten comentarios o comas finales (JSON5) | Fuera de alcance: el proyecto es un formateador de JSON estricto, y el error lo dice con claridad. Si más adelante se quiere un modo "reparar", se agrega como opción aparte |
| El 3D pesa en un equipo lento | Pocas piezas, tope de cuadros, y la página funciona sin 3D |

---

## 11. Cierre: checklist de CLAUDE.md 2.11

Revisión técnica hecha con la aplicación corriendo, también servida desde el portal en una subcarpeta, como quedará en GitHub Pages.

| Punto | Estado |
|---|---|
| Estructura como en 2.5 | Cumple. Sin `config.js` (no usa Supabase) y sin `assets/` (no hay imágenes, iconos propios ni Lottie), como permite 2.5. Además de `main.js` y `animations.js` lleva `json_tools.js` (analizador, escritor y estadísticas), que 2.5 permite al dividir la lógica, y este `PLAN.md` |
| `README.md` con título, descripción y ejecución local | Cumple, con el comando `python ../dev_server.py` |
| 360 px hasta escritorio | Cumple: sin desplazamiento horizontal desde 320 hasta 1920 px, ni con resultado, ni con error, ni con una línea de miles de caracteres. En portátil (1366×768) y en 1920×950 la página entera cabe sin desplazarse vertical, con cualquier tamaño de resultado (el contenido largo se desplaza dentro del cuadro). En celular y tableta se desplaza (ver la tabla de abajo) |
| Teclado y foco visible | Cumple: Tab recorre enlace de salto, Limpiar, entrada, modo, sangría, ordenar claves, resultado, Copiar y Descargar (los desactivados se saltan); las flechas, Inicio y Fin cambian de modo; Espacio marca la casilla; **Ir al error** se activa con Enter y deja el cursor en el carácter exacto. Dentro de la entrada, Tab sigue siendo la tecla para moverse. Todos los controles tienen contorno cian de 3 px y nombre accesible, sin ids repetidos ni referencias rotas; el modo usa `role="tablist"`, `tab` y `tabpanel`, y el estado y los avisos de copiar, descargar y limpiar se anuncian con `role="status"` |
| Sin errores en la consola | Cumple: limpia al cargar y al usar, y también con Three.js caído, con el almacenamiento bloqueado y con datos guardados dañados (JSON roto, tipos equivocados: se descarta cada campo malo por separado) |
| Rutas relativas con `./` | Cumple. Ninguna ruta absoluta; probado servido desde `/json_formatter/` y abierto desde la tarjeta del portal |
| Librerías por CDN y versiones de 2.3 | Cumple: Font Awesome 6.7.2 y Three.js 0.170.0. No se carga Lottie porque no se usa. Three.js se importa con `import()` dentro de `animations.js` para que su caída no rompa el formateador |
| `prefers-reduced-motion` y pausa con pestaña oculta | Cumple: con movimiento reducido queda una imagen quieta, sin bucle y sin destello; al ocultar la pestaña el bucle se cancela y se retoma al volver. Tope de 30 cuadros por segundo comprobado y `pixelRatio` máximo 2 (lienzo de 780×1688 en una pantalla de 390×844 con ratio 2) |
| `localStorage` con prefijo y `try/catch` | Cumple: una sola clave, `json_formatter_last`, con lectura y escritura dentro de `try/catch`. El texto solo se guarda si pesa 200 KB o menos (comprobado al byte) y Limpiar lo borra |
| Código en inglés, comentarios en español, snake_case | Cumple. Sin `console.*`, TODO, `eval` ni `innerHTML`. Sin constantes, funciones ni importaciones sin uso (se dejó de exportar `MAX_DEPTH`, que solo usa `json_tools.js`). Los tres módulos pasan `node --check` |
| Agregado al portal | Cumple: tarjeta en el `index.html` de la raíz y fila nueva en la tabla 2.12 de CLAUDE.md |
| Una persona sin contexto lo entiende | Una sola pantalla con un cuadro para pegar y otro con el resultado, que aparece solo; el estado dice "JSON válido" o el error con su línea y columna y un botón que lleva hasta él; los botones desactivados dejan claro cuándo hay algo que copiar; un texto arriba explica que nada sale del navegador |

### Cuánto hay que desplazarse (píxeles extra de alto de la página)

Medido con la entrada vacía, con un JSON de 16 líneas de resultado y con un error en ese mismo JSON. En pantallas anchas y con un resultado largo (400 valores) la página tampoco se desplaza: el cuadro llega a su máximo y el contenido se mueve dentro de él.

| Pantalla | Vacío | JSON de 16 líneas | Con error |
|---|---|---|---|
| 320×640 | 550 | 620 | 513 |
| 360×740 | 283 | 490 | 357 |
| 390×844 | 182 | 388 | 255 |
| 768×1024 | 31 | 218 | 82 |
| 1366×768 | 0 | 0 | 0 |
| 1920×950 | 0 | 0 | 0 |

En celular y tableta, con un resultado muy largo la página crece hasta el 60 % del alto de la pantalla por cuadro y el resto se desplaza dentro del cuadro.

Además:
- **Exactitud:** el analizador y el escritor pasan los valores de comprobación de 4.4 y unas 70 variantes más (cada tipo de error con su línea y columna, saltos `\r\n` y `\r`, emojis, claves repetidas y ordenadas, ida y vuelta exacta, 1000 niveles de anidación). Un JSON de 5,5 MB se analiza en 139 ms.
- **Contenido intacto:** `12345678901234567890`, `1.50`, `1e5`, `"é"` y el orden de `{"2":..,"1":..}` salen exactamente como entraron.
- **Contraste de colores (WCAG AA):** todos los textos superan 4,5 a 1 (el más bajo, el texto atenuado sobre la pestaña, da 6,3). El foco, los bordes de los controles y el acento superan 3 a 1 (el más bajo, el borde de los controles sobre la tarjeta, da 4,0).
- **Límites:** 2 MB de entrada (probado al byte y con texto de varios bytes por carácter) y 20.000 líneas mostradas; por encima, un aviso, con Copiar y Descargar entregando el resultado completo.
- **Sin secretos ni datos personales:** el proyecto no usa claves, servidores ni cuentas. Nada de lo que se pega sale del navegador y ningún ejemplo con datos reales queda en los archivos.
- **Cuidado al probar:** si se sirve otra carpeta en el mismo puerto de `localhost`, el navegador puede mostrar archivos guardados de la carpeta anterior. `dev_server.py` no tiene este problema porque no deja guardar copias.

### Pruebas que solo se pueden hacer a mano
1. En **uno o dos celulares** (uno con iPhone si es posible): pegar un JSON desde el menú del teléfono, mirar que el teclado no tape los cuadros, usar **Ir al error**, cambiar de modo y tocar **Copiar** y pegar en otra aplicación. Mirar que el fondo se vea fluido.
2. **Copiar y descargar de verdad:** comprobar que **Copiar** deja el resultado en el portapapeles (en el navegador de pruebas el portapapeles no se pudo usar y entró el aviso "Copia a mano") y que **Descargar** guarda `resultado.json` donde esperas.
3. En **GitHub Pages**, tras publicar: abrir `https://<usuario>.github.io/projects/json_formatter/` y comprobar que carga sin errores, con iconos y fondo, y que Copiar funciona (el portapapeles solo funciona con https).
4. Activar "reducir movimiento" en el sistema y comprobar que el fondo queda quieto.
5. **Comparar con un JSON real tuyo:** pegar una respuesta de una API o un archivo de configuración, formatearlo y compararlo con otra herramienta; el contenido debe ser idéntico salvo los espacios.
6. Probar con un JSON de más de 1 MB en el celular: debe responder en pocos segundos o avisar que el resultado es demasiado largo para mostrarlo.
