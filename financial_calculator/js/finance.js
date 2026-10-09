// Fórmulas financieras: tasas, cuota de un préstamo con su tabla de amortización, interés simple y compuesto, y
// ahorro con aportes mensuales. Son funciones puras: reciben números y devuelven números, sin tocar la pantalla.
// Así se pueden probar con valores conocidos (ver PLAN.md, sección 4.5).
//
// Las tasas se manejan como fracción: 18 % es 0,18. Las fórmulas están explicadas en PLAN.md, sección 4.

const MONTHS_PER_YEAR = 12;

// ---------------------------------------------------------------------------
// Tasas
// ---------------------------------------------------------------------------

// Tasa efectiva de un periodo a partir de la efectiva anual. Con 12 periodos por año es la tasa mensual:
// i = (1 + EA)^(1/m) - 1
export function effective_annual_to_period_rate(effective_annual, periods_per_year = MONTHS_PER_YEAR) {
  return (1 + effective_annual) ** (1 / periods_per_year) - 1;
}

// Efectiva anual a partir de la tasa de un periodo: EA = (1 + i)^m - 1
function period_rate_to_effective_annual(period_rate, periods_per_year = MONTHS_PER_YEAR) {
  return (1 + period_rate) ** periods_per_year - 1;
}

// Dada una tasa de cualquiera de los tres tipos, devuelve las tres. type es "effective_annual",
// "nominal_annual" (se capitaliza periods_per_year veces al año) o "effective_period".
export function convert_rates(value, type, periods_per_year = MONTHS_PER_YEAR) {
  let period;
  if (type === "effective_annual") period = effective_annual_to_period_rate(value, periods_per_year);
  else if (type === "nominal_annual") period = value / periods_per_year;
  else period = value;
  return {
    effective_annual: period_rate_to_effective_annual(period, periods_per_year),
    nominal_annual: period * periods_per_year,
    period,
  };
}

// ---------------------------------------------------------------------------
// Préstamo con cuota fija (sistema francés)
// ---------------------------------------------------------------------------

// Cuota fija: A = P × i / (1 - (1 + i)^-n). Sin interés, el monto se reparte en partes iguales.
function calculate_payment(principal, monthly_rate, months) {
  if (monthly_rate === 0) return principal / months;
  return (principal * monthly_rate) / (1 - (1 + monthly_rate) ** -months);
}

// Tabla de amortización mes a mes. Cada mes el interés es saldo × i y el resto de la cuota abona a capital.
// El último abono se ajusta para que el saldo final quede en cero exacto, sin residuos de la aritmética decimal.
export function build_amortization(principal, monthly_rate, months) {
  const payment = calculate_payment(principal, monthly_rate, months);
  const rows = [];
  let balance = principal;
  let total_paid = 0;
  for (let month = 1; month <= months; month += 1) {
    const interest = balance * monthly_rate;
    const is_last = month === months;
    const capital_payment = is_last ? balance : payment - interest;
    balance = is_last ? 0 : balance - capital_payment;
    const month_payment = capital_payment + interest;
    total_paid += month_payment;
    rows.push({ month, payment: month_payment, interest, principal: capital_payment, balance });
  }
  return { payment, rows, total_paid, total_interest: total_paid - principal };
}

// ---------------------------------------------------------------------------
// Interés simple y compuesto
// ---------------------------------------------------------------------------

// Simple: I = P × r × t. Compuesto: M = P × (1 + r)^t. Con r efectiva anual y t en años.
export function calculate_simple_interest(capital, effective_annual, years) {
  const interest = capital * effective_annual * years;
  return { interest, final_amount: capital + interest };
}

export function calculate_compound_interest(capital, effective_annual, years) {
  const final_amount = capital * (1 + effective_annual) ** years;
  return { interest: final_amount - capital, final_amount };
}

// ---------------------------------------------------------------------------
// Ahorro con aporte mensual
// ---------------------------------------------------------------------------

// Valor acumulado tras n meses con aporte inicial y aportes al final de cada mes:
// FV = P0 × (1 + i)^n + C × ((1 + i)^n - 1) / i. Sin interés, es la suma de lo aportado.
function accumulated_value(initial, monthly, monthly_rate, months) {
  if (monthly_rate === 0) return initial + monthly * months;
  const growth = (1 + monthly_rate) ** months;
  return initial * growth + (monthly * (growth - 1)) / monthly_rate;
}

// Devuelve el acumulado final, lo aportado, los intereses y, para el gráfico, el aportado y el acumulado de cada
// año desde el 0 hasta el último.
export function calculate_saving(initial, monthly, effective_annual, years) {
  const monthly_rate = effective_annual_to_period_rate(effective_annual);
  const yearly = [];
  for (let year = 0; year <= years; year += 1) {
    const months = year * MONTHS_PER_YEAR;
    yearly.push({
      year,
      contributed: initial + monthly * months,
      total: accumulated_value(initial, monthly, monthly_rate, months),
    });
  }
  const last = yearly[yearly.length - 1];
  return { final_amount: last.total, contributed: last.contributed, interest: last.total - last.contributed, yearly };
}
