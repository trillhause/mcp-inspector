"use client";

import { type FormEvent, useCallback, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Copy, Loader2, RotateCcw } from "lucide-react";

import type { ToolCapability } from "@/components/capability-list-rows";
import { InteractionResultMetadata } from "@/components/interaction-result-metadata";
import {
  JsonPayloadViewer,
  normalizePayload,
} from "@/components/json-payload-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  ExecuteToolSuccessResponse,
  InteractionRunState,
} from "@/lib/mcp/interaction-contract";
import { cn } from "@/lib/utils";

type ToolExecutionWorkspaceProps = {
  serverId: string;
  serverName: string;
  tools: ToolCapability[];
};

type SchemaFieldKind =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "json";

type SchemaField = {
  name: string;
  label: string;
  description: string | null;
  kind: SchemaFieldKind;
  required: boolean;
  enumValues: Array<string | number | boolean>;
  defaultValue: unknown;
  minLength: number | null;
  maxLength: number | null;
  minimum: number | null;
  maximum: number | null;
};

type ToolFormDefinition = {
  mode: "fields" | "raw_json";
  fields: SchemaField[];
  rawDefault: string;
};

type ValidationOutcome = {
  argumentsPayload: Record<string, unknown> | null;
  fieldErrors: Record<string, string[]>;
  summaryErrors: string[];
};

type ToolExecutionError = {
  code: string;
  message: string;
  details: string[];
  source: "client" | "server" | "network";
  failedAt: string;
};

type ExecuteApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

const RAW_ARGUMENTS_FIELD = "__raw_arguments_json";
const EMPTY_OBJECT_JSON = "{}";
const SUPPORTED_FIELD_ORDER: SchemaFieldKind[] = [
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
];
const SELECT_BASE_CLASS_NAME =
  "border-input bg-background ring-offset-background flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function normalizeTypeList(schema: Record<string, unknown>) {
  const typeValue = schema.type;
  if (typeof typeValue === "string") {
    return [typeValue];
  }

  if (!Array.isArray(typeValue)) {
    return [];
  }

  return typeValue.filter((item): item is string => typeof item === "string");
}

function isObjectLikeRootSchema(schema: Record<string, unknown>) {
  const declaredTypes = normalizeTypeList(schema);
  if (declaredTypes.includes("object")) {
    return true;
  }

  if (isRecord(schema.properties)) {
    return true;
  }

  if (Array.isArray(schema.required)) {
    return true;
  }

  return "additionalProperties" in schema;
}

function parseRequiredProperties(schema: Record<string, unknown>) {
  if (!Array.isArray(schema.required)) {
    return new Set<string>();
  }

  const values = schema.required.filter((item): item is string => typeof item === "string");
  return new Set(values);
}

function inferFieldKind(schema: Record<string, unknown>): SchemaFieldKind {
  const declaredTypes = normalizeTypeList(schema);
  for (const candidate of SUPPORTED_FIELD_ORDER) {
    if (declaredTypes.includes(candidate)) {
      return candidate;
    }
  }

  if (isRecord(schema.properties)) {
    return "object";
  }

  if ("items" in schema) {
    return "array";
  }

  return "json";
}

function normalizeEnumValues(
  schema: Record<string, unknown>,
  kind: SchemaFieldKind,
): Array<string | number | boolean> {
  if (!Array.isArray(schema.enum)) {
    return [];
  }

  if (kind === "string") {
    return schema.enum.filter((item): item is string => typeof item === "string");
  }

  if (kind === "number") {
    return schema.enum.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  }

  if (kind === "integer") {
    return schema.enum.filter((item): item is number => typeof item === "number" && Number.isInteger(item));
  }

  if (kind === "boolean") {
    return schema.enum.filter((item): item is boolean => typeof item === "boolean");
  }

  return [];
}

