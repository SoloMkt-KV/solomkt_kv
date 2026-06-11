import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const PLUGIN_ID = "solomkt_kv";
const DEFAULT_API_BASE_URL = "http://1.94.23.191:8080/api/v1";
const DEFAULT_TIMEOUT_MS = 1800000;
const API_KEY_OVERRIDE_FIELDS = ["apiKey", "api_key", "xApiKey", "x_api_key", "x-api-key"];

const PER_CALL_CONFIG_PARAMETERS = {
  apiKey: Type.Optional(Type.String({ description: "SmartKV x-api-key. Overrides plugin config for this request." })),
  api_key: Type.Optional(Type.String({ description: "Alias for apiKey." })),
  xApiKey: Type.Optional(Type.String({ description: "Alias for apiKey." })),
  x_api_key: Type.Optional(Type.String({ description: "Alias for apiKey." })),
  "x-api-key": Type.Optional(Type.String({ description: "Alias for apiKey." })),
  baseUrl: Type.Optional(Type.String({ description: `SmartKV API base URL. Defaults to ${DEFAULT_API_BASE_URL}.` })),
  timeoutMs: Type.Optional(Type.Number({ description: "Request timeout in milliseconds." })),
};

const REQUIRED_ACTIVITY_FIELDS = [
  ["activityName", "activity name"],
  ["activityTheme", "activity theme"],
  ["activityTime", "activity time"],
  ["activityLocation", "activity location"],
];
const MAX_ACTIVITY_FIELD_LENGTH = 200;
const MAX_PROMPT_LENGTH = 1000;

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

