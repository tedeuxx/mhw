"""The fixture project's whole application: one function (mhw Issue #246, dry run only)."""
import html


def greet(name):
    """A greeting that never echoes markup from the name."""
    return "Hello, %s." % html.escape(name)
