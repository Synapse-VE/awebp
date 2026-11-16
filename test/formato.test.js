import assert from "node:assert/strict";
import { test } from "node:test";

import { ajustarTamano, ahorroPorcentual, formatoBytes, nombreWebp, sinExtension } from "../js/formato.js";

test("formatoBytes usa la unidad adecuada", () => {
  assert.equal(formatoBytes(0), "0 B");
  assert.equal(formatoBytes(900), "900 B");
  assert.equal(formatoBytes(1536), "1.5 KB");
  assert.equal(formatoBytes(2.5 * 1024 * 1024), "2.5 MB");
  assert.equal(formatoBytes(120 * 1024 * 1024), "120 MB");
});

test("formatoBytes aguanta entradas raras", () => {
  assert.equal(formatoBytes(-5), "-");
  assert.equal(formatoBytes(Number.NaN), "-");
});

test("sinExtension y nombreWebp", () => {
  assert.equal(sinExtension("foto.JPG"), "foto");
  assert.equal(sinExtension("mi.foto.png"), "mi.foto");
  assert.equal(sinExtension("sin-extension"), "sin-extension");
  assert.equal(nombreWebp("foto.jpeg"), "foto.webp");
  assert.equal(nombreWebp("a.b.c"), "a.b.webp");
});

test("ahorroPorcentual redondea", () => {
  assert.equal(ahorroPorcentual(1000, 250), 75);
  assert.equal(ahorroPorcentual(1000, 1000), 0);
  assert.equal(ahorroPorcentual(0, 10), 0);
  assert.equal(ahorroPorcentual(1000, 1200), -20);
});

test("ajustarTamano conserva la proporcion", () => {
  assert.deepEqual(ajustarTamano(4000, 3000, 1920), { ancho: 1920, alto: 1440, escalado: true });
  assert.deepEqual(ajustarTamano(800, 600, 1920), { ancho: 800, alto: 600, escalado: false });
  assert.deepEqual(ajustarTamano(3000, 4000, 1920), { ancho: 1440, alto: 1920, escalado: true });
});
