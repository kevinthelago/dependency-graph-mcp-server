"""Domain models."""

from dataclasses import dataclass
from enum import Enum


class Role(Enum):
    ADMIN = "admin"
    USER = "user"


@dataclass
class User:
    name: str
    role: Role

    def display_name(self) -> str:
        return f"{self.name} ({self.role.value})"
