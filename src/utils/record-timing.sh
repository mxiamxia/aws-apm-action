#!/bin/bash
# Bash utility to record timing data for GitHub Actions steps
# Usage: source record-timing.sh && record_timing_start "Step Name"
#        source record-timing.sh && record_timing_end "Step Name"

TIMING_FILE="${RUNNER_TEMP:-/tmp}/awsapm-output/timing-bash.json"

# Initialize timing file if it doesn't exist
init_timing_file() {
  mkdir -p "$(dirname "$TIMING_FILE")"
  if [ ! -f "$TIMING_FILE" ]; then
    echo '{"timings":[]}' > "$TIMING_FILE"
  fi
}

# Record a timing entry (start or end)
record_timing_entry() {
  local phase="$1"
  local event_type="$2"  # "start" or "end"

  init_timing_file

  # Get current timestamp in milliseconds (works on both Linux and macOS)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    local timestamp=$(($(date +%s) * 1000 + $(date +%N) / 1000000))
  else
    # Linux
    local timestamp=$(date +%s%3N)
  fi

  # Create JSON entry (escape quotes in phase name)
  local phase_escaped="${phase//\"/\\\"}"
  local entry=$(cat <<EOF
{
  "phase": "$phase_escaped",
  "eventType": "$event_type",
  "timestamp": $timestamp,
  "timestampISO": "$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"
}
EOF
)

  # Append to timing file
  local temp_file="${TIMING_FILE}.tmp"

  # Use jq to properly append to the timings array if available
  if command -v jq &> /dev/null; then
    jq ".timings += [$entry]" "$TIMING_FILE" > "$temp_file" && mv "$temp_file" "$TIMING_FILE"
  else
    # Fallback: use node to append (GitHub Actions has node available)
    if command -v node &> /dev/null; then
      node -e "
        const fs = require('fs');
        const data = JSON.parse(fs.readFileSync('$TIMING_FILE', 'utf8'));
        data.timings.push($entry);
        fs.writeFileSync('$temp_file', JSON.stringify(data, null, 2));
      " && mv "$temp_file" "$TIMING_FILE"
    else
      echo "[TIMING ERROR] Neither jq nor node available for JSON manipulation"
    fi
  fi
}

# Record start of a phase
record_timing_start() {
  local phase="$1"
  echo "[TIMING] Starting: $phase"
  record_timing_entry "$phase" "start"
}

# Record end of a phase
record_timing_end() {
  local phase="$1"
  echo "[TIMING] Completed: $phase"
  record_timing_entry "$phase" "end"
}
