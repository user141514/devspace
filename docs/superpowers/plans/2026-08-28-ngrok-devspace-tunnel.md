# DevSpace Fixed ngrok Tunnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the failed zrok public path with a stable, free ngrok HTTPS Dev Domain that forwards to DevSpace at `127.0.0.1:7676`.

**Architecture:** Install the standalone ngrok v3 agent in the user's local binary directory and authenticate it through a user-only, non-echoing terminal gate. On the free plan, a systemd user service starts an HTTP endpoint without a custom `--url`, so ngrok selects the account's stable auto-assigned Dev Domain; the service forwards only to the DevSpace loopback listener and disables request inspection. After the public URL is read from ngrok's loopback Agent API, DevSpace's `publicBaseUrl` is updated and both the MCP and OAuth discovery paths are verified before zrok autostart is disabled.

**Tech Stack:** ngrok v3 Linux amd64 agent, systemd user services, DevSpace CLI, curl, Node.js JSON parsing

## Global Constraints

- Current implementation date is 2026-08-28.
- Use the free, automatically assigned ngrok Dev Domain; do not buy or configure a custom domain.
- Do not pass a custom `--url`; the free-account default endpoint selects the account's automatically assigned Dev Domain.
- Never place the ngrok authtoken in chat, tool arguments, command output, Git, systemd, or this plan.
- The user enters the authtoken privately in their own terminal with input echo disabled.
- Install ngrok at `/home/ad/.local/bin/ngrok`; do not use sudo or modify system package repositories.
- Expose only `http://127.0.0.1:7676`.
- Run ngrok with HTTP inspection disabled so MCP bodies and bearer credentials are not retained by the local inspector.
- Keep DevSpace OAuth enabled; unauthenticated `POST /mcp` must return `401`.
- `publicBaseUrl` is the HTTPS origin only and must not include `/mcp`.
- Do not edit DevSpace source code.
- Do not delete any zrok unit, local configuration, reserved name, environment, or account data.
- Disable zrok autostart only after every ngrok verification passes.
- Home-directory service/configuration changes are machine state and must not be committed to the DevSpace repository.
- Preserve all unrelated dirty-worktree changes in `/home/ad/company_git_work/devspace`.
- The active DevSpace config on this machine is `/home/ad/.devspace/config.jsonc`, as reported by `devspace doctor`; do not back up or modify the stale `/home/ad/.devspace/config.json`.
- Do not reference `network-online.target` from the user unit because that target is absent from this machine's user manager; `Restart=always` handles tunnel startup before connectivity is ready.
- Require the existing `Linger=yes` user-manager state so enabled user services start after a machine reboot; do not change linger configuration in this task.
- Treat every `bash` block as a fresh shell run with `set -euo pipefail`; no step may depend on a shell variable created by an earlier step.

---

## File and State Map

**Created**

- `/home/ad/.local/bin/ngrok` — standalone ngrok executable.
- `/home/ad/.config/ngrok/ngrok.yml` — ngrok's user configuration containing the authtoken; mode `0600`.
- `/home/ad/.config/systemd/user/ngrok-devspace.service` — persistent user service for the tunnel.
- `/home/ad/.devspace/config.jsonc.bak-before-ngrok-20260828` — pre-cutover rollback copy.

**Modified**

- `/home/ad/.devspace/config.jsonc` — `publicBaseUrl` only, through the DevSpace CLI.
- systemd user-manager state — enable ngrok after verification; disable zrok after verification.

**Read but not modified**

- `/home/ad/.config/systemd/user/devspace.service`
- `/home/ad/.config/systemd/user/zrok-lbh.service`

---

### Task 1: Baseline the machine and install ngrok

**Files:**

- Create: `/home/ad/.local/bin/ngrok`
- Read: `/home/ad/.devspace/config.jsonc`
- Read: `/home/ad/.config/systemd/user/devspace.service`
- Read: `/home/ad/.config/systemd/user/zrok-lbh.service`

**Interfaces:**

