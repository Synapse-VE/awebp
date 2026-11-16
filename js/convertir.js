import { calcularObjetivo, esMarcaHeic } from "./reglas.js";

/**
 * Convierte un archivo de imagen a WebP usando el canvas del navegador.
 *
 * Ojo: Safari no sabe codificar WebP y devuelve PNG en silencio; por eso se
 * verifica el tipo del blob resultante en vez de confiar en la llamada.
 *
 * Si el navegador no puede ni abrir la imagen (tipico con HEIC en Android o
 * Chrome de escritorio), se intenta decodificar con libheif en WebAssembly.
 *
 * @param {File | Blob} archivo
 * @param {{calidad?: number, maxLado?: number, forzarWasm?: boolean}} [opciones]
 * @returns {Promise<{blob: Blob, ancho: number, alto: number, original: {ancho: number, alto: number}, escalado: boolean, motivo: string, calidad: number}>}
 */
export async function convertir(archivo, opciones = {}) {
  const calidad = Math.min(1, Math.max(0.1, opciones.calidad ?? 0.8));
  const maxLado = opciones.maxLado ?? 0;
  const forzarWasm = opciones.forzarWasm === true;

  const fuente = await decodificar(archivo);
  const objetivo = calcularObjetivo(fuente.ancho, fuente.alto, maxLado);

  try {
    const lienzo = document.createElement("canvas");
    lienzo.width = objetivo.ancho;
    lienzo.height = objetivo.alto;

    const contexto = lienzo.getContext("2d");
    if (!contexto) throw crearError("SIN_CANVAS");

    contexto.imageSmoothingEnabled = true;
    contexto.imageSmoothingQuality = "high";
    fuente.dibujar(contexto, objetivo.ancho, objetivo.alto);

    const blob = await codificar(lienzo, calidad, { forzarWasm });
    const vistaOriginal = fuente.previsualizable ? null : await crearVistaPrevia(fuente, fuente.ancho, fuente.alto);

    return {
      blob,
      vistaOriginal,
      ancho: objetivo.ancho,
      alto: objetivo.alto,
      original: { ancho: fuente.ancho, alto: fuente.alto },
      escalado: objetivo.escalado,
      motivo: objetivo.motivo,
      calidad,
    };
  } finally {
    fuente.cerrar();
  }
}

function crearError(codigo) {
  const error = new Error(codigo);
  error.codigo = codigo;
  return error;
}

/**
 * @param {File | Blob} archivo
 */
async function decodificar(archivo) {
  if (typeof createImageBitmap === "function") {
    const intentos = [{ imageOrientation: "from-image" }, undefined];

    for (const opciones of intentos) {
      try {
        const bitmap = await createImageBitmap(archivo, opciones);
        return {
          ancho: bitmap.width,
          alto: bitmap.height,
          previsualizable: true,
          dibujar: (contexto, ancho, alto) => contexto.drawImage(bitmap, 0, 0, ancho, alto),
          cerrar: () => bitmap.close?.(),
        };
      } catch {
        // Probamos la siguiente forma; si ninguna anda, caemos al <img>.
      }
    }
  }

  try {
    return await decodificarConImagen(archivo);
  } catch (error) {
    // Si el navegador no puede y el archivo es HEIC/HEIF, probamos libheif.
    if (await esHeic(archivo)) {
      return await decodificarConLibheif(archivo);
    }
    throw error;
  }
}

/**
 * Revisa la caja ISO-BMFF del archivo para saber si es HEIC/HEIF.
 * @param {File | Blob} archivo
 * @returns {Promise<boolean>}
 */
async function esHeic(archivo) {
  try {
    return esMarcaHeic(new Uint8Array(await archivo.slice(0, 16).arrayBuffer()));
  } catch {
    return false;
  }
}

/**
 * Decodifica con libheif y devuelve la imagen como fuente dibujable.
 * @param {File | Blob} archivo
 */
async function decodificarConLibheif(archivo) {
  let decodificado;

  try {
    const buffer = await archivo.arrayBuffer();
    const { decodificarHeic } = await import("../vendor/heic/decodificar.js");
    decodificado = await decodificarHeic(buffer);
  } catch {
    throw crearError("DECODIFICAR");
  }

  const { ancho, alto, datos } = decodificado;

  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;

  const contexto = lienzo.getContext("2d");
  if (!contexto) throw crearError("SIN_CANVAS");

  contexto.putImageData(new ImageData(new Uint8ClampedArray(datos), ancho, alto), 0, 0);

  return {
    ancho,
    alto,
    previsualizable: false,
    dibujar: (destino, anchoDestino, altoDestino) => destino.drawImage(lienzo, 0, 0, anchoDestino, altoDestino),
    cerrar: () => {
      lienzo.width = 0;
      lienzo.height = 0;
    },
  };
}

