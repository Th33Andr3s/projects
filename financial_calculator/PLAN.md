# Plan de trabajo: Calculadora financiera (`financial_calculator`)

Documento de planificación del proyecto. Se rige por las reglas de [CLAUDE.md](../CLAUDE.md). Cada fase termina con una revisión en el navegador y la aprobación de la persona dueña antes de pasar a la siguiente.

---

## 1. Qué es este proyecto

Una página para resolver las cuentas de dinero de todos los días: cuánto se paga al mes por un préstamo y cuánto se va en intereses, cuánto rinde un capital a interés simple o compuesto, cuánto se junta ahorrando una cuota mensual, y cómo pasar una tasa de efectiva anual a nominal o mensual. Pensada para usarse desde el celular, con las tasas como se publican en Colombia, sin leer instrucciones.

Funciona así:

1. **Elegir el cálculo** en una pestaña: **Préstamo**, **Interés**, **Ahorro** o **Tasas**.
2. **Escribir los datos** (monto, tasa, plazo…). El resultado aparece al instante.
3. **Leer el resultado** grande, con el detalle debajo: la tabla de amortización, la comparación de intereses, el gráfico del ahorro o las tasas equivalentes.

**No usa servidor ni cuentas.** Lo único que se recuerda en el equipo son los últimos valores escritos, para seguir donde se iba. Es una herramienta de cálculo, no asesoría: la cuota real de un banco puede incluir seguros y comisiones que aquí no entran.

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Stack | HTML, CSS, JS vanilla, Three.js, Font Awesome, SVG inline para el gráfico. Todo por CDN según CLAUDE.md 2.3. Sin Lottie |
| Datos | Ninguno en servidor. Los últimos valores de cada pestaña en `localStorage` |
| Cálculos | Cuota de préstamo con tabla de amortización, interés simple y compuesto, ahorro con aporte mensual, y conversión de tasas |
| Tasas | Se escriben como **efectiva anual (E.A.)**, como se publican en Colombia. La app las convierte por dentro a la tasa del periodo. En la pestaña Tasas se puede partir de cualquiera |
| Moneda | Pesos colombianos: `$ 1.250.000`, sin decimales. Los centavos solo se usan por dentro |
| Cuotas | Fijas (sistema francés), vencidas, un pago por mes. Es lo que usan los créditos de consumo y la mayoría de hipotecas |
| Plazos | En meses, hasta 480 (40 años). Un atajo muestra el equivalente en años |
| Redondeo | Se calcula con decimales y se redondea solo al mostrar. En la tabla, el último abono se ajusta para que el saldo final sea exactamente cero |
| Estética | Propia, limpia y sobria, como las otras calculadoras, con acento verde. Animación 3D sutil de fondo |
| Idioma | Interfaz en español |

---

## 3. Pantalla

Todo vive en un solo `index.html`, en una sola pantalla con cuatro pestañas. Cada pestaña tiene su formulario arriba y su resultado abajo; todo recalcula al instante con cada tecla.

### 3.1 Préstamo
- **Datos:** monto, y a su lado tasa E.A. (%) y plazo en meses (la tasa y el plazo van lado a lado en cualquier pantalla, incluso en 320 px). Debajo, el equivalente en años ("36 meses = 3 años").
- **Resultado:** la **cuota mensual** en grande. Debajo: total pagado, total de intereses y qué parte del total son intereses (en %).
- **Tabla de amortización** plegada ("Ver tabla mes a mes"): mes, cuota, interés, abono a capital y saldo. Hasta 480 filas. Botón **Copiar tabla** que la copia con tabulaciones, lista para pegar en una hoja de cálculo.
- Si la tasa es 0, la cuota es monto ÷ plazo.
- La tabla se dibuja solo al abrirla y se mantiene al día con los datos. Cada fila se redondea al mostrarla, así que al sumar a mano la columna de abonos puede salir 1 o 2 pesos de diferencia; el saldo final siempre es $ 0.
- Copiar cuota copia el número solo ("910464"). Copiar tabla copia columnas separadas por tabulaciones, con cifras sin símbolo, lista para pegar en una hoja de cálculo.

