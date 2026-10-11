# Simulador de centro de distribución

Simulador 3D isométrico de un centro de distribución: llegan tractomulas, las cajas bajan por rieles hacia la reserva y el multinivel activo, se arman pedidos en muros de consolidación, se empacan y salen en camiones por horario. Se puede pausar, acelerar, reiniciar con una semilla, mover los parámetros en vivo, provocar disrupciones, inspeccionar cualquier cosa y cancelar pedidos atascados. Sirve para ver cómo se comporta un flujo logístico y qué pasa cuando algo falla. El plan de trabajo y las decisiones están en `PLAN.md`.

## Ejecución local

Desde esta carpeta:

    python ../dev_server.py

Abrir http://localhost:8080 en el navegador.
