import { google } from '@ai-sdk/google'
import { generateText, tool, stepCountIs, type ModelMessage, type Tool } from 'ai'
import { z } from 'zod'
import { addDays } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { it } from 'date-fns/locale'
import type { Ctx } from './context'
import {
  isManager, isDirettore, isCapoServizio, canManagePresenze,
  assigneeInScope, scopeTurnsQuery, scopeStaffQuery, toScopeProfile,
} from './scope'
import { TZ, isValidTime, normalizeTime, formatDateLabel } from './format'
import { DEPARTMENTS, ODS_DAYS_IT, ODS_TYPE_LABELS, type OdsTaskType, type Department } from '@/types'
import { getAiHistory, saveAiHistory } from './aiHistory'

// ── Assistente AI (Gemini) — comandi e domande in linguaggio naturale ──
// Attivato per i messaggi liberi (non slash-command) quando non c'è una
// sessione wizard attiva. Usa tool-calling per leggere/scrivere sui dati
// nello stesso scope RBAC dei comandi classici.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
// Modello di riserva, usato automaticamente se quello principale esaurisce la quota gratuita.
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash-lite'

function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /429|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(message)
}

function todayStr(): string {
  return formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
}

function addDaysToDateStr(dateStr: string, days: number): string {
  return formatInTimeZone(addDays(new Date(`${dateStr}T12:00:00Z`), days), TZ, 'yyyy-MM-dd')
}

function dayBounds(dateStr: string): { start: string; end: string } {
  return {
    start: fromZonedTime(`${dateStr}T00:00:00`, TZ).toISOString(),
    end: fromZonedTime(`${dateStr}T23:59:59.999`, TZ).toISOString(),
  }
}

function getOdsCutoff(): string {
  const now = new Date()
  const romeHour = parseInt(formatInTimeZone(now, TZ, 'H'), 10)
  const refDate = romeHour < 4 ? new Date(now.getTime() - 86_400_000) : now
  const cutoffDate = formatInTimeZone(refDate, TZ, 'yyyy-MM-dd')
  return fromZonedTime(`${cutoffDate}T04:00:00`, TZ).toISOString()
}

function resolveDepartment(input: string): Department | null {
  const norm = input.trim().toLowerCase()
  return DEPARTMENTS.find(d => d.toLowerCase() === norm) ?? null
}

// ── Prompt di sistema ─────────────────────────────────────────────────

