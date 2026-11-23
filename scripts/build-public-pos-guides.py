"""Build public Thai POS handbooks from the reviewed Markdown source files.

Use the Codex bundled Python runtime for python-docx. Export the generated DOCX
with scripts/export-public-pos-guides-pdf.ps1 so Word and PDF share one source.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "public-pos-guides"
OUTPUT = ROOT / "apps" / "web" / "public" / "guides" / "pos"
DATE = "21 พฤศจิกายน 2026"
PET_SUPPLY_DATE = "23 พฤศจิกายน 2026"
GUIDES = {
    "retail": ("ร้านค้าปลีกและค้าส่ง", False),
    "board-game": ("ร้านบอร์ดเกม", False),
    "restaurant": ("ร้านอาหารและคาเฟ่", False),
    "pharmacy": ("ร้านขายยา", False),
    "pet-supply": ("ร้านขายอาหารสัตว์", False),
    "building-materials": ("ร้านวัสดุก่อสร้าง", True),
}


def set_font(run, name="Sarabun"):
    run.font.name = name
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), name)


def shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def set_cell_border(cell):
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for side in ("top", "left", "bottom", "right"):
        edge = OxmlElement(f"w:{side}")
        edge.set(qn("w:val"), "single")
        edge.set(qn("w:sz"), "4")
        edge.set(qn("w:color"), "D9D9D9")
        borders.append(edge)


def add_hyperlink(paragraph, label, target, anchor=False):
    part = paragraph.part
    link = OxmlElement("w:hyperlink")
    if anchor:
        link.set(qn("w:anchor"), target)
    else:
        rid = part.relate_to(
            target,
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
            is_external=True,
        )
        link.set(qn("r:id"), rid)
    run = OxmlElement("w:r")
    props = OxmlElement("w:rPr")
    color = OxmlElement("w:color")
    color.set(qn("w:val"), "5144A8")
    props.append(color)
    run.append(props)
    text = OxmlElement("w:t")
    text.text = label
    run.append(text)
    link.append(run)
    paragraph._p.append(link)


INLINE = re.compile(r"(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))")


def add_inline(paragraph, value):
    for part in INLINE.split(value):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            run = paragraph.add_run(part[2:-2])
            run.bold = True
            set_font(run)
        elif part.startswith("[") and "](" in part:
            label, target = part[1:-1].split("](", 1)
            add_hyperlink(paragraph, label, target)
        else:
            run = paragraph.add_run(part.replace("`", ""))
            set_font(run)


def add_bookmark(paragraph, name, number):
    start = OxmlElement("w:bookmarkStart")
    start.set(qn("w:id"), str(number))
    start.set(qn("w:name"), name)
    end = OxmlElement("w:bookmarkEnd")
    end.set(qn("w:id"), str(number))
    paragraph._p.insert(0, start)
    paragraph._p.append(end)


def add_field(paragraph, instruction):
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    code = OxmlElement("w:instrText")
    code.set(qn("xml:space"), "preserve")
    code.text = f" {instruction} "
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    value = OxmlElement("w:t")
    value.text = "1"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    for node in (begin, code, separate, value, end):
        run._r.append(node)


def configure(doc, pilot, label, date):
    doc.settings.odd_and_even_pages_header_footer = True
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(.68)
    section.bottom_margin = Inches(.64)
    section.left_margin = Inches(.82)
    section.right_margin = Inches(.82)
    section.header_distance = Inches(.32)
    section.footer_distance = Inches(.33)
    styles = doc.styles
    for name, size, bold, after in (
        ("Normal", 10.2, False, 2),
        ("Title", 22, True, 10),
        ("Heading 1", 15, True, 6),
        ("Heading 2", 12, True, 4),
    ):
        style = styles[name]
        style.font.name = "Sarabun"
        style.font.size = Pt(size)
        style.font.bold = bold
        style.font.color.rgb = RGBColor(0, 0, 0)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.line_spacing = 1.18
        style._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), "Sarabun")
    title_ppr = styles["Title"]._element.get_or_add_pPr()
    for border in title_ppr.findall(qn("w:pBdr")):
        title_ppr.remove(border)
    for header in (section.header.paragraphs[0], section.even_page_header.paragraphs[0]):
        if pilot:
            header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            run = header.add_run("PILOT / คู่มือทดลอง / ยังไม่พร้อมใช้ครบ")
            run.bold = True
            run.font.size = Pt(9)
            set_font(run)
    for footer in (section.footer.paragraphs[0], section.even_page_footer.paragraphs[0]):
        footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = footer.add_run(f"BMS POS+ | {label} | {date}")
        run.font.size = Pt(8)
        set_font(run)
        footer.add_run("  |  หน้า ")
        add_field(footer, "PAGE")
        if pilot:
            run = footer.add_run("  |  PILOT")
            run.bold = True
            set_font(run)


def add_table(doc, rows):
    if len(rows) < 2:
        return
    width = len(rows[0])
    table = doc.add_table(rows=0, cols=width)
    table.autofit = True
    for i, items in enumerate(rows):
        if len(items) != width:
            raise ValueError(f"table row has {len(items)} cells, expected {width}: {items}")
        cells = table.add_row().cells
        if i == 0:
            tr_pr = table.rows[-1]._tr.get_or_add_trPr()
            repeat = OxmlElement("w:tblHeader")
            repeat.set(qn("w:val"), "true")
            tr_pr.append(repeat)
        no_split = OxmlElement("w:cantSplit")
        table.rows[-1]._tr.get_or_add_trPr().append(no_split)
        for cell, item in zip(cells, items):
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            cell.text = ""
            paragraph = cell.paragraphs[0]
            paragraph.paragraph_format.space_after = Pt(2)
            add_inline(paragraph, item)
            set_cell_border(cell)
            if i == 0:
                shade(cell, "E8EDF8")
                for run in paragraph.runs:
                    run.bold = True
            elif i % 2 == 0:
                shade(cell, "F7F9FC")


def parse_rows(lines):
    rows = []
    for line in lines:
        parts = [part.strip() for part in line.strip().strip("|").split("|")]
        if all(re.fullmatch(r":?-{2,}:?", part or "") for part in parts):
            continue
        rows.append(parts)
    return rows


def build_one(slug, label, pilot):
    date = PET_SUPPLY_DATE if slug == "pet-supply" else DATE
    source = SOURCE / f"{slug}-th.md"
    lines = []
    for line in source.read_text(encoding="utf-8").splitlines():
        if line.startswith("@include "):
            include_name = line.removeprefix("@include ").strip()
            if not re.fullmatch(r"[a-z-]+\.md", include_name):
                raise ValueError(f"invalid include name: {include_name}")
            lines.extend((SOURCE / include_name).read_text(encoding="utf-8").splitlines())
        else:
            lines.append(line)
    if not lines or not lines[0].startswith("# "):
        raise ValueError(f"missing title: {source}")
    doc = Document()
    configure(doc, pilot, label, date)
    title = lines[0][2:].strip()
    title_paragraph = doc.add_paragraph(title, "Title")
    title_ppr = title_paragraph._p.get_or_add_pPr()
    for border in title_ppr.findall(qn("w:pBdr")):
        title_ppr.remove(border)
    if pilot:
        p = doc.add_paragraph()
        add_inline(p, "**PILOT / คู่มือทดลอง / ยังไม่พร้อมใช้ครบ / ไม่ยืนยันว่าใช้งานบน production ได้**")
    intro = doc.add_paragraph()
    add_inline(intro, f"ฉบับทบทวน {date} · ภาษาไทย · ข้อมูลสินค้า ราคา และบุคคลในตัวอย่างเป็นข้อมูลสมมติ")
    link = doc.add_paragraph()
    add_inline(link, f"ฉบับออนไลน์ล่าสุด: [BMS POS+ ศูนย์เรียนรู้](https://bms.jachoei.com/th/learn/{slug})")
    headings = [line[3:].strip() for line in lines if line.startswith("## ")]
    doc.add_heading("สารบัญ", level=1)
    for number, heading in enumerate(headings, 1):
        p = doc.add_paragraph(style="Normal")
        add_hyperlink(p, f"{number}. {heading}", f"section_{number}", anchor=True)
    table_lines = []
    for line in lines[1:]:
        stripped = line.strip()
        if stripped.startswith("|"):
            table_lines.append(stripped)
            continue
        if table_lines:
            add_table(doc, parse_rows(table_lines))
            table_lines = []
        if not stripped:
            continue
        if stripped.startswith("## "):
            heading = stripped[3:]
            p = doc.add_heading(heading, level=1)
            add_bookmark(p, f"section_{headings.index(heading) + 1}", headings.index(heading) + 1)
        elif stripped.startswith("### "):
            doc.add_heading(stripped[4:], level=2)
        elif stripped.startswith("!["):
            match = re.fullmatch(r"!\[([^\]]+)\]\((images/[a-z0-9-]+\.(?:png|jpg|jpeg))\)", stripped)
            if not match:
                raise ValueError(f"invalid guide image: {stripped}")
            image_path = SOURCE / match.group(2)
            if not image_path.is_file():
                raise FileNotFoundError(image_path)
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.add_run().add_picture(str(image_path), width=Inches(6.5))
        elif stripped.startswith("- "):
            p = doc.add_paragraph(style="List Bullet")
            add_inline(p, stripped[2:])
        elif re.match(r"^\d+\. ", stripped):
            p = doc.add_paragraph(style="Normal")
            p.paragraph_format.left_indent = Inches(.24)
            p.paragraph_format.first_line_indent = Inches(-.24)
            add_inline(p, stripped)
        else:
            p = doc.add_paragraph()
            add_inline(p, stripped.removeprefix("> "))
    if table_lines:
        add_table(doc, parse_rows(table_lines))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    target = OUTPUT / f"bms-pos-{slug}-th.docx"
    doc.save(target)
    print(target)


if __name__ == "__main__":
    requested = sys.argv[1:]
    if requested and any(slug not in GUIDES for slug in requested):
        raise SystemExit(f"Unknown guide: {', '.join(slug for slug in requested if slug not in GUIDES)}")
    for slug in (requested or GUIDES):
        label, pilot = GUIDES[slug]
        build_one(slug, label, pilot)
