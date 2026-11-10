import { FornitoriClient } from '@/components/acquisti/FornitoriClient'
import { contestoAcquisti } from '../_lib/contesto'

// Anagrafica e unione dei fornitori solo per il manager; il direttore li consulta.
export default async function FornitoriPage() {
  const { ruolo, restaurants } = await contestoAcquisti()
  return <FornitoriClient restaurants={restaurants} canEdit={ruolo === 'manager'} single={ruolo === 'direttore' || restaurants.length <= 1} />
}
