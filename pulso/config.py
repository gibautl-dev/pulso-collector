import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit, parse_qs
from dotenv import load_dotenv

@dataclass(frozen=True)
class Settings:
    database_url: str = field(repr=False)
    timeout_seconds: float = 20
    max_feed_bytes: int = 5_000_000
    user_agent: str = "PulsoCollector/0.2 (+RSS monitoring)"

    url_security_mode: str = "strict"  # strict, allowlist, off
    url_allowed_hosts: tuple[str, ...] = ()
    http_trust_env: bool = False

    def __post_init__(self):
        if self.url_security_mode not in {"strict", "allowlist", "off"}:
            raise ValueError("PULSO_URL_SECURITY_MODE inválido")

    @classmethod
    def from_env(cls):
        load_dotenv(override=False)
        value = os.getenv("DATABASE_URL", "")
        parsed = urlsplit(value)
        if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname:
            raise ValueError("Configurar DATABASE_URL en el servidor")
        if parse_qs(parsed.query).get("sslmode", [""])[0] not in {"require", "verify-ca", "verify-full"}:
            raise ValueError("DATABASE_URL requiere sslmode=require o verificación superior")
        trust = os.getenv("PULSO_HTTP_TRUST_ENV", "false").lower()
        if trust not in {"true", "false"}:
            raise ValueError("PULSO_HTTP_TRUST_ENV debe ser true o false")
        return cls(database_url=value,
            url_security_mode=os.getenv("PULSO_URL_SECURITY_MODE", "strict"),
            url_allowed_hosts=tuple(h.strip().lower() for h in os.getenv("PULSO_URL_ALLOWED_HOSTS", "").split(",") if h.strip()),
            http_trust_env=trust == "true")
