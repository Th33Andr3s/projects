// La sección "Despachos": las horas de corte (que se pueden cambiar), el interruptor que cierra la entrada de camiones de despacho,
// lo que está listo para el próximo corte por ciudad, el informe de cada camión que salió y la Entrega a Tiempo (OTD) con su descarga
// en CSV. Todo se lee de la simulación; lo único que se escribe es la configuración del patio (yard_config.js).

import { MAX_CUTOFFS, DEFAULT_CUTOFFS, format_cutoff, parse_cutoff } from "./cutoffs.js";
import { format_number, format_percent } from "./format.js";
import { decimal_percent, download_csv, make, make_download_menu, make_filter_bar, make_table_header, matches_search } from "./table_tools.js";

// Cuántos renglones del informe de camiones se muestran si no se piden todos (los más recientes primero); el CSV lleva todos los
// que recuerda la simulación
const ROWS_SHOWN = 80;

// Los renglones del CSV de OTD por día de entrega prometida
export function otd_day_lines(sim) {
  const report = sim.outbound.otd_report();
  const lines = [["Fecha de entrega prometida", "Pedidos entregados", "A tiempo", "Tarde: perdió su corte", "Tarde: llegó después de lo prometido", "OTD %", "Unidades"]];
  report.days.forEach((row) => lines.push([row.date, row.orders, row.on_time, row.late_shipment, row.late_arrival, decimal_percent(row.otd), row.units]));
  const totals = report.totals;
  lines.push(["Total", totals.orders, totals.on_time, report.days.reduce((sum, row) => sum + row.late_shipment, 0), report.days.reduce((sum, row) => sum + row.late_arrival, 0), decimal_percent(totals.otd), report.days.reduce((sum, row) => sum + row.units, 0)]);
  lines.push([]);
  lines.push([`Pedidos que ya perdieron su corte y siguen sin salir al descargar: ${report.pending_late}`]);
  lines.push(["OTD = pedidos entregados a tiempo / pedidos ya entregados con promesa ese día. Solo cuentan las entregas: un pedido despachado que todavía va en camino no cuenta ni a favor ni en contra. Un pedido es a tiempo si sale en el corte que le tocaba (regla de los 60 minutos) y llega al cliente antes de la hora prometida."]);
  lines.push([`Promesa = hora de corte + viaje a 55 km/h + 1 hora de tolerancia. La llegada es la hora de salida + el viaje a la velocidad promedio de ese camión (entre 45 y 65 km/h).`]);
  return lines;
}

export function otd_order_lines(sim) {
  const report = sim.outbound.otd_report();
  const lines = [["Pedido", "Ciudad", "Región", "Kilómetros", "Cajas", "Unidades", "Creado", "Corte prometido", "Salida real", "Camión", "Llegada prometida", "Llegada estimada", "Perdió su corte", "Llegó tarde", "A tiempo", "Estado"]];
  report.deliveries.forEach((delivery) =>
    lines.push([
      delivery.order_id,
      delivery.city,
      delivery.region,
      delivery.kilometers,
      delivery.boxes,
      delivery.units,
      sim.format_iso_datetime(delivery.created_at),
      sim.format_iso_datetime(delivery.promised_cutoff),
      sim.format_iso_datetime(delivery.shipped_at),
      delivery.truck_id,
      sim.format_iso_datetime(delivery.promised_at),
      sim.format_iso_datetime(delivery.arrival_at),
      delivery.late_shipment ? "Sí" : "No",
      delivery.late_arrival ? "Sí" : "No",
      delivery.on_time ? "Sí" : "No",
      // Solo los entregados cuentan para el OTD; los que van en camino son una estimación
      delivery.arrival_at <= sim.now ? "Entregado" : "En camino (no cuenta todavía)",
    ]),
  );
  return lines;
}