function buildSystemPrompt(ctx: Ctx): string {
  const { profile } = ctx
  const now = new Date()

  const calendarLines: string[] = []
  for (let i = 0; i < 14; i++) {
    const d = addDays(now, i)
    const dateStr = formatInTimeZone(d, TZ, 'yyyy-MM-dd')
    const label = formatInTimeZone(d, TZ, 'EEEE d MMMM', { locale: it })
    const tag = i === 0 ? ' (oggi)' : i === 1 ? ' (domani)' : ''
    calendarLines.push(`${dateStr} → ${label}${tag}`)
  }

  let scopeLabel: string
  if (isManager(profile)) {
    scopeLabel = 'Manager: accesso globale a tutti i ristoranti e reparti.'
  } else if (isDirettore(profile)) {
    scopeLabel = `Direttore del ristorante "${profile.restaurant?.name ?? ''}": accesso a tutti i reparti di questo ristorante.`
  } else {
    scopeLabel = `Capo Servizio del reparto "${profile.department}" nel ristorante "${profile.restaurant?.name ?? ''}": accesso solo a questo reparto.`
  }

  return `Sei l'assistente virtuale del bot Telegram di "Turni", un'app per la gestione di turni, ODS (ordini di servizio) e presenze in ristoranti italiani.

Stai parlando con ${profile.full_name}. ${scopeLabel}

Calendario di riferimento (usa SEMPRE il formato yyyy-MM-dd negli strumenti):
${calendarLines.join('\n')}

ISTRUZIONI:
- Rispondi sempre in italiano, con tono colloquiale, amichevole e professionale, come un collega disponibile. Usa il "tu".
- Sii conciso: messaggi brevi, vai dritto al punto.
- Puoi usare la formattazione Markdown di Telegram (*grassetto*, _corsivo_) e qualche emoji con moderazione (📅 turni, 📋 ODS, 🕐 presenze, ✅ ❌).
- Per qualsiasi azione che coinvolge un dipendente (turno, riposo, ODS, presenza), se non conosci il suo ID usa prima lo strumento cerca_dipendenti. Se ci sono più persone con nomi simili, chiedi all'utente di specificare a chi si riferisce: non scegliere a caso.
- Esegui un'azione (creare/eliminare/modificare) SOLO se la richiesta è chiara e contiene tutte le informazioni necessarie. Se manca qualcosa (data, orario, dipendente, reparto...), chiedi prima di procedere: non inventare dati.
- Dopo aver eseguito un'azione, confermala riassumendo cosa hai fatto.
- Per le domande sui dati (es. "chi lavora venerdì?", "quante presenze oggi?"), usa gli strumenti di lettura e rispondi in modo naturale, senza limitarti a riportare i dati grezzi.
- Se una richiesta non è di tua competenza, suggerisci i comandi /help, /turni, /ods, /presenze.
- Vedi gli ultimi messaggi della conversazione: usali per capire riferimenti a cose appena discusse (es. un dipendente già identificato, una data già menzionata, un'azione proposta poco prima). Se nei messaggi precedenti hai già trovato l'ID di un dipendente o di un turno, riusalo senza richiamare di nuovo lo strumento di ricerca, a meno che non sia passato troppo tempo o il contesto sia cambiato.
- IMPORTANTE: non annunciare mai a parole un'azione futura o "in corso" (es. "ora recupero i turni...", "procedo a cancellarli...", "Ok, elimino il turno...") come fosse la tua risposta finale. Se una frase descrive un'azione, quell'azione deve essere GIÀ stata eseguita con lo strumento corrispondente, nella stessa risposta e PRIMA di scrivere quella frase. Se devi ancora compiere un passo, chiamalo SUBITO (non limitarti a scriverlo a parole) e continua a concatenare le chiamate agli strumenti finché la richiesta dell'utente non è completamente conclusa. Esempio SBAGLIATO: rispondere solo "Ok, elimino il turno di sabato 20 giugno." senza aver chiamato elimina_turno. Esempio CORRETTO: chiamare lo strumento elimina_turno e poi rispondere "✅ Ho eliminato il turno di sabato 20 giugno."`
}

// ── Tool: ricerca dipendenti ─────────────────────────────────────────

function cercaDipendentiTool(ctx: Ctx) {
  return tool({
    description: 'Cerca dipendenti/capi servizio nel tuo ambito per nome. Usa questo strumento per trovare l\'ID di un dipendente prima di creare turni, riposi, ODS o presenze.',
    inputSchema: z.object({
      nome: z.string().optional().describe('Nome o parte del nome da cercare. Se omesso, restituisce tutti i dipendenti nel tuo ambito.'),
    }),
    execute: async ({ nome }) => {
      let query = ctx.admin
        .from('profiles')
        .select('id, full_name, department, restaurant_id, restaurant:restaurants(name)')
        .in('role', ['dipendente', 'capo_servizio'])
        .order('full_name')

      if (isDirettore(ctx.profile)) {
        query = query.eq('restaurant_id', ctx.profile.restaurant_id)
      } else if (isCapoServizio(ctx.profile)) {
        query = query.eq('restaurant_id', ctx.profile.restaurant_id).eq('department', ctx.profile.department)
      }

      if (nome?.trim()) query = query.ilike('full_name', `%${nome.trim()}%`)

      const { data, error } = await query
      if (error) return { error: error.message }

      return {
        dipendenti: (data ?? []).map((d: Record<string, unknown>) => ({
          id: d.id,
          nome: d.full_name,
          reparto: d.department,
          ristorante: (d.restaurant as { name: string } | null)?.name ?? null,
        })),
      }
    },
  })
}

