"""Genera il logo inTurno (statico + strati dell'animazione) da un'unica
geometria, così statico e animato restano sempre identici.

Uso: python3 scripts/genera-logo.py  (scrive in public/ e src/app/icon.svg)

Strati dell'animazione (sovrapposti nello splash, vedi SplashApertura.tsx,
animati via CSS in globals.css):
- fondo: tessera e quadrante — fermo;
- lettere: la "it" — emerge all'ingresso;
- interno / esterno: i due anelli (l'esterno con la lancetta) — ruotano in
  versi opposti attorno al centro (40,40); per questo la loro ombreggiatura
  è radiale (invariante alla rotazione): la luce non deve girare con loro;
- riflessi: il vetro e il riflesso di luce sugli anelli — fermo sopra.
"""
from math import cos, sin, radians, pi

C = 40.0
R_EST, L_EST = 30.6, 3.6          # anello esterno: raggio e larghezza
R_INT, L_INT = 24.2, 2.0          # anello interno
ANG_LANCETTA = -50.0              # direzione della lancetta (gradi, y in basso)
VARCO_EST = 13.0                  # ampiezza del varco dell'anello esterno
VARCO_INT = 22.0                  # varco dell'anello interno, dove passa la lancetta
R_PUNTA_BASE, R_PUNTA = 19.2, 15.6


def p(r, a):
    return C + r * cos(radians(a)), C + r * sin(radians(a))


def f(v):
    return f'{v:.3f}'.rstrip('0').rstrip('.')


def arco(r, a0, a1):
    """Arco in senso orario (y in basso) da a0 ad a1 > a0."""
    x0, y0 = p(r, a0)
    x1, y1 = p(r, a1)
    grande = 1 if (a1 - a0) % 360 > 180 else 0
    return f'M{f(x0)} {f(y0)}A{f(r)} {f(r)} 0 {grande} 1 {f(x1)} {f(y1)}'


def stop(o, c, op=None):
    extra = f' stop-opacity="{op}"' if op is not None else ''
    return f'<stop offset="{o}" stop-color="{c}"{extra}/>'


# L'anello esterno parte subito dopo il varco, fa il giro e alla lancetta
# piega verso il centro con un raccordo curvo della stessa larghezza: un
# unico nastro uniforme, senza assottigliamenti né "tappi" all'attacco.
from math import asin, degrees
R_RACCORDO = 2.9
d_o = R_EST - R_RACCORDO
beta = degrees(asin(R_RACCORDO / d_o))
ang_o = ANG_LANCETTA - beta                     # dove l'anello lascia il cerchio
ox, oy = p(d_o, ang_o)                          # centro del raccordo
t1x, t1y = p(R_EST, ang_o)
dist_t2 = d_o * cos(radians(beta))
t2x, t2y = p(dist_t2, ANG_LANCETTA)

a_inizio = ANG_LANCETTA + VARCO_EST
anello_est = arco(R_EST, a_inizio, ang_o + 360 + 0.3)
raccordo = f'M{f(t1x)} {f(t1y)}A{f(R_RACCORDO)} {f(R_RACCORDO)} 0 0 1 {f(t2x)} {f(t2y)}'
anello_int = arco(R_INT, ANG_LANCETTA + VARCO_INT / 2, ANG_LANCETTA + 360 - VARCO_INT / 2)

ux, uy = cos(radians(ANG_LANCETTA)), sin(radians(ANG_LANCETTA))   # verso l'esterno
nx, ny = -uy, ux                                                  # trasversale
h = L_EST / 2
xa, ya = p(dist_t2 + 0.15, ANG_LANCETTA)       # lieve sovrapposizione col raccordo
xb, yb = p(R_PUNTA_BASE, ANG_LANCETTA)
xt, yt = p(R_PUNTA, ANG_LANCETTA)
lancetta = (
    f'M{f(xa + nx*h)} {f(ya + ny*h)}'
    f'L{f(xa - nx*h)} {f(ya - ny*h)}'
    f'L{f(xb - nx*h)} {f(yb - ny*h)}'
    f'L{f(xt - nx*h*0.3)} {f(yt - ny*h*0.3)}'
    f'Q{f(xt - ux*0.6)} {f(yt - uy*0.6)} {f(xt + nx*h*0.3)} {f(yt + ny*h*0.3)}'
    f'L{f(xb + nx*h)} {f(yb + ny*h)}Z'
)
lg_x0, lg_y0 = xa - nx*h, ya - ny*h
lg_x1, lg_y1 = xa + nx*h, ya + ny*h


PROFILO = [(0, '#4a4c50'), (.22, '#a9abaf'), (.5, '#f4f4f5'), (.78, '#a9abaf'), (1, '#4a4c50')]


