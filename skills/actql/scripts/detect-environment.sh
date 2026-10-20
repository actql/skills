#!/usr/bin/env bash
# Prints what the ActQL setup step needs to know about this machine and the
# current directory as one JSON object. Read-only: it installs nothing.
set -u

json_string() {
  if [ -z "${1:-}" ]; then printf 'null'; return; fi
  # Quote control bytes without requiring Node or Python before discovery.
  # Non-ASCII UTF-8 bytes pass through unchanged, regardless of the caller locale.
  local LC_ALL=C value="$1" character code index
  printf '"'
  for ((index = 0; index < ${#value}; index++)); do
    character="${value:index:1}"
    case "$character" in
      '"') printf '\\"' ;;
      '\') printf '\\\\' ;;
      *)
        printf -v code '%d' "'$character"
        if [ "$code" -ge 0 ] && [ "$code" -lt 32 ]; then
          printf '\\u%04x' "$code"
        else
          printf '%s' "$character"
        fi
        ;;
    esac
  done
  printf '"'
}

version_of() { "$@" 2>/dev/null | head -n 1 | tr -d '\r'; }

actql_version=""; command -v actql >/dev/null 2>&1 && actql_version="$(version_of actql version)"
node_version=""; command -v node >/dev/null 2>&1 && node_version="$(version_of node --version)"
npm_version=""; command -v npm >/dev/null 2>&1 && npm_version="$(version_of npm --version)"
python_version=""
for py in python3 python; do
  if command -v "$py" >/dev/null 2>&1; then python_version="$(version_of "$py" --version)"; break; fi
done
uv_version=""; command -v uv >/dev/null 2>&1 && uv_version="$(version_of uv --version)"

has() { [ -e "$1" ] && printf 'true' || printf 'false'; }
dep_in_package_json() {
  [ -f package.json ] && grep -Eq "\"$1\"[[:space:]]*:" package.json && printf 'true' || printf 'false'
}
dep_in_pyproject() {
  [ -f pyproject.toml ] && grep -Eq "^[[:space:]]*\"?$1(\[|>|=|<|\"|[[:space:]]|$)" pyproject.toml && printf 'true' || printf 'false'
}

aql_file_count() {
  local count=0 path
  for path in ./*.aql; do
    if [ -f "$path" ]; then count=$((count + 1)); fi
  done
  printf '%s' "$count"
}

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
printf '    "aql_files": %s\n' "$(aql_file_count)"
printf '  },\n'
printf '  "dependencies": {\n'
printf '    "actql_node": %s,\n' "$(dep_in_package_json '@actql/node')"
printf '    "actql_sdk": %s,\n' "$(dep_in_package_json '@actql/sdk')"
printf '    "actql_python": %s,\n' "$(dep_in_pyproject 'actql')"
printf '    "actql_sdk_python": %s\n' "$(dep_in_pyproject 'actql-sdk')"
printf '  }\n'
printf '}\n'
