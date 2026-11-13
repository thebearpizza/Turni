-- Spese di cassa del lavapiatti scritte in tanti modi ("Lavaggio",
-- "Lavaggio Extra", "Bilal lavapiatti agosto"...): si accorpano tutte in
-- "Lavapiatti", categoria Personale dello stesso proprietario, così
-- Analisi e Utile le contano in una voce sola. Vale per le spese salvate e
-- per le bozze, qualunque sia il modulo che le scrive. Si guarda la parola
-- intera: "Riparazione lavastoviglie" non c'entra.
create or replace function public.cassa_spese_accorpa_lavapiatti()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_personale uuid;
begin
  if new.nome_spesa is null or new.nome_spesa !~* '\m(lavaggio|lavaggi|lavapiatti|lava piatti)\M' then
    return new;
  end if;
  new.nome_spesa := 'Lavapiatti';
  select p.id into v_personale
  from cassa_categorie p
  join cassa_categorie c on c.owner_id = p.owner_id
  where c.id = new.categoria_id and lower(trim(p.nome)) = 'personale'
  limit 1;
  if v_personale is not null then new.categoria_id := v_personale; end if;
  return new;
end;
$function$;

create trigger cassa_spese_lavapiatti before insert or update of nome_spesa, categoria_id on public.cassa_spese
  for each row execute function public.cassa_spese_accorpa_lavapiatti();
create trigger cassa_spese_bozza_lavapiatti before insert or update of nome_spesa, categoria_id on public.cassa_spese_bozza
  for each row execute function public.cassa_spese_accorpa_lavapiatti();
