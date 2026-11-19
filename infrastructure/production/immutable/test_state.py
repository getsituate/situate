import fcntl
import hashlib
import os
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import website


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


verify = load('verify', Path(__file__).with_name('verify-state.py'))
freeze_release = load('freeze_release', Path(__file__).with_name('freeze-release.py'))
release = load('release', Path(__file__).resolve().parents[2] / 'releases/remote.py')


def dump(path, data):
    path.write_text(json.dumps(data))


class StateTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.site = self.root / 'website'
        (self.site / 'versions').mkdir(parents=True)
        self.dist = self.root / 'distribution'
        (self.dist / 'releases').mkdir(parents=True)
        self.dist.chmod(0o755)

    def test_freeze_refuses_busy_or_aliased_release_lock(self):
        lock = self.dist / 'release.lock'
        commands = []
        def run(args, *, check):
            self.assertTrue(check)
            commands.append(args)

        with lock.open('w') as held:
            fcntl.flock(held, fcntl.LOCK_EX)
            with self.assertRaises(BlockingIOError):
                freeze_release.freeze(self.dist, uid=os.getuid(), run=run)
        self.assertEqual(commands, [])
        freeze_release.freeze(self.dist, uid=os.getuid(), run=run)
        self.assertEqual(commands[0][-1], self.dist)
        lock.unlink()
        lock.symlink_to(self.dist / 'other')
        with self.assertRaises(OSError):
            freeze_release.freeze(self.dist, uid=os.getuid(), run=run)
        self.assertEqual(len(commands), 1)

    def source(self, name):
        path = self.root / name
        path.mkdir()
        (path / 'index.html').write_text(name)
        return path, website.fingerprint(path)

    def publish_fixture(self, version):
        release_path = self.dist / 'releases' / version
        meta = release_path / 'metadata'
        meta.mkdir(parents=True)
        def file(name, contents):
            data = contents.encode()
            (release_path / name).write_bytes(data)
            return dict(path=name, size=len(data), sha256=hashlib.sha256(data).hexdigest())
        dmg = file('one.dmg', 'test dmg')
        archive = file('one.tar.gz', 'test archive')
        signature = file('one.tar.gz.sig', 'test signature')
        updater = dict(archive, signaturePath=signature['path'], signatureSize=signature['size'],
                       signatureSha256=signature['sha256'], signature='test signature')
        dump(release_path / 'manifest.json', dict(schemaVersion=1, status='complete', dirty=False,
             distribution='direct', version=version, revision='a' * 40,
             artifacts=[dict(dmg, platform='macos', distribution='direct', updater=updater)]))
        base = f'https://getsituate.com/releases/{version}/'
        dump(meta / 'download.json', dict(version=version, distribution='direct', url=base + dmg['path'],
             sha256=dmg['sha256'], size=dmg['size']))
        dump(meta / 'update.json', dict(version=version, distribution='direct', platforms={
            key: {'url': base + archive['path'], 'signature': updater['signature']}
            for key in ('darwin-aarch64', 'darwin-x86_64')}))
        return f'releases/{version}/metadata'

    def check_release(self):
        # Only ownership is emulated; links, modes, manifests and file bytes are real.
        return verify.check_release(self.dist, release, deploy_uid=self.dist.stat().st_uid)

    def test_website_activation_and_rollback_leave_distribution_unchanged(self):
        pointer = self.dist / 'current-release'
        pointer.symlink_to(self.publish_fixture('1.2.3'))
        before = self.check_release()
        first, a = self.source('first')
        second, b = self.source('second')
        website.activate(self.site, a, first, seed=True)
        website.activate(self.site, b, second)
        self.assertEqual((self.site / 'current/index.html').read_text(), 'second')
        website.activate(self.site, a)
        self.assertEqual((self.site / 'current/index.html').read_text(), 'first')
        self.assertEqual(self.check_release(), before)
        self.assertEqual(pointer.readlink().as_posix(), 'releases/1.2.3/metadata')

    def test_empty_corrupt_or_interrupted_site_is_not_selected(self):
        first, a = self.source('first')
        other, b = self.source('other')
        with self.assertRaises(ValueError):
            website.activate(self.site, a, other, seed=True)
        with patch.object(Path, 'rename', side_effect=OSError('interrupted')):
            with self.assertRaises(OSError):
                website.activate(self.site, a, first, seed=True)
        self.assertTrue((self.site / 'website.pending').is_file())
        with self.assertRaisesRegex(ValueError, 'unresolved'):
            website.activate(self.site, b, other, seed=True)
        (other / 'leak').symlink_to('index.html')
        with self.assertRaisesRegex(ValueError, 'single-link regular file'):
            website.fingerprint(other)
        (other / 'leak').unlink()
        (other / 'index.html').write_text('')
        with self.assertRaisesRegex(ValueError, 'nonempty index'):
            website.fingerprint(other)

    def test_unseeded_volume_is_not_ready(self):
        with self.assertRaisesRegex(ValueError, 'Missing active website'):
            verify.check(self.root, release)

    def test_release_requires_latest_pointer_and_matching_bytes(self):
        pointer = self.dist / 'current-release'
        with self.assertRaises(FileNotFoundError):
            self.check_release()
        pointer.symlink_to(self.publish_fixture('1.2.3'))
        before = self.check_release()
        stored_next = self.publish_fixture('1.2.4')
        with self.assertRaisesRegex(ValueError, 'not the latest'):
            self.check_release()
        pointer.unlink()
        pointer.symlink_to(stored_next)
        self.assertNotEqual(self.check_release(), before)
        (self.dist / 'release-allocation-pending.tmp').touch()
        with self.assertRaisesRegex(ValueError, 'Unresolved'):
            self.check_release()
        (self.dist / 'release-allocation-pending.tmp').unlink()
        (self.dist / 'release-operations.jsonl').write_text('{"identity":{"id":1},"state":"claimed"}\n')
        with self.assertRaisesRegex(ValueError, 'holds a claim'):
            self.check_release()
        (self.dist / 'release-operations.jsonl').unlink()
        (self.dist / 'releases/1.2.4/one.dmg').write_text('corrupt')
        with self.assertRaisesRegex(ValueError, 'artifact mismatch'):
            self.check_release()


if __name__ == '__main__':
    unittest.main()
