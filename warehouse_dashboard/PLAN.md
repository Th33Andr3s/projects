# Plan de trabajo: Simulador 3D de un centro de distribución (`warehouse_dashboard`)

Documento de planificación del proyecto. Se rige por las reglas de [CLAUDE.md](../CLAUDE.md). Cada fase termina con una revisión en el navegador y la aprobación de la persona dueña antes de pasar a la siguiente. **Este plan reemplaza al del panel de bodega anterior**, que se había construido en esta misma carpeta; ver la sección 2 para lo que se aprovecha y lo que se descarta.

---

## 1. Qué es este proyecto

Un simulador animado en 3D isométrico de un **centro de distribución genérico** que muestra el ciclo completo de la mercancía: llegada de tractomulas → descarga por rieles → reparto 70 % reserva / 30 % activo → montacargas y racks de reserva → picking en un multinivel de 5 pisos → bandas por piso que convergen en una banda principal → muros de consolidación → empaque → despacho → salida de camiones por horario. La prioridad es que **el flujo se entienda y se vea bien**, no la exactitud estadística.

Se puede pausar, acelerar (1×, 2×, 5×, 10×), reiniciar con una semilla (la misma semilla repite exactamente la misma corrida), mover los parámetros con sliders sin reiniciar, provocar cuatro disrupciones (banda caída, montacarga en mantenimiento, pico de pedidos, camión retrasado), tocar cualquier cosa (caja, camión, montacarga, operario) para ver su estado, **cancelar un pedido atascado** (como administrador) para que se vuelva a procesar, y oír un ambiente de bodega generado con Web Audio.

### Qué no es
- **No es un modelo estadístico ni una herramienta de planeación.** Los números son plausibles, no calibrados. No exporta datos ni compara escenarios.
- **No usa servidor, cuentas ni datos reales.** Todo es simulado en el navegador. Lo único que se recuerda en el equipo son los valores de los sliders, la semilla, la velocidad y el silencio (`localStorage`).
- **No usa modelos 3D de terceros ni archivos de sonido.** Todo se dibuja con geometría propia de Three.js y todo el audio se genera con osciladores y ruido.
- **No tiene rotación libre de cámara.** Solo zoom, paneo y giros de 90° en pasos.

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Qué se hace con lo anterior | Se **reemplaza** el panel de bodega que estaba en `warehouse_dashboard/`, por decisión de la persona dueña y **sin respaldo** (la carpeta nunca se subió a git). Se aprovechan, dentro de esta misma carpeta, solo los archivos que sirven tal cual: el generador con semilla (`random.js`, mulberry32, que pasa a llamarse `rng.js`), el formato de números y horas (`format.js`, que se reescribió). El suavizado de movimiento (`motion.js`) se descartó al final porque los vehículos usan su propio giro suave. El resto (`simulation.js`, `scene.js`, `plan_fallback.js`, `layout.js`, `main.js`, `animations.js`, el HTML y el CSS) se reescribe en la fase 1 |
| Nombre de la carpeta | Se mantiene `warehouse_dashboard`. En la fase 8 se actualiza el texto de su tarjeta en el portal y de su fila en la tabla 2.12 de CLAUDE.md |
| Estructura | La de CLAUDE.md 2.5 (no un archivo único): `index.html`, `css/styles.css` y `js/` dividido en módulos con los nombres lógicos que pide el encargo (`rng`, `config`, `sim_clock`, `event_queue`, entidades, `layout`, `renderer`, `ui`, `audio`, `disruptions`), todos importados desde `main.js` |
| Nombres | Todo en `snake_case` (CLAUDE.md 1.3): `get_info`, `sku_id`, `order_id`, estados como `WAITING_AT_DOOR`. Las clases llevan el nombre en inglés y las constantes en `UPPER_SNAKE_CASE`. Los comentarios van en español |
| Librerías | Solo Three.js 0.170.0 con el `importmap` de CLAUDE.md 2.3 (más Font Awesome 6.7.2 para los iconos de la interfaz). Si el CDN falla, un mensaje claro lo dice en pantalla (no hay plano 2D de respaldo: sin 3D este proyecto no tiene sentido) |
| Pantallas | Escritorio como pide el encargo (tres paneles: parámetros, KPIs e inspección) y, en celular, los paneles se pliegan en cajones que se abren con un botón. Todo operable con teclado, con foco visible (CLAUDE.md 1.5) |
| Aleatoriedad | **Nunca `Math.random`.** Todo pasa por la clase `Rng` con semilla. Cada subsistema (llegadas de camiones, pedidos, reparto 70/30, líneas de pedido) usa su propio flujo derivado de la semilla, para que mover un slider de uno no cambie los números que salen en otro |
| Reloj | El reloj simulado es independiente del real. A 1× pasan **4 segundos simulados por segundo real** (eran 6 antes de la ronda 14) (`base_time_scale`, ajustable en `config.js`): así la primera tractomula llega en menos de 30 s simulados (unos 5 s reales) y una salida de camión cada 12 minutos simulados se ve cada 2 minutos reales. Las velocidades de bandas, montacargas y personas se escriben en metros por segundo simulado y se eligen para que a 1× se vean a un ritmo agradable |
| Motor | Híbrido: una **cola de eventos** (llegadas, fin de tareas, salidas por horario, fin de disrupciones) y un **paso continuo de 0,25 s simulados** para lo que se mueve (cajas por bandas y rieles, montacargas, operarios). La lógica no sabe nada de Three.js, así se prueba con valores conocidos en Node (fuera del repositorio) |
| Render | `OrthographicCamera` isométrica, `MeshStandardMaterial`, luz direccional con sombras suaves, `InstancedMesh` con pooling para cajas, pallets y cubetas (sin crear ni destruir mallas durante la corrida), geometría estática de la bodega unida en pocas mallas |
| Qué se anima de verdad | Todo el flujo: camiones que llegan, hacen cola, acoplan y abren la puerta trasera; cajas por rieles; montacargas con horquilla que sube y baja, ruedas y luz giratoria ámbar; elevador; operarios de piso, de muro y empacadores; cubetas que se vuelven cajas selladas; camiones que cargan y salen |
| Datos al abrir | La bodega **arranca con stock**: el activo al 60 % y la reserva al 25 % de su capacidad (configurable), para que los primeros pedidos se puedan pickear de inmediato |
| Audio | Web Audio API, sin archivos. Empieza tras la primera interacción de la persona (política de autoplay), con volumen bajo y botón de silencio. El estado de silencio se recuerda |
| Movimiento reducido | Con `prefers-reduced-motion`, la simulación sigue (son datos) pero no se interpola el movimiento entre pasos, la cámara cambia de vista sin deslizarse y no hay destellos; las animaciones decorativas (luz giratoria, rebotes) se detienen |
| Estética | Tema oscuro minimal para la interfaz (paneles superpuestos sobre el lienzo), maqueta low-poly clara para la bodega. Pedidos completos en verde, parciales en ámbar y bloqueos en rojo |
| Idioma | Interfaz en español de Colombia: "tractomulas", "muelles", "montacargas", "cubetas", "despacho" |

### Decisiones confirmadas por la persona dueña
Algunas salieron de una propuesta mía y otras cambiaron al responder:

| # | Decisión |
|---|---|
| 1 | **20 SKU, 4 por piso** (el SKU `n` va al piso `n mod 5`). La paleta es de 12 colores (`color = n mod 12`): los SKU 12 a 19 repiten el color de los SKU 0 a 7, pero nunca quedan en el mismo piso (12 no es múltiplo de 5), así que en un piso no hay dos SKU del mismo color |
| 2 | **Cada caja viene llena de un solo SKU, y las cajas de un mismo camión son de SKU distintos** (5 cajas pueden ser 5 SKU diferentes, repartidos al azar con la semilla). En recibo, las cajas de la reserva se agrupan en pallets **del mismo SKU** (así reabastecer un SKU es llevar un pallet de ese SKU); un pallet incompleto sale igual si pasan 600 s simulados sin llegar más cajas de ese SKU (con 20 SKU, cada camión trae pocas de cada uno; ver las notas de cierre) |
| 3 | **Un pedido no espera casilla de muro para pickearse.** Se pickea de una vez. Su primera caja que llega al muro toma una casilla libre; si no hay ninguna libre, **la caja se queda en la banda transportadora esperando, aunque se atasque** (decisión expresa de la persona dueña: el atasco es parte de lo que se quiere ver). Detalle en 4.3, 4.4 y 4.9 |
| 3 bis | **Si algo se bloquea, la alerta le avisa a la persona administradora y esta puede cancelar el pedido** que lo causa. Un pedido se bloquea, por ejemplo, porque a una de sus líneas le falta stock en el activo (el producto puede estar solo en la reserva, o no haber llegado todavía) o porque su caja espera casilla en el muro. Al cancelarlo, sus cajas vuelven al stock del activo, su casilla queda libre y puede **volver a procesarse** como un pedido nuevo con las mismas líneas (botón "Cancelar y reprocesar") o quedar cancelado (botón "Cancelar"). Detalle en 3.5, 4.3 y 4.9 |
| 4 | Escala de tiempo: 1× = 6 s simulados por segundo real, como está en la sección 2 |
| 5 | Atajos: `F` (FPS), `Q`/`E` (girar), `Espacio` (pausa), `1`–`4` (velocidad), `M` (silencio), `R` (reiniciar, con confirmación) |
| 6 | Accesibilidad: además del clic, una lista de entidades con buscador en el panel de inspección, para poder inspeccionar con teclado (CLAUDE.md 1.5) |
| 7 | Persistencia: se guardan en el equipo los sliders, la semilla, la velocidad y el silencio; "Valores de fábrica" los devuelve |

