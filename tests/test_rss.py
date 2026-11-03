import unittest
from unittest.mock import patch, AsyncMock
from datetime import datetime, timezone
from uuid import uuid4
from pulso.models import Candidate, SourceConfig, SourceName
from pulso.config import Settings
from pulso.urls import normalize_url, url_hash, unwrap_alert
from pulso.sources.rss_media import RSSSource, matches, account_relation, request_feed
import httpx

XML = b'''<?xml version="1.0"?><rss version="2.0"><channel><title>Medio</title>
<item><guid>1</guid><title>Ana Perez presenta proyecto</title><link>https://example.com/a?utm_source=rss</link><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate><description>Detalle</description></item>
<item><guid>2</guid><title>Otro candidato</title><link>https://example.com/b</link><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate></item>
<item><guid>3</guid><title>Ana Perez sin fecha</title><link>https://example.com/c</link></item>
</channel></rss>'''

class URLTests(unittest.TestCase):
    def test_tracking_and_content_identity(self):
        a='HTTPS://Example.com:443/post?id=2&utm_source=x#frag'
        self.assertEqual(normalize_url(a),'https://example.com/post?id=2')
        self.assertEqual(url_hash(a),url_hash('https://example.com/post?id=2'))
        self.assertNotEqual(url_hash(a),url_hash('https://example.com/post?id=3'))
    def test_alert(self):
        self.assertEqual(unwrap_alert('https://www.google.com/url?url=https%3A%2F%2Fexample.com%2Fa%3Futm_source%3Dx'),'https://example.com/a')
    def test_unsafe(self):
        for url in ['javascript:alert(1)','https://user:pass@example.com/a']:
            with self.assertRaises(ValueError): normalize_url(url)
    def test_domain_relation(self):
        cfg=SourceConfig(candidate_id=uuid4(),source='rss_media',enabled=True,interval_seconds=1200,
            settings={'own_domains':['candidate.example'],'reference_domains':['other.example']})
        self.assertEqual(account_relation('https://www.candidate.example/a',cfg),'own')
        self.assertEqual(account_relation('https://other.example/a',cfg),'reference')
        self.assertEqual(account_relation('https://fakecandidate.example/a',cfg),'third_party')
    def test_filter(self):
        c=Candidate(id=uuid4(),slug='ana',name='Ana',keywords=['Ana Pérez'],exclude_keywords=['actriz'])
        self.assertTrue(matches('ANA PEREZ anuncia',c))
        self.assertFalse(matches('Ana Perez actriz',c))
        self.assertFalse(matches('Mariana Perez anuncia',c))

class RSSTests(unittest.IsolatedAsyncioTestCase):
    async def test_normalization_filter_and_missing_date(self):
        c=Candidate(id=uuid4(),slug='ana',name='Ana',keywords=['Ana Pérez'])
        cfg=SourceConfig(candidate_id=c.id,source='rss_media',enabled=True,interval_seconds=1200,settings={'feeds':['https://example.com/rss']})
        with patch('pulso.sources.rss_media.request_feed',new=AsyncMock(return_value=(XML,{'etag':'abc'}))):
            result=await RSSSource(SourceName.RSS,Settings('unused')).fetch(c,datetime(2026,11,1,tzinfo=timezone.utc),cfg)
        self.assertEqual(len(result.mentions),1)
        self.assertEqual(result.mentions[0].url,'https://example.com/a')
        self.assertEqual(result.skipped_entries,1)
        self.assertEqual(result.feeds_ok,1)
    async def test_304_keeps_cursor(self):
        c=Candidate(id=uuid4(),slug='ana',name='Ana',keywords=['Ana Perez'])
        cfg=SourceConfig(candidate_id=c.id,source='rss_media',enabled=True,interval_seconds=1200,
            settings={'feeds':['https://example.com/rss']},
            cursor={'feeds':{'https://example.com/rss':{'etag':'old'}}})
        with patch('pulso.sources.rss_media.request_feed',new=AsyncMock(return_value=(None,{}))) as req:
            r=await RSSSource(SourceName.RSS,Settings('unused')).fetch(c,datetime(2026,11,1,tzinfo=timezone.utc),cfg)
        self.assertEqual(r.feeds_ok,1)
        self.assertEqual(r.cursor,cfg.cursor)
        self.assertEqual(req.call_args.args[3],{'If-None-Match':'old'})

    async def test_http_redirect_and_size_limit(self):
        def handler(req):
            if req.url.path=='/redirect': return httpx.Response(302,headers={'location':'/rss'})
            return httpx.Response(200,content=XML)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with patch('pulso.sources.rss_media.validate_feed_url',side_effect=lambda u,*args:u):
                data,_=await request_feed(client,'https://example.com/redirect',Settings('unused'),{})
                self.assertEqual(data,XML)
                with self.assertRaises(ValueError):
                    await request_feed(client,'https://example.com/rss',Settings('unused',max_feed_bytes=10),{})

    async def test_partial_failure_and_cursor(self):
        c=Candidate(id=uuid4(),slug='ana',name='Ana',keywords=['Ana Perez'])
        cfg=SourceConfig(candidate_id=c.id,source='rss_media',enabled=True,interval_seconds=1200,
            settings={'feeds':['https://example.com/bad','https://example.com/good']},
            cursor={'feeds':{'https://example.com/bad':{'etag':'old'}}})
        with patch('pulso.sources.rss_media.request_feed',new=AsyncMock(side_effect=[ValueError('secret'),(XML,{})])):
            r=await RSSSource(SourceName.RSS,Settings('unused')).fetch(c,datetime(2026,11,1,tzinfo=timezone.utc),cfg)
        self.assertEqual(r.feeds_ok,1)
        self.assertEqual(r.cursor['feeds']['https://example.com/bad']['etag'],'old')
        self.assertNotIn('secret',str(r.errors))

if __name__=='__main__': unittest.main()
