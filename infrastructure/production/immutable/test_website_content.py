from base64 import b64encode
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import website
import website_content as delivery


class WebsiteContentTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.site = self.root / 'website'
        (self.site / 'versions').mkdir(parents=True)
        self.build = self.root / 'build'
        self.build.mkdir()
        self.index = self.build / 'index.html'
        self.index.write_text('initial')
        self.initial = website.fingerprint(self.build)
        website.activate(self.site, self.initial, self.build, seed=True)
        self.feed = self.root / 'distribution' / 'update.json'
        self.feed.parent.mkdir()
        self.feed.write_text('unchanged')

    def publish(self, body, decision):
        self.index.write_text(body)
        receipts = []
        delivery.serve(self.site, delivery.package(self.build), receipts.append, decision)
        return receipts

    def test_publish_and_noop_use_existing_content_address(self):
        self.assertEqual(self.publish('initial', lambda: self.fail()), [{'unchanged': self.initial}])
        receipt = self.publish('updated', lambda: True)
        self.assertEqual(receipt, [{'pending': website.fingerprint(self.build)}, {'complete': True}])
        self.assertEqual((self.site / 'current/index.html').read_text(), 'updated')
        self.assertEqual(self.feed.read_text(), 'unchanged')

    def test_explicit_rejection_restores_the_previous_website_only(self):
        def reject():
            self.assertEqual((self.site / 'current/index.html').read_text(), 'wrong')
            self.assertTrue((self.site / 'website.pending').is_file())
            return False

        self.assertEqual(self.publish('wrong', reject)[-1], {'complete': False})
        self.assertEqual(website.settled(self.site), self.initial)
        self.assertEqual(self.feed.read_text(), 'unchanged')

    def test_private_receiver_umask_keeps_nested_public_assets_readable(self):
        assets = self.build / 'assets'
        assets.mkdir()
        (assets / 'style.css').write_text('body {}')

        def accept():
            self.assertEqual(stat.S_IMODE((self.site / 'website.pending').stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE((self.site / 'current/assets').stat().st_mode), 0o755)
            self.assertEqual(stat.S_IMODE((self.site / 'current/assets/style.css').stat().st_mode), 0o644)
            return True

        mask = os.umask(0o077)
        try:
            self.assertEqual(self.publish('updated', accept)[-1], {'complete': True})
        finally:
            os.umask(mask)

    def test_publication_key_is_readable_only_by_owner_and_service_group(self):
        path = self.root / 'authorized_keys'
        public_key = 'ssh-ed25519 ' + 'A' * 68
        with patch.object(delivery, 'KEY_FILE', path), patch.object(delivery.os, 'geteuid', return_value=0), patch.object(
                delivery.pwd, 'getpwnam', return_value=SimpleNamespace(pw_gid=123)) as lookup, patch.object(
                delivery.os, 'fchown') as ownership:
            delivery.install_key(public_key)
            lookup.assert_called_once_with('situate-website')
            self.assertEqual(ownership.call_args.args[1:], (-1, 123))
            with self.assertRaises(FileExistsError):
                delivery.install_key(public_key)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o640)
        self.assertEqual(path.read_text(), f'restrict,command="/usr/local/lib/situate/website-ssh.sh" {public_key}\n')

    def test_lost_confirmation_preserves_pending_evidence(self):
        with self.assertRaisesRegex(ValueError, 'No website decision'):
            self.publish('uncertain', lambda: None)
        with self.assertRaisesRegex(ValueError, 'unresolved'):
            self.publish('retry', lambda: True)

    def test_delivery_excludes_app_paths_and_shell_artifacts(self):
        for path in ('../other.html', '/root.html', 'releases/current/update.json',
                     'healthz/index.html', 'server.py'):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'static website namespace'):
                delivery.unpack({'index.html': 'eA==', path: b64encode(b'test').decode()}, self.root / 'unpacked')
        self.assertEqual(website.settled(self.site), self.initial)

    def test_package_rejects_symlinks(self):
        (self.build / 'feed.txt').symlink_to(self.feed)
        with self.assertRaisesRegex(ValueError, 'linked file'):
            delivery.package(self.build)
