// La radice fa solo un controllo di accesso e reindirizza alla Home del
// ruolo: all'apertura c'è lo splash del logo, nei passaggi successivi
// basta il fondo della pagina (niente segnaposto generici, il design
// mostra lo scheletro solo a forma del contenuto vero).
export default function Loading() {
  return <div className="h-[100dvh] bg-background" />
}
