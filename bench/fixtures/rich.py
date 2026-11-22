"""Writes an EPUB of what the press cannot set from text, as publishers make it: a
genealogy drawn as a table (its tree's lines are cells' borders, from a style sheet), a
figure in SVG, a formula in MathML; and a table of figures that stays a table.
   python3 bench/fixtures/rich.py out.epub"""
import sys, zipfile

para = ('The houses that contended for the crown descended alike from the third Edward, and '
        'the claims of each were argued at length by the heralds of the other. ') * 3

# a family tree as a layout tool exports one: names in cells, the lines between them
# drawn by borders on otherwise empty cells
def tree():
    rows = [
        ['', '', 'Edward III', '', ''],
        ['', 'br', 'bb', 'bl', ''],
        ['', 'br', '', 'bl', ''],
        ['Lionel, Duke of Clarence', '', 'John of Gaunt', '', 'Edmund, Duke of York'],
        ['br', '', 'br', '', 'br'],
        ['Philippa', '', 'Henry IV', '', 'Richard, Earl of Cambridge'],
        ['br', '', 'br', '', 'br'],
        ['Roger Mortimer', '', 'Henry V', '', 'Richard, Duke of York'],
    ]
    def cell(c):
        if c in ('br', 'bl', 'bb'):
            return f'<td class="{c}"></td>'
        return f'<td class="n">{c}</td>' if c else '<td></td>'
    return '<table class="genealogy">' + ''.join('<tr>' + ''.join(cell(c) for c in r) + '</tr>' for r in rows) + '</table>'

svg = '''<svg viewBox="0 0 400 160" width="400" height="160">
<rect x="10" y="40" width="110" height="60" rx="8" fill="none" stroke="#000"/><text x="65" y="75" text-anchor="middle" font-size="14">Thesis</text>
<path d="M120 70 L180 70" stroke="#000"/><polygon points="180,64 192,70 180,76" fill="#000"/>
<rect x="192" y="40" width="110" height="60" rx="8" fill="none" stroke="#000"/><text x="247" y="75" text-anchor="middle" font-size="14">Antithesis</text>
</svg>'''

math = '''<math display="block"><mrow><msup><mi>e</mi><mrow><mi>i</mi><mi>π</mi></mrow></msup><mo>+</mo><mn>1</mn><mo>=</mo><mn>0</mn></mrow></math>'''

data = '<table><tr><th>Reign</th><th>Began</th><th>Ended</th></tr>' + ''.join(f'<tr><td>{k}</td><td>{a}</td><td>{b}</td></tr>' for k, a, b in [('Henry IV', 1399, 1413), ('Henry V', 1413, 1422), ('Henry VI', 1422, 1461), ('Edward IV', 1461, 1483)]) + '</table>'

css = '''table.genealogy { border-collapse: collapse; margin: 1em auto; font-family: "Adobe Garamond"; color: #333 }
td.n { padding: 2px 8px; text-align: center; font-size: 0.85em }
td.br { border-right: 1px solid #000; height: 0.8em }
td.bl { border-left: 1px solid black; }
td.bb { border-bottom: 1px solid #000000 }'''

chapters = [
    ('The descent of the crown', f'<p>{para}</p>{tree()}<p>{para}</p>'),
    ('A figure and a formula', f'<p>{para}</p><figure>{svg}<figcaption>From thesis to antithesis.</figcaption></figure><p>{para}</p>{math}<p>{para}</p>'),
    ('The reigns', f'<p>{para}</p>{data}<p>{para}</p>'),
]

def xhtml(title, body):
    return f'''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{title}</title><link rel="stylesheet" href="style.css" type="text/css"/></head>
<body><h2>{title}</h2>{body}</body></html>'''

out = sys.argv[1]
with zipfile.ZipFile(out, 'w') as z:
    z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip')
    z.writestr('META-INF/container.xml', '''<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>''')
    items = ''.join(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(len(chapters)))
    spine = ''.join(f'<itemref idref="c{i}"/>' for i in range(len(chapters)))
    z.writestr('OEBPS/content.opf', f'''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">typeset-fixture-rich</dc:identifier>
<dc:title>Houses and Figures</dc:title><dc:creator>Volumen</dc:creator><dc:language>en</dc:language></metadata>
<manifest>{items}<item id="css" href="style.css" media-type="text/css"/></manifest><spine>{spine}</spine></package>''')
    z.writestr('OEBPS/style.css', css)
    for i, (t, b) in enumerate(chapters):
        z.writestr(f'OEBPS/c{i}.xhtml', xhtml(t, b))
