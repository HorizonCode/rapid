import { Status } from "https://deno.land/std@0.186.0/http/http_status.ts";
import { HTTPServer } from "../http_server.ts";

const httpServer = new HTTPServer();

httpServer.add("GET", "/", (req, rep) => {
  rep.status(Status.Teapot)
    .header("working", "true")
    .type("application/json")
    .cookie("working", "true");

  console.log(req.cookie("working"));

  return JSON.stringify(
    {
      code: Status.Teapot,
      message: "Hello World!",
    },
    null,
    2,
  );
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
