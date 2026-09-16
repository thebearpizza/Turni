'use client'
import { useEffect } from 'react'

// I componenti Radix (Dialog, Select, Popover, DropdownMenu) montano il
// loro contenuto in un portale su <body>, fuori dal sottoalbero a cui è
// applicata la classe di tema (.cassa/.acquisti su un div del layout) —
// quindi ereditano il blu di default invece del colore dell'area.
// Stesso problema che next-themes risolve per chiaro/scuro applicando
// la classe su <html> invece che a metà albero: qui si fa lo stesso,
// sincronizzando via effetto invece che via server (l'area dipende dalla
// rotta, non nota lato server in questo punto) — i portali restano
// comunque discendenti di <html>, quindi ereditano la classe.
export function AreaTheme({ classes }: { classes: string }) {
  useEffect(() => {
    const list = classes.split(' ').filter(Boolean)
    document.documentElement.classList.add(...list)
    return () => { document.documentElement.classList.remove(...list) }
  }, [classes])
  return null
}
