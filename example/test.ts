import { Status } from "https://deno.land/std@0.186.0/http/http_status.ts";
import { HTTPServer } from "../http_server.ts";

const httpServer = new HTTPServer();
httpServer.add("GET", "/", (_req, rep) => {
  rep.statusCode = Status.Teapot;
  rep.addHeader("working", "true")
  return JSON.stringify(
    {
      code: Status.Teapot,
      message: "Hello World!",
    },
    null,
    2,
  );
});
httpServer.listen({
  port: 8080,
});