**Resuelto: qué pasa con un bloqueo (decisión 3 bis).** No hay salida automática ni banda de reciclaje: el sistema muestra la alerta y la administradora decide. Lo que bloquea es siempre un pedido concreto (el que espera casilla en la cabeza de la banda o el que espera una línea sin stock en el activo), así que cancelarlo —o cancelarlo y reprocesarlo— es la salida. Mientras tanto, reponer el SKU desde la reserva sigue ocurriendo solo (4.3, paso 6); si el SKU no existe ni en la reserva, la alerta lo dice con todas sus letras.

---

## 3. Pantalla

Un solo `index.html`: el lienzo 3D ocupa toda la ventana y los paneles flotan encima.

### 3.1 Barra superior
Reproducir/pausar, velocidad (1×, 2×, 5×, 10× en un `radiogroup`), reloj simulado (HH:MM), semilla editable (número entero), **Reiniciar** (reconstruye con esa semilla), silencio, y rotar ◀ ▶.

### 3.2 Panel izquierdo: parámetros en vivo
Sliders que aplican sin reiniciar (rangos y valores por defecto en la sección 5): intervalo medio de llegada de tractomulas, cajas por camión, tamaño de pallet, número de montacargas, de muelles, capacidad de reserva, umbral de reabasto, tasa de pedidos por minuto, líneas máximas por pedido, velocidad de bandas, número de muros y casillas por muro, estaciones de empaque y tiempo de empaque, puertas de despacho e intervalo de salida de camiones. Cada slider muestra su valor y es operable con flechas.

### 3.3 Panel derecho: KPIs en vivo
Camiones recibidos, cajas recibidas, ocupación de la reserva (%), ocupación del activo por piso (5 barras), pedidos creados / en picking / en consolidación / empacados / despachados / cancelados, tiempo de ciclo promedio de un pedido (creación → despacho), cajas en bandas, utilización de montacargas y de empacadores (%), camiones despachados y salidas vacías.

### 3.4 Panel de inspección
Aparece al elegir una entidad: tipo, id, estado actual, destino, pedido asociado y tiempo en el estado. Se elige con un clic en el 3D o desde una lista con buscador (sección 2, decisión 6).

### 3.5 Disrupciones
Cuatro botones que se activan y desactivan (`aria-pressed`), cada uno con su banner de alerta mientras está activo: **Caída de banda principal**, **Montacarga en mantenimiento**, **Pico de pedidos** (x5 durante 2 minutos simulados, con cuenta regresiva) y **Camión retrasado** (el siguiente camión de recibo tarda el triple; el muelle queda vacío).

### 3.5 bis Alertas y cancelación de pedidos
Un pedido se considera con problema cuando lleva más de `blocked_order_alert_s` (300 s simulados por defecto) sin avanzar: o una de sus líneas espera stock en el activo, o su caja espera casilla de muro en la banda. Eso genera:
- Un **banner de alerta** (`role="alert"`) con el motivo concreto, por ejemplo "Pedido #123 bloqueado: espera el SKU 07 (sin stock en el activo; 12 cajas en la reserva)" o "Muros llenos: la banda está atascada (pedido #131 espera casilla)", con un botón **Cancelar pedido** (y **Cancelar y reprocesar**).
- Una lista de **Pedidos con problema** en el panel de inspección, con los mismos botones, para poder cancelar sin hacer clic en el 3D.
- El botón también aparece al elegir un pedido o una de sus cajas en el panel de inspección, mientras su estado sea `CREATED`, `PICKING` o `CONSOLIDATING` (un pedido ya completo, empacado o despachado no se puede cancelar).
Hay una confirmación breve antes de cancelar. Cancelar no es una disrupción: es una acción de la persona administradora.

### 3.6 Leyenda y FPS
Una leyenda de colores plegable y un contador de FPS opcional (tecla `F`). Si los FPS bajan de 40 de forma sostenida, se baja sola la calidad de las sombras y aparece un aviso discreto.

### 3.7 Cámara
Zoom con la rueda (o pellizco), paneo arrastrando, giros de 90° con `Q`/`E` o los botones, con transición suave. Al acercarse mucho se ven los `order_id` sobre cajas y cubetas.

### 3.8 Comportamiento común
- **Teclado:** Tab recorre los controles; los paneles se pliegan con sus botones; el lienzo recibe foco y se mueve con las flechas (paneo), `+`/`−` (zoom) y `Q`/`E` (giro); Escape cierra cajones y el panel de inspección. Foco siempre visible.
- **Lectores de pantalla:** las alertas y disrupciones se anuncian con `role="status"` / `role="alert"`; el lienzo tiene un resumen en `aria-label` (por ejemplo "Centro de distribución: 3 camiones en muelle, 42 pedidos en proceso"); la lista de entidades es el equivalente accesible del clic.
- **Celular (desde 360 px):** los tres paneles se convierten en cajones que se abren desde la barra inferior; el lienzo conserva el gesto de paneo y pellizco.
- Sin errores ni avisos en consola; `console.log` solo detrás de una constante `DEBUG`.

---

## 4. Cómo funciona por dentro

### 4.1 Reloj y motor
- `SimClock`: segundos simulados acumulados, factor de velocidad (1, 2, 5, 10), pausa y `base_time_scale` (6). Entrega cuántos pasos de 0,25 s simulados toca avanzar en cada cuadro (con un tope por cuadro para no congelar la página a 10×).
- `EventQueue`: montículo binario ordenado por tiempo (y, a igual tiempo, por orden de inserción, para que sea determinista). Eventos: llegada de camión, fin de descarga, fin de tarea de montacarga, creación de pedido, fin de empaque, salida de camión por horario, fin de disrupción.
- Cada paso: se atienden los eventos que ya tocan y luego se actualiza lo continuo (bandas, rieles, montacargas, operarios) con `dt`. El render guarda la posición anterior y la actual de cada entidad móvil e interpola entre ambas.
- `Rng`: mulberry32 con `fork(nombre)` que deriva un flujo propio por subsistema. La semilla visible en pantalla es la raíz.

### 4.2 Entidades y máquinas de estados
Cada entidad es una clase con una **tabla explícita de transiciones válidas** (una transición fuera de la tabla es un error que las pruebas detectan) y un método `get_info()` que devuelve lo que muestra el panel de inspección.

| Entidad | Estados |
|---|---|
| `Truck` (recibo) | `ARRIVING → QUEUED → DOCKING → UNLOADING → LEAVING_EMPTY` |
| `Truck` (despacho) | `WAITING_AT_DOOR → LOADING → DEPARTING → GONE` |
| `Box` | `IN_TRUCK → ON_RAIL → AT_RECEIVING → ON_PALLET → IN_RESERVE → IN_TOTE → IN_ACTIVE → PICKED → ON_FLOOR_BELT → ON_MAIN_BELT → IN_WALL_SLOT → IN_ORDER_TOTE → PACKING → PACKED → ON_DISPATCH_BELT → LOADED → SHIPPED`; al cancelar un pedido, sus cajas pasan de `PICKED`, `ON_FLOOR_BELT`, `ON_MAIN_BELT` o `IN_WALL_SLOT` a `IN_ACTIVE` (vuelven al stock) (las cajas del 30 % pasan de `AT_RECEIVING` a `IN_TOTE`; las del 70 %, a `ON_PALLET`) |
| `Pallet` | `FORMING → READY → CARRIED → IN_RESERVE → CARRIED_TO_REPLENISH → UNPACKED` |
| `Tote` (cubeta) | `FILLING → ON_CONVEYOR → IN_ELEVATOR → AT_FLOOR → EMPTY` (entrada) y `FILLING_ORDER → ON_OUT_BELT → AT_PACK → CONSUMED` (salida) |
| `Forklift` | `IDLE → GOING_TO_PICKUP → CARRYING → UNLOADING → RETURNING` (más `MAINTENANCE` en la disrupción) |
| `Worker` | picker de piso: `IDLE → WALKING_TO_SLOT → PICKING → PLACING_ON_BELT`; operario de muro: `IDLE → EMPTYING_SLOT`; empacador: `IDLE → PACKING` |
| `Order` | `CREATED → PICKING → CONSOLIDATING → COMPLETE → PACKED → DISPATCHED` (pasa a `CONSOLIDATING` cuando su primera caja toma casilla en un muro) y, desde `CREATED`, `PICKING` o `CONSOLIDATING`, `CANCELLED`. Cada línea del pedido tiene además su estado: `PENDING → WAITING_STOCK → PICKED → AT_WALL` |
| `Belt`, `Wall`, `PackStation`, `DispatchDoor` | con su propio estado (`RUNNING`/`STOPPED`, casillas libres u ocupadas, ocupada/libre, camión asignado) |

