"""Simple Windows GUI for the GE-155 installer (tkinter, stdlib only).

Thin layer: `controller.py` has no GUI imports and only calls groove_package;
`app.py` is the tkinter view. Android apps reuse groove_package directly.
"""
