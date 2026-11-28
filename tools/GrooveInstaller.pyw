#!/usr/bin/env python3
"""GE-155 Windows GUI entry point (double-click on Windows: .pyw runs without a console). DRAFT."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from groove_gui.app import main  # noqa: E402

if __name__ == "__main__":
    main()
