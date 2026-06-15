"""Main entry point — uses the pkg package (absolute imports)."""

import os
import sys
import json

from pkg import User, Role, greet
from pkg.models import User as UserAlias
from pkg.utils import get_env

GREETING = greet("world")
DEFAULT_ROLE = Role.USER


def run() -> None:
    user = User(name="Alice", role=DEFAULT_ROLE)
    env = get_env("HOME")
    print(user, env)
