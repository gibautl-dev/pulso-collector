"""Resolución previa al guardado. El RPC de Google es no documentado y puede cambiar."""
import base64
import json
import httpx
from html.parser import HTMLParser
from urllib.parse import urlsplit
from ..urls import normalize_url

class DecodeParams(HTMLParser):
    def __init__(self):
        super().__init__(); self.signature = None; self.timestamp = None
    def handle_starttag(self,tag,attrs):
        attrs = dict(attrs)
        if attrs.get('data-n-a-sg') and attrs.get('data-n-a-ts'):
            self.signature = attrs['data-n-a-sg']
            self.timestamp = int(attrs['data-n-a-ts'])

def legacy_url(token):
    try:
        raw = base64.urlsafe_b64decode(token + '=' * (-len(token) % 4))
        if not raw.startswith(b'\x08\x13\x22'): return None
        offset=3; length=0; shift=0
        while offset < len(raw) and shift < 35:
            byte=raw[offset]; offset+=1
            length |= (byte & 127) << shift
            if byte < 128: break
            shift+=7
        value=raw[offset:offset+length].decode()
        return normalize_url(value) if value.startswith(('https://','http://')) else None
    except (ValueError,UnicodeError): return None

def rpc_url(body):
    # batchexecute antepone un marcador anti-XSSI y longitudes por línea.
    for line in body.splitlines():
        try: rows=json.loads(line)
        except (ValueError,TypeError): continue
        if not isinstance(rows,list): continue
        for row in rows:
            if isinstance(row,list) and len(row)>2 and row[0]=='wrb.fr' and row[1]=='Fbv4je':
                decoded=json.loads(row[2])
                if isinstance(decoded,list) and len(decoded)>1 and decoded[0]=='garturlres':
                    return normalize_url(decoded[1])
    raise ValueError('google_news_rpc_unresolved')

async def resolve_article(client,url,settings):
    from .rss_media import request_feed, Retryable
    url=normalize_url(url)
    if urlsplit(url).hostname != 'news.google.com': return url
    token=urlsplit(url).path.rstrip('/').split('/')[-1]
    original=legacy_url(token)
    if original is None:
        page,_,final=await request_feed(client,url,settings,{},return_final=True)
        if urlsplit(final).hostname != 'news.google.com': return normalize_url(final)
        params=DecodeParams(); params.feed(page.decode('utf-8',errors='replace'))
        if params.signature is None or params.timestamp is None:
            raise ValueError('google_news_missing_decode_params')
        context=[['es-419','AR',['WEB_TEST_1_0_0'],None,None,1,1,'AR:es-419',None,180,
                  None,None,None,None,None,0,None,None,[1608992183,723341000]],
                 'es-419','AR',1,[2,3,4,8],1,0,'655000234',0,0,None,0]
        inner=json.dumps(['garturlreq',context,token,params.timestamp,params.signature],separators=(',',':'))
        payload=json.dumps([[['Fbv4je',inner,None,'generic']]],separators=(',',':'))
        body,_=await request_feed(client,
            'https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je',
            settings,{},data={'f.req':payload})
        original=rpc_url(body.decode('utf-8'))
    if urlsplit(original).hostname == 'news.google.com':
        raise ValueError('google_news_not_a_publisher')
    # La URL del editor ya está resuelta. Seguir sus redirects es opcional:
    # un bloqueo HTTP o fallo de red no debe descartar la mención del feed.
    # Los errores de decodificación/política de URL siguen propagándose.
    try:
        _,_,final=await request_feed(client,original,settings,{},return_final=True)
    except (httpx.HTTPError, Retryable):
        return original
    final=normalize_url(final)
    if urlsplit(final).hostname == 'news.google.com': raise ValueError('google_news_loop')
    return final