- Consumes: healthy DevSpace listener at `127.0.0.1:7676`.
- Produces: executable ngrok v3 agent at `/home/ad/.local/bin/ngrok`.

- [ ] **Step 1: Capture the pre-change baseline without printing secrets**

Run:

```bash
systemctl --user is-active devspace.service
systemctl --user is-enabled devspace.service
systemctl --user is-active zrok-lbh.service || true
systemctl --user is-enabled zrok-lbh.service || true
loginctl show-user ad -p Linger
curl --max-time 5 -sS -o /dev/null -w 'local_health=%{http_code}\n' \
  http://127.0.0.1:7676/healthz
curl --max-time 5 -sS -o /dev/null -w 'local_mcp=%{http_code}\n' \
  -X POST http://127.0.0.1:7676/mcp
/home/ad/.local/bin/devspace doctor | \
  rg -F 'Config file: /home/ad/.devspace/config.jsonc'
```

Expected:

```text
active
enabled
inactive
enabled
Linger=yes
local_health=200
local_mcp=401
Config file: /home/ad/.devspace/config.jsonc
```

Do not run `systemctl cat devspace.service` because the existing unit contains a secret environment value.

- [ ] **Step 2: Verify the target architecture and that ngrok is not already installed**

Run:

```bash
task_machine_arch=$(uname -m)
printf '%s\n' "$task_machine_arch"
test "$task_machine_arch" = x86_64
test ! -e /home/ad/.local/bin/ngrok
```

Expected:

```text
x86_64
```

The second command exits `0` with no output.

- [ ] **Step 3: Download, install, and verify the official standalone Linux amd64 agent**

Run:

```bash
task_ngrok_tmp=$(mktemp -d /tmp/ngrok-install.XXXXXX)
curl -fsSL \
  https://bin.ngrok.com/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz \
  -o "$task_ngrok_tmp/ngrok.tgz"
tar -xzf "$task_ngrok_tmp/ngrok.tgz" -C "$task_ngrok_tmp"
test -x "$task_ngrok_tmp/ngrok"
install -m 0755 "$task_ngrok_tmp/ngrok" /home/ad/.local/bin/ngrok
/home/ad/.local/bin/ngrok version
```

Expected: all commands exit `0`, and the final output begins with `ngrok version 3`.

- [ ] **Step 4: Run the built-in connectivity diagnostic**

Run:

```bash
/home/ad/.local/bin/ngrok diagnose
```

Expected: exit `0`. If it fails, stop this task and retain the diagnostic output; do not begin authentication or modify DevSpace.

**Checkpoint:** ngrok is installed and can reach the ngrok service. No Git commit is made because only user machine state changed.

---

### Task 2: Authenticate through a private user gate

**Files:**

- Create: `/home/ad/.config/ngrok/ngrok.yml`

**Interfaces:**

- Consumes: `/home/ad/.local/bin/ngrok`.
- Produces: valid ngrok configuration readable only by user `ad`.

- [ ] **Step 1: Open the ngrok account page**

Run:

```bash
xdg-open https://dashboard.ngrok.com/signup
```

Expected: the user's browser opens. The user creates or signs into the free account and opens the dashboard's authtoken page.

- [ ] **Step 2: Pause for the user-only token command**

The user runs the following in their own terminal, not through an agent tool:

```bash
read -rsp 'Paste ngrok authtoken (input hidden): ' task_ngrok_token
printf '\n'
/home/ad/.local/bin/ngrok config add-authtoken "$task_ngrok_token"
unset task_ngrok_token
chmod 600 /home/ad/.config/ngrok/ngrok.yml
```

Expected: ngrok reports that the authtoken was saved. The token never appears in terminal output or shell history.

- [ ] **Step 3: Validate configuration without revealing it**

Run:

```bash
/home/ad/.local/bin/ngrok config check
stat -c '%a %U %n' /home/ad/.config/ngrok/ngrok.yml
```

Expected:

```text
600 ad /home/ad/.config/ngrok/ngrok.yml
```

