---
mode: edit
---
Analyze the user requested part of the codebase (use a suitable <placeholder>) to generate or update `.github/instructions/<placeholder>.instructions.md` for guiding AI coding agents.

Focus on discovering the essential knowledge that would help an AI agents be immediately productive in the <placeholder> part of the codebase. Consider aspects like:
- The design and how it fits into the overall architecture
- Component-specific conventions and patterns that differ from common practices
- Integration points, external dependencies, and cross-component communication patterns
- Common pitfalls, edge cases, and non-obvious behaviors specific to this part of the codebase
- What are common ways to add to this part of the codebase?

Source existing conventions from `.github/instructions/*.instructions.md,CONTRIBUTING.md,README.md}` and cross reference any of these files where relevant.

Guidelines (read more at https://aka.ms/vscode-instructions-docs):
- If `.github/instructions/<placeholder>.instructions.md` exists, merge intelligently - preserve valuable content while updating outdated sections
- Write concise instructions using markdown structure
- Document only discoverable patterns, not aspirational practices
- Reference key files/directories that exemplify important patterns

Your audience is other developers working on this project who know less about this feature area or other agents who come into this area to make changes.

Update `.github/instructions/<placeholder>.instructions.md` for the user. Include an instructions header:
```
---
description: "Discussion of the <placeholder> part of the codebase"
---
```
