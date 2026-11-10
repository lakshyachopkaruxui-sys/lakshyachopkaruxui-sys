"""Build the editable Word handoff from its matching Markdown source."""
from pathlib import Path
import re
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.text import WD_ALIGN_PARAGRAPH

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'docs/TEAR_COMPLETE_HANDOFF.md'
target = ROOT / 'docs/TEAR_Complete_Project_Handoff.docx'
doc = Document()
section = doc.sections[0]
section.page_width, section.page_height = Inches(8.5), Inches(11)
section.top_margin = section.bottom_margin = Inches(.7)
section.left_margin = section.right_margin = Inches(.75)
section.header_distance = section.footer_distance = Inches(.3)
for name in ['Normal','Title','Subtitle','Heading 1','Heading 2','Heading 3']:
    style = doc.styles[name]
    style.font.name = 'Arial'
    style.font.color.rgb = RGBColor(0,0,0)
    style.paragraph_format.space_after = Pt(6)
doc.styles['Normal'].font.size = Pt(11)
doc.styles['Normal'].paragraph_format.line_spacing = 1.08
doc.styles['Normal'].paragraph_format.widow_control = True
doc.styles['Title'].font.size = Pt(25)
doc.styles['Title'].font.bold = True
doc.styles['Heading 1'].font.size = Pt(16)
doc.styles['Heading 1'].paragraph_format.space_before = Pt(15)
doc.styles['Heading 2'].font.size = Pt(12.5)
doc.styles['Heading 2'].paragraph_format.space_before = Pt(10)
for name in ['Title','Heading 1','Heading 2']:
    doc.styles[name].paragraph_format.keep_with_next = True

def inline(paragraph, text):
    for token in re.split(r'(\*\*.*?\*\*|`[^`]+`)', text):
        if token.startswith('**') and token.endswith('**'):
            paragraph.add_run(token[2:-2]).bold = True
        elif token.startswith('`') and token.endswith('`'):
            run = paragraph.add_run(token[1:-1]); run.font.name='Consolas'; run.font.size=Pt(9.5)
        else:
            paragraph.add_run(token)

def table(rows):
    clean = [[cell.strip() for cell in row.strip().strip('|').split('|')] for row in rows]
    clean = [row for row in clean if not all(re.fullmatch(r'[: -]+', cell) for cell in row)]
    t=doc.add_table(rows=1, cols=len(clean[0])); t.style='Light Shading Accent 1'
    t.autofit=False
    widths=[2.65,4.35] if clean[0][0].startswith('Module') else [1.0,6.0]
    for i,row in enumerate(clean):
        cells=t.rows[0].cells if i==0 else t.add_row().cells
        trPr=t.rows[i]._tr.get_or_add_trPr(); trPr.append(OxmlElement('w:cantSplit'))
        if i==0:
            trPr.append(OxmlElement('w:tblHeader'))
        for j,value in enumerate(row):
            cells[j].width=Inches(widths[j]); p=cells[j].paragraphs[0]; inline(p,value)
            p.paragraph_format.space_after=Pt(5); p.paragraph_format.space_before=Pt(5)
            for run in p.runs:
                if run.font.name!='Consolas': run.font.size=Pt(10.5)
                run.font.color.rgb=RGBColor(0,0,0)
                if i==0: run.bold=True
            shading=OxmlElement('w:shd'); shading.set(qn('w:fill'),'E7E6E6' if i==0 else 'FFFFFF')
            cells[j]._tc.get_or_add_tcPr().append(shading)
    doc.add_paragraph().paragraph_format.space_after=Pt(0)

lines=source.read_text(encoding='utf-8').splitlines(); i=0
while i<len(lines):
    line=lines[i]
    if not line.strip(): i+=1; continue
    if line.startswith('|'):
        rows=[]
        while i<len(lines) and lines[i].startswith('|'): rows.append(lines[i]); i+=1
        table(rows); continue
    if line.startswith('# '): p=doc.add_paragraph(style='Title'); inline(p,line[2:])
    elif line.startswith('## '): p=doc.add_paragraph(style='Heading 1'); inline(p,line[3:])
    elif line.startswith('### '): p=doc.add_paragraph(style='Heading 2'); inline(p,line[4:])
    else:
        p=doc.add_paragraph()
        if line.startswith('- '):
            p.paragraph_format.left_indent=Inches(.16); p.paragraph_format.first_line_indent=Inches(-.16)
            inline(p,'• '+line[2:])
        else: inline(p,line)
    i+=1

header=section.header.paragraphs[0]
header.text='TEAR  |  Project continuation record'
for run in header.runs: run.font.name='Arial'; run.font.size=Pt(9); run.font.color.rgb=RGBColor(0,0,0)
footer=section.footer.paragraphs[0]; footer.alignment=WD_ALIGN_PARAGRAPH.RIGHT
footer.add_run('TEAR  •  ')
field=OxmlElement('w:fldSimple'); field.set(qn('w:instr'),'PAGE'); footer._p.append(field)
for run in footer.runs: run.font.size=Pt(9)
doc.core_properties.title='TEAR Complete Project Handoff'
doc.core_properties.subject='Project history and continuation record'
doc.core_properties.author='TEAR project handoff'
doc.core_properties.comments='Prepared with AI assistance from the conversation and project evidence.'
doc.save(target)
print(target)
print('Words',len(source.read_text(encoding='utf-8').split()))
