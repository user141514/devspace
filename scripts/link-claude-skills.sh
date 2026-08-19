#!/usr/bin/env bash
# 将本机 ~/.claude 中的 skills 软链到 ~/.agents/skills，
# 使 devspace 的默认搜索路径能自动发现它们。
set -euo pipefail

DEST="$HOME/.agents/skills"
mkdir -p "$DEST"

link_dir() {
  local src="$1"
  [[ -d "$src" ]] || return 0
  for skill_dir in "$src"/*/; do
    [[ -d "$skill_dir" ]] || continue
    local name
    name=$(basename "$skill_dir")
    if [[ -L "$DEST/$name" ]]; then
      ln -sfn "$skill_dir" "$DEST/$name"
    elif [[ -d "$DEST/$name" ]]; then
      echo "skip $name (real directory exists, remove manually to replace)"
    else
      ln -sn "$skill_dir" "$DEST/$name"
    fi
  done
}

# ~/.claude/skills — 用户手写 / 插件市场安装的 skills
link_dir "$HOME/.claude/skills"

# ~/.claude/plugins — 插件体系下的 skills（marketplaces 和 cache 两层）
for base in \
  "$HOME/.claude/plugins/marketplaces" \
  "$HOME/.claude/plugins/cache/claude-plugins-official"
do
  [[ -d "$base" ]] || continue
  for pkg in "$base"/*/; do
    # 处理带版本号的子目录（cache 层）
    for version_or_skills in "$pkg"*/; do
      link_dir "$version_or_skills/skills"
    done
    link_dir "$pkg/skills"
  done
done

echo "done — $(ls "$DEST" | wc -l) skills in $DEST"
