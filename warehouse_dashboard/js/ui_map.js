// La sección "Mapa de despachos": un mapa esquemático de Colombia con los camiones de despacho que van en camino, su recorrido hasta la
// ciudad del cliente y una tabla con lo que lleva cada uno y cuándo llega. El camión avanza por la línea de su ruta según el tiempo
// simulado: sale a la hora de su corte y llega a las horas de viaje que da su velocidad (entre 45 y 65 km/h) para los kilómetros de
// carretera. Cuando llega, deja el mapa y la tabla (queda en el histórico de posiciones, que se descarga completo en CSV). El mapa se
// acerca y se aleja con los botones, con Ctrl y la rueda, o con + y − (con el mapa enfocado), y se mueve arrastrándolo. Cada camión del
// mapa se alcanza con Tab, se pasa de uno a otro con las flechas y se elige con Enter o Espacio (la tabla de al lado es el otro camino).
// Las líneas son esquemáticas (pasan por ciudades intermedias, no son las carreteras reales); los kilómetros y los tiempos sí son los
// de carretera. Todo se lee de la simulación.

import { REGIONS, SKUS, CD_CITY } from "./catalog.js";
import { format_number } from "./format.js";
import { MAP_HEIGHT, MAP_WIDTH, city_point, mapped_cities, outline_points, position_at, route_of, track_interval, trip_track } from "./colombia_map.js";
import { download_csv, make, make_download_menu, make_filter_bar, make_table_header, matches_search } from "./table_tools.js";

const SVG_NS = "http://www.w3.org/2000/svg";
// Cuántos camiones se listan como máximo
const ROWS_SHOWN = 60;
// Las ciudades con nombre en el mapa aunque no haya camiones: las más grandes (por su peso de pedidos)
const LABELLED_WEIGHT = 5;
// Cuánto se puede acercar el mapa y cuánto cambia cada paso
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.5;
// Tamaños (en unidades del dibujo, con el mapa sin acercar) de los puntos y las letras
const TRUCK_RADIUS = 5.5;
const TRUCK_RADIUS_SELECTED = 8;
const CITY_RADIUS = 3.2;
const ORIGIN_RADIUS = 6;
const LABEL_SIZE = 11;

function svg(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
  return element;
}

// "3 h 20 min" o "45 min"
function format_travel(seconds) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

function make_icon_button(label, icon_name) {
  const button = make("button", "icon_button map_zoom_button");
  button.type = "button";
  button.setAttribute("aria-label", label);
  const icon = make("i", `fa-solid ${icon_name}`);
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);
  return button;
}

