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
  compartir: $("compartir"),
  otra: $("otra"),
  calidad: $("calidad"),
  valorCalidad: $("valor-calidad"),
  chips: [...document.querySelectorAll(".chip")],
};

const estado = {
  archivo: null,
  calidad: 0.8,
  maxLado: 0,
  blob: null,
  nombre: "foto.webp",
  token: 0,
  urls: [],
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

  const urlOriginal = URL.createObjectURL(estado.archivo);
  const urlWebp = URL.createObjectURL(resultado.blob);
  estado.urls.push(urlOriginal, urlWebp);

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
