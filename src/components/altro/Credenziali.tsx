'use client'
import { useSyncExternalStore } from 'react'
import { toast } from '@/hooks/use-toast'
import { FoglioAltro, Badge, ICONA_COPIA, ICONA_RIGENERA, ICONA_CONDIVIDI, copia } from './comuni'

// Foglio delle credenziali (MTAltro, "cr"): dopo la creazione di un account
// o il reset della password mostra username e password da comunicare, con
// copia, condividi e — prima di confermare un reset — rigenera.

export interface StatoCredenziali {
  nome: string
  user: string
  pw: string
  modo: 'nuovo' | 'reset'
  /** Reset ancora da confermare con "Imposta password". */
  chiede: boolean
}

export async function copiaConAvviso(testo: string, messaggio: string) {
  if (await copia(testo)) toast({ title: messaggio })
  else toast({ title: 'Copia non riuscita', variant: 'destructive' })
}

const puoCondividere = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function'

export function FoglioCredenziali({ cr, esce, onChiudi, onRigenera, onImposta, occupato }: {
  cr: StatoCredenziali | null; esce: boolean; onChiudi: () => void
  onRigenera: () => void; onImposta: () => void; occupato?: boolean
}) {
  const condividi = useSyncExternalStore(() => () => {}, puoCondividere, () => false)
  const primo = cr?.nome.split(' ')[0] ?? ''
  const testo = cr ? `inTurno · accesso di ${cr.nome}\nUsername: ${cr.user}\nPassword: ${cr.pw}` : ''
  const tag = cr?.modo === 'reset' ? (cr.chiede ? 'Reset' : 'Aggiornata') : 'Nuovo account'
  const nota = cr?.chiede
    ? 'La password attuale smette di funzionare quando tocchi Imposta. Puoi rigenerarla quante volte vuoi prima di confermare.'
    : `Comunicale a ${primo}. Se le dimentica, da Dipendenti tocca Reimposta password e gliene generi una nuova.`
  const tasto = 'flex h-11 w-11 flex-none items-center justify-center rounded-[8px] text-[oklch(0.35_0.01_250)] active:scale-[0.94] dark:text-[oklch(0.8_0.01_250)]'

  return (
    <FoglioAltro aperto={!!cr} esce={esce} onChiudi={onChiudi} larghezza={480} altoTablet={180} z={75}
      testata={
        <div className="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-[22px]">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-xl font-semibold">Credenziali di {primo}</span>
            <span className="text-sm text-muted-foreground">{cr?.nome}</span>
          </div>
          <Badge tono={cr?.chiede ? 'warn' : 'ok'}>{tag}</Badge>
        </div>
      }>
      {cr && (
        <div className="flex flex-col gap-3.5 px-4 py-4 sm:px-[22px]">
          <div className="flex flex-col rounded-[12px] border border-[oklch(0.92_0.01_250)] bg-background dark:border-border">
            <div className="flex items-center gap-2 py-2.5 pl-4 pr-1.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-xs font-medium text-muted-foreground">Username</span>
                <span className="truncate font-mono text-lg font-medium">{cr.user}</span>
              </div>
              <button type="button" aria-label="Copia username" onClick={() => copiaConAvviso(cr.user, 'Username copiato')} className={tasto}>{ICONA_COPIA}</button>
            </div>
            <div className="mx-4 h-px bg-[oklch(0.92_0.01_250)] dark:bg-border" />
            <div className="flex items-center gap-0.5 py-2.5 pl-4 pr-1.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-xs font-medium text-muted-foreground">Password</span>
                <span key={cr.pw} className="anim-swapin font-mono text-2xl font-semibold tracking-[.08em]">{cr.pw}</span>
              </div>
              {cr.chiede && <button type="button" aria-label="Rigenera password" onClick={onRigenera} className={tasto}>{ICONA_RIGENERA}</button>}
              <button type="button" aria-label="Copia password" onClick={() => copiaConAvviso(cr.pw, 'Password copiata')} className={tasto}>{ICONA_COPIA}</button>
            </div>
          </div>
          <span className="text-[13px] leading-[1.45] text-muted-foreground text-pretty">{nota}</span>
          {cr.chiede ? (
            <div className="grid grid-cols-[1fr_2fr] gap-2.5">
              <button type="button" onClick={onChiudi} className="flex h-[52px] items-center justify-center rounded-[8px] border border-line-strong text-[15px] font-medium active:scale-[0.98]">Annulla</button>
              <button type="button" onClick={onImposta} disabled={occupato} style={{ opacity: occupato ? 0.4 : 1 }}
                className="flex h-[52px] items-center justify-center rounded-[8px] bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98]">Imposta password</button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              <button type="button"
                onClick={() => { if (condividi) navigator.share({ title: 'Accesso inTurno', text: testo }).catch(() => {}); else copiaConAvviso(testo, 'Credenziali copiate') }}
                className="flex h-[52px] items-center justify-center gap-2 rounded-[8px] border border-line-strong text-[15px] font-medium active:scale-[0.98]">
                {ICONA_CONDIVIDI}{condividi ? 'Condividi' : 'Copia tutto'}
              </button>
              <button type="button" onClick={onChiudi} className="flex h-[52px] items-center justify-center rounded-[8px] bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98]">Fatto</button>
            </div>
          )}
        </div>
      )}
    </FoglioAltro>
  )
}
