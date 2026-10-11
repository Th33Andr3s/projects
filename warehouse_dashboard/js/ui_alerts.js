// Avisos sobre la escena y los botones de las disrupciones. Los problemas de pedidos (bloqueos, muros llenos) salen como
// banners con `role="alert"` y un botón para cancelar el pedido; las disrupciones activas salen con `role="status"`. Cada
// banner se identifica por su clave, así que solo se agregan, cambian o quitan los que hacen falta.

import { DISRUPTION_KINDS } from "./disruptions.js";
import { format_duration } from "./format.js";

const MAX_BANNERS = 4;

const DISRUPTION_TEXTS = {
  belt_down: "Caída de banda principal: la banda está detenida y las cajas se acumulan.",
  forklift_maintenance: "Montacarga en mantenimiento: uno está en el taller.",
  order_spike: "Pico de pedidos: cinco veces más pedidos durante 2 minutos simulados.",
  delayed_truck: "Camión retrasado: el próximo camión de recibo tarda el triple en llegar.",
};

function make_button(text, on_click) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text_button text_button_small";
  button.textContent = text;
  button.addEventListener("click", on_click);
  return button;
}

export function build_alerts(container, handlers) {
  const banners = new Map();
  // Avisos que se quitan solos: la clave y el momento (ms reales) en que caducan
  const notice_expiry = new Map();

  function create_banner(key, severity, role) {
    const element = document.createElement("div");
    element.className = `alert_banner alert_${severity}`;
    element.setAttribute("role", role);
    const text = document.createElement("p");
    text.className = "alert_text";
    const countdown = document.createElement("span");
    countdown.className = "alert_countdown";
    countdown.setAttribute("aria-hidden", "true");
    const actions = document.createElement("div");
    actions.className = "alert_actions";
    element.append(text, countdown, actions);
    container.append(element);
    const banner = { element, text, countdown, actions, signature: "" };
    banners.set(key, banner);
    return banner;
  }

  function sync_banner(key, severity, role, text, countdown_text, order) {
    let banner = banners.get(key);
    if (!banner) banner = create_banner(key, severity, role);
    if (banner.text.textContent !== text) banner.text.textContent = text;
    if (banner.countdown.textContent !== countdown_text) banner.countdown.textContent = countdown_text;
    const signature = order ? `order:${order.id}` : "";
    if (banner.signature !== signature) {
      banner.signature = signature;
      banner.actions.replaceChildren();
      if (order) {
        banner.actions.append(make_button("Ver", () => handlers.on_select(order)));
        banner.actions.append(make_button("Cancelar pedido", () => handlers.on_cancel(order)));
      }
    }
    return banner;
  }

  return {
    // Un aviso breve (por ejemplo, que bajó la calidad de las sombras) que desaparece solo
    notice(text, expires_at) {
      const key = `notice:${text}`;
      sync_banner(key, "info", "status", text, "", null);
      notice_expiry.set(key, expires_at);
    },
    update(sim, now_milliseconds) {
      const wanted = new Set();
      notice_expiry.forEach((expires_at, key) => {
        if (now_milliseconds < expires_at) wanted.add(key);
        else notice_expiry.delete(key);
      });
      const problems = sim.alerts;
      problems.slice(0, MAX_BANNERS).forEach((alert) => {
        const order = alert.order_id === undefined ? null : sim.orders.orders.find((candidate) => candidate.id === alert.order_id) || null;
        sync_banner(`alert:${alert.key}`, alert.severity, "alert", alert.text, "", order);
        wanted.add(`alert:${alert.key}`);
      });
      if (problems.length > MAX_BANNERS) {
        const extra = problems.length - MAX_BANNERS;
        sync_banner("alert:more", "warn", "status", `Y ${extra} ${extra === 1 ? "aviso más" : "avisos más"}: mira la lista de Inspección.`, "", null);
        wanted.add("alert:more");
      }
      DISRUPTION_KINDS.forEach((kind) => {
        if (!sim.disruptions.is_active(kind)) return;
        const remaining = kind === "order_spike" ? `Quedan ${format_duration(sim.disruptions.spike_remaining(sim.now))}` : "";
        sync_banner(`disruption:${kind}`, "info", "status", DISRUPTION_TEXTS[kind], remaining, null);
        wanted.add(`disruption:${kind}`);
      });
      banners.forEach((banner, key) => {
        if (wanted.has(key)) return;
        banner.element.remove();
        banners.delete(key);
      });
    },
    // Cuando se reinicia la simulación se limpian los avisos viejos
    clear() {
      banners.forEach((banner) => banner.element.remove());
      banners.clear();
      notice_expiry.clear();
    },
  };
}

// Los cuatro botones de disrupciones: se activan y se desactivan, y reflejan el estado de la simulación
export function build_disruptions(container, handlers) {
  const buttons = new Map();
  container.querySelectorAll("[data-disruption]").forEach((button) => {
    buttons.set(button.dataset.disruption, button);
    button.addEventListener("click", () => handlers.on_toggle(button.dataset.disruption));
  });
  return {
    update(sim) {
      buttons.forEach((button, kind) => {
        const active = sim.disruptions.is_active(kind);
        if (button.getAttribute("aria-pressed") !== String(active)) button.setAttribute("aria-pressed", String(active));
      });
    },
  };
}
