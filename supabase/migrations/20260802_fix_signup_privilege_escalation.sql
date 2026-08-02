-- Bug critico: la registrazione pubblica poteva risultare in un account con
-- role='manager'. Causa: handle_new_user() si fidava ciecamente del campo
-- "role" nei metadata forniti dal client in fase di signup, senza alcuna
-- allowlist. Chiunque (anche bypassando /api/register e chiamando
-- direttamente l'endpoint pubblico di signup di Supabase con la anon key)
-- poteva ottenere account_status='active' (default di colonna) e
-- managed_restaurant_ids=NULL (= platform owner, accesso a tutti i
-- ristoranti reali) in un solo passaggio.
--
-- Fix: l'inserimento automatico creato dal trigger ignora sempre il ruolo
-- dichiarato dal client e usa sempre valori sicuri per default (dipendente,
-- pending, nessun ristorante gestito). I percorsi legittimi che devono
-- creare un manager (es. /api/register per i nuovi clienti in prova, o
-- /api/users per un manager promosso da un altro manager) impostano il
-- ruolo corretto in un upsert/update ESPLICITO subito dopo, con il client
-- admin (service role) — quindi restano intatti.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, account_status, managed_restaurant_ids)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)),
    'dipendente',
    'pending',
    '{}'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- Seconda falla, indipendente dalla prima: la policy RLS profiles_update
-- limita SOLO quale riga può essere toccata (id = auth.uid()), non quali
-- colonne/valori — quindi qualsiasi utente già loggato (dipendente,
-- cassiere, capo_servizio, consulente) poteva promuoversi da solo con
-- supabase.from('profiles').update({role:'manager', managed_restaurant_ids:null})
-- sulla propria riga, senza nemmeno passare da una registrazione.
--
-- Fix: un trigger BEFORE UPDATE blocca qualunque self-update (auth.uid() =
-- NEW.id, cioè una richiesta autenticata col client pubblico) che tocchi le
-- colonne che determinano i privilegi. auth.uid() è NULL quando la riga
-- viene aggiornata con la service role key (le route admin che
-- creano/promuovono utenti), quindi quei percorsi restano intenzionalmente
-- permessi.
CREATE OR REPLACE FUNCTION public.prevent_self_privilege_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.id THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.account_status IS DISTINCT FROM OLD.account_status
       OR NEW.managed_restaurant_ids IS DISTINCT FROM OLD.managed_restaurant_ids
       OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
       OR NEW.is_direttore IS DISTINCT FROM OLD.is_direttore
    THEN
      RAISE EXCEPTION 'Non puoi modificare da solo il tuo ruolo, stato account, ristorante o ristoranti gestiti.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_profiles_prevent_self_escalation ON public.profiles;
CREATE TRIGGER trg_profiles_prevent_self_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_privilege_escalation();