### 4.3 El flujo, paso a paso
1. **Llegada.** Cada tractomula llega con un intervalo aleatorio (media y varianza configurables; la primera, a los 10 s simulados). Si hay un muelle libre se acopla; si no, hace **cola visible en el patio**.
2. **Descarga por rieles.** Se abre la puerta trasera y las cajas (cada una con `sku_id` y color por SKU) bajan **una detrás de otra** por un riel inclinado hasta la zona de recibo.
3. **Reparto 70/30 por unidades**, con el flujo aleatorio de la semilla: cada caja va a reserva (70 %) o a activo (30 %). En recibo las de reserva se agrupan en pallets del mismo SKU (tamaño configurable) y las de activo en cubetas.
4. **Reserva.** Los montacargas toman pallets en recibo y los llevan a una posición libre de los racks (varios niveles, ubicaciones discretas) por pasillos definidos como **grafo de waypoints**, con evitación simple de colisiones (un tramo de pasillo lo usa un montacarga a la vez). Con la reserva llena, el pallet espera en recibo y se muestra una alerta.
5. **Activo multinivel de 5 pisos.** Una estructura 3D completa y visible, con pasillos y posiciones de picking por SKU en cada piso. Las cubetas del 30 % suben por un **elevador** al piso de su SKU, donde se reponen en su posición.
6. **Reabasto por umbral.** Cuando el stock de un SKU en activo baja del porcentaje configurado se crea una tarea: un montacarga lleva un pallet de ese SKU desde la reserva al pie del multinivel, se desarma en cubetas y estas suben por el elevador. **Las tareas de reabasto tienen prioridad sobre el guardado de pallets** cuando hay pedidos esperando ese SKU.
7. **Pedidos.** Se generan con una tasa configurable (flujo propio de la semilla), con 1 a N líneas de SKU distintos. Al crearse aparece un ícono flotante "🛒 pedido web #123" sobre la zona "Clientes / e-commerce", fuera de la bodega, con una línea punteada breve hacia el centro. El pedido no necesita casilla para empezar a pickearse: la toma su primera caja al llegar al muro (paso 9).
8. **Picking.** Por cada línea, el operario del piso correspondiente va a la posición del SKU, toma la caja y la pone en la **banda de su piso**. Cada banda de piso corre a lo largo del multinivel y baja por una **espiral o rampa** hasta unirse (merge) a la **banda principal** a nivel de piso. Las cajas llevan el `order_id` como etiqueta pequeña, visible al acercarse. **Si el SKU no tiene stock en el activo, la línea queda en `WAITING_STOCK`** (el pedido sigue en `PICKING`) y se crea de inmediato una tarea de reabasto de ese SKU con prioridad (paso 6); si en la reserva tampoco hay, la alerta lo dice. La línea se pickea sola cuando llega la reposición, o se va con el pedido si la administradora lo cancela.
9. **Muros de consolidación.** La banda principal pasa por M muros de casillas. Cuando llega al muro la primera caja de un pedido, el pedido toma una casilla libre (la de un muro con espacio; si hay varias, la del muro más cercano) y todas sus demás cajas van a esa casilla. **Si no hay casilla libre, la caja se queda esperando en la banda y las que vienen detrás se acumulan** (se atasca a la vista, con alerta). Cada casilla muestra el progreso del pedido (por ejemplo 2/4) con color. **La cubeta del pedido solo sale cuando han llegado todas sus líneas**: entonces un operario del muro vacía la casilla en una cubeta que sale por banda a empaque, y la casilla queda libre para el siguiente pedido que espera.
10. **Empaque.** K estaciones. La cubeta llega, un empacador la procesa durante el tiempo configurado (la cubeta se convierte en una **caja sellada con cinta**) y la caja sale por banda a despacho.
11. **Despacho.** Cada puerta tiene su zona de staging y un camión asignado. Las cajas se cargan al camión apenas llegan a la puerta. **Los camiones salen por horario**: cada X minutos simulados el camión cierra y sale, y uno nuevo toma su lugar. Si sale sin cajas se registra como "salida vacía".
12. **Salida.** El camión recorre la vía de salida, cruza el borde del mapa y desaparece. Sube el contador de pedidos despachados cuando todas las cajas de un pedido están cargadas en un camión que ya salió.

### 4.4 Bandas
Una banda es un camino de segmentos (con tramos inclinados, la espiral y el elevador) con una velocidad y un **espaciado mínimo entre cajas**. Cada paso, las cajas avanzan sin pasar al anterior; si algo bloquea (banda caída, salida llena), se acumulan visiblemente hacia atrás. La banda principal puede quedar **detenida por delante** de un muro cuando la caja que va primero es de un pedido sin casilla: no se desvía, no da la vuelta y no se retira; espera a que se libere una. En el empalme con la banda principal una caja entra solo cuando hay hueco (se alterna entre las bandas de piso que esperan, para que ninguna se muera de hambre). El zumbido del audio y el LED de la banda dependen de si está corriendo.

### 4.5 Distribución (de izquierda a derecha)
`Patio de recibo y muelles` → `Recibo (rieles)` → `Racks de reserva` (al fondo) y `Multinivel activo` (centro) → `Muros de consolidación` → `Empaque` → `Despacho y puertas` → `Patio de salida`. Afuera del rectángulo: vía de acceso a la izquierda, zona "Clientes" arriba, vía de salida a la derecha. Cada zona lleva un letrero 3D con su nombre en español. Las medidas y posiciones viven en una tabla (`layout.js`), no repartidas por el código; las cantidades de muelles, puertas, muros y estaciones salen de `Config` y el diseño las acomoda.

### 4.6 Render
- Geometría estática (piso con cuadrícula sutil, paredes, racks, estructura del multinivel, bandas, muros, estaciones, letreros) unida en pocas mallas; lo que se mueve o cambia de cantidad, en `InstancedMesh` con pool: cajas (hasta 2.000 instancias), pallets, cubetas y partes de operarios. Camiones y montacargas son grupos de pocas mallas (hay pocos).
- Cajas coloreadas por SKU; pedidos completos en verde, parciales en ámbar, bloqueos en rojo (en las casillas de muro, los LED de banda y los íconos de alerta).
- Selección por **raycasting**: instancias (`instanceId` → entidad) y grupos; la entidad elegida se resalta con emisión y se abre su panel.
- Las sombras se activan solo en pantallas anchas y bajan solas si los FPS caen.
- Un solo `requestAnimationFrame`, tope de 60 cuadros por segundo, `pixelRatio` máximo 2, pausa con la pestaña oculta, tamaño del lienzo que sigue a la ventana.

### 4.7 Audio
Zumbido grave continuo de bandas (su volumen depende de cuántas están activas); pitido intermitente de reversa cuando un montacarga retrocede; motor de camión al llegar y al salir (ruido filtrado con envolvente); "ding" suave al completar un pedido en el muro y "zip" de cinta en empaque. Volumen general bajo, botón de silencio, inicio tras la primera interacción.

### 4.8 Disrupciones
Activas o no, las cuatro leen y escriben el mismo estado de la simulación (no hay caminos aparte):
- **Caída de banda principal:** la banda pasa a `STOPPED`, las cajas se acumulan, el LED se pone rojo; al desactivar se reanuda sola.
- **Montacarga en mantenimiento:** el montacarga con menos trabajo termina lo que lleva, va a la zona de taller y se detiene con un ícono de llave; al desactivar vuelve a `IDLE`.
- **Pico de pedidos:** multiplica por 5 la tasa durante 2 minutos simulados y cuenta hacia atrás; vuelve a la tasa normal al terminar (o al desactivar).
- **Camión retrasado:** el siguiente camión de recibo tarda el triple en llegar y el muelle queda vacío ese rato.

### 4.9 Atasco de muros
Se detecta cuando hay cajas esperando casilla y no se ha liberado ninguna en 120 s simulados: aparece, con el botón **Cancelar pedido** del pedido que va a la cabeza de la banda, el banner "Muros llenos: la banda está atascada" (`role="alert"`), la banda principal muestra su LED en rojo y el KPI "cajas en bandas" sube. Al liberarse una casilla (o al subir los muros o las casillas desde los sliders) la banda se reanuda sola y el banner se va.

**Qué hace cancelar un pedido.** En un solo paso, sin dejar nada a medias:
1. El pedido pasa a `CANCELLED` (o, con "Cancelar y reprocesar", se crea además un pedido nuevo con las mismas líneas, que entra al final de la fila de pedidos).
2. Sus cajas que están en el piso (recién tomadas), en las bandas de piso, en la principal o en una casilla de muro desaparecen de ahí (con un destello breve) y **vuelven al stock del activo** de su SKU.
3. Si tenía casilla de muro, queda libre y se le da a la siguiente caja que espera en la banda; la banda se reanuda sola si estaba detenida por eso.
4. Si el pedido tenía una línea esperando stock, esa espera se cancela (la tarea de reabasto ya creada sigue: la reposición sirve igual).
5. Los KPI cuentan el pedido como cancelado y no como despachado ni creado dos veces (el reprocesado es un pedido nuevo con su propio número).

