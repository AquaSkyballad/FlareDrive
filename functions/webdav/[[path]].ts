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

    const banKey = `login:ban:${ip}:${attemptUsername}`;
    const failKey = `login:fail:${ip}:${attemptUsername}`;

    // 检查是否被封禁
    const banned = await env.KV_NAMESPACE.get(banKey);
    if (banned) {
      return new Response("Too many login attempts. Try again later.", {
        status: 403,
      });
    }

    const expectedAuth = `Basic ${btoa(
      `${env.WEBDAV_USERNAME}:${env.WEBDAV_PASSWORD}`
    )}`;

    // timing safe 比较
    const encoder = new TextEncoder();
    const a = encoder.encode(auth);
    const b = encoder.encode(expectedAuth);

    const authValid =
      a.length === b.length &&
      crypto.subtle.timingSafeEqual(a, b);

    if (!authValid) {
      const currentFails = parseInt(
        (await env.KV_NAMESPACE.get(failKey)) || "0"
      );

      const newFails = currentFails + 1;

      if (newFails >= 5) {
        await env.KV_NAMESPACE.put(banKey, "1", {
          expirationTtl: 1800, // 30分钟
        });

        await env.KV_NAMESPACE.delete(failKey);

        return new Response("Too many login attempts. Banned 30 minutes.", {
          status: 403,
        });
      }

      await env.KV_NAMESPACE.put(failKey, newFails.toString(), {
        expirationTtl: 1800,
      });

      return new Response("Unauthorized", { status: 401 });
    }

    // 登录成功 → 清空失败记录
    await env.KV_NAMESPACE.delete(failKey);
  }


  const [bucket, path] = parseBucketPath(context);
  if (!bucket) return notFound();

  const method: string = (context.request as Request).method;
  const handler = HANDLERS[method] ?? handleMethodNotAllowed;
  return handler({ bucket, path, request: context.request });
};