// ── Tool: turni ───────────────────────────────────────────────────────

function listaTurniTool(ctx: Ctx) {
  return tool({
    description: 'Elenca i turni di lavoro in un intervallo di date (default: prossimi 7 giorni a partire da oggi), opzionalmente filtrati per dipendente. Restituisce anche l\'ID di ciascun turno, utile per eliminarlo in seguito.',
    inputSchema: z.object({
      data_inizio: z.string().optional().describe('Data iniziale yyyy-MM-dd (default: oggi)'),
      data_fine: z.string().optional().describe('Data finale yyyy-MM-dd (default: 6 giorni dopo data_inizio)'),
      dipendente_id: z.string().optional().describe('Filtra solo i turni di questo dipendente'),
    }),
    execute: async ({ data_inizio, data_fine, dipendente_id }) => {
      const start = data_inizio && DATE_RE.test(data_inizio) ? data_inizio : todayStr()
      const end = data_fine && DATE_RE.test(data_fine) ? data_fine : addDaysToDateStr(start, 6)

      let query = ctx.admin
        .from('turns')
        .select('id, date, start_time, end_time, is_extraordinary, is_rest_day, department, user_id, profile:profiles!user_id(full_name), restaurant:restaurants(name)')
        .gte('date', start)
        .lte('date', end)
        .order('date')
        .order('start_time')
        .limit(60)

      query = scopeTurnsQuery(query, toScopeProfile(ctx.profile), ctx.profile.id)
      if (dipendente_id) query = query.eq('user_id', dipendente_id)

      const { data, error } = await query
      if (error) return { error: error.message }

      const turni = (data ?? []).map((t: Record<string, unknown>) => ({
        id: t.id,
        data: t.date,
        giorno: formatDateLabel(t.date as string),
        dipendente: (t.profile as { full_name: string } | null)?.full_name ?? null,
        reparto: t.department,
        ristorante: (t.restaurant as { name: string } | null)?.name ?? null,
        riposo: t.is_rest_day,
        straordinario: t.is_extraordinary,
        orario: t.is_rest_day ? null : `${(t.start_time as string).slice(0, 5)}-${(t.end_time as string).slice(0, 5)}`,
      }))

      return { turni, totale: turni.length }
    },
  })
}

function creaTurnoTool(ctx: Ctx) {
  return tool({
    description: 'Crea un nuovo turno di lavoro per un dipendente in una data e fascia oraria specifiche.',
    inputSchema: z.object({
      dipendente_id: z.string().describe('ID del dipendente (ottenuto con cerca_dipendenti)'),
      data: z.string().describe('Data del turno, formato yyyy-MM-dd'),
      ora_inizio: z.string().describe('Orario di inizio, formato HH:MM (24h)'),
      ora_fine: z.string().describe('Orario di fine, formato HH:MM (24h)'),
      straordinario: z.boolean().optional().describe('true se è un turno straordinario'),
    }),
    execute: async ({ dipendente_id, data, ora_inizio, ora_fine, straordinario }) => {
      if (!DATE_RE.test(data)) return { error: 'Formato data non valido, usa yyyy-MM-dd.' }
      if (!isValidTime(ora_inizio) || !isValidTime(ora_fine)) return { error: 'Formato orario non valido, usa HH:MM.' }

      const { data: employee, error: empErr } = await ctx.admin
        .from('profiles')
        .select('id, full_name, restaurant_id, department, role')
        .eq('id', dipendente_id)
        .single()
      if (empErr || !employee) return { error: 'Dipendente non trovato.' }

      if (!assigneeInScope(ctx.profile, employee)) {
        return { error: 'Non sei autorizzato ad assegnare turni a questo dipendente.' }
      }

      const { error } = await ctx.admin.from('turns').insert({
        user_id: employee.id,
        restaurant_id: employee.restaurant_id,
        department: employee.department,
        date: data,
        start_time: normalizeTime(ora_inizio),
        end_time: normalizeTime(ora_fine),
        is_extraordinary: !!straordinario,
        is_rest_day: false,
        created_by: ctx.profile.id,
      })
      if (error) return { error: error.message }

      return {
        ok: true,
        messaggio: `Turno creato per ${employee.full_name} il ${formatDateLabel(data)} dalle ${ora_inizio} alle ${ora_fine}${straordinario ? ' (straordinario)' : ''}.`,
      }
    },
  })
}

