"""Servidor local de desarrollo para los proyectos de este repositorio.

Hace lo mismo que `python -m http.server`, con dos mejoras para trabajar sin sorpresas:

1. Sin caché: cada archivo se envía con la orden de no guardarse, así el navegador nunca
   muestra una copia vieja de la página, los estilos o los scripts.
2. Recarga sola: al reiniciar el servidor, las pestañas que ya estaban abiertas se recargan
   solas. Para esto, el servidor agrega un pequeño aviso a las páginas HTML que entrega.
   Ese aviso existe solo aquí: los archivos del proyecto no cambian y la versión publicada
   en GitHub Pages no lo tiene.

Uso, desde la carpeta de un proyecto (sirve la carpeta donde se ejecuta):

    python ../dev_server.py

Con otro puerto:

    python ../dev_server.py 9000
"""

import http.server
import os
import sys
import time

DEFAULT_PORT = 8080
STATUS_ROUTE = "/__dev_status"

# Cambia en cada arranque. Las pestañas abiertas lo consultan y, si cambió, se recargan.
SERVER_START_ID = str(time.time_ns())

# Aviso que se agrega a las páginas HTML. Consulta al servidor cada 2 segundos.
RELOAD_SNIPPET = (
    "<script>(function(){var last=null;"
    "function check(){fetch('" + STATUS_ROUTE + "',{cache:'no-store'})"
    ".then(function(r){return r.json()})"
    ".then(function(s){if(last!==null&&s.id!==last){location.reload();}last=s.id;})"
    ".catch(function(){});}"
    "setInterval(check,2000);check();})();</script>"
).encode("utf-8")


class DevHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Se aplica a todas las respuestas: nada se guarda en la caché del navegador.
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def do_GET(self):
        route = self.path.split("?", 1)[0]

        if route == STATUS_ROUTE:
            self.send_status()
            return

        file_path = self.translate_path(route)
        if os.path.isdir(file_path):
            # Las carpetas sin "/" final las redirige el servidor base, para que las rutas relativas funcionen.
            if not route.endswith("/"):
                super().do_GET()
                return
            file_path = os.path.join(file_path, "index.html")

        if file_path.endswith(".html") and os.path.isfile(file_path):
            self.send_html(file_path)
            return

        super().do_GET()

    def send_status(self):
        body = ('{"id":"%s"}' % SERVER_START_ID).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, file_path):
        with open(file_path, "rb") as html_file:
            content = html_file.read()

        # El aviso va justo antes de cerrar el cuerpo; si no hay cierre, al final.
        closing_tag = b"</body>"
        if closing_tag in content:
            content = content.replace(closing_tag, RELOAD_SNIPPET + closing_tag, 1)
        else:
            content += RELOAD_SNIPPET

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format, *args):
        # Se silencian las consultas de recarga para no llenar la terminal.
        if STATUS_ROUTE in (format % args):
            return
        super().log_message(format, *args)


class DevServer(http.server.ThreadingHTTPServer):
    # Los hilos no bloquean el cierre del servidor con Ctrl+C.
    daemon_threads = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    server = DevServer(("", port), DevHandler)
    print(f"Sirviendo {os.getcwd()}")
    print(f"Abre http://localhost:{port}")
    print("Sin caché. Las pestañas abiertas se recargan solas si reinicias el servidor.")
    print("Ctrl+C para detener.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
