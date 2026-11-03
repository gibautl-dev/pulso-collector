import hashlib
import html
import ipaddress
import socket
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

TRACKING = {"fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid"}

def normalize_url(value: str) -> str:
    value = html.unescape(value.strip())
    parts = urlsplit(value)
    if parts.scheme.lower() not in {"http", "https"} or not parts.hostname:
        raise ValueError("URL HTTP(S) inválida")
    if parts.username or parts.password:
        raise ValueError("URL con credenciales no permitida")
    host = parts.hostname.encode("idna").decode().lower()
    port = parts.port
    netloc = f"[{host}]" if ":" in host else host
    if port and not (parts.scheme.lower() == "http" and port == 80 or parts.scheme.lower() == "https" and port == 443):
        netloc += f":{port}"
    query = [(k,v) for k,v in parse_qsl(parts.query, keep_blank_values=True)
             if not k.lower().startswith("utm_") and k.lower() not in TRACKING]
    return urlunsplit((parts.scheme.lower(),netloc,parts.path or "/",urlencode(query),""))

def url_hash(value: str) -> str:
    return hashlib.sha256(normalize_url(value).encode()).hexdigest()

def unwrap_alert(value: str) -> str:
    parts = urlsplit(html.unescape(value))
    host = (parts.hostname or "").lower()
    if host in {"google.com", "www.google.com", "google.com.ar", "www.google.com.ar"} and parts.path == "/url":
        params = dict(parse_qsl(parts.query))
        value = params.get("url") or params.get("q") or value
    return normalize_url(value)

def validate_feed_url(value: str, settings=None) -> str:
    value = normalize_url(value)
    parts = urlsplit(value)
    if parts.port not in {None,80,443}:
        raise ValueError("Puerto no permitido")
    mode = settings.url_security_mode if settings else "strict"
    allowed = settings.url_allowed_hosts if settings else ()
    # allowlist: excepciones exactas de host, no sufijos ni comodines.
    if mode == "off" or (mode == "allowlist" and parts.hostname in allowed):
        return value
    addresses = socket.getaddrinfo(parts.hostname, parts.port or 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError("El feed debe resolver a una dirección pública")
    return value