function assegnaRiposoTool(ctx: Ctx) {
  return tool({
    description: 'Assegna un giorno di riposo a un dipendente in una data specifica.',
    inputSchema: z.object({
      dipendente_id: z.string().describe('ID del dipendente (ottenuto con cerca_dipendenti)'),
      data: z.string().describe('Data del riposo, formato yyyy-MM-dd'),
    }),
    execute: async ({ dipendente_id, data }) => {
      if (!DATE_RE.test(data)) return { error: 'Formato data non valido, usa yyyy-MM-dd.' }

      const { data: employee, error: empErr } = await ctx.admin
        .from('profiles')
        .select('id, full_name, restaurant_id, department, role')
        .eq('id', dipendente_id)
        .single()
      if (empErr || !employee) return { error: 'Dipendente non trovato.' }

      if (!assigneeInScope(ctx.profile, employee)) {
        return { error: 'Non sei autorizzato ad assegnare riposi a questo dipendente.' }
      }

      const { error } = await ctx.admin.from('turns').insert({
        user_id: employee.id,
        restaurant_id: employee.restaurant_id,
        department: employee.department,
        date: data,
        start_time: '00:00:00',
        end_time: '00:00:00',
        is_extraordinary: false,
        is_rest_day: true,
        created_by: ctx.profile.id,
      })
      if (error) return { error: error.message }

      const { data: managers } = await ctx.admin.from('profiles').select('id').eq('role', 'manager')
      if (managers?.length) {
        await ctx.admin.from('notifications').insert(
          (managers as { id: string }[]).map(m => ({
            user_id: m.id,
            title: 'Nuovo riposo assegnato',
            message: `${ctx.profile.full_name} ha assegnato un riposo a ${employee.full_name} per il ${formatDateLabel(data)}`,
            link: '/turni',
          })),
        )
      }

      return { ok: true, messaggio: `Riposo assegnato a ${employee.full_name} per il ${formatDateLabel(data)}.` }
    },
  })
}

function eliminaTurnoTool(ctx: Ctx) {
  return tool({
    description: 'Elimina un turno esistente, dato il suo ID (ottenuto con lista_turni). Usa solo se l\'utente ha chiaramente identificato il turno da eliminare.',
    inputSchema: z.object({
      turno_id: z.string().describe('ID del turno da eliminare'),
    }),
    execute: async ({ turno_id }) => {
      let query = ctx.admin.from('turns').delete().eq('id', turno_id)
      query = scopeTurnsQuery(query, toScopeProfile(ctx.profile), ctx.profile.id)

      const { data, error } = await query.select('id')
      if (error) return { error: error.message }
      if (!data?.length) return { error: 'Turno non trovato o non sei autorizzato a eliminarlo.' }

      return { ok: true, messaggio: 'Turno eliminato.' }
    },
  })
}

// ── Tool: ODS ─────────────────────────────────────────────────────────

