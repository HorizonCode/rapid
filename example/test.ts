import { Status } from "https://deno.land/std@0.186.0/http/http_status.ts";
import prettyTime from "npm:pretty-time";
import { HTTPServer, SessionExpire } from "../mod.ts";

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

// Add as many preprocessors as you want
httpServer.preprocessor((req, _rep) => {
  if (req.resourceRequest) {
    console.log(`Requested resource ${req.path}`);
  }
});

httpServer.preprocessor((_req, rep) => {
  rep.header("Access-Control-Allow-Origin", "*");
});

httpServer.middleware(async (req, _rep, done) => {
  const result = await done();
  const hrArray: number[] = [0, Math.trunc(result.processTime * 1000000)];
  if (!req.resourceRequest) {
    console.log(
      `${req.method} - ${req.remoteIpAddr} - ${req.path} - ${prettyTime(hrArray)
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

httpServer.post("/upload", async (req, _rep) => {
  const bodyStream = await req.blob();
  if (bodyStream) {
    await Deno.writeFile("test.png", bodyStream.stream())
  }
  return "test";
})

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

httpServer.delete("/session", (req, _rep) => {
  const username = req.session.user as string ?? "";
  if (username.length > 0) {
    req.sessionDestroy();
    return {
      code: 200,
      message: "Logged out!",
    };
  } else {
    return {
      code: 403,
      message: "Not logged in!",
    };
  }
});

httpServer.post("/session", (req, _rep) => {
  const username = req.queryParam("username") ?? "";
  if (username.length > 0) {
    req.session.user = username;
    return {
      code: 200,
      message: "Logged in!",
    };
  } else {
    return {
      code: 403,
      message: "Please enter a Username",
    };
  }
});

httpServer.get("/session", (req, rep) => {
  const headerText = req.session.user
    ? `Hello, ${req.session.user}!`
    : `Please login!`;
  const htmlTest = `
  <html>
    <head>
      <title>Session Example</title>
    </head>
    <body>
      <h1>${headerText}</h1>
      <input type="text" placeholder="Username" id="username" style="margin-bottom: 15px;"  ${req.session.user ? "value='" + req.session.user + "' disabled" : ""}/>
      <br>
      <button onclick="${req.session.user ? "doLogout" : "doLogin"}()">${req.session.user ? "Logout" : "Login"
    }</button>
    </body>
    <script type="">
      async function doLogout() {
        const fetchResult = await fetch("/session", { method: 'DELETE'});
        const jsonResult = await fetchResult.json();
        if("code" in jsonResult){
          if(jsonResult.code == 200){
            document.location.reload(true)
          }else{
            alert(jsonResult.message);
          }
        }
      }
      async function doLogin() {
        const username = document.getElementById('username').value;
        const fetchResult = await fetch("/session?username=" + username, { method: 'POST'});
        const jsonResult = await fetchResult.json();
        if("code" in jsonResult){
          if(jsonResult.code == 200){
            document.location.reload(true)
          }else{
            alert(jsonResult.message);
          }
        }
      }
    </script>
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
  sessionSecret: "SuperDuperSecret",
  sessionExpire: SessionExpire.NEVER
});