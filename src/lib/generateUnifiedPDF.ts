// Client-only utility — uses canvas API and dynamically imports pdf-lib
// so it never runs on the server and doesn't inflate the initial bundle.

async function compressImageForPDF(
  file: File,
): Promise<{ bytes: ArrayBuffer; isPng: boolean }> {
  const MAX_DIM = 1200
  const QUALITY = 0.85

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.round(img.naturalWidth * scale)
      const h = Math.round(img.naturalHeight * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      const isPng = file.type === 'image/png'
      canvas.toBlob(
        blob => {
          if (!blob) { reject(new Error('Compressione immagine fallita')); return }
          blob.arrayBuffer().then(bytes => resolve({ bytes, isPng })).catch(reject)
        },
        isPng ? 'image/png' : 'image/jpeg',
        isPng ? undefined : QUALITY,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Caricamento immagine fallito')) }
    img.src = url
  })
}

// Merges an array of image/PDF Files into a single PDF File.
// pdf-lib is imported lazily to keep it out of the initial JS bundle.
export async function generateUnifiedPDF(files: File[]): Promise<File> {
  const { PDFDocument } = await import('pdf-lib')
  const unified = await PDFDocument.create()

  for (const file of files) {
    if (file.type === 'application/pdf') {
      const bytes = await file.arrayBuffer()
      const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })
      const indices = srcDoc.getPageIndices()
      const copied = await unified.copyPages(srcDoc, indices)
      copied.forEach(p => unified.addPage(p))
    } else if (file.type.startsWith('image/')) {
      const { bytes, isPng } = await compressImageForPDF(file)
      const img = isPng
        ? await unified.embedPng(bytes)
        : await unified.embedJpg(bytes)

      // A4 page (595.28 × 841.89 pt) with 36pt margins on each side
      const PAGE_W = 595.28
      const PAGE_H = 841.89
      const MARGIN = 36
      const { width, height } = img.scaleToFit(PAGE_W - MARGIN * 2, PAGE_H - MARGIN * 2)
      const page = unified.addPage([PAGE_W, PAGE_H])
      page.drawImage(img, {
        x: (PAGE_W - width) / 2,
        y: (PAGE_H - height) / 2,
        width,
        height,
      })
    }
    // Files that are neither image nor PDF are silently skipped
  }

  const pdfBytes = await unified.save()
  // new Uint8Array(src) copies into a plain ArrayBuffer, satisfying the File constructor's BlobPart type
  return new File([new Uint8Array(pdfBytes)], 'allegati_unificati.pdf', { type: 'application/pdf' })
}
