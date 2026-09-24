#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export GLM_53_MODEL="${GLM_53_MODEL:-zai-coding-plan/glm-5.3}"
export GLM_53_FLASH_MODEL="${GLM_53_FLASH_MODEL:-zai-coding-plan/glm-5.3-flash}"
# User-chosen, verified 2026-09-24 (cheaper than muse-spark-1.3).
export MUSE_SPARK_MODEL="${MUSE_SPARK_MODEL:-muse-spark-1.3-contributor}"
mode="${1:-manager}"
if [[ "$mode" == "check" ]]; then
  for cli in claude muse opencode; do command -v "$cli" || exit 1; done
  for name in MUSE_SPARK_MODEL GLM_53_MODEL GLM_53_FLASH_MODEL OPENROUTER_GIGGLE; do
    if [[ -n "${!name:-}" ]]; then printf '%s: configured\n' "$name"; else printf '%s: not exported\n' "$name"; fi
  done
  exit 0
fi
if [[ "$mode" == "manager" ]]; then
  exec claude --dangerously-skip-permissions "Read docs/CLAUDE_HANDOFF.md and act as the Giggle engineering manager described there. Inspect current state, preserve all existing work, delegate bounded tasks through scripts/claude-handoff.sh, review results, and continue the outstanding work. Resolve exact worker model IDs before using them. Do not start a deployment or model benchmark merely because this launcher ran."
fi
prompt_file="${2:?Usage: scripts/claude-handoff.sh spark|glm|flash TASK_FILE}"
[[ -f "$prompt_file" ]] || { printf 'Task file missing\n' >&2; exit 1; }
# Only the Giggle key may be mapped to OpenRouter's standard variable.
# Never inherit a generic key that may belong to another project.
unset OPENROUTER_API_KEY OPENROUTER_KALTVID
if [[ -n "${OPENROUTER_GIGGLE:-}" ]]; then export OPENROUTER_API_KEY="$OPENROUTER_GIGGLE"; fi
case "$mode" in
  spark)
    : "${MUSE_SPARK_MODEL:?Set the verified Muse Spark model ID}"
    # Optional screenshots: scripts/claude-handoff.sh spark TASK_FILE [IMAGE...]
    images=()
    for image in "${@:3}"; do [[ -f "$image" ]] || { printf 'Image missing: %s\n' "$image" >&2; exit 1; }; images+=(--image "$image"); done
    exec muse exec --model "$MUSE_SPARK_MODEL" --trust-workspace --workspace "$ROOT" --max-model-steps 30 --prompt-file "$prompt_file" ${images[@]+"${images[@]}"}
    ;;
  glm|flash)
    if [[ "$mode" == "glm" ]]; then
      model="${GLM_53_MODEL:?Set the verified provider/model ID from opencode models}"
    else
      model="${GLM_53_FLASH_MODEL:?Set the verified provider/model ID from opencode models}"
    fi
    exec opencode run --model "$model" --file "$prompt_file" "Complete the attached bounded task. Read applicable repository instructions. Preserve unrelated edits. Report changed files, verification, and unresolved issues."
    ;;
  *) printf 'Usage: %s [manager|check|spark TASK_FILE [IMAGE...]|glm TASK_FILE|flash TASK_FILE]\n' "$0" >&2; exit 2 ;;
esac
