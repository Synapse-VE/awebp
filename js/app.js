import { convertir } from "./convertir.js";
import { ahorroPorcentual, formatoBytes, nombreWebp } from "./formato.js";
import { mensajeDeError, validarArchivo } from "./reglas.js";

const $ = (id) => document.getElementById(id);

const el = {
  zona: $("zona"),
  botonCamara: $("boton-camara"),
  botonElegir: $("boton-elegir"),
  inputCamara: $("archivo-camara"),
  inputGaleria: $("archivo-galeria"),
  progreso: $("progreso"),
  resultado: $("resultado"),
  ajustes: $("ajustes"),
  error: $("error"),
  errorTitulo: $("error-titulo"),
  errorDetalle: $("error-detalle"),
  errorReintentar: $("error-reintentar"),
  vistaOriginal: $("vista-original"),
  vistaWebp: $("vista-webp"),
  pesoOriginal: $("peso-original"),
  pesoWebp: $("peso-webp"),
  ahorro: $("ahorro"),
  dimensiones: $("dimensiones"),
  calidadUsada: $("calidad-usada"),
  descargar: $("descargar"),
  instalar: $("instalar"),
  ayudaInstalar: $("ayuda-instalar"),
  compartir: $("compartir"),
  otra: $("otra"),
  calidad: $("calidad"),
  valorCalidad: $("valor-calidad"),
  chips: [...document.querySelectorAll(".chip")],
};

const forzarWasm = new URLSearchParams(location.search).has("wasm");

const estado = {
  archivo: null,
  calidad: 0.8,
  maxLado: 0,
  blob: null,
  nombre: "foto.webp",
  token: 0,
  urls: [],
  vistaOriginal: null,
};

const VISTAS = ["zona", "progreso", "resultado", "ajustes", "error"];

function ver(...visibles) {
  for (const vista of VISTAS) {
    el[vista].hidden = !visibles.includes(vista);
  }
}

function limpiarUrls() {
  for (const url of estado.urls) URL.revokeObjectURL(url);
  estado.urls = [];
}

function crearError(codigo) {
  const error = new Error(codigo);
  error.codigo = codigo;
  return error;
}

async function procesar({ silencioso = false } = {}) {
  if (!estado.archivo) return;

  const token = ++estado.token;

  if (silencioso) {
    el.resultado.classList.add("cargando");
  } else {
    ver("progreso");
    el.progreso.setAttribute("aria-busy", "true");
  }

  try {
    const resultado = await convertir(estado.archivo, {
      calidad: estado.calidad,
      maxLado: estado.maxLado,
      forzarWasm,
    });

    if (token !== estado.token) return;

    estado.blob = resultado.blob;
    estado.nombre = nombreWebp(estado.archivo.name || "foto");

    pintar(resultado);
    ver("resultado", "ajustes");

    if (!silencioso) {
      el.resultado.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  } catch (error) {
    if (token !== estado.token) return;
    mostrarError(error.codigo ?? "DESCONOCIDO", mensajeDeError(error));
  } finally {
    el.resultado.classList.remove("cargando");
    el.progreso.setAttribute("aria-busy", "false");
  }
}

function pintar(resultado) {
  limpiarUrls();

  // La vista previa se conserva entre reconversiones: no va en estado.urls.
  if (resultado.vistaOriginal && !estado.vistaOriginal) {
    estado.vistaOriginal = URL.createObjectURL(resultado.vistaOriginal);
  }

  const urlOriginal = estado.vistaOriginal ?? URL.createObjectURL(estado.archivo);
  const urlWebp = URL.createObjectURL(resultado.blob);
  if (!estado.vistaOriginal) estado.urls.push(urlOriginal);
  estado.urls.push(urlWebp);

  el.vistaOriginal.src = urlOriginal;
  el.vistaWebp.src = urlWebp;
  el.pesoOriginal.textContent = formatoBytes(estado.archivo.size);
  el.pesoWebp.textContent = formatoBytes(resultado.blob.size);

  const ahorro = ahorroPorcentual(estado.archivo.size, resultado.blob.size);
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

function actualizarCompartir() {
  let puede = false;

  if (estado.blob && typeof navigator.canShare === "function") {
    try {
      const archivo = new File([estado.blob], estado.nombre, { type: "image/webp" });
      puede = navigator.canShare({ files: [archivo] });
    } catch {
      puede = false;
    }
  }

  el.compartir.hidden = !puede;
}

function mostrarError(codigo, mensaje) {
  estado.archivo = null;
  el.errorTitulo.textContent = codigo === "MUY_GRANDE" ? "La foto es muy grande" : "No se pudo convertir";
  el.errorDetalle.textContent = mensaje;
  ver("error");
}

async function tomarArchivo(archivo) {
  if (!archivo) return;

  const revision = validarArchivo(archivo);
  if (!revision.ok) {
    mostrarError(revision.codigo, revision.mensaje);
    return;
  }

  estado.archivo = archivo;
  estado.blob = null;
  estado.vistaOriginal = null;
  await procesar();
}

async function descargar() {
  if (!estado.blob) return;

  const url = URL.createObjectURL(estado.blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = estado.nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function compartir() {
  if (!estado.blob) return;

  try {
    const archivo = new File([estado.blob], estado.nombre, { type: "image/webp" });
    await navigator.share({ files: [archivo], title: "Foto en WebP" });
  } catch {
    // Cancelar el menu de compartir no es un error.
  }
}

function reiniciar() {
  estado.token += 1;
  estado.archivo = null;
  estado.blob = null;
  if (estado.vistaOriginal) URL.revokeObjectURL(estado.vistaOriginal);
  estado.vistaOriginal = null;
  limpiarUrls();
  el.vistaOriginal.removeAttribute("src");
  el.vistaWebp.removeAttribute("src");
  el.inputCamara.value = "";
  el.inputGaleria.value = "";
  ver("zona");
}

let temporizador;

function reprogramar() {
  if (!estado.archivo) return;
  clearTimeout(temporizador);
  temporizador = setTimeout(() => procesar({ silencioso: true }), 220);
}

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
  const [archivo] = evento.dataTransfer.files ?? [];
  tomarArchivo(archivo);
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
  tomarArchivo(archivo);
});

el.botonCamara.addEventListener("click", () => el.inputCamara.click());
el.botonElegir.addEventListener("click", () => el.inputGaleria.click());

el.zona.addEventListener("click", (evento) => {
  if (evento.target.closest("button")) return;
  el.inputGaleria.click();
});

for (const input of [el.inputCamara, el.inputGaleria]) {
  input.addEventListener("change", () => {
    const [archivo] = input.files ?? [];
    tomarArchivo(archivo);
  });
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

el.descargar.addEventListener("click", descargar);
el.compartir.addEventListener("click", compartir);
el.otra.addEventListener("click", reiniciar);
el.errorReintentar.addEventListener("click", reiniciar);

ver("zona");

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

  // En iPhone no existe el prompt: mostramos las instrucciones.
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
