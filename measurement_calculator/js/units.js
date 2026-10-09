// Tabla de magnitudes y unidades, y la conversión entre ellas. Es solo datos y matemática: no toca la pantalla.
//
// Cómo se convierte: cada magnitud tiene una unidad base y cada unidad sabe pasar un valor suyo a la base
// (to_base) y de la base a ella (from_base). Convertir es llevar el valor a la base y de ahí a la unidad destino.
// Las unidades proporcionales lo hacen con un factor; la temperatura, que no es proporcional (0 °C no es 0 °F),
// con fórmulas propias. Agregar una unidad es agregar una línea a su magnitud.
//
// Los factores salen de la definición oficial de cada unidad (por ejemplo, 1 pulgada = 0,0254 m exactos).
// Las claves de las magnitudes son las mismas que lleva cada pestaña en data-magnitude del index.html.

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Unidad proporcional: factor = cuántas unidades base vale una de ellas.
// - singular y plural: para escribir la frase ("1 metro", "12 metros").
// - symbol: lo que se ve junto al resultado; null si no hay un símbolo conocido (entonces se usa la palabra).
// - name: cómo aparece en la lista; note: aclaración opcional que se añade entre paréntesis.
function unit(key, singular, plural, symbol, factor, { name = capitalize(singular), note = "" } = {}) {
  return {
    key,
    singular,
    plural,
    symbol,
    name,
    note,
    zero_tolerance: 0,
    to_base: (value) => value * factor,
    from_base: (base_value) => base_value / factor,
  };
}

// Cómo se muestra la unidad en una lista desplegable: "Kilómetro (km)", "Gibibyte (GiB, ×1024)".
export function get_unit_label(unit_item) {
  if (!unit_item.symbol) return unit_item.name;
  return `${unit_item.name} (${unit_item.symbol}${unit_item.note ? `, ${unit_item.note}` : ""})`;
}

// Lo que se escribe junto a un número: el símbolo, o la palabra (en singular o plural) si no hay símbolo.
export function get_unit_text(unit_item, amount) {
  if (unit_item.symbol) return unit_item.symbol;
  return Math.abs(amount) === 1 ? unit_item.singular : unit_item.plural;
}

export function get_unit_word(unit_item, amount) {
  return Math.abs(amount) === 1 ? unit_item.singular : unit_item.plural;
}

// Temperatura: la base es el kelvin. zero_tolerance limpia los residuos de la aritmética (por ejemplo 5e-14 en
// lugar de 0 al pasar 32 °F a Celsius).
const KELVIN_AT_ZERO_CELSIUS = 273.15;
const TEMPERATURE_UNITS = [
  {
    key: "celsius",
    singular: "grado Celsius",
    plural: "grados Celsius",
    symbol: "°C",
    name: "Celsius",
    note: "",
    zero_tolerance: 1e-9,
    to_base: (value) => value + KELVIN_AT_ZERO_CELSIUS,
    from_base: (base_value) => base_value - KELVIN_AT_ZERO_CELSIUS,
  },
  {
    key: "fahrenheit",
    singular: "grado Fahrenheit",
    plural: "grados Fahrenheit",
    symbol: "°F",
    name: "Fahrenheit",
    note: "",
    zero_tolerance: 1e-9,
    to_base: (value) => ((value - 32) * 5) / 9 + KELVIN_AT_ZERO_CELSIUS,
    from_base: (base_value) => ((base_value - KELVIN_AT_ZERO_CELSIUS) * 9) / 5 + 32,
  },
  {
    key: "kelvin",
    singular: "kelvin",
    plural: "kelvin",
    symbol: "K",
    name: "Kelvin",
    note: "",
    zero_tolerance: 1e-9,
    to_base: (value) => value,
    from_base: (base_value) => base_value,
  },
];

// La fórmula de cada par de temperaturas, para mostrarla en lugar de una simple relación 1 a 1.
export const TEMPERATURE_FORMULAS = {
  "celsius>fahrenheit": "°F = °C × 9/5 + 32",
  "fahrenheit>celsius": "°C = (°F − 32) × 5/9",
  "celsius>kelvin": "K = °C + 273,15",
  "kelvin>celsius": "°C = K − 273,15",
  "fahrenheit>kelvin": "K = (°F − 32) × 5/9 + 273,15",
  "kelvin>fahrenheit": "°F = (K − 273,15) × 9/5 + 32",
};

