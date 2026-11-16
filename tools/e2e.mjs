#!/usr/bin/env node
/**
 * Prueba de punta a punta con el protocolo de DevTools de Chrome.
 *
 * Modos: input (por el input de archivo), wasm (fuerza el encoder WebAssembly),
 * heic (archivo HEIC real), drop (arrastrar), paste (pegar) y multi (tres fotos
 * y descarga del ZIP). Con AWEBP_URL apunta al sitio publicado en vez de
 * levantar uno local.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PUERTO_SITIO = 8099;
const PUERTO_CDP_FIJO = 0;
const URL_EXTERNA = process.env.AWEBP_URL ?? "";
const URL_BASE = URL_EXTERNA || `http://127.0.0.1:${PUERTO_SITIO}/`;

const SHOT = process.argv[2] ?? "mobile";
const MODO = process.argv[3] ?? "input";
const PROBAR_OFFLINE = process.argv.includes("offline");
const EXTRA = MODO === "wasm" ? "?wasm=1" : "";
const ANCHO = SHOT === "desktop" ? 1200 : 430;
const ALTO = SHOT === "desktop" ? 900 : 932;
const DESCARGAS = resolve(".shots/descargas");

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(DESCARGAS, { recursive: true });

async function esperarJson(url, intentos = 60) {
  for (let i = 0; i < intentos; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* todavia no levanto */
    }
    await dormir(250);
  }
  throw new Error(`no respondio ${url}`);
}