def radiale_tubo(id_, cx, cy, r, larghezza):
    """Ombreggiatura a "tubo" metallico lungo la sezione di un arco."""
    esterno = r + larghezza / 2
    interno = r - larghezza / 2
    return (f'<radialGradient id="{id_}" cx="{f(cx)}" cy="{f(cy)}" r="{f(esterno)}" gradientUnits="userSpaceOnUse">'
            + stop(0, PROFILO[0][1])
            + ''.join(stop(f'{(interno + o*larghezza)/esterno:.4f}', c) for o, c in PROFILO)
            + '</radialGradient>')


DEFS = f'''<defs>
<linearGradient id="tessera" x1="40" y1="0" x2="40" y2="80" gradientUnits="userSpaceOnUse">{stop(0,'#35373a')}{stop(.5,'#1d1f20')}{stop(1,'#0c0d0e')}</linearGradient>
<linearGradient id="tesseraBordo" x1="40" y1="0" x2="40" y2="80" gradientUnits="userSpaceOnUse">{stop(0,'#8a8c90')}{stop(.5,'#3a3c3e')}{stop(1,'#1a1b1c')}</linearGradient>
<linearGradient id="ghiera" x1="22" y1="6" x2="58" y2="76" gradientUnits="userSpaceOnUse">{stop(0,'#d4d5d7')}{stop(.35,'#6a6c70')}{stop(.7,'#2e3032')}{stop(1,'#18191a')}</linearGradient>
<radialGradient id="quadrante" cx="36" cy="30" r="44" gradientUnits="userSpaceOnUse">{stop(0,'#4a4c50')}{stop(.55,'#2a2c2f')}{stop(1,'#121314')}</radialGradient>
<radialGradient id="conca" cx="40" cy="40" r="35" gradientUnits="userSpaceOnUse">{stop(.8,'#000',0)}{stop(1,'#000',.55)}</radialGradient>
<linearGradient id="metallo" x1="0" y1="21" x2="0" y2="60" gradientUnits="userSpaceOnUse">{stop(0,'#fbfbfb')}{stop(.45,'#d2d3d5')}{stop(.55,'#a4a6a9')}{stop(1,'#d8d9db')}</linearGradient>
<linearGradient id="solco" x1="0" y1="21" x2="0" y2="60" gradientUnits="userSpaceOnUse">{stop(0,'#7c7e82')}{stop(1,'#5c5e62')}</linearGradient>
{radiale_tubo('tuboEst', C, C, R_EST, L_EST)}
{radiale_tubo('tuboRaccordo', ox, oy, R_RACCORDO, L_EST)}
{radiale_tubo('tuboInt', C, C, R_INT, L_INT)}
<linearGradient id="lancettaLuce" x1="{f(lg_x0)}" y1="{f(lg_y0)}" x2="{f(lg_x1)}" y2="{f(lg_y1)}" gradientUnits="userSpaceOnUse">{''.join(stop(o, c) for o, c in PROFILO)}</linearGradient>
<linearGradient id="vetro" x1="20" y1="8" x2="46" y2="50" gradientUnits="userSpaceOnUse">{stop(0,'#fff',.2)}{stop(1,'#fff',0)}</linearGradient>
</defs>'''

# Niente filtri SVG (sfocature, luci): Safari su iPhone li calcola a bassa
# risoluzione e il logo risulta sgranato, specie piccolo o in rotazione.
# Ombre e rilievi sono fatti con copie della forma a opacità scalare, che
# restano nitide a ogni dimensione.
SFUMATURA = [(1.8, 0.07), (1.1, 0.12), (0.5, 0.2), (0, 0.3)]   # allargamento, opacità


def ombra_tratto(d, larghezza, dx=0, dy=0, cap='round', intensita=1.0):
    """Ombra morbida di un tratto: più tratti via via più larghi e tenui."""
    return ''.join(
        f'<path d="{d}" stroke="#000" stroke-opacity="{op*intensita:.3f}" stroke-width="{f(larghezza + extra)}" '
        f'stroke-linecap="{cap}" fill="none" transform="translate({dx} {dy})"/>'
        for extra, op in SFUMATURA)


# Ombra proiettata ferma (luce da in alto a sinistra) sotto gli anelli: sta
# nel fondo, quindi non ruota — gli anelli girano sopra un'ombra coerente.
cerchio = lambda r: f'M{f(C - r)} {C}a{f(r)} {f(r)} 0 1 0 {f(2*r)} 0a{f(r)} {f(r)} 0 1 0 {f(-2*r)} 0'
ombra_anelli_statica = (ombra_tratto(cerchio(R_EST), L_EST, 0.9, 1.3, intensita=1.4)
                        + ombra_tratto(cerchio(R_INT), L_INT, 0.9, 1.3, intensita=1.4))

# Lettere "it": stesso spessore per i e t, solco inciso al centro della t
# (l'eco delle doppie linee del disegno originale).
S = 4.8
T_ASTA = 'M43.4 22.8V48.2Q43.4 55.8 50.6 55.8H52.8'


