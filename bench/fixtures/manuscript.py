"""Writes a short manuscript as a writer would send it, for the importers' tests:
   python3 bench/fixtures/manuscript.py     (needs LibreOffice for the .docx)

bench/fixtures/manuscript.md, and bench/fixtures/manuscript.docx written by LibreOffice
from a flat ODT (so its styles, footnotes and runs are a real word processor's)."""
import os, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TITLE, AUTHOR = 'The Lantern Keeper', 'Ada Morrow'
CH = [
    ('Chapter One: The Harbour', [
        ('p', 'The lantern had burned for <i>forty years</i> before anyone thought to ask who kept it.<fn>Some say fifty; the harbour records were lost in the flood.</fn> Mara asked on a Tuesday.'),
        ('p', 'Her father laughed, as he laughed at most questions, and said the keeper was <b>nobody</b> at all.'),
        ('q', 'A light that no one keeps is still a light, until it isn’t.'),
        ('p', 'She wrote that down in the back of her schoolbook, under the sums.'),
        ('brk', '* * *'),
        ('p', 'By morning the <sc>harbour board</sc> had sent a letter.<fn>It was signed by three men, one of whom could not write.</fn>'),
    ]),
    ('Chapter Two: The Stair', [
        ('p', 'The stair turned eleven times. Mara counted, and then counted again, because the second time there were twelve.'),
        ('li', 'a lamp with no oil'),
        ('li', 'a chair facing the sea'),
        ('p', 'Nothing else was in the room.'),
    ]),
]

def md():
    out = [f'---\ntitle: {TITLE}\nauthor: {AUTHOR}\n---\n']
    notes, n = [], 0
    for head, paras in CH:
        out.append(f'# {head}\n')
        for kind, t in paras:
            def fn(t):
                nonlocal n
                while '<fn>' in t:
                    a, rest = t.split('<fn>', 1); body, rest = rest.split('</fn>', 1)
                    n += 1; notes.append(f'[^{n}]: {body}'); t = f'{a}[^{n}]{rest}'
                return t
            t = fn(t).replace('<i>', '*').replace('</i>', '*').replace('<b>', '**').replace('</b>', '**').replace('<sc>', '').replace('</sc>', '').replace('’', "'")
            out.append({'p': t, 'q': '> ' + t, 'brk': '* * *', 'li': '- ' + t}[kind] + '\n')
    out.append('\n'.join(notes) + '\n')
    open(os.path.join(HERE, 'manuscript.md'), 'w').write('\n'.join(out))

def fodt():
    def inline(t):
        t = t.replace('&', '&amp;')
        t = t.replace('<i>', '<text:span text:style-name="I">').replace('</i>', '</text:span>')
        t = t.replace('<b>', '<text:span text:style-name="B">').replace('</b>', '</text:span>')
        t = t.replace('<sc>', '<text:span text:style-name="SC">').replace('</sc>', '</text:span>')
        while '<fn>' in t:
            a, rest = t.split('<fn>', 1); body, rest = rest.split('</fn>', 1)
            t = f'{a}<text:note text:note-class="footnote"><text:note-citation/><text:note-body><text:p text:style-name="Footnote">{body}</text:p></text:note-body></text:note>{rest}'
        return t
    body = [f'<text:p text:style-name="Title">{TITLE}</text:p>']
    for head, paras in CH:
        body.append(f'<text:h text:style-name="Heading_20_1" text:outline-level="1">{head}</text:h>')
        for kind, t in paras:
            if kind == 'li':
                body.append(f'<text:list><text:list-item><text:p text:style-name="List_20_Bullet">{inline(t)}</text:p></text:list-item></text:list>')
            else:
                style = {'p': 'Text_20_body', 'q': 'Quotations', 'brk': 'Text_20_body'}[kind]
                body.append(f'<text:p text:style-name="{style}">{inline(t)}</text:p>')
    doc = f'''<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
<office:meta><dc:title>{TITLE}</dc:title><meta:initial-creator>{AUTHOR}</meta:initial-creator><dc:creator>{AUTHOR}</dc:creator></office:meta>
<office:automatic-styles>
<style:style style:name="I" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="B" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="SC" style:family="text"><style:text-properties fo:font-variant="small-caps"/></style:style>
</office:automatic-styles>
<office:body><office:text>{''.join(body)}</office:text></office:body></office:document>'''
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, 'manuscript.fodt')
        open(src, 'w').write(doc)
        subprocess.run(['soffice', '--headless', '--convert-to', 'docx:MS Word 2007 XML', '--outdir', HERE, src], check=True, capture_output=True)

md(); fodt()
print('wrote', os.path.join(HERE, 'manuscript.md'), os.path.join(HERE, 'manuscript.docx'))