### 4.10 Valores de comprobación
La fase 1 y las siguientes corren pruebas de la lógica en Node (scripts fuera del repositorio) sobre `rng`, `event_queue`, `sim_clock` y las máquinas de estados:
- Dos `Rng` con la misma semilla dan la misma secuencia; `fork("pedidos")` no cambia lo que da `fork("camiones")` aunque se consuman números de uno.
- El montículo entrega los eventos en orden de tiempo y, a igual tiempo, de inserción, con 10.000 eventos al azar.
- Repartir 10.000 cajas da entre 68 % y 72 % a reserva.
- Una banda con espaciado 0,6 m nunca tiene dos cajas a menos de 0,6 m; con la salida bloqueada las cajas se acumulan y nunca se pierden ni se pisan; al desbloquear, salen todas en orden.
- Un `Box` no acepta ninguna transición fuera de su tabla; lo mismo con `Order`, `Truck`, `Forklift` y `Tote`.
- Un pedido con 4 líneas **nunca** libera su cubeta antes de la cuarta caja (se revisa a lo largo de 10.000 s simulados).
- Con 2 casillas en total y 6 pedidos que llegan juntos, la caja que pide una tercera casilla se queda en la banda, las demás se acumulan detrás sin pisarse y, cuando se libera una casilla, se atiende primero la caja que lleva más tiempo esperando.
- Con los valores por defecto, 36.000 s simulados con cinco semillas distintas no terminan en bloqueo total (nada se mueve durante más de 600 s con pedidos pendientes).
- Con parámetros extremos que sí provocan bloqueo total (1 muro de 4 casillas y 20 pedidos por minuto), la alerta roja aparece y no se pierde ni se duplica ninguna caja.
- Cancelar el pedido que bloquea la banda libera su casilla, devuelve sus cajas al stock del activo (la suma de stock más cajas vivas no cambia), reanuda la banda y la alerta desaparece; "Cancelar y reprocesar" crea un pedido nuevo con las mismas líneas y otro número, y ese pedido se completa después de que llegue la reposición.
- Un pedido sin stock en el activo pero con pallets en la reserva dispara un reabasto prioritario y su línea se pickea cuando llega; un pedido de un SKU sin stock en ninguna parte queda esperando y la alerta lo dice.
- Un pedido en `COMPLETE`, `PACKED` o `DISPATCHED` no se puede cancelar (la acción se rechaza sin cambiar nada).
- Cancelar y reiniciar con la misma semilla y la misma secuencia de acciones da los mismos KPI (la cancelación es determinista).
- Con la misma semilla y los mismos parámetros, dos corridas de 3.600 s simulados terminan con los mismos KPI (comparados campo por campo); con otra semilla, distintos.
- La primera tractomula llega antes de los 30 s simulados; con 12 minutos de intervalo, los camiones de despacho salen en 720 s, 1.440 s, 2.160 s… exactos.
- Conservación: en cualquier instante, cajas recibidas = cajas en cada estado sumadas; pedidos despachados ≤ pedidos creados.
- Cada disrupción, activada y desactivada, deja los KPI sin tocar la conservación y la simulación en marcha; un pico de pedidos dura exactamente 120 s simulados.
- Rendimiento de la lógica: 3.600 s simulados con 1.000 cajas vivas en menos de 1.500 ms (Node).

La escena se comprueba en el navegador: número de instancias esperado, clic en cada tipo de entidad, giros de 90°, y FPS con 1.000 cajas visibles.

---

## 5. Configuración (`config.js`)

Todo valor operativo vive en un único objeto `Config` con su valor por defecto y el rango de su slider. `Config` guarda también las constantes que no tienen slider (paso de simulación, escala de tiempo, SKU, pisos).

| Parámetro | Por defecto | Rango |
|---|---|---|
| Intervalo medio de llegada de tractomulas (s simulados) | 570 | 60–900 |
| Variación del intervalo (± s) | 60 | 0–300 |
| Cajas por camión | 120 | 20–300 |
| Tamaño de pallet (cajas) | 12 | 4–24 |
| Montacargas | 3 | 1–8 |
| Muelles de recibo | 3 | 1–6 |
| Capacidad de la reserva (pallets) | 160 | 40–400 |
| Umbral de reabasto (% del stock máximo de un SKU) | 30 | 5–80 |
| Pedidos por minuto | 5 | 0,5–20 |
| Líneas máximas por pedido | 4 | 1–8 |
| Velocidad de bandas (m/s simulado) | 0,6 | 0,2–1,5 |
| Muros | 3 | 1–6 |
| Casillas por muro | 10 | 4–20 |
| Estaciones de empaque | 3 | 1–8 |
| Tiempo de empaque (s simulados) | 25 | 5–90 |
| Puertas de despacho | 3 | 1–6 |
| Intervalo de salida de camiones (min simulados) | 12 | 3–60 |
| Pickers por piso | 1 | 1–3 |
| Relleno inicial del activo / de la reserva (%) | 60 / 25 | 0–100 |
| Segundos sin avanzar para alertar de un pedido bloqueado (s simulados) | 300 | 60–1.800 |

Constantes fijas: 20 SKU, 5 pisos (4 SKU por piso), 12 colores, 70 % / 30 % de reparto, `base_time_scale` 6, paso 0,25 s, flush de pallet incompleto a los 600 s, 40 cajas por SKU en el activo (más un tercer estante para las que vuelven al cancelar un pedido), cubetas de entrada de 6 cajas.

---

## 6. Diseño visual y animación

- **Interfaz:** tema oscuro minimal (fondo casi negro azulado, paneles de vidrio oscuro, un acento cian para lo activo, ámbar y rojo para alertas, verde para completo), con contraste WCAG AA de 4,5 a 1 en textos y de 3 a 1 en bordes y foco; el foco usa un color distinto del acento para no confundirse.
- **Bodega:** maqueta low-poly clara (suelo gris con cuadrícula sutil, paredes y racks en tonos neutros, estructuras de bandas en azul grisáceo, montacargas ámbar, camiones blancos con cabina de color), cajas con una paleta de 12 colores bien separados (los SKU 12 a 19 repiten color con los SKU 0 a 7, en otros pisos).
- **Movimiento:** velocidad constante en bandas y rieles; montacargas con peso (se reutiliza `motion.js`), ruedas que giran, horquilla que sube y baja y luz giratoria ámbar; camiones que frenan, maniobran en arco y abren la puerta trasera.
- **Cámara:** transición suave de 300 ms al girar; sin transición con movimiento reducido.
- Según CLAUDE.md 2.10: `requestAnimationFrame`, `pixelRatio` máximo 2, ajuste al cambiar el tamaño, pausa con la pestaña oculta y toda la lógica de animación en `animations.js`. Favicon y pie de copyright según CLAUDE.md 2.16.

---

## 7. Fases de desarrollo

| Fase | Contenido | Estado |
|---|---|---|
| 1 | **Cimientos.** Se reemplaza el proyecto anterior (se conservan `random.js` → `rng.js`, `motion.js` y `format.js`). `config.js`, `rng.js`, `sim_clock.js`, `event_queue.js` y la tabla de máquinas de estados, con sus pruebas en Node. `layout.js` con las zonas; escena estática con todas las zonas y letreros; cámara ortográfica con zoom, paneo y giros de 90°; cascarón de la página responsive (barra superior y cajones vacíos) y README | **Hecha** |
| 2 | **Recibo y reserva.** Camiones de recibo (llegada, cola, acople, puerta trasera), descarga por rieles, reparto 70/30 (cada caja con un solo SKU, SKU distintos entre las cajas de un camión), pallets por SKU y cubetas en recibo, montacargas con rutas por waypoints, racks de reserva con capacidad y alerta de reserva llena | **Hecha** |
| 3 | **Activo multinivel.** Estructura de 5 pisos con posiciones por SKU, stock por posición, elevador de cubetas, reposición en el piso, tareas de reabasto por umbral con prioridad sobre el guardado | **Hecha** |
| 4 | **Pedidos y picking.** Generación de pedidos y zona de clientes, pickers por piso, bandas de piso, espiral/rampa y banda principal con empalme y espaciado, etiquetas de `order_id` | **Hecha** |
| 5 | **Muros, empaque y despacho.** Casillas de muro con progreso y regla de "solo sale completo", cubetas de salida, estaciones de empaque con la caja sellada, puertas de despacho, carga y salida de camiones por horario, vía de salida y contadores, detección de pedidos bloqueados y la lógica de cancelar y reprocesar un pedido | **Hecha** |
| 6 | **Interfaz completa.** Sliders en vivo, panel de KPIs, panel de inspección (clic y lista con teclado), las cuatro disrupciones con sus banners, alertas de pedidos bloqueados con sus botones **Cancelar pedido** y **Cancelar y reprocesar**, lista de pedidos con problema, leyenda, FPS, semilla editable y reinicio, recuerdo de valores, cajones en celular | **Hecha** |
| 7 | **Audio.** Zumbido de bandas, pitido de reversa, motores de camión, "ding" y "zip", silencio y política de autoplay | **Hecha** |
| 8 | **Rendimiento y cierre.** 60 FPS con 1.000 cajas visibles (medido), baja automática de sombras, movimiento reducido, accesibilidad, checklist de CLAUDE.md 2.11, tarjeta del portal y fila de CLAUDE.md actualizadas, sección de cierre de este documento | **Hecha** |

---

## 8. Estructura de archivos del proyecto

Según CLAUDE.md 2.5 (la división de `main.js` y `animations.js` en más archivos la permite 2.5):

