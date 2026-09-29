import argparse

from . import autostart
from .store import TaskStore


def main():
    parser = argparse.ArgumentParser(
        prog="pendu", description="Today's tasks as sticky notes on your screen.")
    parser.add_argument("--install-autostart", action="store_true",
                        help="open Pendu automatically when you log in")
    parser.add_argument("--remove-autostart", action="store_true",
                        help="stop opening Pendu at login")
    parser.add_argument("--data", metavar="FILE",
                        help="notes file to use (default: ~/.pendu/notes.json)")
    args = parser.parse_args()

    if args.install_autostart:
        print(f"Pendu will open at login ({autostart.install()})")
        return
    if args.remove_autostart:
        removed = autostart.remove()
        print(f"Removed {removed}" if removed else "Pendu was not set to open at login")
        return

    from .app import main as run_app
    run_app(TaskStore(args.data) if args.data else None)


if __name__ == "__main__":
    main()
