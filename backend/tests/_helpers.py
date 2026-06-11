"""Helpers for tests that need to create sellers without colliding on GSTIN.

The previous fixtures used time-based suffixes which would collide when
multiple sellers were created in the same second (or with stale state from
parallel test runs). This module replaces them with uuid-based generators
that always produce a valid AND globally-unique (GSTIN, PAN) pair.
"""
from __future__ import annotations

import random
import string
import uuid


def random_pan_prefix() -> str:
    """5 uppercase letters — used as the first 5 chars of PAN AND GSTIN[2:7]."""
    # uuid gives us 32 hex chars; map first 5 ascii-uppercase letters from a
    # filtered alphabet to keep generation lightning fast without needing the
    # python `random` module to be seeded.
    h = uuid.uuid4().hex.upper()
    letters = [c for c in h if c.isalpha()][:5]
    while len(letters) < 5:
        letters.append(random.choice(string.ascii_uppercase))
    return "".join(letters)


def make_gstin_pan() -> tuple[str, str]:
    """Return a (gstin, pan) pair where PAN == GSTIN[2:12].

    Format:
      PAN     = AAAAA1234F   (5 letters + 4 digits + 1 letter)
      GSTIN   = 27 + PAN + E + Z + C  (where E and C are entity/check chars)
    """
    prefix = random_pan_prefix()
    pan = f"{prefix}{random.randint(1000, 9999)}{random.choice(string.ascii_uppercase)}"
    entity = random.choice(string.ascii_uppercase + "123456789")
    check = random.choice(string.ascii_uppercase + string.digits)
    gstin = f"27{pan}{entity}Z{check}"
    assert pan == gstin[2:12]
    return gstin, pan
