# Plan de trabajo: Calculadora de medidas (`measurement_calculator`)

Documento de planificación del proyecto. Se rige por las reglas de [CLAUDE.md](../CLAUDE.md). Cada fase termina con una revisión en el navegador y la aprobación de la persona dueña antes de pasar a la siguiente.

---

## 1. Qué es este proyecto

Una página para convertir un valor entre unidades de medida: metros a pies, kilos a libras, grados Celsius a Fahrenheit, tazas a mililitros, gigabytes a gibibytes. Pensada para resolver la duda en el momento, desde el celular, sin leer instrucciones.

Funciona así:

1. **Elegir la magnitud** (longitud, masa, temperatura, cocina…).
2. **Escribir un valor** y elegir la unidad de origen y la de destino.
3. **Leer el resultado**, que aparece al instante y se puede copiar con un toque. Un botón intercambia las unidades.

**No usa servidor ni cuentas.** Lo único que se recuerda en el equipo es la última conversión, para seguir donde se iba.

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Stack | HTML, CSS, JS vanilla, Three.js, Font Awesome. Todo por CDN según CLAUDE.md 2.3. Sin Lottie |
| Datos | Ninguno en servidor. Solo la última conversión en `localStorage` |
| Pantalla | Un valor y dos unidades, con resultado al instante e intercambio de unidades |
| Magnitudes | Longitud, masa, volumen, temperatura, área, tiempo, cocina, velocidad, datos, energía y presión |
| Cocina | Dos partes: unidades de volumen de cocina (taza, cucharada…) y conversión volumen a gramos por ingrediente, con densidades aproximadas |
| Datos | Unidades decimales (KB, MB, GB, TB, base 1000) y binarias (KiB, MiB, GiB, TiB, base 1024) en la misma lista, con su nombre claro |
| Cálculo | Cada unidad se define por su factor respecto a una unidad base; la temperatura, que no es proporcional, con fórmulas propias |
| Números | Hasta 6 cifras significativas, sin ceros sobrantes, separadores en español. La coma y el punto valen como decimal al escribir |
| Estética | Propia, limpia y sobria, como el generador de contraseñas pero con acento azul para distinguirlos. Animación 3D sutil de fondo |
| Idioma | Interfaz en español. Nombres de unidades en español con su símbolo |

---

## 3. Pantalla

Todo vive en un solo `index.html`, en una sola pantalla. De arriba abajo:

### 3.1 Magnitud
- Pestañas desplazables en horizontal con icono y nombre: **Longitud**, **Masa**, **Volumen**, **Temperatura**, **Área**, **Tiempo**, **Cocina**, **Velocidad**, **Datos**, **Energía**, **Presión**. En celular se ven las primeras y se deslizan las demás; la activa queda siempre visible.
- Al cambiar de magnitud se cargan sus unidades, con el par más común preseleccionado (por ejemplo, metros a pies) o el último par usado en esa magnitud.

### 3.2 Conversión
- **Valor:** campo numérico grande. Acepta coma o punto como decimal y números negativos (solo tienen sentido en temperatura; en el resto se avisa).
- **De** y **A:** dos listas desplegables con las unidades de la magnitud, nombre completo y símbolo ("Kilómetro (km)").
- **Botón intercambiar** (icono de flechas) entre las dos listas: cambia las unidades y recalcula.
- **Resultado:** número grande con su símbolo, y debajo la frase completa en texto pequeño: "12,5 kilómetros equivalen a 7,77 millas" ("equivale a" cuando el valor escrito es 1). Botón **Copiar** que copia solo el número y durante dos segundos dice "Copiado".
- **Fórmula:** línea discreta con la relación usada: "1 km = 0,621371 mi". En temperatura muestra la fórmula ("°F = °C × 9/5 + 32").
- Todo recalcula al instante con cada tecla o cambio de lista. Sin botón "Convertir".

### 3.3 Cocina por ingrediente
Dentro de la magnitud **Cocina** hay una lista adicional, **Ingrediente**, con la opción "Solo volumen" al inicio. Al elegir un ingrediente (harina, azúcar, mantequilla, agua, aceite, leche, miel, arroz, sal, cacao), las listas De y A incluyen también el gramo, y la conversión entre volumen y peso usa la densidad del ingrediente. Se avisa que son valores aproximados.

