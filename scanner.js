"use strict";

function normalizePath(value) {
  const segments = value.split("/");
  const normalizedSegments = [];
  let hasParams = false;

  for (const segment of segments) {
    if (!segment) {
      continue;
    }

    const originalSegment = segment;
    let normalizedSegment = segment;

    normalizedSegment = normalizedSegment.replace(
      /\$\{[^}]*\}/g,
      "{param}"
    );

    normalizedSegment = normalizedSegment.replace(
      /:([A-Za-z_$][\w$]*)/g,
      "{param}"
    );

    normalizedSegment = normalizedSegment.replace(
      /\{[A-Za-z_$][\w$]*\}/g,
      "{param}"
    );

    normalizedSegment = normalizedSegment.replace(
      /\([^)]*\\[dwsDWS][^)]*\)/g,
      "{param}"
    );

    if (normalizedSegment !== originalSegment) {
      hasParams = true;
    }

    const literalSegment = normalizedSegment.replace(
      /\{param\}/g,
      ""
    );

    if (
      !literalSegment &&
      normalizedSegment !== "{param}"
    ) {
      return null;
    }

    if (
      literalSegment &&
      !/[A-Za-z0-9]/.test(literalSegment)
    ) {
      return null;
    }

    normalizedSegments.push(normalizedSegment);
  }

  if (normalizedSegments.length === 0) {
    return null;
  }

  return {
    normalized: `/${normalizedSegments.join("/")}`,
    hasParams
  };
}

function isValidPath(value) {
  if (!value.startsWith("/")) {
    return false;
  }

  if (
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return false;
  }

  if (/[<>\[]/.test(value)) {
    return false;
  }

  return true;
}

function isValidUrl(value) {
  try {
    const url = new URL(value);

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function normalizeCandidate(value) {
  return value
    .trim()
    .replace(/[;,.)]+$/, "");
}

function classifyCandidate(raw) {
  const value = normalizeCandidate(raw);

  if (value.startsWith("/")) {
    if (!isValidPath(value)) {
      return null;
    }

    const normalizedPath = normalizePath(value);

    if (!normalizedPath) {
      return null;
    }

    if (
      hasInvalidCharacters(
        normalizedPath.normalized
      )
    ) {
      return null;
    }

    if (
      hasAdjacentParams(
        normalizedPath.normalized
      )
    ) {
      return null;
    }

    if (
      hasUnclosedInterpolation(value)
    ) {
      return null;
    }

    if (
      isDegenerateSingleSegment(
        normalizedPath.normalized
      )
    ) {
      return null;
    }

    return {
      raw: value,
      normalized: normalizedPath.normalized,
      type: "path",
      has_params: normalizedPath.hasParams
    };
  }

  if (
    value.startsWith("http://") ||
    value.startsWith("https://")
  ) {
    if (!isValidUrl(value)) {
      return null;
    }

    return {
      raw: value,
      normalized: value,
      type: "url",
      has_params: value.includes("${")
    };
  }

  return null;
}

function extractCandidates(text) {
  const candidates = new Set();

  const pathRegex =
    /["'`]((?:\/)[^"'`\s]{2,})["'`]/g;

  for (const match of text.matchAll(pathRegex)) {
    candidates.add(match[1]);
  }

  const urlRegex =
    /["'`](https?:\/\/[^"'`\s]{2,})["'`]/g;

  for (const match of text.matchAll(urlRegex)) {
    candidates.add(match[1]);
  }

  return [...candidates];
}

function extractFindings(
  scripts,
  inlineScripts
) {
  const findings = new Map();

  function process(text, source) {
    for (const candidate of extractCandidates(text)) {
      const finding = classifyCandidate(candidate);

      if (!finding) {
        continue;
      }

      finding.source = source;

      if (!findings.has(finding.normalized)) {
        findings.set(
          finding.normalized,
          finding
        );
      }
    }
  }

  for (const script of scripts) {
    process(
      script.content,
      script.url
    );
  }

  for (const content of inlineScripts) {
    process(
      content,
      "inline"
    );
  }

  return [...findings.values()];
}

function hasInvalidCharacters(value) {
  const cleaned = value.replace(
    /\{param\}/g,
    ""
  );

  return /[^A-Za-z0-9._\-/:?=&%]/.test(
    cleaned
  );
}

function hasAdjacentParams(value) {
  return value.includes(
    "{param}{param}"
  );
}

function hasUnclosedInterpolation(raw) {
  const opens = (
    raw.match(/\$\{/g) ||
    []
  ).length;

  const closes = (
    raw.match(/}/g) ||
    []
  ).length;

  return opens > closes;
}

function isDegenerateSingleSegment(path) {
  const segments = path
    .split("/")
    .filter(Boolean);

  if (segments.length !== 1) {
    return false;
  }

  const segment = segments[0];

  if (/^\d+$/.test(segment)) {
    return true;
  }

  if (segment.length === 1) {
    return true;
  }

  return false;
}