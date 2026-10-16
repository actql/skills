# ActQL agent skills

Skills that teach a coding agent to set up ActQL, write and run Programs
with an approved write, embed the engine in an application, and build
Connectors. They follow the [Agent Skills](https://agentskills.io)
specification, so Claude Code, Codex, OpenCode and other agents read them
as they are.

| Skill | Use it when |
| --- | --- |
| `actql` | You want to install ActQL, create a project, and write, check, explain and run a Program up to its Checkpoint. Start here. |
| `actql-embed` | Your application runs Programs through `@actql/node`, `@actql/sdk`, the `actql` Python package or `actql-sdk`. |
| `actql-build-connector` | You need ActQL to read or write a system it does not ship with. |

## Install

With the skills CLI, which detects the agents on your machine:

```sh
npx skills add actql/skills
```

Then ask your agent to "Start ActQL setup".

As a Claude Code plugin:

```text
/plugin marketplace add actql/skills
/plugin install actql@actql
```

By hand, for Codex, OpenCode or any agent that reads `.agents/skills`:

```sh
git clone https://github.com/actql/skills /tmp/actql-skills
cp -R /tmp/actql-skills/skills/* ~/.agents/skills/
```

## How the skills are built

`skills/<name>/SKILL.md` is written by hand. Its front matter and the
`references/` directory next to it are generated from the ActQL
documentation by `tools/build.mjs`, which also validates the result against
the specification's limits (name, description length, body under 500 lines,
links that resolve):

```sh
node tools/build.mjs --docs ../actql            # rebuild from a checkout of actql/actql
node tools/build.mjs --docs ../actql --check    # verify nothing is stale
```

`skills.json` lists each skill, its description and the documentation pages
it carries. The generated front matter records the documentation commit the
references came from (`metadata.actql-docs-ref`).

## License

Apache License 2.0. See [LICENSE](LICENSE). The documentation pages under
`references/` are copies from [actql/actql](https://github.com/actql/actql)
under the same license.
