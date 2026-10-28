# screen-translate-hub

**English** · [简体中文](README.zh-CN.md)

screen-translate-hub is a screen translator and AI assistant that runs on a Windows computer. It recognizes text on the screen, places translations over the original text, and provides a viewing page for devices on the same local network.

The longer-term plan includes macOS, selected-text translation, a Docker backend, accounts, and connections between devices. The runnable version today is the Windows standalone release, defined in the [v1 scope](docs/requirements/09-v1-scope.md).

## Current release

The first Windows standalone implementation has been exercised on a real Windows desktop. See the [v1 scope](docs/requirements/09-v1-scope.md), [implementation specification](docs/spec/18-v1-implementation.md), [development log](docs/dev-log.md), and [delivery proposal](docs/proposal.md). Its features include:

- One-shot screenshot translation, displayed in place or in a floating screenshot card, and continuous translation of a screen, the active window, or the window under the pointer; change detection, paragraph reuse, and a translation cache.
- Multiple translation sources competing by priority: Claude Code headless mode, OpenAI-compatible endpoints, the Anthropic API, Bergamot offline translation using Firefox's engine and models, and a mock source.
- Two overlay styles, with backing panels under translated text or a dimmed screen, plus an interaction mode. The application's own windows are excluded from capture.
- A local-network viewer for phones, tablets, and computer browsers, protected by an access code.
- An AI assistant with heartbeat capture and rule-based gating, optionally backed by jev. Its Claude Code or pi brain uses platform tools to inspect the screen, draw annotations, and answer in a floating card.
- Local history.

The remaining documents describe the broader roadmap, including the Docker backend, accounts, cross-device operation, and macOS. The v1 scope specifies which parts are implemented in this release.

## Run the Windows release

Use Windows 11, Node.js 24, and Python 3.12. Windows 10 version 2004 or later is a compatibility target; validation so far has used Windows 11.

```powershell
npm.cmd ci                 # Install locked TypeScript dependencies and Electron
npm.cmd run setup:py       # Create .venv and install capture/OCR dependencies
npm.cmd run desktop        # Build and start the desktop app in the system tray
```

Use `npm.cmd` in PowerShell to invoke npm's Windows launcher directly.

The default translation sources are an already authenticated local Claude Code installation (`claude` on `PATH`) and Bergamot. Bergamot downloads approximately 50 MB of models on first use.

| Shortcut | Action |
| --- | --- |
| Alt+Shift+S | Translate a selected screenshot region |
| Alt+Shift+C | Start or pause continuous translation |
| Alt+Shift+H | Show or hide the overlay |
| Alt+Shift+I | Toggle interaction mode |
| Alt+Shift+A | Open the AI assistant |

To view on a phone, turn off **Only this computer** in settings, use **Copy viewer link** in the tray menu, and open the link on a device on the same network. Allow incoming Node.js connections when Windows Firewall prompts. Alternatively, run `tools/win/allow-viewer.ps1` in an administrator PowerShell window; it allows only the viewer port on private networks. The link contains the access code, so share it only with intended viewers.

Run the checks with:

```powershell
npm.cmd test                 # TypeScript packages and viewer-page regressions
npm.cmd run test:py           # Python services
npm.cmd run typecheck
npm.cmd run test:desktop      # Build; DPI, Chinese input, screenshot cards, and assistant lifecycle regressions
node tools/dev/e2e.ts both mock           # Isolated pipeline, synthetic frames
node tools/dev/e2e.ts screenshot claude   # Real translation using local Claude Code
```

GitHub Actions runs the Windows checks on pull requests and on `main`: dependency installation, type checking, automated tests, desktop build, and the synthetic pipeline. The real Claude check uses your local authenticated installation.

For development over SSH, see section 16 of the [implementation specification](docs/spec/18-v1-implementation.md).

## Requirements documents

Start with the [usage scenarios](docs/requirements/08-scenarios.md): five concrete journeys, each linked to the relevant requirements and specifications. The detailed project documents are currently in Simplified Chinese.

