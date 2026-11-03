from enum import StrEnum
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, AwareDatetime, field_validator
from .urls import normalize_url, url_hash

class SourceName(StrEnum):
    RSS = "rss_media"
    NEWS = "google_news"
    ALERTS = "google_alerts"

class Candidate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: UUID
    slug: str
    name: str
    keywords: list[str] = Field(min_length=1)
    exclude_keywords: list[str] = Field(default_factory=list)
    alert_feeds: list[str] = Field(default_factory=list)
    own_accounts: dict = Field(default_factory=dict)
    reference_accounts: dict = Field(default_factory=dict)

class SourceConfig(BaseModel):
    candidate_id: UUID
    source: str
    enabled: bool
    interval_seconds: int = Field(ge=60)
    settings: dict = Field(default_factory=dict)
    cursor: dict = Field(default_factory=dict)

    @field_validator("settings")
    @classmethod
    def validate_settings(cls, value):
        for key in ("feeds", "own_domains", "reference_domains"):
            if key in value and (not isinstance(value[key], list) or
                                  any(not isinstance(v,str) for v in value[key])):
                raise ValueError(f"{key} debe ser una lista de textos")
        return value

class Mention(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate_id: UUID
    source: SourceName
    source_item_id: str | None = None
    url: str
    title: str = ""
    content: str = ""
    author: str | None = None
    author_handle: str | None = None
    outlet: str | None = None
    published_at: AwareDatetime
    metrics: dict = Field(default_factory=dict)
    lang: str | None = None
    account_relation: str = "third_party"

    @field_validator("url")
    @classmethod
    def canonical_url(cls, value):
        return normalize_url(value)

    @property
    def url_hash(self):
        return url_hash(self.url)

    @field_validator("account_relation")
    @classmethod
    def relation(cls, value):
        if value not in {"third_party", "own", "reference"}:
            raise ValueError("Invalid account relation")
        return value

class FetchResult(BaseModel):
    mentions: list[Mention] = Field(default_factory=list)
    cursor: dict = Field(default_factory=dict)
    errors: list[str] = Field(default_factory=list)
    feeds_ok: int = 0
    feeds_total: int = 0
    skipped_entries: int = 0