function normalizeBaseUrl(baseUrl) {
  return (baseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

function getTextValue(source, field) {
  const value = source?.[field];
  return value === undefined || value === null ? "" : String(value).trim();
}

function getApiKeyDetails(config, overrides = {}) {
  for (const field of API_KEY_OVERRIDE_FIELDS) {
    const value = getTextValue(overrides, field);
    if (value) {
      return { value, source: `tool parameter "${field}"` };
    }
  }

  const configuredApiKey = getTextValue(config, "apiKey");
  if (configuredApiKey) {
    return { value: configuredApiKey, source: "plugin config apiKey" };
  }

  if (process.env.SMARTKV_API_KEY) {
    return { value: process.env.SMARTKV_API_KEY.trim(), source: "SMARTKV_API_KEY" };
  }

  if (process.env.IMAGE_API_KEY) {
    return { value: process.env.IMAGE_API_KEY.trim(), source: "IMAGE_API_KEY" };
  }

  return { value: "", source: "none" };
}

function maskApiKey(apiKey) {
  if (!apiKey) {
    return "(empty)";
  }

  if (apiKey.length <= 16) {
    return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)} (${apiKey.length} chars)`;
  }

  return `${apiKey.slice(0, 12)}...${apiKey.slice(-8)} (${apiKey.length} chars)`;
}

function getConfig(config, overrides = {}) {
  const apiKey = getApiKeyDetails(config, overrides);
  const timeoutMs = Number(overrides?.timeoutMs || config?.timeoutMs || DEFAULT_TIMEOUT_MS);

  return {
    apiKey: apiKey.value,
    apiKeySource: apiKey.source,
    apiKeyPreview: maskApiKey(apiKey.value),
    baseUrl: normalizeBaseUrl(overrides?.baseUrl || config?.baseUrl),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => {
      return fieldValue !== undefined && fieldValue !== null && String(fieldValue).trim() !== "";
    }),
  );
}

function formatJson(value) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestJson(url, { method = "GET", apiKey, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br",
      Connection: "keep-alive",
      "User-Agent": "PostmanRuntime-ApipostRuntime/1.1.0",
    };

    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const responseBody = await readResponseBody(response);

    if (!response.ok) {
      const detail =
        typeof responseBody === "string"
          ? responseBody
          : responseBody?.message || responseBody?.error?.message || JSON.stringify(responseBody);
      const error = new Error(`HTTP ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
      error.status = response.status;
      error.responseBody = responseBody;
      throw error;
    }

    return responseBody;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function formatRequestError(error, config) {
  const message = error instanceof Error ? error.message : String(error);

  if (error?.status === 401) {
    return [
      message,
      "",
      "Auth debug:",
      `- apiKey source: ${config.apiKeySource}`,
      `- apiKey used: ${config.apiKeyPreview}`,
      `- baseUrl: ${config.baseUrl}`,
      "",
      "If this is not the key you just provided, pass it as `apiKey`, `api_key`, `xApiKey`, `x_api_key`, or `x-api-key`, or update the saved plugin config.",
    ].join("\n");
  }

  return message;
}

async function fetchModels(config, type = "all") {
  const url = `${config.baseUrl}/models?type=${encodeURIComponent(type || "all")}`;
  const response = await requestJson(url, {
    method: "GET",
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
  });

  if (response?.success === false) {
    throw new Error(response.message || response.error?.message || "Failed to fetch model list.");
  }

  return {
    system: response?.data?.system || [],
    custom: response?.data?.custom || [],
  };
}

function formatModelDisplayName(model) {
  const name = model?.name || "Unnamed model";
  const sub = model?.sub || model?.desc || "";
  return [name, sub].filter((part) => String(part).trim() !== "").join(".");
}

function formatModel(model) {
  const id = model.id ?? model.modelId;
  const tags = Array.isArray(model.tags) && model.tags.length > 0 ? ` [${model.tags.join(", ")}]` : "";
  return `- ${formatModelDisplayName(model)} (modelId: ${id})${tags}`;
}

function formatModels(models) {
  const lines = [];
  if (models.system.length > 0) {
    lines.push("System models:", ...models.system.map(formatModel));
  }
  if (models.custom.length > 0) {
    lines.push("", "Custom models:", ...models.custom.map(formatModel));
  }

  if (lines.length === 0) {
    return "No available models. Please sync or create models in SmartKV first.";
  }

  return lines.join("\n");
}

function hasText(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function getAllModels(models) {
  return [...(models.system || []), ...(models.custom || [])];
}

function findModelById(models, modelId) {
  const normalizedModelId = String(modelId).trim();
  return getAllModels(models).find((model) => {
    const id = model.id ?? model.modelId;
    return String(id) === normalizedModelId;
  });
}

function getMissingActivityFields(input) {
  return REQUIRED_ACTIVITY_FIELDS.filter(([field]) => !hasText(input?.[field]));
}

function getFieldLengthValidationMessages(input) {
  const messages = [];
  for (const [field, label] of REQUIRED_ACTIVITY_FIELDS) {
    if (hasText(input?.[field]) && String(input[field]).trim().length > MAX_ACTIVITY_FIELD_LENGTH) {
      messages.push(`${label} must be ${MAX_ACTIVITY_FIELD_LENGTH} characters or fewer.`);
    }
  }

  if (hasText(input?.prompt) && String(input.prompt).trim().length > MAX_PROMPT_LENGTH) {
    messages.push(`prompt must be ${MAX_PROMPT_LENGTH} characters or fewer.`);
  }

  return messages;
}

async function buildModelSelectionMessage(config) {
  const models = await fetchModels(config, "all");
  return [
    "Please choose an image generation model first.",
    "",
    "After choosing a model, pass that row's `modelId` to `generate_image`.",
    "",
    formatModels(models),
  ].join("\n");
}

function buildInvalidModelMessage(input, models) {
  return [
    `Could not find modelId: ${String(input.modelId).trim()}.`,
    "",
    "Please choose one of these models:",
    "",
    formatModels(models),
  ].join("\n");
}

function buildMissingActivityFieldsMessage(input, selectedModel) {
  const missingFields = getMissingActivityFields(input);
  const providedFields = REQUIRED_ACTIVITY_FIELDS
    .filter(([field]) => hasText(input?.[field]))
    .map(([field, label]) => `- ${label}: ${String(input[field]).trim()}`);

  const lines = [
    "Model received. Please provide the remaining required activity fields.",
    "",
    `modelId: ${String(input.modelId).trim()}`,
    selectedModel ? `model: ${formatModelDisplayName(selectedModel)}` : "",
  ];

  if (providedFields.length > 0) {
    lines.push("", "Received:", ...providedFields);
  }

  lines.push("", "Missing:", ...missingFields.map(([, label]) => `- ${label}`));
  return lines.join("\n");
}

function buildActivitySummary(input, selectedModel) {
  return [
    "Activity information is complete. Calling SmartKV image generation.",
    "",
    `modelId: ${String(input.modelId).trim()}`,
    selectedModel ? `model: ${formatModelDisplayName(selectedModel)}` : "",
    `activityName: ${String(input.activityName).trim()}`,
    `activityTheme: ${String(input.activityTheme).trim()}`,
    `activityTime: ${String(input.activityTime).trim()}`,
    `activityLocation: ${String(input.activityLocation).trim()}`,
    hasText(input.prompt) ? `prompt: ${String(input.prompt).trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRequestBody(input) {
  return compactObject({
    modelId: String(input.modelId).trim(),
    activityName: String(input.activityName).trim(),
    activityTheme: String(input.activityTheme).trim(),
    activityTime: String(input.activityTime).trim(),
    activityLocation: String(input.activityLocation).trim(),
    prompt: hasText(input.prompt) ? String(input.prompt).trim() : undefined,
    posterQuality: input.posterQuality,
    posterSize: input.posterSize,
  });
}

function missingApiKeyMessage() {
  return [
    "SmartKV API key is not configured.",
    "",
    "Configure it with:",
    "```bash",
    `openclaw config set plugins.${PLUGIN_ID}.apiKey YOUR_API_KEY`,
    "```",
    "",
    "Or pass it per call as `apiKey`, `api_key`, `xApiKey`, `x_api_key`, or `x-api-key`.",
  ].join("\n");
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function collectImageUrls(value) {
  if (Array.isArray(value)) {
    return value.filter(isHttpUrl);
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const candidates = [
    value.data,
    value.result,
    value.urls,
    value.images,
    value.imageUrls,
    value.data?.urls,
    value.data?.images,
    value.data?.imageUrls,
  ];

  return candidates.flatMap((candidate) => (Array.isArray(candidate) ? candidate.filter(isHttpUrl) : []));
}

function formatPluginImageUrlsResult(result, input) {
  const imageUrls = collectImageUrls(result);

  if (imageUrls.length > 0) {
    return [
      "Image generation succeeded.",
      "",
      `modelId: ${input.modelId}`,
      "",
      ...imageUrls.map((url, index) => `![Generated KV image ${index + 1}](${url})`),
    ].join("\n");
  }

  return ["SmartKV response did not include image URLs in a recognized shape.", "", formatJson(result)].join("\n");
}

export default defineToolPlugin({
  id: PLUGIN_ID,
  name: "SmartKV Image Generator",
  description: "Generate activity KV images through the SmartKV backend.",
  configSchema: Type.Object({
    apiKey: Type.Optional(Type.String({ description: "SmartKV API key, sent as request header x-api-key." })),
    baseUrl: Type.Optional(
      Type.String({
        description: `SmartKV API base URL, for example ${DEFAULT_API_BASE_URL}.`,
        default: DEFAULT_API_BASE_URL,
      }),
    ),
    timeoutMs: Type.Optional(Type.Number({ description: "Request timeout in milliseconds.", default: DEFAULT_TIMEOUT_MS })),
  }),
  tools: (tool) => [
    tool({
      name: "list_models",
      label: "List SmartKV Models",
      description: "Call SmartKV GET /api/v1/models and list available image generation models.",
      parameters: Type.Object({
        ...PER_CALL_CONFIG_PARAMETERS,
        type: Type.Optional(Type.String({ description: "Model type: system, custom, or all. Defaults to all." })),
      }),
      execute: async (input = {}, config) => {
        const { type = "all" } = input;
        const runtimeConfig = getConfig(config, input);

        if (!runtimeConfig.apiKey) {
          return textResult(missingApiKeyMessage());
        }

        try {
          const models = await fetchModels(runtimeConfig, type);
          return textResult(`Choose a modelId before generating an image.\n\n${formatModels(models)}`);
        } catch (error) {
          return textResult(`Failed to fetch SmartKV models: ${formatRequestError(error, runtimeConfig)}`);
        }
      },
    }),
    tool({
      name: "generate_image",
      label: "Generate SmartKV Image",
      description:
        "Call SmartKV POST /api/v1/generate-plugins to generate an activity KV image. Missing API key, model, or required activity fields will be requested before generation.",
      parameters: Type.Object({
        ...PER_CALL_CONFIG_PARAMETERS,
        modelId: Type.Optional(Type.String({ description: "Model ID. If missing, the plugin fetches /api/v1/models first." })),
        activityName: Type.Optional(Type.String({ description: "Activity name. Required." })),
        activityTheme: Type.Optional(Type.String({ description: "Activity theme. Required." })),
        activityTime: Type.Optional(Type.String({ description: "Activity time. Required." })),
        activityLocation: Type.Optional(Type.String({ description: "Activity location. Required." })),
        prompt: Type.Optional(Type.String({ description: "Optional generation prompt or additional text, up to 1000 characters." })),
        posterQuality: Type.Optional(Type.String({ description: "Optional poster quality, for example 2K." })),
        posterSize: Type.Optional(Type.String({ description: 'Optional poster aspect ratio, for example ["16:9"] or 16:9.' })),
      }),
      execute: async (input = {}, config) => {
        const runtimeConfig = getConfig(config, input);

        if (!runtimeConfig.apiKey) {
          return textResult(missingApiKeyMessage());
        }

        if (!hasText(input?.modelId)) {
          try {
            return textResult(await buildModelSelectionMessage(runtimeConfig));
          } catch (error) {
            return textResult(`Failed to fetch SmartKV models: ${formatRequestError(error, runtimeConfig)}`);
          }
        }

        const missingActivityFields = getMissingActivityFields(input);
        if (missingActivityFields.length > 0) {
          return textResult(buildMissingActivityFieldsMessage(input));
        }

        const validationMessages = getFieldLengthValidationMessages(input);
        if (validationMessages.length > 0) {
          return textResult(["Invalid parameters:", "", ...validationMessages.map((message) => `- ${message}`)].join("\n"));
        }

        const requestBody = buildRequestBody(input);

        try {
          const response = await requestJson(`${runtimeConfig.baseUrl}/generate-plugins`, {
            method: "POST",
            apiKey: runtimeConfig.apiKey,
            timeoutMs: runtimeConfig.timeoutMs,
            body: requestBody,
          });

          return textResult(
            [buildActivitySummary(requestBody), "", formatPluginImageUrlsResult(response, requestBody)].join("\n"),
          );
        } catch (error) {
          return textResult(`Failed to call SmartKV generate-plugins: ${formatRequestError(error, runtimeConfig)}`);
        }
      },
    }),
  ],
});
