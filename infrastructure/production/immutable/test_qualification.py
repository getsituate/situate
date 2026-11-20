import importlib.util
import io
from contextlib import redirect_stderr
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('github_rehearsal', Path(__file__).with_name('github-rehearsal.py'))
rehearsal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rehearsal)


class QualificationTest(unittest.TestCase):
    def test_action_failure_reports_only_the_id_command_and_error_code(self):
        cloud = rehearsal.Cloud('unused', 'sit-prod-42-1')
        data = {'id': 42, 'status': 'error', 'command': 'create_server',
                'error': {'code': 'resource_unavailable', 'message': 'private provider data'}}
        with patch.object(cloud, 'call', return_value={'action': data}) as call:
            with self.assertRaisesRegex(rehearsal.RehearsalError,
                                        r'^Hetzner action 42 \(create_server\) failed: resource_unavailable\.$'):
                cloud.wait_action({'id': 42})
            call.assert_called_once_with('GET', 'actions/42')

    def test_reporting_cleanup_failure_preserves_an_earlier_rehearsal_error(self):
        cloud = rehearsal.Cloud('unused', 'sit-prod-42-1')
        output = io.StringIO()
        with patch.object(cloud, 'preflight'), patch.object(
                cloud, 'cleanup', side_effect=rehearsal.RehearsalError('cleanup failed')), patch.object(
                rehearsal, 'exercise', side_effect=rehearsal.RehearsalError('provisioning failed')):
            with redirect_stderr(output), self.assertRaisesRegex(rehearsal.RehearsalError, 'provisioning failed'):
                rehearsal.qualify(cloud, 'a' * 40)
        self.assertIn('Rehearsal cleanup not verified for rehearsal=sit-prod-42-1: cleanup failed', output.getvalue())

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
