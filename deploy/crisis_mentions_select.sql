-- Lectura extra de public.mentions para el pack del agente de crisis
-- (python -m pulso.crisis, load_pack). pulso_classifier ya tenía SELECT en las
-- columnas del clasificador; también necesita url, author, author_handle,
-- published_at, account_relation y metrics. Solo SELECT de esas columnas.
-- Sin INSERT, UPDATE ni DELETE. Sin otras tablas: suspicious_accounts, meta_ads,
-- meta_ad_classifications y ai_answers ya tienen SELECT para este rol.
-- Idempotente. No contiene secretos. No cambia env ni el cron.
-- Aplicada en pulso-demo (bkjugpesqbplnaeotadh) el 2026-11-25 (hora de Argentina).
-- No volver a aplicar tal cual si ya está.
--
-- Costo de aplicar el SQL: USD 0.

begin;

grant select (url, author, author_handle, published_at, account_relation, metrics)
  on public.mentions to pulso_classifier;

commit;
