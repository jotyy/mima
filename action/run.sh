#!/usr/bin/env bash
# The second step of vauly's GitHub Action (action.yml): runs the step's script under
# `vauly run`, and exports values for later steps when asked. It reads its inputs from
# VAULY_ACTION_* variables, and the CLI from where the first step installed it.
#
# No value passes through this script: `vauly run` hands values to its child only, and
# in export mode that child writes them to files. This script prints only the
# ::add-mask:: commands, which the runner reads and keeps out of the log.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
vauly="$RUNNER_TEMP/vauly-bin/vauly"
work="$(mktemp -d "$RUNNER_TEMP/vauly.XXXXXX")"
trap 'rm -rf "$work"' EXIT

fail() {
	echo "::error title=vauly::$*"
	exit 2
}

# The env input: NAME=vauly://… lines; blank lines and # comments are skipped.
references="$work/references.env"
: >"$references"
names=()
while IFS= read -r line || [ -n "$line" ]; do
	line="${line%$'\r'}"
	line="${line#"${line%%[![:space:]]*}"}"
	[ -z "$line" ] && continue
	[ "${line:0:1}" = "#" ] && continue
	name="${line%%=*}"
	[ "$name" != "$line" ] && [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] ||
		fail "Each line of env is NAME=vauly://…; this one isn't: ${line:0:40}"
	[[ "${line#*=}" == vauly://* ]] ||
		fail "$name isn't a vauly:// reference. Put plain values in the step's env instead."
	printf '%s\n' "$line" >>"$references"
	names+=("$name")
done <<<"${VAULY_ACTION_ENV:-}"

exporting=false
case "${VAULY_ACTION_EXPORT:-false}" in
true | yes | 1) exporting=true ;;
false | no | 0 | "") ;;
*) fail "export is true or false." ;;
esac
[ "$exporting" = true ] && [ ${#names[@]} -eq 0 ] &&
	fail "export writes the references in env; there are none."
[ "$exporting" = false ] && [ -z "${VAULY_ACTION_RUN:-}" ] &&
	fail "Give run, a script to run with the values, or export: true."

if [ "$exporting" = true ]; then
	# export.sh, under `vauly run`, writes the values for GITHUB_ENV to one file and their
	# ::add-mask:: commands to another, which this script prints once `vauly run` is done:
	# before any later step can print a value.
	export VAULY_ACTION_VALUES="$work/values"
	export VAULY_ACTION_MASKS="$work/masks"
	"$vauly" run --env-file "$references" -- \
		bash --noprofile --norc "$here/export.sh" "${names[@]}" || {
		status=$?
		echo "::error title=vauly::Nothing was exported; vauly's message is above."
		exit "$status"
	}
	cat "$VAULY_ACTION_MASKS"
	cat "$VAULY_ACTION_VALUES" >>"$GITHUB_ENV"
	echo "vauly: exported ${names[*]} for the steps after this one."
fi

if [ -n "${VAULY_ACTION_RUN:-}" ]; then
	script="$work/script"
	printf '%s\n' "$VAULY_ACTION_RUN" >"$script"
	case "${VAULY_ACTION_SHELL:-bash}" in
	bash) shell=(bash --noprofile --norc -eo pipefail) ;;
	sh) shell=(sh -e) ;;
	*) fail "shell is bash or sh." ;;
	esac
	status=0
	"$vauly" run --env-file "$references" -- "${shell[@]}" "$script" || status=$?
	exit "$status"
fi