The first command prints `Valid configuration file at` followed by the exact config path; the second prints the line shown above.

Do not display, grep, parse, or copy the YAML.

**Checkpoint:** authentication is valid and secret handling is complete. No Git commit is made.

---

### Task 3: Create the persistent ngrok user service and discover the fixed URL

**Files:**

- Create: `/home/ad/.config/systemd/user/ngrok-devspace.service`

**Interfaces:**

- Consumes: authenticated ngrok config and `devspace.service`.
- Produces: a running ngrok tunnel and prints its fixed HTTPS URL.

- [ ] **Step 1: Verify the service does not already exist**

Run:

```bash
test ! -e /home/ad/.config/systemd/user/ngrok-devspace.service
if systemctl --user cat ngrok-devspace.service; then
  printf 'unexpected existing ngrok-devspace.service\n' >&2
  exit 1
fi
```

Expected: the first command exits `0`; the second reports that no files were found.

- [ ] **Step 2: Create the unit with the exact content below**

Use `apply_patch` to create `/home/ad/.config/systemd/user/ngrok-devspace.service`:

```ini
[Unit]
Description=ngrok fixed-domain tunnel for DevSpace MCP
After=devspace.service
Wants=devspace.service

[Service]
Type=simple
Environment=PATH=/home/ad/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/ad/.local/bin/ngrok http 127.0.0.1:7676 --inspect=false
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

On a free account, omitting `--url` tells ngrok to use the account's automatically assigned Dev Domain.

- [ ] **Step 3: Load and start the service without enabling autostart yet**

Run:

```bash
systemctl --user daemon-reload
systemctl --user start ngrok-devspace.service
```

Expected: both commands exit `0`.

- [ ] **Step 4: Wait on service health and the loopback Agent API**

Run:

```bash
task_ngrok_ready=0
for task_ngrok_attempt in $(seq 1 20); do
  if test "$(systemctl --user is-active ngrok-devspace.service 2>/dev/null)" = active \
    && curl --max-time 2 -fsS http://127.0.0.1:4040/api/endpoints >/dev/null; then
    task_ngrok_ready=1
    break
  fi
  sleep 1
done
test "$task_ngrok_ready" = 1
```

Expected: final command exits `0` within 20 seconds.

- [ ] **Step 5: Read, validate, and preflight the assigned HTTPS URL**

Run:

```bash
task_ngrok_url=$(
  curl --max-time 5 -fsS http://127.0.0.1:4040/api/endpoints |
  node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const body = JSON.parse(input);
      const endpoint = body.endpoints.find(item =>
        typeof item.url === "string" && item.url.startsWith("https://")
      );
      if (!endpoint) process.exit(1);
      process.stdout.write(endpoint.url.replace(/\/+$/, ""));
    });
  '
)
case "$task_ngrok_url" in
  https://*.ngrok-free.app|https://*.ngrok-free.dev) ;;
  *) printf 'unexpected ngrok URL: %s\n' "$task_ngrok_url" >&2; exit 1 ;;
