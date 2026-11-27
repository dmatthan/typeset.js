"""Writes an EPUB styled as a small press styles its books, for what a theme takes from a
book (Book, as Apple Books' Original, keeps the book's own): its text set at a leading of
1.5, heads set left, a small italic credit under each, and a short rule before the text:
   python3 bench/fixtures/original.py out.epub"""
import sys, zipfile

css = '''body { font-family: "Baskerville", "Georgia", serif; line-height: 1.5; margin: 0 5%;
       text-align: justify; hyphens: auto; }
h1 { font-size: 1.35em; font-weight: normal; text-align: left; margin: 1.2em 0 0.2em 0;
     line-height: 1.25; }
p.credit { font-size: 0.72em; color: #555; text-align: left; margin: 0 0 0.4em 0;
           text-indent: 0; font-style: italic; }
hr.rule { border: 0; border-top: 1px solid #999; width: 30%; margin: 0.8em 0 1.4em 0; }
p { margin: 0; text-indent: 1.4em; }
p.credit + hr.rule + p { text-indent: 0; }'''

sentences = [
    'The road came down out of the hills in long loops, and the town lay below it in the evening light.',
    'Nobody in the carriage spoke; each of them had been watching the same gate for an hour.',
    'At the bridge the horses slowed of their own accord, as horses will where the stones are uneven.',
    'She had been told the city would be loud, and it was not; it was only very large.',
    'A boy ran beside the wheel for a while, asking for nothing, and then turned back the way he came.',
    'The lamps along the wall were lit one at a time by a man with a pole, who did not look up.',
]
para = lambda k: '<p>' + ' '.join(sentences[(k + j) % len(sentences)] for j in range(5)) + '</p>'
chapters = [(f'Chapter {n}', ''.join(para(n + k) for k in range(14))) for n in (1, 2, 3)]

def xhtml(title, body):
    return f'''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{title}</title>
<link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><h1>{title}</h1><p class="credit">Set for the tests, after a small press's book, its translator credited with an address: https://example.org/2016/09/14/the-gate-a-chapter-in-translation/</p>
<hr class="rule"/>{body}</body></html>'''

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
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">typeset-fixture-original</dc:identifier>
<dc:title>The Gate</dc:title><dc:creator>Volumen</dc:creator><dc:language>en</dc:language></metadata>
<manifest><item id="s" href="style.css" media-type="text/css"/>{items}</manifest><spine>{spine}</spine></package>''')
    z.writestr('OEBPS/style.css', css)
    for i, (t, b) in enumerate(chapters):
        z.writestr(f'OEBPS/c{i}.xhtml', xhtml(t, b))
