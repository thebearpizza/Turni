import { InventarioClient } from '@/components/acquisti/InventarioClient'
import { contestoAcquisti } from '../_lib/contesto'

export default async function InventarioPage() {
  const { ruolo, restaurants } = await contestoAcquisti()
  return <InventarioClient restaurants={restaurants} single={ruolo === 'direttore' || restaurants.length <= 1} />
}