### 3.4 Comportamiento
- Al abrir la página aparece la última conversión usada o, la primera vez, 1 metro a pies.
- Lo que se recuerda va en `localStorage` con la clave `measurement_calculator_last`, en `try/catch`: magnitud, unidad de origen, de destino, valor e ingrediente. Si el almacenamiento falla, la página funciona igual.
- Un valor vacío deja el resultado vacío, sin error. Un texto que no es número muestra "Escribe un número".
- Teclado: Tab recorre pestañas, valor, listas, intercambiar y copiar; en las pestañas, las flechas izquierda y derecha cambian de magnitud (al llegar a un extremo se pasa al otro) e Inicio y Fin van a la primera y a la última. Foco siempre visible.
- Sin `console.log` ni errores en consola.

---

## 4. Unidades y cálculo

### 4.1 Cómo se calcula
Cada magnitud tiene una **unidad base** y cada unidad un **factor**: cuántas unidades base vale una de ellas. Convertir es `valor × factor_origen ÷ factor_destino`. Los factores viven en `js/units.js`, en una sola tabla, para que agregar una unidad sea agregar una línea.

La **temperatura** no es proporcional (0 °C no es 0 °F), así que sus unidades llevan dos funciones, a Kelvin y desde Kelvin, en lugar de un factor.

### 4.2 Unidades por magnitud

| Magnitud | Base | Unidades |
|---|---|---|
| Longitud | metro | milímetro, centímetro, metro, kilómetro, pulgada, pie, yarda, milla, milla náutica |
| Masa | kilogramo | miligramo, gramo, kilogramo, tonelada, onza, libra, stone |
| Volumen | litro | mililitro, litro, metro cúbico, onza líquida (EE. UU.), pinta, cuarto, galón (EE. UU.), galón imperial |
| Temperatura | kelvin | Celsius, Fahrenheit, Kelvin |
| Área | metro cuadrado | cm², m², hectárea, km², pulgada², pie², acre, milla² |
| Tiempo | segundo | milisegundo, segundo, minuto, hora, día, semana, mes (30 días), año (365 días) |
| Cocina | mililitro | cucharadita (5 ml), cucharada (15 ml), taza (240 ml), onza líquida, mililitro, litro; y gramo cuando hay ingrediente |
| Velocidad | metro por segundo | m/s, km/h, mph, nudo, pie por segundo |
| Datos | byte | bit, byte, KB, MB, GB, TB (×1000), KiB, MiB, GiB, TiB (×1024) |
| Energía | julio | julio, kilojulio, caloría, kilocaloría, vatio hora, kilovatio hora, BTU |
| Presión | pascal | pascal, kilopascal, bar, milibar, psi, atmósfera, mmHg |

### 4.3 Densidades para cocina (gramos por mililitro, aproximadas)

| Ingrediente | g/ml |
|---|---|
| Agua | 1,00 |
| Leche | 1,03 |
| Aceite | 0,92 |
| Mantequilla | 0,96 |
| Miel | 1,42 |
| Harina de trigo | 0,53 |
| Azúcar | 0,85 |
| Arroz crudo | 0,80 |
| Sal fina | 1,20 |
| Cacao en polvo | 0,50 |

Son promedios de referencia: la harina tamizada pesa menos y la compacta más. La pantalla lo advierte.

### 4.4 Cómo se muestran los números
- Hasta 6 cifras significativas y sin ceros al final: 0,621371, 12,5, 1609,34.
- Siempre con el formato español (`toLocaleString("es")`), sin depender del idioma del navegador: punto para los miles y coma decimal. Como manda la ortografía española, los números de 4 cifras no llevan separador (1234,5) y desde 5 sí (12.345,6).
- Al escribir se aceptan coma o punto como decimal. Si aparecen los dos, el último es el decimal (`1.234,5` y `1,234.5` valen lo mismo); si un mismo signo se repite, separa miles (`1.234.567`). También se entiende `1e3`.
- Un signo o un punto solos son un número a medio escribir y no dan error. Un valor negativo fuera de la temperatura, o por debajo del cero absoluto, muestra un aviso y deja el resultado vacío.
- Números muy grandes o muy pequeños (más de 15 cifras o menos de 0,000001) en notación con exponente, para que no se corten.
- Al copiar se copia el número tal como se ve.

