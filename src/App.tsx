import { useCallback, useMemo, useRef, useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type ExtractedRow = {
  pageIndex: number
  productName: string
  sku: string
  qty: number
}

const PAGE_ROW_REGEX =
  /(?:^|\n)\s*(?<productName>[^|\n]+?)\s*\|\s*(?<sku>[^|\n]+?)\s*\|\s*(?<sellerSku>[^|\n]*?)\s*\|\s*(?<qty>\d+)\s*(?=\n|$)/gi

function extractRowFromPageText(pageText: string, pageIndex: number): ExtractedRow | null {
  const normalizedText = pageText.replace(/\r\n?/g, '\n').replace(/[\u00a0\t]+/g, ' ')
  const match = PAGE_ROW_REGEX.exec(normalizedText)

  if (!match?.groups) {
    return null
  }

  const productName = match.groups.productName.trim()
  const sku = match.groups.sku.trim()
  const qty = Number.parseInt(match.groups.qty.trim(), 10)

  if (!productName || !sku || Number.isNaN(qty)) {
    return null
  }

  return {
    pageIndex,
    productName,
    sku,
    qty,
  }
}

function extractRowsFromPdfText(pageText: string, pageIndex: number): ExtractedRow[] {
  const normalizedText = pageText.replace(/\r\n?/g, '\n').replace(/[\u00a0\t]+/g, ' ')
  const rows: ExtractedRow[] = []

  PAGE_ROW_REGEX.lastIndex = 0

  for (const match of normalizedText.matchAll(PAGE_ROW_REGEX)) {
    const productName = match.groups?.productName?.trim() ?? ''
    const sku = match.groups?.sku?.trim() ?? ''
    const qty = Number.parseInt(match.groups?.qty?.trim() ?? '', 10)

    if (!productName || !sku || Number.isNaN(qty)) {
      continue
    }

    rows.push({
      pageIndex,
      productName,
      sku,
      qty,
    })
  }

  if (rows.length > 0) {
    return rows
  }

  const fallbackRow = extractRowFromPageText(normalizedText, pageIndex)

  return fallbackRow ? [fallbackRow] : []
}

function sortExtractedRows(rows: ExtractedRow[]): ExtractedRow[] {
  return [...rows].sort((left, right) => {
    const productNameComparison = left.productName.localeCompare(right.productName)

    if (productNameComparison !== 0) {
      return productNameComparison
    }

    const skuComparison = left.sku.localeCompare(right.sku)

    if (skuComparison !== 0) {
      return skuComparison
    }

    return left.qty - right.qty
  })
}

function App() {
  const [fileName, setFileName] = useState<string | null>(null)
  const [uploadedPdfBytes, setUploadedPdfBytes] = useState<ArrayBuffer | null>(null)
  const [extractedRows, setExtractedRows] = useState<ExtractedRow[]>([])
  const [statusMessage, setStatusMessage] = useState('Upload a PDF to extract rows.')
  const [isDragging, setIsDragging] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const extractionRunIdRef = useRef(0)

  const dropzoneTitle = useMemo(
    () => (fileName ? 'PDF ready to parse' : 'Drop your PDF here'),
    [fileName],
  )

  const canProcessPdf =
    uploadedPdfBytes !== null && extractedRows.length > 0 && !isExtracting && !isGenerating

  const handleFile = useCallback(async (files: FileList | null) => {
    const file = files?.[0]

    if (!file) {
      return
    }

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setFileName(null)
      setUploadedPdfBytes(null)
      setExtractedRows([])
      setStatusMessage('Please upload a PDF file.')
      return
    }

    const extractionRunId = extractionRunIdRef.current + 1
    extractionRunIdRef.current = extractionRunId

    setFileName(file.name)
    setStatusMessage('Reading PDF...')
    setExtractedRows([])
    setUploadedPdfBytes(null)
    setIsExtracting(true)

    try {
      const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader()

        reader.onload = () => {
          if (reader.result instanceof ArrayBuffer) {
            resolve(reader.result)
            return
          }

          reject(new Error('Unable to read the selected file.'))
        }

        reader.onerror = () => {
          reject(reader.error ?? new Error('Unable to read the selected file.'))
        }

        reader.readAsArrayBuffer(file)
      })

      if (extractionRunIdRef.current !== extractionRunId) {
        return
      }

      setUploadedPdfBytes(arrayBuffer)
      setStatusMessage('Extracting text from PDF...')

      const loadingTask = getDocument({ data: arrayBuffer })

      try {
        const pdfDocument = await loadingTask.promise
        const pageCount = pdfDocument.numPages
        const rows: ExtractedRow[] = []

        for (let pageIndex = 1; pageIndex <= pageCount; pageIndex += 1) {
          if (extractionRunIdRef.current !== extractionRunId) {
            return
          }

          const page = await pdfDocument.getPage(pageIndex)

          try {
            const textContent = await page.getTextContent()
            const pageText = textContent.items
              .map((item) => ('str' in item ? item.str : ''))
              .join(' ')

            rows.push(...extractRowsFromPdfText(pageText, pageIndex))
          } finally {
            page.cleanup()
          }
        }

        if (extractionRunIdRef.current !== extractionRunId) {
          return
        }

        const sortedRows = sortExtractedRows(rows)

        setExtractedRows(sortedRows)

        if (sortedRows.length === 0) {
          setStatusMessage('No matching product rows were found in the uploaded PDF.')
        } else {
          setStatusMessage(
            `Extracted ${sortedRows.length} row${sortedRows.length === 1 ? '' : 's'} from ${pageCount} page${pageCount === 1 ? '' : 's'}.`,
          )
        }
      } finally {
        loadingTask.destroy()
      }
    } catch {
      if (extractionRunIdRef.current === extractionRunId) {
        setExtractedRows([])
        setUploadedPdfBytes(null)
        setStatusMessage('The PDF could not be parsed. Check that it is a valid file with readable text.')
      }
    } finally {
      if (extractionRunIdRef.current === extractionRunId) {
        setIsExtracting(false)
      }
    }
  }, [])

  const handleProcessAndDownload = useCallback(async () => {
    if (!uploadedPdfBytes || extractedRows.length === 0 || isExtracting || isGenerating) {
      return
    }

    setIsGenerating(true)
    setStatusMessage('Building sorted PDF...')

    try {
      const sourcePdf = await PDFDocument.load(uploadedPdfBytes)
      const outputPdf = await PDFDocument.create()
      const copiedPages = await outputPdf.copyPages(
        sourcePdf,
        extractedRows.map((row) => row.pageIndex - 1),
      )

      copiedPages.forEach((page) => {
        outputPdf.addPage(page)
      })

      const sortedPdfBytes = await outputPdf.save()
      const blob = new Blob([new Uint8Array(sortedPdfBytes).buffer], {
        type: 'application/pdf',
      })
      const downloadUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')

      anchor.href = downloadUrl
      anchor.download = 'Sorted_Orders.pdf'
      anchor.rel = 'noreferrer'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(downloadUrl)

      setStatusMessage('Sorted_Orders.pdf has been downloaded.')
    } catch {
      setStatusMessage('The sorted PDF could not be generated. Please try again.')
    } finally {
      setIsGenerating(false)
    }
  }, [extractedRows, uploadedPdfBytes, isExtracting, isGenerating])

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(244,114,182,0.16),_transparent_30%),linear-gradient(180deg,_#08111f_0%,_#09111b_55%,_#05070d_100%)] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
        <section className="w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/10 bg-white/6 shadow-[0_24px_120px_rgba(15,23,42,0.45)] backdrop-blur-2xl">
          <div className="grid gap-8 p-5 sm:p-8 lg:grid-cols-[1.25fr_0.75fr] lg:p-10">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.35em] text-cyan-100/80">
                PDF extraction workspace
              </div>

              <div className="space-y-4">
                <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                  Upload a PDF, preview the extracted data, and download the result.
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                  This starter ships with a drag-and-drop upload area, a preview table shell,
                  and PWA support so the workflow feels app-like on desktop and mobile.
                </p>
              </div>

              <div
                className={`group rounded-[1.75rem] border border-dashed p-6 transition-all duration-200 sm:p-8 ${
                  isDragging
                    ? 'border-cyan-300 bg-cyan-300/10 shadow-[0_0_0_1px_rgba(103,232,249,0.2),0_20px_50px_rgba(8,145,178,0.25)]'
                    : 'border-white/15 bg-white/5 hover:border-cyan-200/40 hover:bg-white/8'
                }`}
                onDragEnter={(event) => {
                  event.preventDefault()
                  setIsDragging(true)
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={(event) => {
                  event.preventDefault()
                  setIsDragging(false)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  setIsDragging(false)
                  handleFile(event.dataTransfer.files)
                }}
              >
                <label className="flex cursor-pointer flex-col items-center justify-center gap-4 text-center">
                  <div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-cyan-300 to-sky-500 text-2xl font-bold text-slate-950 shadow-lg shadow-cyan-400/20 transition-transform duration-200 group-hover:-translate-y-0.5">
                    PDF
                  </div>

                  <div className="space-y-1">
                    <p className="text-lg font-semibold text-white">{dropzoneTitle}</p>
                    <p className="text-sm text-slate-300">
                      Drag and drop a file, or click to browse. PDF files only.
                    </p>
                  </div>

                  <input
                    className="sr-only"
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(event) => handleFile(event.target.files)}
                  />

                  <span className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-slate-100 transition group-hover:border-cyan-300/40 group-hover:bg-cyan-300/10">
                    {fileName ? 'Replace file' : 'Select PDF'}
                  </span>
                </label>

                {fileName ? (
                  <p className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                    Selected file: <span className="font-semibold text-white">{fileName}</span>
                  </p>
                ) : null}

                {isExtracting ? (
                  <div
                    className="mt-4 flex items-center justify-center gap-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50"
                    role="status"
                    aria-live="polite"
                  >
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-cyan-100 border-t-transparent" />
                    Extracting text from the PDF...
                  </div>
                ) : null}
              </div>

              <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/40 p-5 sm:p-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-[0.3em] text-cyan-200/75">
                      Preview table
                    </p>
                    <h2 className="mt-2 text-xl font-semibold text-white">Extracted rows</h2>
                  </div>
                  <p className="flex items-center gap-2 text-sm text-slate-400" aria-live="polite">
                    {isExtracting || isGenerating ? (
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : null}
                    <span>{statusMessage}</span>
                  </p>
                </div>

                <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
                  <table className="min-w-full divide-y divide-white/10 text-left text-sm">
                    <thead className="bg-white/5 text-slate-300">
                      <tr>
                        <th className="px-4 py-3 font-medium">Page</th>
                        <th className="px-4 py-3 font-medium">Product Name</th>
                        <th className="px-4 py-3 font-medium">SKU</th>
                        <th className="px-4 py-3 font-medium">Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 bg-slate-950/30 text-slate-100">
                      {extractedRows.length > 0 ? (
                        extractedRows.map((row, index) => (
                          <tr key={`${row.pageIndex}-${row.sku}-${index}`}>
                            <td className="px-4 py-4 font-medium text-white">{row.pageIndex}</td>
                            <td className="px-4 py-4 text-slate-300">{row.productName}</td>
                            <td className="px-4 py-4 text-slate-300">{row.sku}</td>
                            <td className="px-4 py-4 text-slate-300">{row.qty}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="px-4 py-4 text-slate-400" colSpan={4}>
                            Upload a PDF to preview parsed rows here.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <aside className="space-y-6 rounded-[1.75rem] border border-white/10 bg-slate-950/35 p-5 sm:p-6">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p className="text-sm font-medium uppercase tracking-[0.3em] text-fuchsia-200/70">
                  Processing state
                </p>
                <div className="mt-4 space-y-3 text-sm text-slate-300">
                  <p>1. Upload a single PDF file.</p>
                  <p>2. Parse and populate the preview table.</p>
                  <p>3. Download the transformed output.</p>
                </div>
              </div>

              <button
                type="button"
                disabled={!canProcessPdf}
                onClick={() => {
                  void handleProcessAndDownload()
                }}
                className="inline-flex w-full items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-r from-cyan-400/40 to-sky-500/40 px-5 py-4 text-sm font-semibold text-white/80 shadow-lg shadow-cyan-500/10 transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isGenerating ? (
                  <span className="inline-flex items-center gap-3">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Generating PDF...
                  </span>
                ) : (
                  'Process &amp; Download'
                )}
              </button>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-sm text-slate-300">
                <p className="font-semibold text-white">PWA ready</p>
                <p className="mt-2 leading-6">
                  The app includes a manifest, installable icons, and a service worker setup
                  through vite-plugin-pwa.
                </p>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  )
}

export default App
