"""Register Pendu to start automatically when you log in.

Windows: a hidden-window .vbs launcher in the Startup folder.
macOS:   a LaunchAgent plist in ~/Library/LaunchAgents.
Linux:   an XDG .desktop entry in ~/.config/autostart.
"""

import os
import sys
from pathlib import Path

APP_ID = "com.pendu.reminder"
LAUNCHER = Path(__file__).resolve().parent.parent / "pendu.pyw"


def _python():
    exe = Path(sys.executable)
    if sys.platform == "win32":
        # pythonw runs without a console window.
        windowed = exe.with_name("pythonw.exe")
        if windowed.exists():
            return windowed
    return exe


def _target():
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
        return Path(appdata) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup" / "Pendu.vbs"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "LaunchAgents" / f"{APP_ID}.plist"
    config = os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config"
    return Path(config) / "autostart" / "pendu.desktop"


def _content():
    python, launcher = str(_python()), str(LAUNCHER)
    if sys.platform == "win32":
        return (
            'Set shell = CreateObject("WScript.Shell")\r\n'
            f'shell.Run """{python}"" ""{launcher}""", 0, False\r\n'
        )
    if sys.platform == "darwin":
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{APP_ID}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{python}</string>
    <string>{launcher}</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
"""
    return f"""[Desktop Entry]
Type=Application
Name=Pendu
Comment=Today's tasks as sticky notes
Exec="{python}" "{launcher}"
Terminal=false
X-GNOME-Autostart-enabled=true
"""


def install():
    target = _target()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(_content(), encoding="utf-8")
    return target


def remove():
    target = _target()
    if target.exists():
        target.unlink()
        return target
    return None


def is_installed():
    return _target().exists()
