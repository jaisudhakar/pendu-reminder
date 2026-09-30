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


def _command():
    """The program and arguments that open Pendu.

    A packaged build (PyInstaller sets sys.frozen) is its own program;
    otherwise Python runs pendu.pyw.
    """
    if getattr(sys, "frozen", False):
        return [str(Path(sys.executable).resolve())]
    return [str(_python()), str(LAUNCHER)]


def _content():
    command = _command()
    if sys.platform == "win32":
        quoted = " ".join(f'""{part}""' for part in command)
        return (
            'Set shell = CreateObject("WScript.Shell")\r\n'
            f'shell.Run "{quoted}", 0, False\r\n'
        )
    if sys.platform == "darwin":
        arguments = "\n".join(f"    <string>{part}</string>" for part in command)
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{APP_ID}</string>
  <key>ProgramArguments</key>
  <array>
{arguments}
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
"""
    exec_line = " ".join(f'"{part}"' for part in command)
    return f"""[Desktop Entry]
Type=Application
Name=Pendu
Comment=Today's tasks as sticky notes
Exec={exec_line}
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
