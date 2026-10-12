# Simulador de centro de distribución

Simulador 3D isométrico de un centro de distribución que empieza vacío: llegan camiones por la talanquera (con fecha, hora y ruta por región de Colombia), se parquean en orden si los 10 muelles están ocupados, descargan cajas de distintos colores y tamaños, y cada caja se inventaría. Las cajas pasan en pallets, con 10 montacargas, a una gran bodega de stock junto a los muelles (100.000 cajas); de ahí otras 10 las guardan en la reserva (50.000 cajas, racks de 10 niveles) y otras 10 la traen al multinivel activo de 8 pisos (25.000 cajas), que solo se surte desde la reserva; los pedidos de clientes (e-commerce, que arranca apagado y se enciende con un interruptor) van a ciudades de Colombia, se empacan y salen en camiones, uno por ciudad, a cada hora de corte configurable (con un mapa de Colombia con zoom para seguir cada camión en ruta y descargar su histórico de GPS), con la Entrega a Tiempo (OTD) por día para descargar. Un coordinador de recibo pide camiones cuando un producto va a faltar. Los productos son reales (marca y presentación, con precios de compra y de venta en pesos colombianos) y la sección Economía lleva la cuenta de lo gastado en compras, lo que vale el inventario y lo vendido. En la primera pantalla solo está la bodega; más abajo, con scroll, se ven los parámetros, se configuran los camiones por franja del día, los muelles y la restricción de cada camión (y un campo para hacer llegar N camiones ya), y se ven el inventario con filtros, la mercancía (categorías y productos propios, con su prioridad, y el reparto del activo por piso), los despachos, el mapa, los indicadores, la inspección y las disrupciones. Sirve para ver cómo se comporta un flujo logístico y qué pasa cuando algo falla. El plan de trabajo y las decisiones están en `PLAN.md`.

## Ejecución local

Desde esta carpeta:

    python ../dev_server.py

Abrir http://localhost:8080 en el navegador.
