// El panel de inspección: el detalle de lo elegido (con el botón de cancelar si es de un pedido), la lista de pedidos con
// problema y la lista de todo lo que hay en la bodega con su buscador. La lista es el equivalente accesible del clic en la
// escena: con teclado o lector de pantalla se llega a lo mismo.

import { filter_entities, list_entities, MAX_LIST_ITEMS } from "./entity_index.js";

function make_button(text, class_name, on_click) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = class_name;
  button.textContent = text;
  button.addEventListener("click", on_click);
  return button;
}

// Cuántos pedidos con problema se listan como máximo
const MAX_PROBLEMS_SHOWN = 30;

export function build_inspector(elements, handlers) {
  const { details, problem_list, problem_empty, search, group, count, list } = elements;
  let selected = null;
  let details_signature = "";
  let field_values = [];
  let problem_signature = "";
  let all_items = [];

  // ---------- Detalle de lo elegido ----------
  function order_of(entity) {
    return entity.kind === "order" ? entity : entity.order || null;
  }

  function render_details(info, entity) {
    details.replaceChildren();
    field_values = [];
    const title = document.createElement("h4");
    title.textContent = info.id_text;
    const fields = document.createElement("dl");
    fields.className = "detail_list";
    const rows = [["Tipo", info.type], ["Estado", info.state], ["Destino", info.destination], ["Pedido asociado", info.order], ["Tiempo en el estado", info.time_in_state], ...info.extra];
    rows.forEach(([label, value]) => {
      const wrapper = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = value;
      wrapper.append(term, description);
      fields.append(wrapper);
      field_values.push(description);
    });
    details.append(title, fields);

    const order = order_of(entity);
    const actions = document.createElement("div");
    actions.className = "detail_actions";
    if (order && entity !== order) actions.append(make_button(`Ver el pedido #${order.id}`, "text_button", () => handlers.on_select(order)));
    if (order && order.is_cancellable) {
      actions.append(make_button("Cancelar pedido", "text_button text_button_danger", () => handlers.on_cancel(order)));
    }
    if (actions.children.length > 0) details.append(actions);
  }

  function update_details(now) {
    if (!selected) return;
    const info = selected.get_info(now);
    const order = order_of(selected);
    const signature = `${selected.kind}:${selected.id}|${info.extra.map((row) => row[0]).join(",")}|${Boolean(order)}|${order ? order.is_cancellable : ""}|${order ? order.id : ""}`;
    if (signature !== details_signature) {
      details_signature = signature;
      render_details(info, selected);
      return;
    }
    const rows = [info.type, info.state, info.destination, info.order, info.time_in_state, ...info.extra.map((row) => row[1])];
    rows.forEach((value, index) => {
      if (field_values[index] && field_values[index].textContent !== value) field_values[index].textContent = value;
    });
  }

  function show(entity, now) {
    selected = entity;
    details_signature = "";
    if (!entity) {
      details.replaceChildren();
      const note = document.createElement("p");
      note.className = "placeholder";
      note.textContent = "Elige algo en la escena o en la lista de abajo.";
      details.append(note);
      return;
    }
    update_details(now);
    highlight_selected();
  }

  // ---------- Pedidos con problema ----------
  function update_problems(sim) {
    const alerts = sim.alerts.filter((alert) => alert.order_id !== undefined);
    const signature = `${alerts.length}|${alerts.slice(0, MAX_PROBLEMS_SHOWN).map((alert) => `${alert.key}:${alert.text}`).join("|")}`;
    if (signature === problem_signature) return;
    problem_signature = signature;
    problem_list.replaceChildren();
    problem_empty.hidden = alerts.length > 0;
    // Con muchos pedidos con problema solo se listan los primeros (la cancelación masiva los atiende a todos)
    alerts.slice(0, MAX_PROBLEMS_SHOWN).forEach((alert) => {
      const order = sim.orders.orders.find((candidate) => candidate.id === alert.order_id);
      if (!order) return;
      const item = document.createElement("li");
      item.className = "problem_item";
      const text = document.createElement("p");
      text.textContent = alert.text;
      const actions = document.createElement("div");
      actions.className = "detail_actions";
      actions.append(make_button("Ver", "text_button", () => handlers.on_select(order)));
      actions.append(make_button("Cancelar pedido", "text_button text_button_danger", () => handlers.on_cancel(order)));
      item.append(text, actions);
      problem_list.append(item);
    });
  }

  // ---------- Lista de todo lo que hay ----------
  function highlight_selected() {
    list.querySelectorAll("button[data-key]").forEach((button) => {
      const is_selected = Boolean(selected) && button.dataset.key === `${selected.kind}:${selected.id}`;
      if (is_selected) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
  }

  function render_list() {
    const items = group.value === "" ? all_items : all_items.filter((entry) => entry.group === group.value);
    const { shown, total } = filter_entities(items, search.value, MAX_LIST_ITEMS);
    list.replaceChildren();
    let current_group = null;
    shown.forEach((entry) => {
      if (entry.group !== current_group) {
        current_group = entry.group;
        const heading = document.createElement("li");
        heading.className = "list_heading";
        heading.textContent = entry.group;
        list.append(heading);
      }
      const item = document.createElement("li");
      const button = make_button(`${entry.label} — ${entry.state}`, "list_button", () => handlers.on_select(entry.entity));
      button.dataset.key = `${entry.entity.kind}:${entry.entity.id}`;
      item.append(button);
      list.append(item);
    });
    count.textContent = total > shown.length ? `Mostrando ${shown.length} de ${total}. Escribe para afinar la búsqueda.` : `${total} ${total === 1 ? "resultado" : "resultados"}.`;
    highlight_selected();
  }

  function refresh_list(sim, force = false) {
    // Si el foco está dentro de la lista no se redibuja: quien navega con teclado perdería el lugar
    if (!force && list.contains(document.activeElement)) return;
    all_items = list_entities(sim);
    // La lista de tipos sigue a lo que hay: si el elegido ya no existe, vuelve a "Todos"
    const groups = [...new Set(all_items.map((entry) => entry.group))];
    const signature = groups.join("|");
    if (group.dataset.signature !== signature) {
      const chosen = group.value;
      group.dataset.signature = signature;
      group.replaceChildren();
      [["", "Todos los tipos"], ...groups.map((name) => [name, name])].forEach(([value, text]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        group.append(option);
      });
      group.value = groups.includes(chosen) ? chosen : "";
    }
    render_list();
  }

  search.addEventListener("input", () => render_list());
  group.addEventListener("change", () => render_list());

  return {
    show,
    update(sim) {
      update_details(sim.now);
      update_problems(sim);
    },
    refresh_list,
    get selected() {
      return selected;
    },
  };
}