esac
printf 'ngrok_url=%s\n' "$task_ngrok_url"
task_public_health=$(
  curl --noproxy '*' --max-time 10 -sS -o /dev/null \
    -w '%{http_code}' "$task_ngrok_url/healthz"
)
printf 'public_health=%s\n' "$task_public_health"
test "$task_public_health" = 200
```

Expected: exactly one fixed HTTPS URL under `ngrok-free.app` or `ngrok-free.dev`, followed by:

```text
public_health=200
```

If this fails, inspect only:

```bash
journalctl --user -u ngrok-devspace.service -n 50 --no-pager
```

Do not modify DevSpace until the health request succeeds.

**Checkpoint:** the stable ngrok domain reaches DevSpace. No Git commit is made.

---

### Task 4: Switch DevSpace public metadata to ngrok with rollback protection

**Files:**

- Create: `/home/ad/.devspace/config.jsonc.bak-before-ngrok-20260828`
- Modify: `/home/ad/.devspace/config.jsonc`

**Interfaces:**

- Consumes: the running ngrok Agent API from Task 3.
- Produces: DevSpace MCP and OAuth metadata rooted at the ngrok origin.

- [ ] **Step 1: Create the exact rollback copy without overwriting an older backup**

Run:

```bash
task_devspace_backup=/home/ad/.devspace/config.jsonc.bak-before-ngrok-20260828
test ! -e "$task_devspace_backup"
install -m 0600 /home/ad/.devspace/config.jsonc "$task_devspace_backup"
cmp -s /home/ad/.devspace/config.jsonc "$task_devspace_backup"
stat -c '%a %U %n' "$task_devspace_backup"
```

Expected: all commands exit `0`, and `stat` prints mode `600`, owner `ad`, and the exact backup path.

- [ ] **Step 2: Discover the fixed URL and set the new public origin through the supported CLI**

Run:

```bash
task_ngrok_url=$(
  curl --max-time 5 -fsS http://127.0.0.1:4040/api/endpoints |
  node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const endpoint = JSON.parse(input).endpoints.find(item =>
        typeof item.url === "string" && item.url.startsWith("https://")
      );
      if (!endpoint) process.exit(1);
      process.stdout.write(endpoint.url.replace(/\/+$/, ""));
    });
  '
)
case "$task_ngrok_url" in
  https://*.ngrok-free.app|https://*.ngrok-free.dev) ;;
  *) printf 'unexpected ngrok URL: %s\n' "$task_ngrok_url" >&2; exit 1 ;;
esac
/home/ad/.local/bin/devspace config set publicBaseUrl "$task_ngrok_url"
systemctl --user restart devspace.service
```

Expected: URL discovery, the DevSpace config update, and the service restart all exit `0`.

- [ ] **Step 3: Wait for the local server to return**

Run:

```bash
task_devspace_ready=0
for task_devspace_attempt in $(seq 1 20); do
  if test "$(systemctl --user is-active devspace.service 2>/dev/null)" = active \
    && test "$(curl --max-time 2 -sS -o /dev/null -w '%{http_code}' \
      http://127.0.0.1:7676/healthz 2>/dev/null)" = 200; then
    task_devspace_ready=1
    break
  fi
  sleep 1
done
test "$task_devspace_ready" = 1
```

Expected: final command exits `0`.

- [ ] **Step 4: Verify the CLI reports the new public URL without printing secrets**

Run:

```bash
task_ngrok_url=$(
  curl --max-time 5 -fsS http://127.0.0.1:4040/api/endpoints |
  node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const endpoint = JSON.parse(input).endpoints.find(item =>
        typeof item.url === "string" && item.url.startsWith("https://")
      );
      if (!endpoint) process.exit(1);
      process.stdout.write(endpoint.url.replace(/\/+$/, ""));
    });
  '
)
/home/ad/.local/bin/devspace doctor |
  rg -F "Public MCP URL: ${task_ngrok_url}/mcp"
```

Expected: one line containing the exact ngrok MCP URL.

- [ ] **Step 5: Use the exact rollback copy immediately if Steps 2-4 fail**

Run only on failure:

```bash
systemctl --user stop ngrok-devspace.service
install -m 0600 \
  /home/ad/.devspace/config.jsonc.bak-before-ngrok-20260828 \
  /home/ad/.devspace/config.jsonc
systemctl --user restart devspace.service
test "$(curl --max-time 5 -sS -o /dev/null -w '%{http_code}' \
  http://127.0.0.1:7676/healthz)" = 200
