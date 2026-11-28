#!/usr/bin/env python3
"""GE-155 entry point: validate and (un)install Groove Engine runtime packages (.groove) on a Switch SD.
DRAFT: formats are pending GE-154 review. See reports/GE-155/."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from groove_package.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
