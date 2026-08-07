'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CountInput } from '@/components/ui/count-input'
import { TimeInput } from '@/components/ui/time-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { servizioDaOrario, normalizzaOrario, ORIGINE_LABEL } from '@/lib/cassa/prenotazioniAgenda'
import type { Prenotazione } from '@/types'

interface InsegnaOption { codice: string; etichetta: string }

interface Props {
  open:          boolean
  onOpenChange:  (open: boolean) => void
  restaurantId:  string
  insegne:       InsegnaOption[]
  // In creazione: giorno e orario della fascia da cui si è premuto "+".
  iniziale:      { data: string; orario: string } | null
  // In modifica: la prenotazione da aprire. Vale anche come "Dettagli",
  // perché mostra tutti i campi del record — inclusi quelli che nella
  // riga in agenda non ci starebbero (telefono, note, provenienza).
  prenotazione:  Prenotazione | null
  onSalvata:     () => void
}

interface Campi {
  nome:     string
  cognome:  string
  data:     string
  orario:   string
  persone:  number
  bambini:  number
  telefono: string
  email:    string
  sconto:   string
  insegna:  string
  note:     string
}

function campiVuoti(iniziale: { data: string; orario: string } | null, insegnaDefault: string): Campi {
  return {
    nome: '', cognome: '',
    data: iniziale?.data ?? '', orario: iniziale?.orario ?? '',
    persone: 2, bambini: 0,
    telefono: '', email: '', sconto: '',
    insegna: insegnaDefault, note: '',
  }
}

function campiDa(p: Prenotazione): Campi {
  return {
    nome:     p.nome,
    cognome:  p.cognome ?? '',
    data:     p.data,
    orario:   normalizzaOrario(p.orario),
    persone:  p.persone,
    bambini:  p.bambini,
    telefono: p.telefono ?? '',
    email:    p.email ?? '',
    sconto:   p.sconto_percentuale != null ? String(p.sconto_percentuale) : '',
    insegna:  p.insegna ?? '',
    note:     p.note ?? '',
  }
}

// Il chiamante monta questo componente con una `key` che cambia a ogni
// apertura: i campi si inizializzano una volta sola, alla creazione, e
// non serve alcun effetto per risincronizzarli. Vale anche come
// protezione dal refresh dell'agenda che arriva mentre si sta digitando
// (le prenotazioni si ricaricano da sole via realtime): senza remount,
// un effetto di sincronizzazione rischierebbe di sovrascrivere il testo
// appena scritto.
export function PrenotazioneFormDialog({
  open, onOpenChange, restaurantId, insegne, iniziale, prenotazione, onSalvata,
}: Props) {
  const insegnaDefault = insegne[0]?.codice ?? ''
  const [campi, setCampi] = useState<Campi>(
    () => (prenotazione ? campiDa(prenotazione) : campiVuoti(iniziale, insegnaDefault))
  )
  const [salvando, setSalvando] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  const completo = campi.nome.trim() !== '' && campi.data !== '' && campi.orario !== ''

  async function salva() {
    if (!completo || salvando) return
    setSalvando(true)
    setErrore(null)

    const orario = normalizzaOrario(campi.orario)
    const sconto = campi.sconto.trim() === '' ? null : Number(campi.sconto.replace(',', '.'))

    const valori = {
      restaurant_id:      restaurantId,
      insegna:            campi.insegna || null,
      data:               campi.data,
      orario,
      servizio:           servizioDaOrario(orario),
      nome:               campi.nome.trim(),
      cognome:            campi.cognome.trim() || null,
      persone:            campi.persone,
      bambini:            campi.bambini,
      telefono:           campi.telefono.trim() || null,
      email:              campi.email.trim() || null,
      sconto_percentuale: sconto != null && Number.isFinite(sconto) ? sconto : null,
      note:               campi.note.trim() || null,
    }

    const supabase = createClient()
    const { error } = prenotazione
      ? await supabase.from('prenotazioni').update(valori).eq('id', prenotazione.id)
      : await supabase.from('prenotazioni').insert({ ...valori, origine: 'manuale', stato: 'confermata' })

    setSalvando(false)
    if (error) { setErrore(error.message); return }
    onSalvata()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!salvando) onOpenChange(o) }}>
      <DialogContent className="cassa cassa-perforated-top max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="cassa-display text-lg">
            {prenotazione ? 'Dettagli prenotazione' : 'Nuova prenotazione'}
          </DialogTitle>
        </DialogHeader>

        {prenotazione && (
          <p className="text-xs text-muted-foreground">
            {ORIGINE_LABEL[prenotazione.origine] ?? prenotazione.origine}
            {prenotazione.riferimento_esterno && ` · rif. ${prenotazione.riferimento_esterno}`}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="pren-nome">Nome</Label>
            <Input
              id="pren-nome"
              value={campi.nome}
              onChange={e => setCampi(c => ({ ...c, nome: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pren-cognome">Cognome</Label>
            <Input
              id="pren-cognome"
              value={campi.cognome}
              onChange={e => setCampi(c => ({ ...c, cognome: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pren-data">Giorno</Label>
            <Input
              id="pren-data"
              type="date"
              value={campi.data}
              onChange={e => setCampi(c => ({ ...c, data: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Orario</Label>
            <TimeInput value={campi.orario} onChange={v => setCampi(c => ({ ...c, orario: v }))} />
          </div>

          <div className="space-y-1.5">
            <Label>Persone</Label>
            <CountInput value={campi.persone} onChange={v => setCampi(c => ({ ...c, persone: v }))} min={0} />
          </div>
          <div className="space-y-1.5">
            <Label>Bambini</Label>
            <CountInput value={campi.bambini} onChange={v => setCampi(c => ({ ...c, bambini: v }))} min={0} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pren-tel">Telefono</Label>
            <Input
              id="pren-tel"
              type="tel"
              inputMode="tel"
              value={campi.telefono}
              onChange={e => setCampi(c => ({ ...c, telefono: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pren-sconto">Sconto %</Label>
            <Input
              id="pren-sconto"
              inputMode="decimal"
              placeholder="—"
              value={campi.sconto}
              onChange={e => setCampi(c => ({ ...c, sconto: e.target.value }))}
            />
          </div>

          {insegne.length > 1 && (
            <div className="col-span-2 space-y-1.5">
              <Label>Insegna</Label>
              <Select value={campi.insegna} onValueChange={v => setCampi(c => ({ ...c, insegna: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {insegne.map(i => <SelectItem key={i.codice} value={i.codice}>{i.etichetta}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="pren-email">Email</Label>
            <Input
              id="pren-email"
              type="email"
              value={campi.email}
              onChange={e => setCampi(c => ({ ...c, email: e.target.value }))}
            />
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="pren-note">Note</Label>
            <Textarea
              id="pren-note"
              rows={3}
              value={campi.note}
              onChange={e => setCampi(c => ({ ...c, note: e.target.value }))}
            />
          </div>
        </div>

        {errore && <p className="text-sm text-destructive">{errore}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
            Annulla
          </Button>
          <Button type="button" onClick={salva} disabled={!completo || salvando}>
            {salvando ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvataggio…</> : 'Salva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