/**
 * Camino de respaldo para navegadores sin createImageBitmap utilizable.
 * @param {File | Blob} archivo
 */
async function decodificarConImagen(archivo) {
  const url = URL.createObjectURL(archivo);

  try {
    const imagen = new Image();
    imagen.decoding = "async";

    await new Promise((resolver, rechazar) => {
      imagen.onload = () => resolver();
      imagen.onerror = () => rechazar(crearError("DECODIFICAR"));
      imagen.src = url;
    });

    if (!imagen.naturalWidth || !imagen.naturalHeight) throw crearError("DECODIFICAR");

    return {
      ancho: imagen.naturalWidth,
      alto: imagen.naturalHeight,
      previsualizable: true,
      dibujar: (contexto, ancho, alto) => contexto.drawImage(imagen, 0, 0, ancho, alto),
      cerrar: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error.codigo ? error : crearError("DECODIFICAR");
  }
}

/**
 * Codifica el lienzo probando tres caminos, del mas moderno al mas compatible.
 *
 * 1. OffscreenCanvas.convertToBlob: promesa, sin callbacks, la mas confiable.
 * 2. canvas.toBlob con limite de tiempo: en algunos Chrome headless nunca llama.
 * 3. toDataURL: sincronico, ultimo recurso.
 *
 * @param {HTMLCanvasElement} lienzo
 * @param {number} calidad
 * @returns {Promise<Blob>}
 */
async function codificar(lienzo, calidad, { forzarWasm = false } = {}) {
  if (forzarWasm) {
    return codificarConWasm(lienzo, calidad);
  }

  if (typeof OffscreenCanvas === "function") {
    try {
      const fueraDePantalla = new OffscreenCanvas(lienzo.width, lienzo.height);
      const contexto = fueraDePantalla.getContext("2d");

      if (contexto) {
        contexto.drawImage(lienzo, 0, 0);
        const blob = await fueraDePantalla.convertToBlob({ type: "image/webp", quality: calidad });
        if (blob?.type === "image/webp") return blob;
      }
    } catch {
      // Seguimos con los otros caminos.
    }
  }

  try {
    const porCallback = await conLimite(
      new Promise((resolver) => lienzo.toBlob(resolver, "image/webp", calidad)),
      10_000,
    );
    if (porCallback?.type === "image/webp") return porCallback;
  } catch {
    // toBlob no respondio a tiempo.
  }

  try {
    const dataUrl = lienzo.toDataURL("image/webp", calidad);
    if (dataUrl.startsWith("data:image/webp")) {
      return await (await fetch(dataUrl)).blob();
    }
  } catch {
    // Tampoco hay suerte por aca.
  }

  try {
    return await codificarConWasm(lienzo, calidad);
  } catch {
    throw crearError("SIN_WEBP");
  }
}

/**
 * Genera un JPEG chico para mostrar como "original" cuando el navegador no
 * puede pintar el archivo (caso HEIC).
 * @param {{dibujar: Function}} fuente
 * @param {number} ancho
 * @param {number} alto
 * @returns {Promise<Blob | null>}
 */
async function crearVistaPrevia(fuente, ancho, alto) {
  const limite = 720;
  const escala = Math.min(1, limite / Math.max(ancho, alto));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.max(1, Math.round(ancho * escala));
  lienzo.height = Math.max(1, Math.round(alto * escala));

  const contexto = lienzo.getContext("2d");
  if (!contexto) return null;

  fuente.dibujar(contexto, lienzo.width, lienzo.height);
  return new Promise((resolver) => lienzo.toBlob(resolver, "image/jpeg", 0.82));
}

/**
 * Ultimo recurso: libwebp en WebAssembly. Es el unico camino que funciona en
 * Safari, que no sabe codificar WebP con el canvas.
 * @param {HTMLCanvasElement} lienzo
 * @param {number} calidad 0-1
 * @returns {Promise<Blob>}
 */
async function codificarConWasm(lienzo, calidad) {
  const contexto = lienzo.getContext("2d");
  if (!contexto) throw crearError("SIN_CANVAS");

  const datos = contexto.getImageData(0, 0, lienzo.width, lienzo.height);
  const { codificarWebp } = await import("../vendor/webp/codificar.js");

  return codificarWebp(datos, { calidad: calidad * 100 });
}

/**
 * Rechaza si la promesa no se resuelve a tiempo.
 * @template T
 * @param {Promise<T>} promesa
 * @param {number} ms
 * @returns {Promise<T>}
 */
function conLimite(promesa, ms) {
  return new Promise((resolver, rechazar) => {
    const reloj = setTimeout(() => rechazar(crearError("TIEMPO")), ms);
    promesa.then(
      (valor) => {
        clearTimeout(reloj);
        resolver(valor);
      },
      (error) => {
        clearTimeout(reloj);
        rechazar(error);
      },
    );
  });
}