```

Expected: DevSpace returns to its pre-cutover configuration. Keep zrok stopped.

**Checkpoint:** DevSpace now advertises the ngrok origin. No Git commit is made.

---

### Task 5: Verify MCP/OAuth, prove URL stability, and retire zrok autostart

**Files and state:**

- Read: ngrok Agent API.
- Read: DevSpace public endpoints.
- Modify: systemd enablement state only after all tests pass.

**Interfaces:**

- Consumes: active DevSpace, active ngrok service, and the loopback ngrok Agent API.
- Produces: verified fixed public MCP URL and final service ownership.

- [ ] **Step 1: Verify local and public health/auth behavior**

Run:

```bash
task_ngrok_url=$(
  curl --max-time 5 -fsS http://127.0.0.1:4040/api/endpoints |
  node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const endpoint = JSON.parse(input).endpoints.find(item =>
        typeof item.url === "string" && item.url.startsWith("https://")
      );
      if (!endpoint) process.exit(1);
      process.stdout.write(endpoint.url.replace(/\/+$/, ""));
    });
  '
)
case "$task_ngrok_url" in
  https://*.ngrok-free.app|https://*.ngrok-free.dev) ;;
  *) printf 'unexpected ngrok URL: %s\n' "$task_ngrok_url" >&2; exit 1 ;;
esac
test "$(curl --max-time 5 -sS -o /dev/null -w '%{http_code}' \
  http://127.0.0.1:7676/healthz)" = 200
test "$(curl --max-time 5 -sS -o /dev/null -w '%{http_code}' \
  -X POST http://127.0.0.1:7676/mcp)" = 401
test "$(curl --noproxy '*' --max-time 10 -sS -o /dev/null -w '%{http_code}' \
  "$task_ngrok_url/healthz")" = 200
test "$(curl --noproxy '*' --max-time 10 -sS -o /dev/null -w '%{http_code}' \
  -X POST "$task_ngrok_url/mcp")" = 401
```

Expected: URL discovery and all four HTTP assertions exit `0`.

- [ ] **Step 2: Verify OAuth protected-resource metadata uses the new origin**

Run:

```bash
task_ngrok_url=$(
  curl --max-time 5 -fsS http://127.0.0.1:4040/api/endpoints |
  node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const endpoint = JSON.parse(input).endpoints.find(item =>
        typeof item.url === "string" && item.url.startsWith("https://")
      );
      if (!endpoint) process.exit(1);
      process.stdout.write(endpoint.url.replace(/\/+$/, ""));
    });
  '
)
curl --noproxy '*' --max-time 10 -fsS \
  "$task_ngrok_url/.well-known/oauth-protected-resource/mcp" |
TASK_NGROK_URL="$task_ngrok_url" node -e '
  let input = "";
  process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => {
    const body = JSON.parse(input);
    const expectedResource = process.env.TASK_NGROK_URL + "/mcp";
    const expectedIssuer = process.env.TASK_NGROK_URL + "/";
    if (body.resource !== expectedResource) process.exit(1);
    if (!Array.isArray(body.authorization_servers)) process.exit(1);
    if (!body.authorization_servers.includes(expectedIssuer)) {
      process.exit(1);
    }
  });
'
```

Expected: exit `0` with no output.

- [ ] **Step 3: Verify OAuth authorization-server metadata uses the new origin**

Run:

```bash
task_ngrok_url=$(
  curl --max-time 5 -fsS http://127.0.0.1:4040/api/endpoints |
  node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const endpoint = JSON.parse(input).endpoints.find(item =>
        typeof item.url === "string" && item.url.startsWith("https://")
      );
      if (!endpoint) process.exit(1);
      process.stdout.write(endpoint.url.replace(/\/+$/, ""));
    });
  '
)
curl --noproxy '*' --max-time 10 -fsS \
  "$task_ngrok_url/.well-known/oauth-authorization-server" |
TASK_NGROK_URL="$task_ngrok_url" node -e '
  let input = "";
  process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => {
    const body = JSON.parse(input);
    const expectedIssuer = process.env.TASK_NGROK_URL + "/";
    if (body.issuer !== expectedIssuer) process.exit(1);
    for (const key of ["authorization_endpoint", "token_endpoint"]) {
      if (typeof body[key] !== "string") process.exit(1);
      if (!body[key].startsWith(expectedIssuer)) {
        process.exit(1);
      }
    }
  });