```
warehouse_dashboard/
├── index.html             # Única página
├── README.md              # Título, descripción y ejecución local
├── PLAN.md                # Este documento
├── css/
│   └── styles.css         # Interfaz oscura, paneles, cajones y responsive
├── js/
│   ├── main.js            # Arranque y bucle: une reloj, simulación, escena, interfaz y audio; ajustes guardados
│   ├── config.js          # Constantes fijas y los 21 parámetros con rangos de sliders (clase Config)
│   ├── rng.js             # Rng con semilla (mulberry32) y flujos derivados
│   ├── sim_clock.js       # SimClock: tiempo simulado, velocidad y pausa
│   ├── event_queue.js     # EventQueue: montículo de eventos discretos
│   ├── state_machines.js  # Tablas de estados y transiciones válidas de cada entidad
│   ├── path_tools.js      # Caminos de segmentos: largo, muestreo, punto más cercano
│   ├── belts.js           # Belt: bandas con espaciado, bloqueo y compuertas
│   ├── entities.js        # Box, Pallet, Tote, Parcel, Truck, Forklift, Worker, Order, casillas, estaciones, puertas, elevador
│   ├── layout.js          # La tabla de la bodega: zonas, muelles, racks, pisos, bandas, red de montacargas
│   ├── simulation.js      # El motor: eventos + paso continuo, relleno inicial, alertas y KPI
│   ├── sim_receiving.js   # Camiones de recibo, rieles, mesas, reparto 70/30, pallets y cubetas en formación
│   ├── sim_storage.js     # Reserva, activo, montacargas, elevador y reabasto
│   ├── sim_orders.js      # Pedidos, operarios de picking, bandas de piso, muros y cancelación
│   ├── sim_outbound.js    # Operarios de muro, empaque, despacho y camiones de salida
│   ├── disruptions.js     # Las cuatro disrupciones
│   ├── camera_rig.js      # Matemática pura de la cámara isométrica: zoom, paneo, giros de 90°
│   ├── camera_controls.js # Gestos y teclas que mueven la cámara y elegir con un clic
│   ├── geometry_parts.js  # PartCollector: junta cajas, barras y cilindros en una sola geometría
│   ├── static_scene.js    # Todo lo que no se mueve: terreno, edificio, racks, estructura, bandas, letreros
│   ├── scene_entities.js  # Todo lo que se mueve: pools de InstancedMesh, avisos, carritos, etiquetas, elección
│   ├── renderer.js        # Escena 3D, luces, cámara, rótulos y dibujo
│   ├── animations.js      # Carga de Three.js, bucle de dibujo, tope de cuadros y pausa
│   ├── ui.js              # Barra, cajones, atajos, diálogos; arma los paneles
│   ├── ui_params.js       # Panel de parámetros (sliders)
│   ├── ui_kpis.js         # Panel de indicadores
│   ├── ui_inspector.js    # Panel de inspección: detalle, pedidos con problema, lista con buscador
│   ├── ui_alerts.js       # Avisos sobre la escena y botones de disrupciones
│   ├── entity_index.js    # Lista de todo lo inspeccionable y su búsqueda
│   ├── audio.js           # Audio con Web Audio API
│   ├── settings.js        # Ajustes guardados en localStorage
│   └── format.js          # Números, horas, duraciones y búsqueda sin tildes
└── assets/
    └── icons/
        └── favicon.ico    # Favicon de la marca (CLAUDE.md 2.16)
```

Se eliminaron en la fase 1 los archivos del panel anterior que ya no aplican (`plan_fallback.js`, `scene.js` y los de ese diseño). Sin `config.js` de Supabase (no usa Supabase), sin `lottie/` ni `img/`. El `config.js` de esta lista es el de la configuración operativa, no el de Supabase de 2.9.

---

## 9. Ejecución local

Desde esta carpeta, `python ../dev_server.py` y abrir http://localhost:8080 (ver CLAUDE.md 2.8).

---

## 10. Riesgos y cómo se manejan

| Riesgo | Manejo |
|---|---|
| Se atasca la banda principal por muros llenos (es una decisión expresa, no un error) y puede terminar en bloqueo total | Alerta roja visible con el motivo concreto; la banda se reanuda sola al liberarse una casilla; la persona administradora cancela (o cancela y reprocesa) el pedido que bloquea, o mueve sliders, o reinicia. Con los valores por defecto las pruebas de 4.10 comprueban que no hay bloqueo total; no hay salida automática: la decisión es de la persona administradora |
| El pallet no tiene dónde guardarse o el empalme de las bandas de piso se queda esperando | El pallet espera en recibo con alerta; el empalme alterna entre las bandas que esperan para que ninguna se muera de hambre. Las pruebas de la sección 4.10 recorren miles de segundos simulados buscando atascos |
| Bajan los FPS con muchas cajas | `InstancedMesh` con pooling, geometría estática unida, sombras solo en pantalla ancha y baja automática de calidad; se mide en la fase 8 con 1.000 cajas |
| El 3D no carga (CDN caída) | Mensaje claro en pantalla; el resto de la página sigue siendo usable |
| Dos corridas con la misma semilla difieren | Todo el azar pasa por `Rng`; los eventos empatan por orden de inserción; nada depende del reloj real. Se prueba comparando KPI campo por campo |
| La interfaz tapa el 3D en celular | Cajones que se abren y cierran; el lienzo ocupa toda la ventana |
| Audio molesto o bloqueado por el navegador | Volumen bajo, silencio de un toque y recordado, y arranque solo tras la primera interacción |
| Accesibilidad de una escena 3D | Lista de entidades con buscador como equivalente del clic, resumen en `aria-label`, alertas con roles, atajos de teclado |
| Se pierde el trabajo anterior | Se reemplaza **sin respaldo**, por decisión de la persona dueña; solo sobreviven los tres archivos reutilizados |

---

## 11. Cierre de la fase 1 (cimientos)

**Qué quedó hecho**
- Lógica pura: `config.js` (21 parámetros con rango y paso, `Config` con avisos), `rng.js` (mulberry32 con `fork`), `event_queue.js` (montículo, empates por orden de inserción, cancelación), `sim_clock.js` (6 s simulados por segundo real a 1×, paso de 0,25 s, tope de pasos por cuadro) y `state_machines.js` (tablas de transiciones de 17 máquinas, con etiquetas en español).
- `layout.js`: 12 zonas con letrero, 4 racks dobles de reserva (416 ubicaciones, más que el máximo de 400 del slider), multinivel de 5 pisos con el sitio de cada uno de los 20 SKU, elevador, espiral que pasa por el lado oeste exactamente a la altura de la banda de cada piso, banda principal, muros a los dos lados de la banda, estaciones, puertas y vías. Muelles, puertas, muros, casillas y estaciones se acomodan según `Config`.
- Escena estática en una sola malla con color por vértice (14 llamadas de dibujo, unos 11.000 triángulos), cámara ortográfica isométrica con zoom (rueda y pellizco, hacia el cursor), paneo (arrastre y flechas), giros de 90° con Q/E o botones (300 ms, inmediato con movimiento reducido), rótulos de zona que mantienen su tamaño en pantalla y se acomodan o se ocultan si se pisan, y sombras solo en pantallas anchas con baja automática si los FPS caen de 40 durante 3 s.
- Cascarón de la página: barra superior (reproducir/pausar, velocidad 1×/2×/5×/10×, reloj, semilla con reinicio confirmado, giros, zoom, silencio), cajones vacíos (parámetros, indicadores, inspección) que en celular suben desde abajo, leyenda de colores, diálogo de atajos, contador de FPS (F), aviso si no carga el 3D. Atajos: Espacio, 1–4, Q/E, M, F, R, ?, Esc.
- Se borró el panel anterior sin respaldo, como se decidió.

**Pruebas**: 67 pruebas de Node (fuera del repositorio) sobre `rng`, `event_queue`, `sim_clock`, `state_machines`, `config`, `layout`, `camera_rig`, `format` y `motion`, todas pasan. En el navegador: sin errores ni advertencias en consola, atajos, cajones, diálogos, rueda, arrastre, pellizco, flechas, giros, movimiento reducido, pausa con la pestaña oculta, baja de sombras, ancho de 320 a 1920 px sin desplazamiento horizontal, y contraste de colores calculado (el más bajo, el borde de controles, 3,1 a 1).

**Qué no se pudo comprobar** (el panel del navegador de la sesión no estaba visible, así que se probó con un arnés que controla `requestAnimationFrame` y el tiempo)
- FPS reales y fluidez en un equipo concreto (se mide en la fase 8).
- El evento `close` de los diálogos y las transiciones CSS en un navegador real; se probó el código que reacciona al cierre, no el evento nativo.
- El aro de foco del lienzo con Tab, el gesto táctil real y lectores de pantalla.
- Los iconos de Font Awesome cargan (la fuente está disponible), pero no se vieron en una captura.

**Notas para las fases siguientes**
- `event_queue.js`, `rng.js`, `state_machines.js`, `motion.js`, `sku_name`, `PARAMETERS` y varias constantes de `config.js` todavía no las usa la página: se conectan desde la fase 2.
- El renderer solo dibuja cuando algo cambió (`mark_dirty`); las fases con cosas en movimiento deben marcarlo en cada cuadro.
- Las bandas y los letreros ya tienen su sitio en `layout.js`; las fases 2 a 5 usan esos puntos como rutas.

---

## 12. Cierre de las fases 2 a 8

Las siete fases se hicieron seguidas, por indicación de la persona dueña ("completa todas las fases sin detenerte"), así que las revisiones de cada fase se hicieron al final y no una por una.

