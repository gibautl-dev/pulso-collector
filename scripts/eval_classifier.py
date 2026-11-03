"""Evalúa el clasificador contra las 97 menciones etiquetadas a mano (eval/labeled_mentions.jsonl).

Las 13 menciones usadas como few-shot (pulso/ai/fewshot.json) están excluidas del set.

Modos:
  --baseline                 Sin clave: puntúa una línea base (clase mayoritaria) para referencia.
  --predictions FILE.jsonl   Sin clave: puntúa predicciones guardadas ({"id", "tone", "target", "topic", "relevance"}).
  (por defecto)              Con LLM_API_KEY: llama al modelo (LLM_MODEL/LLM_BASE_URL), guarda
                             predicciones en eval/out/ y las puntúa. No toca la base de datos.
"""
import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pulso.ai import classifier as C  # noqa: E402

FIELDS = ("tone", "target", "topic", "relevance")
TOPICS = ["agenda institucional", "economía", "educación", "elecciones 2027", "gestión provincial",
          "interna peronista", "justicia", "otros", "relación con Nación", "salud"]


def load(path):
    return [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]


def score(gold, preds):
    pred = {p["id"]: p for p in preds}
    report = {"n_gold": len(gold), "n_predicted": sum(g["id"] in pred for g in gold)}
    for f in FIELDS:
        hits = [pred[g["id"]][f] == g["label"][f] for g in gold if g["id"] in pred]
        report[f"{f}_accuracy"] = round(sum(hits) / len(hits), 3) if hits else None
    per = {}
    for t in C.TONES:
        tp = sum(1 for g in gold if g["id"] in pred and g["label"]["tone"] == t and pred[g["id"]]["tone"] == t)
        fp = sum(1 for g in gold if g["id"] in pred and g["label"]["tone"] != t and pred[g["id"]]["tone"] == t)
        fn = sum(1 for g in gold if g["id"] in pred and g["label"]["tone"] == t and pred[g["id"]]["tone"] != t)
        if tp + fp + fn:
            p = tp / (tp + fp) if tp + fp else 0.0
            r = tp / (tp + fn) if tp + fn else 0.0
            per[t] = {"precision": round(p, 3), "recall": round(r, 3), "support": tp + fn}
    report["tone_per_class"] = per
    # Lo que más importa para el producto: críticas/ataques dirigidos al candidato.
    neg = {"critica", "insulto", "acusacion"}
    is_neg = lambda l: l["tone"] in neg and l["target"] == "candidate"
    g_neg = [g for g in gold if g["id"] in pred and is_neg(g["label"])]
    p_neg = [g for g in gold if g["id"] in pred and is_neg(pred[g["id"]])]
    report["negative_to_candidate"] = {
        "gold": len(g_neg), "predicted": len(p_neg),
        "recall": round(sum(is_neg(pred[g["id"]]) for g in g_neg) / len(g_neg), 3) if g_neg else None,
        "precision": round(sum(is_neg(g["label"]) for g in p_neg) / len(p_neg), 3) if p_neg else None}
    report["tone_confusion"] = dict(Counter(f"{g['label']['tone']}->{pred[g['id']]['tone']}"
                                            for g in gold if g["id"] in pred
                                            and g["label"]["tone"] != pred[g["id"]]["tone"]))
    return report


def baseline(gold):
    common = {f: Counter(g["label"][f] for g in gold).most_common(1)[0][0] for f in FIELDS}
    return [{"id": g["id"], **common} for g in gold]


def live(gold, out_dir, batch_size):
    s = C.ClassifierSettings(
        database_url="unused", api_key=os.environ["LLM_API_KEY"],
        base_url=(os.getenv("LLM_BASE_URL") or C.DEFAULT_BASE_URL).rstrip("/"),
        model=os.getenv("LLM_MODEL") or C.DEFAULT_MODEL,
        reasoning_effort=os.getenv("LLM_REASONING_EFFORT", "none") or None,
        request_timeout=float(os.getenv("LLM_TIMEOUT_SECONDS", "45")))
    client = C.LLMClient(s)
    topic_ids = {t: t for t in TOPICS}
    preds, usage = [], Counter()
    try:
        for i in range(0, len(gold), batch_size):
            chunk = gold[i:i + batch_size]
            try:
                labels, problems, u, _ = C.classify_batch(client, "Axel Kicillof", topic_ids, chunk, C.load_fewshot())
            except C.ClassifierError as exc:
                print(json.dumps({"batch": i, "error": exc.kind, "status": exc.status}), file=sys.stderr)
                continue
            usage.update({k: v for k, v in u.items() if isinstance(v, int)})
            for mid, l in labels.items():
                preds.append({"id": mid, "tone": l["tone"], "target": l["target"], "topic": l["topic"],
                              "relevance": l["relevance"], "confidence": l["tone_confidence"],
                              "reason": l["tone_reason"]})
    finally:
        client.close()
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"predictions-{s.model}-{C.PROMPT_VERSION}.jsonl"
    path.write_text("".join(json.dumps(p, ensure_ascii=False) + "\n" for p in preds), encoding="utf-8")
    return preds, dict(usage), path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gold", default=ROOT / "eval" / "labeled_mentions.jsonl")
    ap.add_argument("--predictions")
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--batch-size", type=int, default=10)
    a = ap.parse_args()
    gold = load(a.gold)
    extra = {}
    if a.baseline:
        preds, extra["mode"] = baseline(gold), "baseline_mayoritaria"
    elif a.predictions:
        preds, extra["mode"] = load(a.predictions), "predicciones_guardadas"
    else:
        if not os.getenv("LLM_API_KEY"):
            ap.error("Falta LLM_API_KEY; usar --baseline o --predictions para modo sin clave")
        preds, usage, path = live(gold, ROOT / "eval" / "out", a.batch_size)
        extra.update(mode="modelo", model=os.getenv("LLM_MODEL") or C.DEFAULT_MODEL,
                     prompt_version=C.PROMPT_VERSION, usage=usage, predictions=str(path))
    print(json.dumps({**extra, **score(gold, preds)}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