| Document | Contents |
| --- | --- |
| [Terminology](docs/requirements/00-terms.md) | Shared terms and their meanings |
| [Product](docs/requirements/01-product.md) | Positioning, deployment, clients, entry points, display, AI interaction, languages, history, and hardware |
| [Workflows](docs/requirements/02-workflow.md) | Entry-point bindings, templates, editing rules, execution location, and cross-device data flow |
| [OCR and translation races](docs/requirements/03-ocr-and-translation-race.md) | OCR selection, normalization, and translation-source replacement rules |
| [Run lifecycle](docs/requirements/04-run-lifecycle.md) | Runs, batches, races, requests, scheduling, reuse, caching, timeouts, retries, pausing, stopping, disconnection, and configuration changes |
| [Accounts, devices, and sharing](docs/requirements/05-accounts-devices-sharing.md) | Ownership, login and recovery, pairing and revocation, service access, sources, viewing rules, security, and privacy |
| [Service decomposition](docs/requirements/06-services.md) | Service classes, boundaries, deployment, registration, and interface versions |
| [Desktop platforms](docs/requirements/07-desktop-platforms.md) | Windows/macOS requirements, APIs, permissions, application packaging, and platform differences |
| [Usage scenarios](docs/requirements/08-scenarios.md) | User actions and platform responses for five typical workflows |
| [v1 scope](docs/requirements/09-v1-scope.md) | Release scope, display modes, same-language handling, sources, LAN viewing, shortcuts, and the assistant |
| [Open questions](docs/requirements/open-questions.md) | Decisions still to be made |

## Specifications

| Document | Contents |
| --- | --- |
| [Overview](docs/spec/00-overview.md) | Scope, document map, notation, identifiers, time, languages, and interface versions |
| [Architecture](docs/spec/01-architecture.md) | Components, addressing, data flow, deployment, and trust boundaries |
| [Data model](docs/spec/02-data-model.md) | Geometry, frames, blocks, translation units, candidates, races, change maps, cache entries, and display events |
| [Workflow definitions](docs/spec/03-workflow.md) | File format, types, nodes, execution, validation, parameters, and templates |
| [Run coordinator](docs/spec/04-run-coordinator.md) | State machine, batch scheduling, paragraph reuse, caching, races, requests, pausing, and stopping |
| [Change detection](docs/spec/05-change-detection.md) | Frame acceptance, pending frames, change maps, and measured costs |
| [Normalization](docs/spec/06-normalization.md) | Coordinates, reading order, grouping, and text joining |
| [Display and layout](docs/spec/07-display.md) | Display state, overlays, web viewing, screenshot cards, text fitting, and settings |
| [Service protocol](docs/spec/08-service-protocol.md) | Transport, framing, authentication, multiplexing, flow control, deadlines, errors, and routing |
| [Service interfaces](docs/spec/09-service-interfaces.md) | Methods, call shapes, messages, and behavior |
| [Backend platform](docs/spec/10-backend.md) | Platform services, state, database upgrades, and key behavior |
| [Security](docs/spec/11-security.md) | Threat model, authentication, two-factor verification, pairing, IPC, access control, and data protection |
| [Desktop](docs/spec/12-desktop.md) | Processes, main application, native integration, and local storage |
| [Web](docs/spec/13-web.md) | Viewing, chat, node editing, and administration |
| [Deployment and operations](docs/spec/14-deployment.md) | Initialization, certificates, relay, upgrades, rollback, backup, recovery, and outbound proxies |
| [Technology choices](docs/spec/15-tech-selection.md) | Licensing, languages, frameworks, protocols, backend, OCR, translation engines, and models |
| [Acceptance and testing](docs/spec/16-acceptance.md) | Samples, test doubles, metrics, races, and platform testing |
| [AI assistant](docs/spec/17-assistant.md) | Sessions, heartbeat, gating, brains, tools, annotations, and the assistant card |
| [v1 implementation](docs/spec/18-v1-implementation.md) | Current stack, processes, protocol transport, source layout, and module functions |

## Development principles

Reuse existing open-source libraries, extractable modules, and code where practical. Reuse can happen at any of those levels.

Capabilities are separate services to improve compatibility. A service executes each workflow node, and engines implementing the same capability share an interface. OS-independent services can run as containers or local processes. Desktop-dependent services have native implementations for Windows and macOS. See [service decomposition](docs/requirements/06-services.md).

UI language, OCR language, and translation language are configured independently. The pipeline accommodates additional languages without changing its overall processing flow.

## License

The project is dual-licensed under the GNU Affero General Public License version 3 (AGPL-3.0) and a commercial license.

Under AGPL-3.0, users accessing a modified version over a network must also be offered its corresponding complete source code. The viewer footer includes a source-code link to support this obligation; operators deploying a modified version should point it to their own version. See [LICENSE](LICENSE) for the full license.

Commercial use under different terms requires a separate commercial license from the repository owner.

Before external contributions are accepted, contributors are required to sign a Contributor License Agreement (CLA) allowing the repository owner to license the contribution under both AGPL-3.0 and commercial terms. The Developer Certificate of Origin (DCO) alone certifies the right to contribute under the project's open-source license and does not grant commercial relicensing rights.