function toDefaultString(kind: SchemaFieldKind, value: unknown) {
  if (value === undefined) {
    return "";
  }

  if (kind === "string") {
    return typeof value === "string" ? value : "";
  }

  if (kind === "number" || kind === "integer") {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  }

  if (kind === "boolean") {
    if (value === true) {
      return "true";
    }
    if (value === false) {
      return "false";
    }
    return "";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function buildFieldDefaultDraft(field: SchemaField) {
  const explicitDefault = toDefaultString(field.kind, field.defaultValue);
  if (explicitDefault.length > 0) {
    return explicitDefault;
  }

  if (field.required && field.enumValues.length > 0) {
    return String(field.enumValues[0]);
  }

  if (field.kind === "boolean" && field.required) {
    return "false";
  }

  if (field.kind === "object" && field.required) {
    return "{}";
  }

  if (field.kind === "array" && field.required) {
    return "[]";
  }

  return "";
}

function buildRawDefault(schema: Record<string, unknown>) {
  const defaultValue = schema.default;
  if (isRecord(defaultValue)) {
    try {
      return JSON.stringify(defaultValue, null, 2);
    } catch {
      return EMPTY_OBJECT_JSON;
    }
  }

  return EMPTY_OBJECT_JSON;
}

function buildToolFormDefinition(inputSchema: Record<string, unknown>): ToolFormDefinition {
  const properties = isRecord(inputSchema.properties) ? inputSchema.properties : null;
  const requiredProperties = parseRequiredProperties(inputSchema);
  const hasProperties = Boolean(properties && Object.keys(properties).length > 0);
  const allowsAdditionalProperties = inputSchema.additionalProperties !== false;
  const needsRawJsonMode =
    !isObjectLikeRootSchema(inputSchema) || (!hasProperties && allowsAdditionalProperties);

  if (needsRawJsonMode) {
    const result: ToolFormDefinition = {
      mode: "raw_json",
      fields: [],
      rawDefault: buildRawDefault(inputSchema),
    };
    return result;
  }

  const fields: SchemaField[] = [];
  for (const [propertyName, propertySchema] of Object.entries(properties ?? {})) {
    const schema = isRecord(propertySchema) ? propertySchema : {};
    const kind = inferFieldKind(schema);
    fields.push({
      name: propertyName,
      label: normalizeOptionalString(schema.title) ?? propertyName,
      description: normalizeOptionalString(schema.description),
      kind,
      required: requiredProperties.has(propertyName),
      enumValues: normalizeEnumValues(schema, kind),
      defaultValue: schema.default,
      minLength: normalizeInteger(schema.minLength),
      maxLength: normalizeInteger(schema.maxLength),
      minimum: normalizeNumber(schema.minimum),
      maximum: normalizeNumber(schema.maximum),
    });
  }

  return {
    mode: "fields",
    fields,
    rawDefault: buildRawDefault(inputSchema),
  };
}

function buildInitialDraftValues(definition: ToolFormDefinition) {
  const values: Record<string, string> = {};

  if (definition.mode === "raw_json") {
    values[RAW_ARGUMENTS_FIELD] = definition.rawDefault;
    return values;
  }

  for (const field of definition.fields) {
    values[field.name] = buildFieldDefaultDraft(field);
  }

  return values;
}

function addFieldError(
  errors: Record<string, string[]>,
  fieldName: string,
  message: string,
) {
  const existing = errors[fieldName] ?? [];
  errors[fieldName] = [...existing, message];
}

function readSelectValueFromDraft(field: SchemaField, draftValue: string) {
  if (field.kind === "string") {
    return draftValue;
  }

  if (field.kind === "number" || field.kind === "integer") {
    const parsed = Number(draftValue);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  if (field.kind === "boolean") {
    return draftValue === "true";
  }

  return draftValue;
}

function validateFieldValue(
  field: SchemaField,
  draftValue: string,
  fieldErrors: Record<string, string[]>,
) {
  const trimmedValue = draftValue.trim();
  if (trimmedValue.length === 0) {
    if (field.required) {
      addFieldError(fieldErrors, field.name, "This field is required.");
    }
    return undefined;
  }

  if (field.enumValues.length > 0 && field.kind !== "object" && field.kind !== "array" && field.kind !== "json") {
    const parsedEnumValue = readSelectValueFromDraft(field, trimmedValue);
    const matchesEnum = field.enumValues.some((candidate) => candidate === parsedEnumValue);
    if (!matchesEnum) {
      addFieldError(fieldErrors, field.name, "Value must match one of the allowed options.");
      return undefined;
    }
    return parsedEnumValue;
  }

  if (field.kind === "string") {
    if (field.minLength !== null && draftValue.length < field.minLength) {
      addFieldError(fieldErrors, field.name, `Must be at least ${field.minLength} characters.`);
    }
    if (field.maxLength !== null && draftValue.length > field.maxLength) {
      addFieldError(fieldErrors, field.name, `Must be at most ${field.maxLength} characters.`);
    }
    return draftValue;
  }

  if (field.kind === "number" || field.kind === "integer") {
    const parsed = Number(trimmedValue);
    if (!Number.isFinite(parsed)) {
      addFieldError(fieldErrors, field.name, "Enter a valid number.");
      return undefined;
    }
    if (field.kind === "integer" && !Number.isInteger(parsed)) {
      addFieldError(fieldErrors, field.name, "Enter a whole number.");
      return undefined;
    }
    if (field.minimum !== null && parsed < field.minimum) {
      addFieldError(fieldErrors, field.name, `Must be greater than or equal to ${field.minimum}.`);
    }
    if (field.maximum !== null && parsed > field.maximum) {
      addFieldError(fieldErrors, field.name, `Must be less than or equal to ${field.maximum}.`);
    }
    return parsed;
  }

  if (field.kind === "boolean") {
    if (trimmedValue !== "true" && trimmedValue !== "false") {
      addFieldError(fieldErrors, field.name, "Select either true or false.");
      return undefined;
    }
    return trimmedValue === "true";
  }

  try {
    const parsed = JSON.parse(trimmedValue) as unknown;
    if (field.kind === "object" && (!isRecord(parsed) || Array.isArray(parsed))) {
      addFieldError(fieldErrors, field.name, "Enter a valid JSON object.");
      return undefined;
    }
    if (field.kind === "array" && !Array.isArray(parsed)) {
      addFieldError(fieldErrors, field.name, "Enter a valid JSON array.");
      return undefined;
    }
    return parsed;
  } catch {
    if (field.kind === "array") {
      addFieldError(fieldErrors, field.name, "Enter valid JSON for an array value.");
    } else if (field.kind === "object") {
      addFieldError(fieldErrors, field.name, "Enter valid JSON for an object value.");
    } else {
      addFieldError(fieldErrors, field.name, "Enter valid JSON.");
    }
    return undefined;
  }
}

function validateDraftValues(
  definition: ToolFormDefinition,
  values: Record<string, string>,
): ValidationOutcome {
  if (definition.mode === "raw_json") {
    const rawValue = values[RAW_ARGUMENTS_FIELD]?.trim() ?? "";
    if (!rawValue) {
      return {
        argumentsPayload: {},
        fieldErrors: {},
        summaryErrors: [],
      };
    }

    try {
      const parsed = JSON.parse(rawValue) as unknown;
      if (!isRecord(parsed) || Array.isArray(parsed)) {
        return {
          argumentsPayload: null,
          fieldErrors: {
            [RAW_ARGUMENTS_FIELD]: ["Arguments must be a JSON object."],
          },
          summaryErrors: ["Arguments must be a JSON object."],
        };
      }

      return {
        argumentsPayload: parsed,
        fieldErrors: {},
        summaryErrors: [],
      };
    } catch {
      return {
        argumentsPayload: null,
        fieldErrors: {
          [RAW_ARGUMENTS_FIELD]: ["Arguments JSON is invalid."],
        },
        summaryErrors: ["Arguments JSON is invalid."],
      };
    }
  }

  const fieldErrors: Record<string, string[]> = {};
  const argumentsPayload: Record<string, unknown> = {};

  for (const field of definition.fields) {
    const parsedValue = validateFieldValue(field, values[field.name] ?? "", fieldErrors);
    if (parsedValue !== undefined) {
      argumentsPayload[field.name] = parsedValue;
    }
  }

  const summaryErrors = Object.values(fieldErrors).flat();
  if (summaryErrors.length > 0) {
    return {
      argumentsPayload: null,
      fieldErrors,
      summaryErrors,
    };
  }

  return {
    argumentsPayload,
    fieldErrors: {},
    summaryErrors: [],
  };
}

function normalizeErrorDetails(details: unknown) {
  if (!Array.isArray(details)) {
    return [];
  }

  return details
    .map((detail) => normalizeOptionalString(detail))
    .filter((detail): detail is string => Boolean(detail));
}

function normalizeExecutionSuccess(payload: unknown): ExecuteToolSuccessResponse | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (!isRecord(payload.target) || payload.target.type !== "tool") {
    return null;
  }

  if (payload.status !== "success") {
    return null;
  }

  return payload as ExecuteToolSuccessResponse;
}

function getFieldHint(field: SchemaField) {
  const hints: string[] = [];
  if (field.required) {
    hints.push("Required");
  }
  if (field.kind === "number" || field.kind === "integer") {
    if (field.minimum !== null) {
      hints.push(`Min ${field.minimum}`);
    }
    if (field.maximum !== null) {
      hints.push(`Max ${field.maximum}`);
    }
  }
  if (field.kind === "string") {
    if (field.minLength !== null) {
      hints.push(`Min length ${field.minLength}`);
    }
    if (field.maxLength !== null) {
      hints.push(`Max length ${field.maxLength}`);
    }
  }
  if (field.kind === "object" || field.kind === "array" || field.kind === "json") {
    hints.push("JSON");
  }

  return hints.join(" • ");
}

function buildToolErrorDiagnostics(
  error: ToolExecutionError,
  toolName: string,
  serverName: string,
) {
  return JSON.stringify(
    {
      code: error.code,
      source: error.source,
      message: error.message,
      details: error.details,
      server: serverName,
      tool_name: toolName,
      failed_at: error.failedAt,
    },
    null,
    2,
  );
}

export function ToolExecutionWorkspace({
  serverId,
  serverName,
  tools,
}: ToolExecutionWorkspaceProps) {
  const [selectedToolName, setSelectedToolName] = useState<string>(tools[0]?.name ?? "");

  const resolvedToolName = useMemo(() => {
    if (tools.length === 0) {
      return "";
    }

    return tools.some((tool) => tool.name === selectedToolName)
      ? selectedToolName
      : tools[0].name;
  }, [selectedToolName, tools]);

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.name === resolvedToolName) ?? null,
    [resolvedToolName, tools],
  );

  if (tools.length === 0) {
    return (
      <p className="rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
        No tools discovered for this server.
      </p>
    );
  }

  return (
    <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(220px,300px)_1fr]">
      <section className="min-h-0 rounded-lg border bg-background p-2">
        <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">Select a tool</p>
        <ul className="space-y-1">
          {tools.map((tool) => {
            const isSelected = resolvedToolName === tool.name;
            const hasSchema = Object.keys(tool.inputSchema).length > 0;
            return (
              <li key={tool.name}>
                <button
                  type="button"
                  className={cn(
                    "w-full rounded-md border px-3 py-2 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-transparent hover:border-border hover:bg-muted/60",
                  )}
                  onClick={() => setSelectedToolName(tool.name)}
                  aria-pressed={isSelected}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{tool.name}</p>
                    <Badge variant={hasSchema ? "secondary" : "outline"} className="shrink-0">
                      {hasSchema ? "Schema" : "No Schema"}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {tool.description ?? "No description provided."}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="min-h-0 min-w-0 rounded-lg border bg-background p-3">
        {selectedTool ? (
          <ToolExecutionForm
            key={`${serverId}:${selectedTool.name}`}
            serverId={serverId}
            serverName={serverName}
            selectedTool={selectedTool}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Select a tool to execute.</p>
        )}
      </section>
    </div>
  );
}

function ToolExecutionForm({
  serverId,
  serverName,
  selectedTool,
}: {
  serverId: string;
  serverName: string;
  selectedTool: ToolCapability;
}) {
  const formDefinition = useMemo(
    () => buildToolFormDefinition(selectedTool.inputSchema),
    [selectedTool.inputSchema],
  );
  const [draftValues, setDraftValues] = useState<Record<string, string>>(() =>
    buildInitialDraftValues(formDefinition),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [summaryErrors, setSummaryErrors] = useState<string[]>([]);
  const [runState, setRunState] = useState<InteractionRunState>("idle");
  const [executionResult, setExecutionResult] = useState<ExecuteToolSuccessResponse | null>(null);
  const [executionError, setExecutionError] = useState<ToolExecutionError | null>(null);
  const [lastSubmittedArguments, setLastSubmittedArguments] = useState<Record<string, unknown> | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);

  const copyText = useCallback(async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setClipboardNotice(successMessage);
    } catch {
      setClipboardNotice("Clipboard copy failed.");
    }
  }, []);

  const updateDraftValue = useCallback(
    (fieldName: string, value: string) => {
      setDraftValues((previousValues) => {
        const nextValues = {
          ...previousValues,
          [fieldName]: value,
        };

        if (hasSubmitted) {
          const validation = validateDraftValues(formDefinition, nextValues);
          setFieldErrors(validation.fieldErrors);
          setSummaryErrors(validation.summaryErrors);
        }

        return nextValues;
      });

      if (runState !== "executing") {
        setRunState("idle");
      }
      setExecutionResult(null);
      setExecutionError(null);
      setClipboardNotice(null);
    },
    [formDefinition, hasSubmitted, runState],
  );

  const executeArguments = useCallback(
    async (argumentsPayload: Record<string, unknown>) => {
      setRunState("executing");
      setExecutionResult(null);
      setExecutionError(null);
      setClipboardNotice(null);

      try {
        const response = await fetch(
          `/api/mcp/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(selectedTool.name)}/execute`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              arguments: argumentsPayload,
            }),
          },
        );

        const payload = (await response.json().catch(() => null)) as unknown;
        if (!response.ok) {
          const normalizedPayload = (isRecord(payload) ? payload : {}) as ExecuteApiErrorPayload;
          const message =
            normalizeOptionalString(normalizedPayload.error?.message) ??
            `Tool execution failed (HTTP ${response.status})`;
          setExecutionError({
            code: normalizeOptionalString(normalizedPayload.error?.code) ?? "EXECUTION_FAILED",
            message,
            details: normalizeErrorDetails(normalizedPayload.error?.details),
            source: "server",
            failedAt: new Date().toISOString(),
          });
          setRunState("error");
          return;
        }

        const normalized = normalizeExecutionSuccess(payload);
        if (!normalized) {
          setExecutionError({
            code: "INTERNAL_ERROR",
            message: "Execution succeeded but response payload was invalid.",
            details: [],
            source: "client",
            failedAt: new Date().toISOString(),
          });
          setRunState("error");
          return;
        }

        setExecutionResult(normalized);
        setRunState("success");
      } catch (error) {
        setExecutionError({
          code: "NETWORK_ERROR",
          message: error instanceof Error ? error.message : "Tool execution request failed.",
          details: [],
          source: "network",
          failedAt: new Date().toISOString(),
        });
        setRunState("error");
      }
    },
    [selectedTool.name, serverId],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      setHasSubmitted(true);
      setRunState("validating");

      const validation = validateDraftValues(formDefinition, draftValues);
      setFieldErrors(validation.fieldErrors);
      setSummaryErrors(validation.summaryErrors);

      if (!validation.argumentsPayload) {
        setExecutionResult(null);
        setExecutionError({
          code: "VALIDATION_ERROR",
          message: "Please correct validation errors before execution.",
          details: validation.summaryErrors,
          source: "client",
          failedAt: new Date().toISOString(),
        });
        setRunState("error");
        return;
      }

      setLastSubmittedArguments(validation.argumentsPayload);
      await executeArguments(validation.argumentsPayload);
    },
    [draftValues, executeArguments, formDefinition],
  );

  const handleRetry = useCallback(() => {
    if (!lastSubmittedArguments || runState === "executing") {
      return;
    }

    void executeArguments(lastSubmittedArguments);
  }, [executeArguments, lastSubmittedArguments, runState]);

  return (
    <form className="flex h-full min-h-0 min-w-0 flex-col gap-4" onSubmit={handleSubmit}>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{selectedTool.name}</h3>
          <Badge variant="outline">{runState}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {selectedTool.description ?? "No description provided."}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {formDefinition.mode === "raw_json" ? (
          <div className="space-y-2">
            <Label htmlFor={RAW_ARGUMENTS_FIELD}>Arguments JSON</Label>
            <Textarea
              id={RAW_ARGUMENTS_FIELD}
              value={draftValues[RAW_ARGUMENTS_FIELD] ?? ""}
              onChange={(event) =>
                updateDraftValue(RAW_ARGUMENTS_FIELD, event.target.value)
              }
              className="min-h-36 font-mono text-xs"
              aria-invalid={Boolean(fieldErrors[RAW_ARGUMENTS_FIELD]?.length)}
              disabled={runState === "executing"}
            />
            {fieldErrors[RAW_ARGUMENTS_FIELD]?.map((error, index) => (
              <p key={index} className="text-xs text-destructive">
                {error}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">
              Use a JSON object containing the tool arguments.
            </p>
          </div>
        ) : formDefinition.fields.length > 0 ? (
          formDefinition.fields.map((field) => {
            const hasError = Boolean(fieldErrors[field.name]?.length);
            const fieldId = `tool-field-${field.name}`;
            const hint = getFieldHint(field);

            return (
              <div key={field.name} className="space-y-1.5">
                <Label htmlFor={fieldId}>
                  {field.label}
                  {field.required ? <span className="text-destructive">*</span> : null}
                </Label>
                {field.enumValues.length > 0 && field.kind !== "object" && field.kind !== "array" && field.kind !== "json" ? (
                  <select
                    id={fieldId}
                    value={draftValues[field.name] ?? ""}
                    onChange={(event) => updateDraftValue(field.name, event.target.value)}
                    className={SELECT_BASE_CLASS_NAME}
                    aria-invalid={hasError}
                    disabled={runState === "executing"}
                  >
                    {!field.required ? <option value="">(optional)</option> : null}
                    {field.enumValues.map((optionValue) => (
                      <option key={String(optionValue)} value={String(optionValue)}>
                        {String(optionValue)}
                      </option>
                    ))}
                  </select>
                ) : field.kind === "boolean" ? (
                  <select
                    id={fieldId}
                    value={draftValues[field.name] ?? ""}
                    onChange={(event) => updateDraftValue(field.name, event.target.value)}
                    className={SELECT_BASE_CLASS_NAME}
                    aria-invalid={hasError}
                    disabled={runState === "executing"}
                  >
                    {!field.required ? <option value="">(optional)</option> : null}
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : field.kind === "object" || field.kind === "array" || field.kind === "json" ? (
                  <Textarea
                    id={fieldId}
                    value={draftValues[field.name] ?? ""}
                    onChange={(event) => updateDraftValue(field.name, event.target.value)}
                    className="min-h-24 font-mono text-xs"
                    aria-invalid={hasError}
                    disabled={runState === "executing"}
                    placeholder={
                      field.kind === "array"
                        ? "[]"
                        : field.kind === "object"
                          ? "{}"
                          : "JSON value"
                    }
                  />
                ) : (
                  <Input
                    id={fieldId}
                    value={draftValues[field.name] ?? ""}
                    onChange={(event) => updateDraftValue(field.name, event.target.value)}
                    type={field.kind === "string" ? "text" : "number"}
                    step={field.kind === "integer" ? "1" : "any"}
                    aria-invalid={hasError}
                    disabled={runState === "executing"}
                  />
                )}
                {field.description ? (
                  <p className="text-xs text-muted-foreground">{field.description}</p>
                ) : hint ? (
                  <p className="text-xs text-muted-foreground">{hint}</p>
                ) : null}
                {fieldErrors[field.name]?.map((error, index) => (
                  <p key={index} className="text-xs text-destructive">
                    {error}
                  </p>
                ))}
              </div>
            );
          })
        ) : (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            This tool does not require any parameters.
          </p>
        )}

        {summaryErrors.length > 0 ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            <p className="font-medium">Validation issues:</p>
            <ul className="mt-1 list-disc pl-4">
              {summaryErrors.map((error, index) => (
                <li key={`${error}-${index}`}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={runState === "executing"}>
          {runState === "executing" ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Executing...
            </>
          ) : (
            "Execute Tool"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleRetry}
          disabled={!lastSubmittedArguments || runState === "executing"}
        >
          <RotateCcw className="size-4" />
          Retry Last Run
        </Button>
        {clipboardNotice ? (
          <p className="text-xs text-muted-foreground">{clipboardNotice}</p>
        ) : null}
      </div>

      {executionError ? (
        <div
          className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
          role="alert"
        >
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="size-4" />
            {executionError.message}
          </div>
          {executionError.details.length > 0 ? (
            <ul className="mt-2 list-disc pl-4">
              {executionError.details.map((detail, index) => (
                <li key={`${detail}-${index}`}>{detail}</li>
              ))}
            </ul>
          ) : null}
          <pre className="max-h-48 overflow-auto rounded border bg-background p-2 font-mono text-[11px] whitespace-pre-wrap break-words text-foreground">
            {buildToolErrorDiagnostics(executionError, selectedTool.name, serverName)}
          </pre>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              void copyText(
                buildToolErrorDiagnostics(executionError, selectedTool.name, serverName),
                "Copied error diagnostics.",
              )
            }
          >
            <Copy className="size-4" />
            Copy Diagnostics
          </Button>
        </div>
      ) : null}

      {executionResult ? (
        <div
          className="space-y-3 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs text-emerald-800 dark:text-emerald-200"
          role="status"
        >
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="size-4" />
            Execution succeeded in {executionResult.latency_ms} ms
          </div>
          <InteractionResultMetadata
            serverName={serverName}
            targetLabel={selectedTool.name}
            executedAt={executionResult.executed_at}
            latencyMs={executionResult.latency_ms}
            contentType={executionResult.content_type}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void copyText(
                  normalizePayload(executionResult.result).text,
                  "Copied response payload.",
                )
              }
            >
              <Copy className="size-4" />
              Copy Payload
            </Button>
          </div>
          <JsonPayloadViewer value={executionResult.result} maxHeightClassName="max-h-96" />
        </div>
      ) : null}
    </form>
  );
}
