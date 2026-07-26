'use client'
import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Download, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SheetCell {
  text: string
  numeric: boolean
}

interface SheetPreview {
  headers: SheetCell[]
  rows: SheetCell[][]
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  chiusuraId: string | null
  format: 'pdf' | 'xlsx' | null
  title: string
  fileNameBase: string
}

// Anteprima in-app del PDF/Excel di una chiusura: stesso endpoint di export
// usato prima per il download diretto, ma ora mostrato in un dialog con
// chiusura (X, già inclusa da DialogContent) e un pulsante Scarica dedicato
// che riusa il blob già scaricato per la preview.
export function ChiusuraFileViewer({ open, onOpenChange, chiusuraId, format, title, fileNameBase }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetPreview | null>(null)
  const blobRef = useRef<Blob | null>(null)

  useEffect(() => {
    if (!open || !chiusuraId || !format) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setPdfUrl(null)
    setSheet(null)
    blobRef.current = null

    async function run() {
      try {
        const res = await fetch('/api/cassa/chiusura-export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chiusura_id: chiusuraId, format }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => null)
          throw new Error(err?.error ?? 'Errore nel caricamento del file.')
        }
        const blob = await res.blob()
        if (cancelled) return
        blobRef.current = blob

        if (format === 'pdf') {
          setPdfUrl(URL.createObjectURL(blob))
        } else {
          const ExcelJS = (await import('exceljs')).default
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load(await blob.arrayBuffer())
          const worksheet = workbook.worksheets[0]

          const rows: SheetCell[][] = []
          worksheet.eachRow(row => {
            const cells: SheetCell[] = []
            row.eachCell({ includeEmpty: true }, cell => {
              cells.push({ text: cell.text ?? '', numeric: cell.type === ExcelJS.ValueType.Number })
            })
            rows.push(cells)
          })
          if (!cancelled) setSheet({ headers: rows[0] ?? [], rows: rows.slice(1) })
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Errore nel caricamento del file.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [open, chiusuraId, format])

  // Revoca l'URL del blob PDF ad ogni cambio (nuovo file o chiusura del
  // dialog), evitando di accumulare object URL orfani.
  useEffect(() => {
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }
  }, [pdfUrl])

  function handleDownload() {
    if (!blobRef.current || !format) return
    const url = URL.createObjectURL(blobRef.current)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileNameBase}.${format}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const ready = !loading && !error && (pdfUrl || sheet)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="cassa-perforated-top flex max-h-[85vh] max-w-4xl flex-col gap-4">
        <DialogHeader className="pr-6">
          <DialogTitle className="cassa-display text-lg">{title}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
          {loading && (
            <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Caricamento…
            </div>
          )}
          {!loading && error && (
            <div className="flex h-64 items-center justify-center px-6 text-center text-sm text-destructive">
              {error}
            </div>
          )}
          {!loading && !error && format === 'pdf' && pdfUrl && (
            <iframe src={pdfUrl} title={title} className="h-[70vh] w-full" />
          )}
          {!loading && !error && format === 'xlsx' && sheet && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  {sheet.headers.map((h, i) => (
                    <th key={i} className="whitespace-nowrap border-b border-border px-3 py-2 text-left font-medium">
                      {h.text}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-border last:border-0">
                    {row.map((cell, ci) => (
                      <td key={ci} className={cn('whitespace-nowrap px-3 py-1.5', cell.numeric && 'cassa-numeric text-right')}>
                        {cell.text}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={handleDownload} disabled={!ready}>
            <Download className="h-4 w-4" /> Scarica {format?.toUpperCase()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
