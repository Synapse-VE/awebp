# Changelog

## [0.3.0] - 2026-11-16

### Agregado

- Lectura de HEIC/HEIF con libheif en WebAssembly para los navegadores que no lo abren
  (Chrome/Android), con vista previa generada desde los píxeles decodificados.
- Varias fotos por tanda (hasta 10), con lista de resultados, ahorro por foto y total.
- Descarga de todas las fotos en un ZIP armado en el navegador (store + CRC32).
- Share target para Android: compartir fotos desde la galería abre awebp ya convertida.
- Pruebas E2E nuevas: `heic`, `multi` (verifica el ZIP) y `share` (POST + recogida).

### Cambiado

- El service worker sube a la versión 2 y ahora también intercepta el POST de compartir.
- La vista previa del original se conserva entre reconversiones (bug de URL revocada).

## [0.2.0] - 2026-11-15

### Agregado

- Conversión de fotos a WebP en el navegador, sin subir archivos.
- Toma de foto desde el celular, galería, arrastrar y soltar, y pegar con `Ctrl` + `V`.
- Comparación de peso original vs WebP, con porcentaje de ahorro.
- Ajustes de calidad y tamaño máximo que reconvierten al instante.
- Fallback de codificación con libwebp en WebAssembly para Safari/iOS.
- PWA instalable con service worker y funcionamiento sin conexión.
- Iconos generados con Pillow y manifest completo.
- Pruebas E2E con el protocolo de DevTools de Chrome.
- Deploy automático a GitHub Pages.