---

## 5. Diseño visual y animación

- Fondo oscuro neutro con un acento azul para el botón de copiar, la pestaña activa y el resultado. Buen contraste de texto en todo (WCAG AA, 4,5 a 1 en textos).
- Tarjeta central de hasta 520 px de ancho, a todo el ancho en celular.
- **Animación 3D (Three.js):** diales de medición (anillos con marcas finas, como el borde de una regla o un transportador) que giran y suben despacio detrás de la tarjeta, con 4 en pantallas pequeñas y 7 en las grandes. Al cambiar el resultado hacen un leve destello: se iluminan, giran más rápido un instante y vuelven a su ritmo. No destellan si el resultado es el mismo ni si queda vacío. El suavizado de bordes solo se activa en pantallas de densidad normal. Decorativa: la página funciona igual si no carga. Three.js se importa con `import()` dentro de `animations.js`, como en el generador de contraseñas, para que su caída no rompe nada.
- Según CLAUDE.md 2.10: `requestAnimationFrame`, tope de 30 cuadros por segundo, `pixelRatio` máximo 2, se ajusta al cambiar el tamaño, se pausa con la pestaña oculta y con `prefers-reduced-motion` se queda quieta.

---

## 6. Fases de desarrollo

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Estructura de carpetas, `index.html` con la pantalla completa, `css/styles.css` responsive y README | Hecha |
| 2 | Tabla de unidades (`js/units.js`), conversión, formato de números, cocina por ingrediente, copiar y última conversión recordada (`js/main.js`) | Hecha |
| 3 | Animación 3D de fondo (`js/animations.js`) | Hecha |
| 4 | Cierre: checklist de CLAUDE.md 2.11, tarjeta en el portal, prueba en celular y en GitHub Pages | Revisión técnica hecha; faltan las pruebas en celular y en GitHub Pages (sección 10) |

---

## 7. Estructura de archivos del proyecto

```
measurement_calculator/
├── index.html
├── README.md
├── PLAN.md                  # Este documento
├── css/
│   └── styles.css
└── js/
    ├── main.js              # Pantalla, conversión, formato y memoria
    ├── units.js             # Tabla de magnitudes, unidades, factores y densidades
    └── animations.js        # Diales 3D de fondo
```

`units.js` es un archivo de datos importado desde `main.js`, como permite CLAUDE.md 2.5. Sin carpeta `assets/`: no hay imágenes, iconos propios ni Lottie.

---

## 8. Ejecución local

Desde esta carpeta, `python ../dev_server.py` y abrir http://localhost:8080 (ver CLAUDE.md 2.8).

---

## 9. Riesgos y cómo se manejan

| Riesgo | Manejo |
|---|---|
| Un factor mal escrito da resultados equivocados | Cada factor se toma de la definición oficial de la unidad y se anota. La fase 2 incluye una prueba automática de ida y vuelta: convertir y volver debe dar el valor original |
| Errores de redondeo en decimales (0,1 + 0,2) | Se calcula en doble precisión y se redondea solo al mostrar, a 6 cifras significativas |
| Las densidades de cocina no son exactas | Se avisa en pantalla y se marcan como aproximadas |
| Confusión entre GB y GiB | Las dos aparecen con su nombre completo: "Gigabyte (GB, ×1000)" y "Gibibyte (GiB, ×1024)" |
| El portapapeles no funciona (http sin https) | Se selecciona el resultado y se avisa para copiar a mano. En GitHub Pages hay https |
| El 3D pesa en un equipo lento | Pocas formas, tope de cuadros, y la página funciona sin 3D |

---

## 10. Cierre: checklist de CLAUDE.md 2.11

Revisión técnica hecha con la aplicación corriendo, también servida desde el portal en una subcarpeta, como quedará en GitHub Pages.

