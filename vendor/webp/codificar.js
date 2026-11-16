import { defaultOptions } from "./meta.js";
import crearModulo from "./webp_enc.js";

let promesaModulo;

function obtenerModulo() {
  if (!promesaModulo) {
    promesaModulo = crearModulo({ noInitialRun: true });
  }
  return promesaModulo;
}

/**
 * Codifica pixel data en WebP con libwebp compilado a WebAssembly.
 * @param {ImageData} datos
 * @param {{calidad?: number}} [opciones] calidad en 0-100
 * @returns {Promise<Blob>}
 */
export async function codificarWebp(datos, { calidad = 80 } = {}) {
  const modulo = await obtenerModulo();

  const salida = modulo.encode(datos.data, datos.width, datos.height, {
    ...defaultOptions,
    quality: Math.round(calidad),
  });

  if (!salida) {
    throw new Error("libwebp no devolvio datos");
  }

  return new Blob([salida], { type: "image/webp" });
}
