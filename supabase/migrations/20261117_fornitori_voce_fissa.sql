-- Voce fissa del fornitore: alcuni fornitori sono sempre la stessa cosa
-- (Slogan Studio e Fourchette marketing, Giemme e Tiburlat beverage,
-- The Circle e ADD food), qualunque cosa ci sia scritto sulle righe.
-- Con la voce fissa:
--  - food/beverage/detergenza/altro_no_food: gli articoli del fornitore
--    prendono quella tipologia (anche quelli che nasceranno), così Analisi
--    e Utile li contano lì;
--  - una voce di gestione (marketing, utenze...): l'intera fattura va in
--    quella voce dell'utile; gli articoli diventano "altro no food".
alter table public.fornitori add column if not exists voce_fissa text
  check (voce_fissa is null or voce_fissa in (
    'food', 'beverage', 'detergenza', 'altro_no_food',
    'marketing', 'utenze', 'manutenzioni', 'consulenze', 'affitto', 'assicurazioni',
    'commissioni', 'noleggi', 'cambiali', 'altro'
  ));

create or replace function public.tipologia_da_voce_fissa(p_voce text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when p_voce is null then null
    when p_voce in ('food', 'beverage', 'detergenza', 'altro_no_food') then p_voce
    else 'altro_no_food'
  end
$function$;

-- Articoli nuovi (o spostati di fornitore): tipologia dalla voce fissa.
create or replace function public.catalogo_articoli_voce_fissa()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_tip text;
begin
  select tipologia_da_voce_fissa(f.voce_fissa) into v_tip from fornitori f where f.id = new.fornitore_id;
  if v_tip is not null then new.tipologia := v_tip; end if;
  return new;
end;
$function$;

create trigger catalogo_articoli_voce_fissa before insert or update of fornitore_id, tipologia on public.catalogo_articoli
  for each row execute function public.catalogo_articoli_voce_fissa();

-- Voce fissa impostata o cambiata: si allineano gli articoli già a catalogo.
create or replace function public.fornitori_voce_fissa_allinea()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.voce_fissa is not null and new.voce_fissa is distinct from old.voce_fissa then
    update catalogo_articoli set tipologia = tipologia_da_voce_fissa(new.voce_fissa)
    where fornitore_id = new.id and tipologia is distinct from tipologia_da_voce_fissa(new.voce_fissa);
  end if;
  return new;
end;
$function$;

create trigger fornitori_voce_fissa_allinea after update of voce_fissa on public.fornitori
  for each row execute function public.fornitori_voce_fissa_allinea();
