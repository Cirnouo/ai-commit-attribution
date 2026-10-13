# Isolated test fixtures

issue-feedback-http.ts replaces fetch only in the Issue entry-point subprocess
test. It records method/path calls and supplies simulated GitHub responses; no
request reaches GitHub. Keep tokens and Issue bodies out of its transcript.