export function build_dispatch_panel(body, yard) {
  let current_sim = null;

  // ---------- Horas de corte ----------
  const cutoffs_card = make("section", "yard_card");
  cutoffs_card.append(make("h3", "", "Horas de corte"));
  const cutoff_list = make("ul", "cutoff_editor");
  const cutoff_controls = make("div", "cutoff_controls");
  const add_button = make("button", "text_button text_button_small");
  add_button.type = "button";
  add_button.append(make("i", "fa-solid fa-plus"), make("span", "", "Agregar corte"));
  add_button.firstChild.setAttribute("aria-hidden", "true");
  const reset_cutoffs_button = make("button", "text_button text_button_small");
  reset_cutoffs_button.type = "button";
  reset_cutoffs_button.append(make("span", "", "Horas de fábrica"));
  cutoff_controls.append(add_button, reset_cutoffs_button);
  cutoffs_card.append(
    cutoff_list,
    cutoff_controls,
    make("p", "note", "A cada hora de corte sale un camión por cada ciudad con pedidos listos. Un pedido que cae a más de 60 minutos de un corte sale en él; si cae a 60 minutos o menos, sale en el siguiente. Si no está listo a su hora, es un envío tardío y sale en el corte que sigue."),
  );

  function cutoff_signature() {
    return yard.cutoffs.join(",");
  }
  let rendered_signature = "";
  function render_cutoffs() {
    rendered_signature = cutoff_signature();
    cutoff_list.replaceChildren();
    yard.cutoffs.forEach((minutes, index) => {
      const item = make("li", "cutoff_item");
      const input = make("input", "time_input");
      input.type = "time";
      input.value = format_cutoff(minutes);
      input.setAttribute("aria-label", `Hora de corte ${index + 1}`);
      input.addEventListener("change", () => {
        const parsed = parse_cutoff(input.value);
        const next = [...yard.cutoffs];
        if (parsed === null) {
          input.value = format_cutoff(next[index]);
          return;
        }
        next[index] = parsed;
        yard.set_cutoffs(next);
        render_cutoffs();
      });
      const remove = make("button", "icon_button");
      remove.type = "button";
      remove.setAttribute("aria-label", `Quitar el corte de las ${format_cutoff(minutes)}`);
      remove.disabled = yard.cutoffs.length <= 1;
      remove.append(make("i", "fa-solid fa-xmark"));
      remove.firstChild.setAttribute("aria-hidden", "true");
      remove.addEventListener("click", () => {
        yard.set_cutoffs(yard.cutoffs.filter((_, position) => position !== index));
        render_cutoffs();
      });
      item.append(input, remove);
      cutoff_list.append(item);
    });
    add_button.disabled = yard.cutoffs.length >= MAX_CUTOFFS;
    // Con muchas horas la tarjeta ocupa todo el ancho para que no quede una columna larguísima
    cutoffs_card.classList.toggle("is_wide", yard.cutoffs.length > 6);
  }
  add_button.addEventListener("click", () => {
    // El corte nuevo arranca una hora después del último (o a las 12 si ya estaba al final del día)
    const last = yard.cutoffs[yard.cutoffs.length - 1];
    const candidate = last + 60 < 1440 ? last + 60 : 720;
    let minutes = candidate;
    while (yard.cutoffs.includes(minutes)) minutes = (minutes + 30) % 1440;
    yard.set_cutoffs([...yard.cutoffs, minutes]);
    render_cutoffs();
  });
  reset_cutoffs_button.addEventListener("click", () => {
    yard.set_cutoffs(DEFAULT_CUTOFFS);
    render_cutoffs();
  });

  // ---------- Entrada de camiones ----------
  const gate_card = make("section", "yard_card");
  gate_card.append(make("h3", "", "Entrada de camiones de despacho"));
  const gate_button = make("button", "dock_toggle gate_toggle");
  gate_button.type = "button";
  gate_button.setAttribute("role", "switch");
  const gate_name = make("strong", "", "Camiones de despacho");
  const gate_state = make("span", "dock_state");
  gate_button.append(gate_name, gate_state);
  gate_button.addEventListener("click", () => yard.set_dispatch_blocked(!yard.dispatch_blocked));
  gate_card.append(gate_button, make("p", "note", "Cerrada: no entra ningún camión a las puertas; los paquetes se quedan en su pila esperando y, al pasar su corte, los pedidos quedan como envíos tardíos. Sirve para cuando la operación está detenida."));

  // ---------- Listos para el próximo corte ----------
  const next_card = make("section", "yard_card");
  next_card.append(make("h3", "", "Próximo corte"));
  const next_line = make("p", "next_cutoff_line");
  const ready_list = make("ul", "cutoff_list");
  next_card.append(next_line, ready_list, make("p", "note", "Pedidos empacados que esperan su corte, por ciudad de destino (también están como pilas en la zona de despacho)."));

  const grid = make("div", "yard_grid");
  grid.append(cutoffs_card, gate_card, next_card);

  // ---------- Resumen ----------
  const summary = make("dl", "inventory_totals");
  const summary_cells = {};
  [
    ["cutoffs", "Cortes cumplidos"],
    ["trucks", "Camiones que salieron"],
    ["orders", "Pedidos despachados"],
    ["delivered", "Pedidos entregados al cliente"],
    ["late", "Envíos tardíos (perdieron su corte)"],
    ["otd", "OTD (entregas a tiempo)"],
    ["pending_late", "Atrasados sin salir"],
  ].forEach(([key, label]) => {
    const wrapper = make("div", "inventory_total");
    const value = make("dd", "inventory_total_value");
    wrapper.append(make("dt", "", label), value);
    summary.append(wrapper);
    summary_cells[key] = value;
  });

  // ---------- Informe de camiones y OTD ----------
  const stamp = () => (current_sim ? current_sim.format_iso_date(current_sim.now) : "corrida");
  const downloads = make_download_menu([
    { label: "KPI OTD por día (CSV)", hint: "Pedidos a tiempo y tardíos por día de entrega prometida", run: () => current_sim && download_csv(`otd_por_dia_${stamp()}.csv`, otd_day_lines(current_sim)) },
    { label: "Detalle por pedido (CSV)", hint: "Cada pedido con su corte, su salida y su llegada", run: () => current_sim && download_csv(`otd_detalle_pedidos_${stamp()}.csv`, otd_order_lines(current_sim)) },
    {
      label: "Informe de camiones (CSV)",
      hint: "Cada camión de despacho que salió, con su destino y su carga",
      run: () => {
        if (!current_sim) return;
        const lines = [["N.º", "Hora de corte", "Salida real", "Puerta", "Camión", "Destino", "Kilómetros", "Pedidos", "Pedidos tardíos", "Cajas", "Unidades"]];
        current_sim.outbound.log.forEach((row) => lines.push([row.id, row.cutoff_text, row.departed_text, row.door, row.truck_id, row.destination, row.kilometers, row.orders, row.late_orders, row.boxes, row.units]));
        download_csv(`informe_camiones_${stamp()}.csv`, lines);
      },
    },
  ]);

  // El OTD por día, en una tabla propia (el mismo cálculo del CSV)
  const otd_scroll = make("div", "table_scroll table_scroll_short");
  otd_scroll.tabIndex = 0;
  otd_scroll.setAttribute("role", "region");
  otd_scroll.setAttribute("aria-label", "Entrega a Tiempo (OTD) por día");
  const otd_table = make("table", "data_table data_table_narrow");
  const otd_head = make("thead");
  const otd_head_row = make("tr");
  ["Día de entrega prometida", "Entregados", "A tiempo", "Tarde por perder su corte", "Tarde por llegar después", "OTD", "Unidades"].forEach((text) => otd_head_row.append(make("th", "", text)));
  otd_head.append(otd_head_row);
  const otd_body = make("tbody");
  otd_table.append(otd_head, otd_body);
  otd_scroll.append(otd_table);

  // El informe de cada camión que salió, con filtros
  const filters = make_filter_bar([
    { kind: "search", label: "Buscar camión", placeholder: "Ciudad, región o número" },
    { kind: "select", label: "Mostrar", options: [["recent", `Los ${ROWS_SHOWN} más recientes`], ["all", "Todos los que salieron"]] },
    { kind: "check", label: "Solo con pedidos tardíos" },
  ]);
  const rows_note = make("p", "note filter_count");
  rows_note.setAttribute("role", "status");
  const scroll = make("div", "table_scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", "Informe de camiones de despacho");
  const table = make("table", "data_table");
  const head = make("thead");
  const head_row = make("tr");
  ["N.º", "Hora de corte", "Puerta", "Camión", "Destino", "Pedidos", "Tardíos", "Cajas", "Unidades"].forEach((text) => head_row.append(make("th", "", text)));
  head.append(head_row);
  const table_body = make("tbody");
  table.append(head, table_body);
  scroll.append(table);
  const otd_title = make("h3", "table_title", "Entrega a Tiempo (OTD) por día");
  body.append(summary, grid, make_table_header("Informe de camiones y Entrega a Tiempo (OTD)", downloads), otd_title, otd_scroll, make("h3", "table_title", "Camiones de despacho que salieron"), filters.bar, rows_note, scroll);

  render_cutoffs();

  let signature = "";
  let last_log = [];
  filters.on_change(() => {
    signature = "";
    render_rows(last_log);
  });
  function render_rows(log) {
    last_log = log;
    const [query, mode, only_late] = filters.values();
    const next_signature = `${log.length}:${log.length ? log[log.length - 1].id : 0}:${query}:${mode}:${only_late}`;
    if (next_signature === signature) return;
    signature = next_signature;
    table_body.replaceChildren();
    const matching = log.filter((entry) => matches_search(query, `${entry.destination} ${entry.id} ${entry.truck_id}`) && (!only_late || entry.late_orders > 0));
    const shown = mode === "all" ? matching : matching.slice(-ROWS_SHOWN);
    rows_note.textContent = log.length === 0 ? "" : `Mostrando ${shown.length} de ${log.length} camiones que salieron.`;
    if (shown.length === 0) {
      const row = make("tr");
      const cell = make("td", "placeholder", log.length === 0 ? "Todavía no ha salido ningún camión de despacho." : "Ningún camión cumple los filtros.");
      cell.colSpan = 9;
      row.append(cell);
      table_body.append(row);
      return;
    }
    [...shown].reverse().forEach((entry) => {
      const row = make("tr");
      row.append(
        make("td", "", String(entry.id)),
        make("td", "cell_arrival", entry.cutoff_text),
        make("td", "", String(entry.door)),
        make("td", "", String(entry.truck_id)),
        make("td", "", entry.destination),
        make("td", "", format_number(entry.orders)),
        make("td", entry.late_orders > 0 ? "cell_late" : "", format_number(entry.late_orders)),
        make("td", "", format_number(entry.boxes)),
        make("td", "", format_number(entry.units)),
      );
      table_body.append(row);
    });
  }

  let otd_signature = "";
  function render_otd(sim) {
    const delivered = sim.counters.orders_delivered;
    if (String(delivered) === otd_signature) return;
    otd_signature = String(delivered);
    const report = sim.outbound.otd_report();
    otd_body.replaceChildren();
    if (report.days.length === 0) {
      const row = make("tr");
      const cell = make("td", "placeholder", "Todavía no hay entregas: el OTD aparece cuando llegan al cliente los primeros pedidos.");
      cell.colSpan = 7;
      row.append(cell);
      otd_body.append(row);
      return;
    }
    const add = (cells, class_name = "") => {
      const row = make("tr", class_name);
      cells.forEach((text) => row.append(make("td", "", text)));
      otd_body.append(row);
    };
    report.days.forEach((day) => add([day.date, format_number(day.orders), format_number(day.on_time), format_number(day.late_shipment), format_number(day.late_arrival), day.otd === null ? "—" : format_percent(day.otd * 100), format_number(day.units)]));
    const totals = report.totals;
    add(["Total", format_number(totals.orders), format_number(totals.on_time), format_number(report.days.reduce((sum, day) => sum + day.late_shipment, 0)), format_number(report.days.reduce((sum, day) => sum + day.late_arrival, 0)), totals.otd === null ? "—" : format_percent(totals.otd * 100), format_number(report.days.reduce((sum, day) => sum + day.units, 0))], "total_row");
  }

  function set_text(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }

  let ready_signature = "";
  return {
    // Se baja el KPI OTD de la corrida actual (lo usa el diálogo de reinicio)
    download_otd(sim) {
      download_csv(`otd_por_dia_${sim.format_iso_date(sim.now)}.csv`, otd_day_lines(sim));
    },
    has_deliveries(sim) {
      return sim.outbound.deliveries.length > 0;
    },
    update(sim) {
      current_sim = sim;
      if (cutoff_signature() !== rendered_signature && !cutoff_list.contains(document.activeElement)) render_cutoffs();
      const blocked = yard.dispatch_blocked;
      gate_button.setAttribute("aria-checked", String(!blocked));
      gate_button.classList.toggle("is_blocked", blocked);
      set_text(gate_state, blocked ? "Cerrada" : "Abierta");

      const { counters } = sim;
      const report_otd = counters.orders_delivered > 0 ? counters.orders_on_time / counters.orders_delivered : null;
      set_text(summary_cells.cutoffs, format_number(counters.cutoffs_run));
      set_text(summary_cells.trucks, format_number(counters.trucks_dispatched));
      set_text(summary_cells.orders, format_number(counters.orders_dispatched));
      set_text(summary_cells.delivered, format_number(counters.orders_delivered));
      set_text(summary_cells.late, format_number(counters.late_shipments));
      set_text(summary_cells.otd, report_otd === null ? "—" : format_percent(report_otd * 100));
      set_text(summary_cells.pending_late, format_number(sim.orders.orders.filter((order) => order.late).length));

      const pending = sim.outbound.pending_summary();
      set_text(next_line, pending.next_cutoff_at === null ? "—" : `${sim.format_time(pending.next_cutoff_at)}${pending.jobs > 0 ? ` · ${pending.jobs} camiones por entrar` : ""}`);
      const next_ready = pending.bins.map((bin) => `${bin.destination.index}:${bin.parcels.length}`).join(",");
      if (next_ready !== ready_signature) {
        ready_signature = next_ready;
        ready_list.replaceChildren();
        if (pending.bins.length === 0) ready_list.append(make("li", "placeholder", "Nada listo todavía."));
        pending.bins
          .sort((first, second) => second.parcels.length - first.parcels.length)
          .slice(0, 12)
          .forEach((bin) => ready_list.append(make("li", "", `${bin.destination.city}: ${bin.parcels.length} ${bin.parcels.length === 1 ? "pedido" : "pedidos"}`)));
        if (pending.bins.length > 12) ready_list.append(make("li", "placeholder", `y ${pending.bins.length - 12} ciudades más`));
      }
      render_rows(sim.outbound.log);
      render_otd(sim);
    },
  };
}
