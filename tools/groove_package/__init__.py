"""Groove Engine package validator and SD installer (GE-155, DRAFT).

Pure Python 3.9+ standard library so the same core runs on Windows (CLI) and
inside an Android app (e.g. Chaquopy) without native dependencies.

Status: implements GE-154 Draft 0.2 (runtime profile) for review. The package
contract, slots.json and engine.json formats are NOT frozen.
"""
__version__ = "0.1.0-draft"
from .errors import PackageError, InstallError  # noqa: F401
