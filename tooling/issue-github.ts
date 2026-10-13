export type IssueRequest = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    endpoint: string,
    body?: Record<string, unknown>,
) => Promise<unknown>;

export class IssueAutomationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'IssueAutomationError';
    }
}

/** Fixed public REST boundary. Neither error bodies nor token-bearing causes escape. */
export function createGitHubIssueRequest(token: string, fetcher: typeof fetch = fetch): IssueRequest {
    if (!token.trim()) throw new IssueAutomationError('Issue feedback requires the built-in GitHub token.');
    return async (method, endpoint, body) => {
        const url = new URL(endpoint, 'https://api.github.com');
        if (
            !endpoint.startsWith('/repos/') ||
            url.origin !== 'https://api.github.com' ||
            url.username ||
            url.password ||
            url.hash
        ) {
            throw new IssueAutomationError('Invalid Issue feedback API endpoint.');
        }
        let response: Response;
        try {
            response = await fetcher(url.href, {
                method,
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `Bearer ${token}`,
                    'X-GitHub-Api-Version': '2026-03-10',
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
                signal: AbortSignal.timeout(30_000),
                redirect: 'error',
            });
        } catch {
            throw new IssueAutomationError('GitHub Issue feedback transport failed.');
        }
        if (!response.ok) throw new IssueAutomationError(`GitHub Issue feedback request failed (${response.status}).`);
        if (response.status === 204) return null;
        try {
            const value: unknown = await response.json();
            return value;
        } catch {
            throw new IssueAutomationError('GitHub Issue feedback returned malformed JSON.');
        }
    };
}
