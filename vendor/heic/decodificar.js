import crearLibheif from "./libheif-bundle.mjs";

let promesaLibheif;

function obtenerLibheif() {
  if (!promesaLibheif) promesaLibheif = crearLibheif();
  return promesaLibheif;
}

/**
 * Decodifica un HEIC/HEIF con libheif compilado a WebAssembly.
 *
 * El bundle trae el wasm embebido (~2 MB) y se carga solo cuando aparece un
 * archivo HEIC que el navegador no pudo abrir por su cuenta.
 *
 * @param {ArrayBuffer | Uint8Array} buffer
 * @returns {Promise<{ancho: number, alto: number, datos: Uint8ClampedArray}>}
 */
export async function decodificarHeic(buffer) {
  const libheif = await obtenerLibheif();
  await libheif.ready;

  const decoder = new libheif.HeifDecoder();
  const imagenes = decoder.decode(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));

  if (!imagenes || imagenes.length === 0) {
    throw new Error("el HEIC no tiene imagenes");
  }

  // Suele haber una imagen principal y una miniatura; nos quedamos con la grande.
  let principal = imagenes[0];
  for (const imagen of imagenes) {
    if (imagen.get_width() * imagen.get_height() > principal.get_width() * principal.get_height()) {
      principal = imagen;
    }
  }

  const ancho = principal.get_width();
  const alto = principal.get_height();

  const resultado = await new Promise((resolver, rechazar) => {
    principal.display(
      { data: new Uint8ClampedArray(ancho * alto * 4), width: ancho, height: alto },
      (datos) => (datos ? resolver(datos) : rechazar(new Error("no se pudo dibujar el HEIC"))),
    );
  });

  for (const imagen of imagenes) imagen.free?.();

  return { ancho, alto, datos: resultado.data };
}
