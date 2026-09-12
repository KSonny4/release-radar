# Agent instructions

## Project-owned instructions

Read [README.md](README.md), particularly its local development, architecture and deployment sections. Resolve available commands from [package.json](package.json) and the actual workflows under [.github](.github). Use [docs](docs), [migrations](migrations) and [test](test) for the relevant change. Preserve existing build, test, migration, review and deployment rules; a documentation pointer does not authorise running production migrations or deploying.

## Shared guidance for owner-authorised agents

<!-- shared-context-guidance:start -->
For work authorised by this repository's owner, use [Engineering Guidance](https://github.com/KSonny4/engineering-guidance) at revision `274363d12d592c0060c8941557c68a8d07728186`. Start at [the pinned AGENTS.md](https://github.com/KSonny4/engineering-guidance/blob/274363d12d592c0060c8941557c68a8d07728186/AGENTS.md), resolve mandatory links at the same revision, and record what actually loaded. Preserve stricter local instructions and active-session pins.

The shared repository is private. This owner-agent integration does not require outside contributors to have access or publish private guidance here. Owner-authorised agents must report inaccessible required guidance and block the dependent action rather than claim successful loading.

## Cross-project context

[Context Fabric](https://github.com/KSonny4/context-fabric) is the planned shared context provider for ordinary agents across authorised projects. Before substantial exploration, search the configured provider when available for relevant project documentation, prior decisions and related implementations. Verify important results against their original repository, revision and path. Mandatory rules load directly; search ranking cannot omit them.

No endpoint, automatic registration or live index is established by this file. When the provider is unavailable, read this repository and pinned guidance directly, report the missing enrichment, and continue only within the existing task authority. Do not install or deploy new infrastructure to satisfy this documentation.

Use local Graft only when available and applicable, rooted in the current checkout. A global snapshot may differ from local dirty changes. Never share writable graph state between worktrees.

Keep secret values, tokens, environment files and secret-bearing logs out of prompts, Git, generated graphs and context evidence. Only approved non-value references may be shared; runtime access retains its existing separate authorisation.

**Graph Engineering is optional.** Ordinary agents use this repository's normal workflow; this file neither requires GE nor enrols the project. Some projects using shared guidance and Context Fabric will never use GE.
<!-- shared-context-guidance:end -->

## Publishing changes

Publish code, tests and relevant documentation through the existing GitHub review workflow. The planned Context Fabric synchronisation follows accepted GitHub source changes, including ordinary-agent, human and CI changes, without requiring GE receipts. Do not claim that a merge proves deployment, indexing or successful guidance loading.
