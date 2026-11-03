import base64
import json
import httpx
import unittest
from unittest.mock import patch, AsyncMock
from uuid import uuid4
from datetime import datetime, timezone
from pulso.config import Settings
from pulso.urls import validate_feed_url
from pulso.sources.google_news import resolve_article
from pulso.sources.rss_media import RSSSource
from pulso.models import Candidate, SourceConfig, SourceName

class SecurityTests(unittest.TestCase):
    def test_off_no_dns(self):
        with patch('socket.getaddrinfo',side_effect=AssertionError('DNS unexpected')):
            self.assertEqual(validate_feed_url('https://example.com/a',Settings('unused',url_security_mode='off')),'https://example.com/a')
    def test_allowlist_exact(self):
        settings=Settings('unused',url_security_mode='allowlist',url_allowed_hosts=('example.com',))
        with patch('socket.getaddrinfo',side_effect=ValueError('blocked')):
            validate_feed_url('https://example.com/a',settings)
            with self.assertRaises(ValueError): validate_feed_url('https://sub.example.com/a',settings)
    def test_strict_private(self):
        with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaises(ValueError): validate_feed_url('https://example.com',Settings('unused'))

class ResolveTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_editor_redirect(self):
        article=b'https://gba.gob.ar/noticia'
        token=base64.urlsafe_b64encode(b'\x08\x13\x22'+bytes([len(article)])+article).decode().rstrip('=')
        with patch('pulso.sources.rss_media.request_feed',new=AsyncMock(return_value=(b'',{},'https://www.gba.gob.ar/noticia'))) as req:
            url=await resolve_article(None,'https://news.google.com/rss/articles/'+token,Settings('unused'))
        self.assertEqual(url,'https://www.gba.gob.ar/noticia')
        self.assertEqual(req.call_count,1)
    async def test_modern_rpc(self):
        url='https://news.google.com/rss/articles/opaque'
        html=b'<div data-n-a-sg="signature" data-n-a-ts="123"></div>'
        response=json.dumps([['wrb.fr','Fbv4je',json.dumps(['garturlres','https://gba.gob.ar/n'])]]).encode()
        with patch('pulso.sources.rss_media.request_feed',new=AsyncMock(side_effect=[(html,{},url),(response,{}),(b'',{},'https://gba.gob.ar/n')])) as req:
            self.assertEqual(await resolve_article(None,url,Settings('unused')),'https://gba.gob.ar/n')
            self.assertIn('f.req',req.call_args_list[1].kwargs['data'])
    async def test_failed_resolution_retries_feed(self):
        c=Candidate(id=uuid4(),slug='demo',name='Demo',keywords=['Demo'])
        cfg=SourceConfig(candidate_id=c.id,source='google_news',enabled=True,interval_seconds=1200)
        adapter=RSSSource(SourceName.NEWS,Settings('unused'))
        feed=adapter.feeds(c,cfg)[0]
        cfg.cursor={'feeds':{feed:{'etag':'old'}}}
        xml=b'<rss version="2.0"><channel><title>News</title><item><guid>a</guid><title>Demo</title><link>https://news.google.com/rss/articles/a</link><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>'
        with patch('pulso.sources.rss_media.request_feed',new=AsyncMock(return_value=(xml,{'etag':'new'}))),patch('pulso.sources.google_news.resolve_article',new=AsyncMock(side_effect=ValueError('unresolved'))):
            result=await adapter.fetch(c,datetime(2026,11,1,tzinfo=timezone.utc),cfg)
        self.assertEqual(result.mentions,[])
        self.assertTrue(result.errors)
        self.assertNotIn(feed,result.cursor['feeds'])
    async def test_resolved_government_own(self):
        c=Candidate(id=uuid4(),slug='demo',name='Demo',keywords=['Demo'])
        cfg=SourceConfig(candidate_id=c.id,source='google_news',enabled=True,interval_seconds=1200,settings={'own_domains':['gba.gob.ar']})
        xml=b'<rss version="2.0"><channel><title>News</title><item><guid>a</guid><title>Demo</title><link>https://news.google.com/rss/articles/a</link><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>'
        with patch('pulso.sources.rss_media.request_feed',new=AsyncMock(return_value=(xml,{}))),patch('pulso.sources.google_news.resolve_article',new=AsyncMock(return_value='https://www.gba.gob.ar/n')):
            result=await RSSSource(SourceName.NEWS,Settings('unused')).fetch(c,datetime(2026,11,1,tzinfo=timezone.utc),cfg)
        self.assertEqual(result.mentions[0].account_relation,'own')
        self.assertEqual(result.mentions[0].url,'https://www.gba.gob.ar/n')

    async def test_publisher_redirect_403_keeps_resolved_url(self):
        original = 'https://infocielo.com/nota'
        raw = original.encode()
        token = base64.urlsafe_b64encode(b'\x08\x13\x22' + bytes([len(raw)]) + raw).decode().rstrip('=')
        visited = []
        def handler(request):
            visited.append(str(request.url))
            if request.url.path == '/nota':
                return httpx.Response(302, headers={'location': '/bloqueado'})
            return httpx.Response(403, text='Forbidden')
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await resolve_article(client, 'https://news.google.com/rss/articles/' + token,
                                           Settings('unused', url_security_mode='off'))
        self.assertEqual(result, original)
        self.assertEqual(visited, [original, 'https://infocielo.com/bloqueado'])

    async def test_rss_keeps_mention_after_rpc_resolves_but_publisher_403(self):
        candidate = Candidate(id=uuid4(), slug='demo', name='Demo', keywords=['Demo'])
        config = SourceConfig(candidate_id=candidate.id, source='google_news',
                              enabled=True, interval_seconds=1200)
        news_url = 'https://news.google.com/rss/articles/opaque'
        original = 'https://infocielo.com/nota'
        xml = b'<rss version="2.0"><channel><title>News</title><item><guid>a</guid><title>Demo</title><link>https://news.google.com/rss/articles/opaque</link><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>'
        html = b'<div data-n-a-sg="signature" data-n-a-ts="123"></div>'
        rpc = json.dumps([['wrb.fr', 'Fbv4je', json.dumps(['garturlres', original])]]).encode()
        request = httpx.Request('GET', 'https://infocielo.com/bloqueado')
        response = httpx.Response(403, request=request)
        error = httpx.HTTPStatusError('Forbidden', request=request, response=response)
        with patch('pulso.sources.rss_media.request_feed', new=AsyncMock(side_effect=[
                (xml, {'etag': 'new'}), (html, {}, news_url), (rpc, {}), error])):
            result = await RSSSource(SourceName.NEWS, Settings('unused')).fetch(
                candidate, datetime(2026, 11, 1, tzinfo=timezone.utc), config)
        self.assertEqual(len(result.mentions), 1)
        self.assertEqual(result.mentions[0].url, original)
        self.assertEqual(result.errors, [])
        self.assertEqual(result.skipped_entries, 0)
        self.assertEqual(result.feeds_ok, 1)
