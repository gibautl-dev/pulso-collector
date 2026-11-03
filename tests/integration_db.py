"""Prueba opt-in: crea un candidato temporal real y lo elimina al terminar."""
from datetime import datetime, timezone
from uuid import uuid4
from pulso.config import Settings
from pulso.db import Database
from pulso.models import Mention, FetchResult

def main():
    db=Database(Settings.from_env().database_url)
    cid=uuid4(); slug='test-'+cid.hex
    try:
        db.connection.execute('insert into public.candidates (id,slug,name,keywords) values (%s,%s,%s,%s)',
                              (cid,slug,'Prueba temporal',['Prueba']))
        assert db.lock(cid)
        cfg=next(c for c in db.sources(cid) if c.source=='rss_media')
        now=datetime.now(timezone.utc)
        mention=Mention(candidate_id=cid,source='rss_media',source_item_id='native-1',
                        url='https://example.com/test?utm_source=demo',published_at=now,title='Prueba')
        r=FetchResult(mentions=[mention],feeds_ok=1,feeds_total=1,cursor={'test':'saved'})
        assert db.save_result(cid,cfg,r,now,now)['items_new']==1
        other=mention.model_copy(update={'url':'https://example.com/test#fragment'})
        assert db.save_result(cid,cfg,r.model_copy(update={'mentions':[other]}),now,now)['items_new']==0
        native=mention.model_copy(update={'url':'https://example.com/alternate'})
        assert db.save_result(cid,cfg,r.model_copy(update={'mentions':[native]}),now,now)['items_new']==0
        assert db.connection.execute('select count(*) as n from public.mentions where candidate_id=%s',(cid,)).fetchone()['n']==1
        # La transacción debe revertir una fila ya escrita si otra mención es inválida.
        fresh=mention.model_copy(update={'source_item_id':'native-2','url':'https://example.com/new'})
        invalid=mention.model_copy(update={'candidate_id':uuid4()})
        try:
            db.save_result(cid,cfg,r.model_copy(update={'mentions':[fresh,invalid]}),now,now)
            raise AssertionError('Expected rollback')
        except ValueError: pass
        assert db.connection.execute('select count(*) as n from public.mentions where candidate_id=%s',(cid,)).fetchone()['n']==1
        print('OK: esquema, trigger, dedupe por URL e ID y rollback transaccional')
    finally:
        db.connection.execute('delete from public.candidates where id=%s',(cid,))
        db.unlock(cid); db.close()

if __name__=='__main__': main()
