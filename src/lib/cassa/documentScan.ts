// Scanner documenti "statico" (niente stream video, niente OpenCV/WASM):
// rilevamento bordi su una foto già scattata + correzione prospettica in
// canvas. Tutto client-side e senza dipendenze — l'alternativa
// (OpenCV.js + jscanify) avrebbe portato ~8 MB di WASM in un'app usata
// da telefono in sala, per un guadagno di precisione che qui è coperto
// dalla correzione manuale dei quattro angoli.

export interface Punto { x: number; y: number }
// Ordine fisso: alto-sinistra, alto-destra, basso-destra, basso-sinistra.
export type Quadrilatero = [Punto, Punto, Punto, Punto]

const LARGHEZZA_ANALISI = 480

// Soglia di Otsu: separa il documento (chiaro) dallo sfondo (scuro)
// massimizzando la varianza inter-classe dell'istogramma dei grigi.
function sogliaOtsu(istogramma: number[], totalePixel: number): number {
  let sommaTotale = 0
  for (let i = 0; i < 256; i++) sommaTotale += i * istogramma[i]

  let sommaSfondo = 0
  let pesoSfondo = 0
  let varianzaMax = -1
  let soglia = 128

  for (let t = 0; t < 256; t++) {
    pesoSfondo += istogramma[t]
    if (pesoSfondo === 0) continue
    const pesoPrimoPiano = totalePixel - pesoSfondo
    if (pesoPrimoPiano === 0) break

    sommaSfondo += t * istogramma[t]
    const mediaSfondo = sommaSfondo / pesoSfondo
    const mediaPrimoPiano = (sommaTotale - sommaSfondo) / pesoPrimoPiano
    const varianza = pesoSfondo * pesoPrimoPiano * (mediaSfondo - mediaPrimoPiano) ** 2

    if (varianza > varianzaMax) { varianzaMax = varianza; soglia = t }
  }
  return soglia
}

// Componente connessa più grande fra i pixel "documento", per non farsi
// ingannare da altri oggetti chiari nell'inquadratura (un tovagliolo, un
// riflesso). Flood fill iterativo: la ricorsione andrebbe in stack
// overflow su una macchia da decine di migliaia di pixel.
function componenteConnessaMaggiore(maschera: Uint8Array, w: number, h: number): Uint8Array | null {
  const etichette = new Int32Array(w * h).fill(-1)
  let etichettaCorrente = 0
  let migliorEtichetta = -1
  let miglioreDimensione = 0

  const stack: number[] = []
  for (let start = 0; start < maschera.length; start++) {
    if (maschera[start] === 0 || etichette[start] !== -1) continue

    let dimensione = 0
    stack.push(start)
    etichette[start] = etichettaCorrente

    while (stack.length > 0) {
      const idx = stack.pop()!
      dimensione++
      const x = idx % w
      const y = (idx / w) | 0

      // 4-connessa: sufficiente e più veloce della 8-connessa.
      if (x > 0)     { const n = idx - 1; if (maschera[n] && etichette[n] === -1) { etichette[n] = etichettaCorrente; stack.push(n) } }
      if (x < w - 1) { const n = idx + 1; if (maschera[n] && etichette[n] === -1) { etichette[n] = etichettaCorrente; stack.push(n) } }
      if (y > 0)     { const n = idx - w; if (maschera[n] && etichette[n] === -1) { etichette[n] = etichettaCorrente; stack.push(n) } }
      if (y < h - 1) { const n = idx + w; if (maschera[n] && etichette[n] === -1) { etichette[n] = etichettaCorrente; stack.push(n) } }
    }

    if (dimensione > miglioreDimensione) { miglioreDimensione = dimensione; migliorEtichetta = etichettaCorrente }
    etichettaCorrente++
  }

  if (migliorEtichetta === -1) return null
  // Sotto il 10% dell'inquadratura non è un documento fotografato: meglio
  // dichiarare fallito il rilevamento che proporre angoli a caso.
  if (miglioreDimensione < maschera.length * 0.10) return null

  const risultato = new Uint8Array(w * h)
  for (let i = 0; i < etichette.length; i++) if (etichette[i] === migliorEtichetta) risultato[i] = 1
  return risultato
}

