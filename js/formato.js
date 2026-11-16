const UNIDADES = ["B", "KB", "MB", "GB"];

/**
 * Convierte una cantidad de bytes a algo legible.
 * @param {number} bytes
 * @param {{decimales?: number}} [opciones]
 * @returns {string}
 */
export function formatoBytes(bytes, { decimales = 1 } = {}) {
  const valor = Number(bytes);

  if (!Number.isFinite(valor) || valor < 0) return "-";
  if (valor < 1024) return `${Math.round(valor)} B`;

  let tamano = valor;
  let unidad = 0;

  while (tamano >= 1024 && unidad < UNIDADES.length - 1) {
    tamano /= 1024;
    unidad += 1;
  }

  const redondeado = tamano >= 10 ? Math.round(tamano) : Number(tamano.toFixed(decimales));
  return `${redondeado} ${UNIDADES[unidad]}`;
}

/**
 * Nombre de archivo sin extension.
 * @param {string} nombre
 * @returns {string}
 */
export function sinExtension(nombre) {
  return String(nombre).replace(/\.[^./\\]+$/, "") || "imagen";
}

/**
 * Nombre de salida en WebP.
 * @param {string} nombre
 * @returns {string}
 */
export function nombreWebp(nombre) {
  return `${sinExtension(nombre)}.webp`;
}

/**
 * Porcentaje de ahorro (positivo si el resultado pesa menos).
 * @param {number} original
 * @param {number} convertido
 * @returns {number}
 */
export function ahorroPorcentual(original, convertido) {
  if (!Number.isFinite(original) || original <= 0) return 0;
  const ahorro = ((original - convertido) / original) * 100;
  return Math.round(ahorro);
}

/**
 * Ajusta una medida a un maximo conservando la proporcion.
 * @param {number} ancho
 * @param {number} alto
 * @param {number} maximo
 * @returns {{ancho: number, alto: number, escalado: boolean}}
 */
export function ajustarTamano(ancho, alto, maximo) {
  const mayor = Math.max(ancho, alto);

  if (!Number.isFinite(mayor) || mayor <= 0 || mayor <= maximo) {
    return { ancho, alto, escalado: false };
  }

  const factor = maximo / mayor;
  return {
    ancho: Math.max(1, Math.round(ancho * factor)),
    alto: Math.max(1, Math.round(alto * factor)),
    escalado: true,
  };
}