function listaOdsTool(ctx: Ctx) {
  return tool({
    description: 'Elenca i compiti ODS (ordini di servizio) previsti per una data (default: oggi) nel tuo ambito. Restituisce anche l\'ID di ciascun compito, utile per segnarlo come completato.',
    inputSchema: z.object({
      data: z.string().optional().describe('Data yyyy-MM-dd (default: oggi)'),
    }),
    execute: async ({ data }) => {
      const targetDate = data && DATE_RE.test(data) ? data : todayStr()
      const isToday = targetDate === todayStr()

      let query = ctx.admin
        .from('ods_tasks')
        .select('id, title, department, type, recurrence_days, assigned_to, assignee:profiles!assigned_to(full_name)')
        .order('department')
      query = scopeStaffQuery(query, toScopeProfile(ctx.profile))

      const { data: rows, error } = await query
      if (error) return { error: error.message }

      const dayName = formatInTimeZone(`${targetDate}T12:00:00Z`, TZ, 'EEEE', { locale: it }).toLowerCase()
      const due = (rows ?? []).filter((t: Record<string, unknown>) => {
        const type = t.type as OdsTaskType
        if (type === 'quotidiana' || type === 'straordinaria') return true
        return (t.recurrence_days as string[]).some(d => d.toLowerCase() === dayName)
      })

      let doneSet = new Set<string>()
      if (isToday && due.length) {
        const cutoff = getOdsCutoff()
        const { data: completions } = await ctx.admin
          .from('ods_completions')
          .select('task_id')
          .in('task_id', due.map((t: Record<string, unknown>) => t.id))
          .gte('completed_at', cutoff)
        doneSet = new Set((completions ?? []).map((c: { task_id: string }) => c.task_id))
      }

      return {
        data: targetDate,
        compiti: due.map((t: Record<string, unknown>) => ({
          id: t.id,
          titolo: t.title,
          reparto: t.department,
          tipo: ODS_TYPE_LABELS[t.type as OdsTaskType],
          assegnatario: (t.assignee as { full_name: string } | null)?.full_name ?? `Tutto il reparto ${t.department}`,
          completato: isToday ? doneSet.has(t.id as string) : null,
        })),
        nota: isToday ? undefined : 'Lo stato di completamento è disponibile solo per la data di oggi.',
      }
    },
  })
}