// Angoli di un quadrilatero anche ruotato: gli estremi di (x+y) danno la
// diagonale alto-sinistra/basso-destra, quelli di (x−y) l'altra.
function angoliDaMaschera(maschera: Uint8Array, w: number): Quadrilatero | null {
  let tl = -1, br = -1, tr = -1, bl = -1
  let sommaMin = Infinity, sommaMax = -Infinity, diffMin = Infinity, diffMax = -Infinity

  for (let i = 0; i < maschera.length; i++) {
    if (!maschera[i]) continue
    const x = i % w
    const y = (i / w) | 0
    const somma = x + y
    const diff = x - y
    if (somma < sommaMin) { sommaMin = somma; tl = i }
    if (somma > sommaMax) { sommaMax = somma; br = i }
    if (diff > diffMax)   { diffMax = diff;   tr = i }
    if (diff < diffMin)   { diffMin = diff;   bl = i }
  }

  if (tl < 0 || tr < 0 || br < 0 || bl < 0) return null
  const punto = (i: number): Punto => ({ x: i % w, y: (i / w) | 0 })
  return [punto(tl), punto(tr), punto(br), punto(bl)]
}

// Media su una finestra (2r+1)×(2r+1), separabile: attenua il testo
// stampato sul foglio (piccoli tratti scuri) che altrimenti buca la
// maschera del documento e sposta gli angoli trovati.
function sfoca(canale: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    let somma = 0
    for (let x = -r; x <= r; x++) somma += canale[y * w + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = somma / (2 * r + 1)
      somma += canale[y * w + Math.min(w - 1, x + r + 1)] - canale[y * w + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let somma = 0
    for (let y = -r; y <= r; y++) somma += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = somma / (2 * r + 1)
      somma += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

// Chiusura morfologica (dilatazione poi erosione, finestra quadrata):
// richiude i piccoli buchi e le interruzioni lungo il bordo del foglio
// (un'ombra, una piega) prima di cercare la componente più grande.
function chiudi(maschera: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const applica = (src: Uint8Array, dilata: boolean): Uint8Array => {
    const tmp = new Uint8Array(w * h)
    const out = new Uint8Array(w * h)
    const target = dilata ? 1 : 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = dilata ? 0 : 1
        for (let k = -r; k <= r && v !== target; k++) {
          const xx = x + k
          if (xx >= 0 && xx < w && src[y * w + xx] === target) v = target
        }
        tmp[y * w + x] = v
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let v = dilata ? 0 : 1
        for (let k = -r; k <= r && v !== target; k++) {
          const yy = y + k
          if (yy >= 0 && yy < h && tmp[yy * w + x] === target) v = target
        }
        out[y * w + x] = v
      }
    }
    return out
  }
  return applica(applica(maschera, true), false)
}

function mediana(valori: number[]): number {
  const ordinati = [...valori].sort((a, b) => a - b)
  return ordinati[Math.floor(ordinati.length / 2)] ?? 0
}

function areaQuadrilatero(q: Quadrilatero): number {
  let a = 0
  for (let i = 0; i < 4; i++) {
    const p = q[i], n = q[(i + 1) % 4]
    a += p.x * n.y - n.x * p.y
  }
  return Math.abs(a) / 2
}

// Dà un punteggio a una maschera candidata: quanto la sua componente
// principale "somiglia a un foglio fotografato". Un foglio riempie il
// quadrilatero dei suoi angoli quasi del tutto (rettangolarità ~1); uno
// sfondo trapelato, un'ombra o un oggetto irregolare no.
function valutaCandidato(maschera: Uint8Array, w: number, h: number): { angoli: Quadrilatero; punteggio: number } | null {
  const componente = componenteConnessaMaggiore(chiudi(maschera, w, h, 2), w, h)
  if (!componente) return null
  const angoli = angoliDaMaschera(componente, w)
  if (!angoli) return null

  let dimensione = 0
  for (let i = 0; i < componente.length; i++) dimensione += componente[i]
  const frazione = dimensione / (w * h)
  const areaQuad = areaQuadrilatero(angoli)
  if (areaQuad <= 0) return null
  const rettangolarita = dimensione / areaQuad

  // Un foglio che occupa praticamente tutta la foto non si distingue
  // dallo sfondo "trapelato" (tutta l'immagine selezionata): in entrambi
  // i casi gli angoli trovati sono quelli della foto, inutili.
  if (frazione > 0.97 || rettangolarita < 0.8) return null
  return { angoli, punteggio: Math.min(rettangolarita, 1.05) + frazione * 0.1 }
}

// Rileva i quattro angoli del documento su un canvas già disegnato.
// Restituisce coordinate nello spazio del canvas sorgente (non
// dell'immagine ridotta usata per l'analisi). null se non trova nulla di
// abbastanza convincente: in quel caso il chiamante propone angoli di
// default e lascia correggere a mano.
//
// Prova più modi di separare il foglio dallo sfondo e tiene il migliore
// (vedi valutaCandidato). Il solo "più chiaro della media" — l'unico
// criterio fino a prima — falliva spesso nei casi reali: foglio chiaro su
// un banco chiaro, DDT colorati (giallo/rosa), ombre. Qui si aggiunge la
// distanza di colore dallo sfondo, stimato dai bordi della foto: conta
// che il foglio sia DIVERSO dallo sfondo, non che sia più chiaro.
export function rilevaAngoli(sorgente: HTMLCanvasElement): Quadrilatero | null {
  const scala = LARGHEZZA_ANALISI / sorgente.width
  const w = Math.max(1, Math.round(sorgente.width * scala))
  const h = Math.max(1, Math.round(sorgente.height * scala))

  const piccolo = document.createElement('canvas')
  piccolo.width = w
  piccolo.height = h
  const ctx = piccolo.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(sorgente, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)

  const n = w * h
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) { R[p] = data[i]; G[p] = data[i + 1]; B[p] = data[i + 2] }
  const raggioSfocatura = 3
  const r = sfoca(R, w, h, raggioSfocatura), g = sfoca(G, w, h, raggioSfocatura), b = sfoca(B, w, h, raggioSfocatura)

  const sogliaDi = (valori: Float32Array, max: number): Uint8Array => {
    const istogramma = new Array(256).fill(0)
    const quantizzati = new Uint8Array(n)
    for (let p = 0; p < n; p++) {
      const q = Math.max(0, Math.min(255, Math.round((valori[p] / max) * 255)))
      quantizzati[p] = q
      istogramma[q]++
    }
    const soglia = sogliaOtsu(istogramma, n)
    const maschera = new Uint8Array(n)
    for (let p = 0; p < n; p++) maschera[p] = quantizzati[p] > soglia ? 1 : 0
    return maschera
  }

  // 1) Luminosità: foglio chiaro su sfondo scuro (il caso classico).
  const luminosita = new Float32Array(n)
  for (let p = 0; p < n; p++) luminosita[p] = r[p] * 0.299 + g[p] * 0.587 + b[p] * 0.114
  const candidati: Uint8Array[] = [sogliaDi(luminosita, 255)]

  // 2) Distanza di colore dallo sfondo, stimato dalla cornice esterna
  //    della foto (dove di norma c'è il banco, non il foglio).
  const margine = Math.max(2, Math.round(Math.min(w, h) * 0.04))
  const bordoR: number[] = [], bordoG: number[] = [], bordoB: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= margine && x < w - margine && y >= margine && y < h - margine) continue
      const p = y * w + x
      bordoR.push(r[p]); bordoG.push(g[p]); bordoB.push(b[p])
    }
  }
  const sR = mediana(bordoR), sG = mediana(bordoG), sB = mediana(bordoB)
  const distanza = new Float32Array(n)
  let distanzaMax = 1
  for (let p = 0; p < n; p++) {
    const d = Math.hypot(r[p] - sR, g[p] - sG, b[p] - sB)
    distanza[p] = d
    if (d > distanzaMax) distanzaMax = d
  }
  candidati.push(sogliaDi(distanza, distanzaMax))

  // 3) Distanza di sola tinta (cromaticità) dallo sfondo: un'ombra
  //    scurisce foglio e banco ma non ne cambia il colore, quindi questo
  //    criterio regge anche con una zona in ombra, dove i due sopra no.
  const cromaticita = (rr: number, gg: number, bb: number) => {
    const s = rr + gg + bb + 1
    return [rr / s, gg / s]
  }
  const [crS, cgS] = cromaticita(sR, sG, sB)
  const distanzaTinta = new Float32Array(n)
  let tintaMax = 1e-6
  for (let p = 0; p < n; p++) {
    const [cr, cg] = cromaticita(r[p], g[p], b[p])
    const d = Math.hypot(cr - crS, cg - cgS)
    distanzaTinta[p] = d
    if (d > tintaMax) tintaMax = d
  }
  candidati.push(sogliaDi(distanzaTinta, tintaMax))

  let migliore: { angoli: Quadrilatero; punteggio: number } | null = null
  for (const maschera of candidati) {
    const esito = valutaCandidato(maschera, w, h)
    if (esito && (!migliore || esito.punteggio > migliore.punteggio)) migliore = esito
  }
  if (!migliore) return null

  return migliore.angoli.map(p => ({ x: p.x / scala, y: p.y / scala })) as Quadrilatero
}

