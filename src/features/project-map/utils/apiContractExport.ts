import type {
  ProjectMapApiContractGraph,
  ProjectMapApiEndpoint,
  ProjectMapApiEvidence,
  ProjectMapApiParameter,
  ProjectMapApiResponse,
  ProjectMapApiStructuredSchemaField,
} from "../types";
import { escapeHtmlAttr } from "@/utils/html";

export type ProjectMapApiExportFormat = "markdown" | "html" | "openapi-json";

export type ProjectMapApiExportFile = {
  filename: string;
  mimeType: string;
  content: string;
};

type ApiExportEndpoint = {
  endpoint: ProjectMapApiEndpoint;
  description: string | null;
};

type ApiExportDocument = {
  title: string;
  generatedAt: string;
  endpoints: ApiExportEndpoint[];
};

const OPENAPI_HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
const OPENAPI_PRIMITIVE_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object", "null"]);

const EXPORT_FILENAMES: Record<ProjectMapApiExportFormat, string> = {
  markdown: "api-contracts.md",
  html: "api-contracts.html",
  "openapi-json": "api-contracts.openapi.json",
};

const EXPORT_MIME_TYPES: Record<ProjectMapApiExportFormat, string> = {
  markdown: "text/markdown;charset=utf-8",
  html: "text/html;charset=utf-8",
  "openapi-json": "application/json;charset=utf-8",
};

function endpointTitle(endpoint: ProjectMapApiEndpoint): string {
  return endpoint.path ?? endpoint.operationName ?? endpoint.handlerSymbol ?? endpoint.sourceFile;
}

function endpointMethod(endpoint: ProjectMapApiEndpoint): string {
  return endpoint.method ?? endpoint.protocol.toUpperCase();
}

function normalizeOpenApiMethod(endpoint: ProjectMapApiEndpoint): string | null {
  const method = endpoint.method?.trim().toLowerCase();
  return method && OPENAPI_HTTP_METHODS.has(method) ? method : null;
}

function normalizeOpenApiPath(endpoint: ProjectMapApiEndpoint): string | null {
  const rawPath = endpoint.path?.trim();
  if (!rawPath) {
    return null;
  }
  const prefixedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return prefixedPath.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
}

function endpointDescription(endpoint: ProjectMapApiEndpoint): string | null {
  return endpoint.description
    ?? endpoint.descriptionSources?.find((source) => /[\u4e00-\u9fff]/.test(source.text))?.text
    ?? endpoint.descriptionSources?.[0]?.text
    ?? endpoint.usageScenario
    ?? null;
}

function markdownEscape(value: string): string {
  return value.replace(/\|/g, "\\|");
}

const htmlEscape = escapeHtmlAttr;

function schemaFieldLines(fields: ProjectMapApiStructuredSchemaField[] | undefined, depth = 0): string[] {
  if (!fields?.length || depth > 5) {
    return [];
  }
  return fields.flatMap((field) => {
    const prefix = "  ".repeat(depth);
    return [
      `${prefix}- ${field.name}${field.type ? `: ${field.type}` : ""}${field.required ? " required" : ""}${field.description ? ` - ${field.description}` : ""}`,
      ...schemaFieldLines(field.children, depth + 1),
    ];
  });
}

function schemaFieldMarkdownRows(
  fields: ProjectMapApiStructuredSchemaField[] | undefined,
  parentPath: string,
  depth = 0,
): string[] {
  if (!fields?.length || depth > 5) {
    return [];
  }
  return fields.flatMap((field) => {
    const path = parentPath ? `${parentPath}.${field.name}` : field.name;
    return [
      `| ${markdownEscape(path)} | ${markdownEscape(field.type ?? "unavailable")} | ${field.required ? "true" : "false"} | ${markdownEscape(field.description ?? field.defaultValue ?? field.example ?? "")} |`,
      ...schemaFieldMarkdownRows(field.children, path, depth + 1),
    ];
  });
}

