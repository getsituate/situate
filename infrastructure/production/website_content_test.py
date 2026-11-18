import base64
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import website_content as delivery


def bundle(run, text, sha=None):
    return {'run': run, 'sha': sha or format(run, '040x'), 'files': {
        'index.html': base64.b64encode(text.encode()).decode(),
    }}


class WebsiteContentTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.responses = []

    def publish(self, run, text, decision='commit'):
        self.responses.clear()
        delivery.publish(self.root, bundle(run, text), self.responses.append, lambda: decision)
        return self.responses[0]

    def home(self):
        return (self.root / 'current/index.html').read_text()

    def test_publish_skip_and_reject_stale_runs(self):
        first = self.publish(10, 'first')['revision']
        self.assertEqual(self.home(), 'first')
        self.assertEqual(self.publish(13, 'first'), {'status': 'unchanged', 'revision': first})
        self.assertEqual(self.publish(12, 'older'), {'status': 'superseded'})
        with self.assertRaisesRegex(ValueError, 'already recorded'):
            self.publish(13, 'different')
        latest = self.publish(14, 'current')['revision']
        self.assertEqual(self.home(), 'current')
        self.assertEqual(delivery.state_at(self.root)['previous'], first)
        self.assertEqual(delivery.state_at(self.root)['active'], latest)

    def test_rollback_preserves_previous(self):
        first = self.publish(10, 'first')['revision']
        second = self.publish(11, 'second')['revision']
        self.publish(12, 'failed', 'rollback')
        self.assertEqual(self.home(), 'second')
        self.assertEqual(delivery.current(self.root), second)
        self.assertEqual(delivery.state_at(self.root)['previous'], first)
        self.assertEqual(self.publish(11, 'second'), {'status': 'superseded'})

    def test_first_rollback_reverts_to_bootstrap_site(self):
        self.publish(10, 'failed', 'rollback')
        self.assertIsNone(delivery.current(self.root))
        self.publish(11, 'first')
        self.assertEqual(self.home(), 'first')

    def test_unacknowledged_activation_retains_recovery_state(self):
        self.publish(10, 'first')
        with self.assertRaisesRegex(ValueError, 'cannot be confirmed'):
            self.publish(11, 'unconfirmed', None)
        self.assertEqual(self.home(), 'unconfirmed')
        with self.assertRaisesRegex(ValueError, 'unresolved'):
            self.publish(12, 'blocked')
        state = delivery.state_at(self.root)
        self.assertEqual(delivery.current(self.root), state['pending']['to'])
        delivery.finish(self.root, state, 'rollback')
        self.assertEqual(self.home(), 'first')
        self.publish(12, 'next')
        self.assertEqual(self.home(), 'next')

    def test_same_commit_can_publish_new_build_configuration(self):
        first = bundle(10, 'first')
        delivery.publish(self.root, first, self.responses.append, lambda: 'commit')
        delivery.publish(self.root, bundle(11, 'next', first['sha']), self.responses.append, lambda: 'commit')
        self.assertEqual(self.home(), 'next')

    def test_public_check_requires_exact_page_and_revision_bytes(self):
        _, manifest, _ = delivery.unpack(bundle(10, 'first'))
        revision = self.publish(10, 'first')['revision']
        responses = {'/': (200, b'first'), '/' + delivery.MARKER: (200, (revision + '\n').encode())}
        with patch.object(delivery, 'get', side_effect=responses.__getitem__):
            self.assertTrue(delivery.check_public(manifest, revision))
            responses['/'] = (200, b'other')
            self.assertFalse(delivery.check_public(manifest, revision))

    def test_upload_cannot_write_outside_static_namespace(self):
        self.publish(10, 'first')
        for name in ['../index.html', '.state.json', 'extra/.hidden.html', '/index.html',
                     'releases/current/download.json', 'website-revision.txt', 'index.php', 'nginx.conf']:
            with self.subTest(name=name):
                value = bundle(11, 'external')
                value['files'][name] = 'YWJj'
                with self.assertRaisesRegex(ValueError, 'Unsupported path'):
                    delivery.publish(self.root, value, self.responses.append, lambda: 'commit')
        self.assertEqual(self.home(), 'first')
        self.assertIsNone(delivery.state_at(self.root)['pending'])

    def test_packaging_rejects_symlinks(self):
        (self.root / 'index.html').symlink_to('/etc/passwd')
        with self.assertRaisesRegex(ValueError, 'non-regular'):
            delivery.package(self.root, 'a' * 40, 1)


if __name__ == '__main__':
    unittest.main()
