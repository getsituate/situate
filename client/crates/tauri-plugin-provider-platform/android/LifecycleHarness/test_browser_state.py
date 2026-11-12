import unittest
import xml.etree.ElementTree as ET

from browser_state import browser_state


class BrowserStateTests(unittest.TestCase):
    def test_empty_startup_tree_is_not_a_ready_browser(self):
        nodes = ET.fromstring('<hierarchy><node package="com.android.chrome" text="" /></hierarchy>')
        self.assertEqual(browser_state(nodes), "loading")

    def test_first_run_title_without_footer_is_not_ready(self):
        nodes = ET.fromstring('<hierarchy><node text="Make Chrome your own" /></hierarchy>')
        self.assertEqual(browser_state(nodes), "loading")

    def test_terms_take_precedence_over_browser_toolbar(self):
        nodes = ET.fromstring('<hierarchy><node resource-id="com.android.chrome:id/url_bar" /><node text="By continuing, you agree to the Terms of Service." /></hierarchy>')
        self.assertEqual(browser_state(nodes), "terms")

    def test_loaded_toolbar_without_terms_is_ready(self):
        nodes = ET.fromstring('<hierarchy><node resource-id="com.android.chrome:id/url_bar" /></hierarchy>')
        self.assertEqual(browser_state(nodes), "ready")


if __name__ == "__main__":
    unittest.main()
