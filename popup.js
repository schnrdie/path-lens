"use strict";

const scanButton =
  document.getElementById("scan-button");

const copyAllButton =
  document.getElementById("copy-all");

const checkAllButton =
  document.getElementById("check-all");

const searchInput =
  document.getElementById("search");

const resultsContainer =
  document.getElementById("results");

const countElement =
  document.getElementById("count");

const statusElement =
  document.getElementById("status");

const controls =
  document.getElementById("controls");

const filterButton =
  document.getElementById("filter-button");

const filterMenu =
  document.getElementById("filter-menu");

const clearFiltersButton =
  document.getElementById("clear-filters");

const statusFilterSection =
  document.getElementById(
    "status-filter-section"
  );

const statusFilterOptions =
  document.getElementById(
    "status-filter-options"
  );

const CHECK_TIMEOUT_MS = 8000;
const CHECK_CONCURRENCY = 4;

const CHECK_ALL_RISKY_TOKENS = new Set([
  "logout",
  "signout",
  "delete",
  "remove",
  "destroy",
  "create",
  "add",
  "update",
  "edit",
  "save",
  "purchase",
  "checkout",
  "cancel",
  "subscribe",
  "unsubscribe",
  "confirm",
  "clear"
]);

let currentUrl = null;
let findings = [];

const checkStates = new Map();

let activeFilter = {
  types: new Set(["path"]),
  params: new Set(),
  origins: new Set(),
  statuses: new Set()
};

function setStatus(message) {
  statusElement.textContent = message;
}

async function getActiveTab() {
  const [tab] =
    await browser.tabs.query({
      active: true,
      currentWindow: true
    });

  return tab ?? null;
}

function getStorageKey(url) {
  return `scan:${url}`;
}

function loadSavedScan(url) {
  const key = getStorageKey(url);
  const stored =
    localStorage.getItem(key);

  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored);
  } catch (error) {
    console.error(
      "Failed to parse saved scan:",
      error
    );

    return null;
  }
}

function saveScan(url, scan) {
  const key = getStorageKey(url);

  localStorage.setItem(
    key,
    JSON.stringify(scan)
  );
}

function getFindingKey(finding) {
  return `${finding.type}:${finding.normalized}`;
}

function resolveFindingUrl(
  finding,
  pageUrl
) {
  if (
    !finding ||
    !finding.normalized ||
    !pageUrl
  ) {
    return null;
  }

  if (finding.has_params) {
    return null;
  }

  try {
    const baseUrl =
      new URL(pageUrl);

    if (
      baseUrl.protocol !== "http:" &&
      baseUrl.protocol !== "https:"
    ) {
      return null;
    }

    const targetUrl =
      finding.type === "url"
        ? new URL(
            finding.normalized
          )
        : new URL(
            finding.normalized,
            baseUrl.href
          );

    if (
      targetUrl.protocol !== "http:" &&
      targetUrl.protocol !== "https:"
    ) {
      return null;
    }

    return targetUrl.href;
  } catch (error) {
    console.error(
      "Failed to resolve finding URL:",
      error
    );

    return null;
  }
}

function isSameOrigin(
  targetUrl,
  pageUrl
) {
  try {
    const target =
      new URL(targetUrl);

    const page =
      new URL(pageUrl);

    return (
      target.origin ===
      page.origin
    );
  } catch {
    return false;
  }
}

function getFindingOrigin(
  finding,
  pageUrl
) {
  if (!finding?.source) {
    return "unknown";
  }

  const source =
    String(finding.source);

  if (
    source.toLowerCase() ===
    "inline"
  ) {
    return "first-party";
  }

  try {
    const page =
      new URL(pageUrl);

    const sourceUrl =
      new URL(
        source,
        page.href
      );

    if (
      sourceUrl.protocol !== "http:" &&
      sourceUrl.protocol !== "https:"
    ) {
      return "unknown";
    }

    return (
      sourceUrl.origin ===
      page.origin
    )
      ? "first-party"
      : "third-party";
  } catch {
    return "unknown";
  }
}