export function build_map_panel(body) {
  const region_color = (destination) => REGIONS[destination.region_index].color;
  const weights = new Map(REGIONS.flatMap((region) => region.cities.map(([city, , weight]) => [city, weight])));
  let current_sim = null;

  // ---------- Encabezado con la descarga ----------
  const downloads = make_download_menu([
    {
      label: "Histórico de posiciones completo (CSV)",
      hint: "Todos los camiones de despacho que han salido: su posición (latitud y longitud) cada 15 a 60 minutos, de la salida a la llegada",
      run: () => current_sim && download_gps_history(current_sim, false),
    },
    {
      label: "Solo los que van en camino (CSV)",
      hint: "La posición de los camiones en ruta ahora, desde que salieron",
      run: () => current_sim && download_gps_history(current_sim, true),
    },
  ]);

  // ---------- Esqueleto ----------
  const filters = make_filter_bar([{ kind: "search", label: "Buscar camión", placeholder: "Ciudad, región o número" }]);
  const count_note = make("p", "note filter_count");
  count_note.setAttribute("role", "status");
  const layout = make("div", "map_layout");

  const map_card = make("div", "map_card");
  const canvas = svg("svg", {
    viewBox: `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`,
    class: "map_svg",
    // "group" y no "img": los camiones que contiene son botones y un lector de pantalla debe poder llegar a ellos
    role: "group",
    tabindex: "0",
    "aria-label": "Mapa esquemático de Colombia con los camiones de despacho en camino. Con el mapa enfocado, más y menos lo acercan y las flechas lo mueven; con Tab llegas a los camiones. La tabla de al lado tiene la misma información.",
  });
  const land = svg("polygon", { class: "map_land", points: outline_points().map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ") });
  const routes_layer = svg("g", { class: "map_routes" });
  const cities_layer = svg("g", { class: "map_cities" });
  const trucks_layer = svg("g", { class: "map_trucks" });
  canvas.append(land, routes_layer, cities_layer, trucks_layer);

  const zoom_bar = make("div", "map_zoom_bar");
  zoom_bar.setAttribute("role", "group");
  zoom_bar.setAttribute("aria-label", "Zoom del mapa");
  const zoom_in = make_icon_button("Acercar el mapa", "fa-plus");
  const zoom_out = make_icon_button("Alejar el mapa", "fa-minus");
  const zoom_reset = make_icon_button("Ver todo el mapa", "fa-expand");
  zoom_bar.append(zoom_in, zoom_out, zoom_reset);
  const stage = make("div", "map_stage");
  stage.append(canvas, zoom_bar);
  map_card.append(stage, make("p", "note", "Las líneas son esquemáticas: pasan por ciudades intermedias, no son las carreteras reales. Los kilómetros y los tiempos sí son los de carretera. Ctrl + rueda acerca; arrastra para mover. Con el teclado: Tab llega a los camiones, las flechas pasan de uno a otro y Enter o Espacio lo elige."));

  // Las ciudades: un punto cada una, con nombre las grandes y la del destino elegido
  const city_labels = new Map();
  const city_dots = [];
  mapped_cities().forEach((city) => {
    const point = city_point(city);
    const is_origin = city === CD_CITY;
    const dot = svg("circle", { cx: point.x, cy: point.y, class: is_origin ? "map_origin" : "map_city" });
    dot.dataset.radius = String(is_origin ? ORIGIN_RADIUS : CITY_RADIUS);
    city_dots.push(dot);
    cities_layer.append(dot);
    const label = svg("text", { x: point.x, y: point.y, class: "map_label" });
    label.dataset.dx = String(is_origin ? 9 : 6);
    label.dataset.dy = "4";
    label.textContent = city;
    city_labels.set(city, label);
    cities_layer.append(label);
  });

  const side = make("div", "map_side");
  const scroll = make("div", "table_scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", "Camiones de despacho en camino");
  const table = make("table", "data_table data_table_narrow");
  const head = make("thead");
  const head_row = make("tr");
  ["Camión", "Destino", "Recorrido", "Llega"].forEach((text) => head_row.append(make("th", "", text)));
  head.append(head_row);
  const table_body = make("tbody");
  table.append(head, table_body);
  scroll.append(table);
  const detail = make("section", "yard_card map_detail");
  detail.setAttribute("aria-live", "polite");
  side.append(scroll, detail);
  layout.append(map_card, side);
  body.append(make_table_header("Camiones de despacho en camino", downloads), filters.bar, count_note, layout);

  // ---------- Zoom y arrastre ----------
  const view = { zoom: 1, cx: MAP_WIDTH / 2, cy: MAP_HEIGHT / 2 };

  function labels_visible() {
    city_labels.forEach((label, city) => {
      const always = city === CD_CITY || (weights.get(city) || 0) >= LABELLED_WEIGHT || view.zoom >= 2.5;
      const chosen = selected_city === city;
      label.style.display = always || chosen ? "" : "none";
    });
  }

  // Con el mapa acercado, los puntos y las letras conservan su tamaño en pantalla (se achican en el dibujo)
  function apply_view() {
    const width = MAP_WIDTH / view.zoom;
    const height = MAP_HEIGHT / view.zoom;
    view.cx = Math.min(MAP_WIDTH - width / 2, Math.max(width / 2, view.cx));
    view.cy = Math.min(MAP_HEIGHT - height / 2, Math.max(height / 2, view.cy));
    canvas.setAttribute("viewBox", `${(view.cx - width / 2).toFixed(2)} ${(view.cy - height / 2).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)}`);
    city_dots.forEach((dot) => dot.setAttribute("r", (Number(dot.dataset.radius) / view.zoom).toFixed(2)));
    city_labels.forEach((label) => {
      const size = LABEL_SIZE / view.zoom;
      label.setAttribute("font-size", size.toFixed(2));
      label.setAttribute("x", (city_point(label.textContent).x + Number(label.dataset.dx) / view.zoom).toFixed(2));
      label.setAttribute("y", (city_point(label.textContent).y + Number(label.dataset.dy) / view.zoom).toFixed(2));
    });
    markers.forEach((marker, id) => marker.dot.setAttribute("r", ((id === selected_id ? TRUCK_RADIUS_SELECTED : TRUCK_RADIUS) / view.zoom).toFixed(2)));
    labels_visible();
    zoom_in.disabled = view.zoom >= MAX_ZOOM - 1e-9;
    zoom_out.disabled = view.zoom <= MIN_ZOOM + 1e-9;
    stage.classList.toggle("is_zoomed", view.zoom > 1);
  }

  // Acerca o aleja manteniendo fijo el punto del dibujo `(x, y)` (el centro si no se da)
  function zoom_to(next_zoom, x = view.cx, y = view.cy) {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next_zoom));
    const ratio = view.zoom / zoom;
    view.cx = x + (view.cx - x) * ratio;
    view.cy = y + (view.cy - y) * ratio;
    view.zoom = zoom;
    apply_view();
  }

  // De un punto de la pantalla (relativo al mapa) a uno del dibujo
  function to_drawing(client_x, client_y) {
    const rect = canvas.getBoundingClientRect();
    const width = MAP_WIDTH / view.zoom;
    const height = MAP_HEIGHT / view.zoom;
    // El dibujo se centra y conserva su proporción dentro del lienzo
    const scale = Math.min(rect.width / width, rect.height / height);
    const left = rect.left + (rect.width - width * scale) / 2;
    const top = rect.top + (rect.height - height * scale) / 2;
    return { x: view.cx - width / 2 + (client_x - left) / scale, y: view.cy - height / 2 + (client_y - top) / scale, scale };
  }

  zoom_in.addEventListener("click", () => zoom_to(view.zoom * ZOOM_STEP));
  zoom_out.addEventListener("click", () => zoom_to(view.zoom / ZOOM_STEP));
  zoom_reset.addEventListener("click", () => {
    view.cx = MAP_WIDTH / 2;
    view.cy = MAP_HEIGHT / 2;
    zoom_to(1);
  });
  // La rueda sola baja la página; con Ctrl (o el gesto de pellizcar del trackpad) acerca el mapa
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const point = to_drawing(event.clientX, event.clientY);
      zoom_to(view.zoom * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), point.x, point.y);
    },
    { passive: false },
  );
  canvas.addEventListener("keydown", (event) => {
    const step = 40 / view.zoom;
    if (event.key === "+" || event.key === "=") zoom_to(view.zoom * ZOOM_STEP);
    else if (event.key === "-" || event.key === "_") zoom_to(view.zoom / ZOOM_STEP);
    else if (event.key === "0") zoom_reset.click();
    else if (event.key === "ArrowLeft") view.cx -= step;
    else if (event.key === "ArrowRight") view.cx += step;
    else if (event.key === "ArrowUp") view.cy -= step;
    else if (event.key === "ArrowDown") view.cy += step;
    else return;
    event.preventDefault();
    apply_view();
  });
  // Arrastrar mueve el mapa (solo tiene sentido acercado)
  let drag = null;
  // Soltar el botón después de arrastrar no cuenta como un clic sobre un camión
  let suppress_click = false;
  canvas.addEventListener("pointerdown", (event) => {
    if (view.zoom <= 1 || event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, cx: view.cx, cy: view.cy, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const scale = to_drawing(0, 0).scale;
    if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 3) drag.moved = true;
    view.cx = drag.cx - (event.clientX - drag.x) / scale;
    view.cy = drag.cy - (event.clientY - drag.y) / scale;
    apply_view();
  });
  const end_drag = (event) => {
    if (!drag) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (drag.moved) {
      suppress_click = true;
      window.setTimeout(() => {
        suppress_click = false;
      }, 0);
    }
    drag = null;
  };
  canvas.addEventListener("pointerup", end_drag);
  canvas.addEventListener("pointercancel", end_drag);

  // ---------- Camiones del mapa con teclado ----------
  // Si el camión enfocado quedó fuera de la parte visible del mapa acercado, el mapa se centra en él
  function reveal_marker(trip_id) {
    const marker = markers.get(trip_id);
    if (!marker || !marker.point || view.zoom <= 1) return;
    const half_width = MAP_WIDTH / view.zoom / 2;
    const half_height = MAP_HEIGHT / view.zoom / 2;
    if (Math.abs(marker.point.x - view.cx) > half_width * 0.85 || Math.abs(marker.point.y - view.cy) > half_height * 0.85) {
      view.cx = marker.point.x;
      view.cy = marker.point.y;
      apply_view();
    }
  }

  // Enter o Espacio eligen el camión; las flechas, Inicio y Fin pasan al otro (en el orden de la tabla)
  function handle_truck_key(event, trip_id) {
    const ids = [...rows.keys()];
    const index = ids.indexOf(trip_id);
    let target = null;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      select(trip_id);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") target = ids[Math.min(ids.length - 1, index + 1)];
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") target = ids[Math.max(0, index - 1)];
    else if (event.key === "Home") target = ids[0];
    else if (event.key === "End") target = ids[ids.length - 1];
    else return;
    // Con un camión enfocado las flechas lo recorren a él, no mueven el mapa
    event.preventDefault();
    event.stopPropagation();
    if (target === undefined || target === trip_id) return;
    markers.forEach((marker, id) => marker.group.setAttribute("tabindex", id === target ? "0" : "-1"));
    markers.get(target).group.focus({ preventScroll: true });
  }

  // ---------- Estado ----------
  let selected_id = null;
  let selected_city = null;
  let rows = new Map();
  let markers = new Map();
  let route_lines = new Map();
  let signature = "";

  filters.on_change(() => {
    signature = "";
    if (current_sim) update(current_sim);
  });

  // Los camiones que van en camino ahora (los que ya llegaron salen del mapa y de la tabla)
  function in_route(sim) {
    const now = sim.now;
    const [query] = filters.values();
    return sim.outbound.trips
      .filter((trip) => now < trip.arrival_at && matches_search(query, `${trip.truck_id} ${trip.destination.text} ${trip.destination.region}`))
      .sort((first, second) => second.departed_at - first.departed_at);
  }

  function progress_of(trip, now) {
    return Math.min(1, Math.max(0, (now - trip.departed_at) / Math.max(1, trip.arrival_at - trip.departed_at)));
  }

  // ---------- Histórico de posiciones ----------
  function download_gps_history(sim, only_in_route) {
    const now = sim.now;
    const trips = only_in_route ? sim.outbound.trips.filter((trip) => now < trip.arrival_at) : sim.outbound.trips;
    const interval = track_interval(trips, now);
    const header = ["Viaje", "Camión", "Destino", "Región", "Momento simulado", "Latitud", "Longitud", "Km recorridos", "Km restantes", "Estado", "Velocidad (km/h)"];
    function* rows_of() {
      yield header;
      for (const trip of trips) {
        for (const point of trip_track(trip, now, interval)) {
          const done = point.time >= trip.arrival_at;
          yield [
            trip.id,
            trip.truck_id,
            trip.destination.city,
            trip.destination.region,
            sim.format_iso_datetime(point.time),
            point.latitude.toFixed(5).replace(".", ","),
            point.longitude.toFixed(5).replace(".", ","),
            Math.round(point.traveled),
            Math.round(point.remaining),
            done ? "Entregado" : "En ruta",
            Math.round(trip.speed_kmh),
          ];
        }
      }
      yield [];
      yield [`Una posición cada ${interval / 60} minutos simulados desde la salida de cada camión hasta su llegada (o hasta ahora, si va en ruta). Posiciones esquemáticas: se reparten a lo largo de una línea que pasa por ciudades intermedias, no por las carreteras reales. Los kilómetros y las horas sí son los de carretera.`];
    }
    download_csv(`${only_in_route ? "gps_en_camino" : "gps_historico"}_${sim.format_iso_date(now)}.csv`, rows_of());
  }

  // ---------- Tabla ----------
  function make_row(trip) {
    const row = make("tr");
    const cells = {};
    const button_cell = make("td");
    const button = make("button", "list_button map_row_button", `Camión ${trip.truck_id}`);
    button.type = "button";
    button.addEventListener("click", () => select(trip.id));
    button_cell.append(button);
    cells.button = button;
    row.append(button_cell);
    const add = (key, text) => {
      cells[key] = make("td", "", text);
      row.append(cells[key]);
    };
    add("destination", trip.destination.text);
    add("progress", "");
    add("arrival", "");
    return { row, cells };
  }

  function set_text(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }

  function trip_flag(trip) {
    const late = trip.late_shipments + trip.late_arrivals;
    return late > 0 ? ` · ${late} ${late === 1 ? "pedido tardío" : "pedidos tardíos"}` : "";
  }

  // ---------- Detalle ----------
  function render_detail(sim) {
    const trip = sim.outbound.trips.find((candidate) => candidate.id === selected_id);
    detail.replaceChildren();
    detail.append(make("h3", "", "Camión elegido"));
    if (!trip || sim.now >= trip.arrival_at) {
      detail.append(make("p", "placeholder", "Elige un camión de la tabla o del mapa para ver sus datos."));
      return;
    }
    const now = sim.now;
    const fraction = progress_of(trip, now);
    const rows_data = [
      ["Camión", String(trip.truck_id)],
      ["Destino", trip.destination.text],
      ["Salió", `${sim.format_time(trip.departed_at)} (corte de las ${trip.cutoff_text.split(", ").pop()})`],
      ["Velocidad", `${Math.round(trip.speed_kmh)} km/h`],
      ["Kilómetros", `${format_number(Math.round(trip.kilometers * fraction))} recorridos de ${format_number(trip.kilometers)}; faltan ${format_number(Math.round(trip.kilometers * (1 - fraction)))}`],
      ["Llega al cliente", `${sim.format_time(trip.arrival_at)} (en ${format_travel(trip.arrival_at - now)})`],
      ["Pedidos", `${format_number(trip.orders)}${trip_flag(trip)}`],
      ["Cajas y unidades", `${format_number(trip.boxes)} cajas, ${format_number(trip.units)} unidades`],
      ["Mercancía", trip.products.map((product) => `${SKUS[product.sku_id].name}: ${format_number(product.boxes)} ${product.boxes === 1 ? "caja" : "cajas"}`).join(" · ")],
    ];
    const list = make("dl", "detail_list");
    rows_data.forEach(([label, value]) => {
      const wrapper = make("div");
      wrapper.append(make("dt", "", label), make("dd", "", value));
      list.append(wrapper);
    });
    detail.append(list);
  }

  function select(trip_id) {
    selected_id = selected_id === trip_id ? null : trip_id;
    signature = "";
    if (current_sim) update(current_sim);
  }

  // ---------- Un cuadro ----------
  function update(sim) {
    current_sim = sim;
    const now = sim.now;
    const all = in_route(sim);
    const trips = all.slice(0, ROWS_SHOWN);
    if (selected_id !== null && !all.some((trip) => trip.id === selected_id)) selected_id = null;
    selected_city = selected_id === null ? null : (all.find((trip) => trip.id === selected_id) || { destination: { city: null } }).destination.city;
    const next_signature = `${trips.map((trip) => trip.id).join(",")}|${selected_id}`;
    if (next_signature !== signature) {
      signature = next_signature;
      // Se redibujan la tabla, las rutas y los camiones del mapa; si la persona estaba en un camión del mapa con el teclado, el foco vuelve a él
      const focused_entry = [...markers].find(([, marker]) => marker.group === document.activeElement);
      const refocus_id = focused_entry ? focused_entry[0] : null;
      rows = new Map();
      table_body.replaceChildren();
      markers.forEach((marker) => marker.group.remove());
      markers = new Map();
      route_lines.forEach((line) => line.remove());
      route_lines = new Map();
      trips.forEach((trip) => {
        const made = make_row(trip);
        made.row.classList.toggle("is_selected", trip.id === selected_id);
        made.cells.button.setAttribute("aria-pressed", String(trip.id === selected_id));
        rows.set(trip.id, made);
        table_body.append(made.row);
        const city = trip.destination.city;
        if (!route_lines.has(city)) {
          const route = route_of(city);
          if (route) {
            const line = svg("polyline", { class: "map_route", points: route.points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ") });
            route_lines.set(city, line);
            routes_layer.append(line);
          }
        }
      });
      if (trips.length === 0) {
        const row = make("tr");
        const cell = make("td", "placeholder", sim.outbound.trips.length === 0 ? "Todavía no ha salido ningún camión de despacho. Salen en las horas de corte." : "No hay camiones en camino con ese filtro.");
        cell.colSpan = 4;
        row.append(cell);
        table_body.append(row);
      }
      // Los camiones se dibujan de atrás hacia adelante: el elegido queda encima
      // Un solo camión del mapa entra en el orden de Tab (el elegido o el primero); entre los demás se pasa con las flechas
      const tab_id = trips.some((trip) => trip.id === selected_id) ? selected_id : trips.length > 0 ? trips[0].id : null;
      [...trips].reverse().forEach((trip) => {
        const group = svg("g", {
          class: "map_truck",
          role: "button",
          tabindex: trip.id === tab_id ? "0" : "-1",
          "aria-label": `Camión ${trip.truck_id} a ${trip.destination.text}`,
          "aria-pressed": String(trip.id === selected_id),
        });
        const dot = svg("circle", { class: "map_truck_dot", r: ((trip.id === selected_id ? TRUCK_RADIUS_SELECTED : TRUCK_RADIUS) / view.zoom).toFixed(2) });
        dot.setAttribute("fill", region_color(trip.destination));
        const title = svg("title");
        title.textContent = `Camión ${trip.truck_id} a ${trip.destination.text}`;
        group.append(dot, title);
        group.addEventListener("click", () => {
          if (!suppress_click) select(trip.id);
        });
        group.addEventListener("keydown", (event) => handle_truck_key(event, trip.id));
        group.addEventListener("focus", () => reveal_marker(trip.id));
        markers.set(trip.id, { group, dot, point: null });
        trucks_layer.append(group);
      });
      labels_visible();
      render_detail(sim);
      if (refocus_id !== null && markers.has(refocus_id)) markers.get(refocus_id).group.focus({ preventScroll: true });
    }
    // Lo que cambia con el tiempo: dónde va cada camión, cuánto lleva y cuándo llega
    trips.forEach((trip) => {
      const fraction = progress_of(trip, now);
      const marker = markers.get(trip.id);
      const point = position_at(trip.destination.city, fraction);
      if (marker && point) {
        marker.point = point;
        marker.group.setAttribute("transform", `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`);
        marker.group.classList.toggle("is_late", trip.late_shipments + trip.late_arrivals > 0);
      }
      const made = rows.get(trip.id);
      if (!made) return;
      set_text(made.cells.progress, `${format_number(Math.round(trip.kilometers * fraction))} de ${format_number(trip.kilometers)} km`);
      set_text(made.cells.arrival, `${sim.format_time(trip.arrival_at)} (en ${format_travel(trip.arrival_at - now)})`);
    });
    set_text(count_note, all.length > trips.length ? `Mostrando ${trips.length} de ${all.length} camiones en camino.` : `${all.length} ${all.length === 1 ? "camión en camino" : "camiones en camino"}.`);
    // El detalle del camión elegido sigue al tiempo
    if (selected_id !== null) render_detail(sim);
  }

  apply_view();

  return {
    update,
    // Al reiniciar la simulación los viajes anteriores dejan de existir
    reset() {
      selected_id = null;
      selected_city = null;
      signature = "";
      current_sim = null;
      rows = new Map();
      table_body.replaceChildren();
      markers.forEach((marker) => marker.group.remove());
      markers = new Map();
      route_lines.forEach((line) => line.remove());
      route_lines = new Map();
    },
  };
}
