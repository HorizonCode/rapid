import {
  Status,
  STATUS_TEXT,
} from "https://deno.land/std@0.186.0/http/http_status.ts";

type ListenOptions = {
  port: number;
  host?: string;
};
type HTTPMethod = "GET" | "POST" | "PUSH" | "DELETE";
type RouteHandler = (
  req: Request,
  rep: RouteReply,
) =>
  | Promise<unknown>
  | unknown;

export class HTTPServer {
  private urlRegex = new RegExp(/(http[s]?:\/\/)?([^\/\s]+\/)(.*)/);
  private server?: Deno.Listener;
  private routes = new Map<string, Route>();

  async listen(options: ListenOptions) {
    this.server = Deno.listen({
      port: options.port,
      hostname: options.host,
    });

    for await (const conn of this.server) {
      const httpConn = Deno.serveHttp(conn);
      for await (const requestEvent of httpConn) {
        const urlPath = this.urlRegex.exec(requestEvent.request.url);
        const path = urlPath && urlPath.length > 3 ? "/" + urlPath[3] : "/";
        const routeName = `${requestEvent.request.method}@${path}`;
        const route = this.routes.has(routeName)
          ? this.routes.get(routeName)
          : undefined;

        if (route) {
          const routeReply: RouteReply = new RouteReply();
          const handler = await route.handler(
            requestEvent.request,
            routeReply,
          );
          requestEvent.respondWith(
            new Response(handler as string, {
              status: routeReply.statusCode,
              headers: routeReply.headers,
              statusText: STATUS_TEXT[routeReply.statusCode],
            }),
          );
        } else {
          requestEvent.respondWith(
            new Response(
              JSON.stringify({
                code: 404,
                message: `Route ${routeName} not found!`,
              }),
              {
                status: Status.NotFound,
              },
            ),
          );
        }
      }
    }
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
    this.routes.set(route.routeName, route);
    console.log(`${route.routeName} added`);
  }
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

export class RouteReply {
  headers: Headers = new Headers();
  statusCode: Status = Status.OK;

  addHeader(name: string, value: string) {
    this.headers.append(name, value);
  }
}

export class RouteProcessor {
}