### 3.2 Interés
- **Datos:** capital, tasa E.A. (%) y tiempo en meses.
- **Resultado:** dos columnas lado a lado, **Simple** y **Compuesto**, cada una con los intereses ganados y el monto final. Debajo, la diferencia entre los dos y una frase que la explica, que cambia según el caso: "El compuesto gana $ 120.000 más porque los intereses también generan intereses"; a un año exacto, que dan lo mismo; con menos de un año, que el simple gana más (el compuesto solo supera al simple a partir del primer año); y con tasa 0, que no se generan intereses.

### 3.3 Ahorro
- **Datos:** aporte inicial (puede ser 0), aporte mensual, tasa E.A. (%) y años.
- **Resultado:** lo **acumulado al final** en grande. Debajo: total aportado y total de intereses ganados.
- **Gráfico** del crecimiento año a año, en SVG dibujado por la app: una curva para lo aportado y otra para el acumulado, con un globo con los datos del año al pasar el mouse, tocar o enfocar un punto con el teclado (Escape lo cierra). Hay un punto por año o, si son muchos años, unos diez repartidos por igual, para que las etiquetas no se amontonen. Sin librerías de gráficos. El aporte inicial y el mensual no pueden ser ambos 0.

### 3.4 Tasas
- **Datos:** una tasa (%), de qué tipo es (efectiva anual, nominal anual o efectiva del periodo) y la capitalización (mensual, bimestral, trimestral o semestral; mensual por defecto).
- **Resultado:** las tres tasas equivalentes en una lista: efectiva anual, nominal anual y efectiva del periodo, cada una con su nombre completo y la fórmula usada. La que se escribió aparece marcada.
- Solo tasas vencidas, que son las de la publicidad bancaria. Las anticipadas no entran.
- La tasa nominal se nombra como en la banca colombiana según la capitalización: "mes vencido", "bimestre vencido", "trimestre vencido" o "semestre vencido". Las fórmulas que se muestran cambian con la capitalización y con el tipo de tasa escrita.

### 3.5 Comportamiento común
- Los campos de dinero aceptan puntos y comas al escribir ("1.250.000", "1250000" o "1,250,000") y se ordenan con puntos al salir del campo. Un solo punto o coma seguido de exactamente tres cifras es separador de miles ("1.250"); seguido de otra cantidad es decimal ("1250,5"), y los centavos se descartan al salir del campo. Las tasas aceptan coma o punto decimal.
- Un campo vacío deja el resultado vacío, sin error. Un texto que no es número, un valor negativo o un plazo de 0 muestran un aviso corto bajo el campo.
- Límites: monto hasta 999.999.999.999, tasa de 0 a 500 %, plazo de 1 a 480 meses, años de 1 a 60.
- Lo que se recuerda va en `localStorage` con la clave `financial_calculator_last`, en `try/catch`: la pestaña activa y los valores de cada pestaña. Si el almacenamiento falla, la página funciona igual.
- Teclado: Tab recorre pestañas, campos, botones y los puntos del gráfico; en las pestañas, las flechas, Inicio y Fin cambian de cálculo. Foco siempre visible.
- Cada pestaña lleva su botón **Copiar**: copia el resultado principal como número sin formato (en Interés, uno por columna; en Tasas, uno por tasa, con el número como se ve y sin el %). Si el navegador no deja copiar, deja el número seleccionado.
- Sin `console.log` ni errores en consola.

---

## 4. Fórmulas

Todo el cálculo vive en `js/finance.js`, funciones puras sin tocar la pantalla, para poder probarlas con valores conocidos. Las tasas se manejan como fracción (18 % es 0,18).

### 4.1 De efectiva anual a la tasa del periodo
Con `m` periodos por año (12 para meses): `i = (1 + EA)^(1/m) − 1`. Nominal anual: `NA = i × m`. Al revés: `EA = (1 + NA/m)^m − 1`.

