# WP6B Python 3.14 venv Launcher Review

## Verdict

**ACCEPTED AS A PINNED CPYTHON 3.14 LAUNCHER EXCEPTION**

The isolated CRG environment was deleted completely and rebuilt from the pinned
Python 3.14.6 interpreter and the exact Code Review Graph release commit. The
fresh environment reproduced a non-ASCII launcher named `𝜋thon` in `bin/`.

This is not treated as an arbitrary or package-owned executable. It is accepted
only because the behaviour is an intentional CPython 3.14 POSIX `venv` feature
tracked by upstream CPython issue 119535 and its linked implementation work.

## Local reproduction

The clean rebuild established:

- previous CRG environment removed;
- fresh Python 3.14.6 venv created;
- CRG installed from commit `935695f800f2b02e71aae6d463f3df65f0c6493e`;
- package and CLI version `2.3.6`;
- dependency-freeze SHA-256
  `08f4a3b2a2265df20646078706006232f7d5137160949e0c5e7a4223faa950af`;
- the `𝜋thon` launcher reproduced after the clean rebuild;
- no CRG graph build;
- no model call;
- no CRG integration subcommand.

## Exact accepted identity

The exception is accepted only when every condition is true:

- Python runtime version is exactly `3.14.6`;
- platform is POSIX;
- relative path is exactly `bin/𝜋thon`;
- the first code point is exactly `U+1D70B MATHEMATICAL ITALIC SMALL PI`;
- UTF-8 filename bytes are exactly `f09d9c8b74686f6e`;
- literal symlink target is exactly `python3.14`;
- the resolved target is exactly the same canonical interpreter as
  `bin/python`, `bin/python3` and `bin/python3.14`;
- the entry is represented explicitly in the complete environment manifest;
- its literal target, resolved target and mode are reverified before every CRG
  invocation.

No normalization, lookalike matching or prefix matching is permitted. In
particular, plain Greek `π` (`U+03C0`), ASCII `python`, `pythonπ`, any different
Unicode code point, any different path or any different target is not covered by
this exception.

## Security consequence

The launcher is not used to invoke CRG. The pinned
`bin/code-review-graph` console script and canonical Python interpreter remain
the executable identities used by the adapter.

Any additional non-ASCII entry, unknown symlink, changed target, changed mode,
missing expected entry or new environment file remains a fail-closed environment
integrity failure.

## Gate result

This finding no longer blocks environment manifestation. WP6B remains blocked
until the complete environment is manifested and sealed read-only, the macOS
network and filesystem-write sandbox is proven, and the exact updated plan
receives final independent review.