'
```

Expected: exit `0` with no output.

- [ ] **Step 4: Verify DevSpace reports the exact public MCP URL and allowed host**

Run:

```bash
task_ngrok_url=$(
  curl --max-time 5 -fsS http://127.0.0.1:4040/api/endpoints |
  node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const endpoint = JSON.parse(input).endpoints.find(item =>
        typeof item.url === "string" && item.url.startsWith("https://")
      );
      if (!endpoint) process.exit(1);
      process.stdout.write(endpoint.url.replace(/\/+$/, ""));
    });
  '
)
task_ngrok_host=$(
  TASK_NGROK_URL="$task_ngrok_url" node -e \
    'process.stdout.write(new URL(process.env.TASK_NGROK_URL).hostname)'
)
task_devspace_doctor=$(/home/ad/.local/bin/devspace doctor)
printf '%s\n' "$task_devspace_doctor"
printf '%s\n' "$task_devspace_doctor" |
  rg -F "Public MCP URL: ${task_ngrok_url}/mcp"
printf '%s\n' "$task_devspace_doctor" |
  rg -F 'Allowed hosts:' | rg -F "$task_ngrok_host"
```

Expected: the doctor output contains the exact ngrok MCP URL, and the `Allowed hosts` line contains the ngrok hostname.

- [ ] **Step 5: Restart ngrok and prove the assigned domain is stable**

Run:

```bash
task_ngrok_url_before=$(
  curl --max-time 5 -fsS http://127.0.0.1:4040/api/endpoints |
  node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const endpoint = JSON.parse(input).endpoints.find(item =>
        typeof item.url === "string" && item.url.startsWith("https://")
      );
      if (!endpoint) process.exit(1);
      process.stdout.write(endpoint.url.replace(/\/+$/, ""));
    });
  '
)
systemctl --user restart ngrok-devspace.service

task_ngrok_ready=0
for task_ngrok_attempt in $(seq 1 20); do
  if test "$(systemctl --user is-active ngrok-devspace.service 2>/dev/null)" = active \
    && curl --max-time 2 -fsS http://127.0.0.1:4040/api/endpoints >/dev/null; then
    task_ngrok_ready=1
    break
  fi
  sleep 1
done
test "$task_ngrok_ready" = 1

task_ngrok_url_after=$(
  curl --max-time 5 -fsS http://127.0.0.1:4040/api/endpoints |
  node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const endpoint = JSON.parse(input).endpoints.find(item =>
        typeof item.url === "string" && item.url.startsWith("https://")
      );
      if (!endpoint) process.exit(1);
      process.stdout.write(endpoint.url.replace(/\/+$/, ""));
    });
  '
)
case "$task_ngrok_url_after" in
  https://*.ngrok-free.app|https://*.ngrok-free.dev) ;;
  *) printf 'unexpected ngrok URL: %s\n' "$task_ngrok_url_after" >&2; exit 1 ;;
esac
test "$task_ngrok_url_after" = "$task_ngrok_url_before"
```

Expected: all checks exit `0`; the before and after URLs are identical.

- [ ] **Step 6: Re-run the full local, public, and OAuth gate after restart**

Run:

```bash
task_ngrok_url=$(
  curl --max-time 5 -fsS http://127.0.0.1:4040/api/endpoints |
  node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const endpoint = JSON.parse(input).endpoints.find(item =>
        typeof item.url === "string" && item.url.startsWith("https://")
      );
      if (!endpoint) process.exit(1);
      process.stdout.write(endpoint.url.replace(/\/+$/, ""));
    });
  '
)
test "$(curl --max-time 5 -sS -o /dev/null -w '%{http_code}' \
  http://127.0.0.1:7676/healthz)" = 200
test "$(curl --max-time 5 -sS -o /dev/null -w '%{http_code}' \
  -X POST http://127.0.0.1:7676/mcp)" = 401
test "$(curl --noproxy '*' --max-time 10 -sS -o /dev/null -w '%{http_code}' \
  "$task_ngrok_url/healthz")" = 200
