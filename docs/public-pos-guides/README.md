# Public POS downloads

The five Thai Markdown files here are the single source for the downloadable Word and PDF
handbooks. `common-setup-th.md` and `common-close-th.md` are included in every book. The
public learning paths in `apps/web/lib/learning/catalog.ts` remain the online source for
the latest operational guidance and should be reviewed in the same change when workflows
change. Set `POS_GUIDE_REVIEWED_AT` in `apps/web/lib/learning/downloads.ts` and `DATE` in
`scripts/build-public-pos-guides.py` to the actual review date together.

Generate from the repository root:

```powershell
& '<Codex bundled Python path>\python.exe' .\scripts\build-public-pos-guides.py
& .\scripts\export-public-pos-guides-pdf.ps1
```

The Python runtime needs `python-docx`. The PDF export currently uses Microsoft Word on
Windows so the PDF comes from the same DOCX. Generated files are committed under
`apps/web/public/guides/pos/` and can be downloaded anonymously. Check the five DOCX
and five PDF files as pairs after every change: page count, Thai glyphs, tables, links,
page breaks, footers, content, and the building-materials PILOT mark on every page.

These are public training documents. Use invented products, staff, prices and branches
only. Do not insert tenant data, screenshots from real stores, tokens, credentials,
technical runbooks or pharmacist-only clinical evidence. Building materials remains a
pilot guide until production migration, UI and hardware readiness are separately proven.
