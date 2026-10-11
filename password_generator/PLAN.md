# Plan de trabajo: Generador de contraseñas (`password_generator`)

Documento de planificación del proyecto. Se rige por las reglas de [CLAUDE.md](../CLAUDE.md). Cada fase termina con una revisión en el navegador y la aprobación de la persona dueña antes de pasar a la siguiente.

---

## 1. Qué es este proyecto

Una página que genera contraseñas seguras al azar, con la longitud y los tipos de caracteres que la persona elija, y las copia al portapapeles con un toque. Pensada para usarse desde el celular en el momento en que una aplicación pide una contraseña nueva.

Funciona así:

1. **Elegir.** Longitud y tipos de caracteres (mayúsculas, minúsculas, números, símbolos). Las opciones se recuerdan en el equipo para la próxima vez.
2. **Generar.** La contraseña aparece en pantalla, con un indicador de qué tan fuerte es.
3. **Copiar.** Un botón la copia al portapapeles y confirma que se copió.

**No guarda contraseñas.** Ni en el equipo ni en ningún servidor. Lo único que se recuerda son las opciones elegidas. Al cerrar la pestaña, la contraseña desaparece.

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Stack | HTML, CSS, JS vanilla, Three.js, Font Awesome. Todo por CDN según CLAUDE.md 2.3. Sin Lottie: no hay animación vectorial que lo justifique |
| Datos | Ninguno en servidor. Solo las opciones elegidas en `localStorage` |
| Historial | No se guarda ninguna contraseña generada |
| Azar | `crypto.getRandomValues`, nunca `Math.random`, que es predecible |
| Tipos | Solo contraseñas de caracteres sueltos. Sin frases de palabras ni PIN |
| Fortaleza | Se calcula la entropía en bits a partir de la longitud y el tamaño del alfabeto, y se muestra en cuatro niveles |
| Estética | Propia, limpia y sobria: fondo oscuro neutro con un acento de color. Animación 3D sutil de fondo que no distrae |
| Idioma | Interfaz en español |

---

## 3. Pantalla

Todo vive en un solo `index.html`, en una sola pantalla. De arriba abajo:

### 3.1 Resultado
- La contraseña generada, en letra monoespaciada grande, con los números y símbolos en colores distintos para leerla sin confundirse.
- Botón **Copiar** que copia al portapapeles y durante dos segundos dice "Copiada". Si el navegador no permite copiar, se selecciona el texto para copiarlo a mano y se avisa.
- Botón **Generar otra** (icono de refrescar).
- Barra de fortaleza con cuatro niveles: **Débil**, **Aceptable**, **Fuerte** y **Muy fuerte**, con color y texto, y los bits de entropía a su lado.

### 3.2 Opciones
- **Longitud:** control deslizante de 8 a 64, con el número visible y editable en un campo. Valor inicial 16.
- **Mayúsculas** (A-Z), **Minúsculas** (a-z), **Números** (0-9) y **Símbolos** (`!@#$%^&*()-_=+[]{};:,.<>?`): casillas, todas activas al inicio.
- **Evitar caracteres confusos:** quita `0 O o 1 l I |`. Activa al inicio.
- Si la persona desactiva todas las casillas, la última no se deja desactivar y se explica por qué.
- Cualquier cambio en las opciones genera una contraseña nueva al instante.

### 3.3 Comportamiento
- Al abrir la página ya hay una contraseña generada con las opciones recordadas (o las iniciales).
- Las opciones se guardan en `localStorage` con la clave `password_generator_options`, en `try/catch`. Si el almacenamiento falla, la página funciona igual con las opciones iniciales.
- Teclado: Tab recorre resultado, botones y opciones; Enter o Espacio activan; las flechas mueven el deslizante. Foco siempre visible.
- Sin `console.log` ni errores en consola.

---

## 4. Cómo se genera la contraseña

1. Se arma el **alfabeto** con los tipos activos; si "evitar confusos" está activo, se quitan esos caracteres.
2. Se eligen caracteres al azar con `crypto.getRandomValues`, usando **rechazo** para no sesgar el resultado: si el número aleatorio cae fuera del múltiplo más grande del tamaño del alfabeto, se descarta y se pide otro. Así cada carácter tiene exactamente la misma probabilidad.
3. Se garantiza **al menos un carácter de cada tipo activo**: se genera un carácter de cada tipo, se completa la longitud con el alfabeto entero y se baraja todo con el mismo generador seguro (barajado de Fisher-Yates).
4. La **entropía** se calcula como `longitud × log2(tamaño del alfabeto)` y se redondea. Niveles: menos de 40 bits, débil; de 40 a 59, aceptable; de 60 a 89, fuerte; 90 o más, muy fuerte.

---

## 5. Diseño visual y animación

- Fondo oscuro neutro (gris azulado) con un acento verde azulado para el botón principal y la barra de fortaleza. Buen contraste de texto en todo.
- Tarjeta central de hasta 480 px de ancho, a todo el ancho en celular, con la contraseña arriba de todo porque es lo que importa.
- **Animación 3D (Three.js):** un campo de partículas tenues que flota despacio detrás de la tarjeta y hace un leve destello al generar una contraseña. Decorativa: la página funciona igual si no carga.
- Según CLAUDE.md 2.10: `requestAnimationFrame`, tope de 30 cuadros por segundo, `pixelRatio` máximo 2, se ajusta al cambiar el tamaño, se pausa con la pestaña oculta y con `prefers-reduced-motion` se queda quieta.
- Toda la animación vive en `js/animations.js`.

---

