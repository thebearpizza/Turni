-- Categoria "Cambiali" fra le spese di gestione dell'utile.
alter table public.costi_gestione drop constraint if exists costi_gestione_categoria_check;
alter table public.costi_gestione add constraint costi_gestione_categoria_check check (categoria in (
  'personale', 'affitto', 'utenze', 'marketing', 'manutenzioni', 'consulenze',
  'assicurazioni', 'commissioni', 'noleggi', 'cambiali', 'altro'
));
