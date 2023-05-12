import { Status } from "https://deno.land/std@0.186.0/http/http_status.ts";
import prettyTime from "npm:pretty-time";
import { HTTPServer } from "../mod.ts";

const JOKES = [
  "Why do Java developers often wear glasses? They can't C#.",
  "A SQL query walks into a bar, goes up to two tables and says “can I join you?”",
  "Wasn't hard to crack Forrest Gump's password. 1forrest1.",
  "I love pressing the F5 key. It's refreshing.",
  "Called IT support and a chap from Australia came to fix my network connection.  I asked “Do you come from a LAN down under?”",
  "There are 10 types of people in the world. Those who understand binary and those who don't.",
  "Why are assembly programmers often wet? They work below C level.",
  "My favourite computer based band is the Black IPs.",
  "What programme do you use to predict the music tastes of former US presidential candidates? An Al Gore Rhythm.",
  "An SEO expert walked into a bar, pub, inn, tavern, hostelry, public house.",
];

const httpServer = new HTTPServer();

httpServer.preprocessor((_req, rep) => {
  rep.header("Access-Control-Allow-Origin", "*");
});

httpServer.middleware(async (req, _rep, done) => {
  const processTime = await done();
  if (!req.resourceRequest) {
    console.log(
      `${req.method} - ${req.remoteIpAddr} - ${req.path} - ${
        prettyTime(processTime)
      }`,
    );
  }
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

httpServer.get("/api/joke", (_req, rep) => {
  const randomIndex = Math.floor(Math.random() * JOKES.length);
  const joke = JOKES[randomIndex];
  rep.json({
    code: 200,
    joke,
  });
});

httpServer.get("/site", (_req, rep) => {
  const htmlTest = `
  <html>
    <head>
      <title>HTML Test</title>
      <link rel="stylesheet" type="text/css" href="/assets/style.css">
    </head>
    <body>
      <h1>Hello World!</h1>
      <img src="/assets/lucoa.gif" id="lucoa" width="150" />
      <br>
      <button onclick="document.getElementById('lucoa').remove(); alert('omg, you killed her you monster.')">Useless button, do not press.</button>
    </body>
  </html>
  `;
  rep.html(htmlTest);
});

httpServer.get("/", (req, rep) => {
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

httpServer.get("/api/user/:userId", (req, rep) => {
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
