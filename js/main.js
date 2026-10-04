// Script del portal. Solo muestra el año actual en el pie de página.
// Se mantiene mínimo a propósito: el portal es una lista de enlaces y no necesita más lógica.

const current_year_element = document.getElementById("current_year");

if (current_year_element) {
  current_year_element.textContent = new Date().getFullYear();
}