## 6. Fases de desarrollo

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Estructura de carpetas, `index.html` con la pantalla completa, `css/styles.css` responsive y README | Hecha |
| 2 | Generación segura, fortaleza, copiar al portapapeles y opciones recordadas (`js/main.js`) | Hecha |
| 3 | Animación 3D de fondo (`js/animations.js`) | Hecha |
| 4 | Cierre: checklist de CLAUDE.md 2.11, tarjeta en el portal, prueba en celular y en GitHub Pages | Revisión técnica hecha; faltan las pruebas en celular y en GitHub Pages (sección 10) |

---

## 7. Estructura de archivos del proyecto

```
password_generator/
├── index.html
├── README.md
├── PLAN.md                  # Este documento
├── css/
│   └── styles.css
└── js/
    ├── main.js              # Opciones, generación, fortaleza y copiar
    └── animations.js        # Partículas 3D de fondo
```

Sin carpeta `assets/`: no hay imágenes, iconos propios ni Lottie.

---

## 8. Ejecución local

Desde esta carpeta, `python ../dev_server.py` y abrir http://localhost:8080 (ver CLAUDE.md 2.8).

---

## 9. Riesgos y cómo se manejan

| Riesgo | Manejo |
|---|---|
| Contraseñas predecibles | Solo `crypto.getRandomValues`, con rechazo para no sesgar. Nunca `Math.random` |
| El portapapeles no funciona (http sin https, navegador viejo) | Se selecciona el texto y se avisa para copiar a mano. En GitHub Pages hay https, así que normalmente funciona |
| Alfabeto vacío | La última casilla activa no se puede desactivar |
| El 3D pesa en un equipo lento | Pocas partículas, tope de cuadros, y la página funciona sin 3D |
| Dejar una contraseña a la vista | No se guarda ninguna. La persona decide cuándo generar otra |

---

## 10. Cierre: checklist de CLAUDE.md 2.11

Revisión técnica hecha con la aplicación corriendo, también servida desde el portal en una subcarpeta, como quedará en GitHub Pages.

| Punto | Estado |
|---|---|
| Estructura como en 2.5 | Cumple. Sin `config.js` (no usa Supabase) y sin `assets/` (no hay imágenes, iconos propios ni Lottie), como permite 2.5. Además lleva este `PLAN.md` |
| `README.md` con título, descripción y ejecución local | Cumple, con el comando `python ../dev_server.py` |
| 360 px hasta escritorio | Cumple: sin desplazamiento horizontal desde 320 hasta 1920 px. Sin desplazamiento vertical en 390×844, tablet, portátil y escritorio. En un celular de 360×740 sobran unos 34 px de scroll, y en uno de 320×568 unos 288, porque el contenido ya no cabe |
| Teclado y foco visible | Cumple: el orden de Tab es enlace de salto, contraseña, Copiar, Generar otra, longitud (número y deslizante) y las cinco casillas. Todos tienen contorno naranja de 3 px |
| Sin errores en la consola | Cumple: sin errores ni promesas rechazadas, tampoco con Three.js caído ni con el almacenamiento bloqueado |
| Rutas relativas con `./` | Cumple. Ninguna ruta absoluta; probado servido desde `/password_generator/` |
| Librerías por CDN y versiones de 2.3 | Cumple: Font Awesome 6.7.2 y Three.js 0.170.0. No se carga Lottie porque no se usa. Three.js se importa con `import()` dentro de `animations.js` para que su caída no rompa el generador |
| `prefers-reduced-motion` y pausa con pestaña oculta | Cumple: con movimiento reducido queda una imagen quieta, y al ocultar la pestaña el bucle se cancela |
| `localStorage` con prefijo y `try/catch` | Cumple: una sola clave, `password_generator_options`, con lectura y escritura dentro de `try/catch` y valores corruptos descartados |
| Código en inglés, comentarios en español, snake_case | Cumple |
| Agregado al portal | Cumple: tarjeta en el `index.html` de la raíz y fila actualizada en la tabla 2.12 de CLAUDE.md |
| Una persona sin contexto lo entiende | Una sola pantalla: la contraseña arriba, Copiar al lado y las opciones debajo. Cualquier cambio genera una contraseña nueva al instante |

Además:
- **Contraste de colores (WCAG AA):** todos los textos superan 4,5 a 1 (el más bajo, "Débil" en rojo, da 5,9). El foco y los bordes de campos y botones superan 3 a 1. Los segmentos vacíos de la barra de fortaleza son más tenues a propósito: el nivel también está escrito.
- **Sin secretos ni datos personales:** el proyecto no usa claves, servidores ni cuentas.
- **Azar:** `Math.random` solo se usa en la animación decorativa. Las contraseñas usan únicamente `crypto.getRandomValues`.

### Pruebas que solo se pueden hacer a mano
1. En **uno o dos celulares** (uno con iPhone si es posible): generar, tocar **Copiar** y pegar en otra aplicación. Debe pegarse la contraseña exacta, sin espacios ni saltos de línea. Mirar también que el fondo se vea fluido.
2. En **GitHub Pages**, tras publicar: abrir `https://<usuario>.github.io/projects/password_generator/` y comprobar que carga sin errores, con iconos y fondo, y que Copiar funciona (el portapapeles solo funciona con https).
3. Activar "reducir movimiento" en el sistema y comprobar que el fondo queda quieto.

### Actualización posterior: favicon y copyright

Se agregó el favicon de la marca (`assets/icons/favicon.ico`, enlazado en el `<head>`) y el pie de copyright con el texto de CLAUDE.md 2.16. El pie suma unos 30 px de alto (el doble de línea en pantallas muy angostas, donde el texto se parte en dos), así que los píxeles de desplazamiento medidos antes en este documento aumentan en esa medida. En 1366×768 sigue sin necesitar desplazamiento vertical.

