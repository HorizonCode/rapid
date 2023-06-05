import {
  Status,
  STATUS_TEXT,
} from "https://deno.land/std@0.186.0/http/http_status.ts";
import * as path from "https://deno.land/std@0.186.0/path/mod.ts";
import * as cookie from "https://deno.land/std@0.186.0/http/cookie.ts";
import { Aes } from "https://deno.land/x/crypto@v0.10.0/aes.ts";
import {
  Cbc,
  Padding,
} from "https://deno.land/x/crypto@v0.10.0/block-modes.ts";
import { cryptoRandomString } from "https://deno.land/x/crypto_random_string@1.0.0/mod.ts";

type HTTPServerOptions = {
  port: number;
  host?: string;
  staticLocalDir?: string;
  staticServePath?: string;
  sessionSecret?: string;
  sessionExpire?: SessionExpire | number;
};

type MiddlewareResult = {
  processTime: number;
};

export enum SessionExpire {
  NEVER = 2147483647,
}

export enum HTTPMethod {
  GET = "GET",
  POST = "POST",
  PUSH = "PUSH",
  DELETE = "DELETE",
}

type RouteHandler = (
  req: RouteRequest,
  rep: RouteReply,
) =>
  | Promise<unknown>
  | unknown;

type RouteMiddlewareHandler = (
  req: RouteRequest,
  rep: RouteReply,
  done: () => Promise<MiddlewareResult>,
) => Promise<void>;

type RoutePreprocessor = (
  req: RouteRequest,
  rep: RouteReply,
) => void;

type RouteParam = {
  idx: number;
  paramKey: string;
};

export class HTTPServer {
  private server?: Deno.Listener;
  private routes = new Map<string, Route>();
  private staticLocalDir?: string;
  private staticServePath?: string;
  private notFoundHandler?: RouteHandler;
  private preprocessors: RoutePreprocessor[] = [];
  private middlewareHandler?: RouteMiddlewareHandler;
  settings?: HTTPServerOptions;
  private logging = true;

  constructor(logging?: boolean) {
    if (logging === undefined) this.logging = true;
    else this.logging = logging;
  }

  async listen(options: HTTPServerOptions) {
    if (options.sessionSecret) {
      if (![16, 24, 32].includes(options.sessionSecret.length)) {
        const randomString = cryptoRandomString({ length: 32 });
        throw new Error(
          "\nInvalid key size (must be either 16, 24 or 32 bytes)\nHere is a pregenerated key: " +
          randomString,
        );
      }
    }
    this.settings = options;
    this.server = Deno.listen({
      port: options.port,
      hostname: options.host,
    });
    if (this.logging)
      console.log(
        `Listening on http://${options.host ?? "localhost"}:${options.port} !`,
      );

    if (options.staticLocalDir && options.staticServePath) {
      this.staticLocalDir = options.staticLocalDir;
      this.staticServePath = options.staticServePath;
    }

    for await (const conn of this.server) {
      this.handleHttp(conn);
    }
  }

