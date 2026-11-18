# Biblioteca de anuncios de Meta

Propuesta para consultar la [Ad Library API](https://www.facebook.com/ads/library/api/) y guardar quién pauta sobre el candidato (Facebook e Instagram, Argentina): gasto e impresiones en rangos, demografía, regiones y fechas.

**La migración `deploy/meta_ads.sql` no está aplicada.** No habilitar el cron (`PULSO_META_ADS_ENABLED=true`) hasta aplicarla y cargar el token. Sin token no hay dry-run real: no se inventan anuncios ni se scrapea [la Biblioteca web](https://www.facebook.com/ads/library/).

La web de la Biblioteca se puede mirar a mano en el navegador. La API documentada (`GET /{version}/ads_archive` en `graph.facebook.com`) lleva `access_token` en todos los ejemplos oficiales. No hay un endpoint público documentado sin token.

## Por qué una tabla propia

No va en `mentions`. Un anuncio trae rangos de gasto e impresiones, moneda, demografía, regiones, “pagado por” (`bylines`) y un `ad_snapshot_url`. Eso no es una mención periodística. La tabla `meta_ads` deduplica por `(candidate_id, ad_id)`.

## Pasos para Leandro (acceso)

Fuentes: [Ad Library API](https://www.facebook.com/ads/library/api/), [ads_archive](https://developers.facebook.com/docs/graph-api/reference/ads_archive/), [Archived Ad](https://developers.facebook.com/docs/graph-api/reference/archived-ad/), [tokens de larga duración](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived). Graph API actual en esas páginas: **v27.0**.

1. **Confirmar identidad y ubicación.** En [facebook.com/ID](https://www.facebook.com/ID), el mismo proceso que para pautar anuncios sobre temas sociales, elecciones o política. Puede tardar unos días.
2. **Cuenta de Meta for Developers.** En [developers.facebook.com](https://developers.facebook.com/) → Get started, aceptando la [Platform Policy](https://developers.facebook.com/policy/).
3. **Crear una app.** Volver a [la página de la API](https://www.facebook.com/ads/library/api/) y usar *Access the API*, o [My Apps → Create app](https://developers.facebook.com/apps/). Las consultas se hacen en nombre de esa app. La guía oficial de arranque **no pide App Review ni un permiso especial** (como `ads_read`). Si Graph Explorer, después de verificar la identidad, devuelve anuncios, no hace falta un review. Si aparece el error 10, hay que leer el mensaje y no asumir un permiso que las docs no listan.
4. **Token de usuario.** En el [Graph API Explorer](https://developers.facebook.com/tools/explorer/) elegir la app y generar un **user access token**. Los ejemplos oficiales usan `access_token` de alguien autorizado e identificado; un app token no es el camino documentado en esa guía. La persona del token tiene que haber completado el paso 1 y tener rol en la app.
5. **Probar**, por ejemplo:

```sh
curl -G \
  -d "search_terms='Kicillof'" \
  -d "ad_type=POLITICAL_AND_ISSUE_ADS" \
  -d "ad_reached_countries=['AR']" \
  -d "ad_active_status=ALL" \
  -d "fields=id,page_name,bylines,spend,impressions,currency,demographic_distribution,delivery_by_region,ad_snapshot_url,ad_delivery_start_time,ad_delivery_stop_time,publisher_platforms" \
  -d "access_token=TOKEN" \
  "https://graph.facebook.com/v27.0/ads_archive"
```

6. **Pasar a un token de larga duración (~60 días).** El del Explorer suele ser de corta duración. En el servidor (nunca en el cliente, porque viaja el app secret):

```sh
curl -i -X GET "https://graph.facebook.com/v27.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=TOKEN_CORTO"
```

La respuesta trae `access_token` y `expires_in` (segundos). [Documentación](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived). Si el token ya expiró, no se puede canjear: hay que volver a generar uno corto (Explorer o Login) y repetir el canje. Las docs de Facebook Login no describen un refresh automático para un cron en servidor; conviene mirar la fecha en el [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/) y renovar antes de que venza, actualizando `META_ADS_ACCESS_TOKEN` en el cron. No guardar el app secret en el repo.

7. Cuando se apruebe aplicar la SQL y activar: cargar `META_ADS_ACCESS_TOKEN` en el cron `pulso-rss` (sin pegarlo en el chat), opcionalmente los IDs de Página del candidato y de rivales en `meta_ads_settings.search_page_ids` (hasta 10 por pedido), y recién ahí `PULSO_META_ADS_ENABLED=true`.

## Costo

En las páginas oficiales de la Ad Library API y de `ads_archive` **no figura un arancel ni un plan de pago por consulta**. El acceso es con verificación de identidad, una app de desarrollador y un token de usuario. No encontré un cargo oficial. Eso no es lo mismo que un anuncio pago de Meta Ads Manager.

## Límites de uso

`ads_archive` puede devolver el error **613** (se superó el rate limit). El [rate limiting de Graph API](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/) aplica Platform Rate Limits. Con **app token**, la cuenta de la app es `200 * cantidad de usuarios` en una ventana móvil de una hora. Con **user token** (este caso) hay un tope por usuario, pero Meta **no publica el número** por privacidad. El código para ante un 613 y no reintenta en loop. Nuestros topes de paginación (40 páginas / 2.000 anuncios) son propios, no un máximo oficial publicado en las referencias que usé. La paginación oficial termina cuando `data` viene vacío.

Otros límites documentados: `search_terms` de hasta 100 caracteres (el espacio es un AND); `search_page_ids` hasta 10 IDs por request; hace falta `ad_reached_countries` y, además, `search_terms` o `search_page_ids`. Fuera de la UE, la API solo devuelve anuncios sobre temas sociales, elecciones o política.

## Campos (políticos en Argentina)

Con `ad_type=POLITICAL_AND_ISSUE_ADS` y `ad_reached_countries=['AR']` son relevantes, según [Archived Ad](https://developers.facebook.com/docs/graph-api/reference/archived-ad/):

- `id`, `page_id`, `page_name`, `bylines` (quién financió el anuncio)
- `ad_snapshot_url`, textos del creativo (`ad_creative_bodies` y links)
- Fechas: `ad_creation_time`, `ad_delivery_start_time`, `ad_delivery_stop_time` (UTC)
- `publisher_platforms` (p. ej. Facebook, Instagram)
- `currency` (código ISO de la moneda con la que se pagó; no se asume ARS)
- `spend` e `impressions` y `estimated_audience_size`: tipo [InsightsRangeValue](https://developers.facebook.com/docs/graph-api/reference/insights-range-value/) (`lower_bound`, `upper_bound`), no un número exacto
- `demographic_distribution` (edades 18-24 … 65+; género Male, Female, Unknown) y `delivery_by_region` (porcentaje a nivel subnacional)
- `languages`

Rangos de **spend** publicados: `<100`, `100-499`, `500-999`, `1K-5K`, `5K-10K`, `10K-50K`, `50K-100K`, `100K-200K`, `200K-500K`, `>1M`, en `currency`.

Rangos de **impressions** publicados: `<1000`, `1K-5K`, `5K-10K`, `10K-50K`, `50K-100K`, `100K-200K`, `200K-500K`, `>1M`.

No se piden campos que las docs limitan a UE, Reino Unido o Brasil (`target_ages`, `target_gender`, `target_locations`, `eu_total_reach`, `br_total_reach`, `beneficiary_payers`, `age_country_gender_reach_breakdown`, `total_reach_by_location`).

## Cómo corre en Pulso

- Adaptador: `pulso/sources/meta_ads.py`. Job: `python -m pulso.meta_ads`.
- Apagado por defecto (`PULSO_META_ADS_ENABLED`). Una vez por día a partir de las 09:00 (hora de Argentina); se saltea si ya corrió ese día, salvo `--force`.
- Token en `META_ADS_ACCESS_TOKEN`. El recolector, el clasificador y el detector no lo ven.
- Consultas: `search_terms` por defecto `Axel Kicillof` y `Kicillof` (cada una por separado, frase exacta), más `search_page_ids` opcionales; `ad_reached_countries=['AR']`, `ad_active_status=ALL`.
- Dry-run local sin token: `python -m pulso.meta_ads --from-json tests/fixtures/meta_ads_archive.json --dry-run` (datos simulados).
