# Skill Artifacts

This directory contains both editable Skill source materials and deployable
packages under the repository-level `artifacts/` boundary:

```text
artifacts/
└── skills/
    ├── source/
    │   └── vendor/
    │       ├── catalog.json
    │       └── <skill-name>/
    │           ├── SKILL.md
    │           └── agents/openai.yaml
    └── vendor/
        ├── manifest.json
        └── <skill-name>-<version>.tar.gz
```

- `source/vendor/` is the source of truth. Each Skill is an independently valid Skill directory, and `catalog.json` assigns its immutable release version.
- `vendor/` contains deterministic packages consumed by the Control Plane image and database seed. Do not edit these files by hand.
- Run `npm run skills:package` after changing a Skill or catalog version. Run `npm run skills:check` to verify that committed artifacts match their sources.
- Bump the catalog version whenever packaged Skill content changes. An existing Skill version is immutable once seeded.

## Hindsight coding agents

`hindsight-coding-agent@0.8.2` is the unmodified companion Skill from the official
`@vectorize-io/hindsight-coding-agents@0.8.2` npm archive. Its native plugin is
preinstalled in the Dcode and Pi images; the Instance Memory selection controls
activation. Skill selection alone never grants Memory access.

Source: https://github.com/vectorize-io/hindsight/tree/main/hindsight-integrations/coding-agents
The image dependency lock records the package integrity. Keep the Skill, package
lock and runtime version check synchronized when upgrading.