function evidenceSummary(evidence: ProjectMapApiEvidence[]): string {
  return evidence
    .slice(0, 4)
    .map((entry) => `${entry.parserSource} ${entry.path}${entry.line ? `:${entry.line}` : ""}`)
    .join("; ");
}

function buildExportDocument(graph: ProjectMapApiContractGraph): ApiExportDocument {
  return {
    title: "API Documentation",
    generatedAt: graph.generatedAt,
    endpoints: graph.endpoints.map((endpoint) => ({
      endpoint,
      description: endpointDescription(endpoint),
    })),
  };
}

function renderMarkdownParameter(parameter: ProjectMapApiParameter): string {
  return [
    markdownEscape(parameter.name),
    parameter.location,
    parameter.required ? "true" : "false",
    markdownEscape(parameter.schema?.name ?? parameter.defaultValue ?? parameter.example ?? "unavailable"),
    markdownEscape(parameter.description ?? ""),
  ].join(" | ");
}

function renderMarkdownResponse(response: ProjectMapApiResponse): string {
  return [
    response.statusCode ?? "response",
    response.contentType ?? "unknown",
    markdownEscape(response.schema?.name ?? "unavailable"),
    response.isError ? "true" : "false",
  ].join(" | ");
}

function renderMarkdown(document: ApiExportDocument): string {
  const lines = [`# ${document.title}`, "", `Generated at: ${document.generatedAt}`, ""];
  for (const item of document.endpoints) {
    const endpoint = item.endpoint;
    lines.push(`## ${endpointMethod(endpoint)} ${endpointTitle(endpoint)}`, "");
    lines.push("### Description", "");
    lines.push(item.description ?? "Unavailable.", "");
    lines.push("### Parameters", "");
    if (endpoint.parameters.length) {
      lines.push("| Name | In | Required | Schema / Example | Description |");
      lines.push("|---|---|---:|---|---|");
      endpoint.parameters.forEach((parameter) => lines.push(`| ${renderMarkdownParameter(parameter)} |`));
      const fieldRows = endpoint.parameters.flatMap((parameter) => schemaFieldMarkdownRows(
        parameter.structuredFields,
        parameter.name,
      ));
      if (fieldRows.length) {
        lines.push("", "#### Parameter fields", "");
        lines.push("| Field | Type | Required | Description / Example |");
        lines.push("|---|---|---:|---|");
        lines.push(...fieldRows);
      }
    } else {
      lines.push("Unavailable.");
    }
    lines.push("", "### Request Body", "");
    if (endpoint.requestBody) {
      lines.push(`Content-Type: ${endpoint.requestBody.contentType ?? "unknown"}`);
      lines.push(`Schema: ${endpoint.requestBody.schema?.name ?? "unavailable"}`);
      lines.push(...schemaFieldLines(endpoint.requestBody.structuredFields));
    } else {
      lines.push("Unavailable.");
    }
    lines.push("", "### Responses", "");
    if (endpoint.responses.length) {
      lines.push("| Status | Content-Type | Schema | Error |");
      lines.push("|---|---|---|---:|");
      endpoint.responses.forEach((response) => lines.push(`| ${renderMarkdownResponse(response)} |`));
    } else {
      lines.push("Unavailable.");
    }
    lines.push("", "### Evidence", "");
    lines.push(evidenceSummary(endpoint.evidence) || "Unavailable.");
    lines.push("");
  }
  return lines.join("\n");
}

