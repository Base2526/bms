# Public POS downloads

The five Thai Markdown files here are the single source for the downloadable Word and PDF
handbooks. `common-setup-th.md`, `common-desktop-th.md` and `common-close-th.md` are included in every book. The
public learning paths in `apps/web/lib/learning/catalog.ts` remain the online source for
the latest operational guidance and should be reviewed in the same change when workflows
change. Set `POS_GUIDE_REVIEWED_AT` in `apps/web/lib/learning/downloads.ts` and `DATE` in
`scripts/build-public-pos-guides.py` to the actual review date together.

Generate from the repository root:

```powershell
& '<Codex bundled Python path>\python.exe' .\scripts\build-public-pos-guides.py
& .\scripts\export-public-pos-guides-pdf.ps1
```

On macOS/Linux, run `bash scripts/export-public-pos-guides-pdf.sh` after the Python build.
The Python runtime needs `python-docx`. The builder embeds reviewed `images/*.jpg` and
`images/*.png` references with their adjacent Markdown captions. The shell exporter gives
LibreOffice the repository's Sarabun font; without it, Thai glyphs can disappear from the PDF.
Export PDF from each generated DOCX using Word on Windows or this script. Generated files are committed under
`apps/web/public/guides/pos/` and can be downloaded anonymously. Check the five DOCX
and five PDF files as pairs after every change: page count, Thai glyphs, tables, links,
page breaks, footers, content, and the building-materials PILOT mark on every page.

These are public training documents. Use invented products, staff, prices and branches
only. A screenshot of a real UI must show no tenant data; the Admin device image shows a
synthetic test device without its token, and the macOS setup image shows no paired store.
Do not insert screenshots from real stores, tokens, credentials,
technical runbooks or pharmacist-only clinical evidence. Building materials remains a
pilot guide until production migration, UI and hardware readiness are separately proven.
