# Path Lens

Lightweight JavaScript path and endpoint discovery for authorized reconnaissance.

> **Authorized use only:** Path Lens is intended for use against websites, applications, and infrastructure that you own or have explicit permission to test. Do not use it to probe systems without authorization.

## Why Path Lens?

Path Lens is a small Firefox WebExtension for quickly surfacing paths and endpoint-like strings exposed by JavaScript loaded in the current page.

It is deliberately narrow in scope. Path Lens is not a crawler, fuzzer, port scanner, proxy, vulnerability scanner, or AI-powered security platform.

The goal is simple:

```text
JavaScript in the page
        ↓
  candidate extraction
        ↓
 normalization / filtering
        ↓
      findings
        ↓
 optional HTTP checks
```

## Features

- Extracts path- and URL-like candidates from external and inline JavaScript.
- Normalizes common parameter forms such as `:id`, `${id}`, `{id}`, and regex-style numeric placeholders.
- Deduplicates findings by normalized path.
- Filters findings by type, parameters, origin, and observed HTTP status.
- Caches scan results locally per page URL.
- Performs optional GET checks with a small concurrency limit and request timeout.
- Keeps parameterized findings from being checked with invented values.
- Distinguishes first-party, third-party, and unknown sources.

## Check and Check all

HTTP checking is an active operation, not passive parsing.

A single **Check** may issue a real `GET` request for the selected finding. Same-origin checks are performed from the context of the scanned page, so an authenticated page may send its existing session credentials with the request.

**Check all** is intentionally more conservative. It currently considers only concrete, same-origin, non-parameterized findings. Cross-origin findings are skipped. Findings whose path contains a token associated with potentially state-changing behavior are also skipped.

The current heuristic includes tokens such as:

```text
logout   signout   delete   remove   destroy
create   add       update   edit     save
purchase checkout  cancel   subscribe unsubscribe
confirm  clear
```

This list is a mitigation, **not a safety guarantee**. Endpoint semantics cannot be inferred reliably from a path name alone. A state-changing endpoint can use an unexpected name and therefore still pass the heuristic.

Use **Check all** only when you understand that it may generate real authenticated GET requests against the current origin. Review the findings before relying on the automated check set.

## Permissions

Path Lens requests:

- `activeTab` — access to the current active tab when the user invokes the extension.
- `scripting` — execute the extraction/check logic in the active tab.
- Optional host permissions for `*://*/*` — available for cross-origin access when an individual check requires explicit host permission.

The extension does not request a permanent `<all_urls>` host permission in the manifest.

## Firefox compatibility

Path Lens is a **Firefox-first Manifest V3 extension**.

The current code uses the WebExtensions `browser.*` namespace and is not maintained or tested as a Chromium extension. Cross-browser support is intentionally outside the current project scope.

## Installation

### Temporary installation for development

1. Open `about:debugging` in Firefox.
2. Select **This Firefox**.
3. Choose **Load Temporary Add-on…**.
4. Select `manifest.json` from the Path Lens directory.

The temporary extension can be reloaded from `about:debugging` after code changes.

## Usage

1. Open the page you are authorized to test.
2. Open Path Lens from the Firefox toolbar.
3. Press **Scan**.
4. Review the extracted paths and URLs.
5. Use filters to narrow the result set.
6. Use **Check** for an individual HTTP observation or **Check all** for the conservative same-origin batch check.
7. Use **Copy all** to export the visible findings and filter context.

## What Path Lens does not do

Path Lens does not attempt to:

- crawl a site recursively;
- fuzz parameters or paths;
- guess parameter values;
- run arbitrary HTTP methods;
- automatically test cross-origin findings in **Check all**;
- assign vulnerability severity or risk scores;
- replace dedicated reconnaissance or scanning tools.

## Design philosophy

Path Lens keeps extraction separate from orchestration:

- `scanner.js` contains deterministic candidate extraction, normalization, validation, classification, and deduplication.
- `popup.js` handles browser interaction, UI state, filtering, caching, and optional HTTP checks.

The separation is intentional: extracting a string that looks like an endpoint is not the same thing as deciding what to do with it.

## Project status

Early public release / active development.

The project currently prioritizes a small, understandable codebase and explicit behavior over feature breadth.

## License

License: **TBD**.
