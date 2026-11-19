"""Writes EPUBs of the kinds a reader meets less often, each made as its makers make it:
right-to-left (Hebrew, Arabic), Japanese across and down the page, Chinese, locked by
a shop (Adobe's and Readium's DRM), fonts merely obfuscated (not locked), fixed pages,
pictures only, no table of contents, and a very long book.
   python3 bench/fixtures/unusual.py outdir"""
import io, os, sys, zipfile, random

he = ('בראשית ברא אלהים את השמים ואת הארץ. והארץ היתה תהו ובהו וחשך על פני תהום ורוח אלהים '
      'מרחפת על פני המים. ויאמר אלהים יהי אור ויהי אור. וירא אלהים את האור כי טוב ויבדל אלהים '
      'בין האור ובין החשך. ויקרא אלהים לאור יום ולחשך קרא לילה ויהי ערב ויהי בקר יום אחד.')
ar = ('كان في قديم الزمان تاجر يسافر بين المدن، يحمل الكتب من بلد إلى بلد. وكان يقرأ في الطريق '
      'كل ليلة، فإذا وصل إلى مدينة جديدة حكى لأهلها ما قرأ. فأحبه الناس وانتظروا قدومه كل عام، '
      'وسألوه عن الكتب التي يحملها، فأعطاهم منها ما شاؤوا. وفي عام 1250 جاء ومعه 12 كتابًا جديدًا.')
ja = ('吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所で'
      'ニャーニャー泣いていた事だけは記憶している。吾輩はここで始めて人間というものを見た。しかもあとで'
      '聞くとそれは書生という人間中で一番獰悪な種族であったそうだ。')
zh = ('子曰：「學而時習之，不亦說乎？有朋自遠方來，不亦樂乎？人不知而不慍，不亦君子乎？」'
      '有子曰：「其為人也孝弟，而好犯上者，鮮矣；不好犯上，而好作亂者，未之有也。君子務本，本立而道生。'
      '孝弟也者，其為仁之本與！」')
en = ('The houses that contended for the crown descended alike from the third Edward, and the '
      'claims of each were argued at length by the heralds of the other. ')


def xhtml(title, body, lang='en', dir=None, head=''):
    d = f' dir="{dir}"' if dir else ''
    return f'''<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="{lang}" xml:lang="{lang}"{d}>
<head><title>{title}</title>{head}</head>
<body>{body}</body></html>'''


