# Issue forms

- bug_report.yaml collects Agent host/version, Skill commit, Node/Git versions,
  reproduction, expected/actual behavior and redacted diagnostics.
- feature_request.yaml collects the problem, proposed behavior and alternatives.
- config.yml preserves freeform Issues and links to private security reporting;
  it is the sole exact YAML filename exception.

Before creating or editing a typed Issue, read the current form and
[typed Issue policy](../../docs/policies/commits-and-scope.md#typed-issue-submissions).
The forms own their labels, generated headings, order, required flags and choices.
Provision both classification labels and template: invalid before deployment.
Use Other for another host and describe its identity in Host version.

Ordinary Issues remain available. Report vulnerabilities privately through
[SECURITY.md](../../SECURITY.md), without publishing sensitive examples.