// allows_negative: en la temperatura un valor negativo tiene sentido; en las demás magnitudes no.
// default_from y default_to: el par más común, con el que se abre la magnitud la primera vez.
export const MAGNITUDES = {
  length: {
    allows_negative: false,
    default_from: "meter",
    default_to: "foot",
    units: [
      unit("millimeter", "milímetro", "milímetros", "mm", 0.001),
      unit("centimeter", "centímetro", "centímetros", "cm", 0.01),
      unit("meter", "metro", "metros", "m", 1),
      unit("kilometer", "kilómetro", "kilómetros", "km", 1000),
      unit("inch", "pulgada", "pulgadas", "in", 0.0254),
      unit("foot", "pie", "pies", "ft", 0.3048),
      unit("yard", "yarda", "yardas", "yd", 0.9144),
      unit("mile", "milla", "millas", "mi", 1609.344),
      unit("nautical_mile", "milla náutica", "millas náuticas", "nmi", 1852),
    ],
  },
  mass: {
    allows_negative: false,
    default_from: "kilogram",
    default_to: "pound",
    units: [
      unit("milligram", "miligramo", "miligramos", "mg", 0.000001),
      unit("gram", "gramo", "gramos", "g", 0.001),
      unit("kilogram", "kilogramo", "kilogramos", "kg", 1),
      unit("tonne", "tonelada", "toneladas", "t", 1000),
      unit("ounce", "onza", "onzas", "oz", 0.028349523125),
      unit("pound", "libra", "libras", "lb", 0.45359237),
      unit("stone", "stone", "stones", "st", 6.35029318),
    ],
  },
  volume: {
    allows_negative: false,
    default_from: "liter",
    default_to: "gallon_us",
    units: [
      unit("milliliter", "mililitro", "mililitros", "ml", 0.001),
      unit("liter", "litro", "litros", "l", 1),
      unit("cubic_meter", "metro cúbico", "metros cúbicos", "m³", 1000),
      unit("fluid_ounce_us", "onza líquida", "onzas líquidas", "fl oz", 0.0295735295625, { note: "EE. UU." }),
      unit("pint_us", "pinta", "pintas", "pt", 0.473176473, { note: "EE. UU." }),
      unit("quart_us", "cuarto de galón", "cuartos de galón", "qt", 0.946352946, { name: "Cuarto de galón", note: "EE. UU." }),
      unit("gallon_us", "galón", "galones", "gal", 3.785411784, { note: "EE. UU." }),
      unit("gallon_imperial", "galón imperial", "galones imperiales", "gal imp", 4.54609),
    ],
  },
  temperature: {
    allows_negative: true,
    default_from: "celsius",
    default_to: "fahrenheit",
    units: TEMPERATURE_UNITS,
  },
  area: {
    allows_negative: false,
    default_from: "square_meter",
    default_to: "square_foot",
    units: [
      unit("square_centimeter", "centímetro cuadrado", "centímetros cuadrados", "cm²", 0.0001),
      unit("square_meter", "metro cuadrado", "metros cuadrados", "m²", 1),
      unit("hectare", "hectárea", "hectáreas", "ha", 10000),
      unit("square_kilometer", "kilómetro cuadrado", "kilómetros cuadrados", "km²", 1000000),
      unit("square_inch", "pulgada cuadrada", "pulgadas cuadradas", "in²", 0.00064516),
      unit("square_foot", "pie cuadrado", "pies cuadrados", "ft²", 0.09290304),
      unit("acre", "acre", "acres", "ac", 4046.8564224),
      unit("square_mile", "milla cuadrada", "millas cuadradas", "mi²", 2589988.110336),
    ],
  },
  time: {
    allows_negative: false,
    default_from: "hour",
    default_to: "minute",
    units: [
      unit("millisecond", "milisegundo", "milisegundos", "ms", 0.001),
      unit("second", "segundo", "segundos", "s", 1),
      unit("minute", "minuto", "minutos", "min", 60),
      unit("hour", "hora", "horas", "h", 3600),
      unit("day", "día", "días", "d", 86400),
      unit("week", "semana", "semanas", null, 604800),
      // Un mes y un año no miden lo mismo siempre: en una conversión general se toman estas medidas fijas.
      unit("month", "mes", "meses", null, 2592000, { name: "Mes de 30 días" }),
      unit("year", "año", "años", null, 31536000, { name: "Año de 365 días" }),
    ],
  },
  // La base de la cocina es el mililitro. El gramo solo entra cuando hay un ingrediente (ver get_unit_list).
  cooking: {
    allows_negative: false,
    default_from: "cup",
    default_to: "milliliter",
    units: [
      unit("teaspoon", "cucharadita", "cucharaditas", null, 5, { name: "Cucharadita (5 ml)" }),
      unit("tablespoon", "cucharada", "cucharadas", null, 15, { name: "Cucharada (15 ml)" }),
      unit("cup", "taza", "tazas", null, 240, { name: "Taza (240 ml)" }),
      unit("fluid_ounce", "onza líquida", "onzas líquidas", "fl oz", 29.5735295625),
      unit("milliliter", "mililitro", "mililitros", "ml", 1),
      unit("liter", "litro", "litros", "l", 1000),
    ],
  },
  speed: {
    allows_negative: false,
    default_from: "kilometer_per_hour",
    default_to: "mile_per_hour",
    units: [
      unit("meter_per_second", "metro por segundo", "metros por segundo", "m/s", 1),
      unit("kilometer_per_hour", "kilómetro por hora", "kilómetros por hora", "km/h", 1 / 3.6),
      unit("mile_per_hour", "milla por hora", "millas por hora", "mph", 0.44704),
      unit("knot", "nudo", "nudos", "kn", 1852 / 3600),
      unit("foot_per_second", "pie por segundo", "pies por segundo", "ft/s", 0.3048),
    ],
  },
  // Las unidades KB, MB, GB y TB son decimales (×1000); KiB, MiB, GiB y TiB son binarias (×1024).
  data: {
    allows_negative: false,
    default_from: "gigabyte",
    default_to: "megabyte",
    units: [
      unit("bit", "bit", "bits", "b", 0.125),
      unit("byte", "byte", "bytes", "B", 1),
      unit("kilobyte", "kilobyte", "kilobytes", "KB", 1e3, { note: "×1000" }),
      unit("megabyte", "megabyte", "megabytes", "MB", 1e6, { note: "×1000" }),
      unit("gigabyte", "gigabyte", "gigabytes", "GB", 1e9, { note: "×1000" }),
      unit("terabyte", "terabyte", "terabytes", "TB", 1e12, { note: "×1000" }),
      unit("kibibyte", "kibibyte", "kibibytes", "KiB", 1024, { note: "×1024" }),
      unit("mebibyte", "mebibyte", "mebibytes", "MiB", 1024 ** 2, { note: "×1024" }),
      unit("gibibyte", "gibibyte", "gibibytes", "GiB", 1024 ** 3, { note: "×1024" }),
      unit("tebibyte", "tebibyte", "tebibytes", "TiB", 1024 ** 4, { note: "×1024" }),
    ],
  },
  energy: {
    allows_negative: false,
    default_from: "kilocalorie",
    default_to: "kilojoule",
    units: [
      unit("joule", "julio", "julios", "J", 1),
      unit("kilojoule", "kilojulio", "kilojulios", "kJ", 1000),
      unit("calorie", "caloría", "calorías", "cal", 4.184),
      unit("kilocalorie", "kilocaloría", "kilocalorías", "kcal", 4184),
      unit("watt_hour", "vatio hora", "vatios hora", "Wh", 3600),
      unit("kilowatt_hour", "kilovatio hora", "kilovatios hora", "kWh", 3600000),
      unit("btu", "BTU", "BTU", "BTU", 1055.05585262, { name: "BTU" }),
    ],
  },
  pressure: {
    allows_negative: false,
    default_from: "bar",
    default_to: "psi",
    units: [
      unit("pascal", "pascal", "pascales", "Pa", 1),
      unit("kilopascal", "kilopascal", "kilopascales", "kPa", 1000),
      unit("bar", "bar", "bares", "bar", 100000),
      unit("millibar", "milibar", "milibares", "mbar", 100),
      unit("psi", "psi", "psi", "psi", 6894.757293168, { name: "PSI" }),
      unit("atmosphere", "atmósfera", "atmósferas", "atm", 101325),
      unit("mmhg", "milímetro de mercurio", "milímetros de mercurio", "mmHg", 133.322387415),
    ],
  },
};

