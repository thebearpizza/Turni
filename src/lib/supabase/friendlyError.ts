// Sui tablet di cassa/manager la sessione resta aperta per settimane — se il
// rinnovo automatico del token salta (tab in background per ore, dispositivo
// sospeso), le scritture cominciano a fallire con un errore RLS/JWT che per
// chi usa l'app è incomprensibile ("row-level security policy for table…").
// Qui lo riconosciamo e lo traduciamo in un'istruzione azionabile.
function isSessionExpiredError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42501' || error.code === 'PGRST301') return true
  return /row-level security|jwt expired/i.test(error.message ?? '')
}

export function friendlySaveError(error: { message?: string; code?: string } | null | undefined): string {
  if (isSessionExpiredError(error)) {
    return 'Sessione scaduta: ricarica la pagina e accedi di nuovo.'
  }
  return `Errore nel salvataggio: ${error?.message ?? 'sconosciuto'}`
}