function creaOdsTool(ctx: Ctx) {
  return tool({
    description: 'Crea un nuovo compito ODS (ordine di servizio) per un reparto o per un dipendente specifico.',
    inputSchema: z.object({
      titolo: z.string().describe('Titolo/descrizione del compito'),
      reparto: z.string().describe('Reparto: Sala, Pizzeria, Bar o Cucina'),
      tipo: z.enum(['quotidiana', 'settimanale', 'bisettimanale', 'straordinaria']).optional().describe('Tipo di ricorrenza (default: quotidiana)'),
      giorni: z.array(z.string()).optional().describe('Per tipo settimanale/bisettimanale: giorni della settimana in italiano minuscolo (es. ["lunedì","giovedì"])'),
      dipendente_id: z.string().optional().describe('Se il compito va assegnato a un dipendente specifico invece che a tutto il reparto'),
      ristorante: z.string().optional().describe('Nome del ristorante (necessario solo per i manager quando il compito è per tutto un reparto, senza dipendente_id)'),
    }),
    execute: async ({ titolo, reparto, tipo, giorni, dipendente_id, ristorante }) => {
      const dept = resolveDepartment(reparto)
      if (!dept) return { error: `Reparto non valido. Valori possibili: ${DEPARTMENTS.join(', ')}.` }

      let restaurantId: string | null = null
      let assignedTo: string | null = null

      if (dipendente_id) {
        const { data: employee, error: empErr } = await ctx.admin
          .from('profiles')
          .select('id, full_name, restaurant_id, department, role')
          .eq('id', dipendente_id)
          .single()
        if (empErr || !employee) return { error: 'Dipendente non trovato.' }
        if (!assigneeInScope(ctx.profile, employee)) return { error: 'Non sei autorizzato ad assegnare compiti a questo dipendente.' }
        restaurantId = employee.restaurant_id
        assignedTo = employee.id
      } else if (isManager(ctx.profile)) {
        if (!ristorante) return { error: 'Specifica il nome del ristorante: sei un manager e devi indicare a quale ristorante si riferisce il compito.' }
        const { data: restaurants } = await ctx.admin.from('restaurants').select('id, name').ilike('name', `%${ristorante.trim()}%`)
        if (!restaurants?.length) return { error: `Nessun ristorante trovato con nome simile a "${ristorante}".` }
        if (restaurants.length > 1) return { error: `Più ristoranti trovati: ${(restaurants as { name: string }[]).map(r => r.name).join(', ')}. Specifica meglio.` }
        restaurantId = restaurants[0].id
      } else {
        restaurantId = ctx.profile.restaurant_id
        if (isCapoServizio(ctx.profile) && !isDirettore(ctx.profile) && dept !== ctx.profile.department) {
          return { error: `Puoi creare compiti solo per il reparto ${ctx.profile.department}.` }
        }
      }

      if (!restaurantId) return { error: 'Impossibile determinare il ristorante.' }

      const taskType: OdsTaskType = tipo ?? 'quotidiana'
      const recurrenceDays = (taskType === 'settimanale' || taskType === 'bisettimanale')
        ? (giorni ?? []).map(g => g.toLowerCase().trim()).filter(g => (ODS_DAYS_IT as readonly string[]).includes(g))
        : []

      const { data: task, error } = await ctx.admin.from('ods_tasks').insert({
        title: titolo,
        department: dept,
        restaurant_id: restaurantId,
        type: taskType,
        recurrence_days: recurrenceDays,
        creator_id: ctx.profile.id,
        assigned_to: assignedTo,
      }).select('id').single()
      if (error) return { error: error.message }

      let recipients: { id: string }[] = []
      if (assignedTo) {
        recipients = [{ id: assignedTo }]
      } else {
        const { data: staff } = await ctx.admin.from('profiles').select('id')
          .eq('restaurant_id', restaurantId).eq('department', dept)
          .in('role', ['dipendente', 'capo_servizio']).neq('id', ctx.profile.id)
        recipients = staff ?? []
      }
      if (recipients.length) {
        await ctx.admin.from('notifications').insert(
          recipients.map(r => ({
            user_id: r.id,
            title: assignedTo ? 'Nuova mansione assegnata' : 'Nuova istruzione di Reparto',
            message: titolo,
            link: '/ods',
          })),
        )
      }

      return { ok: true, messaggio: `Compito "${titolo}" creato per il reparto ${dept}${assignedTo ? '' : ' (tutto il reparto)'}.`, id: task.id }
    },
  })
}

function completaOdsTool(ctx: Ctx) {
  return tool({
    description: 'Segna un compito ODS come completato per oggi, dato il suo ID (ottenuto con lista_ods).',
    inputSchema: z.object({
      ods_id: z.string().describe('ID del compito ODS'),
    }),
    execute: async ({ ods_id }) => {
      let query = ctx.admin.from('ods_tasks').select('id, title').eq('id', ods_id)
      query = scopeStaffQuery(query, toScopeProfile(ctx.profile))
      const { data: task, error } = await query.maybeSingle()
      if (error) return { error: error.message }
      if (!task) return { error: 'Compito non trovato o non nel tuo ambito.' }

      const { error: insErr } = await ctx.admin.from('ods_completions').insert({
        task_id: ods_id,
        user_id: ctx.profile.id,
      })
      if (insErr) return { error: insErr.message }

      return { ok: true, messaggio: `Compito "${task.title}" segnato come completato.` }
    },
  })
}

// ── Tool: presenze (solo manager / direttore) ───────────────────────────