### 4.2 Cuota fija (sistema francés)
Con monto `P`, tasa mensual `i` y `n` meses: `A = P × i / (1 − (1 + i)^−n)`. Si `i = 0`, `A = P / n`.

Tabla: cada mes, `interés = saldo × i`, `abono = A − interés`, `saldo = saldo − abono`. Total pagado `= A × n`; total de intereses `= A × n − P`.

### 4.3 Interés simple y compuesto
Con capital `P`, tasa E.A. `r` y `t` años (`meses / 12`):
- Simple: `I = P × r × t`, monto final `P + I`.
- Compuesto: monto final `M = P × (1 + r)^t`, intereses `M − P`.

### 4.4 Ahorro con aporte mensual
Con aporte inicial `P0`, aporte mensual `C` al final de cada mes, tasa mensual `i` y `n` meses:
`FV = P0 × (1 + i)^n + C × ((1 + i)^n − 1) / i`. Si `i = 0`, `FV = P0 + C × n`. Aportado `= P0 + C × n`; intereses `= FV − aportado`. Para el gráfico se evalúa en cada año (`n = 12, 24, …`).

### 4.5 Valores de comprobación
La fase 2 corrió una prueba automática con estos casos, calculados aparte. Se ejecuta en el navegador importando `finance.js`, y no se guarda como archivo porque CLAUDE.md 2.5 no prevé archivos de pruebas en el proyecto. Además de estos valores se comprobaron 210 combinaciones de préstamo (los abonos suman el monto, el saldo nunca sube, la tabla cierra en cero), el ahorro contra una simulación mes a mes y la ida y vuelta de todas las tasas:
- Préstamo de $ 10.000.000 al 18 % E.A. a 12 meses: tasa mensual 1,3888 %, cuota $ 910.464, total pagado $ 10.925.565 e intereses $ 925.565 (8,5 % del total), y la tabla cierra en saldo 0.
- Préstamo al 0 % de $ 1.200.000 a 12 meses: cuota $ 100.000 exactos.
- $ 1.000.000 al 10 % E.A. durante 24 meses: simple $ 200.000 de interés; compuesto $ 210.000.
- Tasa 18 % E.A. con capitalización mensual: nominal 16,67 % N.A.M.V. y mensual 1,389 %.
- Ahorro de $ 0 inicial más $ 100.000 al mes al 0 % durante 1 año: $ 1.200.000 exactos.

---

## 5. Cómo se muestran los números
- Dinero: `$ 1.250.000`, con punto de miles y sin decimales, siempre en formato español (`toLocaleString("es-CO")`).
- Porcentajes: hasta 2 decimales en los resultados ("16,67 %") y hasta 4 en la tasa del periodo ("1,3888 %"), con coma decimal.
- Al copiar se copia solo el número, sin símbolo ni separadores ("909661"), para pegarlo en cualquier parte.

---

## 6. Diseño visual y animación

- Fondo oscuro neutro con un acento verde para la pestaña activa, el resultado y el botón de copiar. Buen contraste en todo (WCAG AA, 4,5 a 1 en textos).
- Tarjeta central de hasta 560 px de ancho, a todo el ancho en celular. La tabla de amortización se desplaza en horizontal si no cabe, sin estirar la página.
- **Animación 3D (Three.js):** barras finas y translúcidas, agrupadas como pequeños gráficos de crecimiento (cada grupo sube en escalera, con 5 o 6 barras), que ascienden despacio detrás de la tarjeta y "respiran" un poco. Hay 3 grupos en pantallas pequeñas y 6 en las grandes. Cuando cambia el resultado de la pestaña que se está usando hacen un leve destello: crecen un 40 % un instante, se iluminan y vuelven a su altura. No destellan si el resultado es el mismo ni si queda vacío. En celular se achican en proporción y quedan al fondo, casi tapadas por la tarjeta. Decorativa: la página funciona igual si no carga. Three.js se importa con `import()` dentro de `animations.js`, como en las otras calculadoras.
- Según CLAUDE.md 2.10: `requestAnimationFrame`, tope de 30 cuadros por segundo, `pixelRatio` máximo 2, se ajusta al cambiar el tamaño, se pausa con la pestaña oculta y con `prefers-reduced-motion` se queda quieta.

