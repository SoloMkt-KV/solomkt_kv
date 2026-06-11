# SmartKV Image Generator Plugin for OpenClaw

Owner: `@SoloMkt-KV`

This OpenClaw tool plugin generates activity KV images through the SmartKV backend.

## Tools

- `list_models`: calls `GET /api/v1/models` and asks the user to choose a model.
- `generate_image`: calls `POST /api/v1/generate-plugins` with `x-api-key`.

## Configuration

```bash
openclaw config set plugins.solomkt_kv.apiKey YOUR_API_KEY
openclaw config set plugins.solomkt_kv.baseUrl http://1.94.23.191:8080/api/v1
```

Environment variable fallback is also supported:

```bash
export SMARTKV_API_KEY=YOUR_API_KEY
```

Both tools also accept per-call config parameters. `apiKey`, `api_key`, `xApiKey`, `x_api_key`, and `x-api-key` are accepted as API key aliases and override saved plugin config and environment variables. `baseUrl` and `timeoutMs` can also be passed per call.

## Required Generate Parameters

- `modelId`
- `activityName`
- `activityTheme`
- `activityTime`
- `activityLocation`

Optional parameters:

- `prompt`
- `posterQuality`
- `posterSize`

Field limits:

- `activityName`, `activityTheme`, `activityTime`, `activityLocation`: max 200 characters each
- `prompt`: max 1000 characters

## Generate Interaction Flow

When the user asks to generate an image, `generate_image` follows this order:

1. Check whether `apiKey` is configured.
2. If `apiKey` exists but `modelId` is missing, query `/api/v1/models` and ask the user to choose a model.
3. Models are shown as `name.sub（modelId: id）`; the selected row's `id` should be passed as `modelId`.
4. After `modelId` is available, check whether `activityName`, `activityTheme`, `activityTime`, and `activityLocation` are present and ask the user to provide any missing fields.
5. Only call `POST /api/v1/generate-plugins` after all required parameters are ready.

Example:

```text
modelId: 1001
activityName: 春季发布会
activityTheme: 科技新品
activityTime: 2026年6月18日
activityLocation: 上海
prompt: 画面风格高级、明亮、有舞台灯光
posterQuality: 2K
posterSize: ["16:9"]
```

## Development

```bash
npm install
npm run plugin:validate
npm run plugin:build
```

## Publish

OpenClaw validation and package preview:

```bash
npm run plugin:build
npm run plugin:validate
npm run plugin:pack
```

Publish to npm:

```bash
npm publish --access public
```

Publish to ClawHub as an OpenClaw code plugin requires a GitHub source repo and commit:

```bash
clawhub package publish . \
  --family=code-plugin \
  --owner=@SoloMkt-KV \
  --name=solomkt_kv \
  --display-name="SmartKV Image Generator" \
  --version=2.0.0 \
  --source-repo=OWNER/REPO \
  --source-commit=COMMIT_SHA \
  --tags=latest
```

Use `--dry-run --json` first to preview without uploading.
