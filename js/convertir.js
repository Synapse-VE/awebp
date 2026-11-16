import { calcularObjetivo } from "./reglas.js";

/**
 * Convierte un archivo de imagen a WebP usando el canvas del navegador.
 *
 * Ojo: Safari no sabe codificar WebP y devuelve PNG en silencio; por eso se
 * verifica el tipo del blob resultante en vez de confiar en la llamada.
 *
 * @param {File | Blob} archivo
 * @param {{calidad?: number, maxLado?: number}} [opciones]
 * @returns {Promise<{blob: Blob, ancho: number, alto: number, original: {ancho: number, alto: number}, escalado: boolean, motivo: string, calidad: number}>}
 */
export async function convertir(archivo, opciones = {}) {
  const calidad = Math.min(1, Math.max(0.1, opciones.calidad ?? 0.8));
  const maxLado = opciones.maxLado ?? 0;

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

    const blob = await codificar(lienzo, calidad);

    return {
      blob,
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
          dibujar: (contexto, ancho, alto) => contexto.drawImage(bitmap, 0, 0, ancho, alto),
          cerrar: () => bitmap.close?.(),
        };
      } catch {
        // Probamos la siguiente forma; si ninguna anda, caemos al <img>.
      }
    }
  }

  return decodificarConImagen(archivo);
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
async function codificar(lienzo, calidad) {
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

  throw crearError("SIN_WEBP");
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
