const DEFAULT_NEXT_PATH = "/dashboard";
const SCHEME_PREFIX_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const CONTROL_CHARS_PATTERN = /[\u0000-\u001f\u007f]/;

export function toSafeNextPath(
  nextParam: string | null | undefined,
  fallback: string = DEFAULT_NEXT_PATH
): string {
  const value = typeof nextParam === "string" ? nextParam.trim() : "";
  if (!value) {
    return fallback;
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  if (value.includes("\\") || value.includes("://")) {
    return fallback;
  }

  if (CONTROL_CHARS_PATTERN.test(value)) {
    return fallback;
  }

  if (SCHEME_PREFIX_PATTERN.test(value) || SCHEME_PREFIX_PATTERN.test(value.slice(1))) {
    return fallback;
  }

  try {
    const parsed = new URL(value, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

