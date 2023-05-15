# rapid
Streamlined Deno-powered HTTP framework for lightning-fast web development.

## How to use
```ts
import { HTTPServer } from "https://deno.land/x/rapid@v0.1.0/mod.ts";

const server = new HTTPServer();

server.get("/", (_req, _rep) => "Hello World!");

await server.listen({
  port: 8000,
});
```

