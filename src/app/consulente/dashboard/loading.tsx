// Caricamento del Report del consulente con la sua sagoma: segmenti
// Report/Messaggi, barra del mese e foglio (stesso linguaggio di MTReport).
const ONDA = 'bg-[linear-gradient(90deg,var(--sk-a)_25%,var(--sk-b)_50%,var(--sk-a)_75%)] bg-[length:200%_100%] [animation:sk-sh_1.4s_linear_infinite]'

export default function Loading() {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <div className={`mx-4 mb-2.5 h-[50px] flex-none rounded-[14px] sm:mx-auto sm:w-[480px] ${ONDA}`} />
      <div className="box-border flex min-h-0 flex-1 flex-col gap-3 px-4 sm:px-8">
        <div className="flex flex-none items-center gap-2.5">
          <div className={`h-10 w-10 rounded-full ${ONDA}`} />
          <div className={`h-3.5 w-[132px] rounded-[6px] ${ONDA}`} />
          <div className={`h-10 w-10 rounded-full ${ONDA}`} />
          <span className="flex-1" />
          <div className={`h-10 w-[96px] rounded-[8px] ${ONDA}`} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-border bg-card">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="flex h-12 flex-none items-center gap-4 border-b border-border px-3.5">
              <div className={`h-3 w-[140px] rounded-[5px] ${ONDA}`} />
              <div className={`h-6 flex-1 rounded-[5px] opacity-60 ${ONDA}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
