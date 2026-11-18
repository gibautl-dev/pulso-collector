"""Costos a partir de usage de la API y precios públicos vigentes de OpenAI.

Precios verificados el 2026-11-18 en:
https://developers.openai.com/api/docs/pricing
https://developers.openai.com/api/docs/models/chat-latest

No inventar tarifas. Si aparece un modelo sin precio cargado, el costo de
tokens queda en null y se informa en `unknown_models`.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

PRICING_SOURCE = "https://developers.openai.com/api/docs/pricing"
PRICING_CHECKED_ON = "2026-11-18"
# USD por 1M tokens (contexto corto / estándar).
MODEL_PRICES_USD_PER_MILLION = {
    "chat-latest": {"input": Decimal("5.00"), "cached_input": Decimal("0.50"), "output": Decimal("30.00")},
    "gpt-6-luna": {"input": Decimal("0.10"), "cached_input": Decimal("0.01"), "output": Decimal("0.50")},
}
# Web search (incl. images): USD 10.00 / 1k calls + tokens de contenido al precio del modelo.
WEB_SEARCH_USD_PER_CALL = Decimal("10.00") / Decimal("1000")
CENTS = Decimal("0.000001")


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def model_rates(model: str) -> dict[str, Decimal] | None:
    if model in MODEL_PRICES_USD_PER_MILLION:
        return MODEL_PRICES_USD_PER_MILLION[model]
    # A veces la API devuelve un snapshot con sufijo de fecha.
    for name, rates in MODEL_PRICES_USD_PER_MILLION.items():
        if model.startswith(name):
            return rates
    return None


def tokens_from_usage(usage: dict | None) -> dict[str, int]:
    usage = usage or {}
    input_tokens = int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
    output_tokens = int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)
    details = usage.get("input_tokens_details") or {}
    cached = int(details.get("cached_tokens") or usage.get("cached_tokens") or 0)
    if cached > input_tokens:
        cached = input_tokens
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cached_input_tokens": cached,
        "uncached_input_tokens": input_tokens - cached,
    }


def cost_for_usage(model: str, usage: dict | None, web_search_calls: int = 0) -> dict:
    rates = model_rates(model)
    counts = tokens_from_usage(usage)
    search_calls = max(0, int(web_search_calls or 0))
    search_cost = _money(WEB_SEARCH_USD_PER_CALL * search_calls)
    if rates is None:
        return {
            **counts,
            "web_search_calls": search_calls,
            "token_cost_usd": None,
            "web_search_cost_usd": float(search_cost),
            "cost_usd": None,
            "unknown_model": True,
            "model": model,
        }
    token_cost = (
        rates["input"] * counts["uncached_input_tokens"]
        + rates["cached_input"] * counts["cached_input_tokens"]
        + rates["output"] * counts["output_tokens"]
    ) / Decimal("1000000")
    token_cost = _money(token_cost)
    total = _money(token_cost + search_cost)
    return {
        **counts,
        "web_search_calls": search_calls,
        "token_cost_usd": float(token_cost),
        "web_search_cost_usd": float(search_cost),
        "cost_usd": float(total),
        "unknown_model": False,
        "model": model,
    }


def sum_costs(items: list[dict]) -> dict:
    total = Decimal("0")
    token_cost = Decimal("0")
    search_cost = Decimal("0")
    unknown = False
    input_tokens = output_tokens = cached = uncached = search_calls = 0
    for item in items:
        input_tokens += int(item.get("input_tokens") or 0)
        output_tokens += int(item.get("output_tokens") or 0)
        cached += int(item.get("cached_input_tokens") or 0)
        uncached += int(item.get("uncached_input_tokens") or 0)
        search_calls += int(item.get("web_search_calls") or 0)
        if item.get("cost_usd") is None or item.get("unknown_model"):
            unknown = True
            continue
        total += Decimal(str(item["cost_usd"]))
        token_cost += Decimal(str(item.get("token_cost_usd") or 0))
        search_cost += Decimal(str(item.get("web_search_cost_usd") or 0))
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cached_input_tokens": cached,
        "uncached_input_tokens": uncached,
        "web_search_calls": search_calls,
        "token_cost_usd": None if unknown else float(_money(token_cost)),
        "web_search_cost_usd": float(_money(search_cost)),
        "cost_usd": None if unknown else float(_money(total)),
        "unknown_models": unknown,
        "pricing_source": PRICING_SOURCE,
        "pricing_checked_on": PRICING_CHECKED_ON,
    }


def monthly_projection(daily_cost_usd: float | None, days: int = 30) -> float | None:
    if daily_cost_usd is None:
        return None
    return float(_money(Decimal(str(daily_cost_usd)) * days))
