#!/bin/sh
set -eu

usage() {
  printf '%s\n' '用法：install-appimage.sh /path/to/Dater.AppImage' \
    '也可运行：./Dater.AppImage --install' \
    '安装到当前用户的 ~/.local/share/dater，并注册 ~/.local/bin/dater。' \
    '更新仅替换应用文件，不读取或清理世界观数据。'
}

fail() {
  printf 'Dater 安装失败：%s\n' "$1" >&2
  exit 1
}

case "${1:-}" in
  --help|-h) usage; exit 0 ;;
esac
if [ "$#" -gt 1 ]; then usage >&2; exit 2; fi
source_image=${APPIMAGE:-${1:-}}
if [ -z "$source_image" ]; then usage >&2; exit 2; fi
if [ "$(uname -s)" != Linux ]; then fail '此安装脚本仅支持 Linux。'; fi
case "${HOME:-}" in
  /*) ;;
  *) fail 'HOME 必须为当前用户主目录的绝对路径。' ;;
esac
if [ "$HOME" = / ]; then fail '不能将文件安装到根目录作为用户主目录。'; fi
if [ ! -f "$source_image" ] || [ ! -r "$source_image" ]; then
  fail 'AppImage 路径须指向可读取的普通文件。'
fi
source_image=$(realpath -- "$source_image")
image_header=$(LC_ALL=C od -An -t x1 -N 11 -- "$source_image" | tr -d '[:space:]')
case "$image_header" in
  7f454c46????????414902) ;;
  *) fail '文件不是受支持的 Type 2 AppImage。' ;;
esac

installation_directory="$HOME/.local/share/dater"
command_directory="$HOME/.local/bin"
installed_image="$installation_directory/dater.AppImage"
installed_marker="$installation_directory/.dater-appimage-installation"
installed_command="$command_directory/dater"
installation_signature='Dater AppImage installation v1'
command_signature='# Dater AppImage command wrapper v1'
path_signature='# >>> Dater command PATH >>>'

# Never replace an unrelated command, including a pre-existing pnpm link.
if [ -e "$installed_command" ] || [ -L "$installed_command" ]; then
  if [ -L "$installed_command" ] || [ ! -f "$installed_command" ] ||
    ! grep -Fxq -- "$command_signature" "$installed_command"; then
    fail '~/.local/bin/dater 已被其他文件或链接占用，请先手动处理该文件。'
  fi
fi
if [ -e "$installed_image" ] || [ -L "$installed_image" ]; then
  if [ -L "$installed_image" ] || [ ! -f "$installed_image" ] ||
    [ ! -f "$installed_marker" ] || [ -L "$installed_marker" ] ||
    ! grep -Fxq -- "$installation_signature" "$installed_marker"; then
    fail '目标镜像不属于此安装器，请先手动处理 ~/.local/share/dater/dater.AppImage。'
  fi
fi
if [ -e "$installed_marker" ] || [ -L "$installed_marker" ]; then
  if [ -L "$installed_marker" ] || [ ! -f "$installed_marker" ] ||
    ! grep -Fxq -- "$installation_signature" "$installed_marker"; then
    fail '安装标记被其他文件占用。'
  fi
fi

image_temporary=
command_temporary=
marker_temporary=
profile_temporary=
cleanup() {
  for temporary_file in "$image_temporary" "$command_temporary" "$marker_temporary" "$profile_temporary"; do
    if [ -n "$temporary_file" ]; then rm -f -- "$temporary_file" || :; fi
  done
}
trap cleanup 0
trap 'exit 130' INT
trap 'exit 143' TERM

append_path_block() {
  profile_target=$1
  profile_style=$2
  # Preserve existing dotfile symlinks by updating their actual targets.
  if [ -L "$profile_target" ]; then
    profile_target=$(readlink -f -- "$profile_target") || fail '无法解析 shell 配置链接。'
  fi
  if [ -e "$profile_target" ] && [ ! -f "$profile_target" ]; then
    fail 'shell 启动配置路径不是普通文件。'
  fi
  if [ -f "$profile_target" ] && grep -Fxq -- "$path_signature" "$profile_target"; then return; fi
  profile_directory=$(dirname -- "$profile_target")
  mkdir -p -- "$profile_directory"
  profile_temporary=$(mktemp "$profile_directory/.dater-profile.XXXXXX")
  if [ -f "$profile_target" ]; then
    cp -p -- "$profile_target" "$profile_temporary"
  else
    chmod 600 "$profile_temporary"
  fi
  printf '\n' >> "$profile_temporary"
  if [ "$profile_style" = fish ]; then
    cat >> "$profile_temporary" <<'DATER_FISH_PATH'
# >>> Dater command PATH >>>
if not contains -- "$HOME/.local/bin" $PATH
    set -gx PATH "$HOME/.local/bin" $PATH
end
# <<< Dater command PATH <<<
DATER_FISH_PATH
  else
    cat >> "$profile_temporary" <<'DATER_SHELL_PATH'
# >>> Dater command PATH >>>
case ":${PATH-}:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin${PATH:+:$PATH}" ;;
esac
# <<< Dater command PATH <<<
DATER_SHELL_PATH
  fi
  mv -f -- "$profile_temporary" "$profile_target"
  profile_temporary=
}

mkdir -p -- "$installation_directory" "$command_directory"
image_temporary=$(mktemp "$installation_directory/.dater-image.XXXXXX")
cp -- "$source_image" "$image_temporary"
chmod 755 "$image_temporary"
command_temporary=$(mktemp "$command_directory/.dater-command.XXXXXX")
cat > "$command_temporary" <<'DATER_COMMAND'
#!/bin/sh
# Dater AppImage command wrapper v1
exec "$HOME/.local/share/dater/dater.AppImage" "$@"
DATER_COMMAND
chmod 755 "$command_temporary"
marker_temporary=$(mktemp "$installation_directory/.dater-marker.XXXXXX")
printf '%s\n' "$installation_signature" > "$marker_temporary"

current_shell=${SHELL:-/bin/sh}
current_shell=${current_shell##*/}
case "$current_shell" in
  bash)
    if [ -e "$HOME/.bash_profile" ] || [ -L "$HOME/.bash_profile" ]; then
      login_profile="$HOME/.bash_profile"
    elif [ -e "$HOME/.bash_login" ] || [ -L "$HOME/.bash_login" ]; then
      login_profile="$HOME/.bash_login"
    else
      login_profile="$HOME/.profile"
    fi
    append_path_block "$login_profile" sh
    append_path_block "$HOME/.bashrc" sh
    ;;
  zsh)
    zsh_configuration=${ZDOTDIR:-$HOME}
    case "$zsh_configuration" in /*) ;; *) fail 'ZDOTDIR 须为绝对路径。';; esac
    append_path_block "$zsh_configuration/.zprofile" sh
    append_path_block "$zsh_configuration/.zshrc" sh
    ;;
  fish)
    fish_configuration=${XDG_CONFIG_HOME:-$HOME/.config}
    case "$fish_configuration" in /*) ;; *) fish_configuration="$HOME/.config";; esac
    append_path_block "$fish_configuration/fish/conf.d/dater.fish" fish
    ;;
  *)
    append_path_block "$HOME/.profile" sh
    printf '%s\n' '当前 shell 的专用启动文件未识别，PATH 已注册到 ~/.profile。' \
      '若该 shell 不读取此文件，请在其配置中加入 ~/.local/bin。'
    ;;
esac

# Same-directory rename publishes each complete file atomically. The AppImage
# can be replaced while another process is still running the previous version.
mv -f -- "$marker_temporary" "$installed_marker"
marker_temporary=
mv -f -- "$image_temporary" "$installed_image"
image_temporary=
mv -f -- "$command_temporary" "$installed_command"
command_temporary=
printf '%s\n' 'Dater 已安装或更新。打开新终端后，可在任意世界观目录运行 dater。' \
  "镜像位置：$installed_image"