function renderHtml(document: ApiExportDocument): string {
  const endpointHtml = document.endpoints.map((item) => {
    const endpoint = item.endpoint;
    const parameters = endpoint.parameters.length
      ? endpoint.parameters.map((parameter) => (
          `<tr><td>${htmlEscape(parameter.name)}</td><td>${htmlEscape(parameter.location)}</td><td>${parameter.required ? "true" : "false"}</td><td>${htmlEscape(parameter.schema?.name ?? parameter.defaultValue ?? parameter.example ?? "unavailable")}</td><td>${htmlEscape(parameter.description ?? "")}</td></tr>`
        )).join("")
      : `<p class="empty">Unavailable.</p>`;
    const parameterFields = endpoint.parameters.flatMap((parameter) => schemaFieldMarkdownRows(
      parameter.structuredFields,
      parameter.name,
    ));
    const responses = endpoint.responses.length
      ? endpoint.responses.map((response) => (
          `<tr><td>${htmlEscape(response.statusCode ?? "response")}</td><td>${htmlEscape(response.contentType ?? "unknown")}</td><td>${htmlEscape(response.schema?.name ?? "unavailable")}</td><td>${response.isError ? "true" : "false"}</td></tr>`
        )).join("")
      : `<p class="empty">Unavailable.</p>`;
    return `<section class="endpoint"><h2><span>${htmlEscape(endpointMethod(endpoint))}</span> ${htmlEscape(endpointTitle(endpoint))}</h2><h3>Description</h3><p>${htmlEscape(item.description ?? "Unavailable.")}</p><h3>Parameters</h3>${endpoint.parameters.length ? `<table><tbody>${parameters}</tbody></table>` : parameters}${parameterFields.length ? `<h4>Parameter fields</h4><pre>${htmlEscape(parameterFields.join("\\n"))}</pre>` : ""}<h3>Request Body</h3><p>${htmlEscape(endpoint.requestBody?.schema?.name ?? endpoint.parameters.find((parameter) => parameter.location === "body")?.schema?.name ?? "Unavailable.")}</p><h3>Responses</h3>${endpoint.responses.length ? `<table><tbody>${responses}</tbody></table>` : responses}<h3>Evidence</h3><p>${htmlEscape(evidenceSummary(endpoint.evidence) || "Unavailable.")}</p></section>`;
  }).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(document.title)}</title><style>body{font-family:system-ui,sans-serif;margin:32px;line-height:1.5;color:#172033}.endpoint{border:1px solid #d8dee9;border-radius:14px;padding:18px;margin:18px 0}h2 span{background:#2563eb;color:#fff;border-radius:8px;padding:3px 8px;font-size:.75em}table{border-collapse:collapse;width:100%}td{border:1px solid #d8dee9;padding:6px}.empty{color:#667085}</style></head><body><h1>${htmlEscape(document.title)}</h1><p>Generated at: ${htmlEscape(document.generatedAt)}</p>${endpointHtml}</body></html>`;
}

function primitiveSchemaOrContractName(typeName: string | undefined): Record<string, unknown> {
  const normalizedType = typeName?.trim();
  if (!normalizedType) {
    return { type: "object", "x-project-map-unavailable": true };
  }
  const lowerType = normalizedType.toLowerCase();
  if (OPENAPI_PRIMITIVE_TYPES.has(lowerType)) {
    return { type: lowerType };
  }
  return {
    type: "object",
    "x-project-map-schemaName": normalizedType,
  };
}

function schemaNameFromFields(fields: ProjectMapApiStructuredSchemaField[] | undefined): Record<string, unknown> | undefined {
  if (!fields?.length) {
    return undefined;
  }
  const properties = Object.fromEntries(fields.map((field) => [
    field.name,
    (() => {
      const childSchema = schemaNameFromFields(field.children);
      return {
        ...primitiveSchemaOrContractName(field.type),
        description: field.description,
        ...(childSchema ? { properties: childSchema["properties"] } : {}),
      };
    })(),
  ]));
  const required = fields.filter((field) => field.required).map((field) => field.name);
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
  };
}

