// El panel de indicadores: números en vivo de lo que pasa en la bodega. Solo se escribe en la página lo que cambió, para no
// molestar a los lectores de pantalla ni gastar cuadros.

import { format_duration, format_number, format_percent } from "./format.js";

const SECTIONS = [
  {
    title: "Recibo",
    rows: [
      { key: "trucks_received", label: "Camiones recibidos", format: format_number },
      { key: "boxes_received", label: "Cajas recibidas", format: format_number },
    ],
  },
  {
    title: "Ocupación",
    rows: [{ key: "reserve_percent", label: "Reserva", format: format_percent, bar: true }],
    floors: true,
  },
  {
    title: "Pedidos",
    rows: [
      { key: "orders_created", label: "Creados", format: format_number },
      { key: "orders_picking", label: "En picking", format: format_number },
      { key: "orders_consolidating", label: "En consolidación", format: format_number },
      { key: "orders_packed", label: "Empacados", format: format_number },
      { key: "orders_dispatched", label: "Despachados", format: format_number },
      { key: "orders_cancelled", label: "Cancelados", format: format_number },
      { key: "cycle_average_seconds", label: "Tiempo de ciclo promedio", format: format_duration },
    ],
  },
  {
    title: "Operación",
    rows: [
      { key: "boxes_on_belts", label: "Cajas en bandas", format: format_number },
      { key: "forklift_utilization", label: "Uso de montacargas", format: format_percent },
      { key: "packer_utilization", label: "Uso de empacadores", format: format_percent },
      { key: "trucks_dispatched", label: "Camiones despachados", format: format_number },
      { key: "empty_departures", label: "Salidas vacías", format: format_number },
    ],
  },
];

export function build_kpi_panel(body) {
  const cells = new Map();
  const bars = new Map();
  const last = new Map();

  function make_bar() {
    const track = document.createElement("div");
    track.className = "bar_track";
    track.setAttribute("aria-hidden", "true");
    const fill = document.createElement("div");
    fill.className = "bar_fill";
    track.append(fill);
    return { track, fill };
  }

  SECTIONS.forEach((section) => {
    const element = document.createElement("section");
    element.className = "kpi_group";
    const title = document.createElement("h3");
    title.textContent = section.title;
    element.append(title);
    const list = document.createElement("dl");
    list.className = "kpi_list";

    section.rows.forEach((row) => {
      const wrapper = document.createElement("div");
      wrapper.className = "kpi_row";
      const term = document.createElement("dt");
      term.textContent = row.label;
      const value = document.createElement("dd");
      wrapper.append(term, value);
      if (row.bar) {
        const bar = make_bar();
        wrapper.append(bar.track);
        bars.set(row.key, bar.fill);
      }
      list.append(wrapper);
      cells.set(row.key, { value, row });
    });

    if (section.floors) {
      for (let floor = 0; floor < 5; floor += 1) {
        const wrapper = document.createElement("div");
        wrapper.className = "kpi_row";
        const term = document.createElement("dt");
        term.textContent = `Activo, piso ${floor + 1}`;
        const value = document.createElement("dd");
        const bar = make_bar();
        wrapper.append(term, value, bar.track);
        list.append(wrapper);
        cells.set(`floor_${floor}`, { value, row: { format: format_percent } });
        bars.set(`floor_${floor}`, bar.fill);
      }
    }
    element.append(list);
    body.append(element);
  });

  function write(key, raw_value) {
    if (last.get(key) === raw_value) return;
    last.set(key, raw_value);
    const cell = cells.get(key);
    cell.value.textContent = cell.row.format(raw_value);
    const fill = bars.get(key);
    if (fill) fill.style.width = `${Math.min(100, Math.max(0, raw_value))}%`;
  }

  return {
    update(kpis) {
      cells.forEach((cell, key) => {
        if (key.startsWith("floor_")) write(key, kpis.floor_percent[Number(key.slice(6))]);
        else write(key, kpis[key]);
      });
    },
  };
}
