import { PageSkeleton } from '@/components/manager/PageSkeleton'
// Senza un caricamento a livello di sezione, Fornitori e Inventario
// restavano fermi sulla pagina di prima finché il server non rispondeva.
export default function Loading() { return <PageSkeleton /> }
