'use client'
import { useEffect, useState, useCallback } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Badge } from '@/components/ui/badge'
import { SpeseFase } from '@/components/cassa/SpeseFase'
import type { CassaChiusura } from '@/types'

const TZ = 'Europe/Rome'

interface RestaurantOption {
  id: string
  name: string
}

interface Props {
  role: 'manager' | 'cassiere'
  restaurants: RestaurantOption[]
  fixedRestaurantId: string | null
  userId: string
}

const emptyFields = () => ({
  fondoCassaIniziale: 0,
  entrateContanti: 0,
  entratePos: 0,
  entrateBonifico: 0,
  coperti: 0,
  incassoAsporto: 0,
  fondoCassaFinale: 0,
})

export function ChiusuraCassaClient({ role, restaurants, fixedRestaurantId, userId }: Props) {
  const [fase, setFase] = useState<1 | 2 | 3>(1)
  const [restaurantId, setRestaurantId] = useState(
    fixedRestaurantId ?? (restaurants.length === 1 ? restaurants[0].id : '')
  )
  const [date, setDate] = useState(() => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'))

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [existing, setExisting] = useState<CassaChiusura | null>(null)
  const [fields, setFields] = useState(emptyFields())
  const [ownerId, setOwnerId] = useState<string | null>(null)

  const loadChiusura = useCallback(async () => {
    if (!restaurantId || !date) return
    setLoading(true)
    const supabase = createClient()

    const { data: row } = await supabase
      .from('cassa_chiusure')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('data', date)
      .maybeSingle()

    if (row) {
      setExisting(row)
      setFields({
        fondoCassaIniziale: row.fondo_cassa_iniziale,
        entrateContanti: row.entrate_contanti,
        entratePos: row.entrate_pos,
        entrateBonifico: row.entrate_bonifico,
        coperti: row.coperti,
        incassoAsporto: row.incasso_asporto,
        fondoCassaFinale: row.fondo_cassa_finale,
      })
      setLoading(false)
      return
    }

    setExisting(null)

    // Nessuna chiusura per questa data: replica lato client la stessa
    // logica del trigger precompila_fondo, cosi' il valore corretto e'
    // gia' visibile prima ancora del primo salvataggio.
    const { data: prev } = await supabase
      .from('cassa_chiusure')
      .select('fondo_cassa_finale')
      .eq('restaurant_id', restaurantId)
      .lt('data', date)
      .order('data', { ascending: false })
      .limit(1)
      .maybeSingle()

    setFields({ ...emptyFields(), fondoCassaIniziale: prev?.fondo_cassa_finale ?? 0 })
    setLoading(false)
  }, [restaurantId, date])

  useEffect(() => { loadChiusura() }, [loadChiusura])

  useEffect(() => {
    if (!restaurantId) { setOwnerId(null); return }
    const supabase = createClient()
    supabase.from('restaurants').select('owner_id').eq('id', restaurantId).single()
      .then(({ data }) => setOwnerId(data?.owner_id ?? null))
  }, [restaurantId])

  // Aggiorna in tempo reale i campi calcolati dal trigger (totale spese,
  // banca teorica, differenza) quando cambiano le spese collegate.
  useEffect(() => {
    if (!existing?.id) return
    const supabase = createClient()
    const channel = supabase
      .channel(`cassa_chiusura_${existing.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cassa_chiusure', filter: `id=eq.${existing.id}` },
        (payload) => setExisting(payload.new as CassaChiusura)
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [existing?.id])

  const totaleEntrate = fields.entrateContanti + fields.entratePos + fields.entrateBonifico
  const mediaScontrino = fields.coperti === 0
    ? null
    : (totaleEntrate - fields.incassoAsporto) / fields.coperti

  const fondoIniziale_editabile = fields.fondoCassaIniziale === 0
  const isConfermata = existing?.stato === 'confermata'

  async function handleAvanti() {
    if (!restaurantId || !date) return
    setSaving(true)
    const supabase = createClient()

    const basePayload = {
      restaurant_id: restaurantId,
      data: date,
      fondo_cassa_iniziale: fields.fondoCassaIniziale,
      entrate_contanti: fields.entrateContanti,
      entrate_pos: fields.entratePos,
      entrate_bonifico: fields.entrateBonifico,
      coperti: fields.coperti,
      incasso_asporto: fields.incassoAsporto,
      fondo_cassa_finale: fields.fondoCassaFinale,
      updated_by: userId,
    }
    const payload = existing
      ? basePayload
      : { ...basePayload, stato: 'in_verifica' as const, created_by: userId }

    const { data, error } = await supabase
      .from('cassa_chiusure')
      .upsert(payload, { onConflict: 'restaurant_id,data' })
      .select()
      .single()

    setSaving(false)
    if (error || !data) {
      alert(`Errore nel salvataggio: ${error?.message ?? 'sconosciuto'}`)
      return
    }
    setExisting(data)
    setFase(2)
  }

  const selectedRestaurantName = restaurants.find(r => r.id === restaurantId)?.name

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Chiusura Cassa</h1>
          <p className="text-muted-foreground text-sm mt-1">Fase {fase} di 3</p>
        </div>
        {existing && (
          <Badge variant={isConfermata ? 'default' : 'secondary'}>
            {isConfermata ? 'Confermata' : 'Bozza'}
          </Badge>
        )}
      </div>

      <Card className="mb-4">
        <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Ristorante</Label>
            {role === 'cassiere' ? (
              <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                {selectedRestaurantName ?? 'Nessun ristorante assegnato'}
              </div>
            ) : (
              <Select value={restaurantId} onValueChange={setRestaurantId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona un ristorante" />
                </SelectTrigger>
                <SelectContent>
                  {restaurants.map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Data</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {!restaurantId && (
        <p className="text-sm text-muted-foreground">Seleziona un ristorante per continuare.</p>
      )}

      {restaurantId && loading && (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      )}

      {restaurantId && !loading && fase === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Entrate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isConfermata && (
              <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md px-3 py-2">
                Questa chiusura è già stata confermata. La modifica sarà disponibile a breve.
              </p>
            )}

            <div className="space-y-1.5">
              <Label>Fondo Cassa Iniziale</Label>
              <CurrencyInput
                value={fields.fondoCassaIniziale}
                onChange={v => setFields(f => ({ ...f, fondoCassaIniziale: v }))}
                readOnly={!fondoIniziale_editabile || isConfermata}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Entrate Contanti</Label>
                <CurrencyInput
                  value={fields.entrateContanti}
                  onChange={v => setFields(f => ({ ...f, entrateContanti: v }))}
                  readOnly={isConfermata}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Entrate POS</Label>
                <CurrencyInput
                  value={fields.entratePos}
                  onChange={v => setFields(f => ({ ...f, entratePos: v }))}
                  readOnly={isConfermata}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Entrate Bonifico</Label>
                <CurrencyInput
                  value={fields.entrateBonifico}
                  onChange={v => setFields(f => ({ ...f, entrateBonifico: v }))}
                  readOnly={isConfermata}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Totale Entrate</Label>
              <CurrencyInput value={totaleEntrate} readOnly />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Coperti</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={fields.coperti}
                  onChange={e => setFields(f => ({ ...f, coperti: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                  disabled={isConfermata}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Incasso Asporto</Label>
                <CurrencyInput
                  value={fields.incassoAsporto}
                  onChange={v => setFields(f => ({ ...f, incassoAsporto: v }))}
                  readOnly={isConfermata}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Media Scontrino</Label>
              <CurrencyInput value={mediaScontrino} readOnly />
            </div>

            <div className="space-y-1.5">
              <Label>Fondo Cassa Finale</Label>
              <CurrencyInput
                value={fields.fondoCassaFinale}
                onChange={v => setFields(f => ({ ...f, fondoCassaFinale: v }))}
                readOnly={isConfermata}
              />
            </div>

            <div className="pt-2 flex justify-end">
              <Button onClick={handleAvanti} disabled={saving || isConfermata}>
                {saving ? 'Salvataggio…' : 'Avanti'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {restaurantId && !loading && fase === 2 && existing && ownerId && (
        <SpeseFase
          chiusura={existing}
          ownerId={ownerId}
          role={role}
          userId={userId}
          onBack={() => setFase(1)}
        />
      )}
    </div>
  )
}
