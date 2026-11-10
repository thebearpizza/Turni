-- Turni: riposo nei turni fissi (foglio "Turni fissi" di MTTurni.dc.html,
-- settimana tipo con Lavoro / Riposo / Nessuno per ogni giorno).
-- Senza questa colonna il codice (salvaSettimanaTipo) applica comunque i
-- riposi alle settimane popolate, ma non li ricorda tra i turni fissi e
-- avvisa con un toast. populateFromStandard legge la colonna se c'è.
-- Nessuna nuova RPC: le scritture passano dalle policy RLS già esistenti
-- su standard_shifts (stesso scope di turns).

ALTER TABLE public.standard_shifts
  ADD COLUMN IF NOT EXISTS is_rest_day boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.standard_shifts.is_rest_day IS
  'Giorno di riposo fisso: start_time/end_time valgono 00:00 e populateFromStandard crea un turno is_rest_day.';