**Qué quedó hecho**
- **Fase 2, recibo y reserva.** Camiones de recibo que llegan (el primero a los 10 s), hacen cola visible, se acoplan de reversa con giro y abren la puerta trasera; cajas por rieles hasta una mesa; reparto 70/30 con el flujo propio de la semilla; pallets de un solo SKU que se forman en 21 puestos y cubetas de seis cajas por piso; montacargas con horquilla, ruedas y luz que llevan los pallets a 416 ubicaciones de racks por una red de troncal y pasillos (un pasillo lo usa uno a la vez).
- **Fase 3, activo.** 20 SKU en 5 pisos con 40 cajas cada uno; elevador de cubetas; reabasto por umbral con prioridad para los SKU que ya tienen pedidos esperando; un pallet de reabasto se desarma en cubetas que suben al piso del SKU.
- **Fase 4, pedidos.** Pedidos con tasa de Poisson de la semilla; un operario por piso (hasta tres) recoge cada línea y la pone en la banda del piso; las bandas bajan por la espiral y se juntan en la principal con turnos para que ninguna se quede sin pasar; etiquetas con el número de pedido al acercarse; carrito "pedido web #N" sobre la zona de clientes.
- **Fase 5, muros, empaque y despacho.** Casillas con progreso y la regla "la cubeta solo sale cuando llegaron todas las líneas"; si no hay casilla la caja espera en la banda aunque se atasque; cubetas de salida, estaciones de empaque que sueldan la cubeta en un paquete sellado, puertas con su camión y salidas por horario (también vacías), y la lógica de cancelar y reprocesar un pedido.
- **Fase 6, interfaz.** Sliders en vivo, indicadores, inspección por clic o por lista con buscador, las cuatro disrupciones con sus avisos, avisos de pedidos bloqueados con el botón de cancelar, leyenda, FPS, semilla y reinicio, valores de fábrica, ajustes guardados y cajones en celular.
- **Fase 7, audio.** Zumbido de bandas (sube con las que trabajan), pitido de reversa, motor de camión, "ding" y "zip"; silencio recordado; el contexto de audio nace en la primera interacción.
- **Fase 8, cierre.** Movimiento reducido en la cámara y los efectos, pausa con la pestaña oculta, baja automática de sombras, código muerto quitado (`motion.js`, exportaciones sin uso), tarjeta del portal y fila de CLAUDE.md actualizadas.

**Cambios frente a lo planeado**
- **Estructuras en vivo.** Muelles, puertas, muros, casillas y estaciones que se pueden abrir con sliders se dibujan siempre al máximo; las que no están en servicio se ven cerradas (cubierta oscura) en lugar de reconstruir la escena al mover el slider. Por eso por defecto se ven 3 de 6 muelles, puertas y muros, y 3 de 8 estaciones.
- **Pallets.** Con 20 SKU, cada camión trae unas 4 cajas de cada uno, así que un pallet de 12 tarda varios camiones en llenarse: hay 21 puestos de formación (uno por SKU más uno de sobra) y el pallet incompleto sale a los 600 s en vez de a los 90 s. Si no hay puesto libre, la caja espera en la mesa y el camión detiene su descarga (contrapresión), nunca se arman pallets de una sola caja.
- **Valores por defecto.** Intervalo de camiones 570 s y 5 pedidos por minuto, para que entren aproximadamente las mismas cajas que salen (12,6 contra 12,5 por minuto). Con otros valores, la reserva se llena (y la alerta lo dice) o el activo se vacía.
- **Qué se dibuja una por una.** Las cajas en bandas, mesas, casillas y estantes del activo son instancias individuales (unas 400 a 1.000); las que van en un pallet, una cubeta o un camión las dibuja su contenedor (el pallet muestra una pila cuya altura sigue a su carga). La simulación sí lleva cada caja por separado (unas 950 al empezar).
- **Paneles.** Inspección y Disrupciones comparten el centro de la pantalla y se turnan; los avisos van en una pila bajo la barra superior. Cancelar un pedido siempre pasa por un diálogo con tres salidas (volver, cancelar, cancelar y reprocesar). La reserva se llena desde la fila de adelante para que se vea.
- **Cámara y rótulos.** Los rótulos de zona se acomodan o se ocultan si se pisan; las etiquetas de pedidos solo aparecen con el zoom alto.

**Pruebas.** 112 pruebas de Node, fuera del repositorio, todas pasan: 66 de lógica base y cámara, 30 de la simulación (determinismo con la misma semilla, conservación de cajas cada 600 s durante 36.000 s, cubeta de pedido que nunca sale antes de su última caja, cinco semillas de 36.000 s sin bloqueo total, atasco de muros con 1 muro de 4 casillas y 20 pedidos por minuto, cancelar y reprocesar, rechazo de cancelar lo ya completo, determinismo de la cancelación, reabasto, cuatro disrupciones, sliders subidos y bajados en marcha, 3.600 s con unas 1.200 cajas en 200 a 400 ms) y 16 de módulos puros (caminos, formato, lista de entidades, reparto 70/30 entre 68 % y 72 %, SKU distintos por camión). Una corrida de 200.000 s simulados con los valores por defecto termina sin errores. En el navegador: sin errores ni avisos en consola, clic sobre un camión, lista con buscador, disrupciones con sus avisos y la cuenta regresiva del pico, cancelar desde el aviso de un atasco, reinicio con confirmación, valores de fábrica, ajustes recuperados al recargar, audio que arranca tras la primera interacción, anchos de 320 a 1920 px sin desplazamiento horizontal, y unos 3 a 6 ms de CPU por cuadro a 1920 × 1080 con la simulación a 1× y a 10×.

**Qué no se pudo comprobar** (el panel del navegador de la sesión no estaba visible y se probó con un arnés que controla `requestAnimationFrame` y el tiempo)
- Los FPS reales en equipos concretos (solo se midió el tiempo de CPU por cuadro, no el de la GPU) y a 60 FPS sostenidos con 1.000 cajas en pantalla en un celular.
- Que el sonido se oiga bien (volumen, tono): se comprobó que se crea y funciona sin errores, no que suene agradable.
- Gestos táctiles reales, lector de pantalla, el aro de foco del lienzo con Tab y las transiciones CSS de los cajones en un navegador real.
- Los iconos de Font Awesome en una captura (la fuente carga y el glifo existe).

**Para saber al usarlo**
- Los atascos de los muros son deliberados: no se resuelven solos, los resuelve quien administra cancelando el pedido que bloquea.
- Con los valores por defecto la reserva se llena después de unas 22 horas simuladas (unas 3,7 reales a 1×) y aparece la alerta de reserva llena.
- Con 20 SKU y pallets de 12, mover el tamaño del pallet o los SKU por camión cambia mucho lo llenos que salen.

## 13. Ronda de ajustes del patio de recibo (camiones, parqueadero, talanqueras, inventario)

Esta sección **reemplaza** lo que digan las secciones 3 (pantalla), 4.3 (recibo), 4.5 (distribución) y 5 (configuración) donde se contradigan. Lo demás sigue igual.

**Qué cambió**
- **Parqueadero en orden.** Si todos los muelles están ocupados o bloqueados, los camiones entran al predio y se parquean en una de 20 plazas, que se llenan en orden (de la 1 en adelante). Cada vez que se libera un muelle, pasa un solo camión: el que le toque por prioridad y, entre iguales, el que llegó antes. El camión sale de su plaza en reversa, gira en el pasillo y va al muelle; los demás no se mueven, así que ya no titilan.
- **Camiones.** Todos con cabezote azul cielo y contenedor blanco con su número al centro de cada costado. El número no cambia nunca.
- **Primera pantalla = solo la bodega.** A pantalla completa (100 dvh). Los controles flotan encima. Más abajo, con scroll, hay una barra de secciones (que se queda arriba) y las secciones: Patio y muelles, Inventario, Parámetros, Indicadores, Inspección y Disrupciones. La rueda sola del mouse baja la página; Ctrl + rueda (o el pellizco) acerca la bodega. Lo que se elige con un clic sale en una tarjeta flotante con botón de cerrar (Escape también cierra). Elegir algo desde una lista de abajo sube la página a la bodega.
- **Entrada y salida con talanqueras estilo peaje.** Dos garitas, cada una con su carril de entrada y de salida; la barrera sube cuando el camión se registra y baja apenas pasa; un carril atiende a un camión a la vez.
- **Predio rectangular y sellado.** Cerca de alambre con postes alrededor; afuera hay pasto, árboles y carreteras sin fin: los camiones aparecen y desaparecen por el borde de la pantalla (el mundo se dibuja mucho más grande de lo que se ve).
- **10 muelles de recepción**, numerados (el número se ve sobre cada muelle).
- **Fecha, hora y ruta.** Cada camión tiene fecha y hora de llegada (el día 1 es hoy y arranca a las 6 a. m.) y una ruta de región a Bogotá: Caribe, Andina, Pacífica, Orinoquía o Amazonía, con ciudad y kilómetros aproximados.
- **Cajas.** Cada producto (SKU) tiene siempre el mismo tono, tamaño de caja y unidades por caja. Al hacer clic en una caja salen: SKU y producto, número de caja, lugar de procedencia, camión asociado y unidades que trae el camión.
- **Empieza desde cero.** Sin cajas ni pedidos. Cada caja se anota en el inventario cuando el camión la suelta en el riel y se descuenta cuando sale en un camión de despacho. Los pedidos solo piden productos que ya están en el inventario (en el activo, en la reserva o en camino).

**Qué se configura (sección "Patio de recibo y muelles")**
- Camiones por franja: mañana (6 a 12), tarde (12 a 18) y noche (18 a 22). El total del día es la suma. De 10 p. m. a 6 a. m. no llegan camiones. Por defecto 8, 10 y 6. Hoy y mañana siempre están programados; al cambiar una franja que no ha empezado se vuelve a sortear (con números nuevos); una franja que ya empezó se conserva.
- Habilitar o bloquear cada muelle. Bloquear uno que tiene camión lo deja terminar.
- Prioridad por categoría (Normal, Alta, Máxima): trae más camiones de esa categoría y sus camiones pasan primero a un muelle libre.
- Restricción por camión: un muelle fijo y/o la franja desde la que puede entrar a muelle. Ejemplo: camión 4, muelle 3, desde la tarde: llega en la mañana, se parquea y entra solo a ese muelle desde las 12. Un camión con restricción que no puede pasar no frena a los demás.
- Todo esto se guarda en el navegador (`warehouse_dashboard_settings`, clave `yard`).

