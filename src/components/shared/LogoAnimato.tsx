/* eslint-disable @next/next/no-img-element -- SVG statici a strati animati via CSS, next/image non serve */

// Logo con gli anelli che girano di continuo, in versi opposti come nello
// splash ma più lenti (non deve distrarre mentre si lavora). Stessi strati
// SVG dello splash (scripts/genera-logo.py), animati via CSS: rotazione
// fuori dal thread principale, nessun costo sul resto della pagina.
export function LogoAnimato({ size, className = '' }: { size: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label="inTurno"
      className={`relative inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <img src="/logo-animato-fondo.svg" alt="" className="splash-strato" />
      <img src="/logo-animato-interno.svg" alt="" className="splash-strato logo-giro-inverso" />
      <img src="/logo-animato-lettere.svg" alt="" className="splash-strato" />
      <img src="/logo-animato-esterno.svg" alt="" className="splash-strato logo-giro" />
      <img src="/logo-animato-riflessi.svg" alt="" className="splash-strato" />
    </span>
  )
}
