"""Skill registry.

A skill is one thing G1 can do. Every skill declares a risk level:

* ``safe``    – runs immediately (search, make a draft video, set a reminder)
* ``confirm`` – G1 must get a spoken/tapped "yes" first (send a message, pay, post publicly)

The agent never executes a ``confirm`` skill on its own; it creates a pending action
that the owner approves on the device. This is the core trust rule of G1.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Literal

Risk = Literal["safe", "confirm"]


@dataclass
class Skill:
    name: str
    description: str
    parameters: dict[str, Any]
    run: Callable[..., dict[str, Any]]
    risk: Risk = "safe"
    # Human sentence shown on the confirm card, built from the args
    summarize: Callable[[dict[str, Any]], str] | None = None

    def summary(self, args: dict[str, Any]) -> str:
        if self.summarize:
            try:
                return self.summarize(args)
            except Exception:  # noqa: BLE001
                pass
        return f"{self.name}({args})"


REGISTRY: dict[str, Skill] = {}


def skill(
    name: str,
    description: str,
    parameters: dict[str, Any] | None = None,
    risk: Risk = "safe",
    summarize: Callable[[dict[str, Any]], str] | None = None,
):
    def deco(fn: Callable[..., dict[str, Any]]):
        REGISTRY[name] = Skill(
            name=name,
            description=description,
            parameters=parameters or {"type": "object", "properties": {}},
            run=fn,
            risk=risk,
            summarize=summarize,
        )
        return fn

    return deco


def load_all() -> dict[str, Skill]:
    # Importing registers the skills
    from . import basics, booking, messaging, video  # noqa: F401

    return REGISTRY