def forme_lettere(colore, extra=0.0, dx=0.0, dy=0.0, opacita=1.0):
    """La "it" in un solo colore, allargata di extra (per ombre e bordi)."""
    e = extra / 2
    return (f'<g transform="translate({f(dx)} {f(dy)})" opacity="{opacita:.3f}">'
            f'<rect x="{f(32 - S/2 - e)}" y="{f(32.3 - e)}" width="{f(S + extra)}" height="{f(26 + extra)}" rx="{f(0.5 + e)}" fill="{colore}"/>'
            f'<circle cx="32" cy="25.9" r="{f(3.1 + e)}" fill="{colore}"/>'
            f'<path d="{T_ASTA}" stroke="{colore}" stroke-width="{f(S + extra)}" fill="none"/>'
            f'<rect x="{f(36.2 - e)}" y="{f(32.3 - e)}" width="{f(16.4 + extra)}" height="{f(4.2 + extra)}" rx="{f(0.4 + e)}" fill="{colore}"/>'
            '</g>')


lettere = (''.join(forme_lettere('#000', extra, 0.9, 1.4, op * 2.2) for extra, op in SFUMATURA)
           # rilievo: bordo chiaro in alto a sinistra, scuro in basso a destra
           + forme_lettere('#ffffff', 0, -0.28, -0.28, 0.75)
           + forme_lettere('#3a3c40', 0, 0.28, 0.28, 1)
           + forme_lettere('url(#metallo)')
           + '<path d="M43.4 24.2V48.2Q43.4 54.4 50.6 54.4H52" stroke="url(#solco)" stroke-width="0.45" fill="none" stroke-linecap="round" opacity="0.8"/>'
           + '<path d="M43.75 24.2V48.2Q43.75 54 50.6 54" stroke="#fff" stroke-width="0.25" fill="none" opacity="0.5"/>')

fondo_base = f'''<rect x="0.25" y="0.25" width="79.5" height="79.5" rx="13" fill="url(#tessera)" stroke="url(#tesseraBordo)" stroke-width="0.5"/>
<circle cx="{C}" cy="{C}" r="37.4" fill="url(#ghiera)"/>
<circle cx="{C}" cy="{C}" r="35.3" fill="url(#quadrante)" stroke="#0a0a0b" stroke-opacity="0.6" stroke-width="0.4"/>
<circle cx="{C}" cy="{C}" r="35.3" fill="url(#conca)"/>
{ombra_anelli_statica}'''
fondo = fondo_base + lettere

interno = f'''<g>{ombra_tratto(anello_int, L_INT)}
<path d="{anello_int}" stroke="url(#tuboInt)" stroke-width="{L_INT}" stroke-linecap="round" fill="none"/>
</g>'''
esterno = f'''<g>{ombra_tratto(anello_est, L_EST)}{ombra_tratto(raccordo, L_EST, cap="butt")}{ombra_tratto(f"M{f(xa)} {f(ya)}L{f(xt)} {f(yt)}", L_EST * 0.8)}
<path d="{anello_est}" stroke="url(#tuboEst)" stroke-width="{L_EST}" stroke-linecap="round" fill="none"/>
<path d="{raccordo}" stroke="url(#tuboRaccordo)" stroke-width="{L_EST}" fill="none"/>
<path d="{lancetta}" fill="url(#lancettaLuce)"/>
</g>'''
anello = interno + esterno

# Riflessi fermi: luce sugli anelli in alto a sinistra e vetro sul quadrante.
riflessi = f'''<g stroke="#fff" stroke-linecap="round" fill="none">
<path d="{arco(R_EST - 0.5, 195, 250)}" stroke-width="1.6" stroke-opacity="0.12"/>
<path d="{arco(R_EST - 0.5, 200, 245)}" stroke-width="0.7" stroke-opacity="0.45"/>
<path d="{arco(R_INT - 0.2, 200, 245)}" stroke-width="0.9" stroke-opacity="0.12"/>
<path d="{arco(R_INT - 0.2, 205, 240)}" stroke-width="0.35" stroke-opacity="0.45"/>
</g>
<path d="M8.6 34A31.6 31.6 0 0 1 60 11.6Q34 16 8.6 34Z" fill="url(#vetro)"/>
<circle cx="{C}" cy="{C}" r="37.2" stroke="#fff" stroke-opacity="0.18" stroke-width="0.3" fill="none"/>'''


def svg(corpo):
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" fill="none" viewBox="0 0 80 80">\n'
            f'{DEFS}\n{corpo}\n</svg>\n')


for nome, corpo in [('public/logo.svg', fondo + anello + riflessi),
                    ('src/app/icon.svg', fondo + anello + riflessi),
                    ('public/logo-animato-fondo.svg', fondo_base),
                    ('public/logo-animato-lettere.svg', lettere),
                    ('public/logo-animato-interno.svg', interno),
                    ('public/logo-animato-esterno.svg', esterno),
                    ('public/logo-animato-riflessi.svg', riflessi)]:
    open(nome, 'w').write(svg(corpo))
    print('scritto', nome)
