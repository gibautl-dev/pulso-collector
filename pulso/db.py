"""Acceso exclusivamente de servidor; consultas parametrizadas y transacciones por fuente."""
from datetime import datetime, timezone, timedelta
from uuid import UUID
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from .models import Candidate, SourceConfig, FetchResult
from .urls import normalize_url, url_hash

class Database:
    def __init__(self, url):
        self.connection = psycopg.connect(url, autocommit=True, row_factory=dict_row,
                                         connect_timeout=15)
    def close(self): self.connection.close()
    def candidate(self,slug):
        row = self.connection.execute('select * from public.candidates where slug=%s',(slug,)).fetchone()
        if not row: raise ValueError('Candidato inexistente')
        return Candidate.model_validate(row)
    def sources(self,candidate_id):
        rows = self.connection.execute('''select candidate_id,source,enabled,interval_seconds,settings,cursor
            from public.candidate_sources where candidate_id=%s order by source''',(candidate_id,)).fetchall()
        return [SourceConfig.model_validate(r) for r in rows]
    def lock(self,candidate_id):
        return self.connection.execute('select pg_try_advisory_lock(hashtextextended(%s,0)) as locked',
                                       (str(candidate_id),)).fetchone()['locked']
    def unlock(self,candidate_id):
        self.connection.execute('select pg_advisory_unlock(hashtextextended(%s,0))',(str(candidate_id),))

    def save_result(self,candidate_id,config,result: FetchResult,started_at,since):
        now = datetime.now(timezone.utc)
        status = 'ok' if not result.errors else ('partial' if result.feeds_ok else 'error')
        count = 0
        with self.connection.transaction():
            for mention in result.mentions:
                if mention.candidate_id != candidate_id or mention.source.value != config.source:
                    raise ValueError('Mención de otro candidato o fuente')
                url = normalize_url(mention.url)
                digest = url_hash(url)
                # Serializado por lock del candidato. Mantener clasificación y texto de la
                # primera observación; actualizaciones de métricas no borran campos existentes.
                existing = self.connection.execute('''select id from public.mentions
                    where candidate_id=%s and (url_hash=%s or
                      (source=%s and source_item_id=%s and source_item_id is not null))
                    order by (url_hash=%s) desc,collected_at,id limit 1 for update''',
                    (candidate_id,digest,config.source,mention.source_item_id,digest)).fetchone()
                if existing:
                    if config.source == 'google_news':
                        # Corregir el enlace opaco de una mención previa al reencontrar su ID.
                        self.connection.execute('''update public.mentions set url=%s,url_hash=%s,
                            account_relation=%s where id=%s''',
                            (url,digest,mention.account_relation,existing['id']))
                    self.connection.execute('''update public.mentions set metrics=metrics || %s where id=%s''',
                                            (Jsonb(mention.metrics),existing['id']))
                    continue
                row = self.connection.execute('''insert into public.mentions
                    (candidate_id,source,source_item_id,url,url_hash,title,content,author,
                     author_handle,outlet,published_at,metrics,lang,account_relation)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    on conflict do nothing returning id''',
                    (candidate_id,config.source,mention.source_item_id,url,digest,mention.title,
                     mention.content,mention.author,mention.author_handle,mention.outlet,
                     mention.published_at,Jsonb(mention.metrics),mention.lang,mention.account_relation)).fetchone()
                count += bool(row)
            dates = [m.published_at for m in result.mentions]
            low,high = (min(dates),max(dates)) if dates else (None,None)
            # Cursor y filas se confirman juntos. Las fuentes fallidas conservan su estado.
            self.connection.execute('''update public.candidate_sources set
                cursor=%s,last_attempt_at=%s,
                last_success_at=case when %s then %s else last_success_at end,
                next_run_at=%s, collection_started_at=coalesce(collection_started_at,%s),
                baseline_started_at=case when %s then coalesce(baseline_started_at,%s)
                    else baseline_started_at end,
                requested_since=%s,earliest_observed_at=least(earliest_observed_at,%s),
                latest_observed_at=greatest(latest_observed_at,%s),coverage_status='partial',updated_at=%s
                where candidate_id=%s and source=%s''',
                (Jsonb(result.cursor),started_at,result.feeds_ok > 0,now,
                 now+timedelta(seconds=config.interval_seconds),started_at,
                 status == 'ok',started_at,since,low,high,now,candidate_id,config.source))
            self.connection.execute('''insert into public.source_runs
                (candidate_id,source,run_kind,started_at,finished_at,status,items_found,items_new,error,cursor)
                values (%s,%s,'manual',%s,%s,%s,%s,%s,%s,%s)''',
                (candidate_id,config.source,started_at,now,status,len(result.mentions),count,
                 '; '.join(result.errors) or None,Jsonb(result.cursor)))
        return {'status':status,'items_found':len(result.mentions),'items_new':count,
                'feeds_ok':result.feeds_ok,'feeds_total':result.feeds_total,
                'skipped_entries':result.skipped_entries}
