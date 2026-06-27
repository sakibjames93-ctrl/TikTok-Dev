import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

function formatTikwmUrls(obj: any) {
  if (!obj) return;
  const urlFields = ['play', 'hdplay', 'wmplay', 'cover', 'origin_cover', 'avatar', 'avatarLarger', 'avatarMedium', 'avatarThumb'];
  
  if (Array.isArray(obj)) {
    for (const item of obj) {
      formatTikwmUrls(item);
    }
  } else if (typeof obj === 'object') {
    for (const key in obj) {
      if (urlFields.includes(key) && typeof obj[key] === 'string' && obj[key].startsWith('/')) {
        obj[key] = `https://www.tikwm.com${obj[key]}`;
      } else if (typeof obj[key] === 'object') {
        formatTikwmUrls(obj[key]);
      }
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // TikWM API Proxy
  app.get("/api/video", async (req, res) => {
    try {
      const videoUrl = req.query.url as string;
      if (!videoUrl) {
        return res.status(400).json({ error: "TikTok URL is required" });
      }

      let targetUrl = videoUrl.trim();

      // Ensure protocol
      if ((targetUrl.includes("tiktok.com") || targetUrl.includes("vt.tiktok.com") || targetUrl.includes("vm.tiktok.com")) && !targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
        targetUrl = "https://" + targetUrl;
      }

      // Resolve redirect to see if it's a profile or a real video URL
      if (targetUrl.startsWith("http") && (!targetUrl.includes("@") || targetUrl.includes("vt.tiktok.com") || targetUrl.includes("vm.tiktok.com"))) {
        try {
          const redirectRes = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            redirect: 'follow'
          });
          if (redirectRes.url) {
            targetUrl = redirectRes.url;
          }
        } catch (err) {
          console.error("Error resolving redirect in video proxy:", err);
        }
      }

      // Check if targetUrl points to a creator profile rather than a specific video/photo post
      if (targetUrl.includes("tiktok.com/") && !targetUrl.includes("/video/") && !targetUrl.includes("/photo/")) {
        // Parse username from profile URL
        let username = targetUrl;
        const matches = username.match(/@([a-zA-Z0-9_\-\.]+)/);
        if (matches && matches[1]) {
          username = matches[1];
        } else {
          const parts = username.split("?")[0].split("/").filter(Boolean);
          const handlePart = parts.find(p => p.startsWith("@"));
          if (handlePart) {
            username = handlePart.replace("@", "");
          } else {
            const domainIndex = parts.findIndex(p => p.includes("tiktok.com"));
            if (domainIndex !== -1 && parts[domainIndex + 1]) {
              username = parts[domainIndex + 1].replace("@", "");
            }
          }
        }
        username = username.replace(/^@/, "").split("?")[0].split("/")[0].trim();

        return res.json({ isProfile: true, username });
      }

      // We use the TikWM public API for TikTok video details
      const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl)}&hd=1`;
      const response = await fetch(apiUrl);
      const data = await response.json();

      if (data.code === 0) {
        formatTikwmUrls(data.data);
        return res.json(data.data);
      } else {
        return res.status(400).json({ error: data.msg || "Failed to fetch video details" });
      }
    } catch (error) {
      console.error("API proxy error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Profile bulk videos proxy
  app.get("/api/profile", async (req, res) => {
    try {
      let rawQuery = req.query.username as string;
      if (!rawQuery) {
        return res.status(400).json({ error: "Username or profile URL is required" });
      }

      let targetUrl = rawQuery.trim();

      // Add protocol if domain is provided without one
      if ((targetUrl.includes("tiktok.com") || targetUrl.includes("vt.tiktok.com") || targetUrl.includes("vm.tiktok.com")) && !targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
        targetUrl = "https://" + targetUrl;
      }

      // If it's a short URL or any redirected URL without @, resolve redirect to find full URL
      if (targetUrl.startsWith("http") && (!targetUrl.includes("@") || targetUrl.includes("vt.tiktok.com") || targetUrl.includes("vm.tiktok.com"))) {
        try {
          const redirectRes = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            redirect: 'follow'
          });
          if (redirectRes.url) {
            targetUrl = redirectRes.url;
          }
        } catch (err) {
          console.error("Error resolving redirect:", err);
        }
      }

      // Parse username from targetUrl
      let username = targetUrl;
      if (username.includes("tiktok.com/")) {
        const matches = username.match(/@([a-zA-Z0-9_\-\.]+)/);
        if (matches && matches[1]) {
          username = matches[1];
        } else {
          // Alternative format: parts
          const parts = username.split("?")[0].split("/").filter(Boolean);
          const handlePart = parts.find(p => p.startsWith("@"));
          if (handlePart) {
            username = handlePart.replace("@", "");
          } else {
            // Find after tiktok.com
            const domainIndex = parts.findIndex(p => p.includes("tiktok.com"));
            if (domainIndex !== -1 && parts[domainIndex + 1]) {
              username = parts[domainIndex + 1].replace("@", "");
            }
          }
        }
      }

      // Clean up leading @ sign and any trailing query params
      username = username.replace(/^@/, "").split("?")[0].split("/")[0].trim();

      if (!username) {
        return res.status(400).json({ error: "Could not parse a valid TikTok username from input" });
      }

      const cursor = req.query.cursor as string || "0";
      const count = req.query.count as string || "35";
      const apiUrl = `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(username)}&count=${encodeURIComponent(count)}&cursor=${encodeURIComponent(cursor)}&hd=1`;
      const response = await fetch(apiUrl);
      const data = await response.json();
      
      // Without web=1, the video id is returned as 'video_id', but frontend expects 'id'
      if (data && data.data && Array.isArray(data.data.videos)) {
        data.data.videos = data.data.videos.map((v: any) => ({
          ...v,
          id: v.video_id || v.id
        }));
      }

      if (data.code === 0) {
        let stats = null;
        let user = null;
        
        // Fetch detailed profile user info and stats on the first load (cursor "0")
        if (cursor === "0") {
          try {
            const infoUrl = `https://www.tikwm.com/api/user/info?unique_id=${encodeURIComponent(username)}`;
            const infoRes = await fetch(infoUrl);
            const infoData = await infoRes.json();
            if (infoData.code === 0 && infoData.data) {
              stats = infoData.data.stats || null;
              user = infoData.data.user || null;
            }
          } catch (err) {
            console.warn("Soft warning: Could not fetch user/info:", err);
          }
        }

        const responsePayload = {
          ...data.data,
          stats: stats || (data.data.stats || null),
          user: user || (data.data.user || null),
        };
        formatTikwmUrls(responsePayload);
        return res.json(responsePayload);
      } else {
        return res.status(400).json({ error: data.msg || "Failed to fetch profile videos" });
      }
    } catch (error) {
      console.error("Profile API proxy error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Direct download proxy to force browser downloading
  app.get("/api/download", async (req, res) => {
    try {
      let fileUrl = req.query.url as string;
      const filename = req.query.filename as string || "download";

      if (!fileUrl) {
        return res.status(400).json({ error: "File URL is required" });
      }
      
      fileUrl = fileUrl.trim();

      if (fileUrl.startsWith('/')) {
        fileUrl = `https://www.tikwm.com${fileUrl}`;
      }

      const fetchHeaders: HeadersInit = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.tikwm.com/',
        'Accept': '*/*'
      };

      const response = await fetch(fileUrl, { headers: fetchHeaders });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "could not read error body");
        console.error("Proxy fetch failed:", response.status, response.statusText, fileUrl, errorText.slice(0, 100));
        return res.status(response.status).json({ error: `Failed to fetch file: ${response.statusText} - ${errorText.slice(0, 50)}` });
      }

      const contentType = response.headers.get("content-type") || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      
      const contentLength = response.headers.get("content-length");
      if (contentLength) {
        res.setHeader("Content-Length", contentLength);
      }

      const body = response.body;
      if (body) {
        const reader = body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } else {
        res.status(500).json({ error: "Stream unavailable" });
      }
    } catch (error) {
      console.error("Download proxy error:", error);
      res.status(500).json({ error: "Failed to download the file" });
    }
  });

  // Proxy the download to bypass CORS when downloading explicitly (if requested)
  // By default, pointing to the proxy or giving direct links might work. 
  // Free tier direct links (data.play, data.wmplay, data.music) are served via TikWM which doesn't block cors but might track.

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