function listaPresenzeTool(ctx: Ctx) {
  return tool({
    description: 'Elenca le presenze (timbrature) registrate in una data (default: oggi).',
    inputSchema: z.object({
      data: z.string().optional().describe('Data yyyy-MM-dd (default: oggi)'),
    }),
    execute: async ({ data }) => {
      const targetDate = data && DATE_RE.test(data) ? data : todayStr()
      const { start, end } = dayBounds(targetDate)

      let query = ctx.admin
        .from('attendances')
        .select('id, check_in, check_out, profile:profiles(full_name), restaurant:restaurants(name)')
        .gte('check_in', start)
        .lte('check_in', end)
        .order('check_in')
        .limit(60)
      if (isDirettore(ctx.profile)) query = query.eq('restaurant_id', ctx.profile.restaurant_id)

      const { data: rows, error } = await query
      if (error) return { error: error.message }

      return {
        data: targetDate,
        presenze: (rows ?? []).map((r: Record<string, unknown>) => ({
          id: r.id,
          dipendente: (r.profile as { full_name: string } | null)?.full_name ?? null,
          ristorante: (r.restaurant as { name: string } | null)?.name ?? null,
          ingresso: formatInTimeZone(r.check_in as string, TZ, 'HH:mm'),
          uscita: r.check_out ? formatInTimeZone(r.check_out as string, TZ, 'HH:mm') : null,
        })),
      }
    },
  })
}

function creaPresenzaTool(ctx: Ctx) {
  return tool({
    description: 'Crea una presenza manuale (timbratura) per un dipendente.',
    inputSchema: z.object({
      dipendente_id: z.string().describe('ID del dipendente (ottenuto con cerca_dipendenti)'),
      data: z.string().describe('Data yyyy-MM-dd'),
      ora_ingresso: z.string().describe('Orario di ingresso HH:MM'),
      ora_uscita: z.string().optional().describe('Orario di uscita HH:MM, opzionale'),
    }),
    execute: async ({ dipendente_id, data, ora_ingresso, ora_uscita }) => {
      if (!DATE_RE.test(data)) return { error: 'Formato data non valido, usa yyyy-MM-dd.' }
      if (!isValidTime(ora_ingresso) || (ora_uscita && !isValidTime(ora_uscita))) return { error: 'Formato orario non valido, usa HH:MM.' }

      const { data: employee, error: empErr } = await ctx.admin
        .from('profiles')
        .select('id, full_name, restaurant_id, department, role')
        .eq('id', dipendente_id)
        .single()
      if (empErr || !employee) return { error: 'Dipendente non trovato.' }
      if (!assigneeInScope(ctx.profile, employee)) return { error: 'Non sei autorizzato a creare presenze per questo dipendente.' }

      const checkInIso = fromZonedTime(`${data}T${ora_ingresso}:00`, TZ).toISOString()
      const checkOutIso = ora_uscita ? fromZonedTime(`${data}T${ora_uscita}:00`, TZ).toISOString() : null
      if (checkOutIso && checkOutIso <= checkInIso) return { error: 'L\'orario di uscita deve essere dopo l\'ingresso.' }

      const { error } = await ctx.admin.from('attendances').insert({
        user_id: employee.id,
        restaurant_id: employee.restaurant_id,
        check_in: checkInIso,
        check_out: checkOutIso,
      })
      if (error) return { error: error.message }

      return { ok: true, messaggio: `Presenza creata per ${employee.full_name} il ${formatDateLabel(data)}, ingresso ${ora_ingresso}${ora_uscita ? `, uscita ${ora_uscita}` : ''}.` }
    },
  })
}

