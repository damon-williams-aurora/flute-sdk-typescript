# Security policy

The Flute SDK handles merchant secrets and connects to a payment
platform. We take security reports seriously.

## Reporting a vulnerability

- **Do NOT open a public GitHub issue.**
- Email `security@getflute.com` with a description of the issue,
  reproduction steps, and (if possible) a proposed fix.
- We acknowledge reports within 2 business days and aim to ship a
  patch within 10 business days for high-severity findings.

## Supported versions

Only the most recent **major** is actively patched. Older majors
receive critical security fixes for 12 months after the next major
ships, in line with the project deprecation policy.

## Secret hygiene

This SDK is server-side only. The merchant `clientSecret` MUST stay on
trusted servers. If you find any code path that:

- logs the `clientSecret`,
- bundles it into a browser/client artifact,
- writes it to disk in plaintext, or
- exposes it via a debug endpoint,

…please report it under this policy — it is a P0 incident.
