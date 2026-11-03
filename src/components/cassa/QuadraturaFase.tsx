'use client'
import { useEffect, useState } from 'react'
import { toast } from '@/hooks/use-toast'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CurrencyInput } from '@/components/ui/currency-input'
import { cn } from '@/lib/utils'
import { notificaChiusuraConfermata } from '@/app/actions/cassa'
import { friendlySaveError } from '@/lib/supabase/friendlyError'
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
  contantiPerBancaTouched: boolean
  onContantiPerBancaTouched: () => void
  /** Il fondo cassa finale si compila qui (design: fase 3). */
  fondoFinaleTouched: boolean
  onFondoFinaleTouched: () => void
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
export function QuadraturaFase({
  chiusura, fields, onFieldsChange, role, userId, onBack, onSaved, onRequestSent,
  contantiPerBancaTouched, onContantiPerBancaTouched, fondoFinaleTouched, onFondoFinaleTouched,
}: Props) {
  const pronta = contantiPerBancaTouched && fondoFinaleTouched
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestSent, setRequestSent] = useState(false)
  // Disabilita il tasto subito dopo un salvataggio riuscito, cosi' non
  // resta cliccabile su dati già salvati (rischio di doppio salvataggio/
  // doppia richiesta) — si riabilita solo se l'utente ritocca un campo.
  const [justSaved, setJustSaved] = useState(false)

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

  // Solo i campi che il cassiere ha davvero cambiato rispetto alla riga
  // attuale: una richiesta di modifica non è "come mi risultava tutto il
  // form", ma "questo campo va corretto" — se contenesse anche gli altri
  // 7 campi letti a inizio compilazione, approvarla sovrascriverebbe in
  // blocco eventuali correzioni fatte nel frattempo dal manager su campi
  // che il cassiere non intendeva affatto toccare.
  function buildChangedPayload() {
    const full = buildPayload()
    const baseline: Record<string, number> = {
      fondo_cassa_iniziale: chiusura.fondo_cassa_iniziale,
      entrate_contanti: chiusura.entrate_contanti,
      entrate_pos: chiusura.entrate_pos,
      entrate_bonifico: chiusura.entrate_bonifico,
      coperti: chiusura.coperti,
      incasso_asporto: chiusura.incasso_asporto,
      fondo_cassa_finale: chiusura.fondo_cassa_finale,
      contanti_per_banca: chiusura.contanti_per_banca,
    }
    return Object.fromEntries(
      Object.entries(full).filter(([key, value]) => value !== baseline[key])
    )
  }

  async function handleSubmit() {
    if (!pronta) return
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
        setError(friendlySaveError(err))
        return
      }
      onSaved(data as CassaChiusura)
      setJustSaved(true)
      toast({ title: isDraft ? 'Chiusura inviata' : 'Modifiche salvate' })
      // Solo alla prima conferma (bozza → confermata): notifica i manager.
      // Fire-and-forget, un errore qui non deve bloccare il cassiere.
      if (isDraft) notificaChiusuraConfermata(chiusura.id).catch(() => {})
      return
    }

    // Chiusura già confermata + cassiere: richiesta di modifica in attesa di approvazione.
    const changed = buildChangedPayload()
    if (Object.keys(changed).length === 0) {
      setSaving(false)
      setError('Nessun campo è stato modificato.')
      return
    }
    try {
      const res = await fetch('/api/cassa/richiedi-modifica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chiusura_id: chiusura.id, payload: changed }),
      })
      const result = await res.json()
      setSaving(false)
      if (!res.ok) {
        setError(result?.error ?? 'Errore nell\'invio della richiesta.')
        return
      }
      setRequestSent(true)
      toast({ title: 'Modifica inviata al manager' })
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

  useEffect(() => {
    if (error) toast({ title: error, variant: 'destructive' })
  }, [error])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Fondo e contanti per la banca</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {requestSent ? (
          <p className="rounded-[10px] bg-ok-tint px-3 py-2.5 text-sm font-medium text-ok">
            Modifica in revisione dal manager. I valori originali restano validi finché non viene approvata.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label>Fondo cassa finale <span className="text-cassa-copper">*</span></Label>
              <CurrencyInput
                value={fields.fondoCassaFinale}
                onChange={v => { onFieldsChange(f => ({ ...f, fondoCassaFinale: v })); onFondoFinaleTouched(); setJustSaved(false) }}
                className="cassa-numeric"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between"><Label>Banca teorica</Label><span className="text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">Auto</span></div>
              <CurrencyInput value={bancaTeorica} readOnly className="cassa-numeric" />
            </div>

            <div className="space-y-1.5">
              <Label>Contanti per banca <span className="text-cassa-copper">*</span></Label>
              <CurrencyInput
                value={fields.contantiPerBanca}
                onChange={v => { onFieldsChange(f => ({ ...f, contantiPerBanca: v })); onContantiPerBancaTouched(); setJustSaved(false) }}
                className="cassa-numeric"
              />
            </div>

            {/* La differenza è il blocco più grande della fase e diventa
                verde quando la cassa quadra (design). */}
            <div className={cn('flex items-center justify-between rounded-[10px] px-4 py-3.5',
              !contantiPerBancaTouched ? 'bg-secondary text-muted-foreground' : isBalanced ? 'bg-ok-tint text-ok' : 'bg-neg-tint text-neg')}>
              <div className="flex flex-col">
                <span className="text-sm font-semibold">{isBalanced && contantiPerBancaTouched ? 'Differenza · quadra' : 'Differenza'}</span>
                {!isBalanced && contantiPerBancaTouched && <span className="text-xs opacity-90">Ricontrolla i contanti o le spese prima di confermare.</span>}
              </div>
              <span className="font-mono text-2xl font-semibold">{!contantiPerBancaTouched ? '—' : isBalanced ? '0,00 €' : formatEuro(differenza)}</span>
            </div>

            {!pronta && (
              <p className="text-xs text-muted-foreground">
                Compila fondo finale e contanti per banca per confermare (anche con valore 0, se corretto).
              </p>
            )}
          </>
        )}

        <div className="flex justify-between gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onBack} disabled={saving}>Indietro</Button>
          {!requestSent && (
            <Button type="button" className="flex-1 sm:flex-none" onClick={handleSubmit} disabled={saving || !pronta || justSaved}>
              {saving ? 'Invio in corso…' : justSaved ? 'Salvato' : submitLabel}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