function modificaPresenzaTool(ctx: Ctx) {
  return tool({
    description: 'Modifica gli orari di ingresso/uscita di una presenza esistente, dato il suo ID (ottenuto con lista_presenze).',
    inputSchema: z.object({
      presenza_id: z.string().describe('ID della presenza'),
      ora_ingresso: z.string().optional().describe('Nuovo orario di ingresso HH:MM'),
      ora_uscita: z.string().optional().describe('Nuovo orario di uscita HH:MM'),
    }),
    execute: async ({ presenza_id, ora_ingresso, ora_uscita }) => {
      if (!ora_ingresso && !ora_uscita) return { error: 'Specifica almeno un orario da modificare.' }
      if ((ora_ingresso && !isValidTime(ora_ingresso)) || (ora_uscita && !isValidTime(ora_uscita))) {
        return { error: 'Formato orario non valido, usa HH:MM.' }
      }

      let query = ctx.admin.from('attendances').select('id, check_in, check_out, restaurant_id').eq('id', presenza_id)
      if (isDirettore(ctx.profile)) query = query.eq('restaurant_id', ctx.profile.restaurant_id)
      const { data: att, error: getErr } = await query.maybeSingle()
      if (getErr) return { error: getErr.message }
      if (!att) return { error: 'Presenza non trovata o non nel tuo ambito.' }

      const dateStr = formatInTimeZone(att.check_in, TZ, 'yyyy-MM-dd')
      const update: Record<string, string> = {}

      if (ora_ingresso) update.check_in = fromZonedTime(`${dateStr}T${ora_ingresso}:00`, TZ).toISOString()
      if (ora_uscita) update.check_out = fromZonedTime(`${dateStr}T${ora_uscita}:00`, TZ).toISOString()

      const checkIn = update.check_in ?? att.check_in
      const checkOut = update.check_out ?? att.check_out
      if (checkOut && checkOut <= checkIn) return { error: 'L\'orario di uscita deve essere dopo l\'ingresso.' }

      const { error } = await ctx.admin.from('attendances').update(update).eq('id', presenza_id)
      if (error) return { error: error.message }

      return { ok: true, messaggio: 'Presenza aggiornata.' }
    },
  })
}

// ── Esecuzione assistente ────────────────────────────────────────────

function buildTools(ctx: Ctx): Record<string, Tool> {
  const tools: Record<string, Tool> = {
    cerca_dipendenti: cercaDipendentiTool(ctx),
    lista_turni: listaTurniTool(ctx),
    crea_turno: creaTurnoTool(ctx),
    assegna_riposo: assegnaRiposoTool(ctx),
    elimina_turno: eliminaTurnoTool(ctx),
    lista_ods: listaOdsTool(ctx),
    crea_ods: creaOdsTool(ctx),
    completa_ods: completaOdsTool(ctx),
  }

  if (canManagePresenze(ctx.profile)) {
    tools.lista_presenze = listaPresenzeTool(ctx)
    tools.crea_presenza = creaPresenzaTool(ctx)
    tools.modifica_presenza = modificaPresenzaTool(ctx)
  }

  return tools
}

export async function runAiAssistant(ctx: Ctx, userText: string): Promise<string> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return '🤖 L\'assistente AI non è ancora configurato. Usa /help per l\'elenco dei comandi disponibili.'
  }

  try {
    const history = await getAiHistory(ctx.admin, ctx.telegramId)
    const messages: ModelMessage[] = [...history, { role: 'user', content: userText }]
    const system = buildSystemPrompt(ctx)
    const tools = buildTools(ctx)

    let result
    try {
      result = await generateText({
        model: google(GEMINI_MODEL),
        system,
        messages,
        tools,
        stopWhen: stepCountIs(8),
      })
    } catch (err) {
      if (!isRateLimitError(err) || GEMINI_FALLBACK_MODEL === GEMINI_MODEL) throw err
      console.warn(`[AI] Quota esaurita per ${GEMINI_MODEL}, passo a ${GEMINI_FALLBACK_MODEL}`)
      result = await generateText({
        model: google(GEMINI_FALLBACK_MODEL),
        system,
        messages,
        tools,
        stopWhen: stepCountIs(8),
      })
    }

    const text = result.text?.trim()
    if (!text) return '🤖 Non sono riuscito a generare una risposta. Riprova oppure usa /help per i comandi disponibili.'

    await saveAiHistory(ctx.admin, ctx.telegramId, [...messages, ...result.response.messages])
    return text
  } catch (err) {
    console.error('Errore assistente AI Telegram:', err instanceof Error ? err.stack ?? err.message : err)
    if (isRateLimitError(err)) {
      return '⏳ Troppe richieste all\'assistente AI in questo momento. Aspetta qualche secondo e riprova.'
    }
    return '⚠️ Si è verificato un errore con l\'assistente AI. Riprova più tardi oppure usa /help per i comandi disponibili.'
  }
}