---

## 7. Fases de desarrollo

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Estructura de carpetas, `index.html` con las cuatro pestañas completas, `css/styles.css` responsive y README | Hecha |
| 2 | Fórmulas (`js/finance.js`) con su prueba de valores conocidos, y la pestaña Préstamo con tabla de amortización (`js/main.js`) | Hecha |
| 3 | Pestañas Interés, Ahorro con gráfico SVG y Tasas; copiar y valores recordados | Hecha |
| 4 | Animación 3D de fondo (`js/animations.js`) | Hecha |
| 5 | Cierre: checklist de CLAUDE.md 2.11, tarjeta en el portal, prueba en celular y en GitHub Pages | Revisión técnica hecha; faltan las pruebas en celular y en GitHub Pages (sección 11) |

---

## 8. Estructura de archivos del proyecto

```
financial_calculator/
├── index.html
├── README.md
├── PLAN.md                  # Este documento
├── css/
│   └── styles.css
└── js/
    ├── main.js              # Pantalla, formato de números, gráfico y memoria
    ├── finance.js           # Fórmulas: tasas, cuota, amortización, interés y ahorro
    └── animations.js        # Barras 3D de fondo
```

`finance.js` es un archivo de lógica importado desde `main.js`, como permite CLAUDE.md 2.5. Sin carpeta `assets/`: no hay imágenes, iconos propios ni Lottie.

---

## 9. Ejecución local

Desde esta carpeta, `python ../dev_server.py` y abrir http://localhost:8080 (ver CLAUDE.md 2.8).

---

## 10. Riesgos y cómo se manejan

| Riesgo | Manejo |
|---|---|
| Una fórmula mal escrita da cuotas equivocadas | Cada fórmula se toma de su definición y se comprueba con los valores de 4.5 en una prueba automática |
| Confundir tasa nominal con efectiva | Toda tasa que se escribe es E.A. y así se etiqueta. La pestaña Tasas muestra las equivalencias con nombre completo |
| Errores de redondeo que descuadran la tabla | Se calcula con decimales; el último abono se ajusta y el saldo final queda en cero exacto |
| Creer que la cuota es la del banco | Aviso fijo bajo el resultado: no incluye seguros, comisiones ni cambios de tasa |
| Una tabla de 480 filas pesa en celular | Va plegada y solo se dibuja al abrirla |
| El portapapeles no funciona (http sin https) | Se selecciona el número y se avisa para copiar a mano. En GitHub Pages hay https |
| El 3D pesa en un equipo lento | Pocas barras, tope de cuadros, y la página funciona sin 3D |

---

## 11. Cierre: checklist de CLAUDE.md 2.11

Revisión técnica hecha con la aplicación corriendo, también servida desde el portal en una subcarpeta, como quedará en GitHub Pages.