function renderOpenApiJson(document: ApiExportDocument): string {
  const paths: Record<string, Record<string, unknown>> = {};
  const unsupportedEndpoints: Array<Record<string, unknown>> = [];
  const duplicateEndpoints: Array<Record<string, unknown>> = [];
  for (const item of document.endpoints) {
    const endpoint = item.endpoint;
    const path = normalizeOpenApiPath(endpoint);
    const method = normalizeOpenApiMethod(endpoint);
    if (!path || !method) {
      unsupportedEndpoints.push({
        id: endpoint.id,
        protocol: endpoint.protocol,
        method: endpoint.method,
        path: endpoint.path,
        reason: !path ? "path-unavailable" : "http-method-unavailable",
      });
      continue;
    }
    const bodyParameter = endpoint.parameters.find((parameter) => parameter.location === "body");
    const requestBody = endpoint.requestBody;
    const requestFields = requestBody?.structuredFields?.length
      ? requestBody.structuredFields
      : bodyParameter?.structuredFields;
    const responses = endpoint.responses.length
      ? endpoint.responses
      : [{
          statusCode: "default",
          contentType: undefined,
          schema: undefined,
          structuredFields: undefined,
          isError: false,
          evidence: [],
        } satisfies ProjectMapApiResponse];
    const operation = {
      summary: item.description ?? endpoint.operationName ?? endpoint.handlerSymbol,
          operationId: endpoint.operationName ?? endpoint.handlerSymbol ?? endpoint.id,
          parameters: endpoint.parameters.filter((parameter) => parameter.location !== "body").map((parameter) => ({
            name: parameter.name,
            in: parameter.location,
            required: Boolean(parameter.required),
            description: parameter.description,
            schema: primitiveSchemaOrContractName(parameter.schema?.name),
            example: parameter.example,
          })),
          requestBody: requestBody || bodyParameter
            ? {
                required: Boolean(requestBody?.required ?? bodyParameter?.required),
                content: {
                  [requestBody?.contentType ?? "application/json"]: {
                    schema: schemaNameFromFields(requestFields)
                      ?? primitiveSchemaOrContractName(requestBody?.schema?.name ?? bodyParameter?.schema?.name),
                  },
                },
              }
            : undefined,
          responses: Object.fromEntries(responses.map((response) => [
        response.statusCode ?? "default",
        {
          description: response.isError ? "Error response" : "Response",
          content: response.contentType
            ? {
                [response.contentType]: {
                  schema: schemaNameFromFields(response.structuredFields)
                    ?? primitiveSchemaOrContractName(response.schema?.name),
                },
              }
            : undefined,
          "x-project-map-unavailable": !response.schema && !response.structuredFields?.length,
        },
      ])),
      "x-project-map-confidence": endpoint.confidence,
      "x-project-map-evidence": endpoint.evidence.map((entry) => ({
        path: entry.path,
        line: entry.line,
        parserSource: entry.parserSource,
          redacted: entry.redacted,
        })),
      };
    if (paths[path]?.[method]) {
      duplicateEndpoints.push({
        id: endpoint.id,
        method,
        path,
        reason: "duplicate-openapi-operation",
      });
      continue;
    }
    paths[path] ??= {};
    paths[path][method] = operation;
  }
  return JSON.stringify({
    openapi: "3.0.3",
    info: {
      title: document.title,
      version: "0.0.0",
    },
    paths,
    ...(unsupportedEndpoints.length ? { "x-project-map-unsupportedEndpoints": unsupportedEndpoints } : {}),
    ...(duplicateEndpoints.length ? { "x-project-map-duplicateEndpoints": duplicateEndpoints } : {}),
  }, null, 2);
}

export function buildProjectMapApiExportFile(
  graph: ProjectMapApiContractGraph,
  format: ProjectMapApiExportFormat,
): ProjectMapApiExportFile {
  const document = buildExportDocument(graph);
  const content = format === "markdown"
    ? renderMarkdown(document)
    : format === "html"
      ? renderHtml(document)
      : renderOpenApiJson(document);
  return {
    filename: EXPORT_FILENAMES[format],
    mimeType: EXPORT_MIME_TYPES[format],
    content,
  };
}
