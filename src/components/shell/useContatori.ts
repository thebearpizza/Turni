'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useBadging } from '@/hooks/useBadging'
import type { Ruolo } from './navigazione'

// Contatori dei badge della navigazione (segmenti in alto e dock in
// basso): stesse query che prima stavano sparse nei vecchi menu laterali
// di ogni area, riunite qui perché il guscio è unico per ruolo e le
// mostra tutte insieme. Nel design: Assenze, Approvazioni, Fatture e ODS
// (nuovi completamenti per manager e direttore, notifiche non lette per
// dipendente e capo servizio).
// `localiManager`: per il manager, gli id dei locali visibili (gli attivi, o
// quello aperto in archivio). I numeri contano solo quelli: un locale
// nascosto non deve accendere badge su pagine che poi risultano vuote.
export function useContatori(ruolo: Ruolo, isPlatformOwner: boolean, localiManager: string[] | null = null): Record<string, number> {
  const pathname = usePathname()
  const [c, setC] = useState<Record<string, number>>({})
  const set = (k: string, v: number) => setC(prev => (prev[k] === v ? prev : { ...prev, [k]: v }))

  const chiaveLocali = localiManager ? localiManager.join(',') : null
  const vedeAssenze = ruolo === 'manager' || ruolo === 'direttore'
  const vedeModifiche = ruolo === 'manager'
  const vedeFatture = ruolo === 'manager' || ruolo === 'direttore'
  const vedeNotificheOds = ruolo === 'dipendente' || ruolo === 'capo_servizio'
  const vedeBacheca = ruolo === 'capo_servizio'
  const vedeCompletamentiOds = ruolo === 'manager' || ruolo === 'direttore'

  useEffect(() => {
    const supabase = createClient()
    const canali: ReturnType<typeof supabase.channel>[] = []
    const uid = Math.random().toString(36).slice(2)
    // null = nessun filtro (ruoli legati a un locale: ci pensa RLS).
    const ids = chiaveLocali === null ? null : chiaveLocali ? chiaveLocali.split(',') : ['00000000-0000-0000-0000-000000000000']

    if (vedeAssenze) {
      const f = async () => {
        let q = supabase.from('absences').select('id', { count: 'exact', head: true }).eq('status', 'pending')
        if (ids) q = q.in('restaurant_id', ids)
        const { count } = await q
        set('assenze', count ?? 0)
      }
      f()
      canali.push(supabase.channel(`shell_assenze_${uid}`).on('postgres_changes', { event: '*', schema: 'public', table: 'absences' }, f).subscribe())
    }
    if (vedeModifiche) {
      const f = async () => {
        const { count } = ids
          ? await supabase.from('cassa_chiusure_modifiche').select('id, cassa_chiusure!inner(restaurant_id)', { count: 'exact', head: true }).eq('stato', 'in_attesa').in('cassa_chiusure.restaurant_id', ids)
          : await supabase.from('cassa_chiusure_modifiche').select('id', { count: 'exact', head: true }).eq('stato', 'in_attesa')
        set('modifiche', count ?? 0)
      }
      f()
      canali.push(supabase.channel(`shell_modifiche_${uid}`).on('postgres_changes', { event: '*', schema: 'public', table: 'cassa_chiusure_modifiche' }, f).subscribe())
    }
    if (vedeFatture) {
      const oggi = new Date()
      const anno = oggi.getFullYear(), mese = oggi.getMonth() + 1
      const inizio = `${anno}-${String(mese).padStart(2, '0')}-01`
      const fine = `${anno}-${String(mese).padStart(2, '0')}-${String(new Date(anno, mese, 0).getDate()).padStart(2, '0')}`
      const f = async () => {
        if (ids) {
          // Stesso conteggio della RPC (fatture con verifiche aperte), sui soli locali visibili.
          const { count } = await supabase.from('fatture').select('id', { count: 'exact', head: true }).neq('verifiche_sospette', '[]').in('restaurant_id', ids)
          set('fatture', count ?? 0)
          return
        }
        const { data } = await supabase.rpc('hub_indicatori_acquisti', { p_mese_inizio: inizio, p_mese_fine: fine }).single()
        set('fatture', Number((data as { fatture_da_verificare?: number } | null)?.fatture_da_verificare ?? 0))
      }
      f()
      canali.push(supabase.channel(`shell_fatture_${uid}`).on('postgres_changes', { event: '*', schema: 'public', table: 'fatture' }, f).subscribe())
    }
    if (vedeNotificheOds) {
      const f = async () => {
        const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
        set('ods', count ?? 0)
      }
      f()
      canali.push(supabase.channel(`shell_ods_${uid}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, f).subscribe())
    }
    if (vedeCompletamentiOds) {
      // "1 nuovo completamento": ODS completati dopo l'ultima visita alla
      // pagina ODS (segnaposto in localStorage, come la Bacheca). Alla
      // prima apertura contano quelli di oggi.
      const f = async () => {
        let visti = ''
        try { visti = localStorage.getItem('ods_completamenti_visti') ?? '' } catch {}
        if (!visti) { const d = new Date(); d.setHours(0, 0, 0, 0); visti = d.toISOString() }
        const { count } = ids
          ? await supabase.from('ods_completions').select('task_id, ods_tasks!inner(restaurant_id)', { count: 'exact', head: true }).gt('completed_at', visti).in('ods_tasks.restaurant_id', ids)
          : await supabase.from('ods_completions').select('task_id', { count: 'exact', head: true }).gt('completed_at', visti)
        set('ods', count ?? 0)
      }
      f()
      canali.push(supabase.channel(`shell_ods_compl_${uid}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ods_completions' }, f).subscribe())
    }
    if (isPlatformOwner) {
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'manager').eq('account_status', 'pending')
        .then(({ count }) => set('account', count ?? 0))
    }
    return () => { canali.forEach(ch => supabase.removeChannel(ch)) }
  }, [vedeAssenze, vedeModifiche, vedeFatture, vedeNotificheOds, vedeCompletamentiOds, isPlatformOwner, chiaveLocali])

  // Comunicati non letti (capo servizio): watermark in localStorage
  // aggiornato alla visita della Bacheca, come prima.
  useEffect(() => {
    if (!vedeBacheca) return
    if (pathname === '/bacheca') {
      try { localStorage.setItem('bulletins_last_seen', new Date().toISOString()) } catch {}
      const t = setTimeout(() => set('bacheca', 0), 0)
      return () => clearTimeout(t)
    }
    let lastSeen = '1970-01-01T00:00:00Z'
    try { lastSeen = localStorage.getItem('bulletins_last_seen') ?? lastSeen } catch {}
    createClient().from('bulletins').select('id', { count: 'exact', head: true }).gt('created_at', lastSeen)
      .then(({ count }) => set('bacheca', count ?? 0))
  }, [vedeBacheca, pathname])

  // Visitando la pagina ODS i completamenti si considerano visti.
  useEffect(() => {
    if (!vedeCompletamentiOds || pathname !== '/ods') return
    try { localStorage.setItem('ods_completamenti_visti', new Date().toISOString()) } catch {}
    const t = setTimeout(() => set('ods', 0), 0)
    return () => clearTimeout(t)
  }, [vedeCompletamentiOds, pathname])

  useBadging(vedeNotificheOds ? (c.ods ?? 0) : 0)
  return c
}
