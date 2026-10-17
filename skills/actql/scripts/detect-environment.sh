#!/usr/bin/env bash
# Prints what the ActQL setup step needs to know about this machine and the
# current directory as one JSON object. Read-only: it installs nothing.
set -u

json_string() {
  if [ -z "${1:-}" ]; then printf 'null'; return; fi
  printf '"'
  # Work on bytes so JSON controls are escaped without changing UTF-8 paths.
  # No Node/Python dependency: this also runs before either is installed.
  printf '%s' "$1" | od -An -v -tu1 | while read -r json_octets; do
    # od emits only decimal octets and whitespace. Splitting these tokens also
    # accepts its empty trailing line without a Bash 3.2 nounset array error.
    for json_byte in $json_octets; do
      case "$json_byte" in
        34) printf '\\"' ;;
        92) printf '\\\\' ;;
        8) printf '\\b' ;;
        9) printf '\\t' ;;
        10) printf '\\n' ;;
        12) printf '\\f' ;;
        13) printf '\\r' ;;
        *)
          if [ "$json_byte" -lt 32 ]; then
            printf '\\u%04x' "$json_byte"
          else
            printf -v json_octal '\\0%03o' "$json_byte"
            printf '%b' "$json_octal"
          fi ;;
      esac
    done
  done
  printf '"'
}

version_of() { "$@" 2>/dev/null | head -n 1 | tr -d '\r'; }

actql_version=""; command -v actql >/dev/null 2>&1 && actql_version="$(version_of actql version)"
node_version=""; command -v node >/dev/null 2>&1 && node_version="$(version_of node --version)"
npm_version=""; command -v npm >/dev/null 2>&1 && npm_version="$(version_of npm --version)"
python_version=""; python_command=""
for py in python3 python; do
  if command -v "$py" >/dev/null 2>&1; then python_command="$py"; python_version="$(version_of "$py" --version)"; break; fi
done
uv_version=""; command -v uv >/dev/null 2>&1 && uv_version="$(version_of uv --version)"

has() { [ -e "$1" ] && printf 'true' || printf 'false'; }
# Report declarations from their actual manifest tables. A parser failure (or
# a missing parser) is unknown, not evidence that a dependency is absent.
dep_in_package_json() {
  if [ ! -f package.json ]; then printf 'false'; return; fi
  local answer="null"
  if [ -n "$python_command" ]; then
    answer="$("$python_command" -c '
import json, sys
try:
    with open("package.json", encoding="utf-8") as stream:
        value = json.load(stream)
    if not isinstance(value, dict):
        raise ValueError()
    tables = [value.get(key, {}) for key in
              ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies")]
    if any(not isinstance(table, dict) for table in tables):
        raise ValueError()
    print("true" if any(sys.argv[1] in table for table in tables) else "false")
except (OSError, ValueError, TypeError):
    print("null")
' "$1" 2>/dev/null)" || answer="null"
  elif command -v node >/dev/null 2>&1; then
    answer="$(node -e '
try {
  const value = JSON.parse(require("node:fs").readFileSync("package.json", "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw Error();
  const tables = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
    .map(key => Object.hasOwn(value, key) ? value[key] : {});
  if (tables.some(table => table === null || typeof table !== "object" || Array.isArray(table))) throw Error();
  console.log(tables.some(table => Object.hasOwn(table, process.argv[1])) ? "true" : "false");
} catch { console.log("null"); }
' "$1" 2>/dev/null)" || answer="null"
  fi
  case "$answer" in true|false|null) printf '%s' "$answer" ;; *) printf 'null' ;; esac
}
dep_in_pyproject() {
  if [ ! -f pyproject.toml ]; then printf 'false'; return; fi
  local answer="null"
  if [ -n "$python_command" ]; then
    answer="$("$python_command" -c '
import re, sys
try:
    import tomllib
    with open("pyproject.toml", "rb") as stream:
        value = tomllib.load(stream)
    project = value.get("project", {})
    optional = project.get("optional-dependencies", {})
    if not isinstance(optional, dict):
        raise ValueError()
    requirements = [project.get("dependencies", [])] + list(optional.values())
    dependencies = []
    for group in requirements:
        if not isinstance(group, list) or any(not isinstance(item, str) for item in group):
            raise ValueError()
        dependencies.extend(group)
    normalize = lambda name: re.sub(r"[-_.]+", "-", name).lower()
    names = []
    for item in dependencies:
        name = re.match(r"^[ \t]*([A-Za-z0-9][A-Za-z0-9._-]*)", item)
        if name is None:
            raise ValueError()
        names.append(normalize(name[1]))
    poetry = value.get("tool", {}).get("poetry", {})
    groups = poetry.get("group", {})
    if not isinstance(groups, dict):
        raise ValueError()
    tables = [poetry.get("dependencies", {}), poetry.get("dev-dependencies", {})]
    tables.extend(group.get("dependencies", {}) for group in groups.values())
    for table in tables:
        if not isinstance(table, dict):
            raise ValueError()
        names.extend(normalize(name) for name in table)
    print("true" if normalize(sys.argv[1]) in names else "false")
except (ImportError, OSError, ValueError, TypeError, AttributeError):
    print("null")
' "$1" 2>/dev/null)" || answer="null"
  fi
  case "$answer" in true|false|null) printf '%s' "$answer" ;; *) printf 'null' ;; esac
}

# Count filenames, not lines of ls output. Newlines in names are legal, and a
# directory whose name ends in .aql is not a Program file.
aql_files=0
for aql_candidate in ./*.aql; do
  if [ -f "$aql_candidate" ]; then aql_files=$((aql_files + 1)); fi
done

printf '{\n'
printf '  "cwd": %s,\n' "$(json_string "$PWD")"
printf '  "actql_cli": %s,\n' "$(json_string "$actql_version")"
printf '  "node": %s,\n' "$(json_string "$node_version")"
printf '  "npm": %s,\n' "$(json_string "$npm_version")"
printf '  "python": %s,\n' "$(json_string "$python_version")"
printf '  "uv": %s,\n' "$(json_string "$uv_version")"
printf '  "project": {\n'
printf '    "package_json": %s,\n' "$(has package.json)"
printf '    "pyproject_toml": %s,\n' "$(has pyproject.toml)"
printf '    "actql_config": %s,\n' "$(has actql.config.json)"
printf '    "connectors_file": %s,\n' "$(has connectors.json)"
printf '    "state_dir": %s,\n' "$(has .actql)"
printf '    "aql_files": %s\n' "$aql_files"
printf '  },\n'
printf '  "dependencies": {\n'
printf '    "actql_node": %s,\n' "$(dep_in_package_json '@actql/node')"
printf '    "actql_sdk": %s,\n' "$(dep_in_package_json '@actql/sdk')"
printf '    "actql_python": %s,\n' "$(dep_in_pyproject 'actql')"
printf '    "actql_sdk_python": %s\n' "$(dep_in_pyproject 'actql-sdk')"
printf '  }\n'
printf '}\n'
