import { convertir } from "./convertir.js";
import { ahorroPorcentual, formatoBytes, nombreWebp } from "./formato.js";
import { mensajeDeError, validarArchivo } from "./reglas.js";
import { crearZip } from "./zip.js";

const $ = (id) => document.getElementById(id);

const MAX_ARCHIVOS = 10;
const forzarWasm = new URLSearchParams(location.search).has("wasm");

const el = {
  zona: $("zona"),
  botonCamara: $("boton-camara"),
  botonElegir: $("boton-elegir"),
  inputCamara: $("archivo-camara"),
  inputGaleria: $("archivo-galeria"),
  progreso: $("progreso"),
  progresoTexto: $("progreso-texto"),
  resultado: $("resultado"),
  lista: $("lista"),
  listaTitulo: $("lista-titulo"),
  listaResumen: $("lista-resumen"),
  listaItems: $("lista-items"),
  listaAviso: $("lista-aviso"),
  ajustes: $("ajustes"),
  error: $("error"),
  errorTitulo: $("error-titulo"),
  errorDetalle: $("error-detalle"),
  errorReintentar: $("error-reintentar"),
  aviso: $("aviso"),
  vistaOriginal: $("vista-original"),
  vistaWebp: $("vista-webp"),
  pesoOriginal: $("peso-original"),
  pesoWebp: $("peso-webp"),
  ahorro: $("ahorro"),
  dimensiones: $("dimensiones"),
  calidadUsada: $("calidad-usada"),
  descargar: $("descargar"),
  compartir: $("compartir"),
  otra: $("otra"),
  descargarZip: $("descargar-zip"),
  agregar: $("agregar"),
  otraLista: $("otra-lista"),
  calidad: $("calidad"),
  valorCalidad: $("valor-calidad"),
  instalar: $("instalar"),
  ayudaInstalar: $("ayuda-instalar"),
  chips: [...document.querySelectorAll(".chip")],
};

const estado = {
  archivos: [],
  resultados: [],
  calidad: 0.8,
  maxLado: 0,
  token: 0,
  urls: [],
  vistas: new Map(),
};

const VISTAS = ["zona", "progreso", "resultado", "lista", "ajustes", "error"];

function ver(...visibles) {
  for (const vista of VISTAS) {
    el[vista].hidden = !visibles.includes(vista);
  }
}

function limpiarUrls() {
  for (const url of estado.urls) URL.revokeObjectURL(url);
  estado.urls = [];
}

function limpiarTodo() {
  estado.token += 1;
  estado.archivos = [];
  estado.resultados = [];
  limpiarUrls();
  for (const url of estado.vistas.values()) URL.revokeObjectURL(url);
  estado.vistas.clear();
  el.inputCamara.value = "";
  el.inputGaleria.value = "";
}

function marcarCargando(activo) {
  el.resultado.classList.toggle("cargando", activo);
  el.lista.classList.toggle("cargando", activo);
}

let temporizadorAviso;

function mostrarAviso(texto) {
  el.aviso.textContent = texto;
  el.aviso.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => {
    el.aviso.hidden = true;
  }, 7000);
}

function crearError(codigo) {
  const error = new Error(codigo);
  error.codigo = codigo;
  return error;
}

function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function nombreUnico(base, usados) {
  if (!usados.has(base)) {
    usados.add(base);
    return base;
  }

  const punto = base.lastIndexOf(".");
  const raiz = punto > 0 ? base.slice(0, punto) : base;
  const extension = punto > 0 ? base.slice(punto) : "";

  let indice = 1;
  let nombre;
  do {
    nombre = `${raiz}-${indice}${extension}`;
    indice += 1;
  } while (usados.has(nombre));

  usados.add(nombre);
  return nombre;
}

/* ---------- conversion ---------- */

