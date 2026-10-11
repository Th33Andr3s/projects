// Las acciones que una vista le pide a otra (cambiar de sección, abrir un documento, redibujar todo). main.js las conecta al
// arrancar; así las vistas no se importan entre sí.
export const hooks = {
  go_to_view: () => {},
  open_document: () => {},
  refresh_all: () => {},
  refresh_reminder: () => {},
  refresh_clients: () => {},
  refresh_products: () => {},
  refresh_documents: () => {},
};