  private async handleNotFound(
    request: RouteRequest,
    reply: RouteReply,
    requestEvent: Deno.RequestEvent,
  ) {
    if (this.notFoundHandler) {
      reply.status(Status.NotFound);
      reply.type("application/json");
      const notNoundHandle = await this.notFoundHandler(
        request,
        reply,
      );
      await requestEvent.respondWith(
        new Response(notNoundHandle as string, {
          status: reply.statusCode,
          headers: reply.headers,
          statusText: STATUS_TEXT[reply.statusCode],
        }),
      );
    } else {
      await requestEvent.respondWith(
        new Response(
          JSON.stringify({
            code: 404,
            message: `Path ${request.path} not found!`,
          }),
          {
            status: Status.NotFound,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      );
    }
  }

  private async handleHttp(conn: Deno.Conn) {
    try {
      const httpConn = Deno.serveHttp(conn);
      for await (const requestEvent of httpConn) {
        const filepath = decodeURIComponent(
          "/" + requestEvent.request.url.split("/").slice(3).join("/"),
        );
        const request = requestEvent.request;
        const url = request.url;

        const routeRequest = new RouteRequest(
          this,
          request,
          conn,
          filepath,
          url
        );
        const routeReply: RouteReply = new RouteReply();

        if (filepath.startsWith("/_static") || filepath.endsWith(".ico")) {
          this.handleNotFound(routeRequest, routeReply, requestEvent);
          continue;
        }

        this.preprocessors.forEach((preProcessor) =>
          preProcessor(routeRequest, routeReply)
        );

        let resolveAction: (value: MiddlewareResult) => void = () => { };
        let middlewarePromise;
        const perStart = performance.now();
        if (this.middlewareHandler) {
          middlewarePromise = (): Promise<MiddlewareResult> => {
            return new Promise((resolve) => {
              resolveAction = resolve;
            });
          };
          this.middlewareHandler(routeRequest, routeReply, middlewarePromise);
        }

        if (this.staticServePath && filepath.startsWith(this.staticServePath)) {
          const fileDir = filepath.split("/").slice(2).join("/");
          const pathLoc = path.join(
            Deno.cwd(),
            this.staticLocalDir as string,
            fileDir,
          );
          let file;
          try {
            file = await Deno.open(pathLoc, { read: true });
          } catch {
            if (middlewarePromise) {
              const pt = performance.now() - perStart;
              resolveAction({
                processTime: pt,
              });
            }
            this.processSession(routeRequest, routeReply);
            this.handleNotFound(routeRequest, routeReply, requestEvent);
            continue;
          }

          const readableStream = file.readable;
          const response = new Response(readableStream);
          if (middlewarePromise) {
            const pt = performance.now() - perStart;
            resolveAction({
              processTime: pt,
            });
          }
          this.processSession(routeRequest, routeReply);
          await requestEvent.respondWith(response);
          continue;
        }

        const routeName = `${requestEvent.request.method}@${filepath.replace(/(?!\/)\W\D.*/gm, "")
          }`;
        let route = this.routes.get(routeName);

        if (route) {
          let handler = await route.handler(
            routeRequest,
            routeReply,
          ) ?? routeReply.body;

          if (typeof (handler) == "object") {
            handler = JSON.stringify(handler, null, 2);
          }

          if (middlewarePromise) {
            const pt = performance.now() - perStart;
            resolveAction({
              processTime: pt,
            });
          }
          this.processSession(routeRequest, routeReply);
          await requestEvent.respondWith(
            new Response(handler as string, {
              status: routeReply.statusCode,
              headers: routeReply.headers,
              statusText: STATUS_TEXT[routeReply.statusCode],
            }),
          );
          continue;
        }

        route = Array.from(this.routes.values()).find((route) =>
          routeWithParamsRouteMatcher(routeRequest, route)
        );

        if (route) {
          const routeParamsMap: RouteParam[] = extractRouteParams(route.path);
          const routeSegments: string[] = filepath.split("/");
          routeRequest.pathParams = routeParamsMap.reduce(
            (accum: { [key: string]: string }, curr: RouteParam) => {
              return {
                ...accum,
                [curr.paramKey]: routeSegments[curr.idx].replace(
                  /(?!\/)\W\D.*/gm,
                  "",
                ),
              };
            },
            {},
          );

          const handler = await route.handler(
            routeRequest,
            routeReply,
          );
          if (middlewarePromise) {
            const pt = performance.now() - perStart;
            resolveAction({
              processTime: pt,
            });
          }

          this.processSession(routeRequest, routeReply);
          await requestEvent.respondWith(
            new Response(handler as string, {
              status: routeReply.statusCode,
              headers: routeReply.headers,
              statusText: STATUS_TEXT[routeReply.statusCode],
            }),
          );
          continue;
        }
        if (middlewarePromise) {
          const pt = performance.now() - perStart;
          resolveAction({
            processTime: pt,
          });
        }
        this.processSession(routeRequest, routeReply);
        this.handleNotFound(routeRequest, routeReply, requestEvent);
      }
    } catch (_err) {
      // Ignore http connections that where closed before reply was sent
    }
  }

  private processSession(routeRequest: RouteRequest, routeReply: RouteReply) {
    if (this.settings?.sessionSecret) {
      const sessionObject = JSON.stringify(routeRequest.session);
      if (Object.keys(routeRequest.session).length > 0) {
        const encodedSession = encryptData(
          sessionObject,
          this.settings?.sessionSecret,
        );
        routeReply.cookie("session", encodedSession, {
          maxAge: this.settings.sessionExpire ?? undefined,
        });
      } else {
        if (routeRequest.cookie("session")) {
          routeReply.cookie("session", undefined);
        }
      }
    }
  }

  close() {
    if (this.server) {
      this.server.close();
    }
  }

  preprocessor(handler: RoutePreprocessor) {
    this.preprocessors.push(handler);
  }

  middleware(handler: RouteMiddlewareHandler) {
    this.middlewareHandler = handler;
  }

  error(handler: RouteHandler) {
    this.notFoundHandler = handler;
  }

  get(path: string, handler: RouteHandler) {
    this.add(HTTPMethod.GET, path, handler);
  }

  post(path: string, handler: RouteHandler) {
    this.add(HTTPMethod.POST, path, handler);
  }

  push(path: string, handler: RouteHandler) {
    this.add(HTTPMethod.PUSH, path, handler);
  }

  delete(path: string, handler: RouteHandler) {
    this.add(HTTPMethod.DELETE, path, handler);
  }

  add(method: HTTPMethod, path: string, handler: RouteHandler) {
    const route = new Route(path, method, handler);
    if (this.routes.has(route.routeName)) {
      console.log(`${route.routeName} already registered!`);
      return;
    }
    this.routes.set(route.routeName, route);
    if (this.logging)
      console.log(`${route.routeName} added`);
  }
}

const routeWithParamsRouteMatcher = (
  req: RouteRequest,
  route: Route,
): boolean => {
  const routeMatcherRegEx = new RegExp(`^${routeParamPattern(route.path)}$`);
  return (
    req.method as HTTPMethod === route.method &&
    route.path.includes("/:") &&
    routeMatcherRegEx.test(req.path)
  );
};

const routeParamPattern: (route: string) => string = (route) =>
  route.replace(/\/\:[^/]{1,}/gi, "/[^/]{1,}").replace(/\//g, "\\/");

const extractRouteParams: (route: string) => RouteParam[] = (route) =>
  route.split("/").reduce((accum: RouteParam[], curr: string, idx: number) => {
    if (/:[A-Za-z1-9]{1,}/.test(curr)) {
      const paramKey: string = curr.replace(":", "");
      const param: RouteParam = { idx, paramKey };
      return [...accum, param];
    }
    return accum;
  }, []);

function encryptData(data: string, key: string) {
  const te = new TextEncoder();
  const aeskey = te.encode(key);
  const encodeddata = te.encode(data);
  const iv = new Uint8Array(16);
  const cipher = new Cbc(Aes, aeskey, iv, Padding.PKCS7);
  const encrypted = cipher.encrypt(encodeddata);
  const hexed = Array.from(encrypted).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  return hexed;
}

function decryptHex(data: string, key: string) {
  const te = new TextEncoder();
  const td = new TextDecoder();
  const byteArray = new Uint8Array(data.length / 2);
  for (let i = 0; i < data.length; i += 2) {
    const byte = parseInt(data.substring(i, i + 2), 16);
    byteArray[Math.floor(i / 2)] = byte;
  }
  const aeskey = te.encode(key);
  const iv = new Uint8Array(16);
  const decipher = new Cbc(Aes, aeskey, iv, Padding.PKCS7);
  const decrypted = decipher.decrypt(byteArray);
  return td.decode(decrypted);
}

export class Route {
  routeName: string;
  path: string;
  method: HTTPMethod;
  handler: RouteHandler;

  constructor(path: string, method: HTTPMethod, handler: RouteHandler) {
    this.path = path;
    this.method = method;
    this.routeName = `${method}@${path}`;
    this.handler = handler;
  }
}

export class RouteRequest {
  #request: Request;
  url: string;
  path: string;
  headers: Headers;
  cookies: Record<string, string>;
  method: HTTPMethod;
  queryParams: { [key: string]: string };
  pathParams: { [key: string]: string };
  remoteIpAddr: string;
  resourceRequest: boolean;
  session: { [key: string]: unknown } = {};

  constructor(
    httpServer: HTTPServer,
    request: Request,
    conn: Deno.Conn,
    path: string,
    url: string,
  ) {
    this.#request = request;
    this.url = url;
    this.path = decodeURIComponent(path);
    this.headers = request.headers;
    this.method = request.method as HTTPMethod;
    this.pathParams = {};
    this.resourceRequest = httpServer.settings?.staticServePath &&
      httpServer.settings?.staticServePath.length > 0
      ? path.startsWith(httpServer.settings?.staticServePath)
      : false;
    this.queryParams = Object.fromEntries(new URL(url).searchParams.entries());
    this.cookies = cookie.getCookies(this.headers);
    this.remoteIpAddr = "hostname" in conn.remoteAddr
      ? conn.remoteAddr["hostname"]
      : "127.0.0.1";

    const sessionCookie = this.cookie("session") as string;
    if (sessionCookie && httpServer.settings?.sessionSecret) {
      const decodedSessionCookie = decryptHex(
        sessionCookie,
        httpServer.settings.sessionSecret,
      );
      try {
        this.session = JSON.parse(decodedSessionCookie);
      } catch (_err) {
        console.log(_err);
        // Ignore if sessionCookie is not in JSON format
      }
    }
  }

  sessionDestroy(): void {
    this.session = {};
  }

  header(name: string): unknown {
    const matchingHeader = Array.from(this.headers.keys()).find((headerName) =>
      headerName === name
    );
    return matchingHeader ? this.headers.get(matchingHeader) : undefined;
  }

  cookie(name: string): unknown {
    const allCookieNames = Object.keys(this.cookies);
    return allCookieNames.includes(name) ? this.cookies[name] : undefined;
  }

  pathParam(name: string): string {
    return this.pathParams[name];
  }

  queryParam(name: string): string {
    return this.queryParams[name];
  }

  json() {
    return this.#request.json();
  }

  blob() {
    return this.#request.blob();
  }

  formData() {
    return this.#request.formData()
  }

  arrayBuffer() {
    return this.#request.arrayBuffer();
  }
}

export class RouteReply {
  headers: Headers = new Headers();
  statusCode: Status = Status.OK;
  body: unknown;

  json(json: JSON | { [key: string]: unknown } | []) {
    this.type("application/json");
    this.body = JSON.stringify(json, null, 2);
  }

  html(html: string) {
    this.type("text/html");
    this.body = html;
  }

  header(name: string, value: string): RouteReply {
    this.headers.set(name, value);
    return this;
  }

  status(code: Status): RouteReply {
    this.statusCode = code;
    return this;
  }

  type(type: string): RouteReply {
    this.header("Content-Type", type);
    return this;
  }

  cookie(name: string, value: string | undefined, attributes?: {
    expires?: Date | number;
    maxAge?: number;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
    unparsed?: string[];
  }): RouteReply {
    if (!value) {
      cookie.deleteCookie(this.headers, name, {
        domain: attributes?.domain,
        path: attributes?.path,
      });
    } else {
      cookie.setCookie(this.headers, {
        name: name,
        value: value,
        expires: attributes?.expires,
        maxAge: attributes?.maxAge,
        domain: attributes?.domain,
        path: attributes?.path,
        secure: attributes?.secure,
        httpOnly: attributes?.httpOnly,
        sameSite: attributes?.sameSite,
        unparsed: attributes?.unparsed,
      });
    }
    return this;
  }
}