async function procesarTodo({ silencioso = false } = {}) {
  if (estado.archivos.length === 0) return;

  const token = ++estado.token;
  const resultados = [];

  if (silencioso) {
    marcarCargando(true);
  } else {
    ver("progreso");
  }

  el.progreso.setAttribute("aria-busy", "true");

  try {
    for (const [indice, archivo] of estado.archivos.entries()) {
      if (token !== estado.token) return;

      el.progresoTexto.textContent =
        estado.archivos.length > 1
          ? `Convirtiendo ${indice + 1} de ${estado.archivos.length}…`
          : "Convirtiendo…";

      try {
        const resultado = await convertir(archivo, {
          calidad: estado.calidad,
          maxLado: estado.maxLado,
          forzarWasm,
        });

        if (resultado.vistaOriginal && !estado.vistas.has(archivo)) {
          estado.vistas.set(archivo, URL.createObjectURL(resultado.vistaOriginal));
        }

        resultados.push({ archivo, ...resultado });
      } catch (error) {
        resultados.push({ archivo, error: error?.codigo ?? "DESCONOCIDO" });
      }
    }

    if (token !== estado.token) return;

    estado.resultados = resultados;
    pintarTodo({ desplazar: !silencioso });
  } finally {
    marcarCargando(false);
    el.progreso.setAttribute("aria-busy", "false");
  }
}

