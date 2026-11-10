'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { AssistenteChat } from '@/components/home/AssistenteChat'
import { useFoglio } from '@/components/home/Foglio'

// Rotta dell'assistente (/hub/assistente): ci arriva la scintilla
// dell'intestazione dalle pagine che non aprono il pannello da sole, e i
// link con la domanda già pronta (?q=...). Mostra lo stesso pannello della
// Home; alla chiusura torna alla pagina di prima (o alla Home).
export function HubAssistenteChat({ nome, home }: { nome: string; home: string }) {
  const router = useRouter()
  const domanda = useSearchParams().get('q')
  const pannello = useFoglio<true>(true)

  function chiudi() {
    pannello.chiudi()
    setTimeout(() => { if (window.history.length > 1) router.back(); else router.push(home) }, 320)
  }

  if (!pannello.valore) return null
  return <AssistenteChat nome={nome} uscita={pannello.uscita} onChiudi={chiudi} domandaIniziale={domanda} />
}
