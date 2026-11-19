"""Writes an EPUB of hard tables and preformatted text, for the fidelity checks:
   python3 bench/fixtures/tables.py out.epub"""
import sys, zipfile

words = ['Temperature', 'Pressure', 'Humidity', 'Visibility', 'Direction', 'Velocity', 'Precipitation', 'Barometer', 'Observations', 'Latitude']
para = ('The observations which follow were made with care, morning and evening, through the whole '
        'of the voyage; they are given here as they were entered in the log, without correction. ') * 3

def table(cols, rows, head=True, spans=False):
    h = '<tr>' + ''.join(f'<th>{words[i % len(words)]}</th>' for i in range(cols)) + '</tr>' if head else ''
    body = ''
    for r in range(rows):
        if spans and r == 1:
            body += f'<tr><td colspan="2">Spanning two columns of the table</td>' + ''.join(f'<td>{r}.{c}</td>' for c in range(cols - 2)) + '</tr>'
        else:
            body += '<tr>' + ''.join(f'<td>{(r + 1) * (c + 3) * 7.31:.2f}</td>' for c in range(cols)) + '</tr>'
    return f'<table>{h}{body}</table>'

pre_wide = '\n'.join('    ' + '   '.join(f'{(r + 1) * (c + 2) * 13.7:9.2f}' for c in range(9)) for r in range(6))
pre_rule = '    Station           Summer    Winter\n    ' + '-' * 120 + '\n    Port Famine       50.0      33.1'

chapters = [
    ('Fitting tables', f'<p>{para}</p>{table(3, 5)}<p>{para}</p>{table(6, 4)}<p>{para}</p>'),
    ('Wide tables', f'<p>{para}</p>{table(8, 6)}<p>{para}</p>{table(10, 4, spans=True)}<p>{para}</p>{table(6, 3, head=False, spans=True)}<p>{para}</p>'),
    ('Preformatted', f'<p>{para}</p><pre>{pre_wide}</pre><p>{para}</p><pre>{pre_rule}</pre><p>{para}</p>'),
]

def xhtml(title, body):
    return f'''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{title}</title></head>
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
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">volumen-fixture-tables</dc:identifier>
<dc:title>Tables and Figures</dc:title><dc:creator>Volumen</dc:creator><dc:language>en</dc:language></metadata>
<manifest>{items}</manifest><spine>{spine}</spine></package>''')
    for i, (t, b) in enumerate(chapters):
        z.writestr(f'OEBPS/c{i}.xhtml', xhtml(t, b))
