import {
  Status,
  STATUS_TEXT,
} from "https://deno.land/std@0.186.0/http/http_status.ts";
import * as path from "https://deno.land/std@0.185.0/path/mod.ts";
type ListenOptions = {
  port: number;
  host?: string;
  staticLocalDir?: string;
  staticServePath?: string;
};
type HTTPMethod = "GET" | "POST" | "PUSH" | "DELETE";
type RouteHandler = (
  req: Request,
  rep: RouteReply,
) =>
  | Promise<unknown>
  | unknown;

export class HTTPServer {
  private server?: Deno.Listener;
  private routes = new Map<string, Route>();
  private staticLocalDir?: string;
  private staticServePath?: string;

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
      const httpConn = Deno.serveHttp(conn);
      for await (const requestEvent of httpConn) {
        const url = new URL(requestEvent.request.url);
        const filepath = decodeURIComponent(url.pathname);

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
            // If the file cannot be opened, return a "404 Not Found" response
            await requestEvent.respondWith(
              new Response(
                JSON.stringify({
                  code: 404,
                  message: `File ${filepath} not found!`,
                }),
                {
                  status: Status.NotFound,
                },
              ),
            );
            continue;
          }

          const readableStream = file.readable;
          const response = new Response(readableStream);
          await requestEvent.respondWith(response);
          return;
        }
        const routeName = `${requestEvent.request.method}@${filepath}`;
        const route = this.routes.has(routeName)
          ? this.routes.get(routeName)
          : undefined;

        if (route) {
          const routeReply: RouteReply = new RouteReply();
          const handler = await route.handler(
            requestEvent.request,
            routeReply,
          );
          await requestEvent.respondWith(
            new Response(handler as string, {
              status: routeReply.statusCode,
              headers: routeReply.headers,
              statusText: STATUS_TEXT[routeReply.statusCode],
            }),
          );
        } else {
          await requestEvent.respondWith(
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
