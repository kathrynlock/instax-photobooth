"""Thin wrapper around the InstantLink CLI (the Rust driver that supports the
Instax Mini Link 3). We shell out rather than bind the library, so the whole
print path is just `instantlink print <file>`."""

import re
import subprocess

from . import config as cfg


def _run(args, timeout):
    return subprocess.run(
        [cfg.INSTANTLINK, *args],
        capture_output=True, text=True, timeout=timeout,
    )


def status():
    """Return (ok, text). ok is False if the CLI is missing or the printer is unreachable."""
    try:
        result = _run(["status"], timeout=30)
    except FileNotFoundError:
        return False, "`instantlink` not found on PATH. Did `cargo install` succeed?"
    except subprocess.TimeoutExpired:
        return False, "`instantlink status` timed out. Is the printer on and awake?"
    text = (result.stdout or result.stderr).strip()
    # `instantlink status` exits 0 even when no printer is found, reporting
    # "Connected: no" / "No Instax printer found" instead, so check the text.
    not_found = re.search(r"Connected:\s*no\b|No Instax printer", text, re.IGNORECASE)
    return result.returncode == 0 and not not_found, text


def print_image(path):
    """Send one image file to the printer. Return (ok, text)."""
    try:
        result = _run(["print", str(path), "--fit", cfg.FIT_MODE], timeout=120)
    except FileNotFoundError:
        return False, "`instantlink` not found on PATH."
    except subprocess.TimeoutExpired:
        return False, "print timed out after 120s."
    text = (result.stdout or result.stderr).strip()
    return result.returncode == 0, text