| Punto | Estado |
|---|---|
| Estructura como en 2.5 | Cumple. Sin `config.js` (no usa Supabase) y sin `assets/` (no hay imágenes, iconos propios ni Lottie), como permite 2.5. Además de `main.js` y `animations.js` lleva `units.js` (la tabla de unidades), que 2.5 permite al dividir la lógica, y este `PLAN.md` |
| `README.md` con título, descripción y ejecución local | Cumple, con el comando `python ../dev_server.py` |
| 360 px hasta escritorio | Cumple: sin desplazamiento horizontal desde 320 hasta 1920 px. La pantalla normal no necesita desplazamiento vertical desde 360×740 hasta escritorio. Cocina con ingrediente, la más alta, cabe sin desplazamiento en tablet y escritorio, y en un celular de 360×740 sobran 71 px. En uno de 320×568 sobran 110 px |
| Teclado y foco visible | Cumple: Tab recorre enlace de salto, la pestaña activa, ingrediente (en Cocina), valor, De, intercambiar, A y Copiar. Las flechas, Inicio y Fin cambian de pestaña. Todos los controles tienen contorno naranja de 3 px y nombre accesible. Pestañas con `role="tablist"`, `tab` y `tabpanel` |
| Sin errores en la consola | Cumple: sin errores ni promesas rechazadas, tampoco con Three.js caído ni con el almacenamiento bloqueado |
| Rutas relativas con `./` | Cumple. Ninguna ruta absoluta; probado servido desde `/measurement_calculator/` |
| Librerías por CDN y versiones de 2.3 | Cumple: Font Awesome 6.7.2 y Three.js 0.170.0. No se carga Lottie porque no se usa. Three.js se importa con `import()` dentro de `animations.js` para que su caída no rompa la calculadora |
| `prefers-reduced-motion` y pausa con pestaña oculta | Cumple: con movimiento reducido queda una imagen quieta y sin bucle; al ocultar la pestaña el bucle se cancela |
| `localStorage` con prefijo y `try/catch` | Cumple: una sola clave, `measurement_calculator_last`, con lectura y escritura dentro de `try/catch` y valores dañados descartados |
| Código en inglés, comentarios en español, snake_case | Cumple. Sin `console.*`, TODO, `eval` ni `innerHTML`. Sin clases, ids ni exports sin uso |
| Agregado al portal | Cumple: tarjeta en el `index.html` de la raíz y fila actualizada en la tabla 2.12 de CLAUDE.md |
| Una persona sin contexto lo entiende | Una sola pantalla: elegir magnitud, escribir el valor y leer el resultado, que aparece al instante, con la frase completa y la fórmula |

Además:
- **Exactitud:** 45 valores de referencia (longitud, masa, volumen, temperatura, área, tiempo, cocina, velocidad, datos, energía y presión) coinciden con su definición, y 5400 conversiones de ida y vuelta devuelven el valor original.
- **Contraste de colores (WCAG AA):** todos los textos superan 4,5 a 1 (el más bajo, el texto atenuado, da 7,3). El foco y los bordes de campos y botones superan 3 a 1.
- **Sin secretos ni datos personales:** el proyecto no usa claves, servidores ni cuentas.

### Pruebas que solo se pueden hacer a mano
1. En **uno o dos celulares** (uno con iPhone si es posible): convertir en varias magnitudes, tocar **Copiar resultado** y pegar en otra aplicación. Mirar que las listas desplegables se vean bien y que el fondo se vea fluido.
2. En **GitHub Pages**, tras publicar: abrir `https://<usuario>.github.io/projects/measurement_calculator/` y comprobar que carga sin errores, con iconos y fondo, y que Copiar funciona (el portapapeles solo funciona con https).
3. Activar "reducir movimiento" en el sistema y comprobar que el fondo queda quieto.
4. Comparar unas cuantas conversiones que uses a diario (por ejemplo, tu receta favorita en tazas y gramos) con lo que ya conoces, y ajustar las densidades de la tabla 4.3 si alguna se aleja de tus ingredientes.

### Actualización posterior: favicon y copyright

Se agregó el favicon de la marca (`assets/icons/favicon.ico`, enlazado en el `<head>`) y el pie de copyright con el texto de CLAUDE.md 2.16. El pie suma unos 30 px de alto (el doble de línea en pantallas muy angostas, donde el texto se parte en dos), así que los píxeles de desplazamiento medidos antes en este documento aumentan en esa medida. En 1366×768 sigue sin necesitar desplazamiento vertical.