// Risolve un sistema lineare n×n con eliminazione di Gauss e pivoting
// parziale. Serve per l'omografia (8 incognite).
function risolviSistema(A: number[][], b: number[]): number[] | null {
  const n = b.length
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r
    if (Math.abs(A[pivot][col]) < 1e-10) return null
    if (pivot !== col) { [A[col], A[pivot]] = [A[pivot], A[col]]; [b[col], b[pivot]] = [b[pivot], b[col]] }

    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col]
      if (f === 0) continue
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c]
      b[r] -= f * b[col]
    }
  }

  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let somma = b[r]
    for (let c = r + 1; c < n; c++) somma -= A[r][c] * x[c]
    x[r] = somma / A[r][r]
  }
  return x
}

// Omografia che mappa il rettangolo di destinazione (0,0)-(outW,outH)
// sul quadrilatero sorgente: mappatura inversa, così per ogni pixel di
// destinazione so da dove prenderlo nella foto originale (nessun buco).
function omografiaDestinazioneVersoSorgente(quad: Quadrilatero, outW: number, outH: number): number[] | null {
  const dst: Punto[] = [{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }]
  const A: number[][] = []
  const b: number[] = []

  for (let i = 0; i < 4; i++) {
    const { x, y } = dst[i]
    const { x: u, y: v } = quad[i]
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u)
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v)
  }
  return risolviSistema(A, b)
}

