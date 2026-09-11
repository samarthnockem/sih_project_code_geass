(function () {
  "use strict";

  const LOCAL_API_BASE_URL = "http://localhost:4000";
  const PRODUCTION_API_BASE_URL = "https://blockchain-project-sih.onrender.com";
  const DEFAULT_API_BASE_URL =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? LOCAL_API_BASE_URL
      : PRODUCTION_API_BASE_URL;
  const EMPTY_STATUSES = new Set([204, 205]);
  const KNOWN_STATUS_MESSAGES = {
    400: "The request was invalid.",
    401: "Please sign in and try again.",
    403: "You do not have permission to perform this action.",
    404: "The requested resource was not found.",
    409: "The request conflicts with the current resource state.",
    413: "The request is too large.",
    429: "Too many requests. Please wait and try again.",
    500: "The server could not complete the request."
  };
  const FORBIDDEN_HEADER_NAMES = new Set(["authorization", "cookie", "set-cookie"]);

  class ApiError extends Error {
    constructor(status, message, details) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.details = details || null;
    }
  }

  let apiBaseUrl =
    typeof window.KRYPTO_API_BASE_URL === "string" && window.KRYPTO_API_BASE_URL.trim()
      ? window.KRYPTO_API_BASE_URL.trim()
      : DEFAULT_API_BASE_URL;

  function setBaseUrl(nextBaseUrl) {
    if (typeof nextBaseUrl !== "string" || !nextBaseUrl.trim()) {
      throw new TypeError("API base URL must be a non-empty string.");
    }

    apiBaseUrl = nextBaseUrl.trim().replace(/\/+$/, "");
  }

  function getBaseUrl() {
    return apiBaseUrl;
  }

  function buildUrl(path, query) {
    const pathText = String(path || "");
    const normalizedPath = pathText.startsWith("/") ? pathText : `/${pathText}`;
    const url = new URL(`${apiBaseUrl.replace(/\/+$/, "")}${normalizedPath}`);

    if (query && typeof query === "object") {
      Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === null) return;

        if (Array.isArray(value)) {
          value.forEach((item) => {
            if (item !== undefined && item !== null) {
              url.searchParams.append(key, String(item));
            }
          });
          return;
        }

        url.searchParams.set(key, String(value));
      });
    }

    return url.toString();
  }

  function safeHeaders(headers) {
    const output = new Headers();
    const input = new Headers(headers || {});

    input.forEach((value, key) => {
      if (!FORBIDDEN_HEADER_NAMES.has(key.toLowerCase())) {
        output.set(key, value);
      }
    });

    return output;
  }

  function isFormLike(body) {
    return (
      typeof FormData !== "undefined" && body instanceof FormData
    ) || (
      typeof Blob !== "undefined" && body instanceof Blob
    ) || (
      typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer
    ) || ArrayBuffer.isView(body);
  }

  function prepareBody(body, headers) {
    if (body === undefined || body === null) return undefined;
    if (isFormLike(body)) return body;
    if (typeof body === "string") return body;

    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    return JSON.stringify(body);
  }

  async function parseResponseBody(response, responseType) {
    if (EMPTY_STATUSES.has(response.status)) return null;

    if (responseType === "blob") return response.blob();
    if (responseType === "arrayBuffer") return response.arrayBuffer();
    if (responseType === "text") return response.text();

    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("application/json")) {
      return response.json();
    }

    const text = await response.text();
    return text || null;
  }

  function errorMessageFor(status, parsedBody) {
    if (parsedBody && typeof parsedBody === "object") {
      if (parsedBody.error && typeof parsedBody.error === "object") {
        if (typeof parsedBody.error.message === "string" && parsedBody.error.message.trim()) {
          return parsedBody.error.message;
        }
      }
      if (typeof parsedBody.message === "string" && parsedBody.message.trim()) {
        return parsedBody.message;
      }
      if (typeof parsedBody.error === "string" && parsedBody.error.trim()) {
        return parsedBody.error;
      }
    }

    return KNOWN_STATUS_MESSAGES[status] || `Request failed with status ${status}.`;
  }

  async function request(method, path, options) {
    const requestOptions = options || {};
    const headers = safeHeaders(requestOptions.headers);
    const body = prepareBody(requestOptions.body, headers);
    const response = await fetch(buildUrl(path, requestOptions.query), {
      method,
      credentials: "include",
      headers,
      body,
      signal: requestOptions.signal
    });
    const parsedBody = await parseResponseBody(response, requestOptions.responseType);

    if (!response.ok) {
      throw new ApiError(response.status, errorMessageFor(response.status, parsedBody), parsedBody);
    }

    return parsedBody;
  }

  const api = {
    ApiError,
    getBaseUrl,
    setBaseUrl,
    get: (path, options) => request("GET", path, options),
    post: (path, body, options) => request("POST", path, { ...(options || {}), body }),
    patch: (path, body, options) => request("PATCH", path, { ...(options || {}), body }),
    put: (path, body, options) => request("PUT", path, { ...(options || {}), body }),
    delete: (path, options) => request("DELETE", path, options)
  };

  window.KryptoVaultApi = api;
})();
