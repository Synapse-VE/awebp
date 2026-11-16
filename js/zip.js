/**
 * Escritor de ZIP minimo (metodo "store", sin compresion).
 *
 * Las fotos ya vienen comprimidas, asi que comprimir otra vez solo gasta CPU.
 * Alcanza con armar las cabeceras y concatenar los bytes.
 */

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);

  for (let i = 0; i < 256; i += 1) {
    let valor = i;
    for (let bit = 0; bit < 8; bit += 1) {
      valor = valor & 1 ? 0xedb88320 ^ (valor >>> 1) : valor >>> 1;
    }
    tabla[i] = valor >>> 0;
  }

  return tabla;
})();

/**
 * CRC-32 de un bloque de bytes.
 * @param {Uint8Array} datos
 * @returns {number}
 */
export function crc32(datos) {
  let crc = 0xffffffff;
  for (let i = 0; i < datos.length; i += 1) {
    crc = TABLA_CRC[(crc ^ datos[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function fechaDos(fecha) {
  const hora = (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | Math.floor(fecha.getSeconds() / 2);
  const dia = ((fecha.getFullYear() - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate();
  return { hora, dia };
}

function escribirU16(destino, desplazamiento, valor) {
  destino[desplazamiento] = valor & 0xff;
  destino[desplazamiento + 1] = (valor >>> 8) & 0xff;
}

function escribirU32(destino, desplazamiento, valor) {
  destino[desplazamiento] = valor & 0xff;
  destino[desplazamiento + 1] = (valor >>> 8) & 0xff;
  destino[desplazamiento + 2] = (valor >>> 16) & 0xff;
  destino[desplazamiento + 3] = (valor >>> 24) & 0xff;
}

/**
 * Arma un ZIP en memoria.
 * @param {{nombre: string, datos: Uint8Array}[]} archivos
 * @param {Date} [ahora]
 * @returns {Blob}
 */
export function crearZip(archivos, ahora = new Date()) {
  const codificador = new TextEncoder();
  const { hora, dia } = fechaDos(ahora);

  const locales = [];
  const centrales = [];
  let desplazamiento = 0;

  for (const archivo of archivos) {
    const nombre = codificador.encode(archivo.nombre);
    const datos = archivo.datos;
    const crc = crc32(datos);

    const local = new Uint8Array(30 + nombre.length);
    escribirU32(local, 0, 0x04034b50);
    escribirU16(local, 4, 20); // version necesaria
    escribirU16(local, 6, 0x0800); // nombres en UTF-8
    escribirU16(local, 8, 0); // metodo: store
    escribirU16(local, 10, hora);
    escribirU16(local, 12, dia);
    escribirU32(local, 14, crc);
    escribirU32(local, 18, datos.length);
    escribirU32(local, 22, datos.length);
    escribirU16(local, 26, nombre.length);
    escribirU16(local, 28, 0);
    local.set(nombre, 30);

    locales.push(local, datos);

    const central = new Uint8Array(46 + nombre.length);
    escribirU32(central, 0, 0x02014b50);
    escribirU16(central, 4, 20); // version que lo creo
    escribirU16(central, 6, 20); // version necesaria
    escribirU16(central, 8, 0x0800);
    escribirU16(central, 10, 0);
    escribirU16(central, 12, hora);
    escribirU16(central, 14, dia);
    escribirU32(central, 16, crc);
    escribirU32(central, 20, datos.length);
    escribirU32(central, 24, datos.length);
    escribirU16(central, 28, nombre.length);
    escribirU16(central, 30, 0); // extra
    escribirU16(central, 32, 0); // comentario
    escribirU16(central, 34, 0); // disco
    escribirU16(central, 36, 0); // atributos internos
    escribirU32(central, 38, 0); // atributos externos
    escribirU32(central, 42, desplazamiento);
    central.set(nombre, 46);

    centrales.push(central);
    desplazamiento += local.length + datos.length;
  }

  const tamanioCentral = centrales.reduce((total, parte) => total + parte.length, 0);

  const fin = new Uint8Array(22);
  escribirU32(fin, 0, 0x06054b50);
  escribirU16(fin, 4, 0);
  escribirU16(fin, 6, 0);
  escribirU16(fin, 8, centrales.length);
  escribirU16(fin, 10, centrales.length);
  escribirU32(fin, 12, tamanioCentral);
  escribirU32(fin, 16, desplazamiento);
  escribirU16(fin, 20, 0);

  return new Blob([...locales, ...centrales, fin], { type: "application/zip" });
}