// Gramos por mililitro, aproximados. Las claves son los value de la lista de ingredientes del index.html.
// Son promedios de referencia: la harina tamizada pesa menos y la compacta más.
export const INGREDIENT_DENSITIES = {
  water: 1.0,
  milk: 1.03,
  oil: 0.92,
  butter: 0.96,
  honey: 1.42,
  flour: 0.53,
  sugar: 0.85,
  rice: 0.8,
  salt: 1.2,
  cocoa: 0.5,
};

// El gramo de un ingrediente: como la base es el mililitro, un gramo ocupa 1 / densidad mililitros.
function make_gram_unit(density) {
  return unit("gram", "gramo", "gramos", "g", 1 / density);
}

// Las unidades de una magnitud. En cocina, con un ingrediente elegido, se agrega el gramo.
export function get_unit_list(magnitude_key, ingredient_key = "") {
  const units = MAGNITUDES[magnitude_key].units;
  const density = INGREDIENT_DENSITIES[ingredient_key];
  if (magnitude_key === "cooking" && density) return [...units, make_gram_unit(density)];
  return units;
}

export function convert_value(from_unit, to_unit, value) {
  const result = to_unit.from_base(from_unit.to_base(value));
  return Math.abs(result) < to_unit.zero_tolerance ? 0 : result;
}
