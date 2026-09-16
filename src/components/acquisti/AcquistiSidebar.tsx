'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Boxes, FileText, Package, Truck } from 'lucide-react'
import { DockNav, type DockNavItem, type DockNavAreaLink } from '@/components/nav/DockNav'

// "Home" non è una voce: DockNav la gestisce a parte. Quattro voci in
// quest'area — esattamente le prime NDOCK di DockNav, quindi la barra
// fissa le mostra tutte senza bisogno del foglio estraibile.
const ITEMS = [
  { key: 'fatture',    href: '/acquisti/fatture',    icon: FileText, label: 'Fatture' },
  { key: 'articoli',   href: '/acquisti/articoli',   icon: Package,  label: 'Articoli' },
  { key: 'inventario', href: '/acquisti/inventario', icon: Boxes,    label: 'Inventario' },
  { key: 'fornitori',  href: '/acquisti/fornitori',  icon: Truck,    label: 'Fornitori' },
] as const

const AREA_LINKS_MANAGER: DockNavAreaLink[] = [
  { key: 'turni', label: 'Turni', href: '/dashboard' },
  { key: 'cassa', label: 'Cassa', href: '/cassa' },
  { key: 'acquisti', label: 'Acquisti', href: '/acquisti/fatture' },
]
const AREA_LINKS_DIRETTORE: DockNavAreaLink[] = [
  { key: 'turni', label: 'Turni', href: '/dashboard' },
  { key: 'acquisti', label: 'Acquisti', href: '/acquisti/fatture' },
]

interface Props {
  role: 'manager' | 'direttore'
  userId: string
}

export function AcquistiSidebar({ role, userId }: Props) {
  const router = useRouter()
  const [daVerificare, setDaVerificare] = useState(0)

  // Fatture con dati sospetti non ancora confermati — stessa definizione
  // dell'indicatore "Da verificare" della card Acquisti in Home
  // (hub_indicatori_acquisti): jsonb_array_length(verifiche_sospette) > 0,
  // su tutte le fatture nell'ambito di chi chiama (RLS), non solo il mese.
  useEffect(() => {
    const supabase = createClient()
    const oggi = new Date()
    const anno = oggi.getFullYear(), mese = oggi.getMonth() + 1
    const meseInizio = `${anno}-${String(mese).padStart(2, '0')}-01`
    const meseFine = `${anno}-${String(mese).padStart(2, '0')}-${String(new Date(anno, mese, 0).getDate()).padStart(2, '0')}`
    async function fetchCount() {
      const { data } = await supabase
        .rpc('hub_indicatori_acquisti', { p_mese_inizio: meseInizio, p_mese_fine: meseFine })
        .single()
      const row = data as { fatture_da_verificare?: number } | null
      setDaVerificare(Number(row?.fatture_da_verificare ?? 0))
    }
    fetchCount()
    const channel = supabase
      .channel('dock_fatture_da_verificare')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fatture' }, fetchCount)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const items: DockNavItem[] = ITEMS.map(item => ({
    ...item,
    badge: item.key === 'fatture' ? daVerificare : undefined,
  }))

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <DockNav
      area="acquisti"
      items={items}
      userId={userId}
      homeHref="/hub"
      areaLinks={role === 'manager' ? AREA_LINKS_MANAGER : AREA_LINKS_DIRETTORE}
      onLogout={handleLogout}
    />
  )
}