function pintarTodo({ desplazar = false } = {}) {
  const validos = estado.resultados.filter((resultado) => !resultado.error);
  const errores = estado.resultados.filter((resultado) => resultado.error);

  if (validos.length === 0) {
    mostrarError(errores[0]?.error ?? "DESCONOCIDO");
    return;
  }

  if (validos.length === 1 && errores.length === 0) {
    pintarIndividual(validos[0]);
    ver("resultado", "ajustes");
    if (desplazar) el.resultado.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }

  pintarLista(validos, errores);
  ver("lista", "ajustes");
  if (desplazar) el.lista.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function urlOriginalDe(archivo) {
  const vista = estado.vistas.get(archivo);
  if (vista) return vista;

  const url = URL.createObjectURL(archivo);
  estado.urls.push(url);
  return url;
}

function pintarIndividual(resultado) {
  limpiarUrls();

  const urlOriginal = urlOriginalDe(resultado.archivo);
  const urlWebp = URL.createObjectURL(resultado.blob);
  estado.urls.push(urlWebp);

  el.vistaOriginal.src = urlOriginal;
  el.vistaWebp.src = urlWebp;
  el.pesoOriginal.textContent = formatoBytes(resultado.archivo.size);
  el.pesoWebp.textContent = formatoBytes(resultado.blob.size);

  const ahorro = ahorroPorcentual(resultado.archivo.size, resultado.blob.size);
  if (ahorro > 0) {
    el.ahorro.textContent = `−${ahorro} % de peso`;
  } else if (ahorro === 0) {
    el.ahorro.textContent = "Quedó igual de pesada";
  } else {
    el.ahorro.textContent = `Quedó ${Math.abs(ahorro)} % más pesada`;
  }
  el.ahorro.classList.toggle("negativo", ahorro <= 0);

  el.dimensiones.textContent = `${resultado.ancho} × ${resultado.alto} px`;
  el.calidadUsada.textContent = `${Math.round(resultado.calidad * 100)} %`;

  actualizarCompartir();
}

function pintarLista(validos, errores) {
  limpiarUrls();
  el.listaItems.replaceChildren();

  let totalOriginal = 0;
  let totalWebp = 0;

  for (const resultado of validos) {
    totalOriginal += resultado.archivo.size;
    totalWebp += resultado.blob.size;

    const fila = document.createElement("li");
    fila.className = "item";

    const miniatura = document.createElement("img");
    miniatura.className = "item-thumb";
    miniatura.src = urlOriginalDe(resultado.archivo);
    miniatura.alt = "";
    miniatura.loading = "lazy";

    const datos = document.createElement("div");
    const nombre = document.createElement("p");
    nombre.className = "item-nombre";
    nombre.textContent = resultado.archivo.name || "foto";

    const peso = document.createElement("p");
    peso.className = "item-peso";
    peso.append(`${formatoBytes(resultado.archivo.size)} → ${formatoBytes(resultado.blob.size)} · `);

    const ahorro = document.createElement("strong");
    const porcentaje = ahorroPorcentual(resultado.archivo.size, resultado.blob.size);
    ahorro.textContent = porcentaje >= 0 ? `−${porcentaje} %` : `+${Math.abs(porcentaje)} %`;
    peso.append(ahorro);

    datos.append(nombre, peso);

    const boton = document.createElement("button");
    boton.className = "boton item-boton";
    boton.type = "button";
    boton.textContent = "Descargar";
    boton.addEventListener("click", () => {
      descargarBlob(resultado.blob, nombreWebp(resultado.archivo.name || "foto"));
    });

    fila.append(miniatura, datos, boton);
    el.listaItems.append(fila);
  }

  const cantidad = validos.length;
  el.listaTitulo.textContent = `${cantidad} ${cantidad === 1 ? "foto" : "fotos"}`;

  const ahorroTotal = ahorroPorcentual(totalOriginal, totalWebp);
  const signo = ahorroTotal >= 0 ? "−" : "+";
  el.listaResumen.textContent = `${formatoBytes(totalOriginal)} → ${formatoBytes(totalWebp)} · ${signo}${Math.abs(ahorroTotal)} % de peso`;

  if (errores.length > 0) {
    el.listaAviso.textContent = `${errores.length} ${errores.length === 1 ? "foto no se pudo" : "fotos no se pudieron"} convertir.`;
    el.listaAviso.hidden = false;
  } else {
    el.listaAviso.hidden = true;
  }
}

function actualizarCompartir() {
  const resultado = estado.resultados[0];
  let puede = false;

  if (resultado?.blob && typeof navigator.canShare === "function") {
    try {
      const archivo = new File([resultado.blob], nombreWebp(resultado.archivo.name || "foto"), {
        type: "image/webp",
      });
      puede = navigator.canShare({ files: [archivo] });
    } catch {
      puede = false;
    }
  }

  el.compartir.hidden = !puede;
}

function mostrarError(codigo) {
  el.errorTitulo.textContent = codigo === "MUY_GRANDE" ? "La foto es muy grande" : "No se pudo convertir";
  el.errorDetalle.textContent = mensajeDeError({ codigo });
  ver("error");
}

async function agregarArchivos(lista) {
  const avisos = [];

  for (const archivo of lista) {
    if (estado.archivos.length >= MAX_ARCHIVOS) {
      avisos.push(`Máximo ${MAX_ARCHIVOS} fotos por tanda.`);
      break;
    }

    const revision = validarArchivo(archivo);
    if (!revision.ok) {
      avisos.push(`${archivo.name || "archivo"}: ${revision.mensaje}`);
      continue;
    }

    estado.archivos.push(archivo);
  }

  if (avisos.length > 0) mostrarAviso(avisos.join(" "));
  if (estado.archivos.length > 0) await procesarTodo();
}

/* ---------- acciones ---------- */

function descargarUna() {
  const resultado = estado.resultados.find((candidato) => !candidato.error);
  if (!resultado) return;

  descargarBlob(resultado.blob, nombreWebp(resultado.archivo.name || "foto"));
}

async function descargarZip() {
  const validos = estado.resultados.filter((resultado) => !resultado.error);
  const usados = new Set();
  const entradas = [];

  for (const resultado of validos) {
    const nombre = nombreUnico(nombreWebp(resultado.archivo.name || "foto"), usados);
    entradas.push({ nombre, datos: new Uint8Array(await resultado.blob.arrayBuffer()) });
  }

  descargarBlob(crearZip(entradas), "awebp.zip");
}

async function compartir() {
  const resultado = estado.resultados[0];
  if (!resultado?.blob) return;

  try {
    const archivo = new File([resultado.blob], nombreWebp(resultado.archivo.name || "foto"), {
      type: "image/webp",
    });
    await navigator.share({ files: [archivo], title: "Foto en WebP" });
  } catch {
    // Cancelar el menu de compartir no es un error.
  }
}

function reiniciar() {
  limpiarTodo();
  ver("zona");
recogerCompartido();
}

/* ---------- entrada ---------- */

function traeArchivos(evento) {
  return Boolean(evento.dataTransfer?.types?.includes("Files"));
}

let profundidadArrastre = 0;

window.addEventListener("dragenter", (evento) => {
  if (!traeArchivos(evento)) return;
  evento.preventDefault();
  profundidadArrastre += 1;
  document.body.classList.add("recibiendo");
});

window.addEventListener("dragover", (evento) => {
  if (traeArchivos(evento)) evento.preventDefault();
});

window.addEventListener("dragleave", (evento) => {
  if (!traeArchivos(evento)) return;
  profundidadArrastre = Math.max(0, profundidadArrastre - 1);
  if (profundidadArrastre === 0) document.body.classList.remove("recibiendo");
});

window.addEventListener("drop", (evento) => {
  if (!traeArchivos(evento)) return;
  evento.preventDefault();
  profundidadArrastre = 0;
  document.body.classList.remove("recibiendo");
  agregarArchivos([...evento.dataTransfer.files]);
});

window.addEventListener("paste", (evento) => {
  const datos = evento.clipboardData;
  if (!datos) return;

  const items = datos.items ? Array.from(datos.items) : [];
  const deItem = items
    .find((item) => item.kind === "file" && item.type.startsWith("image/"))
    ?.getAsFile();

  const archivos = datos.files ? Array.from(datos.files) : [];
  const archivo = deItem ?? archivos.find((candidato) => candidato.type.startsWith("image/"));

  if (!archivo) return;

  evento.preventDefault();
  agregarArchivos([archivo]);
});

el.botonCamara.addEventListener("click", () => el.inputCamara.click());
el.botonElegir.addEventListener("click", () => el.inputGaleria.click());
el.agregar.addEventListener("click", () => el.inputGaleria.click());

el.zona.addEventListener("click", (evento) => {
  if (evento.target.closest("button")) return;
  el.inputGaleria.click();
});

for (const input of [el.inputCamara, el.inputGaleria]) {
  input.addEventListener("change", () => {
    const archivos = [...(input.files ?? [])];
    input.value = "";
    agregarArchivos(archivos);
  });
}

let temporizador;

function reprogramar() {
  if (estado.archivos.length === 0) return;
  clearTimeout(temporizador);
  temporizador = setTimeout(() => procesarTodo({ silencioso: true }), 220);
}

el.calidad.addEventListener("input", () => {
  el.valorCalidad.textContent = `${el.calidad.value} %`;
  estado.calidad = Number(el.calidad.value) / 100;
  reprogramar();
});

for (const chip of el.chips) {
  chip.addEventListener("click", () => {
    for (const otro of el.chips) {
      const activo = otro === chip;
      otro.classList.toggle("activo", activo);
      otro.setAttribute("aria-pressed", String(activo));
    }
    estado.maxLado = Number(chip.dataset.max);
    reprogramar();
  });
}

el.descargar.addEventListener("click", descargarUna);
el.descargarZip.addEventListener("click", descargarZip);
el.compartir.addEventListener("click", compartir);
el.otra.addEventListener("click", reiniciar);
el.otraLista.addEventListener("click", reiniciar);
el.errorReintentar.addEventListener("click", reiniciar);

/* ---------- lo que llega compartido desde el sistema ---------- */

const CACHE_COMPARTIDO = "awebp-compartido-v1";
const BASE_COMPARTIDO = new URL("__compartido__/", document.baseURI).href;

async function recogerCompartido() {
  if (!location.search.includes("compartido")) return;
  if (!("caches" in window)) return;

  try {
    const cache = await caches.open(CACHE_COMPARTIDO);
    const respuestaIndice = await cache.match(new URL("indice", BASE_COMPARTIDO).href);

    if (respuestaIndice) {
      const indice = await respuestaIndice.json();
      const archivos = [];

      for (const [posicion, meta] of indice.entries()) {
        const respuesta = await cache.match(new URL(String(posicion), BASE_COMPARTIDO).href);
        if (!respuesta) continue;

        const blob = await respuesta.blob();
        archivos.push(
          new File([blob], meta.nombre || `foto-${posicion + 1}.jpg`, {
            type: meta.tipo || blob.type || "image/jpeg",
          }),
        );
      }

      await caches.delete(CACHE_COMPARTIDO);
      history.replaceState(null, "", location.pathname);

      if (archivos.length > 0) {
        await agregarArchivos(archivos);
      }

      return;
    }
  } catch {
    // Si falla, la app arranca normal.
  }

  history.replaceState(null, "", location.pathname);
}

/* ---------- PWA ---------- */

const instalada = () =>
  window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

const esIOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

let promptInstalacion = null;

window.addEventListener("beforeinstallprompt", (evento) => {
  evento.preventDefault();
  promptInstalacion = evento;
  if (!instalada()) el.instalar.hidden = false;
});

window.addEventListener("appinstalled", () => {
  el.instalar.hidden = true;
  el.ayudaInstalar.hidden = true;
});

el.instalar.addEventListener("click", async () => {
  if (promptInstalacion) {
    promptInstalacion.prompt();
    const { outcome } = await promptInstalacion.userChoice;
    if (outcome === "accepted") el.instalar.hidden = true;
    promptInstalacion = null;
    return;
  }

  el.ayudaInstalar.hidden = !el.ayudaInstalar.hidden;
});

if (esIOS && !instalada()) {
  el.instalar.hidden = false;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Sin service worker la app funciona igual, solo pierde el modo offline.
    });
  });
}

ver("zona");
recogerCompartido();