**Categorías.** Cinco, una por piso del activo: Juguetes, Ropa de mujer, Ropa de niño, Ropa de hombre y Tecnología, con cuatro productos cada una (20 SKU). Cada camión trae una sola categoría.

**Valores por defecto nuevos.** 0,8 pedidos por minuto y camiones 8 + 10 + 6 de 120 cajas: en un día entran unas 2.880 cajas y salen unas 2.880 (2,0 por minuto en las dos direcciones). En una corrida de 3 días la reserva queda baja y no se llena.

**Archivos nuevos en `js/`:** `catalog.js` (categorías, productos, regiones), `yard_config.js` (la configuración), `truck_schedule.js` (la agenda de camiones), `gates.js` (talanqueras), `inventory.js`, `ui_yard.js` y `ui_inventory.js` (los dos paneles nuevos).

**Pruebas.** 20 de Node nuevas del patio (configuración, agenda, parqueadero en orden, prioridad, restricciones, talanqueras, inventario, selección de cajas, determinismo y 3 días de corrida) además de las anteriores ajustadas; todas pasan. Se encontró y corrigió un defecto: una caja más larga que el espacio libre del riel quedaba anotada como recibida y perdida (ahora se pide el espacio de la caja que sigue).

**Qué no se pudo comprobar.** Los FPS reales en equipos concretos; gestos táctiles reales; lector de pantalla; el aro de foco con Tab en un navegador real; que el sonido suene agradable.

## 14. Ronda de ajustes: titileo, rótulos, velocidad y llegada inmediata

**La causa del titileo.** El dibujo interpola entre la posición anterior y la actual de cada cosa usando qué tanto va del paso de la simulación (0 a 1, que se repite en cada cuadro). Pero la posición anterior solo se actualizaba cuando algo se movía: un camión ya acoplado, una caja en una banda detenida o un montacargas esperando conservaban una posición anterior vieja (a unos 0,4 m) y se dibujaban "bailando" entre las dos al repetirse la fracción. Medido en el navegador, un camión descargando saltaba entre −59,45 y −59,95 en cada cuadro. Ahora cada cosa recuerda en qué paso se movió por última vez (`step_clock` y `moved_this_step` en `entities.js`) y lo que no se movió en el último paso se dibuja quieto. Después del arreglo el camión queda fijo en −59,40 y el recuadro del camión no cambia ni un píxel entre cuadros.

**Otras causas de titileo que también se corrigieron**
- Los rótulos "Caja N" se repartían entre 36 sprites ordenados por cercanía al centro de la pantalla; al moverse las cajas cambiaba el orden y los textos saltaban de una caja a otra. Se quitaron todos los rótulos automáticos: ahora solo sale "Caja N" sobre la caja que la persona eligió con un clic (los rótulos de pedido sobre muros, cubetas y paquetes se quitaron también; la tarjeta de selección muestra esos datos).
- Con el patio lleno los camiones que esperaban en la carretera se detenían todos en el mismo punto, uno encima de otro, y sus caras coplanares parpadeaban. Ahora hacen fila (cada uno se detiene 13 m detrás del de adelante); si la fila llega al borde de la pantalla, el siguiente espera unos segundos antes de aparecer. A la talanquera de salida va un camión a la vez (los demás esperan en su muelle con la puerta abierta). Las plazas del parqueadero más cercanas a los carriles de la garita se alejaron 1 m para que el camión que pasa no roce al parqueado.
- Las ruedas de un montacargas detenido ya no giran (se calculaba el giro con la posición anterior vieja).

**Velocidad.** A 1× pasan 4 segundos simulados por segundo real (antes 6): camiones, cajas, montacargas y personas se ven un tercio más lentos y todo sigue proporcionado (el equilibrio de entradas y salidas no cambia). Los botones 2×, 5× y 10× siguen igual.

**Llegada inmediata de camiones.** Un campo con un número y el botón "Llegar" (en la barra de arriba y en la tarjeta "Hacer llegar camiones ahora" de la sección Patio y muelles; Enter también envía). Pide hasta 40 camiones: salen a la carretera uno tras otro, con 5 s entre sí, y llegan a la talanquera 30 s después. Son camiones extra: no cuentan en los camiones por franja, aparecen en la tabla con franja "Manual", llevan su número siguiente y se les puede poner muelle fijo y "entra desde" como a los demás.

**Pruebas.** 138 pruebas de Node (todas pasan), con nuevas para la llegada inmediata, la fila en la carretera, la salida de a uno y la interpolación de lo que no se mueve. Medido con una prueba de choque de rectángulos de camiones: con los valores por defecto 0 choques en 24 h; con 40 camiones de golpe y todos los muelles bloqueados, 0 choques (antes, más de 3 millones de muestras con camiones encimados).

**Qué no se pudo comprobar.** Que a 60 FPS reales en un celular ya no se vea ningún titileo (se probó con un arnés que avanza el reloj cuadro a cuadro y compara los píxeles del lienzo).

## 15. Botón "Reiniciar inventario"

En la sección Inventario hay un botón "Reiniciar inventario" (con confirmación): vuelve al inicio con la misma semilla y la misma configuración del patio, y pone en 0 los parámetros "Activo lleno al empezar" y "Reserva llena al empezar", para que el inventario empiece de verdad en cero. Hasta que llega el primer camión (a los 40 s simulados) no hay ninguna caja. El botón "Reiniciar" de siempre no cambia esos parámetros: si están por encima de 0, el inventario no empieza en cero, y ahora el diálogo de confirmación lo avisa con los porcentajes y apunta al botón nuevo.

## 16. (Reemplazada por la sección 18) Camiones de despacho sin mercancía

En esta ronda los camiones se quedaban esperando carga; después se decidió lo contrario (la hora de corte se cumple siempre). Ver sección 18.

## 17. Cancelación masiva y 10 montacargas

- **Cancelación masiva.** En la sección Inspección hay dos botones: "Cancelar los pedidos con problema (N)" y "Cancelar todos los pedidos (N)". El número se actualiza en vivo y el botón se apaga si no hay ninguno. Piden confirmación (con cuántos pedidos se cancelan). Las cajas vuelven al stock del activo y las casillas del muro quedan libres, igual que al cancelar uno solo; los pedidos ya completos, empacados o despachados no se tocan, y no se reprocesan.
- **Montacargas.** El parámetro pasa de 3 por defecto (máximo 8) a 10 por defecto (máximo 10; el slider permite bajarlo hasta 1). El taller tiene 10 puestos en cinco columnas y dos filas, que se llenan desde el fondo para que un montacarga que llega a un puesto libre no atraviese a los parqueados. Con 10 montacargas, 5 horas de trabajo con pedidos a 4 por minuto no se traban y la caja se conserva.


## 18. Hora de corte, informe de despachos y bodega de recibo

**Hora de corte (despacho).** Cada puerta tiene una hora de corte (cada `truck_departure_minutes`): a esa hora el camión acoplado sale con lo que haya cargado, aunque no lleve nada, y el corte se anota en el informe. La información del camión muestra su "Hora de corte" y la de la puerta, su "Próximo corte". Si en el momento del corte no hay camión acoplado (por ejemplo, con la entrada cerrada) también queda anotado ("Corte sin camión en la puerta"). Los paquetes nuevos solo se mandan a puertas con camión acoplado cuando las hay.

**Informe de despachos (sección Despachos).** Un renglón por corte: número, hora de corte, puerta, camión, destino (región), pedidos, cajas, unidades y resultado (salió con carga, salió sin carga porque no llegó mercancía, o corte sin camión). Resumen arriba (cortes cumplidos, con carga, sin carga, sin camión, unidades despachadas), los 100 más recientes en pantalla, y un botón para descargar todo lo que recuerda la simulación (hasta 400 cortes) en CSV. El informe empieza vacío cada vez que se reinicia la simulación.

**Entrada de camiones de despacho.** Un interruptor en la sección Despachos (se guarda con la configuración del patio). Cerrada: no entra ningún camión nuevo de despacho a las puertas; los que están acoplados salen en su corte y la puerta queda sin camión (cada corte sin camión se anota). Los camiones que ya venían por la carretera esperan sin pisarse, cada puerta en su lugar de la fila. Al abrirla, los camiones entran de nuevo.

**Bodega de recibo (stock).** Toda la mercancía que baja de los camiones por los rieles entra primero a una bodega de recibo (zona nueva al sur de la reserva, con una pila por producto: una fila por categoría y una columna por producto) y de ahí se reparte a pallets (reserva) y cubetas (activo). Así la descarga no espera a que haya puesto de pallet o cubeta libre ni hay mesas que se llenen.
- Dos parámetros nuevos en Recibo: "Capacidad de la bodega de recibo" (1.500 cajas por defecto, de 200 a 4.000) y "Reparto a reserva y activo" (90 cajas por minuto por defecto, de 10 a 300).
- Si la bodega se llena, la caja espera en el riel y el camión detiene la descarga hasta que haya lugar. Si el reparto no puede colocar una caja (sin puesto de pallet o con la cubeta de su piso llena), pasa a la siguiente.
- Cada caja tiene un estado nuevo, "En la bodega de recibo" (reemplaza al antiguo "En recibo"). En el inventario hay dos columnas nuevas ("En rieles" y "Bodega de recibo") y el indicador "Bodega de recibo" en Indicadores.
- La pila de la bodega se elige con un clic (SKU, categoría, cajas y unidades) o desde la lista de Inspección. La altura de la pila crece un piso cada 16 cajas.
- Los pedidos pueden pedir lo que ya está en la bodega de recibo (cuenta como inventario).
- Se quitaron las mesas de recibo con cajas (el bloque gris al final de cada riel queda como adorno) y el tope de "cajas esperando en recibo".

