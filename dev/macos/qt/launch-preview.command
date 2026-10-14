#!/bin/zsh
# Keep this launcher beside Applications/Tigerest Theater.app in the preview.
# A separate config root prevents migration of the installed player's profile.
set -eu
preview_root="${0:A:h}"
player="$preview_root/Applications/Tigerest Theater.app/Contents/MacOS/Tigerest Theater"
config_root="$HOME/Library/Application Support/Tigerest Theater 120Hz Preview"
profile_name="Tigerest120HzPreview"
mkdir -p "$config_root"
profiles=$("$player" --config-dir "$config_root" --list-profiles)
# IPC sockets include the profile name, so use a distinct name as well as a
# distinct directory when the installed player is already running.
if ! /usr/bin/grep -Fqx -e "$profile_name" -e "$profile_name *" <<< "$profiles"; then
  "$player" --config-dir "$config_root" --create-profile "$profile_name"
fi
exec "$player" --config-dir "$config_root" --profile "$profile_name"
