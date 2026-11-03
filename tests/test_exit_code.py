import unittest
from pulso.collect_rss import run_exit_code
from pulso.models import FetchResult

class ExitCodeTests(unittest.TestCase):
    def test_all_ok(self):
        self.assertEqual(run_exit_code([FetchResult(feeds_ok=1,feeds_total=1),FetchResult(feeds_ok=10,feeds_total=10)]),0)
    def test_partial_feed_failure_is_ok(self):
        self.assertEqual(run_exit_code([FetchResult(feeds_ok=1,feeds_total=1),
                                        FetchResult(feeds_ok=9,feeds_total=10,errors=['feed_9: HTTPStatusError'])]),0)
    def test_whole_source_failure(self):
        self.assertEqual(run_exit_code([FetchResult(feeds_ok=1,feeds_total=1),
                                        FetchResult(feeds_ok=0,feeds_total=10,errors=['feed_0: X'])]),1)
    def test_adapter_exception(self):
        self.assertEqual(run_exit_code([FetchResult(errors=['RuntimeError'])]),1)
    def test_no_feeds_configured(self):
        self.assertEqual(run_exit_code([FetchResult(errors=['no_feeds_configured'])]),1)
    def test_everything_fails(self):
        self.assertEqual(run_exit_code([FetchResult(errors=['a']),FetchResult(errors=['b'])]),1)
    def test_no_sources(self):
        self.assertEqual(run_exit_code([]),0)
