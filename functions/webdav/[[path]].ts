import { notFound, parseBucketPath } from "./utils";
import { handleRequestCopy } from "./copy";
import { handleRequestDelete } from "./delete";
import { handleRequestGet } from "./get";
import { handleRequestHead } from "./head";
import { handleRequestMkcol } from "./mkcol";
import { handleRequestMove } from "./move";
import { handleRequestPropfind } from "./propfind";
import { handleRequestPut } from "./put";
import { RequestHandlerParams } from "./utils";
import { handleRequestPost } from "./post";

async function handleRequestOptions() {
  return new Response(null, {
    headers: {
      Allow: Object.keys(HANDLERS).join(", "),
      DAV: "1",
    },
  });
}

async function handleMethodNotAllowed() {
  return new Response(null, { status: 405 });
}

const HANDLERS: Record<
  string,
  (context: RequestHandlerParams) => Promise<Response>
> = {
  PROPFIND: handleRequestPropfind,
  MKCOL: handleRequestMkcol,
  HEAD: handleRequestHead,
  GET: handleRequestGet,
  POST: handleRequestPost,
  PUT: handleRequestPut,
  COPY: handleRequestCopy,
  MOVE: handleRequestMove,
  DELETE: handleRequestDelete,
};

export const onRequest: PagesFunction<{
  WEBDAV_USERNAME: string;
  WEBDAV_PASSWORD: string;
  WEBDAV_PUBLIC_READ?: string;
  KV_NAMESPACE: KVNamespace;
}> = async function (context) {
  const env = context.env;
  const request: Request = context.request;
  if (request.method === "OPTIONS") return handleRequestOptions();

  const skipAuth =
    env.WEBDAV_PUBLIC_READ === "1" &&
    ["GET", "HEAD", "PROPFIND"].includes(request.method);

  if (!skipAuth) {
    if (!env.WEBDAV_USERNAME || !env.WEBDAV_PASSWORD)
      return new Response("WebDAV protocol is not enabled", { status: 403 });

    const ip =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for") ||
      "unknown";

    const auth = request.headers.get("Authorization");

    if (!auth || !auth.startsWith("Basic ")) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": `Basic realm="WebDAV"` },
      });
    }

    // 解析用户名
    let attemptUsername = "unknown";
    try {
      const base64 = auth.split(" ")[1];
      const decoded = atob(base64);
      attemptUsername = decoded.split(":")[0] || "unknown";
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }

    const key = `login:${ip}:${attemptUsername}`;

    // 只读一次
    let recordRaw = await env.KV_NAMESPACE.get(key);
    let record = recordRaw ? JSON.parse(recordRaw) : null;

    const now = Date.now();

    // 检查是否被封
    if (record?.bannedUntil && record.bannedUntil > now) {
      return new Response("Too many login attempts. Try later.", {
        status: 403,
      });
    }

    // 构造正确 auth
    const expectedAuth = `Basic ${btoa(
      `${env.WEBDAV_USERNAME}:${env.WEBDAV_PASSWORD}`
    )}`;

    // timing safe
    const encoder = new TextEncoder();
    const a = encoder.encode(auth);
    const b = encoder.encode(expectedAuth);

    const authValid =
      a.length === b.length &&
      crypto.subtle.timingSafeEqual(a, b);

    if (!authValid) {
      const fails = (record?.fails || 0) + 1;

      let newRecord = {
        fails,
        bannedUntil: 0,
      };

      if (fails >= 5) {
        newRecord.bannedUntil = now + 30 * 60 * 1000; // 30分钟
      }

      await env.KV_NAMESPACE.put(
        key,
        JSON.stringify(newRecord),
        {
          expirationTtl: 1800, // 自动过期
        }
      );

      return new Response("Unauthorized", {
        status: fails >= 5 ? 403 : 401,
      });
    }

    // 登录成功 → 什么都不写

  }


  const [bucket, path] = parseBucketPath(context);
  if (!bucket) return notFound();

  const method: string = (context.request as Request).method;
  const handler = HANDLERS[method] ?? handleMethodNotAllowed;
  return handler({ bucket, path, request: context.request });
};