// Lunghezza media dei lati opposti: dà le proporzioni "reali" del foglio
// una volta raddrizzato, senza schiacciarlo.
function dimensioniRaddrizzate(quad: Quadrilatero, maxLato: number): { w: number; h: number } {
  const dist = (a: Punto, b: Punto) => Math.hypot(a.x - b.x, a.y - b.y)
  const larghezza = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2
  const altezza = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2

  const scala = Math.min(1, maxLato / Math.max(larghezza, altezza))
  return {
    w: Math.max(1, Math.round(larghezza * scala)),
    h: Math.max(1, Math.round(altezza * scala)),
  }
}

// Raddrizza il quadrilatero indicato in un rettangolo, con
// interpolazione bilineare (evita la scalettatura del nearest neighbour
// sul testo piccolo, che è proprio quello che l'OCR deve leggere).
export function warpProspettiva(sorgente: HTMLCanvasElement, quad: Quadrilatero, maxLato = 2200): HTMLCanvasElement | null {
  const { w: outW, h: outH } = dimensioniRaddrizzate(quad, maxLato)
  const H = omografiaDestinazioneVersoSorgente(quad, outW, outH)
  if (!H) return null

  const ctxSorgente = sorgente.getContext('2d', { willReadFrequently: true })
  if (!ctxSorgente) return null
  const src = ctxSorgente.getImageData(0, 0, sorgente.width, sorgente.height)
  const sw = src.width, sh = src.height

  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const ctxOut = out.getContext('2d')
  if (!ctxOut) return null
  const dst = ctxOut.createImageData(outW, outH)

  const [h0, h1, h2, h3, h4, h5, h6, h7] = H

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const den = h6 * x + h7 * y + 1
      const sx = (h0 * x + h1 * y + h2) / den
      const sy = (h3 * x + h4 * y + h5) / den
      const di = (y * outW + x) * 4

      if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) {
        dst.data[di] = dst.data[di + 1] = dst.data[di + 2] = 255
        dst.data[di + 3] = 255
        continue
      }

      const x0 = sx | 0, y0 = sy | 0
      const x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1)
      const fx = sx - x0, fy = sy - y0

      for (let c = 0; c < 3; c++) {
        const p00 = src.data[(y0 * sw + x0) * 4 + c]
        const p10 = src.data[(y0 * sw + x1) * 4 + c]
        const p01 = src.data[(y1 * sw + x0) * 4 + c]
        const p11 = src.data[(y1 * sw + x1) * 4 + c]
        dst.data[di + c] =
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) +
          p01 * (1 - fx) * fy       + p11 * fx * fy
      }
      dst.data[di + 3] = 255
    }
  }

  ctxOut.putImageData(dst, 0, 0)
  return out
}

// Angoli di ripiego quando il rilevamento fallisce: un rettangolo
// leggermente rientrato, che l'utente trascina sui bordi veri.
export function angoliDefault(w: number, h: number): Quadrilatero {
  const mx = w * 0.1, my = h * 0.1
  return [
    { x: mx, y: my },
    { x: w - mx, y: my },
    { x: w - mx, y: h - my },
    { x: mx, y: h - my },
  ]
}
