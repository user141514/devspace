#!/usr/bin/env bash
# 将本机 ~/.claude 中的 skills 软链到 devspace 的默认 agentDir/skills 路径。
# v1.0.2 默认是 ~/.codex；v1.0.5+ 改为 ~/.agents；两个路径都链，覆盖两种版本。
set -euo pipefail

DESTS=("$HOME/.codex/skills" "$HOME/.agents/skills")

link_dir() {
  local src="$1" dest="$2"
  [[ -d "$src" ]] || return 0
  for skill_dir in "$src"/*/; do
    [[ -d "$skill_dir" ]] || continue
    local name
    name=$(basename "$skill_dir")
    if [[ -L "$dest/$name" ]]; then
      ln -sfn "$skill_dir" "$dest/$name"
    elif [[ -d "$dest/$name" ]]; then
      echo "skip $name (real directory exists, remove manually to replace)"
    else
      ln -sn "$skill_dir" "$dest/$name"
    fi
  done
}

for DEST in "${DESTS[@]}"; do
  mkdir -p "$DEST"

  # ~/.claude/skills — 用户手写 / 插件市场安装的 skills
  link_dir "$HOME/.claude/skills" "$DEST"

  # ~/.claude/plugins — 插件体系下的 skills（marketplaces 和 cache 两层）
  for base in \
    "$HOME/.claude/plugins/marketplaces" \
    "$HOME/.claude/plugins/cache/claude-plugins-official"
  do
    [[ -d "$base" ]] || continue
    for pkg in "$base"/*/; do
      # 处理带版本号的子目录（cache 层）
      for version_or_skills in "$pkg"*/; do
        link_dir "$version_or_skills/skills" "$DEST"
      done
      link_dir "$pkg/skills" "$DEST"
    done
  done

  echo "done — $(ls "$DEST" | wc -l) skills in $DEST"
done
