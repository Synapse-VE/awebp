# Encoder WebP (WASM)

Codigo de terceros, vendorizado para que el sitio no dependa de un CDN.

- **Origen:** [`@jsquash/webp`](https://github.com/jamsinclair/jSquash) 1.5.0
  (reempaquetado del codec de [Squoosh](https://squoosh.app)).
- **Archivos:** `webp_enc.js` (pegamento de Emscripten), `webp_enc.wasm`
  (libwebp, ~281 KB) y `meta.js` (opciones por defecto).
- **Licencia:** Apache-2.0, ver `LICENSE`.

Solo se usa cuando el navegador no puede codificar WebP por su cuenta
(Safari/iOS). `codificar.js` es el envoltorio propio.