def epub(path, title, lang, chapters, *, spine_dir=None, meta='', nav=True, extra=None, manifest_extra='', css=None):
    """chapters: [(file, title, xhtml)]; extra: {name: bytes} written as is."""
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml', '''<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>''')
        items = ''.join(f'<item id="c{i}" href="{f}" media-type="application/xhtml+xml"/>' for i, (f, _, _) in enumerate(chapters))
        refs = ''.join(f'<itemref idref="c{i}"/>' for i in range(len(chapters)))
        navitem = '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' if nav else ''
        cssitem = '<item id="css" href="style.css" media-type="text/css"/>' if css else ''
        pd = f' page-progression-direction="{spine_dir}"' if spine_dir else ''
        z.writestr('OEBPS/content.opf', f'''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" xml:lang="{lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:{abs(hash(path)) % 10**12:012d}-0000-4000-8000-000000000000</dc:identifier>
<dc:title>{title}</dc:title><dc:language>{lang}</dc:language><dc:creator>Fixture</dc:creator>
<meta property="dcterms:modified">2026-10-15T00:00:00Z</meta>{meta}</metadata>
<manifest>{navitem}{cssitem}{items}{manifest_extra}</manifest>
<spine{pd}>{refs}</spine></package>''')
        if nav:
            lis = ''.join(f'<li><a href="{f}">{t}</a></li>' for f, t, _ in chapters)
            z.writestr('OEBPS/nav.xhtml', xhtml(title, f'<nav epub:type="toc"><ol>{lis}</ol></nav>', lang))
        if css:
            z.writestr('OEBPS/style.css', css)
        for f, _, body in chapters:
            z.writestr('OEBPS/' + f, body)
        for name, b in (extra or {}).items():
            z.writestr(name, b)


def png(w, h, shade, label=''):
    from PIL import Image, ImageDraw
    im = Image.new('RGB', (w, h), (shade, shade, 255 - shade))
    d = ImageDraw.Draw(im)
    d.rectangle([w // 10, h // 10, w - w // 10, h - h // 10], outline=(0, 0, 0), width=6)
    if label:
        d.text((w // 5, h // 2), label, fill=(0, 0, 0))
    o = io.BytesIO(); im.save(o, 'PNG'); return o.getvalue()


out = sys.argv[1]
os.makedirs(out, exist_ok=True)
P = lambda n: os.path.join(out, n)

# right to left: the spine runs right to left, the pages say so
for code, name, text in [('he', 'Hebrew', he), ('ar', 'Arabic', ar)]:
    ch = [(f'c{i}.xhtml', f'{i + 1}', xhtml(f'{i + 1}', f'<h1>{i + 1}</h1>' + f'<p>{text}</p>' * 6, code, 'rtl')) for i in range(3)]
    epub(P(f'rtl-{code}.epub'), f'{name} sample', code, ch, spine_dir='rtl')

# Japanese across the page, and down it (as most Japanese novels are set)
ch = [(f'c{i}.xhtml', f'第{i + 1}章', xhtml(f'第{i + 1}章', f'<h1>第{i + 1}章</h1>' + f'<p>{ja}</p>' * 6, 'ja')) for i in range(3)]
epub(P('ja.epub'), '吾輩は猫である', 'ja', ch)
vcss = 'html { writing-mode: vertical-rl; -epub-writing-mode: vertical-rl; }'
ch = [(f'c{i}.xhtml', f'第{i + 1}章', xhtml(f'第{i + 1}章', f'<h1>第{i + 1}章</h1>' + f'<p>{ja}</p>' * 6, 'ja', head='<link rel="stylesheet" href="style.css" type="text/css"/>')) for i in range(3)]
epub(P('ja-vertical.epub'), '吾輩は猫である（縦書き）', 'ja', ch, spine_dir='rtl', css=vcss, meta='<meta name="primary-writing-mode" content="vertical-rl"/>')
ch = [(f'c{i}.xhtml', f'學而第{i + 1}', xhtml(f'學而第{i + 1}', f'<h1>學而第{i + 1}</h1>' + f'<p>{zh}</p>' * 6, 'zh-Hant')) for i in range(3)]
epub(P('zh.epub'), '論語', 'zh-Hant', ch)

# locked by a shop: the chapters are ciphertext; encryption.xml names them
rnd = random.Random(7)
def locked(path, scheme):
    ch = [(f'c{i}.xhtml', f'Chapter {i + 1}', bytes(rnd.randrange(256) for _ in range(3000))) for i in range(3)]
    enc = ''.join(f'''<EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes{'128' if scheme == 'adobe' else '256'}-cbc"/>
<CipherData><CipherReference URI="OEBPS/{f}"/></CipherData></EncryptedData>''' for f, _, _ in ch)
    extra = {'META-INF/encryption.xml': f'<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">{enc}</encryption>'}
    if scheme == 'adobe':
        extra['META-INF/rights.xml'] = '<?xml version="1.0"?><adept:rights xmlns:adept="http://ns.adobe.com/adept"><adept:licenseToken/></adept:rights>'
    else:
        extra['META-INF/license.lcpl'] = '{"id":"fixture","provider":"https://example.org","encryption":{"profile":"http://readium.org/lcp/basic-profile"}}'
    epub(path, f'Locked ({scheme})', 'en', ch, extra=extra)
locked(P('drm-adobe.epub'), 'adobe')
locked(P('drm-lcp.epub'), 'lcp')

# fonts obfuscated (the IDPF's algorithm, for the font's licence): not locked; reads
font = b'\x00\x01\x00\x00' + bytes(rnd.randrange(256) for _ in range(2000))
ch = [('c0.xhtml', 'One', xhtml('One', f'<h1>One</h1><p>{en * 8}</p>', head='<link rel="stylesheet" href="style.css" type="text/css"/>'))]
epub(P('fonts-obfuscated.epub'), 'Obfuscated fonts', 'en', ch,
     css='@font-face { font-family: "House"; src: url(house.ttf); } body { font-family: "House", serif; }',
     manifest_extra='<item id="f" href="house.ttf" media-type="font/ttf"/>',
     extra={'OEBPS/house.ttf': font, 'META-INF/encryption.xml': '''<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><CipherData><CipherReference URI="OEBPS/house.ttf"/></CipherData></EncryptedData></encryption>'''})

# fixed pages: a picture book, each page a picture with its words placed over it
pages, imgs = [], {}
for i in range(6):
    imgs[f'OEBPS/p{i}.png'] = png(600, 800, 40 * i, f'page {i + 1}')
    body = f'<div style="position:absolute;left:0;top:0"><img src="p{i}.png" width="600" height="800" alt=""/></div><p style="position:absolute;left:60px;top:640px;width:480px">The fox ran {i + 1} times around the old oak tree.</p>'
    pages.append((f'p{i}.xhtml', f'Page {i + 1}', xhtml(f'Page {i + 1}', body, head='<meta name="viewport" content="width=600, height=800"/>')))
epub(P('fixed.epub'), 'Fixed pages', 'en', pages, meta='<meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">auto</meta>',
     manifest_extra=''.join(f'<item id="i{i}" href="p{i}.png" media-type="image/png"/>' for i in range(6)), extra=imgs)

# pictures only: a comic as many shops sell it (reflowable, one picture a page)
pages, imgs = [], {}
for i in range(8):
    imgs[f'OEBPS/i{i}.png'] = png(800, 1200, 30 * i, f'panel {i + 1}')
    pages.append((f'i{i}.xhtml', f'{i + 1}', xhtml(f'{i + 1}', f'<div><img src="i{i}.png" alt=""/></div>')))
epub(P('pictures.epub'), 'Pictures only', 'en', pages, manifest_extra=''.join(f'<item id="i{i}" href="i{i}.png" media-type="image/png"/>' for i in range(8)), extra=imgs)

# no table of contents: neither a nav document nor an NCX, no headings
ch = [(f'c{i}.xhtml', '', xhtml('', f'<p>{en * 12}</p>' * 4)) for i in range(5)]
epub(P('no-toc.epub'), 'No table of contents', 'en', ch, nav=False)

# a very long book: 600 chapters, about 9 million characters
words = en.split()
def para(k):
    r = random.Random(k); return ' '.join(r.choice(words) for _ in range(160)).capitalize() + '.'
ch = [(f'c{i}.xhtml', f'Chapter {i + 1}', xhtml(f'Chapter {i + 1}', f'<h2>Chapter {i + 1}</h2>' + ''.join(f'<p>{para(i * 100 + j)}</p>' for j in range(15)))) for i in range(600)]
epub(P('long.epub'), 'A very long book', 'en', ch)
print('\n'.join(sorted(os.listdir(out))))
