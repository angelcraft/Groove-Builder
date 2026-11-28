"""Stable, machine-readable error codes (tests and UIs match on .code)."""


class PackageError(Exception):
    """A .groove package (or one of its members) is rejected. Fail closed."""

    def __init__(self, code: str, message: str, member: str = ""):
        self.code = code
        self.message = message
        self.member = member
        loc = f"{member}: " if member else ""
        super().__init__(f"[{code}] {loc}{message}")


class InstallError(Exception):
    """An SD operation is refused or failed; the SD is left in its prior state."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(f"[{code}] {message}")
