import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LIMITE_BYTES,
  MAX_PIXELES,
  calcularObjetivo,
  esMarcaHeic,
  mensajeDeError,
  validarArchivo,
} from "../js/reglas.js";

function cabecera(marca) {
  const bytes = new Uint8Array(16);
  bytes.set([0, 0, 0, 24], 0);
  bytes.set([..."ftyp"].map((c) => c.charCodeAt(0)), 4);
  bytes.set([...marca].map((c) => c.charCodeAt(0)), 8);
  return bytes;
}

test("esMarcaHeic reconoce los brands de HEIC/HEIF", () => {
  for (const marca of ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]) {
    assert.equal(esMarcaHeic(cabecera(marca)), true, marca);
  }
});

test("esMarcaHeic descarta otros formatos", () => {
  assert.equal(esMarcaHeic(cabecera("avif")), false);
  assert.equal(esMarcaHeic(cabecera("isom")), false);
  assert.equal(esMarcaHeic(new Uint8Array(4)), false);
  assert.equal(esMarcaHeic(null), false);
});

test("validarArchivo acepta imagenes y rechaza otras cosas", () => {
  assert.deepEqual(validarArchivo({ type: "image/jpeg", size: 1000 }), { ok: true });
  assert.equal(validarArchivo({ type: "video/mp4", size: 1000 }).codigo, "NO_ES_IMAGEN");
  assert.equal(validarArchivo({ type: "", size: 1000 }).ok, true, "HEIC sin MIME debe pasar");
  assert.equal(validarArchivo({ type: "image/png", size: LIMITE_BYTES + 1 }).codigo, "MUY_GRANDE");
});

test("calcularObjetivo aplica el maximo por lado", () => {
  assert.deepEqual(calcularObjetivo(4000, 3000, 1920), { ancho: 1920, alto: 1440, escalado: true, motivo: "lado" });
  assert.deepEqual(calcularObjetivo(800, 600, 1920), { ancho: 800, alto: 600, escalado: false, motivo: "" });
  assert.deepEqual(calcularObjetivo(3000, 4000, 1920), { ancho: 1440, alto: 1920, escalado: true, motivo: "lado" });
});

test("calcularObjetivo recorta arriba del tope de pixeles", () => {
  const resultado = calcularObjetivo(9000, 7000, 0);
  assert.equal(resultado.escalado, true);
  assert.equal(resultado.motivo, "pixeles");
  assert.ok(resultado.ancho * resultado.alto <= MAX_PIXELES);
});

test("mensajeDeError traduce los codigos conocidos", () => {
  assert.match(mensajeDeError({ codigo: "SIN_WEBP" }), /Chrome/);
  assert.match(mensajeDeError({ codigo: "DECODIFICAR" }), /HEIC/);
  assert.match(mensajeDeError({ codigo: "NO_ES_IMAGEN" }), /no es una imagen/);
  assert.match(mensajeDeError({}), /Algo salio mal/);
});
