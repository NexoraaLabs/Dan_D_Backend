// Converts openapi.json -> postman_collection.json so the mobile developer
// can import a ready-to-use Postman collection instead of hand-building
// requests from the OpenAPI spec. Run via `npm run postman:generate`.
const fs = require("fs");
const path = require("path");
const Converter = require("openapi-to-postmanv2");

const openapiPath = path.join(__dirname, "..", "openapi.json");
const outPath = path.join(__dirname, "..", "postman_collection.json");

const openapiData = fs.readFileSync(openapiPath, "utf8");

Converter.convert(
  { type: "string", data: openapiData },
  { folderStrategy: "Tags" },
  (err, result) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    if (!result.result) {
      console.error(result.reason);
      process.exit(1);
    }
    const collection = result.output[0].data;

    // The converter doesn't know our auth flow, so wire it up by hand: a
    // collection-level `bearerToken` variable, auto-populated by a test
    // script on every endpoint that returns an accessToken (register, login,
    // refresh). Every other request already inherits collection-level bearer
    // auth from the OpenAPI security scheme, so this is the only manual step.
    collection.variable = collection.variable || [];
    collection.variable.push({ type: "string", key: "bearerToken", value: "" });

    const TOKEN_ISSUING_PREFIXES = ["Log in", "Create account", "Exchange a refresh token"];
    const captureScript = {
      listen: "test",
      script: {
        type: "text/javascript",
        exec: [
          "if (pm.response.code < 300) {",
          "  const body = pm.response.json();",
          '  if (body.accessToken) pm.collectionVariables.set("bearerToken", body.accessToken);',
          "}",
        ],
      },
    };
    function attachCaptureScript(item) {
      if (item.item) {
        item.item.forEach(attachCaptureScript);
        return;
      }
      if (TOKEN_ISSUING_PREFIXES.some((p) => item.name.startsWith(p))) {
        item.event = item.event || [];
        item.event.push(captureScript);
      }
    }
    collection.item.forEach(attachCaptureScript);

    fs.writeFileSync(outPath, JSON.stringify(collection, null, 2));
    console.log(`Wrote ${outPath}`);
  }
);