const eventos = [];

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pendientes = new Map();
    ws.addEventListener("message", (evento) => {
      const mensaje = JSON.parse(evento.data);
      if (!mensaje.id) {
        eventos.push(mensaje);
        return;
      }
      const pendiente = this.pendientes.get(mensaje.id);
      if (!pendiente) return;
      this.pendientes.delete(mensaje.id);
      if (mensaje.error) pendiente.rechazar(new Error(JSON.stringify(mensaje.error)));
      else pendiente.resolver(mensaje.result);
    });
  }

  enviar(method, params = {}) {
    return new Promise((resolver, rechazar) => {
      const id = ++this.id;
      this.pendientes.set(id, { resolver, rechazar });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function conectar(url) {
  const ws = new WebSocket(url);
  await new Promise((resolver, rechazar) => {
    ws.addEventListener("open", resolver, { once: true });
    ws.addEventListener("error", () => rechazar(new Error(`no conecto a ${url}`)), { once: true });
  });
  return new CDP(ws);
}

/** Genera una foto JPEG en el navegador (sirve local y contra el sitio). */
function generadorFoto({ ancho = 1600, alto = 1200, tono = "#22d3ee" } = {}) {
  return `(async () => {
    const lienzo = document.createElement("canvas");
    lienzo.width = ${ancho};
    lienzo.height = ${alto};
    const contexto = lienzo.getContext("2d");
    const degradado = contexto.createLinearGradient(0, 0, ${ancho}, ${alto});
    degradado.addColorStop(0, "${tono}");
    degradado.addColorStop(1, "#f472b6");
    contexto.fillStyle = degradado;
    contexto.fillRect(0, 0, ${ancho}, ${alto});
    contexto.fillStyle = "#ffffff";
    contexto.fillRect(80, 80, 400, 120);
    const blob = await new Promise((r) => lienzo.toBlob(r, "image/jpeg", 0.92));
    return new File([blob], "foto.jpg", { type: "image/jpeg" });
  })()`;
}

const sitio = URL_EXTERNA
  ? null
  : spawn("python3", ["-m", "http.server", String(PUERTO_SITIO), "--bind", "127.0.0.1"], { stdio: "ignore" });

const perfil = mkdtempSync(join(tmpdir(), "awebp-chrome-"));
const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--remote-debugging-port=${PUERTO_CDP_FIJO}`,
    `--user-data-dir=${perfil}`,
    `--window-size=${ANCHO},${ALTO}`,
    URL_BASE + EXTRA,
  ],
  { stdio: "ignore" },
);

let salida = 1;
let cdp;

try {
  // Chrome escribe el puerto real en DevToolsActivePort.
  const archivoPuerto = join(perfil, "DevToolsActivePort");
  let puerto = 0;
  for (let i = 0; i < 80; i += 1) {
    try {
      const [linea] = readFileSync(archivoPuerto, "utf8").split("\n");
      if (linea) {
        puerto = Number(linea);
        break;
      }
    } catch {
      /* todavia no existe */
    }
    await dormir(150);
  }
  if (!puerto) throw new Error("Chrome no levanto el puerto de depuracion");

  await esperarJson(`http://127.0.0.1:${puerto}/json/version`);
  const lista = await esperarJson(`http://127.0.0.1:${puerto}/json/list`);
  const pagina =
    lista.find((objetivo) => objetivo.type === "page" && objetivo.url.startsWith(URL_BASE)) ??
    lista.find((objetivo) => objetivo.type === "page");
  if (!pagina) throw new Error("no encontre la pestana");

  cdp = await conectar(pagina.webSocketDebuggerUrl);
  await cdp.enviar("Page.enable");
  await cdp.enviar("Runtime.enable");

  const evaluar = async (expresion, { awaitPromise = false } = {}) => {
    const { result } = await cdp.enviar("Runtime.evaluate", {
      expression: expresion,
      returnByValue: true,
      awaitPromise,
    });
    if (result?.subtype === "error") throw new Error(result.description);
    return result?.value;
  };

  let listo = false;
  for (let i = 0; i < 80; i += 1) {
    listo = await evaluar(
      "document.readyState === 'complete' && !!document.getElementById('archivo-galeria')",
    );
    if (listo) break;
    await dormir(150);
  }
  if (!listo) throw new Error("la pagina no termino de cargar");

  const inyectar = async (expresionArchivos) => {
    const ok = await evaluar(`(async () => {
      const archivos = await ${expresionArchivos};
      const datos = new DataTransfer();
      for (const archivo of archivos) datos.items.add(archivo);
      const input = document.getElementById("archivo-galeria");
      input.files = datos.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`, { awaitPromise: true });
    if (!ok) throw new Error("no se pudo inyectar el archivo");
  };

  if (MODO === "camera") {
    await evaluar(`document.getElementById("boton-camara").click()`);

    let abierta = false;
    for (let i = 0; i < 80; i += 1) {
      abierta = await evaluar("!document.getElementById('camara').hidden");
      if (abierta) break;
      await dormir(150);
    }
    if (!abierta) throw new Error("no se abrio la camara en pantalla");

    await dormir(1200);

    const capturaModal = await cdp.enviar("Page.captureScreenshot", { format: "png" });
    writeFileSync(`.shots/camara-${SHOT}.png`, Buffer.from(capturaModal.data, "base64"));

    const medidasVideo = await evaluar(`({
      ancho: document.getElementById("camara-video").videoWidth,
      alto: document.getElementById("camara-video").videoHeight,
    })`);
    console.log("video:", JSON.stringify(medidasVideo));
    if (!medidasVideo.ancho) throw new Error("el video de la camara no tiene imagen");

    await evaluar(`document.getElementById("camara-disparar").click()`);
    await dormir(500);
  } else if (MODO === "share") {
    const listoSW = await evaluar(`(async () => {
      if (!("serviceWorker" in navigator)) return false;
      await navigator.serviceWorker.ready;
      for (let i = 0; i < 60 && !navigator.serviceWorker.controller; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return Boolean(navigator.serviceWorker.controller);
    })()`, { awaitPromise: true });
    if (!listoSW) throw new Error("el service worker no controla la pagina");

    const respuesta = await evaluar(`(async () => {
      const archivo = await ${generadorFoto()};
      const datos = new FormData();
      datos.append("fotos", archivo);
      const r = await fetch("./compartir", { method: "POST", body: datos });
      return { estado: r.status, tipo: r.type };
    })()`, { awaitPromise: true });
    console.log("post compartir:", JSON.stringify(respuesta));

    await cdp.enviar("Page.navigate", { url: `${URL_BASE}?compartido=1` });
    for (let i = 0; i < 80; i += 1) {
      const ok = await evaluar("document.readyState === 'complete' && !!document.getElementById('archivo-galeria')");
      if (ok) break;
      await dormir(150);
    }
  } else if (MODO === "input" || MODO === "wasm") {
    await inyectar(`(async () => [await ${generadorFoto()}])()`);
  } else if (MODO === "heic") {
    await inyectar(`(async () => {
      const blob = await (await fetch("./tools/fixtures/ejemplo.heic")).blob();
      return [new File([blob], "ejemplo.heic", { type: "image/heic" })];
    })()`);
  } else if (MODO === "multi") {
    await inyectar(`(async () => {
      const uno = await ${generadorFoto({ ancho: 1600, alto: 1200, tono: "#22d3ee" })};
      const dos = await ${generadorFoto({ ancho: 1200, alto: 900, tono: "#38bdf8" })};
      const tres = await ${generadorFoto({ ancho: 1000, alto: 1000, tono: "#34d399" })};
      return [uno, dos, tres].map((archivo, indice) => new File([archivo], \`foto-\${indice + 1}.jpg\`, { type: "image/jpeg" }));
    })()`);
  } else {
    const tipoEvento = MODO === "drop" ? "DragEvent" : "ClipboardEvent";
    const campoDatos = MODO === "drop" ? "dataTransfer" : "clipboardData";
    const ok = await evaluar(`(async () => {
      const archivo = await ${generadorFoto()};
      const datos = new DataTransfer();
      datos.items.add(archivo);
      const evento = new ${tipoEvento}("${MODO}", { bubbles: true, cancelable: true });
      if (!evento.${campoDatos}) {
        Object.defineProperty(evento, "${campoDatos}", { value: datos });
      }
      window.dispatchEvent(evento);
      return true;
    })()`, { awaitPromise: true });
    if (!ok) throw new Error("no se pudo simular el evento");
  }

  const esperar = async (condicion, intentos = 140) => {
    for (let i = 0; i < intentos; i += 1) {
      if (await evaluar(condicion)) return true;
      await dormir(150);
    }
    return false;
  };

  if (MODO === "multi") {
    if (!(await esperar("!document.getElementById('lista').hidden"))) {
      const detalle = await evaluar("document.body.innerText.slice(0, 240)");
      throw new Error(`no aparecio la lista (${detalle})`);
    }

    const datos = await evaluar(`({
      items: document.querySelectorAll("#lista-items .item").length,
      titulo: document.getElementById("lista-titulo").textContent,
      resumen: document.getElementById("lista-resumen").textContent,
    })`);
    console.log("lista:", JSON.stringify(datos));
    if (datos.items !== 3) throw new Error(`se esperaban 3 fotos y hay ${datos.items}`);

    await cdp.enviar("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DESCARGAS }).catch(
      () => cdp.enviar("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DESCARGAS }),
    );

    await evaluar(`document.getElementById("descargar-zip").click()`);

    const zip = join(DESCARGAS, "awebp.zip");
    for (let i = 0; i < 80; i += 1) {
      if (existsSync(zip)) break;
      await dormir(150);
    }
    if (!existsSync(zip)) throw new Error("no se descargo el zip");

    const bytes = readFileSync(zip);
    const fin = bytes.length - 22;
    const entradas = bytes.readUInt16LE(fin + 10);
    console.log("zip:", statSync(zip).size, "bytes,", entradas, "entradas");
    if (entradas !== 3) throw new Error(`el zip tiene ${entradas} entradas`);
  } else {
    if (!(await esperar("!document.getElementById('resultado').hidden"))) {
      const detalle = await evaluar(`JSON.stringify({
        url: location.href,
        texto: document.body ? document.body.innerText.slice(0, 200) : "sin body",
        error: (document.getElementById("error") || {}).hidden === false
          ? document.getElementById("error-detalle").textContent
          : "sin error",
      })`);
      throw new Error(`no aparecio el resultado (${detalle})`);
    }

    await dormir(400);

    const previa = await evaluar(`(async () => {
      const imagen = document.getElementById("vista-original");
      if (!imagen.src) return "sin src";
      try {
        await imagen.decode();
        return imagen.naturalWidth > 0 ? "ok" : "vacia";
      } catch {
        return "error";
      }
    })()`, { awaitPromise: true });
    if (previa !== "ok") throw new Error(`la vista previa del original no carga: ${previa}`);

    const datos = await evaluar(`(async () => {
      const src = document.getElementById("vista-webp").src;
      const blob = await (await fetch(src)).blob();
      return {
        tipo: blob.type,
        pesoWebp: blob.size,
        pesoOriginal: document.getElementById("peso-original").textContent,
        ahorro: document.getElementById("ahorro").textContent,
        dimensiones: document.getElementById("dimensiones").textContent,
        calidad: document.getElementById("calidad-usada").textContent,
      };
    })()`, { awaitPromise: true });

    console.log(JSON.stringify(datos, null, 2));
    if (datos.tipo !== "image/webp") throw new Error(`el blob salio como ${datos.tipo}`);
    if (!(datos.pesoWebp > 0)) throw new Error("el blob salio vacio");

    // Cambiar la calidad tiene que reconvertir sin refrescar la pagina.
    await evaluar(`(() => {
      const control = document.getElementById("calidad");
      control.value = "50";
      control.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);

    const esperarQuieto = async () => {
      for (let i = 0; i < 80; i += 1) {
        const cargando = await evaluar("document.getElementById('resultado').classList.contains('cargando')");
        if (!cargando) return true;
        await dormir(120);
      }
      return false;
    };

    await dormir(500);
    await esperarQuieto();
    const trasCalidad = await evaluar(`({
      peso: document.getElementById("peso-webp").textContent,
      calidad: document.getElementById("calidad-usada").textContent,
    })`);
    console.log("calidad 50%:", JSON.stringify(trasCalidad));
    if (trasCalidad.calidad !== "50 %") throw new Error("la calidad no se aplico");

    if (MODO !== "camera") {
      await evaluar(`document.querySelector('.chip[data-max="800"]').click()`);
      await dormir(500);
      await esperarQuieto();
      const trasTamano = await evaluar("document.getElementById('dimensiones').textContent");
      console.log("max 800:", trasTamano);
      const medidas = trasTamano.match(/^(\d+) × (\d+) px$/);
      if (!medidas || Number(medidas[1]) !== 800) throw new Error(`tamano inesperado: ${trasTamano}`);
    }
  }

  if (PROBAR_OFFLINE && sitio) {
    const pwa = await evaluar(`(async () => {
      const registros = await navigator.serviceWorker.getRegistrations();
      await navigator.serviceWorker.ready;
      return { registros: registros.length, caches: await caches.keys() };
    })()`, { awaitPromise: true });
    console.log("pwa:", JSON.stringify(pwa));
    if (!pwa.registros) throw new Error("no se registro el service worker");

    sitio.kill("SIGKILL");
    await dormir(900);
    await cdp.enviar("Page.reload", { ignoreCache: false });
    await dormir(2500);

    const texto = await evaluar("document.body ? document.body.innerText : ''");
    if (!/awebp/i.test(texto)) throw new Error("la app no cargo sin conexion");
    console.log("offline OK");
  }

  const metricas = await cdp.enviar("Page.getLayoutMetrics");
  const { width, height } = metricas.cssContentSize;
  const captura = await cdp.enviar("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  writeFileSync(`.shots/e2e-${SHOT}-${MODO}.png`, Buffer.from(captura.data, "base64"));

  console.log(`OK ${SHOT} ${MODO}`);
  salida = 0;
} catch (error) {
  console.error(`FALLO: ${error.message}`);
  for (const evento of eventos.slice(-6)) {
    if (evento.method === "Runtime.exceptionThrown") {
      console.error("excepcion:", JSON.stringify(evento.params.exceptionDetails).slice(0, 300));
    }
  }
} finally {
  chrome.kill("SIGKILL");
  sitio?.kill("SIGKILL");
}

process.exit(salida);
