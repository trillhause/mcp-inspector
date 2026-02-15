export type ConnectionStatus = "connected" | "disconnected" | "expired";

export type McpServer = {
  id: string;
  name: string;
  description: string;
  mcp_url: string;
  transport: "auto" | "streamable_http" | "sse";
  icon_url: string;
  is_preconfigured: boolean;
  is_enabled: boolean;
  auth_mode: "oauth" | "none";
  connection_status: ConnectionStatus;
  tool_count: number | null;
  resource_count: number | null;
  connected_at: string | null;
};