test "$(curl --noproxy '*' --max-time 10 -sS -o /dev/null -w '%{http_code}' \
  -X POST "$task_ngrok_url/mcp")" = 401

curl --noproxy '*' --max-time 10 -fsS \
  "$task_ngrok_url/.well-known/oauth-protected-resource/mcp" |
TASK_NGROK_URL="$task_ngrok_url" node -e '
  let input = "";
  process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => {
    const body = JSON.parse(input);
    const expectedResource = process.env.TASK_NGROK_URL + "/mcp";
    const expectedIssuer = process.env.TASK_NGROK_URL + "/";
    if (body.resource !== expectedResource) process.exit(1);
    if (!Array.isArray(body.authorization_servers)) process.exit(1);
    if (!body.authorization_servers.includes(expectedIssuer)) process.exit(1);
  });
'

curl --noproxy '*' --max-time 10 -fsS \
  "$task_ngrok_url/.well-known/oauth-authorization-server" |
TASK_NGROK_URL="$task_ngrok_url" node -e '
  let input = "";
  process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => {
    const body = JSON.parse(input);
    const expectedIssuer = process.env.TASK_NGROK_URL + "/";
    if (body.issuer !== expectedIssuer) process.exit(1);
    for (const key of ["authorization_endpoint", "token_endpoint"]) {
      if (typeof body[key] !== "string") process.exit(1);
      if (!body[key].startsWith(expectedIssuer)) process.exit(1);
    }
  });
'
```

Expected: every local/public HTTP assertion and both OAuth metadata parsers exit `0`.

- [ ] **Step 7: Make ngrok authoritative and disable zrok autostart**

Run:

```bash
systemctl --user enable ngrok-devspace.service
systemctl --user disable --now zrok-lbh.service
```

Expected: both commands exit `0`.

- [ ] **Step 8: Perform the final service-state gate**

Run:

```bash
task_ngrok_url=$(
  curl --max-time 5 -fsS http://127.0.0.1:4040/api/endpoints |
  node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const endpoint = JSON.parse(input).endpoints.find(item =>
        typeof item.url === "string" && item.url.startsWith("https://")
      );
      if (!endpoint) process.exit(1);
      process.stdout.write(endpoint.url.replace(/\/+$/, ""));
    });
  '
)
systemctl --user is-active devspace.service ngrok-devspace.service
systemctl --user is-enabled ngrok-devspace.service
systemctl --user is-active zrok-lbh.service || true
systemctl --user is-enabled zrok-lbh.service || true
printf 'Public MCP URL: %s/mcp\n' "$task_ngrok_url"
```

Expected:

```text
active
active
enabled
inactive
disabled
```

The final line begins with `Public MCP URL:` and contains the exact `task_ngrok_url` value discovered in this step followed by `/mcp`.

The final URL is public configuration, not a secret. Give it to the user so they can replace the old MCP connector URL.

**Checkpoint:** ngrok is the persistent tunnel, the URL survived restart, OAuth is correct, and zrok no longer starts automatically. No Git commit is made.

---

## Rollback Summary

If failure occurs before Task 4, stop `ngrok-devspace.service`; DevSpace is unchanged.

If failure occurs after changing `publicBaseUrl`, restore `/home/ad/.devspace/config.jsonc.bak-before-ngrok-20260828`, restart DevSpace, stop ngrok, and leave zrok stopped. Do not delete the ngrok Dev Domain or zrok account data.

## Official References

- ngrok Linux standalone installation: https://ngrok.com/download/linux
- ngrok CLI and `config add-authtoken`: https://ngrok.com/docs/gateway/agent/cli
- Free-plan Dev Domain selection: https://ngrok.com/docs/share-localhost/quickstart and https://ngrok.com/docs/pricing-limits/free-plan-limits
- Loopback Agent API: https://ngrok.com/docs/gateway/agent/api
- DevSpace public URL and tunnel requirements: `docs/security.md` and `docs/gotchas.md`
