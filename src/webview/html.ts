//src/webview/html.ts (HTML/CSP/nonce 분리)
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export function getWebviewHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
) {
  const webviewDistPath = path.join(context.extensionPath, "media", "webview");
  const indexPath = path.join(webviewDistPath, "index.html");
  let html = fs.readFileSync(indexPath, "utf8");
  if (process.env.COGIC_PIPELINE_PROFILE) {
    html = html.replace("</head>", '<meta name="cogic-pipeline-profile" content="on"></head>');
  }

  const assetBaseUri = webview
    .asWebviewUri(vscode.Uri.file(webviewDistPath))
    .toString();

  // Replace base href and asset URLs
  html = html.replace(
    /<base href="[^"]*" ?\/?>/g,
    `<base href="${assetBaseUri}/" />`,
  );
  html = html.replace(
    /"(\/assets\/[^"]+)"/g,
    (_, p1) => `"${assetBaseUri}${p1}"`,
  );

  // CSP (minimal)
  const cspSource = webview.cspSource;
  const nonce = getNonce();

  html = html.replace(
    /<meta http-equiv="Content-Security-Policy" content="[^"]*"\s*\/?>/g,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">`,
  );

  // Ensure script tags have nonce
  html = html.replace(/<script /g, `<script nonce="${nonce}" `);

  return html;
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
