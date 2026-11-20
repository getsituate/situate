import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('github_rehearsal', Path(__file__).with_name('github-rehearsal.py'))
rehearsal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rehearsal)


class QualificationTest(unittest.TestCase):
    def test_production_cleanup_leaves_live_resources_and_the_qualified_image(self):
        scope = 'sit-prod-42-1'
        scoped = {'rehearsal': scope}
        resources = {
            'servers': [{'id': 1, 'name': 'production', 'labels': {}},
                        {'id': 2, 'name': f'{scope}-new', 'labels': scoped}],
            'images': [{'id': 3, 'description': 'previous-image', 'labels': {}},
                       {'id': 4, 'description': f'{scope}-image', 'labels': scoped}],
        }
        removed = []

        def inventory(kind, scoped=False):
            self.assertTrue(scoped)
            return [entry for entry in resources.get(kind, [])
                    if entry['labels'].get('rehearsal') == scope]

        def drop(kind, rid):
            removed.append((kind, rid))
            resources[kind] = [entry for entry in resources[kind] if entry['id'] != rid]

        cloud = rehearsal.Cloud('unused', scope)
        with patch.object(cloud, 'list', side_effect=inventory), patch.object(cloud, 'drop', side_effect=drop):
            cloud.cleanup(production=True, keep_image=4)
        self.assertEqual(removed, [('servers', 2)])
        self.assertEqual([entry['id'] for entry in resources['images']], [3, 4])

    def test_failed_exercise_does_not_write_a_receipt_or_keep_an_image(self):
        cloud = rehearsal.Cloud('unused', 'sit-prod-42-1')
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / 'qualification.json'
            with patch.object(cloud, 'preflight') as preflight, patch.object(cloud, 'cleanup') as cleanup, patch.object(
                    rehearsal, 'exercise', side_effect=rehearsal.RehearsalError('failed')):
                with self.assertRaises(rehearsal.RehearsalError):
                    rehearsal.qualify(cloud, 'a' * 40, receipt)
            preflight.assert_called_once_with(production=True)
            cleanup.assert_called_once_with(production=True, keep_image=None)
            self.assertFalse(receipt.exists())
