# Simulador de centro de distribución

Simulador 3D isométrico de un centro de distribución que empieza vacío: llegan camiones por la talanquera (con fecha, hora y ruta por región de Colombia), se parquean en orden si los 10 muelles están ocupados, descargan cajas de distintos colores y tamaños, y cada caja se inventaría. Las cajas pasan en pallets, con 10 montacargas, a una gran bodega de stock junto a los muelles; de ahí otras 10 montacargas las llevan a la reserva y al multinivel activo, se arman pedidos a ciudades de Colombia, se empacan y salen en camiones, uno por ciudad, a cada hora de corte configurable, con la Entrega a Tiempo (OTD) por día para descargar. En la primera pantalla solo está la bodega; más abajo, con scroll, se configuran los camiones por franja del día, los muelles, la prioridad de mercancía y la restricción de cada camión (y un campo para hacer llegar N camiones ya), y se ven el inventario, los parámetros, los indicadores, la inspección y las disrupciones. Sirve para ver cómo se comporta un flujo logístico y qué pasa cuando algo falla. El plan de trabajo y las decisiones están en `PLAN.md`.

## Ejecución local

Desde esta carpeta:

    python ../dev_server.py

Abrir http://localhost:8080 en el navegador.
