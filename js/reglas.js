import { ajustarTamano, formatoBytes } from "./formato.js";

/** Tamano maximo de archivo aceptado (30 MB). */
export const LIMITE_BYTES = 30 * 1024 * 1024;

/** Limite practico de pixeles de un canvas (Safari revienta arriba de ~16.7 MP). */
export const MAX_PIXELES = 16_000_000;

/**
 * Revisa si el archivo se puede procesar.
 * @param {{type?: string, size?: number, name?: string}} archivo
 * @returns {{ok: true} | {ok: false, codigo: string, mensaje: string}}
 */
export function validarArchivo(archivo) {
  if (!archivo?.type || !archivo.type.startsWith("image/")) {
    return { ok: false, codigo: "NO_ES_IMAGEN", mensaje: "Ese archivo no es una imagen." };
  }

  if ((archivo.size ?? 0) > LIMITE_BYTES) {
    return {
      ok: false,
      codigo: "MUY_GRANDE",
      mensaje: `La foto pesa ${formatoBytes(archivo.size)}. El maximo es ${formatoBytes(LIMITE_BYTES)}.`,
    };
  }

  return { ok: true };
}

/**
 * Calcula el tamano final: primero aplica el maximo por lado y despues el tope de pixeles.
 * @param {number} ancho
 * @param {number} alto
 * @param {number} [maxLado] 0 o menos = sin limite por lado
 * @returns {{ancho: number, alto: number, escalado: boolean, motivo: "" | "lado" | "pixeles"}}
 */
export function calcularObjetivo(ancho, alto, maxLado = 0) {
  let resultado = { ancho, alto, escalado: false, motivo: "" };

  if (maxLado > 0) {
    const ajustado = ajustarTamano(ancho, alto, maxLado);
    resultado = {
      ancho: ajustado.ancho,
      alto: ajustado.alto,
      escalado: ajustado.escalado,
      motivo: ajustado.escalado ? "lado" : "",
    };
  }

  const pixeles = resultado.ancho * resultado.alto;
  if (pixeles > MAX_PIXELES) {
    const factor = Math.sqrt(MAX_PIXELES / pixeles);
    resultado = {
      ancho: Math.max(1, Math.floor(resultado.ancho * factor)),
      alto: Math.max(1, Math.floor(resultado.alto * factor)),
      escalado: true,
      motivo: "pixeles",
    };
  }

  return resultado;
}

const MENSAJES = {
  NO_ES_IMAGEN: "Ese archivo no es una imagen.",
  MUY_GRANDE: "La foto pesa demasiado. El maximo es 30 MB.",
  DECODIFICAR:
    "No pudimos leer esta imagen. Si viene de un iPhone en HEIC, proba con JPG o activa Ajustes > Camara > Formatos > Mas compatible.",
  SIN_WEBP: "Tu navegador no puede generar WebP todavia. Proba con Chrome o desde Android.",
  SIN_CANVAS: "Este navegador no puede procesar imagenes.",
};

/**
 * Traduce un error de conversion a un mensaje para la persona.
 * @param {Error & {codigo?: string}} error
 * @returns {string}
 */
export function mensajeDeError(error) {
  return MENSAJES[error?.codigo] ?? "Algo salio mal al convertir. Proba con otra foto.";
}
