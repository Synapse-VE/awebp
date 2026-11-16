/**
 * Service worker de awebp.
 *
 * Estrategia: guarda el esqueleto de la app en el install y despues responde
 * con "cache primero, red de fondo" (stale-while-revalidate). Asi la segunda
 * visita es instantanea y, cuando hay una version nueva, se toma en la
 * siguiente recarga. El wasm del encoder se cachea la primera vez que se usa.
 */
const VERSION = "1";
const CACHE = `awebp-v${VERSION}`;

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

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  evento.respondWith(responder(request));
});

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
