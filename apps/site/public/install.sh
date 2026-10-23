#!/bin/sh
# Installs the vauly CLI, for `vauly run` and `vauly mcp`: https://vauly.app/docs/agents/
#
#   curl -fsSL https://vauly.app/install.sh | sh
#
# It downloads the build for this Mac or Linux machine from the latest release on GitHub,
# checks it against the release's SHA256SUMS, and puts it in /usr/local/bin, or in
# ~/.local/bin when that isn't writable.
#
#   VAULY_VERSION=0.1.0      a given release instead of the latest
#   VAULY_INSTALL_DIR=~/bin  somewhere else to put it
set -eu

releases="https://github.com/jotyy/vauly/releases"
version="${VAULY_VERSION:-latest}"
if [ -n "${VAULY_DOWNLOAD_URL:-}" ]; then
	base="$VAULY_DOWNLOAD_URL"
elif [ "$version" = latest ]; then
	base="$releases/latest/download"
else
	base="$releases/download/v${version#v}"
fi

fail() {
	echo "vauly: $*" >&2
	exit 1
}

case "$(uname -s)" in
Darwin) os=darwin ;;
Linux) os=linux ;;
*) fail "this script is for macOS and Linux. On Windows, download vauly-windows-x64.exe from $releases/latest" ;;
esac
case "$(uname -m)" in
x86_64 | amd64) arch=x64 ;;
arm64 | aarch64) arch=arm64 ;;
*) fail "there's no vauly build for $(uname -m) yet." ;;
esac
# A shell running under Rosetta on Apple silicon still gets the native build.
if [ "$os" = darwin ] && [ "$arch" = x64 ] &&
	[ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
	arch=arm64
fi
binary="vauly-$os-$arch"

download() {
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL "$1" -o "$2"
	elif command -v wget >/dev/null 2>&1; then
		wget -qO "$2" "$1"
	else
		fail "install curl or wget first."
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

download "$base/SHA256SUMS" "$tmp/SHA256SUMS" ||
	fail "there's no vauly release at $base yet. To build the CLI from source instead, see https://vauly.app/docs/agents/"
download "$base/$binary" "$tmp/$binary" ||
	fail "couldn't download $binary from $base."

expected="$(grep " $binary\$" "$tmp/SHA256SUMS" | cut -d ' ' -f 1)"
[ -n "$expected" ] || fail "the release has no checksum for $binary."
if command -v sha256sum >/dev/null 2>&1; then
	actual="$(sha256sum "$tmp/$binary" | cut -d ' ' -f 1)"
elif command -v shasum >/dev/null 2>&1; then
	actual="$(shasum -a 256 "$tmp/$binary" | cut -d ' ' -f 1)"
else
	fail "sha256sum or shasum is needed to check the download."
fi
[ "$expected" = "$actual" ] ||
	fail "$binary doesn't match the release's checksum, so it wasn't installed."

dir="${VAULY_INSTALL_DIR:-}"
if [ -z "$dir" ]; then
	if [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
		dir=/usr/local/bin
	else
		dir="$HOME/.local/bin"
	fi
fi
mkdir -p "$dir"
chmod +x "$tmp/$binary"
mv "$tmp/$binary" "$dir/vauly"

echo "Installed $("$dir/vauly" --version) as $dir/vauly"
case ":$PATH:" in
*":$dir:"*) ;;
*) echo "Add $dir to your PATH to run vauly from anywhere." ;;
esac
