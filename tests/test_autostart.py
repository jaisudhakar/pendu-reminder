import sys
import unittest
from unittest import mock

from pendu import autostart


class AutostartCommandTest(unittest.TestCase):
    def test_source_checkout_runs_the_launcher_with_python(self):
        with mock.patch.object(sys, "frozen", False, create=True):
            command = autostart._command()
        self.assertEqual(len(command), 2)
        self.assertTrue(command[1].endswith("pendu.pyw"))

    def test_packaged_build_runs_itself(self):
        with mock.patch.object(sys, "frozen", True, create=True), \
                mock.patch.object(sys, "executable", "/Applications/Pendu.app/Contents/MacOS/Pendu"):
            self.assertEqual(autostart._command(), ["/Applications/Pendu.app/Contents/MacOS/Pendu"])

    def test_windows_launcher_quotes_every_part(self):
        with mock.patch.object(autostart, "_command", return_value=[r"C:\Program Files\Pendu.exe"]), \
                mock.patch.object(sys, "platform", "win32"):
            content = autostart._content()
        self.assertIn(r'shell.Run """C:\Program Files\Pendu.exe""", 0, False', content)

    def test_linux_entry_quotes_every_part(self):
        with mock.patch.object(autostart, "_command", return_value=["/usr/bin/python3", "/opt/p/pendu.pyw"]), \
                mock.patch.object(sys, "platform", "linux"):
            content = autostart._content()
        self.assertIn('Exec="/usr/bin/python3" "/opt/p/pendu.pyw"', content)

    def test_macos_plist_lists_every_argument(self):
        with mock.patch.object(autostart, "_command", return_value=["/usr/bin/python3", "/opt/p/pendu.pyw"]), \
                mock.patch.object(sys, "platform", "darwin"):
            content = autostart._content()
        self.assertIn("<string>/usr/bin/python3</string>\n    <string>/opt/p/pendu.pyw</string>", content)


if __name__ == "__main__":
    unittest.main()
