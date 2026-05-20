export default {
  async fetch(request) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const requestUrl = new URL(request.url);
      const input = requestUrl.searchParams.get("url");
      const format = (requestUrl.searchParams.get("format") || "pdf").toLowerCase();

      if (!input) {
        return textError("Missing url parameter.", 400, corsHeaders);
      }

      if (format !== "pdf" && format !== "txt") {
        return textError("Format must be pdf or txt.", 400, corsHeaders);
      }

      const parsed = new URL(input);

      if (!parsed.hostname.includes("archive.org")) {
        return textError("Only archive.org links are supported.", 400, corsHeaders);
      }

      let fileUrl;

      if (isDirectArchiveFile(parsed, format)) {
        fileUrl = input;
      } else {
        const identifier = getArchiveIdentifier(parsed);

        if (!identifier) {
          return textError("Could not detect Archive.org identifier.", 400, corsHeaders);
        }

        fileUrl = await findArchiveFileUrl(identifier, format);

        if (!fileUrl) {
          return textError(`No ${format.toUpperCase()} file found for this item.`, 404, corsHeaders);
        }
      }

      const archiveResponse = await fetch(fileUrl);

      if (!archiveResponse.ok) {
        return textError(
          `Archive.org file request failed with status ${archiveResponse.status}.`,
          archiveResponse.status,
          corsHeaders
        );
      }

      const filename = safeFilename(decodeURIComponent(new URL(fileUrl).pathname.split("/").pop() || `download.${format}`));

      const headers = new Headers(corsHeaders);
      headers.set("Content-Type", archiveResponse.headers.get("Content-Type") || "application/octet-stream");
      headers.set("Content-Disposition", `attachment; filename="${filename}"`);

      const contentLength = archiveResponse.headers.get("Content-Length");
      if (contentLength) {
        headers.set("Content-Length", contentLength);
      }

      return new Response(archiveResponse.body, {
        status: 200,
        headers
      });

    } catch (error) {
      return textError("Error: " + error.message, 500, corsHeaders);
    }
  }
};

function isDirectArchiveFile(url, format) {
  const path = url.pathname.toLowerCase();

  if (!path.includes("/download/")) return false;

  if (format === "pdf" && path.endsWith(".pdf")) return true;
  if (format === "txt" && path.endsWith(".txt")) return true;

  return false;
}

function getArchiveIdentifier(url) {
  const parts = url.pathname.split("/").filter(Boolean);

  const detailsIndex = parts.indexOf("details");
  if (detailsIndex !== -1 && parts[detailsIndex + 1]) {
    return parts[detailsIndex + 1];
  }

  const downloadIndex = parts.indexOf("download");
  if (downloadIndex !== -1 && parts[downloadIndex + 1]) {
    return parts[downloadIndex + 1];
  }

  return "";
}

async function findArchiveFileUrl(identifier, format) {
  const metadataUrl = `https://archive.org/metadata/${encodeURIComponent(identifier)}`;
  const response = await fetch(metadataUrl);

  if (!response.ok) {
    throw new Error(`Metadata request failed with status ${response.status}.`);
  }

  const metadata = await response.json();
  const files = metadata.files || [];

  let file = null;

  if (format === "pdf") {
    file =
      files.find(f => /_text\.pdf$/i.test(f.name)) ||
      files.find(f => /\.pdf$/i.test(f.name) && /text pdf/i.test(f.format || "")) ||
      files.find(f => /\.pdf$/i.test(f.name)) ||
      files.find(f => /pdf/i.test(f.format || ""));
  }

  if (format === "txt") {
    file =
      files.find(f => /_djvu\.txt$/i.test(f.name)) ||
      files.find(f => /\.txt$/i.test(f.name)) ||
      files.find(f => /plain text/i.test(f.format || "")) ||
      files.find(f => /text/i.test(f.format || ""));
  }

  if (!file) return null;

  return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(file.name)}`;
}

function safeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

function textError(message, status, corsHeaders) {
  return new Response(message, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/plain"
    }
  });
}