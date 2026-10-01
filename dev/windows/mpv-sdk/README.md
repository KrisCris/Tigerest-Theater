# Pinned mpv compile headers

These unmodified ISC-licensed headers come from mpv's upstream commit
`f7be2ee3e9f24fcd633d1fd82339c4219a109cee`. `source.json` records their sizes,
SHA-256 digests and Git blob identities. Keep the license notices in each file.

Windows CI verifies these files before compiling and generates its import
library from the separately verified, release-pinned playback DLL. It does not
download a second stock mpv runtime from SourceForge. The declarations and
preprocessor definitions match the SDK used by the validated local Windows
builds; some upstream comments differ.
