-- Unione di due righe di catalogo che rappresentano lo stesso prodotto
-- fisico (es. un articolo creato a mano che poi arriva anche via
-- fattura, sotto un'altra riga di catalogo). Stesso pattern di
-- unisci_fornitori: SECURITY DEFINER con controllo di autorizzazione
-- esplicito dentro la funzione (indispensabile, dato che bypassa le RLS).
create or replace function public.unisci_articoli(p_assorbito_id uuid, p_mantenuto_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner_assorbito uuid;
  v_owner_mantenuto uuid;
  v_fornitore_mantenuto uuid;
  v_traccia_assorbito boolean;
begin
  if p_assorbito_id = p_mantenuto_id then
    raise exception 'Impossibile unire un articolo con se stesso';
  end if;

  select owner_id, traccia_in_inventario into v_owner_assorbito, v_traccia_assorbito
  from catalogo_articoli where id = p_assorbito_id;
  select owner_id, fornitore_id into v_owner_mantenuto, v_fornitore_mantenuto
  from catalogo_articoli where id = p_mantenuto_id;

  if v_owner_assorbito is null or v_owner_mantenuto is null then
    raise exception 'Articolo non trovato';
  end if;
  if v_owner_assorbito <> v_owner_mantenuto then
    raise exception 'I due articoli non appartengono allo stesso locale';
  end if;

  if not exists (
    select 1 from restaurants r where r.owner_id = v_owner_assorbito and can_manage_restaurant(r.id)
  ) then
    raise exception 'Non autorizzato';
  end if;

  -- Storico fatture: le righe già registrate passano all'articolo mantenuto.
  update fatture_articoli set catalogo_articolo_id = p_mantenuto_id where catalogo_articolo_id = p_assorbito_id;

  -- Storico movimenti di magazzino: idem — la giacenza (somma dei
  -- movimenti) resta corretta e continua sull'articolo unificato.
  update inventario_movimenti set catalogo_articolo_id = p_mantenuto_id where catalogo_articolo_id = p_assorbito_id;

  -- Mappature testo OCR: le prossime fatture di quel fornitore
  -- risolveranno già sull'articolo mantenuto. Se il fornitore mantenuto
  -- ha già una mappatura per lo stesso testo, quella dell'assorbito è
  -- ridondante: va eliminata invece di andare in conflitto sul vincolo
  -- di unicità (owner_id, fornitore_id, testo_estratto).
  delete from articoli_mappature_testo m1
  where m1.catalogo_articolo_id = p_assorbito_id
    and exists (
      select 1 from articoli_mappature_testo m2
      where m2.owner_id = v_owner_mantenuto and m2.fornitore_id = v_fornitore_mantenuto
        and m2.testo_estratto = m1.testo_estratto
    );
  update articoli_mappature_testo
  set catalogo_articolo_id = p_mantenuto_id, fornitore_id = v_fornitore_mantenuto
  where catalogo_articolo_id = p_assorbito_id;

  -- Se l'assorbito era tracciato in Inventario, il mantenuto lo resta
  -- (o lo diventa): unire due articoli non deve far perdere il
  -- tracciamento che uno dei due aveva.
  if v_traccia_assorbito then
    update catalogo_articoli set traccia_in_inventario = true where id = p_mantenuto_id;
  end if;

  delete from catalogo_articoli where id = p_assorbito_id;
end;
$function$;
