import { Resend } from 'resend'

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'flavianoconiglio94@gmail.com'
const APP_NAME    = 'inTurno'
const FROM_EMAIL  = process.env.RESEND_FROM_EMAIL ?? `noreply@inturno.app`

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!resend) {
    console.warn('[email] RESEND_API_KEY non configurato — email non inviata:', subject)
    return
  }
  try {
    await resend.emails.send({ from: `${APP_NAME} <${FROM_EMAIL}>`, to, subject, html })
  } catch (err) {
    console.error('[email] Errore invio:', err)
  }
}

export async function sendNewRegistrationAlert(opts: {
  fullName: string
  email:    string
  approveUrl: string
}): Promise<void> {
  await sendEmail(
    ADMIN_EMAIL,
    `[${APP_NAME}] Nuova richiesta di accesso — ${opts.fullName}`,
    `
    <h2>Nuova richiesta di accesso</h2>
    <p><strong>${opts.fullName}</strong> (${opts.email}) ha richiesto l'accesso a ${APP_NAME}.</p>
    <p>
      <a href="${opts.approveUrl}" style="display:inline-block;padding:10px 20px;background:#000;color:#fff;border-radius:6px;text-decoration:none;">
        Approva account
      </a>
    </p>
    <p style="color:#888;font-size:12px;">Puoi anche approvarlo dalla pagina Account Pendenti nell'app.</p>
    `,
  )
}

export async function sendAccountActivatedEmail(opts: {
  fullName: string
  email:    string
  loginUrl: string
}): Promise<void> {
  await sendEmail(
    opts.email,
    `Il tuo account ${APP_NAME} è stato attivato!`,
    `
    <h2>Benvenuto su ${APP_NAME}, ${opts.fullName}!</h2>
    <p>Il tuo account è stato approvato. Puoi accedere subito con la tua email e password.</p>
    <p>
      <a href="${opts.loginUrl}" style="display:inline-block;padding:10px 20px;background:#000;color:#fff;border-radius:6px;text-decoration:none;">
        Accedi ora
      </a>
    </p>
    `,
  )
}
