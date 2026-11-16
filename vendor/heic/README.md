# Lector HEIC (WASM)

Codigo de terceros vendorizado.

- **Origen:** [`libheif-js`](https://github.com/strukturag/libheif) 1.23.5
  (`libheif-wasm/libheif-bundle.mjs`, con el wasm embebido en base64).
- **Licencia:** LGPL-3.0, ver `LICENSE`.
- **Uso:** solo se importa cuando el navegador no pudo abrir un HEIC/HEIF por su
  cuenta (Chrome/Android suelen fallar; Safari lo hace nativo).

`decodificar.js` es el envoltorio propio: elige la imagen mas grande y devuelve
los pixeles RGBA listos para dibujar en un canvas.
