// El panel de parámetros: un slider por cada valor de PARAMETERS, agrupados por sección. Cada cambio se aplica al instante en
// la simulación (salvo los del inicio, que esperan al reinicio) y el panel sigue a Config cuando el valor cambia por otro lado,
// por ejemplo con "Valores de fábrica" o al cargar lo guardado.

import { PARAMETERS, PARAMETER_GROUPS } from "./config.js";
import { format_parameter_value } from "./format.js";

export function build_params_panel(config, body, handlers) {
  const controls = new Map();

  PARAMETER_GROUPS.forEach((group) => {
    const section = document.createElement("section");
    section.className = "param_group";
    const title = document.createElement("h3");
    title.textContent = group.label;
    section.append(title);

    PARAMETERS.filter((parameter) => parameter.group === group.key).forEach((parameter) => {
      const row = document.createElement("div");
      row.className = "param_row";
      const id = `param_${parameter.key}`;

      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = parameter.label;
      const output = document.createElement("output");
      output.htmlFor = id;
      output.className = "param_value";
      label.append(output);

      const input = document.createElement("input");
      input.type = "range";
      input.id = id;
      input.min = String(parameter.min);
      input.max = String(parameter.max);
      input.step = String(parameter.step);
      input.className = "param_slider";

      const show = (value) => {
        input.value = String(value);
        const text = format_parameter_value(parameter, value);
        output.textContent = text;
        input.setAttribute("aria-valuetext", text);
      };
      show(config.get(parameter.key));

      input.addEventListener("input", () => {
        config.set(parameter.key, Number(input.value));
        // Un slider que se ajusta al paso o al rango debe mostrar el valor que quedó
        show(config.get(parameter.key));
        if (parameter.needs_restart) handlers.on_needs_restart(parameter);
      });

      row.append(label, input);
      if (parameter.needs_restart) {
        const note = document.createElement("p");
        note.className = "param_note";
        note.textContent = "Se aplica al reiniciar.";
        row.append(note);
      }
      section.append(row);
      controls.set(parameter.key, show);
    });
    body.append(section);
  });

  // Cuando un valor cambia sin pasar por el slider (valores de fábrica, carga de lo guardado), el slider lo refleja
  config.subscribe((key, value) => {
    const show = controls.get(key);
    if (show) show(value);
  });
}
