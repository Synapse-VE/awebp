import assert from "node:assert/strict";
import { test } from "node:test";

import { crc32, crearZip } from "../js/zip.js";

const texto = (cadena) => new TextEncoder().encode(cadena);

function leerU16(datos, posicion) {
  return datos[posicion] | (datos[posicion + 1] << 8);
}

function leerU32(datos, posicion) {
  return (datos[posicion] | (datos[posicion + 1] << 8) | (datos[posicion + 2] << 16) | (datos[posicion + 3] << 24)) >>> 0;
}

/** Lector minimo para verificar lo que escribimos. */
function leerZip(bytes) {
  const fin = bytes.length - 22;
  assert.equal(leerU32(bytes, fin), 0x06054b50, "firma EOCD");

  const cantidad = leerU16(bytes, fin + 10);
  const tamanioCentral = leerU32(bytes, fin + 12);
  const inicioCentral = leerU32(bytes, fin + 16);
  assert.equal(bytes.length - 22 - tamanioCentral, inicioCentral, "offset del directorio central");

  const entradas = [];
  let posicion = inicioCentral;

  for (let i = 0; i < cantidad; i += 1) {
    assert.equal(leerU32(bytes, posicion), 0x02014b50, "firma central");
    const crc = leerU32(bytes, posicion + 16);
    const tamanio = leerU32(bytes, posicion + 20);
    const largoNombre = leerU16(bytes, posicion + 28);
    const offsetLocal = leerU32(bytes, posicion + 42);
    const nombre = new TextDecoder().decode(bytes.slice(posicion + 46, posicion + 46 + largoNombre));

    assert.equal(leerU32(bytes, offsetLocal), 0x04034b50, "firma local");
    const inicioDatos = offsetLocal + 30 + leerU16(bytes, offsetLocal + 26) + leerU16(bytes, offsetLocal + 28);
    const datos = bytes.slice(inicioDatos, inicioDatos + tamanio);

    entradas.push({ nombre, crc, datos });
    posicion += 46 + largoNombre;
  }

  return entradas;
}

test("crc32 coincide con el vector de referencia", () => {
  assert.equal(crc32(texto("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("crearZip arma un archivo que se puede leer", async () => {
  const zip = crearZip([
    { nombre: "uno.webp", datos: texto("contenido uno") },
    { nombre: "dos.webp", datos: texto("contenido dos, mas largo") },
  ]);

  const bytes = new Uint8Array(await zip.arrayBuffer());
  const entradas = leerZip(bytes);

  assert.equal(zip.type, "application/zip");
  assert.deepEqual(entradas.map((e) => e.nombre), ["uno.webp", "dos.webp"]);
  assert.equal(new TextDecoder().decode(entradas[0].datos), "contenido uno");
  assert.equal(new TextDecoder().decode(entradas[1].datos), "contenido dos, mas largo");
  assert.equal(entradas[1].crc, crc32(texto("contenido dos, mas largo")));
});

test("crearZip soporta nombres con acentos", async () => {
  const zip = crearZip([{ nombre: "fotografía.webp", datos: texto("x") }]);
  const entradas = leerZip(new Uint8Array(await zip.arrayBuffer()));
  assert.equal(entradas[0].nombre, "fotografía.webp");
});
