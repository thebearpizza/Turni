-- Contrordine: il cassiere resta solo su Cassa (Chiusura, Lista
-- Chiusure), come prima dell'introduzione della macroarea Acquisti —
-- annulla le 6 policy di sola lettura aggiunte in
-- 20260915b_acquisti_cassiere_sola_lettura.sql.
drop policy if exists fornitori_cassiere_select on public.fornitori;
drop policy if exists catalogo_articoli_cassiere_select on public.catalogo_articoli;
drop policy if exists categorie_dirette_cassiere_select on public.categorie_fatture_dirette;
drop policy if exists fatture_cassiere_select on public.fatture;
drop policy if exists fatture_articoli_cassiere_select on public.fatture_articoli;
drop policy if exists fatture_iva_cassiere_select on public.fatture_iva_dettaglio;
