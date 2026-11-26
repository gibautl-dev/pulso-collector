"""Alertas de contradicciones: una declaración nueva del candidato (o una nota que
señala un cambio de postura) contra algo que dijo antes sobre el mismo tema.

La extracción de declaraciones y el armado de pares son deterministas (Python).
El modelo solo juzga pares ya armados, redacta el porqué y cita por referencia
(s1, s2…). Las citas que se muestran salen siempre de las menciones, nunca del
modelo. Nada se publica ni se responde solo: cada alerta la revisa una persona.
"""

PROMPT_VERSION = "inconsistency-v2"
