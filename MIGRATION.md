# Migration Notes

This JavaScript OpenClaw plugin has been migrated from the earlier third-party prompt image API to the SmartKV backend API.

## Main Changes

| Area | Previous | Current |
| --- | --- | --- |
| Owner | `@SoloMkt-KV` |
| Plugin ID | legacy third-party plugin ID | `solomkt_kv` |
| Generate endpoint | third-party `GenerateImage` API | SmartKV `POST /api/v1/generate-plugins` |
| Model selection | not supported | `GET /api/v1/models` before generation |
| Required fields | `prompt` | `modelId`, `activityName`, `activityTheme`, `activityTime`, `activityLocation` |
| Plugin response | generation result object | image URL list from `POST /api/v1/generate-plugins` |
| Generate flow | one-step prompt submission | check API Key, ask user to choose `/models` entry, then request missing activity fields |
| Extra description | prompt-only | optional `prompt` |
| Auth | `x-api-key` | SmartKV `x-api-key` |

## Local Development

```bash
npm install
npm run plugin:validate
npm run plugin:build
```
