import { Status } from "https://deno.land/std@0.186.0/http/http_status.ts";
import { hrtime } from "https://deno.land/std@0.177.0/node/process.ts";
import { round } from "https://deno.land/x/math@v1.1.0/mod.ts";
import { HTTPServer } from "../mod.ts";

const httpServer = new HTTPServer();

httpServer.middleware(async (req, done) => {
  const started = hrtime();
  console.log(`${req.method} - ${req.ip()} -  ${req.path}`);
  await done();
  const processTime = hrtime(started);
  console.log(`Processed in ${round((processTime[0] * 1000000000 + processTime[1]) / 1000000, 2)}ms`);
});

httpServer.error((req, _rep) => {
  return JSON.stringify(
    {
      code: Status.NotFound,
      message: "Route not found!",
      path: req.path,
      url: req.url,
    },
    null,
    2,
  );
});

httpServer.add("GET", "/", (req, rep) => {
  rep.status(Status.Teapot)
    .header("working", "true")
    .type("application/json")
    .cookie("working", "true");

  console.log(req.cookie("working"));

  return {
    code: Status.Teapot,
    message: "Hello World!",
  };
});

httpServer.add("GET", "/api/user/:userId", (req, rep) => {
  rep.status(Status.Teapot)
    .type("application/json");

  console.log(req.queryParams);

  return JSON.stringify(
    {
      code: Status.Teapot,
      message: `UserID is ${req.pathParam("userId")}`,
      queryParams: req.queryParams,
    },
    null,
    2,
  );
});

httpServer.listen({
  port: 8080,
  staticLocalDir: "/static",
  staticServePath: "/assets",
});
