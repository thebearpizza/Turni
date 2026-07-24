'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CurrencyInput } from '@/components/ui/currency-input'
import { cn } from '@/lib/utils'
import type { CassaChiusura } from '@/types'

interface Fields {
  fondoCassaIniziale: number
  entrateContanti: number
  entratePos: number
  entrateBonifico: number
  coperti: number
  incassoAsporto: number
  fondoCassaFinale: number
  contantiPerBanca: number
}

interface Props {
  chiusura: CassaChiusura
  fields: Fields
  onFieldsChange: (updater: (f: Fields) => Fields) => void
  role: 'manager' | 'cassiere'
  userId: string
  onBack: () => void
  onSaved: (row: CassaChiusura) => void
  onRequestSent: () => void
}

function formatEuro(n: number): string {
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2).replace('.', ',')} €`
}

// Fase 3 del wizard: quadratura di cassa e conferma/approvazione.
// - Prima creazione (bozza in_verifica → confermata): salvataggio diretto, nessuna approvazione.
// - Modifica di una chiusura già confermata, da manager: applicata direttamente.
// - Modifica di una chiusura già confermata, da cassiere: richiesta inviata al manager
//   (cassa_chiusure_modifiche), la riga originale resta invariata finché non approvata.
export function QuadraturaFase({ chiusura, fields, onFieldsChange, role, userId, onBack, onSaved, onRequestSent }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestSent, setRequestSent] = useState(false)

  const isDraft = chiusura.stato === 'in_verifica'

  const bancaTeorica = fields.entrateContanti + fields.fondoCassaIniziale - fields.fondoCassaFinale - chiusura.totale_spese_giornaliere
  const differenza = fields.contantiPerBanca - bancaTeorica
  const isBalanced = Math.abs(differenza) < 0.005

  function buildPayload() {
    return {
      fondo_cassa_iniziale: fields.fondoCassaIniziale,
      entrate_contanti: fields.entrateContanti,
      entrate_pos: fields.entratePos,
      entrate_bonifico: fields.entrateBonifico,
      coperti: fields.coperti,
      incasso_asporto: fields.incassoAsporto,
      fondo_cassa_finale: fields.fondoCassaFinale,
      contanti_per_banca: fields.contantiPerBanca,
    }
  }

  async function handleSubmit() {
    setSaving(true)
    setError(null)

    // Bozza → prima conferma: salvataggio diretto per chiunque l'abbia compilata.
    // Chiusura già confermata + manager: applicata direttamente.
    if (isDraft || role === 'manager') {
      const supabase = createClient()
      const update = isDraft
        ? { ...buildPayload(), stato: 'confermata' as const, updated_by: userId }
        : { ...buildPayload(), updated_by: userId }

      const { data, error: err } = await supabase
        .from('cassa_chiusure')
        .update(update)
        .eq('id', chiusura.id)
        .select()
        .single()

      setSaving(false)
      if (err || !data) {
        setError(`Errore nel salvataggio: ${err?.message ?? 'sconosciuto'}`)
        return
      }
      onSaved(data as CassaChiusura)
      return
    }

    // Chiusura già confermata + cassiere: richiesta di modifica in attesa di approvazione.
    try {
      const res = await fetch('/api/cassa/richiedi-modifica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chiusura_id: chiusura.id, payload: buildPayload() }),
      })
      const result = await res.json()
      setSaving(false)
      if (!res.ok) {
        setError(result?.error ?? 'Errore nell\'invio della richiesta.')
        return
      }
      setRequestSent(true)
      onRequestSent()
    } catch {
      setSaving(false)
      setError('Errore nell\'invio della richiesta.')
    }
  }

  const submitLabel = isDraft
    ? 'Conferma chiusura'
    : role === 'manager'
      ? 'Salva modifiche'
      : 'Invia richiesta di modifica'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Quadratura</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {requestSent ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-md px-3 py-2">
            Richiesta di modifica inviata al manager. I valori originali restano validi finché non verrà approvata.
          </p>
        ) : (
          <>
            {!isDraft && role === 'cassiere' && (
              <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md px-3 py-2">
                Questa chiusura è già confermata: le modifiche verranno inviate al manager per l&apos;approvazione.
              </p>
            )}

            <div className="space-y-1.5">
              <Label>Banca Teorica</Label>
              <CurrencyInput value={bancaTeorica} readOnly />
            </div>

            <div className="space-y-1.5">
              <Label>Contanti per Banca</Label>
              <CurrencyInput
                value={fields.contantiPerBanca}
                onChange={v => onFieldsChange(f => ({ ...f, contantiPerBanca: v }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Differenza</Label>
              <div className={cn(
                'flex h-9 w-full items-center rounded-md border px-3 text-base font-medium tabular-nums',
                isBalanced
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400'
                  : 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
              )}>
                {isBalanced ? '0,00 €' : formatEuro(differenza)}
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </>
        )}

        <div className="flex justify-between pt-2">
          <Button type="button" variant="outline" onClick={onBack} disabled={saving}>Indietro</Button>
          {!requestSent && (
            <Button type="button" onClick={handleSubmit} disabled={saving}>
              {saving ? 'Salvataggio…' : submitLabel}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