function isPotentiallyStateChangingFinding(
  finding,
  pageUrl
) {
  const targetUrl =
    resolveFindingUrl(
      finding,
      pageUrl
    );

  if (!targetUrl) {
    return false;
  }

  try {
    const url =
      new URL(targetUrl);

    const pathTokens =
      url.pathname
        .split("/")
        .filter(Boolean)
        .map((segment) => {
          try {
            return decodeURIComponent(
              segment
            ).toLowerCase();
          } catch {
            return segment.toLowerCase();
          }
        });

    for (
      const token of pathTokens
    ) {
      if (
        CHECK_ALL_RISKY_TOKENS.has(
          token
        )
      ) {
        return true;
      }
    }

    for (
      const [key, value] of
      url.searchParams
    ) {
      if (
        CHECK_ALL_RISKY_TOKENS.has(
          key.toLowerCase()
        ) ||
        CHECK_ALL_RISKY_TOKENS.has(
          value.toLowerCase()
        )
      ) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

function getStatusText(status) {
  const statusTexts = {
    200: "OK",
    201: "Created",
    202: "Accepted",
    204: "No Content",
    300: "Multiple Choices",
    301: "Moved Permanently",
    302: "Found",
    303: "See Other",
    304: "Not Modified",
    307: "Temporary Redirect",
    308: "Permanent Redirect",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    408: "Request Timeout",
    409: "Conflict",
    429: "Too Many Requests",
    500: "Internal Server Error",
    501: "Not Implemented",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout"
  };

  return (
    statusTexts[status] ?? ""
  );
}

function formatStatus(
  status,
  statusText
) {
  const text =
    statusText ||
    getStatusText(status);

  return `${status} ${text}`.trim();
}

function getObservedStatuses() {
  const statuses = new Set();

  for (
    const state of checkStates.values()
  ) {
    if (
      state?.state !== "observed"
    ) {
      continue;
    }

    if (
      Number.isInteger(
        state.status
      )
    ) {
      statuses.add(
        state.status
      );
    }
  }

  return [...statuses].sort(
    (a, b) => a - b
  );
}

function renderStatusFilterOptions() {
  statusFilterOptions.replaceChildren();

  const statuses =
    getObservedStatuses();

  if (statuses.length === 0) {
    statusFilterSection.hidden =
      true;

    activeFilter.statuses.clear();

    return;
  }

  statusFilterSection.hidden =
    false;

  for (
    const status of statuses
  ) {
    const label =
      document.createElement(
        "label"
      );

    label.className =
      "filter-checkbox";

    const checkbox =
      document.createElement(
        "input"
      );

    checkbox.type = "checkbox";

    checkbox.dataset.filterType =
      "status";

    checkbox.dataset.filterValue =
      String(status);

    checkbox.checked =
      activeFilter.statuses.has(
        status
      );

    const text =
      document.createElement(
        "span"
      );

    text.textContent =
      String(status);

    label.appendChild(
      checkbox
    );

    label.appendChild(
      text
    );

    checkbox.addEventListener(
      "change",
      () => {
        applyFilter(
          "status",
          status,
          checkbox.checked
        );
      }
    );

    statusFilterOptions.appendChild(
      label
    );
  }
}

function updateFilterButton() {
  const count =
    activeFilter.types.size +
    activeFilter.params.size +
    activeFilter.origins.size +
    activeFilter.statuses.size;

  filterButton.textContent =
    count > 0
      ? `Filter (${count})`
      : "Filter";
}

function syncFilterCheckboxes() {
  document
    .querySelectorAll(
      '.filter-menu input[type="checkbox"]'
    )
    .forEach((checkbox) => {
      const type =
        checkbox.dataset.filterType;

      const value =
        checkbox.dataset.filterValue;

      if (type === "type") {
        checkbox.checked =
          activeFilter.types.has(
            value
          );
      }

      if (type === "params") {
        checkbox.checked =
          activeFilter.params.has(
            value
          );
      }

      if (type === "origin") {
        checkbox.checked =
          activeFilter.origins.has(
            value
          );
      }

      if (type === "status") {
        checkbox.checked =
          activeFilter.statuses.has(
            Number(value)
          );
      }
    });
}

function applyFilter(
  type,
  value,
  checked
) {
  if (type === "type") {
    if (checked) {
      activeFilter.types.add(
        value
      );
    } else {
      activeFilter.types.delete(
        value
      );
    }
  }

  if (type === "params") {
    if (checked) {
      activeFilter.params.add(
        value
      );
    } else {
      activeFilter.params.delete(
        value
      );
    }
  }

  if (type === "origin") {
    if (checked) {
      activeFilter.origins.add(
        value
      );
    } else {
      activeFilter.origins.delete(
        value
      );
    }
  }

  if (type === "status") {
    const status =
      Number(value);

    if (checked) {
      activeFilter.statuses.add(
        status
      );
    } else {
      activeFilter.statuses.delete(
        status
      );
    }
  }

  updateFilterButton();
  renderFindings();
}

function clearFilters() {
  activeFilter = {
    types: new Set(),
    params: new Set(),
    origins: new Set(),
    statuses: new Set()
  };

  syncFilterCheckboxes();
  updateFilterButton();
  renderFindings();
}

function getFilteredFindings() {
  const query =
    searchInput.value
      .trim()
      .toLowerCase();

  return findings.filter(
    (finding) => {
      if (
        activeFilter.types.size > 0 &&
        !activeFilter.types.has(
          finding.type
        )
      ) {
        return false;
      }

      if (
        activeFilter.params.size > 0
      ) {
        const parameterType =
          finding.has_params
            ? "with"
            : "without";

        if (
          !activeFilter.params.has(
            parameterType
          )
        ) {
          return false;
        }
      }

      if (
        activeFilter.origins.size > 0
      ) {
        const origin =
          getFindingOrigin(
            finding,
            currentUrl
          );

        if (
          !activeFilter.origins.has(
            origin
          )
        ) {
          return false;
        }
      }

      if (
        activeFilter.statuses.size > 0
      ) {
        const state =
          checkStates.get(
            getFindingKey(finding)
          );

        if (
          state?.state !==
          "observed"
        ) {
          return false;
        }

        if (
          !activeFilter.statuses.has(
            state.status
          )
        ) {
          return false;
        }
      }

      if (!query) {
        return true;
      }

      return finding.normalized
        .toLowerCase()
        .includes(query);
    }
  );
}

async function openFinding(finding) {
  const tab =
    await getActiveTab();

  if (!tab?.url) {
    setStatus(
      "Active tab URL not available."
    );

    return;
  }

  const url =
    resolveFindingUrl(
      finding,
      tab.url
    );

  if (!url) {
    setStatus(
      "This finding cannot be opened directly."
    );

    return;
  }

  try {
    await browser.tabs.create({
      url,
      active: true
    });
  } catch (error) {
    console.error(
      "Failed to open finding:",
      error
    );

    setStatus(
      "Failed to open endpoint."
    );
  }
}

function createCheckStatus(finding) {
  const container =
    document.createElement(
      "div"
    );

  container.className =
    "check-status";

  const state =
    checkStates.get(
      getFindingKey(finding)
    );

  if (!state) {
    container.textContent =
      finding.has_params
        ? "Not checked · Parameterized"
        : "Not checked";

    return container;
  }

  if (
    state.state === "checking"
  ) {
    container.textContent =
      "Checking...";

    return container;
  }

  if (
    state.state === "skipped"
  ) {
    container.textContent =
      `Skipped · ${state.reason}`;

    return container;
  }

  if (
    state.state === "error"
  ) {
    container.textContent =
      state.error;

    return container;
  }

  if (
    state.state !== "observed"
  ) {
    return container;
  }

  const parts = [];

  parts.push(
    formatStatus(
      state.status,
      state.statusText
    )
  );

  parts.push(
    `${state.duration} ms`
  );

  if (state.contentType) {
    parts.push(
      state.contentType
    );
  }

  container.textContent =
    parts.join(" · ");

  if (
    state.redirected &&
    state.finalUrl
  ) {
    const redirect =
      document.createElement(
        "div"
      );

    redirect.className =
      "check-redirect";

    redirect.textContent =
      `↪ ${state.finalUrl}`;

    container.appendChild(
      redirect
    );
  }

  return container;
}

function createCheckButton(finding) {
  const button =
    document.createElement(
      "button"
    );

  button.className =
    "check-button";

  button.type = "button";
  button.textContent = "Check";

  if (finding.has_params) {
    button.disabled = true;

    button.title =
      "Parameterized finding cannot be checked directly.";

    return button;
  }

  const state =
    checkStates.get(
      getFindingKey(finding)
    );

  if (
    state?.state === "checking"
  ) {
    button.disabled = true;

    button.textContent =
      "Checking...";

    return button;
  }

  button.addEventListener(
    "click",
    () => {
      checkFinding(finding);
    }
  );

  return button;
}

function renderFindings() {
  renderStatusFilterOptions();

  const filtered =
    getFilteredFindings();

  resultsContainer.replaceChildren();

  if (filtered.length === 0) {
    const empty =
      document.createElement(
        "div"
      );

    empty.className =
      "empty";

    empty.textContent =
      findings.length === 0
        ? "No findings."
        : "No matches.";

    resultsContainer.appendChild(
      empty
    );

    countElement.textContent =
      "0";

    return;
  }

  for (
    const finding of filtered
  ) {
    const element =
      document.createElement(
        "div"
      );

    element.className =
      "result";

    const main =
      document.createElement(
        "div"
      );

    main.className =
      "finding-main";

    const endpointButton =
      document.createElement(
        "button"
      );

    endpointButton.className =
      "finding-link";

    endpointButton.type =
      "button";

    endpointButton.textContent =
      finding.normalized;

    endpointButton.title =
      "Open endpoint";

    endpointButton.addEventListener(
      "click",
      () => {
        openFinding(finding);
      }
    );

    main.appendChild(
      endpointButton
    );

    main.appendChild(
      createCheckStatus(
        finding
      )
    );

    element.appendChild(
      main
    );

    element.appendChild(
      createCheckButton(
        finding
      )
    );

    resultsContainer.appendChild(
      element
    );
  }

  countElement.textContent =
    filtered.length;
}

function formatFindingForCopy(finding) {
  const origin =
    getFindingOrigin(
      finding,
      currentUrl
    );

  const state =
    checkStates.get(
      getFindingKey(finding)
    );

  let result;

  if (
    state?.state === "observed"
  ) {
    const parts = [
      formatStatus(
        state.status,
        state.statusText
      ),
      `${state.duration} ms`
    ];

    if (state.contentType) {
      parts.push(
        state.contentType
      );
    }

    result =
      `${finding.normalized} → ${parts.join(" · ")}`;

    if (
      state.redirected &&
      state.finalUrl
    ) {
      result +=
        ` · Redirected → ${state.finalUrl}`;
    }
  } else if (
    state?.state === "checking"
  ) {
    result =
      `${finding.normalized} → Checking...`;
  } else if (
    state?.state === "skipped"
  ) {
    result =
      `${finding.normalized} → Skipped · ${state.reason}`;
  } else if (
    state?.state === "error"
  ) {
    result =
      `${finding.normalized} → ${state.error}`;
  } else if (finding.has_params) {
    result =
      `${finding.normalized} → Not checked · Parameterized`;
  } else {
    result =
      `${finding.normalized} → Not checked`;
  }

  return `${result} · Source: ${origin}`;
}

function getFilterDescription() {
  const lines = [];

  if (
    activeFilter.types.size === 0
  ) {
    lines.push(
      "Type: All"
    );
  } else {
    const types = [];

    if (
      activeFilter.types.has(
        "path"
      )
    ) {
      types.push("Path");
    }

    if (
      activeFilter.types.has(
        "url"
      )
    ) {
      types.push("URL");
    }

    lines.push(
      `Type: ${types.join(", ")}`
    );
  }

  if (
    activeFilter.params.size === 0
  ) {
    lines.push(
      "Parameters: All"
    );
  } else {
    const params = [];

    if (
      activeFilter.params.has(
        "with"
      )
    ) {
      params.push(
        "With params"
      );
    }

    if (
      activeFilter.params.has(
        "without"
      )
    ) {
      params.push(
        "Without params"
      );
    }

    lines.push(
      `Parameters: ${params.join(", ")}`
    );
  }

  if (
    activeFilter.origins.size === 0
  ) {
    lines.push(
      "Origin: All"
    );
  } else {
    const origins = [];

    if (
      activeFilter.origins.has(
        "first-party"
      )
    ) {
      origins.push(
        "First-party"
      );
    }

    if (
      activeFilter.origins.has(
        "third-party"
      )
    ) {
      origins.push(
        "Third-party"
      );
    }

    if (
      activeFilter.origins.has(
        "unknown"
      )
    ) {
      origins.push(
        "Unknown"
      );
    }

    lines.push(
      `Origin: ${origins.join(", ")}`
    );
  }

  if (
    activeFilter.statuses.size === 0
  ) {
    lines.push(
      "Status: All"
    );
  } else {
    const statuses =
      [...activeFilter.statuses]
        .sort(
          (a, b) => a - b
        )
        .join(", ");

    lines.push(
      `Status: ${statuses}`
    );
  }

  return lines;
}

async function copyAll() {
  const filtered =
    getFilteredFindings();

  if (filtered.length === 0) {
    setStatus(
      "Nothing to copy."
    );

    return;
  }

  const filterDescription =
    getFilterDescription();

  const results =
    filtered.map(
      formatFindingForCopy
    );

  const text = [
    "Path Lens results",
    "",
    "Filters:",
    ...filterDescription,
    "",
    ...results
  ].join("\n");

  try {
    await navigator.clipboard.writeText(
      text
    );

    setStatus(
      `Copied ${filtered.length} findings.`
    );
  } catch (error) {
    console.error(
      "Copy all failed:",
      error
    );

    setStatus(
      "Copy failed."
    );
  }
}

async function requestHostPermission(
  targetUrl
) {
  try {
    const endpointUrl =
      new URL(targetUrl);

    const pattern =
      `${endpointUrl.protocol}//${endpointUrl.host}/*`;

    const alreadyGranted =
      await browser.permissions.contains({
        origins: [pattern]
      });

    if (alreadyGranted) {
      return true;
    }

    return await browser.permissions.request({
      origins: [pattern]
    });
  } catch (error) {
    console.error(
      "Permission request failed:",
      error
    );

    return false;
  }
}

async function checkInPage(
  tabId,
  targetUrl
) {
  const results =
    await browser.scripting.executeScript({
      target: {
        tabId
      },

      world: "ISOLATED",

      func: async (
        url,
        timeoutMs
      ) => {
        const controller =
          new AbortController();

        const timeoutId =
          setTimeout(
            () => {
              controller.abort();
            },
            timeoutMs
          );

        const started =
          performance.now();

        try {
          const response =
            await fetch(url, {
              method: "GET",
              credentials: "same-origin",
              redirect: "follow",
              cache: "no-store",
              signal:
                controller.signal
            });

          const duration =
            Math.round(
              performance.now() -
                started
            );

          return {
            state: "observed",
            status:
              response.status,
            statusText:
              response.statusText,
            duration,
            contentType:
              response.headers.get(
                "content-type"
              ),
            redirected:
              response.redirected,
            finalUrl:
              response.url
          };
        } catch (error) {
          const duration =
            Math.round(
              performance.now() -
                started
            );

          if (
            error?.name ===
            "AbortError"
          ) {
            return {
              state: "error",
              error: "Timeout",
              duration
            };
          }

          return {
            state: "error",
            error:
              error?.message ||
              "Network error",
            duration
          };
        } finally {
          clearTimeout(
            timeoutId
          );
        }
      },

      args: [
        targetUrl,
        CHECK_TIMEOUT_MS
      ]
    });

  return (
    results[0]?.result ?? {
      state: "error",
      error:
        "No check result."
    }
  );
}

async function checkFromExtension(
  targetUrl
) {
  const controller =
    new AbortController();

  const timeoutId =
    setTimeout(
      () => {
        controller.abort();
      },
      CHECK_TIMEOUT_MS
    );

  const started =
    performance.now();

  try {
    const response =
      await fetch(targetUrl, {
        method: "GET",
        credentials: "include",
        redirect: "follow",
        cache: "no-store",
        signal:
          controller.signal
      });

    const duration =
      Math.round(
        performance.now() -
          started
      );

    return {
      state: "observed",
      status:
        response.status,
      statusText:
        response.statusText,
      duration,
      contentType:
        response.headers.get(
          "content-type"
        ),
      redirected:
        response.redirected,
      finalUrl:
        response.url
    };
  } catch (error) {
    const duration =
      Math.round(
        performance.now() -
          started
      );

    if (
      error?.name ===
      "AbortError"
    ) {
      return {
        state: "error",
        error: "Timeout",
        duration
      };
    }

    return {
      state: "error",
      error:
        error?.message ||
        "Network error",
      duration
    };
  } finally {
    clearTimeout(
      timeoutId
    );
  }
}

async function checkFinding(
  finding,
  render = true,
  pageUrl = null,
  tabId = null
) {
  const key =
    getFindingKey(finding);

  let baseUrl = pageUrl;
  let activeTabId = tabId;

  if (
    !baseUrl ||
    !activeTabId
  ) {
    const tab =
      await getActiveTab();

    if (!tab?.id || !tab.url) {
      const result = {
        state: "error",
        error:
          "Active tab not available."
      };

      checkStates.set(
        key,
        result
      );

      if (render) {
        renderFindings();
      }

      return result;
    }

    baseUrl = tab.url;
    activeTabId = tab.id;
  }

  const targetUrl =
    resolveFindingUrl(
      finding,
      baseUrl
    );

  if (!targetUrl) {
    const result = {
      state: "error",
      error: finding.has_params
        ? "Parameterized finding cannot be checked directly."
        : "Invalid finding URL."
    };

    checkStates.set(
      key,
      result
    );

    if (render) {
      renderFindings();
    }

    return result;
  }

  checkStates.set(
    key,
    {
      state: "checking"
    }
  );

  if (render) {
    renderFindings();
  }

  try {
    let result;

    if (
      isSameOrigin(
        targetUrl,
        baseUrl
      )
    ) {
      result =
        await checkInPage(
          activeTabId,
          targetUrl
        );
    } else {
      const granted =
        await requestHostPermission(
          targetUrl
        );

      if (!granted) {
        result = {
          state: "error",
          error:
            "Permission denied."
        };
      } else {
        result =
          await checkFromExtension(
            targetUrl
          );
      }
    }

    checkStates.set(
      key,
      result
    );

    if (render) {
      renderFindings();
    }

    return result;
  } catch (error) {
    console.error(
      "Check failed:",
      error
    );

    const result = {
      state: "error",
      error:
        error instanceof Error
          ? error.message
          : "Check failed."
    };

    checkStates.set(
      key,
      result
    );

    if (render) {
      renderFindings();
    }

    return result;
  }
}

async function checkAll() {
  if (
    checkAllButton.disabled
  ) {
    return;
  }

  const tab =
    await getActiveTab();

  if (!tab?.id || !tab.url) {
    setStatus(
      "Active tab not available."
    );

    return;
  }

  let pageUrl;

  try {
    pageUrl =
      new URL(tab.url);
  } catch {
    setStatus(
      "Active tab URL is invalid."
    );

    return;
  }

  const sameOriginFindings = [];
  const crossOriginFindings = [];
  const riskyFindings = [];

  for (
    const finding of findings
  ) {
    if (finding.has_params) {
      continue;
    }

    const targetUrl =
      resolveFindingUrl(
        finding,
        tab.url
      );

    if (!targetUrl) {
      continue;
    }

    if (
      !isSameOrigin(
        targetUrl,
        pageUrl.href
      )
    ) {
      crossOriginFindings.push(
        finding
      );

      continue;
    }

    if (
      isPotentiallyStateChangingFinding(
        finding,
        pageUrl.href
      )
    ) {
      riskyFindings.push(
        finding
      );

      continue;
    }

    sameOriginFindings.push(
      finding
    );
  }

  for (
    const finding of
    crossOriginFindings
  ) {
    checkStates.set(
      getFindingKey(finding),
      {
        state: "skipped",
        reason: "Cross-origin"
      }
    );
  }

  for (
    const finding of
    riskyFindings
  ) {
    checkStates.set(
      getFindingKey(finding),
      {
        state: "skipped",
        reason:
          "Potentially state-changing"
      }
    );
  }

  if (
    sameOriginFindings.length ===
    0
  ) {
    renderFindings();

    const reasons = [];

    if (
      crossOriginFindings.length > 0
    ) {
      reasons.push(
        `${crossOriginFindings.length} cross-origin skipped`
      );
    }

    if (
      riskyFindings.length > 0
    ) {
      reasons.push(
        `${riskyFindings.length} potentially state-changing skipped`
      );
    }

    setStatus(
      reasons.length > 0
        ? `Nothing checked · ${reasons.join(" · ")}.`
        : "No checkable findings."
    );

    return;
  }

  checkAllButton.disabled = true;
  scanButton.disabled = true;

  for (
    const finding of
    sameOriginFindings
  ) {
    checkStates.set(
      getFindingKey(finding),
      {
        state: "checking"
      }
    );
  }

  renderFindings();

  const total =
    sameOriginFindings.length;

  let nextIndex = 0;
  let completed = 0;
  let responses = 0;

  checkAllButton.textContent =
    `Checking 0/${total}`;

  setStatus(
    `Checking 0 / ${total}...`
  );

  async function worker() {
    while (true) {
      const index =
        nextIndex++;

      if (index >= total) {
        return;
      }

      const finding =
        sameOriginFindings[index];

      const result =
        await checkFinding(
          finding,
          false,
          tab.url,
          tab.id
        );

      completed += 1;

      if (
        result?.state ===
        "observed"
      ) {
        responses += 1;
      }

      renderFindings();

      checkAllButton.textContent =
        completed < total
          ? `Checking ${completed}/${total}`
          : "Check all";

      setStatus(
        `Checking ${completed} / ${total}...`
      );
    }
  }

  try {
    await Promise.all(
      Array.from(
        {
          length: Math.min(
            CHECK_CONCURRENCY,
            total
          )
        },
        () => worker()
      )
    );
  } finally {
    checkAllButton.disabled =
      false;

    scanButton.disabled =
      false;

    checkAllButton.textContent =
      "Check all";
  }

  const summary = [
    `Checked ${total}`,
    `${responses} responses`
  ];

  if (
    crossOriginFindings.length > 0
  ) {
    summary.push(
      `${crossOriginFindings.length} cross-origin skipped`
    );
  }

  if (
    riskyFindings.length > 0
  ) {
    summary.push(
      `${riskyFindings.length} potentially state-changing skipped`
    );
  }

  setStatus(
    summary.join(" · ")
  );

  renderFindings();
}

async function collectScripts() {
  const tab =
    await getActiveTab();

  if (!tab?.id) {
    throw new Error(
      "Active tab not found."
    );
  }

  const results =
    await browser.scripting.executeScript(
      {
        target: {
          tabId: tab.id
        },

        world: "ISOLATED",

        func: () => {
          const external =
            new Set();

          const inline = [];

          for (
            const script of
            document.scripts
          ) {
            const src =
              script.src;

            if (src) {
              if (
                src.startsWith(
                  "http://"
                ) ||
                src.startsWith(
                  "https://"
                )
              ) {
                external.add(
                  src
                );
              }

              continue;
            }

            const content =
              script.textContent?.trim();

            if (content) {
              inline.push(
                content
              );
            }
          }

          for (
            const entry of
            performance.getEntriesByType(
              "resource"
            )
          ) {
            const isScript =
              entry.initiatorType ===
                "script" ||
              /\.m?js(?:[?#]|$)/i.test(
                entry.name
              );

            if (!isScript) {
              continue;
            }

            if (
              entry.name.startsWith(
                "http://"
              ) ||
              entry.name.startsWith(
                "https://"
              )
            ) {
              external.add(
                entry.name
              );
            }
          }

          return {
            external: [
              ...external
            ],
            inline
          };
        }
      }
    );

  return (
    results[0]?.result ?? {
      external: [],
      inline: []
    }
  );
}

async function fetchScriptsInPage(
  tabId,
  urls
) {
  const results =
    await browser.scripting.executeScript(
      {
        target: {
          tabId
        },

        world: "ISOLATED",

        func: async (
          scriptUrls
        ) => {
          const results =
            await Promise.allSettled(
              scriptUrls.map(
                async (url) => {
                  const response =
                    await fetch(
                      url
                    );

                  if (!response.ok) {
                    throw new Error(
                      `HTTP ${response.status}`
                    );
                  }

                  return {
                    url,
                    content:
                      await response.text()
                  };
                }
              )
            );

          const scripts = [];
          const failures = [];

          for (
            let index = 0;
            index < results.length;
            index += 1
          ) {
            const result =
              results[index];

            if (
              result.status ===
              "fulfilled"
            ) {
              scripts.push(
                result.value
              );

              continue;
            }

            failures.push({
              url:
                scriptUrls[index],
              name:
                result.reason?.name,
              message:
                result.reason?.message ||
                String(
                  result.reason
                )
            });
          }

          return {
            scripts,
            failures
          };
        },

        args: [urls]
      }
    );

  return (
    results[0]?.result ?? {
      scripts: [],
      failures: []
    }
  );
}

async function scan() {
  scanButton.disabled = true;
  checkAllButton.disabled =
    true;

  controls.hidden = true;
  filterMenu.hidden = true;

  resultsContainer.replaceChildren();
  countElement.textContent =
    "0";

  checkStates.clear();

  activeFilter = {
    types: new Set(["path"]),
    params: new Set(),
    origins: new Set(),
    statuses: new Set()
  };

  syncFilterCheckboxes();

  try {
    const tab =
      await getActiveTab();

    if (!tab?.id || !tab.url) {
      throw new Error(
        "Active tab not available."
      );
    }

    currentUrl = tab.url;

    scanButton.textContent =
      "Scanning...";

    setStatus(
      "Collecting scripts..."
    );

    const data =
      await collectScripts();

    setStatus(
      "Fetching JavaScript..."
    );

    const fetched =
      await fetchScriptsInPage(
        tab.id,
        data.external
      );

    setStatus(
      "Extracting paths..."
    );

    findings =
      extractFindings(
        fetched.scripts,
        data.inline
      );

    saveScan(currentUrl, {
      scannedAt: Date.now(),
      findings
    });

    controls.hidden = false;

    updateFilterButton();
    renderFindings();

    const failureSummary =
      fetched.failures.length > 0
        ? ` · ${fetched.failures.length} scripts unavailable`
        : "";

    setStatus(
      `${findings.length} findings from ${fetched.scripts.length} scripts${failureSummary}.`
    );
  } catch (error) {
    console.error(
      "Scan failed:",
      error
    );

    findings = [];
    checkStates.clear();

    setStatus(
      `Scan failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  } finally {
    scanButton.disabled =
      false;

    checkAllButton.disabled =
      false;

    scanButton.textContent =
      findings.length > 0
        ? "Rescan"
        : "Scan";
  }
}

async function initialize() {
  try {
    const tab =
      await getActiveTab();

    if (!tab?.url) {
      controls.hidden = true;
      resultsContainer.replaceChildren();
      countElement.textContent =
        "0";

      setStatus(
        "No scan yet."
      );

      return;
    }

    currentUrl = tab.url;

    const savedScan =
      loadSavedScan(
        currentUrl
      );

    if (!savedScan) {
      controls.hidden = true;
      resultsContainer.replaceChildren();
      countElement.textContent =
        "0";

      setStatus(
        "No scan yet."
      );

      return;
    }

    findings =
      Array.isArray(
        savedScan.findings
      )
        ? savedScan.findings
        : [];

    controls.hidden = false;

    updateFilterButton();
    renderFindings();

    const date =
      new Date(
        savedScan.scannedAt
      );

    setStatus(
      `Last scan: ${date.toLocaleTimeString()}`
    );
  } catch (error) {
    console.error(
      "Initialization failed:",
      error
    );

    controls.hidden = true;
    resultsContainer.replaceChildren();
    countElement.textContent =
      "0";

    setStatus(
      "No scan yet."
    );
  }
}

filterButton.addEventListener(
  "click",
  () => {
    filterMenu.hidden =
      !filterMenu.hidden;
  }
);

document
  .querySelectorAll(
    '.filter-menu input[type="checkbox"]'
  )
  .forEach((checkbox) => {
    checkbox.addEventListener(
      "change",
      () => {
        applyFilter(
          checkbox.dataset
            .filterType,
          checkbox.dataset
            .filterValue,
          checkbox.checked
        );
      }
    );
  });

clearFiltersButton.addEventListener(
  "click",
  clearFilters
);

scanButton.addEventListener(
  "click",
  scan
);

searchInput.addEventListener(
  "input",
  renderFindings
);

copyAllButton.addEventListener(
  "click",
  copyAll
);

checkAllButton.addEventListener(
  "click",
  checkAll
);

initialize();