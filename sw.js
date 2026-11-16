/**
 * Service worker de awebp.
 *
 * Estrategia: guarda el esqueleto de la app en el install y despues responde
 * con "cache primero, red de fondo" (stale-while-revalidate). Asi la segunda
 * visita es instantanea y, cuando hay una version nueva, se toma en la
 * siguiente recarga. El wasm del encoder se cachea la primera vez que se usa.
 */
const VERSION = "2";
const CACHE = `awebp-v${VERSION}`;
const CACHE_COMPARTIDO = "awebp-compartido-v1";

const ESQUELETO = [
  "./",
  "./index.html",
  "./css/estilos.css",
  "./js/app.js",
  "./js/convertir.js",
  "./js/formato.js",
  "./js/reglas.js",
  "./manifest.webmanifest",
  "./icons/icono-192.png",
  "./icons/icono-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/maskable-512.png",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);

      await Promise.all(
        ESQUELETO.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch {
            // Si un archivo falla no rompemos la instalacion entera.
          }
        }),
      );

      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      const claves = await caches.keys();
      await Promise.all(claves.filter((clave) => clave !== CACHE).map((clave) => caches.delete(clave)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (evento) => {
  const { request } = evento;
  const url = new URL(request.url);

  if (request.method === "POST") {
    if (url.origin === self.location.origin && url.pathname.endsWith("/compartir")) {
      evento.respondWith(recibirCompartido(request));
    }
    return;
  }

  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  evento.respondWith(responder(request));
});

function urlCompartida(nombre = "") {
  return new URL(`__compartido__/${nombre}`, self.registration.scope).href;
}

/**
 * Recibe lo que se comparte desde el sistema (Android): guarda los archivos en
 * Cache Storage y manda a la app con una marca en la URL para que los levante.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function recibirCompartido(request) {
  try {
    const datos = await request.formData();
    const archivos = [...datos.getAll("fotos"), ...datos.getAll("archivos")].filter(
      (valor) => valor instanceof File,
    );

    await caches.delete(CACHE_COMPARTIDO);
    const cache = await caches.open(CACHE_COMPARTIDO);
    const indice = [];

    for (const [posicion, archivo] of archivos.entries()) {
      await cache.put(
        urlCompartida(String(posicion)),
        new Response(archivo, { headers: { "Content-Type": archivo.type || "application/octet-stream" } }),
      );
      indice.push({ nombre: archivo.name, tipo: archivo.type });
    }

    await cache.put(
      urlCompartida("indice"),
      new Response(JSON.stringify(indice), { headers: { "Content-Type": "application/json" } }),
    );

    return Response.redirect(new URL("./?compartido=1", self.registration.scope).href, 303);
  } catch {
    return Response.redirect(new URL("./?compartido=error", self.registration.scope).href, 303);
  }
}

/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function responder(request) {
  const cache = await caches.open(CACHE);
  const guardada = await cache.match(request);

  const desdeLaRed = fetch(request)
    .then((respuesta) => {
      if (respuesta && respuesta.ok) cache.put(request, respuesta.clone());
      return respuesta;
    })
    .catch(() => null);

  if (guardada) return guardada;

  const respuesta = await desdeLaRed;
  if (respuesta) return respuesta;

  if (request.mode === "navigate") {
    const indice = (await cache.match("./index.html")) ?? (await cache.match("./"));
    if (indice) return indice;
  }

  return new Response("Sin conexion", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
