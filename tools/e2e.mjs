#!/usr/bin/env node
/**
 * Prueba de punta a punta con el protocolo de DevTools de Chrome.
 * Levanta el sitio, sube una foto real por el input y verifica el resultado.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PUERTO_SITIO = 8099;
let PUERTO_CDP = 0;
const URL_BASE = `http://127.0.0.1:${PUERTO_SITIO}/`;
const FIXTURE = resolve("tools/fixtures/foto.jpg");
const SHOT = process.argv[2] ?? "mobile";
const MODO = process.argv[3] ?? "input";
const PROBAR_OFFLINE = process.argv.includes("offline");
const EXTRA = MODO === "wasm" ? "?wasm=1" : "";
const ANCHO = SHOT === "desktop" ? 1200 : 430;
const ALTO = SHOT === "desktop" ? 900 : 932;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

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

const sitio = spawn("python3", ["-m", "http.server", String(PUERTO_SITIO), "--bind", "127.0.0.1"], {
  stdio: "ignore",
});

const perfil = mkdtempSync(join(tmpdir(), "awebp-chrome-"));
const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    "--remote-debugging-port=0",
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
  for (let i = 0; i < 80; i += 1) {
    try {
      const [linea] = readFileSync(archivoPuerto, "utf8").split("\n");
      if (linea) { PUERTO_CDP = Number(linea); break; }
    } catch {
      /* todavia no existe */
    }
    await dormir(150);
  }
  if (!PUERTO_CDP) throw new Error("Chrome no levanto el puerto de depuracion");

  await esperarJson(`http://127.0.0.1:${PUERTO_CDP}/json/version`);
  const lista = await esperarJson(`http://127.0.0.1:${PUERTO_CDP}/json/list`);
  const pagina = lista.find((objetivo) => objetivo.type === "page" && objetivo.url.startsWith(URL_BASE)) ?? lista.find((objetivo) => objetivo.type === "page");
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

  // Esperamos a que el DOM y el modulo esten listos de verdad.
  let listo = false;
  for (let i = 0; i < 80; i += 1) {
    listo = await evaluar(
      "document.readyState === 'complete' && !!document.getElementById('archivo-galeria')",
    );
    if (listo) break;
    await dormir(150);
  }
  if (!listo) throw new Error("la pagina no termino de cargar");

  const datosDelEvento = `(async () => {
    const respuesta = await fetch("./tools/fixtures/foto.jpg");
    const blob = await respuesta.blob();
    return new File([blob], "foto.jpg", { type: "image/jpeg" });
  })()`;

  if (MODO === "input" || MODO === "wasm") {
    const ok = await evaluar(`(async () => {
      const archivo = await ${datosDelEvento};
      const datos = new DataTransfer();
      datos.items.add(archivo);
      const input = document.getElementById("archivo-galeria");
      input.files = datos.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`, { awaitPromise: true });
    if (!ok) throw new Error("no se pudo inyectar el archivo");
  } else {
    const tipoEvento = MODO === "drop" ? "DragEvent" : "ClipboardEvent";
    const campoDatos = MODO === "drop" ? "dataTransfer" : "clipboardData";
    const ok = await evaluar(`(async () => {
      const blob = await (await fetch("./tools/fixtures/foto.jpg")).blob();
      const archivo = new File([blob], "foto.jpg", { type: "image/jpeg" });
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

  console.log("estado tras inyectar:", await evaluar(`JSON.stringify({
    archivos: document.getElementById("archivo-galeria").files.length,
    progreso: !document.getElementById("progreso").hidden,
    resultado: !document.getElementById("resultado").hidden,
  })`));

  let visible = false;
  for (let i = 0; i < 100; i += 1) {
    visible = await evaluar("!document.getElementById('resultado').hidden");
    if (visible) break;
    await dormir(150);
  }
  if (!visible) {
    const detalle = await evaluar(`JSON.stringify({
      url: location.href,
      titulo: document.title,
      texto: document.body ? document.body.innerText.slice(0, 240) : "sin body",
      error: (document.getElementById("error") || {}).hidden === false
        ? document.getElementById("error-detalle").textContent
        : "sin error",
    })`);
    throw new Error(`no aparecio el resultado (${detalle})`);
  }

  await dormir(600);

  const datos = await evaluar(`(async () => {
    const src = document.getElementById("vista-webp").src;
    const blob = await (await fetch(src)).blob();
    return {
      tipo: blob.type,
      pesoWebp: blob.size,
      pesoOriginal: document.getElementById("peso-original").textContent,
      pesoWebpTexto: document.getElementById("peso-webp").textContent,
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

  await dormir(700);
  await esperarQuieto();
  const trasCalidad = await evaluar(`({
    peso: document.getElementById("peso-webp").textContent,
    calidad: document.getElementById("calidad-usada").textContent,
  })`);
  console.log("calidad 50%:", JSON.stringify(trasCalidad));
  if (trasCalidad.calidad !== "50 %") throw new Error("la calidad no se aplico");

  // Elegir 800 px tiene que redimensionar.
  await evaluar(`(() => {
    document.querySelector('.chip[data-max="800"]').click();
    return true;
  })()`);
  await dormir(700);
  await esperarQuieto();
  const trasTamano = await evaluar("document.getElementById('dimensiones').textContent");
  console.log("max 800:", trasTamano);
  if (!/^800 × 600 px$/.test(trasTamano)) throw new Error(`tamano inesperado: ${trasTamano}`);

  const metricas = await cdp.enviar("Page.getLayoutMetrics");
  const { width, height } = metricas.cssContentSize;
  const captura = await cdp.enviar("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  writeFileSync(`.shots/e2e-${SHOT}-${MODO}.png`, Buffer.from(captura.data, "base64"));

  if (PROBAR_OFFLINE) {
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

  console.log(`OK ${SHOT}`);
  salida = 0;
} catch (error) {
  console.error(`FALLO: ${error.message}`);
  for (const evento of eventos.slice(-8)) {
    if (evento.method === "Runtime.exceptionThrown") {
      console.error("excepcion:", JSON.stringify(evento.params.exceptionDetails).slice(0, 400));
    }
    if (evento.method === "Runtime.consoleAPICalled") {
      console.error("console:", evento.params.args?.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
    }
  }
} finally {
  chrome.kill("SIGKILL");
  sitio.kill("SIGKILL");
}

process.exit(salida);
