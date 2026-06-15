"""Utility functions."""

import os


def greet(name: str) -> str:
    return f"Hello, {name}!"


def get_env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)
