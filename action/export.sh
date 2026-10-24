#!/usr/bin/env bash
# Run by run.sh under `vauly run`, so it's the only process that sees the values: writes
# each named variable for GITHUB_ENV under a random delimiter, and the ::add-mask::
# commands that keep it out of the log to a file of their own, which run.sh prints.
set -euo pipefail

# How the runner wants workflow command data written.
escape() {
	local data="${1//%/%25}"
	data="${data//$'\r'/%0D}"
	printf '%s' "${data//$'\n'/%0A}"
}

for name in "$@"; do
	value="${!name}"
	printf '::add-mask::%s\n' "$(escape "$value")" >>"$VAULY_ACTION_MASKS"
	# Each line of a value of several lines, such as a key, on its own too.
	if [[ "$value" == *$'\n'* ]]; then
		while IFS= read -r part; do
			if [ ${#part} -ge 4 ]; then
				printf '::add-mask::%s\n' "$(escape "$part")" >>"$VAULY_ACTION_MASKS"
			fi
		done <<<"$value"
	fi
	delimiter="vauly_$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
	printf '%s<<%s\n%s\n%s\n' "$name" "$delimiter" "$value" "$delimiter" >>"$VAULY_ACTION_VALUES"
done
