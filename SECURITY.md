# Security Policy

## Supported versions

Only the latest version of `homebridge-apcaccess2` receives security fixes. Please update before reporting a problem.

| Version                                   | Supported                      |
| ----------------------------------------- | ------------------------------ |
| Latest 1.x release                        | Yes                            |
| Older 1.x releases                        | No                             |
| `homebridge-apcaccess` (original package) | No, it is no longer maintained |

## Reporting a vulnerability

**Do not report security problems in public issues.**

Report them privately through GitHub: open the [Security tab](https://github.com/santiagosony/homebridge-apcaccess2/security) of this repository and choose **Report a vulnerability**, or use [this link](https://github.com/santiagosony/homebridge-apcaccess2/security/advisories/new).

Include:

- A description of the problem and its impact.
- The steps to reproduce it, and the affected versions.
- Any logs or proof of concept, with serial numbers, IP addresses and other personal data removed.

You should get a first answer within 7 days. Once the problem is confirmed, a fix is released as soon as possible and credited to you in the release notes, unless you prefer to stay anonymous.

## Scope

In scope: the code in this repository and the `homebridge-apcaccess2` package published to npm.

Out of scope: vulnerabilities in Homebridge, apcupsd, Node.js or the UPS itself. Please report those to their own projects.

## How releases are protected

- Releases are published to npm only from this repository's GitHub Actions, with [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers): no npm token is stored anywhere, and each package carries a provenance attestation that links it to the exact commit it was built from.
- The plugin has no runtime dependencies.
- CodeQL, Dependabot and secret scanning run on the repository.
