import {
  Status,
  STATUS_TEXT,
} from "https://deno.land/std@0.186.0/http/http_status.ts";
import * as path from "https://deno.land/std@0.185.0/path/mod.ts";
import * as cookie from "https://deno.land/std@0.185.0/http/cookie.ts";

type ListenOptions = {
  port: number;
  host?: string;
  staticLocalDir?: string;
  staticServePath?: string;
};
type HTTPMethod = "GET" | "POST" | "PUSH" | "DELETE";
type RouteHandler = (
  req: RouteRequest,
  rep: RouteReply,
) =>
  | Promise<unknown>
  | unknown;

type RouteMiddlewareHandler = (
  req: RouteRequest,
  done: () => Promise<unknown>,
) =>
  | Promise<void>
  | void;

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
  private middlewareHandler?: RouteMiddlewareHandler;

  async listen(options: ListenOptions) {
    this.server = Deno.listen({
      port: options.port,
      hostname: options.host,
    });

    console.log(
      `Listening on ${
        options.host ? options.host : "http://localhost"
      }:${options.port} !`,
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
            message: `File ${request.path} not found!`,
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
    const httpConn = Deno.serveHttp(conn);
    for await (const requestEvent of httpConn) {
      const routeRequest = new RouteRequest(requestEvent.request, conn);
      const routeReply: RouteReply = new RouteReply();
      const url = new URL(requestEvent.request.url);
      const filepath = decodeURIComponent(url.pathname);
      if (filepath.startsWith("/_static")) {
        this.handleNotFound(routeRequest, routeReply, requestEvent);
        continue;
      }
      let resolveAction: (value?: unknown) => void = () => {};
      let middlewarePromise;

      if (this.middlewareHandler) {
        middlewarePromise = (): Promise<unknown> => {
          return new Promise((resolve) => {
            resolveAction = resolve;
          });
        };
        this.middlewareHandler(routeRequest, middlewarePromise);
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
          this.handleNotFound(routeRequest, routeReply, requestEvent);
          if (middlewarePromise) resolveAction();
          continue;
        }

        const readableStream = file.readable;
        const response = new Response(readableStream);
        await requestEvent.respondWith(response);
        if (middlewarePromise) resolveAction();
        return;
      }
      const routeName = `${requestEvent.request.method}@${filepath}`;
      let route = this.routes.has(routeName)
        ? this.routes.get(routeName)
        : undefined;

      if (route) {
        let handler = await route.handler(
          routeRequest,
          routeReply,
        );

        if (typeof (handler) == "object") {
          handler = JSON.stringify(handler, null, 2);
        }

        await requestEvent.respondWith(
          new Response(handler as string, {
            status: routeReply.statusCode,
            headers: routeReply.headers,
            statusText: STATUS_TEXT[routeReply.statusCode],
          }),
        );
        if (middlewarePromise) resolveAction();
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
              [curr.paramKey]: routeSegments[curr.idx],
            };
          },
          {},
        );

        const handler = await route.handler(
          routeRequest,
          routeReply,
        );
        await requestEvent.respondWith(
          new Response(handler as string, {
            status: routeReply.statusCode,
            headers: routeReply.headers,
            statusText: STATUS_TEXT[routeReply.statusCode],
          }),
        );
        if (middlewarePromise) resolveAction();
        continue;
      }
      this.handleNotFound(routeRequest, routeReply, requestEvent);
      if (middlewarePromise) resolveAction();
    }
  }

  close() {
    if (this.server) {
      this.server.close();
    }
  }

  middleware(handler: RouteMiddlewareHandler) {
    this.middlewareHandler = handler;
  }

  error(handler: RouteHandler) {
    this.notFoundHandler = handler;
  }

  get(path: string, handler: RouteHandler) {
    this.add("GET", path, handler);
  }

  post(path: string, handler: RouteHandler) {
    this.add("POST", path, handler);
  }

  push(path: string, handler: RouteHandler) {
    this.add("PUSH", path, handler);
  }

  delete(path: string, handler: RouteHandler) {
    this.add("DELETE", path, handler);
  }

  add(method: HTTPMethod, path: string, handler: RouteHandler) {
    const route = new Route(path, method, handler);
    if (this.routes.has(route.routeName)) {
      console.log(`${route.routeName} already registered!`);
      return;
    }
    this.routes.set(route.routeName, route);
    console.log(`${route.routeName} added`);
  }
}

export const routeWithParamsRouteMatcher = (
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

export const routeParamPattern: (route: string) => string = (route) =>
  route.replace(/\/\:[^/]{1,}/gi, "/[^/]{1,}").replace(/\//g, "\\/");

export const extractRouteParams: (route: string) => RouteParam[] = (route) =>
  route.split("/").reduce((accum: RouteParam[], curr: string, idx: number) => {
    if (/:[A-Za-z1-9]{1,}/.test(curr)) {
      const paramKey: string = curr.replace(":", "");
      const param: RouteParam = { idx, paramKey };
      return [...accum, param];
    }
    return accum;
  }, []);

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
  url: string;
  path: string;
  headers: Headers;
  method: HTTPMethod;
  queryParams: { [key: string]: string };
  pathParams: { [key: string]: string };
  private remoteIpAddr: string;

  constructor(request: Request, conn: Deno.Conn) {
    this.url = request.url;
    const urlObj = new URL(request.url);
    this.path = decodeURIComponent(urlObj.pathname);
    this.headers = request.headers;
    this.method = request.method as HTTPMethod;
    this.pathParams = {};
    this.queryParams = this.paramsToObject(urlObj.searchParams.entries());
    this.remoteIpAddr = "hostname" in conn.remoteAddr
      ? conn.remoteAddr["hostname"]
      : "127.0.0.1";
  }

  private paramsToObject(entries: IterableIterator<[string, string]>) {
    const result: { [key: string]: string } = {};
    for (const [key, value] of entries) {
      result[key] = value;
    }
    return result;
  }

  ip() {
    const cfConnectingIp: string = this.header("cf-connecting-ip") as string;
    if (cfConnectingIp && cfConnectingIp.length > 0) return cfConnectingIp;

    const xRealIp: string = this.header("x-real-ip") as string;
    if (xRealIp && xRealIp.length > 0) xRealIp;

    const xForwardedFor: string = this.header("x-forwarded-For") as string;
    if (xForwardedFor && xForwardedFor.length > 0) return xForwardedFor;

    return this.remoteIpAddr;
  }

  header(name: string): unknown {
    const matchingHeader = Array.from(this.headers.keys()).find((headerName) =>
      headerName === name
    );
    return matchingHeader ? this.headers.get(matchingHeader) : undefined;
  }

  cookie(name: string): unknown {
    const allCookies = cookie.getCookies(this.headers);
    const allCookieNames = Object.keys(allCookies);
    return allCookieNames.includes(name) ? allCookies[name] : undefined;
  }

  pathParam(name: string): string {
    return this.pathParams[name];
  }

  queryParam(name: string): string {
    return this.queryParams[name];
  }
}

export class RouteReply {
  headers: Headers = new Headers();
  statusCode: Status = Status.OK;

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

  cookie(name: string, value: string, attributes?: {
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
