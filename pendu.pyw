"""Double-click this file (or run `python pendu.pyw`) to open Pendu."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pendu.__main__ import main  # noqa: E402

main()
