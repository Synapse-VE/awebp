"""Genera los iconos de la PWA a partir de un diseno vectorial simple."""
from pathlib import Path

from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
ICONOS = RAIZ / "icons"
ESCALA = 4  # supersampling para bordes suaves

FONDO_A = (34, 211, 238)   # cian
FONDO_B = (52, 211, 153)   # esmeralda


def degradado(lado: int) -> Image.Image:
    base = Image.new("RGB", (lado, lado))
    pixeles = base.load()
    for y in range(lado):
        for x in range(lado):
            t = (x + y) / (2 * lado - 2)
            pixeles[x, y] = (
                round(FONDO_A[0] + (FONDO_B[0] - FONDO_A[0]) * t),
                round(FONDO_A[1] + (FONDO_B[1] - FONDO_A[1]) * t),
                round(FONDO_A[2] + (FONDO_B[2] - FONDO_A[2]) * t),
            )
    return base


def glifo(dibujo: ImageDraw.ImageDraw, lado: int, margen: float) -> None:
    """Marco de foto con montana y sol, en blanco."""
    borde = round(lado * 0.030)
    caja = (round(lado * margen), round(lado * margen), round(lado * (1 - margen)), round(lado * (1 - margen)))
    radio = round(lado * 0.10)

    dibujo.rounded_rectangle(caja, radius=radio, outline=(255, 255, 255, 255), width=borde)

    x0, y0, x1, y1 = caja
    ancho, alto = x1 - x0, y1 - y0
    interno = round(lado * 0.055)

    # Montana
    pico = [
        (x0 + interno, y1 - interno),
        (x0 + ancho * 0.36, y1 - alto * 0.45),
        (x0 + ancho * 0.55, y1 - alto * 0.62),
        (x1 - interno, y1 - interno),
    ]
    dibujo.polygon(pico, fill=(255, 255, 255, 255))

    # Sol
    r = alto * 0.075
    cx = x0 + ancho * 0.72
    cy = y0 + alto * 0.26
    dibujo.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255, 255))


def crear(lado: int, destino: Path, *, maskable: bool = False) -> None:
    grande = lado * ESCALA
    fondo = degradado(grande).convert("RGBA")

    capa = Image.new("RGBA", (grande, grande), (0, 0, 0, 0))
    dibujo = ImageDraw.Draw(capa)
    glifo(dibujo, grande, 0.30 if maskable else 0.20)

    imagen = fondo.copy()
    if not maskable:
        mascara = Image.new("L", (grande, grande), 0)
        ImageDraw.Draw(mascara).rounded_rectangle((0, 0, grande - 1, grande - 1), radius=round(grande * 0.22), fill=255)
        imagen.putalpha(mascara)

    imagen.alpha_composite(capa)
    imagen.resize((lado, lado), Image.LANCZOS).save(destino, "PNG", optimize=True)
    print(f"icono {destino.name}: {lado}x{lado}")


if __name__ == "__main__":
    ICONOS.mkdir(exist_ok=True)
    crear(192, ICONOS / "icono-192.png")
    crear(512, ICONOS / "icono-512.png")
    crear(1024, ICONOS / "icono-1024.png")
    crear(180, ICONOS / "apple-touch-icon.png")
    crear(512, ICONOS / "maskable-512.png", maskable=True)
