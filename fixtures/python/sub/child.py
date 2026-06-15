"""Sub-package child — exercises relative imports."""

from . import __init__ as pkg_init   # noqa: F401 — from . import
from .sibling import helper           # from .sibling import name
from .. import greet                  # from .. import (two levels)
from ..pkg.models import User         # from ..pkg.models import name
