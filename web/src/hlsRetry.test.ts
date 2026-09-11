import { describe, expect, it } from "vitest";
import { isExpiredHLSWindow, shouldRetryHLSNetworkError } from "./hlsRetry";

describe("HLS network retry policy", () => {
  it("does not retry deterministic transcode failures", () => {
    expect(
      shouldRetryHLSNetworkError({ response: { code: 500 } }, 0),
    ).toBe(false);
  });

  it("retries transient failures at most three times", () => {
    expect(
      shouldRetryHLSNetworkError({ response: { code: 503 } }, 0),
    ).toBe(true);
    expect(
      shouldRetryHLSNetworkError({ response: { code: 503 } }, 3),
    ).toBe(false);
  });

  it("does not retry client errors", () => {
    expect(
      shouldRetryHLSNetworkError({ response: { code: 404 } }, 0),
    ).toBe(false);
  });

  it("identifies a retired generation window for a controlled reload", () => {
    expect(isExpiredHLSWindow({ response: { code: 409 } })).toBe(true);
    expect(isExpiredHLSWindow({ response: { code: 404 } })).toBe(false);
  });
});
