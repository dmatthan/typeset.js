#!/usr/bin/env python3
"""The shadows raised things cast (`.lift` in tokens.css), as 9-slice images: WebKitGTK
re-blurs a CSS box-shadow on every frame anything near it repaints, an image costs nothing.

    python3 scripts/make-shadows.py      (needs Pillow)

Each image is cut from a large rounded card rendered with its shadow, at 3x so it is sharp
on a phone: its corners from the card's corners, its edges from the middle of the card's
sides, so a slice never stretches a corner's curve. The shadow is left out wherever the
card itself is (the card draws its own background), following the card's own corner
radius: an image made for one radius leaves a wedge of shadow in the corners of a card
with a larger one, so each radius in use has its own image.

    shadow-16.png   panels and sheets (16 px corners)       border-image: … 192 / 64px, inset -48px
    shadow-12.png   cards, toasts, chips (12 px corners)    the same
    shadow-cover.png  book covers (4 px spine, 8 px fore-edge corners)   … 96 / 32px, inset -24px
"""
import os
from PIL import Image, ImageChops, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'ui')
S = 3          # image pixels per CSS px
AA = 4         # supersampling for the card's edge
INK = (12, 14, 22)


def card_mask(w, h, radii, scale):
    """The card's shape (tl, tr, br, bl radii, CSS px) as an antialiased mask at `scale`."""
    big = Image.new('L', (w * scale * AA, h * scale * AA), 0)
    d = ImageDraw.Draw(big)
    tl, tr, br, bl = (r * scale * AA for r in radii)
    W, H = big.size
    d.rectangle([0, 0, W - 1, H - 1], fill=255)
    for (cx, cy, r, sx, sy) in ((tl, tl, tl, 0, 0), (W - tr, tr, tr, W - tr, 0), (W - br, H - br, br, W - br, H - br), (bl, H - bl, bl, 0, H - bl)):
        if r <= 0:
            continue
        d.rectangle([sx, sy, sx + r - 1, sy + r - 1], fill=0)
        d.pieslice([cx - r, cy - r, cx + r - 1, cy + r - 1], 0, 360, fill=255)
    return big.resize((w * scale, h * scale), Image.LANCZOS)


def shadow(name, radii, margin, inner, layers):
    """`margin`: CSS px the shadow reaches outside the card; `inner`: CSS px of the card a
    corner slice covers (at least its largest radius). `layers`: (offset y, blur σ, alpha)."""
    size = 360                                # the virtual card, CSS px
    full = size + 2 * margin
    mask = card_mask(size, size, radii, S)
    alpha = Image.new('L', (full * S, full * S), 0)
    for dy, sigma, a in layers:
        layer = Image.new('L', (full * S, full * S), 0)
        layer.paste(mask.point(lambda v: int(v * a)), (margin * S, (margin + dy) * S))
        layer = layer.filter(ImageFilter.GaussianBlur(sigma * S))
        # two shadows together, as a renderer composites them (alpha over: a + b - ab)
        alpha = ImageChops.screen(alpha, layer)
    # nothing where the card is: it draws itself there
    hole = Image.new('L', (full * S, full * S), 0)
    hole.paste(mask, (margin * S, margin * S))
    alpha = Image.composite(Image.new('L', alpha.size, 0), alpha, hole)
    rgba = Image.new('RGBA', alpha.size, INK + (0,))
    rgba.putalpha(alpha)
    c = (margin + inner) * S                  # a corner slice, image px
    mid = (full * S) // 2
    out = Image.new('RGBA', (2 * c + S, 2 * c + S), INK + (0,))
    # corners
    out.paste(rgba.crop((0, 0, c, c)), (0, 0))
    out.paste(rgba.crop((full * S - c, 0, full * S, c)), (c + S, 0))
    out.paste(rgba.crop((0, full * S - c, c, full * S)), (0, c + S))
    out.paste(rgba.crop((full * S - c, full * S - c, full * S, full * S)), (c + S, c + S))
    # edges: one CSS px from the middle of each side
    out.paste(rgba.crop((mid, 0, mid + S, c)), (c, 0))
    out.paste(rgba.crop((mid, full * S - c, mid + S, full * S)), (c, c + S))
    out.paste(rgba.crop((0, mid, c, mid + S)), (0, c))
    out.paste(rgba.crop((full * S - c, mid, full * S, mid + S)), (c + S, c))
    out.save(os.path.join(OUT, name), optimize=True)
    print(name, out.size, 'slice', c, 'px =', margin + inner, 'CSS px')


# a close, crisp shadow under the edge, and a soft one further down
LAYERS = [(1, 1.0, 0.10), (12, 14, 0.20)]
shadow('shadow-16.png', (16, 16, 16, 16), 48, 16, LAYERS)
shadow('shadow-12.png', (12, 12, 12, 12), 48, 16, LAYERS)
shadow('shadow-cover.png', (4, 8, 8, 4), 24, 8, [(1, 0.8, 0.12), (5, 6, 0.18)])
