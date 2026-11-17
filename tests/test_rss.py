import unittest
from unittest.mock import patch, AsyncMock
from datetime import datetime, timezone
from uuid import uuid4
from pulso.models import Candidate, SourceConfig, SourceName
from pulso.config import Settings
from pulso.urls import normalize_url, url_hash, unwrap_alert
from pulso.sources.rss_media import (RSSSource, matches, account_relation, request_feed,
    Retryable, format_feed_error, safe_request_target, feed_user_agent, client_headers)
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



class ErrorFormatTests(unittest.TestCase):
    def test_omits_query_and_alert_tokens(self):
        url = "https://news.google.com/rss/search?q=Kicillof"
        msg = format_feed_error(0, Retryable("rate_limited", status=429, url=url), url)
        self.assertIn("feed_0: Retryable 429 rate_limited", msg)
        self.assertIn("news.google.com/rss/search", msg)
        self.assertNotIn("Kicillof", msg)
        alert = "https://www.google.com/alerts/feeds/123/TOKENSECRET"
        msg = format_feed_error(0, ValueError("token-secret"), alert)
        self.assertEqual(safe_request_target(alert), "www.google.com/alerts/feeds")
        self.assertIn("www.google.com/alerts/feeds", msg)
        self.assertNotIn("TOKENSECRET", msg)
        self.assertNotIn("token-secret", msg)

    def test_http_status_error_includes_code(self):
        request = httpx.Request("GET", "https://www.laizquierdadiario.com/spip.php?page=backend")
        error = httpx.HTTPStatusError("Forbidden", request=request, response=httpx.Response(403, request=request))
        msg = format_feed_error(20, error, str(request.url))
        self.assertIn("feed_20: HTTPStatusError 403", msg)
        self.assertIn("www.laizquierdadiario.com/spip.php", msg)
        self.assertNotIn("secret", msg)

    def test_default_headers_and_optional_ua_override(self):
        settings = Settings("unused")
        headers = client_headers(settings)
        self.assertIn("text/xml", headers["Accept"])
        self.assertIn("es-AR", headers["Accept-Language"])
        self.assertNotIn("PulsoCollector", settings.user_agent)
        cfg = SourceConfig(candidate_id=uuid4(), source="rss_media", enabled=True, interval_seconds=1200,
                           settings={"feed_user_agents": {"https://example.com/rss": "CustomUA/1.0"}})
        self.assertEqual(feed_user_agent(settings, cfg, "https://example.com/rss"), "CustomUA/1.0")
        self.assertEqual(feed_user_agent(settings, cfg, "https://other.example/rss"), settings.user_agent)


class RetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_429_without_retry_after_is_retryable(self):
        def handler(req):
            return httpx.Response(429)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with patch("pulso.sources.rss_media.validate_feed_url", side_effect=lambda u, *a: u), \
                 patch("pulso.sources.rss_media.retry_after_seconds", return_value=0), \
                 patch("pulso.sources.rss_media.asyncio.sleep", new=AsyncMock()):
                with self.assertRaises(Retryable) as ctx:
                    await request_feed(client, "https://news.google.com/rss/search?q=x", Settings("unused"), {})
        self.assertEqual(ctx.exception.status, 429)
        self.assertEqual(ctx.exception.reason, "rate_limited")

    async def test_429_with_large_retry_after_does_not_raise_valueerror(self):
        def handler(req):
            return httpx.Response(429, headers={"Retry-After": "120"})
        slept = []
        async def fake_sleep(value):
            slept.append(value)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with patch("pulso.sources.rss_media.validate_feed_url", side_effect=lambda u, *a: u), \
                 patch("pulso.sources.rss_media.asyncio.sleep", new=fake_sleep):
                with self.assertRaises(Retryable) as ctx:
                    await request_feed(client, "https://news.google.com/rss/search", Settings("unused"), {})
        self.assertEqual(ctx.exception.status, 429)
        self.assertTrue(slept)
        self.assertLessEqual(max(slept), 20.5)

    async def test_google_news_feed_failure_is_soft(self):
        candidate = Candidate(id=uuid4(), slug="ana", name="Ana", keywords=["Ana Perez"])
        config = SourceConfig(candidate_id=candidate.id, source="google_news", enabled=True, interval_seconds=1200)
        with patch("pulso.sources.rss_media.request_feed", new=AsyncMock(
                side_effect=Retryable("rate_limited", status=429, url="https://news.google.com/rss/search"))):
            result = await RSSSource(SourceName.NEWS, Settings("unused")).fetch(
                candidate, datetime(2026, 11, 1, tzinfo=timezone.utc), config)
        self.assertTrue(result.soft_failure)
        self.assertEqual(result.feeds_ok, 0)
        self.assertTrue(any("429" in error and "news.google.com/rss/search" in error for error in result.errors))

    async def test_per_feed_user_agent_is_sent(self):
        candidate = Candidate(id=uuid4(), slug="ana", name="Ana", keywords=["Ana Perez"])
        url = "https://example.com/rss"
        config = SourceConfig(candidate_id=candidate.id, source="rss_media", enabled=True, interval_seconds=1200,
                              settings={"feeds": [url], "feed_user_agents": {url: "CustomUA/1.0"}})
        with patch("pulso.sources.rss_media.request_feed", new=AsyncMock(return_value=(XML, {}))) as req:
            await RSSSource(SourceName.RSS, Settings("unused")).fetch(
                candidate, datetime(2026, 11, 1, tzinfo=timezone.utc), config)
        self.assertEqual(req.call_args.args[3].get("User-Agent"), "CustomUA/1.0")


if __name__=="__main__":
    unittest.main()
