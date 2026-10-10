import {
  handleLogin,
  handleLogout,
  handleMe,
  handlePasswordChange,
  handleSetup,
  requireCsrf,
  requireSession
} from "./auth";
import type { AppEnv } from "./app-env";
import {
  handleDashboard,
  handleExport,
  handleLeadCreate,
  handleMemberArchive,
  handleMemberCreate,
  handleMemberDelete,
  handleMemberDetail,
  handleMemberRenew,
  handleMembersList,
  handleMemberUpdate,
  handleReminderPreview,
  handleReports,
  handleSettingsGet,
  handleSettingsUpdate,
  handleTransactionCreate,
  handleTransactionDelete,
  handleTransactionsList,
  handleTransactionUpdate
} from "./data";
import { errorResponse, getPathParts, json, methodNotAllowed, notFound, securityHeaders } from "./http";

async function route(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: securityHeaders() });
  if (!url.pathname.startsWith("/api/")) return notFound();

  const parts = getPathParts(url);
  const resource = parts[1];
  const id = parts[2];
  const action = parts[3];

  if (resource === "auth" && id === "me" && request.method === "GET") return handleMe(request, env, ctx);
  if (resource === "setup" && request.method === "POST") return handleSetup(request, env);
  if (resource === "auth" && id === "login" && request.method === "POST") return handleLogin(request, env);

  const session = await requireSession(request, env, ctx);
  requireCsrf(request, session);

  if (resource === "auth" && id === "logout" && request.method === "POST") return handleLogout(request, env, session);
  if (resource === "settings" && !id && request.method === "GET") return handleSettingsGet(env);
  if (resource === "settings" && !id && request.method === "PUT") return handleSettingsUpdate(request, env);
  if (resource === "settings" && id === "password" && request.method === "POST") return handlePasswordChange(request, env, session);
  if (resource === "dashboard" && request.method === "GET") return handleDashboard(url, env);

  if (resource === "members" && !id && request.method === "GET") return handleMembersList(url, env);
  if (resource === "members" && !id && request.method === "POST") return handleMemberCreate(request, env);
  if (resource === "members" && id && !action && request.method === "GET") return handleMemberDetail(env, id);
  if (resource === "members" && id && !action && request.method === "PUT") return handleMemberUpdate(request, env, id);
  if (resource === "members" && id && action === "archive" && request.method === "POST") return handleMemberArchive(env, id, true);
  if (resource === "members" && id && action === "restore" && request.method === "POST") return handleMemberArchive(env, id, false);
  if (resource === "members" && id && action === "delete" && request.method === "DELETE") return handleMemberDelete(env, id);
  if (resource === "members" && id && action === "renew" && request.method === "POST") return handleMemberRenew(request, env, id);

  if (resource === "transactions" && !id && request.method === "GET") return handleTransactionsList(url, env);
  if (resource === "transactions" && !id && request.method === "POST") return handleTransactionCreate(request, env);
  if (resource === "transactions" && id && request.method === "PUT") return handleTransactionUpdate(request, env, id);
  if (resource === "transactions" && id && request.method === "DELETE") return handleTransactionDelete(env, id);

  if (resource === "reports" && request.method === "GET") return handleReports(url, env);
  if (resource === "reminders" && id === "preview" && request.method === "POST") return handleReminderPreview(request, env);
  if (resource === "leads" && request.method === "POST") return handleLeadCreate(request, env);
  if (resource === "export" && id && request.method === "GET") return handleExport(url, env, id);

  if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) return methodNotAllowed();
  return notFound();
}

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    try {
      const response = await route(request, env, ctx);
      securityHeaders(response.headers);
      return response;
    } catch (error) {
      return errorResponse(error);
    }
  }
} satisfies ExportedHandler<AppEnv>;
