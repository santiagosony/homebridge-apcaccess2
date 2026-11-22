# Contributing to homebridge-apcaccess2

Thanks for helping! Bug reports, ideas and pull requests are all welcome.

## Reporting a bug or asking for a feature

[Open an issue](https://github.com/santiagosony/homebridge-apcaccess2/issues/new/choose) and pick the bug report or feature request form. For bugs, the versions, your configuration and the relevant log lines make it much quicker to find the cause.

Security problems are the exception: please report them privately through [GitHub's vulnerability reporting](https://github.com/santiagosony/homebridge-apcaccess2/security/advisories/new), not in a public issue.

## Setting up the project

You need Node.js 22, 24 or 26.

```sh
git clone https://github.com/santiagosony/homebridge-apcaccess2.git
cd homebridge-apcaccess2
npm install
npm test
```

`npm test` runs ESLint, the Prettier format check and the unit tests. The tests run the plugin against the HAP-NodeJS version that ships with Homebridge 2 and a fake apcupsd server (`test/fakeApcupsd.js`), so no UPS is needed.

Useful scripts:

| Command            | What it does                  |
| ------------------ | ----------------------------- |
| `npm test`         | Lint, format check and tests  |
| `npm run lint:fix` | Fix what ESLint can fix       |
| `npm run format`   | Format the code with Prettier |

To try a change in a real Homebridge, link your checkout into Homebridge's plugin folder or install it from the folder with `npm install /path/to/homebridge-apcaccess2`.

## Making a change

1. Fork the repository and create a branch for your change.
2. Keep the change focused, and add or update tests for what it changes.
3. Update the README if you add or change an option, and add a line to the `[Unreleased]` section of the [changelog](CHANGELOG.md).
4. Make sure `npm test` passes, then open a pull request. CI runs the same checks on Node.js 22, 24 and 26, and CodeQL scans the change.

A few conventions:

- **No runtime dependencies.** The plugin talks to apcupsd's network protocol directly; please keep it that way.
- **Don't break existing configurations.** The `APCAccess` accessory type and its options are a drop-in replacement for the original plugin, and people rely on that.
- Code style is enforced by ESLint and Prettier.

## Releases

Releases are made by the maintainer: bump `version` in `package.json`, move the `[Unreleased]` changelog entries under the new version, and publish a GitHub release with the tag `v<version>`. The release triggers the **Publish to npm** workflow, which runs the tests and publishes the package with npm Trusted Publishing and provenance.

## License

By contributing, you agree that your contributions are licensed under the project's [MIT License](LICENSE).