**Pruebas.** 149 de Node, todas pasan (nuevas: corte con y sin carga, informe, entrada cerrada y abierta, camiones en fila con la entrada cerrada, bodega de recibo —entrada, descarga al ritmo del riel con reparto lento, llenado y tope, pedidos de lo que hay en bodega—).

**Qué no se pudo comprobar.** El aspecto con muchas cajas en la bodega a 60 FPS reales y las cajas que "saltan" del final del riel a la bodega (no hay un transportador dibujado entre los dos).

## 19. Dos flotas de montacargas y bodega de stock grande junto a los muelles

**Cambios de diseño** (la persona pidió separar las montacargas y poner la bodega de stock cerca de los muelles y lejos de los racks; eligió la opción "sur, pegada a los muelles 6 a 10" y que las montacargas lleven todo hasta el multinivel, sin banda).
- **Bodega de recibo (stock).** Ahora es una sala de 34 × 16,5 m (unos 560 m²) al sur de los racks, que empieza donde terminan los rieles (junto a los muelles 6 a 10) y queda separada de los racks por un pasillo de 4 m. Capacidad por defecto 5.000 cajas (de 500 a 8.000). Una pila por producto (20), más grandes (3,4 × 2,2 m, un piso cada 24 cajas, hasta 5 m). Al norte tiene la franja de armado: 10 puestos de pallet y 5 de cubeta. Al oeste, cinco andenes por donde entran las montacargas de muelle a stock.
- **Montacargas de muelle a stock (10).** Cada muelle tiene dos puestos de pallet de descarga al final de su riel (los rieles se acortaron a 8 m). Las cajas que bajan del camión se acomodan en un pallet de descarga (cajas de varios productos del mismo camión, 24 por pallet; sale incompleto a los 40 s sin cajas nuevas). Una montacarga de esta flota lo lleva por un carril pegado a los rieles hasta un andén de la bodega y las cajas pasan a la pila de su producto. Son naranja. Solo hacen este viaje.
- **Montacargas de stock a racks y multinivel (10).** Del stock salen cajas hacia los puestos de armado (pallets de un solo producto y cubetas de un piso). Esta flota, azul, lleva los pallets llenos a los racks, trae los pallets de reabasto de los racks y lleva las cubetas llenas hasta la puerta del elevador por un pasillo entre los racks y el multinivel. La banda de cubetas se quitó. Una cubeta nueva (la que llevó una montacarga o la que sale de desarmar un pallet de reabasto) espera en la puerta del elevador de a una.
- **Taller.** Una franja pegada a la pared sur con 20 puestos: 10 naranja y 10 azul.
- **Parámetros.** "Montacargas de muelle a stock" (10 por defecto, de 1 a 10) y "Montacargas de stock a racks y multinivel" (10 por defecto, de 1 a 10). La capacidad de la bodega pasa de 1.500 a 5.000 por defecto.
- **Estados nuevos.** Caja: "En un pallet de descarga" (entre el riel y la bodega). Pallet: "Entregada a la bodega". Cubeta: "Lista para llevar" y "Esperando el elevador". En el inventario la columna "En rieles" pasa a "En muelle" (rieles y pallets de descarga).

**Titileo de las pilas verdes.** Con una sola caja que llegaba y salía casi de inmediato, la pila (por ejemplo la de ropa de niño, verde azulado) aparecía y desaparecía cada segundo. Ahora la altura dibujada de cada pila va alcanzando a la real poco a poco (nunca salta de nada a una caja) y la llegada de cajas es por pallets de 24, no de a una. También se evitó que los cuadros del piso de filas vecinas se traslaparan.

**Un defecto que apareció al probar y se corrigió.** Una montacarga podía dejar una cubeta en la puerta del elevador a la vez que otra recién desarmada, y la primera se perdía con sus 6 cajas (los SKU se quedaban "sin stock" y los muros se atascaban). Ahora la puerta es de a una cubeta, con espera antes de dejarla, y dejar una segunda lanza un error en vez de perderla. Con eso, 8 semillas de 24 h con los valores por defecto terminan sin atasco de muros.

**Pruebas.** 159 de Node (todas pasan). Nuevas de las flotas y de la bodega (cada flota hace solo lo suyo y no sale de su zona, el pallet de descarga, las cubetas al elevador, sin atascos en 8 semillas de 24 h, las montacargas no se pisan, la bodega es grande, está junto a los rieles y separada de los racks), además de las anteriores ajustadas.

**Qué no se pudo comprobar.** El aspecto con 20 montacargas trabajando a 60 FPS reales; que las montacargas no se estorben cuando coinciden varias en el mismo carril de un solo sentido (se midió que casi nunca pasa, pero no hay un control de tráfico).

## 20. Despachos por hora de corte y destino, OTD, inventario con capacidades y velocidades del tiempo

Esta sección **reemplaza** lo de las secciones 16 y 18 sobre los cortes de los camiones de despacho (los camiones ya no salen "cada tantos minutos" ni salen vacíos).

**Horas de corte.** De fábrica: 03:00, 09:00, 12:00, 18:00 y 20:00. Se cambian en la sección Despachos (de 1 a 8 horas, se ordenan solas, hay botón "Horas de fábrica") y se guardan con la configuración del patio. Al cambiarlas, el corte que viene se reprograma y los pedidos sin salir toman el corte que les toca con las horas nuevas.

**Destinos.** Cada pedido lleva una ciudad de destino al azar (con más peso para las grandes): 27 ciudades de Colombia con acceso por carretera en las cinco regiones (sin islas ni ciudades sin vía), con sus kilómetros desde Bogotá. Mismos orígenes para los camiones de recibo.

**Regla de los 60 minutos.** Un pedido que cae a más de 60 minutos de un corte sale en ese corte; si cae a 60 minutos o menos, sale en el siguiente (cae a las 4:59 p. m., sale a las 6; cae a las 5:00 p. m., sale a las 8). Si a su hora de corte el pedido no está listo (no está empacado y en su pila), pierde el corte: es un **envío tardío**, queda marcado y sale en el siguiente.

**Cómo salen.** Los paquetes empacados llegan al final de la banda de despacho y esperan en una pila por ciudad, en la zona de despacho (27 pilas del color de su región; se ven y se eligen con un clic). A cada hora de corte se arma un camión por ciudad con los pedidos de ese corte (o de uno anterior, si estaban tardíos), con su capacidad (200 cajas por defecto, parámetro "Cajas por camión de despacho"); si no caben, sale otro de la misma ciudad. Salen primero las rutas más largas. Los camiones entran por la talanquera este de a uno (cada 8 s), se acoplan a una de las puertas libres (hasta 6, parámetro "Puertas de despacho"), cargan sus paquetes de a uno y salen, de a uno por la talanquera de salida. Desaparecieron los carriles de rodillos a cada puerta y el parámetro "Salida de camiones cada". La entrada de camiones de despacho se puede cerrar: los camiones esperan y los pedidos, que estaban listos, no se vuelven tardíos por eso.

**Entrega a Tiempo (OTD).** Un pedido es a tiempo si salió en el corte que le tocaba y llega al cliente antes de la hora prometida. Promesa = hora de corte + viaje a 55 km/h + 1 hora de tolerancia. Llegada = hora de salida + viaje a la velocidad promedio de ese camión (sale al azar con la semilla, entre 45 y 65 km/h; no se simula el trayecto, solo se calcula). OTD por día = pedidos a tiempo ÷ pedidos con entrega prometida ese día. Se descarga en CSV (con ";" y coma decimal, para Excel en español): KPI OTD por día (con total y notas), detalle por pedido e informe de camiones. Al reiniciar, si la corrida despachó pedidos, el diálogo ofrece (marcado) descargar el KPI OTD antes de perderlo. El indicador OTD y los envíos tardíos también salen en Indicadores. Los supuestos de velocidad son de la simulación, no datos reales.

**Inventario.** Arriba: mercancía total en el CD (cajas y unidades) y, de ese total, la bodega de stock, la reserva, el activo, lo que está en proceso (muelle, armado de pallets y cubetas y pedidos en proceso) y lo enviado (acumulado). Bodega de stock, reserva y activo muestran su capacidad en cajas (bodega: el parámetro; reserva: pallets × cajas por pallet; activo: 20 productos × 40 cajas), unas unidades aproximadas (con el promedio de unidades por caja del catálogo) y su porcentaje lleno.

**Tiempo.** Velocidades 1×, 2×, 5×, 10×, 25×, 50× y 100× (teclas 1 a 7). A 100× pasan 400 segundos simulados por segundo real: un día de 24 h en unos 3,5 minutos reales; a 50×, 7; a 25×, 14. El tope de pasos por cuadro subió a 80 para que 100× no se frene a 30 cuadros por segundo.

**Pruebas.** Nuevas (`dispatch_tests`): regla de los 60 minutos con los ejemplos de la persona, horas configurables, destinos, ola de un corte (un camión por ciudad, capacidad, solo pedidos de su corte), envío tardío, OTD (promesa, llegada, resumen por día, CSV), cambio de horas en marcha, entrada cerrada, camiones sin pisarse, resumen de inventario con capacidades, velocidades y 4 semillas de 30 h sin atasco.

**Qué no se pudo comprobar.** La sensación de 100× en un equipo real (a esa velocidad los camiones y las montacargas se ven a saltos); que Excel abra el CSV con la configuración regional de cada equipo.
