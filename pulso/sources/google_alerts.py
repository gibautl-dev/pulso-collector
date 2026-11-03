from .rss_media import RSSSource
from ..models import SourceName

class GoogleAlertsSource(RSSSource):
    def __init__(self,settings):
        super().__init__(SourceName.ALERTS,settings)
