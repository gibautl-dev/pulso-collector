"""Cliente de la Responses API de OpenAI, con búsqueda web opcional.

No usa el SDK oficial: httpx, como el clasificador. Nunca loguea la clave ni
el encabezado Authorization. Si el modelo no admite web_search, el llamador
puede reintentar sin la herramienta.
"""
from __future__ import annotations

import json
import time
from typing import Callable
from urllib.parse import urlparse

import httpx

SYSTEM_INSTRUCTIONS = (
    "Sos un asistente informativo. Respondé en español rioplatense, de forma "
    "clara, precisa y equilibrada, como a un votante que quiere informarse. "
    "No hagas campaña a favor ni en contra. Si usás información de la web, "
    "citá las fuentes. No inventes URLs ni hechos."
)


class VisibilityError(Exception):
    """Error sin secretos; `kind` es seguro para loguear."""

    def __init__(self, kind: str, status: int | None = None, retryable: bool = False,
                 tool_unsupported: bool = False):
        super().__init__(kind)
        self.kind = kind
        self.status = status
        self.retryable = retryable
        self.tool_unsupported = tool_unsupported


def _looks_like_tool_unsupported(status: int, body: dict | None) -> bool:
    if status not in (400, 404, 422):
        return False
    text = json.dumps(body or {}, ensure_ascii=False).lower()
    needles = ("web_search", "tool", "not supported", "unsupported", "unknown tool",
               "invalid tool", "does not support")
    return any(n in text for n in needles)


def extract_output_text(payload: dict) -> str:
    if isinstance(payload.get("output_text"), str) and payload["output_text"].strip():
        return payload["output_text"].strip()
    parts: list[str] = []
    for item in payload.get("output") or []:
        if not isinstance(item, dict) or item.get("type") not in {None, "message"}:
            continue
        for block in item.get("content") or []:
            if not isinstance(block, dict):
                continue
            text = block.get("text")
            if isinstance(text, str) and text.strip():
                parts.append(text.strip())
    return "\n\n".join(parts).strip()


def extract_citations(payload: dict) -> list[dict]:
    seen: set[str] = set()
    citations: list[dict] = []

    def add(url: str | None, title: str | None = None, source: str = "annotation"):
        if not url or not isinstance(url, str):
            return
        url = url.strip()
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return
        if url in seen:
            return
        seen.add(url)
        citations.append({"url": url, "title": (title or "").strip() or None, "source": source})

    for item in payload.get("output") or []:
        if not isinstance(item, dict):
            continue
        if item.get("type") in {None, "message"}:
            for block in item.get("content") or []:
                if not isinstance(block, dict):
                    continue
                for ann in block.get("annotations") or []:
                    if not isinstance(ann, dict):
                        continue
                    url = ann.get("url") or (ann.get("url_citation") or {}).get("url")
                    title = ann.get("title") or (ann.get("url_citation") or {}).get("title")
                    if ann.get("type") in {"url_citation", "citation", None} or url:
                        add(url, title, "annotation")
        if item.get("type") == "web_search_call":
            action = item.get("action") or {}
            for src in action.get("sources") or []:
                if isinstance(src, dict):
                    add(src.get("url") or src.get("link"), src.get("title") or src.get("name"),
                        "web_search_source")
            for result in item.get("results") or []:
                if isinstance(result, dict):
                    add(result.get("url") or result.get("link"),
                        result.get("title") or result.get("name"), "web_search_result")
    return citations


def count_web_search_calls(payload: dict) -> int:
    n = 0
    for item in payload.get("output") or []:
        if isinstance(item, dict) and item.get("type") == "web_search_call":
            n += 1
    return n


class ResponsesClient:
    def __init__(self, settings, transport: httpx.BaseTransport | None = None,
                 sleep: Callable[[float], None] = time.sleep):
        self.settings, self.sleep = settings, sleep
        self.http = httpx.Client(
            base_url=settings.base_url,
            transport=transport,
            trust_env=False,
            timeout=httpx.Timeout(settings.request_timeout, connect=10.0),
            headers={"Authorization": f"Bearer {settings.api_key}"},
        )

    def close(self):
        self.http.close()

    def ask(self, prompt: str, use_web_search: bool | None = None) -> dict:
        use_web = self.settings.use_web_search if use_web_search is None else use_web_search
        body: dict = {
            "model": self.settings.ask_model,
            "instructions": SYSTEM_INSTRUCTIONS,
            "input": prompt,
        }
        if use_web:
            body["tools"] = [{
                "type": "web_search",
                "user_location": {
                    "type": "approximate",
                    "country": "AR",
                    "city": "Buenos Aires",
                    "region": "Buenos Aires",
                },
            }]
            body["include"] = ["web_search_call.action.sources"]
        payload = self._complete(body)
        answer = extract_output_text(payload)
        if not answer:
            raise VisibilityError("empty_answer")
        model = payload.get("model") or self.settings.ask_model
        usage = payload.get("usage") or {}
        citations = extract_citations(payload)
        search_calls = count_web_search_calls(payload)
        return {
            "provider": "openai",
            "model": model,
            "used_web_search": bool(use_web) and search_calls > 0,
            "web_search_requested": bool(use_web),
            "web_search_calls": search_calls,
            "prompt": prompt,
            "answer": answer,
            "citations": citations,
            "usage": {
                "input_tokens": int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0),
                "output_tokens": int(usage.get("output_tokens") or usage.get("completion_tokens") or 0),
                "total_tokens": int(usage.get("total_tokens") or 0),
                "input_tokens_details": usage.get("input_tokens_details") or {},
                "output_tokens_details": usage.get("output_tokens_details") or {},
            },
        }

    def _complete(self, body: dict) -> dict:
        attempt = 0
        while True:
            try:
                return self._once(body)
            except VisibilityError as exc:
                if not exc.retryable or attempt >= self.settings.max_retries:
                    raise
                delay = getattr(exc, "retry_after", None) or min(2 ** attempt * 2, 30)
                attempt += 1
                self.sleep(min(float(delay), 30.0))

    def _once(self, body: dict) -> dict:
        try:
            response = self.http.post("/responses", json=body)
        except httpx.TimeoutException:
            raise VisibilityError("timeout", retryable=True)
        except httpx.TransportError:
            raise VisibilityError("transport_error", retryable=True)
        data = _safe_json(response)
        if response.status_code == 429 or response.status_code >= 500:
            exc = VisibilityError("http_error", response.status_code, retryable=True)
            try:
                exc.retry_after = float(response.headers.get("retry-after", ""))
            except ValueError:
                exc.retry_after = None
            raise exc
        if response.status_code in (401, 403):
            raise VisibilityError("auth_error", response.status_code)
        if response.status_code >= 400:
            raise VisibilityError(
                "http_error",
                response.status_code,
                tool_unsupported=_looks_like_tool_unsupported(response.status_code, data),
            )
        if not isinstance(data, dict):
            raise VisibilityError("bad_response", retryable=True)
        return data


def _safe_json(response: httpx.Response) -> dict | None:
    try:
        data = response.json()
    except ValueError:
        return None
    return data if isinstance(data, dict) else None
