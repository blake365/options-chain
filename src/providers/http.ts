/** Give up on an upstream request rather than hanging the tool call forever. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Turn a fetch rejection into a message that names the timeout explicitly. */
export function describeFetchError(error: unknown): string {
	if (error instanceof Error) {
		if (error.name === "TimeoutError" || error.name === "AbortError") {
			return `request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`;
		}
		return error.message;
	}
	return String(error);
}
