import { Status } from "https://deno.land/std@0.186.0/http/http_status.ts";
import { HTTPServer } from "../mod.ts";

const httpServer = new HTTPServer();

httpServer.middleware((req) => {
  console.log(`${req.method} - ${req.ip()} -  ${req.path}`);
})

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
