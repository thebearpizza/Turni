-- Il cassiere non riusciva più a confermare la chiusura: alla conferma
-- cassa_assegna_busta dà il numero di busta (prima null) e questo trigger,
-- vedendo cambiare busta_numero, bloccava l'aggiornamento ("Solo un
-- manager può segnare una busta come versata"): la chiusura restava in
-- bozza. L'assegnazione del primo numero è lecita; resta vietato al
-- cassiere segnare la busta come versata o cambiare un numero già dato.
-- Stessa firma: create or replace sostituisce, non crea un overload.
-- Già applicata in produzione.
create or replace function public.cassa_blocca_busta_cassiere()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if get_my_role() = 'cassiere'
     and (new.busta_versata_at is distinct from old.busta_versata_at
          or new.busta_versata_da is distinct from old.busta_versata_da
          or (old.busta_numero is not null and new.busta_numero is distinct from old.busta_numero)) then
    raise exception 'Solo un manager può segnare una busta come versata';
  end if;
  return new;
end;
$function$;
