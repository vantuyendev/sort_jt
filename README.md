# PDF Extractor PWA

A modern Vite + React app with Tailwind CSS, vite-plugin-pwa, and `pdfjs-dist`. It includes a drag-and-drop PDF upload zone and a preview table that extracts product rows from PDFs.

## Stack

- React 19
- Vite
- Tailwind CSS 4
- pdfjs-dist
- vite-plugin-pwa

## Scripts

```bash
npm install
npm run dev
npm run build
npm run preview
npm run lint
```

## Notes

- The upload zone accepts PDF files only.
- The parser reads each uploaded PDF page, extracts product rows, and previews `pageIndex`, `productName`, `sku`, and `qty`.
- File processing stays entirely in the browser with `pdfjs-dist` and `pdf-lib`; there are no external API calls for extraction or PDF generation.
- The UI shows loading states while extracting text and while generating the sorted PDF so large files have clear progress feedback.
- PWA assets and manifest metadata are configured for installability on desktop and mobile browsers.
