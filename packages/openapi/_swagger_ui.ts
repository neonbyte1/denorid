/** Base URL of the pinned Swagger UI release. */
const SWAGGER_UI = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.33.0";

/** Subresource integrity of `swagger-ui.css`. */
const CSS_INTEGRITY =
  "sha384-Ov4/wv3j2bmct8cDc5X4ngJZohVPzEmc6uDPH8WeljUxO5vtoykvMEfbu9Vh6RaW";

/** Subresource integrity of `swagger-ui-bundle.js`. */
const BUNDLE_INTEGRITY =
  "sha384-YDALVcy8kj8yltLBVi1vBiBAUqdxvus673gM8XKwiy6aDUJFXivF/KCufekjYbVf";

/** Characters escaped in HTML text. */
const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Creates the Swagger UI page. The page loads the document from
 * `openapi.json` next to its own path, so it works under any base path.
 *
 * @param {string} title - Page title, e.g. the API title.
 * @return {string} The HTML page.
 */
export function createSwaggerUiPage(title: string): string {
  const escapedTitle = title.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapedTitle}</title>
    <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css" integrity="${CSS_INTEGRITY}" crossorigin="anonymous">
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_UI}/swagger-ui-bundle.js" integrity="${BUNDLE_INTEGRITY}" crossorigin="anonymous"></script>
    <script>
      SwaggerUIBundle({
        url: location.pathname.replace(/\\/?$/, "/openapi.json"),
        dom_id: "#swagger-ui",
      });
    </script>
  </body>
</html>
`;
}
