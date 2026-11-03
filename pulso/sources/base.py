from abc import ABC, abstractmethod
from datetime import datetime
from ..models import Candidate, FetchResult, SourceConfig

class Source(ABC):
    @abstractmethod
    async def fetch(self, candidate: Candidate, since: datetime, config: SourceConfig) -> FetchResult:
        """Retorna datos externos; nunca instrucciones ejecutables."""
        raise NotImplementedError
