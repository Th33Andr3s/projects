// Sesión con Supabase Auth: entrar, salir y consultar quién está dentro.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const AUTH_STORAGE_KEY = "book_life_auth";

// La sesión vive solo mientras la pestaña esté abierta. Al cerrarla hay que volver a entrar,
// porque este libro es privado y puede abrirse en equipos compartidos.
// Si sessionStorage está bloqueado, la sesión queda en memoria y se pierde al recargar.
function create_session_only_storage() {
  const memory = new Map();
  return {
    getItem(key) {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem(key, value) {
      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        memory.set(key, value);
      }
    },
    removeItem(key) {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        memory.delete(key);
      }
    },
  };
}

// Antes la sesión se guardaba de forma permanente y sobrevivía al cierre del navegador.
// Se borra ese rastro para que no quede ninguna sesión vieja en el equipo.
try {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
} catch {
  // Sin almacenamiento disponible no hay nada que borrar.
}

// Cliente único para toda la aplicación. El resto de módulos lo importan de aquí.
// La clave de almacenamiento lleva el prefijo del proyecto para no chocar con otros del mismo dominio.
export const supabase_client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey: AUTH_STORAGE_KEY,
    storage: create_session_only_storage(),
    persistSession: true,
    autoRefreshToken: true,
  },
});

// Devuelve la sesión guardada o null. Nunca lanza: si algo falla, se trata como "sin sesión".
export async function get_current_session() {
  try {
    const { data, error } = await supabase_client.auth.getSession();
    if (error) return null;
    return data.session;
  } catch {
    return null;
  }
}

// Devuelve { ok: true } o { ok: false, message } con el mensaje ya listo para mostrar.
export async function sign_in(email, password) {
  try {
    const { error } = await supabase_client.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: translate_auth_error(error) };
    return { ok: true };
  } catch {
    return { ok: false, message: "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo." };
  }
}

export async function sign_out() {
  try {
    await supabase_client.auth.signOut();
  } catch {
    // Aunque falle la red, se borra la sesión local para que la pantalla vuelva al acceso.
    await supabase_client.auth.signOut({ scope: "local" });
  }
}

// Avisa cuando la sesión cambia (entrar, salir, expirar). Devuelve la función para dejar de escuchar.
export function on_session_change(callback) {
  const { data } = supabase_client.auth.onAuthStateChange((event, session) => {
    // Se difiere para no llamar a Supabase dentro de su propio callback, lo que puede bloquearlo.
    setTimeout(() => callback(event, session), 0);
  });
  return () => data.subscription.unsubscribe();
}

// Nombre que se muestra en la aplicación. Si no se puede leer, devuelve null y la UI usa un saludo genérico.
export async function get_display_name(user_id) {
  try {
    const { data, error } = await supabase_client
      .from("profiles")
      .select("display_name")
      .eq("id", user_id)
      .maybeSingle();
    if (error || !data) return null;
    return data.display_name;
  } catch {
    return null;
  }
}

function translate_auth_error(error) {
  const code = error.code || "";
  const text = (error.message || "").toLowerCase();

  if (code === "invalid_credentials" || text.includes("invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }
  if (code === "over_request_rate_limit" || error.status === 429) {
    return "Demasiados intentos. Espera un momento e inténtalo de nuevo.";
  }
  if (text.includes("failed to fetch") || text.includes("network")) {
    return "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.";
  }
  return "No se pudo iniciar sesión. Inténtalo de nuevo.";
}