| Punto | Estado |
|---|---|
| Estructura como en 2.5 | Cumple. Sin `config.js` (no usa Supabase) y sin `assets/` (no hay imágenes, iconos propios ni Lottie), como permite 2.5. Además de `main.js` y `animations.js` lleva `finance.js` (las fórmulas), que 2.5 permite al dividir la lógica, y este `PLAN.md` |
| `README.md` con título, descripción y ejecución local | Cumple, con el comando `python ../dev_server.py` |
| 360 px hasta escritorio | Cumple: sin desplazamiento horizontal en ninguna pestaña desde 320 hasta 1920 px. Préstamo, Interés y Tasas no necesitan desplazamiento vertical desde 390×844 hasta escritorio; en un celular de 360×740 sobran entre 55 y 62 px. Ahorro, por el gráfico, necesita desplazarse (94 px en 390×844 y 253 en 1366×768) |
| Teclado y foco visible | Cumple: Tab recorre enlace de salto, pestaña activa, campos, copiar y la tabla plegada; las flechas, Inicio y Fin cambian de pestaña; los puntos del gráfico se recorren con Tab y Escape cierra el globo. Todos los controles tienen contorno naranja de 3 px (en los campos con símbolo rodea el campo completo) y nombre accesible. Pestañas con `role="tablist"`, `tab` y `tabpanel`; tabla con encabezados y título; gráfico con descripción y cada punto con su dato |
| Sin errores en la consola | Cumple: sin errores ni promesas rechazadas, tampoco con Three.js caído, con el almacenamiento bloqueado ni con datos guardados dañados |
| Rutas relativas con `./` | Cumple. Ninguna ruta absoluta; probado servido desde `/financial_calculator/` |
| Librerías por CDN y versiones de 2.3 | Cumple: Font Awesome 6.7.2 y Three.js 0.170.0. No se carga Lottie porque no se usa. Three.js se importa con `import()` dentro de `animations.js` para que su caída no rompa la calculadora |
| `prefers-reduced-motion` y pausa con pestaña oculta | Cumple: con movimiento reducido queda una imagen quieta y sin bucle; al ocultar la pestaña el bucle se cancela. Tope de 30 fps y `pixelRatio` máximo 2 comprobados |
| `localStorage` con prefijo y `try/catch` | Cumple: una sola clave, `financial_calculator_last`, con lectura y escritura dentro de `try/catch`, y valores dañados descartados campo por campo |
| Código en inglés, comentarios en español, snake_case | Cumple. Sin `console.*`, TODO, `eval` ni `innerHTML`. Sin clases ni funciones sin uso; dos funciones de `finance.js` que solo usa el propio archivo ya no se exportan |
| Agregado al portal | Cumple: tarjeta en el `index.html` de la raíz y fila actualizada en la tabla 2.12 de CLAUDE.md |
| Una persona sin contexto lo entiende | Cuatro pestañas con nombre e icono; cada una con sus campos arriba y el resultado grande debajo, que aparece al instante, con avisos cortos si un valor no sirve |

Además:
- **Exactitud:** las fórmulas coinciden con los valores del PLAN (cuota $ 910.464 para $ 10.000.000 al 18 % E.A. a 12 meses, ahorro $ 17.830.596, tasas, interés simple y compuesto), con 210 combinaciones de préstamo que cumplen sus invariantes y con cálculos hechos a mano o simulados mes a mes.
- **Contraste de colores (WCAG AA):** todos los textos superan 4,5 a 1 (el más bajo, el texto atenuado, da 7,3). El foco, los bordes de campos y botones y las curvas del gráfico superan 3 a 1.
- **Gráfico:** las etiquetas del eje no se pisan en ninguno de los 60 posibles valores de años, ni a 320 px de ancho.
- **Sin secretos ni datos personales:** el proyecto no usa claves, servidores ni cuentas. Lo único que guarda en el equipo son los últimos valores escritos.

### Pruebas que solo se pueden hacer a mano
1. En **uno o dos celulares** (uno con iPhone si es posible): recorrer las cuatro pestañas, escribir montos con puntos y con comas, tocar **Copiar** y pegar en otra aplicación, tocar los puntos del gráfico y abrir la tabla mes a mes. Mirar que el fondo se vea fluido.
2. En **GitHub Pages**, tras publicar: abrir `https://<usuario>.github.io/projects/financial_calculator/` y comprobar que carga sin errores, con iconos y fondo, y que Copiar funciona (el portapapeles solo funciona con https).
3. Activar "reducir movimiento" en el sistema y comprobar que el fondo queda quieto.
4. **Comparar con tu banco:** calcular un crédito real tuyo y comparar la cuota. Debe coincidir salvo seguros y comisiones; si la diferencia es mayor, suele deberse a que el banco publica la tasa nominal o a que cobra cuota de manejo.
